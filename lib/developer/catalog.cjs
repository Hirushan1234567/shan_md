import { db, currentUser, adminEmails } from "./_local-auth.cjs";

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function isAdmin(user) {
  return !!user && adminEmails().includes(String(user.email).toLowerCase());
}

function clean(body = {}) {
  return {
    name: String(body.name || "").trim().slice(0, 100),
    slug: String(body.slug || "").trim().toLowerCase().slice(0, 100),
    description: String(body.description || "").trim().slice(0, 2000),
    baseUrl: String(body.baseUrl || "").trim().slice(0, 500),
    docs: String(body.docs || "").slice(0, 20000),
    example: String(body.example || "").slice(0, 10000),
    minPlan: body.minPlan === "premium" ? "premium" : "free",
    active: body.active !== false,
    type: body.type === "external" ? "external" : "local"
  };
}

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: "Please login first" });

    const database = await db();
    const collection = database.collection("developerApis");
    const admin = isAdmin(user);

    if (req.method === "GET") {
      const filter = admin ? {} : {
        active: true,
        minPlan: user.plan === "premium" ? { $in: ["free", "premium"] } : "free"
      };

      const apis = await collection.find(filter, {
        projection: { _id: 0 }
      }).sort({ createdAt: -1 }).toArray();

      return send(res, 200, { success: true, apis });
    }

    if (!admin) return send(res, 403, { error: "Admin access required" });

    if (req.method === "POST") {
      const item = clean(req.body);

      if (!item.name || !item.slug || !item.baseUrl) {
        return send(res, 400, {
          error: "Name, slug and baseUrl are required"
        });
      }

      const exists = await collection.findOne({ slug: item.slug });
      if (exists) return send(res, 409, { error: "API slug already exists" });

      await collection.insertOne({
        ...item,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return send(res, 201, { success: true, message: "API added" });
    }

    if (req.method === "PATCH") {
      const slug = String(req.body?.slug || "").trim().toLowerCase();
      if (!slug) return send(res, 400, { error: "API slug required" });

      const item = clean(req.body);
      delete item.slug;

      const result = await collection.updateOne(
        { slug },
        { $set: { ...item, updatedAt: new Date() } }
      );

      if (!result.matchedCount) {
        return send(res, 404, { error: "API not found" });
      }

      return send(res, 200, { success: true, message: "API updated" });
    }

    if (req.method === "DELETE") {
      const slug = String(req.body?.slug || "").trim().toLowerCase();
      if (!slug) return send(res, 400, { error: "API slug required" });

      const result = await collection.deleteOne({ slug });
      if (!result.deletedCount) {
        return send(res, 404, { error: "API not found" });
      }

      return send(res, 200, { success: true, message: "API deleted" });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Developer catalog error:", error.message);
    return send(res, 500, { error: "Internal server error" });
  }
}

import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { db, currentUser, adminEmails } from "./_local-auth.cjs";

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function isAdmin(user) {
  return !!user && adminEmails().includes(String(user.email).toLowerCase());
}

function getEncryptionKey() {
  const value = String(process.env.API_KEY_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("API_KEY_ENCRYPTION_KEY must be a 64-character hex value");
  }
  return Buffer.from(value, "hex");
}

function encryptKey(apiKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final()
  ]);
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: cipher.getAuthTag().toString("hex")
  };
}

function decryptKey(record) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(record.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(record.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.data, "hex")),
    decipher.final()
  ]).toString("utf8");
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: "Please login first" });

    const database = await db();
    const collection = database.collection("developerApiKeys");
    const admin = isAdmin(user);

    if (req.method === "GET") {
      const records = await collection.find({
        userEmail: String(user.email).toLowerCase(),
        revoked: { $ne: true }
      }).sort({ createdAt: -1 }).toArray();

      const keys = records.map(record => ({
        id: record.id,
        label: record.label,
        apiSlug: record.apiSlug,
        createdAt: record.createdAt,
        apiKey: decryptKey(record)
      }));

      return send(res, 200, { success: true, keys });
    }

    if (!sameOrigin(req)) {
      return send(res, 403, { error: "Invalid request origin" });
    }

    if (!admin) return send(res, 403, { error: "Admin access required" });

    if (req.method === "POST") {
      const body = req.body || {};
      const email = String(body.email || "").trim().toLowerCase();
      const apiKey = String(body.apiKey || "").trim();
      const label = String(body.label || "API Key").trim().slice(0, 100);
      const apiSlug = String(body.apiSlug || "").trim().toLowerCase().slice(0, 100);

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return send(res, 400, { error: "Valid user email required" });
      }
      if (!apiKey || apiKey.length > 500) {
        return send(res, 400, { error: "Valid API key required" });
      }

      const target = await database.collection("apiDevelopers").findOne(
        { email },
        { projection: { _id: 1 } }
      );
      if (!target) return send(res, 404, { error: "Developer account not found" });

      const encrypted = encryptKey(apiKey);
      await collection.insertOne({
        id: randomUUID(),
        keyHash: require("crypto").createHash("sha256").update(apiKey).digest("hex"),
        userEmail: email,
        label,
        apiSlug,
        ...encrypted,
        revoked: false,
        createdAt: new Date()
      });

      return send(res, 201, { success: true, message: "API key assigned" });
    }

    if (req.method === "DELETE") {
      const id = String(req.body?.id || "");
      if (!id) return send(res, 400, { error: "Key ID required" });

      const result = await collection.updateOne(
        { id, revoked: { $ne: true } },
        { $set: { revoked: true, revokedAt: new Date() } }
      );

      if (!result.matchedCount) {
        return send(res, 404, { error: "API key not found" });
      }

      return send(res, 200, { success: true, message: "API key revoked" });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Developer keys error:", error.message);
    return send(res, 500, { error: "Internal server error" });
  }
}

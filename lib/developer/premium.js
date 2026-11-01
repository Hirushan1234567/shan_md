const { currentUser, getDb, adminEmails } = require("./_local-auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const db = await getDb();

    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        plan: user.plan || "free",
        premiumUntil: user.premiumUntil || null
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!adminEmails().includes(String(user.email || "").toLowerCase())) {
      return res.status(403).json({ error: "Admin only" });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    const action = String(req.body?.action || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }

    if (!["grant", "revoke"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const target = await db.collection("apiDevelopers").findOne({ email });
    if (!target) return res.status(404).json({ error: "Developer not found" });

    if (action === "revoke") {
      await db.collection("apiDevelopers").updateOne(
        { email },
        { $set: { plan: "free" }, $unset: { premiumUntil: "" } }
      );
    } else {
      const until = req.body?.premiumUntil
        ? new Date(req.body.premiumUntil)
        : null;

      if (until && (Number.isNaN(until.getTime()) || until <= new Date())) {
        return res.status(400).json({ error: "Expiry must be a future date" });
      }

      await db.collection("apiDevelopers").updateOne(
        { email },
        {
          $set: {
            plan: "premium",
            premiumUntil: until
          }
        }
      );
    }

    return res.status(200).json({ success: true, message: "Premium updated" });
  } catch (error) {
    console.error("Premium API error:", error.message);
    return res.status(500).json({ error: "Premium update failed" });
  }
};

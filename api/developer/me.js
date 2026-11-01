import { db, sha, cookieValue } from "./_lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = cookieValue(req, "shan_api_session");
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const database = await db();
    const session = await database.collection("apiSessions").findOne({
      tokenHash: sha(token),
      expiresAt: { $gt: new Date() }
    });
    if (!session) return res.status(401).json({ error: "Session expired" });

    const user = await database.collection("apiDevelopers").findOne(
      { email: session.email },
      { projection: { _id: 0, email: 1, name: 1, picture: 1, plan: 1, createdAt: 1 } }
    );
    if (!user) return res.status(401).json({ error: "Account not found" });

    return res.status(200).json({ ok: true, user });
  } catch (error) {
    console.error("Developer me:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
}

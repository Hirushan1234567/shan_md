import { db, hashToken, readCookie, clearSessionCookie } from "./_local-auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = readCookie(req);
    if (token) {
      const database = await db();
      await database.collection("apiSessions").deleteOne({
        tokenHash: hashToken(token)
      });
    }

    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Developer logout:", error.message);
    return res.status(500).json({ error: "Logout failed" });
  }
}

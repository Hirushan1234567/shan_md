import { randomBytes } from "node:crypto";
import { db, hashToken, verifyPassword, setSessionCookie } from "./_local-auth.cjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const database = await db();
    const user = await database.collection("apiDevelopers").findOne({ email });

    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash)))
      return res.status(401).json({ error: "Invalid email or password" });

    const token = randomBytes(32).toString("hex");
    const now = new Date();

    await database.collection("apiSessions").insertOne({
      tokenHash: hashToken(token),
      email,
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 86400000)
    });

    setSessionCookie(res, token);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Developer login:", error.message);
    return res.status(500).json({ error: "Login failed" });
  }
}

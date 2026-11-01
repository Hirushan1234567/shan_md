import { randomBytes } from "node:crypto";
import { db, hashPassword, hashToken, setSessionCookie, adminEmails } from "./_local-auth.cjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim().slice(0, 80);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Valid email required" });
    if (password.length < 10 || password.length > 200)
      return res.status(400).json({ error: "Password must be 10–200 characters" });

    const database = await db();
    const users = database.collection("apiDevelopers");

    if (await users.findOne({ email }))
      return res.status(409).json({ error: "Account already exists" });

    const now = new Date();
    await users.insertOne({
      email,
      name,
      passwordHash: await hashPassword(password),
      role: adminEmails().includes(email) ? "admin" : "user",
      plan: "free",
      createdAt: now
    });

    const token = randomBytes(32).toString("hex");
    await database.collection("apiSessions").insertOne({
      tokenHash: hashToken(token),
      email,
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 86400000)
    });

    setSessionCookie(res, token);
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Developer register:", error.message);
    return res.status(500).json({ error: "Registration failed" });
  }
}

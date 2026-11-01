import { currentUser } from "./_local-auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });

    return res.status(200).json({
      ok: true,
      user: {
        email: user.email,
        name: user.name || "",
        role: user.role || "user",
        plan: user.plan || "free",
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error("Developer me:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
}

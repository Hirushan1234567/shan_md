import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function requireAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Authentication required" });

    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "shan-api-hub"
    });
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user || user.isBlocked) {
      return res.status(401).json({ error: "Account unavailable" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

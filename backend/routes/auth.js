import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import { signAccessToken } from "../config/jwt.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." }
});

router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 60);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Name and valid email are required" });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 8–128 characters" });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const freePlan = await Plan.findOne({ slug: "free", isActive: true });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name, email, passwordHash,
      planId: freePlan?._id || null,
      planSlug: "free"
    });
    const token = signAccessToken(user);
    return res.status(201).json({
      token,
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role, plan: user.planSlug }
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "An account with this email already exists" });
    next(error);
  }
});

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    if (user.isBlocked) return res.status(403).json({ error: "This account has been blocked" });

    const token = signAccessToken(user);
    return res.json({
      token,
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role, plan: user.planSlug }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = req.user;
    if (user.planSlug !== "free" && user.planExpiresAt && user.planExpiresAt <= new Date()) {
      const freePlan = await Plan.findOne({ slug: "free", isActive: true });
      user.planSlug = "free";
      user.planId = freePlan?._id || null;
      user.planExpiresAt = null;
      await user.save();
    }
    res.json({
      user: {
        id: String(user._id), name: user.name, email: user.email,
        role: user.role, plan: user.planSlug, planExpiresAt: user.planExpiresAt,
        coinBalance: user.coinBalance, isVerified: user.isVerified
      }
    });
  } catch (error) { next(error); }
});

export default router;

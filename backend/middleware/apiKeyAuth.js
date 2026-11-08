import crypto from "node:crypto";
import ApiKey from "../models/ApiKey.js";
import Plan from "../models/Plan.js";
import User from "../models/User.js";
import UsageLog from "../models/UsageLog.js";
import rateLimit from "express-rate-limit";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

export async function requireApiKey(req, res, next) {
  const rawKey = String(req.get("x-api-key") || req.query.api_key || "").trim();
  if (!/^myapi_[a-f0-9]{32}$/i.test(rawKey)) {
    return res.status(401).json({ success: false, error: "INVALID_API_KEY", message: "A valid API key is required." });
  }

  try {
    const key = await ApiKey.findOne({ keyHash: sha256(rawKey), isActive: true }).select("+keyHash");
    if (!key) {
      return res.status(401).json({ success: false, error: "INVALID_API_KEY", message: "API key is invalid or revoked." });
    }

    let user = await User.findById(key.userId);
    if (!user || user.isBlocked) {
      return res.status(403).json({ success: false, error: "ACCOUNT_UNAVAILABLE", message: "This account is unavailable." });
    }

    if (user.planSlug !== "free" && user.planExpiresAt && user.planExpiresAt <= new Date()) {
      const freePlan = await Plan.findOne({ slug: "free", isActive: true }).lean();
      user.planSlug = "free";
      user.planId = freePlan?._id || null;
      user.planExpiresAt = null;
      await user.save();
    }

    const plan = await Plan.findOne({ slug: user.planSlug, isActive: true }).lean();
    if (!plan) {
      return res.status(403).json({ success: false, error: "PLAN_UNAVAILABLE", message: "The current plan is unavailable." });
    }

    if (!plan.unlimited) {
      const limit = Number(plan.requestLimit || 0);
      const reserved = await User.findOneAndUpdate(
        { _id: user._id, $or: [{ requestsUsed: { $lt: limit } }, { requestsUsed: { $exists: false } }] },
        { $inc: { requestsUsed: 1 } },
        { new: true }
      );
      if (!reserved) {
        return res.status(429).json({
          success: false, error: "QUOTA_EXCEEDED",
          message: "Your request quota has been used.",
          usage: { used: user.requestsUsed, limit }
        });
      }
      user = reserved;
      req.apiQuotaReserved = true;
    }

    req.apiUser = user;
    req.apiKey = key;
    req.apiPlan = plan;

    res.on("finish", async () => {
      const successful = res.statusCode < 400;
      try {
        if (req.apiQuotaReserved && !successful) {
          await User.updateOne({ _id: user._id }, { $inc: { requestsUsed: -1 } });
        }
        await UsageLog.create({
          userId: user._id,
          apiKeyId: key._id,
          category: req.params.category || "unknown",
          action: req.params.action || req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTimeMs: Math.max(0, Date.now() - req.apiStartedAt)
        });
        await ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } });
      } catch (error) {
        console.error("[api-key usage]", error.message);
      }
    });

    req.apiStartedAt = Date.now();
    next();
  } catch (error) {
    next(error);
  }
}

export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => req.apiKey ? String(req.apiKey._id) : req.ip
});

export default requireApiKey;

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Plan from "../models/Plan.js";
import ApiKey from "../models/ApiKey.js";
import UsageLog from "../models/UsageLog.js";
import CoinTransaction from "../models/CoinTransaction.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const [plan, keyCount, recentLogs, transactions] = await Promise.all([
      Plan.findById(req.user.planId).lean(),
      ApiKey.countDocuments({ userId: req.user._id, isActive: true }),
      UsageLog.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20).lean(),
      CoinTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20).lean()
    ]);

    res.json({
      user: {
        id: String(req.user._id), name: req.user.name, email: req.user.email,
        role: req.user.role, plan: req.user.planSlug,
        planExpiresAt: req.user.planExpiresAt, coinBalance: req.user.coinBalance
      },
      plan: plan ? {
        name: plan.name, requestLimit: plan.requestLimit,
        unlimited: plan.unlimited, durationDays: plan.durationDays
      } : null,
      activeApiKeys: keyCount,
      recentLogs,
      coinTransactions: transactions
    });
  } catch (error) {
    next(error);
  }
});

export default router;

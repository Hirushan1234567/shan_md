import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Plan from "../models/Plan.js";
import User from "../models/User.js";
import CoinTransaction from "../models/CoinTransaction.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const plans = await Plan.find({ isActive: true }).select("name slug priceCoins durationDays requestLimit unlimited").sort({ priceCoins: 1 }).lean();
    res.json({ success: true, plans });
  } catch (error) { next(error); }
});

router.post("/:slug/purchase", requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!["premium", "membership"].includes(slug)) {
      return res.status(400).json({ success: false, error: "INVALID_PLAN", message: "Only paid plans can be purchased with coins." });
    }
    const plan = await Plan.findOne({ slug, isActive: true }).lean();
    if (!plan) return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND" });
    const price = Math.max(0, Number(plan.priceCoins) || 0);
    if (price < 1) return res.status(409).json({ success: false, error: "PLAN_PRICE_NOT_CONFIGURED" });

    const user = await User.findOneAndUpdate(
      { _id: req.user._id, isBlocked: false, coinBalance: { $gte: price } },
      { $inc: { coinBalance: -price }, $set: {
        planId: plan._id, planSlug: plan.slug,
        planExpiresAt: new Date(Date.now() + (Number(plan.durationDays) || 30) * 86400000)
      } },
      { new: true }
    );
    if (!user) return res.status(409).json({ success: false, error: "INSUFFICIENT_COINS", message: "Not enough coins to purchase this plan." });

    await CoinTransaction.create({
      userId: user._id, type: "debit", amount: price,
      reason: "Purchased " + plan.name + " plan",
      balanceAfter: user.coinBalance
    });

    res.json({
      success: true, message: plan.name + " activated.",
      user: { plan: user.planSlug, planExpiresAt: user.planExpiresAt, coinBalance: user.coinBalance }
    });
  } catch (error) { next(error); }
});

export default router;

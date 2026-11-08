import { Router } from "express";
import ApiCategory from "../models/ApiCategory.js";
import ApiEndpoint from "../models/ApiEndpoint.js";
import Announcement from "../models/Announcement.js";
import mongoose from "mongoose";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({
    success: true,
    service: "SHAN API HUB",
    status: mongoose.connection.readyState === 1 ? "operational" : "degraded",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    uptimeSeconds: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString()
  });
});

router.get("/categories", async (_req, res, next) => {
  try {
    const categories = await ApiCategory.find({ enabled: true }).select("name slug description access").sort({ name: 1 }).lean();
    res.json({ success: true, categories });
  } catch (error) { next(error); }
});

router.get("/docs/:category", async (req, res, next) => {
  try {
    const category = await ApiCategory.findOne({ slug: String(req.params.category).toLowerCase(), enabled: true }).lean();
    if (!category) return res.status(404).json({ success: false, error: "CATEGORY_NOT_FOUND" });
    const endpoints = await ApiEndpoint.find({ categoryId: category._id, enabled: true })
      .select("name action method description parameters exampleRequest exampleResponse requiresPlan")
      .sort({ name: 1 }).lean();
    res.json({ success: true, category: { name: category.name, slug: category.slug, description: category.description, access: category.access }, endpoints });
  } catch (error) { next(error); }
});

router.get("/announcements", async (_req, res, next) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      active: true, $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }
      ]
    }).select("title message createdAt").sort({ createdAt: -1 }).limit(10).lean();
    res.json({ success: true, announcements });
  } catch (error) { next(error); }
});

export default router;

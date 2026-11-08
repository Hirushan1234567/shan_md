import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import ApiCategory from "../models/ApiCategory.js";
import ApiEndpoint from "../models/ApiEndpoint.js";
import ContentItem from "../models/ContentItem.js";
import Movie from "../modules/movies/model.js";
import Announcement from "../models/Announcement.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import ApiKey from "../models/ApiKey.js";
import CoinTransaction from "../models/CoinTransaction.js";
import SupportTicket from "../models/SupportTicket.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const slugify = value => String(value || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

router.get("/overview", async (_req, res, next) => {
  try {
    const [users, categories, endpoints, movies, activeKeys] = await Promise.all([
      User.countDocuments(), ApiCategory.countDocuments(), ApiEndpoint.countDocuments(),
      Movie.countDocuments(), ApiKey.countDocuments({ isActive: true })
    ]);
    res.json({ success: true, stats: { users, categories, endpoints, movies, activeKeys } });
  } catch (error) { next(error); }
});

router.get("/users", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const users = await User.find().select("name email role planSlug coinBalance requestsUsed isBlocked createdAt")
      .sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
    res.json({ success: true, users, page });
  } catch (error) { next(error); }
});

router.patch("/users/:id", async (req, res, next) => {
  try {
    const update = {};
    if (typeof req.body.isBlocked === "boolean") update.isBlocked = req.body.isBlocked;
    if (typeof req.body.role === "string" && ["user", "admin"].includes(req.body.role)) update.role = req.body.role;
    if (req.body.planSlug) {
      const plan = await Plan.findOne({ slug: String(req.body.planSlug).toLowerCase(), isActive: true });
      if (!plan) return res.status(400).json({ success: false, error: "INVALID_PLAN" });
      update.planId = plan._id;
      update.planSlug = plan.slug;
      update.planExpiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * 86400000) : null;
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
      .select("name email role planSlug planExpiresAt coinBalance isBlocked");
    if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

router.post("/users/:id/coins", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const reason = String(req.body.reason || "Admin coin adjustment").trim().slice(0, 160);
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) {
      return res.status(400).json({ success: false, error: "INVALID_AMOUNT" });
    }
    const filter = { _id: req.params.id };
    if (amount < 0) filter.coinBalance = { $gte: Math.abs(amount) };
    const user = await User.findOneAndUpdate(filter, { $inc: { coinBalance: amount } }, { new: true })
      .select("name email coinBalance");
    if (!user) return res.status(404).json({ success: false, error: amount < 0 ? "USER_NOT_FOUND_OR_INSUFFICIENT_COINS" : "USER_NOT_FOUND" });
    const transaction = await CoinTransaction.create({
      userId: user._id, type: amount > 0 ? "credit" : "debit",
      amount: Math.abs(amount), reason, balanceAfter: user.coinBalance
    });
    res.json({ success: true, user, transaction });
  } catch (error) { next(error); }
});

router.get("/plans", async (_req, res, next) => {
  try { res.json({ success: true, plans: await Plan.find().sort({ priceCoins: 1 }).lean() }); }
  catch (error) { next(error); }
});

router.post("/plans", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 80);
    const slug = slugify(req.body.slug || name);
    if (!name || !slug) return res.status(400).json({ success: false, error: "NAME_REQUIRED" });
    const plan = await Plan.create({
      name, slug, priceCoins: Math.max(0, Number(req.body.priceCoins) || 0),
      durationDays: req.body.durationDays == null ? null : Math.max(1, Number(req.body.durationDays) || 30),
      requestLimit: Math.max(0, Number(req.body.requestLimit) || 0),
      unlimited: req.body.unlimited === true,
      allowedCategories: Array.isArray(req.body.allowedCategories) ? req.body.allowedCategories.map(String) : [],
      isActive: req.body.isActive !== false
    });
    res.status(201).json({ success: true, plan });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, error: "PLAN_SLUG_EXISTS" });
    next(error);
  }
});

router.patch("/plans/:id", async (req, res, next) => {
  try {
    const update = {};
    for (const field of ["name", "priceCoins", "durationDays", "requestLimit", "unlimited", "allowedCategories", "isActive"]) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    const plan = await Plan.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND" });
    res.json({ success: true, plan });
  } catch (error) { next(error); }
});

router.get("/categories", async (_req, res, next) => {
  try { res.json({ success: true, categories: await ApiCategory.find().sort({ createdAt: -1 }).lean() }); }
  catch (error) { next(error); }
});

router.post("/categories", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 80);
    const slug = slugify(req.body.slug || name);
    if (!name || !slug) return res.status(400).json({ success: false, error: "NAME_REQUIRED" });
    const category = await ApiCategory.create({
      name, slug, description: String(req.body.description || "").slice(0, 500),
      access: req.body.access === "premium" ? "premium" : "free",
      enabled: req.body.enabled !== false
    });
    const defaultEndpoints = [
      { name: "List " + name, action: "list", description: "List published items in this category.", parameters: [{ name: "page", type: "number" }, { name: "limit", type: "number" }] },
      { name: "Search " + name, action: "search", description: "Search published items in this category.", parameters: [{ name: "q", type: "string" }, { name: "genre", type: "string" }, { name: "year", type: "number" }, { name: "page", type: "number" }, { name: "limit", type: "number" }] },
      { name: name + " detail", action: "detail", description: "Get one published item by id or title.", parameters: [{ name: "id", type: "string" }, { name: "title", type: "string" }] }
    ];
    await ApiEndpoint.insertMany(defaultEndpoints.map(endpoint => ({
      ...endpoint, categoryId: category._id, method: "GET",
      parameters: [], requiresPlan: "free", enabled: true
    })));
    res.status(201).json({ success: true, category });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, error: "SLUG_EXISTS" });
    next(error);
  }
});

router.patch("/categories/:id", async (req, res, next) => {
  try {
    const update = {};
    for (const field of ["name", "description"]) if (typeof req.body[field] === "string") update[field] = req.body[field].trim();
    if (typeof req.body.enabled === "boolean") update.enabled = req.body.enabled;
    if (["free", "premium"].includes(req.body.access)) update.access = req.body.access;
    if (req.body.slug) update.slug = slugify(req.body.slug);
    const category = await ApiCategory.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!category) return res.status(404).json({ success: false, error: "CATEGORY_NOT_FOUND" });
    res.json({ success: true, category });
  } catch (error) { next(error); }
});

router.delete("/categories/:id", async (req, res, next) => {
  try {
    const category = await ApiCategory.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ success: false, error: "CATEGORY_NOT_FOUND" });
    await ApiEndpoint.deleteMany({ categoryId: category._id });
    res.json({ success: true, message: "Category and its endpoint definitions deleted." });
  } catch (error) { next(error); }
});

router.get("/endpoints", async (_req, res, next) => {
  try {
    const endpoints = await ApiEndpoint.find().populate("categoryId", "name slug").sort({ createdAt: -1 }).lean();
    res.json({ success: true, endpoints });
  } catch (error) { next(error); }
});

router.post("/endpoints", async (req, res, next) => {
  try {
    const category = await ApiCategory.findById(req.body.categoryId);
    if (!category) return res.status(400).json({ success: false, error: "INVALID_CATEGORY" });
    const action = slugify(req.body.action);
    if (!action || !req.body.name) return res.status(400).json({ success: false, error: "NAME_AND_ACTION_REQUIRED" });
    const endpoint = await ApiEndpoint.create({
      categoryId: category._id, name: String(req.body.name).trim().slice(0, 100),
      action, method: req.body.method === "POST" ? "POST" : "GET",
      description: String(req.body.description || "").slice(0, 1000),
      parameters: Array.isArray(req.body.parameters) ? req.body.parameters.slice(0, 30) : [],
      exampleRequest: req.body.exampleRequest || {}, exampleResponse: req.body.exampleResponse || {},
      requiresPlan: req.body.requiresPlan === "premium" ? "premium" : "free",
      enabled: req.body.enabled !== false
    });
    res.status(201).json({ success: true, endpoint });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, error: "ACTION_EXISTS" });
    next(error);
  }
});

router.patch("/endpoints/:id", async (req, res, next) => {
  try {
    const update = {};
    for (const field of ["name", "description"]) if (typeof req.body[field] === "string") update[field] = req.body[field].trim();
    if (typeof req.body.enabled === "boolean") update.enabled = req.body.enabled;
    if (["GET", "POST"].includes(req.body.method)) update.method = req.body.method;
    if (["free", "premium"].includes(req.body.requiresPlan)) update.requiresPlan = req.body.requiresPlan;
    if (Array.isArray(req.body.parameters)) update.parameters = req.body.parameters.slice(0, 30);
    if (req.body.exampleRequest) update.exampleRequest = req.body.exampleRequest;
    if (req.body.exampleResponse) update.exampleResponse = req.body.exampleResponse;
    const endpoint = await ApiEndpoint.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!endpoint) return res.status(404).json({ success: false, error: "ENDPOINT_NOT_FOUND" });
    res.json({ success: true, endpoint });
  } catch (error) { next(error); }
});

router.delete("/endpoints/:id", async (req, res, next) => {
  try {
    const endpoint = await ApiEndpoint.findByIdAndDelete(req.params.id);
    if (!endpoint) return res.status(404).json({ success: false, error: "ENDPOINT_NOT_FOUND" });
    res.json({ success: true, message: "Endpoint deleted." });
  } catch (error) { next(error); }
});

router.get("/content", async (req, res, next) => {
  try {
    const categorySlug = String(req.query.category || "").toLowerCase();
    const filter = categorySlug ? { categorySlug } : {};
    const items = await ContentItem.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const movies = categorySlug === "movies" || !categorySlug
      ? await Movie.find(categorySlug ? {} : {}).sort({ createdAt: -1 }).limit(100).lean() : [];
    res.json({ success: true, items, movies });
  } catch (error) { next(error); }
});

router.post("/content", async (req, res, next) => {
  try {
    const categorySlug = slugify(req.body.categorySlug);
    const title = String(req.body.title || "").trim().slice(0, 180);
    if (!categorySlug || !title) return res.status(400).json({ success: false, error: "CATEGORY_AND_TITLE_REQUIRED" });
    const data = {
      title, year: Number(req.body.year) || undefined,
      genres: Array.isArray(req.body.genres) ? req.body.genres.slice(0, 20).map(String) : [],
      description: String(req.body.description || "").slice(0, 10000),
      poster: String(req.body.poster || "").slice(0, 1000),
      trailerUrl: String(req.body.trailerUrl || "").slice(0, 1000),
      links: Array.isArray(req.body.links) ? req.body.links.slice(0, 30) : [],
      customFields: req.body.customFields && typeof req.body.customFields === "object" && !Array.isArray(req.body.customFields) ? req.body.customFields : {},
      published: req.body.published === true, createdBy: req.user._id
    };
    if (categorySlug === "movies") {
      const movie = await Movie.create(data);
      return res.status(201).json({ success: true, item: movie });
    }
    const item = await ContentItem.create({ ...data, categorySlug, customFields: req.body.customFields || {} });
    res.status(201).json({ success: true, item });
  } catch (error) { next(error); }
});

router.patch("/content/:id", async (req, res, next) => {
  try {
    const categorySlug = slugify(req.body.categorySlug || req.query.category);
    const Model = categorySlug === "movies" ? Movie : ContentItem;
    const update = {};
    for (const field of ["title", "description", "poster", "trailerUrl"]) if (typeof req.body[field] === "string") update[field] = req.body[field];
    for (const field of ["year", "genres", "links", "published", "customFields"]) if (req.body[field] !== undefined) update[field] = req.body[field];
    if (Model === ContentItem && categorySlug) update.categorySlug = categorySlug;
    const item = await Model.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, error: "CONTENT_NOT_FOUND" });
    res.json({ success: true, item });
  } catch (error) { next(error); }
});

router.delete("/content/:id", async (req, res, next) => {
  try {
    const categorySlug = slugify(req.query.category);
    const Model = categorySlug === "movies" ? Movie : ContentItem;
    const item = await Model.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "CONTENT_NOT_FOUND" });
    res.json({ success: true, message: "Content deleted." });
  } catch (error) { next(error); }
});

router.get("/support/tickets", async (req, res, next) => {
  try {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    const tickets = await SupportTicket.find(filter)
      .populate("userId", "name email").sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, tickets });
  } catch (error) { next(error); }
});

router.patch("/support/tickets/:id", async (req, res, next) => {
  try {
    const update = {};
    if (["open", "in_progress", "resolved"].includes(req.body.status)) update.status = req.body.status;
    if (typeof req.body.adminReply === "string") {
      update.adminReply = req.body.adminReply.trim().slice(0, 5000);
      update.repliedAt = new Date();
    }
    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true, runValidators: true }
    ).populate("userId", "name email");
    if (!ticket) return res.status(404).json({ success: false, error: "TICKET_NOT_FOUND" });
    res.json({ success: true, ticket });
  } catch (error) { next(error); }
});

router.get("/announcements", async (_req, res, next) => {
  try { res.json({ success: true, announcements: await Announcement.find().sort({ createdAt: -1 }).lean() }); }
  catch (error) { next(error); }
});

router.post("/announcements", async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim().slice(0, 120);
    const message = String(req.body.message || "").trim().slice(0, 2000);
    if (!title || !message) return res.status(400).json({ success: false, error: "TITLE_AND_MESSAGE_REQUIRED" });
    const announcement = await Announcement.create({ title, message, active: req.body.active !== false, startsAt: req.body.startsAt || null, endsAt: req.body.endsAt || null });
    res.status(201).json({ success: true, announcement });
  } catch (error) { next(error); }
});

router.patch("/announcements/:id", async (req, res, next) => {
  try {
    const update = {};
    for (const field of ["title", "message", "active", "startsAt", "endsAt"]) if (req.body[field] !== undefined) update[field] = req.body[field];
    const announcement = await Announcement.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!announcement) return res.status(404).json({ success: false, error: "ANNOUNCEMENT_NOT_FOUND" });
    res.json({ success: true, announcement });
  } catch (error) { next(error); }
});

router.delete("/announcements/:id", async (req, res, next) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, error: "ANNOUNCEMENT_NOT_FOUND" });
    res.json({ success: true, message: "Announcement deleted." });
  } catch (error) { next(error); }
});

export default router;

import ContentItem from "./model.js";

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listContent(req, res, next) {
  try {
    const categorySlug = String(req.params.category || "").toLowerCase();
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const filter = { categorySlug, published: true };
    if (req.query.q) filter.title = { $regex: escapeRegex(String(req.query.q).trim().slice(0, 80)), $options: "i" };
    if (req.query.genre) filter.genres = String(req.query.genre).trim().slice(0, 40);
    if (req.query.year && /^\d{4}$/.test(String(req.query.year))) filter.year = Number(req.query.year);
    const [items, total] = await Promise.all([
      ContentItem.find(filter).select("-__v").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ContentItem.countDocuments(filter)
    ]);
    res.json({ success: true, creator: "@SHAN", data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
}

export async function getContent(req, res, next) {
  try {
    const categorySlug = String(req.params.category || "").toLowerCase();
    const id = String(req.query.id || "").trim();
    const title = String(req.query.title || "").trim().slice(0, 180);
    if (!id && !title) return res.status(400).json({ success: false, error: "MISSING_PARAMETER", message: "Provide id or title." });
    const filter = { categorySlug, published: true };
    if (id) {
      if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ success: false, error: "INVALID_ID", message: "Content id is invalid." });
      filter._id = id;
    } else {
      filter.title = { $regex: escapeRegex(title), $options: "i" };
    }
    const item = await ContentItem.findOne(filter).select("-__v").lean();
    if (!item) return res.status(404).json({ success: false, error: "NOT_FOUND", message: "Content item not found." });
    res.json({ success: true, creator: "@SHAN", data: item });
  } catch (error) { next(error); }
}

import Movie from "./model.js";

export async function listMovies(req, res, next) {
  try {
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const filter = { published: true };
    if (req.query.year && /^\d{4}$/.test(String(req.query.year))) filter.year = Number(req.query.year);
    if (req.query.genre) filter.genres = String(req.query.genre).trim().slice(0, 40);
    if (req.query.q) filter.title = { $regex: String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const [items, total] = await Promise.all([
      Movie.find(filter).select("-__v").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Movie.countDocuments(filter)
    ]);
    res.json({
      success: true,
      creator: "@SHAN",
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) { next(error); }
}

export async function getMovie(req, res, next) {
  try {
    const id = String(req.query.id || "").trim();
    const title = String(req.query.title || "").trim().slice(0, 180);
    if (!id && !title) {
      return res.status(400).json({ success: false, error: "MISSING_PARAMETER", message: "Provide id or title." });
    }
    const filter = { published: true };
    if (id) {
      if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ success: false, error: "INVALID_ID", message: "Movie id is invalid." });
      filter._id = id;
    } else {
      filter.title = { $regex: title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    const movie = await Movie.findOne(filter).select("-__v").lean();
    if (!movie) return res.status(404).json({ success: false, error: "NOT_FOUND", message: "Movie not found." });
    res.json({ success: true, creator: "@SHAN", data: movie });
  } catch (error) { next(error); }
}

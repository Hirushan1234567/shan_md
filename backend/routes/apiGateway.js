import { Router } from "express";
import { requireApiKey, apiKeyRateLimit } from "../middleware/apiKeyAuth.js";
import ApiCategory from "../models/ApiCategory.js";
import ApiEndpoint from "../models/ApiEndpoint.js";
import moviesRouter from "../modules/movies/routes.js";

const router = Router();
router.use(requireApiKey, apiKeyRateLimit);

router.all("/:category/:action", async (req, res, next) => {
  try {
    const categorySlug = String(req.params.category || "").toLowerCase();
    const action = String(req.params.action || "").toLowerCase();
    const category = await ApiCategory.findOne({ slug: categorySlug, enabled: true }).lean();
    if (!category) return res.status(404).json({ success: false, error: "CATEGORY_NOT_FOUND", message: "API category not found or disabled." });

    const endpoint = await ApiEndpoint.findOne({
      categoryId: category._id, action, method: req.method, enabled: true
    }).lean();
    if (!endpoint) return res.status(404).json({ success: false, error: "ENDPOINT_NOT_FOUND", message: "API endpoint not found or disabled." });

    const paid = ["premium", "membership"].includes(req.apiUser.planSlug);
    if ((category.access === "premium" || endpoint.requiresPlan === "premium") && !paid) {
      return res.status(403).json({ success: false, error: "PREMIUM_REQUIRED", message: "This endpoint requires a Premium or Membership plan." });
    }

    for (const parameter of endpoint.parameters || []) {
      if (parameter.required && req.method === "GET" && (req.query[parameter.name] === undefined || req.query[parameter.name] === "")) {
        return res.status(400).json({ success: false, error: "MISSING_PARAMETER", message: parameter.name + " is required." });
      }
    }

    if (categorySlug === "movies") {
      return moviesRouter.handle(req, res, next);
    }

    return res.status(501).json({
      success: false, error: "MODULE_NOT_IMPLEMENTED",
      message: "This category is configured but its data module is not installed yet."
    });
  } catch (error) { next(error); }
});

export default router;

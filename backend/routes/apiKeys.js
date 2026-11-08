import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import ApiKey from "../models/ApiKey.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user._id })
      .select("name prefix isActive lastUsedAt createdAt")
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, keys });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "My API Key").trim().slice(0, 60);
    const activeCount = await ApiKey.countDocuments({ userId: req.user._id, isActive: true });
    if (activeCount >= 5) {
      return res.status(409).json({ success: false, error: "KEY_LIMIT_REACHED", message: "You can have up to 5 active API keys." });
    }

    const rawKey = "myapi_" + crypto.randomBytes(16).toString("hex");
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const key = await ApiKey.create({
      userId: req.user._id, name: name || "My API Key",
      prefix: rawKey.slice(0, 13), keyHash, isActive: true
    });

    res.status(201).json({
      success: true,
      message: "Save this key now. It will not be shown again.",
      apiKey: rawKey,
      key: { id: String(key._id), name: key.name, prefix: key.prefix, createdAt: key.createdAt }
    });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const key = await ApiKey.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, isActive: true },
      { $set: { isActive: false } },
      { new: true }
    ).select("name prefix isActive");
    if (!key) return res.status(404).json({ success: false, error: "KEY_NOT_FOUND", message: "Active API key not found." });
    res.json({ success: true, message: "API key revoked.", key });
  } catch (error) { next(error); }
});

export default router;

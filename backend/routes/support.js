import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import SupportTicket from "../models/SupportTicket.js";

const router = Router();
router.use(requireAuth);

router.get("/tickets", async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, tickets });
  } catch (error) { next(error); }
});

router.post("/tickets", async (req, res, next) => {
  try {
    const subject = String(req.body.subject || "").trim().slice(0, 140);
    const message = String(req.body.message || "").trim().slice(0, 5000);
    if (!subject || message.length < 10) {
      return res.status(400).json({ success: false, error: "INVALID_TICKET", message: "Add a subject and a message of at least 10 characters." });
    }
    const ticket = await SupportTicket.create({ userId: req.user._id, subject, message });
    res.status(201).json({ success: true, ticket });
  } catch (error) { next(error); }
});

export default router;

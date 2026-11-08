import mongoose from "mongoose";

const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 140 },
  message: { type: String, required: true, trim: true, maxlength: 5000 },
  status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open", index: true },
  adminReply: { type: String, default: "", maxlength: 5000 },
  repliedAt: { type: Date, default: null }
}, { timestamps: true });

supportTicketSchema.index({ userId: 1, createdAt: -1 });
export default mongoose.models.SupportTicket || mongoose.model("SupportTicket", supportTicketSchema);

import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  active: { type: Boolean, default: true, index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.models.Announcement || mongoose.model("Announcement", announcementSchema);

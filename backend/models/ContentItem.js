import mongoose from "mongoose";

const contentItemSchema = new mongoose.Schema({
  categorySlug: { type: String, required: true, lowercase: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  year: { type: Number, min: 1800, max: 2200 },
  genres: { type: [String], default: [] },
  description: { type: String, default: "", maxlength: 10000 },
  poster: { type: String, default: "" },
  trailerUrl: { type: String, default: "" },
  links: { type: [mongoose.Schema.Types.Mixed], default: [] },
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  published: { type: Boolean, default: false, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

contentItemSchema.index({ categorySlug: 1, published: 1, createdAt: -1 });
export default mongoose.models.ContentItem || mongoose.model("ContentItem", contentItemSchema);

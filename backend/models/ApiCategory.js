import mongoose from "mongoose";

const apiCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, default: "", maxlength: 500 },
  access: { type: String, enum: ["free", "premium"], default: "free" },
  enabled: { type: Boolean, default: true, index: true }
}, { timestamps: true });

export default mongoose.models.ApiCategory || mongoose.model("ApiCategory", apiCategorySchema);

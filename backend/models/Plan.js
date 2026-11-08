import mongoose from "mongoose";

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  priceCoins: { type: Number, required: true, min: 0, default: 0, validate: Number.isInteger },
  durationDays: { type: Number, default: null, min: 1, validate: value => value == null || Number.isInteger(value) },
  requestLimit: { type: Number, default: 200, min: 0, validate: Number.isInteger },
  unlimited: { type: Boolean, default: false },
  allowedCategories: { type: [String], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.models.Plan || mongoose.model("Plan", planSchema);

import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["user", "admin"], default: "user", index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", default: null },
  planSlug: { type: String, default: "free", index: true },
  planExpiresAt: { type: Date, default: null },
  requestsUsed: { type: Number, default: 0, min: 0 },
  coinBalance: { type: Number, default: 0, min: 0 },
  isVerified: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false, index: true }
}, { timestamps: true });

export default mongoose.models.User || mongoose.model("User", userSchema);

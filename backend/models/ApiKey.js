import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, default: "Default key", trim: true, maxlength: 60 },
  prefix: { type: String, required: true, maxlength: 16 },
  keyHash: { type: String, required: true, unique: true, select: false },
  isActive: { type: Boolean, default: true, index: true },
  lastUsedAt: { type: Date, default: null }
}, { timestamps: true });

apiKeySchema.index({ userId: 1, isActive: 1 });
export default mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);

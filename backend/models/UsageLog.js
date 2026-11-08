import mongoose from "mongoose";

const usageLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", index: true },
  category: { type: String, trim: true, index: true },
  action: { type: String, trim: true },
  method: { type: String, default: "GET" },
  statusCode: { type: Number, default: 200 },
  responseTimeMs: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

usageLogSchema.index({ userId: 1, createdAt: -1 });
export default mongoose.models.UsageLog || mongoose.model("UsageLog", usageLogSchema);

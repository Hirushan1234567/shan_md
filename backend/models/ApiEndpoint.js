import mongoose from "mongoose";

const parameterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: "string" },
  required: { type: Boolean, default: false },
  description: { type: String, default: "" }
}, { _id: false });

const apiEndpointSchema = new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiCategory", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  action: { type: String, required: true, lowercase: true, trim: true },
  method: { type: String, enum: ["GET", "POST"], default: "GET" },
  description: { type: String, default: "", maxlength: 1000 },
  parameters: { type: [parameterSchema], default: [] },
  exampleRequest: { type: mongoose.Schema.Types.Mixed, default: {} },
  exampleResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
  requiresPlan: { type: String, enum: ["free", "premium"], default: "free" },
  enabled: { type: Boolean, default: true, index: true }
}, { timestamps: true });

apiEndpointSchema.index({ categoryId: 1, action: 1 }, { unique: true });
export default mongoose.models.ApiEndpoint || mongoose.model("ApiEndpoint", apiEndpointSchema);

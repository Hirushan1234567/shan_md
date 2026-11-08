import mongoose from "mongoose";

const coinTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["credit", "debit"], required: true },
  amount: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, trim: true, maxlength: 240 },
  balanceAfter: { type: Number, required: true, min: 0 }
}, { timestamps: true });

export default mongoose.models.CoinTransaction || mongoose.model("CoinTransaction", coinTransactionSchema);

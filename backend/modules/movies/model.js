import mongoose from "mongoose";

const movieSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  year: { type: Number, min: 1800, max: 2200 },
  genres: { type: [String], default: [] },
  description: { type: String, default: "", maxlength: 10000 },
  poster: { type: String, default: "" },
  trailerUrl: { type: String, default: "" },
  links: { type: [mongoose.Schema.Types.Mixed], default: [] },
  published: { type: Boolean, default: false, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

movieSchema.index({ title: "text", genres: 1, year: -1 });
export default mongoose.models.Movie || mongoose.model("Movie", movieSchema);

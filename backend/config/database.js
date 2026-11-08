import mongoose from "mongoose";

export async function connectDatabase() {
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) throw new Error("MONGODB_URI is required");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    autoIndex: process.env.NODE_ENV !== "production"
  });

  console.log("[database] MongoDB connected");
  return mongoose.connection;
}

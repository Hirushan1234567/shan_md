import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDatabase } from "../config/database.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import ApiCategory from "../models/ApiCategory.js";
import ApiEndpoint from "../models/ApiEndpoint.js";

async function main() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  const name = String(process.env.ADMIN_NAME || "SHAN API HUB Admin").trim();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Set a valid ADMIN_EMAIL in backend/.env");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

  await connectDatabase();

  const planSeeds = [
    { name: "Free", slug: "free", priceCoins: 0, durationDays: null, requestLimit: 200, unlimited: false, allowedCategories: [], isActive: true },
    { name: "Premium", slug: "premium", priceCoins: Math.max(1, Number(process.env.PREMIUM_PLAN_COINS) || 500), durationDays: 30, requestLimit: 0, unlimited: true, allowedCategories: [], isActive: true },
    { name: "Membership", slug: "membership", priceCoins: Math.max(1, Number(process.env.MEMBERSHIP_PLAN_COINS) || 1000), durationDays: 30, requestLimit: 0, unlimited: true, allowedCategories: [], isActive: true }
  ];
  for (const plan of planSeeds) {
    await Plan.updateOne({ slug: plan.slug }, { $set: plan }, { upsert: true });
  }

  const moviesCategory = await ApiCategory.findOneAndUpdate(
    { slug: "movies" },
    { $set: { name: "Movies", slug: "movies", description: "Search and browse admin-published movie metadata.", access: "free", enabled: true } },
    { upsert: true, new: true }
  );
  const movieEndpoints = [
    { name: "List Movies", action: "list", method: "GET", description: "List published movies with pagination.", parameters: [{ name: "page", type: "number" }, { name: "limit", type: "number" }], requiresPlan: "free" },
    { name: "Search Movies", action: "search", method: "GET", description: "Search published movies by title, genre or year.", parameters: [{ name: "q", type: "string" }, { name: "genre", type: "string" }, { name: "year", type: "number" }], requiresPlan: "free" },
    { name: "Movie Detail", action: "detail", method: "GET", description: "Get one published movie by id or title.", parameters: [{ name: "id", type: "string" }, { name: "title", type: "string" }], requiresPlan: "free" }
  ];
  for (const endpoint of movieEndpoints) {
    await ApiEndpoint.updateOne(
      { categoryId: moviesCategory._id, action: endpoint.action },
      { $set: { ...endpoint, categoryId: moviesCategory._id, enabled: true } },
      { upsert: true }
    );
  }

  const freePlan = await Plan.findOne({ slug: "free" });
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne(
    { email },
    {
      $set: { name, passwordHash, role: "admin", planId: freePlan._id, planSlug: "free", isBlocked: false },
      $setOnInsert: { coinBalance: 0, isVerified: true }
    },
    { upsert: true }
  );

  console.log("Admin account and initial plans are ready.");
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error("[seed-admin]", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});

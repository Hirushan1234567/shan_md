import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDatabase } from "../config/database.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";

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

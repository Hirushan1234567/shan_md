import { MongoClient } from "mongodb";
import { createHash, randomBytes } from "node:crypto";

let clientPromise;

export async function db() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect();
  }
  const client = await clientPromise;
  return client.db();
}

export const sha = value =>
  createHash("sha256").update(value).digest("hex");

export function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

export function setCookie(res, value, maxAge) {
  res.setHeader("Set-Cookie",
    `shan_api_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

export function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.end();
}

export function config() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    throw new Error("Google OAuth environment variables are missing");
  }
  return { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL };
}

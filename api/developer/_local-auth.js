import { MongoClient } from "mongodb";
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
let clientPromise;

export async function db() {
  if (!clientPromise) {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
    const client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect();
  }
  return (await clientPromise).db();
}

export const hashToken = value =>
  createHash("sha256").update(value).digest("hex");

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return salt + ":" + Buffer.from(key).toString("hex");
}

export async function verifyPassword(password, stored) {
  try {
    const [salt, hex] = stored.split(":");
    const expected = Buffer.from(hex, "hex");
    const actual = Buffer.from(await scrypt(password, salt, 64));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie",
    `shan_api_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}

export function readCookie(req) {
  const item = String(req.headers.cookie || "").split(";")
    .map(x => x.trim()).find(x => x.startsWith("shan_api_session="));
  if (!item) return "";
  try { return decodeURIComponent(item.slice("shan_api_session=".length)); }
  catch { return ""; }
}

export async function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const database = await db();
  const session = await database.collection("apiSessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;
  return database.collection("apiDevelopers").findOne(
    { email: session.email },
    { projection: { passwordHash: 0, _id: 0 } }
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie",
    "shan_api_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

export function adminEmails() {
  return String(process.env.API_ADMIN_EMAILS || "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

import crypto from "crypto";
import { aux } from "./db.js";

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

/** One-time password-reset token. Only the SHA-256 hash is stored. */
export async function createReset(collection, uid, ttlMs = 30 * 60 * 1000) {
  const col = await aux(collection);
  const token = crypto.randomBytes(32).toString("base64url");
  await col.deleteMany({ uid });
  await col.insertOne({ _id: sha(token), uid, exp: Date.now() + ttlMs });
  return token;
}

/** Returns the uid if the token is valid (and burns it), otherwise null. */
export async function consumeReset(collection, token) {
  const col = await aux(collection);
  const id = sha(token || "");
  const doc = await col.findOne({ _id: id });
  if (!doc || doc.exp < Date.now()) return null;
  const r = await col.deleteOne({ _id: id });
  return r.deletedCount === 1 ? doc.uid : null;
}

/** Sends mail through Resend if RESEND_API_KEY + MAIL_FROM are set. Returns true when sent. */
export async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(8000)
    });
    return r.ok;
  } catch { return false; }
}

export const originOf = req =>
  `${String(req.headers["x-forwarded-proto"] || "https").split(",")[0]}://${req.headers["x-forwarded-host"] || req.headers.host}`;

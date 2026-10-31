import crypto from "crypto";
import { aux, rateLimited } from "./db.js";
import { HttpError, hmac, safeEqual } from "./auth.js";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const part = () => Array.from(crypto.randomBytes(4), b => ALPHA[b % ALPHA.length]).join("");
export const normKey = k => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashKey = (number, key) => hmac(`key:${number}:${normKey(key)}`);

/**
 * Creates a new Bot Key after successful WhatsApp pairing.
 * Only the hash is stored; plaintext is returned once to the pairing browser.
 */
export async function issueKey(number) {
  const key = `SHAN-${part()}-${part()}`;
  const col = await aux("bot_keys");

  await col.replaceOne(
    { _id: number },
    { _id: number, h: hashKey(number, key), created: Date.now() },
    { upsert: true }
  );

  return key;
}

export async function checkKey(number, key) {
  if (await rateLimited(`keytry:${number}`, 8, 10 * 60 * 1000)) {
    throw new HttpError(429, "Too many wrong keys. Try again in 10 minutes.");
  }

  const doc = await (await aux("bot_keys")).findOne({ _id: number });

  if (!doc) {
    throw new HttpError(404, "No Bot Key exists. Link your WhatsApp on the home page to generate one.");
  }

  if (!normKey(key) || !safeEqual(hashKey(number, key), doc.h)) {
    throw new HttpError(400, "Wrong Bot Key.");
  }
}

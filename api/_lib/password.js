import crypto from "crypto";

/** scrypt hash: "salt:hash" (hex). Plain password කවදාවත් save කරන්නේ නෑ. */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(String(pw), salt, 32).toString("hex");
}

export function checkPassword(pw, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(h, "hex");
  const b = crypto.scryptSync(String(pw), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

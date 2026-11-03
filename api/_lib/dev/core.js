import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { aux, rateLimited, clientIp } from "../db.js";
import { HttpError } from "../auth.js";
import { seedDefaults } from "./seed.js";

export { HttpError, rateLimited, clientIp };
export const DAY = 864e5;
export const T = name => aux("dev_" + name); // every Developer Platform collection is prefixed dev_
export function safeCompare(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");
export const rid = (n = 8) => crypto.randomBytes(n).toString("hex");

/* ---------- validation ---------- */
export const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const int = (v, min, max, def) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export function need(cond, msg, status = 400) { if (!cond) throw new HttpError(status, msg); }
export const validUsername = u => /^[A-Za-z0-9_.-]{3,24}$/.test(u);
export const validEmail = e => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function validPassword(p) {
  need(typeof p === "string" && p.length >= 8 && p.length <= 64, "Password must be 8-64 characters.");
  need(/[A-Za-z]/.test(p) && /\d/.test(p), "Password must contain at least one letter and one number.");
}
export const bool = v => v === true || v === "true" || v === 1 || v === "1";

/* ---------- passwords (scrypt, same "salt:hash" format as the Coins site) ---------- */
const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(String(pw), salt, 32, (e, k) => (e ? rej(e) : res(k))));
export async function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(pw, salt)).toString("hex");
}
export async function checkPw(pw, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(h, "hex"), b = await scrypt(pw, salt);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const DUMMY_HASH = "00".repeat(16) + ":" + "00".repeat(32);

/* ---------- sessions: random token in an HttpOnly cookie, only its hash is stored ---------- */
export const COOKIE = { user: "shan_dev", admin: "shan_adm" };
const TTL = { user: 14 * DAY, admin: 8 * 36e5 };

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
function setCookie(req, res, name, val, maxAgeSec) {
  const insecure = String(req.headers["x-forwarded-proto"] || "https").split(",")[0] === "http";
  const c = `${name}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeSec)}${insecure ? "" : "; Secure"}`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}
export async function startSession(req, res, kind, uid) {
  const token = crypto.randomBytes(32).toString("base64url");
  await (await T("sessions")).insertOne({
    _id: sha256(token), uid, kind, created: new Date(), exp: new Date(Date.now() + TTL[kind]),
    ip: clientIp(req), ua: str(req.headers["user-agent"], 200)
  });
  setCookie(req, res, COOKIE[kind], token, TTL[kind] / 1000);
}
export async function endSession(req, res, kind) {
  const token = parseCookies(req)[COOKIE[kind]];
  if (token) await (await T("sessions")).deleteOne({ _id: sha256(token) });
  setCookie(req, res, COOKIE[kind], "", 0);
}
async function getSession(req, kind) {
  const token = parseCookies(req)[COOKIE[kind]];
  if (!token) return null;
  const s = await (await T("sessions")).findOne({ _id: sha256(token) });
  return s && s.kind === kind && new Date(s.exp) > new Date() ? s : null;
}
export async function requireUser(req) {
  const s = await getSession(req, "user");
  if (!s) throw new HttpError(401, "Please log in.");
  const u = await (await T("users")).findOne({ _id: s.uid });
  if (!u) throw new HttpError(401, "Please log in.");
  if (u.status === "blocked") throw new HttpError(403, "Your account is blocked. Contact support.");
  return u;
}
export async function requireAdmin(req) {
  const s = await getSession(req, "admin");
  if (!s) throw new HttpError(401, "Admin login required.");
  const a = await (await T("admins")).findOne({ _id: s.uid });
  if (!a) throw new HttpError(401, "Admin login required.");
  return a;
}

/* ---------- settings / plans / activity ---------- */
export async function getSetting(key, def) {
  const d = await (await T("settings")).findOne({ _id: key });
  return d ? d.v : def;
}
export async function setSetting(key, v) {
  await (await T("settings")).updateOne({ _id: key }, { $set: { v } }, { upsert: true });
}
export async function getPlans() {
  const list = await (await T("plans")).find({}).toArray();
  return Object.fromEntries(list.map(p => [p._id, p]));
}
export const isPremium = u =>
  (u.plan === "premium1" || u.plan === "premium2") && (!u.planExpires || u.planExpires > Date.now());
export const effectivePlan = u => (isPremium(u) ? u.plan : "free");

export async function logActivity(uid, type, msg, ip = "") {
  try { await (await T("activity")).insertOne({ ts: new Date(), uid, type, msg: str(msg, 300), ip }); } catch { /* never break a request */ }
}
export async function peekLimited(key, max, windowMs) {
  const d = await (await aux("pair_ratelimit")).findOne({ _id: key });
  return !!d && Date.now() - d.start <= windowMs && d.count >= max;
}

/* ---------- IP rules + SSRF guard ---------- */
export const normIp = ip => { ip = String(ip || "").trim(); return ip.startsWith("::ffff:") ? ip.slice(7) : ip; };
const v4 = ip => ip.split(".").reduce((a, o) => ((a << 8) + Number(o)) >>> 0, 0);
export function ipMatches(ip, rule) {
  ip = normIp(ip); rule = String(rule).trim();
  if (!rule.includes("/")) return normIp(rule) === ip;
  const [base, bits] = rule.split("/"), n = Number(bits);
  if (!net.isIPv4(ip) || !net.isIPv4(base) || !(n >= 0 && n <= 32)) return false;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return (v4(ip) & mask) === (v4(base) & mask);
}
export function validIpRule(r) {
  const [base, bits] = String(r).trim().split("/");
  if (!net.isIP(base)) return false;
  return bits === undefined || (net.isIPv4(base) && /^\d{1,2}$/.test(bits) && +bits <= 32);
}
function isPrivate(ip) {
  ip = normIp(ip);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || /^(fc|fd|fe[89ab])/.test(l);
  }
  return true;
}
/** Only public http(s) hosts may be used as upstreams (blocks internal-network access). */
export async function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new HttpError(400, "Invalid URL."); }
  need(["http:", "https:"].includes(url.protocol), "Only http/https URLs are allowed.");
  if (process.env.DEV_ALLOW_PRIVATE_UPSTREAM === "1") return url; // local development / tests only
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }); }
  catch { throw new HttpError(400, "Could not resolve the host name."); }
  need(addrs.length && addrs.every(a => !isPrivate(a.address)), "The URL points to a private or internal address.");
  return url;
}

export const originOf = req =>
  `${String(req.headers["x-forwarded-proto"] || "https").split(",")[0]}://${req.headers["x-forwarded-host"] || req.headers.host}`;

/* ---------- categories ---------- */
export function effStatus(c) {
  if (!c.enabled) return "disabled";
  if (c.status !== "active") return c.status;
  if (!c.upstreamUrl) return "not_configured";
  return c.health?.state === "down" ? "offline" : c.health?.state === "up" ? "online" : "unknown";
}
export function pubCat(c, origin) {
  const endpoint = `${origin}/api/dev/v1/${c.slug}`;
  const q = (c.params || []).filter(p => p.required).map(p => `${p.name}=example`).join("&");
  return {
    slug: c.slug, name: c.name, group: c.group, method: c.method, description: c.description,
    params: c.params || [], auth: "API key required (x-api-key header)", premium: !!c.premium,
    status: effStatus(c), latency: c.health?.latency ?? null, checkedAt: c.health?.checkedAt ?? null,
    endpoint, exampleRequest: `curl -H "x-api-key: YOUR_API_KEY" "${endpoint}${q ? "?" + q : ""}"`,
    exampleResponse: c.exampleResponse || ""
  };
}

/* ---------- bootstrap (indexes + default content), once per instance ---------- */
let ready;
export function ensureReady() {
  ready ??= (async () => {
    const idx = async (name, spec, opts) => { try { await (await T(name)).createIndex(spec, opts); } catch { /* ignore */ } };
    await idx("sessions", { exp: 1 }, { expireAfterSeconds: 0 });
    await idx("users", { usernameLower: 1 }, { unique: true });
    await idx("users", { emailLower: 1 }, { unique: true });
    await idx("api_keys", { hash: 1 }, { unique: true });
    await idx("api_keys", { userId: 1 });
    await idx("usage", { ts: 1 }, { expireAfterSeconds: 180 * 86400 });
    await idx("usage", { userId: 1, ts: -1 });
    await idx("usage", { keyId: 1, ts: -1 });
    await idx("monitor", { ts: 1 }, { expireAfterSeconds: 30 * 86400 });
    await idx("monitor", { slug: 1, ts: -1 });
    await idx("activity", { ts: 1 }, { expireAfterSeconds: 180 * 86400 });
    await idx("tickets", { userId: 1, updatedAt: -1 });
    await seedDefaults();
  })().catch(e => { ready = null; throw e; });
  return ready;
}

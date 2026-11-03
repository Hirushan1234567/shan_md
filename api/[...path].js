import crypto from "crypto";
import { aux, cleanNumber, validNumber, rateLimited, clientIp } from "./_lib/db.js";
import { HttpError, sign, verify, bearer, isAdmin, adminPasswordOk } from "./_lib/auth.js";
import { senderInfo } from "./_lib/wa-sender.js";
import { createReset, consumeReset, sendMail, originOf } from "./_lib/reset.js";
import { hashPassword, checkPassword } from "./_lib/password.js";
import {
  DAY, GAME_DAILY_CAP, WELCOME, REF_BONUS, REF_REWARD,
  CATALOG, TASKS, DEFAULT_SETTINGS
} from "./_lib/config.js";

const SESSION_TTL = 14 * DAY;
const today = () => new Date().toISOString().slice(0, 10);
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const users = async () => aux("users");

/* ---------- helpers ---------- */

async function me(req) {
  const p = verify(bearer(req));
  if (!p?.n) throw new HttpError(401, "Please login first.");
  const u = await (await users()).findOne({ _id: p.n });
  if (!u) throw new HttpError(401, "Please login first.");
  if (u.banned) throw new HttpError(403, "This account is banned.");
  if ((p.sv || 0) !== (u.sv || 0)) throw new HttpError(401, "Session expired. Please login again.");
  return u;
}
function needAdmin(req) { if (!isAdmin(req)) throw new HttpError(403, "Admin only."); }

const entry = (type, amt, note) => ({ t: Date.now(), type, amt, note });
const logPush = msg => ({ log: { $each: [{ t: Date.now(), msg }], $position: 0, $slice: 60 } });

async function credit(u, amt, note, extra = {}) {
  await (await users()).updateOne({ _id: u._id }, {
    $inc: { coins: amt, earned: amt, ...extra },
    $push: { tx: { $each: [entry("earn", amt, note)], $position: 0, $slice: 60 } }
  });
}
async function debit(u, amt, note) {
  const r = await (await users()).updateOne({ _id: u._id, coins: { $gte: amt } }, {
    $inc: { coins: -amt, spent: amt },
    $push: { tx: { $each: [entry("spend", amt, note)], $position: 0, $slice: 60 } }
  });
  if (!r.modifiedCount) throw new HttpError(400, "Not enough coins.");
}
async function note(u, msg) { await (await users()).updateOne({ _id: u._id }, { $push: logPush(msg) }); }

const pub = u => ({
  name: u.name, username: u.username || null, email: u.email || null, number: u._id, coins: u.coins, joined: u.joined,
  vip: (u.mine || []).includes("vip")
});

const owned = (u, id) => id === "boost" ? Date.now() < (u.boostUntil || 0) : (u.mine || []).includes(id);

/* ---------- routes ---------- */

const R = {};

// ===== Auth (username / WhatsApp number + password) =====
// WhatsApp OTP login and Bot Key login/verification were removed on purpose.
const USER_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const pwOk = p => typeof p === "string" && p.length >= 8 && p.length <= 64 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PW_MSG = "Password must be 8-64 characters with at least one letter and one number.";
const DUMMY_HASH = "00".repeat(16) + ":" + "00".repeat(32);
const sess = u => sign({ n: u._id, sv: u.sv || 0 }, SESSION_TTL);

/** Old accounts: WhatsApp number (digits). New accounts: username or email. */
async function findAccount(raw) {
  const id = str(raw, 120).toLowerCase();
  if (!id) return null;
  const col = await users();
  if (/^\d{8,15}$/.test(id)) return col.findOne({ _id: id });
  return col.findOne({ $or: [{ usernameLower: id }, { emailLower: id }] });
}

R["POST /auth/register"] = async (req, b) => {
  if (await rateLimited(`reg:${clientIp(req)}`, 10, 60 * 60 * 1000)) throw new HttpError(429, "Too many sign-ups from this network. Try again later.");
  const username = str(b.username, 24), email = str(b.email, 120).toLowerCase(), password = String(b.password || "");
  if (!USER_RE.test(username)) throw new HttpError(400, "Username must be 3-24 characters: letters, numbers, . _ -");
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address or leave it empty.");
  if (!pwOk(password)) throw new HttpError(400, PW_MSG);
  const col = await users();
  const clash = await col.findOne({ $or: [{ usernameLower: username.toLowerCase() }, ...(email ? [{ emailLower: email }] : [])] });
  if (clash) throw new HttpError(409, "That username or email is already registered.");

  const ref = str(b.ref, 12).toUpperCase();
  const referrer = ref ? await col.findOne({ code: ref }) : null;
  const bonus = referrer ? REF_BONUS : 0;
  const start = WELCOME + bonus;
  const u = {
    _id: "u" + crypto.randomBytes(7).toString("hex"),
    name: username, username, usernameLower: username.toLowerCase(),
    email: email || null, emailLower: email || null,
    pw: hashPassword(password), sv: 0,
    coins: start, earned: start, spent: 0,
    last: 0, streak: 0, joined: Date.now(),
    code: "SHAN-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
    refs: 0, mine: [], boostUntil: 0, redeemed: [], tk: {}, g: { day: "", earned: 0 },
    settings: { ...DEFAULT_SETTINGS }, botStatus: "offline", keys: [],
    tx: [entry("earn", start, bonus ? "Welcome bonus + promo code" : "Welcome bonus")],
    log: [{ t: Date.now(), msg: "Account created" }]
  };
  await col.insertOne(u);
  if (referrer) await credit(referrer, REF_REWARD, "Friend joined with your promo code", { refs: 1 });
  return { token: sess(u), user: pub(u) };
};

R["POST /auth/login"] = async (req, b) => {
  if (await rateLimited(`lip:${clientIp(req)}`, 25, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
  const idRaw = str(b.username ?? b.number, 120), password = String(b.password || "").slice(0, 200);
  if (!idRaw || !password) throw new HttpError(400, "Enter your username (or WhatsApp number) and password.");
  if (await rateLimited(`lacc:${idRaw.toLowerCase()}`, 8, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts for this account. Try again in 10 minutes.");
  const u = await findAccount(idRaw);
  if (u && !u.pw) throw new HttpError(400, "This account has no password yet. Ask the admin for a password reset link.");
  const ok = checkPassword(password, u?.pw || DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Wrong username/number or password.");
  if (u.banned) throw new HttpError(403, "This account is banned.");
  await note(u, "Logged in");
  return { token: sess(u), user: pub(u) };
};

R["POST /auth/forgot"] = async (req, b) => {
  if (await rateLimited(`fgt:${clientIp(req)}`, 5, 60 * 60 * 1000)) throw new HttpError(429, "Too many requests. Try again later.");
  const email = str(b.email, 120).toLowerCase();
  if (EMAIL_RE.test(email)) {
    const u = await (await users()).findOne({ emailLower: email });
    if (u && !u.banned) {
      const token = await createReset("pw_resets", u._id);
      await sendMail(email, "SHAN password reset", `Reset your password (valid 30 minutes):\n${originOf(req)}/dashboard#reset=${token}\n\nIf you did not ask for this, ignore this email.`);
    }
  }
  return { ok: 1, message: "If that email is registered, a reset link was sent. No email on the account? Ask the admin for a reset link." };
};

R["POST /auth/reset"] = async (req, b) => {
  if (await rateLimited(`rst:${clientIp(req)}`, 10, 60 * 60 * 1000)) throw new HttpError(429, "Too many attempts.");
  const password = String(b.password || "");
  if (!pwOk(password)) throw new HttpError(400, PW_MSG);
  const uid = await consumeReset("pw_resets", String(b.token || ""));
  if (!uid) throw new HttpError(400, "This reset link is invalid or expired.");
  await (await users()).updateOne({ _id: uid }, { $set: { pw: hashPassword(password) }, $inc: { sv: 1 }, $push: logPush("Password reset") });
  return { ok: 1 };
};

R["POST /auth/password"] = async (req, b) => {
  const u = await me(req);
  if (await rateLimited(`pwchg:${u._id}`, 6, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts.");
  if (!u.pw || !checkPassword(String(b.current || ""), u.pw)) throw new HttpError(400, "Current password is wrong.");
  if (!pwOk(String(b.password || ""))) throw new HttpError(400, PW_MSG);
  await (await users()).updateOne({ _id: u._id }, { $set: { pw: hashPassword(b.password) }, $inc: { sv: 1 }, $push: logPush("Password changed") });
  return { token: sign({ n: u._id, sv: (u.sv || 0) + 1 }, SESSION_TTL) };
};

// ===== Account / coins =====
R["GET /me"] = async req => pub(await me(req));

R["GET /coins"] = async req => {
  const u = await me(req);
  const g = u.g?.day === today() ? u.g.earned : 0;
  return {
    balance: u.coins, earned: u.earned, spent: u.spent, tx: u.tx || [],
    canDaily: Date.now() - (u.last || 0) > DAY,
    code: u.code, refs: u.refs || 0, refReward: REF_REWARD, refBonus: REF_BONUS,
    gInfo: `Game coins today: ${g}/${GAME_DAILY_CAP}`
  };
};

R["POST /coins/daily"] = async req => {
  const u = await me(req);
  const now = Date.now();
  const streak = now - (u.last || 0) < 2 * DAY ? (u.streak || 0) + 1 : 1;
  const base = 15 + (streak % 7 === 0 ? 40 : 0);
  const r = base * (now < (u.boostUntil || 0) ? 2 : 1);
  const res = await (await users()).updateOne({ _id: u._id, last: { $lte: now - DAY } }, {
    $set: { last: now, streak },
    $inc: { coins: r, earned: r },
    $push: { tx: { $each: [entry("earn", r, `Daily reward (day ${streak})`)], $position: 0, $slice: 60 }, ...logPush(`Daily reward +${r}`) }
  });
  if (!res.modifiedCount) throw new HttpError(400, "Already claimed. Come back later.");
  return { balance: u.coins + r };
};

R["POST /coins/redeem"] = async (req, b) => {
  const u = await me(req);
  const code = str(b.code, 20).toUpperCase();
  const c = await (await aux("coupons")).findOneAndUpdate(
    { _id: code, by: { $ne: u._id }, $expr: { $lt: ["$used", "$uses"] } },
    { $inc: { used: 1 }, $push: { by: u._id } },
    { returnDocument: "before" }
  );
  const doc = c?.value !== undefined ? c.value : c; // driver version differences
  if (!doc) throw new HttpError(400, "Invalid, used or expired code.");
  await credit(u, doc.coins, `Coupon ${code}`);
  await note(u, `Redeemed coupon ${code}`);
  return { coins: doc.coins };
};

/** Password re-check for money actions (replaces the old WhatsApp OTP confirmation). */
async function confirmPassword(u, password) {
  if (await rateLimited(`pwtx:${u._id}`, 8, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Try again in 10 minutes.");
  if (!u.pw || !checkPassword(String(password || ""), u.pw)) throw new HttpError(400, "Wrong password.");
}

R["POST /coins/send"] = async (req, b) => {
  const u = await me(req);
  const a = Math.floor(+b.amount);
  if (!(a >= 10 && a <= 500)) throw new HttpError(400, "Amount must be 10-500.");
  if (!str(b.number ?? b.to, 60)) throw new HttpError(400, "Enter the receiver's username or WhatsApp number.");
  await confirmPassword(u, b.password);
  const rec = await findAccount(b.number ?? b.to);
  if (!rec || rec.banned) throw new HttpError(400, "That account was not found.");
  if (rec._id === u._id) throw new HttpError(400, "You cannot send to yourself.");
  await debit(u, a, `Sent to ${rec.name}`);
  await credit(rec, a, `Received from ${u.name}`);
  await note(u, `Sent ${a} coins to ${rec.name}`);
  return { ok: 1 };
};

// ===== Shop =====
R["GET /plugins"] = async req => {
  const u = await me(req);
  return CATALOG.map(c => ({ ...c, owned: owned(u, c.id) }));
};

R["POST /plugins/buy"] = async (req, b) => {
  const u = await me(req);
  const c = CATALOG.find(x => x.id === b.id);
  if (!c) throw new HttpError(404, "Plugin not found.");
  if (owned(u, c.id)) throw new HttpError(400, "Already active/owned.");
  if (u.coins < c.price) throw new HttpError(400, "Not enough coins.");
  await confirmPassword(u, b.password);
  await debit(u, c.price, `Bought ${c.name}`);
  await (await users()).updateOne({ _id: u._id },
    c.id === "boost" ? { $set: { boostUntil: Date.now() + 7 * DAY }, $push: logPush(`Purchased: ${c.name}`) }
                     : { $addToSet: { mine: c.id }, $push: logPush(`Purchased: ${c.name}`) });
  return { ok: 1 };
};

// ===== Games =====
R["POST /games/start"] = async (req, b) => {
  const u = await me(req);
  if (!["snake", "g2048", "memory"].includes(b.game)) throw new HttpError(400, "Unknown game.");
  const sid = crypto.randomBytes(6).toString("hex");
  await (await users()).updateOne({ _id: u._id }, { $set: { gs: { game: b.game, t0: Date.now(), sid } } });
  return { sid };
};

R["POST /games/finish"] = async (req, b) => {
  const u = await me(req);
  const prev = await (await users()).findOneAndUpdate({ _id: u._id, "gs.sid": String(b.sid) }, { $unset: { gs: "" } }, { returnDocument: "before" });
  const G = (prev?.value !== undefined ? prev.value : prev)?.gs;
  if (!G) throw new HttpError(400, "No active game.");
  const sec = (Date.now() - G.t0) / 1000, sc = +b.score || 0;
  let r = 0;
  if (G.game === "snake") { if (sec >= sc * 0.6) r = Math.min(10, Math.floor(sc / 3)); }
  else if (G.game === "g2048") { if (sec >= sc / 8) r = sc >= 2048 ? 15 : sc >= 1024 ? 12 : sc >= 512 ? 8 : sc >= 256 ? 5 : sc >= 128 ? 2 : 0; }
  else if (sec >= 8) r = Math.min(6, Math.floor(sc / 20));

  const gDay = u.g?.day === today() ? u.g.earned : 0;
  const a = Math.max(0, Math.min(r, GAME_DAILY_CAP - gDay));
  if (a > 0) {
    await credit(u, a, `Game reward: ${G.game}`);
    await (await users()).updateOne({ _id: u._id }, { $set: { g: { day: today(), earned: gDay + a } } });
  }
  await note(u, `Played ${G.game} (score ${sc})`);
  return { msg: a ? `🎉 +${a} coins!` : r ? "Daily game coin limit reached." : "No coins this time — try again!" };
};

// ===== Tasks / announce / leaderboard =====
R["GET /announce"] = async () => {
  const d = await (await aux("meta")).findOne({ _id: "announce" });
  return { text: d?.text || "" };
};

R["GET /leaderboard"] = async () => {
  const l = await (await users()).find({ banned: { $ne: true } }, { projection: { name: 1, earned: 1 } }).sort({ earned: -1 }).limit(10).toArray();
  return l.map(x => ({ name: x.name, earned: x.earned }));
};

R["GET /tasks"] = async req => {
  const u = await me(req);
  return TASKS.map(t => ({ ...t, done: t.type === "once" ? !!u.tk?.[t.id] : u.tk?.[t.id] === today() }));
};

R["POST /tasks/claim"] = async (req, b) => {
  const u = await me(req);
  const t = TASKS.find(x => x.id === b.id);
  if (!t) throw new HttpError(404, "Unknown task.");
  const val = t.type === "once" ? 1 : today();
  if (u.tk?.[t.id] === val) throw new HttpError(400, "Already claimed.");
  if (t.id === "cmd" && u.botStatus !== "online") throw new HttpError(400, "Start your bot first (Bot tab).");
  const r = await (await users()).updateOne({ _id: u._id, [`tk.${t.id}`]: { $ne: val } }, { $set: { [`tk.${t.id}`]: val } });
  if (!r.modifiedCount) throw new HttpError(400, "Already claimed.");
  await credit(u, t.reward, `Task: ${t.name}`);
  await note(u, `Task done: ${t.name}`);
  return { ok: 1 };
};

// ===== Bot settings / control / keys / activity =====
R["GET /settings"] = async req => {
  const u = await me(req);
  return { ...DEFAULT_SETTINGS, ...(u.settings || {}), canImg: (u.mine || []).includes("wimg") };
};

R["PUT /settings"] = async (req, b) => {
  const u = await me(req);
  const s = {
    prefix: str(b.prefix || ".", 3), mode: b.mode === "private" ? "private" : "public",
    name: str(b.name || "SHAN MINI BOT", 30), seen: !!b.seen, typing: !!b.typing,
    img: (u.mine || []).includes("wimg") ? str(b.img, 300) : ""
  };
  await (await users()).updateOne({ _id: u._id }, { $set: { settings: s }, $push: logPush("Settings updated") });
  return s;
};

R["GET /bot"] = async req => ({ status: (await me(req)).botStatus || "offline" });

R["POST /bot"] = async (req, b) => {
  const u = await me(req);
  const status = b.action === "start" ? "online" : "offline";
  await (await users()).updateOne({ _id: u._id }, { $set: { botStatus: status }, $push: logPush(`Bot ${status === "online" ? "started" : "stopped"}`) });
  return { status };
};

R["GET /keys"] = async req => {
  const u = await me(req);
  return (u.keys || []).map(k => ({ id: k.id, name: k.name, key: k.preview, created: k.created }));
};

R["POST /keys"] = async (req, b) => {
  const u = await me(req);
  if ((u.keys || []).length >= 5) throw new HttpError(400, "Max 5 API keys. Revoke one first.");
  const key = "shan_" + crypto.randomBytes(16).toString("hex");
  const k = { id: crypto.randomBytes(5).toString("hex"), name: str(b.name || "key", 30), preview: key.slice(0, 9) + "••••••••", hash: crypto.createHash("sha256").update(key).digest("hex"), created: Date.now() };
  await (await users()).updateOne({ _id: u._id }, { $push: { keys: k, ...logPush("API key generated") } });
  return { key }; // full key එක පෙන්නන්නේ මේ එක පාරයි
};

R["DELETE /keys"] = async (req, b, q) => {
  const u = await me(req);
  await (await users()).updateOne({ _id: u._id }, { $pull: { keys: { id: String(q.get("id")) } }, $push: logPush("API key revoked") });
  return { ok: 1 };
};

R["GET /activity"] = async req => (await me(req)).log || [];

// ===== Comments (public read, rate-limited post) =====
R["GET /comments"] = async () =>
  (await (await aux("comments")).find({}).sort({ t: -1 }).limit(50).toArray()).map(c => ({ id: String(c._id), name: c.name, msg: c.msg, t: c.t }));

R["POST /comments"] = async (req, b) => {
  const msg = str(b.msg, 300);
  if (!msg) throw new HttpError(400, "Write a comment first.");
  let name = str(b.name, 30) || "Guest";
  if (bearer(req)) { try { name = (await me(req)).name; } catch {} }
  if (await rateLimited(`cm:${clientIp(req)}`, 5, 10 * 60 * 1000)) throw new HttpError(429, "Too many comments. Try again later.");
  await (await aux("comments")).insertOne({ name, msg, t: Date.now() });
  return { ok: 1 };
};

R["DELETE /comments"] = async (req, b, q) => {
  needAdmin(req);
  const { ObjectId } = await import("mongodb");
  const id = String(q.get("id"));
  await (await aux("comments")).deleteOne({ _id: ObjectId.isValid(id) ? new ObjectId(id) : id });
  return { ok: 1 };
};

// ===== Admin =====
R["POST /admin/login"] = async (req, b) => {
  if (await rateLimited(`adm:${clientIp(req)}`, 8, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts.");
  if (!adminPasswordOk(b.password)) throw new HttpError(401, "Wrong admin password.");
  return { token: sign({ adm: 1 }, 2 * 60 * 60 * 1000) };
};

R["GET /admin/stats"] = async req => {
  needAdmin(req);
  const col = await users();
  const agg = await col.aggregate([{ $group: { _id: null, coins: { $sum: "$coins" }, n: { $sum: 1 }, sold: { $sum: { $size: { $ifNull: ["$mine", []] } } } } }]).toArray();
  return { users: agg[0]?.n || 0, coins: agg[0]?.coins || 0, sold: agg[0]?.sold || 0, comments: await (await aux("comments")).countDocuments() };
};

R["GET /admin/users"] = async req => {
  needAdmin(req);
  return (await (await users()).find({}, { projection: { name: 1, coins: 1, banned: 1 } }).sort({ joined: -1 }).limit(100).toArray())
    .map(x => ({ name: x.name, number: x._id, coins: x.coins, banned: !!x.banned }));
};

R["POST /admin/coins"] = async (req, b) => {
  needAdmin(req);
  const n = str(b.number, 40), amt = Math.trunc(+b.amount);
  if (!amt) throw new HttpError(400, "Enter an amount.");
  const r = await (await users()).updateOne({ _id: n, ...(amt < 0 ? { coins: { $gte: -amt } } : {}) }, {
    $inc: { coins: amt, ...(amt > 0 ? { earned: amt } : {}) },
    $push: { tx: { $each: [entry(amt > 0 ? "earn" : "spend", Math.abs(amt), "Admin adjustment")], $position: 0, $slice: 60 } }
  });
  if (!r.matchedCount) throw new HttpError(400, "User not found or balance too low.");
  return { ok: 1 };
};

R["POST /admin/ban"] = async (req, b) => {
  needAdmin(req);
  await (await users()).updateOne({ _id: str(b.number, 40) }, { $set: { banned: !!b.ban } });
  return { ok: 1 };
};

R["POST /admin/announce"] = async (req, b) => {
  needAdmin(req);
  await (await aux("meta")).updateOne({ _id: "announce" }, { $set: { text: str(b.text, 150) } }, { upsert: true });
  return { ok: 1 };
};

R["POST /admin/coupons"] = async (req, b) => {
  needAdmin(req);
  const code = str(b.code, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const coins = Math.floor(+b.coins), uses = Math.floor(+b.uses);
  if (!code || !(coins > 0) || !(uses > 0)) throw new HttpError(400, "Enter code, coins and max uses.");
  await (await aux("coupons")).updateOne({ _id: code }, { $set: { coins, uses }, $setOnInsert: { used: 0, by: [] } }, { upsert: true });
  return { ok: 1 };
};

R["POST /admin/reset-link"] = async (req, b) => {
  needAdmin(req);
  const u = await (await users()).findOne({ _id: str(b.number, 40) });
  if (!u) throw new HttpError(404, "User not found.");
  return { link: `${originOf(req)}/dashboard#reset=${await createReset("pw_resets", u._id)}`, expiresInMinutes: 30 };
};

R["GET /admin/sender"] = async req => { needAdmin(req); return senderInfo(); };

/* ---------- entry ---------- */

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const fn = R[`${req.method} ${path}`];
    if (!fn) return res.status(404).json({ error: "Unknown route." });
    const out = await fn(req, req.body && typeof req.body === "object" ? req.body : {}, url.searchParams);
    res.status(200).json(out ?? { ok: 1 });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("api error:", e?.message || e);
    res.status(500).json({ error: "Server error. Try again." });
  }
}

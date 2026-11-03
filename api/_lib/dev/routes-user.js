import crypto from "crypto";
import {
  T, DAY, str, int, need, bool, rid, sha256, validUsername, validEmail, validPassword, hashPw, checkPw, DUMMY_HASH,
  startSession, endSession, requireUser, getPlans, getSetting, effectivePlan, logActivity, validIpRule,
  rateLimited, clientIp, HttpError, pubCat, originOf, effStatus
} from "./core.js";
import { createReset, consumeReset, sendMail } from "../reset.js";
import { runChecks, summary } from "./monitor.js";

export const TICKET_CATEGORIES = ["Bug report", "Feature request", "Billing / Premium", "API help", "Other"];

export const pubUser = u => ({
  id: u._id, username: u.username, email: u.email, status: u.status, plan: effectivePlan(u),
  assignedPlan: u.plan, planExpires: u.planExpires || null, createdAt: u.createdAt, lastLogin: u.lastLogin || null
});

const keyStatus = k => (k.status === "active" && k.expiresAt && k.expiresAt < Date.now() ? "expired" : k.status);
export const keyView = k => ({
  id: k._id, name: k.name, prefix: k.prefix, status: keyStatus(k), createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt || null, expiresAt: k.expiresAt || null, ips: k.ips || [],
  used: k.used || 0, remaining: k.remaining ?? null, limit: k.limit ?? null
});
const newSecret = () => "shan_live_" + crypto.randomBytes(24).toString("base64url");
const prefixOf = s => s.slice(0, 14) + "…" + s.slice(-4);

async function quota(u) {
  const plan = effectivePlan(u), keys = await T("api_keys");
  const mine = await keys.find({ userId: u._id }).toArray();
  const live = mine.filter(k => k.status !== "revoked");
  if (plan === "free") {
    return { plan, mode: "per-key lifetime", unlimited: false, remaining: live.reduce((a, k) => a + (k.remaining || 0), 0), total: live.reduce((a, k) => a + (k.limit || 0), 0) };
  }
  return { plan, mode: "account", unlimited: u.planRemaining == null, remaining: u.planRemaining ?? null, total: u.planLimit ?? null, used: u.planUsed || 0 };
}

async function profile(u) {
  const plans = await getPlans();
  const p = effectivePlan(u);
  return { ...pubUser(u), planName: plans[p]?.name || p, quota: await quota(u), limits: { maxKeys: plans[p]?.maxKeys, rpm: plans[p]?.rpm } };
}

function series(docs, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    out.push({ date: d, total: 0, errors: 0 });
  }
  const idx = Object.fromEntries(out.map((x, i) => [x.date, i]));
  for (const u of docs) {
    const i = idx[new Date(u.ts).toISOString().slice(0, 10)];
    if (i === undefined) continue;
    out[i].total++; if (!u.ok) out[i].errors++;
  }
  return out;
}
const tally = (docs, f) => {
  const m = {}; docs.forEach(d => { const k = f(d); m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};

const ownedKey = async (u, id) => {
  const k = await (await T("api_keys")).findOne({ _id: str(id, 40), userId: u._id });
  need(k, "API key not found.", 404);
  return k;
};
function cleanIps(list) {
  const arr = (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/)).map(x => str(x, 50)).filter(Boolean);
  need(arr.length <= 10, "At most 10 IP rules per key.");
  for (const r of arr) need(validIpRule(r), `Invalid IP or CIDR: ${r}`);
  return [...new Set(arr)];
}

export function register(R) {
  /* ---------- public ---------- */
  R["GET /status"] = async () => {
    const maintenance = await getSetting("maintenance", { on: false, message: "" });
    const ann = await (await T("announcements")).find({ active: true }).sort({ t: -1 }).limit(5).toArray();
    return { maintenance, version: "2.0.0", announcements: ann.map(a => ({ id: a._id, title: a.title, body: a.body, level: a.level, t: a.t })) };
  };
  R["GET /catalog"] = async req => {
    const cats = await (await T("categories")).find({ enabled: true }).sort({ order: 1 }).toArray();
    return cats.map(c => pubCat(c, originOf(req)));
  };

  /* ---------- auth ---------- */
  R["POST /auth/register"] = async (req, b, q, res) => {
    const ip = clientIp(req);
    need(!(await rateLimited(`dreg:${ip}`, 10, 3600e3)), "Too many sign-ups from this network. Try again later.", 429);
    const username = str(b.username, 24), email = str(b.email, 120).toLowerCase(), password = String(b.password ?? "");
    need(validUsername(username), "Username must be 3-24 characters: letters, numbers, . _ -");
    need(validEmail(email), "Enter a valid email address.");
    validPassword(password);
    const users = await T("users");
    need(!(await users.findOne({ $or: [{ usernameLower: username.toLowerCase() }, { emailLower: email }] })), "That username or email is already registered.", 409);
    const u = {
      _id: rid(8), username, usernameLower: username.toLowerCase(), email, emailLower: email, pw: await hashPw(password),
      status: "active", plan: "free", planExpires: null, planLimit: null, planRemaining: null, planUsed: 0,
      createdAt: Date.now(), lastLogin: Date.now()
    };
    try { await users.insertOne(u); }
    catch (e) { if (e?.code === 11000) throw new HttpError(409, "That username or email is already registered."); throw e; }
    await logActivity(u._id, "register", "Account created", ip);
    await startSession(req, res, "user", u._id);
    return { user: await profile(u) };
  };

  R["POST /auth/login"] = async (req, b, q, res) => {
    const ip = clientIp(req);
    need(!(await rateLimited(`dlip:${ip}`, 25, 600e3)), "Too many attempts. Please wait a few minutes.", 429);
    const id = str(b.username, 120).toLowerCase(), password = String(b.password ?? "").slice(0, 200);
    need(id && password, "Enter your username and password.");
    need(!(await rateLimited(`dlacc:${id}`, 8, 600e3)), "Too many attempts for this account. Try again in 10 minutes.", 429);
    const users = await T("users");
    const u = await users.findOne({ $or: [{ usernameLower: id }, { emailLower: id }] });
    const ok = await checkPw(password, u?.pw || DUMMY_HASH);
    if (!u || !ok) { if (u) await logActivity(u._id, "login_failed", "Wrong password", ip); throw new HttpError(401, "Invalid username or password."); }
    need(u.status !== "blocked", "Your account is blocked. Contact support.", 403);
    await users.updateOne({ _id: u._id }, { $set: { lastLogin: Date.now() } });
    await logActivity(u._id, "login", "Logged in", ip);
    await startSession(req, res, "user", u._id);
    return { user: await profile(u) };
  };

  R["POST /auth/logout"] = async (req, b, q, res) => { await endSession(req, res, "user"); return { ok: 1 }; };

  R["POST /auth/forgot"] = async (req, b) => {
    need(!(await rateLimited(`dfg:${clientIp(req)}`, 5, 3600e3)), "Too many requests. Try again later.", 429);
    const email = str(b.email, 120).toLowerCase();
    if (validEmail(email)) {
      const u = await (await T("users")).findOne({ emailLower: email });
      if (u && u.status !== "blocked") {
        const token = await createReset("dev_resets", u._id);
        await sendMail(email, "SHAN API password reset", `Reset your password (valid 30 minutes):\n${originOf(req)}/dev/login#reset=${token}\n\nIf you did not request this, ignore this email.`);
      }
    }
    return { ok: 1, message: "If that email is registered, a reset link has been sent. If e-mail is not set up on this platform, ask an admin for a reset link." };
  };

  R["POST /auth/reset"] = async (req, b) => {
    need(!(await rateLimited(`drs:${clientIp(req)}`, 10, 3600e3)), "Too many attempts.", 429);
    validPassword(String(b.password ?? ""));
    const uid = await consumeReset("dev_resets", String(b.token || ""));
    need(uid, "This reset link is invalid or has expired.");
    await (await T("users")).updateOne({ _id: uid }, { $set: { pw: await hashPw(b.password) } });
    await (await T("sessions")).deleteMany({ uid, kind: "user" });
    await logActivity(uid, "password_reset", "Password reset", clientIp(req));
    return { ok: 1 };
  };

  /* ---------- profile ---------- */
  R["GET /me"] = async req => ({ user: await profile(await requireUser(req)) });

  R["PUT /me"] = async (req, b) => {
    const u = await requireUser(req), users = await T("users"), set = {};
    if (b.username !== undefined) {
      const un = str(b.username, 24); need(validUsername(un), "Username must be 3-24 characters: letters, numbers, . _ -");
      need(!(await users.findOne({ usernameLower: un.toLowerCase(), _id: { $ne: u._id } })), "That username is taken.", 409);
      set.username = un; set.usernameLower = un.toLowerCase();
    }
    if (b.email !== undefined) {
      const em = str(b.email, 120).toLowerCase(); need(validEmail(em), "Enter a valid email address.");
      need(!(await users.findOne({ emailLower: em, _id: { $ne: u._id } })), "That email is already used.", 409);
      set.email = em; set.emailLower = em;
    }
    need(Object.keys(set).length, "Nothing to update.");
    await users.updateOne({ _id: u._id }, { $set: set });
    await logActivity(u._id, "profile", "Profile updated", clientIp(req));
    return { user: await profile({ ...u, ...set }) };
  };

  R["POST /me/password"] = async (req, b, q, res) => {
    const u = await requireUser(req);
    need(!(await rateLimited(`dpc:${u._id}`, 6, 600e3)), "Too many attempts.", 429);
    need(await checkPw(String(b.current ?? ""), u.pw), "Current password is wrong.");
    validPassword(String(b.password ?? ""));
    await (await T("users")).updateOne({ _id: u._id }, { $set: { pw: await hashPw(b.password) } });
    await (await T("sessions")).deleteMany({ uid: u._id, kind: "user" }); // sign out everywhere
    await startSession(req, res, "user", u._id);
    await logActivity(u._id, "password", "Password changed", clientIp(req));
    return { ok: 1 };
  };

  /* ---------- dashboard / usage ---------- */
  R["GET /dashboard"] = async req => {
    const u = await requireUser(req), usage = await T("usage");
    const since = new Date(Date.now() - 30 * DAY);
    const [recent30, total, keys, acts, reqs, cats] = await Promise.all([
      usage.find({ userId: u._id, ts: { $gte: since } }).limit(20000).toArray(),
      usage.countDocuments({ userId: u._id }),
      (await T("api_keys")).find({ userId: u._id }).toArray(),
      (await T("activity")).find({ uid: u._id }).sort({ ts: -1 }).limit(8).toArray(),
      usage.find({ userId: u._id }).sort({ ts: -1 }).limit(6).toArray(),
      (await T("categories")).find({ enabled: true }).sort({ order: 1 }).toArray()
    ]);
    return {
      profile: await profile(u),
      stats: { totalRequests: total, last30: recent30.length, activeKeys: keys.filter(k => keyStatus(k) === "active").length, errors30: recent30.filter(x => !x.ok).length },
      daily: series(recent30, 30),
      activity: acts.map(a => ({ t: +new Date(a.ts), type: a.type, msg: a.msg })),
      recentRequests: reqs.map(r => ({ t: +new Date(r.ts), slug: r.slug, status: r.status, ms: r.ms })),
      apis: cats.slice(0, 8).map(c => ({ slug: c.slug, name: c.name, status: effStatus(c), latency: c.health?.latency ?? null }))
    };
  };

  R["GET /usage"] = async (req, b, q) => {
    const u = await requireUser(req), days = int(q.get("days"), 1, 90, 30);
    const docs = await (await T("usage")).find({ userId: u._id, ts: { $gte: new Date(Date.now() - days * DAY) } }).limit(30000).toArray();
    const keys = await (await T("api_keys")).find({ userId: u._id }).toArray();
    const kname = Object.fromEntries(keys.map(k => [k._id, k.name]));
    const ms = docs.filter(d => d.ok && d.ms != null).map(d => d.ms);
    return {
      days, total: docs.length, errors: docs.filter(d => !d.ok).length,
      avgMs: ms.length ? Math.round(ms.reduce((a, c) => a + c, 0) / ms.length) : null,
      daily: series(docs, days), byApi: tally(docs, d => d.slug).slice(0, 12),
      byKey: tally(docs, d => kname[d.keyId] || "deleted key").slice(0, 12),
      byStatus: tally(docs, d => String(d.status))
    };
  };

  R["GET /usage/history"] = async (req, b, q) => {
    const u = await requireUser(req), page = int(q.get("page"), 1, 1000, 1), size = 20, f = { userId: u._id };
    if (q.get("slug")) f.slug = str(q.get("slug"), 60);
    if (q.get("ok") === "0") f.ok = false;
    const usage = await T("usage");
    const [rows, total] = await Promise.all([
      usage.find(f).sort({ ts: -1 }).skip((page - 1) * size).limit(size).toArray(), usage.countDocuments(f)
    ]);
    return { page, pages: Math.max(1, Math.ceil(total / size)), total, rows: rows.map(r => ({ t: +new Date(r.ts), slug: r.slug, method: r.method, status: r.status, ms: r.ms, ip: r.ip, code: r.code || "" })) };
  };

  /* ---------- API keys ---------- */
  R["GET /keys"] = async req => {
    const u = await requireUser(req);
    const ks = await (await T("api_keys")).find({ userId: u._id }).sort({ createdAt: -1 }).toArray();
    return { keys: ks.map(keyView), quota: await quota(u), maxKeys: (await getPlans())[effectivePlan(u)]?.maxKeys || 3 };
  };

  R["POST /keys"] = async (req, b) => {
    const u = await requireUser(req), keys = await T("api_keys"), plans = await getPlans();
    const maxKeys = plans[effectivePlan(u)]?.maxKeys || 3;
    need(!(await rateLimited(`dkc:${u._id}`, 20, 3600e3)), "Too many keys created. Try again later.", 429);
    const live = await keys.countDocuments({ userId: u._id, status: { $ne: "revoked" } });
    need(live < maxKeys, `Your plan allows ${maxKeys} active API keys. Revoke one first.`);
    const days = int(b.expiresDays, 0, 3650, 0), secret = newSecret();
    const doc = {
      _id: rid(6), userId: u._id, name: str(b.name, 40) || "My key", hash: sha256(secret), prefix: prefixOf(secret),
      status: "active", createdAt: Date.now(), lastUsedAt: null, expiresAt: days ? Date.now() + days * DAY : null,
      ips: cleanIps(b.ips), used: 0, limit: plans.free?.limit ?? 50, remaining: plans.free?.limit ?? 50
    };
    await keys.insertOne(doc);
    await logActivity(u._id, "key_created", `API key "${doc.name}" generated`, clientIp(req));
    return { key: secret, item: keyView(doc) }; // the full key is shown once and never stored
  };

  R["POST /keys/regenerate"] = async (req, b) => {
    const u = await requireUser(req), k = await ownedKey(u, b.id);
    need(k.status !== "revoked", "A revoked key cannot be regenerated. Create a new key.");
    const secret = newSecret();
    await (await T("api_keys")).updateOne({ _id: k._id }, { $set: { hash: sha256(secret), prefix: prefixOf(secret), regeneratedAt: Date.now() } });
    await logActivity(u._id, "key_regenerated", `API key "${k.name}" regenerated`, clientIp(req));
    return { key: secret, item: keyView({ ...k, prefix: prefixOf(secret) }) };
  };

  R["POST /keys/revoke"] = async (req, b) => {
    const u = await requireUser(req), k = await ownedKey(u, b.id);
    await (await T("api_keys")).updateOne({ _id: k._id }, { $set: { status: "revoked", revokedAt: Date.now() } });
    await logActivity(u._id, "key_revoked", `API key "${k.name}" revoked`, clientIp(req));
    return { ok: 1 };
  };

  R["POST /keys/toggle"] = async (req, b) => {
    const u = await requireUser(req), k = await ownedKey(u, b.id);
    need(k.status !== "revoked", "Revoked keys cannot be re-activated.");
    const status = bool(b.active) ? "active" : "inactive";
    await (await T("api_keys")).updateOne({ _id: k._id }, { $set: { status } });
    await logActivity(u._id, "key_toggled", `API key "${k.name}" ${status}`, clientIp(req));
    return { status };
  };

  R["POST /keys/update"] = async (req, b) => {
    const u = await requireUser(req), k = await ownedKey(u, b.id), set = {};
    if (b.name !== undefined) set.name = str(b.name, 40) || k.name;
    if (b.ips !== undefined) set.ips = cleanIps(b.ips);
    if (b.expiresDays !== undefined) { const d = int(b.expiresDays, 0, 3650, 0); set.expiresAt = d ? Date.now() + d * DAY : null; }
    need(Object.keys(set).length, "Nothing to update.");
    await (await T("api_keys")).updateOne({ _id: k._id }, { $set: set });
    return { item: keyView({ ...k, ...set }) };
  };

  /* ---------- tickets ---------- */
  R["GET /tickets"] = async req => {
    const u = await requireUser(req);
    const list = await (await T("tickets")).find({ userId: u._id }).sort({ updatedAt: -1 }).limit(100).toArray();
    return { categories: TICKET_CATEGORIES, tickets: list.map(t => ({ id: t._id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, updatedAt: t.updatedAt, createdAt: t.createdAt, unread: !!t.unreadUser, replies: t.messages.length - 1 })) };
  };

  R["POST /tickets"] = async (req, b) => {
    const u = await requireUser(req);
    need(!(await rateLimited(`dtk:${u._id}`, 6, 3600e3)), "You are creating tickets too fast. Try again later.", 429);
    const subject = str(b.subject, 120), message = str(b.message, 4000), category = TICKET_CATEGORIES.includes(b.category) ? b.category : "Other";
    need(subject.length >= 4, "Enter a subject (at least 4 characters).");
    need(message.length >= 10, "Describe the problem (at least 10 characters).");
    const now = Date.now();
    const t = {
      _id: rid(6), userId: u._id, username: u.username, subject, category, status: "open",
      priority: effectivePlan(u) === "premium2" ? "high" : "normal", createdAt: now, updatedAt: now,
      unreadUser: false, unreadAdmin: true, messages: [{ by: "user", name: u.username, text: message, t: now }]
    };
    await (await T("tickets")).insertOne(t);
    await logActivity(u._id, "ticket", `Ticket opened: ${subject}`, clientIp(req));
    return { id: t._id };
  };

  R["GET /tickets/get"] = async (req, b, q) => {
    const u = await requireUser(req), tickets = await T("tickets");
    const t = await tickets.findOne({ _id: str(q.get("id"), 40), userId: u._id });
    need(t, "Ticket not found.", 404);
    if (t.unreadUser) await tickets.updateOne({ _id: t._id }, { $set: { unreadUser: false } });
    return { ticket: { id: t._id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, createdAt: t.createdAt, messages: t.messages } };
  };

  R["POST /tickets/reply"] = async (req, b) => {
    const u = await requireUser(req), tickets = await T("tickets");
    const t = await tickets.findOne({ _id: str(b.id, 40), userId: u._id });
    need(t, "Ticket not found.", 404);
    need(t.status !== "closed", "This ticket is closed. Open a new ticket.");
    const text = str(b.message, 4000); need(text.length >= 2, "Write a message.");
    need(!(await rateLimited(`dtr:${u._id}`, 20, 3600e3)), "Too many replies. Slow down.", 429);
    const now = Date.now();
    await tickets.updateOne({ _id: t._id }, { $push: { messages: { by: "user", name: u.username, text, t: now } }, $set: { status: "open", updatedAt: now, unreadAdmin: true } });
    return { ok: 1 };
  };

  R["POST /tickets/close"] = async (req, b) => {
    const u = await requireUser(req);
    const r = await (await T("tickets")).updateOne({ _id: str(b.id, 40), userId: u._id }, { $set: { status: "closed", updatedAt: Date.now() } });
    need(r.matchedCount, "Ticket not found.", 404);
    return { ok: 1 };
  };

  R["GET /notifications"] = async req => {
    const u = await requireUser(req);
    const list = await (await T("tickets")).find({ userId: u._id, unreadUser: true }).sort({ updatedAt: -1 }).limit(10).toArray();
    return { unread: list.length, items: list.map(t => ({ id: t._id, text: `New reply on "${t.subject}"`, t: t.updatedAt })) };
  };

  /* ---------- plugins / changelog / monitoring ---------- */
  R["GET /plugins"] = async req => {
    await requireUser(req);
    const list = await (await T("plugins")).find({ published: true }).sort({ createdAt: -1 }).toArray();
    return list.map(p => ({ slug: p.slug, name: p.name, category: p.category, shortDesc: p.shortDesc, version: p.version, author: p.author, apiCategories: p.apiCategories || [] }));
  };
  R["GET /plugins/get"] = async (req, b, q) => {
    await requireUser(req);
    const p = await (await T("plugins")).findOne({ slug: str(q.get("slug"), 60), published: true });
    need(p, "Plugin not found.", 404);
    const { _id, ...rest } = p;
    return rest;
  };
  R["GET /changelog"] = async req => {
    await requireUser(req);
    return (await (await T("changelog")).find({}).sort({ date: -1, createdAt: -1 }).limit(200).toArray()).map(c => ({ id: c._id, version: c.version, type: c.type, title: c.title, body: c.body, date: c.date }));
  };
  R["GET /monitor"] = async req => { await requireUser(req); return summary(); };
  R["POST /monitor/run"] = async req => { await requireUser(req); return runChecks(false); };
}

import {
  T, DAY, str, int, need, bool, rid, hashPw, checkPw, DUMMY_HASH, validUsername, validPassword,
  startSession, endSession, requireAdmin, getPlans, getSetting, setSetting, effectivePlan, logActivity,
  rateLimited, clientIp, HttpError, assertPublicUrl, effStatus, originOf
} from "./core.js";
import { createReset } from "../reset.js";
import { runChecks, summary } from "./monitor.js";
import { keyView, pubUser } from "./routes-user.js";

const slugOk = s => /^[a-z0-9][a-z0-9-]{1,39}$/.test(s);
const page = (arr, q, size = 50) => {
  const p = int(q.get("page"), 1, 1000, 1);
  return { page: p, pages: Math.max(1, Math.ceil(arr.length / size)), total: arr.length, rows: arr.slice((p - 1) * size, p * size) };
};

function adminCat(c) {
  return {
    slug: c.slug, name: c.name, group: c.group, method: c.method, description: c.description, params: c.params || [],
    premium: !!c.premium, status: c.status, enabled: !!c.enabled, upstreamUrl: c.upstreamUrl || "",
    upstreamHeaderNames: Object.keys(c.upstreamHeaders || {}), exampleResponse: c.exampleResponse || "",
    effective: effStatus(c), order: c.order ?? 0, health: c.health || null
  };
}

export function register(R) {
  /* ---------- admin auth (separate from user login) ---------- */
  R["POST /admin/login"] = async (req, b, q, res) => {
    const ip = clientIp(req);
    need(!(await rateLimited(`dadip:${ip}`, 10, 600e3)), "Too many attempts. Please wait a few minutes.", 429);
    const username = str(b.username, 40), password = String(b.password ?? "").slice(0, 200);
    need(username && password, "Enter admin username and password.");
    need(!(await rateLimited(`dadacc:${username.toLowerCase()}`, 8, 600e3)), "Too many attempts for this account.", 429);
    const admins = await T("admins");
    let a = await admins.findOne({ usernameLower: username.toLowerCase() });
    if (!a && (await admins.countDocuments({})) === 0) {
      // first run: create the admin from environment variables (only when no admin exists yet)
      const eu = process.env.DEV_ADMIN_USERNAME, ep = process.env.DEV_ADMIN_PASSWORD;
      need(eu && ep && ep.length >= 10, "No admin configured. Set DEV_ADMIN_USERNAME and DEV_ADMIN_PASSWORD (10+ chars) in the environment.", 503);
      if (username.toLowerCase() === eu.toLowerCase() && password === ep) {
        a = { _id: rid(8), username: eu, usernameLower: eu.toLowerCase(), pw: await hashPw(ep), role: "admin", createdAt: Date.now() };
        await admins.insertOne(a);
      }
    }
    const ok = await checkPw(password, a?.pw || DUMMY_HASH);
    if (!a || !ok) { await logActivity(a?._id || "?", "admin_login_failed", `Failed admin login for ${username}`, ip); throw new HttpError(401, "Invalid admin credentials."); }
    await admins.updateOne({ _id: a._id }, { $set: { lastLogin: Date.now() } });
    await logActivity(a._id, "admin_login", "Admin logged in", ip);
    await startSession(req, res, "admin", a._id);
    return { admin: { id: a._id, username: a.username, role: a.role } };
  };
  R["POST /admin/logout"] = async (req, b, q, res) => { await endSession(req, res, "admin"); return { ok: 1 }; };
  R["GET /admin/me"] = async req => { const a = await requireAdmin(req); return { admin: { id: a._id, username: a.username, role: a.role } }; };
  R["POST /admin/password"] = async (req, b, q, res) => {
    const a = await requireAdmin(req);
    need(await checkPw(String(b.current ?? ""), a.pw), "Current password is wrong.");
    need(String(b.password ?? "").length >= 10, "Admin password must be at least 10 characters.");
    validPassword(String(b.password));
    await (await T("admins")).updateOne({ _id: a._id }, { $set: { pw: await hashPw(b.password) } });
    await (await T("sessions")).deleteMany({ uid: a._id, kind: "admin" });
    await startSession(req, res, "admin", a._id);
    return { ok: 1 };
  };
  R["GET /admin/admins"] = async req => {
    await requireAdmin(req);
    return (await (await T("admins")).find({}).toArray()).map(a => ({ id: a._id, username: a.username, createdAt: a.createdAt, lastLogin: a.lastLogin || null }));
  };
  R["POST /admin/admins"] = async (req, b) => {
    const me = await requireAdmin(req), username = str(b.username, 24);
    need(validUsername(username), "Username must be 3-24 characters: letters, numbers, . _ -");
    need(String(b.password ?? "").length >= 10, "Admin password must be at least 10 characters.");
    validPassword(String(b.password));
    const admins = await T("admins");
    need(!(await admins.findOne({ usernameLower: username.toLowerCase() })), "That admin username exists.", 409);
    await admins.insertOne({ _id: rid(8), username, usernameLower: username.toLowerCase(), pw: await hashPw(b.password), role: "admin", createdAt: Date.now() });
    await logActivity(me._id, "admin_created", `Admin ${username} created`, clientIp(req));
    return { ok: 1 };
  };
  R["POST /admin/admins/delete"] = async (req, b) => {
    const me = await requireAdmin(req), admins = await T("admins"), id = str(b.id, 40);
    need(id !== me._id, "You cannot delete yourself.");
    need((await admins.countDocuments({})) > 1, "At least one admin must remain.");
    await admins.deleteOne({ _id: id });
    await (await T("sessions")).deleteMany({ uid: id, kind: "admin" });
    return { ok: 1 };
  };

  /* ---------- dashboard ---------- */
  R["GET /admin/dashboard"] = async req => {
    await requireAdmin(req);
    const [users, keys, usage, tickets, cats, act] = [await T("users"), await T("api_keys"), await T("usage"), await T("tickets"), await T("categories"), await T("activity")];
    const [allUsers, totalKeys, totalReq, openTickets, catList, recent, sys] = await Promise.all([
      users.find({}).limit(50000).toArray(), keys.countDocuments({}), usage.countDocuments({}),
      tickets.countDocuments({ status: { $ne: "closed" } }), cats.find({ enabled: true }).toArray(),
      act.find({}).sort({ ts: -1 }).limit(15).toArray(), summary()
    ]);
    const prem = allUsers.filter(u => effectivePlan(u) !== "free").length;
    const st = catList.map(effStatus);
    const names = Object.fromEntries(allUsers.map(u => [u._id, u.username]));
    return {
      totalUsers: allUsers.length, totalKeys, totalRequests: totalReq, freeUsers: allUsers.length - prem, premiumUsers: prem,
      activeApis: st.filter(s => s === "online").length, offlineApis: st.filter(s => s === "offline").length,
      unconfiguredApis: st.filter(s => s === "not_configured").length, openTickets,
      recent: recent.map(a => ({ t: +new Date(a.ts), user: names[a.uid] || a.uid, type: a.type, msg: a.msg, ip: a.ip })),
      health: { dbLatency: sys.system.dbLatency, errorRate: sys.system.errorRate, requests24h: sys.system.requests24h, errors24h: sys.system.errors24h, avgGatewayMs: sys.system.avgGatewayMs, maintenance: sys.maintenance },
      hourly: sys.hourly
    };
  };

  /* ---------- users ---------- */
  R["GET /admin/users"] = async (req, b, q) => {
    await requireAdmin(req);
    const needle = str(q.get("q"), 60).toLowerCase();
    let list = await (await T("users")).find({}).sort({ createdAt: -1 }).limit(5000).toArray();
    if (needle) list = list.filter(u => u.usernameLower.includes(needle) || u.emailLower.includes(needle));
    const out = page(list, q);
    out.rows = out.rows.map(u => ({ ...pubUser(u), planLimit: u.planLimit ?? null, planRemaining: u.planRemaining ?? null, planUsed: u.planUsed || 0 }));
    return out;
  };

  R["POST /admin/users/update"] = async (req, b) => {
    const admin = await requireAdmin(req), users = await T("users");
    const u = await users.findOne({ _id: str(b.id, 40) });
    need(u, "User not found.", 404);
    const plans = await getPlans(), set = {};
    if (b.status !== undefined) { need(["active", "blocked"].includes(b.status), "Invalid status."); set.status = b.status; }

    const plan = b.plan !== undefined ? b.plan : u.plan;
    need(plan === "free" || plans[plan], "Unknown plan.");
    const touchesPlan = b.plan !== undefined || b.limit !== undefined || b.unlimited !== undefined || b.expiresAt !== undefined || b.expiryDays !== undefined || bool(b.resetUsage);
    if (touchesPlan) {
      if (plan === "free") Object.assign(set, { plan: "free", planExpires: null, planLimit: null, planRemaining: null });
      else {
        const pl = plans[plan];
        set.plan = plan;
        if (b.expiresAt !== undefined && b.expiresAt !== "") { const t = Date.parse(b.expiresAt); need(Number.isFinite(t) && t > Date.now(), "Expiry must be a future date."); set.planExpires = t; }
        else if (b.expiresAt === "" || (b.plan !== undefined && b.plan !== u.plan) || b.expiryDays !== undefined) {
          const days = b.expiryDays !== undefined ? int(b.expiryDays, 0, 3650, pl.expiryDays) : pl.expiryDays;
          set.planExpires = days ? Date.now() + days * DAY : null;
        }
        const unlimited = b.unlimited !== undefined ? bool(b.unlimited) : (b.limit !== undefined ? false : (b.plan !== undefined && b.plan !== u.plan ? !!pl.unlimited : u.planRemaining == null));
        const used = bool(b.resetUsage) ? 0 : (u.planUsed || 0);
        if (bool(b.resetUsage)) set.planUsed = 0;
        if (unlimited) { set.planLimit = null; set.planRemaining = null; }
        else {
          const limit = b.limit !== undefined ? int(b.limit, 0, 1e9, pl.limit) : (u.planLimit ?? pl.limit);
          set.planLimit = limit; set.planRemaining = Math.max(0, limit - used);
        }
      }
    }
    need(Object.keys(set).length, "Nothing to update.");
    await users.updateOne({ _id: u._id }, { $set: set });
    if (set.status === "blocked") await (await T("sessions")).deleteMany({ uid: u._id, kind: "user" });
    await logActivity(admin._id, "admin_user_update", `Updated ${u.username}: ${Object.keys(set).join(", ")}`, clientIp(req));
    return { user: pubUser({ ...u, ...set }) };
  };

  R["POST /admin/users/reset-link"] = async (req, b) => {
    const admin = await requireAdmin(req), u = await (await T("users")).findOne({ _id: str(b.id, 40) });
    need(u, "User not found.", 404);
    const token = await createReset("dev_resets", u._id);
    await logActivity(admin._id, "admin_reset_link", `Reset link created for ${u.username}`, clientIp(req));
    return { link: `${originOf(req)}/dev/login#reset=${token}`, expiresInMinutes: 30 };
  };

  /* ---------- API keys ---------- */
  R["GET /admin/keys"] = async (req, b, q) => {
    await requireAdmin(req);
    const needle = str(q.get("q"), 60).toLowerCase();
    const users = await (await T("users")).find({}).limit(5000).toArray();
    const names = Object.fromEntries(users.map(u => [u._id, u.username]));
    let list = await (await T("api_keys")).find({}).sort({ createdAt: -1 }).limit(5000).toArray();
    if (needle) list = list.filter(k => (names[k.userId] || "").toLowerCase().includes(needle) || k.name.toLowerCase().includes(needle));
    const out = page(list, q);
    out.rows = out.rows.map(k => ({ ...keyView(k), owner: names[k.userId] || "(deleted)" }));
    return out;
  };

  R["POST /admin/keys/update"] = async (req, b) => {
    const admin = await requireAdmin(req), keys = await T("api_keys");
    const k = await keys.findOne({ _id: str(b.id, 40) });
    need(k, "Key not found.", 404);
    const action = str(b.action, 20), set = {};
    if (action === "revoke") Object.assign(set, { status: "revoked", revokedAt: Date.now() });
    else if (action === "activate") { need(k.status !== "revoked", "Revoked keys stay revoked."); set.status = "active"; }
    else if (action === "deactivate") { need(k.status !== "revoked", "Key is revoked."); set.status = "inactive"; }
    else if (action === "limit") { const n = int(b.remaining, 0, 1e9, null); need(n !== null, "Enter a number."); set.remaining = n; if (n > (k.limit || 0)) set.limit = n; }
    else if (action === "expiry") { if (b.expiresAt) { const t = Date.parse(b.expiresAt); need(Number.isFinite(t), "Invalid date."); set.expiresAt = t; } else set.expiresAt = null; }
    else throw new HttpError(400, "Unknown action.");
    await keys.updateOne({ _id: k._id }, { $set: set });
    await logActivity(admin._id, "admin_key", `${action} key ${k.prefix}`, clientIp(req));
    return { ok: 1 };
  };

  /* ---------- categories / endpoints ---------- */
  R["GET /admin/categories"] = async req => {
    await requireAdmin(req);
    return (await (await T("categories")).find({}).sort({ order: 1 }).toArray()).map(adminCat);
  };

  R["POST /admin/categories"] = async (req, b) => {
    const admin = await requireAdmin(req), cats = await T("categories");
    const slug = str(b.slug, 40).toLowerCase(); need(slugOk(slug), "Slug: 2-40 chars, lowercase letters, numbers and dashes.");
    const name = str(b.name, 60); need(name, "Enter a name.");
    const method = ["GET", "POST"].includes(b.method) ? b.method : "GET";
    const params = (Array.isArray(b.params) ? b.params : []).slice(0, 15).map(p => {
      const n = str(p.name, 30); need(/^[A-Za-z_][\w-]{0,29}$/.test(n), `Invalid parameter name: ${n}`);
      return { name: n, type: p.type === "integer" ? "integer" : "string", required: bool(p.required), description: str(p.description, 160) };
    });
    let upstreamUrl = str(b.upstreamUrl, 500);
    if (upstreamUrl) upstreamUrl = (await assertPublicUrl(upstreamUrl)).toString();
    if (b.exampleResponse) { try { JSON.parse(b.exampleResponse); } catch { throw new HttpError(400, "Example response must be valid JSON."); } }
    const old = await cats.findOne({ _id: slug });
    let headers = old?.upstreamHeaders || {};
    if (b.upstreamHeaders !== undefined) {
      if (!String(b.upstreamHeaders).trim()) headers = {};
      else {
        let h; try { h = JSON.parse(b.upstreamHeaders); } catch { throw new HttpError(400, "Upstream headers must be a JSON object."); }
        need(h && typeof h === "object" && !Array.isArray(h) && Object.keys(h).length <= 10, "Upstream headers must be a JSON object (max 10).");
        headers = Object.fromEntries(Object.entries(h).map(([k, v]) => { need(/^[\w-]{1,40}$/.test(k), `Bad header name: ${k}`); return [k, str(v, 300)]; }));
      }
    }
    const doc = {
      slug, name, group: str(b.group, 30) || "movies", method, description: str(b.description, 400), params,
      premium: bool(b.premium), status: ["active", "offline", "maintenance"].includes(b.status) ? b.status : "active",
      enabled: b.enabled === undefined ? true : bool(b.enabled), upstreamUrl, upstreamHeaders: headers,
      exampleResponse: str(b.exampleResponse, 6000), order: int(b.order, 0, 9999, old?.order ?? 999)
    };
    if (old) await cats.updateOne({ _id: slug }, { $set: doc });
    else await cats.insertOne({ _id: slug, ...doc, createdAt: Date.now(), health: { state: "unconfigured", latency: null, checkedAt: null } });
    await logActivity(admin._id, "admin_category", `${old ? "Updated" : "Created"} API ${slug}`, clientIp(req));
    return { category: adminCat({ ...(old || {}), ...doc }) };
  };

  R["POST /admin/categories/delete"] = async (req, b) => {
    const admin = await requireAdmin(req), slug = str(b.slug, 40);
    const r = await (await T("categories")).deleteOne({ _id: slug });
    need(r.deletedCount, "Category not found.", 404);
    await logActivity(admin._id, "admin_category", `Deleted API ${slug}`, clientIp(req));
    return { ok: 1 };
  };

  /* ---------- plans ---------- */
  R["GET /admin/plans"] = async req => {
    await requireAdmin(req);
    const p = await getPlans();
    return ["free", "premium1", "premium2"].filter(k => p[k]).map(k => ({ id: k, ...p[k], _id: undefined }));
  };
  R["POST /admin/plans/update"] = async (req, b) => {
    const admin = await requireAdmin(req), id = str(b.id, 20);
    need(["free", "premium1", "premium2"].includes(id), "Unknown plan.");
    const set = {
      name: str(b.name, 40) || id, description: str(b.description, 300),
      limit: int(b.limit, 0, 1e9, 50), unlimited: id === "free" ? false : bool(b.unlimited),
      expiryDays: id === "free" ? 0 : int(b.expiryDays, 0, 3650, 30), rpm: int(b.rpm, 1, 10000, 10), maxKeys: int(b.maxKeys, 1, 100, 3)
    };
    await (await T("plans")).updateOne({ _id: id }, { $set: set }, { upsert: true });
    await logActivity(admin._id, "admin_plan", `Updated plan ${id}`, clientIp(req));
    return { ok: 1 };
  };

  /* ---------- usage + logs ---------- */
  R["GET /admin/usage"] = async (req, b, q) => {
    await requireAdmin(req);
    const days = int(q.get("days"), 1, 90, 30);
    const docs = await (await T("usage")).find({ ts: { $gte: new Date(Date.now() - days * DAY) } }).limit(50000).toArray();
    const users = await (await T("users")).find({}).limit(5000).toArray();
    const names = Object.fromEntries(users.map(u => [u._id, u.username]));
    const tally = f => { const m = {}; docs.forEach(d => { const k = f(d); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, c) => c.count - a.count).slice(0, 10); };
    const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.now() - (days - 1 - i) * DAY).toISOString().slice(0, 10), total: 0, errors: 0 }));
    const ix = Object.fromEntries(daily.map((d, i) => [d.date, i]));
    docs.forEach(d => { const i = ix[new Date(d.ts).toISOString().slice(0, 10)]; if (i !== undefined) { daily[i].total++; if (!d.ok) daily[i].errors++; } });
    return { days, total: docs.length, errors: docs.filter(d => !d.ok).length, daily, byApi: tally(d => d.slug), byUser: tally(d => names[d.userId] || "unknown"), byStatus: tally(d => String(d.status)) };
  };

  R["GET /admin/logs"] = async (req, b, q) => {
    await requireAdmin(req);
    const type = q.get("type") === "activity" ? "activity" : "requests", needle = str(q.get("q"), 60).toLowerCase();
    const users = await (await T("users")).find({}).limit(5000).toArray();
    const names = Object.fromEntries(users.map(u => [u._id, u.username]));
    if (type === "requests") {
      const f = {}; if (q.get("ok") === "0") f.ok = false;
      let rows = await (await T("usage")).find(f).sort({ ts: -1 }).limit(1000).toArray();
      if (needle) rows = rows.filter(r => `${r.slug} ${r.ip} ${r.status} ${r.code || ""} ${names[r.userId] || ""}`.toLowerCase().includes(needle));
      const out = page(rows, q, 30);
      out.rows = out.rows.map(r => ({ t: +new Date(r.ts), user: names[r.userId] || "-", slug: r.slug, method: r.method, status: r.status, ms: r.ms, ip: r.ip, code: r.code || "" }));
      return out;
    }
    const f = {}; if (q.get("kind")) f.type = str(q.get("kind"), 30);
    let rows = await (await T("activity")).find(f).sort({ ts: -1 }).limit(1000).toArray();
    if (needle) rows = rows.filter(r => `${r.type} ${r.msg} ${r.ip} ${names[r.uid] || ""}`.toLowerCase().includes(needle));
    const out = page(rows, q, 30);
    out.rows = out.rows.map(r => ({ t: +new Date(r.ts), user: names[r.uid] || r.uid, type: r.type, msg: r.msg, ip: r.ip }));
    return out;
  };

  /* ---------- tickets ---------- */
  R["GET /admin/tickets"] = async (req, b, q) => {
    await requireAdmin(req);
    const f = {}; const s = q.get("status"); if (["open", "answered", "closed"].includes(s)) f.status = s;
    const list = await (await T("tickets")).find(f).sort({ updatedAt: -1 }).limit(300).toArray();
    return list.map(t => ({ id: t._id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, user: t.username, updatedAt: t.updatedAt, unread: !!t.unreadAdmin, messages: t.messages.length }));
  };
  R["GET /admin/tickets/get"] = async (req, b, q) => {
    await requireAdmin(req);
    const tickets = await T("tickets"), t = await tickets.findOne({ _id: str(q.get("id"), 40) });
    need(t, "Ticket not found.", 404);
    if (t.unreadAdmin) await tickets.updateOne({ _id: t._id }, { $set: { unreadAdmin: false } });
    return { ticket: { id: t._id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, user: t.username, createdAt: t.createdAt, messages: t.messages } };
  };
  R["POST /admin/tickets/reply"] = async (req, b) => {
    const admin = await requireAdmin(req), tickets = await T("tickets");
    const t = await tickets.findOne({ _id: str(b.id, 40) });
    need(t, "Ticket not found.", 404);
    const text = str(b.message, 4000), status = ["open", "answered", "closed"].includes(b.status) ? b.status : "answered";
    need(text.length >= 2 || b.status, "Write a reply or change the status.");
    const now = Date.now(), upd = { $set: { status, updatedAt: now, unreadAdmin: false } };
    if (text.length >= 2) { upd.$push = { messages: { by: "admin", name: admin.username, text, t: now } }; upd.$set.unreadUser = true; }
    await tickets.updateOne({ _id: t._id }, upd);
    return { ok: 1 };
  };

  /* ---------- announcements / changelog / plugins ---------- */
  R["GET /admin/announcements"] = async req => {
    await requireAdmin(req);
    return (await (await T("announcements")).find({}).sort({ t: -1 }).limit(100).toArray()).map(a => ({ id: a._id, title: a.title, body: a.body, level: a.level, active: a.active, t: a.t }));
  };
  R["POST /admin/announcements"] = async (req, b) => {
    const admin = await requireAdmin(req), col = await T("announcements");
    const doc = { title: str(b.title, 100), body: str(b.body, 600), level: ["info", "warning", "success"].includes(b.level) ? b.level : "info", active: b.active === undefined ? true : bool(b.active) };
    need(doc.title, "Enter a title.");
    if (b.id) { const r = await col.updateOne({ _id: str(b.id, 40) }, { $set: doc }); need(r.matchedCount, "Not found.", 404); }
    else await col.insertOne({ _id: rid(6), ...doc, t: Date.now() });
    await logActivity(admin._id, "admin_announce", `Announcement: ${doc.title}`, clientIp(req));
    return { ok: 1 };
  };
  R["POST /admin/announcements/delete"] = async (req, b) => { await requireAdmin(req); await (await T("announcements")).deleteOne({ _id: str(b.id, 40) }); return { ok: 1 }; };

  R["GET /admin/changelog"] = async req => {
    await requireAdmin(req);
    return (await (await T("changelog")).find({}).sort({ date: -1, createdAt: -1 }).limit(200).toArray()).map(c => ({ id: c._id, version: c.version, type: c.type, title: c.title, body: c.body, date: c.date }));
  };
  R["POST /admin/changelog"] = async (req, b) => {
    const admin = await requireAdmin(req), col = await T("changelog");
    const date = str(b.date, 10) || new Date().toISOString().slice(0, 10);
    need(/^\d{4}-\d{2}-\d{2}$/.test(date), "Date must be YYYY-MM-DD.");
    const doc = { version: str(b.version, 20), type: ["new", "update", "fix", "breaking"].includes(b.type) ? b.type : "update", title: str(b.title, 120), body: str(b.body, 3000), date };
    need(doc.version && doc.title, "Version and title are required.");
    if (b.id) { const r = await col.updateOne({ _id: str(b.id, 40) }, { $set: doc }); need(r.matchedCount, "Not found.", 404); }
    else await col.insertOne({ _id: rid(6), ...doc, createdAt: Date.now() });
    await logActivity(admin._id, "admin_changelog", `Changelog ${doc.version}`, clientIp(req));
    return { ok: 1 };
  };
  R["POST /admin/changelog/delete"] = async (req, b) => { await requireAdmin(req); await (await T("changelog")).deleteOne({ _id: str(b.id, 40) }); return { ok: 1 }; };

  R["GET /admin/plugins"] = async req => {
    await requireAdmin(req);
    return (await (await T("plugins")).find({}).sort({ createdAt: -1 }).toArray()).map(({ _id, ...p }) => p);
  };
  R["POST /admin/plugins"] = async (req, b) => {
    const admin = await requireAdmin(req), col = await T("plugins");
    const slug = str(b.slug, 40).toLowerCase(); need(slugOk(slug), "Slug: 2-40 chars, lowercase letters, numbers and dashes.");
    const doc = {
      slug, name: str(b.name, 80), category: str(b.category, 40) || "General", shortDesc: str(b.shortDesc, 160), description: str(b.description, 2000),
      docs: str(b.docs, 6000), install: str(b.install, 2000), code: str(b.code, 20000), version: str(b.version, 20) || "1.0.0",
      author: str(b.author, 60) || "SHAN MD", apiCategories: (Array.isArray(b.apiCategories) ? b.apiCategories : String(b.apiCategories || "").split(",")).map(x => str(x, 40)).filter(Boolean).slice(0, 12),
      published: b.published === undefined ? true : bool(b.published)
    };
    need(doc.name, "Enter a plugin name.");
    const old = await col.findOne({ _id: slug });
    if (old) await col.updateOne({ _id: slug }, { $set: doc }); else await col.insertOne({ _id: slug, ...doc, createdAt: Date.now() });
    await logActivity(admin._id, "admin_plugin", `${old ? "Updated" : "Added"} plugin ${slug}`, clientIp(req));
    return { ok: 1 };
  };
  R["POST /admin/plugins/delete"] = async (req, b) => { await requireAdmin(req); await (await T("plugins")).deleteOne({ _id: str(b.slug, 40) }); return { ok: 1 }; };

  /* ---------- maintenance + monitoring ---------- */
  R["GET /admin/maintenance"] = async req => { await requireAdmin(req); return getSetting("maintenance", { on: false, message: "" }); };
  R["POST /admin/maintenance"] = async (req, b) => {
    const admin = await requireAdmin(req), v = { on: bool(b.on), message: str(b.message, 300) };
    await setSetting("maintenance", v);
    await logActivity(admin._id, "admin_maintenance", `Maintenance ${v.on ? "ON" : "OFF"}`, clientIp(req));
    return v;
  };
  R["POST /admin/monitor/run"] = async req => { await requireAdmin(req); return runChecks(true); };
  R["GET /admin/monitor"] = async req => { await requireAdmin(req); return summary(); };
}

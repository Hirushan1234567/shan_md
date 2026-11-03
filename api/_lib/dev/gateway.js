import {
  T, str, sha256, effectivePlan, getPlans, getSetting, normIp, ipMatches, clientIp,
  rateLimited, peekLimited, assertPublicUrl, logActivity, HttpError
} from "./core.js";

class GwError extends Error {
  constructor(status, code, message, retry) { super(message); this.status = status; this.code = code; this.retry = retry; }
}

const bearerKey = req => {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer shan_") ? h.slice(7) : "";
};

/** Atomically spends one request. Returns {remaining, refund}. */
async function spend(kd, user, plan, ip) {
  const keys = await T("api_keys"), users = await T("users"), now = Date.now();
  if (plan === "free") {
    const r = await keys.updateOne({ _id: kd._id, remaining: { $gt: 0 } },
      { $inc: { remaining: -1, used: 1 }, $set: { lastUsedAt: now, lastIp: ip } });
    if (!r.modifiedCount) throw new GwError(429, "QUOTA_EXHAUSTED", `This free API key has used all ${kd.limit ?? 50} of its lifetime requests. Upgrade to Premium to continue.`);
    return { remaining: (kd.remaining ?? 1) - 1, refund: () => keys.updateOne({ _id: kd._id }, { $inc: { remaining: 1, used: -1 } }) };
  }
  if (user.planRemaining == null) {
    await users.updateOne({ _id: user._id }, { $inc: { planUsed: 1 } });
    await keys.updateOne({ _id: kd._id }, { $inc: { used: 1 }, $set: { lastUsedAt: now, lastIp: ip } });
    return { remaining: "unlimited", refund: () => users.updateOne({ _id: user._id }, { $inc: { planUsed: -1 } }) };
  }
  const r = await users.updateOne({ _id: user._id, planRemaining: { $gt: 0 } }, { $inc: { planRemaining: -1, planUsed: 1 } });
  if (!r.modifiedCount) throw new GwError(429, "QUOTA_EXHAUSTED", "Your Premium request limit has been reached. Contact the admin to extend it.");
  await keys.updateOne({ _id: kd._id }, { $inc: { used: 1 }, $set: { lastUsedAt: now, lastIp: ip } });
  return { remaining: user.planRemaining - 1, refund: () => users.updateOne({ _id: user._id }, { $inc: { planRemaining: 1, planUsed: -1 } }) };
}

async function record(ctx, status, extra = {}) {
  try {
    await (await T("usage")).insertOne({
      ts: new Date(), keyId: ctx.key?._id || null, userId: ctx.key?.userId || null, slug: ctx.slug,
      method: ctx.method, status, ok: status < 400, ms: Date.now() - ctx.t0, ip: ctx.ip, ...extra
    });
  } catch { /* logging must not break the response */ }
}

export async function gateway(req, res, slug, query) {
  const ctx = { slug: str(slug, 60), ip: normIp(clientIp(req)), method: req.method, t0: Date.now() };
  try {
    const maint = await getSetting("maintenance", { on: false, message: "" });
    if (maint.on) throw new GwError(503, "MAINTENANCE", maint.message || "The platform is under maintenance. Please try again later.");

    if (await peekLimited(`badkey:${ctx.ip}`, 20, 10 * 60 * 1000)) throw new GwError(429, "TOO_MANY_INVALID_KEYS", "Too many invalid API keys from this IP. Try again in a few minutes.", 600);
    const raw = str(req.headers["x-api-key"] || bearerKey(req) || query.get("apikey"), 100);
    if (!raw) throw new GwError(401, "MISSING_API_KEY", "Send your API key in the x-api-key header.");

    const kd = await (await T("api_keys")).findOne({ hash: sha256(raw) });
    if (!kd) {
      await rateLimited(`badkey:${ctx.ip}`, 20, 10 * 60 * 1000);
      throw new GwError(401, "INVALID_API_KEY", "Invalid API key.");
    }
    ctx.key = kd;
    if (kd.status === "revoked") throw new GwError(401, "KEY_REVOKED", "This API key has been revoked.");
    if (kd.status !== "active") throw new GwError(403, "KEY_DISABLED", "This API key is deactivated.");
    if (kd.expiresAt && kd.expiresAt < Date.now()) throw new GwError(401, "KEY_EXPIRED", "This API key has expired.");

    const user = await (await T("users")).findOne({ _id: kd.userId });
    if (!user || user.status === "blocked") throw new GwError(403, "ACCOUNT_BLOCKED", "This account is blocked.");

    if ((kd.ips || []).length && !kd.ips.some(r => ipMatches(ctx.ip, r))) {
      await logActivity(user._id, "suspicious", `Key ${kd.prefix} used from non-whitelisted IP ${ctx.ip}`, ctx.ip);
      throw new GwError(403, "IP_NOT_ALLOWED", "This API key is restricted to other IP addresses.");
    }

    const cat = await (await T("categories")).findOne({ _id: ctx.slug });
    if (!cat || !cat.enabled) throw new GwError(404, "API_NOT_FOUND", "Unknown API endpoint.");
    if (cat.status !== "active") throw new GwError(503, "API_OFFLINE", "This API is temporarily offline.");

    const plan = effectivePlan(user), pl = (await getPlans())[plan] || { rpm: 10 };
    if (cat.premium && plan === "free") throw new GwError(403, "PREMIUM_REQUIRED", "This API category requires a Premium plan.");
    if (!cat.upstreamUrl) throw new GwError(503, "UPSTREAM_NOT_CONFIGURED", "This API has no data source connected yet.");
    if (req.method !== cat.method && req.method !== "HEAD") throw new GwError(405, "METHOD_NOT_ALLOWED", `Use ${cat.method} for this endpoint.`);

    const qs = new URLSearchParams();
    for (const p of cat.params || []) {
      const v = str(query.get(p.name), 200);
      if (!v) { if (p.required) throw new GwError(400, "MISSING_PARAMETER", `Missing required parameter: ${p.name}`); continue; }
      if (p.type === "integer" && !/^\d{1,9}$/.test(v)) throw new GwError(400, "INVALID_PARAMETER", `Parameter ${p.name} must be an integer.`);
      qs.set(p.name, v);
    }

    if (await rateLimited(`gw:${kd._id}`, pl.rpm || 10, 60 * 1000)) throw new GwError(429, "RATE_LIMITED", `Rate limit exceeded (${pl.rpm}/minute for your plan).`, 60);

    const sp = await spend(kd, user, plan, ctx.ip);
    let upstream, data;
    try {
      const url = await assertPublicUrl(cat.upstreamUrl);
      for (const [k, v] of qs) url.searchParams.set(k, v);
      const r = await fetch(url, {
        method: cat.method, redirect: "manual", signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json", "User-Agent": "SHAN-API-Gateway/2.0", ...(cat.upstreamHeaders || {}) }
      });
      const text = (await r.text()).slice(0, 2_000_000);
      upstream = r.status;
      if (r.status >= 500 || (r.status >= 300 && r.status < 400)) throw new Error("upstream " + r.status);
      try { data = JSON.parse(text); } catch { throw new Error("upstream returned non-JSON"); }
    } catch (e) {
      await sp.refund();
      throw new GwError(502, "UPSTREAM_ERROR", "The data source did not respond correctly. Your request was not counted.");
    }
    if (upstream >= 400) {
      const code = upstream === 404 ? 404 : 400;
      await record(ctx, code, { upstream });
      return res.status(code).json({ status: false, error: { code: "UPSTREAM_REJECTED", message: `The data source rejected the request (HTTP ${upstream}).` }, data });
    }

    // suspicious-use detection: one key used from many IPs within 10 minutes (never fails the request)
    try {
      const others = await (await T("usage")).countDocuments({ keyId: kd._id, ts: { $gt: new Date(Date.now() - 600000) }, ip: { $ne: ctx.ip } });
      if (others >= 20 && !(await rateLimited(`susp:${kd._id}`, 1, 600000))) {
        await logActivity(user._id, "suspicious", `Key ${kd.prefix} is being used from multiple IPs`, ctx.ip);
      }
    } catch { /* ignore */ }

    const ms = Date.now() - ctx.t0;
    await record(ctx, 200, { upstream });
    res.setHeader("X-Plan", plan);
    res.setHeader("X-Quota-Remaining", String(sp.remaining));
    return res.status(200).json({ status: true, api: ctx.slug, data, meta: { plan, remaining: sp.remaining, responseTimeMs: ms } });
  } catch (e) {
    if (!(e instanceof GwError)) { console.error("gateway error:", e?.message || e); e = new GwError(500, "SERVER_ERROR", "Server error. Try again."); }
    if (ctx.key) await record(ctx, e.status, { code: e.code });
    if (e.retry) res.setHeader("Retry-After", String(e.retry));
    res.status(e.status).json({ status: false, error: { code: e.code, message: e.message } });
  }
}

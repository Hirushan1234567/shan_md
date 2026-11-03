import { T, DAY, rateLimited, assertPublicUrl, effStatus, getSetting } from "./core.js";

async function checkOne(c) {
  const t0 = Date.now();
  try {
    const url = await assertPublicUrl(c.upstreamUrl);
    const r = await fetch(url, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "SHAN-API-Monitor/2.0", ...(c.upstreamHeaders || {}) }
    });
    await r.arrayBuffer().catch(() => {});
    return { state: r.status < 500 ? "up" : "down", latency: Date.now() - t0, http: r.status };
  } catch (e) {
    return { state: "down", latency: Date.now() - t0, error: String(e?.message || e).slice(0, 120) };
  }
}

/** Pings every configured upstream. Unless forced, at most one run per ~25 s platform-wide. */
export async function runChecks(force = false) {
  if (!force && (await rateLimited("dev-monitor-run", 1, 25000))) return { skipped: true };
  const cats = await (await T("categories")).find({ enabled: true }).toArray();
  const mon = await T("monitor"), catCol = await T("categories");
  const results = await Promise.all(cats.map(async c => {
    if (!c.upstreamUrl) return null;
    const r = await checkOne(c);
    const checkedAt = Date.now();
    await mon.insertOne({ ts: new Date(), slug: c.slug, ...r });
    await catCol.updateOne({ _id: c._id }, { $set: { health: { state: r.state, latency: r.latency, checkedAt } } });
    return { slug: c.slug, ...r };
  }));
  // database latency (system check)
  const t0 = Date.now();
  await (await T("settings")).findOne({ _id: "seeded" });
  await mon.insertOne({ ts: new Date(), slug: "__db", state: "up", latency: Date.now() - t0 });
  return { skipped: false, checked: results.filter(Boolean).length };
}

export async function summary() {
  const since = new Date(Date.now() - DAY);
  const cats = await (await T("categories")).find({ enabled: true }).sort({ order: 1 }).toArray();
  const recs = await (await T("monitor")).find({ ts: { $gte: since } }).sort({ ts: -1 }).limit(5000).toArray();
  const bySlug = {};
  for (const r of recs) (bySlug[r.slug] ||= []).push(r);

  const apis = cats.map(c => {
    const list = bySlug[c.slug] || [];
    const up = list.filter(x => x.state === "up").length;
    const lat = list.filter(x => x.state === "up" && x.latency != null).map(x => x.latency);
    return {
      slug: c.slug, name: c.name, status: effStatus(c), premium: !!c.premium,
      latency: c.health?.latency ?? null, checkedAt: c.health?.checkedAt ?? null,
      uptime: list.length ? Math.round((up / list.length) * 1000) / 10 : null,
      avgLatency: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
      checks: list.length,
      series: list.slice(0, 40).reverse().map(x => ({ t: +new Date(x.ts), ms: x.latency, state: x.state }))
    };
  });

  const usage = await (await T("usage")).find({ ts: { $gte: since } }).sort({ ts: -1 }).limit(20000).toArray();
  const errors = usage.filter(u => !u.ok);
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const start = Date.now() - (23 - i) * 36e5;
    const inH = usage.filter(u => +new Date(u.ts) >= start && +new Date(u.ts) < start + 36e5);
    return { t: start, requests: inH.length, errors: inH.filter(u => !u.ok).length };
  });
  const db = (bySlug.__db || []).slice(0, 40).reverse().map(x => ({ t: +new Date(x.ts), ms: x.latency }));
  const msOk = usage.filter(u => u.ok && u.ms != null).map(u => u.ms);
  const maint = await getSetting("maintenance", { on: false, message: "" });

  return {
    now: Date.now(), maintenance: maint,
    system: {
      requests24h: usage.length, errors24h: errors.length,
      errorRate: usage.length ? Math.round((errors.length / usage.length) * 1000) / 10 : 0,
      avgGatewayMs: msOk.length ? Math.round(msOk.reduce((a, b) => a + b, 0) / msOk.length) : null,
      dbLatency: db.length ? db[db.length - 1].ms : null, dbSeries: db
    },
    apis, hourly,
    recentErrors: errors.slice(0, 15).map(e => ({ t: +new Date(e.ts), slug: e.slug, status: e.status, code: e.code || "" }))
  };
}

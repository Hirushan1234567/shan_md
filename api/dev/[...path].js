import { ensureReady, getSetting, HttpError, safeCompare } from "../_lib/dev/core.js";
import { gateway } from "../_lib/dev/gateway.js";
import { runChecks } from "../_lib/dev/monitor.js";
import { register as userRoutes } from "../_lib/dev/routes-user.js";
import { register as adminRoutes } from "../_lib/dev/routes-admin.js";

/* SHAN API Developer Platform V2 — single serverless entry: /api/dev/*
   Own collections (dev_*), own cookie sessions, own admin accounts. Independent from the Coins site. */

const R = {};
userRoutes(R);
adminRoutes(R);

R["GET /cron/health"] = async req => {
  const s = process.env.CRON_SECRET;
  if (!s) throw new HttpError(503, "CRON_SECRET is not configured.");
  if (!safeCompare(String(req.headers.authorization || ""), `Bearer ${s}`)) throw new HttpError(401, "Unauthorized.");
  return runChecks(true);
};

function secureHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export default async function handler(req, res) {
  secureHeaders(res);
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/api\/dev/, "").replace(/\/+$/, "") || "/";

    // public API gateway: authenticated by API key, open CORS so bots/websites can call it
    if (path.startsWith("/v1/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "x-api-key, authorization, content-type");
      res.setHeader("Access-Control-Expose-Headers", "x-quota-remaining, x-plan, retry-after");
      if (req.method === "OPTIONS") return res.status(204).end();
      await ensureReady();
      return await gateway(req, res, path.slice(4), url.searchParams);
    }

    await ensureReady();
    const fn = R[`${req.method} ${path}`];
    if (!fn) return res.status(404).json({ error: "Unknown route." });

    // CSRF: cookie auth + SameSite=Strict + a custom header that cross-site forms cannot send
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "shan-dev") throw new HttpError(403, "Missing request header.");

    // maintenance blocks everything except /status, admin routes and cron
    if (!path.startsWith("/admin") && path !== "/status" && !path.startsWith("/cron")) {
      const m = await getSetting("maintenance", { on: false, message: "" });
      if (m.on) return res.status(503).json({ error: m.message || "The platform is under maintenance.", maintenance: true });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await fn(req, body, url.searchParams, res);
    res.status(200).json(out ?? { ok: 1 });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("dev api error:", e?.message || e);
    res.status(500).json({ error: "Server error. Try again." });
  }
}

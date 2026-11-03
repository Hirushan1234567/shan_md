// End-to-end API tests. Run: npm test   (uses an in-memory MongoDB stand-in + a local fake "upstream")
import http from "node:http";
Object.assign(process.env, {
  MONGODB_URI: "mock://x", AUTH_SECRET: "test-secret-test-secret-123456", ADMIN_PASSWORD: "coins-admin-pass",
  DEV_ADMIN_USERNAME: "root", DEV_ADMIN_PASSWORD: "RootPassw0rd!!", CRON_SECRET: "cron-secret", DEV_ALLOW_PRIVATE_UPSTREAM: "1"
});
const { startServer } = await import("./server.mjs");
const { __stores } = await import("./mock-mongodb.mjs");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${cond ? "" : " " + extra}`); };
const section = t => console.log("\n" + t);

// fake upstream data source
let upstreamHits = 0;
const up = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); upstreamHits++;
  res.setHeader("content-type", "application/json");
  if (u.searchParams.get("q") === "boom") { res.statusCode = 500; return res.end("{}"); }
  res.end(JSON.stringify({ results: [{ id: "1", title: "Test Movie " + (u.searchParams.get("q") || "") }] }));
});
await new Promise(r => up.listen(0, "127.0.0.1", r));
const UP = `http://127.0.0.1:${up.address().port}/data`;

const { port } = await startServer();
const BASE = `http://127.0.0.1:${port}/api/dev`;

function client() {
  const jar = {};
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method, redirect: "manual",
      headers: { "content-type": "application/json", "x-requested-with": "shan-dev", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    r.headers.getSetCookie().forEach(c => { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); v ? (jar[kv.slice(0, i)] = v) : delete jar[kv.slice(0, i)]; });
    const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, headers: r.headers, raw: r };
  };
  return { call, jar, get: (p, h) => call("GET", p, null, h), post: (p, b, h) => call("POST", p, b || {}, h) };
}
const gw = async (slug, key, qs = "", ip = "203.0.113.5", extra = {}) => {
  const r = await fetch(`${BASE}/v1/${slug}${qs}`, { headers: { ...(key ? { "x-api-key": key } : {}), "x-forwarded-for": ip, ...extra } });
  return { status: r.status, json: await r.json(), headers: r.headers };
};

const admin = client(), alice = client(), bob = client();
const PW = "Str0ngPass99";

section("Public");
let r = await alice.get("/status");
ok("status endpoint", r.status === 200 && r.json.maintenance.on === false);
r = await alice.get("/catalog");
ok("catalog lists the 11 required categories", r.json.length === 11, r.status);
const names = r.json.map(c => c.name);
ok("category names match spec", ["Sinhala Movies", "Tamil Movies", "English Movies", "Action Movies", "Comedy Movies", "Horror Movies", "Drama Movies", "Latest Movies", "TV Series", "Subtitles", "Movie Downloads"].every(n => names.includes(n)));
ok("catalog never leaks upstream details", !JSON.stringify(r.json).includes("upstream"));

section("Registration + login + sessions");
r = await alice.post("/auth/register", { username: "alice", email: "alice@example.com", password: "short" });
ok("weak password rejected", r.status === 400);
r = await alice.post("/auth/register", { username: "al", email: "alice@example.com", password: PW });
ok("bad username rejected", r.status === 400);
r = await alice.post("/auth/register", { username: "alice", email: "alice@example.com", password: PW });
ok("register works", r.status === 200 && r.json.user.plan === "free");
const ck = r.raw.headers.getSetCookie().join(";");
ok("session cookie is HttpOnly + SameSite=Strict", /HttpOnly/.test(ck) && /SameSite=Strict/.test(ck));
r = await client().post("/auth/register", { username: "Alice", email: "other@example.com", password: PW });
ok("duplicate username (case-insens.) rejected", r.status === 409);
r = await alice.get("/me");
ok("session works (/me)", r.status === 200 && r.json.user.username === "alice");
ok("no password hash in profile", !JSON.stringify(r.json).includes("pw"));
r = await fetch(BASE + "/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
ok("CSRF: POST without custom header is refused", r.status === 403);
await alice.post("/auth/logout");
r = await alice.get("/me");
ok("logout destroys session", r.status === 401);
r = await alice.post("/auth/login", { username: "alice", password: "WrongPass1" });
ok("wrong password rejected", r.status === 401);
r = await alice.post("/auth/login", { username: "alice@example.com", password: PW });
ok("login by email works", r.status === 200);
r = await alice.get("/admin/me");
ok("normal user cannot reach admin routes", r.status === 401);
r = await alice.get("/admin/dashboard");
ok("user cookie rejected on admin dashboard", r.status === 401);

section("Login brute-force protection");
const victim = client();
await victim.post("/auth/register", { username: "victim", email: "v@example.com", password: PW });
let last; for (let i = 0; i < 10; i++) last = await client().post("/auth/login", { username: "victim", password: "nope" + i });
ok("account locked after repeated failures", last.status === 429, last.status);
r = await client().post("/auth/login", { username: "victim", password: PW });
ok("even correct password is throttled during lockout", r.status === 429);

section("Admin login (separate)");
r = await admin.post("/admin/login", { username: "root", password: "bad" });
ok("wrong admin password rejected", r.status === 401);
r = await admin.post("/admin/login", { username: "root", password: process.env.DEV_ADMIN_PASSWORD });
ok("admin bootstrap login from env", r.status === 200);
r = await admin.get("/me");
ok("admin cookie is not a user session", r.status === 401);
r = await admin.get("/admin/dashboard");
ok("admin dashboard", r.status === 200 && r.json.totalUsers >= 2 && r.json.freeUsers >= 2, JSON.stringify(r.json).slice(0, 120));
ok("dashboard shows 11 APIs, none connected yet", r.json.unconfiguredApis === 11 && r.json.activeApis === 0);

section("API keys");
r = await alice.post("/keys", { name: "bot", ips: "not-an-ip" });
ok("invalid IP rule rejected", r.status === 400);
r = await alice.post("/keys", { name: "bot" });
const KEY = r.json.key, KEYID = r.json.item.id;
ok("key generated, shown once", /^shan_live_/.test(KEY) && r.json.item.remaining === 50 && r.json.item.limit === 50);
r = await alice.get("/keys");
ok("list never returns the secret or hash", !JSON.stringify(r.json).includes(KEY) && !JSON.stringify(r.json).includes("hash"));
const stored = JSON.stringify([...__stores.get("dev_api_keys").docs]);
ok("database stores only the SHA-256 hash", !stored.includes(KEY) && /[0-9a-f]{64}/.test(stored));
await alice.post("/keys", { name: "k2" }); await alice.post("/keys", { name: "k3" });
r = await alice.post("/keys", { name: "k4" });
ok("free plan key limit enforced (max 3)", r.status === 400);
const k3 = (await alice.get("/keys")).json.keys.find(k => k.name === "k3");
r = await alice.post("/keys/revoke", { id: k3.id });
r = await alice.post("/keys", { name: "k4" });
ok("revoking frees a slot", r.status === 200);
r = await bob.post("/auth/register", { username: "bobby", email: "bob@example.com", password: PW });
r = await bob.post("/keys/revoke", { id: KEYID });
ok("cannot touch another user's key", r.status === 404);

section("Gateway: authentication");
r = await gw("english-movies", "");
ok("missing key -> 401", r.status === 401 && r.json.error.code === "MISSING_API_KEY");
r = await gw("english-movies", "shan_live_doesnotexist");
ok("invalid key -> 401", r.status === 401 && r.json.error.code === "INVALID_API_KEY");
r = await gw("english-movies", KEY);
ok("no data source connected -> honest 503 (no fake JSON)", r.status === 503 && r.json.error.code === "UPSTREAM_NOT_CONFIGURED");
r = await alice.get("/keys");
ok("failed call did not consume quota", r.json.keys.find(k => k.id === KEYID).remaining === 50);
r = await gw("no-such-api", KEY);
ok("unknown API -> 404", r.status === 404);
let bad; for (let i = 0; i < 22; i++) bad = await gw("english-movies", "shan_live_bad" + i, "", "198.51.100.77");
ok("IP blocked after many invalid keys", bad.status === 429 && bad.json.error.code === "TOO_MANY_INVALID_KEYS");

section("Admin: connect data sources + plans");
r = await admin.post("/admin/categories", { slug: "english-movies", name: "English Movies", method: "GET", description: "x", premium: false, upstreamUrl: "ftp://bad" });
ok("non-http upstream rejected", r.status === 400);
r = await admin.post("/admin/categories", { slug: "english-movies", name: "English Movies", method: "GET", description: "English", premium: false, upstreamUrl: UP, upstreamHeaders: '{"x-source-token":"s3cret"}', params: [{ name: "q", type: "string" }, { name: "page", type: "integer" }], exampleResponse: "{}" });
ok("connect upstream (secret headers stored server-side)", r.status === 200 && !JSON.stringify(r.json).includes("s3cret"));
r = await admin.get("/admin/categories");
ok("admin list never reveals header values", !JSON.stringify(r.json).includes("s3cret") && r.json.find(c => c.slug === "english-movies").upstreamHeaderNames[0] === "x-source-token");
r = await admin.post("/admin/categories", { slug: "subtitles", name: "Subtitles", method: "GET", description: "s", premium: true, upstreamUrl: UP, params: [{ name: "q", type: "string", required: true }] });
r = await admin.post("/admin/plans/update", { id: "free", name: "Free", limit: 50, rpm: 3, maxKeys: 3, description: "d" });
ok("admin can change plan rpm", r.status === 200);

section("Gateway: rate limit");
const rl = [];
for (let i = 0; i < 4; i++) rl.push(await gw("english-movies", KEY, "?q=a"));
ok("first 3 within rpm succeed", rl.slice(0, 3).every(x => x.status === 200));
ok("4th is rate-limited with Retry-After", rl[3].status === 429 && rl[3].json.error.code === "RATE_LIMITED" && rl[3].headers.get("retry-after") === "60");
ok("response is real upstream data", rl[0].json.status === true && rl[0].json.data.results[0].title === "Test Movie a" && rl[0].json.meta.remaining === 49);
ok("quota header", rl[0].headers.get("x-quota-remaining") === "49");
await admin.post("/admin/plans/update", { id: "free", name: "Free", limit: 50, rpm: 1000, maxKeys: 3, description: "d" });
// reset the minute window used by the rpm test
__stores.get("pair_ratelimit").docs = __stores.get("pair_ratelimit").docs.filter(d => !String(d._id).startsWith("gw:"));

section("Gateway: free plan = 50 requests per key, lifetime");
r = await alice.get("/keys");
const usedBefore = r.json.keys.find(k => k.id === KEYID).used;
ok("only successful calls counted so far", usedBefore === 3, usedBefore);
let codes = [];
for (let i = 0; i < 47; i++) codes.push((await gw("english-movies", KEY, "?q=b")).status);
ok("requests 4..50 succeed", codes.every(c => c === 200), codes.filter(c => c !== 200).join(","));
r = await gw("english-movies", KEY, "?q=b");
ok("51st request blocked (QUOTA_EXHAUSTED)", r.status === 429 && r.json.error.code === "QUOTA_EXHAUSTED");
r = await alice.get("/keys");
ok("remaining shows 0 (not per-day)", r.json.keys[0] && r.json.keys.find(k => k.id === KEYID).remaining === 0);
r = await alice.post("/keys/regenerate", { id: KEYID });
const KEY2 = r.json.key;
ok("regenerate returns a new secret", KEY2 && KEY2 !== KEY);
r = await gw("english-movies", KEY);
ok("old secret stops working", r.status === 401);
r = await gw("english-movies", KEY2, "?q=c");
ok("regenerating does NOT reset the lifetime quota", r.status === 429 && r.json.error.code === "QUOTA_EXHAUSTED");

section("Gateway: premium categories, params, refunds, IP rules");
{ const k2 = (await alice.get("/keys")).json.keys.find(k => k.name === "k2"); await alice.post("/keys/revoke", { id: k2.id }); }
r = await alice.post("/keys", { name: "fresh" });
const KEY3 = r.json.key, K3 = r.json.item.id;
r = await gw("subtitles", KEY3, "?q=x");
ok("free key cannot use premium category", r.status === 403 && r.json.error.code === "PREMIUM_REQUIRED");
r = await gw("english-movies", KEY3, "?q=boom");
ok("upstream 500 -> 502", r.status === 502 && r.json.error.code === "UPSTREAM_ERROR");
r = await alice.get("/keys");
ok("failed upstream call is refunded", r.json.keys.find(k => k.id === K3).remaining === 50);
r = await gw("english-movies", KEY3, "?page=abc");
ok("integer parameter validated", r.status === 400 && r.json.error.code === "INVALID_PARAMETER");
r = await alice.post("/keys/update", { id: K3, ips: ["10.9.9.9", "192.0.2.0/24"] });
r = await gw("english-movies", KEY3, "?q=a", "203.0.113.9");
ok("IP whitelist blocks other IPs", r.status === 403 && r.json.error.code === "IP_NOT_ALLOWED");
r = await gw("english-movies", KEY3, "?q=a", "192.0.2.44");
ok("CIDR whitelist allows matching IP", r.status === 200);
await alice.post("/keys/update", { id: K3, ips: [] });
r = await alice.post("/keys/toggle", { id: K3, active: false });
r = await gw("english-movies", KEY3, "?q=a");
ok("deactivated key -> 403", r.status === 403 && r.json.error.code === "KEY_DISABLED");
await alice.post("/keys/toggle", { id: K3, active: true });
r = await gw("english-movies", KEY3, "?q=a");
ok("re-activated key works", r.status === 200);
r = await admin.post("/admin/keys/update", { id: K3, action: "expiry", expiresAt: "2020-01-01" });
r = await gw("english-movies", KEY3, "?q=a");
ok("expired key -> 401", r.status === 401 && r.json.error.code === "KEY_EXPIRED");
await admin.post("/admin/keys/update", { id: K3, action: "expiry", expiresAt: "" });
r = await alice.post("/keys/revoke", { id: K3 });
r = await gw("english-movies", KEY3, "?q=a");
ok("revoked key -> 401", r.status === 401 && r.json.error.code === "KEY_REVOKED");
r = await alice.post("/keys/toggle", { id: K3, active: true });
ok("revoked key cannot be re-activated", r.status === 400);

section("Admin: assign Premium, limits, expiry");
const aliceId = (await alice.get("/me")).json.user.id;
r = await admin.post("/admin/users/update", { id: aliceId, plan: "premium1", limit: 3 });
ok("assign Premium Level 1 with limit 3", r.status === 200);
r = await alice.get("/me");
ok("profile reflects premium + remaining", r.json.user.plan === "premium1" && r.json.user.quota.remaining === 3 && r.json.user.planExpires > Date.now());
r = await alice.post("/keys", { name: "prem" }); const PK = r.json.key;
let pr = []; for (let i = 0; i < 4; i++) pr.push(await gw("subtitles", PK, "?q=x"));
ok("premium: 3 allowed on premium category", pr.slice(0, 3).every(x => x.status === 200));
ok("premium: 4th blocked by admin limit", pr[3].status === 429);
r = await admin.post("/admin/users/update", { id: aliceId, unlimited: true });
r = await gw("subtitles", PK, "?q=x");
ok("admin makes it unlimited", r.status === 200 && r.json.meta.remaining === "unlimited");
r = await gw("subtitles", PK, "");
ok("required parameter enforced", r.status === 400 && r.json.error.code === "MISSING_PARAMETER");
r = await admin.post("/admin/users/update", { id: aliceId, plan: "premium2", expiresAt: "2020-01-01" });
ok("past expiry date refused", r.status === 400);
r = await admin.post("/admin/users/update", { id: aliceId, plan: "free" });
r = await gw("subtitles", PK, "?q=x");
ok("downgraded to free -> premium category locked again", r.status === 403);

section("Block / unblock");
r = await admin.post("/admin/users/update", { id: aliceId, status: "blocked" });
r = await alice.get("/me");
ok("blocked user's session stops working", r.status === 401 || r.status === 403);
r = await gw("english-movies", KEY3.replace(KEY3, PK), "?q=a");
ok("blocked user's keys stop working", r.status === 403 && r.json.error.code === "ACCOUNT_BLOCKED");
r = await client().post("/auth/login", { username: "alice", password: PW });
ok("blocked user cannot log in", r.status === 403);
await admin.post("/admin/users/update", { id: aliceId, status: "active" });
r = await alice.post("/auth/login", { username: "alice", password: PW });
ok("unblocked user can log in", r.status === 200);

section("Password reset");
r = await admin.post("/admin/users/reset-link", { id: aliceId });
const token = r.json.link.split("#reset=")[1];
ok("admin can create a reset link", !!token);
r = await client().post("/auth/reset", { token: "garbage", password: "NewPassw0rd1" });
ok("bad token rejected", r.status === 400);
r = await client().post("/auth/reset", { token, password: "NewPassw0rd1" });
ok("reset with valid token", r.status === 200);
r = await client().post("/auth/reset", { token, password: "NewPassw0rd2" });
ok("token is single-use", r.status === 400);
r = await alice.get("/me");
ok("existing sessions are killed after reset", r.status === 401);
r = await alice.post("/auth/login", { username: "alice", password: PW });
ok("old password no longer works", r.status === 401);
r = await alice.post("/auth/login", { username: "alice", password: "NewPassw0rd1" });
ok("new password works", r.status === 200);
r = await client().post("/auth/forgot", { email: "nobody@example.com" });
ok("forgot-password never reveals whether an email exists", r.status === 200 && r.json.ok === 1);

section("Support tickets");
r = await alice.post("/tickets", { subject: "Bug", message: "short" });
ok("ticket validation", r.status === 400);
r = await alice.post("/tickets", { subject: "Subtitles API empty", message: "It returns nothing for my query.", category: "Bug report" });
const TID = r.json.id;
ok("create ticket", !!TID);
r = await admin.get("/admin/tickets");
ok("admin sees open ticket", r.json.length === 1 && r.json[0].unread);
r = await admin.post("/admin/tickets/reply", { id: TID, message: "We are checking this." });
r = await alice.get("/notifications");
ok("user is notified of the admin reply", r.json.unread === 1);
r = await alice.get("/tickets/get?id=" + TID);
ok("ticket history has both messages", r.json.ticket.messages.length === 2 && r.json.ticket.status === "answered");
r = await alice.get("/notifications");
ok("notification cleared after reading", r.json.unread === 0);
r = await alice.post("/tickets/reply", { id: TID, message: "Thanks, still broken." });
r = await bob.get("/tickets/get?id=" + TID);
ok("other users cannot read the ticket", r.status === 404);
r = await alice.post("/tickets/close", { id: TID });
r = await alice.post("/tickets/reply", { id: TID, message: "after close" });
ok("closed ticket refuses replies", r.status === 400);

section("Plugins, changelog, announcements");
r = await alice.get("/plugins");
ok("marketplace lists default plugin", r.json.length >= 1);
r = await admin.post("/admin/plugins", { slug: "song-dl", name: "Song DL", category: "Music", shortDesc: "s", code: "console.log(1)", published: true });
r = await alice.get("/plugins/get?slug=song-dl");
ok("admin-added plugin shows on details page", r.json.name === "Song DL" && r.json.code === "console.log(1)");
await admin.post("/admin/plugins", { slug: "song-dl", name: "Song DL", published: false });
r = await alice.get("/plugins/get?slug=song-dl");
ok("unpublished plugin is hidden", r.status === 404);
await admin.post("/admin/plugins/delete", { slug: "song-dl" });
r = await alice.post("/admin/changelog", { version: "2.1.0", title: "x" });
ok("users cannot publish changelog", r.status === 401);
r = await admin.post("/admin/changelog", { version: "2.1.0", type: "fix", title: "Fixed subtitles", body: "details", date: "2026-11-03" });
r = await alice.get("/changelog");
ok("changelog visible to users (newest first)", r.json[0].version === "2.1.0" && r.json.length === 2);
await admin.post("/admin/announcements", { title: "Welcome", body: "Hello devs", level: "success" });
r = await alice.get("/status");
ok("announcement published", r.json.announcements.length === 1);

section("Usage, analytics, logs, monitoring");
r = await alice.get("/usage?days=30");
ok("usage analytics from real request logs", r.json.total > 50 && r.json.byApi.length >= 1 && r.json.daily.length === 30);
r = await alice.get("/usage/history?page=1");
ok("request history paginates", r.json.rows.length > 0 && r.json.pages >= 3);
r = await alice.get("/dashboard");
ok("dashboard totals", r.json.stats.totalRequests > 50 && r.json.stats.activeKeys >= 1 && r.json.apis.length === 8);
r = await admin.get("/admin/logs?type=requests");
ok("admin request logs", r.json.rows.length > 0 && r.json.rows[0].user);
r = await admin.get("/admin/logs?type=activity&q=suspicious");
ok("admin activity logs filter", r.status === 200);
r = await admin.get("/admin/usage?days=7");
ok("admin usage overview", r.json.total > 50 && r.json.byUser.length >= 1);
r = await admin.post("/admin/monitor/run");
ok("health check runs", r.status === 200 && r.json.checked === 2, JSON.stringify(r.json));
r = await alice.get("/monitor");
const em = r.json.apis.find(a => a.slug === "english-movies");
ok("monitor: connected API online with latency + uptime", em.status === "online" && em.latency >= 0 && em.uptime === 100);
ok("monitor: unconnected APIs labelled honestly", r.json.apis.find(a => a.slug === "tamil-movies").status === "not_configured");
ok("monitor: error rate computed from real requests", r.json.system.requests24h > 50 && r.json.hourly.length === 24);
r = await client().get("/cron/health", { authorization: "Bearer nope" });
ok("cron endpoint is protected", r.status === 401);
r = await client().get("/cron/health", { authorization: "Bearer cron-secret" });
ok("cron endpoint works with secret", r.status === 200);

section("Maintenance mode");
r = await admin.post("/admin/maintenance", { on: true, message: "Back at 10pm" });
r = await gw("english-movies", PK, "?q=a");
ok("gateway disabled during maintenance", r.status === 503 && r.json.error.code === "MAINTENANCE" && r.json.error.message === "Back at 10pm");
r = await alice.get("/me");
ok("user API shows maintenance", r.status === 503 && r.json.maintenance === true);
r = await alice.get("/status");
ok("status still reachable (shows message)", r.json.maintenance.on === true);
r = await admin.get("/admin/dashboard");
ok("admin access stays available", r.status === 200 && r.json.health.maintenance.on === true);
await admin.post("/admin/maintenance", { on: false, message: "" });
r = await alice.get("/me");
ok("maintenance off restores access", r.status === 200);

section("Admin management");
r = await admin.get("/admin/users");
ok("user list", r.json.rows.length >= 3);
r = await admin.get("/admin/keys?q=alice");
ok("key list (search)", r.json.rows.length >= 3 && r.json.rows[0].owner === "alice");
r = await admin.post("/admin/categories/delete", { slug: "english-movies" });
r = await admin.get("/admin/categories");
ok("category deleted", !r.json.find(c => c.slug === "english-movies"));
r = await admin.post("/admin/categories", { slug: "bad slug!", name: "x" });
ok("category slug validated", r.status === 400);
r = await admin.post("/admin/admins/delete", { id: (await admin.get("/admin/me")).json.admin.id });
ok("cannot delete the last/own admin", r.status === 400);

section("SSRF guard");
delete process.env.DEV_ALLOW_PRIVATE_UPSTREAM;
for (const bad of ["http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[::1]/", "http://192.168.1.1/"]) {
  r = await admin.post("/admin/categories", { slug: "ssrf-test", name: "t", upstreamUrl: bad });
  ok(`blocks ${bad}`, r.status === 400, r.status);
}
process.env.DEV_ALLOW_PRIVATE_UPSTREAM = "1";

section("Coins site (existing features, new login)");
const COINS = `http://127.0.0.1:${port}/api`;
const cc = async (method, path, body, token) => { const x = await fetch(COINS + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, json: await x.json() }; };
for (const dead of ["/auth/otp", "/auth/verify", "/auth/key-resend"]) { r = await cc("POST", dead, { number: "94771234567" }); ok(`removed: ${dead}`, r.status === 404); }
r = await cc("POST", "/auth/register", { username: "coiner", password: "Passw0rdOK", email: "c@example.com" });
ok("coins: username registration", r.status === 200 && r.json.user.coins === 20);
const CT = r.json.token;
r = await cc("POST", "/auth/register", { username: "coiner", password: "Passw0rdOK" });
ok("coins: duplicate username rejected", r.status === 409);
r = await cc("POST", "/auth/login", { username: "coiner", password: "bad" });
ok("coins: wrong password rejected", r.status === 401);
r = await cc("POST", "/auth/login", { username: "coiner", password: "Passw0rdOK" });
ok("coins: username login", r.status === 200 && !!r.json.token);
r = await cc("GET", "/coins", null, CT);
ok("coins: wallet works with new session", r.json.balance === 20);
// legacy account (WhatsApp number as _id, existing hashed password) — must keep working
const { hashPassword } = await import("../api/_lib/password.js");
__stores.get("users").docs.push({ _id: "94771234567", name: "OldUser", pw: hashPassword("LegacyPass1"), coins: 500, earned: 500, spent: 0, joined: Date.now(), mine: [], tx: [], log: [], keys: [], tk: {}, g: { day: "", earned: 0 }, settings: {}, code: "SHAN-OLD111", refs: 0 });
r = await cc("POST", "/auth/login", { number: "94771234567", password: "LegacyPass1" });
ok("legacy users log in with number + existing password (data preserved)", r.status === 200 && r.json.user.coins === 500, JSON.stringify(r.json));
const OT = r.json.token;
r = await cc("POST", "/coins/send", { number: "coiner", amount: 100 }, OT);
ok("sending coins requires the password now (no OTP)", r.status === 400 && /password/i.test(r.json.error));
r = await cc("POST", "/coins/send", { number: "coiner", amount: 100, password: "wrong" }, OT);
ok("wrong password blocks transfer", r.status === 400);
r = await cc("POST", "/coins/send", { number: "coiner", amount: 100, password: "LegacyPass1" }, OT);
ok("transfer succeeds with password", r.status === 200);
r = await cc("GET", "/coins", null, CT);
ok("receiver got the coins", r.json.balance === 120);
r = await cc("POST", "/plugins/buy", { id: "sticker", password: "LegacyPass1" }, OT);
ok("plugin purchase with password (no OTP)", r.status === 200);
r = await cc("GET", "/plugins", null, OT);
ok("plugin now owned", r.json.find(p => p.id === "sticker").owned === true);
r = await cc("POST", "/auth/password", { current: "LegacyPass1", password: "Another1Pass" }, OT);
ok("password change returns a fresh session", r.status === 200 && !!r.json.token);
r = await cc("GET", "/coins", null, OT);
ok("old session invalid after password change", r.status === 401);
r = await cc("GET", "/leaderboard"); ok("existing public APIs still work (/leaderboard)", r.status === 200);
r = await cc("POST", "/games/start", { game: "snake" }, r.status === 200 ? CT : CT); ok("games API still works", r.status === 200 && !!r.json.sid);

console.log(`\n${pass} passed, ${fail} failed`);
up.close(); process.exit(fail ? 1 : 0);

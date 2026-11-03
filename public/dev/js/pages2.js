import { $, $$, api, qs, esc, fmtN, fmtDate, fmtDay, ago, icon, areaChart, barChart, hbars, spark, toast, copy, busy, modal, confirmBox, formModal, loading, errBox, colorJson } from "./core.js";
import { S, HINTS, genCode, statusClass, onLeave } from "./state.js";

/* ================= Usage Analytics ================= */
export async function analytics(el) {
  let days = 30, page = 1, onlyErr = false;
  const draw = async () => {
    const [u, h] = await Promise.all([api("GET", "/usage" + qs({ days })), api("GET", "/usage/history" + qs({ page, ok: onlyErr ? "0" : "" }))]);
    el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Usage Analytics</h1><p>Built from your real request logs.</p></div><select class="input" id="rg" style="width:150px">${[7, 30, 90].map(d => `<option value="${d}" ${d === days ? "selected" : ""}>Last ${d} days</option>`).join("")}</select></div>
    <div class="grid g4"><div class="card stat c-blue"><small>Requests</small><b>${fmtN(u.total)}</b></div><div class="card stat c-red"><small>Errors</small><b>${fmtN(u.errors)}</b><span class="sub">${u.total ? ((u.errors / u.total) * 100).toFixed(1) : 0}% error rate</span></div><div class="card stat c-green"><small>Avg latency</small><b>${u.avgMs ?? "–"}${u.avgMs != null ? " ms" : ""}</b></div><div class="card stat c-purple"><small>Remaining</small><b>${S.user.quota.unlimited ? "∞" : fmtN(S.user.quota.remaining)}</b></div></div>
    <div class="card mt"><h3>Requests per day <span class="sm dim">solid = requests · dashed = errors</span></h3>${u.total ? areaChart(u.daily.map(x => ({ label: x.date.slice(5), value: x.total, value2: x.errors }))) : `<div class="empty">No requests in this period.</div>`}</div>
    <div class="grid g3 mt"><div class="card"><h3>By API</h3>${hbars(u.byApi)}</div><div class="card"><h3>By API key</h3>${hbars(u.byKey, "var(--cyan)")}</div><div class="card"><h3>By HTTP status</h3>${hbars(u.byStatus, "var(--green)")}</div></div>
    <div class="card mt"><h3>API request history <label class="sm row" style="gap:6px"><input type="checkbox" id="oe" ${onlyErr ? "checked" : ""}> errors only</label></h3>
      ${h.rows.length ? `<div class="scroll"><table class="table"><tr><th>Time</th><th>API</th><th>Method</th><th>Status</th><th>Latency</th><th>IP</th><th>Note</th></tr>${h.rows.map(r => `<tr><td>${fmtDate(r.t)}</td><td class="mono">${esc(r.slug)}</td><td><span class="badge-m">${esc(r.method)}</span></td><td><span class="pill ${statusClass(r.status)}">${r.status}</span></td><td>${r.ms} ms</td><td class="mono sm">${esc(r.ip)}</td><td class="sm dim">${esc(r.code)}</td></tr>`).join("")}</table></div>
      <div class="row between mt"><button class="btn xs ghost" id="pv" ${page <= 1 ? "disabled" : ""}>← Prev</button><span class="sm muted">Page ${h.page} of ${h.pages} · ${fmtN(h.total)} requests</span><button class="btn xs ghost" id="nx" ${page >= h.pages ? "disabled" : ""}>Next →</button></div>` : `<div class="empty">No requests logged yet.</div>`}</div></div>`;
    $("#rg").onchange = e => { days = +e.target.value; draw(); }; $("#oe").onchange = e => { onlyErr = e.target.checked; page = 1; draw(); };
    $("#pv") && ($("#pv").onclick = () => { page--; draw(); }); $("#nx") && ($("#nx").onclick = () => { page++; draw(); });
  };
  await draw();
}

/* ================= Documentation ================= */
const ERRORS = [
  [400, "MISSING_PARAMETER / INVALID_PARAMETER", "A required parameter is missing or has the wrong type."], [401, "MISSING_API_KEY", "No API key was sent."],
  [401, "INVALID_API_KEY", "The key does not exist."], [401, "KEY_REVOKED / KEY_EXPIRED", "The key was revoked or has expired."],
  [403, "KEY_DISABLED", "The key is deactivated."], [403, "IP_NOT_ALLOWED", "Request IP is not in the key's whitelist."], [403, "PREMIUM_REQUIRED", "Category needs a Premium plan."],
  [403, "ACCOUNT_BLOCKED", "The account is blocked."], [404, "API_NOT_FOUND", "Unknown endpoint."], [405, "METHOD_NOT_ALLOWED", "Wrong HTTP method."],
  [429, "RATE_LIMITED", "Per-minute limit reached. See the Retry-After header."], [429, "QUOTA_EXHAUSTED", "Free key lifetime limit (50) or Premium limit used up."], [429, "TOO_MANY_INVALID_KEYS", "Too many bad keys from your IP."],
  [502, "UPSTREAM_ERROR", "The data source failed. The request is not counted."], [503, "UPSTREAM_NOT_CONFIGURED / API_OFFLINE", "The API has no data source yet, or is switched off."], [503, "MAINTENANCE", "Platform maintenance mode."]
];
export async function docs(el) {
  const base = location.origin + "/api/dev/v1", cat = S.catalog.find(c => c.slug === "english-movies") || S.catalog[0];
  const ep = cat ? cat.endpoint : base + "/english-movies";
  const ex = { url: ep + "?q=avatar", headers: { "x-api-key": "YOUR_API_KEY" } };
  const secs = [["start", "Getting started"], ["auth", "Authentication"], ["ref", "Endpoint reference"], ["methods", "Methods & parameters"], ["resp", "Responses"], ["errors", "Error codes"], ["plans", "Plans & limits"], ["code", "Code examples"], ["bot", "SHAN MINI BOT plugins"], ["keys", "API key usage guide"]];
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>API Documentation</h1><p>Everything you need to integrate the SHAN API.</p></div></div>
  <div class="grid" style="grid-template-columns:200px minmax(0,1fr)"><nav class="toc card" id="toc" style="padding:8px">${secs.map(([id, l]) => `<a href="#" data-s="${id}">${l}</a>`).join("")}</nav>
  <div class="card doc">
  <h2 id="start" style="margin-top:0">Getting started</h2><ol><li>Create an account and sign in.</li><li>Open <a href="#/keys/new">My API Keys</a> and generate a key. Copy it immediately — it is shown once.</li><li>Call any endpoint with the key in the <code class="i">x-api-key</code> header.</li></ol>
  <p>Base URL: <code class="i">${esc(base)}</code></p><pre class="code">${esc(genCode("curl", ex))}</pre>
  <h2 id="auth">Authentication</h2><p>Every API request needs a valid API key. Keys authenticate <b>API requests only</b>; they are not used to sign in to the website.</p>
  <ul><li><code class="i">x-api-key: shan_live_…</code> — recommended</li><li><code class="i">Authorization: Bearer shan_live_…</code></li><li><code class="i">?apikey=shan_live_…</code> — works, but URLs end up in logs; avoid in production.</li></ul>
  <p>Keys are stored only as hashes, can have an expiry date and an IP whitelist, and can be deactivated, regenerated or revoked at any time.</p>
  <h2 id="ref">Endpoint reference</h2><div class="scroll"><table class="table"><tr><th>API</th><th>Method</th><th>Endpoint</th><th>Access</th><th>Parameters</th></tr>${S.catalog.map(c => `<tr><td><b>${esc(c.name)}</b></td><td><span class="badge-m">${esc(c.method)}</span></td><td class="mono sm">${esc(c.endpoint.replace(location.origin, ""))}</td><td>${c.premium ? '<span class="pill premium">Premium</span>' : '<span class="pill">Free</span>'}</td><td class="sm">${c.params.map(p => `<span class="mono">${esc(p.name)}${p.required ? "*" : ""}</span>`).join(", ") || "–"}</td></tr>`).join("")}</table></div><p class="sm dim">* required parameter</p>
  <h2 id="methods">HTTP methods &amp; parameters</h2><p>Each endpoint declares its HTTP method (currently <code class="i">GET</code>). Parameters go in the query string. Unknown parameters are ignored; required ones return <code class="i">400 MISSING_PARAMETER</code>. <code class="i">OPTIONS</code> is supported for browser CORS.</p>
  <h2 id="resp">Responses</h2><p>Success:</p><pre class="code">${colorJson(JSON.stringify({ status: true, api: "english-movies", data: "<upstream JSON>", meta: { plan: "free", remaining: 49, responseTimeMs: 312 } }, null, 2))}</pre>
  <p>Error:</p><pre class="code">${colorJson(JSON.stringify({ status: false, error: { code: "QUOTA_EXHAUSTED", message: "…" } }, null, 2))}</pre>
  <p>Headers: <code class="i">X-Quota-Remaining</code>, <code class="i">X-Plan</code>, <code class="i">Retry-After</code> (on 429).</p>
  <h2 id="errors">Error codes</h2><div class="scroll"><table class="table"><tr><th>HTTP</th><th>Code</th><th>Meaning</th></tr>${ERRORS.map(e => `<tr><td><span class="pill ${statusClass(e[0])}">${e[0]}</span></td><td class="mono sm">${esc(e[1])}</td><td>${esc(e[2])}</td></tr>`).join("")}</table></div>
  <h2 id="plans">Plans &amp; limits</h2><ul><li><b>Free</b> — <b>50 requests per API key for the key's entire lifetime</b> (not per day). Free categories only.</li><li><b>Premium Level 1</b> — request limit and expiry set by the admin; premium categories.</li><li><b>Premium Level 2</b> — higher or unlimited requests, higher rate limit, more keys, priority tickets.</li></ul><p>Failed upstream calls (HTTP 502) are not counted against your quota.</p>
  <h2 id="code">Code examples</h2><div class="tabs" id="dt">${[["js", "JavaScript"], ["node", "Node.js"], ["py", "Python"], ["curl", "cURL"]].map(([k, l], i) => `<button data-l="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div><pre class="code" id="dcode">${esc(genCode("js", ex))}</pre><button class="btn xs ghost" id="dcopy">Copy</button>
  <h2 id="bot">SHAN MINI BOT plugin integration</h2><ol><li>Generate an API key and store it in the bot's environment: <code class="i">SHAN_API_KEY=shan_live_…</code></li><li>Pick a ready-made plugin from the <a href="#/marketplace">Plugin Marketplace</a> (or write your own using the Node.js example above).</li><li>Save it in your bot's plugins folder and restart the bot.</li><li>Call the API from the plugin with <code class="i">fetch</code>, sending the key in <code class="i">x-api-key</code>. Never hard-code the key in plugin files you share.</li></ol>
  <h2 id="keys">API key usage guide</h2><ul><li>Keep keys in environment variables or a secrets manager — never in frontend code or public repositories.</li><li>Add an IP whitelist for server-side bots.</li><li>Use one key per application so you can revoke it independently.</li><li>Rotate with <b>Regenerate</b>; the old secret stops working immediately.</li><li>If a key leaks, <b>Revoke</b> it. Watch <a href="#/analytics">Usage Analytics</a> for unexpected traffic.</li></ul></div></div></div>`;
  $$("#toc a").forEach(a => a.onclick = e => { e.preventDefault(); $("#" + a.dataset.s).scrollIntoView({ behavior: "smooth", block: "start" }); });
  const show = l => { $("#dcode").textContent = genCode(l, ex); };
  $$("#dt button").forEach(b => b.onclick = () => { $$("#dt button").forEach(x => x.classList.toggle("on", x === b)); show(b.dataset.l); });
  $("#dcopy").onclick = () => copy($("#dcode").textContent, "Copied");
  if (innerWidth < 860) $("#toc").parentElement.style.gridTemplateColumns = "1fr";
}

/* ================= Support Tickets ================= */
export async function tickets(el, arg) {
  if (arg && arg !== "new") return ticketView(el, arg);
  const d = await api("GET", "/tickets");
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Support Tickets</h1><p>Bug reports, feature requests and help from the SHAN team.</p></div><button class="btn" id="nt">+ New ticket</button></div>
  <div class="card">${d.tickets.length ? `<div class="scroll"><table class="table"><tr><th>Subject</th><th>Category</th><th>Status</th><th>Replies</th><th>Updated</th></tr>${d.tickets.map(t => `<tr style="cursor:pointer" data-id="${esc(t.id)}"><td><a href="#/tickets/${esc(t.id)}">${esc(t.subject)}</a> ${t.unread ? '<span class="pill new">new reply</span>' : ""} ${t.priority === "high" ? '<span class="pill premium">priority</span>' : ""}</td><td>${esc(t.category)}</td><td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td><td>${t.replies}</td><td>${ago(t.updatedAt)}</td></tr>`).join("")}</table></div>` : `<div class="empty">No tickets yet. Need help? Open one.</div>`}</div></div>`;
  const open = (pre = {}) => formModal("New support ticket", [{ name: "category", label: "Category", type: "select", options: d.categories, value: pre.category }, { name: "subject", label: "Subject", value: pre.subject || "", placeholder: "Short summary" }, { name: "message", label: "Details", type: "textarea", rows: 6, value: pre.message || "" }],
    async v => { const r = await api("POST", "/tickets", v); toast("Ticket created"); location.hash = "#/tickets/" + r.id; }, { submit: "Submit ticket" });
  $("#nt").onclick = () => open();
  if (arg === "new") open({ category: "Billing / Premium", subject: "Premium upgrade request", message: `Hello, I would like to upgrade my account (${S.user.username}) to Premium. ` });
}
async function ticketView(el, id) {
  const { ticket: t } = await api("GET", "/tickets/get" + qs({ id }));
  el.innerHTML = `<div class="page"><div class="pagehead"><div><a href="#/tickets" class="sm">← All tickets</a><h1>${esc(t.subject)}</h1><p><span class="pill ${esc(t.status)}">${esc(t.status)}</span> ${esc(t.category)} · opened ${fmtDate(t.createdAt)}</p></div>${t.status !== "closed" ? `<button class="btn ghost" id="cl">Close ticket</button>` : ""}</div>
  <div class="card"><div class="chat">${t.messages.map(m => `<div class="msg ${m.by}"><small>${m.by === "admin" ? "🛡 " : ""}${esc(m.name)} · ${fmtDate(m.t)}</small>${esc(m.text)}</div>`).join("")}</div>
  ${t.status !== "closed" ? `<div class="mt"><textarea class="input" id="rp" placeholder="Write a reply…" maxlength="4000"></textarea><div id="re"></div><button class="btn mt" id="rs">Send reply</button></div>` : `<p class="muted mt">This ticket is closed.</p>`}</div></div>`;
  $(".chat").scrollTop = 1e6;
  $("#rs") && ($("#rs").onclick = () => busy($("#rs"), async () => { try { await api("POST", "/tickets/reply", { id, message: $("#rp").value }); ticketView(el, id); } catch (e) { $("#re").innerHTML = errBox(e.message); } }));
  $("#cl") && ($("#cl").onclick = async () => { if (await confirmBox("Close ticket?", "You will not be able to reply afterwards.", "Close")) { await api("POST", "/tickets/close", { id }); ticketView(el, id); } });
}

/* ================= Plugin Marketplace ================= */
export async function marketplace(el, arg) {
  if (arg) return pluginView(el, arg);
  const list = await api("GET", "/plugins"); let cat = "All", q = "";
  const cats = ["All", ...new Set(list.map(p => p.category))];
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Plugin Marketplace</h1><p>Ready-made SHAN MINI BOT plugins that use the SHAN API.</p></div><input class="input" id="pq" placeholder="Search plugins…" style="max-width:240px"></div><div class="tabs" id="pc">${cats.map(c => `<button data-c="${esc(c)}" class="${c === "All" ? "on" : ""}">${esc(c)}</button>`).join("")}</div><div class="grid g3" id="pg"></div></div>`;
  const draw = () => {
    const f = list.filter(p => (cat === "All" || p.category === cat) && (!q || (p.name + p.shortDesc).toLowerCase().includes(q)));
    $("#pg").innerHTML = f.length ? f.map(p => `<a class="card glow" href="#/marketplace/${esc(p.slug)}" style="text-decoration:none;color:inherit"><h3>${esc(p.name)} <span class="pill">v${esc(p.version)}</span></h3><p class="muted sm">${esc(p.shortDesc)}</p><p class="mt"><span class="pill info">${esc(p.category)}</span> ${p.apiCategories.map(a => `<span class="pill">${esc(a)}</span>`).join(" ")}</p><p class="sm dim mt">by ${esc(p.author)}</p></a>`).join("") : `<div class="empty">No plugins found.</div>`;
  };
  $("#pq").oninput = e => { q = e.target.value.toLowerCase(); draw(); };
  $("#pc").onclick = e => { const b = e.target.closest("button"); if (!b) return; cat = b.dataset.c; $$("#pc button").forEach(x => x.classList.toggle("on", x === b)); draw(); };
  draw();
}
async function pluginView(el, slug) {
  const p = await api("GET", "/plugins/get" + qs({ slug })), api1 = p.apiCategories?.[0] || "english-movies";
  el.innerHTML = `<div class="page"><a href="#/marketplace" class="sm">← Marketplace</a><div class="pagehead mt"><div><h1>${esc(p.name)} <span class="pill">v${esc(p.version)}</span></h1><p>${esc(p.shortDesc)} · by ${esc(p.author)}</p></div></div>
  <div class="grid g2" style="align-items:start"><div class="stack"><div class="card"><h3>About</h3><p class="muted" style="white-space:pre-wrap">${esc(p.description)}</p><p class="mt">${(p.apiCategories || []).map(a => `<a class="pill info" href="#/playground/${esc(a)}">${esc(a)}</a>`).join(" ")}</p></div>
  <div class="card"><h3>Documentation</h3><p class="muted" style="white-space:pre-wrap">${esc(p.docs || "No documentation provided.")}</p></div>
  <div class="card"><h3>Installation</h3><p class="muted" style="white-space:pre-wrap">${esc(p.install || "Save the plugin code into your bot's plugins folder and restart.")}</p></div></div>
  <div class="stack"><div class="card"><h3>Plugin code <button class="btn xs" id="cc">Copy plugin code</button></h3><pre class="code">${esc(p.code || "// no code")}</pre></div>
  <div class="card"><h3>API key integration</h3><p class="muted sm">Create a key on <a href="#/keys/new">My API Keys</a>, then expose it to the bot as an environment variable — never paste it into shared code.</p><pre class="code">${esc(`# .env of your SHAN MINI BOT\nSHAN_API_KEY=shan_live_xxxxxxxxxxxxxxxx\n\n// in plugin code\nheaders: { "x-api-key": process.env.SHAN_API_KEY }\n// endpoint: ${location.origin}/api/dev/v1/${api1}`)}</pre></div></div></div></div>`;
  $("#cc").onclick = () => copy(p.code || "", "Plugin code copied");
}

/* ================= Changelog ================= */
export async function changelog(el) {
  const list = await api("GET", "/changelog");
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>API Changelog</h1><p>New releases, updated endpoints and bug fixes.</p></div></div>${list.length ? `<div class="tl">${list.map(c => `<div class="card"><h3><span>${esc(c.title)}</span><span class="row" style="gap:6px"><span class="pill ${esc(c.type)}">${esc(c.type)}</span><span class="pill">v${esc(c.version)}</span></span></h3><p class="sm dim">${esc(c.date)}</p><p class="muted mt" style="white-space:pre-wrap">${esc(c.body)}</p></div>`).join("")}</div>` : `<div class="card empty">No releases published yet.</div>`}</div>`;
}

/* ================= Profile & Settings ================= */
export async function settings(el) {
  const u = (await api("GET", "/me")).user; S.user = u;
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>Profile &amp; Settings</h1><p>Manage your account, password and plan.</p></div></div>
  <div class="grid g2" style="align-items:start"><div class="stack">
    <div class="card"><h3>Profile</h3><label class="field"><span>Username</span><input class="input" id="su" value="${esc(u.username)}" maxlength="24"></label><label class="field"><span>Email</span><input class="input" id="se" type="email" value="${esc(u.email)}" maxlength="120"></label><div id="pe"></div><button class="btn" id="ps">Save profile</button></div>
    <div class="card"><h3>Change password</h3><label class="field"><span>Current password</span><input class="input" id="pc" type="password" autocomplete="current-password"></label><label class="field"><span>New password</span><input class="input" id="pn" type="password" autocomplete="new-password" maxlength="64"></label><div id="pw"></div><button class="btn" id="pb">Change password</button><p class="sm dim mt">Changing your password signs out your other devices.</p></div></div>
  <div class="stack"><div class="card premium"><h3>${icon("crown").replace("<svg", '<svg width="18" style="color:var(--gold)"')} Plan</h3>
    <div class="list"><div class="item"><div class="grow">Plan</div><b>${esc(u.planName)}</b></div><div class="item"><div class="grow">Requests</div><b>${u.quota.unlimited ? "Unlimited" : fmtN(u.quota.remaining) + (u.plan === "free" ? " left (lifetime)" : " left")}</b></div><div class="item"><div class="grow">Rate limit</div><b>${u.limits.rpm} / min</b></div><div class="item"><div class="grow">Max API keys</div><b>${u.limits.maxKeys}</b></div><div class="item"><div class="grow">Expires</div><b>${u.plan === "free" ? "never" : u.planExpires ? fmtDate(u.planExpires) : "never"}</b></div></div>
    <p class="sm muted mt">Premium plans are assigned by the platform admin.</p><a class="btn mt" href="#/tickets/new">Request Premium</a></div>
    <div class="card"><h3>Account</h3><div class="list"><div class="item"><div class="grow">Member since</div>${fmtDay(u.createdAt)}</div><div class="item"><div class="grow">Last login</div>${fmtDate(u.lastLogin)}</div></div><button class="btn red mt" id="lo">Log out</button></div></div></div></div>`;
  $("#ps").onclick = () => busy($("#ps"), async () => { try { const r = await api("PUT", "/me", { username: $("#su").value.trim(), email: $("#se").value.trim() }); S.user = r.user; $("#pe").innerHTML = `<div class="note">Saved.</div>`; toast("Profile saved"); } catch (e) { $("#pe").innerHTML = errBox(e.message); } });
  $("#pb").onclick = () => busy($("#pb"), async () => { try { await api("POST", "/me/password", { current: $("#pc").value, password: $("#pn").value }); $("#pw").innerHTML = `<div class="note">Password changed.</div>`; $("#pc").value = $("#pn").value = ""; } catch (e) { $("#pw").innerHTML = errBox(e.message); } });
  $("#lo").onclick = async () => { await api("POST", "/auth/logout"); location.replace("/dev/login"); };
}

/* ================= API Monitoring ================= */
export async function monitoring(el) {
  let first = true;
  const paint = d => {
    const s = d.system;
    el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>API Monitoring</h1><p>Live health checks, latency and error rates. Auto-refreshes every 30 s.</p></div><div class="row"><span class="pill online"><span class="dotc"></span> live · updated ${new Date(d.now).toLocaleTimeString()}</span><button class="btn xs ghost" id="mr">Run checks now</button></div></div>
    ${d.maintenance.on ? `<div class="warnbox" style="margin-bottom:14px">🛠 Maintenance mode is ON: ${esc(d.maintenance.message)}</div>` : ""}
    <div class="grid g4"><div class="card stat c-blue"><small>Requests (24h)</small><b>${fmtN(s.requests24h)}</b></div><div class="card stat c-red"><small>Errors (24h)</small><b>${fmtN(s.errors24h)}</b><span class="sub">${s.errorRate}% error rate</span></div><div class="card stat c-green"><small>Avg gateway time</small><b>${s.avgGatewayMs ?? "–"}${s.avgGatewayMs != null ? " ms" : ""}</b></div><div class="card stat c-purple"><small>Database latency</small><b>${s.dbLatency ?? "–"}${s.dbLatency != null ? " ms" : ""}</b>${s.dbSeries.length ? spark(s.dbSeries.map(x => x.ms), "#9b4dff") : ""}</div></div>
    <div class="card mt"><h3>API health</h3><div class="scroll"><table class="table"><tr><th>API</th><th>Status</th><th>Latency</th><th>Uptime 24h</th><th>Avg</th><th>Trend</th><th>Last check</th></tr>${d.apis.map(a => `<tr><td><b>${esc(a.name)}</b> ${a.premium ? '<span class="pill premium">Premium</span>' : ""}</td><td><span class="pill ${esc(a.status)}"><span class="dotc"></span>${esc(a.status.replace("_", " "))}</span></td><td>${a.latency != null ? a.latency + " ms" : "–"}</td><td>${a.uptime != null ? a.uptime + "%" : "–"}</td><td>${a.avgLatency != null ? a.avgLatency + " ms" : "–"}</td><td style="width:110px"><div style="position:relative;height:34px">${a.series.length > 1 ? spark(a.series.map(x => x.ms || 0), "#22d3ee").replace('class="spark"', 'style="width:100%;height:34px"') : '<span class="dim sm">no data</span>'}</div></td><td class="sm dim">${a.checkedAt ? ago(a.checkedAt) : "never"}</td></tr>`).join("")}</table></div>${d.apis.some(a => a.status === "not_configured") ? `<p class="sm dim mt">“not configured” means the admin has not connected a data source to that API yet — it is not counted as offline.</p>` : ""}</div>
    <div class="grid gmain mt"><div class="card"><h3>Requests per hour (24h) <span class="sm dim">blue = ok · red = errors</span></h3>${barChart(d.hourly.map(h => ({ label: new Date(h.t).getHours() + "h", value: h.requests, value2: h.errors })))}</div>
    <div class="card"><h3>Recent errors</h3><div class="list">${d.recentErrors.length ? d.recentErrors.map(e => `<div class="item"><span class="pill ${statusClass(e.status)}">${e.status}</span><div class="grow ellipsis"><span class="mono sm">${esc(e.slug)}</span><small>${esc(e.code)}</small></div><small>${ago(e.t)}</small></div>`).join("") : `<div class="empty">No errors in the last 24 h 🎉</div>`}</div></div></div></div>`;
    $("#mr").onclick = () => busy($("#mr"), async () => { await api("POST", "/monitor/run"); await tick(false); });
  };
  const tick = async run => {
    try { if (run) await api("POST", "/monitor/run").catch(() => {}); paint(await api("GET", "/monitor")); } catch (e) { if (first) el.innerHTML = `<div class="page">${errBox(e.message)}</div>`; }
    first = false;
  };
  await tick(true);
  const id = setInterval(() => tick(true), 30000); onLeave(() => clearInterval(id));
}

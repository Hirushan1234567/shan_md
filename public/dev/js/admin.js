import { $, $$, api, qs, esc, fmtN, fmtDate, ago, icon, areaChart, barChart, hbars, toast, copy, busy, modal, confirmBox, formModal, loading, errBox, setAuthFail, brandHtml, footHtml } from "./core.js";
import { statusClass } from "./state.js";

const NAV = [
  ["dashboard", "Dashboard", "grid"], ["users", "Users", "users"], ["keys", "API Keys", "key"], ["apis", "APIs & Categories", "layers"],
  ["plans", "Plans & Limits", "crown"], ["usage", "Usage Analytics", "chart"], ["logs", "Request & Activity Logs", "log"],
  ["tickets", "Support Tickets", "chat"], ["announce", "Announcements", "megaphone"], ["changelog", "Changelog", "clock"],
  ["plugins", "Plugins", "box"], ["monitoring", "Monitoring", "pulse"], ["maintenance", "Maintenance", "tool"], ["admins", "Admins & Security", "shield"]
];
let ME = null, timer = null;
setAuthFail(() => { if (ME) location.reload(); });

/* ---------- login gate ---------- */
async function init() {
  try { ME = (await api("GET", "/admin/me")).admin; } catch { $("#gate").hidden = false; wireLogin(); return; }
  start();
}
function wireLogin() {
  $("#alogin").onsubmit = async e => {
    e.preventDefault(); $("#ae").innerHTML = "";
    try { await busy($("#alogin button"), () => api("POST", "/admin/login", { username: $("#au").value.trim(), password: $("#ap").value })); location.reload(); }
    catch (err) { $("#ae").innerHTML = errBox(err.message); }
  };
}
function start() {
  $("#gate").hidden = true; $("#app").hidden = false; $("#footer").innerHTML = footHtml();
  $("#side").innerHTML = `${brandHtml()}<div class="pill warning" style="justify-content:center;margin-bottom:8px">ADMIN PANEL</div><nav class="nav">${NAV.map(([id, l, ic]) => `<a href="#/${id}" data-p="${id}">${icon(ic)}<span>${l}</span></a>`).join("")}</nav><div class="side-foot"><a class="mini" href="/dev/" style="text-decoration:none;color:var(--text)">← User dashboard</a></div>`;
  $("#burger").innerHTML = icon("menu");
  $("#who").innerHTML = `<span class="av">${esc(ME.username[0].toUpperCase())}</span><span class="nm"><b>${esc(ME.username)}</b><small>admin</small></span>`;
  $("#who").onclick = () => { const m = modal(`<h2>${esc(ME.username)}</h2><button class="btn red" id="lo">Log out</button>`); m.$("#lo").onclick = async () => { await api("POST", "/admin/logout"); location.reload(); }; };
  const close = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("show"); };
  $("#burger").onclick = () => { $("#side").classList.toggle("open"); $("#scrim").classList.toggle("show"); };
  $("#scrim").onclick = close; $("#side").addEventListener("click", e => { if (e.target.closest("a")) close(); });
  window.addEventListener("hashchange", route); route();
}
async function route() {
  clearInterval(timer);
  const id = (location.hash.split("/")[1] || "dashboard").split("?")[0], page = P[id] ? id : "dashboard";
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.p === page));
  $("#ptitle").textContent = NAV.find(n => n[0] === page)[1];
  const el = $("#view"); el.onclick = el.oninput = el.onchange = null; el.innerHTML = `<div class="page">${loading()}</div>`; scrollTo(0, 0);
  try { await P[page](el); } catch (e) { el.innerHTML = `<div class="page">${errBox(e.message)}</div>`; }
}
const head = (t, sub, right = "") => `<div class="pagehead"><div><h1>${t}</h1><p>${sub}</p></div><div class="row">${right}</div></div>`;
const stat = (l, v, c, sub = "") => `<div class="card stat c-${c}"><small>${l}</small><b>${v}</b>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
const pager = (d, id) => `<div class="row between mt"><button class="btn xs ghost" data-pg="-1" ${d.page <= 1 ? "disabled" : ""}>← Prev</button><span class="sm muted">Page ${d.page}/${d.pages} · ${fmtN(d.total)} rows</span><button class="btn xs ghost" data-pg="1" ${d.page >= d.pages ? "disabled" : ""}>Next →</button></div>`;
const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); return true; } catch (e) { toast(e.message, true); return false; } };

const P = {};

/* ================= Dashboard ================= */
P.dashboard = async el => {
  const d = await api("GET", "/admin/dashboard"), h = d.health;
  $("#maintPill").hidden = !h.maintenance.on;
  el.innerHTML = `<div class="page">${head("Admin Dashboard", "Platform overview — all numbers come from the database.")}
  <div class="grid g4">${stat("Total users", fmtN(d.totalUsers), "blue")}${stat("Total API keys", fmtN(d.totalKeys), "purple")}${stat("Total requests", fmtN(d.totalRequests), "green")}${stat("Open tickets", fmtN(d.openTickets), "orange")}
  ${stat("Free users", fmtN(d.freeUsers), "cyan")}${stat("Premium users", fmtN(d.premiumUsers), "gold")}${stat("Active APIs", d.activeApis, "green", d.unconfiguredApis + " not connected")}${stat("Offline APIs", d.offlineApis, "red")}</div>
  <div class="grid gmain mt"><div class="card"><h3>Requests per hour (24h)</h3>${barChart(d.hourly.map(x => ({ label: new Date(x.t).getHours() + "h", value: x.requests, value2: x.errors })))}</div>
  <div class="card"><h3>System health <a class="sm" href="#/monitoring">Details →</a></h3><div class="list">
    <div class="item"><div class="grow">Database latency</div><b>${h.dbLatency ?? "–"} ms</b></div><div class="item"><div class="grow">Avg gateway time</div><b>${h.avgGatewayMs ?? "–"} ms</b></div>
    <div class="item"><div class="grow">Requests (24h)</div><b>${fmtN(h.requests24h)}</b></div><div class="item"><div class="grow">Error rate (24h)</div><b class="${h.errorRate > 5 ? "r" : ""}">${h.errorRate}%</b></div>
    <div class="item"><div class="grow">Maintenance</div><span class="pill ${h.maintenance.on ? "warning" : "online"}">${h.maintenance.on ? "ON" : "off"}</span></div></div></div></div>
  <div class="card mt"><h3>Recent activity <a class="sm" href="#/logs">All logs →</a></h3><div class="scroll"><table class="table"><tr><th>Time</th><th>User</th><th>Type</th><th>Detail</th><th>IP</th></tr>${d.recent.map(a => `<tr><td>${ago(a.t)}</td><td>${esc(a.user)}</td><td><span class="pill ${a.type === "suspicious" ? "danger" : ""}">${esc(a.type)}</span></td><td>${esc(a.msg)}</td><td class="mono sm">${esc(a.ip)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No activity yet.</td></tr>`}</table></div></div></div>`;
};

/* ================= Users ================= */
P.users = async el => {
  let page = 1, q = "";
  const draw = async () => {
    const d = await api("GET", "/admin/users" + qs({ page, q }));
    el.innerHTML = `<div class="page">${head("Users", "Manage accounts, plans, limits and blocking.", `<input class="input" id="uq" placeholder="Search username / email" value="${esc(q)}" style="width:240px">`)}
    <div class="card"><div class="scroll"><table class="table"><tr><th>User</th><th>Plan</th><th>Requests left</th><th>Expires</th><th>Status</th><th>Joined</th><th></th></tr>${d.rows.map(u => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.username)}</b><br><span class="sm dim">${esc(u.email)}</span></td><td><span class="pill ${u.plan === "free" ? "" : "premium"}">${esc(u.plan)}</span></td><td>${u.plan === "free" ? "per key" : u.planRemaining == null ? "unlimited" : fmtN(u.planRemaining)}</td><td class="sm">${u.plan === "free" ? "–" : u.planExpires ? fmtDate(u.planExpires) : "never"}</td><td><span class="pill ${esc(u.status)}">${esc(u.status)}</span></td><td class="sm">${ago(u.createdAt)}</td>
    <td><div class="row" style="gap:4px"><button class="btn xs ghost" data-a="plan">Plan</button><button class="btn xs ${u.status === "blocked" ? "green" : "red"}" data-a="block">${u.status === "blocked" ? "Unblock" : "Block"}</button><button class="btn xs ghost" data-a="reset">Reset link</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No users.</td></tr>`}</table></div>${pager(d)}</div></div>`;
    $("#uq").onchange = e => { q = e.target.value.trim(); page = 1; draw(); };
    el.onclick = async e => {
      const pg = e.target.closest("[data-pg]"); if (pg) { page += +pg.dataset.pg; return draw(); }
      const b = e.target.closest("[data-a]"); if (!b) return;
      const u = d.rows.find(x => x.id === b.closest("tr").dataset.id);
      if (b.dataset.a === "block") { if (u.status !== "blocked" && !(await confirmBox("Block user?", `${u.username} will be signed out and all their keys stop working.`, "Block", true))) return; if (await act(() => api("POST", "/admin/users/update", { id: u.id, status: u.status === "blocked" ? "active" : "blocked" }), "Updated")) draw(); }
      if (b.dataset.a === "reset") await act(async () => { const r = await api("POST", "/admin/users/reset-link", { id: u.id }); modal(`<h2>Password reset link</h2><p class="muted sm">Send this to ${esc(u.username)}. Valid ${r.expiresInMinutes} minutes, single use.</p><pre class="code" style="white-space:pre-wrap;word-break:break-all">${esc(r.link)}</pre><button class="btn mt" id="cp">Copy link</button>`).$("#cp").onclick = () => copy(r.link, "Link copied"); });
      if (b.dataset.a === "plan") formModal(`Plan for ${u.username}`, [
        { name: "plan", label: "Plan", type: "select", value: u.plan, options: [["free", "Free"], ["premium1", "Premium Level 1"], ["premium2", "Premium Level 2"]] },
        { name: "unlimited", label: "Unlimited requests (Premium)", type: "checkbox", value: u.plan !== "free" && u.planRemaining == null },
        { name: "limit", label: "Request limit (Premium, ignored if unlimited)", type: "number", value: u.planLimit ?? "", placeholder: "blank = plan default" },
        { name: "expiresAt", label: "Expiry date (Premium)", type: "date", hint: "Leave blank to use the plan's default expiry days." },
        { name: "resetUsage", label: "Reset used counter", type: "checkbox" }],
        async v => { const b2 = { id: u.id, plan: v.plan, resetUsage: v.resetUsage }; if (v.plan !== "free") { b2.unlimited = v.unlimited; if (v.limit !== "") b2.limit = v.limit; if (v.expiresAt) b2.expiresAt = v.expiresAt; } await api("POST", "/admin/users/update", b2); toast("Plan updated"); draw(); });
    };
  };
  await draw();
};

/* ================= API keys ================= */
P.keys = async el => {
  let page = 1, q = "";
  const draw = async () => {
    const d = await api("GET", "/admin/keys" + qs({ page, q }));
    el.innerHTML = `<div class="page">${head("API Keys", "All keys across users. Secrets are hashed and cannot be viewed.", `<input class="input" id="kq" placeholder="Search owner / key name" value="${esc(q)}" style="width:240px">`)}
    <div class="card"><div class="scroll"><table class="table"><tr><th>Owner</th><th>Key</th><th>Status</th><th>Used</th><th>Left</th><th>Last used</th><th>Expires</th><th></th></tr>${d.rows.map(k => `<tr data-id="${esc(k.id)}"><td>${esc(k.owner)}</td><td><b>${esc(k.name)}</b><br><span class="mono sm dim">${esc(k.prefix)}</span></td><td><span class="pill ${esc(k.status)}">${esc(k.status)}</span></td><td>${fmtN(k.used)}</td><td>${fmtN(k.remaining)}</td><td class="sm">${k.lastUsedAt ? ago(k.lastUsedAt) : "never"}</td><td class="sm">${k.expiresAt ? fmtDate(k.expiresAt) : "never"}</td>
    <td><div class="row" style="gap:4px">${k.status === "revoked" ? "" : `<button class="btn xs ghost" data-a="${k.status === "inactive" ? "activate" : "deactivate"}">${k.status === "inactive" ? "Activate" : "Deactivate"}</button><button class="btn xs ghost" data-a="limit">Limit</button><button class="btn xs ghost" data-a="expiry">Expiry</button><button class="btn xs red" data-a="revoke">Revoke</button>`}</div></td></tr>`).join("") || `<tr><td colspan="8" class="empty">No keys.</td></tr>`}</table></div>${pager(d)}</div></div>`;
    $("#kq").onchange = e => { q = e.target.value.trim(); page = 1; draw(); };
    el.onclick = async e => {
      const pg = e.target.closest("[data-pg]"); if (pg) { page += +pg.dataset.pg; return draw(); }
      const b = e.target.closest("[data-a]"); if (!b) return; const k = d.rows.find(x => x.id === b.closest("tr").dataset.id), a = b.dataset.a;
      const send = body => act(() => api("POST", "/admin/keys/update", { id: k.id, ...body }), "Updated").then(ok => ok && draw());
      if (a === "revoke") { if (await confirmBox("Revoke key?", "Permanent.", "Revoke", true)) send({ action: a }); }
      else if (a === "limit") formModal("Set remaining requests", [{ name: "remaining", label: "Remaining requests on this key", type: "number", value: k.remaining ?? 0 }], async v => { await api("POST", "/admin/keys/update", { id: k.id, action: "limit", remaining: v.remaining }); draw(); });
      else if (a === "expiry") formModal("Set key expiry", [{ name: "expiresAt", label: "Expiry date (blank = never)", type: "date" }], async v => { await api("POST", "/admin/keys/update", { id: k.id, action: "expiry", expiresAt: v.expiresAt }); draw(); });
      else send({ action: a });
    };
  };
  await draw();
};

/* ================= APIs & categories ================= */
P.apis = async el => {
  const draw = async () => {
    const list = await api("GET", "/admin/categories");
    el.innerHTML = `<div class="page">${head("APIs & Categories", "Create, edit and connect API endpoints. The data source (upstream) URL and its secret headers stay on the server.", `<button class="btn" id="add">+ New API</button>`)}
    <div class="card"><div class="scroll"><table class="table"><tr><th>API</th><th>Endpoint</th><th>Access</th><th>Status</th><th>Data source</th><th></th></tr>${list.map(c => `<tr data-s="${esc(c.slug)}"><td><b>${esc(c.name)}</b><br><span class="sm dim">${esc(c.group)}</span></td><td class="mono sm">${esc(c.method)} /api/dev/v1/${esc(c.slug)}</td><td>${c.premium ? '<span class="pill premium">Premium</span>' : '<span class="pill">Free</span>'}</td><td><span class="pill ${esc(c.effective)}">${esc(c.effective.replace("_", " "))}</span>${c.latency ? "" : ""}</td><td class="sm">${c.upstreamUrl ? esc(c.upstreamUrl.replace(/^https?:\/\//, "").slice(0, 40)) : '<span class="dim">not connected</span>'}</td><td><div class="row" style="gap:4px"><button class="btn xs ghost" data-a="edit">Edit</button><button class="btn xs red" data-a="del">Delete</button></div></td></tr>`).join("")}</table></div></div></div>`;
    const form = c => formModal(c ? `Edit ${c.name}` : "New API", [
      { name: "slug", label: "Slug (URL path)", value: c?.slug || "", readonly: !!c, placeholder: "sinhala-movies" }, { name: "name", label: "Name", value: c?.name || "" },
      { name: "group", label: "Group", value: c?.group || "movies" }, { name: "method", label: "HTTP method", type: "select", options: ["GET", "POST"], value: c?.method || "GET" },
      { name: "description", label: "Description", type: "textarea", rows: 2, value: c?.description || "" },
      { name: "params", label: "Parameters (JSON array: name, type string|integer, required, description)", type: "textarea", code: true, rows: 5, value: JSON.stringify(c?.params || [], null, 1) },
      { name: "upstreamUrl", label: "Data source URL (http/https, public host)", value: c?.upstreamUrl || "", placeholder: "https://your-backend.example.com/movies", hint: "Query parameters declared above are forwarded to this URL." },
      { name: "upstreamHeaders", label: "Data source headers (JSON object, secret)", type: "textarea", code: true, rows: 2, placeholder: c?.upstreamHeaderNames?.length ? `Existing: ${c.upstreamHeaderNames.join(", ")} (leave blank to keep, {} to clear)` : '{"x-token":"…"}' },
      { name: "exampleResponse", label: "Example JSON response (documentation only)", type: "textarea", code: true, rows: 5, value: c?.exampleResponse || "" },
      { name: "status", label: "Status", type: "select", options: [["active", "Active"], ["offline", "Offline"], ["maintenance", "Maintenance"]], value: c?.status || "active" },
      { name: "premium", label: "Premium only", type: "checkbox", value: c?.premium }, { name: "enabled", label: "Enabled (visible)", type: "checkbox", value: c ? c.enabled : true }],
      async v => {
        let params; try { params = JSON.parse(v.params || "[]"); } catch { throw new Error("Parameters must be valid JSON."); }
        const body = { ...v, params }; if (c && v.upstreamHeaders.trim() === "") delete body.upstreamHeaders; else if (v.upstreamHeaders.trim() === "{}") body.upstreamHeaders = "";
        await api("POST", "/admin/categories", body); toast("Saved"); draw();
      }, { wide: true });
    $("#add").onclick = () => form(null);
    el.onclick = async e => {
      const b = e.target.closest("[data-a]"); if (!b) return; const c = list.find(x => x.slug === b.closest("tr").dataset.s);
      if (b.dataset.a === "edit") form(c); else if (await confirmBox("Delete API?", `${c.name} will disappear for all users.`, "Delete", true)) { if (await act(() => api("POST", "/admin/categories/delete", { slug: c.slug }), "Deleted")) draw(); }
    };
  };
  await draw();
};

/* ================= Plans ================= */
P.plans = async el => {
  const list = await api("GET", "/admin/plans");
  el.innerHTML = `<div class="page">${head("Plans & Limits", "Defaults applied when you assign a plan. Per-user limits and expiry are set on the Users page.")}<div class="grid g3">${list.map(p => `<div class="card premium" data-id="${esc(p.id)}"><h3>${esc(p.name)} <span class="pill ${p.id === "free" ? "" : "premium"}">${esc(p.id)}</span></h3><div class="list"><div class="item"><div class="grow">Request limit</div><b>${p.id === "free" ? p.limit + " / key, lifetime" : p.unlimited ? "Unlimited" : fmtN(p.limit)}</b></div><div class="item"><div class="grow">Default expiry</div><b>${p.id === "free" ? "–" : p.expiryDays ? p.expiryDays + " days" : "never"}</b></div><div class="item"><div class="grow">Rate limit</div><b>${p.rpm} / min</b></div><div class="item"><div class="grow">Max API keys</div><b>${p.maxKeys}</b></div></div><p class="sm muted mt">${esc(p.description)}</p><button class="btn mt" data-a="edit">Edit plan</button></div>`).join("")}</div></div>`;
  el.onclick = e => {
    const b = e.target.closest("[data-a]"); if (!b) return; const p = list.find(x => x.id === b.closest("[data-id]").dataset.id);
    formModal(`Edit ${p.name}`, [{ name: "name", label: "Name", value: p.name }, { name: "description", label: "Description", type: "textarea", rows: 2, value: p.description },
      { name: "limit", label: p.id === "free" ? "Lifetime requests per new key" : "Default request limit", type: "number", value: p.limit }, ...(p.id === "free" ? [] : [{ name: "unlimited", label: "Unlimited by default", type: "checkbox", value: p.unlimited }, { name: "expiryDays", label: "Default expiry (days, 0 = never)", type: "number", value: p.expiryDays }]),
      { name: "rpm", label: "Requests per minute", type: "number", value: p.rpm }, { name: "maxKeys", label: "Max API keys", type: "number", value: p.maxKeys }],
      async v => { await api("POST", "/admin/plans/update", { id: p.id, ...v }); toast("Plan saved"); route(); });
  };
};

/* ================= Usage ================= */
P.usage = async el => {
  let days = 30;
  const draw = async () => {
    const d = await api("GET", "/admin/usage" + qs({ days }));
    el.innerHTML = `<div class="page">${head("Usage Analytics", "Platform-wide API usage.", `<select class="input" id="rg" style="width:150px">${[7, 30, 90].map(x => `<option value="${x}" ${x === days ? "selected" : ""}>Last ${x} days</option>`).join("")}</select>`)}
    <div class="grid g3">${stat("Requests", fmtN(d.total), "blue")}${stat("Errors", fmtN(d.errors), "red", d.total ? ((d.errors / d.total) * 100).toFixed(1) + "%" : "")}${stat("Active days", d.daily.filter(x => x.total).length, "green")}</div>
    <div class="card mt"><h3>Requests per day</h3>${d.total ? areaChart(d.daily.map(x => ({ label: x.date.slice(5), value: x.total, value2: x.errors }))) : `<div class="empty">No requests yet.</div>`}</div>
    <div class="grid g3 mt"><div class="card"><h3>Top APIs</h3>${hbars(d.byApi)}</div><div class="card"><h3>Top users</h3>${hbars(d.byUser, "var(--cyan)")}</div><div class="card"><h3>HTTP status</h3>${hbars(d.byStatus, "var(--green)")}</div></div></div>`;
    $("#rg").onchange = e => { days = +e.target.value; draw(); };
  };
  await draw();
};

/* ================= Logs ================= */
P.logs = async el => {
  let type = "requests", page = 1, q = "", ok = "";
  const draw = async () => {
    const d = await api("GET", "/admin/logs" + qs({ type, page, q, ok }));
    el.innerHTML = `<div class="page">${head("Request & Activity Logs", "Every API request and account event.", `<input class="input" id="lq" placeholder="Filter…" value="${esc(q)}" style="width:200px">`)}
    <div class="tabs"><button data-t="requests" class="${type === "requests" ? "on" : ""}">API requests</button><button data-t="activity" class="${type === "activity" ? "on" : ""}">User activity</button>${type === "requests" ? `<label class="sm row" style="gap:6px;margin-left:10px"><input type="checkbox" id="eo" ${ok ? "checked" : ""}> errors only</label>` : ""}</div>
    <div class="card"><div class="scroll"><table class="table">${type === "requests" ? `<tr><th>Time</th><th>User</th><th>API</th><th>Status</th><th>ms</th><th>IP</th><th>Code</th></tr>${d.rows.map(r => `<tr><td class="sm">${fmtDate(r.t)}</td><td>${esc(r.user)}</td><td class="mono">${esc(r.slug)}</td><td><span class="pill ${statusClass(r.status)}">${r.status}</span></td><td>${r.ms}</td><td class="mono sm">${esc(r.ip)}</td><td class="sm dim">${esc(r.code)}</td></tr>`).join("")}` : `<tr><th>Time</th><th>User</th><th>Type</th><th>Detail</th><th>IP</th></tr>${d.rows.map(r => `<tr><td class="sm">${fmtDate(r.t)}</td><td>${esc(r.user)}</td><td><span class="pill ${r.type === "suspicious" ? "danger" : ""}">${esc(r.type)}</span></td><td>${esc(r.msg)}</td><td class="mono sm">${esc(r.ip)}</td></tr>`).join("")}`}</table></div>${d.rows.length ? "" : `<div class="empty">No entries.</div>`}${pager(d)}</div></div>`;
    $$(".tabs button").forEach(b => b.onclick = () => { type = b.dataset.t; page = 1; draw(); });
    $("#lq").onchange = e => { q = e.target.value.trim(); page = 1; draw(); }; $("#eo") && ($("#eo").onchange = e => { ok = e.target.checked ? "0" : ""; page = 1; draw(); });
    el.onclick = e => { const pg = e.target.closest("[data-pg]"); if (pg) { page += +pg.dataset.pg; draw(); } };
  };
  await draw();
};

/* ================= Tickets ================= */
P.tickets = async el => {
  let st = "";
  const draw = async () => {
    const list = await api("GET", "/admin/tickets" + qs({ status: st }));
    el.innerHTML = `<div class="page">${head("Support Tickets", "Reply to bug reports, feature requests and help requests.")}<div class="tabs">${[["", "All"], ["open", "Open"], ["answered", "Answered"], ["closed", "Closed"]].map(([v, l]) => `<button data-s="${v}" class="${v === st ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card"><div class="scroll"><table class="table"><tr><th>Subject</th><th>User</th><th>Category</th><th>Status</th><th>Updated</th></tr>${list.map(t => `<tr style="cursor:pointer" data-id="${esc(t.id)}"><td><b>${esc(t.subject)}</b> ${t.unread ? '<span class="pill new">new</span>' : ""} ${t.priority === "high" ? '<span class="pill premium">priority</span>' : ""}</td><td>${esc(t.user)}</td><td>${esc(t.category)}</td><td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td><td class="sm">${ago(t.updatedAt)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No tickets.</td></tr>`}</table></div></div></div>`;
    $$(".tabs button").forEach(b => b.onclick = () => { st = b.dataset.s; draw(); });
    $$("tr[data-id]", el).forEach(r => r.onclick = () => openT(r.dataset.id, draw));
  };
  await draw();
};
async function openT(id, done) {
  const { ticket: t } = await api("GET", "/admin/tickets/get" + qs({ id }));
  const m = modal(`<h2>${esc(t.subject)}</h2><p class="sm muted"><span class="pill ${esc(t.status)}">${esc(t.status)}</span> ${esc(t.category)} · from <b>${esc(t.user)}</b></p><div class="chat mt">${t.messages.map(x => `<div class="msg ${x.by}"><small>${esc(x.name)} · ${fmtDate(x.t)}</small>${esc(x.text)}</div>`).join("")}</div>
    <textarea class="input mt" id="ar" placeholder="Reply to the user…" maxlength="4000"></textarea><div id="ae"></div>
    <div class="row mt"><select class="input" id="as" style="width:150px"><option value="answered">Mark answered</option><option value="open">Keep open</option><option value="closed">Close</option></select><button class="btn" id="asend">Send reply</button><button class="btn ghost" data-close>Close window</button></div>`, { wide: true });
  m.$(".chat").scrollTop = 1e6;
  m.$("#asend").onclick = () => busy(m.$("#asend"), async () => { try { await api("POST", "/admin/tickets/reply", { id, message: m.$("#ar").value, status: m.$("#as").value }); m.close(); toast("Reply sent"); done(); } catch (e) { m.$("#ae").innerHTML = errBox(e.message); } });
}

/* ================= Announcements / Changelog / Plugins (CRUD helpers) ================= */
P.announce = async el => {
  const draw = async () => {
    const list = await api("GET", "/admin/announcements");
    el.innerHTML = `<div class="page">${head("Announcements", "Shown as a banner to every signed-in user.", `<button class="btn" id="add">+ Publish</button>`)}<div class="stack">${list.map(a => `<div class="card" data-id="${esc(a.id)}"><h3><span>${esc(a.title)}</span><span class="row" style="gap:6px"><span class="pill ${esc(a.level)}">${esc(a.level)}</span><span class="pill ${a.active ? "online" : ""}">${a.active ? "live" : "hidden"}</span></span></h3><p class="muted">${esc(a.body)}</p><p class="sm dim">${fmtDate(a.t)}</p><div class="row mt"><button class="btn xs ghost" data-a="edit">Edit</button><button class="btn xs red" data-a="del">Delete</button></div></div>`).join("") || `<div class="card empty">No announcements.</div>`}</div></div>`;
    const form = a => formModal(a ? "Edit announcement" : "Publish announcement", [{ name: "title", label: "Title", value: a?.title || "" }, { name: "body", label: "Message", type: "textarea", value: a?.body || "" }, { name: "level", label: "Level", type: "select", options: ["info", "success", "warning"], value: a?.level || "info" }, { name: "active", label: "Visible to users", type: "checkbox", value: a ? a.active : true }], async v => { await api("POST", "/admin/announcements", { ...v, id: a?.id }); draw(); });
    $("#add").onclick = () => form(); el.onclick = async e => { const b = e.target.closest("[data-a]"); if (!b) return; const a = list.find(x => x.id === b.closest("[data-id]").dataset.id); if (b.dataset.a === "edit") form(a); else if (await confirmBox("Delete?", a.title, "Delete", true)) { await api("POST", "/admin/announcements/delete", { id: a.id }); draw(); } };
  };
  await draw();
};
P.changelog = async el => {
  const draw = async () => {
    const list = await api("GET", "/admin/changelog");
    el.innerHTML = `<div class="page">${head("Changelog", "Publish release notes visible to all users.", `<button class="btn" id="add">+ Publish entry</button>`)}<div class="stack">${list.map(c => `<div class="card" data-id="${esc(c.id)}"><h3><span>${esc(c.title)}</span><span class="row" style="gap:6px"><span class="pill ${esc(c.type)}">${esc(c.type)}</span><span class="pill">v${esc(c.version)}</span></span></h3><p class="sm dim">${esc(c.date)}</p><p class="muted" style="white-space:pre-wrap">${esc(c.body)}</p><div class="row mt"><button class="btn xs ghost" data-a="edit">Edit</button><button class="btn xs red" data-a="del">Delete</button></div></div>`).join("") || `<div class="card empty">No entries.</div>`}</div></div>`;
    const form = c => formModal(c ? "Edit entry" : "Publish changelog entry", [{ name: "version", label: "Version", value: c?.version || "", placeholder: "2.1.0" }, { name: "type", label: "Type", type: "select", options: [["new", "New release"], ["update", "Updated endpoint"], ["fix", "Bug fix"], ["breaking", "Breaking change"]], value: c?.type || "update" }, { name: "title", label: "Title", value: c?.title || "" }, { name: "body", label: "Details", type: "textarea", rows: 5, value: c?.body || "" }, { name: "date", label: "Release date", type: "date", value: c?.date || new Date().toISOString().slice(0, 10) }], async v => { await api("POST", "/admin/changelog", { ...v, id: c?.id }); draw(); });
    $("#add").onclick = () => form(); el.onclick = async e => { const b = e.target.closest("[data-a]"); if (!b) return; const c = list.find(x => x.id === b.closest("[data-id]").dataset.id); if (b.dataset.a === "edit") form(c); else if (await confirmBox("Delete entry?", c.title, "Delete", true)) { await api("POST", "/admin/changelog/delete", { id: c.id }); draw(); } };
  };
  await draw();
};
P.plugins = async el => {
  const draw = async () => {
    const list = await api("GET", "/admin/plugins");
    el.innerHTML = `<div class="page">${head("Plugin Marketplace", "Add, edit and remove SHAN MINI BOT plugins.", `<button class="btn" id="add">+ Add plugin</button>`)}<div class="card"><div class="scroll"><table class="table"><tr><th>Plugin</th><th>Category</th><th>Version</th><th>Status</th><th></th></tr>${list.map(p => `<tr data-s="${esc(p.slug)}"><td><b>${esc(p.name)}</b><br><span class="sm dim">${esc(p.shortDesc)}</span></td><td>${esc(p.category)}</td><td>v${esc(p.version)}</td><td><span class="pill ${p.published ? "online" : ""}">${p.published ? "published" : "draft"}</span></td><td><div class="row" style="gap:4px"><button class="btn xs ghost" data-a="edit">Edit</button><button class="btn xs red" data-a="del">Remove</button></div></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No plugins.</td></tr>`}</table></div></div></div>`;
    const form = p => formModal(p ? `Edit ${p.name}` : "Add plugin", [{ name: "slug", label: "Slug", value: p?.slug || "", readonly: !!p }, { name: "name", label: "Name", value: p?.name || "" }, { name: "category", label: "Category", value: p?.category || "General" }, { name: "version", label: "Version", value: p?.version || "1.0.0" }, { name: "author", label: "Author", value: p?.author || "SHAN MD" }, { name: "shortDesc", label: "Short description", value: p?.shortDesc || "" }, { name: "description", label: "Description", type: "textarea", rows: 3, value: p?.description || "" }, { name: "docs", label: "Documentation", type: "textarea", rows: 4, value: p?.docs || "" }, { name: "install", label: "Installation instructions", type: "textarea", rows: 3, value: p?.install || "" }, { name: "apiCategories", label: "API categories used (comma separated slugs)", value: (p?.apiCategories || []).join(", ") }, { name: "code", label: "Plugin code", type: "textarea", code: true, rows: 10, value: p?.code || "" }, { name: "published", label: "Published", type: "checkbox", value: p ? p.published : true }], async v => { await api("POST", "/admin/plugins", v); draw(); }, { wide: true });
    $("#add").onclick = () => form(); el.onclick = async e => { const b = e.target.closest("[data-a]"); if (!b) return; const p = list.find(x => x.slug === b.closest("tr").dataset.s); if (b.dataset.a === "edit") form(p); else if (await confirmBox("Remove plugin?", p.name, "Remove", true)) { await api("POST", "/admin/plugins/delete", { slug: p.slug }); draw(); } };
  };
  await draw();
};

/* ================= Monitoring ================= */
P.monitoring = async el => {
  const paint = d => {
    el.innerHTML = `<div class="page">${head("Monitoring", "Live health of every API. Auto-refresh 30 s.", `<button class="btn" id="run">Run health checks</button>`)}
    <div class="grid g4">${stat("Requests (24h)", fmtN(d.system.requests24h), "blue")}${stat("Errors (24h)", fmtN(d.system.errors24h), "red", d.system.errorRate + "%")}${stat("Gateway avg", (d.system.avgGatewayMs ?? "–") + " ms", "green")}${stat("DB latency", (d.system.dbLatency ?? "–") + " ms", "purple")}</div>
    <div class="card mt"><div class="scroll"><table class="table"><tr><th>API</th><th>Status</th><th>Latency</th><th>Uptime 24h</th><th>Checks</th><th>Last check</th></tr>${d.apis.map(a => `<tr><td><b>${esc(a.name)}</b></td><td><span class="pill ${esc(a.status)}">${esc(a.status.replace("_", " "))}</span></td><td>${a.latency != null ? a.latency + " ms" : "–"}</td><td>${a.uptime != null ? a.uptime + "%" : "–"}</td><td>${a.checks}</td><td class="sm dim">${a.checkedAt ? ago(a.checkedAt) : "never"}</td></tr>`).join("")}</table></div></div>
    <div class="card mt"><h3>Requests per hour</h3>${barChart(d.hourly.map(h => ({ label: new Date(h.t).getHours() + "h", value: h.requests, value2: h.errors })))}</div></div>`;
    $("#run").onclick = () => busy($("#run"), async () => { await api("POST", "/admin/monitor/run"); paint(await api("GET", "/admin/monitor")); toast("Checks complete"); });
  };
  paint(await api("GET", "/admin/monitor"));
  timer = setInterval(async () => { try { paint(await api("GET", "/admin/monitor")); } catch { /* ignore */ } }, 30000);
};

/* ================= Maintenance ================= */
P.maintenance = async el => {
  const m = await api("GET", "/admin/maintenance");
  el.innerHTML = `<div class="page">${head("Maintenance Mode", "When ON, all API requests and user logins are disabled. This admin panel stays available.")}
  <div class="card" style="max-width:640px"><div class="row between"><h3 style="margin:0">Status</h3><span class="pill ${m.on ? "warning" : "online"}">${m.on ? "MAINTENANCE ON" : "operational"}</span></div>
  <label class="field mt"><span>Message shown to users and returned by the API</span><textarea class="input" id="mm" maxlength="300" placeholder="We'll be back at 10 PM.">${esc(m.message)}</textarea></label><div id="me"></div>
  <div class="row"><button class="btn ${m.on ? "green" : "red"}" id="mt">${m.on ? "Disable maintenance mode" : "Enable maintenance mode"}</button><button class="btn ghost" id="ms">Save message only</button></div></div></div>`;
  const save = on => busy($(on === undefined ? "#ms" : "#mt"), async () => { try { await api("POST", "/admin/maintenance", { on: on === undefined ? m.on : on, message: $("#mm").value }); toast("Saved"); route(); } catch (e) { $("#me").innerHTML = errBox(e.message); } });
  $("#mt").onclick = () => save(!m.on); $("#ms").onclick = () => save();
};

/* ================= Admins & security ================= */
P.admins = async el => {
  const list = await api("GET", "/admin/admins");
  el.innerHTML = `<div class="page">${head("Admins & Security", "Admin accounts are separate from user accounts.", `<button class="btn" id="add">+ New admin</button>`)}
  <div class="grid g2" style="align-items:start"><div class="card"><h3>Admin accounts</h3><div class="list">${list.map(a => `<div class="item"><div class="grow"><b>${esc(a.username)}</b>${a.id === ME.id ? " (you)" : ""}<small>last login ${a.lastLogin ? ago(a.lastLogin) : "never"}</small></div>${a.id === ME.id ? "" : `<button class="btn xs red" data-id="${esc(a.id)}">Delete</button>`}</div>`).join("")}</div></div>
  <div class="card"><h3>Change my password</h3><label class="field"><span>Current password</span><input class="input" id="cp" type="password" autocomplete="current-password"></label><label class="field"><span>New password (10+ chars, letters and numbers)</span><input class="input" id="np" type="password" autocomplete="new-password" maxlength="64"></label><div id="pe"></div><button class="btn" id="pb">Change password</button></div></div></div>`;
  $("#add").onclick = () => formModal("New admin", [{ name: "username", label: "Username" }, { name: "password", label: "Password (10+ chars)", type: "password" }], async v => { await api("POST", "/admin/admins", v); toast("Admin created"); route(); });
  $("#pb").onclick = () => busy($("#pb"), async () => { try { await api("POST", "/admin/password", { current: $("#cp").value, password: $("#np").value }); $("#pe").innerHTML = `<div class="note">Password changed.</div>`; } catch (e) { $("#pe").innerHTML = errBox(e.message); } });
  el.onclick = async e => { const b = e.target.closest("[data-id]"); if (b && (await confirmBox("Delete admin?", "They lose access immediately.", "Delete", true))) { await act(() => api("POST", "/admin/admins/delete", { id: b.dataset.id }), "Deleted"); route(); } };
};

init();

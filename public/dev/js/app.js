import { $, $$, api, esc, fmtN, fmtDate, ago, icon, spark, areaChart, toast, copy, busy, modal, confirmBox, formModal, loading, errBox, setAuthFail, brandHtml, footHtml, colorJson, prettyJson, sendRequest, store, lstore } from "./core.js";
import { S, HINTS, genCode, statusClass, leave } from "./state.js";
import { dashboard } from "./dash.js";
import { analytics, docs, tickets, marketplace, changelog, settings, monitoring } from "./pages2.js";

const NAV = [
  ["dashboard", "Dashboard", "grid"], ["categories", "API Categories", "layers"], ["playground", "API Playground", "code"],
  ["keys", "My API Keys", "key"], ["analytics", "Usage Analytics", "chart"], ["monitoring", "API Monitoring", "pulse"],
  ["docs", "Documentation", "book"], ["tickets", "Support Tickets", "chat"], ["marketplace", "Plugin Marketplace", "box"],
  ["changelog", "Changelog", "clock"], ["settings", "Profile & Settings", "user"]
];
const PAGES = { dashboard, categories, playground, keys, analytics, monitoring, docs, tickets, marketplace, changelog, settings };

setAuthFail(() => { if (S.user) location.replace("/dev/login"); });

function shell() {
  $("#side").innerHTML = `${brandHtml()}<nav class="nav" aria-label="Main">${NAV.map(([id, l, ic]) => `<a href="#/${id}" data-p="${id}">${icon(ic)}<span>${l}</span></a>`).join("")}</nav>
  <div class="side-foot"><div class="mini" id="planMini"></div><a class="mini partner" href="/"><span class="wa">✆</span><span><b>SHAN MINI BOT</b><span class="dim">Official Partner</span></span></a></div>`;
  $("#burger").innerHTML = icon("menu"); $("#sIc").innerHTML = icon("search"); $("#bell").innerHTML = icon("bell");
  $("#footer").innerHTML = footHtml();
  const u = S.user;
  $("#who").innerHTML = `<span class="av">${esc(u.username[0].toUpperCase())}</span><span class="nm"><b>${esc(u.username)}</b><small>● Online</small></span>`;
  $("#planMini").innerHTML = `<span class="crown">${icon("crown").replace("<svg", '<svg width="14" style="vertical-align:-2px"')} ${esc(u.planName)}</span><br><span class="dim">${u.plan === "free" ? "50 requests / key, lifetime" : u.planExpires ? "Expires " + fmtDate(u.planExpires) : "No expiry"}</span>${u.plan === "free" ? `<a class="btn block xs mt" href="#/tickets/new">Upgrade</a>` : ""}`;
  const close = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("show"); };
  $("#burger").onclick = () => { $("#side").classList.toggle("open"); $("#scrim").classList.toggle("show"); };
  $("#scrim").onclick = close; $("#side").addEventListener("click", e => { if (e.target.closest("a")) close(); });
  $("#gsearch").addEventListener("keydown", e => { if (e.key === "Enter") { store.set("catq", e.target.value.trim()); location.hash = "#/categories"; e.target.value = ""; } });
  $("#who").onclick = () => { const m = modal(`<h2>${esc(u.username)}</h2><p class="muted">${esc(u.email)} · ${esc(u.planName)}</p><div class="row mt"><a class="btn ghost" href="#/settings" data-close>Settings</a><button class="btn red" id="lo">${icon("logout").replace("<svg", '<svg width="16"')} Log out</button></div>`); m.$("#lo").onclick = logout; };
  $("#bell").onclick = openBell;
}
async function logout() { try { await api("POST", "/auth/logout"); } catch { /* ignore */ } location.replace("/dev/login"); }
async function openBell() {
  try {
    const n = await api("GET", "/notifications");
    modal(`<h2>Notifications</h2>${n.items.length ? n.items.map(i => `<div class="item list"><div class="grow"><a href="#/tickets/${esc(i.id)}" data-close>${esc(i.text)}</a><small>${ago(i.t)}</small></div></div>`).join("") : `<p class="muted">No new notifications.</p>`}`);
  } catch (e) { toast(e.message, true); }
}
async function refreshBell() {
  try { const n = await api("GET", "/notifications"); $("#bell").innerHTML = icon("bell") + (n.unread ? `<span class="dot">${n.unread}</span>` : ""); } catch { /* ignore */ }
}

async function route() {
  leave.splice(0).forEach(f => f());
  const [, page = "dashboard", arg = ""] = location.hash.split("?")[0].split("/");
  const id = PAGES[page] ? page : "dashboard";
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.p === id));
  const el = $("#view"); el.onclick = el.oninput = el.onchange = null; el.innerHTML = `<div class="page">${loading()}</div>`;
  scrollTo(0, 0);
  try { await PAGES[id](el, decodeURIComponent(arg)); }
  catch (e) { el.innerHTML = `<div class="page">${errBox(e.message)}<button class="btn" onclick="location.reload()">Retry</button></div>`; }
  refreshBell();
}

async function boot() {
  let st;
  try { st = await api("GET", "/status"); } catch (e) { $("#boot").innerHTML = errBox(e.message); return; }
  if (st.maintenance.on) {
    $("#boot").hidden = true; const m = $("#maintScreen"); m.hidden = false;
    m.innerHTML = `<div class="card" style="max-width:480px"><div style="font-size:40px">🛠</div><h1>Under maintenance</h1><p class="muted mt">${esc(st.maintenance.message || "We will be back shortly.")}</p><p class="sm dim mt">API requests are temporarily disabled.</p></div>`;
    return;
  }
  try { S.user = (await api("GET", "/me")).user; } catch { location.replace("/dev/login"); return; }
  S.catalog = await api("GET", "/catalog").catch(() => []);
  $("#boot").hidden = true; $("#app").hidden = false;
  $("#annBar").innerHTML = st.announcements.map(a => `<div class="banner ${esc(a.level)}"><b>📢 ${esc(a.title)}</b><span class="muted">${esc(a.body)}</span></div>`).join("");
  shell(); window.addEventListener("hashchange", route); route();
}
boot();

/* ================= API Categories ================= */
export function readJsonModal(cat, presetKey) {
  const savedKey = store.get("shan_key", "");
  const m = modal(`<h2>Read JSON — ${esc(cat.name)}</h2><p class="muted sm">This sends a <b>real</b> ${esc(cat.method)} request to <span class="mono">${esc(cat.endpoint)}</span> and shows the actual response.</p>
    <label class="field mt"><span>Your API key</span><input class="input" id="rjKey" type="password" autocomplete="off" value="${esc(presetKey || savedKey)}" placeholder="shan_live_…"></label>
    ${cat.params.map(p => `<label class="field"><span>${esc(p.name)} ${p.required ? "(required)" : "(optional)"}</span><input class="input rjp" data-n="${esc(p.name)}" placeholder="${esc(p.description)}"></label>`).join("")}
    <button class="btn" id="rjGo">Send request</button><div id="rjOut" class="mt"></div>`, { wide: true });
  m.$("#rjGo").onclick = () => busy(m.$("#rjGo"), async () => {
    const key = m.$("#rjKey").value.trim(); if (key) store.set("shan_key", key);
    const url = new URL(cat.endpoint); $$(".rjp", m.el).forEach(i => i.value.trim() && url.searchParams.set(i.dataset.n, i.value.trim()));
    const r = await sendRequest({ url: url.toString(), method: cat.method, headers: key ? { "x-api-key": key } : {} });
    m.$("#rjOut").innerHTML = responseView(r); wireResponse(m.el, r);
  });
}
function responseView(r) {
  const pretty = prettyJson(r.text);
  let hint = "";
  if (!r.ok) { try { const c = JSON.parse(r.text).error?.code; hint = HINTS[c] || ""; } catch { /* ignore */ } }
  return `<div class="row"><span class="pill ${statusClass(r.status)}">HTTP ${r.status || "ERR"} ${esc(r.statusText)}</span><span class="pill info">${r.ms} ms</span><span class="pill">${fmtN(r.size)} bytes</span><span class="sp" style="flex:1"></span>${r.text ? `<button class="btn xs ghost" data-act="copyjson">Copy JSON</button>` : ""}</div>
  ${r.error ? `<div class="err">${esc(r.error)}</div>` : ""}${hint ? `<div class="note mt">${esc(hint)}</div>` : ""}
  ${r.text ? `<pre class="code mt" data-pre>${pretty ? colorJson(pretty) : esc(r.text.slice(0, 20000))}</pre>` : ""}`;
}
function wireResponse(root, r) { const b = $('[data-act="copyjson"]', root); if (b) b.onclick = () => copy(prettyJson(r.text) || r.text, "JSON copied"); }

async function categories(el) {
  const cats = S.catalog; let q = store.get("catq", ""); store.set("catq", "");
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>API Categories</h1><p>${cats.length} APIs · authenticate with your API key (x-api-key header)</p></div><input class="input" id="cq" placeholder="Filter APIs…" style="max-width:260px" value="${esc(q)}"></div><div class="grid g3" id="cg"></div></div>`;
  const draw = () => {
    const f = $("#cq").value.trim().toLowerCase();
    const list = cats.filter(c => !f || (c.name + c.slug + c.description).toLowerCase().includes(f));
    $("#cg").innerHTML = list.length ? list.map(c => `<div class="card glow" data-slug="${esc(c.slug)}">
      <h3><span class="ellipsis">${esc(c.name)}</span><span class="row" style="gap:6px">${c.premium ? `<span class="pill premium">Premium</span>` : `<span class="pill">Free</span>`}<span class="pill ${esc(c.status)}">${esc(c.status.replace("_", " "))}</span></span></h3>
      <p class="muted sm">${esc(c.description)}</p>
      <div class="row mt" style="gap:6px"><span class="badge-m">${esc(c.method)}</span><span class="mono sm ellipsis" style="flex:1" title="${esc(c.endpoint)}">${esc(c.endpoint.replace(/^https?:\/\//, ""))}</span></div>
      <p class="sm dim mt">🔐 ${esc(c.auth)}</p>
      <details class="mt"><summary class="sm" style="cursor:pointer;color:var(--cyan)">Parameters (${c.params.length})</summary>${c.params.length ? `<table class="table sm">${c.params.map(p => `<tr><td class="mono">${esc(p.name)}</td><td>${esc(p.type)}${p.required ? ' <span class="pill danger">required</span>' : ""}</td><td class="muted">${esc(p.description)}</td></tr>`).join("")}</table>` : `<p class="muted sm">No parameters.</p>`}</details>
      <details><summary class="sm" style="cursor:pointer;color:var(--cyan)">Example request</summary><pre class="code" style="white-space:pre-wrap">${esc(c.exampleRequest)}</pre><button class="btn xs ghost" data-a="cr">Copy</button></details>
      <details><summary class="sm" style="cursor:pointer;color:var(--cyan)">Example JSON response (format only)</summary><pre class="code">${colorJson(c.exampleResponse || "{}")}</pre></details>
      <div class="row mt"><button class="btn xs ghost" data-a="url">Copy URL</button><button class="btn xs cyan" data-a="read">Read JSON</button><a class="btn xs ghost" href="#/playground/${esc(c.slug)}">Playground</a></div></div>`).join("") : `<div class="empty">No API matches.</div>`;
  };
  draw(); $("#cq").oninput = draw;
  $("#cg").onclick = e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const c = cats.find(x => x.slug === b.closest("[data-slug]").dataset.slug);
    if (b.dataset.a === "url") copy(c.endpoint, "URL copied"); else if (b.dataset.a === "cr") copy(c.exampleRequest, "Copied"); else readJsonModal(c);
  };
}

/* ================= API Playground (+ JSON formatter, history, code generator) ================= */
async function playground(el, arg) {
  const cat = S.catalog.find(c => c.slug === arg);
  let method = cat?.method || "GET", tab = "req", lang = "curl", last = null;
  let params = cat ? cat.params.map(p => ({ k: p.name, v: "" })) : [{ k: "", v: "" }];
  let headers = [{ k: "Accept", v: "application/json" }];
  const url0 = cat ? cat.endpoint : (S.catalog[0]?.endpoint || location.origin + "/api/dev/v1/english-movies");
  el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>API Playground</h1><p>Send real requests to the SHAN API gateway and inspect the live response.</p></div></div>
  <div class="tabs" id="pgt"><button data-t="req" class="on">Request</button><button data-t="fmt">JSON Formatter</button><button data-t="hist">History</button></div>
  <div id="pgBody"></div></div>`;
  const body = $("#pgBody");
  const kvRows = (arr, cls) => arr.map((x, i) => `<div class="kv"><input class="input ${cls}k" data-i="${i}" value="${esc(x.k)}" placeholder="name"><input class="input ${cls}v" data-i="${i}" value="${esc(x.v)}" placeholder="value"><button class="btn xs ghost" data-del="${cls}" data-i="${i}" aria-label="Remove">✕</button></div>`).join("");
  function build() {
    const key = $("#pgKey")?.value.trim() || store.get("shan_key", "");
    const u = new URL($("#pgUrl")?.value.trim() || url0);
    params.filter(p => p.k).forEach(p => u.searchParams.set(p.k, p.v));
    const h = {}; headers.filter(x => x.k).forEach(x => (h[x.k] = x.v));
    if (key) h["x-api-key"] = key;
    return { url: u.toString(), method, headers: h, body: $("#pgBody2")?.value.trim() || "", key };
  }
  function drawReq() {
    body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="stack">
      <div class="card"><h3>Request</h3>
        <div class="row" style="flex-wrap:nowrap"><select class="input" id="pgM" style="width:110px">${["GET", "POST"].map(m => `<option ${m === method ? "selected" : ""}>${m}</option>`).join("")}</select><input class="input" id="pgUrl" list="eps" value="${esc(url0)}" aria-label="Endpoint URL"><datalist id="eps">${S.catalog.map(c => `<option value="${esc(c.endpoint)}">${esc(c.name)}</option>`).join("")}</datalist></div>
        <label class="field mt"><span>API key (sent as x-api-key; kept in this tab only)</span><input class="input" id="pgKey" type="password" autocomplete="off" value="${esc(store.get("shan_key", ""))}" placeholder="shan_live_…"></label>
        <h3 style="font-size:13px">Parameters <button class="btn xs ghost" id="addP">+ Add</button></h3><div id="pRows">${kvRows(params, "p")}</div>
        <h3 style="font-size:13px">Headers <button class="btn xs ghost" id="addH">+ Add</button></h3><div id="hRows">${kvRows(headers, "h")}</div>
        <div id="bodyBox" ${method === "GET" ? "hidden" : ""}><label class="field"><span>Body (JSON)</span><textarea class="input code" id="pgBody2" rows="4">{}</textarea></label></div>
        <div id="pgErr"></div><button class="btn block" id="pgSend">${icon("send").replace("<svg", '<svg width="16"')} Send request</button></div>
      <div class="card"><h3>Code generator</h3><div class="tabs" id="lt">${[["curl", "cURL"], ["js", "JavaScript"], ["node", "Node.js"], ["py", "Python"]].map(([k, l]) => `<button data-l="${k}" class="${k === lang ? "on" : ""}">${l}</button>`).join("")}</div><pre class="code" id="gen"></pre><button class="btn xs ghost" id="genCopy">Copy code</button></div></div>
      <div class="card"><h3>Response</h3><div id="pgOut">${last ? responseView(last) : `<div class="empty">Press <b>Send request</b> to see the live response.</div>`}</div></div></div>`;
    const sync = () => { const b = build(); const hh = { ...b.headers }; if (hh["x-api-key"]) hh["x-api-key"] = "YOUR_API_KEY"; $("#gen").textContent = genCode(lang, { ...b, headers: hh, body: method === "GET" ? "" : b.body }); };
    const readKv = () => { params = $$(".pk", body).map((e, i) => ({ k: e.value, v: $$(".pv", body)[i].value })); headers = $$(".hk", body).map((e, i) => ({ k: e.value, v: $$(".hv", body)[i].value })); };
    body.oninput = () => { readKv(); sync(); };
    $("#pgM").onchange = e => { method = e.target.value; $("#bodyBox").hidden = method === "GET"; sync(); };
    $("#addP").onclick = () => { readKv(); params.push({ k: "", v: "" }); drawReq(); };
    $("#addH").onclick = () => { readKv(); headers.push({ k: "", v: "" }); drawReq(); };
    body.onclick = e => { const d = e.target.closest("[data-del]"); if (d) { readKv(); (d.dataset.del === "p" ? params : headers).splice(+d.dataset.i, 1); drawReq(); } };
    $$("#lt button").forEach(b => b.onclick = () => { lang = b.dataset.l; $$("#lt button").forEach(x => x.classList.toggle("on", x === b)); sync(); });
    $("#genCopy").onclick = () => copy($("#gen").textContent, "Code copied");
    $("#pgSend").onclick = () => busy($("#pgSend"), async () => {
      $("#pgErr").innerHTML = ""; readKv(); let b;
      try { b = build(); new URL(b.url); } catch { $("#pgErr").innerHTML = errBox("Enter a valid endpoint URL."); return; }
      if (b.method !== "GET" && b.body) { try { JSON.parse(b.body); } catch { $("#pgErr").innerHTML = errBox("The body is not valid JSON."); return; } }
      if (b.key) store.set("shan_key", b.key);
      last = await sendRequest(b);
      const h = lstore.get("pg_hist", []); h.unshift({ t: Date.now(), method: b.method, url: b.url, status: last.status, ms: last.ms }); lstore.set("pg_hist", h.slice(0, 25));
      $("#pgOut").innerHTML = responseView(last); wireResponse($("#pgOut"), last);
    });
    sync(); if (last) wireResponse($("#pgOut"), last);
  }
  function drawFmt() {
    body.innerHTML = `<div class="card"><h3>JSON Formatter</h3><textarea class="input code" id="jf" rows="12" placeholder='Paste JSON here, e.g. {"a":1}'></textarea><div id="jfe"></div><div class="row mt"><button class="btn" id="jfF">Format</button><button class="btn ghost" id="jfM">Minify</button><button class="btn ghost" id="jfC">Copy</button><button class="btn ghost" id="jfL">Use last response</button></div></div>`;
    const ta = $("#jf"), put = f => { try { ta.value = f(JSON.parse(ta.value)); $("#jfe").innerHTML = ""; } catch (e) { $("#jfe").innerHTML = errBox("Invalid JSON: " + e.message); } };
    $("#jfF").onclick = () => put(j => JSON.stringify(j, null, 2)); $("#jfM").onclick = () => put(j => JSON.stringify(j));
    $("#jfC").onclick = () => copy(ta.value, "Copied"); $("#jfL").onclick = () => { if (last?.text) ta.value = last.text; else toast("Send a request first", true); };
  }
  function drawHist() {
    const h = lstore.get("pg_hist", []);
    body.innerHTML = `<div class="card"><h3>Request history <button class="btn xs ghost" id="hc">Clear</button></h3>${h.length ? `<div class="scroll"><table class="table"><tr><th>When</th><th>Request</th><th>Status</th><th>Time</th></tr>${h.map(x => `<tr><td>${ago(x.t)}</td><td class="mono sm"><span class="badge-m">${esc(x.method)}</span> ${esc(x.url.replace(/^https?:\/\//, ""))}</td><td><span class="pill ${statusClass(x.status)}">${x.status || "ERR"}</span></td><td>${x.ms} ms</td></tr>`).join("")}</table></div><p class="sm dim mt">Stored in this browser only. API keys are never saved in history. Full server-side history is on Usage Analytics.</p>` : `<div class="empty">No requests yet.</div>`}</div>`;
    $("#hc").onclick = () => { lstore.set("pg_hist", []); drawHist(); };
  }
  const draw = () => ({ req: drawReq, fmt: drawFmt, hist: drawHist }[tab])();
  $$("#pgt button").forEach(b => b.onclick = () => { tab = b.dataset.t; $$("#pgt button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
  draw();
}

/* ================= My API Keys ================= */
function showNewKey(secret, title) {
  store.set("shan_key", secret);
  const m = modal(`<h2>${esc(title)}</h2><div class="warnbox">Copy this key now. For security only a hash is stored — it <b>cannot be shown again</b>.</div>
    <pre class="code mt" id="nkVal" style="white-space:pre-wrap;word-break:break-all">${esc(secret)}</pre>
    <div class="row mt"><button class="btn" id="nkc">Copy API key</button><button class="btn ghost" data-close>Done</button></div><p class="sm dim mt">It is remembered in this browser tab only so the Playground can use it.</p>`);
  m.$("#nkc").onclick = () => copy(secret, "API key copied");
}
const EXPIRY = [["0", "Never expires"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]];
async function keys(el, arg) {
  const draw = async () => {
    const d = await api("GET", "/keys"), q = d.quota;
    el.innerHTML = `<div class="page"><div class="pagehead"><div><h1>My API Keys</h1><p>Keys authenticate API requests — they are never used to log in to this website.</p></div><button class="btn" id="nk">+ Generate API key</button></div>
    <div class="grid g3"><div class="card stat c-purple"><small>Plan</small><b style="font-size:20px">${esc(S.user.planName)}</b><span class="sub">${esc(q.mode)}</span></div>
      <div class="card stat c-green"><small>Requests remaining</small><b>${q.unlimited ? "Unlimited" : fmtN(q.remaining)}</b><span class="sub">${q.plan === "free" ? "50 per key, for the key's whole lifetime" : "shared across your keys"}</span></div>
      <div class="card stat c-blue"><small>Keys</small><b>${d.keys.filter(k => k.status !== "revoked").length} / ${d.maxKeys}</b><span class="sub">active keys / plan limit</span></div></div>
    <div class="stack mt">${d.keys.length ? d.keys.map(k => `<div class="card" data-id="${esc(k.id)}"><div class="row between"><div class="row"><b>${esc(k.name)}</b><span class="pill ${esc(k.status)}">${esc(k.status)}</span></div><span class="mono sm">${esc(k.prefix)}</span></div>
      <div class="grid g4 mt sm"><div><span class="dim">Created</span><br>${fmtDate(k.createdAt)}</div><div><span class="dim">Last used</span><br>${k.lastUsedAt ? ago(k.lastUsedAt) : "never"}</div><div><span class="dim">Expires</span><br>${k.expiresAt ? fmtDate(k.expiresAt) : "never"}</div><div><span class="dim">Requests made</span><br><b>${fmtN(k.used)}</b>${q.plan === "free" && k.limit ? ` <span class="dim">· ${fmtN(k.remaining)} / ${k.limit} left</span>` : ""}</div></div>
      ${q.plan === "free" && k.limit ? `<div class="bar mt"><i style="width:${Math.max(0, Math.min(100, (k.remaining / k.limit) * 100))}%"></i></div>` : ""}
      <p class="sm mt"><span class="dim">IP whitelist:</span> ${k.ips.length ? k.ips.map(i => `<span class="pill">${esc(i)}</span>`).join(" ") : "any IP"}</p>
      ${k.status === "revoked" ? "" : `<div class="row mt"><button class="btn xs ghost" data-a="edit">Edit</button><button class="btn xs ghost" data-a="toggle">${k.status === "inactive" ? "Activate" : "Deactivate"}</button><button class="btn xs cyan" data-a="regen">Regenerate</button><button class="btn xs red" data-a="revoke">Revoke</button><a class="btn xs ghost" href="#/playground">Test</a></div>`}</div>`).join("") : `<div class="card empty">You have no API keys yet. Generate your first key to start calling the API.</div>`}</div></div>`;
    $("#nk").onclick = create;
    el.onclick = async e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const k = d.keys.find(x => x.id === b.closest("[data-id]").dataset.id);
      try {
        if (b.dataset.a === "regen") { if (!(await confirmBox("Regenerate key?", "The old secret stops working immediately. Your remaining quota is kept.", "Regenerate"))) return; const r = await api("POST", "/keys/regenerate", { id: k.id }); await draw(); showNewKey(r.key, "New API key"); }
        else if (b.dataset.a === "revoke") { if (!(await confirmBox("Revoke key?", "This cannot be undone. Requests using this key will be rejected.", "Revoke", true))) return; await api("POST", "/keys/revoke", { id: k.id }); toast("Key revoked"); draw(); }
        else if (b.dataset.a === "toggle") { await api("POST", "/keys/toggle", { id: k.id, active: k.status === "inactive" }); draw(); }
        else if (b.dataset.a === "edit") formModal("Edit key", [{ name: "name", label: "Name", value: k.name }, { name: "ips", label: "IP whitelist (comma or line separated, CIDR allowed; empty = any)", type: "textarea", value: k.ips.join("\n"), rows: 3 }, { name: "exp", label: "Expiry", type: "select", options: [["keep", "Keep current"], ...EXPIRY] }],
          async v => { const body = { id: k.id, name: v.name, ips: v.ips }; if (v.exp !== "keep") body.expiresDays = +v.exp; await api("POST", "/keys/update", body); toast("Saved"); draw(); });
      } catch (err) { toast(err.message, true); }
    };
  };
  const create = () => formModal("Generate API key", [{ name: "name", label: "Key name", placeholder: "e.g. my-whatsapp-bot" }, { name: "exp", label: "Expiry", type: "select", options: EXPIRY }, { name: "ips", label: "IP whitelist (optional)", type: "textarea", rows: 2, placeholder: "203.0.113.10, 198.51.100.0/24", hint: "Leave empty to allow any IP." }],
    async v => { const r = await api("POST", "/keys", { name: v.name, expiresDays: +v.exp, ips: v.ips }); await draw(); showNewKey(r.key, "Your new API key"); }, { submit: "Generate" });
  await draw(); if (arg === "new") create();
}

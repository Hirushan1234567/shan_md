/* Shared helpers for the SHAN API Developer Platform frontend (no secrets live in frontend code). */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtN = n => (n == null ? "–" : Number(n).toLocaleString("en-US"));
export const fmtDate = t => (t ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–");
export const fmtDay = t => (t ? new Date(t).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "–");
export function ago(t) {
  if (!t) return "never";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " hr ago";
  return Math.floor(s / 86400) + " d ago";
}

/* ---------- API client (cookie session + CSRF header) ---------- */
export class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
let onAuthFail = () => {};
export const setAuthFail = f => { onAuthFail = f; };
export async function api(method, path, body) {
  let r;
  try {
    r = await fetch("/api/dev" + path, {
      method, credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "shan-dev" },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new ApiError("Network error. Check your connection.", 0); }
  let d = {}; try { d = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) {
    if (r.status === 401) onAuthFail(d.error);
    throw new ApiError(d.error || `Request failed (HTTP ${r.status})`, r.status, d);
  }
  return d;
}
export const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== "" && v != null && p.set(k, v)); const s = p.toString(); return s ? "?" + s : ""; };

/* ---------- UI helpers ---------- */
export function toast(msg, bad = false) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.classList.toggle("bad", bad); t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2800);
}
export async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast(label); } catch { toast("Copy failed", true); } ta.remove();
  }
}
export const loading = (msg = "Loading…") => `<div class="loading"><span class="spin"></span>${esc(msg)}</div>`;
export const errBox = m => `<div class="err">${esc(m)}</div>`;
export async function busy(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
export function modal(html, { wide = false } = {}) {
  const m = document.createElement("div"); m.className = "modal show";
  m.innerHTML = `<div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => m.remove();
  m.addEventListener("mousedown", e => { if (e.target === m) close(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  document.body.append(m);
  $$("[data-close]", m).forEach(b => b.addEventListener("click", close));
  return { el: m, close, $: s => $(s, m) };
}
export function confirmBox(title, text, okLabel = "Confirm", danger = false) {
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="row mt" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? "red" : ""}" id="cfOk">${esc(okLabel)}</button></div>`);
    m.$("#cfOk").onclick = () => { m.close(); res(true); };
    m.el.addEventListener("click", e => { if (e.target === m.el || e.target.dataset.close !== undefined) res(false); });
  });
}
/** Generic form dialog. fields: {name,label,type,options,value,placeholder,rows,hint} */
export function formModal(title, fields, onSubmit, { submit = "Save", wide = false } = {}) {
  const f = x => {
    const v = x.value ?? "";
    const id = "f_" + x.name;
    if (x.type === "checkbox") return `<label class="sw"><input type="checkbox" id="${id}" ${x.value ? "checked" : ""}> <span>${esc(x.label)}</span></label>`;
    let inp;
    if (x.type === "textarea") inp = `<textarea class="input ${x.code ? "code" : ""}" id="${id}" rows="${x.rows || 4}" placeholder="${esc(x.placeholder || "")}">${esc(v)}</textarea>`;
    else if (x.type === "select") inp = `<select class="input" id="${id}">${x.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
    else inp = `<input class="input" id="${id}" type="${x.type || "text"}" value="${esc(v)}" placeholder="${esc(x.placeholder || "")}" ${x.readonly ? "readonly" : ""} autocomplete="off">`;
    return `<label class="field"><span>${esc(x.label)}</span>${inp}${x.hint ? `<small class="dim">${esc(x.hint)}</small>` : ""}</label>`;
  };
  const m = modal(`<h2>${esc(title)}</h2><form id="fm">${fields.map(f).join("")}<div id="fmErr"></div><div class="row mt" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">${esc(submit)}</button></div></form>`, { wide });
  m.$("#fm").addEventListener("submit", async e => {
    e.preventDefault();
    const out = {};
    fields.forEach(x => { const el = m.$("#f_" + x.name); out[x.name] = x.type === "checkbox" ? el.checked : el.value; });
    const btn = m.$("#fm button[type=submit]");
    try { await busy(btn, () => onSubmit(out, m)); m.close(); }
    catch (err) { m.$("#fmErr").innerHTML = errBox(err.message); }
  });
  return m;
}

/* ---------- icons ---------- */
const P = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3m-4 4 3 3m-5-1 2 2"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.7" y2="16.7"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  crown: '<path d="M2 20h20M4 17 2 6l6 5 4-8 4 8 6-5-2 11z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1z"/><path d="M19 8a5 5 0 0 1 0 8"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2-.1-2.8a2 2 0 0 0-2.9-.2z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/>'
};
export const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;

/* ---------- charts (inline SVG, no external libraries) ---------- */
export function spark(values, color = "#9b4dff") {
  const v = values.length > 1 ? values : [0, ...values, 0];
  const max = Math.max(...v, 1), w = 100, h = 40;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 4 - (y / max) * (h - 8)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const id = "sp" + Math.random().toString(36).slice(2, 7);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
/** series: [{label, value, value2?}] — area chart with optional second (error) line */
export function areaChart(series, { color = "#7c5cff", color2 = "#ff4d6d", height = 210, unit = "requests" } = {}) {
  const W = 640, H = height, L = 38, B = 24, T = 10, R = 8;
  if (!series.length) return `<div class="empty">No data yet</div>`;
  const max = Math.max(...series.map(s => Math.max(s.value, s.value2 || 0)), 4);
  const nice = Math.ceil(max / 4) * 4;
  const x = i => L + (i / Math.max(series.length - 1, 1)) * (W - L - R);
  const y = v => H - B - (v / nice) * (H - B - T);
  const path = key => series.map((s, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s[key] || 0).toFixed(1)).join(" ");
  const id = "ac" + Math.random().toString(36).slice(2, 7);
  const grid = [0, 1, 2, 3, 4].map(i => { const v = (nice / 4) * i, yy = y(v); return `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="rgba(139,92,246,.15)"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${fmtN(Math.round(v))}</text>`; }).join("");
  const step = Math.ceil(series.length / 7);
  const xl = series.map((s, i) => (i % step === 0 || i === series.length - 1) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(s.label)}</text>` : "").join("");
  const dots = series.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.value)}" r="${series.length > 40 ? 0 : 3}" fill="${color}"><title>${esc(s.label)}: ${s.value} ${unit}${s.value2 ? `, ${s.value2} errors` : ""}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${unit} chart"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".5"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}${xl}
  <path d="${path("value")} L${x(series.length - 1)} ${H - B} L${L} ${H - B} Z" fill="url(#${id})"/><path d="${path("value")}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
  ${series.some(s => s.value2) ? `<path d="${path("value2")}" fill="none" stroke="${color2}" stroke-width="1.8" stroke-dasharray="4 3"/>` : ""}${dots}</svg>`;
}
export function barChart(series, { color = "#2f7bff", color2 = "#ff4d6d", height = 180 } = {}) {
  const W = 640, H = height, L = 34, B = 22, T = 8;
  const max = Math.max(...series.map(s => s.value), 4), bw = (W - L) / series.length;
  const bars = series.map((s, i) => {
    const h1 = (s.value / max) * (H - B - T), h2 = ((s.value2 || 0) / max) * (H - B - T), bx = L + i * bw + 2;
    return `<rect x="${bx}" y="${H - B - h1}" width="${bw - 4}" height="${h1}" rx="2" fill="${color}"><title>${esc(s.label)}: ${s.value}</title></rect>${s.value2 ? `<rect x="${bx}" y="${H - B - h2}" width="${bw - 4}" height="${h2}" rx="2" fill="${color2}"/>` : ""}${i % 3 === 0 ? `<text x="${bx + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(s.label)}</text>` : ""}`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${L}" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="rgba(139,92,246,.3)"/><text x="${L - 4}" y="${T + 6}" text-anchor="end">${fmtN(max)}</text>${bars}</svg>`;
}
export function hbars(rows, color = "var(--purple)") {
  if (!rows.length) return `<div class="empty">No data yet</div>`;
  const max = Math.max(...rows.map(r => r.count), 1);
  return rows.map(r => `<div class="hbar"><span title="${esc(r.name)}">${esc(r.name)}</span><div class="bar"><i style="width:${(r.count / max) * 100}%;background:${color}"></i></div><b>${fmtN(r.count)}</b></div>`).join("");
}

/* ---------- JSON helpers ---------- */
export function colorJson(text) {
  return esc(text).replace(/(&quot;(?:\\.|[^&])*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, (m, str, colon, kw, num) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (kw) return `<span class="b">${kw}</span>`;
    if (num) return `<span class="n">${num}</span>`;
    return m;
  });
}
export function prettyJson(text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; } }

/** Real HTTP request from the browser. Returns status, timing, body and error details. */
export async function sendRequest({ url, method = "GET", headers = {}, body }) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : body, credentials: "omit", redirect: "follow" });
    const text = await r.text();
    return { ok: r.ok, status: r.status, statusText: r.statusText, ms: Math.round(performance.now() - t0), text, size: text.length, headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) {
    return { ok: false, status: 0, statusText: "Network error", ms: Math.round(performance.now() - t0), text: "", size: 0, headers: {}, error: String(e.message || e) + " — the server was unreachable, or the browser blocked it (CORS / mixed content)." };
  }
}
export const store = {
  get: (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
};
export const lstore = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
};

export function brandHtml() {
  return `<div class="brand"><span class="crown">👑</span><b>SHAN API</b><small>Developer Platform V2</small></div>`;
}
export function footHtml() {
  return `<div class="foot"><span>© 2026 SHAN API Developer Platform. All rights reserved.</span><b>Code • Integrate • Innovate</b><span>Made with ♥ by SHAN MD</span></div>`;
}

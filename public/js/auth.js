import { $, api, toast, session } from "./api.js";

const FORMS = ["fLogin", "fReg", "fForgot", "fReset"];
const show = (el, on) => { el.hidden = !on; };
const err = (id, m) => { const e = $(id); e.textContent = m || ""; show(e, !!m); };
const resetToken = () => (location.hash.match(/reset=([\w-]+)/) || [])[1];

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.dataset.label ??= btn.textContent;
  btn.innerHTML = busy ? `<span class="spin"></span> ${label}` : btn.dataset.label;
}
function showForm(id) {
  FORMS.forEach(f => show($(f), f === id));
  show($("gTabs"), id === "fLogin" || id === "fReg");
  document.querySelectorAll("#gTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === id));
}

async function submit(e, btnId, errId, label, fn) {
  e.preventDefault(); err(errId, "");
  const btn = $(btnId); setBusy(btn, true, label);
  try { await fn(); } catch (ex) { err(errId, ex.message); } finally { setBusy(btn, false); }
}

export function initAuth(onLogin) {
  document.querySelectorAll("#gTabs button").forEach(b => b.addEventListener("click", () => showForm(b.dataset.t)));
  $("toForgot").addEventListener("click", e => { e.preventDefault(); showForm("fForgot"); });
  $("fgBack").addEventListener("click", () => showForm("fLogin"));

  $("fLogin").addEventListener("submit", e => submit(e, "loginBtn", "aErr", "Checking…", async () => {
    const username = $("aUser").value.trim(), password = $("aPass").value;
    if (!username || !password) throw new Error("Enter your username (or WhatsApp number) and password.");
    const d = await api("POST", "/auth/login", { username, password });
    session.token = d.token; $("aPass").value = "";
    toast("Welcome back, " + d.user.name); onLogin(d.user);
  }));

  $("fReg").addEventListener("submit", e => submit(e, "regBtn", "rErr", "Creating…", async () => {
    const d = await api("POST", "/auth/register", {
      username: $("rUser").value.trim(), email: $("rMail").value.trim(), password: $("rPass").value, ref: $("rRef").value.trim().toUpperCase()
    });
    session.token = d.token; $("rPass").value = "";
    toast("Account created. Welcome!"); onLogin(d.user);
  }));

  $("fForgot").addEventListener("submit", e => submit(e, "fgBtn", "fgErr", "Sending…", async () => {
    const d = await api("POST", "/auth/forgot", { email: $("fgMail").value.trim() });
    toast(d.message);
  }));

  $("fReset").addEventListener("submit", e => submit(e, "nwBtn", "nwErr", "Saving…", async () => {
    await api("POST", "/auth/reset", { token: resetToken(), password: $("nwPass").value });
    toast("Password updated. Please log in."); history.replaceState(null, "", location.pathname); $("nwPass").value = ""; showForm("fLogin");
  }));
}

export function resetGate() {
  ["aErr", "rErr", "fgErr", "nwErr"].forEach(i => err(i, ""));
  showForm(resetToken() ? "fReset" : "fLogin");
}

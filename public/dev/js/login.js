import { $, api, esc, errBox, busy, toast } from "./core.js";

const forms = ["login", "register", "forgot", "reset"];
const show = n => {
  forms.forEach(f => { $("#" + f).hidden = f !== n; });
  $("#tabs").hidden = !["login", "register"].includes(n);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === n));
};
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.t));
$("#toForgot").onclick = e => { e.preventDefault(); show("forgot"); };
$("#backLogin").onclick = e => { e.preventDefault(); show("login"); };

const resetToken = (location.hash.match(/reset=([\w-]+)/) || [])[1];
if (resetToken) show("reset");

// already signed in? go to the dashboard. Also show maintenance info.
api("GET", "/status").then(s => { if (s.maintenance.on) { $("#maint").hidden = false; $("#maint").textContent = "🛠 Maintenance: " + (s.maintenance.message || "The platform is temporarily unavailable."); } }).catch(() => {});
api("GET", "/me").then(() => { if (!resetToken) location.replace("/dev/"); }).catch(() => {});

async function submit(e, errId, fn) {
  e.preventDefault(); $(errId).innerHTML = "";
  try { await busy(e.target.querySelector("button[type=submit]"), fn); }
  catch (err) { $(errId).innerHTML = errBox(err.message); }
}
$("#login").addEventListener("submit", e => submit(e, "#lErr", async () => {
  await api("POST", "/auth/login", { username: $("#lUser").value.trim(), password: $("#lPass").value });
  location.replace("/dev/");
}));
$("#register").addEventListener("submit", e => submit(e, "#rErr", async () => {
  await api("POST", "/auth/register", { username: $("#rUser").value.trim(), email: $("#rMail").value.trim(), password: $("#rPass").value });
  location.replace("/dev/");
}));
$("#forgot").addEventListener("submit", e => submit(e, "#fErr", async () => {
  const d = await api("POST", "/auth/forgot", { email: $("#fMail").value.trim() });
  $("#fErr").innerHTML = `<div class="note">${esc(d.message)}</div>`;
}));
$("#reset").addEventListener("submit", e => submit(e, "#nErr", async () => {
  await api("POST", "/auth/reset", { token: resetToken, password: $("#nPass").value });
  toast("Password updated. Please sign in."); history.replaceState(null, "", "/dev/login"); show("login");
}));

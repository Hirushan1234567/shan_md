const $ = selector => document.querySelector(selector);
let me = null;
const toast = message => {
  const node = $("#toast");
  node.textContent = message;
  node.style.display = "block";
  setTimeout(() => node.style.display = "none", 3000);
};
async function req(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
function card(api) {
  return '<article class="api-card"><small>' + esc(api.plan || "API").toUpperCase() +
    '</small><h3>' + esc(api.name) + '</h3><p>' + esc(api.description || "") +
    '</p><small>/api/gateway/' + esc(api.slug) + '</small></article>';
}
async function load() {
  try {
    const data = await req("/api/catalog");
    const html = (data.apis || []).map(card).join("") || '<p class="muted">No APIs registered yet.</p>';
    $("#publicCatalog").innerHTML = html;
    $("#catalog").innerHTML = html;
  } catch (error) { toast(error.message); }
}
async function keys() {
  const data = await req("/api/keys");
  $("#keysList").innerHTML = (data.keys || []).map(key =>
    '<div class="api-card"><b>' + esc(key.label) + '</b><p>Plan: ' + esc(key.plan) +
    ' · Used: ' + key.used + ' / ' + (key.plan === "free" ? 50 : "∞") +
    '</p><small>' + esc(key.prefix) + '••••••••</small></div>'
  ).join("") || '<p class="muted">No keys yet.</p>';
}
async function session() {
  try {
    const data = await req("/api/me");
    me = data.user;
    $("#workspace").classList.remove("hidden");
    $("#welcome").textContent = "Welcome, " + me.name;
    $("#role").textContent = me.isAdmin ? "Admin" : "Developer";
    $("#adminTab").classList.toggle("hidden", !me.isAdmin);
    $("#loginArea").classList.add("hidden");
    $("#logoutBtn").classList.remove("hidden");
    $("#plan").textContent = me.plan || "Free";
    $("#keyCount").textContent = me.keyCount || 0;
    $("#used").textContent = me.used || 0;
    await keys();
  } catch {
    $("#loginArea").classList.remove("hidden");
    $("#workspace").classList.add("hidden");
    $("#logoutBtn").classList.add("hidden");
  }
}
function showAuth(mode) {
  const register = mode === "register";
  $("#authTitle").textContent = register ? "Create your account" : "Welcome back";
  $("#authSubmit").textContent = register ? "Create account" : "Login";
  $("#nameField").classList.toggle("hidden", !register);
  $("#authSwitch").textContent = register ? "Already have an account? Login" : "New here? Create an account";
  $("#authForm").dataset.mode = mode;
  $("#authPassword").autocomplete = register ? "new-password" : "current-password";
}
$("#authSwitch").onclick = () => showAuth($("#authForm").dataset.mode === "register" ? "login" : "register");
$("#authForm").onsubmit = async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const mode = event.currentTarget.dataset.mode || "login";
  const payload = {
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password")
  };
  try {
    await req("/api/auth/" + (mode === "register" ? "register" : "login"), {
      method: "POST", body: JSON.stringify(payload)
    });
    toast(mode === "register" ? "Account created" : "Login successful");
    await session();
  } catch (error) { toast(error.message); }
};
$("#logoutBtn").onclick = async () => {
  await req("/api/auth/logout", { method: "POST" });
  location.reload();
};
document.querySelectorAll(".tab").forEach(button => button.onclick = () => {
  document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".tabpage").forEach(item => item.classList.add("hidden"));
  button.classList.add("active");
  $("#" + button.dataset.tab).classList.remove("hidden");
});
$("#newKey").onclick = async () => {
  try {
    const data = await req("/api/keys", { method: "POST", body: "{}" });
    const box = document.createElement("div");
    box.className = "api-card";
    box.innerHTML = "<b>New API key — copy it now</b><p></p>";
    box.querySelector("p").textContent = data.key;
    $("#keysList").prepend(box);
    toast("Copy your key now; it is shown once.");
    await session();
  } catch (error) { toast(error.message); }
};
$("#apiForm").onsubmit = async event => {
  event.preventDefault();
  try {
    await req("/api/admin/apis", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
    });
    toast("API registered");
    event.currentTarget.reset();
    load();
  } catch (error) { toast(error.message); }
};
$("#year").textContent = new Date().getFullYear();
showAuth("login");
load();
session();

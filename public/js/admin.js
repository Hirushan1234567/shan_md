import { $, api, esc, toast, session } from "./api.js";

const show = (el, on) => { el.hidden = !on; };

async function load() {
  try {
    const st = await api("GET", "/admin/stats");
    show($("admLogin"), false); show($("admPanel"), true);
    $("admStats").innerHTML = [["Users", st.users], ["Coins in wallets", st.coins], ["Plugins sold", st.sold], ["Comments", st.comments]]
      .map(x => `<div class="card" style="margin:0;text-align:center"><small class="muted">${x[0]}</small><b style="display:block;font-size:20px">${esc(x[1])}</b></div>`).join("");
const u = await api("GET", "/admin/users");
    $("admUsers").innerHTML = u.length ? u.map(x => `<div class="row"><span>${esc(x.name)}<small>+${esc(x.number)} · ${esc(x.coins)} 🪙${x.banned ? " · BANNED" : ""}</small></span>
      <span><button class="pill on" data-adm="coins" data-n="${esc(x.number)}" type="button">Coins</button>
      <button class="pill off" data-adm="ban" data-n="${esc(x.number)}" data-ban="${x.banned ? 0 : 1}" type="button">${x.banned ? "Unban" : "Ban"}</button></span></div>`).join("") : `<p class="muted">No users yet.</p>`;
    const sessions = await api("GET", "/admin/sessions");
    $("admSessions").innerHTML = sessions.length ? sessions.map(x => `
      <div class="row">
        <span>+${esc(x.number)}
          <small>${esc(x.status)} · ${x.active ? "ACTIVE" : "INACTIVE"}</small>
          <small>Updated: ${x.updatedAt ? esc(new Date(x.updatedAt).toLocaleString()) : "Unknown"}</small>
        </span>
        <span class="pill ${x.status === "ready" ? "on" : "off"}">${x.status === "ready" ? "LINKED" : "WAITING"}</span>
      </div>
    `).join("") : `<p class="muted">No linked sessions yet.</p>`;

    await loadApis();
    const c = await api("GET", "/comments");
    $("admCms").innerHTML = c.length ? c.map(x => `<div class="cm"><b>${esc(x.name)}</b><br>${esc(x.msg)}
      <button class="btn danger sm" data-adm="delcm" data-id="${esc(x.id)}" type="button" style="margin-top:8px">Delete</button></div>`).join("") : `<p class="muted">No comments.</p>`;
  } catch (e) {
    toast(e.message, true);
    session.admin = "";
    show($("admLogin"), true); show($("admPanel"), false);
  }
}

function resetApiForm() {
  ["apiId","apiName","apiCategory","apiUrl","apiDescription"].forEach(id => $(id).value = "");
  $("apiMethod").value = "GET"; $("apiPlan").value = "free"; $("apiActive").checked = true;
  $("apiSave").textContent = "Add API"; show($("apiCancel"), false);
}

async function loadApis() {
  const list = await api("GET", "/admin/apis");
  $("admApis").innerHTML = list.length ? list.map(a => `
    <div class="card" style="margin:10px 0;padding:12px">
      <div class="row" style="padding-top:0"><b>${esc(a.name)}</b><span class="pill ${a.active ? "on" : "off"}">${a.active ? "ACTIVE" : "DISABLED"}</span></div>
      <small class="muted">${esc(a.category)} · ${esc(a.method)} · ${esc(a.plan).toUpperCase()}</small>
      <code style="display:block;overflow-wrap:anywhere;margin:7px 0">${esc(a.url)}</code>
      <p class="muted" style="font-size:12px">${esc(a.description || "")}</p>
      <div class="row-btns" style="margin-top:8px">
        <button class="btn ghost sm" data-adm="api-edit" data-id="${esc(a.id)}" type="button">Edit</button>
        <button class="btn danger sm" data-adm="api-delete" data-id="${esc(a.id)}" type="button">Delete</button>
      </div>
    </div>`).join("") : `<p class="muted">No APIs added yet.</p>`;
}

export function openAdmin() { $("admModal").classList.add("show"); if (session.admin) load(); }

export function initAdmin() {
  $("admClose").onclick = () => $("admModal").classList.remove("show");
  $("admGo").onclick = async () => {
    try {
      const d = await api("POST", "/admin/login", {
        password: $("admPass").value
      });
      session.admin = d.token; $("admPass").value = ""; load();
    } catch (e) { toast(e.message, true); }
  };
  $("admModal").addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    const k = b.dataset.adm;
    try {
      if (k === "api-save") {
        const id = $("apiId").value;
        const payload = {
          name: $("apiName").value.trim(),
          category: $("apiCategory").value.trim(),
          url: $("apiUrl").value.trim(),
          method: $("apiMethod").value,
          plan: $("apiPlan").value,
          description: $("apiDescription").value.trim(),
          active: $("apiActive").checked
        };
        if (id) { payload.id = id; await api("PUT", "/admin/apis", payload); toast("API updated"); }
        else { await api("POST", "/admin/apis", payload); toast("API added"); }
        resetApiForm(); await loadApis();
      }
      if (k === "api-cancel") { resetApiForm(); }
      if (k === "api-edit") {
        const a = await api("GET", "/admin/apis");
        const item = a.find(x => x.id === b.dataset.id);
        if (!item) throw new Error("API entry not found.");
        $("apiId").value = item.id; $("apiName").value = item.name; $("apiCategory").value = item.category;
        $("apiUrl").value = item.url; $("apiMethod").value = item.method; $("apiPlan").value = item.plan;
        $("apiDescription").value = item.description || ""; $("apiActive").checked = !!item.active;
        $("apiSave").textContent = "Save changes"; show($("apiCancel"), true);
        $("apiName").focus();
      }
      if (k === "api-delete") {
        if (!confirm("Delete this API directory entry?")) return;
        await api("DELETE", "/admin/apis?id=" + encodeURIComponent(b.dataset.id));
        toast("API deleted"); await loadApis();
      }
      if (k === "ann") { await api("POST", "/admin/announce", { text: $("admAnn").value.trim() }); toast("Announcement updated"); }
      if (k === "coupon") {
        await api("POST", "/admin/coupons", { code: $("cpCode").value.trim(), coins: +$("cpCoins").value, uses: +$("cpUses").value });
        toast("Coupon created"); $("cpCode").value = "";
      }
      if (k === "coins") {
        const a = prompt("Coins to add (negative to remove):");
        if (a === null || isNaN(+a) || +a === 0) return;
        await api("POST", "/admin/coins", { number: b.dataset.n, amount: +a }); toast("Done"); load();
      }
      if (k === "ban") { await api("POST", "/admin/ban", { number: b.dataset.n, ban: b.dataset.ban === "1" }); load(); }
      if (k === "delcm") { if (!confirm("Delete this comment?")) return; await api("DELETE", "/comments?id=" + encodeURIComponent(b.dataset.id)); load(); }
    } catch (err) { toast(err.message, true); }
  });

  $("adminOpen").addEventListener("click", openAdmin);
}

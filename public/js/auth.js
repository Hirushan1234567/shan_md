import { $, api, toast, session, streamPost } from "./api.js";

let controller = null;
let pairing = false;

const show = (el, on) => { el.hidden = !on; };
const err = (id, msg) => {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  show(el, !!msg);
};

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.dataset.label ??= btn.textContent;
  btn.innerHTML = busy ? `<span class="spin"></span> ${label}` : btn.dataset.label;
}

export function initAuth(onLogin) {
  $("stepNum").addEventListener("submit", async e => {
    e.preventDefault();
    if (pairing) return;

    err("aErr", "");

    const number = $("aNum").value.replace(/\D/g, "");
    const name = $("aName").value.trim();
    const ref = $("aRef").value.trim().toUpperCase();

    if (!/^[1-9]\d{7,14}$/.test(number)) {
      return err("aErr", "රටේ කේතය සමඟ නිවැරදි WhatsApp අංකය ඇතුළත් කරන්න.");
    }

    pairing = true;
    controller = new AbortController();

    const btn = $("sendBtn");
    setBusy(btn, true, "Connecting WhatsApp...");

    $("pairCode").textContent = "Pairing code එක බලාපොරොත්තු වන්න...";
    $("pairStatus").textContent = "WhatsApp සම්බන්ධ වෙමින්...";
    show($("pairBox"), true);

    let redeemPromise = null;

    try {
      await streamPost("/api/pair", {
        number,
        purpose: "dashboard-login"
      }, {
        signal: controller.signal,
        onEvent: event => {
          if (event.type === "code") {
            $("pairCode").textContent = event.code;
            $("pairStatus").textContent = "WhatsApp → Linked Devices → Link a Device වෙත ගොස් Code එක ඇතුළත් කරන්න.";
          }

          if (event.type === "status") {
            $("pairStatus").textContent = ({
              linking: "WhatsApp සම්බන්ධ කරමින්...",
              linked: "WhatsApp සම්බන්ධ වුණා. Login සකස් කරමින්...",
              active: "සම්බන්ධයි."
            })[event.status] || event.status;
          }

          if (event.type === "error") {
            err("aErr", event.reason === "expired"
              ? "Pairing code එක කල් ඉකුත් වුණා. නැවත උත්සාහ කරන්න."
              : "WhatsApp සම්බන්ධ කිරීම අසාර්ථකයි. නැවත උත්සාහ කරන්න.");
          }

          if (event.type === "login_claim" && !redeemPromise) {
            redeemPromise = (async () => {
              const d = await api("POST", "/auth/pair-claim", {
                claim: event.claim,
                name,
                ref
              });

              session.token = d.token;
              $("pairStatus").textContent = "Login සාර්ථකයි!";
              toast("Welcome, " + d.user.name);
              controller?.abort();
              onLogin(d.user);
            })();

            redeemPromise.catch(error => {
              err("aErr", error.message || "Login verification failed.");
              $("pairStatus").textContent = "Login අසාර්ථකයි.";
              controller?.abort();
            });
          }
        }
      });

      if (redeemPromise) await redeemPromise;
    } catch (error) {
      if (error.name !== "AbortError") {
        err("aErr", error.message || "Pairing අසාර්ථකයි.");
      }
    } finally {
      pairing = false;
      controller = null;
      setBusy(btn, false);
    }
  });

  $("aNum").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });
}

export function resetGate() {
  controller?.abort();
  pairing = false;
  if ($("pairCode")) $("pairCode").textContent = "";
  if ($("pairStatus")) $("pairStatus").textContent = "";
  if ($("pairBox")) show($("pairBox"), false);
  err("aErr", "");
}

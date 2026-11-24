// U2 dev: "Dry dock" banner. When the owner puts the apps in read-only maintenance (GET /v1/config → maintenance +
// maintenanceMessage), show the message at the bottom; checked every minute. Tap to hide. Pauses (uploads/calls) come
// back as normal errors from the Worker.
import { API_URL } from "../config.js";

let hiddenFor = null;
function render(cfg) {
  let el = document.getElementById("u2-drydock");
  if (!cfg?.maintenance || hiddenFor === (cfg.maintenanceMessage || "")) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "u2-drydock";
    el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(520px,calc(100vw - 32px));z-index:9999;" +
      "background:#2b3a55;color:#fff;border-radius:14px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.3);font:13px/1.4 system-ui,sans-serif;cursor:pointer";
    el.onclick = () => { hiddenFor = el.dataset.msg; el.remove(); };
    document.body.append(el);
  }
  el.dataset.msg = cfg.maintenanceMessage || "";
  el.replaceChildren();
  const b = document.createElement("b"); b.textContent = "⚓ Dry dock — read-only for now";
  const p = document.createElement("div"); p.textContent = cfg.maintenanceMessage || "Sonar is getting an upgrade. You can look around, but sending is paused. Back soon!";
  el.append(b, p);
}
async function check() {
  try { const r = await fetch(API_URL + "/v1/config"); if (r.ok) render(await r.json()); } catch { /* offline */ }
}
check();
setInterval(() => { if (!document.hidden) check(); }, 60_000);

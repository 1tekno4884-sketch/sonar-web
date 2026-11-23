// Browser notifications (while the tab is open), unread count in the title + a favicon badge, and an original
// synthesised ringtone (WebAudio — no audio files).
import { getS } from "./settings.js";

const LKEY = "sonar_notify";
let prefs = { messages: true, calls: true, sound: true };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(LKEY) || "{}") }; } catch {}
export const notifyPrefs = () => prefs;
export function setNotifyPref(k, v) { prefs[k] = v; try { localStorage.setItem(LKEY, JSON.stringify(prefs)); } catch {} }

export const canNotify = () => "Notification" in window;
export const permission = () => (canNotify() ? Notification.permission : "denied");
/** Must be called from a click (user gesture). */
export async function askPermission() {
  if (!canNotify()) return "denied";
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** kind: "message" | "call". Respects this browser's toggles and the synced "pause all". */
export function notify(title, body, { tag, kind = "message", onclick, icon = "icons/icon-192.png", requireInteraction = false } = {}) {
  if (!canNotify() || Notification.permission !== "granted") return null;
  if (kind === "message" && !prefs.messages) return null;
  if (kind === "call" && !prefs.calls) return null;
  if (getS("notifications.pauseAll")) return null;
  try {
    const n = new Notification(title, { body, tag, icon, badge: icon, requireInteraction, silent: kind === "message" ? !prefs.sound : false });
    n.onclick = () => { window.focus(); onclick?.(); n.close(); };
    return n;
  } catch { return null; }
}

// ------------------------------------------------------------------ title + favicon badge
let baseIcon = null, lastCount = -1;
export function setUnread(count) {
  count = Math.max(0, count | 0);
  document.title = (count ? `(${count > 99 ? "99+" : count}) ` : "") + "Sonar";
  if (count === lastCount) return;
  lastCount = count;
  const link = document.querySelector('link[rel="icon"][sizes="64x64"]') || document.querySelector('link[rel="icon"]');
  const draw = () => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    if (baseIcon) g.drawImage(baseIcon, 0, 0, 64, 64);
    if (count) {
      const label = count > 9 ? "9+" : String(count);
      g.fillStyle = "#FF4D4F"; g.beginPath(); g.arc(46, 18, 17, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.strokeStyle = "#ffffff"; g.stroke();
      g.fillStyle = "#fff"; g.font = "bold 22px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(label, 46, 19);
    }
    try { link.href = c.toDataURL("image/png"); link.type = "image/png"; } catch {}
  };
  if (baseIcon) draw();
  else { const img = new Image(); img.onload = () => { baseIcon = img; draw(); }; img.onerror = draw; img.src = "icons/icon-192.png"; }
}

// ------------------------------------------------------------------ sounds (original, synthesised)
let ctx = null;
function audio() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
/** Unlocks audio on the first user gesture (browsers block sound until then). */
export function primeAudio() { audio(); }
addEventListener("pointerdown", primeAudio, { once: true, capture: true });
addEventListener("keydown", primeAudio, { once: true, capture: true });

function tone(a, freq, t0, len, vol = 0.18, type = "sine", glideTo) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + len);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + len + 0.05);
}
/** A soft "sonar ping" for new messages. */
export function pingSound() {
  if (!prefs.sound) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime + 0.01;
  tone(a, 1320, t, 0.35, 0.12, "sine", 1180);
  tone(a, 1980, t + 0.12, 0.45, 0.05, "sine", 1760);
}
let ringTimer = null;
/** Incoming-call ringtone: two pings and an echo, repeating. Returns a stop function. */
export function startRingtone() {
  stopRingtone();
  const a = audio(); if (!a) return stopRingtone;
  const once = () => {
    const t = a.currentTime + 0.02;
    tone(a, 880, t, 0.5, 0.22, "sine", 860); tone(a, 1760, t, 0.4, 0.05, "triangle");
    tone(a, 1175, t + 0.28, 0.55, 0.2, "sine", 1150);
    tone(a, 1175, t + 0.75, 0.9, 0.06, "sine", 1100);   // echo
  };
  once();
  ringTimer = setInterval(once, 2200);
  return stopRingtone;
}
export function stopRingtone() { clearInterval(ringTimer); ringTimer = null; }
/** Outgoing "calling…" tone (quieter, slower). */
export function startDialtone() {
  stopRingtone();
  const a = audio(); if (!a) return stopRingtone;
  const once = () => { const t = a.currentTime + 0.02; tone(a, 660, t, 0.9, 0.06, "sine"); tone(a, 990, t, 0.9, 0.03, "sine"); };
  once(); ringTimer = setInterval(once, 3000);
  return stopRingtone;
}

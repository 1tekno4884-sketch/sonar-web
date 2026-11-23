// The Live line: one WebSocket to the person's Line Durable Object (`/v1/line?t=…&dev=web`).
// Events: msg · ring · signal · joined · left · updated · declined · ended · answered_elsewhere (docs/SONAR_API.md).
// Keepalive "ping" every 4.5 min (answered by the runtime for free); reconnect with backoff and on network changes.
import { API, token } from "./api.js";
import { emit, state } from "./state.js";

let ws = null, wantOpen = false, attempt = 0, retryTimer = null, pingTimer = null;
const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const handlers = new Map();

/** Subscribe to one event type ("*" = everything). Returns an unsubscribe function. */
export function onLine(t, fn) {
  if (!handlers.has(t)) handlers.set(t, new Set());
  handlers.get(t).add(fn);
  return () => handlers.get(t)?.delete(fn);
}
function dispatch(ev) {
  handlers.get(ev.t)?.forEach((f) => { try { f(ev); } catch (e) { console.error(e); } });
  handlers.get("*")?.forEach((f) => { try { f(ev); } catch (e) { console.error(e); } });
}
function setUp(on) { if (state.lineUp !== on) { state.lineUp = on; emit("line", on); } }

export function connectLine() {
  wantOpen = true;
  if (!token || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  clearTimeout(retryTimer);
  const url = API.replace(/^http/, "ws") + `/v1/line?t=${encodeURIComponent(token)}&dev=web`;
  let sock;
  try { sock = new WebSocket(url); } catch { return schedule(); }
  ws = sock;
  sock.onopen = () => {
    attempt = 0; setUp(true);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { try { sock.readyState === WebSocket.OPEN && sock.send("ping"); } catch {} }, 270_000);
  };
  sock.onmessage = (e) => {
    if (typeof e.data !== "string" || e.data === "pong") return;
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev && typeof ev.t === "string") dispatch(ev);
  };
  sock.onclose = () => { if (ws === sock) { ws = null; setUp(false); clearInterval(pingTimer); schedule(); } };
  sock.onerror = () => { try { sock.close(); } catch {} };
}
function schedule() {
  if (!wantOpen) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connectLine, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
}
export function disconnectLine() {
  wantOpen = false; clearTimeout(retryTimer); clearInterval(pingTimer);
  const s = ws; ws = null; setUp(false);
  try { s?.close(1000, "bye"); } catch {}
}
/** Network came back / tab woke up: reconnect straight away. */
function kick() { if (!wantOpen) return; if (!ws || ws.readyState > 1) { attempt = 0; connectLine(); } }
addEventListener("online", kick);
document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });

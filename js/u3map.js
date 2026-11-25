// U3-social: Tide Map on the web — the friend map, your own sharing settings, and "share live while this tab is open".
// The SAME file ships in Sonar web (web/js/u3map.js) and Ripple web (web/u3map.js): keep the two copies identical.
// Each app calls initU3({...}) once with its own API client, then mounts the page with mountTideMap().
//
// Routes (Ripple Worker): GET /v1/u3/map/friends (falls back to GET /v1/map/friends on an older Worker),
// GET/PUT /v1/map/me (sharing, audience, allow, submerge), POST /v1/u3/map/live, POST /v1/u3/map/position {…, app:"web"}.
// Map: MapLibre GL JS from unpkg (pinned + SRI), loaded only when a map is shown; tiles + styles from OpenFreeMap (free,
// no key). Browsers can't share location in the background, so sharing from a tab stops when it's closed or hidden.

const ML_VER = "4.7.1";
const ML_JS = `https://unpkg.com/maplibre-gl@${ML_VER}/dist/maplibre-gl.js`;
const ML_JS_SRI = "sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj";
const ML_CSS = `https://unpkg.com/maplibre-gl@${ML_VER}/dist/maplibre-gl.css`;
const ML_CSS_SRI = "sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V";
const OFM = "https://tiles.openfreemap.org/styles/";   // "liberty" (light) and "dark"
/** A tab that stays in the background this long stops sharing (browsers pause background pages anyway). */
const HIDDEN_LIMIT = 120_000;
const LIVE_CHOICES = [[15, "15 min"], [60, "1 hour"], [240, "4 hours"], [480, "8 hours"]];

const C = {
  api: null,               // (path, {method, body}) → Promise<json>; errors carry .status
  apiBase: "",             // for keepalive requests when the tab closes
  token: () => null,
  myId: () => null,
  avatarUrl: () => null,   // public avatar key → URL (or null)
  profileHref: (u) => `#/u/${encodeURIComponent(u?.username || "")}`,
  betaId: "sonar.tide_map",
  mapHref: "#/map",
  toast: (m) => console.log(m),
};
export function initU3(opts) { Object.assign(C, opts); geoPillWatch(); }

// ------------------------------------------------------------------ tiny helpers (text only → no HTML injection)
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const enc = encodeURIComponent;
const itemsOf = (j) => (Array.isArray(j) ? j : j?.items ?? []);
const nameOf = (u) => u?.name || u?.displayName || u?.username || "Someone";
export const reduced = () => document.documentElement.classList.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
export function clockText(ms) {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}
export function agoText(ms, now = Date.now()) {
  const d = Math.max(0, now - Number(ms || 0));
  if (!ms) return "a while ago";
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(ms).toLocaleDateString();
}
export function leftText(until, now = Date.now()) {
  const m = Math.max(0, Math.ceil((until - now) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ""}left` : `${m} min left`;
}
export function distM(a, b) {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
const MILES = /-(US|GB|LR|MM)$/i.test(navigator.language || "");
export function distText(m) {
  if (MILES) { const mi = m / 1609.344; return mi < 0.1 ? `${Math.round(m * 3.281 / 10) * 10} ft away` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi away`; }
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m away` : `${m < 10_000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)} km away`;
}
export function faceEl(u, cls = "u3m-av") {
  const url = C.avatarUrl(u?.avatar);
  const el = h("span", { class: cls, "aria-hidden": "true" });
  if (url) { const img = h("img", { src: url, alt: "", loading: "lazy" }); img.onerror = () => img.replaceWith(String(nameOf(u)).trim().slice(0, 1).toUpperCase() || "?"); el.append(img); }
  else el.append(String(nameOf(u)).trim().slice(0, 1).toUpperCase() || "?");
  return el;
}
const MAP_PATH = "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20";
export function mapIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "ic");
  s.setAttribute("width", "22"); s.setAttribute("height", "22");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", MAP_PATH); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.9"); p.setAttribute("stroke-linejoin", "round"); p.setAttribute("stroke-linecap", "round");
  s.append(p); return s;
}

// ------------------------------------------------------------------ betas (GET /v1/beta → enabled)
let betaCache = null, betaAt = 0, betaTok = null, betaP = null;
export function betaList(fresh = false) {
  const tok = C.token();
  if (!tok || !C.api) return Promise.resolve([]);
  if (!fresh && betaCache && betaTok === tok && Date.now() - betaAt < 120_000) return Promise.resolve(betaCache);
  if (betaP) return betaP;
  betaP = C.api("/v1/beta").then((j) => { betaCache = Array.isArray(j?.enabled) ? j.enabled : []; betaAt = Date.now(); betaTok = tok; return betaCache; })
    .catch(() => (betaTok === tok && betaCache) || []).finally(() => { betaP = null; });
  return betaP;
}
export const betaOn = async (id) => (await betaList()).includes(id);
/** Synchronous check against the last answer (menus); call betaList() early so it's warm. */
export const betaOnNow = (id) => !!(betaCache && betaTok === C.token() && betaCache.includes(id));

// ------------------------------------------------------------------ sharing my position from this tab
// Holders: "map-live" (Tide Map live), "lantern:<chatId>" (Sonar Lantern). One watchPosition serves all of them; the
// Worker's `next` says how often to send (0 = nobody can see you → stop).
export const geo = { holders: new Map(), watchId: null, pos: null, lastSent: 0, next: 5, timer: null, hiddenTimer: null, error: "", stoppedWhy: "", subs: new Set() };
let sending = false, posV3 = true;
const geoEmit = () => geo.subs.forEach((f) => { try { f(geo); } catch (e) { console.error(e); } });
export function geoSupport() {
  if (!("geolocation" in navigator)) return "This browser can't share your location.";
  if (!window.isSecureContext) return "Location only works on a secure (https) page.";
  return "";
}
export function geoErrText(e) {
  if (e?.code === 1) return "Location is blocked for this site. Allow it in your browser's site settings, then try again.";
  if (e?.code === 2) return "Your location isn't available right now.";
  if (e?.code === 3) return "Finding your location took too long — try again.";
  return e?.message || "Couldn't get your location.";
}
const toPos = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 0,
  hdg: Number.isFinite(p.coords.heading) ? p.coords.heading : null, spd: Number.isFinite(p.coords.speed) ? p.coords.speed : null, at: Date.now() });
/** One position (asks for permission the first time). */
export function locateOnce() {
  return new Promise((res, rej) => {
    const s = geoSupport(); if (s) { rej(new Error(s)); return; }
    navigator.geolocation.getCurrentPosition((p) => { geo.pos = toPos(p); geoEmit(); res(geo.pos); }, (e) => rej(new Error(geoErrText(e))), { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 });
  });
}
let battMgr = null;
async function battery() {
  try { battMgr = battMgr || (navigator.getBattery ? await navigator.getBattery() : null); return battMgr ? Math.round(battMgr.level * 100) : null; } catch { return null; }
}
/** Start (or join) sharing from this tab. hooks: {onEnd(why), onUnload(), check(positionAnswer) → stop reason | ""} */
export async function geoStart(key, hooks = {}) {
  const s = geoSupport(); if (s) throw new Error(s);
  if (!geo.pos || Date.now() - geo.pos.at > 30_000) await locateOnce();
  geo.holders.set(key, hooks);
  geo.stoppedWhy = ""; geo.error = "";
  if (geo.watchId == null) {
    geo.watchId = navigator.geolocation.watchPosition((p) => {
      geo.pos = toPos(p); geo.error = "";
      if (Date.now() - geo.lastSent >= geo.next * 1000) sendNow(); else geoEmit();
    }, (e) => { if (e.code === 1) geoStopAll(geoErrText(e)); else { geo.error = geoErrText(e); geoEmit(); } },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 60_000 });
  }
  geo.next = 5;
  await sendNow();
  geoEmit();
}
export function geoStop(key, why = "") {
  const hk = geo.holders.get(key); if (!hk) return;
  geo.holders.delete(key);
  try { hk.onEnd?.(why); } catch (e) { console.error(e); }
  if (!geo.holders.size) {
    if (geo.watchId != null) { try { navigator.geolocation.clearWatch(geo.watchId); } catch {} }
    geo.watchId = null; clearTimeout(geo.timer); clearTimeout(geo.hiddenTimer); geo.stoppedWhy = why;
  }
  geoEmit();
}
export function geoStopAll(why = "") { for (const k of [...geo.holders.keys()]) geoStop(k, why); }
export const geoHas = (key) => geo.holders.has(key);
async function sendNow() {
  if (!geo.holders.size || !geo.pos || sending) return;
  sending = true; clearTimeout(geo.timer);
  const p = geo.pos;
  const body = { lat: p.lat, lng: p.lng, acc: Math.round(p.acc || 0), app: "web" };
  if (p.hdg != null) body.hdg = Math.round(p.hdg) % 360;
  if (p.spd != null) body.spd = Math.round(p.spd * 10) / 10;
  const b = await battery(); if (b != null) body.batt = b;
  let stop = "";
  try {
    let r = null;
    if (posV3) { try { r = await C.api("/v1/u3/map/position", { method: "POST", body }); } catch (e) { if (e.status === 404) posV3 = false; else throw e; } }
    if (!posV3) { r = await C.api("/v1/map/position", { method: "POST", body: { lat: body.lat, lng: body.lng, acc: body.acc } }); r = { ...r, next: r.stored === false ? 0 : 60 }; }
    geo.lastSent = Date.now(); geo.error = "";
    geo.next = Number.isFinite(Number(r?.next)) ? Number(r.next) : 5;
    if (geo.next <= 0) stop = r?.reason === "submerged" ? "You're submerged, so nobody can see you — this tab stopped sharing." : "Nobody can see your location right now (sharing is off) — this tab stopped sharing.";
    else for (const [k, hk] of [...geo.holders]) { const why = hk.check?.(r); if (why) geoStop(k, why); }   // e.g. live time is up
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) stop = e.message || "Signed out — this tab stopped sharing.";
    else { geo.error = (e?.message || "Couldn't send your location") + " — retrying."; geo.next = Math.max(geo.next, 15); }
  }
  sending = false;
  if (stop) { geoStopAll(stop); return; }
  if (geo.holders.size) geo.timer = setTimeout(sendNow, Math.max(4, geo.next) * 1000);
  geoEmit();
}
document.addEventListener("visibilitychange", () => {
  clearTimeout(geo.hiddenTimer);
  if (document.hidden) { if (geo.holders.size) geo.hiddenTimer = setTimeout(() => geoStopAll("Stopped because this tab was in the background for 2 minutes — browsers can't share your location in the background."), HIDDEN_LIMIT); }
  else if (geo.holders.size && Date.now() - geo.lastSent > geo.next * 1000) sendNow();
});
addEventListener("pagehide", (e) => { if (e.persisted) return; for (const hk of geo.holders.values()) { try { hk.onUnload?.(); } catch {} } });
/** Fire-and-forget request that survives the tab closing (ends live mode / a Lantern when the page goes away). */
export function keepalive(path, method = "POST", body) {
  try {
    const headers = { authorization: "Bearer " + (C.token() || "") };
    if (body !== undefined) headers["content-type"] = "application/json";
    fetch(C.apiBase + path, { method, headers, keepalive: true, body: body !== undefined ? JSON.stringify(body) : undefined }).catch(() => {});
  } catch {}
}

/** Small floating note while this tab shares and the map page isn't open (so it's never a surprise). */
let pill = null, pillWatching = false;
function geoPillWatch() {
  if (pillWatching) return; pillWatching = true;
  const paint = () => {
    const show = geo.holders.size > 0 && !document.querySelector(".u3m");
    if (!show) { pill?.remove(); pill = null; return; }
    if (!pill) { injectCss(); pill = h("div", { class: "u3m-pill", role: "status" }); document.body.append(pill); }
    const lan = [...geo.holders.keys()].some((k) => k.startsWith("lantern:"));
    pill.replaceChildren(h("span", { class: "dot", "aria-hidden": "true" }),
      h("a", { href: C.mapHref }, lan && !geo.holders.has("map-live") ? "Sharing your live location in a chat from this tab" : "Sharing your live location from this tab"),
      h("button", { type: "button", class: "small tonal", onclick: () => geoStopAll("") }, "Stop"));
  };
  geo.subs.add(paint);
  addEventListener("hashchange", () => setTimeout(paint, 0));
}

// ------------------------------------------------------------------ MapLibre (lazy) + OpenFreeMap
let mlP = null;
export function loadMapLib() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mlP) return mlP;
  mlP = new Promise((res, rej) => {
    if (!document.querySelector("link[data-u3-ml]")) document.head.append(h("link", { rel: "stylesheet", href: ML_CSS, integrity: ML_CSS_SRI, crossorigin: "anonymous", "data-u3-ml": "" }));
    const s = h("script", { src: ML_JS, integrity: ML_JS_SRI, crossorigin: "anonymous" });
    s.async = true;
    s.onload = () => (window.maplibregl ? res(window.maplibregl) : rej(new Error("The map didn't load.")));
    s.onerror = () => { mlP = null; s.remove(); rej(new Error("Couldn't load the map (offline or blocked).")); };
    document.head.append(s);
  });
  return mlP;
}
function isDark() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  let r, g, b, m;
  if ((m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) { const x = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); }
  else if ((m = v.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i))) [r, g, b] = [m[1], m[2], m[3]].map(Number);
  else return matchMedia("(prefers-color-scheme: dark)").matches;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
export function attribEl() {
  return h("div", { class: "u3m-attr" }, "© ", h("a", { href: "https://openfreemap.org", target: "_blank", rel: "noopener" }, "OpenFreeMap"), " © ",
    h("a", { href: "https://www.openmaptiles.org/", target: "_blank", rel: "noopener" }, "OpenMapTiles"), " © ",
    h("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" }, "OpenStreetMap contributors"));
}
/** A MapLibre map in `container` (light/dark OpenFreeMap style to match the app). Throws if WebGL is missing. */
export async function makeMap(container, { center = [0, 20], zoom = 1.3 } = {}) {
  const ml = await loadMapLib();
  const map = new ml.Map({ container, style: OFM + (isDark() ? "dark" : "liberty"), center, zoom, attributionControl: false, dragRotate: false,
    pitchWithRotate: false, fadeDuration: reduced() ? 0 : 300, cooperativeGestures: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
  container.append(attribEl());
  return { ml, map };
}
export function pinEl(u, { live = false, hdg = null } = {}) {
  const el = h("div", { class: "u3m-pin" + (live ? " live" : ""), role: "button", tabindex: "0", "aria-label": nameOf(u) + (live ? ", live" : "") },
    h("i", { class: "ring", "aria-hidden": "true" }), faceEl(u, "face"));
  if (live && Number.isFinite(hdg)) el.append(h("i", { class: "hdg", "aria-hidden": "true", style: `transform:rotate(${Math.round(hdg)}deg)` }));
  return el;
}
export const meDot = () => h("div", { class: "u3m-me", role: "img", "aria-label": "You" });
export function flyTo(map, lngLat, zoom) {
  if (!map) return;
  const z = Math.max(map.getZoom(), zoom ?? 14);
  if (reduced()) map.jumpTo({ center: lngLat, zoom: z }); else map.flyTo({ center: lngLat, zoom: z, speed: 1.6 });
}
export function fitTo(map, ml, pts) {
  if (!map || !pts.length) return;
  if (pts.length === 1) { map.jumpTo({ center: pts[0], zoom: 13 }); return; }
  const b = new ml.LngLatBounds(pts[0], pts[0]); pts.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: 60, maxZoom: 14, animate: !reduced() });
}

// ------------------------------------------------------------------ styles (injected once; use each app's CSS variables)
let cssDone = false;
export function injectCss() {
  if (cssDone) return; cssDone = true;
  document.head.append(h("style", { "data-u3": "map" }, `
.u3m{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--text)}
.u3m.stack{height:auto}
.u3m-head{display:flex;align-items:center;gap:8px;padding:10px 12px;min-height:60px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--surface) 86%,transparent)}
.u3m.stack .u3m-head{padding:0 0 12px;border:0;background:none;min-height:0}
.u3m-head h1{font-size:1.3rem;margin:0;flex:1;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.u3m-head .back{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;color:var(--text);font-size:22px;text-decoration:none}
.u3m-head .back:hover{background:color-mix(in srgb,var(--text) 9%,transparent)}
.u3m-seg{display:flex;gap:2px;background:var(--surface2);border-radius:999px;padding:3px}
.u3m-seg button{background:transparent;color:var(--muted);padding:.3em .9em;font-size:.875rem}
.u3m-seg button[aria-pressed=true]{background:var(--vivid);color:var(--on-vivid,#fff)}
.u3m-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 360px;grid-template-rows:minmax(0,1fr)}
.u3m.stack .u3m-body{display:block}
.u3m-map{position:relative;min-height:260px;background:var(--surface2);overflow:hidden}
.u3m.stack .u3m-map{height:58vh;border-radius:var(--r,20px);border:1px solid var(--line);margin-bottom:14px}
.u3m-side{overflow-y:auto;border-left:1px solid var(--line);background:var(--surface);padding:12px 12px 24px}
.u3m.stack .u3m-side{border:0;background:none;padding:0;overflow:visible}
.u3m.split .u3m-seg,.u3m.stack .u3m-seg{display:none}
@media (max-width:760px){.u3m.split .u3m-seg{display:flex}.u3m.split .u3m-body{grid-template-columns:minmax(0,1fr)}
 .u3m.split[data-view=map] .u3m-side{display:none}.u3m.split[data-view=list] .u3m-map{display:none}.u3m.split .u3m-side{border-left:0}}
.u3m-attr{position:absolute;right:0;bottom:0;z-index:2;font-size:11px;line-height:1.5;padding:1px 7px;background:color-mix(in srgb,var(--surface) 82%,transparent);color:var(--muted);border-top-left-radius:8px;max-width:100%}
.u3m-attr a{color:inherit;text-decoration:underline}
.u3m-note{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:24px;color:var(--muted);z-index:1}
.u3m-card{position:absolute;left:10px;bottom:30px;z-index:3;width:min(360px,calc(100% - 20px));background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:16px;padding:10px 12px;box-shadow:0 6px 22px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center}
.u3m-card .grow{flex:1;min-width:0}
.u3m-card .x{background:transparent;color:var(--muted);padding:4px 8px;font-size:18px}
.u3m-pin{width:42px;height:42px;border-radius:50%;position:relative;cursor:pointer;display:grid;place-items:center;border:3px solid var(--surface);box-shadow:0 2px 8px rgba(0,0,0,.35);background:var(--surface)}
.u3m-pin .face{width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:linear-gradient(135deg,var(--deep,#0b2a5c),var(--vivid));color:#fff;font-weight:700}
.u3m-pin .face img,.u3m-av img{width:100%;height:100%;object-fit:cover;display:block}
.u3m-pin.live{border-color:var(--ok,#3ccf8e)}
.u3m-pin .ring{position:absolute;inset:-3px;border-radius:50%;pointer-events:none}
.u3m-pin.live .ring{animation:u3pulse 1.8s ease-out infinite}
@keyframes u3pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok,#3ccf8e) 65%,transparent)}100%{box-shadow:0 0 0 18px transparent}}
.u3m-pin .hdg{position:absolute;inset:-15px;pointer-events:none}
.u3m-pin .hdg::before{content:"";position:absolute;left:50%;top:0;transform:translateX(-50%);border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid var(--ok,#3ccf8e)}
.u3m-pin.sel{outline:3px solid var(--primary);outline-offset:3px}
.u3m-pin:focus-visible{outline:3px solid var(--primary);outline-offset:3px}
.u3m-me{width:18px;height:18px;border-radius:50%;background:#2f8cff;border:3px solid #fff;box-shadow:0 0 0 7px rgba(47,140,255,.25)}
@media (prefers-reduced-motion:reduce){.u3m-pin.live .ring{animation:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--ok,#3ccf8e) 45%,transparent)}}
:root.reduce-motion .u3m-pin.live .ring{animation:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--ok,#3ccf8e) 45%,transparent)}
.u3m-sec{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin:16px 4px 6px}
.u3m-sec:first-child{margin-top:4px}
.u3m-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:transparent;color:var(--text);padding:8px;border-radius:14px;font-weight:400}
.u3m-row:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
.u3m-row[aria-current=true]{background:color-mix(in srgb,var(--vivid) 18%,transparent)}
.u3m-row .grow{flex:1;min-width:0}
.u3m-row .nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.u3m-av{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,var(--deep,#0b2a5c),var(--vivid));color:#fff;font-weight:700;overflow:hidden}
.u3m-av.sm{width:28px;height:28px;font-size:.8rem}
.u3m-live{display:inline-flex;align-items:center;gap:5px;font-size:.75rem;font-weight:700;color:var(--ok,#1f9e66);white-space:nowrap}
.u3m-live::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.u3m-sub{color:var(--muted);font-size:.8125rem}
.u3m-box{background:var(--surface2);border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:10px}
.u3m.stack .u3m-box{background:var(--surface)}
.u3m-opts{display:flex;flex-wrap:wrap;gap:6px}
.u3m-opts button{background:var(--surface);color:var(--text);border:1px solid var(--line);font-size:.8125rem;padding:.3em .8em;font-weight:600}
.u3m-opts button[aria-pressed=true]{background:var(--vivid);color:var(--on-vivid,#fff);border-color:var(--vivid)}
.u3m-toggle{display:flex;align-items:flex-start;gap:10px;cursor:pointer}
.u3m-toggle input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--vivid)}
.u3m-warn{color:var(--muted);font-size:.8125rem;border-left:3px solid var(--warn,#ffc857);padding-left:8px}
.u3m-err{color:var(--danger,#ff8a80);font-size:.8125rem}
.u3m-picks{display:grid;gap:4px;max-height:260px;overflow:auto}
.u3m-picks label{display:flex;gap:8px;align-items:center;font-size:.875rem;cursor:pointer}
.u3m-picks input{width:auto}
.u3m-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.u3m-act select{width:auto;padding:.35em .6em;border-radius:12px}
.u3m button.small,.u3m-pill button.small{padding:.3em .8em;font-size:.8125rem}
.u3m button.tonal,.u3m-pill button.tonal{background:var(--surface3);color:var(--text)}
.u3m-empty{text-align:center;color:var(--muted);padding:22px 10px;font-size:.9rem}
.u3m-pill{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:70;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:6px 6px 6px 12px;box-shadow:0 4px 16px rgba(0,0,0,.3);font-size:.8125rem}
.u3m-pill a{color:inherit}
.u3m-pill .dot{width:8px;height:8px;border-radius:50%;background:var(--ok,#3ccf8e);flex:none}
@media (max-width:760px){.u3m-pill{bottom:calc(76px + env(safe-area-inset-bottom))}}
`));
}

// ------------------------------------------------------------------ the Tide Map page
/** Mounts the page into `el`. layout: "split" (Sonar main pane) or "stack" (Ripple page). Returns a cleanup function. */
export function mountTideMap(el, { layout = "split", backHref = null, title = "Tide Map" } = {}) {
  injectCss();
  let alive = true, timer = null, data = null, err = "", pollS = 30, skew = 0, friendsV3 = true, liveV3 = true;
  let mapMe = null, u3me = null, sel = null, fitted = false, mapObj = null, ml = null, markers = new Map(), meMarker = null;
  let picking = false, mutuals = null, pickSet = null, busy = false, liveMin = 60;
  const now = () => Date.now() + skew;

  const root = h("section", { class: `u3m ${layout}`, "data-view": "map", "aria-label": title });
  const seg = h("div", { class: "u3m-seg", role: "group", "aria-label": "View" });
  const setView = (v) => {
    root.dataset.view = v;
    seg.replaceChildren(...[["map", "Map"], ["list", "List"]].map(([id, l]) => h("button", { type: "button", "aria-pressed": String(v === id), onclick: () => setView(id) }, l)));
    if (v === "map") requestAnimationFrame(() => mapObj?.resize());
  };
  setView("map");
  const head = h("header", { class: "u3m-head" },
    backHref ? h("a", { class: "back", href: backHref, "aria-label": "Back", title: "Back" }, "‹") : null,
    h("h1", {}, mapIcon(), title), seg);
  const mapBox = h("div", { class: "u3m-map", role: "region", "aria-label": "Map of friends" });
  const mapNote = h("div", { class: "u3m-note" }, "Loading the map…");
  const card = h("div", { class: "u3m-card", hidden: true, role: "status" });
  mapBox.append(mapNote, card);
  const youBox = h("div", { class: "u3m-box" });
  const listBox = h("div", { role: "list", "aria-label": "Friends on the map" });
  const side = h("div", { class: "u3m-side" }, h("div", { class: "u3m-sec" }, "Friends"), listBox, h("div", { class: "u3m-sec" }, "Your location"), youBox);
  root.append(head, h("div", { class: "u3m-body" }, mapBox, side));
  el.replaceChildren(root);

  // ---------------------------------------------------------------- gate: signed in + beta on
  (async () => {
    if (!C.token()) { gate("Sign in to see Tide Map."); return; }
    const on = await betaOn(C.betaId);
    if (!alive) return;
    if (!on) { gate("Tide Map isn't turned on for your account yet. It's a beta — turn it on from the Beta screen in the app."); return; }
    initMap(); loadMe(); load();
  })();
  function gate(msg) { root.replaceChildren(head, h("div", { class: "u3m-empty", style: "padding:48px 16px" }, msg)); seg.hidden = true; }

  // ---------------------------------------------------------------- data
  async function load() {
    clearTimeout(timer);
    if (!alive) return;
    try {
      let j = null;
      if (friendsV3) { try { j = await C.api("/v1/u3/map/friends"); } catch (e) { if (e.status === 404) friendsV3 = false; else throw e; } }
      if (!friendsV3) { j = await C.api("/v1/map/friends"); j.poll = 30; j.me = null; liveV3 = false; }
      if (!alive) return;
      data = j; err = "";
      skew = j.now ? j.now - Date.now() : 0;
      pollS = Math.min(120, Math.max(5, Number(j.poll) || 30));
      if (j.me) u3me = j.me;
    } catch (e) { err = e?.message || "Couldn't load your friends' locations."; }
    if (!alive) return;
    paintList(); paintMarkers(); paintYou(); paintCard();
    schedule();
  }
  function schedule() { clearTimeout(timer); if (alive && !document.hidden) timer = setTimeout(load, pollS * 1000); }
  async function loadMe() {
    try { mapMe = await C.api("/v1/map/me"); } catch (e) { if (!mapMe) err = e?.message || err; }
    if (alive) { paintYou(); paintMarkers(); }
  }
  async function putMe(body) {
    busy = true; paintYou();
    try { mapMe = await C.api("/v1/map/me", { method: "PUT", body }); if (liveV3) u3me = await C.api("/v1/u3/map/me").catch(() => u3me); }
    catch (e) { C.toast(e?.message || "Couldn't save"); }
    busy = false;
    if (!alive) return;
    if (!mapMe?.sharing || mapMe?.submerged) { if (geoHas("map-live")) geoStop("map-live", ""); }
    paintYou(); load();
  }
  const onVis = () => { if (document.hidden) clearTimeout(timer); else load(); };
  document.addEventListener("visibilitychange", onVis);
  const onGeo = () => { if (alive) { paintYou(); paintMeMarker(); } };
  geo.subs.add(onGeo);

  // ---------------------------------------------------------------- map
  async function initMap() {
    try {
      const r = await makeMap(mapBox);
      if (!alive) { r.map.remove(); return; }
      ({ ml } = r); mapObj = r.map;
      mapNote.remove();
      mapObj.on("error", (e) => { if (String(e?.error?.message || "").match(/style|Failed to fetch/i) && !mapObj.isStyleLoaded()) showMapNote("The map tiles couldn't load right now — the list still works."); });
      mapObj.on("click", (e) => { if (!e.originalEvent?.target?.closest?.(".u3m-pin")) { sel = null; paintCard(); paintSel(); } });
      paintMarkers();
    } catch (e) {
      showMapNote((e?.message?.match(/WebGL/i) ? "This browser can't draw the map (WebGL is off)." : e?.message || "The map couldn't load.") + " The list still works.");
      if (matchMedia("(max-width:760px)").matches) setView("list");
    }
  }
  function showMapNote(t) { mapNote.textContent = t; if (!mapNote.isConnected) mapBox.prepend(mapNote); }
  function myPos() {
    if (geo.pos && Date.now() - geo.pos.at < 10 * 60_000) return geo.pos;
    return mapMe?.position || null;
  }
  function paintMeMarker() {
    if (!mapObj) return;
    const p = myPos();
    if (!p) { meMarker?.remove(); meMarker = null; return; }
    if (!meMarker) meMarker = new ml.Marker({ element: meDot() }).setLngLat([p.lng, p.lat]).addTo(mapObj);
    else meMarker.setLngLat([p.lng, p.lat]);
  }
  function paintMarkers() {
    paintMeMarker();
    if (!mapObj || !data) return;
    const seen = new Set();
    for (const it of itemsOf(data)) {
      const id = it.user?.id; if (!id) continue;
      seen.add(id);
      const live = !!it.live && Number(it.liveUntil) > now();
      const sig = `${live}|${live ? it.hdg : ""}|${it.user.avatar || ""}`;
      let mk = markers.get(id);
      if (mk && mk.sig !== sig) { mk.m.remove(); mk = null; }
      if (!mk) {
        const pe = pinEl(it.user, { live, hdg: it.hdg });
        const pick = (e) => { e.stopPropagation(); select(id, false); };
        pe.addEventListener("click", pick);
        pe.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); } });
        mk = { m: new ml.Marker({ element: pe }).setLngLat([it.lng, it.lat]).addTo(mapObj), sig, el: pe };
        markers.set(id, mk);
      } else mk.m.setLngLat([it.lng, it.lat]);
    }
    for (const [id, mk] of markers) if (!seen.has(id)) { mk.m.remove(); markers.delete(id); }
    paintSel();
    if (!fitted && itemsOf(data).length + (myPos() ? 1 : 0) > 0) {
      fitted = true;
      const pts = itemsOf(data).map((i) => [i.lng, i.lat]); const p = myPos(); if (p) pts.push([p.lng, p.lat]);
      fitTo(mapObj, ml, pts);
    }
  }
  function paintSel() { for (const [id, mk] of markers) mk.el.classList.toggle("sel", id === sel); for (const r of listBox.querySelectorAll("[data-uid]")) r.setAttribute("aria-current", String(r.dataset.uid === sel)); }
  function select(id, fromList) {
    sel = id; paintSel(); paintCard();
    const it = itemsOf(data).find((i) => i.user?.id === id);
    if (it && mapObj) { if (fromList && root.dataset.view === "list" && matchMedia("(max-width:760px)").matches) setView("map"); flyTo(mapObj, [it.lng, it.lat], 14); }
  }
  function lineFor(it) {
    const live = !!it.live && Number(it.liveUntil) > now();
    const bits = [];
    bits.push(live ? `updated ${agoText(it.at, now())}` : agoText(it.at, now()));
    const p = myPos(); if (p) bits.push(distText(distM(p, it)));
    if (it.acc > 200) bits.push(`±${it.acc >= 1000 ? (it.acc / 1000).toFixed(1) + " km" : Math.round(it.acc) + " m"}`);
    return { live, text: bits.join(" · ") };
  }
  function liveTag(it) { return h("span", { class: "u3m-live" }, `live · ${leftText(it.liveUntil, now())}`); }
  function paintCard() {
    const it = sel && itemsOf(data).find((i) => i.user?.id === sel);
    card.hidden = !it || !mapObj;
    if (!it) return;
    const { live, text } = lineFor(it);
    card.replaceChildren(faceEl(it.user), h("div", { class: "grow" },
      h("div", {}, h("a", { href: C.profileHref(it.user), style: "font-weight:700;color:inherit" }, nameOf(it.user)), " ", live ? liveTag(it) : null),
      h("div", { class: "u3m-sub" }, text),
      it.status ? h("div", { class: "u3m-sub" }, `${it.status.emoji || ""} ${it.status.text || ""}`.trim()) : null),
    h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => { sel = null; paintCard(); paintSel(); } }, "×"));
  }
  function paintList() {
    if (!data && !err) { listBox.replaceChildren(h("div", { class: "u3m-empty" }, "Loading…")); return; }
    const its = itemsOf(data);
    const kids = [];
    if (err) kids.push(h("div", { class: "u3m-err", style: "padding:4px 8px" }, err));
    if (!its.length && !err) kids.push(h("div", { class: "u3m-empty" }, "No friends are sharing with you right now. Tide Map shows mutual friends (you follow each other) who chose to share with you."));
    for (const it of its) {
      const { live, text } = lineFor(it);
      kids.push(h("div", { role: "listitem" }, h("button", { type: "button", class: "u3m-row", "data-uid": it.user.id, "aria-current": String(it.user.id === sel),
        onclick: () => select(it.user.id, true) },
      faceEl(it.user), h("div", { class: "grow" },
        h("div", { style: "display:flex;gap:8px;align-items:center" }, h("span", { class: "nm" }, nameOf(it.user)), live ? liveTag(it) : null),
        h("div", { class: "u3m-sub" }, text),
        it.status ? h("div", { class: "u3m-sub" }, `${it.status.emoji || ""} ${it.status.text || ""}`.trim()) : null))));
    }
    listBox.replaceChildren(...kids);
  }

  // ---------------------------------------------------------------- my sharing
  async function startLive() {
    if (busy) return;
    busy = true; paintYou();
    try {
      await locateOnce();   // permission first, so a "no" doesn't leave live mode on
      if (liveV3) {
        try { u3me = await C.api("/v1/u3/map/live", { method: "POST", body: { minutes: liveMin } }); }
        catch (e) { if (e.status === 404) liveV3 = false; else throw e; }
      }
      await geoStart("map-live", {
        onEnd: (why) => { if (liveV3) C.api("/v1/u3/map/live", { method: "POST", body: { minutes: 0 } }).then((j) => { u3me = j; if (alive) paintYou(); }, () => {}); if (why) C.toast(why); },
        onUnload: () => { if (liveV3) keepalive("/v1/u3/map/live", "POST", { minutes: 0 }); },
        check: (r) => (liveV3 && r && r.live === false ? "Your live time is up — this tab stopped sharing." : ""),
      });
    } catch (e) { geo.stoppedWhy = e?.message || "Couldn't start sharing."; }
    busy = false;
    if (alive) { paintYou(); paintMeMarker(); }
  }
  async function stopLive() {
    if (geoHas("map-live")) geoStop("map-live", "");
    else if (liveV3) { try { u3me = await C.api("/v1/u3/map/live", { method: "POST", body: { minutes: 0 } }); } catch (e) { C.toast(e?.message || "Couldn't stop"); } }
    paintYou(); load();
  }
  async function updateOnce() {
    busy = true; paintYou();
    try {
      const p = await locateOnce();
      let r;
      try { r = await C.api("/v1/u3/map/position", { method: "POST", body: { lat: p.lat, lng: p.lng, acc: Math.round(p.acc), app: "web" } }); }
      catch (e) { if (e.status !== 404) throw e; r = await C.api("/v1/map/position", { method: "POST", body: { lat: p.lat, lng: p.lng, acc: Math.round(p.acc) } }); }
      C.toast(r?.stored === false ? (r.reason === "submerged" ? "You're submerged — nothing was shared" : "Sharing is off — nothing was shared") : "Your spot is updated");
      loadMe();
    } catch (e) { geo.stoppedWhy = e?.message || "Couldn't get your location."; }
    busy = false; paintYou(); paintMeMarker();
  }
  async function openPicker() {
    picking = true; pickSet = new Set(mapMe?.allow || []); paintYou();
    if (!mutuals) {
      try {
        const id = C.myId();
        const [a, b] = await Promise.all([C.api(`/v1/users/${enc(id)}/followers`), C.api(`/v1/users/${enc(id)}/following`)]);
        const fol = new Set(itemsOf(a).map((u) => u.id));
        mutuals = itemsOf(b).filter((u) => fol.has(u.id));
      } catch (e) { mutuals = []; C.toast(e?.message || "Couldn't load your friends"); }
    }
    if (alive) paintYou();
  }
  function opts(label, list, cur, on) {
    return h("div", { class: "u3m-opts", role: "group", "aria-label": label }, list.map(([v, l]) => h("button", { type: "button", "aria-pressed": String(cur === v), disabled: busy, onclick: () => on(v) }, l)));
  }
  function paintYou() {
    if (!mapMe) { youBox.replaceChildren(h("div", { class: "u3m-sub" }, err && !data ? err : "Loading…")); return; }
    const t = now();
    const sharing = !!mapMe.sharing, sub = !!mapMe.submerged;
    const mineLive = geoHas("map-live");
    const otherLive = !mineLive && u3me?.live?.until > t ? u3me.live.until : 0;
    const kids = [];
    kids.push(h("label", { class: "u3m-toggle" },
      h("input", { type: "checkbox", role: "switch", checked: sharing, disabled: busy, "aria-checked": String(sharing), onchange: (e) => putMe({ sharing: e.target.checked }) }),
      h("div", {}, h("div", { style: "font-weight:600" }, "Share my location on Tide Map"),
        h("div", { class: "u3m-sub" }, `Only mutual friends you allow can see your latest spot. It's forgotten ${mapMe.keepHours || 8} h after the last update.`))));
    if (sharing) {
      kids.push(h("div", { class: "u3m-sub" }, "Who can see you"),
        opts("Who can see you", [["mutuals", "All mutual friends"], ["list", "Only friends I pick"]], mapMe.audience, (v) => { putMe({ audience: v }); if (v === "list") openPicker(); }));
      if (mapMe.audience === "list") {
        const n = (mapMe.allow || []).length;
        if (!picking) kids.push(h("div", { class: "u3m-act" }, h("span", { class: "u3m-sub" }, n ? `${n} friend${n === 1 ? "" : "s"} can see you` : "Nobody picked yet — nobody can see you"),
          h("button", { type: "button", class: "small tonal", onclick: openPicker }, "Choose friends")));
        else {
          const list = mutuals === null ? h("div", { class: "u3m-sub" }, "Loading your mutual friends…")
            : !mutuals.length ? h("div", { class: "u3m-sub" }, "No mutual friends yet — people you follow who follow you back show up here.")
              : h("div", { class: "u3m-picks" }, mutuals.map((u) => h("label", {}, h("input", { type: "checkbox", checked: pickSet.has(u.id), onchange: (e) => { if (e.target.checked) pickSet.add(u.id); else pickSet.delete(u.id); } }),
                faceEl(u, "u3m-av sm"), h("span", {}, nameOf(u), " ", h("span", { class: "u3m-sub" }, "@" + (u.username || ""))))));
          kids.push(list, h("div", { class: "u3m-act" }, h("button", { type: "button", class: "small", disabled: busy, onclick: () => { picking = false; putMe({ allow: [...pickSet] }); } }, "Save"),
            h("button", { type: "button", class: "small tonal", onclick: () => { picking = false; paintYou(); } }, "Cancel")));
        }
      }
      kids.push(h("div", { class: "u3m-sub" }, "Submerge (hide right away)"),
        opts("Submerge", [["off", "Off"], ["3h", "3 h"], ["24h", "24 h"], ["on", "Until I surface"]], !sub ? "off" : mapMe.ghostUntil === -1 ? "on" : null, (v) => putMe({ submerge: v })));
      if (sub) kids.push(h("div", { class: "u3m-warn" }, mapMe.ghostUntil === -1 ? "You're submerged until you surface — nobody sees you." : `You're submerged until ${clockText(mapMe.ghostUntil)} — nobody sees you.`));
    }
    // this tab
    kids.push(h("div", { class: "u3m-sub", style: "font-weight:700;color:var(--text);margin-top:4px" }, "From this tab"));
    const unsupported = geoSupport();
    if (mineLive) {
      const until = u3me?.live?.until;
      kids.push(h("div", { class: "u3m-act" }, h("span", { class: "u3m-live" }, `Live from this tab${until > t ? ` · ${leftText(until, t)}` : ""}`),
        h("span", { class: "u3m-sub" }, geo.lastSent ? `sent ${agoText(geo.lastSent)}` : "starting…"),
        h("button", { type: "button", class: "small tonal", onclick: stopLive }, "Stop")));
    } else if (unsupported) kids.push(h("div", { class: "u3m-err" }, unsupported));
    else if (!sharing || sub) kids.push(h("div", { class: "u3m-sub" }, sub ? "Surface first to share from this tab." : "Turn on sharing first to share from this tab."));
    else {
      kids.push(h("div", { class: "u3m-act" },
        h("button", { type: "button", class: "small", disabled: busy, onclick: startLive }, liveV3 ? "Share live while this tab is open" : "Share while this tab is open"),
        liveV3 ? h("select", { "aria-label": "For how long", disabled: busy, onchange: (e) => { liveMin = Number(e.target.value); } },
          LIVE_CHOICES.map(([m, l]) => h("option", { value: String(m), selected: m === liveMin }, `for ${l}`))) : null,
        h("button", { type: "button", class: "small tonal", disabled: busy, onclick: updateOnce }, "Update my spot once")));
    }
    if (otherLive) kids.push(h("div", { class: "u3m-act" }, h("span", { class: "u3m-live" }, `Live from another device · ${leftText(otherLive, t)}`),
      h("button", { type: "button", class: "small tonal", onclick: stopLive }, "End live")));
    if (mapMe.position) kids.push(h("div", { class: "u3m-sub" }, `Last shared spot: ${agoText(mapMe.position.at, t)}`));
    if (geo.error && mineLive) kids.push(h("div", { class: "u3m-err" }, geo.error));
    if (geo.stoppedWhy && !mineLive) kids.push(h("div", { class: "u3m-err" }, geo.stoppedWhy));
    kids.push(h("div", { class: "u3m-warn" }, "Browsers can't share your location in the background. Sharing from this tab stops when you close it or leave it in the background for 2 minutes. For all-day sharing, use the app on your phone."));
    youBox.replaceChildren(...kids);
  }

  paintList(); paintYou();
  return () => {
    alive = false; clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
    geo.subs.delete(onGeo);
    try { mapObj?.remove(); } catch {}
    markers.clear();
    setTimeout(() => geoEmit(), 0);   // the floating "sharing from this tab" note comes back if still sharing
  };
}

/** For apps without route cleanup (Ripple web): a route handler that tears the page down when the hash leaves #/map. */
export function hashRoute(opts) {
  return () => {
    const el = h("div");
    const stop = mountTideMap(el, opts);
    const off = () => { if (!/^#\/map(\/|$)/.test(location.hash)) { removeEventListener("hashchange", off); stop(); } };
    addEventListener("hashchange", off);
    return el;
  };
}

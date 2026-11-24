// Synced settings: the same blob the Android app uses (GET/PUT /v1/me/appdata/sonar, JSON `SonarSettings`).
// The app writes it with kotlinx.serialization (encodeDefaults = false), so missing fields mean "default". We edit the
// parsed object in place — unknown fields are preserved — and bump `updatedAt` (newest wins on every device).
// Plus: theme (mode, accent preset, bubble style, text size) applied as CSS variables, and per-chat drafts.
import { get, put } from "./api.js";
import { emit, state } from "./state.js";
import { applyBubbleStyle } from "./custom.js";   // U2-custom: Bubble Studio

let blob = {};
let pushTimer = null, lastPull = 0;
const LKEY = () => `sonar_settings_${state.me?.id || "anon"}`;

export const DEFAULTS = {
  "appearance.theme.mode": "System",
  "appearance.theme.source": "Preset",
  "appearance.theme.preset": "Sonar",
  "appearance.textScale": 1,
  "appearance.motion": "Full",
  "chat.bubble": "Round",
  "chat.textSize": 16,
  "chat.wallpaper.sameForBoth": true,
  "chat.quickReactions": ["❤️", "😂", "😮", "😢", "🔥", "👍"],
  "chat.voiceSpeed": 1,
  "chat.linkPreviews": true,
  "chat.bigEmoji": true,
  "chat.effects": true,
  "chat.sort": "PinnedFirst",
  "chat.showPreviews": true,
  "privacy.readReceipts": true,
  "privacy.typingIndicator": true,
  "privacy.ghostMode": false,
  "privacy.activityStatus": true,
  "notifications.preview": "Full",
  "notifications.pauseAll": false,
  "a11y.reduceMotion": false,
};

export function getS(path, dflt = DEFAULTS[path]) {
  let o = blob;
  for (const k of path.split(".")) { if (o == null || typeof o !== "object") return dflt; o = o[k]; }
  return o === undefined ? dflt : o;
}
export function setS(path, value) {
  const ks = path.split(".");
  let o = blob;
  for (const k of ks.slice(0, -1)) { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
  o[ks[ks.length - 1]] = value;
  changed();
}
/** Per-chat prefs (pinned, muteUntil, archived, markedUnread, nickname, wallpaper…). */
export const chatPref = (id) => (blob.chats && blob.chats[id]) || {};
export function setChatPref(id, patch) {
  blob.chats = blob.chats || {};
  blob.chats[id] = { ...(blob.chats[id] || {}), ...patch };
  changed();
}
export const isMuted = (id) => Number(chatPref(id).muteUntil || 0) > Date.now();
export const nickname = (uid, chatId) => (chatId && chatPref(chatId).nickname) || (blob.nicknames || {})[uid] || null;

function changed() {
  blob.updatedAt = Date.now();
  try { localStorage.setItem(LKEY(), JSON.stringify(blob)); } catch {}
  applyTheme();
  emit("settings");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1200);
}
async function pushNow() {
  if (!state.me) return;
  try { await put("/v1/me/appdata/sonar", { blob: JSON.stringify(blob) }); } catch { /* retried on the next change */ }
}

/** Loads the blob (newest of this browser's copy and the server's). */
export async function loadSettings() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LKEY()) || "null"); } catch {}
  blob = local && typeof local === "object" ? local : {};
  applyTheme();
  await pullSettings(true);
}
export async function pullSettings(force = false) {
  if (!state.me || (!force && Date.now() - lastPull < 30_000)) return;
  lastPull = Date.now();
  try {
    const r = await get("/v1/me/appdata/sonar");
    let remote = null;
    try { remote = r.blob ? JSON.parse(r.blob) : null; } catch {}
    if (remote && Number(remote.updatedAt || 0) > Number(blob.updatedAt || 0)) {
      blob = remote;
      try { localStorage.setItem(LKEY(), JSON.stringify(blob)); } catch {}
      applyTheme(); emit("settings");
    } else if (!remote && Number(blob.updatedAt || 0) > 0) pushNow();
    else if (remote && Number(blob.updatedAt || 0) > Number(remote.updatedAt || 0)) pushNow();
  } catch { /* offline: keep what we have */ }
  loadDrafts();
}
export function resetSettingsMemory() { blob = {}; drafts = {}; applyTheme(); }

// ------------------------------------------------------------------ drafts (synced as `sonar_drafts`: {chatId: text})
let drafts = {}, draftsLoaded = false, draftTimer = null;
async function loadDrafts() {
  if (draftsLoaded || !state.me) return;
  try { const r = await get("/v1/me/appdata/sonar_drafts"); drafts = r.blob ? JSON.parse(r.blob) || {} : {}; draftsLoaded = true; emit("drafts"); } catch {}
}
export const draft = (id) => drafts[id] || "";
export function setDraft(id, text) {
  if ((drafts[id] || "") === text) return;
  if (text) drafts[id] = text.slice(0, 4000); else delete drafts[id];
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { if (state.me) put("/v1/me/appdata/sonar_drafts", { blob: JSON.stringify(drafts) }).catch(() => {}); }, 2500);
}

// ------------------------------------------------------------------ colour (OKLCH) — a light stand-in for the app's HCT engine
const hex2rgb = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklch(hex) {
  const [r, g, b] = hex2rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
function oklchRgb(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
export function oklch(L, C, H) {
  let lo = 0, hi = C, rgb = oklchRgb(L, C, H);
  const ok = (v) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  if (!ok(rgb)) { for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (ok(oklchRgb(L, mid, H))) lo = mid; else hi = mid; } rgb = oklchRgb(L, lo, H); }
  return "#" + rgb.map((x) => Math.round(Math.min(1, Math.max(0, gam(Math.max(0, x)))) * 255).toString(16).padStart(2, "0")).join("");
}
const argbHex = (n) => "#" + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, "0");

/** The app's presets (ThemeEngine.ColorPresets). The web offers the Sonar/ocean ones; all of them render. */
export const PRESETS = {
  "Sonar": "#1494B8", "Ripple blue": "#1565FF", "Wake seafoam": "#20D3B5", "Cobalt": "#1F5BFF", "Ocean": "#0077B6", "Sky": "#4FA8FF",
  "Indigo": "#3F51B5", "Violet": "#7E57C2", "Teal": "#00897B", "Emerald": "#2E7D32", "Lime": "#7CB342", "Amber": "#FFA000", "Sunset": "#F4511E",
  "Crimson": "#C62828", "Rose": "#D81B60", "Graphite": "#5F6B7A", "Mono": "#808080",
  "Abyss": "#1A2A6C", "Lagoon": "#00A5A8", "Coral": "#FF6F61", "Kelp": "#5B7F2B", "Pearl": "#B8A9C9", "Sunset Reef": "#FF8A3D",
};
export const WEB_PRESETS = ["Sonar", "Ripple blue", "Wake seafoam", "Abyss", "Lagoon", "Coral", "Kelp", "Pearl", "Sunset Reef"];
export const PRESET_LABEL = { "Wake seafoam": "Seafoam" };
const BRANDS = {
  "Sonar": { deep: "#04212B", vivid: "#1494B8", light: "#6FD3E6" },
  "Ripple blue": { deep: "#061A3D", vivid: "#1565FF", light: "#6FA8FF" },
};
export const THEME_MODES = [["System", "System"], ["Light", "Light"], ["Dark", "Dark"], ["Black", "AMOLED black"]];
export const BUBBLES = ["Round", "Soft", "Square", "Outline", "Glass", "Minimal"];

export function seedHex() {
  const src = getS("appearance.theme.source");
  if (src === "Custom" && getS("appearance.theme.seed") != null) return argbHex(getS("appearance.theme.seed"));
  return PRESETS[getS("appearance.theme.preset")] || PRESETS.Sonar;
}
export function isDark() {
  const mode = getS("appearance.theme.mode");
  if (mode === "Dark" || mode === "Black") return true;
  if (mode === "Light") return false;
  if (mode === "Scheduled") {
    const d = new Date(), n = d.getHours() * 60 + d.getMinutes();
    const from = getS("appearance.theme.darkFrom", 19 * 60), to = getS("appearance.theme.darkTo", 7 * 60);
    return from <= to ? n >= from && n < to : n >= from || n < to;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
const isBlack = () => { const m = getS("appearance.theme.mode"); return m === "Black" || (m === "Scheduled" && getS("appearance.theme.scheduledBlack", false) && isDark()); };

/** Colours for the current settings (also used by the wallpaper renderer). */
export function palette() {
  const dark = isDark(), black = isBlack();
  const preset = getS("appearance.theme.source") === "Custom" ? null : getS("appearance.theme.preset");
  const seed = seedHex();
  let [, C0, H] = toOklch(seed);
  if (preset === "Mono") C0 = 0;
  const c = (k) => Math.min(C0, k);
  const brand = BRANDS[preset] || { deep: oklch(0.27, c(0.08), H), vivid: oklch(0.6, Math.max(c(0.16), Math.min(C0, 0.02)), H), light: oklch(0.82, c(0.11), H) };
  const p = dark ? {
    bg: oklch(0.155, c(0.028), H), surface: oklch(0.195, c(0.034), H), surface2: oklch(0.24, c(0.04), H), surface3: oklch(0.285, c(0.045), H),
    line: oklch(0.335, c(0.045), H), text: oklch(0.955, c(0.012), H), muted: oklch(0.76, c(0.035), H), primary: brand.light,
  } : {
    bg: oklch(0.985, c(0.008), H), surface: "#ffffff", surface2: oklch(0.958, c(0.018), H), surface3: oklch(0.925, c(0.028), H),
    line: oklch(0.885, c(0.03), H), text: oklch(0.22, c(0.03), H), muted: oklch(0.47, c(0.035), H), primary: oklch(0.5, c(0.13), H),
  };
  if (black) Object.assign(p, { bg: "#000000", surface: "#0b0b0f", surface2: "#111116", surface3: "#18181e", line: "#26262e" });
  const vividL = toOklch(brand.vivid)[0];
  return { ...p, vivid: brand.vivid, deep: brand.deep, light: brand.light, onVivid: vividL > 0.72 ? "#06141a" : "#ffffff", dark, black, hue: H };
}

export function applyTheme() {
  const p = palette();
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries({ bg: p.bg, surface: p.surface, surface2: p.surface2, surface3: p.surface3, line: p.line, text: p.text, muted: p.muted, primary: p.primary, vivid: p.vivid, deep: p.deep, light: p.light, "on-vivid": p.onVivid }))
    r.setProperty("--" + k, v);
  const root = document.documentElement;
  root.dataset.theme = p.dark ? "dark" : "light";
  root.style.colorScheme = p.dark ? "dark" : "light";
  root.dataset.bubble = String(getS("chat.bubble")).toLowerCase();
  r.setProperty("--msg-size", Math.min(28, Math.max(11, Number(getS("chat.textSize")) || 16)) + "px");
  r.setProperty("--ui-scale", String(Math.min(1.4, Math.max(0.8, Number(getS("appearance.textScale")) || 1))));
  root.classList.toggle("reduce-motion", !!getS("a11y.reduceMotion") || ["Reduced", "Off"].includes(getS("appearance.motion")));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.dark ? p.bg : p.vivid);
  applyBubbleStyle(getS("custom.style"));   // U2-custom
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { applyTheme(); emit("settings"); });
setInterval(() => { if (getS("appearance.theme.mode") === "Scheduled") applyTheme(); }, 60_000);

/** The chat wallpaper for the current mode (per-chat one wins). Shape: {kind, id, color, color2, angle, dim}. */
export function wallpaperFor(chatId) {
  const pair = (chatId && chatPref(chatId).wallpaper) || getS("chat.wallpaper", {}) || {};
  const same = pair.sameForBoth !== false;
  const w = (!same && isDark() ? pair.dark : pair.light) || {};
  return { kind: w.kind || "Builtin", id: w.id || "waves", color: w.color, color2: w.color2, angle: w.angle ?? 135, dim: Number(w.dim || 0), animated: w.animated !== false };
}
/** Pick a built-in wallpaper (web writes `chat.wallpaper.light.id`, like the app's "same for both" default). */
export function setWallpaper(id) {
  const pair = { ...(getS("chat.wallpaper", {}) || {}) };
  pair.light = { ...(pair.light || {}), kind: id === "none" ? "None" : "Builtin", id: id === "none" ? "plain" : id };
  if (pair.sameForBoth === false) pair.dark = { ...(pair.dark || {}), kind: pair.light.kind, id: pair.light.id };
  setS("chat.wallpaper", pair);
}
export const rawSettings = () => blob;

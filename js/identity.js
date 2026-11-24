// U2-identity: role banners (API key `ribbons`, called "banners" in the UI — not `banner`, which is the profile
// header image), developer flair (name colour / gradient / font / effect, avatar effects, animated profile pictures)
// and the owner's chat bubble. Drawn with CSS (identity.css) + tiny inline SVG: no assets, fonts or libraries.
// Everything degrades to the plain look when the Worker sends no `ribbons` / `flair` (older backend).
import { avatar, reducedMotion } from "./dom.js";
import { publicUrl, safeKey } from "./api.js";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const hex = (s) => (typeof s === "string" && HEX.test(s) ? s : null);
const SVGNS = "http://www.w3.org/2000/svg";
const RB_ANIMS = new Set(["none", "shimmer", "pulse", "wave"]);
const FONTS = new Set(["serif", "mono", "cursive", "rounded", "condensed", "wide"]);
const NAME_FX = new Set(["shimmer", "tide"]);
const EFFECTS = new Set(["fire", "sparkles", "lightning", "glow", "bubbles", "aurora", "crest"]);
const BIG = new Set(["big"]);          // sizes that may play an animated video picture (profile header)
const MAX_RUN = 6;                     // animated avatars running at once (the rest stay still)

// Banner icons (Material names from the API → original 24×24 line drawings).
const ICONS = {
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  campaign: "M3 10v4h3l7 4V6l-7 4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  heart: "M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  waves: "M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  rocket: "M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10zM9 16l-3 4M15 16l3 4M12 9.5h.01",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H15a2 2 0 0 0-1 3.7A1.5 1.5 0 0 1 12 21M7.5 12h.01M10 7.5h.01M15 7.5h.01",
  camera: "M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5 11a7 7 0 0 0 14 0M12 18v3",
  sailing: "M11 3v13H4zM13 6l7 10h-7zM3 19c3 2 6 2 9 0s6-2 9 0",
  diamond: "M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5M12 14v4M8 21h8",
  handshake: "M2 11l4-4 4 2 3-2 5 1 4 4M13 9l-3 3a1.5 1.5 0 0 0 2 2l3-2 4 4-3 3-2-1M6 7l-3 8 4 3 2-1",
  brush: "M20 4 10 14M10 14a3 3 0 0 0-4 1c-1 2-1 4-3 5 3 1 7 0 8-2a3 3 0 0 0-1-4",
  science: "M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4A1.5 1.5 0 0 0 20 19L14 9V3M7 15h10",
  support: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6",
  anchor: "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M12 8v13M8 11h8M4 13a8 8 0 0 0 16 0",
};
const FILLED = new Set(["star", "bolt", "heart", "shield"]);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function rbIcon(name) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "rb-ic"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", ICONS[name]);
  p.setAttribute("fill", FILLED.has(name) ? "currentColor" : "none");
  p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2.2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}
/** Relative luminance (WCAG) of #RRGGBB. */
function lum(c) {
  const n = parseInt(c.slice(1), 16);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
const inkFor = (c1, c2) => ((lum(c1) + lum(c2 || c1)) / 2 > 0.4 ? "#0B1020" : "#FFFFFF");

// ------------------------------------------------------------------ banners (ribbons)
function ribbon(r) {
  const c1 = hex(r.color) || "#1E7BFF", c2 = hex(r.color2);
  const anim = RB_ANIMS.has(r.anim) ? r.anim : "none";
  const text = String(r.text).slice(0, 32);
  const p = el("span", "ribbon rb-" + anim);
  p.style.setProperty("--rb1", c1); p.style.setProperty("--rb2", c2 || c1); p.style.color = inkFor(c1, c2);
  p.title = text;
  p.append(rbIcon(ICONS[r.icon] ? r.icon : "star"), el("span", "rb-t", text));
  return p;
}
/**
 * Role banners as pills (a DOM node, or null when there are none). `compact` = at most one smaller pill, for names in
 * lists / chats; otherwise all of them (profiles).
 */
export function ribbonsHtml(user, compact = false) {
  const list = Array.isArray(user?.ribbons) ? user.ribbons.filter((r) => r && typeof r.text === "string" && r.text.trim()) : [];
  if (!list.length) return null;
  const box = el("span", "ribbons " + (compact ? "compact" : "full"));
  for (const r of list.slice(0, compact ? 1 : 6)) box.append(ribbon(r));
  if (compact && list.length > 1) box.title = list.map((r) => String(r.text)).join(" · ");
  return box;
}

// ------------------------------------------------------------------ names
/** The name with the person's flair (colour / gradient / font / effect), or a plain text node. */
export function flairName(user, text) {
  text = String(text ?? "");
  const f = user?.flair;
  if (!f || typeof f !== "object") return document.createTextNode(text);
  const c1 = hex(f.nameColor), c2 = hex(f.nameColor2);
  const font = FONTS.has(f.nameFont) ? f.nameFont : null;
  const fx = NAME_FX.has(f.nameEffect) ? f.nameEffect : null;
  if (!c1 && !c2 && !font && !fx) return document.createTextNode(text);
  const s = el("span", "fname" + (font ? " ff-" + font : "") + (fx ? " nf-" + fx : "") + ((c1 && c2) || fx ? " grad" : ""), text);
  if (c1) s.style.setProperty("--n1", c1);
  if (c2) s.style.setProperty("--n2", c2);
  if ((c1 || c2) && !(c1 && c2) && !fx) s.style.color = c1 || c2;
  return s;
}

// ------------------------------------------------------------------ avatars: effects + animated pictures
const running = new Set(), waiting = new Set();
let io = null, sweep = 0, pumpQueued = false;
function observer() {
  if (io === null) io = typeof IntersectionObserver === "function" ? new IntersectionObserver(onSeen, { rootMargin: "60px" }) : false;
  return io;
}
function onSeen(entries) {
  for (const e of entries) {
    const w = e.target;
    if (e.isIntersecting && w.isConnected) { if (!running.has(w)) waiting.add(w); }
    else { waiting.delete(w); if (running.has(w)) stop(w); }
  }
  pump();
}
function pump() {
  pumpQueued = false;
  for (const w of running) if (!w.isConnected) stop(w);
  for (const w of waiting) {
    if (!w.isConnected) { waiting.delete(w); continue; }
    if (!w._big && running.size >= MAX_RUN) continue;
    waiting.delete(w); start(w);
  }
  if (running.size && !sweep) sweep = setInterval(pump, 4000);          // catches rows removed without an IO entry
  else if (!running.size && sweep) { clearInterval(sweep); sweep = 0; }
}
function queuePump() { if (!pumpQueued) { pumpQueued = true; setTimeout(pump, 0); } }
function start(w) {
  running.add(w); w.classList.add("run");
  const l = w._layer;
  if (!l || !l.dataset.src) return;
  if (l.tagName === "VIDEO") {
    if (!l.getAttribute("src")) l.src = l.dataset.src;
    l.hidden = false; l.play()?.catch?.(() => {});
  } else if (l.getAttribute("src") !== l.dataset.src) l.src = l.dataset.src;   // shown on load
  else l.hidden = false;
}
function stop(w) {
  running.delete(w); w.classList.remove("run");
  const l = w._layer;
  if (!l) return;
  if (l.tagName === "VIDEO") l.pause();
  else { l.hidden = true; l.removeAttribute("src"); }
}
function track(w) {
  const o = observer();
  if (o) o.observe(w);
  else { waiting.add(w); queuePump(); }
}
/** Same element type/classes as the normal avatar, showing another public key (the animated picture's still). */
function withSrc(base, url) {
  if (!url) return base;
  if (base.tagName === "IMG") { base.src = url; return base; }
  const img = el("img", base.className); img.alt = ""; img.loading = "lazy"; img.src = url;
  return img;
}

/**
 * Avatar with the person's flair: an effect drawn around it (CSS) and/or their animated picture. `base` is the normal
 * avatar element (built with dom.avatar when left out). Animated images play in any size (at most MAX_RUN at once,
 * only while on screen); animated videos only in BIG sizes, elsewhere the still (or the normal avatar) is shown.
 * Reduced motion → still only, effect drawn without animation.
 */
export function flairAvatar(user, size = "", base = null) {
  base = base || avatar(user?.avatar, user?.displayName || user?.name || user?.username, size);
  const f = user?.flair;
  if (!f || typeof f !== "object") return base;
  const fx = EFFECTS.has(f.effect) ? f.effect : null;
  const anim = safeKey(f.anim) ? f.anim : null;
  if (!fx && !anim) return base;
  const video = f.animKind === "video";
  const big = BIG.has(size);
  const motion = !reducedMotion();
  if (anim && safeKey(f.animStill)) base = withSrc(base, publicUrl(f.animStill));
  const live = !!anim && motion && (!video || big);
  if (!fx && !live) return base;
  const w = el("span", "fav" + (fx ? " fx fx-" + fx : "") + (size ? " fav-" + size : ""));
  const tint = hex(f.effectColor);
  if (tint && fx !== "crest") w.style.setProperty("--fx", tint);
  w.append(base);
  if (live) {
    const cls = base.className + " fav-layer";
    let l;
    if (video) {
      l = el("video", cls); l.muted = true; l.loop = true; l.playsInline = true; l.preload = "none";
      l.setAttribute("muted", ""); l.setAttribute("playsinline", ""); l.setAttribute("aria-hidden", "true");
      if (base.tagName === "IMG" && base.src) l.poster = base.src;
      l.addEventListener("error", () => { l.hidden = true; delete l.dataset.src; });
    } else {
      l = el("img", cls); l.alt = ""; l.decoding = "async";
      l.addEventListener("load", () => { l.hidden = !w.classList.contains("run"); });
      l.addEventListener("error", () => { if (l.getAttribute("src")) { l.hidden = true; l.removeAttribute("src"); delete l.dataset.src; } });
    }
    l.hidden = true; l.dataset.src = publicUrl(anim);
    w.append(l); w._layer = l;
  }
  w._big = big;
  if (motion) track(w);
  return w;
}

// ------------------------------------------------------------------ owner bubble
/** Messages sent by someone with flair.ownerBubble get the owner's bubble style. */
export const hasOwnerBubble = (u) => !!(u && u.flair && typeof u.flair === "object" && u.flair.ownerBubble === true);

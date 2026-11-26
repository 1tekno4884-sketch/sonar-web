// Chat wallpapers — canvas versions of the app's built-in ones (ui/chats/Wallpapers.kt), all original, drawn in code.
// Animated ones run at a gentle frame rate only while visible, and hold a still frame with reduced motion.
import { palette, wallpaperFor } from "./settings.js";
import { reducedMotion } from "./dom.js";

export const BUILTIN_WALLS = [
  ["waves", "Waves", true], ["caustics", "Caustics", true], ["bubbles", "Bubbles", true], ["deep", "Deep sea", true],
  ["mesh", "Gradient mesh", true], ["sonar", "Sonar sweep", true], ["still_waves", "Calm lines", false], ["dots", "Pebbles", false], ["plain", "Plain", false],
];

// deterministic random (same layout every frame, like java.util.Random(seed) in the app)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

function waves(g, W, H, p, t) {
  g.strokeStyle = rgba(p.vivid, p.dark ? 0.08 : 0.07); g.lineWidth = 2;
  const shift = t * 160;
  for (let y = 30, row = 0; y < H + 40; y += 64, row++) {
    const dir = row % 2 ? -1 : 1;
    g.beginPath();
    let x = -160 + ((shift * dir) % 160);
    g.moveTo(x, y);
    while (x < W + 160) { g.quadraticCurveTo(x + 40, y - 14, x + 80, y); g.quadraticCurveTo(x + 120, y + 14, x + 160, y); x += 160; }
    g.stroke();
  }
}
function caustics(g, W, H, p, t) {
  g.strokeStyle = rgba(p.light, p.dark ? 0.07 : 0.14); g.lineWidth = 1.8;
  const r0 = rng(11);
  for (let i = 0; i < 26; i++) {
    const bx = r0() * W, by = r0() * H, ph = r0() * Math.PI * 2, r = 30 + r0() * 70, k = Math.PI * 2 * t + ph;
    g.beginPath();
    for (let j = 0; j <= 24; j++) {
      const a = (j / 24) * Math.PI * 2;
      const rr = r * (1 + 0.18 * Math.sin(3 * a + k) + 0.1 * Math.cos(5 * a - k * (1 + (i % 3))));
      const x = bx + rr * Math.cos(a), y = by + rr * Math.sin(a) * 0.7;
      j ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.stroke();
  }
}
function bubbles(g, W, H, p, t) {
  const r0 = rng(7), a = p.dark ? 0.1 : 0.16;
  g.lineWidth = 1.5;
  for (let i = 0; i < 46; i++) {
    const r = 4 + r0() * 14, x0 = r0() * W, speed = 0.5 + r0(), y0 = r0() * (H + 80);
    const y = ((((y0 - t * speed * (H + 80)) % (H + 80)) + H + 80) % (H + 80)) - 40;
    const x = x0 + Math.sin(y / 60 + i) * 8;
    g.strokeStyle = rgba(p.light, a); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = rgba(p.light, a * 0.8); g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); g.fill();
  }
}
function deep(g, W, H, p, t) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, rgba(p.deep, p.dark ? 0.95 : 0.35)); gr.addColorStop(1, rgba(p.bg, 0));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const r0 = rng(3);
  for (let i = 0; i < 30; i++) {
    const x = r0() * W, y = r0() * H, sp = 1 + r0(), rad = 1.5 + r0() * 2.5;
    const tw = 0.5 + 0.5 * Math.sin(Math.PI * 2 * t * sp + i);
    g.fillStyle = rgba(p.light, (p.dark ? 0.3 : 0.2) * tw); g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
}
function mesh(g, W, H, p, t) {
  const al = p.dark ? 0.22 : 0.16, k = Math.PI * 2 * t;
  const blob = (cx, cy, r, col) => { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, rgba(col, al)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  blob(W * (0.3 + 0.15 * Math.sin(k)), H * (0.25 + 0.1 * Math.cos(k)), Math.max(W, H) * 0.7, p.vivid);
  blob(W * (0.75 - 0.15 * Math.cos(k)), H * (0.7 + 0.1 * Math.sin(k)), Math.max(W, H) * 0.8, p.light);
}
function sweep(g, W, H, p, t) {
  const cx = W / 2, cy = H * 0.42, al = p.dark ? 0.09 : 0.07, step = Math.min(W, 700) * 0.16;
  g.lineWidth = 1.5; g.strokeStyle = rgba(p.vivid, al);
  for (let i = 1; i <= 8; i++) { g.beginPath(); g.arc(cx, cy, i * step, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 3; g.strokeStyle = rgba(p.vivid, al * 2 * (1 - t)); g.beginPath(); g.arc(cx, cy, Math.max(1, t * Math.max(W, H) * 0.9), 0, Math.PI * 2); g.stroke();
}
function dots(g, W, H, p) {
  const r0 = rng(7); g.lineWidth = 1.5; g.strokeStyle = rgba(p.light, p.dark ? 0.08 : 0.14);
  for (let i = 0; i < 70; i++) { const r = 5 + r0() * 16; const x = r0() * W, y = r0() * H; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
}
const DRAW = { waves, still_waves: (g, W, H, p) => waves(g, W, H, p, 0), caustics, bubbles, deep, mesh, sonar: sweep, dots };
const PERIOD = { sonar: 4000 };
const argb = (n, d) => (n == null ? d : "#" + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, "0"));

function paint(cv, w, t) {
  const p = palette();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
  if (w.kind === "Solid") { g.fillStyle = argb(w.color, "#0B3B4A"); g.fillRect(0, 0, W, H); }
  else if (w.kind === "Gradient") {
    const a = (w.angle * Math.PI) / 180, r = Math.max(W, H) / 2, cx = W / 2, cy = H / 2;
    const gr = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    gr.addColorStop(0, argb(w.color, "#0B3B4A")); gr.addColorStop(1, argb(w.color2, "#1E88A8")); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } else if (w.kind === "Builtin") DRAW[w.id]?.(g, W, H, p, t);
  if (w.kind !== "None" && w.dim > 0) { g.fillStyle = `rgba(0,0,0,${Math.min(0.85, w.dim)})`; g.fillRect(0, 0, W, H); }
}

/** Attaches an (animated) wallpaper to a canvas. Returns {update(chatId), stop()}. */
export function mountWallpaper(cv, chatId) {
  let w = wallpaperFor(chatId), raf = 0, start = performance.now(), last = 0, alive = true;
  const animated = () => w.kind === "Builtin" && w.animated && BUILTIN_WALLS.find((x) => x[0] === w.id)?.[2] && !reducedMotion();
  const frame = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    // ~15 fps is plenty for a slow background; glass bubbles re-blur on every frame, so go gentler under them
    if (document.hidden || now - last < (document.documentElement.dataset.bubble === "glass" ? 200 : 66)) return;
    last = now;
    paint(cv, w, ((now - start) / (PERIOD[w.id] || 14000)) % 1);
  };
  const restart = () => { cancelAnimationFrame(raf); paint(cv, w, 0.3); if (animated()) raf = requestAnimationFrame(frame); };
  const ro = new ResizeObserver(() => paint(cv, w, animated() ? ((performance.now() - start) / (PERIOD[w.id] || 14000)) % 1 : 0.3));
  ro.observe(cv);
  restart();
  return {
    update(id = chatId) { chatId = id; w = wallpaperFor(chatId); restart(); },
    stop() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
/** A small still preview (settings picker). */
export function wallpaperPreview(id, size = [96, 140]) {
  const cv = document.createElement("canvas");
  cv.style.width = size[0] + "px"; cv.style.height = size[1] + "px";
  requestAnimationFrame(() => paint(cv, { kind: id === "none" ? "None" : "Builtin", id, dim: 0 }, 0.3));
  return cv;
}

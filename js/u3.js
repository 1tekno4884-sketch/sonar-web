// Update 3 "custom": the shared look options (synced blob `u3`) on Sonar web — cheap parts only:
// night colour, avatar shape, corner family, type scale/weight/tracking, bold text, Tide canvas (CSS gradients).
// Shapes/canvases the browser can't draw exactly fall back to the closest CSS look.

const hex = (argb) => "#" + ((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0");

/** Night colour: the preset/seed to use while dark, or null. */
export function nightSeed(u3, dark, presets) {
  const n = u3 && u3.night;
  if (!dark || !n || !n.on) return null;
  return (n.preset && presets[n.preset]) || (n.seed != null ? hex(n.seed) : null);
}

const AVATAR = {
  Circle: "50%", Squircle: "32%", Rounded: "26%", Pebble: "50% 36% 50% 30%", Drop: "50% 50% 50% 10%", Diamond: "30%", Shell: "50%", Hexagon: "50%",
};

function canvasCss(c, bg) {
  if (!c) return "";
  const cols = (c.colors && c.colors.length ? c.colors : [0xff0e1b2e, 0xff1e88a8]).map(hex);
  if (cols.length === 1) cols.push(cols[0]);
  let g;
  switch (c.kind || "Linear") {
    case "Radial": g = `radial-gradient(circle at 30% 25%, ${cols.join(", ")})`; break;
    case "Sweep": g = `conic-gradient(from 0deg at 50% 45%, ${cols.join(", ")}, ${cols[0]})`; break;
    case "Mesh": g = cols.slice(1).map((col, i) => `radial-gradient(circle at ${[20, 80, 50][i % 3]}% ${[25, 35, 85][i % 3]}%, ${col}, transparent 60%)`).join(", ") + `, ${cols[0]}`; break;
    case "Waves": g = `linear-gradient(180deg, ${cols.join(", ")})`; break;
    default: g = `linear-gradient(${(c.angle ?? 135) + 90}deg, ${cols.join(", ")})`;
  }
  const fade = Math.min(0.92, Math.max(0, c.fade ?? 0.35));
  return `linear-gradient(color-mix(in srgb, ${bg} ${Math.round(fade * 100)}%, transparent), color-mix(in srgb, ${bg} ${Math.round(fade * 100)}%, transparent)), ${g}`;
}

/** Applies the U3 options as CSS variables / data attributes on <html>. */
export function applyU3(u3, bg) {
  const root = document.documentElement, r = root.style;
  u3 = u3 || {};
  r.setProperty("--avatar-r", AVATAR[u3.avatarShape] || "50%");
  root.dataset.avatar = (u3.avatarShape || "Circle").toLowerCase();
  root.dataset.corners = (u3.corners || "Rounded").toLowerCase();
  r.setProperty("--head-scale", String(Math.min(1.4, Math.max(0.8, Number(u3.headScale) || 1))));
  r.setProperty("--body-scale", String(Math.min(1.3, Math.max(0.85, Number(u3.bodyScale) || 1)) * (u3.largeText ? 1.15 : 1)));
  r.setProperty("--weight-shift", String((Number(u3.weight) || 0) + (u3.boldText ? 200 : 0)));
  r.setProperty("--tracking", ((Number(u3.tracking) || 0) / 100) + "em");
  const c = u3.canvases && u3.canvases.all;
  r.setProperty("--u3-canvas", c ? canvasCss(c, bg) : "none");
  root.classList.toggle("u3-canvas", !!c);
  // U4-glassrs: Sea Glass (u3.glass) → CSS backdrop-filter on the chrome (style.css "U4-glassrs" block)
  const g = u3.glass || {};
  root.classList.toggle("sea-glass", !!g.on);
  root.classList.toggle("glass-tinted", !!(g.on && g.tinted));
  root.classList.toggle("glass-solid", !!(g.on && g.reduceTransparency));
  root.dataset.glass = String(g.strength || "Standard").toLowerCase();
}

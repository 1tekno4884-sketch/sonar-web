// Update 2 "custom" on Sonar web: Tidewrite rich text (*bold* _italic_ ~strike~ `code` ||spoiler||) and the
// Bubble Studio look from the synced settings blob (`custom.style`), applied as CSS variables. Same rules as the app
// (ui/u2/U2CustomRichText.kt): old clients just show the readable raw text.

const OPEN_BEFORE = "([{\"'";
const CLOSE_AFTER = ".,!?;:)]}\"'";
const URL_AT = /^https?:\/\/\S+/;
const ws = (c) => /\s/.test(c);

export function hasMarkup(s) { return !!s && s.length >= 3 && /[*_~`|]/.test(s); }

/** → [{text, bold, italic, strike, code, spoiler}] */
export function parseRich(s) {
  s = String(s || "");
  if (!hasMarkup(s)) return [{ text: s }];
  const out = [];
  parseInto(s, {}, out);
  return out.filter((x) => x.text);
}
const openOk = (t, i, n) => (i === 0 || ws(t[i - 1]) || OPEN_BEFORE.includes(t[i - 1])) && i + n < t.length && !ws(t[i + n]);
const closeOk = (t, j, n) => j > 0 && !ws(t[j - 1]) && (j + n === t.length || ws(t[j + n]) || CLOSE_AFTER.includes(t[j + n]));
function findClose(t, from, mk) {
  for (let j = from; j < t.length; j++) {
    if (t[j] === "\n") return -1;
    if (t.startsWith(mk, j) && closeOk(t, j, mk.length)) return j;
  }
  return -1;
}
function parseInto(t, f, out) {
  let buf = "";
  const flush = () => { if (buf) { out.push({ ...f, text: buf }); buf = ""; } };
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if ((c === "h" || c === "H") && (i === 0 || !/[\p{L}\p{N}]/u.test(t[i - 1]))) {
      const m = t.slice(i).match(URL_AT);
      if (m) { buf += m[0]; i += m[0].length; continue; }
    }
    if (c === "`" && openOk(t, i, 1)) {
      const j = findClose(t, i + 2, "`");
      if (j > i + 1) { flush(); out.push({ ...f, text: t.slice(i + 1, j), code: true }); i = j + 1; continue; }
    }
    if (c === "|" && t.startsWith("||", i) && openOk(t, i, 2)) {
      const j = findClose(t, i + 3, "||");
      if (j > i + 2) { flush(); parseInto(t.slice(i + 2, j), { ...f, spoiler: true }, out); i = j + 2; continue; }
    }
    if ((c === "*" || c === "_" || c === "~") && openOk(t, i, 1)) {
      const j = findClose(t, i + 2, c);
      if (j > i + 1) {
        flush();
        parseInto(t.slice(i + 1, j), { ...f, ...(c === "*" ? { bold: true } : c === "_" ? { italic: true } : { strike: true }) }, out);
        i = j + 1; continue;
      }
    }
    buf += c; i++;
  }
  flush();
}

/** One-line previews: markers removed, spoilers hidden. */
export function plainRich(s) {
  if (!hasMarkup(s)) return String(s || "");
  return parseRich(s).map((x) => (x.spoiler ? "▒".repeat(Math.min(8, Math.max(3, x.text.length))) : x.text)).join("");
}

/**
 * Formatted message text as a DocumentFragment. [inner] renders a plain piece (links, mentions, search highlight) —
 * pass dom.js `rich`. Never builds HTML from user text.
 */
export function richText(text, inner, opts = {}) {
  const segs = parseRich(text);
  if (segs.length === 1 && !segs[0].bold && !segs[0].italic && !segs[0].strike && !segs[0].code && !segs[0].spoiler) return inner(text, opts);
  const out = document.createDocumentFragment();
  let spoilerGroup = null;
  for (const sg of segs) {
    let node = sg.code ? document.createElement("code") : document.createElement("span");
    if (sg.code) node.textContent = sg.text; else node.append(inner(sg.text, opts));
    if (sg.bold) { const b = document.createElement("strong"); b.append(node); node = b; }
    if (sg.italic) { const e = document.createElement("em"); e.append(node); node = e; }
    if (sg.strike) { const d = document.createElement("s"); d.append(node); node = d; }
    if (sg.spoiler) {
      const sp = document.createElement("span");
      sp.className = "spoiler"; sp.tabIndex = 0; sp.setAttribute("role", "button"); sp.setAttribute("aria-label", "Hidden text. Tap to reveal");
      const reveal = (e) => { e.preventDefault(); e.stopPropagation(); sp.classList.add("open"); sp.removeAttribute("role"); sp.removeAttribute("aria-label"); };
      sp.addEventListener("click", reveal, { once: true });
      sp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") reveal(e); });
      sp.append(node); node = sp; spoilerGroup = sp;
    }
    out.append(node);
  }
  void spoilerGroup;
  return out;
}

// ------------------------------------------------------------------ Bubble Studio → CSS variables
const SYS_FONTS = { serif: "Georgia, 'Times New Roman', serif", mono: "ui-monospace, 'Courier New', monospace", cursive: "'Comic Sans MS', cursive",
  casual: "'Comic Sans MS', 'Segoe Print', cursive", condensed: "'Arial Narrow', 'Roboto Condensed', sans-serif-condensed, sans-serif",
  light: "system-ui, sans-serif", smallcaps: "system-ui, sans-serif", serifmono: "'Courier New', monospace" };
const hex = (n) => (n == null ? null : "#" + ((n >>> 0) & 0xffffff).toString(16).padStart(6, "0"));
function rgba(n, a) { const h = hex(n); if (!h) return null; return a < 1 ? `color-mix(in srgb, ${h} ${Math.round(a * 100)}%, transparent)` : h; }
function readable(n) {
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#0b1a20" : "#ffffff";
}
const RADIUS = { Pill: "999px", Square: "6px", Cut: "4px" };

/** Applies `custom.style` (from the synced blob) to the page. [style] may be undefined (= app defaults). */
export function applyBubbleStyle(style) {
  const root = document.documentElement, r = root.style;
  const vars = ["sent-bg", "sent-fg", "recv-bg", "recv-fg", "sent-radius", "recv-radius", "msg-font"];
  for (const v of vars) r.removeProperty("--u2-" + v);
  delete root.dataset.u2sent; delete root.dataset.u2recv; root.classList.remove("u2-bubbles");
  if (!style || typeof style !== "object") return;
  const side = (s, k) => {
    if (!s || typeof s !== "object") return;
    const a = typeof s.alpha === "number" ? Math.max(0.15, Math.min(1, s.alpha)) : 1;
    if (s.color != null) {
      const bg = s.color2 != null ? `linear-gradient(${(s.angle ?? 135) - 45}deg, ${rgba(s.color, a)}, ${rgba(s.color2, a)})` : rgba(s.color, a);
      r.setProperty(`--u2-${k}-bg`, bg);
      r.setProperty(`--u2-${k}-fg`, s.textColor != null ? hex(s.textColor) : readable(s.color));
    } else if (s.textColor != null) r.setProperty(`--u2-${k}-fg`, hex(s.textColor));
    if (s.radius != null || s.shape) r.setProperty(`--u2-${k}-radius`, RADIUS[s.shape] || `${Math.max(0, Math.min(32, s.radius ?? 20))}px`);
    if (s.shape) root.dataset["u2" + k] = String(s.shape).toLowerCase();
  };
  side(style.sent, "sent"); side(style.received, "recv");
  if (typeof style.font === "string" && style.font.startsWith("sys:")) r.setProperty("--u2-msg-font", SYS_FONTS[style.font.slice(4)] || "inherit");
  if (typeof style.size === "number") r.setProperty("--msg-size", Math.min(26, Math.max(12, style.size)) + "px");
  root.classList.add("u2-bubbles");
}

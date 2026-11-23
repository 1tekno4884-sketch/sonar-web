// Tiny DOM helpers (text only → no XSS), icons, toasts, modals, menus, formatting, rich text, badges, avatars.
import { publicUrl, safeHref } from "./api.js";

// append/replaceChildren skip null/false and flatten arrays (the DOM would print "null" otherwise)
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ["append", "prepend", "replaceChildren"]) {
    const orig = proto[name];
    proto[name] = function (...n) { return orig.apply(this, n.flat(Infinity).filter((x) => x != null && x !== false)); };
  }
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "ref") v(el);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const enc = encodeURIComponent;

// ------------------------------------------------------------------ icons (original simple line icons, 24×24)
const P = {
  chat: "M4 5h16v11H9l-5 4z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M15.5 15.5 21 21",
  send: "M4 12 20 4l-4 16-4-7zM12 13l8-9",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5 11a7 7 0 0 0 14 0M12 18v3",
  micoff: "M15 10V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.5 2.6M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18",
  attach: "M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17a1.7 1.7 0 0 1-2.4-2.4L15 7",
  emoji: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6 6 18",
  pin: "M9 4h6l-1 5 3 3H7l3-3zM12 12v8",
  mute: "M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  reply: "M10 8 4 13l6 5M4 13h10a6 6 0 0 1 6 6",
  forward: "M14 8l6 5-6 5M20 13H10a6 6 0 0 0-6 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  download: "M12 4v11M7 10l5 5 5-5M4 20h16",
  play: "M7 4.5v15l12-7.5z",
  pause: "M7 4h3.5v16H7zM13.5 4H17v16h-3.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  checks: "M2.5 12.5 7 17l9.5-9.5M11 15.5l1.5 1.5L22 7.5",
  camera: "M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  camoff: "M3 7h12v10H3zM15 10l6-3v10l-6-3M3 3l18 18",
  screen: "M3 4h18v12H3zM8 20h8M12 16v4M12 13V7M9 10l3-3 3 3",
  pip: "M3 5h18v14H3zM12 12h7v5h-7z",
  hangup: "M3 14.5c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0v2.5l-3 1.5z",
  plus: "M12 5v14M5 12h14",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  bellOff: "M6 16V11a6 6 0 0 1 9-5.2M18 11v5l2 2H8M10 20a2 2 0 0 0 4 0M3 3l18 18",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v6M12 7.5h.01",
  sticker: "M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6zM20 12a8 8 0 0 0-8 8M9 10h.01M15 10h.01",
  poll: "M5 20V10M12 20V4M19 20v-7",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  incoming: "M17 7 7 17M7 9v8h8",
  outgoing: "M7 17 17 7M9 7h8v8",
  missed: "M4 8l6 6 4-4 6 6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  devices: "M3 5h13v10H3zM7 19h5M19 9h2v10h-4v-4",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H15a2 2 0 0 0-1 3.7A1.5 1.5 0 0 1 12 21M7.5 12h.01M10 7.5h.01M15 7.5h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  logout: "M10 4H4v16h6M15 8l4 4-4 4M19 12H9",
  ping: "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14",
  game: "M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6H9A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4M7 11v3M5.5 12.5h3M15 12h.01M18 13h.01",
  flip: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
  person_add: "M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M3 21a7 7 0 0 1 12-5M19 14v6M16 17h6",
  signal: "M4 20v-3M9 20v-7M14 20V9M19 20V4",
  silent: "M4 9h4l5-4v14l-5-4H4zM3 3l18 18",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  unread: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  megaphone: "M3 10v4a1 1 0 0 0 1 1h2l7 4V5L6 9H4a1 1 0 0 0-1 1M6 15l1.5 5H10l-1-4.5M17 9a3.5 3.5 0 0 1 0 6M19.5 6.5a7 7 0 0 1 0 11",
};
const FILLED = new Set(["play", "pause", "star_f"]);
export function icon(name, cls = "") {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "ic " + cls);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", P[name] || P.info);
  if (FILLED.has(name)) { p.setAttribute("fill", "currentColor"); }
  else { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.9"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
  s.append(p);
  return s;
}
/** Icon button with an accessible label (and tooltip). */
export const iconBtn = (name, label, onclick, cls = "") => h("button", { class: "icon-btn " + cls, type: "button", "aria-label": label, title: label, onclick }, icon(name));

/** The Sonar mark (inline, so it themes and needs no request). */
export function mark(cls = "mark") {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 108 108"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(ns, "use"); u.setAttribute("href", "#sonar-mark"); s.append(u);
  return s;
}

// ------------------------------------------------------------------ toasts, modals, menus
export function toast(msg, ms = 2800) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
export const errText = (e) => e?.message || "Something went wrong";

let lastFocus = null;
/** Opens a dialog. Returns a close function. Esc / backdrop click close it. */
export function modal(content, { wide = false, label = "Dialog", onClose } = {}) {
  const m = $("#modal");
  lastFocus = document.activeElement;
  const box = h("div", { class: "box" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": label }, content);
  m.replaceChildren(box); m.hidden = false;
  const close = () => { if (m.hidden) return; m.hidden = true; m.replaceChildren(); onClose?.(); lastFocus?.focus?.(); };
  m.onclick = (e) => { if (e.target === m) close(); };
  m._close = close;
  setTimeout(() => (box.querySelector("[autofocus]") || box.querySelector("input,textarea,select,button"))?.focus(), 0);
  return close;
}
export const closeModal = () => $("#modal")._close?.();
export const modalOpen = () => !$("#modal").hidden;

export function confirmBox(title, body, okLabel = "OK", danger = false) {
  return new Promise((res) => {
    let done = false;
    const close = modal(h("div", { class: "stack" },
      h("h2", {}, title), body ? h("p", { class: "meta" }, body) : null,
      h("div", { class: "row end" },
        h("button", { class: "tonal", onclick: () => { done = true; close(); res(false); } }, "Cancel"),
        h("button", { class: danger ? "danger" : "", autofocus: true, onclick: () => { done = true; close(); res(true); } }, okLabel))), { label: title, onClose: () => { if (!done) res(false); } });
  });
}
export function promptBox(title, { value = "", placeholder = "", okLabel = "Save", multiline = false, type = "text" } = {}) {
  return new Promise((res) => {
    let done = false;
    const inp = multiline ? h("textarea", { placeholder, "aria-label": title }, value) : h("input", { type, value, placeholder, "aria-label": title });
    const ok = () => { done = true; close(); res(inp.value); };
    if (!multiline) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
    const close = modal(h("div", { class: "stack" }, h("h2", {}, title), inp,
      h("div", { class: "row end" }, h("button", { class: "tonal", onclick: () => { done = true; close(); res(null); } }, "Cancel"), h("button", { onclick: ok }, okLabel))),
    { label: title, onClose: () => { if (!done) res(null); } });
  });
}

/** Popup menu next to an element or at a point. items: [{label, icon, onclick, danger}] | "-" */
export function menu(anchorOrPoint, itemsList, { label = "Menu" } = {}) {
  closeMenu();
  const m = h("div", { class: "menu", role: "menu", "aria-label": label });
  for (const it of itemsList) {
    if (!it) continue;
    if (it === "-") { m.append(h("div", { class: "sep", role: "separator" })); continue; }
    if (it.custom) { m.append(it.custom); continue; }
    m.append(h("button", { role: "menuitem", class: it.danger ? "danger-text" : "", onclick: () => { closeMenu(); it.onclick?.(); } }, it.icon ? icon(it.icon) : null, h("span", {}, it.label)));
  }
  document.body.append(m);
  const r = anchorOrPoint instanceof Element ? anchorOrPoint.getBoundingClientRect() : { left: anchorOrPoint.x, right: anchorOrPoint.x, top: anchorOrPoint.y, bottom: anchorOrPoint.y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = Math.min(r.left, innerWidth - mw - 8), y = r.bottom + 4;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  m.style.left = Math.max(8, x) + "px"; m.style.top = y + "px";
  const items_ = $$("button", m);
  items_[0]?.focus();
  m.addEventListener("keydown", (e) => {
    const i = items_.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items_[(i + 1) % items_.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items_[(i - 1 + items_.length) % items_.length]?.focus(); }
    else if (e.key === "Escape") { e.stopPropagation(); closeMenu(); }
    else if (e.key === "Tab") closeMenu();
  });
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  menu.prevFocus = anchorOrPoint instanceof Element ? anchorOrPoint : null;
  return m;
}
function outside(e) { if (!e.target.closest(".menu")) closeMenu(); }
export function closeMenu() {
  const m = $(".menu"); if (!m) return false;
  m.remove(); document.removeEventListener("pointerdown", outside, true);
  menu.prevFocus?.focus?.(); menu.prevFocus = null;
  return true;
}

// ------------------------------------------------------------------ formatting
export const fmt = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? Math.floor(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n); };
export function ago(ms) {
  ms = Number(ms) || 0; if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 6e4) return "now"; if (d < 36e5) return Math.floor(d / 6e4) + "m"; if (d < 864e5) return Math.floor(d / 36e5) + "h";
  if (d < 6048e5) return Math.floor(d / 864e5) + "d"; return new Date(ms).toLocaleDateString();
}
export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function listTime(ms) {
  if (!ms) return "";
  const d = new Date(ms), n = new Date();
  if (d.toDateString() === n.toDateString()) return clock(ms);
  if (n - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function dayLabel(ms) {
  const d = new Date(ms), n = new Date();
  if (d.toDateString() === n.toDateString()) return "Today";
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" });
}
export const dur = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); const m = Math.floor(s / 60); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
export const bytes = (n) => { n = Number(n) || 0; return n >= 1 << 30 ? (n / (1 << 30)).toFixed(1) + " GB" : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; };
export function lastSeen(ms) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 3 * 6e4) return "Active now";
  if (d < 36e5) return `Active ${Math.floor(d / 6e4)}m ago`;
  if (d < 864e5) return `Active ${Math.floor(d / 36e5)}h ago`;
  if (d < 7 * 864e5) return `Active ${Math.floor(d / 864e5)}d ago`;
  return "";
}

// ------------------------------------------------------------------ emoji / rich text
const EMOJI_RX = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|\s)+$/u;
/** 1–3 emoji and nothing else → count (for big-emoji messages), else 0. */
export function bigEmojiCount(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40 || !EMOJI_RX.test(t)) return 0;
  const seg = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].filter((s) => s.segment.trim()).length : t.length / 2;
  return seg >= 1 && seg <= 3 ? seg : 0;
}

/** Links, @mentions (→ profile) and highlighted search terms. Text only — no HTML from user data. */
export function rich(text, { highlight = "", mentionHref = (u) => `#/u/${enc(u.toLowerCase())}` } = {}) {
  const out = document.createDocumentFragment();
  const rx = /(@[A-Za-z0-9._]{3,20})|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;
  let i = 0, m;
  text = String(text || "");
  const plain = (s) => {
    if (!highlight || !s) return out.append(s);
    const low = s.toLowerCase(), q = highlight.toLowerCase(); let j = 0, k;
    while ((k = low.indexOf(q, j)) >= 0) { out.append(s.slice(j, k), h("mark", {}, s.slice(k, k + q.length))); j = k + q.length; }
    out.append(s.slice(j));
  };
  while ((m = rx.exec(text))) {
    plain(text.slice(i, m.index));
    const t = m[0];
    if (t[0] === "@") out.append(h("a", { href: mentionHref(t.slice(1)), class: "mention" }, t));
    else { const u = safeHref(t); out.append(u ? h("a", { href: u, rel: "noopener nofollow ugc", target: "_blank" }, t) : t); }
    i = m.index + t.length;
  }
  plain(text.slice(i));
  return out;
}

// ------------------------------------------------------------------ badges (original shapes, same as Ripple)
const BADGE_TITLE = { verified: "Verified", creator: "Verified Creator", brand: "Brand", org: "Organization" };
function badgeSvg(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 20 20"); s.setAttribute("class", "badge"); s.setAttribute("role", "img"); s.setAttribute("aria-label", BADGE_TITLE[kind]);
  const t = document.createElementNS(ns, "title"); t.textContent = BADGE_TITLE[kind]; s.append(t);
  if (kind === "brand" || kind === "org") {
    const r = document.createElementNS(ns, "rect"); r.setAttribute("width", "20"); r.setAttribute("height", "20"); r.setAttribute("rx", "4.4"); r.setAttribute("fill", kind === "brand" ? "#E0A100" : "#8A94A6"); s.append(r);
  } else {
    let d = ""; for (let i = 0; i <= 20; i++) { const a = Math.PI * 2 * i / 20 - Math.PI / 2, r = i % 2 ? 8.4 : 10; d += (i ? "L" : "M") + (10 + r * Math.cos(a)).toFixed(2) + "," + (10 + r * Math.sin(a)).toFixed(2); }
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", d + "Z"); p.setAttribute("fill", kind === "creator" ? "#3b6cff" : "#1E7BFF"); s.append(p);
  }
  const c = document.createElementNS(ns, "path"); c.setAttribute("d", "M6,10.4 L8.8,13 L14.2,7.4"); c.setAttribute("fill", "none"); c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "2.2"); c.setAttribute("stroke-linecap", "round"); s.append(c);
  return s;
}
/** Verification badges. `hidden` = badges the person chose to hide in Sonar (sonar.hiddenBadges). */
export function badges(b = {}, { dev = true, hidden = [] } = {}) {
  b = b || {};
  const show = (k) => b[k] && !hidden.includes(k);
  const out = [];
  if (show("creator")) out.push(badgeSvg("creator")); else if (show("verified")) out.push(badgeSvg("verified"));
  if (show("brand")) out.push(badgeSvg("brand")); if (show("org")) out.push(badgeSvg("org"));
  if (show("dev") && dev) out.push(h("span", { class: "devtag", title: "Given by Ripple's owner. Nobody can apply for it." }, "Certified Developer"));
  return out;
}

export function avatar(key, name, size = "", ring = "") {
  const u = publicUrl(key);
  const cls = "avatar" + (size ? " " + size : "") + (ring && ring !== "none" ? " ring-" + ring : "");
  return u ? h("img", { class: cls, src: u, alt: "", loading: "lazy" }) : h("div", { class: cls, "aria-hidden": "true" }, String(name || "?").trim().slice(0, 1).toUpperCase() || "?");
}

/** Debounce helper. */
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => document.documentElement.classList.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;

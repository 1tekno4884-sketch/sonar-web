// Media helpers: photo/video preparation before upload, the full-screen viewer, the voice-note player, and a tiny
// WebM → Ogg remuxer so voice notes recorded in Chromium (WebM/Opus) are stored as Opus-in-Ogg like the app's.
import { h, icon, iconBtn, dur } from "./dom.js";
import { getS } from "./settings.js";

// ------------------------------------------------------------------ images & videos
function loadImage(blob) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const i = new Image(); i.onload = () => res({ img: i, url: u }); i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("That image can't be read")); }; i.src = u; });
}
const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));
/** Photos: WebP at ≤1600 px (2560 px in HD), like the app. GIFs are kept as they are. */
export async function prepareImage(file, hd = false) {
  const { img, url } = await loadImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  try {
    if (file.type === "image/gif") return { blob: file, mime: "image/gif", w: w0, h: h0 };
    const max = hd ? 2560 : 1600, s = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * s), hh = Math.round(h0 * s);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = hh;
    cv.getContext("2d").drawImage(img, 0, 0, w, hh);
    let out = await toBlob(cv, "image/webp", 0.85);
    if (!out || out.type !== "image/webp") out = await toBlob(cv, "image/jpeg", 0.86);
    if (s === 1 && ["image/jpeg", "image/webp", "image/png"].includes(file.type) && file.size <= (out?.size ?? Infinity)) return { blob: file, mime: file.type, w: w0, h: h0 };
    return { blob: out, mime: out.type, w, h: hh };
  } finally { URL.revokeObjectURL(url); }
}
/** Videos are sent as they are (mp4/webm); we read size + duration and grab a JPEG poster frame. */
export function videoMeta(file) {
  return new Promise((res) => {
    const u = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.preload = "metadata"; v.playsInline = true;
    let done = false;
    const finish = async (thumb) => { if (done) return; done = true; URL.revokeObjectURL(u); res({ w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? v.duration : 0, thumb }); };
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch { finish(null); } };
    v.onseeked = async () => {
      try {
        const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        const cv = document.createElement("canvas"); cv.width = Math.round(v.videoWidth * s); cv.height = Math.round(v.videoHeight * s);
        cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
        finish(await toBlob(cv, "image/jpeg", 0.8));
      } catch { finish(null); }
    };
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    v.src = u;
  });
}

// ------------------------------------------------------------------ viewer
/** items: [{url, kind: "image"|"video", alt}] */
export function openViewer(list, index = 0, note = "") {
  let i = index;
  const stage = h("div", { class: "stage" });
  const prev = h("button", { class: "icon-btn vnav prev", "aria-label": "Previous" }, icon("back"));
  const next = h("button", { class: "icon-btn vnav next", "aria-label": "Next", style: "transform:scaleX(-1)" }, icon("back"));
  const close = () => { v.remove(); document.removeEventListener("keydown", key, true); last?.focus?.(); };
  const show = () => {
    const it = list[i];
    stage.replaceChildren(it.kind === "video" ? h("video", { src: it.url, controls: true, autoplay: true, playsinline: true }) : h("img", { src: it.url, alt: it.alt || "" }));
    prev.hidden = next.hidden = list.length < 2;
  };
  prev.onclick = () => { i = (i - 1 + list.length) % list.length; show(); };
  next.onclick = () => { i = (i + 1) % list.length; show(); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowLeft") prev.click(); else if (e.key === "ArrowRight") next.click();
  };
  const last = document.activeElement;
  const closeBtn = iconBtn("close", "Close", close, "vclose");
  const v = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Media viewer", onclick: (e) => { if (e.target === v) close(); } }, stage, prev, next, closeBtn, note ? h("div", { class: "vnote" }, note) : null);
  document.body.append(v);
  document.addEventListener("keydown", key, true);
  show(); closeBtn.focus();
  return close;
}

// ------------------------------------------------------------------ voice notes (one shared player: keeps playing while you scroll)
const audioEl = new Audio();
audioEl.preload = "none";
let current = null;            // { key, ui }
const peaksCache = new Map();
function seeded(key, n) {
  let s = 0; for (const c of String(key)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return 0.25 + (s / 4294967296) * 0.75; });
}
async function decodePeaks(blob, n) {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C(); const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close?.();
    const d = buf.getChannelData(0), step = Math.floor(d.length / n) || 1, out = [];
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step && j < d.length; j += 16) m = Math.max(m, Math.abs(d[j])); out.push(m); }
    const mx = Math.max(...out, 0.01); return out.map((x) => Math.max(0.12, x / mx));
  } catch { return null; }
}
function drawWave(cv, peaks, progress) {
  const W = cv.clientWidth || 160, H = cv.clientHeight || 32, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const col = getComputedStyle(cv).color, n = peaks.length, bw = W / n;
  peaks.forEach((p, i) => {
    g.globalAlpha = i / n <= progress ? 1 : 0.38; g.fillStyle = col;
    const bh = Math.max(3, p * H * 0.9); g.beginPath(); g.roundRect ? g.roundRect(i * bw + 1, (H - bh) / 2, Math.max(1.5, bw - 2), bh, 2) : g.rect(i * bw + 1, (H - bh) / 2, Math.max(1.5, bw - 2), bh); g.fill();
  });
}
const SPEEDS = [1, 1.5, 2];
/** A voice-note bubble body: play/pause, waveform (seek by clicking), time, speed 1×/1.5×/2×. */
export function voicePlayer(url, key, seconds = 0) {
  const N = 36;
  let peaks = peaksCache.get(key) || seeded(key, N);
  const btn = h("button", { class: "play", type: "button", "aria-label": "Play voice note" }, icon("play"));
  const cv = h("canvas", { role: "slider", "aria-label": "Voice note position", tabindex: "0", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" });
  const time = h("span", { class: "vt" }, dur(seconds));
  let speed = Number(getS("chat.voiceSpeed")) || 1;
  const spd = h("button", { class: "spd", type: "button", "aria-label": "Playback speed" }, speed + "×");
  const el = h("div", { class: "voice" }, btn, cv, time, spd);
  const mine = () => current?.key === key;
  const ui = {
    paint() {
      const p = mine() && audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
      drawWave(cv, peaks, p); cv.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      const playing = mine() && !audioEl.paused;
      btn.replaceChildren(icon(playing ? "pause" : "play")); btn.setAttribute("aria-label", playing ? "Pause voice note" : "Play voice note");
      time.textContent = mine() && audioEl.currentTime > 0 ? dur(audioEl.currentTime) : dur(seconds || (mine() ? audioEl.duration : 0));
    },
  };
  let blobUrl = null;
  async function load() {
    if (blobUrl) return blobUrl;
    const r = await fetch(url); if (!r.ok) throw new Error("This voice note is gone");
    const b = await r.blob(); blobUrl = URL.createObjectURL(b);
    if (!peaksCache.has(key)) decodePeaks(b, N).then((p) => { if (p) { peaksCache.set(key, p); peaks = p; ui.paint(); } });
    return blobUrl;
  }
  btn.onclick = async () => {
    if (mine() && !audioEl.paused) { audioEl.pause(); return; }
    if (!mine()) {
      const prev = current; current = { key, ui }; prev?.ui.paint();
      try { audioEl.src = await load(); } catch (e) { current = null; btn.title = e.message; return; }
    }
    audioEl.playbackRate = speed;
    audioEl.play().catch(() => {});
  };
  spd.onclick = () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; spd.textContent = speed + "×"; if (mine()) audioEl.playbackRate = speed; };
  const seek = (frac) => { if (mine() && audioEl.duration) { audioEl.currentTime = frac * audioEl.duration; ui.paint(); } };
  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect(), frac = (e.clientX - r.left) / r.width;
    if (mine()) seek(frac);
    else btn.onclick().then(() => audioEl.addEventListener("loadedmetadata", () => seek(frac), { once: true }));
  };
  cv.onkeydown = (e) => { if (!mine() || !audioEl.duration) return; if (e.key === "ArrowRight") audioEl.currentTime += 5; else if (e.key === "ArrowLeft") audioEl.currentTime -= 5; else if (e.key === " ") { e.preventDefault(); btn.click(); } };
  if (mine()) current.ui = ui;
  requestAnimationFrame(() => ui.paint());
  el._ui = ui;
  return el;
}
for (const ev of ["timeupdate", "play", "pause", "ended", "loadedmetadata"]) audioEl.addEventListener(ev, () => current?.ui.paint());
audioEl.addEventListener("ended", () => { const c = current; current = null; c?.ui.paint(); });
export const stopVoice = () => { audioEl.pause(); };

// ------------------------------------------------------------------ WebM (Opus) → Ogg Opus remux, no re-encoding
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
function crc32(b) { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 255]) >>> 0; return c; }
function vint(d, p, keepMarker) {
  const b = d[p]; if (b === undefined) return null;
  let len = 1, mask = 0x80; while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = keepMarker ? b : b & (mask - 1), allOnes = (b & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + d[p + i]; if (d[p + i] !== 255) allOnes = false; }
  return { v, len, unknown: !keepMarker && allOnes };
}
const MASTERS = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xe1, 0xa0]);
function opusSamples(pkt) {
  if (!pkt.length) return 0;
  const toc = pkt[0], cfg = toc >> 3;
  const ms = cfg < 12 ? [10, 20, 40, 60][cfg & 3] : cfg < 16 ? [10, 20][cfg & 1] : [2.5, 5, 10, 20][cfg & 3];
  const c = toc & 3, frames = c === 0 ? 1 : c < 3 ? 2 : (pkt[1] || 0) & 0x3f;
  return Math.round(frames * ms * 48);
}
/** Returns an audio/ogg Blob, or throws (the caller then uploads the WebM as video/webm instead). */
export async function webmToOgg(blob) {
  const d = new Uint8Array(await blob.arrayBuffer());
  let p = 0, track = null, curTrack = null, codecPriv = null, channels = 1;
  const tracks = {}; const packets = [];
  while (p < d.length) {
    const id = vint(d, p, true); if (!id) break; p += id.len;
    const sz = vint(d, p, false); if (!sz) break; p += sz.len;
    if (MASTERS.has(id.v)) { if (id.v === 0xae) curTrack = {}; continue; }
    if (sz.unknown) throw new Error("unsupported webm");
    const end = p + sz.v;
    if (id.v === 0xd7 && curTrack) curTrack.num = d[p];                         // TrackNumber
    else if (id.v === 0x86 && curTrack) { curTrack.codec = new TextDecoder().decode(d.subarray(p, end)); if (curTrack.num != null) tracks[curTrack.num] = curTrack; }
    else if (id.v === 0x63a2) codecPriv = d.slice(p, end);
    else if (id.v === 0x9f) channels = d[p];
    else if (id.v === 0xa3 || id.v === 0xa1) {
      const tn = vint(d, p, false);
      const flags = d[p + tn.len + 2];
      if (flags & 0x06) throw new Error("laced webm");
      if (track == null) track = Object.values(tracks).find((t) => t.codec === "A_OPUS")?.num ?? tn.v;
      if (tn.v === track) packets.push(d.subarray(p + tn.len + 3, end));
    }
    if (curTrack && curTrack.num != null && curTrack.codec && !tracks[curTrack.num]) tracks[curTrack.num] = curTrack;
    p = end;
  }
  if (!packets.length) throw new Error("no audio");
  const head = codecPriv && new TextDecoder().decode(codecPriv.subarray(0, 8)) === "OpusHead" ? codecPriv : (() => {
    const b = new Uint8Array(19); b.set(new TextEncoder().encode("OpusHead")); b[8] = 1; b[9] = channels || 1;
    new DataView(b.buffer).setUint16(10, 312, true); new DataView(b.buffer).setUint32(12, 48000, true); return b;
  })();
  const vendor = new TextEncoder().encode("Sonar web");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4); tags.set(new TextEncoder().encode("OpusTags")); new DataView(tags.buffer).setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const serial = (Math.random() * 2 ** 32) >>> 0;
  const pages = []; let seq = 0;
  const page = (pkts, granule, flags) => {
    const segs = []; for (const k of pkts) { let n = k.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); }
    const body = pkts.reduce((a, k) => a + k.length, 0);
    const pg = new Uint8Array(27 + segs.length + body); const dv = new DataView(pg.buffer);
    pg.set([0x4f, 0x67, 0x67, 0x53]); pg[5] = flags;
    dv.setUint32(6, granule % 2 ** 32, true); dv.setUint32(10, Math.floor(granule / 2 ** 32), true);
    dv.setUint32(14, serial, true); dv.setUint32(18, seq++, true); pg[26] = segs.length; pg.set(segs, 27);
    let o = 27 + segs.length; for (const k of pkts) { pg.set(k, o); o += k.length; }
    dv.setUint32(22, crc32(pg), true);
    pages.push(pg);
  };
  page([head], 0, 0x02); page([tags], 0, 0);
  let gran = 0, batch = [], nseg = 0;
  packets.forEach((k, i) => {
    const s = Math.floor(k.length / 255) + 1;
    if (nseg + s > 255 && batch.length) { page(batch, gran, 0); batch = []; nseg = 0; }
    batch.push(k); nseg += s; gran += opusSamples(k);
    if (i === packets.length - 1) page(batch, gran, 0x04);
  });
  return new Blob(pages, { type: "audio/ogg" });
}

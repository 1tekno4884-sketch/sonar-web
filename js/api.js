// API client for the Ripple Worker (same backend as Ripple and the Sonar app). JSON in, JSON out.
import { API_URL } from "../config.js";

export const API = API_URL;
const TOKEN_KEY = "sonar_token";

export let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch {}

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const unauthorized = new Set();
/** Called when the server says our session is gone (401) — the app signs out locally. */
export function onUnauthorized(fn) { unauthorized.add(fn); }

export function setToken(t) {
  token = t || null;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {}
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = "Bearer " + token;
  let r;
  try { r = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal }); }
  catch (e) { if (e?.name === "AbortError") throw e; throw new ApiError(0, "You're offline or Sonar can't reach the server."); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) unauthorized.forEach((f) => f());
  if (!r.ok) throw new ApiError(r.status, j.error || `Request failed (${r.status})`);
  return j;
}
export const get = (p, o) => api(p, o);
export const post = (p, body = {}) => api(p, { method: "POST", body });
export const patch = (p, body = {}) => api(p, { method: "PATCH", body });
export const put = (p, body = {}) => api(p, { method: "PUT", body });
export const del = (p) => api(p, { method: "DELETE" });
export const items = (j) => (Array.isArray(j) ? j : j?.items ?? []);

/** Raw bytes (snaps / view-once open, file downloads). */
export async function fetchBlob(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = "Bearer " + token;
  let r;
  try { r = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, "You're offline or Sonar can't reach the server."); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new ApiError(r.status, j.error || `Request failed (${r.status})`); }
  return r.blob();
}

/** passwordHash = base64url(PBKDF2-HMAC-SHA256(password, "ripple:" + username.lower(), 100 000, 32 bytes)) — same as Ripple. */
export async function passwordHash(username, password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("ripple:" + username.trim().toLowerCase()), iterations: 100000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ------------------------------------------------------------------ media URLs
// Only our own storage keys (u/<uid>/…) — keys come from user data, so never trust them as URLs.
export const safeKey = (k) => typeof k === "string" && /^u\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+$/.test(k) && !k.includes("..");
/** Public files (avatars, banners, group photos) are at /media/<key>; private chat media at /m/<key>?t=<token>. */
export function mediaUrl(key, b = "prv") {
  if (!safeKey(key)) return null;
  return b === "pub" ? `${API}/media/${key}` : `${API}/m/${key}?t=${encodeURIComponent(token || "")}`;
}
export const publicUrl = (key) => mediaUrl(key, "pub");
export const safeHref = (u) => { try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.href : null; } catch { return null; } };

// ------------------------------------------------------------------ uploads (resumable: start → single | part… → complete)
function xhrPut(url, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("authorization", "Bearer " + token);
    x.setRequestHeader("content-type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded);
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText || "{}"); } catch {}
      if (x.status >= 200 && x.status < 300) resolve(j); else reject(new ApiError(x.status, j.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new ApiError(0, "Upload interrupted — check your connection."));
    x.send(blob);
  });
}

/**
 * Uploads one file. purpose: chat | snap | voice | file | sticker | group. scope: the chat id.
 * Returns {key, b}. onProgress gets 0…1.
 */
export async function upload(blob, { purpose = "chat", scope = "_", mime, durationSec = 0, onProgress } = {}) {
  mime = mime || blob.type;
  const s = await post("/v1/upload/start", { purpose, mime, size: blob.size, durationSec, visibility: "private", scope });
  const key = s.key, b = s.b;
  const ek = encodeURIComponent(key);
  if (!s.uploadId) {
    await xhrPut(`${API}/v1/upload/single?key=${ek}&b=${b}`, blob, mime, (n) => onProgress?.(n / blob.size));
  } else {
    const ps = s.partSize || 9.5 * 1024 * 1024;
    const n = Math.ceil(blob.size / ps);
    const parts = [];
    for (let i = 1; i <= n; i++) {
      const off = (i - 1) * ps;
      let tries = 0;
      for (;;) {
        try {
          const r = await xhrPut(`${API}/v1/upload/part?key=${ek}&b=${b}&uploadId=${encodeURIComponent(s.uploadId)}&n=${i}`,
            blob.slice(off, Math.min(off + ps, blob.size)), "application/octet-stream", (x) => onProgress?.((off + x) / blob.size));
          parts.push({ partNumber: i, etag: r.etag });
          break;
        } catch (e) { if (++tries >= 4 || (e.status >= 400 && e.status < 500)) throw e; await new Promise((r) => setTimeout(r, 1500 * tries)); }
      }
    }
    await post("/v1/upload/complete", { key, b, uploadId: s.uploadId, parts });
  }
  onProgress?.(1);
  return { key, b };
}

/** Files people can share (purpose "file") — the server's list, by extension for browsers that leave file.type empty. */
export const FILE_MIMES = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  epub: "application/epub+zip", wav: "audio/wav", flac: "audio/flac", apk: "application/vnd.android.package-archive",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg",
};
export const MEDIA_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];
export function fileMime(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const byType = file.type && (Object.values(FILE_MIMES).includes(file.type) || MEDIA_MIMES.includes(file.type)) ? file.type : null;
  if (file.type === "audio/x-wav" || file.type === "audio/wave") return "audio/wav";
  if (file.type === "audio/x-flac") return "audio/flac";
  if (file.type === "application/x-zip-compressed") return "application/zip";
  return byType || FILE_MIMES[ext] || null;
}

/** Fresh client-side id for messages (same alphabet/length as the app). */
export function newId(n = 20) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, (x) => a[x % a.length]).join("");
}

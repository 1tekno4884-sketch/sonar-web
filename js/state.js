// Shared state + a tiny event bus. Modules talk through events so they stay independent:
//   "chats" (list changed) · "chat:<id>" (one chat's messages/meta changed) · "settings" · "me" · "route" · "call"
import { get, items } from "./api.js";

export const state = {
  me: null,            // public User JSON (+ private fields from /v1/me)
  role: null,
  owner: false,
  config: null,
  chats: new Map(),    // id → Chat JSON
  chatsLoaded: false,
  msgs: new Map(),     // chatId → { byId: Map, cursor: 0, loaded: bool }
  starred: new Set(),  // message ids I starred
  users: new Map(),    // uid → User (public) cache
  openChat: null,      // chat id open in the main pane
  lineUp: false,
};

const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { const f = (e) => fn(e.detail); bus.addEventListener(name, f); return () => bus.removeEventListener(name, f); }

export const myId = () => state.me?.id || null;

/** Public profile by uid (cached for 5 minutes). */
const userTs = new Map();
const inflight = new Map();
export async function user(uid, fresh = false) {
  if (!uid) return null;
  if (!fresh && state.users.has(uid) && Date.now() - (userTs.get(uid) || 0) < 300_000) return state.users.get(uid);
  if (inflight.has(uid)) return inflight.get(uid);
  const p = get(`/v1/users/${encodeURIComponent(uid)}`).then((u) => { state.users.set(uid, u); userTs.set(uid, Date.now()); return u; })
    .catch(() => state.users.get(uid) || null).finally(() => inflight.delete(uid));
  inflight.set(uid, p);
  return p;
}
/** Seed the cache from chat member snapshots ({id, username, name, avatar, badges}). */
export function seedUser(u) {
  if (!u?.id) return;
  const cur = state.users.get(u.id);
  if (!cur) state.users.set(u.id, { id: u.id, username: u.username, displayName: u.name ?? u.displayName, avatar: u.avatar, badges: u.badges || {}, lastActive: u.lastActive, showActivity: u.showActivity, _partial: true });
}
export const userName = (u) => u?.displayName || u?.name || u?.username || "Someone";

export async function loadConfig() {
  try { state.config = await get("/v1/config"); } catch { state.config = state.config || {}; }
  return state.config;
}
export { items };

// Chats tab: the chat list (pinned / muted / archived / requests / groups), the conversation, live updates
// (Line WebSocket + light polling fallback), notifications, unread counts and message actions.
import { get, post, patch, items, fetchBlob, mediaUrl, upload, newId } from "./api.js";
import { h, icon, iconBtn, toast, errText, modal, closeModal, menu, confirmBox, promptBox, avatar, badges, enc, listTime, dayLabel, lastSeen, debounce, $ } from "./dom.js";
import { state, emit, on, myId, user, seedUser, userName } from "./state.js";
import { getS, setS, chatPref, setChatPref, isMuted, nickname } from "./settings.js";
import { onLine } from "./line.js";
import { ui, setBadge, mainEmpty, backBtn } from "./layout.js";
import { renderMessage, runInfo } from "./messages.js";
import { createComposer } from "./composer.js";
import { openViewer } from "./media.js";
import { mountWallpaper } from "./wallpaper.js";
import { notify, setUnread, pingSound, askPermission, permission, canNotify } from "./notify.js";
import { startCall } from "./calls.js";
import { isChannel, isChannelAdmin, chanMark, channelInfo, leaveChannel, fetchChannel, channelCached, subsText, channelWebLink, renderDiscover, renderChannelRoute, newChannelModal } from "./channels.js";

// ------------------------------------------------------------------ helpers
const isGroup = (c) => c.type === "group";
/** Channels: only admins post (subscribers read + react). */
const canPost = (c) => !isChannel(c) || isChannelAdmin(c);
const others = (c) => (c.members || []).filter((u) => u !== myId());
const memberUser = (c, uid) => (c.memberUsers || []).find((u) => u.id === uid);
export function chatTitle(c) {
  if (!c) return "Chat";
  if (isChannel(c)) return c.name || "Channel";
  if (isGroup(c)) return c.name || (c.memberUsers || []).filter((u) => u.id !== myId()).map((u) => u.name || u.username).slice(0, 3).join(", ") || "Group";
  const o = others(c)[0] || myId();
  const u = memberUser(c, o);
  return nickname(o, c.id) || u?.name || u?.username || "Chat";
}
function chatAvatar(c, size = "") {
  if (isGroup(c) || isChannel(c)) return avatar(c.photo, chatTitle(c), size);
  const u = memberUser(c, others(c)[0]);
  const a = avatar(u?.avatar, chatTitle(c), size);
  if (u && u.showActivity !== false && u.lastActive && Date.now() - u.lastActive < 3 * 60_000) return h("span", { class: "online", "aria-label": "Active now" }, a);
  return a;
}
const isRequest = (c) => c.status === "request" && c.createdBy !== myId();
const LREAD = "sonar_localread";
let localRead = {};
try { localRead = JSON.parse(localStorage.getItem(LREAD) || "{}"); } catch {}
const readAt = (c) => Math.max(Number((c.reads || {})[myId()] || 0), Number(localRead[c.id] || 0));
export function isUnread(c) {
  const l = c.lastMessage;
  return !!chatPref(c.id).markedUnread || (!!l && l.senderId !== myId() && Number(l.at || c.updatedAt) > readAt(c));
}
function typingIn(c) {
  if (isChannel(c)) return [];
  const t = c.typing || {};
  return Object.entries(t).filter(([u, at]) => u !== myId() && Date.now() - Number(at) < 6000).map(([u]) => u);
}
const names = (c) => (uid) => {
  if (uid === myId()) return "You";
  const u = memberUser(c, uid) || state.users.get(uid);
  return nickname(uid, c.id) || u?.name || u?.displayName || u?.username || "Someone";
};

// ------------------------------------------------------------------ data: chats + messages
let listTimer = null, openTimer = null, started = false;
const lastAt = new Map();   // chatId → lastMessage.at we've seen (for notifications)
let firstLoad = true;

export async function loadChats() {
  try {
    const j = await get("/v1/chats");
    const fresh = new Map(items(j).map((c) => [c.id, c]));
    for (const c of fresh.values()) {
      (c.memberUsers || []).forEach(seedUser);
      const l = c.lastMessage;
      const prev = lastAt.get(c.id);
      // (a channel you just subscribed to isn't news)
      if (!firstLoad && l && l.senderId !== myId() && Number(l.at) > Number(prev || 0) && !(isChannel(c) && prev === undefined)) maybeNotify(c);
      if (l) lastAt.set(c.id, Number(l.at));
    }
    state.chats = fresh; state.chatsLoaded = true; firstLoad = false;
    emit("chats");
    if (state.openChat && fresh.has(state.openChat)) emit("chat:" + state.openChat, { meta: true });
  } catch (e) { if (!state.chatsLoaded) emit("chats", { error: errText(e) }); }
  updateUnread();
}
const loadChatsSoon = debounce(loadChats, 400);

function bucket(id) {
  if (!state.msgs.has(id)) state.msgs.set(id, { byId: new Map(), cursor: 0, loaded: false });
  return state.msgs.get(id);
}
export async function loadMessages(id) {
  const b = bucket(id);
  try {
    const j = await get(`/v1/chats/${enc(id)}/messages?limit=300${b.loaded && b.cursor ? `&after=${b.cursor}` : ""}`);
    const its = items(j);
    let changed = !b.loaded;
    for (const m of its) {
      // replace a pending copy with the server's
      b.byId.set(m.id, m); changed = true;
      b.cursor = Math.max(b.cursor, Number(m.updatedAt || m.createdAt || 0));
    }
    if (j.cursor) b.cursor = Math.max(b.cursor, Number(j.cursor) || 0);
    b.loaded = true;
    if (changed) emit("chat:" + id, { msgs: true });
  } catch (e) { if (!b.loaded) emit("chat:" + id, { error: errText(e) }); }
}
async function loadChatMeta(id) {
  try { const c = await get(`/v1/chats/${enc(id)}`); state.chats.set(id, c); (c.memberUsers || []).forEach(seedUser); emit("chat:" + id, { meta: true }); } catch {}
}
async function loadStarred(id) {
  try { const j = await get(`/v1/me/starred?chat=${enc(id)}`); for (const m of items(j)) state.starred.add(m.id); emit("chat:" + id, { msgs: true }); } catch {}
}

function schedule() {
  clearTimeout(listTimer); clearTimeout(openTimer);
  if (!started) return;
  const vis = !document.hidden;
  listTimer = setTimeout(async () => { await loadChats(); schedule(); }, vis ? (state.lineUp ? 30_000 : 12_000) : 60_000);
  if (state.openChat) openTimer = setTimeout(async () => {
    const id = state.openChat;
    if (id) await Promise.all([loadMessages(id), loadChatMeta(id)]);
    schedule();
  }, vis ? (state.lineUp ? 6_000 : 4_000) : 25_000);
}

export function initChats() {
  if (started) return;
  started = true; firstLoad = true;
  loadChats().then(schedule);
  offs.push(onLine("msg", (ev) => {
    if (ev.chat === state.openChat) loadMessages(ev.chat);
    loadChatsSoon();
  }));
  offs.push(on("line", () => schedule()));
  offs.push(on("settings", () => { emit("chats"); updateUnread(); }));
}
const offs = [];
export function stopChats() { started = false; clearTimeout(listTimer); clearTimeout(openTimer); offs.splice(0).forEach((f) => f()); firstLoad = true; lastAt.clear(); }
document.addEventListener("visibilitychange", () => {
  if (!started) return;
  if (!document.hidden) { loadChats(); if (state.openChat) { loadMessages(state.openChat); markRead(state.openChat); } }
  schedule();
});

// ------------------------------------------------------------------ unread, title, notifications
const unreadCounts = new Map(); // chatId → {at, n}
function updateUnread() {
  let n = 0;
  for (const c of state.chats.values()) if (isUnread(c) && !isMuted(c.id) && !chatPref(c.id).archived && !isRequest(c)) n++;
  setBadge("chats", n);
  setUnread(n);
}
async function unreadCount(c) {
  const l = c.lastMessage, key = Number(l?.at || 0);
  const cached = unreadCounts.get(c.id);
  if (cached && cached.at === key) return cached.n;
  const b = state.msgs.get(c.id);
  const ra = readAt(c);
  let n;
  if (b?.loaded) n = [...b.byId.values()].filter((m) => m.senderId !== myId() && m.createdAt > ra && !m.deleted).length;
  else {
    try { const j = await get(`/v1/chats/${enc(c.id)}/messages?after=${ra}&limit=100`); n = items(j).filter((m) => m.senderId !== myId() && m.createdAt > ra).length; }
    catch { n = 1; }
  }
  unreadCounts.set(c.id, { at: key, n: Math.max(1, n) });
  return Math.max(1, n);
}
function maybeNotify(c) {
  const viewing = state.openChat === c.id && !document.hidden && document.hasFocus();
  if (viewing || isMuted(c.id)) return;
  const l = c.lastMessage;
  // silent messages carry no notification; the list preview still updates
  const b = state.msgs.get(c.id);
  const latest = b && [...b.byId.values()].sort((a, z) => z.createdAt - a.createdAt)[0];
  if (latest && latest.createdAt === l.at && latest.x?.silent) return;
  const mode = getS("notifications.preview");
  const from = names(c)(l.senderId);
  const title = isGroup(c) || isChannel(c) ? chatTitle(c) : from;
  const body = isChannel(c) ? (mode === "Hidden" || mode === "Sender" ? "New post" : l.text || "New post") : mode === "Hidden" ? "New message" : mode === "Sender" ? (isGroup(c) ? `${from} sent a message` : "Sent you a message") : `${isGroup(c) ? from + ": " : ""}${l.text || "New message"}`;
  if (document.hidden || !document.hasFocus()) notify(title, body, { tag: "chat-" + c.id, kind: "message", onclick: () => (location.hash = `#/chat/${enc(c.id)}`) });
  if (!document.hidden) pingSound();
}
async function markRead(id) {
  const c = state.chats.get(id);
  if (!c || document.hidden) return;
  const l = c.lastMessage;
  const pref = chatPref(id);
  if (pref.markedUnread) setChatPref(id, { markedUnread: false });
  if (!l || readAt(c) >= Number(l.at || 0)) return;
  localRead[id] = Date.now();
  try { localStorage.setItem(LREAD, JSON.stringify(localRead)); } catch {}
  unreadCounts.delete(id);
  updateUnread(); emit("chats");
  if (isRequest(c)) return;   // reading a request doesn't tell them
  if (isChannel(c) && !isChannelAdmin(c)) return;   // subscribers' reads stay in this browser (the server ignores them)
  if (getS("privacy.readReceipts") !== false && !getS("privacy.ghostMode")) post(`/v1/chats/${enc(id)}/read`).catch(() => {});
}

// ------------------------------------------------------------------ chat list (list pane)
let filter = "all", listEl = null, listQuery = "";
function visibleChats() {
  const all = [...state.chats.values()];
  const q = listQuery.trim().toLowerCase();
  let out = all.filter((c) => {
    const p = chatPref(c.id);
    if (q) return chatTitle(c).toLowerCase().includes(q);
    if (filter === "requests") return isRequest(c);
    if (filter === "archived") return !!p.archived;
    if (isRequest(c) || p.archived) return false;
    if (filter === "unread") return isUnread(c);
    if (filter === "groups") return isGroup(c);
    if (filter === "channels") return isChannel(c);
    return true;
  });
  const sort = getS("chat.sort");
  const at = (c) => Number(c.lastMessage?.at || c.updatedAt || 0);
  out.sort((a, b) => {
    if (sort === "Alpha") return chatTitle(a).localeCompare(chatTitle(b));
    if (sort !== "Recent") { const pa = chatPref(a.id).pinned ? 1 : 0, pb = chatPref(b.id).pinned ? 1 : 0; if (pa !== pb) return pb - pa; }
    if (sort === "UnreadFirst") { const ua = isUnread(a) ? 1 : 0, ub = isUnread(b) ? 1 : 0; if (ua !== ub) return ub - ua; }
    return at(b) - at(a);
  });
  return out;
}
/** Alt+↑ / Alt+↓: the chat above/below the open one in the list. */
export function adjacentChat(dir) {
  const list = visibleChats();
  if (!list.length) return null;
  const i = list.findIndex((c) => c.id === state.openChat);
  return list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + dir))]?.id;
}

function chatRow(c) {
  const p = chatPref(c.id);
  const unread = isUnread(c);
  const l = c.lastMessage;
  const typing = typingIn(c);
  const showPv = getS("chat.showPreviews") !== false;
  const ch = isChannel(c);
  const pv = typing.length ? h("span", { class: "pv typing" }, isGroup(c) ? `${names(c)(typing[0])} is typing…` : "typing…")
    : h("span", { class: "pv" }, !l ? (isRequest(c) ? "Wants to message you" : "No messages yet") : !showPv ? (unread ? "New message" : "") : `${l.senderId === myId() ? "You: " : ch ? "" : isGroup(c) ? names(c)(l.senderId).split(" ")[0] + ": " : ""}${l.text || ""}`);
  const count = h("span", { class: "count" + (isMuted(c.id) ? " muted" : ""), hidden: !unread });
  if (unread) { count.textContent = "•"; unreadCount(c).then((n) => { count.textContent = n > 99 ? "99+" : String(n); }); }
  const u = !isGroup(c) && !ch ? memberUser(c, others(c)[0]) : null;
  const more = iconBtn("more", `Options for ${chatTitle(c)}`, (e) => { e.preventDefault(); e.stopPropagation(); chatMenu(c, e.currentTarget); }, "more-btn");
  const row = h("a", { class: "rowbtn" + (unread ? " unread" : ""), href: `#/chat/${enc(c.id)}`, "data-chat": c.id, "aria-current": String(state.openChat === c.id),
    "aria-label": `${chatTitle(c)}${ch ? ", channel" : ""}${unread ? ", unread" : ""}${p.pinned ? ", pinned" : ""}${isMuted(c.id) ? ", muted" : ""}` },
    chatAvatar(c),
    h("div", { class: "body" },
      h("div", { class: "l1" }, h("span", { class: "name" }, h("span", { class: "t" }, chatTitle(c)), u ? badges(u.badges, { dev: false }) : null, ch ? chanMark() : null),
        h("span", { class: "flags" }, p.pinned ? icon("pin") : null, isMuted(c.id) ? icon("bellOff") : null),
        h("span", { class: "time" }, listTime(l?.at || c.updatedAt))),
      h("div", { class: "l2" }, pv, count)),
    more);
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); chatMenu(c, null, { x: e.clientX, y: e.clientY }); });
  return row;
}

function muteMenu(c, anchor) {
  const set = (ms) => { setChatPref(c.id, { muteUntil: ms === Infinity ? 9223372036854775807 : Date.now() + ms }); toast("Muted"); };
  menu(anchor || { x: innerWidth / 2, y: innerHeight / 3 }, [
    { label: "For 1 hour", onclick: () => set(36e5) }, { label: "For 8 hours", onclick: () => set(8 * 36e5) },
    { label: "For 1 week", onclick: () => set(7 * 864e5) }, { label: "Until I unmute", onclick: () => set(Infinity) }], { label: "Mute for" });
}
function chatMenu(c, anchor, point) {
  const p = chatPref(c.id);
  menu(anchor || point, [
    { label: p.pinned ? "Unpin chat" : "Pin chat", icon: "pin", onclick: () => setChatPref(c.id, { pinned: !p.pinned }) },
    isMuted(c.id) ? { label: "Unmute", icon: "bell", onclick: () => setChatPref(c.id, { muteUntil: 0 }) } : { label: "Mute…", icon: "bellOff", onclick: () => muteMenu(c, anchor) },
    { label: p.archived ? "Unarchive" : "Archive", icon: "archive", onclick: () => { setChatPref(c.id, { archived: !p.archived }); toast(p.archived ? "Moved back to chats" : "Archived"); } },
    isUnread(c) ? { label: "Mark as read", icon: "check", onclick: () => { setChatPref(c.id, { markedUnread: false }); localRead[c.id] = Date.now(); try { localStorage.setItem(LREAD, JSON.stringify(localRead)); } catch {} if (getS("privacy.readReceipts") !== false && !getS("privacy.ghostMode") && !isRequest(c)) post(`/v1/chats/${enc(c.id)}/read`).catch(() => {}); updateUnread(); emit("chats"); } }
      : { label: "Mark as unread", icon: "unread", onclick: () => { setChatPref(c.id, { markedUnread: true }); updateUnread(); } },
    isChannel(c) ? "-" : null,
    isChannel(c) ? { label: "Channel info", icon: "info", onclick: () => channelInfo(c) } : null,
    isChannel(c) && c.createdBy !== myId() ? { label: "Leave channel", icon: "logout", danger: true, onclick: () => leaveChannel(c) } : null,
  ], { label: "Chat options" });
}

function renderList(el) {
  listEl = el;
  const chips = h("div", { class: "chips", role: "toolbar", "aria-label": "Filter chats" });
  const body = h("div", { class: "pane-body" });
  const search = h("input", { type: "search", placeholder: "Search chats", "aria-label": "Search chats", value: listQuery });
  search.addEventListener("input", () => { listQuery = search.value; paint(); });
  const notifBanner = h("div");
  const lineNote = h("div", { class: "line-off", hidden: true, role: "status" }, "Reconnecting… (updates may be a little slower)");
  const paintBanner = () => {
    notifBanner.replaceChildren();
    if (!canNotify() || permission() !== "default" || localStorage.getItem("sonar_notif_dismissed")) return;
    notifBanner.append(h("div", { class: "banner-note" }, icon("bell"), h("span", { class: "grow" }, "Get notified about new messages and calls while Sonar is open."),
      h("button", { class: "small", onclick: async () => { await askPermission(); paintBanner(); } }, "Turn on"),
      iconBtn("close", "Dismiss", () => { try { localStorage.setItem("sonar_notif_dismissed", "1"); } catch {} paintBanner(); })));
  };
  const paint = () => {
    const reqs = [...state.chats.values()].filter(isRequest).length;
    const arch = [...state.chats.values()].filter((c) => chatPref(c.id).archived).length;
    chips.replaceChildren(...[["all", "All"], ["unread", "Unread"], ["groups", "Groups"], ["channels", "Channels"], ["requests", `Requests${reqs ? ` (${reqs})` : ""}`], ...(arch || filter === "archived" ? [["archived", "Archived"]] : [])]
      .map(([id, label]) => h("button", { class: "chip" + (filter === id ? " on" : ""), "aria-pressed": String(filter === id), onclick: () => { filter = id; paint(); } }, label)));
    if (!state.chatsLoaded) { body.replaceChildren(h("div", { class: "empty" }, "Loading chats…")); return; }
    const list = visibleChats();
    const discover = filter === "channels" && !listQuery ? h("a", { class: "rowbtn discover-row", href: "#/channels" },
      h("span", { class: "avatar", "aria-hidden": "true" }, icon("megaphone")),
      h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, "Discover channels")), h("div", { class: "l2" }, h("span", { class: "pv" }, "Find channels to follow, or start your own")))) : null;
    body.replaceChildren(discover, list.length ? h("div", { class: "rows", role: "list" }, list.map((c) => h("div", { role: "listitem" }, chatRow(c))))
      : h("div", { class: "empty" }, listQuery ? "No chats match" : filter === "channels" ? "You haven't subscribed to any channels yet." : filter === "requests" ? "No message requests" : filter === "unread" ? "You're all caught up" : filter === "archived" ? "Nothing archived" : "No chats yet — find someone in People and say hi 👋"));
    lineNote.hidden = state.lineUp || !state.chatsLoaded;
  };
  el.append(
    h("div", { class: "pane-head" }, h("h1", {}, "Chats"),
      iconBtn("search", "Search everything (Ctrl+K)", () => import("./app.js").then((m) => m.openSearch())),
      iconBtn("megaphone", "Discover channels", () => (location.hash = "#/channels")),
      iconBtn("plus", "New chat", (e) => newChatMenu(e.currentTarget))),
    h("div", { class: "searchbox" }, icon("search"), search),
    h("div", { style: "padding:0 14px" }, chips), notifBanner, lineNote, body);
  paintBanner(); paint();
  const offA = on("chats", paint), offB = on("line", paint), offC = on("route", () => {
    for (const r of el.querySelectorAll("[data-chat]")) r.setAttribute("aria-current", String(r.dataset.chat === state.openChat));
  });
  // typing indicators expire — repaint every few seconds while something is typing
  const tick = setInterval(() => { if ([...state.chats.values()].some((c) => typingIn(c).length) || el.querySelector(".typing")) paint(); }, 3000);
  el._cleanup = () => { offA(); offB(); offC(); clearInterval(tick); };
}

function newChatMenu(anchor) {
  menu(anchor, [
    { label: "New message", icon: "chat", onclick: () => pickPeople({ title: "New message", multi: false, then: async ([u]) => { try { const c = await post("/v1/chats/dm", { uid: u.id }); state.chats.set(c.id, c); location.hash = `#/chat/${enc(c.id)}`; loadChats(); } catch (e) { toast(errText(e)); } } }) },
    { label: "New group", icon: "people", onclick: () => pickPeople({ title: "New group", multi: true, group: true, then: async (us, name) => {
      try { const c = await post("/v1/chats/group", { name: name || us.map((u) => u.displayName || u.username).slice(0, 3).join(", "), members: us.map((u) => u.id) }); state.chats.set(c.id, c); location.hash = `#/chat/${enc(c.id)}`; loadChats(); }
      catch (e) { toast(errText(e)); }
    } }) },
    { label: "New channel", icon: "megaphone", onclick: () => newChannelModal() },
    { label: "Discover channels", icon: "search", onclick: () => (location.hash = "#/channels") },
  ], { label: "New chat" });
}

/** People picker: search by name/username (+ people you follow). */
export function pickPeople({ title, multi, group = false, then, okLabel }) {
  const picked = new Map();
  const nameInp = group ? h("input", { placeholder: "Group name (optional)", "aria-label": "Group name", maxlength: "60" }) : null;
  const q = h("input", { type: "search", placeholder: "Search people", "aria-label": "Search people", autocomplete: "off" });
  const res = h("div", { class: "picklist", role: "list" });
  const chosen = h("div", { class: "chips" });
  const go = h("button", { disabled: true }, okLabel || (group ? "Create group" : "Chat"));
  const paintChosen = () => { chosen.replaceChildren(...[...picked.values()].map((u) => h("button", { class: "chip on", onclick: () => { picked.delete(u.id); paintChosen(); paint(lastList); } }, u.displayName || u.username, " ✕"))); go.disabled = !picked.size; };
  let lastList = [];
  const paint = (list) => {
    lastList = list;
    res.replaceChildren(...(list.length ? list.map((u) => {
      if (multi) {
        const cb = h("input", { type: "checkbox", checked: picked.has(u.id), onchange: () => { if (cb.checked) { if (picked.size >= 49) { cb.checked = false; return toast("Groups can have up to 50 people"); } picked.set(u.id, u); } else picked.delete(u.id); paintChosen(); } });
        return h("label", { role: "listitem" }, cb, avatar(u.avatar, u.displayName, "sm"), h("span", { class: "name" }, u.displayName || u.username, badges(u.badges, { dev: false })), h("span", { class: "meta" }, "@" + u.username));
      }
      return h("button", { class: "rowbtn", role: "listitem", onclick: () => { closeModal(); then([u]); } }, avatar(u.avatar, u.displayName, "sm"), h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, u.displayName || u.username, badges(u.badges, { dev: false }))), h("div", { class: "l2" }, "@" + u.username)));
    }) : [h("div", { class: "meta", style: "padding:8px" }, q.value.trim() ? "Nobody found" : "Type a name or @username")]));
  };
  let seq = 0;
  const run = debounce(async () => {
    const s = q.value.trim().replace(/^@/, ""), my = ++seq;
    if (s.length < 2) { paint(await following()); return; }
    const r = await get(`/v1/search?q=${enc(s)}`).catch(() => ({}));
    if (my === seq) paint((r.users || []).filter((u) => u.id !== myId()));
  }, 250);
  q.addEventListener("input", run);
  go.onclick = () => { closeModal(); then([...picked.values()], nameInp?.value.trim()); };
  modal([h("h2", {}, title), h("div", { class: "stack" }, nameInp, q, multi ? chosen : null, res, multi ? h("div", { class: "row end" }, go) : null)], { label: title });
  following().then((l) => { if (!q.value) paint(l); });
}
let followingCache = null;
async function following() {
  if (followingCache && Date.now() - followingCache.at < 120_000) return followingCache.list;
  try { const j = await get(`/v1/users/${enc(myId())}/following`); followingCache = { at: Date.now(), list: items(j).filter((u) => u?.id) }; return followingCache.list; }
  catch { return []; }
}

// ------------------------------------------------------------------ conversation (main pane)
let pendingJump = null;
export function openChatById(id, msgId) { pendingJump = msgId || null; if (state.openChat === id && msgId) jumpTo?.(msgId); else location.hash = `#/chat/${enc(id)}`; }
let jumpTo = null;
let activeComposer = null;

function seenBy(c) {
  return (m) => {
    if (getS("privacy.readReceipts") === false) return false;   // you only see receipts if you send them (like the app)
    if (isChannel(c)) return false;                               // subscribers' reads aren't shared
    const rs = c.reads || {};
    const os = others(c);
    if (!os.length) return false;
    return isGroup(c) ? os.every((u) => Number(rs[u] || 0) >= m.createdAt) : Number(rs[os[0]] || 0) >= m.createdAt;
  };
}

async function sendBody(chatId, body, optimistic = true) {
  const b = bucket(chatId);
  const id = body.id || (body.id = newId());
  if (optimistic) {
    b.byId.set(id, { id, chatId, senderId: myId(), type: body.type || "text", text: body.text || "", media: body.media || null, replyTo: body.replyTo || null,
      createdAt: Date.now(), reactions: {}, x: Object.fromEntries(["silent", "fwd", "sticker", "file", "album", "poll", "link", "quote"].filter((k) => body[k]).map((k) => [k, body[k]])), gif: body.gif || null, _pending: true });
    emit("chat:" + chatId, { msgs: true, mine: true });
  }
  try {
    const m = await post(`/v1/chats/${enc(chatId)}/messages`, body);
    b.byId.set(m.id, m);
    b.cursor = Math.max(b.cursor, Number(m.updatedAt || 0));
    emit("chat:" + chatId, { msgs: true, mine: true });
    loadChatsSoon();
    return m;
  } catch (e) {
    const p = b.byId.get(id);
    if (p) { p._pending = false; p._failed = true; p._body = body; }
    emit("chat:" + chatId, { msgs: true });
    toast(errText(e));
    throw e;
  }
}

async function forwardModal(m) {
  const picked = new Set();
  const list = [...state.chats.values()].filter((c) => !isRequest(c) && canPost(c)).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  const go = h("button", { disabled: true }, "Forward");
  const rows = h("div", { class: "picklist" }, list.map((c) => {
    const cb = h("input", { type: "checkbox", onchange: () => { if (cb.checked) { if (picked.size >= 5) { cb.checked = false; return toast("Forward to up to 5 chats"); } picked.add(c.id); } else picked.delete(c.id); go.disabled = !picked.size; go.textContent = picked.size ? `Forward to ${picked.size}` : "Forward"; } });
    return h("label", {}, cb, chatAvatar(c, "sm"), h("span", { class: "name" }, chatTitle(c)));
  }));
  go.onclick = async () => {
    go.disabled = true; go.textContent = "Forwarding…";
    let ok = 0;
    for (const id of picked) {
      try {
        const body = { type: m.type, text: m.text || "", fwd: true };
        if (m.gif) body.gif = m.gif; if (m.postRef) body.postRef = m.postRef;
        for (const k of ["sticker", "file", "poll", "link"]) if (m.x?.[k]) body[k] = k === "poll" ? { q: m.x.poll.q, options: m.x.poll.options, multi: m.x.poll.multi, anon: m.x.poll.anon } : m.x[k];
        const reup = async (md) => {
          if (!md) return md;
          if (md.key.startsWith(`u/${myId()}/`) && md.key.split("/")[3] === id) return md;
          // someone else's (or another chat's) file: copy it into the target chat
          const blob = await fetchBlob(`/m/${md.key}`);
          const purpose = md.kind === "voice" ? "voice" : md.kind === "file" ? "file" : "chat";
          const r = await upload(blob, { purpose, scope: id, mime: md.mime || blob.type });
          return { ...md, key: r.key, b: r.b, thumb: undefined, tb: undefined };
        };
        if (m.media) body.media = await reup(m.media);
        if (m.x?.album) body.album = await Promise.all(m.x.album.map(reup));
        if (body.sticker?.key && body.sticker.pack === "custom") { /* custom stickers are readable by anyone signed in — keep the key */ }
        await sendBody(id, body, false); ok++;
      } catch (e) { toast(errText(e)); }
    }
    closeModal(); if (ok) toast(`Forwarded to ${ok} chat${ok > 1 ? "s" : ""}`);
  };
  modal([h("h2", {}, "Forward to…"), h("p", { class: "meta" }, "Pick up to 5 chats."), rows, h("div", { class: "row end", style: "margin-top:10px" }, go)], { label: "Forward" });
}

function scheduledModal(c) {
  const box = h("div", { class: "stack" }, h("div", { class: "meta" }, "Loading…"));
  const load = async () => {
    try {
      const j = await get("/v1/me/scheduled");
      const its = items(j).filter((s) => s.chatId === c.id);
      box.replaceChildren(...(its.length ? its.map((s) => h("div", { class: "setting" },
        h("div", { class: "grow" }, h("div", {}, s.body?.text || s.body?.type || "Message"), h("div", { class: "meta" }, new Date(s.at).toLocaleString())),
        iconBtn("edit", "Edit text", async () => { const t = await promptBox("Edit scheduled message", { value: s.body?.text || "", multiline: true }); if (t != null) { await patch(`/v1/scheduled/${enc(s.id)}`, { text: t }).catch((e) => toast(errText(e))); scheduledModal(c); } }),
        iconBtn("trash", "Cancel this message", async () => { await import("./api.js").then((a) => a.del(`/v1/scheduled/${enc(s.id)}`)).catch((e) => toast(errText(e))); load(); })))
        : [h("div", { class: "empty" }, "Nothing scheduled in this chat")]));
    } catch (e) { box.replaceChildren(h("div", { class: "err" }, errText(e))); }
  };
  modal([h("h2", {}, "Scheduled messages"), box], { label: "Scheduled messages" });
  load();
}
function starredModal(c) {
  const box = h("div", { class: "stack" }, h("div", { class: "meta" }, "Loading…"));
  modal([h("h2", {}, "Starred messages"), box], { label: "Starred messages", wide: true });
  get(`/v1/me/starred?chat=${enc(c.id)}`).then((j) => {
    const its = items(j);
    box.replaceChildren(...(its.length ? its.map((m) => h("button", { class: "rowbtn", onclick: () => { closeModal(); jumpTo?.(m.id); } },
      h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, names(c)(m.senderId)), h("span", { class: "time" }, listTime(m.createdAt))), h("div", { class: "l2" }, h("span", { class: "pv" }, m.text || m.type)))))
      : [h("div", { class: "empty" }, "No starred messages yet. Use ★ Star on any message.")]));
  }, (e) => box.replaceChildren(h("div", { class: "err" }, errText(e))));
}
function groupInfo(c) {
  const admin = (c.admins || []).includes(myId());
  const list = h("div", { class: "picklist" });
  const paintMembers = () => list.replaceChildren(...(c.memberUsers || []).map((u) => h("div", { class: "row", style: "padding:6px" },
    avatar(u.avatar, u.name, "sm"), h("a", { class: "name grow", href: `#/u/${enc(u.username)}`, onclick: () => closeModal() }, u.name || u.username, badges(u.badges, { dev: false })),
    (c.admins || []).includes(u.id) ? h("span", { class: "chip" }, "Admin") : null,
    admin && u.id !== myId() ? iconBtn("more", `Options for ${u.name}`, (e) => menu(e.currentTarget, [
      { label: (c.admins || []).includes(u.id) ? "Remove admin" : "Make admin", onclick: async () => { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { admin: { uid: u.id, on: !(c.admins || []).includes(u.id) } })); paintMembers(); } catch (e2) { toast(errText(e2)); } } },
      { label: "Remove from group", danger: true, onclick: async () => { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { removeMember: u.id })); paintMembers(); } catch (e2) { toast(errText(e2)); } } },
    ])) : null)));
  paintMembers();
  const invite = admin ? h("div", { class: "setting" }, h("div", { class: "grow" }, h("b", {}, "Invite link"), h("div", { class: "meta" }, c.inviteOn ? "Anyone with the link can ask to join" : "Off")),
    c.inviteOn && c.inviteCode ? h("button", { class: "small tonal", onclick: () => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/invite/${c.inviteCode}`); toast("Link copied"); } }, "Copy") : null,
    h("button", { class: "small", onclick: async () => { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { invite: !c.inviteOn })); closeModal(); groupInfo(c); } catch (e) { toast(errText(e)); } } }, c.inviteOn ? "Turn off" : "Turn on")) : null;
  const reqs = admin && (c.joinRequests || []).length ? h("div", { class: "stack" }, h("h3", {}, "Join requests"), ...(c.joinRequests || []).map((uid) => {
    const row = h("div", { class: "row" }, h("span", { class: "grow" }, "…"),
      h("button", { class: "small", onclick: async () => { await patch(`/v1/chats/${enc(c.id)}`, { approve: uid }).catch((e) => toast(errText(e))); row.remove(); loadChatMeta(c.id); } }, "Approve"),
      h("button", { class: "small tonal", onclick: async () => { await patch(`/v1/chats/${enc(c.id)}`, { deny: uid }).catch((e) => toast(errText(e))); row.remove(); } }, "Deny"));
    user(uid).then((u) => { row.firstChild.textContent = u ? `${u.displayName} (@${u.username})` : uid; });
    return row;
  })) : null;
  modal([h("div", { class: "row" }, chatAvatar(c, "lg"), h("div", { class: "grow" }, h("h2", {}, chatTitle(c)), h("div", { class: "meta" }, `${(c.members || []).length} members`))),
    c.description ? h("p", {}, c.description) : null,
    h("div", { class: "row", style: "margin:10px 0" },
      admin ? h("button", { class: "tonal small", onclick: async () => { const n = await promptBox("Group name", { value: c.name || "" }); if (n != null) { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { name: n })); loadChats(); toast("Renamed"); } catch (e) { toast(errText(e)); } } } }, "Rename") : null,
      admin ? h("button", { class: "tonal small", onclick: () => { closeModal(); pickPeople({ title: "Add people", multi: true, okLabel: "Add", then: async (us) => { try { await patch(`/v1/chats/${enc(c.id)}`, { addMembers: us.map((u) => u.id) }); loadChatMeta(c.id); toast("Added"); } catch (e) { toast(errText(e)); } } }); } }, "Add people") : null,
      h("button", { class: "danger small", onclick: async () => { if (await confirmBox("Leave this group?", "You'll stop getting its messages.", "Leave", true)) { try { await patch(`/v1/chats/${enc(c.id)}`, { leave: true }); state.chats.delete(c.id); location.hash = "#/chats"; loadChats(); } catch (e) { toast(errText(e)); } } } }, "Leave group")),
    invite, reqs, h("h3", {}, "Members"), list], { label: "Group info", wide: true });
}

function convMenu(c, anchor) {
  const p = chatPref(c.id);
  const ch = isChannel(c);
  const other = !isGroup(c) && !ch ? memberUser(c, others(c)[0]) : null;
  const canDisappear = !ch && (!isGroup(c) || (c.admins || []).includes(myId()));
  menu(anchor, [
    other ? { label: "View profile", icon: "user", onclick: () => (location.hash = `#/u/${enc(other.username)}`) }
      : ch ? { label: isChannelAdmin(c) ? "Channel info & settings" : "Channel info", icon: "info", onclick: () => channelInfo(c) }
      : { label: "Group info", icon: "info", onclick: () => groupInfo(c) },
    ch ? { label: "Copy channel link", icon: "link", onclick: () => navigator.clipboard?.writeText(channelWebLink(c.id)).then(() => toast("Link copied"), () => toast("Couldn't copy the link")) } : null,
    { label: "Search in chat", icon: "search", onclick: () => anchor.closest(".conv")?._search?.() },
    { label: "Starred messages", icon: "star", onclick: () => starredModal(c) },
    canPost(c) ? { label: "Scheduled messages", icon: "clock", onclick: () => scheduledModal(c) } : null,
    "-",
    { label: p.pinned ? "Unpin chat" : "Pin chat", icon: "pin", onclick: () => setChatPref(c.id, { pinned: !p.pinned }) },
    isMuted(c.id) ? { label: "Unmute", icon: "bell", onclick: () => setChatPref(c.id, { muteUntil: 0 }) } : { label: "Mute…", icon: "bellOff", onclick: () => muteMenu(c, anchor) },
    { label: p.archived ? "Unarchive" : "Archive", icon: "archive", onclick: () => setChatPref(c.id, { archived: !p.archived }) },
    { label: "Mark as unread", icon: "unread", onclick: () => { setChatPref(c.id, { markedUnread: true }); location.hash = "#/chats"; } },
    canDisappear ? { label: `Disappearing messages: ${({ off: "Off", view: "After viewing", "24h": "24 hours", "7d": "7 days" })[c.disappearing || "off"]}`, icon: "clock", onclick: () => menu(anchor, [["off", "Off"], ["view", "After viewing"], ["24h", "After 24 hours"], ["7d", "After 7 days"]].map(([v, l]) => ({ label: (c.disappearing === v ? "✓ " : "") + l, onclick: async () => { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { disappearing: v })); emit("chat:" + c.id, { meta: true }); toast("Updated"); } catch (e) { toast(errText(e)); } } })), { label: "Disappearing messages" }) } : null,
    "-",
    ch && c.createdBy !== myId() ? { label: "Leave channel", icon: "logout", danger: true, onclick: () => leaveChannel(c) } : null,
    other ? { label: "Block", icon: "shield", danger: true, onclick: async () => { if (await confirmBox(`Block ${other.name || other.username}?`, "They won't be able to message or call you.", "Block", true)) { try { await post(`/v1/users/${enc(other.id)}/block`, { on: true }); toast("Blocked"); } catch (e) { toast(errText(e)); } } } } : null,
  ], { label: "Chat menu" });
}

async function msgMenu(c, m, anchor, point, composer) {
  const mine = m.senderId === myId();
  const admin = isChannel(c) ? isChannelAdmin(c) : !isGroup(c) || (c.admins || []).includes(myId());
  const pinned = (c.pins || []).includes(m.id);
  const starred = state.starred.has(m.id);
  menu(anchor || point, [
    canPost(c) ? { label: "Reply", icon: "reply", onclick: () => composer.setReply(m) } : null,
    m.text ? { label: "Copy text", icon: "copy", onclick: () => navigator.clipboard?.writeText(m.text).then(() => toast("Copied")) } : null,
    { label: "Forward", icon: "forward", onclick: () => forwardModal(m) },
    { label: starred ? "Unstar" : "Star", icon: "star", onclick: async () => {
      try { await post(`/v1/messages/${enc(m.id)}/star`, { on: !starred }); if (starred) state.starred.delete(m.id); else state.starred.add(m.id); emit("chat:" + c.id, { msgs: true }); toast(starred ? "Unstarred" : "Starred"); } catch (e) { toast(errText(e)); }
    } },
    admin ? { label: pinned ? "Unpin" : "Pin to top", icon: "pin", onclick: async () => { try { Object.assign(c, await patch(`/v1/chats/${enc(c.id)}`, { pin: { id: m.id, on: !pinned } })); emit("chat:" + c.id, { meta: true }); } catch (e) { toast(errText(e)); } } } : null,
    mine && (m.type === "text" || m.type === "note") ? { label: "Edit", icon: "edit", onclick: () => composer.setEdit(m) } : null,
    mine ? { label: "Delete for everyone", icon: "trash", danger: true, onclick: async () => {
      if (!(await confirmBox("Delete for everyone?", "This removes the message for everyone in the chat.", "Delete", true))) return;
      try { const r = await patch(`/v1/messages/${enc(m.id)}`, { deleted: true }); bucket(c.id).byId.set(m.id, r); emit("chat:" + c.id, { msgs: true }); } catch (e) { toast(errText(e)); }
    } } : null,
    !mine ? { label: "Report", icon: "shield", danger: true, onclick: async () => {
      const reason = await promptBox("Report this message", { placeholder: "What's wrong? (spam, harassment…)", okLabel: "Report" });
      if (reason == null) return;
      try { await post("/v1/reports", { kind: "message", targetId: m.id, reason: reason || "other", details: reason }); toast("Thanks — our team will take a look"); } catch (e) { toast(errText(e)); }
    } } : null,
  ], { label: "Message actions" });
}

async function react(c, m, emoji) {
  const b = bucket(c.id);
  const prev = { ...(m.reactions || {}) };
  const opt = { ...m, reactions: { ...(m.reactions || {}) } };
  if (emoji) opt.reactions[myId()] = emoji; else delete opt.reactions[myId()];
  b.byId.set(m.id, opt); emit("chat:" + c.id, { msgs: true });
  try { const r = await patch(`/v1/messages/${enc(m.id)}`, { reaction: emoji || null }); b.byId.set(m.id, r); emit("chat:" + c.id, { msgs: true }); }
  catch (e) { b.byId.set(m.id, { ...m, reactions: prev }); emit("chat:" + c.id, { msgs: true }); toast(errText(e)); }
}

async function renderConversation(el, id) {
  state.openChat = id;
  let c = state.chats.get(id);
  if (!c) {
    try { c = await get(`/v1/chats/${enc(id)}`); state.chats.set(id, c); (c.memberUsers || []).forEach(seedUser); }
    catch (e) {
      state.openChat = null;
      // a channel link you aren't subscribed to → its preview
      if (e.status === 404 && !location.hash.startsWith("#/channel/")) { try { await fetchChannel(id); location.replace(`#/channel/${enc(id)}`); return; } catch {} }
      el.append(mainEmpty("Chat not found", errText(e), h("a", { href: "#/chats" }, "Back to chats"))); return;
    }
  }
  const channel = isChannel(c);
  const wallCv = h("canvas", { class: "wall", "aria-hidden": "true" });
  const convLabel = () => (channel ? `Channel ${chatTitle(c)}` : `Chat with ${chatTitle(c)}`);
  const conv = h("section", { class: "conv" + (channel ? " channel" : ""), "aria-label": convLabel() }, wallCv);
  el.append(conv);
  const wall = mountWallpaper(wallCv, id);

  // header
  const who = h("a", { class: "who", href: "#" });
  const status = h("div", { class: "s" });
  const head = h("header", { class: "conv-head" }, backBtn("#/chats", "Back to chats"), who,
    channel ? null : iconBtn("phone", "Voice call", () => callChat(false)), channel ? null : iconBtn("video", "Video call", () => callChat(true)),
    channel ? iconBtn("info", isChannelAdmin(c) ? "Channel info and settings" : "Channel info", () => channelInfo(state.chats.get(id) || c)) : null,
    iconBtn("search", "Search in chat", () => toggleSearch(true)), iconBtn("more", "Chat menu", (e) => convMenu(state.chats.get(id) || c, e.currentTarget)));
  const callChat = (video) => { const cc = state.chats.get(id) || c; if (isGroup(cc)) startCall({ chatId: cc.id, video }); else startCall({ to: others(cc)[0], video }); };
  const paintHead = () => {
    c = state.chats.get(id) || c;
    const o = !isGroup(c) ? memberUser(c, others(c)[0]) : null;
    who.href = o ? `#/u/${enc(o.username)}` : "#";
    who.onclick = o ? null : (e) => { e.preventDefault(); if (channel) channelInfo(c); else groupInfo(c); };
    const typing = typingIn(c);
    status.className = "s" + (typing.length ? " typing" : "");
    const chInfo = channel ? channelCached(id) : null;
    status.textContent = typing.length ? (isGroup(c) ? `${typing.map(names(c)).join(", ")} ${typing.length > 1 ? "are" : "is"} typing…` : "typing…")
      : channel ? `Channel${chInfo ? ` · ${subsText(chInfo.subscribers)}` : ""}`
      : isGroup(c) ? `${(c.members || []).length} members` : (o && o.showActivity !== false && lastSeen(o.lastActive)) || (o ? "@" + o.username : "");
    who.replaceChildren(chatAvatar(c, "sm"), h("div", { style: "min-width:0" }, h("div", { class: "t" }, chatTitle(c), " ", o ? badges(o.badges, { dev: false }) : null), status));
    conv.setAttribute("aria-label", convLabel());
  };

  // search in chat
  let query = "";
  const sInp = h("input", { type: "search", placeholder: "Search this chat", "aria-label": "Search this chat" });
  const sInfo = h("span", { class: "meta", "aria-live": "polite" });
  let hits = [], hitI = -1;
  const sBar = h("div", { class: "conv-search", hidden: true }, sInp, sInfo,
    iconBtn("back", "Previous match", () => step(-1), "rot-up"), iconBtn("back", "Next match", () => step(1), "rot-down"), iconBtn("close", "Close search", () => toggleSearch(false)));
  sBar.querySelector(".rot-up svg").style.transform = "rotate(90deg)";
  sBar.querySelector(".rot-down svg").style.transform = "rotate(-90deg)";
  const toggleSearch = (on_) => { sBar.hidden = !on_; if (on_) sInp.focus(); else { query = ""; sInp.value = ""; paint(true); } };
  conv._search = () => toggleSearch(true);
  const step = (d) => { if (!hits.length) return; hitI = (hitI + d + hits.length) % hits.length; sInfo.textContent = `${hitI + 1} of ${hits.length}`; jump(hits[hitI]); };
  sInp.addEventListener("input", debounce(() => { query = sInp.value.trim(); paint(true); const ms = sorted(); hits = query ? ms.filter((m) => (m.text || "").toLowerCase().includes(query.toLowerCase())).map((m) => m.id) : []; hitI = hits.length; sInfo.textContent = query ? (hits.length ? `${hits.length} found` : "No matches") : ""; if (hits.length) step(-1); }, 200));
  sInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? 1 : -1); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); toggleSearch(false); } });

  // pinned banner
  const pinbar = h("div", { class: "pinbar", hidden: true });
  let pinI = 0;
  const paintPins = () => {
    const pins = (c.pins || []).filter((p) => bucket(id).byId.has(p));
    pinbar.hidden = !pins.length;
    if (!pins.length) return;
    pinI = pinI % pins.length;
    const m = bucket(id).byId.get(pins[pinI]);
    pinbar.replaceChildren(icon("pin"), h("button", { class: "txt", "aria-label": "Jump to pinned message", onclick: () => { jump(m.id); pinI = (pinI + 1) % pins.length; paintPins(); } },
      h("span", { class: "pk" }, `Pinned message${pins.length > 1 ? ` ${pinI + 1} of ${pins.length}` : ""}`), m.deleted ? "Deleted message" : m.text || m.type));
  };

  // messages
  const list = h("div", { class: "msgs", role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Messages", tabindex: "0" });
  const typingEl = h("div", { class: "typing-bubble", hidden: true, "aria-label": "Typing" }, h("i"), h("i"), h("i"));
  const jumpBtn = h("button", { class: "jump", hidden: true, "aria-label": "Jump to latest", onclick: () => { list.scrollTop = list.scrollHeight; } }, icon("back"));
  const reqBar = h("div", { class: "request-bar", hidden: true });
  const cache = new Map(); // id → {sig, el}
  const sorted = () => [...bucket(id).byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  const memMap = () => new Map((c.memberUsers || []).map((u) => [u.id, u]));
  const ctx = {
    meId: myId(), get chat() { return c; }, isGroup: isGroup(c), byId: bucket(id).byId, starred: state.starred, highlight: "",
    members: memMap(), names: names(c), seenBy: seenBy(c),
    view: (lst, i) => openViewer(lst, i),
    vote: async (m, idx) => { try { const r = await patch(`/v1/messages/${enc(m.id)}`, { vote: idx }); bucket(id).byId.set(m.id, r); emit("chat:" + id, { msgs: true }); } catch (e) { toast(errText(e)); } },
    react: (m, e) => react(c, m, e),
    reactPicker: (m, anchor) => {
      const quick = getS("chat.quickReactions") || ["❤️", "😂", "😮", "😢", "🔥", "👍"];
      const mineR = (m.reactions || {})[myId()];
      menu(anchor, [{ custom: h("div", { class: "react-pop", role: "group", "aria-label": "Reactions" }, quick.map((e) => h("button", { type: "button", "aria-label": `React ${e}`, "aria-pressed": String(mineR === e), onclick: () => { document.querySelector(".menu")?.remove(); react(c, m, mineR === e ? null : e); } }, e))) },
        { label: "More emoji…", icon: "emoji", onclick: () => import("./emoji.js").then((E) => E.emojiPicker(conv, (e) => { react(c, m, e); conv.querySelector(".emoji-pop")?.remove(); })) },
        mineR ? { label: "Remove my reaction", icon: "close", onclick: () => react(c, m, null) } : null], { label: "React" });
      setTimeout(() => document.querySelector(".menu .react-pop button")?.focus(), 0);
    },
    reply: (m) => { if (canPost(state.chats.get(id) || c)) composer.setReply(m); },
    get canReply() { return canPost(state.chats.get(id) || c); },
    more: (m, anchor, point) => msgMenu(c, m, anchor, point, composer),
    jump: (mid) => jump(mid),
    openOnce: async (m, btn) => {
      btn.disabled = true;
      try {
        const blob = await fetchBlob("/v1/snap/open", { method: "POST", body: { chatId: id, msgId: m.id } });
        const url = URL.createObjectURL(blob);
        const close = openViewer([{ url, kind: blob.type.startsWith("video") ? "video" : "image" }], 0, "Opens once — it's gone when you close it");
        const obs = new MutationObserver(() => { if (!document.querySelector(".viewer")) { URL.revokeObjectURL(url); obs.disconnect(); loadMessages(id); } });
        obs.observe(document.body, { childList: true });
        void close;
      } catch (e) { toast(errText(e)); btn.disabled = false; loadMessages(id); }
    },
    download: async (m) => {
      try {
        toast("Downloading…");
        const blob = await fetchBlob(`/m/${m.media.key}`);
        const a = h("a", { href: URL.createObjectURL(blob), download: m.x?.file?.name || "file" });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) { toast(errText(e)); }
    },
    callBack: (video) => callChat(video),
  };
  let firstPaint = true, lastCount = 0;
  function paint(force = false) {
    c = state.chats.get(id) || c;
    ctx.highlight = query; ctx.members = memMap(); ctx.names = names(c); ctx.seenBy = seenBy(c); ctx.isGroup = isGroup(c);
    const ms = sorted();
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 140;
    const kids = [];
    if (ms.length >= 300) kids.push(h("div", { class: "loadinfo" }, "Showing the latest 300 messages"));
    if (!ms.length && bucket(id).loaded) kids.push(h("div", { class: "empty" }, isRequest(c) ? "Accept to reply." : channel ? (canPost(c) ? "No posts yet. Share something with your subscribers." : "No posts yet.") : "No messages yet. Say hi 👋"));
    if (!bucket(id).loaded) kids.push(h("div", { class: "empty" }, "Loading messages…"));
    let day = "";
    ms.forEach((m, i) => {
      const d = new Date(m.createdAt).toDateString();
      if (d !== day) { day = d; kids.push(h("div", { class: "day", role: "separator" }, dayLabel(m.createdAt))); }
      const run = runInfo(ms, i);
      const seen = m.senderId === myId() ? ctx.seenBy(m) : false;
      const sig = [m.updatedAt, m.editedAt, m.deleted, JSON.stringify(m.reactions || {}), JSON.stringify(m.x?.poll?.votes || m.x?.poll?.tally || ""), run.first, run.last, seen, state.starred.has(m.id), m._pending, m._failed, query, Object.keys(m.openedBy || {}).length, m.gone, ctx.members.size].join("|");
      const hit = cache.get(m.id);
      if (hit && hit.sig === sig && !force) kids.push(hit.el);
      else { const e2 = renderMessage(m, ctx, run); cache.set(m.id, { sig, el: e2 }); kids.push(e2); }
    });
    // keep elements in place where possible (playing voice notes / videos keep going)
    const cur = [...list.children];
    if (cur.length !== kids.length || cur.some((n, i) => n !== kids[i])) list.replaceChildren(...kids);
    const typing = typingIn(c);
    typingEl.hidden = !typing.length;
    list.append(typingEl);
    const mineNew = ms.length && ms[ms.length - 1].senderId === myId() && ms.length !== lastCount;
    if (firstPaint && ms.length) {
      firstPaint = false;
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; if (pendingJump) { const j = pendingJump; pendingJump = null; jump(j); } });
    } else if (nearBottom || mineNew) requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
    else if (ms.length > lastCount) jumpBtn.hidden = false;
    lastCount = ms.length;
    paintPins();
    // requests: accept / delete
    if (isRequest(c)) {
      reqBar.hidden = false; composer.el.hidden = true;
      reqBar.replaceChildren(h("p", { style: "margin:0 0 8px" }, `${chatTitle(c)} wants to message you.`),
        h("div", { class: "row", style: "justify-content:center" },
          h("button", { onclick: async () => { try { await patch(`/v1/chats/${enc(id)}`, { status: "active" }); await loadChatMeta(id); loadChats(); paint(); } catch (e) { toast(errText(e)); } } }, "Accept"),
          !isGroup(c) ? h("button", { class: "tonal", onclick: async () => { const o = others(c)[0]; if (await confirmBox("Block this person?", "They won't be able to message or call you.", "Block", true)) { try { await post(`/v1/users/${enc(o)}/block`, { on: true }); location.hash = "#/chats"; loadChats(); } catch (e) { toast(errText(e)); } } } }, "Block") : null));
    } else if (channel && !canPost(c)) {
      // subscribers read and react; only admins post
      reqBar.hidden = false; composer.el.hidden = true; activeComposer = null;
      if (!reqBar.querySelector(".chan-bar")) reqBar.replaceChildren(h("div", { class: "chan-bar" }, chanMark(), h("span", {}, "Subscribed"), h("span", { "aria-hidden": "true" }, "·"),
        h("button", { type: "button", class: "linkish", "aria-label": `Leave ${chatTitle(c)}`, onclick: () => leaveChannel(state.chats.get(id) || c) }, "Leave")));
    } else { reqBar.hidden = true; composer.el.hidden = false; activeComposer = composer; }
    if (!document.hidden && document.hasFocus()) markRead(id);
  }
  // stay pinned to the newest message while images/videos above it finish loading
  let stick = true;
  list.addEventListener("scroll", () => { stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80; if (stick) jumpBtn.hidden = true; }, { passive: true });
  const restick = () => { if (stick) list.scrollTop = list.scrollHeight; };
  list.addEventListener("load", restick, true);
  list.addEventListener("loadedmetadata", restick, true);
  function jump(mid) {
    const e2 = document.getElementById("m-" + mid);
    if (!e2) { toast("That message isn't loaded (it may be older)"); return; }
    e2.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    e2.classList.remove("flash"); void e2.offsetWidth; e2.classList.add("flash"); e2.focus({ preventScroll: true });
  }
  jumpTo = jump;

  const composer = createComposer(c, {
    send: (body) => sendBody(id, body),
    edit: async (m, text) => { try { const r = await patch(`/v1/messages/${enc(m.id)}`, { text }); bucket(id).byId.set(m.id, r); emit("chat:" + id, { msgs: true }); } catch (e) { toast(errText(e)); } },
    names: () => names(state.chats.get(id) || c),
    chat: () => state.chats.get(id) || c,
    lastMine: () => sorted().reverse().find((m) => m.senderId === myId() && !m.deleted && !m._pending && (m.type === "text" || m.type === "note")),
  });
  activeComposer = composer;
  conv.append(head, sBar, pinbar, list, jumpBtn, reqBar, composer.el);
  paintHead(); paint();
  const off = on("chat:" + id, (d) => { if (d?.error && !bucket(id).loaded) { list.replaceChildren(h("div", { class: "empty" }, d.error)); return; } paintHead(); paint(); });
  const offS = on("settings", () => { wall.update(id); paint(true); });
  const offCh = on("chats", () => paintHead());
  const offInfo = channel ? on("channel:" + id, () => paintHead()) : () => {};
  if (channel) fetchChannel(id).catch(() => {});
  const typingTick = setInterval(() => { if (typingIn(state.chats.get(id) || c).length || !typingEl.hidden || status.classList.contains("typing")) { paintHead(); typingEl.hidden = !typingIn(state.chats.get(id) || c).length; } }, 2000);
  const onFocus = () => markRead(id);
  window.addEventListener("focus", onFocus);
  // retry failed sends by clicking them
  list.addEventListener("click", async (e) => {
    const f = e.target.closest(".msg.failed"); if (!f || e.target.closest("button,a")) return;
    const m = bucket(id).byId.get(f.dataset.id); if (!m?._body) return;
    if (!(await confirmBox("Message not sent", "Try sending it again?", "Retry"))) return;
    bucket(id).byId.delete(m.id); emit("chat:" + id, { msgs: true });
    sendBody(id, { ...m._body }).catch(() => {});
  });

  // first load
  if (!bucket(id).loaded) loadMessages(id);
  else loadMessages(id);
  loadChatMeta(id);
  loadStarred(id);
  schedule();
  setTimeout(() => { if (canPost(state.chats.get(id) || c)) composer.focus(); else list.focus({ preventScroll: true }); }, 50);

  return () => {
    off(); offS(); offCh(); offInfo(); clearInterval(typingTick); window.removeEventListener("focus", onFocus);
    wall.stop(); composer.destroy(); activeComposer = null; jumpTo = null;
    if (state.openChat === id) state.openChat = null;
    schedule();
  };
}

// ------------------------------------------------------------------ drag & drop + paste anywhere in an open chat
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", (e) => { if (!activeComposer || !hasFiles(e)) return; e.preventDefault(); dragDepth++; $("#drop").hidden = false; });
addEventListener("dragover", (e) => { if (!activeComposer || !hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
addEventListener("dragleave", (e) => { if (!activeComposer || !hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $("#drop").hidden = true; } });
addEventListener("drop", (e) => {
  $("#drop").hidden = true; dragDepth = 0;
  if (!activeComposer || !hasFiles(e)) return;
  e.preventDefault();
  activeComposer.addFiles(e.dataTransfer.files);
});
addEventListener("paste", (e) => {
  if (!activeComposer || e.defaultPrevented) return;
  const t = e.target;
  if (t.closest && t.closest("input, textarea, [contenteditable]") && !t.closest(".composer")) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); activeComposer.addFiles(files); }
});

// ------------------------------------------------------------------ tab
export const chatsTab = {
  list(el) { renderList(el); },
  async main(el, args) {
    // channels: app.js passes [":channels"] / [":channel", id]
    if (args[0] === ":channels") { state.openChat = null; schedule(); return renderDiscover(el); }
    if (args[0] === ":channel") { state.openChat = null; schedule(); return renderChannelRoute(el, args[1], renderConversation); }
    const id = args[0];
    if (!id) {
      el.append(mainEmpty("Your chats", "Pick a chat on the left, or start a new one. Press Ctrl+K to search.", h("div", { class: "row", style: "justify-content:center;margin-top:10px" },
        h("button", { onclick: (e) => newChatMenu(e.currentTarget) }, "New chat"))));
      state.openChat = null; schedule();
      return null;
    }
    return renderConversation(el, id);
  },
  select() { emit("route-chat"); for (const r of document.querySelectorAll("[data-chat]")) r.setAttribute("aria-current", String(r.dataset.chat === state.openChat)); },
};
/** Remember a chat as read in this browser (channels: the server doesn't store subscribers' reads). */
export function markLocalRead(id) {
  localRead[id] = Date.now();
  try { localStorage.setItem(LREAD, JSON.stringify(localRead)); } catch {}
  unreadCounts.delete(id);
  updateUnread();
}
export { sendBody, isRequest, others, memberUser };
void userName; void setS; void mediaUrl;

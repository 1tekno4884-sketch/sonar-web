// Sonar web — boot, routing, keyboard shortcuts and global search.
// Talks only to the Ripple Worker (Ripple's docs/API.md + docs/SONAR_API.md). No frameworks, no build step.
import { api, get, post, token, setToken, onUnauthorized, items } from "./api.js";
import { h, icon, modal, closeModal, closeMenu, modalOpen, toast, errText, avatar, badges, enc, listTime, $ } from "./dom.js";
import { state, emit, on, loadConfig } from "./state.js";
import { loadSettings, pullSettings, resetSettingsMemory, applyTheme } from "./settings.js";
import { connectLine, disconnectLine } from "./line.js";
import { buildShell, setTab, setDetail, ui } from "./layout.js";
import { renderLanding, setOnSignedIn, signInModal } from "./auth.js";
import { chatsTab, initChats, stopChats, adjacentChat, chatTitle, openChatById } from "./chats.js";
import { peopleTab } from "./people.js";
import { flairAvatar, flairName, ribbonsHtml } from "./identity.js";   // U2-identity
import { settingsTab } from "./settingsui.js";
import { callsTab, initCalls, stopCalls, joinByCode } from "./calls.js";

const TABS = { chats: chatsTab, calls: callsTab, people: peopleTab, settings: settingsTab };
let currentTab = null, mainCleanup = null, booted = false;

// ------------------------------------------------------------------ routing
function parse() {
  const [, name = "", ...rest] = location.hash.replace(/^#/, "").split("/");
  return { name, args: rest.map((x) => { try { return decodeURIComponent(x); } catch { return x; } }) };
}
function tabOf(name) {
  if (name === "chat" || name === "chats" || name === "") return "chats";
  if (name === "u") return "people";
  if (name === "call" || name === "calls") return "calls";
  if (name === "invite" || name === "channel" || name === "channels") return "chats";
  return TABS[name] ? name : "chats";
}

async function route() {
  if (!state.me) return renderLoggedOut();
  closeMenu();
  const { name, args } = parse();
  if (name === "call" && args[0]) { const code = args[0]; history.replaceState(null, "", "#/calls"); joinByCode(code); return route(); }
  if (name === "invite" && args[0]) { const code = args[0]; history.replaceState(null, "", "#/chats"); inviteModal(code); return route(); }
  const tab = tabOf(name);
  const t = TABS[tab];
  if (!ui.app || !document.body.contains(ui.app)) { buildShell(); currentTab = null; }
  if (tab !== currentTab) {
    currentTab = tab; setTab(tab);
    try { ui.list._cleanup?.(); } catch {}
    ui.list._cleanup = null; ui.list.replaceChildren();
    try { const c = await t.list(ui.list); if (typeof c === "function") ui.list._cleanup = c; } catch (e) { console.error(e); }
  }
  // main pane
  const isChannelRoute = name === "channels" || name === "channel" || name === "map";   // U3-social: #/map (Tide Map) also lives in the Chats tab
  // channels live in the Chats tab: its main pane gets [":channels"] or [":channel", id] (chat ids never start with ":")
  const detailArgs = isChannelRoute ? [":" + name, ...args] : name === "chat" || name === "u" ? args : name === tab ? args : [];
  const isDetail = (name === "chat" && args[0]) || (name === "u" && args[0]) || ((name === "settings" || name === "calls") && args[0]) || isChannelRoute;
  try { mainCleanup?.(); } catch {}
  mainCleanup = null;
  ui.main.replaceChildren();
  setDetail(!!isDetail);
  try { mainCleanup = (await t.main(ui.main, name === "u" ? ["u", ...detailArgs] : detailArgs)) || null; }
  catch (e) { console.error(e); ui.main.replaceChildren(h("div", { class: "main-empty" }, h("h2", {}, "Couldn't load this"), h("p", {}, errText(e)))); }
  t.select?.(name === "u" ? ["u", ...detailArgs] : detailArgs);
  emit("route", { name, args });
}

function renderLoggedOut() {
  const { name, args } = parse();
  let note = null;
  if (name === "call" && args[0]) { sessionStorage.setItem("sonar_after_login", location.hash); note = "Sign in to join this call."; }
  else if (name === "invite" && args[0]) { sessionStorage.setItem("sonar_after_login", location.hash); note = "Sign in to see this group invite."; }
  else if (name === "channel" && args[0]) { sessionStorage.setItem("sonar_after_login", location.hash); note = "Sign in to see this channel."; }
  else if (name && name !== "") sessionStorage.setItem("sonar_after_login", location.hash);
  ui.app = null; currentTab = null;
  renderLanding(note);
}

// ------------------------------------------------------------------ session
async function loadMe() {
  if (!token) { state.me = null; return; }
  try {
    const j = await get("/v1/me");
    state.me = j.user; state.role = j.role; state.owner = !!j.owner;
    state.access = j.access || null;   // U2-identity
  } catch (e) { if (e.status === 401) setToken(null); state.me = e.status === 401 ? null : state.me; if (e.status !== 401 && !state.me) throw e; }
}

async function startSession() {
  await loadSettings();
  connectLine();
  initChats();
  initCalls();
  emit("me");
}

export async function signOut(everywhere = false) {
  try { await post(everywhere ? "/v1/auth/logout-all" : "/v1/auth/logout", {}); } catch {}
  localSignOut();
}
function localSignOut() {
  stopCalls(); stopChats(); disconnectLine();
  setToken(null); state.me = null; state.chats.clear(); state.msgs.clear(); state.chatsLoaded = false;
  resetSettingsMemory();
  closeModal(); ui.app = null; currentTab = null;
  location.hash = "#/";
  renderLoggedOut();
}
onUnauthorized(() => { if (state.me) { toast("You were signed out."); localSignOut(); } });

setOnSignedIn(async (j) => {
  state.me = j.user; state.role = j.role;
  try { await loadMe(); } catch {}
  await startSession();
  const next = sessionStorage.getItem("sonar_after_login");
  sessionStorage.removeItem("sonar_after_login");
  if (next && next !== location.hash) location.hash = next; else route();
});

// ------------------------------------------------------------------ group invite links (#/invite/<code>)
async function inviteModal(code) {
  try {
    const g = await get(`/v1/invite/${enc(code)}`);
    const close = modal(h("div", { class: "stack" },
      h("div", { class: "row" }, avatar(g.photo, g.name, "lg"), h("div", {}, h("h2", {}, g.name || "Group"), h("div", { class: "meta" }, `${g.members} members`))),
      g.description ? h("p", {}, g.description) : null,
      h("div", { class: "row end" }, h("button", { class: "tonal", onclick: () => close() }, "Not now"),
        h("button", { onclick: async () => {
          try { const r = await post(`/v1/invite/${enc(code)}/join`); close(); if (r.joined) { location.hash = `#/chat/${enc(r.chatId)}`; } else toast("Request sent — an admin will let you in"); }
          catch (e) { toast(errText(e)); }
        } }, "Join group"))), { label: "Group invite" });
  } catch (e) { toast(errText(e)); }
}

// ------------------------------------------------------------------ global search (Ctrl+K)
export function openSearch() {
  if (!state.me) return;
  const inp = h("input", { type: "search", placeholder: "Search chats, people and messages", "aria-label": "Search", autocomplete: "off" });
  const res = h("div", { class: "stack", style: "margin-top:12px", role: "listbox", "aria-label": "Results" });
  let seq = 0;
  const row = (ic, title, sub, href, onclick) => h("a", { class: "rowbtn", href: href || "#", role: "option", onclick: (e) => { if (onclick) { e.preventDefault(); onclick(); } closeModal(); } }, ic, h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, title)), sub ? h("div", { class: "l2" }, h("span", { class: "pv" }, sub)) : null));
  const run = async () => {
    const q = inp.value.trim(), my = ++seq;
    res.replaceChildren();
    if (!q) { res.append(h("div", { class: "meta" }, "Tip: press Ctrl+K anywhere to search. Esc closes.")); return; }
    const chats = [...state.chats.values()].filter((c) => chatTitle(c).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    if (chats.length) res.append(h("div", { class: "section-title" }, "Chats"), ...chats.map((c) => row(avatar(null, chatTitle(c), "sm"), chatTitle(c), c.lastMessage?.text || "", `#/chat/${enc(c.id)}`)));
    const [people, msgs, chans] = await Promise.all([
      q.length >= 2 ? get(`/v1/search?q=${enc(q)}`).catch(() => ({})) : {},
      q.length >= 2 ? get(`/v1/chats/search?q=${enc(q)}`).catch(() => ({})) : {},
      q.length >= 2 ? get(`/v1/channels?q=${enc(q)}`).catch(() => ({})) : {},
    ]);
    if (my !== seq) return;
    const users = (people.users || []).slice(0, 8);
    if (users.length) res.append(h("div", { class: "section-title" }, "People"), ...users.map((u) => row(flairAvatar(u, "sm"), h("span", {}, flairName(u, u.displayName || u.username), ...badges(u.badges, { dev: false }), ribbonsHtml(u, true)), "@" + u.username, `#/u/${enc(u.username)}`)));   // U2-identity
    const cs = items(chans).slice(0, 5);
    if (cs.length) res.append(h("div", { class: "section-title" }, "Channels"), ...cs.map((ch) => row(avatar(ch.photo, ch.name, "sm"), ch.name,
      `${ch.subscribed ? "Subscribed · " : ""}${ch.subscribers} subscriber${ch.subscribers === 1 ? "" : "s"}`, `#/channel/${enc(ch.id)}`)));
    const ms = items(msgs).slice(0, 12);
    if (ms.length) res.append(h("div", { class: "section-title" }, "Messages"), ...ms.map((m) => {
      const c = state.chats.get(m.chatId);
      return row(h("span", { class: "avatar sm" }, icon("chat")), c ? chatTitle(c) : "Chat", `${m.text} · ${listTime(m.createdAt)}`, `#/chat/${enc(m.chatId)}`, () => openChatById(m.chatId, m.id));
    }));
    if (!res.children.length) res.append(h("div", { class: "empty" }, "Nothing found"));
  };
  let t; inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
  inp.addEventListener("keydown", (e) => {
    const opts = [...res.querySelectorAll("[role=option]")];
    if (e.key === "Enter") { e.preventDefault(); opts[0]?.click(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); opts[0]?.focus(); }
  });
  res.addEventListener("keydown", (e) => {
    const opts = [...res.querySelectorAll("[role=option]")], i = opts.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) inp.focus(); else opts[i - 1].focus(); }
  });
  modal([h("h2", { class: "sr" }, "Search"), inp, res], { wide: true, label: "Search" });
  run();
}

// ------------------------------------------------------------------ keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (modalOpen()) closeModal(); openSearch(); return; }
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && state.me) {
    e.preventDefault();
    const id = adjacentChat(e.key === "ArrowUp" ? -1 : 1);
    if (id) location.hash = `#/chat/${enc(id)}`;
    return;
  }
  if (e.key === "Escape") {
    if (e.defaultPrevented) return;
    if (closeMenu()) return;
    if (modalOpen()) { closeModal(); return; }
    if ($(".viewer")) return;            // the viewer handles its own Esc
    if (!$("#call-layer").hidden && $("#call-layer").contains(document.activeElement)) return;  // calls handle theirs
    const { name, args } = parse();
    if ((name === "chat" && args[0]) || name === "channels" || name === "channel" || name === "map") { location.hash = "#/chats"; }   // U3-social: map
    else if (name === "u" && args[0]) { history.length > 1 ? history.back() : (location.hash = "#/people"); }
    else if (name === "settings" && args[0] && ui.app?.classList.contains("detail")) location.hash = "#/settings";
    else if (name === "calls" && args[0]) location.hash = "#/calls";
  }
});

// ------------------------------------------------------------------ boot
window.addEventListener("hashchange", () => { if (booted) route(); });
window.addEventListener("focus", () => { if (state.me) pullSettings(); });
on("signout", (all) => signOut(!!all));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

(async () => {
  applyTheme();
  loadConfig();
  try { await loadMe(); }
  catch (e) {
    document.getElementById("app").replaceChildren(h("div", { class: "main-empty", style: "margin-top:20vh" }, h("h2", {}, "Sonar can't reach the server"), h("p", {}, errText(e)),
      h("button", { onclick: () => location.reload() }, "Try again")));
    return;
  }
  booted = true;
  if (state.me) await startSession();
  route();
})();

export { signInModal };

// App shell: navigation rail (bottom bar on phones) · list pane · main pane. Two panes on desktop, one on mobile.
import { h, icon, mark, avatar } from "./dom.js";
import { state } from "./state.js";
import { flairAvatar } from "./identity.js";   // U2-identity

export const ui = { app: null, list: null, main: null, rail: null, tabs: {} };
export const TABS = [["chats", "Chats", "chat"], ["calls", "Calls", "phone"], ["people", "People", "people"], ["settings", "Settings", "settings"]];

export function buildShell() {
  ui.tabs = {};
  const nav = h("nav", { "aria-label": "Main" }, TABS.map(([id, label, ic]) => {
    const a = h("a", { class: "tab", href: `#/${id}`, "data-tab": id }, h("span", { class: "pill" }, icon(ic)), h("span", {}, label), h("span", { class: "count", hidden: true }));
    ui.tabs[id] = a;
    return a;
  }));
  const me = state.me;
  ui.rail = h("aside", { class: "rail" },
    h("a", { class: "brand-btn", href: "#/chats", "aria-label": "Sonar — chats" }, mark()),
    nav,
    h("a", { class: "me", href: me ? `#/u/${encodeURIComponent(me.username)}` : "#/settings", title: "Your profile", "aria-label": "Your profile" }, flairAvatar(me, "sm", avatar(me?.avatar, me?.displayName, "sm"))));   // U2-identity
  ui.list = h("section", { class: "list-pane", "aria-label": "List" });
  ui.main = h("main", { class: "main-pane", id: "main-pane", tabindex: "-1" });
  ui.app = h("div", { class: "app" }, ui.rail, ui.list, ui.main);
  document.getElementById("app").replaceChildren(ui.app);
  return ui;
}
export function setTab(tab) {
  for (const [id, a] of Object.entries(ui.tabs)) { if (id === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
}
/** Mobile: show the main pane instead of the list. */
export function setDetail(on) { ui.app?.classList.toggle("detail", !!on); }
export function setBadge(tab, n) {
  const c = ui.tabs[tab]?.querySelector(".count"); if (!c) return;
  c.hidden = !n; c.textContent = n > 99 ? "99+" : String(n || "");
  ui.tabs[tab].setAttribute("aria-label", `${TABS.find((t) => t[0] === tab)[1]}${n ? `, ${n} unread` : ""}`);
}
export function mainEmpty(title, text, extra) {
  return h("div", { class: "main-empty" }, mark("mark"), h("h2", {}, title), text ? h("p", {}, text) : null, extra || null);
}
/** A back button for the mobile single-pane layout. */
export const backBtn = (href, label = "Back") => h("a", { class: "icon-btn only-mobile", href, "aria-label": label, title: label }, icon("back"));

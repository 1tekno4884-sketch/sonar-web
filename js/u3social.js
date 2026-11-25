// U3-social (Sonar web): Whisper and Lantern messages, the Tide Map entry point, and the composer extras.
//  - Whisper (x.whisper.text): the bubble stays blurred; press and hold (mouse, touch, or Space/Enter) to read it, and it
//    hides again the moment you let go. Previews, search and notifications only ever see the plain fallback `text`.
//  - Lantern (x.lantern = {until, by, ended?}): a live-location card. While it's lit, the people sharing in the chat come
//    from GET /v1/u3/lantern/:chatId every 5 s (only while the tab is visible and the card is on screen); a small map
//    opens on demand. "Stop" on your own Lantern → DELETE /v1/u3/lantern/:chatId.
//  - Sending a Whisper / lighting a Lantern from the web only shows when the beta (sonar.whisper / sonar.lantern) is on.
import { api, API, token, publicUrl } from "./api.js";
import { h, toast, errText, menu, promptBox, confirmBox, enc } from "./dom.js";
import { state } from "./state.js";
import { initU3, locateOnce, betaList, betaOn, betaOnNow, geoStart, geoStop, geoHas, keepalive, mapIcon, faceEl, agoText, clockText, distM, distText, geo, makeMap, pinEl, meDot, fitTo, injectCss, mountTideMap } from "./u3map.js";

initU3({
  api: (p, o) => api(p, o), apiBase: API, token: () => token, myId: () => state.me?.id || null,
  avatarUrl: (k) => publicUrl(k), profileHref: (u) => `#/u/${enc(u?.username || "")}`,
  betaId: "sonar.tide_map", mapHref: "#/map", toast: (m) => toast(m),
});
if (token) betaList();   // warm the beta cache for menus

export const WHISPER_FALLBACK = "🤫 Whisper — press and hold to read it in Sonar";
const reloadChat = (chatId) => import("./chats.js").then((m) => m.loadMessages(chatId)).catch(() => {});

// ------------------------------------------------------------------ Tide Map entry + page
/** Map button for the Chats header; shows itself only when the Tide Map beta is on. */
export function tideMapButton() {
  const a = h("a", { class: "icon-btn", href: "#/map", "aria-label": "Tide Map", title: "Tide Map", hidden: true }, mapIcon());
  betaOn("sonar.tide_map").then((on) => { a.hidden = !on; });
  return a;
}
/** Main pane for #/map (lives in the Chats tab, like channels). */
export function tideMapMain(el) { return mountTideMap(el, { layout: "split", backHref: "#/chats" }); }

// ------------------------------------------------------------------ message content hook
/** Returns the content for Whisper / Lantern messages, or null for every other message. */
export function u3Content(m, ctx) {
  const x = m.x || {};
  if (m.deleted) return null;
  if (x.lantern) return [lanternCard(m, ctx)];
  if (x.whisper && typeof x.whisper.text === "string") return [whisperEl(m)];
  return null;
}

// ------------------------------------------------------------------ Whisper
function whisperEl(m) {
  injectStyles();
  const secret = m.x.whisper.text;
  // the blurred part is filler of about the same length — the real text is only in the page while you hold
  const filler = secret.replace(/\S/g, "▆").slice(0, 160) || "▆▆▆▆";
  const text = h("div", { class: "u3w-text", hidden: true });
  const box = h("div", { class: "u3w", role: "button", tabindex: "0", "aria-label": "Whisper. Press and hold to read it." },
    h("div", { class: "u3w-blur", "aria-hidden": "true" }, filler),
    h("div", { class: "u3w-hint" }, "🤫 Press and hold to read"), text);
  let open = false;
  const show = () => { if (open) return; open = true; text.textContent = secret; text.hidden = false; box.classList.add("open"); box.setAttribute("aria-label", "Whisper: " + secret); };
  const hide = () => { if (!open) return; open = false; text.textContent = ""; text.hidden = true; box.classList.remove("open"); box.setAttribute("aria-label", "Whisper. Press and hold to read it."); };
  box.addEventListener("pointerdown", (e) => { if (e.button > 0) return; e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch {} show(); });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) box.addEventListener(ev, hide);
  box.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); e.stopPropagation(); show(); } });
  box.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); hide(); } });
  box.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });   // long-press on phones = read, not the menu
  box.addEventListener("dblclick", (e) => e.stopPropagation());
  box._hide = hide;
  return box;
}

// leaving the tab hides any Whisper being read
document.addEventListener("visibilitychange", () => { for (const b of document.querySelectorAll(".u3w.open")) b._hide?.(); });

// ------------------------------------------------------------------ Lantern
// One poller per chat serves every Lantern card in it.
const watchers = new Map();   // chatId → {cards:Set, timer, data, busy}
function watch(chatId, card) {
  let w = watchers.get(chatId);
  if (!w) { w = { cards: new Set(), timer: null, data: null, busy: false }; watchers.set(chatId, w); }
  w.cards.add(card);
  if (w.data) card.update(w.data);
  if (!w.timer && !w.busy) setTimeout(() => poll(chatId), 0);
}
async function poll(chatId) {
  const w = watchers.get(chatId); if (!w) return;
  clearTimeout(w.timer); w.timer = null;
  for (const c of [...w.cards]) if (!c.el.isConnected && (c.seen || Date.now() - c.born > 10_000)) { w.cards.delete(c); c.dispose(); }
  if (!w.cards.size) { watchers.delete(chatId); return; }
  if (!document.hidden && [...w.cards].some((c) => c.el.isConnected)) {
    w.busy = true;
    try { w.data = await api(`/v1/u3/lantern/${enc(chatId)}`); w.data._at = Date.now(); w.err = ""; }
    catch (e) { w.err = e.status === 404 ? "Live location isn't available on this server yet." : errText(e); }
    w.busy = false;
    for (const c of w.cards) c.update(w.data, w.err);
  }
  for (const c of w.cards) if (c.el.isConnected) c.seen = true;
  if ([...w.cards].some((c) => c.active())) w.timer = setTimeout(() => poll(chatId), Math.max(5, Number(w.data?.poll) || 5) * 1000);
  else watchers.delete(chatId);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) for (const id of watchers.keys()) poll(id); });

let openMapCard = null;
function lanternCard(m, ctx) {
  injectStyles();
  const chatId = m.chatId || ctx.chat?.id;
  const L = m.x.lantern || {};
  const by = L.by || m.senderId;
  const meId = ctx.meId;
  const mine = by === meId;
  const who = mine ? "You" : ctx.names(by);
  const ended0 = !!L.ended || !(Number(L.until) > Date.now());
  const el = h("div", { class: "u3l" + (ended0 ? " ended" : "") });
  const headTxt = h("div", { class: "grow" });
  const people = h("div", { class: "u3l-people", "aria-live": "polite" });
  const mapBox = h("div", { class: "u3l-map", hidden: true, role: "region", "aria-label": "Lantern map" });
  const acts = h("div", { class: "u3l-acts" });
  el.append(h("div", { class: "u3l-head" }, h("span", { "aria-hidden": "true" }, "📍"), headTxt), people, mapBox, acts);
  let data = null, ended = ended0, mapObj = null, ml = null, marks = new Map(), meMark = null, fitted = false;
  let lastErr = "";
  const until = () => Number(data?.items?.find((i) => i.user?.id === by)?.until) || Number(L.until) || 0;
  const isActive = () => !ended && until() > Date.now();

  const paintHead = () => {
    if (!isActive()) {
      const at = Number(L.ended) || Math.min(Number(L.until) || Date.now(), Date.now());
      headTxt.replaceChildren(h("b", {}, mine ? "Your Lantern ended" : `${who}'s Lantern ended`), h("div", { class: "small", style: "opacity:.8" }, `Live location · ended ${clockText(at)}`));
    } else headTxt.replaceChildren(h("b", {}, `${who} ${mine ? "are" : "is"} sharing live location`), h("div", { class: "small", style: "opacity:.8" }, `until ${clockText(until())}`));
  };
  const paintActs = () => {
    const active = isActive();
    acts.replaceChildren(
      active && data?.items?.some((i) => i.lat != null) ? h("button", { type: "button", class: "small tonal", "aria-expanded": String(!mapBox.hidden), onclick: toggleMap }, mapBox.hidden ? "Show map" : "Hide map") : null,
      active && mine && !geoHas("lantern:" + chatId) ? h("button", { type: "button", class: "small tonal", title: "Send your location from this tab while it's open", onclick: () => shareHere(chatId).then(paintActs) }, "Share from this tab") : null,
      active && mine ? h("button", { type: "button", class: "small danger", onclick: stop }, "Stop") : null);
  };
  const paintPeople = () => {
    if (!isActive()) { people.replaceChildren(); return; }
    if (!data) { people.replaceChildren(h("div", { class: "small", style: "opacity:.8" }, lastErr || "Finding where everyone is…")); return; }
    const t = Date.now() + (data.now ? data.now - data._at : 0);
    const myPos = geo.pos && Date.now() - geo.pos.at < 10 * 60_000 ? geo.pos : data.items.find((i) => i.mine && i.lat != null);
    people.replaceChildren(...(data.items.length ? data.items : []).map((i) => h("div", { class: "u3l-p" }, faceEl(i.user, "u3m-av sm"),
      h("div", { class: "grow" }, h("b", {}, i.mine ? "You" : i.user?.name || i.user?.username || ctx.names(i.user?.id)),
        h("div", { class: "small", style: "opacity:.8" }, i.lat == null ? "Waiting for a fresh spot…" : [`updated ${agoText(i.at, t)}`, !i.mine && myPos?.lat != null ? distText(distM(myPos, i)) : null, `until ${clockText(i.until)}`].filter(Boolean).join(" · "))))),
    !data.items.length ? h("div", { class: "small", style: "opacity:.8" }, "Nobody is sharing right now.") : null,
    lastErr ? h("div", { class: "small", style: "opacity:.8" }, lastErr) : null);
  };
  async function toggleMap() {
    if (!mapBox.hidden) { closeMap(); paintActs(); return; }
    if (openMapCard && openMapCard !== card) openMapCard.closeMap();
    openMapCard = card; mapBox.hidden = false; paintActs();
    try { ({ ml, map: mapObj } = await makeMap(mapBox, { zoom: 2 })); paintMap(); }
    catch (e) { mapBox.replaceChildren(h("div", { class: "u3m-note" }, (e?.message || "The map couldn't load.") + " The list above still works.")); }
  }
  function closeMap() {
    try { mapObj?.remove(); } catch {}
    mapObj = null; marks.clear(); meMark = null; fitted = false; mapBox.replaceChildren(); mapBox.hidden = true;
    if (openMapCard === card) openMapCard = null;
  }
  function paintMap() {
    if (!mapObj || !data) return;
    const seen = new Set(), pts = [];
    for (const i of data.items) {
      if (i.lat == null || !i.user?.id) continue;
      seen.add(i.user.id); pts.push([i.lng, i.lat]);
      const mk = marks.get(i.user.id);
      if (mk) mk.setLngLat([i.lng, i.lat]);
      else marks.set(i.user.id, new ml.Marker({ element: pinEl(i.user, { live: true, hdg: i.hdg }) }).setLngLat([i.lng, i.lat]).addTo(mapObj));
    }
    for (const [id, mk] of marks) if (!seen.has(id)) { mk.remove(); marks.delete(id); }
    if (geo.pos && !seen.has(meId)) { if (!meMark) meMark = new ml.Marker({ element: meDot() }).setLngLat([geo.pos.lng, geo.pos.lat]).addTo(mapObj); else meMark.setLngLat([geo.pos.lng, geo.pos.lat]); pts.push([geo.pos.lng, geo.pos.lat]); }
    if (!fitted && pts.length) { fitted = true; fitTo(mapObj, ml, pts); }
  }
  async function stop() {
    if (!(await confirmBox("Stop sharing your location?", "Your Lantern goes out for everyone in this chat.", "Stop"))) return;
    try {
      await api(`/v1/u3/lantern/${enc(chatId)}`, { method: "DELETE" });
      if (geoHas("lantern:" + chatId)) geoStop("lantern:" + chatId, "");
      ended = true; paint(); reloadChat(chatId);
    } catch (e) { toast(errText(e)); }
  }
  function paint() { el.classList.toggle("ended", !isActive()); paintHead(); paintPeople(); paintActs(); if (!isActive()) closeMap(); }
  const card = {
    el, seen: false, born: Date.now(),
    active: () => isActive(),
    update(d, e) {
      lastErr = e || "";
      if (d) {
        data = d;
        // my own lit Lantern vanished from the list → it ended (stopped on another device / timed out)
        if (!d.items.some((i) => i.user?.id === by) && Date.now() - Number(m.createdAt || 0) > 15_000) ended = true;
      }
      paint(); paintMap();
    },
    closeMap,
    dispose() { closeMap(); },
  };
  paint();
  if (isActive() && chatId) watch(chatId, card);
  return el;
}

// ------------------------------------------------------------------ composer extras (beta-gated)
/** Items for the composer's "+" menu (synchronous; the beta list is fetched early). */
export function composerItems(chat, send) {
  if (!chat || chat.type === "channel") return [];
  if (!betaOnNow("sonar.whisper") && !betaOnNow("sonar.lantern")) { betaList(); return []; }
  return [
    betaOnNow("sonar.whisper") ? { label: "Send a Whisper", icon: "eye", onclick: () => whisperModal(send) } : null,
    betaOnNow("sonar.lantern") ? { label: "Share live location (Lantern)", icon: "ping", onclick: () => lanternMenu(chat.id) } : null,
  ];
}
async function whisperModal(send) {
  const t = await promptBox("Send a Whisper", { multiline: true, placeholder: "They'll have to press and hold to read it", okLabel: "Send Whisper" });
  const text = (t || "").trim();
  if (!text) return;
  send({ type: "text", text: WHISPER_FALLBACK, whisper: { text: text.slice(0, 4000) } }).catch(() => {});
}
function lanternMenu(chatId) {
  menu({ x: innerWidth / 2 - 120, y: innerHeight / 2 - 80 }, [
    ...[[15, "For 15 minutes"], [60, "For 1 hour"], [480, "For 8 hours"]].map(([min, label]) => ({ label, icon: "clock", onclick: () => lightLantern(chatId, min) })),
  ], { label: "Share live location" });
}
async function lightLantern(chatId, minutes) {
  if (!(await confirmBox("Share your live location in this chat?",
    "Everyone in this chat can follow you on a map until it ends or you stop it. From the web, your location is only sent while this tab is open and in front — close it or leave it in the background for 2 minutes and the Lantern goes out. For longer sharing, use Sonar on your phone.", "Share"))) return;
  try {
    await locateOnce();   // location permission first, so a "no" never lights a Lantern that can't update
    await api("/v1/u3/lantern", { method: "POST", body: { chatId, minutes } });
    await geoStartLantern(chatId);
    reloadChat(chatId);
    toast("Lantern lit — your location is shared while this tab is open");
  } catch (e) {
    if (geoHas("lantern:" + chatId)) geoStop("lantern:" + chatId, "");
    toast(errText(e));
  }
}
/** Send my position for this chat's Lantern from this tab (asks for location permission first). */
async function geoStartLantern(chatId) {
  await geoStart("lantern:" + chatId, {
    onEnd: (why) => { if (why) { api(`/v1/u3/lantern/${enc(chatId)}`, { method: "DELETE" }).then(() => reloadChat(chatId), () => {}); toast(why); } },
    onUnload: () => keepalive(`/v1/u3/lantern/${enc(chatId)}`, "DELETE"),
    check: (r) => (r && r.lantern === false ? "Your Lantern ended." : ""),
  });
}
async function shareHere(chatId) {
  try { await geoStartLantern(chatId); toast("Sharing from this tab while it's open"); }
  catch (e) { toast(errText(e)); }
}

// ------------------------------------------------------------------ styles
let stylesDone = false;
function injectStyles() {
  if (stylesDone) return; stylesDone = true;
  injectCss();
  document.head.append(h("style", { "data-u3": "social" }, `
.u3w{display:grid;gap:2px;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y;min-width:150px;border-radius:10px;outline-offset:3px}
.u3w-blur{filter:blur(5px);opacity:.7;overflow-wrap:anywhere;line-height:1.3}
.u3w-hint{font-size:.8125rem;opacity:.85}
.u3w.open .u3w-blur,.u3w.open .u3w-hint{display:none}
.u3w-text{white-space:pre-wrap;overflow-wrap:anywhere}
.u3l{display:grid;gap:8px;min-width:min(270px,64vw)}
.u3l-head{display:flex;gap:8px;align-items:flex-start}
.u3l-head .grow{flex:1;min-width:0}
.u3l-people{display:grid;gap:6px}
.u3l-p{display:flex;gap:8px;align-items:center;font-size:.875rem}
.u3l-p .grow{flex:1;min-width:0}
.u3l-map{height:210px;border-radius:12px;overflow:hidden;position:relative;background:var(--surface2)}
.u3l-acts{display:flex;gap:6px;flex-wrap:wrap}
.u3l-acts:empty{display:none}
.u3l.ended{opacity:.85}
.msg.mine .u3l button.tonal{background:color-mix(in srgb,#fff 22%,transparent);color:inherit}
.u3l .u3m-av.sm{border:2px solid color-mix(in srgb,currentColor 25%,transparent)}
`));
}

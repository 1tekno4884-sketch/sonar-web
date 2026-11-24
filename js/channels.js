// Channels: one-way chats (type "channel"). Admins post; subscribers read and react.
//   #/channels       → Discover: search + most subscribed, Subscribe / Subscribed, "New channel"
//   #/channel/<id>   → the conversation if you're subscribed (or an admin), else a preview card with Subscribe
// The conversation itself is the normal one in chats.js; this module adds the pages, the create form and the
// channel info / settings panel. API: docs/SONAR_API.md → Channels.
import { get, post, patch, del, items, upload } from "./api.js";
import { h, icon, iconBtn, toast, errText, modal, closeModal, confirmBox, avatar, badges, enc, fmt, debounce } from "./dom.js";
import { state, emit, myId } from "./state.js";
import { mainEmpty, backBtn } from "./layout.js";
import { prepareImage } from "./media.js";
import { flairAvatar, flairName } from "./identity.js";   // U2-identity
import { loadChats, markLocalRead } from "./chats.js";

export const isChannel = (c) => c?.type === "channel";
export const isChannelAdmin = (c) => isChannel(c) && (c.admins || []).includes(myId());
export const subsText = (n) => `${fmt(n)} subscriber${Number(n) === 1 ? "" : "s"}`;
export const channelWebLink = (id) => `${location.origin}${location.pathname}#/channel/${enc(id)}`;
export const channelAppLink = (id) => `sonar://open?k=channel&id=${enc(id)}`;

// GET /v1/channels/:id results (subscriber count, owner) — chat JSON only lists the admins
const info = new Map();
export const channelCached = (id) => info.get(id) || null;
export async function fetchChannel(id) {
  const ch = await get(`/v1/channels/${enc(id)}`);
  info.set(id, ch);
  emit("channel:" + id, ch);
  return ch;
}

/** Subscribe / unsubscribe. Updates the chat list; returns the fresh channel JSON. */
export async function setSubscribed(id, on) {
  const ch = await post(`/v1/channels/${enc(id)}/join`, { on: !!on });
  info.set(id, ch);
  if (on) markLocalRead(id);          // don't flag the latest old post as unread
  else { state.chats.delete(id); state.msgs.delete(id); }
  emit("channel:" + id, ch);
  emit("chats");
  loadChats();
  return ch;
}

export async function leaveChannel(c) {
  const name = c.name || "this channel";
  if (!(await confirmBox(`Leave ${name}?`, "You'll stop seeing its posts. You can subscribe again any time.", "Leave", true))) return false;
  try { await setSubscribed(c.id, false); toast("Left the channel"); location.hash = "#/chats"; return true; }
  catch (e) { toast(errText(e)); return false; }
}

async function copy(text, done = "Link copied") {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast("Couldn't copy — select the link and copy it"); }
}

/** Photo file → public upload key (purpose "group" is always public, served at /media/). */
async function uploadPhoto(file) {
  const p = await prepareImage(file);
  const r = await upload(p.blob, { purpose: "group", mime: p.mime });
  return r.key;
}
const isImage = (f) => !!f && /^image\/(jpeg|png|webp|gif)$/.test(f.type);

// ------------------------------------------------------------------ discover (#/channels)
function subscribeBtn(ch, onChange) {
  const btn = h("button", { type: "button", class: "small" });
  const paint = () => {
    btn.textContent = ch.subscribed ? "Subscribed" : "Subscribe";
    btn.className = "small" + (ch.subscribed ? " tonal" : "");
    btn.setAttribute("aria-pressed", String(!!ch.subscribed));
    btn.setAttribute("aria-label", `Subscribe to ${ch.name}`);
  };
  paint();
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const fresh = await setSubscribed(ch.id, !ch.subscribed);
      Object.assign(ch, fresh);
      toast(ch.subscribed ? `Subscribed to ${ch.name}` : `Unsubscribed from ${ch.name}`);
      paint(); onChange?.(ch);
    } catch (e) { toast(errText(e)); }
    btn.disabled = false;
  };
  return btn;
}

function channelRow(ch) {
  const count = h("div", { class: "l3" }, subsText(ch.subscribers));
  const link = h("a", { class: "rowbtn", href: `#/channel/${enc(ch.id)}`, "aria-label": `${ch.name}, ${subsText(ch.subscribers)}${ch.description ? ". " + ch.description : ""}` },
    avatar(ch.photo, ch.name),
    h("div", { class: "body" },
      h("div", { class: "l1" }, h("span", { class: "name" }, h("span", { class: "t" }, ch.name)), chanMark()),
      h("div", { class: "l2" }, h("span", { class: "pv" }, ch.description || "No description")),
      count));
  const side = ch.admin ? h("span", { class: "chip" }, ch.ownerId === myId() ? "Yours" : "Admin")
    : subscribeBtn(ch, (x) => { count.textContent = subsText(x.subscribers); });
  return h("div", { class: "chan-row" }, link, side);
}

/** The small megaphone that marks a channel. */
export const chanMark = (label = false) => h("span", { class: "chan-mark", title: "Channel", ...(label ? {} : { "aria-hidden": "true" }) }, icon("megaphone"), label ? "Channel" : null);

export function renderDiscover(el) {
  const q = h("input", { type: "search", placeholder: "Search channels", "aria-label": "Search channels", autocomplete: "off" });
  const title = h("div", { class: "section-title" }, "Most subscribed");
  const status = h("div", { class: "meta", role: "status", "aria-live": "polite" }, "Loading…");
  const list = h("div", { class: "rows", role: "list", "aria-label": "Channels" });
  let seq = 0;
  const load = async () => {
    const s = q.value.trim(), my = ++seq;
    title.textContent = s ? "Results" : "Most subscribed";
    status.textContent = "Loading…";
    try {
      const j = await get(`/v1/channels${s ? `?q=${enc(s)}` : ""}`);
      if (my !== seq) return;
      const its = items(j);
      its.forEach((ch) => info.set(ch.id, ch));
      list.replaceChildren(...its.map((ch) => h("div", { role: "listitem" }, channelRow(ch))));
      status.textContent = its.length ? "" : s ? "No channels match" : "No channels yet — start the first one.";
    } catch (e) { if (my === seq) { list.replaceChildren(); status.textContent = errText(e); } }
  };
  q.addEventListener("input", debounce(load, 300));
  q.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); list.querySelector("a")?.focus(); } });
  el.append(h("section", { class: "profile chan-page", "aria-label": "Discover channels" },
    h("div", { class: "top-bar" }, backBtn("#/chats", "Back to chats"), h("h1", { class: "grow" }, "Channels"),
      h("button", { type: "button", class: "chan-new", onclick: () => newChannelModal() }, icon("plus"), "New channel")),
    h("div", { class: "body" },
      h("p", { class: "meta" }, "Channels are one-way: their admins post, subscribers read and react. Subscribed channels show up in your chats."),
      h("div", { class: "searchbox" }, icon("search"), q),
      title, status, list)));
  load();
  if (matchMedia("(min-width: 761px)").matches) setTimeout(() => q.focus(), 50);
  return null;
}

// ------------------------------------------------------------------ preview (#/channel/<id>, not subscribed)
/** Opens the channel: the conversation if you're in it, else a preview card. `openConv(el, id)` renders the chat. */
export async function renderChannelRoute(el, id, openConv) {
  if (!id) return renderDiscover(el);
  if (state.chats.has(id)) return openConv(el, id);
  let ch;
  try { ch = await fetchChannel(id); }
  catch (e) {
    el.append(h("div", { class: "profile" }, h("div", { class: "top-bar" }, backBtn("#/channels", "Back to channels")),
      mainEmpty("Channel not found", e.status === 404 ? "It may have been deleted, or the link is wrong." : errText(e), h("a", { href: "#/channels" }, "Discover channels"))));
    return null;
  }
  if (ch.subscribed || ch.admin) return openConv(el, id);
  const sub = h("button", { type: "button" }, icon("plus"), "Subscribe");
  sub.onclick = async () => {
    sub.disabled = true;
    try { await setSubscribed(id, true); toast(`Subscribed to ${ch.name}`); location.hash = `#/chat/${enc(id)}`; }
    catch (e) { toast(errText(e)); sub.disabled = false; }
  };
  const o = ch.owner;
  el.append(h("section", { class: "profile", "aria-label": `Channel ${ch.name}` },
    h("div", { class: "top-bar" }, backBtn("#/channels", "Back to channels"), h("span", { class: "grow" }),
      h("a", { class: "chip", href: "#/channels" }, "Discover channels")),
    h("div", { class: "body chan-card" },
      avatar(ch.photo, ch.name, "big"),
      h("h1", {}, ch.name),
      h("div", { class: "meta" }, chanMark(true), " · ", subsText(ch.subscribers)),
      ch.description ? h("p", { class: "bio" }, ch.description) : null,
      o ? h("div", { class: "meta by" }, "By ", h("a", { href: `#/u/${enc(o.username)}` }, flairAvatar(o, "xs", avatar(o.avatar, o.name || o.username, "xs")), h("span", {}, flairName(o, o.name || o.username)), badges(o.badges, { dev: false }))) : null,
      h("div", { class: "actions" }, sub, h("button", { type: "button", class: "tonal", onclick: () => copy(channelWebLink(id)) }, icon("link"), "Copy link")),
      h("p", { class: "meta" }, "Only the channel's admins post here. Subscribers can read and react."))));
  setTimeout(() => sub.focus(), 50);
  return null;
}

// ------------------------------------------------------------------ create
function photoPicker(initialKey, name) {
  let file = null, removed = false;
  const prev = h("span", { class: "chan-photo" });
  const inp = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const pick = h("button", { type: "button", class: "tonal small" }, icon("image"), "Choose photo");
  const clear = h("button", { type: "button", class: "ghost small" }, "Remove");
  let url = null;
  const paint = () => {
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (file) { url = URL.createObjectURL(file); prev.replaceChildren(h("img", { class: "avatar lg", src: url, alt: "Selected photo" })); }
    else prev.replaceChildren(avatar(removed ? null : initialKey, name() || "?", "lg"));
    clear.hidden = !file && (removed || !initialKey);
  };
  pick.onclick = () => inp.click();
  clear.onclick = () => { file = null; removed = true; paint(); pick.focus(); };
  inp.onchange = () => { const f = inp.files[0]; inp.value = ""; if (!f) return; if (!isImage(f)) return toast("Pick a JPEG, PNG, WebP or GIF image"); file = f; removed = false; paint(); };
  paint();
  return { el: h("div", { class: "row chan-photo-row" }, prev, pick, clear, inp), get file() { return file; }, get removed() { return removed; }, repaint: paint };
}

export function newChannelModal() {
  const name = h("input", { maxlength: "60", placeholder: "Channel name", autocomplete: "off", required: true, autofocus: true });
  const desc = h("textarea", { maxlength: "500", rows: "3", placeholder: "What will you post about? (optional)" });
  const photo = photoPicker(null, () => name.value.trim());
  name.addEventListener("input", () => { if (!photo.file) photo.repaint(); });
  const err = h("div", { class: "err", role: "alert" });
  const go = h("button", { type: "submit" }, "Create channel");
  const form = h("form", { class: "stack chan-form", novalidate: true },
    h("h2", {}, "New channel"),
    h("p", { class: "meta" }, "Only you post in your channel; anyone can find it and subscribe. You can have up to 5."),
    h("label", {}, "Name", name),
    h("label", {}, "Description", desc),
    h("div", { class: "lbl" }, "Photo (optional)"), photo.el,
    err,
    h("div", { class: "row end" }, h("button", { type: "button", class: "tonal", onclick: () => closeModal() }, "Cancel"), go));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (n.length < 2) { err.textContent = "Give your channel a name (at least 2 characters)."; name.focus(); return; }
    go.disabled = true; err.textContent = "";
    try {
      let key;
      if (photo.file) { go.textContent = "Uploading photo…"; key = await uploadPhoto(photo.file); }
      go.textContent = "Creating…";
      const ch = await post("/v1/channels", { name: n, description: desc.value.trim(), ...(key ? { photo: key } : {}) });
      info.set(ch.id, ch);
      closeModal();
      toast("Channel created");
      await loadChats();
      location.hash = `#/chat/${enc(ch.id)}`;
    } catch (e2) { err.textContent = errText(e2); go.disabled = false; go.textContent = "Create channel"; }
  });
  modal(form, { label: "New channel" });
}

// ------------------------------------------------------------------ info / settings panel
/** Channel info. Admins edit name / description / photo; the owner can delete; everyone can copy the link. */
export function channelInfo(c0) {
  const id = c0.id;
  const chat = () => state.chats.get(id) || c0;
  const c = chat();
  const admin = isChannelAdmin(c), owner = c.createdBy === myId();
  const count = h("span", {}, channelCached(id) ? subsText(channelCached(id).subscribers) : "");
  const by = h("div", { class: "meta by" });
  const paintMeta = (ch) => {
    count.textContent = subsText(ch.subscribers);
    const o = ch.owner;
    by.replaceChildren(o ? ["By ", h("a", { href: `#/u/${enc(o.username)}`, onclick: () => closeModal() }, flairAvatar(o, "xs", avatar(o.avatar, o.name || o.username, "xs")), h("span", {}, flairName(o, o.name || o.username)), badges(o.badges, { dev: false }))] : []);
  };
  if (channelCached(id)) paintMeta(channelCached(id));
  fetchChannel(id).then(paintMeta, () => {});

  const apply = (fresh) => { const cur = chat(); Object.assign(cur, fresh); state.chats.set(id, cur); emit("chat:" + id, { meta: true }); emit("chats"); };
  const linkInp = h("input", { readonly: true, value: channelWebLink(id), "aria-label": "Channel link", onfocus: (e) => e.target.select() });
  const share = h("div", { class: "stack" }, h("h3", {}, "Share"),
    h("div", { class: "row chan-link" }, linkInp, h("button", { type: "button", class: "small", onclick: () => copy(channelWebLink(id)) }, "Copy")),
    h("div", { class: "row" }, h("button", { type: "button", class: "ghost small", onclick: () => copy(channelAppLink(id), "App link copied") }, icon("link"), "Copy app link"),
      h("span", { class: "meta" }, "Opens the channel in the Sonar app")));

  let body;
  if (admin) {
    const name = h("input", { maxlength: "60", value: c.name || "", autocomplete: "off" });
    const desc = h("textarea", { maxlength: "500", rows: "3", placeholder: "What's this channel about?" }, c.description || "");
    const photo = photoPicker(c.photo, () => name.value.trim());
    const err = h("div", { class: "err", role: "alert" });
    const save = h("button", { type: "submit" }, "Save");
    const form = h("form", { class: "stack chan-form", novalidate: true },
      h("label", {}, "Name", name), h("label", {}, "Description", desc),
      h("div", { class: "lbl" }, "Photo"), photo.el, err, h("div", { class: "row end" }, save));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = chat();
      const n = name.value.trim(), d = desc.value.trim();
      if (n.length < 2) { err.textContent = "The name needs at least 2 characters."; name.focus(); return; }
      const body = {};
      if (n !== (cur.name || "")) body.name = n;
      if (d !== (cur.description || "")) body.description = d;
      save.disabled = true; err.textContent = "";
      try {
        if (photo.file) { save.textContent = "Uploading photo…"; body.photo = await uploadPhoto(photo.file); }
        else if (photo.removed && cur.photo) body.photo = null;
        if (!Object.keys(body).length) { toast("Nothing to save"); return; }
        save.textContent = "Saving…";
        apply(await patch(`/v1/chats/${enc(id)}`, body));
        toast("Channel updated");
        closeModal();
      } catch (e2) { err.textContent = errText(e2); }
      finally { save.disabled = false; save.textContent = "Save"; }
    });
    body = [form];
  } else {
    body = [c.description ? h("p", { class: "bio" }, c.description) : null];
  }

  const danger = owner
    ? h("button", { type: "button", class: "danger small", onclick: async () => {
      const cur = chat();
      if (!(await confirmBox(`Delete ${cur.name || "this channel"}?`, "This deletes the channel and every post in it for all subscribers. It can't be undone.", "Delete channel", true))) { channelInfo(cur); return; }
      try { await del(`/v1/channels/${enc(id)}`); state.chats.delete(id); state.msgs.delete(id); info.delete(id); emit("chats"); toast("Channel deleted"); location.hash = "#/chats"; loadChats(); }
      catch (e) { toast(errText(e)); }
    } }, icon("trash"), "Delete channel")
    : h("button", { type: "button", class: "danger small", onclick: () => { closeModal(); leaveChannel(chat()); } }, "Leave channel");

  modal(h("div", { class: "stack chan-info" },
    h("div", { class: "row", style: "flex-wrap:nowrap;align-items:flex-start" }, admin ? null : avatar(c.photo, c.name, "lg"), h("div", { class: "grow" }, h("h2", {}, c.name || "Channel"), h("div", { class: "meta" }, chanMark(true), " · ", count), by),
      iconBtn("close", "Close", () => closeModal())),
    body, share, h("div", { class: "row" }, danger)), { label: "Channel info", wide: true });
}

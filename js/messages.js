// Renders one chat message (every Ripple + Sonar type). Text only from user data → no HTML injection.
import { h, icon, iconBtn, rich, avatar, clock, bytes, dur, bigEmojiCount, enc } from "./dom.js";
import { mediaUrl, safeHref, safeKey, get } from "./api.js";
import { getS } from "./settings.js";
import { voicePlayer } from "./media.js";
import { RIPPLE_WEB_URL } from "../config.js";
import { richText } from "./custom.js";   // U2-custom: Tidewrite rich text
import { flairAvatar, flairName, ribbonsHtml, hasOwnerBubble } from "./identity.js";   // U2-identity
import { u3Content } from "./u3social.js";   // U3-social: Whisper + Lantern

const GAMES = { ttt: "Tic-tac-toe", c4: "Connect four", word: "Word guess", rps: "Rock paper scissors", trivia: "Trivia duel" };
const HIDE_TEXT = { sticker: true, poll: true, game: true, ping: true, call: true };
const FALLBACKS = new Set(["🖼 Photos", "🖼 Album", "Sticker", "📎 File", "📊 Poll", "🎮 Game", "📡 Ping"]);

/** Which messages start/end a run (same sender within 5 minutes) — for avatars, names and bubble tails. */
export function runInfo(list, i) {
  const m = list[i], p = list[i - 1], n = list[i + 1];
  const same = (a, b) => a && b && a.senderId === b.senderId && Math.abs(a.createdAt - b.createdAt) < 5 * 60_000 && a.type !== "call" && b.type !== "call"
    && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
  return { first: !same(p, m), last: !same(m, n) };
}

const postCache = new Map();
function postCard(id) {
  const href = `${RIPPLE_WEB_URL}#/p/${enc(id)}`;
  const box = h("a", { class: "postcard", href, target: "_blank", rel: "noopener", "aria-label": "Shared Ripple post — open in Ripple" },
    h("div", { class: "ph" }, h("b", {}, "Ripple post")), h("div", { class: "pt meta" }, "Loading…"), h("div", { class: "open" }, "Open in Ripple ↗"));
  const fill = (p) => {
    if (!p) { box.children[1].textContent = "This post is private, was removed, or doesn't exist."; return; }
    const a = p.author || {};
    const m = (p.media || []).find((x) => x.b === "pub" && safeKey(x.thumb || x.key));
    box.replaceChildren(
      h("div", { class: "ph" }, flairAvatar(a, "xs", avatar(a.avatar, a.name, "xs")), h("b", {}, flairName(a, a.name || a.username || "Someone")), h("span", { class: "meta" }, "@" + (a.username || ""))),   // U2-identity
      m ? h("img", { src: mediaUrl(m.thumb || m.key, "pub"), alt: m.alt || "", loading: "lazy" }) : null,
      (p.title || p.text || p.body) ? h("div", { class: "pt" }, [p.title, p.text || p.body].filter(Boolean).join(" — ")) : null,
      h("div", { class: "open" }, "Open in Ripple ↗"));
  };
  if (postCache.has(id)) fill(postCache.get(id));
  else get(`/v1/posts/${enc(id)}`).then((p) => { postCache.set(id, p); fill(p); }, () => { postCache.set(id, null); fill(null); });
  return box;
}

function stickerEl(st) {
  const fb = h("div", { class: "sticker-fallback", role: "img", "aria-label": "Sticker" }, h("b", {}, "🫧"), "Sticker");
  let src = null;
  if (st.pack === "custom" && st.key) src = mediaUrl(st.key, "prv");
  else if (/^[a-z0-9_-]{1,40}$/i.test(st.pack) && /^[a-z0-9_-]{1,60}$/i.test(st.id)) src = `stickers/${st.pack}/${st.id}.png`;
  if (!src) return fb;
  const img = h("img", { class: "sticker", src, alt: `Sticker ${st.id || ""}`.trim(), loading: "lazy" });
  img.onerror = () => img.replaceWith(fb);
  return img;
}

function pollEl(m, ctx) {
  const p = m.x.poll, me = ctx.meId;
  const mine = (p.votes && p.votes[me]) || [];
  const counts = p.tally || p.options.map((_, i) => Object.values(p.votes || {}).filter((v) => (v || []).includes(i)).length);
  const total = p.tally ? p.voters || 0 : Object.keys(p.votes || {}).length;
  const box = h("div", { class: "poll", role: "group", "aria-label": "Poll: " + p.q });
  box.append(h("div", { class: "q" }, "📊 ", p.q || "Poll"));
  p.options.forEach((o, i) => {
    const pc = total ? Math.round((counts[i] || 0) * 100 / total) : 0;
    const on = mine.includes(i);
    box.append(h("button", { class: "opt" + (on ? " mine" : ""), type: "button", "aria-pressed": String(on), onclick: () => {
      const next = p.multi ? (on ? mine.filter((x) => x !== i) : [...mine, i]) : on ? [] : [i];
      ctx.vote(m, next);
    } }, h("span", { class: "bar", style: `width:${mine.length ? pc : 0}%` }), h("span", {}, on ? "◉ " : "○ ", o), mine.length ? h("span", { class: "pc" }, pc + "%") : null));
  });
  const who = !p.anon && total && ctx.names ? Object.keys(p.votes || {}).map((u) => ctx.names(u)).slice(0, 6).join(", ") : "";
  box.append(h("div", { class: "meta small", style: "color:inherit;opacity:.75" }, `${total} vote${total === 1 ? "" : "s"}`, p.multi ? " · multiple choice" : "", p.anon ? " · anonymous" : "", who ? ` · ${who}` : ""));
  return box;
}

function callEl(m, ctx) {
  const c = m.x.call || {};
  const missed = ["missed", "declined", "busy", "failed"].includes(c.status);
  const label = m.text?.replace(/^📞\s*/, "") || (c.kind === "video" ? "Video call" : "Voice call");
  return h("div", { class: "callent" + (missed ? " missed" : "") },
    icon(c.kind === "video" ? "video" : "phone"), h("div", { class: "grow" }, h("div", {}, h("b", {}, label))),
    h("button", { class: "small tonal", type: "button", onclick: () => ctx.callBack(c.kind === "video") }, "Call back"));
}

function mediaEl(md, ctx, m, list, i) {
  const url = mediaUrl(md.key, md.b);
  if (!url) return h("div", { class: "meta" }, "Media unavailable");
  if (md.kind === "video") {
    return h("video", { class: "media-img", src: url, poster: md.thumb ? mediaUrl(md.thumb, md.tb || md.b) : null, controls: true, preload: "metadata", playsinline: true, "aria-label": md.alt || "Video" });
  }
  const img = h("img", { class: "media-img", src: url, alt: md.alt || m.x?.alt || "Photo", loading: "lazy", tabindex: "0", role: "button" });
  if (md.w && md.h) img.style.aspectRatio = `${md.w} / ${md.h}`;
  const open = () => ctx.view(list || [{ url, kind: "image", alt: md.alt }], i || 0);
  img.onclick = open; img.onkeydown = (e) => { if (e.key === "Enter") open(); };
  return img;
}

function content(m, ctx) {
  const x = m.x || {};
  const out = [];
  if (m.deleted) return [h("div", { class: "txt" }, "This message was deleted")];
  const u3 = u3Content(m, ctx); if (u3) return u3;   // U3-social: Whisper (hold to read) / Lantern card
  if (x.mediaCleared || m.gone) out.push(h("div", { class: "meta", style: "color:inherit;opacity:.75" }, m.gone ? "🌊 Opened" : "Media expired"));
  const t = m.type;
  if ((t === "snap" || x.viewOnce) && !m.gone) {
    const mine = m.senderId === ctx.meId;
    const opened = m.openedBy && m.openedBy[ctx.meId];
    out.push(h("div", { class: "snapcard" }, icon(m.media?.kind === "video" ? "video" : "camera"),
      h("div", { class: "grow" }, h("b", {}, t === "snap" ? "Snap" : "View once"), h("div", { class: "small" }, mine ? "Opens once for them" : opened ? "Opened" : "Opens once")),
      !mine && !opened ? h("button", { class: "small", type: "button", onclick: (e) => ctx.openOnce(m, e.currentTarget) }, "Open") : null));
    return out;
  }
  if (t === "photo" || t === "video") { if (m.media && !x.mediaCleared) out.push(mediaEl(m.media, ctx, m)); }
  else if (t === "album") {
    const al = (x.album || []).filter((md) => safeKey(md.key));
    const list = al.map((md) => ({ url: mediaUrl(md.key, md.b), kind: md.kind === "video" ? "video" : "image", alt: md.alt }));
    if (al.length) out.push(h("div", { class: "album" }, al.slice(0, 4).map((md, i) => {
      const u = mediaUrl(md.key, md.b);
      const el = md.kind === "video"
        ? h("video", { src: u, poster: md.thumb ? mediaUrl(md.thumb, md.tb || md.b) : null, preload: "metadata", muted: true, playsinline: true })
        : h("img", { src: u, alt: md.alt || "Photo", loading: "lazy" });
      const cell = i === 3 && al.length > 4 ? h("div", { class: "more" }, el, h("span", {}, "+" + (al.length - 4))) : el;
      cell.tabIndex = 0; cell.setAttribute("role", "button"); cell.setAttribute("aria-label", `Open ${md.kind === "video" ? "video" : "photo"} ${i + 1} of ${al.length}`);
      cell.onclick = () => ctx.view(list, i); cell.onkeydown = (e) => { if (e.key === "Enter") ctx.view(list, i); };
      return cell;
    })));
  } else if (t === "voice") {
    if (m.media && !x.mediaCleared) out.push(voicePlayer(mediaUrl(m.media.key, m.media.b), m.media.key, m.media.dur));
  } else if (t === "gif") {
    const u = safeHref(m.gif);
    if (u) out.push(h("img", { class: "media-img", src: u, alt: "GIF", loading: "lazy" }));
  } else if (t === "post" && m.postRef) out.push(postCard(m.postRef));
  else if (t === "sticker" && x.sticker) out.push(stickerEl(x.sticker));
  else if (t === "file" && x.file) {
    const f = x.file;
    out.push(h("div", { class: "att" }, icon("file"), h("div", { class: "grow" }, h("div", { class: "nm", title: f.name }, f.name), h("div", { class: "small", style: "opacity:.75" }, bytes(f.size))),
      m.media && !x.mediaCleared ? h("button", { class: "icon-btn", type: "button", "aria-label": `Download ${f.name}`, title: "Download", onclick: () => ctx.download(m) }, icon("download")) : null));
  } else if (t === "poll" && x.poll) out.push(pollEl(m, ctx));
  else if (t === "call") out.push(callEl(m, ctx));
  else if (t === "ping") out.push(h("div", { class: "row", style: "gap:8px" }, icon("ping"), h("b", {}, "Sonar ping")));
  else if (t === "game" && x.game) out.push(h("div", { class: "gamecard" }, icon("game"), h("div", {}, h("b", {}, GAMES[x.game.kind] || "Chat game"), h("div", { class: "small", style: "opacity:.8" }, "Open Sonar on your phone to play"))));
  else if (t === "story_reply") out.push(h("div", { class: "small", style: "opacity:.75" }, "Replied to a story"));
  // text / caption
  const text = m.text || "";
  const showText = text && !HIDE_TEXT[t] && !(FALLBACKS.has(text) && t !== "text") && !(t === "file" && x.file && text === `📎 ${x.file.name}`);
  if (showText) {
    const big = t === "text" && getS("chat.bigEmoji") !== false && bigEmojiCount(text);
    const el = h("div", { class: "txt" }, richText(text, rich, { highlight: ctx.highlight }));   // U2-custom
    out.push(el);
    if (big) out.big = true;
  }
  if (x.link && safeHref(x.link.url) && getS("chat.linkPreviews") !== false) {
    const img = x.link.image && safeHref(x.link.image) && x.link.image.startsWith("https:") ? h("img", { src: x.link.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null;
    out.push(h("a", { class: "linkcard", href: safeHref(x.link.url), target: "_blank", rel: "noopener nofollow ugc" }, img,
      h("div", {}, h("b", {}, x.link.title || x.link.url), h("small", {}, x.link.site || ""))));
  }
  return out;
}

/**
 * ctx: { meId, chat, isGroup, byId, starred:Set, highlight, members:Map, names(uid), view(list,i), vote(m,idx), react(m,e),
 *        reply(m), canReply (false in channels you can't post in), more(m, anchor, point), jump(id), openOnce(m, btn), download(m), callBack(video), seenBy(m) → bool }
 */
export function renderMessage(m, ctx, run = { first: true, last: true }) {
  const mine = m.senderId === ctx.meId;
  const x = m.x || {};
  const parts = content(m, ctx);
  const bare = !m.deleted && ((m.type === "sticker" && !m.text?.trim()) || parts.big || (["photo", "video", "gif"].includes(m.type) && !m.text && !m.replyTo && !x.fwd));
  const bubble = h("div", { class: "bubble" + (m.deleted ? " deleted" : "") + (parts.big ? " big-emoji" : "") + (m.type === "sticker" || parts.big ? " bare" : "") });
  if (hasOwnerBubble(ctx.members.get(m.senderId))) bubble.classList.add("owner-bubble");   // U2-identity: sender's flair.ownerBubble (memberUsers)
  if (x.fwd) bubble.append(h("div", { class: "fwd" }, icon("forward"), "Forwarded"));
  if (m.replyTo?.id) {
    const q = ctx.byId.get(m.replyTo.id);
    const who = q ? (q.senderId === ctx.meId ? "You" : ctx.names(q.senderId)) : m.replyTo.senderId ? (m.replyTo.senderId === ctx.meId ? "You" : ctx.names(m.replyTo.senderId)) : "Reply";
    const qt = x.quote || (q ? (q.deleted ? "Deleted message" : q.text || q.type) : m.replyTo.text || "Original message");
    bubble.append(h("button", { class: "quote", type: "button", "aria-label": `Reply to ${who}: ${qt}. Jump to message`, onclick: () => ctx.jump(m.replyTo.id) }, h("b", {}, who), h("span", {}, qt)));
  }
  bubble.append(...parts);
  // footer: star · edited · time · ticks
  const foot = h("div", { class: "foot" });
  if (ctx.starred.has(m.id)) foot.append(h("span", { title: "Starred", "aria-label": "Starred" }, "★"));
  if (x.silent) foot.append(h("span", { title: "Sent silently", "aria-label": "Sent silently" }, icon("bellOff")));
  if (m.editedAt && !m.deleted) foot.append(h("span", {}, "edited"));
  foot.append(h("time", { datetime: new Date(m.createdAt).toISOString(), title: new Date(m.createdAt).toLocaleString() }, clock(m.createdAt)));
  if (mine && !m._pending && !m._failed) {
    const seen = ctx.seenBy(m);
    foot.append(h("span", { class: seen ? "seen" : "", title: seen ? "Seen" : "Sent", "aria-label": seen ? "Seen" : "Sent" }, icon(seen ? "checks" : "check")));
  }
  if (m._pending) foot.append(h("span", { "aria-label": "Sending" }, "…"));
  if (m._failed) foot.append(h("span", { class: "danger-text" }, "Not sent"));
  bubble.append(foot);
  if (bare && m.type !== "sticker" && !parts.big) bubble.classList.add("media-only");

  // reactions
  const reacts = Object.entries(m.reactions || {}).filter(([, e]) => e);
  let reactRow = null;
  if (reacts.length && !m.deleted) {
    const groups = new Map();
    for (const [uid, e] of reacts) { if (!groups.has(e)) groups.set(e, []); groups.get(e).push(uid); }
    reactRow = h("div", { class: "reacts" }, [...groups].map(([e, uids]) => {
      const minei = uids.includes(ctx.meId);
      return h("button", { type: "button", class: minei ? "mine" : "", title: uids.map((u) => (u === ctx.meId ? "You" : ctx.names(u))).join(", "),
        "aria-label": `${e} ${uids.length}${minei ? ", including you" : ""}`, "aria-pressed": String(minei), onclick: () => ctx.react(m, minei ? null : e) }, `${e} ${uids.length > 1 ? uids.length : ""}`);
    }));
  }
  const showAv = ctx.isGroup && !mine;
  const u = ctx.members.get(m.senderId);
  const col = h("div", { class: "col" },
    showAv && run.first ? h("div", { class: "sender" }, flairName(u, ctx.names(m.senderId)), ribbonsHtml(u, true)) : null,   // U2-identity
    bubble, reactRow);
  const el = h("div", { class: `msg${mine ? " mine" : ""}${run.first ? " first" : ""}${run.last ? " last" : ""}${m._pending ? " pending" : ""}${m._failed ? " failed" : ""}`,
    id: "m-" + m.id, "data-id": m.id, tabindex: "-1" },
    showAv ? h("div", { class: "av" }, run.last ? h("a", { href: u?.username ? `#/u/${enc(u.username)}` : "#", "aria-label": ctx.names(m.senderId) }, flairAvatar(u, "sm", avatar(u?.avatar, ctx.names(m.senderId), "sm"))) : null) : null,   // U2-identity
    col);
  if (!m.deleted && !m._pending && m.type !== "call") {
    const tools = h("div", { class: "tools" },
      iconBtn("emoji", "React", (e) => ctx.reactPicker(m, e.currentTarget)),
      ctx.canReply === false ? null : iconBtn("reply", "Reply", () => ctx.reply(m)),
      iconBtn("more", "More actions", (e) => ctx.more(m, e.currentTarget)));
    el.append(tools);
    el.addEventListener("contextmenu", (e) => { if (e.target.closest("a,video,audio")) return; e.preventDefault(); ctx.more(m, null, { x: e.clientX, y: e.clientY }); });
    el.addEventListener("dblclick", (e) => { if (e.target.closest("button,a,video,canvas,input")) return; ctx.react(m, (m.reactions || {})[ctx.meId] ? null : getS("chat.doubleTapReaction", "❤️")); });
  }
  return el;
}

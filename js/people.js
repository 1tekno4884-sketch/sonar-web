// People tab: search, follow requests, suggestions, and profiles (badges, bio, counts, follower lists that respect
// "hide follower lists", follow / unfollow / requests, message, call).
import { get, post, items, publicUrl, safeHref } from "./api.js";
import { h, icon, iconBtn, toast, errText, modal, closeModal, confirmBox, avatar, badges, enc, fmt, rich, lastSeen, debounce } from "./dom.js";
import { state, myId, emit } from "./state.js";
import { mainEmpty, backBtn } from "./layout.js";
import { startCall } from "./calls.js";
import { RIPPLE_WEB_URL } from "../config.js";
import { flairAvatar, flairName, ribbonsHtml } from "./identity.js";   // U2-identity

const userRow = (u, extra) => h("a", { class: "rowbtn", href: `#/u/${enc(u.username)}`, "data-user": u.username },
  flairAvatar(u, "", avatar(u.avatar, u.displayName, "", u.sonar?.ring)),   // U2-identity: flair + banner
  h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, h("span", { class: "t" }, flairName(u, u.displayName || u.username)), badges(u.badges, { dev: false, hidden: u.sonar?.hiddenBadges || [] }), ribbonsHtml(u, true))),
    h("div", { class: "l2" }, h("span", { class: "pv" }, "@" + u.username, u.sonar?.status ? ` · ${u.sonar.statusEmoji || ""} ${u.sonar.status}` : ""))),
  extra || null);

function renderList(el) {
  const q = h("input", { type: "search", placeholder: "Search people", "aria-label": "Search people", autocomplete: "off" });
  const results = h("div", { class: "rows", "aria-live": "polite" });
  const rest = h("div");
  let seq = 0;
  const run = debounce(async () => {
    const s = q.value.trim().replace(/^@/, ""), my = ++seq;
    rest.hidden = !!s;
    if (!s) { results.replaceChildren(); return; }
    if (s.length < 2) { results.replaceChildren(h("div", { class: "meta", style: "padding:8px 14px" }, "Keep typing…")); return; }
    const r = await get(`/v1/search?q=${enc(s)}`).catch(() => ({}));
    if (my !== seq) return;
    const us = (r.users || []);
    results.replaceChildren(...(us.length ? [h("div", { class: "section-title" }, "People"), ...us.map((u) => userRow(u))] : [h("div", { class: "empty" }, "Nobody found")]));
  }, 250);
  q.addEventListener("input", run);
  el.append(h("div", { class: "pane-head" }, h("h1", {}, "People")),
    h("div", { class: "searchbox" }, icon("search"), q),
    h("div", { class: "pane-body" }, results, rest));
  (async () => {
    const [reqs, sugg, foll] = await Promise.all([
      get("/v1/me/follow-requests").catch(() => ({})), get("/v1/suggested").catch(() => ({})), get(`/v1/users/${enc(myId())}/following`).catch(() => ({}))]);
    const rq = items(reqs);
    if (rq.length) rest.append(h("div", { class: "section-title" }, `Follow requests (${rq.length})`), ...rq.map((u) => {
      const row = userRow(u, h("span", { class: "row", style: "gap:4px" },
        h("button", { class: "small", onclick: async (e) => { e.preventDefault(); try { await post(`/v1/follow-requests/${enc(u.id)}/approve`); row.remove(); toast("Approved"); } catch (er) { toast(errText(er)); } } }, "Approve"),
        h("button", { class: "small tonal", onclick: async (e) => { e.preventDefault(); try { await post(`/v1/follow-requests/${enc(u.id)}/deny`); row.remove(); } catch (er) { toast(errText(er)); } } }, "Deny")));
      return row;
    }));
    const fl = items(foll).filter((u) => u?.username);
    if (fl.length) rest.append(h("div", { class: "section-title" }, "Following"), h("div", { class: "rows" }, fl.slice(0, 60).map((u) => userRow(u))));
    const sg = items(sugg).filter((u) => u?.username && u.id !== myId() && !fl.some((f) => f.id === u.id));
    if (sg.length) rest.append(h("div", { class: "section-title" }, "Suggested"), h("div", { class: "rows" }, sg.slice(0, 20).map((u) => userRow(u))));
    if (!rest.children.length) rest.append(h("div", { class: "empty" }, "Search for people by name or username."));
    select();
  })();
}

function listModal(u, which) {
  const box = h("div", { class: "rows" }, h("div", { class: "meta" }, "Loading…"));
  modal([h("h2", {}, which === "followers" ? "Followers" : "Following"), box], { label: which, wide: true });
  get(`/v1/users/${enc(u.id)}/${which}`).then((j) => {
    if (j.hidden) { box.replaceChildren(h("div", { class: "empty" }, `${u.displayName || u.username} keeps this list private.`)); return; }
    const its = items(j).filter((x) => x?.username);
    box.replaceChildren(...(its.length ? its.map((x) => { const r = userRow(x); r.addEventListener("click", () => closeModal()); return r; }) : [h("div", { class: "empty" }, "Nobody here yet")]));
  }, (e) => box.replaceChildren(h("div", { class: "err" }, errText(e))));
}

async function renderProfile(el, username) {
  let u;
  try { u = await get(`/v1/u/${enc(username.toLowerCase())}`); }
  catch { el.append(h("div", { class: "profile" }, h("div", { class: "top-bar" }, backBtn("#/people")), mainEmpty("Nobody goes by that username", "Check the spelling, or search in People."))); return; }
  if (!u || u.deactivated) { el.append(mainEmpty("This account isn't available")); return; }
  state.users.set(u.id, u);
  const me = u.id === myId();
  const rel = u.rel || {};
  let following = !!rel.following, requested = !!rel.requested;
  const fb = h("button", {});
  const paint = () => { fb.textContent = following ? "Following" : requested ? "Requested" : rel.followsMe ? "Follow back" : "Follow"; fb.className = following || requested ? "tonal" : ""; fb.setAttribute("aria-pressed", String(following)); };
  paint();
  fb.onclick = async () => {
    if (following && !(await confirmBox(`Unfollow ${u.displayName || u.username}?`, null, "Unfollow"))) return;
    try {
      await post(`/v1/users/${enc(u.id)}/follow`, { on: !(following || requested) });
      const fresh = await get(`/v1/users/${enc(u.id)}`);
      following = !!fresh?.rel?.following; requested = !!fresh?.rel?.requested; u.counts = fresh.counts || u.counts;
      paint(); paintCounts(); if (requested) toast("Follow request sent");
    } catch (e) { toast(errText(e)); }
  };
  const message = async () => {
    try { const c = await post("/v1/chats/dm", { uid: u.id }); state.chats.set(c.id, c); emit("chats"); location.hash = `#/chat/${enc(c.id)}`; }
    catch (e) { toast(errText(e)); }
  };
  const counts = h("div", { class: "counts" });
  const paintCounts = () => counts.replaceChildren(
    h("button", { onclick: () => listModal(u, "followers"), "aria-label": `${u.counts?.followers || 0} followers — show list` }, h("b", {}, fmt(u.counts?.followers)), " followers"),
    h("button", { onclick: () => listModal(u, "following"), "aria-label": `${u.counts?.following || 0} following — show list` }, h("b", {}, fmt(u.counts?.following)), " following"),
    u.hideFollowLists && !me ? h("span", { class: "small" }, "· lists are private") : null);
  paintCounts();
  const s = u.sonar || {};
  const bannerUrl = publicUrl(u.banner);
  const links = (u.links || []).filter((l) => safeHref(l.url));
  const blocked = !!rel.blocked;
  const more = iconBtn("more", "More", (e) => import("./dom.js").then((d) => d.menu(e.currentTarget, [
    { label: "Open in Ripple", icon: "link", onclick: () => open(`${RIPPLE_WEB_URL}#/u/${enc(u.username)}`, "_blank", "noopener") },
    { label: "Copy username", icon: "copy", onclick: () => navigator.clipboard?.writeText("@" + u.username).then(() => toast("Copied")) },
    !me ? { label: blocked ? "Unblock" : "Block", icon: "shield", danger: !blocked, onclick: async () => {
      if (!blocked && !(await confirmBox(`Block ${u.displayName || u.username}?`, "They won't be able to message, call or follow you.", "Block", true))) return;
      try { await post(`/v1/users/${enc(u.id)}/block`, { on: !blocked }); toast(blocked ? "Unblocked" : "Blocked"); location.reload(); } catch (er) { toast(errText(er)); }
    } } : null,
    !me ? { label: "Report", icon: "shield", danger: true, onclick: async () => {
      const { promptBox } = await import("./dom.js");
      const reason = await promptBox("Report this account", { placeholder: "What's wrong?", okLabel: "Report" });
      if (reason == null) return;
      try { await post("/v1/reports", { kind: "user", targetId: u.id, reason: reason || "other", details: reason }); toast("Thanks — our team will take a look"); } catch (er) { toast(errText(er)); }
    } } : null,
  ], { label: "Profile options" })));
  const active = u.showActivity !== false && lastSeen(u.lastActive);
  el.append(h("div", { class: "profile" },
    h("div", { class: "top-bar" }, backBtn("#/people", "Back to people"), h("b", { class: "grow" }, u.displayName || u.username), more),
    h("div", { class: "banner", style: bannerUrl ? `background-image:url("${bannerUrl}")` : null }),
    h("div", { class: "body" },
      flairAvatar(u, "big", avatar(u.avatar, u.displayName, "big", s.ring)),   // U2-identity: flair, animated picture, banners
      h("h1", {}, flairName(u, u.displayName || u.username), badges(u.badges, { hidden: s.hiddenBadges || [] })),
      ribbonsHtml(u),
      h("div", { class: "handle" }, "@" + u.username, u.pronouns ? ` · ${u.pronouns}` : "", rel.followsMe && !me ? " · Follows you" : "", active ? ` · ${active}` : ""),
      s.status ? h("div", { class: "status" }, s.statusEmoji ? s.statusEmoji + " " : "", s.status) : null,
      u.tagline ? h("div", { style: "font-weight:600;margin-top:4px" }, u.tagline) : null,
      u.bio ? h("div", { class: "bio" }, rich(u.bio)) : null,
      s.about ? h("div", { class: "meta" }, s.about) : null,
      links.length ? h("div", { class: "row", style: "gap:6px" }, links.map((l) => h("a", { class: "chip", href: safeHref(l.url), rel: "noopener nofollow ugc", target: "_blank" }, l.label || l.url))) : null,
      counts,
      blocked ? h("div", { class: "banner-note", style: "margin:8px 0" }, "You blocked this account.") : null,
      !me ? h("div", { class: "actions" }, fb,
        h("button", { class: "tonal", onclick: message }, icon("chat"), "Message"),
        h("button", { class: "tonal", onclick: () => startCall({ to: u.id, video: false }), "aria-label": `Voice call ${u.displayName}` }, icon("phone"), "Call"),
        h("button", { class: "tonal", onclick: () => startCall({ to: u.id, video: true }), "aria-label": `Video call ${u.displayName}` }, icon("video"), "Video"))
        : h("div", { class: "actions" }, h("a", { class: "chip", href: "#/settings/account" }, "Edit status & account"), h("a", { class: "chip", href: `${RIPPLE_WEB_URL}#/u/${enc(u.username)}`, target: "_blank", rel: "noopener" }, "View on Ripple ↗")),
      u.private && !following && !me ? h("p", { class: "meta" }, "🔒 This account is private. Follow requests need their OK.") : null)));
}

function select(args = []) {
  const un = args[0] === "u" ? (args[1] || "").toLowerCase() : null;
  for (const r of document.querySelectorAll(".list-pane [data-user]")) r.setAttribute("aria-current", String(r.dataset.user.toLowerCase() === un));
}

export const peopleTab = {
  list: renderList,
  async main(el, args) {
    if (args[0] === "u" && args[1]) return renderProfile(el, args[1]);
    el.append(mainEmpty("People", "Search for someone, see follow requests, and open profiles to follow, message or call.",
      h("a", { class: "chip", href: `#/u/${enc(state.me?.username || "")}` }, "View your profile")));
  },
  select,
};

// Settings tab: account (sign out, sign out everywhere, status), appearance (synced with the app), chats, privacy
// (synced blob + profile fields), notifications (this browser), devices, about.
import { get, post, patch, del, items, API } from "./api.js";
import { h, icon, iconBtn, toast, errText, confirmBox, promptBox, avatar, enc, ago, mark, $ } from "./dom.js";
import { state, emit, myId } from "./state.js";
import { getS, setS, PRESETS, WEB_PRESETS, PRESET_LABEL, THEME_MODES, BUBBLES, setWallpaper, wallpaperFor } from "./settings.js";
import { BUILTIN_WALLS, wallpaperPreview } from "./wallpaper.js";
import { notifyPrefs, setNotifyPref, askPermission, permission, canNotify, pingSound } from "./notify.js";
import { mainEmpty, backBtn } from "./layout.js";
import { RIPPLE_WEB_URL, SONAR_APK_URL, STUDIO_URL, VERSION, API_URL } from "../config.js";

const SECTIONS = [
  ["account", "Account", "user"], ["appearance", "Appearance", "palette"], ["chats", "Chats", "chat"], ["privacy", "Privacy", "shield"],
  ["notifications", "Notifications", "bell"], ["devices", "Devices", "devices"], ["about", "About", "info"],
];

// ------------------------------------------------------------------ controls
let uid = 0;
function toggle(label, desc, value, onchange, { disabled = false } = {}) {
  const id = "sw" + ++uid;
  const inp = h("input", { type: "checkbox", id, checked: !!value, disabled, role: "switch", "aria-checked": String(!!value) });
  inp.addEventListener("change", () => { inp.setAttribute("aria-checked", String(inp.checked)); onchange(inp.checked); });
  return h("div", { class: "setting" }, h("label", { class: "grow", for: id }, h("div", {}, label), desc ? h("div", { class: "meta" }, desc) : null), h("span", { class: "switch" }, inp, h("span", { "aria-hidden": "true" })));
}
function seg(label, desc, options, value, onpick) {
  const box = h("div", { class: "seg", role: "group", "aria-label": label });
  const paint = (v) => box.replaceChildren(...options.map(([val, l]) => h("button", { type: "button", "aria-pressed": String(v === val), onclick: () => { onpick(val); paint(val); } }, l)));
  paint(value);
  return h("div", { class: "setting", style: "flex-wrap:wrap" }, h("div", { class: "grow", style: "min-width:200px" }, h("div", {}, label), desc ? h("div", { class: "meta" }, desc) : null), box);
}
const section = (title, ...kids) => [h("h2", {}, title), ...kids];

// ------------------------------------------------------------------ sections
async function account(el) {
  const me = state.me;
  const status = h("input", { value: me?.sonar?.status || "", maxlength: "60", placeholder: "What are you up to? (in class, gaming…)", "aria-label": "Custom status" });
  const emoji = h("input", { value: me?.sonar?.statusEmoji || "", maxlength: "8", placeholder: "🙂", "aria-label": "Status emoji", style: "width:64px;text-align:center" });
  el.append(
    h("div", { class: "setting" }, avatar(me?.avatar, me?.displayName, "lg"), h("div", { class: "grow" }, h("b", {}, me?.displayName), h("div", { class: "meta" }, "@" + me?.username)),
      h("a", { class: "chip", href: `#/u/${enc(me?.username || "")}` }, "View profile")),
    ...section("Status",
      h("div", { class: "setting", style: "flex-wrap:wrap" }, emoji, h("div", { class: "grow", style: "min-width:180px" }, status),
        h("button", { class: "small", onclick: async () => {
          try { const u = await patch("/v1/me", { sonar: { status: status.value.trim(), statusEmoji: emoji.value.trim(), statusUntil: 0 } }); state.me = { ...state.me, ...(u.user || u) }; toast("Status updated"); } catch (e) { toast(errText(e)); }
        } }, "Save"),
        h("button", { class: "small tonal", onclick: async () => { status.value = ""; emoji.value = ""; try { await patch("/v1/me", { sonar: { status: "", statusEmoji: "" } }); toast("Status cleared"); } catch (e) { toast(errText(e)); } } }, "Clear")),
      h("p", { class: "meta" }, "Shown on your profile and in chat headers, in Sonar and the app. To change your name, photo or bio, use the Ripple or Sonar app.")),
    ...section("Session",
      h("div", { class: "setting" }, h("div", { class: "grow" }, h("div", {}, "Sign out"), h("div", { class: "meta" }, "Sign out of Sonar in this browser.")),
        h("button", { class: "tonal", onclick: () => emit("signout", false) }, "Sign out")),
      h("div", { class: "setting" }, h("div", { class: "grow" }, h("div", {}, "Sign out everywhere"), h("div", { class: "meta" }, "Ends every session on every phone and browser — Ripple and Sonar.")),
        h("button", { class: "danger", onclick: async () => { if (await confirmBox("Sign out everywhere?", "You'll need to sign in again on every device, including your phone.", "Sign out everywhere", true)) emit("signout", true); } }, "Sign out everywhere"))));
}

function appearance(el) {
  const swatches = h("div", { class: "swatches", role: "group", "aria-label": "Accent colour" });
  const paintSw = () => {
    const cur = getS("appearance.theme.source") === "Custom" ? null : getS("appearance.theme.preset");
    const list = [...WEB_PRESETS, ...(cur && !WEB_PRESETS.includes(cur) && PRESETS[cur] ? [cur] : [])];
    swatches.replaceChildren(...list.map((p) => h("button", { class: "swatch", type: "button", "aria-pressed": String(cur === p), onclick: () => { setS("appearance.theme.source", "Preset"); setS("appearance.theme.preset", p); paintSw(); } },
      h("i", { style: `background:${PRESETS[p]}` }), PRESET_LABEL[p] || p)));
  };
  paintSw();
  const bubbles = h("div", { class: "bubbles-pick", role: "group", "aria-label": "Bubble style" });
  const paintB = () => bubbles.replaceChildren(...BUBBLES.map((b) => {
    const r = { Round: "16px", Soft: "10px", Square: "3px", Outline: "16px", Glass: "16px", Minimal: "0" }[b];
    const st = (mine) => `border-radius:${r};${b === "Outline" ? `background:transparent;border:1.5px solid ${mine ? "var(--vivid)" : "var(--line)"};color:var(--text)` : b === "Glass" ? `background:color-mix(in srgb, ${mine ? "var(--vivid)" : "var(--surface2)"} 60%, transparent);backdrop-filter:blur(6px)` : b === "Minimal" ? "background:transparent;color:var(--text);padding:2px" : ""}`;
    return h("button", { type: "button", "aria-pressed": String(getS("chat.bubble") === b), onclick: () => { setS("chat.bubble", b); paintB(); } },
      h("div", { class: "demo", "aria-hidden": "true" }, h("span", { style: st(false) }, "Hey! 👋"), h("span", { class: "m", style: st(true) }, "Hi there")), b);
  }));
  paintB();
  const walls = h("div", { class: "walls", role: "group", "aria-label": "Chat wallpaper" });
  const paintW = () => {
    const w = wallpaperFor(null);
    const cur = w.kind === "None" ? "none" : w.kind === "Builtin" ? w.id : "";
    walls.replaceChildren(...[...BUILTIN_WALLS.map(([id, label]) => [id, label]), ["none", "None"]].map(([id, label]) => {
      const b = h("button", { type: "button", "aria-pressed": String(cur === id), onclick: () => { setWallpaper(id); paintW(); } }, wallpaperPreview(id, [92, 120]), label);
      return b;
    }));
    if (w.kind === "Solid" || w.kind === "Gradient" || w.kind === "Photo") walls.append(h("p", { class: "meta", style: "grid-column:1/-1" }, `Your app uses a ${w.kind.toLowerCase()} wallpaper${w.kind === "Photo" ? " (photos stay on the phone, so the web shows plain)" : ""}. Pick one here to change it everywhere.`));
  };
  paintW();
  const size = Number(getS("chat.textSize")) || 16;
  const sizeLbl = h("span", { class: "meta" }, size + " px");
  const range = h("input", { type: "range", min: "12", max: "24", step: "1", value: String(size), "aria-label": "Message text size", style: "flex:1;min-width:160px" });
  range.addEventListener("input", () => { sizeLbl.textContent = range.value + " px"; document.documentElement.style.setProperty("--msg-size", range.value + "px"); });
  range.addEventListener("change", () => setS("chat.textSize", Number(range.value)));
  const mode = getS("appearance.theme.mode");
  el.append(
    ...section("Theme",
      seg("Theme", mode === "Scheduled" ? "Your app uses a schedule — Sonar web follows it." : "Light, dark or AMOLED black.", THEME_MODES, mode, (v) => setS("appearance.theme.mode", v)),
      h("div", { class: "setting", style: "display:block" }, h("div", { style: "margin-bottom:10px" }, "Accent colour"), swatches)),
    ...section("Chat bubbles", bubbles),
    ...section("Wallpaper", walls, toggle("Animated wallpapers", "Gentle motion behind your chats (off with reduced motion).", getS("chat.wallpaper.light.animated", true) !== false, (v) => {
      const pair = { ...(getS("chat.wallpaper", {}) || {}) }; pair.light = { ...(pair.light || {}), animated: v }; if (pair.dark) pair.dark = { ...pair.dark, animated: v }; setS("chat.wallpaper", pair);
    })),
    ...section("Text", h("div", { class: "setting", style: "flex-wrap:wrap" }, h("div", { class: "grow" }, "Message text size"), range, sizeLbl),
      toggle("Big emoji", "Messages with only 1–3 emoji show large.", getS("chat.bigEmoji") !== false, (v) => setS("chat.bigEmoji", v)),
      toggle("Reduce motion", "Fewer animations everywhere (also follows your system setting).", !!getS("a11y.reduceMotion"), (v) => setS("a11y.reduceMotion", v))),
    h("p", { class: "meta" }, "These settings sync with Sonar on your phone."));
}

function chatsSection(el) {
  const quick = (getS("chat.quickReactions") || []).join(" ");
  const qr = h("input", { value: quick, "aria-label": "Quick reactions", placeholder: "❤️ 😂 😮 😢 🔥 👍" });
  qr.addEventListener("change", () => { const arr = qr.value.split(/\s+/).filter(Boolean).slice(0, 6); if (arr.length) setS("chat.quickReactions", arr); toast("Saved"); });
  el.append(
    ...section("Chat list",
      seg("Sort chats", null, [["PinnedFirst", "Pinned first"], ["Recent", "Recent"], ["UnreadFirst", "Unread first"], ["Alpha", "A–Z"]], getS("chat.sort"), (v) => setS("chat.sort", v)),
      toggle("Show message previews", "Turn off to hide message text in the chat list.", getS("chat.showPreviews") !== false, (v) => setS("chat.showPreviews", v))),
    ...section("Messages",
      toggle("Link previews", "Show a title and image for links (fetched by the server).", getS("chat.linkPreviews") !== false, (v) => setS("chat.linkPreviews", v)),
      h("div", { class: "setting", style: "flex-wrap:wrap" }, h("div", { class: "grow" }, h("div", {}, "Quick reactions"), h("div", { class: "meta" }, "Up to 6 emoji, separated by spaces.")), h("div", { style: "flex:1;min-width:200px" }, qr)),
      seg("Voice note speed", "Default playback speed.", [[1, "1×"], [1.5, "1.5×"], [2, "2×"]], Number(getS("chat.voiceSpeed")) || 1, (v) => setS("chat.voiceSpeed", v))),
    ...section("Keyboard shortcuts", h("div", { class: "setting" }, h("div", { class: "shortcuts" },
      ...[["Ctrl K", "Search chats, people and messages"], ["Enter", "Send"], ["Shift Enter", "New line"], ["Esc", "Close / back"], ["Alt ↑ / Alt ↓", "Previous / next chat"], ["↑ (empty box)", "Edit your last message"]]
        .flatMap(([k, d]) => [h("span", {}, ...k.split(" ").map((x) => h("kbd", { class: "kbd" }, x))), h("span", {}, d)])))));
}

async function privacy(el) {
  const me = state.me || {};
  const ghost = !!getS("privacy.ghostMode");
  const prof = h("div");
  el.append(
    ...section("In chats",
      toggle("Ghost mode", "Hide when you're online and skip read receipts and typing.", ghost, (v) => { setS("privacy.ghostMode", v); el.replaceChildren(); privacy(el); }),
      toggle("Read receipts", "If you turn these off, you won't see other people's either.", getS("privacy.readReceipts") !== false && !ghost, (v) => setS("privacy.readReceipts", v), { disabled: ghost }),
      toggle("Typing indicator", "Let people see when you're typing.", getS("privacy.typingIndicator") !== false && !ghost, (v) => setS("privacy.typingIndicator", v), { disabled: ghost })),
    ...section("Your profile (Ripple and Sonar)", prof));
  const save = async (body) => { try { const r = await patch("/v1/me", body); state.me = { ...state.me, ...(r.user || r) }; toast("Saved"); } catch (e) { toast(errText(e)); } };
  prof.append(
    seg("Who can message me", null, [["everyone", "Everyone"], ["following", "People I follow"], ["nobody", "Nobody"]], me.dmPolicy || "everyone", (v) => save({ dmPolicy: v })),
    seg("Who can call me", null, [["everyone", "Everyone"], ["following", "People I follow"], ["mutuals", "Mutuals"], ["nobody", "Nobody"]], me.callPolicy || "everyone", (v) => save({ callPolicy: v })),
    toggle("Show activity status", "Let people see when you were last active.", me.showActivity !== false, (v) => save({ showActivity: v })),
    h("p", { class: "meta" }, "Calls are peer-to-peer and encrypted in transit (DTLS-SRTP). Sonar never records calls."));
}

function notifications(el) {
  const p = notifyPrefs();
  const state_ = permission();
  const permRow = h("div", { class: "setting" }, h("div", { class: "grow" }, h("div", {}, "Browser notifications"),
    h("div", { class: "meta" }, !canNotify() ? "This browser doesn't support notifications." : state_ === "granted" ? "On — Sonar can notify you while this tab is open." : state_ === "denied" ? "Blocked — allow notifications for this site in your browser settings." : "Get notified about messages and calls while Sonar is open in a tab.")),
    canNotify() && state_ === "default" ? h("button", { onclick: async () => { await askPermission(); el.replaceChildren(); notifications(el); } }, "Turn on") : null);
  el.append(
    ...section("This browser", permRow,
      toggle("New messages", null, p.messages, (v) => setNotifyPref("messages", v)),
      toggle("Incoming calls", null, p.calls, (v) => setNotifyPref("calls", v)),
      toggle("Sounds", "A soft ping for new messages while you're on another chat.", p.sound, (v) => { setNotifyPref("sound", v); if (v) pingSound(); })),
    ...section("Everywhere",
      seg("Notification content", null, [["Full", "Show preview"], ["Sender", "Sender only"], ["Hidden", "Hide content"]], getS("notifications.preview"), (v) => setS("notifications.preview", v)),
      toggle("Pause all notifications", "Synced with the app.", !!getS("notifications.pauseAll"), (v) => setS("notifications.pauseAll", v))),
    h("p", { class: "meta" }, "Muted chats never notify. Sonar on the web can only notify while a Sonar tab is open — install the Android app to get calls when your browser is closed."));
}

async function devices(el) {
  const box = h("div", {}, h("div", { class: "meta" }, "Loading…"));
  el.append(...section("Signed-in devices", box,
    h("div", { class: "row", style: "margin-top:8px" },
      h("button", { class: "tonal", onclick: async () => { const n = await promptBox("Name this device", { value: `Sonar web · ${browserName()}` }); if (n != null) { try { await post("/v1/me/sessions/name", { name: n }); load(); } catch (e) { toast(errText(e)); } } } }, "Name this device"),
      h("button", { class: "danger", onclick: async () => { if (await confirmBox("Sign out everywhere?", "Every session ends, including this one.", "Sign out everywhere", true)) emit("signout", true); } }, "Sign out everywhere"))));
  async function load() {
    try {
      const j = await get("/v1/me/sessions");
      box.replaceChildren(...items(j).map((s) => h("div", { class: "setting" }, icon("devices"),
        h("div", { class: "grow" }, h("div", {}, s.name || "Unnamed device", s.current ? h("span", { class: "chip", style: "margin-left:8px" }, "This browser") : null),
          h("div", { class: "meta" }, `Signed in ${new Date(s.createdAt).toLocaleDateString()} · active ${ago(s.lastUsed) || "recently"}`)),
        s.current ? null : h("button", { class: "small tonal", onclick: async () => { if (await confirmBox("Sign this device out?", null, "Sign out")) { try { await del(`/v1/me/sessions/${enc(s.id)}`); load(); toast("Signed out"); } catch (e) { toast(errText(e)); } } } }, "Sign out"))));
    } catch (e) { box.replaceChildren(h("div", { class: "err" }, errText(e))); }
  }
  load();
}
function browserName() { const u = navigator.userAgent; return /Firefox\//.test(u) ? "Firefox" : /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser"; }

async function about(el) {
  const credit = h("a", { href: "#/settings/about" }, "Made by Brayden");
  el.append(
    h("div", { class: "setting" }, mark("mark big"), h("div", { class: "grow" }, h("h2", { style: "margin:0" }, "Sonar"), h("div", { class: "meta" }, `Web ${VERSION} · chats and calls for Ripple`), h("div", { style: "margin-top:4px;font-weight:700" }, credit))),
    ...section("Links",
      h("a", { class: "setting", href: SONAR_APK_URL, target: "_blank", rel: "noopener" }, icon("download"), h("div", { class: "grow" }, h("div", {}, "Get Sonar for Android"), h("div", { class: "meta" }, "Download the APK from Undertow Studio"))),
      h("a", { class: "setting", href: RIPPLE_WEB_URL, target: "_blank", rel: "noopener" }, icon("link"), h("div", { class: "grow" }, h("div", {}, "Ripple on the web"), h("div", { class: "meta" }, "Posts, shorts and Pools"))),
      h("a", { class: "setting", href: STUDIO_URL, target: "_blank", rel: "noopener" }, icon("info"), h("div", { class: "grow" }, h("div", {}, "Undertow Studio"), h("div", { class: "meta" }, "More free apps")))),
    ...section("Privacy",
      h("p", {}, "Calls are peer-to-peer and encrypted in transit (DTLS-SRTP). When a direct connection isn't possible, calls go through an encrypted relay that can't see or hear them. Sonar never records calls."),
      h("p", { class: "meta" }, "Messages are stored on Ripple's servers like Ripple chats. Sonar on the web keeps no messages in your browser — only your sign-in and a few display preferences."),
      API_URL !== "https://ripple-api.undertowstudio.workers.dev" ? h("p", { class: "meta" }, `Server: ${API} (local testing — open with ?api=default to go back)`) : null));
  // "Made by Brayden" links to the official profile (found by the owner uid, never a hardcoded username)
  try {
    const cfg = state.config || await get("/v1/config");
    if (cfg?.ownerUid) { const u = await get(`/v1/users/${enc(cfg.ownerUid)}`); if (u?.username) credit.href = `#/u/${enc(u.username)}`; }
  } catch {}
}

const RENDER = { account, appearance, chats: chatsSection, privacy, notifications, devices, about };

export const settingsTab = {
  list(el) {
    el.append(h("div", { class: "pane-head" }, h("h1", {}, "Settings")),
      h("div", { class: "pane-body" }, h("div", { class: "rows", role: "list" }, SECTIONS.map(([id, label, ic]) =>
        h("a", { class: "rowbtn", href: `#/settings/${id}`, "data-sec": id, role: "listitem" }, h("span", { class: "avatar sm", style: "background:var(--surface3);color:var(--text)" }, icon(ic)), h("div", { class: "body" }, h("div", { class: "l1" }, h("span", { class: "name" }, label))))))));
  },
  async main(el, args) {
    const id = args[0] || (matchMedia("(max-width: 760px)").matches ? null : "appearance");
    if (!id || !RENDER[id]) { el.append(mainEmpty("Settings", "Pick a section.")); return; }
    const inner = h("div", { class: "inner" }, h("div", { class: "pane-head", style: "padding:14px 0 0" }, backBtn("#/settings", "Back to settings"), h("h1", {}, SECTIONS.find((s) => s[0] === id)[1])));
    const wrap = h("div", { class: "settings-main" }, inner);
    el.append(wrap);
    await RENDER[id](inner);
  },
  select(args) {
    const id = args[0] || "appearance";
    for (const r of document.querySelectorAll("[data-sec]")) r.setAttribute("aria-current", String(r.dataset.sec === id));
  },
};
void myId; void iconBtn; void $;

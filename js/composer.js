// The composer: text (Enter sends, Shift+Enter new line), emoji, mentions, replies, edits, link previews,
// attachments (pick / drag-and-drop / paste) uploaded with the resumable upload API, albums, view-once, files,
// voice notes (MediaRecorder → Opus in Ogg), polls, send silently, schedule and pings.
import { get, post, upload, fileMime, MEDIA_MIMES, safeHref } from "./api.js";
import { h, icon, iconBtn, toast, errText, modal, closeModal, menu, enc, dur, debounce } from "./dom.js";
import { myId } from "./state.js";
import { getS, draft, setDraft } from "./settings.js";
import { emojiPicker } from "./emoji.js";
import { prepareImage, videoMeta, webmToOgg } from "./media.js";
import { composerItems } from "./u3social.js";   // U3-social: Whisper / Lantern (beta)

const MAX_TRAY = 10;

export function createComposer(chat0, hooks) {
  const chatId = chat0.id;
  const chat = () => hooks.chat();
  let reply = null, editing = null, silent = false, link = null, linkFor = "", tray = [], viewOnce = false, hd = false;

  const isChannel = chat0.type === "channel";
  const ta = h("textarea", { rows: "1", placeholder: isChannel ? "Broadcast a post" : "Message", "aria-label": isChannel ? "Post" : "Message", maxlength: "4000", spellcheck: "true" });
  ta.value = draft(chatId);
  const ctxBar = h("div", { class: "ctx", hidden: true });
  const lpBar = h("div", { class: "lp", hidden: true });
  const trayEl = h("div", { class: "tray", hidden: true, role: "list", "aria-label": "Attachments" });
  const trayOpts = h("div", { class: "tray-opts", hidden: true });
  const mentionsEl = h("div", { class: "mentions", hidden: true, role: "listbox", "aria-label": "Mention someone" });
  const fileInp = h("input", { type: "file", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const sendBtn = h("button", { class: "send", type: "button", "aria-label": "Send" }, icon("send"));
  const emojiBtn = iconBtn("emoji", "Emoji", () => toggleEmoji());
  emojiBtn.setAttribute("data-emoji-toggle", "");
  const silentChip = h("button", { class: "chip on", type: "button", hidden: true, "aria-label": "Sending silently — click to turn off", onclick: () => setSilent(false) }, icon("bellOff"), "Silent");
  const bar = h("div", { class: "bar" },
    iconBtn("plus", "More: poll, schedule, silent, ping", (e) => plusMenu(e.currentTarget)),
    iconBtn("attach", "Attach photos, videos or files", () => fileInp.click()),
    emojiBtn, ta, sendBtn);
  const el = h("div", { class: "composer" }, ctxBar, mentionsEl, lpBar, trayEl, trayOpts, h("div", { class: "row", style: "gap:6px;padding:0 0 4px" }, silentChip), bar, fileInp);
  silentChip.parentElement.hidden = true;

  // ---------------------------------------------------------------- text area
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(200, ta.scrollHeight + 2) + "px"; };
  const paintSend = () => {
    const has = ta.value.trim() || tray.length || editing;
    sendBtn.replaceChildren(icon(has ? (editing ? "check" : "send") : "mic"));
    sendBtn.setAttribute("aria-label", has ? (editing ? "Save edit" : "Send") : "Record a voice note");
    sendBtn.title = sendBtn.getAttribute("aria-label");
  };
  let lastTyping = 0;
  ta.addEventListener("input", () => {
    grow(); paintSend();
    if (!editing) setDraft(chatId, ta.value);
    if (ta.value && !isChannel && Date.now() - lastTyping > 3000 && getS("privacy.typingIndicator") !== false && !getS("privacy.ghostMode")) {
      lastTyping = Date.now(); post(`/v1/chats/${enc(chatId)}/typing`).catch(() => {});
    }
    checkLink(); checkMention();
  });
  ta.addEventListener("keydown", (e) => {
    if (!mentionsEl.hidden && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return mentionKey(e);
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === "Escape" && (reply || editing)) { e.preventDefault(); e.stopPropagation(); setReply(null); setEdit(null); }
    else if (e.key === "ArrowUp" && !ta.value && !reply) {
      // edit my last text message (like many desktop chat apps)
      const last = hooks.lastMine?.(); if (last) { e.preventDefault(); setEdit(last); }
    }
  });
  ta.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  sendBtn.onclick = () => { if (ta.value.trim() || tray.length || editing) submit(); else startRecording(); };
  fileInp.onchange = () => { addFiles(fileInp.files); fileInp.value = ""; };

  // ---------------------------------------------------------------- reply / edit context
  function paintCtx() {
    ctxBar.hidden = !reply && !editing;
    if (editing) ctxBar.replaceChildren(icon("edit"), h("div", { class: "grow" }, h("b", {}, "Editing"), " ", editing.text), iconBtn("close", "Cancel editing", () => setEdit(null)));
    else if (reply) ctxBar.replaceChildren(icon("reply"), h("div", { class: "grow" }, h("b", {}, "Replying to ", reply.senderId === myId() ? "yourself" : hooks.names()(reply.senderId)), " ", reply.deleted ? "Deleted message" : reply.text || reply.type), iconBtn("close", "Cancel reply", () => setReply(null)));
  }
  function setReply(m) { reply = m; if (m) editing = null; paintCtx(); paintSend(); if (m) ta.focus(); }
  function setEdit(m) {
    if (m && !editing) setDraft(chatId, ta.value);
    editing = m; if (m) reply = null;
    ta.value = m ? m.text || "" : draft(chatId);
    grow(); paintCtx(); paintSend(); if (m) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  // ---------------------------------------------------------------- silent / plus menu
  function setSilent(on) { silent = on; silentChip.hidden = !on; silentChip.parentElement.hidden = !on; }
  function plusMenu(anchor) {
    menu(anchor, [
      { label: "Create a poll", icon: "poll", onclick: pollModal },
      { label: "Schedule a message", icon: "clock", onclick: scheduleModal },
      { label: silent ? "Send with notification" : "Send silently", icon: silent ? "bell" : "bellOff", onclick: () => setSilent(!silent) },
      isChannel ? null : { label: "Send a sonar ping", icon: "ping", onclick: () => hooks.send({ type: "ping", text: "📡 Ping" }).catch(() => {}) },
      { label: "Record a voice note", icon: "mic", onclick: startRecording },
      ...composerItems(chat(), hooks.send),   // U3-social
    ], { label: "More" });
  }

  // ---------------------------------------------------------------- emoji
  let closeEmoji = null;
  function toggleEmoji() {
    if (closeEmoji) { closeEmoji(); return; }
    const host = el.closest(".conv") || el.parentElement;
    closeEmoji = emojiPicker(host, (e) => {
      const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + e + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + e.length;
      ta.dispatchEvent(new Event("input"));
    }, { onClose: () => { closeEmoji = null; ta.focus(); } });
  }

  // ---------------------------------------------------------------- link previews
  const checkLink = debounce(async () => {
    if (getS("chat.linkPreviews") === false) return;
    const url = (ta.value.match(/https?:\/\/[^\s<>"]+/) || [])[0];
    if (!url || url === linkFor) { if (!url) { link = null; linkFor = ""; lpBar.hidden = true; } return; }
    linkFor = url;
    try {
      const p = await get(`/v1/link-preview?url=${enc(url)}`);
      if (linkFor !== url) return;
      if (!p.title && !p.image) { link = null; lpBar.hidden = true; return; }
      link = { url: p.url || url, title: p.title || "", image: p.image || "", site: p.site || "" };
      const img = link.image && safeHref(link.image) ? h("img", { src: link.image, alt: "", referrerpolicy: "no-referrer" }) : null;
      lpBar.replaceChildren(icon("link"), img, h("div", { class: "grow", style: "min-width:0" }, h("b", {}, link.title || link.url), h("span", { class: "meta" }, link.site)),
        iconBtn("close", "Remove link preview", () => { link = null; lpBar.hidden = true; }));
      lpBar.hidden = false;
    } catch { link = null; lpBar.hidden = true; }
  }, 600);

  // ---------------------------------------------------------------- mentions (groups)
  let mentionList = [], mentionSel = 0, mentionAt = -1;
  function checkMention() {
    const c = chat();
    if (c.type !== "group") { mentionsEl.hidden = true; return; }
    const pos = ta.selectionStart, before = ta.value.slice(0, pos);
    const m = before.match(/(^|\s)@([A-Za-z0-9._]{0,20})$/);
    if (!m) { mentionsEl.hidden = true; return; }
    mentionAt = pos - m[2].length - 1;
    const q = m[2].toLowerCase();
    const isAdmin = (c.admins || []).includes(myId());
    mentionList = (c.memberUsers || []).filter((u) => u.id !== myId() && ((u.username || "").toLowerCase().startsWith(q) || (u.name || "").toLowerCase().includes(q))).slice(0, 8);
    if (isAdmin && "everyone".startsWith(q)) mentionList.push({ id: "everyone", username: "everyone", name: "Everyone in this group" });
    if (!mentionList.length) { mentionsEl.hidden = true; return; }
    mentionSel = 0; paintMentions();
  }
  function paintMentions() {
    mentionsEl.hidden = false;
    mentionsEl.replaceChildren(...mentionList.map((u, i) => h("button", { type: "button", role: "option", "aria-selected": String(i === mentionSel), class: i === mentionSel ? "sel" : "", onmousedown: (e) => { e.preventDefault(); pickMention(u); } },
      h("b", {}, u.name || u.username), h("span", { class: "meta" }, "@" + u.username))));
  }
  function pickMention(u) {
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, mentionAt) + "@" + u.username + " " + ta.value.slice(pos);
    const np = mentionAt + u.username.length + 2; ta.setSelectionRange(np, np);
    mentionsEl.hidden = true; ta.dispatchEvent(new Event("input")); ta.focus();
  }
  function mentionKey(e) {
    e.preventDefault();
    if (e.key === "Escape") { e.stopPropagation(); mentionsEl.hidden = true; return; }
    if (e.key === "ArrowDown") mentionSel = (mentionSel + 1) % mentionList.length;
    else if (e.key === "ArrowUp") mentionSel = (mentionSel - 1 + mentionList.length) % mentionList.length;
    else return pickMention(mentionList[mentionSel]);
    paintMentions();
  }
  function mentionsIn(text) {
    const c = chat(); if (c.type !== "group") return {};
    const names = new Set([...text.matchAll(/@([A-Za-z0-9._]{3,20})/g)].map((m) => m[1].toLowerCase()));
    const uids = (c.memberUsers || []).filter((u) => names.has((u.username || "").toLowerCase())).map((u) => u.id);
    const out = {};
    if (uids.length) out.mentions = uids;
    if (names.has("everyone") && (c.admins || []).includes(myId())) out.everyone = true;
    return out;
  }

  // ---------------------------------------------------------------- attachments
  function kindOf(f) {
    const t = f.type;
    if (MEDIA_MIMES.includes(t) || /^image\/(heic|avif|bmp)$/.test(t)) return t.startsWith("video/") ? "video" : "image";
    if (t.startsWith("video/")) return "badvideo";
    return "file";
  }
  function addFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    if (editing) setEdit(null);
    for (const f of files) {
      if (tray.length >= MAX_TRAY) { toast(`Up to ${MAX_TRAY} at a time`); break; }
      const kind = kindOf(f);
      if (kind === "badvideo") { toast("Videos need to be MP4 or WebM"); continue; }
      if (kind === "file" && !fileMime(f)) { toast(`${f.name}: that kind of file can't be shared`); continue; }
      tray.push({ file: f, kind, url: kind !== "file" ? URL.createObjectURL(f) : null, prog: 0 });
    }
    paintTray(); paintSend(); ta.focus();
  }
  function paintTray() {
    trayEl.hidden = !tray.length;
    trayEl.replaceChildren(...tray.map((t, i) => h("div", { class: "item", role: "listitem", title: t.file.name },
      t.kind === "image" ? h("img", { src: t.url, alt: t.file.name }) : t.kind === "video" ? h("video", { src: t.url, muted: true }) : h("div", {}, icon("file"), h("div", {}, t.file.name.slice(0, 22))),
      h("button", { class: "icon-btn x", type: "button", "aria-label": `Remove ${t.file.name}`, onclick: () => { if (t.url) URL.revokeObjectURL(t.url); tray.splice(i, 1); paintTray(); paintSend(); } }, icon("close")),
      t.prog ? h("div", { class: "prog", style: `width:${Math.round(t.prog * 100)}%` }) : null)));
    const media = tray.filter((t) => t.kind !== "file");
    trayOpts.hidden = !media.length;
    const once = h("input", { type: "checkbox", checked: viewOnce, disabled: media.length !== 1 || tray.length !== 1, onchange: (e) => (viewOnce = e.target.checked) });
    const hdc = h("input", { type: "checkbox", checked: hd, onchange: (e) => (hd = e.target.checked) });
    trayOpts.replaceChildren(h("label", { title: "The photo or video opens once, then it's gone" }, once, "View once"), h("label", { title: "Send photos at 2560 px" }, hdc, "HD"),
      h("span", {}, media.length > 1 ? `Sends as an album of ${media.length}` : ""));
    if (media.length !== 1 || tray.length !== 1) viewOnce = false;
  }
  async function uploadMedia(t, purpose) {
    const onProgress = (p) => { t.prog = p; paintTray(); };
    if (t.kind === "image") {
      const p = await prepareImage(t.file, hd);
      const r = await upload(p.blob, { purpose, scope: chatId, mime: p.mime, onProgress });
      return { kind: "image", key: r.key, b: r.b, w: p.w, h: p.h, mime: p.mime };
    }
    if (t.kind === "video") {
      const meta = await videoMeta(t.file);
      const r = await upload(t.file, { purpose, scope: chatId, mime: t.file.type, durationSec: meta.dur, onProgress });
      const md = { kind: "video", key: r.key, b: r.b, w: meta.w, h: meta.h, dur: meta.dur, mime: t.file.type };
      if (meta.thumb && purpose !== "snap") { try { const th = await upload(meta.thumb, { purpose, scope: chatId, mime: "image/jpeg" }); md.thumb = th.key; md.tb = th.b; } catch {} }
      return md;
    }
    const mime = fileMime(t.file);
    const r = await upload(t.file, { purpose: "file", scope: chatId, mime, onProgress });
    return { kind: "file", key: r.key, b: r.b, mime };
  }

  // ---------------------------------------------------------------- send
  let busy = false;
  async function submit() {
    if (busy) return;
    const text = ta.value.trim();
    if (editing) {
      const m = editing;
      if (text && text !== m.text) await hooks.edit(m, text);
      setEdit(null); return;
    }
    if (!text && !tray.length) return;
    const base = () => ({ ...(silent ? { silent: true } : {}), ...(reply ? { replyTo: { id: reply.id, text: (reply.text || "").slice(0, 80), senderId: reply.senderId } } : {}) });
    const items_ = tray.slice(); const once = viewOnce;
    busy = true; sendBtn.disabled = true;
    try {
      if (items_.length) {
        const media = items_.filter((t) => t.kind !== "file"), files = items_.filter((t) => t.kind === "file");
        let captionUsed = false;
        if (media.length === 1) {
          const md = await uploadMedia(media[0], once ? "snap" : "chat");
          await hooks.send({ type: md.kind === "video" ? "video" : "photo", text, media: md, ...base(), ...(once ? { viewOnce: true } : {}), ...(hd ? { hd: true } : {}), ...mentionsIn(text) });
          captionUsed = true;
        } else if (media.length > 1) {
          const album = [];
          for (const t of media) album.push(await uploadMedia(t, "chat"));
          await hooks.send({ type: "album", text: text || "🖼 Photos", album, ...base(), ...(hd ? { hd: true } : {}), ...mentionsIn(text) });
          captionUsed = true;
        }
        for (const t of files) {
          const md = await uploadMedia(t, "file");
          await hooks.send({ type: "file", text: `📎 ${t.file.name}`, media: md, file: { name: t.file.name, size: t.file.size, mime: md.mime }, ...base() });
        }
        if (text && !captionUsed) await hooks.send({ type: "text", text, ...base(), ...(link ? { link } : {}), ...mentionsIn(text) });
        items_.forEach((t) => t.url && URL.revokeObjectURL(t.url));
        tray = []; viewOnce = false; paintTray();
      } else {
        const body = { type: "text", text, ...base(), ...(link && text.includes(link.url.replace(/\/$/, "")) ? { link } : {}), ...mentionsIn(text) };
        ta.value = ""; setDraft(chatId, ""); grow();
        hooks.send(body).catch(() => {});
      }
      ta.value = ""; setDraft(chatId, ""); grow();
      setReply(null); link = null; linkFor = ""; lpBar.hidden = true;
    } catch (e) { toast(errText(e)); items_.forEach((t) => (t.prog = 0)); paintTray(); }
    busy = false; sendBtn.disabled = false; paintSend(); ta.focus();
  }

  // ---------------------------------------------------------------- polls & scheduling
  function pollModal() {
    const q = h("input", { placeholder: "Ask a question", "aria-label": "Question", maxlength: "200" });
    const opts = h("div", { class: "stack" });
    const addOpt = (v = "") => { if (opts.children.length >= 10) return; opts.append(h("input", { placeholder: `Option ${opts.children.length + 1}`, "aria-label": `Option ${opts.children.length + 1}`, maxlength: "80", value: v })); };
    addOpt(); addOpt();
    const multi = h("input", { type: "checkbox" }), anon = h("input", { type: "checkbox" });
    const err = h("div", { class: "err" });
    modal([h("h2", {}, "New poll"), h("div", { class: "stack" }, q, opts,
      h("button", { class: "tonal small", type: "button", onclick: () => addOpt() }, "+ Add option"),
      h("label", { class: "row" }, multi, "Allow more than one answer"), h("label", { class: "row" }, anon, "Anonymous votes"), err,
      h("div", { class: "row end" }, h("button", { class: "tonal", onclick: () => closeModal() }, "Cancel"), h("button", { onclick: async () => {
        const options = [...opts.children].map((i) => i.value.trim()).filter(Boolean);
        if (!q.value.trim()) { err.textContent = "Add a question"; return; }
        if (options.length < 2) { err.textContent = "Add at least 2 options"; return; }
        closeModal();
        hooks.send({ type: "poll", text: `📊 ${q.value.trim()}`, poll: { q: q.value.trim(), options, multi: multi.checked, anon: anon.checked }, ...(silent ? { silent: true } : {}) }).catch(() => {});
      } }, "Send poll")))], { label: "New poll" });
  }
  function scheduleModal() {
    const text = h("textarea", { "aria-label": "Message", placeholder: "Message" }, ta.value);
    const d = new Date(Date.now() + 3600_000); d.setSeconds(0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const at = h("input", { type: "datetime-local", value: local, "aria-label": "Send at" });
    const err = h("div", { class: "err" });
    modal([h("h2", {}, "Schedule a message"), h("div", { class: "stack" }, text, at, h("div", { class: "meta" }, "Sonar sends it for you at that time (within a minute), even if this tab is closed."), err,
      h("div", { class: "row end" }, h("button", { class: "tonal", onclick: () => closeModal() }, "Cancel"), h("button", { onclick: async () => {
        const when = new Date(at.value).getTime();
        if (!text.value.trim()) { err.textContent = "Write a message"; return; }
        if (!(when > Date.now() + 30_000)) { err.textContent = "Pick a time at least a minute from now"; return; }
        try {
          await post(`/v1/chats/${enc(chatId)}/schedule`, { at: when, type: "text", text: text.value.trim(), ...(silent ? { silent: true } : {}), ...mentionsIn(text.value) });
          closeModal(); toast(`Scheduled for ${new Date(when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`);
          if (text.value.trim() === ta.value.trim()) { ta.value = ""; setDraft(chatId, ""); grow(); paintSend(); }
        } catch (e) { err.textContent = errText(e); }
      } }, "Schedule")))], { label: "Schedule a message" });
  }

  // ---------------------------------------------------------------- voice notes
  let rec = null;
  function pickMime() {
    const MR = window.MediaRecorder; if (!MR) return null;
    for (const [m, up] of [["audio/ogg;codecs=opus", "audio/ogg"], ["audio/webm;codecs=opus", "webm"], ["audio/mp4", "audio/mp4"], ["audio/webm", "webm"]])
      if (MR.isTypeSupported?.(m)) return { m, up };
    return null;
  }
  async function startRecording() {
    if (rec) return;
    const mt = pickMime();
    if (!mt || !navigator.mediaDevices?.getUserMedia) { toast("Voice notes aren't supported in this browser"); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast("Allow microphone access to record voice notes"); return; }
    const mr = new MediaRecorder(stream, { mimeType: mt.m, audioBitsPerSecond: 32000 });
    const chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an);
    const level = h("canvas", { "aria-hidden": "true" });
    const t = h("span", { class: "t", role: "timer", "aria-live": "off" }, "0:00");
    let elapsed = 0, lastTick = Date.now(), paused = false, raf = 0;
    const timer = setInterval(() => { if (!paused) { elapsed += Date.now() - lastTick; } lastTick = Date.now(); t.textContent = dur(elapsed / 1000); if (elapsed > 15 * 60_000) stop(true); }, 250);
    const bars = [];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const d = new Uint8Array(an.frequencyBinCount); an.getByteTimeDomainData(d);
      let mx = 0; for (const v of d) mx = Math.max(mx, Math.abs(v - 128)); if (!paused) bars.push(mx / 128);
      const W = level.clientWidth, H = level.clientHeight, dpr = devicePixelRatio || 1;
      if (level.width !== W * dpr) { level.width = W * dpr; level.height = H * dpr; }
      const g = level.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.fillStyle = getComputedStyle(el).getPropertyValue("--vivid") || "#1494b8";
      const n = Math.floor(W / 4), arr = bars.slice(-n);
      arr.forEach((v, i) => { const bh = Math.max(2, v * H * 1.6); g.fillRect(i * 4, (H - bh) / 2, 2.5, Math.min(H, bh)); });
    };
    const pauseBtn = iconBtn("pause", "Pause recording", () => { if (paused) { mr.resume(); paused = false; pauseBtn.replaceChildren(icon("pause")); pauseBtn.setAttribute("aria-label", "Pause recording"); } else { mr.pause(); paused = true; pauseBtn.replaceChildren(icon("play")); pauseBtn.setAttribute("aria-label", "Resume recording"); } });
    const ui = h("div", { class: "recorder", role: "group", "aria-label": "Recording a voice note" }, h("span", { class: "live", "aria-hidden": "true" }), t, level, pauseBtn);
    const cancelBtn = iconBtn("trash", "Discard voice note", () => stop(false));
    const doneBtn = h("button", { class: "send rec", type: "button", "aria-label": "Stop and review" }, icon("check"));
    const saved = [...bar.children];
    bar.replaceChildren(cancelBtn, ui, doneBtn);
    doneBtn.focus();
    rec = { mr, stream };
    mr.start(250);
    const cleanup = () => { clearInterval(timer); cancelAnimationFrame(raf); stream.getTracks().forEach((x) => x.stop()); ac.close?.(); rec = null; };
    function stop(review) {
      mr.onstop = async () => {
        cleanup();
        if (!review || !chunks.length) { bar.replaceChildren(...saved); ta.focus(); return; }
        const blob = new Blob(chunks, { type: mt.m.split(";")[0] });
        const secs = elapsed / 1000;
        if (secs < 0.6) { toast("Hold on a little longer to record"); bar.replaceChildren(...saved); return; }
        // listen before sending
        const url = URL.createObjectURL(blob);
        const player = h("audio", { src: url, controls: true, "aria-label": "Your voice note" });
        const send = h("button", { class: "send", type: "button", "aria-label": "Send voice note" }, icon("send"));
        const del = iconBtn("trash", "Discard voice note", () => { URL.revokeObjectURL(url); bar.replaceChildren(...saved); ta.focus(); });
        bar.replaceChildren(del, h("div", { class: "recorder" }, player, h("span", { class: "t" }, dur(secs))), send);
        send.focus();
        send.onclick = async () => {
          send.disabled = true;
          try {
            let up = blob, mime = mt.up;
            if (mt.up === "webm") { try { up = await webmToOgg(blob); mime = "audio/ogg"; } catch { up = blob; mime = "video/webm"; } }
            const r = await upload(up, { purpose: "voice", scope: chatId, mime, durationSec: secs });
            await hooks.send({ type: "voice", text: "", media: { kind: "voice", key: r.key, b: r.b, dur: Math.round(secs * 10) / 10, mime }, ...base2() });
            URL.revokeObjectURL(url); bar.replaceChildren(...saved); setReply(null); ta.focus();
          } catch (e) { toast(errText(e)); send.disabled = false; }
        };
      };
      try { mr.stop(); } catch { cleanup(); bar.replaceChildren(...saved); }
    }
    doneBtn.onclick = () => stop(true);
    draw();
  }
  const base2 = () => ({ ...(silent ? { silent: true } : {}), ...(reply ? { replyTo: { id: reply.id, text: (reply.text || "").slice(0, 80), senderId: reply.senderId } } : {}) });

  paintSend(); setTimeout(grow, 0);
  return {
    el, setReply, setEdit, addFiles,
    focus: () => { if (!el.hidden && !matchMedia("(pointer: coarse)").matches) ta.focus(); },
    destroy: () => { closeEmoji?.(); if (rec) { try { rec.mr.stop(); } catch {} rec.stream.getTracks().forEach((x) => x.stop()); } tray.forEach((t) => t.url && URL.revokeObjectURL(t.url)); if (!editing) setDraft(chatId, ta.value); },
  };
}

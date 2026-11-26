// U4-fixes: one reporting system for Ripple web + Sonar web (this file is identical in both: Ripple web/u4report.js,
// Sonar web/js/u4report.js). Report anything (reasons + note, block-and-report, "tell me what happens"), see your reports,
// and — for moderators — the review queue with evidence, actions and the moderation log. Server: src/u4reports.ts.
// Usage: initReports({ api, apiBase, token, toast }) once, then openReport({ kind, targetId, ownerId?, ownerName?, preview? }).
const C = { api: null, apiBase: "", token: () => null, toast: (m) => alert(m), me: null, reasons: null };
const URGENT = new Set(["violence", "child", "self_harm"]);
const LABEL = { user: "account", post: "post", short: "Short", long: "Deep Dive", comment: "comment", message: "message", snap: "snap", story: "story",
  community: "Pool", channel: "channel", bulletin: "Bulletin", bulletin_comment: "comment", ask: "question", question: "question", game: "game" };
const canon = (k) => ({ short: "post", long: "post", snap: "message", question: "ask" })[k] || k;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const ago = (t) => { if (!t) return ""; const s = (Date.now() - t) / 1000; return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 604800 ? `${Math.floor(s / 86400)}d` : new Date(t).toLocaleDateString(); };
const errText = (e) => e?.message || "Something went wrong";

const CSS = `
.u4r-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:90;display:grid;place-items:end center;padding:0}
@media(min-width:640px){.u4r-back{place-items:center;padding:16px}}
.u4r-box{background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--line,#ddd);border-radius:24px 24px 0 0;width:min(480px,100%);max-height:92vh;overflow:auto;padding:22px 20px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35);animation:u4rin .18s ease-out}
@media(min-width:640px){.u4r-box{border-radius:24px}}
@media(prefers-reduced-motion:reduce){.u4r-box{animation:none}}
@keyframes u4rin{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
.u4r-box h2{margin:0 0 4px;font-size:1.3rem}.u4r-sub{color:var(--muted,#666);font-size:.92rem;margin:0 0 12px}
.u4r-prev{border-left:3px solid var(--primary,#36c);background:var(--surface2,#f3f3f3);border-radius:12px;padding:10px 12px;margin:8px 0 12px;font-size:.92rem;max-height:4.6em;overflow:hidden}
.u4r-reason{display:flex;align-items:center;gap:12px;width:100%;background:none;color:inherit;border:0;border-radius:14px;padding:11px 6px;text-align:left;font-weight:500;cursor:pointer}
.u4r-reason:hover,.u4r-reason:focus-visible{background:var(--surface2,#f3f3f3)}
.u4r-dot{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--surface2,#eee);flex:none;font-size:16px}
.u4r-dot.urgent{background:color-mix(in srgb,var(--danger,#d33) 25%,transparent)}
.u4r-pill{display:inline-flex;gap:8px;align-items:center;background:var(--surface2,#eee);color:var(--text,#111);border:0;border-radius:999px;padding:.45em 1em;font-weight:600;cursor:pointer}
.u4r-note{width:100%;min-height:84px;border-radius:14px;border:1px solid var(--line,#ccc);background:var(--bg,#fff);color:inherit;padding:10px 12px;font:inherit;margin-top:12px;resize:vertical}
.u4r-tog{display:flex;align-items:center;gap:12px;padding:10px 2px;cursor:pointer}.u4r-tog small{display:block;color:var(--muted,#666)}
.u4r-tog input{width:20px;height:20px;accent-color:var(--vivid,#36c);flex:none}
.u4r-go{width:100%;margin-top:14px;padding:.8em 1em;border-radius:999px;border:0;background:var(--vivid,#36c);color:#fff;font-weight:700;cursor:pointer}
.u4r-go:disabled{opacity:.5}.u4r-ghost{background:none;border:0;color:var(--primary,#36c);font-weight:600;cursor:pointer;padding:.6em;width:100%}
.u4r-warn{background:color-mix(in srgb,var(--danger,#d33) 18%,transparent);border-radius:12px;padding:10px 12px;font-size:.88rem;margin-top:10px}
.u4r-done{text-align:center}.u4r-check{width:68px;height:68px;border-radius:50%;margin:6px auto 10px;display:grid;place-items:center;background:color-mix(in srgb,var(--vivid,#36c) 22%,transparent);font-size:32px}
.u4r-steps{background:var(--surface2,#f3f3f3);border-radius:16px;padding:12px 14px;text-align:left;margin-top:14px;font-size:.92rem;display:grid;gap:8px}
.u4r-page{position:fixed;inset:0;z-index:80;background:var(--bg,#fff);color:var(--text,#111);overflow:auto}
.u4r-head{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:12px 16px;background:color-mix(in srgb,var(--bg,#fff) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line,#ddd);z-index:1}
.u4r-head h1{font-size:1.15rem;margin:0;flex:1}.u4r-head button{background:var(--surface2,#eee);color:var(--text,#111);border:0;border-radius:999px;padding:.4em .9em;cursor:pointer;font-weight:600}
.u4r-wrap{max-width:760px;margin:0 auto;padding:12px 16px 60px}
.u4r-chips{display:flex;gap:8px;overflow:auto;padding:4px 0 8px;scrollbar-width:none}.u4r-chips::-webkit-scrollbar{display:none}.u4r-chip{flex:none;background:var(--surface2,#eee);color:var(--muted,#555);border:0;border-radius:999px;padding:.4em .95em;font-weight:600;cursor:pointer}
.u4r-chip.on{background:var(--vivid,#36c);color:#fff}
.u4r-card{background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:20px;padding:14px;margin:10px 0;cursor:pointer}
.u4r-card:hover{border-color:var(--primary,#36c)}
.u4r-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.u4r-muted{color:var(--muted,#666);font-size:.88rem}
.u4r-tag{display:inline-block;border-radius:999px;padding:.12em .65em;font-size:.78rem;font-weight:600;background:var(--surface2,#eee)}
.u4r-tag.red{background:color-mix(in srgb,var(--danger,#d33) 28%,transparent);color:var(--text,#111)}.u4r-tag.blue{background:color-mix(in srgb,var(--vivid,#36c) 22%,transparent)}
.u4r-text{margin:8px 0;white-space:pre-wrap;word-break:break-word}
.u4r-media{max-width:100%;max-height:360px;border-radius:14px;display:block;margin:8px 0;background:var(--surface2,#eee)}
.u4r-actions{position:sticky;bottom:0;display:flex;gap:8px;flex-wrap:wrap;padding:12px 0;background:var(--bg,#fff);border-top:1px solid var(--line,#ddd)}
.u4r-actions button{border:0;border-radius:999px;padding:.55em 1.05em;font-weight:600;cursor:pointer;background:var(--surface2,#eee);color:var(--text,#111)}
.u4r-actions button.main{background:var(--vivid,#36c);color:#fff}.u4r-actions button.bad{background:transparent;color:var(--text,#111);box-shadow:inset 0 0 0 1.5px var(--danger,#d33)}
.u4r-fab{position:fixed;right:18px;bottom:18px;z-index:40;border:0;border-radius:999px;padding:.7em 1.1em;font-weight:700;background:var(--vivid,#36c);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer}
`;
function css() { if (!document.getElementById("u4r-css")) document.head.append(h("style", { id: "u4r-css" }, CSS)); }

export async function initReports(opts) {
  Object.assign(C, opts);
  css();
  if (!C.listening) { C.listening = true; addEventListener("hashchange", fromHash); }
  setTimeout(fromHash, 0);
  document.querySelector(".u4r-fab")?.remove();
  if (!C.token()) return;
  try { C.me = await C.api("/v1/me"); } catch { C.me = null; }
  const role = C.me?.role?.role, acc = C.me?.access || {};
  if (acc.owner || acc.admin || role === "admin" || role === "moderator" || role === "owner") {
    document.body.append(h("button", { class: "u4r-fab", title: "Review queue", onclick: () => openQueue() }, "🛡 Review queue"));
  }
}
function fromHash() {
  if (location.hash === "#/reports") openMine();
  else if (location.hash === "#/mod") openQueue();
}

async function reasonsFor(kind) {
  if (!C.reasons) { try { C.reasons = (await C.api("/v1/reports/reasons")).kinds; } catch { C.reasons = {}; } }
  return C.reasons[canon(kind)] || [{ id: "spam", label: "Spam or fake engagement" }, { id: "harassment", label: "Bullying or harassment" }, { id: "hate", label: "Hate speech or symbols" },
    { id: "violence", label: "Violence or threats" }, { id: "sexual", label: "Nudity or sexual content" }, { id: "other", label: "Something else" }];
}
const ICON = { spam: "📣", harassment: "😣", hate: "⚖️", violence: "⚠️", sexual: "🙈", child: "🧒", self_harm: "💗", scam: "💸", false_info: "❓", impersonation: "🎭", ip: "©", broken: "🧩", other: "…" };

/** The reporter flow: why → details (+ block, + updates) → confirmation. */
export async function openReport(t) {
  css();
  const what = LABEL[t.kind] || t.kind;
  const box = h("div", { class: "u4r-box", role: "dialog", "aria-modal": "true", "aria-label": `Report this ${what}` });
  const back = h("div", { class: "u4r-back", onclick: (e) => { if (e.target === back) close(); } }, box);
  const close = () => { back.remove(); removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", esc);
  document.body.append(back);
  const reasons = await reasonsFor(t.kind);
  const step1 = () => {
    box.replaceChildren(h("h2", {}, `Report this ${what}`),
      h("p", { class: "u4r-sub" }, `Your report is private. ${t.ownerName ? t.ownerName + " won’t" : "They won’t"} know it was you.`),
      t.preview ? h("div", { class: "u4r-prev" }, t.preview) : "",
      h("div", { class: "u4r-muted", style: "margin:4px 0" }, "Why are you reporting it?"),
      ...reasons.map((r) => h("button", { class: "u4r-reason", type: "button", onclick: () => step2(r) },
        h("span", { class: "u4r-dot" + (URGENT.has(r.id) ? " urgent" : "") }, ICON[r.id] || "•"), h("span", { style: "flex:1" }, r.label), h("span", { class: "u4r-muted" }, "›"))),
      h("button", { class: "u4r-ghost", type: "button", onclick: close }, "Cancel"));
    box.querySelector(".u4r-reason")?.focus();
  };
  const step2 = (r) => {
    const note = h("textarea", { class: "u4r-note", maxlength: "1000", placeholder: "Add details (optional)" });
    const canBlock = !!t.ownerId || canon(t.kind) === "ask";
    const block = h("input", { type: "checkbox" }); const tell = h("input", { type: "checkbox", checked: true });
    const go = h("button", { class: "u4r-go", type: "button" }, "Send report");
    block.addEventListener("change", () => (go.textContent = block.checked ? "Block and report" : "Send report"));
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = "Sending…";
      try {
        const res = await C.api("/v1/reports", { method: "POST", body: { kind: t.kind, targetId: t.targetId, reason: r.id, details: note.value.trim(), note: note.value.trim(),
          block: block.checked, notify: tell.checked, app: "web", ...(t.ownerId ? { targetOwner: t.ownerId } : {}) } });
        done(res, block.checked && res.blocked);
      } catch (e) { C.toast(errText(e)); go.disabled = false; go.textContent = block.checked ? "Block and report" : "Send report"; }
    });
    box.replaceChildren(h("h2", {}, `Report this ${what}`),
      h("button", { class: "u4r-pill", type: "button", onclick: step1, title: "Change reason" }, h("span", {}, ICON[r.id] || "•"), h("span", {}, r.label), h("span", { style: "color:var(--primary)" }, "Change")),
      URGENT.has(r.id) ? h("div", { class: "u4r-warn" }, "If someone is in immediate danger, contact your local emergency services first. Urgent reports go to the top of the queue.") : "",
      note,
      canBlock ? h("label", { class: "u4r-tog" }, block, h("span", {}, `Also block ${t.ownerName || (canon(t.kind) === "ask" ? "the person who asked" : "them")}`, h("small", {}, "They can’t message you or see what you share. They aren’t told."))) : "",
      h("label", { class: "u4r-tog" }, tell, h("span", {}, "Tell me what happens", h("small", {}, "You’ll get a notification when a moderator has reviewed it."))),
      go, h("button", { class: "u4r-ghost", type: "button", onclick: close }, "Cancel"));
    note.focus();
  };
  const done = (res, blocked) => {
    box.replaceChildren(h("div", { class: "u4r-done" }, h("div", { class: "u4r-check" }, "✓"),
      h("h2", {}, res.already ? "You already reported this" : "Thanks for letting us know"), h("p", { class: "u4r-sub" }, res.message || ""),
      h("div", { class: "u4r-steps" }, h("div", {}, "🛡 A moderator reviews it, usually within a day."), h("div", {}, "⚖️ If it breaks the rules we remove it or act on the account."),
        h("div", {}, "🔒 Nobody else sees who reported it."), blocked ? h("div", {}, `⛔ You blocked ${t.ownerName || "them"}.`) : ""),
      h("button", { class: "u4r-go", type: "button", onclick: () => { close(); if (blocked && t.onBlocked) t.onBlocked(); } }, "Done"),
      h("button", { class: "u4r-ghost", type: "button", onclick: () => { close(); openMine(); } }, "See your reports")));
  };
  step1();
}

function page(title, ...buttons) {
  css();
  document.querySelector(".u4r-page")?.remove();
  const wrap = h("div", { class: "u4r-wrap" });
  const el = h("div", { class: "u4r-page", role: "dialog", "aria-label": title },
    h("div", { class: "u4r-head" }, h("button", { type: "button", onclick: () => { el.remove(); if (/^#\/(reports|mod)$/.test(location.hash)) history.back(); } }, "← Back"), h("h1", {}, title), ...buttons), wrap);
  document.body.append(el);
  return wrap;
}

/** "Your reports" — what happened to things you reported, plus moderator warnings. */
export async function openMine() {
  const w = page("Your reports");
  w.append(h("p", { class: "u4r-muted" }, "Loading…"));
  try {
    const [mine, warns] = await Promise.all([C.api("/v1/reports/mine"), C.api("/v1/me/warnings").catch(() => ({ items: [] }))]);
    w.replaceChildren();
    if (warns.items?.length) {
      w.append(h("h3", { style: "color:var(--danger)" }, "Messages from the moderators"), ...warns.items.map((x) => h("div", { class: "u4r-card", style: "cursor:default" }, "⚠️ ", x.text, h("div", { class: "u4r-muted" }, ago(x.at)))));
      if (warns.unseen) C.api("/v1/me/warnings/seen", { method: "POST", body: {} }).catch(() => {});
    }
    if (!mine.items.length) { w.append(h("p", { class: "u4r-muted", style: "text-align:center;padding:40px 0" }, "No reports yet. When you report something, you can follow it here.")); return; }
    w.append(h("p", { class: "u4r-muted" }, "Only you can see this list. People you report aren’t told who reported them."));
    for (const r of mine.items) {
      const st = r.status === "open" ? ["In review", "blue"] : r.outcome === "removed" ? ["Removed", "blue"] : r.outcome === "action" ? ["Action taken", "blue"] : ["No rule broken", ""];
      w.append(h("div", { class: "u4r-card", style: "cursor:default" },
        h("div", { class: "u4r-row" }, h("strong", { style: "flex:1" }, (r.kindLabel || r.kind).replace(/^./, (c) => c.toUpperCase())), h("span", { class: "u4r-tag " + st[1] }, st[0])),
        r.summary ? h("div", { class: "u4r-text" }, r.summary) : "",
        h("div", { class: "u4r-muted" }, `${r.reasonLabel} · ${ago(r.at)}${r.reviewedAt ? " · reviewed " + ago(r.reviewedAt) : ""}${r.blocked ? " · blocked" : ""}`)));
    }
  } catch (e) { w.replaceChildren(h("p", { class: "u4r-muted" }, errText(e))); }
}

// ---------------------------------------------------------------- moderators
const KINDS = [["", "All"], ["user", "Accounts"], ["post", "Posts"], ["comment", "Comments"], ["message", "Messages"], ["channel", "Channels"], ["bulletin", "Bulletins"], ["ask", "Questions"], ["game", "Games"], ["story", "Stories"], ["community", "Pools"]];
const STAT = [["open", "Open"], ["hidden", "Hidden"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]];
const ACT = { dismiss: "Dismissed", remove: "Removed", warn: "Warned", suspend: "Suspended", ban: "Banned", cloak: "Cloaked", hide: "Hidden", unhide: "Unhidden", reopen: "Reopened", autohide: "Auto-hidden", settings: "Settings changed" };

export async function openQueue(status = "open", kind = "") {
  const w = page("Review queue", h("button", { type: "button", onclick: () => openLog() }, "Log"), h("button", { type: "button", onclick: () => settings() }, "Auto-hide"));
  w.append(h("p", { class: "u4r-muted" }, "Loading…"));
  let q;
  try { q = await C.api(`/v1/mod/queue?status=${status}${kind ? "&kind=" + kind : ""}`); } catch (e) { w.replaceChildren(h("p", { class: "u4r-muted" }, errText(e))); return; }
  w.replaceChildren(
    h("div", { class: "u4r-chips" }, ...STAT.map(([k, l]) => h("button", { class: "u4r-chip" + (k === status ? " on" : ""), type: "button", onclick: () => openQueue(k, kind) },
      l + (k === "open" && q.counts.open ? ` · ${q.counts.open}` : k === "hidden" && q.counts.hidden ? ` · ${q.counts.hidden}` : "")))),
    h("div", { class: "u4r-chips" }, ...KINDS.map(([k, l]) => h("button", { class: "u4r-chip" + (k === kind ? " on" : ""), type: "button", onclick: () => openQueue(status, k) }, l))));
  if (!q.items.length) { w.append(h("p", { class: "u4r-muted", style: "text-align:center;padding:40px 0" }, status === "open" ? "All clear — no open reports." : "Nothing here.")); return; }
  if (status === "open" && q.counts.urgent) w.append(h("div", { style: "color:var(--danger);font-weight:600" }, `${q.counts.urgent} urgent — shown first`));
  for (const c of q.items) {
    const o = c.owner || {};
    const text = [c.content.title, c.content.text].filter(Boolean).join(" — ");
    w.append(h("div", { class: "u4r-card", tabindex: "0", role: "button", onclick: () => openCase(c.id), onkeydown: (e) => { if (e.key === "Enter") openCase(c.id); } },
      h("div", { class: "u4r-row" }, h("strong", { style: "color:var(--primary)" }, c.kindLabel.replace(/^./, (x) => x.toUpperCase())),
        h("span", { class: "u4r-muted", style: "flex:1" }, `${c.reporters} reporter${c.reporters === 1 ? "" : "s"} · ${ago(c.lastAt)}`),
        c.urgent ? h("span", { class: "u4r-tag red" }, "Urgent") : "", c.hidden ? h("span", { class: "u4r-tag blue" }, c.autoHidden ? "Auto-hidden" : "Hidden") : ""),
      h("div", { class: "u4r-row", style: "margin-top:6px" }, h("strong", {}, o.name || "Unknown"), o.username ? h("span", { class: "u4r-muted" }, "@" + o.username) : "",
        c.strikes && c.strikes.warnings + c.strikes.actions ? h("span", { class: "u4r-tag red" }, `${c.strikes.warnings + c.strikes.actions} strikes`) : ""),
      text ? h("div", { class: "u4r-text" }, text.length > 280 ? text.slice(0, 280) + "…" : text) : "",
      c.content.media.length ? h("div", { class: "u4r-muted" }, `📎 ${c.content.media.length} file${c.content.media.length > 1 ? "s" : ""}`) : "",
      h("div", { class: "u4r-row", style: "margin-top:6px" }, ...c.reasons.map((r) => h("span", { class: "u4r-tag" }, `${r.label} · ${r.n}`))),
      c.notes[0] ? h("div", { class: "u4r-muted", style: "margin-top:6px" }, `“${c.notes[0].text}”`) : "",
      c.decision ? h("div", { class: "u4r-muted", style: "margin-top:6px;color:var(--primary)" }, `${ACT[c.decision.action] || "Closed"} by ${c.decision.by?.username ? "@" + c.decision.by.username : "a moderator"} · ${ago(c.decision.at)}`) : ""));
  }
}

async function mediaEl(m) {
  try {
    const r = await fetch(C.apiBase + m.path, { headers: { authorization: `Bearer ${C.token()}` } });
    if (!r.ok) throw new Error(r.status === 410 ? "That file is gone" : `Couldn’t load (${r.status})`);
    const url = URL.createObjectURL(await r.blob());
    const el = m.mime === "image" ? h("img", { class: "u4r-media", src: url, alt: "Reported image" }) : m.mime === "video" ? h("video", { class: "u4r-media", src: url, controls: true })
      : m.mime === "audio" ? h("audio", { src: url, controls: true }) : h("a", { href: url, download: "reported-file" }, "Download file");
    return h("div", {}, m.evidence ? h("span", { class: "u4r-tag" }, "Evidence copy") : "", el);
  } catch (e) { return h("div", { class: "u4r-muted" }, errText(e)); }
}

export async function openCase(id) {
  const w = page("Report");
  w.append(h("p", { class: "u4r-muted" }, "Loading…"));
  let c;
  try { c = await C.api(`/v1/mod/cases/${encodeURIComponent(id)}`); } catch (e) { w.replaceChildren(h("p", { class: "u4r-muted" }, errText(e))); return; }
  const o = c.owner || {};
  const st = { up: "still up", hidden: "hidden", removed: "removed", deleted: "deleted by its owner", expired: "expired", suspended: "suspended", banned: "banned" }[c.content.state] || c.content.state;
  w.replaceChildren(
    h("div", { class: "u4r-row" }, h("h2", { style: "margin:4px 0;flex:1" }, `${c.kindLabel.replace(/^./, (x) => x.toUpperCase())} · ${st}`), c.urgent ? h("span", { class: "u4r-tag red" }, "Urgent") : ""),
    h("div", { class: "u4r-card", style: "cursor:default" }, h("strong", {}, o.name || "Unknown"), " ", o.username ? h("span", { class: "u4r-muted" }, "@" + o.username) : "",
      c.strikes ? h("div", { class: "u4r-muted" }, `${c.strikes.warnings} warnings · ${c.strikes.actions} past actions`) : ""),
    h("div", { class: "u4r-card", style: "cursor:default" }, h("div", { class: "u4r-muted" }, "Reported content"),
      c.content.title ? h("h3", { style: "margin:6px 0" }, c.content.title) : "", c.content.text ? h("div", { class: "u4r-text" }, c.content.text) : "",
      c.content.snap?.snap ? h("div", { class: "u4r-muted" }, "Snap · only the reported snap is shared with moderators") : "", ...(await Promise.all(c.content.media.map(mediaEl)))),
    h("h3", {}, "Why people reported it"), h("div", { class: "u4r-row" }, ...c.reasons.map((r) => h("span", { class: "u4r-tag" }, `${r.label} · ${r.n}`))),
    h("h3", {}, `Reports (${c.reports.length})`),
    ...c.reports.map((r) => h("div", { style: "padding:6px 0;border-bottom:1px solid var(--line)" }, h("strong", {}, "@" + (r.by?.username || "?")), ` · ${r.reasonLabel}${r.blocked ? " · blocked them" : ""}`,
      r.note ? h("div", {}, r.note) : "", h("div", { class: "u4r-muted" }, `${ago(r.at)}${r.app ? " · " + r.app : ""}${r.status !== "open" ? " · " + r.status : ""}`))),
    c.log.length ? h("h3", {}, "History") : "", ...c.log.map(logRow));
  const can = c.can || {}; const open = c.status === "open";
  const btn = (label, action, cls = "") => h("button", { type: "button", class: cls, onclick: () => act(c, action) }, label);
  w.append(h("div", { class: "u4r-actions" },
    open ? btn("Dismiss", "dismiss") : "",
    c.kind !== "user" ? (c.hidden ? btn("Unhide", "unhide") : open ? btn("Hide", "hide") : "") : "",
    c.kind !== "user" && c.content.state !== "removed" ? btn("Remove", "remove", "main") : "",
    c.owner ? btn("Warn", "warn") : "", c.owner && can.suspend ? btn("Suspend", "suspend") : "", c.owner && can.ban ? btn("Ban", "ban", "bad") : "",
    c.owner && can.cloak ? btn("Cloak", "cloak") : "", !open ? btn("Reopen", "reopen") : ""));
}
function logRow(l) {
  const d = l.details || {};
  const extra = [d.note, d.message, d.days ? d.days + " days" : "", d.removed ? "content removed" : "", d.at ? "auto-hide at " + d.at : ""].filter(Boolean).join(" · ");
  return h("div", { style: "padding:6px 0;border-bottom:1px solid var(--line)" }, h("strong", {}, ACT[(l.action || "").replace(/^mod_/, "")] || l.action), " · ",
    l.by?.username ? "@" + l.by.username : l.by?.name || "", h("span", { class: "u4r-muted" }, " · " + ago(l.at)), extra ? h("div", { class: "u4r-muted" }, extra) : "");
}

async function act(c, action) {
  const who = c.owner?.username ? "@" + c.owner.username : "this account";
  const ask = { dismiss: "Dismiss: no rule broken.", hide: "Hide it while you review?", unhide: "Make it visible again?", remove: `Remove this ${c.kindLabel}? ${who} is told why.`,
    warn: `Warn ${who}?`, suspend: `Suspend ${who}?`, ban: `Ban ${who}? They’re signed out for good.`, cloak: `Cloak ${who}? Nobody else will see what they post. They aren’t told.`, reopen: "Reopen this case?" }[action];
  const body = { action };
  if (action === "warn") { const m = prompt(`${ask}\nMessage to ${who}:`, "Please keep it kind."); if (m == null) return; body.message = m; }
  else if (action === "suspend") { const d = prompt(`${ask}\nHow many days?`, "7"); if (d == null) return; body.days = Number(d) || 7; }
  else if (!confirm(ask)) return;
  if (["remove", "dismiss", "warn", "suspend", "ban", "cloak"].includes(action)) { const n = prompt(action === "remove" ? `Reason (shown to ${who}):` : "Note for the log (optional):", ""); if (n == null) return; body.note = n; }
  if (["warn", "suspend", "ban", "cloak"].includes(action) && c.kind !== "user") body.alsoRemove = confirm(`Also remove the ${c.kindLabel}?`);
  try { await C.api(`/v1/mod/cases/${encodeURIComponent(c.id)}/action`, { method: "POST", body }); C.toast("Done"); openCase(c.id); } catch (e) { C.toast(errText(e)); }
}
async function openLog() {
  const w = page("Moderation log");
  try {
    const l = await C.api("/v1/mod/audit");
    w.replaceChildren(...(l.items.length ? l.items.map((x) => { const r = logRow(x); if (String(x.target).startsWith("case:")) { r.style.cursor = "pointer"; r.onclick = () => openCase(x.target.slice(5)); } return r; })
      : [h("p", { class: "u4r-muted" }, "Nothing yet.")]));
  } catch (e) { w.replaceChildren(h("p", { class: "u4r-muted" }, errText(e))); }
}
async function settings() {
  try {
    const s = await C.api("/v1/mod/settings");
    if (!s.canEdit) { alert(`Auto-hide after ${s.autoHideAt || "—"} reports (${s.autoHideAt ? "on" : "off"}). Only the owner can change it.`); return; }
    const n = prompt("Hide a post, comment, Bulletin, question, channel, game or group message after this many different people report it (0 = off). Accounts are never hidden automatically.", String(s.autoHideAt));
    if (n == null) return;
    await C.api("/v1/mod/settings", { method: "PUT", body: { autoHideAt: Math.max(0, Math.min(100, Number(n) || 0)) } });
    C.toast("Saved");
  } catch (e) { C.toast(errText(e)); }
}

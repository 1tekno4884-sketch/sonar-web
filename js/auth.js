// Logged-out landing page + sign in / sign up / recovery — the same flows and client-side password hashing as
// Ripple's web viewer (a Sonar account IS a Ripple account).
import { api, post, passwordHash, setToken } from "./api.js";
import { h, icon, mark, modal, closeModal, toast, errText } from "./dom.js";
import { RIPPLE_WEB_URL, SONAR_APK_URL, STUDIO_URL } from "../config.js";

let onSignedIn = () => {};
export function setOnSignedIn(fn) { onSignedIn = fn; }

const field = (attrs) => h("input", attrs);

export function signInModal(prefill = "") {
  const err = h("div", { class: "err", role: "alert" });
  const un = field({ placeholder: "Username", autocomplete: "username", value: prefill, "aria-label": "Username", autocapitalize: "none", spellcheck: "false" });
  const pw = field({ placeholder: "Password", type: "password", autocomplete: "current-password", "aria-label": "Password" });
  const go = h("button", { type: "submit" }, "Sign in");
  const form = h("form", { class: "stack" }, un, pw, go, err,
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); signUpModal(); } }, "New here? Create an account"),
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); recoverModal(un.value); } }, "Forgot password? Use a recovery code"),
    h("div", { class: "meta" }, "Use your Ripple username and password — it's the same account. Sonar is for people 13 and older."));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    const u = un.value.trim().replace(/^@/, "");
    if (u.includes("@")) { err.textContent = "Use your Ripple username (no @)."; return; }
    if (!u || !pw.value) { err.textContent = "Enter your username and password."; return; }
    go.disabled = true; go.textContent = "Signing in…";
    try {
      const j = await api("/v1/auth/login", { method: "POST", body: { username: u, passwordHash: await passwordHash(u, pw.value) } });
      setToken(j.token); closeModal(); onSignedIn(j);
    } catch (e2) { err.textContent = errText(e2); }
    go.disabled = false; go.textContent = "Sign in";
  };
  modal([h("h2", {}, "Sign in to Sonar"), form], { label: "Sign in" });
  setTimeout(() => (prefill ? pw : un).focus(), 0);
}

export function signUpModal() {
  const err = h("div", { class: "err", role: "alert" });
  const avail = h("div", { class: "meta", "aria-live": "polite" });
  const un = field({ placeholder: "Username (3–20 letters, numbers, . or _)", autocomplete: "username", "aria-label": "Username", autocapitalize: "none", spellcheck: "false" });
  const dn = field({ placeholder: "Display name", "aria-label": "Display name", autocomplete: "name" });
  const pw = field({ placeholder: "Password (8+ characters)", type: "password", autocomplete: "new-password", "aria-label": "Password" });
  const by = field({ placeholder: "Birth year", inputmode: "numeric", "aria-label": "Birth year", maxlength: "4" });
  let t;
  un.addEventListener("input", () => {
    clearTimeout(t); avail.textContent = "";
    const v = un.value.trim(); if (!v) return;
    t = setTimeout(async () => {
      try { const a = await api(`/v1/username-available?u=${encodeURIComponent(v)}`); avail.textContent = a.ok ? `✓ @${a.name} is available` : (a.reason || "That username is taken"); }
      catch {}
    }, 350);
  });
  const go = h("button", { type: "submit" }, "Create account");
  const form = h("form", { class: "stack" }, un, avail, dn, pw, by, go, err,
    h("div", { class: "meta" }, "This creates a normal Ripple account — it works in Ripple and Sonar. No email needed. You'll get 8 one-time recovery codes; they're the only way back in if you forget your password."),
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); signInModal(); } }, "Have an account? Sign in"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    const u = un.value.trim(); const year = Number(by.value);
    if (u.includes("@")) { err.textContent = "Usernames can't contain @"; return; }
    if (pw.value.length < 8) { err.textContent = "Use at least 8 characters"; return; }
    if (!(year > 1900) || year > new Date().getFullYear() || new Date().getFullYear() - year < 13) { err.textContent = "You must be 13 or older to use Sonar"; return; }
    go.disabled = true;
    try {
      const j = await api("/v1/auth/signup", { method: "POST", body: { username: u, passwordHash: await passwordHash(u, pw.value), displayName: dn.value.trim() || u, birthYear: year, interests: [] } });
      setToken(j.token);
      showCodes(j.recoveryCodes || [], () => onSignedIn(j));
    } catch (e2) { err.textContent = errText(e2); go.disabled = false; }
  };
  modal([h("h2", {}, "Create your account"), form], { label: "Create account" });
}

export function showCodes(codes, then) {
  const ok = h("input", { type: "checkbox", id: "saved" });
  let done = false;
  const cont = h("button", { disabled: true, onclick: () => { done = true; closeModal(); then?.(); } }, "Continue");
  ok.addEventListener("change", () => (cont.disabled = !ok.checked));
  modal([h("h2", {}, "Save your recovery codes"),
    h("p", {}, "Each code works once to reset your password without email. They can't be shown again."),
    h("pre", { "aria-label": "Recovery codes" }, codes.map((c, i) => `${i + 1}. ${c}`).join("\n")),
    h("div", { class: "stack" },
      h("div", { class: "row" },
        h("button", { class: "tonal", onclick: () => { navigator.clipboard?.writeText(codes.join("\n")).then(() => toast("Copied"), () => toast("Couldn't copy")); } }, "Copy all"),
        h("button", { class: "tonal", onclick: () => {
          const a = h("a", { href: URL.createObjectURL(new Blob([`Sonar / Ripple recovery codes\n\n${codes.join("\n")}\n`], { type: "text/plain" })), download: "sonar-recovery-codes.txt" });
          document.body.append(a); a.click(); a.remove();
        } }, "Download")),
      h("label", { class: "row", for: "saved" }, ok, " I saved them somewhere safe"), cont)],
  { label: "Recovery codes", onClose: () => { if (!done) then?.(); } });
}

export function recoverModal(prefill = "") {
  const err = h("div", { class: "err", role: "alert" });
  const un = field({ placeholder: "Username", value: prefill, "aria-label": "Username", autocapitalize: "none" });
  const code = field({ placeholder: "Recovery code (XXXX-XXXX)", "aria-label": "Recovery code", autocapitalize: "characters" });
  const pw = field({ placeholder: "New password (8+ characters)", type: "password", autocomplete: "new-password", "aria-label": "New password" });
  const go = h("button", { type: "submit" }, "Reset password");
  const form = h("form", { class: "stack" }, un, code, pw, go, err,
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); signInModal(un.value); } }, "Back to sign in"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (pw.value.length < 8) { err.textContent = "Use at least 8 characters"; return; }
    go.disabled = true;
    try {
      const u = un.value.trim();
      await post("/v1/recover", { username: u, code: code.value.trim(), newPasswordHash: await passwordHash(u, pw.value) });
      toast("Password changed — sign in"); signInModal(u);
    } catch (e2) { err.textContent = errText(e2); }
    go.disabled = false;
  };
  modal([h("h2", {}, "Reset your password"), form], { label: "Reset password" });
}

const FEATURES = [
  ["chat", "All your Ripple chats", "Same account, same chats and follows. A message sent here shows up in Ripple and the other way round."],
  ["video", "Voice & video calls", "Call from the browser to a phone. Peer-to-peer and encrypted in transit (DTLS-SRTP). Never recorded."],
  ["image", "Photos, voice notes, files", "Drag and drop, paste images, record voice notes, share files, polls and more."],
  ["palette", "Make it yours", "Themes, accent colours, bubble styles and ocean wallpapers — synced with the app."],
];

/** The logged-out page. `pendingNote` explains why sign-in is needed (e.g. a call link). */
export function renderLanding(pendingNote) {
  const page = h("div", { class: "landing" },
    h("header", { class: "top" },
      h("a", { class: "brand", href: "#/" }, mark(), h("span", {}, "Sonar")),
      h("span", { class: "sp" }),
      h("button", { class: "tonal", onclick: () => signUpModal() }, "Create account"),
      h("button", { onclick: () => signInModal() }, "Sign in")),
    h("main", {},
      h("section", { class: "hero" },
        h("div", {},
          pendingNote ? h("div", { class: "banner-note", style: "margin:0 0 16px", role: "status" }, icon("info"), h("span", { class: "grow" }, pendingNote)) : null,
          h("h1", {}, "Chats and calls, ", h("em", {}, "on the same wavelength.")),
          h("p", { class: "lead" }, "Sonar is the chat companion to Ripple — your Ripple chats, groups and follows, plus voice and video calls. On Android and right here in your browser."),
          h("div", { class: "cta" },
            h("button", { onclick: () => signInModal() }, "Sign in with Ripple"),
            h("a", { class: "button", href: SONAR_APK_URL, rel: "noopener", target: "_blank" }, "Get the Android app"))),
        h("div", { class: "art", "aria-hidden": "true" }, h("span", { class: "ring" }), h("span", { class: "ring" }), h("span", { class: "ring" }), mark("mark"))),
      h("section", { class: "features", "aria-label": "What Sonar does" },
        FEATURES.map(([ic, t, d]) => h("div", { class: "card" }, icon(ic), h("h3", {}, t), h("p", {}, d))))),
    h("footer", { class: "site-foot" },
      h("div", {}, h("b", {}, "Made by Brayden"), " · ", h("a", { href: RIPPLE_WEB_URL, rel: "noopener" }, "Ripple on the web"), " · ",
        h("a", { href: STUDIO_URL, rel: "noopener" }, "Undertow Studio")),
      h("div", { class: "small", style: "margin-top:6px" }, "Free forever. No ads, no paywalls. Calls are never recorded.")));
  document.getElementById("app").replaceChildren(page);
}

// Sonar web service worker — caches the app shell only (HTML, CSS, JS, fonts, icons) so the app opens fast and
// installs as a PWA. It never stores messages, media or API responses: those are on another origin and pass through.
const VERSION = "sonar-shell-v9";   // U3 merge: v6 (U3-social) → v7 for U3-custom js/u3.js + U3-games games.html/waves; U4-fixes: v8 (js/u4report.js); U4 merge: v9 (glassrs icons + CSS, fixes js/u4report.js)
const SHELL = [
  "./", "index.html", "style.css", "calls.css", "identity.css", "config.js", "manifest.webmanifest",
  "js/app.js", "js/api.js", "js/dom.js", "js/state.js", "js/settings.js", "js/wallpaper.js", "js/line.js", "js/notify.js",
  "js/layout.js", "js/auth.js", "js/chats.js", "js/messages.js", "js/composer.js", "js/media.js", "js/emoji.js",
  "js/people.js", "js/settingsui.js", "js/calls.js", "js/channels.js", "js/custom.js", "js/u3.js",   // U2-custom, U3-custom
  "js/identity.js", // U2-identity
  "js/u2dev.js",   // U2-dev
  "js/u3map.js", "js/u3social.js",   // U3-social
  "js/u4report.js",   // U4-fixes
  "games.html", "waves/games-web.js", "waves/bridge.js", "waves/index.json",   // U3-games (each game page is cached on first play)
  "fonts/inter.ttf", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;   // API, media, WebSocket: never touched
  if (url.pathname.includes("/stickers/")) return;                          // sticker art: normal HTTP caching
  // network first for the shell (so updates land on the next load), cache as the offline fallback
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});

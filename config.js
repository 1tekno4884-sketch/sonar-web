// Sonar web config. Public values only — no secrets. Everything goes through the Ripple Worker
// (docs/SONAR_API.md + Ripple's docs/API.md).
//
// Local testing: open the app once with ?api=http://127.0.0.1:8787 — the choice is kept in localStorage
// (open with ?api=default to go back to the live Worker).
const LIVE_API = "https://ripple-api.undertowstudio.workers.dev";
const KEY = "sonar_api_override";

function pickApi() {
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q === "default" || q === "") localStorage.removeItem(KEY);
    else if (q && /^https?:\/\/[A-Za-z0-9.:\-[\]]+\/?$/.test(q)) localStorage.setItem(KEY, q.replace(/\/$/, ""));
    return localStorage.getItem(KEY) || LIVE_API;
  } catch { return LIVE_API; }
}

export const API_URL = pickApi();
export const RIPPLE_WEB_URL = "https://1tekno4884-sketch.github.io/ripple-web/";
export const SONAR_APK_URL = "https://1tekno4884-sketch.github.io/undertow-studio/";
export const STUDIO_URL = "https://1tekno4884-sketch.github.io/undertow-studio/";
export const VERSION = "1.1.0";

// Calls in the browser: WebRTC (peer-to-peer, DTLS-SRTP), mesh for groups (≤ 8). The Worker only relays signaling
// through the Line WebSocket, checks "who can call me", keeps history and hands out ICE servers. Nothing is recorded.
// Signaling convention (docs/SONAR_API.md), shared with the Android app:
//   {type:"offer"|"answer", sdp} · {type:"ice", candidate, sdpMid, sdpMLineIndex, candidates?:[…]} · {type:"media", audio, video}
//   {type:"video-request"} / {type:"video-reply", ok} · {type:"restart"}
// For each pair the LOWER uid creates the offer (impolite); renegotiation uses perfect negotiation (polite = higher uid).
import { API, token, get, post, del, items } from "./api.js";
import { h, icon, iconBtn, toast, menu, modal, avatar, badges, dur, listTime, errText, confirmBox, debounce, enc } from "./dom.js";
import { state, user, seedUser, userName, emit, on } from "./state.js";
import { onLine } from "./line.js";
import { notify, startRingtone, startDialtone, stopRingtone } from "./notify.js";
import { mainEmpty, backBtn, setBadge } from "./layout.js";
import { flairName } from "./identity.js";   // U2-identity

const PRIVACY_LINE = "Calls are peer-to-peer and encrypted in transit (DTLS-SRTP)";
const DEFAULT_ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const MAX_MEMBERS = 8;
const RING_LOCAL_MS = 50_000;
const NO_ANSWER_MS = 55_000;

const meId = () => state.me?.id || "";
const layer = () => document.getElementById("call-layer");
const appEl = () => document.getElementById("app");

let S = null;   // the call this tab is in (or placing)
let R = null;   // an incoming call that is ringing here
let unsubs = [];
let lastFocus = null;

export const inCall = () => !!S;

// ================================================================== media helpers
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const videoConstraints = (deviceId) => (deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } });

async function getLocalMedia(video, sess) {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) { toast("This browser can't use the microphone here (it needs https)."); return new MediaStream(); }
  try { return await md.getUserMedia({ audio: { ...AUDIO, ...(sess?.micDevice ? { deviceId: { exact: sess.micDevice } } : {}) }, video: video ? videoConstraints(sess?.camDevice) : false }); }
  catch {
    if (video) { try { const s = await md.getUserMedia({ audio: AUDIO }); toast("Camera unavailable — joining with audio"); return s; } catch {} }
    toast("Microphone blocked — allow it in your browser so others can hear you");
    return new MediaStream();
  }
}
function attachLocal(sess, stream) {
  sess.audioTrack = stream.getAudioTracks()[0] || null;
  sess.camTrack = stream.getVideoTracks()[0] || null;
  sess.camOn = !!sess.camTrack;
  for (const t of stream.getTracks()) sess.local.addTrack(t);
  if (sess.audioTrack) watchLevel(sess, "self", sess.audioTrack);
  renderSelf(); renderControls();
}
function liveTracks(stream, kind) { return stream.getTracks().filter((t) => t.kind === kind && t.readyState === "live"); }

/** Puts `track` (or null) on every peer's sender of that kind — adding a transceiver (→ renegotiation) if there's none. */
async function replaceKind(kind, track) {
  if (!S) return;
  for (const p of S.peers.values()) {
    if (p.pc.signalingState === "closed") continue;
    const tr = p.pc.getTransceivers().find((t) => !t.stopped && t.receiver.track?.kind === kind);
    if (tr) {
      try { await tr.sender.replaceTrack(track); } catch {}
      try { if (track && tr.sender.setStreams) tr.sender.setStreams(S.local); } catch {}
      if (track && (tr.direction === "recvonly" || tr.direction === "inactive")) tr.direction = "sendrecv";
    } else if (track) p.pc.addTrack(track, S.local);
  }
}

// ================================================================== signaling
function sendSignal(to, data) {
  if (!S?.id) return;
  return post(`/v1/calls/${enc(S.id)}/signal`, to ? { to, data } : { data }).catch(() => {});
}
function sendMedia(to) {
  if (!S) return;
  sendSignal(to, { type: "media", audio: !!S.audioTrack && !S.muted, video: !!(S.sharing || (S.camOn && S.camTrack)) });
}

function createPeer(uid) {
  const sess = S;
  const pc = new RTCPeerConnection({ iceServers: sess.iceServers?.length ? sess.iceServers : DEFAULT_ICE });
  const p = {
    uid, pc, polite: meId() > uid, makingOffer: false, ignoreOffer: false, negotiated: false, pendingIce: [],
    stream: new MediaStream(), media: {}, lastRestart: 0, discTimer: null, connected: false, asked: false,
    chain: Promise.resolve(), relay: {}, prevLost: 0, prevRecv: 0, q: null,
  };
  sess.peers.set(uid, p);
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && candidate.candidate) sendSignal(uid, { type: "ice", candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
  };
  pc.onnegotiationneeded = () => {
    // the polite peer (higher uid) waits for the first offer — the lower uid always opens the pair (Android convention)
    if (p.polite && !p.negotiated) { p.needsReneg = true; return; }
    makeOffer(p);
  };
  pc.ontrack = (e) => {
    const t = e.track;
    for (const x of p.stream.getTracks()) if (x.kind === t.kind && x.readyState === "ended") p.stream.removeTrack(x);
    if (!p.stream.getTracks().includes(t)) p.stream.addTrack(t);
    t.addEventListener("mute", () => updateTile(p));
    t.addEventListener("unmute", () => updateTile(p));
    t.addEventListener("ended", () => updateTile(p));
    if (t.kind === "audio") watchLevel(sess, uid, t);
    updateTile(p);
  };
  pc.oniceconnectionstatechange = () => onIceState(p);
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") restartIce(p); updateTile(p); renderStatus(); };
  // local media: lower uid always has something to offer, so the first offer always fires
  if (sess.audioTrack) pc.addTrack(sess.audioTrack, sess.local);
  else if (!p.polite) pc.addTransceiver("audio", { direction: "recvonly" });
  const vt = sess.screenTrack || (sess.camOn ? sess.camTrack : null);
  if (vt) pc.addTrack(vt, sess.local);
  else if (sess.kind === "video" && !p.polite) pc.addTransceiver("video", { direction: "sendrecv" });
  addTile(p);
  renderStatus(); renderControls();
  return p;
}
function closePeer(uid) {
  const p = S?.peers.get(uid); if (!p) return;
  clearTimeout(p.discTimer);
  try { p.pc.close(); } catch {}
  S.peers.delete(uid);
  S.levels?.delete(uid);
  p.tile?.remove();
  layoutGrid(); renderStatus(); renderControls();
}

async function makeOffer(p, iceRestart = false) {
  if (!S || p.pc.signalingState === "closed") return;
  try {
    p.makingOffer = true;
    const offer = await p.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (p.pc.signalingState !== "stable") return;
    await p.pc.setLocalDescription(offer);
    sendSignal(p.uid, { type: "offer", sdp: p.pc.localDescription.sdp });
  } catch (e) { console.warn("offer failed", e); }
  finally { p.makingOffer = false; }
}
async function onDescription(p, data) {
  const desc = { type: data.type, sdp: String(data.sdp || "") };
  const collision = desc.type === "offer" && (p.makingOffer || p.pc.signalingState !== "stable");
  p.ignoreOffer = !p.polite && collision;
  if (p.ignoreOffer) return;
  if (desc.type === "answer" && p.pc.signalingState !== "have-local-offer") return;   // stale answer
  await p.pc.setRemoteDescription(desc);                                               // implicit rollback when polite
  for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  if (desc.type === "offer") {
    await p.pc.setLocalDescription();
    sendSignal(p.uid, { type: "answer", sdp: p.pc.localDescription.sdp });
  }
  const first = !p.negotiated;
  p.negotiated = true;
  // polite side added something the first offer didn't cover (e.g. its camera in a voice call): offer it now
  if (first && p.polite && p.pc.getTransceivers().some((t) => !t.stopped && t.mid == null)) makeOffer(p);
}
async function onIce(p, data) {
  // Android batches candidates: the first in the top-level fields, plus `candidates: [...]` (may repeat the first)
  const list = [];
  const seen = new Set();
  for (const x of [data, ...(Array.isArray(data.candidates) ? data.candidates : [])]) {
    if (!x || !x.candidate || seen.has(x.candidate)) continue;
    seen.add(x.candidate);
    list.push(x);
  }
  for (const x of list) {
    let c;
    try { c = new RTCIceCandidate({ candidate: x.candidate, sdpMid: x.sdpMid ?? null, sdpMLineIndex: x.sdpMLineIndex ?? null }); } catch { continue; }
    if (!p.pc.remoteDescription) { p.pendingIce.push(c); continue; }
    try { await p.pc.addIceCandidate(c); } catch (e) { if (!p.ignoreOffer) console.warn("ice", e); }
  }
}
function onIceState(p) {
  const s = p.pc.iceConnectionState;
  if (s === "connected" || s === "completed") {
    clearTimeout(p.discTimer);
    if (!p.connected) { p.connected = true; sendMedia(p.uid); peerConnected(); }
  } else if (s === "failed") restartIce(p);
  else if (s === "disconnected") {
    clearTimeout(p.discTimer);
    p.discTimer = setTimeout(() => { if (p.pc.iceConnectionState === "disconnected") restartIce(p); }, 4000);
  }
  updateTile(p); renderStatus();
}
function restartIce(p, force = false) {
  if (!S || p.pc.signalingState === "closed") return;
  if (!force && Date.now() - p.lastRestart < 5000) return;
  p.lastRestart = Date.now();
  if (!p.polite) makeOffer(p, true);
  else sendSignal(p.uid, { type: "restart" });
}
function peerConnected() {
  if (!S) return;
  stopRingtone();
  if (S.phase !== "active") { S.phase = "active"; S.startedAt = S.startedAt || Date.now(); }
  renderStatus();
}

function handleSignal(from, data) {
  if (!S || !data || typeof data !== "object" || !from || from === meId()) return;
  let p = S.peers.get(from);
  if (!p) {
    if (!["offer", "ice", "restart"].includes(data.type)) { if (data.type === "media") (S.earlyMedia ||= {})[from] = data; return; }
    p = createPeer(from);
    if (S.earlyMedia?.[from]) p.media = { audio: S.earlyMedia[from].audio, video: S.earlyMedia[from].video };
  }
  p.chain = p.chain.then(async () => {
    switch (data.type) {
      case "offer": case "answer": await onDescription(p, data); break;
      case "ice": await onIce(p, data); break;
      case "media": p.media = { audio: data.audio !== false, video: !!data.video }; updateTile(p); break;
      case "restart": if (!p.polite) await makeOffer(p, true); break;
      case "video-request": videoRequest(p); break;
      case "video-reply": if (!data.ok) userName_(from).then((n) => toast(`${n} kept their camera off`)); break;
    }
  }).catch((e) => console.warn("signal", data.type, e));
}
const userName_ = async (uid) => userName(await user(uid));

// ================================================================== line events
function onRing(ev) {
  const c = ev.call; if (!c?.id) return;
  if (S) { if (S.id !== c.id) post(`/v1/calls/${enc(c.id)}/hangup`, { reason: "busy" }).catch(() => {}); return; }
  if (R) { if (R.call.id !== c.id) post(`/v1/calls/${enc(c.id)}/hangup`, { reason: "busy" }).catch(() => {}); return; }
  if (ev.from) seedUser(ev.from);
  showRinging(c, ev.from || { id: c.caller });
}
function onSignal(ev) {
  if (S && S.id === ev.callId) { if (!S.ready) S.queue.push({ from: ev.from, data: ev.data }); else handleSignal(ev.from, ev.data); }
  else if (R && R.call.id === ev.callId) R.queue.push({ from: ev.from, data: ev.data });
}
function onJoined(ev) {
  if (!S || S.id !== ev.callId) return;
  if (ev.call) S.call = ev.call;
  const uid = ev.uid;
  if (!uid || uid === meId()) return;
  S.anyJoined = true;
  clearTimeout(S.noAnswerTimer);
  stopRingtone();
  if (S.phase === "calling") S.phase = "connecting";
  if (S.ready) { if (S.peers.has(uid)) closePeer(uid); createPeer(uid); }
  renderTitle(); renderStatus();
}
function onLeft(ev) {
  if (!S || S.id !== ev.callId) return;
  if (ev.call) S.call = ev.call;
  if (ev.uid && ev.uid !== meId()) { closePeer(ev.uid); userName_(ev.uid).then((n) => toast(`${n} left the call`)); }
  renderTitle();
}
function onUpdated(ev) { if (S && S.id === ev.callId && ev.call) { S.call = ev.call; renderTitle(); renderControls(); } }
function onDeclined(ev) { if (S && S.id === ev.callId && ev.uid) userName_(ev.uid).then((n) => toast(`${n} declined`)); }
const END_TEXT = { busy: "Busy – call back later", declined: "Call declined", missed: "No answer", failed: "Call failed", ended: "Call ended" };
function onEnded(ev) {
  if (R && R.call.id === ev.callId) dismissRinging(ev.reason === "missed" || ev.reason === "ended" ? "missed" : null);
  if (S && S.id === ev.callId) { const msg = S.anyJoined || !S.outgoing ? END_TEXT.ended : END_TEXT[ev.reason] || END_TEXT.ended; teardown(); toast(msg); }
  missedBadgeRefresh();
}
function onElsewhere(ev) { if (R && R.call.id === ev.callId) dismissRinging(null); }
function onOnline() { if (S) for (const p of S.peers.values()) restartIce(p, true); }
function onPageHide() {
  if (!S?.id) return;
  try { fetch(`${API}/v1/calls/${enc(S.id)}/hangup`, { method: "POST", keepalive: true, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ reason: "ended" }) }); } catch {}
}

async function checkActive() {
  if (!state.me) return;
  let list = [];
  try { list = items(await get("/v1/calls/active")); } catch { return; }
  for (const c of list) {
    if (S?.id === c.id || R?.call.id === c.id || c.state === "ended") continue;
    const joined = (c.joined || []).includes(meId());
    if (c.state === "ringing" && c.caller === meId()) { post(`/v1/calls/${enc(c.id)}/hangup`, { reason: "cancelled" }).catch(() => {}); continue; }
    if (c.state === "ringing" && !joined && !S && !R) {
      const u = await user(c.caller);
      showRinging(c, { id: c.caller, username: u?.username, name: userName(u), avatar: u?.avatar, badges: u?.badges });
    } else if (c.state === "active" && joined && !S && !R) showRejoin(c);
  }
}

// ================================================================== start / accept / hang up
function newSession(call, { outgoing, kind, video, title }) {
  return {
    id: call?.id || null, call: call || null, kind, outgoing, title: title || "", iceServers: [], peers: new Map(), local: new MediaStream(),
    audioTrack: null, camTrack: null, screenTrack: null, muted: false, camOn: !!video, sharing: false, ready: false, queue: [],
    phase: outgoing ? "calling" : "connecting", startedAt: 0, anyJoined: false, timers: [], el: {}, minimized: false, levels: new Map(),
  };
}

export async function startCall({ to, chatId, video = false } = {}) {
  if (!state.me) return;
  if (S) { toast("You're already in a call"); return; }
  if (R) { toast("Answer or decline the incoming call first"); return; }
  if (!to && !chatId) return;
  const kind = video ? "video" : "audio";
  const chat = chatId ? state.chats.get(chatId) : null;
  const sess = S = newSession(null, { outgoing: true, kind, video, title: chat?.name || (to ? "" : "Group call") });
  if (to) user(to).then((u) => { if (S === sess && !sess.title) { sess.title = userName(u); sess.avatarUser = u; renderTitle(); } });
  showCallUI();
  emit("call", { active: true });
  const stream = await getLocalMedia(video, sess);
  if (S !== sess) { stream.getTracks().forEach((t) => t.stop()); return; }
  attachLocal(sess, stream);
  let r;
  try { r = await post("/v1/calls", to ? { to, kind } : { chatId, kind }); }
  catch (e) { if (S === sess) teardown(); toast(errText(e)); return; }
  if (S !== sess) { if (r?.call?.id && !r.busy) post(`/v1/calls/${enc(r.call.id)}/hangup`, { reason: "cancelled" }).catch(() => {}); return; }
  if (r.busy) { teardown(); toast("Busy – call back later"); return; }
  sess.id = r.call.id; sess.call = r.call; sess.iceServers = r.iceServers || []; sess.ready = true; sess.reached = r.reached || [];
  startDialtone();
  sess.noAnswerTimer = setTimeout(() => { if (S === sess && !sess.anyJoined) hangup("cancelled", "No answer"); }, NO_ANSWER_MS);
  renderTitle(); renderStatus(); renderControls();
}

/** Joins an existing call (accepting a ring, rejoining, or via a call link). */
async function acceptCall(call, video, queue = []) {
  const sess = S = newSession(call, { outgoing: false, kind: call.kind === "video" ? "video" : "audio", video });
  sess.queue = queue;
  setTitleFromCall(sess);
  showCallUI();
  emit("call", { active: true });
  const stream = await getLocalMedia(video, sess);
  if (S !== sess) { stream.getTracks().forEach((t) => t.stop()); return; }
  attachLocal(sess, stream);
  let r;
  try { r = await post(`/v1/calls/${enc(call.id)}/answer`); }
  catch (e) { if (S === sess) teardown(); toast(errText(e)); return; }
  if (S !== sess) return;
  sess.call = r.call || call; sess.iceServers = r.iceServers || []; sess.ready = true;
  sess.anyJoined = true;
  for (const uid of sess.call.joined || []) if (uid !== meId() && !sess.peers.has(uid)) createPeer(uid);
  for (const s of sess.queue.splice(0)) handleSignal(s.from, s.data);
  renderTitle(); renderStatus(); renderControls();
}

async function setTitleFromCall(sess) {
  const c = sess.call; if (!c) return;
  const others = (c.members || []).filter((u) => u !== meId());
  if (c.group || others.length > 1) {
    const chat = state.chats.get(c.chatId);
    sess.title = chat?.name || "Group call";
    if (!chat?.name) { const names = await Promise.all(others.slice(0, 3).map(userName_)); if (S === sess) sess.title = names.join(", ") + (others.length > 3 ? ` +${others.length - 3}` : ""); }
  } else {
    const u = await user(others[0] || c.caller);
    sess.title = userName(u); sess.avatarUser = u;
  }
  if (S === sess) renderTitle();
}

export async function joinByCode(code) {
  if (!state.me) return;
  if (S) { toast("You're already in a call"); return; }
  if (R) dismissRinging(null);
  let r;
  try { r = await post(`/v1/calls/join/${enc(String(code || ""))}`); } catch (e) { toast(errText(e)); return; }
  if (!r?.call) return;
  const ok = await confirmBox("Join call?", `${r.call.kind === "video" ? "Video" : "Voice"} call · ${(r.call.joined || []).length} in the call. ${PRIVACY_LINE}.`, "Join");
  if (!ok) { post(`/v1/calls/${enc(r.call.id)}/hangup`, { reason: "declined" }).catch(() => {}); return; }
  acceptCall(r.call, r.call.kind === "video");
}

async function hangup(reason = "ended", msg) {
  const sess = S; if (!sess) return;
  if (!sess.id) { teardown(); return; }
  if (reason === "ended" && sess.outgoing && !sess.anyJoined) reason = "cancelled";
  const relayBytes = await relayBytesOf(sess).catch(() => 0);
  teardown();
  try { await post(`/v1/calls/${enc(sess.id)}/hangup`, { reason, relayBytes }); } catch {}
  if (msg) toast(msg);
  missedBadgeRefresh();
}

function teardown() {
  const sess = S; if (!sess) return;
  S = null;
  stopRingtone();
  clearTimeout(sess.noAnswerTimer);
  sess.timers.forEach(clearInterval);
  for (const p of sess.peers.values()) { clearTimeout(p.discTimer); try { p.pc.close(); } catch {} }
  sess.peers.clear();
  for (const t of [...sess.local.getTracks(), sess.camTrack, sess.screenTrack]) try { t?.stop(); } catch {}
  try { sess.actx?.close(); } catch {}
  try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch {}
  closeLayer();
  emit("call", { active: false });
}

// ================================================================== stats: quality + relay bytes (feeds the server's TURN cap)
async function peerStats(p) {
  const st = await p.pc.getStats();
  const byId = new Map(); st.forEach((r) => byId.set(r.id, r));
  let pair = null;
  st.forEach((r) => { if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId) || pair; });
  if (!pair) st.forEach((r) => { if (!pair && r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) pair = r; });
  let lost = 0, recv = 0;
  st.forEach((r) => { if (r.type === "inbound-rtp") { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; } });
  const lc = pair && byId.get(pair.localCandidateId), rc = pair && byId.get(pair.remoteCandidateId);
  const relay = lc?.candidateType === "relay" || rc?.candidateType === "relay";
  if (pair && relay) p.relay[pair.id] = (pair.bytesSent || 0) + (pair.bytesReceived || 0);
  return { rtt: pair?.currentRoundTripTime, relay, lost, recv };
}
async function relayBytesOf(sess) {
  let total = 0;
  for (const p of sess.peers.values()) {
    if (p.pc.signalingState !== "closed") await peerStats(p).catch(() => {});
    total += Object.values(p.relay).reduce((a, b) => a + b, 0);
  }
  return Math.round(total);
}
async function qualityTick() {
  if (!S) return;
  let worst = 4, relayed = false, any = false;
  for (const p of S.peers.values()) {
    if (!p.connected || p.pc.signalingState === "closed") continue;
    try {
      const s = await peerStats(p);
      any = true; relayed ||= s.relay;
      const dl = s.lost - p.prevLost, dr = s.recv - p.prevRecv;
      p.prevLost = s.lost; p.prevRecv = s.recv;
      const loss = dl + dr > 0 ? (100 * Math.max(0, dl)) / (dl + dr) : 0;
      const rtt = s.rtt ?? 0;
      const bars = rtt < 0.15 && loss < 2 ? 4 : rtt < 0.3 && loss < 5 ? 3 : rtt < 0.6 && loss < 12 ? 2 : 1;
      worst = Math.min(worst, bars);
    } catch {}
  }
  if (!S?.el.quality) return;
  S.el.quality.hidden = !any;
  S.el.quality.dataset.bars = String(worst);
  const label = ["", "Poor connection", "Weak connection", "Good connection", "Excellent connection"][worst] + (relayed ? " · relayed" : "");
  S.el.quality.setAttribute("aria-label", label); S.el.quality.title = label;
  S.el.relay.hidden = !relayed;
}

// speaking highlight (WebAudio levels; nothing is stored)
function watchLevel(sess, key, track) {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    sess.actx ||= new C();
    if (sess.actx.state === "suspended") sess.actx.resume().catch(() => {});
    const src = sess.actx.createMediaStreamSource(new MediaStream([track]));
    const an = sess.actx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    sess.levels.set(key, { an, buf: new Uint8Array(an.fftSize) });
  } catch {}
}
function levelTick() {
  if (!S) return;
  for (const [key, l] of S.levels) {
    l.an.getByteTimeDomainData(l.buf);
    let sum = 0; for (const v of l.buf) { const x = (v - 128) / 128; sum += x * x; }
    const speaking = Math.sqrt(sum / l.buf.length) > 0.035;
    const el = key === "self" ? S.el.selfWrap : S.peers.get(key)?.tile;
    if (key === "self" && S.muted) { el?.classList.remove("speaking"); continue; }
    el?.classList.toggle("speaking", speaking);
  }
}

// ================================================================== in-call controls
function toggleMute() {
  if (!S) return;
  if (!S.audioTrack) { toast("Your microphone isn't available"); return; }
  S.muted = !S.muted;
  S.audioTrack.enabled = !S.muted;
  sendMedia(); renderControls();
}
async function setCamera(on) {
  if (!S) return;
  const sess = S;
  if (on) {
    let t;
    try { const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(sess.camDevice) }); t = s.getVideoTracks()[0]; }
    catch { toast("Can't use the camera — check the browser's permission"); return; }
    if (S !== sess) { t.stop(); return; }
    sess.camTrack?.stop();
    sess.camTrack = t; sess.camOn = true;
    if (!sess.sharing) await replaceKind("video", t);
    // in a voice call, ask the others whether they'd like to turn their camera on too (they decide)
    if (sess.kind === "audio") for (const p of sess.peers.values()) if (!p.asked && p.media.video !== true) { p.asked = true; sendSignal(p.uid, { type: "video-request" }); }
  } else {
    sess.camOn = false;
    if (!sess.sharing) await replaceKind("video", null);
    sess.camTrack?.stop(); sess.camTrack = null;
  }
  renderSelf(); renderControls(); sendMedia();
}
async function toggleShare() {
  if (!S) return;
  if (S.sharing) return stopShare();
  if (S.peers.size > 1 || S.call?.group) { toast("Screen sharing works in 1:1 calls"); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { toast("This browser can't share the screen"); return; }
  const sess = S;
  let s;
  try { s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch { return; }
  const t = s.getVideoTracks()[0];
  if (!t || S !== sess) { t?.stop(); return; }
  try { t.contentHint = "detail"; } catch {}
  sess.screenTrack = t; sess.sharing = true;
  t.addEventListener("ended", () => { if (S === sess && sess.screenTrack === t) stopShare(); });
  await replaceKind("video", t);
  sendMedia(); renderSelf(); renderControls();
}
async function stopShare() {
  if (!S) return;
  S.screenTrack?.stop(); S.screenTrack = null; S.sharing = false;
  await replaceKind("video", S.camOn ? S.camTrack : null);
  sendMedia(); renderSelf(); renderControls();
}
async function switchMic(id) {
  const sess = S; if (!sess) return;
  let t;
  try { t = (await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: id } } })).getAudioTracks()[0]; } catch { toast("Can't use that microphone"); return; }
  if (S !== sess) { t.stop(); return; }
  const old = sess.audioTrack;
  t.enabled = !sess.muted;
  sess.audioTrack = t; sess.micDevice = id;
  if (old) { sess.local.removeTrack(old); old.stop(); }
  sess.local.addTrack(t);
  await replaceKind("audio", t);
  watchLevel(sess, "self", t);
  sendMedia(); renderControls();
}
async function switchCam(id) {
  const sess = S; if (!sess) return;
  sess.camDevice = id;
  if (!sess.camOn) return setCamera(true);
  let t;
  try { t = (await navigator.mediaDevices.getUserMedia({ video: videoConstraints(id) })).getVideoTracks()[0]; } catch { toast("Can't use that camera"); return; }
  if (S !== sess) { t.stop(); return; }
  const old = sess.camTrack;
  sess.camTrack = t;
  if (!sess.sharing) await replaceKind("video", t);
  old?.stop();
  renderSelf();
}
function setSink(id) {
  if (!S) return;
  S.sinkId = id;
  for (const p of S.peers.values()) p.tile?.audio.setSinkId?.(id).catch(() => {});
}
async function deviceMenu(anchor) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const head = (t) => ({ custom: h("div", { class: "menu-h" }, t) });
  const pick = (kind, label, fn, cur) => devs.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ label: (d.label || `${label} ${i + 1}`) + (cur && cur === d.deviceId ? " ✓" : ""), icon: kind === "videoinput" ? "camera" : kind === "audioinput" ? "mic" : "mute", onclick: () => fn(d.deviceId) }));
  const curMic = S?.audioTrack?.getSettings?.().deviceId, curCam = S?.camTrack?.getSettings?.().deviceId;
  const its = [head("Microphone"), ...pick("audioinput", "Microphone", switchMic, curMic), head("Camera"), ...pick("videoinput", "Camera", switchCam, curCam)];
  if ("setSinkId" in HTMLMediaElement.prototype) its.push(head("Speaker"), ...pick("audiooutput", "Speaker", setSink, S?.sinkId));
  menu(anchor, its, { label: "Devices" });
}
async function togglePip() {
  try {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
    const tile = [...(S?.peers.values() || [])].map((p) => p.tile).find((t) => t?.classList.contains("has-video"));
    if (!tile) { toast("No video to pop out yet"); return; }
    await tile.video.requestPictureInPicture();
  } catch { toast("Picture-in-picture isn't available here"); }
}
async function copyLink() {
  if (!S?.id) return;
  try {
    const { code } = await post(`/v1/calls/${enc(S.id)}/link`);
    const url = `${location.origin}${location.pathname}#/call/${code}`;
    try { await navigator.clipboard.writeText(url); toast("Call link copied — people signed in to Sonar can join"); }
    catch { modalText("Call link", url); }
  } catch (e) { toast(errText(e)); }
}
function modalText(title, text) {
  const inp = h("input", { value: text, readonly: true, "aria-label": title });
  modal(h("div", { class: "stack" }, h("h2", {}, title), inp, h("p", { class: "meta" }, "Anyone signed in to Sonar with this link can ask to join.")), { label: title });
  setTimeout(() => inp.select(), 50);
}
async function inviteDialog() {
  if (!S?.id) return;
  if ((S.call?.members || []).length >= MAX_MEMBERS) { toast(`Calls can have up to ${MAX_MEMBERS} people`); return; }
  const list = h("div", { class: "picklist", role: "list" });
  const q = h("input", { type: "search", placeholder: "Search people", "aria-label": "Search people", autofocus: true });
  const render = (users) => {
    const members = S?.call?.members || [];
    const us = (users || []).filter((u) => u?.id && u.id !== meId() && !members.includes(u.id));
    list.replaceChildren(...(us.length ? us.slice(0, 30).map((u) => h("button", {
      class: "rowbtn", type: "button", role: "listitem",
      onclick: async () => {
        try { const r = await post(`/v1/calls/${enc(S.id)}/invite`, { uid: u.id }); if (r?.call && S) S.call = r.call; toast(`Calling ${userName(u)}…`); close(); renderTitle(); }
        catch (e) { toast(errText(e)); }
      },
    }, avatar(u.avatar, userName(u), "sm"), h("div", { class: "body" }, h("div", { class: "name" }, userName(u), ...badges(u.badges, { dev: false })), h("div", { class: "meta" }, "@" + (u.username || ""))))) : [h("div", { class: "meta", style: "padding:10px" }, "No one to add here")]));
  };
  const close = modal(h("div", { class: "stack" }, h("h2", {}, "Add someone"), q, list, h("p", { class: "meta small" }, `Up to ${MAX_MEMBERS} people per call.`)), { label: "Add someone to the call" });
  get(`/v1/users/${enc(meId())}/following`).then((j) => { if (!q.value) render(items(j)); }).catch(() => render([]));
  q.addEventListener("input", debounce(async () => {
    const v = q.value.trim();
    if (!v) { get(`/v1/users/${enc(meId())}/following`).then((j) => render(items(j))).catch(() => {}); return; }
    try { const r = await get(`/v1/search?q=${enc(v)}`); render(r.users || []); } catch {}
  }, 300));
}
function videoRequest(p) {
  if (!S) return;
  if (S.camOn) { sendSignal(p.uid, { type: "video-reply", ok: true }); return; }
  userName_(p.uid).then((n) => {
    if (!S) return;
    const box = h("div", { class: "call-notice", role: "alertdialog", "aria-label": "Camera request" },
      h("span", {}, `${n} wants you to turn on your camera`),
      h("button", { class: "small", onclick: () => { box.remove(); sendSignal(p.uid, { type: "video-reply", ok: true }); setCamera(true); } }, "Turn on"),
      h("button", { class: "small tonal", onclick: () => { box.remove(); sendSignal(p.uid, { type: "video-reply", ok: false }); } }, "Not now"));
    S.el.notices?.append(box);
    box.querySelector("button")?.focus();
  });
}

// ================================================================== UI
function openLayer(mini = false) {
  const L = layer();
  L.hidden = false;
  L.classList.toggle("mini", mini);
  const app = appEl();
  if (app) app.inert = !mini;
}
function closeLayer() {
  const L = layer();
  L.replaceChildren(); L.hidden = true; L.className = "";
  const app = appEl(); if (app) app.inert = false;
  lastFocus?.focus?.(); lastFocus = null;
}
function onLayerKey(e) {
  if (e.key === "Escape" && S && !S.minimized && !document.querySelector(".menu") && document.getElementById("modal")?.hidden !== false) {
    e.preventDefault(); e.stopPropagation(); minimize(true);
  } else if (e.key === "Tab" && !layer().classList.contains("mini")) {
    const f = [...layer().querySelectorAll("button:not([disabled]):not([hidden]), [href], input")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}

function showCallUI() {
  const sess = S;
  lastFocus = lastFocus || document.activeElement;
  const el = sess.el;
  el.title = h("h2", { class: "call-title" }, sess.title || "…");
  el.status = h("div", { class: "call-status", "aria-live": "polite" }, sess.outgoing ? "Calling…" : "Connecting…");
  el.quality = h("span", { class: "q-bars", role: "img", "aria-label": "Connection quality", hidden: true, "data-bars": "4" }, h("i"), h("i"), h("i"), h("i"));
  el.relay = h("span", { class: "call-relay", hidden: true }, "Relayed");
  el.grid = h("div", { class: "call-grid", "data-n": "0" });
  el.waiting = h("div", { class: "call-waiting" }, h("div", { class: "call-ping" }, h("span"), h("span"), h("span"), el.bigAvatar = h("div", { class: "call-av" }, avatar(null, sess.title, "big"))));
  el.grid.append(el.waiting);
  el.selfVideo = h("video", { autoplay: true, playsinline: true, "aria-label": "Your camera" });
  el.selfVideo.muted = true;
  el.selfWrap = h("div", { class: "call-self", hidden: true }, el.selfVideo);
  el.notices = h("div", { class: "call-notices" });
  el.controls = h("div", { class: "call-controls", role: "toolbar", "aria-label": "Call controls" });
  el.ui = h("div", { class: "call-ui", role: "dialog", "aria-modal": "true", "aria-label": "Call" },
    h("header", { class: "call-top" },
      h("div", { class: "grow" }, el.title, h("div", { class: "row call-sub" }, el.status, el.quality, el.relay)),
      iconBtn("pip", "Minimise call (Esc)", () => minimize(true), "call-min")),
    el.grid, el.selfWrap, el.notices,
    h("div", { class: "call-info" }, icon("lock"), PRIVACY_LINE, " · Sonar never records calls"),
    el.controls);
  el.miniTime = h("span", { class: "mini-time" }, "");
  el.mini = h("div", { class: "call-mini", hidden: true },
    h("button", { class: "mini-open", type: "button", onclick: () => minimize(false), "aria-label": "Return to call" }, icon("phone"), h("span", { class: "mini-name" }, sess.title || "Call"), el.miniTime),
    iconBtn("hangup", "Hang up", () => hangup(), "hang"));
  const L = layer();
  L.replaceChildren(el.ui, el.mini);
  L.onkeydown = onLayerKey;
  openLayer(false);
  renderControls(); renderTitle();
  sess.timers.push(setInterval(renderClock, 1000), setInterval(qualityTick, 2000), setInterval(levelTick, 200));
  setTimeout(() => el.controls.querySelector(".hang")?.focus(), 30);
}
function minimize(on) {
  if (!S) return;
  S.minimized = on;
  S.el.ui.hidden = on; S.el.mini.hidden = !on;
  openLayer(on);
  if (on) { lastFocus?.focus?.(); }
  else { lastFocus = document.activeElement; setTimeout(() => S?.el.controls.querySelector(".hang")?.focus(), 30); }
  renderClock();
}
function renderTitle() {
  if (!S?.el.title) return;
  const t = S.title || "Call";
  S.el.title.textContent = t;
  S.el.ui.setAttribute("aria-label", `Call with ${t}`);
  S.el.mini.querySelector(".mini-name").textContent = t;
  if (S.avatarUser && S.el.bigAvatar && !S.el.bigAvatar.dataset.set) {
    S.el.bigAvatar.dataset.set = "1";
    S.el.bigAvatar.replaceChildren(avatar(S.avatarUser.avatar, userName(S.avatarUser), "big"));
  }
}
function renderStatus() {
  if (!S?.el.status) return;
  let txt;
  const peers = [...S.peers.values()];
  if (S.phase === "calling") txt = S.reached?.length ? "Ringing…" : "Calling…";
  else if (S.phase !== "active") txt = "Connecting…";
  else if (peers.some((p) => ["disconnected", "failed"].includes(p.pc.iceConnectionState))) txt = "Reconnecting…";
  else txt = null;
  S.el.status.dataset.txt = txt || "";
  if (txt) S.el.status.textContent = txt;
  S.el.waiting.hidden = peers.length > 0;
  renderClock();
}
function renderClock() {
  if (!S?.el.status) return;
  const t = S.startedAt ? dur((Date.now() - S.startedAt) / 1000) : "";
  if (!S.el.status.dataset.txt && t) S.el.status.textContent = t + (S.peers.size > 1 ? ` · ${S.peers.size + 1} people` : "");
  S.el.miniTime.textContent = S.el.status.dataset.txt || t;
}
function renderSelf() {
  if (!S?.el.selfVideo) return;
  const t = S.sharing ? S.screenTrack : S.camOn ? S.camTrack : null;
  S.el.selfWrap.hidden = !t;
  S.el.selfWrap.classList.toggle("mirror", !S.sharing);
  const cur = S.el.selfVideo.srcObject?.getVideoTracks?.()[0];
  if (t && cur !== t) { S.el.selfVideo.srcObject = new MediaStream([t]); S.el.selfVideo.play().catch(() => {}); }
  if (!t) S.el.selfVideo.srcObject = null;
}
function toggleBtn(ic, icOff, label, on, onclick, cls = "") {
  const b = h("button", { class: "call-btn " + cls + (on ? " on" : ""), type: "button", "aria-label": label, title: label, "aria-pressed": on ? "true" : "false", onclick }, icon(on ? icOff : ic));
  return b;
}
function renderControls() {
  if (!S?.el.controls) return;
  const one = S.peers.size <= 1 && !S.call?.group;
  const btns = [
    toggleBtn("mic", "micoff", S.muted ? "Unmute" : "Mute", S.muted, toggleMute),
    toggleBtn("camoff", "video", S.camOn ? "Turn camera off" : "Turn camera on", S.camOn, () => setCamera(!S.camOn)),
    h("button", { class: "call-btn", type: "button", "aria-label": "Microphone, camera and speaker", title: "Devices", onclick: (e) => deviceMenu(e.currentTarget) }, icon("settings")),
  ];
  if (one && navigator.mediaDevices?.getDisplayMedia) btns.push(toggleBtn("screen", "screen", S.sharing ? "Stop sharing your screen" : "Share your screen", S.sharing, toggleShare));
  if (document.pictureInPictureEnabled) btns.push(h("button", { class: "call-btn", type: "button", "aria-label": "Picture-in-picture", title: "Picture-in-picture", onclick: togglePip }, icon("pip")));
  btns.push(
    h("button", { class: "call-btn", type: "button", "aria-label": "Add someone", title: "Add someone", disabled: !S.id, onclick: inviteDialog }, icon("person_add")),
    h("button", { class: "call-btn", type: "button", "aria-label": "Copy call link", title: "Copy call link", disabled: !S.id, onclick: copyLink }, icon("link")),
    h("button", { class: "call-btn hang", type: "button", "aria-label": "Hang up", title: "Hang up", onclick: () => hangup() }, icon("hangup")));
  const had = S.el.controls.contains(document.activeElement) ? document.activeElement.getAttribute("title") : null;
  S.el.controls.replaceChildren(...btns);
  if (had) [...S.el.controls.children].find((b) => b.getAttribute("title") === had || b.getAttribute("aria-label") === had)?.focus();
}
function layoutGrid() { if (S?.el.grid) S.el.grid.dataset.n = String(Math.min(S.peers.size, 8)); }

function addTile(p) {
  const v = h("video", { autoplay: true, playsinline: true });
  v.muted = true;
  const a = h("audio", { autoplay: true });
  if (S.sinkId) a.setSinkId?.(S.sinkId).catch(() => {});
  const nm = h("span", { class: "nm" }, "…");
  const av = h("div", { class: "ph-av" }, avatar(null, "?", "big"));
  const big = h("div", { class: "ph-name" }, "");
  const micOff = h("span", { class: "tile-mic", hidden: true, "aria-label": "Muted", title: "Muted" }, icon("micoff"));
  const st = h("span", { class: "tile-state" }, "Connecting…");
  const tile = h("div", { class: "tile", "data-uid": p.uid }, v, h("div", { class: "ph" }, av, big, st), h("div", { class: "tag" }, micOff, nm), a);
  tile.video = v; tile.audio = a; tile.st = st; tile.micOff = micOff;
  p.tile = tile;
  S.el.grid.append(tile);
  layoutGrid();
  user(p.uid).then((u) => { nm.textContent = userName(u); big.textContent = userName(u); av.replaceChildren(avatar(u?.avatar, userName(u), "big")); tile.setAttribute("aria-label", userName(u)); });
  updateTile(p);
}
function updateTile(p) {
  const t = p.tile; if (!t) return;
  const vt = liveTracks(p.stream, "video").at(-1);
  const show = !!vt && !vt.muted && p.media.video !== false;
  t.classList.toggle("has-video", show);
  if (vt && t.video.srcObject?.getVideoTracks()[0] !== vt) { t.video.srcObject = new MediaStream([vt]); t.video.play().catch(() => {}); }
  const at = liveTracks(p.stream, "audio");
  if (at.length && t.audio.srcObject?.getAudioTracks()[0] !== at[0]) { t.audio.srcObject = new MediaStream(at); t.audio.play().catch(() => {}); }
  t.micOff.hidden = p.media.audio !== false;
  const ice = p.pc.iceConnectionState;
  t.st.textContent = p.connected ? (ice === "disconnected" || ice === "failed" ? "Reconnecting…" : "") : "Connecting…";
}

// ----------------------------------------------------------------- incoming
function showRinging(call, from) {
  R = { call, from, queue: [] };
  lastFocus = document.activeElement;
  const name = from?.name || from?.username || "Someone";
  const video = call.kind === "video";
  const group = call.group || (call.members || []).length > 2;
  const accept = (withVideo) => { const r = R; dismissRinging(null, true); acceptCall(r.call, withVideo, r.queue); };
  const card = h("div", { class: "call-ring", role: "alertdialog", "aria-modal": "true", "aria-label": `Incoming ${video ? "video" : "voice"} call from ${name}` },
    h("div", { class: "call-ping" }, h("span"), h("span"), h("span"), h("div", { class: "call-av" }, avatar(from?.avatar, name, "big"))),
    h("h2", { class: "name" }, flairName(from, name), ...badges(from?.badges || {}, { dev: false })),   // U2-identity
    from?.username ? h("div", { class: "meta" }, "@" + from.username) : null,
    h("div", { class: "ring-kind" }, icon(video ? "video" : "phone"), `Incoming ${group ? "group " : ""}${video ? "video" : "voice"} call`),
    h("div", { class: "ring-actions" },
      h("button", { class: "ring-btn decline", type: "button", onclick: decline, "aria-label": "Decline" }, icon("hangup"), h("span", {}, "Decline")),
      video ? h("button", { class: "ring-btn alt", type: "button", onclick: () => accept(false), "aria-label": "Answer with audio only" }, icon("phone"), h("span", {}, "Audio only")) : h("button", { class: "ring-btn alt", type: "button", onclick: () => accept(true), "aria-label": "Answer with video" }, icon("video"), h("span", {}, "With video")),
      h("button", { class: "ring-btn accept", type: "button", onclick: () => accept(video), "aria-label": "Answer" }, icon(video ? "video" : "phone"), h("span", {}, "Answer"))),
    h("div", { class: "call-info" }, icon("lock"), PRIVACY_LINE));
  const L = layer();
  L.replaceChildren(card);
  L.onkeydown = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); } };
  openLayer(false);
  startRingtone();
  R.notif = notify(name, `Incoming ${video ? "video" : "voice"} call`, { tag: "call-" + call.id, kind: "call", requireInteraction: true });
  R.timer = setTimeout(() => dismissRinging("missed"), RING_LOCAL_MS);
  setTimeout(() => card.querySelector(".accept")?.focus(), 30);
}
function decline() {
  if (!R) return;
  post(`/v1/calls/${enc(R.call.id)}/hangup`, { reason: "declined" }).catch(() => {});
  dismissRinging(null);
}
function dismissRinging(reason, accepting = false) {
  const r = R; if (!r) return;
  R = null;
  clearTimeout(r.timer);
  stopRingtone();
  try { r.notif?.close(); } catch {}
  if (!accepting) closeLayer();
  if (reason === "missed") {
    const name = r.from?.name || r.from?.username || "someone";
    notify(`Missed ${r.call.kind === "video" ? "video" : "voice"} call`, `From ${name}`, { tag: "missed-" + r.call.id, kind: "call", onclick: () => (location.hash = "#/calls") });
    missedBadgeRefresh();
  }
}
function showRejoin(call) {
  R = { call, from: null, queue: [], rejoin: true };
  const card = h("div", { class: "call-ring", role: "alertdialog", "aria-label": "You're still in a call" },
    h("div", { class: "call-av" }, icon(call.kind === "video" ? "video" : "phone", "big-ic")),
    h("h2", {}, "You're still in a call"),
    h("p", { class: "meta" }, "This tab was closed or reloaded during a call."),
    h("div", { class: "ring-actions" },
      h("button", { class: "ring-btn decline", type: "button", onclick: () => { post(`/v1/calls/${enc(call.id)}/hangup`, { reason: "ended" }).catch(() => {}); dismissRinging(null); } }, icon("hangup"), h("span", {}, "End call")),
      h("button", { class: "ring-btn accept", type: "button", onclick: () => { const r = R; dismissRinging(null, true); acceptCall(r.call, call.kind === "video", r.queue); } }, icon("phone"), h("span", {}, "Rejoin"))));
  layer().replaceChildren(card);
  openLayer(false);
}

// ================================================================== init / stop
export function initCalls() {
  unsubs.forEach((f) => f()); unsubs = [];
  unsubs.push(
    onLine("ring", onRing), onLine("signal", onSignal), onLine("joined", onJoined), onLine("left", onLeft),
    onLine("updated", onUpdated), onLine("declined", onDeclined), onLine("ended", onEnded), onLine("answered_elsewhere", onElsewhere),
    on("line", (up) => { if (up) checkActive(); }),
  );
  addEventListener("online", onOnline);
  addEventListener("pagehide", onPageHide);
  unsubs.push(() => { removeEventListener("online", onOnline); removeEventListener("pagehide", onPageHide); });
  checkActive();
  missedBadgeRefresh();
}
export function stopCalls() {
  if (S) hangup();
  if (R) { if (!R.rejoin) post(`/v1/calls/${enc(R.call.id)}/hangup`, { reason: "declined" }).catch(() => {}); dismissRinging(null); }
  unsubs.forEach((f) => f()); unsubs = [];
  hist = []; histCursor = null;
  closeLayer();
}

// ================================================================== Calls tab
let hist = [], histCursor = null, listEl = null;
const SEEN_KEY = () => `sonar_calls_seen_${meId()}`;
async function missedBadgeRefresh() {
  if (!state.me) return;
  try {
    const j = await get("/v1/calls/history");
    const seen = Number(localStorage.getItem(SEEN_KEY()) || 0);
    const n = items(j).filter((c) => c.direction === "missed" && c.createdAt > seen).length;
    setBadge("calls", n);
    if (listEl?.isConnected) { hist = items(j); histCursor = j.cursor || null; drawList(); }
  } catch {}
}
function markSeen() { try { localStorage.setItem(SEEN_KEY(), String(Date.now())); } catch {} setBadge("calls", 0); }

function partyOf(c) {
  const others = (c.members || []).filter((u) => u !== meId());
  const group = c.group || others.length > 1;
  return { group, others, chat: state.chats.get(c.chatId) };
}
function partyLabel(c, nameEl, avEl, big = false) {
  const { group, others, chat } = partyOf(c);
  if (group) {
    if (chat?.name) nameEl.textContent = chat.name;
    else Promise.all(others.slice(0, 3).map(userName_)).then((ns) => (nameEl.textContent = ns.join(", ") + (others.length > 3 ? ` +${others.length - 3}` : "") || "Group call"));
    avEl.replaceChildren(chat?.photo ? avatar(chat.photo, chat.name, big ? "big" : "") : avatar(null, chat?.name || "G", big ? "big" : ""));
  } else {
    user(others[0] || c.caller).then((u) => {
      nameEl.replaceChildren(h("span", { class: "t" }, flairName(u, userName(u))), ...badges(   // U2-identity
        u?.badges, { dev: false, hidden: u?.sonar?.hiddenBadges || [] }));
      avEl.replaceChildren(avatar(u?.avatar, userName(u), big ? "big" : ""));
    });
  }
}
const DIR = { incoming: ["incoming", "Incoming"], outgoing: ["outgoing", "Outgoing"], missed: ["missed", "Missed"] };
function callBack(c, video) {
  const { group, others } = partyOf(c);
  if (group) startCall({ chatId: c.chatId, video }); else startCall({ to: others[0] || c.caller, video });
}
async function removeCall(c) {
  if (!(await confirmBox("Remove from history?", "This only removes it from your call list.", "Remove", true))) return;
  try { await del(`/v1/calls/${enc(c.id)}`); hist = hist.filter((x) => x.id !== c.id); drawList(); if (location.hash === `#/calls/${c.id}`) location.hash = "#/calls"; }
  catch (e) { toast(errText(e)); }
}
function row(c) {
  const [ic, word] = DIR[c.direction] || DIR.outgoing;
  const nameEl = h("span", { class: "name" }, "…"), avEl = h("span", {}, avatar(null, "?"));
  partyLabel(c, nameEl, avEl);
  const kindWord = c.kind === "video" ? "video" : "voice";
  const link = h("a", { class: "rowbtn" + (c.direction === "missed" ? " missed" : ""), href: `#/calls/${enc(c.id)}`, "data-id": c.id },
    avEl,
    h("div", { class: "body" },
      h("div", { class: "l1" }, nameEl, h("span", { class: "time" }, listTime(c.createdAt))),
      h("div", { class: "l2" }, h("span", { class: "dir " + c.direction, "aria-hidden": "true" }, icon(ic)), h("span", { class: "pv" }, `${word} ${kindWord} call${c.duration ? " · " + dur(c.duration) : ""}`))));
  return h("div", { class: "call-row", role: "listitem" }, link,
    iconBtn(c.kind === "video" ? "video" : "phone", `Call back (${kindWord})`, () => callBack(c, c.kind === "video")),
    iconBtn("more", "More", (e) => menu(e.currentTarget, [
      { label: "Voice call", icon: "phone", onclick: () => callBack(c, false) },
      { label: "Video call", icon: "video", onclick: () => callBack(c, true) },
      { label: "Open chat", icon: "chat", onclick: () => (location.hash = `#/chat/${enc(c.chatId)}`) },
      "-",
      { label: "Remove from history", icon: "trash", danger: true, onclick: () => removeCall(c) },
    ], { label: "Call options" }), "more-btn"));
}
let bodyEl = null, moreBtn = null;
function drawList() {
  if (!bodyEl) return;
  const sel = location.hash.match(/^#\/calls\/([^/]+)/)?.[1];
  bodyEl.replaceChildren(hist.length
    ? h("div", { class: "rows", role: "list", "aria-label": "Call history" }, hist.map(row))
    : h("div", { class: "empty" }, "No calls yet.", h("br"), "Start one from a chat or a profile."), moreBtn);
  if (sel) callsTab.select([decodeURIComponent(sel)]);
  moreBtn.hidden = !histCursor;
}
async function loadMore() {
  moreBtn.disabled = true;
  try { const j = await get(`/v1/calls/history?before=${enc(histCursor)}`); hist = hist.concat(items(j)); histCursor = j.cursor || null; drawList(); }
  catch (e) { toast(errText(e)); }
  moreBtn.disabled = false;
}

export const callsTab = {
  async list(el) {
    listEl = el;
    bodyEl = h("div", { class: "pane-body" }, h("div", { class: "empty" }, "Loading…"));
    moreBtn = h("button", { class: "tonal small", style: "display:block;margin:10px auto", hidden: true, onclick: loadMore }, "Load more");
    el.replaceChildren(
      h("div", { class: "pane-head" }, h("h1", {}, "Calls")),
      h("div", { class: "call-note meta" }, icon("lock"), PRIVACY_LINE),
      bodyEl);
    markSeen();
    try { const j = await get("/v1/calls/history"); hist = items(j); histCursor = j.cursor || null; }
    catch (e) { bodyEl.replaceChildren(h("div", { class: "empty" }, errText(e))); return; }
    if (el.isConnected) drawList();
    const off = on("call", ({ active } = {}) => { if (!el.isConnected) return off(); if (!active) setTimeout(missedBadgeRefresh, 1500); });
  },
  async main(el, args = []) {
    const id = args[0];
    if (!id) {
      el.replaceChildren(h("div", { class: "pane-body", style: "display:flex" }, mainEmpty("Calls",
        "Start a call from a chat or a profile.",
        h("div", { class: "stack", style: "justify-items:center" },
          h("p", { class: "meta" }, icon("lock", "inline-ic"), " ", PRIVACY_LINE, "."),
          h("p", { class: "meta" }, "Sonar never records calls. Group calls connect everyone directly (up to 8 people)."),
          S ? h("button", { onclick: () => minimize(false) }, "Return to call") : null))));
      return;
    }
    let c = hist.find((x) => x.id === id);
    if (!c) { try { c = (await get(`/v1/calls/${enc(id)}`)).call; } catch (e) { el.replaceChildren(h("div", { class: "main-empty" }, h("p", {}, errText(e)))); return; } }
    const nameEl = h("h1", { class: "name" }, "…"), avEl = h("div", {}, avatar(null, "?", "big"));
    partyLabel(c, nameEl, avEl, true);
    const dir = c.direction || (c.caller === meId() ? "outgoing" : "incoming");
    const [ic, word] = DIR[dir] || DIR.outgoing;
    const kindWord = c.kind === "video" ? "video" : "voice";
    const when = new Date(c.createdAt);
    const duration = c.duration || (c.answeredAt && c.endedAt ? Math.round((c.endedAt - c.answeredAt) / 1000) : 0);
    el.replaceChildren(h("div", { class: "call-detail" },
      h("div", { class: "row" }, backBtn("#/calls", "Back to calls")),
      h("div", { class: "call-detail-card" },
        avEl, nameEl,
        h("div", { class: "row dir-line " + dir }, icon(ic), `${word} ${kindWord} call`),
        h("div", { class: "meta" }, when.toLocaleString([], { dateStyle: "full", timeStyle: "short" })),
        duration ? h("div", { class: "meta" }, "Duration " + dur(duration)) : c.reason ? h("div", { class: "meta" }, { busy: "They were busy", declined: "Declined", missed: "Not answered" }[c.reason] || "") : null,
        h("div", { class: "row", style: "justify-content:center;margin-top:12px" },
          h("button", { onclick: () => callBack(c, false) }, icon("phone"), " Voice call"),
          h("button", { onclick: () => callBack(c, true) }, icon("video"), " Video call"),
          h("a", { class: "chip", href: `#/chat/${enc(c.chatId)}` }, icon("chat"), "Message")),
        h("button", { class: "ghost", onclick: () => removeCall(c) }, "Remove from history"),
        h("p", { class: "meta small" }, icon("lock", "inline-ic"), " ", PRIVACY_LINE, "."))));
  },
  select(args = []) {
    if (!bodyEl) return;
    for (const a of bodyEl.querySelectorAll(".rowbtn[data-id]")) { if (a.dataset.id === args[0]) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); }
  },
};

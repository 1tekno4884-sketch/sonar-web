/* Wave bridge v1 — injected by the host (Sonar / Ripple / web) into every HTML page of a game, before the game's own
   scripts. Contract: U3_GAMES_API.md §3. "__HOST__" is replaced by the host's name when served. */
(function () {
  'use strict';
  if (window.Wave) return;
  var H = window.__waveHost || null, top = window.parent !== window ? window.parent : null;
  if (!H && !top) return;
  try { if (H) window.__waveHost = undefined; } catch (e) {}
  var seq = 0, pending = {}, moveCbs = [], pauseCbs = [], resumeCbs = [], listening = false;
  function send(op, data, reply) {
    var id = ++seq, msg = { wave: 1, id: id, op: op, data: data === undefined ? null : data }, p = null;
    if (reply) p = new Promise(function (res, rej) { pending[id] = [res, rej]; });
    try { if (H) H.post(JSON.stringify(msg)); else top.postMessage(msg, '*'); } catch (e) { if (reply) { delete pending[id]; return Promise.reject({ code: 'host', message: String(e) }); } }
    return p;
  }
  function each(list, a, b) { for (var i = 0; i < list.length; i++) { try { list[i](a, b); } catch (e) { setTimeout(function () { throw e; }); } } }
  function recv(m) {
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return; } }
    if (!m || m.wave !== 1) return;
    if (m.re) { var p = pending[m.re]; if (!p) return; delete pending[m.re]; if (m.ok) p[0](m.data); else p[1](m.error || { code: 'error' }); return; }
    if (m.ev === 'move' && m.data) each(moveCbs, m.data.move, m.data.meta);
    else if (m.ev === 'pause') each(pauseCbs);
    else if (m.ev === 'resume') each(resumeCbs);
  }
  Object.defineProperty(window, '__waveRecv', { value: recv, writable: false, configurable: false });
  if (!H) window.addEventListener('message', function (e) { if (e.source === top) recv(e.data); });
  // no way out except Wave: drop live-connection APIs (the host's CSP blocks network fetch/XHR)
  ['WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'Notification', 'SharedWorker']
    .forEach(function (k) { try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch (e) {} });
  try { if (navigator.sendBeacon) navigator.sendBeacon = function () { return false; }; } catch (e) {}
  function json(d) { try { return JSON.stringify(d === undefined ? null : d); } catch (e) { return null; } }
  var W = {
    version: 1, host: '__HOST__',
    ready: function () { send('ready'); },
    info: function () { return send('info', null, true); },
    submitScore: function (n) { n = Number(n); if (!isFinite(n)) return Promise.reject({ code: 'bad_score' }); return send('score', n, true); },
    saveState: function (d) { var s = json(d); if (s === null || s.length > 65536) return Promise.resolve(false); return send('save', s, true); },
    loadState: function () { return send('load', null, true).then(function (s) { if (s == null) return null; try { return JSON.parse(s); } catch (e) { return null; } }); },
    haptic: function (k) { send('haptic', typeof k === 'string' ? k : 'tap'); },
    exit: function () { send('exit'); },
    sendMove: function (m) { var s = json(m); if (s === null || s.length > 2048) return Promise.reject({ code: 'too_big', message: 'moves are 2 KB max' }); return send('move', JSON.parse(s), true); },
    onMove: function (cb) { if (typeof cb !== 'function') return; moveCbs.push(cb); if (!listening) { listening = true; send('listen'); } },
    endMatch: function (r) { send('end', r && typeof r === 'object' ? { winner: r.winner === 0 || r.winner === 1 ? r.winner : null, text: String(r.text || '').slice(0, 80) } : { winner: null }); },
    onPause: function (cb) { if (typeof cb === 'function') pauseCbs.push(cb); },
    onResume: function (cb) { if (typeof cb === 'function') resumeCbs.push(cb); },
  };
  Object.freeze(W);
  Object.defineProperty(window, 'Wave', { value: W, writable: false, configurable: false, enumerable: true });
})();

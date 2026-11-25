// Wave games on the web (Sonar web + Ripple web): the built-in games in a sandboxed iframe (no same-origin, no network),
// talking to this page only through the Wave bridge over postMessage (U3_GAMES_API.md §3.5). Uploaded games stay in the
// apps for now. Loaded by games.html, which sets data-app="sonar"|"ripple" on <html>.
(function () {
  'use strict';
  const APP = document.documentElement.dataset.app || 'sonar';
  const TOKEN_KEY = APP === 'ripple' ? 'ripple_token' : 'sonar_token';
  const LIVE = 'https://ripple-api.undertowstudio.workers.dev';
  const API = (() => {
    try {
      if (APP === 'ripple') return ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787' : LIVE;
      return localStorage.getItem('sonar_api_override') || LIVE;
    } catch (e) { return LIVE; }
  })();
  let token = null; try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  const $ = (t, a, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a || {})) { if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };
  const api = async (path, body) => {
    const r = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  };
  const store = { get(k) { try { return localStorage.getItem('wave:' + k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('wave:' + k, v); } catch (e) {} } };
  let me = null, games = [], bridgeJs = '', enabled = APP !== 'ripple';
  const root = document.getElementById('games');

  async function boot() {
    const [idx, br] = await Promise.all([fetch('waves/index.json').then((r) => r.json()), fetch('waves/bridge.js').then((r) => r.text())]);
    games = idx.games; bridgeJs = br.replace('__HOST__', 'web');
    if (token) {
      try { me = (await api('/v1/me')).user; } catch (e) { me = null; }
      if (APP === 'ripple' && me) { try { enabled = (await api('/v1/beta')).enabled.includes('ripple.games'); } catch (e) { enabled = false; } }
    }
    render();
  }
  const SHELVES = [['Duels', ['tidetac', 'fathoms', 'checkers', 'reversi', 'dots', 'fleet']], ['Puzzles', ['pairs', 'mines', 'sudoku', 'slide', 'merge', 'wordsearch']],
    ['Arcade', ['eel', 'breaker', 'stack', 'runner', 'volley', 'hockey']], ['Classics', ['anchor', 'solitaire', 'echo', 'putt']]];
  function tile(g) {
    const best = store.get('best:' + g.id);
    return $('button', { class: 'wg-tile', 'aria-label': g.name, on: { click: () => play(g) } },
      $('span', { class: 'wg-art', style: `background:linear-gradient(135deg, ${g.accent}cc, ${g.accent} 55%, #0008)` }, g.glyph),
      $('span', { class: 'wg-name' }, g.name), $('span', { class: 'wg-sub' }, best ? 'Best ' + Number(best).toLocaleString() : g.players === '2-online' ? '1–2 players' : g.players === '2-local' ? '1–2 players' : '1 player'));
  }
  function render() {
    root.replaceChildren();
    if (!enabled) {
      root.append($('div', { class: 'wg-empty' }, $('h2', {}, 'Games is a Ripple beta'), $('p', {}, me ? 'It isn’t on for your account yet. Games is out for everyone in Sonar — on Android and on the web.' : 'Sign in to Ripple on the web first.'),
        $('a', { class: 'wg-btn', href: 'https://1tekno4884-sketch.github.io/sonar-web/games.html' }, 'Play in Sonar web')));
      return;
    }
    root.append($('p', { class: 'wg-lead' }, `${games.length} games to play right here. ${me ? 'Your best scores go on the leaderboards.' : 'Sign in to the web app to save scores to the leaderboards.'} Online challenges and player-made games are in the Android app.`));
    const by = Object.fromEntries(games.map((g) => [g.slug, g]));
    for (const [name, slugs] of SHELVES) {
      const list = slugs.map((s) => by[s]).filter(Boolean);
      if (list.length) root.append($('h2', { class: 'wg-shelf' }, name), $('div', { class: 'wg-grid' }, list.map(tile)));
    }
  }

  // ------------------------------------------------------------ player
  let frame = null, overlay = null, cur = null, scoreTimes = [];
  const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'";
  async function play(g) {
    let html = await fetch(`waves/${g.slug}/index.html`).then((r) => r.text());
    const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${bridgeJs.replace(/<\/script/gi, '<\\/script')}</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
    cur = g;
    frame = $('iframe', { sandbox: 'allow-scripts', title: g.name, allow: 'autoplay', referrerpolicy: 'no-referrer' });
    frame.srcdoc = html;
    const splash = $('div', { class: 'wg-splash', style: `background:${g.accent}` }, $('span', { class: 'wg-glyph' }, g.glyph), $('b', {}, g.name));
    overlay = $('div', { class: 'wg-player', role: 'dialog', 'aria-label': g.name }, frame, splash);
    document.body.append(overlay); document.body.classList.add('wg-open');
    setTimeout(() => splash.remove(), 4000);
    overlay._splash = splash;
    history.pushState({ wave: 1 }, '', '#play');
  }
  function close() { if (!overlay) return; overlay.remove(); overlay = frame = cur = null; document.body.classList.remove('wg-open'); render(); }
  window.addEventListener('popstate', () => close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay) history.back(); });
  const reply = (id, ok, data) => frame && frame.contentWindow.postMessage(ok ? { wave: 1, re: id, ok: true, data } : { wave: 1, re: id, ok: false, error: data }, '*');
  window.addEventListener('message', async (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data; if (!m || m.wave !== 1 || !cur) return;
    const g = cur, id = m.id;
    switch (m.op) {
      case 'ready': overlay && overlay._splash && overlay._splash.remove(); break;
      case 'exit': history.back(); break;
      case 'haptic': try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} break;
      case 'info': reply(id, true, { gameId: g.id, host: 'web', hostVersion: '1', player: { name: me ? (me.displayName || me.username) : 'You', username: me ? me.username : null }, match: null,
        theme: { dark: matchMedia('(prefers-color-scheme: dark)').matches, accent: APP === 'ripple' ? '#1565FF' : '#1494B8' }, reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        locale: navigator.language, best: store.get('best:' + g.id) == null ? null : Number(store.get('best:' + g.id)) }); break;
      case 'save': { const s = typeof m.data === 'string' && m.data.length <= 65536 ? m.data : null; if (s) store.set('save:' + (me ? me.id : 'guest') + ':' + g.id, s); reply(id, true, !!s); break; }
      case 'load': reply(id, true, store.get('save:' + (me ? me.id : 'guest') + ':' + g.id)); break;
      case 'score': {
        const n = Math.round(Number(m.data)); if (!isFinite(n)) { reply(id, false, { code: 'bad_score' }); break; }
        const old = store.get('best:' + g.id), low = g.score === 'low';
        const better = old == null || (low ? n < Number(old) : n > Number(old)); if (better) store.set('best:' + g.id, String(n));
        let res = { best: better ? n : Number(old), isBest: better, rank: null };
        const t = Date.now(); scoreTimes = scoreTimes.filter((x) => t - x < 60000);
        if (me && g.hasScore !== false && scoreTimes.length < 30) { scoreTimes.push(t); try { const r = await api(`/v1/games/${g.id}/score`, { score: n }); res = { ...res, best: r.best, rank: r.rank }; } catch (x) {} }
        reply(id, true, res); break;
      }
      case 'move': reply(id, false, { code: 'no_match', message: 'Online matches are in the Android app' }); break;
      default: break;
    }
  });
  boot().catch((e) => { root.textContent = 'Couldn’t load the games: ' + e.message; });
})();

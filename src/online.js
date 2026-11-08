// Client for the online leaderboard of the daily challenge (server in worker/).
// Every call resolves (never throws): when the server can't be reached the game plays offline.
const API = '/api';

// the main address (set by build.mjs from SITE_URL), used in shared results
export const SITE_URL = typeof __SITE_URL__ !== 'undefined' ? __SITE_URL__ : 'https://mineworldsapp.com';

async function call(path, body, timeoutMs) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  try {
    const opts =
      body === undefined
        ? { cache: 'no-store', signal: ctl?.signal }
        : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal };
    // the timestamp keeps GETs away from any cache, including an older service worker
    const url = API + path + (body === undefined ? (path.includes('?') ? '&' : '?') + '_=' + Date.now() : '');
    const res = await fetch(url, opts);
    if (!(res.headers.get('content-type') || '').includes('application/json')) return { ok: false, error: 'offline', status: res.status };
    const data = await res.json();
    return data && typeof data === 'object' ? { ...data, status: res.status } : { ok: false, error: 'offline' };
  } catch (e) {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

export const online = {
  daily: () => call('/daily', undefined, 3500),
  start: (day) => call('/daily/start', { day }, 10000),
  // the moment the field is cleared: the server replays the moves and fixes the official time
  finish: (run) => call('/daily/finish', run, 15000),
  // then the checked run goes on the leaderboard under the player's name
  submit: (entry) => call('/daily/submit', entry, 12000),
  leaderboard: (day, player) => call(`/leaderboard?day=${encodeURIComponent(day)}&player=${encodeURIComponent(player || '')}`, undefined, 9000),
  rename: (player, nick) => call('/nick', { player, nick }, 9000),
  forget: (player) => call('/forget', { player }, 9000),
};

// random id that marks this browser's results (it acts as a password: it is never shown)
export function newPlayerId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 83456 -> "1:23.5"
export function fmtMs(ms) {
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

// the UTC day the server uses, YYYY-MM-DD
export function utcDayKey(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

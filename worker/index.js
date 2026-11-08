// Mined Worlds API on Cloudflare Workers + D1: the daily planet, signed run tokens,
// checked results and the leaderboard. Everything else is static files from dist/
// (see wrangler.jsonc).
//
//   GET  /api/daily                       today's day and seed
//   POST /api/daily/start   {day}         token for a run, sent at the first dig
//   POST /api/daily/finish  {token, moves, ms}   sent the moment the field is cleared: the server
//                                         replays the run, fixes the official time, signs a proof
//   POST /api/daily/submit  {proof, player, nick}   puts the proof on the leaderboard
//   GET  /api/leaderboard?day=&player=    top 50, total, the player's own place
//   POST /api/nick          {player, nick}
//   POST /api/forget        {player}      deletes every result of this player
import { buildDaily, checkRun, officialTime, utcDay, addDays, isDay, canonicalUrl } from './daily.js';
import { cleanNick } from '../src/nick.js';

const MAX_BODY = 96 * 1024;
const MAX_RUNS = 60; // checked runs per network per day
const TOP = 50;
const MAX_RUN_MS = 6 * 3600 * 1000;
const MAX_PROOF_AGE = 24 * 3600 * 1000;
const KEEP_DAYS = 30; // leaderboard entries are deleted after this (see /privacy)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // the page itself (wrangler.jsonc sends "/" here too): one address for everyone, since
      // progress and the leaderboard name are kept per site
      const to = canonicalUrl(url, env.CANONICAL_HOST);
      return to ? Response.redirect(to, 301) : env.ASSETS.fetch(request);
    }
    try {
      return await route(request, env, ctx, url);
    } catch (e) {
      console.error('api error', (e && e.stack) || e);
      return json({ ok: false, error: 'server' }, 500);
    }
  },
};

function route(request, env, ctx, url) {
  const p = url.pathname;
  const m = request.method;
  if (p === '/api/daily' && m === 'GET') return daily(env, ctx);
  if (p === '/api/daily/start' && m === 'POST') return start(request, env, ctx);
  if (p === '/api/daily/finish' && m === 'POST') return finish(request, env);
  if (p === '/api/daily/submit' && m === 'POST') return submit(request, env);
  if (p === '/api/leaderboard' && m === 'GET') return leaderboard(env, url);
  if (p === '/api/nick' && m === 'POST') return rename(request, env);
  if (p === '/api/forget' && m === 'POST') return forget(request, env);
  return json({ ok: false, error: 'not-found' }, 404);
}

// ---- endpoints -----------------------------------------------------------------------------

async function daily(env, ctx) {
  const now = Date.now();
  const day = utcDay(now);
  const seed = await dailySeed(env, day);
  // build today's planet in the background, ahead of the first result
  ctx.waitUntil(getBoard(env, day).catch((e) => console.error('board', e)));
  return json({ ok: true, day, seed, endsIn: Date.parse(addDays(day, 1) + 'T00:00:00Z') - now });
}

async function start(request, env, ctx) {
  const body = await readJson(request);
  const day = utcDay();
  if (!body || body.day !== day) return json({ ok: false, error: 'day' }, 409);
  const token = await sign(env, 'run', { d: day, t: Date.now(), r: randomHex(8) });
  ctx.waitUntil(getBoard(env, day).catch((e) => console.error('board', e)));
  return json({ ok: true, token });
}

async function finish(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'body' }, 400);
  const run = await readSigned(env, 'run', body.token);
  if (!run || !isDay(run.d) || !Number.isFinite(run.t)) return json({ ok: false, error: 'token' }, 400);
  const now = Date.now();
  const serverMs = now - run.t;
  if (serverMs < 0 || serverMs > MAX_RUN_MS) return json({ ok: false, error: 'expired' }, 400);
  if (!(await allowRun(request, env, run.d))) return json({ ok: false, error: 'limit' }, 429);
  const board = await getBoard(env, run.d);
  const res = checkRun(board, body.moves);
  if (!res.ok) return json({ ok: false, error: res.error }, 422);
  const ms = officialTime(Number(body.ms), serverMs, res.actions);
  if (ms === null) return json({ ok: false, error: 'time' }, 422);
  const proof = await sign(env, 'proof', { d: run.d, r: run.r, ms, a: res.actions, t: now });
  return json({ ok: true, day: run.d, ms, proof });
}

async function submit(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'body' }, 400);
  const pr = await readSigned(env, 'proof', body.proof);
  if (!pr || !isDay(pr.d) || !Number.isInteger(pr.ms) || typeof pr.r !== 'string') return json({ ok: false, error: 'proof' }, 400);
  const now = Date.now();
  if (now - pr.t > MAX_PROOF_AGE) return json({ ok: false, error: 'expired' }, 400);
  const player = validPlayer(body.player);
  if (!player) return json({ ok: false, error: 'player' }, 400);
  const nick = cleanNick(body.nick);
  if (!nick) return json({ ok: false, error: 'nick' }, 422);

  const db = env.DB;
  let best;
  try {
    best = await db
      .prepare(
        `INSERT INTO scores (day, player, nick, ms, moves, run, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (day, player) DO UPDATE SET
           nick = excluded.nick,
           moves = CASE WHEN excluded.ms < scores.ms THEN excluded.moves ELSE scores.moves END,
           run = CASE WHEN excluded.ms < scores.ms THEN excluded.run ELSE scores.run END,
           created = CASE WHEN excluded.ms < scores.ms THEN excluded.created ELSE scores.created END,
           ms = MIN(scores.ms, excluded.ms)
         RETURNING ms, created`
      )
      .bind(pr.d, player, nick, pr.ms, pr.a, pr.r, now)
      .first();
  } catch (e) {
    // the same checked run was already posted under another name
    if (/UNIQUE/i.test(String(e && e.message))) return json({ ok: false, error: 'used' }, 409);
    throw e;
  }
  const [ahead, total] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND ms < ?').bind(pr.d, best.ms),
    db.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ?').bind(pr.d),
  ]);
  return json({
    ok: true,
    day: pr.d,
    ms: pr.ms,
    best: best.ms,
    improved: best.created === now,
    rank: ahead.results[0].n + 1,
    total: total.results[0].n,
  });
}

async function leaderboard(env, url) {
  const day = url.searchParams.get('day') || utcDay();
  if (!isDay(day)) return json({ ok: false, error: 'day' }, 400);
  const player = validPlayer(url.searchParams.get('player')) || '';
  const db = env.DB;
  const [top, total, mine] = await db.batch([
    db.prepare('SELECT nick, ms, player = ?2 AS me FROM scores WHERE day = ?1 ORDER BY ms, created LIMIT ?3').bind(day, player, TOP),
    db.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ?').bind(day),
    db
      .prepare('SELECT ms, (SELECT COUNT(*) FROM scores s2 WHERE s2.day = s1.day AND s2.ms < s1.ms) + 1 AS rank FROM scores s1 WHERE day = ? AND player = ?')
      .bind(day, player),
  ]);
  let rank = 0;
  let prevMs = -1;
  const rows = top.results.map((r, i) => {
    if (r.ms !== prevMs) {
      rank = i + 1;
      prevMs = r.ms;
    }
    return { rank, nick: r.nick, ms: r.ms, me: !!r.me };
  });
  const m = mine.results[0];
  return json({ ok: true, day, today: utcDay(), total: total.results[0].n, top: rows, me: m ? { rank: m.rank, ms: m.ms } : null });
}

async function rename(request, env) {
  const body = await readJson(request);
  const player = validPlayer(body && body.player);
  if (!player) return json({ ok: false, error: 'player' }, 400);
  const nick = cleanNick(body.nick);
  if (!nick) return json({ ok: false, error: 'nick' }, 422);
  const today = utcDay();
  await env.DB.prepare('UPDATE scores SET nick = ?1 WHERE day IN (?2, ?3) AND player = ?4').bind(nick, today, addDays(today, -1), player).run();
  return json({ ok: true, nick });
}

// the random player id lives only in the player's browser, so holding it is what proves ownership
async function forget(request, env) {
  const body = await readJson(request);
  const player = validPlayer(body && body.player);
  if (!player) return json({ ok: false, error: 'player' }, 400);
  const res = await env.DB.prepare('DELETE FROM scores WHERE player = ?').bind(player).run();
  return json({ ok: true, deleted: (res.meta && res.meta.changes) || 0 });
}

// ---- the daily planet ------------------------------------------------------------------------

const boards = new Map(); // day -> board, per isolate

async function getBoard(env, day) {
  const hit = boards.get(day);
  if (hit) return hit;
  const db = env.DB;
  const row = await db.prepare('SELECT data FROM boards WHERE day = ?').bind(day).first();
  let board;
  if (row) board = JSON.parse(row.data);
  else {
    // built once per day; afterwards checking a run is just a replay
    board = buildDaily(day, await dailySeed(env, day));
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO boards (day, data, created) VALUES (?, ?, ?)').bind(day, JSON.stringify(board), Date.now()),
      db.prepare('DELETE FROM boards WHERE day < ?').bind(addDays(day, -3)),
      db.prepare('DELETE FROM limits WHERE k < ?').bind(addDays(day, -1)),
      db.prepare('DELETE FROM scores WHERE day < ?').bind(addDays(day, -KEEP_DAYS)),
    ]);
  }
  boards.set(day, board);
  if (boards.size > 3) boards.delete(boards.keys().next().value);
  return board;
}

async function dailySeed(env, day) {
  const h = await hmac(env, 'daily:' + day);
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

// ---- secret, tokens, limits ------------------------------------------------------------------

let keyPromise = null;
function secretKey(env) {
  if (!keyPromise) {
    keyPromise = (async () => {
      const db = env.DB;
      let row = await db.prepare("SELECT v FROM config WHERE k = 'secret'").first();
      if (!row) {
        await db.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('secret', lower(hex(randomblob(32))))").run();
        row = await db.prepare("SELECT v FROM config WHERE k = 'secret'").first();
      }
      const bytes = new Uint8Array(row.v.match(/../g).map((x) => parseInt(x, 16)));
      return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    })();
    keyPromise.catch(() => (keyPromise = null));
  }
  return keyPromise;
}

const enc = new TextEncoder();
async function hmac(env, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await secretKey(env), enc.encode(text)));
}

// signed payloads: "run" tokens from /start, "proof"s of a checked run from /finish
async function sign(env, kind, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + '.' + b64u(await hmac(env, kind + ':' + body));
}

async function readSigned(env, kind, token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await secretKey(env), unb64u(sig), enc.encode(kind + ':' + body));
    return ok ? JSON.parse(new TextDecoder().decode(unb64u(body))) : null;
  } catch (e) {
    return null;
  }
}

async function allowRun(request, env, day) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const h = await hmac(env, 'ip:' + day + ':' + ip);
  const key = day + ':' + [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const row = await env.DB.prepare('INSERT INTO limits (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n').bind(key).first();
  return row.n <= MAX_RUNS;
}

// ---- helpers -----------------------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

function validPlayer(p) {
  return typeof p === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(p) ? p : null;
}

function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

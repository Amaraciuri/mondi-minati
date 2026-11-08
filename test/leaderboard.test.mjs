// Server-side checks for the online leaderboard (worker/daily.js, src/nick.js).
// node test/leaderboard.test.mjs
import assert from 'node:assert/strict';
import { buildDaily, checkRun, officialTime, utcDay, addDays, isDay, MIN_MS_PER_ACTION, canonicalUrl } from '../worker/daily.js';
import { cleanNick } from '../src/nick.js';
import { dailyLevelFor, cellCountOf, DAILY_WEEK_FROM } from '../src/levels.js';
import { hashString } from '../src/util.js';
import { makeShape } from '../src/shapes.js';
import { BoardGenerator, Minefield, findLogicalSafe } from '../src/minesweeper.js';
import { mulberry32 } from '../src/util.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok  ', name);
  } catch (e) {
    failures++;
    console.log('FAIL', name, '\n     ', e.message);
  }
}

// what the game does in startLevel() for a daily level
function clientBoard(day, seed) {
  const level = dailyLevelFor(day, seed, { ranked: true });
  const shape = makeShape(level.shape);
  const rng = mulberry32(level.seed);
  const start = Math.floor(rng() * shape.n);
  const res = new BoardGenerator(shape.neighbors, level.mines, start, rng, { noGuess: true, maxAttempts: 3000 }).finish(8000);
  const mines = [];
  res.mines.forEach((m, i) => m && mines.push(i));
  return { start, mines, nb: shape.neighbors, n: shape.n };
}

// a winning run played by the solver, with some flags and a chord thrown in
function winningRun(board) {
  const mines = new Uint8Array(board.n);
  board.mines.forEach((c) => (mines[c] = 1));
  const f = new Minefield(board.nb, board.mines.length);
  f.setBoard(mines);
  const moves = [[0, board.start]];
  f.reveal(board.start);
  let chorded = false;
  for (let k = 0; k < 5000 && !f.isWon(); k++) {
    const c = findLogicalSafe(board.nb, f.counts, f.mineCount, f.revealed);
    assert.ok(c >= 0, 'solver stuck on a no-guess board');
    // flag the mines around this cell's revealed neighbours now and then, and chord once
    const num = board.nb[c].find((y) => f.revealed[y] && f.counts[y] > 0);
    if (!chorded && num !== undefined) {
      const hidden = board.nb[num].filter((y) => !f.revealed[y]);
      const mineNb = hidden.filter((y) => mines[y]);
      if (mineNb.length === f.counts[num]) {
        for (const y of mineNb) if (!f.flags[y]) {
          moves.push([2, y]);
          f.toggleFlag(y);
        }
        if (f.canChord(num)) {
          moves.push([1, num]);
          f.chord(num);
          chorded = true;
          continue;
        }
      }
    }
    moves.push([0, c]);
    f.reveal(c);
  }
  return moves;
}

const days = Array.from({ length: 12 }, (_, i) => addDays('2026-11-08', i));
const seeds = days.map((d, i) => (Math.imul(i + 1, 2654435761) ^ 0x5bd1e995) >>> 0);

test('server rebuilds exactly the planet the game plays', () => {
  days.forEach((day, i) => {
    const s = buildDaily(day, seeds[i]);
    const c = clientBoard(day, seeds[i]);
    assert.equal(s.start, c.start, day + ' start');
    assert.deepEqual(s.mines, c.mines, day + ' mines');
    assert.deepEqual(s.nb, c.nb.map((a) => Array.from(a)), day + ' neighbours');
  });
});

// the rules used before DAILY_WEEK_FROM, as they were: those planets are stored on the server
function legacyDaily(key, seed) {
  const date = new Date(key + 'T12:00:00Z');
  const rng = mulberry32(seed);
  const shapes = [
    { shape: 'sphere', freq: 6 },
    { shape: 'cube', N: 6 },
    { shape: 'torus', U: 28, V: 11 },
    { shape: 'asteroid', freq: 6, seed: 1 + (seed % 9) },
  ];
  const themes = ['moon', 'mint', 'rust', 'donut', 'rock', 'violet', 'ice', 'lava', 'giant', 'core'];
  const dayNum = Math.floor(date.getTime() / 86400000);
  const spec = shapes[dayNum % shapes.length];
  const cells = cellCountOf(spec);
  const theme = spec.shape === 'torus' ? (rng() < 0.5 ? 'donut' : 'lava') : themes[Math.floor(rng() * themes.length)];
  return { shape: spec, mines: Math.round(cells * (spec.shape === 'sphere' || spec.shape === 'asteroid' ? 0.19 : 0.165)), theme };
}

test('days before the weekly rules keep exactly their planet', () => {
  for (const day of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) {
    for (const seed of [1, 99, 33580314, 1098986342, 3637480001, hashString('mondi-minati-' + day)]) {
      const a = dailyLevelFor(day, seed);
      assert.deepEqual({ shape: a.shape, mines: a.mines, theme: a.theme }, legacyDaily(day, seed), day + ' ' + seed);
      assert.equal(a.tier, null);
    }
  }
});

test('weekly rules: Monday easy, Sunday hard, every planet solvable without guessing', () => {
  assert.equal(new Date(DAILY_WEEK_FROM + 'T12:00:00Z').getUTCDay(), 1, 'the weekly rules start on a Monday');
  // 28 days: every shape on every weekday
  for (let i = 0; i < 28; i++) {
    const day = addDays(DAILY_WEEK_FROM, i);
    const L = dailyLevelFor(day, 1234567 + i);
    assert.equal(L.tier, i % 7, day + ' tier');
    const cells = cellCountOf(L.shape);
    if (L.tier === 0) assert.ok(cells <= 170 && L.mines / cells <= 0.125, day + ' Monday is small');
    if (L.tier === 6) assert.ok(cells >= 290, day + ' Sunday is big');
    const shape = makeShape(L.shape);
    const rng = mulberry32(L.seed);
    const start = Math.floor(rng() * shape.n);
    const res = new BoardGenerator(shape.neighbors, L.mines, start, rng, { noGuess: true, maxAttempts: 3000 }).finish(8000);
    assert.ok(res.solved, `${day} ${L.shape.shape} ${cells}/${L.mines} solvable by logic`);
  }
});

test('board survives the trip through the database (JSON)', () => {
  const b = buildDaily(days[0], seeds[0]);
  const back = JSON.parse(JSON.stringify(b));
  assert.deepEqual(checkRun(back, winningRun(b)).ok, true);
});

test('a real win is accepted, moves after the win are ignored', () => {
  days.slice(0, 4).forEach((day, i) => {
    const b = buildDaily(day, seeds[i]);
    const moves = winningRun(b);
    assert.ok(moves.some((m) => m[0] === 1), 'run includes a chord');
    const r = checkRun(b, moves);
    assert.equal(r.ok, true, day + ' ' + r.error);
    assert.equal(r.actions, moves.length);
    assert.equal(checkRun(b, [...moves, [0, 0], [2, 1]]).actions, moves.length);
  });
});

test('cheats and broken runs are rejected', () => {
  const b = buildDaily(days[5], seeds[5]);
  const moves = winningRun(b);
  assert.equal(checkRun(b, moves.slice(0, -1)).error, 'unfinished');
  assert.equal(checkRun(b, [[0, b.mines[0]]]).error, 'start');
  assert.equal(checkRun(b, [[0, b.start], [0, b.mines[0]]]).error, 'mine');
  const notStart = [...Array(b.n).keys()].find((c) => c !== b.start && !b.mines.includes(c));
  assert.equal(checkRun(b, [[0, notStart], ...moves]).error, 'start');
  assert.equal(checkRun(b, []).error, 'moves');
  assert.equal(checkRun(b, 'nope').error, 'moves');
  assert.equal(checkRun(b, [[0, b.start], [0, b.n]]).error, 'moves');
  assert.equal(checkRun(b, [[0, b.start], [7, 3]]).error, 'moves');
  assert.equal(checkRun(b, [[0, b.start], [0, 1.5]]).error, 'moves');
  assert.equal(checkRun(b, Array(5000).fill([2, 0])).error, 'moves');
  // a chord on wrongly flagged neighbours blows up like in the game
  const f = new Minefield(b.nb, b.mines.length);
  const mines = new Uint8Array(b.n);
  b.mines.forEach((c) => (mines[c] = 1));
  f.setBoard(mines);
  f.reveal(b.start);
  const num = [...Array(b.n).keys()].find((c) => f.revealed[c] && f.counts[c] > 0 && b.nb[c].some((y) => !f.revealed[y] && !mines[y]));
  const safe = b.nb[num].filter((y) => !f.revealed[y] && !mines[y]).slice(0, f.counts[num]);
  if (safe.length === f.counts[num]) {
    const bad = [[0, b.start], ...safe.map((y) => [2, y]), [1, num]];
    assert.equal(checkRun(b, bad).error, 'mine');
  }
});

test('official time: own clock, but pauses and made-up times do not help', () => {
  assert.equal(officialTime(61000, 62000, 100), 61000); // normal network
  assert.equal(officialTime(40000, 95000, 100), 92500); // paused or faked: server time minus slack
  assert.equal(officialTime(99999999, 62000, 100), 63000); // clock ahead of the server: capped
  assert.equal(officialTime(NaN, 62000, 100), 59500);
  assert.equal(officialTime(9000, 9500, 100), null); // 100 actions in 9 s
  assert.equal(officialTime(2000, 2400, 3), null); // under 3 s
  assert.equal(officialTime(100 * MIN_MS_PER_ACTION, 100 * MIN_MS_PER_ACTION, 100), 100 * MIN_MS_PER_ACTION);
});

test('days', () => {
  assert.equal(utcDay(Date.parse('2026-11-07T23:59:59Z')), '2026-11-07');
  assert.equal(utcDay(Date.parse('2026-11-08T00:00:00Z')), '2026-11-08');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isDay('2026-11-07'), true);
  assert.equal(isDay('2026-02-30'), false);
  assert.equal(isDay('2026-11-7'), false);
  assert.equal(isDay(null), false);
});

test('one main address', () => {
  const go = (u) => canonicalUrl(new URL(u), 'mineworldsapp.com');
  assert.equal(go('https://mineworldsapp.com/'), null);
  assert.equal(go('http://mineworldsapp.com/?debug'), 'https://mineworldsapp.com/?debug');
  assert.equal(go('https://www.mineworldsapp.com/'), 'https://mineworldsapp.com/');
  assert.equal(go('https://mondi-minati.davide-venezia.workers.dev/'), 'https://mineworldsapp.com/');
  assert.equal(go('https://3f2a91bc-mondi-minati.davide-venezia.workers.dev/'), null); // version preview
  assert.equal(go('http://127.0.0.1:8787/'), null);
  assert.equal(go('http://localhost:8787/'), null);
  assert.equal(canonicalUrl(new URL('http://mineworldsapp.com/'), undefined), null);
});

test('leaderboard names', () => {
  assert.equal(cleanNick('Davide'), 'Davide');
  assert.equal(cleanNick('  Da   vi\tde '), 'Da vi de');
  assert.equal(cleanNick('Zoë_99'), 'Zoë_99');
  assert.equal(cleanNick('李小龙'), '李小龙');
  assert.equal(cleanNick("D'Angelo"), "D'Angelo");
  assert.equal(cleanNick('a'), null);
  assert.equal(cleanNick('x'.repeat(17)), null);
  assert.equal(cleanNick('x'.repeat(16)), 'x'.repeat(16));
  assert.equal(cleanNick('<b>hi</b>'), null);
  assert.equal(cleanNick('-dash'), null);
  assert.equal(cleanNick('smile 🙂'), null);
  assert.equal(cleanNick('F.U.C.K'), null);
  assert.equal(cleanNick('stronz0'), null);
  assert.equal(cleanNick('Porco Dio'), null);
  assert.equal(cleanNick('sh1t'), null);
  assert.equal(cleanNick('zero​width'), 'zerowidth');
  assert.equal(cleanNick(42), null);
});

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL LEADERBOARD CHECKS PASSED');

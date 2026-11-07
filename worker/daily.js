// Server side of the daily challenge: rebuilds the day's planet exactly as the game does,
// and replays a run to check that it really clears the field. Pure functions, tested in
// test/leaderboard.test.mjs.
import { makeShape } from '../src/shapes.js';
import { BoardGenerator, Minefield } from '../src/minesweeper.js';
import { mulberry32 } from '../src/util.js';
import { dailyLevelFor } from '../src/levels.js';

export const MAX_MOVES = 4000;
export const MIN_MS_PER_ACTION = 100; // faster than this is not a person clicking
export const MIN_RUN_MS = 3000;
export const LATENCY_MS = 2500; // network slack between the player's clock and the server's

export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(day, k) {
  return utcDay(Date.parse(day + 'T00:00:00Z') + k * 86400000);
}
export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && utcDay(Date.parse(s + 'T00:00:00Z')) === s;
}

// Same steps as startLevel() in src/main.js for a daily level.
export function buildDaily(day, seed) {
  const level = dailyLevelFor(day, seed);
  const shape = makeShape(level.shape);
  const rng = mulberry32(level.seed);
  const start = Math.floor(rng() * shape.n);
  const gen = new BoardGenerator(shape.neighbors, level.mines, start, rng, { noGuess: true, maxAttempts: 3000 });
  // no deadline: the result must depend on the seed only (inside a Worker the clock stands still anyway)
  while (!gen.done) gen.step(1e9);
  const mines = [];
  gen.result.mines.forEach((m, i) => {
    if (m) mines.push(i);
  });
  return { day, shape: level.shape.shape, n: shape.n, start, nb: shape.neighbors.map((a) => Array.from(a)), mines };
}

// moves: [[action, cell], ...] where action 0 = dig, 1 = open around a number, 2 = flag on/off.
// The first dig must be the glowing start tile. Moves after the field is cleared are ignored.
export function checkRun(board, moves) {
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_MOVES) return { ok: false, error: 'moves' };
  const mines = new Uint8Array(board.n);
  for (const c of board.mines) mines[c] = 1;
  const f = new Minefield(board.nb, board.mines.length);
  f.setBoard(mines);
  let dug = false;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!Array.isArray(m)) return { ok: false, error: 'moves' };
    const [a, c] = m;
    if (!Number.isInteger(c) || c < 0 || c >= board.n) return { ok: false, error: 'moves' };
    if (a === 0) {
      if (!dug && c !== board.start) return { ok: false, error: 'start' };
      dug = true;
      f.reveal(c);
    } else if (a === 1) f.chord(c);
    else if (a === 2) f.toggleFlag(c);
    else return { ok: false, error: 'moves' };
    if (f.lost) return { ok: false, error: 'mine' };
    if (f.isWon()) return { ok: true, actions: i + 1 };
  }
  return { ok: false, error: 'unfinished' };
}

// The official time is the player's own clock, but never less than what the server measured
// from the first dig to the result (minus network slack): pauses count, invented times don't pass.
export function officialTime(clientMs, serverMs, actions) {
  const client = Number.isFinite(clientMs) ? Math.min(Math.max(clientMs, 0), serverMs + 1000) : 0;
  const ms = Math.round(Math.max(client, serverMs - LATENCY_MS));
  if (ms < Math.max(MIN_RUN_MS, actions * MIN_MS_PER_ACTION)) return null;
  return ms;
}

import { makeSphere, makeCube, makeTorus, makePlane, makeShape } from '../src/shapes.js';
import { BoardGenerator, Minefield, solveFrom, findLogicalSafe, computeCounts, placeMines } from '../src/minesweeper.js';
import { mulberry32 } from '../src/util.js';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('FAIL', msg);
  }
};

function hist(nb) {
  const h = {};
  for (const l of nb) h[l.length] = (h[l.length] || 0) + 1;
  return h;
}
function symmetric(nb) {
  for (let c = 0; c < nb.length; c++) for (const d of nb[c]) if (!nb[d].includes(c)) return false;
  return true;
}

// --- geometry ---
for (const f of [3, 4, 5, 6, 8, 10]) {
  const s = makeSphere(f);
  check(s.n === 10 * f * f + 2, `sphere f=${f} count ${s.n}`);
  const h = hist(s.neighbors);
  check(h[5] === 12 && h[6] === s.n - 12, `sphere f=${f} neighbours ${JSON.stringify(h)}`);
  check(symmetric(s.neighbors), 'sphere symmetric');
  // polygons CCW from outside
  let bad = 0;
  for (let c = 0; c < s.n; c++) {
    const p = s.polys[c];
    const a = [...s.corners.slice(p[0] * 3, p[0] * 3 + 3)], b = [...s.corners.slice(p[1] * 3, p[1] * 3 + 3)];
    const ctr = [...s.centers.slice(c * 3, c * 3 + 3)];
    const e1 = [a[0] - ctr[0], a[1] - ctr[1], a[2] - ctr[2]], e2 = [b[0] - ctr[0], b[1] - ctr[1], b[2] - ctr[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * ctr[0] + cr[1] * ctr[1] + cr[2] * ctr[2] <= 0) bad++;
  }
  check(bad === 0, `sphere f=${f} orientation bad=${bad}`);
}
for (const N of [3, 4, 6, 8]) {
  const s = makeCube(N);
  check(s.n === 6 * N * N, 'cube count');
  const h = hist(s.neighbors);
  check(h[7] === 24 && h[8] === s.n - 24, `cube N=${N} ${JSON.stringify(h)}`);
  check(symmetric(s.neighbors), 'cube symmetric');
}
{
  const s = makeTorus(24, 10);
  check(s.n === 240, 'torus count');
  check(JSON.stringify(hist(s.neighbors)) === JSON.stringify({ 8: 240 }), 'torus all 8 ' + JSON.stringify(hist(s.neighbors)));
}
{
  const s = makePlane(9, 9);
  const h = hist(s.neighbors);
  check(h[3] === 4 && h[5] === 28 && h[8] === 49, 'plane ' + JSON.stringify(h));
  // cell 0 is top-left: its neighbours are 1, 9, 10
  check(JSON.stringify([...s.neighbors[0]]) === '[1,9,10]', 'plane topleft nb ' + [...s.neighbors[0]]);
}

// --- soundness of the solver on random boards (asserting mode) ---
{
  const rng = mulberry32(42);
  const shapes = [makeSphere(5), makeCube(5), makeTorus(20, 8), makePlane(16, 16)];
  let solved = 0, total = 0;
  for (const s of shapes) {
    for (let k = 0; k < 60; k++) {
      const start = Math.floor(rng() * s.n);
      const mc = Math.round(s.n * (0.12 + rng() * 0.12));
      const mines = placeMines(s.neighbors, mc, start, rng);
      const counts = computeCounts(s.neighbors, mines);
      try {
        const r = solveFrom(s.neighbors, mines, counts, start, mc, 3, true);
        total++;
        if (r.solved) solved++;
      } catch (e) {
        check(false, 'soundness: ' + e.message);
      }
    }
  }
  console.log(`soundness ok; random boards solved without guessing: ${solved}/${total}`);
}

// --- Minefield flood fill + chord ---
{
  const s = makePlane(9, 9);
  const mines = new Uint8Array(81);
  mines[80] = 1; // bottom-right corner
  const f = new Minefield(s.neighbors, 1);
  f.setBoard(mines);
  const out = f.reveal(0);
  check(out.cells.length === 80 && f.isWon(), 'flood fill opens everything except the mine');
}
{
  const s = makePlane(5, 5);
  const mines = new Uint8Array(25);
  mines[6] = 1;
  const f = new Minefield(s.neighbors, 1);
  f.setBoard(mines);
  f.reveal(0); // count 1
  check(f.revealedCount === 1, 'number cell does not flood');
  f.toggleFlag(6);
  const out = f.chord(0);
  check(out.cells.length >= 2 && out.hit.length === 0, 'chord opens neighbours');
}

// --- hint finder ---
{
  const s = makeSphere(4);
  const rng = mulberry32(7);
  const gen = new BoardGenerator(s.neighbors, 20, 0, rng, { noGuess: true });
  const res = gen.finish(5000);
  const f = new Minefield(s.neighbors, 20);
  f.setBoard(res.mines, res.counts);
  f.reveal(0);
  let steps = 0;
  while (!f.isWon() && steps < 1000) {
    const h = findLogicalSafe(s.neighbors, f.counts, f.mineCount, f.revealed);
    if (h < 0) break;
    check(!f.mines[h], 'hint is safe');
    f.reveal(h);
    steps++;
  }
  check(!res.solved || f.isWon(), `hints alone solve a no-guess board (solved=${res.solved}, won=${f.isWon()})`);
}

// --- generation success rate and time for the campaign-sized boards ---
const specs = [
  ['Luna sphere f3 / 10', { shape: 'sphere', freq: 3 }, 10],
  ['Cube N4 / 13', { shape: 'cube', N: 4 }, 13],
  ['Sphere f4 / 24', { shape: 'sphere', freq: 4 }, 24],
  ['Torus 24x10 / 36', { shape: 'torus', U: 24, V: 10 }, 36],
  ['Asteroid f5 / 40', { shape: 'asteroid', freq: 5 }, 40],
  ['Cube N6 / 36', { shape: 'cube', N: 6 }, 36],
  ['Sphere f6 / 60', { shape: 'sphere', freq: 6 }, 60],
  ['Torus 32x12 / 66', { shape: 'torus', U: 32, V: 12 }, 66],
  ['Sphere f8 / 112', { shape: 'sphere', freq: 8 }, 112],
  ['Sphere f9 / 150', { shape: 'sphere', freq: 9 }, 150],
  ['Classic 9x9 / 10', { shape: 'plane', W: 9, H: 9 }, 10],
  ['Classic 16x16 / 40', { shape: 'plane', W: 16, H: 16 }, 40],
  ['Classic 30x16 / 99', { shape: 'plane', W: 30, H: 16 }, 99],
  ['Sphere f10 / 200', { shape: 'sphere', freq: 10 }, 200],
];
for (const [name, spec, mines] of specs) {
  const s = makeShape(spec);
  const rng = mulberry32(123);
  let ok = 0, att = 0, ms = 0, worst = 0;
  const runs = 8;
  for (let r = 0; r < runs; r++) {
    const start = Math.floor(rng() * s.n);
    const t0 = performance.now();
    const gen = new BoardGenerator(s.neighbors, mines, start, rng, { noGuess: true, maxAttempts: 3000 });
    const res = gen.finish(4000);
    const dt = performance.now() - t0;
    ms += dt;
    worst = Math.max(worst, dt);
    att += res.attempts;
    if (res.solved) ok++;
  }
  console.log(
    `${name.padEnd(22)} cells=${String(s.n).padStart(4)} density=${((100 * mines) / s.n).toFixed(1)}% solved ${ok}/${runs} avgAttempts=${(att / runs).toFixed(1)} avg=${(ms / runs).toFixed(0)}ms worst=${worst.toFixed(0)}ms`
  );
}

console.log(failures ? `${failures} FAILURES` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);

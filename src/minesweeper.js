// Minesweeper rules on an arbitrary neighbour graph + a logic solver used for
// "no-guess" board generation and for hints.

export function computeCounts(nb, mines) {
  const n = nb.length;
  const counts = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    let k = 0;
    const list = nb[c];
    for (let i = 0; i < list.length; i++) k += mines[list[i]];
    counts[c] = k;
  }
  return counts;
}

export function placeMines(nb, mineCount, start, rng) {
  const n = nb.length;
  const excl = new Uint8Array(n);
  excl[start] = 1;
  for (const d of nb[start]) excl[d] = 1;
  let cand = [];
  for (let i = 0; i < n; i++) if (!excl[i]) cand.push(i);
  if (cand.length < mineCount) {
    // board too dense for a guaranteed opening: only keep the first cell safe
    cand = [];
    for (let i = 0; i < n; i++) if (i !== start) cand.push(i);
  }
  const m = Math.min(mineCount, cand.length);
  const mines = new Uint8Array(n);
  for (let k = 0; k < m; k++) {
    const j = k + Math.floor(rng() * (cand.length - k));
    const t = cand[k];
    cand[k] = cand[j];
    cand[j] = t;
    mines[cand[k]] = 1;
  }
  return mines;
}

// ---------------------------------------------------------------------------
// Logic solver. Knows only what a player would know: numbers on revealed cells.
// Rules: single-cell constraints, pairwise overlap reasoning, global mine count,
// and an exact enumeration of small frontier groups.
// ---------------------------------------------------------------------------
export class Solver {
  constructor(nb, counts, totalMines) {
    this.nb = nb;
    this.counts = counts;
    this.total = totalMines;
    this.n = nb.length;
    this.st = new Int8Array(this.n); // 0 unknown, 1 revealed (safe), 2 known mine
    this.revealed = 0;
    this.knownMines = 0;
    this.dirty = new Uint8Array(this.n);
    this.dirtyList = [];
    this.hintMode = false;
    this.found = -1;
    this.mines = null; // only used for a soundness assertion in tests
  }

  markDirty(c) {
    if (!this.dirty[c]) {
      this.dirty[c] = 1;
      this.dirtyList.push(c);
    }
  }

  // Treat cell c as revealed (flood-filling zeros like the real game).
  reveal(c) {
    if (this.st[c] !== 0) return;
    if (this.hintMode) {
      if (this.found < 0) this.found = c;
      return;
    }
    if (this.mines && this.mines[c]) throw new Error('solver unsound: revealed a mine at ' + c);
    const stack = [c];
    const { nb, st, counts } = this;
    while (stack.length) {
      const x = stack.pop();
      if (st[x] !== 0) continue;
      st[x] = 1;
      this.revealed++;
      this.markDirty(x);
      const list = nb[x];
      for (let i = 0; i < list.length; i++) this.markDirty(list[i]);
      if (counts[x] === 0) for (let i = 0; i < list.length; i++) if (st[list[i]] === 0) stack.push(list[i]);
    }
  }

  markMine(c) {
    if (this.st[c] !== 0) return;
    if (this.mines && !this.mines[c]) throw new Error('solver unsound: flagged a safe cell at ' + c);
    this.st[c] = 2;
    this.knownMines++;
    const list = this.nb[c];
    for (let i = 0; i < list.length; i++) this.markDirty(list[i]);
  }

  // Load a player's view (revealed cells only; flags are not trusted).
  loadView(revealedArr) {
    for (let c = 0; c < this.n; c++) {
      if (revealedArr[c]) {
        this.st[c] = 1;
        this.revealed++;
      }
    }
    for (let c = 0; c < this.n; c++) if (this.st[c] === 1) this.markDirty(c);
  }

  simplePass() {
    let progress = false;
    const { nb, st, counts } = this;
    while (this.dirtyList.length && this.found < 0) {
      const c = this.dirtyList.pop();
      this.dirty[c] = 0;
      if (st[c] !== 1 || counts[c] === 0) continue;
      let unk = 0, km = 0;
      const list = nb[c];
      for (let i = 0; i < list.length; i++) {
        const s = st[list[i]];
        if (s === 0) unk++;
        else if (s === 2) km++;
      }
      if (unk === 0) continue;
      const need = counts[c] - km;
      if (need === 0) {
        for (let i = 0; i < list.length; i++) if (st[list[i]] === 0) this.reveal(list[i]);
        progress = true;
      } else if (need === unk) {
        for (let i = 0; i < list.length; i++) if (st[list[i]] === 0) this.markMine(list[i]);
        progress = true;
      }
    }
    return progress;
  }

  frontierConstraints() {
    const { nb, st, counts, n } = this;
    const cons = [];
    const byCell = new Int32Array(n).fill(-1);
    for (let c = 0; c < n; c++) {
      if (st[c] !== 1 || counts[c] === 0) continue;
      const unk = [];
      let km = 0;
      for (const d of nb[c]) {
        if (st[d] === 0) unk.push(d);
        else if (st[d] === 2) km++;
      }
      if (!unk.length) continue;
      byCell[c] = cons.length;
      cons.push({ cell: c, unk, need: counts[c] - km });
    }
    return { cons, byCell };
  }

  pairPass() {
    const { nb, st } = this;
    const { cons, byCell } = this.frontierConstraints();
    if (!cons.length) return false;
    let progress = false;
    const mark = new Int32Array(this.n).fill(-1);
    for (let ai = 0; ai < cons.length && this.found < 0; ai++) {
      const A = cons[ai];
      for (const u of A.unk) mark[u] = ai;
      const seen = new Set();
      for (const u of A.unk) {
        for (const b of nb[u]) {
          const bi = byCell[b];
          if (bi < 0 || bi === ai || seen.has(bi)) continue;
          seen.add(bi);
          const B = cons[bi];
          let inter = 0;
          for (const x of B.unk) if (mark[x] === ai) inter++;
          if (!inter) continue;
          const aOnly = A.unk.length - inter;
          const bOnly = B.unk.length - inter;
          const lo = Math.max(0, A.need - aOnly, B.need - bOnly);
          const hi = Math.min(inter, A.need, B.need);
          if (lo > hi) continue; // inconsistent (cannot happen on valid boards)
          // B-only cells
          if (bOnly > 0) {
            if (B.need - lo === 0) {
              for (const x of B.unk) if (mark[x] !== ai && st[x] === 0) this.reveal(x);
              progress = true;
            } else if (B.need - hi === bOnly) {
              for (const x of B.unk) if (mark[x] !== ai && st[x] === 0) this.markMine(x);
              progress = true;
            }
          }
          if (aOnly > 0) {
            const bset = new Set(B.unk);
            if (A.need - lo === 0) {
              for (const x of A.unk) if (!bset.has(x) && st[x] === 0) this.reveal(x);
              progress = true;
            } else if (A.need - hi === aOnly) {
              for (const x of A.unk) if (!bset.has(x) && st[x] === 0) this.markMine(x);
              progress = true;
            }
          }
          if (lo === hi && (lo === 0 || lo === inter)) {
            for (const x of B.unk) {
              if (mark[x] === ai && st[x] === 0) {
                if (lo === 0) this.reveal(x);
                else this.markMine(x);
              }
            }
            progress = true;
          }
          if (this.found >= 0) return true;
        }
      }
      if (progress) return true;
    }
    return progress;
  }

  globalPass() {
    const remaining = this.total - this.knownMines;
    const unknown = this.n - this.revealed - this.knownMines;
    if (unknown <= 0) return false;
    if (remaining === 0) {
      for (let c = 0; c < this.n; c++) if (this.st[c] === 0) this.reveal(c);
      return true;
    }
    if (remaining === unknown) {
      for (let c = 0; c < this.n; c++) if (this.st[c] === 0) this.markMine(c);
      return true;
    }
    return false;
  }

  // Exact reasoning on connected groups of frontier cells (small groups only).
  enumPass(maxCells = 18) {
    const { nb, st } = this;
    const { cons } = this.frontierConstraints();
    if (!cons.length) return false;
    // group unknown frontier cells by shared constraints
    const cellCons = new Map();
    cons.forEach((k, i) => {
      for (const u of k.unk) {
        if (!cellCons.has(u)) cellCons.set(u, []);
        cellCons.get(u).push(i);
      }
    });
    const visitedCons = new Uint8Array(cons.length);
    const totalUnknown = this.n - this.revealed - this.knownMines;
    const remaining = this.total - this.knownMines;
    let progress = false;
    for (let s = 0; s < cons.length; s++) {
      if (visitedCons[s]) continue;
      const compCons = [];
      const compCells = new Set();
      const q = [s];
      visitedCons[s] = 1;
      while (q.length) {
        const ci = q.pop();
        compCons.push(ci);
        for (const u of cons[ci].unk) {
          if (compCells.has(u)) continue;
          compCells.add(u);
          for (const cj of cellCons.get(u)) if (!visitedCons[cj]) {
            visitedCons[cj] = 1;
            q.push(cj);
          }
        }
      }
      if (compCells.size > maxCells) continue;
      const cells = [...compCells];
      const idx = new Map(cells.map((c, i) => [c, i]));
      const consList = compCons.map((ci) => ({ vars: cons[ci].unk.map((u) => idx.get(u)), need: cons[ci].need }));
      // order variables so constraints close early
      const varCons = cells.map(() => []);
      consList.forEach((k, i) => k.vars.forEach((v) => varCons[v].push(i)));
      const assign = new Int8Array(cells.length).fill(-1);
      const sum = new Int32Array(consList.length);
      const left = new Int32Array(consList.length);
      consList.forEach((k, i) => (left[i] = k.vars.length));
      const mineCountsPerVar = new Float64Array(cells.length);
      const outside = totalUnknown - cells.length;
      let solutions = 0;
      let nodes = 0;
      let mineTotal = 0;
      const rec = (v) => {
        if (solutions > 4000 || ++nodes > 60000) {
          solutions = 4001;
          return;
        }
        if (v === cells.length) {
          // the mines left over must fit in the unknown cells outside this group
          const rest = remaining - mineTotal;
          if (rest < 0 || rest > outside) return;
          solutions++;
          for (let i = 0; i < cells.length; i++) if (assign[i] === 1) mineCountsPerVar[i]++;
          return;
        }
        for (let val = 0; val <= 1; val++) {
          let ok = true;
          assign[v] = val;
          mineTotal += val;
          for (const ci of varCons[v]) {
            sum[ci] += val;
            left[ci]--;
          }
          for (const ci of varCons[v]) {
            const k = consList[ci];
            if (sum[ci] > k.need || sum[ci] + left[ci] < k.need) {
              ok = false;
              break;
            }
          }
          if (ok) rec(v + 1);
          for (const ci of varCons[v]) {
            sum[ci] -= val;
            left[ci]++;
          }
          mineTotal -= val;
          assign[v] = -1;
        }
      };
      rec(0);
      if (!solutions || solutions > 4000) continue;
      for (let i = 0; i < cells.length; i++) {
        if (mineCountsPerVar[i] === 0) {
          this.reveal(cells[i]);
          progress = true;
        } else if (mineCountsPerVar[i] === solutions) {
          this.markMine(cells[i]);
          progress = true;
        }
        if (this.found >= 0) return true;
      }
      if (progress) return true;
    }
    return progress;
  }

  // Run to a fixpoint. Returns true when every safe cell is revealed.
  run(level = 3) {
    const safeTotal = this.n - this.total;
    for (let guard = 0; guard < 100000; guard++) {
      if (this.revealed >= safeTotal || this.found >= 0) break;
      if (this.simplePass()) continue;
      if (this.found >= 0) break;
      if (level >= 2 && this.pairPass()) continue;
      if (this.found >= 0) break;
      if (this.globalPass()) continue;
      if (this.found >= 0) break;
      if (level >= 3 && this.enumPass()) continue;
      break;
    }
    return this.revealed >= safeTotal;
  }
}

export function solveFrom(nb, mines, counts, start, total, level = 3, check = false) {
  const s = new Solver(nb, counts, total);
  if (check) s.mines = mines;
  s.reveal(start);
  const ok = s.run(level);
  return { solved: ok, revealed: s.revealed };
}

// A safe cell a player could deduce right now, or -1.
export function findLogicalSafe(nb, counts, total, revealedArr) {
  const s = new Solver(nb, counts, total);
  s.loadView(revealedArr);
  s.hintMode = true;
  s.run(3);
  return s.found;
}

// ---------------------------------------------------------------------------
// Incremental generator so the UI never freezes (call step() once per frame).
// ---------------------------------------------------------------------------
export class BoardGenerator {
  constructor(nb, mineCount, start, rng, { noGuess = true, maxAttempts = 1500, level = 3 } = {}) {
    this.nb = nb;
    this.mineCount = mineCount;
    this.start = start;
    this.rng = rng;
    this.noGuess = noGuess;
    this.maxAttempts = maxAttempts;
    this.level = level;
    this.attempts = 0;
    this.done = false;
    this.result = null;
    this.best = null;
    this.bestScore = -1;
  }

  step(budgetMs = 8) {
    if (this.done) return true;
    const t0 = performance.now();
    do {
      const mines = placeMines(this.nb, this.mineCount, this.start, this.rng);
      const counts = computeCounts(this.nb, mines);
      this.attempts++;
      if (!this.noGuess) {
        this.result = { mines, counts, solved: false, attempts: this.attempts };
        this.done = true;
        return true;
      }
      const res = solveFrom(this.nb, mines, counts, this.start, this.mineCount, this.level);
      if (res.solved) {
        this.result = { mines, counts, solved: true, attempts: this.attempts };
        this.done = true;
        return true;
      }
      if (res.revealed > this.bestScore) {
        this.bestScore = res.revealed;
        this.best = { mines, counts, solved: false, attempts: this.attempts };
      }
      if (this.attempts >= this.maxAttempts) {
        this.result = this.best;
        this.done = true;
        return true;
      }
    } while (performance.now() - t0 < budgetMs);
    return false;
  }

  // Finish now, spending at most budgetMs more.
  finish(budgetMs = 250) {
    if (this.done) return this.result;
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < budgetMs) this.step(budgetMs);
    if (!this.done) {
      this.result = this.best || (() => {
        const mines = placeMines(this.nb, this.mineCount, this.start, this.rng);
        return { mines, counts: computeCounts(this.nb, mines), solved: false, attempts: this.attempts };
      })();
      this.done = true;
    }
    return this.result;
  }
}

// ---------------------------------------------------------------------------
// The live game state.
// ---------------------------------------------------------------------------
export class Minefield {
  constructor(nb, mineCount) {
    this.nb = nb;
    this.n = nb.length;
    this.mineCount = mineCount;
    this.mines = new Uint8Array(this.n);
    this.counts = new Uint8Array(this.n);
    this.revealed = new Uint8Array(this.n);
    this.flags = new Uint8Array(this.n);
    this.revealedCount = 0;
    this.flagCount = 0;
    this.placed = false;
    this.lost = false;
    this.exploded = [];
  }

  setBoard(mines, counts) {
    this.mines = mines;
    this.counts = counts || computeCounts(this.nb, mines);
    this.mineCount = mines.reduce((a, b) => a + b, 0);
    this.placed = true;
  }

  get safeTotal() {
    return this.n - this.mineCount;
  }

  isWon() {
    return this.placed && !this.lost && this.revealedCount >= this.safeTotal;
  }

  flagsAround(c) {
    let k = 0;
    for (const d of this.nb[c]) k += this.flags[d];
    return k;
  }

  hiddenAround(c) {
    const out = [];
    for (const d of this.nb[c]) if (!this.revealed[d] && !this.flags[d]) out.push(d);
    return out;
  }

  // Reveal with flood fill. Returns { cells, depth, hit }.
  reveal(c, out = { cells: [], depth: [], hit: [] }, baseDepth = 0) {
    if (this.revealed[c] || this.flags[c]) return out;
    if (this.mines[c]) {
      this.revealed[c] = 1;
      out.hit.push(c);
      this.lost = true;
      this.exploded.push(c);
      return out;
    }
    const queue = [c];
    const depth = new Map([[c, baseDepth]]);
    this.revealed[c] = 1;
    this.revealedCount++;
    let head = 0;
    while (head < queue.length) {
      const x = queue[head++];
      const dx = depth.get(x);
      out.cells.push(x);
      out.depth.push(dx);
      if (this.counts[x] !== 0) continue;
      for (const y of this.nb[x]) {
        if (this.revealed[y] || this.flags[y] || this.mines[y]) continue;
        this.revealed[y] = 1;
        this.revealedCount++;
        depth.set(y, dx + 1);
        queue.push(y);
      }
    }
    return out;
  }

  // Classic "chord": clicking a satisfied number opens all its other neighbours.
  canChord(c) {
    return this.revealed[c] && !this.mines[c] && this.counts[c] > 0 && this.flagsAround(c) === this.counts[c] && this.hiddenAround(c).length > 0;
  }

  chord(c) {
    const out = { cells: [], depth: [], hit: [] };
    if (!this.canChord(c)) return out;
    for (const d of this.hiddenAround(c)) this.reveal(d, out, 1);
    return out;
  }

  toggleFlag(c) {
    if (this.revealed[c]) return this.flags[c];
    this.flags[c] ^= 1;
    this.flagCount += this.flags[c] ? 1 : -1;
    return this.flags[c];
  }

  snapshot() {
    return {
      revealed: this.revealed.slice(),
      flags: this.flags.slice(),
      revealedCount: this.revealedCount,
      flagCount: this.flagCount,
    };
  }

  restore(s) {
    this.revealed = s.revealed.slice();
    this.flags = s.flags.slice();
    this.revealedCount = s.revealedCount;
    this.flagCount = s.flagCount;
    this.lost = false;
    this.exploded = [];
  }
}

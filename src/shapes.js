// Board geometries. Every shape is a set of polygonal cells on a closed (or flat) surface.
// Two cells are neighbours when they share at least one corner, which gives:
//   hex sphere -> 6 neighbours (12 pentagons have 5)
//   cube       -> 8 (cells on a cube corner have 7)
//   torus      -> always 8, no borders at all
//   flat board -> 8 (3 in the corners, 5 on the edges), like the classic game
// Pure JS (no three.js) so it can be unit-tested in node.

import { add, sub, scale, dot, cross, normalize, len } from './util.js';

function newellNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([nx, ny, nz]);
}

function neighborsFromPolys(polys, cornerCount) {
  const byCorner = Array.from({ length: cornerCount }, () => []);
  polys.forEach((p, c) => {
    for (const v of p) byCorner[v].push(c);
  });
  return polys.map((p, c) => {
    const s = new Set();
    for (const v of p) for (const d of byCorner[v]) if (d !== c) s.add(d);
    return Int32Array.from([...s].sort((a, b) => a - b));
  });
}

function finalize(kind, corners, cornerNormals, polys, centers, opts = {}) {
  const n = polys.length;
  const C = new Float32Array(corners.length * 3);
  corners.forEach((p, i) => C.set(p, i * 3));
  const CN = new Float32Array(cornerNormals.length * 3);
  cornerNormals.forEach((p, i) => CN.set(p, i * 3));
  const centersF = new Float32Array(n * 3);
  const normalsF = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  let radius = 0;
  let sizeSum = 0;
  for (let c = 0; c < n; c++) {
    const pts = Array.from(polys[c], (v) => corners[v]);
    const ctr = centers ? centers[c] : scale(pts.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / pts.length);
    const nrm = opts.normals ? opts.normals[c] : newellNormal(pts);
    centersF.set(ctr, c * 3);
    normalsF.set(nrm, c * 3);
    let s = 0;
    for (const p of pts) {
      s += len(sub(p, ctr));
      radius = Math.max(radius, len(p));
    }
    sizes[c] = s / pts.length;
    sizeSum += sizes[c];
  }
  return {
    kind,
    n,
    corners: C,
    cornerNormals: CN,
    polys: polys.map((p) => Int32Array.from(p)),
    centers: centersF,
    normals: normalsF,
    sizes,
    avgSize: sizeSum / n,
    neighbors: neighborsFromPolys(polys, corners.length),
    radius,
    extrude: opts.extrude || 'corner', // 'corner' = per-corner normals, 'cell' = flat prism along the cell normal
    ...opts.extra,
  };
}

// ---------------------------------------------------------------------------
// Hex sphere (Goldberg polyhedron = dual of a geodesic icosphere)
// cells = 10 * f^2 + 2
// ---------------------------------------------------------------------------
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(normalize);
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function lumpField(seed) {
  const s1 = seed * 1.37 + 0.3, s2 = seed * 2.11 + 1.1, s3 = seed * 0.73 + 2.7;
  return (d) =>
    0.55 * Math.sin(2.1 * d[0] + 1.7 * d[1] + s1) * Math.cos(1.3 * d[2] - 0.7 * d[0] + s2) +
    0.3 * Math.sin(3.7 * d[1] - 2.9 * d[2] + s3) +
    0.15 * Math.sin(5.3 * d[0] + 4.1 * d[2] + s1 * 2.0);
}

export function makeSphere(freq, { lumpy = 0, seed = 1 } = {}) {
  const n = freq;
  const vmap = new Map();
  const pos = [];
  const vid = (key, p) => {
    let id = vmap.get(key);
    if (id === undefined) {
      id = pos.length;
      vmap.set(key, id);
      pos.push(normalize(p));
    }
    return id;
  };
  const edgeKey = (u, v, k) => (u < v ? `e${u}_${v}_${k}` : `e${v}_${u}_${n - k}`);
  const tris = [];
  for (let f = 0; f < ICO_F.length; f++) {
    let [a, b, c] = ICO_F[f];
    {
      const A = ICO_V[a], B = ICO_V[b], Cc = ICO_V[c];
      const nn = cross(sub(B, A), sub(Cc, A));
      if (dot(nn, add(add(A, B), Cc)) < 0) [b, c] = [c, b];
    }
    const A = ICO_V[a], B = ICO_V[b], Cc = ICO_V[c];
    const grid = [];
    for (let i = 0; i <= n; i++) {
      grid[i] = [];
      for (let j = 0; i + j <= n; j++) {
        let key;
        if (i === 0 && j === 0) key = 'v' + a;
        else if (i === n && j === 0) key = 'v' + b;
        else if (i === 0 && j === n) key = 'v' + c;
        else if (j === 0) key = edgeKey(a, b, i);
        else if (i === 0) key = edgeKey(a, c, j);
        else if (i + j === n) key = edgeKey(b, c, j);
        else key = `f${f}_${i}_${j}`;
        const wa = 1 - (i + j) / n, wb = i / n, wc = j / n;
        const p = [
          A[0] * wa + B[0] * wb + Cc[0] * wc,
          A[1] * wa + B[1] * wb + Cc[1] * wc,
          A[2] * wa + B[2] * wb + Cc[2] * wc,
        ];
        grid[i][j] = vid(key, p);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) {
        tris.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
        if (i + j < n - 1) tris.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
      }
    }
  }

  const field = lumpy ? lumpField(seed) : null;
  const radiusAt = (d) => (field ? 1 + lumpy * field(d) : 1);

  // polygon corners = centroids of the geodesic triangles
  const triDir = tris.map(([x, y, z]) => normalize(add(add(pos[x], pos[y]), pos[z])));
  const corners = triDir.map((d) => scale(d, radiusAt(d)));
  const cornerNormals = triDir;

  const inc = Array.from({ length: pos.length }, () => []);
  tris.forEach((t, ti) => {
    inc[t[0]].push(ti);
    inc[t[1]].push(ti);
    inc[t[2]].push(ti);
  });

  const polys = [];
  const centers = [];
  for (let v = 0; v < pos.length; v++) {
    const nrm = pos[v];
    const t1 = normalize(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const t2 = cross(nrm, t1);
    const list = inc[v].map((ti) => {
      const p = triDir[ti];
      return { ti, ang: Math.atan2(dot(p, t2), dot(p, t1)) };
    });
    list.sort((p, q) => p.ang - q.ang);
    polys.push(list.map((o) => o.ti));
    centers.push(scale(nrm, radiusAt(nrm)));
  }
  return finalize(lumpy ? 'asteroid' : 'sphere', corners, cornerNormals, polys, centers, {
    extrude: 'corner',
    extra: { freq },
  });
}

// ---------------------------------------------------------------------------
// Cube: N x N cells on each of the 6 faces (Rubik-like)
// ---------------------------------------------------------------------------
export function makeCube(N, half = 0.74) {
  const faces = [
    { k: 0, s: 1, ua: 1, va: 2 },
    { k: 0, s: -1, ua: 2, va: 1 },
    { k: 1, s: 1, ua: 2, va: 0 },
    { k: 1, s: -1, ua: 0, va: 2 },
    { k: 2, s: 1, ua: 0, va: 1 },
    { k: 2, s: -1, ua: 1, va: 0 },
  ];
  const vmap = new Map();
  const corners = [];
  const cornerNormals = [];
  const vid = (lat) => {
    const key = lat[0] + (N + 1) * (lat[1] + (N + 1) * lat[2]);
    let id = vmap.get(key);
    if (id === undefined) {
      id = corners.length;
      vmap.set(key, id);
      corners.push(lat.map((q) => (q / N - 0.5) * 2 * half));
      cornerNormals.push(normalize(lat.map((q) => q / N - 0.5)));
    }
    return id;
  };
  const polys = [];
  const normals = [];
  for (const f of faces) {
    const nrm = [0, 0, 0];
    nrm[f.k] = f.s;
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        const pt = (aa, bb) => {
          const lat = [0, 0, 0];
          lat[f.k] = f.s > 0 ? N : 0;
          lat[f.ua] = aa;
          lat[f.va] = bb;
          return vid(lat);
        };
        polys.push([pt(a, b), pt(a + 1, b), pt(a + 1, b + 1), pt(a, b + 1)]);
        normals.push(nrm);
      }
    }
  }
  return finalize('cube', corners, cornerNormals, polys, null, { extrude: 'cell', normals, extra: { N } });
}

// ---------------------------------------------------------------------------
// Torus: U cells around the ring, V around the tube. Wraps both ways.
// ---------------------------------------------------------------------------
export function makeTorus(U, V, R = 0.8, r = 0.34) {
  const P = (i, j) => {
    const th = (2 * Math.PI * i) / U, ph = (2 * Math.PI * j) / V;
    return [(R + r * Math.cos(ph)) * Math.cos(th), (R + r * Math.cos(ph)) * Math.sin(th), r * Math.sin(ph)];
  };
  const Nrm = (i, j) => {
    const th = (2 * Math.PI * i) / U, ph = (2 * Math.PI * j) / V;
    return [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)];
  };
  const corners = [];
  const cornerNormals = [];
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < U; i++) {
      corners.push(P(i, j));
      cornerNormals.push(Nrm(i, j));
    }
  }
  const id = (i, j) => (((i % U) + U) % U) + U * (((j % V) + V) % V);
  const polys = [];
  const centers = [];
  const normals = [];
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < U; i++) {
      polys.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
      centers.push(P(i + 0.5, j + 0.5));
      normals.push(Nrm(i + 0.5, j + 0.5));
    }
  }
  return finalize('torus', corners, cornerNormals, polys, centers, {
    extrude: 'corner',
    normals,
    extra: { U, V, R, r },
  });
}

// ---------------------------------------------------------------------------
// Flat classic board, W x H, lying in the XY plane facing +Z.
// ---------------------------------------------------------------------------
export function makePlane(W, H) {
  const s = 2 / Math.max(W, H);
  const corners = [];
  const cornerNormals = [];
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      corners.push([(x - W / 2) * s, (H / 2 - y) * s, 0]);
      cornerNormals.push([0, 0, 1]);
    }
  }
  const id = (x, y) => x + (W + 1) * y;
  const polys = [];
  const normals = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // y grows downwards on screen, so walk the corners clockwise in (x, y) = CCW seen from +Z
      polys.push([id(x, y + 1), id(x + 1, y + 1), id(x + 1, y), id(x, y)]);
      normals.push([0, 0, 1]);
    }
  }
  return finalize('plane', corners, cornerNormals, polys, null, {
    extrude: 'cell',
    normals,
    extra: { W, H, cellWorld: s, width: W * s, height: H * s },
  });
}

export function makeShape(spec) {
  switch (spec.shape) {
    case 'sphere':
      return makeSphere(spec.freq);
    case 'asteroid':
      return makeSphere(spec.freq, { lumpy: spec.lumpy ?? 0.13, seed: spec.seed ?? 3 });
    case 'cube':
      return makeCube(spec.N);
    case 'torus':
      return makeTorus(spec.U, spec.V, spec.R, spec.r);
    case 'plane':
      return makePlane(spec.W, spec.H);
    default:
      throw new Error('unknown shape ' + spec.shape);
  }
}

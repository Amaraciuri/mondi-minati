// The playable planet: one merged mesh for every tile (plates + floors), animated in the
// vertex shader from a small per-cell data texture, plus flags, mines, core glow and halo.
import * as THREE from 'three';
import { haloTexture } from './atlas.js';

export const ST = { HIDDEN: 0, OPEN: 1, FLAG: 2, MINE: 3, BOOM: 4, WRONG: 5 };

const TILE_VS = /* glsl */ `
uniform highp sampler2D uCells;
uniform float uTexW;
uniform float uTime;
uniform float uHover;
uniform vec3 uCamUpL;
attribute float aCell;
attribute float aPart;
attribute float aRad;
attribute vec3 aCenter;
attribute vec3 aNrm;
attribute float aSize;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying vec2 vTile;
flat varying float vPart;
varying float vRad;
flat varying float vState;
flat varying float vGlyph;
flat varying float vAge;
flat varying float vHover;
flat varying float vCell;
flat varying float vExtra;
flat varying float vLat;

void main() {
  ivec2 tc = ivec2(int(mod(aCell, uTexW)), int(floor(aCell / uTexW)));
  vec4 cd = texelFetch(uCells, tc, 0);
  float state = cd.r;
  float age = uTime - cd.g;
  vec3 p = position;
  bool open = state > 0.5 && state != 2.0;
  bool hov = abs(aCell - uHover) < 0.5;
  if (aPart > 0.5) {
    vec3 rel = p - aCenter;
    if (open) {
      float t = clamp(age / 0.42, 0.0, 1.0);
      float lift = sin(t * 3.14159) * 0.75 + t * 0.5;
      float s = 1.0 - smoothstep(0.05, 1.0, t);
      p = aCenter + rel * s + aNrm * aSize * lift;
      if (t >= 1.0) p = aCenter - aNrm * aSize * 0.6;
    } else {
      float t = clamp(age / 0.38, 0.0, 1.0);
      float s = 1.0 - pow(1.0 - t, 3.0);
      p = aCenter + rel * s;
      if (abs(cd.a - 1.0) < 0.1) p -= aNrm * aSize * 0.16;
      else if (hov) p += aNrm * aSize * 0.05;
    }
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);

  // glyph frame: keep numbers upright on screen
  vec3 up = uCamUpL - dot(uCamUpL, aNrm) * aNrm;
  float ul = length(up);
  up = ul > 1e-4 ? up / ul : normalize(cross(aNrm, vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(up, aNrm);
  vec3 d = position - aCenter;
  float gs = aSize * 1.5;
  vUV = vec2(dot(d, right), dot(d, up)) / gs + 0.5;

  // tile-fixed frame (patterns that must not swim when the view rotates)
  vec3 ax = abs(aNrm.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(aNrm, ax));
  vec3 t2 = cross(aNrm, t1);
  vTile = vec2(dot(d, t1), dot(d, t2)) / aSize;

  vPart = aPart;
  vRad = aRad;
  vState = state;
  vGlyph = cd.b;
  vAge = age;
  vHover = hov ? 1.0 : 0.0;
  vCell = aCell;
  vExtra = cd.a;
  vLat = aNrm.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TILE_FS = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uPlateA;
uniform vec3 uPlateB;
uniform vec3 uFloor;
uniform vec3 uRim;
uniform vec3 uFlagTint;
uniform vec3 uLightDir;
uniform vec3 uGlow;
uniform float uTime;
uniform float uBands;
uniform float uSprinkles;
uniform float uRetro;
uniform float uWinTime;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUV;
varying vec2 vTile;
flat varying float vPart;
varying float vRad;
flat varying float vState;
flat varying float vGlyph;
flat varying float vAge;
flat varying float vHover;
flat varying float vCell;
flat varying float vExtra;
flat varying float vLat;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec3 sprinkles(vec3 base, vec2 q, float seed) {
  vec3 cols[5];
  cols[0] = vec3(1.0, 0.95, 0.45); cols[1] = vec3(0.45, 0.85, 1.0); cols[2] = vec3(1.0, 1.0, 1.0);
  cols[3] = vec3(0.55, 1.0, 0.6); cols[4] = vec3(1.0, 0.45, 0.35);
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float h1 = hash11(seed * 13.7 + fk * 3.1), h2 = hash11(seed * 7.3 + fk * 5.7);
    float h3 = hash11(seed * 3.9 + fk * 9.1);
    vec2 c = (vec2(h1, h2) - 0.5) * 1.05;
    float a = h3 * 6.2831;
    vec2 d = q - c;
    d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
    d.x -= clamp(d.x, -0.11, 0.11);
    float m = 1.0 - smoothstep(0.035, 0.055, length(d));
    base = mix(base, cols[int(mod(fk + seed * 5.0, 5.0))], m);
  }
  return base;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float seed = hash11(floor(vCell + 0.5) * 1.618 + 0.5);
  float ndl = dot(N, uLightDir);
  float diff = clamp(ndl * 0.55 + 0.5, 0.0, 1.0);
  vec3 col;
  float spec = 0.0;
  bool flagged = abs(vState - 2.0) < 0.1;
  if (vPart < 0.5) {
    // floor
    col = uFloor * (0.9 + 0.2 * seed);
    col *= mix(1.0, uRetro > 0.5 ? 1.0 : 0.78, vRad * vRad);
    if (abs(vState - 4.0) < 0.1) col = mix(col, vec3(0.95, 0.12, 0.08), 0.9);
    if (vGlyph > 0.5) {
      vec2 uv = vUV;
      if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
        vec2 cell = vec2(mod(vGlyph, 4.0), floor(vGlyph / 4.0));
        vec4 g = texture(uAtlas, (cell + vec2(uv.x, 1.0 - uv.y)) / 4.0);
        float fade = smoothstep(0.06, 0.3, vAge);
        // numbers whose mines are all flagged step back
        float dim = abs(vExtra - 3.0) < 0.1 ? (uRetro > 0.5 ? 0.55 : 0.38) : 1.0;
        col = mix(col, g.rgb, g.a * fade * dim);
      }
    }
    diff = mix(1.0, diff, 0.45);
    if (vExtra >= 10.0 && uWinTime > 0.0) {
      float w = uTime - uWinTime - (vExtra - 10.0);
      col += uGlow * exp(-w * w * 60.0) * 0.55;
    }
  } else {
    vec3 base = mix(uPlateA, uPlateB, seed);
    if (uBands > 0.5) {
      float b = sin(vLat * 13.0 + sin(vLat * 4.0) * 1.7);
      base *= 0.86 + 0.16 * b;
    }
    if (vPart < 1.5) {
      if (uSprinkles > 0.5) base = sprinkles(base, vTile, seed * 17.0 + floor(vCell + 0.5));
      col = base * (1.04 - 0.1 * vRad);
      spec = pow(max(dot(N, normalize(uLightDir + V)), 0.0), 36.0) * 0.22;
    } else if (vPart < 2.5) {
      col = base * (uRetro > 0.5 ? 1.18 : 1.1);
      spec = pow(max(dot(N, normalize(uLightDir + V)), 0.0), 24.0) * 0.3;
    } else {
      col = base * 0.58;
    }
    if (flagged) col = mix(col, uFlagTint, 0.2);
    if (vHover > 0.5) col *= 1.16;
  }
  col = col * diff + spec;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uRim * fres * (uRetro > 0.5 ? 0.0 : 0.38);
  if (abs(vExtra - 2.0) < 0.1) col += vec3(1.0, 0.82, 0.3) * (0.32 + 0.3 * sin(uTime * 9.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const CORE_VS = /* glsl */ `
varying vec3 vL;
void main() {
  vL = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CORE_FS = /* glsl */ `
uniform vec3 uCore;
uniform float uTime;
uniform float uPulse;
uniform vec3 uPulseColor;
uniform float uFreq;
varying vec3 vL;
void main() {
  vec3 q = vL * uFreq;
  float n = sin(q.x * 1.0 + uTime * 1.3) * sin(q.y * 1.2 - uTime * 1.1) * sin(q.z * 1.1 + uTime * 0.9);
  float g = 0.8 + 0.3 * n;
  vec3 c = mix(uCore * g, uPulseColor, clamp(uPulse, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

const PROP_VS = /* glsl */ `
attribute vec3 aColor;
attribute float aWave;
attribute float aEmit;
uniform float uTime;
uniform float uWave;
varying vec3 vColor;
varying vec3 vNw;
varying vec3 vW;
varying float vEmit;
varying float vCloth;
void main() {
  vec3 p = position;
#ifdef USE_INSTANCING
  float ph = float(gl_InstanceID) * 1.37;
  mat4 m = modelMatrix * instanceMatrix;
#else
  float ph = 0.0;
  mat4 m = modelMatrix;
#endif
  float w = aWave * uWave;
  p.z += sin(uTime * 6.5 + p.x * 10.0 + ph) * 0.09 * w;
  p.y += sin(uTime * 4.0 + p.x * 7.0 + ph) * 0.025 * w;
  vec4 wp = m * vec4(p, 1.0);
  vNw = normalize(mat3(m) * normal);
  vColor = aColor;
  vEmit = aEmit;
  vCloth = step(0.001, aWave);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const PROP_FS = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uGoldColor;
uniform float uGold;
varying vec3 vColor;
varying vec3 vNw;
varying vec3 vW;
varying float vEmit;
varying float vCloth;
void main() {
  vec3 n = normalize(vNw);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  float d = clamp(dot(n, uLightDir) * 0.6 + 0.5, 0.0, 1.2);
  vec3 c = mix(vColor, uGoldColor, uGold * vCloth);
  float spec = pow(max(dot(n, normalize(uLightDir + V)), 0.0), 24.0) * 0.35;
  vec3 lit = c * d + spec;
  gl_FragColor = vec4(mix(lit, c * 1.5, vEmit), 1.0);
}
`;

const BEAM_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BEAM_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float a = 1.0 - vUv.y;
  a = a * a;
  float stripes = 0.55 + 0.45 * sin(vUv.y * 28.0 - uTime * 7.0);
  gl_FragColor = vec4(uColor * a * stripes, 1.0);
}
`;

// --- helpers ---------------------------------------------------------------
const tmpV = new THREE.Vector3();

function mergeParts(parts) {
  // parts: [{ geo, color:[r,g,b], wave: number|fn(x,y,z), emit }]
  const pos = [], nrm = [], col = [], wav = [], emi = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      pos.push(x, y, z);
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(...part.color);
      wav.push(typeof part.wave === 'function' ? part.wave(x, y, z) : part.wave || 0);
      emi.push(part.emit || 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWave', new THREE.Float32BufferAttribute(wav, 1));
  geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(emi, 1));
  return geo;
}

const hex3 = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

function flagGeometry(clothHex, poleHex) {
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6, 1);
  pole.translate(0, 0.5, 0);
  const ball = new THREE.SphereGeometry(0.075, 10, 8);
  ball.translate(0, 1.02, 0);
  // pennant, subdivided so it can wave
  const segs = 7, L = 0.62;
  const cp = [], cn = [];
  for (let i = 0; i < segs; i++) {
    const x0 = (i / segs) * L, x1 = ((i + 1) / segs) * L;
    const t0 = x0 / L, t1 = x1 / L;
    const top0 = 0.98 - t0 * 0.2, bot0 = 0.56 + t0 * 0.2;
    const top1 = 0.98 - t1 * 0.2, bot1 = 0.56 + t1 * 0.2;
    cp.push(x0, bot0, 0, x1, bot1, 0, x1, top1, 0, x0, bot0, 0, x1, top1, 0, x0, top0, 0);
    for (let k = 0; k < 6; k++) cn.push(0, 0, 1);
  }
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cloth.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
  return mergeParts([
    { geo: pole, color: hex3(poleHex) },
    { geo: ball, color: hex3('#ffd36b'), emit: 0.25 },
    { geo: cloth, color: hex3(clothHex), wave: (x) => x / L },
  ]);
}

function mineGeometry(retro) {
  const body = new THREE.IcosahedronGeometry(0.4, 1);
  const parts = [{ geo: body, color: hex3(retro ? '#151515' : '#2b2f3a') }];
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const p = ico.attributes.position;
  const seen = new Set();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const key = v.toArray().map((q) => q.toFixed(3)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const cone = new THREE.ConeGeometry(0.085, 0.3, 6);
    cone.translate(0, 0.5, 0);
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, v));
    parts.push({ geo: cone, color: hex3(retro ? '#333333' : '#6d7586') });
  }
  const lamp = new THREE.SphereGeometry(0.12, 10, 8);
  lamp.translate(0, 0.38, 0.12);
  parts.push({ geo: lamp, color: hex3('#ff3b2f'), emit: 1 });
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
export class PlanetView {
  constructor(shape, theme, atlas, renderer) {
    this.shape = shape;
    this.theme = theme;
    this.n = shape.n;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.texW = 64;
    this.texH = Math.max(1, Math.ceil(this.n / 64));
    this.cellData = new Float32Array(this.texW * this.texH * 4);
    for (let c = 0; c < this.n; c++) this.cellData[c * 4 + 1] = -1000;
    this.cellTex = new THREE.DataTexture(this.cellData, this.texW, this.texH, THREE.RGBAFormat, THREE.FloatType);
    this.cellTex.minFilter = this.cellTex.magFilter = THREE.NearestFilter;
    this.cellTex.generateMipmaps = false;
    this.cellTex.needsUpdate = true;
    this.plateH = shape.kind === 'plane' ? 0.3 : 0.34;
    this.time = 0;
    this.flagAnims = new Map();
    this.mineAnims = new Map();
    this.flagShown = new Uint8Array(this.n);
    this.lightDir = new THREE.Vector3(-0.42, 0.72, 0.55).normalize();
    this._buildTiles(atlas);
    this._buildCore();
    this._buildPick();
    this._buildProps();
  }

  corner(v, out) {
    const C = this.shape.corners;
    return out.set(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
  }
  cornerNormal(v, out) {
    const C = this.shape.cornerNormals;
    return out.set(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
  }
  center(c, out = new THREE.Vector3()) {
    const C = this.shape.centers;
    return out.set(C[c * 3], C[c * 3 + 1], C[c * 3 + 2]);
  }
  normal(c, out = new THREE.Vector3()) {
    const C = this.shape.normals;
    return out.set(C[c * 3], C[c * 3 + 1], C[c * 3 + 2]);
  }

  _ext(c, v, out) {
    if (this.shape.extrude === 'corner') return this.cornerNormal(v, out);
    return this.normal(c, out);
  }

  _buildTiles(atlas) {
    const { shape } = this;
    const P = [], NN = [], CELL = [], PART = [], RAD = [], CEN = [], NRM = [], SIZE = [], IDX = [];
    let vc = 0;
    let ctr, cn, size, cell;
    const vert = (p, n, part, rad) => {
      P.push(p.x, p.y, p.z);
      NN.push(n.x, n.y, n.z);
      CELL.push(cell);
      PART.push(part);
      RAD.push(rad);
      CEN.push(ctr.x, ctr.y, ctr.z);
      NRM.push(cn.x, cn.y, cn.z);
      SIZE.push(size);
      return vc++;
    };
    const quadNormal = (a, b, c2, d) => {
      const n = new THREE.Vector3();
      const pts = [a, b, c2, d];
      for (let i = 0; i < 4; i++) {
        const u = pts[i], w = pts[(i + 1) % 4];
        n.x += (u.y - w.y) * (u.z + w.z);
        n.y += (u.z - w.z) * (u.x + w.x);
        n.z += (u.x - w.x) * (u.y + w.y);
      }
      return n.normalize();
    };
    const gap = shape.kind === 'plane' ? 0.93 : 0.9;
    const innerK = shape.kind === 'plane' ? 0.8 : 0.74;
    const outerH = 0.68;
    const floorK = shape.kind === 'plane' ? 0.97 : 0.955;
    for (cell = 0; cell < shape.n; cell++) {
      ctr = this.center(cell, new THREE.Vector3());
      cn = this.normal(cell, new THREE.Vector3());
      size = shape.sizes[cell];
      const H = size * this.plateH;
      const eps = size * 0.006;
      const poly = shape.polys[cell];
      const m = poly.length;
      const Pk = [], Ek = [];
      for (let k = 0; k < m; k++) {
        Pk.push(this.corner(poly[k], new THREE.Vector3()));
        Ek.push(this._ext(cell, poly[k], new THREE.Vector3()));
      }
      // floor
      const fc = vert(ctr.clone().addScaledVector(cn, eps), cn, 0, 0);
      const fr = Pk.map((p, k) => vert(p.clone().sub(ctr).multiplyScalar(floorK).add(ctr).addScaledVector(Ek[k], eps), cn, 0, 1));
      for (let k = 0; k < m; k++) IDX.push(fc, fr[k], fr[(k + 1) % m]);
      // plate rings
      const Q = Pk.map((p) => p.clone().sub(ctr).multiplyScalar(gap).add(ctr));
      const O = Q.map((q, k) => q.clone().addScaledVector(Ek[k], H * outerH));
      const I = Pk.map((p) => p.clone().sub(ctr).multiplyScalar(gap * innerK).add(ctr).addScaledVector(cn, H));
      const T = ctr.clone().addScaledVector(cn, H);
      const tc = vert(T, cn, 1, 0);
      const ti = I.map((p) => vert(p, cn, 1, 1));
      for (let k = 0; k < m; k++) IDX.push(tc, ti[k], ti[(k + 1) % m]);
      for (let k = 0; k < m; k++) {
        const k1 = (k + 1) % m;
        const nb = quadNormal(O[k], O[k1], I[k1], I[k]);
        const a = vert(O[k], nb, 2, 1), b = vert(O[k1], nb, 2, 1), c2 = vert(I[k1], nb, 2, 1), d = vert(I[k], nb, 2, 1);
        IDX.push(a, b, c2, a, c2, d);
        const nw = quadNormal(Q[k], Q[k1], O[k1], O[k]);
        const a2 = vert(Q[k], nw, 3, 1), b2 = vert(Q[k1], nw, 3, 1), c3 = vert(O[k1], nw, 3, 1), d2 = vert(O[k], nw, 3, 1);
        IDX.push(a2, b2, c3, a2, c3, d2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(NN, 3));
    geo.setAttribute('aCell', new THREE.Float32BufferAttribute(CELL, 1));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
    geo.setAttribute('aRad', new THREE.Float32BufferAttribute(RAD, 1));
    geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(CEN, 3));
    geo.setAttribute('aNrm', new THREE.Float32BufferAttribute(NRM, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(SIZE, 1));
    geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1));
    const th = this.theme;
    this.tileUniforms = {
      uCells: { value: this.cellTex },
      uTexW: { value: this.texW },
      uTime: { value: 0 },
      uHover: { value: -1 },
      uCamUpL: { value: new THREE.Vector3(0, 1, 0) },
      uAtlas: { value: atlas },
      uPlateA: { value: new THREE.Color(th.plateA) },
      uPlateB: { value: new THREE.Color(th.plateB) },
      uFloor: { value: new THREE.Color(th.floor) },
      uRim: { value: new THREE.Color(th.atmo) },
      uFlagTint: { value: new THREE.Color(th.flagTint || '#ff6b4a') },
      uLightDir: { value: this.lightDir },
      uGlow: { value: new THREE.Color(th.core) },
      uBands: { value: th.bands ? 1 : 0 },
      uSprinkles: { value: th.sprinkles ? 1 : 0 },
      uRetro: { value: th.retro ? 1 : 0 },
      uWinTime: { value: -1 },
    };
    this.tileMat = new THREE.ShaderMaterial({
      vertexShader: TILE_VS,
      fragmentShader: TILE_FS,
      uniforms: this.tileUniforms,
    });
    this.tiles = new THREE.Mesh(geo, this.tileMat);
    this.tiles.frustumCulled = false;
    this.group.add(this.tiles);
  }

  _buildCore() {
    const { shape } = this;
    const P = [], IDX = [];
    let vc = 0;
    const tmp = new THREE.Vector3(), e = new THREE.Vector3();
    for (let c = 0; c < shape.n; c++) {
      const ctr = this.center(c, new THREE.Vector3());
      const cn = this.normal(c, new THREE.Vector3());
      const d = shape.sizes[c] * 0.03;
      const poly = shape.polys[c];
      const base = vc;
      tmp.copy(ctr).addScaledVector(cn, -d);
      P.push(tmp.x, tmp.y, tmp.z);
      vc++;
      for (let k = 0; k < poly.length; k++) {
        this.corner(poly[k], tmp);
        this._ext(c, poly[k], e);
        tmp.addScaledVector(e, -d);
        P.push(tmp.x, tmp.y, tmp.z);
        vc++;
      }
      for (let k = 0; k < poly.length; k++) IDX.push(base, base + 1 + k, base + 1 + ((k + 1) % poly.length));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1));
    this.coreUniforms = {
      uCore: { value: new THREE.Color(this.theme.core) },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPulseColor: { value: new THREE.Color('#ff3b1f') },
      uFreq: { value: 6.0 },
    };
    this.core = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: CORE_VS, fragmentShader: CORE_FS, uniforms: this.coreUniforms })
    );
    this.core.renderOrder = 1;
    this.core.frustumCulled = false;
    this.group.add(this.core);

    if (shape.kind === 'plane') this._buildFrame();
  }

  _buildFrame() {
    const { shape } = this;
    const w = shape.width, h = shape.height;
    const s = shape.cellWorld;
    const t = s * 0.55, z = s * this.plateH * 0.75;
    const color = hex3(this.theme.frame || this.theme.plateA);
    const bar = (bw, bh, x, y) => {
      const g = new THREE.BoxGeometry(bw, bh, z);
      g.translate(x, y, z / 2 - s * 0.02);
      return { geo: g, color };
    };
    const geo = mergeParts([
      bar(w + 2 * t, t, 0, h / 2 + t / 2),
      bar(w + 2 * t, t, 0, -h / 2 - t / 2),
      bar(t, h, -w / 2 - t / 2, 0),
      bar(t, h, w / 2 + t / 2, 0),
    ]);
    const back = new THREE.PlaneGeometry(w + 2 * t, h + 2 * t);
    back.translate(0, 0, -s * 0.04);
    const backGeo = mergeParts([{ geo: back, color: hex3(this.theme.core) }]);
    this.frame = new THREE.Mesh(geo, this._propMaterial(false));
    this.frameBack = new THREE.Mesh(backGeo, this._propMaterial(false));
    this.group.add(this.frame, this.frameBack);
  }

  _buildPick() {
    const { shape } = this;
    const base = [], dir = [], triCell = [], IDX = [];
    this.pickStart = new Int32Array(shape.n);
    this.pickCount = new Int32Array(shape.n);
    let vc = 0;
    const e = new THREE.Vector3(), p = new THREE.Vector3();
    for (let c = 0; c < shape.n; c++) {
      const ctr = this.center(c, new THREE.Vector3());
      const cn = this.normal(c, new THREE.Vector3());
      const H = shape.sizes[c] * this.plateH * 0.86;
      const poly = shape.polys[c];
      const m = poly.length;
      this.pickStart[c] = vc;
      base.push(ctr.x, ctr.y, ctr.z);
      dir.push(cn.x * H, cn.y * H, cn.z * H);
      const centerIdx = vc++;
      const ring = [];
      for (let k = 0; k < m; k++) {
        this.corner(poly[k], p);
        this._ext(c, poly[k], e);
        base.push(p.x, p.y, p.z);
        dir.push(e.x * H, e.y * H, e.z * H);
        ring.push(vc++);
      }
      const bottom = [];
      for (let k = 0; k < m; k++) {
        this.corner(poly[k], p);
        base.push(p.x, p.y, p.z);
        dir.push(0, 0, 0);
        bottom.push(vc++);
      }
      for (let k = 0; k < m; k++) {
        const k1 = (k + 1) % m;
        IDX.push(centerIdx, ring[k], ring[k1]);
        triCell.push(c);
        IDX.push(bottom[k], bottom[k1], ring[k1], bottom[k], ring[k1], ring[k]);
        triCell.push(c, c);
      }
      this.pickCount[c] = vc - this.pickStart[c];
    }
    this.pickBase = new Float32Array(base);
    this.pickDir = new Float32Array(dir);
    const pos = new Float32Array(base.length);
    for (let i = 0; i < pos.length; i++) pos[i] = this.pickBase[i] + this.pickDir[i];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.triCell = Int32Array.from(triCell);
    this.pickMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    this.pickMesh.matrixAutoUpdate = false;
    this.pickRaised = new Uint8Array(shape.n).fill(1);
  }

  setPickRaised(c, raised) {
    if (this.pickRaised[c] === (raised ? 1 : 0)) return;
    this.pickRaised[c] = raised ? 1 : 0;
    const f = raised ? 1 : 0.03;
    const pos = this.pickMesh.geometry.attributes.position;
    const arr = pos.array;
    const s = this.pickStart[c], cnt = this.pickCount[c];
    for (let i = s * 3; i < (s + cnt) * 3; i++) arr[i] = this.pickBase[i] + this.pickDir[i] * f;
    pos.needsUpdate = true;
  }

  pick(raycaster) {
    this.pickMesh.matrixWorld.copy(this.group.matrixWorld);
    const hits = raycaster.intersectObject(this.pickMesh, false);
    if (!hits.length) return -1;
    return this.triCell[hits[0].faceIndex];
  }

  _propMaterial(instanced, opts = {}) {
    const m = new THREE.ShaderMaterial({
      vertexShader: PROP_VS,
      fragmentShader: PROP_FS,
      side: opts.side ?? THREE.FrontSide,
      uniforms: {
        uTime: this.tileUniforms.uTime,
        uWave: { value: opts.wave ?? 0 },
        uLightDir: { value: this.lightDir },
        uGoldColor: { value: new THREE.Color('#ffcc33') },
        uGold: { value: 0 },
      },
    });
    return m;
  }

  _buildProps() {
    const th = this.theme;
    const n = this.n;
    this.flagMat = this._propMaterial(true, { side: THREE.DoubleSide, wave: 1 });
    this.flags = new THREE.InstancedMesh(flagGeometry(th.flag || '#ff3b3b', th.retro ? '#222222' : '#e8edf5'), this.flagMat, n);
    this.flags.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flags.frustumCulled = false;
    this.mineMat = this._propMaterial(true);
    this.mines = new THREE.InstancedMesh(mineGeometry(!!th.retro), this.mineMat, n);
    this.mines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mines.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let c = 0; c < n; c++) {
      this.flags.setMatrixAt(c, zero);
      this.mines.setMatrixAt(c, zero);
    }
    this.group.add(this.flags, this.mines);

    if (this.shape.kind !== 'plane') {
      this.halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture(),
          color: new THREE.Color(th.atmo),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: th.haloOpacity ?? 0.5,
        })
      );
      const r = this.shape.radius;
      this.halo.scale.set(r * 3.3, r * 3.3, 1);
      this.halo.renderOrder = 5;
      this.group.add(this.halo);
    }
    // optional decorative ring (gas giants)
    if (th.rings) {
      const rg = new THREE.RingGeometry(this.shape.radius * 1.35, this.shape.radius * 2.05, 96, 1);
      const pos = rg.attributes.position;
      const cols = [];
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        const t = (r - this.shape.radius * 1.35) / (this.shape.radius * 0.7);
        const band = 0.55 + 0.45 * Math.sin(t * 22.0) * Math.sin(t * 7.0 + 1.0);
        cols.push(band);
      }
      rg.setAttribute('aBand', new THREE.Float32BufferAttribute(cols, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(th.ringColor || th.atmo) }, uR: { value: this.shape.radius * 1.08 } },
        vertexShader: `attribute float aBand; varying float vB; varying vec3 vW; varying vec3 vC; varying float vS;
          void main(){ vB = aBand; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
            vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vS = length(modelMatrix[0].xyz);
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        // fade the ring wherever it passes in front of the planet, so it never hides tiles
        fragmentShader: `uniform vec3 uColor; uniform float uR; varying float vB; varying vec3 vW; varying vec3 vC; varying float vS;
          void main(){
            vec3 c = vC;
            vec3 d = normalize(vW - cameraPosition);
            vec3 oc = c - cameraPosition;
            float tca = dot(oc, d);
            float d2 = dot(oc, oc) - tca * tca;
            float r = uR * vS;
            float cover = (tca > 0.0) ? 1.0 - smoothstep(r * r * 0.92, r * r * 1.08, d2) : 0.0;
            gl_FragColor = vec4(uColor * vB * 0.55 * (1.0 - 0.88 * cover), 1.0);
          }`,
      });
      this.ring = new THREE.Mesh(rg, mat);
      this.ring.rotation.x = Math.PI / 2 - 0.35;
      this.ring.renderOrder = 6;
      this.group.add(this.ring);
    }
  }

  // world-space position of a point above the cell
  cellWorld(c, lift = 0, out = new THREE.Vector3()) {
    const ctr = this.center(c, out);
    const nrm = this.normal(c, tmpV);
    ctr.addScaledVector(nrm, this.shape.sizes[c] * lift);
    return ctr.applyMatrix4(this.group.matrixWorld);
  }

  setCell(c, state, glyph = 0, t0 = null) {
    const i = c * 4;
    if (t0 === null) {
      const isOpen = (s) => s !== ST.HIDDEN && s !== ST.FLAG;
      t0 = isOpen(this.cellData[i]) !== isOpen(state) ? this.time : this.cellData[i + 1];
    }
    this.cellData[i] = state;
    this.cellData[i + 1] = t0;
    this.cellData[i + 2] = glyph;
    this.dirty = true;
    this.setPickRaised(c, state === ST.HIDDEN || state === ST.FLAG);
  }

  setExtra(c, v) {
    if (c < 0) return;
    const i = c * 4 + 3;
    if (this.cellData[i] !== v) {
      this.cellData[i] = v;
      this.dirty = true;
    }
  }

  getState(c) {
    return this.cellData[c * 4];
  }

  setHover(c) {
    this.tileUniforms.uHover.value = c;
  }

  // plates assemble in a sweep (level intro)
  introSweep(delayFn) {
    for (let c = 0; c < this.n; c++) {
      if (this.cellData[c * 4] === ST.HIDDEN || this.cellData[c * 4] === ST.FLAG) this.cellData[c * 4 + 1] = this.time + delayFn(c);
    }
    this.dirty = true;
  }

  _flagMatrix(c, s, out) {
    const ctr = this.center(c, new THREE.Vector3());
    const nrm = this.normal(c, new THREE.Vector3());
    const size = this.shape.sizes[c];
    ctr.addScaledVector(nrm, size * this.plateH * 0.9);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    const k = size * 1.15 * s;
    return out.compose(ctr, q, new THREE.Vector3(k, k, k));
  }

  showFlag(c, on, animate = true) {
    if (!!this.flagShown[c] === on) return;
    this.flagShown[c] = on ? 1 : 0;
    if (animate) this.flagAnims.set(c, { t0: this.time, on });
    else {
      const m = new THREE.Matrix4();
      if (on) this._flagMatrix(c, 1, m);
      else m.makeScale(0, 0, 0);
      this.flags.setMatrixAt(c, m);
      this.flags.instanceMatrix.needsUpdate = true;
    }
  }

  showMine(c, delay = 0) {
    this.mineAnims.set(c, { t0: this.time + delay });
  }

  hideAllMines() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let c = 0; c < this.n; c++) this.mines.setMatrixAt(c, zero);
    this.mines.instanceMatrix.needsUpdate = true;
    this.mineAnims.clear();
  }

  setGold(v) {
    this.flagMat.uniforms.uGold.value = v;
  }

  setBeacon(c, color = '#9ff7ff') {
    if (this.beacon) {
      this.group.remove(this.beacon);
      this.beacon.geometry.dispose();
      this.beacon = null;
    }
    if (c < 0) return;
    const size = this.shape.sizes[c];
    const g = new THREE.CylinderGeometry(size * 0.55, size * 0.75, size * 7, 24, 1, true);
    g.translate(0, size * 3.5, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.tileUniforms.uTime, uColor: { value: new THREE.Color(color) } },
    });
    const mesh = new THREE.Mesh(g, mat);
    const ctr = this.center(c, new THREE.Vector3());
    const nrm = this.normal(c, new THREE.Vector3());
    mesh.position.copy(ctr);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    mesh.renderOrder = 7;
    this.beacon = mesh;
    this.group.add(mesh);
  }

  update(time, camera) {
    this.time = time;
    this.tileUniforms.uTime.value = time;
    this.coreUniforms.uTime.value = time;
    // camera up in planet-local space
    const qInv = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.tileUniforms.uCamUpL.value.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(qInv).normalize();
    if (this.dirty) {
      this.cellTex.needsUpdate = true;
      this.dirty = false;
    }
    const m = new THREE.Matrix4();
    if (this.flagAnims.size) {
      for (const [c, a] of this.flagAnims) {
        const t = Math.min(1, (time - a.t0) / (a.on ? 0.32 : 0.18));
        let s;
        if (a.on) {
          const k = 1.70158 * 1.6;
          s = 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
        } else s = 1 - t;
        if (s <= 0.0001) m.makeScale(0, 0, 0);
        else this._flagMatrix(c, s, m);
        this.flags.setMatrixAt(c, m);
        if (t >= 1) this.flagAnims.delete(c);
      }
      this.flags.instanceMatrix.needsUpdate = true;
    }
    if (this.mineAnims.size) {
      const q = new THREE.Quaternion();
      for (const [c, a] of this.mineAnims) {
        const t = Math.max(0, Math.min(1, (time - a.t0) / 0.45));
        const k = 2.2;
        const s = t <= 0 ? 0 : 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
        const ctr = this.center(c, new THREE.Vector3());
        const nrm = this.normal(c, new THREE.Vector3());
        const size = this.shape.sizes[c];
        ctr.addScaledVector(nrm, size * 0.42);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
        const sc = size * 1.05 * Math.max(0, s);
        m.compose(ctr, q, new THREE.Vector3(sc, sc, sc));
        this.mines.setMatrixAt(c, m);
        if (t >= 1) this.mineAnims.delete(c);
      }
      this.mines.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    this.pickMesh.geometry.dispose();
    this.cellTex.dispose();
    if (this.halo) this.halo.material.dispose();
  }
}

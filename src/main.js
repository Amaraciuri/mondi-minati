import * as THREE from 'three';
import { makeShape } from './shapes.js';
import { Minefield, BoardGenerator, findLogicalSafe, computeCounts, placeMines } from './minesweeper.js';
import { PlanetView, ST } from './render/planet.js';
import { makeAtlas, GLYPH } from './render/atlas.js';
import { Starfield, Particles, makeNebula } from './render/fx.js';
import { MapView } from './render/map.js';
import { Rig } from './rig.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { THEMES, CAMPAIGN, CLASSIC_LEVELS, CUSTOM_SIZES, CUSTOM_DENSITY, SHAPE_LABEL, campaignLevel, classicLevel, customLevel, dailyLevel, cellCountOf } from './levels.js';
import { t, L, setLang, getLang, detectLang } from './i18n.js';
import { $, ICON, setLed, setFace, toast, hideToast, banner, openModal, closeModal, modalOpen, starsHTML, starSVG, esc } from './ui.js';
import { mulberry32, formatTime, todayKey, clamp, easeOutBack, easeOutCubic } from './util.js';

THREE.ColorManagement.enabled = false;
const mark = (n) => {
  try {
    performance.mark('mm:' + n);
  } catch (e) {
    /* marks are optional */
  }
};
mark('eval');
// tell the page loader (index.html) that the game code is running
const progress = (p, stage) => {
  try {
    window.__mmProgress?.(p, stage);
  } catch (e) {
    /* no loader on this page */
  }
};
window.__mmStarted = true;
progress(0.74, 1);

// ============================================================ storage
const STORE_KEY = 'mondi-minati-v1';
function defaults() {
  return {
    // lang is only used once the player picks one (langChosen); until then it follows the device
    settings: { sfx: true, music: true, haptics: true, noGuess: true, lang: 'en', langChosen: false },
    campaign: { unlocked: 1, worlds: {} },
    classic: {},
    custom: {},
    daily: {},
    seen: {},
    customPick: { shape: 'sphere', size: 1, dens: 1 },
    current: null,
  };
}
function loadStore() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      ...d,
      ...s,
      settings: { ...d.settings, ...(s.settings || {}) },
      campaign: { ...d.campaign, ...(s.campaign || {}) },
      seen: { ...(s.seen || {}) },
      customPick: { ...d.customPick, ...(s.customPick || {}) },
    };
  } catch (e) {
    return d;
  }
}
const store = loadStore();
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    /* storage unavailable: progress lives for this session only */
  }
}
const effectiveLang = () => (store.settings.langChosen ? store.settings.lang : detectLang());
setLang(effectiveLang());

function chooseLang(l) {
  store.settings.lang = l;
  store.settings.langChosen = true;
  setLang(l);
  saveStore();
}

// ============================================================ renderer & scene
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('loadingText').textContent = t('webglError');
  throw e;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x05070d, 1);
let pr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pr);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
const rig = new Rig(camera);
const stars = new Starfield();
scene.add(stars.points);
const particles = new Particles(1600);
scene.add(particles.points);
const sound = new Sound();
sound.sfxOn = store.settings.sfx;
sound.musicOn = store.settings.music;
sound.hapticsOn = store.settings.haptics;
let map = null;
const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dummy = new THREE.Group();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const atlasCache = new Map();
const fontReady = (fam) => {
  try {
    return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === fam && f.status === 'loaded');
  } catch (e) {
    return false;
  }
};
let neonHasFont = false;
function atlasFor(theme) {
  const key = theme.retro ? 'retro' : 'neon';
  if (!atlasCache.has(key)) {
    if (key === 'neon') neonHasFont = fontReady('Unbounded');
    mark('atlas-start');
    atlasCache.set(key, makeAtlas(renderer, { style: key, colors: theme.numbers, font: '"Unbounded", "Arial Black", sans-serif' }));
    mark('atlas-end');
  }
  return atlasCache.get(key);
}
// if the display font arrives late, redraw the numbers with it
try {
  document.fonts.addEventListener('loadingdone', () => {
    if (neonHasFont || !atlasCache.has('neon') || !fontReady('Unbounded')) return;
    const old = atlasCache.get('neon');
    atlasCache.delete('neon');
    const fresh = atlasFor(THEMES.moon);
    if (S.planet && !S.theme.retro) S.planet.tileUniforms.uAtlas.value = fresh;
    old.dispose();
  });
} catch (e) {
  /* FontFaceSet events unsupported */
}
const nebulaCache = new Map();
function nebulaFor(theme) {
  if (!nebulaCache.has(theme.id)) nebulaCache.set(theme.id, makeNebula(theme));
  return nebulaCache.get(theme.id);
}
const shapeCache = new Map();
function shapeFor(spec) {
  const key = JSON.stringify(spec);
  if (!shapeCache.has(key)) shapeCache.set(key, makeShape(spec));
  return shapeCache.get(key);
}

// ============================================================ state
const S = {
  screen: 'boot',
  level: null,
  theme: null,
  shape: null,
  planet: null,
  field: null,
  status: 'idle', // demo | ready | playing | won | lost
  flagMode: false,
  hintsLeft: 3,
  hintsUsed: 0,
  assisted: false,
  startTime: 0,
  elapsed: 0,
  pauses: new Set(),
  pauseStart: 0,
  pausedTotal: 0,
  undo: null,
  pressed: [],
  hover: -1,
  time: 0,
  dailyStart: -1,
  faceArmedAt: -10,
  mapSel: 0,
  swipe: 0,
  intro: null,
  lastResult: null,
};

const timed = [];
function after(sec, fn) {
  timed.push({ at: S.time + sec, fn });
}
function processTimed() {
  const due = [];
  for (let i = timed.length - 1; i >= 0; i--) {
    if (S.time >= timed[i].at) {
      due.push(timed[i]);
      timed.splice(i, 1);
    }
  }
  due.sort((a, b) => a.at - b.at).forEach((d) => d.fn());
}
const tweens = [];
function tween(dur, fn, done) {
  tweens.push({ t: 0, dur, fn, done });
}
function processTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    tw.fn(tw.t);
    if (tw.t >= 1) {
      tweens.splice(i, 1);
      tw.done?.();
    }
  }
}

// ============================================================ layout
function hudPx() {
  return S.screen === 'game' ? (isTouch ? 176 : 156) : 0;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  rig.setViewport(w, h, hudPx());
  if (S.screen === 'title') layoutTitle();
  else camera.clearViewOffset();
  if (S.shape && S.screen === 'game') rig.configure(S.shape, { touch: isTouch, keep: true });
  if (S.screen === 'title' && S.shape) demoFit(true);
  map?.resize(w, h);
}

function layoutTitle() {
  const w = window.innerWidth, h = window.innerHeight;
  const scr = $('scrTitle');
  const top = scr.querySelector('.title-top');
  const menu = scr.querySelector('.title-menu');
  if (!top || !menu) return;
  const wide = w >= 900 && w >= h;
  let cx, cy, fw, fh;
  if (wide) {
    const mr = menu.getBoundingClientRect();
    const left = mr.right + 30;
    cx = left + (w - left) / 2;
    cy = h * 0.52;
    fw = w - left;
    fh = h * 0.8;
  } else {
    const tb = top.getBoundingClientRect().bottom;
    const mt = menu.getBoundingClientRect().top;
    cx = w / 2;
    cy = (tb + mt) / 2;
    fw = w;
    fh = Math.max(140, mt - tb);
  }
  camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
  S.titleFree = { w: fw, h: fh };
}

function demoFit(instant) {
  if (!S.shape || !S.titleFree) return;
  const R = S.shape.radius * 1.2; // room for the flags sticking out
  const targetPx = 0.45 * Math.min(S.titleFree.w, S.titleFree.h);
  const th = Math.atan((targetPx / (rig.vh / 2)) * rig.tanV);
  const d = R / Math.sin(th);
  rig.R = R;
  rig.minGap = (d - R) * 0.7;
  rig.maxGap = (d - R) * 1.4;
  rig.gapTarget = d - R;
  if (instant) rig.gap = d - R;
}

// ============================================================ planet build
function disposePlanet() {
  if (S.planet) {
    scene.remove(S.planet.group);
    S.planet.dispose();
    S.planet = null;
  }
  particles.clear();
  timed.length = 0;
  tweens.length = 0;
}

function buildPlanet(levelLike) {
  disposePlanet();
  const theme = THEMES[levelLike.theme];
  const shape = shapeFor(levelLike.shape);
  const planet = new PlanetView(shape, theme, atlasFor(theme), renderer);
  planet.update(S.time, camera);
  scene.add(planet.group);
  scene.background = nebulaFor(theme);
  document.body.classList.toggle('retro', !!theme.retro);
  S.planet = planet;
  S.shape = shape;
  S.theme = theme;
  return planet;
}

function initialOrientation(shape) {
  const e = new THREE.Euler();
  if (shape.kind === 'cube') e.set(0.55, -0.72, 0);
  else if (shape.kind === 'torus') e.set(-0.62, 0.0, 0.25);
  else e.set(0.35, -0.5, 0);
  return new THREE.Quaternion().setFromEuler(e);
}

// ============================================================ title (demo planet)
function buildDemo() {
  const demo = { theme: 'moon', shape: { shape: 'sphere', freq: 4 } };
  const planet = buildPlanet(demo);
  const shape = S.shape;
  const rng = mulberry32(2024);
  const start = 40;
  const mines = placeMines(shape.neighbors, 24, start, rng);
  const f = new Minefield(shape.neighbors, 24);
  f.setBoard(mines, computeCounts(shape.neighbors, mines));
  f.reveal(start);
  // open a few more safe neighbours of the opening for a lived-in look
  for (let k = 0; k < 6; k++) {
    for (let c = 0; c < shape.n; c++) {
      if (f.revealed[c] || f.mines[c]) continue;
      if (shape.neighbors[c].some((d) => f.revealed[d] && f.counts[d] > 0) && rng() < 0.18) f.reveal(c);
    }
  }
  for (let c = 0; c < shape.n; c++) {
    if (f.revealed[c]) planet.setCell(c, ST.OPEN, f.counts[c], -1000);
    else if (f.mines[c] && shape.neighbors[c].some((d) => f.revealed[d])) {
      planet.setCell(c, ST.FLAG, 0, -1000);
      planet.showFlag(c, true, false);
    }
  }
  S.field = f;
  S.status = 'demo';
  rig.configure(shape, { touch: isTouch });
  const st = new THREE.Vector3();
  planet.normal(start, st);
  rig.q.setFromUnitVectors(st, new THREE.Vector3(0.25, 0.35, 1).normalize());
  rig.autoSpin = reduceMotion ? 0 : 0.1;
  rig.introScale = 1;
}

// ============================================================ HUD helpers
function updateCounters() {
  if (!S.field || !S.level) return;
  setLed($('mineCounter'), S.field.mineCount - S.field.flagCount, t('flag'));
  setLed($('timeCounter'), Math.floor(currentElapsed()), t('time'));
}
const realNow = () => performance.now() / 1000;
function currentElapsed() {
  if (S.status === 'playing') {
    const now = realNow();
    const pausedNow = S.pauses.size ? now - S.pauseStart : 0;
    return Math.max(0, now - S.startTime - S.pausedTotal - pausedNow);
  }
  return S.elapsed;
}
function updateModeBtn() {
  const b = $('btnMode');
  b.classList.toggle('flagging', S.flagMode);
  b.innerHTML = (S.flagMode ? ICON.flag : ICON.dig) + `<span>${S.flagMode ? t('flag') : t('dig')}</span>`;
  b.setAttribute('aria-pressed', S.flagMode ? 'true' : 'false');
}
function updateHintBtn() {
  const b = $('btnHint');
  b.innerHTML = ICON.bulb + `<span class="badge ${S.hintsLeft ? '' : 'zero'}">${S.hintsLeft}</span>`;
  b.setAttribute('aria-label', `${t('hint')} (${S.hintsLeft})`);
}
function levelKicker(level) {
  if (level.mode === 'campaign') return t('worldOf', { i: level.index + 1, n: CAMPAIGN.length });
  if (level.mode === 'classic') return t('classic');
  if (level.mode === 'daily') return t('daily');
  return t('custom');
}
function levelTitle(level) {
  if (level.mode === 'custom') return `${t('shapes')[level.shape.shape]} · ${t('sizes')[level.sizeIdx]} · ${t('diffs')[level.densIdx]}`;
  if (level.mode === 'daily') {
    try {
      return new Intl.DateTimeFormat(getLang() === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'long' }).format(new Date());
    } catch (e) {
      return level.dateKey;
    }
  }
  return L(level.name);
}
function levelTag(level) {
  if (level.mode === 'campaign') return `${level.index + 1} · ${L(level.name)}`;
  return `${levelKicker(level)} · ${levelTitle(level)}`;
}
function showHUD(on) {
  $('hud').classList.toggle('hidden', !on);
  $('tools').classList.toggle('hidden', !on);
}

// ============================================================ game lifecycle
function startLevel(level, restore = null) {
  closeModal(true);
  hideToast();
  S.screen = 'game';
  $('scrTitle').classList.add('hidden');
  $('scrMap').classList.add('hidden');
  camera.clearViewOffset();
  S.level = level;
  const planet = buildPlanet(level);
  const shape = S.shape;
  rig.setViewport(window.innerWidth, window.innerHeight, hudPx());
  rig.configure(shape, { touch: isTouch });
  rig.autoSpin = 0;
  S.field = new Minefield(shape.neighbors, level.mines);
  S.status = 'ready';
  S.flagMode = false;
  S.hintsLeft = 3;
  S.hintsUsed = 0;
  S.assisted = false;
  S.elapsed = 0;
  S.startTime = 0;
  S.pausedTotal = 0;
  S.pauses.clear();
  S.undo = null;
  S.pressed = [];
  S.dailyStart = -1;
  S.faceArmedAt = -10;
  planet.setGold(0);
  if (rig.mode === 'orbit') rig.q.copy(initialOrientation(shape));

  if (level.mode === 'daily') {
    const rng = mulberry32(level.seed);
    const start = Math.floor(rng() * shape.n);
    const gen = new BoardGenerator(shape.neighbors, level.mines, start, rng, { noGuess: true, maxAttempts: 3000 });
    const res = gen.finish(8000);
    S.field.setBoard(res.mines, res.counts);
    S.dailyStart = start;
  }

  if (restore) {
    applyRestore(restore);
  } else {
    // intro: planet grows in and its plates assemble in a sweep
    rig.introScale = 0.5;
    S.intro = { t: 0 };
    const view = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3();
    const qn = rig.mode === 'orbit' ? rig.q : new THREE.Quaternion();
    planet.introSweep((c) => {
      planet.normal(c, n).applyQuaternion(qn);
      const a = Math.acos(clamp(n.dot(view), -1, 1)) / Math.PI;
      const pos = planet.center(c);
      return 0.15 + (shape.kind === 'plane' ? (pos.x + pos.y * 0.6 + 2) * 0.16 : a * 0.75) + Math.random() * 0.06;
    });
    sound.whoosh();
    banner(levelKicker(level), levelTitle(level));
    if (S.dailyStart >= 0) {
      planet.setBeacon(S.dailyStart);
      after(1.0, () => {
        if (S.status === 'ready') {
          rig.focusLocal(planet.center(S.dailyStart), planet.normal(S.dailyStart), 0.9);
          toast(t('beacon'), 3200);
        }
      });
    }
    firstRunTips();
  }
  $('levelTag').textContent = levelTag(level);
  showHUD(true);
  setFace('smile');
  updateModeBtn();
  updateHintBtn();
  updateCounters();
  resize();
}

function firstRunTips() {
  if (store.seen.tips) return;
  store.seen.tips = true;
  saveStore();
  after(2.2, () => toast(S.shape && S.shape.kind === 'plane' ? t('tipPan') : t('tipRotate'), 2600));
  after(5.2, () => toast(isTouch ? t('tipTouch') : t('tipMouse'), 3800));
}

function ensureBoard(c) {
  const f = S.field;
  if (f.placed) return;
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  const gen = new BoardGenerator(f.nb, S.level.mines, c, rng, { noGuess: store.settings.noGuess, maxAttempts: 2500 });
  const res = gen.finish(700);
  f.setBoard(res.mines, res.counts);
}

function beginTimer() {
  if (S.status !== 'ready') return;
  S.status = 'playing';
  S.startTime = realNow();
  S.pausedTotal = 0;
  if (S.pauses.size) S.pauseStart = S.startTime;
  S.planet.setBeacon(-1);
}

function playable() {
  return S.screen === 'game' && (S.status === 'ready' || S.status === 'playing') && !modalOpen();
}

function pushUndo() {
  S.undo = S.field.snapshot();
}

function cellNormalWorld(c, out = new THREE.Vector3()) {
  return S.planet.normal(c, out).applyQuaternion(S.planet.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

function tileScale() {
  return (S.shape.avgSize / 0.1) * rig.introScale;
}

function primary(c) {
  if (c < 0 || !playable()) return;
  const f = S.field;
  sound.unlock();
  if (S.status === 'ready' && S.dailyStart >= 0 && c !== S.dailyStart && !f.revealed[c]) {
    if (S.flagMode || f.flags[c]) {
      doFlag(c);
      return;
    }
    toast(t('beacon'), 2600);
    rig.focusLocal(S.planet.center(S.dailyStart), S.planet.normal(S.dailyStart), 0.7);
    sound.denied();
    return;
  }
  if (f.revealed[c]) {
    doChord(c);
    return;
  }
  if (S.flagMode) {
    doFlag(c);
    return;
  }
  if (f.flags[c]) {
    sound.denied();
    return;
  }
  doReveal(c);
}

function secondary(c) {
  if (c < 0 || !playable()) return;
  const f = S.field;
  if (f.revealed[c]) {
    doChord(c);
    return;
  }
  if (S.flagMode) {
    // in flag mode, press-and-hold digs
    if (f.flags[c]) {
      doFlag(c);
      return;
    }
    S.flagMode = false;
    primary(c);
    S.flagMode = true;
    return;
  }
  doFlag(c);
}

function doReveal(c) {
  const f = S.field;
  if (!f.placed) ensureBoard(c);
  beginTimer();
  pushUndo();
  const out = f.reveal(c);
  applyReveal(out, c);
}

function doChord(c) {
  const f = S.field;
  if (S.status !== 'playing') return;
  if (!f.canChord(c)) {
    if (f.counts[c] > 0 && f.hiddenAround(c).length) sound.denied();
    return;
  }
  pushUndo();
  const out = f.chord(c);
  sound.chord();
  applyReveal(out, c);
}

// dim the numbers that already have all their flags
function refreshSatisfied(cells) {
  const f = S.field;
  const planet = S.planet;
  if (!f || !planet || S.status === 'won') return;
  for (const c of cells) {
    if (!f.revealed[c] || f.mines[c] || f.counts[c] === 0) continue;
    const cur = planet.cellData[c * 4 + 3];
    if (cur !== 0 && cur !== 3) continue;
    planet.setExtra(c, f.flagsAround(c) === f.counts[c] ? 3 : 0);
  }
}

function doFlag(c) {
  const f = S.field;
  if (f.revealed[c]) return;
  const on = f.toggleFlag(c);
  S.planet.setCell(c, on ? ST.FLAG : ST.HIDDEN, 0);
  S.planet.showFlag(c, !!on);
  refreshSatisfied(f.nb[c]);
  if (on) sound.flag();
  else sound.unflag();
  updateCounters();
  saveCurrentSoon();
}

function applyReveal(out, origin) {
  const planet = S.planet;
  const f = S.field;
  const now = S.time;
  let maxD = 0;
  for (let i = 0; i < out.cells.length; i++) {
    const c = out.cells[i];
    const d = Math.min(out.depth[i], 45);
    if (d > maxD) maxD = d;
    planet.setCell(c, ST.OPEN, f.counts[c], now + d * 0.03);
  }
  if (out.cells.length) {
    sound.dig(maxD + 1);
    dust(origin);
    if (out.cells.length > 12) {
      // sparkle along the cascade
      const picks = Math.min(14, Math.floor(out.cells.length / 6));
      for (let k = 0; k < picks; k++) {
        const i = Math.floor(Math.random() * out.cells.length);
        const c = out.cells[i];
        after(Math.min(out.depth[i], 45) * 0.03 + 0.1, () => sparkle(c, 4));
      }
    }
  }
  if (out.hit.length) {
    lose(out.hit);
    return;
  }
  refreshSatisfied(out.cells);
  updateCounters();
  if (f.isWon()) win(origin);
  else saveCurrentSoon();
}

// ---- particles --------------------------------------------------------------
const COL = (h) => new THREE.Color(h);
function dust(c) {
  if (!S.planet) return;
  const p = S.planet.cellWorld(c, 0.2);
  const n = cellNormalWorld(c);
  const k = tileScale();
  particles.emit(p, n, 10, {
    colors: [COL(S.theme.plateA), COL(S.theme.plateB), COL('#ffffff')],
    speed: [0.25 * k, 0.8 * k],
    life: [0.35, 0.7],
    size: [0.03 * k, 0.06 * k],
    spread: 0.9,
    gravity: 1.4 * k,
    drag: 2,
  });
}
function sparkle(c, n = 6) {
  if (!S.planet) return;
  const p = S.planet.cellWorld(c, 0.25);
  const nn = cellNormalWorld(c);
  const k = tileScale();
  particles.emit(p, nn, n, {
    colors: [COL(S.theme.core), COL('#ffffff'), COL(S.theme.atmo)],
    speed: [0.2 * k, 0.9 * k],
    life: [0.4, 0.9],
    size: [0.025 * k, 0.05 * k],
    spread: 0.7,
    gravity: 0.2 * k,
    drag: 2.4,
  });
}
function explosion(c, big = true) {
  if (!S.planet) return;
  const p = S.planet.cellWorld(c, 0.4);
  const n = cellNormalWorld(c);
  const k = tileScale();
  const m = reduceMotion ? 0.5 : 1;
  particles.emit(p, n, Math.round((big ? 90 : 26) * m), {
    colors: [COL('#fff3c4'), COL('#ffc04d'), COL('#ff7a2a'), COL('#ff3b2f')],
    speed: [0.6 * k, (big ? 2.8 : 1.6) * k],
    life: [0.45, big ? 1.2 : 0.8],
    size: [0.03 * k, (big ? 0.1 : 0.06) * k],
    spread: 1.2,
    gravity: 1.3 * k,
    drag: 2.2,
  });
  if (big) {
    particles.emit(p, n, 1, { colors: [COL('#ffe2b0')], speed: [0, 0], life: [0.28, 0.28], size: [1.2 * k, 1.2 * k], grow: 1.2 });
    particles.emit(p, n, Math.round(16 * m), {
      colors: [COL('#4a3a34'), COL('#5a4a40')],
      speed: [0.15 * k, 0.6 * k],
      life: [1.0, 1.8],
      size: [0.12 * k, 0.2 * k],
      spread: 0.8,
      gravity: 0.15 * k,
      drag: 1.4,
      grow: 1.6,
    });
  }
}

// ---- lose / win ---------------------------------------------------------------
function lose(hits) {
  const f = S.field;
  const planet = S.planet;
  S.elapsed = currentElapsed();
  S.status = 'lost';
  setFace('dead');
  const now = S.time;
  hits.forEach((c, i) => {
    planet.setCell(c, ST.BOOM, GLYPH.MINE, now);
    planet.showMine(c, 0.02);
    explosion(c, i === 0);
  });
  sound.boom();
  rig.shake = reduceMotion ? 0.25 : 1;
  const fl = $('flash');
  fl.classList.remove('boom');
  void fl.offsetWidth;
  fl.classList.add('boom');
  tween(0.25, (k) => (planet.coreUniforms.uPulse.value = k * 0.8));
  const origin = planet.cellWorld(hits[0]);
  const rest = [];
  const wrong = [];
  const tmp = new THREE.Vector3();
  for (let c = 0; c < f.n; c++) {
    if (f.mines[c] && !hits.includes(c) && !f.flags[c]) rest.push({ c, d: planet.cellWorld(c, 0, tmp).distanceTo(origin) });
    else if (f.flags[c] && !f.mines[c]) wrong.push(c);
  }
  rest.sort((a, b) => a.d - b.d);
  const step = Math.min(0.07, 1.8 / Math.max(1, rest.length));
  rest.forEach((r, i) => {
    const delay = 0.4 + i * step;
    planet.setCell(r.c, ST.MINE, GLYPH.MINE, now + delay);
    planet.showMine(r.c, delay);
    if (i < 8) {
      after(delay, () => explosion(r.c, false));
      sound.smallBoom(delay);
    }
  });
  wrong.forEach((c) => {
    planet.setCell(c, ST.WRONG, GLYPH.WRONG, now + 0.5);
    after(0.5, () => planet.showFlag(c, false));
  });
  store.current = null;
  saveStore();
  const wait = Math.min(2.6, 1.0 + rest.length * step);
  setTimeout(() => {
    if (S.status === 'lost' && S.screen === 'game') showLoseModal();
  }, wait * 1000);
}

function undoLastMove() {
  const f = S.field;
  const planet = S.planet;
  if (!S.undo) return;
  const exploded = f.exploded.slice();
  f.restore(S.undo);
  for (const c of exploded) {
    if (!f.flags[c]) f.toggleFlag(c);
  }
  planet.hideAllMines();
  const now = S.time;
  for (let c = 0; c < f.n; c++) {
    const want = f.revealed[c] ? ST.OPEN : f.flags[c] ? ST.FLAG : ST.HIDDEN;
    const cur = planet.getState(c);
    if (cur !== want) {
      const wasOpen = cur !== ST.HIDDEN && cur !== ST.FLAG;
      planet.setCell(c, want, want === ST.OPEN ? f.counts[c] : 0, wasOpen && want !== ST.OPEN ? now : null);
    }
    planet.showFlag(c, want === ST.FLAG, true);
  }
  tween(0.4, (k) => (planet.coreUniforms.uPulse.value = 0.8 * (1 - k)));
  for (let c = 0; c < f.n; c++) if (planet.cellData[c * 4 + 3] === 3) planet.setExtra(c, 0);
  S.status = 'playing';
  refreshSatisfied([...Array(f.n).keys()]);
  S.assisted = true;
  S.status = 'playing';
  S.startTime = realNow() - S.elapsed;
  S.pausedTotal = 0;
  S.pauses.clear();
  setFace('smile');
  updateCounters();
  saveCurrentSoon();
}

function win(lastCell) {
  const f = S.field;
  const planet = S.planet;
  S.elapsed = currentElapsed();
  S.status = 'won';
  setFace('cool');
  for (let c = 0; c < f.n; c++) {
    if (f.mines[c] && !f.flags[c]) {
      f.toggleFlag(c);
      planet.setCell(c, ST.FLAG, 0);
      planet.showFlag(c, true);
    }
  }
  updateCounters();
  // wave of light from the last tile
  const dist = new Int32Array(f.n).fill(-1);
  const q = [lastCell];
  dist[lastCell] = 0;
  for (let h = 0; h < q.length; h++) {
    const x = q[h];
    for (const y of f.nb[x]) if (dist[y] < 0) {
      dist[y] = dist[x] + 1;
      q.push(y);
    }
  }
  for (let c = 0; c < f.n; c++) planet.setExtra(c, 10 + Math.max(0, dist[c]) * 0.05);
  planet.tileUniforms.uWinTime.value = S.time + 0.05;
  tween(0.9, (k) => planet.setGold(k));
  sound.win();
  if (rig.mode === 'orbit') tween(1.5, (k) => (rig.autoSpin = (reduceMotion ? 0.05 : 0.22) * k));
  const opened = [];
  for (let c = 0; c < f.n; c++) if (f.revealed[c]) opened.push(c);
  for (let k = 0; k < 26; k++) {
    const c = opened[Math.floor(Math.random() * opened.length)];
    after(0.1 + Math.random() * 1.4, () => sparkle(c, 7));
  }
  const res = recordWin();
  S.lastResult = res;
  store.current = null;
  saveStore();
  setTimeout(() => {
    if (S.status === 'won' && S.screen === 'game') showWinModal(res);
  }, 1700);
}

function recordWin() {
  const L0 = S.level;
  const time = Math.round(S.elapsed * 10) / 10;
  const res = { time, record: false, stars: 0, flags: [], unlocked: null, mode: L0.mode };
  if (L0.mode === 'campaign') {
    const noHelp = S.hintsUsed === 0 && !S.assisted;
    const under = time <= L0.par;
    res.flags = [true, noHelp, under];
    res.stars = res.flags.filter(Boolean).length;
    const prev = store.campaign.worlds[L0.id] || {};
    res.record = prev.best === undefined || time < prev.best;
    res.prevBest = prev.best;
    store.campaign.worlds[L0.id] = { stars: Math.max(prev.stars || 0, res.stars), best: prev.best === undefined ? time : Math.min(prev.best, time) };
    if (L0.index + 1 >= store.campaign.unlocked && L0.index + 1 < CAMPAIGN.length) {
      store.campaign.unlocked = L0.index + 2;
      res.unlocked = L(CAMPAIGN[L0.index + 1].name);
    }
  } else {
    const bucket = L0.mode === 'classic' ? store.classic : L0.mode === 'daily' ? store.daily : store.custom;
    const key = L0.mode === 'daily' ? L0.dateKey : L0.id;
    const prev = bucket[key];
    res.record = prev === undefined || time < prev;
    res.prevBest = prev;
    bucket[key] = prev === undefined ? time : Math.min(prev, time);
  }
  return res;
}

// ---- hints ------------------------------------------------------------------
function highlight(c, sec) {
  S.planet.setExtra(c, 2);
  after(sec, () => {
    if (S.planet && S.planet.cellData[c * 4 + 3] === 2) S.planet.setExtra(c, 0);
  });
}

function useHint() {
  if (!playable()) return;
  sound.unlock();
  if (S.status === 'ready') {
    toast(S.dailyStart >= 0 ? t('beacon') : t('hintFirst'), 2600);
    if (S.dailyStart >= 0) rig.focusLocal(S.planet.center(S.dailyStart), S.planet.normal(S.dailyStart), 0.7);
    return;
  }
  if (S.hintsLeft <= 0) {
    toast(t('hintNone'));
    sound.denied();
    return;
  }
  const f = S.field;
  const planet = S.planet;
  S.hintsLeft--;
  S.hintsUsed++;
  updateHintBtn();
  sound.hint();
  let wrong = -1;
  for (let c = 0; c < f.n; c++) if (f.flags[c] && !f.mines[c]) {
    wrong = c;
    break;
  }
  if (wrong >= 0) {
    rig.focusLocal(planet.center(wrong), planet.normal(wrong));
    highlight(wrong, 3.5);
    toast(t('hintWrongFlag'), 3000);
    return;
  }
  let c = findLogicalSafe(f.nb, f.counts, f.mineCount, f.revealed);
  let msg = t('hintSafe');
  if (c < 0) {
    const cand = [];
    for (let x = 0; x < f.n; x++) {
      if (f.revealed[x] || f.mines[x] || f.flags[x]) continue;
      if (f.nb[x].some((y) => f.revealed[y])) cand.push(x);
    }
    if (!cand.length) for (let x = 0; x < f.n; x++) if (!f.revealed[x] && !f.mines[x]) cand.push(x);
    c = cand[Math.floor(Math.random() * cand.length)];
    msg = t('hintGuess');
  }
  if (c === undefined || c < 0) return;
  rig.focusLocal(planet.center(c), planet.normal(c));
  highlight(c, 1.4);
  toast(msg, 2200);
  after(0.85, () => {
    if (S.status !== 'playing' || f.revealed[c] || S.field !== f) return;
    if (f.flags[c]) {
      f.toggleFlag(c);
      planet.showFlag(c, false);
    }
    sparkle(c, 12);
    pushUndo();
    applyReveal(f.reveal(c), c);
  });
}

// ---- face / restart -----------------------------------------------------------
function onFace() {
  sound.unlock();
  if (S.screen !== 'game' || modalOpen()) return;
  const inProgress = S.status === 'playing' && S.field.revealedCount > 4;
  if (inProgress && S.time - S.faceArmedAt > 2.2) {
    S.faceArmedAt = S.time;
    toast(t('faceAgain'), 2200);
    sound.ui();
    return;
  }
  restartLevel();
}
function restartLevel() {
  if (!S.level) return;
  store.current = null;
  saveStore();
  sound.ui();
  startLevel(S.level);
}

// ---- persistence of the running game -----------------------------------------
let saveTimer = 0;
function saveCurrentSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 500);
}
function snapshotGame() {
  if (S.screen !== 'game' || !S.field || !S.field.placed || !(S.status === 'playing' || S.status === 'ready')) return null;
  const f = S.field;
  const idx = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) if (arr[i]) out.push(i);
    return out;
  };
  return {
    v: 1,
    level: S.level,
    mines: idx(f.mines),
    revealed: idx(f.revealed),
    flags: idx(f.flags),
    elapsed: currentElapsed(),
    hintsLeft: S.hintsLeft,
    hintsUsed: S.hintsUsed,
    assisted: S.assisted,
    status: S.status,
    q: rig.q.toArray(),
    gap: rig.gapTarget,
    pan: [rig.pan.x, rig.pan.y],
    dailyStart: S.dailyStart,
  };
}
function saveCurrent() {
  const snap = snapshotGame();
  store.current = snap;
  saveStore();
}
function applyRestore(r) {
  const f = S.field;
  const planet = S.planet;
  const mines = new Uint8Array(f.n);
  r.mines.forEach((i) => (mines[i] = 1));
  f.setBoard(mines, computeCounts(f.nb, mines));
  r.revealed.forEach((c) => {
    if (!f.revealed[c]) {
      f.revealed[c] = 1;
      f.revealedCount++;
    }
  });
  r.flags.forEach((c) => {
    if (!f.flags[c]) f.toggleFlag(c);
  });
  for (let c = 0; c < f.n; c++) {
    if (f.revealed[c]) planet.setCell(c, ST.OPEN, f.counts[c], -1000);
    else if (f.flags[c]) {
      planet.setCell(c, ST.FLAG, 0, -1000);
      planet.showFlag(c, true, false);
    }
  }
  refreshSatisfied([...Array(f.n).keys()]);
  S.hintsLeft = r.hintsLeft ?? 3;
  S.hintsUsed = r.hintsUsed ?? 0;
  S.assisted = !!r.assisted;
  S.dailyStart = r.dailyStart ?? -1;
  if (r.status === 'playing') {
    S.status = 'playing';
    S.startTime = realNow() - (r.elapsed || 0);
    S.pausedTotal = 0;
  }
  if (r.q && rig.mode === 'orbit') rig.q.fromArray(r.q);
  if (r.gap) rig.gapTarget = rig.gap = clamp(r.gap, rig.minGap, rig.maxGap);
  if (r.pan) rig.pan.set(r.pan[0], r.pan[1]);
  rig.introScale = 1;
  S.intro = null;
  if (S.status === 'ready' && S.dailyStart >= 0) planet.setBeacon(S.dailyStart);
}

// ============================================================ screens
function setScreen(name) {
  S.screen = name;
  $('scrTitle').classList.toggle('hidden', name !== 'title');
  $('scrMap').classList.toggle('hidden', name !== 'map');
  showHUD(name === 'game');
  if (name !== 'game') document.body.classList.remove('retro');
}

function fadeThen(fn, ms = 320) {
  const el = $('fade');
  el.classList.add('on');
  setTimeout(() => {
    fn();
    requestAnimationFrame(() => setTimeout(() => el.classList.remove('on'), 60));
  }, ms);
}

function progressText() {
  const worlds = Object.keys(store.campaign.worlds).length;
  const starsN = Object.values(store.campaign.worlds).reduce((a, w) => a + (w.stars || 0), 0);
  return t('progress', { w: worlds, s: starsN });
}

function showTitle() {
  closeModal(true);
  hideToast();
  setScreen('title');
  S.level = null;
  renderTitle();
  titleScene(false);
}

// the rotating demo planet behind the title menu
function titleScene(intro) {
  buildDemo();
  if (intro) {
    // the planet grows in once the title is already on screen
    rig.introScale = 0.55;
    S.intro = { t: 0 };
  }
  resize();
  requestAnimationFrame(() => {
    layoutTitle();
    demoFit(true);
  });
}

function renderTitle() {
  const resume = store.current && store.current.level;
  const lang = getLang();
  $('scrTitle').innerHTML = `
    <div class="title-top">
      <div>
        <p class="kicker">${esc(t('kicker'))}</p>
        <h1 class="brand"><span>${esc(t('brand1'))}</span><span class="w2">${esc(t('brand2'))}</span></h1>
        <p class="tagline">${esc(t('tagline'))}</p>
      </div>
      <div class="icons">
        <button class="ibtn" id="tSettings" type="button" aria-label="${esc(t('settings'))}">${ICON.sliders}</button>
        <button class="ibtn" id="tHelp" type="button" aria-label="${esc(t('help'))}">${ICON.help}</button>
      </div>
    </div>
    <div></div>
    <div class="title-menu">
      ${
        resume
          ? `<button class="mbtn resume" id="tResume" type="button"><span><b>${esc(t('continueGame'))}</b><small>${esc(levelTag(store.current.level))}</small></span>${ICON.resume}</button>`
          : ''
      }
      <button class="mbtn primary" id="tPlay" type="button"><span><b>${esc(t('play'))}</b><small>${esc(t('playSub'))}</small></span>${ICON.planet}</button>
      <button class="mbtn" id="tDaily" type="button"><span><b>${esc(t('daily'))}</b><small>${esc(t('dailySub'))}</small></span>${ICON.calendar}</button>
      <button class="mbtn" id="tCustom" type="button"><span><b>${esc(t('custom'))}</b><small>${esc(t('customSub'))}</small></span>${ICON.cube}</button>
      <button class="mbtn retro95" id="tClassic" type="button"><span><b>${esc(t('classic'))}</b><small>${esc(t('classicSub'))}</small></span>${ICON.grid}</button>
      <div class="progress-line"><span>${esc(progressText())}</span><button class="langpill" id="tLang" type="button" aria-label="${esc(t('language'))}"><b class="${lang === 'it' ? 'on' : ''}">IT</b><b class="${lang === 'en' ? 'on' : ''}">EN</b></button></div>
    </div>`;
  const on = (id, fn) =>
    $(id)?.addEventListener('click', () => {
      sound.unlock();
      sound.ui();
      fn();
    });
  on('tPlay', () => fadeThen(showMap));
  on('tDaily', () => fadeThen(() => startLevel(dailyLevel())));
  on('tCustom', showCustom);
  on('tClassic', showClassic);
  on('tSettings', showSettings);
  on('tHelp', showHelp);
  on('tResume', () => {
    const cur = store.current;
    fadeThen(() => startLevel(cur.level, cur));
  });
  on('tLang', () => {
    chooseLang(getLang() === 'it' ? 'en' : 'it');
    renderTitle();
    layoutTitle();
  });
}

// ---- map ------------------------------------------------------------------------
function showMap() {
  closeModal(true);
  hideToast();
  disposePlanet();
  S.planet = null;
  S.shape = null;
  S.level = null;
  setScreen('map');
  camera.clearViewOffset();
  if (!map) map = new MapView();
  map.resize(window.innerWidth, window.innerHeight);
  map.setProgress(store.campaign);
  map.fly = null;
  const firstOpen = CAMPAIGN.findIndex((w, i) => i < store.campaign.unlocked && !store.campaign.worlds[w.id]);
  const sel = S.mapSel >= 0 && S.mapSel < store.campaign.unlocked ? S.mapSel : firstOpen >= 0 ? firstOpen : store.campaign.unlocked - 1;
  S.mapSel = firstOpen >= 0 && !S.mapPicked ? firstOpen : sel;
  map.select(S.mapSel, true);
  $('scrMap').innerHTML = `
    <div class="map-top">
      <button class="ibtn" id="mBack" type="button" aria-label="${esc(t('back'))}">${ICON.back}</button>
      <div><h2>${esc(t('sector'))}</h2><div class="sub">${esc(progressText())}</div></div>
    </div>
    <div></div>
    <div class="wcard" id="wcard"></div>`;
  $('mBack').addEventListener('click', () => {
    sound.ui();
    fadeThen(showTitle);
  });
  renderWorldCard();
  if (!store.seen.story) {
    store.seen.story = true;
    saveStore();
    openModal(`<h2>${esc(t('storyTitle'))}</h2><p class="lead">${esc(t('story'))}</p><div class="actions"><button class="btn primary" id="sGo" type="button">${esc(t('storyGo'))}</button></div>`);
    $('sGo').addEventListener('click', () => {
      sound.ui();
      closeModal();
    });
  }
}

function renderWorldCard() {
  const i = S.mapSel;
  const W = CAMPAIGN[i];
  const unlocked = i < store.campaign.unlocked;
  const rec = store.campaign.worlds[W.id];
  const cells = cellCountOf(W.shape);
  $('wcard').innerHTML = `
    <div class="wk">${esc(t('worldOf', { i: i + 1, n: CAMPAIGN.length }))}</div>
    <h3>${esc(L(W.name))}</h3>
    <div class="meta"><span class="chip">${esc(L(SHAPE_LABEL[W.shape.shape]))}</span><span class="chip">${esc(t('cellsMines', { c: cells, m: W.mines }))}</span><span class="chip">★★★ &lt; ${formatTime(W.par)}</span></div>
    <p>${esc(unlocked ? L(W.desc) : t('locked'))}</p>
    <div class="rec"><span>${rec ? esc(t('best')) + ' ' + formatTime(rec.best) : esc(t('noBest'))}</span>${starsHTML(rec ? rec.stars : 0)}</div>
    <div class="wnav">
      <button class="nav" id="wPrev" type="button" aria-label="prev" ${i === 0 ? 'disabled' : ''}>${ICON.prev}</button>
      <button class="btn primary" id="wLand" type="button" ${unlocked ? '' : 'disabled'}>${unlocked ? esc(t('land')) : ICON.lock + esc(t('lockedShort'))}</button>
      <button class="nav" id="wNext" type="button" aria-label="next" ${i === CAMPAIGN.length - 1 ? 'disabled' : ''}>${ICON.next}</button>
    </div>`;
  $('wPrev').addEventListener('click', () => mapSelect(i - 1));
  $('wNext').addEventListener('click', () => mapSelect(i + 1));
  $('wLand').addEventListener('click', () => landOn(i));
}

function mapSelect(i) {
  if (i < 0 || i >= CAMPAIGN.length || !map) return;
  sound.unlock();
  sound.ui();
  S.mapSel = i;
  S.mapPicked = true;
  map.select(i);
  renderWorldCard();
}

function landOn(i) {
  if (i >= store.campaign.unlocked) return;
  sound.unlock();
  sound.whoosh();
  map.flyInto(i);
  setTimeout(() => fadeThen(() => startLevel(campaignLevel(i)), 250), 300);
}

// ---- custom / classic / settings / help --------------------------------------------
function segHTML(id, items, sel) {
  return `<div class="seg" id="${id}">${items.map((it, k) => `<button type="button" data-k="${k}" aria-pressed="${k === sel}">${esc(it)}</button>`).join('')}</div>`;
}

function showCustom() {
  const pick = store.customPick;
  const shapes = ['sphere', 'cube', 'torus', 'asteroid', 'plane'];
  const render = () => {
    const lvl = customLevel(pick.shape, pick.size, pick.dens);
    const cells = cellCountOf(lvl.shape);
    const best = store.custom[lvl.id];
    openModal(`
      <h2>${esc(t('customTitle'))}</h2>
      <div class="field-label">${esc(t('shape'))}</div>
      ${segHTML('cShape', shapes.map((s) => t('shapes')[s]), shapes.indexOf(pick.shape))}
      <div class="field-label">${esc(t('size'))}</div>
      ${segHTML('cSize', t('sizes'), pick.size)}
      <div class="field-label">${esc(t('difficulty'))}</div>
      ${segHTML('cDens', t('diffs'), pick.dens)}
      <div class="info-line">${esc(t('cellsMines', { c: cells, m: lvl.mines }))}${best !== undefined ? ' · ' + esc(t('best')) + ' ' + formatTime(best) : ''}</div>
      <div class="actions two"><button class="btn" id="cBack" type="button">${esc(t('back'))}</button><button class="btn primary" id="cGo" type="button">${esc(t('go'))}</button></div>`);
    const bindSeg = (id, fn) =>
      $(id)
        .querySelectorAll('button')
        .forEach((b) =>
          b.addEventListener('click', () => {
            sound.ui();
            fn(+b.dataset.k);
            store.customPick = pick;
            saveStore();
            render();
          })
        );
    bindSeg('cShape', (k) => (pick.shape = shapes[k]));
    bindSeg('cSize', (k) => (pick.size = k));
    bindSeg('cDens', (k) => (pick.dens = k));
    $('cBack').addEventListener('click', () => {
      sound.ui();
      closeModal();
    });
    $('cGo').addEventListener('click', () => {
      sound.ui();
      closeModal(true);
      fadeThen(() => startLevel(customLevel(pick.shape, pick.size, pick.dens)));
    });
  };
  render();
}

function showClassic() {
  const rows = CLASSIC_LEVELS.map((c, i) => {
    const best = store.classic['classic-' + c.id];
    return `<button class="lvlbtn" type="button" data-i="${i}"><span><b>${esc(L(c.name))}</b><small>${c.W} × ${c.H} · ${c.mines} ${getLang() === 'it' ? 'mine' : 'mines'}</small></span><span class="t">${best !== undefined ? formatTime(best) : ''}</span></button>`;
  }).join('');
  openModal(`
    <h2>${esc(t('classicTitle'))}</h2>
    <p class="lead">${esc(t('classicNote'))}</p>
    <div class="actions">${rows}</div>
    <div class="actions"><button class="btn" id="kBack" type="button">${esc(t('back'))}</button></div>`);
  document.querySelectorAll('.lvlbtn').forEach((b) =>
    b.addEventListener('click', () => {
      sound.ui();
      closeModal(true);
      fadeThen(() => startLevel(classicLevel(+b.dataset.i)));
    })
  );
  $('kBack').addEventListener('click', () => {
    sound.ui();
    closeModal();
  });
}

function switchRow(id, label, on, sub = '') {
  return `<div class="setrow"><span class="lbl">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><button class="switch" type="button" id="${id}" aria-pressed="${on}" aria-label="${esc(label)}"></button></div>`;
}

function bindSwitch(id, fn) {
  const b = $(id);
  if (!b) return;
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(v));
    fn(v);
    sound.ui();
    saveStore();
  });
}

function showSettings(onClose) {
  const s = store.settings;
  let armed = false;
  openModal(
    `
    <h2>${esc(t('settings'))}</h2>
    ${switchRow('sSfx', t('sound'), s.sfx)}
    ${switchRow('sMusic', t('music'), s.music)}
    ${switchRow('sHap', t('haptics'), s.haptics)}
    ${switchRow('sNg', t('noGuess'), s.noGuess, t('noGuessSub'))}
    <div class="field-label">${esc(t('language'))}</div>
    ${segHTML('sLang', ['Italiano', 'English'], getLang() === 'en' ? 1 : 0)}
    <div class="actions two"><button class="btn danger" id="sReset" type="button">${esc(t('resetProgress'))}</button><button class="btn primary" id="sClose" type="button">${esc(t('close'))}</button></div>`,
    { onClose: typeof onClose === 'function' ? onClose : null }
  );
  bindSwitch('sSfx', (v) => {
    s.sfx = v;
    sound.setSfx(v);
  });
  bindSwitch('sMusic', (v) => {
    s.music = v;
    sound.unlock();
    sound.setMusic(v);
  });
  bindSwitch('sHap', (v) => {
    s.haptics = v;
    sound.hapticsOn = v;
    if (v) sound.vibrate(20);
  });
  bindSwitch('sNg', (v) => (s.noGuess = v));
  $('sLang')
    .querySelectorAll('button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        chooseLang(+b.dataset.k === 1 ? 'en' : 'it');
        sound.ui();
        closeModal(true);
        refreshLanguage();
        showSettings(onClose);
      })
    );
  $('sReset').addEventListener('click', () => {
    if (!armed) {
      armed = true;
      $('sReset').textContent = t('resetConfirm');
      return;
    }
    store.campaign = { unlocked: 1, worlds: {} };
    store.classic = {};
    store.custom = {};
    store.daily = {};
    store.seen = {};
    store.current = null;
    saveStore();
    toast(t('resetDone'));
    closeModal();
    if (S.screen === 'title') showTitle();
    if (S.screen === 'map') showMap();
  });
  $('sClose').addEventListener('click', () => {
    sound.ui();
    closeModal();
  });
}

function refreshLanguage() {
  if (S.screen === 'title') {
    renderTitle();
    layoutTitle();
  }
  else if (S.screen === 'map') showMap();
  else if (S.screen === 'game') {
    $('levelTag').textContent = levelTag(S.level);
    updateModeBtn();
    updateHintBtn();
    applyToolLabels();
  }
}

function showHelp(onClose) {
  openModal(
    `
    <h2>${esc(t('helpTitle'))}</h2>
    <ul class="help">
      <li>${esc(t('help1'))}</li><li>${esc(t('help2'))}</li><li>${esc(t('help3'))}</li>
      <li>${esc(t('help4'))}</li><li>${esc(t('help5'))}</li><li>${esc(t('help6'))}</li>
    </ul>
    ${isTouch ? '' : `<p class="keys">${esc(t('keys'))}</p>`}
    <div class="actions"><button class="btn primary" id="hClose" type="button">${esc(t('close'))}</button></div>`,
    { onClose: typeof onClose === 'function' ? onClose : null }
  );
  $('hClose').addEventListener('click', () => {
    sound.ui();
    closeModal();
  });
}

// ---- in-game menus ------------------------------------------------------------------
function pauseGame(reason = 'menu') {
  if (S.pauses.has(reason)) return;
  if (!S.pauses.size) S.pauseStart = realNow();
  S.pauses.add(reason);
}
function resumeGame(reason = 'menu') {
  if (!S.pauses.has(reason)) return;
  S.pauses.delete(reason);
  if (!S.pauses.size) S.pausedTotal += realNow() - S.pauseStart;
}

function exitToHub() {
  saveCurrent();
  const mode = S.level?.mode;
  fadeThen(() => (mode === 'campaign' ? showMap() : showTitle()));
}

function showPause() {
  if (S.screen !== 'game' || modalOpen()) return;
  pauseGame();
  const s = store.settings;
  openModal(
    `
    <h2>${esc(t('pause'))}</h2>
    <p class="lead">${esc(levelTag(S.level))}</p>
    ${switchRow('pSfx', t('sound'), s.sfx)}
    ${switchRow('pMusic', t('music'), s.music)}
    <div class="actions">
      <button class="btn primary" id="pResume" type="button">${esc(t('resume'))}</button>
      <div class="actions two" style="margin-top:0">
        <button class="btn" id="pRestart" type="button">${esc(t('restart'))}</button>
        <button class="btn" id="pHelp" type="button">${esc(t('help'))}</button>
      </div>
      <button class="btn" id="pQuit" type="button">${esc(S.level.mode === 'campaign' ? t('toMap') : t('toMenu'))}</button>
    </div>`,
    { onClose: () => resumeGame() }
  );
  bindSwitch('pSfx', (v) => {
    s.sfx = v;
    sound.setSfx(v);
  });
  bindSwitch('pMusic', (v) => {
    s.music = v;
    sound.setMusic(v);
  });
  $('pResume').addEventListener('click', () => {
    sound.ui();
    closeModal();
  });
  $('pRestart').addEventListener('click', () => {
    closeModal();
    restartLevel();
  });
  $('pHelp').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    showHelp(() => resumeGame());
  });
  $('pQuit').addEventListener('click', () => {
    sound.ui();
    closeModal();
    exitToHub();
  });
}

function showWinModal(res) {
  const lvl = S.level;
  const camp = lvl.mode === 'campaign';
  const last = camp && lvl.index === CAMPAIGN.length - 1;
  const title = camp ? t('winTitle') : lvl.mode === 'daily' ? t('winDaily') : t('winClassic');
  let starList = '';
  if (camp) {
    const labels = [t('starDone'), t('starNoHelp'), t('starPar', { t: formatTime(lvl.par) })];
    starList = `<div class="starlist">${res.flags
      .map((on, i) => `<div class="s ${on ? '' : 'off'}" style="animation-delay:${0.25 + i * 0.32}s">${starSVG(on, 30)}<span>${esc(labels[i])}</span></div>`)
      .join('')}</div>`;
    res.flags.forEach((on, i) => {
      if (on) setTimeout(() => sound.star(i), 250 + i * 320);
    });
  }
  const recLine = res.record && res.prevBest !== undefined ? `<span class="rec">${esc(t('newRecord'))}</span>` : res.prevBest !== undefined ? `<span class="rec" style="color:var(--muted)">${esc(t('best'))} ${formatTime(res.prevBest)}</span>` : '';
  const extra = last ? `<p class="lead">${esc(t('campaignDone'))}</p>` : res.unlocked ? `<p class="lead">${esc(t('unlocked', { name: res.unlocked }))}</p>` : '';
  const actions = camp
    ? `${last ? '' : `<button class="btn primary" id="rNext" type="button">${esc(t('next'))}</button>`}
       <div class="actions two" style="margin-top:0"><button class="btn" id="rReplay" type="button">${esc(t('replay'))}</button><button class="btn ${last ? 'primary' : ''}" id="rMap" type="button">${esc(t('toMap'))}</button></div>`
    : `<button class="btn primary" id="rReplay" type="button">${esc(lvl.mode === 'daily' ? t('replay') : t('retry'))}</button>
       <button class="btn" id="rMap" type="button">${esc(t('toMenu'))}</button>`;
  openModal(
    `<h2>${esc(title)}</h2>
     <div class="result-time"><span class="big">${formatTime(res.time)}</span>${recLine}</div>
     ${starList}${extra}
     <div class="actions">${actions}</div>`,
    { dismissable: false }
  );
  $('rNext')?.addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    S.mapSel = lvl.index + 1;
    fadeThen(() => startLevel(campaignLevel(lvl.index + 1)));
  });
  $('rReplay').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    fadeThen(() => startLevel(S.level));
  });
  $('rMap').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    if (camp) S.mapSel = Math.min(lvl.index + 1, store.campaign.unlocked - 1);
    fadeThen(camp ? showMap : showTitle);
  });
}

function showLoseModal() {
  const lvl = S.level;
  openModal(
    `<h2>${esc(t('loseTitle'))}</h2>
     <p class="lead">${esc(t('loseText'))}</p>
     <div class="actions">
       <button class="btn" id="lUndo" type="button"><span class="col">${esc(t('undo'))}<small>${esc(t('undoSub'))}</small></span></button>
       <button class="btn primary" id="lRetry" type="button">${esc(lvl.mode === 'daily' ? t('replay') : t('retry'))}</button>
       <button class="btn" id="lMenu" type="button">${esc(lvl.mode === 'campaign' ? t('toMap') : t('toMenu'))}</button>
     </div>`,
    { dismissable: false }
  );
  $('lUndo').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    undoLastMove();
  });
  $('lRetry').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    startLevel(S.level);
  });
  $('lMenu').addEventListener('click', () => {
    sound.ui();
    closeModal(true);
    fadeThen(lvl.mode === 'campaign' ? showMap : showTitle);
  });
}

// ============================================================ input wiring
function pickCell(x, y) {
  if (S.screen !== 'game' || !S.planet) return -1;
  ndc.set((x / rig.vw) * 2 - 1, -(y / rig.vh) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return S.planet.pick(raycaster);
}

function clearPressed() {
  for (const c of S.pressed) S.planet?.setExtra(c, 0);
  S.pressed = [];
  if (S.screen === 'game' && (S.status === 'playing' || S.status === 'ready')) setFace('smile');
}

const input = new Input($('gl'), {
  unlock: () => sound.unlock(),
  // touching a spinning planet stops it, like grabbing a globe
  grab: () => {
    if (S.screen === 'game' || S.screen === 'title') {
      rig.angVel.set(0, 0, 0);
      rig.panVel.set(0, 0);
    }
  },
  pick: (x, y) => {
    if (S.screen === 'map') return map ? map.pick(x, y, window.innerWidth, window.innerHeight) : -1;
    return pickCell(x, y);
  },
  primary: (c) => {
    if (S.screen === 'map') {
      if (c >= 0) {
        if (c === S.mapSel && c < store.campaign.unlocked) landOn(c);
        else mapSelect(c);
      }
      return;
    }
    primary(c);
  },
  secondary: (c) => {
    if (S.screen === 'game') secondary(c);
  },
  chord: (c) => {
    if (S.screen === 'game' && playable()) doChord(c);
  },
  canHold: (c) => S.screen === 'game' && playable() && c >= 0 && (!S.field.revealed[c] || S.field.counts[c] > 0),
  pressStart: (c) => {
    if (S.screen !== 'game' || !playable() || c < 0) return;
    const f = S.field;
    clearPressed();
    if (!f.revealed[c]) {
      if (f.flags[c] && !S.flagMode) return;
      S.pressed = [c];
    } else if (f.counts[c] > 0) S.pressed = f.hiddenAround(c);
    S.pressed.forEach((d) => S.planet.setExtra(d, 1));
    if (S.pressed.length) setFace('oh');
  },
  pressEnd: () => clearPressed(),
  hover: (c) => {
    S.hover = c;
    if (S.planet && S.screen === 'game') S.planet.setHover(playable() && c >= 0 && !S.field.revealed[c] ? c : -1);
  },
  dragStart: () => {
    if (S.screen === 'map') {
      S.swipe = 0;
      return;
    }
    rig.startDrag();
    rig.autoSpin = S.screen === 'title' ? 0 : rig.autoSpin;
  },
  dragBy: (dx, dy, dt) => {
    if (S.screen === 'map') {
      S.swipe += dx;
      return;
    }
    if (S.screen === 'game' || S.screen === 'title') rig.dragBy(dx, dy, dt);
  },
  dragEnd: (idle) => {
    if (S.screen === 'map') {
      if (Math.abs(S.swipe) > 50) mapSelect(S.mapSel + (S.swipe < 0 ? 1 : -1));
      S.swipe = 0;
      return;
    }
    rig.endDrag(idle);
    if (S.screen === 'title') setTimeout(() => (rig.autoSpin = reduceMotion ? 0 : 0.1), 1500);
  },
  zoom: (k) => {
    if (S.screen === 'game') rig.zoomBy(k);
  },
});

function applyToolLabels() {
  $('btnMenu').innerHTML = ICON.menu;
  $('btnMenu').setAttribute('aria-label', t('menu'));
  $('btnZoomIn').innerHTML = ICON.zoomIn;
  $('btnZoomIn').setAttribute('aria-label', t('zoomIn'));
  $('btnZoomOut').innerHTML = ICON.zoomOut;
  $('btnZoomOut').setAttribute('aria-label', t('zoomOut'));
  $('face').setAttribute('aria-label', t('restart'));
}
applyToolLabels();

$('btnMenu').addEventListener('click', () => {
  sound.unlock();
  sound.ui();
  showPause();
});
$('btnZoomIn').addEventListener('click', () => {
  sound.unlock();
  rig.zoomBy(1.4);
});
$('btnZoomOut').addEventListener('click', () => {
  sound.unlock();
  rig.zoomBy(1 / 1.4);
});
$('btnMode').addEventListener('click', () => {
  sound.unlock();
  S.flagMode = !S.flagMode;
  updateModeBtn();
  toast(S.flagMode ? t('modeFlag') : t('modeDig'), 1400);
  sound.ui();
});
$('btnHint').addEventListener('click', () => useHint());
$('face').addEventListener('click', onFace);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (modalOpen()) {
    if (e.key === 'Escape') {
      const m = $('panel');
      if (!m.querySelector('#rReplay') && !m.querySelector('#lRetry')) closeModal();
    }
    return;
  }
  if (S.screen === 'map') {
    if (e.key === 'ArrowLeft') mapSelect(S.mapSel - 1);
    else if (e.key === 'ArrowRight') mapSelect(S.mapSel + 1);
    else if (e.key === 'Enter') landOn(S.mapSel);
    else if (e.key === 'Escape') fadeThen(showTitle);
    return;
  }
  if (S.screen !== 'game') return;
  const k = e.key.toLowerCase();
  const step = 70;
  if (k === 'arrowleft') rig.dragBy(-step, 0, 0);
  else if (k === 'arrowright') rig.dragBy(step, 0, 0);
  else if (k === 'arrowup') rig.dragBy(0, -step, 0);
  else if (k === 'arrowdown') rig.dragBy(0, step, 0);
  else if (k === '+' || k === '=') rig.zoomBy(1.3);
  else if (k === '-' || k === '_') rig.zoomBy(1 / 1.3);
  else if (k === 'f') $('btnMode').click();
  else if (k === 'h') useHint();
  else if (k === 'r') restartLevel();
  else if (k === 'escape' || k === 'p') showPause();
  else if (k === ' ' && S.hover >= 0) primary(S.hover);
  else return;
  e.preventDefault();
});

window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame('hidden');
    saveCurrent();
    try {
      sound.ctx?.suspend();
    } catch (e) {
      /* ignore */
    }
  } else {
    resumeGame('hidden');
    try {
      if (sound.ctx) sound.ctx.resume();
    } catch (e) {
      /* ignore */
    }
  }
});
window.addEventListener('pagehide', saveCurrent);

// ============================================================ frame loop
let lastMs = performance.now();
let perfFrames = 0, perfTime = 0, perfChecked = false;
function frame(ms) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (ms - lastMs) / 1000));
  lastMs = ms;
  S.time += dt;
  processTimed();
  processTweens(dt);

  if (S.screen === 'map' && map) {
    map.update(dt, pr);
    renderer.render(map.scene, map.camera);
    return;
  }
  if (S.intro) {
    S.intro.t += dt;
    const k = Math.min(1, S.intro.t / 0.9);
    rig.introScale = 0.5 + 0.5 * easeOutBack(k, 1.3);
    if (k >= 1) {
      S.intro = null;
      rig.introScale = 1;
    }
  }
  rig.update(dt, S.planet ? S.planet.group : dummy);
  if (S.planet) {
    S.planet.group.updateMatrixWorld(true);
    S.planet.update(S.time, camera);
  }
  particles.update(dt);
  particles.uniforms.uScale.value = renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  stars.update(S.time, pr);
  if (S.screen === 'game' && S.status === 'playing') setLed($('timeCounter'), Math.floor(currentElapsed()), t('time'));
  renderer.render(scene, camera);
  if (!S.firstFrame) {
    S.firstFrame = true;
    mark('frame1');
  }

  // adaptive resolution: if the device struggles, render fewer pixels
  if (!perfChecked && S.screen === 'game') {
    perfFrames++;
    perfTime += dt;
    if (perfFrames >= 120) {
      perfChecked = true;
      const fps = perfFrames / perfTime;
      if (fps < 42 && pr > 1) {
        pr = Math.max(1, pr * 0.7);
        resize();
      }
    }
  }
}

// ============================================================ boot
async function waitFonts() {
  const link = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
  if (link && !link.sheet) {
    await new Promise((res) => {
      link.addEventListener('load', res, { once: true });
      link.addEventListener('error', res, { once: true });
      setTimeout(res, 1500);
    });
  }
  await Promise.all([document.fonts.load('800 100px "Unbounded"'), document.fonts.load('600 20px "Chakra Petch"')]);
}

function hideLoader() {
  const el = $('loading');
  if (!el || el.classList.contains('done')) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 700);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot(hot) {
  mark('boot');
  progress(0.78, 1);
  resize();
  const cur = hot && hot.current ? hot.current : null;
  const fonts = waitFonts().catch(() => {});
  await Promise.race([fonts, sleep(cur && cur.level ? 1500 : 450)]);
  mark('fonts');
  progress(0.85, 1);
  await nextPaint();
  if (cur && cur.level) startLevel(cur.level, cur);
  else {
    setScreen('title');
    renderTitle();
    titleScene(true);
  }
  mark('scene');
  progress(0.93, 2);
  await nextPaint();
  // compile the shaders off the main thread where the browser allows it, so the page never freezes
  try {
    rig.update(0, S.planet ? S.planet.group : dummy);
    if (S.planet) S.planet.update(S.time, camera);
    if (parallelCompile()) await Promise.race([renderer.compileAsync(scene, camera), sleep(4000)]);
    else renderer.compile(scene, camera);
  } catch (e) {
    /* compiled on first draw instead */
  }
  mark('compiled');
  progress(1, 2);
  requestAnimationFrame((ms) => {
    lastMs = ms;
    frame(ms);
  });
  // let the bar reach 100%, then reveal the title while the planet grows in
  setTimeout(hideLoader, 220);
  warmUpMap();
}

function parallelCompile() {
  try {
    return renderer.extensions.has('KHR_parallel_shader_compile');
  } catch (e) {
    return false;
  }
}

// Prepare the campaign map in the background so opening it later does not stutter.
function warmUpMap() {
  const go = () => {
    if (map) return;
    try {
      map = new MapView();
      map.resize(window.innerWidth, window.innerHeight);
      map.setProgress(store.campaign);
      if (parallelCompile()) renderer.compileAsync(map.scene, map.camera).catch(() => {});
    } catch (e) {
      map = null;
    }
  };
  setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 2500 });
    else go();
  }, 1600);
}

// Keep the running game across a republish of the artifact (claude.ai viewer).
try {
  window.claude?.hot?.snapshot?.(() => ({ current: snapshotGame() }));
} catch (e) {
  /* not in the viewer */
}
const hot = window.claude?.hot;
if (hot?.ready) hot.ready((data) => boot(data || {}));
else boot(hot?.data ?? {});

// debug hooks for automated tests
if (/[?&#]debug/.test(location.search + location.hash)) {
  window.__mm = { S, store, rig, startLevel, campaignLevel, classicLevel, customLevel, dailyLevel, primary, secondary, doFlag, useHint, showMap, showTitle, landOn, camera, renderer, findLogicalSafe };
}

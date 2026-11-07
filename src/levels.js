// Worlds, themes and game modes.
import { hashString, mulberry32, todayKey } from './util.js';

const NEON = { 1: '#5cc8ff', 2: '#5ef08a', 3: '#ff5d5d', 4: '#c38bff', 5: '#ffa94d', 6: '#3ff0e0', 7: '#ffffff', 8: '#b8c2d6' };
const CLASSIC = { 1: '#0000ff', 2: '#007b00', 3: '#ff0000', 4: '#00007b', 5: '#7b0000', 6: '#007b7b', 7: '#000000', 8: '#7b7b7b' };

export const THEMES = {
  moon: {
    plateA: '#aeb9cb', plateB: '#8c98ad', floor: '#151b29', core: '#56d0ff', atmo: '#8fd8ff',
    bgTop: '#03050b', bgBottom: '#0b1430', nebula: ['#24407a', '#3a2a6e', '#173c5a'], seed: 11,
  },
  mint: {
    plateA: '#8be6d2', plateB: '#62c2b1', floor: '#0f2026', core: '#30ffd0', atmo: '#7affe0',
    bgTop: '#020809', bgBottom: '#0a1f26', nebula: ['#11504a', '#1b3a66', '#2c2a60'], seed: 12,
  },
  rust: {
    plateA: '#e38a5f', plateB: '#c06644', floor: '#24130f', core: '#ffbe55', atmo: '#ff9a66',
    bgTop: '#080304', bgBottom: '#22100c', nebula: ['#5a2318', '#3b1e4a', '#6b3a18'], seed: 13,
  },
  donut: {
    plateA: '#f7b0cd', plateB: '#ea8db5', floor: '#3a2418', core: '#ffcf80', atmo: '#ffc0dc', sprinkles: true,
    bgTop: '#08030a', bgBottom: '#24102a', nebula: ['#5a1f4a', '#2a2a6b', '#6b2a3a'], seed: 14,
  },
  rock: {
    plateA: '#a89986', plateB: '#87796b', floor: '#1a1714', core: '#ff7a3a', atmo: '#ffae80',
    bgTop: '#050404', bgBottom: '#1b1410', nebula: ['#4a2a18', '#2a2a4a', '#3a1a3a'], seed: 15,
  },
  violet: {
    plateA: '#9aa9ff', plateB: '#7686ec', floor: '#13152c', core: '#a77bff', atmo: '#b9a6ff',
    bgTop: '#040312', bgBottom: '#120f33', nebula: ['#2a1d6b', '#1d2f6b', '#4a1d5a'], seed: 16,
  },
  ice: {
    plateA: '#e3f5ff', plateB: '#c0e3f6', floor: '#0f1d2e', core: '#6ff3ff', atmo: '#c9f6ff',
    bgTop: '#02060c', bgBottom: '#0b1d33', nebula: ['#14406b', '#1d2a5a', '#2a5a6b'], seed: 17,
  },
  lava: {
    plateA: '#4f3c39', plateB: '#3a2c2a', floor: '#170d0b', core: '#ff5a1f', atmo: '#ff7a3a',
    bgTop: '#070202', bgBottom: '#1f0806', nebula: ['#6b1d0d', '#4a0d1d', '#3a1a0d'], seed: 18,
  },
  giant: {
    plateA: '#f0d2a2', plateB: '#d9b07a', floor: '#22180f', core: '#ffd27f', atmo: '#ffe1b0', bands: true,
    rings: true, ringColor: '#f5d9a8',
    bgTop: '#050403', bgBottom: '#1a140c', nebula: ['#4a3a1d', '#1d2a4a', '#3a1d2a'], seed: 19,
  },
  core: {
    plateA: '#6a7186', plateB: '#50566b', floor: '#0c0d14', core: '#ff2e7e', atmo: '#ff6aa8',
    bgTop: '#070209', bgBottom: '#1c0718', nebula: ['#5a0d3a', '#1d0d4a', '#3a0d2a'], seed: 20,
  },
  retro: {
    plateA: '#c6c6c6', plateB: '#bdbdbd', floor: '#c7c7c7', core: '#7b7b7b', atmo: '#ffffff', retro: true,
    flag: '#ff0000', flagTint: '#c6c6c6', frame: '#bdbdbd', bgTop: '#008080', bgBottom: '#007070', flatBg: true,
    numbers: CLASSIC,
  },
};
for (const k of Object.keys(THEMES)) {
  THEMES[k].id = k;
  THEMES[k].numbers = THEMES[k].numbers || NEON;
  THEMES[k].flag = THEMES[k].flag || '#ff4545';
}

export const SHAPE_LABEL = {
  sphere: { it: 'Sfera esagonale', en: 'Hex sphere' },
  asteroid: { it: 'Asteroide', en: 'Asteroid' },
  cube: { it: 'Cubo', en: 'Cube' },
  torus: { it: 'Ciambella (toro)', en: 'Donut (torus)' },
  plane: { it: 'Piano classico', en: 'Classic flat' },
};

export const CAMPAIGN = [
  {
    id: 'luna', theme: 'moon', shape: { shape: 'sphere', freq: 3 }, mines: 11, par: 50,
    name: { it: 'Luna Zero', en: 'Moon Zero' },
    desc: {
      it: 'La luna di addestramento. Ogni tessera esagonale ha 6 vicine: i numeri contano le mine che la toccano.',
      en: 'The training moon. Every hex tile has 6 neighbours: numbers count the mines touching it.',
    },
  },
  {
    id: 'kappa', theme: 'mint', shape: { shape: 'cube', N: 4 }, mines: 14, par: 60,
    name: { it: 'Cubo Kappa', en: 'Kappa Cube' },
    desc: {
      it: 'Un mondo cubico. Sugli spigoli le vicine continuano sulla faccia accanto, e negli angoli sono solo 7.',
      en: 'A cubic world. On the edges, neighbours continue on the next face; on the corners there are only 7.',
    },
  },
  {
    id: 'ruggine', theme: 'rust', shape: { shape: 'sphere', freq: 4 }, mines: 28, par: 95,
    name: { it: 'Ruggine', en: 'Rust' },
    desc: { it: 'Deserti rossi e mine arrugginite. Le 12 tessere pentagonali hanno solo 5 vicine.', en: 'Red deserts and rusty mines. The 12 pentagon tiles have only 5 neighbours.' },
  },
  {
    id: 'ciambella', theme: 'donut', shape: { shape: 'torus', U: 24, V: 10 }, mines: 40, par: 140,
    name: { it: 'Ciambella', en: 'Donut' },
    desc: { it: 'Un mondo a forma di toro: niente bordi, ogni tessera ha sempre 8 vicine. Glassa inclusa.', en: 'A torus world: no edges, every tile always has 8 neighbours. Frosting included.' },
  },
  {
    id: 'k7', theme: 'rock', shape: { shape: 'asteroid', freq: 5, seed: 7 }, mines: 48, par: 150,
    name: { it: 'Asteroide K-7', en: 'Asteroid K-7' },
    desc: { it: 'Bitorzoluto e instabile. Ruotalo bene: le valli nascondono tessere.', en: 'Lumpy and unstable. Turn it around: the valleys hide tiles.' },
  },
  {
    id: 'titano', theme: 'violet', shape: { shape: 'cube', N: 6 }, mines: 38, par: 130,
    name: { it: 'Cubo Titano', en: 'Titan Cube' },
    desc: { it: 'Il fratello maggiore di Kappa. Gli spigoli sono il punto debole delle mine.', en: "Kappa's big brother. The edges are where mines give themselves away." },
  },
  {
    id: 'gelo', theme: 'ice', shape: { shape: 'sphere', freq: 6 }, mines: 72, par: 220,
    name: { it: 'Gelo Eterno', en: 'Eternal Frost' },
    desc: { it: 'Ghiaccio, silenzio e settantadue mine.', en: 'Ice, silence and seventy-two mines.' },
  },
  {
    id: 'fuoco', theme: 'lava', shape: { shape: 'torus', U: 32, V: 12 }, mines: 70, par: 240,
    name: { it: 'Anello di Fuoco', en: 'Ring of Fire' },
    desc: { it: 'Una ciambella di basalto con la lava che filtra tra le tessere.', en: 'A basalt donut with lava seeping between the tiles.' },
  },
  {
    id: 'gigante', theme: 'giant', shape: { shape: 'sphere', freq: 8 }, mines: 135, par: 400,
    name: { it: 'Gigante Gassoso', en: 'Gas Giant' },
    desc: { it: 'Grande. Molto grande. Usa lo zoom.', en: 'Big. Very big. Use the zoom.' },
  },
  {
    id: 'nucleo', theme: 'core', shape: { shape: 'cube', N: 8 }, mines: 74, par: 280,
    name: { it: 'Il Nucleo', en: 'The Core' },
    desc: { it: 'Il monolite da cui sono partite tutte le mine. Ultima missione.', en: 'The monolith every mine came from. Final mission.' },
  },
];

export const CLASSIC_LEVELS = [
  { id: 'beginner', W: 9, H: 9, mines: 10, name: { it: 'Principiante', en: 'Beginner' } },
  { id: 'intermediate', W: 16, H: 16, mines: 40, name: { it: 'Intermedio', en: 'Intermediate' } },
  { id: 'expert', W: 30, H: 16, mines: 99, name: { it: 'Esperto', en: 'Expert' } },
];

export const CUSTOM_SIZES = {
  sphere: [{ freq: 4 }, { freq: 6 }, { freq: 8 }, { freq: 10 }],
  asteroid: [{ freq: 4 }, { freq: 6 }, { freq: 8 }, { freq: 10 }],
  cube: [{ N: 4 }, { N: 6 }, { N: 8 }, { N: 10 }],
  torus: [{ U: 20, V: 8 }, { U: 28, V: 11 }, { U: 36, V: 14 }, { U: 45, V: 17 }],
  plane: [{ W: 9, H: 9 }, { W: 16, H: 16 }, { W: 30, H: 16 }, { W: 40, H: 24 }],
};
export const CUSTOM_DENSITY = [0.11, 0.15, 0.19, 0.23];
const CUSTOM_THEME = { sphere: 'moon', asteroid: 'rock', cube: 'mint', torus: 'donut', plane: 'retro' };

export function cellCountOf(spec) {
  switch (spec.shape) {
    case 'sphere':
    case 'asteroid':
      return 10 * spec.freq * spec.freq + 2;
    case 'cube':
      return 6 * spec.N * spec.N;
    case 'torus':
      return spec.U * spec.V;
    case 'plane':
      return spec.W * spec.H;
  }
  return 0;
}

export function campaignLevel(i) {
  const L = CAMPAIGN[i];
  return { mode: 'campaign', index: i, id: L.id, name: L.name, desc: L.desc, shape: { ...L.shape }, mines: L.mines, par: L.par, theme: L.theme };
}

export function classicLevel(i) {
  const L = CLASSIC_LEVELS[i];
  return { mode: 'classic', index: i, id: 'classic-' + L.id, name: L.name, shape: { shape: 'plane', W: L.W, H: L.H }, mines: L.mines, theme: 'retro' };
}

export function customLevel(shape, sizeIdx, densIdx) {
  const spec = { shape, ...CUSTOM_SIZES[shape][sizeIdx] };
  if (shape === 'asteroid') spec.seed = 3 + sizeIdx;
  const cells = cellCountOf(spec);
  // hex tiles have only 6 neighbours, so the same density is easier: compensate
  const hex = shape === 'sphere' || shape === 'asteroid' ? 1.15 : 1;
  const mines = Math.max(1, Math.round(cells * CUSTOM_DENSITY[densIdx] * hex));
  return {
    mode: 'custom',
    id: `custom-${shape}-${sizeIdx}-${densIdx}`,
    name: { it: 'Partita libera', en: 'Free play' },
    shape: spec,
    mines,
    theme: CUSTOM_THEME[shape],
    sizeIdx,
    densIdx,
  };
}

// Offline daily: built from the device date. It doesn't count for the leaderboard.
export function dailyLevel(date = new Date()) {
  const key = todayKey(date);
  return dailyLevelFor(key, hashString('mondi-minati-' + key));
}

// The daily planet for a day (YYYY-MM-DD) and a seed. Online the server picks the seed
// (worker/), so nobody can work out a day's planet from the public code beforehand.
// The server rebuilds the same planet to check results, so keep this deterministic.
export function dailyLevelFor(key, seed, { ranked = false } = {}) {
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
  return {
    mode: 'daily',
    id: 'daily-' + key,
    dateKey: key,
    name: { it: 'Sfida del giorno', en: 'Daily challenge' },
    shape: spec,
    mines: Math.round(cells * (spec.shape === 'sphere' || spec.shape === 'asteroid' ? 0.19 : 0.165)),
    theme,
    seed,
    ranked,
  };
}

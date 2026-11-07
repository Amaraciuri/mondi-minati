// Glyph atlas for numbers and icons printed on the tiles.
// 4 x 4 slots: 0 empty, 1-8 digits, 9 crater/mine, 10 wrong-flag X,
// 11 flat flag (printed on covered tiles of the classic board, seen from above).
import * as THREE from 'three';

export const GLYPH = { MINE: 9, WRONG: 10, FLAG: 11 };

const PIXEL_FLAG = [
  '....RR#....',
  '..RRRR#....',
  'RRRRRR#....',
  '..RRRR#....',
  '....RR#....',
  '......#....',
  '......#....',
  '....#####..',
  '..#########',
];

const PIXEL_DIGITS = {
  1: ['...##..', '..###..', '.####..', '...##..', '...##..', '...##..', '...##..', '...##..', '.######'],
  2: ['.#####.', '##...##', '.....##', '....##.', '...##..', '..##...', '.##....', '##.....', '#######'],
  3: ['.#####.', '##...##', '.....##', '..####.', '.....##', '.....##', '.....##', '##...##', '.#####.'],
  4: ['....##.', '...###.', '..####.', '.##.##.', '##..##.', '#######', '....##.', '....##.', '....##.'],
  5: ['#######', '##.....', '##.....', '######.', '.....##', '.....##', '.....##', '##...##', '.#####.'],
  6: ['.#####.', '##...##', '##.....', '######.', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  7: ['#######', '.....##', '....##.', '...##..', '...##..', '..##...', '..##...', '..##...', '..##...'],
  8: ['.#####.', '##...##', '##...##', '.#####.', '##...##', '##...##', '##...##', '##...##', '.#####.'],
};

function mixHex(hex, other, t) {
  const a = new THREE.Color(hex), b = new THREE.Color(other);
  a.lerp(b, t);
  return '#' + a.getHexString();
}

export function makeAtlas(renderer, { style = 'neon', colors, font = 'sans-serif' }) {
  const S = 1024, C = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const slot = (i) => [(i % 4) * C, Math.floor(i / 4) * C];

  for (let d = 1; d <= 8; d++) {
    const [x, y] = slot(d);
    const cx = x + C / 2, cy = y + C / 2;
    const col = colors[d];
    if (style === 'retro') {
      const rows = PIXEL_DIGITS[d];
      const px = 17;
      const w = rows[0].length * px, h = rows.length * px;
      ctx.fillStyle = col;
      rows.forEach((row, r) => {
        for (let k = 0; k < row.length; k++) {
          if (row[k] === '#') ctx.fillRect(Math.round(cx - w / 2 + k * px), Math.round(cy - h / 2 + r * px), px, px);
        }
      });
    } else {
      ctx.save();
      ctx.font = `800 158px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(String(d));
      const asc = m.actualBoundingBoxAscent || 116, desc = m.actualBoundingBoxDescent || 0;
      const by = cy + (asc - desc) / 2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 34;
      ctx.fillStyle = col;
      ctx.fillText(String(d), cx, by);
      ctx.shadowBlur = 14;
      ctx.fillText(String(d), cx, by);
      ctx.shadowBlur = 0;
      ctx.fillStyle = mixHex(col, '#ffffff', 0.35);
      ctx.fillText(String(d), cx, by);
      ctx.restore();
    }
  }

  // 9: mine crater / classic mine icon
  {
    const [x, y] = slot(9);
    const cx = x + C / 2, cy = y + C / 2;
    if (style === 'retro') {
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx, cy, 56, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 16;
      ctx.strokeStyle = '#000';
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * 92, cy - Math.sin(a) * 92);
        ctx.lineTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 30, cy - 30, 22, 22);
    } else {
      const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, 112);
      g.addColorStop(0, 'rgba(10,6,4,1)');
      g.addColorStop(0.55, 'rgba(40,16,8,0.95)');
      g.addColorStop(0.8, 'rgba(255,120,40,0.55)');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 112, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 10: wrong flag X
  {
    const [x, y] = slot(10);
    const cx = x + C / 2, cy = y + C / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = style === 'retro' ? '#d00000' : '#ff4a3d';
    ctx.lineWidth = 26;
    if (style !== 'retro') {
      ctx.shadowColor = '#ff4a3d';
      ctx.shadowBlur = 24;
    }
    ctx.beginPath();
    ctx.moveTo(cx - 70, cy - 70);
    ctx.lineTo(cx + 70, cy + 70);
    ctx.moveTo(cx + 70, cy - 70);
    ctx.lineTo(cx - 70, cy + 70);
    ctx.stroke();
    ctx.restore();
  }
  // 11: flat flag for the classic board (a 3D flag seen from straight above is just a sliver)
  {
    const [x, y] = slot(GLYPH.FLAG);
    const px = 14;
    const w = PIXEL_FLAG[0].length * px, h = PIXEL_FLAG.length * px;
    const x0 = Math.round(x + (C - w) / 2), y0 = Math.round(y + (C - h) / 2);
    PIXEL_FLAG.forEach((row, r) => {
      for (let k = 0; k < row.length; k++) {
        if (row[k] === '.') continue;
        ctx.fillStyle = row[k] === 'R' ? '#ff0000' : '#000000';
        ctx.fillRect(x0 + k * px, y0 + r * px, px, px);
      }
    });
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = style === 'retro' ? THREE.NearestFilter : THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

// Soft round sprite used by halos and particles.
let _dot = null;
export function softDotTexture() {
  if (_dot) return _dot;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _dot = new THREE.CanvasTexture(cv);
  _dot.colorSpace = THREE.NoColorSpace;
  return _dot;
}

let _halo = null;
export function haloTexture() {
  if (_halo) return _halo;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  _halo = new THREE.CanvasTexture(cv);
  _halo.colorSpace = THREE.NoColorSpace;
  return _halo;
}

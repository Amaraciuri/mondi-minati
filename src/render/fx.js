// Ambient space (stars, nebula backdrop) and a small pooled particle system.
import * as THREE from 'three';
import { softDotTexture } from './atlas.js';
import { mulberry32 } from '../util.js';

export function makeNebula(theme, w = 768, h = 768) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, theme.bgTop || '#04060d');
  g.addColorStop(1, theme.bgBottom || '#0b1226');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (!theme.flatBg) {
    const rng = mulberry32(theme.seed || 7);
    const blobs = theme.nebula || ['#3b2a6b', '#1d4c6e', '#6b2a4a'];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = rng() * w, y = rng() * h, r = (0.25 + rng() * 0.4) * w;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      const col = new THREE.Color(blobs[i % blobs.length]);
      const a = 0.1 + rng() * 0.12;
      rg.addColorStop(0, `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${a})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    // faint dust
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.08})`;
      ctx.fillRect(rng() * w, rng() * h, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class Starfield {
  constructor(count = 1400, radius = 90) {
    const rng = mulberry32(99);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tints = [new THREE.Color('#ffffff'), new THREE.Color('#bcd4ff'), new THREE.Color('#ffe7c2'), new THREE.Color('#d6c8ff')];
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(th) * radius;
      pos[i * 3 + 1] = u * radius;
      pos[i * 3 + 2] = s * Math.sin(th) * radius;
      const c = tints[Math.floor(rng() * tints.length)];
      const b = 0.45 + rng() * 0.55;
      col[i * 3] = c.r * b;
      col[i * 3 + 1] = c.g * b;
      col[i * 3 + 2] = c.b * b;
      size[i] = rng() < 0.06 ? 2.4 + rng() * 1.6 : 0.8 + rng() * 1.3;
      phase[i] = rng() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.uniforms = { uTime: { value: 0 }, uPR: { value: 1 }, uMap: { value: softDotTexture() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime; uniform float uPR;
        varying vec3 vC;
        void main(){
          float tw = 0.65 + 0.35 * sin(uTime * (0.6 + fract(aPhase) * 1.8) + aPhase);
          vC = aColor * tw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPR * 2.2;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec3 vC;
        void main(){ float a = texture(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.renderOrder = -10;
    this.points.frustumCulled = false;
  }
  update(t, pr) {
    this.uniforms.uTime.value = t;
    this.uniforms.uPR.value = pr;
  }
}

export class Particles {
  constructor(max = 1400) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.grav = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 }, uMap: { value: softDotTexture() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.05, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main(){ float a = texture(uMap, gl_PointCoord).a * vA; gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.rng = mulberry32(1234);
  }

  // origin & normal in world space. colors: array of THREE.Color
  emit(origin, normal, n, o = {}) {
    const rng = this.rng;
    const colors = o.colors || [new THREE.Color('#ffffff')];
    const speed = o.speed || [0.5, 1.5];
    const life = o.life || [0.5, 1.0];
    const size = o.size || [0.02, 0.05];
    const spread = o.spread ?? 0.8;
    const g = o.gravity ?? 1.5;
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
    t1.crossVectors(normal, Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    t2.crossVectors(normal, t1);
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
      d.copy(normal)
        .addScaledVector(t1, Math.cos(a) * r)
        .addScaledVector(t2, Math.sin(a) * r)
        .normalize();
      if (o.sphere) d.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const sp = speed[0] + rng() * (speed[1] - speed[0]);
      this.pos[i * 3] = origin.x + (o.jitter ? (rng() - 0.5) * o.jitter : 0);
      this.pos[i * 3 + 1] = origin.y + (o.jitter ? (rng() - 0.5) * o.jitter : 0);
      this.pos[i * 3 + 2] = origin.z + (o.jitter ? (rng() - 0.5) * o.jitter : 0);
      this.vel[i * 3] = d.x * sp;
      this.vel[i * 3 + 1] = d.y * sp;
      this.vel[i * 3 + 2] = d.z * sp;
      this.grav[i * 3] = -normal.x * g;
      this.grav[i * 3 + 1] = -normal.y * g;
      this.grav[i * 3 + 2] = -normal.z * g;
      const c = colors[Math.floor(rng() * colors.length)];
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.maxLife[i] = life[0] + rng() * (life[1] - life[0]);
      this.life[i] = this.maxLife[i];
      this.size0[i] = size[0] + rng() * (size[1] - size[0]);
      this.size[i] = this.size0[i];
      this.alpha[i] = 1;
      this.drag[i] = o.drag ?? 1.2;
      this.grow[i] = o.grow ?? 0;
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.count;
        if (i !== j) this._copy(j, i);
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] = this.vel[i * 3 + k] * dr + this.grav[i * 3 + k] * dt;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      }
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 1.6);
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    if (this.count) {
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
    }
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.col[to * 3 + k] = this.col[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.grav[to * 3 + k] = this.grav[from * 3 + k];
    }
    this.size[to] = this.size[from];
    this.alpha[to] = this.alpha[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.drag[to] = this.drag[from];
    this.grow[to] = this.grow[from];
  }

  clear() {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

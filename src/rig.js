// Camera framing + planet orientation (orbit) or board panning (flat boards).
import * as THREE from 'three';
import { clamp, easeInOutCubic } from './util.js';

const Z = new THREE.Vector3(0, 0, 1);

export class Rig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.q = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.gap = 3; // camera distance to the nearest surface
    this.gapTarget = 3;
    this.minGap = 0.5;
    this.maxGap = 8;
    this.R = 1;
    this.tile = 0.1;
    this.pan = new THREE.Vector2();
    this.panVel = new THREE.Vector2();
    this.panLimit = new THREE.Vector2();
    this.boardRot = 0;
    this.tilt = 0;
    this.focusAnim = null;
    this.panAnim = null;
    this.shake = 0;
    this.autoSpin = 0;
    this.dragging = false;
    this.vw = 1;
    this.vh = 1;
    this.hud = 170;
    this.introScale = 1;
  }

  setViewport(w, h, hudPx) {
    this.vw = w;
    this.vh = h;
    this.hud = hudPx;
    const aspect = w / h;
    const cam = this.camera;
    cam.aspect = aspect;
    // keep a usable horizontal field of view in portrait
    const vfov = aspect < 1 ? clamp((2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / aspect) * 180) / Math.PI, 40, 74) : 40;
    cam.fov = vfov;
    cam.updateProjectionMatrix();
  }

  get tanV() {
    return Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
  }
  get tanH() {
    return this.tanV * this.camera.aspect;
  }
  get tanVEff() {
    return this.tanV * Math.max(0.4, (this.vh - this.hud) / this.vh);
  }

  // pixels per world unit at a given distance from the camera
  ppu(dist) {
    return this.vh / 2 / (Math.max(0.01, dist) * this.tanV);
  }

  configure(shape, { touch = false, keep = false } = {}) {
    this.shape = shape;
    this.tile = shape.avgSize;
    this.focusAnim = null;
    this.panAnim = null;
    this.angVel.set(0, 0, 0);
    this.panVel.set(0, 0);
    const targetPx = touch ? 40 : 30;
    if (shape.kind === 'plane') {
      this.mode = 'pan';
      const portrait = this.vw < this.vh;
      const wide = shape.width > shape.height;
      this.boardRot = portrait && wide ? -Math.PI / 2 : 0;
      this.tilt = -0.2;
      const bw = (this.boardRot ? shape.height : shape.width) + shape.cellWorld * 1.4;
      const bh = (this.boardRot ? shape.width : shape.height) + shape.cellWorld * 1.4;
      this.R = 0;
      const fitGap = Math.max(bh / 2 / this.tanVEff, bw / 2 / this.tanH) * 1.04;
      const cellPx = (g) => shape.cellWorld * this.ppu(g);
      const tapGap = (shape.cellWorld * this.vh) / 2 / (targetPx * this.tanV);
      this.fitGap = fitGap;
      this.maxGap = fitGap * 1.25;
      this.minGap = Math.min(fitGap, (shape.cellWorld * this.vh) / 2 / (110 * this.tanV));
      this.gapTarget = keep ? clamp(this.gapTarget, this.minGap, this.maxGap) : cellPx(fitGap) < targetPx ? Math.max(tapGap, fitGap * 0.45) : fitGap;
      this.boardW = bw;
      this.boardH = bh;
      if (!keep) this.pan.set(0, 0);
    } else {
      this.mode = 'orbit';
      this.boardRot = 0;
      this.tilt = 0;
      const R = shape.radius + this.tile * 0.4;
      this.R = R;
      const sinHalf = Math.sin(Math.atan(Math.min(this.tanVEff, this.tanH)));
      const fitDist = (R / sinHalf) * 1.05;
      const fitGap = fitDist - R;
      // tile size in px when looking at the closest point
      const tilePx = (g) => 2 * this.tile * 0.87 * this.ppu(g);
      const tapGap = (2 * this.tile * 0.87 * this.vh) / 2 / (targetPx * this.tanV);
      this.fitGap = fitGap;
      this.maxGap = fitGap * 1.5;
      this.minGap = Math.max(R * 0.18, (2 * this.tile * 0.87 * this.vh) / 2 / (120 * this.tanV));
      this.gapTarget = keep ? clamp(this.gapTarget, this.minGap, this.maxGap) : tilePx(fitGap) < targetPx ? Math.max(tapGap, fitGap * 0.62) : fitGap;
    }
    if (!keep) this.gap = this.gapTarget * 1.6;
  }

  // ---- interaction ---------------------------------------------------------
  dragBy(dx, dy, dt) {
    this.focusAnim = null;
    this.panAnim = null;
    if (this.mode === 'orbit') {
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      const ang = (len * this.gap * this.tanV) / (this.R * (this.vh / 2));
      const axis = new THREE.Vector3(dy / len, dx / len, 0).applyQuaternion(this.camera.quaternion);
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      this.q.premultiply(dq);
      if (dt > 0) {
        const v = axis.multiplyScalar(ang / Math.max(dt, 1 / 120));
        this.angVel.lerp(v, 0.5);
      }
    } else {
      const wpp = (2 * this.gap * this.tanV) / this.vh;
      this.pan.x += dx * wpp;
      this.pan.y -= dy * wpp;
      this.clampPan();
      if (dt > 0) this.panVel.lerp(new THREE.Vector2((dx * wpp) / dt, (-dy * wpp) / dt), 0.5);
    }
  }

  startDrag() {
    this.dragging = true;
    this.angVel.set(0, 0, 0);
    this.panVel.set(0, 0);
    this.focusAnim = null;
  }
  endDrag(idleMs = 0) {
    this.dragging = false;
    if (idleMs > 80) {
      this.angVel.set(0, 0, 0);
      this.panVel.set(0, 0);
    }
  }

  zoomBy(factor) {
    this.gapTarget = clamp(this.gapTarget / factor, this.minGap, this.maxGap);
  }

  clampPan() {
    if (this.mode !== 'pan') return;
    const visH = this.gap * this.tanVEff;
    const visW = this.gap * this.tanH;
    const lx = Math.max(0, this.boardW / 2 - visW * 0.85);
    const ly = Math.max(0, this.boardH / 2 - visH * 0.85);
    this.pan.x = clamp(this.pan.x, -lx, lx);
    this.pan.y = clamp(this.pan.y, -ly, ly);
  }

  // Bring a local point (with its normal) to face the camera.
  focusLocal(localPos, localNormal, dur = 0.65) {
    if (this.mode === 'orbit') {
      const nWorld = localNormal.clone().applyQuaternion(this.q).normalize();
      const dq = new THREE.Quaternion().setFromUnitVectors(nWorld, Z);
      const target = dq.multiply(this.q.clone());
      this.focusAnim = { from: this.q.clone(), to: target, t: 0, dur };
      this.angVel.set(0, 0, 0);
    } else {
      // pan so the point is centred
      const p = localPos.clone();
      if (this.boardRot) p.applyAxisAngle(Z, this.boardRot);
      this.panAnim = { from: this.pan.clone(), to: new THREE.Vector2(-p.x, -p.y), t: 0, dur };
      this.panVel.set(0, 0);
    }
  }

  // Return the board/planet to a neutral view.
  recenter() {
    if (this.mode === 'pan') {
      this.panAnim = { from: this.pan.clone(), to: new THREE.Vector2(0, 0), t: 0, dur: 0.5 };
      this.gapTarget = this.fitGap;
    } else {
      this.gapTarget = this.fitGap;
    }
  }

  update(dt, group) {
    // orientation
    if (this.mode === 'orbit') {
      if (this.focusAnim) {
        const a = this.focusAnim;
        a.t += dt / a.dur;
        const k = easeInOutCubic(Math.min(1, a.t));
        this.q.copy(a.from).slerp(a.to, k);
        if (a.t >= 1) this.focusAnim = null;
      } else if (!this.dragging) {
        const sp = this.angVel.length();
        if (sp > 1e-4) {
          const dq = new THREE.Quaternion().setFromAxisAngle(this.angVel.clone().divideScalar(sp), sp * dt);
          this.q.premultiply(dq);
          this.angVel.multiplyScalar(Math.exp(-dt * 3.2));
        }
        if (this.autoSpin) {
          const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.25, 1, 0).normalize(), this.autoSpin * dt);
          this.q.premultiply(dq);
        }
      }
      group.quaternion.copy(this.q);
      group.position.set(0, 0, 0);
    } else {
      if (this.panAnim) {
        const a = this.panAnim;
        a.t += dt / a.dur;
        const k = easeInOutCubic(Math.min(1, a.t));
        this.pan.lerpVectors(a.from, a.to, k);
        if (a.t >= 1) this.panAnim = null;
        this.clampPan();
      } else if (!this.dragging && this.panVel.lengthSq() > 1e-8) {
        this.pan.addScaledVector(this.panVel, dt);
        this.panVel.multiplyScalar(Math.exp(-dt * 4));
        this.clampPan();
      }
      group.quaternion.setFromEuler(new THREE.Euler(this.tilt, 0, this.boardRot, 'XYZ'));
      group.position.set(this.pan.x, this.pan.y, 0);
    }
    group.scale.setScalar(this.introScale);
    // zoom
    this.gap += (this.gapTarget - this.gap) * (1 - Math.exp(-dt * 7));
    if (this.mode === 'pan') this.clampPan();
    const cam = this.camera;
    cam.position.set(0, 0, this.R + this.gap);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.06 * (this.R + 0.5);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    cam.lookAt(cam.position.x * 0.5, cam.position.y * 0.5, 0);
    cam.near = Math.max(0.01, this.gap * 0.2);
    cam.far = 400;
    cam.updateProjectionMatrix();
  }
}

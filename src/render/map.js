// Campaign map: a small star system, one orbit per world.
import * as THREE from 'three';
import { CAMPAIGN, THEMES } from '../levels.js';
import { Starfield, makeNebula } from './fx.js';
import { haloTexture } from './atlas.js';

const SUN_FS = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 q = vP * 3.0;
  float n = sin(q.x * 2.1 + uTime * 0.9) * sin(q.y * 2.7 - uTime * 0.7) * sin(q.z * 2.3 + uTime * 0.6);
  n += 0.5 * sin(q.x * 5.3 - uTime * 1.3) * sin(q.z * 4.1 + uTime);
  vec3 c = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.86, 0.45), 0.5 + 0.5 * n);
  float f = pow(1.0 - abs(vN.z), 2.0);
  gl_FragColor = vec4(c + f * vec3(1.0, 0.6, 0.2), 1.0);
}`;
const SUN_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function iconGeometry(spec) {
  switch (spec.shape) {
    case 'cube':
      return new THREE.BoxGeometry(0.64, 0.64, 0.64);
    case 'torus':
      return new THREE.TorusGeometry(0.36, 0.15, 14, 36);
    case 'asteroid': {
      const g = new THREE.IcosahedronGeometry(0.44, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        const d = v.clone().normalize();
        const k = 1 + 0.16 * Math.sin(d.x * 4.1 + 1.3) * Math.cos(d.y * 3.3 - 0.4) + 0.08 * Math.sin(d.z * 6.7);
        v.multiplyScalar(k);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    }
    default:
      return new THREE.IcosahedronGeometry(0.44, 2);
  }
}

function numberTexture(n) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '700 40px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(String(n).padStart(2, '0'), 64, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class MapView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.scene.background = makeNebula({ bgTop: '#03040a', bgBottom: '#0d0f24', nebula: ['#2a1d5a', '#173a5a', '#4a1d3a'], seed: 31 });
    this.stars = new Starfield(1300, 150);
    this.scene.add(this.stars.points);
    this.scene.add(new THREE.AmbientLight(0x8a96b8, 1.5));
    const light = new THREE.PointLight(0xffe2a8, 3.2, 0, 0);
    this.scene.add(light);

    this.sunU = { uTime: { value: 0 } };
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 32), new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: this.sunU }));
    this.scene.add(this.sun);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    halo.scale.set(5.6, 5.6, 1);
    this.scene.add(halo);

    this.worlds = [];
    CAMPAIGN.forEach((W, i) => {
      const th = THEMES[W.theme];
      const r = 2.7 + i * 1.3;
      const a = 0.9 + i * 2.39996;
      const pts = [];
      for (let k = 0; k <= 128; k++) {
        const t = (k / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r));
      }
      const orbit = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x8090b0, transparent: true, opacity: 0.18 })
      );
      this.scene.add(orbit);
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      const s = 0.8 + i * 0.05;
      const mat = new THREE.MeshLambertMaterial({ color: th.plateA, emissive: new THREE.Color(th.core), emissiveIntensity: 0.12, flatShading: true });
      const mesh = new THREE.Mesh(iconGeometry(W.shape), mat);
      mesh.scale.setScalar(s);
      mesh.rotation.set(0.4, i, 0.2);
      holder.add(mesh);
      if (th.rings) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.62, 0.95, 48),
          new THREE.MeshBasicMaterial({ color: th.ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
        );
        ring.rotation.x = Math.PI / 2 - 0.35;
        ring.scale.setScalar(s);
        holder.add(ring);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: new THREE.Color(th.atmo), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 }));
      glow.scale.setScalar(2.2 * s);
      holder.add(glow);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(i + 1), depthWrite: false, transparent: true }));
      label.scale.set(0.62, 0.31, 1);
      label.position.set(0, 0.95 * s, 0);
      holder.add(label);
      this.scene.add(holder);
      this.worlds.push({ holder, mesh, mat, glow, orbit, theme: th, size: s, label });
    });

    this.sel = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 0.71, 64),
      new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.scene.add(this.sel);
    this.selected = 0;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 6, 14);
    this.time = 0;
    this.fly = null;
  }

  setProgress(progress) {
    this.worlds.forEach((w, i) => {
      const unlocked = i < progress.unlocked;
      const done = !!progress.worlds[CAMPAIGN[i].id];
      w.mat.color.set(unlocked ? w.theme.plateA : '#323847');
      w.mat.emissiveIntensity = unlocked ? 0.14 : 0;
      w.glow.visible = unlocked;
      w.orbit.material.color.set(done ? w.theme.core : '#8090b0');
      w.orbit.material.opacity = done ? 0.55 : 0.16;
      w.label.material.opacity = unlocked ? 1 : 0.4;
    });
  }

  // look at the world from the side, mostly lit by the sun, and keep it in the upper half
  viewFor(i) {
    const p = this.worlds[i].holder.position;
    const radial = p.clone().setY(0).normalize();
    const side = new THREE.Vector3(-radial.z, 0, radial.x);
    const pos = p.clone().addScaledVector(side, 4.4).addScaledVector(radial, -1.5).add(new THREE.Vector3(0, 3.1, 0));
    const target = p.clone().add(new THREE.Vector3(0, -1.0, 0)).addScaledVector(side, -0.6);
    return { target, pos };
  }

  select(i, instant = false) {
    this.selected = i;
    if (instant) {
      const v = this.viewFor(i);
      this.camTarget.copy(v.target);
      this.camPos.copy(v.pos);
    }
  }

  flyInto(i) {
    const p = this.worlds[i].holder.position;
    this.fly = { from: this.camPos.clone(), to: p.clone().add(this.camPos.clone().sub(p).normalize().multiplyScalar(1.1)), t: 0 };
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? Math.min(70, (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) / (w / h)) * 180) / Math.PI) : 45;
    this.camera.updateProjectionMatrix();
  }

  update(dt, pr) {
    this.time += dt;
    this.sunU.uTime.value = this.time;
    this.stars.update(this.time, pr);
    this.worlds.forEach((w, i) => {
      w.mesh.rotation.y += dt * (0.25 + i * 0.02);
    });
    const v = this.viewFor(this.selected);
    const k = 1 - Math.exp(-dt * 3.2);
    this.camTarget.lerp(v.target, k);
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.7);
      const e = this.fly.t * this.fly.t;
      this.camPos.lerpVectors(this.fly.from, this.fly.to, e);
    } else this.camPos.lerp(v.pos, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    const sp = this.worlds[this.selected];
    this.sel.position.copy(sp.holder.position);
    this.sel.quaternion.copy(this.camera.quaternion);
    const pulse = 1 + 0.06 * Math.sin(this.time * 4);
    this.sel.scale.setScalar(sp.size * pulse);
  }

  pick(x, y, w, h) {
    let best = -1, bestD = Infinity;
    const v = new THREE.Vector3();
    this.worlds.forEach((wd, i) => {
      v.copy(wd.holder.position).project(this.camera);
      if (v.z > 1) return;
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < Math.max(44, h * 0.07) ? best : -1;
  }
}

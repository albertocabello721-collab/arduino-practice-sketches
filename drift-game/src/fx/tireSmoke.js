// Tire smoke from the rear wheels while they slide. One THREE.Points with a
// fixed pool of soft puffs (a single draw call), sized in world meters.

import * as THREE from 'three';
import { FX } from '../config.js';

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class TireSmoke {
  constructor() {
    const cfg = FX.smoke;
    this.cfg = cfg;
    const n = cfg.maxParticles;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(Infinity);
    this.life = new Float32Array(n);
    this.strength = new Float32Array(n);
    this.next = 0;
    this.carry = [0, 0];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(cfg.color) },
        uScale: { value: 500 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0 || vAlpha <= 0.0) discard;
          float a = 1.0 - r * r;
          gl_FragColor = vec4(uColor, vAlpha * a * a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  // pixels per meter at 1 m distance, so sizes stay in world units
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  // wheels: [{ x, y, z }, { x, y, z }] rear tire contact points
  update(dt, phys, wheels) {
    const cfg = this.cfg;
    const strength = phys.speed > 2 ? smoothstep(cfg.slipStart, cfg.slipFull, phys.rearSlip) : 0;
    for (let w = 0; w < wheels.length; w++) {
      this.carry[w] += cfg.rate * strength * dt;
      while (this.carry[w] >= 1) {
        this.carry[w] -= 1;
        this.spawn(wheels[w], phys, strength);
      }
      if (strength === 0) this.carry[w] = 0;
    }

    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < this.age.length; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const j = i * 3;
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag + cfg.rise * (1 - drag);
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = cfg.startSize + (cfg.endSize - cfg.startSize) * Math.pow(t, 0.6);
      const fadeIn = Math.min(1, this.age[i] / 0.12);
      this.alpha[i] = cfg.opacity * this.strength[i] * fadeIn * Math.pow(1 - t, 1.4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  spawn(at, phys, strength) {
    const i = this.next;
    this.next = (this.next + 1) % this.age.length;
    const j = i * 3;
    this.pos[j] = at.x + (Math.random() - 0.5) * 0.3;
    this.pos[j + 1] = at.y + 0.25;
    this.pos[j + 2] = at.z + (Math.random() - 0.5) * 0.3;
    // smoke keeps a little of the car's motion, plus some spread
    this.vel[j] = phys.vx * 0.2 + (Math.random() - 0.5) * 1.6;
    this.vel[j + 1] = 0.3 + Math.random() * 0.5;
    this.vel[j + 2] = phys.vz * 0.2 + (Math.random() - 0.5) * 1.6;
    this.age[i] = 0;
    this.life[i] = this.cfg.life * (0.75 + Math.random() * 0.5);
    this.strength[i] = 0.5 + strength * 0.5;
    this.size[i] = this.cfg.startSize;
    this.alpha[i] = 0;
  }
}

// Skid marks: dark strips laid on the ground behind each rear wheel while it
// slides. A fixed ring buffer of quads, so the oldest marks get reused.

import * as THREE from 'three';
import { FX } from '../config.js';

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class SkidMarks {
  constructor() {
    const cfg = FX.skids;
    this.cfg = cfg;
    const n = cfg.maxSegments;
    this.positions = new Float32Array(n * 4 * 3);
    this.colors = new Float32Array(n * 4 * 4);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const v = i * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.geo = geo;

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color(cfg.color);
    this.next = 0;
    this.trails = [null, null]; // last point per rear wheel while marking
  }

  // wheels: rear tire contact points [{ x, y, z }, ...]
  update(phys, wheels) {
    const cfg = this.cfg;
    const strength = phys.speed > 1.5 ? smoothstep(cfg.slipStart, cfg.slipFull, phys.rearSlip) : 0;
    for (let w = 0; w < wheels.length; w++) {
      const p = wheels[w];
      if (strength <= 0) {
        this.trails[w] = null;
        continue;
      }
      const last = this.trails[w];
      if (!last) {
        this.trails[w] = { x: p.x, y: p.y, z: p.z };
        continue;
      }
      if (Math.hypot(p.x - last.x, p.z - last.z) >= cfg.minSegment) {
        this.addSegment(last, p, strength * cfg.opacity);
        this.trails[w] = { x: p.x, y: p.y, z: p.z };
      }
    }
  }

  addSegment(a, b, alpha) {
    const i = this.next;
    this.next = (this.next + 1) % this.cfg.maxSegments;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (this.cfg.width / 2);
    const pz = (dx / len) * (this.cfg.width / 2);
    const ya = a.y + 0.02;
    const yb = b.y + 0.02;
    this.positions.set(
      [a.x - px, ya, a.z - pz, a.x + px, ya, a.z + pz, b.x - px, yb, b.z - pz, b.x + px, yb, b.z + pz],
      i * 12,
    );
    const { r, g, b: bl } = this.color;
    for (let k = 0; k < 4; k++) this.colors.set([r, g, bl, alpha], i * 16 + k * 4);

    const pos = this.geo.attributes.position;
    const col = this.geo.attributes.color;
    pos.addUpdateRange(i * 12, 12);
    col.addUpdateRange(i * 16, 16);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

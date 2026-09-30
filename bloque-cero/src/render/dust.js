// Polvo en la luz (F12.5): motas diminutas que flotan dentro de la casa, alrededor de la cámara, y
// solo se ven donde hay luz (junto a las ventanas de día, bajo las lámparas de noche). Solo dibujo.
import * as THREE from 'three';

const N = 180;
const BOX = { x: 7, y: 3, z: 7 };   // la caja alrededor de la cámara donde viven las motas

export class DustMotes {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * BOX.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.05;
      this.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ size: 0.012, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.lit = 0;             // cuántas se ven ahora (pruebas)
    this.t = 0;
    this.sample = { sky: 0, warm: 0, cool: 0 };
    scene.add(this.points);
  }

  /**
   * Cada fotograma: `cam` (posición), `indoor` 0…1, `lv` el volumen de luz (para saber dónde hay luz)
   * y `skyK` cuánto alumbra el cielo a esta hora (1 de día).
   */
  update(dt, cam, indoor, lv, skyK) {
    const show = indoor > 0.5;
    this.mat.opacity += ((show ? 0.9 : 0) - this.mat.opacity) * Math.min(1, dt * 2);
    this.points.visible = this.mat.opacity > 0.01;
    if (!this.points.visible) { this.lit = 0; return; }
    this.t += dt;
    const P = this.pos, C = this.col, V = this.vel, S = this.sample;
    this.points.position.set(cam.x, cam.y, cam.z);
    let lit = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      // deriva lenta con un poco de remolino; al salir de la caja, vuelve por el otro lado
      P[k] += (V[k] + Math.sin(this.t * 0.3 + i) * 0.01) * dt;
      P[k + 1] += (V[k + 1] + Math.cos(this.t * 0.23 + i * 1.7) * 0.006) * dt;
      P[k + 2] += (V[k + 2] + Math.sin(this.t * 0.27 + i * 2.3) * 0.01) * dt;
      if (P[k] > BOX.x / 2) P[k] -= BOX.x; else if (P[k] < -BOX.x / 2) P[k] += BOX.x;
      if (P[k + 1] > BOX.y / 2) P[k + 1] -= BOX.y; else if (P[k + 1] < -BOX.y / 2) P[k + 1] += BOX.y;
      if (P[k + 2] > BOX.z / 2) P[k + 2] -= BOX.z; else if (P[k + 2] < -BOX.z / 2) P[k + 2] += BOX.z;
      // cuánta luz hay donde está: la del cielo (ventanas) y la de las lámparas
      lv.sample(cam.x + P[k], cam.y + P[k + 1], cam.z + P[k + 2], S);
      const b = Math.min(1, S.sky * S.sky * skyK * 1.3 + S.warm * S.warm * 0.55);
      const v = b > 0.08 ? b : 0;
      if (v > 0) lit++;
      C[k] = v; C[k + 1] = v * 0.95; C[k + 2] = v * 0.82;
    }
    this.lit = lit;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

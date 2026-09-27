// Haces de los láseres (Fase 10.3): para cada operador con el láser encendido, una línea roja fina
// del arma a la primera pared y un punto rojo donde acaba. Lo ve todo el mundo (por eso delata). Una
// sola malla (cintas que miran a la cámara) y una llamada de dibujo. Del operador en primera persona
// sale de la cámara (abajo a la derecha, como su arma) hacia donde apunta.
import * as THREE from 'three';
import { raycastFirst } from '../world/raycast.js';

const MAX = 12;             // haces a la vez
const WIDTH = 0.004;        // m: medio ancho del haz
const DOT = 0.025;          // m: medio lado del punto

export class Lasers {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 8 * 3);        // por láser: la cinta (4 vértices) y el punto (4)
    this.alpha = new Float32Array(MAX * 8);
    this.uv = new Float32Array(MAX * 8 * 2);         // (el punto: esquinas en ±1 para hacerlo redondo)
    for (let i = 0; i < MAX; i++) this.uv.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 16 + 8);
    const idx = [];
    for (let i = 0; i < MAX * 2; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUV', new THREE.BufferAttribute(this.uv, 2));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'attribute float aAlpha; attribute vec2 aUV; varying float vA; varying vec2 vUV; void main(){ vA = aAlpha; vUV = aUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; varying vec2 vUV; void main(){ float a = vA; if (dot(vUV, vUV) > 0.0) a *= smoothstep(1.0, 0.25, length(vUV)); gl_FragColor = vec4(vec3(4.0, 0.16, 0.1) * a, a); }',
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._d = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
    this.count = 0;
  }

  /**
   * ops: los operadores; eye: el visto en primera persona (su haz sale de la cámara) o null;
   * camera: la cámara del mundo. `off`: sin haces (repetición de muerte).
   */
  update(ops, world, now, eye, camera, off = false) {
    let n = 0;
    if (!off) {
      const cam = camera.position;
      for (const op of ops) {
        if (n >= MAX || !op.laserOn) continue;
        const a = this._a, d = this._d;
        let len;
        if (op === eye) {
          // desde la cámara: abajo a la derecha, hacia el centro de la pantalla
          camera.getWorldDirection(d);
          this._r.set(1, 0, 0).applyQuaternion(camera.quaternion);
          this._u.set(0, 1, 0).applyQuaternion(camera.quaternion);
          const hit = raycastFirst(world, cam.x, cam.y, cam.z, d.x, d.y, d.z, 30);
          const end = this._b.copy(cam).addScaledVector(d, hit ? hit.t : 30);
          a.copy(cam).addScaledVector(d, 0.45).addScaledVector(this._r, 0.09).addScaledVector(this._u, -0.12);
          d.subVectors(end, a); len = d.length(); d.divideScalar(len || 1);
        } else {
          const B = op.laserBeam(world, now);
          a.set(B.o.x, B.o.y, B.o.z); d.set(B.d.x, B.d.y, B.d.z); len = B.len;
        }
        const b = this._b.copy(a).addScaledVector(d, len);
        // la cinta, de cara a la cámara; más viva junto al arma
        const side = this._s.subVectors(cam, a).cross(d).normalize().multiplyScalar(WIDTH);
        const o = n * 24;
        this.pos.set([a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z], o);
        this.alpha.set([0.55, 0.55, 0.18, 0.18], n * 8);
        // el punto, un cuadrado de cara a la cámara, un poco delante de la pared
        const p = b.addScaledVector(d, -0.02);
        const toCam = this._s.subVectors(cam, p).normalize();
        const r = this._r.set(0, 1, 0).cross(toCam); if (r.lengthSq() < 1e-6) r.set(1, 0, 0); r.normalize().multiplyScalar(DOT);
        const u = this._u.crossVectors(toCam, r).normalize().multiplyScalar(DOT);
        this.pos.set([p.x - r.x - u.x, p.y - r.y - u.y, p.z - r.z - u.z, p.x + r.x - u.x, p.y + r.y - u.y, p.z + r.z - u.z, p.x + r.x + u.x, p.y + r.y + u.y, p.z + r.z + u.z, p.x - r.x + u.x, p.y - r.y + u.y, p.z - r.z + u.z], o + 12);
        this.alpha.set([0.9, 0.9, 0.9, 0.9], n * 8 + 4);
        n++;
      }
    }
    this.count = n;
    const g = this.mesh.geometry;
    g.setDrawRange(0, n * 12);
    this.mesh.visible = n > 0;
    if (n) { g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; }
  }
}

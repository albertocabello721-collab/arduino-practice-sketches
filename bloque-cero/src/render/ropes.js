// Cuerdas del rappel (Fase 10.2a): para cada operador colgado de una fachada, una cuerda del borde
// del pretil (justo encima de él) al arnés, delante de la cadera. Cintas que miran a la cámara en
// una sola malla: una llamada de dibujo para todas.
import * as THREE from 'three';
import { BONE } from '../sim/skeleton.js';

const MAX = 10;
const WIDTH = 0.007;        // m: medio ancho de la cuerda

export class Ropes {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 4 * 3);
    const idx = [];
    for (let i = 0; i < MAX; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x3a3226, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._d = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.count = 0;
  }

  /** ops: los operadores; `off`: sin cuerdas (repetición de muerte). */
  update(ops, camera, off = false) {
    let n = 0;
    if (!off) {
      const cam = camera.position;
      for (const op of ops) {
        const R = op.rappel;
        if (n >= MAX || !R || op.state === 'dead' || !(R.phase === 'hang' || R.phase === 'hookGround' || R.phase === 'hookTop')) continue;
        const g = R.seg, pel = op.rig && op.rig[BONE.pelvis] ? op.rig[BONE.pelvis].p : { x: op.body.pos.x, y: op.body.pos.y + 0.85, z: op.body.pos.z };
        // arriba: sobre el borde del pretil, a la altura del que cuelga en el tramo
        const s = g.axis === 'x' ? op.body.pos.x : op.body.pos.z, c = g.line + g.out * (g.face + 0.02);
        const a = g.axis === 'x' ? this._a.set(s, g.top + 0.03, c) : this._a.set(c, g.top + 0.03, s);
        // abajo: el arnés, delante de la cadera (hacia la pared)
        const b = this._b.set(pel.x + g.nIn.x * 0.14, pel.y + 0.05, pel.z + g.nIn.z * 0.14);
        const d = this._d.subVectors(b, a).normalize();
        const side = this._s.subVectors(cam, a).cross(d).normalize().multiplyScalar(WIDTH);
        this.pos.set([a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z], n * 12);
        n++;
      }
    }
    this.count = n;
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
    if (n) geo.attributes.position.needsUpdate = true;
  }
}

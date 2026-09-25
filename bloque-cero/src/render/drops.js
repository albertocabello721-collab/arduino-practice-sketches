// Lo que cae al suelo y se queda un rato: cargadores sacados (20 s, como mucho 24) y los
// casquillos del revólver. Una sola malla con instancias (una llamada de dibujo) y una física
// sencilla contra los vóxeles: cae, rebota un poco y se queda tumbado.
import * as THREE from 'three';
import { SOLID } from '../world/materials.js';
import { VS } from '../world/voxelworld.js';

const MAX_MAGS = 24, MAX_CASINGS = 12, MAX = MAX_MAGS + MAX_CASINGS;
const LIFE = 20, FADE = 0.6;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Drops {
  /** lightAt(x, y, z): luz del lugar (0..1) para teñir lo que cae; onLand(pos, kind): al tocar el suelo */
  constructor(scene, world, lightAt, onLand = null) {
    this.world = world;
    this.lightAt = lightAt;
    this.onLand = onLand;
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vColor; varying vec3 vN;
        void main() {
          vColor = instanceColor;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying vec3 vN;
        void main() {
          float s = 0.45 + 0.55 * max(dot(vN, normalize(vec3(0.35, 1.0, 0.25))), 0.0);
          gl_FragColor = vec4(vColor * s, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    // (una instancia invisible el primer fotograma: el material se compila al cargar y no con el
    // primer cargador que cae)
    this.mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
    this.mesh.count = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
  }

  /**
   * kind 'mag' | 'casing'; pos {x,y,z}; quat THREE.Quaternion; size [x,y,z] (m); color [r,g,b]
   * lineal; vel {x,y,z}; spin (rad/s).
   */
  spawn(kind, pos, quat, size, color, vel, spin = 6) {
    const cap = kind === 'mag' ? MAX_MAGS : MAX_CASINGS;
    const same = this.items.filter((d) => d.kind === kind);
    if (same.length >= cap) {
      const old = same.reduce((a, b) => (a.life < b.life ? a : b));
      this.items.splice(this.items.indexOf(old), 1);
    }
    // tumbado, la dimensión más pequeña queda en vertical
    const [sx, sy, sz] = size;
    const flat = sx <= sy && sx <= sz ? [0, 0, Math.PI / 2] : sz <= sy ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    this.items.push({
      kind, size, color, base: color.slice(),
      pos: { x: pos.x, y: pos.y, z: pos.z }, vel: { x: vel.x, y: vel.y, z: vel.z },
      q: quat.clone(), spin: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
      half: Math.min(sx, sy, sz) / 2, flat, life: LIFE, rest: false, lit: -1,
    });
  }

  clear() { this.items.length = 0; this.mesh.count = 0; }

  update(dt) {
    const w = this.world, items = this.items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const d = items[i];
      d.life -= dt;
      if (d.life <= 0) { items.splice(i, 1); continue; }
      if (!d.rest) {
        d.vel.y -= 11 * dt;
        const nx = d.pos.x + d.vel.x * dt, ny = d.pos.y + d.vel.y * dt, nz = d.pos.z + d.vel.z * dt;
        if (SOLID[w.getWorld(nx, d.pos.y, d.pos.z)]) d.vel.x *= -0.3; else d.pos.x = nx;
        if (SOLID[w.getWorld(d.pos.x, d.pos.y, nz)]) d.vel.z *= -0.3; else d.pos.z = nz;
        if (SOLID[w.getWorld(d.pos.x, ny - d.half, d.pos.z)] && d.vel.y < 0) {
          // al suelo: rebote pequeño y, si ya va despacio, tumbado
          const top = Math.floor((ny - d.half - w.oy) / VS + 1e-6) * VS + VS + w.oy;
          d.pos.y = top + d.half;
          if (d.vel.y < -1.2 && this.onLand) this.onLand(d.pos, d.kind);
          d.vel.y *= -0.28; d.vel.x *= 0.55; d.vel.z *= 0.55; d.spin.multiplyScalar(0.45);
          if (Math.abs(d.vel.y) < 0.7) {
            d.rest = true;
            _e.set(d.flat[0], Math.random() * Math.PI * 2, d.flat[2], 'YXZ');
            d.q.setFromEuler(_e);
            d.lit = -1;
          }
        } else d.pos.y = ny;
        if (!d.rest) {
          _v.copy(d.spin).multiplyScalar(dt);
          const a = _v.length();
          if (a > 1e-6) { _q.setFromAxisAngle(_v.divideScalar(a), a); d.q.premultiply(_q); }
        }
      }
      // color según la luz del sitio (al caer y al quedarse quieto)
      if (d.lit < 0 || !d.rest) {
        const l = this.lightAt(d.pos.x, d.pos.y + 0.05, d.pos.z);
        d.color[0] = d.base[0] * l; d.color[1] = d.base[1] * l; d.color[2] = d.base[2] * l;
        d.lit = 1;
      }
      const k = Math.min(1, d.life / FADE);
      _s.set(d.size[0] * k, d.size[1] * k, d.size[2] * k);
      _v.set(d.pos.x, d.pos.y - (1 - k) * d.half, d.pos.z);
      _m.compose(_v, d.q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.instanceColor.setXYZ(n, d.color[0], d.color[1], d.color[2]);
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

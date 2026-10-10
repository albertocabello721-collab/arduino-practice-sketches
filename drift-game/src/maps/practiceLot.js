// Practice lot: a big flat square of asphalt ringed by barriers, with cone
// islands to drift around, a slalom, and knockable cones.
//
// Every map returns the same shape:
//   { id, name, group, walls, spawn, groundHeight(x, z), resetPose(car), update(dt, car) }

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeWalls } from '../physics/collisions.js';

const HALF = 100; // the lot is 200 x 200 m
const CONE_RADIUS = 0.28;
const CONE_CENTER = 0.25; // cone origin sits this far above its base
const CONE_LYING = 0.14; // center height when knocked over

export function createPracticeLot(renderer) {
  const group = new THREE.Group();

  group.add(makeGround(renderer));
  group.add(makeMarkings());
  group.add(makeBarriers());
  group.add(makeSurroundings());
  const cones = new Cones(coneLayout());
  group.add(cones.mesh);

  const walls = makeWalls(
    [
      [-HALF, -HALF],
      [HALF, -HALF],
      [HALF, HALF],
      [-HALF, HALF],
    ],
    true,
  );

  return {
    id: 'lot',
    name: 'Practice Lot',
    group,
    walls,
    spawn: { x: 0, z: -82, heading: 0 },
    groundHeight: () => 0,
    // R: stop and stand the car up where it is, inside the barriers.
    resetPose(car) {
      const lim = HALF - 4;
      return { x: clamp(car.x, -lim, lim), z: clamp(car.z, -lim, lim), heading: car.heading };
    },
    update(dt, car) {
      cones.update(dt, car);
    },
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------- ground

function makeGround(renderer) {
  const tex = asphaltTexture(renderer);
  tex.repeat.set(25, 25);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 2, HALF * 2 + 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

function asphaltTexture(renderer) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(215,212,205,${Math.random() * 0.18})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Painted lines: one merged mesh per paint color.
function makeMarkings() {
  const white = [];
  const yellow = [];
  // a flat strip w meters along x by l meters along z
  const strip = (list, x, z, w, l) => {
    const geo = new THREE.PlaneGeometry(w, l);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, 0, z);
    list.push(geo);
  };
  const ring = (list, x, z, r, w) => {
    const geo = new THREE.RingGeometry(r - w / 2, r + w / 2, 72);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, 0, z);
    list.push(geo.toNonIndexed());
  };

  // edge line 3 m inside the barriers
  const e = HALF - 3;
  strip(white, 0, -e, e * 2, 0.22);
  strip(white, 0, e, e * 2, 0.22);
  strip(white, -e, 0, 0.22, e * 2);
  strip(white, e, 0, 0.22, e * 2);
  // parking bays along the side barriers
  for (let z = -78; z <= 78; z += 3.2) {
    strip(white, -e + 2.6, z, 5.2, 0.14);
    strip(white, e - 2.6, z, 5.2, 0.14);
  }
  // drift circles around the two cone islands
  for (const x of [-50, 50]) {
    ring(white, x, 25, 15, 0.3);
    ring(white, x, 25, 24, 0.18);
  }
  // start box
  strip(yellow, 0, -82 - 5, 7.25, 0.25);
  strip(yellow, 0, -82 + 5, 7.25, 0.25);
  strip(yellow, -3.5, -82, 0.25, 10);
  strip(yellow, 3.5, -82, 0.25, 10);

  const out = new THREE.Group();
  const paint = (list, color) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.position.y = 0.01;
    mesh.receiveShadow = true;
    out.add(mesh);
  };
  paint(white, '#e4e1d6');
  paint(yellow, '#e3b733');
  return out;
}

// Red/white jersey barriers along the lot's edge (the collision walls).
function makeBarriers() {
  const profile = new THREE.Shape(
    [
      [-0.3, 0],
      [0.3, 0],
      [0.28, 0.12],
      [0.12, 0.32],
      [0.1, 0.84],
      [-0.1, 0.84],
      [-0.12, 0.32],
      [-0.28, 0.12],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const perSide = 66;
  const segLen = (HALF * 2) / perSide;
  const geo = new THREE.ExtrudeGeometry(profile, { depth: segLen - 0.08, bevelEnabled: false });
  geo.translate(0, 0, -(segLen - 0.08) / 2);

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, perSide * 4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const red = new THREE.Color('#c8372d');
  const white = new THREE.Color('#e7e3da');
  const up = new THREE.Vector3(0, 1, 0);
  let i = 0;
  for (const side of [0, 1, 2, 3]) {
    for (let k = 0; k < perSide; k++) {
      const t = -HALF + segLen * (k + 0.5);
      const off = HALF + 0.05;
      const pos = [
        new THREE.Vector3(t, 0, -off),
        new THREE.Vector3(off, 0, t),
        new THREE.Vector3(t, 0, off),
        new THREE.Vector3(-off, 0, t),
      ][side];
      q.setFromAxisAngle(up, side % 2 === 0 ? Math.PI / 2 : 0);
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, k % 2 === 0 ? red : white);
      i++;
    }
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- scenery

function makeSurroundings() {
  const out = new THREE.Group();

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshStandardMaterial({ color: '#6f9152', roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  out.add(grass);

  out.add(makeLightPoles());
  out.add(makeTrees());
  out.add(makeHills());
  return out;
}

function makeLightPoles() {
  const parts = [];
  const spots = [];
  for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || z) spots.push([x * (HALF + 7), z * (HALF + 7)]);
  for (const [x, z] of spots) {
    const pole = new THREE.CylinderGeometry(0.12, 0.18, 10, 8);
    pole.translate(x, 5, z);
    // arm points toward the lot
    const ang = Math.atan2(-x, -z);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 2.4);
    arm.translate(0, 0, 1.1);
    arm.rotateY(ang);
    arm.translate(x, 9.8, z);
    const lamp = new THREE.BoxGeometry(0.7, 0.22, 0.9);
    lamp.translate(0, 0, 2.3);
    lamp.rotateY(ang);
    lamp.translate(x, 9.7, z);
    parts.push(pole.toNonIndexed(), arm.toNonIndexed(), lamp.toNonIndexed());
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: '#5d6066', roughness: 0.6, metalness: 0.4, flatShading: true }));
  mesh.castShadow = true;
  return mesh;
}

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function makeTrees() {
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  const low = new THREE.ConeGeometry(2.4, 4.2, 7);
  low.translate(0, 4.0, 0);
  const high = new THREE.ConeGeometry(1.7, 3.4, 7);
  high.translate(0, 6.2, 0);
  const geo = mergeGeometries([colored(trunk, '#6b4a33'), colored(low, '#ffffff'), colored(high, '#ffffff')]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const count = 240;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const greens = ['#3f6b38', '#4c7a3c', '#365f37', '#56823f'].map((h) => new THREE.Color(h));
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 128 + Math.pow(Math.random(), 0.7) * 260;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    const k = 0.8 + Math.random() * 0.8;
    s.set(k, k * (0.85 + Math.random() * 0.4), k);
    m.compose(new THREE.Vector3(x, 0, z), q, s);
    mesh.setMatrixAt(i, m);
    // the instance color multiplies the vertex colors: it paints the white
    // foliage green and just darkens the brown trunk
    mesh.setColorAt(i, greens[i % greens.length]);
  }
  mesh.castShadow = true;
  return mesh;
}

function makeHills() {
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.25;
    const dist = 560 + Math.random() * 140;
    const r = 90 + Math.random() * 90;
    const h = 45 + Math.random() * 80;
    const hill = new THREE.ConeGeometry(r, h, 6 + Math.floor(Math.random() * 3), 1);
    hill.rotateY(Math.random() * Math.PI);
    hill.translate(Math.cos(ang) * dist, h / 2 - 2, Math.sin(ang) * dist);
    parts.push(colored(hill, i % 2 ? '#6f8f7a' : '#7d9a84'));
  }
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
}

// ---------------------------------------------------------------- cones

function coneLayout() {
  const spots = [];
  // slalom up the middle from the start box
  for (let i = 0; i < 7; i++) spots.push([0, -58 + i * 11]);
  // two cone islands for a figure eight
  for (const cx of [-50, 50]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spots.push([cx + Math.cos(a) * 4.5, 25 + Math.sin(a) * 4.5]);
    }
    spots.push([cx, 25]);
  }
  // a gate at the far end and corner markers
  for (const x of [-7, -3.5, 3.5, 7]) spots.push([x, 70]);
  for (const [x, z] of [[-85, -85], [85, -85], [-85, 85], [85, 85]]) {
    spots.push([x, z], [x + 1.2, z], [x, z + 1.2]);
  }
  return spots;
}

function coneGeometry() {
  const base = new THREE.BoxGeometry(0.4, 0.04, 0.4);
  base.translate(0, 0.02, 0);
  const body = new THREE.ConeGeometry(0.16, 0.66, 12, 1, true);
  body.translate(0, 0.04 + 0.33, 0);
  const band = new THREE.CylinderGeometry(0.075, 0.104, 0.12, 12, 1, true);
  band.translate(0, 0.36, 0);
  const geo = mergeGeometries([colored(base, '#2a2a2a'), colored(body, '#ff6418'), colored(band, '#f4f1ea')]);
  geo.translate(0, -CONE_CENTER, 0);
  return geo;
}

class Cones {
  constructor(spots) {
    this.mesh = new THREE.InstancedMesh(
      coneGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true, side: THREE.DoubleSide }),
      spots.length,
    );
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cones = spots.map(([x, z]) => ({
      pos: new THREE.Vector3(x, CONE_CENTER, z),
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      down: false, // knocked over
      moving: false,
    }));
    this.matrix = new THREE.Matrix4();
    this.one = new THREE.Vector3(1, 1, 1);
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.cones.forEach((c, i) => this.write(i, c));
  }

  write(i, c) {
    this.matrix.compose(c.pos, c.quat, this.one);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  update(dt, car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let dirty = false;
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      const dx = c.pos.x - car.x;
      const dz = c.pos.z - car.z;
      if (dx * dx + dz * dz < 16 && c.pos.y < 1.6) {
        const u = dx * fx + dz * fz; // along the car
        const v = dx * fz - dz * fx; // across the car
        const penU = car.halfLength + CONE_RADIUS - Math.abs(u);
        const penV = car.halfWidth + CONE_RADIUS - Math.abs(v);
        if (penU > 0 && penV > 0 && car.speed > 0.5) {
          // move it out along whichever side of the car it's closest to
          if (penU < penV) {
            c.pos.x += fx * (penU + 0.05) * Math.sign(u);
            c.pos.z += fz * (penU + 0.05) * Math.sign(u);
          } else {
            c.pos.x += fz * (penV + 0.05) * Math.sign(v);
            c.pos.z -= fx * (penV + 0.05) * Math.sign(v);
          }
          this.knock(c, car, dx, dz);
        }
      }
      if (c.moving) {
        this.simulate(c, dt);
        dirty = true;
        this.write(i, c);
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  knock(c, car, dx, dz) {
    const d = Math.hypot(dx, dz) || 1;
    const push = 2 + car.speed * 0.25;
    c.vel.set(car.vx * 1.1 + (dx / d) * push, Math.min(1.5 + car.speed * 0.15, 7), car.vz * 1.1 + (dz / d) * push);
    c.vel.x += (Math.random() - 0.5) * 2;
    c.vel.z += (Math.random() - 0.5) * 2;
    c.spin.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize().multiplyScalar(6 + car.speed * 0.5);
    c.down = true;
    c.moving = true;
  }

  simulate(c, dt) {
    c.vel.y -= 9.81 * dt;
    c.pos.addScaledVector(c.vel, dt);
    const lim = HALF - 0.5;
    if (Math.abs(c.pos.x) > lim) {
      c.pos.x = Math.sign(c.pos.x) * lim;
      c.vel.x *= -0.3;
    }
    if (Math.abs(c.pos.z) > lim) {
      c.pos.z = Math.sign(c.pos.z) * lim;
      c.vel.z *= -0.3;
    }
    const angle = c.spin.length() * dt;
    if (angle > 0) {
      this.tmpQ.setFromAxisAngle(this.tmpV.copy(c.spin).normalize(), angle);
      c.quat.premultiply(this.tmpQ);
    }
    const floor = c.down ? CONE_LYING : CONE_CENTER;
    if (c.pos.y <= floor) {
      c.pos.y = floor;
      if (c.vel.y < 0) c.vel.y *= -0.25;
      const f = Math.exp(-4 * dt);
      c.vel.x *= f;
      c.vel.z *= f;
      c.spin.multiplyScalar(Math.exp(-5 * dt));
      // settle onto its side, keeping the direction it fell
      const axis = this.tmpV.set(0, 1, 0).applyQuaternion(c.quat);
      axis.y = 0;
      if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
      axis.normalize();
      this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      c.quat.slerp(this.tmpQ, 1 - Math.exp(-6 * dt));
      if (c.vel.lengthSq() < 0.05 && c.spin.lengthSq() < 0.2) {
        c.quat.copy(this.tmpQ);
        c.moving = false;
      }
    }
  }
}

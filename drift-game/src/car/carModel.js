// Low-poly car built from code: an extruded side profile for the body (with
// wheel arches cut into it), a narrower glass cabin, a roof panel, lights and
// four wheels. Everything is driven by the car's config entry.

import * as THREE from 'three';

const BODY_BASE = 0.05; // body bottom height before ride height is added
const BEVEL = 0.04;
const LEAN_PIVOT = 0.45; // height the body leans around
const MAX_LEAN = 0.09; // rad

export class CarModel {
  constructor(car) {
    this.car = car;
    const fw = car.frontWeight;
    this.frontAxle = car.dims.wheelbase * (1 - fw);
    this.rearAxle = -car.dims.wheelbase * fw;

    this.root = new THREE.Group();
    this.body = new THREE.Group(); // lean pivot
    this.body.position.y = LEAN_PIVOT;
    this.shell = new THREE.Group();
    this.body.add(this.shell);
    this.root.add(this.body);

    this.bodyMat = new THREE.MeshStandardMaterial({ color: car.color.body, roughness: 0.42, metalness: 0.25, flatShading: true });
    this.wheelMat = new THREE.MeshStandardMaterial({ color: car.color.wheel, roughness: 0.35, metalness: 0.7, flatShading: true });

    this.buildBody();
    this.buildWheels();
    this.setRideHeight(car.rideHeight);

    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    this.spin = 0;
    this.roll = 0;
    this.pitch = 0;
  }

  setColors(body, wheel) {
    this.bodyMat.color.set(body);
    this.wheelMat.color.set(wheel);
  }

  setRideHeight(h) {
    this.shell.position.y = BODY_BASE + h - LEAN_PIVOT;
  }

  buildBody() {
    const { dims, look } = this.car;
    const r = dims.wheelRadius;
    const zMid = (this.frontAxle + this.rearAxle) / 2;
    const zFront = zMid + dims.length / 2;
    const zRear = zMid - dims.length / 2;
    // wheel centers in body coordinates, at the default ride height
    const wheelV = r - (BODY_BASE + this.car.rideHeight);
    const archR = r + 0.06;

    const pts = [];
    pts.push([zRear + 0.08, 0]);
    pushArch(pts, this.rearAxle, wheelV, archR);
    pushArch(pts, this.frontAxle, wheelV, archR);
    pts.push(
      [zFront - 0.06, 0],
      [zFront, 0.24],
      [zFront - 0.04, look.nose - 0.06],
      [zFront - 0.18, look.nose],
      [look.windshield[0], look.cowl],
      [look.rearWindow[1], look.deck],
      [zRear + 0.1, look.tail],
      [zRear, look.tail - 0.1],
      [zRear - 0.02, 0.22],
    );
    const width = dims.width - BEVEL * 2;
    const shell = new THREE.Mesh(extrudeProfile(pts, width), this.bodyMat);
    this.shell.add(shell);

    // glass cabin
    const cabinW = dims.width * look.cabinWidth;
    const cabin = extrudeProfile(
      [
        [look.windshield[0] + 0.04, look.cowl - 0.04],
        [look.windshield[1], look.roof],
        [look.rearWindow[0], look.roof],
        [look.rearWindow[1] - 0.04, look.deck - 0.04],
      ],
      cabinW - BEVEL * 2,
    );
    const glassMat = new THREE.MeshStandardMaterial({ color: '#2c3c4d', roughness: 0.2, metalness: 0.15, flatShading: true });
    this.shell.add(new THREE.Mesh(cabin, glassMat));

    // roof panel in body color
    const roofLen = look.windshield[1] - look.rearWindow[0] + 0.06;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinW + 0.02, 0.05, roofLen), this.bodyMat);
    roof.position.set(0, look.roof + BEVEL, (look.windshield[1] + look.rearWindow[0]) / 2);
    this.shell.add(roof);

    // lights and grille
    const headMat = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#fff1c8', emissiveIntensity: 0.6 });
    const tailMat = new THREE.MeshStandardMaterial({ color: '#b3121a', emissive: '#e01b22', emissiveIntensity: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6 });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.09, 0.06);
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(lampGeo, headMat);
      head.position.set(side * dims.width * 0.3, look.nose - 0.1, zFront + 0.02);
      const tail = new THREE.Mesh(lampGeo, tailMat);
      tail.position.set(side * dims.width * 0.3, look.tail - 0.14, zRear - 0.06);
      this.shell.add(head, tail);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.34, 0.08, 0.05), darkMat);
    grille.position.set(0, look.nose - 0.12, zFront + 0.02);
    this.shell.add(grille);
  }

  buildWheels() {
    const { dims } = this.car;
    const r = dims.wheelRadius;
    const tireW = 0.21;
    const tireGeo = new THREE.CylinderGeometry(r, r, tireW, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.03, 10);
    rimGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.9, flatShading: true });

    this.wheels = [];
    for (const front of [true, false]) {
      for (const side of [1, -1]) {
        const pivot = new THREE.Group(); // steers
        pivot.position.set((side * dims.track) / 2, r, front ? this.frontAxle : this.rearAxle);
        const spin = new THREE.Group(); // rolls
        const rim = new THREE.Mesh(rimGeo, this.wheelMat);
        rim.position.x = side * (tireW / 2 + 0.005);
        spin.add(new THREE.Mesh(tireGeo, tireMat), rim);
        pivot.add(spin);
        this.root.add(pivot);
        this.wheels.push({ pivot, spin, front });
      }
    }
  }

  // pose = interpolated { x, y, z, heading }; phys = latest physics state
  update(pose, phys, dt) {
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.heading;

    this.spin += (phys.forwardSpeed / this.car.dims.wheelRadius) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.spin;
      w.pivot.rotation.y = w.front ? phys.steer : 0;
    }

    // lean: roll away from the turn, squat on throttle, dive on the brakes
    const k = 1 - Math.exp(-dt * 8);
    const rollTarget = clampLean(phys.accelLat * this.car.bodyRoll);
    const pitchTarget = clampLean(-phys.accelLong * this.car.bodyPitch);
    this.roll += (rollTarget - this.roll) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }
}

function clampLean(v) {
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, v));
}

// Wheel arch: from the bottom edge, up and over the wheel center (z, v).
function pushArch(pts, z, v, radius) {
  const d = Math.sqrt(Math.max(radius * radius - v * v, 0));
  const start = Math.atan2(-v, -d) + Math.PI * 2;
  const end = Math.atan2(-v, d);
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    pts.push([z + Math.cos(a) * radius, v + Math.sin(a) * radius]);
  }
}

// Side profile [[z, y], ...] extruded across the car's width, centered on x = 0.
function extrudeProfile(points, width) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 1,
    curveSegments: 1,
  });
  // shape x -> car z, shape y -> car y, extrusion -> car x
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

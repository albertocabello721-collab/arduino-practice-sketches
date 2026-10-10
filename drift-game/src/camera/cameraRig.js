// Chase camera that swings partly toward where the car is sliding, and a
// hood camera. C toggles between them.

import * as THREE from 'three';
import { CAMERA } from '../config.js';

const DEG = Math.PI / 180;

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.chase.fov, aspect, 0.1, 2500);
    this.mode = 'chase';
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.needsSnap = true;
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'hood' : 'chase';
    this.camera.fov = CAMERA[this.mode].fov;
    this.camera.updateProjectionMatrix();
    this.needsSnap = true;
  }

  // jump straight to the target next frame (after a reset or camera switch)
  snap() {
    this.needsSnap = true;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // pose = rendered car { x, y, z, heading }; phys = physics state
  update(dt, pose, phys) {
    if (this.mode === 'hood') this.updateHood(pose);
    else this.updateChase(dt, pose, phys);
    this.needsSnap = false;
  }

  updateChase(dt, pose, phys) {
    const c = CAMERA.chase;
    // swing toward the direction of travel, only while rolling forward
    let target = pose.heading;
    if (phys.forwardSpeed > 2) {
      const swing = Math.max(-c.maxSwing, Math.min(c.maxSwing, phys.driftAngle * c.driftSwing));
      target += swing * DEG;
    }
    if (this.needsSnap) this.yaw = target;
    else this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-c.yawFollow * dt));

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const want = new THREE.Vector3(pose.x - sin * c.distance, pose.y + c.height, pose.z - cos * c.distance);
    if (this.needsSnap) this.pos.copy(want);
    else this.pos.lerp(want, 1 - Math.exp(-c.posFollow * dt));

    this.look.set(pose.x + sin * c.lookAhead, pose.y + c.lookHeight, pose.z + cos * c.lookAhead);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  updateHood(pose) {
    const h = CAMERA.hood;
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    // car-space offset: x = left, z = forward
    this.camera.position.set(
      pose.x + fz * h.offset.x + fx * h.offset.z,
      pose.y + h.offset.y,
      pose.z - fx * h.offset.x + fz * h.offset.z,
    );
    this.look.set(this.camera.position.x + fx * h.lookDistance, this.camera.position.y - 0.6, this.camera.position.z + fz * h.lookDistance);
    this.camera.lookAt(this.look);
  }
}

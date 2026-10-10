// Arcade car model ("bicycle" model): the four tires are lumped into one front
// and one rear axle. Each axle makes a sideways force from its slip angle (the
// angle between where the tire points and where it is actually moving). The
// rear tire losing grip — from the handbrake, too much steering at speed, or
// throttle while turning — is what turns the car into a drift.
//
// Pure math on plain numbers (no Three.js) so it can be run headless.
// Conventions: world x/z plane, heading h, forward = (sin h, cos h),
// left = (cos h, -sin h). Positive yaw rate turns left. Positive steer
// input means "turn right" (D key); positive wheel angle means pointing left.

import { PHYSICS } from '../config.js';
import { collideWalls } from './collisions.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Sideways force of one axle for a slip angle (rad). Linear until the force
// reaches `cap`, then fades to cap * slideGrip. If `spin` is given, the force
// climbs back to cap * spinGrip at large slip (arcade anti-spin).
function tireForce(slip, stiffness, cap, slideGrip, falloff, spin) {
  const a = Math.abs(slip);
  let f = stiffness * a;
  if (f > cap) {
    const peak = cap / stiffness;
    let k = lerp(1, slideGrip, Math.min(1, (a - peak) / falloff));
    if (spin && a > spin.from) {
      k = lerp(k, spin.grip, Math.min(1, (a - spin.from) / (spin.to - spin.from)));
    }
    f = cap * k;
  }
  return slip > 0 ? -f : f;
}

export class CarPhysics {
  constructor(stats) {
    this.setStats(stats);
    this.reset(0, 0, 0);
  }

  // stats = a car entry from CARS, optionally with tuning overrides merged in.
  setStats(stats) {
    this.s = stats;
    const L = stats.dims.wheelbase;
    this.a = L * (1 - stats.frontWeight); // center of mass -> front axle
    this.b = L * stats.frontWeight; // center of mass -> rear axle
    this.mass = stats.mass;
    this.inertia = stats.mass * this.a * this.b * stats.inertiaScale;
    this.halfLength = stats.dims.length / 2;
    this.halfWidth = stats.dims.width / 2;
    this.spin = { from: stats.spinFrom * DEG, to: stats.spinTo * DEG, grip: stats.spinGrip };
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steer = 0; // current front wheel angle (rad)
    this.throttle = 0; // smoothed drive command, -1..1 (negative = reverse)
    this.accelLong = 0; // smoothed local accelerations (m/s^2), for weight shift and body lean
    this.accelLat = 0;

    // read-only outputs for camera, effects, scoring and HUD
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.driftAngle = 0; // deg, signed: + when the car moves to the left of where it points
    this.rearSlip = 0; // m/s the rear axle is sliding sideways (or skidding on the handbrake)
    this.handbrake = false;
    this.impact = 0; // biggest wall hit since the caller last cleared it (m/s of speed lost)
  }

  step(dt, input, map) {
    const s = this.s;
    const m = this.mass;
    const g = PHYSICS.gravity;
    const L = s.dims.wheelbase;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);

    let vF = this.vx * sinH + this.vz * cosH; // forward speed
    let vL = this.vx * cosH - this.vz * sinH; // leftward speed
    const speed = Math.hypot(vF, vL);

    // ---- throttle, brake, reverse ----
    // Moving forward: W drives, S brakes. Moving backward: S drives in reverse,
    // W brakes. Near a stop, W goes forward and S reverses.
    let cmd = 0;
    let brakeCmd = 0;
    if (vF > 1) {
      cmd = input.throttle;
      brakeCmd = input.brake;
    } else if (vF < -1) {
      cmd = -input.brake;
      brakeCmd = input.throttle;
    } else {
      cmd = input.throttle - input.brake;
    }
    const rate = Math.abs(cmd) > Math.abs(this.throttle) ? s.throttleRise : s.throttleFall;
    this.throttle += clamp(cmd - this.throttle, -rate * dt, rate * dt);

    let drive = 0;
    if (this.throttle > 0) {
      drive = this.throttle * Math.min(s.maxDriveForce, (s.power * 1000) / Math.max(vF, 1));
    } else if (this.throttle < 0) {
      const fade = 1 - smoothstep(s.maxReverseSpeed * 0.7, s.maxReverseSpeed, -vF);
      drive = this.throttle * s.reverseForce * fade;
    }
    this.handbrake = !!input.handbrake;
    if (this.handbrake) drive *= 1 - s.handbrakeDriveCut;

    // ---- axle loads, with weight shifting forward under braking ----
    const shift = (m * this.accelLong * s.cgHeight) / L;
    const Nf = Math.max(m * g * s.frontWeight - shift, 0.15 * m * g);
    const Nr = Math.max(m * g * (1 - s.frontWeight) + shift, 0.15 * m * g);

    // ---- steering ----
    // At parking speed the key sets the wheel angle directly. At speed it sets
    // how hard the front tires bite: the wheels aim relative to the direction
    // the front axle is actually moving. That keeps a held key from plowing the
    // front (so a sharp turn breaks the rear loose instead), and with no key the
    // wheels follow the slide like a real self-aligning front end — automatic
    // counter-steer, which is what makes drifts holdable on a keyboard.
    const lock = s.steerLock * DEG;
    const steerIn = clamp(input.steer, -1, 1);
    const frontVelAngle = vF > 1 ? Math.atan2(vL + this.yawRate * this.a, vF) : 0;
    const absolute = -steerIn * lock;
    const bySlip = s.selfAlign * frontVelAngle - steerIn * s.steerSlip * DEG;
    const target = clamp(lerp(absolute, bySlip, smoothstep(4, 12, vF)), -lock, lock);
    this.steer += clamp(target - this.steer, -s.steerSpeed * dt, s.steerSpeed * dt);
    const delta = this.steer;

    // ---- tire forces ----
    const throttleCut = s.throttleOversteer * Math.max(this.throttle, 0) * smoothstep(3, 10, speed);
    const hb = this.handbrake ? s.handbrakeGrip : 1;
    const capF = s.frontGrip * Nf;
    const capR = s.rearGrip * Nr * (1 - throttleCut) * hb;
    const stiffF = (s.frontGrip * Nf) / (s.peakSlipFront * DEG);
    const stiffR = (s.rearGrip * Nr) / (s.peakSlipRear * DEG);

    const denom = Math.max(Math.abs(vF), 3);
    const dir = vF >= 0 ? 1 : -1;
    const slipF = Math.atan2(vL + this.yawRate * this.a, denom) - delta * dir;
    const slipR = Math.atan2(vL - this.yawRate * this.b, denom);
    const Ffy = tireForce(slipF, stiffF, capF, s.frontSlideGrip, s.slideFalloff * DEG, null);
    const Fry = tireForce(slipR, stiffR, capR, s.rearSlideGrip, s.slideFalloff * DEG, this.spin);

    // ---- integrate in world space ----
    const fwdForce = drive - Ffy * Math.sin(delta);
    const latForce = Ffy * Math.cos(delta) + Fry;
    let torque = this.a * Ffy * Math.cos(delta) - this.b * Fry;
    torque -= s.yawDamping * this.inertia * this.yawRate;

    const dragK = (s.drag * speed) / m;
    this.vx += ((fwdForce * sinH + latForce * cosH) / m - dragK * this.vx) * dt;
    this.vz += ((fwdForce * cosH - latForce * sinH) / m - dragK * this.vz) * dt;
    this.yawRate += (torque / this.inertia) * dt;

    // Brakes, rolling resistance and the locked rear wheels slow the car but
    // never push it backwards, so they're applied as a clamped speed loss.
    vF = this.vx * sinH + this.vz * cosH;
    vL = this.vx * cosH - this.vz * sinH;
    const rolling = s.rollingResistance * m * g * Math.min(1, Math.abs(vF) / 0.5);
    const hbDrag = this.handbrake ? s.handbrakeDrag * Nr : 0;
    const slow = ((brakeCmd * s.brakeForce + rolling + hbDrag) / m) * dt;
    vF = Math.abs(vF) <= slow ? 0 : vF - Math.sign(vF) * slow;

    // Below walking pace, blend into a simple no-slide model so the car can
    // creep, turn and stop without jitter.
    const k = smoothstep(0.5, 3.5, Math.hypot(vF, vL));
    vL *= Math.exp(-25 * (1 - k) * dt);
    const yawKinematic = (vF * Math.tan(delta)) / L;
    this.yawRate = lerp(this.yawRate, yawKinematic, 1 - Math.exp(-20 * (1 - k) * dt));

    this.vx = vF * sinH + vL * cosH;
    this.vz = vF * cosH - vL * sinH;
    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // smoothed accelerations (for weight shift next step and body lean)
    const smooth = 1 - Math.exp(-dt / 0.12);
    const longAcc = (fwdForce - Math.sign(vF) * (brakeCmd * s.brakeForce + hbDrag)) / m;
    this.accelLong += (longAcc - this.accelLong) * smooth;
    this.accelLat += (latForce / m - this.accelLat) * smooth;

    if (map) {
      const hit = collideWalls(this, map.walls);
      if (hit > this.impact) this.impact = hit;
      this.y = map.groundHeight(this.x, this.z);
    }

    // ---- outputs ----
    const sinN = Math.sin(this.heading);
    const cosN = Math.cos(this.heading);
    this.forwardSpeed = this.vx * sinN + this.vz * cosN;
    this.lateralSpeed = this.vx * cosN - this.vz * sinN;
    this.speed = Math.hypot(this.vx, this.vz);
    this.driftAngle = this.speed > 1 ? Math.atan2(this.lateralSpeed, this.forwardSpeed) / DEG : 0;
    let rearSlip = Math.abs(this.lateralSpeed - this.yawRate * this.b);
    if (this.handbrake) rearSlip = Math.max(rearSlip, Math.abs(this.forwardSpeed) * 0.6);
    this.rearSlip = rearSlip;
  }
}

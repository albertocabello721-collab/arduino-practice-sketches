// Operador: el cuerpo que controla un jugador o un bot. Movimiento táctico,
// posturas (de pie, agachado, cuerpo a tierra), asomarse, saltar obstáculos,
// trepar escaleras de mano y manejo del arma. Recibe "intenciones" cada tick
// (del teclado o de la IA) y emite eventos para render, audio e IA.
import { Body, STANCES, stepBody, tryResize, findVault, boxFree } from './physics.js';
import { WeaponState, WEAPONS } from './weapons.js';
import { clamp, damp, DEG } from '../core/math.js';
import { SOUND } from '../world/materials.js';

const LEAN_DIST = 0.38;      // desplazamiento lateral de la cabeza al asomarse (m)
const LEAN_ROLL = 13 * DEG;  // giro de cámara al asomarse
const SPEED = { walk: 3.3, sprint: 5.4, crouch: 1.85, prone: 0.8, adsMul: 0.62, leanMul: 0.9 };

export function makeIntent() {
  return {
    moveX: 0, moveZ: 0,      // -1..1 (derecha, adelante)
    sprint: false,
    stance: 'stand',          // postura deseada
    lean: 0,                  // -1 izquierda, 0, 1 derecha
    ads: false, fire: false, reload: false, vault: false,
    switchTo: -1,
    climb: 0,
  };
}

export class Operator {
  constructor(id, opts = {}) {
    this.id = id;
    this.name = opts.name || 'Operador';
    this.team = opts.team ?? 0;
    this.speedMul = opts.speedMul ?? 1;
    this.body = new Body(opts.x || 0, opts.y || 0, opts.z || 0);
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.eyeHeight = STANCES.stand.eye;   // suavizada
    this.lean = 0;           // animado (-1..1)
    this.leanAllowed = 0;    // tras colisión
    this.ads = 0;            // 0..1
    this.sprinting = false;
    this.vault = null;       // {t, dur, from, to}
    this.intent = makeIntent();
    const loadout = opts.loadout || ['ar', 'pistol'];
    this.weapons = loadout.map((k) => new WeaponState(WEAPONS[k]));
    this.weaponIndex = 0;
    this.recoilPending = { pitch: 0, yaw: 0 };
    this.stepDist = 0;
    this.moveSpeed = 0;
    this.alive = true;
    this.hp = 100;
    this.stats = { shots: 0, hits: 0 };
  }

  get weapon() { return this.weapons[this.weaponIndex]; }

  eyePos(out = { x: 0, y: 0, z: 0 }) {
    const b = this.body.pos;
    const l = this.leanAllowed;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    out.x = b.x + rx * l * LEAN_DIST;
    out.y = b.y + this.eyeHeight - Math.abs(l) * 0.06;
    out.z = b.z + rz * l * LEAN_DIST;
    return out;
  }
  viewDir(out = { x: 0, y: 0, z: 0 }) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp; out.y = Math.sin(this.pitch); out.z = -Math.cos(this.yaw) * cp;
    return out;
  }
  get roll() { return -this.leanAllowed * LEAN_ROLL; }

  maxSpeed() {
    let s = this.stance === 'prone' ? SPEED.prone : this.stance === 'crouch' ? SPEED.crouch : (this.sprinting ? SPEED.sprint : SPEED.walk);
    if (!this.sprinting) s *= 1 - (1 - SPEED.adsMul) * this.ads;
    if (Math.abs(this.leanAllowed) > 0.3) s *= SPEED.leanMul;
    return s * this.speedMul;
  }

  update(dt, game) {
    const I = this.intent;
    const world = game.world;
    const b = this.body;
    // ---------------- salto de obstáculo en curso
    if (this.vault) {
      const v = this.vault;
      v.t += dt;
      const k = Math.min(1, v.t / v.dur);
      const e = k * k * (3 - 2 * k);
      b.pos.x = v.from.x + (v.to.x - v.from.x) * e;
      b.pos.z = v.from.z + (v.to.z - v.from.z) * e;
      const arc = Math.sin(k * Math.PI) * 0.18;
      b.pos.y = v.from.y + (v.to.y - v.from.y) * Math.min(1, e * 1.6) + arc;
      b.vel.x = b.vel.y = b.vel.z = 0;
      this.eyeHeight = damp(this.eyeHeight, STANCES.crouch.eye, 14, dt);
      if (k >= 1) { this.vault = null; b.onGround = false; }
      this._weaponTick(dt, game, true);
      return;
    }
    // ---------------- postura
    let want = I.stance;
    if (I.sprint && I.moveZ > 0.3 && want !== 'prone') want = 'stand';
    if (want !== this.stance) {
      if (tryResize(world, b, STANCES[want].height)) this.stance = want;
    } else if (b.height !== STANCES[this.stance].height) tryResize(world, b, STANCES[this.stance].height);
    this.sprinting = I.sprint && I.moveZ > 0.3 && this.stance === 'stand' && !I.ads && b.onGround;
    // ---------------- apuntar
    const w = this.weapon;
    const adsWanted = I.ads && !this.sprinting && w.ready && this.stance !== 'prone' ? 1 : (I.ads && this.stance === 'prone' && w.ready ? 1 : 0);
    const adsRate = 1 / Math.max(0.1, w.def.adsTime);
    this.ads = clamp(this.ads + (adsWanted ? adsRate : -adsRate * 1.5) * dt, 0, 1);
    // ---------------- asomarse (Q/E)
    const leanTarget = this.sprinting || this.stance === 'prone' ? 0 : I.lean;
    this.lean = damp(this.lean, leanTarget, 12, dt);
    this.leanAllowed = this._clampLean(world, this.lean);
    // ---------------- movimiento
    const f = Math.hypot(I.moveX, I.moveZ);
    const mx = f > 1 ? I.moveX / f : I.moveX, mz = f > 1 ? I.moveZ / f : I.moveZ;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // adelante = (-sin, -cos); derecha = (cos, -sin)
    const wishX = mx * cy - mz * sy, wishZ = -mx * sy - mz * cy;
    const maxS = this.maxSpeed();
    const tx = wishX * maxS, tz = wishZ * maxS;
    const accel = b.onGround || b.onLadder ? (f > 0.01 ? 26 : 32) : 3;
    const ddx = tx - b.vel.x, ddz = tz - b.vel.z;
    const dl = Math.hypot(ddx, ddz), maxD = accel * dt;
    if (dl > maxD) { b.vel.x += ddx / dl * maxD; b.vel.z += ddz / dl * maxD; } else { b.vel.x = tx; b.vel.z = tz; }
    // salto de obstáculo
    if (I.vault && b.onGround && this.stance !== 'prone') {
      const hx = -sy, hz = -cy;
      const t = findVault(world, b, hx, hz);
      if (t) {
        this.vault = { t: 0, dur: 0.42 + (t.top - b.pos.y) * 0.25, from: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, to: t };
        this.stance = 'crouch'; b.height = STANCES.crouch.height;
        game.emit('vault', this);
        I.vault = false;
        return;
      }
    }
    I.vault = false;
    const prevY = b.pos.y;
    const r = stepBody(world, b, dt, { bounds: game.bounds, climbInput: b.onLadder || this._nearLadder ? I.moveZ : 0 });
    this._nearLadder = b.onLadder;
    if (r.landed && r.impactSpeed > 3) game.emit('land', this, r.impactSpeed);
    // suavizado de altura de ojos (postura + escalones)
    if (b.lastStep > 0) this.eyeHeight -= b.lastStep;
    this.eyeHeight = damp(this.eyeHeight, STANCES[this.stance].eye, 13, dt);
    // pasos
    this.moveSpeed = Math.hypot(b.vel.x, b.vel.z);
    if ((b.onGround || b.onLadder) && this.moveSpeed > 0.4) {
      this.stepDist += this.moveSpeed * dt;
      const stride = this.sprinting ? 1.9 : this.stance === 'crouch' ? 1.05 : this.stance === 'prone' ? 0.9 : 1.45;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        const mat = world.getWorld(b.pos.x, b.pos.y - 0.06, b.pos.z);
        const loud = this.sprinting ? 1.0 : this.stance === 'crouch' ? 0.28 : this.stance === 'prone' ? 0.18 : 0.55;
        game.emit('footstep', this, SOUND[mat] || 3, loud * (this.ads > 0.5 ? 0.7 : 1));
      }
    }
    // ---------------- arma
    this._weaponTick(dt, game, false);
  }

  _clampLean(world, lean) {
    if (Math.abs(lean) < 0.01) return 0;
    const b = this.body.pos;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const eyeY = b.y + this.eyeHeight;
    let lo = 0, hi = 1;
    const test = (k) => {
      const x = b.x + rx * lean * k * LEAN_DIST, z = b.z + rz * lean * k * LEAN_DIST;
      return boxFree(world, x, eyeY - 0.14, z, 0.14, 0.26);
    };
    if (test(1)) return lean;
    for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (test(m)) lo = m; else hi = m; }
    return lean * lo;
  }

  _weaponTick(dt, game, busy) {
    const I = this.intent;
    const w = this.weapon;
    // aplicar retroceso pendiente de forma rápida pero no instantánea
    const k = 1 - Math.exp(-dt * 38);
    const rp = this.recoilPending.pitch * k, ry = this.recoilPending.yaw * k;
    this.pitch = clamp(this.pitch + rp, -1.52, 1.52);
    this.yaw += ry;
    this.recoilPending.pitch -= rp; this.recoilPending.yaw -= ry;

    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.equipT > 0) w.equipT -= dt;
    w.bloom = Math.max(0, w.bloom - dt * 3.5);
    // cambio de arma
    if (I.switchTo >= 0 && I.switchTo !== this.weaponIndex && I.switchTo < this.weapons.length) {
      w.reloadT = 0; // cancelar recarga
      this.weaponIndex = I.switchTo;
      this.weapon.equipT = this.weapon.def.equip;
      this.ads = 0;
      game.emit('switch', this, this.weapon);
    }
    I.switchTo = -1;
    const cw = this.weapon;
    if (cw.reloadT > 0) {
      cw.reloadT -= dt;
      if (cw.reloadT <= 0) { cw.reloadT = 0; cw.finishReload(); game.emit('reloadDone', this, cw); }
    }
    if (I.reload && !busy) {
      if (cw.startReload()) { this.ads = Math.min(this.ads, 0.3); game.emit('reload', this, cw); }
    }
    I.reload = false;
    const canFire = !busy && cw.ready && !this.sprinting;
    if (!I.fire) { cw.triggerHeld = false; cw.shotsInBurst = 0; }
    if (I.fire && canFire) {
      if (cw.ammo <= 0) {
        if (!cw.triggerHeld) { game.emit('dryfire', this, cw); cw.triggerHeld = true; if (cw.reserve > 0 && cw.startReload()) game.emit('reload', this, cw); }
        return;
      }
      if (!cw.def.auto && cw.triggerHeld) return;
      const interval = 60 / cw.def.rpm;
      if (cw.cooldown <= 0) {
        cw.cooldown += interval;
        if (cw.cooldown < 0) cw.cooldown = interval * 0.5;
        cw.triggerHeld = true;
        this._shoot(game, cw);
      }
    } else if (cw.cooldown < 0) cw.cooldown = 0;
  }

  currentSpread() {
    const d = this.weapon.def;
    const base = d.spreadHip + (d.spreadAds - d.spreadHip) * this.ads;
    const move = Math.min(1, this.moveSpeed / 3.3) * d.spreadMove * (1 - this.ads * 0.6);
    const air = this.body.onGround ? 0 : 2;
    const stance = this.stance === 'crouch' ? 0.85 : this.stance === 'prone' ? 0.7 : 1;
    return (base + move + air + this.weapon.bloom * (1 - this.ads * 0.8)) * stance;
  }

  _shoot(game, w) {
    const d = w.def;
    w.ammo--;
    w.shotsInBurst++;
    this.stats.shots++;
    const eye = this.eyePos();
    const spread = this.currentSpread() * DEG;
    const dir = { x: 0, y: 0, z: 0 };
    const fwd = this.viewDir({ x: 0, y: 0, z: 0 });
    // base ortonormal de la vista: derecha y arriba (= derecha × adelante)
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const sp = Math.sin(this.pitch);
    const up = { x: Math.sin(this.yaw) * sp, y: Math.cos(this.pitch), z: Math.cos(this.yaw) * sp };
    const results = [];
    for (let p = 0; p < d.pellets; p++) {
      const a = game.rng.next() * Math.PI * 2;
      const r = Math.sqrt(game.rng.next()) * Math.tan(spread);
      dir.x = fwd.x + (rx * Math.cos(a) + up.x * Math.sin(a)) * r;
      dir.y = fwd.y + up.y * Math.sin(a) * r;
      dir.z = fwd.z + (rz * Math.cos(a) + up.z * Math.sin(a)) * r;
      const l = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= l; dir.y /= l; dir.z /= l;
      results.push(game.fireBullet(this, eye, { x: dir.x, y: dir.y, z: dir.z }, w));
    }
    // retroceso: arriba siempre, lateral aleatorio con sesgo
    const first = w.shotsInBurst === 1 ? d.recoilFirst : 1;
    const adsK = 1 - this.ads * 0.25;
    const stanceK = this.stance === 'crouch' ? 0.85 : this.stance === 'prone' ? 0.7 : 1;
    this.recoilPending.pitch += d.recoilUp * DEG * first * adsK * stanceK;
    this.recoilPending.yaw += (game.rng.next() - 0.4) * d.recoilSide * DEG * adsK * stanceK;
    w.bloom = Math.min(4, w.bloom + d.bloom);
    game.emit('shot', this, w, eye, fwd, results);
  }
}

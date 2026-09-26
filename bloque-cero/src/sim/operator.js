// Operador: el cuerpo que controla un jugador o un bot. Movimiento táctico,
// posturas (de pie, agachado, cuerpo a tierra), asomarse, saltar obstáculos,
// trepar escaleras de mano, manejo del arma y estado de combate
// (vivo → derribado con sangrado → muerto). Recibe "intenciones" cada tick
// (del teclado o de la IA) y emite eventos para render, audio e IA.
import { Body, STANCES, stepBody, tryResize, findVault, woodInVault, boxFree } from './physics.js';
import { WeaponState, WEAPONS, recoilPattern, BURST } from './weapons.js';
import { makePoseState, computePose, BONE_COUNT } from './skeleton.js';
import { clamp, damp, DEG } from '../core/math.js';
import { SOUND } from '../world/materials.js';

const RECOVER = 0.7;     // parte del retroceso no compensado que se recupera al dejar de disparar

export const LEAN_DIST = 0.38;      // desplazamiento lateral de la cabeza al asomarse (m)
const VAULT_WOOD_MAX = 14;          // astillas de barricada que se arrastran al saltar (una entera tiene ~40 en el pasillo)
const LEAN_ROLL = 13 * DEG;         // giro de cámara al asomarse
const SPEED = { walk: 3.3, sprint: 5.4, crouch: 1.85, prone: 0.8, crawl: 0.5, adsMul: 0.62, leanMul: 0.9 };
export const ARMOR_HP = { 1: 100, 2: 110, 3: 125 };
export const BLEED_TIME = 20;       // segundos que aguanta un derribado sin ayuda
export const REVIVE_TIME = 4;       // segundos manteniendo F para reanimar
const DOWNED_EYE = 0.48;

export function makeIntent() {
  return {
    moveX: 0, moveZ: 0,      // -1..1 (derecha, adelante)
    sprint: false,
    stance: 'stand',          // postura deseada
    lean: 0,                  // -1 izquierda, 0, 1 derecha
    ads: false, fire: false, reload: false, vault: false, melee: false, inspect: false,
    switchTo: -1,
    interact: false,          // mantener F (reanimar, más adelante: reforzar, plantar…)
    holdWound: false,         // derribado: presionar la herida (sangra más despacio)
  };
}

export class Operator {
  constructor(id, opts = {}) {
    this.id = id;
    this.name = opts.name || 'Operador';
    this.team = opts.team ?? 0;
    this.armor = opts.armor ?? 2;               // 1..3 (más blindaje, menos velocidad)
    this.speedMul = opts.speedMul ?? (this.armor === 1 ? 1.08 : this.armor === 3 ? 0.92 : 1);
    this.maxHp = ARMOR_HP[this.armor] || 100;
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
    this.recoilOffset = { pitch: 0, yaw: 0 };   // retroceso aún no compensado (se recupera al dejar de disparar)
    this.sinceShot = 9;
    this.stepDist = 0;
    this.moveSpeed = 0;
    // combate
    this.state = 'alive';    // 'alive' | 'downed' | 'dead'
    this.hp = this.maxHp;
    this.bleedT = 0;
    this.reviveT = 0;        // progreso de quien me reanima (0..REVIVE_TIME)
    this.reviving = null;    // a quién estoy reanimando
    this.lastHitBy = null;
    this.downedBy = null;
    this.stats = { shots: 0, hits: 0, kills: 0, downs: 0, headshots: 0, damage: 0, revives: 0, deaths: 0 };
    this.isBot = !!opts.bot;
    this.meta = opts.meta || {};
    this.frozen = false;     // preparación: el ataque no puede moverse ni disparar
    this.meleeT = 0;         // enfriamiento del golpe cuerpo a cuerpo
    this.channel = null;     // acción mantenida (plantar, inutilizar): {kind, t, total}
    // pose (compartida por zonas de impacto y render)
    this.pose = makePoseState();
    this.rig = new Array(BONE_COUNT);
    this.walkPhase = 0;
    this.deathT = 0;
    this.hitFlinch = 0;
    this.updatePose(0);
  }

  get weapon() { return this.weapons[this.weaponIndex]; }
  get alive() { return this.state !== 'dead'; }
  get downed() { return this.state === 'downed'; }
  get active() { return this.state === 'alive'; }

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
  // centro del torso (para la IA y el sonido)
  center(out = { x: 0, y: 0, z: 0 }) {
    const b = this.body.pos;
    out.x = b.x; out.z = b.z; out.y = b.y + (this.state === 'downed' ? 0.3 : this.stance === 'prone' ? 0.25 : this.stance === 'crouch' ? 0.75 : 1.15);
    return out;
  }

  maxSpeed() {
    if (this.state === 'downed') return SPEED.crawl;
    let s = this.stance === 'prone' ? SPEED.prone : this.stance === 'crouch' ? SPEED.crouch : (this.sprinting ? SPEED.sprint : SPEED.walk);
    if (!this.sprinting) s *= 1 - (1 - SPEED.adsMul) * this.ads;
    if (Math.abs(this.leanAllowed) > 0.3) s *= SPEED.leanMul;
    return s * this.speedMul * (this.slowMul || 1);   // (el alambre de púas frena a la mitad)
  }

  // ------------------------------------------------------------ transiciones de combate
  becomeDowned(game, by) {
    this.state = 'downed';
    this.hp = 20;
    this.bleedT = BLEED_TIME;
    this.downedBy = by || null;
    this.ads = 0; this.sprinting = false; this.lean = 0; this.leanAllowed = 0;
    this.stance = 'prone';
    this.body.height = STANCES.prone.height;
    this.reviveT = 0;
    this.vault = null;
    this.weapon.cancelReload();
  }
  becomeDead() {
    this.state = 'dead';
    this.hp = 0;
    this.deathT = 0;
    this.ads = 0; this.lean = 0; this.leanAllowed = 0; this.sprinting = false;
    this.vault = null;
    this.reviving = null;
    this.stats.deaths++;
  }
  revive() {
    this.state = 'alive';
    this.hp = 20;
    this.bleedT = 0;
    this.reviveT = 0;
    this.stance = 'crouch';
    tryResizeSafe(this);
  }

  update(dt, game) {
    const I = this.intent;
    const world = game.world;
    const b = this.body;
    if (this.state === 'dead') {
      this.deathT += dt;
      // el cuerpo cae al suelo
      b.vel.x = 0; b.vel.z = 0;
      stepBody(world, b, dt, { bounds: game.bounds });
      this.updatePose(dt);
      return;
    }
    this.hitFlinch = Math.max(0, this.hitFlinch - dt * 3);
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
      this.updatePose(dt);
      return;
    }
    const downed = this.state === 'downed';
    // ---------------- derribado: sangrado
    if (downed) {
      this.bleedT -= dt * (I.holdWound ? 0.55 : 1);
      if (this.bleedT <= 0) { game.kill(this, { by: this.downedBy, weapon: null, zone: 'bleed', bleed: true }); return; }
    }
    // ---------------- postura
    const busy = !!this.reviving || !!this.channel || this.frozen;
    let want = downed ? 'prone' : I.stance;
    if (!downed && !busy && I.sprint && I.moveZ > 0.3 && want !== 'prone') want = 'stand';
    if (this.channel && want === 'stand') want = 'crouch';    // se arrodilla para plantar/inutilizar
    if (want !== this.stance) {
      if (tryResize(world, b, STANCES[want].height)) this.stance = want;
    } else if (b.height !== STANCES[this.stance].height) tryResize(world, b, STANCES[this.stance].height);
    this.sprinting = !downed && !busy && I.sprint && I.moveZ > 0.3 && this.stance === 'stand' && !I.ads && b.onGround;
    // ---------------- apuntar
    const w = this.weapon;
    const canAds = !downed && w.ready && !this.sprinting && !this.channel && !this.reviving;
    const adsRate = 1 / Math.max(0.1, w.def.adsTime);
    this.ads = clamp(this.ads + (I.ads && canAds ? adsRate : -adsRate * 1.5) * dt, 0, 1);
    // ---------------- asomarse (Q/E)
    const leanTarget = this.sprinting || this.stance === 'prone' || downed ? 0 : I.lean;
    this.lean = damp(this.lean, leanTarget, 12, dt);
    this.leanAllowed = this._clampLean(world, this.lean);
    // ---------------- movimiento
    const f = Math.hypot(I.moveX, I.moveZ);
    const mx = busy ? 0 : f > 1 ? I.moveX / f : I.moveX, mz = busy ? 0 : f > 1 ? I.moveZ / f : I.moveZ;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wishX = mx * cy - mz * sy, wishZ = -mx * sy - mz * cy;
    const maxS = this.maxSpeed() * (this.hitFlinch > 0 ? 0.75 : 1);
    const tx = wishX * maxS, tz = wishZ * maxS;
    const accel = b.onGround || b.onLadder ? (f > 0.01 ? 26 : 32) : 3;
    const ddx = tx - b.vel.x, ddz = tz - b.vel.z;
    const dl = Math.hypot(ddx, ddz), maxD = accel * dt;
    if (dl > maxD) { b.vel.x += ddx / dl * maxD; b.vel.z += ddz / dl * maxD; } else { b.vel.x = tx; b.vel.z = tz; }
    if (I.vault && !downed && !busy && b.onGround && this.stance !== 'prone') {
      let t = findVault(world, b, -sy, -cy);
      // barricada rota (quedan astillas): se salta a través y se arrastran
      if (!t) {
        const tw = findVault(world, b, -sy, -cy, { throughWood: true });
        const wood = tw ? woodInVault(world, b, tw, -sy, -cy) : null;
        if (tw && wood.length <= VAULT_WOOD_MAX) { if (wood.length) game.clearVoxels(wood, 'vault', tw); t = tw; }
      }
      if (t) {
        this.vault = { t: 0, dur: 0.42 + (t.top - b.pos.y) * 0.25, from: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, to: t };
        this.stance = 'crouch'; b.height = STANCES.crouch.height;
        game.emit('vault', this);
        I.vault = false;
        this.updatePose(dt);
        return;
      }
    }
    I.vault = false;
    const r = stepBody(world, b, dt, { bounds: game.bounds, climbInput: !downed && (b.onLadder || this._nearLadder) ? I.moveZ : 0 });
    this._nearLadder = b.onLadder;
    if (r.landed && r.impactSpeed > 3) {
      game.emit('land', this, r.impactSpeed);
      // caída desde gran altura: daño
      if (r.impactSpeed > 11) game.damage(this, (r.impactSpeed - 11) * 12, { by: null, zone: 'fall', noDown: false });
    }
    if (b.lastStep > 0) this.eyeHeight -= b.lastStep;
    this.eyeHeight = damp(this.eyeHeight, downed ? DOWNED_EYE : STANCES[this.stance].eye, 13, dt);
    // pasos
    this.moveSpeed = Math.hypot(b.vel.x, b.vel.z);
    if ((b.onGround || b.onLadder) && this.moveSpeed > 0.3) {
      this.stepDist += this.moveSpeed * dt;
      this.walkPhase += this.moveSpeed * dt * (this.sprinting ? 3.3 : 4.3);
      const stride = downed ? 0.7 : this.sprinting ? 1.9 : this.stance === 'crouch' ? 1.05 : this.stance === 'prone' ? 0.9 : 1.45;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        const mat = world.getWorld(b.pos.x, b.pos.y - 0.06, b.pos.z);
        const loud = downed ? 0.2 : this.sprinting ? 1.0 : this.stance === 'crouch' ? 0.28 : this.stance === 'prone' ? 0.18 : 0.55;
        game.emit('footstep', this, SOUND[mat] || 3, loud * (this.ads > 0.5 ? 0.7 : 1));
      }
    } else if (this.moveSpeed < 0.1) {
      this.walkPhase = damp(this.walkPhase, Math.round(this.walkPhase / Math.PI) * Math.PI, 6, dt);
    }
    // ---------------- reanimar a un compañero (mantener F)
    this._reviveTick(dt, game);
    // ---------------- cuerpo a cuerpo (V)
    this.meleeT = Math.max(0, this.meleeT - dt);
    if (I.melee && !downed && !busy && !this.reviving && this.meleeT <= 0) {
      this.meleeT = 0.8;
      this.weapon.cancelReload();
      this.ads = Math.min(this.ads, 0.2);
      game.melee(this);
    }
    I.melee = false;
    // ---------------- arma
    this._weaponTick(dt, game, downed || busy);
    this.updatePose(dt);
  }

  _reviveTick(dt, game) {
    const I = this.intent;
    if (this.state !== 'alive') { this.reviving = null; return; }
    let target = this.reviving;
    if (I.interact) {
      if (!target) target = game.findRevivable(this);
      if (target && target.state === 'downed' && dist2(target.body.pos, this.body.pos) < 1.6 * 1.6) {
        if (!this.reviving) game.emit('reviveStart', this, target);
        this.reviving = target;
        target.reviveT += dt;
        if (target.reviveT >= REVIVE_TIME) {
          target.revive();
          this.stats.revives++;
          game.emit('revived', target, this);
          this.reviving = null;
        }
        return;
      }
    }
    if (this.reviving) { this.reviving.reviveT = 0; game.emit('reviveCancel', this, this.reviving); }
    this.reviving = null;
  }

  updatePose(dt) {
    const p = this.pose, b = this.body.pos;
    p.x = b.x; p.y = b.y; p.z = b.z;
    p.yaw = this.yaw; p.pitch = this.pitch;
    const k = 1 - Math.exp(-dt * 10);
    const downed = this.state === 'downed', dead = this.state === 'dead';
    p.crouch += ((this.stance === 'crouch' || (this.vault ? 1 : 0) ? 1 : 0) - p.crouch) * k;
    p.prone += ((this.stance === 'prone' && !downed && !dead ? 1 : 0) - p.prone) * k;
    p.downed += ((downed ? 1 : 0) - p.downed) * (1 - Math.exp(-dt * 6));
    p.dead = dead ? Math.min(1, this.deathT / 0.7) : 0;
    p.dead = p.dead * p.dead * (3 - 2 * p.dead);
    p.lean = this.leanAllowed;
    p.walkPhase = this.walkPhase;
    p.walkAmount += (Math.min(1, this.moveSpeed / 3.3) - p.walkAmount) * k;
    p.sprint += ((this.sprinting ? 1 : 0) - p.sprint) * k;
    p.ads = this.ads;
    const w = this.weapon;
    p.reload = w.reloadT > 0 ? 1 - w.reloadT / w.reloadTotal : 0;
    p.weaponCls = w.def.cls;
    p.eyeHeight = this.eyeHeight;
    p.crawl = downed ? Math.min(1, this.moveSpeed / 0.4) : 0;
    computePose(p, null, this.rig);
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
    const k = 1 - Math.exp(-dt * 38);
    const rp = this.recoilPending.pitch * k, ry = this.recoilPending.yaw * k;
    this.pitch = clamp(this.pitch + rp, -1.52, 1.52);
    this.yaw += ry;
    this.recoilPending.pitch -= rp; this.recoilPending.yaw -= ry;
    this.recoilOffset.pitch += rp; this.recoilOffset.yaw += ry;
    // recuperación: al dejar de disparar, la vista vuelve buena parte del camino
    this.sinceShot += dt;
    if (this.sinceShot > 0.12 && (this.recoilOffset.pitch || this.recoilOffset.yaw)) {
      const kr = 1 - Math.exp(-dt * 7);
      const bp = this.recoilOffset.pitch * kr, by = this.recoilOffset.yaw * kr;
      this.pitch = clamp(this.pitch - bp * RECOVER, -1.52, 1.52);
      this.yaw -= by * RECOVER;
      this.recoilOffset.pitch -= bp; this.recoilOffset.yaw -= by;
      if (Math.abs(this.recoilOffset.pitch) < 1e-4 && Math.abs(this.recoilOffset.yaw) < 1e-4) { this.recoilOffset.pitch = 0; this.recoilOffset.yaw = 0; }
    }

    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.equipT > 0) w.equipT -= dt;
    w.bloom = Math.max(0, w.bloom - dt * 3.5);
    if (this.state !== 'alive') { I.switchTo = -1; I.reload = false; return; }
    if (I.switchTo >= 0 && I.switchTo !== this.weaponIndex && I.switchTo < this.weapons.length) {
      w.cancelReload();
      this.weaponIndex = I.switchTo;
      this.weapon.equipT = this.weapon.def.equip;
      this.ads = 0;
      game.emit('switch', this, this.weapon);
    }
    I.switchTo = -1;
    const cw = this.weapon;
    if (cw.reloadT > 0) {
      // recarga por partes: cada parte (cargador fuera, dentro, cerrojo, cartucho...) avisa
      const parts = this._parts || (this._parts = []);
      parts.length = 0;
      const done = cw.tickReload(dt, parts);
      for (const part of parts) game.emit('reloadPart', this, cw, part);
      if (done) game.emit('reloadDone', this, cw);
    }
    if (I.reload && !busy) {
      if (cw.startReload()) { this.ads = Math.min(this.ads, 0.3); game.emit('reload', this, cw); }
    }
    I.reload = false;
    if (I.fireMode) { I.fireMode = false; if ((cw.def.modes || []).length > 1) game.emit('fireMode', this, cw, cw.cycleMode()); }
    // la escopeta se interrumpe disparando: se queda con los cartuchos ya metidos y dispara en
    // cuanto vuelve a encararla
    if (I.fire && cw.reloadT > 0 && cw.def.perShell && cw.ammo > 0 && !cw.triggerHeld && !busy && !this.sprinting) {
      cw.cancelReload();
      cw.cooldown = Math.max(cw.cooldown, 0.12);
      cw.queuedShot = true;
      game.emit('reloadCancel', this, cw);
    }
    const canFire = !busy && cw.ready && !this.sprinting;
    const burstOn = cw.burstLeft > 0;
    if (!I.fire) { cw.triggerHeld = false; if (!burstOn) cw.shotsInBurst = 0; }
    if (!canFire) cw.queuedShot = false;
    if ((I.fire || burstOn || cw.queuedShot) && canFire) {
      if (cw.ammo <= 0) {
        cw.burstLeft = 0;
        if (!cw.triggerHeld) { game.emit('dryfire', this, cw); cw.triggerHeld = true; if (cw.reserve > 0 && cw.startReload()) game.emit('reload', this, cw); }
        return;
      }
      // tiro a tiro y ráfaga: hay que soltar el gatillo entre disparos (o entre ráfagas)
      if (!burstOn && cw.triggerHeld && cw.mode !== 'auto') return;
      const interval = 60 / cw.def.rpm;
      if (cw.cooldown <= 0) {
        cw.cooldown += interval;
        if (cw.cooldown < 0) cw.cooldown = interval * 0.5;
        if (!burstOn && cw.mode === 'burst') cw.burstLeft = BURST;
        if (I.fire) cw.triggerHeld = true;
        cw.queuedShot = false;
        this._shoot(game, cw);
        if (cw.burstLeft > 0) cw.burstLeft--;
      }
    } else {
      if (cw.cooldown < 0) cw.cooldown = 0;
      if (!canFire) cw.burstLeft = 0;
    }
  }

  /** El jugador tira del ratón contra el retroceso: lo compensado ya no se recupera. */
  compensateRecoil(dPitch, dYaw) {
    const o = this.recoilOffset;
    if (o.pitch > 0 && dPitch < 0) o.pitch = Math.max(0, o.pitch + dPitch);
    else if (o.pitch < 0 && dPitch > 0) o.pitch = Math.min(0, o.pitch + dPitch);
    if (o.yaw > 0 && dYaw < 0) o.yaw = Math.max(0, o.yaw + dYaw);
    else if (o.yaw < 0 && dYaw > 0) o.yaw = Math.min(0, o.yaw + dYaw);
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
    const spread = this.currentSpread() * DEG * (this.aimSpreadMul || 1);
    const dir = { x: 0, y: 0, z: 0 };
    const fwd = this.viewDir({ x: 0, y: 0, z: 0 });
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
    // retroceso: patrón fijo del arma + un poco de azar (agachado −10 %, tumbado −20 %)
    const pat = recoilPattern(d, w.shotsInBurst - 1), R = d.recoil || { h: 0.3, jitter: 0.1 };
    const adsK = 1 - this.ads * 0.25;
    const stanceK = this.stance === 'crouch' ? 0.9 : this.stance === 'prone' ? 0.8 : 1;
    const ctrl = this.recoilControl || 0; // los bots compensan parte del retroceso
    const kickUp = pat.up * (1 + (game.rng.next() - 0.5) * 2 * R.jitter);
    const kickSide = pat.side + (game.rng.next() - 0.5) * 2 * R.jitter * R.h;
    this.recoilPending.pitch += kickUp * DEG * adsK * stanceK * (1 - ctrl);
    this.recoilPending.yaw -= kickSide * DEG * adsK * stanceK * (1 - ctrl * 0.6);   // lado > 0: hacia la derecha
    this.sinceShot = 0;
    w.bloom = Math.min(4, w.bloom + d.bloom);
    game.emit('shot', this, w, eye, fwd, results);
  }
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
function tryResizeSafe(op) { op.body.height = STANCES.crouch.height; }

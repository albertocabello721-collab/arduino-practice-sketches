// Reconocimiento: drones del ataque y cámaras de seguridad de la defensa.
//  · Dron: cuerpo pequeño con ruedas (0,26 × 0,17 m) que cabe por agujeros bajos,
//    3,5 m/s, salto de ~0,5 m, se destruye de un disparo. 2 por atacante; en la
//    preparación el ataque ve el edificio a través de ellos.
//  · Cámara: fija en la pared, gira dentro de un arco, se destruye de un disparo.
//  · Marcar (clic, T o botón central): el enemigo al que apunta queda señalado 6 s para su equipo.
//    En persona, si no hay enemigo a la vista, se pone una marca de posición donde se mira:
//    la ve todo el equipo 15 s (una por jugador; la nueva sustituye a la anterior).
//  · Objetivo: el ataque lo localiza al verlo (dron o en persona) a menos de 14 m.
import { Body, stepBody } from './physics.js';
import { lineOfSight, raycastFirst } from '../world/raycast.js';
import { rayHitRig } from './skeleton.js';
import { clamp } from '../core/math.js';

export const DRONE = { speed: 3.5, accel: 16, radius: 0.13, height: 0.17, jump: 4.4, jumpCd: 0.9, hop: 1.6, eye: 0.13, fov: 96 };
export const DRONES_PER_OP = 2;
export const SPOT_TIME = 6;
export const MARK_RANGE = 40;
export const OBJECTIVE_RANGE = 14;
export const PING_TIME = 15;
export const PING_RANGE = 60;

export class Drone {
  constructor(id, owner, x, y, z, yaw) {
    this.kind = 'drone';
    this.id = id;
    this.owner = owner;
    this.team = owner.team;
    this.body = new Body(x, y, z);
    this.body.radius = DRONE.radius;
    this.body.height = DRONE.height;
    this.yaw = yaw;
    this.pitch = -0.05;
    this.alive = true;
    this.jumpCd = 0;
    this.markCd = 0;
    this.moveSpeed = 0;
    this.intent = { moveX: 0, moveZ: 0, jump: false, mark: false, zap: false };
    this.shock = false;      // dron de choque de PULGA (rayo contra gadgets)
    this.zapCd = 0;
    this.prev = { x, y, z };
    this.pilot = null;       // operador que lo maneja ahora (o null)
  }
  get name() { return `${this.shock ? 'Dron de choque' : 'Dron'} de ${this.owner.name}`; }
  eyePos(out = { x: 0, y: 0, z: 0 }) { const p = this.body.pos; out.x = p.x; out.y = p.y + DRONE.eye; out.z = p.z; return out; }
  viewDir(out = { x: 0, y: 0, z: 0 }) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp; out.y = Math.sin(this.pitch); out.z = -Math.cos(this.yaw) * cp;
    return out;
  }
  center() { const p = this.body.pos; return { x: p.x, y: p.y + 0.09, z: p.z }; }
  update(dt, game) {
    const b = this.body, I = this.intent;
    this.prev.x = b.pos.x; this.prev.y = b.pos.y; this.prev.z = b.pos.z;
    const f = Math.hypot(I.moveX, I.moveZ);
    const mx = f > 1 ? I.moveX / f : I.moveX, mz = f > 1 ? I.moveZ / f : I.moveZ;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const tx = (mx * cy - mz * sy) * DRONE.speed, tz = (-mx * sy - mz * cy) * DRONE.speed;
    const accel = b.onGround ? DRONE.accel : 2;
    const ddx = tx - b.vel.x, ddz = tz - b.vel.z, dl = Math.hypot(ddx, ddz), maxD = accel * dt;
    if (dl > maxD) { b.vel.x += ddx / dl * maxD; b.vel.z += ddz / dl * maxD; } else { b.vel.x = tx; b.vel.z = tz; }
    if (I.jump && b.onGround && this.jumpCd <= 0) {
      b.vel.y = DRONE.jump; this.jumpCd = DRONE.jumpCd;
      // saltar hacia delante (subir peldaños): impulso horizontal en la dirección pedida
      if (f > 0.1) {
        const hs = Math.max(Math.hypot(b.vel.x, b.vel.z), DRONE.hop);
        b.vel.x = tx / DRONE.speed * hs; b.vel.z = tz / DRONE.speed * hs;
      }
      game.emit('droneJump', this);
    }
    I.jump = false;
    this.jumpCd -= dt;
    this.markCd -= dt;
    stepBody(game.world, b, dt, { bounds: game.bounds, maxStep: 1, noLadder: true, gravity: 20 });
    this.moveSpeed = Math.hypot(b.vel.x, b.vel.z);
  }
  // Rayo contra la caja del dron (para las balas).
  rayTest(o, d, maxT) {
    const p = this.body.pos;
    return rayAABB(o, d, p.x - 0.16, p.y, p.z - 0.16, p.x + 0.16, p.y + 0.2, p.z + 0.16, maxT);
  }
}

export class SecurityCam {
  constructor(def) {
    this.kind = 'cam';
    this.id = def.id;
    this.name = def.name;
    this.pos = { x: def.x, y: def.y, z: def.z };
    this.baseYaw = def.yaw;
    this.basePitch = def.pitch;
    this.yaw = def.yaw;
    this.pitch = def.pitch;
    this.alive = true;
    this.team = -1;
  }
  eyePos(out = { x: 0, y: 0, z: 0 }) { out.x = this.pos.x; out.y = this.pos.y - 0.05; out.z = this.pos.z; return out; }
  viewDir(out = { x: 0, y: 0, z: 0 }) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp; out.y = Math.sin(this.pitch); out.z = -Math.cos(this.yaw) * cp;
    return out;
  }
  center() { return { x: this.pos.x, y: this.pos.y, z: this.pos.z }; }
  // girar dentro de su arco
  look(dyaw, dpitch) {
    this.yaw = this.baseYaw + clamp(this.yaw - this.baseYaw + dyaw, -1.15, 1.15);
    this.pitch = clamp(this.pitch + dpitch, -1.0, 0.35);
  }
  rayTest(o, d, maxT) {
    const p = this.pos;
    return raySphere(o, d, p.x, p.y, p.z, 0.15, maxT);
  }
}

export class Recon {
  constructor(game, { cameras = [] } = {}) {
    this.game = game;
    this.drones = [];
    this.cams = cameras.map((c) => new SecurityCam(c));
    this.left = new Map();         // operador → drones que le quedan
    this.spotted = new Map();      // operador enemigo → {until, team, by}
    this.pings = new Map();        // operador → su marca de posición {x, y, z, team, by, t, until}
    this.objectiveFound = false;
    this._objT = 0;
    this._nextId = 1;
    this.site = null;
    this.attackTeam = 0;
    this._syncTargets();
  }

  reset({ defTeam = 1, site = null } = {}) {
    this.drones = [];
    this.left.clear();
    this.spotted.clear();
    this.pings.clear();
    this.objectiveFound = false;
    this.site = site;
    this.attackTeam = 1 - defTeam;
    for (const c of this.cams) { c.alive = true; c.team = defTeam; c.yaw = c.baseYaw; c.pitch = c.basePitch; c.offUntil = 0; }
    this._syncTargets();
  }
  _syncTargets() {
    const g = this.game;
    g.targets = g.targets.filter((t) => t.kind !== 'drone' && t.kind !== 'cam');
    for (const c of this.cams) g.targets.push(c);
    for (const d of this.drones) g.targets.push(d);
  }
  dronesLeft(op) { return this.left.has(op) ? this.left.get(op) : DRONES_PER_OP; }
  droneOf(op) { return this.drones.find((d) => d.owner === op && d.alive) || null; }
  aliveCams() { return this.cams.filter((c) => c.alive); }

  /** Lanza un dron delante de `op` (en la preparación, se deja en el suelo). */
  deployDrone(op, { thrown = true } = {}) {
    if (this.dronesLeft(op) <= 0) return null;
    const p = op.body.pos;
    const fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
    const x = p.x + fx * 0.6, z = p.z + fz * 0.6;
    const y = thrown ? p.y + 0.8 : p.y + 0.05;
    const d = new Drone(`dron${this._nextId++}`, op, x, y, z, op.yaw);
    // el primer dron de PULGA es su dron de choque
    d.shock = !!op.ability && op.ability.id === 'shockdrone' && !this.drones.some((o) => o.owner === op);
    if (thrown) { d.body.vel.x = fx * 4.5; d.body.vel.z = fz * 4.5; d.body.vel.y = 1.5; }
    this.left.set(op, this.dronesLeft(op) - 1);
    this.drones.push(d);
    this.game.targets.push(d);
    this.game.emit('droneDeployed', d, op);
    if (thrown && op.startAnim) op.startAnim('drone');
    return d;
  }

  tick(dt) {
    const g = this.game;
    const G = g.gadgets;
    for (const d of this.drones) {
      if (!d.alive) continue;
      // un inhibidor enemigo cerca: sin señal (ni se mueve ni marca; el rayo lo rechaza la habilidad)
      d.jammed = !!(G && G.jammedAt && G.jammedAt(d.center(), d.team));
      if (d.jammed) { const I = d.intent; I.moveX = 0; I.moveZ = 0; I.jump = false; I.mark = false; }
      d.update(dt, g);
      if (d.intent.mark) { d.intent.mark = false; if (d.markCd <= 0) { d.markCd = 0.4; this.mark(d, d.team, d.pilotOp || null); } }
    }
    // señalados que caducan o mueren
    for (const [op, s] of this.spotted) if (s.until <= g.time || op.state === 'dead') this.spotted.delete(op);
    for (const [op, p] of this.pings) if (p.until <= g.time) this.pings.delete(op);
    // localizar el objetivo
    this._objT -= dt;
    if (!this.objectiveFound && this.site && this._objT <= 0) {
      this._objT = 0.25;
      const eyes = [];
      for (const d of this.drones) if (d.alive) eyes.push({ who: d, e: d.eyePos() });
      for (const op of g.operators) if (op.team === this.attackTeam && op.state === 'alive') eyes.push({ who: op, e: op.eyePos() });
      // dentro de la sala del objetivo (aunque los muebles tapen el punto exacto) también cuenta
      const rooms = g.map && g.map.builder ? { A: this.site.A, B: this.site.B } : null;
      for (const { who, e } of eyes) {
        if (!rooms) break;
        const r = g.map.builder.roomAt(e.x, e.y - 0.1, e.z);
        const k = r && (r.id === rooms.A ? 'A' : r.id === rooms.B ? 'B' : null);
        if (k) { this.objectiveFound = true; g.emit('objectiveFound', who, k); return; }
      }
      for (const k of ['A', 'B']) {
        const b = this.site.bombs[k];
        for (const { who, e } of eyes) {
          const dist = Math.hypot(b.x - e.x, b.y + 0.6 - e.y, b.z - e.z);
          if (dist > OBJECTIVE_RANGE) continue;
          if (!lineOfSight(g.world, e.x, e.y, e.z, b.x, b.y + 0.6, b.z)) continue;
          this.objectiveFound = true;
          g.emit('objectiveFound', who, k);
          return;
        }
      }
    }
  }

  /**
   * Marcar: el enemigo al que apunta el visor (dron, cámara u operador) queda señalado.
   * Devuelve el operador señalado o null.
   */
  mark(viewer, team, by = null) {
    const g = this.game;
    if ((viewer.offUntil || 0) > g.time) return null;     // cámara sin señal (PEM)
    const e = viewer.eyePos(), d = viewer.viewDir();
    let best = null, bt = MARK_RANGE;
    for (const t of g.operators) {
      if (t.team === team || t.state === 'dead' || t.frozen) continue;
      // tolerancia: probar el rayo y dos rayos algo desviados (marcar es generoso)
      for (const off of [0, 0.03, -0.03]) {
        const dir = off ? norm({ x: d.x + off * Math.cos(viewer.yaw), y: d.y + Math.abs(off) * 0.5, z: d.z - off * Math.sin(viewer.yaw) }) : d;
        const r = rayHitRig(t.rig, e, dir, bt);
        if (!r) continue;
        const px = e.x + dir.x * r.t, py = e.y + dir.y * r.t, pz = e.z + dir.z * r.t;
        if (!lineOfSight(g.world, e.x, e.y, e.z, px - dir.x * 0.1, py - dir.y * 0.1, pz - dir.z * 0.1)) continue;
        if (r.t < bt) { bt = r.t; best = t; }
        break;
      }
    }
    g.emit('markTry', viewer, best);
    if (!best) return null;
    this.spotted.set(best, { until: g.time + SPOT_TIME, team, by: viewer });
    g.emit('spotted', best, viewer, team, by);
    return best;
  }
  isSpottedFor(op, team) { const s = this.spotted.get(op); return !!s && s.team === team && s.until > this.game.time; }

  /**
   * Marcar en persona (T o botón central): el enemigo al que apunta `op` o, si no hay
   * ninguno, una marca de posición donde mira. Devuelve {kind: 'enemy', op} o
   * {kind: 'ping', ping}, o null si no mira a nada a menos de 60 m.
   */
  markOrPing(op) {
    const enemy = this.mark(op, op.team, op);
    if (enemy) return { kind: 'enemy', op: enemy };
    const ping = this.ping(op);
    return ping ? { kind: 'ping', ping } : null;
  }
  /** Marca de posición donde mira `op` (null si no mira a nada a menos de 60 m). */
  ping(op) {
    const g = this.game, e = op.eyePos(), d = op.viewDir();
    const hit = raycastFirst(g.world, e.x, e.y, e.z, d.x, d.y, d.z, PING_RANGE);
    if (!hit) return null;
    const t = Math.max(0, hit.t - 0.06);
    const ping = { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t, team: op.team, by: op, t: g.time, until: g.time + PING_TIME, from: { x: e.x, y: e.y, z: e.z } };
    this.pings.set(op, ping);
    g.emit('pinged', op, ping);
    return ping;
  }
  /** La marca de posición más reciente del equipo (o la de `by`, si se indica). */
  pingOf(team, by = null) {
    if (by) { const p = this.pings.get(by); return p && p.team === team ? p : null; }
    let best = null;
    for (const p of this.pings.values()) if (p.team === team && (!best || p.t > best.t)) best = p;
    return best;
  }
}

function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }

export function rayAABB(o, d, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0, tmax = maxT;
  for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return -1; continue; }
    let t1 = (a - oo) / dd, t2 = (b - oo) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
export function raySphere(o, d, cx, cy, cz, r, maxT) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1;
  return t;
}

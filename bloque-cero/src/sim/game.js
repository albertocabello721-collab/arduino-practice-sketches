// Simulación: mundo, mapa, operadores, balas, daño y eventos. Sin render ni DOM:
// corre igual en el navegador que en Node (tests de partidas completas).
import { Emitter } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { traceBullet, applyBulletPlan, powerAt, meleeBreak, shatterGlass } from '../world/destruction.js';
import { falloffAt } from './weapons.js';
import { rayHitRig } from './skeleton.js';
import { raycastFirst, lineOfSight } from '../world/raycast.js';
import { SOLID, MAT, GLASS } from '../world/materials.js';

export const TICK = 1 / 60;
export const LIMB_MUL = 0.75;
export const MELEE_DAMAGE = 45;
export const MELEE_RANGE = 1.6;
const DOWN_OVERKILL = 30;   // si el golpe sobrepasa la vida en más de esto, muerte directa

export class Game extends Emitter {
  constructor({ world, map, seed = 1 }) {
    super();
    this.world = world;
    this.map = map;
    this.bounds = map.bounds;
    this.rng = new RNG(seed);
    this.time = 0;
    this.tickCount = 0;
    this.operators = [];
    this.targets = [];        // objetos que las balas destruyen: drones, cámaras (y gadgets en la Fase 6)
    this.friendlyFire = false;
  }
  addOperator(op) { this.operators.push(op); return op; }
  removeOperator(op) { const i = this.operators.indexOf(op); if (i >= 0) this.operators.splice(i, 1); }

  tick(dt = TICK) {
    this.time += dt;
    this.tickCount++;
    for (const op of this.operators) op.update(dt, this);
  }

  /**
   * Dispara una bala: traza el recorrido, comprueba impactos con operadores
   * (zonas de impacto), destruye los vóxeles blandos que atraviesa hasta el
   * impacto y emite eventos. Devuelve {end, hit, hitOp, zone, destroyed, ...}.
   */
  fireBullet(op, origin, dir, weapon) {
    const d = weapon.def;
    const plan = traceBullet(this.world, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, d.range, 1.0, this.rng,
      { extraBreak: d.extraBreak, penScale: 1 / d.penetration });
    const maxT = Math.min(plan.stopT, d.range);
    // impactos con operadores (ignora al tirador y, sin fuego amigo, a los compañeros)
    let hitOp = null, hitT = Infinity, hitZone = null;
    for (const t of this.operators) {
      if (t === op || t.state === 'dead' || t.frozen) continue;   // congelado = aún no desplegado
      if (!this.friendlyFire && op && t.team === op.team) continue;
      const c = t.body.pos;
      const cx = c.x - origin.x, cy = c.y + 0.7 - origin.y, cz = c.z - origin.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along < -1.2 || along > maxT + 1.2) continue;
      const px = cx - dir.x * along, py = cy - dir.y * along, pz = cz - dir.z * along;
      if (px * px + py * py + pz * pz > 1.6 * 1.6) continue;
      const r = rayHitRig(t.rig, origin, dir, maxT);
      if (r && r.t < hitT) { hitT = r.t; hitOp = t; hitZone = r.zone; }
    }
    // objetos disparables (drones, cámaras): la bala se detiene en el primero que toque
    let hitTarget = null, targetT = Infinity;
    for (const tg of this.targets) {
      if (!tg.alive || (op && !this.friendlyFire && tg.team === op.team)) continue;
      const t = tg.rayTest(origin, dir, Math.min(maxT, hitT));
      if (t >= 0 && t < targetT) { targetT = t; hitTarget = tg; }
    }
    if (hitTarget) { hitOp = null; hitT = Infinity; hitZone = null; }
    const cutT = hitTarget ? targetT : hitOp ? hitT : maxT;
    const destroyed = applyBulletPlan(this.world, plan, cutT, this.rng);
    let hit = null;
    if (!hitOp && !hitTarget) for (const s of plan.segments) if (s.action === 'stop') { hit = s; break; }
    const end = cutT === Infinity ? d.range : cutT;
    const point = { x: origin.x + dir.x * end, y: origin.y + dir.y * end, z: origin.z + dir.z * end };
    const res = { origin: { ...origin }, dir: { ...dir }, end, hit, point, segments: plan.segments, destroyed, power: plan.finalPower, hitOp, zone: hitZone, damage: 0, hitTarget };
    if (hitTarget) this.hitTarget(hitTarget, d.damage * falloffAt(d, targetT) * powerAt(plan, targetT, 1.0), op, point);
    if (hitOp) {
      const pen = powerAt(plan, hitT, 1.0);
      const fall = falloffAt(d, hitT);
      // cabeza: baja inmediata, salvo perdigones (×1,5); extremidades ×0,75
      const pellet = d.pellets > 1;
      const dmg = d.damage * fall * pen * (hitZone === 'limb' ? LIMB_MUL : hitZone === 'head' && pellet ? 1.5 : 1);
      res.damage = dmg;
      res.throughWall = pen < 0.999;
      if (op) op.stats.hits++;
      this.damage(hitOp, dmg, { by: op, weapon: d, zone: hitZone, dir, point, throughWall: res.throughWall, canHeadshot: !pellet });
    }
    this.emit('bullet', op, res);
    if (destroyed.length) this.emit('voxels', destroyed, 'bullet', point, dir);
    return res;
  }

  /**
   * Aplica daño. Tiro a la cabeza = baja inmediata. Llegar a 0 sin tiro a la cabeza
   * derriba (sangra 20 s) salvo que el golpe sobrepase mucho la vida. Cualquier daño
   * a un derribado lo remata.
   */
  damage(target, amount, info = {}) {
    if (!target || target.state === 'dead' || target.frozen) return;
    const by = info.by || null;
    if (by && by !== target) { by.stats.damage += Math.min(amount, Math.max(0, target.hp)); target.lastHitBy = by; }
    target.hitFlinch = 1;
    const ev = { by, weapon: info.weapon || null, zone: info.zone || 'body', dir: info.dir || null, point: info.point || null, amount, throughWall: !!info.throughWall };
    if (target.state === 'downed') { this.kill(target, { ...ev, finish: true }); return; }
    if (ev.zone === 'head' && info.canHeadshot !== false) { this.kill(target, { ...ev, headshot: true }); return; }
    const before = target.hp;
    target.hp -= amount;
    this.emit('damaged', target, ev);
    if (target.hp <= 0) {
      if (!info.noDown && before > 0 && -target.hp < DOWN_OVERKILL) this.down(target, ev);
      else this.kill(target, ev);
    }
  }

  down(target, ev) {
    target.becomeDowned(this, ev.by);
    if (ev.by) ev.by.stats.downs++;
    this.emit('downed', target, ev);
  }

  kill(target, ev = {}) {
    if (target.state === 'dead') return;
    // la baja se atribuye a quien remata; si se desangra, a quien lo derribó
    const by = ev.by || target.downedBy || target.lastHitBy || null;
    // dirección de la caída: hacia atrás si el disparo venía de delante
    if (ev.dir) {
      const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
      target.pose.deathDir = (ev.dir.x * fx + ev.dir.z * fz) < 0 ? 1 : -1;
      target.pose.deathSide = (this.rng.next() - 0.5);
    }
    target.becomeDead();
    if (by && by !== target) { by.stats.kills++; if (ev.headshot) by.stats.headshots++; }
    this.emit('killed', target, { ...ev, by });
  }

  // Daño a un objeto: los que tienen vida (el desactivador) la pierden; el resto cae de un golpe.
  hitTarget(tg, amount, by = null, point = null) {
    if (!tg.alive) return;
    if (tg.hp === undefined) { this.destroyTarget(tg, by, point); return; }
    tg.hp -= amount;
    this.emit('targetHit', tg, by, point, amount);
    if (tg.hp <= 0) this.destroyTarget(tg, by, point);
  }

  destroyTarget(tg, by = null, point = null) {
    if (!tg.alive) return;
    tg.alive = false;
    this.emit('targetDestroyed', tg, by, point || (tg.center ? tg.center() : null));
  }

  /**
   * Golpe cuerpo a cuerpo: daña a un enemigo que esté delante (a menos de 1,6 m)
   * o, si no hay nadie, rompe el material blando que tenga delante (barricadas,
   * pladur, suelos de madera). No afecta a refuerzos, ladrillo ni trampillas.
   */
  melee(op) {
    const eye = op.eyePos(), dir = op.viewDir();
    let target = null, best = MELEE_RANGE, tp = null;
    for (const t of this.operators) {
      if (t === op || t.state === 'dead' || t.frozen || (!this.friendlyFire && t.team === op.team)) continue;
      const c = t.center();
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > best + 0.3) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(1e-6, d) < 0.72) continue;
      if (!lineOfSight(this.world, eye.x, eye.y, eye.z, c.x, c.y, c.z)) continue;
      best = d; target = t; tp = c;
    }
    if (target) {
      this.damage(target, MELEE_DAMAGE, { by: op, zone: 'body', dir, point: tp, melee: true });
      this.emit('melee', op, { target, point: tp });
      return;
    }
    for (const tg of this.targets) {
      if (!tg.alive || tg.team === op.team) continue;
      const t = tg.rayTest(eye, dir, 1.4);
      if (t >= 0) { this.hitTarget(tg, MELEE_DAMAGE, op, tg.center()); this.emit('melee', op, { point: tg.center() }); return; }
    }
    const hit = raycastFirst(this.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 1.45, SOLID, true);
    if (!hit) { this.emit('melee', op, {}); return; }
    const px = eye.x + dir.x * hit.t, py = eye.y + dir.y * hit.t, pz = eye.z + dir.z * hit.t;
    // el cristal se rompe entero, como con una bala
    if (GLASS[hit.mat]) {
      const list = shatterGlass(this.world, hit.x, hit.y, hit.z);
      if (list.length) this.emit('voxels', list, 'melee', { x: px, y: py, z: pz }, dir);
      this.emit('melee', op, { point: { x: px, y: py, z: pz }, mat: hit.mat, destroyed: list });
      return;
    }
    // la madera de las barricadas salta en trozos grandes; el pladur cede un parche
    const r = hit.mat === MAT.BARRICADE ? 0.62 : 0.36;
    const list = meleeBreak(this.world, px + dir.x * 0.1, py + dir.y * 0.1, pz + dir.z * 0.1, r);
    if (list.length) this.emit('voxels', list, 'melee', { x: px, y: py, z: pz }, dir);
    this.emit('melee', op, { point: { x: px, y: py, z: pz }, mat: hit.mat, destroyed: list });
  }

  // Quita vóxeles (coordenadas de vóxel) y avisa a render, audio e IA.
  clearVoxels(list, cause = 'misc', point = null) {
    const w = this.world, out = [];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const [x, y, z] of list) {
      const m = w.get(x, y, z);
      if (!m) continue;
      w.setRaw(x, y, z, MAT.AIR);
      out.push({ x, y, z, mat: m });
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    if (!out.length) return out;
    w.notify(x0, y0, z0, x1, y1, z1);
    this.emit('voxels', out, cause, point, null);
    return out;
  }

  // Compañero derribado más cercano al alcance de `op` (para reanimar con F).
  findRevivable(op, range = 1.6) {
    let best = null, bd = range * range;
    for (const t of this.operators) {
      if (t === op || t.team !== op.team || t.state !== 'downed') continue;
      const dx = t.body.pos.x - op.body.pos.x, dy = t.body.pos.y - op.body.pos.y, dz = t.body.pos.z - op.body.pos.z;
      const d = dx * dx + dy * dy * 4 + dz * dz;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}

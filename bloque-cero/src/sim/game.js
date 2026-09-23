// Simulación: mundo, mapa, operadores, balas, daño y eventos. Sin render ni DOM:
// corre igual en el navegador que en Node (tests de partidas completas).
import { Emitter } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { traceBullet, applyBulletPlan, powerAt } from '../world/destruction.js';
import { falloffAt } from './weapons.js';
import { rayHitRig } from './skeleton.js';

export const TICK = 1 / 60;
export const LIMB_MUL = 0.75;
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
      if (t === op || t.state === 'dead') continue;
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
    const cutT = hitOp ? hitT : maxT;
    const destroyed = applyBulletPlan(this.world, plan, cutT, this.rng);
    let hit = null;
    if (!hitOp) for (const s of plan.segments) if (s.action === 'stop') { hit = s; break; }
    const end = cutT === Infinity ? d.range : cutT;
    const point = { x: origin.x + dir.x * end, y: origin.y + dir.y * end, z: origin.z + dir.z * end };
    const res = { origin: { ...origin }, dir: { ...dir }, end, hit, point, segments: plan.segments, destroyed, power: plan.finalPower, hitOp, zone: hitZone, damage: 0 };
    if (hitOp) {
      const pen = powerAt(plan, hitT, 1.0);
      const fall = falloffAt(d, hitT);
      const dmg = d.damage * fall * pen * (hitZone === 'limb' ? LIMB_MUL : 1);
      res.damage = dmg;
      res.throughWall = pen < 0.999;
      if (op) op.stats.hits++;
      this.damage(hitOp, dmg, { by: op, weapon: d, zone: hitZone, dir, point, throughWall: res.throughWall });
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
    if (!target || target.state === 'dead') return;
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

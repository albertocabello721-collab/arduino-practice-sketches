// Simulación: mundo, mapa, operadores, balas y eventos. Sin render ni DOM:
// corre igual en el navegador que en Node (tests de partidas completas).
import { Emitter } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { traceBullet, applyBulletPlan } from '../world/destruction.js';

export const TICK = 1 / 60;

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
  }
  addOperator(op) { this.operators.push(op); return op; }

  tick(dt = TICK) {
    this.time += dt;
    this.tickCount++;
    for (const op of this.operators) if (op.alive) op.update(dt, this);
  }

  /**
   * Dispara una bala: traza el recorrido, destruye vóxeles blandos que atraviesa
   * y emite eventos. Devuelve {end, hit, destroyed, power}.
   */
  fireBullet(op, origin, dir, weapon) {
    const d = weapon.def;
    const plan = traceBullet(this.world, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, d.range, 1.0, this.rng,
      { extraBreak: d.extraBreak, penScale: 1 / d.penetration });
    const cutT = Math.min(plan.stopT, d.range);
    const destroyed = applyBulletPlan(this.world, plan, cutT, this.rng);
    let hit = null;
    for (const s of plan.segments) if (s.action === 'stop') { hit = s; break; }
    const end = cutT === Infinity ? d.range : cutT;
    const res = { origin: { ...origin }, dir: { ...dir }, end, hit, segments: plan.segments, destroyed, power: plan.finalPower };
    this.emit('bullet', op, res);
    if (destroyed.length) this.emit('voxels', destroyed, 'bullet', { x: origin.x + dir.x * end, y: origin.y + dir.y * end, z: origin.z + dir.z * end }, dir);
    return res;
  }
}

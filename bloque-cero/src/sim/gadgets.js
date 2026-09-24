// Gadgets secundarios lanzables (sección 13 del documento): granada de fragmentación,
// humo y cegadora (ataque) y granada de impacto (defensa). Se lanzan con G desde los
// ojos, vuelan con gravedad y rebotan en los vóxeles hasta pararse.
//   · Fragmentación: mecha de 3 s desde el lanzamiento; letal a 1,5 m y daño hasta 3 m;
//     rompe material blando cerca. Las paredes duras protegen; las blandas atenúan.
//   · Humo: se abre al pararse (o a los 1,5 s): nube de 4 m de radio durante 10 s que
//     tapa la vista (también a los bots).
//   · Cegadora: mecha de 1,5 s; ciega hasta 3,5 s a quien la ve (menos si mira a otro lado).
//   · Impacto: explota al tocar algo; abre 1 m de pared blanda y hiere a menos de 2 m.
// Simulación pura (corre en Node); el cliente pinta los objetos y los efectos.
import { SOLID, HARD, MAT } from '../world/materials.js';
import { lineOfSight, traverse } from '../world/raycast.js';
import { explodeSphere } from '../world/destruction.js';

export const THROW = { speed: 12, up: 2.0, gravity: 9.8, bounce: 0.35, radius: 0.05, cooldown: 1.0 };
export const FRAG = { fuse: 3, lethal: 1.5, radius: 3, damage: 160, hole: 0.5 };
export const IMPACT = { lethal: 0.6, radius: 2, damage: 70, hole: 0.55 };
export const SMOKE = { radius: 4, time: 10, grow: 1.5, openAfter: 1.5 };
export const FLASH = { fuse: 1.5, range: 12, max: 3.5, min: 0.8 };
const THROWABLE = { frag: true, smoke: true, flash: true, impact: true };

export class Gadgets {
  constructor(game) {
    this.game = game;
    this.items = [];        // proyectiles en vuelo o en el suelo
    this.smokes = [];       // nubes de humo activas {x, y, z, r, t0, until, team}
    this._nextId = 1;
    game.gadgets = this;
  }
  reset() { this.items = []; this.smokes = []; }

  /** ¿Puede `op` usar su gadget secundario ahora? */
  canUse(op) {
    const g = op.gadget;
    return !!g && g.left > 0 && op.state === 'alive' && !op.frozen && !op.channel && (op.gadgetCd || 0) <= 0;
  }

  /** Lanza el gadget de `op` (si es lanzable). Devuelve el proyectil o null. */
  throwFrom(op) {
    if (!this.canUse(op) || !THROWABLE[op.gadget.id]) return null;
    const e = op.eyePos(), d = op.viewDir(), v = op.body.vel;
    const it = {
      id: `g${this._nextId++}`, kind: op.gadget.id, owner: op, team: op.team,
      pos: { x: e.x + d.x * 0.35, y: e.y + d.y * 0.35 - 0.05, z: e.z + d.z * 0.35 },
      vel: { x: d.x * THROW.speed + v.x * 0.6, y: d.y * THROW.speed + THROW.up + Math.max(0, v.y) * 0.4, z: d.z * THROW.speed + v.z * 0.6 },
      t: 0, rest: false, alive: true, bounces: 0,
    };
    // si nada más salir choca (pegado a una pared), se suelta a los pies
    if (SOLID[this.game.world.getWorld(it.pos.x, it.pos.y, it.pos.z)]) { it.pos = { x: e.x, y: e.y - 0.2, z: e.z }; }
    op.gadget.left--;
    op.gadgetCd = THROW.cooldown;
    this.items.push(it);
    this.game.emit('gadgetThrown', op, it);
    return it;
  }

  tick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      if (op.gadgetCd > 0) op.gadgetCd -= dt;
      if (op.blindT > 0) op.blindT = Math.max(0, op.blindT - dt);
      const I = op.intent;
      if (I.gadget) { I.gadget = false; if (!this.throwFrom(op) && op.gadget && op.gadget.left <= 0 && op.state === 'alive') g.emit('gadgetEmpty', op); }
    }
    for (const it of this.items) {
      if (!it.alive) continue;
      it.t += dt;
      if (!it.rest) this._move(it, dt);
      if (!it.alive) continue;
      if (it.kind === 'frag' && it.t >= FRAG.fuse) this._explode(it, FRAG);
      else if (it.kind === 'flash' && it.t >= FLASH.fuse) this._flash(it);
      else if (it.kind === 'smoke' && (it.rest || it.t >= SMOKE.openAfter)) this._smoke(it);
    }
    this.items = this.items.filter((it) => it.alive);
    this.smokes = this.smokes.filter((s) => s.until > g.time);
  }

  // Vuelo con rebotes: se prueba cada eje por separado para saber con qué cara choca.
  _move(it, dt) {
    const w = this.game.world, p = it.pos, v = it.vel;
    v.y -= THROW.gravity * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(v.x, v.y, v.z) * dt / 0.1));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      let hit = false;
      for (const ax of ['x', 'y', 'z']) {
        const np = { x: p.x, y: p.y, z: p.z };
        np[ax] += v[ax] * h;
        if (SOLID[w.getWorld(np.x, np.y, np.z)] || this._hitsOperator(it, np)) {
          hit = true;
          if (it.kind === 'impact') { this._explode(it, IMPACT); return; }
          v[ax] = -v[ax] * THROW.bounce;
          // rozamiento al tocar el suelo o una pared
          const f = ax === 'y' ? 0.7 : 0.85;
          for (const o of ['x', 'y', 'z']) if (o !== ax) v[o] *= f;
        } else p[ax] = np[ax];
      }
      if (hit) {
        it.bounces++;
        if (it.bounces === 1) this.game.emit('gadgetBounce', it);
      }
    }
    // en reposo: apoyado y casi sin velocidad
    const below = SOLID[w.getWorld(p.x, p.y - 0.08, p.z)];
    if (below && Math.hypot(v.x, v.y, v.z) < 0.6) { it.rest = true; v.x = v.y = v.z = 0; }
    if (p.y < -30) it.alive = false;
  }
  _hitsOperator(it, np) {
    if (it.t < 0.12) return false;          // recién lanzada: no choca con quien la lanza
    for (const op of this.game.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const b = op.body.pos;
      if (Math.hypot(np.x - b.x, np.z - b.z) < 0.28 && np.y > b.y && np.y < b.y + op.body.height) return true;
    }
    return false;
  }

  // Explosión: daño por distancia (muerte directa dentro del radio letal), paredes que
  // protegen y hueco en el material blando.
  _explode(it, spec) {
    const g = this.game, p = it.pos;
    it.alive = false;
    const destroyed = explodeSphere(g.world, p.x, p.y, p.z, spec.hole);
    if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...p }, null);
    for (const op of g.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const c = op.center ? op.center() : { x: op.body.pos.x, y: op.body.pos.y + 0.9, z: op.body.pos.z };
      const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (d > spec.radius) continue;
      const cover = this._blastCover(p, c);
      if (cover <= 0) continue;
      const lethal = d <= spec.lethal;
      const k = lethal ? 1 : 1 - (d - spec.lethal) / (spec.radius - spec.lethal);
      const dmg = spec.damage * k * cover;
      if (dmg < 1) continue;
      g.damage(op, dmg, { by: it.owner, weapon: { name: it.kind === 'frag' ? 'Fragmentación' : 'Impacto', explosive: true }, zone: 'body', point: { ...p }, noDown: lethal && cover > 0.9, explosive: true });
    }
    g.emit('explosion', it.kind, { ...p }, spec, it.owner);
  }
  // Fracción de la onda que llega de a a b: 0 si hay algo duro en medio; cada vóxel blando la reduce.
  _blastCover(a, b) {
    const w = this.game.world;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return 1;
    let k = 1;
    traverse(w, a.x, a.y, a.z, dx / len, dy / len, dz / len, len, (x, y, z, t, face, mat) => {
      if (mat === MAT.AIR || !SOLID[mat]) return false;
      if (HARD[mat]) { k = 0; return true; }
      k *= 0.8;
      return k < 0.05;
    });
    return k;
  }

  _flash(it) {
    const g = this.game, p = it.pos;
    it.alive = false;
    const hitList = [];
    for (const op of g.operators) {
      if (op.state !== 'alive' || op.frozen) continue;
      const e = op.eyePos();
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, d = Math.hypot(dx, dy, dz);
      if (d > FLASH.range) continue;
      if (!lineOfSight(g.world, p.x, p.y + 0.05, p.z, e.x, e.y, e.z)) continue;
      const v = op.viewDir();
      const facing = (dx * v.x + dy * v.y + dz * v.z) / Math.max(0.01, d);    // 1 = mirando hacia ella
      // de frente, entera; de lado, algo más de la mitad; de espaldas, un poco (continuo)
      const look = facing > 0.5 ? 1 : facing > -0.3 ? 0.35 + (facing + 0.3) * 0.8125 : 0.3;
      const near = d < 5 ? 1 : 1 - (d - 5) / (FLASH.range - 5) * 0.6;
      const t = Math.max(FLASH.min, FLASH.max * look * near);
      op.blindT = Math.max(op.blindT || 0, t);
      op.blindMax = Math.max(op.blindT, op.blindMax || 0);
      hitList.push(op);
    }
    g.emit('flashbang', { ...p }, hitList, it.owner);
  }

  _smoke(it) {
    const g = this.game, p = it.pos;
    it.alive = false;
    const s = { x: p.x, y: p.y + 0.4, z: p.z, r: SMOKE.radius, t0: g.time, until: g.time + SMOKE.time, team: it.team };
    this.smokes.push(s);
    g.emit('smoke', s, it.owner);
  }

  /** Radio actual de una nube (crece al abrirse y se deshace al final). */
  smokeRadius(s, now = this.game.time) {
    const age = now - s.t0, left = s.until - now;
    if (left <= 0) return 0;
    return s.r * Math.min(1, age / SMOKE.grow, left / 1.5 + 0.2);
  }
  /** ¿El humo tapa la vista entre a y b? (más de 1,2 m de recorrido dentro de una nube) */
  smokeBlocks(a, b) {
    if (!this.smokes.length) return false;
    const now = this.game.time;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return false;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, now);
      if (r <= 0.3) continue;
      const cx = s.x - a.x, cy = s.y - a.y, cz = s.z - a.z;
      const t = cx * ux + cy * uy + cz * uz;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 >= r * r) continue;
      const half = Math.sqrt(r * r - d2);
      const t0 = Math.max(0, t - half), t1 = Math.min(L, t + half);
      if (t1 - t0 > 1.2) return true;
    }
    return false;
  }
  /** ¿Está el punto dentro de una nube? (para el velo de humo en pantalla). Devuelve 0..1. */
  smokeAt(p) {
    let k = 0;
    const now = this.game.time;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, now);
      if (r <= 0) continue;
      const d = Math.hypot(p.x - s.x, (p.y - s.y) * 1.3, p.z - s.z);
      if (d < r) k = Math.max(k, Math.min(1, (r - d) / (r * 0.35)));
    }
    return k;
  }
}

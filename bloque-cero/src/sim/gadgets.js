// Gadgets secundarios lanzables (sección 13 del documento): granada de fragmentación,
// humo y cegadora (ataque) y granada de impacto (defensa). Se lanzan con G desde los
// ojos, vuelan con gravedad y rebotan en los vóxeles hasta pararse.
//   · Fragmentación: mecha de 3 s desde el lanzamiento; letal a 1,5 m y daño hasta 3 m;
//     rompe material blando cerca. Las paredes duras protegen; las blandas atenúan.
//   · Humo: se abre al pararse (o a los 1,5 s): nube de 4 m de radio durante 10 s que
//     tapa la vista (también a los bots).
//   · Cegadora: mecha de 1,5 s; ciega hasta 3,5 s a quien la ve (menos si mira a otro lado).
//   · Impacto: explota al tocar algo; abre 1 m de pared blanda y hiere a menos de 2 m.
// Explosivos colocados:
//   · Carga de brecha (ataque): G mirando una pared blanda, una barricada o una trampilla a
//     menos de 1,6 m; se coloca en 1,5 s y G otra vez la detona: abre un hueco de 1 × 2 m
//     (la barricada o la trampilla entera); letal a 1 m y daño hasta 2,5 m.
//   · C4 remoto (defensa): se lanza y se pega donde toca; G lo detona: letal a 2,5 m, daño
//     hasta 4 m, atraviesa paredes blandas y suelos.
//   · Claymore (ataque): se deja en el suelo mirando al frente (1 s); salta cuando un
//     enemigo entra en su cono de 2 m: letal en el cono.
//   Todos se destruyen de un disparo del bando contrario.
// Simulación pura (corre en Node); el cliente pinta los objetos y los efectos.
import { SOLID, HARD, MAT, BLAST_RES, GLASS } from '../world/materials.js';
import { lineOfSight, traverse, raycastFirst } from '../world/raycast.js';
import { explodeSphere, breachRect } from '../world/destruction.js';

export const THROW = { speed: 12, up: 2.0, gravity: 9.8, bounce: 0.35, radius: 0.05, cooldown: 1.0 };
export const FRAG = { fuse: 3, lethal: 1.5, radius: 3, damage: 160, hole: 0.5 };
export const IMPACT = { lethal: 0.6, radius: 2, damage: 70, hole: 0.55 };
export const SMOKE = { radius: 4, time: 10, grow: 1.5, openAfter: 1.5 };
export const FLASH = { fuse: 1.5, range: 12, max: 3.5, min: 0.8 };
export const BREACH = { place: 1.5, reach: 1.6, lethal: 1.0, radius: 2.5, damage: 160, w: 1.0, h: 2.0 };
export const C4 = { lethal: 2.5, radius: 4, damage: 180, hole: 0.7, soft: 0.9 };
export const CLAYMORE = { place: 1.0, range: 2, cone: 0.866, lethal: 2, radius: 3, damage: 160 };
const THROWABLE = { frag: true, smoke: true, flash: true, impact: true, c4: true };
const PLACEABLE = { breach: BREACH, claymore: CLAYMORE };

export class Gadgets {
  constructor(game) {
    this.game = game;
    this.items = [];        // proyectiles en vuelo o en el suelo (y el C4 pegado)
    this.smokes = [];       // nubes de humo activas {x, y, z, r, t0, until, team}
    this.placed = [];       // cargas de brecha y claymores colocadas
    this.work = new Map();  // operador → colocación en curso {kind, t, total, spot, from}
    this._nextId = 1;
    game.gadgets = this;
  }
  reset() {
    this.items = []; this.smokes = []; this.placed = []; this.work.clear();
    this.game.targets = this.game.targets.filter((t) => t.kind !== 'gadget');
  }

  /** ¿Puede `op` usar su gadget secundario ahora? */
  canUse(op) {
    const g = op.gadget;
    return !!g && g.left > 0 && op.state === 'alive' && !op.frozen && !op.channel && (op.gadgetCd || 0) <= 0;
  }

  /**
   * G: detona lo que tenga pendiente (brecha colocada, C4 pegado); si no, lanza (granadas,
   * C4) o empieza a colocar (brecha, claymore). Devuelve lo que ha hecho o null.
   */
  use(op) {
    if (!op.gadget || op.state !== 'alive' || op.frozen) return null;
    const mine = this._detonable(op);
    if (mine) { this.detonate(mine); return 'detonate'; }
    if (PLACEABLE[op.gadget.id]) return this.startPlace(op) ? 'place' : null;
    return this.throwFrom(op) ? 'throw' : null;
  }
  _detonable(op) {
    for (const it of this.items) if (it.alive && it.owner === op && it.kind === 'c4' && it.stuck) return it;
    for (const it of this.placed) if (it.alive && it.owner === op && it.kind === 'breach') return it;
    return null;
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
      if (I.gadget) { I.gadget = false; if (!this.use(op) && op.gadget && op.gadget.left <= 0 && op.state === 'alive') g.emit('gadgetEmpty', op); }
    }
    this._workTick(dt);
    for (const c of this.placed) if (c.alive && c.kind === 'claymore') this._claymoreTick(c);
    this.placed = this.placed.filter((c) => c.alive);
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
          if (it.kind === 'c4') { this._stick(it, ax, v[ax]); return; }
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
    if (it.target) this._untarget(it);
    if (spec.hole) {
      const destroyed = explodeSphere(g.world, p.x, p.y, p.z, spec.hole);
      if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...p }, null);
    }
    this._blastDamage(p, spec, it.owner, it.kind);
    g.emit('explosion', it.kind, { ...p }, spec, it.owner);
  }
  _blastDamage(p, spec, owner, kind, filter = null) {
    const g = this.game;
    const names = { frag: 'Fragmentación', impact: 'Impacto', breach: 'Carga de brecha', c4: 'C4', claymore: 'Claymore' };
    for (const op of g.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const c = op.center ? op.center() : { x: op.body.pos.x, y: op.body.pos.y + 0.9, z: op.body.pos.z };
      const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (d > spec.radius) continue;
      const cover = this._blastCover(p, c, spec.soft || 0.8);
      if (cover <= 0) continue;
      const cone = filter ? filter(op, c) : 1;
      if (cone <= 0) continue;
      const lethal = d <= spec.lethal && cone >= 1;
      const k = d <= spec.lethal ? 1 : 1 - (d - spec.lethal) / (spec.radius - spec.lethal);
      const dmg = spec.damage * k * cover * cone;
      if (dmg < 1) continue;
      g.damage(op, dmg, { by: owner, weapon: { name: names[kind] || 'Explosivo', explosive: true }, zone: 'body', point: { ...p }, noDown: lethal && cover > 0.9, explosive: true });
    }
  }
  // Fracción de la onda que llega de a a b: 0 si hay algo duro en medio; cada vóxel blando la reduce.
  _blastCover(a, b, soft = 0.8) {
    const w = this.game.world;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return 1;
    let k = 1;
    traverse(w, a.x, a.y, a.z, dx / len, dy / len, dz / len, len, (x, y, z, t, face, mat) => {
      if (mat === MAT.AIR || !SOLID[mat]) return false;
      if (HARD[mat]) { k = 0; return true; }
      k *= soft;
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
  // ---------------------------------------------------------------- C4 pegado
  _stick(it, ax, vAx) {
    it.stuck = true; it.rest = true;
    it.vel.x = it.vel.y = it.vel.z = 0;
    it.normal = { x: 0, y: 0, z: 0 }; it.normal[ax] = vAx > 0 ? -1 : 1;
    this._target(it, 0.07);
    this.game.emit('gadgetStuck', it);
  }

  // ---------------------------------------------------------------- colocar (brecha, claymore)
  /** Dónde colocaría `op` su gadget ahora (o null, con el motivo en `why`). */
  placeSpot(op) {
    const id = op.gadget && op.gadget.id, w = this.game.world;
    const e = op.eyePos(), d = op.viewDir();
    if (id === 'breach') {
      const hit = raycastFirst(w, e.x, e.y, e.z, d.x, d.y, d.z, BREACH.reach, SOLID, true);
      if (!hit) return { why: 'Acércate a una pared' };
      const m = hit.mat;
      const axis = hit.face >> 1;
      const ok = m === MAT.BARRICADE || m === MAT.HATCH || (BLAST_RES[m] === 0 && !HARD[m] && !GLASS[m] && axis !== 1);
      if (!ok) return { why: m === MAT.REINFORCED ? 'Muro reforzado: la carga no lo abre' : 'Aquí no se puede poner' };
      const n = { x: 0, y: 0, z: 0 };
      n[['x', 'y', 'z'][axis]] = hit.face & 1 ? 1 : -1;
      // la cara golpeada mira hacia el que pone la carga
      if (n.x * d.x + n.y * d.y + n.z * d.z > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
      const t = hit.t - 0.02;
      return { ok: true, kind: 'breach', pos: { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t }, normal: n, axis, mat: m, voxel: { x: hit.x, y: hit.y, z: hit.z } };
    }
    if (id === 'claymore') {
      const p = op.body.pos, fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
      const x = p.x + fx * 0.5, z = p.z + fz * 0.5;
      if (SOLID[w.getWorld(x, p.y + 0.1, z)] || !SOLID[w.getWorld(x, p.y - 0.06, z)]) return { why: 'Necesitas suelo despejado delante' };
      return { ok: true, kind: 'claymore', pos: { x, y: p.y + 0.01, z }, yaw: op.yaw };
    }
    return null;
  }
  startPlace(op) {
    if (!this.canUse(op) || this.work.has(op)) return false;
    const spot = this.placeSpot(op);
    if (!spot || !spot.ok) { this.game.emit('gadgetDenied', op, spot ? spot.why : ''); return false; }
    const spec = PLACEABLE[spot.kind];
    const p = op.body.pos;
    this.work.set(op, { kind: spot.kind, t: 0, total: spec.place, spot, from: { x: p.x, y: p.y, z: p.z } });
    op.channel = { kind: 'gadget', t: 0, total: spec.place, what: spot.kind };
    this.game.emit('gadgetPlaceStart', op, spot);
    return true;
  }
  _workTick(dt) {
    for (const [op, wk] of this.work) {
      // (mientras se coloca no se anda: intentar moverse o disparar lo cancela)
      const I = op.intent, p = op.body.pos;
      const wantsMove = Math.abs(I.moveX || 0) + Math.abs(I.moveZ || 0) > 0.5;
      const moved = Math.hypot(p.x - wk.from.x, p.z - wk.from.z) > 0.45;
      if (op.state !== 'alive' || wantsMove || moved || I.fire || !op.gadget || op.gadget.left <= 0) { this._cancelWork(op); continue; }
      wk.t += dt;
      if (op.channel && op.channel.kind === 'gadget') op.channel.t = wk.t;
      if (wk.t < wk.total) continue;
      this.work.delete(op);
      if (op.channel && op.channel.kind === 'gadget') op.channel = null;
      this._place(op, wk.spot);
    }
  }
  _cancelWork(op) {
    this.work.delete(op);
    if (op.channel && op.channel.kind === 'gadget') op.channel = null;
    this.game.emit('gadgetPlaceCancel', op);
  }
  _place(op, spot) {
    op.gadget.left--;
    op.gadgetCd = 0.4;
    const c = { id: `g${this._nextId++}`, kind: spot.kind, owner: op, team: op.team, pos: { ...spot.pos }, normal: spot.normal || null, axis: spot.axis, mat: spot.mat, voxel: spot.voxel, yaw: spot.yaw || 0, alive: true, t0: this.game.time };
    this.placed.push(c);
    this._target(c, spot.kind === 'claymore' ? 0.12 : 0.2);
    this.game.emit('gadgetPlaced', op, c);
    return c;
  }

  // Los explosivos colocados se destruyen de un disparo del bando contrario.
  _target(it, r) {
    const g = this.game;
    const tg = {
      kind: 'gadget', gadget: it, team: it.team, alive: true,
      center: () => ({ x: it.pos.x, y: it.pos.y + (it.kind === 'claymore' ? 0.08 : 0), z: it.pos.z }),
      rayTest: (o, d, maxT) => {
        const c = tg.center();
        const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
        const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - cc;
        if (disc < 0) return -1;
        const t = -b - Math.sqrt(disc);
        return t < 0 || t > maxT ? -1 : t;
      },
    };
    it.target = tg;
    g.targets.push(tg);
    const off = g.on('targetDestroyed', (t) => { if (t === tg) { off(); it.alive = false; this.game.emit('gadgetDestroyed', it); } });
    it._off = off;
  }
  _untarget(it) {
    const g = this.game;
    if (it._off) it._off();
    g.targets = g.targets.filter((t) => t !== it.target);
    it.target = null;
  }

  /** Detona una carga de brecha colocada o un C4 pegado. */
  detonate(it) {
    if (!it.alive) return;
    if (!this.canDetonate(it)) { this.game.emit('gadgetJammed', it); return; }
    const g = this.game;
    if (it.kind === 'c4') { this._explode(it, C4); return; }
    // carga de brecha
    it.alive = false;
    this._untarget(it);
    let destroyed = [];
    const w = g.world;
    if (it.mat === MAT.BARRICADE || it.mat === MAT.HATCH) destroyed = this._clearConnected(it.voxel, it.mat);
    else {
      const n = it.normal, p = it.pos;
      const floorY = Math.floor((p.y + 0.3) / 3.5) * 3.5;
      const cx = it.axis === 0 ? p.x - n.x * 0.12 : p.x, cz = it.axis === 2 ? p.z - n.z * 0.12 : p.z;
      destroyed = breachRect(w, cx, Math.max(p.y, floorY + BREACH.h / 2 + 0.05), cz, it.axis, BREACH.w, BREACH.h, 0.6);
    }
    if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...it.pos }, null);
    this._blastDamage(it.pos, BREACH, it.owner, 'breach');
    g.emit('explosion', 'breach', { ...it.pos }, BREACH, it.owner);
  }
  // (los inhibidores de SILENCIO lo impedirán: Fase 6.5)
  canDetonate(it) { void it; return true; }
  // Quita la barricada (o la trampilla) entera: los vóxeles de ese material conectados.
  _clearConnected(v, mat) {
    const w = this.game.world, out = [], seen = new Set(), stack = [[v.x, v.y, v.z]];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    while (stack.length && out.length < 4000) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (w.get(x, y, z) !== mat) continue;
      w.setRaw(x, y, z, MAT.AIR);
      out.push({ x, y, z, mat });
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
    }
    if (out.length) w.notify(x0, y0, z0, x1, y1, z1);
    return out;
  }

  // Claymore: salta cuando un enemigo entra en su cono de 2 m (y la ve).
  _claymoreTick(c) {
    const g = this.game;
    if (g.time - c.t0 < 0.2) return;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    for (const op of g.operators) {
      if (op.team === c.team || op.state !== 'alive' || op.frozen) continue;
      const b = op.body.pos;
      const dx = b.x - c.pos.x, dz = b.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d > CLAYMORE.range || Math.abs(b.y - c.pos.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / Math.max(0.01, d) < CLAYMORE.cone) continue;
      if (!lineOfSight(g.world, c.pos.x, c.pos.y + 0.12, c.pos.z, b.x, b.y + 0.6, b.z)) continue;
      this._claymoreBlast(c);
      return;
    }
  }
  _claymoreBlast(c) {
    const g = this.game;
    c.alive = false;
    this._untarget(c);
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const p = { x: c.pos.x, y: c.pos.y + 0.12, z: c.pos.z };
    // letal en el cono de delante; detrás y a los lados, poco
    this._blastDamage(p, CLAYMORE, c.owner, 'claymore', (op, ctr) => {
      const dx = ctr.x - p.x, dz = ctr.z - p.z, d = Math.hypot(dx, dz) || 1;
      return (dx * fx + dz * fz) / d >= CLAYMORE.cone ? 1 : 0.2;
    });
    g.emit('explosion', 'claymore', p, CLAYMORE, c.owner);
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

// Uso de gadgets y habilidades por los bots de la defensa (F6.6a).
//
// En la preparación, cada bot añade a su lista de fortificación la colocación de su gadget
// secundario y de su habilidad, con la lógica del documento (sección 15): alambre en los
// pasillos junto a las puertas del sitio, escudo desplegable dentro del sitio mirando a un
// acceso, alarma en el suelo de una entrada, cámara blindada en la pared de enfrente de un
// acceso, baterías en los muros reforzados (y barricadas), inhibidores junto a ellos, minas
// láser en las puertas y ventanas de acceso, cámaras adhesivas lanzadas hacia fuera por las
// puertas, interceptores en el centro de cada sala, la bolsa de placas en el sitio (y los
// demás pasan a coger una) y los botes de gas en las entradas. En la acción, TIZÓN activa
// el gas cuando sabe de un atacante junto a uno de sus botes.
//
// Cada colocación es una tarea {kind: 'use', what: 'gadget'|'ability', id, stand, face,
// pitch}: ir al punto, encarar y pulsar G o X (lo mismo que haría un jugador). Los puntos se
// comprueban al planificar con un operador de prueba (placeSpot), así que solo se piden
// colocaciones que el juego acepta. Los bots en Novato no usan gadgets (documento).
import { entrancesOf } from './tactics.js';
import { STANCES } from '../physics.js';
import { THROW } from '../gadgets.js';
import { lineOfSight, raycastFirst } from '../../world/raycast.js';
import { SOLID } from '../../world/materials.js';

const EYE = STANCES.stand.eye;
export const GAS_TRIGGER = 3.2;          // un atacante conocido a menos de esto de un bote: activar
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// Operador de prueba: de pie en `stand` mirando con (yaw, pitch).
function probe(op, stand, yaw, pitch) {
  const pos = { x: stand.x, y: stand.y, z: stand.z };
  return {
    team: op.team, side: op.side, yaw, pitch, gadget: op.gadget, ability: op.ability, body: { pos },
    eyePos(out = { x: 0, y: 0, z: 0 }) { out.x = pos.x; out.y = pos.y + EYE; out.z = pos.z; return out; },
    viewDir(out = { x: 0, y: 0, z: 0 }) { const cp = Math.cos(pitch); out.x = -Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * cp; return out; },
  };
}

class Planner {
  constructor(sq, rooms) {
    const M = sq.match;
    this.sq = sq;
    this.G = M.game.gadgets;
    this.world = M.world;
    this.map = M.map;
    this.nav = sq.nav;
    this.rng = M.game.rng;
    this.rooms = rooms;
    // accesos del sitio (sin trampillas), con su sala
    this.ents = [];
    // (sin las puertas entre las dos salas del sitio: por ahí no entra el ataque)
    const inSite = (x, y, z) => rooms.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && Math.abs(y - r.floorY) < 1);
    for (const r of rooms) {
      for (const e of entrancesOf(M.map, r)) {
        if (e.kind.startsWith('hatch') || inSite(e.x - e.nx, r.floorY, e.z - e.nz)) continue;
        this.ents.push({ ...e, room: r, key: e.opening.kind + ':' + e.x.toFixed(2) + ',' + e.z.toFixed(2) + ',' + r.floorY });
      }
    }
    this.used = new Set();       // accesos o paredes ya ocupados por un tipo de objeto ('wire:…', 'mine:…')
  }

  // ¿Se puede estar de pie ahí? (sin nada sólido y con un nodo de la rejilla cerca)
  standOk(s) {
    if (this.world.worldBoxHasSolid(s.x - 0.3, s.y + 0.02, s.z - 0.3, s.x + 0.3, s.y + 1.8, s.z + 0.3)) return false;
    const n = this.nav.nearest(s.x, s.y, s.z, 0.45, 0.4);
    return !!(n && n.alive && !n.crouch);
  }
  // Punto libre lo más cerca posible del centro de la sala (o null).
  nearCenter(r, skip = 0) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, out = [];
    for (let x = r.x0 + 0.75; x < r.x1 - 0.5; x += 0.5) {
      for (let z = r.z0 + 0.75; z < r.z1 - 0.5; z += 0.5) out.push({ x, y: r.floorY, z, d: Math.hypot(x - cx, z - cz) });
    }
    out.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const s of out) if (this.standOk(s) && n++ >= skip) return { x: s.x, y: s.y, z: s.z };
    return null;
  }
  // Primer punto (de los candidatos) desde el que `id` se puede colocar, o null.
  placeFrom(op, id, cands) {
    for (const c of cands) {
      if (!this.standOk(c.stand)) continue;
      const spot = this.G.placeSpot(probe(op, c.stand, c.face, c.pitch), id);
      if (spot && spot.ok) return c;
    }
    return null;
  }
  // Accesos de un tipo, barajados, sin los ya usados para `tag`; primero los de la sala de `op`.
  entsFor(op, tag, kinds) {
    const p = op.body.pos;
    const list = this.rng.shuffle(this.ents.filter((e) => kinds.includes(e.kind) && !this.used.has(tag + e.key)));
    const inRoom = (e) => p.x > e.room.x0 && p.x < e.room.x1 && p.z > e.room.z0 && p.z < e.room.z1 && Math.abs(p.y - e.room.floorY) < 1.5;
    return list.sort((a, b) => (inRoom(b) ? 1 : 0) - (inRoom(a) ? 1 : 0));
  }
  // Candidatos dentro del sitio, a `dists` m del acceso, mirando hacia él (con desplazamientos laterales).
  facing(e, dists, pitch, lat = [0]) {
    const out = [];
    const tx = -e.nz, tz = e.nx;                // a lo largo del hueco
    for (const d of dists) for (const l of lat) {
      const stand = { x: e.x + e.nx * d + tx * l, y: e.room.floorY, z: e.z + e.nz * d + tz * l };
      out.push({ stand, face: yawTo(e.x + tx * l - stand.x, e.z + tz * l - stand.z), pitch });
    }
    return out;
  }
  task(what, id, c, extra = {}) { return { kind: 'use', what, id, stand: c.stand, face: c.face, pitch: c.pitch, t: 0, walkT: 0, ...extra }; }

  // ------------------------------------------------------------------ gadgets secundarios
  barbed(op, n) {
    // en el pasillo, al otro lado de la puerta: desde el umbral, mirando hacia fuera
    const out = [];
    for (const e of this.entsFor(op, 'wire:', ['door', 'arch'])) {
      if (out.length >= n) break;
      const c = this.placeFrom(op, 'barbed', this.facing(e, [0.45, 0.6], 0).map((c) => ({ ...c, face: yawTo(-e.nx, -e.nz) })));
      if (!c) continue;
      this.used.add('wire:' + e.key);
      out.push(this.task('gadget', 'barbed', c));
    }
    return out;
  }
  shield(op) {
    // dentro del sitio, a unos 3–4 m de un acceso y encarándolo (cobertura para el ancla)
    for (const e of this.entsFor(op, 'shield:', ['door', 'arch'])) {
      const c = this.placeFrom(op, 'shield', this.facing(e, [4.2, 3.6, 4.8, 3.0], 0, [0, 0.8, -0.8]));
      if (!c) continue;
      this.used.add('shield:' + e.key);
      return [this.task('gadget', 'shield', c)];
    }
    return [];
  }
  alarm(op) {
    // en el suelo, junto a la entrada por dentro
    for (const e of this.entsFor(op, 'alarm:', ['door', 'arch', 'window'])) {
      const c = this.placeFrom(op, 'alarm', [...this.facing(e, [2.2, 1.9, 2.5], -1.0), ...this.facing(e, [2.0], -1.15)]);
      if (!c) continue;
      this.used.add('alarm:' + e.key);
      return [this.task('gadget', 'alarm', c)];
    }
    return [];
  }
  bpcam(op) {
    // en la pared de enfrente de un acceso, algo alta: vigila la entrada desde el fondo de la sala
    for (const e of this.entsFor(op, 'cam:', ['door', 'arch'])) {
      const r = e.room;
      const len = e.nx ? (e.nx > 0 ? r.x1 - e.x : e.x - r.x0) : (e.nz > 0 ? r.z1 - e.z : e.z - r.z0);
      if (len < 3) continue;
      const tx = -e.nz, tz = e.nx, cands = [];
      for (const l of [0, 1.0, -1.0, 2.0, -2.0]) {
        const stand = { x: e.x + e.nx * (len - 0.9) + tx * l, y: r.floorY, z: e.z + e.nz * (len - 0.9) + tz * l };
        cands.push({ stand, face: yawTo(e.nx, e.nz), pitch: 0.25 });
      }
      const c = this.placeFrom(op, 'bpcam', cands);
      if (!c) continue;
      this.used.add('cam:' + e.key);
      return [this.task('gadget', 'bpcam', c)];
    }
    return [];
  }

  // ------------------------------------------------------------------ habilidades
  // Paredes que alguien va a reforzar (las suyas primero) y puertas que se van a atrancar.
  _walls(B, defs) {
    const mine = B.fort.filter((t) => t.kind === 'wall');
    const others = [];
    for (const D of defs) if (D !== B) for (const t of D.fort) if (t.kind === 'wall') others.push(t);
    return [...mine, ...this.rng.shuffle(others)];
  }
  battery(op, n, B, defs) {
    // en los muros reforzados (esperando a que se refuercen); si sobran, en las barricadas
    const out = [];
    for (const w of this._walls(B, defs)) {
      if (out.length >= n) break;
      const key = 'bat:' + w.panel.line + ',' + w.panel.u0;
      if (this.used.has(key)) continue;
      this.used.add(key);
      out.push({ kind: 'use', what: 'ability', id: 'battery', stand: w.stand, face: w.face, pitch: -0.25, t: 0, walkT: 0, wait: 8 });
    }
    for (const D of [B, ...defs.filter((D) => D !== B)]) for (const t of D.fort) {
      if (out.length >= n || t.kind !== 'barricade') continue;
      const key = 'bat:o' + t.stand.x.toFixed(2) + ',' + t.stand.z.toFixed(2);
      if (this.used.has(key)) continue;
      this.used.add(key);
      out.push({ kind: 'use', what: 'ability', id: 'battery', stand: t.stand, face: t.face, pitch: t.pitch - 0.2, t: 0, walkT: 0, wait: 8 });
    }
    return out;
  }
  jammer(op, n, B, defs) {
    // en el suelo junto a los muros que se van a reforzar (cortan brechas y drones ahí)
    const out = [];
    const walls = this._walls(B, defs);
    for (const w of walls) {
      if (out.length >= n) break;
      if (out.some((t) => Math.hypot(t.stand.x - w.stand.x, t.stand.z - w.stand.z) < 3)) continue;
      const c = this.placeFrom(op, 'jammer', [{ stand: w.stand, face: w.face, pitch: -1.15 }, { stand: w.stand, face: w.face, pitch: -1.3 }]);
      if (c) out.push(this.task('ability', 'jammer', c));
    }
    // (lo que sobre, en las entradas)
    for (const e of this.entsFor(op, 'jam:', ['door', 'arch'])) {
      if (out.length >= n) break;
      const c = this.placeFrom(op, 'jammer', this.facing(e, [1.8, 2.2], -1.1));
      if (!c) continue;
      this.used.add('jam:' + e.key);
      out.push(this.task('ability', 'jammer', c));
    }
    return out;
  }
  lasermine(op, n) {
    // una por puerta o ventana del sitio, desde dentro, apuntando al marco
    const out = [];
    for (const e of this.entsFor(op, 'mine:', ['door', 'window'])) {
      if (out.length >= n) break;
      const o = e.opening, door = e.kind === 'door';
      const y = door ? o.y0 + 0.35 : (o.y0 + o.y1) / 2;
      const cands = [];
      for (const d of [1.3, 1.0, 1.6]) {
        const stand = { x: e.x + e.nx * d, y: e.room.floorY, z: e.z + e.nz * d };
        cands.push({ stand, face: yawTo(-e.nx, -e.nz), pitch: Math.atan2(y - (stand.y + EYE), d) });
      }
      const c = this.placeFrom(op, 'lasermine', cands);
      if (!c) continue;
      this.used.add('mine:' + e.key);
      out.push(this.task('ability', 'lasermine', c));
    }
    return out;
  }
  // Dónde se pega lo que se lanza desde `stand` con (yaw, pitch): el mismo vuelo que en el
  // juego (gadgets.throwFrom y _move) hasta el primer choque. {pos, axis, t} o null.
  simThrow(stand, yaw, pitch) {
    const w = this.world, cp = Math.cos(pitch);
    const d = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const p = { x: stand.x + d.x * 0.35, y: stand.y + EYE + d.y * 0.35 - 0.05, z: stand.z + d.z * 0.35 };
    const v = { x: d.x * THROW.speed, y: d.y * THROW.speed + THROW.up, z: d.z * THROW.speed };
    if (SOLID[w.getWorld(p.x, p.y, p.z)]) return null;
    const h = 1 / 240;
    for (let t = 0; t < 2; t += h) {
      v.y -= THROW.gravity * h;
      for (const ax of ['x', 'y', 'z']) {
        const q = { x: p.x, y: p.y, z: p.z };
        q[ax] += v[ax] * h;
        if (SOLID[w.getWorld(q.x, q.y, q.z)]) return { pos: p, axis: ax, t };
        p[ax] = q[ax];
      }
    }
    return null;
  }
  stickycam(op, n) {
    // lanzadas por las puertas del sitio: se pegan en una pared de fuera y vigilan por dónde
    // llega el ataque; si ninguna puerta da a una pared cerca, en el fondo del sitio mirando a la entrada
    const out = [];
    const floorOf = (e) => e.room.floorY;
    const good = (e, hit, d0, inside) => {
      if (!hit || hit.axis === 'y') return false;
      const q = hit.pos, fy = floorOf(e);
      if (q.y < fy + 1.2 || q.y > fy + 2.9) return false;
      const dist = Math.hypot(q.x - (e.x + e.nx * d0), q.z - (e.z + e.nz * d0));
      if (dist < (inside ? 2.5 : d0 + 0.8)) return false;
      const inS = this.rooms.some((r) => q.x > r.x0 - 0.2 && q.x < r.x1 + 0.2 && q.z > r.z0 - 0.2 && q.z < r.z1 + 0.2 && Math.abs(fy - r.floorY) < 1);
      return inside ? inS : !inS;
    };
    const tryEnt = (e, inside) => {
      const r = e.room;
      const len = e.nx ? (e.nx > 0 ? r.x1 - e.x : e.x - r.x0) : (e.nz > 0 ? r.z1 - e.z : e.z - r.z0);
      const d0 = inside ? Math.max(1.5, len - 4.5) : 1.4;
      const stand = { x: e.x + e.nx * d0, y: r.floorY, z: e.z + e.nz * d0 };
      if (!this.standOk(stand)) return null;
      const base = inside ? yawTo(e.nx, e.nz) : yawTo(-e.nx, -e.nz);
      let best = null;
      // (que salga igual aunque el bot no esté clavado en el punto: ±15 cm)
      const jig = [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]];
      for (const pitch of [0.05, 0.15, 0.25, -0.05]) {
        for (const dy of [0, 0.12, -0.12, 0.25, -0.25]) {
          const hit = this.simThrow(stand, base + dy, pitch);
          if (!good(e, hit, d0, inside)) continue;
          if (!jig.every(([a, b]) => {
            const h2 = this.simThrow({ x: stand.x + a, y: stand.y, z: stand.z + b }, base + dy, pitch);
            return good(e, h2, d0, inside) && Math.hypot(h2.pos.x - hit.pos.x, h2.pos.y - hit.pos.y, h2.pos.z - hit.pos.z) < 0.6;
          })) continue;
          const score = -Math.abs(hit.t - 0.35) - Math.abs(dy) * 0.5;
          if (!best || score > best.score) best = { yaw: base + dy, pitch, score, hit };
        }
      }
      if (!best) return null;
      return { kind: 'use', what: 'ability', id: 'stickycam', stand, face: best.yaw, pitch: best.pitch, t: 0, walkT: 0, clear: inside ? 1.5 : d0 + 0.6, early: !inside };
    };
    const barred = new Set();
    for (const D of this.sq.brains.values()) for (const t of D.fort) if (t.kind === 'barricade') barred.add(t.opening);
    for (const inside of [false, true]) {
      const ents = this.entsFor(op, 'scam:', ['door', 'arch']).sort((a, b) => (barred.has(a.opening) ? 1 : 0) - (barred.has(b.opening) ? 1 : 0));
      for (const e of ents) {
        if (out.length >= n) break;
        const T = tryEnt(e, inside);
        if (!T) continue;
        this.used.add('scam:' + e.key);
        out.push(T);
      }
    }
    // (las de fuera, de la más cercana a la más lejana, antes de que se atranquen las puertas)
    const p = op.body.pos;
    return out.sort((a, b) => (a.early ? 0 : 1) - (b.early ? 0 : 1) || Math.hypot(a.stand.x - p.x, a.stand.z - p.z) - Math.hypot(b.stand.x - p.x, b.stand.z - p.z));
  }
  interceptor(op, n) {
    // en el suelo, hacia el centro de cada sala del sitio (6 m de alcance)
    const out = [];
    for (const r of this.rooms) {
      if (out.length >= n) break;
      const cands = [];
      for (let k = 0; k < 4; k++) {
        const stand = this.nearCenter(r, k * 3);
        if (stand) for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) cands.push({ stand, face: f, pitch: -1.1 });
      }
      const c = this.placeFrom(op, 'interceptor', cands);
      if (c) out.push(this.task('ability', 'interceptor', c));
    }
    return out;
  }
  plates(op) {
    // la bolsa, cerca del centro de la sala del sitio donde está (los demás pasan a por su placa)
    const p = op.body.pos;
    const r = this.rooms.find((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1 && Math.abs(p.y - r.floorY) < 1.5) || this.rooms[0];
    const stand = this.nearCenter(r);
    return stand ? [{ kind: 'use', what: 'ability', id: 'plates', stand, face: op.yaw, pitch: -0.4, t: 0, walkT: 0, early: true }] : [];
  }
  gas(op, n) {
    // un bote en cada entrada, desde dentro, que ruede hacia el hueco
    const out = [];
    for (const e of this.entsFor(op, 'gas:', ['door', 'arch', 'window'])) {
      if (out.length >= n) break;
      const d = e.kind === 'window' ? 1.8 : 2.8;
      const stand = { x: e.x + e.nx * d, y: e.room.floorY, z: e.z + e.nz * d };
      if (!this.standOk(stand)) continue;
      this.used.add('gas:' + e.key);
      out.push({ kind: 'use', what: 'ability', id: 'gas', stand, face: yawTo(-e.nx, -e.nz), pitch: -1.2, t: 0, walkT: 0 });
    }
    return out;
  }
}

/**
 * Añade a la lista de tareas de fortificación (B.fort) de cada bot defensor la colocación de
 * su gadget secundario y de su habilidad. Las que conviene hacer antes de atrancar las puertas
 * (cámaras adhesivas) o para que los demás las usen (la bolsa de placas) van primero.
 */
export function planDefenseGadgets(sq, defs, rooms) {
  if (sq.diffKey === 'novato' || !sq.match.game.gadgets) return;
  const P = new Planner(sq, rooms);
  for (const B of defs) {
    const op = B.op, g = op.gadget, a = op.ability;
    let tasks = [];
    if (g && g.left > 0) {
      switch (g.id) {
        case 'barbed': tasks.push(...P.barbed(op, g.left)); break;
        case 'shield': tasks.push(...P.shield(op)); break;
        case 'alarm': tasks.push(...P.alarm(op)); break;
        case 'bpcam': tasks.push(...P.bpcam(op)); break;
        default: break;           // (C4 e impacto: en la acción)
      }
    }
    if (a && a.left > 0) {
      switch (a.id) {
        case 'battery': tasks.push(...P.battery(op, a.left, B, defs)); break;
        case 'jammer': tasks.push(...P.jammer(op, a.left, B, defs)); break;
        case 'lasermine': tasks.push(...P.lasermine(op, a.left)); break;
        case 'stickycam': tasks.push(...P.stickycam(op, a.left)); break;
        case 'interceptor': tasks.push(...P.interceptor(op, a.left)); break;
        case 'plates': tasks.push(...P.plates(op)); break;
        case 'gas': tasks.push(...P.gas(op, a.left)); break;
        default: break;           // (estimulantes: en la acción)
      }
    }
    const early = tasks.filter((t) => t.early);
    tasks = tasks.filter((t) => !t.early);
    // las baterías, después de sus refuerzos; lo demás, repartido entre los refuerzos por cercanía
    B.fort = [...early, ...B.fort, ...tasks];
  }
}

/**
 * Estado de la tarea de uso: 'go' (pulsar), 'wait' (aún no) o 'skip' (ya no tiene sentido).
 * Con `aimed` = false (aún de camino) solo mira si le quedan cargas.
 */
export function useCheck(B, T, aimed = true) {
  const op = B.op, G = B.game.gadgets;
  const src = T.what === 'ability' ? 'ability' : 'gadget';
  const slot = src === 'ability' ? op.ability : op.gadget;
  if (!slot || slot.id !== T.id) return 'skip';
  if (T.id === 'plates') return slot.dropped || slot.left <= 0 ? 'skip' : (op.abilityCd || 0) > 0 ? 'wait' : 'go';
  if (slot.left === 0) return 'skip';
  if (!aimed) return 'go';
  if (!G.canUse(op, src)) return op.channel ? 'wait' : (src === 'ability' ? op.abilityCd : op.gadgetCd) > 0 ? 'wait' : 'skip';
  if (T.id === 'stickycam' || T.id === 'gas') {
    if (!T.clear) return 'go';
    const e = op.eyePos(), d = op.viewDir();
    return lineOfSight(G.game.world, e.x, e.y, e.z, e.x + d.x * T.clear, e.y + d.y * T.clear, e.z + d.z * T.clear) ? 'go' : 'skip';
  }
  const spot = G.placeSpot(op, T.id);
  if (spot && spot.ok) return 'go';
  return T.wait && T.t < T.wait ? 'wait' : 'skip';
}

/** CORAZA ha dejado la bolsa de placas: los compañeros bot pasan a coger una (después de lo que estén haciendo). */
export function visitPlateBag(sq, bag) {
  const M = sq.match;
  if (!(M.phase === 'prep' || M.phase === 'action')) return;
  for (const B of sq.brains.values()) {
    if (B.team !== bag.team || B.op === bag.owner || B.op.state !== 'alive' || B.op.plate) continue;
    const T = { kind: 'visit', bag, stand: { x: bag.pos.x, y: bag.pos.y, z: bag.pos.z }, t: 0, walkT: 0 };
    let i = B.fort.length && B.fort[0].started ? 1 : 0;
    while (i < B.fort.length && B.fort[i].early) i++;
    B.fort.splice(i, 0, T);
  }
}

/**
 * En la acción: TIZÓN activa sus botes de gas si sabe de un atacante junto a alguno
 * (lo ve, lo oyó hace poco o lo ha marcado su equipo). Devuelve true si pulsa X.
 */
export function gasTick(B, dt) {
  const op = B.op, a = op.ability, I = op.intent, G = B.game.gadgets;
  if (!a || a.id !== 'gas' || op.state !== 'alive' || B.sq.diffKey === 'novato') return false;
  const ph = B.match.phase;
  if (ph !== 'action' && ph !== 'planted') return false;
  // (con botes en la mano, X lanza otro: se mantiene pulsada para activar los del suelo)
  if (B.gasHoldT > 0) { B.gasHoldT -= dt; I.abilityHeld = true; return true; }
  B.gasCheckT = (B.gasCheckT || 0) - dt;
  if (B.gasCheckT > 0) return false;
  B.gasCheckT = 0.2;
  const cans = G.items.filter((it) => it.alive && it.kind === 'gas' && it.owner === op && it.rest);
  if (!cans.length) return false;
  const now = B.game.time, known = [];
  for (const t of B.per.visible) if (t.state === 'alive') known.push(t.body.pos);
  for (const [t, m] of B.per.memory) if (t.state === 'alive' && now - m.t < 2) known.push(m);
  for (const k of B.board.recent(now, 2)) known.push(k);
  const hot = cans.some((c) => known.some((k) => Math.hypot(k.x - c.pos.x, k.z - c.pos.z) < GAS_TRIGGER && Math.abs(k.y - c.pos.y) < 2));
  if (!hot) return false;
  I.ability = true;
  if (a.left > 0) { B.gasHoldT = 0.7; I.abilityHeld = true; }
  return true;
}

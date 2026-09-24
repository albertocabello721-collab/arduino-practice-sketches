// Geometría táctica para los bots: accesos de una sala (puertas, arcos, ventanas y
// trampillas), puntos para sostener un ángulo sobre un acceso (en diagonal, a
// 3–7 m, pegados a algo que cubra) y puntos de entrada del ataque.
import { lineOfSight } from '../../world/raycast.js';
import { SOLID } from '../../world/materials.js';

const inside = (r, x, z, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;

/** Accesos de una sala: [{kind, x, y, z, nx, nz (hacia dentro), w, opening}] */
export function entrancesOf(map, room) {
  const out = [];
  const all = [...map.doors, ...map.windows, ...(map.builder.arches || [])];
  for (const o of all) {
    if (Math.abs(o.y0 - o.sill - room.floorY) > 0.3) continue;
    let nx = 0, nz = 0, onEdge = false;
    if (o.axis === 'z') {
      if (Math.abs(o.line - room.x0) < 1e-3) { nx = 1; onEdge = true; } else if (Math.abs(o.line - room.x1) < 1e-3) { nx = -1; onEdge = true; }
      if (onEdge && !(o.center > room.z0 && o.center < room.z1)) onEdge = false;
    } else {
      if (Math.abs(o.line - room.z0) < 1e-3) { nz = 1; onEdge = true; } else if (Math.abs(o.line - room.z1) < 1e-3) { nz = -1; onEdge = true; }
      if (onEdge && !(o.center > room.x0 && o.center < room.x1)) onEdge = false;
    }
    if (!onEdge) continue;
    const x = o.axis === 'z' ? o.line : o.center, z = o.axis === 'z' ? o.center : o.line;
    out.push({ kind: o.kind, x, y: room.floorY, z, nx, nz, w: o.width, aimY: room.floorY + Math.min(1.3, (o.y0 - room.floorY) + (o.y1 - o.y0) * 0.5), opening: o });
  }
  for (const h of map.hatches) {
    if (!inside(room, h.x, h.z)) continue;
    if (Math.abs(h.y - room.floorY) < 0.05) out.push({ kind: 'hatchFloor', x: h.x, y: room.floorY, z: h.z, nx: 0, nz: 0, w: 1.25, aimY: room.floorY, hatch: h });
    else if (Math.abs(h.y - (room.ceilY + 0.25)) < 0.05) out.push({ kind: 'hatchCeil', x: h.x, y: room.floorY, z: h.z, nx: 0, nz: 0, w: 1.25, aimY: room.ceilY, hatch: h });
  }
  return out;
}

// ¿Hay algo sólido cerca (a la altura del pecho) que cubra? 0..1
function coverScore(world, x, y, z) {
  let n = 0;
  for (const [dx, dz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
    if (SOLID[world.getWorld(x + dx, y + 1.0, z + dz)]) n++;
  }
  return Math.min(1, n / 3);
}

/**
 * Punto donde sostener un ángulo sobre `ent` dentro de `room`. Devuelve
 * {x, y, z, yaw (hacia el acceso), crouch, ent} o null. `taken`: puntos ya elegidos.
 * Primero puntúa todas las celdas con criterios baratos (distancia, ángulo, cobertura)
 * y solo comprueba la línea de visión de las mejores.
 */
export function holdPointFor(nav, world, room, ent, taken = [], rng = null) {
  const tx = ent.x + ent.nx * 0.3, tz = ent.z + ent.nz * 0.3, ty = ent.aimY;
  const cands = [];
  for (let x = room.x0 + 0.75; x < room.x1 - 0.5; x += 0.5) {
    for (let z = room.z0 + 0.75; z < room.z1 - 0.5; z += 0.5) {
      const n = nav.nearest(x, room.floorY, z, 0.3, 0.3);
      if (!n || !n.alive || n.crouch || n.edges.length < 2) continue;
      const dx = tx - n.px, dz = tz - n.pz;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 || d > 8) continue;
      if (taken.some((p) => Math.hypot(p.x - n.px, p.z - n.pz) < 2.2)) continue;
      // ángulo respecto a la normal del acceso: mejor en diagonal que de frente
      let ang = 0.5;
      if (ent.nx || ent.nz) {
        const c = (-dx * ent.nx + -dz * ent.nz) / (d || 1);
        if (c < 0.15) continue;                 // detrás del plano de la puerta: no se ve
        ang = 1 - Math.abs(c - 0.72);           // ~44° es lo ideal
      }
      const cov = coverScore(world, n.px, n.y, n.pz);
      const score = ang * 2 + cov * 1.5 - Math.abs(d - 4.5) * 0.35 + (rng ? rng.next() * 0.4 : 0);
      cands.push({ n, d, dx, dz, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (let i = 0; i < cands.length && i < 24; i++) {
    const { n, dx, dz } = cands[i];
    const stand = lineOfSight(world, n.px, n.y + 1.62, n.pz, tx, ty, tz);
    if (!stand && !lineOfSight(world, n.px, n.y + 1.06, n.pz, tx, ty, tz)) continue;
    return { x: n.px, y: n.y, z: n.pz, yaw: Math.atan2(-dx, -dz), crouch: !stand, ent };
  }
  return null;
}

/** Salas vecinas a las del sitio (por puertas y arcos), sin repetir. */
export function adjacentRooms(map, rooms) {
  const out = new Map();
  for (const r of rooms) {
    for (const e of entrancesOf(map, r)) {
      if (e.kind !== 'door' && e.kind !== 'arch') continue;
      const q = map.roomAt(e.x - e.nx * 0.8, r.floorY + 0.5, e.z - e.nz * 0.8);
      if (!q || rooms.includes(q)) continue;
      if (!out.has(q.id)) out.set(q.id, { room: q, via: e });
    }
  }
  return [...out.values()];
}

/**
 * Entradas del ataque: puertas exteriores. Para cada una, el punto de delante (a 1,5 m),
 * el de dentro y dos puntos de espera a los lados de la puerta, pegados a la pared
 * (fuera de la línea de tiro de quien vigile la puerta desde dentro). Con `nav`, solo
 * los puntos de espera donde se puede estar de pie.
 */
export function attackEntries(map, nav = null) {
  const out = [];
  for (const o of map.doors) {
    if (!o.out) continue;
    const x = o.axis === 'z' ? o.line + o.out * 1.5 : o.center;
    const z = o.axis === 'z' ? o.center : o.line + o.out * 1.5;
    const floorY = o.y0 - o.sill;
    const off = o.width / 2 + 0.85;
    const stacks = [];
    for (const sgn of [-1, 1]) {
      const p = o.axis === 'z'
        ? { x: o.line + o.out * 0.75, y: floorY, z: o.center + sgn * off }
        : { x: o.center + sgn * off, y: floorY, z: o.line + o.out * 0.75 };
      if (nav) {
        const n = nav.nearest(p.x, floorY, p.z, 0.45, 0.4);
        if (!n || n.crouch) continue;
      }
      stacks.push(p);
    }
    out.push({ x, y: floorY, z, door: o, stacks, inside: { x: o.axis === 'z' ? o.line - o.out * 1.2 : o.center, y: floorY, z: o.axis === 'z' ? o.center : o.line - o.out * 1.2 } });
  }
  return out;
}

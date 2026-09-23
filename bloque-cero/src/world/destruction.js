// Destrucción de vóxeles: balas que atraviesan y agujerean, explosiones,
// cargas de brecha (blanda y dura), golpes cuerpo a cuerpo y cristales.
// Todas las funciones devuelven la lista de vóxeles destruidos
// [{x,y,z,mat}] para que render (escombros), audio e IA reaccionen.
import {
  MAT, MATS, HARD, BULLET_BREAK, BREAK_CHANCE, PEN_COST, BLAST_RES, MELEE, GLASS, SOLID,
} from './materials.js';
import { traverse } from './raycast.js';
import { hash3 } from '../core/rng.js';

/**
 * Traza una bala sin modificar el mundo. Devuelve el "plan":
 *  segments: [{t, x,y,z, mat, face, action, powerAfter}] en orden
 *    action: 'break' (se destruye), 'pierce' (atraviesa sin romper), 'stop', 'glass'
 *  stopT: distancia a la que la bala se detiene (Infinity si sigue)
 *  El llamador comprueba impactos con jugadores antes de stopT y luego
 *  aplica el plan hasta el punto de corte con applyBulletPlan().
 */
export function traceBullet(world, ox, oy, oz, dx, dy, dz, maxDist, power, rng, opts = {}) {
  const segments = [];
  let p = power;
  let stopT = Infinity;
  const extraBreak = opts.extraBreak || 0; // escopetas: prob. de romper vecinos
  const penScale = opts.penScale || 1;     // 1/penetración del arma
  traverse(world, ox, oy, oz, dx, dy, dz, maxDist, (x, y, z, t, face, mat) => {
    if (mat === MAT.AIR || !SOLID[mat] && !GLASS[mat]) {
      return false;
    }
    if (face === -1) return false; // empezamos dentro de algo (p.ej. asomado contra una pared)
    if (GLASS[mat]) {
      segments.push({ t, x, y, z, mat, face, action: 'glass', powerAfter: p });
      return false;
    }
    if (HARD[mat]) {
      segments.push({ t, x, y, z, mat, face, action: 'stop', powerAfter: 0 });
      stopT = t;
      return true;
    }
    const cost = PEN_COST[mat] * penScale;
    if (p <= cost) {
      segments.push({ t, x, y, z, mat, face, action: 'stop', powerAfter: 0 });
      stopT = t;
      return true;
    }
    p -= cost;
    const canBreak = BULLET_BREAK[mat] && rng.next() < BREAK_CHANCE[mat];
    segments.push({ t, x, y, z, mat, face, action: canBreak ? 'break' : 'pierce', powerAfter: p, extra: extraBreak });
    return false;
  });
  return { segments, stopT, finalPower: p };
}

/** Multiplicador de daño (0..1) de la bala al llegar a la distancia t según el plan. */
export function powerAt(plan, t, initial) {
  let p = initial;
  for (const s of plan.segments) {
    if (s.t >= t) break;
    p = s.powerAfter;
  }
  return p;
}

/** Aplica el plan de bala hasta cutT (impacto con jugador o fin). Devuelve vóxeles destruidos. */
export function applyBulletPlan(world, plan, cutT, rng) {
  const destroyed = [];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const kill = (x, y, z, mat) => {
    world.setRaw(x, y, z, MAT.AIR);
    destroyed.push({ x, y, z, mat });
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  };
  for (const s of plan.segments) {
    if (s.t > cutT) break;
    if (s.action === 'glass') {
      for (const v of shatterGlass(world, s.x, s.y, s.z, false)) {
        destroyed.push(v);
        if (v.x < x0) x0 = v.x; if (v.y < y0) y0 = v.y; if (v.z < z0) z0 = v.z;
        if (v.x > x1) x1 = v.x; if (v.y > y1) y1 = v.y; if (v.z > z1) z1 = v.z;
      }
    } else if (s.action === 'break') {
      if (world.get(s.x, s.y, s.z) !== s.mat) continue;
      kill(s.x, s.y, s.z, s.mat);
      // astillado: con escopeta, o al salir de la pared, salta algún vecino en el plano
      if (s.extra > 0) {
        const n = 1 + Math.floor(rng.next() * 3 * s.extra);
        for (let i = 0; i < n; i++) {
          const ax = s.face >> 1; // eje de la normal (0 x, 1 y, 2 z)
          const off = [0, 0, 0];
          const u = (ax + 1) % 3, v = (ax + 2) % 3;
          off[u] = rng.next() < 0.5 ? -1 : 1;
          if (rng.next() < 0.5) off[v] = rng.next() < 0.5 ? -1 : 1;
          const nx = s.x + off[0], ny = s.y + off[1], nz = s.z + off[2];
          const m = world.get(nx, ny, nz);
          if (m && BULLET_BREAK[m] && !HARD[m] && !GLASS[m] && rng.next() < BREAK_CHANCE[m]) kill(nx, ny, nz, m);
        }
      }
    }
  }
  if (destroyed.length) world.notify(x0, y0, z0, x1, y1, z1);
  return destroyed;
}

/** Rompe todo el panel de cristal conectado (máx. 600 vóxeles). */
export function shatterGlass(world, sx, sy, sz, notify = true) {
  const out = [];
  const start = world.get(sx, sy, sz);
  if (!GLASS[start]) return out;
  const stack = [[sx, sy, sz]];
  const seen = new Set();
  const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  let x0 = sx, y0 = sy, z0 = sz, x1 = sx, y1 = sy, z1 = sz;
  while (stack.length && out.length < 600) {
    const [x, y, z] = stack.pop();
    const k = key(x, y, z);
    if (seen.has(k)) continue;
    seen.add(k);
    const m = world.get(x, y, z);
    if (!GLASS[m]) continue;
    world.setRaw(x, y, z, MAT.AIR);
    out.push({ x, y, z, mat: m });
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
  }
  if (notify && out.length) world.notify(x0, y0, z0, x1, y1, z1);
  return out;
}

/**
 * Explosión esférica. `strength` 0..1 decide qué rompe (blastRes 0 siempre;
 * con hardBreach también rompe blastRes 1). Borde irregular con ruido.
 */
export function explodeSphere(world, wx, wy, wz, radius, opts = {}) {
  const { hardBreach = false, jag = 0.35 } = opts;
  const cx = (wx - world.ox) * 8, cy = (wy - world.oy) * 8, cz = (wz - world.oz) * 8;
  const r = radius * 8;
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  const z0 = Math.floor(cz - r), z1 = Math.ceil(cz + r);
  const out = [];
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const m = world.get(x, y, z);
        if (m === MAT.AIR) continue;
        const res = BLAST_RES[m];
        if (res >= 2 || (res === 1 && !hardBreach)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) / r;
        const n = hash3(x, y, z);
        if (d > 1 - jag * n) continue;
        world.setRaw(x, y, z, MAT.AIR);
        out.push({ x, y, z, mat: m });
      }
  if (out.length) world.notify(x0, y0, z0, x1, y1, z1);
  return out;
}

/**
 * Brecha rectangular en una pared: abre un hueco de w×h metros centrado en
 * (wx,wy,wz) atravesando `depth` metros en la dirección de la normal (hacia dentro).
 * axis: 0 si la pared es perpendicular a X, 2 si a Z, 1 para suelos/techos.
 */
export function breachRect(world, wx, wy, wz, axis, w, h, depth, opts = {}) {
  const { hardBreach = false, jag = 0.18, cleanBottom = axis !== 1 } = opts;
  const out = [];
  const half = [0, 0, 0];
  if (axis === 0) { half[0] = depth / 2; half[1] = h / 2; half[2] = w / 2; }
  else if (axis === 2) { half[0] = w / 2; half[1] = h / 2; half[2] = depth / 2; }
  else { half[0] = w / 2; half[1] = depth / 2; half[2] = h / 2; }
  const x0 = world.vx(wx - half[0]), x1 = world.vx(wx + half[0] - 1e-4);
  const y0 = world.vy(wy - half[1]), y1 = world.vy(wy + half[1] - 1e-4);
  const z0 = world.vz(wz - half[2]), z1 = world.vz(wz + half[2] - 1e-4);
  // borde dentado: los vóxeles del perímetro (1-2 de ancho) caen con probabilidad
  const edgeW = 2;
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const m = world.get(x, y, z);
        if (m === MAT.AIR) continue;
        const res = BLAST_RES[m];
        if (res >= 2 || (res === 1 && !hardBreach)) continue;
        // distancia al borde en el plano de la pared
        let du, dv;
        // con cleanBottom el borde inferior queda a ras (se puede cruzar andando)
        const dyb = cleanBottom ? 99 : y - y0;
        if (axis === 0) { du = Math.min(z - z0, z1 - z); dv = Math.min(dyb, y1 - y); }
        else if (axis === 2) { du = Math.min(x - x0, x1 - x); dv = Math.min(dyb, y1 - y); }
        else { du = Math.min(x - x0, x1 - x); dv = Math.min(z - z0, z1 - z); }
        const e = Math.min(du, dv);
        if (e < edgeW && hash3(x, y, z) < jag * (edgeW - e)) continue;
        world.setRaw(x, y, z, MAT.AIR);
        out.push({ x, y, z, mat: m });
      }
  if (out.length) world.notify(x0, y0, z0, x1, y1, z1);
  return out;
}

/** Golpe cuerpo a cuerpo: rompe un parche de material blando delante del golpe. */
export function meleeBreak(world, wx, wy, wz, radius) {
  const cx = (wx - world.ox) * 8, cy = (wy - world.oy) * 8, cz = (wz - world.oz) * 8;
  const r = radius * 8;
  const out = [];
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  const z0 = Math.floor(cz - r), z1 = Math.ceil(cz + r);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const m = world.get(x, y, z);
        if (!m || !MELEE[m] || HARD[m]) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) / r;
        if (d > 1 - 0.3 * hash3(x, y, z)) continue;
        world.setRaw(x, y, z, MAT.AIR);
        out.push({ x, y, z, mat: m });
      }
  if (out.length) world.notify(x0, y0, z0, x1, y1, z1);
  return out;
}

/**
 * Elimina "islas" flotantes de material blando cerca de una destrucción: vóxeles
 * blandos que ya no tocan nada duro ni el suelo. Búsqueda acotada.
 */
export function dropFloating(world, seedVoxels, maxVisit = 3000) {
  const out = [];
  const visitedGlobal = new Set();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const seeds = [];
  for (const v of seedVoxels) for (const [dx, dy, dz] of neighbors) seeds.push([v.x + dx, v.y + dy, v.z + dz]);
  for (const [sx, sy, sz] of seeds) {
    const sm = world.get(sx, sy, sz);
    if (!sm || HARD[sm] || !SOLID[sm]) continue;
    const k0 = key(sx, sy, sz);
    if (visitedGlobal.has(k0)) continue;
    // BFS: si encontramos un ancla (duro o suelo) la isla está soportada
    const comp = [];
    const seen = new Set([k0]);
    const q = [[sx, sy, sz]];
    let anchored = false;
    while (q.length) {
      const [x, y, z] = q.pop();
      comp.push([x, y, z]);
      if (comp.length > maxVisit) { anchored = true; break; }
      for (const [dx, dy, dz] of neighbors) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const m = world.get(nx, ny, nz);
        if (!m || !SOLID[m]) continue;
        if (HARD[m] || m === MAT.GROUND) { anchored = true; break; }
        const k = key(nx, ny, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([nx, ny, nz]);
      }
      if (anchored) break;
    }
    for (const k of seen) visitedGlobal.add(k);
    if (!anchored) {
      for (const [x, y, z] of comp) {
        const m = world.get(x, y, z);
        if (!m) continue;
        world.setRaw(x, y, z, MAT.AIR);
        out.push({ x, y, z, mat: m });
      }
    }
  }
  if (out.length) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of out) {
      if (v.x < x0) x0 = v.x; if (v.y < y0) y0 = v.y; if (v.z < z0) z0 = v.z;
      if (v.x > x1) x1 = v.x; if (v.y > y1) y1 = v.y; if (v.z > z1) z1 = v.z;
    }
    world.notify(x0, y0, z0, x1, y1, z1);
  }
  return out;
}

export function materialName(id) { return MATS[id] ? MATS[id].name : ''; }

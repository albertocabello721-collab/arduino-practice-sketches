// Lanzamientos de la IA: el mismo vuelo que en el juego (gadgets.throwFrom y _move) hasta
// el primer choque, y la puntería (yaw, pitch) para que lo lanzado caiga cerca de un punto.
import { THROW } from '../gadgets.js';
import { SOLID } from '../../world/materials.js';

/**
 * Vuelo de lo que se lanza desde los ojos `eye` con (yaw, pitch), quieto, hasta el primer
 * choque con un vóxel. Devuelve {pos, axis ('x'|'y'|'z'), t} o null (sale de un sólido, no
 * choca en `maxT` s o se aleja en horizontal más de `maxDist` m: ya no vuelve).
 */
export function simThrow(world, eye, yaw, pitch, { maxT = 2, h = 1 / 240, maxDist = Infinity } = {}) {
  const cp = Math.cos(pitch);
  const d = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const p = { x: eye.x + d.x * 0.35, y: eye.y + d.y * 0.35 - 0.05, z: eye.z + d.z * 0.35 };
  const v = { x: d.x * THROW.speed, y: d.y * THROW.speed + THROW.up, z: d.z * THROW.speed };
  if (SOLID[world.getWorld(p.x, p.y, p.z)]) return null;
  const md2 = maxDist * maxDist;
  for (let t = 0; t < maxT; t += h) {
    v.y -= THROW.gravity * h;
    for (const ax of ['x', 'y', 'z']) {
      const q = { x: p.x, y: p.y, z: p.z };
      q[ax] += v[ax] * h;
      if (SOLID[world.getWorld(q.x, q.y, q.z)]) return { pos: p, axis: ax, t };
      p[ax] = q[ax];
    }
    const hx = p.x - eye.x, hz = p.z - eye.z;
    if (hx * hx + hz * hz > md2) return null;
  }
  return null;
}

/**
 * Puntería para que lo lanzado desde `eye` toque primero cerca de `target`: prueba ángulos de
 * elevación (de tiro tenso a bombeado; primero de 0,1 en 0,1 rad y luego afina) mirando hacia el
 * punto. Devuelve {yaw, pitch, err, hit} con el menor error, o null si ninguno baja de `maxErr`
 * m. Con `lob`, el más bombeado de los que valen (cae con menos velocidad y rueda menos: PEM,
 * fragmentación); `maxT` limita el vuelo.
 */
export function aimThrow(world, eye, target, { maxErr = 1.2, lob = false, maxT = 2 } = {}) {
  const yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  const maxDist = Math.hypot(target.x - eye.x, target.z - eye.z) + maxErr + 1;
  const tryPitch = (pitch) => {
    const hit = simThrow(world, eye, yaw, pitch, { h: 1 / 100, maxT, maxDist });
    if (!hit) return null;
    const q = hit.pos;
    return { yaw, pitch, err: Math.hypot(q.x - target.x, (q.y - target.y) * 0.7, q.z - target.z), hit };
  };
  let best = null, high = null;
  const consider = (r) => {
    if (!r) return;
    if (!best || r.err < best.err) best = r;
    if (lob && r.err <= maxErr * 0.6 && (!high || r.pitch > high.pitch)) high = r;
  };
  for (let pitch = -0.7; pitch <= 1.0 + 1e-6; pitch += 0.1) {
    consider(tryPitch(pitch));
    if (!lob && best && best.err < 0.25) break;
  }
  // afinar alrededor del mejor (y del más bombeado que vale)
  for (const base of [best, high]) {
    if (!base) continue;
    for (const dp of [-0.05, 0.05, -0.025, 0.025]) consider(tryPitch(base.pitch + dp));
  }
  if (high) return high;
  return best && best.err <= maxErr ? best : null;
}

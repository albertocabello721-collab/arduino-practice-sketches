// Recorrido de vóxeles por rayo (Amanatides & Woo, "A Fast Voxel Traversal").
// Se usa para balas, línea de visión de los bots, interacción y sonido.
import { SOLID, BLOCKS_SIGHT } from './materials.js';
import { INV_VS } from './voxelworld.js';

// Índices de cara: normal de la superficie por la que entra el rayo.
export const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * Llama a visit(x, y, z, tEnter, face, mat) por cada vóxel atravesado, en orden.
 * `d` debe estar normalizado; t y maxDist en metros. visit devuelve true para parar.
 * face = -1 para el vóxel que contiene el origen.
 */
export function traverse(world, ox, oy, oz, dx, dy, dz, maxDist, visit) {
  const px = (ox - world.ox) * INV_VS, py = (oy - world.oy) * INV_VS, pz = (oz - world.oz) * INV_VS;
  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - px) * tdx : sx < 0 ? (px - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - py) * tdy : sy < 0 ? (py - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - pz) * tdz : sz < 0 ? (pz - z) * tdz : Infinity;
  const maxT = maxDist * INV_VS;
  const nx = world.nx, ny = world.ny, nz = world.nz;
  if (visit(x, y, z, 0, -1, world.get(x, y, z))) return;
  let t = 0, face = -1;
  for (let guard = 0; guard < 4096; guard++) {
    if (tmx < tmy) {
      if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = sx > 0 ? 1 : 0; }
      else { z += sz; t = tmz; tmz += tdz; face = sz > 0 ? 5 : 4; }
    } else {
      if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = sy > 0 ? 3 : 2; }
      else { z += sz; t = tmz; tmz += tdz; face = sz > 0 ? 5 : 4; }
    }
    if (t > maxT) return;
    // fuera del mundo y alejándose: nada más que ver (salvo el terreno implícito debajo)
    if ((x < 0 && sx <= 0) || (x >= nx && sx >= 0) || (z < 0 && sz <= 0) || (z >= nz && sz >= 0) || (y >= ny && sy >= 0)) {
      if (y >= world.groundVY) return;
    }
    if (visit(x, y, z, t / INV_VS, face, world.get(x, y, z))) return;
  }
}

/** Primer vóxel para el que table[mat] es 1. Devuelve {x,y,z,t,face,mat} o null. */
export function raycastFirst(world, ox, oy, oz, dx, dy, dz, maxDist, table = SOLID, skipOrigin = false) {
  let hit = null;
  traverse(world, ox, oy, oz, dx, dy, dz, maxDist, (x, y, z, t, face, mat) => {
    if (skipOrigin && face === -1) return false;
    if (table[mat]) { hit = { x, y, z, t, face, mat }; return true; }
    return false;
  });
  return hit;
}

/** ¿Hay línea de visión entre dos puntos? (los agujeros y el cristal dejan ver) */
export function lineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const inv = 1 / len;
  let clear = true;
  traverse(world, ax, ay, az, dx * inv, dy * inv, dz * inv, len, (x, y, z, t, face, mat) => {
    if (BLOCKS_SIGHT[mat]) { clear = false; return true; }
    return false;
  });
  return clear;
}

/** Fracción de visibilidad de una caja (muestra varios puntos): 0 oculto, 1 totalmente visible. */
export function visibilityFraction(world, eye, points) {
  let vis = 0;
  for (const p of points) if (lineOfSight(world, eye.x, eye.y, eye.z, p.x, p.y, p.z)) vis++;
  return points.length ? vis / points.length : 0;
}

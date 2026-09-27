// Por dónde se oye un sonido (Fase 9). La oclusión ya no es «se ve o no se ve»: depende de lo que
// cruza la línea recta entre la fuente y quien escucha (cada pared tapa 0,35 y cada suelo o techo
// 0,6, hasta 1). Si está tapado, el sonido puede llegar rodeando: se prueban 8 puntos a 1,5 m de
// la fuente; si alguno recibe el sonido y ve al que escucha (una puerta abierta, un agujero en la
// pared), llega desde allí, con 0,35. Sin Three.js ni Web Audio: lo prueban los tests en Node.
import { traverse } from '../world/raycast.js';
import { SOLID } from '../world/materials.js';

export const HEAR = {
  wall: 0.35,         // cada pared que cruza la línea
  floor: 0.6,         // cada suelo o techo
  detour: 0.35,       // lo que tapa el rodeo (por una puerta, un agujero)
  ring: 1.5,          // m: a qué distancia de la fuente se busca el rodeo
  lift: 0.25,         // m: el anillo va algo más alto que la fuente (los pasos suenan en el suelo)
  points: 8,          // puntos del anillo
  far: 60,            // m: más lejos no se calcula (se oye poco y tapado del todo)
};

/**
 * Cuánto tapa lo que hay en línea recta entre `a` y `b` (0 libre … 1). Cuenta cada tramo sólido
 * que la línea atraviesa entero (entrar por arriba o por abajo es un suelo o un techo); si un
 * extremo está en lo sólido (un impacto en la pared), ese tramo no cuenta. Con `stop`, deja de
 * contar al llegar a ese valor (para saber solo si pasa).
 */
export function blockage(world, a, b, stop = 1) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return 0;
  if (len > HEAR.far) return 1;
  let occl = 0, inside = false, pending = 0, skip = false;
  traverse(world, a.x, a.y, a.z, dx / len, dy / len, dz / len, len, (x, y, z, t, face, mat) => {
    const solid = SOLID[mat] === 1;
    if (face === -1) { inside = skip = solid; return false; }
    if (solid && !inside) pending = face === 2 || face === 3 ? HEAR.floor : HEAR.wall;
    else if (!solid && inside) {
      if (!skip) occl += pending;
      skip = false; pending = 0;
      if (occl >= stop) return true;
    }
    inside = solid;
    return false;
  });
  return Math.min(occl, 1);
}

const _c = { x: 0, y: 0, z: 0 };
/**
 * Por dónde se oye `src` desde `ear`: {x, y, z, occl} (la posición de la que llega y cuánto tapa).
 * Con `detour` false solo se mira la línea recta (más barato).
 */
export function hear(world, ear, src, out = {}, detour = true) {
  const direct = blockage(world, ear, src);
  out.x = src.x; out.y = src.y; out.z = src.z; out.occl = direct;
  out.detoured = false; out.tried = false;
  // (aunque tape lo mismo que una pared, por una puerta abierta el sonido viene de la puerta)
  if (!detour || direct === 0) return out;
  out.tried = true;
  let best = Infinity;
  for (let k = 0; k < HEAR.points; k++) {
    const a = (k / HEAR.points) * Math.PI * 2;
    _c.x = src.x + Math.cos(a) * HEAR.ring; _c.y = src.y + HEAR.lift; _c.z = src.z + Math.sin(a) * HEAR.ring;
    if (SOLID[world.getWorld(_c.x, _c.y, _c.z)] === 1) continue;
    // el sonido llega a ese punto y desde él se ve al que escucha
    if (blockage(world, src, _c, 1e-6) > 0 || blockage(world, _c, ear, 1e-6) > 0) continue;
    const d = Math.hypot(_c.x - src.x, _c.y - src.y, _c.z - src.z) + Math.hypot(ear.x - _c.x, ear.y - _c.y, ear.z - _c.z);
    if (d < best) { best = d; out.x = _c.x; out.y = _c.y; out.z = _c.z; out.occl = Math.min(direct, HEAR.detour); out.detoured = true; }
  }
  return out;
}

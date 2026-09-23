// Física de personaje contra el mundo de vóxeles: caja AABB con barrido por ejes,
// subida automática de escalones (hasta 3 vóxeles = 0,375 m), pegado al bajar
// escaleras, trepar escaleras de mano y comprobaciones de hueco libre.
import { SOLID, CLIMB } from '../world/materials.js';
import { VS } from '../world/voxelworld.js';

const EPS = 1e-4;
const GAP = 1e-3;

export const STANCES = {
  stand: { height: 1.8, eye: 1.64 },
  crouch: { height: 1.25, eye: 1.08 },
  prone: { height: 0.55, eye: 0.34 },
};

export class Body {
  constructor(x = 0, y = 0, z = 0) {
    this.pos = { x, y, z };        // centro de los pies
    this.vel = { x: 0, y: 0, z: 0 };
    this.radius = 0.3;
    this.height = 1.8;
    this.onGround = false;
    this.onLadder = false;
    this.lastStep = 0;             // altura subida en el último paso (para suavizar la cámara)
  }
}

function columnRangeSolid(world, vx, vy0, vy1, vz0, vz1) {
  for (let y = vy0; y <= vy1; y++) for (let z = vz0; z <= vz1; z++) if (SOLID[world.get(vx, y, z)]) return true;
  return false;
}
function rowRangeSolidZ(world, vz, vy0, vy1, vx0, vx1) {
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) if (SOLID[world.get(x, y, vz)]) return true;
  return false;
}
function layerSolid(world, vy, vx0, vx1, vz0, vz1) {
  for (let z = vz0; z <= vz1; z++) for (let x = vx0; x <= vx1; x++) if (SOLID[world.get(x, vy, z)]) return true;
  return false;
}

export function boxFree(world, x, y, z, r, h) {
  return !world.worldBoxHasSolid(x - r, y, z - r, x + r, y + h, z + r);
}

// Barrido en un eje; devuelve true si choca.
function sweep(world, b, axis, d) {
  if (d === 0) return false;
  const r = b.radius, p = b.pos;
  const vy0 = world.vy(p.y + EPS), vy1 = world.vy(p.y + b.height - EPS);
  if (axis === 0) {
    const vz0 = world.vz(p.z - r + EPS), vz1 = world.vz(p.z + r - EPS);
    if (d > 0) {
      const edge = p.x + r, s = world.vx(edge - EPS) + 1, e = world.vx(edge + d - EPS);
      for (let vx = s; vx <= e; vx++) if (columnRangeSolid(world, vx, vy0, vy1, vz0, vz1)) { p.x = Math.max(p.x, world.wx(vx) - r - GAP); return true; }
    } else {
      const edge = p.x - r, s = world.vx(edge + EPS) - 1, e = world.vx(edge + d + EPS);
      for (let vx = s; vx >= e; vx--) if (columnRangeSolid(world, vx, vy0, vy1, vz0, vz1)) { p.x = Math.min(p.x, world.wx(vx + 1) + r + GAP); return true; }
    }
    p.x += d;
    return false;
  }
  if (axis === 2) {
    const vx0 = world.vx(p.x - r + EPS), vx1 = world.vx(p.x + r - EPS);
    if (d > 0) {
      const edge = p.z + r, s = world.vz(edge - EPS) + 1, e = world.vz(edge + d - EPS);
      for (let vz = s; vz <= e; vz++) if (rowRangeSolidZ(world, vz, vy0, vy1, vx0, vx1)) { p.z = Math.max(p.z, world.wz(vz) - r - GAP); return true; }
    } else {
      const edge = p.z - r, s = world.vz(edge + EPS) - 1, e = world.vz(edge + d + EPS);
      for (let vz = s; vz >= e; vz--) if (rowRangeSolidZ(world, vz, vy0, vy1, vx0, vx1)) { p.z = Math.min(p.z, world.wz(vz + 1) + r + GAP); return true; }
    }
    p.z += d;
    return false;
  }
  // eje Y
  const vx0 = world.vx(p.x - r + EPS), vx1 = world.vx(p.x + r - EPS);
  const vz0 = world.vz(p.z - r + EPS), vz1 = world.vz(p.z + r - EPS);
  if (d > 0) {
    const edge = p.y + b.height, s = world.vy(edge - EPS) + 1, e = world.vy(edge + d - EPS);
    for (let vy = s; vy <= e; vy++) if (layerSolid(world, vy, vx0, vx1, vz0, vz1)) { p.y = Math.max(p.y, world.wy(vy) - b.height - GAP); return true; }
  } else {
    const edge = p.y, s = world.vy(edge + EPS) - 1, e = world.vy(edge + d + EPS);
    for (let vy = s; vy >= e; vy--) if (layerSolid(world, vy, vx0, vx1, vz0, vz1)) { p.y = Math.min(p.y, world.wy(vy + 1) + GAP); return true; }
  }
  p.y += d;
  return false;
}

// Movimiento horizontal con subida de escalón.
function moveHorizontal(world, b, axis, d, canStep) {
  if (d === 0) return false;
  const start = axis === 0 ? b.pos.x : b.pos.z;
  const y0 = b.pos.y;
  const hit = sweep(world, b, axis, d);
  if (!hit || !canStep) return hit;
  const moved = (axis === 0 ? b.pos.x : b.pos.z) - start;
  const remaining = d - moved;
  for (let h = 1; h <= 3; h++) {
    const up = h * VS;
    // el cuerpo levantado debe caber aquí mismo
    if (!boxFree(world, b.pos.x, y0 + up + GAP, b.pos.z, b.radius, b.height)) break;
    const save = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    b.pos.y = y0 + up + GAP;
    const hit2 = sweep(world, b, axis, remaining);
    const moved2 = (axis === 0 ? b.pos.x : b.pos.z) - (axis === 0 ? save.x : save.z);
    if (Math.abs(moved2) > Math.abs(remaining) * 0.5 || !hit2) {
      // asentar sobre el escalón
      sweep(world, b, 1, -up - GAP * 2);
      b.lastStep = b.pos.y - y0;
      return hit2;
    }
    b.pos.x = save.x; b.pos.y = save.y; b.pos.z = save.z;
  }
  return hit;
}

export function isOnLadder(world, b) {
  const r = b.radius + 0.08, p = b.pos;
  const x0 = world.vx(p.x - r), x1 = world.vx(p.x + r), z0 = world.vz(p.z - r), z1 = world.vz(p.z + r);
  const y0 = world.vy(p.y + 0.1), y1 = world.vy(p.y + Math.min(b.height, 1.2));
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (CLIMB[world.get(x, y, z)]) return true;
  return false;
}

/**
 * Integra el cuerpo un paso. `gravity` en m/s². Devuelve {hitX, hitZ, landed, impactSpeed}.
 */
export function stepBody(world, b, dt, opts = {}) {
  const { gravity = 22, bounds = null, climbInput = 0 } = opts;
  const wasOnGround = b.onGround;
  b.lastStep = 0;
  b.onLadder = isOnLadder(world, b);
  if (b.onLadder && (climbInput !== 0 || !b.onGround)) {
    b.vel.y = climbInput * 2.6;
  } else {
    b.vel.y -= gravity * dt;
    if (b.vel.y < -40) b.vel.y = -40;
  }
  const res = { hitX: false, hitZ: false, landed: false, impactSpeed: 0 };
  const canStep = wasOnGround || b.onLadder;
  // sub-pasos para no atravesar nada a gran velocidad
  const dx = b.vel.x * dt, dz = b.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25));
  for (let i = 0; i < steps; i++) {
    if (moveHorizontal(world, b, 0, dx / steps, canStep)) { res.hitX = true; }
    if (moveHorizontal(world, b, 2, dz / steps, canStep)) { res.hitZ = true; }
  }
  if (res.hitX) b.vel.x = 0;
  if (res.hitZ) b.vel.z = 0;
  const vy = b.vel.y;
  const hitY = sweep(world, b, 1, vy * dt);
  b.onGround = false;
  if (hitY) {
    if (vy < 0) { b.onGround = true; res.landed = !wasOnGround; res.impactSpeed = -vy; }
    b.vel.y = 0;
  }
  // pegarse al suelo al bajar escaleras/rampas
  if (!b.onGround && wasOnGround && vy <= 0 && !b.onLadder) {
    const save = b.pos.y;
    if (sweep(world, b, 1, -0.4)) { b.onGround = true; b.vel.y = 0; }
    else b.pos.y = save;
  }
  if (!b.onGround) {
    // ¿apoyado exactamente sobre algo?
    if (!boxFree(world, b.pos.x, b.pos.y - 0.02, b.pos.z, b.radius - 0.01, 0.02)) { b.onGround = true; if (b.vel.y < 0) b.vel.y = 0; }
  }
  if (bounds) {
    b.pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, b.pos.x));
    b.pos.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, b.pos.z));
    if (b.pos.y < bounds.minY) { b.pos.y = bounds.minY; b.vel.y = 0; b.onGround = true; }
  }
  return res;
}

/** Intenta cambiar la altura del cuerpo (postura). Devuelve false si no cabe. */
export function tryResize(world, b, newHeight) {
  if (newHeight <= b.height) { b.height = newHeight; return true; }
  if (boxFree(world, b.pos.x, b.pos.y + GAP, b.pos.z, b.radius - 0.01, newHeight - GAP)) { b.height = newHeight; return true; }
  return false;
}

/**
 * Busca un obstáculo saltable delante (mesa, alféizar, barandilla baja).
 * Si el obstáculo es estrecho (un muro bajo, el alféizar de una ventana) el salto
 * lo cruza entero y aterriza al otro lado; si es profundo, se sube encima.
 * Devuelve {x, y, z, top} (punto final del salto; luego actúa la gravedad) o null.
 */
export function findVault(world, b, dirX, dirZ) {
  const p = b.pos;
  const obstacleTop = (cx, cz) => {
    for (let h = 1.35; h >= 0.28; h -= VS) {
      if (world.solidAtWorld(cx, p.y + h, cz)) return Math.floor((p.y + h - world.oy) * 8 + 1) / 8 + world.oy;
    }
    return -1;
  };
  let d0 = -1, top = -1;
  for (let d = b.radius + 0.05; d <= b.radius + 0.6; d += 0.0625) {
    const t = obstacleTop(p.x + dirX * d, p.z + dirZ * d);
    if (t > 0) { d0 = d; top = t; break; }
  }
  if (d0 < 0 || top - p.y < 0.3 || top - p.y > 1.4) return null;
  // hueco para pasar agachado sobre el obstáculo, desde donde estamos
  if (!boxFree(world, p.x, top + 0.02, p.z, 0.26, 1.15)) return null;
  // buscar dónde acaba el obstáculo
  let top2 = top;
  for (let d = d0; d <= d0 + 1.25; d += 0.0625) {
    const cx = p.x + dirX * d, cz = p.z + dirZ * d;
    const t = obstacleTop(cx, cz);
    if (t > top2) top2 = t;
    if (top2 - p.y > 1.45) return null;
    if (!boxFree(world, cx, top2 + 0.02, cz, 0.26, 1.15)) return null; // techo del hueco
    if (t < 0) {
      // fin del obstáculo: aterrizar un poco más allá (luego cae por gravedad)
      const lx = cx + dirX * 0.32, lz = cz + dirZ * 0.32;
      if (boxFree(world, lx, top2 + 0.02, lz, 0.28, 1.15)) return { x: lx, y: top2 + 0.02, z: lz, top: top2 };
      return null;
    }
  }
  // obstáculo profundo: subirse encima
  const lx = p.x + dirX * (d0 + 0.4), lz = p.z + dirZ * (d0 + 0.4);
  if (boxFree(world, lx, top2 + 0.02, lz, 0.28, 1.2)) return { x: lx, y: top2 + 0.02, z: lz, top: top2 };
  return null;
}

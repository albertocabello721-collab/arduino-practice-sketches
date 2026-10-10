// Car (an oriented box on the ground plane) against static walls. Walls are 2D
// line segments; height is ignored, so a wall can't be jumped.

const WALL_RADIUS = 0.25; // walls act this thick on each side of their line
const RESTITUTION = 0.2; // bounce
const WALL_FRICTION = 0.35; // scrub along the wall while scraping it

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Turn a polyline [[x, z], ...] into wall segments.
export function makeWalls(points, closed = false) {
  const walls = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    walls.push({ ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len, len });
  }
  return walls;
}

// Pushes the car out of any wall it overlaps and bounces/scrubs its velocity.
// Returns the biggest hit, as m/s of speed taken out by the wall.
export function collideWalls(car, walls) {
  let strongest = 0;
  for (let i = 0; i < walls.length; i++) {
    const hit = collideWall(car, walls[i]);
    if (hit > strongest) strongest = hit;
  }
  return strongest;
}

function collideWall(car, w) {
  const cx = car.x;
  const cz = car.z;

  // cheap reject: is the car within reach of the segment at all?
  const reach = Math.hypot(car.halfLength, car.halfWidth) + WALL_RADIUS;
  const t = clamp((cx - w.ax) * w.ux + (cz - w.az) * w.uz, 0, w.len);
  const dx = cx - (w.ax + w.ux * t);
  const dz = cz - (w.az + w.uz * t);
  if (dx * dx + dz * dz > reach * reach) return 0;

  // wall normal, pointing to the side the car is on
  let nx = -w.uz;
  let nz = w.ux;
  if ((cx - w.ax) * nx + (cz - w.az) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const lx = fz;
  const lz = -fx;
  let deepest = 0;
  let hitX = 0;
  let hitZ = 0;
  let hitNx = nx;
  let hitNz = nz;

  // car corners past the wall line
  for (let i = 0; i < 4; i++) {
    const sf = i < 2 ? 1 : -1;
    const sl = i % 2 === 0 ? 1 : -1;
    const qx = cx + fx * car.halfLength * sf + lx * car.halfWidth * sl;
    const qz = cz + fz * car.halfLength * sf + lz * car.halfWidth * sl;
    const along = (qx - w.ax) * w.ux + (qz - w.az) * w.uz;
    if (along < 0 || along > w.len) continue;
    const pen = WALL_RADIUS - ((qx - w.ax) * nx + (qz - w.az) * nz);
    if (pen > deepest) {
      deepest = pen;
      hitX = qx;
      hitZ = qz;
      hitNx = nx;
      hitNz = nz;
    }
  }

  // wall end points poking into the car's side (corners of the wall line)
  for (let e = 0; e < 2; e++) {
    const ex = e === 0 ? w.ax : w.bx;
    const ez = e === 0 ? w.az : w.bz;
    const u = (ex - cx) * fx + (ez - cz) * fz;
    const v = (ex - cx) * lx + (ez - cz) * lz;
    const penU = car.halfLength + WALL_RADIUS - Math.abs(u);
    const penV = car.halfWidth + WALL_RADIUS - Math.abs(v);
    if (penU <= 0 || penV <= 0) continue;
    const pen = Math.min(penU, penV);
    if (pen > deepest) {
      deepest = pen;
      hitX = ex;
      hitZ = ez;
      if (penU < penV) {
        hitNx = u > 0 ? -fx : fx;
        hitNz = u > 0 ? -fz : fz;
      } else {
        hitNx = v > 0 ? -lx : lx;
        hitNz = v > 0 ? -lz : lz;
      }
    }
  }

  if (deepest <= 0) return 0;
  return resolveContact(car, hitNx, hitNz, deepest, hitX - cx, hitZ - cz);
}

// (rx, rz) = contact point relative to the car's center of mass.
function resolveContact(car, nx, nz, pen, rx, rz) {
  car.x += nx * pen;
  car.z += nz * pen;

  // velocity of the contact point (linear + spin): v + w x r
  const vcx = car.vx + car.yawRate * rz;
  const vcz = car.vz - car.yawRate * rx;
  const vn = vcx * nx + vcz * nz;
  if (vn >= 0) return 0;

  const invM = 1 / car.mass;
  const invI = 1 / car.inertia;
  const rn = rz * nx - rx * nz;
  const jn = (-(1 + RESTITUTION) * vn) / (invM + rn * rn * invI);
  car.vx += jn * nx * invM;
  car.vz += jn * nz * invM;
  car.yawRate += jn * rn * invI;

  // friction along the wall, limited by how hard we hit it
  const tx = -nz;
  const tz = nx;
  const vt = (car.vx + car.yawRate * rz) * tx + (car.vz - car.yawRate * rx) * tz;
  const rt = rz * tx - rx * tz;
  const maxJt = WALL_FRICTION * jn;
  const jt = clamp(-vt / (invM + rt * rt * invI), -maxJt, maxJt);
  car.vx += jt * tx * invM;
  car.vz += jt * tz * invM;
  car.yawRate += jt * rt * invI;

  return jn * invM;
}

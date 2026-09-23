// Constructor de mapas: describe el edificio como salas por planta y genera
// suelos, techos, paredes (media pared por sala, cada una con su material),
// fachada, huecos de puertas y ventanas, escaleras, trampillas, lámparas y
// mobiliario. Registra metadatos (salas, puertas, ventanas, trampillas, luces)
// que usan el juego, la IA y las fases posteriores (barricadas, refuerzos).
import { MAT, SOLID } from './materials.js';
import { VS } from './voxelworld.js';

const H = VS;       // media pared (0,125 m): las paredes miden 2 vóxeles
const EPS = 1e-4;

export class MapBuilder {
  constructor(world) {
    this.w = world;
    this.levels = {};     // key -> {floor, ceil, rooms:[]}
    this.rooms = [];      // {id, name, level, x0,z0,x1,z1, floorY, ceilY}
    this.doors = [];      // huecos de puerta (barricables)
    this.windows = [];    // ventanas (barricables)
    this.hatches = [];    // trampillas
    this.lights = [];     // {x,y,z, kind:'warm'|'cool', power}
    this.stairs = [];
    this.ladders = [];
    this.zones = [];      // zonas exteriores con nombre
    this.softWalls = [];  // tramos de pared blanda (paneles reforzables en F4)
  }

  // ---------- primitivas ----------
  box(x0, y0, z0, x1, y1, z1, mat, pred = null) {
    this.w.fillWorld(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1),
      Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat, pred);
  }
  clear(x0, y0, z0, x1, y1, z1) { this.box(x0, y0, z0, x1, y1, z1, MAT.AIR); }
  // Sustituye solo lo que ya es sólido (p.ej. marcos de puerta sobre la pared).
  paintSolid(x0, y0, z0, x1, y1, z1, mat) { this.box(x0, y0, z0, x1, y1, z1, mat, (old) => SOLID[old] === 1 && old !== MAT.GLASS); }
  paintAir(x0, y0, z0, x1, y1, z1, mat) { this.box(x0, y0, z0, x1, y1, z1, mat, (old) => old === MAT.AIR); }

  // ---------- plantas y salas ----------
  level(key, floorY, ceilY, opts = {}) {
    this.levels[key] = { key, floor: floorY, ceil: ceilY, rooms: [], ...opts };
  }

  /**
   * Sala rectangular. Pinta: capa superior del forjado (suelo), capa inferior del
   * forjado de arriba (techo) y la media pared interior de cada lado.
   */
  room(def) {
    const L = this.levels[def.level];
    const r = {
      ...def, floorY: L.floor, ceilY: L.ceil,
      wall: def.wall ?? MAT.DRYWALL, floor: def.floor ?? MAT.WOOD_FLOOR, ceiling: def.ceiling ?? MAT.CEILING,
    };
    const { x0, z0, x1, z1 } = r;
    const f = L.floor, c = L.ceil;
    // vaciar interior (necesario en el sótano, bajo tierra)
    this.clear(x0, f, z0, x1, c, z1);
    // suelo: capa superior del forjado
    this.box(x0, f - H, z0, x1, f, z1, r.floor);
    if (def.floorBottom !== undefined) this.box(x0, f - 2 * H, z0, x1, f - H, z1, def.floorBottom);
    // techo: capa inferior del forjado de arriba
    if (r.ceiling !== null) this.box(x0, c, z0, x1, c + H, z1, r.ceiling);
    // medias paredes interiores
    const wm = r.wall;
    if (!def.noWalls) {
      const sides = def.walls || {};
      if (sides.s !== false) this.box(x0, f, z0, x1, c, z0 + H, sides.sMat ?? wm);
      if (sides.n !== false) this.box(x0, f, z1 - H, x1, c, z1, sides.nMat ?? wm);
      if (sides.w !== false) this.box(x0, f, z0, x0 + H, c, z1, sides.wMat ?? wm);
      if (sides.e !== false) this.box(x1 - H, f, z0, x1, c, z1, sides.eMat ?? wm);
    }
    L.rooms.push(r);
    this.rooms.push(r);
    return r;
  }

  // ¿Está el punto (x,z) dentro de alguna sala de esa planta?
  insideLevel(levelKey, x, z) {
    const L = this.levels[levelKey];
    for (const r of L.rooms) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    return false;
  }

  /**
   * Cierra la planta: pinta la media pared exterior de todos los tramos de perímetro
   * que no tienen sala al otro lado. La fachada sube hasta la cara superior del forjado.
   */
  finishLevel(levelKey, extMat, topY = null) {
    const L = this.levels[levelKey];
    const f = L.floor, top = topY ?? L.ceil + 2 * H;
    const canPaint = (o) => o === MAT.AIR || o === MAT.GROUND;
    for (const r of L.rooms) {
      const { x0, z0, x1, z1 } = r;
      const segs = [
        { axis: 'x', line: z0, a: x0, b: x1, out: -1 },
        { axis: 'x', line: z1, a: x0, b: x1, out: 1 },
        { axis: 'z', line: x0, a: z0, b: z1, out: -1 },
        { axis: 'z', line: x1, a: z0, b: z1, out: 1 },
      ];
      for (const s of segs) {
        const n = Math.round((s.b - s.a) / H);
        let runStart = -1;
        for (let i = 0; i <= n; i++) {
          let outside = false;
          if (i < n) {
            const mid = s.a + (i + 0.5) * H;
            const px = s.axis === 'x' ? mid : s.line + s.out * 0.3;
            const pz = s.axis === 'x' ? s.line + s.out * 0.3 : mid;
            outside = !this.insideLevel(levelKey, px, pz);
          }
          if (outside && runStart < 0) runStart = i;
          if (!outside && runStart >= 0) {
            const ra = s.a + runStart * H - H, rb = s.a + i * H + H;
            if (s.axis === 'x') {
              const zA = s.out < 0 ? s.line - H : s.line, zB = zA + H;
              this.box(ra, f, zA, rb, top, zB, extMat, canPaint);
            } else {
              const xA = s.out < 0 ? s.line - H : s.line, xB = xA + H;
              this.box(xA, f, ra, xB, top, rb, extMat, canPaint);
            }
            runStart = -1;
          }
        }
      }
    }
  }

  // Repinta la media pared exterior de un tramo de fachada (p.ej. ladrillo en vez de enlucido).
  facade(axis, line, a, b, y0, y1, mat, out) {
    if (axis === 'x') {
      const zA = out < 0 ? line - H : line, zB = out < 0 ? line : line + H;
      this.paintSolid(a, y0, zA, b, y1, zB, mat);
    } else {
      const xA = out < 0 ? line - H : line, xB = out < 0 ? line : line + H;
      this.paintSolid(xA, y0, a, xB, y1, b, mat);
    }
  }

  // Pared completa (ambas mitades) de un material, p.ej. muro de carga de hormigón.
  fullWall(axis, line, a, b, y0, y1, mat) {
    if (axis === 'x') this.box(a, y0, line - H, b, y1, line + H, mat);
    else this.box(line - H, y0, a, line + H, y1, b, mat);
  }

  // ---------- huecos ----------
  _opening(levelKey, axis, line, center, width, sill, height, kind, opts = {}) {
    const L = this.levels[levelKey];
    const y0 = L.floor + sill, y1 = y0 + height;
    const a = center - width / 2, b = center + width / 2;
    const trim = opts.trim ?? MAT.TRIM;
    if (trim !== null) {
      // marco: anillo de 1 vóxel alrededor del hueco, solo sobre la pared existente
      if (axis === 'x') this.paintSolid(a - H, y0 - (sill > 0 ? H : 0), line - H, b + H, y1 + H, line + H, trim);
      else this.paintSolid(line - H, y0 - (sill > 0 ? H : 0), a - H, line + H, y1 + H, b + H, trim);
    }
    if (axis === 'x') this.clear(a, y0, line - H, b, y1, line + H);
    else this.clear(line - H, y0, a, line + H, y1, b);
    // lado exterior (para ventanas y barricadas)
    let out = 0;
    const inA = axis === 'x' ? this.insideLevel(levelKey, center, line - 0.3) : this.insideLevel(levelKey, line - 0.3, center);
    const inB = axis === 'x' ? this.insideLevel(levelKey, center, line + 0.3) : this.insideLevel(levelKey, line + 0.3, center);
    if (inA && !inB) out = 1; else if (inB && !inA) out = -1;
    const rec = { kind, level: levelKey, axis, line, center, width, sill, height, y0, y1, out,
      x: axis === 'x' ? center : line, z: axis === 'x' ? line : center, id: 0 };
    return rec;
  }

  // axis 'x': pared a z=line que corre a lo largo de X; 'z': pared a x=line.
  door(levelKey, axis, line, center, width = 1.0, height = 2.25, opts = {}) {
    const rec = this._opening(levelKey, axis, line, center, width, 0, height, 'door', opts);
    rec.id = this.doors.length;
    rec.barricadable = opts.barricade !== false;
    this.doors.push(rec);
    return rec;
  }
  // Hueco ancho sin marco (arco entre salas).
  arch(levelKey, axis, line, center, width, height = 2.5) {
    return this._opening(levelKey, axis, line, center, width, 0, height, 'arch', { trim: null });
  }
  window(levelKey, axis, line, center, width = 1.25, sill = 1.0, height = 1.25, opts = {}) {
    const rec = this._opening(levelKey, axis, line, center, width, sill, height, 'window', opts);
    rec.id = this.windows.length;
    if (opts.glass !== false) {
      // cristal en la media pared exterior
      const a = center - width / 2, b = center + width / 2;
      const out = rec.out || 1;
      if (axis === 'x') {
        const zA = out < 0 ? line - H : line, zB = out < 0 ? line : line + H;
        this.box(a, rec.y0, zA, b, rec.y1, zB, MAT.GLASS);
      } else {
        const xA = out < 0 ? line - H : line, xB = out < 0 ? line : line + H;
        this.box(xA, rec.y0, a, xB, rec.y1, b, MAT.GLASS);
      }
    }
    // alféizar exterior que sobresale un vóxel
    if (opts.sill !== false && rec.out) {
      const a = center - width / 2 - H, b = center + width / 2 + H;
      if (axis === 'x') {
        const z = line + rec.out * H;
        this.box(a, rec.y0 - H, Math.min(z, z + rec.out * H), b, rec.y0, Math.max(z, z + rec.out * H), MAT.TRIM);
      } else {
        const x = line + rec.out * H;
        this.box(Math.min(x, x + rec.out * H), rec.y0 - H, a, Math.max(x, x + rec.out * H), rec.y0, b, MAT.TRIM);
      }
    }
    this.windows.push(rec);
    return rec;
  }

  // ---------- escaleras ----------
  /**
   * Escalera de peldaños de 0,25 × 0,25 m.
   * axis 'z' o 'x': dirección del recorrido; low: coordenada del extremo bajo;
   * dir: +1/-1 sentido de subida; from/to: ancho en el otro eje; y0: cota inferior; rise: altura total.
   */
  stairway({ axis, low, dir, from, to, y0, rise, mat = MAT.FURN_OAK, carve = true, name = '' }) {
    const steps = Math.round(rise / 0.25);
    for (let i = 0; i < steps; i++) {
      const s0 = low + dir * i * 0.25, s1 = low + dir * (i + 1) * 0.25;
      const top = y0 + (i + 1) * 0.25;
      if (axis === 'z') this.box(from, y0, s0, to, top, s1, mat);
      else this.box(s0, y0, from, s1, top, to, mat);
    }
    const high = low + dir * steps * 0.25;
    if (carve) {
      // hueco en el forjado de arriba sobre todo el tramo
      const yTop = y0 + rise;
      if (axis === 'z') this.clear(from, yTop - 2 * H, Math.min(low, high), to, yTop, Math.max(low, high) - dir * 0.001);
      else this.clear(Math.min(low, high), yTop - 2 * H, from, Math.max(low, high), yTop, to);
    }
    this.stairs.push({ axis, low, high, dir, from, to, y0, y1: y0 + rise, name });
  }

  // Barandilla de barrotes (1 vóxel cada 0,25 m) con pasamanos.
  railing(axis, line, a, b, y, h = 1.0, mat = MAT.RAIL) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (axis === 'x') {
      this.box(lo, y + h - H, line - H, hi, y + h, line, mat);
      for (let t = lo; t < hi - EPS; t += 0.25) this.box(t, y, line - H, t + H, y + h, line, mat);
    } else {
      this.box(line - H, y + h - H, lo, line, y + h, hi, mat);
      for (let t = lo; t < hi - EPS; t += 0.25) this.box(line - H, y, t, line, y + h, t + H, mat);
    }
  }

  // Trampilla de 1,25 × 1,25 m en el forjado a la cota floorY (la del suelo de arriba).
  hatch(x, z, floorY, opts = {}) {
    const s = 0.625;
    this.box(x - s - H, floorY - 2 * H, z - s - H, x + s + H, floorY, z + s + H, MAT.METAL_FRAME);
    this.box(x - s, floorY - 2 * H, z - s, x + s, floorY, z + s, MAT.HATCH);
    const rec = { id: this.hatches.length, x, z, y: floorY, size: 1.25, ...opts };
    this.hatches.push(rec);
    return rec;
  }

  ladder(axis, line, center, y0, y1, out) {
    // escalera de mano pegada a una pared (no sólida, trepable)
    const a = center - 0.375, b = center + 0.375;
    if (axis === 'x') this.box(a, y0, Math.min(line, line + out * H), b, y1, Math.max(line, line + out * H), MAT.LADDER);
    else this.box(Math.min(line, line + out * H), y0, a, Math.max(line, line + out * H), y1, b, MAT.LADDER);
    this.ladders.push({ axis, line, center, y0, y1, out });
  }

  lamp(x, y, z, kind = 'warm', size = 0.375, power = 1) {
    const s = size / 2;
    this.box(x - s, y - H, z - s, x + s, y, z + s, kind === 'cool' ? MAT.LAMP_COOL : MAT.LAMP_WARM);
    this.lights.push({ x, y: y - H * 1.5, z, kind, power });
  }
  // Luz sin luminaria visible (farolas, apliques exteriores).
  light(x, y, z, kind = 'warm', power = 1) { this.lights.push({ x, y, z, kind, power }); }

  zone(id, name, x0, z0, x1, z1, y0 = -10, y1 = 100) { this.zones.push({ id, name, x0, z0, x1, z1, y0, y1 }); }

  // ---------- mobiliario ----------
  table(x0, z0, x1, z1, y, h = 0.75, top = MAT.FURN_OAK, legs = MAT.FURN_DARK) {
    this.box(x0, y + h - H, z0, x1, y + h, z1, top);
    for (const [lx, lz] of [[x0, z0], [x1 - H, z0], [x0, z1 - H], [x1 - H, z1 - H]]) this.box(lx, y, lz, lx + H, y + h - H, lz + H, legs);
  }
  chair(x, z, y, facing = 0, mat = MAT.FURN_DARK) {
    this.box(x - 0.25, y + 0.375, z - 0.25, x + 0.25, y + 0.5, z + 0.25, mat);
    for (const [dx, dz] of [[-0.25, -0.25], [0.125, -0.25], [-0.25, 0.125], [0.125, 0.125]]) this.box(x + dx, y, z + dz, x + dx + H, y + 0.375, z + dz + H, mat);
    const back = [[0, -0.25], [0, 0.125], [-0.25, 0], [0.125, 0]][facing];
    if (facing < 2) this.box(x - 0.25, y + 0.5, z + back[1], x + 0.25, y + 1.0, z + back[1] + H, mat);
    else this.box(x + back[0], y + 0.5, z - 0.25, x + back[0] + H, y + 1.0, z + 0.25, mat);
  }
  sofa(x0, z0, x1, z1, y, backSide, mat = MAT.FABRIC) {
    this.box(x0, y, z0, x1, y + 0.5, z1, mat);
    const t = 0.25;
    if (backSide === 's') this.box(x0, y + 0.5, z0, x1, y + 0.875, z0 + t, mat);
    if (backSide === 'n') this.box(x0, y + 0.5, z1 - t, x1, y + 0.875, z1, mat);
    if (backSide === 'w') this.box(x0, y + 0.5, z0, x0 + t, y + 0.875, z1, mat);
    if (backSide === 'e') this.box(x1 - t, y + 0.5, z0, x1, y + 0.875, z1, mat);
    // brazos
    if (backSide === 's' || backSide === 'n') { this.box(x0, y + 0.5, z0, x0 + H, y + 0.75, z1, mat); this.box(x1 - H, y + 0.5, z0, x1, y + 0.75, z1, mat); }
    else { this.box(x0, y + 0.5, z0, x1, y + 0.75, z0 + H, mat); this.box(x0, y + 0.5, z1 - H, x1, y + 0.75, z1, mat); }
  }
  bed(x0, z0, x1, z1, y, headSide) {
    this.box(x0, y, z0, x1, y + 0.25, z1, MAT.FURN_DARK);
    this.box(x0, y + 0.25, z0, x1, y + 0.5, z1, MAT.BEDSHEET);
    const t = H;
    if (headSide === 'n') this.box(x0, y, z1 - t, x1, y + 1.0, z1, MAT.FURN_DARK);
    if (headSide === 's') this.box(x0, y, z0, x1, y + 1.0, z0 + t, MAT.FURN_DARK);
    if (headSide === 'w') this.box(x0, y, z0, x0 + t, y + 1.0, z1, MAT.FURN_DARK);
    if (headSide === 'e') this.box(x1 - t, y, z0, x1, y + 1.0, z1, MAT.FURN_DARK);
  }
  shelf(x0, z0, x1, z1, y, h = 2.0) {
    this.box(x0, y, z0, x1, y + h, z1, MAT.BOOKS);
    this.box(x0, y + h - H, z0, x1, y + h, z1, MAT.FURN_DARK);
    this.box(x0, y, z0, x1, y + H, z1, MAT.FURN_DARK);
  }
  counter(x0, z0, x1, z1, y, h = 0.875) {
    this.box(x0, y, z0, x1, y + h, z1, MAT.FURN_WHITE);
    this.box(x0, y + h, z0, x1, y + h + H, z1, MAT.COUNTER);
  }
  crate(x, z, y, s = 0.75) { this.box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, MAT.CRATE); }
  rug(x0, z0, x1, z1, y, mat = MAT.CARPET_RED) { this.box(x0, y, z0, x1, y + H, z1, mat); }

  car(x, z, dirAxis, mat) {
    // coche de 4,5 × 1,875 m orientado según dirAxis ('x' o 'z')
    const L = 4.5, W = 1.875;
    const b = dirAxis === 'x'
      ? { x0: x - L / 2, x1: x + L / 2, z0: z - W / 2, z1: z + W / 2 }
      : { x0: x - W / 2, x1: x + W / 2, z0: z - L / 2, z1: z + L / 2 };
    this.box(b.x0, 0.375, b.z0, b.x1, 1.0, b.z1, mat);
    // cabina
    if (dirAxis === 'x') {
      this.box(x - 1.125, 1.0, b.z0 + H, x + 0.875, 1.5, b.z1 - H, MAT.GLASS);
      this.box(x - 1.0, 1.5, b.z0 + H, x + 0.75, 1.625, b.z1 - H, mat);
      for (const wx of [b.x0 + 0.5, b.x1 - 1.0]) for (const wz of [b.z0 - H, b.z1 - 0.375 + H]) this.box(wx, 0, wz, wx + 0.625, 0.625, wz + 0.375, MAT.TIRE);
    } else {
      this.box(b.x0 + H, 1.0, z - 1.125, b.x1 - H, 1.5, z + 0.875, MAT.GLASS);
      this.box(b.x0 + H, 1.5, z - 1.0, b.x1 - H, 1.625, z + 0.75, mat);
      for (const wz of [b.z0 + 0.5, b.z1 - 1.0]) for (const wx of [b.x0 - H, b.x1 - 0.375 + H]) this.box(wx, 0, wz, wx + 0.375, 0.625, wz + 0.625, MAT.TIRE);
    }
  }
  tree(x, z, h = 4.5, r = 1.75) {
    this.box(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, MAT.BARK);
    this.box(x - r, h - 1.5, z - r, x + r, h + 1.0, z + r, MAT.LEAVES);
    this.box(x - r + 0.5, h + 1.0, z - r + 0.5, x + r - 0.5, h + 1.75, z + r - 0.5, MAT.LEAVES);
    this.box(x - r - 0.375, h - 1.0, z - r + 0.5, x + r + 0.375, h + 0.5, z + r - 0.5, MAT.LEAVES);
  }
  hedge(x0, z0, x1, z1, h = 1.25) { this.box(x0, 0, z0, x1, h, z1, MAT.LEAVES); }
  fence(axis, line, a, b, h = 1.0) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (axis === 'x') {
      for (let t = lo; t < hi - EPS; t += 2) this.box(t, 0, line - H, t + H * 2, h + H, line + H, MAT.FENCE);
      this.box(lo, h * 0.3, line - H, hi, h * 0.3 + H, line, MAT.FENCE);
      this.box(lo, h * 0.8, line - H, hi, h * 0.8 + H, line, MAT.FENCE);
    } else {
      for (let t = lo; t < hi - EPS; t += 2) this.box(line - H, 0, t, line + H, h + H, t + H * 2, MAT.FENCE);
      this.box(line - H, h * 0.3, lo, line, h * 0.3 + H, hi, MAT.FENCE);
      this.box(line - H, h * 0.8, lo, line, h * 0.8 + H, hi, MAT.FENCE);
    }
  }

  // ---------- consultas ----------
  roomAt(x, y, z) {
    for (const r of this.rooms) {
      if (y >= r.floorY - 0.3 && y < r.ceilY + 0.3 && x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return r;
    }
    return null;
  }
}

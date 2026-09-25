// Fortificación de la defensa (fase de preparación y acción):
//  · Refuerzos: panel de acero de 1 m × altura de planta en un tramo de pared
//    blanda (la media pared del lado del defensor pasa a ser REINFORCED) o una
//    trampilla entera. 2 por defensor, 4 s manteniendo F. Las balas, el cuerpo a
//    cuerpo y las cargas normales no lo atraviesan; solo una brecha dura (Fase 6).
//  · Barricadas: tablones de madera en puertas y ventanas (una capa de vóxeles
//    BARRICADE en el hueco, del lado de quien la pone). Ilimitadas, 1,5 s. Se
//    rompen a balazos (agujero a agujero) o a golpes.
// Todo son vóxeles: se deshace con world.resetToPristine() al empezar la ronda.
import { MAT, SOLID, HARD, isSoftWall } from '../world/materials.js';
import { raycastFirst, lineOfSight } from '../world/raycast.js';
import { VS } from '../world/voxelworld.js';

export const REINFORCE_TIME = 4.0;
export const BARRICADE_TIME = 1.5;
export const REINFORCE_PER_OP = 2;
export const REACH = 1.9;           // distancia máxima a la pared (m)
const H = VS;

// Planta (suelo/techo) que contiene la cota y.
function levelAt(map, y) {
  const L = map.builder.levels;
  for (const k of Object.keys(L)) { const l = L[k]; if (y >= l.floor - 0.05 && y < l.ceil + 0.05) return l; }
  return null;
}
const isLine = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;

/**
 * Describe el panel de pared: eje de la normal (0 = pared perpendicular a X, 2 = a Z),
 * línea de la pared, lado del defensor (-1/+1) y rango en el plano.
 */
export function panelRect(axisN, line, side, uCenter, level) {
  const u0 = Math.floor(uCenter), u1 = u0 + 1;
  return { kind: 'wall', axisN, line, side, u0, u1, y0: level.floor, y1: level.ceil };
}

// Recorre los vóxeles de la capa del lado del defensor (o la otra) del panel.
function eachPanelVoxel(world, p, layerSide, fn) {
  const c = layerSide < 0 ? p.line - H / 2 : p.line + H / 2;
  const vy0 = world.vy(p.y0 + 1e-4), vy1 = world.vy(p.y1 - 1e-4);
  if (p.axisN === 0) {
    const vx = world.vx(c), vz0 = world.vz(p.u0 + 1e-4), vz1 = world.vz(p.u1 - 1e-4);
    for (let y = vy0; y <= vy1; y++) for (let z = vz0; z <= vz1; z++) fn(vx, y, z);
  } else {
    const vz = world.vz(c), vx0 = world.vx(p.u0 + 1e-4), vx1 = world.vx(p.u1 - 1e-4);
    for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) fn(x, y, vz);
  }
}

// ¿Se solapa el panel con una puerta, arco o ventana de esa pared?
function overlapsOpening(map, p) {
  const axis = p.axisN === 0 ? 'z' : 'x';     // convenio del constructor: 'x' = pared a z=line
  const lists = [map.doors, map.windows, map.builder.arches || []];
  for (const list of lists) {
    for (const o of list) {
      if (o.axis !== axis || Math.abs(o.line - p.line) > 1e-3) continue;
      const a = o.center - o.width / 2 - H, b = o.center + o.width / 2 + H;
      if (b <= p.u0 + 1e-3 || a >= p.u1 - 1e-3) continue;
      if (o.y1 + H <= p.y0 || o.y0 - H >= p.y1) continue;
      return true;
    }
  }
  return false;
}

/** Valida un panel de pared: {valid, reason}. */
export function checkWallPanel(world, map, p) {
  if (overlapsOpening(map, p)) return { valid: false, reason: 'Hay un hueco en ese tramo' };
  let tot = 0, soft = 0, air = 0, reinf = 0;
  eachPanelVoxel(world, p, p.side, (x, y, z) => {
    const m = world.get(x, y, z);
    tot++;
    if (m === MAT.AIR) air++;
    else if (m === MAT.REINFORCED) reinf++;
    else if (isSoftWall(m)) soft++;
  });
  if (reinf > tot * 0.1) return { valid: false, reason: 'Ya está reforzada' };
  if (air > tot * 0.4) return { valid: false, reason: 'Pared demasiado dañada' };
  if (soft < tot * 0.55) return { valid: false, reason: 'No se puede reforzar' };
  let hard = 0, tot2 = 0;
  eachPanelVoxel(world, p, -p.side, (x, y, z) => { tot2++; const m = world.get(x, y, z); if (HARD[m] && m !== MAT.REINFORCED) hard++; });
  if (hard > tot2 * 0.8) return { valid: false, reason: 'Pared de ladrillo: ya resiste' };
  return { valid: true, reason: '' };
}

export function checkHatch(world, h) {
  let tot = 0, hatch = 0, reinf = 0;
  eachHatchVoxel(world, h, (x, y, z) => { tot++; const m = world.get(x, y, z); if (m === MAT.HATCH) hatch++; else if (m === MAT.REINFORCED) reinf++; });
  if (reinf > tot * 0.2) return { valid: false, reason: 'Ya está reforzada' };
  if (hatch < tot * 0.8) return { valid: false, reason: 'Trampilla rota' };
  return { valid: true, reason: '' };
}
function eachHatchVoxel(world, h, fn) {
  const s = h.size / 2;
  const x0 = world.vx(h.x - s + 1e-4), x1 = world.vx(h.x + s - 1e-4);
  const z0 = world.vz(h.z - s + 1e-4), z1 = world.vz(h.z + s - 1e-4);
  const y0 = world.vy(h.y - 2 * H + 1e-4), y1 = world.vy(h.y - 1e-4);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(x, y, z);
}

// Capa de la barricada en un hueco (puerta o ventana), del lado `side`.
function eachBarricadeVoxel(world, o, side, fn) {
  const c = side < 0 ? o.line - H / 2 : o.line + H / 2;
  const a = o.center - o.width / 2, b = o.center + o.width / 2;
  const vy0 = world.vy(o.y0 + 1e-4), vy1 = world.vy(o.y1 - 1e-4);
  if (o.axis === 'z') {           // pared a x = line
    const vx = world.vx(c), vz0 = world.vz(a + 1e-4), vz1 = world.vz(b - 1e-4);
    for (let y = vy0; y <= vy1; y++) for (let z = vz0; z <= vz1; z++) fn(vx, y, z);
  } else {                        // pared a z = line
    const vz = world.vz(c), vx0 = world.vx(a + 1e-4), vx1 = world.vx(b - 1e-4);
    for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) fn(x, y, vz);
  }
}
export function barricadeState(world, o) {
  let tot = 0, wood = 0, blocked = 0;
  for (const side of [-1, 1]) {
    eachBarricadeVoxel(world, o, side, (x, y, z) => {
      tot++;
      const m = world.get(x, y, z);
      if (m === MAT.BARRICADE) wood++;
      else if (m !== MAT.AIR && m !== MAT.GLASS) blocked++;
    });
  }
  return { wood: wood / (tot / 2), blocked: blocked / tot };
}

export class Fortify {
  /**
   * @param {Game} game
   * @param {object} o  canFortify(op): ¿puede este operador fortificar ahora?
   */
  constructor(game, { canFortify = () => true } = {}) {
    this.game = game;
    this.world = game.world;
    this.map = game.map;
    this.canFortify = canFortify;
    this.left = new Map();
    this.panels = [];
    this.barricades = [];
    this.work = new Map();
    // un refuerzo abierto (carga térmica) deja de ser un panel entero: se quita su placa
    game.on('voxels', (list) => this._onVoxels(list));
  }
  reset() { this.left.clear(); this.panels = []; this.barricades = []; this.work.clear(); }
  _onVoxels(list) {
    if (!this.panels.length || !list.some((v) => v.mat === MAT.REINFORCED)) return;
    this.panels = this.panels.filter((rec) => {
      if (!list.some((v) => v.mat === MAT.REINFORCED && this._holds(rec, v.x, v.y, v.z))) return true;
      this.game.emit('panelBreached', rec);
      return false;
    });
  }
  // ¿Es el vóxel (vx, vy, vz) parte del refuerzo `rec` (panel de pared o trampilla)?
  _holds(rec, vx, vy, vz) {
    const w = this.world, c = H / 2;
    const x = w.wx(vx) + c, y = w.wy(vy) + c, z = w.wz(vz) + c;
    if (rec.kind === 'hatch') { const h = rec.hatch; return Math.abs(x - h.x) < 0.8 && Math.abs(z - h.z) < 0.8 && Math.abs(y - h.y) < 0.4; }
    const P = rec.panel, n = P.axisN === 0 ? x : z, u = P.axisN === 0 ? z : x;
    return Math.abs(n - P.line) < 0.2 && u > P.u0 - 0.05 && u < P.u1 + 0.05 && y > P.y0 - 0.05 && y < P.y1 + 0.05;
  }
  /** El refuerzo (panel o trampilla) al que pertenece el vóxel, o null. */
  recordAt(vx, vy, vz) { return this.panels.find((rec) => this._holds(rec, vx, vy, vz)) || null; }
  /** Caja (en metros) de un refuerzo: las dos capas de la pared, o la trampilla. */
  boxOf(rec) {
    if (rec.kind === 'hatch') { const h = rec.hatch; return { x0: h.x - 0.625, x1: h.x + 0.625, y0: h.y - 0.25, y1: h.y, z0: h.z - 0.625, z1: h.z + 0.625 }; }
    const P = rec.panel;
    return P.axisN === 0
      ? { x0: P.line - H, x1: P.line + H, y0: P.y0, y1: P.y1, z0: P.u0, z1: P.u1 }
      : { x0: P.u0, x1: P.u1, y0: P.y0, y1: P.y1, z0: P.line - H, z1: P.line + H };
  }
  remaining(op) { return this.left.has(op) ? this.left.get(op) : REINFORCE_PER_OP; }

  /** Qué haría `op` si mantiene F ahora: refuerzo de pared/trampilla o barricada. */
  targetFor(op, eye = op.eyePos(), dir = op.viewDir()) {
    const w = this.world, map = this.map;
    let best = null;
    // ---- pared o trampilla a la vista
    const hit = raycastFirst(w, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, REACH, SOLID, true);
    if (hit) {
      const axisN = hit.face >> 1;
      const px = eye.x + dir.x * hit.t, py = eye.y + dir.y * hit.t, pz = eye.z + dir.z * hit.t;
      if (axisN === 1) {
        const hh = map.hatches.find((h) => Math.abs(px - h.x) < h.size / 2 + 0.2 && Math.abs(pz - h.z) < h.size / 2 + 0.2 && Math.abs(py - h.y) < 0.5);
        if (hh && eye.y > hh.y) {
          const c = checkHatch(w, hh);
          best = { kind: 'hatch', hatch: hh, t: hit.t, valid: c.valid, reason: c.reason, center: { x: hh.x, y: hh.y, z: hh.z }, normal: { x: 0, y: 1, z: 0 } };
        }
      } else {
        const a = axisN === 0 ? w.wx(hit.x) : w.wz(hit.z);
        const line = isLine(a) ? a : isLine(a + H) ? a + H : null;
        const level = levelAt(map, py);
        if (line !== null && level && map.roomAt(eye.x, eye.y - 1.0, eye.z)) {
          const e = axisN === 0 ? eye.x : eye.z;
          const side = e < line ? -1 : 1;
          const p = panelRect(axisN, line, side, axisN === 0 ? pz : px, level);
          const c = checkWallPanel(w, map, p);
          const uc = (p.u0 + p.u1) / 2, yc = (p.y0 + p.y1) / 2;
          const center = axisN === 0 ? { x: line, y: yc, z: uc } : { x: uc, y: yc, z: line };
          const normal = axisN === 0 ? { x: side, y: 0, z: 0 } : { x: 0, y: 0, z: side };
          best = { kind: 'wall', panel: p, t: hit.t, valid: c.valid, reason: c.reason, center, normal };
        }
      }
    }
    // ---- hueco de puerta o ventana (barricada)
    for (const o of [...map.doors, ...map.windows]) {
      if (o.kind === 'door' && o.barricadable === false) continue;
      const nx = o.axis === 'z' ? 1 : 0, nz = o.axis === 'z' ? 0 : 1;
      const dn = dir.x * nx + dir.z * nz;
      if (Math.abs(dn) < 0.15) continue;
      const e = o.axis === 'z' ? eye.x : eye.z;
      const t = (o.line - e) / dn;
      if (t <= 0 || t > REACH + 0.3) continue;
      const ix = eye.x + dir.x * t, iy = eye.y + dir.y * t, iz = eye.z + dir.z * t;
      const u = o.axis === 'z' ? iz : ix;
      if (Math.abs(u - o.center) > o.width / 2 - 0.02 || iy < o.y0 || iy > o.y1) continue;
      if (best && best.t < t - 0.05) continue;
      const side = e < o.line ? -1 : 1;
      // no atravesar nada antes del hueco
      const back = t - 0.2;
      if (back > 0 && !lineOfSight(w, eye.x, eye.y, eye.z, eye.x + dir.x * back, eye.y + dir.y * back, eye.z + dir.z * back)) continue;
      const st = barricadeState(w, o);
      const valid = st.wood < 0.2 && st.blocked < 0.15;
      const center = o.axis === 'z' ? { x: o.line, y: (o.y0 + o.y1) / 2, z: o.center } : { x: o.center, y: (o.y0 + o.y1) / 2, z: o.line };
      best = { kind: 'barricade', opening: o, side, t, valid, reason: st.wood >= 0.2 ? 'Ya tiene barricada' : valid ? '' : 'Hueco bloqueado', center, normal: o.axis === 'z' ? { x: side, y: 0, z: 0 } : { x: 0, y: 0, z: side } };
    }
    return best;
  }

  validate(tgt) {
    if (tgt.kind === 'wall') return checkWallPanel(this.world, this.map, tgt.panel).valid;
    if (tgt.kind === 'hatch') return checkHatch(this.world, tgt.hatch).valid;
    const st = barricadeState(this.world, tgt.opening);
    return st.wood < 0.2 && st.blocked < 0.15;
  }

  // Aplica al mundo (sin comprobar coste): lo usan tick() y los tests.
  applyWall(p) {
    const w = this.world;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    eachPanelVoxel(w, p, p.side, (x, y, z) => {
      w.setRaw(x, y, z, MAT.REINFORCED);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    });
    w.notify(x0, y0, z0, x1, y1, z1);
  }
  applyHatch(h) {
    const w = this.world;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    eachHatchVoxel(w, h, (x, y, z) => {
      w.setRaw(x, y, z, MAT.REINFORCED);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    });
    w.notify(x0, y0, z0, x1, y1, z1);
  }
  applyBarricade(o, side) {
    const w = this.world;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    eachBarricadeVoxel(w, o, side, (x, y, z) => {
      if (w.get(x, y, z) !== MAT.AIR) return;
      w.setRaw(x, y, z, MAT.BARRICADE);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    });
    if (x0 !== Infinity) w.notify(x0, y0, z0, x1, y1, z1);
  }

  tick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      const w = this.work.get(op);
      const I = op.intent;
      const other = op.channel && op.channel.kind !== 'reinforce' && op.channel.kind !== 'barricade';
      if (op.state !== 'alive' || !I.interact || op.reviving || other || !this.canFortify(op)) {
        if (w) this._cancel(op, w);
        continue;
      }
      if (!w) {
        const tgt = this.targetFor(op);
        if (!tgt || !tgt.valid) continue;
        if (tgt.kind !== 'barricade' && this.remaining(op) <= 0) continue;
        const total = tgt.kind === 'barricade' ? BARRICADE_TIME : REINFORCE_TIME;
        const job = { target: tgt, t: 0, total };
        this.work.set(op, job);
        op.channel = { kind: tgt.kind === 'barricade' ? 'barricade' : 'reinforce', t: 0, total, target: tgt };
        g.emit('fortifyStart', op, tgt);
        continue;
      }
      w.t += dt;
      op.channel.t = w.t;
      if (w.t < w.total) continue;
      this.work.delete(op);
      op.channel = null;
      const tgt = w.target;
      if (!this.validate(tgt)) { g.emit('fortifyFail', op, tgt); continue; }
      if (tgt.kind === 'wall') {
        this.applyWall(tgt.panel);
        this.left.set(op, this.remaining(op) - 1);
        const rec = { kind: 'wall', panel: tgt.panel, center: tgt.center, normal: tgt.normal, op };
        this.panels.push(rec);
        g.emit('reinforced', op, rec);
      } else if (tgt.kind === 'hatch') {
        this.applyHatch(tgt.hatch);
        this.left.set(op, this.remaining(op) - 1);
        const rec = { kind: 'hatch', hatch: tgt.hatch, center: tgt.center, normal: tgt.normal, op };
        this.panels.push(rec);
        g.emit('reinforced', op, rec);
      } else {
        this.applyBarricade(tgt.opening, tgt.side);
        const rec = { opening: tgt.opening, side: tgt.side, center: tgt.center, normal: tgt.normal, op };
        this.barricades.push(rec);
        g.emit('barricaded', op, rec);
      }
    }
  }
  _cancel(op, w) {
    this.work.delete(op);
    if (op.channel && (op.channel.kind === 'reinforce' || op.channel.kind === 'barricade')) op.channel = null;
    this.game.emit('fortifyCancel', op, w.target);
  }

  // ---------------------------------------------------------------- plan para los bots
  /**
   * Refuerzos y barricadas sensatos para defender unas salas: paneles de sus
   * paredes (sin la pared que comparten, para rotar), trampillas de su suelo y
   * huecos de sus puertas y ventanas. Cada elemento trae un punto donde ponerse.
   */
  planFor(rooms) {
    const w = this.world, map = this.map;
    const inRooms = (x, z, r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
    const shared = (axisN, line, u) => {
      // ¿la pared separa dos salas del sitio?
      let n = 0;
      for (const r of rooms) {
        const e = 0.3;
        const a = axisN === 0 ? { x: line - e, z: u } : { x: u, z: line - e };
        const b = axisN === 0 ? { x: line + e, z: u } : { x: u, z: line + e };
        if (inRooms(a.x, a.z, r) || inRooms(b.x, b.z, r)) n++;
      }
      return n > 1;
    };
    const walls = [], hatches = [], openings = [];
    rooms.forEach((r, ri) => {
      const level = levelAt(map, r.floorY + 0.5);
      const sides = [
        { axisN: 2, line: r.z0, side: 1, a: r.x0, b: r.x1 },
        { axisN: 2, line: r.z1, side: -1, a: r.x0, b: r.x1 },
        { axisN: 0, line: r.x0, side: 1, a: r.z0, b: r.z1 },
        { axisN: 0, line: r.x1, side: -1, a: r.z0, b: r.z1 },
      ];
      for (const s of sides) {
        for (let u = Math.floor(s.a); u + 1 <= s.b + 1e-6; u++) {
          if (u < s.a - 1e-6) continue;
          if (shared(s.axisN, s.line, u + 0.5)) continue;
          const p = panelRect(s.axisN, s.line, s.side, u + 0.5, level);
          if (!checkWallPanel(w, map, p).valid) continue;
          // punto de apoyo a 0,75 m de la pared, dentro de la sala, con hueco para estar de pie
          const d = 0.75 * s.side;
          const stand = s.axisN === 0 ? { x: s.line + d, z: u + 0.5 } : { x: u + 0.5, z: s.line + d };
          if (!inRooms(stand.x, stand.z, r)) continue;
          const face = faceYaw(s.axisN, -s.side);
          if (!this._reachable(stand, r.floorY, face, 0, (t) => t.kind === 'wall' && t.valid && t.panel.line === p.line && t.panel.u0 === p.u0)) continue;
          walls.push({ kind: 'wall', panel: p, room: ri, stand: { ...stand, y: r.floorY }, face, pitch: 0 });
        }
      }
      for (const h of map.hatches) {
        if (Math.abs(h.y - r.floorY) < 0.05 && inRooms(h.x, h.z, r) && this._reachable({ x: h.x, z: h.z + 0.25 }, r.floorY, 0, -1.45, (t) => t.kind === 'hatch' && t.valid && t.hatch === h)) {
          hatches.push({ kind: 'hatch', hatch: h, room: ri, stand: { x: h.x, y: r.floorY, z: h.z + 0.25 }, face: 0, pitch: -1.45 });
        }
      }
      for (const o of [...map.doors, ...map.windows]) {
        if (o.kind === 'door' && o.barricadable === false) continue;
        const lvl = levelAt(map, o.y0 + 0.2);
        if (!lvl || Math.abs(lvl.floor - r.floorY) > 0.05) continue;
        const onEdge = o.axis === 'z'
          ? (Math.abs(o.line - r.x0) < 1e-3 || Math.abs(o.line - r.x1) < 1e-3) && o.center > r.z0 && o.center < r.z1
          : (Math.abs(o.line - r.z0) < 1e-3 || Math.abs(o.line - r.z1) < 1e-3) && o.center > r.x0 && o.center < r.x1;
        if (!onEdge) continue;
        const inward = o.axis === 'z' ? (Math.abs(o.line - r.x0) < 1e-3 ? 1 : -1) : (Math.abs(o.line - r.z0) < 1e-3 ? 1 : -1);
        if (shared(o.axis === 'z' ? 0 : 2, o.line, o.center)) continue;
        const stand = o.axis === 'z' ? { x: o.line + inward * 0.9, z: o.center } : { x: o.center, z: o.line + inward * 0.9 };
        const face = faceYaw(o.axis === 'z' ? 0 : 2, -inward);
        const pitch = Math.atan2((o.y0 + o.y1) / 2 - (r.floorY + 1.64), 0.9);
        if (!this._reachable(stand, r.floorY, face, pitch, (t) => t.kind === 'barricade' && t.valid && t.opening === o)) continue;
        openings.push({ kind: 'barricade', opening: o, side: inward, room: ri, stand: { ...stand, y: r.floorY }, face, pitch });
      }
    });
    return { walls, hatches, openings };
  }

  // ¿Se puede estar de pie en `stand` y, mirando así, apuntar al objetivo esperado?
  _reachable(stand, floorY, yaw, pitch, ok) {
    const w = this.world;
    if (w.worldBoxHasSolid(stand.x - 0.3, floorY + 0.02, stand.z - 0.3, stand.x + 0.3, floorY + 1.8, stand.z + 0.3)) return false;
    const eye = { x: stand.x, y: floorY + 1.64, z: stand.z };
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const t = this.targetFor(null, eye, dir);
    return !!t && ok(t);
  }
}

// Yaw para mirar en la dirección de la normal (eje, signo).
function faceYaw(axisN, sign) {
  const dx = axisN === 0 ? sign : 0, dz = axisN === 2 ? sign : 0;
  return Math.atan2(-dx, -dz);
}

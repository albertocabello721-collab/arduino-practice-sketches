// Navegación de los bots: rejilla 2,5D de celdas de 0,5 m. Cada columna puede tener
// varias superficies donde estar de pie (sótano, planta baja, alta, tejados). Las
// conexiones respetan escalones (≤ 0,4 m), el techo (de pie 1,75 m o agachado
// 1,2 m) y el ancho del cuerpo. Tipos de arista:
//   walk   · andar
//   break  · bloqueada solo por barricada de madera: hay que romperla a golpes
//   ladder · subir por una escalera de mano (solo hacia arriba)
//   drop   · dejarse caer desde un borde o por una trampilla abierta (solo hacia abajo)
// La destrucción cambia el mapa: world.onChange marca columnas sucias que se
// recalculan poco a poco (update). Al reiniciar la ronda se restaura la copia
// original.
import { SOLID, MAT } from '../world/materials.js';

export const CELL = 0.5;
// Para andar, la madera de una barricada no es suelo ni pared: es un estorbo que se rompe.
const navSolid = (m) => SOLID[m] && m !== MAT.BARRICADE;
const R = 0.25;             // radio del cuerpo para comprobar hueco (algo menor que el físico)
const R_BODY = 0.33;        // radio con el que se recoloca el punto de paso dentro de la celda
const STAND_H = 1.75, CROUCH_H = 1.2;
const STEP = 0.38;          // desnivel máximo entre muestras (la física sube 0,375 m)
const BREAK_COST = 7;       // coste extra (m equivalentes) de romper una barricada
const MAX_DROP = 4.1;

export class NavGrid {
  constructor(world, map) {
    this.world = world;
    this.map = map;
    const b = map.bounds;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.ncx = Math.floor((b.maxX - b.minX) / CELL);
    this.ncz = Math.floor((b.maxZ - b.minZ) / CELL);
    this.yMin = b.minY; this.yMax = b.maxY;
    this.cols = new Array(this.ncx * this.ncz);
    this.nodes = [];
    this.dirty = new Set();
    this._touched = new Set();   // columnas cambiadas desde la copia original (para restaurar solo esas)
    this.version = 0;
    this.queue = [];             // búsquedas pendientes (request/work)
    this._build();
    this.pristine = this._snapshot();
    this._off = world.onChange((x0, y0, z0, x1, y1, z1) => this._onChange(x0, y0, z0, x1, y1, z1));
  }
  dispose() { if (this._off) this._off(); }

  // ------------------------------------------------------------------ construcción
  colIndex(cx, cz) { return cz * this.ncx + cx; }
  colCenter(cx, cz) { return { x: this.x0 + (cx + 0.5) * CELL, z: this.z0 + (cz + 0.5) * CELL }; }
  colOf(x, z) {
    const cx = Math.floor((x - this.x0) / CELL), cz = Math.floor((z - this.z0) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return -1;
    return this.colIndex(cx, cz);
  }

  _build() {
    this.nodes = [];
    for (let cz = 0; cz < this.ncz; cz++) for (let cx = 0; cx < this.ncx; cx++) this._buildColumn(cx, cz);
    for (const n of this.nodes) n.edges = [];
    for (const n of this.nodes) this._linkNode(n, true);
    this._addLadders();
    this.version++;
  }

  // Superficies donde cabe una persona en el centro de la columna.
  _surfaces(x, z) {
    const w = this.world;
    const out = [];
    const vx = w.vx(x), vz = w.vz(z);
    let vyTop = w.vy(this.yMax - 0.01), vyBot = w.vy(this.yMin + 0.01);
    let prevSolid = navSolid(w.get(vx, vyTop, vz));
    for (let vy = vyTop - 1; vy >= vyBot; vy--) {
      const s = navSolid(w.get(vx, vy, vz));
      if (s && !prevSolid) {
        const y = w.wy(vy + 1);
        const h = this._clear(x, y, z);
        if (h) out.push({ y, crouch: h === 1 });
      }
      prevSolid = s;
    }
    return out;
  }
  // 2 = cabe de pie, 1 = solo agachado, 0 = no cabe (la madera de barricada no cuenta)
  // (los pies pueden estar sobre escalones: el hueco se mide por encima de la altura de escalón)
  _clear(x, y, z) {
    if (this._boxBlock(x, y + STEP, z, CROUCH_H - STEP) === 2) return 0;
    if (this._boxBlock(x, y + CROUCH_H, z, STAND_H - CROUCH_H) === 2) return 1;
    return 2;
  }
  _buildColumn(cx, cz) {
    const ci = this.colIndex(cx, cz);
    const { x, z } = this.colCenter(cx, cz);
    const list = [];
    for (const s of this._surfaces(x, z)) {
      const n = { id: this.nodes.length, x, y: s.y, z, col: ci, cx, cz, crouch: s.crouch, edges: [], alive: true, px: x, pz: z };
      if (!this._center(n)) continue;     // hueco donde el cuerpo real no cabe (p. ej. 0,5 m entre muebles)
      this.nodes.push(n);
      list.push(n);
    }
    this.cols[ci] = list;
  }
  // Punto de paso (px, pz): dentro de la celda, donde quepa el cuerpo físico con holgura
  // (en una puerta de 1 m, su centro). Las aristas se calculan entre centros de celda.
  _center(n) {
    const h = n.crouch ? CROUCH_H : 1.5;
    const fits = (x, z) => this._boxBlock(x, n.y + STEP, z, h - STEP, R_BODY) !== 2
      && this._surfaceNear(x, z, n.y, n.y) !== null && Math.abs(this._surfaceNear(x, z, n.y, n.y) - n.y) <= STEP;
    if (fits(n.x, n.z)) return true;
    let best = null, bd = Infinity;
    for (const ox of [-0.25, -0.1875, -0.125, -0.0625, 0, 0.0625, 0.125, 0.1875, 0.25]) {
      for (const oz of [-0.25, -0.1875, -0.125, -0.0625, 0, 0.0625, 0.125, 0.1875, 0.25]) {
        const d = ox * ox + oz * oz;
        if (d >= bd) continue;
        if (fits(n.x + ox, n.z + oz)) { bd = d; best = [ox, oz]; }
      }
    }
    if (!best) return false;
    n.px = n.x + best[0]; n.pz = n.z + best[1];
    n.tight = true;      // paso estrecho (puerta, esquina): hay que pasar por el punto exacto
    return true;
  }

  /**
   * Comprueba si se puede ir andando en línea recta de a a b (muestras cada 0,125 m).
   * Devuelve 0 no, 1 sí, 2 sí pero rompiendo una barricada. `crouch` si hay que ir agachado.
   */
  walkable(a, b, crouchOk = true, r = R) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(2, Math.ceil(dist / 0.125));
    const h = crouchOk ? CROUCH_H : STAND_H;
    let y = a.y, needBreak = false;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + dx * t, z = a.z + dz * t;
      const target = a.y + (b.y - a.y) * t;
      // superficie cerca de la altura esperada (escalones de hasta 0,375 m)
      const sy = this._surfaceNear(x, z, y, target);
      if (sy === null || Math.abs(sy - y) > STEP) return 0;
      y = sy;
      // hueco para el cuerpo por encima de la altura de escalón (cada 0,25 m)
      if ((i & 1) === 0 || i === n) {
        const blk = this._boxBlock(x, y + STEP, z, h - STEP, r);
        if (blk === 2) return 0;
        if (blk === 1) needBreak = true;
      }
    }
    if (Math.abs(y - b.y) > STEP) return 0;
    return needBreak ? 2 : 1;
  }
  // 0 libre, 1 solo madera de barricada, 2 bloqueado
  _boxBlock(x, y, z, h, r = R) {
    const w = this.world;
    const x0 = w.vx(x - r + 1e-6), x1 = w.vx(x + r - 1e-6), y0 = w.vy(y + 1e-4), y1 = w.vy(y + h - 1e-6), z0 = w.vz(z - r + 1e-6), z1 = w.vz(z + r - 1e-6);
    let wood = false;
    for (let vy = y0; vy <= y1; vy++) for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
      const m = w.get(vx, vy, vz);
      if (!SOLID[m]) continue;
      if (m === MAT.BARRICADE) { wood = true; continue; }
      return 2;
    }
    return wood ? 1 : 0;
  }
  // Superficie más cercana a `pref` (dentro de ±0,5 m) en (x, z).
  _surfaceNear(x, z, cur, target) {
    const w = this.world;
    const vx = w.vx(x), vz = w.vz(z);
    let best = null, bd = Infinity;
    const lo = w.vy(Math.min(cur, target) - 0.55), hi = w.vy(Math.max(cur, target) + 0.55);
    for (let vy = hi; vy >= lo; vy--) {
      if (navSolid(w.get(vx, vy, vz)) && !navSolid(w.get(vx, vy + 1, vz))) {
        const y = w.wy(vy + 1);
        const d = Math.abs(y - cur);
        if (d < bd) { bd = d; best = y; }
      }
    }
    return best;
  }

  /**
   * Enlaza un nodo con las 8 columnas vecinas. Con `half` (construcción completa) solo
   * mira la mitad de las direcciones y añade la arista en los dos sentidos.
   */
  _linkNode(n, half = false) {
    if (!half) n.edges = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const forward = dz > 0 || (dz === 0 && dx > 0);
      if (half && !forward) continue;
      const cx = n.cx + dx, cz = n.cz + dz;
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) continue;
      const list = this.cols[this.colIndex(cx, cz)];
      if (!list) continue;
      let walked = false;
      for (const m of list) {
        const dy = m.y - n.y;
        if (Math.abs(dy) > 0.65) continue;
        const k = this.walkable(n, m, true);
        if (!k) continue;
        const d = Math.hypot(m.x - n.x, dy, m.z - n.z);
        const cost = d * (m.crouch || n.crouch ? 1.4 : 1) + (k === 2 ? BREAK_COST : 0);
        const kind = k === 2 ? 'break' : 'walk';
        n.edges.push({ to: m.id, cost, kind });
        if (half) m.edges.push({ to: n.id, cost, kind });
        else this._replaceEdge(m, n.id, cost, kind);
        walked = true;
      }
      if (!walked) this._tryDrop(n, list, dx, dz);
      // en la construcción completa, la caída desde el vecino hacia este nodo
      if (half && !walked) for (const m of list) this._tryDrop(m, [n], -dx, -dz);
    }
  }
  _replaceEdge(m, toId, cost, kind) {
    const e = m.edges.find((q) => q.to === toId);
    if (e) { e.cost = cost; e.kind = kind; } else m.edges.push({ to: toId, cost, kind });
  }
  // caída: no hay superficie a la misma altura al lado, pero sí más abajo
  _tryDrop(n, list, dx, dz) {
    if (dx !== 0 && dz !== 0) return;
    if (list.some((m) => Math.abs(m.y - n.y) <= 0.65)) return;
    for (const m of list) {
      const drop = n.y - m.y;
      if (drop < 0.6 || drop > MAX_DROP) continue;
      if (!this._dropClear(n, m)) continue;
      if (!n.edges.some((e) => e.to === m.id)) n.edges.push({ to: m.id, cost: CELL + drop * 0.5, kind: 'drop' });
      return;
    }
  }
  // Espacio libre para caer desde el borde de n hasta m.
  _dropClear(n, m) {
    const w = this.world;
    const x = (n.x + m.x) / 2, z = (n.z + m.z) / 2;
    if (w.worldBoxHasSolid(m.x - R, m.y + 0.03, m.z - R, m.x + R, n.y + STAND_H, m.z + R)) return false;
    if (w.worldBoxHasSolid(x - R, n.y + 0.03, z - R, x + R, n.y + STAND_H, z + R)) return false;
    return true;
  }

  _addLadders() {
    this.ladderNodes = [];
    if (!this._ladderCols) {
      // columnas cuyo cambio obliga a recalcular las escaleras de mano
      this._ladderCols = new Set();
      for (const L of this.map.ladders || []) {
        for (let dz = -2.5; dz <= 2.5; dz += CELL) for (let dx = -2.5; dx <= 2.5; dx += CELL) {
          const x = (L.axis === 'x' ? L.center : L.line) + dx, z = (L.axis === 'x' ? L.line : L.center) + dz;
          const ci = this.colOf(x, z);
          if (ci >= 0) this._ladderCols.add(ci);
        }
      }
    }
    for (const L of this.map.ladders || []) {
      const out = L.out;
      const bx = L.axis === 'x' ? L.center : L.line + out * 0.55, bz = L.axis === 'x' ? L.line + out * 0.55 : L.center;
      const tx = L.axis === 'x' ? L.center : L.line - out * 0.6, tz = L.axis === 'x' ? L.line - out * 0.6 : L.center;
      // abajo, del lado de la escalera; arriba, del otro lado del borde
      const side = (n) => (L.axis === 'x' ? n.z - L.line : n.x - L.line) * out;
      const bottom = this.nearest(bx, L.y0, bz, 1.0, 0.8, (n) => side(n) > 0.3);
      const top = this.nearest(tx, L.y1 - 0.75, tz, 1.2, 1.2, (n) => side(n) < -0.2);
      if (!bottom || !top || top.y < bottom.y + 1.5) continue;
      bottom.edges.push({ to: top.id, cost: (top.y - bottom.y) * 2 + 2, kind: 'ladder', ladder: L });
      this.ladderNodes.push(bottom);
    }
  }

  // ------------------------------------------------------------------ actualización
  _onChange(x0, y0, z0, x1, y1, z1) {
    const w = this.world;
    if (x1 - x0 >= w.nx - 1 && z1 - z0 >= w.nz - 1) { this._pendingReset = true; return; }
    const M = 0.4;   // el hueco del cuerpo (0,33 m) y las aristas entre vecinas
    const ax = w.wx(x0) - M, bx = w.wx(x1 + 1) + M, az = w.wz(z0) - M, bz = w.wz(z1 + 1) + M;
    const cx0 = Math.max(0, Math.floor((ax - this.x0) / CELL)), cx1 = Math.min(this.ncx - 1, Math.floor((bx - this.x0) / CELL));
    const cz0 = Math.max(0, Math.floor((az - this.z0) / CELL)), cz1 = Math.min(this.ncz - 1, Math.floor((bz - this.z0) / CELL));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(this.colIndex(cx, cz));
  }
  /** Recalcula columnas sucias (hasta `budget` columnas). Devuelve cuántas quedan. */
  update(budget = 64) {
    if (this._pendingReset) {
      this._pendingReset = false;
      this.dirty.clear();
      if (this._modified) { this._modified = false; this._restore(this.pristine); this.version++; }
      return 0;
    }
    if (!this.dirty.size) return 0;
    this._modified = true;
    const cols = [];
    for (const ci of this.dirty) { cols.push(ci); if (cols.length >= budget) break; }
    for (const ci of cols) this.dirty.delete(ci);
    // quitar nodos viejos de esas columnas
    const touched = new Set();
    for (const ci of cols) {
      for (const n of this.cols[ci] || []) n.alive = false;
      const cx = ci % this.ncx, cz = Math.floor(ci / this.ncx);
      this._buildColumn(cx, cz);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.ncx || nz >= this.ncz) continue;
        touched.add(this.colIndex(nx, nz));
      }
    }
    for (const ci of touched) this._touched.add(ci);
    for (const ci of touched) for (const n of this.cols[ci] || []) n.edges = n.edges.filter((e) => this.nodes[e.to].alive);
    for (const ci of cols) for (const n of this.cols[ci] || []) this._linkNode(n);
    // los vecinos no reconstruidos pueden tener caídas hacia las columnas nuevas
    for (const ci of touched) for (const n of this.cols[ci] || []) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || (dx && dz)) continue;
        const nx = n.cx + dx, nz = n.cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.ncx || nz >= this.ncz) continue;
        const list = this.cols[this.colIndex(nx, nz)] || [];
        if (!list.some((m) => n.edges.some((e) => e.to === m.id))) this._tryDrop(n, list, dx, dz);
      }
    }
    // las escaleras de mano cercanas pueden haber cambiado de nodo
    if (cols.some((ci) => this._ladderCols.has(ci))) {
      for (const n of this.ladderNodes) n.edges = n.edges.filter((e) => e.kind !== 'ladder');
      this._addLadders();
    }
    this.version++;
    return this.dirty.size;
  }
  _snapshot() {
    return {
      nodes: this.nodes.map((n) => ({ ...n, edges: n.edges.map((e) => ({ ...e })) })),
      cols: this.cols.map((l) => (l ? l.map((n) => n.id) : null)),
      ladders: this.ladderNodes.map((n) => n.id),
    };
  }
  _restore(s) {
    const copy = (id) => { const n = s.nodes[id]; return (this.nodes[id] = { ...n, edges: n.edges.map((e) => ({ ...e })) }); };
    if (this._touched.size > 4000) {
      this.nodes = s.nodes.map((n) => ({ ...n, edges: n.edges.map((e) => ({ ...e })) }));
      this.cols = s.cols.map((l) => (l ? l.map((id) => this.nodes[id]) : null));
    } else {
      // solo las columnas tocadas (y las de las escaleras de mano); los nodos nuevos se descartan
      this.nodes.length = s.nodes.length;
      const cols = new Set(this._touched);
      for (const id of s.ladders) cols.add(s.nodes[id].col);
      for (const ci of cols) this.cols[ci] = s.cols[ci] ? s.cols[ci].map(copy) : null;
    }
    this.ladderNodes = s.ladders.map((id) => this.nodes[id]);
    this._touched.clear();
  }

  // ------------------------------------------------------------------ consultas
  /** Nodo vivo más cercano a (x, y, z) dentro de un radio horizontal y vertical. */
  nearest(x, y, z, rh = 1.5, rv = 1.2, filter = null) {
    const cx0 = Math.floor((x - rh - this.x0) / CELL), cx1 = Math.floor((x + rh - this.x0) / CELL);
    const cz0 = Math.floor((z - rh - this.z0) / CELL), cz1 = Math.floor((z + rh - this.z0) / CELL);
    let best = null, bd = Infinity;
    for (let cz = Math.max(0, cz0); cz <= Math.min(this.ncz - 1, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.ncx - 1, cx1); cx++) {
        for (const n of this.cols[this.colIndex(cx, cz)] || []) {
          const dy = Math.abs(n.y - y);
          if (dy > rv || (filter && !filter(n))) continue;
          const d = Math.hypot(n.x - x, n.z - z) + dy * 2;
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    return best;
  }

  // Nodo cercano al que se puede llegar andando en línea recta desde `p` (no al otro lado de una pared).
  nearestReachable(p, rh = 1.6, rv = 1.0) {
    const cands = [];
    const cx0 = Math.floor((p.x - rh - this.x0) / CELL), cx1 = Math.floor((p.x + rh - this.x0) / CELL);
    const cz0 = Math.floor((p.z - rh - this.z0) / CELL), cz1 = Math.floor((p.z + rh - this.z0) / CELL);
    for (let cz = Math.max(0, cz0); cz <= Math.min(this.ncz - 1, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.ncx - 1, cx1); cx++) {
        for (const n of this.cols[this.colIndex(cx, cz)] || []) {
          const dy = Math.abs(n.y - p.y);
          if (dy > rv) continue;
          cands.push({ n, d: Math.hypot(n.x - p.x, n.z - p.z) + dy * 2 });
        }
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < cands.length && i < 12; i++) {
      const n = cands[i].n;
      if (cands[i].d < 0.2 || this.walkable(p, n, true, 0.2)) return n;
    }
    return cands.length ? cands[0].n : null;
  }

  /**
   * A* entre dos puntos (síncrono). Devuelve {points:[{x,y,z,kind,crouch,tight,id}], cost}
   * o null. `avoid(n)`: coste extra por nodo (zonas peligrosas). `noLadder`: sin escaleras
   * de mano (drones). `noBreak`: sin romper barricadas.
   */
  path(from, to, opts = {}) {
    const job = this._newJob(from, to, opts);
    this._begin(job);
    while (job.status === 'running') this._expand(job, 1e9);
    return job.result;
  }

  /** Pide una ruta que se calcula por partes en work() (sin tirones). */
  request(from, to, opts = {}) {
    const job = this._newJob(from, to, opts);
    this.queue.push(job);
    return job;
  }
  cancel(job) { if (job && (job.status === 'queued' || job.status === 'running')) job.status = 'cancelled'; }
  /** Avanza las búsquedas pendientes expandiendo como mucho `budget` nodos. */
  work(budget = 1500) {
    const q = this.queue;
    while (budget > 0 && q.length) {
      const job = q[0];
      // (si el mapa cambia a mitad de búsqueda, sigue: los nodos muertos se saltan y, si la
      // ruta resulta mala, el seguidor replanifica al atascarse)
      if (job.status === 'queued') this._begin(job);
      if (job.status === 'running') budget -= this._expand(job, budget);
      else budget -= 50;
      if (job.status !== 'running') q.shift();
    }
  }
  _newJob(from, to, opts) {
    return { from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, opts, status: 'queued', result: null, s: null, t: null, version: -1, heap: null };
  }
  _begin(job) {
    const o = job.opts;
    const s = this.nearestReachable(job.from), t = this.nearest(job.to.x, job.to.y, job.to.z, o.goalR ?? 2.0, 1.5);
    job.version = this.version;
    if (!s || !t) { job.status = 'failed'; return; }
    const N = this.nodes.length;
    if (!this._g || this._g.length < N) {
      this._g = new Float64Array(N * 2); this._from = new Int32Array(N * 2); this._seen = new Uint32Array(N * 2); this._closed = new Uint32Array(N * 2); this._kind = new Array(N * 2); this._gen = 0;
    }
    job.gen = ++this._gen;
    job.s = s; job.t = t; job.it = 0;
    job.best = s.id; job.bestH = Infinity;       // para las rutas parciales: el nodo más cercano al destino
    job.heap = job.heap || new MinHeap();
    job.heap.clear();
    this._g[s.id] = 0; this._seen[s.id] = job.gen; this._from[s.id] = -1; this._kind[s.id] = 'walk';
    job.heap.push(s.id, this._h(s, t));
    job.status = 'running';
  }
  _h(n, t) { const dx = n.x - t.x, dy = (n.y - t.y) * 1.5, dz = n.z - t.z; return Math.sqrt(dx * dx + dy * dy + dz * dz) * 1.15; }
  // Expande hasta `budget` nodos. Devuelve cuántos ha expandido.
  _expand(job, budget) {
    const o = job.opts, avoid = o.avoid || null, noLadder = !!o.noLadder, noBreak = !!o.noBreak, maxIter = o.maxIter || 40000;
    const breakExtra = o.breakCost || 0;
    const g = this._g, from_ = this._from, seen = this._seen, closed = this._closed, kind = this._kind, nodes = this.nodes;
    const heap = job.heap, gen = job.gen, t = job.t;
    // la búsqueda comparte las tablas: solo avanza la que las inicializó la última vez
    if (gen !== this._gen) { this._begin(job); return 1; }
    const tx = t.x, ty = t.y, tz = t.z;
    let n = 0;
    while (heap.size && n < budget) {
      if (job.it++ > maxIter) { job.status = 'failed'; this.lastIter = job.it; return n; }
      const id = heap.pop();
      if (closed[id] === gen) continue;
      closed[id] = gen;
      n++;
      if (id === t.id) { this._finish(job); return n; }
      if (o.partial) {
        const q = nodes[id], hx = q.x - tx, hy = (q.y - ty) * 1.5, hz = q.z - tz, hh = hx * hx + hy * hy + hz * hz;
        if (hh < job.bestH) { job.bestH = hh; job.best = id; }
      }
      const edges = nodes[id].edges, gid = g[id];
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k], to = e.to;
        if (closed[to] === gen) continue;
        if ((noLadder && e.kind === 'ladder') || (noBreak && e.kind === 'break')) continue;
        const m = nodes[to];
        if (!m.alive) continue;
        const ng = gid + e.cost + (e.kind === 'break' ? breakExtra : 0) + (avoid ? avoid(m) : 0);
        if (seen[to] !== gen || ng < g[to]) {
          seen[to] = gen; g[to] = ng; from_[to] = id; kind[to] = e.kind;
          const dx = m.x - tx, dy = (m.y - ty) * 1.5, dz = m.z - tz;
          heap.push(to, ng + Math.sqrt(dx * dx + dy * dy + dz * dz) * 1.15);
        }
      }
    }
    if (!heap.size) {
      // sin camino: con `partial`, la ruta hasta el punto alcanzable más cercano al destino
      if (o.partial && job.best !== job.s.id) { this._finish(job, job.best); job.result.partial = true; return Math.max(1, n); }
      job.status = 'failed'; this.lastIter = job.it;
    }
    return Math.max(1, n);
  }
  _finish(job, endId = job.t.id) {
    const pts = [];
    for (let id = endId; id !== -1; id = this._from[id]) {
      const n = this.nodes[id];
      pts.push({ x: n.px, y: n.y, z: n.pz, kind: this._kind[id], crouch: n.crouch, tight: !!n.tight, id });
    }
    pts.reverse();
    this.lastIter = job.it;
    job.result = { points: job.opts.raw ? pts : this._smooth(pts), cost: this._g[endId], raw: pts.length };
    job.status = 'done';
    job.heap = null;
  }

  // Tira de la cuerda: salta puntos intermedios si se puede ir en línea recta.
  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 8);
      for (; j > i + 1; j--) {
        let special = false;
        for (let k = i + 1; k <= j; k++) if (pts[k].kind !== 'walk') { special = true; break; }
        if (special) continue;
        if (Math.abs(pts[j].y - pts[i].y) > 0.05 && j - i > 3) continue;   // en escaleras, paso a paso
        if (this.walkable(pts[i], pts[j], false, 0.31) === 1) break;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  stats() {
    let alive = 0, edges = 0, breaks = 0, drops = 0, ladders = 0;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      alive++;
      for (const e of n.edges) { edges++; if (e.kind === 'break') breaks++; else if (e.kind === 'drop') drops++; else if (e.kind === 'ladder') ladders++; }
    }
    return { nodes: alive, edges, breaks, drops, ladders };
  }
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  clear() { this.ids.length = 0; this.keys.length = 0; }
  push(id, key) {
    const a = this.ids, k = this.keys;
    let i = a.length;
    a.push(id); k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p]; k[i] = k[p];
      i = p;
    }
    a[i] = id; k[i] = key;
  }
  pop() {
    const a = this.ids, k = this.keys;
    const top = a[0];
    const lastId = a.pop(), lastKey = k.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastKey) break;
        a[i] = a[c]; k[i] = k[c];
        i = c;
      }
      a[i] = lastId; k[i] = lastKey;
    }
    return top;
  }
}

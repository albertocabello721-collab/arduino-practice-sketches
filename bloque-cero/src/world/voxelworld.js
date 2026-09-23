// Mundo de vóxeles de 12,5 cm en chunks de 32³ (4 m de lado).
// - Los chunks no asignados valen AIR por encima del suelo y GROUND por debajo,
//   así el terreno exterior no ocupa memoria.
// - `pristine` es la foto del mapa recién construido: sirve para reiniciar la
//   ronda y para que el mallador sepa qué caras son "rotas" (antes tapadas).
import { MAT, SOLID, OPAQUE } from './materials.js';

export const VS = 0.125;       // lado del vóxel en metros
export const INV_VS = 8;
export const CS = 32;          // lado del chunk de almacenamiento en vóxeles
export const CHUNK_VOL = CS * CS * CS;
export const MC = 16;          // lado de la celda de mallado (remallar tras una bala cuesta 8× menos)

export class VoxelWorld {
  /**
   * @param {{origin:{x,y,z}, size:{x,y,z}, groundY:number}} o  medidas en metros
   */
  constructor({ origin, size, groundY = 0 }) {
    this.ox = origin.x; this.oy = origin.y; this.oz = origin.z;
    this.nx = Math.round(size.x * INV_VS);
    this.ny = Math.round(size.y * INV_VS);
    this.nz = Math.round(size.z * INV_VS);
    if (this.nx % CS || this.ny % CS || this.nz % CS) throw new Error('El tamaño del mundo debe ser múltiplo de 4 m');
    this.ncx = this.nx / CS; this.ncy = this.ny / CS; this.ncz = this.nz / CS;
    this.groundVY = Math.round((groundY - this.oy) * INV_VS);
    if (this.groundVY % CS) throw new Error('El suelo debe caer en el borde de un chunk');
    this.groundCY = this.groundVY / CS; // capas de chunk < groundCY son terreno implícito
    const n = this.ncx * this.ncy * this.ncz;
    this.chunks = new Array(n).fill(null);
    this.pristine = null;
    this.nmx = this.nx / MC; this.nmy = this.ny / MC; this.nmz = this.nz / MC;
    this.groundMY = this.groundVY / MC;
    this.dirty = new Set();       // celdas de mallado (16³) a remallar
    this.modified = new Set();    // chunks cambiados desde la foto
    this.listeners = [];          // fn(x0,y0,z0,x1,y1,z1) cajas de vóxeles cambiados (inclusive)
    this.version = 0;
  }

  // ---------- conversión de coordenadas ----------
  vx(wx) { return Math.floor((wx - this.ox) * INV_VS); }
  vy(wy) { return Math.floor((wy - this.oy) * INV_VS); }
  vz(wz) { return Math.floor((wz - this.oz) * INV_VS); }
  wx(vx) { return vx * VS + this.ox; }
  wy(vy) { return vy * VS + this.oy; }
  wz(vz) { return vz * VS + this.oz; }

  chunkIndex(cx, cy, cz) { return (cy * this.ncz + cz) * this.ncx + cx; }
  defaultMat(cy) { return cy < this.groundCY ? MAT.GROUND : MAT.AIR; }
  inBounds(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }

  // ---------- lectura ----------
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) {
      return y < this.groundVY ? MAT.GROUND : MAT.AIR;
    }
    const c = this.chunks[((y >> 5) * this.ncz + (z >> 5)) * this.ncx + (x >> 5)];
    if (c === null) return (y >> 5) < this.groundCY ? MAT.GROUND : MAT.AIR;
    return c[((y & 31) << 10) | ((z & 31) << 5) | (x & 31)];
  }
  getPristine(x, y, z) {
    if (!this.pristine) return this.get(x, y, z);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) {
      return y < this.groundVY ? MAT.GROUND : MAT.AIR;
    }
    const c = this.pristine[((y >> 5) * this.ncz + (z >> 5)) * this.ncx + (x >> 5)];
    if (c === null) return (y >> 5) < this.groundCY ? MAT.GROUND : MAT.AIR;
    return c[((y & 31) << 10) | ((z & 31) << 5) | (x & 31)];
  }
  isSolid(x, y, z) { return SOLID[this.get(x, y, z)] === 1; }
  isOpaque(x, y, z) { return OPAQUE[this.get(x, y, z)] === 1; }
  getWorld(wx, wy, wz) { return this.get(this.vx(wx), this.vy(wy), this.vz(wz)); }
  solidAtWorld(wx, wy, wz) { return SOLID[this.getWorld(wx, wy, wz)] === 1; }

  // ¿Hay algún vóxel sólido en la caja (índices inclusive)?
  boxHasSolid(x0, y0, z0, x1, y1, z1) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (SOLID[this.get(x, y, z)]) return true;
    return false;
  }
  // Caja en metros (min inclusive, max exclusivo con tolerancia).
  worldBoxHasSolid(minx, miny, minz, maxx, maxy, maxz) {
    const e = 1e-6;
    return this.boxHasSolid(this.vx(minx + e), this.vy(miny + e), this.vz(minz + e),
      this.vx(maxx - e), this.vy(maxy - e), this.vz(maxz - e));
  }

  // ---------- escritura ----------
  allocChunk(ci, cy) {
    const c = new Uint8Array(CHUNK_VOL);
    const d = this.defaultMat(cy);
    if (d) c.fill(d);
    this.chunks[ci] = c;
    return c;
  }

  meshIndex(mx, my, mz) { return (my * this.nmz + mz) * this.nmx + mx; }
  // Marca las celdas de mallado cuya malla depende de la caja de vóxeles (inclusive):
  // se amplía un vóxel porque la visibilidad de caras y la oclusión miran a los vecinos.
  markDirtyVoxels(x0, y0, z0, x1, y1, z1) {
    const mx0 = Math.max(0, (x0 - 1) >> 4), mx1 = Math.min(this.nmx - 1, (x1 + 1) >> 4);
    const my0 = Math.max(0, (y0 - 1) >> 4), my1 = Math.min(this.nmy - 1, (y1 + 1) >> 4);
    const mz0 = Math.max(0, (z0 - 1) >> 4), mz1 = Math.min(this.nmz - 1, (z1 + 1) >> 4);
    for (let my = my0; my <= my1; my++)
      for (let mz = mz0; mz <= mz1; mz++)
        for (let mx = mx0; mx <= mx1; mx++) this.dirty.add(this.meshIndex(mx, my, mz));
  }

  // Escribe sin avisar a los oyentes (para operaciones en bloque). Devuelve el material anterior.
  setRaw(x, y, z, m) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return -1;
    const cx = x >> 5, cy = y >> 5, cz = z >> 5;
    const ci = (cy * this.ncz + cz) * this.ncx + cx;
    let c = this.chunks[ci];
    if (c === null) {
      if (m === this.defaultMat(cy)) return m;
      c = this.allocChunk(ci, cy);
    }
    const lx = x & 31, ly = y & 31, lz = z & 31;
    const i = (ly << 10) | (lz << 5) | lx;
    const old = c[i];
    if (old === m) return old;
    c[i] = m;
    this.modified.add(ci);
    this.markDirtyVoxels(x, y, z, x, y, z);
    this.version++;
    return old;
  }
  set(x, y, z, m) {
    const old = this.setRaw(x, y, z, m);
    if (old !== m && old !== -1) this.notify(x, y, z, x, y, z);
    return old;
  }
  notify(x0, y0, z0, x1, y1, z1) {
    for (const fn of this.listeners) fn(x0, y0, z0, x1, y1, z1);
  }
  onChange(fn) { this.listeners.push(fn); return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }; }

  // Rellena una caja de vóxeles (inclusive) con un material. `pred(old)` opcional filtra.
  fill(x0, y0, z0, x1, y1, z1, m, pred = null) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(this.nx - 1, x1); y1 = Math.min(this.ny - 1, y1); z1 = Math.min(this.nz - 1, z1);
    if (x0 > x1 || y0 > y1 || z0 > z1) return;
    for (let cy = y0 >> 5; cy <= y1 >> 5; cy++)
      for (let cz = z0 >> 5; cz <= z1 >> 5; cz++)
        for (let cx = x0 >> 5; cx <= x1 >> 5; cx++) {
          const ci = this.chunkIndex(cx, cy, cz);
          let c = this.chunks[ci];
          if (c === null) {
            if (m === this.defaultMat(cy) && !pred) continue;
            c = this.allocChunk(ci, cy);
          }
          const ax = Math.max(x0, cx * CS), bx = Math.min(x1, cx * CS + 31);
          const ay = Math.max(y0, cy * CS), by = Math.min(y1, cy * CS + 31);
          const az = Math.max(z0, cz * CS), bz = Math.min(z1, cz * CS + 31);
          let changed = false;
          for (let y = ay; y <= by; y++)
            for (let z = az; z <= bz; z++) {
              const row = ((y & 31) << 10) | ((z & 31) << 5);
              for (let x = ax; x <= bx; x++) {
                const i = row | (x & 31);
                const old = c[i];
                if (old === m || (pred && !pred(old))) continue;
                c[i] = m; changed = true;
              }
            }
          if (changed) {
            this.modified.add(ci);
            this.markDirtyVoxels(ax, ay, az, bx, by, bz);
          }
        }
    this.version++;
    this.notify(x0, y0, z0, x1, y1, z1);
  }

  // Caja en metros → vóxeles. min inclusive, max exclusivo (redondeando al vóxel más cercano).
  fillWorld(minx, miny, minz, maxx, maxy, maxz, m, pred = null) {
    const x0 = Math.round((minx - this.ox) * INV_VS), x1 = Math.round((maxx - this.ox) * INV_VS) - 1;
    const y0 = Math.round((miny - this.oy) * INV_VS), y1 = Math.round((maxy - this.oy) * INV_VS) - 1;
    const z0 = Math.round((minz - this.oz) * INV_VS), z1 = Math.round((maxz - this.oz) * INV_VS) - 1;
    this.fill(x0, y0, z0, x1, y1, z1, m, pred);
  }

  // ---------- foto del mapa y reinicio de ronda ----------
  snapshot() {
    this.pristine = this.chunks.map((c) => (c ? c.slice() : null));
    this.modified.clear();
  }
  resetToPristine() {
    if (!this.pristine) return;
    for (const ci of this.modified) {
      const p = this.pristine[ci];
      if (p) {
        if (this.chunks[ci]) this.chunks[ci].set(p); else this.chunks[ci] = p.slice();
      } else {
        this.chunks[ci] = null;
      }
      const cx = ci % this.ncx, cz = Math.floor(ci / this.ncx) % this.ncz, cy = Math.floor(ci / (this.ncx * this.ncz));
      this.markDirtyVoxels(cx * CS, cy * CS, cz * CS, cx * CS + CS - 1, cy * CS + CS - 1, cz * CS + CS - 1);
    }
    const had = this.modified.size > 0;
    this.modified.clear();
    this.version++;
    if (had) this.notify(0, 0, 0, this.nx - 1, this.ny - 1, this.nz - 1);
  }

  // Chunk vacío (todo aire) o inexistente.
  chunkIsEmpty(ci) {
    const c = this.chunks[ci];
    if (c === null) return true;
    for (let i = 0; i < CHUNK_VOL; i++) if (c[i] !== 0) return false;
    return true;
  }

  stats() {
    let alloc = 0;
    for (const c of this.chunks) if (c) alloc++;
    return { chunks: this.chunks.length, allocated: alloc, bytes: alloc * CHUNK_VOL * (this.pristine ? 2 : 1) };
  }
}

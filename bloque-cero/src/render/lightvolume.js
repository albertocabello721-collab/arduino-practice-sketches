// Volumen de luz ambiente (tipo "iluminación global" barata) sobre una rejilla de
// 0,25 m que cubre la casa. Tres canales propagados por inundación (BFS):
//   R: luz de cielo (entra por ventanas, puertas y boquetes)
//   G: lámparas cálidas   B: fluorescentes/frías
// Se recalcula por regiones cuando la destrucción cambia qué celdas son opacas:
// abrir un boquete deja entrar la luz del día en la sala.
// Sin Three.js: el render sube `data` a una Data3DTexture.
import { OPAQUE, MAT } from '../world/materials.js';

export const SKY_MAX = 60;     // alcance de la luz de cielo (celdas de 0,25 m)
export const LAMP_MAX = 40;    // alcance de una lámpara

export class LightVolume {
  constructor(world, min, max, cell = 0.25) {
    this.world = world;
    this.cell = cell;
    this.vpc = Math.round(cell * 8); // vóxeles por celda (2)
    this.min = { x: min.x, y: min.y, z: min.z };
    this.nx = Math.round((max.x - min.x) / cell);
    this.ny = Math.round((max.y - min.y) / cell);
    this.nz = Math.round((max.z - min.z) / cell);
    this.max = { x: min.x + this.nx * cell, y: min.y + this.ny * cell, z: min.z + this.nz * cell };
    const n = this.nx * this.ny * this.nz;
    this.opaque = new Uint8Array(n);
    this.sky = new Uint8Array(n);
    this.warm = new Uint8Array(n);
    this.cool = new Uint8Array(n);
    this.data = new Uint8Array(n * 4); // RGBA para la textura 3D
    this.queue = new Int32Array(n);
    this.skyTop = new Int16Array(this.nx * this.nz).fill(-1); // y de la celda opaca más alta por columna
    this.lights = [];
    this.version = 0;
  }
  idx(x, y, z) { return (z * this.ny + y) * this.nx + x; }

  // voxel base (esquina) de la celda
  _vox(cx, cy, cz) {
    const w = this.world;
    return [
      Math.round((this.min.x + cx * this.cell - w.ox) * 8),
      Math.round((this.min.y + cy * this.cell - w.oy) * 8),
      Math.round((this.min.z + cz * this.cell - w.oz) * 8),
    ];
  }
  computeOpacity(x0 = 0, y0 = 0, z0 = 0, x1 = this.nx - 1, y1 = this.ny - 1, z1 = this.nz - 1) {
    const w = this.world, k = this.vpc;
    let changed = false;
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const [vx, vy, vz] = this._vox(cx, cy, cz);
          let cnt = 0;
          for (let dy = 0; dy < k; dy++) for (let dz = 0; dz < k; dz++) for (let dx = 0; dx < k; dx++) if (OPAQUE[w.get(vx + dx, vy + dy, vz + dz)]) cnt++;
          const o = cnt * 2 >= k * k * k ? 1 : 0;
          const i = this.idx(cx, cy, cz);
          if (this.opaque[i] !== o) { this.opaque[i] = o; changed = true; }
        }
    if (changed) this._updateSkyTop(x0, z0, x1, z1);
    return changed;
  }
  _updateSkyTop(x0, z0, x1, z1) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let top = -1;
      for (let y = this.ny - 1; y >= 0; y--) if (this.opaque[this.idx(x, y, z)]) { top = y; break; }
      this.skyTop[z * this.nx + x] = top;
    }
  }

  setLights(lights) {
    this.lights = lights.map((l) => ({
      cx: Math.floor((l.x - this.min.x) / this.cell),
      cy: Math.floor((l.y - this.min.y) / this.cell),
      cz: Math.floor((l.z - this.min.z) / this.cell),
      kind: l.kind, level: Math.round(LAMP_MAX * Math.min(1.2, l.power ?? 1)),
    })).filter((l) => l.cx >= 0 && l.cy >= 0 && l.cz >= 0 && l.cx < this.nx && l.cy < this.ny && l.cz < this.nz);
  }

  computeAll() {
    this._updateSkyTop(0, 0, this.nx - 1, this.nz - 1);
    this.startJob(0, 0, 0, this.nx - 1, this.ny - 1, this.nz - 1, 0, true);
    this.stepJob(Infinity);
  }

  /**
   * Trabajo de recálculo troceable: la caja [x0..x1] (celdas) cambió; se recalcula la
   * opacidad ahí y, si algo cambió, la luz en la caja ampliada con `margin`.
   * stepJob(ms) avanza hasta agotar el presupuesto; devuelve true al terminar con datos nuevos.
   */
  startJob(x0, y0, z0, x1, y1, z1, margin = 20, full = false) {
    const R = full ? [0, 0, 0, this.nx - 1, this.ny - 1, this.nz - 1] : [
      Math.max(0, x0 - margin), Math.max(0, y0 - margin), Math.max(0, z0 - margin),
      Math.min(this.nx - 1, x1 + margin), Math.min(this.ny - 1, y1 + margin), Math.min(this.nz - 1, z1 + margin)];
    this.job = { core: [x0, y0, z0, x1, y1, z1], box: R, full, phase: 'opacity', z: z0, changed: full, ch: 0, qh: 0, qt: 0 };
  }

  stepJob(budgetMs) {
    const J = this.job;
    if (!J) return false;
    const t0 = performance.now();
    const over = () => performance.now() - t0 > budgetMs;
    const [x0, y0, z0, x1, y1, z1] = J.box;
    while (true) {
      if (J.phase === 'opacity') {
        const c = J.core;
        while (J.z <= c[5]) {
          if (this.computeOpacity(c[0], c[1], J.z, c[3], c[4], J.z)) J.changed = true;
          J.z++;
          if (over()) return false;
        }
        if (!J.changed) { this.job = null; return false; }
        J.phase = 'seed'; J.ch = 0;
      }
      if (J.phase === 'seed') {
        const ch = [this.sky, this.warm, this.cool][J.ch];
        const r = this._seedChannel(J.ch, ch, x0, y0, z0, x1, y1, z1, J.full);
        J.qh = 0; J.qt = r;
        J.phase = 'flood';
        if (over()) return false;
      }
      if (J.phase === 'flood') {
        const ch = [this.sky, this.warm, this.cool][J.ch];
        const done = this._floodSome(ch, J, x0, y0, z0, x1, y1, z1, budgetMs === Infinity ? Infinity : 60000, t0, budgetMs);
        if (!done) return false;
        J.ch++;
        if (J.ch < 3) { J.phase = 'seed'; if (over()) return false; continue; }
        J.phase = 'pack'; J.z = Math.max(0, z0 - 1);
      }
      if (J.phase === 'pack') {
        const Z1 = Math.min(this.nz - 1, z1 + 1);
        while (J.z <= Z1) {
          this._packSlice(J.z, Math.max(0, x0 - 1), Math.max(0, y0 - 1), Math.min(this.nx - 1, x1 + 1), Math.min(this.ny - 1, y1 + 1));
          J.z++;
          if (over() && J.z <= Z1) return false;
        }
        this.job = null;
        this.version++;
        return true;
      }
    }
  }

  // Pone a cero el canal en la caja y siembra la cola: cielo (columnas abiertas),
  // lámparas y la luz que entra por el contorno. Devuelve la longitud de la cola.
  _seedChannel(ci, ch, x0, y0, z0, x1, y1, z1, full) {
    const { ny } = this;
    const q = this.queue;
    let qt = 0;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) { const b = this.idx(x0, y, z); ch.fill(0, b, b + (x1 - x0) + 1); }
    if (ci === 0) {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const top = this.skyTop[z * this.nx + x];
        for (let y = Math.max(y0, top + 1); y <= y1; y++) { const i = this.idx(x, y, z); ch[i] = SKY_MAX; q[qt++] = i; }
      }
    } else {
      const kind = ci === 1 ? 'warm' : 'cool';
      for (const l of this.lights) {
        if (l.kind !== kind) continue;
        if (l.cx < x0 || l.cx > x1 || l.cy < y0 || l.cy > y1 || l.cz < z0 || l.cz > z1) continue;
        const i = this.idx(l.cx, l.cy, l.cz);
        if (ch[i] < l.level) { ch[i] = l.level; q[qt++] = i; }
      }
    }
    if (!full) this._seedBorder(ch, x0, y0, z0, x1, y1, z1, (i) => { q[qt++] = i; });
    return qt;
  }

  // Las celdas vecinas exteriores a la caja aportan su luz como fuente.
  _seedBorder(ch, x0, y0, z0, x1, y1, z1, push) {
    const { nx, ny, nz } = this;
    const tryN = (xi, yi, zi, xo, yo, zo) => {
      if (xo < 0 || yo < 0 || zo < 0 || xo >= nx || yo >= ny || zo >= nz) return;
      const src = ch[this.idx(xo, yo, zo)];
      if (src <= 1) return;
      const i = this.idx(xi, yi, zi);
      if (this.opaque[i]) return;
      if (ch[i] < src - 1) { ch[i] = src - 1; push(i); }
    };
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) { tryN(x0, y, z, x0 - 1, y, z); tryN(x1, y, z, x1 + 1, y, z); }
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { tryN(x, y0, z, x, y0 - 1, z); tryN(x, y1, z, x, y1 + 1, z); }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tryN(x, y, z0, x, y, z0 - 1); tryN(x, y, z1, x, y, z1 + 1); }
  }

  _floodSome(ch, J, x0, y0, z0, x1, y1, z1, _unused, t0, budgetMs) {
    const { nx, ny } = this;
    const op = this.opaque, q = this.queue;
    const sx = 1, sy = nx, sz = nx * ny;
    let qh = J.qh, qt = J.qt, n = 0;
    while (qh < qt) {
      const i = q[qh++];
      const lv = ch[i];
      if (lv > 1) {
        const nl = lv - 1;
        const x = i % nx, r = (i - x) / nx, y = r % ny, z = (r - y) / ny;
        if (x > x0) { const j = i - sx; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (x < x1) { const j = i + sx; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (y > y0) { const j = i - sy; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (y < y1) { const j = i + sy; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (z > z0) { const j = i - sz; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (z < z1) { const j = i + sz; if (!op[j] && ch[j] < nl) { ch[j] = nl; q[qt++] = j; } }
        if (qt >= q.length - 8) { q.copyWithin(0, qh, qt); qt -= qh; qh = 0; }
      }
      if (++n >= 4096) {
        n = 0;
        if (performance.now() - t0 > budgetMs) { J.qh = qh; J.qt = qt; return false; }
      }
    }
    J.qh = qh; J.qt = qt;
    return true;
  }

  // Empaqueta una rebanada z a RGBA. Las celdas opacas copian la luz máxima de sus
  // vecinas transparentes para que el filtrado trilineal no oscurezca las superficies.
  _packSlice(z, x0, y0, x1, y1) {
    const { nx, ny, nz } = this;
    const d = this.data, op = this.opaque, S = this.sky, Wm = this.warm, C = this.cool;
    const sy = nx, sz = nx * ny;
    const ks = 255 / SKY_MAX, kl = 255 / LAMP_MAX;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (z * ny + y) * nx + x;
      let s = S[i], w = Wm[i], c = C[i];
      if (op[i]) {
        s = 0; w = 0; c = 0;
        let j;
        if (x > 0 && !op[j = i - 1]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
        if (x < nx - 1 && !op[j = i + 1]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
        if (y > 0 && !op[j = i - sy]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
        if (y < ny - 1 && !op[j = i + sy]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
        if (z > 0 && !op[j = i - sz]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
        if (z < nz - 1 && !op[j = i + sz]) { if (S[j] > s) s = S[j]; if (Wm[j] > w) w = Wm[j]; if (C[j] > c) c = C[j]; }
      }
      const o = i * 4;
      d[o] = s * ks + 0.5; d[o + 1] = Math.min(255, w * kl + 0.5); d[o + 2] = Math.min(255, c * kl + 0.5); d[o + 3] = 255;
    }
  }

  /** Muestra trilineal en CPU (0..1 por canal) para entidades y exposición. */
  sample(wx, wy, wz, out = { sky: 1, warm: 0, cool: 0 }) {
    const fx = (wx - this.min.x) / this.cell - 0.5, fy = (wy - this.min.y) / this.cell - 0.5, fz = (wz - this.min.z) / this.cell - 0.5;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= this.nx - 1 || fy >= this.ny - 1 || fz >= this.nz - 1) {
      out.sky = wy >= 0 ? 1 : 0; out.warm = 0; out.cool = 0; return out;
    }
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    let s = 0, w = 0, c = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      const o = this.idx(x + dx, y + dy, z + dz) * 4;
      s += this.data[o] * wt; w += this.data[o + 1] * wt; c += this.data[o + 2] * wt;
    }
    out.sky = s / 255; out.warm = w / 255; out.cool = c / 255;
    return out;
  }

  // Caja de celdas afectada por una caja de vóxeles.
  cellsForVoxelBox(vx0, vy0, vz0, vx1, vy1, vz1) {
    const w = this.world;
    const f = (v, o, m) => Math.floor((v / 8 + o - m) / this.cell);
    return [
      Math.max(0, f(vx0, w.ox, this.min.x)), Math.max(0, f(vy0, w.oy, this.min.y)), Math.max(0, f(vz0, w.oz, this.min.z)),
      Math.min(this.nx - 1, f(vx1 + 1, w.ox, this.min.x)), Math.min(this.ny - 1, f(vy1 + 1, w.oy, this.min.y)), Math.min(this.nz - 1, f(vz1 + 1, w.oz, this.min.z)),
    ];
  }
}


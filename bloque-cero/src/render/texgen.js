// Generador procedural de materiales PBR (sin archivos): 256×256 px por metro.
// Cada textura produce albedo (lineal), rugosidad, altura (→ normal y cavidad),
// metalicidad y máscara de recorte. Se empaqueta en dos texture arrays:
//   A: RGB albedo (sRGB) + A rugosidad
//   B: RG normal tangente + B oclusión de cavidad + A metal (o recorte)
// Todo es periódico (tileable) porque los campos de ruido se precalculan sobre
// un toro de 256×256 y los generadores solo los consultan con desplazamientos.
import { mulberry32 } from '../core/rng.js';

export const TEX_SIZE = 256;
const S = TEX_SIZE, M = S - 1, N = S * S;

// ---------------------------------------------------------------- ruido
function gradNoiseField(seed, freq, octaves, gain = 0.5) {
  // Perlin periódico: freq celdas por lado en la octava base (entero → tileable)
  const out = new Float32Array(N);
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = freq << o;
    const scale = f / S;
    for (let y = 0; y < S; y++) {
      const fy = y * scale, iy = Math.floor(fy), ty = fy - iy;
      const y0 = iy % f, y1 = (iy + 1) % f;
      const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      for (let x = 0; x < S; x++) {
        const fx = x * scale, ix = Math.floor(fx), tx = fx - ix;
        const x0 = ix % f, x1 = (ix + 1) % f;
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const h00 = perm[perm[x0 + o * 17 & 255] + y0], h10 = perm[perm[x1 + o * 17 & 255] + y0];
        const h01 = perm[perm[x0 + o * 17 & 255] + y1], h11 = perm[perm[x1 + o * 17 & 255] + y1];
        const n00 = gx[h00] * tx + gy[h00] * ty;
        const n10 = gx[h10] * (tx - 1) + gy[h10] * ty;
        const n01 = gx[h01] * tx + gy[h01] * (ty - 1);
        const n11 = gx[h11] * (tx - 1) + gy[h11] * (ty - 1);
        const nx0 = n00 + (n10 - n00) * sx, nx1 = n01 + (n11 - n01) * sx;
        out[y * S + x] += (nx0 + (nx1 - nx0) * sy) * amp;
      }
    }
    norm += amp; amp *= gain;
  }
  // normalizar a [0,1]
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < N; i++) out[i] = (out[i] - mn) * k;
  return out;
}

function whiteField(seed) {
  const r = mulberry32(seed), out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = r();
  return out;
}

function blurField(src, radius) {
  // caja separable periódica
  const tmp = new Float32Array(N), out = new Float32Array(N), w = 2 * radius + 1;
  for (let y = 0; y < S; y++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[y * S + ((k + S) & M)];
    for (let x = 0; x < S; x++) {
      tmp[y * S + x] = acc / w;
      acc += src[y * S + ((x + radius + 1) & M)] - src[y * S + ((x - radius + S) & M)];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[((k + S) & M) * S + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = acc / w;
      acc += tmp[((y + radius + 1) & M) * S + x] - tmp[((y - radius + S) & M) * S + x];
    }
  }
  return out;
}

// Worley periódico: F1, F2 y id de celda para `cells` celdas por lado.
function worleyField(seed, cells) {
  const r = mulberry32(seed);
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), id = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) { px[i] = r(); py[i] = r(); id[i] = r(); }
  const f1 = new Float32Array(N), f2 = new Float32Array(N), cid = new Float32Array(N);
  const cs = S / cells;
  for (let y = 0; y < S; y++) {
    const gy = y / cs, cy = Math.floor(gy);
    for (let x = 0; x < S; x++) {
      const gx = x / cs, cx = Math.floor(gx);
      let d1 = 9, d2 = 9, best = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const ncx = cx + ox, ncy = cy + oy;
        const wcx = ((ncx % cells) + cells) % cells, wcy = ((ncy % cells) + cells) % cells;
        const k = wcy * cells + wcx;
        const dx = ncx + px[k] - gx, dy = ncy + py[k] - gy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = id[k]; } else if (d < d2) d2 = d;
      }
      const i = y * S + x;
      f1[i] = d1; f2[i] = d2; cid[i] = best;
    }
  }
  return { f1, f2, id: cid };
}

let FIELDS = null;
function fields() {
  if (FIELDS) return FIELDS;
  FIELDS = {
    n2: gradNoiseField(11, 2, 5),
    n4: gradNoiseField(21, 4, 5),
    n8: gradNoiseField(31, 8, 4),
    n16: gradNoiseField(41, 16, 4),
    n32: gradNoiseField(51, 32, 3),
    n64: gradNoiseField(61, 64, 2),
    w: whiteField(71),
    w2: whiteField(72),
    c6: worleyField(81, 6),
    c10: worleyField(82, 10),
    c24: worleyField(83, 24),
  };
  FIELDS.wb1 = blurField(FIELDS.w, 1);
  return FIELDS;
}

// ---------------------------------------------------------------- utilidades
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
const hashI = (n) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };
// consulta periódica de un campo con desplazamiento y escala entera
const at = (f, x, y) => f[((y & M) << 8) | (x & M)];

class Layer {
  constructor(name) {
    this.name = name;
    this.r = new Float32Array(N); this.g = new Float32Array(N); this.b = new Float32Array(N);
    this.h = new Float32Array(N); this.rough = new Float32Array(N).fill(0.8);
    this.metal = new Float32Array(N); this.alpha = new Float32Array(N).fill(1);
    this.normalStrength = 1; this.uvScale = 1; this.emissive = 0; this.cutout = 0;
  }
  set(i, r, g, b, h, rough, metal = 0) { this.r[i] = r; this.g[i] = g; this.b[i] = b; this.h[i] = h; this.rough[i] = rough; this.metal[i] = metal; }
}

// ---------------------------------------------------------------- generadores
// Cada generador recibe (L, F) y rellena la capa píxel a píxel (x = u, y = v hacia arriba).
const GEN = {};
const each = (fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y, y * S + x); };

GEN.plaster_paint = (L, F) => {
  each((x, y, i) => {
    const peel = at(F.n64, x, y) * 0.6 + at(F.n32, x + 40, y + 9) * 0.4;
    const v = 0.8 + (at(F.n4, x, y) - 0.5) * 0.05 + (peel - 0.5) * 0.03;
    L.set(i, v, v, v, peel * 0.35, 0.82 + at(F.n16, x, y) * 0.1);
  });
  L.normalStrength = 0.5;
};
GEN.ceiling = (L, F) => {
  each((x, y, i) => {
    const s = at(F.n64, x + 77, y + 13) * 0.5 + at(F.wb1, x, y) * 0.5;
    const v = 0.86 + (at(F.n4, x + 30, y) - 0.5) * 0.03;
    L.set(i, v, v, v * 0.98, s * 0.4, 0.9);
  });
  L.normalStrength = 0.45;
};
GEN.gypsum = (L, F) => {
  each((x, y, i) => {
    const grain = at(F.w, x, y) * 0.5 + at(F.n64, x, y) * 0.5;
    const v = 0.74 + (at(F.n16, x, y) - 0.5) * 0.12 + (grain - 0.5) * 0.08;
    // capas de papel: vetas marrones finas
    const paper = smooth(0.94, 0.99, at(F.n8, x * 4, y)) * 0.25;
    L.set(i, v - paper * 0.2, v - paper * 0.25, v - paper * 0.35, grain * 0.9 + at(F.n32, x, y) * 0.5, 0.96);
  });
  L.normalStrength = 1.4;
};
GEN.plaster_dirty = (L, F) => {
  each((x, y, i) => {
    const stain = smooth(0.52, 0.78, at(F.n4, x + 100, y + 50));
    const grime = smooth(0.45, 0.9, at(F.n16, x, y)) * 0.25;
    const crackD = at(F.c6.f2, x, y) - at(F.c6.f1, x, y);
    const crack = (1 - smooth(0.0, 0.02, crackD)) * smooth(0.68, 0.8, at(F.n8, x, y));
    const peel = at(F.n32, x, y);
    let r = 0.64, g = 0.62, b = 0.56;
    const k = 1 - stain * 0.22 - grime * 0.2 - crack * 0.25;
    r = r * k + stain * 0.03; g = g * k + stain * 0.02; b *= k;
    L.set(i, r, g, b, peel * 0.4 - crack * 0.6, 0.9);
  });
  L.normalStrength = 0.9;
};
function wallpaperBase(L, F, motif) {
  each((x, y, i) => {
    const paper = at(F.n64, x, y) * 0.5 + at(F.w, x, y) * 0.5;
    const m = motif(x / S, y / S, x, y);
    const v = 0.62 + m * 0.22 + (paper - 0.5) * 0.05 + (at(F.n4, x, y) - 0.5) * 0.04;
    L.set(i, v, v, v, paper * 0.25 + m * 0.35, 0.78 - m * 0.25);
  });
  L.normalStrength = 0.6;
}
GEN.wallpaper_damask = (L, F) => wallpaperBase(L, F, (u, v) => {
  // motivo romboidal 4×4 por metro con flor central (simétrico)
  const cu = fract(u * 4) - 0.5, cv = fract(v * 4 + (Math.floor(u * 4) % 2) * 0.5) - 0.5;
  const ax = Math.abs(cu), ay = Math.abs(cv);
  const r = Math.hypot(ax * 1.2, ay);
  const petal = Math.cos(Math.atan2(ay, ax) * 6) * 0.08 + 0.22;
  let m = r < petal ? 1 : 0;
  const diamond = Math.abs(ax + ay * 0.8 - 0.42) < 0.018 ? 1 : 0;
  const stem = ax < 0.012 && ay > 0.24 && ay < 0.4 ? 1 : 0;
  const leaf = Math.hypot(ax - 0.12, ay - 0.3) < 0.05 ? 1 : 0;
  return Math.max(m * 0.9, diamond, stem, leaf * 0.8);
});
GEN.wallpaper_stripes = (L, F) => wallpaperBase(L, F, (u) => {
  const s = fract(u * 8);
  return s < 0.42 ? 0.85 : s < 0.47 ? 0.2 : s > 0.93 ? 0.35 : 0.0;
});
GEN.wallpaper_dots = (L, F) => wallpaperBase(L, F, (u, v) => {
  const cu = fract(u * 8) - 0.5, cv = fract(v * 8 + (Math.floor(u * 8) % 2) * 0.5) - 0.5;
  const d = Math.hypot(cu, cv);
  const star = Math.abs(cu) + Math.abs(cv) < 0.16 ? 1 : 0;
  return Math.max(d < 0.1 ? 1 : 0, star * 0.7);
});

function woodGrain(F, x, y, along) {
  // along = 'u' → vetas horizontales; 'v' → verticales
  return along === 'u'
    ? at(F.n16, x, y * 8) * 0.6 + at(F.n32, x + 13, y * 8 + 7) * 0.3 + at(F.w, x, y * 4) * 0.1
    : at(F.n16, x * 8, y) * 0.6 + at(F.n32, x * 8 + 13, y + 7) * 0.3 + at(F.w, x * 4, y) * 0.1;
}
function woodColor(base, var1, grain, knot) {
  const k = 0.82 + var1 * 0.3 + (grain - 0.5) * 0.35 - knot * 0.35;
  return [base[0] * k, base[1] * k, base[2] * k];
}
GEN.wood_floor = (L, F) => {
  const rows = 8; // tablas de 12,5 cm
  each((x, y, i) => {
    const row = Math.floor(y / S * rows);
    const off = hashI(row * 7 + 3);
    const u = fract(x / S + off);
    const plank = row * 31 + (u < 0.5 ? 0 : 1);
    const pv = hashI(plank * 13 + 5);
    const ly = fract(y / S * rows);
    const edge = Math.min(ly, 1 - ly) * (S / rows);
    const joint = Math.min(u, Math.abs(u - 0.5), 1 - u) * S;
    const grain = woodGrain(F, x, y, 'u');
    const knot = smooth(0.8, 0.95, at(F.n8, x + plank * 17, y * 2)) * 0.5;
    const [r, g, b] = woodColor([0.5, 0.31, 0.16], pv, grain, knot);
    const gap = (edge < 1.2 || joint < 1.0) ? 1 : 0;
    const wear = at(F.n4, x, y);
    L.set(i, gap ? r * 0.35 : r, gap ? g * 0.35 : g, gap ? b * 0.35 : b, gap ? 0 : 0.6 + grain * 0.2, gap ? 0.9 : 0.42 + wear * 0.25);
  });
  L.normalStrength = 1.0;
};
GEN.parquet = (L, F) => {
  // cesta: cuadros de 25 cm con 4 listones alternando orientación
  each((x, y, i) => {
    const cx = Math.floor(x / 64), cy = Math.floor(y / 64);
    const horiz = (cx + cy) % 2 === 0;
    const lx = x % 64, ly = y % 64;
    const slat = horiz ? Math.floor(ly / 16) : Math.floor(lx / 16);
    const id = (cx * 7 + cy * 13) * 4 + slat;
    const pv = hashI(id * 29 + 11);
    const e1 = horiz ? Math.min(ly % 16, 15 - (ly % 16)) : Math.min(lx % 16, 15 - (lx % 16));
    const e2 = Math.min(lx, 63 - lx, ly, 63 - ly);
    const grain = horiz ? woodGrain(F, x, y, 'u') : woodGrain(F, x, y, 'v');
    const [r, g, b] = woodColor([0.52, 0.32, 0.16], pv, grain, 0);
    const gap = e1 < 0.8 || e2 < 0.8;
    L.set(i, gap ? r * 0.45 : r, gap ? g * 0.45 : g, gap ? b * 0.45 : b, gap ? 0 : 0.5 + grain * 0.3, 0.4 + at(F.n8, x, y) * 0.2);
  });
};
GEN.wood_panel = (L, F) => {
  const boards = 8;
  each((x, y, i) => {
    const bi = Math.floor(x / S * boards);
    const lx = fract(x / S * boards) * (S / boards);
    const pv = hashI(bi * 19 + 1);
    const grain = woodGrain(F, x, y, 'v');
    const [r, g, b] = woodColor([0.34, 0.19, 0.1], pv, grain, 0);
    const groove = lx < 1.5 || lx > S / boards - 1.5;
    L.set(i, groove ? r * 0.4 : r, groove ? g * 0.4 : g, groove ? b * 0.4 : b, groove ? 0 : 0.5 + grain * 0.25, 0.45 + at(F.n8, x, y) * 0.15);
  });
};
GEN.wood_raw = (L, F) => {
  each((x, y, i) => {
    const fib = at(F.n32, x, y * 8) * 0.5 + at(F.w, x, y * 3) * 0.3 + at(F.n64, x, y) * 0.2;
    const splinter = smooth(0.7, 0.9, at(F.n16, x, y * 16));
    const k = 0.85 + (fib - 0.5) * 0.4 - splinter * 0.25;
    L.set(i, 0.66 * k, 0.5 * k, 0.33 * k, fib * 0.8 + splinter * 0.5, 0.92);
  });
  L.normalStrength = 1.6;
};
GEN.wood_oak = (L, F) => {
  each((x, y, i) => {
    const grain = woodGrain(F, x, y, 'u');
    const pv = hashI(Math.floor(y / 64) * 5 + 9);
    const [r, g, b] = woodColor([0.58, 0.4, 0.22], pv, grain, 0);
    L.set(i, r, g, b, grain * 0.5, 0.5);
  });
  L.normalStrength = 0.6;
};
GEN.wood_dark = (L, F) => {
  each((x, y, i) => {
    const grain = woodGrain(F, x, y, 'u');
    const pv = hashI(Math.floor(y / 64) * 3 + 2);
    const [r, g, b] = woodColor([0.2, 0.12, 0.07], pv, grain, 0);
    L.set(i, r, g, b, grain * 0.5, 0.42);
  });
  L.normalStrength = 0.6;
};
GEN.lacquer = (L, F) => {
  each((x, y, i) => { const v = 0.84 + (at(F.n16, x, y) - 0.5) * 0.02; L.set(i, v, v, v, at(F.n64, x, y) * 0.1, 0.3); });
  L.normalStrength = 0.3;
};
GEN.door = (L, F) => {
  each((x, y, i) => {
    const grain = woodGrain(F, x, y, 'v');
    const [r, g, b] = woodColor([0.42, 0.26, 0.14], 0.5, grain, 0);
    L.set(i, r, g, b, grain * 0.4, 0.45);
  });
};
function tiles(L, F, n, grout, colorFn, rough, groutColor = 0.55, bevel = 3) {
  const cs = S / n;
  each((x, y, i) => {
    const tx = Math.floor(x / cs), ty = Math.floor(y / cs);
    const lx = x - tx * cs, ly = y - ty * cs;
    const e = Math.min(lx, cs - 1 - lx, ly, cs - 1 - ly);
    const id = tx * 131 + ty * 71;
    if (e < grout) {
      const gv = groutColor * (0.9 + at(F.w, x, y) * 0.15);
      L.set(i, gv, gv * 0.98, gv * 0.95, 0, 0.9);
    } else {
      const [r, g, b] = colorFn(tx, ty, x, y, id);
      const hb = Math.min(1, (e - grout) / bevel);
      L.set(i, r, g, b, 0.4 + hb * 0.6, rough + at(F.n16, x, y) * 0.08);
    }
  });
}
GEN.tile_checker = (L, F) => tiles(L, F, 4, 1.5, (tx, ty, x, y, id) => {
  const dark = (tx + ty) % 2 === 0;
  const v = (dark ? 0.045 : 0.78) * (0.95 + hashI(id) * 0.08) + (at(F.n16, x, y) - 0.5) * 0.03;
  return [v, v, v * (dark ? 1.05 : 0.98)];
}, 0.12);
GEN.tile_floor = (L, F) => tiles(L, F, 2, 2.5, (tx, ty, x, y, id) => {
  const m = at(F.n16, x, y) * 0.6 + at(F.n64, x, y) * 0.4;
  const k = 0.9 + hashI(id) * 0.1 + (m - 0.5) * 0.12;
  return [0.64 * k, 0.58 * k, 0.5 * k];
}, 0.4);
GEN.tile_wall = (L, F) => tiles(L, F, 8, 1.2, (tx, ty, x, y, id) => {
  const k = 0.92 + hashI(id) * 0.06;
  return [0.86 * k, 0.88 * k, 0.88 * k];
}, 0.1, 0.62, 5);
GEN.marble = (L, F) => {
  each((x, y, i) => {
    const t = at(F.n4, x, y) * 3 + at(F.n16, x, y) * 1.2;
    const vein = Math.pow(Math.abs(Math.sin((x / S * 2 + y / S * 1 + t) * Math.PI)), 0.25);
    const fine = Math.pow(Math.abs(Math.sin((x / S * 5 - y / S * 3 + at(F.n8, x, y) * 2) * Math.PI)), 0.12);
    const seam = (x === 0 || y === 0) ? 0.6 : 1;
    const v = (0.9 - (1 - vein) * 0.45 - (1 - fine) * 0.15) * seam;
    L.set(i, v, v * 0.99, v * 0.97, seam < 1 ? 0 : 0.5, 0.07 + (1 - vein) * 0.1);
  });
  L.normalStrength = 0.25; L.uvScale = 0.5;
};
GEN.carpet = (L, F) => {
  each((x, y, i) => {
    const fib = at(F.wb1, x, y) * 0.6 + at(F.w2, x, y) * 0.4;
    const v = 0.68 + (fib - 0.5) * 0.18 + (at(F.n8, x, y) - 0.5) * 0.08;
    L.set(i, v, v, v, fib, 1.0);
  });
  L.normalStrength = 1.2;
};
GEN.concrete = (L, F) => {
  each((x, y, i) => {
    const base = at(F.n4, x, y) * 0.5 + at(F.n16, x, y) * 0.3 + at(F.n64, x, y) * 0.2;
    const pore = at(F.w, x, y) > 0.992 ? 1 : 0;
    const stain = smooth(0.6, 0.85, at(F.n2, x, y)) * 0.2;
    const seam = y < 2 || (y > 126 && y < 129) ? 1 : 0; // juntas del encofrado cada metro
    const tie = [[64, 64], [192, 192]].some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 2.2) ? 1 : 0;
    const v = 0.5 + (base - 0.5) * 0.14 - stain - pore * 0.12 - seam * 0.06 - tie * 0.18;
    L.set(i, v, v * 1.0, v * 0.98, base * 0.5 - pore * 0.4 - seam * 0.3 - tie * 0.6, 0.82 + base * 0.1);
  });
  L.uvScale = 0.5;
};
GEN.concrete_floor = (L, F) => {
  each((x, y, i) => {
    const base = at(F.n8, x, y) * 0.5 + at(F.n32, x, y) * 0.5;
    const crackD = at(F.c6.f2, x + 50, y + 30) - at(F.c6.f1, x + 50, y + 30);
    const crack = (1 - smooth(0.0, 0.025, crackD)) * smooth(0.6, 0.75, at(F.n4, x, y));
    const v = 0.5 + (base - 0.5) * 0.08 + (at(F.n2, x, y) - 0.5) * 0.08 - crack * 0.25;
    L.set(i, v, v, v * 0.98, base * 0.2 - crack * 0.8, 0.55 + at(F.n4, x + 60, y) * 0.25);
  });
  L.uvScale = 0.5;
};
function bricks(L, F, opts) {
  const rows = 13, cols = 4, mortar = 2.2;
  const rh = S / rows, cw = S / cols;
  each((x, y, i) => {
    const row = Math.floor(y / rh);
    const off = (row % 2) * cw / 2;
    const xs = (x + off) % S;
    const col = Math.floor(xs / cw);
    const lx = xs - col * cw, ly = y - row * rh;
    const e = Math.min(lx, cw - lx, ly, rh - ly);
    const id = row * 17 + col * 5;
    const surf = at(F.n32, x, y) * 0.6 + at(F.w, x, y) * 0.4;
    if (e < mortar) {
      const m = opts.mortar * (0.9 + at(F.n64, x, y) * 0.2);
      L.set(i, m, m * 0.97, m * 0.9, -0.2 + surf * 0.1, 0.95);
    } else {
      const c = opts.color(hashI(id * 3 + 1), hashI(id * 7 + 2), x, y);
      const chip = smooth(0.78, 0.9, at(F.n16, x + id, y)) * (e < mortar + 3 ? 1 : 0.3);
      const k = 0.88 + (surf - 0.5) * 0.25 - chip * 0.2;
      L.set(i, c[0] * k, c[1] * k, c[2] * k, 0.55 + surf * 0.35 - chip * 0.5 + Math.min(1, (e - mortar) / 3) * 0.2, 0.85);
    }
  });
  L.normalStrength = 1.3;
}
GEN.brick = (L, F) => bricks(L, F, {
  mortar: 0.6,
  color: (h1, h2) => h2 < 0.15 ? [0.3, 0.13, 0.09] : h2 > 0.9 ? [0.56, 0.3, 0.17] : [0.46 + h1 * 0.1, 0.19 + h1 * 0.05, 0.13 + h1 * 0.03],
});
GEN.brick_old = (L, F) => bricks(L, F, {
  mortar: 0.5,
  color: (h1, h2, x, y) => {
    const soot = smooth(0.55, 0.8, at(F.n4, x, y)) * 0.5;
    const eff = smooth(0.7, 0.9, at(F.n8, x + 33, y)) * 0.25;
    const b = [0.38 + h1 * 0.1, 0.18 + h1 * 0.04, 0.13];
    return b.map((c) => c * (1 - soot) + eff);
  },
});
GEN.brick_core = (L, F) => {
  each((x, y, i) => {
    const g = at(F.n32, x, y) * 0.5 + at(F.w, x, y) * 0.5;
    const k = 0.85 + (g - 0.5) * 0.4;
    L.set(i, 0.6 * k, 0.3 * k, 0.19 * k, g, 0.96);
  });
  L.normalStrength = 1.6;
};
GEN.stone = (L, F) => {
  const c = F.c10;
  each((x, y, i) => {
    const d = c.f2[y * S + x] - c.f1[y * S + x];
    const id = c.id[y * S + x];
    const mortar = d < 0.06;
    const surf = at(F.n32, x, y) * 0.5 + at(F.n64, x, y) * 0.5;
    if (mortar) { const m = 0.42 + at(F.w, x, y) * 0.05; L.set(i, m, m * 0.98, m * 0.94, 0, 0.95); return; }
    const k = 0.75 + id * 0.35 + (surf - 0.5) * 0.2;
    const warm = hashI(Math.floor(id * 1000)) * 0.08;
    L.set(i, 0.5 * k + warm, 0.48 * k + warm * 0.6, 0.44 * k, Math.min(1, d * 6) * 0.6 + surf * 0.4, 0.85);
  });
  L.normalStrength = 1.4;
};
GEN.stucco = (L, F) => {
  each((x, y, i) => {
    const b = at(F.n64, x, y) * 0.5 + at(F.n32, x, y) * 0.3 + at(F.w, x, y) * 0.2;
    const k = 0.95 + (at(F.n4, x, y) - 0.5) * 0.1 - smooth(0.65, 0.9, at(F.n2, x, y)) * 0.12;
    L.set(i, 0.78 * k, 0.72 * k, 0.6 * k, b, 0.95);
  });
  L.normalStrength = 1.5; L.uvScale = 0.5;
};
GEN.siding = (L, F) => {
  const boards = 8;
  each((x, y, i) => {
    const ly = fract(y / S * boards);
    const grain = woodGrain(F, x, y, 'u') * 0.3;
    const shade = ly; // tabla solapada: sube de abajo arriba y cae
    const k = 0.9 + grain * 0.2 - (ly < 0.06 ? 0.35 : 0);
    const dirt = smooth(0.6, 0.85, at(F.n4, x, y)) * 0.08;
    L.set(i, 0.82 * k - dirt, 0.82 * k - dirt, 0.78 * k - dirt, shade * 0.8, 0.6);
  });
  L.normalStrength = 1.2;
};
GEN.garage_door = (L, F) => {
  const panels = 4;
  each((x, y, i) => {
    const ly = fract(y / S * panels);
    const rib = Math.abs(ly - 0.5) < 0.02 ? 1 : 0;
    const edge = ly < 0.03 ? 1 : 0;
    const v = 0.84 - edge * 0.3 - rib * 0.12 + (at(F.n8, x, y) - 0.5) * 0.04;
    L.set(i, v, v, v * 0.99, edge ? 0 : 0.5 + (rib ? 0.3 : 0), 0.45);
  });
};
GEN.steel_plate = (L, F) => {
  // refuerzo: acero cepillado con nervios verticales cada 25 cm y remaches
  each((x, y, i) => {
    const brush = at(F.n16, x * 8, y) * 0.5 + at(F.w, x * 4, y) * 0.5;
    const lx = x % 64;
    const rib = Math.max(0, 1 - Math.abs(lx - 32) / 5);
    const rivet = (Math.hypot(lx - 32, (y % 64) - 32) < 3.5) ? 1 : 0;
    const frame = (y % 128) < 4 ? 1 : 0;
    const scratch = smooth(0.93, 0.97, at(F.n16, x, y * 12)) * 0.4;
    const weather = smooth(0.55, 0.85, at(F.n4, x, y)) * 0.15;
    const v = 0.56 + (brush - 0.5) * 0.08 + scratch * 0.2 - weather - frame * 0.08;
    L.set(i, v * 0.97, v, v * 1.03, rib * 0.7 + rivet * 1.0 - frame * 0.3, 0.33 + brush * 0.12 + weather * 0.8 - scratch * 0.1, 1);
  });
  L.normalStrength = 1.3;
};
GEN.metal_dark = (L, F) => {
  each((x, y, i) => {
    const chip = smooth(0.82, 0.9, at(F.n16, x, y)) * smooth(0.5, 0.7, at(F.n4, x, y));
    const v = 0.1 + chip * 0.35 + (at(F.n32, x, y) - 0.5) * 0.02;
    L.set(i, v, v, v * 1.05, at(F.n64, x, y) * 0.2 - chip * 0.2, 0.5 - chip * 0.15, 0.2 + chip * 0.8);
  });
};
GEN.metal_sheet = (L, F) => {
  const c = F.c24;
  each((x, y, i) => {
    const sp = c.id[y * S + x];
    const v = 0.66 + (sp - 0.5) * 0.08 + (at(F.n8, x, y) - 0.5) * 0.04;
    L.set(i, v, v * 1.01, v * 1.03, sp * 0.1, 0.32 + sp * 0.12, 1);
  });
};
GEN.hatch = (L, F) => {
  each((x, y, i) => {
    const ly = fract(y / S * 4);
    const grain = woodGrain(F, x, y, 'u');
    const [r, g, b] = woodColor([0.32, 0.2, 0.11], hashI(Math.floor(y / 64) * 3), grain, 0);
    const gap = ly < 0.015 || ly > 0.985;
    const strap = (x > 38 && x < 58) || (x > 198 && x < 218);
    if (strap) { const v = 0.16 + at(F.n32, x, y) * 0.05; L.set(i, v, v, v, 0.7, 0.45, 0.7); return; }
    L.set(i, gap ? r * 0.3 : r, gap ? g * 0.3 : g, gap ? b * 0.3 : b, gap ? 0 : 0.45 + grain * 0.2, 0.6);
  });
};
GEN.barricade = (L, F) => {
  const boards = 5;
  each((x, y, i) => {
    const bi = Math.floor(y / S * boards);
    const ly = fract(y / S * boards);
    const grain = woodGrain(F, x + bi * 40, y, 'u');
    const pv = hashI(bi * 11 + 4);
    const [r, g, b] = woodColor([0.64, 0.48, 0.3], pv, grain, 0);
    const gap = ly < 0.05;
    const nail = (Math.hypot(((x + 14) % 128) - 14, (ly - 0.5) * (S / boards)) < 2.2) ? 1 : 0;
    if (nail) { L.set(i, 0.2, 0.2, 0.21, 0.9, 0.4, 0.9); return; }
    L.set(i, gap ? 0.05 : r, gap ? 0.04 : g, gap ? 0.03 : b, gap ? 0 : 0.5 + grain * 0.4, 0.85);
  });
  L.normalStrength = 1.2;
};
GEN.glass = (L, F) => {
  each((x, y, i) => {
    const sm = smooth(0.6, 0.9, at(F.n8, x, y)) * 0.15;
    L.set(i, 0.82 + sm, 0.9 + sm, 0.93 + sm, 0, 0.04 + sm * 0.6);
  });
  L.normalStrength = 0.1;
};
GEN.trim = (L, F) => {
  each((x, y, i) => { const v = 0.86 + (woodGrain(F, x, y, 'u') - 0.5) * 0.03; L.set(i, v, v, v * 0.98, woodGrain(F, x, y, 'u') * 0.1, 0.38); });
  L.normalStrength = 0.4;
};
GEN.fabric = (L, F) => {
  each((x, y, i) => {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.08 : -0.08;
    const v = 0.68 + weave * 0.4 + (at(F.n16, x, y) - 0.5) * 0.08 + (at(F.w, x, y) - 0.5) * 0.06;
    L.set(i, v, v, v, 0.5 + weave * 2, 1.0);
  });
  L.normalStrength = 0.9;
};
GEN.bedsheet = (L, F) => {
  each((x, y, i) => {
    const fold = at(F.n4, x, y) * 0.7 + at(F.n8, x, y) * 0.3;
    const v = 0.86 + (fold - 0.5) * 0.06;
    L.set(i, v * 0.97, v * 0.98, v, fold, 0.9);
  });
  L.normalStrength = 1.6;
};
GEN.foam = (L, F) => {
  each((x, y, i) => { const p = at(F.w, x, y) * 0.6 + at(F.n64, x, y) * 0.4; L.set(i, 0.86 * (0.9 + p * 0.1), 0.76 * (0.9 + p * 0.1), 0.46, p, 1.0); });
  L.normalStrength = 1.5;
};
GEN.books = (L, F) => {
  const rows = 4, rh = S / rows;
  const pal = [[0.35, 0.08, 0.07], [0.08, 0.16, 0.32], [0.1, 0.25, 0.12], [0.36, 0.24, 0.12], [0.05, 0.05, 0.06], [0.55, 0.45, 0.28], [0.4, 0.3, 0.35], [0.6, 0.55, 0.45]];
  // precálculo de libros por fila
  const shelf = [];
  for (let r = 0; r < rows; r++) {
    const list = []; let x = 0, k = 0;
    while (x < S) { const w = 5 + Math.floor(hashI(r * 97 + k * 13) * 9); const h = 0.62 + hashI(r * 31 + k * 7) * 0.3; list.push({ x0: x, x1: Math.min(S, x + w), h, c: pal[Math.floor(hashI(r * 53 + k * 19) * pal.length)], band: hashI(k * 3 + r) }); x += w; k++; }
    shelf.push(list);
  }
  each((x, y, i) => {
    const r = Math.floor(y / rh), ly = (y - r * rh) / rh;
    if (ly < 0.1) { const v = 0.2; L.set(i, v * 1.1, v * 0.7, v * 0.45, 0.9, 0.5); return; }
    const bk = shelf[r].find((b) => x >= b.x0 && x < b.x1);
    const by = (ly - 0.1) / 0.9;
    if (!bk || by > bk.h) { L.set(i, 0.03, 0.025, 0.02, 0, 0.9); return; }
    const edge = x === bk.x0 || x === bk.x1 - 1;
    const band = Math.abs(by - 0.2 - bk.band * 0.5) < 0.03 ? 0.25 : 0;
    const k = (edge ? 0.6 : 1) * (0.9 + at(F.n32, x, y) * 0.15);
    L.set(i, bk.c[0] * k + band, bk.c[1] * k + band * 0.8, bk.c[2] * k + band * 0.4, edge ? 0.3 : 0.7, 0.65);
  });
};
GEN.granite = (L, F) => {
  each((x, y, i) => {
    const s = at(F.w, x, y);
    const sp = s > 0.92 ? 0.55 : s > 0.8 ? 0.28 : 0.1;
    const v = sp + (at(F.n32, x, y) - 0.5) * 0.04;
    L.set(i, v, v, v * 1.02, 0.5, 0.18);
  });
  L.normalStrength = 0.2;
};
GEN.enamel = (L, F) => {
  each((x, y, i) => { const v = 0.86 + (at(F.n8, x, y) - 0.5) * 0.02; L.set(i, v, v, v * 1.01, 0.5, 0.18); });
  L.normalStrength = 0.1;
};
GEN.crate = (L, F) => {
  each((x, y, i) => {
    const bi = Math.floor(y / 64), ly = y % 64;
    const grain = woodGrain(F, x, y, 'u');
    const [r, g, b] = woodColor([0.6, 0.45, 0.27], hashI(bi * 7), grain, 0);
    const gap = ly < 1.2;
    L.set(i, gap ? r * 0.3 : r, gap ? g * 0.3 : g, gap ? b * 0.3 : b, gap ? 0 : 0.5 + grain * 0.3, 0.85);
  });
};
GEN.barrel = (L, F) => {
  each((x, y, i) => {
    const st = Math.floor(x / S * 10), lx = fract(x / S * 10);
    const grain = woodGrain(F, x, y, 'v');
    const [r, g, b] = woodColor([0.42, 0.24, 0.12], hashI(st * 5), grain, 0);
    const v = y / S;
    const hoop = (v > 0.1 && v < 0.17) || (v > 0.83 && v < 0.9);
    if (hoop) { const m = 0.12 + at(F.n32, x, y) * 0.06; L.set(i, m, m * 0.95, m * 0.9, 0.9, 0.55, 0.8); return; }
    const gap = lx < 0.04;
    L.set(i, gap ? r * 0.4 : r, gap ? g * 0.4 : g, gap ? b * 0.4 : b, gap ? 0.1 : 0.5 + grain * 0.2, 0.65);
  });
};
GEN.lamp = (L, F) => {
  each((x, y, i) => { const v = 0.95 + at(F.n16, x, y) * 0.05; L.set(i, v, v * 0.97, v * 0.9, 0.5, 0.3); });
  L.emissive = 1; L.normalStrength = 0.1;
};
GEN.screen = (L, F) => {
  // emisivo tipo 3 (pantalla)
  each((x, y, i) => {
    const line = (y % 6) < 2 ? 1 : 0;
    const txt = at(F.w, x >> 2, y >> 1) > 0.55 && ((y >> 3) % 3 !== 0) ? 1 : 0;
    const blk = at(F.n8, x, y) > 0.62 ? 1 : 0;
    const e = txt * 0.6 * line + blk * 0.25;
    L.set(i, 0.02 + e * 0.2, 0.03 + e * 0.55, 0.04 + e * 0.75, 0.5, 0.15);
  });
  L.emissive = 3; L.normalStrength = 0;
};
GEN.leaves = (L, F) => {
  each((x, y, i) => {
    const cl = at(F.n16, x, y) * 0.6 + at(F.n64, x, y) * 0.25 + at(F.w, x, y) * 0.15;
    const a = cl > 0.44 ? 1 : 0;
    const k = 0.7 + at(F.n8, x, y) * 0.5 + (at(F.w2, x, y) - 0.5) * 0.3;
    L.set(i, 0.1 * k, 0.24 * k, 0.07 * k, cl, 0.8);
    L.alpha[i] = a;
  });
  L.cutout = 1;
};
GEN.bark = (L, F) => {
  each((x, y, i) => {
    const f = at(F.n16, x * 8, y) * 0.6 + at(F.n32, x * 4, y * 2) * 0.4;
    const fissure = smooth(0.55, 0.3, f);
    const k = 0.8 + f * 0.4 - fissure * 0.4;
    L.set(i, 0.27 * k, 0.2 * k, 0.14 * k, f - fissure * 0.5, 0.95);
  });
  L.normalStrength = 1.8;
};
GEN.wood_rings = (L, F) => {
  each((x, y, i) => {
    const d = Math.hypot(x - 128, y - 128) / 128 + at(F.n8, x, y) * 0.08;
    const ring = Math.abs(Math.sin(d * 40)) * 0.2;
    L.set(i, 0.55 - ring, 0.4 - ring * 0.8, 0.25 - ring * 0.6, ring, 0.8);
  });
};
GEN.fence = (L, F) => {
  each((x, y, i) => {
    const grain = woodGrain(F, x, y, 'v');
    const weather = at(F.n8, x, y);
    const k = 0.8 + grain * 0.3;
    L.set(i, 0.5 * k + weather * 0.05, 0.43 * k + weather * 0.05, 0.34 * k + weather * 0.06, grain * 0.6, 0.9);
  });
};
GEN.car_paint = (L, F) => {
  each((x, y, i) => {
    const flake = at(F.w, x, y) > 0.97 ? 0.08 : 0;
    const v = 0.8 + flake + (at(F.n16, x, y) - 0.5) * 0.02;
    L.set(i, v, v, v, 0.5, 0.22, 0.25);
  });
  L.normalStrength = 0.1;
};
GEN.rubber = (L, F) => {
  each((x, y, i) => { const tread = (y % 24) < 6 ? 1 : 0; const v = 0.05 + tread * 0.02 + at(F.n32, x, y) * 0.02; L.set(i, v, v, v, tread ? 0 : 0.6, 0.9); });
};
GEN.ladder = (L, F) => {
  each((x, y, i) => {
    const u = x / S, v = y / S;
    const rail = (u > 0.06 && u < 0.14) || (u > 0.86 && u < 0.94);
    const rung = (fract(v * 4) < 0.07) && u > 0.06 && u < 0.94;
    const m = 0.2 + at(F.n32, x, y) * 0.08;
    L.set(i, m, m, m * 1.05, (rail || rung) ? 0.8 : 0, 0.5, 0.8);
    L.alpha[i] = rail || rung ? 1 : 0;
  });
  L.cutout = 1;
};
GEN.sandbag = (L, F) => {
  each((x, y, i) => {
    const row = Math.floor(y / 64), off = (row % 2) * 64;
    const lx = ((x + off) % 128) / 128, ly = (y % 64) / 64;
    const bag = Math.max(0, 1 - Math.pow(Math.abs(lx - 0.5) * 2, 4) - Math.pow(Math.abs(ly - 0.5) * 2, 4));
    const weave = ((x + y) % 3 === 0) ? 0.05 : 0;
    const k = 0.75 + bag * 0.3 + weave;
    L.set(i, 0.55 * k, 0.48 * k, 0.33 * k, bag, 1.0);
  });
  L.normalStrength = 1.4;
};
GEN.grass = (L, F) => {
  each((x, y, i) => {
    const blade = at(F.w, x, y) * 0.5 + at(F.wb1, x, y) * 0.5;
    const dry = smooth(0.6, 0.85, at(F.n4, x, y));
    const clump = at(F.n16, x, y);
    const k = 0.7 + blade * 0.5 + (clump - 0.5) * 0.3;
    const r = (0.13 + dry * 0.18) * k, g = (0.27 + dry * 0.05) * k, b = (0.07 + dry * 0.02) * k;
    L.set(i, r, g, b, blade * 0.7 + clump * 0.3, 0.95);
  });
  L.normalStrength = 1.3; L.uvScale = 0.5;
};
GEN.dirt = (L, F) => {
  const c = F.c24;
  each((x, y, i) => {
    const peb = 1 - smooth(0.0, 0.25, c.f1[y * S + x]);
    const k = 0.75 + at(F.n16, x, y) * 0.35 + peb * 0.2 * c.id[y * S + x];
    L.set(i, 0.34 * k, 0.25 * k, 0.17 * k, at(F.n32, x, y) * 0.5 + peb * 0.5, 0.98);
  });
  L.normalStrength = 1.4; L.uvScale = 0.5;
};
GEN.asphalt = (L, F) => {
  each((x, y, i) => {
    const s = at(F.w, x, y);
    const agg = s > 0.93 ? 0.16 : s > 0.8 ? 0.06 : 0;
    const patch = smooth(0.62, 0.7, at(F.n2, x, y)) * 0.03;
    const v = 0.09 + agg + (at(F.n16, x, y) - 0.5) * 0.03 - patch;
    L.set(i, v, v, v * 1.05, s * 0.6, 0.88 - agg);
  });
  L.normalStrength = 0.8; L.uvScale = 0.5;
};
GEN.sidewalk = (L, F) => {
  each((x, y, i) => {
    const e = Math.min(x, S - 1 - x, y, S - 1 - y);
    const v = (0.6 + (at(F.n8, x, y) - 0.5) * 0.06 + (at(F.w, x, y) - 0.5) * 0.04) * (e < 2 ? 0.6 : 1);
    L.set(i, v, v * 0.99, v * 0.96, e < 2 ? 0 : 0.4 + at(F.n32, x, y) * 0.3, 0.82);
  });
};
GEN.gravel = (L, F) => {
  const c = F.c24;
  each((x, y, i) => {
    const d = c.f1[y * S + x], id = c.id[y * S + x];
    const peb = 1 - smooth(0.25, 0.55, d);
    const k = 0.6 + id * 0.5;
    L.set(i, 0.5 * k * (0.6 + peb * 0.5), 0.47 * k * (0.6 + peb * 0.5), 0.42 * k * (0.6 + peb * 0.5), peb, 0.9);
  });
  L.normalStrength = 1.6;
};
GEN.roof = (L, F) => {
  each((x, y, i) => {
    const s = at(F.w, x, y);
    const g = s > 0.9 ? 0.18 : 0;
    const v = 0.14 + g + (at(F.n8, x, y) - 0.5) * 0.04;
    L.set(i, v, v, v * 1.03, s * 0.5 + at(F.n32, x, y) * 0.3, 0.95);
  });
  L.normalStrength = 1.0; L.uvScale = 0.5;
};

export const TEXTURE_NAMES = Object.keys(GEN);

// Colores de tinte (lineales) para pinturas, papeles, moquetas y coches.
export const TINTS = {
  white: [1, 1, 1],
  paint_white: [0.95, 0.94, 0.9],
  paint_cream: [1.0, 0.9, 0.72],
  paint_sage: [0.62, 0.72, 0.58],
  paint_blue: [0.55, 0.68, 0.82],
  paint_grey: [0.7, 0.7, 0.7],
  wp_red: [0.62, 0.16, 0.14],
  wp_green: [0.36, 0.5, 0.36],
  wp_blue: [0.52, 0.66, 0.9],
  wp_gold: [0.9, 0.72, 0.38],
  carpet_red: [0.55, 0.12, 0.12],
  carpet_blue: [0.2, 0.28, 0.5],
  carpet_grey: [0.5, 0.5, 0.52],
  fabric_grey: [0.52, 0.54, 0.56],
  fabric_green: [0.3, 0.44, 0.34],
  car_red: [0.6, 0.05, 0.04],
  car_blue: [0.06, 0.14, 0.4],
  lamp_warm: [1.0, 0.74, 0.46],
  lamp_cool: [0.82, 0.93, 1.0],
};
export const TINT_NAMES = Object.keys(TINTS);

const toSRGB = (c) => {
  c = clamp01(c);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};

/**
 * Genera todas las capas. Devuelve {albedo: Uint8Array, normal: Uint8Array, layers: [{name, uvScale, normalStrength, emissive, cutout}], avg: {name: [r,g,b]}}
 * onProgress(frac) opcional.
 */
export function generateTextures(onProgress) {
  const it = textureIterator();
  let r;
  while (!(r = it.next()).done) if (onProgress) onProgress(r.value);
  return r.value;
}

/** Versión asíncrona: cede el hilo entre capas para que la pantalla de carga respire. */
export async function generateTexturesAsync(onProgress) {
  const it = textureIterator();
  let r, last = performance.now();
  while (!(r = it.next()).done) {
    if (onProgress) onProgress(r.value);
    if (performance.now() - last > 30) { await new Promise((res) => setTimeout(res, 0)); last = performance.now(); }
  }
  return r.value;
}

function* textureIterator() {
  yield 0;
  const F = fields();
  const names = TEXTURE_NAMES;
  const L = names.length;
  const albedo = new Uint8Array(N * 4 * L);
  const normal = new Uint8Array(N * 4 * L);
  const layers = [];
  const avg = {};
  const lut = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) lut[i] = Math.round(toSRGB(i / 4095) * 255);
  for (let li = 0; li < L; li++) {
    const name = names[li];
    yield li / L;
    const layer = new Layer(name);
    GEN[name](layer, F);
    const off = li * N * 4;
    let ar = 0, ag = 0, ab = 0;
    const ns = 3.0; // pendiente de la altura → normal
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const o = off + i * 4;
      const r = clamp01(layer.r[i]), g = clamp01(layer.g[i]), b = clamp01(layer.b[i]);
      ar += r; ag += g; ab += b;
      albedo[o] = lut[(r * 4095) | 0]; albedo[o + 1] = lut[(g * 4095) | 0]; albedo[o + 2] = lut[(b * 4095) | 0];
      albedo[o + 3] = Math.round(clamp01(layer.rough[i]) * 255);
      const hx = layer.h[y * S + ((x + 1) & M)] - layer.h[y * S + ((x - 1) & M)];
      const hy = layer.h[((y + 1) & M) * S + x] - layer.h[((y - 1) & M) * S + x];
      let nx = -hx * ns, ny = -hy * ns, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv;
      // cavidad: más oscura en los valles respecto a la media local
      const hc = layer.h[i];
      const hn = (layer.h[y * S + ((x + 2) & M)] + layer.h[y * S + ((x - 2) & M)] + layer.h[((y + 2) & M) * S + x] + layer.h[((y - 2) & M) * S + x]) * 0.25;
      const cav = clamp01(1 - Math.max(0, hn - hc) * 2.2);
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(cav * 255);
      normal[o + 3] = Math.round(clamp01(layer.cutout ? layer.alpha[i] : layer.metal[i]) * 255);
    }
    avg[name] = [ar / N, ag / N, ab / N];
    layers.push({ name, uvScale: layer.uvScale, normalStrength: layer.normalStrength, emissive: layer.emissive, cutout: layer.cutout });
  }
  return { albedo, normal, layers, avg, size: S };
}

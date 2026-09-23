// Mallado voraz (greedy) de una celda de 16³ vóxeles con oclusión ambiental por
// vértice. No depende de Three.js: devuelve arrays tipados listos para subir.
//
// Formato de vértice (8 bytes):
//   position Uint8×4: x, y, z (vóxeles locales 0..16), cara (0 +x,1 -x,2 +y,3 -y,4 +z,5 -z)
//   aData    Uint8×4: capa de textura, AO (0..3), índice de tinte, flags (bit0 cara rota, bit1 diagonal girada)
//
// Una cara es "rota" si en el mapa original estaba tapada por un vóxel opaco:
// se texturiza con el núcleo del material (yeso, madera astillada, ladrillo…).
import { MATS, OPAQUE, PASS } from '../world/materials.js';
import { MC } from '../world/voxelworld.js';

const N = MC;                 // 16
const P = N + 2;              // lado con borde (18)
const P2 = P * P;
const MAXQ = 16384;           // quads máximos por celda y pasada

// tablas por material (se rellenan con setMaterialLayers)
const LAYER_SIDE = new Uint8Array(256), LAYER_TOP = new Uint8Array(256), LAYER_BOTTOM = new Uint8Array(256), LAYER_EDGE = new Uint8Array(256);
const TINT = new Uint8Array(256);

export function setMaterialLayers(layerIndex, tintIndex) {
  for (const m of MATS) {
    if (!m.surf) continue;
    LAYER_SIDE[m.id] = layerIndex(m.surf);
    LAYER_TOP[m.id] = layerIndex(m.top);
    LAYER_BOTTOM[m.id] = layerIndex(m.bottom);
    LAYER_EDGE[m.id] = layerIndex(m.edge);
    TINT[m.id] = tintIndex(m.tint);
  }
}

// buffers de trabajo reutilizados
const vox = new Uint8Array(P * P * P);
const pris = new Uint8Array(P * P * P);
const mask = new Int32Array(N * N);
const maskFlags = new Uint8Array(N * N);
const solidCount = [new Uint16Array(P), new Uint16Array(P), new Uint16Array(P)];   // vóxeles no-aire por capa y eje
const opaqueCount = [new Uint16Array(P), new Uint16Array(P), new Uint16Array(P)];  // opacos en el interior 16×16
function makeOut() { return { pos: new Uint8Array(MAXQ * 16), dat: new Uint8Array(MAXQ * 16), quads: 0 }; }
const OUT_SOLID = makeOut();
const OUT_GLASS = makeOut();
const OUT_CUT = makeOut();   // hojas, escaleras de mano: con descarte por alfa, en su propia pasada

function fillPadded(world, mx, my, mz) {
  const x0 = mx * N - 1, y0 = my * N - 1, z0 = mz * N - 1;
  const cx = mx >> 1, cy = my >> 1, cz = mz >> 1;   // chunk de almacenamiento (32 = 2×16)
  const ci = world.chunkIndex(cx, cy, cz);
  const c = world.chunks[ci];
  const p = world.pristine ? world.pristine[ci] : c;
  const def = world.defaultMat(cy);
  const ox = (mx & 1) * N, oy = (my & 1) * N, oz = (mz & 1) * N;
  for (let ly = 0; ly < N; ly++)
    for (let lz = 0; lz < N; lz++) {
      const src = ((ly + oy) << 10) | ((lz + oz) << 5) | ox;
      const dst = ((ly + 1) * P + (lz + 1)) * P + 1;
      if (c) vox.set(c.subarray(src, src + N), dst); else vox.fill(def, dst, dst + N);
      if (p) pris.set(p.subarray(src, src + N), dst); else pris.fill(def, dst, dst + N);
    }
  // borde
  for (let py = 0; py < P; py++)
    for (let pz = 0; pz < P; pz++) {
      const inner = py > 0 && py < P - 1 && pz > 0 && pz < P - 1;
      for (let px = 0; px < P; px++) {
        if (inner && px > 0 && px < P - 1) { px = P - 2; continue; }
        const i = (py * P + pz) * P + px;
        vox[i] = world.get(x0 + px, y0 + py, z0 + pz);
        pris[i] = world.getPristine(x0 + px, y0 + py, z0 + pz);
      }
    }
  // recuentos por capa
  for (let a = 0; a < 3; a++) { solidCount[a].fill(0); opaqueCount[a].fill(0); }
  for (let y = 0; y < P; y++)
    for (let z = 0; z < P; z++) {
      const row = (y * P + z) * P;
      for (let x = 0; x < P; x++) {
        const m = vox[row + x];
        if (m === 0) continue;
        solidCount[0][x]++; solidCount[1][y]++; solidCount[2][z]++;
        if (OPAQUE[m] && x > 0 && x < P - 1 && y > 0 && y < P - 1 && z > 0 && z < P - 1) { opaqueCount[0][x]++; opaqueCount[1][y]++; opaqueCount[2][z]++; }
      }
    }
}

const STRIDE = [1, P2, P]; // x, y, z  (índice = (y*P + z)*P + x)
const ORDER_POS = [0, 1, 2, 3], ORDER_NEG = [0, 3, 2, 1];
const CU = [0, 1, 1, 0], CV = [0, 0, 1, 1];
const FULL = N * N;

function emitQuad(out, d, s, slice, u0, v0, w, h, key, ao, flip) {
  if (out.quads >= MAXQ) return;
  const q = out.quads++;
  const layer = key & 255, tint = (key >>> 8) & 255, flags = (key >>> 24) & 1;
  const u = (d + 1) % 3, v = (d + 2) % 3;
  const plane = slice + (s > 0 ? 1 : 0);
  const face = d * 2 + (s > 0 ? 0 : 1);
  const order = s > 0 ? ORDER_POS : ORDER_NEG;
  const pb = q * 16;
  const pos = out.pos, dat = out.dat;
  for (let k = 0; k < 4; k++) {
    const c = order[k];
    const o = pb + k * 4;
    pos[o + d] = plane; pos[o + u] = u0 + CU[c] * w; pos[o + v] = v0 + CV[c] * h; pos[o + 3] = face;
    dat[o] = layer; dat[o + 1] = (ao >> (c * 2)) & 3; dat[o + 2] = tint; dat[o + 3] = flags | (flip ? 2 : 0);
  }
}

/**
 * Malla la celda (mx,my,mz). Devuelve {solid, glass} (cada uno null o {pos,dat,vertexCount,quads}) o null si no hay caras.
 */
export function meshCell(world, mx, my, mz) {
  fillPadded(world, mx, my, mz);
  OUT_SOLID.quads = 0; OUT_GLASS.quads = 0; OUT_CUT.quads = 0;
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const sd = STRIDE[d], su = STRIDE[u], sv = STRIDE[v];
    const sc = solidCount[d], oc = opaqueCount[d];
    for (let s = -1; s <= 1; s += 2) {
      const face = d * 2 + (s > 0 ? 0 : 1);
      for (let slice = 0; slice < N; slice++) {
        const layerIdx = slice + 1;
        if (sc[layerIdx] === 0) continue;                                   // capa vacía
        if (oc[layerIdx] === FULL && oc[layerIdx + s] === FULL) continue;   // maciza contra maciza
        let any = false;
        for (let j = 0; j < N; j++) {
          const rowBase = layerIdx * sd + (j + 1) * sv + su;
          for (let i = 0; i < N; i++) {
            const pi = rowBase + i * su;
            const a = vox[pi];
            const mi = j * N + i;
            if (a === 0) { mask[mi] = 0; continue; }
            const qi = pi + s * sd;
            const b = vox[qi];
            if (b !== 0 && (OPAQUE[b] || b === a)) { mask[mi] = 0; continue; }
            const o1 = OPAQUE[vox[qi - su]], o2 = OPAQUE[vox[qi + su]];
            const o3 = OPAQUE[vox[qi - sv]], o4 = OPAQUE[vox[qi + sv]];
            const a0 = o1 && o3 ? 0 : 3 - (o1 + o3 + OPAQUE[vox[qi - su - sv]]);
            const a1 = o2 && o3 ? 0 : 3 - (o2 + o3 + OPAQUE[vox[qi + su - sv]]);
            const a2 = o2 && o4 ? 0 : 3 - (o2 + o4 + OPAQUE[vox[qi + su + sv]]);
            const a3 = o1 && o4 ? 0 : 3 - (o1 + o4 + OPAQUE[vox[qi - su + sv]]);
            const broken = OPAQUE[pris[qi]] && !OPAQUE[b] ? 1 : 0;
            const layer = broken ? LAYER_EDGE[a] : face === 2 ? LAYER_TOP[a] : face === 3 ? LAYER_BOTTOM[a] : LAYER_SIDE[a];
            const tint = broken ? 0 : TINT[a];
            const ao = a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
            const pass = PASS[a];   // 0 opaco, 1 recorte, 2 translúcido
            mask[mi] = 1 + (layer | (tint << 8) | (ao << 16) | (broken << 24) | (pass << 25));
            maskFlags[mi] = (a0 === a1 && a3 === a2 ? 1 : 0) | (a0 === a3 && a1 === a2 ? 2 : 0);
            any = true;
          }
        }
        if (!any) continue;
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N;) {
            const mi = j * N + i;
            const key = mask[mi];
            if (key === 0) { i++; continue; }
            const fl = maskFlags[mi];
            let w = 1;
            if (fl & 1) while (i + w < N && mask[mi + w] === key && (maskFlags[mi + w] & 1)) w++;
            let h = 1;
            if (fl & 2) {
              outer: while (j + h < N) {
                const row = (j + h) * N + i;
                for (let k = 0; k < w; k++) if (mask[row + k] !== key || !(maskFlags[row + k] & 2)) break outer;
                h++;
              }
            }
            const k0 = key - 1;
            const ao = (k0 >>> 16) & 255;
            const flip = (ao & 3) + ((ao >> 4) & 3) < ((ao >> 2) & 3) + ((ao >> 6) & 3);
            const ps = (k0 >>> 25) & 3;
            emitQuad(ps === 2 ? OUT_GLASS : ps === 1 ? OUT_CUT : OUT_SOLID, d, s, slice, i, j, w, h, k0, ao, flip);
            for (let y = 0; y < h; y++) { const r = (j + y) * N + i; for (let x = 0; x < w; x++) mask[r + x] = 0; }
            i += w;
          }
        }
      }
    }
  }
  if (OUT_SOLID.quads === 0 && OUT_GLASS.quads === 0 && OUT_CUT.quads === 0) return null;
  return { solid: pack(OUT_SOLID), glass: pack(OUT_GLASS), cutout: pack(OUT_CUT) };
}

function pack(out) {
  const n = out.quads;
  if (n === 0) return null;
  const vc = n * 4;
  return { pos: out.pos.slice(0, vc * 4), dat: out.dat.slice(0, vc * 4), vertexCount: vc, quads: n };
}

/** Índices de n quads (con la diagonal elegida por quad según flags) a partir del vértice base. */
export function writeQuadIndices(idx, io, dat, vbase, quads) {
  for (let q = 0; q < quads; q++) {
    const b = vbase + q * 4, o = io + q * 6;
    if (!(dat[q * 16 + 3] & 2)) { idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    else { idx[o] = b + 1; idx[o + 1] = b + 2; idx[o + 2] = b + 3; idx[o + 3] = b + 1; idx[o + 4] = b + 3; idx[o + 5] = b; }
  }
}

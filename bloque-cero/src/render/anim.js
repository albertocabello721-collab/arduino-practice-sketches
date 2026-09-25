// Animación por poses clave (Fase 7). Una pista es una lista de claves [t, valor, curva]: t en
// segundos, valor un número, un vector [x, y, z] o un texto (un estado, que no se interpola),
// y la curva con la que se llega a esa clave desde la anterior. Un clip es un objeto de pistas
// con nombre. Las capas (una acción encima de la pose de base) entran y salen en BLEND s.
export const BLEND = 0.15;

export const EASE = {
  lin: (t) => t,
  io: (t) => t * t * (3 - 2 * t),             // arranca y llega suave
  in: (t) => t * t,                           // arranca lento
  out: (t) => 1 - (1 - t) * (1 - t),          // llega frenando
  snap: (t) => 1 - (1 - t) ** 4,              // golpe seco
};

function put(v, out) {
  if (typeof v !== 'object') return v;
  const o = out || [0, 0, 0];
  o[0] = v[0]; o[1] = v[1]; o[2] = v[2];
  return o;
}

/** Valor de la pista `tr` en el instante `t` (los vectores se escriben en `out`, si se da). */
export function sampleTrack(tr, t, out) {
  if (!tr || !tr.length) return undefined;
  if (t <= tr[0][0]) return put(tr[0][1], out);
  for (let i = 1; i < tr.length; i++) {
    const b = tr[i];
    if (t >= b[0]) continue;
    const a = tr[i - 1];
    if (typeof b[1] === 'string') return a[1];
    const k = (EASE[b[2]] || EASE.io)((t - a[0]) / (b[0] - a[0]));
    if (typeof b[1] === 'number') return a[1] + (b[1] - a[1]) * k;
    const o = out || [0, 0, 0];
    for (let j = 0; j < 3; j++) o[j] = a[1][j] + (b[1][j] - a[1][j]) * k;
    return o;
  }
  return put(tr[tr.length - 1][1], out);
}

/** Muestrea todas las pistas del clip en `pose` (reutiliza sus vectores). */
export function sampleClip(clip, t, pose) {
  for (const name in clip) {
    const cur = pose[name];
    pose[name] = sampleTrack(clip[name], t, Array.isArray(cur) ? cur : undefined);
  }
  return pose;
}

/** Para escribir clips: claves en cualquier orden; build() las ordena por tiempo. */
export class ClipBuilder {
  constructor() { this.tracks = {}; }
  key(name, t, v, ease = 'io') { (this.tracks[name] || (this.tracks[name] = [])).push([t, v, ease]); return this; }
  build() {
    for (const tr of Object.values(this.tracks)) {
      tr.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < tr.length; i++) if (tr[i][0] <= tr[i - 1][0]) tr[i][0] = tr[i - 1][0] + 1e-4;
    }
    return this.tracks;
  }
}

export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

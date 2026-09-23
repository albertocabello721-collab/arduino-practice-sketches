// Generador pseudoaleatorio con semilla (mulberry32): mismas semillas, mismas partidas.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1234) { this.seed(seed); }
  seed(s) { this._f = mulberry32(s >>> 0); return this; }
  next() { return this._f(); }
  range(a, b) { return a + (b - a) * this._f(); }
  int(a, b) { return a + Math.floor(this._f() * (b - a + 1)); }
  chance(p) { return this._f() < p; }
  pick(arr) { return arr[Math.floor(this._f() * arr.length)]; }
  sign() { return this._f() < 0.5 ? -1 : 1; }
  gauss() { // Box-Muller aproximado
    let u = 0, v = 0;
    while (u === 0) u = this._f();
    while (v === 0) v = this._f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._f() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}

// Hash entero rápido para ruido determinista por coordenada.
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

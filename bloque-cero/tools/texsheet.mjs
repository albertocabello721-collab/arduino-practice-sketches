// Hoja de contacto de los materiales procedurales (albedo iluminado con su normal).
import { generateTextures, TEXTURE_NAMES } from '../src/render/texgen.js';
import { writePNG } from './png.mjs';
const out = process.argv[2] || '.';
const t0 = performance.now();
const T = generateTextures();
console.log('texturas', TEXTURE_NAMES.length, 'en', (performance.now() - t0).toFixed(0), 'ms');
const S = T.size, cols = 8, rows = Math.ceil(TEXTURE_NAMES.length / cols), cell = 128;
const W = cols * cell, Hh = rows * cell;
const img = Buffer.alloc(W * Hh * 3);
const light = [-0.5, 0.6, 0.62]; const ll = Math.hypot(...light); light.forEach((v, i) => light[i] = v / ll);
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const srgb = (c) => { c = Math.max(0, Math.min(1, c)); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
TEXTURE_NAMES.forEach((name, li) => {
  const cx = (li % cols) * cell, cy = Math.floor(li / cols) * cell;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const sx = Math.floor(x * S / cell), sy = S - 1 - Math.floor(y * S / cell);
    const o = (li * S * S + sy * S + sx) * 4;
    const nx = T.normal[o] / 127.5 - 1, ny = T.normal[o + 1] / 127.5 - 1, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const ns = T.layers[li].normalStrength;
    let n = [nx * ns, ny * ns, nz]; const nl = Math.hypot(...n); n = n.map((v) => v / nl);
    const d = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    const cav = T.normal[o + 2] / 255;
    const alpha = T.layers[li].cutout ? T.normal[o + 3] / 255 : 1;
    const k = (0.35 + d * 0.9) * (0.6 + cav * 0.4);
    const p = ((cy + y) * W + cx + x) * 3;
    const bg = ((x >> 3) + (y >> 3)) % 2 ? 60 : 90;
    for (let c = 0; c < 3; c++) img[p + c] = alpha > 0.5 ? srgb(lin(T.albedo[o + c]) * k * 1.2) : bg;
  }
});
writePNG(`${out}/texsheet.png`, W, Hh, img);
console.log(TEXTURE_NAMES.map((n, i) => `${i}:${n}`).join(' '));

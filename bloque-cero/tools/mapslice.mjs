// Cortes cenitales del mapa por planta (depuración de la distribución).
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { MATS, MAT } from '../src/world/materials.js';
import { writePNG } from './png.mjs';
const out = process.argv[2] || '.';
const t0 = performance.now();
const world = createVillaWorld();
const map = buildVilla(world);
const t1 = performance.now();
console.log('construcción', (t1 - t0).toFixed(0), 'ms', world.stats());
console.log('salas', map.rooms.length, 'puertas', map.doors.length, 'ventanas', map.windows.length, 'trampillas', map.hatches.length, 'luces', map.lights.length);
const slices = [['sotano', -2.4], ['baja', 1.05], ['alta', 4.55], ['tejado', 7.5], ['suelo_baja', -0.06], ['suelo_alta', 3.44]];
const S = 2; // px por vóxel
for (const [name, y] of slices) {
  const vy = world.vy(y);
  const w = world.nx * S, h = world.nz * S;
  const img = Buffer.alloc(w * h * 3);
  for (let z = 0; z < world.nz; z++) for (let x = 0; x < world.nx; x++) {
    let m = world.get(x, vy, z);
    let c;
    if (m === MAT.AIR) {
      // mirar hacia abajo para el suelo
      let d = 1, mm = 0;
      for (; d < 40; d++) { mm = world.get(x, vy - d, z); if (mm) break; }
      const base = mm ? MATS[mm].debris : [0.1, 0.1, 0.1];
      const k = 0.35 * Math.max(0.3, 1 - d / 40);
      c = base.map((v) => v * k);
    } else c = MATS[m].debris;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const i = (((world.nz - 1 - z) * S + sy) * w + x * S + sx) * 3; // norte arriba
      img[i] = Math.min(255, c[0] * 255); img[i + 1] = Math.min(255, c[1] * 255); img[i + 2] = Math.min(255, c[2] * 255);
    }
  }
  // cuadrícula de 1 m (gris tenue) cada 4 m
  for (let gx = 0; gx < world.nx; gx += 32) for (let z = 0; z < h; z++) { const i = (z * w + gx * S) * 3; img[i] = 90; img[i + 1] = 90; img[i + 2] = 200; }
  for (let gz = 0; gz < world.nz; gz += 32) for (let x = 0; x < w; x++) { const i = (((world.nz - gz) * S - 1) * w + x) * 3; if (i >= 0) { img[i] = 90; img[i + 1] = 90; img[i + 2] = 200; } }
  writePNG(`${out}/slice_${name}.png`, w, h, img);
}
console.log('ok');

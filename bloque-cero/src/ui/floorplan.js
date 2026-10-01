// El plano de la casa para la pantalla de carga (F10.4): las tres plantas en corte, con sus salas y,
// para la defensa, las dos salas del objetivo y los puntos A y B. Se dibuja en un canvas a partir del
// mundo de vóxeles: lo sólido a 1,3 m del suelo de cada planta (paredes y ventanas; los muebles
// bajos no salen). El ataque ve el mismo plano sin el objetivo (tiene que localizarlo).
import { SOLID, MAT } from '../world/materials.js';

const LEVEL_NAMES = { B: 'Sótano', 1: 'Planta baja', 2: 'Planta alta' };
const LEVEL_ORDER = ['B', '1', '2'];
const STEP = 0.25;    // m por celda del plano

/** Dibuja el plano en `canvas`. `site`: el objetivo (solo se pinta para la defensa). */
export function drawPlan(canvas, world, map, { side = 'atk', site = null } = {}) {
  const levels = map.builder.levels;
  const keys = LEVEL_ORDER.filter((k) => levels[k]);
  const W = canvas.width, H = canvas.height, pad = 18, titleH = 26;
  const colW = (W - pad * (keys.length + 1)) / keys.length;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, W, H);
  // la caja de la casa: todas las salas, con un metro de margen
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of map.rooms) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); }
  x0 -= 1; x1 += 1; z0 -= 1; z1 += 1;
  const scale = Math.min(colW / (x1 - x0), (H - pad * 2 - titleH) / (z1 - z0));
  const planW = (x1 - x0) * scale, planH = (z1 - z0) * scale, cell = STEP * scale;
  const showSite = side === 'def' && !!site;
  keys.forEach((k, i) => {
    const L = levels[k];
    const ox = pad + i * (colW + pad) + (colW - planW) / 2, oy = pad + titleH;
    const px = (x) => ox + (x - x0) * scale, pz = (z) => oy + (z - z0) * scale;
    // el título de la planta
    c.fillStyle = showSite && site.level === k ? '#f0892b' : '#cfd6dd';
    c.font = '700 14px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(L.name || LEVEL_NAMES[k] || String(k), ox + planW / 2, pad + 16);
    c.fillStyle = 'rgba(255,255,255,0.025)';
    c.fillRect(ox, oy, planW, planH);
    // el suelo de las salas
    c.fillStyle = 'rgba(255,255,255,0.07)';
    for (const r of map.rooms) if (r.level === k) c.fillRect(px(r.x0), pz(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    // el objetivo (defensa): las salas A y B
    if (showSite && site.level === k) {
      for (const id of [site.A, site.B]) {
        const r = map.rooms.find((q) => q.id === id);
        if (r) { c.fillStyle = 'rgba(240,137,43,0.3)'; c.fillRect(px(r.x0), pz(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale); }
      }
    }
    // lo sólido a 1,3 m del suelo: paredes (claras) y ventanas (azuladas)
    const y = L.floor + 1.3;
    for (let z = z0; z < z1; z += STEP) {
      for (let x = x0; x < x1; x += STEP) {
        const m = world.getWorld(x + STEP / 2, y, z + STEP / 2);
        if (!SOLID[m]) continue;
        c.fillStyle = m === MAT.GLASS ? 'rgba(120,180,255,0.9)' : 'rgba(230,235,240,0.92)';
        c.fillRect(px(x), pz(z), cell + 0.6, cell + 0.6);
      }
    }
    // los nombres de las salas (hasta dos líneas)
    c.fillStyle = '#e6ebf0'; c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center';
    c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4;
    for (const r of map.rooms) {
      if (r.level !== k) continue;
      const cx = px((r.x0 + r.x1) / 2), cy = pz((r.z0 + r.z1) / 2);
      const words = String(r.name || '').split(' ');
      const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [words.join(' ')];
      lines.forEach((t, j) => c.fillText(t, cx, cy + 4 + (j - (lines.length - 1) / 2) * 12));
    }
    c.shadowBlur = 0;
    // A y B, en sus puntos
    if (showSite && site.level === k) {
      for (const kk of ['A', 'B']) {
        const b = site.bombs[kk];
        c.fillStyle = '#f0892b'; c.beginPath(); c.arc(px(b.x), pz(b.z), 11, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#140a02'; c.font = '800 14px system-ui, sans-serif'; c.fillText(kk, px(b.x), pz(b.z) + 5);
      }
    }
  });
}

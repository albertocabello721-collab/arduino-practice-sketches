// Prueba de humo del menú principal: el fondo 3D no tiene superficies oscuras y lisas como las que
// dejaba la primera persona delante de la cámara antes de la v19 (un muro a la derecha, un
// rectángulo abajo y una forma tras el título), en Baja, Media y Alta. En cada captura mira la
// parte del fondo que no tapa el panel del menú: cuánto hay oscuro (en total y en el peor de 4 × 4
// cuadros) y que la primera persona está oculta. Con el fallo había un 38 % oscuro; sin él, un 4 %.
// Uso: node tools/smoke-menu.mjs <carpeta de capturas> [html]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const LIMIT = { total: 15, block: 50 };   // % oscuro como mucho: en el fondo a la vista y en un cuadro
for (const q of ['baja', 'media', 'alta']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.resolve(html));
  await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
  await page.evaluate((q) => { const bc = window.__bc; bc.settings.quality = q; bc.post.setQuality(q); }, q);
  // unos fotogramas: la cámara del menú se mueve y la calidad se asienta
  await page.evaluate(() => new Promise((r) => { let k = 0; const f = () => (++k > 20 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const png = await page.screenshot({ path: `${out}/menu_${q}.png` });
  // lo que se ve de verdad: la captura, reducida a 320 × 200
  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const W = 320, H = 200, g = document.createElement('canvas'); g.width = W; g.height = H;
    const x = g.getContext('2d'); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    // el fondo a la vista: a la derecha del panel del menú (desde x = 600 de 1280)
    const X0 = Math.round(W * 600 / 1280), RW = W - X0;
    let dark = 0; const cells = new Array(16).fill(0), size = new Array(16).fill(0);
    for (let py = 0; py < H; py++) {
      for (let px = X0; px < W; px++) {
        const i = (py * W + px) * 4, c = ((py / (H / 4)) | 0) * 4 + (((px - X0) / (RW / 4)) | 0);
        size[c]++;
        if (d[i] + d[i + 1] + d[i + 2] >= 99) continue;         // oscuro: media por debajo de 33
        dark++; cells[c]++;
      }
    }
    const vm = window.__bc.ctx.vm;
    return { oscuro: +(100 * dark / (RW * H)).toFixed(1), peorCuadro: +(100 * Math.max(...cells.map((n, c) => n / size[c]))).toFixed(1), primeraPersona: !!(vm.view && vm.view.visible) };
  }, png.toString('base64'));
  console.log(`${q}:`, JSON.stringify(r));
  if (r.oscuro > LIMIT.total || r.peorCuadro > LIMIT.block) errors.push(`${q}: superficies oscuras en el menú (${r.oscuro} %, un cuadro con ${r.peorCuadro} %)`);
  if (r.primeraPersona) errors.push(`${q}: la primera persona se ve en el menú`);
  await page.close();
}
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

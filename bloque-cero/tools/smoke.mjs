// Prueba de humo en Chromium headless: carga, errores de consola, capturas y rendimiento.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const W = parseInt(process.env.W || '960'), H = parseInt(process.env.H || '540');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 120000 });
console.log('carga hasta menú', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01_menu.png` });
await page.evaluate(() => window.__bc.start());
const shots = [
  ['02_fachada', 15.5, 0, -6.5, Math.PI, -0.02],
  ['03_salon', 9.5, 0, 7.5, Math.PI * 0.75, -0.05],
  ['04_hall', 14, 0, 9, -Math.PI * 0.6, 0.05],
  ['05_cocina', 22.5, 0, 17.5, Math.PI * 0.75, -0.1],
  ['06_sotano', 20, -3.5, 12, Math.PI * 0.9, 0],
  ['07_alta', 17, 3.5, 13.5, Math.PI * 0.55, 0],
];
for (const [name, x, y, z, yaw, pitch] of shots) {
  await page.evaluate(([x, y, z, yaw, pitch]) => window.__bc.place(x, y, z, yaw, pitch), [x, y, z, yaw, pitch]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` });
}
// disparos contra el pladur del salón
await page.evaluate(() => { window.__bc.place(9.2, 0, 1.6, -Math.PI / 2, 0.05); });
await page.waitForTimeout(400);
const before = await page.evaluate(() => { let n = 0; const w = window.__bc.world; for (const c of w.chunks) if (c) for (let i = 0; i < c.length; i++) if (c[i]) n++; return n; });
for (let i = 0; i < 24; i++) {
  await page.evaluate((i) => { const p = window.__bc.player; p.yaw = -Math.PI / 2 + Math.sin(i * 1.7) * 0.12; p.pitch = 0.05 + Math.cos(i * 1.3) * 0.12; window.__bc.fire(1); }, i);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(700);
const after = await page.evaluate(() => { let n = 0; const w = window.__bc.world; for (const c of w.chunks) if (c) for (let i = 0; i < c.length; i++) if (c[i]) n++; return n; });
console.log('vóxeles destruidos por 24 balas:', before - after);
await page.evaluate(() => { const p = window.__bc.player; p.yaw = -Math.PI / 2; p.pitch = 0.05; });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/08_agujeros.png` });
// asomarse
await page.evaluate(() => { window.__bc.place(21.2, 0, 13.6, Math.PI, 0); window.__bc.intent.lean = 1; });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/09_asomado.png` });
await page.evaluate(() => { window.__bc.intent.lean = 0; });
// brecha
await page.evaluate(() => { window.__bc.place(3, 0, 11.2, Math.PI, 0); });
await page.waitForTimeout(300);
await page.evaluate(() => window.__bc.breach());
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/10_brecha.png` });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/11_brecha_luego.png` });
// rendimiento: coste de CPU por fotograma y de cada pasada (el render es por software aquí)
await page.evaluate(() => { window.__bc.place(15.5, 0, -6.5, Math.PI, 0); });
await page.waitForTimeout(3000);
const perf = await page.evaluate(() => window.__bc.perf());
const fm = perf.frameMs.slice(-60).sort((a, b) => a - b);
console.log('CPU JS por fotograma (mediana):', fm[fm.length >> 1].toFixed(2), 'ms; llamadas', perf.calls, '; triángulos', perf.triangles, '; regiones', perf.regions);
const passes = await page.evaluate(() => window.__bc.passTimes(1));
console.log('pasadas (SwiftShader):', Object.entries(passes).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(' · '));
console.log('errores/avisos:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));
await browser.close();

// Prueba de humo de las siluetas de los operadores (F7.3). En el campo de pruebas pone a los 8 de
// cada bando en columna a lo ancho de la calle (x = 28) y mira por la calle: primeros planos
// (teleobjetivo de 22° a 8 m) de frente, de espaldas, de perfil y con el arma principal colgada, y
// la vista real a 25 m (campo de visión por defecto) con un recorte ampliado sin suavizar. Además
// comprueba el nombre al apuntar a la fila y que no haya errores.
// Uso: node tools/smoke-siluetas.mjs <carpeta de capturas> [html] [solo: cerca,lejos]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const only = process.argv[4] || '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
// sin tarjeta gráfica va a 1-3 FPS y el juego bajaría solo la resolución: se desactiva para ver la calidad Media real
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(3); await page.screenshot({ path: `${out}/${name}.png` }); };
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate(() => {
  const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {};
  document.getElementById('hints').style.display = 'none';
  const vm = window.__bc.ctx.vm; for (const o of [vm.root, vm.scene]) Object.defineProperty(o, 'visible', { get: () => false, set: () => {} });
});
const setFov = (f) => page.evaluate((f) => { window.__bc.settings.fov = f; }, f);
// coloca a los 8 de un bando en columna (x = 28, z de -14,6 a -8,3) mirando a `yaw`; el resto, en su sitio
const layout = (side, yaw, extra = '') => page.evaluate(([side, yaw, extra]) => {
  const bc = window.__bc, s = bc.session;
  bc.place(15.5, 0, -4.5, Math.PI, 0);
  for (const op of s.lineup) { op.body.pos.x = op.dummy.home.x; op.body.pos.z = op.dummy.home.z; op.yaw = op.dummy.home.yaw; op.weaponIndex = 0; }
  s.lineup.filter((op) => op.opDef.side === side).forEach((op, i) => { op.body.pos.x = 28; op.body.pos.z = -14.6 + i * 0.9; op.body.pos.y = 0.05; op.yaw = yaw; });
  if (extra) new Function('s', 'side', extra)(s, side);
  for (let i = 0; i < 40; i++) window.__step(1 / 60);
}, [side, yaw, extra]);
const view = async (name, x, y, z, yaw, pitch) => { await page.evaluate(([x, y, z, yaw, pitch]) => window.__bc.place(x, y, z, yaw, pitch), [x, y, z, yaw, pitch]); await shot(name); };
const FRONT = -Math.PI / 2, BACK = Math.PI / 2, LOOK = Math.PI / 2;   // miran a +X (hacia la cámara) · a -X · la cámara mira a -X
const G1 = -14.6 + 1.5 * 0.9, G2 = -14.6 + 5.5 * 0.9;                   // centro de cada grupo de 4
const FOV0 = await page.evaluate(() => window.__bc.settings.fov);
for (const side of ['atk', 'def']) {
  const t = side === 'atk' ? 'a' : 'd';
  if (!only || only.includes('cerca')) {
    await setFov(22);
    await layout(side, FRONT);
    await view(`c_${t}1_frente`, 36, 0, G1, LOOK, -0.07);
    await view(`c_${t}2_frente`, 36, 0, G2, LOOK, -0.07);
    await layout(side, BACK);
    await view(`c_${t}1_espalda`, 36, 0, G1, LOOK, -0.07);
    await view(`c_${t}2_espalda`, 36, 0, G2, LOOK, -0.07);
    await layout(side, 0);
    await view(`c_${t}1_perfil`, 36, 0, G1, LOOK, -0.07);
    await view(`c_${t}2_perfil`, 36, 0, G2, LOOK, -0.07);
    await layout(side, BACK, "for (const op of s.lineup) if (op.opDef.side === side && op.weapons.length > 1) { op.weaponIndex = 1; op.weapon.equipT = 0; }");
    await view(`c_${t}1_colgada`, 36, 0, G1, LOOK, -0.07);
    await view(`c_${t}2_colgada`, 36, 0, G2, LOOK, -0.07);
  }
  if (!only || only.includes('lejos')) {
    await setFov(FOV0);
    await layout(side, FRONT);
    await view(`l_${t}_frente_25m`, 53, 0, -11.45, LOOK, -0.02);
    await layout(side, BACK);
    await view(`l_${t}_espalda_25m`, 53, 0, -11.45, LOOK, -0.02);
  }
}
await setFov(FOV0);
// recortes de 25 m ampliados ×6 sin suavizar (lo que ocupa cada operador en pantalla)
if (!only || only.includes('lejos')) {
  const fs = await import('node:fs');
  const zp = await browser.newPage({ viewport: { width: 170 * 6, height: 65 * 6 } });
  for (const t of ['a', 'd']) for (const k of ['frente', 'espalda']) {
    const f = `${out}/l_${t}_${k}_25m.png`;
    await zp.setContent('<body style="margin:0"><canvas id="c" width="1020" height="390"></canvas></body>');
    await zp.evaluate(async (data) => { const img = new Image(); img.src = data; await img.decode(); const c = document.getElementById('c').getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(img, 555, 325, 170, 65, 0, 0, 1020, 390); }, 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
    await zp.screenshot({ path: `${out}/l_${t}_${k}_25m_x6.png` });
  }
  await zp.close();
}
// la fila en su sitio y el nombre al apuntar (TERMO, el primero)
await page.evaluate(() => { const s = window.__bc.session; for (const op of s.lineup) { op.body.pos.x = op.dummy.home.x; op.body.pos.z = op.dummy.home.z; op.yaw = op.dummy.home.yaw; op.weaponIndex = 0; } for (let i = 0; i < 40; i++) window.__step(1 / 60); window.__bc.place(6, 0, -5.4, 0, -0.07); });
await frames(4);
const nombre = await page.evaluate(() => window.__bc.session.promptText);
const perf = await page.evaluate(() => { const p = window.__bc.perf(); return { llamadas: p.calls, triangulos: p.triangles }; });
console.log('al apuntar a TERMO:', JSON.stringify(nombre), '· dibujo:', JSON.stringify(perf));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

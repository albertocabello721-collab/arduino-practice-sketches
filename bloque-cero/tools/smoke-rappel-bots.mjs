// Prueba de humo de la F10.2b en el navegador: partida atacando en Élite con el sitio en la planta
// alta; un aliado bot entra por una ventana del Estudio con cuerda. Con la capa de depuración (P):
// su ruta por la fachada en cian y la etiqueta con lo que hace en la cuerda. Capturas y sin errores.
// Uso: node tools/smoke-rappel-bots.mjs <carpeta de capturas> [html]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const check = (ok, what) => { if (!ok) errors.push(what); };
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.difficulty = 'elite'; bc.startMatch({ startSide: 'atk', seed: 3 }); });
await page.evaluate(() => { const m = window.__bc.match; m.location = m.map.sites.findIndex((s) => s.id === 'alta'); });
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 150000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: `${out}/${name}.png` }); };
// la simulación avanza solo cuando lo pide la prueba
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__run = (sec, until = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); if (until && until()) return i; } return -1; };
  bc.player.frozen = true;
});
await page.evaluate(() => window.__run(60, () => window.__bc.match.phase === 'action'));
// un aliado (no el portador) entra por la ventana oeste del Estudio; la defensa, quieta
const info = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, sq = bc.session.bots;
  window.__step(1 / 60);
  for (const o of m.opsOfSide('def')) o.frozen = true;
  const B = [...sq.brains.values()].find((X) => X.side === 'atk' && X.op !== m.defuser.carrier && !X.ropePlan) || [...sq.brains.values()].find((X) => X.side === 'atk' && X.op !== m.defuser.carrier);
  const E = sq.nav.ropeEdges.find((q) => q.rp.key === 'norte_oeste:ground:enter:15.00');
  B.ropePlan = { rp: E.rp, room: 'B', wait: false, walkT: 0, done: false, failed: false };
  B.stage = 'rope'; B.delay = 0; B.task = null; B.thinkT = 0;
  const p = B.op.body.pos; p.x = E.rp.hook.x - 3; p.y = 0; p.z = E.rp.hook.z + 6;
  window.__who = B;
  // la cámara (el jugador, quieto), en el jardín trasero mirando a la fachada norte
  bc.place(11, 0, 38, 0.18, 0.2);
  bc.debug.toggle(true);
  return { quien: B.op.meta.opId, paso: E.rp.key };
});
console.log('rappel de:', JSON.stringify(info));
const state = () => page.evaluate(() => {
  const B = window.__who, op = B.op, R = op.rappel, labels = [...document.querySelectorAll('#dbg .dl')].filter((d) => d.style.display !== 'none').map((d) => d.textContent);
  return { fase: R ? R.phase : null, y: +op.body.pos.y.toFixed(2), sala: window.__bc.map.locationAt(op.body.pos.x, op.body.pos.y + 0.3, op.body.pos.z), etiqueta: labels.find((t) => t.startsWith(op.name)) || null, segmentos: window.__bc.debug.stats.segments };
});
await page.evaluate(() => window.__run(1.0));
await shot('rb1_ruta');
const a = await state();
console.log('hacia la fachada:', JSON.stringify(a));
check(/rappel/.test(a.etiqueta || '') && a.segmentos > 10, 'la etiqueta o la ruta no se ven: ' + JSON.stringify(a));
await page.evaluate(() => window.__run(12, () => window.__who.op.rappel && window.__who.op.rappel.phase === 'hang' && window.__who.op.body.pos.y > 2.5));
await shot('rb2_cuerda');
const b = await state();
console.log('en la cuerda:', JSON.stringify(b));
check(b.fase === 'hang' && /en la cuerda/.test(b.etiqueta || ''), 'no sube por la cuerda: ' + JSON.stringify(b));
await page.evaluate(() => window.__run(8, () => window.__who.ropePlan.done));
await page.evaluate(() => window.__run(0.3));
await shot('rb3_dentro');
const c = await state();
console.log('dentro:', JSON.stringify(c));
check(!c.fase && c.sala === 'Estudio', 'no entra por la ventana: ' + JSON.stringify(c));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

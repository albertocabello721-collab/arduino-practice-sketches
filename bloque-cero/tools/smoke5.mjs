// Prueba de humo de la Fase 5 en el navegador: rejilla de navegación construida al
// arrancar, partida contra bots (preparación con drones y refuerzos, acción con
// combate), rondas que terminan y ningún error en consola.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
const steps = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
// pasos de carga (para ver «Calculando rutas…»)
for (let i = 0; i < 200; i++) {
  const s = await page.evaluate(() => { const el = document.getElementById('loadstep'); return el ? el.textContent : ''; }).catch(() => '');
  if (s && steps[steps.length - 1] !== s) steps.push(s);
  if (await page.evaluate(() => window.__bc && window.__bc.state.mode === 'menu').catch(() => false)) break;
  await page.waitForTimeout(50);
}
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
console.log('pasos de carga:', steps.join(' → '));
console.log('rejilla:', JSON.stringify(await page.evaluate(() => window.__bc.ctx.nav.stats())));
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n, body = '') => page.evaluate(([n, body]) => {
  const bc = window.__bc; const f = body ? new Function('bc', body) : null;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); if (bc.match && (bc.match.phase === 'roundEnd' || bc.match.phase === 'matchEnd')) break; }
  return performance.now() - t0;
}, [n, body]);

// ---------------- partida atacando, dificultad veterano: el jugador se queda quieto y juegan los bots
await page.evaluate(() => { window.__bc.settings.difficulty = 'veterano'; window.__bc.startMatch({ startSide: 'atk' }); });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const bots0 = await page.evaluate(() => ({ dificultad: window.__bc.session.bots.diffKey, cerebros: window.__bc.session.bots.brains.size }));
console.log('bots:', JSON.stringify(bots0));
let ms = await ticks(60 * 44);
const prep = await page.evaluate(() => { const m = window.__bc.match; return { sitio: m.site.name, refuerzos: m.fort.panels.length, barricadas: m.fort.barricades.length, objetivo: m.recon.objectiveFound, marcados: m.recon.spotted.size }; });
console.log('preparación:', JSON.stringify(prep), `(${(ms / (60 * 44)).toFixed(3)} ms/tick de simulación + IA)`);
await shot('p5_01_fin_preparacion', 1200);
// acción: 25 s y foto desde detrás de un compañero bot
ms = await ticks(60 * 25);
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  const mate = m.game.operators.find((o) => o.team === 0 && o.isBot && o.state === 'alive');
  if (mate) { const p = mate.body.pos; bc.place(p.x + Math.sin(mate.yaw) * 2.2, p.y, p.z + Math.cos(mate.yaw) * 2.2, mate.yaw, -0.05); }
});
await ticks(2);
await shot('p5_02_compañero_bot', 1500);
const mid = await page.evaluate(() => {
  const bc = window.__bc, b = bc.session.bots;
  return [...b.brains.values()].map((B) => `${B.op.name}(${B.side}) ${B.op.state} ${B.task ? B.task.kind : '-'}${B.stage ? '/' + B.stage : ''} ${B.mover.status}`);
});
console.log('bots a los 25 s:\n  ' + mid.join('\n  '));
// resto de la ronda
let res = null;
for (let k = 0; k < 20 && !res; k++) {
  await ticks(60 * 10);
  res = await page.evaluate(() => { const m = window.__bc.match; return m.phase === 'roundEnd' || m.phase === 'select' || m.phase === 'matchEnd' ? m.lastResult && { motivo: m.lastResult.reason, gana: m.lastResult.winSide, marcador: m.lastResult.score } : null; });
}
console.log('ronda 1:', JSON.stringify(res));
await shot('p5_03_fin_ronda', 1500);
const kills = await page.evaluate(() => window.__bc.match.slots.map((s) => `${s.opId}:${s.stats.kills}/${s.stats.deaths}`).join(' '));
console.log('bajas/muertes:', kills);
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

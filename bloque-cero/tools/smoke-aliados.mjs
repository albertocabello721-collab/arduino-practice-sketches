// Prueba de humo en el navegador de las ayudas de equipo: capa de depuración (P).
// Uso: node tools/smoke-aliados.mjs <carpeta de capturas>
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
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n, body = '') => page.evaluate(([n, body]) => {
  const bc = window.__bc; const f = body ? new Function('bc', body) : null;
  for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); }
  const m = bc.match; return m ? { phase: m.phase, time: +m.timeLeft.toFixed(1) } : null;
}, [n, body]);

// partida defendiendo: el jugador está dentro de la casa con sus aliados bot
await page.evaluate(() => { window.__bc.settings.difficulty = 'normal'; window.__bc.startMatch({ startSide: 'def', seed: 11 }); });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
await ticks(60 * 6);

// ---------------- 1) depuración con P
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__bc.debug.on, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);
const dbg = await page.evaluate(() => {
  const bc = window.__bc, d = bc.debug;
  const labels = [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
  return { on: d.on, visible: d.group.visible, stats: { ...d.stats }, perf: !document.getElementById('perf').classList.contains('hidden'), labels: labels.slice(0, 5) };
});
console.log('depuración:', JSON.stringify(dbg));
await shot('a1_depuracion', 600);
// la acción con la capa encendida: el ataque entra
await ticks(60 * 45);
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  const foe = m.game.operators.find((o) => o.team === 1 && o.state === 'alive');
  if (foe) { const p = foe.body.pos; bc.place(p.x + Math.sin(foe.yaw) * 3, p.y, p.z + Math.cos(foe.yaw) * 3, foe.yaw, -0.2); }
});
await ticks(60 * 12);
await shot('a2_depuracion_accion', 1500);
const dbg2 = await page.evaluate(() => ({ stats: { ...window.__bc.debug.stats }, labels: [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').map((e) => e.textContent).slice(0, 6) }));
console.log('depuración en la acción:', JSON.stringify(dbg2));
await page.keyboard.press('KeyP');
await page.waitForFunction(() => !window.__bc.debug.on, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);
const off = await page.evaluate(() => ({ on: window.__bc.debug.on, visible: window.__bc.debug.group.visible, labels: [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').length, dbgHidden: document.getElementById('dbg').classList.contains('hidden') }));
console.log('apagada:', JSON.stringify(off));

console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

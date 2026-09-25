// Prueba de humo en el navegador de las habilidades de la defensa (X): batería de VOLTIO en un
// refuerzo (quema la carga térmica del ataque) e inhibidor de SILENCIO (el dron cercano se
// queda sin señal), con capturas y sin errores.
// Uso: node tools/smoke-defensa-habilidades.mjs <carpeta de capturas>
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto('file://' + path.resolve('dist/bloque-cero.html'));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; window.__bc.startMatch({ startSide: 'def', seed: 4 }); });
await page.click('#sel-grid .opc:nth-child(1)');          // VOLTIO: baterías
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const ticks = (n, body = '') => page.evaluate(([n, body]) => { const bc = window.__bc; const f = body ? new Function('bc', body) : null; for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); } }, [n, body]);
const KEEP = "if (bc.match.phase === 'prep') bc.match.timer = Math.max(bc.match.timer, 20);";
const hud = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ kit: document.getElementById('kit').textContent.trim(), aviso: window.__bc.session.promptText })))));
await page.evaluate(() => { const bc = window.__bc; for (const o of bc.match.game.operators) if (o !== bc.player) o.frozen = true; });
console.log('operador:', await page.evaluate(() => window.__bc.player.name));

// 1) VOLTIO: refuerzo en la pared hall ↔ cocina (x de 18 a 19) y batería desde la cocina
await page.evaluate(() => {
  const bc = window.__bc, F = bc.match.fort;
  const panel = { kind: 'wall', axisN: 2, line: 16, side: 1, u0: 18, u1: 19, y0: 0, y1: 3.25 };
  F.applyWall(panel);
  F.panels.push({ kind: 'wall', panel, center: { x: 18.5, y: 1.6, z: 16 }, normal: { x: 0, y: 0, z: 1 }, op: null });
  bc.place(18.5, 0.01, 16.8, 0, -0.1);
});
await ticks(2, KEEP);
console.log('HUD:', JSON.stringify(await hud()));
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(70, KEEP);
const bat = await page.evaluate(() => { const b = window.__bc.match.gadgets.placed.find((c) => c.kind === 'battery'); return b ? { soporte: b.host.kind, quedan: window.__bc.player.ability.left } : null; });
console.log('batería:', JSON.stringify(bat));
await page.evaluate(() => window.__bc.place(19.6, 0.01, 17.6, 0.5, -0.05));
await ticks(2, KEEP);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/b1_bateria.png` });
// un atacante coloca una carga térmica al otro lado: se quema
const quemada = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, G = m.gadgets;
  const a = m.game.operators.find((o) => o.side === 'atk');
  a.body.pos.x = 18.5; a.body.pos.y = 0.01; a.body.pos.z = 15.0; a.yaw = Math.PI; a.pitch = 0;
  a.ability = { id: 'thermal', left: 2 };
  a.updatePose(0);
  let n = 0; const off = m.game.on('electrified', (o) => { if (o.kind === 'thermal') n++; });
  const spot = G.placeSpot(a, 'thermal');
  if (spot && spot.ok) G._place(a, spot, 'ability');
  for (let i = 0; i < 10; i++) bc.session.tick(1 / 60);
  off();
  a.body.pos.x = 10; a.body.pos.z = -13;
  return { lugar: !!(spot && spot.ok), quemadas: n, queda: G.placed.filter((c) => c.kind === 'thermal' && c.alive).length };
});
console.log('carga térmica sobre el refuerzo electrificado:', JSON.stringify(quemada));

// 2) SILENCIO: inhibidor en el suelo del hall; un dron del ataque a su lado pierde la señal
await page.evaluate(() => {
  const bc = window.__bc, p = bc.player;
  p.ability = { id: 'jammer', left: 4 }; p.abilityCd = 0;
  p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'jammer', name: 'Inhibidor de señal' } };
  bc.place(17, 0.01, 13, 0, -1.0);
});
await ticks(2, KEEP);
console.log('HUD:', JSON.stringify(await hud()));
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(70, KEEP);
const jam = await page.evaluate((KEEP) => {
  const bc = window.__bc, m = bc.match, j = m.gadgets.placed.find((c) => c.kind === 'jammer');
  const d = m.recon.drones.find((x) => x.alive);
  if (!j || !d) return { inhibidor: !!j, dron: !!d };
  d.body.pos.x = j.pos.x + 1.2; d.body.pos.y = 0.02; d.body.pos.z = j.pos.z; d.body.vel.x = d.body.vel.z = 0;
  const f = new Function('bc', KEEP);
  for (let i = 0; i < 10; i++) { f(bc); bc.session.tick(1 / 60); }
  return { inhibidor: true, dronSinSenal: !!d.jammed, quedan: bc.player.ability.left };
}, KEEP);
console.log('inhibidor:', JSON.stringify(jam));
await page.evaluate(() => window.__bc.place(17, 0.01, 10.6, Math.PI, -0.5));     // (mirando hacia el inhibidor)
await ticks(2, KEEP);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/b2_inhibidor.png` });
// la ronda sigue: acción
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
console.log('fase:', await page.evaluate(() => window.__bc.match.phase));
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

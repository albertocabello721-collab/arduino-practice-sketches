// Prueba de humo de la Fase 4 en el navegador: refuerzo (despliegue hidráulico),
// barricada, cuerpo a cuerpo, dron, cámaras y la preparación de una partida.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
// avanza la sesión N ticks ejecutando `fn(bc)` antes de cada uno
const ticks = (n, body = '') => page.evaluate(([n, body]) => {
  const bc = window.__bc; const f = body ? new Function('bc', body) : null;
  for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); }
}, [n, body]);

// ---------------- campo de pruebas
await page.evaluate(() => window.__bc.start());
await page.waitForTimeout(1500);
// sin el maniquí tirador (la prueba mide la fortificación, no el tiroteo)
await page.evaluate(() => { const bc = window.__bc; const s = bc.game.operators.find((o) => o.id === 'm5'); if (s) bc.game.removeOperator(s); });
// 1) reforzar la pared cocina↔hall desde la cocina (tramo x 18-19)
await page.evaluate(() => { window.__bc.place(18.5, 0, 17.0, 0, 0.05); });
await ticks(10);
const tgt = await page.evaluate(() => { const s = window.__bc.session; const t = s.fort.targetFor(s.player); return t && { kind: t.kind, valid: t.valid, reason: t.reason }; });
console.log('objetivo de F:', JSON.stringify(tgt));
await shot('p4_01_aviso_refuerzo', 900);
// mantener F de verdad (entre fotogramas) mientras se despliega
await page.keyboard.down('f');
await ticks(150, 'bc.player.intent.interact = true;');
console.log('progreso del refuerzo:', await page.evaluate(() => { const s = window.__bc.session; const w = s.fort.work.get(s.player); return w ? +(w.t / w.total).toFixed(2) : null; }));
// mirar el despliegue desde un lado: la cámara se aparta sin mover al operador
await page.evaluate(() => { const bc = window.__bc; bc.__saved = { ...bc.player.body.pos, yaw: bc.player.yaw }; });
await shot('p4_02_desplegando', 300);
await ticks(120, 'bc.player.intent.interact = true;');
await page.keyboard.up('f');
await ticks(1, 'bc.player.intent.interact = false;');
const r1 = await page.evaluate(() => { const s = window.__bc.session; return { paneles: s.fort.panels.length, mat: window.__bc.world.getWorld(18.5, 1.2, 16.06) }; });
console.log('refuerzo:', JSON.stringify(r1));
await page.evaluate(() => { window.__bc.place(20.2, 0, 19.2, 0.62, 0.02); });
await shot('p4_03_refuerzo_hecho', 1200);
// lado del hall: la pared de pladur sigue intacta; disparar deja ver el acero
await page.evaluate(() => { const bc = window.__bc; bc.place(18.5, 0, 14.0, Math.PI, 0.02); for (let i = 0; i < 14; i++) { bc.player.yaw = Math.PI + (Math.random() - 0.5) * 0.08; bc.player.pitch = (Math.random() - 0.3) * 0.2; bc.fire(1); } });
await ticks(30);
await shot('p4_04_acero_tras_pladur', 1500);
// 2) barricada en la puerta hall↔cocina desde la cocina y golpes desde el hall
await page.evaluate(() => { window.__bc.place(16, 0, 17.1, 0, -0.25); });
await ticks(120, 'bc.player.intent.interact = true;');
await ticks(1, 'bc.player.intent.interact = false;');
await page.evaluate(() => { window.__bc.place(16.3, 0, 14.4, Math.PI - 0.1, 0.0); });
await shot('p4_05_barricada', 1200);
await page.evaluate(() => { const bc = window.__bc; const p = bc.player; p.body.pos.z = 15.3; for (const pt of [-0.1, -0.6]) { p.pitch = pt; p.yaw = Math.PI; p.meleeT = 0; bc.game.melee(p); } p.pitch = 0; });
await ticks(20);
await page.evaluate(() => { window.__bc.place(16.3, 0, 14.4, Math.PI - 0.1, 0.0); });
await shot('p4_06_barricada_rota', 1200);
// 3) dron: lanzarlo con 5 y mirar
await page.evaluate(() => { window.__bc.place(15.5, 0, -6, Math.PI, 0); });
await ticks(5);
await page.keyboard.press('Digit5');
await page.waitForTimeout(600);
await ticks(60, 'const d = bc.session.feed.drone; if (d) d.intent.moveZ = 1;');
await ticks(1, 'const d = bc.session.feed.drone; if (d) d.intent.moveZ = 0;');
const dr = await page.evaluate(() => { const f = window.__bc.session.feed; return { mode: f.mode, pos: f.drone && f.drone.body.pos }; });
console.log('dron:', JSON.stringify(dr));
await shot('p4_07_dron', 1500);
await page.keyboard.press('Digit5');
await page.waitForTimeout(400);

// ---------------- partida defendiendo: preparación con bots
await page.evaluate(() => window.__bc.startMatch({ startSide: 'def' }));
await page.click('#sel-grid .opc:nth-child(1)');
await page.click('#sel-choice .ch:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
await ticks(60 * 30);
const pr = await page.evaluate(() => { const m = window.__bc.match; return { sitio: m.site.name, refuerzos: m.fort.panels.length, barricadas: m.fort.barricades.length, drones: m.recon.drones.filter((d) => d.alive).length }; });
console.log('preparación defensa:', JSON.stringify(pr));
// mirar un refuerzo de los bots
await page.evaluate(() => { const m = window.__bc.match; const p = m.fort.panels.find((q) => q.kind === 'wall'); if (p) { const c = p.center, n = p.normal; window.__bc.place(c.x + n.x * 2.2, c.y - 1.62, c.z + n.z * 2.2, Math.atan2(n.x, n.z), 0.0); } });
await ticks(3);
await shot('p4_08_refuerzos_bots', 1500);
// cámaras con 5
await page.keyboard.press('Digit5');
await page.waitForTimeout(500);
console.log('cámaras:', await page.evaluate(() => window.__bc.session.feed.mode));
await shot('p4_09_camaras', 1500);
await page.keyboard.press('KeyD');
await page.waitForTimeout(800);
await shot('p4_10_camara2', 1200);
await page.keyboard.press('Digit5');

// ---------------- partida atacando: dron en la preparación
await page.evaluate(() => window.__bc.startMatch({ startSide: 'atk' }));
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
await page.waitForTimeout(800);
const at = await page.evaluate(() => { const s = window.__bc.session; return { mode: s.feed.mode, piloting: s.feed.piloting }; });
console.log('preparación ataque:', JSON.stringify(at));
await ticks(90, 'const d = bc.session.feed.drone; if (d) d.intent.moveZ = 1;');
await shot('p4_11_dron_preparacion', 1500);
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

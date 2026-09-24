// Prueba de humo en el navegador de los gadgets de defensa: alambre, escudo desplegable, cámara
// blindada y alarma de proximidad, colocados con G durante la preparación, con capturas y sin errores.
// Uso: node tools/smoke-defensa.mjs <carpeta de capturas>
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { MAT } = await import('../src/world/materials.js');
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
await page.click('#sel-grid .opc:nth-child(6)');          // GUARDIÁN: escudo o cámara blindada
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const ticks = (n, body = '') => page.evaluate(([n, body]) => { const bc = window.__bc; const f = body ? new Function('bc', body) : null; for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); } }, [n, body]);
// todos quietos salvo el jugador; la preparación no se acaba mientras probamos
await page.evaluate(() => { const bc = window.__bc; for (const o of bc.match.game.operators) if (o !== bc.player) o.frozen = true; });
const KEEP = "if (bc.match.phase === 'prep') bc.match.timer = Math.max(bc.match.timer, 20);";
const give = (id, left = 2) => page.evaluate(([id, left]) => { const bc = window.__bc; bc.player.gadget = { id, left }; bc.player.gadgetCd = 0; }, [id, left]);
// (el aviso se calcula al pintar: se espera a dos fotogramas)
const hud = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ kit: document.getElementById('kit').textContent.trim(), aviso: window.__bc.session.promptText })))));
console.log('operador:', await page.evaluate(() => window.__bc.player.name), '· HUD:', JSON.stringify(await hud()));

// 1) alambre en el hall, 1,1 m por delante
await give('barbed', 2);
await page.evaluate(() => window.__bc.place(17, 0.01, 13, 0, -0.45));
await ticks(2, KEEP);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.2, KEEP);
const wire = await page.evaluate(() => { const c = window.__bc.match.gadgets.placed.find((c) => c.kind === 'barbed'); return c && { x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2), quedan: window.__bc.player.gadget.left }; });
console.log('alambre:', JSON.stringify(wire));
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/d1_alambre.png` });
// dentro del alambre: velocidad a la mitad y ruido
const inWire = await page.evaluate((w) => {
  const bc = window.__bc, op = bc.player, g = bc.match.game;
  let rustle = 0; const off = g.on('wireRustle', () => rustle++);
  bc.place(w.x - 1.2, 0.01, w.z, -Math.PI / 2, 0);   // al lado, mirando hacia +x (atraviesa el rollo)
  let slowMax = 1;
  for (let i = 0; i < 120; i++) { op.intent.moveZ = 1; bc.session.tick(1 / 60); if (op.slowMul < slowMax) slowMax = op.slowMul; }
  op.intent.moveZ = 0;
  for (let i = 0; i < 4; i++) bc.session.tick(1 / 60);
  off();
  return { lento: slowMax, ruidos: rustle, x: +op.body.pos.x.toFixed(2) };
}, wire);
console.log('dentro del alambre:', JSON.stringify(inWire));

// 2) escudo desplegable: el jugador se da la vuelta (hacia +z) en el hall, en un sitio sin muebles
console.log('postura tras el alambre:', await page.evaluate(() => window.__bc.player.stance));
await give('shield', 1);
await page.evaluate(() => window.__bc.place(18.5, 0.01, 13.0, Math.PI, -0.2));
await ticks(2, KEEP);
console.log('aviso del escudo:', (await hud()).aviso);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.2, KEEP);
const shieldVox = await page.evaluate((SHIELD) => {
  const bc = window.__bc, w = bc.match.game.world;
  // vóxeles de escudo delante del jugador (a 0,9 m por delante)
  let n = 0;
  for (let x = w.vx(17.5); x <= w.vx(19.5); x++) for (let y = w.vy(0.05); y <= w.vy(1.2); y++) for (let z = w.vz(13.5); z <= w.vz(14.3); z++) if (w.get(x, y, z) === SHIELD) n++;
  return { voxeles: n, quedan: bc.player.gadget.left };
}, MAT.DEPLOY_SHIELD);
console.log('escudo:', JSON.stringify(shieldVox));
await ticks(20, KEEP);
console.log('postura tras el escudo:', await page.evaluate(() => window.__bc.player.stance));
await page.evaluate(() => window.__bc.place(18.5, 0.01, 11.0, Math.PI, -0.15));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/d2_escudo.png` });

// 3) cámara blindada en la pared del salón que da al recibidor
await give('bpcam', 1);
const cams0 = await page.evaluate(() => window.__bc.match.recon.cams.length);
await page.evaluate(() => window.__bc.place(11.0, 0.01, 2.0, -Math.PI / 2, 0.1));
await ticks(2, KEEP);
console.log('aviso de la cámara:', (await hud()).aviso);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.2, KEEP);
const cam = await page.evaluate(() => { const r = window.__bc.match.recon; const c = r.cams[r.cams.length - 1]; return { antes: 0, ahora: r.cams.length, ultima: c.name, blindada: !!c.bulletproof, equipo: c.team }; });
cam.antes = cams0;
console.log('cámaras:', JSON.stringify(cam));
await page.evaluate(() => window.__bc.place(9.4, 0.01, 2.6, -Math.PI / 2 - 0.35, 0.1));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/d3_camara_blindada.png` });

// 4) alarma en la pared del hall; un atacante pasa a su lado
await give('alarm', 2);
await page.evaluate(() => window.__bc.place(20.8, 0.01, 12, -Math.PI / 2, -0.25));
await ticks(2, KEEP);
console.log('aviso de la alarma:', (await hud()).aviso);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.2, KEEP);
const alarm = await page.evaluate(() => {
  const bc = window.__bc, g = bc.match.game, G = bc.match.gadgets;
  const al = G.placed.find((c) => c.kind === 'alarm');
  if (!al) return null;
  const atk = g.operators.find((o) => o.team !== bc.player.team && o.state === 'alive');
  let rings = 0; const off = g.on('alarm', () => rings++);
  atk.frozen = false; atk.brainOff = true;
  atk.body.pos.x = al.pos.x - 1.2; atk.body.pos.y = 0.01; atk.body.pos.z = al.pos.z + 0.5;
  for (let i = 0; i < 6; i++) bc.session.tick(1 / 60);
  const marked = bc.match.recon.spotted.has(atk);
  atk.frozen = true;
  atk.body.pos.x = 10; atk.body.pos.z = -13;
  off();
  return { pos: { x: +al.pos.x.toFixed(2), y: +al.pos.y.toFixed(2), z: +al.pos.z.toFixed(2) }, suena: rings, marcado: marked, quien: atk.name };
});
console.log('alarma:', JSON.stringify(alarm));
await page.evaluate(() => window.__bc.place(18.6, 0.01, 12.4, -Math.PI / 2, -0.2));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/d4_alarma.png` });

// 5) la ronda sigue: se acaba la preparación y empieza la acción
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
console.log('fase:', await page.evaluate(() => window.__bc.match.phase), '· colocados:', await page.evaluate(() => window.__bc.match.gadgets.placed.map((c) => c.kind).join(',')));
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

// Prueba de humo en el navegador de las habilidades de ataque (X): carga térmica contra un
// refuerzo, proyectil de brecha, humo remoto, granada PEM (la cámara se queda sin señal),
// pulso de escaneo (el defensor que anda queda marcado), visor térmico a través del humo y
// dron de choque (X lo toma; su rayo destruye una alarma) y escudo balístico (destello y balas
// que rebotan), con capturas y sin errores.
// Uso: node tools/smoke-habilidades.mjs <carpeta de capturas>
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
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; window.__bc.startMatch({ startSide: 'atk', seed: 4 }); });
await page.click('#sel-grid .opc:nth-child(1)');          // TERMO: carga térmica
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const ticks = (n, body = '') => page.evaluate(([n, body]) => { const bc = window.__bc; const f = body ? new Function('bc', body) : null; for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); } }, [n, body]);
// fuera la preparación; todos quietos salvo el jugador; la ronda no se acaba mientras probamos
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
await page.evaluate(() => { const bc = window.__bc; for (const o of bc.match.game.operators) if (o !== bc.player) o.frozen = true; });
const KEEP = "bc.match.timer = Math.max(bc.match.timer, 60);";
const hud = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ kit: document.getElementById('kit').textContent.trim(), aviso: window.__bc.session.promptText })))));
console.log('fase:', await page.evaluate(() => window.__bc.match.phase), '· operador:', await page.evaluate(() => window.__bc.player.name));

// 1) TERMO: refuerzo en la pared salón ↔ recibidor (x = 12, z de 2 a 3) y carga térmica desde el salón
await page.evaluate(() => {
  const bc = window.__bc, F = bc.match.fort;
  const panel = { kind: 'wall', axisN: 0, line: 12, side: 1, u0: 2, u1: 3, y0: 0, y1: 3.25 };
  F.applyWall(panel);
  F.panels.push({ kind: 'wall', panel, center: { x: 12, y: 1.6, z: 2.5 }, normal: { x: 1, y: 0, z: 0 }, op: null });
  bc.place(11.0, 0.01, 2.5, -Math.PI / 2, 0);
});
await ticks(2, KEEP);
console.log('HUD:', JSON.stringify(await hud()));
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 2.2, KEEP);
console.log('térmica colocada:', await page.evaluate(() => !!window.__bc.match.gadgets.thermalOf(window.__bc.player)), '· HUD:', JSON.stringify(await hud()));
await page.evaluate(() => window.__bc.place(10.0, 0.01, 1.3, -Math.PI / 2 - 0.5, -0.05));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/h1_termica_colocada.png` });
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.placed.some((c) => c.burning), null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 2, KEEP);
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/h2_termica_ardiendo.png` });
await ticks(60 * 3.3, KEEP);
const th = await page.evaluate(() => { const bc = window.__bc, w = bc.match.game.world; let air = 0; for (let y = 0.1; y < 1.8; y += 0.125) for (let z = 2.0; z < 3.0; z += 0.125) for (const x of [11.94, 12.06]) if (w.getWorld(x, y, z) === 0) air++; return { aire: air, de: 2 * 14 * 8, placas: bc.match.fort.panels.length }; });
console.log('hueco de la térmica:', JSON.stringify(th));
await page.evaluate(() => window.__bc.place(10.6, 0.01, 2.5, -Math.PI / 2, -0.05));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/h3_termica_hueco.png` });

// 2) ROMPE: proyectil de brecha contra la pared del fondo del pasillo del sótano (17 m)
await page.evaluate(() => { const bc = window.__bc, p = bc.player; p.ability = { id: 'breachround', left: 2 }; p.abilityCd = 0; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'breachround', name: 'Proyectil de brecha' } }; bc.place(29, -3.49, 11, Math.PI / 2, 0); });
await ticks(2, KEEP);
// (el juego sigue corriendo entre llamadas: se cuenta desde antes de disparar)
await page.evaluate(() => { const bc = window.__bc; bc._booms = 0; bc._offBoom = bc.match.game.on('explosion', (k) => { if (k === 'breachround') bc._booms++; }); });
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.items.some((i) => i.kind === 'breachround'), null, { timeout: 20000 }).catch(() => {});
await ticks(40, KEEP);
console.log('proyectil pegado:', await page.evaluate(() => { const r = window.__bc.match.gadgets.items.find((i) => i.kind === 'breachround'); return r ? { pegado: !!r.stuck, x: +r.pos.x.toFixed(2) } : null; }));
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/h4_brecha_pegado.png` });
await ticks(60 * 1.6, KEEP);
const booms = await page.evaluate(() => { const bc = window.__bc; bc._offBoom(); return bc._booms; });
console.log('explosiones del proyectil:', booms);
await page.evaluate(() => window.__bc.place(15.5, -3.49, 11, Math.PI / 2, 0));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/h5_brecha_hueco.png` });

// 3) NUBE: humo remoto al fondo del pasillo
await page.evaluate(() => { const bc = window.__bc, p = bc.player; p.ability = { id: 'remotesmoke', left: 3 }; p.abilityCd = 0; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'remotesmoke', name: 'Humo remoto' } }; bc.place(29, -3.49, 12, Math.PI / 2, 0); });
await ticks(2, KEEP);
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.smokes.length > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.8, KEEP);
console.log('nube:', await page.evaluate(() => { const s = window.__bc.match.gadgets.smokes[0]; return s ? { x: +s.x.toFixed(1), z: +s.z.toFixed(1) } : null; }));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/h6_humo_remoto.png` });

// 4) CHISPA: PEM junto a la cámara del hall; la cámara se queda sin señal
await page.evaluate(() => { const bc = window.__bc, p = bc.player; p.ability = { id: 'emp', left: 3 }; p.abilityCd = 0; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'emp', name: 'Granada PEM' } }; bc.place(14.5, 0.01, 12.5, Math.PI - 0.6, 0.35); });
await ticks(2, KEEP);
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.gadgets.items.some((i) => i.kind === 'emp'), null, { timeout: 20000 }).catch(() => {});
const emp = await page.evaluate((KEEP) => { const bc = window.__bc; let hits = null; const off = bc.match.game.on('emp', (p, h) => { hits = h.map((d) => d.name || d.kind); }); const f = new Function('bc', KEEP); for (let i = 0; i < 60 * 2.2; i++) { f(bc); bc.session.tick(1 / 60); } off(); const cam = bc.match.recon.cams.find((c) => c.id === 'cam_hall'); return { alcanzadas: hits, sinSenal: bc.match.gadgets.isOff(cam) }; }, KEEP);
console.log('PEM:', JSON.stringify(emp));
await page.evaluate(() => { const bc = window.__bc; bc.session.feed.enterCam(bc.match.recon.cams.find((c) => c.id === 'cam_hall')); });
await ticks(2, KEEP);
await page.waitForTimeout(900);
console.log('SEÑAL PERDIDA visible:', await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(!document.getElementById('fd-lost').classList.contains('hidden')))))));
await page.screenshot({ path: `${out}/h7_camara_sin_senal.png` });
await page.evaluate(() => window.__bc.session.feed.exit());
await ticks(2, KEEP);

// 5) RADAR: pulso de escaneo; un defensor anda por el pasillo del sótano y queda marcado
const DEF = `const bc = window.__bc; const d = bc.match.game.operators.find((o) => o.side === 'def' && o.state === 'alive');`;
await page.evaluate(new Function(`${DEF}
  bc.session.bots.brains.delete(d);           // sin cerebro: lo movemos a mano
  d.frozen = false; d.body.pos.x = 24; d.body.pos.y = -3.49; d.body.pos.z = 9.5; d.yaw = Math.PI / 2;
  bc.__d = d;
  const p = bc.player; p.ability = { id: 'scan', left: 3 }; p.abilityCd = 0; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'scan', name: 'Pulso de escaneo' } };
  bc.place(27, -3.49, 12, Math.PI / 2 - 0.15, -0.05);`));
const WALK = KEEP + " if (bc.__d) { bc.__d.intent.moveZ = 1; bc.__d.intent.moveX = 0; }";
await ticks(2, WALK);
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.match.abilities.scans.length > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(20, WALK);
console.log('aviso del pulso:', await page.evaluate(() => document.getElementById('alert').textContent));
await page.screenshot({ path: `${out}/h8_escaneo_aviso.png` });
await ticks(60 * 2.2, WALK);
const scan = await page.evaluate(() => { const bc = window.__bc; return { marcado: bc.match.recon.isSpottedFor(bc.__d, bc.player.team), aviso: document.getElementById('alert').textContent }; });
console.log('pulso:', JSON.stringify(scan));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/h9_escaneo_marcado.png` });
await ticks(60 * 4.2, KEEP + " if (bc.__d) bc.__d.intent.moveZ = 0;");

// 6) LUMEN: visor térmico; el defensor, quieto dentro de una nube de humo
await page.evaluate(() => {
  const bc = window.__bc, d = bc.__d, G = bc.match.gadgets, now = bc.match.game.time;
  d.body.pos.x = 17.5; d.body.pos.z = 11; d.yaw = -Math.PI / 2; d.intent.moveZ = 0;
  G.smokes.push({ x: 18, y: -3.1, z: 11, r: 4, t0: now - 3, until: now + 30, team: 0 });
  const p = bc.player; p.ability = { id: 'thermalscope', left: -1 }; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'thermalscope', name: 'Visor térmico 3x' } };
  bc.place(27, -3.49, 11, Math.PI / 2, -0.02);
});
// (la nube se llena de partículas con los fotogramas: 4 s de juego en tiempo real)
await page.evaluate(() => new Promise((res) => { const bc = window.__bc, t0 = bc.match.game.time; const chk = () => { bc.match.timer = Math.max(bc.match.timer, 60); if (bc.match.game.time - t0 >= 4) res(); else requestAnimationFrame(chk); }; chk(); }));
await page.screenshot({ path: `${out}/h10_humo_sin_visor.png` });
await page.evaluate(() => { window.__bc.ctx.input.mouse.right = true; });
// (el apuntado avanza con los fotogramas del navegador: se espera a que termine)
await page.waitForFunction(() => window.__bc.player.ads > 0.95, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(600);
const th2 = await page.evaluate(() => { const bc = window.__bc, s = bc.session; return { ads: +bc.player.ads.toFixed(2), fov: +bc.camera.fov.toFixed(1), frio: bc.ctx.chars.cold.visible, derecho: bc.ctx.input.mouse.right, intencion: bc.player.intent.ads, capturado: bc.ctx.input.locked, controla: s.controlling, feed: s.feed.active, arma: bc.player.weapon.ready }; });
console.log('visor térmico:', JSON.stringify(th2));
await page.screenshot({ path: `${out}/h11_visor_termico.png` });
await page.evaluate(() => { window.__bc.ctx.input.mouse.right = false; });
await ticks(30, KEEP);

// 7) PULGA: dron de choque contra una alarma de la defensa en el hall
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, G = m.gadgets, d = bc.__d, p = bc.player;
  // una alarma de la defensa, puesta por el defensor en el suelo del hall
  d.body.pos.x = 17; d.body.pos.y = 0.01; d.body.pos.z = 13; d.yaw = 0; d.pitch = -1.0; d.gadget = { id: 'alarm', left: 1 }; d.gadgetCd = 0;
  const spot = G.placeSpot(d); G._place(d, spot);
  // el jugador pasa a ser PULGA con su dron de choque en el hall
  p.ability = { id: 'shockdrone', left: 6 }; p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'shockdrone', name: 'Dron de choque' } };
  // (como si fuera su primer dron de la ronda)
  for (const o of m.recon.drones) if (o.owner === p) o.alive = false;
  m.recon.drones = m.recon.drones.filter((o) => o.owner !== p);
  m.recon.left.set(p, 2);
  const dr = m.recon.deployDrone(p, { thrown: false }) || null;
  bc.__dr = dr;
  bc.place(17, 0.01, 9, Math.PI, 0);
});
const dr0 = await page.evaluate(() => { const bc = window.__bc, dr = bc.__dr; return dr ? { choque: dr.shock, nombre: dr.name } : null; });
console.log('dron de PULGA:', JSON.stringify(dr0));
await ticks(2, KEEP);
await page.keyboard.press('KeyX');            // X a pie: al dron de choque
await ticks(3, KEEP);
await page.evaluate(() => {
  const bc = window.__bc, dr = bc.__dr, al = bc.match.gadgets.placed.find((c) => c.kind === 'alarm' && c.alive);
  if (!dr || !al) return;
  dr.body.pos.x = 17; dr.body.pos.y = 0.02; dr.body.pos.z = 9.5;
  const e = dr.eyePos(), c = al.target.center();
  dr.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z)); dr.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
});
await ticks(2, KEEP);
await page.waitForTimeout(600);
console.log('en el dron de choque:', await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ vista: window.__bc.session.feed.mode, titulo: document.getElementById('fd-title').textContent, teclas: document.getElementById('fd-keys').textContent }))))));
await page.screenshot({ path: `${out}/h12_dron_choque.png` });
await page.keyboard.press('KeyX');            // X en el dron: rayo
await ticks(3, KEEP);
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/h13_rayo.png` });
console.log('rayo:', JSON.stringify(await page.evaluate(() => { const bc = window.__bc; const al = bc.match.gadgets.placed.find((c) => c.kind === 'alarm'); return { alarmaViva: !!al && al.alive, cargas: bc.player.ability.left }; })));
await page.evaluate(() => window.__bc.session.feed.exit());
await ticks(2, KEEP);

// 8) MURALLA: escudo en primera persona, destello que ciega y escudo enemigo que para las balas
await page.evaluate(() => {
  const bc = window.__bc, p = bc.player, d = bc.__d;
  p.ability = { id: 'shield', left: 4 }; p.abilityCd = 0;
  p.opDef = { ...p.opDef, ability: { ...p.opDef.ability, id: 'shield', name: 'Escudo balístico', short: 'Destello' } };
  p.intent.switchTo = 1;                              // pistola
  d.body.pos.x = 17; d.body.pos.y = 0.01; d.body.pos.z = 9.5; d.yaw = 0; d.blindT = 0; d.hp = d.maxHp;
  bc.place(17, 0.01, 13.5, 0, -0.08);                // en el hall, mirándolo a 4 m
});
await ticks(60, KEEP);
await page.waitForTimeout(900);
console.log('escudo:', JSON.stringify(await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ kit: document.getElementById('kit').textContent.trim(), arma: window.__bc.player.weapon.def.name })))))));
await page.screenshot({ path: `${out}/h14_escudo_primera_persona.png` });
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__bc.player.flashT > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(30, KEEP);
console.log('destello:', JSON.stringify(await page.evaluate(() => { const bc = window.__bc; return { cegado: +(bc.__d.blindT || 0).toFixed(2), quedan: bc.player.ability.left }; })));
// el defensor con escudo, de cara al jugador: las balas rebotan
await page.evaluate(() => {
  const bc = window.__bc, d = bc.__d;
  d.ability = { id: 'shield', left: 4 }; d.yaw = Math.PI; d.blindT = 0;
  bc.player.ability = { id: 'thermal', left: 0 };
  bc.player.opDef = { ...bc.player.opDef, ability: { ...bc.player.opDef.ability, id: 'thermal', name: 'Carga térmica', short: undefined } };
});
await ticks(10, KEEP);
const shot = await page.evaluate(() => { const bc = window.__bc, d = bc.__d, g = bc.match.game; let rico = 0; const off = g.on('ricochet', () => rico++); const hp = d.hp; bc.place(17, 0.01, 13.5, 0, -0.14); bc.session.tick(1 / 60); bc.fire(3); off(); return { rebotes: rico, vidaAntes: hp, vidaDespues: d.hp }; });
console.log('disparos al escudo:', JSON.stringify(shot));
await ticks(2, KEEP);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/h15_escudo_enemigo.png` });
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

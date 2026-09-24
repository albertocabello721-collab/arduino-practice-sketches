// Prueba de humo en el navegador de las habilidades de ataque (X): carga térmica contra un
// refuerzo, proyectil de brecha, humo remoto y granada PEM (la cámara se queda sin señal),
// con capturas y sin errores.
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
console.log('SEÑAL PERDIDA visible:', await page.evaluate(() => !document.getElementById('fd-lost').classList.contains('hidden')));
await page.screenshot({ path: `${out}/h7_camara_sin_senal.png` });
await page.evaluate(() => window.__bc.session.feed.exit());
await ticks(2, KEEP);
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

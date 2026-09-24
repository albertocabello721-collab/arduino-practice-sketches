// Prueba de humo en el navegador de los gadgets: humo, cegadora y fragmentación lanzados con
// G, carga de brecha colocada y detonada y claymore, con capturas y sin errores.
// Uso: node tools/smoke-gadgets.mjs <carpeta de capturas>
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
await page.click('#sel-grid .opc:nth-child(2)');          // ROMPE: humo o cegadora
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const ticks = (n, body = '') => page.evaluate(([n, body]) => { const bc = window.__bc; const f = body ? new Function('bc', body) : null; for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); } }, [n, body]);
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
// el ataque, quieto; el jugador en la calle mirando a la casa
await page.evaluate(() => { const bc = window.__bc; for (const o of bc.match.game.operators) if (o !== bc.player) o.frozen = true; bc.place(10, 0.01, -9, Math.PI, -0.12); });
await ticks(10);
const hud0 = await page.evaluate(() => document.getElementById('gear').textContent);
console.log('gadget en el HUD:', hud0);
// 1) humo con G
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.items.length > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 2.5);
const smoke = await page.evaluate(() => { const G = window.__bc.match.gadgets; return { nubes: G.smokes.length, centro: G.smokes[0] && { x: +G.smokes[0].x.toFixed(1), z: +G.smokes[0].z.toFixed(1) }, quedan: window.__bc.player.gadget.left }; });
console.log('humo:', JSON.stringify(smoke));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/g1_humo_fuera.png` });
// dentro de la nube: velo en pantalla
if (smoke.centro) await page.evaluate((c) => { const bc = window.__bc; bc.place(c.x, 0.01, c.z, Math.PI, 0); }, smoke.centro);
await ticks(2);
await page.waitForTimeout(1200);
console.log('velo dentro del humo:', await page.evaluate(() => window.__bc.post.grade.uniforms.uSmoke.value.toFixed(2)));
await page.screenshot({ path: `${out}/g2_humo_dentro.png` });
// 2) cegadora a los pies, mirándola
await page.evaluate(() => { const bc = window.__bc; bc.player.gadget = { id: 'flash', left: 1 }; bc.player.gadgetCd = 0; bc.place(10, 0.01, -12, Math.PI, -0.9); });
await ticks(2);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.items.length > 0 || window.__bc.player.blindT > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.6);
await page.waitForTimeout(700);
console.log('cegado:', await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ t: +window.__bc.player.blindT.toFixed(2), blanco: +window.__bc.post.grade.uniforms.uBlind.value.toFixed(2) }))))));
await page.screenshot({ path: `${out}/g3_cegado.png` });
// 3) fragmentación contra la fachada
await page.evaluate(() => { const bc = window.__bc; bc.player.blindT = 0; bc.player.gadget = { id: 'frag', left: 1 }; bc.player.gadgetCd = 0; bc.place(14, 0.01, -8, Math.PI, 0.1); });
await ticks(2);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.items.length > 0, null, { timeout: 20000 }).catch(() => {});
const booms = await page.evaluate(() => { const bc = window.__bc; let n = 0; const off = bc.match.game.on('explosion', () => n++); for (let i = 0; i < 60 * 3.4; i++) bc.session.tick(1 / 60); off(); return n; });
console.log('explosiones:', booms, '· vida:', await page.evaluate(() => Math.round(window.__bc.player.hp)), '· G sin cargas:', await page.evaluate(() => window.__bc.player.gadget.left));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/g4_explosion.png` });
// 4) carga de brecha en la fachada de pladur del porche (recibidor): colocar, detonar
await page.evaluate(() => { const bc = window.__bc; bc.player.hp = bc.player.maxHp; bc.player.gadget = { id: 'breach', left: 2 }; bc.player.gadgetCd = 0; bc.place(11.0, 0.01, 2.0, -Math.PI / 2, 0); });
await ticks(2);
await page.waitForTimeout(600);
console.log('aviso de la brecha:', await page.evaluate(() => window.__bc.session.promptText));
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.7);
await page.waitForTimeout(700);
console.log('colocada:', await page.evaluate(() => window.__bc.match.gadgets.placed.length), '· aviso:', await page.evaluate(() => window.__bc.session.promptText));
await page.screenshot({ path: `${out}/g5_brecha_colocada.png` });
await page.evaluate(() => { const bc = window.__bc; bc.place(9.0, 0.01, 2.0, -Math.PI / 2, 0); bc.player.gadgetCd = 0; });
await ticks(2);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.placed.length === 0, null, { timeout: 20000 }).catch(() => {});
await ticks(30);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/g6_brecha_detonada.png` });
// 5) claymore en el suelo
await page.evaluate(() => { const bc = window.__bc; bc.player.gadget = { id: 'claymore', left: 1 }; bc.player.gadgetCd = 0; bc.place(16, 0.01, 12, 0, -0.5); });
await ticks(2);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.2);
await page.evaluate(() => { const bc = window.__bc; bc.place(16.6, 0.01, 13.4, -0.4, -0.35); });
await ticks(2);
await page.waitForTimeout(900);
console.log('claymores:', await page.evaluate(() => window.__bc.match.gadgets.placed.filter((c) => c.kind === 'claymore').length));
await page.screenshot({ path: `${out}/g7_claymore.png` });
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

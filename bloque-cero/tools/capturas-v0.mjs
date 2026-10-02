// Capturas fijas para la auditoría visual (V0): seis escenas de la Villa de día, a 1600×900, escala 1,0
// y calidad alta (MSAA 4), con el HUD tal como lo ve el jugador. Primero la pared recién destruida
// (necesita la simulación en marcha: carga de brecha en la fachada del recibidor); después se congela la
// simulación y se colocan la cámara y un operador para el resto.
// Uso: node tools/capturas-v0.mjs <carpeta> [html]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const ticks = (n) => page.evaluate((n) => { const s = window.__bc.session; for (let i = 0; i < n; i++) s.tick(1 / 60); }, n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('captura', name); };
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => {
  const bc = window.__bc;
  bc.settings.quality = 'alta'; bc.post.setQuality('alta');
  const sel = document.getElementById('qm-side'); sel.value = 'atk'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const t = document.getElementById('qm-time'); t.value = 'dia'; t.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('btn-match').click();
});
await page.waitForFunction(() => window.__bc.state.mode === 'play' && window.__bc.match);
// sin captura del ratón (en el navegador sin cabeza nunca llega): el modo «sin captura» en vez de la pausa
await page.evaluate(() => { window.__bc.ctx.canvas.requestPointerLock = () => { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0); return Promise.resolve(); }; });
// escala 1,0 fija (el ajuste adaptativo bajaría la escala con los FPS del render por software)
await page.evaluate(() => {
  const bc = window.__bc;
  bc.renderer.setPixelRatio(1); bc.renderer.setPixelRatio = () => {};
  bc.post.setAdaptiveLevel = () => {};
  window.dispatchEvent(new Event('resize'));
});
// saltar la selección, la carga y la preparación: a la acción (el render por software va a pocos FPS)
const t0 = Date.now();
for (;;) {
  const ph = await page.evaluate(() => {
    const bc = window.__bc, m = bc.match;
    if (bc.ctx.paused) document.dispatchEvent(new Event('pointerlockerror'));
    if (m.phase === 'select') { for (const s of m.slots) if (s.human) m.setReady(s, true); m.timer = Math.min(m.timer, 0.2); }
    else if (m.phase === 'load') bc.session.skipLoad();
    else if (m.phase === 'prep') m.timer = Math.min(m.timer, 0.2);
    return m.phase;
  });
  if (ph === 'action') break;
  if (Date.now() - t0 > 400000) throw new Error('no se llega a la acción: fase ' + ph);
  await page.waitForTimeout(500);
}
await page.evaluate(() => { const bc = window.__bc; bc.session.bots.update = () => {}; for (const o of bc.game.operators) if (o !== bc.player) Object.assign(o.intent, { fire: false, ads: false, moveX: 0, moveZ: 0, sprint: false }); });
console.log('fase', await page.evaluate(() => window.__bc.match.phase));
// sin el rótulo de inicio de ronda ni el aviso del ratón (del navegador sin cabeza) en las capturas
await page.addStyleTag({ content: '#intro, #toast { display: none !important; }' });
// ---------------------------------------------------------------- 6) pared recién destruida (carga de brecha en la fachada del recibidor)
await page.evaluate(() => { const bc = window.__bc; bc.player.hp = bc.player.maxHp; bc.player.gadget = { id: 'breach', left: 2 }; bc.player.gadgetCd = 0; bc.place(11.0, 0.01, 2.0, -Math.PI / 2, 0); });
await ticks(2); await frames(3);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.work.size > 0, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 1.7); await frames(2);
console.log('brecha colocada:', await page.evaluate(() => window.__bc.match.gadgets.placed.length));
await page.evaluate(() => { const bc = window.__bc; bc.place(8.5, 0.01, 2.0, -Math.PI / 2, 0); bc.player.gadgetCd = 0; });
await ticks(2);
await page.keyboard.press('KeyG');
await page.waitForFunction(() => window.__bc.match.gadgets.placed.length === 0, null, { timeout: 20000 }).catch(() => {});
await ticks(45); await frames(6);
await page.evaluate(() => { const bc = window.__bc; bc.place(9.4, 0.01, 2.0, -Math.PI / 2, -0.04); });
await ticks(2); await frames(2);
await shot('06_pared_destruida');
// ---------------------------------------------------------------- congelar la simulación para las escenas fijas
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; });
const place = (x, y, z, yaw, pitch = 0) => page.evaluate(([x, y, z, yaw, pitch]) => { const bc = window.__bc; bc.place(x, y, z, yaw, pitch); for (let i = 0; i < 3; i++) window.__step(1 / 60); }, [x, y, z, yaw, pitch]);
// 1) pasillo interior: el pasillo de servicio, mirando al norte hacia la cocina
await place(23.5, 0.01, 8.0, Math.PI, 0.0);
await shot('01_pasillo');
// 2) cuarto con ventana: el salón, mirando a las ventanas de la pared oeste
await place(10.0, 0.01, 6.0, Math.PI / 2, 0.02);
await shot('02_cuarto_ventana');
// 3) exterior: la calle, mirando a la fachada principal
await place(13.5, 0.01, -9.0, Math.PI, 0.03);
await shot('03_exterior');
// 4) primera persona apuntando: en el hall, apuntando hacia el recibidor
await page.evaluate(() => { const bc = window.__bc, p = bc.player; bc.place(17.0, 0.01, 14.5, 0, 0.0); p.weaponIndex = 0; p.ads = 1; p.intent.ads = true; for (let i = 0; i < 3; i++) window.__step(1 / 60); p.ads = 1; });
await frames(8);
await shot('04_apuntando');
await page.evaluate(() => { const p = window.__bc.player; p.ads = 0; p.intent.ads = false; });
// 5) un operador a 5 m: en la calle, a la luz del día, un enemigo de frente
await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player;
  const foe = g.operators.find((o) => o.team !== p.team && o.state === 'alive');
  bc.place(13.5, 0.01, -12.0, Math.PI, 0.0);
  foe.body.pos.x = 13.5; foe.body.pos.y = 0; foe.body.pos.z = -7.0; foe.yaw = 0; foe.body.vel.x = foe.body.vel.y = foe.body.vel.z = 0;
  window.__foe = foe.name;
  for (let i = 0; i < 3; i++) window.__step(1 / 60);
  foe.body.pos.x = 13.5; foe.body.pos.z = -7.0; foe.yaw = 0;
  window.__step(1 / 60);
});
console.log('operador:', await page.evaluate(() => window.__foe));
await shot('05_operador_5m');
// 7) un aliado tras la pared: el jugador en la calle mirando a la fachada, el aliado dentro del recibidor
await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player, map = bc.map;
  const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive');
  const ax = 6.5, az = 6.5;      // (el salón, entre las dos ventanas de la fachada: tras la pared de ladrillo)
  bc.place(ax, 0.01, az, Math.PI, 0); for (let i = 0; i < 4; i++) window.__step(1 / 60);   // (la altura del suelo en su sitio)
  const floorY = p.body.pos.y;
  ally.body.pos.x = ax; ally.body.pos.y = floorY; ally.body.pos.z = az; ally.yaw = Math.PI; ally.body.vel.x = ally.body.vel.y = ally.body.vel.z = 0;
  window.__allyY = floorY;
  bc.place(ax, 0.01, -7, Math.PI, 0.02);
  for (let i = 0; i < 3; i++) window.__step(1 / 60);
  ally.body.pos.x = ax; ally.body.pos.z = az; ally.yaw = Math.PI;
  window.__step(1 / 60);
});
await shot('07_aliado_tras_pared');
// 8) el mismo aliado a la vista, a 3 m
await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player, map = bc.map;
  const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive');
  const ax = 6.5, az = 6.5;
  bc.place(ax, 0.01, az - 3, Math.PI, 0.0);
  for (let i = 0; i < 3; i++) window.__step(1 / 60);
  ally.body.pos.x = ax; ally.body.pos.y = window.__allyY; ally.body.pos.z = az; ally.yaw = Math.PI;
  window.__step(1 / 60);
});
await shot('08_aliado_a_la_vista');
// datos del render para el informe
const info = await page.evaluate(() => { const r = window.__bc.renderer, i = r.info.render; return { llamadas: i.calls, triangulos: i.triangles, exposicion: +r.toneMappingExposure.toFixed(2), escala: r.getPixelRatio(), msaa: window.__bc.post.msaa, sombras: window.__bc.settings.shadows }; });
console.log(JSON.stringify(info));
if (errors.length) console.log('errores:', errors.join(' | '));
await browser.close();

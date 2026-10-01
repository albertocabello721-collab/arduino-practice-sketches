// Prueba de humo de la F10.6 en el navegador: partida en Élite; un aliado bot en la calle y un
// defensor que aparece a 35° de donde mira. Con la capa de depuración (P), su etiqueta dice lo que
// hace su puntería: «reacciona» (sin girarse), «gira» y «apunta». Capturas de cada momento, y sin
// errores.
// Uso: node tools/smoke-punteria.mjs <carpeta de capturas> [html]
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
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.difficulty = 'elite'; bc.startMatch({ startSide: 'atk', seed: 5 }); });
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
// el aliado A en la calle (al oeste de la casa) mirando al norte; el defensor D sin cerebro, lejos
const who = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, sq = bc.session.bots, g = m.game;
  const A = [...sq.brains.values()].find((B) => B.side === 'atk' && B.op !== bc.player);
  const D = [...sq.brains.values()].find((B) => B.side === 'def');
  for (const o of g.operators) if (o !== A.op && o !== D.op && o !== bc.player) g.kill(o, { by: null });
  sq.brains.delete(D.op);
  const put = (op, x, y, z) => { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; };
  put(A.op, -6, 0.01, 12); A.op.yaw = Math.PI; A.op.pitch = 0;
  A.post = { x: -6, y: 0, z: 12, yaw: Math.PI }; A.task = null; A.thinkT = 0;
  put(D.op, 6, -3.49, 6);
  window.__A = A; window.__D = D;
  window.__hold = () => { A.scanT = 1e9; A.scanYaw = Math.PI; D.op.intent.fire = false; D.op.intent.moveX = 0; D.op.intent.moveZ = 0; };
  for (let i = 0; i < 60; i++) { window.__hold(); window.__step(1 / 60); }
  // la cámara (el jugador, congelado), a un lado: se ve a A y hacia donde aparecerá D
  bc.place(-12.5, 0.01, 10.5, Math.atan2(-(-3 - -12.5), -(17 - 10.5)), -0.08);
  bc.debug.toggle(true);
  return { A: A.op.name, D: D.op.name };
});
console.log('aliado:', who.A, '· defensor:', who.D);
// aparece D a 35° a la izquierda de A, a 8 m
await page.evaluate(() => {
  const A = window.__A, D = window.__D, e = A.op.eyePos(), yaw = Math.PI + 35 * Math.PI / 180;
  const op = D.op; op.body.pos.x = e.x - Math.sin(yaw) * 8; op.body.pos.y = 0.01; op.body.pos.z = e.z - Math.cos(yaw) * 8; op.yaw = yaw + Math.PI;
});
const label = () => page.evaluate((name) => [...document.querySelectorAll('#dbg .dl')].filter((d) => d.style.display !== 'none').map((d) => d.textContent).find((t) => t.startsWith(name)) || '', who.A);
const seen = {};
for (const [phase, file] of [['react', 'p1_reacciona'], ['flick', 'p2_gira'], ['track', 'p3_apunta']]) {
  const t = await page.evaluate((ph) => { let n = 0; while (n++ < 120) { window.__hold(); window.__step(1 / 60); if (window.__A.aim.phase === ph) break; } return { t: n, yaw: window.__A.op.yaw }; }, phase);
  await shot(file);
  seen[phase] = await label();
  console.log(phase, JSON.stringify(t), '·', seen[phase]);
}
check(/reacciona/.test(seen.react), 'la etiqueta no dice «reacciona»');
check(/gira/.test(seen.flick), 'la etiqueta no dice «gira»');
check(/apunta/.test(seen.track), 'la etiqueta no dice «apunta»');
// y dispara después de apuntar
const fired = await page.evaluate(() => { const s0 = window.__A.op.stats.shots; for (let i = 0; i < 90; i++) { window.__hold(); window.__step(1 / 60); if (window.__A.op.stats.shots > s0) return i + 1; } return -1; });
console.log('dispara a los', fired, 'pasos de empezar a apuntar');
check(fired > 0, 'no dispara');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

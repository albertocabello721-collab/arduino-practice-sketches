// Prueba de humo de la tercera persona por capas (F7.4) en el campo de pruebas, con la fila de los
// 16: TERMO recarga por partes (la mano va al cargador, este cae al suelo, coge otro y lo mete),
// TIZÓN cambia la caja de la ametralladora, CHISPA planta, VOLTIO refuerza y RADAR lanza. Capturas
// de cada momento, cuenta lo que cae al suelo y sin errores.
// Uso: node tools/smoke-tercera.mjs <carpeta de capturas> [html]
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
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
// (sin tarjeta gráfica va a 1-3 FPS: sin esto el juego bajaría solo la resolución)
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.fov = 40; bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; document.getElementById('hints').style.display = 'none'; window.__bc.ctx.vm.setShown = () => {}; window.__bc.ctx.vm.view.visible = false; });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(3); await page.screenshot({ path: `${out}/${name}.png` }); };
// avanza la simulación n ticks; `body` corre antes de cada uno (con el operador de la fila `op`)
const ticks = (id, n, body = '') => page.evaluate(([id, n, body]) => {
  const s = window.__bc.session, op = s.lineup.find((o) => o.opDef.id === id), f = body ? new Function('op', body) : null;
  for (let i = 0; i < n; i++) { if (f) f(op); window.__step(1 / 60); }
}, [id, n, body]);
// mira al operador `id` desde delante y a su izquierda, a `d` m
const look = (id, d = 2.8, side = 1) => page.evaluate(([id, d, side]) => {
  const bc = window.__bc, op = bc.session.lineup.find((o) => o.opDef.id === id), b = op.body.pos;
  const x = b.x + side * d * 0.63, z = b.z + d * 0.78;           // (la fila mira a +Z; su izquierda es +X)
  const tx = b.x - x, tz = b.z - z;
  bc.place(x, 0.125, z, Math.atan2(-tx, -tz), -0.22);
}, [id, d, side]);
const state = (id) => page.evaluate((id) => {
  const bc = window.__bc, op = bc.session.lineup.find((o) => o.opDef.id === id), w = op.weapon, D = bc.ctx.effects.drops.items;
  return { t: w.reloadT > 0 ? +(w.reloadTotal - w.reloadT).toFixed(2) : null, cargador: op.pose.mag, municion: `${w.ammo}|${w.reserve}`, suelo: `${D.filter((d) => d.kind === 'mag').length} cargadores, ${D.filter((d) => d.kind === 'casing').length} casquillos` };
}, id);
// empieza la recarga y devuelve los instantes de sus partes
const reload = (id, ammo) => page.evaluate(([id, ammo]) => {
  const s = window.__bc.session, op = s.lineup.find((o) => o.opDef.id === id), w = op.weapon;
  w.ammo = ammo; op.intent.reload = true; window.__step(1 / 60);
  return Object.fromEntries(w.plan.parts.map((p) => [p.part, p.at]));
}, [id, ammo]);
const until = async (id, t) => { const now = (await state(id)).t || 0; await ticks(id, Math.max(0, Math.round((t - now) * 60))); };

// ---------------- TERMO (FA-7): recarga táctica por partes (vista desde su frente derecho)
await look('termo', 2.4, -1);
await ticks('termo', 20);
const P = await reload('termo', 10);
await until('termo', P.magOut - 0.1);
await shot('t1_mano_al_cargador');
const s1 = await state('termo');
await until('termo', P.magOut + 0.2);
await shot('t2_cargador_cae');
const s2 = await state('termo');
await until('termo', (P.magOut + P.magIn) / 2 + 0.15);
await shot('t3_cargador_nuevo');
const s3 = await state('termo');
await until('termo', P.magIn + 0.05);
await shot('t4_dentro');
await page.evaluate(() => { const bc = window.__bc, op = bc.session.lineup.find((o) => o.opDef.id === 'termo'), b = op.body.pos; bc.place(b.x - 1.3, 0.125, b.z + 1.6, Math.atan2(1.3, 1.6), -0.55); });
await shot('t4b_cargador_en_el_suelo');
const s4 = await state('termo');
await ticks('termo', 90);
console.log('TERMO:', JSON.stringify({ partes: P, alCargador: s1, cae: s2, nuevo: s3, dentro: s4, final: await state('termo') }));

// ---------------- TIZÓN (AL-60): la caja de la ametralladora
await look('tizon');
await ticks('tizon', 10);
const Q = await reload('tizon', 20);
await until('tizon', Q.magOut + 0.2);
await shot('t5_caja_fuera');
console.log('TIZÓN:', JSON.stringify({ partes: Q, caja: await state('tizon') }));
await ticks('tizon', 300);

// ---------------- CHISPA: plantar (las dos manos al suelo; el arma colgada)
await look('chispa', 2.6);
await ticks('chispa', 50, "if (!op.channel) op.channel = { kind: 'plant', t: 0, total: 7 }; op.channel.t += 1 / 60;");
await shot('t6_planta');
const plant = await page.evaluate(() => { const op = window.__bc.session.lineup.find((o) => o.opDef.id === 'chispa'), r = op.rig; const d = (a, b) => Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y, a.p.z - b.p.z); return { accion: Object.keys(op.pose.acts).find((k) => op.pose.acts[k].w > 0.99) || null, manoIzqAltura: +r[7].p.y.toFixed(2), armaMano: +d(r[17], r[10]).toFixed(2) }; });
await ticks('chispa', 20, 'op.channel = null;');

// ---------------- VOLTIO: reforzar (empuja el panel)
await look('voltio', 2.6, -1);
await ticks('voltio', 50, "if (!op.channel) op.channel = { kind: 'reinforce', t: 0, total: 5 }; op.channel.t += 1 / 60;");
await shot('t7_refuerza');
const reinf = await page.evaluate(() => { const op = window.__bc.session.lineup.find((o) => o.opDef.id === 'voltio'); return Object.keys(op.pose.acts).find((k) => op.pose.acts[k].w > 0.99) || null; });
await ticks('voltio', 20, 'op.channel = null;');

// ---------------- RADAR: lanzar
await look('radar');
await page.evaluate(() => window.__bc.session.lineup.find((o) => o.opDef.id === 'radar').startAnim('throw'));
await ticks('radar', 16);
await shot('t8_lanza');
const thr = await page.evaluate(() => { const op = window.__bc.session.lineup.find((o) => o.opDef.id === 'radar'); return op.pose.acts.throw ? +op.pose.acts.throw.w.toFixed(2) : 0; });

console.log('acciones:', JSON.stringify({ plantar: plant, reforzar: reinf, lanzar: thr }));
const perf = await page.evaluate(() => { const p = window.__bc.perf(); return { llamadas: p.calls, triangulos: p.triangles }; });
console.log('dibujo:', JSON.stringify(perf));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

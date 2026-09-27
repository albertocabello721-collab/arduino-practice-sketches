// Prueba de humo de la muerte con física por partes (F7.5) en el campo de pruebas, con operadores de
// la fila llevados a cada sitio: de frente en la calle (cae hacia atrás), contra la fachada (queda
// apoyado), en la escalera principal (cae sobre los escalones) y junto a una explosión (sale
// despedido). Capturas a 0,3 s, 1 s y 3 s; comprueba que nada queda dentro de un vóxel, que se
// quedan quietos, que los huesos son números y que el dibujo no cambia (mismas llamadas).
// Uso: node tools/smoke-muerte.mjs <carpeta de capturas> [html]
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
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; document.getElementById('hints').style.display = 'none'; window.__bc.ctx.vm.setShown = () => {}; window.__bc.ctx.vm.view.visible = false; });
// la física de los cuerpos solo avanza cuando lo pide la prueba (al pintar, sin tiempo): así las
// capturas salen en su instante aunque sin tarjeta gráfica cada fotograma tarde medio segundo
await page.evaluate(() => { const ch = window.__bc.ctx.chars, up = ch.update.bind(ch); window.__charsUpdate = up; ch.update = (dt, lo, cp) => up(0, lo, cp); });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(3); await page.screenshot({ path: `${out}/${name}.png` }); };
const perf = () => page.evaluate(() => { const p = window.__bc.perf(); return { llamadas: p.calls, triangulos: p.triangles }; });
// la física de los cuerpos avanza `secs` en fotogramas de 1/60 (además de lo que avance al pintar)
const physics = (secs) => page.evaluate((n) => { const bc = window.__bc; for (let i = 0; i < n; i++) window.__charsUpdate(1 / 60, bc.player, bc.camera.position); }, Math.round(secs * 60));
// lleva al operador `id` de la fila a (x, y, z) mirando a `yaw` y deja que la simulación le ponga la pose
const put = (id, x, y, z, yaw) => page.evaluate(([id, x, y, z, yaw]) => {
  const s = window.__bc.session, op = s.lineup.find((o) => o.opDef.id === id);
  op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.yaw = yaw; op.dummy.home = { x, z, yaw };
  for (let i = 0; i < 30; i++) window.__step(1 / 60);
}, [id, x, y, z, yaw]);
// lo mata de un disparo en el pecho que viene de delante (o una explosión en `blast`)
const kill = (id, blast = null) => page.evaluate(([id, blast]) => {
  const s = window.__bc.session, op = s.lineup.find((o) => o.opDef.id === id), c = op.rig[2].p;
  const f = { x: -Math.sin(op.yaw), z: -Math.cos(op.yaw) };
  if (blast) s.game.damage(op, 500, { by: null, zone: 'body', point: blast, weapon: { name: 'C4', explosive: true }, noDown: true });
  else s.game.damage(op, 500, { by: null, zone: 'body', dir: { x: -f.x, y: -0.03, z: -f.z }, point: { x: c.x, y: c.y + 0.1, z: c.z }, weapon: { name: 'FA-7' }, noDown: true });
  return op.state;
}, [id, blast]);
// estado del cuerpo: quieto, partículas dentro de vóxeles, huesos válidos, dónde quedan cabeza y pelvis
const body = (id) => page.evaluate((id) => {
  const bc = window.__bc, s = bc.session, op = s.lineup.find((o) => o.opDef.id === id), v = bc.ctx.chars.views.get(op.id), r = v.rag;
  if (!r) return null;
  const n = r.P.length / 3, w = bc.ctx.world;
  let dentro = 0;
  for (let i = 0; i < n; i++) if (w.solidAtWorld(r.P[i * 3], r.P[i * 3 + 1], r.P[i * 3 + 2])) dentro++;
  const b = v.mesh.material.uniforms.uBones.value;
  const f = (i) => [r.P[i * 3], r.P[i * 3 + 1], r.P[i * 3 + 2]].map((x) => +x.toFixed(2));
  return { quieto: !r.awake, dentro, huesosValidos: b.every(Number.isFinite), pelvis: f(0), cabeza: f(3), arma: f(23) };
}, id);
// cámara: el jugador en (x, z) mirando al punto (tx, tz), con la vista inclinada `pitch`
const look = async (x, y, z, tx, tz, pitch) => { await page.evaluate(([x, y, z, tx, tz, pitch]) => window.__bc.place(x, y, z, Math.atan2(-(tx - x), -(tz - z)), pitch), [x, y, z, tx, tz, pitch]); await frames(2); };

await page.evaluate(() => window.__bc.place(15.5, 0, -4.5, Math.PI, 0));
await frames(4);
const perf0 = await perf();
const results = {};
const scene = async (name, id, where, blast, cam) => {
  await put(id, ...where);
  await look(...cam);
  await kill(id, blast);
  await physics(0.2); await shot(`${name}_1_02s`);
  await physics(0.8); await shot(`${name}_2_1s`);
  await physics(2.1); await shot(`${name}_3_3s`);
  results[name] = await body(id);
  const r = results[name];
  if (!r || !r.quieto || r.dentro || !r.huesosValidos) errors.push(`${name}: ${JSON.stringify(r)}`);
  console.log(name + ':', JSON.stringify(r));
};
// 1) de frente en la calle: cae hacia atrás (vista de lado)
await scene('m1_calle', 'termo', [15.5, 0, -12.5, 0], null, [12.6, 0, -11.2, 15.5, -11.6, -0.3]);
// 2) contra la fachada (a 0,9 m de la pared, disparo de frente): queda apoyado
await scene('m2_pared', 'tizon', [10, 0, -1.0, 0], null, [8.2, 0, -3.3, 10, -0.6, -0.35]);
// 3) en la escalera principal, mirando hacia abajo: cae de espaldas sobre los escalones
await scene('m3_escalera', 'chispa', [21.1, 1.75, 9.6, 0], null, [19.0, 0, 8.4, 21.1, 9.8, 0.05]);
// 4) explosión delante: sale despedido hacia atrás y hacia arriba
await scene('m4_explosion', 'voltio', [19.5, 0, -12.5, 0], { x: 19.5, y: 0.3, z: -13.4 }, [16.2, 0, -10.8, 19.5, -11, -0.25]);
// 5) doce de la fila a la vez: como mucho diez se mueven a la vez; al final, todos quietos y fuera de los vóxeles
const doce = await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, ch = bc.ctx.chars;
  const ops = s.lineup.filter((o) => o.state !== 'dead').slice(0, 12);
  for (const op of ops) { const c = op.rig[2].p; s.game.damage(op, 500, { by: null, zone: 'body', dir: { x: 0, y: -0.03, z: -1 }, point: { x: c.x, y: c.y + 0.1, z: c.z }, weapon: { name: 'FA-7' }, noDown: true }); }
  let most = 0;
  for (let i = 0; i < 200; i++) {
    window.__charsUpdate(1 / 60, bc.player, bc.camera.position);
    let awake = 0;
    for (const v of ch.views.values()) if (v.rag && v.rag.awake) awake++;
    most = Math.max(most, awake);
  }
  let quietos = 0, dentro = 0;
  for (const op of ops) {
    const r = ch.views.get(op.id).rag;
    if (!r.awake) quietos++;
    for (let i = 0; i < r.P.length / 3; i++) if (bc.ctx.world.solidAtWorld(r.P[i * 3], r.P[i * 3 + 1], r.P[i * 3 + 2])) dentro++;
  }
  return { muertos: ops.length, aLaVezComoMucho: most, quietos, dentro };
});
console.log('doce a la vez:', JSON.stringify(doce));
if (doce.aLaVezComoMucho > 10 || doce.quietos !== doce.muertos || doce.dentro) errors.push('doce a la vez: ' + JSON.stringify(doce));
await page.evaluate(() => window.__bc.place(16, 0, -6.0, 0, -0.45));
await shot('m5_doce');
await page.evaluate(() => window.__bc.place(15.5, 0, -4.5, Math.PI, 0));
await frames(4);
const perf1 = await perf();
console.log('dibujo antes:', JSON.stringify(perf0), '· después:', JSON.stringify(perf1));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

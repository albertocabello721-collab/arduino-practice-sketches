// Rendimiento en partida con 10 operadores y la casa a la vista (calidad Media, 1280x720):
// llamadas de dibujo, triángulos y coste de CPU de los personajes y del arma en primera persona
// (recargando), por fotograma, y de las poses y la simulación, por tick. Con varios archivos,
// una línea por archivo (para comparar con una versión anterior).
// Uso: node tools/perf-partida.mjs [dist/bloque-cero.html otra.html ...]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const files = process.argv.slice(2);
if (!files.length) files.push('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function measure(file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.difficulty = 'normal'; bc.startMatch({ startSide: 'atk', seed: 3 }); });
  await page.click('#sel-grid .opc:nth-child(1)');
  await page.click('#sel-ready');
  await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
  await page.evaluate(() => {
    const bc = window.__bc, s = bc.session, m = bc.match, me = bc.player;
    window.__step = s.tick.bind(s); s.tick = () => {};          // la simulación, solo cuando lo pide la prueba
    for (let i = 0; i < 60 * 50 && m.phase !== 'action'; i++) window.__step(1 / 60);
    s.bots.update = () => {};                                   // sin IA: todos quietos
    // el jugador en el jardín delantero mirando a la casa; los otros 9 delante, en abanico
    bc.place(18, 0.01, -17, Math.PI, 0.05);
    m.game.operators.filter((o) => o !== me).forEach((o, i) => {
      const row = i % 3, col = Math.floor(i / 3);
      o.state = 'alive'; o.frozen = false;
      o.body.pos.x = 14 + col * 2.6 + row * 0.8; o.body.pos.y = 0.01; o.body.pos.z = -13 + row * 2.5;
      o.body.vel.x = o.body.vel.y = o.body.vel.z = 0;
      o.yaw = 0; o.intent.moveX = o.intent.moveZ = 0; o.intent.fire = false; o.intent.sprint = false;
    });
    for (let i = 0; i < 20; i++) window.__step(1 / 60);
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const bc = window.__bc, ctx = bc.ctx, me = bc.player, R = bc.renderer;
    const light = { sky: 0.6, warm: 0.3, cool: 0.2 };
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    const N = 200;
    let t = performance.now();
    for (let i = 0; i < N; i++) ctx.chars.update(1 / 60, me, bc.camera.position);
    const chars = (performance.now() - t) / N;
    // el arma, recargando (la capa de la recarga por partes incluida)
    const w = me.weapon;
    w.ammo = Math.min(w.ammo, 5); w.cancelReload?.(); me.intent.reload = true; window.__step(1 / 60);
    t = performance.now();
    for (let i = 0; i < N; i++) { if (w.reloadT > 0.02) w.reloadT -= 0.01; ctx.vm.update(1 / 60, me, light, 0, 0); }
    const vm = (performance.now() - t) / N;
    const ren = [];
    for (let i = 0; i < 20; i++) { R.info.reset(); t = performance.now(); ctx.post.render(1 / 60); ren.push(performance.now() - t); }
    const calls = R.info.render.calls, tris = R.info.render.triangles;
    const ops = bc.match.game.operators;
    t = performance.now();
    for (let i = 0; i < 600; i++) for (const o of ops) o.updatePose(1 / 60);
    const pose = (performance.now() - t) / 600;
    t = performance.now();
    for (let i = 0; i < 300; i++) window.__step(1 / 60);
    const tick = (performance.now() - t) / 300;
    return { calls, tris, chars, vm, pose, tick, render: med(ren) };
  });
  const f = (x, d = 3) => x.toFixed(d);
  console.log(`${path.basename(file).padEnd(22)} ${r.calls} llamadas · ${(r.tris / 1000).toFixed(0)}k triángulos · personajes ${f(r.chars)} ms · arma ${f(r.vm)} ms por fotograma · poses ${f(r.pose)} ms · tick ${f(r.tick)} ms${errors.length ? ' · errores: ' + errors.join(' | ') : ''}`);
  await page.close();
}
for (const f of files) await measure(f);
await browser.close();

// Prueba de humo de la F12.5 (ambiente) en el navegador:
//  · Partida rápida → Hora: día, atardecer y noche. Desde la calle: el atardecer se ve más cálido
//    (más rojo que azul) que el día, y la noche más oscura y más azul; de noche hay estrellas y las
//    farolas de la calle alumbran (luz cálida al pie de la farola), de día no;
//  · dentro del salón, de día, se ve el polvo en la luz;
//  · suenan los pájaros de día y los grillos de noche en la calle, y el reloj en el salón;
//  · los bots no se enteran: en una partida con ambiente de noche, todo lo que oyen los bots viene
//    de un operador (disparos, pasos…), nunca del ambiente;
//  · sin errores.
// Uso: node tools/smoke-ambiente.mjs [carpeta para capturas] [html]
import { createRequire } from 'node:module';
import path from 'node:path';
import { meanLuma, meanRGB } from './png.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const check = (ok, what) => { if (!ok) errors.push(what); };
const wait = (ms) => page.waitForTimeout(ms);
// la zona de la imagen sin interfaz (para medir la luz de la escena)
const SCENE = [0.34, 0.14, 0.97, 0.62];
// una captura justo después de pintar (si la escena sale negra, que en esta máquina pasa a veces, otra)
const shotOf = async (name) => {
  let b = null;
  for (let i = 0; i < 4; i++) { await frames(3); b = await page.screenshot({ path: path.join(out, name) }); if (meanLuma(b, SCENE) > 12) break; }
  return b;
};
// esperar `sec` s del reloj del audio (que aquí, sin tarjeta de sonido, va más lento que el de pared)
const audioWait = (sec) => page.evaluate(async (sec) => {
  const ctx = window.__bc.audio.ctx, t0 = ctx.currentTime, w0 = performance.now();
  while (ctx.currentTime - t0 < sec && performance.now() - w0 < 40000) await new Promise((r) => setTimeout(r, 100));
}, sec);
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.mouse.click(5, 5);
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); });

const res = {};
for (const key of ['dia', 'atardecer', 'noche']) {
  // la hora, desde el menú (Partida rápida → Hora); luego al campo de pruebas
  await page.evaluate((key) => { const el = document.getElementById('qm-time'); el.value = key; el.dispatchEvent(new Event('change', { bubbles: true })); }, key);
  await page.evaluate(() => window.__bc.start());
  await page.waitForFunction(() => window.__bc.state.mode === 'play');
  await page.evaluate(() => { const s = window.__bc.session; s.tick = () => {}; });
  // la calle, mirando a la casa (con la farola del centro a la vista); lo que suena, desde aquí
  await page.evaluate(() => window.__bc.place(18, 0, -15, Math.PI, 0.03));
  const c0 = await page.evaluate(() => { const A = window.__bc.audio._amb2; return A ? { ...A.count } : { birds: 0, crickets: 0, clock: 0 }; });
  await frames(6); await audioWait(7);
  const calle = await shotOf(`f125_${key}_calle.png`);
  const r = await page.evaluate((c0) => {
    const bc = window.__bc, wr = bc.wr, lv = wr.lightVolume, s = { sky: 0, warm: 0, cool: 0 };
    lv.sample(20, 0.4, -6.3, s);
    const A = bc.audio._amb2;
    return { hora: wr.tod, estrellas: wr.sky.material.uniforms.uStars.value, farola: +s.warm.toFixed(2), pajaros: A.count.birds - c0.birds, grillos: A.count.crickets - c0.crickets };
  }, c0);
  r.luz = +meanLuma(calle, SCENE).toFixed(1);
  const rgb = meanRGB(calle, SCENE);
  r.calido = +(rgb[0] - rgb[2]).toFixed(1);   // rojo menos azul: más alto, más cálido
  // dentro del salón, junto a la ventana
  await page.evaluate(() => window.__bc.place(3, 0, 2.2, Math.PI, 0.05));
  const k0 = await page.evaluate(() => window.__bc.audio._amb2.count.clock);
  await frames(6); await audioWait(4);
  const dentro = await shotOf(`f125_${key}_salon.png`);
  Object.assign(r, await page.evaluate((k0) => { const bc = window.__bc, A = bc.audio._amb2; return { polvo: bc.dust.lit, polvoVisible: +bc.dust.mat.opacity.toFixed(2), tictac: A.count.clock - k0 }; }, k0));
  r.luzDentro = +meanLuma(dentro, SCENE).toFixed(1);
  res[key] = r;
  console.log(key.padEnd(10), JSON.stringify(r));
  await page.evaluate(() => window.__bc.toMenu());
  await page.waitForFunction(() => window.__bc.state.mode === 'menu');
}
const D = res.dia, T = res.atardecer, N = res.noche;
check(D.hora === 'dia' && T.hora === 'atardecer' && N.hora === 'noche', 'la hora del menú no llega al juego');
check(N.luz < D.luz * 0.8 && N.luz < T.luz * 0.8, 'la noche no se ve más oscura que el día y el atardecer');
check(T.calido > D.calido + 8, 'el atardecer no se ve más cálido que el día');
check(N.calido < D.calido - 8, 'la noche no se ve más fría (azul) que el día');
check(N.estrellas === 1 && D.estrellas === 0, 'no hay estrellas de noche (o las hay de día)');
check(N.farola > 0.3 && D.farola === 0, 'las farolas no alumbran de noche (o alumbran de día)');
check(D.polvo >= 10 && D.polvoVisible > 0.5, 'no se ve el polvo en la luz del salón');
check(D.pajaros >= 1 && D.grillos === 0 && N.grillos >= 5 && N.pajaros === 0, 'no suenan los pájaros de día o los grillos de noche (o hay grillos de día o pájaros de noche)');
check(D.tictac >= 2, 'no suena el reloj del salón');

// los bots no se enteran: partida de noche con el ambiente sonando; todo lo que oyen viene de un operador
const bots = await page.evaluate(async () => {
  const bc = window.__bc;
  bc.settings.announcer = false;
  bc.startMatch({ startSide: 'atk', seed: 5, timeOfDay: 'noche' });
  await new Promise((r) => { const f = () => (bc.match && bc.match.phase === 'select' ? r() : setTimeout(f, 100)); f(); });
  document.querySelector('#sel-grid .opc:nth-child(1)').click();
  document.getElementById('sel-ready').click();
  await new Promise((r) => { const f = () => (bc.match.phase === 'prep' ? r() : setTimeout(f, 100)); f(); });
  const s = bc.session, B = s.bots, ops = new Set(bc.match.game.operators);
  let heard = 0, foreign = 0;
  const orig = B._noise.bind(B);
  B._noise = (src, pos, kind, range) => { heard++; if (!ops.has(src)) foreign++; return orig(src, pos, kind, range); };
  // la partida sigue unos segundos a velocidad normal, con el ambiente de noche sonando
  const step = s.tick.bind(s);
  bc.match.timer = 0.5;
  for (let i = 0; i < 60 * 2 && bc.match.phase === 'prep'; i++) step(1 / 60);   // (hasta la acción)
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 8000));
  const A = bc.audio._amb2;
  return { hora: bc.wr.tod, oidos: heard, deFuera: foreign, grillos: A ? A.count.crickets : -1, fase: bc.match.phase, seg: +((performance.now() - t0) / 1000).toFixed(1) };
});
console.log('bots:', JSON.stringify(bots));
check(bots.hora === 'noche' && bots.grillos > N.grillos, 'la partida de noche no suena a noche');
check(bots.oidos > 0 && bots.deFuera === 0, 'los bots oyen algo que no viene de un operador');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

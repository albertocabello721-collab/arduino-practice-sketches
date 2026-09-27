// Prueba de humo del audio 3D (F9) en el navegador: música en el menú, ambiente fuera (viento) y
// dentro (zumbido), por dónde llega un sonido (pared, suelo, puerta) desde la cámara, sonidos de
// verdad con ese resultado, música tensa en los últimos 30 s de la ronda y sin errores.
// Uso: node tools/smoke-audio.mjs [html]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const html = process.argv[2] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const wait = (ms) => page.waitForTimeout(ms);
const check = (ok, what) => { if (!ok) errors.push(what); };

// ---------------- menú: el primer clic arranca el audio y suena la música suave
await page.mouse.click(5, 5);
await frames(4); await wait(2500);
const menu = await page.evaluate(() => { const a = window.__bc.audio; return { ctx: !!a.ctx && a.ctx.state, nivel: a._mus && a._mus.level, volumen: a._mus && +a._mus.bus.gain.value.toFixed(2), notas: a._mus && a._mus.step }; });
console.log('menú:', JSON.stringify(menu));
check(menu.nivel === 1 && menu.volumen > 0.1 && menu.notas > 0, 'sin música en el menú');

// ---------------- campo de pruebas: sin música; viento fuera, zumbido dentro
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; });
const amb = async (x, y, z) => { await page.evaluate(([x, y, z]) => window.__bc.place(x, y, z, 0, 0), [x, y, z]); await frames(4); await wait(1500); return page.evaluate(() => { const a = window.__bc.audio; return { viento: +a.ambLevel.wind.toFixed(4), zumbido: +a.ambLevel.hum.toFixed(4), vientoAhora: +a._amb.wg.gain.value.toFixed(4), musica: a._mus.level }; }); };
const fuera = await amb(15.5, 0, -12), dentro = await amb(6, 0, 6);
console.log('fuera:', JSON.stringify(fuera), '· dentro:', JSON.stringify(dentro));
check(fuera.viento > fuera.zumbido && dentro.zumbido > dentro.viento, 'el ambiente no cambia al entrar');
check(fuera.musica === 0, 'música en el campo de pruebas');

// ---------------- por dónde llega un sonido a la cámara (y que los sonidos lo aceptan)
const oye = await page.evaluate(() => {
  const bc = window.__bc, H = bc.ctx.hearing, a = bc.audio, r = {};
  const at = (cx, cz, sx, sy, sz) => { bc.place(cx, 0, cz, 0, 0); H.ear = bc.camera.position; H.ear.set(cx, 1.6, cz); H.frame(); const h = bc.ctx.hear({ x: sx, y: sy, z: sz }); return { tapa: h.occl, rodeo: h.detoured, desde: [h.x, h.y, h.z].map((v) => +v.toFixed(2)) }; };
  r.calle = at(10, -6, 18, 1.2, -6);
  r.pared = at(8, -3, 8, 1.2, 4);
  r.arriba = at(6, 6, 6, 4.6, 6);
  r.puerta = at(14.5, 5.5, 11, 1.2, 3.4);
  // sonidos de verdad con el resultado: disparo, pasos, impacto, explosión y el dron
  const h = bc.ctx.hear({ x: 11, y: 1.2, z: 3.4 });
  a.gunshot('rifle', { x: 11, y: 1.5, z: 3.4 }, false, h);
  a.footstep(3, { x: 11, y: 0.05, z: 3.4 }, 0.6, false, h);
  a.impact(3, { x: 11, y: 1.2, z: 3.4 }, h);
  a.explosion({ x: 11, y: 1, z: 3.4 }, 1, h);
  a.droneLoop('prueba', { x: 11, y: 0.1, z: 3.4 }, 2, h, false);
  return r;
});
console.log('oído:', JSON.stringify(oye));
check(oye.calle.tapa === 0 && Math.abs(oye.pared.tapa - 0.35) < 1e-6 && Math.abs(oye.arriba.tapa - 0.6) < 1e-6 && oye.puerta.rodeo, 'la propagación no da lo esperado en el navegador');

// ---------------- partida: sin música al empezar la acción; tensa en los últimos 30 s
await page.evaluate(() => { window.__bc.toMenu(); });
await page.waitForFunction(() => window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'media'; window.__bc.startMatch({ startSide: 'atk', seed: 5 }); });
await page.click('#sel-grid .opc:nth-child(1)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
await page.evaluate(() => { const bc = window.__bc, s = bc.session, m = bc.match; window.__step = s.tick.bind(s); s.tick = () => {}; for (let i = 0; i < 60 * 50 && m.phase !== 'action'; i++) window.__step(1 / 60); });
await frames(4); await wait(2000);
const accion = await page.evaluate(() => { const a = window.__bc.audio, m = window.__bc.match; return { fase: m.phase, queda: Math.round(m.timeLeft), nivel: a._mus.level, volumen: +a._mus.bus.gain.value.toFixed(2) }; });
await page.evaluate(() => { window.__bc.match.timer = 25; });
await frames(4); await wait(2500);
const final = await page.evaluate(() => { const a = window.__bc.audio, m = window.__bc.match; return { queda: Math.round(m.timeLeft), nivel: a._mus.level, volumen: +a._mus.bus.gain.value.toFixed(2), notas: a._mus.step }; });
console.log('acción:', JSON.stringify(accion), '· últimos 30 s:', JSON.stringify(final));
check(accion.nivel === 0 && final.nivel === 2 && final.volumen > 0.1, 'la música de los últimos 30 s no va');
// la partida con los bots unos segundos: sonidos por la propagación, sin errores y sin pasar del límite
const lim = await page.evaluate(() => { const bc = window.__bc, H = bc.ctx.hearing; let most = 0; const orig = H.frame.bind(H); H.frame = () => { most = Math.max(most, H.used); orig(); }; bc.session.tick = window.__step; return new Promise((res) => setTimeout(() => res(most), 8000)); });
console.log('rodeos por fotograma, como mucho:', lim);
check(lim <= 12, 'más de 12 rodeos en un fotograma');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

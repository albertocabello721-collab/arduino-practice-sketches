// Prueba de humo del rappel (F10.2a) en el campo de pruebas: desde la calle, Espacio engancha a la
// fachada sur; se sube, se va de lado hasta una ventana de la planta alta, se rompe la barricada y
// se entra; otra vez fuera, se sube hasta asomar por el pretil y al tejado; desde el tejado, de
// vuelta a la cuerda. Otro operador colgado en tercera persona (con su cuerda). Capturas, avisos
// en pantalla y sin errores.
// Uso: node tools/smoke-rappel.mjs <carpeta de capturas> [html]
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
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: `${out}/${name}.png` }); };
// la simulación avanza solo cuando lo pide la prueba; `__run(s, intenciones)` mantiene las teclas
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__run = (sec, keys = {}) => {
    const p = bc.player, I = p.intent;
    for (let i = 0; i < Math.round(sec * 60); i++) { Object.assign(I, keys); window.__step(1 / 60); }
    for (const k of Object.keys(keys)) I[k] = typeof keys[k] === 'boolean' ? false : 0;
  };
  // una pulsación (como en el juego: Espacio cuenta una vez, al pulsarlo)
  window.__tap = (k) => { bc.player.intent[k] = true; window.__step(1 / 60); };
  window.__state = () => {
    const p = bc.player, R = p.rappel;
    return { fase: R ? R.phase : null, x: +p.body.pos.x.toFixed(2), y: +p.body.pos.y.toFixed(2), z: +p.body.pos.z.toFixed(2), sala: bc.map.locationAt(p.body.pos.x, p.body.pos.y + 0.3, p.body.pos.z), aviso: document.getElementById('prompt').textContent };
  };
});
// en la calle, frente a la fachada sur (entre las ventanas de la planta baja), mirándola
await page.evaluate(() => { window.__bc.place(6, 0, -1.2, Math.PI, 0.15); window.__run(0.3); });
await frames(3);
const a = await page.evaluate(() => window.__state());
console.log('al pie:', JSON.stringify(a));
check(/rappel/.test(a.aviso), 'no avisa de que se puede hacer rappel: ' + a.aviso);
await page.evaluate(() => { window.__tap('vault'); window.__run(0.6); });
await page.evaluate(() => window.__run(1.6, { moveZ: 1 }));
await shot('r1_colgado');
const b = await page.evaluate(() => window.__state());
console.log('colgado:', JSON.stringify(b));
check(b.fase === 'hang' && b.y > 2 && /subir y bajar/.test(b.aviso), 'no se engancha o no sube: ' + JSON.stringify(b));
// de lado hasta la ventana de la planta alta (x = 3) y a su altura
await page.evaluate(() => window.__run(3.0, { moveX: 1 }));
await page.evaluate(() => { const p = window.__bc.player; window.__run(4, {}); for (let i = 0; i < 240 && p.body.pos.y < 3.95; i++) window.__run(1 / 60, { moveZ: 1 }); });
await shot('r2_ventana');
const c = await page.evaluate(() => window.__state());
console.log('en la ventana:', JSON.stringify(c));
check(/barricada/.test(c.aviso), 'no avisa de la ventana con barricada: ' + c.aviso);
await page.evaluate(() => { window.__tap('vault'); window.__run(1.4); });
await page.evaluate(() => window.__run(0.4));
await shot('r3_dentro');
const d = await page.evaluate(() => window.__state());
console.log('dentro:', JSON.stringify(d));
check(!d.fase && d.sala === 'Habitación infantil', 'no entra por la ventana: ' + JSON.stringify(d));
// otra vez fuera (fachada sur, este del balcón): arriba del todo, asomando por el pretil, y al tejado
await page.evaluate(() => { window.__bc.place(25, 0, -1.2, Math.PI, 0.3); window.__run(0.3); window.__tap('vault'); window.__run(0.6); window.__run(5.5, { moveZ: 1 }); });
await shot('r4_pretil');
const e = await page.evaluate(() => window.__state());
console.log('arriba:', JSON.stringify(e));
check(e.fase === 'hang' && /tejado/.test(e.aviso), 'arriba del todo no avisa del tejado: ' + JSON.stringify(e));
await page.evaluate(() => { window.__tap('vault'); window.__run(1.0); window.__run(0.3); });
const f = await page.evaluate(() => window.__state());
console.log('tejado:', JSON.stringify(f));
check(!f.fase && Math.abs(f.y - 7) < 0.1 && f.sala === 'Tejado', 'no sube al tejado: ' + JSON.stringify(f));
// desde el tejado, al pretil y a la cuerda
await page.evaluate(() => { window.__bc.place(25, 7.0, 0.8, 0, -0.5); window.__run(0.3); window.__tap('vault'); window.__run(1.1); });
await shot('r5_desde_tejado');
const g = await page.evaluate(() => window.__state());
console.log('desde el tejado:', JSON.stringify(g));
check(g.fase === 'hang' && g.z < -0.4, 'desde el tejado no se engancha: ' + JSON.stringify(g));
// tercera persona: otro operador colgado, visto desde la calle (con su cuerda)
const tp = await page.evaluate(() => {
  const bc = window.__bc, S = bc.session, p = bc.player;
  S.rappel.release(p);
  bc.place(10, 0, -9, Math.PI + 0.35, 0.28);
  window.__run(0.4);
  const o = S.lineup[0];
  const keep = S.rappel.canRappel;
  S.rappel.canRappel = (op) => op === o || keep(op);
  o.body.pos.x = 6; o.body.pos.y = 0; o.body.pos.z = -1.2; o.yaw = Math.PI; o.pitch = 0; o.body.onGround = true;
  const ok = S.rappel.tryHook(o);
  for (let i = 0; i < 40; i++) window.__step(1 / 60);
  for (let i = 0; i < 90; i++) { o.intent.moveZ = 1; window.__step(1 / 60); }
  o.intent.moveZ = 0;
  return { gancho: ok, fase: o.rappel && o.rappel.phase, y: +o.body.pos.y.toFixed(2), cuerdas: bc.ctx.ropes ? bc.ctx.ropes.count : -1 };
});
await shot('r6_tercera');
const tp2 = await page.evaluate(() => ({ cuerdas: window.__bc.ctx.ropes.count }));
console.log('tercera persona:', JSON.stringify({ ...tp, ...tp2 }));
check(tp.gancho && tp.fase === 'hang' && tp2.cuerdas >= 1, 'el otro operador no cuelga o no se ve la cuerda');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

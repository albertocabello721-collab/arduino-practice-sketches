// Prueba de humo de la repetición de muerte (F7.6) en partida: un enemigo te dispara hasta matarte;
// se repiten 4 s antes y 0,5 s después desde sus ojos (con su arma y la tarjeta), y al terminar
// se pasa directo a observar a un compañero (sin los 3 s de tu cuerpo). Después, Espacio corta
// otra repetición. Capturas, comprobaciones y sin errores.
// Uso: node tools/smoke-repeticion.mjs <carpeta de capturas> [html]
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
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.difficulty = 'normal'; bc.startMatch({ startSide: 'atk', seed: 3 }); });
await page.click('#sel-grid .opc:nth-child(1)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(3); await page.screenshot({ path: `${out}/${name}.png` }); };
// la simulación y la repetición solo avanzan cuando lo pide la prueba (sin tarjeta gráfica, cada
// fotograma tarda; al pintar, la repetición se queda en su instante)
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, m = bc.match, me = bc.player;
  window.__step = s.tick.bind(s); s.tick = () => {};
  for (let i = 0; i < 60 * 50 && m.phase !== 'action'; i++) window.__step(1 / 60);
  s.bots.update = () => {};
  const rf = s._replayFrame.bind(s);
  s._replayFrame = () => rf(0);
  // un fotograma de verdad: simulación, personajes, grabar y repetir
  window.__frame = (n, body) => {
    for (let i = 0; i < n; i++) {
      if (body) body();
      window.__step(1 / 60);
      bc.ctx.chars.update(1 / 60, s.viewOp, bc.camera.position);
      rf(1 / 60);
    }
  };
  const killer = m.game.operators.find((o) => o.team !== me.team);
  window.__killer = killer;
  for (const o of m.game.operators) if (o !== me && o !== killer) o.frozen = true;
  // tú en la calle mirando al este; él a 8 m, mirándote
  bc.place(10, 0.01, -12, -Math.PI / 2, 0);
  killer.frozen = false; killer.body.pos.x = 18; killer.body.pos.y = 0.01; killer.body.pos.z = -12; killer.yaw = Math.PI / 2; killer.pitch = 0;
  killer.body.vel.x = killer.body.vel.y = killer.body.vel.z = 0;
  me.plate = false;
  window.__frame(60);
});
// 4,5 s tranquilo y después dispara (apuntando al pecho) hasta que mueres
const aimFire = `
  const bc = window.__bc, me = bc.player, k = window.__killer;
  if (me.state === 'dead') { k.intent.fire = false; return; }
  const e = k.eyePos(), c = me.rig[2].p, dx = c.x - e.x, dy = c.y + 0.08 - e.y, dz = c.z - e.z;
  k.yaw = Math.atan2(-dx, -dz); k.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  k.intent.ads = true; k.intent.fire = window.__fire;`;
await page.evaluate((b) => { window.__fire = false; window.__frame(270, new Function(b)); window.__fire = true; }, aimFire);
const died = await page.evaluate((b) => { const f = new Function(b); for (let i = 0; i < 600 && window.__bc.player.state !== 'dead'; i++) window.__frame(1, f); return { estado: window.__bc.player.state, repeticion: window.__bc.session.replay.active }; }, aimFire);
console.log('muerte:', JSON.stringify(died));
if (died.estado !== 'dead' || !died.repeticion) errors.push('no empezó la repetición: ' + JSON.stringify(died));
const look = () => page.evaluate(() => {
  const bc = window.__bc, s = bc.session, R = s.replay, k = window.__killer, c = bc.camera.position, e = k.eyePos();
  const el = (id) => document.getElementById(id);
  return {
    activa: R.active, t: +(R.clock).toFixed(2), deLa: +(R.t1 - R.t0).toFixed(2),
    tarjeta: el('replay').classList.contains('hidden') ? null : `${el('rp-name').textContent} · ${el('rp-sub').textContent} · vida ${el('rp-hp').textContent} · ${el('rp-dist').textContent}`,
    camaraAlTirador: +Math.hypot(c.x - k.body.pos.x, c.z - k.body.pos.z).toFixed(2),
    arma: bc.ctx.vm.view.visible ? bc.ctx.vm.current : null, armaDelTirador: k.weapon.def.model,
    muerte: !el('death').classList.contains('hidden'), vista: s.viewOp ? s.viewOp.name : null,
    llamadas: bc.perf().calls,
  };
});
await frames(3);
await shot('r1_empieza');
const a = await look();
await page.evaluate(() => window.__frame(150));
await shot('r2_a_mitad');
const b = await look();
await page.evaluate(() => { const R = window.__bc.session.replay; window.__frame(Math.max(0, Math.round((R.t1 - R.t0 - 0.35 - R.clock) * 60))); });
await shot('r3_caes');
const c = await look();
await page.evaluate(() => window.__frame(40));
await frames(3);
await shot('r4_observas');
const d = await look();
console.log('al empezar:', JSON.stringify(a));
console.log('a mitad:', JSON.stringify(b));
console.log('al caer:', JSON.stringify(c));
console.log('después:', JSON.stringify(d));
if (!a.tarjeta || !a.tarjeta.startsWith(await page.evaluate(() => window.__killer.name))) errors.push('la tarjeta no es la del tirador');
if (a.camaraAlTirador > 0.4 || b.camaraAlTirador > 0.4) errors.push('la cámara no está en los ojos del tirador');
if (a.arma !== a.armaDelTirador) errors.push('el arma en primera persona no es la del tirador');
if (d.activa || d.tarjeta || d.muerte || !d.vista) errors.push('después no pasa directo a observar: ' + JSON.stringify(d));
// Espacio corta la repetición (otra, a mano) y también pasa a observar
const skip = await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, m = bc.match;
  const ok = s.replay.start(bc.player, { by: window.__killer, zone: 'body', weapon: window.__killer.weapon.def }, m.time);
  s.deathCamUntil = Infinity;
  window.__frame(10);
  return ok;
});
await page.keyboard.press('Space');
await frames(4);
const e = await look();
console.log('Espacio:', JSON.stringify({ empezo: skip, ...e }));
if (!skip || e.activa || !e.vista) errors.push('Espacio no corta la repetición: ' + JSON.stringify(e));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

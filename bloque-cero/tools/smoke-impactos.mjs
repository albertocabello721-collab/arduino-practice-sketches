// Prueba de humo de la F12.1 (impactos) en el navegador, en el campo de pruebas: dar al maniquí en
// el cuerpo, en la cabeza y rematarlo (tres avisos distintos; el tirón y el polvo del chaleco);
// recibir un balazo desde la derecha (la vista se sacude a la izquierda, el borde derecho se pone
// rojo, pitan los oídos); poca vida (colores apagados y latido); y una bala que pasa a 1 m (el
// chasquido). Capturas de cada momento, y sin errores.
// Uso: node tools/smoke-impactos.mjs <carpeta de capturas> [html]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const check = (ok, what) => { if (!ok) errors.push(what); };
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.audio.init(); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play' && window.__bc.player, null, { timeout: 60000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name, n = 2) => { await frames(n); await page.screenshot({ path: `${out}/${name}.png` }); };
// espías: qué sonidos pide la presentación
await page.evaluate(() => {
  const a = window.__bc.audio;
  window.__calls = [];
  for (const k of ['hitConfirm', 'hurt', 'bulletCrack', 'lowHealth']) {
    const f = a[k].bind(a);
    a[k] = (...args) => { window.__calls.push([k, ...args.map((x) => (typeof x === 'number' ? +x.toFixed(3) : x && x.x !== undefined ? 'pos' : x))]); return f(...args); };
  }
  window.__take = () => { const c = window.__calls; window.__calls = []; return c; };
});
// delante del maniquí 1 (quieto), a 5 m
const aimAt = (bone) => page.evaluate((bone) => {
  const bc = window.__bc, g = bc.game, d = g.operators.find((o) => o.id === 'm1'), p = bc.player;
  const B = { chest: 2, head: 4 }[bone];
  const q = d.rig[B].p, e = p.eyePos();
  p.yaw = Math.atan2(-(q.x - e.x), -(q.z - e.z)); p.pitch = Math.atan2(q.y + (bone === 'head' ? 0.06 : 0) - e.y, Math.hypot(q.x - e.x, q.z - e.z));
  p.ads = 1; p.weapon.bloom = 0;
}, bone);
await page.evaluate(() => {
  const bc = window.__bc, d = bc.game.operators.find((o) => o.id === 'm1');
  bc.place(d.body.pos.x + 3.2, 0.01, d.body.pos.z - 3.8, 0, 0);
});
await frames(20);
await aimAt('chest');
await frames(2);
await page.evaluate(() => { window.__take(); window.__bc.fire(1); });
await frames(3);
const j = await page.evaluate(() => { const bc = window.__bc, d = bc.game.operators.find((o) => o.id === 'm1'), v = bc.ctx.chars.views.get(d.id); return { tirón: !!(v && v.jolt), vida: d.hp, sonidos: window.__take() }; });
await shot('i1_cuerpo_polvo', 1);
console.log('al cuerpo:', JSON.stringify(j));
check(j.sonidos.some((c) => c[0] === 'hitConfirm' && c[1] === 'hit'), 'al cuerpo no suena el aviso de cuerpo');
check(j.tirón, 'el maniquí no da el tirón');
await frames(30);
await aimAt('head');
await frames(2);
await page.evaluate(() => { window.__take(); window.__bc.fire(1); });
await frames(3);
const h = await page.evaluate(() => ({ sonidos: window.__take(), estado: window.__bc.game.operators.find((o) => o.id === 'm1').state }));
console.log('a la cabeza:', JSON.stringify(h));
check(h.sonidos.some((c) => c[0] === 'hitConfirm' && c[1] === 'head'), 'a la cabeza no suena el «tin» del casco');
// otro maniquí: derribo y baja sin tiro a la cabeza
const k = await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player, d = g.operators.find((o) => o.id === 'm3');
  window.__take();
  const dir = { x: 0, y: 0, z: -1 }, point = { x: d.body.pos.x, y: d.body.pos.y + 1.2, z: d.body.pos.z };
  g.damage(d, d.hp + 5, { by: p, zone: 'body', dir, point, weapon: p.weapon.def });
  const a = window.__take();
  g.damage(d, 30, { by: p, zone: 'body', dir, point, weapon: p.weapon.def });
  return { derribo: a, baja: window.__take(), estado: d.state };
});
console.log('derribo y baja:', JSON.stringify(k));
check(k.derribo.some((c) => c[0] === 'hitConfirm' && c[1] === 'down'), 'el derribo no suena como derribo');
check(k.baja.some((c) => c[0] === 'hitConfirm' && c[1] === 'kill'), 'la baja no suena como baja');
// recibir un balazo de 50 desde la derecha (el tirador a la derecha del jugador)
const r = await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player, d = g.operators.find((o) => o.id === 'm5');
  p.yaw = 0; p.pitch = 0; p.hp = p.maxHp;
  const e = p.eyePos();
  d.body.pos.x = e.x + 6; d.body.pos.z = e.z; d.body.pos.y = p.body.pos.y;
  window.__take();
  g.damage(p, 50, { by: d, zone: 'body', dir: { x: -1, y: 0, z: 0 }, point: { x: e.x + 0.2, y: e.y - 0.4, z: e.z }, weapon: d.weapon.def });
  return { kick: { ...bc.ctx.kick }, lado: { ...bc.ctx.dmgDir }, sonidos: window.__take() };
});
await shot('i2_balazo_derecha', 2);
console.log('balazo desde la derecha:', JSON.stringify(r));
check(r.kick.yaw > 0 && r.kick.pitch > 0, 'la vista no se va hacia arriba y a la izquierda');
check(r.lado.x > 0.9 && r.lado.k > 0.5, 'el borde rojo no es el derecho');
check(r.sonidos.some((c) => c[0] === 'hurt' && c[1] >= 40), 'no suena el golpe');
// poca vida
await page.evaluate(() => { window.__bc.player.hp = 18; window.__take(); });
await frames(20);
const low = await page.evaluate(() => ({ sat: +window.__bc.post.grade.uniforms.uSat.value.toFixed(2), latido: window.__take().filter((c) => c[0] === 'lowHealth') }));
await shot('i3_poca_vida', 1);
console.log('poca vida:', JSON.stringify(low));
check(low.sat < 0.8, 'con poca vida los colores no se apagan');
check(low.latido.some((c) => c[1] > 0), 'con poca vida no late el corazón');
await page.evaluate(() => { window.__bc.player.hp = window.__bc.player.maxHp; });
await frames(10);
const back = await page.evaluate(() => ({ sat: +window.__bc.post.grade.uniforms.uSat.value.toFixed(2), latido: window.__take().filter((c) => c[0] === 'lowHealth') }));
console.log('vida llena:', JSON.stringify(back));
check(back.sat > 0.9 && back.latido.some((c) => c[1] === 0), 'con la vida llena no vuelve todo a su sitio');
// una bala del tirador que pasa a 1 m por delante de los ojos
const nm = await page.evaluate(() => {
  const bc = window.__bc, g = bc.game, p = bc.player, d = g.operators.find((o) => o.id === 'm5');
  const e = p.eyePos(), from = { x: e.x + 12, y: e.y, z: e.z - 1 };
  window.__take();
  g.fireBullet(d, from, { x: -1, y: 0, z: 0 }, d.weapon);
  return { sonidos: window.__take() };
});
console.log('bala cerca:', JSON.stringify(nm));
check(nm.sonidos.some((c) => c[0] === 'bulletCrack' && c[2] > 0.9 && c[2] < 1.1), 'la bala que pasa a 1 m no suena');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

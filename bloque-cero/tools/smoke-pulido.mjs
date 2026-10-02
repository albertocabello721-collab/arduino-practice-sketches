// Prueba de humo del pulido de la F10.4c en el navegador:
//  · la pantalla de carga de 3 s con el plano: defendiendo, con las salas A y B en naranja; atacando,
//    sin ellas; Espacio la salta; si no, pasa sola a los 3 s; la selección dura 20 s;
//  · humo del cañón tras 8 disparos seguidos (1,5 s) y no antes;
//  · un aliado tras una pared a menos de 40 m: su contorno azul (un anillo, el interior sigue siendo la pared) y su nombre;
//  · Ajustes → Sombras: altas (4096), bajas (2048) y sin sombras (sin la pasada);
//  · sin captura del ratón (falla el bloqueo): el ratón mueve la vista igual, aviso una vez, sin flecha;
//  · M enseña el medidor (F3 ya no); el cielo sin la franja de colinas; sin errores.
// Uso: node tools/smoke-pulido.mjs [carpeta para capturas] [html]
import { createRequire } from 'node:module';
import path from 'node:path';
import { readPNG } from './png.mjs';
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
const check = (ok, what) => { if (!ok) errors.push(what); console.log((ok ? '  ok  ' : '  MAL ') + what); };
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const P = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
// cuántos píxeles de un color hay en una zona de la captura (fracciones de la imagen)
const countPx = (buf, box, pred) => {
  const img = readPNG(buf), x0 = Math.floor(box[0] * img.w), y0 = Math.floor(box[1] * img.h), x1 = Math.floor(box[2] * img.w), y1 = Math.floor(box[3] * img.h);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.w + x) * img.ch; if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) n++; }
  return n;
};

await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.mouse.click(5, 5);
await P(() => { const bc = window.__bc; bc.settings.quality = 'baja'; bc.post.setQuality('baja'); bc.settings.announcer = false; bc.settings.opVoice = false; });

// ---------------------------------------------------------------- la pantalla de carga: defendiendo
console.log('pantalla de carga');
await P(() => window.__bc.startMatch({ startSide: 'def', seed: 7 }));
await page.waitForFunction(() => window.__bc.match && window.__bc.match.phase === 'select', null, { timeout: 60000 });
await frames(3);
const sel = await P(() => ({ rules: window.__bc.match.rules.selectTime, timer: document.getElementById('sel-timer').textContent }));
check(sel.rules === 20 && /^0:(20|19)$/.test(sel.timer), `la selección dura 20 s (${sel.timer})`);
await page.click('#sel-grid .opc:nth-child(1)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'load', null, { timeout: 30000 });
const loadWall = Date.now();
// (el plano se dibuja en el mismo tick en que empieza la fase: se lee ya, sin esperar fotogramas)
const ld = await P(() => {
  const bc = window.__bc, m = bc.match, cv = document.getElementById('ld-plan'), c = cv.getContext('2d');
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let naranja = 0, pared = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 100 && d[i + 1] < 170 && d[i + 2] < 90) naranja++; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) pared++; }
  return { visible: !document.getElementById('loadscreen').classList.contains('hidden'), lado: document.getElementById('ld-side').textContent, nota: document.getElementById('ld-note').textContent, naranja, pared, timer: +m.timer.toFixed(2), paused: bc.ctx.paused, t0: m.time, hud: document.getElementById('hud').classList.contains('hidden') };
});
await shot('f104_01_carga_defensa');
console.log('  defensa:', JSON.stringify(ld));
check(ld.visible && ld.lado === 'Defensa' && ld.hud, 'defendiendo: la pantalla de carga con el plano (y el HUD escondido)');
check(ld.pared > 2000, `el plano tiene paredes (${ld.pared} píxeles)`);
check(ld.naranja > 300 && /Defendéis/.test(ld.nota), `defendiendo se ven A y B en naranja (${ld.naranja} píxeles · «${ld.nota}»)`);
check(ld.timer > 0 && ld.timer <= 3 && !ld.paused, `dura 3 s (quedan ${ld.timer}) y no está en pausa`);
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 150000 });
// (dura 3 s de juego o 3 s de reloj, lo que antes llegue: en esta máquina lenta, los de reloj)
const auto = await P((t0) => ({ dt: +(window.__bc.match.time - t0).toFixed(2), hidden: document.getElementById('loadscreen').classList.contains('hidden') }), ld.t0);
auto.wall = +((Date.now() - loadWall) / 1000).toFixed(1);
check(auto.dt <= 3.3 && auto.wall >= 2.5 && auto.hidden, `sin tocar nada, pasa sola a los 3 s (${auto.dt} s de juego, ${auto.wall} s de reloj) y se esconde`);
// ---------------------------------------------------------------- atacando: sin A ni B, y Espacio la salta
await P(() => window.__bc.toMenu());
await page.waitForFunction(() => window.__bc.state.mode === 'menu');
await P(() => window.__bc.startMatch({ startSide: 'atk', seed: 7 }));
await page.waitForFunction(() => window.__bc.match && window.__bc.match.phase === 'select', null, { timeout: 60000 });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'load', null, { timeout: 30000 });
const la = await P(() => {
  const cv = document.getElementById('ld-plan'), c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
  let naranja = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 100 && d[i + 1] < 170 && d[i + 2] < 90) naranja++;
  return { lado: document.getElementById('ld-side').textContent, nota: document.getElementById('ld-note').textContent, naranja, timer: +window.__bc.match.timer.toFixed(2) };
});
await shot('f104_02_carga_ataque');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 10000 });
const skipped = await P(() => ({ hidden: document.getElementById('loadscreen').classList.contains('hidden'), timer: +window.__bc.match.timer.toFixed(2) }));
console.log('  ataque:', JSON.stringify({ ...la, ...skipped }));
check(la.lado === 'Ataque' && la.naranja < 20 && /drones/.test(la.nota), 'atacando no se ven A ni B');
check(la.timer > 1 && skipped.hidden, `Espacio la salta (quedaban ${la.timer} s) y se esconde`);

// ---------------------------------------------------------------- la silueta y el nombre de un aliado tras una pared
console.log('aliados');
await P(() => { const m = window.__bc.match; m.timer = 0.3; });
await page.waitForFunction(() => window.__bc.match.phase === 'action', null, { timeout: 30000 });
const al = await P(async () => {
  const bc = window.__bc, s = bc.session, g = s.game, p = bc.player, map = bc.map;
  s.bots.update = () => {};
  window.__step = s.tick.bind(s); s.tick = () => {};
  for (const o of g.operators) if (o !== p) Object.assign(o.intent, { fire: false, ads: false, moveX: 0, moveZ: 0, sprint: false });
  // el jugador en la calle mirando a la fachada; un aliado dentro, en el recibidor (tras la pared)
  const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive');
  const foe = g.operators.find((o) => o.team !== p.team && o.state === 'alive');
  const r = map.rooms.find((q) => q.id === 'F_recibidor');
  const ax = (r.x0 + r.x1) / 2, az = (r.z0 + r.z1) / 2;
  ally.body.pos.x = ax; ally.body.pos.y = 0; ally.body.pos.z = az; ally.yaw = Math.PI;
  bc.place(ax, 0, -7, Math.PI, 0.02);
  for (let i = 0; i < 3; i++) window.__step(1 / 60);
  await new Promise((res) => { let k = 0; const f = () => (++k >= 6 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const v = bc.ctx.chars.views.get(ally.id), vf = bc.ctx.chars.views.get(foe.id);
  const names = [...document.querySelectorAll('#markers .mk.mate')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
  const dist = Math.hypot(ally.body.pos.x - p.body.pos.x, ally.body.pos.z - p.body.pos.z);
  return { nombre: ally.name, dist: +dist.toFixed(1), silueta: v.sil.visible, enemigo: vf.sil.visible, nombres: names, sala: map.roomAt(ally.body.pos.x, 1, ally.body.pos.z) && map.roomAt(ally.body.pos.x, 1, ally.body.pos.z).name };
});
await frames(3);
// el contorno (V1): un anillo azul en el borde del aliado tapado; el interior conserva la pared
await page.evaluate(() => { window.__bc.post.grade.uniforms.uGrain.value = 0; });
await frames(2);
const cap = await page.screenshot({ path: path.join(out, 'f104_03_silueta.png') });
const azul = (r, g, b) => b > r + 35 && b > g + 8 && b > 110;
const azules = countPx(cap, [0.3, 0.15, 0.7, 0.75], azul);
const sinAliado = await (async () => { await P(() => { const bc = window.__bc, p = bc.player, g = bc.session.game; const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive'); ally.frozen = true; }); await frames(3); const b = await page.screenshot({ path: path.join(out, 'f104_03b_sin_aliado.png') }); await P(() => { const bc = window.__bc, p = bc.player, g = bc.session.game; const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive'); ally.frozen = false; }); return b; })();
const meanDiff = (A, B, box) => { const a = readPNG(A), b = readPNG(B); const x0 = Math.floor(box[0] * a.w), y0 = Math.floor(box[1] * a.h), x1 = Math.floor(box[2] * a.w), y1 = Math.floor(box[3] * a.h); let n = 0, d = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * a.w + x) * a.ch; for (let c = 0; c < 3; c++) d += Math.abs(a.data[i + c] - b.data[i + c]); n += 3; } return d / n; };
const pecho = meanDiff(cap, sinAliado, [0.485, 0.515, 0.515, 0.545]);
console.log('  aliado:', JSON.stringify({ ...al, azules, pecho: +pecho.toFixed(1) }));
check(al.silueta && !al.enemigo && al.dist < 40, `el aliado a ${al.dist} m lleva contorno (y el enemigo no)`);
check(al.nombres.includes(al.nombre), `su nombre en pantalla (${al.nombres.join(', ')})`);
check(azules > 40, `el contorno azul se ve a través de la pared (${azules} píxeles azules)`);
check(pecho < 12, `el contorno no tapa lo que hay detrás: el pecho del aliado conserva la pared (diferencia media ${pecho.toFixed(1)})`);
// a la vista, sin contorno: los mismos píxeles azules con el ajuste encendido y apagado
const vista = await (async () => {
  await P(() => { const bc = window.__bc, p = bc.player, g = bc.session.game, map = bc.map; const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive'); const r = map.rooms.find((q) => q.id === 'F_recibidor'); const ax = (r.x0 + r.x1) / 2, az = (r.z0 + r.z1) / 2; bc.place(ax, 0, az - 3, Math.PI, 0.0); for (let i = 0; i < 3; i++) window.__step(1 / 60); });
  await frames(3);
  const on = countPx(await page.screenshot({ path: path.join(out, 'f104_03c_a_la_vista.png') }), [0.4, 0.42, 0.6, 0.88], azul);
  await P(() => { window.__bc.settings.allyOutline = false; });
  await frames(3);
  const off = countPx(await page.screenshot(), [0.4, 0.42, 0.6, 0.88], azul);
  await P(() => { window.__bc.settings.allyOutline = true; window.__bc.post.grade.uniforms.uGrain.value = 0.035; });
  return { on, off };
})();
check(Math.abs(vista.on - vista.off) <= 6, `a la vista no hay contorno (azules con el ajuste: ${vista.on}, sin él: ${vista.off})`);
// y a más de 40 m, sin contorno
const lejos = await P(async () => {
  const bc = window.__bc, g = bc.session.game, p = bc.player;
  const ally = g.operators.find((o) => o.team === p.team && o !== p && o.state === 'alive');
  ally.body.pos.x = p.body.pos.x + 34; ally.body.pos.z = p.body.pos.z + 30;     // (dentro del mapa: ~45 m)
  window.__step(1 / 60);
  await new Promise((res) => { let k = 0; const f = () => (++k >= 4 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const d = Math.hypot(ally.body.pos.x - p.body.pos.x, ally.body.pos.z - p.body.pos.z);
  return { sil: bc.ctx.chars.views.get(ally.id).sil.visible, dist: +d.toFixed(1) };
});
check(!lejos.sil && lejos.dist > 40, `a más de 40 m (${lejos.dist} m), sin contorno`);
// escala y exposición (V1): el ajuste adaptativo nunca quita el MSAA; la exposición no pasa de 1,2 en el hall
const calidad = await P(async () => {
  const bc = window.__bc;
  bc.post.setAdaptiveLevel(4, 'alta'); const msaaMin = bc.post.msaa; bc.post.setAdaptiveLevel(0, 'alta');
  bc.place(17, 0, 12, 0, 0);
  await new Promise((res) => { let k = 0; const f = () => (++k >= 70 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  return { msaaMin, exposicion: +bc.renderer.toneMappingExposure.toFixed(2) };
});
console.log('  calidad:', JSON.stringify(calidad));
check(calidad.msaaMin === 4, `con el ajuste adaptativo al mínimo el MSAA sigue a 4 (${calidad.msaaMin})`);
check(calidad.exposicion <= 1.21 && calidad.exposicion >= 0.6, `la exposición en el hall no pasa de 1,2 (${calidad.exposicion})`);

// ---------------------------------------------------------------- humo del cañón
console.log('humo del cañón');
const hum = await P(async () => {
  const bc = window.__bc, E = bc.effects, p = bc.player;
  const n0 = E.dust.length;
  bc.fire(5);
  await new Promise((res) => { let k = 0; const f = () => (++k >= 3 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const pocos = E.smokers.length;
  // 8 seguidos (en el mismo tick: menos de 0,3 s entre ellos)
  bc.fire(8);
  const con = E.smokers.length;
  await new Promise((res) => { let k = 0; const f = () => (++k >= 8 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const n1 = E.dust.length;
  // y a los 1,5 s se apaga
  for (let i = 0; i < 20; i++) E.update(0.1, bc.camera.position);
  return { pocos, con, polvo: n1 - n0, luego: E.smokers.length, muerto: p.state };
});
await shot('f104_04_humo');
console.log('  humo:', JSON.stringify(hum));
check(hum.pocos === 0 && hum.con === 1, 'con 5 disparos no humea; con 8 seguidos, sí');
check(hum.polvo > 5 && hum.luego === 0, `salen partículas de humo (${hum.polvo}) y a los 1,5 s se apaga`);

// ---------------------------------------------------------------- sombras
console.log('sombras');
const sh = await P(async () => {
  const bc = window.__bc, wr = bc.wr, el = document.getElementById('set-shadows');
  const set = (v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const r = {};
  set('sin'); r.sin = { on: wr.uniforms.uShadowOn.value, size: wr.shadowTarget.width };
  set('bajas'); r.bajas = { on: wr.uniforms.uShadowOn.value, size: wr.shadowTarget.width, texel: wr.uniforms.uShadowTexel.value };
  set('altas'); r.altas = { on: wr.uniforms.uShadowOn.value, size: wr.shadowTarget.width };
  r.guardado = bc.settings.shadows;
  return r;
});
console.log('  sombras:', JSON.stringify(sh));
check(sh.sin.on === 0 && sh.bajas.on === 1 && sh.bajas.size === 2048 && Math.abs(sh.bajas.texel - 1 / 2048) < 1e-9 && sh.altas.size === 4096 && sh.guardado === 'altas', 'Sombras: sin, bajas (2048) y altas (4096)');
await frames(4);
await shot('f104_05_sombras_altas');

// ---------------------------------------------------------------- sin captura del ratón, M, horizonte
console.log('sin captura, M y horizonte');
const nc = await P(async () => {
  const bc = window.__bc, p = bc.player, I = bc.ctx.input;
  document.dispatchEvent(new Event('pointerlockerror'));
  await new Promise((res) => { let k = 0; const f = () => (++k >= 3 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const y0 = p.yaw;
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: 60, movementY: 0, bubbles: true }));
  await new Promise((res) => { let k = 0; const f = () => (++k >= 3 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  return { noLock: I.noLock, giro: +(y0 - p.yaw).toFixed(3), aviso: document.getElementById('toast').textContent, cursor: document.body.style.cursor, paused: bc.ctx.paused };
});
console.log('  sin captura:', JSON.stringify(nc));
check(nc.noLock && nc.giro > 0.05 && !nc.paused, `sin captura, el ratón mueve la vista (${nc.giro} rad) y no hay pausa`);
check(/Sin captura/.test(nc.aviso) && nc.cursor === 'none', 'avisa una vez y esconde la flecha');
await page.keyboard.press('KeyM');
await frames(2);
const m1 = await P(() => ({ perf: window.__bc.settings.showPerf, check: document.getElementById('set-perf').checked }));
await page.keyboard.press('F3');
await frames(2);
const m2 = await P(() => window.__bc.settings.showPerf);
await page.keyboard.press('KeyM');
await frames(2);
check(m1.perf === true && m1.check === true && m2 === true && (await P(() => window.__bc.settings.showPerf)) === false, 'M enseña y esconde el medidor (F3 ya no)');
const sky = await P(() => ({ hill: /hill/.test(window.__bc.wr.sky.material.fragmentShader), shadowOn: window.__bc.wr.uniforms.uShadowOn.value }));
check(!sky.hill, 'el cielo sin la franja de colinas');
// (desde la calle, mirando al este a lo largo de ella, un poco hacia arriba: el horizonte al fondo)
await P(() => { window.__bc.place(2, 0, -12, -Math.PI / 2, 0.12); window.__step(1 / 60); });
await frames(4);
await shot('f104_06_horizonte');

console.log('errores:', errors.length ? '\n' + errors.join('\n') : 0);
await browser.close();
process.exit(errors.length ? 1 : 0);

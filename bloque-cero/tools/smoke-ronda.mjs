// Prueba de humo de la F12.4 (inicio y fin de ronda) en el navegador, en una ronda de verdad:
//  · al empezar la preparación, el rótulo «Ronda 1 · Atacas · Planta… · objetivo sin localizar» con los 10
//    retratos (5 y 5, con nombre) y, a los 3,6 s, se va;
//  · la cuenta atrás 3, 2, 1 (con su nota cada una) al final de la preparación;
//  · al quedarte solo, «1 contra 5 · Eres el último», y cambia al caer enemigos;
//  · la última baja, a cámara lenta (el tiempo de juego a un 30 %) y de vuelta a velocidad normal;
//  · el cartel: ronda ganada, el motivo, la última baja y el mejor de la ronda. Sin errores.
// Uso: node tools/smoke-ronda.mjs [carpeta para capturas] [html]
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
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.mouse.click(5, 5);
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'baja'; bc.post.setQuality('baja'); bc.settings.announcer = false; bc.startMatch({ startSide: 'atk', seed: 5 }); });
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });

// ---------------- el rótulo de inicio
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, a = bc.audio;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__frame = s.frame.bind(s);
  window.__runF = (sec, each = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); window.__frame(1 / 60); if (each && each()) return i; } return -1; };
  bc.player.frozen = true;
  window.__counts = [];
  const cd = a.countdown.bind(a);
  a.countdown = (n) => { window.__counts.push(n); return cd(n); };
});
await wait(900);
const intro = await page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const pic = (id) => [...$(id).querySelectorAll('.ip')].map((p) => ({ img: !!(p.querySelector('img') && p.querySelector('img').src.startsWith('data:')), name: p.querySelector('b').textContent, me: p.classList.contains('me') }));
  return { visible: !$('intro').classList.contains('hidden'), round: $('in-round').textContent, side: $('in-side').textContent, obj: $('in-obj').textContent, ally: pic('in-ally'), enemy: pic('in-enemy') };
});
await shot('f124_01_rotulo');
console.log('rótulo:', JSON.stringify({ ...intro, ally: intro.ally.map((p) => p.name + (p.me ? '*' : '')), enemy: intro.enemy.map((p) => p.name) }));
check(intro.visible && intro.round === 'Ronda 1' && intro.side === 'Atacas' && intro.obj.includes('objetivo sin localizar'), 'el rótulo de inicio no dice la ronda, el bando y el objetivo');
check(intro.ally.length === 5 && intro.enemy.length === 5 && [...intro.ally, ...intro.enemy].every((p) => p.img && p.name), 'el rótulo no lleva los 10 retratos con nombre');
check(intro.ally.filter((p) => p.me).length === 1, 'tu retrato no está marcado');
const gone = await page.evaluate(() => { window.__runF(3.2); return document.getElementById('intro').classList.contains('hidden'); });
check(gone, 'el rótulo no se va');

// ---------------- la cuenta atrás al final de la preparación
const count = await page.evaluate(() => {
  const m = window.__bc.match, el = document.getElementById('countdown');
  m.timer = 3.6;
  const seen = [];
  window.__runF(4, () => { const v = el.classList.contains('hidden') ? '' : el.textContent; if (v && seen[seen.length - 1] !== v) seen.push(v); return m.phase === 'action'; });
  return { seen, notes: window.__counts.slice(), phase: m.phase, phaseText: document.getElementById('pb-t').textContent };
});
console.log('cuenta atrás:', JSON.stringify(count));
check(count.seen.join() === '3,2,1' && count.notes.join() === '3,2,1', 'la cuenta atrás no es 3, 2, 1');
check(count.phase === 'action' && count.phaseText === '¡Acción!', 'tras la cuenta atrás no llega la acción');

// ---------------- «1 contra N»: te quedas solo
const clutch = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, g = m.game, p = bc.player, $ = (id) => document.getElementById(id);
  for (const o of g.operators) if (o.team === p.team && o !== p && o.state !== 'dead') g.kill(o, { by: null });
  window.__runF(0.2);
  const a = { visible: !$('clutch').classList.contains('hidden'), t: $('cl-t').textContent, s: $('cl-s').textContent, cls: $('clutch').className };
  const foes = m.opsOfSide('def').filter((o) => o.state === 'alive');
  for (const o of foes.slice(0, foes.length - 1)) g.kill(o, { by: p, headshot: false });
  window.__runF(0.2);
  const b = { t: $('cl-t').textContent, s: $('cl-s').textContent };
  return { a, b };
});
await shot('f124_02_uno_contra');
console.log('1 contra N:', JSON.stringify(clutch));
check(clutch.a.visible && clutch.a.t === '1 contra 5' && clutch.a.s === 'Eres el último' && clutch.a.cls === 'mine', 'al quedarte solo no sale «1 contra 5 · Eres el último»');
check(clutch.b.t === '1 contra 1', 'el aviso no cambia al caer enemigos');

// ---------------- la última baja: cámara lenta y el cartel
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, g = m.game, p = bc.player;
  window.__scales = [];
  const rec = () => { window.__scales.push(bc.ctx.timeScale); if (window.__scales.length < 150) requestAnimationFrame(rec); };
  const last = m.opsOfSide('def').find((o) => o.state === 'alive');
  g.kill(last, { by: p, headshot: true });
  window.__step(1 / 60);       // (la ronda acaba en este paso)
  requestAnimationFrame(rec);
});
await wait(400);
await shot('f124_03_camara_lenta');
await page.waitForFunction(() => window.__scales.length >= 150 || (window.__scales.length > 5 && window.__scales[window.__scales.length - 1] === 1 && !window.__bc.session.slowmo.active), null, { timeout: 60000 }).catch(async () => { console.log("escalas:", JSON.stringify(await page.evaluate(() => ({ n: window.__scales.length, ultimas: window.__scales.slice(-8), activa: window.__bc.session.slowmo.active, t: window.__bc.session.slowmo.t })))); });
await wait(800);
const fin = await page.evaluate(() => {
  const $ = (id) => document.getElementById(id), sc = window.__scales;
  return {
    fase: window.__bc.match.phase,
    lenta: +Math.min(...sc).toFixed(2), alFinal: sc[sc.length - 1], fotogramasLentos: sc.filter((x) => x < 0.99).length,
    cartel: !$('banner').classList.contains('hidden'), t: $('bn-t').textContent, s: $('bn-s').textContent, d: $('bn-d').textContent,
    mejor: $('bn-mvp').classList.contains('hidden') ? '' : $('bn-mvp').textContent,
  };
});
await shot('f124_04_cartel');
console.log('fin de ronda:', JSON.stringify(fin));
check(fin.fase === 'roundEnd' && fin.lenta <= 0.31 && fin.alFinal === 1 && fin.fotogramasLentos >= 3, 'la última baja no va a cámara lenta (o no vuelve a velocidad normal)');
check(fin.cartel && fin.t === 'Ronda ganada' && fin.s === 'Defensores eliminados' && fin.d.startsWith('Última baja: Tú a ') && fin.d.endsWith('a la cabeza'), 'el cartel no dice el motivo y la última baja');
check(/Mejor de la ronda\s*Tú/.test(fin.mejor) && fin.mejor.includes('5 bajas'), 'el cartel no dice el mejor de la ronda');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

// Prueba de humo de la F12.3 (música) en el navegador, en una ronda de verdad:
//  · en el menú suena la del menú; los deslizadores de Opciones (efectos, música y voz) mueven cada
//    uno su bus, y la voz del navegador sale con el volumen general × voz;
//  · selección → la del menú; preparación → percusión; acción → silencio; el primer daño entre bandos
//    → un golpe (uno solo); los últimos 30 s → tensión; plantado → un pulso de la música por cada
//    pitido, cada vez más seguidos; fin de ronda → victoria o derrota y silencio. Sin errores.
// Uso: node tools/smoke-musica.mjs [html]
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
const check = (ok, what) => { if (!ok) errors.push(what); };
// la voz del navegador: apunta el texto y el volumen
await page.addInitScript(() => {
  window.__said = [];
  const fake = { speaking: false, pending: false, getVoices() { return []; }, speak(u) { window.__said.push({ text: u.text, volume: u.volume }); }, cancel() {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { get: () => fake, configurable: true });
});
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const wait = (ms) => page.waitForTimeout(ms);
// lo que suena ahora: el modo, k, la ganancia de su capa y cuántas semicorcheas lleva
const now = () => page.evaluate(() => {
  const M = window.__bc.audio._music;
  if (!M) return null;
  return { modo: M.mode, k: +M.k.toFixed(3), capa: M.mode ? +M.layers[M.mode].gain.value.toFixed(2) : 0, pasos: M.step, pulsos: M.beats };
});
// lo que sale de verdad por el bus de la música (dB, el trozo más fuerte en `ms`): un analizador
// colgado de él (la ganancia de una capa sin notas no se recalcula, así que no sirve para el silencio)
// (se mide durante \`sec\` s del reloj del audio, que en esta máquina sin sonido va más lento que el de pared)
const level = (sec = 1.5) => page.evaluate(async (sec) => {
  const a = window.__bc.audio;
  if (!window.__an) { const an = a.ctx.createAnalyser(); an.fftSize = 2048; a.musicOut.connect(an); window.__an = an; }
  const buf = new Float32Array(2048);
  let best = 0;
  const t0 = a.ctx.currentTime, w0 = performance.now();
  while (a.ctx.currentTime - t0 < sec && performance.now() - w0 < 20000) {
    window.__an.getFloatTimeDomainData(buf);
    let e = 0;
    for (const v of buf) e += v * v;
    best = Math.max(best, e / buf.length);
    await new Promise((r) => setTimeout(r, 30));
  }
  return +(10 * Math.log10(best + 1e-20)).toFixed(1);
}, sec);

// ---------------- menú: el primer clic arranca el audio y suena la música del menú
await page.mouse.click(5, 5);
await frames(4); await wait(2500);
const menu = await now();
menu.nivel = await level();
console.log('menú:', JSON.stringify(menu));
check(menu && menu.modo === 'menu' && menu.capa > 0.1 && menu.pasos > 0 && menu.nivel > -50, 'no suena la música del menú');

// ---------------- Opciones: cada deslizador mueve su bus; la voz, general × voz
const vol = await page.evaluate(async () => {
  const bc = window.__bc, a = bc.audio;
  const slide = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  slide('set-vol', 0.8); slide('set-vol-sfx', 0.5); slide('set-vol-music', 0.4); slide('set-vol-voice', 0.3);
  await new Promise((r) => setTimeout(r, 400));
  const r = {
    ajustes: [bc.settings.volume, bc.settings.sfxVolume, bc.settings.musicVolume, bc.settings.voiceVolume],
    textos: ['out-vol-sfx', 'out-vol-music', 'out-vol-voice'].map((id) => document.getElementById(id).textContent),
    efectos: +a.sfx.gain.value.toFixed(2), avisos: +a.dry.gain.value.toFixed(2), musica: +a.musicOut.gain.value.toFixed(2), voz: +a.voice.gain.value.toFixed(2), general: +a.master.gain.value.toFixed(2),
  };
  window.__said = [];
  bc.ctx.voice.announce('Prueba.');
  r.vozNavegador = window.__said.map((x) => +x.volume.toFixed(3));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('bloque-cero:ajustes:v2')); } catch (e) { /* sin almacenamiento */ }
  r.guardado = saved ? [saved.sfxVolume, saved.musicVolume, saved.voiceVolume] : null;
  // y todo de vuelta al máximo para el resto de la prueba
  slide('set-vol-sfx', 1); slide('set-vol-music', 1); slide('set-vol-voice', 1);
  return r;
});
console.log('volúmenes:', JSON.stringify(vol));
check(vol.ajustes.join() === '0.8,0.5,0.4,0.3' && vol.textos.join() === '50,40,30', 'los deslizadores no cambian los ajustes');
check(vol.efectos === 0.5 && vol.avisos === 0.5 && vol.musica === 0.4 && vol.voz === 0.3 && vol.general === 0.8, 'los deslizadores no mueven cada uno su bus');
check(vol.vozNavegador.length === 1 && Math.abs(vol.vozNavegador[0] - 0.24) < 0.01, 'la voz del navegador no sale a general × voz');
check(!vol.guardado || vol.guardado.join() === '0.5,0.4,0.3', 'los volúmenes no se guardan');

// ---------------- partida: selección (la del menú) y preparación (percusión)
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'baja'; bc.post.setQuality('baja'); bc.startMatch({ startSide: 'atk', seed: 5 }); });
await page.waitForFunction(() => window.__bc.match && window.__bc.match.phase === 'select', null, { timeout: 120000 });
await frames(4); await wait(800);
const sel = await now();
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, a = bc.audio;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__run = (sec, until = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); if (until && until()) return i; } return -1; };
  // lo mismo con lo de cada fotograma (ahí pita el desactivador)
  window.__frame = s.frame.bind(s);
  window.__runF = (sec, until = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); window.__frame(1 / 60); if (until && until()) return i; } return -1; };
  bc.player.frozen = true;
  // qué remates suenan y cuándo pita el desactivador y late la música
  window.__stings = []; window.__beeps = []; window.__beats = [];
  const st = a.stinger.bind(a), db = a.defuserBeep.bind(a), mb = a.musicBeat.bind(a);
  a.stinger = (kind) => { window.__stings.push(kind); return st(kind); };
  a.defuserBeep = (...args) => { window.__beeps.push(bc.match.game.time); return db(...args); };
  a.musicBeat = (p) => { window.__beats.push({ t: bc.match.game.time, p: +p.toFixed(3) }); return mb(p); };
});
await frames(4); await wait(1500);
const prep = await now();
prep.nivel = await level();
console.log('selección:', JSON.stringify(sel), '· preparación:', JSON.stringify(prep));
check(sel && sel.modo === 'menu', 'en la selección no suena la del menú');
check(prep.modo === 'prep' && prep.capa > 0.1 && prep.pasos > 0 && prep.nivel > -55, 'en la preparación no suena la percusión');

// ---------------- acción: silencio; el primer daño entre bandos, un golpe (y solo uno)
await page.evaluate(() => window.__run(60, () => window.__bc.match.phase === 'action'));
await frames(4); await wait(2000);
const accion = await now();
accion.nivel = await level();
const golpe = await page.evaluate(() => {
  const bc = window.__bc, g = bc.match.game, p = bc.player;
  const foes = bc.match.opsOfSide('def').filter((o) => o.state === 'alive');
  window.__stings = [];
  g.damage(foes[0], 10, { by: p, zone: 'body', dir: { x: 1, y: 0, z: 0 }, point: foes[0].eyePos(), weapon: p.weapon.def });
  g.damage(foes[1], 10, { by: p, zone: 'body', dir: { x: 1, y: 0, z: 0 }, point: foes[1].eyePos(), weapon: p.weapon.def });
  window.__run(0.5);
  return window.__stings.slice();
});
const golpeNivel = await level(0.5);
console.log('acción:', JSON.stringify(accion), '· remates al herir a dos:', JSON.stringify(golpe), golpeNivel, 'dB');
check(golpeNivel > -45, 'el golpe del contacto no se oye');
check(accion.modo === '' && accion.nivel < -90, 'la acción no está en silencio');
check(golpe.join() === 'contact', 'el primer contacto no da un golpe (y solo uno)');

// ---------------- últimos 30 s: tensión
await page.evaluate(() => { window.__bc.match.timer = 25; window.__run(0.1); });
await frames(4); await wait(1500);
const tension = await now();
tension.nivel = await level();
console.log('últimos 30 s:', JSON.stringify(tension));
check(tension.modo === 'tension' && tension.capa > 0.1 && tension.nivel > -55 && Math.abs(tension.k - (1 - 24.9 / 30)) < 0.02, 'los últimos 30 s no suenan a tensión');

// ---------------- plantado: un pulso de la música por pitido, cada vez más seguidos
const plant = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, p = bc.player;
  m.timer = 120;
  m.defuser.carrier = p;
  const b = m.site.bombs.A;
  for (const op of m.opsOfSide('def')) op.frozen = true;
  bc.place(b.x, b.y + 0.02, b.z, 0, -0.2);
  p.frozen = false;
  window.__run(m.rules.plantTime + 1.5, () => { p.intent.interact = true; for (const op of m.opsOfSide('def')) op.frozen = true; return m.phase === 'planted'; });
  p.intent.interact = false; p.frozen = true;
  return { fase: m.phase };
});
await frames(4); await wait(800);
const plantado = await page.evaluate(() => {
  window.__beeps = []; window.__beats = [];
  const m = window.__bc.match;
  window.__runF(25, () => m.phase !== 'planted');
  return { fase: m.phase, pitidos: window.__beeps.length, pulsos: window.__beats.slice() };
});
await frames(2);
const pl = await now();
const gaps = plantado.pulsos.map((x) => x.p);
console.log('plantado:', JSON.stringify(plant), JSON.stringify({ pitidos: plantado.pitidos, pulsos: plantado.pulsos.length, primero: gaps[0], ultimo: gaps[gaps.length - 1] }), JSON.stringify(pl));
check(plant.fase === 'planted', 'no se pudo plantar');
check(plantado.pitidos > 20 && plantado.pulsos.length === plantado.pitidos, 'no hay un pulso de la música por pitido');
check(gaps.every((p, i) => i === 0 || p <= gaps[i - 1] + 1e-9) && gaps[0] > gaps[gaps.length - 1] + 0.3, 'los pulsos no se aceleran con el pitido');

// ---------------- fin de ronda: victoria o derrota, y silencio
const fin = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, g = m.game, p = bc.player;
  window.__stings = [];
  for (const o of g.operators) if (o.team !== p.team && o.state !== 'dead') g.kill(o, { by: p });
  window.__run(0.5);
  return { fase: m.phase, remates: window.__stings.slice() };
});
await frames(4); await wait(4500);
const tras = await now();
tras.nivel = await level();
console.log('fin de ronda:', JSON.stringify(fin), JSON.stringify(tras));
check(fin.fase === 'roundEnd' && fin.remates.length === 1 && (fin.remates[0] === 'win' || fin.remates[0] === 'lose'), 'al acabar la ronda no suena la victoria o la derrota');
check(tras.modo === '' && tras.nivel < -80, 'tras la ronda no se calla la música');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

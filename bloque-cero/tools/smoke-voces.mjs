// Prueba de humo de la F12.2 (voces) en el navegador. La voz del navegador se sustituye por una que
// apunta lo que se le pide decir. Una ronda: el locutor en la preparación, en la acción, en los
// últimos 30 s, cuando te quedas solo y al final; tu operador al recargar; los gemidos al herir a un
// enemigo; y con el locutor apagado en Opciones, nada. Sin errores.
// Uso: node tools/smoke-voces.mjs [html]
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
// la voz del navegador: apunta lo que se le pide decir
await page.addInitScript(() => {
  window.__said = [];
  const fake = { speaking: false, pending: false, getVoices() { return []; }, speak(u) { window.__said.push(u.text); }, cancel() {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { get: () => fake, configurable: true });
});
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'baja'; bc.post.setQuality('baja'); bc.settings.difficulty = 'normal'; bc.settings.announcer = true; bc.settings.opVoice = true; bc.audio.init(); bc.startMatch({ startSide: 'atk', seed: 5 }); });
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
const said = () => page.evaluate(() => { const s = window.__said; window.__said = []; return s; });
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__run = (sec, until = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); if (until && until()) return i; } return -1; };
  bc.player.frozen = true;
  // gemidos: los que pide la presentación
  const a = bc.audio, f = a.grunt.bind(a);
  window.__grunts = [];
  a.grunt = (pos, kind, seed, occl, local) => { window.__grunts.push({ kind, local }); return f(pos, kind, seed, occl, local); };
});
const s1 = await said();
console.log('preparación:', JSON.stringify(s1));
check(s1.includes('Ronda 1. Preparación.'), 'no anuncia la preparación');
await page.evaluate(() => window.__run(60, () => window.__bc.match.phase === 'action'));
const s2 = await said();
console.log('acción:', JSON.stringify(s2));
check(s2.includes('¡Acción!'), 'no anuncia la acción');
// tu operador recarga
const s3 = await page.evaluate(() => {
  const bc = window.__bc, p = bc.player;
  p.frozen = false; p.weapon.ammo = 3; p.intent.reload = true;
  window.__step(1 / 60);
  p.intent.reload = false; p.frozen = true;
  const s = window.__said; window.__said = []; return s;
});
console.log('recargar:', JSON.stringify(s3));
check(s3.includes('¡Recargando!'), 'tu operador no dice «¡Recargando!»');
// gemidos al herir a un enemigo
const g = await page.evaluate(() => {
  const bc = window.__bc, g = bc.match.game, p = bc.player, d = bc.match.opsOfSide('def').find((o) => o.state === 'alive');
  window.__grunts = [];
  g.damage(d, 20, { by: p, zone: 'body', dir: { x: 1, y: 0, z: 0 }, point: d.eyePos(), weapon: p.weapon.def });
  return window.__grunts;
});
console.log('gemidos:', JSON.stringify(g));
check(g.some((x) => x.kind === 'pain' && !x.local), 'al herir a un enemigo no se oye su gemido');
// los últimos 30 s
const s4 = await page.evaluate(() => { const m = window.__bc.match; m.timer = 31; window.__run(2); const s = window.__said; window.__said = []; return s; });
console.log('30 s:', JSON.stringify(s4));
check(s4.includes('Treinta segundos.'), 'no avisa de los 30 s');
// te quedas solo (tus compañeros caen, los enemigos siguen)
const s5 = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, g = m.game, p = bc.player;
  for (const o of g.operators) if (o.team === p.team && o !== p && o.state !== 'dead') g.kill(o, { by: null });
  window.__run(0.2);
  const s = window.__said; window.__said = []; return s;
});
console.log('solo:', JSON.stringify(s5));
check(s5.includes('Eres el último.'), 'no dice «Eres el último»');
// ganas la ronda
const s6 = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, g = m.game, p = bc.player;
  for (const o of g.operators) if (o.team !== p.team && o.state !== 'dead') g.kill(o, { by: p });
  window.__run(0.5);
  const s = window.__said; window.__said = []; return s;
});
console.log('final:', JSON.stringify(s6));
check(s6.includes('Ronda ganada.'), 'no anuncia la ronda ganada');
// con el locutor apagado, nada
const s7 = await page.evaluate(() => { const bc = window.__bc; bc.settings.announcer = false; bc.ctx.voice.announce('Prueba.'); const s = window.__said; window.__said = []; return s; });
check(s7.length === 0, 'con el locutor apagado sigue hablando');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

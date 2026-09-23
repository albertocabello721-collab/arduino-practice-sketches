// Prueba de humo de la Fase 2: operadores, disparos, derribo y reanimación.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => window.__bc.start());
const snap = async (name, fn, wait = 1200) => { if (fn) await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
// 1) maniquí 1 en el salón de cerca
await snap('p2_01_operador', () => { window.__bc.place(5.2, 0, 7.6, Math.PI * 1.25, -0.08); });
// 2) compañero en el jardín delantero, de frente
await snap('p2_02_companero', () => { window.__bc.place(17.5, 0, -6.2, Math.PI, -0.1); });
// 3) disparar a la cabeza del maniquí 1
const r1 = await page.evaluate(() => {
  const bc = window.__bc; const g = bc.game; const m = g.operators.find((o) => o.id === 'm1');
  bc.place(5.5, 0, 6.8, 0, 0);
  const e = bc.player.eyePos(); const h = m.rig[4].p;
  const dx = h.x - e.x, dy = h.y + 0.1 - e.y, dz = h.z - e.z;
  bc.player.yaw = Math.atan2(-dx, -dz); bc.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  bc.player.weapon.cooldown = 0; bc.player._shoot(g, bc.player.weapon);
  return { state: m.state, kills: bc.player.stats.kills };
});
console.log('tiro a la cabeza:', JSON.stringify(r1));
await snap('p2_03_baja', null, 1500);
// 4) el tirador del despacho: ponerse a la vista y esperar
await page.evaluate(() => { const bc = window.__bc; bc.place(21, 0, 3.8, Math.PI / 2, 0); bc.player.hp = 60; });
await page.waitForTimeout(6000);
const r2 = await page.evaluate(() => ({ state: window.__bc.player.state, hp: window.__bc.player.hp }));
console.log('tras exponerse al tirador:', JSON.stringify(r2));
await snap('p2_04_tiroteo', null, 300);
// 5) reanimar al compañero: derribarlo (J) y mantener F
const r3 = await page.evaluate(async () => {
  const bc = window.__bc; const g = bc.game;
  if (bc.player.state !== 'alive') { bc.player.state = 'alive'; bc.player.hp = bc.player.maxHp; bc.player.pose.downed = 0; bc.player.pose.dead = 0; bc.player.stance = 'stand'; bc.player.body.height = 1.8; bc.audio.stopDowned && bc.audio.stopDowned(); }
  const mate = g.operators.find((o) => o.id === 'aliado');
  g.damage(mate, mate.hp, { by: null, zone: 'body' });
  bc.place(mate.body.pos.x, 0, mate.body.pos.z - 1.0, Math.PI, -0.4);
  return { mate: mate.state };
});
console.log('compañero:', JSON.stringify(r3));
await snap('p2_05_derribado', null, 1200);
await page.evaluate(() => { window.__bc.intent.interact = true; window.__bc.game.operators.find((o) => o.id === 'aliado'); });
// mantener F: la entrada lee el teclado, así que forzamos la intención en cada frame
const r4 = await page.evaluate(async () => {
  const bc = window.__bc; const mate = bc.game.operators.find((o) => o.id === 'aliado');
  for (let i = 0; i < 300 && mate.state === 'downed'; i++) {
    bc.game.operators[0].intent.interact = true;
    for (let k = 0; k < 3; k++) bc.game.tick(1 / 60);
  }
  bc.game.operators[0].intent.interact = false;
  return { mate: mate.state, hp: mate.hp };
});
console.log('reanimación:', JSON.stringify(r4));
await snap('p2_06_reanimado', null, 800);
// 6) tercera persona: ver a los maniquís en posturas (agachado tras la isla, asomado en el hall)
await snap('p2_07_cocina', () => { window.__bc.place(21.5, 0, 17.2, Math.PI * 0.72, -0.12); });
await snap('p2_08_hall', () => { window.__bc.place(17, 0, 9.2, Math.PI, -0.05); });
console.log('errores:', errors.length); for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
await browser.close();

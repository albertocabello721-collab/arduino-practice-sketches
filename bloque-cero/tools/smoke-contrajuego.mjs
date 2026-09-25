// Prueba de humo de la F6.6c en el navegador: partida en defensa (planta baja) con aliados bot
// (VOLTIO con alambre, CORAZA con impacto, OJO con C4, REMEDIO); la rueda H con «Poner gadget
// aquí» (y el aliado que lo hace), la C4 pegada y el hueco entre las salas del sitio, unos
// segundos de acción y ningún error en consola. Guarda capturas en argv[2].
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; window.__bc.settings.difficulty = 'elite'; window.__bc.startMatch({ startSide: 'def', seed: 5 }); });
// aliados: VOLTIO (alambre), CORAZA (impacto), OJO (C4), REMEDIO; el jugador, SILENCIO
await page.evaluate(() => {
  const m = window.__bc.match, me = m.slots.find((s) => s.human);
  const mine = m.slots.filter((s) => s.team === me.team && !s.human);
  [['voltio', 0], ['coraza', 1], ['ojo', 0], ['remedio', 1]].forEach(([id, g], i) => { if (mine[i]) { mine[i].opId = id; mine[i].gadget = g; } });
});
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-choice .ch:nth-child(2)');         // planta baja
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const shot = async (name, wait = 800) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n, until = '') => page.evaluate(([n, until]) => {
  const bc = window.__bc, f = until ? new Function('bc', 'return ' + until) : null;
  for (let i = 0; i < n; i++) { bc.session.tick(1 / 60); if (bc.match.phase === 'roundEnd' || bc.match.phase === 'matchEnd' || (f && f(bc))) return i; }
  return n;
}, [n, until]);
await page.evaluate(() => {
  const bc = window.__bc, g = bc.match.game, C = (window.__k = { n: {}, placed: [] });
  const bump = (k) => { C.n[k] = (C.n[k] || 0) + 1; };
  g.on('gadgetPlaced', (op, c) => { if (op.side === 'def' && op !== bc.player) C.placed.push({ who: op.meta.opId, kind: c.kind || 'cam', x: (c.pos || c).x, z: (c.pos || c).z, t: g.time }); });
  g.on('gadgetThrown', (op, it) => { if (op.side === 'def' && (it.kind === 'c4' || it.kind === 'impact')) bump('lanza ' + it.kind); });
  g.on('explosion', (kind, p, spec, owner) => { if (owner && owner.side === 'def') { bump('explota ' + kind); if (kind === 'impact' && !C.hole) C.hole = { ...p }; } });
  g.on('stim', () => bump('estimulante'));
});
// rueda H: «Poner gadget aquí» mirando al suelo de la cocina
await page.evaluate(() => { window.__bc.place(18, 0.01, 18.5, Math.PI, -0.35); });
await ticks(2);
await page.keyboard.down('KeyH');
await page.waitForFunction(() => window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => window.__bc.session.wheel.pick('gadget'));
await page.waitForTimeout(500);
const wheel = await page.evaluate(() => [...document.querySelectorAll('#wheel .wo')].map((e) => e.textContent + (e.classList.contains('on') ? ' [x]' : '')));
console.log('rueda:', JSON.stringify(wheel));
await shot('c66_01_rueda', 200);
await page.keyboard.up('KeyH');
await page.waitForFunction(() => !window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
const ping = await page.evaluate(() => { const bc = window.__bc, p = bc.match.recon.pingOf(bc.player.team, bc.player); return p && { x: +p.x.toFixed(2), z: +p.z.toFixed(2), t: bc.match.game.time }; });
await ticks(60 * 12, "window.__k.placed.some((c) => c.t > " + (ping ? ping.t : 0) + " && Math.hypot(c.x - " + (ping ? ping.x : 0) + ", c.z - " + (ping ? ping.z : 0) + ") < 2)");
const ordered = await page.evaluate((pg) => ({ puesto: pg ? window.__k.placed.find((c) => c.t > pg.t && Math.hypot(c.x - pg.x, c.z - pg.z) < 2) : null, chat: [...document.querySelectorAll('#chat .cl')].map((e) => e.textContent).slice(-4) }), ping);
console.log('marca:', JSON.stringify(ping), '· orden:', JSON.stringify(ordered));
await shot('c66_02_gadget_puesto', 900);
// resto de la preparación: C4 pegada y hueco entre las salas
await ticks(60 * 50, "window.__bc.match.phase !== 'prep'");
const prep = await page.evaluate(() => ({ fase: window.__bc.match.phase, usos: window.__k.n, c4: window.__bc.match.gadgets.items.filter((it) => it.kind === 'c4' && it.stuck).length, hueco: window.__k.hole && { x: +window.__k.hole.x.toFixed(2), z: +window.__k.hole.z.toFixed(2) } }));
console.log('tras la preparación:', JSON.stringify(prep));
if (prep.hueco) {
  await page.evaluate((h) => { window.__bc.place(h.x + 3, 0.01, h.z, -Math.PI / 2, 0); }, prep.hueco);
  await ticks(1);
  await shot('c66_03_hueco', 900);
}
await ticks(60 * 40);
const act = await page.evaluate(() => ({ fase: window.__bc.match.phase, usos: window.__k.n }));
console.log('acción:', JSON.stringify(act));
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

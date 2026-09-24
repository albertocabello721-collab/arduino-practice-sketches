// Prueba de humo de la Fase 3 en el navegador: selección, preparación, acción,
// plantar, fin de ronda, marcador y fin de partida. Guarda capturas en argv[2].
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(file);
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n, fn) => page.evaluate(([n, fns]) => {
  const bc = window.__bc; const f = fns ? new Function('bc', fns) : null;
  for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); }
  return { phase: bc.match.phase, timer: bc.match.timer, round: bc.match.round };
}, [n, fn ? fn.toString().replace(/^[^{]*{/, '').replace(/}$/, '') : null]);

// 1) partida atacando: pantalla de selección
await page.evaluate(() => window.__bc.startMatch({ startSide: 'atk', difficulty: 'normal' }));
await shot('p3_01_seleccion', 1500);
// elegir operador (2.ª tarjeta), arsenal y punto de entrada con clics reales
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-detail .wpn:nth-child(2)');
await page.click('#sel-choice .ch:nth-child(1)');
await shot('p3_02_elegido', 600);
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const m = window.__bc.match;
  return { phase: m.phase, loc: m.site.name, me: m.player.opDef.name, side: m.player.side, frozen: m.player.frozen, ops: m.game.operators.length, carrier: m.defuser.carrier === m.player };
});
console.log('preparación:', JSON.stringify(info));
await shot('p3_03_preparacion', 2500);
// 2) acción: saltar el resto de la preparación
await ticks(1, (bc) => { bc.match.timer = 0.001; });
console.log('acción:', JSON.stringify(await ticks(2)));
await shot('p3_04_accion', 1500);
// 3) llevar al jugador al sitio A y plantar (mantener F se simula en la intención)
const siteA = await page.evaluate(() => { const m = window.__bc.match; for (const op of m.opsOfSide('def')) op.frozen = true; const b = m.site.bombs.A; window.__bc.place(b.x, b.y + 0.02, b.z, 0, -0.2); return b; });
console.log('sitio A:', JSON.stringify(siteA));
// (la defensa se congela para que la prueba mida el plantado, no el tiroteo)
await page.keyboard.down('f');   // mantener F de verdad entre fotogramas
await ticks(240, (bc) => { bc.player.intent.interact = true; for (const op of bc.match.opsOfSide('def')) op.frozen = true; });
await page.evaluate(() => { window.__bc.player.intent.interact = true; });
await shot('p3_05_plantando', 1200);
console.log('plantado:', JSON.stringify(await ticks(240, (bc) => { bc.player.intent.interact = true; for (const op of bc.match.opsOfSide('def')) op.frozen = true; })));
await page.keyboard.up('f');
console.log('estado:', JSON.stringify(await page.evaluate(() => { const bc = window.__bc, m = bc.match, p = bc.player; return { st: p.state, hp: p.hp, pos: p.body.pos, ground: p.body.onGround, site: m.siteAt(p.body.pos.x, p.body.pos.y, p.body.pos.z), carrier: m.defuser.carrier && m.defuser.carrier.name, plant: m.plant && m.plant.t, planted: m.defuser.planted }; })));
await shot('p3_06_plantado', 1500);
// 4) marcador con Tab
await page.keyboard.down('Tab');
await shot('p3_07_marcador', 1200);
await page.keyboard.up('Tab');
// 5) fin de ronda: la defensa cae
await ticks(1, (bc) => { for (const op of bc.match.opsOfSide('def')) if (op.state !== 'dead') bc.game.kill(op, { by: bc.player }); });
console.log('fin de ronda:', JSON.stringify(await ticks(3)));
await shot('p3_08_fin_ronda', 2500);
// 6) resto de la partida acelerado hasta el final
const fin = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  let guard = 0;
  while (m.phase !== 'matchEnd' && guard++ < 400000) {
    if (m.phase === 'select') { m.timer = 0; }
    if (m.phase === 'prep') m.timer = Math.min(m.timer, 0.02);
    if (m.phase === 'action') { for (const op of m.opsOfSide('def')) if (op.state !== 'dead') bc.game.kill(op, { by: m.player && m.player.state !== 'dead' ? m.player : null }); }
    bc.session.tick(1 / 60);
  }
  return { phase: m.phase, score: [m.teams[0].score, m.teams[1].score], rounds: m.history.length, mvp: m.mvp().opId };
});
console.log('fin de partida:', JSON.stringify(fin));
await shot('p3_09_fin_partida', 2000);
// 7) revancha: vuelve a la selección
await page.click('#me-again');
await page.waitForFunction(() => window.__bc.match && window.__bc.match.phase === 'select' && window.__bc.match.round === 1);
console.log('revancha: ok');
// 8) partida defendiendo: elegir ubicación planta alta
await page.evaluate(() => window.__bc.startMatch({ startSide: 'def' }));
await page.click('#sel-grid .opc:nth-child(6)');
await page.click('#sel-choice .ch:nth-child(3)');
await shot('p3_10_seleccion_defensa', 800);
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const d = await page.evaluate(() => { const m = window.__bc.match; const p = m.player; return { loc: m.site.name, room: window.__bc.map.locationAt(p.body.pos.x, p.body.pos.y + 0.2, p.body.pos.z), frozen: p.frozen }; });
console.log('defensa:', JSON.stringify(d));
await shot('p3_11_defensa_prep', 2500);
// 9) morir y observar a un compañero
await ticks(1, (bc) => { bc.match.timer = 0.001; });
await ticks(2);
await page.evaluate(() => { const bc = window.__bc; bc.game.kill(bc.player, { by: null }); });
await ticks(200);
const sp = await page.evaluate(() => { const s = window.__bc.session; return { view: s.viewOp && s.viewOp.name, me: s.player.state }; });
console.log('observando:', JSON.stringify(sp));
await shot('p3_12_observando', 1500);
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

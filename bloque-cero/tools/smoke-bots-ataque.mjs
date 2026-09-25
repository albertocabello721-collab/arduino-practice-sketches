// Prueba de humo de la F6.6b en el navegador: partida atacando en Élite con aliados bot
// (TERMO, CHISPA, ROMPE, RADAR); cuenta lo que usan (PEM, térmica, cegadoras, brecha a
// distancia, escaneo), fotos de la carga térmica y de la cegadora, y ningún error en consola.
// Guarda capturas en argv[2].
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
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; window.__bc.settings.difficulty = 'elite'; window.__bc.startMatch({ startSide: 'atk', seed: 3 }); });
// aliados: TERMO, CHISPA, ROMPE (cegadoras) y RADAR (cegadoras); el jugador, MURALLA
await page.evaluate(() => {
  const m = window.__bc.match;
  const mine = m.slots.filter((s) => s.team === m.slots.find((q) => q.human).team && !s.human);
  [['termo', 0], ['chispa', 0], ['rompe', 1], ['radar', 1]].forEach(([id, g], i) => { if (mine[i]) { mine[i].opId = id; mine[i].gadget = g; } });
});
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const shot = async (name, wait = 800) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
// contadores (en la página) y el jugador quieto en su aparición, fuera de juego
await page.evaluate(() => {
  const bc = window.__bc, g = bc.match.game, C = (window.__kit = { n: {}, thermal: null, flash: null });
  const bump = (k) => { C.n[k] = (C.n[k] || 0) + 1; };
  g.on('gadgetThrown', (op, it) => { if (op.side === 'atk' && op !== bc.player) { bump('lanza ' + it.kind); if (it.kind === 'flash' && !C.flash) C.flash = { op, it }; } });
  g.on('abilityFired', (op, it) => { if (op.side === 'atk') bump('dispara ' + it.kind); });
  g.on('gadgetPlaced', (op, c) => { if (op.side === 'atk') { bump('pone ' + c.kind); if (c.kind === 'thermal' && !C.thermal) C.thermal = c; } });
  g.on('thermalIgnite', () => bump('térmica encendida'));
  g.on('emp', () => bump('PEM'));
  g.on('scanStart', () => bump('escaneo'));
  g.on('explosion', (kind) => { if (kind === 'thermal') bump('muro abierto'); });
  bc.player.frozen = true;
});
const ticks = (n, until = '') => page.evaluate(([n, until]) => {
  const bc = window.__bc, f = until ? new Function('bc', 'return ' + until) : null;
  for (let i = 0; i < n; i++) { bc.session.tick(1 / 60); if (bc.match.phase === 'roundEnd' || bc.match.phase === 'matchEnd' || (f && f(bc))) return i; }
  return n;
}, [n, until]);
await ticks(60 * 46);
await page.evaluate(() => { window.__bc.player.frozen = false; });
console.log('al empezar la acción:', JSON.stringify(await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  bc.session.bots.update(1 / 60);
  return { sitio: m.site.id, objetivo: m.recon.objectiveFound, portador: m.defuser.carrier && m.defuser.carrier.meta.opId, aliados: [...bc.session.bots.brains.values()].filter((B) => B.side === 'atk').map((B) => `${B.op.meta.opId}:${B.stage}${B.breach ? '/' + B.breach.role : ''}`) };
})));
// acción: la defensa quieta mientras TERMO abre el muro (para la foto); luego, ronda normal
await page.evaluate(() => { for (const o of window.__bc.match.opsOfSide('def')) o.frozen = true; });
await ticks(60 * 40, 'window.__kit.thermal');
const th = await page.evaluate(() => {
  const bc = window.__bc, c = window.__kit.thermal;
  if (!c) return null;
  const n = c.normal || { x: 0, z: 1 };
  const x = c.pos.x + n.x * 3.2, z = c.pos.z + n.z * 3.2, fy = Math.floor((c.pos.y + 0.3) / 3.5) * 3.5;
  bc.place(x, fy, z, Math.atan2(n.x, n.z), -0.1);
  return { x: c.pos.x.toFixed(1), z: c.pos.z.toFixed(1) };
});
if (th) { await ticks(1); await shot('a66_01_termica', 900); await ticks(60 * 6, "window.__kit.n['muro abierto']"); await ticks(20); await shot('a66_02_muro_abierto', 900); }
// resto de la ronda, con la defensa en marcha
await page.evaluate(() => { for (const o of window.__bc.match.opsOfSide('def')) o.frozen = false; });
await ticks(60 * 60);
const res = await page.evaluate(() => ({ fase: window.__bc.match.phase, usos: window.__kit.n }));
console.log('térmica en:', JSON.stringify(th));
console.log('ronda:', JSON.stringify(res));
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

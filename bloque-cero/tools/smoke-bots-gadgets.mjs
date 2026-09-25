// Prueba de humo de la F6.6a en el navegador: partida en defensa con aliados bot (veterano);
// al final de la preparación, fotos de lo que han colocado (alambre, minas, baterías,
// cámaras…), unos segundos de acción y ningún error en consola. Guarda capturas en argv[2].
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
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; window.__bc.settings.difficulty = 'veterano'; window.__bc.startMatch({ startSide: 'def' }); });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n) => page.evaluate((n) => {
  const bc = window.__bc;
  for (let i = 0; i < n; i++) { bc.session.tick(1 / 60); if (bc.match.phase === 'roundEnd' || bc.match.phase === 'matchEnd') break; }
}, n);
// el jugador se queda quieto; sus aliados bot preparan el sitio
const lineup = await page.evaluate(() => window.__bc.match.game.operators.filter((o) => o.side === 'def').map((o) => `${o.meta.opId}[${o.gadget && o.gadget.id}/${o.ability && o.ability.id}]`));
console.log('defensa:', lineup.join(' '));
await ticks(60 * 43);     // (las fotos, al final de la preparación: nadie dispara)
const got = await page.evaluate(() => {
  const m = window.__bc.match, G = m.game.gadgets;
  const n = {};
  for (const c of G.placed) if (c.team === m.teamOfSide('def')) n[c.kind] = (n[c.kind] || 0) + 1;
  for (const it of G.items) if (it.team === m.teamOfSide('def')) n[it.kind] = (n[it.kind] || 0) + 1;
  for (const c of m.recon.cams) if (c.fromGadget) n[c.sticky ? 'stickycam' : 'bpcam'] = (n[c.sticky ? 'stickycam' : 'bpcam'] || 0) + 1;
  return { fase: m.phase, sitio: m.site.name, colocado: n, placas: m.game.operators.filter((o) => o.plate).length };
});
console.log('tras la preparación:', JSON.stringify(got));
// fotos: desde 2,5 m de cada tipo de objeto colocado (el primero de cada uno)
const spots = await page.evaluate(() => {
  const m = window.__bc.match, G = m.game.gadgets, seen = new Set(), out = [];
  for (const c of G.placed) {
    if (c.team !== m.teamOfSide('def') || seen.has(c.kind)) continue;
    seen.add(c.kind);
    out.push({ kind: c.kind, x: c.pos.x, y: c.pos.y, z: c.pos.z, n: c.normal });
  }
  for (const c of m.recon.cams) if (c.fromGadget && !seen.has(c.sticky ? 'stickycam' : 'bpcam')) { seen.add(c.sticky ? 'stickycam' : 'bpcam'); out.push({ kind: c.sticky ? 'stickycam' : 'bpcam', x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw }); }
  return out;
});
let i = 0;
for (const s of spots) {
  // punto de vista: delante del objeto (por su normal si la tiene), mirándolo
  const ok = await page.evaluate((s) => {
    const bc = window.__bc, w = bc.match.world;
    const dirs = [];
    if (s.n && (s.n.x || s.n.z)) dirs.push([s.n.x, s.n.z]);
    if (s.yaw !== undefined) dirs.push([-Math.sin(s.yaw), -Math.cos(s.yaw)]);
    for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
    for (const [dx, dz] of dirs) {
      for (const d of [2.4, 1.8, 3.0]) {
        const x = s.x + dx * d, z = s.z + dz * d, fy = Math.floor((s.y + 0.3) / 3.5) * 3.5;
        if (w.worldBoxHasSolid(x - 0.3, fy + 0.05, z - 0.3, x + 0.3, fy + 1.8, z + 0.3)) continue;
        const ey = fy + 1.64, yaw = Math.atan2(dx, dz), pitch = Math.atan2(s.y - ey, d);
        bc.place(x, fy, z, yaw, pitch);
        return true;
      }
    }
    return false;
  }, s);
  if (!ok) continue;
  await ticks(1);
  await shot(`g66_${String(++i).padStart(2, '0')}_${s.kind}`, 700);
}
console.log('fotos:', spots.map((s) => s.kind).join(', '));
// y la ronda sigue: 30 s de acción
await ticks(60 * 30);
const act = await page.evaluate(() => ({ fase: window.__bc.match.phase, gas: window.__bc.match.game.gadgets.gasClouds.length }));
console.log('acción:', JSON.stringify(act));
console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

// Prueba de humo en el navegador de la recarga por partes (F7.1), en el campo de pruebas: cada
// familia de armas (fusil, subfusil, tirador, ametralladora, escopeta, pistola, revólver),
// táctica y vacía, con capturas en los momentos clave, los cargadores que quedan en el suelo,
// la munición al terminar y sin errores.
// Uso: node tools/smoke-recarga.mjs <carpeta de capturas>
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto('file://' + path.resolve('dist/bloque-cero.html'));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu');
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
// la simulación solo avanza cuando lo pide la prueba (sin ratón capturado, el bucle también la movería)
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; });
const ticks = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__step(1 / 60); }, n);
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${name}.png` }); };
// arma `slot` del lote `lote` (0: FA-7, P-9, E-12, SF-45 · 1: FA-9, R-44, AL-60, T-308 · 2: SF-9, PA-3...)
async function take(lote, slot) {
  await page.evaluate(([l, k]) => {
    const bc = window.__bc, s = bc.session, p = bc.player;
    s.setLoadout(l);
    p.weaponIndex = k; p.weapon.equipT = 0; p.weapon.refill();
    // mirando al suelo delante, para ver caer el cargador
    bc.place(15.5, 0, -6.5, Math.PI, -0.25);
  }, [lote, slot]);
  await ticks(4);
}
// recarga con `ammo` balas; `stops`: [nombre, parte o segundos, desfase] donde parar a hacer la captura
async function reload(tag, ammo, stops) {
  await page.evaluate((a) => { const p = window.__bc.player; p.weapon.ammo = a; p.intent.reload = true; }, ammo);
  await ticks(1);
  const info = await page.evaluate(() => { const w = window.__bc.player.weapon; return { arma: w.def.name, total: +w.reloadTotal.toFixed(2), partes: w.plan ? w.plan.parts.map((x) => `${x.part}@${x.at.toFixed(2)}`) : [] }; });
  for (const [name, when, off = 0] of stops) {
    const t = await page.evaluate(([when, off]) => {
      const w = window.__bc.player.weapon;
      if (!w.plan) return null;
      const x = typeof when === 'number' ? when : w.plan.parts.find((q) => q.part === when)?.at;
      return x === undefined ? null : x + off;
    }, [when, off]);
    if (t === null) continue;
    const el = await page.evaluate(() => { const w = window.__bc.player.weapon; return w.reloadTotal - w.reloadT; });
    if (t > el) await ticks(Math.round((t - el) * 60));
    await shot(`${tag}_${name}`);
  }
  await ticks(60 * 6);
  const end = await page.evaluate(() => { const bc = window.__bc, w = bc.player.weapon; const D = bc.ctx.effects.drops.items; return { municion: `${w.ammo}|${w.reserve}`, perdidas: w.lost, enElSuelo: `${D.filter((d) => d.kind === "mag").length} cargadores, ${D.filter((d) => d.kind === "casing").length} casquillos` }; });
  console.log(`${tag}:`, JSON.stringify({ ...info, ...end }));
  return end;
}

// FA-7 (fusil): táctica y vacía
await take(0, 0);
await reload('fa7_tactica', 12, [['1_saca', 'magOut', -0.08], ['2_bolsillo', 'magIn', -0.55], ['3_mete', 'magIn', -0.08], ['4_golpe', 'slap', 0.0]]);
await reload('fa7_vacia', 0, [['5_cerrojo', 'bolt', -0.06]]);
await page.evaluate(() => window.__bc.place(15.5, 0, -6.5, Math.PI, -1.0));
await ticks(2);
await shot('fa7_6_suelo');
// SF-45 (subfusil) y T-308 (tirador) vacías
await take(0, 3);
await reload('sf45_vacia', 0, [['1_palanca', 'bolt', -0.06]]);
await take(1, 3);
await reload('t308_tactica', 4, [['1_saca', 'magOut', -0.08]]);
// P-9 (pistola): corredera atrás sin balas, y la vacía la suelta
await take(0, 1);
await page.evaluate(() => { window.__bc.player.weapon.ammo = 0; });
await ticks(2);
await shot('p9_0_corredera_atras');
await reload('p9_vacia', 0, [['1_cae', 'magOut', -0.03], ['2_mete', 'magIn', -0.06], ['3_suelta', 'bolt', -0.05]]);
// R-44 (revólver): tambor fuera, casquillos, cargador rápido
await take(1, 1);
await reload('r44', 2, [['1_tambor', 'eject', -0.1], ['2_casquillos', 'eject', 0.12], ['3_cargador_rapido', 'magIn', -0.05]]);
// AL-60: tapa, caja fuera, caja nueva
await take(1, 2);
await reload('al60', 30, [['1_tapa', 'open', 0.18], ['2_caja_fuera', 'magOut', -0.1], ['3_cinta', 'belt', 0.0]]);
// E-12 (escopeta): cartucho a cartucho y vacía con bombeo
await take(0, 2);
await reload('e12', 5, [['1_cartucho', 'shell', -0.1]]);
await reload('e12_vacia', 0, [['2_bombea', 'pump', -0.03]]);
// E-12: disparar a mitad de recarga la interrumpe y dispara con los cartuchos ya metidos
const corta = await page.evaluate(() => {
  const p = window.__bc.player, w = p.weapon;
  w.ammo = 3; w.cooldown = 0; p.intent.reload = true;
  for (let i = 0; i < Math.round(1.3 * 60); i++) window.__step(1 / 60);   // dos cartuchos dentro
  const antes = w.ammo;
  p.intent.fire = true; window.__step(1 / 60); p.intent.fire = false;
  const recargando = w.reloadT > 0;
  for (let i = 0; i < 20; i++) window.__step(1 / 60);
  return { antes, recargandoTrasElClic: recargando, despues: w.ammo };
});
console.log('e12 interrumpida:', JSON.stringify(corta));
// PA-3 (pistola ametralladora)
await take(2, 1);
await reload('pa3_tactica', 5, [['1_mete', 'magIn', -0.08]]);
const perf = await page.evaluate(() => { const p = window.__bc.perf(); return { llamadas: p.calls, triangulos: p.triangles }; });
console.log('dibujo:', JSON.stringify(perf));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

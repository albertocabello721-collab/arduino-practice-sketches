// Prueba de humo de miras y accesorios (F10.3) en el navegador:
//  · selección: eliges mira y accesorios con botones, el resumen cambia y se guarda por operador;
//    en la partida, tu arma los lleva (primera persona) y el aumento de la mira cambia el zoom;
//  · con supresor no hay fogonazo en el mundo; con láser se ve el haz;
//  · campo de pruebas: la tecla O abre el panel; con la vertical el arma sube un 15 % menos, con el
//    compensador se abre un 20 % menos y con la angular la FA-7 apunta en 0,27 s;
//  · capturas de cada mira al apuntar y del arma desde la cadera. Sin errores.
// Uso: node tools/smoke-accesorios.mjs <carpeta de capturas> [html]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = process.argv[2] || '.';
const html = process.argv[3] || 'dist/bloque-cero.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const check = (ok, what) => { if (!ok) errors.push(what); };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);

// ---------------- selección
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.kits = {}; bc.startMatch({ startSide: 'atk', seed: 3 }); });
await page.click('#sel-grid .opc:nth-child(2)');
const wid = await page.evaluate(() => { const me = window.__bc.session.meSlot; return document.querySelector('.kit .kt').dataset.w; });
for (const [p, v] of [['sight', 'x25'], ['barrel', 'suppressor'], ['grip', 'angled'], ['laser', 'on']]) await page.click(`.kt[data-w="${wid}"][data-p="${p}"][data-v="${v}"]`);
await frames(2);
await page.screenshot({ path: `${out}/a1_seleccion.png` });
const sel = await page.evaluate((wid) => {
  const bc = window.__bc, me = bc.session.meSlot;
  return { op: me.opId, arma: wid, kit: me.kits[wid], guardado: (bc.settings.kits[me.opId] || {})[wid], resumen: document.querySelector('.kit .ks').textContent };
}, wid);
console.log('selección:', JSON.stringify(sel));
check(sel.kit && sel.kit.sight === 'x25' && sel.kit.barrel === 'suppressor' && sel.kit.grip === 'angled' && sel.kit.laser, 'la elección no se guarda en la ranura');
check(JSON.stringify(sel.guardado) === JSON.stringify(sel.kit), 'la elección no se guarda en los ajustes');
check(/Aumento 2,5x/.test(sel.resumen) && /sin fogonazo/.test(sel.resumen), 'el resumen no cambia: ' + sel.resumen);
// otro operador y vuelta: vuelve con lo suyo
await page.click('#sel-grid .opc:nth-child(1)');
await page.click('#sel-grid .opc:nth-child(2)');
const back = await page.evaluate((wid) => window.__bc.session.meSlot.kits[wid], wid);
check(back && back.sight === 'x25', 'al volver al operador no recupera su equipo');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });

// ---------------- partida: tu arma con su equipo, el zoom de la 2,5x, sin fogonazo y con láser
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, m = bc.match;
  window.__step = s.tick.bind(s); s.tick = () => {};
  for (let i = 0; i < 60 * 50 && m.phase !== 'action'; i++) window.__step(1 / 60);
  s.bots.update = () => {};
  for (const o of m.game.operators) if (o !== bc.player) o.frozen = true;
  bc.place(15.5, 0.01, -12, 0, 0);
});
await frames(6);
const inMatch = await page.evaluate(() => {
  const bc = window.__bc, p = bc.player, w = p.weapons[0], vm = bc.ctx.vm;
  p.ads = 1; p.intent.ads = true;
  return { kit: w.kit, vmKit: vm.guns[w.def.model].info.kit.key };
});
await frames(6);
const zoom = await page.evaluate(() => {
  const bc = window.__bc, DEG = Math.PI / 180, f = bc.settings.fov;
  const want = 2 * Math.atan(Math.tan(f * DEG / 2) / 2.5) / DEG;
  const eff = bc.ctx.effects, before = eff.lights.length;
  bc.fire(1);
  return { fov: +bc.camera.fov.toFixed(2), esperado: +want.toFixed(2), fogonazos: eff.lights.length - before, haces: bc.ctx.lasers.count };
});
await page.screenshot({ path: `${out}/a2_partida_25x.png` });
console.log('partida:', JSON.stringify({ ...inMatch, ...zoom }));
check(inMatch.vmKit === 'x25|suppressor|angled|1', 'la primera persona no lleva el equipo elegido: ' + inMatch.vmKit);
check(near(zoom.fov, zoom.esperado, 0.3), `el zoom de la 2,5x no es el suyo (${zoom.fov} en vez de ${zoom.esperado})`);
check(zoom.fogonazos === 0, 'con supresor hay fogonazo');
check(zoom.haces >= 1, 'no se ve el haz del láser');

// ---------------- campo de pruebas: panel O y lo que cambia cada accesorio
await page.evaluate(() => { window.__bc.toMenu(); });
await page.waitForFunction(() => window.__bc.state.mode === 'menu');
await page.evaluate(() => { const bc = window.__bc; bc.settings.kits = {}; bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; window.__bc.place(15.5, 0, -12, 0, 0); });
await page.keyboard.press('KeyO');
await frames(4);
const open = await page.evaluate(() => !document.getElementById('kitpanel').classList.contains('hidden'));
check(open, 'la tecla O no abre el panel');
// cuánto sube y se abre una ráfaga de 10 (el mismo patrón, sin azar) y cuánto tarda en apuntar
const measure = () => page.evaluate(() => {
  const bc = window.__bc, p = bc.player, w = p.weapons[0], R = w.def.recoil;
  let up = 0, side = 0;
  for (let i = 0; i < 10; i++) { const k = { up: R.v * (i === 0 ? R.first : 1), side: 0 }; up += k.up; }
  side = R.h;
  p.weaponIndex = 0; p.ads = 0; p.intent.ads = true;
  let t = 0;
  while (p.ads < 1 && t < 2) { window.__step(1 / 60); t += 1 / 60; }
  p.intent.ads = false;
  for (let i = 0; i < 30; i++) window.__step(1 / 60);
  return { up, side, ads: +t.toFixed(3) };
});
const base = await measure();
await page.click('.kt[data-w="ar"][data-p="grip"][data-v="vertical"]');
await page.click('.kt[data-w="ar"][data-p="barrel"][data-v="compensator"]');
const vc = await measure();
await page.click('.kt[data-w="ar"][data-p="grip"][data-v="angled"]');
const an = await measure();
await page.screenshot({ path: `${out}/a3_panel.png` });
await page.keyboard.press('KeyO');
await frames(4);
const closed = await page.evaluate(() => document.getElementById('kitpanel').classList.contains('hidden'));
console.log('campo:', JSON.stringify({ base, verticalCompensador: vc, angular: an, guardado: await page.evaluate(() => window.__bc.settings.kits.campo) }));
check(closed, 'la tecla O no cierra el panel');
check(near(vc.up / base.up, 0.85, 1e-6), 'la vertical no baja un 15 % el retroceso vertical');
check(near(vc.side / base.side, 0.8, 1e-6), 'el compensador no baja un 20 % el lateral');
check(near(base.ads, 0.34, 1 / 60 + 1e-6) && near(an.ads, 0.272, 1 / 60 + 1e-6), `apuntado: ${base.ads} s y con angular ${an.ads} s`);

// ---------------- capturas: cada mira al apuntar y el arma con todo desde la cadera
const LO = [['ar', 'pistol', 'shotgun', 'smg'], ['ar2', 'revolver', 'lmg', 'dmr'], ['smg2', 'mpistol', 'shotgun', 'ar']];
const shots = [
  ['ar', { sight: 'iron' }, 1], ['ar', { sight: 'reddot' }, 1], ['ar', { sight: 'holo' }, 1], ['ar', { sight: 'reflex' }, 1],
  ['ar', { sight: 'x15' }, 1], ['ar', { sight: 'x20' }, 1], ['ar', { sight: 'x25' }, 1], ['shotgun', { sight: 'iron' }, 1],
  ['mpistol', { sight: 'reddot' }, 1], ['ar', { sight: 'holo', barrel: 'suppressor', grip: 'vertical', laser: true }, 0],
];
let n = 0;
for (const [id, kit, ads] of shots) {
  await page.evaluate(([id, kit, ads, LO]) => {
    const bc = window.__bc, p = bc.player, S = bc.session;
    const li = LO.findIndex((l) => l.includes(id));
    if (S.loadoutIdx !== li) S.setLoadout(li);
    const w = p.weapons.find((x) => x.base.id === id);
    w.setKit(kit); p.weaponIndex = p.weapons.indexOf(w); p.weapon.equipT = 0;
    p.ads = ads; p.intent.ads = !!ads;
  }, [id, kit, ads, LO]);
  await frames(10);
  await page.screenshot({ path: `${out}/b${String(++n).padStart(2, '0')}_${id}_${kit.sight}${ads ? '' : '_cadera'}.png` });
}
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

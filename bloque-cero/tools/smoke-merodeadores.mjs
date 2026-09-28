// Prueba de humo de la F10.1 en el navegador: partida en Élite; con la capa de depuración (P), los
// merodeadores de la defensa fuera del sitio (etiqueta «merodeador») y cómo vuelven cuando toca
// (etiqueta «ancla, volvió por…»). Capturas y sin errores.
// Uso: node tools/smoke-merodeadores.mjs <carpeta de capturas> [html]
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
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.settings.difficulty = 'elite'; bc.startMatch({ startSide: 'atk', seed: 5 }); });
await page.click('#sel-grid .opc:nth-child(3)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = async (name) => { await frames(4); await page.screenshot({ path: `${out}/${name}.png` }); };
// la simulación avanza solo cuando lo pide la prueba; el jugador, quieto y sin que nadie le dispare
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session;
  window.__step = s.tick.bind(s); s.tick = () => {};
  window.__run = (sec, until = null) => { for (let i = 0; i < Math.round(sec * 60); i++) { window.__step(1 / 60); if (until && until()) return i; } return -1; };
  bc.player.frozen = true;
});
// a la acción; el ataque bot, quieto (que nadie empuje ni se cruce con los merodeadores)
await page.evaluate(() => window.__run(60, () => window.__bc.match.phase === 'action'));
await page.evaluate(() => { for (const o of window.__bc.match.opsOfSide('atk')) o.frozen = true; window.__run(24); });
const who = await page.evaluate(() => {
  const bc = window.__bc, sq = bc.session.bots, D = sq.diff;
  const roam = [...sq.brains.values()].filter((B) => B.side === 'def' && B.role === 'roam');
  window.__roam = roam;
  const B = roam[0];
  if (B) {
    // la cámara, a unos metros del primero, mirándole; y la capa P
    const p = B.op.body.pos, yaw = B.op.yaw + Math.PI;
    bc.place(p.x - Math.sin(yaw) * 4.5, p.y, p.z - Math.cos(yaw) * 4.5, yaw + Math.PI, -0.1);
    bc.debug.toggle(true);
  }
  return { merodeadores: roam.length, tabla: { roamers: D.roamers, roamBack: D.roamBack, roamBreach: D.roamBreach, roamNear: D.roamNear }, donde: roam.map((B) => bc.map.locationAt(B.op.body.pos.x, B.op.body.pos.y + 0.3, B.op.body.pos.z)) };
});
console.log('merodeadores:', JSON.stringify(who));
const labels = () => page.evaluate(() => [...document.querySelectorAll('#dbg .dl')].filter((d) => d.style.display !== 'none').map((d) => d.textContent));
if (who.merodeadores) {
  await page.evaluate(() => window.__run(0.5));
  await shot('m1_merodeador');
  const a = await labels();
  console.log('etiquetas:', JSON.stringify(a.filter((t) => /merodea/.test(t))));
  check(a.some((t) => /merodeador/.test(t)), 'no se ve la etiqueta del merodeador');
  const site = await page.evaluate(() => { const m = window.__bc.match; return [m.site.A, m.site.B].map((id) => m.map.rooms.find((r) => r.id === id).name); });
  check(!who.donde.every((d) => site.includes(d)), 'los merodeadores no han salido del sitio: ' + JSON.stringify(who.donde));
  // vuelven cuando toca: quedan menos segundos que los de la tabla
  const back = await page.evaluate(() => {
    const bc = window.__bc, m = bc.match;
    m.timer = bc.session.bots.diff.roamBack - 1;
    window.__run(4);
    return window.__roam.map((B) => ({ papel: B.role, porque: B.roamBack || null, donde: bc.map.locationAt(B.op.body.pos.x, B.op.body.pos.y + 0.3, B.op.body.pos.z) }));
  });
  await shot('m2_vuelve');
  const b = await labels();
  console.log('al acabarse el tiempo:', JSON.stringify(back), JSON.stringify(b.filter((t) => /volvió/.test(t))));
  check(back.every((x) => x.papel === 'anchor' && x.porque === 'tiempo'), 'no vuelven al sitio');
  check(b.some((t) => /volvió por el tiempo/.test(t)), 'no se ve en la etiqueta que vuelven');
}
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

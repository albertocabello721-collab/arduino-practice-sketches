// Prueba de humo en el navegador de las animaciones de manos en primera persona (F7.2): cambio
// de arma, inspeccionar (y cortarlo al apuntar), reforzar, barricada y reanimar en el campo de
// pruebas, y lanzar una cegadora en partida; capturas de cada una y sin errores.
// Uso: node tools/smoke-manos.mjs <carpeta de capturas>
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
const shot = async (name, wait = 500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
// la simulación solo avanza cuando lo pide la prueba (sin ratón capturado, el bucle también la movería)
const freezeSim = () => page.evaluate(() => { const s = window.__bc.session; window.__step = s.tick.bind(s); s.tick = () => {}; });
const ticks = (n, body = '') => page.evaluate(([n, body]) => { const bc = window.__bc; const f = body ? new Function('bc', body) : null; for (let i = 0; i < n; i++) { if (f) f(bc); window.__step(1 / 60); } }, [n, body]);
// (el arma en primera persona se actualiza al pintar: sin tarjeta gráfica, unos pocos fotogramas por
// segundo; se espera a que se pinten antes de mirar)
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const hands = async () => { await frames(); return page.evaluate(() => { const H = window.__bc.ctx.vm.hands; return { accion: H.kind, activa: H.active, peso: +H.w.toFixed(2) }; }); };

// ---------------- campo de pruebas
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media'); bc.start(); });
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await freezeSim();
await page.evaluate(() => { const bc = window.__bc; const s = bc.game.operators.find((o) => o.id === 'm5'); if (s) bc.game.removeOperator(s); bc.place(15.5, 0, -6.5, Math.PI, 0.05); });
await ticks(4);
// 1) cambio de arma: la principal baja y sube la pistola
await ticks(1, 'bc.player.intent.switchTo = 1;');
await ticks(4);
await frames();
await shot('m1_guarda', 100);
const sw = await page.evaluate(() => ({ vm: window.__bc.ctx.vm.current, guardando: window.__bc.ctx.vm.prevKind }));
await ticks(40);
await shot('m2_saca', 400);
console.log('cambio de arma:', JSON.stringify(sw), '→', await page.evaluate(() => window.__bc.ctx.vm.current));
await ticks(1, 'bc.player.intent.switchTo = 0;');
await ticks(50);
// (el arma en primera persona tiene que ver el cambio antes de la I: si le llegan en el mismo
// fotograma, el cambio corta la inspección; jugando, el cambio se ve mucho antes de que esté lista)
await frames(2);
// 2) inspeccionar (I) y cortarlo disparando
await page.evaluate(() => { window.__bc.player.intent.inspect = true; });
await frames(6);
const ins = await hands();
await shot('m3_inspecciona', 100);
// (el disparo de la prueba lo pisaría el ratón en cada fotograma: se corta apuntando, que va por el mismo sitio)
await page.evaluate(() => { window.__bc.player.ads = 0.5; });
const cut = await hands();
await page.evaluate(() => { window.__bc.player.ads = 0; });
console.log('inspeccionar:', JSON.stringify(ins), '· al apuntar:', JSON.stringify(cut));
await page.waitForTimeout(500);
// 3) reforzar la pared cocina↔hall (mantener F)
await page.evaluate(() => { window.__bc.place(18.5, 0, 17.0, 0, 0.05); });
await ticks(10);
await ticks(90, 'bc.player.intent.interact = true;');
const rf = await hands();
await shot('m4_refuerza', 400);
await ticks(180, 'bc.player.intent.interact = true;');
await ticks(1, 'bc.player.intent.interact = false;');
console.log('reforzar:', JSON.stringify(rf), '· paneles:', await page.evaluate(() => window.__bc.session.fort.panels.length));
await page.waitForTimeout(400);
// 4) barricada en la puerta hall↔cocina
await page.evaluate(() => { window.__bc.place(16, 0, 17.1, 0, -0.25); });
await ticks(10);
await ticks(50, 'bc.player.intent.interact = true;');
const bar = await hands();
await shot('m5_barricada', 400);
await ticks(70, 'bc.player.intent.interact = true;');
await ticks(1, 'bc.player.intent.interact = false;');
console.log('barricada:', JSON.stringify(bar), '· barricadas:', await page.evaluate(() => window.__bc.session.fort.barricades.length));
await page.waitForTimeout(400);
// 5) reanimar al compañero derribado (J lo derriba; F al lado)
const rv = await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, p = bc.player;
  const mate = s.dummies.find((d) => d.team === 0);
  if (!mate) return null;
  s.game.damage(mate, mate.hp, { by: null, zone: 'body' });
  const m = mate.body.pos;
  bc.place(m.x + 0.9, m.y, m.z, Math.atan2(0.9, 0), -0.6);
  return { estado: mate.state };
});
await ticks(4);
await ticks(80, 'bc.player.intent.interact = true;');
const rev = await hands();
await shot('m6_reanima', 400);
await ticks(200, 'bc.player.intent.interact = true;');
await ticks(1, 'bc.player.intent.interact = false;');
console.log('reanimar:', JSON.stringify(rv), JSON.stringify(rev), '· compañero:', await page.evaluate(() => window.__bc.session.dummies.find((d) => d.team === 0)?.state));

// ---------------- partida: lanzar una cegadora (ROMPE) en la acción
await page.evaluate(() => { window.__bc.toMenu(); });
await page.waitForFunction(() => window.__bc.state.mode === 'menu');
await page.evaluate(() => { window.__bc.settings.quality = 'media'; window.__bc.startMatch({ startSide: 'atk', seed: 4 }); });
await page.click('#sel-grid .opc:nth-child(2)');          // ROMPE: humo o cegadora
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 120000 });
await freezeSim();
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
await page.evaluate(() => { const bc = window.__bc; for (const o of bc.match.game.operators) if (o !== bc.player) o.frozen = true; bc.place(10, 0.01, -9, Math.PI, -0.05); bc.player.gadget = { id: 'flash', left: 2 }; bc.player.gadgetCd = 0; });
await ticks(10);
await ticks(1, 'bc.player.intent.gadget = true;');
const th = await hands();
await shot('m7_lanza', 50);
console.log('lanzar:', JSON.stringify(th), '· objetos lanzados:', await page.evaluate(() => window.__bc.match.gadgets.items.length));
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

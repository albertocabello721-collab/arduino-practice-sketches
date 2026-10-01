// Prueba de humo de la F10.5 (mando) en el navegador, con un mando simulado y SIN TOCAR EL RATÓN:
//  · menú: al tocar el mando, «Mando conectado» y el foco en «Partida rápida» (el primer toque solo
//    lo enseña); la cruceta mueve el foco y el menú se desplaza; A cambia un desplegable; ←/→ un
//    deslizador; A en «Partida rápida» empieza;
//  · selección: el foco en los operadores; → y A eligen; Start es «Listo»;
//  · preparación: el dron con los sticks;
//  · una ronda: mover, correr (L3), mirar (sin capturar el ratón), disparar (RT), apuntar (LT), recargar
//    (X), agacharse y tumbarse (B), cambiar de arma (Y), gadget (LB), habilidad (RB), rappel (A),
//    marcar (▲), órdenes (▼ + stick derecho), marcador (Select), dron (mantener Y); la ronda termina;
//  · la sensibilidad del mando se nota (de 0,5 a 2: el giro ×4) y el invertir; vibra al disparar y al
//    recibir daño (y no si se quita en Ajustes);
//  · Start pausa (la simulación se para) y B sale al menú;
//  · ▲ tocada marca; mantenida cambia el modo de disparo y no marca; A mantenida junto a la fachada
//    engancha el rappel y no inspecciona, y en campo abierto inspecciona; con «apuntar: alternar», LT
//    tocado deja apuntando (F10.4);
//  · el campo de pruebas con el mando (Select cambia de equipo); al tocar el teclado vuelven el teclado
//    y el ratón («Clic para seguir jugando»); sin errores.
// Con --ps, un mando de PlayStation (id de Sony): los mismos avisos con ✕ ○ □ △, L1/R1, L2/R2, Options y Share.
// Uso: node tools/smoke-mando.mjs [carpeta para capturas] [html] [--ps]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
import { padNames } from '../src/input/gamepad.js';
const PS = process.argv.includes('--ps');
const posArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const out = posArgs[0] || '.';
const html = posArgs[1] || 'dist/bloque-cero.html';
const KIND = PS ? 'ps' : 'xbox', N = padNames(KIND);
const PAD_ID = PS ? 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' : 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const check = (ok, what) => { if (!ok) errors.push(what); console.log((ok ? '  ok  ' : '  MAL ') + what); };
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

// el mando simulado (antes de cargar la página): botones y ejes que la prueba mueve, y la vibración
await page.addInitScript((PAD_ID) => {
  const st = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
  const rumbles = [];
  const pad = {
    id: PAD_ID, index: 0, connected: true, mapping: 'standard', timestamp: 0,
    get buttons() { return st.buttons; }, get axes() { return st.axes; },
    vibrationActuator: { type: 'dual-rumble', playEffect(type, p) { rumbles.push(Object.assign({ type }, p)); return Promise.resolve('complete'); } },
  };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.__pad = {
    rumbles,
    btn(i, v = 1) { const b = st.buttons[i]; b.value = v; b.pressed = v > 0.5; b.touched = v > 0; },
    stick(lx = 0, ly = 0, rx = 0, ry = 0) { st.axes[0] = lx; st.axes[1] = ly; st.axes[2] = rx; st.axes[3] = ry; },
    clear() { for (const b of st.buttons) { b.value = 0; b.pressed = false; b.touched = false; } st.axes.fill(0); },
    async frames(n) { for (let i = 0; i < n; i++) await frame(); },
    async tap(i) { this.btn(i, 1); await this.frames(3); this.btn(i, 0); await this.frames(3); },
    // mantener `secs` segundos de juego (como cuenta el bucle: como mucho 0,1 s por fotograma);
    // `during()` se llama en cada fotograma; devuelve los segundos de juego que pasaron
    async hold(set, secs, during = null) {
      set();
      let t = 0, prev = performance.now();
      while (t < secs) { await frame(); const now = performance.now(); t += Math.min(0.1, (now - prev) / 1000); prev = now; if (during) during(); }
      this.clear();
      await this.frames(3);
      return t;
    },
  };
}, PAD_ID);
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const tap = (b) => page.evaluate((b) => window.__pad.tap(b), b);
const P = (expr) => page.evaluate(expr);
const frames = (n = 3) => page.evaluate((n) => window.__pad.frames(n), n);
const focus = () => page.evaluate(() => {
  const f = document.querySelector('.padfocus');
  if (!f) return null;
  const el = f.matches('button, select, input') ? f : f.querySelector('button, select, input');
  const r = f.getBoundingClientRect();
  return { id: el && el.id, act: el && el.dataset.act, v: el && el.dataset.v, inView: r.top >= 0 && r.bottom <= innerHeight, root: f.closest('#menu') ? 'menu' : f.closest('#select') ? 'select' : f.closest('#matchend') ? 'matchend' : '?' };
});
// pulsar en una dirección hasta que el foco llegue a `id` (como mucho `max` veces)
const navTo = async (dir, id, max = 30) => { for (let i = 0; i < max; i++) { const f = await focus(); if (f && f.id === id) return true; await tap(dir); } const f = await focus(); return !!f && f.id === id; };

await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.evaluate(() => { const bc = window.__bc; bc.settings.quality = 'baja'; bc.post.setQuality('baja'); bc.settings.announcer = false; bc.settings.opVoice = false; });

// ------------------------------------------------------------------ menú
console.log('menú');
check(await page.evaluate(() => !window.__bc.ctx.input.padActive && !document.querySelector('.padfocus')), 'sin tocar el mando, nada cambia (ni foco ni aviso)');
await tap(B.A);
const m0 = await page.evaluate(() => ({ note: !document.getElementById('padnote').classList.contains('hidden'), noteText: document.getElementById('padnote').textContent, mode: window.__bc.state.mode, active: window.__bc.ctx.input.padActive, kind: window.__bc.ctx.input.padKind, keys: [...document.querySelectorAll('#padkeys kbd')].map((k) => k.textContent) }));
const f0 = await focus();
await shot('f105_01_menu');
check(m0.active && m0.note, 'al tocar el mando: «Mando conectado»');
check(m0.kind === KIND && (PS ? /PlayStation/.test(m0.noteText) : !/PlayStation/.test(m0.noteText)), `el tipo de mando por su nombre (${m0.kind}: «${m0.noteText}»)`);
check(m0.keys.includes(N.RT) && m0.keys.includes(N.A) && m0.keys.includes(N.Start) && (PS ? !m0.keys.includes('RT') : true), `el panel de controles con los nombres del mando (${m0.keys.slice(0, 6).join(', ')})`);
check(f0 && f0.id === 'btn-match' && m0.mode === 'menu', 'el primer toque enseña el foco en «Partida rápida» (y no la empieza)');
await tap(B.DOWN);
check((await focus()).id === 'btn-play', 'la cruceta baja a «Campo de pruebas»');
await tap(B.UP);
check((await focus()).id === 'btn-match', 'y sube a «Partida rápida»');
// bando inicial: ataque (A pasa a la siguiente opción)
await tap(B.DOWN); await tap(B.DOWN);
const fs = await focus();
await tap(B.A);
const side = await page.evaluate(() => window.__bc.settings.startSide);
check(fs.id === 'qm-side' && side === 'atk', `A en «Bando inicial» lo cambia (${fs.id}: ${side})`);
await tap(B.RIGHT);
check((await focus()).id === 'qm-diff', 'a la derecha, «Bots»');
// el deslizador de la sensibilidad del mando, más abajo (el menú se desplaza hasta él)
const reached = await navTo(B.DOWN, 'set-padsens');
const fp = await focus();
await tap(B.RIGHT); await tap(B.RIGHT);
const ps = await page.evaluate(() => ({ v: window.__bc.settings.padSens, out: document.getElementById('out-padsens').textContent }));
await shot('f105_02_ajustes');
check(reached && fp.inView, 'el foco baja hasta «Sensibilidad del mando» y el menú se desplaza para verlo');
check(Math.abs(ps.v - 1.1) < 1e-6 && ps.out === '1.10', `→ sube la sensibilidad del mando (${ps.v}, «${ps.out}»)`);
await tap(B.LEFT); await tap(B.LEFT);
check(await page.evaluate(() => Math.abs(window.__bc.settings.padSens - 1) < 1e-6), '← la baja');
check(await navTo(B.UP, 'btn-match', 40), 'de vuelta arriba, a «Partida rápida»');
await tap(B.A);
await page.waitForFunction(() => window.__bc.match && window.__bc.match.phase === 'select', null, { timeout: 60000 });

// ------------------------------------------------------------------ selección de operador
console.log('selección');
await frames(4);
const s0 = await focus();
check(s0 && s0.root === 'select' && s0.act === 'op', 'en la selección, el foco en los operadores');
check(await page.evaluate((n) => document.getElementById('sel-ready').innerHTML.includes(n) && !document.getElementById('sel-ready').innerHTML.includes('Intro'), N.Start), `el botón «Listo» dice ${N.Start} (no Intro)`);
await tap(B.RIGHT);
await tap(B.A);
const s1 = await page.evaluate(() => ({ op: window.__bc.session.meSlot.opId, sel: (document.querySelector('#sel-grid .opc.sel') || {}).dataset }));
const s1f = await focus();
await shot('f105_03_seleccion');
check(s1.op === 'rompe' && s1.sel && s1.sel.v === 'rompe', `→ y A eligen el segundo operador (${s1.op})`);
check(s1f && s1f.v === 'rompe', 'el foco sigue en él aunque la pantalla se vuelva a pintar');
await tap(B.START);
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
check(true, 'Start: «Listo» y empieza la preparación');

// ------------------------------------------------------------------ preparación: el dron
console.log('preparación (dron)');
await page.waitForFunction(() => window.__bc.session.feed.mode === 'drone' && window.__bc.session.feed.piloting, null, { timeout: 30000 });
const dr = await page.evaluate(async () => {
  const s = window.__bc.session, d = s.feed.drone, p0 = { ...d.body.pos }, y0 = d.yaw;
  await window.__pad.hold(() => window.__pad.stick(0, -1, 0.8, 0), 1.2);
  return { moved: Math.hypot(d.body.pos.x - p0.x, d.body.pos.z - p0.z), turned: y0 - d.yaw, paused: window.__bc.ctx.paused, locked: window.__bc.ctx.input.locked };
});
check(dr.moved > 0.5 && dr.turned > 0.3, `el dron se mueve y gira con los sticks (${dr.moved.toFixed(2)} m, ${dr.turned.toFixed(2)} rad)`);
const fk = await P(() => ({ keys: document.getElementById('fd-keys').textContent, prep: document.getElementById('prepinfo').textContent }));
check(fk.keys.includes(`Stick izq. mover · ${N.A} saltar · ${N.RT}/▲ marcar`) && !/WASD|Espacio/.test(fk.keys), `los avisos del dron con los botones del mando («${fk.keys}»)`);
check((fk.prep.includes('Stick izq.') || fk.prep.includes(`${N.A} saltar`)) && !/WASD|Espacio/.test(fk.prep), 'el aviso de la preparación con los botones del mando');
check(!dr.paused && !dr.locked, 'sin capturar el ratón y sin pausa');

// a la acción; los bots, quietos (la prueba es del mando, no de sobrevivir)
await page.evaluate(() => { window.__bc.match.timer = 0.3; });
await page.waitForFunction(() => window.__bc.match.phase === 'action' && !window.__bc.session.feed.active, null, { timeout: 30000 });
await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, g = s.game, p = bc.player;
  s.bots.update = () => {};
  for (const o of g.operators) if (o !== p) Object.assign(o.intent, { fire: false, ads: false, moveX: 0, moveZ: 0, sprint: false, interact: false });
  bc.place(10, 0, -13.5, Math.PI, 0);
});
await frames(4);

// ------------------------------------------------------------------ la ronda con el mando
console.log('ronda');
// mover y correr
const mv = await P(async () => {
  const p = window.__bc.player, a = { ...p.body.pos };
  await window.__pad.hold(() => window.__pad.stick(0, -1), 1.0);
  const walk = Math.hypot(p.body.pos.x - a.x, p.body.pos.z - a.z);
  let sprint = false;
  window.__pad.stick(0, -1); window.__pad.btn(10, 1); await window.__pad.frames(3); window.__pad.btn(10, 0);
  await window.__pad.hold(() => window.__pad.stick(0, -1), 0.6, () => { sprint = sprint || p.sprinting; });
  return { walk, sprint };
});
check(mv.walk > 1.2, `stick izquierdo: camina (${mv.walk.toFixed(2)} m en 1 s)`);
check(mv.sprint, 'L3: corre');
// mirar (sin el ratón capturado), con la sensibilidad del mando y el invertir
const lk = await P(async () => {
  const bc = window.__bc, p = bc.player, S = bc.settings;
  const turn = async (rx, ry, secs) => { const y0 = p.yaw, q0 = p.pitch; const t = await window.__pad.hold(() => window.__pad.stick(0, 0, rx, ry), secs); return { yaw: (y0 - p.yaw) / t, pitch: (p.pitch - q0) / t }; };
  const r1 = await turn(1, 0, 0.5);
  const up = await turn(0, -1, 0.25);
  S.padSens = 0.5; const lo = await turn(1, 0, 0.5);
  S.padSens = 2; const hi = await turn(1, 0, 0.5);
  S.padSens = 1; S.padInvertY = true; const inv = await turn(0, -1, 0.25);
  S.padInvertY = false; p.pitch = 0;
  return { r1: r1.yaw, up: up.pitch, lo: lo.yaw, hi: hi.yaw, inv: inv.pitch, locked: bc.ctx.input.locked };
});
console.log('  mirar:', JSON.stringify(lk));
check(lk.r1 > 2.4 && lk.r1 < 4.2 && !lk.locked, `stick derecho: gira a la derecha (${lk.r1.toFixed(2)} rad/s a tope) sin capturar el ratón`);
check(lk.up > 1, 'stick derecho arriba: mira arriba');
check(lk.hi / lk.lo > 3 && lk.hi / lk.lo < 5.3, `la sensibilidad del mando se nota (×${(lk.hi / lk.lo).toFixed(2)} de 0,5 a 2)`);
check(lk.inv < -1, 'invertir el eje vertical del mando');
// disparar, apuntar, recargar (y vibra al disparar)
await P(() => window.__bc.place(10, 0, -9, Math.PI, 0.05));
await frames(3);
const sh = await P(async () => {
  const p = window.__bc.player, w = p.weapon, a0 = w.ammo, r0 = window.__pad.rumbles.length;
  await window.__pad.hold(() => window.__pad.btn(7, 1), 0.35);
  const fired = a0 - w.ammo, rum = window.__pad.rumbles.slice(r0);
  let ads = 0;
  await window.__pad.hold(() => window.__pad.btn(6, 1), 0.5, () => { ads = Math.max(ads, p.ads); });
  await window.__pad.tap(2);
  await window.__pad.frames(2);
  const reloading = w.reloading;
  await window.__pad.hold(() => {}, w.def.reload ? w.def.reload + 0.6 : 3.5);
  return { fired, rum: rum.length, mag: rum[0] && rum[0].weakMagnitude, ads, reloading, full: w.ammo >= w.def.mag };
});
console.log('  disparar:', JSON.stringify(sh));
check(sh.fired >= 2, `RT dispara (${sh.fired} balas)`);
check(sh.rum >= 1, 'el mando vibra al disparar');
check(sh.ads > 0.8, 'LT apunta');
check(sh.reloading && sh.full, 'X (tocar) recarga');
// postura con B; arma con Y
const st = await P(async () => {
  const p = window.__bc.player, s = [];
  await window.__pad.tap(1); await window.__pad.frames(4); s.push(p.intent.stance);
  await window.__pad.tap(1); await window.__pad.frames(4); s.push(p.intent.stance);
  await window.__pad.hold(() => window.__pad.btn(1, 1), 0.6); await window.__pad.frames(4); s.push(p.intent.stance);
  await window.__pad.hold(() => window.__pad.btn(1, 1), 0.6); await window.__pad.frames(4); s.push(p.intent.stance);
  const w0 = p.weaponIndex;
  await window.__pad.tap(3); await window.__pad.hold(() => {}, 0.8);
  const w1 = p.weaponIndex;
  await window.__pad.tap(3); await window.__pad.hold(() => {}, 0.8);
  return { s, w: [w0, w1, p.weaponIndex] };
});
console.log('  postura y arma:', JSON.stringify(st));
check(st.s.join() === 'crouch,stand,prone,stand', 'B: agacharse, levantarse; mantener B: cuerpo a tierra y de pie');
check(st.w.join() === '0,1,0', 'Y: cambiar de arma (y volver)');
// gadget (LB) y habilidad (RB), mirando a la casa
await P(() => window.__bc.place(10, 0, -9, Math.PI, 0.1));
await frames(3);
const gd = await P(async () => {
  const p = window.__bc.player, g0 = p.gadget.left, a0 = p.ability.left;
  await window.__pad.tap(4); await window.__pad.hold(() => {}, 0.8);
  await window.__pad.tap(5); await window.__pad.hold(() => {}, 0.8);
  return { gadget: [g0, p.gadget.left], ability: [a0, p.ability.left] };
});
console.log('  gadget y habilidad:', JSON.stringify(gd));
check(gd.gadget[1] === gd.gadget[0] - 1, 'LB: gadget secundario');
check(gd.ability[1] === gd.ability[0] - 1, 'RB: habilidad del operador');
// rappel (A al pie de la fachada; subir con el stick; B lo suelta)
await P(() => window.__bc.place(6, 0, -1.2, Math.PI, 0.15));
await frames(4);
const rp = await P(async () => {
  const p = window.__bc.player, vm = window.__bc.ctx.vm;
  await window.__pad.frames(3);
  const prompt = document.getElementById('prompt').textContent;
  // A mantenida junto a la fachada: engancha el rappel (la acción) y no inspecciona
  let inspected = false;
  await window.__pad.hold(() => window.__pad.btn(0, 1), 0.8, () => { inspected = inspected || vm.hands.kind === 'inspect' || !!p.intent.inspect; });
  const hooked = !!p.rappel, y0 = p.body.pos.y;
  await window.__pad.hold(() => window.__pad.stick(0, -1), 1.2);
  const y1 = p.body.pos.y;
  await window.__pad.tap(1); await window.__pad.hold(() => {}, 1.2);
  return { hooked, climbed: y1 - y0, released: !p.rappel, inspected, prompt, gear: document.getElementById('gear').textContent, kit: document.getElementById('kit').textContent };
});
console.log('  rappel:', JSON.stringify(rp));
check(!rp.inspected, 'A mantenida junto a la fachada inspecciona');
check(rp.prompt === `Pulsa ${N.A} para hacer rappel`, `el aviso del rappel dice ${N.A} («${rp.prompt}»)`);
check(/▼ órdenes/.test(rp.gear) && rp.gear.includes(`mantén ${N.Y}: dron · R3 golpe`) && (rp.kit.includes(N.RB) || rp.kit.includes(N.LB)) && !/H órdenes|5 dron/.test(rp.gear), `el HUD con los botones del mando («${rp.gear}» · «${rp.kit}»)`);
check(rp.hooked && rp.climbed > 0.5, 'A (mantenida junto a la fachada): rappel, y el stick sube');
check(rp.released, 'B suelta la cuerda');
await P(() => { window.__bc.place(10, 0, -12, Math.PI, 0); });
await frames(4);
// en campo abierto (nada delante): A mantenida inspecciona; ▲ mantenida cambia el modo de disparo sin marcar;
// con «apuntar: alternar», LT tocado deja apuntando
const ex = await P(async () => {
  const bc = window.__bc, p = bc.player, m = bc.match, vm = bc.ctx.vm;
  let inspected = false;
  await window.__pad.hold(() => window.__pad.btn(0, 1), 0.8, () => { inspected = inspected || vm.hands.kind === 'inspect'; });
  await window.__pad.hold(() => {}, 0.3);
  const vaulted = !!p.vault || !!p.rappel;
  m.recon.pings.delete(p);
  const mode0 = p.weapon.mode;
  await window.__pad.hold(() => window.__pad.btn(12, 1), 0.7);
  await window.__pad.frames(3);
  const modeHold = p.weapon.mode, pingHold = m.recon.pings.has(p);
  await window.__pad.tap(12); await window.__pad.frames(3);
  const pingTap = m.recon.pings.has(p), modeTap = p.weapon.mode;
  bc.settings.adsMode = 'toggle';
  await window.__pad.tap(6); await window.__pad.hold(() => {}, 0.5);
  const adsOn = p.ads;
  await window.__pad.tap(6); await window.__pad.hold(() => {}, 0.5);
  const adsOff = p.ads;
  bc.settings.adsMode = 'hold';
  await window.__pad.hold(() => {}, 0.3);
  return { inspected, vaulted, mode0, modeHold, pingHold, pingTap, modeTap, adsOn, adsOff, adsHold: p.ads };
});
console.log('  A y ▲ mantenidas, LT alternando:', JSON.stringify(ex));
check(ex.inspected && !ex.vaulted, 'A mantenida sin nada delante no inspecciona');
check(ex.modeHold !== ex.mode0 && !ex.pingHold, `▲ mantenida: el modo de disparo (${ex.mode0} → ${ex.modeHold}) sin marcar`);
check(ex.pingTap && ex.modeTap === ex.modeHold, '▲ tocada: marca (y no cambia el modo)');
check(ex.adsOn > 0.8 && ex.adsOff < 0.2 && ex.adsHold < 0.2, `con «apuntar: alternar», LT tocado deja apuntando y otra vez lo quita (${ex.adsOn.toFixed(2)} → ${ex.adsOff.toFixed(2)})`);
// marcar, órdenes, marcador
const ui = await P(async () => {
  const bc = window.__bc, s = bc.session, p = bc.player, m = bc.match;
  p.pitch = -0.2;
  m.recon.pings.delete(p);
  await window.__pad.tap(12); await window.__pad.frames(3);
  const ping = m.recon.pings.has(p);
  let open = false, sel = -1;
  await window.__pad.hold(() => { window.__pad.btn(13, 1); window.__pad.stick(0, 0, 1, 0); }, 0.6, () => { open = open || s.wheel.open; sel = Math.max(sel, s.wheel.sel); });
  await window.__pad.frames(3);
  const order = s.activeOrder();
  let board = false;
  await window.__pad.hold(() => window.__pad.btn(8, 1), 0.3, () => { board = board || !document.getElementById('scoreboard').classList.contains('hidden'); });
  return { ping, open, sel, closed: !s.wheel.open, order, board, boardGone: document.getElementById('scoreboard').classList.contains('hidden') };
});
console.log('  marcar, órdenes, marcador:', JSON.stringify(ui));
check(ui.ping, '▲: marca');
check(ui.open && ui.sel >= 0 && ui.closed && ui.order === 'hold', `▼ mantenido abre las órdenes, el stick derecho elige y al soltar se da (${ui.order})`);
check(ui.board && ui.boardGone, 'Select: marcador mientras se mantiene');
// el dron: mantener Y
const dn = await P(async () => {
  const s = window.__bc.session;
  await window.__pad.hold(() => window.__pad.btn(3, 1), 0.7);
  await window.__pad.frames(3);
  const on = s.feed.active && s.feed.mode === 'drone';
  const d = s.feed.drone, p0 = d ? { ...d.body.pos } : null;
  await window.__pad.hold(() => {}, 1.0);     // (lo lanza y cae)
  await window.__pad.hold(() => window.__pad.stick(0, -1), 1.0);
  const moved = d && p0 ? Math.hypot(d.body.pos.x - p0.x, d.body.pos.z - p0.z) : 0;
  await window.__pad.hold(() => window.__pad.btn(3, 1), 0.7);
  await window.__pad.frames(3);
  return { on, moved, off: !s.feed.active };
});
console.log('  dron:', JSON.stringify(dn));
check(dn.on && dn.moved > 0.3 && dn.off, 'mantener Y: el dron (se mueve con el stick) y otra vez, de vuelta');
// vibra al recibir daño; sin vibración en Ajustes, no vibra
const rb = await P(async () => {
  const bc = window.__bc, g = bc.game, p = bc.player, R = window.__pad.rumbles;
  const foe = g.operators.find((o) => o.team !== p.team && o.state === 'alive');
  const r0 = R.length;
  g.damage(p, 12, { by: foe, zone: 'body', weapon: foe.weapon.def, point: p.eyePos(), dir: { x: 0, y: 0, z: 1 } });
  await window.__pad.frames(2);
  const hurt = R.slice(r0);
  bc.settings.padRumble = false;
  const r1 = R.length;
  await window.__pad.hold(() => window.__pad.btn(7, 1), 0.3);
  const off = R.length - r1;
  bc.settings.padRumble = true;
  return { hurt: hurt.length, strong: hurt[0] && hurt[0].strongMagnitude, off, hp: p.hp };
});
console.log('  vibración:', JSON.stringify(rb));
check(rb.hurt >= 1 && rb.strong > 0.4, 'el mando vibra al recibir daño (más fuerte que al disparar)');
check(rb.off === 0, 'sin «vibrar» en Ajustes, no vibra');
// Start pausa: la simulación se para; Start sigue
const pz = await P(async () => {
  const bc = window.__bc, m = bc.match;
  await window.__pad.tap(9); await window.__pad.frames(2);
  const t0 = m.timer, hint = document.getElementById('pausehint'), a = { paused: bc.ctx.paused, shown: !hint.classList.contains('hidden'), text: hint.textContent };
  await window.__pad.hold(() => {}, 0.6);
  a.still = m.timer === t0;
  await window.__pad.tap(9); await window.__pad.frames(2);
  a.resumed = !bc.ctx.paused;
  return a;
});
await shot('f105_04_ronda');
console.log('  pausa:', JSON.stringify(pz));
check(pz.paused && pz.shown && pz.still && pz.text.includes(`${N.Start} para seguir`) && pz.text.includes(`${N.B}: menú`), `Start pausa (y lo dice: «${pz.text}»)`);
check(pz.resumed, 'Start otra vez: sigue');
// fin de la ronda (caen los defensores) y la selección de la siguiente, con el foco del mando
await P(() => { const bc = window.__bc, g = bc.game, p = bc.player; for (const o of g.operators) if (o.team !== p.team && o.state !== 'dead') g.kill(o, { by: p }); });
await page.waitForFunction(() => window.__bc.match.phase === 'roundEnd', null, { timeout: 30000 });
check(true, 'la ronda termina');
await page.waitForFunction(() => window.__bc.match.phase === 'select', null, { timeout: 90000 });
await frames(4);
const s2 = await focus();
check(s2 && s2.root === 'select', 'la selección de la ronda 2, con el foco del mando');
await tap(B.A);
await tap(B.START);
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
// Start pausa y B sale al menú
await tap(B.START);
const pb = await P(() => window.__bc.ctx.paused);
await tap(B.B);
await page.waitForFunction(() => window.__bc.state.mode === 'menu', null, { timeout: 20000 });
await frames(4);
const mf = await focus();
check(pb && mf && mf.root === 'menu', 'en pausa, B: al menú principal (con el foco del mando)');

// ------------------------------------------------------------------ campo de pruebas
console.log('campo de pruebas');
await tap(B.DOWN);
check((await focus()).id === 'btn-play', 'al «Campo de pruebas»');
await tap(B.A);
await page.waitForFunction(() => window.__bc.state.mode === 'play' && window.__bc.player, null, { timeout: 30000 });
await frames(6);
const rg = await P(async () => {
  const bc = window.__bc, s = bc.session, p = bc.player, a = { ...p.body.pos };
  await window.__pad.hold(() => window.__pad.stick(0.6, -0.8), 0.8);
  const moved = Math.hypot(p.body.pos.x - a.x, p.body.pos.z - a.z);
  const w = p.weapon, a0 = w.ammo;
  await window.__pad.hold(() => window.__pad.btn(7, 1), 0.3);
  const fired = a0 - w.ammo, k0 = s.loadoutIdx;
  await window.__pad.tap(8); await window.__pad.frames(2);
  return { moved, fired, loadout: [k0, s.loadoutIdx], paused: bc.ctx.paused, locked: bc.ctx.input.locked };
});
await shot('f105_05_campo');
console.log('  campo:', JSON.stringify(rg));
check(rg.moved > 0.8 && rg.fired >= 1 && !rg.paused && !rg.locked, 'en el campo de pruebas: anda y dispara con el mando, sin capturar el ratón');
check(rg.loadout[1] === rg.loadout[0] + 1, 'Select: el siguiente equipo');
await tap(B.DOWN);
await frames(3);
const kp = await focus();
const kpo = await P(() => ({ open: !document.getElementById('kitpanel').classList.contains('hidden'), note: document.querySelector('#kitpanel .note').textContent }));
await tap(B.B);
await frames(3);
const kpc = await P(() => ({ open: !document.getElementById('kitpanel').classList.contains('hidden'), paused: window.__bc.ctx.paused }));
check(kpo.open && kp && kp.act === 'kit' && kpo.note.includes(N.B), `▼ abre el panel de miras y accesorios con el foco en una opción («${kpo.note}»)`);
check(!kpc.open && !kpc.paused, 'B lo cierra y se sigue jugando');
// el teclado: al tocarlo, vuelve el teclado y el ratón (pausa hasta un clic, como siempre)
await page.keyboard.press('KeyW');
await frames(3);
const kb = await P(() => ({ active: window.__bc.ctx.input.padActive, paused: window.__bc.ctx.paused, text: document.getElementById('pausehint').textContent, ring: !!document.querySelector('.padfocus') }));
console.log('  teclado:', JSON.stringify(kb));
check(!kb.active && kb.paused && kb.text === 'Clic para seguir jugando', 'al tocar el teclado, vuelven el teclado y el ratón («Clic para seguir jugando»)');
// y el teclado juega como siempre. (Aquí la captura del ratón no es de fiar: en esta máquina se
// concede y se pierde sola; se hace fallar, como en las demás pruebas, y el juego sigue sin captura.)
await P(() => { window.__bc.ctx.canvas.requestPointerLock = () => { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0); return Promise.resolve(); }; });
await page.click('#pausehint');
await frames(3);
const kw = await P(async () => {
  const p = window.__bc.player, a = { ...p.body.pos }, paused = window.__bc.ctx.paused;
  return { paused, a };
});
// (en esta máquina los fotogramas van lentos: lo que se mide, en tiempo de juego, como con el mando)
await page.keyboard.down('KeyW');
await P(() => window.__pad.hold(() => {}, 1.0));
await page.keyboard.up('KeyW');
const k1 = await page.evaluate((a) => { const p = window.__bc.player; return Math.hypot(p.body.pos.x - a.x, p.body.pos.z - a.z); }, kw.a);
const stanceIs = (want) => P(() => new Promise((r) => { const p = window.__bc.player; let k = 0; const f = () => { if (p.intent.stance === window.__want || ++k > 40) r(p.intent.stance); else requestAnimationFrame(f); }; requestAnimationFrame(f); }).then((v) => v)).then(null, () => '?');
await page.keyboard.press('KeyC');
await P(() => { window.__want = 'crouch'; });
const kc = await stanceIs('crouch');
await page.keyboard.press('KeyC');
await P(() => { window.__want = 'stand'; });
const ks = await stanceIs('stand');
await page.keyboard.press('Digit2');
await P(() => window.__pad.hold(() => {}, 0.8));
const k2 = await P(() => { const p = window.__bc.player; return { stance: p.intent.stance, weapon: p.weaponIndex, pad: window.__bc.ctx.input.padActive }; });
k2.moved = k1; k2.stance = ks;
console.log('  teclado:', JSON.stringify({ ...k2, crouch: kc, paused: kw.paused }));
check(!kw.paused && k2.moved > 1 && kc === 'crouch' && k2.stance === 'stand' && k2.weapon === 1 && !k2.pad, 'con el teclado: W anda, C se agacha y se levanta, 2 cambia de arma');
// Esc al menú (sin captura, el primero)
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__bc.state.mode === 'menu', null, { timeout: 20000 });
await frames(3);
check(!(await page.evaluate(() => !!document.querySelector('.padfocus'))), 'con el teclado, el menú sin foco del mando');

console.log('errores:', errors.length ? '\n' + errors.join('\n') : 0);
await browser.close();
process.exit(errors.length ? 1 : 0);

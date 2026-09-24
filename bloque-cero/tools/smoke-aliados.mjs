// Prueba de humo en el navegador de las ayudas de equipo: capa de depuración (P),
// marcar con T (marca de posición y enemigo marcado), chat de equipo con voz y rueda de
// órdenes H (Seguirme, Ir a mi marca), reglas de edificio (no salir en la preparación,
// anti run-out) y, muerto, cámaras (defensa) o drones (ataque).
// Uso: node tools/smoke-aliados.mjs <carpeta de capturas>
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
await page.evaluate(() => { window.__bc.settings.quality = 'baja'; });
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
const ticks = (n, body = '') => page.evaluate(([n, body]) => {
  const bc = window.__bc; const f = body ? new Function('bc', body) : null;
  for (let i = 0; i < n; i++) { if (f) f(bc); bc.session.tick(1 / 60); }
  const m = bc.match; return m ? { phase: m.phase, time: +m.timeLeft.toFixed(1) } : null;
}, [n, body]);

// partida defendiendo: el jugador está dentro de la casa con sus aliados bot
await page.evaluate(() => { window.__bc.settings.difficulty = 'normal'; window.__bc.startMatch({ startSide: 'def', seed: 11 }); });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
// voz de los aliados activada y registro de la radio
await page.evaluate(() => { const bc = window.__bc; bc.settings.allyVoice = true; window.__radio = []; bc.match.game.on('radio', (op, text) => window.__radio.push(`${op.team} ${op.name}: ${text}`)); });
await ticks(60 * 6);

// ---------------- 1) depuración con P
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__bc.debug.on, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);
const dbg = await page.evaluate(() => {
  const bc = window.__bc, d = bc.debug;
  const labels = [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
  return { on: d.on, visible: d.group.visible, stats: { ...d.stats }, perf: !document.getElementById('perf').classList.contains('hidden'), labels: labels.slice(0, 5) };
});
console.log('depuración:', JSON.stringify(dbg));
await shot('a1_depuracion', 600);

// ---------------- 1b) preparación: la defensa no puede salir (pared invisible en la puerta principal)
const home = await page.evaluate(() => { const p = window.__bc.player; return { x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, yaw: p.yaw }; });
await page.evaluate(() => window.__bc.place(15.5, 0.01, 1.2, 0, 0));
await ticks(60 * 3, 'bc.player.intent.moveZ = 1;');
const wall = await page.evaluate(() => { const bc = window.__bc, p = bc.player.body.pos; return { z: +p.z.toFixed(2), fuera: bc.map.isOutside(p.x, p.y, p.z), aviso: document.getElementById('toast').textContent }; });
console.log('pared invisible:', JSON.stringify(wall));
await page.evaluate((h) => { window.__bc.player.intent.moveZ = 0; window.__bc.place(h.x, h.y, h.z, h.yaw, 0); }, home);
await ticks(2);

// ---------------- 2) T: marca de posición (preparación) y enemigo marcado (acción)
await page.evaluate(() => { const bc = window.__bc; const p = bc.player.body.pos; bc.place(p.x, p.y, p.z, bc.player.yaw, -0.25); });
await ticks(2);
await page.keyboard.press('KeyT');
await page.waitForFunction(() => window.__bc.match.recon.pings.size > 0, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const pingInfo = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, pg = m.recon.pingOf(0, bc.player);
  const mk = [...document.querySelectorAll('#markers .mk.ping')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
  return { ping: pg && { x: +pg.x.toFixed(2), y: +pg.y.toFixed(2), z: +pg.z.toFixed(2), vence: +(pg.until - m.time).toFixed(1) }, marcadores: mk };
});
console.log('marca de posición:', JSON.stringify(pingInfo));
await shot('a2_marca_posicion', 400);

// ---------------- 3) rueda de órdenes H: «Seguirme» y luego «Ir a mi marca»
await page.keyboard.down('KeyH');
await page.waitForFunction(() => window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => window.__bc.session.wheel.move(0, -70));      // ratón hacia arriba: «Seguirme»
await page.waitForTimeout(700);
const wheel = await page.evaluate(() => ({
  abierta: window.__bc.session.wheel.open,
  opciones: [...document.querySelectorAll('#wheel .wo')].map((e) => e.textContent + (e.classList.contains('on') ? ' [x]' : '') + (e.classList.contains('off') ? ' (no)' : '')),
}));
console.log('rueda:', JSON.stringify(wheel));
await shot('a3_rueda', 200);
await page.keyboard.up('KeyH');
await page.waitForFunction(() => !window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
await ticks(60 * 8);
const follow = await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, me = bc.player;
  const allies = [...s.bots.brains.values()].filter((B) => B.team === 0);
  return { orden: s.activeOrder(), distancias: allies.map((B) => +Math.hypot(B.op.body.pos.x - me.body.pos.x, B.op.body.pos.z - me.body.pos.z).toFixed(1)), chat: [...document.querySelectorAll('#chat .cl')].map((e) => e.textContent), gear: document.getElementById('gear').textContent };
});
console.log('seguirme:', JSON.stringify(follow));
await shot('a4_seguirme', 1200);
await page.keyboard.down('KeyH');
await page.waitForFunction(() => window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
const w2 = await page.evaluate(() => { const w = window.__bc.session.wheel; w.pick('goto'); return { abierta: w.open, sel: w.sel, fase: window.__bc.match.phase, puede: window.__bc.session.canOrder() }; });
console.log('rueda (2):', JSON.stringify(w2));
await page.keyboard.up('KeyH');
await page.waitForFunction(() => !window.__bc.session.wheel.open, null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => { const bc = window.__bc; window.__goto = bc.match.recon.pingOf(0, bc.player); });
await ticks(60 * 12);
await shot('a4b_ir_a_mi_marca', 1200);
const go = await page.evaluate(() => {
  const bc = window.__bc, s = bc.session, m = bc.match, pg = window.__goto;
  const allies = [...s.bots.brains.values()].filter((B) => B.team === 0);
  return { orden: s.activeOrder(), marca: pg && { x: +pg.x.toFixed(1), z: +pg.z.toFixed(1) }, aLaMarca: pg ? allies.map((B) => +Math.hypot(B.op.body.pos.x - pg.x, B.op.body.pos.z - pg.z).toFixed(1)) : null, tareas: allies.map((B) => B.task && B.task.kind) };
});
console.log('ir a mi marca:', JSON.stringify(go));
await ticks(60 * 20);
// ---------------- 3b) anti run-out: fuera más de 5 s en la acción (el ataque, quieto un momento)
await page.waitForFunction(() => window.__bc.match.phase !== 'prep', null, { timeout: 60000 }).catch(() => {});
const ro = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, me = bc.player;
  if (m.phase !== 'action' || me.state !== 'alive') return { omitido: m.phase + '/' + me.state };
  const atk = m.opsOfSide('atk').filter((o) => o.state === 'alive');
  for (const o of atk) o.frozen = true;
  const back = { x: me.body.pos.x, y: me.body.pos.y, z: me.body.pos.z, yaw: me.yaw };
  bc.place(-10, 0.01, 13, 0, 0);
  const at = [];
  for (let i = 0; i < 60 * 5.6; i++) { bc.session.tick(1 / 60); if (i === 60 * 3) at.push(bc.session.promptText || ''); }
  bc.session.frame(0.016);
  at.push(bc.session.promptText || '');
  const r = { detectado: m.recon.isSpottedFor(me, m.teamOfSide('atk')), avisos: at, chat: [...document.querySelectorAll('#chat .cl.sys')].map((e) => e.textContent) };
  bc.place(back.x, back.y, back.z, back.yaw, 0);
  for (const o of atk) o.frozen = false;
  return r;
});
console.log('anti run-out:', JSON.stringify(ro));
const marked = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  const foe = m.game.operators.find((o) => o.team === 1 && o.state === 'alive');
  if (!foe) return null;
  const p = foe.body.pos;
  // detrás del enemigo, a 5 m, mirándolo
  const bx = p.x + Math.sin(foe.yaw) * 5, bz = p.z + Math.cos(foe.yaw) * 5;
  bc.place(bx, p.y, bz, foe.yaw, 0);
  return foe.name;
});
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match, me = bc.player;
  const foe = m.game.operators.find((o) => o.team === 1 && o.state === 'alive');
  const e = me.eyePos(), c = foe.center();
  me.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z)); me.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
});
await page.keyboard.press('KeyT');
await page.waitForTimeout(700);
const spotted = await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  const list = [...m.recon.spotted.entries()].filter(([, s]) => s.team === 0).map(([op]) => op.name);
  const mk = [...document.querySelectorAll('#markers .mk.spot')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
  return { marcados: list, marcadores: mk, puntos: m.humanSlot.stats.marks };
});
console.log('enemigo marcado con T:', marked, JSON.stringify(spotted));
await shot('a5_enemigo_marcado', 300);

// la acción con la capa encendida
await page.evaluate(() => {
  const bc = window.__bc, m = bc.match;
  const foe = m.game.operators.find((o) => o.team === 1 && o.state === 'alive');
  if (foe) { const p = foe.body.pos; bc.place(p.x + Math.sin(foe.yaw) * 3, p.y, p.z + Math.cos(foe.yaw) * 3, foe.yaw, -0.2); }
});
await ticks(60 * 12);
await shot('a6_depuracion_accion', 1500);
const dbg2 = await page.evaluate(() => ({ stats: { ...window.__bc.debug.stats }, labels: [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').map((e) => e.textContent).slice(0, 6) }));
console.log('depuración en la acción:', JSON.stringify(dbg2));
// chat de equipo: lo que los aliados han dicho por radio (y lo que queda en pantalla)
for (let k = 0; k < 8; k++) {
  await ticks(60 * 5);
  if (await page.evaluate(() => window.__radio.some((l) => l.startsWith('0 ')) || window.__bc.match.phase !== 'action')) break;
}
const chat = await page.evaluate(() => ({ radio: window.__radio.slice(0, 10), lineas: [...document.querySelectorAll('#chat .cl')].map((e) => e.textContent) }));
console.log('radio:', JSON.stringify(chat));
await shot('a7_chat', 300);
await page.keyboard.press('KeyP');
await page.waitForFunction(() => !window.__bc.debug.on, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);
const off = await page.evaluate(() => ({ on: window.__bc.debug.on, visible: window.__bc.debug.group.visible, labels: [...document.querySelectorAll('#dbg .dl')].filter((e) => e.style.display !== 'none').length, dbgHidden: document.getElementById('dbg').classList.contains('hidden') }));
console.log('apagada:', JSON.stringify(off));

// ---------------- 4) muerto en defensa: 5 → cámaras, D → otra, 5 → observar
await page.evaluate(() => { const bc = window.__bc; if (bc.player.state !== 'dead') bc.game.kill(bc.player, { by: null }); });
await ticks(60 * 3.3);
let deadCams = null;
if (await page.evaluate(() => { const m = window.__bc.match; return m.phase === 'action' || m.phase === 'planted'; })) {
  await page.keyboard.press('Digit5');
  await page.waitForFunction(() => window.__bc.session.feed.mode === 'cams', null, { timeout: 20000 }).catch(() => {});
  const c1 = await page.evaluate(() => window.__bc.session.feed.cam && window.__bc.session.feed.cam.name);
  const vivas = await page.evaluate(() => window.__bc.match.recon.aliveCams().length);
  const tries = [];
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('KeyD');
    const ok = await page.waitForFunction((n) => window.__bc.session.feed.cam && window.__bc.session.feed.cam.name !== n, c1, { timeout: 4000 }).then(() => true).catch(() => false);
    tries.push(ok);
    if (ok) break;
  }
  console.log('D en cámaras:', JSON.stringify(tries), JSON.stringify(await page.evaluate(() => ({ feed: window.__bc.session.feed.mode, lost: window.__bc.session.feed.lostT, pausa: !document.getElementById('pausehint').classList.contains('hidden'), fps: window.__bc.perf().fps }))));
  const c2 = await page.evaluate(() => window.__bc.session.feed.cam && window.__bc.session.feed.cam.name);
  await shot('a8_muerto_camaras', 300);
  await page.keyboard.press('Digit5');
  await page.waitForFunction(() => !window.__bc.session.feed.active, null, { timeout: 20000 }).catch(() => {});
  deadCams = await page.evaluate(() => ({ camaras: [window.__c1, window.__c2], feed: window.__bc.session.feed.mode, observa: window.__bc.session.viewOp && window.__bc.session.viewOp.name }));
  deadCams.camaras = [c1, c2];
  deadCams.vivas = vivas;
}
console.log('muerto (defensa):', JSON.stringify(deadCams));

// ---------------- 5) muerto en ataque: 5 → dron del equipo pilotado, Q → otro dron
await page.evaluate(() => { window.__bc.startMatch({ startSide: 'atk', seed: 12 }); });
await page.click('#sel-grid .opc:nth-child(2)');
await page.click('#sel-ready');
await page.waitForFunction(() => window.__bc.match.phase === 'prep', null, { timeout: 60000 });
await ticks(3, "if (bc.match.phase === 'prep') bc.match.timer = Math.min(bc.match.timer, 0.02);");
await ticks(60 * 2);
await page.evaluate(() => { const bc = window.__bc; bc.game.kill(bc.player, { by: null }); });
await ticks(60 * 3.3);
console.log('antes de 5:', JSON.stringify(await page.evaluate(() => { const bc = window.__bc, m = bc.match, s = bc.session; return { fase: m.phase, muerto: bc.player.state, desde: +(m.time - s.deadAt).toFixed(2), drones: m.recon.drones.filter((d) => d.alive && d.team === 0).length, lado: s.mySide(), feed: s.feed.mode, pausa: !document.getElementById('pausehint').classList.contains('hidden') }; })));
await page.keyboard.press('Digit5');
await page.waitForFunction(() => window.__bc.session.feed.mode === 'drone', null, { timeout: 20000 }).catch(() => {});
const d0 = await page.evaluate(() => { const f = window.__bc.session.feed; return f.drone ? { id: f.drone.id, dueño: f.drone.owner.name, pilota: f.piloting, x: f.drone.body.pos.x, z: f.drone.body.pos.z } : null; });
await ticks(60 * 1.5, 'const f = bc.session.feed; if (f.drone) f.drone.intent.moveZ = 1;');
const d1 = await page.evaluate(() => { const f = window.__bc.session.feed; return f.drone ? { x: f.drone.body.pos.x, z: f.drone.body.pos.z } : null; });
await shot('a9_muerto_dron', 900);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(900);
const d2 = await page.evaluate(() => { const f = window.__bc.session.feed; return { id: f.drone && f.drone.id, teclas: document.getElementById('fd-keys').textContent }; });
console.log('muerto (ataque):', JSON.stringify({ dron: d0, avanza: d0 && d1 ? +Math.hypot(d1.x - d0.x, d1.z - d0.z).toFixed(2) : null, otro: d2 }));

console.log('errores:', errors.length); for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 300));
await browser.close();

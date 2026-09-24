// Ayudas de equipo: marcar con T (enemigo o marca de posición; las marcas entran en la
// memoria de los bots aliados) y la radio de los bots (chat de equipo, voz opcional).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match, SCORE } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { SPOT_TIME, PING_TIME } from '../src/sim/recon.js';
import { SOLID } from '../src/world/materials.js';
import { callout, RADIO } from '../src/sim/ai/radio.js';
import { AllyVoice } from '../src/client/chat.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const FAST = { selectTime: 0, prepTime: 0.5, roundEndTime: 0.2 };

function newMatch(opts = {}) {
  const m = new Match({ world, map, seed: opts.seed ?? 5, rules: { ...FAST, ...(opts.rules || {}) }, human: !!opts.human, startSide: opts.startSide || 'atk' });
  m.start();
  return m;
}
const toAction = (m) => { let n = 0; while (m.phase !== 'action' && n++ < 10000) m.tick(TICK); };
function place(op, x, y, z, yaw = op.yaw, pitch = 0) {
  op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
  op.yaw = yaw; op.pitch = pitch;
}
function aimAt(op, p) {
  const e = op.eyePos();
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function freeze(m) { for (const o of m.game.operators) { o.intent.moveX = 0; o.intent.moveZ = 0; o.intent.fire = false; } }

test('T sobre un enemigo: marcado 6 s para tu equipo, entra en la memoria de los bots aliados y suma 10', () => {
  const m = newMatch();
  const sq = new BotSquad(m, 'normal', { nav });
  sq.reset();
  toAction(m);
  const a = m.opsOfSide('atk')[0], d = m.opsOfSide('def')[0];
  // en el salón, a 5 m, cara a cara
  place(a, 3, 0.01, 6.5, -Math.PI / 2);
  place(d, 8, 0.01, 6.5, Math.PI / 2);
  m.tick(TICK);
  aimAt(a, d.center());
  const s0 = a.slot.stats.score;
  const r = m.recon.markOrPing(a);
  assert.ok(r && r.kind === 'enemy' && r.op === d, 'marca al enemigo');
  assert.ok(m.recon.isSpottedFor(d, a.team));
  assert.equal(a.slot.stats.marks, 1);
  assert.equal(a.slot.stats.score - s0, SCORE.mark);
  assert.equal(m.recon.pings.size, 0, 'no pone marca de posición');
  // la pizarra del equipo (memoria de los bots) lo recibe
  sq._teamIntel(TICK);
  const k = sq.boards[a.team].known.get(d);
  assert.ok(k && k.precise && Math.hypot(k.x - d.body.pos.x, k.z - d.body.pos.z) < 0.1, 'posición exacta en la pizarra');
  // caduca a los 6 s
  let t = 0;
  while (t < SPOT_TIME + 0.2) { freeze(m); m.tick(TICK); t += TICK; }
  assert.ok(!m.recon.isSpottedFor(d, a.team), 'la marca caduca');
});

test('T a una pared: marca de posición donde se mira, 15 s, una por jugador; al cielo, nada', () => {
  const m = newMatch();
  toAction(m);
  const a = m.opsOfSide('atk')[0], b = m.opsOfSide('atk')[1];
  const seen = [];
  m.game.on('pinged', (op, p) => seen.push([op, p]));
  place(a, 6, 0.01, 6.5, Math.PI / 2, -0.1);     // mirando al oeste, hacia la pared del salón
  place(b, 20, 0.01, -8, 0, 0);
  m.tick(TICK);
  const r = m.recon.markOrPing(a);
  assert.ok(r && r.kind === 'ping', 'marca de posición');
  const pg = r.ping, e = a.eyePos(), v = a.viewDir();
  assert.ok(pg.x < 5 && Math.abs(pg.z - 6.5) < 0.3, `hacia el oeste, en la línea de la mirada (x=${pg.x.toFixed(2)})`);
  // entre el ojo y la marca no hay nada sólido
  for (let k = 0.2; k < Math.hypot(pg.x - e.x, pg.z - e.z) - 0.1; k += 0.1) assert.ok(!SOLID[world.getWorld(e.x + v.x * k, e.y + v.y * k, e.z + v.z * k)], 'camino despejado hasta la marca');
  const behind = world.getWorld(pg.x + v.x * 0.15, pg.y + v.y * 0.15, pg.z + v.z * 0.15);
  assert.ok(SOLID[behind], 'justo delante de algo sólido');
  const dist = Math.hypot(pg.x - e.x, pg.y - e.y, pg.z - e.z);
  assert.ok(dist > 1 && dist < 7, `a la distancia de lo que se mira (${dist.toFixed(2)} m)`);
  assert.equal(seen.length, 1);
  assert.equal(m.recon.pingOf(a.team), pg);
  // una nueva sustituye a la anterior
  a.yaw = 0;
  m.tick(TICK);
  const r2 = m.recon.markOrPing(a);
  assert.ok(r2 && r2.kind === 'ping');
  assert.equal(m.recon.pings.size, 1, 'una por jugador');
  assert.equal(m.recon.pingOf(a.team), r2.ping);
  // otro jugador del equipo añade la suya; la más reciente es la del equipo
  b.pitch = -0.6;
  m.tick(TICK);
  const r3 = m.recon.markOrPing(b);
  assert.ok(r3 && r3.kind === 'ping', 'al suelo de la calle');
  assert.equal(m.recon.pings.size, 2);
  assert.equal(m.recon.pingOf(a.team), r3.ping);
  assert.equal(m.recon.pingOf(a.team, a), r2.ping);
  assert.equal(m.recon.pingOf(1 - a.team), null, 'el otro equipo no las ve');
  // al cielo: nada
  b.pitch = 1.45;
  m.tick(TICK);
  assert.equal(m.recon.markOrPing(b), null);
  // caducan a los 15 s
  let t = 0;
  while (t < PING_TIME + 0.2) { freeze(m); m.tick(TICK); t += TICK; }
  assert.equal(m.recon.pings.size, 0, 'caducan');
});

test('radio: nombres de lugar con planta («PB Cocina», «Sót. Bodega», «PA Estudio», exteriores)', () => {
  assert.equal(callout(map, { x: 20, y: 0, z: 18.5 }), 'PB Cocina');
  assert.equal(callout(map, { x: 5, y: -3.5, z: 21 }), 'Sót. Bodega');
  assert.equal(callout(map, { x: 21.5, y: 3.5, z: 22.5 }), 'PA Estudio');
  assert.equal(callout(map, { x: 14, y: 0, z: 40 }), 'Jardín trasero');
  assert.equal(callout(map, { x: 6, y: 7.0, z: 20 }), 'Tejado');
});

test('radio: contacto, derribado, queda uno y desactivador plantado, sin atropellarse', () => {
  const m = newMatch({ seed: 9, rules: { actionTime: 120 } });
  const sq = new BotSquad(m, 'normal', { nav });
  const msgs = [];
  m.game.on('radio', (op, text, key) => msgs.push({ t: m.game.time, op, text, key }));
  m.on('roundStart', () => sq.reset());
  sq.reset();
  toAction(m);
  const atk = m.opsOfSide('atk'), def = m.opsOfSide('def');
  // contacto: un atacante y un defensor se ven en el salón (el resto, lejos y quietos)
  atk.forEach((o, i) => place(o, 10 + i, 0.01, -12, 0));
  def.forEach((o, i) => place(o, 20 + i, -3.5 + 0.01, 3, 0));
  place(atk[0], 3, 0.01, 6.5, -Math.PI / 2);
  place(def[0], 8, 0.01, 6.5, Math.PI / 2);
  for (let i = 0; i < 90 && !msgs.some((q) => q.key === 'contact'); i++) { sq.update(TICK); m.tick(TICK); }
  const c = msgs.find((q) => q.key === 'contact');
  assert.ok(c, 'aviso de contacto');
  assert.equal(c.text, '¡Contacto en PB Salón!');
  // no se repite mientras lo siguen viendo
  for (let i = 0; i < 120; i++) { sq.update(TICK); m.tick(TICK); }
  const same = msgs.filter((q) => q.key === 'contact' && q.op.team === c.op.team);
  assert.equal(same.length, 1, 'un solo aviso por enemigo a la vista');
  // derribado
  const d1 = def[1];
  m.game.damage(d1, d1.hp + 5, { zone: 'torso' });
  assert.equal(d1.state, 'downed');
  assert.ok(msgs.some((q) => q.key === 'downed' && q.op === d1 && q.text === 'Estoy derribado'), 'el derribado lo dice');
  // queda uno: a la defensa solo le queda uno en pie
  for (const o of def.slice(2)) m.game.kill(o, { by: null });
  const standingDef = def.filter((o) => o.state === 'alive');
  if (standingDef.length > 1) for (const o of standingDef.slice(1)) m.game.kill(o, { by: null });
  const lo = msgs.find((q) => q.key === 'lastOne');
  assert.ok(lo && lo.op.team === atk[0].team && lo.text === 'Queda uno', 'el ataque avisa de que queda uno');
  assert.equal(msgs.filter((q) => q.key === 'lastOne').length, 1, 'una vez por ronda');
  // límites: mismo bot, avisos normales separados al menos 2 s
  const byOp = new Map();
  for (const q of msgs) {
    if (q.key === 'downed' || q.key === 'lastOne' || q.key === 'planted') continue;
    const prev = byOp.get(q.op);
    if (prev !== undefined) assert.ok(q.t - prev >= RADIO.perBot - 1e-9, `${q.op.name} no habla dos veces en menos de 2 s`);
    byOp.set(q.op, q.t);
  }
});

test('radio: «¡Desactivador plantado!» al plantar un bot', () => {
  const m = newMatch({ seed: 12, rules: { actionTime: 120 } });
  const sq = new BotSquad(m, 'normal', { nav });
  const msgs = [];
  m.game.on('radio', (op, text, key) => msgs.push({ op, text, key }));
  sq.reset();
  toAction(m);
  const c = m.defuser.carrier, A = m.site.bombs.A;
  assert.ok(c && c.isBot);
  place(c, A.x, A.y + 0.01, A.z);
  let t = 0;
  while (m.phase === 'action' && t < 10) { c.intent.interact = true; m.tick(TICK); t += TICK; }
  assert.equal(m.phase, 'planted');
  assert.ok(msgs.some((q) => q.key === 'planted' && q.op === c && q.text === '¡Desactivador plantado!'));
});

test('voz de los aliados: apagada por defecto, en español cuando se activa y sin romper si el navegador falla', () => {
  const spoken = [];
  const fake = {
    pending: false,
    speak(u) { spoken.push(u); },
    cancel() { spoken.length = 0; },
    getVoices() { return [{ lang: 'en-US', name: 'en' }, { lang: 'es-ES', name: 'es' }]; },
  };
  const saved = globalThis.window;
  globalThis.window = { speechSynthesis: fake, SpeechSynthesisUtterance: function U(text) { this.text = text; } };
  try {
    const settings = { allyVoice: false, volume: 0.5 };
    const v = new AllyVoice(settings);
    assert.equal(v.say('Recargando', 'CHISPA'), false, 'apagada: no habla');
    assert.equal(spoken.length, 0);
    settings.allyVoice = true;
    assert.equal(v.say('¡Contacto en PB Cocina!', 'CHISPA'), true);
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].lang, 'es-ES');
    assert.equal(spoken[0].voice.name, 'es', 'elige una voz en español');
    assert.equal(spoken[0].volume, 0.5);
    // otro aliado, otro tono
    v.say('Recargando', 'MAZO');
    assert.notEqual(spoken[0].pitch, spoken[1].pitch);
    // el navegador falla al hablar: no se propaga el error
    fake.speak = () => { throw new Error('bloqueado'); };
    assert.equal(v.say('Queda uno', 'ONDA'), false);
    // sin síntesis de voz: no hace nada
    globalThis.window = {};
    assert.equal(v.say('Queda uno', 'ONDA'), false);
    v.cancel();
  } finally {
    if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
  }
});

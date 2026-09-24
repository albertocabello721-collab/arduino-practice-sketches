// Reglas de partida del documento (sección 6): desactivador que se recoge con F,
// plantado que sigue con el reloj a 0, ronda decisiva con bandos al azar, puntuación,
// desactivador que se destruye a balazos, ventanas que empiezan con barricada y reglas
// de edificio (la defensa no sale en la preparación; anti run-out en la acción).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match, SCORE, DEFUSER_HP } from '../src/sim/match.js';
import { MAT } from '../src/world/materials.js';
import { BotSquad, navFor } from '../src/sim/bots.js';

const world = createVillaWorld();
const map = buildVilla(world);
const FAST = { selectTime: 0, prepTime: 0.5, roundEndTime: 0.2 };
function newMatch(opts = {}) {
  const m = new Match({ world, map, seed: opts.seed ?? 7, rules: { ...FAST, ...(opts.rules || {}) }, human: false, startSide: 'atk' });
  m.start();
  return m;
}
const toAction = (m) => { let n = 0; while (m.phase !== 'action' && n++ < 10000) m.tick(TICK); };
function place(op, x, y, z) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; }
function aimAt(op, p) {
  const e = op.eyePos();
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function plantAtA(m) {
  const c = m.defuser.carrier, A = m.site.bombs.A;
  place(c, A.x, A.y + 0.01, A.z);
  let t = 0;
  while (m.phase === 'action' && t < 10) { c.intent.interact = true; m.tick(TICK); t += TICK; }
  return c;
}

test('plantar con el reloj a 0: la ronda sigue hasta que termina el plantado', () => {
  const m = newMatch({ rules: { actionTime: 3 } });
  toAction(m);
  const c = m.defuser.carrier, A = m.site.bombs.A;
  place(c, A.x, A.y + 0.01, A.z);
  let t = 0;
  while (m.phase === 'action' && t < 12) { c.intent.interact = true; m.tick(TICK); t += TICK; }
  assert.equal(m.phase, 'planted', `plantado aunque el reloj llegó a 0 (${t.toFixed(1)} s)`);
  assert.ok(t > 3.5, 'el plantado terminó después de agotarse el tiempo');
});

test('plantar con el reloj a 0: si se suelta F, gana la defensa por tiempo', () => {
  const m = newMatch({ rules: { actionTime: 3 } });
  toAction(m);
  const c = m.defuser.carrier, A = m.site.bombs.A;
  place(c, A.x, A.y + 0.01, A.z);
  let end = null;
  m.on('roundEnd', (r) => { end = r; });
  for (let t = 0; t < 4; t += TICK) { c.intent.interact = true; m.tick(TICK); }
  assert.equal(m.phase, 'action', 'sigue mientras se planta');
  assert.ok(m.timeLeft === 0);
  c.intent.interact = false;
  m.tick(TICK);
  assert.ok(end, 'la ronda termina al soltar');
  assert.equal(end.winSide, 'def');
  assert.equal(end.code, 'timeUp');
});

test('ronda decisiva (3-3): los bandos se sortean', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const m = new Match({ world, map, seed, rules: FAST, human: false, startSide: 'atk' });
    m.round = 6; m.teams[0].score = 3; m.teams[1].score = 3;
    m._nextRound();
    assert.equal(m.round, 7);
    assert.ok(m.deciderSide === 'atk' || m.deciderSide === 'def');
    assert.equal(m.sideOf(0), m.deciderSide);
    assert.notEqual(m.sideOf(1), m.sideOf(0));
    seen.add(m.deciderSide);
  }
  assert.equal(seen.size, 2, 'con distintas semillas salen los dos repartos');
  // sin empate, la 7.ª sigue la alternancia normal
  const m = new Match({ world, map, seed: 3, rules: FAST, human: false, startSide: 'atk' });
  m.round = 6; m.teams[0].score = 4; m.teams[1].score = 2;
  m._nextRound();
  assert.equal(m.deciderSide, null);
});

test('puntos: baja 100 sin extra por cabeza; marcar 10; reforzar 10; destruir un dron 20; ganar no suma', () => {
  assert.deepEqual(SCORE, { kill: 100, assist: 50, down: 50, revive: 50, plant: 100, disable: 100, mark: 10, reinforce: 10, gadget: 20 });
  const m = newMatch({ rules: { prepTime: 45 } });
  const a = m.opsOfSide('atk')[0], d = m.opsOfSide('def')[0];
  // marcar con el dron
  const drone = m.recon.droneOf(a);
  place(d, drone.body.pos.x, drone.body.pos.y + 0.01, drone.body.pos.z - 3);
  m.tick(TICK);
  aimAt(drone, d.center());
  m.recon.mark(drone, a.team);
  assert.equal(a.slot.stats.marks, 1);
  assert.equal(a.slot.stats.score, SCORE.mark);
  // reforzar
  m.game.emit('reinforced', d, { kind: 'wall', center: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } });
  assert.equal(d.slot.stats.reinforcements, 1);
  assert.equal(d.slot.stats.score, SCORE.reinforce);
  // destruir el dron enemigo
  const before = d.slot.stats.score;
  m.game.destroyTarget(drone, d);
  assert.equal(d.slot.stats.score - before, SCORE.gadget);
  // baja a la cabeza: 100 justos
  toAction(m);
  const s0 = d.slot.stats.score;
  m.game.damage(a, 50, { by: d, zone: 'head' });
  assert.equal(a.state, 'dead');
  assert.equal(d.slot.stats.score - s0, SCORE.kill);
  // ganar la ronda no suma puntos
  const s1 = d.slot.stats.score;
  for (const o of m.opsOfSide('atk')) if (o.state !== 'dead') m.game.kill(o, { by: null });
  m.tick(TICK);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(d.slot.stats.score, s1);
});

test('el desactivador plantado se destruye a balazos (solo la defensa) y cuenta como inutilizarlo', () => {
  const m = newMatch({ seed: 12, rules: { actionTime: 120 } });
  toAction(m);
  const c = plantAtA(m);
  assert.equal(m.phase, 'planted');
  const tg = m.defuser.target;
  assert.ok(tg && tg.alive && tg.hp === DEFUSER_HP);
  // un atacante no puede dañarlo
  const a2 = m.opsOfSide('atk').find((o) => o !== c);
  place(a2, tg.center().x + 3, m.defuser.plantPos.y + 0.01, tg.center().z);
  m.tick(TICK);
  aimAt(a2, tg.center());
  for (let i = 0; i < 10; i++) m.game.fireBullet(a2, a2.eyePos(), a2.viewDir(), a2.weapon);
  assert.equal(tg.hp, DEFUSER_HP, 'las balas del ataque no le hacen nada');
  // un defensor sí
  const d = m.opsOfSide('def')[0];
  place(d, tg.center().x, m.defuser.plantPos.y + 0.01, tg.center().z + 3);
  m.tick(TICK);
  let end = null;
  m.on('roundEnd', (r) => { end = r; });
  for (let i = 0; i < 20 && !end; i++) { aimAt(d, tg.center()); m.game.fireBullet(d, d.eyePos(), d.viewDir(), d.weapon); m.tick(TICK); }
  assert.ok(!tg.alive, 'destruido');
  assert.ok(end);
  assert.equal(end.winSide, 'def');
  assert.equal(end.code, 'destroyed');
  assert.equal(d.slot.stats.disables, 1);
});

test('las ventanas empiezan cada ronda con barricada', () => {
  world.resetToPristine();
  const inner = (o) => {
    const inSide = -(o.out || 1);
    const c = inSide < 0 ? o.line - 0.0625 : o.line + 0.0625;
    return o.axis === 'x' ? world.getWorld(o.center, o.y0 + 0.5, c) : world.getWorld(c, o.y0 + 0.5, o.center);
  };
  assert.equal(map.windows.length, 32);
  for (const o of map.windows) assert.equal(inner(o), MAT.BARRICADE, `ventana ${o.axis} ${o.line}/${o.center}`);
  // se rompe una y la ronda siguiente vuelve a estar
  const o = map.windows[0];
  const inSide = -(o.out || 1), c = inSide < 0 ? o.line - 0.0625 : o.line + 0.0625;
  const vx = o.axis === 'x' ? world.vx(o.center) : world.vx(c), vz = o.axis === 'x' ? world.vz(c) : world.vz(o.center), vy = world.vy(o.y0 + 0.5);
  world.setRaw(vx, vy, vz, MAT.AIR);
  assert.equal(inner(o), MAT.AIR);
  const m = newMatch();
  toAction(m);
  assert.equal(inner(o), MAT.BARRICADE);
});

// ---------------------------------------------------------------- edificio
test('preparación: la defensa no puede salir del edificio (pared invisible)', () => {
  const m = newMatch({ rules: { prepTime: 30 } });
  assert.equal(m.phase, 'prep');
  const d = m.opsOfSide('def')[0];
  const events = [];
  m.on('boundary', (op) => events.push(op));
  // dentro del recibidor, andando hacia el porche por la puerta principal
  place(d, 15.5, 0.01, 1.2);
  d.yaw = 0;                     // mirando a -z (hacia fuera)
  let wasOut = 0;
  for (let t = 0; t < 4; t += TICK) {
    d.intent.moveZ = 1; d.intent.sprint = true;
    m.tick(TICK);
    if (map.isOutside(d.body.pos.x, d.body.pos.y, d.body.pos.z)) wasOut++;
  }
  assert.equal(wasOut, 0, 'nunca queda fuera al final de un tick');
  assert.ok(d.body.pos.z > -0.6, `no ha cruzado la puerta (z=${d.body.pos.z.toFixed(2)})`);
  assert.ok(events.length >= 1 && events[0] === d, 'aviso de límite');
  // el ataque no tiene esa pared (está en su punto de aparición, bloqueado por la preparación)
  assert.ok(m.opsOfSide('atk').every((o) => o.frozen));
});

test('acción: un defensor más de 5 s fuera queda revelado para el ataque mientras siga fuera', () => {
  const m = newMatch({ rules: { actionTime: 120 } });
  toAction(m);
  const d = m.opsOfSide('def')[0], atkTeam = m.teamOfSide('atk');
  const events = [];
  m.on('runout', (op) => events.push(op));
  place(d, 16, 0.01, -8);        // en el jardín delantero
  assert.ok(map.isOutside(d.body.pos.x, d.body.pos.y, d.body.pos.z));
  let t = 0;
  while (t < 4.9) { d.intent.moveZ = 0; m.tick(TICK); t += TICK; }
  assert.ok(!m.recon.isSpottedFor(d, atkTeam), 'a los 4,9 s aún no');
  while (t < 5.2) { m.tick(TICK); t += TICK; }
  assert.ok(m.recon.isSpottedFor(d, atkTeam), 'a los 5 s, revelado');
  assert.equal(events.length, 1);
  assert.equal(d.slot.stats.marks, 0, 'sin puntos de marca');
  for (const a of m.opsOfSide('atk')) assert.equal(a.slot.stats.marks, 0);
  // sigue revelado mientras siga fuera
  for (let i = 0; i < 120; i++) m.tick(TICK);
  assert.ok(m.recon.isSpottedFor(d, atkTeam));
  // vuelve dentro: deja de estarlo enseguida y el contador se reinicia
  place(d, 16, 0.01, 10);
  for (let i = 0; i < 30; i++) m.tick(TICK);
  assert.ok(!m.recon.isSpottedFor(d, atkTeam), 'dentro, ya no');
  assert.equal(d.outT, 0);
});

test('preparación: los bots de la defensa hacen su trabajo sin intentar salir', () => {
  const nav = navFor(world, map);
  let tries = 0, fortified = 0;
  for (const seed of [1, 2, 3]) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, prepTime: 45, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
    const sq = new BotSquad(m, 'normal', { nav });
    m.on('roundStart', () => sq.reset());
    m.on('boundary', () => { tries++; });
    m.start();
    while (m.phase === 'select' || m.phase === 'prep') { sq.update(TICK); m.tick(TICK); }
    fortified += m.fort.panels.length + m.fort.barricades.length;
    sq.dispose();
  }
  assert.equal(tries, 0, 'ningún defensor bot choca con la pared invisible');
  assert.ok(fortified >= 3 * 8, `refuerzos y barricadas puestos (${fortified})`);
});

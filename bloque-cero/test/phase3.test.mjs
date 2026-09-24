// Fase 3: partida 5v5 por rondas. Cada condición de victoria, el desactivador,
// el cambio de bando y una partida completa hasta 4 rondas, sin navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match, RULES } from '../src/sim/match.js';
import { OPERATORS, OP_BY_ID, opsForSide } from '../src/sim/operators.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { boxFree } from '../src/sim/physics.js';
import { BotSquad } from '../src/sim/bots.js';

const world = createVillaWorld();
const map = buildVilla(world);

const FAST = { selectTime: 0, prepTime: 0.5, roundEndTime: 0.2 };
function newMatch(opts = {}) {
  const m = new Match({ world, map, seed: opts.seed ?? 7, rules: { ...FAST, ...(opts.rules || {}) }, human: opts.human ?? false, startSide: opts.startSide ?? 'atk' });
  m.start();
  return m;
}
const run = (m, s) => { for (let i = 0, n = Math.round(s / TICK); i < n; i++) m.tick(TICK); };
const toAction = (m) => { let n = 0; while (m.phase !== 'action' && n++ < 10000) m.tick(TICK); };
const killAll = (m, side) => { for (const op of m.opsOfSide(side)) if (op.state !== 'dead') m.game.kill(op, { by: null }); };
function place(op, x, y, z) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; }
function carrierToSite(m, which = 'A') {
  const c = m.defuser.carrier;
  const b = m.site.bombs[which];
  place(c, b.x, b.y + 0.02, b.z);
  return c;
}

test('plantilla: 8 atacantes y 8 defensores con arsenal válido', () => {
  assert.equal(opsForSide('atk').length, 8);
  assert.equal(opsForSide('def').length, 8);
  assert.equal(new Set(OPERATORS.map((o) => o.id)).size, 16);
  for (const o of OPERATORS) {
    assert.ok(o.armor >= 1 && o.armor <= 3, o.id);
    for (const w of [...o.primaries, ...o.secondaries]) assert.ok(WEAPONS[w], `${o.id}: ${w}`);
    assert.ok(o.ability && o.ability.name, o.id);
  }
});

test('bandos: se cambia cada 3 rondas y la 7.ª es la decisiva', () => {
  const m = new Match({ world, map, human: false, startSide: 'atk' });
  const sides = [1, 2, 3, 4, 5, 6, 7].map((r) => m.sideOf(0, r));
  assert.deepEqual(sides, ['atk', 'atk', 'atk', 'def', 'def', 'def', 'atk']);
  assert.equal(m.sideOf(1, 1), 'def');
});

test('aparición: defensores en su sitio, atacantes fuera y congelados en la preparación', () => {
  for (let loc = 0; loc < 3; loc++) {
    const m = new Match({ world, map, seed: 11 + loc, rules: { ...FAST, prepTime: 45 }, human: false });
    m.start();
    // forzar la ubicación antes de la preparación
    m.phase = 'select'; m.location = loc; m.timer = 0; m.tick(TICK);
    assert.equal(m.phase, 'prep');
    assert.equal(m.game.operators.length, 10);
    const site = map.sites[loc];
    for (const op of m.opsOfSide('def')) {
      const r = map.roomAt(op.body.pos.x, op.body.pos.y + 0.2, op.body.pos.z);
      assert.ok(r && (r.id === site.A || r.id === site.B), `${op.name} aparece en ${r && r.id} (esperado ${site.A}/${site.B})`);
      assert.ok(boxFree(world, op.body.pos.x, op.body.pos.y + 0.02, op.body.pos.z, 0.3, 1.78), `${op.name} no está dentro de un muro`);
      assert.equal(op.frozen, false);
    }
    for (const op of m.opsOfSide('atk')) {
      assert.equal(map.roomAt(op.body.pos.x, op.body.pos.y + 0.2, op.body.pos.z), null, 'atacante fuera de la casa');
      assert.equal(op.frozen, true);
      assert.ok(boxFree(world, op.body.pos.x, op.body.pos.y + 0.02, op.body.pos.z, 0.3, 1.78));
    }
    // operadores únicos por equipo
    for (const t of [0, 1]) {
      const ids = m.slotsOf(t).map((s) => s.opId);
      assert.equal(new Set(ids).size, 5);
      for (const id of ids) assert.equal(OP_BY_ID[id].side, m.sideOf(t));
    }
    // un atacante congelado no se mueve aunque quiera
    const a = m.opsOfSide('atk')[0];
    const x0 = a.body.pos.x, z0 = a.body.pos.z;
    a.intent.moveZ = 1; a.intent.fire = true;
    run(m, 1);
    assert.ok(Math.hypot(a.body.pos.x - x0, a.body.pos.z - z0) < 0.05, 'congelado en la preparación');
    assert.equal(a.stats.shots, 0);
    // al terminar la preparación, se descongela
    run(m, 45);
    assert.equal(m.phase, 'action');
    assert.equal(a.frozen, false);
    assert.equal(m.timer > 170, true);
  }
});

test('victoria del ataque: todos los defensores eliminados', () => {
  const m = newMatch();
  toAction(m);
  killAll(m, 'def');
  m.tick(TICK);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastResult.winSide, 'atk');
  assert.equal(m.lastResult.code, 'defendersDown');
  assert.equal(m.teams[m.teamOfSide('atk')].score, 1);
});

test('derribados cuentan como eliminados: si toda la defensa está en el suelo, gana el ataque', () => {
  const m = newMatch();
  toAction(m);
  for (const op of m.opsOfSide('def')) m.game.damage(op, op.hp + 5, { by: m.opsOfSide('atk')[0], zone: 'body' });
  assert.ok(m.opsOfSide('def').every((o) => o.state === 'downed'));
  m.tick(TICK);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastResult.code, 'defendersDown');
});

test('victoria de la defensa: todos los atacantes eliminados antes de plantar', () => {
  const m = newMatch();
  toAction(m);
  killAll(m, 'atk');
  m.tick(TICK);
  assert.equal(m.lastResult.winSide, 'def');
  assert.equal(m.lastResult.code, 'attackersDown');
});

test('victoria de la defensa: se agota el tiempo sin plantar', () => {
  const m = newMatch({ rules: { actionTime: 3 } });
  toAction(m);
  run(m, 2.9);
  assert.equal(m.phase, 'action');
  run(m, 0.2);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastResult.code, 'timeUp');
  assert.equal(m.lastResult.winSide, 'def');
});

test('plantar: 7 s manteniendo F dentro del sitio; soltar reinicia; fuera del sitio no se puede', () => {
  const m = newMatch();
  toAction(m);
  const c = m.defuser.carrier;
  assert.ok(c && c.side === 'atk');
  // fuera del sitio: nada
  c.intent.interact = true;
  run(m, 1);
  assert.equal(m.plant, null);
  // dentro: empieza a plantar y no puede moverse
  carrierToSite(m, 'A');
  run(m, 3);
  assert.ok(m.plant && m.plant.t > 2.5, 'plantando');
  assert.equal(c.channel.kind, 'plant');
  const x0 = c.body.pos.x;
  c.intent.moveZ = 1;
  run(m, 0.5);
  assert.ok(Math.abs(c.body.pos.x - x0) < 0.05, 'quieto mientras planta');
  c.intent.moveZ = 0;
  // soltar F: se pierde el progreso
  c.intent.interact = false;
  m.tick(TICK);
  assert.equal(m.plant, null);
  assert.equal(c.channel, null);
  c.intent.interact = true;
  run(m, 6.9);
  assert.equal(m.phase, 'action');
  run(m, 0.2);
  assert.equal(m.phase, 'planted');
  assert.equal(m.defuser.site, 'A');
  assert.equal(c.slot.stats.plants, 1);
});

test('tras plantar, eliminar al ataque no basta: si nadie lo inutiliza, gana el ataque', () => {
  const m = newMatch({ rules: { fuseTime: 5, roundEndTime: 5 } });
  toAction(m);
  const c = carrierToSite(m, 'B');
  c.intent.interact = true;
  run(m, 7.2);
  assert.equal(m.phase, 'planted');
  killAll(m, 'atk');
  run(m, 2);
  assert.equal(m.phase, 'planted', 'la ronda sigue con el ataque eliminado');
  run(m, 3.2);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastResult.code, 'defused');
  assert.equal(m.lastResult.winSide, 'atk');
});

test('inutilizar el desactivador (7 s junto a él) da la ronda a la defensa', () => {
  const m = newMatch();
  toAction(m);
  const c = carrierToSite(m, 'A');
  c.intent.interact = true;
  run(m, 7.2);
  assert.equal(m.phase, 'planted');
  c.intent.interact = false;
  const d = m.opsOfSide('def')[0];
  const P = m.defuser.plantPos;
  place(d, P.x + 0.8, P.y + 0.02, P.z);
  d.intent.interact = true;
  run(m, 4);
  assert.ok(m.disable && m.disable.op === d, 'inutilizando');
  d.intent.interact = false;
  m.tick(TICK);
  assert.equal(m.disable, null, 'soltar F reinicia');
  d.intent.interact = true;
  run(m, 7.2);
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastResult.code, 'disabled');
  assert.equal(m.lastResult.winSide, 'def');
  assert.equal(d.slot.stats.disables, 1);
});

test('si toda la defensa cae con el desactivador plantado, gana el ataque al momento', () => {
  const m = newMatch();
  toAction(m);
  const c = carrierToSite(m, 'A');
  c.intent.interact = true;
  run(m, 7.2);
  killAll(m, 'def');
  m.tick(TICK);
  assert.equal(m.lastResult.code, 'defendersDown');
});

test('el desactivador cae al morir el portador y otro atacante lo recoge con F', () => {
  const m = newMatch();
  toAction(m);
  const c = m.defuser.carrier;
  const other = m.opsOfSide('atk').find((o) => o !== c);
  place(c, 15.5, 0.01, -3.5);
  m.tick(TICK);
  m.game.kill(c, { by: null });
  m.tick(TICK);
  assert.equal(m.defuser.carrier, null);
  assert.ok(m.defuser.pos, 'en el suelo');
  place(other, m.defuser.pos.x + 0.5, m.defuser.pos.y + 0.01, m.defuser.pos.z);
  m.tick(TICK);
  assert.equal(m.defuser.carrier, null, 'pasar por encima no basta');
  other.intent.interact = true;
  m.tick(TICK);
  assert.equal(m.defuser.carrier, other, 'con F lo recoge');
});

test('el jugador manda: si elige el operador de un bot, el bot cambia; la defensa humana elige ubicación', () => {
  const m = new Match({ world, map, seed: 5, rules: { ...FAST, selectTime: 20 }, human: true, startSide: 'def' });
  m.start();
  assert.equal(m.phase, 'select');
  const me = m.humanSlot;
  const mate = m.slotsOf(0).find((s) => !s.human);
  const wanted = mate.opId;
  assert.ok(m.choose(me, { opId: wanted, primary: 1 }));
  assert.equal(me.opId, wanted);
  assert.notEqual(mate.opId, wanted);
  assert.equal(new Set(m.slotsOf(0).map((s) => s.opId)).size, 5);
  assert.ok(m.choose(me, { location: 2 }));
  m.setReady(me);
  run(m, 1);
  assert.equal(m.phase, 'prep');
  assert.equal(m.location, 2);
  assert.equal(m.player.side, 'def');
  assert.equal(m.player.opDef.id, wanted);
  assert.equal(m.player.weapons[0].def.id, OP_BY_ID[wanted].primaries[Math.min(1, OP_BY_ID[wanted].primaries.length - 1)]);
});

test('partida completa: el primero en 4 rondas gana, con cambio de bando y MVP', () => {
  const m = newMatch({ seed: 99, rules: { actionTime: 1 } });
  const winners = [];
  m.on('roundEnd', (r) => winners.push(r));
  let ended = null;
  m.on('matchEnd', (e) => { ended = e; });
  let guard = 0;
  // alterna: el ataque elimina a la defensa en las rondas impares; en las pares se agota el tiempo
  while (m.phase !== 'matchEnd' && guard++ < 200000) {
    if (m.phase === 'action' && m.round % 2 === 1) killAll(m, 'def');
    m.tick(TICK);
  }
  assert.equal(m.phase, 'matchEnd');
  assert.ok(ended);
  assert.ok(m.teams[ended.winner].score === 4);
  assert.ok(winners.length >= 4 && winners.length <= 7);
  assert.equal(m.history.length, winners.length);
  // el bando cambió en la 4.ª ronda
  if (winners.length >= 4) assert.notEqual(m.sideOf(0, 1), m.sideOf(0, 4));
  assert.ok(ended.mvp && ended.mvp.stats.score >= 0);
});

test('estadísticas: bajas, asistencias y derribos se acreditan al que corresponde', () => {
  const m = newMatch();
  toAction(m);
  const [a1, a2] = m.opsOfSide('atk');
  const [d1] = m.opsOfSide('def');
  m.game.damage(d1, 30, { by: a2, zone: 'body' });
  m.game.damage(d1, d1.hp + 1, { by: a1, zone: 'body' });   // derriba a1
  assert.equal(d1.state, 'downed');
  m.game.damage(d1, 5, { by: a2, zone: 'body' });           // remata a2
  assert.equal(d1.state, 'dead');
  assert.equal(a2.slot.stats.kills, 1);
  assert.equal(a1.slot.stats.downs, 1);
  assert.equal(a1.slot.stats.assists, 1);
  assert.equal(d1.slot.stats.deaths, 1);
});

test('bots provisionales: un defensor que ve a un atacante le dispara y lo abate', () => {
  const m = newMatch({ seed: 3, rules: { actionTime: 60 } });
  const bots = new BotSquad(m, 'veterano');
  m.on('roundStart', () => bots.reset());
  bots.reset();
  toAction(m);
  const d = m.opsOfSide('def')[0];
  const a = m.opsOfSide('atk')[0];
  // resto fuera de juego para aislar el duelo
  for (const o of m.game.operators) if (o !== a && o !== d) place(o, o.side === 'atk' ? -10 : 5, o.side === 'atk' ? 0.02 : -3.48, o.side === 'atk' ? 40 : 5);
  // duelo en el pasillo de servicio (planta baja): defensor mirando al atacante
  place(d, 29, 0.01, 9.5); d.yaw = Math.PI; bots.brains.get(d).post = { x: 29, y: 0, z: 9.5, yaw: Math.PI };
  place(a, 29, 0.01, 12.5); a.yaw = 0;
  bots.brains.get(a).post = { x: 29, y: 0, z: 12.5, yaw: 0 };
  let t = 0;
  while (a.state === 'alive' && d.state === 'alive' && t < 10) { bots.update(TICK); m.tick(TICK); t += TICK; }
  assert.ok(d.stats.shots + a.stats.shots > 0, 'hubo disparos');
  assert.ok(a.state !== 'alive' || d.state !== 'alive', 'alguien cayó en el duelo');
  bots.dispose();
});

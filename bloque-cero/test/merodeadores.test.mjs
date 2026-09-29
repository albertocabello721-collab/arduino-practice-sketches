// F10.1 · Merodeadores de la defensa bot: en Élite, 2 que no se alejan más de una sala del sitio (ni
// para cazar) y vuelven cuando quedan 60 s o se sabe que hay atacantes en el sitio; en Novato, Normal y
// Veterano, 1 como siempre. La vuelta al oír una brecha en el sitio queda como opción (medida, no
// elegida).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor, DIFFICULTY } from '../src/sim/bots.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }

// Partida solo de bots; el ataque es el equipo 0.
function match(seed, diff = 'elite', loc) {
  settle();
  const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, diff, { nav });
  m.on('roundStart', () => bots.reset());
  if (loc !== undefined) m.on('roundSelect', () => { m.location = loc; });
  m.start();
  return { m, bots, g: m.game };
}
function run(M, pred, maxT = 60) { for (let n = 0; n < maxT / TICK && !pred(); n++) { M.bots.update(TICK); M.m.tick(TICK); } }
const toAction = (M) => { run(M, () => M.m.phase === 'action', 200); M.bots.update(TICK); M.m.tick(TICK); };
const defs = (M) => [...M.bots.brains.values()].filter((B) => B.side === 'def');
const inRoom = (r, p) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1 && Math.abs(p.y - r.floorY) < 1.2;

test('la tabla: en Élite 2 merodeadores a una sala del sitio; en el resto, 1 que vuelve a los 60 s', () => {
  for (const k of ['novato', 'normal', 'veterano']) {
    const D = DIFFICULTY[k];
    assert.deepEqual({ n: D.roamers, back: D.roamBack, breach: D.roamBreach, near: D.roamNear }, { n: 1, back: 60, breach: false, near: false }, k);
  }
  const E = DIFFICULTY.elite;
  assert.deepEqual({ n: E.roamers, back: E.roamBack, breach: E.roamBreach, near: E.roamNear }, { n: 2, back: 60, breach: false, near: true });
});

test('papeles al empezar: en Élite 2 merodeadores y 3 anclas; en Normal, 1 y 4', () => {
  for (const [diff, n] of [['elite', 2], ['normal', 1]]) {
    const M = match(4, diff);
    run(M, () => M.m.phase === 'prep', 60);
    M.bots.update(TICK);
    const roles = defs(M).map((B) => B.role);
    assert.equal(roles.filter((r) => r === 'roam').length, n, `${diff}: merodeadores`);
    assert.equal(roles.filter((r) => r === 'anchor').length, 5 - n, `${diff}: anclas`);
    M.bots.dispose();
  }
});

test('Élite: tras reforzar, los merodeadores salen a sostener ángulos en salas vecinas al sitio (a una sala)', () => {
  const M = match(6);
  toAction(M);
  // (el ataque, quieto: que nadie empuje ni haga volver a los merodeadores)
  for (const o of M.m.opsOfSide('atk')) o.frozen = true;
  run(M, () => false, 35);
  const plan = M.bots.defPlan, adj = plan.adj.map((a) => a.room);
  const roam = defs(M).filter((B) => B.role === 'roam' && B.op.state === 'alive');
  assert.ok(roam.length >= 1, 'hay merodeadores en pie');
  for (const B of roam) {
    assert.ok(B.hold && B.hold.room && adj.includes(B.hold.room), `${B.op.name}: sostiene en una sala vecina (${B.hold && B.hold.room && B.hold.room.name})`);
    const p = B.op.body.pos;
    assert.ok([...plan.rooms, ...adj].some((r) => inRoom(r, p)) || B.mover.busy, `${B.op.name}: no más lejos que una sala del sitio`);
  }
  M.bots.dispose();
});

test('vuelven al sitio cuando quedan 60 s o cuando se sabe que hay atacantes en él (y la etiqueta con P dice por qué)', () => {
  const M = match(6);
  toAction(M);
  run(M, () => false, 25);
  const roam = defs(M).filter((B) => B.role === 'roam');
  assert.ok(roam.length, 'merodeadores');
  // quedan 60 s: todos vuelven
  M.m.timer = 59;
  run(M, () => false, 0.5);
  for (const B of roam) { assert.equal(B.role, 'anchor', B.op.name); assert.equal(B.roamBack, 'tiempo'); }
  M.bots.dispose();
  // atacantes en el sitio (en la pizarra de la defensa): vuelven
  const M2 = match(6);
  toAction(M2);
  run(M2, () => false, 25);
  const roam2 = defs(M2).filter((B) => B.role === 'roam');
  const room = M2.bots.defPlan.rooms[0], foe = M2.m.opsOfSide('atk')[0];
  const at = { x: (room.x0 + room.x1) / 2, y: room.floorY, z: (room.z0 + room.z1) / 2 };
  M2.bots.boards[roam2[0].team].report(foe, at, M2.g.time, true, 0);
  run(M2, () => false, 0.5);
  for (const B of roam2) { assert.equal(B.role, 'anchor', B.op.name); assert.equal(B.roamBack, 'atacantes'); }
  M2.bots.dispose();
});

test('la opción de volver al oír una brecha en el sitio: con ella, vuelven al estallar una carga de brecha junto al sitio; sin ella, no', () => {
  const E = DIFFICULTY.elite, keep = E.roamBreach;
  try {
    for (const breach of [true, false]) {
      E.roamBreach = breach;
      const M = match(6);
      toAction(M);
      run(M, () => false, 25);
      const roam = defs(M).filter((B) => B.role === 'roam' && B.op.state === 'alive');
      assert.ok(roam.length, 'merodeadores');
      // (la defensa no sabe dónde está el ataque: que no vuelvan por eso)
      for (const b of M.bots.boards) b.reset();
      const room = M.bots.defPlan.rooms[0], foe = M.m.opsOfSide('atk')[0];
      M.g.emit('explosion', 'breach', { x: room.x0 - 0.2, y: room.floorY + 1.2, z: (room.z0 + room.z1) / 2 }, {}, foe);
      M.bots.update(TICK); M.bots.update(TICK);
      for (const B of roam) B.thinkT = 0;
      M.bots.update(TICK);
      for (const B of roam) {
        if (breach) { assert.equal(B.role, 'anchor', B.op.name + ' vuelve'); assert.equal(B.roamBack, 'brecha'); }
        else assert.equal(B.role, 'roam', B.op.name + ' sigue fuera');
      }
      M.bots.dispose();
    }
  } finally { E.roamBreach = keep; }
});

test('a una sala del sitio: con `roamNear` no salen a cazar un ruido más lejos; sin ella, sí', () => {
  const E = DIFFICULTY.elite, keep = E.roamNear;
  try {
    const M = match(6);
    toAction(M);
    run(M, () => false, 25);
    const B = defs(M).find((X) => X.role === 'roam' && X.op.state === 'alive');
    assert.ok(B, 'un merodeador');
    const p = B.op.body.pos, foe = M.m.opsOfSide('atk')[0];
    // un ruido a 8 m, fuera del sitio y de sus salas vecinas
    let far = null;
    for (let a = 0; a < Math.PI * 2 && !far; a += 0.2) {
      const q = { x: p.x + Math.cos(a) * 8, y: p.y, z: p.z + Math.sin(a) * 8 };
      if (!B._nearSite(q) && map.roomAt(q.x, q.y + 0.2, q.z)) far = q;
    }
    assert.ok(far, 'un punto a más de una sala del sitio');
    for (const near of [true, false]) {
      E.roamNear = near;
      B.task = null; B.huntRoll = true;
      B.per.memory.set(foe, { x: far.x, y: far.y, z: far.z, t: M.g.time, seen: false, precise: true });
      B._thinkDef('action');
      assert.equal(B.task.kind === 'hunt', !near, near ? 'no sale a cazarlo' : 'sale a cazarlo');
    }
    M.bots.dispose();
  } finally { E.roamNear = keep; }
});

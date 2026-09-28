// F10.2b · Rappel de los bots atacantes: pasos de cuerda en la rejilla (del pie de la fachada a las
// ventanas de la planta alta y al tejado, y del tejado a las ventanas), que cuestan lo que se tarda y
// solo usa el ataque; con el sitio arriba, en Élite 1 o 2 entran por ventanas del sitio y esperan
// colgados (como mucho 20 s) a que empuje el equipo; en Normal y Veterano, 1 en el 30 % de las rondas
// y sin esperar; en Novato, nadie. En la cuerda: si les disparan subiendo, bajan; nunca más de 25 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Rappel, RAPPEL } from '../src/sim/rappel.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { ROPE_NAV } from '../src/sim/nav.js';
import { ROPE_AI } from '../src/sim/ai/mover.js';
import { planRope, siteRopes } from '../src/sim/ai/ropeai.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const UP = map.sites.findIndex((s) => s.id === 'alta');
const edge = (key) => nav.ropeEdges.find((E) => E.rp.key === key);

function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }
function place(op, x, y, z, yaw = op.yaw) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; op.yaw = yaw; }

// Partida solo de bots con el sitio en la planta alta; el ataque es el equipo 0. Con los sucesos de la cuerda.
function match(seed, { diff = 'elite', loc = UP } = {}) {
  settle();
  const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, diff, { nav });
  m.on('roundStart', () => bots.reset());
  m.on('roundSelect', () => { m.location = loc; });
  const g = m.game, log = [];
  for (const k of ['rappelHook', 'rappelOff', 'rappelBreach']) g.on(k, (op, x) => log.push({ k, op, x, t: g.time, y: op.body.pos.y }));
  m.start();
  return { m, bots, g, log };
}
function run(M, pred, maxT = 60, each = null) {
  for (let n = 0; n < maxT / TICK && !pred(); n++) { M.bots.update(TICK); M.m.tick(TICK); if (each) each(); }
}
const toAction = (M) => { run(M, () => M.m.phase === 'action', 200); M.bots.update(TICK); M.m.tick(TICK); };
const freeze = (ops) => { for (const o of ops) o.frozen = true; };
// Un atacante que entra por `key`: el resto, quieto (y la defensa, quieta: que no se meta en la prueba).
function roper(M, key, { wait = false } = {}) {
  const { m, bots } = M;
  // (no el portador del desactivador: dentro del sitio, iría a plantar)
  const atk = m.opsOfSide('atk'), op = atk.find((o) => o !== m.defuser.carrier), B = bots.brains.get(op);
  freeze(m.opsOfSide('def'));
  freeze(atk.filter((o) => o !== op));
  const E = edge(key);
  B.ropePlan = { rp: E.rp, room: 'B', wait, walkT: 0, done: false, failed: false };
  B.stage = 'rope'; B.delay = 0; B.task = null; B.thinkT = 0;
  // (cerca del pie de la fachada, en el jardín)
  const n = E.rp.axis === 'x' ? { x: 0, z: E.rp.out } : { x: E.rp.out, z: 0 };
  place(op, E.rp.hook.x + n.x * 2.5, E.rp.hook.y, E.rp.hook.z + n.z * 2.5);
  return { op, B, E, others: atk.filter((o) => o !== op) };
}

test('pasos de cuerda en la rejilla: del pie de la fachada a cada ventana de la planta alta y al tejado, y del tejado a las ventanas; cuestan lo que se tarda', () => {
  settle();
  const keys = new Set(nav.ropeEdges.map((E) => E.rp.key));
  // las cinco ventanas del sitio de arriba por las que cabe un cuerpo (tras las otras dos hay una cama)
  for (const k of ['norte_oeste:ground:enter:9.00', 'norte_oeste:ground:enter:15.00', 'norte_centro:ground:enter:21.00', 'oeste:ground:enter:17.00', 'oeste:ground:enter:22.00']) {
    assert.ok(keys.has(k), 'desde el suelo: ' + k);
    assert.ok(keys.has(k.replace(':ground:', ':top:')), 'desde el tejado: ' + k);
  }
  assert.ok(nav.ropeEdges.filter((E) => E.rp.act === 'top').length >= 8, 'al tejado desde todas las fachadas');
  for (const E of nav.ropeEdges) {
    const r = E.rp, up = r.y1 >= r.y0;
    const T = (r.from === 'ground' ? RAPPEL.hookGround : RAPPEL.hookTop) + Math.max(Math.abs(r.y1 - r.y0) / (up ? RAPPEL.up : RAPPEL.down), Math.abs(r.s1 - r.s0) / RAPPEL.side) + (r.act === 'enter' ? RAPPEL.breach : RAPPEL.climbTop);
    assert.ok(Math.abs(r.T - T) < 1e-9, r.key + ': el tiempo');
    const e = E.from.edges.find((q) => q.kind === 'rappel' && q.rp === r);
    assert.ok(e && Math.abs(e.cost - (T * ROPE_NAV.speed + 1)) < 1e-9, r.key + ': el coste es el tiempo a ' + ROPE_NAV.speed + ' m/s');
    // (el enganche, fuera y a su alcance; la llegada, dentro o en el tejado)
    const d = (E.rp.axis === 'x' ? E.from.pz - E.rp.line : E.from.px - E.rp.line) * E.rp.out;
    assert.ok(r.from === 'ground' ? d > 0.5 && d < 1.5 : d < -0.4, r.key + ': el punto de enganche');
    assert.equal(map.locationAt(E.to.px, E.to.y + 0.3, E.to.pz) === 'Tejado', r.act === 'top', r.key + ': a dónde lleva');
  }
  // esperando, a un lado de la ventana: el cuerpo no queda delante del hueco
  for (const E of nav.ropeEdges) {
    const r = E.rp;
    if (r.act !== 'enter' || !r.wait || r.wait.s === r.s1) continue;
    assert.ok(Math.abs(r.wait.s - r.win.center) - 0.3 >= r.win.width / 2 + 0.1, r.key + ': espera fuera del hueco');
  }
});

test('solo quien los pide: sin `rappel`, la ruta va por dentro; con él, del jardín trasero al Estudio, por la fachada y más corta', () => {
  settle();
  const a = { x: 14, y: 0, z: 36 }, b = { x: 21, y: 3.5, z: 23 };
  const walk = nav.path(a, b, { raw: true }), rope = nav.path(a, b, { raw: true, rappel: true });
  assert.ok(walk && !walk.points.some((p) => p.kind === 'rappel'), 'sin cuerda');
  const step = rope.points.find((p) => p.kind === 'rappel');
  assert.ok(step && step.rp.act === 'enter', 'con cuerda: entra por una ventana');
  assert.ok(rope.cost < walk.cost, `más corta (${rope.cost.toFixed(1)} < ${walk.cost.toFixed(1)})`);
  // a un sitio de la planta baja, la cuerda no acorta: no la usa
  const c = { x: 20, y: 0, z: 18.5 };
  assert.ok(!nav.path(a, c, { raw: true, rappel: true }).points.some((p) => p.kind === 'rappel'), 'a la cocina, por la puerta');
  // un paso que ya falló no se vuelve a usar
  const ban = new Set([step.rp.key]);
  const again = nav.path(a, b, { raw: true, rappel: true, ropeBan: ban });
  assert.ok(!again.points.some((p) => p.kind === 'rappel' && p.rp.key === step.rp.key), 'ni el que falló');
});

test('un bot sigue el paso de cuerda: al pie de la fachada, se engancha, sube, rompe la barricada y entra en el Estudio', () => {
  const M = match(3);
  toAction(M);
  const { op, B } = roper(M, 'norte_centro:ground:enter:21.00');
  run(M, () => B.ropePlan.done, 30);
  const hook = M.log.find((l) => l.k === 'rappelHook' && l.op === op), off = M.log.find((l) => l.k === 'rappelOff' && l.op === op);
  assert.ok(hook, 'se engancha');
  assert.ok(M.log.some((l) => l.k === 'rappelBreach' && l.op === op), 'rompe la barricada');
  assert.equal(off && off.x, 'window', 'entra por la ventana');
  assert.ok(off.t - hook.t < 7, `sin esperar (${(off.t - hook.t).toFixed(1)} s colgado)`);
  assert.equal(map.locationAt(op.body.pos.x, op.body.pos.y + 0.3, op.body.pos.z), 'Estudio');
  assert.equal(B.stage, 'clear', 'dentro, a despejar');
  assert.equal(B.siteRoomKey, 'B', 'su sala del sitio');
  assert.ok(B.mover.ropeStuck < 1, 'sin atascarse en la cuerda');
  M.bots.dispose();
});

test('Élite: espera al pie hasta que el equipo entra en la casa, sube y espera colgado junto a la ventana; entra cuando empujan', () => {
  const M = match(5);
  toAction(M);
  const { op, B, E, others } = roper(M, 'oeste:ground:enter:17.00', { wait: true });
  // el resto, fuera: no se engancha
  run(M, () => false, 8);
  assert.ok(!M.log.some((l) => l.k === 'rappelHook'), 'espera al pie de la fachada');
  // alguien entra en la casa (la cocina, abajo): sube y espera a un lado de la ventana
  place(others[0], 20, 0.01, 20);
  run(M, () => false, 7);
  const S = B.mover.rope, R = op.rappel;
  assert.ok(R && R.phase === 'hang' && S && S.waiting && S.arrived, 'colgado, esperando');
  assert.ok(Math.abs(R.s - E.rp.wait.s) < 0.1 && Math.abs(R.y - E.rp.wait.y) < 0.1, 'junto a la ventana');
  assert.equal(M.m.rappel.windowAt(op), null, 'no delante del hueco');
  // empujan: uno ya está en el sitio (el Dormitorio): entra
  const t0 = M.g.time;
  place(others[1], 6, 3.51, 20);
  run(M, () => B.ropePlan.done, 6);
  const off = M.log.find((l) => l.k === 'rappelOff' && l.op === op);
  assert.equal(off && off.x, 'window', 'entra');
  assert.ok(off.t - t0 < 3, `enseguida (${(off.t - t0).toFixed(1)} s)`);
  M.bots.dispose();
});

test('Élite sin empuje: espera como mucho 20 s colgado y entra; nunca más de 25 s en la cuerda', () => {
  const M = match(6);
  toAction(M);
  const { op, B, others } = roper(M, 'norte_oeste:ground:enter:9.00', { wait: true });
  place(others[0], 20, 0.01, 20);      // (dentro de la casa, pero lejos del sitio: no empuja)
  run(M, () => B.ropePlan.done, 60);
  const hook = M.log.find((l) => l.k === 'rappelHook' && l.op === op), off = M.log.find((l) => l.k === 'rappelOff' && l.op === op);
  assert.ok(hook && off, 'sube y termina');
  assert.equal(off.x, 'window', 'entra');
  const hang = off.t - hook.t;
  assert.ok(hang > ROPE_AI.waitMax * 0.8 && hang < ROPE_AI.maxHang, `espera y entra antes de 25 s (${hang.toFixed(1)} s)`);
  M.bots.dispose();
});

test('si le disparan mientras sube, baja; esa ronda va por dentro y ya no vuelve a la cuerda', () => {
  const M = match(7);
  toAction(M);
  const { op, B } = roper(M, 'norte_centro:ground:enter:21.00');
  run(M, () => op.rappel && op.rappel.phase === 'hang' && op.body.pos.y > 1.5, 15);
  assert.ok(op.rappel, 'subiendo');
  const foe = M.m.opsOfSide('def')[0];
  M.g.damage(op, 10, { by: foe, zone: 'body' });
  run(M, () => !op.rappel, 5);
  const off = M.log.find((l) => l.k === 'rappelOff' && l.op === op);
  assert.equal(off && off.x, 'ground', 'baja hasta el suelo');
  assert.ok(off.y < 0.2, 'en el suelo');
  assert.ok(B.noRope && !B._ropeOk(), 'sin cuerda el resto de la ronda');
  run(M, () => B.stage !== 'rope', 2);
  assert.ok(B.ropePlan.failed && (B.stage === 'approach' || B.stage === 'clear'), 'con su grupo o a despejar');
  run(M, () => false, 6);
  assert.equal(M.log.filter((l) => l.k === 'rappelHook' && l.op === op).length, 1, 'no se vuelve a enganchar');
  M.bots.dispose();
});

test('cuántos: en Élite 1 o 2 por ventanas distintas y esperan; en Normal y Veterano 1 en el 30 % de las rondas, sin esperar; en Novato, nadie', () => {
  const M = match(8);
  toAction(M);
  const sq = M.bots, m = M.m, site = map.sites[UP];
  const atk = [...sq.brains.values()].filter((B) => B.side === 'atk');
  const wins = new Set(siteRopes(sq, site).map((r) => r.rp.key));
  const round0 = m.round;
  const res = {};
  for (const diff of ['novato', 'normal', 'veterano', 'elite']) {
    sq.setDifficulty(diff);
    const R = (res[diff] = { rounds: 0, rope: 0, n: [0, 0, 0], wait: 0 });
    for (let r = 1; r <= 300; r++) {
      m.round = r;
      for (const B of atk) { B.ropePlan = null; B.stage = 'approach'; }
      planRope(sq, atk, site);
      const P = atk.filter((B) => B.ropePlan);
      R.rounds++; R.n[P.length]++;
      if (P.length) R.rope++;
      for (const B of P) {
        assert.ok(wins.has(B.ropePlan.rp.key), 'por una ventana del sitio');
        assert.equal(B.stage, 'rope');
        assert.notEqual(B.op, m.defuser.carrier, 'no el portador');
        if (B.ropePlan.wait) R.wait++;
      }
      if (P.length === 2) { const [a, b] = P.map((B) => B.ropePlan.rp.hook); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3, 'ventanas distintas'); }
    }
  }
  m.round = round0;
  assert.equal(res.novato.rope, 0, 'Novato: nadie');
  for (const d of ['normal', 'veterano']) {
    const p = res[d].rope / res[d].rounds;
    assert.ok(p > 0.24 && p < 0.36, `${d}: en el 30 % de las rondas (${(100 * p).toFixed(1)} %)`);
    assert.equal(res[d].n[2], 0, `${d}: solo 1`);
    assert.equal(res[d].wait, 0, `${d}: sin esperar`);
  }
  assert.equal(res.elite.rope, res.elite.rounds, 'Élite: siempre');
  assert.ok(res.elite.n[1] > 90 && res.elite.n[2] > 90, `Élite: 1 o 2 (${res.elite.n[1]} / ${res.elite.n[2]})`);
  assert.equal(res.elite.wait, res.elite.n[1] + 2 * res.elite.n[2], 'Élite: esperan');
  M.bots.dispose();
});

test('la defensa no hace rappel, el ataque tampoco en la preparación; con otro sitio, la cuerda solo entra en sus rutas si les acorta el camino', () => {
  const M = match(9, { loc: map.sites.findIndex((s) => s.id === 'baja') });
  run(M, () => M.m.phase === 'prep', 60);
  for (const B of M.bots.brains.values()) assert.equal(B._ropeOk(), false, B.op.name + ': en la preparación, no');
  toAction(M);
  for (const B of M.bots.brains.values()) {
    if (B.side === 'def') assert.equal(B._ropeOk(), false, B.op.name + ': la defensa, no');
    else if (M.bots.atkTargetSite().id !== 'alta') assert.equal(B._ropeOk(), true, B.op.name + ': el ataque, si le acorta');
  }
  // con el sitio arriba, solo los que entran por su ventana (el resto, por dentro)
  const M2 = match(3);
  toAction(M2);
  if (M2.bots.atkTargetSite().id === 'alta') for (const B of M2.bots.brains.values()) assert.equal(B._ropeOk(), false, B.op.name);
  M.bots.dispose(); M2.bots.dispose();
});

test('arreglo: Espacio pegado a una pared no la atraviesa (antes se colaba en la cocina); la ventana baja con barricada rota se sigue saltando', () => {
  settle();
  const g = new Game({ world, map, seed: 1 });
  new Rappel(g, { canRappel: () => false });
  const op = g.addOperator(new Operator('a', { team: 0, loadout: ['ar', 'pistol'] }));
  for (const [x, z] of [[12.25, 26.75], [19.75, 26.75]]) {
    place(op, x, 0, z, 0);
    for (let i = 0; i < 20; i++) g.tick();
    op.intent.vault = true; g.tick();
    for (let i = 0; i < 60; i++) g.tick();
    assert.ok(Math.abs(op.body.pos.z - z) < 0.05 && op.body.pos.y < 0.1, `sigue fuera (${op.body.pos.x.toFixed(2)}, ${op.body.pos.y.toFixed(2)}, ${op.body.pos.z.toFixed(2)})`);
    assert.equal(map.locationAt(op.body.pos.x, op.body.pos.y + 0.3, op.body.pos.z), 'Jardín trasero');
  }
});

test('una partida en Élite con el sitio arriba: hay rappel, nadie se atasca en la cuerda ni pasa más de 25 s colgado', () => {
  const M = match(11);
  const hang = new Map();
  let maxHang = 0, hooks = 0, rounds = 0;
  M.g.on('rappelHook', (op) => { hooks++; hang.set(op, M.g.time); });
  M.g.on('rappelOff', (op) => { if (hang.has(op)) { maxHang = Math.max(maxHang, M.g.time - hang.get(op)); hang.delete(op); } });
  M.g.on('killed', (op) => hang.delete(op));
  M.m.on('roundEnd', () => { rounds++; for (const [, t] of hang) maxHang = Math.max(maxHang, M.g.time - t); hang.clear(); });
  let stuck = 0;
  run(M, () => rounds >= 3, 900, () => { for (const B of M.bots.brains.values()) stuck = Math.max(stuck, B.mover.ropeStuck); });
  assert.equal(rounds, 3);
  assert.ok(hooks > 0, 'hay rappel');
  assert.ok(maxHang <= ROPE_AI.maxHang, `como mucho ${maxHang.toFixed(1)} s colgados`);
  assert.ok(stuck < 15, `sin atascarse (${stuck.toFixed(1)} s)`);
  M.bots.dispose();
});

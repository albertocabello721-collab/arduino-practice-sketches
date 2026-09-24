// F6.3a · Gadgets lanzables (sección 13): fragmentación, humo, cegadora e impacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Gadgets, FRAG, SMOKE, FLASH } from '../src/sim/gadgets.js';
import { MAT } from '../src/world/materials.js';
import { lineOfSight } from '../src/world/raycast.js';

const world = createVillaWorld();
const map = buildVilla(world);
function fresh(seed = 3) {
  world.resetToPristine();
  const game = new Game({ world, map, seed });
  const gadgets = new Gadgets(game);
  return { game, gadgets };
}
function step(game, gadgets, s) { for (let i = 0; i < Math.round(s / TICK); i++) { game.tick(TICK); gadgets.tick(TICK); } }
function give(op, id, n = 2) { op.gadget = { id, left: n }; return op; }

test('fragmentación: rebota, se para y a los 3 s mata a 1 m, hiere a 2,5 m y no llega a 4 m', () => {
  const { game, gadgets } = fresh();
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 3, yaw: Math.PI, loadout: ['ar'] })), 'frag');
  step(game, gadgets, 0.3);
  // lanzar hacia el suelo, a unos metros
  a.pitch = -0.5;
  a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.equal(gadgets.items.length, 1, 'en el aire');
  assert.equal(a.gadget.left, 1);
  // nadie cerca todavía: se deja rodar y parar
  let t = 0;
  while (t < 2.5 && !gadgets.items[0].rest) { step(game, gadgets, TICK); t += TICK; }
  const g = gadgets.items[0];
  assert.ok(g.rest, 'se para en el suelo');
  assert.ok(g.bounces >= 1, 'rebota');
  const p = { ...g.pos };
  // tres objetivos: 1 m, 2,5 m y 4 m
  const near = game.addOperator(new Operator('n', { team: 1, x: p.x + 1.0, y: 0, z: p.z, yaw: 0, armor: 3 }));
  const mid = game.addOperator(new Operator('m', { team: 1, x: p.x - 2.3, y: 0, z: p.z, yaw: 0, armor: 1 }));
  const far = game.addOperator(new Operator('f', { team: 1, x: p.x, y: 0, z: p.z + 4, yaw: 0 }));
  const booms = [];
  game.on('explosion', (kind) => booms.push(kind));
  step(game, gadgets, FRAG.fuse - t + 0.1);
  assert.deepEqual(booms, ['frag'], 'explota a los 3 s');
  assert.equal(near.state, 'dead', 'a 1 m: muerte (sin derribo)');
  assert.ok(mid.hp < mid.maxHp && mid.state !== 'dead', `a 2,5 m: herido (${Math.round(mid.hp)})`);
  assert.equal(far.hp, far.maxHp, 'a 4 m: nada');
  assert.equal(gadgets.items.length, 0);
});

test('fragmentación: un muro duro protege; el pladur atenúa', () => {
  const { game, gadgets } = fresh();
  // granada en la calle junto a la fachada de ladrillo; objetivo dentro del salón
  const t1 = game.addOperator(new Operator('t1', { team: 1, x: 5, y: 0, z: 0.9, yaw: 0 }));
  const it = { id: 'x', kind: 'frag', owner: null, team: 0, pos: { x: 5, y: 0.3, z: -0.6 }, vel: { x: 0, y: 0, z: 0 }, t: 2.95, rest: true, alive: true, bounces: 0 };
  gadgets.items.push(it);
  step(game, gadgets, 0.2);
  assert.equal(t1.hp, t1.maxHp, 'el ladrillo para la metralla');
});

test('humo: 10 s, 4 m de radio; tapa la línea de visión mientras dura', () => {
  const { game, gadgets } = fresh();
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 3, y: 0, z: 6.5, yaw: -Math.PI / 2, loadout: ['ar'] })), 'smoke');
  step(game, gadgets, 0.3);
  a.pitch = -0.35;
  a.intent.gadget = true;
  const clouds = [];
  game.on('smoke', (s) => clouds.push(s));
  step(game, gadgets, SMOKE.openAfter + 0.3);
  assert.equal(clouds.length, 1, 'se abre');
  const s = clouds[0];
  step(game, gadgets, SMOKE.grow);
  // de un lado a otro de la nube: tapado
  const A = { x: s.x - 5, y: s.y, z: s.z }, B = { x: s.x + 5, y: s.y, z: s.z };
  assert.ok(gadgets.smokeBlocks(A, B), 'tapa la vista');
  assert.ok(!gadgets.smokeBlocks({ x: s.x - 5, y: s.y, z: s.z + 6 }, { x: s.x + 5, y: s.y, z: s.z + 6 }), 'a 6 m del centro, no');
  assert.ok(gadgets.smokeAt({ x: s.x, y: s.y, z: s.z }) > 0.9, 'dentro, velo completo');
  step(game, gadgets, s.until - 0.3 - game.time);
  assert.equal(gadgets.smokes.length, 1, 'sigue hasta los 10 s');
  assert.ok(Math.abs(s.until - s.t0 - SMOKE.time) < 1e-9);
  step(game, gadgets, 0.5);
  assert.equal(gadgets.smokes.length, 0, 'se disipa');
  assert.ok(!gadgets.smokeBlocks(A, B));
});

test('cegadora: 3,5 s mirándola, menos de lado y aún menos de espaldas; tras una pared, nada', () => {
  const { game, gadgets } = fresh();
  // en el hall (despejado): la granada en el suelo y cuatro defensores alrededor
  const at = { x: 17, y: 0.2, z: 11.5 };
  const facing = game.addOperator(new Operator('f', { team: 1, x: 17, y: 0, z: 14.5, yaw: 0 }));        // mira hacia -z: hacia la granada
  const side = game.addOperator(new Operator('s', { team: 1, x: 19.6, y: 0, z: 11.5, yaw: 0 }));        // la tiene a un lado
  const back = game.addOperator(new Operator('b', { team: 1, x: 17, y: 0, z: 8.5, yaw: 0 }));           // de espaldas
  const wall = game.addOperator(new Operator('w', { team: 1, x: 25, y: 0, z: 11.5, yaw: Math.PI / 2 })); // tras la pared, en el pasillo
  step(game, gadgets, 0.3);
  facing.pitch = -0.3;
  for (const o of [facing, side, back]) { const e = o.eyePos(); assert.ok(lineOfSight(world, at.x, at.y + 0.05, at.z, e.x, e.y, e.z), `${o.id} ve la granada`); }
  const we = wall.eyePos();
  assert.ok(!lineOfSight(world, at.x, at.y + 0.05, at.z, we.x, we.y, we.z), 'la pared tapa');
  gadgets.items.push({ id: 'fl', kind: 'flash', owner: null, team: 0, pos: { ...at }, vel: { x: 0, y: 0, z: 0 }, t: FLASH.fuse - TICK, rest: true, alive: true, bounces: 0 });
  step(game, gadgets, TICK * 2);
  assert.ok(facing.blindT > 3.2, `mirando: ${facing.blindT.toFixed(2)} s`);
  assert.ok(side.blindT > FLASH.min && side.blindT < facing.blindT, `de lado: ${side.blindT.toFixed(2)} s`);
  assert.ok(back.blindT >= FLASH.min - 0.05 && back.blindT < side.blindT, `de espaldas: ${back.blindT.toFixed(2)} s`);
  assert.ok(!(wall.blindT > 0), 'tras la pared: nada');
  step(game, gadgets, 3.6);
  assert.equal(facing.blindT, 0, 'se pasa');
});

test('impacto: explota al tocar y abre 1 m de pared blanda', () => {
  const { game, gadgets } = fresh();
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 10, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'impact');
  step(game, gadgets, 0.3);
  d.pitch = 0.05;
  const before = world.getWorld(12.06, 1.5, 2);
  assert.notEqual(before, MAT.AIR, 'pared de pladur');
  const booms = [];
  game.on('explosion', (kind, p) => booms.push(p));
  d.intent.gadget = true;
  step(game, gadgets, 0.6);
  assert.equal(booms.length, 1, 'ha explotado');
  assert.ok(Math.abs(booms[0].x - 11.9) < 0.3, `contra la pared (x=${booms[0].x.toFixed(2)})`);
  // hueco de ~1 m
  let air = 0;
  for (let y = 1.0; y <= 2.0; y += 0.125) for (let z = 1.5; z <= 2.5; z += 0.125) if (world.getWorld(12.06, y, z) === MAT.AIR) air++;
  assert.ok(air >= 20, `hueco abierto (${air} vóxeles)`);
});

test('sin cargas no se lanza nada; hay que esperar entre lanzamientos', () => {
  const { game, gadgets } = fresh();
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: 0, loadout: ['ar'] })), 'smoke', 2);
  step(game, gadgets, 0.3);
  a.intent.gadget = true; step(game, gadgets, TICK);
  a.intent.gadget = true; step(game, gadgets, TICK);
  assert.equal(a.gadget.left, 1, 'enfriamiento de 1 s');
  step(game, gadgets, 1.0);
  a.intent.gadget = true; step(game, gadgets, TICK);
  assert.equal(a.gadget.left, 0);
  a.intent.gadget = true; step(game, gadgets, 1.2);
  assert.equal(a.gadget.left, 0);
  assert.equal(gadgets.items.filter((i) => i.kind === 'smoke').length + gadgets.smokes.length, 2);
});

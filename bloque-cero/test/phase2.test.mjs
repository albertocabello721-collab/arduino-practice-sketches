// Fase 2: zonas de impacto, derribo con sangrado, reanimación, remate y daño a través de paredes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator, BLEED_TIME, REVIVE_TIME } from '../src/sim/operator.js';
import { WEAPONS, falloffAt } from '../src/sim/weapons.js';
import { rayHitRig, BONE } from '../src/sim/skeleton.js';

const world = createVillaWorld();
const map = buildVilla(world);

function fresh(seed = 3) {
  world.resetToPristine();
  return new Game({ world, map, seed });
}
function aimAt(op, p) {
  const e = op.eyePos();
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function shootOnce(game, op, target) {
  aimAt(op, target);
  const w = op.weapon;
  return game.fireBullet(op, op.eyePos(), op.viewDir(), w);
}
function run(game, s) { for (let i = 0; i < Math.round(s / TICK); i++) game.tick(); }

test('el esqueleto coloca la cabeza a la altura de los ojos y las zonas en su sitio', () => {
  const op = new Operator('t', { x: 6, y: 0, z: 6, yaw: 0 });
  op.updatePose(0.1);
  const head = op.rig[BONE.head].p;
  assert.ok(head.y > 1.5 && head.y < 1.75, 'cabeza a ' + head.y.toFixed(2));
  const hit = rayHitRig(op.rig, { x: 6, y: 1.68, z: 3 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(hit && hit.zone === 'head', 'rayo a 1,68 m da en la cabeza: ' + (hit && hit.zone));
  const body = rayHitRig(op.rig, { x: 6, y: 1.25, z: 3 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(body && body.zone === 'body', 'rayo a 1,25 m da en el torso');
  const leg = rayHitRig(op.rig, { x: 5.9, y: 0.4, z: 3 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(leg && leg.zone === 'limb', 'rayo a 0,4 m da en una pierna');
});

test('un tiro a la cabeza mata al instante', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 6, y: 0, z: 9, yaw: 0, armor: 3 }));
  run(game, 0.2);
  const hp = t.rig[BONE.head].p;
  const r = shootOnce(game, a, { x: hp.x, y: hp.y + 0.1, z: hp.z });
  assert.equal(r.hitOp, t);
  assert.equal(r.zone, 'head');
  assert.equal(t.state, 'dead');
  assert.equal(a.stats.kills, 1);
  assert.equal(a.stats.headshots, 1);
});

test('tiros al torso derriban; el derribado se desangra en 20 s', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 6, y: 0, z: 9, yaw: 0, armor: 2 }));
  run(game, 0.2);
  let shots = 0;
  while (t.state === 'alive' && shots < 10) { const c = t.rig[BONE.chest].p; shootOnce(game, a, { x: c.x, y: c.y + 0.08, z: c.z }); shots++; }
  assert.equal(t.state, 'downed', 'derribado tras ' + shots + ' tiros');
  assert.ok(shots >= 3 && shots <= 4, '3-4 tiros de fusil al torso (fueron ' + shots + ')');
  run(game, BLEED_TIME - 1);
  assert.equal(t.state, 'downed', 'sigue vivo antes de 20 s');
  run(game, 1.5);
  assert.equal(t.state, 'dead', 'muere desangrado');
  assert.equal(a.stats.kills, 1, 'la baja es de quien lo derribó');
});

test('un compañero reanima en 4 s manteniendo F; un enemigo remata con un disparo', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 6, y: 0, z: 9, yaw: 0 }));
  const mate = game.addOperator(new Operator('m', { team: 1, x: 7, y: 0, z: 9.3, yaw: Math.PI / 2 }));
  run(game, 0.2);
  game.damage(t, 200 - 90, { by: a, zone: 'body' }); // 110 → 0: derribado justo
  assert.equal(t.state, 'downed');
  mate.intent.interact = true;
  run(game, REVIVE_TIME - 0.5);
  assert.equal(t.state, 'downed', 'aún reanimando');
  run(game, 1.0);
  assert.equal(t.state, 'alive', 'reanimado');
  assert.equal(t.hp, 20);
  mate.intent.interact = false;
  // derribar otra vez y rematar
  game.damage(t, 20, { by: a, zone: 'body' });
  assert.equal(t.state, 'downed');
  run(game, 0.3);
  const p = t.rig[BONE.chest].p;
  const r = shootOnce(game, a, p);
  assert.equal(r.hitOp, t, 'el disparo alcanza al derribado');
  assert.equal(t.state, 'dead', 'rematado');
});

test('a través del pladur la bala hace menos daño que en abierto', () => {
  const game = fresh();
  // tirador en el salón, objetivo en el recibidor tras la pared x=12
  const a = game.addOperator(new Operator('a', { team: 0, x: 10, y: 0, z: 5.5, yaw: -Math.PI / 2, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 14, y: 0, z: 5.5, yaw: Math.PI / 2, armor: 3 }));
  run(game, 0.2);
  const c = t.rig[BONE.chest].p;
  const r = shootOnce(game, a, { x: c.x, y: c.y + 0.05, z: c.z });
  assert.equal(r.hitOp, t, 'la bala atraviesa la pared y alcanza');
  assert.ok(r.throughWall, 'atraviesa pared');
  const open = WEAPONS.ar.damage * falloffAt(WEAPONS.ar, 4);
  assert.ok(r.damage < open * 0.9, `daño a través (${r.damage.toFixed(1)}) < abierto (${open.toFixed(1)})`);
  assert.ok(r.destroyed.length > 0, 'deja agujero en la pared');
});

test('el ladrillo protege: no hay impacto a través de muros duros', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 5, y: 0, z: -3, yaw: Math.PI, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 5, y: 0, z: 1.5, yaw: 0 }));
  run(game, 0.2);
  const c = t.rig[BONE.chest].p;
  const r = shootOnce(game, a, c);
  assert.equal(r.hitOp, null, 'no alcanza a través del ladrillo');
  assert.equal(t.hp, t.maxHp);
});

test('sin fuego amigo: la bala no daña a compañeros', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['ar'] }));
  const f = game.addOperator(new Operator('f', { team: 0, x: 6, y: 0, z: 6, yaw: 0 }));
  run(game, 0.2);
  const c = f.rig[BONE.chest].p;
  shootOnce(game, a, c);
  assert.equal(f.hp, f.maxHp);
});

test('la caída de daño con la distancia se aplica', () => {
  assert.equal(falloffAt(WEAPONS.ar, 10), 1);
  assert.ok(falloffAt(WEAPONS.ar, 60) < 0.75);
  assert.ok(falloffAt(WEAPONS.shotgun, 20) < 0.5);
});

test('el maniquí tirador dispara al jugador cuando lo ve', async () => {
  const { spawnRangeDummies, driveDummies } = await import('../src/sim/dummies.js');
  const game = fresh(9);
  const p = game.addOperator(new Operator('jugador', { team: 0, x: 21.5, y: 0, z: 4.2, yaw: -Math.PI / 2, loadout: ['ar'] }));
  const dummies = spawnRangeDummies(game);
  for (let i = 0; i < 60 * 6 && p.state === 'alive' && p.hp === p.maxHp; i++) { driveDummies(game, dummies, p, TICK); game.tick(); }
  assert.ok(p.hp < p.maxHp || p.state !== 'alive', 'el tirador acierta al menos una vez en 6 s (vida ' + p.hp.toFixed(0) + ')');
});

// Fase 1: mundo de vóxeles, destrucción bala a bala, física del operador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { MAT, SOLID } from '../src/world/materials.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { breachRect } from '../src/world/destruction.js';

function setup() {
  const world = createVillaWorld();
  const map = buildVilla(world);
  const game = new Game({ world, map, seed: 7 });
  return { world, map, game };
}
const { world, map, game } = setup();

function run(op, seconds, intent = {}) {
  Object.assign(op.intent, intent);
  for (let i = 0; i < Math.round(seconds / TICK); i++) game.tick();
}

test('el mapa tiene salas, sitios y metadatos', () => {
  assert.ok(map.rooms.length >= 20);
  assert.equal(map.sites.length, 3);
  for (const s of map.sites) {
    assert.ok(map.rooms.find((r) => r.id === s.A), 'sala A de ' + s.id);
    assert.ok(map.rooms.find((r) => r.id === s.B), 'sala B de ' + s.id);
  }
  assert.ok(map.doors.length > 30 && map.windows.length > 20 && map.hatches.length >= 7);
  assert.equal(map.locationAt(6, 1, 6), 'Salón');
  assert.equal(map.locationAt(6, 4.5, 20), 'Dormitorio principal');
  assert.equal(map.locationAt(6, -2.5, 20), 'Bodega');
});

test('cada bala agujerea una pared blanda (vóxel a vóxel)', () => {
  // pared entre salón (x<12) y recibidor, a la altura del pecho, en z=1.5
  const op = game.addOperator(new Operator('p1', { x: 9, y: 0, z: 1.5, yaw: -Math.PI / 2, loadout: ['ar'] }));
  run(op, 0.3);
  let holes = 0;
  for (let i = 0; i < 6; i++) {
    op.pitch = 0; op.yaw = -Math.PI / 2 + (i - 3) * 0.02;
    const eye = op.eyePos();
    const dir = op.viewDir({});
    const before = world.get(world.vx(12 - 0.06), world.vy(eye.y + dir.y * 3), world.vz(eye.z + dir.z * 3));
    const res = game.fireBullet(op, eye, dir, op.weapon);
    if (res.destroyed.length > 0) holes++;
    assert.ok(res.destroyed.every((v) => v.mat !== MAT.BRICK), 'no rompe ladrillo');
    void before;
  }
  assert.ok(holes >= 5, 'al menos 5 de 6 balas abren agujero, abrieron ' + holes);
  op.alive = false;
});

test('el ladrillo y el hormigón paran la bala sin romperse', () => {
  const op = game.addOperator(new Operator('p2', { x: 6, y: 0, z: -3, yaw: Math.PI, loadout: ['ar'] }));
  // fachada sur del salón es ladrillo (z=0)
  const eye = op.eyePos(); const dir = { x: 0, y: 0, z: 1 };
  const res = game.fireBullet(op, { x: 4.9, y: 1.6, z: -3 }, dir, op.weapon);
  assert.ok(res.hit && (res.hit.mat === MAT.BRICK || res.hit.mat === MAT.STONE), 'impacta en ladrillo: ' + (res.hit && res.hit.mat));
  assert.equal(res.destroyed.length, 0);
  void eye;
  op.alive = false;
});

test('no se atraviesan paredes intactas; sí un boquete grande', () => {
  const op = game.addOperator(new Operator('p3', { x: 3, y: 0, z: 11.5, yaw: Math.PI, loadout: ['ar'] }));
  run(op, 0.2);
  run(op, 2.5, { moveZ: 1 });
  // pared salón/comedor en z=13 (hay un arco en x 4.75..7.25; aquí x=3 es pared)
  assert.ok(op.body.pos.z < 12.9, 'se detiene ante la pared: z=' + op.body.pos.z.toFixed(3));
  const z0 = op.body.pos.z;
  breachRect(world, 3, 1.1, 13, 2, 1.2, 2.2, 0.5);
  run(op, 2.0, { moveZ: 1 });
  assert.ok(op.body.pos.z > 13.8, 'cruza el boquete: z=' + op.body.pos.z.toFixed(3) + ' (antes ' + z0.toFixed(3) + ')');
  op.intent.moveZ = 0;
  op.alive = false;
});

test('asomarse no mete la cabeza en la pared', () => {
  // pegado a la pared oeste del hall (x=12.125) mirando al norte (+z): su derecha es -x
  const op = game.addOperator(new Operator('p4', { x: 12.5, y: 0, z: 11.5, yaw: Math.PI, loadout: ['ar'] }));
  run(op, 0.5, { lean: 1 });
  const eye = op.eyePos();
  assert.ok(!world.solidAtWorld(eye.x, eye.y, eye.z), 'ojo fuera de sólidos');
  assert.ok(Math.abs(op.leanAllowed) < 0.9, 'asomado limitado por la pared: ' + op.leanAllowed.toFixed(2));
  // en espacio abierto el asomado es completo
  op.body.pos.x = 16; op.body.pos.z = 13;
  run(op, 0.5, { lean: 1 });
  assert.ok(op.leanAllowed > 0.95, 'asomado completo en abierto: ' + op.leanAllowed.toFixed(2));
  run(op, 0.1, { lean: 0 });
  op.alive = false;
});

test('la escalera principal sube a la planta alta', () => {
  const op = game.addOperator(new Operator('p5', { x: 21.1, y: 0, z: 7.6, yaw: Math.PI, loadout: ['ar'] }));
  run(op, 3.5, { moveZ: 1 });
  assert.ok(op.body.pos.y > 3.4, 'llega arriba: y=' + op.body.pos.y.toFixed(2) + ' z=' + op.body.pos.z.toFixed(2));
  op.intent.moveZ = 0;
  op.alive = false;
});

test('el cristal de una ventana se rompe entero', () => {
  // ventana del salón en la fachada sur (x=3, z=0)
  const vx = world.vx(3), vy = world.vy(1.6), vz = world.vz(-0.06);
  assert.equal(world.get(vx, vy, vz), MAT.GLASS);
  const op = new Operator('p6', { x: 3, y: 0, z: 3, yaw: 0, loadout: ['ar'] });
  const res = game.fireBullet(op, { x: 3, y: 1.6, z: 3 }, { x: 0, y: 0, z: -1 }, op.weapon);
  assert.ok(res.destroyed.filter((v) => v.mat === MAT.GLASS).length > 50, 'cristal roto');
  assert.equal(world.get(vx, vy, vz), MAT.AIR);
});

test('el mundo vuelve al estado original al reiniciar la ronda', () => {
  world.resetToPristine();
  assert.equal(world.get(world.vx(3), world.vy(1.6), world.vz(-0.06)), MAT.GLASS);
  assert.ok(SOLID[world.get(world.vx(3), world.vy(1.1), world.vz(13))], 'pared restaurada');
});

test('saltar obstáculo: vaultea un alféizar hacia fuera', () => {
  // ventana salón oeste en z=4: alféizar a 1.0 m. Romper cristal y saltar.
  const op = game.addOperator(new Operator('p7', { x: 0.7, y: 0, z: 4, yaw: Math.PI / 2, loadout: ['ar'] }));
  game.fireBullet(op, { x: 1, y: 1.6, z: 4 }, { x: -1, y: 0, z: 0 }, op.weapon);
  run(op, 0.2);
  op.intent.vault = true;
  run(op, 1.5);
  assert.ok(op.body.pos.x < -0.2, 'ha salido por la ventana: x=' + op.body.pos.x.toFixed(2));
  op.alive = false;
});

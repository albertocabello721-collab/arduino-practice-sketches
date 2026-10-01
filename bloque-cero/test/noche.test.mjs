// F10.4 · Bots de noche: de día nada cambia; de noche la calle está a oscuras (y bajo la farola y en
// las salas con lámparas no); a quien está a oscuras un bot lo ve a la mitad de distancia y tarda
// 100 ms más en reaccionar; un láser encendido o un fogonazo lo delatan; sus drones y cámaras, igual.
// (En partidas reales: tools/noche-bots.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { BotLight, DARK, rangeFor } from '../src/sim/light.js';
import { Game } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Perception } from '../src/sim/ai/perception.js';
import { DIFFICULTY } from '../src/sim/bots.js';
import { lineOfSight } from '../src/world/raycast.js';

const world = createVillaWorld();
const map = buildVilla(world);
const dia = BotLight.build(world, map, 'dia'), tarde = BotLight.build(world, map, 'atardecer'), noche = BotLight.build(world, map, 'noche');
// la calle, de oeste a este, con la casa al norte (las farolas están en x = −6, 20 y 44, a z = −6):
// un bot en x = −2 y el objetivo a `dist` m, lejos de las farolas
const Z = -13.5, X0 = -2;
const setup = (light, dist) => {
  const g = new Game({ world, map, seed: 1, light });
  const bot = g.addOperator(new Operator('bot', { name: 'BOT', team: 1, x: X0, y: 0, z: Z, yaw: -Math.PI / 2, loadout: ['ar', 'pistol'] }));
  const tgt = g.addOperator(new Operator('obj', { name: 'OBJ', team: 0, x: X0 + dist, y: 0, z: Z, yaw: Math.PI / 2, loadout: ['ar', 'pistol'] }));
  for (let i = 0; i < 10; i++) g.tick(1 / 60);
  tgt.weapon.equipT = 0;
  const per = new Perception(bot, g, DIFFICULTY.elite);
  const sees = () => { per.scanT = 0; per.scan(1 / 60, [tgt]); return per.visible.includes(tgt); };
  return { g, bot, tgt, per, sees };
};

test('de día no hay regla; de noche la calle está a oscuras, y la farola y todas las salas (con lámparas) no', () => {
  assert.equal(dia.active, false);
  assert.equal(tarde.active, true);
  assert.equal(noche.active, true);
  assert.ok(!dia.isDark(10, 1.2, -10), 'de día la calle no está a oscuras');
  assert.ok(noche.isDark(10, 1.2, -10) && noche.isDark(14, 1.2, 38), 'de noche la calle y el jardín están a oscuras');
  assert.ok(!noche.isDark(20, 1.2, -6.3), 'bajo la farola hay luz');
  assert.ok(!tarde.isDark(10, 1.2, -10), 'al atardecer la calle aún tiene luz');
  for (const r of map.rooms) {
    const b = r.bounds || r, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, cy = (b.y0 ?? r.y ?? 0) + 1.2;
    assert.ok(!noche.isDark(cx, cy, cz), `${r.name} a oscuras de noche (luz ${noche.at(cx, cy, cz).toFixed(2)})`);
  }
  assert.ok(DARK.rangeK === 0.5 && DARK.reactExtra === 0.1);
});

test('un bot Élite ve a 48 m de día y a 24 m a quien está a oscuras de noche', () => {
  const far = DIFFICULTY.elite.range - 4;          // 44 m: a la vista de día
  const D = setup(dia, far);
  assert.ok(lineOfSight(world, X0, 1.6, Z, X0 + far, 1.6, Z), 'la calle no está despejada');
  assert.ok(noche.isDark(X0 + far, 1, Z) && noche.isDark(X0 + 20, 1, Z), 'los puntos de la prueba no están a oscuras');
  assert.ok(D.sees(), 'de día no lo ve a 44 m');
  const N = setup(noche, far);
  assert.ok(!N.sees(), 'de noche lo ve a 44 m a oscuras');
  const near = setup(noche, DIFFICULTY.elite.range * DARK.rangeK - 4);     // 20 m
  assert.ok(near.sees(), 'de noche no lo ve a 22 m');
  assert.ok(near.per.darkSeen.has(near.tgt), 'no sabe que lo ve a oscuras');
  // en la calle de día, no es «a oscuras»
  assert.ok(!D.per.darkSeen.has(D.tgt));
});

test('el láser encendido y el fogonazo delatan a oscuras; con supresor, no', () => {
  const far = DIFFICULTY.elite.range - 4;
  const L = setup(noche, far);
  L.tgt.weapon.def = { ...L.tgt.weapon.def, laser: true };      // (el láser del arma, encendido)
  assert.equal(L.tgt.laserOn, true);
  assert.ok(L.sees(), 'el láser no delata');
  assert.ok(!L.per.darkSeen.has(L.tgt), 'con el láser cuenta como a oscuras');
  const F = setup(noche, far);
  F.tgt.lastShotT = F.g.time - 0.1; F.tgt.lastShotFlash = true;
  assert.ok(F.sees(), 'el fogonazo no delata');
  F.tgt.lastShotT = F.g.time - 0.5;
  assert.ok(!F.sees(), 'el fogonazo dura más de 0,3 s');
  const S = setup(noche, far);
  S.tgt.lastShotT = S.g.time - 0.1; S.tgt.lastShotFlash = false;      // con supresor
  assert.ok(!S.sees(), 'un disparo con supresor delata');
  // disparar de verdad deja el fogonazo (y con supresor, no)
  const R = setup(noche, 10);
  R.tgt.weapon.cooldown = 0; R.tgt._shoot(R.g, R.tgt.weapon);
  assert.ok(R.g.time - R.tgt.lastShotT < 1e-9 && R.tgt.lastShotFlash === true);
  R.tgt.weapon.def = { ...R.tgt.weapon.def, suppressed: true };
  R.tgt._shoot(R.g, R.tgt.weapon);
  assert.equal(R.tgt.lastShotFlash, false);
});

test('drones y cámaras: el mismo alcance (22 → 11 m) contra alguien a oscuras', () => {
  const N = setup(noche, 15), D = setup(dia, 15);
  assert.equal(rangeFor(N.g.light, N.tgt, N.g.time, 22), 11);
  assert.equal(rangeFor(D.g.light, D.tgt, D.g.time, 22), 22);
  assert.equal(rangeFor(null, D.tgt, 0, 22), 22);
  N.tgt.weapon.def = { ...N.tgt.weapon.def, laser: true };
  assert.equal(rangeFor(N.g.light, N.tgt, N.g.time, 22), 22);
  // bajo la farola, de noche, el alcance de día
  const F = setup(noche, 20);
  F.tgt.body.pos.x = 20; F.tgt.body.pos.z = -6.3;
  assert.equal(rangeFor(F.g.light, F.tgt, F.g.time, 22), 22);
});

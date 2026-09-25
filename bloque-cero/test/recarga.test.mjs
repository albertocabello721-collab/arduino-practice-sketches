// F7.1 · Recarga por partes: la munición cambia en su parte (el cargador sacado se pierde con
// sus balas y el nuevo cuenta al entrar), interrupciones, escopeta cartucho a cartucho que se
// interrumpe disparando, revólver con cargador rápido, AL-60 de 80 sin recámara, los avisos de
// cada parte y los bots, que recargan al 35 %.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { WEAPONS, WeaponState, reloadPlan } from '../src/sim/weapons.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';

const world = createVillaWorld();
const map = buildVilla(world);
function fresh(seed = 3) { world.resetToPristine(); return new Game({ world, map, seed }); }
const names = (plan) => plan.parts.map((p) => p.part);
// avanza la recarga hasta el segundo `t` desde que empezó
function upTo(w, t) { const el = w.reloadTotal - w.reloadT; if (t > el) w.tickReload(t - el); }

test('las partes de cada recarga y sus momentos', () => {
  const ar = reloadPlan(WEAPONS.ar, 12, 150);
  assert.deepEqual(names(ar), ['magOut', 'magIn', 'slap']);
  assert.equal(ar.total, 2.4);
  const are = reloadPlan(WEAPONS.ar, 0, 150);
  assert.deepEqual(names(are), ['magOut', 'magIn', 'slap', 'bolt'], 'vacía: además el cerrojo');
  assert.equal(are.total, 3.1);
  assert.deepEqual(names(reloadPlan(WEAPONS.pistol, 0, 60)), ['magOut', 'magIn', 'slap', 'bolt'], 'pistola vacía: suelta la corredera');
  assert.deepEqual(names(reloadPlan(WEAPONS.lmg, 20, 160)), ['open', 'magOut', 'magIn', 'belt', 'close']);
  assert.deepEqual(names(reloadPlan(WEAPONS.revolver, 2, 30)), ['open', 'eject', 'magIn', 'close']);
  const sg = reloadPlan(WEAPONS.shotgun, 3, 35);
  assert.deepEqual(names(sg), ['shell', 'shell', 'shell', 'shell']);
  assert.ok(Math.abs(sg.total - (0.3 + 4 * 0.55)) < 1e-9);
  assert.deepEqual(names(reloadPlan(WEAPONS.shotgun, 0, 35)).slice(-2), ['shell', 'pump'], 'escopeta vacía: bombea al final');
  // siempre en orden y dentro del tiempo
  for (const d of Object.values(WEAPONS)) for (const ammo of [0, 1]) {
    const p = reloadPlan(d, ammo, d.reserve);
    p.parts.forEach((x, i) => { assert.ok(x.at > 0 && x.at < p.total, `${d.id}: ${x.part} dentro`); if (i) assert.ok(x.at >= p.parts[i - 1].at, `${d.id}: en orden`); });
  }
});

test('táctica: el cargador sacado se pierde con sus balas; queda la de la recámara y el nuevo cuenta al entrar', () => {
  const w = new WeaponState(WEAPONS.ar);
  w.ammo = 12;
  assert.ok(w.startReload());
  const t = Object.fromEntries(w.plan.parts.map((p) => [p.part, p.at]));
  upTo(w, t.magOut - 0.01);
  assert.equal(w.ammo, 12, 'antes de sacarlo, nada cambia');
  upTo(w, t.magOut + 0.01);
  assert.equal(w.ammo, 1, 'fuera: la de la recámara');
  assert.equal(w.lost, 11, 'se pierden las 11 del cargador');
  assert.equal(w.reserve, 150);
  upTo(w, t.magIn + 0.01);
  assert.equal(w.ammo, 31);
  assert.equal(w.reserve, 120, 'el nuevo sale de la reserva');
  w.tickReload(5);
  assert.equal(w.reloadT, 0);
  assert.equal(w.ammo, 31);
  // vacía: 30, sin la de la recámara
  const e = new WeaponState(WEAPONS.ar);
  e.ammo = 0;
  e.startReload(); e.tickReload(e.reloadTotal);
  assert.equal(e.ammo, 30); assert.equal(e.lost, 0);
});

test('interrumpir: antes de sacarlo no pasa nada; entre medias, sin cargador; después, ya está', () => {
  const plan = reloadPlan(WEAPONS.ar, 12, 150);
  const t = Object.fromEntries(plan.parts.map((p) => [p.part, p.at]));
  const at = (x) => { const w = new WeaponState(WEAPONS.ar); w.ammo = 12; w.startReload(); upTo(w, x); w.cancelReload(); return w; };
  const a = at(t.magOut - 0.05);
  assert.deepEqual([a.ammo, a.reserve, a.magOut], [12, 150, false]);
  const b = at((t.magOut + t.magIn) / 2);
  assert.deepEqual([b.ammo, b.reserve, b.magOut], [1, 150, true], 'sin cargador: la de la recámara');
  // la siguiente recarga no saca otro cargador (no lo hay)
  assert.ok(b.startReload());
  assert.ok(!b.plan.parts.some((p) => p.part === 'magOut'));
  b.tickReload(b.reloadTotal);
  assert.deepEqual([b.ammo, b.reserve, b.magOut, b.lost], [31, 120, false, 11]);
  const c = at(t.magIn + 0.05);
  assert.deepEqual([c.ammo, c.reserve], [31, 120], 'metido: cuenta aunque no llegue al golpe');
});

test('AL-60: 80 sin bala en recámara; revólver: fuera casquillos y balas, cargador rápido de 6', () => {
  const l = new WeaponState(WEAPONS.lmg);
  assert.equal(l.capacity, 80);
  assert.equal(l.startReload(), false, 'llena con 80');
  l.ammo = 50;
  assert.ok(l.startReload());
  l.tickReload(l.reloadTotal);
  assert.deepEqual([l.ammo, l.reserve, l.lost], [80, 80, 50]);
  const r = new WeaponState(WEAPONS.revolver);
  r.ammo = 2; r.startReload();
  const t = Object.fromEntries(r.plan.parts.map((p) => [p.part, p.at]));
  upTo(r, t.eject + 0.01);
  assert.deepEqual([r.ammo, r.lost], [0, 2]);
  r.tickReload(r.reloadTotal);
  assert.deepEqual([r.ammo, r.reserve], [6, 24]);
});

test('escopeta: cada cartucho cuenta al entrar; disparar interrumpe la recarga y dispara con los metidos', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: Math.PI / 2, loadout: ['shotgun'] }));
  const w = a.weapon;
  for (let i = 0; i < 60; i++) game.tick();          // desenfundada
  w.ammo = 3;
  const parts = [], shots = [];
  game.on('reloadPart', (op, ww, p) => parts.push(p));
  game.on('shot', () => shots.push(game.time));
  a.intent.reload = true; game.tick();
  assert.ok(w.reloadT > 0, 'recargando');
  // dos cartuchos (a 0,6 y 1,15 s) y dispara a 1,3 s
  for (let i = 0; i < Math.round(1.3 / TICK); i++) game.tick();
  assert.deepEqual(parts, ['shell', 'shell']);
  assert.equal(w.ammo, 5);
  assert.equal(w.reserve, 33);
  a.intent.fire = true; game.tick(); a.intent.fire = false;   // un clic
  assert.equal(w.reloadT, 0, 'interrumpida');
  for (let i = 0; i < 20; i++) game.tick();
  assert.equal(shots.length, 1, 'dispara al volver a encararla (aunque ya soltó el gatillo)');
  assert.equal(w.ammo, 4);
  assert.deepEqual(parts, ['shell', 'shell'], 'no entran más cartuchos');
});

test('avisos de cada parte en orden, y ninguno tras interrumpir (cambiar de arma)', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: Math.PI / 2, loadout: ['ar', 'pistol'] }));
  for (let i = 0; i < 60; i++) game.tick();
  const parts = [];
  game.on('reloadPart', (op, ww, p) => parts.push(p + ':' + ww.def.id));
  a.weapon.ammo = 0;
  a.intent.reload = true;
  for (let i = 0; i < Math.round(3.2 / TICK); i++) game.tick();
  assert.deepEqual(parts, ['magOut:ar', 'magIn:ar', 'slap:ar', 'bolt:ar']);
  assert.equal(a.weapon.ammo, 30);
  parts.length = 0;
  a.weapon.ammo = 10;
  a.intent.reload = true; game.tick();
  for (let i = 0; i < Math.round(0.9 / TICK); i++) game.tick();   // ya fuera (0,6 s)
  a.intent.switchTo = 1; game.tick();
  for (let i = 0; i < Math.round(3 / TICK); i++) game.tick();
  assert.deepEqual(parts, ['magOut:ar'], 'solo lo que dio tiempo');
  assert.equal(a.weapons[0].ammo, 1, 'la principal se queda sin cargador');
  assert.equal(a.weapons[0].magOut, true);
});

test('los bots recargan con menos del 35 % del cargador (no a medio cargador)', () => {
  world.resetToPristine();
  const nav = navFor(world, map);
  const m = new Match({ world, map, seed: 4, rules: { selectTime: 0, prepTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  for (let i = 0; i < 600 && m.phase !== 'action'; i++) { bots.update(TICK); m.tick(TICK); }
  // un atacante recién salido: nadie a la vista ni oído
  const B = [...bots.brains.values()].find((b) => b.side === 'atk');
  const w = B.op.weapon;
  const tryAmmo = (n) => {
    w.cancelReload(); w.ammo = n;
    B.target = null;
    for (let i = 0; i < 30; i++) { bots.update(TICK); m.tick(TICK); if (w.reloadT > 0) return true; }
    return false;
  };
  assert.equal(tryAmmo(Math.ceil(w.def.mag * 0.4)), false, `con ${Math.ceil(w.def.mag * 0.4)} no recarga`);
  assert.equal(tryAmmo(Math.floor(w.def.mag * 0.3)), true, `con ${Math.floor(w.def.mag * 0.3)} sí`);
  bots.dispose();
});

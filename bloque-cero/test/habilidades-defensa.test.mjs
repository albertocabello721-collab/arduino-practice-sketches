// F6.5 · Habilidades de defensa con X. F6.5a: batería de VOLTIO e inhibidor de SILENCIO
// (sección 25: la batería destruye la carga térmica; la PEM la apaga; el inhibidor corta
// la señal de los drones y no deja detonar las cargas remotas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Gadgets, THERMAL, BATTERY, JAMMER, EMP, BREACH } from '../src/sim/gadgets.js';
import { Abilities } from '../src/sim/abilities.js';
import { Recon } from '../src/sim/recon.js';
import { Fortify, REINFORCE_TIME } from '../src/sim/fortify.js';
import { boxFree } from '../src/sim/physics.js';
import { MAT } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
function fresh(seed = 3) {
  world.resetToPristine();
  const game = new Game({ world, map, seed });
  const gadgets = new Gadgets(game);
  const abilities = new Abilities(game, gadgets);
  const fort = new Fortify(game);
  const recon = new Recon(game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  gadgets.recon = recon; gadgets.fort = fort;
  return { game, gadgets, abilities, fort, recon };
}
function step(c, s) {
  for (let i = 0; i < Math.round(s / TICK); i++) { c.game.tick(TICK); c.fort.tick(TICK); c.recon.tick(TICK); c.abilities.tick(TICK); c.gadgets.tick(TICK); }
}
const withAbility = (op, id, left) => { op.ability = { id, left }; return op; };
const pressX = (c, op) => { op.abilityCd = 0; op.intent.ability = true; step(c, TICK); };
function aim(op, p) {
  const e = op.eyePos(), dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

// Pared hall (z < 16) ↔ cocina (z > 16), tramo x ∈ [18, 19]: la defensa la refuerza desde la cocina.
function reinforced(c) {
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 18.5, y: 0, z: 16.8, yaw: 0, loadout: ['ar'] }));
  step(c, 0.1);
  d.intent.interact = true;
  step(c, REINFORCE_TIME + 0.2);
  d.intent.interact = false;
  assert.equal(c.fort.panels.length, 1, 'reforzada');
  return d;
}

test('batería: en un refuerzo destruye la carga térmica al colocarla; tras la PEM, la térmica abre el muro', () => {
  const c = fresh();
  const v = withAbility(reinforced(c), 'battery', 4);
  // VOLTIO mira el acero de su lado y pone la batería
  v.pitch = -0.1;
  pressX(c, v);
  assert.equal(v.channel && v.channel.what, 'battery', 'colocando');
  step(c, BATTERY.place + 0.1);
  const bat = c.gadgets.placed.find((p) => p.kind === 'battery');
  assert.ok(bat, 'batería puesta');
  assert.equal(bat.host.kind, 'reinforced');
  assert.equal(v.ability.left, 3);
  // TERMO desde el hall: la carga se destruye nada más colocarla
  const t = withAbility(c.game.addOperator(new Operator('t', { team: 0, x: 18.5, y: 0, z: 15.0, yaw: Math.PI, loadout: ['ar'] })), 'thermal', 2);
  step(c, 0.2);
  t.pitch = 0;
  const zaps = [];
  c.game.on('electrified', (o) => zaps.push(o.kind));
  pressX(c, t);
  step(c, THERMAL.place + 0.2);
  assert.deepEqual(zaps, ['thermal'], 'electrificada');
  assert.equal(c.gadgets.thermalOf(t), null, 'no queda carga');
  assert.equal(t.ability.left, 1, 'la carga se pierde');
  // CHISPA apaga la batería con una PEM (a través de la pared)
  c.gadgets.items.push({ id: 'e', kind: 'emp', owner: t, team: 0, pos: { x: 18.5, y: 0.1, z: 14.6 }, vel: { x: 0, y: 0, z: 0 }, t: EMP.fuse - 0.05, rest: true, alive: true, bounces: 0 });
  step(c, 0.1);
  assert.ok(c.gadgets.isOff(bat), 'batería apagada');
  pressX(c, t);
  step(c, THERMAL.place + 0.2);
  assert.ok(c.gadgets.thermalOf(t), 'ahora sí aguanta');
  pressX(c, t);
  step(c, THERMAL.fuse + 0.1);
  assert.ok(boxFree(world, 18.5, 0.02, 16.0, 0.3, 1.78), 'muro abierto');
});

test('batería en una barricada: destruye la carga de brecha y el dron que la tocan y electrocuta al que la toca', () => {
  const c = fresh();
  const o = map.windows.find((w) => w.axis === 'x' && w.y0 < 2);
  const inSide = -(o.out || 1);
  const floorY = Math.floor(o.y0 / 3.5) * 3.5, my = (o.y0 + o.y1) / 2;
  const cz = inSide < 0 ? o.line - 0.0625 : o.line + 0.0625;
  assert.equal(world.getWorld(o.center, my, cz), MAT.BARRICADE, 'hay barricada');
  // VOLTIO dentro, frente a la ventana
  const v = withAbility(c.game.addOperator(new Operator('v', { team: 1, x: o.center, y: floorY, z: o.line + inSide * 0.9, yaw: inSide < 0 ? Math.PI : 0, loadout: ['ar'] })), 'battery', 4);
  step(c, 0.2);
  aim(v, { x: o.center, y: my, z: cz });
  pressX(c, v);
  step(c, BATTERY.place + 0.1);
  const bat = c.gadgets.placed.find((p) => p.kind === 'battery');
  assert.ok(bat && bat.host.kind === 'barricade', 'batería en la barricada');
  v.body.pos.z = o.line + inSide * 3;   // (que no estorbe)
  // un atacante fuera rompe el cristal y pone una carga de brecha en la barricada
  for (let x = o.center - o.width / 2 + 0.06; x < o.center + o.width / 2; x += 0.125) for (let y = o.y0 + 0.06; y < o.y1; y += 0.125) {
    const z = o.line - inSide * 0.0625;
    if (world.getWorld(x, y, z) !== MAT.AIR && world.getWorld(x, y, z) !== MAT.BARRICADE) world.setRaw(world.vx(x), world.vy(y), world.vz(z), MAT.AIR);
  }
  const a = c.game.addOperator(new Operator('a', { team: 0, x: o.center, y: floorY, z: o.line - inSide * 0.9, yaw: inSide < 0 ? 0 : Math.PI, loadout: ['ar'] }));
  a.gadget = { id: 'breach', left: 2 };
  step(c, 0.2);
  aim(a, { x: o.center, y: my, z: o.line });
  const zaps = [];
  c.game.on('electrified', (x) => zaps.push(x.kind));
  a.intent.gadget = true;
  step(c, BREACH.place + 0.3);
  assert.deepEqual(zaps, ['breach'], 'la carga se quema');
  assert.equal(c.gadgets.placed.filter((p) => p.kind === 'breach').length, 0);
  // un dron que choca con ella
  const dr = c.recon.deployDrone(a, { thrown: false });
  dr.body.pos.x = o.center; dr.body.pos.y = my - 0.1; dr.body.pos.z = o.line - inSide * 0.2;
  step(c, 0.1);
  assert.ok(!dr.alive, 'dron frito');
  // la golpea: descarga
  const hp0 = a.hp;
  a.body.pos.z = o.line - inSide * 0.5;
  step(c, 0.1);
  aim(a, { x: o.center, y: my, z: cz });
  a.intent.melee = true; step(c, 0.2);
  assert.equal(hp0 - a.hp, BATTERY.dps, 'descarga al golpearla');
  // (el golpe rompe la barricada donde estaba la batería: cae; VOLTIO pone otra a un lado)
  step(c, 0.1);
  assert.ok(!bat.alive, 'sin su trozo de barricada, cae');
  v.body.pos.z = o.line + inSide * 0.9;
  step(c, 0.1);
  aim(v, { x: o.center + 0.6, y: my + 0.45, z: cz });
  pressX(c, v);
  step(c, BATTERY.place + 0.1);
  const bat2 = c.gadgets.placed.find((p) => p.kind === 'battery' && p.alive);
  assert.ok(bat2, 'otra batería');
  v.body.pos.z = o.line + inSide * 3;
  // la PEM la apaga: golpearla ya no da descarga
  c.gadgets.items.push({ id: 'e', kind: 'emp', owner: a, team: 0, pos: { x: o.center, y: floorY + 0.1, z: o.line - inSide * 1.0 }, vel: { x: 0, y: 0, z: 0 }, t: EMP.fuse - 0.05, rest: true, alive: true, bounces: 0 });
  step(c, 0.1);
  assert.ok(c.gadgets.isOff(bat2));
  a.body.pos.z = o.line - inSide * 0.5;
  step(c, 0.8);
  aim(a, { x: o.center + 0.6, y: my + 0.45, z: cz });
  const hp1 = a.hp;
  a.intent.melee = true; step(c, 0.2);
  assert.equal(a.hp, hp1, 'apagada, no electrocuta');
});

test('batería en un alambre: el atacante que lo cruza recibe daño; si el alambre se rompe, la batería cae', () => {
  const c = fresh();
  const v = withAbility(c.game.addOperator(new Operator('v', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'battery', 4);
  v.gadget = { id: 'barbed', left: 1 };
  step(c, 0.3);
  v.intent.gadget = true; step(c, 1.2);
  const wire = c.gadgets.placed.find((p) => p.kind === 'barbed');
  assert.ok(wire, 'alambre');
  aim(v, { x: wire.pos.x, y: wire.pos.y + 0.3, z: wire.pos.z });
  pressX(c, v);
  step(c, BATTERY.place + 0.1);
  const bat = c.gadgets.placed.find((p) => p.kind === 'battery');
  assert.ok(bat && bat.host.kind === 'wire', 'batería en el alambre');
  const a = c.game.addOperator(new Operator('a', { team: 0, x: wire.pos.x, y: 0, z: wire.pos.z, yaw: Math.PI, loadout: ['ar'] }));
  const hp0 = a.hp;
  step(c, 1.0);
  assert.ok(hp0 - a.hp >= 7.5, `electrocutado en el alambre (${(hp0 - a.hp).toFixed(1)})`);
  // el alambre se rompe (3 golpes): la batería cae
  c.game.destroyTarget(wire.target, a);
  step(c, TICK * 2);
  assert.ok(!bat.alive, 'sin alambre, sin batería');
});

test('inhibidor: a 2,5 m el dron pierde la señal y la carga de brecha no detona; destruido, todo vuelve', () => {
  const c = fresh();
  // SILENCIO pone un inhibidor en el suelo del hall
  const s = withAbility(c.game.addOperator(new Operator('s', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'jammer', 4);
  step(c, 0.3);
  s.pitch = -1.0;
  pressX(c, s);
  step(c, JAMMER.place + 0.1);
  const jam = c.gadgets.placed.find((p) => p.kind === 'jammer');
  assert.ok(jam, 'inhibidor puesto');
  assert.equal(s.ability.left, 3);
  s.body.pos.x = 21; s.body.pos.z = 9;
  // un dron dentro del radio no se mueve; fuera, sí
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 14, y: 0, z: 9, yaw: Math.PI, loadout: ['ar'] }));
  const near = c.recon.deployDrone(a, { thrown: false });
  const far = c.recon.deployDrone(a, { thrown: false });
  near.body.pos.x = jam.pos.x + 1.0; near.body.pos.y = 0.02; near.body.pos.z = jam.pos.z; near.yaw = Math.PI;
  far.body.pos.x = 13; far.body.pos.y = 0.02; far.body.pos.z = 8; far.yaw = Math.PI;
  step(c, 0.2);
  const n0 = { ...near.body.pos }, f0 = { ...far.body.pos };
  for (let i = 0; i < 60; i++) { near.intent.moveZ = 1; far.intent.moveZ = 1; step(c, TICK); }
  assert.ok(near.jammed, 'sin señal');
  assert.ok(Math.hypot(near.body.pos.x - n0.x, near.body.pos.z - n0.z) < 0.05, 'no se mueve');
  assert.ok(Math.hypot(far.body.pos.x - f0.x, far.body.pos.z - f0.z) > 1.5, 'el otro sí');
  // carga de brecha junto al inhibidor (en la pared del hall más cercana): no detona
  const b = c.game.addOperator(new Operator('b', { team: 0, x: jam.pos.x, y: 0, z: jam.pos.z, yaw: 0, loadout: ['ar'] }));
  b.gadget = { id: 'breach', left: 2 };
  // (a mano: una carga ya colocada a 1,5 m del inhibidor)
  const ch = { id: 'bc', kind: 'breach', owner: b, team: 0, pos: { x: jam.pos.x, y: 1.2, z: jam.pos.z - 1.5 }, normal: { x: 0, y: 0, z: 1 }, axis: 2, alive: true, t0: c.game.time };
  c.gadgets.placed.push(ch);
  const jammed = [];
  c.game.on('gadgetJammed', (it) => jammed.push(it.kind));
  c.gadgets.detonate(ch);
  assert.deepEqual(jammed, ['breach'], 'inhibida');
  assert.ok(ch.alive, 'sigue ahí');
  // un disparo destruye el inhibidor: la carga detona y el dron vuelve a moverse
  c.game.destroyTarget(jam.target, a);
  step(c, TICK);
  const booms = [];
  c.game.on('explosion', (k) => booms.push(k));
  c.gadgets.detonate(ch);
  assert.deepEqual(booms, ['breach']);
  const n1 = { ...near.body.pos };
  for (let i = 0; i < 30; i++) { near.intent.moveZ = 1; step(c, TICK); }
  assert.ok(!near.jammed && Math.hypot(near.body.pos.x - n1.x, near.body.pos.z - n1.z) > 0.5, 'con señal otra vez');
});

test('inhibidor: el dron de choque no dispara dentro; la PEM apaga el inhibidor 15 s', () => {
  const c = fresh();
  const s = withAbility(c.game.addOperator(new Operator('s', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'jammer', 4);
  s.gadget = { id: 'alarm', left: 1 };
  step(c, 0.3);
  s.pitch = -1.0;
  pressX(c, s);
  step(c, JAMMER.place + 0.1);
  const jam = c.gadgets.placed.find((p) => p.kind === 'jammer');
  // una alarma a su lado
  s.yaw = Math.PI / 2; s.pitch = -1.0;
  s.intent.gadget = true; step(c, 1.2);
  const al = c.gadgets.placed.find((p) => p.kind === 'alarm');
  assert.ok(jam && al);
  const p = withAbility(c.game.addOperator(new Operator('p', { team: 0, x: 14, y: 0, z: 9, yaw: Math.PI, loadout: ['ar'] })), 'shockdrone', 6);
  const dr = c.recon.deployDrone(p, { thrown: false });
  dr.body.pos.x = jam.pos.x + 1.5; dr.body.pos.y = 0.02; dr.body.pos.z = jam.pos.z + 1.0;
  const e = dr.eyePos(), q = al.target.center();
  dr.yaw = Math.atan2(-(q.x - e.x), -(q.z - e.z)); dr.pitch = Math.atan2(q.y - e.y, Math.hypot(q.x - e.x, q.z - e.z));
  const denied = [];
  c.game.on('abilityDenied', (op, w) => denied.push(w));
  dr.intent.zap = true; step(c, TICK);
  assert.ok(al.alive && p.ability.left === 6, 'sin señal no dispara');
  assert.ok(/señal/i.test(denied[0] || ''), denied[0]);
  // PEM sobre el inhibidor: 15 s sin inhibir
  c.gadgets.items.push({ id: 'e', kind: 'emp', owner: p, team: 0, pos: { ...jam.pos }, vel: { x: 0, y: 0, z: 0 }, t: EMP.fuse - 0.05, rest: true, alive: true, bounces: 0 });
  step(c, 0.6);
  assert.ok(c.gadgets.isOff(jam));
  dr.intent.zap = true; step(c, TICK);
  assert.ok(!al.alive, 'con el inhibidor apagado, el rayo funciona');
});

// ---------------------------------------------------------------- F6.5b: mina láser, cámara adhesiva, interceptor
import { LMINE, INTERCEPTOR, FRAG } from '../src/sim/gadgets.js';

test('mina láser: en la puerta hall ↔ cocina; el atacante que la cruza recibe 60 y la defensa lo ve marcado', () => {
  const c = fresh();
  // CEPO en el hall mirando la puerta (x de 15,5 a 16,5, pared z = 16)
  const k = withAbility(c.game.addOperator(new Operator('k', { team: 1, x: 16, y: 0, z: 14.6, yaw: Math.PI, loadout: ['ar'] })), 'lasermine', 5);
  step(c, 0.2);
  aim(k, { x: 15.6, y: 0.6, z: 16 });
  pressX(c, k);
  assert.equal(k.channel && k.channel.what, 'lasermine');
  step(c, LMINE.place + 0.1);
  const mine = c.gadgets.placed.find((p) => p.kind === 'lasermine');
  assert.ok(mine, 'mina puesta');
  assert.ok(Math.abs(mine.a.y - 0.35) < 0.01 && Math.abs(mine.b.x - mine.a.x) > 0.8, 'el láser cruza la puerta a 0,35 m');
  k.body.pos.x = 20; k.body.pos.z = 10;
  // un atacante viene de la cocina hacia el hall
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 16, y: 0, z: 17.6, yaw: 0, loadout: ['ar'] }));
  const alerts = [];
  c.game.on('mineAlert', (m, op) => alerts.push(op));
  step(c, 0.2);
  const hp0 = a.hp;
  for (let i = 0; i < 90 && mine.alive; i++) { a.intent.moveZ = 1; step(c, TICK); }
  a.intent.moveZ = 0;
  assert.ok(!mine.alive, 'saltó');
  assert.equal(hp0 - a.hp, LMINE.damage, '60 de daño');
  assert.deepEqual(alerts, [a], 'aviso a la defensa');
  assert.ok(c.recon.isSpottedFor(a, 1), 'marcado');
});

test('mina láser: apagada por la PEM no salta; un disparo la quita', () => {
  const c = fresh();
  const k = withAbility(c.game.addOperator(new Operator('k', { team: 1, x: 16, y: 0, z: 14.6, yaw: Math.PI, loadout: ['ar'] })), 'lasermine', 5);
  step(c, 0.2);
  aim(k, { x: 16.4, y: 0.6, z: 16 });
  pressX(c, k);
  step(c, LMINE.place + 0.1);
  const mine = c.gadgets.placed.find((p) => p.kind === 'lasermine');
  k.body.pos.x = 20; k.body.pos.z = 10;
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 16, y: 0, z: 17.6, yaw: 0, loadout: ['ar'] }));
  c.gadgets.items.push({ id: 'e', kind: 'emp', owner: a, team: 0, pos: { x: 16, y: 0.1, z: 17 }, vel: { x: 0, y: 0, z: 0 }, t: EMP.fuse - 0.05, rest: true, alive: true, bounces: 0 });
  step(c, 0.1);
  assert.ok(c.gadgets.isOff(mine), 'apagada');
  const hp0 = a.hp;
  for (let i = 0; i < 70; i++) { a.intent.moveZ = 1; step(c, TICK); }
  a.intent.moveZ = 0;
  assert.ok(a.body.pos.z < 15.5, 'la cruzó');
  assert.ok(mine.alive && a.hp === hp0, 'no saltó');
  c.game.destroyTarget(mine.target, a);
  step(c, TICK);
  assert.ok(!mine.alive, 'un disparo la quita');
});

test('cámara adhesiva: se lanza, se pega en la pared y se suma a las cámaras de la defensa', () => {
  const c = fresh();
  const n0 = c.recon.cams.length;
  const o = withAbility(c.game.addOperator(new Operator('o', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'stickycam', 3);
  step(c, 0.2);
  o.pitch = 0;
  pressX(c, o);
  assert.equal(o.ability.left, 2);
  step(c, 1.5);
  assert.equal(c.recon.cams.length, n0 + 1, 'una cámara más');
  const cam = c.recon.cams[c.recon.cams.length - 1];
  assert.ok(cam.sticky && cam.team === 1, 'adhesiva, de la defensa');
  assert.ok(Math.abs(cam.pos.z - 7.1) < 0.2, `en la pared norte del hall (${cam.pos.z.toFixed(2)})`);
  // ve el hall: marca a un atacante delante
  const v = cam.viewDir();
  const a = c.game.addOperator(new Operator('a', { team: 0, x: cam.pos.x + v.x * 3, y: 0, z: cam.pos.z + v.z * 3, yaw: 0, loadout: ['ar'] }));
  step(c, 0.2);
  assert.equal(c.recon.mark(cam, 1), a, 'lo marca');
  // un disparo la destruye
  const e = a.eyePos(), q = cam.center(), L = Math.hypot(q.x - e.x, q.y - e.y, q.z - e.z);
  c.game.fireBullet(a, e, { x: (q.x - e.x) / L, y: (q.y - e.y) / L, z: (q.z - e.z) / L }, a.weapon);
  assert.ok(!cam.alive, 'destruida de un disparo');
});

test('interceptor: destruye 2 granadas en el aire; la tercera explota; recupera 1 a los 20 s', () => {
  const c = fresh();
  const gu = withAbility(c.game.addOperator(new Operator('g', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'interceptor', 2);
  step(c, 0.2);
  gu.pitch = -1.0;
  pressX(c, gu);
  step(c, INTERCEPTOR.place + 0.1);
  const ic = c.gadgets.placed.find((p) => p.kind === 'interceptor');
  assert.ok(ic && ic.charges === 2, 'interceptor con 2 cargas');
  gu.body.pos.x = 21; gu.body.pos.z = 9;
  // un atacante al fondo del hall lanza granadas hacia él
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: 15.6, yaw: 0, loadout: ['ar'] }));
  a.gadget = { id: 'frag', left: 3 };
  const cut = [], booms = [];
  c.game.on('intercepted', (x, from, p, kind) => cut.push(kind));
  c.game.on('explosion', (k) => booms.push(k));
  step(c, 0.2);
  a.pitch = 0.1;
  for (let i = 0; i < 3; i++) { a.gadgetCd = 0; a.intent.gadget = true; step(c, 0.4); }
  step(c, FRAG.fuse + 0.2);
  assert.deepEqual(cut, ['frag', 'frag'], 'dos interceptadas');
  assert.ok(booms.includes('frag'), 'la tercera explota');
  if (ic.alive) {
    assert.equal(ic.charges, 0);
    step(c, INTERCEPTOR.recharge + 0.1);
    assert.equal(ic.charges, 1, 'recarga una a los 20 s');
  }
});

// ---------------------------------------------------------------- F6.5c: placas, estimulantes, gas
import { PLATES, GAS } from '../src/sim/gadgets.js';
import { STIM } from '../src/sim/abilities.js';

test('placas: CORAZA deja la bolsa; cada defensor coge una (+20) y un disparo mortal al cuerpo lo deja derribado', () => {
  const c = fresh();
  const k = withAbility(c.game.addOperator(new Operator('k', { team: 1, x: 17, y: 0, z: 13, yaw: 0, armor: 3, loadout: ['ar'] })), 'plates', 5);
  const d1 = c.game.addOperator(new Operator('d1', { team: 1, x: 19, y: 0, z: 13, yaw: 0, loadout: ['ar'] }));
  const d2 = c.game.addOperator(new Operator('d2', { team: 1, x: 20, y: 0, z: 14, yaw: 0, loadout: ['ar'] }));
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: 8, yaw: Math.PI, loadout: ['ar'] }));
  step(c, 0.2);
  pressX(c, k);
  const bag = c.gadgets.placed.find((p) => p.kind === 'platebag');
  assert.ok(bag, 'bolsa en el suelo');
  // CORAZA está encima: coge la suya enseguida (quedan 4 de 5)
  step(c, 0.1);
  assert.ok(k.plate && bag.plates === 4 && k.ability.left === 4, 'CORAZA coge una');
  assert.equal(k.hp, k.maxHp + PLATES.hp, '+20');
  // otra X: la bolsa ya está
  const why = [];
  c.game.on('abilityDenied', (op, w) => why.push(w));
  pressX(c, k);
  assert.ok(/bolsa/i.test(why[0] || ''), why[0]);
  // d1 pasa por encima
  d1.body.pos.x = bag.pos.x + 0.5; d1.body.pos.z = bag.pos.z;
  step(c, 0.1);
  assert.ok(d1.plate && bag.plates === 3, 'd1 coge otra');
  // un disparo mortal al cuerpo: derribado, no muerto; la placa se gasta
  c.game.damage(d1, 500, { by: a, zone: 'body' });
  assert.equal(d1.state, 'downed', 'derribado');
  assert.ok(!d1.plate, 'placa gastada');
  // la misma persona no coge otra
  d1.revive(); step(c, 0.2);
  assert.ok(!d1.plate && bag.plates === 3, 'una por cabeza');
  // con placa, un tiro a la cabeza mata igual
  d2.body.pos.x = bag.pos.x - 0.4; d2.body.pos.z = bag.pos.z;
  step(c, 0.1);
  assert.ok(d2.plate);
  c.game.damage(d2, 60, { by: a, zone: 'head' });
  assert.equal(d2.state, 'dead', 'a la cabeza, muerto');
  // un disparo destruye la bolsa
  c.game.destroyTarget(bag.target, a);
  step(c, TICK);
  assert.ok(!bag.alive, 'bolsa destruida');
});

test('estimulantes: +40 hasta 140 a un aliado; a un derribado lo levanta a 10 m; sin aliado, a sí mismo; el exceso baja', () => {
  const c = fresh();
  // (en el pasillo del sótano: largo y despejado)
  const r = withAbility(c.game.addOperator(new Operator('r', { team: 1, x: 27, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] })), 'stim', 3);
  const ally = c.game.addOperator(new Operator('m', { team: 1, x: 22, y: -3.5, z: 11, yaw: -Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.2);
  aim(r, ally.center());
  pressX(c, r);
  assert.equal(r.ability.left, 2);
  assert.ok(Math.abs(ally.hp - Math.min(STIM.max, ally.maxHp + STIM.heal)) < 0.1, `+40 (hasta 140): ${ally.hp.toFixed(2)}`);
  // el exceso baja 1 por segundo
  step(c, 5);
  assert.ok(Math.abs(ally.hp - (Math.min(STIM.max, ally.maxHp + STIM.heal) - 5)) < 0.2, `baja (${ally.hp.toFixed(1)})`);
  // derribado a 10 m: lo levanta
  ally.body.pos.x = 17;
  c.game.damage(ally, ally.hp + 5, { zone: 'body' });
  assert.equal(ally.state, 'downed');
  step(c, 0.8);
  aim(r, ally.center());
  const revived = [];
  c.game.on('revived', (t, by) => revived.push([t, by]));
  pressX(c, r);
  assert.equal(ally.state, 'alive', 'levantado a distancia');
  assert.ok(Math.abs(ally.hp - STIM.revive) < 0.1);
  assert.deepEqual(revived, [[ally, r]]);
  // sin nadie delante: a sí mismo
  r.hp = 50;
  r.yaw += Math.PI;
  step(c, 1.1);
  pressX(c, r);
  assert.ok(Math.abs(r.hp - 90) < 0.1, 'a sí mismo');
  assert.equal(r.ability.left, 0);
});

test('gas: X lanza botes; mantener X los activa; 12 por segundo al atacante; un bote disparado antes no se activa', () => {
  const c = fresh();
  const t = withAbility(c.game.addOperator(new Operator('t', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'gas', 3);
  const a = c.game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: 9.5, yaw: Math.PI, loadout: ['ar'] }));
  step(c, 0.2);
  t.pitch = -1.0;
  pressX(c, t);                                   // bote 1
  step(c, 1.6);
  t.yaw = 0.6;
  pressX(c, t);                                   // bote 2
  step(c, 1.6);
  const cans = c.gadgets.items.filter((i) => i.kind === 'gas');
  assert.equal(cans.length, 2);
  assert.ok(cans.every((i) => i.rest && i.target), 'en el suelo, se pueden disparar');
  assert.equal(c.gadgets.gasClouds.length, 0, 'aún sin activar');
  // el bote 2, disparado: fuera
  c.game.destroyTarget(cans[1].target, a);
  step(c, TICK);
  assert.ok(!cans[1].alive);
  // mantener X: se activa el que queda
  t.intent.ability = true; t.intent.abilityHeld = true;
  step(c, TICK);
  assert.equal(t.ability.left, 0, 'el tercero sale al pulsar');
  step(c, GAS.hold + 0.1);
  t.intent.abilityHeld = false;
  assert.equal(c.gadgets.gasClouds.length, 1, 'nube de gas (el disparado no cuenta)');
  const cl = c.gadgets.gasClouds[0];
  // el atacante, dentro de la nube: 12 por segundo
  a.body.pos.x = cl.x; a.body.pos.z = cl.z;
  step(c, GAS.grow);
  const hp0 = a.hp;
  step(c, 1.0);
  assert.ok(hp0 - a.hp >= 11 && hp0 - a.hp <= 13, `12 por segundo (${(hp0 - a.hp).toFixed(1)})`);
  assert.equal(t.hp, t.maxHp, 'a la defensa no le hace nada');
  assert.ok(c.gadgets.smokeBlocks({ x: cl.x - 4, y: cl.y, z: cl.z }, { x: cl.x + 4, y: cl.y, z: cl.z }), 'tapa la vista');
});

// Fase 4: preparación. Refuerzos (paredes y trampillas), barricadas, cuerpo a cuerpo,
// drones (conducir, saltar, localizar el objetivo, marcar) y cámaras de seguridad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK, MELEE_DAMAGE } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Fortify, REINFORCE_TIME, BARRICADE_TIME } from '../src/sim/fortify.js';
import { Recon, DRONE } from '../src/sim/recon.js';
import { MAT, SOLID } from '../src/world/materials.js';
import { breachRect, explodeSphere } from '../src/world/destruction.js';
import { boxFree } from '../src/sim/physics.js';
import { lineOfSight } from '../src/world/raycast.js';
import { Match } from '../src/sim/match.js';
import { BotSquad } from '../src/sim/bots.js';

const world = createVillaWorld();
const map = buildVilla(world);

function fresh() {
  world.resetToPristine();
  const game = new Game({ world, map, seed: 9 });
  const fort = new Fortify(game);
  const recon = new Recon(game, { cameras: map.cameras });
  return { game, fort, recon };
}
const run = (game, fort, recon, s) => { for (let i = 0; i < Math.round(s / TICK); i++) { game.tick(); fort.tick(TICK); if (recon) recon.tick(TICK); } };
const mat = (x, y, z) => world.getWorld(x, y, z);
function aim(op, p) {
  const e = op.eyePos();
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

// Pared hall (z<16) ↔ cocina (z>16), tramo x∈[18,19] sin huecos.
test('reforzar: 4 s con F convierten la media pared del defensor en acero', () => {
  const { game, fort } = fresh();
  const d = game.addOperator(new Operator('d', { team: 1, x: 18.5, y: 0, z: 16.8, yaw: 0 }));
  run(game, fort, null, 0.1);
  const tgt = fort.targetFor(d);
  assert.ok(tgt && tgt.kind === 'wall' && tgt.valid, JSON.stringify(tgt && { k: tgt.kind, v: tgt.valid, r: tgt.reason }));
  assert.equal(tgt.panel.line, 16);
  assert.equal(tgt.panel.u0, 18);
  d.intent.interact = true;
  run(game, fort, null, REINFORCE_TIME - 0.3);
  assert.equal(mat(18.5, 1.2, 16.06), MAT.DRYWALL_CREAM, 'aún sin reforzar');
  assert.equal(d.channel && d.channel.kind, 'reinforce');
  run(game, fort, null, 0.5);
  assert.equal(mat(18.5, 1.2, 16.06), MAT.REINFORCED, 'capa de la cocina reforzada');
  assert.equal(mat(18.5, 3.1, 16.06), MAT.REINFORCED, 'hasta el techo');
  assert.equal(mat(18.5, 0.06, 16.06), MAT.REINFORCED, 'desde el suelo');
  assert.notEqual(mat(18.5, 1.2, 15.94), MAT.REINFORCED, 'la capa del hall sigue siendo blanda');
  assert.equal(fort.remaining(d), 1);
  assert.equal(fort.panels.length, 1);
});

test('el refuerzo para balas, cargas normales y golpes; el tramo de al lado no', () => {
  const { game, fort } = fresh();
  fort.applyWall({ kind: 'wall', axisN: 2, line: 16, side: 1, u0: 18, u1: 19, y0: 0, y1: 3.25 });
  const a = game.addOperator(new Operator('a', { team: 0, x: 18.5, y: 0, z: 13.5, yaw: Math.PI, loadout: ['ar2'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 18.5, y: 0, z: 17.3, yaw: 0, armor: 3 }));
  game.tick();
  aim(a, { x: 18.5, y: 1.2, z: 17.3 });
  for (let i = 0; i < 6; i++) game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon);
  assert.equal(t.hp, t.maxHp, 'nadie herido detrás del acero');
  // la capa blanda del hall se agujerea; el acero no
  assert.equal(mat(18.5, 1.2, 16.06), MAT.REINFORCED);
  // carga de brecha normal desde el hall
  breachRect(world, 18.5, 1.15, 15.9, 2, 1.0, 2.2, 0.6);
  assert.equal(mat(18.5, 1.0, 16.06), MAT.REINFORCED, 'la carga no rompe el refuerzo');
  assert.ok(!boxFree(world, 18.5, 0.02, 16.0, 0.3, 1.2), 'no se puede pasar');
  // golpe cuerpo a cuerpo
  a.body.pos.z = 15.3; a.yaw = Math.PI; a.pitch = 0; game.tick();
  game.melee(a);
  assert.equal(mat(18.5, 1.6, 16.06), MAT.REINFORCED, 'el golpe no rompe el acero');
  // tramo sin reforzar (x∈[20,21]): la bala atraviesa y hiere
  t.body.pos.x = 20.5; a.body.pos.x = 20.5; a.body.pos.z = 13.5; game.tick();
  aim(a, { x: 20.5, y: 1.2, z: 17.3 });
  for (let i = 0; i < 4 && t.hp === t.maxHp; i++) { a.weapon.cooldown = 0; game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon); }
  assert.ok(t.hp < t.maxHp, 'sin refuerzo la pared de pladur no protege');
});

test('refuerzos limitados a 2 por defensor; puertas y paredes de ladrillo no se refuerzan', () => {
  const { game, fort } = fresh();
  const d = game.addOperator(new Operator('d', { team: 1, x: 18.5, y: 0, z: 16.8, yaw: 0 }));
  game.tick();
  d.intent.interact = true;
  run(game, fort, null, REINFORCE_TIME + 0.2);
  d.intent.interact = false; game.tick(); fort.tick(TICK);
  d.body.pos.x = 21.5; game.tick();
  d.intent.interact = true;
  run(game, fort, null, REINFORCE_TIME + 0.2);
  assert.equal(fort.remaining(d), 0);
  d.intent.interact = false; game.tick(); fort.tick(TICK);
  d.body.pos.x = 13.5; game.tick();
  d.intent.interact = true;
  run(game, fort, null, REINFORCE_TIME + 0.2);
  assert.notEqual(mat(13.5, 1.2, 16.06), MAT.REINFORCED, 'sin refuerzos no hay tercer panel');
  assert.equal(fort.panels.length, 2);
  // la puerta hall↔cocina (x=16) no es reforzable
  d.body.pos.x = 16.2; game.tick();
  const tgt = fort.targetFor(d, d.eyePos(), { x: 0.05, y: -0.1, z: -1 });
  assert.ok(!tgt || tgt.kind !== 'wall' || !tgt.valid, 'no se refuerza una puerta');
  // fachada de ladrillo del salón (z=0): no
  const e = new Operator('e', { team: 1, x: 6, y: 0, z: 1.0, yaw: 0 });
  game.addOperator(e); game.tick();
  const t2 = fort.targetFor(e);
  assert.ok(t2 && t2.kind === 'wall' && !t2.valid, 'el ladrillo ya resiste: ' + (t2 && t2.reason));
});

test('trampilla: se refuerza desde arriba y aguanta explosiones; sin reforzar cae', () => {
  const { game, fort } = fresh();
  const h = map.hatches.find((q) => q.name === 'Trampilla de la cocina');
  const d = game.addOperator(new Operator('d', { team: 1, x: h.x, y: h.y, z: h.z + 0.2, yaw: 0 }));
  game.tick();
  d.pitch = -1.45;
  const tgt = fort.targetFor(d);
  assert.ok(tgt && tgt.kind === 'hatch' && tgt.valid, JSON.stringify(tgt && { k: tgt.kind, r: tgt.reason }));
  d.intent.interact = true;
  run(game, fort, null, REINFORCE_TIME + 0.2);
  assert.equal(mat(h.x, h.y - 0.06, h.z), MAT.REINFORCED);
  explodeSphere(world, h.x, h.y - 0.6, h.z, 1.0);
  assert.equal(mat(h.x, h.y - 0.06, h.z), MAT.REINFORCED, 'la explosión desde abajo no la abre');
  // otra trampilla sin reforzar sí cae
  const h2 = map.hatches.find((q) => q.name === 'Trampilla del salón');
  explodeSphere(world, h2.x, h2.y - 0.6, h2.z, 1.0);
  assert.equal(mat(h2.x, h2.y - 0.06, h2.z), MAT.AIR);
});

test('barricada: 1,5 s con F; bloquea el paso y la vista hasta que se rompe', () => {
  const { game, fort } = fresh();
  // puerta hall↔cocina en x=16, z=16 (pared a z=16)
  const d = game.addOperator(new Operator('d', { team: 1, x: 16, y: 0, z: 17.1, yaw: 0 }));
  game.tick();
  d.pitch = -0.25;
  const tgt = fort.targetFor(d);
  assert.ok(tgt && tgt.kind === 'barricade' && tgt.valid, JSON.stringify(tgt && { k: tgt.kind, r: tgt.reason }));
  d.intent.interact = true;
  run(game, fort, null, BARRICADE_TIME + 0.2);
  assert.equal(fort.barricades.length, 1);
  assert.equal(mat(16, 1.0, 16.06), MAT.BARRICADE);
  assert.ok(!boxFree(world, 16, 0.02, 16, 0.3, 1.2), 'no se puede cruzar');
  assert.ok(!lineOfSight(world, 16, 1.5, 14.5, 16, 1.5, 17.5), 'no se ve a través');
  // las balas la agujerean
  const a = game.addOperator(new Operator('a', { team: 0, x: 16, y: 0, z: 13.8, yaw: Math.PI, loadout: ['ar'] }));
  game.tick();
  aim(a, { x: 16.1, y: 1.4, z: 16.06 });
  const r = game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon);
  assert.ok(r.destroyed.some((v) => v.mat === MAT.BARRICADE), 'agujero de bala en la madera');
  // a golpes se abre un hueco para pasar agachado
  a.body.pos.z = 15.3; d.body.pos.x = 20; game.tick();   // (el defensor se aparta: si no, el golpe le daría a él)
  for (const p of [-0.1, -0.6, -1.0]) { a.pitch = p; a.yaw = Math.PI; a.meleeT = 0; game.melee(a); }
  // tres golpes: se pasa agachado (lo que quede abajo se salta como un escalón)
  assert.ok(boxFree(world, 16, 0.3, 16.0, 0.28, 1.2), 'hueco abierto a golpes');
});

test('cuerpo a cuerpo: daña a un enemigo delante y rompe pladur', () => {
  const { game } = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: 0 }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 6, y: 0, z: 4.9, yaw: Math.PI, armor: 3 }));
  game.tick();
  a.intent.melee = true;
  game.tick();
  assert.equal(t.hp, t.maxHp - MELEE_DAMAGE);
  // pared del hall ↔ pasillo (x=22), desde el hall
  const b = game.addOperator(new Operator('b', { team: 0, x: 21.2, y: 0, z: 12, yaw: -Math.PI / 2 }));
  game.tick();
  let broke = 0;
  game.on('voxels', (list, cause) => { if (cause === 'melee') broke += list.length; });
  b.intent.melee = true; game.tick();
  assert.ok(broke > 10, 'rompe un trozo de pared: ' + broke);
});

test('dron: conduce a 3,5 m/s, no sube escalones de 25 cm sin saltar y cabe por huecos bajos', () => {
  const { game, recon } = fresh();
  const owner = game.addOperator(new Operator('o', { team: 0, x: 15.5, y: 0.125, z: -7, yaw: Math.PI }));
  recon.reset({ defTeam: 1, site: map.sites[1] });
  const d = recon.deployDrone(owner, { thrown: false });
  assert.ok(d);
  for (let i = 0; i < 30; i++) recon.tick(TICK);
  const z0 = d.body.pos.z;
  d.intent.moveZ = 1;
  for (let i = 0; i < 60; i++) recon.tick(TICK);
  assert.ok(d.body.pos.z - z0 > 2.6 && d.body.pos.z - z0 < 3.8, 'avance en 1 s: ' + (d.body.pos.z - z0).toFixed(2));
  // escalón de 0,25 m: la escalera principal del hall (peldaños de 25 cm)
  d.body.pos.x = 21.1; d.body.pos.y = 0.02; d.body.pos.z = 7.4; d.yaw = Math.PI; d.body.vel.x = d.body.vel.y = d.body.vel.z = 0;
  for (let i = 0; i < 60; i++) recon.tick(TICK);
  assert.ok(d.body.pos.y < 0.2, 'no sube el peldaño: y=' + d.body.pos.y.toFixed(2));
  d.intent.jump = true;
  for (let i = 0; i < 40; i++) recon.tick(TICK);
  assert.ok(d.body.pos.y > 0.2, 'saltando sí: y=' + d.body.pos.y.toFixed(2));
  // cabe por un agujero de 30 × 25 cm en una pared
  breachRect(world, 3.9, -3.35, 13, 2, 0.4, 0.3, 0.5, { cleanBottom: true, jag: 0 });
  const hole = boxFree(world, 3.9, -3.49, 13, DRONE.radius, DRONE.height);
  assert.ok(hole, 'el dron cabe por el hueco');
  assert.ok(!boxFree(world, 3.9, -3.49, 13, 0.3, 1.2), 'una persona no');
});

test('dron: localiza el objetivo al verlo, marca enemigos y cae de un disparo', () => {
  const { game, recon } = fresh();
  const owner = game.addOperator(new Operator('o', { team: 0, x: 16, y: 0, z: 10, yaw: Math.PI }));
  const def = game.addOperator(new Operator('d', { team: 1, x: 20, y: 0, z: 21, yaw: 0, loadout: ['smg'] }));
  recon.reset({ defTeam: 1, site: map.sites[1] });   // planta baja: cocina (A) / comedor (B)
  const d = recon.deployDrone(owner, { thrown: false });
  d.body.pos.x = 16; d.body.pos.y = 0.02; d.body.pos.z = 16.6; d.yaw = Math.PI;
  let found = null;
  game.on('objectiveFound', (who, k) => { found = k; });
  for (let i = 0; i < 20; i++) { game.tick(); recon.tick(TICK); }
  assert.ok(recon.objectiveFound, 'objetivo localizado');
  assert.ok(found === 'A' || found === 'B');
  // marcar al defensor que tiene delante
  const e = d.eyePos(), c = def.center();
  d.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z));
  d.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  d.intent.mark = true;
  recon.tick(TICK);
  assert.ok(recon.isSpottedFor(def, 0), 'defensor señalado');
  for (let i = 0; i < Math.round(6.2 / TICK); i++) { game.tick(); recon.tick(TICK); }
  assert.ok(!recon.isSpottedFor(def, 0), 'la marca caduca a los 6 s');
  // el defensor dispara al dron: un tiro basta
  const de = def.eyePos(), dc = d.center();
  def.yaw = Math.atan2(-(dc.x - de.x), -(dc.z - de.z));
  def.pitch = Math.atan2(dc.y - de.y, Math.hypot(dc.x - de.x, dc.z - de.z));
  let destroyed = null;
  game.on('targetDestroyed', (t) => { destroyed = t; });
  const r = game.fireBullet(def, def.eyePos(), def.viewDir(), def.weapon);
  assert.equal(r.hitTarget, d);
  assert.equal(d.alive, false);
  assert.equal(destroyed, d);
});

test('cámaras: en aire libre, con vista, marcan atacantes y caen de un disparo', () => {
  const { game, recon } = fresh();
  recon.reset({ defTeam: 1, site: map.sites[0] });
  assert.ok(recon.cams.length >= 5);
  for (const c of recon.cams) {
    assert.ok(!world.solidAtWorld(c.pos.x, c.pos.y, c.pos.z), `${c.name} no está dentro de un muro`);
    const e = c.eyePos(), v = c.viewDir();
    assert.ok(lineOfSight(world, e.x, e.y, e.z, e.x + v.x * 3, e.y + v.y * 3, e.z + v.z * 3), `${c.name} ve algo`);
  }
  // cámara del hall: un atacante entrando por el recibidor
  const cam = recon.cams.find((c) => c.id === 'cam_hall');
  const a = game.addOperator(new Operator('a', { team: 0, x: 15.5, y: 0, z: 8.5, yaw: 0, loadout: ['ar'] }));
  game.tick();
  const e = cam.eyePos(), c = a.center();
  cam.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z)); cam.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  assert.equal(recon.mark(cam, 1), a);
  // el atacante la destruye
  const ae = a.eyePos();
  a.yaw = Math.atan2(-(cam.pos.x - ae.x), -(cam.pos.z - ae.z));
  a.pitch = Math.atan2(cam.pos.y - ae.y, Math.hypot(cam.pos.x - ae.x, cam.pos.z - ae.z));
  const r = game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon);
  assert.equal(r.hitTarget, cam);
  assert.equal(cam.alive, false);
});

test('partida: en la preparación cada atacante tiene un dron y los bots refuerzan el sitio', () => {
  const m = new Match({ world, map, seed: 21, rules: { selectTime: 0, prepTime: 45, roundEndTime: 0.2 }, human: false });
  const bots = new BotSquad(m, 'normal');
  m.on('roundStart', () => bots.reset());
  m.start();
  assert.equal(m.phase, 'prep');
  assert.equal(m.recon.drones.length, 5, 'un dron por atacante');
  for (let i = 0; i < Math.round(44 / TICK); i++) { bots.update(TICK); m.tick(TICK); }
  const nWalls = m.fort.panels.length, nBar = m.fort.barricades.length;
  assert.ok(nWalls >= 5, 'refuerzos puestos por los bots: ' + nWalls);
  assert.ok(nBar >= 2, 'barricadas puestas por los bots: ' + nBar);
  for (const p of m.fort.panels) if (p.kind === 'wall') {
    const room = map.roomAt(p.center.x + p.normal.x * 0.5, p.center.y, p.center.z + p.normal.z * 0.5);
    assert.ok(room && (room.id === m.site.A || room.id === m.site.B), 'refuerzo en el sitio: ' + (room && room.id));
  }
  bots.dispose();
  // la ronda siguiente empieza con el mapa intacto
  m.phase = 'action'; m.timer = 0.01;
  for (let i = 0; i < 40 && m.phase !== 'prep'; i++) m.tick(TICK);
  assert.equal(m.fort.panels.length, 0);
});

test('preparación: los atacantes aún no están en el mapa (no se les puede disparar)', () => {
  const m = new Match({ world, map, seed: 4, rules: { selectTime: 0, prepTime: 10 }, human: false });
  m.start();
  const a = m.opsOfSide('atk')[0];
  const d = m.opsOfSide('def')[0];
  // un defensor con línea de tiro limpia hacia el atacante congelado
  d.body.pos.x = a.body.pos.x; d.body.pos.y = a.body.pos.y; d.body.pos.z = a.body.pos.z + 3;
  m.game.tick();
  aim(d, a.center());
  const r = m.game.fireBullet(d, d.eyePos(), d.viewDir(), d.weapon);
  assert.equal(r.hitOp, null, 'la bala no le da');
  m.game.damage(a, 500, { by: d });
  assert.equal(a.state, 'alive');
  // en la acción ya sí
  for (let i = 0; i < Math.round(10.2 / TICK); i++) m.tick(TICK);
  assert.equal(m.phase, 'action');
  d.body.pos.x = a.body.pos.x; d.body.pos.y = a.body.pos.y; d.body.pos.z = a.body.pos.z + 3;
  m.game.tick();
  aim(d, a.center());
  const r2 = m.game.fireBullet(d, d.eyePos(), d.viewDir(), d.weapon);
  assert.equal(r2.hitOp, a);
});

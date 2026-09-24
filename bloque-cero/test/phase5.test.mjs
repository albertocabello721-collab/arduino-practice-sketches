// Fase 5: bots. Navegación (rejilla 2,5D con escaleras, escaleras de mano, barricadas
// que se rompen y boquetes que abren camino), seguidor de rutas, percepción, combate y
// tácticas por bando; partidas 5v5 solo con bots que terminan por combate o plantado,
// sin bots atascados y con un coste de IA por debajo de 1 ms por tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Fortify } from '../src/sim/fortify.js';
import { Drone } from '../src/sim/recon.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor, penetration } from '../src/sim/bots.js';
import { Mover } from '../src/sim/ai/mover.js';
import { attackEntries, entrancesOf, holdPointFor } from '../src/sim/ai/tactics.js';
import { MAT } from '../src/world/materials.js';
import { angleDiff, clamp } from '../src/core/math.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);        // una sola vez por archivo (~0,8 s)

function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }
function place(op, x, y, z) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; }

// Hace andar a un operador (o dron) con el seguidor de rutas hasta `goal`.
function walk(body, goal, { drone = false, maxT = 90, game } = {}) {
  const mv = new Mover(body, nav, { drone });
  mv.go(goal, { r: drone ? 1.0 : 0.45 });
  let t = 0, st = mv.status;
  while (t < maxT && (st === 'moving' || st === 'planning')) {
    nav.update(8); nav.work(1500);
    if (mv.wantYaw !== null) body.yaw += clamp(angleDiff(body.yaw, mv.wantYaw), -TICK * (drone ? 5 : 9), TICK * (drone ? 5 : 9));
    if (mv.mustFace) body.pitch += clamp(mv.pitchWant - body.pitch, -TICK * 6, TICK * 6);
    st = mv.update(TICK, { sprint: !drone });
    if (drone) body.update(TICK, game); else game.tick(TICK);
    t += TICK;
  }
  return { status: st, t };
}

test('navegación: hay ruta desde cada entrada del ataque a los 6 puntos de plantado (con escaleras)', () => {
  settle();
  const entries = attackEntries(map, nav);
  assert.ok(entries.length >= 4, 'entradas exteriores');
  const starts = [...map.attackerSpawns.map((s) => ({ x: s.x, y: s.y, z: s.z })), ...entries.map((e) => ({ x: e.x, y: e.y, z: e.z }))];
  for (const s of starts) {
    for (const site of map.sites) {
      for (const k of ['A', 'B']) {
        const goal = site.bombs[k];
        const r = nav.path(s, goal, { raw: true });
        assert.ok(r, `ruta de (${s.x}, ${s.y}, ${s.z}) a ${site.id} ${k}`);
        const last = r.points[r.points.length - 1];
        assert.ok(Math.hypot(last.x - goal.x, last.z - goal.z) < 2 && Math.abs(last.y - goal.y) < 0.6, 'llega al punto de plantado');
        // cambiar de planta obliga a pasar por escaleras (o escalera de mano)
        if (Math.abs(goal.y - s.y) > 2) {
          const ys = new Set(r.points.map((q) => Math.round(q.y * 4) / 4));
          assert.ok(ys.size >= 6 || r.points.some((q) => q.kind === 'ladder' || q.kind === 'drop'), 'sube por escaleras o escalera de mano, o baja por ellas o dejándose caer');
        }
      }
    }
  }
});

test('navegación: un operador camina de cada aparición del ataque a los 6 puntos de plantado', () => {
  settle();
  let ok = 0, total = 0;
  for (const sp of map.attackerSpawns) {
    for (const site of map.sites) {
      for (const k of ['A', 'B']) {
        const game = new Game({ world, map, seed: 1 });
        const op = game.addOperator(new Operator('w', { x: sp.x, y: sp.y + 0.05, z: sp.z, yaw: sp.yaw }));
        const r = walk(op, site.bombs[k], { game });
        total++;
        if (r.status === 'arrived') ok++;
      }
    }
  }
  assert.equal(ok, total, `llegan ${ok}/${total}`);
});

test('navegación: los drones llegan a los 6 puntos de plantado (saltando peldaños, sin escaleras de mano)', () => {
  settle();
  const game = new Game({ world, map, seed: 1 });
  const sp = map.attackerSpawns[0];
  for (const site of map.sites) {
    for (const k of ['A', 'B']) {
      const owner = new Operator('o', { x: sp.x, y: sp.y, z: sp.z });
      const d = new Drone('d', owner, sp.x, sp.y + 0.05, sp.z, sp.yaw);
      const r = walk(d, site.bombs[k], { drone: true, game, maxT: 60 });
      assert.equal(r.status, 'arrived', `dron a ${site.id} ${k}`);
    }
  }
});

test('navegación: una barricada obliga a romperla o a rodear; un boquete abre un atajo', () => {
  settle();
  const game = new Game({ world, map, seed: 1 });
  const fort = new Fortify(game);
  // Bodega (x<12) → pasillo del sótano (x>12) por la puerta (12, 14.5)
  const a = { x: 9, y: -3.5, z: 14.5 }, b = { x: 15, y: -3.5, z: 14.5 };
  const base = nav.path(a, b);
  assert.ok(base && !base.points.some((q) => q.kind === 'break'));
  const isDoor = (o, axis, line, center) => o.y0 < -2 && o.axis === axis && o.line === line && o.center === center;
  const doors = [
    map.doors.find((o) => isDoor(o, 'z', 12, 14.5)),     // bodega → pasillo (la de la ruta directa)
    map.doors.find((o) => isDoor(o, 'x', 13, 9)),        // bodega → almacén
    map.doors.find((o) => isDoor(o, 'z', 12, 21)),       // bodega → calderas
  ];
  assert.ok(doors.every(Boolean), 'las tres salidas de la bodega');
  fort.applyBarricade(doors[0], 1);
  while (nav.update(256)) { /* */ }
  const around = nav.path(a, b);
  assert.ok(around.cost > base.cost + 2, 'con una puerta cerrada, rodea (o rompe) y cuesta más');
  for (const o of doors.slice(1)) fort.applyBarricade(o, 1);
  while (nav.update(256)) { /* */ }
  const brk = nav.path(a, b);
  assert.ok(brk.points.some((q) => q.kind === 'break'), 'con todas cerradas, la ruta rompe una barricada');
  const def = nav.path(a, b, { breakCost: 25 });
  assert.ok(def.cost > brk.cost + 20, 'a la defensa le cuesta mucho más romper sus barricadas');
  // un operador la rompe a golpes y pasa
  const op = game.addOperator(new Operator('w', { x: a.x, y: a.y + 0.02, z: a.z, yaw: -Math.PI / 2 }));
  let hits = 0;
  game.on('melee', () => hits++);
  const r = walk(op, b, { game, maxT: 25 });
  assert.equal(r.status, 'arrived');
  assert.ok(hits >= 1, 'golpes para abrir la barricada: ' + hits);
  // boquete: abrir la pared de pladur entre el recibidor (z<7) y el hall (z>7) acorta la ruta
  settle();
  // boquete: abrir el tabique de pladur entre el hall (z<16) y la cocina (z>16), entre sus dos puertas
  const c = { x: 19.5, y: 0, z: 14 }, d2 = { x: 19.5, y: 0, z: 18 };
  const before = nav.path(c, d2);
  for (let x = 19; x <= 20.1; x += 0.125) for (let y = 0.02; y <= 2.3; y += 0.125) for (let z = 15.8; z <= 16.2; z += 0.125) {
    const vx = world.vx(x), vy = world.vy(y), vz = world.vz(z);
    if (world.get(vx, vy, vz)) world.setRaw(vx, vy, vz, MAT.AIR);
  }
  world.notify(world.vx(18.9), world.vy(0), world.vz(15.7), world.vx(20.2), world.vy(2.4), world.vz(16.3));
  while (nav.update(256)) { /* */ }
  const after = nav.path(c, d2);
  assert.ok(after.cost < before.cost - 2, `el boquete acorta la ruta (${before.cost.toFixed(1)} → ${after.cost.toFixed(1)})`);
  settle();
  assert.ok(Math.abs(nav.path(c, d2).cost - before.cost) < 0.01, 'al reiniciar la ronda vuelve la rejilla original');
});

test('tácticas: puntos de guardia en diagonal sobre los accesos de cada sala de sitio', () => {
  settle();
  for (const site of map.sites) {
    for (const id of [site.A, site.B]) {
      const room = map.rooms.find((r) => r.id === id);
      const ents = entrancesOf(map, room).filter((e) => e.kind === 'door');
      assert.ok(ents.length >= 2, `${id} tiene puertas`);
      const taken = [];
      for (const e of ents) {
        const h = holdPointFor(nav, world, room, e, taken);
        assert.ok(h, `punto para ${id} (${e.x}, ${e.z})`);
        assert.ok(h.x > room.x0 && h.x < room.x1 && h.z > room.z0 && h.z < room.z1, 'dentro de la sala');
        const d = Math.hypot(h.x - e.x, h.z - e.z);
        assert.ok(d > 2 && d < 8.5, 'a distancia de ángulo');
        taken.push(h);
      }
    }
  }
});

test('percepción: oye pasos a través de la pared y se gira hacia ellos', () => {
  settle();
  const m = new Match({ world, map, seed: 4, rules: { selectTime: 0, prepTime: 0, actionTime: 60 }, human: false });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  const d = m.opsOfSide('def')[0], a = m.opsOfSide('atk')[0];
  for (const o of m.game.operators) if (o !== a && o !== d) m.game.kill(o, { by: null });
  // pared hall (z<16) | cocina (z>16), tramo x∈[18,19] sin huecos: el defensor en la cocina mira al sur
  place(d, 18.5, 0.01, 18.5); d.yaw = Math.PI;
  bots.brains.get(d).post = { x: 18.5, y: 0, z: 18.5, yaw: Math.PI };
  place(a, 18.5, 0.01, 13); a.yaw = Math.PI;
  bots.brains.get(a).post = { x: 18.5, y: 0, z: 13, yaw: Math.PI };
  bots.update(TICK); m.tick(TICK);
  bots.brains.get(a).post = null;
  const B = bots.brains.get(d);
  let heard = false, turned = false;
  for (let i = 0; i < 60 * 3; i++) {
    // el atacante corre de lado a lado por el hall (pasos fuertes)
    a.intent.moveX = (Math.floor(i / 50) % 2) ? 1 : -1; a.intent.moveZ = 0; a.intent.sprint = false;
    a.yaw = Math.PI / 2; a.intent.stance = 'stand';
    bots.update(TICK);
    if (a.state === 'alive') { a.intent.moveX = (Math.floor(i / 50) % 2) ? 1 : -1; a.intent.fire = false; }
    m.tick(TICK);
    if (B.per.noises.length) heard = true;
    if (Math.abs(angleDiff(d.yaw, 0)) < 1.2) turned = true;
  }
  assert.ok(heard, 'oye los pasos');
  assert.ok(turned, 'se gira hacia el ruido (hacia la pared del hall)');
  bots.dispose();
});

test('combate: dispara a través del pladur a un enemigo que oye al otro lado', () => {
  settle();
  const m = new Match({ world, map, seed: 11, rules: { selectTime: 0, prepTime: 0, actionTime: 60 }, human: false });
  const bots = new BotSquad(m, 'veterano', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  const d = m.opsOfSide('def')[0], a = m.opsOfSide('atk')[0];
  for (const o of m.game.operators) if (o !== a && o !== d) m.game.kill(o, { by: null });
  place(d, 18.5, 0.01, 17.6); d.yaw = 0;
  bots.brains.get(d).post = { x: 18.5, y: 0, z: 17.6, yaw: 0 };
  place(a, 18.5, 0.01, 14.4);
  bots.brains.get(a).post = { x: 18.5, y: 0, z: 14.4, yaw: 0 };
  // la pared de pladur entre los dos deja pasar las balas
  const power = penetration(world, d.eyePos(), { x: 18.5, y: 1.2, z: 14.4 }, 1 / d.weapon.def.penetration);
  assert.ok(power > 0.4, 'el pladur deja pasar la bala: ' + power.toFixed(2));
  let wallShots = 0;
  // balas del defensor que atraviesan el pladur (rompen o perforan algo por el camino)
  m.game.on('bullet', (op, res) => { if (op === d && res.segments.some((sg) => sg.action === 'break' || sg.action === 'pierce')) wallShots++; });
  for (let i = 0; i < 60 * 12 && a.state === 'alive'; i++) {
    bots.update(TICK);
    // el atacante recarga sin parar (ruido) y no dispara
    a.intent.fire = false; a.intent.reload = (i % 90) === 0; a.intent.moveX = 0; a.intent.moveZ = 0;
    if (a.weapon.ammo > 5) a.weapon.ammo = 5;
    m.tick(TICK);
  }
  assert.ok(wallShots >= 1 && (wallShots >= 3 || a.state !== 'alive'), `dispara a través de la pared (disparos ${d.stats.shots}, a través del pladur ${wallShots}, atacante ${a.state})`);
  bots.dispose();
});

test('equipo: un bot reanima al compañero derribado cuando no hay enemigos a la vista', () => {
  settle();
  const m = new Match({ world, map, seed: 5, rules: { selectTime: 0, prepTime: 0, actionTime: 90 }, human: false });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  const [d1, d2] = m.opsOfSide('def');
  // atacantes fuera, lejos (en su aparición) y quietos
  for (const o of m.opsOfSide('atk')) bots.brains.get(o).post = { x: o.body.pos.x, y: o.body.pos.y, z: o.body.pos.z, yaw: o.yaw };
  const p = d2.body.pos;
  place(d1, p.x + 3, p.y + 0.01, p.z);
  m.game.damage(d1, d1.hp + 5, { by: m.opsOfSide('atk')[0], zone: 'body' });
  assert.equal(d1.state, 'downed');
  let t = 0;
  while (d1.state === 'downed' && t < 15) { bots.update(TICK); m.tick(TICK); t += TICK; }
  assert.equal(d1.state, 'alive', 'reanimado');
  bots.dispose();
});

test('ataque: el portador bot planta en el sitio y, si muere, un compañero recoge el desactivador', () => {
  settle();
  const m = new Match({ world, map, seed: 8, rules: { selectTime: 0, prepTime: 0, actionTime: 120 }, human: false });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  // defensores fuera de juego salvo uno muy lejos, quieto y mirando a la pared
  const defs = m.opsOfSide('def');
  for (const o of defs.slice(1)) m.game.kill(o, { by: null });
  const lone = defs[0];
  const far = m.site.id === 'alta' ? { x: 5, y: -3.49, z: 4 } : { x: 25, y: 3.51, z: 3 };
  place(lone, far.x, far.y, far.z);
  bots.brains.get(lone).post = { ...far, yaw: 0 };
  lone.weapons.forEach((w) => { w.ammo = 0; w.reserve = 0; });
  // el portador muere al empezar: alguien recoge el desactivador
  const carrier = m.defuser.carrier;
  let picked = null, planted = false;
  m.on('defuserPicked', (op) => { picked = op; });
  m.on('planted', () => { planted = true; });
  m.game.kill(carrier, { by: null });
  let t = 0;
  while (!planted && t < 115 && m.phase !== 'roundEnd') { bots.update(TICK); m.tick(TICK); t += TICK; }
  assert.ok(picked && picked !== carrier, 'un compañero recoge el desactivador');
  assert.ok(planted, `planta (fase ${m.phase}, ${t.toFixed(0)} s)`);
  bots.dispose();
});

test('defensa: tras el plantado, los bots van al desactivador y lo inutilizan', () => {
  settle();
  const m = new Match({ world, map, seed: 12, rules: { selectTime: 0, prepTime: 0, actionTime: 120 }, human: false });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  // plantar a mano con el portador en el punto A y luego eliminar al ataque
  const c = m.defuser.carrier, A = m.site.bombs.A;
  place(c, A.x, A.y + 0.01, A.z);
  for (const o of m.opsOfSide('atk')) if (o !== c) bots.brains.get(o).post = { x: o.body.pos.x, y: o.body.pos.y, z: o.body.pos.z, yaw: o.yaw };
  for (const o of m.opsOfSide('def')) { o.weapons.forEach((w) => { w.ammo = 0; w.reserve = 0; }); }
  let t = 0;
  while (m.phase === 'action' && t < 10) { c.intent.interact = true; m.tick(TICK); t += TICK; }
  assert.equal(m.phase, 'planted');
  for (const o of m.opsOfSide('atk')) m.game.kill(o, { by: null });
  let end = null;
  m.on('roundEnd', (r) => { end = r; });
  t = 0;
  while (!end && t < 46) { bots.update(TICK); m.tick(TICK); t += TICK; }
  assert.ok(end, 'la ronda termina');
  assert.equal(end.code, 'disabled', 'la defensa inutiliza el desactivador');
  bots.dispose();
});

test('preparación: los drones bot localizan el objetivo en la mayoría de rondas y marcan defensores', () => {
  settle();
  let found = 0, marks = 0, rounds = 0;
  for (const seed of [21, 23]) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2, actionTime: 1 }, human: false });
    const bots = new BotSquad(m, 'normal', { nav });
    m.on('roundStart', () => bots.reset());
    let r = 0;
    m.on('action', () => { r++; rounds++; if (m.recon.objectiveFound) found++; });
    m.game.on('spotted', () => marks++);
    m.start();
    let n = 0;
    while (r < 4 && n++ < 60 * 60 * 5) { bots.update(TICK); m.tick(TICK); }
    bots.dispose();
  }
  assert.equal(rounds, 8);
  assert.ok(found >= 4, `objetivo localizado en la preparación: ${found}/8`);
  assert.ok(marks >= 4, 'defensores marcados: ' + marks);
});

test('partidas 5v5 solo con bots: terminan por combate o plantado, nadie se atasca y la IA cuesta < 1 ms/tick', () => {
  settle();
  const reasons = {};
  let rounds = 0, plants = 0, kills = 0, maxStill = 0, aiMs = 0, ticks = 0;
  for (const seed of [2, 5]) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false });
    const bots = new BotSquad(m, 'normal', { nav });
    m.on('roundStart', () => bots.reset());
    m.on('roundEnd', (r) => {
      rounds++; reasons[r.code] = (reasons[r.code] || 0) + 1;
      for (const B of bots.brains.values()) maxStill = Math.max(maxStill, B.maxStillT);
    });
    m.on('planted', () => plants++);
    m.game.on('killed', (t, ev) => { if (ev.by && ev.by.team !== t.team) kills++; });
    m.start();
    let n = 0;
    while (m.phase !== 'matchEnd' && n++ < 60 * 60 * 30) {
      const t0 = performance.now();
      bots.update(TICK);
      aiMs += performance.now() - t0; ticks++;
      m.tick(TICK);
    }
    assert.equal(m.phase, 'matchEnd', 'la partida termina');
    bots.dispose();
  }
  const byCombat = (reasons.defendersDown || 0) + (reasons.attackersDown || 0) + (reasons.defused || 0) + (reasons.disabled || 0);
  assert.ok(rounds >= 8, 'rondas jugadas: ' + rounds);
  assert.ok(byCombat >= rounds * 0.7, `rondas decididas por combate o desactivador: ${byCombat}/${rounds} ${JSON.stringify(reasons)}`);
  assert.ok(kills >= rounds * 4, 'hay combate: ' + kills + ' bajas');
  assert.ok(plants >= 1, 'se planta alguna vez: ' + plants);
  assert.ok(maxStill < 15, `ningún bot se queda atascado (máx ${maxStill.toFixed(1)} s sin avanzar)`);
  assert.ok(aiMs / ticks < 1, `coste de IA ${(aiMs / ticks).toFixed(3)} ms/tick`);
});

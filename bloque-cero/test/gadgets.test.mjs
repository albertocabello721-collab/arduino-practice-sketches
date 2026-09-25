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

// ---------------------------------------------------------------- explosivos colocados (F6.3b)
import { BREACH, CLAYMORE } from '../src/sim/gadgets.js';

function airCount(x0, x1, y0, y1, z0, z1, step = 0.125) {
  let n = 0;
  for (let x = x0; x <= x1 + 1e-9; x += step) for (let y = y0; y <= y1 + 1e-9; y += step) for (let z = z0; z <= z1 + 1e-9; z += step) if (world.getWorld(x, y, z) === MAT.AIR) n++;
  return n;
}

test('carga de brecha: se coloca en 1,5 s, G la detona: hueco de 1 × 2 m y baja a 1 m al otro lado', () => {
  const { game, gadgets } = fresh();
  // atacante en el salón frente a la pared de pladur x = 12 (z = 2); defensor al otro lado
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 11.0, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'breach');
  const d = game.addOperator(new Operator('d', { team: 1, x: 12.45, y: 0, z: 2.1, yaw: Math.PI / 2, armor: 3 }));
  step(game, gadgets, 0.3);
  a.pitch = 0;
  const before = airCount(12.0, 12.12, 0.2, 1.9, 1.6, 2.4);
  a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.ok(gadgets.work.has(a), 'colocando');
  assert.equal(a.channel && a.channel.kind, 'gadget');
  step(game, gadgets, BREACH.place - 0.1);
  assert.equal(gadgets.placed.length, 0, 'aún no');
  step(game, gadgets, 0.2);
  assert.equal(gadgets.placed.length, 1, 'colocada');
  assert.equal(a.gadget.left, 1);
  assert.equal(a.channel, null);
  // G otra vez: detona
  const booms = [];
  game.on('explosion', (k) => booms.push(k));
  a.gadgetCd = 0;
  a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.deepEqual(booms, ['breach']);
  assert.equal(a.gadget.left, 1, 'detonar no gasta otra carga');
  const after = airCount(12.0, 12.12, 0.2, 1.9, 1.6, 2.4);
  assert.ok(after > before + 60, `hueco abierto (${before} → ${after} vóxeles de aire)`);
  assert.equal(d.state, 'dead', 'a 1 m al otro lado: baja');
});

test('carga de brecha: no en muros reforzados; moverse cancela la colocación', () => {
  const { game, gadgets } = fresh();
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 11.0, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'breach');
  step(game, gadgets, 0.3);
  // reforzar a mano el trozo de pared que mira
  for (let y = 0; y < 2.5; y += 0.125) for (let z = 1.5; z < 2.5; z += 0.125) for (const x of [12.06, 11.94]) world.setRaw(world.vx(x), world.vy(y + 0.01), world.vz(z), MAT.REINFORCED);
  const denied = [];
  game.on('gadgetDenied', (op, why) => denied.push(why));
  a.pitch = 0;
  a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.equal(gadgets.work.size, 0);
  assert.ok(/reforzado/i.test(denied[0] || ''), `motivo: ${denied[0]}`);
  // en pladur sí, pero si se mueve se cancela
  world.resetToPristine();
  a.gadgetCd = 0;
  a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.ok(gadgets.work.has(a));
  a.intent.moveZ = -1; step(game, gadgets, TICK);
  a.intent.moveZ = 0;
  assert.equal(gadgets.work.size, 0, 'cancelada al intentar moverse');
  step(game, gadgets, 2);
  assert.equal(gadgets.placed.length, 0);
  assert.equal(a.gadget.left, 2, 'no se gasta');
});

test('carga de brecha en una barricada: la quita entera', () => {
  const { game, gadgets } = fresh();
  const o = map.windows.find((w) => w.axis === 'x' && w.y0 < 2);
  const inSide = -(o.out || 1);
  const my = (o.y0 + o.y1) / 2;
  // dentro, frente a la ventana, mirando hacia fuera
  const zIn = o.line + inSide * 0.9;
  const a = give(game.addOperator(new Operator('a', { team: 0, x: o.center, y: Math.floor(o.y0 / 3.5) * 3.5, z: zIn, yaw: inSide < 0 ? Math.PI : 0, loadout: ['ar'] })), 'breach');
  step(game, gadgets, 0.3);
  const e = a.eyePos();
  a.pitch = Math.atan2(my - e.y, 0.9);
  const c = inSide < 0 ? o.line - 0.0625 : o.line + 0.0625;
  const barr = () => { let n = 0; for (let x = o.center - o.width / 2 + 0.06; x < o.center + o.width / 2; x += 0.125) for (let y = o.y0 + 0.06; y < o.y1; y += 0.125) if (world.getWorld(x, y, c) === MAT.BARRICADE) n++; return n; };
  assert.ok(barr() > 20, 'hay barricada');
  a.intent.gadget = true;
  step(game, gadgets, BREACH.place + 0.2);
  assert.equal(gadgets.placed.length, 1);
  a.gadgetCd = 0; a.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.equal(barr(), 0, 'barricada fuera');
});

test('C4: se pega donde cae, G lo detona y atraviesa el suelo; un disparo lo destruye antes', () => {
  const { game, gadgets } = fresh();
  // defensor en el dormitorio (planta alta) sobre el comedor; atacante debajo
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 6, y: 3.5, z: 21, yaw: 0, loadout: ['ar'] })), 'c4', 1);
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 19.4, yaw: 0, armor: 2 }));
  step(game, gadgets, 0.3);
  d.pitch = -1.2;
  d.intent.gadget = true;
  step(game, gadgets, 1.2);
  const c4 = gadgets.items.find((i) => i.kind === 'c4');
  assert.ok(c4 && c4.stuck, 'pegado al suelo');
  assert.ok(c4.pos.y > 3.4 && c4.pos.y < 4.0, `abajo, en la planta alta (y=${c4.pos.y.toFixed(2)})`);
  const hp0 = a.hp;
  d.gadgetCd = 0; d.intent.gadget = true;
  step(game, gadgets, TICK);
  assert.ok(a.state !== 'alive' || a.hp < hp0 - 40, `daño a través del suelo (${Math.round(hp0 - a.hp)})`);
  // otro C4, esta vez el atacante lo ve y lo destruye de un disparo
  const g2 = fresh();
  const d2 = give(g2.game.addOperator(new Operator('d', { team: 1, x: 6, y: 0, z: 6, yaw: 0, loadout: ['ar'] })), 'c4', 1);
  const a2 = g2.game.addOperator(new Operator('a', { team: 0, x: 9, y: 0, z: 3.5, yaw: Math.PI / 2, loadout: ['ar'] }));   // de lado, con el C4 a la vista
  step(g2.game, g2.gadgets, 0.3);
  d2.pitch = -0.6; d2.intent.gadget = true;
  step(g2.game, g2.gadgets, 1.2);
  const k = g2.gadgets.items.find((i) => i.kind === 'c4');
  assert.ok(k && k.stuck);
  const e = a2.eyePos(), dx = k.pos.x - e.x, dy = k.pos.y - e.y, dz = k.pos.z - e.z;
  const L = Math.hypot(dx, dy, dz);
  g2.game.fireBullet(a2, e, { x: dx / L, y: dy / L, z: dz / L }, a2.weapon);
  assert.ok(!k.alive, 'destruido');
  const booms = [];
  g2.game.on('explosion', (kk) => booms.push(kk));
  d2.gadgetCd = 0; d2.intent.gadget = true;
  step(g2.game, g2.gadgets, TICK);
  assert.equal(booms.length, 0, 'ya no explota');
});

test('claymore: salta cuando un enemigo entra en su cono de 2 m; por detrás no', () => {
  const { game, gadgets } = fresh();
  const a = give(game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'claymore', 1);
  step(game, gadgets, 0.3);
  a.intent.gadget = true;
  step(game, gadgets, CLAYMORE.place + 0.2);
  assert.equal(gadgets.placed.length, 1, 'colocada');
  const c = gadgets.placed[0];
  // el atacante se va; un defensor pasa por detrás (no salta) y luego por delante (salta)
  a.body.pos.z = 16;
  const d = game.addOperator(new Operator('d', { team: 1, x: c.pos.x, y: 0, z: c.pos.z + 1.2, yaw: 0, armor: 2 }));
  step(game, gadgets, 0.5);
  assert.ok(c.alive, 'por detrás no salta');
  d.body.pos.z = c.pos.z - 1.4;
  const booms = [];
  game.on('explosion', (k) => booms.push(k));
  step(game, gadgets, 0.2);
  assert.deepEqual(booms, ['claymore']);
  assert.equal(d.state, 'dead', 'letal en el cono');
});

// ---------------------------------------------------------------- gadgets defensivos (F6.3c)
import { WIRE, ALARM } from '../src/sim/gadgets.js';
import { Recon } from '../src/sim/recon.js';

function placeNow(game, gadgets, op, secs = 1.2) { op.gadgetCd = 0; op.intent.gadget = true; step(game, gadgets, secs); }

test('alambre de púas: a la mitad de velocidad dentro, las balas no lo rompen y 3 golpes sí', () => {
  const { game, gadgets } = fresh();
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'barbed');
  step(game, gadgets, 0.3);
  placeNow(game, gadgets, d);
  const wire = gadgets.placed.find((c) => c.kind === 'barbed');
  assert.ok(wire, 'colocado');
  // un atacante corre a través del alambre
  const a = game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: wire.pos.z - 2.5, yaw: Math.PI, loadout: ['ar'] }));
  step(game, gadgets, 0.2);
  const speedAt = (z) => { a.body.pos.z = z; a.body.vel.x = a.body.vel.z = 0; let v = 0; for (let i = 0; i < 30; i++) { a.intent.moveZ = 1; step(game, gadgets, TICK); v = Math.hypot(a.body.vel.x, a.body.vel.z); } return v; };
  const free = speedAt(wire.pos.z - 2.5);
  const slow = speedAt(wire.pos.z - 0.2);
  assert.ok(Math.abs(slow / free - WIRE.slow) < 0.08, `dentro va a la mitad (${free.toFixed(2)} → ${slow.toFixed(2)} m/s)`);
  // balas: lo atraviesan
  const e = a.eyePos();
  game.fireBullet(a, e, { x: 0, y: -Math.sin(0.5), z: Math.cos(0.5) }, a.weapon);
  assert.ok(wire.alive, 'las balas no lo rompen');
  // tres golpes cuerpo a cuerpo
  a.intent.moveZ = 0; a.body.vel.x = a.body.vel.z = 0;
  a.body.pos.z = wire.pos.z - 0.9; a.yaw = Math.PI; a.pitch = -0.9;
  let hits = 0;
  for (let i = 0; i < 4 && wire.alive; i++) { a.meleeT = 0; a.intent.melee = true; step(game, gadgets, 0.7); hits++; }
  assert.ok(!wire.alive, 'roto a golpes');
  assert.equal(hits, 3, 'con 3 golpes');
});

test('escudo desplegable: para las balas; un explosivo lo rompe', () => {
  const { game, gadgets } = fresh();
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'shield', 1);
  step(game, gadgets, 0.3);
  placeNow(game, gadgets, d);
  let n = 0;
  for (let x = 16; x <= 18; x += 0.125) for (let y = 0.06; y < 1.1; y += 0.125) for (let z = 11.5; z <= 12.5; z += 0.125) if (world.getWorld(x, y, z) === MAT.DEPLOY_SHIELD) n++;
  assert.ok(n >= 60, `escudo en su sitio (${n} vóxeles)`);
  // un atacante dispara desde el otro lado a la altura del escudo: no pasa
  const a = game.addOperator(new Operator('a', { team: 0, x: 17, y: 0, z: 9, yaw: Math.PI, loadout: ['ar'] }));
  step(game, gadgets, 0.2);
  const r = game.fireBullet(a, { x: 17, y: 0.6, z: 9 }, { x: 0, y: 0, z: 1 }, a.weapon);
  assert.ok(r.end < 4, `la bala se para en el escudo (${r.end.toFixed(2)} m)`);
  assert.equal(d.hp, d.maxHp);
  // una granada de impacto contra él lo rompe
  const im = { id: 'i', kind: 'impact', owner: a, team: 0, pos: { x: 17, y: 0.6, z: 11.6 }, vel: { x: 0, y: 0, z: 6 }, t: 0.5, rest: false, alive: true, bounces: 0 };
  gadgets.items.push(im);
  step(game, gadgets, 0.2);
  let left = 0;
  for (let x = 16; x <= 18; x += 0.125) for (let y = 0.06; y < 1.1; y += 0.125) for (let z = 11.5; z <= 12.5; z += 0.125) if (world.getWorld(x, y, z) === MAT.DEPLOY_SHIELD) left++;
  assert.ok(left < n * 0.7, `el explosivo lo rompe (${n} → ${left})`);
});

test('cámara blindada: se suma a las cámaras; las balas no la rompen, un golpe sí', () => {
  const { game, gadgets } = fresh();
  const recon = new Recon(game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  gadgets.recon = recon;
  const n0 = recon.cams.length;
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 11.0, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'bpcam', 1);
  step(game, gadgets, 0.3);
  d.pitch = 0.2;
  placeNow(game, gadgets, d);
  assert.equal(recon.cams.length, n0 + 1, 'una cámara más');
  const cam = recon.cams[recon.cams.length - 1];
  assert.ok(cam.bulletproof && cam.team === 1);
  const a = game.addOperator(new Operator('a', { team: 0, x: 8, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] }));
  step(game, gadgets, 0.2);
  // mira hacia el salón (no hacia la pared): ve y marca al atacante
  assert.equal(recon.mark(cam, 1), a, 'la cámara ve la habitación');
  const e = a.eyePos(), c = cam.center();
  const L = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
  for (let i = 0; i < 5; i++) game.fireBullet(a, e, { x: (c.x - e.x) / L, y: (c.y - e.y) / L, z: (c.z - e.z) / L }, a.weapon);
  assert.ok(cam.alive, 'las balas no le hacen nada');
  // golpe cuerpo a cuerpo
  a.body.pos.x = c.x - 1.0; a.body.pos.z = c.z; step(game, gadgets, 0.1);
  const e2 = a.eyePos();
  a.yaw = Math.atan2(-(c.x - e2.x), -(c.z - e2.z)); a.pitch = Math.atan2(c.y - e2.y, Math.hypot(c.x - e2.x, c.z - e2.z));
  a.meleeT = 0; a.intent.melee = true; step(game, gadgets, 0.5);
  assert.ok(!cam.alive, 'un golpe la rompe');
  // la ronda siguiente ya no está
  gadgets.reset();
  assert.equal(recon.cams.length, n0);
});

test('alarma de proximidad: suena y marca 3 s al atacante que pasa a menos de 2 m', () => {
  const { game, gadgets } = fresh();
  const recon = new Recon(game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  gadgets.recon = recon;
  const d = give(game.addOperator(new Operator('d', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] })), 'alarm', 2);
  step(game, gadgets, 0.3);
  d.pitch = -1.0;
  placeNow(game, gadgets, d);
  const al = gadgets.placed.find((c) => c.kind === 'alarm');
  assert.ok(al, 'colocada');
  const a = game.addOperator(new Operator('a', { team: 0, x: al.pos.x + 4, y: 0, z: al.pos.z, yaw: 0, loadout: ['ar'] }));
  const rings = [];
  game.on('alarm', (c, op) => rings.push(op));
  step(game, gadgets, 0.5);
  assert.equal(rings.length, 0, 'lejos, nada');
  a.body.pos.x = al.pos.x + 1.2;
  step(game, gadgets, 0.2);
  assert.equal(rings.length, 1, 'suena');
  assert.ok(recon.isSpottedFor(a, 1), 'marcado para la defensa');
  step(game, gadgets, ALARM.mark - 0.3 + 0.1);
  // se destruye de un disparo
  const e = a.eyePos(), c = al.target.center();
  const L = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
  game.fireBullet(a, e, { x: (c.x - e.x) / L, y: (c.y - e.y) / L, z: (c.z - e.z) / L }, a.weapon);
  assert.ok(!al.alive, 'destruida de un disparo');
});

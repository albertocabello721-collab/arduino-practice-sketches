// F6.6b · El ataque bot usa sus gadgets y habilidades, según la dificultad: CHISPA lanza la
// PEM al muro y TERMO lo abre con la carga térmica; el grupo lanza una cegadora antes de
// entrar (en Élite la espera; en Normal sale tarde y entran sin esperarla); ROMPE abre
// barricadas desde lejos; PULGA destruye gadgets con el dron de choque; MURALLA usa el
// destello a quemarropa; tras plantar, una claymore guarda la puerta. En Novato, nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor, DIFFICULTY } from '../src/sim/bots.js';
import { entrancesOf } from '../src/sim/ai/tactics.js';
import { raycastFirst, lineOfSight } from '../src/world/raycast.js';
import { MAT, SOLID, GLASS } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);

function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }
function place(op, x, y, z) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; }

// Partida solo de bots con los operadores elegidos ('id' o 'id:gadget'); el ataque es el equipo 0.
function match(seed, { atk = [], def = [], diff = 'elite', rules = {}, loc } = {}) {
  settle();
  const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2, ...rules }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, diff, { nav });
  m.on('roundStart', () => bots.reset());
  if (loc !== undefined) m.on('roundSelect', () => { m.location = loc; });
  const pick = (team, ids) => {
    const sl = m.slots.filter((s) => s.team === team);
    ids.forEach((id, i) => { const [op, gi] = id.split(':'); sl[i].opId = op; sl[i].gadget = +(gi || 0); });
  };
  pick(0, atk); pick(1, def);
  const log = [];
  const g = m.game;
  const add = (what, op, extra = {}) => { if (op && op.side === 'atk') log.push({ what, op: op.meta.opId, t: g.time, phase: m.phase, ...extra }); };
  g.on('gadgetThrown', (op, it) => add('lanza:' + it.kind, op, { it }));
  g.on('abilityFired', (op, it) => add('dispara:' + it.kind, op, { it }));
  g.on('gadgetPlaced', (op, c) => add('pone:' + (c.kind || 'cam'), op, { c }));
  g.on('scanStart', (s) => add('escaneo', s.owner));
  g.on('shieldFlash', (op, p, hit) => add('destello', op, { hit }));
  g.on('shockZap', (d, a, b, best) => add('rayo', d.owner, { best }));
  m.start();
  return { m, bots, log, g };
}
function run(M, pred, maxT = 120) {
  for (let n = 0; n < maxT / TICK && !pred(); n++) { M.bots.update(TICK); M.m.tick(TICK); }
}
const toAction = (M) => { run(M, () => M.m.phase === 'action'); M.bots.update(TICK); M.m.tick(TICK); };
const freeze = (ops) => { for (const o of ops) o.frozen = true; };
const brainOf = (M, id) => [...M.bots.brains.values()].find((B) => B.op.meta.opId === id);
const standable = (p) => !world.worldBoxHasSolid(p.x - 0.3, p.y + 0.02, p.z - 0.3, p.x + 0.3, p.y + 1.8, p.z + 0.3) && SOLID[world.getWorld(p.x, p.y - 0.1, p.z)];
// Dos puntos de una sala a `d` m (a lo largo de z) que se ven de pie.
function facingPair(room, d) {
  for (let x = room.x0 + 1; x < room.x1 - 1; x += 0.5) {
    for (let z = room.z0 + 1; z + d < room.z1 - 1; z += 0.5) {
      const a = { x, y: room.floorY, z }, b = { x, y: room.floorY, z: z + d };
      if (standable(a) && standable(b) && lineOfSight(world, a.x, a.y + 1.64, a.z, b.x, b.y + 1.64, b.z) && lineOfSight(world, a.x, a.y + 0.5, a.z, b.x, b.y + 0.5, b.z)) return [a, b];
    }
  }
  return null;
}

test('Élite: CHISPA lanza la PEM al muro y, cuando estalla, TERMO pone la carga térmica y abre el muro reforzado del sitio', () => {
  const M = match(3, { atk: ['termo:0', 'chispa:0', 'rompe:1', 'radar:1', 'muralla:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'] });
  run(M, () => M.m.phase === 'action');
  const { m, g } = M;
  // (el desactivador, a otro: el portador deja la brecha para ir a plantar en cuanto puede)
  if (['termo', 'chispa'].includes(m.defuser.carrier.meta.opId)) m.defuser.carrier = m.opsOfSide('atk').find((o) => o.meta.opId === 'rompe');
  M.bots.update(TICK); m.tick(TICK);
  assert.ok(m.recon.objectiveFound, 'los drones han localizado el objetivo');
  const termo = brainOf(M, 'termo');
  assert.ok(termo.breach, 'TERMO tiene un muro reforzado que abrir');
  const S = termo.breach.S;
  assert.ok(S.chispa, 'CHISPA le acompaña con la PEM');
  // (la defensa, quieta: que el combate no se meta en la prueba)
  freeze(m.opsOfSide('def'));
  let empAt = null, placedAt = null, blastAt = null;
  g.on('emp', (p, hits, op) => { if (op && op.meta.opId === 'chispa' && empAt === null) empAt = g.time; });
  g.on('gadgetPlaced', (op, c) => { if (c.kind === 'thermal' && placedAt === null) placedAt = g.time; });
  g.on('explosion', (kind) => { if (kind === 'thermal' && blastAt === null) blastAt = g.time; });
  run(M, () => blastAt !== null, 50);
  assert.ok(empAt !== null, 'la PEM estalla');
  assert.ok(placedAt !== null && placedAt >= empAt, `la térmica se pone después de la PEM (PEM ${empAt?.toFixed(1)}, térmica ${placedAt?.toFixed(1)})`);
  assert.ok(blastAt !== null, 'la carga térmica abre el muro');
  // el panel queda abierto: se ve a través de él desde donde se puso
  const P = S.rec.panel, u = (P.u0 + P.u1) / 2, y = P.y0 + 1.0;
  const a = P.axisN === 0 ? { x: P.line - P.side * 0.6, z: u } : { x: u, z: P.line - P.side * 0.6 };
  const hit = raycastFirst(world, a.x, y, a.z, P.axisN === 0 ? P.side : 0, 0, P.axisN === 2 ? P.side : 0, 1.4, SOLID, false);
  assert.ok(!hit, 'hueco en el muro reforzado');
  M.bots.dispose();
});

test('Élite: el grupo espera a que estalle su cegadora antes de entrar; con los errores de Normal sale tarde y entran sin esperarla', () => {
  for (const mode of ['elite', 'normal']) {
    const M = match(3, { atk: ['rompe:1', 'radar:1', 'nube:0', 'lumen:0', 'muralla:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], diff: 'elite' });
    // (Normal con la tirada siempre a favor: se ve su forma de usarla, tarde y sin coordinarse)
    if (mode === 'normal') { M.bots.diff = { ...DIFFICULTY.normal, kit: 1 }; for (const B of M.bots.brains.values()) B.diff = M.bots.diff; }
    toAction(M);
    const { m, g, bots } = M;
    freeze(m.opsOfSide('def'));
    const clearAt = new Map();
    const pops = [];
    g.on('flashbang', (p, hit, op) => { if (op && op.side === 'atk') pops.push({ t: g.time, op }); });
    run(M, () => {
      for (const B of bots.brains.values()) if (B.side === 'atk' && B.stage !== 'approach' && B.stage !== 'stack' && !clearAt.has(B)) clearAt.set(B, g.time);
      return pops.length > 0 && [...bots.brains.values()].filter((B) => B.side === 'atk' && B.entry === bots.brains.get(pops[0].op).entry).every((B) => clearAt.has(B));
    }, 60);
    assert.ok(pops.length > 0, `${mode}: lanzan una cegadora al entrar`);
    const flasher = bots.brains.get(pops[0].op), st = bots.kitEntry.get(flasher.entry);
    assert.ok(st, `${mode}: la cegadora es la de la entrada`);
    const group = [...bots.brains.values()].filter((B) => B.side === 'atk' && B.entry === flasher.entry);
    const early = group.filter((B) => clearAt.get(B) < pops[0].t - 0.05);
    if (mode === 'elite') {
      assert.ok(st.coord, 'Élite: se coordinan');
      assert.equal(early.length, 0, 'Élite: nadie entra antes de que estalle');
    } else {
      assert.ok(!st.coord, 'Normal: no se coordinan');
      assert.ok(early.length > 0, 'Normal: alguien entra antes de que estalle');
      const thrown = M.log.find((l) => l.what === 'lanza:flash');
      assert.ok(thrown.t - st.t0 >= DIFFICULTY.normal.kitLate[0] - 0.05, `Normal: la cegadora sale tarde (${(thrown.t - st.t0).toFixed(2)} s)`);
    }
    bots.dispose();
  }
});

test('ROMPE abre desde lejos una barricada del sitio con el proyectil de brecha', () => {
  const M = match(2, { atk: ['rompe:0', 'termo:0', 'radar:0', 'nube:0', 'lumen:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], rules: { prepTime: 0 }, loc: map.sites.findIndex((s) => s.id === 'baja') });
  const { m, bots } = M;
  run(M, () => m.phase === 'action');
  m.recon.objectiveFound = true;
  const rooms = [m.site.A, m.site.B].map((id) => map.rooms.find((r) => r.id === id));
  // una ventana (con barricada) del sitio que se vea desde 7 m, por fuera
  let spot = null, win = null;
  for (const r of rooms) {
    for (const e of entrancesOf(map, r)) {
      if (e.kind !== 'window') continue;
      const o = e.opening, c = { x: e.x, y: (o.y0 + o.y1) / 2, z: e.z };
      if (world.getWorld(c.x, c.y, c.z) !== MAT.BARRICADE && world.getWorld(c.x + e.nx * 0.1, c.y, c.z + e.nz * 0.1) !== MAT.BARRICADE && world.getWorld(c.x - e.nx * 0.1, c.y, c.z - e.nz * 0.1) !== MAT.BARRICADE) continue;
      const s = { x: e.x - e.nx * 7, y: r.floorY, z: e.z - e.nz * 7 };
      if (world.worldBoxHasSolid(s.x - 0.3, s.y + 0.02, s.z - 0.3, s.x + 0.3, s.y + 1.8, s.z + 0.3) || !SOLID[world.getWorld(s.x, s.y - 0.1, s.z)]) continue;
      const E = { x: s.x, y: s.y + 1.64, z: s.z }, dx = c.x - E.x, dy = c.y - E.y, dz = c.z - E.z, d = Math.hypot(dx, dy, dz);
      const hit = raycastFirst(world, E.x, E.y, E.z, dx / d, dy / d, dz / d, d + 0.5, SOLID, true);
      // (por fuera se ve el cristal; la barricada, justo detrás)
      const behind = (k) => world.getWorld(E.x + dx / d * (hit.t + k), E.y + dy / d * (hit.t + k), E.z + dz / d * (hit.t + k));
      if (!hit || !(hit.mat === MAT.BARRICADE || (GLASS[hit.mat] && [0.1, 0.2, 0.3].some((k) => behind(k) === MAT.BARRICADE)))) continue;
      spot = s; win = { e, c }; break;
    }
    if (spot) break;
  }
  assert.ok(spot, 'hay una ventana con barricada a la vista desde fuera');
  const rompe = brainOf(M, 'rompe');
  place(rompe.op, spot.x, spot.y + 0.01, spot.z);
  rompe.op.yaw = Math.atan2(-(win.c.x - spot.x), -(win.c.z - spot.z));
  freeze(m.game.operators.filter((o) => o !== rompe.op));
  run(M, () => M.log.some((l) => l.what === 'dispara:breachround'), 3);
  assert.ok(M.log.some((l) => l.what === 'dispara:breachround' && l.op === 'rompe'), 'ROMPE dispara el proyectil de brecha');
  run(M, () => false, 2.5);
  const { e, c } = win;
  const still = [-0.1, 0, 0.1].some((k) => world.getWorld(c.x + e.nx * k, c.y, c.z + e.nz * k) === MAT.BARRICADE);
  assert.ok(!still, 'la barricada de la ventana ya no está');
  bots.dispose();
});

test('Élite: PULGA destruye gadgets de la defensa con el rayo del dron de choque durante la preparación', () => {
  const M = match(1, { atk: ['pulga:0', 'termo:0', 'rompe:1', 'radar:1', 'nube:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'guardian:1', 'remedio:0'] });
  run(M, () => M.m.phase === 'action');
  const zaps = M.log.filter((l) => l.what === 'rayo' && l.op === 'pulga');
  assert.ok(zaps.length >= 1, 'dispara el rayo');
  assert.ok(zaps.some((l) => l.best), 'destruye algo: ' + zaps.map((l) => l.best ? (l.best.gadget ? l.best.gadget.kind : l.best.kind) : 'fallo').join(','));
  assert.ok(zaps.every((l) => l.phase === 'prep'), 'en la preparación');
  M.bots.dispose();
});

test('Élite: MURALLA usa el destello del escudo a quemarropa y, tras plantar, una claymore guarda la puerta', () => {
  // destello: un defensor delante, a 3 m
  {
    const M = match(4, { atk: ['muralla:0', 'termo:0', 'rompe:1', 'radar:0', 'nube:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], rules: { prepTime: 0 } });
    const { m } = M;
    run(M, () => m.phase === 'action');
    const mur = brainOf(M, 'muralla'), d = m.opsOfSide('def')[0];
    freeze(m.game.operators.filter((o) => o !== mur.op && o !== d));
    const pair = facingPair(map.rooms.find((r) => r.id === 'F_cocina'), 3);
    assert.ok(pair, 'dos puntos que se ven en la cocina');
    const [a, b] = pair;
    place(mur.op, a.x, a.y + 0.01, a.z); mur.op.yaw = Math.PI;        // mirando hacia +z
    place(d, b.x, b.y + 0.01, b.z); d.yaw = 0;                          // y el defensor, hacia él
    M.bots.brains.get(d).post = { x: b.x, y: b.y, z: b.z, yaw: 0 };
    // (sin munición ninguno de los dos: el destello es lo único que pasa)
    for (const o of [d, mur.op]) o.weapons.forEach((w) => { w.ammo = 0; w.reserve = 0; });
    run(M, () => M.log.some((l) => l.what === 'destello'), 3);
    const f = M.log.find((l) => l.what === 'destello');
    assert.ok(f && f.op === 'muralla', 'MURALLA usa el destello');
    assert.ok(f.hit.includes(d), 'ciega al defensor que tiene delante');
    M.bots.dispose();
  }
  // claymore: plantado a mano; RADAR (con claymore) en la sala
  {
    const M = match(12, { atk: ['radar:0', 'termo:0', 'rompe:1', 'nube:0', 'lumen:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], rules: { prepTime: 0, actionTime: 120 } });
    const { m } = M;
    run(M, () => m.phase === 'action');
    const radar = brainOf(M, 'radar'), A = m.site.bombs.A;
    if (m.defuser.carrier === radar.op) m.defuser.carrier = m.opsOfSide('atk').find((o) => o !== radar.op);
    const c = m.defuser.carrier;
    freeze(m.opsOfSide('def'));
    for (const o of m.opsOfSide('atk')) if (o !== c && o !== radar.op) m.game.kill(o, { by: null });
    place(c, A.x, A.y + 0.01, A.z);
    place(radar.op, A.x + 0.8, A.y + 0.01, A.z);
    let t = 0;
    // (la defensa, quieta: la ronda sigue durante el plantado)
    while (m.phase === 'action' && t < 10) { c.intent.interact = true; m.tick(TICK); t += TICK; }
    if (m.phase !== 'planted') { M.bots.dispose(); assert.fail('no se ha podido plantar: ' + m.phase); }
    run(M, () => M.log.some((l) => l.what === 'pone:claymore') || m.phase !== 'planted', 15);
    const cl = M.log.find((l) => l.what === 'pone:claymore');
    assert.ok(cl && cl.op === 'radar', 'RADAR pone la claymore');
    const P = m.defuser.plantPos;
    const room = map.rooms.find((r) => P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1 && Math.abs(P.y - r.floorY) < 1.2);
    assert.ok(entrancesOf(map, room).some((e) => Math.hypot(e.x - cl.c.pos.x, e.z - cl.c.pos.z) < 1.6), 'junto a una puerta de la sala');
    M.bots.dispose();
  }
});

test('Élite: granada de fragmentación al defensor escondido tras la esquina (que el equipo ha visto), por la puerta', () => {
  const M = match(6, { atk: ['muralla:0', 'termo:0', 'rompe:1', 'radar:0', 'nube:0'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], rules: { prepTime: 0 } });
  const { m, bots, g } = M;
  run(M, () => m.phase === 'action');
  const mur = brainOf(M, 'muralla'), d = m.opsOfSide('def')[0];
  freeze(m.game.operators.filter((o) => o !== mur.op && o !== d));
  // MURALLA en el hall, frente a la puerta de la cocina (16, 16); el defensor dentro, a un lado de la puerta
  place(mur.op, 16, 0.01, 11); mur.op.yaw = Math.PI;
  place(d, 17.8, 0.01, 18); d.yaw = 0;
  M.bots.brains.get(d).post = { x: 17.8, y: 0, z: 18, yaw: 0 };
  mur.setOrder({ kind: 'hold', by: mur.op, spot: { x: 16, y: 0, z: 11, yaw: Math.PI }, at: g.time });     // (quieto en su sitio)
  const e = mur.op.eyePos(), c = d.center();
  assert.ok(!lineOfSight(world, e.x, e.y, e.z, c.x, c.y, c.z), 'no se ven');
  // un compañero lo ha visto: está en la pizarra del equipo
  let boom = null;
  g.on('explosion', (kind, p) => { if (kind === 'frag') boom = p; });
  for (let i = 0; i < 10 / TICK && !boom; i++) {
    if (i % 30 === 0) bots.boards[mur.team].report(d, d.body.pos, g.time, true, 0.2);
    bots.update(TICK); m.tick(TICK);
  }
  const thrown = M.log.find((l) => l.what === 'lanza:frag');
  assert.ok(thrown && thrown.op === 'muralla', 'MURALLA lanza la granada');
  run(M, () => !!boom, 4);
  assert.ok(boom, 'estalla');
  assert.ok(Math.hypot(boom.x - d.body.pos.x, boom.z - d.body.pos.z) < 3, `cerca del defensor (${Math.hypot(boom.x - d.body.pos.x, boom.z - d.body.pos.z).toFixed(1)} m)`);
  bots.dispose();
});

test('Novato: el ataque no usa gadgets ni habilidades', () => {
  const M = match(1, { atk: ['termo:0', 'chispa:0', 'rompe:1', 'radar:1', 'pulga:1'], def: ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], diff: 'novato' });
  run(M, () => M.m.phase === 'action' && M.m.rules.actionTime - M.m.timer > 40, 120);
  assert.equal(M.log.length, 0, 'nada: ' + M.log.map((l) => l.what).join(','));
  M.bots.dispose();
});


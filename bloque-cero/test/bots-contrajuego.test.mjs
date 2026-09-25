// F6.6c · Contrajuego de la defensa bot y gadgets de acción: se quedan quietos con el aviso del
// escaneo, disparan a las cargas del ataque que ven, REMEDIO levanta con estimulantes, la C4
// pegada junto a la puerta estalla con atacantes al otro lado, CORAZA abre un hueco entre las
// salas del sitio y empuja con granadas de impacto tras el plantado; y la orden «Poner gadget
// aquí» (rueda H). En Novato, nada de esto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { probe } from '../src/sim/ai/gadgetai.js';
import { lineOfSight } from '../src/world/raycast.js';
import { aimThrow } from '../src/sim/ai/throws.js';
import { SOLID } from '../src/world/materials.js';

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
  const add = (what, extra = {}) => log.push({ what, t: g.time, phase: m.phase, ...extra });
  g.on('gadgetThrown', (op, it) => add('lanza:' + it.kind, { op, it }));
  g.on('explosion', (kind, p, spec, owner) => add('explota:' + kind, { op: owner, p: { ...p } }));
  g.on('gadgetDestroyed', (it) => add('destruido:' + it.kind, { it }));
  g.on('stim', (op, t) => add('estimulante', { op, t }));
  g.on('revived', (t, by) => add('reanimado', { op: by, t }));
  g.on('scanDetect', (op) => add('detectado', { op }));
  g.on('gadgetPlaced', (op, c) => add('pone:' + (c.kind || 'cam'), { op, c }));
  g.on('flashbang', (p) => add('cegadora', { p: { ...p } }));
  m.start();
  return { m, bots, log, g };
}
function run(M, pred, maxT = 120) {
  for (let n = 0; n < maxT / TICK && !pred(); n++) { M.bots.update(TICK); M.m.tick(TICK); }
}
const freeze = (ops) => { for (const o of ops) o.frozen = true; };
const opOf = (M, id) => M.m.game.operators.find((o) => o.meta && o.meta.opId === id);
const standable = (p) => !world.worldBoxHasSolid(p.x - 0.3, p.y + 0.02, p.z - 0.3, p.x + 0.3, p.y + 1.8, p.z + 0.3) && SOLID[world.getWorld(p.x, p.y - 0.1, p.z)];
const LINEUP = { atk: ['radar:0', 'termo:0', 'rompe:1', 'muralla:0', 'lumen:1'], def: ['voltio:1', 'ojo:0', 'coraza:1', 'remedio:1', 'silencio:0'] };

test('escaneo: con el aviso, la defensa (Élite) se queda quieta y apenas la marca; sin reaccionar, la marca entera', () => {
  const det = {};
  for (const react of [true, false]) {
    const M = match(1, { ...LINEUP, rules: { prepTime: 0 } });
    const { m, bots } = M;
    run(M, () => m.phase === 'action');
    if (!react) for (const B of bots.brains.values()) if (B.side === 'def') B.diff = { ...B.diff, kit: 0 };
    const radar = opOf(M, 'radar');
    freeze(m.opsOfSide('atk').filter((o) => o !== radar));
    bots.brains.get(radar).post = { x: radar.body.pos.x, y: radar.body.pos.y, z: radar.body.pos.z, yaw: radar.yaw };
    run(M, () => false, 1);
    assert.ok(m.abilities.startScan(radar), 'RADAR escanea');
    run(M, () => false, 6.5);
    det[react] = M.log.filter((l) => l.what === 'detectado').length;
    bots.dispose();
  }
  assert.ok(det.false >= 3, 'sin reaccionar, el escaneo marca a varios: ' + det.false);
  assert.ok(det.true <= det.false / 2, `quietos, muchos menos: ${det.true} frente a ${det.false}`);
});

test('la defensa dispara a la carga de brecha del ataque que ve', () => {
  const M = match(2, { ...LINEUP, rules: { prepTime: 0 } });
  const { m, bots, g } = M;
  run(M, () => m.phase === 'action');
  const termo = opOf(M, 'termo'), d = m.opsOfSide('def')[0];
  freeze(g.operators.filter((o) => o !== d));
  // una carga en la pared interior de la cocina (a z = 16, mirando hacia dentro) y el defensor a 6 m, mirándola
  let spot = null, at = null;
  for (let x = 13.5; x < 23 && !spot; x += 0.5) {
    const s = { x, y: 0, z: 17.2 };
    if (!standable(s)) continue;
    const sp = g.gadgets.placeSpot(probe(termo, s, 0, 0), 'breach');
    if (sp && sp.ok) { spot = sp; at = s; }
  }
  assert.ok(spot, 'sitio para la carga');
  const charge = g.gadgets._place(termo, spot, 'gadget');
  const post = { x: at.x, y: 0, z: at.z + 6 };
  assert.ok(standable(post) && lineOfSight(world, post.x, 1.64, post.z, spot.pos.x, spot.pos.y, spot.pos.z), 'el defensor la ve');
  place(d, post.x, 0.01, post.z); d.yaw = 0;
  bots.brains.get(d).post = { ...post, yaw: 0 };
  run(M, () => !charge.alive, 4);
  assert.ok(!charge.alive, 'la carga, destruida a tiros');
  bots.dispose();
});

test('REMEDIO levanta desde lejos, con un estimulante, al compañero derribado que ve', () => {
  const M = match(3, { ...LINEUP, rules: { prepTime: 0 } });
  const { m, bots, g } = M;
  run(M, () => m.phase === 'action');
  const rem = opOf(M, 'remedio'), mate = opOf(M, 'coraza'), foe = m.opsOfSide('atk')[0];
  freeze(g.operators.filter((o) => o !== rem && o !== mate));
  place(rem, 14, 0.01, 18); rem.yaw = Math.PI;
  place(mate, 14, 0.01, 24);
  // (quieto en su sitio: una orden de «mantener»; el derribado, en un puesto)
  bots.brains.get(rem).setOrder({ kind: 'hold', by: rem, spot: { x: 14, y: 0, z: 18, yaw: Math.PI }, at: g.time });
  bots.brains.get(mate).post = { x: 14, y: 0, z: 24, yaw: 0 };
  assert.ok(lineOfSight(world, 14, 1.64, 18, 14, 0.4, 24), 'se ven');
  g.damage(mate, mate.hp + 5, { by: foe, zone: 'body' });
  assert.equal(mate.state, 'downed');
  run(M, () => mate.state !== 'downed', 5);
  const r = M.log.find((l) => l.what === 'reanimado');
  assert.ok(r && r.op === rem && r.t === mate, 'REMEDIO lo levanta');
  assert.ok(M.log.some((l) => l.what === 'estimulante' && l.op === rem), 'con un estimulante');
  bots.dispose();
});

test('VOLTIO pega la C4 junto a una puerta del sitio y la detona cuando hay un atacante al otro lado', () => {
  const M = match(4, { ...LINEUP });
  const { m, bots, g } = M;
  run(M, () => m.phase === 'action');
  const voltio = opOf(M, 'voltio');
  const c4 = g.gadgets.items.find((it) => it.alive && it.kind === 'c4' && it.owner === voltio && it.stuck);
  assert.ok(c4, 'la C4 está pegada');
  // el atacante, al otro lado de la pared (a 1,2 m de la carga, por fuera)
  const n = c4.normal, foe = m.opsOfSide('atk')[0];
  const p = { x: c4.pos.x - n.x * 1.2, y: c4.pos.y - 1.2, z: c4.pos.z - n.z * 1.2 };
  // (el atacante, quieto en su puesto —congelado, la explosión no le afectaría—; el resto del ataque, congelado)
  freeze(m.opsOfSide('atk').filter((o) => o !== foe));
  for (const o of m.opsOfSide('def')) if (o !== voltio) g.kill(o, { by: null });
  place(foe, p.x, p.y + 0.01, p.z);
  bots.brains.get(foe).post = { ...p, yaw: 0 };
  foe.weapons.forEach((w) => { w.ammo = 0; w.reserve = 0; });
  // VOLTIO, lejos de su carga
  const room = [m.site.A, m.site.B].map((id) => map.rooms.find((r) => r.id === id)).find((r) => c4.pos.x > r.x0 - 0.3 && c4.pos.x < r.x1 + 0.3 && c4.pos.z > r.z0 - 0.3 && c4.pos.z < r.z1 + 0.3);
  let far = null;
  for (let x = room.x0 + 1; x < room.x1 - 1 && !far; x += 0.5) for (let z = room.z0 + 1; z < room.z1 - 1 && !far; z += 0.5) {
    const q = { x, y: room.floorY, z };
    if (standable(q) && Math.hypot(q.x - c4.pos.x, q.z - c4.pos.z) > 5) far = q;
  }
  place(voltio, far.x, far.y + 0.01, far.z);
  bots.brains.get(voltio).setOrder({ kind: 'hold', by: voltio, spot: { ...far, yaw: 0 }, at: g.time });
  const hp0 = foe.hp;
  let boom = null;
  g.on('explosion', (kind, q, spec, owner) => { if (kind === 'c4' && owner === voltio) boom = q; });
  for (let i = 0; i < 4 / TICK && !boom; i++) {
    if (i % 20 === 0) bots.boards[voltio.team].report(foe, foe.body.pos, g.time, true, 0.2);
    bots.update(TICK); m.tick(TICK);
  }
  assert.ok(boom, 'la C4 estalla');
  assert.ok(foe.state !== 'alive' || foe.hp < hp0, 'y alcanza al atacante');
  bots.dispose();
});

test('CORAZA abre en la preparación un hueco entre las dos salas del sitio y, tras el plantado, empuja con una granada de impacto', () => {
  // preparación: el hueco (planta baja: la pared de la cocina y el comedor)
  {
    const M = match(5, { ...LINEUP, loc: map.sites.findIndex((s) => s.id === 'baja') });
    const { m } = M;
    run(M, () => m.phase === 'action');
    const e = M.log.find((l) => l.what === 'explota:impact' && l.op && l.op.meta.opId === 'coraza');
    assert.ok(e && e.phase === 'prep', 'la granada de impacto estalla en la preparación');
    // en la pared de x = 12 (entre cocina y comedor), con un hueco
    assert.ok(Math.abs(e.p.x - 12) < 0.4 && e.p.z > 16 && e.p.z < 26, `contra la pared que separa las dos salas (${e.p.x.toFixed(2)}, ${e.p.z.toFixed(2)})`);
    assert.ok(lineOfSight(world, 11, e.p.y, e.p.z, 13, e.p.y, e.p.z), 'se ve de una sala a otra por el hueco');
    M.bots.dispose();
  }
  // tras el plantado: a un atacante que guarda el desactivador (lo sabe el equipo)
  {
    const M = match(12, { ...LINEUP, rules: { prepTime: 0, actionTime: 120 } });
    const { m, bots, g } = M;
    run(M, () => m.phase === 'action');
    const coraza = opOf(M, 'coraza'), c = m.defuser.carrier, A = m.site.bombs.A;
    // (el resto de la defensa, fuera: congelados seguirían junto al desactivador y la granada no saldría)
    for (const o of m.opsOfSide('def')) if (o !== coraza) m.game.kill(o, { by: null });
    for (const o of m.opsOfSide('atk')) if (o !== c) m.game.kill(o, { by: null });
    place(c, A.x, A.y + 0.01, A.z);
    let t = 0;
    while (m.phase === 'action' && t < 10) { c.intent.interact = true; m.tick(TICK); t += TICK; }
    assert.equal(m.phase, 'planted');
    bots.brains.get(c).post = { x: A.x, y: A.y, z: A.z, yaw: 0 };       // (el portador, quieto junto al desactivador)
    // CORAZA a 6,5–10 m del portador, sin verlo (tras la esquina) pero con un tiro que cae junto a él
    const cp = c.body.pos;
    let spot = null;
    for (let x = cp.x - 10; x <= cp.x + 10 && !spot; x += 0.5) for (let z = cp.z - 10; z <= cp.z + 10 && !spot; z += 0.5) {
      const q = { x, y: cp.y, z };
      const d = Math.hypot(q.x - cp.x, q.z - cp.z);
      if (d < 6.5 || d > 10 || !standable(q)) continue;
      const eye = { x: q.x, y: q.y + 1.64, z: q.z };
      if (lineOfSight(world, eye.x, eye.y, eye.z, cp.x, cp.y + 1.1, cp.z)) continue;
      const a = aimThrow(world, eye, { x: cp.x, y: cp.y + 0.5, z: cp.z }, { maxErr: 1.0, maxT: 1.5 });
      if (a && Math.hypot(a.hit.pos.x - cp.x, a.hit.pos.z - cp.z) < 1.2) spot = q;
    }
    assert.ok(spot, 'sitio para CORAZA');
    place(coraza, spot.x, spot.y + 0.01, spot.z);
    bots.brains.get(coraza).setOrder({ kind: 'hold', by: coraza, spot: { ...spot, yaw: 0 }, at: g.time });
    // (sin munición ninguno de los dos: que no se derriben antes; solo la granada)
    for (const o of [coraza, c]) o.weapons.forEach((w) => { w.ammo = 0; w.reserve = 0; });
    let boom = null;
    g.on('explosion', (kind, q, spec, owner) => { if (kind === 'impact' && owner === coraza) boom = q; });
    for (let i = 0; i < 6 / TICK && !boom; i++) {
      if (i % 20 === 0) bots.boards[coraza.team].report(c, c.body.pos, g.time, true, 0.2);
      bots.update(TICK); m.tick(TICK);
    }
    assert.ok(boom, 'lanza la granada de impacto');
    assert.ok(Math.hypot(boom.x - c.body.pos.x, boom.z - c.body.pos.z) < 2, `junto al atacante (${Math.hypot(boom.x - c.body.pos.x, boom.z - c.body.pos.z).toFixed(1)} m)`);
    bots.dispose();
  }
});

test('«Poner gadget aquí»: va el aliado cercano con algo que poner; lo que rompe (impacto, fragmentación), lo último', () => {
  const acks = (g) => { const said = []; g.on('radio', (op, text, key) => { if (key === 'ack') said.push({ op, text }); }); return said; };
  // defensa, en la preparación: CORAZA está más cerca (impacto y placas), pero VOLTIO pone su alambre
  {
    const M = match(6, { ...LINEUP, def: ['voltio:0', 'ojo:0', 'coraza:1', 'remedio:1', 'silencio:0'] });
    const { m, bots, g } = M;
    const said = acks(g);
    run(M, () => m.phase === 'prep');
    const by = opOf(M, 'remedio'), voltio = opOf(M, 'voltio'), coraza = opOf(M, 'coraza');
    place(by, 18, 0.01, 18); place(voltio, 18, 0.01, 21); place(coraza, 18.9, 0.01, 22.3);
    const pos = { x: 18, y: 0.05, z: 22.5, from: { x: 18, y: 1.64, z: 18 } };
    assert.equal(bots.order('gadget', by, pos), 1, 'alguien lo hace');
    assert.deepEqual(said.map((a) => [a.op.meta.opId, a.text]), [['voltio', 'Pongo el alambre ahí']]);
    run(M, () => M.log.some((l) => l.what === 'pone:barbed' && l.op === voltio), 20);
    const w = M.log.find((l) => l.what === 'pone:barbed' && l.op === voltio);
    assert.ok(w, 'VOLTIO pone el alambre');
    assert.ok(Math.hypot(w.c.pos.x - pos.x, w.c.pos.z - pos.z) < 1.9, 'en la marca');
    bots.dispose();
  }
  // ataque, en la acción: la cegadora de ROMPE antes que la granada de MURALLA, que está más cerca
  // (RADAR y LUMEN, con sus claymores, fuera de juego)
  {
    const M = match(7, { atk: ['rompe:1', 'termo:0', 'radar:0', 'muralla:0', 'lumen:1'], def: LINEUP.def, rules: { prepTime: 0 } });
    const { m, bots, g } = M;
    const said = acks(g);
    run(M, () => m.phase === 'action');
    freeze(m.opsOfSide('def'));
    freeze([opOf(M, 'radar'), opOf(M, 'lumen')]);
    const by = opOf(M, 'termo'), rompe = opOf(M, 'rompe');
    place(by, 16, 0.01, 10); place(rompe, 17, 0.01, 10); place(opOf(M, 'muralla'), 18, 0.01, 13);
    const pos = { x: 16, y: 0.05, z: 20, from: { x: 16, y: 1.64, z: 11 } };
    assert.equal(bots.order('gadget', by, pos), 1, 'alguien lo hace');
    assert.deepEqual(said.map((a) => [a.op.meta.opId, a.text]), [['rompe', 'Pongo la cegadora ahí']]);
    run(M, () => M.log.some((l) => l.what === 'cegadora'), 12);
    const f = M.log.find((l) => l.what === 'cegadora');
    assert.ok(M.log.some((l) => l.what === 'lanza:flash' && l.op === rompe), 'ROMPE lanza la cegadora');
    assert.ok(f && Math.hypot(f.p.x - pos.x, f.p.z - pos.z) < 3, 'cerca de la marca');
    bots.dispose();
  }
});

test('Novato: la defensa no usa C4, impacto ni estimulantes, y no se para con el escaneo', () => {
  const M = match(1, { ...LINEUP, diff: 'novato' });
  const { m } = M;
  run(M, () => m.phase === 'action' && m.rules.actionTime - m.timer > 40, 120);
  const def = M.log.filter((l) => l.op && l.op.side === 'def' && (l.what.startsWith('lanza:') || l.what === 'estimulante' || l.what.startsWith('explota:')));
  assert.equal(def.length, 0, 'nada: ' + def.map((l) => l.what).join(','));
  assert.ok([...M.bots.brains.values()].every((B) => !B.scanFreeze), 'nadie se queda quieto por un escaneo');
  M.bots.dispose();
});


// F6.6a · La defensa bot coloca gadgets y habilidades en la preparación, con la lógica del
// documento (sección 15): alambre en los pasillos junto a las puertas del sitio, escudo dentro
// del sitio, baterías en los muros reforzados, inhibidores cerca de ellos, minas en las puertas
// de acceso… Los bots en Novato no usan gadgets. TIZÓN activa el gas cuando un atacante pasa
// junto a uno de sus botes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { entrancesOf } from '../src/sim/ai/tactics.js';
import { GAS_TRIGGER } from '../src/sim/ai/gadgetai.js';
import { MAT } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);

function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }

// Partida solo de bots con la defensa (equipo 1) elegida: 'id' o 'id:gadget'.
function match(seed, ops, diff = 'normal') {
  settle();
  const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, diff, { nav });
  m.on('roundStart', () => bots.reset());
  const sl = m.slots.filter((s) => s.team === 1);
  ops.forEach((id, i) => { const [op, gi] = id.split(':'); sl[i].opId = op; sl[i].gadget = +(gi || 0); });
  const log = [];
  m.game.on('gadgetPlaced', (op, c) => { if (op.side === 'def') log.push({ op: op.meta.opId, c, phase: m.phase }); });
  m.game.on('gadgetThrown', (op, it) => { if (op.side === 'def') log.push({ op: op.meta.opId, c: it, phase: m.phase, thrown: true }); });
  m.start();
  return { m, bots, log };
}
function run(M, pred, maxT = 120) {
  for (let n = 0; n < maxT / TICK && !pred(); n++) { M.bots.update(TICK); M.m.tick(TICK); }
}
const siteRooms = (m) => [m.site.A, m.site.B].map((id) => map.rooms.find((r) => r.id === id));
const inRoom = (r, p) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1 && p.y > r.floorY - 0.5 && p.y < r.floorY + 3;
const inSite = (m, p) => siteRooms(m).some((r) => inRoom(r, p));
const siteEnts = (m, kinds) => siteRooms(m).flatMap((r) => entrancesOf(map, r).filter((e) => kinds.includes(e.kind)));
// ¿Hay algún vóxel de `mat` a menos de `r` m (en horizontal) y a la altura del punto?
function nearMat(p, mat, r) {
  for (let x = p.x - r; x <= p.x + r; x += 0.125) {
    for (let z = p.z - r; z <= p.z + r; z += 0.125) {
      if (Math.hypot(x - p.x, z - p.z) > r) continue;
      for (let y = p.y; y < p.y + 2; y += 0.25) if (world.getWorld(x, y, z) === mat) return true;
    }
  }
  return false;
}
const placed = (log, kind) => log.filter((l) => (l.c.kind || '') === kind).map((l) => l.c);

test('preparación: VOLTIO, SILENCIO, CEPO, OJO y CORAZA ponen alambres, baterías, escudo, inhibidores, alarma, minas, cámaras y placas con lógica', () => {
  const M = match(1, ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1']);
  let picked = 0;
  M.m.game.on('platePicked', () => picked++);
  // (como los refuerzos: en la preparación y, lo que no dé tiempo, en los primeros 15 s de la acción)
  run(M, () => M.m.phase === 'action' && M.m.rules.actionTime - M.m.timer > 15);
  const { m, log } = M;
  assert.equal(m.phase, 'action');
  assert.ok(log.filter((l) => l.phase === 'prep').length >= log.length * 0.8, 'casi todo en la preparación');
  // alambre: en el pasillo, pegado a una puerta del sitio (fuera de las salas del sitio)
  const wires = placed(log, 'barbed');
  assert.equal(wires.length, 2, 'los 2 alambres de VOLTIO');
  const doors = siteEnts(m, ['door', 'arch']);
  for (const w of wires) {
    assert.ok(!inSite(m, w.pos), `alambre fuera del sitio (${w.pos.x.toFixed(1)}, ${w.pos.z.toFixed(1)})`);
    assert.ok(doors.some((e) => Math.hypot(e.x - w.pos.x, e.z - w.pos.z) < 1.8), 'junto a una puerta del sitio');
  }
  // baterías: las 4, en refuerzos o barricadas
  const bats = placed(log, 'battery');
  assert.equal(bats.length, 4, 'las 4 baterías');
  for (const b of bats) assert.ok(b.host && (b.host.kind === 'reinforced' || b.host.kind === 'barricade' || b.host.kind === 'wire'), 'en un refuerzo, una barricada o un alambre');
  assert.ok(bats.filter((b) => b.host.kind === 'reinforced').length >= 2, 'sobre todo en muros reforzados');
  // escudo desplegable dentro del sitio
  const sh = log.filter((l) => l.c.kind === 'shield');
  assert.equal(sh.length, 1, 'el escudo de SILENCIO');
  assert.ok(inSite(m, sh[0].c.pos), 'escudo dentro del sitio');
  // inhibidores: cerca de muros reforzados
  const jams = placed(log, 'jammer');
  assert.ok(jams.length >= 3, 'inhibidores: ' + jams.length);
  assert.ok(jams.filter((j) => nearMat(j.pos, MAT.REINFORCED, 2.5)).length >= 2, 'junto a muros reforzados');
  // alarma y minas láser en los accesos del sitio
  const alarm = placed(log, 'alarm');
  assert.equal(alarm.length, 1);
  assert.ok(inSite(m, alarm[0].pos), 'alarma dentro del sitio');
  const mines = placed(log, 'lasermine');
  assert.ok(mines.length >= 4, 'minas láser: ' + mines.length);
  const opens = siteEnts(m, ['door', 'window']);
  for (const c of mines) assert.ok(opens.some((e) => Math.hypot(e.x - c.pos.x, e.z - c.pos.z) < e.w / 2 + 0.5), 'cada mina en el marco de un acceso del sitio');
  assert.equal(new Set(mines.map((c) => c.a.x.toFixed(1) + ',' + c.a.z.toFixed(1))).size, mines.length, 'cada una en un acceso distinto');
  // cámaras adhesivas de OJO: pegadas fuera del sitio
  const cams = log.filter((l) => l.op === 'ojo' && l.c.sticky);
  assert.ok(cams.length >= 2, 'cámaras adhesivas: ' + cams.length);
  for (const l of cams) {
    assert.ok(!inSite(m, l.c.pos), 'vigilan desde fuera del sitio');
    assert.ok(l.c.pos.y > 0.5, 'pegadas en una pared, no tiradas en el suelo');
  }
  // la bolsa de placas: los demás pasan a por la suya
  assert.equal(placed(log, 'platebag').length, 1);
  assert.ok(picked >= 4, 'placas cogidas: ' + picked);
  M.bots.dispose();
});

test('preparación: GUARDIÁN, TIZÓN y REMEDIO ponen cámara blindada, interceptores, alambres y botes de gas en el sitio', () => {
  const M = match(3, ['guardian:1', 'tizon:1', 'remedio:1', 'cepo:0', 'silencio:1']);
  run(M, () => M.m.phase === 'action');
  const { m, log } = M;
  const G = m.game.gadgets;
  // cámara blindada: en una pared del sitio, mirando hacia una entrada
  const bp = m.recon.cams.filter((c) => c.fromGadget && !c.sticky);
  assert.ok(bp.length >= 1, 'cámaras blindadas: ' + bp.length);
  for (const c of bp) {
    const p = c.pos;
    assert.ok(inSite(m, p), 'dentro del sitio');
    const fx = -Math.sin(c.baseYaw), fz = -Math.cos(c.baseYaw);
    assert.ok(siteEnts(m, ['door', 'arch']).some((e) => ((e.x - p.x) * fx + (e.z - p.z) * fz) / Math.hypot(e.x - p.x, e.z - p.z) > 0.7), 'mira hacia un acceso');
  }
  // interceptores de GUARDIÁN, uno por sala del sitio
  const ic = placed(log, 'interceptor');
  assert.equal(ic.length, 2);
  for (const c of ic) assert.ok(inSite(m, c.pos), 'en el sitio');
  assert.notEqual(siteRooms(m).findIndex((r) => inRoom(r, ic[0].pos)), siteRooms(m).findIndex((r) => inRoom(r, ic[1].pos)), 'uno en cada sala');
  // alambres (TIZÓN y REMEDIO): fuera del sitio
  for (const w of placed(log, 'barbed')) assert.ok(!inSite(m, w.pos), 'alambre en el pasillo');
  // botes de gas en el suelo del sitio, junto a las entradas, sin activar
  const cans = G.items.filter((it) => it.alive && it.kind === 'gas' && it.rest);
  assert.equal(cans.length, 3, 'los 3 botes en el suelo');
  const ents = siteEnts(m, ['door', 'arch', 'window']);
  for (const c of cans) assert.ok(ents.some((e) => Math.hypot(e.x - c.pos.x, e.z - c.pos.z) < 3.5), 'junto a una entrada');
  assert.equal(G.gasClouds.length, 0, 'sin activar en la preparación');
  M.bots.dispose();
});

test('Novato: los bots no usan gadgets ni habilidades', () => {
  const M = match(1, ['voltio:0', 'silencio:0', 'cepo:1', 'ojo:0', 'coraza:1'], 'novato');
  run(M, () => M.m.phase === 'action');
  assert.equal(M.log.length, 0, 'nada colocado: ' + M.log.map((l) => l.c.kind).join(','));
  M.bots.dispose();
});

test('acción: TIZÓN activa el gas cuando sabe de un atacante junto a un bote', () => {
  const M = match(3, ['guardian:1', 'tizon:1', 'remedio:1', 'cepo:0', 'silencio:1']);
  run(M, () => M.m.phase === 'action');
  const { m, bots } = M;
  const G = m.game.gadgets;
  const tizon = m.game.operators.find((o) => o.meta && o.meta.opId === 'tizon');
  const cans = G.items.filter((it) => it.alive && it.kind === 'gas' && it.rest && it.owner === tizon);
  assert.ok(cans.length >= 2);
  // un atacante conocido lejos de los botes: no pasa nada
  const atk = m.game.operators.find((o) => o.side === 'atk' && o.state === 'alive');
  const board = bots.boards[tizon.team];
  const far = { x: cans[0].pos.x + 12, y: cans[0].pos.y, z: cans[0].pos.z };
  for (let i = 0; i < 90; i++) { board.report(atk, far, m.game.time, true, 0.8); bots.update(TICK); m.tick(TICK); }
  assert.equal(G.gasClouds.length, 0, 'lejos: no lo activa');
  // junto a un bote (lo marca el equipo): lo activa
  const c = cans[0];
  const near = { x: c.pos.x + GAS_TRIGGER * 0.5, y: c.pos.y, z: c.pos.z };
  let n = 0;
  while (!G.gasClouds.length && n++ < 150) { board.report(atk, near, m.game.time, true, 0.8); bots.update(TICK); m.tick(TICK); }
  assert.ok(G.gasClouds.length >= 1, 'gas activado');
  assert.ok(G.gasClouds.every((g) => g.owner === tizon));
  M.bots.dispose();
});

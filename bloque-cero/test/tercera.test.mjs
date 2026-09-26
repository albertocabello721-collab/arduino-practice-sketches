// Fase 7.4: tercera persona por capas. La pose de la simulación (la de las zonas de impacto)
// recarga por partes, hace con las manos lo que hace el operador y deja las piernas a su aire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { BONE, HITBOXES, computePose, makePoseState } from '../src/sim/skeleton.js';
import { reloadTrack, reloadMag, RELOAD_ANCHORS, actionPose } from '../src/sim/poselayers.js';
import { reloadPlan, WEAPONS } from '../src/sim/weapons.js';

const world = createVillaWorld();
const map = buildVilla(world);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const inGun = (op, g) => { const b = op.rig[BONE.gun], R = b.R; return { x: b.p.x + R.x.x * g[0] + R.y.x * g[1] + R.z.x * g[2], y: b.p.y + R.x.y * g[0] + R.y.y * g[1] + R.z.y * g[2], z: b.p.z + R.x.z * g[0] + R.y.z * g[1] + R.z.z * g[2] }; };
function setup(loadout = ['ar', 'pistol']) {
  world.resetToPristine();
  const game = new Game({ world, map, seed: 7 });
  const op = game.addOperator(new Operator('a', { name: 'A', team: 0, x: 15.5, y: 0, z: -9.5, yaw: 0, loadout, bot: true }));
  const run = (s) => { for (let i = 0; i < Math.round(s / TICK); i++) game.tick(); };
  run(0.5);
  return { game, op, run };
}

test('recarga por partes en tercera persona: la mano va al cargador, lo suelta, coge otro y vuelve al guardamanos', () => {
  const { op, run } = setup();
  const w = op.weapon;
  run(0.3);
  const fore0 = op.rig[BONE.handL].p;
  w.ammo = 12; op.intent.reload = true;
  run(TICK);
  assert.ok(w.reloadT > 0 && w.plan, 'no empezó a recargar');
  const out = w.plan.parts.find((p) => p.part === 'magOut').at, inn = w.plan.parts.find((p) => p.part === 'magIn').at;
  const mags = new Set();
  let near = Infinity;
  for (let t = TICK; t < w.reloadTotal + 0.4; t += TICK) {
    run(TICK);
    mags.add(op.pose.mag);
    const el = w.reloadTotal - w.reloadT;
    if (w.reloadT > 0 && Math.abs(el - out) < 0.03) near = Math.min(near, dist(op.rig[BONE.handL].p, inGun(op, RELOAD_ANCHORS.mag.g)));
    if (w.reloadT > 0 && el > out + 0.02 && el < (out + inn) / 2 - 0.02) assert.equal(op.pose.mag, 2, 'el cargador tendría que estar fuera');
  }
  assert.ok(near < 0.12, `la mano no llega al cargador (${near.toFixed(3)} m)`);
  assert.deepEqual([...mags].sort(), [0, 1, 2]);
  assert.equal(op.pose.mag, 0);
  assert.ok(dist(op.rig[BONE.handL].p, fore0) < 0.03, 'la mano no volvió al guardamanos');
});

test('la pista de recarga de cada familia empieza y acaba en el guardamanos y el cargador acaba dentro', () => {
  for (const [id, ammo] of [['ar', 0], ['ar', 12], ['pistol', 0], ['lmg', 0], ['revolver', 2], ['shotgun', 0], ['shotgun', 5]]) {
    const def = WEAPONS[id], plan = reloadPlan(def, ammo, def.reserve);
    const tr = reloadTrack(plan, def.model);
    assert.equal(tr.keys[0][1], 'fore', id);
    assert.equal(tr.keys[tr.keys.length - 1][1], 'fore', id);
    for (let i = 1; i < tr.keys.length; i++) assert.ok(tr.keys[i][0] > tr.keys[i - 1][0], `${id}: instantes no crecientes`);
    for (const [, a] of tr.keys) assert.ok(a in RELOAD_ANCHORS, `${id}: ${a}`);
    assert.equal(reloadMag(tr, plan.total), 0, id);
  }
  // recarga que empieza sin cargador (se interrumpió tras sacarlo): fuera hasta coger el nuevo
  const def = WEAPONS.ar, tr = reloadTrack(reloadPlan(def, 1, def.reserve, true), def.model);
  assert.equal(reloadMag(tr, 0.05), 2);
});

test('plantar, reforzar y reanimar: las dos manos a la acción y el arma colgando delante', () => {
  for (const kind of ['plant', 'reinforce', 'barricade', 'gadget', 'disable']) {
    const { op, run } = setup();
    const chest0 = op.rig[BONE.chest].p;
    op.channel = { kind, t: 0, total: 4 };
    for (let i = 0; i < 30; i++) { op.channel.t += TICK; run(TICK); }
    const L = op.rig[BONE.handL].p, R = op.rig[BONE.handR].p, gun = op.rig[BONE.gun].p;
    assert.ok(dist(gun, R) > 0.2, `${kind}: el arma sigue en la mano`);
    assert.ok(Math.abs(L.x - R.x) + Math.abs(L.z - R.z) < 0.6, `${kind}: manos separadas`);
    if (kind === 'plant' || kind === 'disable' || kind === 'gadget') assert.ok(L.y < chest0.y - 0.35, `${kind}: las manos no bajan (${(chest0.y - L.y).toFixed(2)})`);
    if (kind === 'reinforce') assert.ok(Math.abs(L.y - op.rig[BONE.chest].p.y) < 0.35, 'reforzar: manos a la altura del pecho');
    op.channel = null;
    run(0.4);
    assert.ok(dist(op.rig[BONE.gun].p, op.rig[BONE.handR].p) < 0.02, `${kind}: el arma no vuelve a la mano`);
  }
});

test('lanzar: el brazo izquierdo acompaña el tiro y vuelve; las piernas siguen andando mientras recarga', () => {
  const { op, run } = setup();
  const fore0 = op.rig[BONE.handL].p;
  op.startAnim('throw');
  let most = 0;
  for (let i = 0; i < 40; i++) { run(TICK); most = Math.max(most, dist(op.rig[BONE.handL].p, fore0)); }
  assert.ok(most > 0.4, `el brazo apenas se mueve al lanzar (${most.toFixed(2)} m)`);
  run(0.2);
  assert.ok(dist(op.rig[BONE.handL].p, fore0) < 0.03);
  // andando y recargando a la vez: los pies se siguen moviendo
  op.weapon.ammo = 5; op.intent.reload = true; op.intent.moveZ = 1;
  const feet = [];
  for (let i = 0; i < 40; i++) { run(TICK); feet.push(op.rig[BONE.footL].p.z - op.body.pos.z); }
  assert.ok(op.weapon.reloadT > 0);
  assert.ok(Math.max(...feet) - Math.min(...feet) > 0.15, 'las piernas no andan mientras recarga');
});

test('ninguna capa rompe la pose: sin NaN de pie, agachado, tumbado, derribado ni muerto', () => {
  const kinds = ['reinforce', 'barricade', 'gadget', 'plant', 'disable', 'revive', 'throw', 'drone', 'vault'];
  const def = WEAPONS.ar, tr = reloadTrack(reloadPlan(def, 0, def.reserve), def.model);
  for (const st of [{}, { crouch: 1 }, { prone: 1 }, { downed: 1 }, { dead: 1 }]) {
    for (const k of kinds) {
      const s = { ...makePoseState(), ...st, acts: { [k]: { w: 1, t: 0.3, dur: 1 } }, rl: tr, rlT: 0.9, rlW: 1, equip: 0.5, kick: 1, vault: k === 'vault' ? 0.5 : 0 };
      const out = new Float32Array(20 * 16);
      const rig = computePose(s, out, null);
      for (let i = 0; i < 19; i++) assert.ok(rig[i] && Number.isFinite(rig[i].p.x + rig[i].p.y + rig[i].p.z), `${k} ${JSON.stringify(st)}: hueso ${i}`);
      assert.ok(out.every(Number.isFinite));
      assert.ok(actionPose(k, 0.3, 1));
    }
  }
});

test('las zonas de impacto siguen al cuerpo: al plantar, la cabeza baja y va hacia delante', () => {
  const { op, run } = setup();
  op.intent.stance = 'crouch';
  run(0.6);
  const head0 = op.rig[BONE.head].p;
  op.channel = { kind: 'plant', t: 0, total: 7 };
  for (let i = 0; i < 30; i++) { op.channel.t += TICK; run(TICK); }
  const head1 = op.rig[BONE.head].p;
  const fwd = { x: -Math.sin(op.yaw), z: -Math.cos(op.yaw) };
  assert.ok(head1.y < head0.y - 0.02, 'la cabeza no baja');
  assert.ok((head1.x - head0.x) * fwd.x + (head1.z - head0.z) * fwd.z > 0.05, 'la cabeza no va hacia delante');
  assert.ok(HITBOXES.some(([b]) => b === BONE.head));
});

test('coste: una pose con todas las capas cuesta menos de 25 µs', () => {
  const def = WEAPONS.ar, tr = reloadTrack(reloadPlan(def, 0, def.reserve), def.model);
  const s = { ...makePoseState(), acts: { plant: { w: 0.6, t: 1, dur: 7 }, throw: { w: 0.4, t: 0.2, dur: 0.55 } }, rl: tr, rlT: 1.2, rlW: 1, kick: 0.5, walkAmount: 1, walkPhase: 1 };
  const rig = new Array(20);
  for (let i = 0; i < 2000; i++) computePose(s, null, rig);
  const n = 20000, t0 = performance.now();
  for (let i = 0; i < n; i++) { s.walkPhase += 0.01; computePose(s, null, rig); }
  const us = ((performance.now() - t0) / n) * 1000;
  assert.ok(us < 25, `${us.toFixed(1)} µs por pose`);
});

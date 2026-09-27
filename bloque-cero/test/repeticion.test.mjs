// Fase 7.6: repetición de muerte. El dibujo guarda los últimos segundos como datos y, al morir a
// manos de un operador, repite los 4 s anteriores y medio segundo después desde sus ojos. Aquí se
// prueba con la simulación de verdad y un dibujo de mentira (lo que se pinta, se apunta).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { BONE, BONE_COUNT } from '../src/sim/skeleton.js';
import { DeathReplay, ReplayBuffer, REPLAY, wantsReplay, replayCard } from '../src/client/replay.js';

const world = createVillaWorld();
const map = buildVilla(world);

// dibujo de mentira: los huesos salen de la pose de la simulación; lo pintado se apunta
function fakeCtx() {
  const log = { applied: [], card: null, progress: 0, tracers: 0, flashes: 0, blood: 0, shotsLocal: 0, shotsFar: 0, kicks: 0, ended: 0 };
  const chars = {
    capture(op, out, o) {
      for (let i = 0; i < BONE_COUNT; i++) {
        const b = op.rig[i], d = o + i * 12;
        if (!b) { out.fill(0, d, d + 12); continue; }
        out[d] = b.R.x.x; out[d + 1] = b.R.x.y; out[d + 2] = b.R.x.z;
        out[d + 3] = b.R.y.x; out[d + 4] = b.R.y.y; out[d + 5] = b.R.y.z;
        out[d + 6] = b.R.z.x; out[d + 7] = b.R.z.y; out[d + 8] = b.R.z.z;
        out[d + 9] = b.p.x; out[d + 10] = b.p.y; out[d + 11] = b.p.z;
      }
      return { on: true, x: op.body.pos.x, y: op.body.pos.y, z: op.body.pos.z, yaw: op.yaw, sx: 0.75, sz: 0.75 };
    },
    applyReplay(list) { log.applied = list.map((e) => ({ op: e.op, vis: e.vis, pelvisY: e.bones[BONE.pelvis * 12 + 10], blob: !!e.blob })); },
    endReplay() { log.ended++; },
  };
  const ctx = {
    chars, settings: { fov: 70 }, occlusion: () => 0, paused: false,
    hud: { replay(c) { log.card = c; }, replayProgress(f) { log.progress = f; } },
    effects: { bloodHit() { log.blood++; }, flash() { log.flashes++; }, addTracer() { log.tracers++; } },
    audio: { gunshot(kind, pos, local) { if (local) log.shotsLocal++; else log.shotsFar++; } },
    vm: { onShot() { log.kicks++; } },
  };
  return { ctx, log };
}

// el tirador (en la calle, mirando al norte) mata al otro a 6 m; se graba todo
function duel({ headshot = false, ads = false, seconds = 9 } = {}) {
  world.resetToPristine();
  const game = new Game({ world, map, seed: 3 });
  const killer = game.addOperator(new Operator('k', { name: 'TIZÓN', team: 1, x: 15.5, y: 0, z: -15, yaw: Math.PI, loadout: ['ar', 'pistol'], bot: true }));
  const victim = game.addOperator(new Operator('v', { name: 'Tú', team: 0, x: 15.5, y: 0, z: -9, yaw: 0, loadout: ['ar', 'pistol'], bot: true }));
  const bystander = game.addOperator(new Operator('b', { name: 'OJO', team: 0, x: 18.5, y: 0, z: -11, yaw: 0, loadout: ['ar', 'pistol'], bot: true }));
  killer.opDef = { id: 'tizon', name: 'TIZÓN' };
  const { ctx, log } = fakeCtx();
  const R = new DeathReplay(ctx);
  let t = 0, death = null, killerShots = [];
  game.on('shot', (op, w, eye, fwd, results) => { R.onShot(t, op, w, eye, results); if (op === killer) killerShots.push(t); });
  game.on('damaged', (tg, ev) => R.onHit(t, tg, ev));
  game.on('killed', (tg, ev) => { R.onHit(t, tg, ev); if (tg === victim && !death) { death = { t, ev: { ...ev } }; } });
  const aim = () => {
    const e = killer.eyePos(), c = victim.rig[headshot ? BONE.head : BONE.chest].p;
    const dx = c.x - e.x, dy = c.y + (headshot ? 0.1 : 0.08) - e.y, dz = c.z - e.z;
    killer.yaw = Math.atan2(-dx, -dz); killer.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  // 4,5 s tranquilos (apuntando, si toca), luego dispara hasta matarlo
  for (; t < seconds; t += TICK) {
    killer.intent.ads = ads;
    if (t > 3.5 && !death) aim();
    if (t > 4.5 && !death) killer.intent.fire = true; else killer.intent.fire = false;
    game.tick();
    R.record(t, game);
    if (death && !R.active && death.started === undefined) death.started = R.start(victim, death.ev, death.t);
    if (death && t > death.t + 0.1) break;
  }
  return { game, killer, victim, bystander, R, log, death, killerShots, get t() { return t; }, step() { t += TICK; game.tick(); R.record(t, game); return t; } };
}

test('solo hay repetición si te mató otro operador (no una caída, tu granada ni desangrarte)', () => {
  const me = { name: 'Tú' }, other = { name: 'RADAR' };
  assert.equal(wantsReplay({ by: other, zone: 'body', dir: { x: 1, y: 0, z: 0 } }, me), true);
  assert.equal(wantsReplay({ by: other, zone: 'head', headshot: true }, me), true);
  assert.equal(wantsReplay({ by: me, zone: 'body', weapon: { explosive: true } }, me), false);   // tu granada
  assert.equal(wantsReplay({ by: other, zone: 'fall' }, me), false);                             // caída (aunque te hubieran dado)
  assert.equal(wantsReplay({ by: other, zone: 'bleed', bleed: true }, me), false);               // te desangras
  assert.equal(wantsReplay({ by: null, zone: 'body' }, me), false);
  assert.equal(wantsReplay(null, me), false);
});

test('la tarjeta: nombre, operador, arma, vida que le quedó y distancia', () => {
  const k = { name: 'TIZÓN', team: 1, opDef: { id: 'tizon', name: 'TIZÓN' }, hp: 63.6, maxHp: 120, state: 'alive', body: { pos: { x: 0, y: 0, z: 0 } }, weapon: { def: { name: 'AL-60' } } };
  const me = { team: 0, body: { pos: { x: 3, y: 0, z: 4 } } };
  const c = replayCard({ by: k, weapon: { name: 'AL-60 Rugido' }, headshot: true }, me);
  assert.deepEqual({ name: c.name, op: c.op, opId: c.opId, weapon: c.weapon, hp: c.hp, maxHp: c.maxHp, dist: c.dist, headshot: c.headshot, ally: c.ally },
    { name: 'TIZÓN', op: 'TIZÓN', opId: 'tizon', weapon: 'AL-60 Rugido', hp: 64, maxHp: 120, dist: 5, headshot: true, ally: false });
});

test('el búfer guarda los últimos 4,3 s a 30 por segundo, localiza e interpola (los ángulos por el camino corto)', () => {
  const buf = new ReplayBuffer();
  const op = {};
  const s = buf.slot(op);
  for (let k = 0; k < 400; k++) {
    const t = k / 60;
    if (!buf.due(t)) continue;
    const i = buf.begin(t);
    buf.S[buf.sOff(i, s) + 5] = Math.PI - 0.1 + (k % 2 ? 0.2 : 0);   // el giro salta de un lado a otro de ±π
    buf.S[buf.sOff(i, s) + 2] = t;                                 // x = t
    buf.B[buf.bOff(i, s) + 9] = 2 * t;
  }
  assert.ok(buf.count <= buf.N && buf.newest() - buf.oldest() >= REPLAY.keep - 0.1, `${buf.oldest()}…${buf.newest()}`);
  const L = buf.locate(5.0);
  assert.ok(L.a >= 0 && L.a <= 1 && buf.T[L.i0] <= 5.0 && buf.T[L.i1] >= 5.0);
  assert.ok(Math.abs(buf.at(s, L, 2) - 5.0) < 1e-4, 'la posición no se interpola');
  const bones = buf.bonesAt(s, L, new Float32Array(BONE_COUNT * 12));
  assert.ok(Math.abs(bones[9] - 10) < 1e-3);
  // entre π−0,1 y −π+0,1 (casi lo mismo) no da la vuelta entera
  const a = buf.at(s, L, 5, true);
  assert.ok(Math.abs(Math.abs(a) - Math.PI) < 0.2, `giro interpolado ${a}`);
});

test('muerto de un tiro: se repite desde los ojos del que te mató, 4 s antes y 0,5 s después, y termina', () => {
  const D = duel();
  const { R, log, death, killer, victim, bystander } = D;
  assert.ok(death, 'no murió');
  assert.ok(death.started && R.active, 'no empezó la repetición');
  assert.equal(log.card.name, 'TIZÓN');
  assert.ok(Math.abs(log.card.dist - 6) < 0.5, `distancia ${log.card.dist}`);
  assert.ok(Math.abs(R.t1 - R.t0 - (REPLAY.before + REPLAY.after)) < 1e-6);
  const seen = [];
  let frames = 0, running = true;
  while (running && frames < 400) {
    D.step();
    running = R.frame(TICK);
    frames++;
    if (!running) break;
    const P = R.pose(70), rt = R.t0 + R.clock - TICK;
    const k = log.applied.find((e) => e.op === killer), v = log.applied.find((e) => e.op === victim), b = log.applied.find((e) => e.op === bystander);
    seen.push({ rt, P: { ...P }, killerVis: k.vis, victimVis: v.vis, victimPelvis: v.pelvisY, bystander: !!b && b.vis });
  }
  // dura lo que tiene que durar (4,5 s a 60 fotogramas por segundo)
  assert.ok(Math.abs(frames * TICK - (REPLAY.before + REPLAY.after)) < 0.05, `${(frames * TICK).toFixed(2)} s`);
  assert.equal(R.active, false);
  assert.ok(log.ended >= 1, 'no devolvió el dibujo');
  // el que te mató no se ve (la cámara está en sus ojos); tú y los demás, sí
  assert.ok(seen.every((f) => !f.killerVis && f.victimVis && f.bystander));
  // la cámara está en sus ojos (a 1,4–1,8 m del suelo, en su sitio) y mira hacia ti
  for (const f of seen) {
    assert.ok(Math.abs(f.P.x - killer.body.pos.x) < 0.3 && Math.abs(f.P.z - killer.body.pos.z) < 0.3 && f.P.y > 1.2 && f.P.y < 1.9, JSON.stringify(f.P));
  }
  const late = seen.filter((f) => f.rt > death.t - 1 && f.rt < death.t);
  assert.ok(late.length && late.every((f) => Math.abs(Math.cos(f.P.yaw) + 1) < 0.1), 'no mira hacia la víctima');
  // antes de morir estás de pie; medio segundo después ya estás cayendo
  const before = seen.filter((f) => f.rt < death.t - 0.2), after = seen.filter((f) => f.rt > death.t + 0.4);
  assert.ok(before.every((f) => f.victimPelvis > 0.7), 'no estabas de pie');
  assert.ok(after.length && after.every((f) => f.victimPelvis < before[before.length - 1].victimPelvis - 0.05), 'no se te ve caer');
});

test('sus disparos se repiten: fogonazo, trazadoras, su sonido y el retroceso de su arma', () => {
  const D = duel();
  const { R, log, death, killerShots } = D;
  const inWindow = killerShots.filter((s) => s > R.t0 && s <= R.t1).length;
  assert.ok(inWindow >= 1, 'no disparó');
  while (R.frame(TICK)) D.step();
  assert.equal(log.kicks, inWindow, 'retroceso');
  assert.equal(log.shotsLocal, inWindow, 'sonido');
  assert.ok(log.flashes >= inWindow && log.tracers >= 1);
  assert.ok(log.blood >= 1, 'sin sangre');
  assert.ok(death.t > R.t0 && death.t < R.t1);
});

test('el arma en primera persona es la suya, con su zoom al apuntar', () => {
  const D = duel({ ads: true });
  const { R, killer } = D;
  let most = 0, narrow = 70;
  while (R.frame(TICK)) {
    D.step();
    assert.equal(R.vmOp.weapon.def, killer.weapons[0].def);
    most = Math.max(most, R.vmOp.ads);
    narrow = Math.min(narrow, R.pose(70).fov);
  }
  assert.ok(most > 0.9, `no apuntaba (${most})`);
  assert.ok(narrow < 70 / killer.weapons[0].def.adsZoom + 3, `sin zoom (${narrow.toFixed(1)}°)`);
});

test('Espacio: al pararla, el dibujo vuelve a lo de ahora; sin datos suficientes no hay repetición', () => {
  const D = duel();
  const { R, log } = D;
  R.frame(TICK);
  R.stop();
  assert.equal(R.active, false);
  assert.equal(log.ended, 1);
  assert.equal(log.card, null);
  // recién empezada la ronda (menos de 1 s grabado): nada
  const fresh = new DeathReplay(fakeCtx().ctx);
  const game = new Game({ world, map, seed: 1 });
  const a = game.addOperator(new Operator('a', { name: 'A', team: 0, x: 15.5, y: 0, z: -12, yaw: 0 }));
  const b = game.addOperator(new Operator('b', { name: 'B', team: 1, x: 15.5, y: 0, z: -9, yaw: Math.PI }));
  for (let t = 0; t < 0.4; t += TICK) { game.tick(); fresh.record(t, game); }
  assert.equal(fresh.start(a, { by: b, zone: 'body' }, 0.4), false);
});

test('coste: grabar 10 operadores cuesta poco y ocupa menos de 1,5 MB', () => {
  const game = new Game({ world, map, seed: 2 });
  for (let i = 0; i < 10; i++) game.addOperator(new Operator('o' + i, { name: 'O' + i, team: i % 2, x: 10 + i, y: 0, z: -12, yaw: 0 }));
  for (let i = 0; i < 5; i++) game.tick();
  const R = new DeathReplay(fakeCtx().ctx);
  for (let k = 0; k < 200; k++) R.record(k / 30, game);
  const n = 600, t0 = performance.now();
  for (let k = 0; k < n; k++) R.record(10 + k / 30, game);
  const us = ((performance.now() - t0) / n) * 1000;
  assert.ok(us < 120, `${us.toFixed(0)} µs por muestra`);
  const bytes = R.buf.B.byteLength + R.buf.S.byteLength;
  console.log(`grabar: ${us.toFixed(1)} µs por muestra · ${(bytes / 1048576).toFixed(2)} MB`);
  assert.ok(bytes < 1.5 * 1024 * 1024, `${(bytes / 1048576).toFixed(2)} MB`);
});

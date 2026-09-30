// F10.6 · Puntería humana de los bots: reaccionan sin girarse, giran con velocidad limitada (a
// veces se pasan), esperan un momento tras un giro largo, sus primeros disparos llevan más error,
// ven el retroceso tarde y tardan en notar que cambias de dirección.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor, DIFFICULTY } from '../src/sim/bots.js';
import { Aim, Trails, AIM } from '../src/sim/ai/aim.js';
import { lineOfSight } from '../src/world/raycast.js';
import { angleDiff } from '../src/core/math.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const DEG = Math.PI / 180;
function settle() { world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update(); }
function place(op, x, y, z) { op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0; }

// Un duelo en la calle, al oeste de la casa: un atacante bot quieto mirando al norte (+z) y un
// defensor sin cerebro (no se mueve ni dispara) que aparece de golpe a `dist` m y `angle` del centro
// de su vista. Devuelve lo que pasó paso a paso desde que aparece.
function duel(diff, seed, { angle = 0, dist = 10, secs = 2, ctrl = null } = {}) {
  settle();
  const m = new Match({ world, map, seed, rules: { selectTime: 0, prepTime: 0, actionTime: 120 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, diff, { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  for (let i = 0; i < 600 && m.phase !== 'action'; i++) { bots.update(TICK); m.tick(TICK); }
  const a = m.opsOfSide('atk')[0], d = m.opsOfSide('def')[0];
  for (const o of m.game.operators) if (o !== a && o !== d) m.game.kill(o, { by: null });
  bots.brains.delete(d);
  const B = bots.brains.get(a);
  const P = { x: -6, y: 0, z: 12, yaw: Math.PI };
  place(a, P.x, 0.01, P.z); a.yaw = P.yaw; a.pitch = 0;
  B.post = P; B.task = null; B.thinkT = 0;
  place(d, 6, -3.49, 6);          // (en el sótano: fuera de su vista)
  for (let i = 0; i < 60; i++) { B.scanT = 1e9; B.scanYaw = P.yaw; bots.update(TICK); d.intent.fire = false; m.tick(TICK); }
  if (ctrl !== null) a.recoilControl = ctrl;
  // aparece: a `dist` m, `angle` a la izquierda (+) o a la derecha (−) de donde mira
  a.yaw = P.yaw; a.pitch = 0;
  const yawT = P.yaw + angle, e = a.eyePos();
  place(d, e.x - Math.sin(yawT) * dist, 0.01, e.z - Math.cos(yawT) * dist);
  d.yaw = yawT + Math.PI;
  const q = d.body.pos;       // (la pose se pone al día en el siguiente paso)
  assert.ok(lineOfSight(world, e.x, e.y, e.z, q.x, q.y + 1.2, q.z), 'se ven');
  const out = { m, bots, B, a, d, ticks: [] };
  const shots0 = a.stats.shots;
  let yaw0 = a.yaw;
  for (let i = 0; i < secs * 60; i++) {
    B.scanT = 1e9; B.scanYaw = P.yaw;
    bots.update(TICK);
    d.intent.fire = false; d.intent.moveX = 0; d.intent.moveZ = 0;
    m.tick(TICK);
    const c2 = d.center(), e2 = a.eyePos();
    const toT = Math.abs(angleDiff(a.yaw, Math.atan2(-(c2.x - e2.x), -(c2.z - e2.z))));
    out.ticks.push({ t: (i + 1) * TICK, phase: B.aim.phase, yaw: a.yaw, pitch: a.pitch, rate: Math.abs(angleDiff(yaw0, a.yaw)) / TICK, shots: a.stats.shots - shots0, toT, rec: a.recoilOffset.pitch });
    yaw0 = a.yaw;
  }
  return out;
}
const firstT = (ticks, f) => { const k = ticks.find(f); return k ? k.t : Infinity; };

test('la tabla: reacción del documento, giro limitado, error de los primeros disparos y retroceso por dificultad', () => {
  const want = {
    novato: { react: 0.70, aimSpeed: 250, firstErr: 4.0, aimErr: 1.8, recoil: 0.20, lag: 0.20, flickWait: 0.20 },
    normal: { react: 0.45, aimSpeed: 350, firstErr: 2.8, aimErr: 1.0, recoil: 0.35, lag: 0.16, flickWait: 0.15 },
    veterano: { react: 0.30, aimSpeed: 450, firstErr: 2.0, aimErr: 0.6, recoil: 0.50, lag: 0.13, flickWait: 0.11 },
    elite: { react: 0.22, aimSpeed: 550, firstErr: 1.4, aimErr: 0.35, recoil: 0.65, lag: 0.10, flickWait: 0.08 },
  };
  for (const [k, w] of Object.entries(want)) {
    const D = DIFFICULTY[k];
    const got = { react: D.react, aimSpeed: D.aimSpeed, firstErr: +(D.firstErr / DEG).toFixed(2), aimErr: +(D.aimErr / DEG).toFixed(2), recoil: D.recoil, lag: D.lag, flickWait: D.flickWait };
    assert.deepEqual(got, w, k);
  }
  assert.deepEqual(DIFFICULTY.elite.overshoot, [0.03, 0.06]);
  assert.deepEqual(DIFFICULTY.novato.overshoot, [0.08, 0.12]);
});

test('de frente: reacciona sin moverse (Élite, 220 ms ±20 %) y el primer disparo sale después, nunca a la vez', () => {
  for (const seed of [3, 7, 12]) {
    const R = duel('elite', seed, { angle: 0 });
    const D = DIFFICULTY.elite;
    const moved = firstT(R.ticks, (k) => k.phase === 'flick' || k.phase === 'track');
    const shot = firstT(R.ticks, (k) => k.shots > 0);
    // (lo descubre en un barrido de la vista, cada 0,12 s, y cuenta desde cuándo lo habría visto)
    assert.ok(moved >= D.react * 0.8 - 1e-6 && moved <= D.react * 1.2 + AIM.peripheral + 0.02, `semilla ${seed}: empieza a apuntar a los ${moved.toFixed(3)} s`);
    // (`moved` es el primer paso en que ya apunta: ese paso cuenta para el gatillo)
    assert.ok(shot >= moved + AIM.trigger - TICK - 1e-6 && shot < 1.2, `semilla ${seed}: primer disparo a los ${shot.toFixed(3)} s (apunta desde ${moved.toFixed(3)})`);
    // mientras reacciona, la vista quieta
    for (const k of R.ticks) if (k.t < moved - 1e-6) assert.ok(k.rate < 1e-6, `semilla ${seed}: se movió reaccionando (${k.t.toFixed(3)} s)`);
    R.bots.dispose();
  }
});

test('a 35°: no se gira hasta reaccionar, gira como mucho a 550°/s y tras el giro espera antes de disparar', () => {
  for (const seed of [3, 7]) {
    const F = duel('elite', seed, { angle: 0, dist: 8 }), T = duel('elite', seed, { angle: 35 * DEG, dist: 8 });
    const D = DIFFICULTY.elite;
    const moved = firstT(T.ticks, (k) => k.phase === 'flick' || k.phase === 'track');
    const shotT = firstT(T.ticks, (k) => k.shots > 0), shotF = firstT(F.ticks, (k) => k.shots > 0);
    const movedF = firstT(F.ticks, (k) => k.phase === 'flick' || k.phase === 'track');
    for (const k of T.ticks) {
      if (k.t < moved - 1e-6) assert.ok(k.rate < 1e-6, `semilla ${seed}: se giró reaccionando (${k.t.toFixed(3)} s)`);
      assert.ok(k.rate <= D.aimSpeed * DEG * 1.01, `semilla ${seed}: giro de ${(k.rate / DEG).toFixed(0)}°/s`);
    }
    // girar 35° (mín. ~0,12 s) y esperar 0,08 s: al menos 0,15 s más, desde que acaba la reacción
    assert.ok(shotT - moved >= (shotF - movedF) + 0.15, `semilla ${seed}: de frente dispara ${(shotF - movedF).toFixed(3)} s tras reaccionar; a 35°, ${(shotT - moved).toFixed(3)} s`);
    // y durante el giro no dispara
    for (const k of T.ticks) if (k.phase === 'flick') assert.equal(k.shots, 0, `semilla ${seed}: disparó girando`);
    F.bots.dispose(); T.bots.dispose();
  }
});

test('el retroceso: sube la mira y no lo corrige hasta pasado su retraso', () => {
  // la misma escena dos veces: con el retroceso de Élite y sin subida del arma (compensación total)
  const R = duel('elite', 5, { angle: 0, dist: 15, secs: 1.5 }), Z = duel('elite', 5, { angle: 0, dist: 15, secs: 1.5, ctrl: 1 });
  const i0 = R.ticks.findIndex((k) => k.shots > 0);
  assert.ok(i0 >= 0 && i0 === Z.ticks.findIndex((k) => k.shots > 0), 'disparan a la vez');
  const lag = Math.round(DIFFICULTY.elite.recoilLag / TICK);
  const diff = (i) => R.ticks[i].pitch - Z.ticks[i].pitch;
  // hasta que lo ve, la diferencia (lo que ha subido el arma) crece y no se corrige
  const upTo = Math.max(...Array.from({ length: lag }, (_, j) => diff(i0 + j)));
  assert.ok(upTo > 0.15 * DEG, `el arma sube ${(upTo / DEG).toFixed(2)}°`);
  assert.ok(diff(i0 + lag - 1) > upTo * 0.75, `a los ${DIFFICULTY.elite.recoilLag} s sigue arriba (${(diff(i0 + lag - 1) / DEG).toFixed(2)}° de ${(upTo / DEG).toFixed(2)}°)`);
  R.bots.dispose(); Z.bots.dispose();
});

test('cambias de dirección: tarda su retraso en notarlo (lo cree donde iba)', () => {
  const tr = new Trails();
  const fake = () => ({ body: { pos: { x: 0, y: 0, z: 0 } }, yaw: 0, rig: [], eyePos(o) { o.x = this.body.pos.x; o.y = this.body.pos.y + 1.6; o.z = this.body.pos.z; return o; }, center(o) { o.x = this.body.pos.x; o.y = this.body.pos.y + 1.15; o.z = this.body.pos.z; return o; } });
  const t = fake();
  const B = { sq: { trails: tr }, diff: { ...DIFFICULTY.elite }, game: { time: 0 }, per: { visible: [t] }, rng: { next: () => 0.5 } };
  const A = new Aim(B);
  // 1 s hacia +x a 3 m/s y luego 0,05 s hacia −x
  for (let i = 0; i < 60; i++) { t.body.pos.x += 3 * TICK; tr.record([t]); B.game.time += TICK; }
  for (let i = 0; i < 3; i++) { t.body.pos.x -= 3 * TICK; tr.record([t]); B.game.time += TICK; }
  const sh = A._perceived(t);
  assert.ok(sh.x > 0.2, `lo cree ${sh.x.toFixed(2)} m más allá (sigue hacia +x)`);
  // yendo siempre igual, lo cree donde está
  const t2 = fake();
  B.per.visible = [t2];
  for (let i = 0; i < 30; i++) { t2.body.pos.x += 3 * TICK; tr.record([t2]); }
  assert.ok(Math.abs(A._perceived(t2).x) < 0.01, 'a velocidad constante, lo ve donde está');
});

test('partida de Élite: ningún disparo acertado al blanco antes de reaccionar y apuntar, y nunca gira a más de 550°/s', () => {
  settle();
  const m = new Match({ world, map, seed: 301, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false });
  const bots = new BotSquad(m, 'elite', { nav });
  m.on('roundStart', () => bots.reset());
  const D = DIFFICULTY.elite;
  let hits = 0, bad = [];
  const onShot = (op, w, eye, fwd, results) => {
    const B = bots.brains.get(op);
    if (!B || !B.target || !results.some((r) => r.hitOp === B.target)) return;
    hits++;
    // desde que lo tiene como blanco: su reacción y el gatillo (la reacción ya descuenta el
    // tiempo que lo veía antes de descubrirlo en un barrido)
    const since = m.game.time - B.aim.acqT;
    if (B.aim.phase !== 'track' || since < B.aim.react0 + AIM.trigger - TICK - 1e-6) bad.push({ fase: B.aim.phase, since, react: B.aim.react0 });
  };
  let game = null, maxRate = 0;
  const yaws = new Map();
  m.start();
  for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) {
    if (game !== m.game) { game = m.game; game.on('shot', onShot); }
    bots.update(TICK); m.tick(TICK);
    for (const B of bots.brains.values()) {
      const y = yaws.get(B.op);
      if (y !== undefined && B.target && (B.aim.phase === 'flick' || B.aim.phase === 'track')) maxRate = Math.max(maxRate, Math.abs(angleDiff(y, B.op.yaw)) / TICK);
      yaws.set(B.op, B.op.yaw);
    }
  }
  bots.dispose();
  assert.ok(hits > 20, `aciertos al blanco: ${hits}`);
  assert.deepEqual(bad, [], 'aciertos antes de reaccionar y apuntar');
  assert.ok(maxRate <= D.aimSpeed * DEG * 1.01, `giro máximo ${(maxRate / DEG).toFixed(0)}°/s`);
});

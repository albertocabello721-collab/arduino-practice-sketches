// Fase 7.5: muerte con física por partes. Al morir, el cuerpo cae como un muñeco de trapo ligero
// empujado por lo que lo mató, sin atravesar el mundo, con las articulaciones en su sitio, y se
// queda quieto como mucho a los 3 s. Es solo dibujo: la pose de la simulación no cambia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { BONE } from '../src/sim/skeleton.js';
import { Ragdoll, deathImpulse, PT, NP, RAG, RAG_LINKS, TORSO_PTS } from '../src/render/ragdoll.js';

const world = createVillaWorld();
const map = buildVilla(world);
const STREET = { x: 15.5, z: -12 };          // calle abierta (asfalto a la cota 0)
const WALL_Z = -0.125;                       // cara de la fachada que da al jardín (x 7…13)

// Mata a un operador de pie en (x, y, z) mirando a `yaw` con un tiro en el pecho que viene de
// delante (o de detrás), o con una explosión en `blast`; devuelve su cuerpo ya soltado.
function kill({ x, y = 0, z, yaw = 0, from = 'front', dist = 8, weapon = { name: 'FA-7' }, blast = null, stance = 'stand' }) {
  world.resetToPristine();
  const game = new Game({ world, map, seed: 7 });
  const op = game.addOperator(new Operator('a', { name: 'A', team: 0, x, y, z, yaw, loadout: ['ar', 'pistol'], bot: true }));
  op.intent.stance = stance;
  for (let i = 0; i < 60; i++) game.tick();
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, s = from === 'front' ? 1 : -1, b = op.body.pos;
  const by = { body: { pos: { x: b.x + f.x * dist * s, y: b.y, z: b.z + f.z * dist * s } } };
  let ev = null;
  game.on('killed', (t, e) => { ev = { ...e, by }; });
  const c = op.rig[BONE.chest].p;
  if (blast) game.damage(op, 500, { by: null, zone: 'body', point: blast, weapon: { name: 'C4', explosive: true }, noDown: true });
  else game.damage(op, 500, { by: null, zone: 'body', dir: { x: -f.x * s, y: -0.03, z: -f.z * s }, point: { x: c.x, y: c.y + 0.1, z: c.z }, weapon, noDown: true });
  assert.equal(op.state, 'dead');
  const rig = op.rig.map((r) => r && { p: { ...r.p }, R: { x: { ...r.R.x }, y: { ...r.R.y }, z: { ...r.R.z } } });
  const rag = new Ragdoll(op.rig, { impulse: deathImpulse(ev, op), rand: () => 0.5 });
  return { op, rag, rig, fwd: f, start: rag.P.slice() };
}
// en fotogramas de 1/60 hasta que se queda quieto (o 3,5 s); devuelve el tiempo y lo más alto que llegó la pelvis
function settle(rag) {
  let t = 0, top = -Infinity;
  while (rag.awake && t < 3.5) { rag.update(1 / 60, world); t += 1 / 60; top = Math.max(top, rag.at(PT.pelvis).y); }
  return { t, top };
}
// cuánto se mete la esfera de cada partícula en vóxeles sólidos (muestreada hacia fuera desde el centro)
function sunk(rag) {
  let worst = 0;
  const dirs = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, -0.7, 0], [-0.7, -0.7, 0], [0, -0.7, 0.7], [0, -0.7, -0.7]];
  for (let i = 0; i < NP; i++) {
    const p = rag.at(i), r = rag.Rd[i];
    for (const [dx, dy, dz] of dirs) for (const k of [0, 0.25, 0.5, 0.75]) {
      if (world.solidAtWorld(p.x + dx * r * k, p.y + dy * r * k, p.z + dz * r * k)) worst = Math.max(worst, r * (1 - k));
    }
  }
  return worst;
}
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

test('empieza exactamente en la pose de la simulación: sin salto al morir', () => {
  const { rag, rig } = kill({ ...STREET });
  const out = new Float32Array(20 * 16);
  rag.write(out);
  for (let b = 0; b <= BONE.holster; b++) {
    const r = rig[b], o = b * 16;
    const want = [r.R.x.x, r.R.x.y, r.R.x.z, 0, r.R.y.x, r.R.y.y, r.R.y.z, 0, r.R.z.x, r.R.z.y, r.R.z.z, 0, r.p.x, r.p.y, r.p.z, 1];
    for (let k = 0; k < 16; k++) assert.ok(Math.abs(out[o + k] - want[k]) < 1e-5, `hueso ${b}[${k}]: ${out[o + k]} ≠ ${want[k]}`);
  }
});

test('de frente cae hacia atrás (de espaldas, hacia delante) y queda tendido sin atravesar el suelo', () => {
  for (const from of ['front', 'back']) {
    const { rag, fwd, start } = kill({ ...STREET, from });
    const head0 = { x: start[PT.head * 3], z: start[PT.head * 3 + 2] };
    settle(rag);
    const h = rag.at(PT.head), c = rag.at(PT.chest);
    const back = -((h.x - head0.x) * fwd.x + (h.z - head0.z) * fwd.z);
    if (from === 'front') assert.ok(back > 1, `de frente la cabeza va ${back.toFixed(2)} m hacia atrás`);
    else assert.ok(back < -1, `de espaldas la cabeza va ${(-back).toFixed(2)} m hacia delante`);
    assert.ok(h.y < 0.3 && c.y < 0.3, `no queda tendido (cabeza ${h.y.toFixed(2)}, pecho ${c.y.toFixed(2)})`);
    assert.ok(rag.floorY() > -0.01, `atraviesa el suelo (${rag.floorY().toFixed(3)})`);
    assert.ok(sunk(rag) < 0.02, `se mete ${sunk(rag).toFixed(3)} m en el suelo`);
  }
});

test('la escopeta de cerca empuja más que el fusil de lejos', () => {
  const far = kill({ ...STREET, dist: 25 }), near = kill({ ...STREET, dist: 2, weapon: { name: 'M-90', pellets: 8 } });
  const moved = (k) => { const s = { x: k.start[PT.head * 3], z: k.start[PT.head * 3 + 2] }; settle(k.rag); const h = k.rag.at(PT.head); return Math.hypot(h.x - s.x, h.z - s.z); };
  const a = moved(far), b = moved(near);
  assert.ok(b > a + 0.3, `escopeta ${b.toFixed(2)} m, fusil ${a.toFixed(2)} m`);
});

test('contra una pared queda apoyado en ella, sin atravesarla', () => {
  for (const z of [-0.8, -1.0]) {
    const { rag } = kill({ x: 10, z, yaw: 0 });
    settle(rag);
    for (let i = 0; i < NP; i++) assert.ok(rag.P[i * 3 + 2] + rag.Rd[i] <= WALL_Z + 0.02, `partícula ${i} dentro de la pared`);
    assert.ok(sunk(rag) < 0.02, `se mete ${sunk(rag).toFixed(3)} m`);
    const p = rag.at(PT.pelvis), h = rag.at(PT.head);
    assert.ok(p.z > WALL_Z - 0.6, `la pelvis no llega a la pared (${p.z.toFixed(2)})`);
    assert.ok(h.y > 0.4, `no queda sentado contra la pared: la cabeza a ${h.y.toFixed(2)} m`);
  }
});

test('en la escalera cae sobre los escalones sin atravesarlos', () => {
  // mirando escaleras abajo y tiro de frente: de espaldas sobre los escalones; mirando arriba: rueda hacia abajo
  for (const [yaw, onStairs] of [[0, true], [Math.PI, false]]) {
    const { rag } = kill({ x: 21.1, y: 1.75, z: 9.6, yaw });
    settle(rag);
    assert.ok(sunk(rag) < 0.03, `se mete ${sunk(rag).toFixed(3)} m en los escalones`);
    const p = rag.at(PT.pelvis);
    if (onStairs) assert.ok(p.y > 1.2 && p.z > 9, `no queda en la escalera (pelvis ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
    else assert.ok(p.z < 9.2, `no cae escaleras abajo (pelvis en z ${p.z.toFixed(2)})`);
  }
});

test('una explosión lo despide hacia fuera, sin mandarlo por los aires', () => {
  const blast = { x: STREET.x, y: 0.3, z: STREET.z - 0.9 };
  const { rag, start } = kill({ ...STREET, blast });
  const { top } = settle(rag);
  const p = rag.at(PT.pelvis), away = p.z - start[PT.pelvis * 3 + 2];
  assert.ok(away > 1.2, `solo se aparta ${away.toFixed(2)} m`);
  assert.ok(top < 1.9, `la pelvis sube hasta ${top.toFixed(2)} m`);
  assert.ok(sunk(rag) < 0.02);
});

test('las partes no se estiran, el tronco es rígido y rodillas y codos no se doblan al revés', () => {
  const cases = [{ ...STREET }, { ...STREET, from: 'back' }, { ...STREET, yaw: 1.2, stance: 'crouch' }, { x: 10, z: -0.9 }, { x: 21.1, y: 1.75, z: 9.6 }, { ...STREET, blast: { x: 15.8, y: 0.2, z: -12.6 } }];
  for (const c of cases) {
    const { rag, start } = kill(c);
    let worstKnee = 0, worstElbow = 0;
    for (let f = 0; f < 200 && rag.awake; f++) {
      rag.update(1 / 60, world);
      // rodillas: la espinilla no va por delante del muslo (delante = derecha del tronco × muslo)
      const right = unit({ ...sub(rag.at(PT.shR), rag.at(PT.shL)) }), up = unit(sub(rag.at(PT.neck), rag.at(PT.pelvis)));
      const backDir = cross(right, up);
      for (const [hip, kn, an] of [[PT.hipL, PT.knL, PT.anL], [PT.hipR, PT.knR, PT.anR]]) {
        const t = unit(sub(rag.at(kn), rag.at(hip)));
        let fr = sub(cross(right, t), { x: backDir.x * 0.35, y: backDir.y * 0.35, z: backDir.z * 0.35 });
        fr = unit(sub(fr, { x: t.x * dot(fr, t), y: t.y * dot(fr, t), z: t.z * dot(fr, t) }));
        worstKnee = Math.max(worstKnee, dot(sub(rag.at(an), rag.at(kn)), fr));
      }
      // codos: el antebrazo, hacia el lado al que se doblaba al morir (en el marco del brazo)
      for (const [k, fi, sh, el, wr] of [[0, 2, PT.shL, PT.elL, PT.wrL], [1, 4, PT.shR, PT.elR, PT.wrR]]) {
        const M = rag.M, m = fi * 9, b = rag.bend, a = unit(sub(rag.at(el), rag.at(sh)));
        let s = { x: M[m] * b[k * 3] + M[m + 3] * b[k * 3 + 1] + M[m + 6] * b[k * 3 + 2], y: M[m + 1] * b[k * 3] + M[m + 4] * b[k * 3 + 1] + M[m + 7] * b[k * 3 + 2], z: M[m + 2] * b[k * 3] + M[m + 5] * b[k * 3 + 1] + M[m + 8] * b[k * 3 + 2] };
        s = unit(sub(s, { x: a.x * dot(s, a), y: a.y * dot(s, a), z: a.z * dot(s, a) }));
        worstElbow = Math.max(worstElbow, -dot(sub(rag.at(wr), rag.at(el)), s));
      }
    }
    assert.ok(worstKnee < 0.03, `${JSON.stringify(c)}: rodilla al revés ${worstKnee.toFixed(3)} m`);
    assert.ok(worstElbow < 0.03, `${JSON.stringify(c)}: codo al revés ${worstElbow.toFixed(3)} m`);
    RAG_LINKS.forEach(([i, j], k) => {
      const d = len(rag.at(i), rag.at(j));
      assert.ok(Math.abs(d / rag.rest[k] - 1) < 0.05, `${JSON.stringify(c)}: la varilla ${i}-${j} mide ${(100 * d / rag.rest[k]).toFixed(1)} %`);
    });
    const at0 = (i) => ({ x: start[i * 3], y: start[i * 3 + 1], z: start[i * 3 + 2] });
    for (let a = 0; a < TORSO_PTS.length; a++) for (let b = a + 1; b < TORSO_PTS.length; b++) {
      const i = TORSO_PTS[a], j = TORSO_PTS[b], d0 = len(at0(i), at0(j)), d = len(rag.at(i), rag.at(j));
      assert.ok(Math.abs(d - d0) < 0.05 * d0 + 0.005, `${JSON.stringify(c)}: el tronco se deforma (${i}-${j})`);
    }
  }
});

test('se queda quieto a los 3 s como mucho y, quieto, no gasta nada', () => {
  for (const c of [{ ...STREET }, { x: 10, z: -0.9 }, { x: 21.1, y: 1.75, z: 9.6 }, { ...STREET, blast: { x: 15.5, y: 0.3, z: -12.9 } }]) {
    const { rag } = kill(c);
    const { t } = settle(rag);
    assert.ok(!rag.awake && t <= RAG.sleepAfter + 0.05, `${JSON.stringify(c)}: sigue moviéndose a los ${t.toFixed(2)} s`);
    const before = rag.P.slice();
    assert.equal(rag.update(1 / 60, world), false);
    assert.deepEqual(rag.P, before);
  }
});

test('deathImpulse: disparo, escopeta de cerca, explosión o nada', () => {
  const target = { body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 1, y: -9, z: 0 } } };
  const near = { body: { pos: { x: 0, y: 0, z: -2 } } }, far = { body: { pos: { x: 0, y: 0, z: -30 } } };
  const dir = { x: 0, y: 0, z: 1 };
  const rifleFar = deathImpulse({ dir, weapon: { name: 'FA-7' }, by: far }, target);
  const rifleNear = deathImpulse({ dir, weapon: { name: 'FA-7' }, by: near }, target);
  const shotgun = deathImpulse({ dir, weapon: { name: 'M-90', pellets: 8 }, by: near }, target);
  assert.equal(rifleFar.kind, 'shot');
  assert.ok(rifleNear.speed > rifleFar.speed && shotgun.speed > rifleNear.speed);
  assert.equal(deathImpulse({ dir, weapon: null, headshot: true }, target).head, 0.5);
  const blast = deathImpulse({ point: { x: 0, y: 0.3, z: -1 }, weapon: { name: 'C4', explosive: true } }, target);
  assert.equal(blast.kind, 'blast');
  assert.ok(blast.speed >= 2.5 && blast.speed <= 4.5);
  const none = deathImpulse({ zone: 'bleed' }, target);
  assert.equal(none.kind, 'none');
  assert.equal(none.vel.x, 1);
  assert.equal(none.vel.y, -2);        // (la caída se limita: no se estrella de golpe)
});

test('coste: diez cuerpos cayendo a la vez cuestan menos de 1,2 ms por fotograma', () => {
  const { rig } = kill({ ...STREET });
  const imp = (k) => ({ kind: 'shot', dir: { x: Math.sin(k), y: 0, z: Math.cos(k) }, point: null, speed: 2.2, head: 0, vel: { x: 0, y: 0, z: 0 } });
  const out = new Float32Array(20 * 16);
  for (let k = 0; k < 20; k++) { const r = new Ragdoll(rig, { impulse: imp(k), rand: () => 0.5 }); for (let f = 0; f < 40; f++) { r.update(1 / 60, world); r.write(out); } }
  const rags = Array.from({ length: 10 }, (_, k) => new Ragdoll(rig, { impulse: imp(k), rand: () => 0.5 }));
  const n = 30, t0 = performance.now();
  for (let f = 0; f < n; f++) for (const r of rags) { r.update(1 / 60, world); r.write(out); }
  const ms = (performance.now() - t0) / n;
  assert.ok(ms < 1.2, `${ms.toFixed(2)} ms por fotograma`);
});

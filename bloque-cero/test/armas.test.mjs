// F6.1 · Arsenal del documento (sección 8): tabla de valores, recarga táctica con bala en
// recámara, retroceso con patrón fijo que se recupera, modos de disparo, penetración
// (70 % pared blanda y barricada, 80 % mueble de madera) y perdigones a la cabeza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { WEAPONS, WeaponState, recoilPattern, BURST, falloffAt } from '../src/sim/weapons.js';
import { traceBullet, powerAt } from '../src/world/destruction.js';
import { BONE } from '../src/sim/skeleton.js';
import { MAT } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
function fresh(seed = 3) { world.resetToPristine(); return new Game({ world, map, seed }); }
function run(game, s) { for (let i = 0; i < Math.round(s / TICK); i++) game.tick(); }
function aimAt(op, p) {
  const e = op.eyePos();
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  op.yaw = Math.atan2(-dx, -dz);
  op.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

test('la tabla de armas es la del documento', () => {
  const T = {
    ar: ['FA-7 Halcón', 44, 780, 30, 2.4, 3.1],
    ar2: ['FA-9 Lince', 39, 860, 30, 2.3, 3.0],
    smg: ['SF-45 Avispa', 33, 870, 30, 2.1, 2.8],
    smg2: ['SF-9 Mamba', 27, 950, 40, 2.2, 2.9],
    shotgun: ['E-12 Toro', 22, 70, 7, 0.55, 0.55],
    dmr: ['T-308 Búho', 67, 380, 10, 2.6, 3.3],
    lmg: ['AL-60 Oso', 47, 700, 80, 5.0, 5.0],
    pistol: ['P-9 Colibrí', 42, null, 15, 1.6, 2.1],
    revolver: ['R-44 Tejón', 70, null, 6, 2.8, 2.8],
    mpistol: ['PA-3 Tábano', 22, 1100, 20, 1.9, 2.4],
  };
  assert.deepEqual(Object.keys(WEAPONS).sort(), Object.keys(T).sort(), 'las 10 armas');
  for (const [id, [name, dmg, rpm, mag, rt, re]] of Object.entries(T)) {
    const d = WEAPONS[id];
    assert.equal(d.name, name);
    assert.equal(d.damage, dmg, `${name} daño`);
    if (rpm) assert.equal(d.rpm, rpm, `${name} cadencia`);
    assert.equal(d.mag, mag, `${name} cargador`);
    assert.equal(d.reload, rt, `${name} recarga táctica`);
    assert.equal(d.reloadEmpty, re, `${name} recarga vacía`);
    assert.ok(d.adsTime >= 0.25 && d.adsTime <= 0.45, `${name} apuntado 0,25-0,45 s`);
  }
  assert.equal(WEAPONS.shotgun.pellets, 8);
  // semiautomáticas: solo tiro a tiro
  for (const id of ['dmr', 'shotgun', 'pistol', 'revolver']) assert.deepEqual(WEAPONS[id].modes, ['semi']);
});

test('recarga táctica 30+1; vacía, 30 y más lenta; revólver sin +1; escopeta cartucho a cartucho', () => {
  const w = new WeaponState(WEAPONS.ar);
  w.ammo = 12;
  assert.ok(w.startReload());
  assert.equal(w.reloadTotal, 2.4);
  w.finishReload();
  assert.equal(w.ammo, 31, 'táctica: cargador + la de la recámara');
  const e = new WeaponState(WEAPONS.ar);
  e.ammo = 0;
  assert.ok(e.startReload());
  assert.equal(e.reloadTotal, 3.1, 'vacía: incluye el cerrojo');
  e.finishReload();
  assert.equal(e.ammo, 30);
  const r = new WeaponState(WEAPONS.revolver);
  r.ammo = 2; r.startReload(); r.finishReload();
  assert.equal(r.ammo, 6, 'revólver: sin recámara extra');
  const s = new WeaponState(WEAPONS.shotgun);
  s.ammo = 3;
  assert.ok(s.startReload());
  assert.ok(Math.abs(s.reloadTotal - (0.3 + 4 * 0.55)) < 1e-9, '4 cartuchos a 0,55 s');
});

test('retroceso: patrón fijo, 3 primeros casi verticales y luego deriva a los dos lados', () => {
  for (const id of ['ar', 'ar2', 'smg', 'smg2', 'lmg', 'mpistol']) {
    const d = WEAPONS[id];
    const pts = Array.from({ length: 30 }, (_, i) => recoilPattern(d, i));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(pts[i].side) <= d.recoil.h * 0.1 + 1e-9 && pts[i].up > 0, `${id}: disparo ${i + 1} casi vertical`);
    const later = pts.slice(3);
    assert.ok(later.some((p) => p.side > d.recoil.h * 0.3) && later.some((p) => p.side < -d.recoil.h * 0.3), `${id}: deriva a izquierda y derecha`);
    assert.deepEqual(recoilPattern(d, 7), recoilPattern(d, 7), 'siempre el mismo');
  }
  // cada fusil deriva distinto
  assert.notDeepEqual(recoilPattern(WEAPONS.ar, 8), recoilPattern(WEAPONS.ar2, 8));
});

// Ráfaga de n disparos del jugador (sin objetivo) y cuánto sube la vista.
function sprayRise(stance, n = 10, seed = 5) {
  const game = fresh(seed);
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: Math.PI / 2, loadout: ['ar'] }));
  a.intent.stance = stance;
  run(game, 0.6);
  a.pitch = 0;
  const p0 = a.pitch;
  let shots = 0;
  for (let i = 0; i < 400 && shots < n; i++) { a.intent.fire = true; game.tick(); shots = a.stats.shots; }
  a.intent.fire = false;
  for (let i = 0; i < 3; i++) game.tick();
  return { game, a, rise: a.pitch - p0, p0 };
}

test('retroceso: sube al disparar, menos agachado (−10 %) y tumbado (−20 %), y se recupera al parar', () => {
  const st = sprayRise('stand'), cr = sprayRise('crouch'), pr = sprayRise('prone');
  assert.ok(st.rise > 0.03, `sube (${st.rise.toFixed(3)} rad)`);
  assert.ok(Math.abs(cr.rise / st.rise - 0.9) < 0.06, `agachado ≈ 90 % (${(cr.rise / st.rise).toFixed(2)})`);
  assert.ok(Math.abs(pr.rise / st.rise - 0.8) < 0.06, `tumbado ≈ 80 % (${(pr.rise / st.rise).toFixed(2)})`);
  // recuperación: al dejar de disparar vuelve buena parte del camino (70 %)
  const { game, a, p0 } = st;
  const top = a.pitch;
  run(game, 0.8);
  const back = (top - a.pitch) / (top - p0);
  assert.ok(back > 0.55 && back < 0.8, `recupera ${Math.round(back * 100)} %`);
  // lo que el jugador compensa tirando del ratón no se recupera (no se pasa de largo)
  const s2 = sprayRise('stand');
  s2.a.pitch = s2.p0;                         // el jugador bajó la mira del todo
  s2.a.compensateRecoil(-(s2.rise), 0);
  run(s2.game, 0.8);
  assert.ok(Math.abs(s2.a.pitch - s2.p0) < 0.004, 'sin sobrecorrección');
});

test('modos de disparo: B cambia; ráfaga de 3 con el gatillo pulsado; tiro a tiro, uno por pulsación', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 6, yaw: Math.PI / 2, loadout: ['ar', 'pistol'] }));
  run(game, 0.6);
  const w = a.weapon;
  assert.equal(w.mode, 'auto');
  const modes = [];
  game.on('fireMode', (op, ww, m) => modes.push(m));
  a.intent.fireMode = true; game.tick();
  assert.equal(w.mode, 'burst');
  // ráfaga: mantener el gatillo 1 s dispara exactamente 3
  let s0 = a.stats.shots;
  for (let i = 0; i < 60; i++) { a.intent.fire = true; game.tick(); }
  assert.equal(a.stats.shots - s0, BURST, 'una ráfaga de 3');
  // soltar y volver a pulsar: otra ráfaga (aunque se suelte enseguida, la ráfaga se completa)
  a.intent.fire = false; game.tick();
  s0 = a.stats.shots;
  a.intent.fire = true; game.tick(); a.intent.fire = false;
  for (let i = 0; i < 30; i++) game.tick();
  assert.equal(a.stats.shots - s0, BURST, 'la ráfaga se completa al soltar');
  a.intent.fireMode = true; game.tick();
  assert.equal(w.mode, 'semi');
  s0 = a.stats.shots;
  for (let i = 0; i < 60; i++) { a.intent.fire = true; game.tick(); }
  assert.equal(a.stats.shots - s0, 1, 'tiro a tiro');
  a.intent.fireMode = true; game.tick();
  assert.equal(w.mode, 'auto');
  assert.deepEqual(modes, ['burst', 'semi', 'auto']);
  // la pistola solo tiene tiro a tiro: B no hace nada
  a.intent.switchTo = 1; run(game, 0.6);
  a.intent.fireMode = true; game.tick();
  assert.equal(a.weapon.mode, 'semi');
  assert.equal(modes.length, 3);
});

// Daño de un disparo de FA-7 al pecho de `t` desde `a` (sin caída: < 25 m).
function chestShot(game, a, t) {
  run(game, 0.2);
  const c = t.rig[BONE.chest].p;
  aimAt(a, { x: c.x, y: c.y + 0.05, z: c.z });
  return game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon);
}

test('penetración: pared blanda y barricada 70 %, mueble de madera 80 %', () => {
  // pared de pladur del salón (x = 12, sin muebles delante en z = 2) → recibidor: 70 % del daño
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 10, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 14, y: 0, z: 2, yaw: Math.PI / 2, armor: 3 }));
  const r = chestShot(game, a, t);
  assert.equal(r.hitOp, t);
  const zoneMul = r.zone === 'limb' ? 0.75 : 1;         // (a veces se cruza el brazo)
  assert.ok(Math.abs(r.damage / 44 / zoneMul - 0.7) < 0.03, `pared: ${(r.damage / 44 / zoneMul * 100).toFixed(0)} %`);
  const opts = { extraBreak: 0, penScale: 1 / WEAPONS.ar.penetration };
  const rng = { next: () => 0.99 };
  // barricada de una ventana (una capa de madera): la bala entra desde fuera
  const o = map.windows.find((w) => w.axis === 'x');
  const inSide = -(o.out || 1), my = (o.y0 + o.y1) / 2;
  const from = o.line - inSide * 0.6;
  const plan = traceBullet(world, o.center + 0.05, my, from, 0, 0, inSide, 1.2, 1.0, rng, opts);
  const bar = plan.segments.filter((sg) => sg.mat === MAT.BARRICADE);
  assert.ok(bar.length >= 1, 'cruza la barricada');
  assert.ok(Math.abs(powerAt(plan, 1.2, 1) - 0.7) < 0.03, `barricada: ${(powerAt(plan, 1.2, 1) * 100).toFixed(0)} %`);
  // mueble de madera: el tablero de la mesa de la bodega, de arriba abajo
  const top = -3.5 + 0.875;
  assert.equal(world.getWorld(6.5, top - 0.06, 20.5), MAT.FURN_DARK);
  const p2 = traceBullet(world, 6.5, top + 0.5, 20.5, 0, -1, 0, 0.7, 1.0, rng, opts);
  assert.ok(Math.abs(powerAt(p2, 0.7, 1) - 0.8) < 0.03, `mueble: ${(powerAt(p2, 0.7, 1) * 100).toFixed(0)} %`);
});

test('perdigones a la cabeza: ×1,5 en vez de baja inmediata; bala de fusil a la cabeza: baja', () => {
  const game = fresh();
  const a = game.addOperator(new Operator('a', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['shotgun'] }));
  const t = game.addOperator(new Operator('t', { team: 1, x: 6, y: 0, z: 9, yaw: 0, armor: 3 }));
  run(game, 0.2);
  const hp = t.rig[BONE.head].p;
  aimAt(a, { x: hp.x, y: hp.y + 0.1, z: hp.z });
  // un solo perdigón a unos 7 m (con caída: de 5 a 15 m)
  const r = game.fireBullet(a, a.eyePos(), a.viewDir(), a.weapon);
  assert.equal(r.hitOp, t);
  assert.equal(r.zone, 'head');
  assert.equal(t.state, 'alive', 'un perdigón en la cabeza no mata');
  const want = 22 * 1.5 * falloffAt(WEAPONS.shotgun, r.end);
  assert.ok(Math.abs(r.damage - want) < 0.5, `×1,5 (${r.damage.toFixed(1)} ≈ ${want.toFixed(1)})`);
  // fusil a la cabeza: baja inmediata
  const g2 = fresh();
  const b = g2.addOperator(new Operator('b', { team: 0, x: 6, y: 0, z: 2, yaw: Math.PI, loadout: ['ar'] }));
  const u = g2.addOperator(new Operator('u', { team: 1, x: 6, y: 0, z: 9, yaw: 0, armor: 3 }));
  run(g2, 0.2);
  const h2 = u.rig[BONE.head].p;
  aimAt(b, { x: h2.x, y: h2.y + 0.1, z: h2.z });
  g2.fireBullet(b, b.eyePos(), b.viewDir(), b.weapon);
  assert.equal(u.state, 'dead');
});

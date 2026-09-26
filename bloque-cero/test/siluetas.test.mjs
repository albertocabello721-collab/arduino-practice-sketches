// Fase 7.3: siluetas de los 16 operadores (complexión según el blindaje y objeto propio) y la fila
// del campo de pruebas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperatorGeometry, operatorLook, defaultLook } from '../src/render/character.js';
import { KITS, KIT_COLORS } from '../src/render/kits.js';
import { OPERATORS } from '../src/sim/operators.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { HITBOXES, BONE } from '../src/sim/skeleton.js';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { spawnLineup, spawnRangeDummies, LINEUP } from '../src/sim/dummies.js';

const MAX_TRIS = 2400;
// hasta dónde sobresale del todo el cuerpo (sin el equipo) de sus zonas de impacto: lo de siempre
// (la funda del muslo ya llegaba a 4,5 cm)
const MAX_OUT = 0.045;

const geoOf = (def) => buildOperatorGeometry(operatorLook(def, def.side === 'atk' ? 0 : 1),
  WEAPONS[def.primaries[0]]?.model || WEAPONS[def.secondaries[0]].model, WEAPONS[def.secondaries[0]].model);

test('los 16 tienen objeto propio y caben en 2.400 triángulos (1 malla cada uno)', () => {
  assert.equal(OPERATORS.length, 16);
  for (const def of OPERATORS) {
    assert.ok(KITS[def.id], `${def.name} sin objeto propio`);
    const g = geoOf(def);
    const tris = g.attributes.position.count / 3;
    assert.ok(tris <= MAX_TRIS, `${def.name}: ${tris} triángulos`);
    assert.equal(g.userData.gear.length, g.attributes.position.count);
  }
});

test('el cuerpo no sobresale de las zonas de impacto más que antes (el equipo de la espalda no cuenta)', () => {
  const hb = {};
  for (const [bi, c, h] of HITBOXES) hb[bi] = { c, h };
  for (const def of OPERATORS) {
    const g = geoOf(def);
    const P = g.attributes.position.array, B = g.attributes.aBone.array, gear = g.userData.gear;
    let worst = 0, where = null;
    for (let i = 0; i < B.length; i++) {
      const H = hb[Math.round(B[i])];
      if (!H || gear[i]) continue;
      const out = Math.max(Math.abs(P[i * 3] - H.c.x) - H.h.x, Math.abs(P[i * 3 + 1] - H.c.y) - H.h.y, Math.abs(P[i * 3 + 2] - H.c.z) - H.h.z);
      if (out > worst) { worst = out; where = Math.round(B[i]); }
    }
    assert.ok(worst <= MAX_OUT + 1e-6, `${def.name}: ${(worst * 100).toFixed(1)} cm fuera (hueso ${where})`);
  }
});

test('ningún objeto propio usa los colores de equipo (azul y naranja)', () => {
  const hsl = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
  };
  const near = (h, t) => Math.min(Math.abs(h - t), 360 - Math.abs(h - t)) < 18;
  const SENTINEL = '#000001';
  const look = { shirt: SENTINEL, pants: SENTINEL, vest: SENTINEL, helmet: SENTINEL, gloves: SENTINEL, boots: SENTINEL, skin: SENTINEL, accent: SENTINEL };
  for (const [id, kit] of Object.entries(KITS)) {
    for (const [, , o] of kit.parts(look)) {
      if (!o.color || o.color === SENTINEL) continue;
      const c = hsl(o.color);
      assert.ok(!(c.s > 0.35 && (near(c.h, 207) || near(c.h, 28))), `${id}: ${o.color} parece un color de equipo`);
    }
  }
  assert.ok(Object.values(KIT_COLORS).every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test('la complexión sigue al blindaje: ligero sin hombreras, pesado con hombreras grandes y placas', () => {
  const armWidth = (armor) => {
    const g = buildOperatorGeometry({ ...defaultLook(0, 0), armor }, 'ar', 'pistol');
    const P = g.attributes.position.array, B = g.attributes.aBone.array;
    let w = 0, n = 0;
    for (let i = 0; i < B.length; i++) if (Math.round(B[i]) === BONE.uarmR) { w = Math.max(w, Math.abs(P[i * 3])); n++; }
    return { w, n, tris: g.attributes.position.count / 3 };
  };
  const [l, m, h] = [armWidth(1), armWidth(2), armWidth(3)];
  assert.ok(l.w < m.w && m.w < h.w, `anchura del hombro: ${l.w} · ${m.w} · ${h.w}`);
  assert.ok(l.tris < m.tris && m.tris < h.tris);
  // sin blindaje en el aspecto (maniquís del campo de pruebas): la complexión media de siempre
  assert.equal(buildOperatorGeometry(defaultLook(0, 0), 'ar', 'pistol').attributes.position.count,
    buildOperatorGeometry({ ...defaultLook(0, 0), armor: 2 }, 'ar', 'pistol').attributes.position.count);
});

test('cabezas propias: sombrero de LUMEN, casco con visera de MURALLA, máscaras de NUBE y TIZÓN, cámara de OJO', () => {
  const look = (id) => operatorLook(OPERATORS.find((d) => d.id === id), 0);
  assert.equal(look('lumen').head, 'boonie');
  assert.equal(look('muralla').head, 'heavy');
  assert.equal(look('nube').face, 'gas2');
  assert.equal(look('tizon').face, 'gas1');
  assert.equal(look('ojo').face, 'monocle');
  assert.equal(look('termo').nvg, false);
  for (const d of OPERATORS) { const L = operatorLook(d, 1); assert.equal(L.armor, d.armor); assert.equal(L.kit, d.id); }
});

test('la fila del campo de pruebas: los 16 en la calle, ataque y después defensa, y las balas del jugador los atraviesan', () => {
  const world = createVillaWorld();
  const map = buildVilla(world);
  const game = new Game({ world, map, seed: 5 });
  const player = game.addOperator(new Operator('jugador', { name: 'Tú', team: 0, x: 15.5, y: 0, z: -4.5, yaw: 0, loadout: ['ar', 'pistol'] }));
  const dummies = spawnRangeDummies(game);
  const fila = spawnLineup(game, OPERATORS);
  assert.equal(fila.length, 16);
  assert.equal(dummies.length, 6);
  assert.deepEqual(fila.slice(0, 8).map((o) => o.opDef.side), Array(8).fill('atk'));
  assert.deepEqual(fila.slice(8).map((o) => o.opDef.side), Array(8).fill('def'));
  for (let i = 1; i < 16; i++) assert.ok(fila[i].body.pos.x - fila[i - 1].body.pos.x >= LINEUP.step - 1e-9);
  for (const op of fila) {
    assert.equal(op.team, 0);
    assert.equal(op.body.pos.z, LINEUP.z);
    assert.ok(!world.solidAtWorld(op.body.pos.x, 1, op.body.pos.z), `${op.name} dentro de algo`);
  }
  const mur = fila.find((o) => o.opDef.id === 'muralla');
  assert.equal(mur.ability.id, 'shield');
  assert.equal(mur.weapons.length, 1);
  for (let i = 0; i < 30; i++) game.tick();
  // el compañero del campo sigue siendo el primero del equipo 0 entre los maniquís (tecla J)
  assert.equal(dummies.find((d) => d.team === 0).id, 'aliado');
  // disparar a TERMO desde 4 m no le hace nada (sin fuego amigo)
  const termo = fila[0];
  player.body.pos.x = termo.body.pos.x; player.body.pos.z = termo.body.pos.z + 4;
  const e = player.eyePos(), c = termo.rig[BONE.chest].p;
  const d = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z }, l = Math.hypot(d.x, d.y, d.z);
  game.fireBullet(player, e, { x: d.x / l, y: d.y / l, z: d.z / l }, player.weapon);
  assert.equal(termo.hp, termo.maxHp);
  assert.equal(termo.state, 'alive');
});

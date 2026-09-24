// F6.2 · Plantilla de los 16 operadores aprobada (sección 12 del documento con los
// nombres del juego): velocidad/blindaje, armas, gadgets a elegir y cargas de habilidad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPERATORS, OP_BY_ID, opsForSide, GADGETS, ARMOR_SPEED } from '../src/sim/operators.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Match } from '../src/sim/match.js';
import { TICK } from '../src/sim/game.js';

// nombre: [velocidad/blindaje, principales, secundarias, gadgets, cargas de habilidad]
const LIST = {
  atk: {
    TERMO: ['2/2', ['ar', 'shotgun'], ['pistol'], ['breach', 'claymore'], 2],
    ROMPE: ['3/1', ['ar2', 'smg'], ['pistol'], ['smoke', 'flash'], 2],
    MURALLA: ['1/3', [], ['pistol', 'revolver'], ['frag', 'smoke'], 4],
    RADAR: ['2/2', ['ar', 'smg2'], ['mpistol'], ['claymore', 'flash'], 3],
    PULGA: ['2/2', ['ar2', 'shotgun'], ['pistol'], ['breach', 'frag'], 6],
    CHISPA: ['3/1', ['smg', 'ar'], ['mpistol'], ['breach', 'claymore'], 3],
    NUBE: ['2/2', ['ar2', 'lmg'], ['pistol'], ['flash', 'breach'], 3],
    LUMEN: ['3/1', ['dmr', 'smg2'], ['pistol'], ['smoke', 'claymore'], -1],
  },
  def: {
    VOLTIO: ['3/1', ['smg2', 'shotgun'], ['pistol'], ['barbed', 'c4'], 4],
    SILENCIO: ['2/2', ['smg', 'shotgun'], ['mpistol'], ['shield', 'barbed'], 4],
    CEPO: ['2/2', ['smg2', 'ar2'], ['pistol'], ['shield', 'alarm'], 5],
    OJO: ['2/2', ['smg', 'shotgun'], ['revolver'], ['c4', 'barbed'], 3],
    CORAZA: ['1/3', ['ar2', 'smg'], ['pistol'], ['barbed', 'impact'], 5],
    'GUARDIÁN': ['3/1', ['ar', 'shotgun'], ['pistol'], ['shield', 'bpcam'], 2],
    REMEDIO: ['1/3', ['smg', 'shotgun'], ['pistol'], ['barbed', 'bpcam'], 3],
    'TIZÓN': ['2/2', ['lmg', 'smg2'], ['pistol'], ['shield', 'barbed'], 3],
  },
};

test('la plantilla es la lista aprobada: 8 + 8, en orden, con sus números', () => {
  assert.equal(OPERATORS.length, 16);
  for (const side of ['atk', 'def']) {
    const ops = opsForSide(side);
    assert.deepEqual(ops.map((o) => o.name), Object.keys(LIST[side]), `${side}: nombres y orden`);
    for (const o of ops) {
      const [sa, pri, sec, gad, count] = LIST[side][o.name];
      const [speed, armor] = sa.split('/').map(Number);
      assert.equal(o.armor, armor, `${o.name} blindaje`);
      assert.equal(ARMOR_SPEED[o.armor], speed, `${o.name} velocidad`);
      assert.deepEqual(o.primaries, pri, `${o.name} principales`);
      assert.deepEqual(o.secondaries, sec, `${o.name} secundarias`);
      assert.deepEqual(o.gadgets, gad, `${o.name} gadgets`);
      assert.equal(o.ability.count, count, `${o.name} cargas de habilidad`);
      assert.ok(o.ability.name && o.ability.desc && o.ability.counters && o.role, `${o.name} textos`);
      for (const w of [...o.primaries, ...o.secondaries]) assert.ok(WEAPONS[w], `${o.name}: arma ${w}`);
      for (const g of o.gadgets) assert.equal(GADGETS[g].side, side, `${o.name}: gadget ${g} de su bando`);
    }
  }
  // ya no están: MAZO, ONDA, RACIMO, PULSO, HUMO
  for (const id of ['mazo', 'onda', 'racimo', 'pulso', 'humo']) assert.equal(OP_BY_ID[id], undefined);
});

test('en partida: operadores únicos por equipo, gadget elegido y MURALLA solo con pistola', () => {
  const world = createVillaWorld();
  const map = buildVilla(world);
  for (const seed of [1, 2, 3, 4]) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, prepTime: 0.2 }, human: false, startSide: 'atk' });
    m.start();
    for (const team of [0, 1]) {
      const ids = m.slotsOf(team).map((s) => s.opId);
      assert.equal(new Set(ids).size, 5, 'sin repetir');
    }
    for (const op of m.game.operators) {
      const def = op.opDef;
      assert.ok(def.gadgets.includes(op.gadget.id), `${def.name}: gadget ${op.gadget.id}`);
      assert.equal(op.gadget.left, GADGETS[op.gadget.id].count);
      assert.equal(op.ability.left, def.ability.count);
      if (def.id === 'muralla') assert.deepEqual(op.weapons.map((w) => w.def.cls), ['pistol'], 'MURALLA: solo pistola');
      else assert.equal(op.weapons.length, 2);
    }
  }
  // el jugador elige MURALLA con el revólver y el humo
  const m = new Match({ world, map, seed: 9, rules: { selectTime: 30, prepTime: 0.2 }, human: true, startSide: 'atk' });
  m.start();
  const me = m.humanSlot;
  assert.ok(m.choose(me, { opId: 'muralla' }));
  assert.ok(m.choose(me, { secondary: 1, gadget: 1 }));
  m.setReady(me, true);
  for (let i = 0; i < 120 && m.phase === 'select'; i++) m.tick(TICK);
  const p = m.player;
  assert.equal(p.opDef.id, 'muralla');
  assert.deepEqual(p.weapons.map((w) => w.def.id), ['revolver']);
  assert.equal(p.gadget.id, 'smoke');
});

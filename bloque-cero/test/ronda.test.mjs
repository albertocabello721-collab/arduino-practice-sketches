// F12.4 · Inicio y fin de ronda: el rótulo (ronda, bando, objetivo), la cuenta atrás, la cámara lenta
// de la última baja, el mejor de la ronda, el motivo con su detalle y el «1 contra N», a lo largo de
// una partida completa de bots. (En el navegador: tools/smoke-ronda.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { introFor, countdownAt, SlowMo, SLOWMO, statsSnapshot, roundMvp, mvpLine, clutchFor, endDetail } from '../src/client/roundflow.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);

test('la cuenta atrás: 3, 2 y 1 en los últimos 3 s de la preparación', () => {
  const at = (phase, timeLeft) => countdownAt({ phase, timeLeft });
  assert.equal(at('prep', 10), 0);
  assert.equal(at('prep', 3.01), 0);
  assert.equal(at('prep', 3), 3);
  assert.equal(at('prep', 2.01), 3);
  assert.equal(at('prep', 2), 2);
  assert.equal(at('prep', 0.4), 1);
  assert.equal(at('prep', 0), 0);
  assert.equal(at('action', 2), 0);
});

test('la cámara lenta: 0,6 s al 30 % y vuelta en 0,2 s; después, nada', () => {
  assert.equal(SlowMo.scaleAt(0), SLOWMO.scale);
  assert.equal(SlowMo.scaleAt(0.59), SLOWMO.scale);
  assert.ok(SlowMo.scaleAt(0.7) > SLOWMO.scale && SlowMo.scaleAt(0.7) < 1);
  assert.equal(SlowMo.scaleAt(0.8), 1);
  const s = new SlowMo();
  assert.equal(s.step(1 / 60), 1);          // sin empezar, a velocidad normal
  s.start();
  let real = 0, game = 0;
  while (s.active && real < 5) { const k = s.step(1 / 60); real += 1 / 60; game += k / 60; }
  assert.ok(Math.abs(real - (SLOWMO.secs + SLOWMO.ease)) < 0.02, `dura ${real.toFixed(3)} s`);
  const want = SLOWMO.secs * SLOWMO.scale + (SLOWMO.ease * (1 + SLOWMO.scale)) / 2;
  assert.ok(Math.abs(game - want) < 0.02, `tiempo de juego ${game.toFixed(3)} (esperado ${want.toFixed(3)})`);
  assert.equal(s.step(1 / 60), 1);
});

test('lo que hizo el mejor de la ronda, en corto', () => {
  assert.equal(mvpLine({ kills: 2, downs: 1, assists: 0, plants: 0, disables: 0, revives: 0, damage: 180.4 }), '2 bajas · 1 derribo · 180 de daño');
  assert.equal(mvpLine({ kills: 0, downs: 0, assists: 1, plants: 1, disables: 0, revives: 0, damage: 0 }), '1 asistencia · 1 plantado');
});

test('partida de bots: rótulo, cuenta atrás, mejor de la ronda, motivo y «1 contra N»', () => {
  world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update();
  const m = new Match({ world, map, seed: 23, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, 'normal', { nav });
  const rounds = [];
  const R = () => rounds[rounds.length - 1];
  let before = null, lastKill = null;
  m.on('roundStart', () => {
    bots.reset();
    before = statsSnapshot(m);
    lastKill = null;
    rounds.push({ round: m.round, intro: [introFor(m, 0), introFor(m, 1)], sides: [m.sideOf(0), m.sideOf(1)], site: m.site, counts: [], clutches: [] });
  });
  m.game.on('killed', (target, ev) => { if (ev && ev.by && ev.by.team !== target.team) lastKill = { by: ev.by, target, headshot: !!ev.headshot }; });
  m.on('roundEnd', (res) => Object.assign(R(), { res, mvp: roundMvp(m, before), detail: endDetail(res, { lastKill }), lastKill, before, after: statsSnapshot(m) }));
  m.start();
  let prevCount = 0;
  const prevKey = ['', ''];
  for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) {
    bots.update(TICK); m.tick(TICK);
    if (!R()) continue;
    const c = countdownAt(m);
    if (c !== prevCount) { prevCount = c; if (c) R().counts.push(c); }
    for (const team of [0, 1]) {
      const cl = clutchFor(m, null, team), key = cl ? cl.key : '';
      if (key === prevKey[team]) continue;
      prevKey[team] = key;
      if (!cl) continue;
      let mates = 0, foes = 0;
      for (const o of m.game.operators) if (o.state === 'alive') { if (o.team === team) mates++; else foes++; }
      R().clutches.push({ team, key, mine: cl.mine, text: cl.text, mates, foes, phase: m.phase });
    }
  }
  bots.dispose();
  assert.ok(rounds.length >= 4, `rondas: ${rounds.length}`);
  let clutches = 0, mvps = 0, elim = 0;
  for (const r of rounds) {
    // el rótulo: la ronda, el bando, y el objetivo (el sitio con sus dos salas) solo para el que defiende
    for (const team of [0, 1]) {
      const I = r.intro[team];
      assert.equal(I.round, `Ronda ${r.round}`);
      assert.equal(I.side, r.sides[team] === 'def' ? 'Defiendes' : 'Atacas');
      if (r.sides[team] === 'def') {
        const rooms = [r.site.A, r.site.B].map((id) => map.rooms.find((x) => x.id === id).name);
        assert.equal(I.objective, `${r.site.name}: ${rooms[0]} / ${rooms[1]}`);
      } else {
        const rooms = [r.site.A, r.site.B].map((id) => map.rooms.find((x) => x.id === id).name);
        assert.equal(I.objective, `${r.site.name} · objetivo sin localizar: búscalo con tu dron`);
        assert.ok(!rooms.some((n) => I.objective.includes(n)), `al atacar no se dicen las salas: ${I.objective}`);
      }
    }
    // la cuenta atrás, una vez por ronda
    assert.deepEqual(r.counts, [3, 2, 1], `ronda ${r.round}: cuenta ${r.counts}`);
    // el mejor de la ronda: el que más puntos sumó en ella (o nadie, si nadie sumó)
    const deltas = r.after.map((a, i) => a.score - r.before[i].score);
    const top = Math.max(...deltas);
    if (top > 0) {
      mvps++;
      assert.ok(r.mvp, `ronda ${r.round}: sin mejor`);
      assert.equal(r.mvp.score, top);
      assert.equal(deltas[m.slots.indexOf(r.mvp.slot)], top);
      assert.ok(mvpLine(r.mvp).length > 0);
    } else assert.equal(r.mvp, null);
    // el motivo: con eliminación, la última baja es del que perdió
    if (r.res.code === 'defendersDown' || r.res.code === 'attackersDown') {
      elim++;
      assert.ok(r.detail.startsWith('Última baja: '), r.detail);
      assert.notEqual(r.lastKill.target.team, r.res.winner);
    }
    // «1 contra N»: solo en la acción o con el desactivador, y con los números de verdad
    for (const c of r.clutches) {
      clutches++;
      assert.ok(c.phase === 'action' || c.phase === 'planted', c.phase);
      if (c.mine) { assert.equal(c.mates, 1); assert.ok(c.foes >= 1); assert.equal(c.text, `1 contra ${c.foes}`); }
      else { assert.equal(c.foes, 1); assert.ok(c.mates >= 2); assert.equal(c.text, `${c.mates} contra 1`); }
    }
  }
  assert.ok(mvps >= rounds.length - 1, `mejor de la ronda en ${mvps} de ${rounds.length}`);
  assert.ok(clutches >= 1, 'ningún «1 contra N» en toda la partida');
  console.log(`rondas ${rounds.length} · por eliminación ${elim} · con mejor de la ronda ${mvps} · avisos de «1 contra N» ${clutches}`);
});

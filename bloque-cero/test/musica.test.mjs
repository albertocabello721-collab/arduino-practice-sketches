// F12.3 · Música: qué suena en cada fase de la ronda y el golpe del primer contacto, a lo largo de
// una partida completa de bots. (Cómo suena: tools/medir-musica.mjs; en el juego: tools/smoke-musica.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { musicFor, ContactWatch, TENSION_FROM } from '../src/client/soundtrack.js';
import { MOTIF, MOTIF_MAJOR, STINGER } from '../src/audio/music.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const pc = (f) => ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;

test('el tema: La–Do–Mi–Re (en mayor, con Do sostenido); victoria y derrota de 3 s', () => {
  assert.deepEqual(MOTIF.map(pc), [0, 3, 7, 5]);
  assert.deepEqual(MOTIF_MAJOR.map(pc), [0, 4, 7, 5]);
  assert.equal(STINGER.win, 3);
  assert.equal(STINGER.lose, 3);
});

test('la música de cada fase', () => {
  const m = (phase, timeLeft = 100) => musicFor({ phase, timeLeft, rules: { fuseTime: 45 } });
  assert.deepEqual(m('select'), { mode: 'menu', k: 0 });
  assert.deepEqual(m('prep'), { mode: 'prep', k: 0 });
  assert.deepEqual(m('action', 100), { mode: '', k: 0 });
  assert.deepEqual(m('action', TENSION_FROM + 0.01), { mode: '', k: 0 });
  assert.deepEqual(m('action', TENSION_FROM), { mode: 'tension', k: 0 });
  assert.deepEqual(m('action', 15), { mode: 'tension', k: 0.5 });
  assert.deepEqual(m('action', 0), { mode: 'tension', k: 1 });
  assert.deepEqual(m('planted', 45), { mode: 'planted', k: 0 });
  assert.ok(Math.abs(m('planted', 9).k - 0.8) < 1e-9);
  assert.deepEqual(m('roundEnd'), { mode: '', k: 0 });
  assert.deepEqual(m('matchEnd'), { mode: '', k: 0 });
});

test('el primer contacto: en la acción, el «¡Contacto!» de tu equipo o daño entre bandos, una vez por ronda', () => {
  let n = 0;
  const w = new ContactWatch(() => n++);
  const M = (phase) => ({ phase, time: 10 });
  const mine = { team: 0 }, foe = { team: 1 }, mate = { team: 0 };
  assert.equal(w.radio(M('prep'), mine, 'contact', 0), false);        // en la preparación, no
  assert.equal(w.radio(M('action'), foe, 'contact', 0), false);       // la radio del rival no la oyes
  assert.equal(w.radio(M('action'), mine, 'reload', 0), false);       // otro aviso
  assert.equal(w.hurt(M('action'), mate, { by: mine }), false);       // fuego amigo
  assert.equal(w.hurt(M('action'), foe, { by: null }), false);        // sin autor (una caída)
  assert.equal(w.hurt(M('roundEnd'), foe, { by: mine }), false);      // ya acabó la ronda
  assert.equal(n, 0);
  assert.equal(w.radio(M('action'), mine, 'contact', 0), true);
  assert.equal(w.hurt(M('action'), foe, { by: mine }), false);        // ya sonó en esta ronda
  assert.equal(n, 1);
  w.reset();
  assert.equal(w.hurt(M('planted'), mine, { by: foe }), true);
  assert.equal(n, 2);
});

test('partida de bots: la música sigue las fases y el golpe llega una vez por ronda, con el primer choque', () => {
  world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update();
  const m = new Match({ world, map, seed: 11, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, 'normal', { nav });
  const rounds = [];
  const R = () => rounds[rounds.length - 1];
  const W = new ContactWatch(() => { R().hits.push({ t: m.game.time, phase: m.phase }); });
  const live = () => m.phase === 'action' || m.phase === 'planted';
  m.on('roundStart', () => { bots.reset(); W.reset(); rounds.push({ round: m.round, hits: [], first: null, modes: new Set(), tension: [], planted: [] }); });
  // el primer choque de la ronda visto desde fuera: el «¡Contacto!» del equipo 0 o daño entre bandos
  const clash = () => { if (live() && R() && R().first === null) R().first = m.game.time; };
  m.game.on('radio', (op, text, key) => { W.radio(m, op, key, 0); if (key === 'contact' && op.team === 0) clash(); });
  for (const t of ['damaged', 'downed', 'killed']) m.game.on(t, (target, ev) => { W.hurt(m, target, ev); if (ev && ev.by && ev.by.team !== target.team) clash(); });
  m.start();
  for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) {
    bots.update(TICK); m.tick(TICK);
    if (!R()) continue;
    const mus = musicFor(m);
    R().modes.add(mus.mode);
    if (m.phase === 'prep') assert.equal(mus.mode, 'prep');
    if (m.phase === 'action') assert.equal(mus.mode, m.timeLeft <= TENSION_FROM ? 'tension' : '', `acción con ${m.timeLeft.toFixed(1)} s`);
    if (m.phase === 'planted') assert.equal(mus.mode, 'planted');
    if (m.phase === 'roundEnd' || m.phase === 'matchEnd') assert.equal(mus.mode, '');
    if (mus.mode === 'tension') R().tension.push(mus.k);
    if (mus.mode === 'planted') R().planted.push(mus.k);
  }
  bots.dispose();
  assert.ok(rounds.length >= 4, `rondas: ${rounds.length}`);
  let clashes = 0, withTension = 0;
  for (const r of rounds) {
    // k solo sube, en la tensión y con el desactivador
    for (const ks of [r.tension, r.planted]) for (let i = 1; i < ks.length; i++) assert.ok(ks[i] >= ks[i - 1] - 1e-9, `ronda ${r.round}: k baja`);
    assert.ok(r.hits.length <= 1, `ronda ${r.round}: ${r.hits.length} golpes`);
    if (r.first !== null) {
      clashes++;
      assert.equal(r.hits.length, 1, `ronda ${r.round}: hubo choque y no sonó el golpe`);
      assert.equal(r.hits[0].t, r.first, `ronda ${r.round}: el golpe no llegó con el primer choque`);
      assert.ok(r.hits[0].phase === 'action' || r.hits[0].phase === 'planted');
    } else assert.equal(r.hits.length, 0);
    if (r.tension.length || r.planted.length) withTension++;
    assert.ok(r.modes.has('prep'), `ronda ${r.round}: sin preparación`);
  }
  assert.ok(clashes >= rounds.length - 1, `choques en ${clashes} de ${rounds.length} rondas`);
  console.log(`rondas ${rounds.length} · con golpe de contacto ${clashes} · con tensión o desactivador ${withTension}`);
});

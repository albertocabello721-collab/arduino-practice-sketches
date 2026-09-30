// F12.2 · Voces: el locutor dice cada cosa en su momento a lo largo de una partida completa, y tu
// operador no repite frases seguidas. (Cómo suenan los gemidos: tools/medir-voces.mjs; la voz del
// navegador en la partida: tools/smoke-voces.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TICK } from '../src/sim/game.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { Announcer, OperatorVoice, LINES, OP_LINES, OP_GAP } from '../src/client/announcer.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);

test('las frases: el locutor y tu operador', () => {
  assert.equal(LINES.prep(3), 'Ronda 3. Preparación.');
  assert.equal(LINES.action, '¡Acción!');
  assert.equal(LINES.thirty, 'Treinta segundos.');
  assert.equal(OP_LINES.reload, '¡Recargando!');
  assert.equal(OP_LINES.frag, '¡Granada!');
  assert.equal(OP_LINES.reinforced, 'Refuerzo puesto.');
});

test('tu operador: una frase cada 2,5 s como mucho, y nada para lo que no tiene frase', () => {
  const said = [];
  const v = new OperatorVoice((t) => said.push(t));
  assert.equal(v.line('reload', 10), true);
  assert.equal(v.line('frag', 11), false);
  assert.equal(v.line('frag', 10 + OP_GAP), true);
  assert.equal(v.line('nada', 20), false);
  assert.deepEqual(said, ['¡Recargando!', '¡Granada!']);
});

test('partida de bots: el locutor anuncia cada ronda, la acción, los 30 s, el plantado, el último y el final', () => {
  world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update();
  const m = new Match({ world, map, seed: 7, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, 'normal', { nav });
  const log = [];            // [ronda, frase, cuándo]
  const A = new Announcer((text) => log.push({ round: m.round, text, phase: m.phase, t: m.game.time, ctx: ctxNow() }));
  let me = null;
  const ctxNow = () => {
    if (!me) return null;
    let mates = 0, foes = 0;
    for (const o of m.game.operators) { if (o === me || o.state !== 'alive') continue; if (o.team === me.team) mates++; else foes++; }
    return { meAlive: me.state === 'alive', mates, foes, left: m.timeLeft };
  };
  const rounds = [];
  m.on('roundStart', () => { bots.reset(); me = m.game.operators.find((o) => o.team === 0); A.roundStart(m.round); rounds.push({ round: m.round, planted: false }); });
  m.on('action', () => A.action());
  m.on('planted', () => { A.planted(); rounds[rounds.length - 1].planted = true; });
  m.on('roundEnd', (r) => { A.roundEnd(r.winner === 0); Object.assign(rounds[rounds.length - 1], { winner: r.winner, code: r.code }); });
  let final = null;
  m.on('matchEnd', (e) => { A.matchEnd(e.winner === 0); final = e.winner; });
  m.start();
  for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) { bots.update(TICK); m.tick(TICK); A.tick(m, me); }
  bots.dispose();
  assert.ok(rounds.length >= 4, `rondas: ${rounds.length}`);
  for (const R of rounds) {
    const said = log.filter((l) => l.round === R.round).map((l) => l.text);
    assert.equal(said.filter((t) => t === LINES.prep(R.round)).length, 1, `ronda ${R.round}: «${LINES.prep(R.round)}» una vez (${said.join(' | ')})`);
    assert.equal(said.filter((t) => t === LINES.action).length, 1, `ronda ${R.round}: «¡Acción!» una vez`);
    assert.equal(said.includes(LINES.planted), R.planted, `ronda ${R.round}: plantado ${R.planted}`);
    assert.equal(said.filter((t) => t === LINES.win || t === LINES.lose).length, 1, `ronda ${R.round}: un final`);
    assert.ok(said.includes(R.winner === 0 ? LINES.win : LINES.lose), `ronda ${R.round}: el final que toca`);
    if (R.code === 'timeUp') assert.ok(said.includes(LINES.thirty), `ronda ${R.round}: se acabó el tiempo y no dijo los 30 s`);
    assert.ok(said.indexOf(LINES.prep(R.round)) < said.indexOf(LINES.action), `ronda ${R.round}: preparación antes que acción`);
  }
  // «eres el último»: solo estando vivo, sin compañeros en pie y con enemigos
  for (const l of log.filter((x) => x.text === LINES.last)) assert.ok(l.ctx.meAlive && l.ctx.mates === 0 && l.ctx.foes > 0, JSON.stringify(l.ctx));
  // «treinta segundos»: con 25–30 s por delante
  for (const l of log.filter((x) => x.text === LINES.thirty)) assert.ok(l.ctx.left <= 30 && l.ctx.left > 25, JSON.stringify(l.ctx));
  assert.equal(log[log.length - 1].text, final === 0 ? LINES.matchWin : LINES.matchLose);
});

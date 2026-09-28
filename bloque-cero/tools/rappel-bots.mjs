// Rappel de los bots atacantes (F10.2b): simula rondas solo de bots con el sitio en la planta alta y
// cuenta en cuántas hay rappel, en cuántas de esas entran por la ventana, cuánto tiempo pasan
// colgados como mucho y cuánto sin avanzar en la cuerda (sin contar las esperas).
// Uso: node tools/rappel-bots.mjs [rondas=100] [dificultad=elite] [semilla inicial=1]
// Con varios procesos: RONDAS por proceso y semillas distintas (p. ej. 1, 1001, 2001…).
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { TICK } from '../src/sim/game.js';

const want = +(process.argv[2] || 100), diff = process.argv[3] || 'elite', seed0 = +(process.argv[4] || 1);
const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const upstairs = map.sites.findIndex((s) => s.id === 'alta');

const tot = { rounds: 0, rope: 0, window: 0, planned: 0, hooks: 0, entries: 0, down: 0, shot: 0, atk: 0, maxHang: 0, maxStuck: 0, waits: [], deadOnRope: 0 };
let seed = seed0;
const t0 = performance.now();
while (tot.rounds < want) {
  const m = new Match({ world, map, seed: seed++, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false });
  const bots = new BotSquad(m, diff, { nav });
  const g = m.game;
  let R = null;
  const hangs = new Map();
  m.on('roundSelect', () => { m.location = upstairs; });
  m.on('roundStart', () => { bots.reset(); R = { rope: false, window: false }; hangs.clear(); });
  g.on('rappelHook', (op) => { if (!op.isBot) return; R.rope = true; tot.hooks++; hangs.set(op, g.time); });
  g.on('rappelOff', (op, how) => {
    if (!op.isBot || !hangs.has(op)) return;
    tot.maxHang = Math.max(tot.maxHang, g.time - hangs.get(op));
    hangs.delete(op);
    if (how === 'window') { R.window = true; tot.entries++; } else tot.down++;
  });
  g.on('killed', (t) => { if (t.isBot && hangs.has(t)) { tot.deadOnRope++; hangs.delete(t); } });
  m.on('roundEnd', (r) => {
    if (tot.rounds >= want) return;
    tot.rounds++;
    if (r.winSide === 'atk') tot.atk++;
    if (R.rope) tot.rope++;
    if (R.window) tot.window++;
    for (const B of bots.brains.values()) {
      if (B.ropePlan) tot.planned++;
      if (B.noRope) tot.shot++;
      tot.maxStuck = Math.max(tot.maxStuck, B.mover.ropeStuck);
      if (B.mover.ropeLast && B.mover.ropeLast.ok && B.ropePlan) tot.waits.push(B.mover.ropeLast.t);
    }
    // (quien siga colgado al acabar la ronda también cuenta)
    for (const [op, at] of hangs) tot.maxHang = Math.max(tot.maxHang, g.time - at);
  });
  m.start();
  for (let n = 0; m.phase !== 'matchEnd' && tot.rounds < want && n < 60 * 60 * 30; n++) { bots.update(TICK); m.tick(TICK); }
  bots.dispose();
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + ' %';
tot.waits.sort((a, b) => a - b);
console.log(`${diff} · ${tot.rounds} rondas con el sitio arriba (semillas ${seed0}–${seed - 1}) · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`rondas con rappel: ${tot.rope} (${pct(tot.rope, tot.rounds)}) · entran por la ventana en ${tot.window} de esas (${pct(tot.window, tot.rope)})`);
console.log(`bots con plan de cuerda: ${tot.planned} · enganches: ${tot.hooks} · entradas: ${tot.entries} · bajan o se sueltan: ${tot.down} · les disparan subiendo: ${tot.shot} · caen en la cuerda: ${tot.deadOnRope}`);
console.log(`colgados como mucho: ${tot.maxHang.toFixed(1)} s · lo más sin avanzar en la cuerda: ${tot.maxStuck.toFixed(1)} s · tiempo colgado de los que entran (mediana): ${tot.waits.length ? tot.waits[tot.waits.length >> 1].toFixed(1) : '-'} s`);
console.log(`el ataque gana ${pct(tot.atk, tot.rounds)} de estas rondas`);

// Equilibrio (F10.1): partidas solo de bots en la Villa, con las mismas semillas, y el % de rondas
// que gana el ataque (con su error típico). Reparte las partidas entre varios procesos.
// Uso: node tools/equilibrio.mjs [dificultad=elite] [partidas=160] [primera semilla=101] [procesos=4] [opciones]
//   --merodeadores N   cuántos defensores merodean (si no, los de la tabla de dificultad)
//   --vuelta S         los merodeadores vuelven al sitio cuando quedan S segundos de ronda
//   --brecha           vuelven también al oír una brecha del ataque en el sitio
//   --cerca            no se alejan más de una sala del sitio (ni para cazar)
//   --semillas         además, el resultado de cada partida (para comparar dos versiones)
//   --hora H           dia (la de siempre), atardecer o noche: los bots ven menos a oscuras (F10.4)
// Ejemplo: node tools/equilibrio.mjs elite 160 101 4 --merodeadores 2 --cerca
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--merodeadores', '--vuelta', '--hijo', '--hora'].includes(args[i - 1])));
const diff = pos[0] || 'elite', total = +(pos[1] || 160), first = +(pos[2] || 101), procs = Math.max(1, +(pos[3] || 4));

// ---------------------------------------------------------------- hijo: juega sus semillas
if (flag('--hijo')) {
  const [a, b] = opt('--hijo').split('-').map(Number);
  const { createVillaWorld, buildVilla } = await import('../src/world/maps/villa.js');
  const { Match } = await import('../src/sim/match.js');
  const { BotSquad, navFor, DIFFICULTY } = await import('../src/sim/bots.js');
  const { TICK } = await import('../src/sim/game.js');
  const { BotLight } = await import('../src/sim/light.js');
  const D = DIFFICULTY[diff];
  if (opt('--merodeadores') !== undefined) D.roamers = +opt('--merodeadores');
  if (opt('--vuelta') !== undefined) D.roamBack = +opt('--vuelta');
  if (flag('--brecha')) D.roamBreach = true;
  if (flag('--cerca')) D.roamNear = true;
  const world = createVillaWorld();
  const map = buildVilla(world);
  const nav = navFor(world, map);
  const hora = opt('--hora') || 'dia', light = hora === 'dia' ? null : BotLight.build(world, map, hora);
  const out = { rounds: 0, atk: 0, reasons: {}, seeds: [] };
  for (let seed = a; seed <= b; seed++) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, timeOfDay: hora, light });
    const bots = new BotSquad(m, diff, { nav });
    m.on('roundStart', () => bots.reset());
    const res = [];
    m.on('roundEnd', (r) => { out.rounds++; if (r.winSide === 'atk') out.atk++; out.reasons[r.code] = (out.reasons[r.code] || 0) + 1; res.push(r.winSide === 'atk' ? 'A' : 'D'); });
    m.start();
    for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) { bots.update(TICK); m.tick(TICK); }
    bots.dispose();
    out.seeds.push(`${seed}:${res.join('')}`);
  }
  process.send(out, () => process.exit(0));
} else {
  // ---------------------------------------------------------------- padre: reparte y suma
  const self = fileURLToPath(import.meta.url);
  const per = Math.ceil(total / procs), t0 = Date.now();
  const jobs = [];
  for (let k = 0; k < procs; k++) {
    const a = first + k * per, b = Math.min(first + total - 1, a + per - 1);
    if (a > b) break;
    jobs.push(new Promise((resolve, reject) => {
      const child = fork(self, [...args, '--hijo', `${a}-${b}`], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.on('message', resolve);
      child.on('exit', (code) => { if (code) reject(new Error(`el proceso ${a}-${b} terminó con ${code}`)); });
    }));
  }
  const parts = await Promise.all(jobs);
  const sum = { rounds: 0, atk: 0, reasons: {}, seeds: [] };
  for (const p of parts) {
    sum.rounds += p.rounds; sum.atk += p.atk; sum.seeds.push(...p.seeds);
    for (const [k, v] of Object.entries(p.reasons)) sum.reasons[k] = (sum.reasons[k] || 0) + v;
  }
  const p = sum.atk / sum.rounds, se = Math.sqrt(p * (1 - p) / sum.rounds);
  const extra = ['--merodeadores', '--vuelta'].filter((k) => opt(k) !== undefined).map((k) => `${k.slice(2)} ${opt(k)}`).concat(['--brecha', '--cerca'].filter(flag).map((k) => k.slice(2)));
  const pct = (x) => (100 * x).toFixed(1).replace('.', ',');
  console.log(`${diff}${extra.length ? ' (' + extra.join(', ') + ')' : ''} · ${total} partidas (semillas ${first}–${first + total - 1}) · ${sum.rounds} rondas · el ataque gana el ${pct(p)} % ± ${pct(se)} · ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log('cómo acaban:', Object.entries(sum.reasons).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  if (flag('--semillas')) console.log(sum.seeds.join(' '));
}

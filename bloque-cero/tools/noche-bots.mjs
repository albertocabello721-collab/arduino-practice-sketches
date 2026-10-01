// Bots de noche (F10.4): partidas solo de bots en la Villa, las mismas semillas de día y de noche, y
// a qué distancia detectan a un enemigo (cada vez que un bot ve a alguien que no veía desde hacía
// 1 s): en exteriores, y dentro de la casa en sitios con luz (según el volumen de luz de noche), más
// el % de rondas que gana el ataque. De noche, en exteriores, debe bajar un 40 % o más; con luz, no
// debe cambiar. Reparte las partidas entre varios procesos.
// Uso: node tools/noche-bots.mjs [partidas=24] [semilla=501] [procesos=4] [dificultad=elite]
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--hijo', '--hora'].includes(args[i - 1])));
const total = +(pos[0] || 24), first = +(pos[1] || 501), procs = Math.max(1, +(pos[2] || 4)), diff = pos[3] || 'elite';

// ---------------------------------------------------------------- hijo: juega sus semillas a una hora
if (flag('--hijo')) {
  const [a, b] = opt('--hijo').split('-').map(Number);
  const hora = opt('--hora') || 'dia';
  const { createVillaWorld, buildVilla } = await import('../src/world/maps/villa.js');
  const { Match } = await import('../src/sim/match.js');
  const { BotSquad, navFor } = await import('../src/sim/bots.js');
  const { TICK } = await import('../src/sim/game.js');
  const { BotLight } = await import('../src/sim/light.js');
  const world = createVillaWorld();
  const map = buildVilla(world);
  const nav = navFor(world, map);
  const light = hora === 'dia' ? null : BotLight.build(world, map, hora);
  const cls = BotLight.build(world, map, 'noche');       // (qué sitios tienen luz de noche: para clasificar, a cualquier hora)
  const out = { hora, luz: !!light, rounds: 0, atk: 0, fuera: [0, 0, 0, 0], conLuz: [0, 0, 0, 0], aOscuras: [0, 0, 0, 0] };   // [n, suma de distancias, n a más de 24 m, la mayor]
  for (let seed = a; seed <= b; seed++) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false, timeOfDay: hora, light });
    const bots = new BotSquad(m, diff, { nav });
    const seen = new Map();                               // bot → (enemigo → última vez a la vista)
    m.on('roundStart', () => { bots.reset(); seen.clear(); });
    m.on('roundEnd', (r) => { out.rounds++; if (r.winSide === 'atk') out.atk++; });
    m.start();
    for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) {
      bots.update(TICK); m.tick(TICK);
      if (m.phase !== 'action' && m.phase !== 'planted') continue;
      const now = m.game.time;
      for (const B of bots.brains.values()) {
        if (B.op.state !== 'alive') continue;
        let S = seen.get(B);
        if (!S) { S = new Map(); seen.set(B, S); }
        for (const T of B.per.visible) {
          const last = S.get(T);
          S.set(T, now);
          if (last !== undefined && now - last <= 1) continue;
          const e = B.op.eyePos(), c = T.center(), p = T.body.pos;
          const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
          const k = map.isOutside(p.x, p.y, p.z) ? 'fuera' : cls.isDark(c.x, c.y, c.z) ? 'aOscuras' : 'conLuz';
          out[k][0]++; out[k][1] += dist; if (dist > 24) out[k][2]++; out[k][3] = Math.max(out[k][3], dist);
        }
      }
    }
    bots.dispose();
  }
  process.send(out, () => process.exit(0));
} else {
  // ---------------------------------------------------------------- padre: las dos horas, y la comparación
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const per = Math.ceil(total / procs);
  const run = (hora) => Promise.all(Array.from({ length: procs }, (_, k) => {
    const a = first + k * per, b = Math.min(first + total - 1, a + per - 1);
    if (a > b) return null;
    return new Promise((resolve, reject) => {
      const child = fork(self, [...args, '--hijo', `${a}-${b}`, '--hora', hora], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.on('message', resolve);
      child.on('exit', (code) => { if (code) reject(new Error(`el proceso ${hora} ${a}-${b} terminó con ${code}`)); });
    });
  }).filter(Boolean)).then((parts) => {
    const sum = { hora, luz: parts.every((p) => p.luz), rounds: 0, atk: 0, fuera: [0, 0, 0, 0], conLuz: [0, 0, 0, 0], aOscuras: [0, 0, 0, 0] };
    for (const p of parts) { sum.rounds += p.rounds; sum.atk += p.atk; for (const k of ['fuera', 'conLuz', 'aOscuras']) { sum[k][0] += p[k][0]; sum[k][1] += p[k][1]; sum[k][2] += p[k][2]; sum[k][3] = Math.max(sum[k][3], p[k][3]); } }
    return sum;
  });
  const dia = await run('dia'), noche = await run('noche');
  const mean = (v) => (v[0] ? v[1] / v[0] : 0);
  const pct = (x) => (100 * x).toFixed(1).replace('.', ',');
  const m = (v) => `${mean(v).toFixed(1).replace('.', ',')} m (n ${v[0]}, ${v[0] ? Math.round((100 * v[2]) / v[0]) : 0} % a más de 24 m, máx ${v[3].toFixed(0)})`;
  const delta = (a, b) => (mean(a) ? `${(100 * (mean(b) - mean(a)) / mean(a)).toFixed(0)} %` : '—');
  const line = (S) => `${S.hora.padEnd(6)}${S.luz ? ' (regla de luz)' : ''} exteriores ${m(S.fuera)} · dentro con luz ${m(S.conLuz)} · dentro a oscuras ${m(S.aOscuras)} · el ataque gana el ${pct(S.atk / S.rounds)} % de ${S.rounds} rondas`;
  console.log(`${diff} · ${total} partidas por hora (semillas ${first}–${first + total - 1}) · ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(line(dia));
  console.log(line(noche));
  console.log(`de día a noche: exteriores ${delta(dia.fuera, noche.fuera)} · dentro con luz ${delta(dia.conLuz, noche.conLuz)} · dentro a oscuras ${delta(dia.aOscuras, noche.aOscuras)} · ataque ${pct(dia.atk / dia.rounds)} → ${pct(noche.atk / noche.rounds)} %`);
}

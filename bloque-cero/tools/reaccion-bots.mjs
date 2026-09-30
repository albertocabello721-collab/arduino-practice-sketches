// Reacción de los bots en partidas reales: partidas completas solo de bots en la Villa y, en cada
// avistamiento (un enemigo entra en el campo de visión de un bot con línea de visión, tras 1 s sin
// verlo), cuánto tarda el bot en disparar y en acertar, cuánto tuvo que girar, a qué velocidad gira
// y cuánto giró en los 100 ms antes de su primer acierto. Reparte las partidas entre varios procesos.
// Uso: node tools/reaccion-bots.mjs [dificultades=novato,normal,veterano,elite] [partidas=8] [semilla=301] [procesos=4]
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--hijo', '--dif'].includes(args[i - 1])));
const diffs = (pos[0] || 'novato,normal,veterano,elite').split(',');
const total = +(pos[1] || 8), first = +(pos[2] || 301), procs = Math.max(1, +(pos[3] || 4));
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- hijo: juega sus semillas
if (flag('--hijo')) {
  const [a, b] = opt('--hijo').split('-').map(Number);
  const diff = opt('--dif');
  const { createVillaWorld, buildVilla } = await import('../src/world/maps/villa.js');
  const { Match } = await import('../src/sim/match.js');
  const { BotSquad, navFor, DIFFICULTY } = await import('../src/sim/bots.js');
  const { TICK } = await import('../src/sim/game.js');
  const { lineOfSight } = await import('../src/world/raycast.js');
  const { BONE } = await import('../src/sim/skeleton.js');
  const D = DIFFICULTY[diff];
  const world = createVillaWorld();
  const map = buildVilla(world);
  const nav = navFor(world, map);
  const eng = [];                     // avistamientos terminados
  let maxRate = 0;                    // giro más rápido visto (rad/s)
  const rates = [];                   // velocidad de giro en combate, muestras (rad/s)
  for (let seed = a; seed <= b; seed++) {
    const m = new Match({ world, map, seed, rules: { selectTime: 0, roundEndTime: 0.2 }, human: false });
    const bots = new BotSquad(m, diff, { nav });
    m.on('roundStart', () => bots.reset());
    const g = () => m.game;
    const open = new Map();           // "A|T" → avistamiento
    const seenAt = new Map();         // "A|T" → última vez visible
    const hist = new Map();           // op → [yaw de los últimos 12 pasos]
    let hooked = null;
    const hook = () => {
      if (hooked === m.game) return;
      hooked = m.game;
      open.clear(); seenAt.clear(); hist.clear();
      m.game.on('shot', (op, w, eye, fwd, results) => {
        const B = bots.brains.get(op);
        if (!B) return;
        for (const [k, E] of open) {
          if (E.A !== op) continue;
          const hitT = results.some((r) => r.hitOp === E.T);
          const aimed = B.target === E.T;
          if (!aimed && !hitT) continue;
          const t = m.game.time - E.t0;
          E.shots++;
          if (E.shotT < 0) E.shotT = t;
          if (E.shots <= 3) { E.early++; if (hitT) E.earlyHits++; } else { E.late++; if (hitT) E.lateHits++; }
          if (hitT && E.hitT < 0) {
            E.hitT = t; E.shotsToHit = E.shots;
            const h = hist.get(op) || [];
            // cuánto giró en los 6 pasos (100 ms) antes del disparo que acierta
            if (h.length >= 7) E.turn100 = Math.abs(angDiff(h[h.length - 7], h[h.length - 1]));
          }
          void k;
        }
      });
    };
    m.start();
    for (let n = 0; m.phase !== 'matchEnd' && n < 60 * 60 * 30; n++) {
      hook();
      bots.update(TICK); m.tick(TICK);
      const G = m.game;
      if (m.phase !== 'action' && m.phase !== 'planted') { open.clear(); continue; }
      const ops = G.operators;
      for (const A of ops) {
        if (A.state !== 'alive' || !bots.brains.get(A)) continue;
        let h = hist.get(A);
        if (!h) hist.set(A, h = []);
        if (h.length) {
          const r = Math.abs(angDiff(h[h.length - 1], A.yaw)) / TICK;
          if (bots.brains.get(A).target) { if (r > maxRate) maxRate = r; if ((n & 3) === 0) rates.push(r); }
        }
        h.push(A.yaw); if (h.length > 12) h.shift();
        const e = A.eyePos();
        const vx = -Math.sin(A.yaw), vz = -Math.cos(A.yaw);
        for (const T of ops) {
          if (T.team === A.team || T.state !== 'alive') continue;
          const key = A.name + '|' + T.name;
          const c = T.center();
          const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
          const dist = Math.hypot(dx, dy, dz);
          let vis = false;
          if (dist <= D.range && !(A.blindT > 0)) {
            const hd = Math.hypot(dx, dz) || 1;
            if ((dx * vx + dz * vz) / hd >= Math.cos(D.fov) || dist <= 2.2) {
              const head = T.rig[BONE.head] ? T.rig[BONE.head].p : c, chest = T.rig[BONE.chest] ? T.rig[BONE.chest].p : c;
              vis = lineOfSight(G.world, e.x, e.y, e.z, head.x, head.y + 0.06, head.z) || lineOfSight(G.world, e.x, e.y, e.z, chest.x, chest.y, chest.z);
              if (vis && G.gadgets && G.gadgets.smokes.length && G.gadgets.smokeBlocks(e, head) && G.gadgets.smokeBlocks(e, chest)) vis = false;
            }
          }
          const E = open.get(key);
          if (vis) {
            const last = seenAt.get(key);
            if (!E && (last === undefined || G.time - last > 1.0)) {
              // ángulo entre donde mira y el enemigo (horizontal y vertical)
              const yawTo = Math.atan2(-dx, -dz), pitchTo = Math.atan2(dy, Math.hypot(dx, dz));
              const ang = Math.hypot(angDiff(A.yaw, yawTo), pitchTo - A.pitch);
              open.set(key, { A, T, t0: G.time, dist, ang, shotT: -1, hitT: -1, shots: 0, shotsToHit: 0, early: 0, earlyHits: 0, late: 0, lateHits: 0, turn100: -1 });
            }
            seenAt.set(key, G.time);
          }
          if (E && (!vis && G.time - (seenAt.get(key) ?? -9) > 1.0 || T.state !== 'alive' || A.state !== 'alive' || G.time - E.t0 > 6)) {
            eng.push(pack(E)); open.delete(key);
          }
        }
      }
      for (const [key, E] of open) if (E.A.state !== 'alive' || E.T.state !== 'alive') { eng.push(pack(E)); open.delete(key); }
    }
    bots.dispose();
  }
  // (muestras de giro: solo algunas, para los percentiles)
  process.send({ eng, maxRate, rates: rates.filter((_, i) => i % 5 === 0) }, () => process.exit(0));
} else {
  // ---------------------------------------------------------------- padre: reparte y resume
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const out = {};
  for (const diff of diffs) {
    const per = Math.ceil(total / procs), jobs = [];
    for (let k = 0; k < procs; k++) {
      const a = first + k * per, b = Math.min(first + total - 1, a + per - 1);
      if (a > b) break;
      jobs.push(new Promise((resolve, reject) => {
        const child = fork(self, ['--hijo', `${a}-${b}`, '--dif', diff], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        child.on('message', resolve);
        child.on('exit', (code) => { if (code) reject(new Error(`el proceso ${a}-${b} terminó con ${code}`)); });
      }));
    }
    const parts = await Promise.all(jobs);
    const eng = parts.flatMap((p) => p.eng), rates = parts.flatMap((p) => p.rates);
    out[diff] = summary(eng, Math.max(...parts.map((p) => p.maxRate)), rates);
    print(diff, out[diff]);
  }
  console.log(`(${total} partidas por dificultad, semillas ${first}–${first + total - 1}, ${Math.round((Date.now() - t0) / 1000)} s)`);
  if (flag('--json')) console.log(JSON.stringify(out));
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function pack(E) { return { dist: E.dist, ang: E.ang, shotT: E.shotT, hitT: E.hitT, shotsToHit: E.shotsToHit, early: E.early, earlyHits: E.earlyHits, late: E.late, lateHits: E.lateHits, turn100: E.turn100 }; }
function pct(xs, p) { if (!xs.length) return NaN; const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function summary(eng, maxRate, rates) {
  const hit = eng.filter((E) => E.hitT >= 0), shot = eng.filter((E) => E.shotT >= 0);
  const front = hit.filter((E) => E.ang < 10 / DEG), turned = hit.filter((E) => E.ang > 30 / DEG);
  const ms = (xs, p) => Math.round(pct(xs, p) * 1000);
  const sum = (k) => eng.reduce((s, E) => s + E[k], 0);
  return {
    avistamientos: eng.length,
    conDisparo: shot.length,
    conAcierto: hit.length,
    disparo: { p10: ms(shot.map((E) => E.shotT), 0.1), mediana: ms(shot.map((E) => E.shotT), 0.5), p90: ms(shot.map((E) => E.shotT), 0.9) },
    acierto: { p10: ms(hit.map((E) => E.hitT), 0.1), mediana: ms(hit.map((E) => E.hitT), 0.5), p90: ms(hit.map((E) => E.hitT), 0.9) },
    aciertoDeFrente: { n: front.length, mediana: ms(front.map((E) => E.hitT), 0.5), min: ms(front.map((E) => E.hitT), 0) },
    aciertoGirando: { n: turned.length, mediana: ms(turned.map((E) => E.hitT), 0.5), min: ms(turned.map((E) => E.hitT), 0) },
    menosDe200ms: hit.length ? Math.round(100 * hit.filter((E) => E.hitT < 0.2).length / hit.length) : 0,
    giroMaximo: Math.round(maxRate * DEG),
    giroP90: Math.round(pct(rates, 0.9) * DEG),
    giradoEn100msAntesDelAcierto: { mediana: Math.round(pct(hit.filter((E) => E.turn100 >= 0).map((E) => E.turn100), 0.5) * DEG * 10) / 10, p90: Math.round(pct(hit.filter((E) => E.turn100 >= 0).map((E) => E.turn100), 0.9) * DEG * 10) / 10 },
    aciertosGirandoMas20: hit.filter((E) => E.turn100 * DEG > 20).length,
    punteria3Primeros: sum('early') ? Math.round(100 * sum('earlyHits') / sum('early')) : 0,
    punteriaDespues: sum('late') ? Math.round(100 * sum('lateHits') / sum('late')) : 0,
  };
}
function print(diff, s) {
  console.log(`\n${diff}: ${s.avistamientos} avistamientos · ${s.conDisparo} con disparo · ${s.conAcierto} con acierto`);
  console.log(`  primer disparo: mediana ${s.disparo.mediana} ms (p10 ${s.disparo.p10}, p90 ${s.disparo.p90})`);
  console.log(`  primer acierto: mediana ${s.acierto.mediana} ms (p10 ${s.acierto.p10}, p90 ${s.acierto.p90}) · de frente (<10°): ${s.aciertoDeFrente.mediana} ms, mín ${s.aciertoDeFrente.min} (n ${s.aciertoDeFrente.n}) · girando (>30°): ${s.aciertoGirando.mediana} ms, mín ${s.aciertoGirando.min} (n ${s.aciertoGirando.n})`);
  console.log(`  aciertos en menos de 200 ms: ${s.menosDe200ms} %`);
  console.log(`  giro: máximo ${s.giroMaximo}°/s, p90 en combate ${s.giroP90}°/s · girado en los 100 ms antes del acierto: mediana ${s.giradoEn100msAntesDelAcierto.mediana}°, p90 ${s.giradoEn100msAntesDelAcierto.p90}° · aciertos girando >20° en esos 100 ms: ${s.aciertosGirandoMas20}`);
  console.log(`  % de acierto: 3 primeros disparos ${s.punteria3Primeros} % · después ${s.punteriaDespues} %`);
}

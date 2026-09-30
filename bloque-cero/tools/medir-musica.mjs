// Mide la música de la F12.3 sin tarjeta gráfica ni partida: el motor de audio solo, en un
// OfflineAudioContext, llamado como lo llama el juego (un «fotograma» cada 50 ms).
//  · cada fase suena distinta: silencio en la acción, colchón y notas lentas en el menú, percusión
//    (maraca, sin colchón) en la preparación, pulso cada vez más rápido en los últimos 30 s y, con el
//    desactivador, un pulso por pitido (a 1 s y a 0,3 s);
//  · el tema (La–Do–Mi–Re) suena en todas;
//  · la victoria y la derrota duran unos 3 s, en mayor y en menor; el golpe del contacto es grave;
//  · los volúmenes de efectos, música y voz son independientes (cada deslizador solo mueve lo suyo).
// Uso: node tools/medir-musica.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const { outputFiles } = await build({
  stdin: { contents: "export * from './src/audio/audio.js'; export * from './src/audio/music.js';", resolveDir: path.resolve('.'), loader: 'js' },
  bundle: true, format: 'iife', globalName: 'BC_AUDIO', write: false,
});
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: outputFiles[0].text });

const res = await page.evaluate(async () => {
  const { AudioEngine } = window.BC_AUDIO;
  const RATE = 48000;
  let LEN = 8;
  window.AudioContext = function () { return new OfflineAudioContext(2, Math.round(RATE * LEN), RATE); };
  const db = (x) => +(10 * Math.log10(x + 1e-20)).toFixed(1);
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), h = len / 2;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < h; k++) {
          const p = i + k, q = p + h;
          const vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  };
  // energía (potencia media) en una banda, en ventanas de N muestras: la lista por ventana
  const bandWin = (M, f0, f1, N = 8192, from = 0, to = M.length) => {
    const out = [], w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    for (let s = from; s + N <= to; s += N) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = M[s + i] * w[i];
      fft(re, im);
      let e = 0;
      for (let k = Math.ceil((f0 * N) / RATE); k <= Math.floor((f1 * N) / RATE); k++) e += re[k] * re[k] + im[k] * im[k];
      out.push(e / N);
    }
    return out;
  };
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const mean = (v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  // envolvente en tramos de 10 ms de la señal por un filtro de dos polos: paso bajo (lp) o paso
  // alto (hp) a `fc` Hz
  const envelope = (M, fc, hp) => {
    const a = Math.exp((-2 * Math.PI * fc) / RATE);
    let y1 = 0, y2 = 0, x1 = 0, acc = 0;
    const W = RATE / 100, env = [];
    for (let i = 0; i < M.length; i++) {
      let x = M[i];
      if (hp) { const h = a * (y1 + x - x1); x1 = x; y1 = h; x = h; const h2 = a * (y2 + x - (envelope.x2 || 0)); envelope.x2 = x; y2 = h2; x = h2; }
      else { y1 = (1 - a) * x + a * y1; y2 = (1 - a) * y1 + a * y2; x = y2; }
      acc += x * x;
      if ((i + 1) % W === 0) { env.push(acc / W); acc = 0; }
    }
    envelope.x2 = 0;
    return env;
  };
  // arranques: la energía sube más de 6 dB en 20 ms (y no es un resto: más de `floor` del pico);
  // dos arranques, como poco, a `gap` tramos
  const rises = (env, floor, gap) => {
    const top = Math.max(...env), at = [];
    for (let i = 2; i < env.length; i++) {
      if (env[i] > env[i - 2] * 4 && env[i] > top * floor && (!at.length || i - at[at.length - 1] >= gap)) at.push(i);
    }
    return at;
  };
  // el pulso: golpes graves (por debajo de ~110 Hz) y el intervalo típico entre ellos
  const pulse = (M) => {
    const at = rises(envelope(M, 110, false), 0.2, 12);
    const gaps = at.slice(1).map((p, i) => (p - at[i]) / 100);
    return { golpes: at.length, cada: +median(gaps).toFixed(3) };
  };
  // notas y golpes por encima de 150 Hz (sin el colchón grave), por segundo
  const onsets = (M) => +(rises(envelope(M, 150, true), 0.01, 5).length / (M.length / RATE)).toFixed(2);
  // lo más fuerte: la energía del trozo de 43 ms más fuerte (dB)
  const peak = (M) => {
    const W = 2048;
    let best = 0;
    for (let i = 0; i + W <= M.length; i += W / 2) { let e = 0; for (let j = i; j < i + W; j++) e += M[j] * M[j]; best = Math.max(best, e / W); }
    return db(best);
  };
  // cuánto dura: hasta que la energía (tramos de 10 ms) cae 40 dB por debajo del pico
  const lasts = (M) => {
    const W = RATE / 100, env = [];
    for (let i = 0; i + W <= M.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += M[j] * M[j]; env.push(s / W); }
    const top = Math.max(...env);
    let last = 0;
    env.forEach((v, i) => { if (v > top * 1e-4) last = i; });
    return +((last + 1) / 100).toFixed(2);
  };
  // ¿aparece el tema (clases de nota) seguido en la lista de notas?
  const pcOf = (f) => ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  const hasSeq = (fs, seq) => { const p = fs.map(pcOf); for (let i = 0; i + seq.length <= p.length; i++) if (seq.every((x, j) => p[i + j] === x)) return true; return false; };
  const MINOR = [0, 3, 7, 5], MAJOR = [0, 4, 7, 5];

  // todas las pasadas con el mismo azar (el ruido, las afinaciones): solo cambia lo que se mide
  const seed = () => { let x = 12345; Math.random = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296); };
  // una pasada: `setup(a)` antes de arrancar, `once(a)` al principio y `frame(a, t)` cada 50 ms
  // (como el juego cada fotograma)
  const render = async (len, { frame = null, setup = null, once = null } = {}) => {
    LEN = len;
    seed();
    const a = new AudioEngine();
    if (setup) setup(a);
    a.init();
    a.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    const ctx = a.ctx;
    if (once) once(a);
    if (frame) {
      for (let t = 0.05; t < len - 0.05; t += 0.05) ctx.suspend(t).then(() => { frame(a, ctx.currentTime); ctx.resume(); });
      frame(a, 0);
    }
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), M = new Float32Array(L.length);
    let s = 0;
    for (let i = 0; i < L.length; i++) { M[i] = (L[i] + R[i]) * 0.5; s += M[i] * M[i]; }
    return { a, M, rms: db(s / M.length) };
  };
  const mode = async (name, k, P = 0) => {
    let next = 0.2;
    const { a, M, rms } = await render(8, { frame: (a, t) => {
      a.music(name, k);
      if (P && t >= next - 1e-6) { a.musicBeat(P); next += P; }
    } });
    const log = a._music.log.filter((n) => n.tag === name).map((n) => n.f);
    return {
      volumen: rms,
      pico: peak(M),
      colchon: db(median(bandWin(M, 40, 130))),
      maraca: db(mean(bandWin(M, 5000, 10000))),
      notasPorSegundo: onsets(M),
      pulso: pulse(M),
      tema: hasSeq(log, MINOR),
    };
  };
  const out = { fases: {}, remates: {}, volumenes: {} };
  out.fases.silencio = await mode('', 0);
  out.fases.menu = await mode('menu', 0);
  out.fases.preparacion = await mode('prep', 0);
  out.fases['tensión (quedan 30 s)'] = await mode('tension', 0);
  out.fases['tensión (quedan 0 s)'] = await mode('tension', 1);
  out.fases['plantado (pitido cada 1 s)'] = await mode('planted', 0, 1.0);
  out.fases['plantado (pitido cada 0,3 s)'] = await mode('planted', 0.875, 0.3);

  // remates: la victoria y la derrota (y los de la partida), y el golpe del contacto
  for (const kind of ['win', 'lose', 'matchWin', 'matchLose', 'contact']) {
    const { a, M, rms } = await render(7, { once: (a) => a.stinger(kind) });
    // el acorde final: su tercera (Do sostenido en mayor, Do en menor)
    const from = Math.round(RATE * (kind === 'win' ? 1.05 : kind === 'lose' ? 1.55 : kind === 'matchWin' ? 1.65 : kind === 'matchLose' ? 2.65 : 0.2));
    const E = (f) => mean(bandWin(M, f * 0.985, f * 1.015, 16384, from, from + 16384 * 2));
    const log = a._music.log.filter((n) => n.tag === kind).map((n) => n.f);
    out.remates[kind] = {
      volumen: rms,
      pico: peak(M),
      dura: lasts(M),
      doSostenido: db(E(554.37) + E(277.18)),
      doNatural: db(E(523.25) + E(261.63)),
      graves: db(mean(bandWin(M, 30, 160, 8192, 0, 16384))),
      agudos: db(mean(bandWin(M, 1000, 8000, 8192, 0, 16384))),
      tema: kind === 'contact' ? null : hasSeq(log, kind === 'win' || kind === 'matchWin' ? MAJOR : MINOR),
    };
  }

  // volúmenes: cada fuente sola con cada ajuste de los deslizadores
  const sources = {
    disparo: (a) => a.gunshot('rifle', { x: 3, y: 1.6, z: -2 }, false, 0),
    aviso: (a) => a.cue('tick'),
    musica: null,
    gemido: (a) => a.grunt({ x: 3, y: 1.6, z: 0 }, 'pain', 0, 0),
  };
  const settings = { todo: { sfx: 1, music: 1, voice: 1 }, sinEfectos: { sfx: 0, music: 1, voice: 1 }, sinMusica: { sfx: 1, music: 0, voice: 1 }, sinVoz: { sfx: 1, music: 1, voice: 0 }, efectosMitad: { sfx: 0.5, music: 1, voice: 1 } };
  for (const [sname, vol] of Object.entries(settings)) {
    const row = {};
    for (const [src, play] of Object.entries(sources)) {
      // (el disparo, el aviso y el gemido suenan una vez al principio; la música del menú, seguida)
      const setup = (a) => a.setVolumes(vol);
      const { M, rms } = await render(2.5, play ? { setup, once: play } : { setup, frame: (a) => a.music('menu', 0) });
      row[src] = rms;
      if (sname === 'todo') row[src + 'Pico'] = peak(M);
    }
    out.volumenes[sname] = row;
  }
  return out;
});

for (const [k, v] of Object.entries(res.fases)) console.log('fase', k.padEnd(30), JSON.stringify(v));
for (const [k, v] of Object.entries(res.remates)) console.log('remate', k.padEnd(10), JSON.stringify(v));
for (const [k, v] of Object.entries(res.volumenes)) console.log('volumen', k.padEnd(13), JSON.stringify(v));

const chk = (ok, what) => { if (!ok) errors.push(what); };
const F = res.fases, S = F.silencio, Mn = F.menu, Pr = F.preparacion, T0 = F['tensión (quedan 30 s)'], T1 = F['tensión (quedan 0 s)'], P1 = F['plantado (pitido cada 1 s)'], P3 = F['plantado (pitido cada 0,3 s)'];
chk(S.volumen < -120, 'la acción no está en silencio');
chk(Mn.colchon > Pr.colchon + 10, 'el menú no tiene colchón (o la preparación sí)');
chk(Pr.maraca > Mn.maraca + 10, 'la preparación no tiene percusión (maraca)');
chk(Pr.pulso.golpes >= 5 && Math.abs(Pr.pulso.cada - 60 / 90 * 2) < 0.06, 'la preparación no lleva el tom a 90 pulsaciones (1 y 3)');
chk(T0.notasPorSegundo > Pr.notasPorSegundo + 2, 'la tensión no es más rápida que la preparación');
chk(Math.abs(T0.pulso.cada - 60 / 112) < 0.04 && Math.abs(T1.pulso.cada - 60 / 150) < 0.04, 'la tensión no acelera de 112 a 150 pulsaciones');
chk(Math.abs(P1.pulso.cada - 1.0) < 0.05 && Math.abs(P3.pulso.cada - 0.3) < 0.03, 'con el desactivador el pulso no va con el pitido');
for (const [k, v] of Object.entries(F)) if (k !== 'silencio') chk(v.tema, `sin el tema en «${k}»`);
const R = res.remates;
for (const k of ['win', 'lose']) chk(R[k].dura >= 2.6 && R[k].dura <= 3.4, `«${k}» no dura unos 3 s (${R[k].dura})`);
for (const k of ['matchWin', 'matchLose']) chk(R[k].dura >= 4 && R[k].dura <= 5.2, `«${k}» no dura unos 4,5 s (${R[k].dura})`);
for (const k of ['win', 'matchWin']) chk(R[k].doSostenido > R[k].doNatural + 10 && R[k].tema, `«${k}» no está en mayor con el tema`);
for (const k of ['lose', 'matchLose']) chk(R[k].doNatural > R[k].doSostenido + 10 && R[k].tema, `«${k}» no está en menor con el tema`);
chk(R.contact.graves > R.contact.agudos + 6 && R.contact.dura <= 2.4, 'el golpe del contacto no es grave y corto');
const V = res.volumenes, base = V.todo, same = (a, b) => Math.abs(a - b) < 0.5;
chk(Object.values(base).every((x) => x > -90), 'alguna fuente no suena con todo al máximo');
chk(V.sinEfectos.disparo < -120 && V.sinEfectos.aviso < -120 && same(V.sinEfectos.musica, base.musica) && same(V.sinEfectos.gemido, base.gemido), 'el volumen de efectos no va solo');
chk(V.sinMusica.musica < -120 && same(V.sinMusica.disparo, base.disparo) && same(V.sinMusica.aviso, base.aviso) && same(V.sinMusica.gemido, base.gemido), 'el volumen de música no va solo');
chk(V.sinVoz.gemido < -120 && same(V.sinVoz.disparo, base.disparo) && same(V.sinVoz.aviso, base.aviso) && same(V.sinVoz.musica, base.musica), 'el volumen de voz no va solo');
chk(Math.abs(V.efectosMitad.aviso - (base.aviso - 6.02)) < 0.7, 'los efectos a la mitad no bajan 6 dB');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

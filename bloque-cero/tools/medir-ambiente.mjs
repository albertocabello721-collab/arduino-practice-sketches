// Mide el ambiente de la F12.5 sin tarjeta gráfica ni partida: el motor de audio solo, en un
// OfflineAudioContext, llamado como lo llama el juego (un «fotograma» cada 50 ms), en varios sitios
// y a cada hora:
//  · en la calle de día hay pájaros (trinos agudos, 2,5–6 kHz) y ningún grillo; de noche, grillos
//    (4,1–5 kHz a pulsos) y ningún pájaro; al atardecer, un poco de cada;
//  · en el salón suena el reloj (un tic por segundo, el golpe más fuerte en su banda); en la cocina, la nevera (100 Hz); en la planta
//    baja, algún crujido de arriba; en la planta alta, nada de eso.
// Uso: node tools/medir-ambiente.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const { outputFiles } = await build({
  stdin: { contents: "export * from './src/audio/audio.js';", resolveDir: path.resolve('.'), loader: 'js' },
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
  let LEN = 12;
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
  // energía media de una banda (ventanas de 8192 muestras con Hann)
  const band = (M, f0, f1) => {
    const N = 8192, w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    let e = 0, n = 0;
    for (let s = 0; s + N <= M.length; s += N) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = M[s + i] * w[i];
      fft(re, im);
      for (let k = Math.ceil((f0 * N) / RATE); k <= Math.floor((f1 * N) / RATE); k++) e += re[k] * re[k] + im[k] * im[k];
      n++;
    }
    return db(e / Math.max(1, n) / N);
  };
  // lo más fuerte de una banda en un trozo corto (1024 muestras, 21 ms): para golpes sueltos como el tic
  const peakBand = (M, f0, f1) => {
    const N = 1024, w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    let best = 0;
    for (let s = 0; s + N <= M.length; s += N / 2) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = M[s + i] * w[i];
      fft(re, im);
      let e = 0;
      for (let k = Math.ceil((f0 * N) / RATE); k <= Math.floor((f1 * N) / RATE); k++) e += re[k] * re[k] + im[k] * im[k];
      best = Math.max(best, e / N);
    }
    return db(best);
  };
  const run = async (len, pos, indoor, time) => {
    LEN = len;
    let x = 777;
    Math.random = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
    const a = new AudioEngine();
    a.init();
    a.setListener(pos, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    const ctx = a.ctx;
    for (let t = 0.05; t < len - 0.05; t += 0.05) ctx.suspend(t).then(() => { a._amb2.update(pos, indoor, time); ctx.resume(); });
    a.ambience(1 - indoor, indoor, pos, time);
    a._amb.wg.gain.value = 0; a._amb.hg.gain.value = 0;   // (sin el viento ni el zumbido de la F9: solo lo nuevo)
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), M = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) M[i] = (L[i] + R[i]) * 0.5;
    const A = a._amb2;
    return {
      pajaros: A.count.birds, coches: A.count.cars, grillos: A.count.crickets, tictac: A.count.clock, crujidos: A.count.creaks, nevera: A.fridge ? 1 : 0,
      trinos: band(M, 2500, 3900), grillo: band(M, 4150, 5000), zumbido: band(M, 95, 105), clic: peakBand(M, 3200, 3600),
    };
  };
  const calle = { x: 10, y: 1.6, z: -10 }, salon = { x: 2, y: 1.6, z: 6.5 }, cocina = { x: 13.5, y: 1.6, z: 18 }, arriba = { x: 6, y: 5.1, z: 20 };
  return {
    'calle, día': await run(12, calle, 0, 'dia'),
    'calle, atardecer': await run(12, calle, 0, 'atardecer'),
    'calle, noche': await run(12, calle, 0, 'noche'),
    'salón, noche': await run(20, salon, 1, 'noche'),
    'cocina, día': await run(12, cocina, 1, 'dia'),
    'planta alta, día': await run(20, arriba, 1, 'dia'),
  };
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(18), JSON.stringify(v));
const chk = (ok, what) => { if (!ok) errors.push(what); };
const D = res['calle, día'], T = res['calle, atardecer'], N = res['calle, noche'], S = res['salón, noche'], C = res['cocina, día'], U = res['planta alta, día'];
chk(D.pajaros >= 4 && D.grillos === 0 && D.trinos > N.trinos + 20, 'de día en la calle no hay pájaros (o hay grillos)');
chk(N.pajaros === 0 && N.grillos >= 15 && N.grillo > D.grillo + 10 && N.trinos < D.trinos - 30, 'de noche en la calle no hay grillos (o hay pájaros)');
chk(T.pajaros >= 1 && T.grillos >= 5, 'al atardecer no hay un poco de cada');
chk(D.coches >= 1, 'de día no pasa ningún coche');
chk(S.tictac >= 18 && S.clic > U.clic + 10 && S.clic > C.clic + 10, 'en el salón no suena el reloj');
chk(S.crujidos >= 1 && U.crujidos === 0, 'los crujidos: en la planta baja sí, en la alta no');
chk(C.nevera === 1 && C.zumbido > S.zumbido + 15, 'en la cocina no suena la nevera');
chk(U.tictac === 0 && U.nevera === 0, 'en la planta alta suena el reloj o la nevera');
chk(D.tictac === 0 && D.crujidos === 0 && D.nevera === 0, 'en la calle suena algo de dentro');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

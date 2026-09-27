// Mide lo que sale de verdad por los altavoces (Fase 9), sin tarjeta gráfica ni partida: el motor de
// audio solo, en un OfflineAudioContext. Un disparo de otro a 2, 8 y 30 m, libre y tapado por una
// pared, un suelo o del todo; y pasos corriendo, andando y agachado. Da el volumen (dB), los agudos
// (lo que hay por encima de 2 kHz, dB) y cuánto más suena por el oído de su lado (dB).
// Uso: node tools/medir-audio.mjs [motor de audio, por defecto src/audio/audio.js]
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const { outputFiles } = await build({ entryPoints: [process.argv[2] || 'src/audio/audio.js'], bundle: true, format: 'iife', globalName: 'BC_AUDIO', write: false });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: outputFiles[0].text });

const res = await page.evaluate(async () => {
  const { AudioEngine } = window.BC_AUDIO;
  const RATE = 48000, N = 16384;
  window.AudioContext = function () { return new OfflineAudioContext(2, RATE * 0.7, RATE); };
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
  // tú en el origen mirando hacia -z; la fuente a `d` m y `deg` grados a tu derecha
  const at = (d, deg, y = 1.6) => ({ x: d * Math.sin((deg * Math.PI) / 180), y, z: -d * Math.cos((deg * Math.PI) / 180) });
  const once = async (play) => {
    const a = new AudioEngine();
    a.init();
    a.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    play(a);
    const buf = await a.ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let sl = 0, sr = 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      sl += L[i] * L[i]; sr += R[i] * R[i];
      re[i] = (L[i] + R[i]) * 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    }
    fft(re, im);
    let hi = 0;
    for (let k = Math.ceil((2000 * N) / RATE); k < N / 2; k++) hi += re[k] * re[k] + im[k] * im[k];
    return { vol: 10 * Math.log10((sl + sr) / (2 * N)), hi: 10 * Math.log10(hi / N), side: 10 * Math.log10(sr / sl) };
  };
  // cada sonido lleva algo al azar: la media de 6
  const avg = async (play) => {
    const r = [];
    for (let i = 0; i < 6; i++) r.push(await once(play));
    const m = (k) => +(r.reduce((s, x) => s + x[k], 0) / r.length).toFixed(1);
    return { volumen: m('vol'), agudos: m('hi'), suLado: m('side') };
  };
  const shot = (d, occl) => avg((a) => a.gunshot('rifle', at(d, 45), false, occl));
  const step = (loud, occl) => avg((a) => a.footstep(3, at(5, 60, 0.05), loud, false, occl));
  return {
    'disparo a 2 m, libre': await shot(2, 0),
    'disparo a 8 m, libre': await shot(8, 0),
    'disparo a 8 m, tras una pared': await shot(8, 0.35),
    'disparo a 8 m, en otro piso': await shot(8, 0.6),
    'disparo a 8 m, tapado del todo': await shot(8, 1),
    'disparo a 30 m, libre': await shot(30, 0),
    'paso a 5 m corriendo, tras una pared': await step(1, 0.35),
    'paso a 5 m andando, tras una pared': await step(0.55, 0.35),
    'paso a 5 m agachado, tras una pared': await step(0.28, 0.35),
  };
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(38), `volumen ${v.volumen} dB · agudos ${v.agudos} dB · por su lado +${v.suLado} dB`);
const r = (k) => res[k];
const open = r('disparo a 8 m, libre'), wall = r('disparo a 8 m, tras una pared'), floor = r('disparo a 8 m, en otro piso'), full = r('disparo a 8 m, tapado del todo');
const check = (ok, what) => { if (!ok) errors.push(what); };
check(wall.volumen < open.volumen - 1 && wall.agudos < open.agudos - 2, 'tras una pared no suena más bajo y apagado');
check(floor.volumen < wall.volumen && floor.agudos < wall.agudos - 6, 'en otro piso no suena más apagado que tras una pared');
check(full.volumen < floor.volumen && full.agudos < floor.agudos, 'tapado del todo no suena más apagado que en otro piso');
check(r('disparo a 30 m, libre').volumen < open.volumen - 6, 'de lejos suena casi igual que de cerca');
check(open.suLado > 1.5, 'no se sabe de qué lado viene el disparo');
check(r('paso a 5 m agachado, tras una pared').volumen < r('paso a 5 m andando, tras una pared').volumen - 4, 'agachado suena casi como andando');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

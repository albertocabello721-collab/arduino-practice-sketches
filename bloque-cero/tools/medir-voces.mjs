// Mide los gemidos de la F12.2 sin tarjeta gráfica ni partida: el motor de audio solo, en un
// OfflineAudioContext. Un gemido de dolor y uno de derribado a 3 m por la derecha, libre y tras una
// pared, y el mismo gemido de dos operadores: cuánto duran, por qué oído suenan más, su tono (Hz) y
// si suenan a voz (graves y medios, 300–1300 Hz, por encima de los agudos, 3–8 kHz).
// Uso: node tools/medir-voces.mjs [motor de audio, por defecto src/audio/audio.js]
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
  const RATE = 48000, LEN = 1.5;
  window.AudioContext = function () { return new OfflineAudioContext(2, RATE * LEN, RATE); };
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
  const band = (M, f0, f1) => {
    const N = 16384, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N && i < M.length; i++) re[i] = M[i];
    fft(re, im);
    let e = 1e-12;
    for (let k = Math.ceil((f0 * N) / RATE); k < Math.min(N / 2, (f1 * N) / RATE); k++) e += re[k] * re[k] + im[k] * im[k];
    return 10 * Math.log10(e / N);
  };
  // el tono: autocorrelación entre 70 y 300 Hz en un trozo del principio
  const pitch = (M) => {
    const s0 = Math.floor(0.03 * RATE), W = Math.floor(0.08 * RATE);
    let best = 0, bl = 0;
    for (let lag = Math.floor(RATE / 300); lag <= Math.floor(RATE / 70); lag++) {
      let c = 0;
      for (let i = s0; i < s0 + W; i++) c += M[i] * M[i + lag];
      if (c > best) { best = c; bl = lag; }
    }
    return bl ? RATE / bl : 0;
  };
  const once = async (play) => {
    const a = new AudioEngine();
    a.init();
    a.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    play(a);
    const buf = await a.ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), M = new Float32Array(L.length);
    let sl = 0, sr = 0;
    for (let i = 0; i < L.length; i++) { sl += L[i] * L[i]; sr += R[i] * R[i]; M[i] = (L[i] + R[i]) * 0.5; }
    const W = Math.floor(RATE * 0.005), env = [];
    for (let i = 0; i + W <= M.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += M[j] * M[j]; env.push(s / W); }
    const peak = Math.max(...env);
    let last = 0;
    env.forEach((v, i) => { if (v > peak * 1e-3) last = i; });
    return { volumen: +(10 * Math.log10((sl + sr) / (2 * L.length) + 1e-12)).toFixed(1), suLado: +(10 * Math.log10(sr / sl)).toFixed(1), dura: +((last + 1) * 0.005).toFixed(2), tono: +pitch(M).toFixed(0), voz: +band(M, 300, 1300).toFixed(1), agudos: +band(M, 3000, 8000).toFixed(1) };
  };
  const right = { x: 3, y: 1.6, z: 0 };
  return {
    'dolor, libre': await once((a) => a.grunt(right, 'pain', 0, 0)),
    'dolor, tras una pared': await once((a) => a.grunt(right, 'pain', 0, 0.35)),
    'derribado': await once((a) => a.grunt(right, 'down', 0, 0)),
    'otro operador': await once((a) => a.grunt(right, 'pain', 4, 0)),
    'el tuyo': await once((a) => a.grunt(null, 'pain', 0, 0, true)),
  };
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(22), JSON.stringify(v));
const chk = (ok, what) => { if (!ok) errors.push(what); };
const P = res['dolor, libre'], W = res['dolor, tras una pared'], D = res['derribado'], O = res['otro operador'], Y = res['el tuyo'];
chk(P.suLado > 3, 'el gemido de la derecha no suena más por el oído derecho');
// (el tapado de siempre, F9: tras una pared algo más bajo y bastante más apagado)
chk(W.volumen < P.volumen - 0.8 && W.agudos < P.agudos - 4, 'tras una pared no suena más bajo y apagado');
chk(D.dura > P.dura * 2, 'el de derribado no es más largo');
chk(Math.abs(O.tono - P.tono) > 20, 'dos operadores con el mismo tono');
chk(P.voz > P.agudos + 10, 'no suena a voz (más agudos que medios)');
chk(Math.abs(Y.suLado) < 1.5, 'el tuyo no suena en el centro');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

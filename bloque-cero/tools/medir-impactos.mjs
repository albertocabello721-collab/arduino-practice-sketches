// Mide los sonidos de la F12.1 (impactos) sin tarjeta gráfica ni partida: el motor de audio solo, en
// un OfflineAudioContext. Los avisos de acierto (cuerpo, cabeza, baja, derribo): cuánto duran, cuánto
// grave (< 250 Hz) y cuánto agudo (2–8 kHz) llevan; recibir un golpe de 20 y de 50 (el pitido y lo
// apagado que suena lo demás); el chasquido de una bala que pasa a 0,5 y a 1,4 m por la derecha; y
// el latido con poca vida. Comprueba que cada cosa se distingue.
// Uso: node tools/medir-impactos.mjs [motor de audio, por defecto src/audio/audio.js]
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
  const RATE = 48000, LEN = 2.0;
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
  // energía (dB) entre f0 y f1 Hz en la ventana [t0, t0 + 0,34 s)
  const band = (L, R, t0, f0, f1) => {
    const N = 16384, s0 = Math.floor(t0 * RATE);
    const re = new Float64Array(N), im = new Float64Array(N);
    // (ventana rectangular: los sonidos empiezan en el instante 0 y una ventana de Hann se los comería)
    for (let i = 0; i < N && s0 + i < L.length; i++) re[i] = (L[s0 + i] + R[s0 + i]) * 0.5;
    fft(re, im);
    let e = 1e-12;
    for (let k = Math.ceil((f0 * N) / RATE); k < Math.min(N / 2, (f1 * N) / RATE); k++) e += re[k] * re[k] + im[k] * im[k];
    return 10 * Math.log10(e / N);
  };
  const render = async (play) => {
    const a = new AudioEngine();
    a.init();
    a.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    play(a);
    const buf = await a.ctx.startRendering();
    return { L: buf.getChannelData(0), R: buf.getChannelData(1) };
  };
  // cuánto dura: hasta que la envolvente (5 ms) cae 40 dB por debajo de su pico
  const duration = (L, R) => {
    const W = Math.floor(RATE * 0.005), env = [];
    for (let i = 0; i + W <= L.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += L[j] * L[j] + R[j] * R[j]; env.push(s / W); }
    const peak = Math.max(...env), th = peak * 1e-4;
    let last = 0;
    env.forEach((v, i) => { if (v > th) last = i; });
    return +((last + 1) * 0.005).toFixed(3);
  };
  const avg = async (n, play, f) => {
    const r = [];
    for (let i = 0; i < n; i++) r.push(f(await render(play)));
    const out = {};
    for (const k of Object.keys(r[0])) out[k] = +(r.reduce((s, x) => s + x[k], 0) / r.length).toFixed(1);
    return out;
  };
  const confirm = (kind) => avg(4, (a) => a.hitConfirm(kind), ({ L, R }) => ({ dura: duration(L, R), graves: band(L, R, 0, 20, 250), agudos: band(L, R, 0, 2000, 8000) }));
  const out = {};
  for (const k of ['hit', 'head', 'kill', 'down']) out['acierto ' + k] = await confirm(k);
  // recibir un golpe: el pitido (3,5–4,3 kHz de 0,5 a 0,84 s) y lo apagado que suena un ruido agudo
  // (> 7 kHz) que llega 0,1 s después
  const hurt = (amount) => avg(3, (a) => { if (amount) a.hurt(amount); a._burst(a.sfx, 0.1, { type: 'highpass', freq: 7000, q: 0.7, a: 0.002, peak: 0.8, d: 0.3 }); },
    ({ L, R }) => ({ pitido: band(L, R, 0.5, 3500, 4300), agudosDespues: band(L, R, 0.1, 7000, 16000) }));
  out['sin golpe'] = await hurt(0);
  out['golpe de 20'] = await hurt(20);
  out['golpe de 50'] = await hurt(50);
  // chasquido de una bala que pasa por la derecha
  const crack = (d) => avg(4, (a) => a.bulletCrack({ x: d, y: 1.6, z: -0.2 }, d, 0), ({ L, R }) => {
    let sl = 0, sr = 0;
    for (let i = 0; i < L.length; i++) { sl += L[i] * L[i]; sr += R[i] * R[i]; }
    return { volumen: 10 * Math.log10((sl + sr) / (2 * L.length) + 1e-12), suLado: 10 * Math.log10(sr / sl), dura: duration(L, R) };
  });
  out['bala a 0,5 m'] = await crack(0.5);
  out['bala a 1,4 m'] = await crack(1.4);
  // el latido (el primer golpe del bucle)
  out['latido'] = await avg(1, (a) => a.lowHealth(0.8), ({ L, R }) => ({ graves: band(L, R, 0, 20, 120) }));
  out['silencio'] = await avg(1, () => {}, ({ L, R }) => ({ graves: band(L, R, 0, 20, 120) }));
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(16), JSON.stringify(v));
const chk = (ok, what) => { if (!ok) errors.push(what); };
const A = (k) => res['acierto ' + k];
chk(A('head').agudos > A('hit').agudos + 6, 'la cabeza no suena más aguda que el cuerpo');
chk(A('head').dura > A('hit').dura * 2, 'el «tin» del casco no dura más que el golpe al cuerpo');
chk(A('kill').graves > A('hit').graves + 6, 'la baja no lleva más graves que el cuerpo');
chk(A('kill').dura > A('down').dura, 'la baja no se distingue del derribo (la campanada)');
chk(res['golpe de 50'].pitido > res['golpe de 20'].pitido + 10, 'con 50 de daño no pitan los oídos');
chk(res['golpe de 50'].agudosDespues < res['golpe de 20'].agudosDespues - 6, 'con 50 de daño lo demás no suena apagado');
chk(Math.abs(res['golpe de 20'].agudosDespues - res['sin golpe'].agudosDespues) < 1.5, 'un golpe de 20 ya apaga lo demás');
chk(res['bala a 0,5 m'].volumen > res['bala a 1,4 m'].volumen + 3, 'la bala más cercana no suena más fuerte');
chk(res['bala a 0,5 m'].suLado > 3, 'la bala por la derecha no suena más por el oído derecho');
chk(res['bala a 0,5 m'].dura < 0.15, 'el chasquido no es corto');
chk(res['latido'].graves > res['silencio'].graves + 30, 'no se oye el latido');
console.log('errores:', errors.length ? errors.join('\n') : 0);
await browser.close();

// Motor de audio sintetizado con Web Audio: sin archivos. Disparos por capas
// (chasquido, cuerpo, golpe grave, mecánica, cola de reverberación), impactos,
// roturas por material, pasos, recargas y casquillos. Sonido 3D con HRTF.
// Fase 9: la oclusión viene de propagation.js (por dónde llega cada sonido), y hay ambiente
// (viento fuera, zumbido eléctrico dentro). F12.3: la música (music.js) y tres volúmenes aparte,
// además del general: efectos, música y voz (los gemidos; la voz del navegador lo aplica voice.js).
import { Music } from './music.js';

// La oclusión multiplicada (sirve el número o lo que devuelve la propagación, {x, y, z, occl})
const scaleOccl = (o, k) => (o && typeof o === 'object' ? { x: o.x, y: o.y, z: o.z, occl: o.occl * k } : o * k);

const SND = { none: 0, grass: 1, dirt: 2, concrete: 3, wood: 4, metal: 5, glass: 6, carpet: 7, tile: 8, plaster: 9, fabric: 10, gravel: 11, brick: 12 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.vol = { sfx: 1, music: 1, voice: 1 };   // efectos, música y voz (F12.3), sobre el general
    this.listener = { x: 0, y: 0, z: 0 };
    this.indoor = 0; // 0 exterior, 1 interior (para la reverberación)
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    // buses (los efectos y las voces pasan por un filtro que un golpe fuerte cierra un momento: F12.1;
    // derribado, se amortiguan). Cada uno con su volumen (F12.3):
    //   sfx (efectos) y voice (gemidos) → duck (derribado) → muffle (golpe) → master
    //   dry: efectos sin ese filtro (avisos, interfaz, latido, ambiente) → master
    //   musicOut (la música) → master
    const V = this.vol;
    this.sfx = ctx.createGain(); this.sfx.gain.value = V.sfx;
    this.voice = ctx.createGain(); this.voice.gain.value = V.voice;
    this.duck = ctx.createGain();
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.7;
    this.sfx.connect(this.duck); this.voice.connect(this.duck);
    this.duck.connect(this.muffle).connect(this.master);
    this.dry = ctx.createGain(); this.dry.gain.value = V.sfx; this.dry.connect(this.master);
    this.musicOut = ctx.createGain(); this.musicOut.gain.value = V.music; this.musicOut.connect(this.master);
    this.reverbRoom = ctx.createConvolver(); this.reverbRoom.buffer = this._impulse(0.9, 3.2, 0.5);
    this.reverbOut = ctx.createConvolver(); this.reverbOut.buffer = this._impulse(2.2, 2.0, 0.25, true);
    this.revRoomGain = ctx.createGain(); this.revRoomGain.gain.value = 0.0;
    this.revOutGain = ctx.createGain(); this.revOutGain.gain.value = 0.35;
    // envíos a la reverberación: el de los efectos y el de las voces, cada uno con su volumen
    this.revSend = ctx.createGain(); this.revSend.gain.value = V.sfx;
    this.revVoice = ctx.createGain(); this.revVoice.gain.value = V.voice;
    this.revSend.connect(this.reverbRoom).connect(this.revRoomGain).connect(this.master);
    this.revSend.connect(this.reverbOut).connect(this.revOutGain).connect(this.master);
    this.revVoice.connect(this.reverbRoom); this.revVoice.connect(this.reverbOut);
    // distorsión suave para dar grano a los disparos
    this.shaper = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
    this.shaper.curve = curve;
    this.shaper.connect(this.sfx);
    // ruido blanco y rosa
    this.noise = this._noiseBuffer(2, false);
    this.pink = this._noiseBuffer(2, true);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  /** Volúmenes de efectos, música y voz (0…1, sobre el general): {sfx, music, voice}, los que vengan. */
  setVolumes(v) {
    for (const k of ['sfx', 'music', 'voice']) if (v && typeof v[k] === 'number') this.vol[k] = Math.max(0, Math.min(1, v[k]));
    if (!this.ctx) return;
    const t = this.ctx.currentTime, V = this.vol;
    for (const [node, x] of [[this.sfx, V.sfx], [this.dry, V.sfx], [this.revSend, V.sfx], [this.voice, V.voice], [this.revVoice, V.voice], [this.musicOut, V.music]]) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.setTargetAtTime(x, t, 0.02);
    }
  }

  _noiseBuffer(sec, pink) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) { d[i] = w; continue; }
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return b;
  }
  _impulse(sec, decay, bright, slap = false) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp = lp + (v - lp) * (bright + (1 - t) * 0.3);
        d[i] = lp;
        if (slap && Math.abs(i - ctx.sampleRate * 0.18) < 60) d[i] += (Math.random() - 0.5) * 0.8;
      }
    }
    return b;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }
  setIndoor(k) {
    if (!this.ctx) return;
    this.indoor = k;
    const t = this.ctx.currentTime;
    this.revRoomGain.gain.setTargetAtTime(0.28 * k, t, 0.2);
    this.revOutGain.gain.setTargetAtTime(0.32 * (1 - k), t, 0.2);
  }

  // Nodo de salida: posicional (HRTF) o directo. opts.occl 0..1 atenúa y filtra; puede ser también
  // lo que devuelve la propagación ({x, y, z, occl}): entonces suena desde ese punto (una puerta).
  // opts.voice: por el bus de las voces (su volumen) en vez del de los efectos.
  _out(pos, { gain = 1, ref = 2, rolloff = 1.2, occl = 0, reverb = 0.3, direct = false, voice = false } = {}) {
    const ctx = this.ctx;
    const bus = voice ? this.voice : this.sfx, send = voice ? this.revVoice : this.revSend;
    if (occl && typeof occl === 'object') { if (pos) pos = occl; occl = occl.occl; }
    const g = ctx.createGain();
    g.gain.value = gain * (1 - occl * 0.55);
    let head = g;
    if (occl > 0) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200 * Math.pow(1 - occl, 2) + 350;
      g.connect(lp); head = lp;
    }
    if (!direct && pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 200;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      // absorción del aire con la distancia
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = Math.max(1800, 18000 - d * 260);
      head.connect(air).connect(p);
      p.connect(bus);
      if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; p.connect(s).connect(send); }
    } else {
      head.connect(bus);
      if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; head.connect(s).connect(send); }
    }
    return g;
  }

  _noiseSrc(pink = false, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = pink ? this.pink : this.noise;
    s.playbackRate.value = rate;
    return s;
  }
  _env(g, t, a, peak, d, sustainTo = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(sustainTo, t + a + d);
  }
  _burst(dest, t, { type = 'bandpass', freq = 1000, q = 1, a = 0.001, peak = 1, d = 0.1, pink = false, rate = 1 }) {
    const ctx = this.ctx;
    const src = this._noiseSrc(pink, rate);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, a, peak, d);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, a + d + 0.05);
    return f;
  }
  _tone(dest, t, { f0 = 100, f1 = 50, a = 0.002, peak = 1, d = 0.1, type = 'sine' }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = ctx.createGain();
    this._env(g, t, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + a + d + 0.05);
  }

  // ------------------------------------------------------------ disparos
  // quiet: con supresor (F10.3): sin chasquido ni grano, un soplo apagado y mucho más bajo
  gunshot(kind, pos, local = false, occl = 0, quiet = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.002;
    const P = {
      rifle: { crack: 1.0, body: 0.9, bodyF: 220, thump: 0.9, thumpF: 110, click: 0.25, len: 0.16 },
      smg: { crack: 0.8, body: 0.7, bodyF: 300, thump: 0.6, thumpF: 130, click: 0.3, len: 0.12 },
      shotgun: { crack: 1.0, body: 1.2, bodyF: 150, thump: 1.4, thumpF: 80, click: 0.2, len: 0.3 },
      pistol: { crack: 0.9, body: 0.6, bodyF: 380, thump: 0.5, thumpF: 150, click: 0.35, len: 0.1 },
    }[kind] || { crack: 1, body: 1, bodyF: 220, thump: 1, thumpF: 110, click: 0.2, len: 0.15 };
    const vary = 0.9 + Math.random() * 0.2;
    const dist = pos ? Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) : 0;
    const out = this._out(local ? null : pos, { gain: (local ? 0.9 : 1.6) * (quiet ? 0.32 : 1), ref: quiet ? 2 : 3, rolloff: 1.0, occl, reverb: (local ? 0.55 : 0.6) * (quiet ? 0.4 : 1), direct: local });
    if (quiet) {
      // supresor: un «pff» de gas (ruido que baja de tono), el cuerpo apagado y un golpe corto
      this._burst(out, t, { type: 'bandpass', freq: 1500 * vary, q: 0.8, a: 0.001, peak: 0.9, d: 0.06 });
      this._burst(out, t + 0.002, { type: 'lowpass', freq: 700 * vary, q: 0.6, a: 0.002, peak: P.body * 0.8, d: P.len * 0.8, pink: true });
      this._tone(out, t, { f0: P.thumpF * 1.4 * vary, f1: P.thumpF * 0.5, a: 0.001, peak: P.thump * 0.5, d: 0.05 });
      if (local || dist < 8) this._burst(out, t + 0.012, { type: 'bandpass', freq: 4200, q: 3, a: 0.0005, peak: P.click * (local ? 1.6 : 0.8), d: 0.012 });
      return;
    }
    const bus = ctx.createGain();
    if (local) { bus.connect(this.shaper); bus.connect(out); }
    else {
      // el grano de los disparos de otros también va por su posición y lo que tapa (antes sonaba
      // igual de fuerte a cualquier distancia y sin tapar); juntos suman más, así que todo va a
      // 0,66: de cerca suena igual de fuerte que antes
      const mix = ctx.createGain(); mix.gain.value = 0.66; mix.connect(out);
      const sh = ctx.createWaveShaper(); sh.curve = this.shaper.curve;
      const k = ctx.createGain(); k.gain.value = 1 / 1.6;
      bus.connect(mix); bus.connect(sh).connect(k).connect(mix);
    }
    bus.gain.value = local ? 0.55 : 0.5;
    // chasquido supersónico
    this._burst(bus, t, { type: 'highpass', freq: 2200 * vary, q: 0.7, a: 0.0006, peak: P.crack * (dist > 30 ? 0.5 : 1), d: 0.035 });
    // cuerpo
    this._burst(bus, t, { type: 'bandpass', freq: P.bodyF * vary, q: 0.9, a: 0.001, peak: P.body * 1.4, d: P.len, pink: true });
    this._burst(bus, t + 0.004, { type: 'lowpass', freq: 1400 * vary, q: 0.5, a: 0.002, peak: P.body * 0.6, d: P.len * 1.4 });
    // golpe grave
    this._tone(bus, t, { f0: P.thumpF * 1.8 * vary, f1: P.thumpF * 0.4, a: 0.001, peak: P.thump * 1.2, d: 0.09 });
    // mecánica del arma (solo cerca)
    if (local || dist < 8) this._burst(out, t + 0.012, { type: 'bandpass', freq: 4200, q: 3, a: 0.0005, peak: P.click * (local ? 1 : 0.4), d: 0.012 });
    // casquillo
    if (local && kind !== 'shotgun') {
      const tc = t + 0.35 + Math.random() * 0.25;
      for (let i = 0; i < 2; i++) this._tone(this.sfx, tc + i * (0.05 + Math.random() * 0.06), { f0: 5200 + Math.random() * 2400, f1: 4800, a: 0.001, peak: 0.05 / (i + 1), d: 0.05, type: 'triangle' });
    }
    if (local && kind === 'shotgun') {
      // bombeo
      this._burst(this.sfx, t + 0.28, { type: 'bandpass', freq: 1800, q: 2, a: 0.004, peak: 0.25, d: 0.06 });
      this._burst(this.sfx, t + 0.42, { type: 'bandpass', freq: 2400, q: 2, a: 0.002, peak: 0.3, d: 0.05 });
    }
  }

  // ------------------------------------------------------------ impactos y roturas
  impact(snd, pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.55, ref: 1.5, rolloff: 1.4, occl, reverb: 0.2 });
    if (snd === SND.metal) {
      this._burst(out, t, { type: 'bandpass', freq: 3200, q: 6, a: 0.0005, peak: 0.8, d: 0.08 });
      for (let i = 0; i < 3; i++) this._tone(out, t, { f0: 1800 + Math.random() * 2600, f1: 1500, a: 0.0005, peak: 0.12, d: 0.25 + Math.random() * 0.2, type: 'sine' });
    } else if (snd === SND.wood) {
      this._burst(out, t, { type: 'bandpass', freq: 900, q: 1.5, a: 0.0008, peak: 0.9, d: 0.05 });
      this._tone(out, t, { f0: 320, f1: 180, a: 0.001, peak: 0.3, d: 0.05 });
    } else {
      this._burst(out, t, { type: 'bandpass', freq: 2400, q: 1.2, a: 0.0005, peak: 0.9, d: 0.03 });
      this._burst(out, t + 0.004, { type: 'lowpass', freq: 900, q: 0.7, a: 0.002, peak: 0.4, d: 0.12, pink: true });
      if (Math.random() < 0.3) this._tone(out, t + 0.01, { f0: 2600 + Math.random() * 1500, f1: 700, a: 0.003, peak: 0.08, d: 0.22, type: 'sine' }); // rebote
    }
  }

  breakMaterial(snd, pos, amount = 1, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const big = Math.min(1, amount / 60);
    const out = this._out(pos, { gain: 0.5 + big * 0.9, ref: 2, rolloff: 1.2, occl, reverb: 0.35 });
    if (snd === SND.glass) {
      this._burst(out, t, { type: 'highpass', freq: 4500, q: 0.7, a: 0.001, peak: 0.7, d: 0.3 });
      const n = 8 + Math.floor(big * 10);
      for (let i = 0; i < n; i++) this._tone(out, t + Math.random() * 0.35, { f0: 3000 + Math.random() * 5000, f1: 2800, a: 0.0005, peak: 0.08 + Math.random() * 0.08, d: 0.06 + Math.random() * 0.12, type: 'sine' });
      return;
    }
    if (snd === SND.wood || snd === SND.fabric) {
      const n = 2 + Math.floor(big * 8);
      for (let i = 0; i < n; i++) this._burst(out, t + Math.random() * (0.05 + big * 0.3), { type: 'bandpass', freq: 600 + Math.random() * 2400, q: 2.5, a: 0.0005, peak: 0.5, d: 0.02 + Math.random() * 0.04 });
      this._burst(out, t, { type: 'lowpass', freq: 500, q: 0.8, a: 0.002, peak: 0.4 + big * 0.5, d: 0.1 + big * 0.4, pink: true });
      return;
    }
    // yeso, ladrillo, hormigón: desmoronamiento granulado
    this._burst(out, t, { type: 'bandpass', freq: 1800, q: 0.8, a: 0.001, peak: 0.6, d: 0.04 });
    this._burst(out, t + 0.01, { type: 'lowpass', freq: 1200 + big * 800, q: 0.5, a: 0.004, peak: 0.35 + big * 0.6, d: 0.18 + big * 0.8, pink: true });
    const n = 3 + Math.floor(big * 12);
    for (let i = 0; i < n; i++) this._burst(out, t + 0.03 + Math.random() * (0.1 + big * 0.9), { type: 'bandpass', freq: 1500 + Math.random() * 3000, q: 3, a: 0.0005, peak: 0.12, d: 0.015 });
  }

  // ------------------------------------------------------------ pasos
  footstep(snd, pos, loud = 0.5, local = false, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: (local ? 0.28 : 0.9) * loud, ref: 1.5, rolloff: 1.3, occl, reverb: 0.15, direct: local });
    const v = 0.9 + Math.random() * 0.2;
    switch (snd) {
      case SND.wood:
        this._burst(out, t, { type: 'bandpass', freq: 260 * v, q: 1.3, a: 0.002, peak: 0.9, d: 0.07 });
        this._burst(out, t + 0.01, { type: 'bandpass', freq: 1100 * v, q: 2, a: 0.001, peak: 0.25, d: 0.03 });
        if (Math.random() < 0.12) this._tone(out, t + 0.03, { f0: 420 * v, f1: 380, a: 0.02, peak: 0.05, d: 0.15, type: 'sawtooth' });
        break;
      case SND.carpet: case SND.fabric:
        this._burst(out, t, { type: 'lowpass', freq: 550, q: 0.7, a: 0.004, peak: 0.5, d: 0.06, pink: true });
        break;
      case SND.metal:
        this._burst(out, t, { type: 'bandpass', freq: 1900 * v, q: 5, a: 0.001, peak: 0.6, d: 0.09 });
        this._tone(out, t, { f0: 700 * v, f1: 650, a: 0.001, peak: 0.1, d: 0.18, type: 'triangle' });
        break;
      case SND.grass: case SND.dirt: case SND.gravel:
        this._burst(out, t, { type: 'bandpass', freq: snd === SND.gravel ? 3200 : 2200, q: 0.8, a: 0.004, peak: 0.45, d: 0.07 });
        this._burst(out, t + 0.02, { type: 'highpass', freq: 3500, q: 0.7, a: 0.003, peak: snd === SND.gravel ? 0.3 : 0.12, d: 0.05 });
        break;
      default: // hormigón, baldosa, yeso
        this._burst(out, t, { type: 'bandpass', freq: 1600 * v, q: 1.1, a: 0.0008, peak: 0.55, d: 0.035 });
        this._burst(out, t + 0.004, { type: 'lowpass', freq: 380, q: 1, a: 0.002, peak: 0.6, d: 0.05 });
    }
  }

  // ------------------------------------------------------------ arma: mecánica
  weaponFoley(kind, pos, local = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.5 : 0.5, direct: local, reverb: 0.1 });
    const click = (dt, f, peak, d = 0.015, q = 4) => this._burst(out, t + dt, { type: 'bandpass', freq: f, q, a: 0.0005, peak, d });
    if (kind === 'magout') { click(0, 2600, 0.6); click(0.03, 900, 0.4, 0.05, 1.5); }
    else if (kind === 'magin') { click(0, 1500, 0.5, 0.03, 2); click(0.05, 3200, 0.9); }
    else if (kind === 'bolt') { click(0, 1200, 0.4, 0.06, 1.2); click(0.09, 3800, 1.0); click(0.12, 2000, 0.5); }
    else if (kind === 'slap') { click(0, 650, 0.8, 0.05, 1.1); click(0.004, 2500, 0.55, 0.015, 3); }
    else if (kind === 'shell') { click(0, 1800, 0.45, 0.025, 2.2); click(0.05, 3100, 0.5, 0.012, 5); }
    else if (kind === 'pump') { click(0, 1000, 0.55, 0.06, 1.2); click(0.1, 850, 0.5, 0.06, 1.2); click(0.14, 3300, 0.7, 0.015, 5); }
    else if (kind === 'open') { click(0, 2300, 0.45, 0.02, 3); click(0.05, 1200, 0.3, 0.04, 1.5); }
    else if (kind === 'close') { click(0, 1400, 0.5, 0.025, 2); click(0.03, 3400, 0.75, 0.012, 6); }
    else if (kind === 'eject') { for (let i = 0; i < 4; i++) click(0.03 + i * 0.035, 3600 + i * 300, 0.35, 0.02, 6); }
    else if (kind === 'belt') { for (let i = 0; i < 3; i++) click(i * 0.04, 2500 + i * 250, 0.3, 0.02, 3); }
    else if (kind === 'magdrop') { click(0, 900, 0.55, 0.05, 1.3); click(0.01, 2800, 0.35, 0.03, 3); click(0.09, 2200, 0.2, 0.03, 3); }
    else if (kind === 'casing') { click(0, 5200, 0.25, 0.04, 8); click(0.06, 4800, 0.15, 0.04, 8); }
    else if (kind === 'dry') { click(0, 3000, 0.5, 0.01, 6); }
    else if (kind === 'switch') { click(0, 900, 0.25, 0.05, 1); click(0.12, 2600, 0.35); }
    else if (kind === 'vault') { this._burst(out, t, { type: 'lowpass', freq: 700, q: 0.7, a: 0.02, peak: 0.4, d: 0.2, pink: true }); }
    else if (kind === 'land') { this._burst(out, t, { type: 'lowpass', freq: 300, q: 0.8, a: 0.003, peak: 0.9, d: 0.12 }); }
  }

  // ------------------------------------------------------------ combate
  // Impacto en un cuerpo (lo oye todo el mundo cerca): golpe sordo + chasquido del chaleco.
  hitFlesh(pos, headshot = false, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: headshot ? 0.9 : 0.6, ref: 2, rolloff: 1.3, occl, reverb: 0.15 });
    this._burst(out, t, { type: 'lowpass', freq: 420, q: 1.2, a: 0.001, peak: 0.9, d: 0.08 });
    this._burst(out, t + 0.002, { type: 'bandpass', freq: headshot ? 3000 : 1300, q: 2, a: 0.0005, peak: headshot ? 0.8 : 0.4, d: 0.03 });
  }
  // Confirmación para quien dispara (seca, sin posicionar; F12.1): al cuerpo, un golpe seco con un
  // chasquido; a la cabeza, el «tin» metálico del casco (parciales inarmónicos que suenan un rato);
  // una baja, un golpe grave con una campanada; un derribo, el golpe grave solo.
  hitConfirm(kind = 'hit') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.38; g.connect(this.sfx);
    if (kind === 'head') {
      this._burst(g, t, { type: 'highpass', freq: 4200, q: 0.7, a: 0.0004, peak: 0.55, d: 0.02 });
      for (const [f, peak, d] of [[2650, 0.42, 0.42], [4120, 0.26, 0.3], [5690, 0.16, 0.22], [7300, 0.08, 0.14]]) this._tone(g, t + 0.001, { f0: f, f1: f * 0.994, a: 0.0015, peak, d, type: 'sine' });
    } else if (kind === 'kill' || kind === 'down') {
      this._tone(g, t, { f0: 120, f1: 42, a: 0.003, peak: 1.0, d: 0.3 });
      this._burst(g, t, { type: 'lowpass', freq: 420, q: 0.9, a: 0.002, peak: 0.7, d: 0.12 });
      this._burst(g, t, { type: 'bandpass', freq: 2600, q: 2.5, a: 0.0005, peak: 0.35, d: 0.02 });
      if (kind === 'kill') {
        this._tone(g, t + 0.035, { f0: 1175, f1: 1172, a: 0.002, peak: 0.34, d: 0.45 });
        this._tone(g, t + 0.035, { f0: 2350, f1: 2344, a: 0.002, peak: 0.12, d: 0.3 });
      }
    } else {
      this._tone(g, t, { f0: 190, f1: 110, a: 0.001, peak: 0.55, d: 0.06 });
      this._burst(g, t, { type: 'lowpass', freq: 900, q: 0.8, a: 0.0008, peak: 0.55, d: 0.045 });
      this._burst(g, t, { type: 'bandpass', freq: 3200, q: 2, a: 0.0004, peak: 0.4, d: 0.016 });
    }
  }
  // Recibir daño: golpe sordo; con un golpe de 40 o más, pitan los oídos y el resto suena apagado
  // un momento (F12.1).
  hurt(amount) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.5; g.connect(this.dry);
    this._tone(g, t, { f0: 140, f1: 55, a: 0.002, peak: Math.min(1, 0.35 + amount / 50), d: 0.2 });
    this._burst(g, t, { type: 'lowpass', freq: 520, q: 0.8, a: 0.002, peak: 0.6, d: 0.12 });
    if (amount >= 40) {
      const k = Math.min(1, amount / 80);
      this.ringing(0.35 + 0.4 * k);
      const f = this.muffle.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(20000, t);
      f.exponentialRampToValueAtTime(700 - 250 * k, t + 0.03);
      f.setTargetAtTime(20000, t + 0.35, 0.35 + 0.3 * k);
    }
  }
  // Poca vida (F12.1): latido en bucle, más rápido y más fuerte cuanta menos vida (k 0…1); 0 lo para.
  lowHealth(k) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!(k > 0) || this._downed) {
      if (this._low) { clearTimeout(this._low.timer); this._low.g.gain.setTargetAtTime(0, ctx.currentTime, 0.25); this._low = null; }
      return;
    }
    if (!this._low) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.dry);
      this._low = { g, k };
      const loop = () => {
        const L = this._low;
        if (!L) return;
        const t = ctx.currentTime;
        this._tone(L.g, t, { f0: 60, f1: 44, a: 0.01, peak: 0.9, d: 0.11 });
        this._tone(L.g, t + 0.2, { f0: 54, f1: 41, a: 0.01, peak: 0.55, d: 0.11 });
        L.timer = setTimeout(loop, 1000 - 380 * L.k);
      };
      loop();
    }
    this._low.k = k;
    this._low.g.gain.setTargetAtTime(0.18 + 0.32 * k, ctx.currentTime, 0.3);
  }
  // Un gemido (F12.2): al recibir daño, corto; al caer derribado, largo y cayendo. Una voz sintetizada
  // (diente de sierra por tres formantes, como una «u» cerrada, y algo de aire) con el tono de cada
  // operador (`seed`); en 3D y tapado por las paredes como los demás sonidos. El propio, sin posición.
  grunt(pos, kind = 'pain', seed = 0, occl = 0, local = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const down = kind === 'down';
    const f0 = 105 + (seed % 7) * 14, len = down ? 0.7 : 0.17 + (seed % 3) * 0.02;
    let out;
    if (local) { out = ctx.createGain(); out.gain.value = down ? 0.4 : 0.32; out.connect(this.voice); }
    else out = this._out(pos, { gain: down ? 0.95 : 0.8, ref: 2, rolloff: 1.3, occl, reverb: 0.2, voice: true });
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * (down ? 1.05 : 1.2), t);
    o.frequency.exponentialRampToValueAtTime(f0 * (down ? 0.7 : 0.88), t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.018);
    env.gain.setTargetAtTime(0.0001, t + len * 0.55, len * 0.22);
    o.connect(env);
    const F = down ? [[620, 6, 1], [1050, 7, 0.55], [2450, 9, 0.2]] : [[520, 6, 1], [950, 7, 0.6], [2400, 9, 0.22]];
    for (const [f, q, g] of F) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g * 2.4;
      env.connect(bp).connect(gg).connect(out);
    }
    this._burst(out, t, { type: 'bandpass', freq: 1400, q: 0.8, a: 0.012, peak: 0.1, d: len * 0.8, pink: true });
    o.start(t); o.stop(t + len + 0.6);
  }
  // Una bala que te pasa cerca (F12.1): el chasquido (la onda de la bala) y un silbido corto, desde
  // donde pasó; más fuerte cuanto más cerca.
  bulletCrack(pos, dist, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.max(0.25, 1 - dist / 1.5);
    const out = this._out(pos, { gain: 0.9 * k, ref: 0.8, rolloff: 1, occl, reverb: 0.06 });
    this._burst(out, t, { type: 'highpass', freq: 2600, q: 0.8, a: 0.0003, peak: 1.0, d: 0.018 });
    const f = this._burst(out, t + 0.004, { type: 'bandpass', freq: 3400, q: 3, a: 0.004, peak: 0.45, d: 0.07 });
    f.frequency.setValueAtTime(3400, t + 0.004);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.08);
  }
  // Derribado: latido y respiración en bucle mientras dure.
  startDowned() {
    if (!this.ctx || this._downed) return;
    const ctx = this.ctx;
    this.lowHealth(0);
    const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this.dry);
    g.gain.setTargetAtTime(0.55, ctx.currentTime, 0.3);
    this._downed = { g, beat: 0 };
    const loop = () => {
      if (!this._downed) return;
      const t = ctx.currentTime;
      this._tone(g, t, { f0: 62, f1: 45, a: 0.01, peak: 0.9, d: 0.12 });
      this._tone(g, t + 0.22, { f0: 55, f1: 42, a: 0.01, peak: 0.6, d: 0.12 });
      if ((this._downed.beat++ & 1) === 0) this._burst(g, t + 0.1, { type: 'bandpass', freq: 700, q: 0.8, a: 0.25, peak: 0.12, d: 0.5, pink: true });
      this._downed.timer = setTimeout(loop, 820);
    };
    loop();
    // amortiguar el resto de la mezcla
    this.duck.gain.setTargetAtTime(0.45, ctx.currentTime, 0.2);
  }
  stopDowned() {
    if (!this._downed) return;
    clearTimeout(this._downed.timer);
    this._downed.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this._downed = null;
    this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
  }
  bodyFall(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.8, ref: 2, rolloff: 1.3, occl, reverb: 0.2 });
    this._burst(out, t + 0.35, { type: 'lowpass', freq: 260, q: 1, a: 0.004, peak: 0.9, d: 0.2, pink: true });
    this._burst(out, t + 0.42, { type: 'bandpass', freq: 900, q: 1.5, a: 0.002, peak: 0.3, d: 0.08 });
  }
  reviveDone() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.3; g.connect(this.sfx);
    this._burst(g, t, { type: 'bandpass', freq: 2000, q: 2, a: 0.01, peak: 0.4, d: 0.12 });
    this._tone(g, t + 0.05, { f0: 880, f1: 990, a: 0.01, peak: 0.25, d: 0.2, type: 'sine' });
  }

  ui(kind = 'click') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.15; g.connect(this.dry);
    if (kind === 'click') this._tone(g, t, { f0: 1800, f1: 1400, a: 0.001, peak: 0.4, d: 0.04, type: 'triangle' });
    else if (kind === 'hover') this._tone(g, t, { f0: 2400, f1: 2300, a: 0.001, peak: 0.12, d: 0.025, type: 'sine' });
    else this._tone(g, t, { f0: 600, f1: 900, a: 0.01, peak: 0.3, d: 0.15, type: 'sine' });
  }

  // ------------------------------------------------------------ avisos de la partida
  // Señales de ronda (no posicionales): preparación, acción, cuenta atrás, plantado… La victoria y la
  // derrota (de la ronda y de la partida) son música: el tema (F12.3).
  cue(kind) {
    if (!this.ctx) return;
    if (kind === 'win' || kind === 'lose' || kind === 'matchWin' || kind === 'matchLose') { this.stinger(kind); return; }
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0.32; g.connect(this.dry);
    const chord = (freqs, at, dur, peak = 0.3, type = 'sawtooth') => {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.7; lp.connect(g);
      for (const f of freqs) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
        const e = ctx.createGain(); e.gain.value = 0;
        e.gain.setValueAtTime(0, t + at); e.gain.linearRampToValueAtTime(peak / freqs.length, t + at + 0.08);
        e.gain.setTargetAtTime(0, t + at + dur * 0.6, dur * 0.25);
        o.connect(e).connect(lp); o.start(t + at); o.stop(t + at + dur + 0.6);
      }
    };
    switch (kind) {
      case 'prep': // golpe grave y acorde tenso
        this._tone(g, t, { f0: 70, f1: 38, a: 0.005, peak: 1, d: 0.9 });
        chord([110, 164.8, 207.7], 0.05, 1.6, 0.5);
        break;
      case 'action': // sirena corta de dos tonos
        for (let i = 0; i < 2; i++) {
          this._tone(g, t + i * 0.34, { f0: 880, f1: 870, a: 0.01, peak: 0.35, d: 0.14, type: 'square' });
          this._tone(g, t + i * 0.34 + 0.16, { f0: 660, f1: 655, a: 0.01, peak: 0.35, d: 0.14, type: 'square' });
        }
        this._tone(g, t, { f0: 90, f1: 45, a: 0.005, peak: 0.8, d: 0.6 });
        break;
      case 'tick':
        this._tone(g, t, { f0: 1320, f1: 1310, a: 0.001, peak: 0.25, d: 0.05, type: 'square' });
        break;
      case 'planted':
        this._burst(g, t, { type: 'bandpass', freq: 1800, q: 3, a: 0.002, peak: 0.6, d: 0.08 });
        this._tone(g, t + 0.08, { f0: 1200, f1: 1600, a: 0.01, peak: 0.35, d: 0.3, type: 'triangle' });
        this._tone(g, t + 0.3, { f0: 70, f1: 40, a: 0.01, peak: 0.9, d: 0.8 });
        chord([98, 146.8, 185], 0.3, 1.4, 0.45);
        break;
      case 'plantStart':
        this._burst(g, t, { type: 'bandpass', freq: 900, q: 1.5, a: 0.01, peak: 0.4, d: 0.2 });
        this._tone(g, t + 0.1, { f0: 400, f1: 520, a: 0.02, peak: 0.2, d: 0.3, type: 'triangle' });
        break;
      default:
        this._tone(g, t, { f0: 1000, f1: 1000, a: 0.005, peak: 0.2, d: 0.1 });
    }
  }
  // ------------------------------------------------------------ fortificación
  // Metal resonante: parciales inarmónicos con caída exponencial (placa de acero).
  _metalRing(dest, t, base, dur, peak) {
    const ratios = [1, 1.83, 2.95, 4.34, 5.98, 7.9];
    ratios.forEach((r, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * r * (1 + (Math.random() - 0.5) * 0.01);
      const g = this.ctx.createGain();
      const p = peak / (1 + i * 0.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + i * 0.45));
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }
  /**
   * Refuerzo de Siege en tres tiempos: 'place' (la placa golpea la pared),
   * 'hydraulic' (siseo y servo de los pistones) y 'lock' (el golpe metálico final).
   */
  reinforce(pos, stage, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 1.0, ref: 3, rolloff: 0.9, occl: scaleOccl(occl, 0.6), reverb: 0.45 });
    if (stage === 'place') {
      this._tone(out, t, { f0: 95, f1: 55, a: 0.003, peak: 0.9, d: 0.35 });
      this._burst(out, t, { type: 'lowpass', freq: 500, q: 0.8, a: 0.002, peak: 0.6, d: 0.12 });
      this._metalRing(out, t + 0.005, 230, 0.9, 0.22);
      this._burst(out, t + 0.12, { type: 'bandpass', freq: 3200, q: 1.5, a: 0.02, peak: 0.12, d: 0.35 });
    } else if (stage === 'hydraulic') {
      // siseo que sube
      const n = this._noiseSrc(false);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 1.3);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      n.connect(bp).connect(g).connect(out); n.start(t); n.stop(t + 1.6);
      // servo
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(150, t); o.frequency.linearRampToValueAtTime(260, t + 1.2);
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const og = this.ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.1, t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(lp).connect(og).connect(out); o.start(t); o.stop(t + 1.4);
      // trinquetes
      for (let i = 0; i < 5; i++) this._burst(out, t + 0.15 + i * 0.22, { type: 'bandpass', freq: 2400, q: 4, a: 0.001, peak: 0.25, d: 0.025 });
    } else if (stage === 'lock') {
      // KA-CHUNK: dos golpes y el acero vibrando
      this._tone(out, t, { f0: 80, f1: 38, a: 0.002, peak: 1.0, d: 0.45 });
      this._burst(out, t, { type: 'lowpass', freq: 700, q: 0.7, a: 0.001, peak: 0.9, d: 0.1 });
      this._metalRing(out, t + 0.003, 205, 1.6, 0.3);
      this._tone(out, t + 0.07, { f0: 70, f1: 34, a: 0.002, peak: 0.8, d: 0.5 });
      this._metalRing(out, t + 0.072, 145, 2.2, 0.28);
      this._burst(out, t + 0.07, { type: 'bandpass', freq: 1800, q: 2, a: 0.001, peak: 0.35, d: 0.06 });
    }
  }
  // Barricada: martillazos sobre madera.
  barricade(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.8, ref: 2.5, rolloff: 1.1, occl, reverb: 0.3 });
    for (let i = 0; i < 3; i++) {
      const k = t + i * 0.36;
      this._tone(out, k, { f0: 190, f1: 120, a: 0.001, peak: 0.6, d: 0.1, type: 'triangle' });
      this._burst(out, k, { type: 'bandpass', freq: 900 + i * 80, q: 2.2, a: 0.001, peak: 0.55, d: 0.07 });
    }
    this._burst(out, t + 1.1, { type: 'bandpass', freq: 650, q: 1, a: 0.01, peak: 0.3, d: 0.25 });
  }
  // Cuerpo a cuerpo: zarpazo de aire (el impacto lo pone quien recibe el golpe).
  meleeSwing(pos, local = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = local ? (() => { const g = this.ctx.createGain(); g.gain.value = 0.4; g.connect(this.sfx); return g; })() : this._out(pos, { gain: 0.5, ref: 2, rolloff: 1.3 });
    const n = this._noiseSrc(false);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(g).connect(out); n.start(t); n.stop(t + 0.2);
  }
  // Motor de dron: bucle por dron que se actualiza cada fotograma (volumen según velocidad).
  droneLoop(id, pos, speed, occl = 0, local = false) {
    if (!this.ctx) return;
    if (occl && typeof occl === 'object') { pos = occl; occl = occl.occl; }
    this._drones = this._drones || new Map();
    let d = this._drones.get(id);
    const ctx = this.ctx, t = ctx.currentTime;
    if (!d) {
      const out = ctx.createGain();
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 90;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const n = this._noiseSrc(false); n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 3;
      const ng = ctx.createGain(); ng.gain.value = 0.15;
      o.connect(lp).connect(out); n.connect(bp).connect(ng).connect(out);
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 1.6;
      const direct = ctx.createGain(), spatial = ctx.createGain();
      out.connect(spatial).connect(p).connect(this.sfx);
      out.connect(direct).connect(this.sfx);
      out.gain.value = 0; direct.gain.value = 0;
      o.start(); n.start();
      d = { out, o, n, p, direct, spatial, lp };
      this._drones.set(id, d);
    }
    d.seen = t;
    const k = Math.min(1, speed / 3.5);
    d.o.frequency.setTargetAtTime(80 + k * 70, t, 0.08);
    d.lp.frequency.setTargetAtTime((500 + k * 900) * (1 - occl * 0.6), t, 0.08);
    d.out.gain.setTargetAtTime((0.02 + k * 0.16) * (1 - occl * 0.6), t, 0.08);
    if (d.p.positionX) { d.p.positionX.setValueAtTime(pos.x, t); d.p.positionY.setValueAtTime(pos.y, t); d.p.positionZ.setValueAtTime(pos.z, t); }
    else d.p.setPosition(pos.x, pos.y, pos.z);
    // el dron propio (el que se pilota) suena directo y bajo
    d.direct.gain.setTargetAtTime(local ? 0.45 : 0, t, 0.05);
    d.spatial.gain.setTargetAtTime(local ? 0 : 1, t, 0.05);
  }
  // Apaga los motores que no se han actualizado en este fotograma.
  droneSweep() {
    if (!this._drones) return;
    const t = this.ctx.currentTime;
    for (const [id, d] of this._drones) {
      if (t - d.seen < 0.2) continue;
      d.out.gain.setTargetAtTime(0, t, 0.05);
      d.o.stop(t + 0.3); d.n.stop(t + 0.3);
      this._drones.delete(id);
    }
  }
  // Marca, objetivo localizado, estática al cambiar de cámara, aparato destruido.
  ping(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.22; g.connect(this.dry);
    if (kind === 'mark') {
      this._tone(g, t, { f0: 1760, f1: 1750, a: 0.002, peak: 0.4, d: 0.06, type: 'square' });
      this._tone(g, t + 0.08, { f0: 2350, f1: 2340, a: 0.002, peak: 0.35, d: 0.09, type: 'square' });
    } else if (kind === 'ping') {
      this._tone(g, t, { f0: 1320, f1: 1310, a: 0.004, peak: 0.3, d: 0.08, type: 'triangle' });
      this._tone(g, t + 0.07, { f0: 1760, f1: 1750, a: 0.004, peak: 0.28, d: 0.12, type: 'triangle' });
    } else if (kind === 'objective') {
      this._tone(g, t, { f0: 880, f1: 880, a: 0.01, peak: 0.35, d: 0.15, type: 'triangle' });
      this._tone(g, t + 0.14, { f0: 1320, f1: 1320, a: 0.01, peak: 0.35, d: 0.3, type: 'triangle' });
    } else if (kind === 'static') {
      this._burst(g, t, { type: 'highpass', freq: 1200, q: 0.5, a: 0.002, peak: 0.6, d: 0.14 });
    } else if (kind === 'deny') {
      this._tone(g, t, { f0: 220, f1: 200, a: 0.005, peak: 0.35, d: 0.12, type: 'square' });
    }
  }
  electronicPop(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.7, ref: 2, rolloff: 1.2, occl, reverb: 0.2 });
    this._burst(out, t, { type: 'highpass', freq: 2500, q: 0.7, a: 0.001, peak: 0.7, d: 0.09 });
    this._tone(out, t, { f0: 900, f1: 90, a: 0.001, peak: 0.4, d: 0.15, type: 'square' });
    for (let i = 0; i < 4; i++) this._burst(out, t + 0.05 + Math.random() * 0.25, { type: 'bandpass', freq: 3000 + Math.random() * 3000, q: 3, a: 0.001, peak: 0.25, d: 0.02 });
  }

  // ------------------------------------------------------------ gadgets
  // Explosión: golpe grave, crujido de metralla y cola larga. size 1 = granada.
  explosion(pos, size = 1, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 2.2 * size, ref: 4, rolloff: 0.9, occl, reverb: 0.8 });
    this._tone(out, t, { f0: 140, f1: 32, a: 0.002, peak: 1.4, d: 0.9 });
    this._burst(out, t, { type: 'lowpass', freq: 900, q: 0.6, a: 0.002, peak: 1.3, d: 0.8, pink: true });
    this._burst(out, t, { type: 'bandpass', freq: 2600, q: 0.8, a: 0.0008, peak: 0.9, d: 0.12 });
    for (let i = 0; i < 6; i++) this._burst(out, t + 0.05 + Math.random() * 0.5, { type: 'bandpass', freq: 1500 + Math.random() * 3500, q: 3, a: 0.001, peak: 0.25, d: 0.04 });
  }
  // Cegadora: estallido seco y agudo.
  flashbang(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 2.4, ref: 4, rolloff: 0.9, occl, reverb: 0.7 });
    this._burst(out, t, { type: 'highpass', freq: 1800, q: 0.6, a: 0.0005, peak: 1.6, d: 0.18 });
    this._tone(out, t, { f0: 220, f1: 60, a: 0.001, peak: 0.9, d: 0.35 });
  }
  // Pitido en los oídos tras una cegadora (strength 0..1).
  ringing(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.12 * strength; g.connect(this.dry);
    this._tone(g, t, { f0: 3900, f1: 3850, a: 0.05, peak: 0.6, d: 2.8 * strength + 0.4, type: 'sine' });
  }
  // Roce metálico del alambre de púas.
  // Rappel (F10.2a): el mosquetón al engancharse ('hook') y la cuerda al bajar deprisa ('slide').
  rappel(kind, pos, local = false, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.5 : 0.8, ref: 2, rolloff: 1.3, occl, reverb: 0.25, direct: local });
    if (kind === 'hook') {
      this._tone(out, t, { f0: 2400, f1: 2300, a: 0.001, peak: 0.25, d: 0.08, type: 'triangle' });
      this._burst(out, t + 0.01, { type: 'bandpass', freq: 3200, q: 6, a: 0.0005, peak: 0.5, d: 0.02 });
      this._burst(out, t + 0.05, { type: 'lowpass', freq: 900, q: 0.7, a: 0.02, peak: 0.25, d: 0.25, pink: true });
    } else if (kind === 'slide') {
      this._burst(out, t, { type: 'bandpass', freq: 1300, q: 1.5, a: 0.03, peak: 0.28, d: 0.4, pink: true });
    }
  }
  wireRustle(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.7, ref: 2, rolloff: 1.3, occl, reverb: 0.2 });
    for (let i = 0; i < 4; i++) this._burst(out, t + i * 0.05 + Math.random() * 0.03, { type: 'bandpass', freq: 3500 + Math.random() * 2500, q: 4, a: 0.002, peak: 0.35, d: 0.05 });
  }
  // Alarma de proximidad: tres pitidos agudos.
  alarm(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 1.3, ref: 4, rolloff: 0.9, occl, reverb: 0.4 });
    for (let i = 0; i < 3; i++) this._tone(out, t + i * 0.22, { f0: 2400, f1: 2380, a: 0.005, peak: 0.6, d: 0.14, type: 'square' });
  }
  // Rebote de una bala en algo blindado.
  ricochet(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.6, ref: 2, rolloff: 1.3, occl, reverb: 0.2 });
    this._tone(out, t, { f0: 4200, f1: 1800, a: 0.001, peak: 0.3, d: 0.18, type: 'triangle' });
  }
  // Siseo del humo al abrirse.
  smokeHiss(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.8, ref: 2, rolloff: 1.2, occl, reverb: 0.3 });
    this._burst(out, t, { type: 'highpass', freq: 3000, q: 0.5, a: 0.05, peak: 0.6, d: 2.5 });
  }
  // Lanzamiento (silbido corto) y golpe metálico de la granada al rebotar.
  throwWhoosh(pos, local = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.35 : 0.5, ref: 2, rolloff: 1.4, reverb: 0.1, direct: local });
    this._burst(out, t, { type: 'bandpass', freq: 900, q: 1.2, a: 0.02, peak: 0.5, d: 0.16 });
  }
  grenadeClink(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.6, ref: 1.5, rolloff: 1.4, occl, reverb: 0.25 });
    this._tone(out, t, { f0: 2600, f1: 2400, a: 0.0005, peak: 0.35, d: 0.12, type: 'triangle' });
    this._burst(out, t, { type: 'bandpass', freq: 1800, q: 2, a: 0.0005, peak: 0.5, d: 0.04 });
  }

  // ------------------------------------------------------------ habilidades
  // Disparo del lanzador (proyectil de brecha, humo remoto): golpe hueco.
  launcher(pos, local = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.9 : 1.1, ref: 3, rolloff: 1.1, reverb: 0.35, direct: local });
    this._tone(out, t, { f0: 190, f1: 60, a: 0.002, peak: 1.0, d: 0.22 });
    this._burst(out, t, { type: 'bandpass', freq: 700, q: 0.9, a: 0.001, peak: 0.8, d: 0.12, pink: true });
  }
  // Carga térmica ardiendo: siseo fuerte con chasquidos durante `secs` segundos.
  thermalBurn(pos, secs = 5, occl = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, { gain: 1.2, ref: 3, rolloff: 1.0, occl, reverb: 0.4 });
    const src = this._noiseSrc(false, 1); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.25);
    g.gain.setValueAtTime(0.7, t + secs - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + secs + 0.05);
    for (let i = 0; i < secs * 9; i++) this._burst(out, t + 0.2 + Math.random() * (secs - 0.3), { type: 'bandpass', freq: 1200 + Math.random() * 3000, q: 2.5, a: 0.001, peak: 0.35, d: 0.03 });
  }
  // Pulso de escaneo: aviso para todos (no posicional), sirena que sube durante `secs` s.
  scanWarn(secs = 2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.22; g.connect(this.dry);
    for (let i = 0; i < 4; i++) this._tone(g, t + i * secs / 4, { f0: 520 + i * 90, f1: 1150 + i * 120, a: 0.02, peak: 0.45, d: secs / 4 - 0.06, type: 'triangle' });
  }
  // Barrido del pulso al activarse.
  scanSweep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.2; g.connect(this.dry);
    this._tone(g, t, { f0: 1800, f1: 300, a: 0.01, peak: 0.5, d: 0.7, type: 'sine' });
    this._burst(g, t, { type: 'bandpass', freq: 2400, q: 2, a: 0.01, peak: 0.3, d: 0.5 });
  }

  // Destello del escudo: carga (silbido que sube) antes de disparar.
  shieldCharge(pos, local = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.5 : 0.8, ref: 2.5, rolloff: 1.1, reverb: 0.2, direct: local });
    this._tone(out, t, { f0: 900, f1: 3800, a: 0.02, peak: 0.35, d: 0.38, type: 'triangle' });
  }

  // Rayo del dron de choque: descarga eléctrica corta.
  zap(pos, local = false, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(local ? null : pos, { gain: local ? 0.8 : 1.0, ref: 2, rolloff: 1.2, occl, reverb: 0.25, direct: local });
    this._tone(out, t, { f0: 2400, f1: 300, a: 0.001, peak: 0.45, d: 0.22, type: 'sawtooth' });
    this._burst(out, t, { type: 'highpass', freq: 3000, q: 0.7, a: 0.001, peak: 0.7, d: 0.16 });
    for (let i = 0; i < 5; i++) this._burst(out, t + Math.random() * 0.18, { type: 'bandpass', freq: 3500 + Math.random() * 3500, q: 4, a: 0.001, peak: 0.3, d: 0.02 });
  }

  // Granada PEM: chasquido eléctrico con zumbido que se apaga.
  empBurst(pos, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 1.4, ref: 4, rolloff: 0.9, occl, reverb: 0.5 });
    this._tone(out, t, { f0: 1400, f1: 60, a: 0.001, peak: 0.7, d: 0.6, type: 'square' });
    this._tone(out, t, { f0: 120, f1: 110, a: 0.01, peak: 0.5, d: 0.9, type: 'sawtooth' });
    this._burst(out, t, { type: 'highpass', freq: 2200, q: 0.6, a: 0.001, peak: 1.0, d: 0.25 });
    for (let i = 0; i < 8; i++) this._burst(out, t + 0.05 + Math.random() * 0.6, { type: 'bandpass', freq: 2500 + Math.random() * 4000, q: 4, a: 0.001, peak: 0.3, d: 0.02 });
  }

  // Pitido del desactivador plantado (posicional; se acelera al final).
  defuserBeep(pos, urgency = 0, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.5, ref: 3, rolloff: 1.0, occl, reverb: 0.25 });
    this._tone(out, t, { f0: 2100 + urgency * 500, f1: 2080 + urgency * 500, a: 0.002, peak: 0.6, d: 0.07, type: 'square' });
  }

  // ------------------------------------------------------------ ambiente y música (Fase 9)
  /**
   * Ambiente de fondo, cada fotograma: viento según el cielo que hay encima (0..1) y zumbido
   * eléctrico según lo dentro que se está (0..1). Sin sonido 3D: rodea al que escucha.
   */
  ambience(sky, indoor) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this._amb) {
      const out = ctx.createGain(); out.gain.value = 1; out.connect(this.dry);
      // viento: ruido rosa por un paso banda que se mueve despacio, con rachas
      const wind = this._noiseSrc(true, 0.5); wind.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.7;
      const wg = ctx.createGain(); wg.gain.value = 0;
      const gust = ctx.createGain(); gust.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.45;
      lfo.connect(lfoAmt).connect(gust.gain);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07;
      const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = 160;
      lfo2.connect(lfo2Amt).connect(bp.frequency);
      wind.connect(bp).connect(gust).connect(wg).connect(out);
      // zumbido eléctrico: 100 Hz y armónicos (red de 50 Hz), muy bajo
      const hg = ctx.createGain(); hg.gain.value = 0;
      const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 900;
      const hums = [[100, 0.6], [200, 0.25], [50, 0.2], [300, 0.08]].map(([f, a]) => {
        const o = ctx.createOscillator(); o.type = f === 100 ? 'sawtooth' : 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = a; o.connect(g).connect(hlp); o.start(); return o;
      });
      hlp.connect(hg).connect(out);
      wind.start(); lfo.start(); lfo2.start();
      this._amb = { wg, hg, nodes: [wind, lfo, lfo2, ...hums] };
    }
    this.ambLevel = { wind: 0.05 * sky * sky, hum: 0.012 * indoor };
    this._amb.wg.gain.setTargetAtTime(this.ambLevel.wind, t, 0.6);
    this._amb.hg.gain.setTargetAtTime(this.ambLevel.hum, t, 0.6);
  }

  /**
   * La música (F12.3, music.js), cada fotograma: el modo ('menu', 'prep', 'tension', 'planted'
   * o '' para el silencio) y k (0…1: lo avanzados que van los últimos 30 s o el desactivador).
   */
  music(mode, k = 0) {
    if (!this.ctx) return;
    if (!this._music) this._music = new Music(this, this.musicOut);
    this._music.update(mode || '', k);
  }
  /** Con el desactivador plantado: acaba de pitar y el siguiente pitido llega en `period` s. */
  musicBeat(period) { if (this._music) this._music.beat(period); }
  /** Remate musical: 'contact', 'win', 'lose', 'matchWin' o 'matchLose'. */
  stinger(kind) {
    if (!this.ctx) return;
    if (!this._music) this._music = new Music(this, this.musicOut);
    this._music.stinger(kind);
  }
}

export { SND };

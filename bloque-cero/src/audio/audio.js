// Motor de audio sintetizado con Web Audio: sin archivos. Disparos por capas
// (chasquido, cuerpo, golpe grave, mecánica, cola de reverberación), impactos,
// roturas por material, pasos, recargas y casquillos. Sonido 3D con HRTF.
// (La Fase 9 añade oclusión por vóxeles y reverberación por sala.)

const SND = { none: 0, grass: 1, dirt: 2, concrete: 3, wood: 4, metal: 5, glass: 6, carpet: 7, tile: 8, plaster: 9, fabric: 10, gravel: 11, brick: 12 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
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
    // buses
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.reverbRoom = ctx.createConvolver(); this.reverbRoom.buffer = this._impulse(0.9, 3.2, 0.5);
    this.reverbOut = ctx.createConvolver(); this.reverbOut.buffer = this._impulse(2.2, 2.0, 0.25, true);
    this.revRoomGain = ctx.createGain(); this.revRoomGain.gain.value = 0.0;
    this.revOutGain = ctx.createGain(); this.revOutGain.gain.value = 0.35;
    this.revSend = ctx.createGain(); this.revSend.gain.value = 1;
    this.revSend.connect(this.reverbRoom).connect(this.revRoomGain).connect(this.master);
    this.revSend.connect(this.reverbOut).connect(this.revOutGain).connect(this.master);
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

  // Nodo de salida: posicional (HRTF) o directo. opts.occl 0..1 atenúa y filtra.
  _out(pos, { gain = 1, ref = 2, rolloff = 1.2, occl = 0, reverb = 0.3, direct = false } = {}) {
    const ctx = this.ctx;
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
      p.connect(this.sfx);
      if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; p.connect(s).connect(this.revSend); }
    } else {
      head.connect(this.sfx);
      if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; head.connect(s).connect(this.revSend); }
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
  gunshot(kind, pos, local = false, occl = 0) {
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
    const out = this._out(local ? null : pos, { gain: local ? 0.9 : 1.6, ref: 3, rolloff: 1.0, occl, reverb: local ? 0.55 : 0.6, direct: local });
    const bus = ctx.createGain(); bus.connect(this.shaper); bus.connect(out);
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
  // Confirmación para quien dispara (seca, sin posicionar).
  hitConfirm(kind = 'hit') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.35; g.connect(this.sfx);
    if (kind === 'head') {
      this._tone(g, t, { f0: 2900, f1: 2700, a: 0.001, peak: 0.5, d: 0.12, type: 'triangle' });
      this._burst(g, t, { type: 'highpass', freq: 5000, q: 0.7, a: 0.0005, peak: 0.4, d: 0.03 });
    } else if (kind === 'kill') {
      this._tone(g, t, { f0: 1500, f1: 1400, a: 0.001, peak: 0.35, d: 0.09, type: 'triangle' });
      this._tone(g, t + 0.06, { f0: 1100, f1: 1000, a: 0.001, peak: 0.3, d: 0.12, type: 'triangle' });
    } else {
      this._burst(g, t, { type: 'bandpass', freq: 2400, q: 3, a: 0.0005, peak: 0.45, d: 0.025 });
    }
  }
  // Recibir daño: golpe grave y pitido si es fuerte.
  hurt(amount) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.value = 0.5; g.connect(this.sfx);
    this._tone(g, t, { f0: 140, f1: 60, a: 0.002, peak: Math.min(1, amount / 40), d: 0.18 });
    this._burst(g, t, { type: 'lowpass', freq: 600, q: 0.8, a: 0.002, peak: 0.5, d: 0.1 });
    if (amount > 35) this._tone(g, t + 0.02, { f0: 3800, f1: 3700, a: 0.05, peak: 0.07, d: 1.4 });
  }
  // Derribado: latido y respiración en bucle mientras dure.
  startDowned() {
    if (!this.ctx || this._downed) return;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this.master);
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
    this.sfx.gain.setTargetAtTime(0.45, ctx.currentTime, 0.2);
  }
  stopDowned() {
    if (!this._downed) return;
    clearTimeout(this._downed.timer);
    this._downed.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this._downed = null;
    this.sfx.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
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
    const g = this.ctx.createGain(); g.gain.value = 0.15; g.connect(this.master);
    if (kind === 'click') this._tone(g, t, { f0: 1800, f1: 1400, a: 0.001, peak: 0.4, d: 0.04, type: 'triangle' });
    else if (kind === 'hover') this._tone(g, t, { f0: 2400, f1: 2300, a: 0.001, peak: 0.12, d: 0.025, type: 'sine' });
    else this._tone(g, t, { f0: 600, f1: 900, a: 0.01, peak: 0.3, d: 0.15, type: 'sine' });
  }

  // ------------------------------------------------------------ avisos de la partida
  // Señales de ronda (no posicionales): preparación, acción, cuenta atrás, victoria…
  cue(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0.32; g.connect(this.master);
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
      case 'win':
        chord([220, 277.2, 329.6], 0, 0.9, 0.45);
        chord([246.9, 311.1, 370], 0.45, 1.6, 0.5);
        break;
      case 'lose':
        chord([196, 233.1, 293.7], 0, 0.9, 0.45);
        chord([174.6, 207.7, 261.6], 0.45, 1.8, 0.5);
        break;
      case 'matchWin':
        chord([220, 277.2, 329.6], 0, 0.6, 0.4);
        chord([246.9, 311.1, 370], 0.35, 0.6, 0.4);
        chord([293.7, 370, 440], 0.7, 2.4, 0.55);
        break;
      case 'matchLose':
        chord([220, 261.6, 329.6], 0, 0.8, 0.4);
        chord([174.6, 207.7, 261.6], 0.5, 2.6, 0.5);
        break;
      case 'plantStart':
        this._burst(g, t, { type: 'bandpass', freq: 900, q: 1.5, a: 0.01, peak: 0.4, d: 0.2 });
        this._tone(g, t + 0.1, { f0: 400, f1: 520, a: 0.02, peak: 0.2, d: 0.3, type: 'triangle' });
        break;
      default:
        this._tone(g, t, { f0: 1000, f1: 1000, a: 0.005, peak: 0.2, d: 0.1 });
    }
  }
  // Pitido del desactivador plantado (posicional; se acelera al final).
  defuserBeep(pos, urgency = 0, occl = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, { gain: 0.5, ref: 3, rolloff: 1.0, occl, reverb: 0.25 });
    this._tone(out, t, { f0: 2100 + urgency * 500, f1: 2080 + urgency * 500, a: 0.002, peak: 0.6, d: 0.07, type: 'square' });
  }
}

export { SND };

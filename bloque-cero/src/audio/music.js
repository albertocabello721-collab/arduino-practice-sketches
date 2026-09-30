// Música (F12.3): un tema propio de cuatro notas, La–Do–Mi–Re, que suena en todo.
//  · menús y selección: el tema lento, una nota cada dos tiempos, sobre el colchón grave de la F9;
//  · preparación: percusión suave (tom grave, maraca a contratiempo) con el tema en el bajo;
//  · acción: silencio, y un golpe al primer contacto (el arranque del tema sobre un impacto grave);
//  · últimos 30 s: tensión, el tema en arpegio con un pulso en cada tiempo, cada vez más deprisa;
//  · desactivador plantado: cada pitido es un pulso con una nota del tema (va a su paso y acelera
//    con él);
//  · fin de ronda: 3 s de victoria (el tema en mayor, subiendo) o de derrota (en menor, grave).
// Todo sintetizado y programado un poco por delante con el reloj del audio. Sale por su propio bus
// (el volumen de música de Opciones).

export const MOTIF = [220, 261.63, 329.63, 293.66];         // La3 Do4 Mi4 Re4
export const MOTIF_MAJOR = [220, 277.18, 329.63, 293.66];   // en mayor (victoria): Do sostenido

// Cada modo: tempo (y cuánto sube con k), volumen, cuánto suena el colchón y lo rápido que entra.
export const MUSIC = {
  menu: { bpm: 84, gain: 0.4, pad: 0.05, fadeIn: 0.8 },
  prep: { bpm: 90, gain: 0.5, pad: 0, fadeIn: 0.3 },
  tension: { bpm: 112, bpmUp: 38, gain: 0.55, pad: 0.02, fadeIn: 0.4 },
  planted: { gain: 0.55, pad: 0.03, padUp: 0.015, fadeIn: 0.2 },   // sin tempo: lo marca el pitido
};
// Lo que dura cada remate (s, hasta que se apaga).
export const STINGER = { contact: 1.6, win: 3, lose: 3, matchWin: 4.5, matchLose: 4.5 };

export class Music {
  constructor(engine, out) {
    const ctx = engine.ctx;
    this.a = engine;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.connect(out);
    // un bus por modo, para fundir de uno a otro
    this.layers = {};
    for (const m of Object.keys(MUSIC)) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.bus); this.layers[m] = g; }
    // los remates (a la altura de un disparo cercano, no más), con un eco suave para que tengan cola
    this.stings = ctx.createGain(); this.stings.gain.value = 0.35;
    this.stings.connect(this.bus);
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2000;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    this.stings.connect(dl); dl.connect(damp); damp.connect(fb).connect(dl); damp.connect(wet).connect(this.bus);
    // colchón (el de la F9): La y Mi graves, desafinados, con el filtro abriéndose despacio
    this.padLp = ctx.createBiquadFilter(); this.padLp.type = 'lowpass'; this.padLp.frequency.value = 380; this.padLp.Q.value = 2;
    this.pad = ctx.createGain(); this.pad.gain.value = 0;
    this.oscs = [55, 55.4, 82.41, 110.2].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(this.padLp); o.start(); return o; });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const la = ctx.createGain(); la.gain.value = 180;
    lfo.connect(la).connect(this.padLp.frequency); lfo.start();
    this.oscs.push(lfo);
    this.padLp.connect(this.pad).connect(this.bus);
    this.padLevel = 0; this.cut = 380;
    this.mode = ''; this.k = 0;
    this.next = 0; this.step = 0; this.beats = 0;
    this.log = [];        // notas del tema que han sonado: {t, f, tag} (pruebas)
    this.tag = '';
  }

  /** Cada fotograma: qué modo toca ('menu' | 'prep' | 'tension' | 'planted' | '') y k (0…1). */
  update(mode, k = 0) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (!MUSIC[mode]) mode = '';
    if (mode !== this.mode) {
      if (this.mode) { const g = this.layers[this.mode].gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, 0.3); }
      if (mode) { const g = this.layers[mode].gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(MUSIC[mode].gain, t, MUSIC[mode].fadeIn); }
      this.mode = mode; this.next = t + 0.05; this.step = 0; this.beats = 0;
    }
    this.k = Math.max(0, Math.min(1, k || 0));
    const M = MUSIC[mode];
    const pad = M ? M.pad + (M.padUp || 0) * this.k : 0;
    if (Math.abs(pad - this.padLevel) > 1e-3) { this.pad.gain.setTargetAtTime(pad, t, 0.8); this.padLevel = pad; }
    const cut = 380 + (mode === 'planted' ? 900 * this.k : 0);
    if (Math.abs(cut - this.cut) > 5) { this.padLp.frequency.setTargetAtTime(cut, t, 0.5); this.cut = cut; }
    if (!M || !M.bpm) return;
    // semicorcheas hasta 0,25 s por delante (si el reloj se quedó atrás, p. ej. con la pestaña
    // oculta, se retoma desde ahora: sin avalancha de notas)
    const dt16 = 60 / (M.bpm + (M.bpmUp || 0) * this.k) / 4;
    if (this.next < t - 0.1) this.next = t + 0.02;
    while (this.next < t + 0.25) {
      this._step(mode, this.step, this.next);
      this.step++;
      this.next += dt16;
    }
  }

  _step(mode, s, at) {
    const a = this.a, L = this.layers[mode], b = s % 16, bar = Math.floor(s / 16);
    this.tag = mode;
    if (mode === 'menu') {
      // pulso grave cada compás y el tema, una nota cada dos tiempos: una vuelta grave, otra aguda
      if (b === 0) a._tone(L, at, { f0: 72, f1: 42, a: 0.004, peak: 0.22, d: 0.28 });
      if (b % 8 === 0) {
        const n = s / 8, up = Math.floor(n / 4) % 2;
        this._note(L, at, MOTIF[n % 4] * (up ? 2 : 1), { peak: up ? 0.05 : 0.07, d: 0.9 });
      }
    } else if (mode === 'prep') {
      // tom grave en el 1 y el 3 (y uno más agudo cada dos compases), maraca a corcheas (más fuerte
      // a contratiempo) y el tema en el bajo, una nota por compás
      if (b === 0 || b === 8) a._tone(L, at, { f0: 150, f1: 72, a: 0.003, peak: 0.3, d: 0.26 });
      if (b === 12 && bar % 2 === 1) a._tone(L, at, { f0: 230, f1: 150, a: 0.002, peak: 0.14, d: 0.16 });
      if (b % 2 === 0) a._burst(L, at, { type: 'highpass', freq: 6500, q: 0.7, a: 0.004, peak: b % 4 === 2 ? 0.055 : 0.025, d: 0.05 });
      if (b === 0) this._note(L, at, MOTIF[bar % 4], { peak: 0.09, d: 1.8 });
    } else if (mode === 'tension') {
      // pulso en cada tiempo, tictac a contratiempo (y a semicorcheas en la segunda mitad) y el
      // tema en arpegio de semicorcheas, una vuelta grave y otra una octava arriba
      if (b % 4 === 0) a._tone(L, at, { f0: 72, f1: 42, a: 0.004, peak: 0.32, d: 0.28 });
      if (b % 4 === 2) a._burst(L, at, { type: 'highpass', freq: 7000, q: 0.7, a: 0.001, peak: 0.05, d: 0.03 });
      else if (this.k > 0.5 && b % 2 === 1) a._burst(L, at, { type: 'highpass', freq: 7500, q: 0.7, a: 0.001, peak: 0.025, d: 0.02 });
      this._note(L, at, MOTIF[b % 4] * (b % 8 < 4 ? 1 : 2), { peak: 0.05, d: 0.11, type: 'square', a: 0.004 });
    }
  }

  /**
   * Desactivador plantado: un pitido acaba de sonar y el siguiente llega en `period` s. La música
   * da un pulso con él y la nota siguiente del tema (con medio tiempo de tictac si hay sitio).
   */
  beat(period) {
    if (this.mode !== 'planted') return;
    const a = this.a, L = this.layers.planted, k = this.k, t = this.ctx.currentTime + 0.005;
    this.tag = 'planted';
    a._tone(L, t, { f0: 72, f1: 40, a: 0.004, peak: 0.32 + 0.14 * k, d: Math.min(0.3, 0.7 * period) });
    this._note(L, t, MOTIF[this.beats % 4] * (k > 0.5 ? 2 : 1), { peak: 0.055 + 0.03 * k, d: Math.min(0.45, 0.8 * period), type: 'sawtooth', lp: 1400 + 1600 * k });
    if (period >= 0.45) a._burst(L, t + period / 2, { type: 'highpass', freq: 7000, q: 0.7, a: 0.001, peak: 0.04, d: 0.03 });
    this.beats++;
  }

  /** Remates: 'contact' (primer contacto), 'win' / 'lose' (ronda, 3 s), 'matchWin' / 'matchLose'. */
  stinger(kind) {
    const a = this.a, S = this.stings, t = this.ctx.currentTime + 0.01;
    this.tag = kind;
    switch (kind) {
      case 'contact':
        // impacto grave y el arranque del tema: La, y Do–Mi encima
        a._tone(S, t, { f0: 110, f1: 30, a: 0.003, peak: 1.0, d: 1.2 });
        a._burst(S, t, { type: 'lowpass', freq: 420, q: 0.7, a: 0.003, peak: 0.55, d: 0.45, pink: true });
        this._chord(S, t, [110, 220], 0.16, 0.5, { lp: 1800 });
        this._chord(S, t + 0.17, [130.81, 261.63, 329.63], 1.0, 0.55, { lp: 2400, lpEnd: 450 });
        break;
      case 'win':
        // el tema en mayor una octava arriba, subdominante y tónica (La mayor) con un timbal
        MOTIF_MAJOR.forEach((f, i) => this._note(S, t + i * 0.13, f * 2, { peak: 0.09, d: 0.3, type: 'sawtooth', lp: 3200, a: 0.005 }));
        this._chord(S, t + 0.56, [293.66, 369.99, 440], 0.45, 0.5, { lp: 2600 });
        this._chord(S, t + 0.98, [220, 329.63, 440, 554.37, 659.26], 1.45, 0.6, { lp: 3000, lpEnd: 1400 });
        a._tone(S, t + 0.98, { f0: 112, f1: 104, a: 0.004, peak: 0.55, d: 1.1 });
        break;
      case 'lose':
        // el tema en menor, despacio y grave; Re menor y La menor apagándose
        MOTIF.forEach((f, i) => this._note(S, t + i * 0.24, f, { peak: 0.09, d: 0.5, lp: 1200 }));
        this._chord(S, t + 0.98, [146.83, 174.61, 220], 0.6, 0.5, { lp: 900 });
        this._chord(S, t + 1.5, [110, 164.81, 220, 261.63], 1.1, 0.55, { lp: 800, lpEnd: 300 });
        a._tone(S, t + 1.5, { f0: 70, f1: 38, a: 0.01, peak: 0.5, d: 1.1 });
        break;
      case 'matchWin':
        // el tema en mayor dos veces (la segunda una cuarta arriba), dominante y tónica larga
        MOTIF_MAJOR.forEach((f, i) => this._note(S, t + i * 0.13, f * 2, { peak: 0.09, d: 0.3, type: 'sawtooth', lp: 3200, a: 0.005 }));
        MOTIF_MAJOR.forEach((f, i) => this._note(S, t + 0.52 + i * 0.13, f * 8 / 3, { peak: 0.08, d: 0.3, type: 'sawtooth', lp: 3600, a: 0.005 }));
        this._chord(S, t + 1.1, [329.63, 415.3, 493.88], 0.5, 0.5, { lp: 2600 });
        this._chord(S, t + 1.6, [110, 220, 329.63, 440, 554.37, 659.26], 2.0, 0.65, { lp: 3200, lpEnd: 1200 });
        a._tone(S, t + 1.6, { f0: 112, f1: 104, a: 0.004, peak: 0.6, d: 1.4 });
        break;
      case 'matchLose':
        // el tema muy despacio, Re menor, Fa mayor y La menor grave que se apaga
        MOTIF.forEach((f, i) => this._note(S, t + i * 0.32, f, { peak: 0.09, d: 0.6, lp: 1100 }));
        this._chord(S, t + 1.3, [146.83, 174.61, 220], 0.8, 0.5, { lp: 900 });
        this._chord(S, t + 2.0, [174.61, 220, 261.63], 0.6, 0.45, { lp: 850 });
        this._chord(S, t + 2.6, [110, 164.81, 220, 261.63], 1.4, 0.55, { lp: 750, lpEnd: 250 });
        a._tone(S, t + 2.6, { f0: 70, f1: 36, a: 0.01, peak: 0.55, d: 1.4 });
        break;
      default:
        break;
    }
  }

  // Una nota: oscilador (con paso bajo si se pide) y envolvente de golpe y caída.
  _note(dest, t, f, { peak = 0.06, d = 0.5, type = 'triangle', lp = 0, a = 0.006 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let head = o;
    if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; fl.Q.value = 0.7; o.connect(fl); head = fl; }
    head.connect(g).connect(dest);
    o.start(t); o.stop(t + a + d + 0.05);
    this.log.push({ t, f, tag: this.tag });
    if (this.log.length > 256) this.log.splice(0, this.log.length - 256);
  }
  // Un acorde de dientes de sierra por un paso bajo (que puede irse cerrando); `dur` hasta que empieza
  // a apagarse del todo.
  _chord(dest, t, freqs, dur, peak, { type = 'sawtooth', lp = 1400, lpEnd = 0 } = {}) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(lp, t);
    if (lpEnd) f.frequency.exponentialRampToValueAtTime(lpEnd, t + dur);
    f.connect(dest);
    for (const fr of freqs) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 10;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(peak / freqs.length, t + 0.06);
      e.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.18);
      o.connect(e).connect(f);
      o.start(t); o.stop(t + dur * 1.5 + 0.05);
    }
  }
}

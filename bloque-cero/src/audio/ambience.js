// Ambiente (F12.5): sonidos de fondo según la hora y el sitio, solo en tu oído. No son ruidos de la
// partida (no pasan por la simulación), así que los bots no los oyen.
//  · fuera: de día, pájaros (trinos cortos, en lo alto, a 10–30 m) y coches lejanos que pasan; al
//    atardecer, menos pájaros y los primeros grillos; de noche, grillos y algún coche;
//  · dentro: el reloj de pared del salón (tic, tac), la nevera de la cocina (un zumbido que arranca
//    y para) y crujidos del piso de arriba (si hay piso encima).
// Todo con el reloj del audio y en 3D como el resto (el viento y el zumbido eléctrico siguen en
// audio.js, como estaban).
import { timeOf } from '../render/timeofday.js';

export const AMB = {
  clock: { x: 0.4, y: 2.3, z: 6.5, range: 9 },        // salón, pared oeste
  fridge: { x: 12.7, y: 1.0, z: 16.9, range: 6 },     // cocina, el frigorífico
  crickets: [{ x: 14, y: 0.2, z: 33 }, { x: 36, y: 0.2, z: 30 }, { x: 4, y: 0.2, z: -9 }, { x: 30, y: 0.2, z: -10 }],
  floors: [-3.5, 0, 3.5],                              // suelo del sótano, de la planta baja y de la alta
  fridgeOn: 22, fridgeOff: 11,                         // s encendida y apagada
};

/** El piso (0 sótano, 1 planta baja, 2 planta alta) a la altura `y` de los ojos. */
export const floorAt = (y) => (y < -0.3 ? 0 : y < 3.2 ? 1 : 2);

/**
 * Qué suena y cuánto (0…1) en `pos` a la hora `time`; `indoor` 0 (calle) … 1 (dentro de la casa).
 * {birds, cars, crickets, clock, fridge, creaks}. Sin audio: se puede probar.
 */
export function ambienceLayers(time, pos, indoor) {
  const A = timeOf(time).ambience, out = 1 - indoor, inside = indoor > 0.5;
  const d = (p) => Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
  const near = (p) => Math.max(0, 1 - d(p) / p.range);
  const floor = floorAt(pos.y);
  return {
    birds: A.birds * (0.25 + 0.75 * out),
    cars: A.cars * (0.3 + 0.7 * out),
    crickets: A.crickets * (0.25 + 0.75 * out),
    clock: inside && floor === 1 ? near(AMB.clock) : 0,
    fridge: inside && floor === 1 ? near(AMB.fridge) : 0,
    creaks: inside && floor < 2 ? 1 : 0,
  };
}

export class Ambience {
  constructor(engine) {
    this.a = engine;
    this.ctx = engine.ctx;
    const t = this.ctx.currentTime;
    this.next = { bird: t + 1, car: t + 4, creak: t + 6, cricket: t, clock: t };
    this.tick = 0;
    this.count = { birds: 0, cars: 0, crickets: 0, clock: 0, creaks: 0 };   // (pruebas)
    this.layers = null;
    this.fridge = null;
    this.cricketVoices = null;
    this.cricketLevel = 0;
  }

  /** Cada fotograma: dónde está el que escucha, lo dentro que está (0…1) y la hora. */
  update(pos, indoor, time) {
    const ctx = this.ctx, t = ctx.currentTime, a = this.a, rnd = Math.random;
    const L = this.layers = ambienceLayers(time, pos, indoor);
    // pájaros: uno cada 0,7–2,8 s (menos al atardecer), en lo alto y alrededor
    if (L.birds > 0.01 && t >= this.next.bird) {
      const ang = rnd() * Math.PI * 2, r = 10 + rnd() * 20;
      this._bird({ x: pos.x + Math.cos(ang) * r, y: Math.max(pos.y, 0) + 4 + rnd() * 6, z: pos.z + Math.sin(ang) * r }, L.birds, indoor);
      this.next.bird = t + (0.7 + rnd() * 2.1) / Math.max(0.3, timeOf(time).ambience.birds);
    }
    // coches lejanos: uno cada 9–22 s, pasando por la carretera de delante o la de detrás
    if (L.cars > 0.01 && t >= this.next.car) {
      this._car(rnd() < 0.6 ? -48 : 74, rnd() < 0.5 ? 1 : -1, L.cars, indoor);
      this.next.car = t + (9 + rnd() * 13) / Math.max(0.3, timeOf(time).ambience.cars);
    }
    // grillos: cada uno en su sitio, cantando a ráfagas de 3–4 pulsos
    if (L.crickets > 0.01) {
      if (!this.cricketVoices) this._crickets();
      // (si el reloj del audio se quedó atrás, p. ej. con la pestaña oculta, se retoma desde ahora:
      // sin avalancha de pulsos; los demás sonidos son de uno en uno y no la necesitan)
      if (this.next.cricket < t) this.next.cricket = t;
      while (this.next.cricket < t + 0.3) {
        const at = this.next.cricket;
        this.cricketVoices.forEach((c, i) => {
          if (rnd() < 0.72) {
            const n = 3 + ((i + this.tick) % 2);
            for (let k = 0; k < n; k++) {
              const s = at + c.phase + k * 0.034, e = c.env.gain;
              e.setValueAtTime(0, s); e.linearRampToValueAtTime(1, s + 0.007); e.linearRampToValueAtTime(0, s + 0.024);
            }
          }
        });
        this.tick++;
        this.count.crickets++;
        this.next.cricket = at + 0.42 + rnd() * 0.16;
      }
    }
    if (this.cricketVoices && Math.abs(L.crickets - this.cricketLevel) > 0.01) {
      this.cricketLevel = L.crickets;
      for (const c of this.cricketVoices) c.level.gain.setTargetAtTime(0.12 * L.crickets, t, 0.4);
    }
    // el reloj del salón: tic, tac, cada segundo
    if (L.clock > 0.01) {
      while (this.next.clock < t + 0.3) {
        const at = Math.max(this.next.clock, t + 0.01);
        this._tick(at, (this.count.clock++ & 1) === 0);
        this.next.clock = at + 1;
      }
    } else this.next.clock = t;
    // la nevera: zumbido que arranca y para
    this._fridge(L.fridge, t);
    // crujidos del piso de arriba
    if (L.creaks > 0 && t >= this.next.creak) {
      const up = AMB.floors[Math.min(2, floorAt(pos.y) + 1)];
      this._creak({ x: pos.x + (rnd() - 0.5) * 8, y: up + 0.2, z: pos.z + (rnd() - 0.5) * 8 });
      this.next.creak = t + 7 + rnd() * 11;
    } else if (L.creaks === 0 && this.next.creak < t) this.next.creak = t + 3;
  }

  // Un trino: 2–5 notas cortas que suben y bajan (seno con un poco de FM).
  _bird(p, level, indoor) {
    const ctx = this.ctx, a = this.a, t = ctx.currentTime + 0.02, rnd = Math.random;
    const out = a._out(p, { gain: 0.5 * level, ref: 6, rolloff: 1, occl: indoor * 0.55, reverb: 0.1 });
    const base = 2600 + rnd() * 2200, n = 2 + Math.floor(rnd() * 4), step = 0.07 + rnd() * 0.05;
    for (let i = 0; i < n; i++) {
      const s = t + i * step, f0 = base * (1 + (rnd() - 0.4) * 0.35), f1 = f0 * (0.85 + rnd() * 0.4);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f1, s + step * 0.8);
      const fm = ctx.createOscillator(); fm.frequency.value = 40 + rnd() * 50;
      const fg = ctx.createGain(); fg.gain.value = f0 * 0.04;
      fm.connect(fg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, s + step * 0.85);
      o.connect(g).connect(out);
      o.start(s); o.stop(s + step); fm.start(s); fm.stop(s + step);
    }
    this.count.birds++;
  }

  // Salida en 3D propia (para sonidos que se mueven o duran): ganancia → (tapado) → panner → efectos.
  _pan(pos, { gain = 1, ref = 2, rolloff = 1.2, occl = 0 } = {}) {
    const ctx = this.ctx, a = this.a;
    const g = ctx.createGain(); g.gain.value = gain * (1 - occl * 0.55);
    let head = g;
    if (occl > 0) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200 * Math.pow(1 - occl, 2) + 350; g.connect(lp); head = lp; }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    head.connect(p).connect(a.sfx);
    return { g, p };
  }

  // Un coche que pasa lejos: motor grave y rodadura, de un lado a otro en ~6 s.
  _car(z, dir, level, indoor) {
    const ctx = this.ctx, t = ctx.currentTime + 0.05, dur = 6, x0 = 20 - 40 * dir, x1 = 20 + 40 * dir;
    const { g: out, p } = this._pan({ x: x0, y: 0.8, z }, { gain: 0.9 * level, ref: 20, rolloff: 1, occl: indoor * 0.6 });
    if (p.positionX) { p.positionX.setValueAtTime(x0, t); p.positionX.linearRampToValueAtTime(x1, t + dur); }
    const src = this.a._noiseSrc(true, 0.6); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const eng = ctx.createOscillator(); eng.type = 'sawtooth';
    eng.frequency.setValueAtTime(52, t); eng.frequency.linearRampToValueAtTime(58, t + dur / 2); eng.frequency.linearRampToValueAtTime(49, t + dur);
    const eg = ctx.createGain(); eg.gain.value = 0.18;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + dur / 2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); eng.connect(eg).connect(lp);
    lp.connect(g).connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.1); eng.start(t); eng.stop(t + dur + 0.1);
    this.count.cars++;
  }

  // Los grillos: un tono agudo por grillo (4,2–4,9 kHz), en su sitio, con su envolvente de pulsos.
  _crickets() {
    const ctx = this.ctx;
    this.cricketVoices = AMB.crickets.map((pos, i) => {
      const { g: level } = this._pan(pos, { gain: 0, ref: 4, rolloff: 1.1 });
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4200 + i * 230;
      const env = ctx.createGain(); env.gain.value = 0;
      o.connect(env).connect(level);
      o.start();
      return { o, env, level, phase: i * 0.11 };
    });
  }

  // El reloj: un tic (más agudo) o un tac, seco, desde la pared del salón.
  _tick(at, tic) {
    const out = this.a._out(AMB.clock, { gain: 0.9, ref: 1.5, rolloff: 1.6, reverb: 0.3 });
    this.a._burst(out, at, { type: 'bandpass', freq: tic ? 3400 : 2600, q: 6, a: 0.0005, peak: 0.6, d: 0.02 });
    this.a._tone(out, at, { f0: tic ? 1900 : 1500, f1: tic ? 1850 : 1450, a: 0.0005, peak: 0.12, d: 0.025, type: 'triangle' });
  }

  // La nevera: 100 Hz y armónicos con un poco de aire, que arranca 22 s y para 11.
  _fridge(level, t) {
    const ctx = this.ctx, a = this.a;
    if (!this.fridge) {
      if (level <= 0) return;
      const out = a._out(AMB.fridge, { gain: 1, ref: 1, rolloff: 1.5, reverb: 0.1 });
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const oscs = [[100, 0.5], [200, 0.2], [300, 0.08], [50, 0.25]].map(([f, v]) => {
        const o = ctx.createOscillator(); o.type = f === 100 ? 'triangle' : 'sine'; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = v; o.connect(og).connect(lp); o.start(); return o;
      });
      const air = a._noiseSrc(true, 0.4); air.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.8;
      const ag = ctx.createGain(); ag.gain.value = 0.3;
      air.connect(bp).connect(ag).connect(lp); air.start();
      lp.connect(g).connect(out);
      this.fridge = { g, oscs, air, start: t };
    }
    const F = this.fridge, cyc = (t - F.start) % (AMB.fridgeOn + AMB.fridgeOff);
    const on = cyc < AMB.fridgeOn ? 1 : 0;
    F.on = on;
    F.g.gain.setTargetAtTime(0.09 * level * on, t, on ? 0.25 : 0.6);
  }

  // Un crujido de madera: ruido por un paso banda estrecho que baja, desde el piso de arriba.
  _creak(p) {
    const ctx = this.ctx, a = this.a, t = ctx.currentTime + 0.02, rnd = Math.random;
    const out = a._out(p, { gain: 0.55, ref: 2, rolloff: 1.2, occl: 0.45, reverb: 0.35 });
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.12 + rnd() * 0.18), d = 0.14 + rnd() * 0.2;
      const f = a._burst(out, s, { type: 'bandpass', freq: 700 + rnd() * 500, q: 14, a: 0.01, peak: 0.9, d, pink: true });
      f.frequency.setValueAtTime(700 + rnd() * 500, s);
      f.frequency.exponentialRampToValueAtTime(380 + rnd() * 120, s + d);
    }
    this.count.creaks++;
  }
}

// Repetición de muerte (Fase 7.6). El dibujo guarda sin parar los últimos segundos de la partida
// como datos (nada de vídeo): de cada operador, sus huesos tal como se dibujan, sus ojos, hacia
// dónde mira, si apunta y su arma; y los disparos y los impactos. Al morir a manos de un operador
// se repiten los 4 s anteriores y medio segundo después desde sus ojos, con su arma en primera
// persona y una tarjeta con quién era. La simulación no se toca: la partida sigue por detrás.
import { BONE_COUNT } from '../sim/skeleton.js';
import { scopeZoom } from '../sim/abilities.js';
import { angleDiff } from '../core/math.js';

export const REPLAY = {
  before: 4,          // s antes de la muerte
  after: 0.5,         // s después (te ves caer)
  hz: 30,             // muestras por segundo
  keep: 4.3,          // s guardados: los 4 de antes (mientras se repite, lo nuevo se sigue grabando)
  ops: 10,            // operadores (una partida es 5 contra 5)
};

const BONES12 = BONE_COUNT * 12;   // cada hueso en 3×4 (rotación y posición)
// escalares de cada operador en cada muestra
const K = {
  on: 0, vis: 1, ex: 2, ey: 3, ez: 4, yaw: 5, pitch: 6, roll: 7, ads: 8, zoom: 9,
  wi: 10, equipT: 11, reloadT: 12, reloadTotal: 13, ready: 14, magOut: 15, ammo: 16,
  sprint: 17, speed: 18, chanT: 19, chanTotal: 20, shield: 21, flash: 22,
  blob: 23, bx: 24, by: 25, bz: 26, byaw: 27, bsx: 28, bsz: 29,
};
const NK = 30;

/** ¿Hay repetición? Solo si te mató otro operador (no una caída, tu granada ni desangrarte). */
export function wantsReplay(ev, victim) {
  return !!ev && !!ev.by && ev.by !== victim && ev.zone !== 'fall' && ev.zone !== 'bleed' && !ev.bleed;
}
/** Lo que dice la tarjeta: quién, con qué operador y arma, la vida que le quedó y a qué distancia. */
export function replayCard(ev, victim) {
  const k = ev.by, a = k.body.pos, b = victim.body.pos;
  return {
    name: k.name, op: k.opDef ? k.opDef.name : '', opId: k.opDef ? k.opDef.id : null, team: k.team,
    weapon: ev.weapon ? ev.weapon.name : k.weapon ? k.weapon.def.name : '',
    hp: Math.max(0, Math.round(k.hp)), maxHp: k.maxHp, down: k.state === 'downed',
    dist: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), headshot: !!ev.headshot, ally: k.team === victim.team,
  };
}

// ------------------------------------------------------------ el búfer (solo datos)
export class ReplayBuffer {
  constructor({ seconds = REPLAY.keep, hz = REPLAY.hz, ops = REPLAY.ops } = {}) {
    this.hz = hz; this.maxOps = ops;
    this.N = Math.ceil(seconds * hz) + 2;
    this.T = new Float64Array(this.N);                 // instante de cada muestra
    this.B = new Float32Array(this.N * ops * BONES12); // huesos
    this.S = new Float32Array(this.N * ops * NK);      // escalares
    this.R = new Array(this.N * ops).fill(null);       // lo que no son números: {def, plan, chan}
    this.events = [];                                  // {t, kind, ...}
    this.reset();
  }
  reset() {
    this.head = 0; this.count = 0; this.next = -Infinity;
    this.slots = new Map();
    this.ops = [];
    this.events.length = 0;
  }
  /** Hueco fijo de cada operador en las muestras (hasta `maxOps`). */
  slot(op) {
    let s = this.slots.get(op);
    if (s === undefined && this.ops.length < this.maxOps) { s = this.ops.length; this.slots.set(op, s); this.ops.push(op); }
    return s;
  }
  due(t) { return t >= this.next; }
  /** Abre una muestra en `t` (borra lo que hubiera en su sitio) y devuelve su índice. */
  begin(t) {
    const i = this.head;
    this.head = (i + 1) % this.N;
    this.count = Math.min(this.N, this.count + 1);
    this.T[i] = t;
    this.next = t + 1 / this.hz - 1e-6;
    this.S.fill(0, i * this.maxOps * NK, (i + 1) * this.maxOps * NK);
    return i;
  }
  bOff(i, s) { return (i * this.maxOps + s) * BONES12; }
  sOff(i, s) { return (i * this.maxOps + s) * NK; }
  /** Las dos muestras que rodean `t` y cuánto de la segunda: {i0, i1, a}; null si no hay datos. */
  locate(t) {
    if (!this.count) return null;
    const first = (this.head - this.count + this.N) % this.N;
    let i0 = first;
    if (t <= this.T[first]) return { i0: first, i1: first, a: 0 };
    for (let k = 1; k < this.count; k++) {
      const i1 = (first + k) % this.N;
      if (this.T[i1] >= t) {
        const d = this.T[i1] - this.T[i0];
        return { i0, i1, a: d > 1e-9 ? (t - this.T[i0]) / d : 0 };
      }
      i0 = i1;
    }
    return { i0, i1: i0, a: 0 };
  }
  oldest() { return this.count ? this.T[(this.head - this.count + this.N) % this.N] : Infinity; }
  newest() { return this.count ? this.T[(this.head - 1 + this.N) % this.N] : -Infinity; }
  /** Guarda un suceso (disparo, impacto) y olvida los que ya no caben. */
  push(e) {
    this.events.push(e);
    const old = e.t - this.N / this.hz;
    let k = 0;
    while (k < this.events.length && this.events[k].t < old) k++;
    if (k) this.events.splice(0, k);
  }
  /** Huesos de `s` en el instante localizado, interpolados, en `out` (20 × 3×4). */
  bonesAt(s, L, out) {
    const B = this.B, o0 = this.bOff(L.i0, s), o1 = this.bOff(L.i1, s), a = L.a;
    for (let k = 0; k < BONES12; k++) out[k] = B[o0 + k] + (B[o1 + k] - B[o0 + k]) * a;
    return out;
  }
  /** Escalar `k` de `s`, interpolado (los ángulos, por el camino corto). */
  at(s, L, k, angle = false) {
    const v0 = this.S[this.sOff(L.i0, s) + k], v1 = this.S[this.sOff(L.i1, s) + k];
    return angle ? v0 + angleDiff(v0, v1) * L.a : v0 + (v1 - v0) * L.a;
  }
  /** De la muestra más cercana (lo que no se interpola: el arma, la recarga…). */
  near(s, L, k) { return this.S[this.sOff(L.a < 0.5 ? L.i0 : L.i1, s) + k]; }
  ref(s, L) { return this.R[(L.a < 0.5 ? L.i0 : L.i1) * this.maxOps + s]; }
}

// ------------------------------------------------------------ grabar y repetir
export class DeathReplay {
  constructor(ctx) {
    this.ctx = ctx;
    this.buf = new ReplayBuffer();
    this.active = false;
    this.clock = 0;
    this._bones = new Float32Array(BONES12);
    this._entries = [];
    // arma en primera persona del que te mató: una por ranura (el arma en primera persona reconoce
    // el cambio de arma por el objeto)
    this._w = [{}, {}];
    this.vmOp = { weapon: this._w[0], ads: 0, sprinting: false, channel: null, reviving: null, state: 'alive', intent: null, roll: 0, moveSpeed: 0, flashT: 0, ability: null, yaw: 0, weaponIndex: 0 };
    this._pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 70, feed: 0, staticK: 0 };
  }

  reset() { this.stop(); this.buf.reset(); }

  /** Una muestra más si toca (llamar cada fotograma, después de pintar los personajes). */
  record(t, game) {
    const buf = this.buf, chars = this.ctx.chars;
    if (!buf.due(t)) return;
    const i = buf.begin(t), S = buf.S;
    for (const op of game.operators) {
      const s = buf.slot(op);
      if (s === undefined) continue;
      const blob = chars.capture(op, buf.B, buf.bOff(i, s));
      if (!blob) continue;
      const o = buf.sOff(i, s), e = op.eyePos(), w = op.weapon;
      S[o + K.on] = 1; S[o + K.vis] = op.frozen ? 0 : 1;
      S[o + K.ex] = e.x; S[o + K.ey] = e.y; S[o + K.ez] = e.z;
      S[o + K.yaw] = op.yaw; S[o + K.pitch] = op.pitch; S[o + K.roll] = op.roll || 0;
      S[o + K.ads] = op.ads || 0; S[o + K.zoom] = w ? scopeZoom(op) : 1;
      S[o + K.wi] = op.weaponIndex || 0;
      if (w) { S[o + K.equipT] = w.equipT || 0; S[o + K.reloadT] = w.reloadT || 0; S[o + K.reloadTotal] = w.reloadTotal || 0; S[o + K.ready] = w.ready ? 1 : 0; S[o + K.magOut] = w.magOut ? 1 : 0; S[o + K.ammo] = w.ammo || 0; }
      S[o + K.sprint] = op.sprinting ? 1 : 0; S[o + K.speed] = op.moveSpeed || 0;
      S[o + K.chanT] = op.channel ? op.channel.t : 0; S[o + K.chanTotal] = op.channel ? op.channel.total : 0;
      S[o + K.shield] = op.ability && op.ability.id === 'shield' ? 1 : 0; S[o + K.flash] = op.flashT || 0;
      if (blob.on) { S[o + K.blob] = 1; S[o + K.bx] = blob.x; S[o + K.by] = blob.y; S[o + K.bz] = blob.z; S[o + K.byaw] = blob.yaw; S[o + K.bsx] = blob.sx; S[o + K.bsz] = blob.sz; }
      const r = buf.R[i * buf.maxOps + s] || (buf.R[i * buf.maxOps + s] = {});
      r.def = w ? w.def : null; r.plan = w ? w.plan : null; r.chan = op.channel ? op.channel.kind : null;
    }
  }
  /** Un disparo (evento 'shot'): de dónde sale y adónde llega cada bala. */
  onShot(t, op, w, eye, results) {
    const g = op.rig && op.rig[17], R = g && g.R;
    let muzzle = null;
    if (g) {
      const lz = w.def.cls !== 'pistol' ? -0.62 : -0.17;
      muzzle = { x: g.p.x + R.y.x * 0.04 + R.z.x * lz, y: g.p.y + R.y.y * 0.04 + R.z.y * lz, z: g.p.z + R.y.z * 0.04 + R.z.z * lz };
    }
    const ends = results.map((r) => ({ x: r.origin.x + r.dir.x * r.end, y: r.origin.y + r.dir.y * r.end, z: r.origin.z + r.dir.z * r.end }));
    this.buf.push({ t, kind: 'shot', op, sound: w.def.sound, quiet: !!w.def.suppressed, pellets: w.def.pellets || 1, eye: { ...eye }, muzzle, ends });
  }
  /** Un impacto en alguien (evento 'damaged'): la sangre. */
  onHit(t, target, ev) {
    if (ev.point) this.buf.push({ t, kind: 'blood', point: { ...ev.point }, dir: ev.dir ? { ...ev.dir } : null, head: ev.zone === 'head' });
  }

  /** Empieza la repetición de la muerte de `victim` (evento 'killed'); false si no hay. */
  start(victim, ev, t) {
    this.stop();
    if (!wantsReplay(ev, victim)) return false;
    const killer = ev.by, s = this.buf.slots.get(killer);
    if (s === undefined || this.buf.oldest() > t - 1) return false;
    this.killer = killer; this.slot = s;
    this.t0 = Math.max(this.buf.oldest(), t - REPLAY.before);
    this.t1 = t + REPLAY.after;
    this.clock = 0; this.last = this.t0;
    this.card = replayCard(ev, victim);
    this.active = true;
    this._w[0] = {}; this._w[1] = {};
    this.ctx.hud.replay(this.card);
    return true;
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.ctx.chars.endReplay();
    this.ctx.hud.replay(null);
  }
  get length() { return this.t1 - this.t0; }

  /**
   * Cada fotograma (después de pintar los personajes y de grabar): pinta el instante de ahora y
   * adelanta el reloj. Devuelve false cuando termina (y la deja parada).
   */
  frame(dt) {
    if (!this.active) return false;
    const t = Math.min(this.t1, this.t0 + this.clock);
    const L = this.buf.locate(t);
    if (!L) { this.stop(); return false; }
    this._draw(L);
    this._events(this.last, t);
    this.last = t;
    this.ctx.hud.replayProgress(this.clock / this.length);
    this.clock += dt;
    if (this.t0 + this.clock > this.t1 + 1e-6 && t >= this.t1) { this.stop(); return false; }
    return true;
  }

  // los personajes, la cámara y el arma en primera persona en el instante localizado
  _draw(L) {
    const buf = this.buf, list = this._entries;
    let n = 0;
    for (let s = 0; s < buf.ops.length; s++) {
      if (!buf.S[buf.sOff(L.i0, s) + K.on]) continue;
      const e = list[n] || (list[n] = { op: null, bones: new Float32Array(BONES12), vis: false, blob: null, b: new Float32Array(6) });
      e.op = buf.ops[s];
      buf.bonesAt(s, L, e.bones);
      e.vis = buf.near(s, L, K.vis) > 0 && s !== this.slot;
      if (buf.near(s, L, K.blob) > 0 && e.vis) {
        e.b[0] = buf.at(s, L, K.bx); e.b[1] = buf.at(s, L, K.by); e.b[2] = buf.at(s, L, K.bz);
        e.b[3] = buf.at(s, L, K.byaw, true); e.b[4] = buf.near(s, L, K.bsx); e.b[5] = buf.near(s, L, K.bsz);
        e.blob = e.b;
      } else e.blob = null;
      n++;
    }
    list.length = n;
    this.ctx.chars.applyReplay(list);
    // cámara: los ojos del que te mató, con su zoom si apuntaba
    const s = this.slot, P = this._pose;
    P.x = buf.at(s, L, K.ex); P.y = buf.at(s, L, K.ey); P.z = buf.at(s, L, K.ez);
    P.yaw = buf.at(s, L, K.yaw, true); P.pitch = buf.at(s, L, K.pitch); P.roll = buf.at(s, L, K.roll);
    const ads = buf.at(s, L, K.ads), zoom = 1 + (buf.near(s, L, K.zoom) - 1) * ads;
    P.zoom = zoom;
    // su arma en primera persona
    const V = this.vmOp, r = buf.ref(s, L);
    const wi = buf.near(s, L, K.wi) > 0.5 ? 1 : 0, w = this._w[wi];
    if (r && r.def) {
      w.def = r.def; w.plan = r.plan;
      w.equipT = buf.near(s, L, K.equipT); w.reloadT = buf.near(s, L, K.reloadT); w.reloadTotal = buf.near(s, L, K.reloadTotal);
      w.ready = buf.near(s, L, K.ready) > 0; w.magOut = buf.near(s, L, K.magOut) > 0; w.ammo = buf.near(s, L, K.ammo);
    }
    V.weapon = w; V.weaponIndex = wi;
    V.ads = ads; V.sprinting = buf.near(s, L, K.sprint) > 0; V.moveSpeed = buf.at(s, L, K.speed);
    V.roll = P.roll; V.yaw = P.yaw; V.flashT = buf.near(s, L, K.flash);
    V.channel = r && r.chan ? { kind: r.chan, t: buf.near(s, L, K.chanT), total: buf.near(s, L, K.chanTotal) } : null;
    V.ability = buf.near(s, L, K.shield) > 0 ? { id: 'shield' } : null;
  }
  /** Postura de la cámara (la usa la sesión como cámara de la vista). */
  pose(baseFov) {
    const P = this._pose, DEG = Math.PI / 180;
    P.fov = 2 * Math.atan(Math.tan(baseFov * DEG / 2) / (P.zoom || 1)) / DEG;
    return P;
  }

  // lo que pasó entre el fotograma anterior y este: disparos (fogonazo, trazadoras, sonido y el
  // retroceso del arma si es suyo) y sangre (sin volver a manchar las paredes)
  _events(a, b) {
    const { effects, audio, vm } = this.ctx;
    for (const e of this.buf.events) {
      if (e.t <= a || e.t > b) continue;
      if (e.kind === 'blood') { effects.bloodHit(e.point, e.dir, e.head, false); continue; }
      const mine = e.op === this.killer;
      let m = e.muzzle;
      if (mine) {
        // desde el arma en primera persona (como las tuyas)
        const P = this._pose, cy = Math.cos(P.pitch);
        const fx = -Math.sin(P.yaw) * cy, fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * cy;
        const hip = 1 - this.vmOp.ads, rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
        m = { x: P.x + fx * 0.55 + rx * 0.12 * hip, y: P.y + fy * 0.55 - 0.1 * hip - 0.03, z: P.z + fz * 0.55 + rz * 0.12 * hip };
        vm.onShot();
        audio.gunshot(e.sound, e.eye, true, 0, e.quiet);
      } else audio.gunshot(e.sound, e.eye, false, this.ctx.hear ? this.ctx.hear(e.eye) : 0, e.quiet);
      if (!m) continue;
      if (!e.quiet) effects.flash(m.x, m.y, m.z, 9, 5.4, 2.4, 5.5, 0.06);
      for (const end of e.ends) if (e.pellets === 1 || Math.random() < 0.35) effects.addTracer(m, end);
    }
  }
}

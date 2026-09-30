// Puntería humana de los bots (F10.6).
//
// Cómo apunta un bot a un enemigo, como lo haría una persona:
//  1. Reacción: desde que lo ve (en su cono y con línea de visión) hasta que empieza a girar pasa
//     su tiempo de reacción (±20 %, y algo más si aparece en el borde de su vista). Mientras, no
//     se gira hacia él ni dispara. Como la vista se barre cada 0,12 s, al descubrirlo se mira en
//     el rastro de las últimas posiciones desde cuándo lo habría visto: así cuenta desde entonces.
//  2. Giro rápido: con la velocidad máxima de su dificultad, arrancando y frenando suave (el
//     perfil de un movimiento de la mano). En giros largos, la mitad de las veces se pasa un poco
//     en la misma dirección, y siempre acaba con un pequeño error que crece con el giro.
//  3. Seguimiento: corrige lo que le falta y sigue al blanco donde cree que está: lo que vio hace
//     un momento, adelantado con la velocidad que llevaba (si cambias de dirección, tarda en
//     notarlo). Sin verlo, donde lo vio por última vez. Al blanco le suma un error que empieza
//     grande en los primeros disparos y se asienta mientras lo sigue (se pasa y vuelve).
//  4. Dispara solo con la mira asentada: nunca mientras gira rápido, y tras un giro de más de
//     20° espera un momento.
//  5. Retroceso: compensa de antemano una parte (op.recoilControl) y el resto lo ve tarde: lo que
//     sube la vista sin que él la mueva no lo corrige hasta pasado su retraso.
// Los números de cada dificultad están en la tabla DIFFICULTY (bots.js).
import { lineOfSight } from '../../world/raycast.js';
import { angleDiff, clamp } from '../../core/math.js';
import { BONE } from '../skeleton.js';

const TICK = 1 / 60;
const DEG = Math.PI / 180;
export const AIM = {
  bigTurn: 20 * DEG,        // tras un giro rápido de más de esto, espera `flickWait` antes de disparar
  overshootFrom: 15 * DEG,  // los giros más largos que esto a veces se pasan…
  overshootP: 0.5,          // …la mitad de las veces
  peripheral: 0.1,          // s de más si aparece en el borde de la vista (de 20° a 50° del centro)
  peripheralFrom: 20 * DEG,
  peripheralSpan: 30 * DEG,
  minFlick: 0.08,           // s que dura como poco un giro rápido
  tiny: 2 * DEG,            // menos que esto no es un giro rápido: lo corrige siguiendo
  reflick: 6 * DEG,         // si se le va más que esto (y que 3 veces la tolerancia), otro giro rápido
  lostFor: 0.3,             // sin verlo, lo adelanta como mucho estos segundos
  switchK: 0.5,             // cambiar de blanco en pleno combate: al menos la mitad de la reacción
  trigger: 0.06,            // s de apretar el gatillo, desde que la mira está lista (tras la espera de un giro largo)
};

// ------------------------------------------------------------------ rastro de posiciones
// Las últimas 24 muestras (0,4 s) de cada operador: dónde estaba, hacia dónde miraba, sus ojos
// (con lo que se asomaba), su cabeza, su pecho, su centro y si estaba cegado. Lo graba el
// escuadrón en cada paso.
const N = 24, F = 17;
const EYE = { x: 0, y: 0, z: 0 }, CEN = { x: 0, y: 0, z: 0 };
export class Trails {
  constructor() { this.map = new Map(); this.holes = []; }
  clear() { this.map.clear(); this.holes.length = 0; }
  /** Algo se ha roto en `p` (una bala, una carga): lo que se veía antes por ahí no se veía igual. */
  changed(p, t) {
    this.holes.push({ x: p.x, y: p.y, z: p.z, t });
    while (this.holes.length && t - this.holes[0].t > 0.3) this.holes.shift();
    if (this.holes.length > 256) this.holes.shift();
  }
  record(ops) {
    for (const op of ops) {
      let T = this.map.get(op);
      if (!T) this.map.set(op, (T = { buf: new Float32Array(N * F), head: -1, n: 0 }));
      const p = op.body.pos;
      // (un salto de más de 3 m no es moverse: empieza de nuevo)
      if (T.n) { const i = T.head * F; if (Math.abs(T.buf[i] - p.x) + Math.abs(T.buf[i + 2] - p.z) > 3) T.n = 0; }
      T.head = (T.head + 1) % N;
      T.n = Math.min(N, T.n + 1);
      const b = T.buf, i = T.head * F;
      const e = op.eyePos(EYE), c = op.center(CEN);
      const h = op.rig && op.rig[BONE.head] ? op.rig[BONE.head].p : c, ch = op.rig && op.rig[BONE.chest] ? op.rig[BONE.chest].p : c;
      b[i] = p.x; b[i + 1] = p.y; b[i + 2] = p.z; b[i + 3] = op.yaw;
      b[i + 4] = e.x; b[i + 5] = e.y; b[i + 6] = e.z;
      b[i + 7] = h.x; b[i + 8] = h.y; b[i + 9] = h.z;
      b[i + 10] = ch.x; b[i + 11] = ch.y; b[i + 12] = ch.z;
      b[i + 13] = c.x; b[i + 14] = c.y; b[i + 15] = c.z;
      b[i + 16] = op.blindT > 0 ? 1 : 0;
    }
  }
  /**
   * La muestra de hace `k` pasos en `out` (si no llega tan atrás, la más antigua que haya, salvo con
   * `exact`); false si no hay ninguna.
   */
  at(op, k, out, exact = false) {
    const T = this.map.get(op);
    if (!T || !T.n || (exact && k >= T.n)) return false;
    k = Math.min(Math.max(0, k), T.n - 1);
    const b = T.buf, i = ((T.head - k + N) % N) * F;
    out.x = b[i]; out.y = b[i + 1]; out.z = b[i + 2]; out.yaw = b[i + 3];
    out.ex = b[i + 4]; out.ey = b[i + 5]; out.ez = b[i + 6];
    out.hx = b[i + 7]; out.hy = b[i + 8]; out.hz = b[i + 9];
    out.cx = b[i + 10]; out.cy = b[i + 11]; out.cz = b[i + 12];
    out.mx = b[i + 13]; out.my = b[i + 14]; out.mz = b[i + 15];
    out.blind = b[i + 16] > 0;
    return true;
  }
}

const S0 = {}, S1 = {}, E0 = { x: 0, y: 0, z: 0 }, H0 = { x: 0, y: 0, z: 0 }, C0 = { x: 0, y: 0, z: 0 };

/**
 * ¿Cuánto hace que el bot `B` ve a `t`? Lo acaba de descubrir en un barrido de la vista: mira hacia
 * atrás en el rastro, paso a paso (como mucho 8), mientras lo habría visto (sin estar cegado, en su
 * cono, con línea de visión hasta la cabeza o el pecho y sin humo en medio, como la vista).
 * Devuelve los segundos.
 */
export function sightAge(B, t) {
  const tr = B.sq.trails, w = B.game.world, D = B.diff;
  if (!tr) return 0;
  const cosF = Math.cos(D.fov);
  let k = 1;
  for (; k <= 8; k++) {
    if (!tr.at(B.op, k, S0, true) || !tr.at(t, k, S1, true) || S0.blind) break;
    const dx = S1.mx - S0.ex, dy = S1.my - S0.ey, dz = S1.mz - S0.ez;
    const hd = Math.hypot(dx, dz) || 1, dist = Math.hypot(dx, dy, dz);
    if (dist > D.range) break;
    if ((dx * -Math.sin(S0.yaw) + dz * -Math.cos(S0.yaw)) / hd < cosF && dist > 2.2) break;
    // (si desde entonces se ha roto algo cerca de la línea —un agujero, una brecha—, entonces quizá
    // no lo veía: la línea de visión de ahora no vale para antes)
    if (holeSince(tr, B.game.time - k * TICK, S0.ex, S0.ey, S0.ez, S1.mx, S1.my, S1.mz)) break;
    if (!lineOfSight(w, S0.ex, S0.ey, S0.ez, S1.hx, S1.hy + 0.06, S1.hz) && !lineOfSight(w, S0.ex, S0.ey, S0.ez, S1.cx, S1.cy, S1.cz)) break;
    E0.x = S0.ex; E0.y = S0.ey; E0.z = S0.ez; H0.x = S1.hx; H0.y = S1.hy; H0.z = S1.hz; C0.x = S1.cx; C0.y = S1.cy; C0.z = S1.cz;
    if (B.per.smokeHides(E0, H0, C0, dist)) break;
  }
  return (k - 1) * TICK;
}

// ¿Se ha roto algo después de `t0` a menos de 1,5 m del segmento a–b?
function holeSince(tr, t0, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1;
  for (let i = tr.holes.length - 1; i >= 0; i--) {
    const h = tr.holes[i];
    if (h.t < t0) break;
    const u = clamp(((h.x - ax) * dx + (h.y - ay) * dy + (h.z - az) * dz) / L2, 0, 1);
    const qx = ax + dx * u - h.x, qy = ay + dy * u - h.y, qz = az + dz * u - h.z;
    if (qx * qx + qy * qy + qz * qz < 1.5 * 1.5) return true;
  }
  return false;
}

/** Segundos de más si `t` aparece lejos del centro de la vista del bot. */
export function peripheralDelay(op, t) {
  const e = op.eyePos(), c = t.center();
  const off = Math.abs(angleDiff(op.yaw, Math.atan2(-(c.x - e.x), -(c.z - e.z))));
  return AIM.peripheral * clamp((off - AIM.peripheralFrom) / AIM.peripheralSpan, 0, 1);
}

// ------------------------------------------------------------------ puntería de un bot
export class Aim {
  constructor(B) {
    this.B = B;
    this.off = { x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, jT: 0 };   // error sobre el blanco (rad)
    this.ext = new Float32Array(2 * 32);  // lo que se ha movido la vista sin que él la moviera
    this.extI = 0; this.extN = 0;
    this.out = { dist: 0, tol: 0, canFire: false };
    this.shift = { x: 0, y: 0, z: 0 };
    this.clear();
  }

  clear() {
    this.tgt = null;
    this.phase = null;      // 'react' | 'flick' | 'track'
    this.reactT = 0;
    this.fl = null;         // giro rápido en marcha
    this.trackT = 0;        // tiempo siguiendo desde el último giro rápido
    this.engT = 0;          // tiempo siguiendo desde que empezó el combate con este blanco
    this.pressT = 0;        // tiempo con la mira lista (el gatillo)
    this.big = false;       // el último giro rápido fue largo (espera antes de disparar)
    this.dY = null; this.dP = 0;   // hacia dónde quería mirar en el paso anterior
    this.seen = null;       // lo último que vio del blanco {x, y, z, vx, vy, vz, t}
    this.head = false;
    this.cmdYaw = null; this.cmdPitch = 0;
    this.extN = 0;
    this.lastT = -9;
  }

  get reacting() { return this.phase === 'react' && this.reactT > 0; }

  /** Un blanco nuevo: reacciona `reactT` segundos antes de girar hacia él. */
  acquire(t, reactT) {
    this.clear();
    this.tgt = t;
    this.phase = 'react';
    this.reactT = reactT;
    this.react0 = reactT; this.acqT = this.B.game.time;     // (para las pruebas)
    this.head = this.B.rng.next() < this.B.diff.head;
  }

  tick(dt) { if (this.phase === 'react') this.reactT -= dt; }

  /**
   * Mueve la vista del bot hacia su blanco `t` (desde sus ojos `e`) y dice si puede disparar:
   * {dist (horizontal), tol (rad), canFire}.
   */
  steer(dt, t, e, aimPoint) {
    const B = this.B, op = B.op, D = B.diff, rng = B.rng, out = this.out;
    if (t !== this.tgt) this.acquire(t, 0);
    // (si el paso anterior no apuntó, lo que se movió la vista entonces lo movió él: se empieza de nuevo)
    const now = B.game.time;
    if (now - this.lastT > 1.5 * TICK) { this.cmdYaw = null; this.extN = 0; this.dY = null; }
    this.lastT = now;
    // lo que ha movido la vista sin que él la moviera (el retroceso y su recuperación)
    if (this.cmdYaw !== null) this._pushExt(angleDiff(this.cmdYaw, op.yaw), op.pitch - this.cmdPitch);
    // dónde cree que está el punto al que apunta
    const sh = this._perceived(t);
    const tp = aimPoint(t, this.head && t.state === 'alive', e);
    const dx = tp.x + sh.x - e.x, dy = tp.y + sh.y - e.y, dz = tp.z + sh.z - e.z;
    const dist = Math.hypot(dx, dz);
    const yawTo = Math.atan2(-dx, -dz), pitchTo = Math.atan2(dy, dist);
    const tol = Math.max(0.035, Math.min(0.14, 0.32 / Math.max(1, dist)));
    out.dist = dist; out.tol = tol; out.canFire = false;
    if (this.phase === 'react') {
      if (this.reactT > 0) { this.cmdYaw = null; this.extN = 0; return out; }   // aún no se mueve
      this._startOffset(t, 1);
      this._plan(op.yaw, op.pitch, yawTo + this.off.x, pitchTo + this.off.y);
    }
    if (this.phase === 'flick') {
      const G = this.fl;
      G.t += dt;
      const u = Math.min(1, G.t / G.T), s = u * u * u * (10 - 15 * u + 6 * u * u);   // mínimo tirón
      op.yaw = G.y0 + G.dy * s;
      op.pitch = clamp(G.p0 + G.dp * s, -1.52, 1.52);
      if (u >= 1) { this.phase = 'track'; this.trackT = 0; this.big = G.A > AIM.bigTurn; this.dY = null; }
      this._cmd(op);
      return out;
    }
    // ---- seguimiento
    const wantY = yawTo + this.off.x, wantP = pitchTo + this.off.y;
    const vm = D.aimSpeed * DEG;
    // lo que se mueve el blanco (visto desde aquí): la mira lo acompaña
    let wy = 0, wp = 0;
    if (this.dY !== null) {
      wy = angleDiff(this.dY, wantY) / dt; wp = (wantP - this.dP) / dt;
      const w = Math.hypot(wy, wp);
      if (w > vm) { wy *= vm / w; wp *= vm / w; }
    }
    this.dY = wantY; this.dP = wantP;
    // donde cree que mira: sin lo que el retroceso ha movido la vista y aún no ha visto
    const lagN = Math.round(D.recoilLag / TICK);
    let uy = 0, up = 0;
    for (let i = 0, n = Math.min(lagN, this.extN); i < n; i++) {
      const j = ((this.extI - 1 - i + 32) % 32) * 2;
      uy += this.ext[j]; up += this.ext[j + 1];
    }
    const ey = angleDiff(op.yaw - uy, wantY), ep = wantP - (op.pitch - up), err = Math.hypot(ey, ep);
    if (err > Math.max(AIM.reflick, 3 * tol) && this.trackT > D.lag) {
      // se le ha ido (se movió mucho o de golpe): otro giro rápido hacia lo que cree que falta
      this._startOffset(t, 0.65);
      const ny = angleDiff(op.yaw - uy, yawTo + this.off.x), np = pitchTo + this.off.y - (op.pitch - up);
      this._plan(op.yaw, op.pitch, op.yaw + ny, op.pitch + np);
      this._cmd(op);
      return out;
    }
    let vy = wy + D.aimKp * ey, vp = wp + D.aimKp * ep;
    const v = Math.hypot(vy, vp);
    if (v > vm) { vy *= vm / v; vp *= vm / v; }
    const my = vy * dt, mp = vp * dt;
    op.yaw += my;
    op.pitch = clamp(op.pitch + mp, -1.52, 1.52);
    if (op.compensateRecoil) op.compensateRecoil(mp, my);    // (como el ratón del jugador)
    this.trackT += dt;
    this._offsetTick(dt, t);
    // lista: ha pasado la espera tras un giro largo; desde entonces, lo que tarda en apretar
    const ready = this.trackT > (this.big ? D.flickWait : 0) + 1e-6;
    out.canFire = ready && this.pressT >= AIM.trigger - 1e-6 && err < tol;
    if (ready) this.pressT += dt;
    this._cmd(op);
    return out;
  }

  // Un giro rápido desde (y0, p0) hacia (y1, p1): a veces se pasa y acaba con un error.
  _plan(y0, p0, y1, p1) {
    const D = this.B.diff, rng = this.B.rng;
    let dy = angleDiff(y0, y1), dp = p1 - p0;
    const A = Math.hypot(dy, dp);
    this.dY = null;
    if (A < AIM.tiny) { this.phase = 'track'; this.trackT = 0; this.big = false; this.fl = null; return; }
    if (A > AIM.overshootFrom && rng.next() < AIM.overshootP) {
      const k = 1 + D.overshoot[0] + rng.next() * (D.overshoot[1] - D.overshoot[0]);
      dy *= k; dp *= k;
    }
    const s = D.scatter * A;
    dy += rng.gauss() * s; dp += rng.gauss() * s * 0.7;
    // (el pico de un movimiento de mínimo tirón es 1,875 veces la velocidad media)
    const L = Math.hypot(dy, dp);
    this.fl = { y0, p0, dy, dp, A, t: 0, T: Math.max(AIM.minFlick, (1.875 * L) / (D.aimSpeed * DEG)) };
    this.phase = 'flick';
    this.pressT = 0;
  }

  // El error de los primeros disparos: grande y en una dirección al azar (más si el blanco se mueve).
  _startOffset(t, k) {
    const D = this.B.diff, rng = this.B.rng, O = this.off;
    const mv = 1 + Math.min(1, t.moveSpeed / 3.3) * 0.5;
    const a = rng.next() * Math.PI * 2, m = D.firstErr * (0.7 + rng.next() * 0.3) * mv * k;
    O.x = Math.cos(a) * m; O.y = Math.sin(a) * m * 0.7;
    // (el punto de reposo empieza ahí mismo: el error dura hasta que se asienta, no se deshace solo)
    O.vx = 0; O.vy = 0; O.gx = O.x; O.gy = O.y; O.jT = 0.15;
    if (k >= 1) this.engT = 0;
  }

  // Mientras lo sigue, el error se asienta: de `firstErr` al de la tabla del documento (`aimErr`) en
  // `settleT`, con un muelle que se pasa y vuelve y un punto de reposo que cambia cada poco.
  _offsetTick(dt, t) {
    const B = this.B, D = B.diff, rng = B.rng, O = this.off;
    this.engT += dt;
    O.jT -= dt;
    if (O.jT <= 0) {
      O.jT = 0.25 + rng.next() * 0.35;
      const env = D.aimErr + (D.firstErr - D.aimErr) * Math.exp((-3 * this.engT) / D.settleT);
      const r = env * (B.op.moveSpeed > 1 ? 2 : 1) * (1 + Math.min(1, t.moveSpeed / 3.3) * 0.5);
      const a = rng.next() * Math.PI * 2, m = r * Math.sqrt(rng.next());
      O.gx = Math.cos(a) * m; O.gy = Math.sin(a) * m * 0.7;
      if (rng.next() < 0.3) this.head = rng.next() < D.head;
    }
    const wn = 4 / D.settleT, z = 0.5;
    O.vx += (wn * wn * (O.gx - O.x) - 2 * z * wn * O.vx) * dt;
    O.vy += (wn * wn * (O.gy - O.y) - 2 * z * wn * O.vy) * dt;
    O.x += O.vx * dt; O.y += O.vy * dt;
  }

  // Dónde cree que está el blanco, como desplazamiento sobre donde está de verdad: lo que vio hace
  // `lag` s adelantado con la velocidad que llevaba entonces; sin verlo, lo último que vio.
  _perceived(t) {
    const B = this.B, tr = B.sq.trails, L = B.diff.lag, now = B.game.time, sh = this.shift;
    const p = t.body.pos;
    const visible = B.per.visible.includes(t);
    if (visible && tr) {
      const k0 = Math.round(L / TICK);
      if (tr.at(t, k0, S0) && tr.at(t, k0 + 3, S1)) {
        const vx = (S0.x - S1.x) / (3 * TICK), vy = (S0.y - S1.y) / (3 * TICK), vz = (S0.z - S1.z) / (3 * TICK);
        const s = this.seen || (this.seen = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 });
        s.x = S0.x + vx * L; s.y = S0.y + vy * L; s.z = S0.z + vz * L; s.vx = vx; s.vy = vy; s.vz = vz; s.t = now;
        sh.x = s.x - p.x; sh.y = s.y - p.y; sh.z = s.z - p.z;
        return sh;
      }
    }
    if (!visible && this.seen) {
      const s = this.seen, k = Math.min(AIM.lostFor, now - s.t);
      sh.x = s.x + s.vx * k - p.x; sh.y = s.y + s.vy * k - p.y; sh.z = s.z + s.vz * k - p.z;
      return sh;
    }
    sh.x = 0; sh.y = 0; sh.z = 0;
    return sh;
  }

  _pushExt(y, p) {
    const j = this.extI * 2;
    this.ext[j] = y; this.ext[j + 1] = p;
    this.extI = (this.extI + 1) % 32;
    this.extN = Math.min(32, this.extN + 1);
  }
  _cmd(op) { this.cmdYaw = op.yaw; this.cmdPitch = op.pitch; }
}

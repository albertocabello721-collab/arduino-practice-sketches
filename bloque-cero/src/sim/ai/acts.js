// Acciones breves de los bots (F6.6): ir a un punto si hace falta, encarar y pulsar G o X como
// un jugador (lanzar, disparar, colocar), con las tiradas y retrasos de la dificultad. Las usan
// el ataque (attackkit.js) y la defensa (defensekit.js); bots.js las ejecuta antes de la tarea.
import { angleDiff } from '../../core/math.js';

export function kitOf(B) {
  return B.kit || (B.kit = { act: null, job: null, rolls: new Map(), t: 0, fragNext: 0, scanAt: -99, flashTgt: null, flashAt: Infinity, roomFlashed: false, clay: false });
}
// Una tirada por ocasión y ronda (con la probabilidad de la dificultad).
export function roll(B, key, p) {
  const K = kitOf(B);
  if (!K.rolls.has(key)) K.rolls.set(key, B.rng.next() < p);
  return K.rolls.get(key);
}
export function late(B) { const [a, b] = B.diff.kitLate; return a + B.rng.next() * (b - a); }

/**
 * Acción: {src: 'gadget'|'ability', yaw, pitch, at? (ir antes ahí), aim? (recalcula yaw y
 * pitch al llegar; null = cancelar), delay, hold (s tras pulsar), away (darse la vuelta
 * mientras: cegadoras), say (radio), then (al terminar)}.
 */
export function start(B, act) { kitOf(B).act = { t: 0, delay: 0, hold: 0.25, timeout: 8, ...act }; }

/** Ejecuta la acción en curso. true mientras la acción manda sobre el bot. */
export function runAct(B, dt) {
  const K = B.kit, A = K && K.act;
  if (!A) return false;
  const op = B.op, I = op.intent;
  A.t += dt;
  const placing = op.channel && op.channel.kind === 'gadget';
  // (en combate se deja, salvo lo que es para el combate: `combat`)
  if ((B.target && !placing && !A.combat) || A.t > A.timeout || op.state !== 'alive' || (A.breach && !B.breach)) { K.act = null; if (A.fail) A.fail(B); return false; }
  if (A.at && !A.arrived) {
    const p = op.body.pos, d = Math.hypot(A.at.x - p.x, A.at.z - p.z);
    // (cerca y sin avanzar —algo le impide clavarse en el punto—: vale donde está)
    if (d < (A.best ?? Infinity) - 0.05) { A.best = d; A.bestT = A.t; }
    const stalled = d < 1.0 && A.t - (A.bestT ?? A.t) > 1.2;
    if (d > (A.r || 0.3) && !stalled) { B._goto(A.at, dt, { r: 0.25, exact: true }); return true; }
    A.arrived = true;
    if (A.aim) {
      const r = A.aim(B);
      if (!r) { K.act = null; if (A.fail) A.fail(B); return false; }
      A.yaw = r.yaw; A.pitch = r.pitch;
    }
  }
  // (sin punto al que ir y con puntería propia: se vuelve a apuntar si se ha movido)
  if (A.aim && !A.at && !A.pressed) {
    const p = op.body.pos;
    if (!A.aimFrom || Math.hypot(p.x - A.aimFrom.x, p.z - A.aimFrom.z) > 0.25) {
      A.aimFrom = { x: p.x, z: p.z };
      const r = A.aim(B);
      if (!r) { K.act = null; if (A.fail) A.fail(B); return false; }
      A.yaw = r.yaw; A.pitch = r.pitch;
    }
  }
  B._stand(dt);
  if (A.stance) I.stance = A.stance;
  if (!A.pressed) {
    B._turn(A.yaw, A.pitch, 9, dt);
    if (A.delay > 0) { A.delay -= dt; return true; }
    if (Math.abs(angleDiff(op.yaw, A.yaw)) > 0.03 || Math.abs(A.pitch - op.pitch) > 0.03) return true;
    op.yaw = A.yaw; op.pitch = A.pitch;
    if (!A.noCheck && !B.game.gadgets.canUse(op, A.src)) return true;   // (enfriamiento: espera; el tope de tiempo decide)
    if (A.src === 'gadget') I.gadget = true; else I.ability = true;
    A.pressed = true; A.pt = 0;
    if (A.say) B.sq.radio.say(op, 'kit', A.say, { cooldown: 3 });
    if (A.onPress) A.onPress(B);
    return true;
  }
  A.pt += dt;
  if (placing) { op.yaw = A.yaw; op.pitch = A.pitch; return true; }
  if (A.pt < A.hold) {
    if (A.away && A.pt > 0.2) B._turn(A.yaw + Math.PI, 0, 10, dt);    // darse la vuelta: que no le ciegue la suya
    return true;
  }
  K.act = null;
  if (A.then) A.then(B);
  return false;
}

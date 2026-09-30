// Sensación de juego (F12.1, impactos): las cuentas, sin dibujo ni sonido (se prueban en Node).
// Todo es presentación: la simulación, el daño y los bots no cambian.
import { angleDiff } from '../core/math.js';

export const FEEL = {
  kickMax: 2,          // ° que se sacude la vista al recibir un balazo, como mucho…
  kickPer: 2 / 60,     // …y por punto de daño (60 de daño o más, los 2°)
  kickBack: 0.2,       // s en volver
  ringFrom: 40,        // daño de un golpe a partir del cual pitan los oídos (y se apaga el resto)
  lowHp: 30,           // vida por debajo de la cual: latido y colores apagados
  lowSat: 0.5,         // saturación que se pierde, como mucho (0,95 → 0,45)
  crackDist: 1.5,      // m: una bala que te pasa más cerca suena (chasquido)
  crackFrom: 1.0,      // m desde la boca del arma (si te dispara a quemarropa, lo que suena es el disparo)
  crackGap: 0.05,      // s entre dos chasquidos, como poco
  jolt: 0.05,          // m que da el tirón el cuerpo alcanzado…
  joltT: 0.16,         // …durante estos segundos (sube en 0,04 s y vuelve)
};

/** Cuánto se sacude la vista (grados) por un balazo de `amount`. */
export function hitKick(amount) { return Math.min(FEEL.kickMax, Math.max(0, amount) * FEEL.kickPer); }

/**
 * De dónde viene el daño, visto desde `target`: el ángulo (rad; 0 delante, positivo a la izquierda)
 * y la dirección en pantalla {x (derecha), y (arriba)}.
 */
export function hitSide(target, from) {
  const p = target.body.pos;
  const ang = Math.atan2(-(from.x - p.x), -(from.z - p.z));
  const rel = angleDiff(target.yaw, ang);
  return { rel, x: -Math.sin(rel), y: Math.cos(rel) };
}

/**
 * La sacudida de la vista: hacia arriba y hacia el lado contrario del disparo, y una pizca de
 * inclinación. Devuelve {pitch, yaw, roll} en radianes.
 */
export function kickFrom(amount, side) {
  const k = hitKick(amount) * Math.PI / 180;
  // (girar a la izquierda es sumar al yaw: un disparo desde la derecha te gira hacia la izquierda)
  return { pitch: k * 0.6, yaw: side.x * k * 0.8, roll: side.x * k * 0.5 };
}

/** Poca vida: 0 (nada) … 1 (casi muerto), empezando en 0,4 al bajar de 30. */
export function lowHealth(op) {
  if (!op || op.state !== 'alive' || op.hp >= FEEL.lowHp) return 0;
  return 0.4 + 0.6 * Math.min(1, Math.max(0, (FEEL.lowHp - op.hp) / FEEL.lowHp));
}

/**
 * Una bala que no te ha dado: ¿cuánto pasa de tus ojos `eye`? {dist, at (el punto más cercano)} o
 * null si pasa lejos, si el punto más cercano está a menos de `crackFrom` de la boca del arma o si la
 * bala se paró antes de llegar a tu altura.
 */
export function nearMiss(res, eye, maxDist = FEEL.crackDist) {
  const o = res.origin, d = res.dir, end = res.end;
  const u = (eye.x - o.x) * d.x + (eye.y - o.y) * d.y + (eye.z - o.z) * d.z;
  if (u < FEEL.crackFrom || u > end) return null;
  const at = { x: o.x + d.x * u, y: o.y + d.y * u, z: o.z + d.z * u };
  const dist = Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z);
  return dist < maxDist ? { dist, at } : null;
}

/** El tirón del cuerpo alcanzado, 0…1, a los `t` s del impacto: sube en 0,04 s y vuelve. */
export function joltAt(t) {
  if (t < 0 || t >= FEEL.joltT) return 0;
  const up = 0.04;
  return t < up ? t / up : 1 - (t - up) / (FEEL.joltT - up);
}

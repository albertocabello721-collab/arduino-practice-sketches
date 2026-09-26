// Animaciones de las manos en primera persona (Fase 7.2): inspeccionar el arma, lanzar, sacar el
// dron, colocar un gadget, reforzar, poner una barricada, plantar y desactivar el desactivador y
// reanimar. Poses clave como datos (render/anim.js), con la duración de la acción de la
// simulación (el canal que ya existe: nada tarda más ni menos que antes).
//
// Pistas:
//   pos, rot      desplazamiento y giro del arma (como en la recarga)
//   handL, handR  dónde van las manos, en el espacio de la cámara (adelante -Z)
//   wL, wR        cuánto mandan esas manos sobre las que sujetan el arma (0..1)
//   prop          lo que llevan las manos ('plank', 'defuser', 'gadget' o 'none')
// y, fuera de las pistas: away (el arma se aparta del todo), pulse (empujes o pulsaciones
// repetidas: {hz, L: [x,y,z], R: [x,y,z], from, to}) y loopEnd (la pose final se mantiene).
import { ClipBuilder } from './anim.js';

const Z = [0, 0, 0];
// el arma, apartada y baja (las dos manos quedan libres)
const AWAY_POS = [0.06, -0.42, 0.1], AWAY_ROT = [-0.85, 0.1, 0.1];

function awayGun(C, T, a = 0.22) {
  C.key('pos', 0, Z).key('pos', a, AWAY_POS).key('pos', T, AWAY_POS);
  C.key('rot', 0, Z).key('rot', a, AWAY_ROT).key('rot', T, AWAY_ROT);
}
function bothHands(C, T, keys, a = 0.22) {
  // keys: [t, handL, handR, curva]
  C.key('wL', 0, 0).key('wL', a, 1).key('wR', 0, 0).key('wR', a, 1);
  for (const [t, l, r, e] of keys) { C.key('handL', t, l, e); C.key('handR', t, r, e); }
  C.key('wL', T, 1).key('wR', T, 1);
}

/** Inspeccionar (tecla I): el arma gira para verla por un lado y por el otro. 2,6 s. */
export function inspectClip(pistol = false) {
  const C = new ClipBuilder(), k = pistol ? 0.8 : 1;
  const P1 = [-0.1, 0.05, 0.04], P2 = [-0.05, 0.07, 0.02];
  const R1 = [0.15 * k, 0.85 * k, 0.5 * k], R1b = [0.22 * k, 0.9 * k, 0.45 * k], R2 = [0.35 * k, -0.25 * k, -0.75 * k], R2b = [0.3 * k, -0.2 * k, -0.7 * k];
  C.key('pos', 0, Z).key('pos', 0.45, P1).key('pos', 1.3, P1).key('pos', 1.7, P2).key('pos', 2.3, P2).key('pos', 2.6, Z);
  C.key('rot', 0, Z).key('rot', 0.45, R1).key('rot', 1.3, R1b).key('rot', 1.7, R2).key('rot', 2.3, R2b).key('rot', 2.6, Z);
  return { tracks: C.build(), dur: 2.6 };
}

/** Lanzar (granada o gadget): el lanzamiento ya ha salido; el brazo izquierdo acompaña el tiro. */
export function throwClip() {
  const C = new ClipBuilder();
  C.key('pos', 0, [0.02, -0.06, 0.03]).key('pos', 0.25, [0.03, -0.1, 0.05]).key('pos', 0.55, Z);
  C.key('rot', 0, [-0.2, -0.15, 0.08]).key('rot', 0.25, [-0.3, -0.2, 0.1]).key('rot', 0.55, Z);
  C.key('handL', 0, [-0.1, 0.03, -0.5]).key('handL', 0.2, [-0.07, -0.2, -0.42], 'out').key('handL', 0.4, [-0.22, -0.36, -0.3], 'in');
  C.key('wL', 0, 1).key('wL', 0.4, 1).key('wL', 0.55, 0);
  return { tracks: C.build(), dur: 0.55 };
}

/** Sacar el dron: lanzamiento bajo, por debajo del hombro (el dron ya rueda). */
export function droneClip() {
  const C = new ClipBuilder();
  C.key('pos', 0, [0.02, -0.12, 0.04]).key('pos', 0.3, [0.02, -0.12, 0.04]).key('pos', 0.7, Z);
  C.key('rot', 0, [-0.35, -0.1, 0]).key('rot', 0.7, Z);
  C.key('handL', 0, [-0.06, -0.2, -0.5]).key('handL', 0.25, [-0.05, -0.08, -0.56], 'out').key('handL', 0.5, [-0.22, -0.36, -0.3], 'in');
  C.key('wL', 0, 1).key('wL', 0.5, 1).key('wL', 0.7, 0);
  return { tracks: C.build(), dur: 0.7 };
}

/** Colocar un gadget (canal de la simulación, T s): las dos manos lo llevan adelante, hacia donde miras. */
export function placeClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T);
  bothHands(C, T, [[0.22, [-0.07, -0.14, -0.46], [0.07, -0.14, -0.46]], [T * 0.85, [-0.07, -0.19, -0.64], [0.07, -0.19, -0.64]], [T, [-0.07, -0.18, -0.66], [0.07, -0.18, -0.66]]]);
  C.key('prop', 0, 'gadget');
  return { tracks: C.build(), dur: T, away: true };
}

/** Reforzar (T s): las dos manos empujan el panel, que sube y se asienta. */
export function reinforceClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T);
  bothHands(C, T, [[0.25, [-0.15, -0.1, -0.58], [0.15, -0.1, -0.58]], [T, [-0.15, -0.02, -0.6], [0.15, -0.02, -0.6]]]);
  C.key('prop', 0, 'none');
  return { tracks: C.build(), dur: T, away: true, pulse: { hz: 1.3, L: [0, 0, -0.04], R: [0, 0, -0.04], from: 0.4, to: T } };
}

/** Barricada (T s): las manos suben una tabla a la puerta y la aprietan. */
export function barricadeClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T, 0.18);
  bothHands(C, T, [[0.18, [-0.16, -0.18, -0.5], [0.16, -0.18, -0.5]], [T * 0.6, [-0.16, -0.06, -0.62], [0.16, -0.06, -0.62]], [T, [-0.16, -0.04, -0.66], [0.16, -0.04, -0.66]]], 0.18);
  C.key('prop', 0, 'plank');
  return { tracks: C.build(), dur: T, away: true, pulse: { hz: 2, L: [0, 0, -0.03], R: [0, 0, -0.03], from: T * 0.6, to: T } };
}

/** Plantar (T s): el desactivador baja al suelo y la mano derecha lo programa. */
export function plantClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T);
  const down = Math.min(1.5, T * 0.25);
  bothHands(C, T, [[0.25, [-0.08, -0.14, -0.46], [0.08, -0.14, -0.46]], [down, [-0.09, -0.22, -0.56], [0.08, -0.21, -0.54]], [T, [-0.09, -0.22, -0.56], [0.07, -0.2, -0.55]]]);
  C.key('prop', 0, 'defuser');
  return { tracks: C.build(), dur: T, away: true, pulse: { hz: 3.5, L: Z, R: [0, 0.018, 0], from: down + 0.3, to: T - 0.3 } };
}

/** Desactivar (T s): las manos en el desactivador del suelo; la derecha trabaja. */
export function disableClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T);
  bothHands(C, T, [[0.3, [-0.08, -0.22, -0.58], [0.09, -0.23, -0.56]], [T, [-0.08, -0.23, -0.58], [0.09, -0.23, -0.57]]]);
  C.key('prop', 0, 'none');
  return { tracks: C.build(), dur: T, away: true, pulse: { hz: 2.5, L: Z, R: [0.012, 0.012, -0.01], from: 0.5, to: T - 0.2 } };
}

/** Reanimar (T s): las dos manos en el compañero, presionando con ritmo. */
export function reviveClip(T) {
  const C = new ClipBuilder();
  awayGun(C, T);
  bothHands(C, T, [[0.25, [-0.09, -0.22, -0.55], [0.09, -0.22, -0.55]], [T, [-0.09, -0.23, -0.56], [0.09, -0.23, -0.56]]]);
  C.key('prop', 0, 'none');
  return { tracks: C.build(), dur: T, away: true, pulse: { hz: 1.8, L: [0, -0.03, 0], R: [0, -0.03, 0], from: 0.4, to: T } };
}

/** Clip de la acción de canal `kind` ('reinforce', 'barricade', 'gadget', 'plant', 'disable', 'revive'). */
export function channelClip(kind, T) {
  if (kind === 'reinforce') return reinforceClip(T);
  if (kind === 'barricade') return barricadeClip(T);
  if (kind === 'gadget') return placeClip(T);
  if (kind === 'plant') return plantClip(T);
  if (kind === 'disable') return disableClip(T);
  if (kind === 'revive') return reviveClip(T);
  return null;
}

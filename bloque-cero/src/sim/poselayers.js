// Capas de la pose en tercera persona (Fase 7.4): la recarga por partes y lo que hacen las manos
// (reforzar, barricada, colocar un gadget, plantar, desactivar, reanimar, lanzar, sacar el dron y
// saltar un obstáculo). Son datos y funciones puras (sin Three.js) que usa computePose; como esa
// pose es también la de las zonas de impacto, los brazos que se ven son los que reciben las balas.
//
// Espacio del pecho: adelante -Z, derecha +X, arriba +Y (como en skeleton.js).
// Espacio del arma: la empuñadura en el origen y el cañón hacia -Z.

export const ACT_BLEND = 0.15;                    // mezcla al entrar y salir de una capa, en segundos
export const THROW_ANIM = 0.55, DRONE_ANIM = 0.7;  // lo que dura el gesto (el objeto ya salió)
// acciones mantenidas de la simulación (op.channel.kind) que se hacen con las dos manos
export const HAND_CHANNELS = { reinforce: true, barricade: true, gadget: true, plant: true, disable: true };

export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// ------------------------------------------------------------------ recarga por partes
// Puntos a los que va la mano izquierda: en el espacio del arma (g) o del pecho (c); 'fore' es el
// guardamanos (la pose de siempre).
const ANCHORS = {
  fore: null,
  mag: { g: [0, -0.2, -0.09] }, magLow: { g: [0, -0.28, -0.08] }, drop: { g: [0.02, -0.34, -0.03] },
  pouch: { c: [-0.1, -0.1, -0.17] },
  handle: { g: [-0.05, 0.06, -0.1] }, handleBack: { g: [-0.05, 0.06, -0.02] },
  pgrip: { g: [0, -0.16, 0.02] }, pgripLow: { g: [0, -0.24, 0.03] }, slide: { g: [0, 0.07, 0.02] }, slideBack: { g: [0, 0.07, 0.08] },
  cover: { g: [0, 0.1, -0.14] }, coverUp: { g: [0, 0.19, -0.1] }, box: { g: [-0.02, -0.14, -0.12] }, boxLow: { g: [-0.02, -0.24, -0.1] }, beltFeed: { g: [0.02, 0.08, -0.2] },
  cyl: { g: [0, 0.0, -0.05] },
  port: { g: [0, -0.07, -0.12] }, shellPouch: { c: [-0.13, -0.32, -0.08] }, pump: { g: [0, -0.05, -0.28] }, pumpBack: { g: [0, -0.05, -0.19] },
};
export const RELOAD_ANCHORS = ANCHORS;
const PISTOLISH = { pistol: true, revolver: true, mpistol: true };

/**
 * Pista de la recarga en tercera persona a partir del plan de la simulación (weapons.js,
 * reloadPlan): por dónde va la mano izquierda, cuánto se inclina el arma y qué pasa con el
 * cargador (sale, se coge el nuevo, entra). Se calcula una vez por recarga.
 */
export function reloadTrack(plan, model) {
  const at = (name) => { const p = plan.parts.find((q) => q.part === name); return p ? p.at : null; };
  const T = plan.total, keys = [[0, 'fore']], tilt = [[0, 0, 0]];
  let mag = null;          // {out, pick, in}: instantes del cargador (out < 0: ya estaba fuera)
  const fam = plan.family;
  if (fam === 'mag') {
    const pist = !!PISTOLISH[model], M = pist ? 'pgrip' : 'mag', ML = pist ? 'pgripLow' : 'magLow';
    const tOut = at('magOut'), tIn = at('magIn'), tSlap = at('slap'), tBolt = at('bolt');
    const pick = tOut != null ? (tOut + tIn) / 2 : tIn * 0.45;
    if (tOut != null) keys.push([Math.max(0.05, tOut - 0.16), M], [tOut, M], [tOut + 0.12, 'drop']);
    keys.push([pick, 'pouch'], [tIn - 0.12, ML], [tIn, M]);
    if (tSlap != null) keys.push([tSlap - 0.06, ML], [tSlap, M]);
    if (tBolt != null) keys.push([tBolt - 0.15, pist ? 'slide' : 'handle'], [tBolt, pist ? 'slideBack' : 'handleBack']);
    keys.push([T, 'fore']);
    const t0 = Math.max(0.05, (tOut != null ? tOut : pick) - 0.2);
    tilt.push([t0, pist ? 0.35 : 0.45, 0.1], [T - 0.2, pist ? 0.35 : 0.45, 0.1], [T, 0, 0]);
    mag = { out: tOut != null ? tOut : -1, pick, in: tIn };
  } else if (fam === 'belt') {
    const tOpen = at('open'), tOut = at('magOut'), tIn = at('magIn'), tBelt = at('belt'), tClose = at('close'), tBolt = at('bolt');
    const pick = tOut != null ? (tOut + tIn) / 2 : tIn * 0.45;
    keys.push([Math.max(0.05, tOpen - 0.12), 'cover'], [tOpen + 0.1, 'coverUp']);
    if (tOut != null) keys.push([tOut - 0.12, 'box'], [tOut, 'box'], [tOut + 0.14, 'drop']);
    keys.push([pick, 'pouch'], [tIn - 0.14, 'boxLow'], [tIn, 'box'], [tBelt - 0.12, 'beltFeed'], [tBelt, 'beltFeed'],
      [tClose - 0.12, 'coverUp'], [tClose, 'cover']);
    if (tBolt != null) keys.push([tBolt - 0.12, 'handle'], [tBolt, 'handleBack']);
    keys.push([T, 'fore']);
    tilt.push([Math.max(0.05, tOpen - 0.1), 0.25, 0.05], [T - 0.25, 0.25, 0.05], [T, 0, 0]);
    mag = { out: tOut != null ? tOut : -1, pick, in: tIn };
  } else if (fam === 'cyl') {
    const tOpen = at('open'), tEject = at('eject'), tIn = at('magIn'), tClose = at('close');
    const pick = (tEject + tIn) / 2;
    keys.push([tOpen, 'cyl'], [tEject, 'cyl'], [pick, 'pouch'], [tIn, 'cyl'], [tClose, 'cyl'], [T, 'fore']);
    // al vaciar el tambor, la boca arriba (caen los casquillos)
    tilt.push([tOpen, 0.5, 0], [tEject, 0.2, 0.9], [tEject + 0.18, 0.35, 0.15], [tClose, 0.35, 0], [T, 0, 0]);
  } else {
    // escopeta: cartucho a cartucho, del cinturón a la ventana; y bombear si estaba vacía
    const shells = plan.parts.filter((p) => p.part === 'shell').map((p) => p.at), tPump = at('pump');
    for (const ts of shells) keys.push([Math.max(0.05, ts - 0.3), 'shellPouch'], [ts - 0.05, 'port'], [ts, 'port']);
    if (tPump != null) keys.push([tPump - 0.12, 'pump'], [tPump, 'pumpBack']);
    keys.push([T, 'fore']);
    tilt.push([0.25, 0.6, 0.05], [Math.max(0.3, T - 0.2), 0.6, 0.05], [T, 0, 0]);
  }
  // (instantes crecientes: una parte muy temprana no puede ir antes que la anterior)
  for (let i = 1; i < keys.length; i++) keys[i][0] = Math.max(keys[i][0], keys[i - 1][0] + 0.02);
  for (let i = 1; i < tilt.length; i++) tilt[i][0] = Math.max(tilt[i][0], tilt[i - 1][0] + 0.02);
  return { plan, family: fam, total: T, keys, tilt, mag };
}

// tramo de una pista en el instante t: [índice, fracción suavizada]
function seg(keys, t) {
  if (t <= keys[0][0]) return [0, 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i][0], b = keys[i + 1][0];
    if (t < b) return [i, smooth((t - a) / (b - a))];
  }
  return [keys.length - 2, 1];
}

/** Inclinación del arma en la recarga: {roll, pitch} (radianes). */
export function reloadTilt(track, t) {
  const K = track.tilt;
  if (K.length < 2) return { roll: 0, pitch: 0 };
  const [i, u] = seg(K, t);
  return { roll: K[i][1] + (K[i + 1][1] - K[i][1]) * u, pitch: K[i][2] + (K[i + 1][2] - K[i][2]) * u };
}

/**
 * Dónde va la mano izquierda en el instante t de la recarga. `toWorld(anchor)` pasa un punto de
 * ANCHORS (o null: el guardamanos) al mundo; devuelve un punto {x, y, z}.
 */
export function reloadHand(track, t, toWorld) {
  const K = track.keys;
  const [i, u] = seg(K, t);
  const a = toWorld(ANCHORS[K[i][1]]), b = toWorld(ANCHORS[K[i + 1][1]]);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
}

/** El cargador en el instante t: 0 en el arma · 1 el nuevo, en la mano · 2 fuera (se soltó). */
export function reloadMag(track, t) {
  const m = track.mag;
  if (!m) return 0;
  if (t >= m.in) return 0;
  if (t >= m.pick) return 1;
  return m.out < 0 || t >= m.out ? 2 : 0;
}

// ------------------------------------------------------------------ acciones de las manos
// Pose de cada acción en su instante t (de dur): manos en el espacio del pecho (L, R, o null para
// no tocarlas) con su peso, cuánto se aparta el arma (away: cuelga al costado derecho), cuánto se
// inclina el tronco hacia delante (bend, radianes) y cuánto baja la cadera (lower, metros). (Con las
// acciones mantenidas la simulación ya lo agacha: Operator, «se arrodilla para plantar».)
const pulse = (t, hz) => 0.5 - 0.5 * Math.cos(t * hz * Math.PI * 2);
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function path(keys, t) {
  // keys: [[t, [x, y, z]], ...]
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t < keys[i + 1][0]) return lerp3(keys[i][1], keys[i + 1][1], smooth((t - keys[i][0]) / (keys[i + 1][0] - keys[i][0])));
  }
  return keys[keys.length - 1][1];
}

export function actionPose(kind, t, dur) {
  const u = dur > 0 ? Math.min(1, t / dur) : 1;
  switch (kind) {
    case 'reinforce': {          // las dos manos empujan el panel contra la pared
      const p = pulse(Math.max(0, t - 0.3), 1.3) * 0.04;
      return { L: [-0.15, 0.08, -0.5 - p], R: [0.15, 0.08, -0.5 - p], wL: 1, wR: 1, away: 1, bend: 0.08, lower: 0 };
    }
    case 'barricade': {          // suben la tabla a la puerta y la aprietan
      const up = smooth(u / 0.6), p = u > 0.6 ? pulse(t, 2) * 0.03 : 0;
      return { L: [-0.2, -0.08 + 0.12 * up, -0.44 - p], R: [0.2, -0.08 + 0.12 * up, -0.44 - p], wL: 1, wR: 1, away: 1, bend: 0.05, lower: 0 };
    }
    case 'gadget': {             // lo llevan hacia abajo, delante
      const y = -0.26 - 0.18 * smooth(u);
      return { L: [-0.07, y, -0.42], R: [0.07, y, -0.42], wL: 1, wR: 1, away: 1, bend: 0.35, lower: 0 };
    }
    case 'plant': {              // el desactivador al suelo; la mano derecha lo programa
      const p = u > 0.25 ? pulse(t, 3.5) * 0.02 : 0;
      return { L: [-0.09, -0.46, -0.42], R: [0.08, -0.44 + p, -0.4], wL: 1, wR: 1, away: 1, bend: 0.4, lower: 0 };
    }
    case 'disable': {            // las manos en el desactivador; la derecha trabaja
      const p = pulse(t, 2.5) * 0.02;
      return { L: [-0.08, -0.47, -0.44], R: [0.09 + p * 0.5, -0.45 + p, -0.42], wL: 1, wR: 1, away: 1, bend: 0.4, lower: 0 };
    }
    case 'revive': {             // las dos manos en el compañero, presionando con ritmo
      const p = pulse(Math.max(0, t - 0.4), 1.8) * 0.035;
      return { L: [-0.1, -0.44 - p, -0.38], R: [0.1, -0.44 - p, -0.38], wL: 1, wR: 1, away: 1, bend: 0.45, lower: 0 };
    }
    case 'throw': {              // (ya lanzado) el brazo izquierdo acompaña el tiro y vuelve
      const L = path([[0, [-0.08, 0.3, -0.46]], [0.2, [-0.12, 0.06, -0.42]], [0.4, [-0.22, -0.3, -0.12]]], t);
      return { L, R: null, wL: t < 0.4 ? 1 : 1 - smooth((t - 0.4) / 0.15), wR: 0, away: 0, bend: 0.12 * (1 - smooth(t / 0.4)), lower: 0 };
    }
    case 'drone': {              // lanzamiento bajo, por debajo del hombro
      const L = path([[0, [-0.08, -0.42, -0.36]], [0.3, [-0.1, -0.2, -0.36]], [0.5, [-0.2, -0.3, -0.14]]], t);
      return { L, R: null, wL: t < 0.5 ? 1 : 1 - smooth((t - 0.5) / 0.2), wR: 0, away: 0, bend: 0.28 * (1 - smooth(t / 0.5)), lower: 0 };
    }
    case 'vault': {              // la mano izquierda se apoya en el obstáculo
      const k = Math.sin(Math.PI * u);
      return { L: [-0.12, -0.36, -0.34], R: null, wL: smooth(Math.min(1, k * 2)), wR: 0, away: 0, bend: 0.35 * k, lower: 0 };
    }
    default: return null;
  }
}

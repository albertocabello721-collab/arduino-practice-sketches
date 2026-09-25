// Arsenal (datos) y estado de cada arma en mano. Valores de la tabla WEAPONS del
// documento (sección 8): daño, cadencia, cargador (+1 en recámara con la recarga
// táctica), recarga táctica / vacía, caída de daño por distancia y tiempo de apuntado.
//   falloff: [inicio de la caída (m), fin (m), multiplicador mínimo]
//     fusiles 100 % hasta 25 m y 75 % desde 35 m · subfusiles de 20 a 30 m ·
//     escopetas de 5 a 15 m hasta el 30 %.
//   Penetración: una pared blanda (2 vóxeles de pladur) deja pasar el 70 % del daño; un
//     mueble de madera, el 80 %; hormigón, metal y muros reforzados la paran.
//   Cabeza: baja inmediata (los perdigones, ×1,5). Torso ×1. Extremidades ×0,75.
//   Retroceso con patrón fijo por arma (recoilPattern): los 3 primeros disparos casi
//     verticales y luego una deriva a izquierda y derecha que se puede aprender, con un
//     poco de azar. Se recupera al dejar de disparar. Agachado −10 %, tumbado −20 %.
//   Modos de disparo (B): automático, ráfaga de 3 y tiro a tiro según el arma.
//   Recarga por partes (reloadPlan): la munición cambia en su parte, no al final.

// Penetración común: 2 vóxeles de pladur (coste 0,07 cada uno) → 70 % del daño.
const PEN = 0.07 * 2 / 0.3;

export const WEAPONS = {
  // ---------------- fusiles de asalto
  ar: {
    id: 'ar', name: 'FA-7 Halcón', kind: 'Fusil de asalto', cls: 'rifle', auto: true, modes: ['auto', 'burst', 'semi'], rpm: 780, damage: 44, pellets: 1,
    mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.1, equip: 0.55, adsTime: 0.34, adsZoom: 1.3,
    spreadHip: 2.4, spreadAds: 0.05, spreadMove: 1.8, bloom: 0.35,
    recoil: { v: 0.56, h: 0.34, first: 1.35, jitter: 0.1, seed: 1 },
    penetration: PEN, extraBreak: 0, falloff: [25, 35, 0.75], range: 120, sound: 'rifle', model: 'ar',
  },
  ar2: {
    id: 'ar2', name: 'FA-9 Lince', kind: 'Fusil de asalto', cls: 'rifle', auto: true, modes: ['auto', 'burst', 'semi'], rpm: 860, damage: 39, pellets: 1,
    mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 3.0, equip: 0.55, adsTime: 0.32, adsZoom: 1.4,
    spreadHip: 2.5, spreadAds: 0.05, spreadMove: 1.8, bloom: 0.33,
    recoil: { v: 0.5, h: 0.4, first: 1.3, jitter: 0.1, seed: 2 },
    penetration: PEN, extraBreak: 0, falloff: [25, 35, 0.75], range: 120, sound: 'rifle', model: 'ar2',
  },
  // ---------------- subfusiles
  smg: {
    id: 'smg', name: 'SF-45 Avispa', kind: 'Subfusil', cls: 'smg', auto: true, modes: ['auto', 'burst', 'semi'], rpm: 870, damage: 33, pellets: 1,
    mag: 30, reserve: 180, reload: 2.1, reloadEmpty: 2.8, equip: 0.45, adsTime: 0.27, adsZoom: 1.15,
    spreadHip: 2.0, spreadAds: 0.08, spreadMove: 1.2, bloom: 0.3,
    recoil: { v: 0.45, h: 0.44, first: 1.25, jitter: 0.12, seed: 3 },
    penetration: PEN, extraBreak: 0, falloff: [20, 30, 0.7], range: 100, sound: 'smg', model: 'smg',
  },
  smg2: {
    id: 'smg2', name: 'SF-9 Mamba', kind: 'Subfusil', cls: 'smg', auto: true, modes: ['auto', 'semi'], rpm: 950, damage: 27, pellets: 1,
    mag: 40, reserve: 200, reload: 2.2, reloadEmpty: 2.9, equip: 0.42, adsTime: 0.25, adsZoom: 1.12,
    spreadHip: 2.1, spreadAds: 0.09, spreadMove: 1.1, bloom: 0.25,
    recoil: { v: 0.38, h: 0.5, first: 1.2, jitter: 0.12, seed: 4 },
    penetration: PEN, extraBreak: 0, falloff: [20, 30, 0.7], range: 90, sound: 'smg', model: 'smg2',
  },
  // ---------------- ametralladora ligera
  lmg: {
    id: 'lmg', name: 'AL-60 Oso', kind: 'Ametralladora ligera', cls: 'lmg', auto: true, modes: ['auto', 'semi'], rpm: 700, damage: 47, pellets: 1,
    mag: 80, reserve: 160, reload: 5.0, reloadEmpty: 5.0, noChamber: true, equip: 0.8, adsTime: 0.45, adsZoom: 1.35,
    spreadHip: 3.4, spreadAds: 0.1, spreadMove: 2.6, bloom: 0.35,
    recoil: { v: 0.5, h: 0.46, first: 1.3, jitter: 0.12, seed: 5 },
    penetration: PEN, extraBreak: 0.15, falloff: [25, 35, 0.75], range: 140, sound: 'rifle', model: 'lmg',
  },
  // ---------------- tirador semiautomático
  dmr: {
    id: 'dmr', name: 'T-308 Búho', kind: 'Tirador semiautomático', cls: 'dmr', auto: false, modes: ['semi'], rpm: 380, damage: 67, pellets: 1,
    mag: 10, reserve: 60, reload: 2.6, reloadEmpty: 3.3, equip: 0.6, adsTime: 0.4, adsZoom: 2.2,
    spreadHip: 3.0, spreadAds: 0.02, spreadMove: 2.4, bloom: 0.6,
    recoil: { v: 2.0, h: 0.3, first: 1.0, jitter: 0.1, seed: 6 },
    penetration: PEN, extraBreak: 0.1, falloff: [30, 45, 0.8], range: 180, sound: 'rifle', model: 'dmr',
  },
  // ---------------- escopeta (8 perdigones de 22)
  shotgun: {
    id: 'shotgun', name: 'E-12 Toro', kind: 'Escopeta de bombeo', cls: 'shotgun', auto: false, modes: ['semi'], rpm: 70, damage: 22, pellets: 8,
    mag: 7, reserve: 35, reload: 0.55, reloadEmpty: 0.55, perShell: true, equip: 0.6, adsTime: 0.3, adsZoom: 1.1,
    spreadHip: 5.2, spreadAds: 3.6, spreadMove: 1.0, bloom: 0,
    recoil: { v: 3.0, h: 0.8, first: 1.0, jitter: 0.15, seed: 7 },
    penetration: PEN, extraBreak: 0.7, falloff: [5, 15, 0.3], range: 60, sound: 'shotgun', model: 'shotgun',
  },
  // ---------------- secundarias
  pistol: {
    id: 'pistol', name: 'P-9 Colibrí', kind: 'Pistola', cls: 'pistol', auto: false, modes: ['semi'], rpm: 450, damage: 42, pellets: 1,
    mag: 15, reserve: 60, reload: 1.6, reloadEmpty: 2.1, equip: 0.35, adsTime: 0.25, adsZoom: 1.15,
    spreadHip: 1.8, spreadAds: 0.1, spreadMove: 1.0, bloom: 0.5,
    recoil: { v: 1.3, h: 0.35, first: 1.0, jitter: 0.12, seed: 8 },
    penetration: PEN, extraBreak: 0, falloff: [15, 25, 0.7], range: 80, sound: 'pistol', model: 'pistol',
  },
  revolver: {
    id: 'revolver', name: 'R-44 Tejón', kind: 'Revólver', cls: 'pistol', auto: false, modes: ['semi'], rpm: 150, damage: 70, pellets: 1,
    mag: 6, reserve: 30, reload: 2.8, reloadEmpty: 2.8, noChamber: true, equip: 0.45, adsTime: 0.28, adsZoom: 1.2,
    spreadHip: 2.2, spreadAds: 0.08, spreadMove: 1.2, bloom: 0.9,
    recoil: { v: 3.4, h: 0.5, first: 1.0, jitter: 0.12, seed: 9 },
    penetration: PEN, extraBreak: 0.1, falloff: [15, 25, 0.7], range: 90, sound: 'pistol', model: 'revolver',
  },
  mpistol: {
    id: 'mpistol', name: 'PA-3 Tábano', kind: 'Pistola ametralladora', cls: 'pistol', auto: true, modes: ['auto', 'semi'], rpm: 1100, damage: 22, pellets: 1,
    mag: 20, reserve: 100, reload: 1.9, reloadEmpty: 2.4, equip: 0.35, adsTime: 0.25, adsZoom: 1.1,
    spreadHip: 2.6, spreadAds: 0.15, spreadMove: 1.2, bloom: 0.2,
    recoil: { v: 0.55, h: 0.6, first: 1.15, jitter: 0.14, seed: 10 },
    penetration: PEN, extraBreak: 0, falloff: [20, 30, 0.7], range: 70, sound: 'smg', model: 'mpistol',
  },
};

export const FIRE_MODE_NAME = { auto: 'Automático', burst: 'Ráfaga', semi: 'Tiro a tiro' };
export const BURST = 3;

// Multiplicador de daño por distancia.
export function falloffAt(def, dist) {
  const [a, b, min] = def.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 + (min - 1) * ((dist - a) / (b - a));
}

/**
 * Patrón fijo de retroceso: {up, side} en grados para el disparo `i` (0 = el primero)
 * de una ráfaga, antes del azar. Los 3 primeros casi verticales; luego una deriva a
 * izquierda y derecha propia de cada arma.
 */
export function recoilPattern(def, i) {
  const R = def.recoil;
  if (!R) return { up: 0, side: 0 };
  const up = R.v * (i === 0 ? R.first : 1);
  if (i < 3) return { up, side: R.h * 0.08 * (i === 1 ? 1 : -1) * (R.seed % 2 ? 1 : -1) };
  const k = i - 3, ph = R.seed * 1.7;
  const side = R.h * (Math.sin(k * 0.55 + ph) * 0.85 + Math.sin(k * 1.35 + ph * 2) * 0.35);
  return { up: up * (0.9 + 0.1 * Math.cos(k * 0.8 + ph)), side };
}

// ------------------------------------------------------------ recarga por partes (Fase 7.1)
// Cada recarga es una lista de partes con su momento (s desde que empieza). La munición cambia
// en su parte: al sacar el cargador se pierde con las balas que llevaba (queda la de la
// recámara) y al meter el nuevo, cuentan las suyas. Si se interrumpe entre medias, el arma se
// queda como esté en ese momento. La animación en primera persona usa los mismos momentos.
//   'mag'   fusiles, subfusiles, tirador y pistolas: cargador fuera, cargador dentro, golpe con
//           la palma y, en la vacía, cerrojo (en las pistolas, soltar la corredera).
//   'belt'  AL-60: abrir la tapa, caja fuera, caja nueva, cinta, cerrar y, vacía, palanca.
//   'cyl'   R-44: abrir el tambor, fuera casquillos y balas, cargador rápido y cerrar.
//   'shell' E-12: cartucho a cartucho (0,55 s cada uno; se interrumpe disparando). Si estaba
//           vacía, bombea al final.
export function reloadFamily(def) {
  if (def.perShell) return 'shell';
  if (def.model === 'revolver') return 'cyl';
  if (def.cls === 'lmg') return 'belt';
  return 'mag';
}

/** Partes de una recarga que empieza con `ammo` en el arma y `reserve` de reserva. */
export function reloadPlan(def, ammo, reserve, magOut = false) {
  const family = reloadFamily(def), empty = ammo === 0;
  const parts = [];
  const add = (at, part) => { if (!(magOut && part === 'magOut')) parts.push({ at, part }); };
  let total;
  if (family === 'shell') {
    const need = Math.max(0, Math.min(def.mag - ammo, reserve));
    total = 0.3 + need * def.reload;
    for (let i = 0; i < need; i++) add(0.6 + i * def.reload, 'shell');
    if (empty) add(total - 0.12, 'pump');
  } else if (family === 'cyl') {
    total = def.reload;
    add(0.12 * total, 'open'); add(0.26 * total, 'eject'); add(0.6 * total, 'magIn'); add(0.78 * total, 'close');
  } else if (family === 'belt') {
    total = empty ? def.reloadEmpty : def.reload;
    add(0.1 * total, 'open'); add(0.28 * total, 'magOut'); add(0.56 * total, 'magIn'); add(0.7 * total, 'belt'); add(0.82 * total, 'close');
    if (empty) add(0.92 * total, 'bolt');
  } else if (empty) {
    total = def.reloadEmpty;
    add(0.2 * total, 'magOut'); add(0.53 * total, 'magIn'); add(0.6 * total, 'slap'); add(0.82 * total, 'bolt');
  } else {
    total = def.reload;
    add(0.25 * total, 'magOut'); add(0.66 * total, 'magIn'); add(0.74 * total, 'slap');
  }
  return { family, empty, total, parts };
}

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.ammo = def.mag;
    this.reserve = def.reserve;
    this.cooldown = 0;
    this.reloadT = 0;          // tiempo restante de recarga (>0 recargando)
    this.reloadTotal = 0;
    this.plan = null;          // partes de la recarga en curso (reloadPlan)
    this.partIdx = 0;          // la siguiente parte por hacer
    this.magOut = false;       // sin cargador: se interrumpió la recarga tras sacarlo
    this.lost = 0;             // balas perdidas con los cargadores sacados
    this.equipT = 0;           // tiempo restante de desenfunde
    this.bloom = 0;            // dispersión acumulada por disparo
    this.shotsInBurst = 0;
    this.triggerHeld = false;
    this.burstLeft = 0;        // disparos que quedan de la ráfaga en curso
    this.mode = (def.modes && def.modes[0]) || (def.auto ? 'auto' : 'semi');
  }
  get reloading() { return this.reloadT > 0; }
  get ready() { return this.reloadT <= 0 && this.equipT <= 0; }
  /** Cambia al siguiente modo de disparo del arma (B). Devuelve el nuevo modo. */
  cycleMode() {
    const modes = this.def.modes || [this.mode];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    return this.mode;
  }
  get capacity() { return this.def.pellets === 1 && !this.def.noChamber ? this.def.mag + 1 : this.def.mag; }
  startReload() {
    if (this.reloadT > 0 || this.reserve <= 0) return false;
    if (this.ammo >= this.capacity || (this.ammo >= this.def.mag && (this.def.pellets > 1 || this.def.noChamber))) return false;
    this.plan = reloadPlan(this.def, this.ammo, this.reserve, this.magOut);
    this.partIdx = 0;
    this.reloadTotal = this.plan.total;
    this.reloadT = this.reloadTotal;
    return true;
  }
  /**
   * Avanza la recarga `dt` s y hace las partes a las que llega (las añade a `out`, si se da).
   * Devuelve true cuando termina.
   */
  tickReload(dt, out = null) {
    this.reloadT -= dt;
    const P = this.plan, el = this.reloadTotal - this.reloadT;
    while (P && this.partIdx < P.parts.length && P.parts[this.partIdx].at <= el + 1e-6) {
      const part = P.parts[this.partIdx++].part;
      this._part(part);
      if (out) out.push(part);
    }
    if (this.reloadT > 0) return false;
    this.reloadT = 0; this.plan = null;
    return true;
  }
  _part(part) {
    const d = this.def;
    if (part === 'magOut' || part === 'eject') {
      // el cargador sacado (o lo que quedara en el tambor) se pierde con sus balas; la de la
      // recámara se queda (táctica: 30+1)
      const chamber = this.ammo > 0 && d.pellets === 1 && !d.noChamber ? 1 : 0;
      this.lost += this.ammo - chamber;
      this.ammo = chamber;
      this.magOut = true;
    } else if (part === 'magIn') {
      const take = Math.min(d.mag, this.reserve);
      this.ammo += take; this.reserve -= take;
      this.magOut = false;
    } else if (part === 'shell') {
      if (this.reserve > 0 && this.ammo < d.mag) { this.ammo++; this.reserve--; }
    }
  }
  /** Interrumpir la recarga: lo hecho, hecho está (cartuchos metidos, cargador fuera o dentro). */
  cancelReload() { this.reloadT = 0; this.plan = null; }
  refill() { this.ammo = this.def.mag; this.reserve = this.def.reserve; this.reloadT = 0; this.plan = null; this.magOut = false; this.lost = 0; this.cooldown = 0; this.bloom = 0; this.burstLeft = 0; this.queuedShot = false; }
}

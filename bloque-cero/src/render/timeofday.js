// La hora del día (F12.5): día, atardecer o noche. Solo cambia cómo se ve y cómo suena el ambiente;
// la simulación, las reglas y lo que ven y oyen los bots son los mismos a cualquier hora.
//  · día: la luz de siempre (estos valores son los de antes de la F12.5);
//  · atardecer: sol bajo y naranja, cielo morado y las farolas encendidas;
//  · noche: luna fría con estrellas, las farolas de la calle y las lámparas de la casa.

export const TIMES_ORDER = ['dia', 'atardecer', 'noche'];

const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

export const TIMES = {
  dia: {
    label: 'Día',
    sunDir: null,                          // la del mapa
    sunColor: [1.95, 1.76, 1.52], skyColor: [0.33, 0.41, 0.56], groundColor: [0.2, 0.18, 0.15],
    fogColor: [0.42, 0.48, 0.56], fogDensity: 0.0045,
    zenith: [0.1, 0.2, 0.46], horizon: [0.46, 0.5, 0.56], sunDisk: [1.2, 1.05, 0.85], moon: 0, stars: 0,
    skyLight: 1,                            // cuánto cuenta el cielo para la exposición automática
    exposure: 1,                            // y cuánto se deja compensar (menos: se ve más oscuro)
    streetLamps: false,                     // las farolas de la calle alumbran
    ambience: { birds: 1, cars: 1, crickets: 0 },
  },
  atardecer: {
    label: 'Atardecer',
    sunDir: norm(-0.62, 0.23, -0.75),
    sunColor: [1.85, 0.98, 0.5], skyColor: [0.25, 0.22, 0.3], groundColor: [0.17, 0.12, 0.09],
    fogColor: [0.5, 0.38, 0.34], fogDensity: 0.005,
    zenith: [0.12, 0.12, 0.3], horizon: [0.86, 0.5, 0.32], sunDisk: [1.5, 0.72, 0.34], moon: 0, stars: 0,
    skyLight: 0.6,
    exposure: 0.66,
    streetLamps: true,
    ambience: { birds: 0.45, cars: 0.8, crickets: 0.4 },
  },
  noche: {
    label: 'Noche',
    sunDir: norm(0.42, 0.62, -0.66),       // la luna
    sunColor: [0.2, 0.25, 0.4], skyColor: [0.05, 0.065, 0.12], groundColor: [0.02, 0.02, 0.028],
    fogColor: [0.035, 0.045, 0.07], fogDensity: 0.006,
    zenith: [0.006, 0.012, 0.035], horizon: [0.035, 0.045, 0.08], sunDisk: [0.55, 0.6, 0.72], moon: 1, stars: 1,
    skyLight: 0.14,
    exposure: 0.72,
    streetLamps: true,
    ambience: { birds: 0, cars: 0.3, crickets: 1 },
  },
};

export const timeOf = (key) => TIMES[key] || TIMES.dia;

/** Las luces del mapa a esa hora: las farolas de la calle, solo al atardecer y de noche. */
export function lightsFor(map, key) {
  const T = timeOf(key);
  return map.lights.filter((l) => T.streetLamps || !l.street);
}

// Siluetas de los operadores (Fase 7.3): la complexión según el blindaje y el objeto propio de
// cada uno, como datos, para reconocerlo de lejos entre los 8 de su bando. Cada pieza va pegada a
// un hueso del esqueleto (piel rígida, como el resto del cuerpo): ni huesos nuevos ni llamadas de
// dibujo de más.
//
// Pieza: [hueso, forma, opciones]
//   forma     ['box', ancho, alto, fondo] · ['cyl', radio arriba, radio abajo, alto, lados] ·
//             ['sph', radio, lados, anillos, desde, arco]
//   opciones  at, rot, scale, color, rough, metal y gear: equipo que sobresale del cuerpo
//             (mochilas, antenas, botes…), que no es zona de impacto, igual que la mochila de siempre
// Espacio de cada hueso (sim/skeleton.js): tronco y cabeza, adelante -Z y derecha +X; brazos y
// piernas, adelante +Z y +X hacia la izquierda del personaje.
//
// Colores: ninguno azul ni naranja (el equipo se lee por el brazalete, el parche y la baliza).
import { BONE } from '../sim/skeleton.js';

const box = (w, h, d) => ['box', w, h, d];
const cyl = (r1, r2, h, s = 8) => ['cyl', r1, r2, h, s];
const sph = (r, ws, hs, ts = 0, tl = Math.PI) => ['sph', r, ws, hs, ts, tl];

export const KIT_COLORS = {
  black: '#141516', dark: '#2a2d30', steel: '#5f656b', light: '#b3b8bc', olive: '#4d5340',
  tan: '#6f634a', brown: '#3b3127', yellow: '#dcbc2e', red: '#c9281e', white: '#e6e6e1', green: '#3e6c47',
  glass: '#101418', tank: '#566540', screen: '#1d3a2a', led: '#5fcf58', sand: '#8a7f5c', sage: '#7b8060',
};
const C = KIT_COLORS;
const CH = BONE.chest, HD = BONE.head, PV = BONE.pelvis;
const HALF_PI = Math.PI / 2;
// punto a lo largo de un tubo girado `a` en Z (el eje local Y queda en (-sin a, cos a))
const along = (c, a, t) => [c[0] - Math.sin(a) * t, c[1] + Math.cos(a) * t, c[2]];

// Complexión según el blindaje (1 ligero, 2 medio, 3 pesado): medidas del chaleco y qué lleva.
export const BUILDS = {
  1: { vest: [0.38, 0.23, 0.23], band: [0.33, 0.12, 0.23], pouches: [-0.06, 0.06], plate: null, pads: false },
  2: { vest: [0.4, 0.25, 0.27], band: [0.35, 0.14, 0.25], pouches: [-0.095, 0, 0.095], plate: [0.31, 0.22, 0.045, -0.14], pads: true },
  3: { vest: [0.43, 0.27, 0.29], band: [0.37, 0.16, 0.27], pouches: [-0.095, 0, 0.095], plate: [0.33, 0.24, 0.05, -0.14], pads: true, heavy: true },
};

/**
 * Objeto propio de cada operador de la plantilla.
 *   look   cambios de cabeza o de cara ('heavy', 'boonie', 'gas1', 'gas2', 'monocle'; nvg: false)
 *   pack   false si su objeto sustituye a la mochila de siempre
 *   parts  (aspecto) => lista de piezas
 */
export const KITS = {
  // ---------------------------------------------------------------- ataque
  // TERMO: gafas de soldador levantadas sobre el casco y el marco de la carga térmica a la espalda
  termo: {
    look: { face: 'none', nvg: false },
    pack: false,
    parts: () => [
      [HD, box(0.2, 0.03, 0.03), { at: [0, 0.205, -0.098], rot: [-0.55, 0, 0], color: C.black, rough: 0.6 }],
      [HD, cyl(0.03, 0.03, 0.028, 8), { at: [-0.047, 0.212, -0.112], rot: [-HALF_PI + 0.55, 0, 0], color: C.glass, rough: 0.1, metal: 0.4 }],
      [HD, cyl(0.03, 0.03, 0.028, 8), { at: [0.047, 0.212, -0.112], rot: [-HALF_PI + 0.55, 0, 0], color: C.glass, rough: 0.1, metal: 0.4 }],
      [CH, box(0.58, 0.055, 0.05), { at: [0, 0.64, 0.19], color: C.light, rough: 0.45, metal: 0.5, gear: true }],
      [CH, box(0.58, 0.05, 0.05), { at: [0, -0.1, 0.19], color: C.light, rough: 0.45, metal: 0.5, gear: true }],
      [CH, box(0.055, 0.74, 0.05), { at: [-0.262, 0.27, 0.19], color: C.light, rough: 0.45, metal: 0.5, gear: true }],
      [CH, box(0.055, 0.74, 0.05), { at: [0.262, 0.27, 0.19], color: C.light, rough: 0.45, metal: 0.5, gear: true }],
      [CH, box(0.48, 0.53, 0.03), { at: [0, 0.185, 0.185], color: C.dark, rough: 0.6, gear: true }],
      ...[0.36, 0.26, 0.16, 0.06, -0.04].map((y) => [CH, box(0.42, 0.022, 0.012), { at: [0, y, 0.204], color: C.red, rough: 0.4, gear: true }]),
    ],
  },
  // ROMPE: tubo lanzador cruzado a la espalda (la boca asoma por encima del hombro izquierdo)
  rompe: {
    parts: () => {
      const c = [-0.03, 0.14, 0.235], a = 0.55;
      return [
        [CH, cyl(0.055, 0.055, 0.9, 8), { at: c, rot: [0, 0, a], color: C.sand, rough: 0.7, gear: true }],
        [CH, cyl(0.065, 0.065, 0.06, 8), { at: along(c, a, 0.42), rot: [0, 0, a], color: C.black, rough: 0.6, gear: true }],
        [CH, cyl(0.062, 0.062, 0.05, 8), { at: along(c, a, -0.43), rot: [0, 0, a], color: C.black, rough: 0.6, gear: true }],
        [CH, box(0.04, 0.05, 0.08), { at: [...along(c, a, 0.1).slice(0, 2), 0.285], rot: [0, 0, a], color: C.black, rough: 0.5, gear: true }],
      ];
    },
  },
  // MURALLA: casco pesado con visera (en character.js); el escudo ya lo dibuja la habilidad
  muralla: { look: { head: 'heavy' }, parts: () => [] },
  // RADAR: antena de plato en un mástil sobre la mochila (asoma por encima de la cabeza)
  radar: {
    parts: () => [
      [CH, box(0.08, 0.05, 0.05), { at: [0.12, 0.23, 0.2], color: C.dark, rough: 0.5, gear: true }],
      [CH, cyl(0.016, 0.016, 0.5, 6), { at: [0.12, 0.46, 0.2], color: C.black, rough: 0.5, gear: true }],
      [CH, cyl(0.16, 0.04, 0.05, 12), { at: [0.12, 0.72, 0.2], rot: [-0.5, 0, 0], color: C.light, rough: 0.45, metal: 0.4, gear: true }],
      [CH, cyl(0.008, 0.008, 0.12, 5), { at: [0.12, 0.76, 0.18], rot: [-0.5, 0, 0], color: C.black, rough: 0.5, gear: true }],
    ],
  },
  // PULGA: dron de choque sujeto a la espalda (las ruedas asoman sobre los hombros) y tableta en el antebrazo
  pulga: {
    pack: false,
    parts: (L) => [
      [CH, box(0.24, 0.26, 0.08), { at: [0, 0.06, 0.17], color: L.vest, rough: 0.85, gear: true }],
      [CH, box(0.06, 0.18, 0.04), { at: [0, 0.27, 0.2], color: C.black, rough: 0.6, gear: true }],
      [CH, box(0.4, 0.1, 0.075), { at: [0, 0.4, 0.2], color: C.yellow, rough: 0.5, gear: true }],
      [CH, cyl(0.085, 0.085, 0.045, 12), { at: [-0.225, 0.4, 0.2], rot: [0, 0, HALF_PI], color: C.black, rough: 0.9, gear: true }],
      [CH, cyl(0.085, 0.085, 0.045, 12), { at: [0.225, 0.4, 0.2], rot: [0, 0, HALF_PI], color: C.black, rough: 0.9, gear: true }],
      [CH, box(0.26, 0.025, 0.01), { at: [0, 0.4, 0.24], color: C.black, rough: 0.5, gear: true }],
      [CH, cyl(0.006, 0.006, 0.16, 5), { at: [0.1, 0.53, 0.2], color: C.black, gear: true }],
      [BONE.farmL, box(0.018, 0.12, 0.085), { at: [0.052, -0.13, 0], color: C.dark, rough: 0.4 }],
      [BONE.farmL, box(0.004, 0.09, 0.065), { at: [0.062, -0.13, 0], color: C.screen, rough: 0.1 }],
    ],
  },
  // CHISPA: granadas PEM (blancas con franja amarilla) en el pecho, sobre las clavículas (por encima
  // del arma), en el cinturón y de pie sobre la mochila (asoman por encima de los hombros)
  chispa: {
    parts: () => [[CH, -0.12, 0.23, -0.075], [CH, 0.12, 0.23, -0.075], [PV, -0.12, 0.0, -0.135], [PV, 0.12, 0.0, -0.135],
      ...[-0.21, -0.07, 0.07, 0.21].map((x) => [CH, x, 0.34, 0.17, true])].flatMap(([bone, x, y, z, gear = false]) => [
      [bone, cyl(0.03, 0.03, 0.1, 6), { at: [x, y, z], color: C.white, rough: 0.5, gear }],
      [bone, cyl(0.031, 0.031, 0.024, 6), { at: [x, y, z], color: C.yellow, rough: 0.5, gear }],
      [bone, box(0.03, 0.02, 0.03), { at: [x, y + 0.06, z], color: C.black, rough: 0.5, gear }],
    ]),
  },
  // NUBE: máscara de gas con dos filtros y lanzagranadas corto a la espalda; botes de humo en el cinturón
  nube: {
    look: { face: 'gas2' },
    parts: () => {
      const c = [0.07, 0.24, 0.24], a = -0.45;
      return [
        [CH, cyl(0.045, 0.045, 0.56, 8), { at: c, rot: [0, 0, a], color: C.sage, rough: 0.6, gear: true }],
        [CH, cyl(0.055, 0.055, 0.05, 8), { at: along(c, a, 0.27), rot: [0, 0, a], color: C.black, rough: 0.6, gear: true }],
        [CH, cyl(0.085, 0.085, 0.12, 10), { at: along(c, a, -0.1), rot: [0, 0, a], color: C.dark, rough: 0.5, gear: true }],
        [PV, cyl(0.028, 0.028, 0.1, 6), { at: [-0.1, 0.0, -0.135], color: C.steel, rough: 0.6 }],
        [PV, cyl(0.028, 0.028, 0.1, 6), { at: [0.1, 0.0, -0.135], color: C.steel, rough: 0.6 }],
      ];
    },
  },
  // LUMEN: sombrero de ala ancha (en character.js) y tiras de camuflaje en hombros y espalda
  lumen: {
    look: { head: 'boonie', face: 'none' },
    parts: () => {
      const g = ['#4f5636', '#5f5f3e', '#434a30'];
      const P = [[CH, box(0.4, 0.06, 0.28), { at: [0, 0.255, 0.02], color: g[0], rough: 1, gear: true }]];
      // [x, y, z, giro en Z, giro en X]
      const strips = [[-0.2, 0.2, 0.05, 0.3, 0], [0.2, 0.2, 0.05, -0.3, 0], [-0.21, 0.16, -0.05, 0.4, 0.2], [0.21, 0.16, -0.05, -0.4, 0.2],
        [-0.12, 0.14, 0.17, 0.15, 0.3], [0, 0.12, 0.18, 0, 0.3], [0.12, 0.14, 0.17, -0.15, 0.3], [-0.06, 0.05, 0.19, 0.1, 0.1],
        [0.07, 0.04, 0.19, -0.1, 0.1], [-0.18, 0.1, 0.12, 0.35, 0.2], [0.18, 0.1, 0.12, -0.35, 0.2]];
      strips.forEach(([x, y, z, rz, rx], i) => P.push([CH, box(0.04, 0.22, 0.012), { at: [x, y, z], rot: [rx, 0, rz], color: g[i % 3], rough: 1, gear: true }]));
      return P;
    },
  },
  // ---------------------------------------------------------------- defensa
  // VOLTIO: baterías amarillas en el cinturón y a la espalda
  voltio: {
    pack: false,
    parts: () => [
      ...[-0.105, 0.105].flatMap((x) => [
        [PV, box(0.075, 0.11, 0.045), { at: [x, 0.0, -0.14], color: C.yellow, rough: 0.5 }],
        [PV, box(0.075, 0.02, 0.045), { at: [x, 0.065, -0.14], color: C.black, rough: 0.5 }],
      ]),
      [CH, box(0.3, 0.34, 0.035), { at: [0, 0.16, 0.15], color: C.black, rough: 0.6, gear: true }],
      ...[-0.095, 0, 0.095].flatMap((x) => [
        [CH, box(0.085, 0.26, 0.075), { at: [x, 0.2, 0.2], color: C.yellow, rough: 0.5, gear: true }],
        [CH, box(0.085, 0.03, 0.075), { at: [x, 0.345, 0.2], color: C.black, rough: 0.5, gear: true }],
      ]),
      [CH, cyl(0.012, 0.012, 0.3, 5), { at: [0.17, 0.02, 0.17], rot: [0.3, 0, 0.5], color: C.black, gear: true }],
    ],
  },
  // SILENCIO: mochila del inhibidor con tres antenas
  silencio: {
    pack: false,
    parts: () => [
      [CH, box(0.27, 0.42, 0.13), { at: [0, 0.17, 0.2], color: C.dark, rough: 0.6, gear: true }],
      [CH, box(0.2, 0.05, 0.02), { at: [0, 0.27, 0.27], color: C.black, rough: 0.5, gear: true }],
      [CH, box(0.2, 0.05, 0.02), { at: [0, 0.17, 0.27], color: C.black, rough: 0.5, gear: true }],
      ...[[-0.11, 0.28], [0, 0], [0.11, -0.28]].flatMap(([x, a]) => {
        const l = x ? 0.34 : 0.38, c = along([x, 0.38, x ? 0.2 : 0.22], a, l / 2);
        return [
          [CH, cyl(0.02, 0.014, l, 5), { at: c, rot: [0, 0, a], color: C.black, rough: 0.5, gear: true }],
          [CH, box(0.04, 0.04, 0.04), { at: along(c, a, l / 2), color: C.steel, rough: 0.5, gear: true }],
        ];
      }),
    ],
  },
  // CEPO: minas láser (lentes rojas) en el pecho, en los muslos y en el estuche de la espalda
  cepo: {
    pack: false,
    parts: () => {
      const mine = (bone, x, y, z, f) => [
        [bone, box(0.06, 0.045, 0.02), { at: [x, y, z], color: C.olive, rough: 0.6 }],
        [bone, box(0.034, 0.011, 0.003), { at: [x, y + 0.005, z + f * 0.0115], color: C.red, rough: 0.2 }],
      ];
      return [
        [CH, box(0.3, 0.22, 0.09), { at: [0, 0.05, 0.18], color: C.olive, rough: 0.7, gear: true }],
        ...[-0.1, -0.035, 0.035, 0.1].map((x) => [CH, box(0.035, 0.012, 0.006), { at: [x, 0.1, 0.227], color: C.red, rough: 0.2, gear: true }]),
        ...mine(CH, -0.085, 0.02, -0.17, -1), ...mine(CH, 0.085, 0.02, -0.17, -1),
        ...mine(BONE.thighL, 0, -0.14, 0.092, 1), ...mine(BONE.thighR, 0, -0.14, 0.092, 1),
      ];
    },
  },
  // OJO: cámara sobre el ojo derecho (en character.js) y cámaras adhesivas en el pecho
  ojo: {
    look: { face: 'monocle' },
    parts: () => [-0.12, 0.12].flatMap((x) => [
      [CH, box(0.055, 0.055, 0.03), { at: [x, 0.25, -0.06], color: C.light, rough: 0.5 }],
      [CH, cyl(0.016, 0.016, 0.006, 8), { at: [x, 0.25, -0.077], rot: [HALF_PI, 0, 0], color: C.glass, rough: 0.1, metal: 0.5 }],
    ]),
  },
  // CORAZA: bolsa grande de placas a la espalda (las placas asoman por arriba)
  coraza: {
    pack: false,
    parts: () => [
      [CH, box(0.38, 0.44, 0.15), { at: [0, 0.07, 0.225], color: C.tan, rough: 0.9, gear: true }],
      ...[0.18, 0.22, 0.26].map((z) => [CH, box(0.44, 0.16, 0.02), { at: [0, 0.36, z], color: C.steel, rough: 0.5, metal: 0.4, gear: true }]),
      [CH, box(0.04, 0.42, 0.012), { at: [-0.1, 0.07, 0.303], color: C.brown, rough: 0.8, gear: true }],
      [CH, box(0.04, 0.42, 0.012), { at: [0.1, 0.07, 0.303], color: C.brown, rough: 0.8, gear: true }],
      [CH, box(0.3, 0.035, 0.012), { at: [0, -0.02, 0.303], color: C.brown, rough: 0.8, gear: true }],
    ],
  },
  // GUARDIÁN: interceptor sobre el hombro izquierdo
  guardian: {
    parts: () => [
      [CH, box(0.03, 0.06, 0.03), { at: [-0.16, 0.225, 0.03], color: C.black, rough: 0.6, gear: true }],
      [CH, box(0.14, 0.03, 0.14), { at: [-0.19, 0.26, 0.03], color: C.dark, rough: 0.5, gear: true }],
      [CH, sph(0.07, 10, 5, 0, HALF_PI), { at: [-0.19, 0.275, 0.03], color: C.light, rough: 0.4, metal: 0.3, gear: true }],
      [CH, cyl(0.016, 0.016, 0.09, 6), { at: [-0.19, 0.325, -0.01], rot: [-HALF_PI + 0.3, 0, 0], color: C.black, rough: 0.5, gear: true }],
      [CH, cyl(0.024, 0.024, 0.01, 8), { at: [-0.19, 0.334, -0.055], rot: [-HALF_PI + 0.3, 0, 0], color: C.led, rough: 0.2, gear: true }],
    ],
  },
  // REMEDIO: mochila de médico con cruz blanca sobre verde (y en el pecho y el casco)
  remedio: {
    pack: false,
    parts: () => [
      [CH, box(0.32, 0.38, 0.15), { at: [0, 0.08, 0.215], color: C.green, rough: 0.85, gear: true }],
      [CH, box(0.17, 0.05, 0.01), { at: [0, 0.12, 0.293], color: C.white, rough: 0.6, gear: true }],
      [CH, box(0.05, 0.17, 0.01), { at: [0, 0.12, 0.293], color: C.white, rough: 0.6, gear: true }],
      [CH, box(0.14, 0.12, 0.02), { at: [-0.085, 0.05, -0.172], color: C.green, rough: 0.8 }],
      [CH, box(0.1, 0.03, 0.004), { at: [-0.085, 0.05, -0.183], color: C.white, rough: 0.6 }],
      [CH, box(0.03, 0.1, 0.004), { at: [-0.085, 0.05, -0.183], color: C.white, rough: 0.6 }],
      [HD, box(0.055, 0.055, 0.012), { at: [0, 0.19, -0.11], rot: [-0.55, 0, 0], color: C.green, rough: 0.8 }],
      [HD, box(0.036, 0.012, 0.004), { at: [0, 0.192, -0.117], rot: [-0.55, 0, 0], color: C.white, rough: 0.6 }],
      [HD, box(0.012, 0.036, 0.004), { at: [0, 0.192, -0.117], rot: [-0.55, 0, 0], color: C.white, rough: 0.6 }],
      ...[[BONE.uarmL, 1], [BONE.uarmR, -1]].flatMap(([bone, s]) => [
        [bone, box(0.004, 0.08, 0.08), { at: [s * 0.097, -0.005, 0], color: C.green, rough: 0.8 }],
        [bone, box(0.004, 0.06, 0.02), { at: [s * 0.099, -0.005, 0], color: C.white, rough: 0.6 }],
        [bone, box(0.004, 0.02, 0.06), { at: [s * 0.099, -0.005, 0], color: C.white, rough: 0.6 }],
      ]),
      ...[-1, 1].flatMap((s) => [
        [HD, box(0.008, 0.05, 0.05), { at: [s * 0.126, 0.16, 0.06], color: C.green, rough: 0.8 }],
        [HD, box(0.004, 0.034, 0.012), { at: [s * 0.131, 0.16, 0.06], color: C.white, rough: 0.6 }],
        [HD, box(0.004, 0.012, 0.034), { at: [s * 0.131, 0.16, 0.06], color: C.white, rough: 0.6 }],
      ]),
    ],
  },
  // TIZÓN: máscara de gas con un filtro grande (en character.js) y dos botes de gas a la espalda
  tizon: {
    look: { face: 'gas1' },
    pack: false,
    parts: () => [
      ...[-0.15, 0.15].flatMap((x) => [
        [CH, cyl(0.075, 0.075, 0.46, 10), { at: [x, 0.12, 0.22], color: C.tank, rough: 0.55, metal: 0.2, gear: true }],
        [CH, sph(0.075, 10, 4, 0, HALF_PI), { at: [x, 0.35, 0.22], color: C.tank, rough: 0.55, metal: 0.2, gear: true }],
        [CH, cyl(0.078, 0.078, 0.04, 10), { at: [x, 0.3, 0.22], color: C.yellow, rough: 0.5, gear: true }],
        [CH, cyl(0.016, 0.016, 0.06, 6), { at: [x, 0.445, 0.22], color: C.black, rough: 0.5, gear: true }],
      ]),
      [CH, box(0.36, 0.05, 0.03), { at: [0, 0.2, 0.15], color: C.black, rough: 0.6, gear: true }],
    ],
  },
};

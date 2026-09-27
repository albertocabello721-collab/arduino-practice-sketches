// Muerte con física por partes (Fase 7.5). Al morir, el cuerpo deja de seguir la pose de la
// simulación y cae como un muñeco de trapo ligero: una partícula en cada articulación (Verlet),
// unidas por varillas; el tronco es un sólido rígido (con espalda y pecho anchos, para que no ruede
// solo); rodillas, codos y cuello no se doblan al revés; choca con los vóxeles y se queda quieto en
// cuanto para (como mucho a los 3 s). El arma que llevaba en la mano cae aparte. Es solo dibujo: la
// simulación y las zonas de impacto no cambian (a un muerto no le dan las balas). Sin Three.js: lo
// prueban los tests en Node.
import { BONE, BONE_COUNT } from '../sim/skeleton.js';
import { VS } from '../world/voxelworld.js';

export const RAG = {
  h: 1 / 120,          // paso fijo (s)
  iters: 4,            // vueltas a las restricciones en cada paso
  maxSteps: 6,         // pasos como mucho por fotograma (si va muy lento, cámara lenta antes que tirones)
  g: 9.8,
  air: 0.999,          // amortiguación en el aire, por paso
  friction: 0.25,      // parte de la velocidad a lo largo del suelo (o de la pared) que se pierde al rozar, por paso
  joint: 0.03,         // parte de la velocidad relativa entre dos partículas unidas que se pierde, por paso
  ground: 0.03,        // y de toda la velocidad cuando el cuerpo ya está en el suelo (con 5 apoyos; con menos, menos)
  sleepAfter: 3,       // se queda quieto a los 3 s pase lo que pase
  restSpeed: 0.1,      // m/s: por debajo de esto, en reposo…
  restTime: 0.35,      // …y si dura esto, se duerme antes
  cap: 10,             // cuerpos moviéndose a la vez (el más antiguo se duerme)
};

// ------------------------------------------------------------ partículas
export const PT = {
  pelvis: 0, chest: 1, neck: 2, head: 3, back: 4, bladeL: 5, bladeR: 6, pecL: 7, pecR: 8,
  shL: 9, elL: 10, wrL: 11, shR: 12, elR: 13, wrR: 14,
  hipL: 15, knL: 16, anL: 17, toeL: 18, hipR: 19, knR: 20, anR: 21, toeR: 22,
  gS: 23, gM: 24, gT: 25, gB: 26,     // el arma: culata, boca, arriba y abajo (un tetraedro)
};
export const NP = 27;
const NBODY = 23;
const { pelvis: PE, chest: CH, neck: NE, head: HE, back: BK, bladeL, bladeR, pecL, pecR, shL, elL, wrL, shR, elR, wrR, hipL, knL, anL, toeL, hipR, knR, anR, toeR, gS, gM, gT, gB } = PT;
// Cada una en el espacio de un hueso de la pose de la simulación: [hueso, x, y, z, radio, masa].
// (x = derecha en el tronco; las de la espalda van hasta donde llegue la mochila: ver el constructor)
const BODY = [
  [BONE.pelvis, 0, -0.03, 0, 0.11, 4],
  [BONE.chest, 0, 0.1, 0.01, 0.12, 3],
  [BONE.neck, 0, 0.03, 0, 0.07, 1],
  [BONE.head, 0, 0.11, -0.01, 0.12, 1.5],
  [BONE.spine, 0, 0.06, 0.07, 0.06, 1],              // riñones
  [BONE.chest, -0.12, 0.14, 0.075, 0.06, 1], [BONE.chest, 0.12, 0.14, 0.075, 0.06, 1],   // omóplatos
  [BONE.chest, -0.11, 0.1, -0.09, 0.05, 1], [BONE.chest, 0.11, 0.1, -0.09, 0.05, 1],     // pecho
  [BONE.uarmL, 0, 0, 0, 0.065, 1.5], [BONE.farmL, 0, 0, 0, 0.055, 1], [BONE.handL, 0, -0.04, 0, 0.05, 0.6],
  [BONE.uarmR, 0, 0, 0, 0.065, 1.5], [BONE.farmR, 0, 0, 0, 0.055, 1], [BONE.handR, 0, -0.04, 0, 0.05, 0.6],
  [BONE.thighL, 0, 0, 0, 0.085, 2], [BONE.shinL, 0, 0, 0, 0.065, 1.2], [BONE.footL, 0, 0, 0, 0.06, 0.8], [BONE.footL, 0, -0.045, -0.15, 0.045, 0.4],
  [BONE.thighR, 0, 0, 0, 0.085, 2], [BONE.shinR, 0, 0, 0, 0.065, 1.2], [BONE.footR, 0, 0, 0, 0.06, 0.8], [BONE.footR, 0, -0.045, -0.15, 0.045, 0.4],
];
const GUN_R = 0.03, GUN_M = 0.5;
const MAXC = 6;         // planos de contacto por partícula
const STEP_MAX = 0.03;  // lo que corrige como mucho un límite de articulación en cada vuelta (m)
const VMAX = 12;        // m/s: ninguna parte va más rápido (red de seguridad)
const STICK = 0.25;     // m/s: por debajo, lo que toca no resbala

// El tronco, rígido: se ajusta de golpe a su forma al morir (ajuste de forma) en cada vuelta
export const TORSO_PTS = [PE, CH, NE, BK, bladeL, bladeR, pecL, pecR, shL, shR, hipL, hipR];
const TS = Int32Array.from(TORSO_PTS);
const TM = Float64Array.from(TORSO_PTS, (i) => BODY[i][5]);
const TMASS = TM.reduce((a, b) => a + b, 0);
// Varillas: cuello, brazos, piernas (con el pie fijo a la espinilla) y el arma
const LINKS = [[NE, HE], [shL, elL], [elL, wrL], [shR, elR], [elR, wrR],
  [hipL, knL], [knL, anL], [anL, toeL], [knL, toeL], [hipR, knR], [knR, anR], [anR, toeR], [knR, toeR],
  [gS, gM], [gS, gT], [gS, gB], [gM, gT], [gM, gB], [gT, gB]];
const LI = Int32Array.from(LINKS, (l) => l[0]), LJ = Int32Array.from(LINKS, (l) => l[1]);
// Distancias mínimas: lo que no se dobla más de la cuenta ni atraviesa el cuerpo
const MINS = [
  [shL, wrL, 0.2], [shR, wrR, 0.2],            // el codo no se cierra del todo
  [hipL, anL, 0.42], [hipR, anR, 0.42],        // ni la rodilla
  [elL, CH, 0.2], [elR, CH, 0.2], [wrL, CH, 0.18], [wrR, CH, 0.18], [wrL, PE, 0.15], [wrR, PE, 0.15],
  [wrL, HE, 0.16], [wrR, HE, 0.16], [knL, CH, 0.25], [knR, CH, 0.25],
  [knL, knR, 0.14], [anL, anR, 0.12], [toeL, toeR, 0.1], [elL, elR, 0.12],
];
// Conos (en el espacio del tronco: x derecha, y arriba, z atrás): el cuello no va hacia atrás y los
// muslos no pasan por detrás de la espalda. [base, punta, eje, semiángulo]
const CONES = [
  [NE, HE, [0, Math.cos(0.26), -Math.sin(0.26)], 0.61],       // 15° adelante ± 35°: atrás 20°, adelante 50°
  [hipL, knL, [0, -Math.SQRT1_2, -Math.SQRT1_2], 1.48],      // 45° adelante ± 85°: atrás 40°
  [hipR, knR, [0, -Math.SQRT1_2, -Math.SQRT1_2], 1.48],
];
const TORSO_W = 0.1;    // lo que cede el tronco cuando un límite empuja contra él (como una masa de 10)

// Marcos de referencia (de dónde saca cada hueso su orientación) y, por hueso, [marco, partícula origen]
const F = { torso: 0, head: 1, uarmL: 2, farmL: 3, uarmR: 4, farmR: 5, thighL: 6, shinL: 7, footL: 8, thighR: 9, shinR: 10, footR: 11, gun: 12 };
const NF = 13;
const BONE_FRAME = [];
BONE_FRAME[BONE.pelvis] = [F.torso, PE]; BONE_FRAME[BONE.spine] = [F.torso, PE]; BONE_FRAME[BONE.chest] = [F.torso, PE]; BONE_FRAME[BONE.neck] = [F.torso, PE];
BONE_FRAME[BONE.head] = [F.head, HE];
BONE_FRAME[BONE.uarmL] = [F.uarmL, shL]; BONE_FRAME[BONE.farmL] = [F.farmL, elL]; BONE_FRAME[BONE.handL] = [F.farmL, wrL];
BONE_FRAME[BONE.uarmR] = [F.uarmR, shR]; BONE_FRAME[BONE.farmR] = [F.farmR, elR]; BONE_FRAME[BONE.handR] = [F.farmR, wrR];
BONE_FRAME[BONE.thighL] = [F.thighL, hipL]; BONE_FRAME[BONE.shinL] = [F.shinL, knL]; BONE_FRAME[BONE.footL] = [F.footL, anL];
BONE_FRAME[BONE.thighR] = [F.thighR, hipR]; BONE_FRAME[BONE.shinR] = [F.shinR, knR]; BONE_FRAME[BONE.footR] = [F.footR, anR];
BONE_FRAME[BONE.gun] = [F.gun, gS];
BONE_FRAME[BONE.holster] = [F.thighR, hipR];
// Brazos: su giro sobre sí mismos no lo fija nada, así que se arrastra (transporte paralelo)
const CARRIED = [[F.uarmL, shL, elL, BONE.uarmL], [F.farmL, elL, wrL, BONE.farmL], [F.uarmR, shR, elR, BONE.uarmR], [F.farmR, elR, wrR, BONE.farmR]];
const KNEES = [[hipL, knL, anL], [hipR, knR, anR]];
const ELBOWS = [[0, F.uarmL, shL, elL, wrL], [1, F.uarmR, shR, elR, wrR]];
const LEGS = [[F.thighL, F.shinL, F.footL, hipL, knL, anL, toeL], [F.thighR, F.shinR, F.footR, hipR, knR, anR, toeR]];

// Cuánto empuja un disparo a cada partícula: más arriba, más (el cuerpo vuelca en la dirección del tiro)
const SHOT_W = new Float64Array(NP).fill(1);
for (const [i, w] of [[PE, 0.55], [BK, 0.7], [elL, 0.8], [elR, 0.8], [wrL, 0.7], [wrR, 0.7], [hipL, 0.5], [hipR, 0.5], [knL, 0.25], [knR, 0.25], [anL, 0.1], [anR, 0.1], [toeL, 0.1], [toeR, 0.1], [gS, 0.6], [gM, 0.6], [gT, 0.6], [gB, 0.6]]) SHOT_W[i] = w;

// ------------------------------------------------------------ álgebra en arrays
const _a = new Float64Array(3), _b = new Float64Array(3), _c = new Float64Array(3);
function norm3(v) { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function sub3(P, i, j, out) { out[0] = P[i * 3] - P[j * 3]; out[1] = P[i * 3 + 1] - P[j * 3 + 1]; out[2] = P[i * 3 + 2] - P[j * 3 + 2]; return out; }
const dist = (P, i, j) => Math.sqrt((P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2);
// Marco (9: columnas x, y, z) en `M` desde `o`: y a lo largo de -dir y z lo más parecido a `hint`
function basisDown(M, o, dir, hint) {
  const yx = -dir[0], yy = -dir[1], yz = -dir[2];
  const yl = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1;
  const Yx = yx / yl, Yy = yy / yl, Yz = yz / yl;
  const d = hint[0] * Yx + hint[1] * Yy + hint[2] * Yz;
  let zx = hint[0] - Yx * d, zy = hint[1] - Yy * d, zz = hint[2] - Yz * d;
  let zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (zl < 1e-6) { zx = M[o + 6]; zy = M[o + 7]; zz = M[o + 8]; const e = zx * Yx + zy * Yy + zz * Yz; zx -= Yx * e; zy -= Yy * e; zz -= Yz * e; zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; }
  zx /= zl; zy /= zl; zz /= zl;
  M[o] = Yy * zz - Yz * zy; M[o + 1] = Yz * zx - Yx * zz; M[o + 2] = Yx * zy - Yy * zx;
  M[o + 3] = Yx; M[o + 4] = Yy; M[o + 5] = Yz;
  M[o + 6] = zx; M[o + 7] = zy; M[o + 8] = zz;
}
// Marco con -z hacia `fwd` e y lo más parecido a `up`
function basisForward(M, o, fwd, up) {
  const fl = Math.sqrt(fwd[0] * fwd[0] + fwd[1] * fwd[1] + fwd[2] * fwd[2]) || 1;
  const Zx = -fwd[0] / fl, Zy = -fwd[1] / fl, Zz = -fwd[2] / fl;
  const d = up[0] * Zx + up[1] * Zy + up[2] * Zz;
  let yx = up[0] - Zx * d, yy = up[1] - Zy * d, yz = up[2] - Zz * d;
  const yl = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1;
  yx /= yl; yy /= yl; yz /= yl;
  M[o] = yy * Zz - yz * Zy; M[o + 1] = yz * Zx - yx * Zz; M[o + 2] = yx * Zy - yy * Zx;
  M[o + 3] = yx; M[o + 4] = yy; M[o + 5] = yz;
  M[o + 6] = Zx; M[o + 7] = Zy; M[o + 8] = Zz;
}
// Marco con y hacia `up` y x lo más parecido a `right` (z = x × y, hacia atrás)
function basisUp(M, o, up, right) {
  const ul = Math.sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]) || 1;
  const Yx = up[0] / ul, Yy = up[1] / ul, Yz = up[2] / ul;
  const d = right[0] * Yx + right[1] * Yy + right[2] * Yz;
  let xx = right[0] - Yx * d, xy = right[1] - Yy * d, xz = right[2] - Yz * d;
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  M[o] = xx; M[o + 1] = xy; M[o + 2] = xz;
  M[o + 3] = Yx; M[o + 4] = Yy; M[o + 5] = Yz;
  M[o + 6] = xy * Yz - xz * Yy; M[o + 7] = xz * Yx - xx * Yz; M[o + 8] = xx * Yy - xy * Yx;
}

// ------------------------------------------------------------ empujón de la muerte
/**
 * Qué empuja al cuerpo al morir, a partir del evento 'killed' de la simulación (antes de que el
 * cuerpo se pare): el disparo (en su dirección; más de cerca y con escopeta), la explosión (hacia
 * fuera y hacia arriba) o nada (se desploma: desangrado, caída, gas).
 */
export function deathImpulse(ev, target) {
  const b = target.body.pos;
  const vel = { x: target.body.vel.x, y: Math.max(-2, Math.min(2, target.body.vel.y)), z: target.body.vel.z };
  const w = ev && ev.weapon;
  if (w && w.explosive && ev.point) {
    const d = Math.hypot(b.x - ev.point.x, b.y + 0.9 - ev.point.y, b.z - ev.point.z);
    return { kind: 'blast', point: { ...ev.point }, speed: Math.max(2.5, Math.min(4.5, 5 - d * 0.75)), up: 1.5, vel };
  }
  if (ev && ev.dir) {
    let speed = w && w.pellets > 1 ? 3.5 : 2.2;
    if (ev.by && ev.by !== target) {
      const s = ev.by.body.pos;
      speed *= 0.85 + 0.5 * Math.exp(-Math.hypot(s.x - b.x, s.z - b.z) / 6);   // de cerca empuja más
    }
    return { kind: 'shot', dir: { ...ev.dir }, point: ev.point ? { ...ev.point } : null, speed, head: ev.headshot ? 0.5 : 0, vel };
  }
  return { kind: 'none', vel };
}

// ------------------------------------------------------------ el cuerpo
export class Ragdoll {
  /**
   * @param {Array<{p,R}>} rig   pose de la simulación en el instante de la muerte (op.rig)
   * @param {object} o           { gunBox: [z0,z1,y0,y1] del arma de la mano (en su espacio), backZ:
   *                               hasta dónde llega la espalda (con la mochila), impulse: deathImpulse, rand }
   */
  constructor(rig, o = {}) {
    this.P = new Float64Array(NP * 3);
    this.Q = new Float64Array(NP * 3);
    this.W = new Float64Array(NP);
    this.Rd = new Float64Array(NP);
    this.cn = new Float64Array(NP * MAXC * 4);  // planos de contacto de este paso (normal y distancia)
    this.cc = new Uint8Array(NP);
    this.touch = new Uint8Array(NP);            // qué planos toca cada una
    this.tn = new Float64Array(NP * 3);         // (y la suma de sus normales, para el rozamiento)
    this.M = new Float64Array(NF * 9);          // marcos
    for (let f = 0; f < NF; f++) { this.M[f * 9] = 1; this.M[f * 9 + 4] = 1; this.M[f * 9 + 8] = 1; }
    this.M0 = new Float64Array(9);              // marco del tronco al morir
    this.q = new Float64Array([1, 0, 0, 0]);    // giro del tronco desde entonces (cuaternión w, x, y, z)
    this.r0 = new Float64Array(TS.length * 3);  // forma del tronco (respecto a su centro)
    this.O = new Float64Array(BONE_COUNT * 12); // cada hueso respecto a su marco (rotación y traslado)
    this.rest = new Float64Array(LINKS.length);
    this.mins = MINS.map((m) => m.slice());
    this.cones = [];
    this.bend = new Float64Array(6);            // lado al que se doblan los codos (en el marco del brazo)
    this.t = 0; this.still = 0; this.acc = 0;
    this.awake = true;
    const P = this.P;
    const put = (i, bone, x, y, z) => {
      const b = rig[bone], R = b.R;
      P[i * 3] = b.p.x + R.x.x * x + R.y.x * y + R.z.x * z;
      P[i * 3 + 1] = b.p.y + R.x.y * x + R.y.y * y + R.z.y * z;
      P[i * 3 + 2] = b.p.z + R.x.z * x + R.y.z * y + R.z.z * z;
    };
    const back = Math.max(0.135, o.backZ || 0) - 0.06;
    BODY.forEach(([bone, x, y, z, r, m], i) => {
      put(i, bone, x, y, i === bladeL || i === bladeR ? back : z);
      this.Rd[i] = r; this.W[i] = 1 / m;
    });
    // el arma de la mano: un tetraedro que abarca su largo y su alto
    const [z0, z1, y0, y1] = o.gunBox || [-0.62, 0.29, -0.13, 0.07];
    put(gS, BONE.gun, 0, 0, z1 - 0.03);
    put(gM, BONE.gun, 0, 0.02, z0 + 0.03);
    put(gT, BONE.gun, 0.025, y1 - 0.01, z0 * 0.3);
    put(gB, BONE.gun, -0.025, y0 + 0.02, -0.03);
    for (const i of [gS, gM, gT, gB]) { this.Rd[i] = GUN_R; this.W[i] = 1 / GUN_M; }
    this.Q.set(P);
    LINKS.forEach(([i, j], k) => { this.rest[k] = dist(P, i, j); });
    // las mínimas nunca por encima de lo que ya había al morir (no pegan un tirón al empezar)
    for (const m of this.mins) m[2] = Math.min(m[2], 0.97 * dist(P, m[0], m[1]));
    // forma del tronco
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < TS.length; k++) { const i = TS[k] * 3; cx += P[i] * TM[k]; cy += P[i + 1] * TM[k]; cz += P[i + 2] * TM[k]; }
    cx /= TMASS; cy /= TMASS; cz /= TMASS;
    for (let k = 0; k < TS.length; k++) { const i = TS[k] * 3; this.r0[k * 3] = P[i] - cx; this.r0[k * 3 + 1] = P[i + 1] - cy; this.r0[k * 3 + 2] = P[i + 2] - cz; }
    _b[0] = P[shR * 3] - P[shL * 3] + P[hipR * 3] - P[hipL * 3];
    _b[1] = P[shR * 3 + 1] - P[shL * 3 + 1] + P[hipR * 3 + 1] - P[hipL * 3 + 1];
    _b[2] = P[shR * 3 + 2] - P[shL * 3 + 2] + P[hipR * 3 + 2] - P[hipL * 3 + 2];
    basisUp(this.M0, 0, sub3(P, NE, PE, _a), _b);
    // marcos iniciales: los brazos parten de la orientación de sus huesos
    const M = this.M;
    for (const [f, , , bone] of CARRIED) {
      const R = rig[bone].R;
      M[f * 9] = R.x.x; M[f * 9 + 1] = R.x.y; M[f * 9 + 2] = R.x.z;
      M[f * 9 + 3] = R.y.x; M[f * 9 + 4] = R.y.y; M[f * 9 + 5] = R.y.z;
      M[f * 9 + 6] = R.z.x; M[f * 9 + 7] = R.z.y; M[f * 9 + 8] = R.z.z;
    }
    this._frames();
    // conos: si al morir ya estaba fuera (mirando muy arriba o muy abajo), el cono se abre hasta ahí
    for (const [base, tip, ax, ang] of CONES) {
      const u = norm3(sub3(P, tip, base, _a)), A = this._torsoDir(ax, _b);
      const now = Math.acos(Math.max(-1, Math.min(1, u[0] * A[0] + u[1] * A[1] + u[2] * A[2])));
      const a = Math.max(ang, now + 0.05);
      this.cones.push([base, tip, ax, Math.cos(a), Math.sin(a)]);
    }
    // codos: se doblan hacia donde ya lo estaban al morir (o, estirados, hacia delante del brazo)
    for (const [k, f, s, e, w] of ELBOWS) {
      const a = norm3(sub3(P, e, s, _a)), fa = sub3(P, w, e, _b);
      const d = fa[0] * a[0] + fa[1] * a[1] + fa[2] * a[2];
      _c[0] = fa[0] - a[0] * d; _c[1] = fa[1] - a[1] * d; _c[2] = fa[2] - a[2] * d;
      const l = Math.sqrt(_c[0] * _c[0] + _c[1] * _c[1] + _c[2] * _c[2]);
      const o3 = k * 3;
      if (l > 0.04) for (let c = 0; c < 3; c++) this.bend[o3 + c] = (M[f * 9 + c * 3] * _c[0] + M[f * 9 + c * 3 + 1] * _c[1] + M[f * 9 + c * 3 + 2] * _c[2]) / l;
      else { this.bend[o3] = 0; this.bend[o3 + 1] = 0; this.bend[o3 + 2] = 1; }
    }
    // cada hueso respecto a su marco: al empezar se dibuja exactamente la pose de la simulación
    const O = this.O;
    for (let bone = 0; bone < BONE_COUNT; bone++) {
      const bf = BONE_FRAME[bone];
      if (!bf || !rig[bone]) continue;
      const [f, pi] = bf, R = rig[bone].R, p = rig[bone].p, m = f * 9, oo = bone * 12;
      const cols = [R.x, R.y, R.z];
      // rotación: Mᵀ·R
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) O[oo + c * 3 + r] = M[m + r * 3] * cols[c].x + M[m + r * 3 + 1] * cols[c].y + M[m + r * 3 + 2] * cols[c].z;
      const dx = p.x - P[pi * 3], dy = p.y - P[pi * 3 + 1], dz = p.z - P[pi * 3 + 2];
      for (let r = 0; r < 3; r++) O[oo + 9 + r] = M[m + r * 3] * dx + M[m + r * 3 + 1] * dy + M[m + r * 3 + 2] * dz;
    }
    if (o.impulse) this.push(o.impulse, o.rand || Math.random);
  }

  // dirección `ax` del espacio del tronco (x derecha, y arriba, z atrás) en el mundo
  _torsoDir(ax, out) {
    const M = this.M;
    out[0] = M[0] * ax[0] + M[3] * ax[1] + M[6] * ax[2];
    out[1] = M[1] * ax[0] + M[4] * ax[1] + M[7] * ax[2];
    out[2] = M[2] * ax[0] + M[5] * ax[1] + M[8] * ax[2];
    return out;
  }

  /** Velocidad inicial: la del cuerpo y el empujón de la muerte (ver deathImpulse). */
  push(imp, rand = Math.random) {
    const P = this.P, Q = this.Q, h = RAG.h;
    const v0 = imp.vel || { x: 0, y: 0, z: 0 };
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      let vx = v0.x, vy = v0.y, vz = v0.z;
      if (imp.kind === 'shot') {
        let w = SHOT_W[i];
        if (imp.point) {
          const d = Math.sqrt((P[o] - imp.point.x) ** 2 + (P[o + 1] - imp.point.y) ** 2 + (P[o + 2] - imp.point.z) ** 2);
          w += 0.6 * Math.max(0, 1 - d / 0.4);                       // lo que recibe el tiro, más
        }
        let s = imp.speed * w;
        if (i === HE) s += imp.head || 0;
        vx += imp.dir.x * s; vy += imp.dir.y * s * 0.5; vz += imp.dir.z * s;
      } else if (imp.kind === 'blast') {
        let dx = P[o] - imp.point.x, dy = P[o + 1] - imp.point.y, dz = P[o + 2] - imp.point.z;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        dx /= l; dy /= l; dz /= l;
        vx += dx * imp.speed; vy += dy * imp.speed * 0.5 + imp.up; vz += dz * imp.speed;   // más hacia fuera que hacia arriba
      }
      if (i >= gS) { vy += 0.6; if (i === gM) { vx += (rand() - 0.5) * 1.2; vz += (rand() - 0.5) * 1.2; } }   // el arma se suelta
      Q[o] = P[o] - vx * h; Q[o + 1] = P[o + 1] - vy * h; Q[o + 2] = P[o + 2] - vz * h;
    }
    if (imp.kind === 'none') {
      // sin empujón: el tronco cede un poco hacia atrás (como la pose de muerte de la simulación)
      const bk = this._torsoDir([0, 0, 1], _a);
      for (const i of [CH, NE, HE, BK, bladeL, bladeR, pecL, pecR, shL, shR]) { Q[i * 3] -= bk[0] * 0.5 * h; Q[i * 3 + 2] -= bk[2] * 0.5 * h; }
    }
  }

  /** Avanza `dt` segundos en pasos fijos. Devuelve si se ha movido. */
  update(dt, world) {
    if (!this.awake) return false;
    this.acc += Math.min(dt, RAG.maxSteps * RAG.h);
    let n = 0;
    while (this.acc >= RAG.h) { this.acc -= RAG.h; this._step(world); n++; }
    if (!n) return false;
    this._frames();
    if (this.t >= RAG.sleepAfter || this.still >= RAG.restTime) this.awake = false;
    return true;
  }
  sleep() { this.awake = false; }
  /** Algo cambió cerca (se rompió el suelo): vuelve a moverse otros 3 s como mucho. */
  wake() {
    if (this.awake) return;
    this.awake = true; this.t = 0; this.still = 0; this.acc = 0;
    this.Q.set(this.P);
  }

  _step(world) {
    const P = this.P, Q = this.Q, h = RAG.h, g = RAG.g * h * h, air = RAG.air;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      const vx = (P[o] - Q[o]) * air, vy = (P[o + 1] - Q[o + 1]) * air, vz = (P[o + 2] - Q[o + 2]) * air;
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      P[o] += vx; P[o + 1] += vy - g; P[o + 2] += vz;
    }
    if (world) this._contacts(world);
    this.touch.fill(0); this.tn.fill(0);
    for (let k = 0; k < RAG.iters; k++) {
      this._links();
      this._limits();
      this._rigid();
      if (world) this._collide();
    }
    // las articulaciones amortiguan (un brazo o la cabeza no se quedan columpiándose)
    const W = this.W;
    for (let k = 0; k < LI.length; k++) {
      const i = LI[k], j = LJ[k], a = i * 3, b = j * 3, wi = W[i], wj = W[j], c = RAG.joint / (wi + wj);
      for (let e = 0; e < 3; e++) {
        const rv = P[b + e] - Q[b + e] - P[a + e] + Q[a + e];
        Q[a + e] -= c * wi * rv; Q[b + e] += c * wj * rv;
      }
    }
    // en lo que toca: sin rebote y rozando; y ¿está ya en reposo?
    let most = 0, down = 0;
    for (let i = 0; i < NBODY; i++) if (this.touch[i]) down++;
    const keep = 1 - Math.min(1, down / 5) * RAG.ground;
    const N = this.tn;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      if (keep < 1) { Q[o] = P[o] - (P[o] - Q[o]) * keep; Q[o + 1] = P[o + 1] - (P[o + 1] - Q[o + 1]) * keep; Q[o + 2] = P[o + 2] - (P[o + 2] - Q[o + 2]) * keep; }
      if (this.touch[i]) {
        let nx = N[o], ny = N[o + 1], nz = N[o + 2];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        let vx = P[o] - Q[o], vy = P[o + 1] - Q[o + 1], vz = P[o + 2] - Q[o + 2];
        let vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) { vx -= nx * vn; vy -= ny * vn; vz -= nz * vn; vn = 0; }
        // lo que casi no se mueve a lo largo se queda pegado (rozamiento estático: no resbala en la escalera)
        const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
        const f = tx * tx + ty * ty + tz * tz < STICK * STICK * h * h ? 1 : RAG.friction;
        vx -= tx * f; vy -= ty * f; vz -= tz * f;
        Q[o] = P[o] - vx; Q[o + 1] = P[o + 1] - vy; Q[o + 2] = P[o + 2] - vz;
      }
      const ex = P[o] - Q[o], ey = P[o + 1] - Q[o + 1], ez = P[o + 2] - Q[o + 2];
      let s = ex * ex + ey * ey + ez * ez;
      if (s > VMAX * VMAX * h * h) { const k = VMAX * h / Math.sqrt(s); Q[o] = P[o] - ex * k; Q[o + 1] = P[o + 1] - ey * k; Q[o + 2] = P[o + 2] - ez * k; s = VMAX * VMAX * h * h; }
      if (s > most) most = s;
    }
    // lo que haya acabado dentro de un vóxel (arrastrado por una varilla) vuelve a donde estaba
    if (world) for (let i = 0; i < NP; i++) {
      const o = i * 3;
      if (world.isSolid(world.vx(P[o]), world.vy(P[o + 1]), world.vz(P[o + 2]))) { P[o] = Q[o]; P[o + 1] = Q[o + 1]; P[o + 2] = Q[o + 2]; }
    }
    this.t += h;
    this.still = Math.sqrt(most) / h < RAG.restSpeed && this.t > 0.3 ? this.still + h : 0;
  }

  // Contactos de cada partícula para este paso: cada vóxel sólido que toca (o casi) su esfera da un
  // plano que no puede cruzar (el de su cara, su arista o su esquina más cercana). Las aristas y
  // esquinas que están entre dos vóxeles sólidos no cuentan (dentro de un suelo liso no hay bordes).
  _contacts(world) {
    const P = this.P, Q = this.Q, C = this.cn, cc = this.cc;
    for (let i = 0; i < NP; i++) {
      const o = i * 3, r = this.Rd[i], reach = r + 0.04;
      cc[i] = 0;
      let ix = world.vx(P[o]), iy = world.vy(P[o + 1]), iz = world.vz(P[o + 2]);
      if (world.isSolid(ix, iy, iz)) {
        // metida dentro (la arrastró una varilla): vuelve a donde estaba
        P[o] = Q[o]; P[o + 1] = Q[o + 1]; P[o + 2] = Q[o + 2];
        ix = world.vx(P[o]); iy = world.vy(P[o + 1]); iz = world.vz(P[o + 2]);
        if (world.isSolid(ix, iy, iz)) continue;     // (el mundo cambió encima: ya saldrá arrastrada)
      }
      const x = P[o], y = P[o + 1], z = P[o + 2];
      const x0 = world.wx(ix), y0 = world.wy(iy), z0 = world.wz(iz);
      const fx = x - x0, fy = y - y0, fz = z - z0;
      const xa = fx < reach ? -1 : 0, xb = VS - fx < reach ? 1 : 0;
      const ya = fy < reach ? -1 : 0, yb = VS - fy < reach ? 1 : 0;
      const za = fz < reach ? -1 : 0, zb = VS - fz < reach ? 1 : 0;
      let n = 0;
      for (let dy = ya; dy <= yb; dy++) for (let dx = xa; dx <= xb; dx++) for (let dz = za; dz <= zb; dz++) {
        const ord = (dx !== 0) + (dy !== 0) + (dz !== 0);
        if (!ord || !world.isSolid(ix + dx, iy + dy, iz + dz)) continue;
        if (ord > 1 && ((dx && world.isSolid(ix + dx, iy, iz)) || (dy && world.isSolid(ix, iy + dy, iz)) || (dz && world.isSolid(ix, iy, iz + dz)))) continue;
        if (ord > 2 && (world.isSolid(ix + dx, iy + dy, iz) || world.isSolid(ix + dx, iy, iz + dz) || world.isSolid(ix, iy + dy, iz + dz))) continue;
        // punto del vóxel más cercano al centro
        const bx = x0 + dx * VS, by = y0 + dy * VS, bz = z0 + dz * VS;
        const cx = x < bx ? bx : x > bx + VS ? bx + VS : x;
        const cy = y < by ? by : y > by + VS ? by + VS : y;
        const cz = z < bz ? bz : z > bz + VS ? bz + VS : z;
        const ex = x - cx, ey = y - cy, ez = z - cz, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d >= reach || d < 1e-9) continue;
        const k = (i * MAXC + n) * 4, nx = ex / d, ny = ey / d, nz = ez / d;
        C[k] = nx; C[k + 1] = ny; C[k + 2] = nz; C[k + 3] = nx * cx + ny * cy + nz * cz + r;
        if (++n === MAXC) break;
      }
      cc[i] = n;
    }
  }
  // Ninguna partícula cruza sus planos; lo que se apoya justo en uno también toca (así roza)
  _collide() {
    const P = this.P, C = this.cn, cc = this.cc, touch = this.touch, N = this.tn;
    for (let i = 0; i < NP; i++) {
      const n = cc[i];
      if (!n) continue;
      const o = i * 3;
      for (let j = 0; j < n; j++) {
        const k = (i * MAXC + j) * 4, nx = C[k], ny = C[k + 1], nz = C[k + 2];
        const s = nx * P[o] + ny * P[o + 1] + nz * P[o + 2] - C[k + 3];
        if (s > 1e-4) continue;
        if (s < 0) { P[o] -= nx * s; P[o + 1] -= ny * s; P[o + 2] -= nz * s; }
        if (!(touch[i] & (1 << j))) { touch[i] |= 1 << j; N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
      }
    }
  }

  _links() {
    const P = this.P, W = this.W, rest = this.rest, mins = this.mins;
    for (let k = 0; k < LI.length; k++) this._dist(P, W, LI[k], LJ[k], rest[k], false);
    for (let k = 0; k < mins.length; k++) { const m = mins[k]; this._dist(P, W, m[0], m[1], m[2], true); }
  }
  _dist(P, W, i, j, L, minOnly) {
    const a = i * 3, b = j * 3;
    const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9 || (minOnly && d >= L)) return;
    const wa = W[i], wb = W[j];
    // (las mínimas, poco a poco: si algo se cuela, sale sin dar un tirón)
    const s = (minOnly ? Math.max(d - L, -STEP_MAX) : d - L) / (d * (wa + wb));
    P[a] += dx * s * wa; P[a + 1] += dy * s * wa; P[a + 2] += dz * s * wa;
    P[b] -= dx * s * wb; P[b + 1] -= dy * s * wb; P[b + 2] -= dz * s * wb;
  }

  // El tronco vuelve a su forma: el giro que mejor lo encaja (Müller et al. 2016, partiendo del de
  // la vuelta anterior) y cada punto a su sitio. Deja el marco del tronco al día.
  _rigid() {
    const P = this.P, r0 = this.r0, q = this.q;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < TS.length; k++) { const i = TS[k] * 3, m = TM[k]; cx += P[i] * m; cy += P[i + 1] * m; cz += P[i + 2] * m; }
    cx /= TMASS; cy /= TMASS; cz /= TMASS;
    // A = Σ m (p - c) r0ᵀ, por columnas
    let a0x = 0, a0y = 0, a0z = 0, a1x = 0, a1y = 0, a1z = 0, a2x = 0, a2y = 0, a2z = 0;
    for (let k = 0; k < TS.length; k++) {
      const i = TS[k] * 3, m = TM[k];
      const px = (P[i] - cx) * m, py = (P[i + 1] - cy) * m, pz = (P[i + 2] - cz) * m;
      const rx = r0[k * 3], ry = r0[k * 3 + 1], rz = r0[k * 3 + 2];
      a0x += px * rx; a0y += py * rx; a0z += pz * rx;
      a1x += px * ry; a1y += py * ry; a1z += pz * ry;
      a2x += px * rz; a2y += py * rz; a2z += pz * rz;
    }
    let qw = q[0], qx = q[1], qy = q[2], qz = q[3];
    let c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z;
    for (let it = 0; it < 3; it++) {
      c0x = 1 - 2 * (qy * qy + qz * qz); c0y = 2 * (qx * qy + qw * qz); c0z = 2 * (qx * qz - qw * qy);
      c1x = 2 * (qx * qy - qw * qz); c1y = 1 - 2 * (qx * qx + qz * qz); c1z = 2 * (qy * qz + qw * qx);
      c2x = 2 * (qx * qz + qw * qy); c2y = 2 * (qy * qz - qw * qx); c2z = 1 - 2 * (qx * qx + qy * qy);
      if (it === 2) break;
      const den = Math.abs(c0x * a0x + c0y * a0y + c0z * a0z + c1x * a1x + c1y * a1y + c1z * a1z + c2x * a2x + c2y * a2y + c2z * a2z) + 1e-9;
      const ox = (c0y * a0z - c0z * a0y + c1y * a1z - c1z * a1y + c2y * a2z - c2z * a2y) / den;
      const oy = (c0z * a0x - c0x * a0z + c1z * a1x - c1x * a1z + c2z * a2x - c2x * a2z) / den;
      const oz = (c0x * a0y - c0y * a0x + c1x * a1y - c1y * a1x + c2x * a2y - c2y * a2x) / den;
      const w = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (w < 1e-9) break;
      const s = Math.sin(w / 2) / w, dw = Math.cos(w / 2), dx = ox * s, dy = oy * s, dz = oz * s;
      const nw = dw * qw - dx * qx - dy * qy - dz * qz;
      const nx = dw * qx + dx * qw + dy * qz - dz * qy;
      const ny = dw * qy - dx * qz + dy * qw + dz * qx;
      const nz = dw * qz + dx * qy - dy * qx + dz * qw;
      const nl = Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
      qw = nw / nl; qx = nx / nl; qy = ny / nl; qz = nz / nl;
    }
    q[0] = qw; q[1] = qx; q[2] = qy; q[3] = qz;
    for (let k = 0; k < TS.length; k++) {
      const i = TS[k] * 3, rx = r0[k * 3], ry = r0[k * 3 + 1], rz = r0[k * 3 + 2];
      P[i] = cx + c0x * rx + c1x * ry + c2x * rz;
      P[i + 1] = cy + c0y * rx + c1y * ry + c2y * rz;
      P[i + 2] = cz + c0z * rx + c1z * ry + c2z * rz;
    }
    // marco del tronco = giro · marco al morir
    const M = this.M, M0 = this.M0;
    for (let c = 0; c < 3; c++) {
      const x = M0[c * 3], y = M0[c * 3 + 1], z = M0[c * 3 + 2];
      M[c * 3] = c0x * x + c1x * y + c2x * z;
      M[c * 3 + 1] = c0y * x + c1y * y + c2y * z;
      M[c * 3 + 2] = c0z * x + c1z * y + c2z * z;
    }
  }

  // Articulaciones: cuello y muslos dentro de su cono; rodillas y codos sin doblarse al revés
  _limits() {
    const P = this.P, W = this.W, M = this.M;
    for (const [base, tip, ax, cmax, smax] of this.cones) {
      const v = sub3(P, tip, base, _a);
      const L = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      if (L < 1e-6) continue;
      const A = this._torsoDir(ax, _b);
      const c = (v[0] * A[0] + v[1] * A[1] + v[2] * A[2]) / L;
      if (c >= cmax) continue;
      let px = v[0] / L - A[0] * c, py = v[1] / L - A[1] * c, pz = v[2] / L - A[2] * c;
      const pl = Math.sqrt(px * px + py * py + pz * pz);
      if (pl < 1e-6) continue;
      px /= pl; py /= pl; pz /= pl;
      // hacia el borde del cono, poco a poco (si el tronco gira de golpe, sin lanzar la pierna); el
      // tronco cede al revés (el pecho), así una pierna contra el suelo lo endereza en vez de colarse
      const o = tip * 3, ob = base * 3, oc = CH * 3;
      const gx = P[ob] + (A[0] * cmax + px * smax) * L - P[o], gy = P[ob + 1] + (A[1] * cmax + py * smax) * L - P[o + 1], gz = P[ob + 2] + (A[2] * cmax + pz * smax) * L - P[o + 2];
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz), wt = W[tip], k = (gl > STEP_MAX ? STEP_MAX / gl : 1) / (wt + TORSO_W);
      P[o] += gx * k * wt; P[o + 1] += gy * k * wt; P[o + 2] += gz * k * wt;
      P[oc] -= gx * k * TORSO_W; P[oc + 1] -= gy * k * TORSO_W; P[oc + 2] -= gz * k * TORSO_W;
    }
    // rodillas: el muslo mira adelante según la cadera; la espinilla no puede ir hacia delante
    for (const [hip, kn, an] of KNEES) {
      const t = norm3(sub3(P, kn, hip, _a));
      // delante del muslo = derecha del tronco × muslo (+ un poco de delante del tronco)
      const rx = M[0], ry = M[1], rz = M[2];
      let fx = ry * t[2] - rz * t[1] - M[6] * 0.35, fy = rz * t[0] - rx * t[2] - M[7] * 0.35, fz = rx * t[1] - ry * t[0] - M[8] * 0.35;
      const d = fx * t[0] + fy * t[1] + fz * t[2];
      fx -= t[0] * d; fy -= t[1] * d; fz -= t[2] * d;
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fl < 1e-6) continue;
      fx /= fl; fy /= fl; fz /= fl;
      const o = an * 3, ok = kn * 3;
      let c = (P[o] - P[ok]) * fx + (P[o + 1] - P[ok + 1]) * fy + (P[o + 2] - P[ok + 2]) * fz;
      if (c <= 0) continue;
      if (c > STEP_MAX) c = STEP_MAX;
      const wa = W[an], wk = W[kn], s = c / (wa + wk);
      P[o] -= fx * s * wa; P[o + 1] -= fy * s * wa; P[o + 2] -= fz * s * wa;
      P[ok] += fx * s * wk; P[ok + 1] += fy * s * wk; P[ok + 2] += fz * s * wk;
    }
    // codos: el antebrazo, hacia el lado al que ya se doblaba (en el marco arrastrado del brazo)
    for (const [k, f, sh, el, wr] of ELBOWS) {
      const a = norm3(sub3(P, el, sh, _a)), m = f * 9, b = this.bend, o3 = k * 3;
      let sx = M[m] * b[o3] + M[m + 3] * b[o3 + 1] + M[m + 6] * b[o3 + 2];
      let sy = M[m + 1] * b[o3] + M[m + 4] * b[o3 + 1] + M[m + 7] * b[o3 + 2];
      let sz = M[m + 2] * b[o3] + M[m + 5] * b[o3 + 1] + M[m + 8] * b[o3 + 2];
      const d = sx * a[0] + sy * a[1] + sz * a[2];
      sx -= a[0] * d; sy -= a[1] * d; sz -= a[2] * d;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl < 1e-6) continue;
      sx /= sl; sy /= sl; sz /= sl;
      const o = wr * 3, oe = el * 3;
      let c = (P[o] - P[oe]) * sx + (P[o + 1] - P[oe + 1]) * sy + (P[o + 2] - P[oe + 2]) * sz;
      if (c >= 0) continue;
      if (c < -STEP_MAX) c = -STEP_MAX;
      const ww = W[wr], we = W[el], s = c / (ww + we);
      P[o] -= sx * s * ww; P[o + 1] -= sy * s * ww; P[o + 2] -= sz * s * ww;
      P[oe] += sx * s * we; P[oe + 1] += sy * s * we; P[oe + 2] += sz * s * we;
    }
  }

  // Todos los marcos desde las partículas (el del tronco lo deja _rigid)
  _frames() {
    const P = this.P, M = this.M;
    if (this.t === 0) this.M.set(this.M0, F.torso * 9);
    // cabeza: del cuello a su centro, con la derecha del tronco
    _b[0] = M[0]; _b[1] = M[1]; _b[2] = M[2];
    basisUp(M, F.head * 9, sub3(P, HE, NE, _a), _b);
    // brazos: su nuevo eje, conservando el giro que traían
    for (const [f, a, b] of CARRIED) {
      const d = norm3(sub3(P, b, a, _a));
      _b[0] = M[f * 9 + 6]; _b[1] = M[f * 9 + 7]; _b[2] = M[f * 9 + 8];
      basisDown(M, f * 9, d, _b);
    }
    // piernas: el muslo mira adelante según la cadera; la espinilla, hacia donde apunta el pie
    for (const [ft, fs, ff, hip, kn, an, toe] of LEGS) {
      const t = norm3(sub3(P, kn, hip, _a));
      _b[0] = M[1] * t[2] - M[2] * t[1] - M[6] * 0.35; _b[1] = M[2] * t[0] - M[0] * t[2] - M[7] * 0.35; _b[2] = M[0] * t[1] - M[1] * t[0] - M[8] * 0.35;
      basisDown(M, ft * 9, t, _b);
      const foot = sub3(P, toe, an, _c);
      basisDown(M, fs * 9, norm3(sub3(P, an, kn, _a)), foot);
      basisForward(M, ff * 9, foot, sub3(P, kn, an, _b));
    }
    basisForward(M, F.gun * 9, sub3(P, gM, gS, _a), sub3(P, gT, gB, _b));
  }

  /** Escribe las matrices de los huesos (como rigToMatrices; el cargador, 19, lo pone el dibujo). */
  write(out) {
    const P = this.P, M = this.M, O = this.O;
    for (let bone = 0; bone < BONE_COUNT; bone++) {
      const bf = BONE_FRAME[bone];
      if (!bf) continue;
      const [f, pi] = bf, m = f * 9, oo = bone * 12, w = bone * 16;
      for (let c = 0; c < 3; c++) {
        const a = O[oo + c * 3], b = O[oo + c * 3 + 1], d = O[oo + c * 3 + 2];
        out[w + c * 4] = M[m] * a + M[m + 3] * b + M[m + 6] * d;
        out[w + c * 4 + 1] = M[m + 1] * a + M[m + 4] * b + M[m + 7] * d;
        out[w + c * 4 + 2] = M[m + 2] * a + M[m + 5] * b + M[m + 8] * d;
        out[w + c * 4 + 3] = 0;
      }
      const tx = O[oo + 9], ty = O[oo + 10], tz = O[oo + 11];
      out[w + 12] = P[pi * 3] + M[m] * tx + M[m + 3] * ty + M[m + 6] * tz;
      out[w + 13] = P[pi * 3 + 1] + M[m + 1] * tx + M[m + 4] * ty + M[m + 7] * tz;
      out[w + 14] = P[pi * 3 + 2] + M[m + 2] * tx + M[m + 5] * ty + M[m + 8] * tz;
      out[w + 15] = 1;
    }
  }

  /** Posición de una partícula (para las pruebas y la mancha de contacto). */
  at(i) { return { x: this.P[i * 3], y: this.P[i * 3 + 1], z: this.P[i * 3 + 2] }; }
  /** Lo más bajo del cuerpo (donde toca el suelo). */
  floorY() { let y = Infinity; for (let i = 0; i < NBODY; i++) y = Math.min(y, this.P[i * 3 + 1] - this.Rd[i]); return y; }
}

export { LINKS as RAG_LINKS, MINS as RAG_MINS };

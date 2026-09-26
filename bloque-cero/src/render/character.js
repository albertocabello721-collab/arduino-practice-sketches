// Modelos de operadores tácticos: una malla por personaje con "piel rígida" (cada
// vértice pertenece a un hueso) y la pose calculada por el esqueleto de la
// simulación. Misma iluminación que el mundo (volumen de luz + sombra del sol).
import * as THREE from 'three';
import { BONE, BONE_COUNT } from '../sim/skeleton.js';
import { LIGHTING_GLSL } from './shaders.js';
import { KITS, BUILDS } from './kits.js';

// ------------------------------------------------------------ camuflaje procedural
function makeCamoTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S * 2; cv.height = S;
  const c = cv.getContext('2d');
  const blobs = (x0, cols, n, rmin, rmax, seed) => {
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (const col of cols) {
      c.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const x = rnd() * S, y = rnd() * S, r = rmin + rnd() * (rmax - rmin);
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          c.beginPath();
          c.ellipse(x0 + x + ox, y + oy, r * (0.6 + rnd() * 0.8), r * (0.4 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  };
  // patrón A: multiterreno (arena, marrón, verde oliva)
  c.fillStyle = '#b8a47e'; c.fillRect(0, 0, S, S);
  blobs(0, ['#8d7a55', '#6b6a42', '#5a4632', '#cbbb94'], 26, 6, 22, 7);
  // patrón B: urbano (grises)
  c.fillStyle = '#8c9094'; c.fillRect(S, 0, S, S);
  blobs(S, ['#6a6e73', '#4b4f54', '#a9adb1', '#3a3d41'], 26, 5, 20, 13);
  c.save(); c.beginPath(); c.rect(0, 0, S, S); c.clip(); c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------ constructor de geometría
class RigBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.bone = []; this.mat = []; this.uv = []; this.gear = []; }
  // gear: equipo que sobresale del cuerpo (mochilas, antenas…), fuera de las zonas de impacto
  add(boneIdx, geo, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color = '#777777', rough = 0.8, metal = 0, camo = 0, gear = false } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = g.attributes.position, n = g.attributes.normal;
    const cl = new THREE.Color(color).convertSRGBToLinear();
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(w.x, w.y, w.z);
      this.col.push(cl.r, cl.g, cl.b);
      this.bone.push(boneIdx);
      this.mat.push(rough, metal, camo, 0);
      this.uv.push((v.x + v.z) * 2.2, v.y * 2.2);
      this.gear.push(gear ? 1 : 0);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
    // lo que no se sube a la tarjeta: qué vértices son equipo (para las pruebas) y hasta dónde
    // llega por detrás lo que va a la espalda (el arma principal colgada va por fuera)
    let backZ = 0.135, gunIn = 0;
    for (let i = 0; i < this.bone.length; i++) {
      const y = this.pos[i * 3 + 1];
      if (this.gear[i] && this.bone[i] === BONE.chest && y > -0.15 && y < 0.35) backZ = Math.max(backZ, this.pos[i * 3 + 2]);
      if (this.bone[i] === BONE.gun || this.bone[i] === BONE.mag) gunIn = Math.min(gunIn, this.pos[i * 3]);
    }
    // (colgada, la cara -X del arma mira a la espalda: ver SLING)
    g.userData = { gear: Uint8Array.from(this.gear), backZ, sling: backZ - gunIn + 0.005 };
    return g;
  }
}
// forma de una pieza de kits.js → geometría
function shapeGeo(s) {
  if (s[0] === 'box') return Box(s[1], s[2], s[3]);
  if (s[0] === 'cyl') return Cyl(s[1], s[2], s[3], s[4]);
  return Sph(s[1], s[2], s[3], s[4], s[5]);
}
const HALF_PI = Math.PI / 2;
const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (r1, r2, h, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s);
const Sph = (r, ws = 12, hs = 9, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, ts, tl);

// Aspecto de cada operador: colores, casco y accesorios.
export function defaultLook(team, variant = 0) {
  const atk = team === 0;
  const looks = atk ? [
    { shirt: '#6f6a58', pants: '#7d7155', vest: '#8b7a55', helmet: '#7a6d52', gloves: '#3b352c', boots: '#3a2f25', skin: '#b98a6a', camo: 1, head: 'helmet', face: 'goggles' },
    { shirt: '#4d5347', pants: '#5a5f4a', vest: '#4f5541', helmet: '#4a4f3f', gloves: '#2b2b27', boots: '#2a2622', skin: '#8d5f45', camo: 1, head: 'helmet', face: 'mask' },
    { shirt: '#5c5445', pants: '#6b6048', vest: '#766645', helmet: '#3d3a33', gloves: '#302b25', boots: '#33291f', skin: '#d0a07d', camo: 0, head: 'cap', face: 'glasses' },
  ] : [
    { shirt: '#39414f', pants: '#3b4250', vest: '#2d333d', helmet: '#262b33', gloves: '#1f1f21', boots: '#1c1c1e', skin: '#c49474', camo: 2, head: 'helmet', face: 'mask' },
    { shirt: '#4a4f58', pants: '#4f545c', vest: '#3a3f47', helmet: '#30353c', gloves: '#222224', boots: '#1e1e20', skin: '#6e4a36', camo: 2, head: 'helmet', face: 'goggles' },
    { shirt: '#2f3540', pants: '#343a45', vest: '#454a52', helmet: '#1f2328', gloves: '#1b1b1d', boots: '#19191b', skin: '#e0b494', camo: 0, head: 'hood', face: 'mask' },
  ];
  return { ...looks[variant % looks.length], accent: team === 0 ? TEAM_ACCENT[0] : TEAM_ACCENT[1] };
}

// Colores de equipo como en Siege: el tuyo azul, el rival naranja.
export const TEAM_ACCENT = ['#3d9be9', '#f0892b'];

// Aspecto de un operador de la plantilla (sim/operators.js) para un equipo: sus colores, la
// complexión de su blindaje y su objeto propio (render/kits.js).
export function operatorLook(def, team) {
  const kit = KITS[def.id];
  return { ...def.look, ...(kit && kit.look), armor: def.armor, kit: kit ? def.id : null, accent: TEAM_ACCENT[team === 0 ? 0 : 1] };
}

export function buildOperatorGeometry(look, primaryModel, secondaryModel) {
  const b = new RigBuilder();
  const L = look;
  // complexión según el blindaje (render/kits.js): 1 ligero · 2 medio (la de siempre) · 3 pesado
  const K = BUILDS[L.armor] || BUILDS[2];
  const lite = !K.plate, heavy = !!K.heavy;
  const kit = L.kit ? KITS[L.kit] : null;
  // ---------------- pelvis y cinturón
  b.add(BONE.pelvis, Box(0.34, 0.2, 0.22), { at: [0, -0.03, 0], color: L.pants, camo: L.camo, rough: 0.9 });
  b.add(BONE.pelvis, Box(0.36, 0.055, 0.24), { at: [0, 0.06, 0], color: '#23211e', rough: 0.6 });
  b.add(BONE.pelvis, Box(0.06, 0.08, 0.09), { at: [-0.19, 0.02, 0.02], color: L.vest, rough: 0.85 });
  b.add(BONE.pelvis, Box(0.1, 0.09, 0.06), { at: [0.09, 0.02, 0.14], color: L.vest, rough: 0.85 });
  if (heavy) b.add(BONE.pelvis, Box(0.16, 0.12, 0.03), { at: [0, -0.06, -0.13], color: L.vest, rough: 0.85 });   // protector de ingle
  // ---------------- abdomen
  b.add(BONE.spine, Box(0.31, 0.24, 0.2), { at: [0, 0.1, 0.005], color: L.shirt, camo: L.camo, rough: 0.9 });
  b.add(BONE.spine, Box(...K.band), { at: [0, 0.15, 0], color: L.vest, rough: 0.85 });
  for (const x of K.pouches) {
    const pz = lite ? -0.125 : -0.14;
    b.add(BONE.spine, Box(lite ? 0.07 : 0.075, lite ? 0.11 : 0.13, lite ? 0.045 : 0.055), { at: [x, 0.15, pz], color: L.vest, rough: 0.85 });
    b.add(BONE.spine, Box(0.06, 0.03, 0.045), { at: [x, lite ? 0.205 : 0.22, pz], color: '#1b1b1b', rough: 0.6 });
  }
  // ---------------- pecho y portaplacas
  b.add(BONE.chest, Box(0.37, 0.28, 0.21), { at: [0, 0.12, 0], color: L.shirt, camo: L.camo, rough: 0.9 });
  b.add(BONE.chest, Box(...K.vest), { at: [0, 0.1, 0], color: L.vest, rough: 0.85 });
  let front;       // cara delantera del chaleco a la altura del parche
  if (K.plate) {
    const [w, h, d, z] = K.plate;
    b.add(BONE.chest, Box(w, h, d), { at: [0, 0.1, z], color: L.vest, rough: 0.8 });
    front = z - d / 2;
  } else {
    // ligero: arnés con bolsillos en vez de placa
    b.add(BONE.chest, Box(0.28, 0.13, 0.04), { at: [0, 0.05, -0.125], color: L.vest, rough: 0.8 });
    for (const x of [-0.08, 0, 0.08]) b.add(BONE.chest, Box(0.065, 0.08, 0.03), { at: [x, 0.03, -0.155], color: L.vest, rough: 0.85 });
    front = -K.vest[2] / 2;
  }
  if (heavy) for (const s of [-1, 1]) b.add(BONE.chest, Box(0.035, 0.2, 0.2), { at: [s * 0.212, 0.08, 0], color: L.vest, rough: 0.8 });   // placas laterales
  // (las cintas pasan por encima de los hombros, fuera de las zonas de impacto)
  b.add(BONE.chest, Box(0.08, 0.26, 0.05), { at: [-0.13, 0.24, -0.02], color: L.vest, rough: 0.85, gear: true });
  b.add(BONE.chest, Box(0.08, 0.26, 0.05), { at: [0.13, 0.24, -0.02], color: L.vest, rough: 0.85, gear: true });
  b.add(BONE.chest, Box(0.05, 0.11, 0.04), { at: [-0.13, 0.2, front + 0.0075], color: '#151515', rough: 0.5, metal: 0.2 });   // radio
  b.add(BONE.chest, Cyl(0.006, 0.006, 0.16, 5), { at: [-0.13, 0.32, front + 0.0125], color: '#101010', rough: 0.5, gear: true });   // antena
  b.add(BONE.chest, Box(0.07, 0.05, 0.035), { at: [0.1, 0.19, front + 0.0025], color: L.accent, rough: 0.6 });                  // parche de equipo
  if (!kit || kit.pack !== false) {
    b.add(BONE.chest, Box(0.27, 0.28, 0.12), { at: [0, 0.08, 0.18], color: L.vest, rough: 0.85, gear: true });                  // mochila
    b.add(BONE.chest, Box(0.2, 0.08, 0.1), { at: [0, 0.25, 0.17], color: '#2a2824', rough: 0.8, gear: true });
  }
  b.add(BONE.chest, Box(0.22, 0.07, 0.19), { at: [0, 0.265, 0], color: L.shirt, rough: 0.9 });                       // cuello de la camisa
  if (heavy) {
    b.add(BONE.chest, Box(0.3, 0.07, 0.24), { at: [0, 0.275, 0.005], color: L.vest, rough: 0.85 });                 // protector de cuello
    b.add(BONE.chest, Box(0.14, 0.09, 0.03), { at: [0, 0.265, -0.135], color: L.vest, rough: 0.8 });                // y de garganta
  }
  // ---------------- cuello y cabeza
  const masked = L.face === 'mask' || L.face === 'gas1' || L.face === 'gas2';
  b.add(BONE.neck, Cyl(0.062, 0.07, 0.12), { at: [0, 0.04, 0], color: masked ? '#1d1d1f' : L.skin, rough: 0.9 });
  const headColor = masked ? '#1e1e20' : L.skin;
  b.add(BONE.head, Sph(0.1, 14, 10), { at: [0, 0.1, 0.0], scale: [1, 1.13, 1.08], color: headColor, rough: 0.85 });
  if (!masked) {
    b.add(BONE.head, Box(0.05, 0.03, 0.035), { at: [0, 0.07, -0.105], color: L.skin, rough: 0.7 });           // nariz
  } else if (L.face === 'mask') {
    b.add(BONE.head, Box(0.13, 0.035, 0.02), { at: [0, 0.115, -0.1], color: L.skin, rough: 0.7 });           // franja de ojos
  } else {
    // máscara de gas: morro, dos visores redondos y el filtro (uno grande delante o dos a los lados)
    b.add(BONE.head, Box(0.1, 0.075, 0.045), { at: [0, 0.055, -0.1], color: '#18191a', rough: 0.6 });
    for (const s of [-1, 1]) b.add(BONE.head, Cyl(0.026, 0.026, 0.012, 10), { at: [s * 0.04, 0.12, -0.103], rot: [-HALF_PI, 0, 0], color: '#10161b', rough: 0.08, metal: 0.4 });
    if (L.face === 'gas1') {
      b.add(BONE.head, Cyl(0.048, 0.052, 0.055, 10), { at: [0, 0.045, -0.13], rot: [-HALF_PI, 0, 0], color: '#1b1c1b', rough: 0.6 });
      b.add(BONE.head, Cyl(0.05, 0.05, 0.008, 10), { at: [0, 0.045, -0.158], rot: [-HALF_PI, 0, 0], color: '#5f656b', rough: 0.5, metal: 0.3 });
    } else {
      for (const s of [-1, 1]) b.add(BONE.head, Cyl(0.034, 0.034, 0.05, 8), { at: [s * 0.062, 0.045, -0.118], rot: [-HALF_PI, 0, -s * 0.6], color: '#2a2d30', rough: 0.6 });
    }
  }
  if (L.face === 'goggles') {
    b.add(BONE.head, Box(0.17, 0.055, 0.035), { at: [0, 0.125, -0.098], color: '#10161b', rough: 0.08, metal: 0.4 });
    b.add(BONE.head, Box(0.19, 0.022, 0.19), { at: [0, 0.125, 0.0], color: '#1a1a1a', rough: 0.6 });
  } else if (L.face === 'glasses') {
    b.add(BONE.head, Box(0.15, 0.035, 0.02), { at: [0, 0.12, -0.105], color: '#0b0e10', rough: 0.05, metal: 0.5 });
  } else if (L.face === 'monocle') {
    // cámara sobre el ojo derecho (cuerpo claro, lente oscura), sujeta al auricular
    b.add(BONE.head, Box(0.014, 0.016, 0.1), { at: [0.1, 0.13, -0.055], rot: [0, -0.3, 0], color: '#1a1a1a', rough: 0.5 });
    b.add(BONE.head, Box(0.05, 0.045, 0.07), { at: [0.07, 0.13, -0.105], color: '#b3b8bc', rough: 0.45, metal: 0.3 });
    b.add(BONE.head, Cyl(0.02, 0.02, 0.012, 8), { at: [0.07, 0.13, -0.144], rot: [-HALF_PI, 0, 0], color: '#10161b', rough: 0.08, metal: 0.5 });
  }
  if (L.head === 'helmet') {
    b.add(BONE.head, Sph(0.128, 16, 9, 0, Math.PI * 0.55), { at: [0, 0.118, 0.008], scale: [1.02, 0.95, 1.1], color: L.helmet, rough: 0.7 });
    b.add(BONE.head, Cyl(0.132, 0.132, 0.022, 16), { at: [0, 0.12, 0.008], scale: [1.02, 1, 1.1], color: L.helmet, rough: 0.7 });
    if (L.nvg !== false) b.add(BONE.head, Box(0.05, 0.04, 0.03), { at: [0, 0.2, -0.13], color: '#161616', rough: 0.5, metal: 0.5 });  // montura NVG
    b.add(BONE.head, Box(0.02, 0.03, 0.12), { at: [-0.13, 0.15, -0.01], color: '#1c1c1c', rough: 0.5 });          // raíles
    b.add(BONE.head, Box(0.02, 0.03, 0.12), { at: [0.13, 0.15, -0.01], color: '#1c1c1c', rough: 0.5 });
    b.add(BONE.head, Box(0.03, 0.06, 0.02), { at: [0.09, 0.22, 0.1], color: L.accent, rough: 0.6 });              // baliza IR de equipo
  } else if (L.head === 'heavy') {
    // casco pesado con visera que tapa la cara
    b.add(BONE.head, Sph(0.135, 16, 9, 0, Math.PI * 0.55), { at: [0, 0.118, 0.01], scale: [1.05, 0.98, 1.1], color: L.helmet, rough: 0.65 });
    b.add(BONE.head, Cyl(0.136, 0.136, 0.03, 16), { at: [0, 0.12, 0.01], scale: [1.05, 1, 1.08], color: L.helmet, rough: 0.65 });
    b.add(BONE.head, Box(0.22, 0.17, 0.018), { at: [0, 0.075, -0.142], rot: [-0.1, 0, 0], color: '#1f272b', rough: 0.12, metal: 0.35 });   // visera
    for (const s of [-1, 1]) b.add(BONE.head, Cyl(0.022, 0.022, 0.02, 8), { at: [s * 0.14, 0.12, -0.07], rot: [0, 0, HALF_PI], color: '#161616', rough: 0.5, metal: 0.5 });   // bisagras
    b.add(BONE.head, Box(0.03, 0.06, 0.02), { at: [0.09, 0.225, 0.1], color: L.accent, rough: 0.6 });             // baliza IR de equipo
  } else if (L.head === 'cap') {
    b.add(BONE.head, Sph(0.112, 14, 8, 0, Math.PI * 0.5), { at: [0, 0.13, 0.005], scale: [1, 0.85, 1.08], color: L.helmet, rough: 0.9 });
    b.add(BONE.head, Box(0.16, 0.012, 0.09), { at: [0, 0.135, -0.13], color: L.helmet, rough: 0.9 });
  } else if (L.head === 'hood') {
    b.add(BONE.head, Sph(0.125, 14, 10, 0, Math.PI * 0.65), { at: [0, 0.105, 0.02], scale: [1.05, 1.1, 1.12], color: L.shirt, rough: 0.95 });
  } else if (L.head === 'boonie') {
    // sombrero de ala ancha
    b.add(BONE.head, Cyl(0.1, 0.11, 0.08, 12), { at: [0, 0.205, 0.005], color: L.helmet, camo: L.camo, rough: 0.95 });
    b.add(BONE.head, Cyl(0.21, 0.21, 0.012, 14), { at: [0, 0.168, 0.005], color: L.helmet, camo: L.camo, rough: 0.95, gear: true });
  }
  // cascos de comunicación
  for (const s of [-1, 1]) b.add(BONE.head, Cyl(0.045, 0.045, 0.04, 12), { at: [s * 0.112, 0.1, 0.0], rot: [0, 0, Math.PI / 2], color: '#1a1a1a', rough: 0.5 });
  // ---------------- brazos
  for (const [ua, fa, hd, s] of [[BONE.uarmL, BONE.farmL, BONE.handL, -1], [BONE.uarmR, BONE.farmR, BONE.handR, 1]]) {
    b.add(ua, Cyl(0.06, 0.052, 0.3), { at: [0, -0.145, 0], color: L.shirt, camo: L.camo, rough: 0.9 });
    b.add(ua, Cyl(0.064, 0.064, 0.045), { at: [0, -0.07, 0], color: L.accent, rough: 0.6 });                  // brazalete
    if (heavy) {
      b.add(ua, Box(0.19, 0.095, 0.18), { at: [0, -0.005, 0], color: L.vest, rough: 0.85 });                  // hombrera grande
      b.add(ua, Box(0.14, 0.07, 0.14), { at: [s * 0.005, -0.15, 0], color: L.vest, rough: 0.85 });           // y protección del brazo (bajo el brazalete)
    } else if (K.pads) {
      b.add(ua, Box(0.12, 0.08, 0.13), { at: [s * 0.01, -0.01, 0], color: L.vest, rough: 0.85 });             // hombrera
    }
    b.add(fa, Cyl(0.05, 0.042, 0.27), { at: [0, -0.13, 0], color: L.shirt, camo: L.camo, rough: 0.9 });
    b.add(fa, Cyl(0.047, 0.047, 0.05), { at: [0, -0.25, 0], color: L.gloves, rough: 0.8 });
    b.add(hd, Box(0.075, 0.1, 0.05), { at: [0, -0.05, 0.01], color: L.gloves, rough: 0.8 });
    b.add(hd, Box(0.07, 0.05, 0.035), { at: [0, -0.1, 0.03], color: L.gloves, rough: 0.8 });
  }
  // ---------------- piernas (su +X mira a la izquierda del personaje: lo de fuera va a -s)
  for (const [th, sh, ft, s] of [[BONE.thighL, BONE.shinL, BONE.footL, -1], [BONE.thighR, BONE.shinR, BONE.footR, 1]]) {
    b.add(th, Cyl(0.088, 0.07, 0.44), { at: [0, -0.215, 0], color: L.pants, camo: L.camo, rough: 0.9 });
    b.add(th, Box(0.06, 0.12, 0.1), { at: [-s * 0.085, -0.2, 0], color: L.vest, rough: 0.85 });             // bolsillo lateral
    if (heavy) b.add(th, Box(0.13, 0.17, 0.025), { at: [0, -0.13, 0.085], color: L.vest, rough: 0.85 });      // placa del muslo
    b.add(sh, Cyl(0.068, 0.055, 0.44), { at: [0, -0.2, 0], color: L.pants, camo: L.camo, rough: 0.9 });
    b.add(sh, Box(0.1, 0.12, 0.05), { at: [0, -0.04, 0.07], color: '#1c1c1c', rough: 0.6 });                  // rodillera
    b.add(sh, Cyl(0.064, 0.062, 0.15), { at: [0, -0.37, 0], color: L.boots, rough: 0.7 });
    b.add(ft, Box(0.11, 0.09, 0.27), { at: [0, -0.03, -0.06], color: L.boots, rough: 0.7 });
    b.add(ft, Box(0.115, 0.025, 0.28), { at: [0, -0.075, -0.06], color: '#101010', rough: 0.9 });
  }
  // funda en el muslo derecho, por fuera (la pistola se coloca ahí al dibujar: ver HOLSTER_OUT)
  b.add(BONE.thighR, Box(0.05, 0.16, 0.09), { at: [-0.1, -0.13, 0.0], color: '#1b1b1b', rough: 0.6 });
  // ---------------- objeto propio del operador
  if (kit) for (const [bone, shape, o] of kit.parts(L)) b.add(bone, shapeGeo(shape), o);
  // ---------------- armas (ranuras: 17 = arma principal, 18 = secundaria; el cargador de la
  // principal va en su propio hueso, 19, para sacarlo al recargar)
  addWeapon(b, BONE.gun, primaryModel, BONE.mag);
  addWeapon(b, BONE.holster, secondaryModel, BONE.holster);
  return b.build();
}

// Cargadores en tercera persona: dónde van en el arma (su centro, en el espacio del arma), su
// tamaño y su color. Los usa el modelo, la mano al recargar y el que cae al suelo (thirdPersonMag).
export const MAG_3P = {
  rifle: { at: [0, -0.07, -0.09], rot: 0.15, size: [0.03, 0.13, 0.055], color: '#1b1d20' },
  mpistol: { at: [0, -0.1, 0.0], rot: 0, size: [0.025, 0.12, 0.03], color: '#1b1d20' },
  pistol: { at: [0, -0.07, 0.01], rot: -0.2, size: [0.026, 0.1, 0.034], color: '#1b1d20' },
  lmg: { at: [-0.02, -0.04, -0.12], rot: 0, size: [0.1, 0.1, 0.12], color: '#3f4535' },
};
const magKind = (model) => (model === 'lmg' ? 'lmg' : model === 'mpistol' ? 'mpistol' : model === 'pistol' ? 'pistol' : model === 'revolver' || model === 'shotgun' ? null : 'rifle');
const linColor = (hex) => { const c = new THREE.Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b]; };
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();

/**
 * Lo que suelta un operador visto en tercera persona en la parte `part` de su recarga ('magOut':
 * el cargador; 'eject': los casquillos del revólver), en el mundo y desde su pose (la del arma de
 * la simulación): [{kind, pos, quat, size, color}], como ViewModel.released.
 */
export function thirdPersonDrops(op, part) {
  const g = op.rig && op.rig[BONE.gun];
  if (!g) return [];
  const R = g.R;
  const W = (x, y, z) => new THREE.Vector3(g.p.x + R.x.x * x + R.y.x * y + R.z.x * z, g.p.y + R.x.y * x + R.y.y * y + R.z.y * z, g.p.z + R.x.z * x + R.y.z * y + R.z.z * z);
  const quat = new THREE.Quaternion().setFromRotationMatrix(_bm.makeBasis(_bx.set(R.x.x, R.x.y, R.x.z), _by.set(R.y.x, R.y.y, R.y.z), _bz.set(R.z.x, R.z.y, R.z.z)));
  if (part === 'magOut') {
    const M = MAG_3P[magKind(op.weapon.def.model)];
    return M ? [{ kind: 'mag', pos: W(...M.at), quat, size: M.size.slice(), color: linColor(M.color) }] : [];
  }
  if (part === 'eject' && op.weapon.def.model === 'revolver') {
    const c = W(0, 0.03, -0.02), out = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push({ kind: 'casing', pos: c.clone().add(new THREE.Vector3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0).applyQuaternion(quat)), quat: quat.clone(), size: [0.011, 0.011, 0.034], color: [0.62, 0.45, 0.17] });
    }
    return out;
  }
  return [];
}

// Armas en tercera persona (empuñadura en el origen, cañón hacia -Z). El cargador va en `magBone`.
function addWeapon(b, bone, model, magBone = bone) {
  const dark = { color: '#1b1d20', rough: 0.45, metal: 0.55 };
  const poly = { color: '#262829', rough: 0.7, metal: 0.05 };
  const A = (geo, at, o = dark, rot = [0, 0, 0]) => b.add(bone, geo, { at, rot, ...o });
  const pistolish = model === 'pistol' || model === 'revolver' || model === 'mpistol';
  if (pistolish) {
    A(Box(0.03, 0.1, 0.045), [0, -0.05, 0.01], poly, [-0.2, 0, 0]);
    if (model === 'revolver') { A(Cyl(0.02, 0.02, 0.045, 8), [0, 0.03, -0.02], dark, [Math.PI / 2, 0, 0]); A(Cyl(0.009, 0.009, 0.16, 6), [0, 0.035, -0.12], dark, [Math.PI / 2, 0, 0]); }
    else { A(Box(0.03, 0.035, model === 'mpistol' ? 0.2 : 0.18), [0, 0.025, -0.07]); if (model === 'mpistol') b.add(magBone, Box(0.025, 0.12, 0.03), { at: [0, -0.1, 0.0], ...dark }); }
    return;
  }
  const long = { ar: 0.62, ar2: 0.68, smg: 0.48, smg2: 0.42, lmg: 0.78, dmr: 0.85, shotgun: 0.74 }[model] || 0.6;
  A(Box(0.05, 0.075, 0.3), [0, 0.03, -0.1]);                                   // cajón
  A(Box(0.055, 0.06, long * 0.36), [0, 0.03, -0.25 - long * 0.18], poly);     // guardamanos
  A(Cyl(0.011, 0.011, long * 0.4, 8), [0, 0.04, -0.3 - long * 0.36], dark, [Math.PI / 2, 0, 0]);  // cañón
  A(Box(0.035, 0.1, 0.045), [0, -0.045, 0.02], poly, [-0.25, 0, 0]);          // empuñadura
  A(Box(0.045, 0.07, 0.22), [0, 0.01, 0.18], poly);                           // culata
  if (model === 'lmg') { b.add(magBone, Box(0.1, 0.1, 0.12), { at: [-0.02, -0.04, -0.12], color: MAG_3P.lmg.color, rough: 0.6, metal: 0.2 }); A(Cyl(0.006, 0.006, 0.25, 5), [0.03, -0.08, -0.55], dark, [0.8, 0, 0]); }
  else if (model === 'shotgun') A(Cyl(0.017, 0.017, 0.3, 8), [0, 0.0, -0.3], poly, [Math.PI / 2, 0, 0]);
  else b.add(magBone, Box(0.03, 0.13, 0.055), { at: [0, -0.07, -0.09], rot: [0.15, 0, 0], ...dark });        // cargador
  if (model === 'dmr' || model === 'ar2') A(Cyl(0.02, 0.02, 0.16, 10), [0, 0.1, -0.06], dark, [Math.PI / 2, 0, 0]);  // visor
  else A(Box(0.04, 0.05, 0.06), [0, 0.1, -0.05], dark);                       // mira holográfica
}

// ------------------------------------------------------------ material
const CHAR_VERT = /* glsl */ `
precision highp float;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uBones[${BONE_COUNT}];
in vec3 position;
in vec3 normal;
in vec3 color;
in float aBone;
in vec4 aMat;
in vec2 aUV;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec4 vMat; out vec2 vUV;
void main() {
  mat4 B = uBones[int(aBone + 0.5)];
  vec4 wp = B * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(B) * normal);
  vColor = color; vMat = aMat; vUV = aUV;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CHAR_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D uCamo;
uniform vec3 cameraPosition;
uniform float uHit;
uniform float uDim;
uniform float uHeat;
${LIGHTING_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec4 vMat; in vec2 vUV;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (uHeat > 0.5) {
    // visor térmico: el cuerpo en colores de calor (bordes rojos, centro amarillo casi blanco)
    float core = pow(max(dot(n, V), 0.0), 0.7);
    vec3 heat = mix(vec3(0.75, 0.08, 0.04), vec3(1.0, 0.72, 0.18), core);
    heat = mix(heat, vec3(1.0, 0.97, 0.8), smoothstep(0.82, 1.0, core));
    fragColor = vec4(heat * 1.7, 1.0);
    return;
  }
  vec3 albedo = vColor;
  if (vMat.z > 0.5) {
    vec2 uv = fract(vUV * 0.5);
    uv.x = uv.x * 0.5 + (vMat.z > 1.5 ? 0.5 : 0.0);
    vec3 camo = texture(uCamo, uv).rgb;
    albedo = mix(albedo, camo * (albedo / max(0.001, dot(albedo, vec3(0.3333)))) * 0.5 + camo * 0.5, 0.75);
  }
  float sunVis = shadowAt(vWorld, n);
  vec3 col = shade(vWorld, n, n, V, albedo * uDim, vMat.x, vMat.y, 1.0, sunVis);
  // borde iluminado para leer la silueta (como en los shooters tácticos)
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += ambientAt(vWorld, n) * rim * 0.25;
  col = mix(col, vec3(0.6, 0.02, 0.01), uHit * 0.35);
  col = applyFog(col, length(cameraPosition - vWorld), vWorld);
  fragColor = vec4(col, 1.0);
}
`;

// Arma principal colgada a la espalda (en el espacio del pecho): el cañón en diagonal, con la boca
// por encima del hombro izquierdo, y el costado del arma contra la espalda.
const SLING = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.85, -0.5, 0).normalize(), new THREE.Vector3(0.5, -0.85, 0).normalize());
// La pistola enfundada: el hueso de la funda (sim/skeleton.js) cae por dentro del muslo derecho;
// al dibujarla se lleva por fuera, a la funda del modelo.
const HOLSTER_OUT = 0.2;

function rigToMatrices(rig, out) {
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = rig[i];
    if (!b) continue;
    const R = b.R, p = b.p, o = i * 16;
    out[o] = R.x.x; out[o + 1] = R.x.y; out[o + 2] = R.x.z; out[o + 3] = 0;
    out[o + 4] = R.y.x; out[o + 5] = R.y.y; out[o + 6] = R.y.z; out[o + 7] = 0;
    out[o + 8] = R.z.x; out[o + 9] = R.z.y; out[o + 10] = R.z.z; out[o + 11] = 0;
    out[o + 12] = p.x; out[o + 13] = p.y; out[o + 14] = p.z; out[o + 15] = 1;
  }
}

export class CharacterRenderer {
  constructor(scene, worldUniforms) {
    this.scene = scene;
    this.U = worldUniforms;
    this.camo = makeCamoTexture();
    this.views = new Map();  // op.id -> view
    // sombras de contacto (manchas suaves bajo los pies)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    const bt = new THREE.CanvasTexture(cv);
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 16);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    scene.add(this.blobs);
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._sling = new THREE.Matrix4();
    this._magHand = new THREE.Matrix4().makeTranslation(0, -0.1, 0.03);   // el cargador nuevo, en la palma izquierda
    this._magOff = new THREE.Matrix4();
    // visor térmico: velo frío a pantalla completa (multiplica lo ya pintado, humo incluido);
    // los enemigos calientes se pintan después, encima del humo pero no de las paredes
    this.cold = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main(){ gl_FragColor = vec4(0.22, 0.34, 0.62, 1.0); }',
    }));
    this.cold.frustumCulled = false;
    this.cold.renderOrder = 15;
    this.cold.visible = false;
    scene.add(this.cold);
    this.heat = null;         // {team, range, cam} mientras el visor térmico está en marcha
  }
  /** Visor térmico del operador visto: resalta a los enemigos de `team` a menos de `range` m. */
  setHeat(on, team = 0, range = 0, cam = null) {
    this.heat = on ? { team, range, cam } : null;
    this.cold.visible = on;
  }

  _material() {
    const U = this.U;
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: CHAR_VERT, fragmentShader: CHAR_FRAG,
      uniforms: {
        uBones: { value: new Float32Array(BONE_COUNT * 16) },
        uCamo: { value: this.camo }, uHit: { value: 0 }, uDim: { value: 1 }, uHeat: { value: 0 },
        uLight: U.uLight, uLightMin: U.uLightMin, uLightInvSize: U.uLightInvSize,
        uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel,
        uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
        uWarmColor: U.uWarmColor, uCoolColor: U.uCoolColor, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity,
        uDynPos: U.uDynPos, uDynCol: U.uDynCol, uDynCount: U.uDynCount, uAmbientMin: U.uAmbientMin,
      },
    });
  }

  add(op, look) {
    const models = [op.weapons[0]?.def.model || 'ar', op.weapons[1]?.def.model || 'pistol'];
    const geo = buildOperatorGeometry(look, models[0], models[1]);
    const mesh = new THREE.Mesh(geo, this._material());
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const M = MAG_3P[magKind(models[0])];
    const view = { op, mesh, look, hit: 0, prim: 0, sling: geo.userData.sling, magAt: M ? M.at : null };
    this.views.set(op.id, view);
    return view;
  }
  remove(op) {
    const v = this.views.get(op.id);
    if (!v) return;
    this.scene.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose();
    this.views.delete(op.id);
  }
  clear() { for (const v of [...this.views.values()]) this.remove(v.op); }
  flashHit(op) { const v = this.views.get(op.id); if (v) v.hit = 1; }

  // Cargador de la principal (hueso 19): en el arma, el nuevo en la mano izquierda o fuera (se
  // soltó y cae como objeto aparte); lo dice la pose de la simulación (pose.mag, F7.4).
  _placeMag(v, active, bones) {
    const g = BONE.gun * 16, m = BONE.mag * 16;
    const state = active === 0 ? v.op.pose.mag : 0;
    if (state === 1 && v.magAt) {
      const a = v.magAt;
      this._m.fromArray(bones, BONE.handL * 16).multiply(this._magHand).multiply(this._magOff.makeTranslation(-a[0], -a[1], -a[2]));
      this._m.toArray(bones, m);
      return;
    }
    for (let i = 0; i < 16; i++) bones[m + i] = bones[g + i];
    if (state === 2) for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) bones[m + i] = 0;   // fuera: sin tamaño
  }

  update(dt, localOp, camPos) {
    let nb = 0;
    for (const v of this.views.values()) {
      const op = v.op;
      // el operador propio no se dibuja; los atacantes en preparación aún no están en el mapa
      const hidden = op === localOp || op.frozen;
      v.mesh.visible = !hidden;
      const bones = v.mesh.material.uniforms.uBones.value;
      // reutiliza la pose que la simulación ya calculó este tick (misma que las zonas de impacto)
      rigToMatrices(op.rig, bones);
      // ranura del arma: la activa va a la mano; la otra, a la funda (secundaria) o a la espalda (principal)
      const active = op.weaponIndex;
      if (active === 1) {
        // principal colgada a la espalda: copiar la matriz del pecho con un desplazamiento
        const o = BONE.gun * 16, c = BONE.chest * 16, h = BONE.holster * 16;
        const gunCopy = bones.slice(o, o + 16);
        for (let i = 0; i < 16; i++) bones[h + i] = gunCopy[i];
        for (let i = 0; i < 16; i++) bones[o + i] = bones[c + i];
        // plana y en diagonal, pegada a lo que lleve a la espalda
        this._m.fromArray(bones, o).multiply(this._sling.copy(SLING).setPosition(0.08, 0.05, v.sling));
        this._m.toArray(bones, o);
      } else {
        // pistola en la funda, por fuera del muslo derecho (el hueso de la funda cae por dentro)
        const h = BONE.holster * 16;
        bones[h + 12] -= bones[h] * HOLSTER_OUT; bones[h + 13] -= bones[h + 1] * HOLSTER_OUT; bones[h + 14] -= bones[h + 2] * HOLSTER_OUT;
      }
      this._placeMag(v, active, bones);
      v.mesh.material.uniformsNeedUpdate = true;
      v.hit = Math.max(0, v.hit - dt * 5);
      v.mesh.material.uniforms.uHit.value = v.hit;
      // visor térmico: los enemigos cercanos, calientes y por encima del humo
      const H = this.heat;
      const hot = !!H && op.team !== H.team && op.state !== 'dead' && !!H.cam &&
        Math.hypot(op.body.pos.x - H.cam.x, op.body.pos.y + 0.9 - H.cam.y, op.body.pos.z - H.cam.z) <= H.range;
      if (hot !== !!v.hot) {
        v.hot = hot;
        v.mesh.material.uniforms.uHeat.value = hot ? 1 : 0;
        v.mesh.material.transparent = hot;
        v.mesh.renderOrder = hot ? 20 : 0;
      }
      // mancha de contacto
      if (!hidden && nb < 16) {
        const p = op.body.pos;
        const lying = op.state !== 'alive' || op.stance === 'prone';
        this._v.set(p.x, p.y + 0.012, p.z);
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), op.yaw);
        this._s.set(lying ? 0.9 : 0.75, 1, lying ? 1.9 : 0.75);
        this._m.compose(this._v, this._q, this._s);
        this.blobs.setMatrixAt(nb++, this._m);
      }
    }
    this.blobs.count = nb;
    this.blobs.instanceMatrix.needsUpdate = true;
  }
}

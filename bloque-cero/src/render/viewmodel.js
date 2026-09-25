// Arma en primera persona: modelos procedurales (fusil, subfusil, escopeta,
// pistola) con guantes y mangas tácticas. Escena y cámara propias que se
// componen encima del mundo. Animación: balanceo al andar, inercia de ratón,
// apuntar, retroceso, sprint y desenfunde (base), y encima la recarga por partes
// (Fase 7.1: clip de poses clave con mezcla de 0,15 s, render/reloadanim.js) con
// piezas que se mueven: cargador, palanca de carga, corredera, tambor, tapa y bomba.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp, clamp } from '../core/math.js';
import { shieldUp } from '../sim/abilities.js';
import { BLEND, sampleClip } from './anim.js';
import { reloadClip, HOLD, SHELL_HOLD, LOADER_HOLD } from './reloadanim.js';

function std(color, rough = 0.6, metal = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
const M = {
  gun: std(0x2a2d31, 0.38, 0.6),
  gunDark: std(0x17191c, 0.45, 0.5),
  poly: std(0x2c2f33, 0.7, 0.0),
  tan: std(0x6f5f45, 0.8, 0.0),
  steel: std(0x6c7075, 0.35, 0.9),
  glove: std(0x3b352d, 0.85, 0.0),
  sleeve: std(0x4a5263, 0.92, 0.0),
  sleeveCuff: std(0x363c47, 0.92, 0.0),
  watch: std(0x111111, 0.4, 0.3),
  glass: new THREE.MeshStandardMaterial({ color: 0x1a3040, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 }),
  dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.3, 0.2) }),
  wood: std(0x4a2f1b, 0.65, 0.0),
  brass: std(0xb08a3e, 0.35, 0.8),
  shellRed: std(0x8a1f18, 0.6, 0.0),
  // cargadores: de polímero arena (fusiles), de acero (subfusiles y pistolas) y caja verde (AL-60),
  // para que se distingan del arma y del guante al recargar
  magTan: std(0x7d6b4a, 0.8, 0.0),
  magSteel: std(0x4a4e55, 0.45, 0.6),
  magOlive: std(0x4b503b, 0.8, 0.05),
};
// (el mismo color en lineal, para el cargador que cae al suelo)
const lin = (m) => { const c = m.color; return [c.r, c.g, c.b]; };
const arr = (v) => [v.x, v.y, v.z];
const ZERO3 = [0, 0, 0];

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cyl(r, len, mat, x, y, z, parent, axis = 'z', seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

// Parámetros de cada arma larga en primera persona.
const LONG = {
  ar: { L: 1.0, mag: 'curved', optic: 'holo', stock: 'rifle', fore: 'rail', grip: true },
  ar2: { L: 1.08, mag: 'box', optic: 'acog', stock: 'rifle', fore: 'thick', grip: true },
  smg: { L: 0.78, mag: 'straight', optic: 'holo', stock: 'fold', fore: 'short', grip: false },
  smg2: { L: 0.66, mag: 'straight', optic: 'reddot', stock: 'fold', fore: 'short', grip: true },
  lmg: { L: 1.18, mag: 'drum', optic: 'acog', stock: 'rifle', fore: 'thick', grip: false, bipod: true },
  dmr: { L: 1.3, mag: 'box', optic: 'scope', stock: 'rifle', fore: 'rail', grip: false },
  shotgun: { L: 1.12, mag: 'tube', optic: 'bead', stock: 'wood', fore: 'pump', grip: false },
};

// Construye un arma apuntando hacia -Z con la mira en (0, sightY, *).
function buildGun(kind) {
  const g = new THREE.Group();
  const info = { sightY: 0.075, muzzle: new THREE.Vector3(0, 0.035, -0.62), mag: null, grip: new THREE.Vector3(0, -0.06, 0.04), fore: new THREE.Vector3(0, -0.02, -0.26) };
  const P = LONG[kind];
  if (P) {
    const L = P.L;
    box(0.056, 0.078, 0.32, M.gun, 0, 0.02, -0.04, g);                                        // cajón de mecanismos
    box(0.06, 0.028, 0.44 * L, M.gunDark, 0, 0.066, -0.1 - 0.05 * (L - 1), g);               // riel superior
    const foreLen = P.fore === 'short' ? 0.18 : P.fore === 'thick' ? 0.32 * L : 0.27 * L;
    const foreZ = -0.2 - foreLen / 2;
    if (P.fore === 'pump') {
      const pump = box(0.064, 0.058, 0.15, M.poly, 0, 0.0, -0.36 * L, g);
      info.pump = pump; info.pumpRest = pump.position.z;
      cyl(0.017, 0.46 * L, M.gunDark, 0, 0.005, -0.34 * L, g);                                 // depósito tubular
    } else {
      box(P.fore === 'thick' ? 0.07 : 0.062, P.fore === 'thick' ? 0.07 : 0.062, foreLen, M.poly, 0, 0.018, foreZ, g);
      for (let i = 0; i < 4; i++) box(0.066, 0.012, 0.03, M.gunDark, 0, 0.052, foreZ + foreLen / 2 - 0.03 - i * foreLen / 4.5, g);
    }
    const barLen = 0.2 * L + (kind === 'dmr' ? 0.12 : 0);
    cyl(kind === 'shotgun' ? 0.016 : 0.011, barLen, M.steel, 0, P.fore === 'pump' ? 0.045 : 0.035, foreZ - foreLen / 2 - barLen / 2 + 0.02, g);
    const muzZ = foreZ - foreLen / 2 - barLen + 0.02;
    box(0.03, 0.03, 0.06, M.gunDark, 0, P.fore === 'pump' ? 0.045 : 0.035, muzZ - 0.02, g);   // bocacha
    // empuñadura y cargador
    box(0.035, 0.1, 0.045, M.poly, 0, -0.045, 0.05, g).rotation.x = -0.25;
    let mag = null;
    const magMat = P.mag === 'straight' ? M.magSteel : P.mag === 'drum' ? M.magOlive : M.magTan;
    if (P.mag === 'curved') { mag = box(0.03, 0.14, 0.06, magMat, 0, -0.07, -0.1, g); mag.rotation.x = 0.2; info.magSize = [0.03, 0.14, 0.06]; }
    else if (P.mag === 'box') { mag = box(0.032, 0.11, 0.065, magMat, 0, -0.06, -0.1, g); mag.rotation.x = 0.08; info.magSize = [0.032, 0.11, 0.065]; }
    else if (P.mag === 'straight') { mag = box(0.028, 0.15, 0.045, magMat, 0, -0.085, -0.07, g); info.magSize = [0.028, 0.15, 0.045]; }
    else if (P.mag === 'drum') { mag = box(0.1, 0.1, 0.12, magMat, -0.02, -0.06, -0.1, g); info.magSize = [0.1, 0.1, 0.12]; }
    info.magColor = lin(magMat);
    info.mag = mag;
    if (mag) { info.magRest = arr(mag.position); info.magRot = mag.rotation.clone(); }
    // palanca de carga en el costado izquierdo (delante en fusiles y subfusiles, en medio en el
    // tirador y la ametralladora): la mano izquierda tira de ella hacia atrás sin taparte la vista
    const cock = { ar: [-0.036, 0.045, -0.16, 0.012, 0.014, 0.04], ar2: [-0.036, 0.045, -0.16, 0.012, 0.014, 0.04], smg: [-0.036, 0.052, -0.18, 0.012, 0.014, 0.04], smg2: [-0.036, 0.052, -0.17, 0.012, 0.014, 0.04], dmr: [-0.035, 0.035, -0.02, 0.014, 0.014, 0.03], lmg: [-0.035, 0.03, -0.15, 0.014, 0.016, 0.03] }[kind];
    if (cock) {
      info.bolt = box(cock[3], cock[4], cock[5], M.gunDark, cock[0], cock[1], cock[2], g);
      info.boltRest = [cock[0], cock[1], cock[2]];
      info.boltTravel = kind === 'ar' || kind === 'ar2' ? 0.055 : 0.06;
    }
    if (kind === 'lmg') {
      // tapa de la cinta: bisagra delante, se levanta por detrás (lejos de la cámara)
      const pivot = new THREE.Group(); pivot.position.set(0, 0.082, -0.15); g.add(pivot);
      box(0.06, 0.02, 0.11, M.gun, 0, 0.004, 0.055, pivot);
      box(0.064, 0.012, 0.02, M.gunDark, 0, 0.004, 0.105, pivot);
      info.cover = pivot; info.coverPivot = [0, 0.082, -0.15];
      box(0.012, 0.02, 0.06, M.brass, -0.036, -0.005, -0.1, g);                                // cinta hacia la caja
    }
    if (P.fore === 'pump') info.port = [0, -0.028, -0.09];
    // culata
    if (P.stock === 'wood') { box(0.046, 0.07, 0.24, M.wood, 0, -0.005, 0.24, g); }
    else if (P.stock === 'fold') { box(0.02, 0.05, 0.16, M.gunDark, 0.03, 0.01, 0.18, g); box(0.04, 0.07, 0.02, M.gunDark, 0.03, -0.005, 0.26, g); }
    else { box(0.045, 0.06, 0.2, M.poly, 0, 0.0, 0.22, g); box(0.05, 0.085, 0.03, M.gunDark, 0, -0.005, 0.33, g); }
    if (P.grip) box(0.02, 0.022, 0.07, M.gunDark, 0, -0.025, foreZ + 0.02, g);               // empuñadura vertical
    if (P.bipod) { box(0.008, 0.18, 0.008, M.gunDark, -0.025, -0.08, foreZ - foreLen / 2 + 0.03, g).rotation.x = 0.4; box(0.008, 0.18, 0.008, M.gunDark, 0.025, -0.08, foreZ - foreLen / 2 + 0.03, g).rotation.x = 0.4; }
    // miras
    if (P.optic === 'holo' || P.optic === 'reddot') {
      const w = P.optic === 'holo' ? 0.046 : 0.034;
      box(w - 0.006, 0.012, 0.05, M.gunDark, 0, 0.085, -0.02, g);
      box(0.004, 0.045, 0.05, M.gunDark, -w / 2 + 0.002, 0.11, -0.02, g);
      box(0.004, 0.045, 0.05, M.gunDark, w / 2 - 0.002, 0.11, -0.02, g);
      box(w, 0.004, 0.05, M.gunDark, 0, 0.134, -0.02, g);
      const gl = box(w - 0.01, 0.04, 0.002, M.glass, 0, 0.11, -0.02, g); gl.renderOrder = 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), M.dot); dot.position.set(0, 0.11, -0.03); g.add(dot);
      info.sightY = 0.11;
    } else if (P.optic === 'acog' || P.optic === 'scope') {
      const r = P.optic === 'scope' ? 0.021 : 0.019, len = P.optic === 'scope' ? 0.2 : 0.13;
      box(0.03, 0.02, 0.05, M.gunDark, 0, 0.085, -0.03, g);
      cyl(r, len, M.gunDark, 0, 0.112, -0.04, g, 'z', 14);
      cyl(r + 0.006, 0.03, M.gunDark, 0, 0.112, -0.04 - len / 2, g, 'z', 14);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 14), M.glass); gl.position.set(0, 0.112, -0.04 + len / 2 + 0.001); g.add(gl);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 6, 4), M.dot); dot.position.set(0, 0.112, -0.04 + len / 2 - 0.01); g.add(dot);
      info.sightY = 0.112;
    } else {
      box(0.004, 0.02, 0.01, M.gunDark, 0, 0.075, muzZ + 0.04, g);
      info.sightY = 0.075;
    }
    info.muzzle.set(0, P.fore === 'pump' ? 0.045 : 0.035, muzZ - 0.05);
    info.fore.set(0, -0.025, P.fore === 'pump' ? -0.36 * L : foreZ);
    return { group: g, info };
  }
  // ---------------- armas cortas
  if (kind === 'revolver') {
    box(0.032, 0.11, 0.045, M.wood, 0, -0.055, 0.03, g).rotation.x = -0.25;
    box(0.03, 0.05, 0.07, M.steel, 0, 0.02, -0.01, g);
    info.cyl = cyl(0.022, 0.05, M.steel, 0, 0.022, -0.045, g, 'z', 8);
    info.cylRest = arr(info.cyl.position);
    cyl(0.01, 0.17, M.steel, 0, 0.035, -0.16, g);
    box(0.004, 0.014, 0.01, M.gunDark, 0, 0.052, -0.24, g);
    info.sightY = 0.052; info.muzzle.set(0, 0.035, -0.25); info.mag = null;
  } else {
    const auto = kind === 'mpistol';
    // corredera (con sus miras): va atrás al disparar y se queda atrás sin balas
    const slide = new THREE.Group(); slide.position.set(0, 0.03, -0.06); g.add(slide);
    box(0.03, 0.035, auto ? 0.21 : 0.19, M.gun, 0, 0, 0, slide);
    box(0.004, 0.012, 0.008, M.gunDark, 0, 0.023, -0.09, slide);
    box(0.02, 0.01, 0.008, M.gunDark, 0, 0.023, 0.085, slide);
    info.slide = slide; info.slideRest = [0, 0.03, -0.06];
    box(0.028, 0.03, 0.15, M.poly, 0, 0.0, -0.05, g);
    const grip = box(0.03, 0.11, 0.045, M.poly, 0, -0.055, 0.02, g); grip.rotation.x = -0.2;
    // cargador: el de la pistola, entero dentro de la empuñadura (asoma la base)
    if (auto) { info.mag = box(0.024, 0.1, 0.035, M.magSteel, 0, -0.15, 0.03, g); info.magSize = [0.024, 0.1, 0.035]; }
    else { info.mag = box(0.024, 0.1, 0.034, M.magSteel, 0, -0.07, 0.024, g); info.mag.rotation.x = -0.2; info.magSize = [0.024, 0.1, 0.034]; }
    info.magColor = lin(M.magSteel);
    info.magRest = arr(info.mag.position); info.magRot = info.mag.rotation.clone();
    info.sightY = 0.055;
    info.muzzle.set(0, 0.03, auto ? -0.18 : -0.16);
  }
  info.grip.set(0, -0.05, 0.02);
  info.fore.set(0, -0.06, 0.0);
  return { group: g, info };
}

function buildArm(side) {
  // origen en la muñeca; +Z local apunta al codo (se orienta con setFromUnitVectors)
  const arm = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.34, 10), M.sleeve);
  fore.rotation.x = Math.PI / 2; fore.position.z = 0.2; arm.add(fore);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.05, 10), M.sleeveCuff);
  cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.045; arm.add(cuff);
  box(0.058, 0.066, 0.085, M.glove, 0, 0, -0.02, arm);                       // mano
  box(0.052, 0.024, 0.055, M.glove, side * 0.01, -0.03, -0.075, arm);        // dedos
  box(0.02, 0.028, 0.05, M.glove, -side * 0.034, 0.008, -0.045, arm);        // pulgar
  if (side < 0) box(0.048, 0.02, 0.05, M.watch, 0, 0.04, 0.075, arm);        // reloj
  return arm;
}
const _zAxis = new THREE.Vector3(0, 0, 1);
function aimArm(arm, wrist, elbow) {
  arm.position.copy(wrist);
  const d = elbow.clone().sub(wrist).normalize();
  arm.quaternion.setFromUnitVectors(_zAxis, d);
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    // entorno para que el metal refleje algo (sin él, el metal PBR se ve negro)
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3228, 1.2);
    this.envReady = false;
    this.key = new THREE.DirectionalLight(0xfff0dd, 1.6);
    this.key.position.set(0.4, 1, 0.3);
    this.warm = new THREE.PointLight(0xffb070, 0, 3);
    this.warm.position.set(0.3, 0.5, 0.2);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 2.5);
    this.scene.add(this.hemi, this.key, this.warm, this.flashLight);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.guns = {};
    for (const k of ['ar', 'ar2', 'smg', 'smg2', 'lmg', 'dmr', 'shotgun', 'pistol', 'revolver', 'mpistol']) {
      const g = buildGun(k);
      g.group.visible = false;
      this.root.add(g.group);
      this.guns[k] = g;
    }
    this.armR = buildArm(1); this.armL = buildArm(-1);
    this.root.add(this.armR, this.armL);
    // fogonazo
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5.5, 2.2), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), fm);
      p.rotation.z = (i / 3) * Math.PI;
      this.flash.add(p);
    }
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), fm);
    this.flash.add(core);
    this.flash.visible = false;
    this.root.add(this.flash);
    // cartucho de escopeta y cargador rápido del revólver (en la mano izquierda al recargar)
    this.shell = new THREE.Group();
    cyl(0.0105, 0.05, M.shellRed, 0, 0, 0, this.shell);
    cyl(0.0112, 0.012, M.brass, 0, 0, 0.028, this.shell);
    this.shell.visible = false;
    this.loader = new THREE.Group();
    cyl(0.026, 0.016, M.gunDark, 0, 0, 0.014, this.loader, 'z', 10);
    cyl(0.021, 0.024, M.brass, 0, 0, -0.006, this.loader, 'z', 8);
    this.loader.visible = false;
    this.root.add(this.shell, this.loader);
    this.current = null;
    this.state = { bob: 0, swayX: 0, swayY: 0, kick: 0, kickRot: 0, flashT: 0, reload: 0, sprint: 0, equip: 0, ads: 0, land: 0, roll: 0, shieldUp: 0, slideT: 0, pumpT: 0, cylSpin: 0 };
    // capa de acción encima de la base: la recarga por partes (clip, peso que entra y sale en 0,15 s)
    this.act = { weapon: null, plan: null, clip: null, w: 0, pose: {} };
    this._wL = new THREE.Vector3(); this._wR = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    // escudo balístico de MURALLA: la cara de dentro, a la izquierda, con la mirilla arriba
    this.shield = new THREE.Group();
    const plate = std(0x2b2f35, 0.5, 0.55), inner = std(0x3a3f46, 0.6, 0.3), strap = std(0x1b1c1f, 0.8, 0.0);
    const visor = std(0x0a1117, 0.75, 0.0);             // (mate: sin reflejos del entorno)
    box(0.42, 0.66, 0.03, plate, 0, 0, 0, this.shield);
    box(0.39, 0.63, 0.01, inner, 0, 0, 0.018, this.shield);
    box(0.2, 0.05, 0.034, visor, 0.02, 0.22, 0, this.shield);        // mirilla (oscura)
    box(0.035, 0.2, 0.035, strap, -0.1, -0.02, 0.04, this.shield);
    box(0.035, 0.2, 0.035, strap, 0.1, -0.02, 0.04, this.shield);
    // el foco va por fuera; por dentro, solo un piloto que se enciende al cargar el destello
    this.shieldLamp = box(0.025, 0.012, 0.01, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.02, 0.02) }), 0.14, 0.22, 0.024, this.shield);
    this.shield.visible = false;
    this.scene.add(this.shield);
  }

  initEnvironment(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    pm.dispose();
    this.envReady = true;
  }
  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  setWeapon(kind) {
    if (this.current === kind) return;
    for (const k in this.guns) this.guns[k].group.visible = k === kind;
    this.current = kind;
    this.state.equip = 1;
    this.act.plan = null; this.act.w = 0;
  }

  onShot() {
    const s = this.state;
    const heavy = this.current === 'shotgun' || this.current === 'revolver' || this.current === 'dmr';
    s.kick = Math.min(1.4, s.kick + (heavy ? 1.2 : this.current === 'pistol' ? 0.8 : 0.45));
    s.kickRot += (Math.random() - 0.5) * 0.03;
    s.flashT = 0.045;
    // piezas: la corredera va atrás, la escopeta se bombea y el tambor gira
    if (this.current === 'pistol' || this.current === 'mpistol') s.slideT = 1;
    else if (this.current === 'shotgun') s.pumpT = 1e-4;
    else if (this.current === 'revolver') s.cylSpin += Math.PI / 3;
    this.flash.rotation.z = Math.random() * Math.PI;
    const sc = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(sc, sc, sc);
  }
  onLand(v) { this.state.land = Math.min(1, v / 8); }
  // Golpe cuerpo a cuerpo: el arma sale hacia delante con la culata girada.
  onMelee() { this.state.melee = 1; }

  /**
   * op: operador local; light: {sky,warm,cool} en la posición de los ojos; mouse: delta de ratón este frame
   */
  update(dt, op, light, mouseDX, mouseDY) {
    const s = this.state;
    const w = op.weapon;
    this.setWeapon(w.def.model);
    const g = this.guns[this.current], info = g.info;
    // luz de la escena del arma según el entorno
    const sky = light.sky * light.sky, warm = light.warm * light.warm, cool = light.cool * light.cool;
    const amb = 0.06 + sky * 0.75 + warm * 0.6 + cool * 0.5;
    this.hemi.intensity = amb * 1.1;
    this.hemi.color.setRGB(0.78 + warm * 0.25, 0.82 + warm * 0.08, 1.0 - warm * 0.3);
    this.key.intensity = 0.05 + sky * 0.9;
    this.warm.intensity = warm * 1.4;
    this.scene.environmentIntensity = amb * 0.9;
    // estados
    s.ads = damp(s.ads, op.ads, 30, dt);
    s.sprint = damp(s.sprint, op.sprinting ? 1 : 0, 9, dt);
    s.kick = damp(s.kick, 0, 16, dt);
    s.kickRot = damp(s.kickRot, 0, 10, dt);
    s.land = damp(s.land, 0, 8, dt);
    s.equip = Math.max(0, w.equipT / Math.max(0.01, w.def.equip));
    // manos ocupadas (plantar, inutilizar, reanimar): el arma baja
    s.lower = damp(s.lower || 0, op.channel || op.reviving ? 1 : 0, 7, dt);
    s.melee = Math.max(0, (s.melee || 0) - dt * 2.2);
    const mk = s.melee > 0 ? Math.sin((1 - s.melee) * Math.PI) : 0;   // 0 → 1 → 0 en ~0,45 s
    // ---- capa de acción: la recarga por partes, con los momentos de la simulación
    const A = this.act, P = A.pose;
    if (A.weapon !== w) { A.weapon = w; A.plan = null; A.w = 0; }
    if (w.plan && w.plan !== A.plan) { A.plan = w.plan; A.clip = reloadClip(w.plan, w.def, info, this._rest(info)); }
    const active = !!w.plan && w.plan === A.plan && w.reloadT > 0;
    if (active) sampleClip(A.clip, w.reloadTotal - w.reloadT, P);   // (interrumpida: se queda la última pose y se desvanece)
    A.w = clamp(A.w + (active ? dt : -dt) / BLEND, 0, 1);
    const k = A.plan ? A.w : 0;
    s.reload = active ? 1 - w.reloadT / w.reloadTotal : 0;
    const speed = op.moveSpeed;
    s.bob += dt * (speed > 0.3 ? (op.sprinting ? 11 : 7.5) * Math.min(1, speed / 3) + 2 : 1.6);
    const bobAmp = speed > 0.3 ? Math.min(1, speed / 4) * (1 - s.ads * 0.9) : 0.08;
    s.swayX = damp(s.swayX, clamp(-mouseDX * 0.0009, -0.05, 0.05), 10, dt);
    s.swayY = damp(s.swayY, clamp(mouseDY * 0.0009, -0.05, 0.05), 10, dt);
    s.roll = damp(s.roll, op.roll, 12, dt);
    // posición de cadera vs. mira
    const hip = new THREE.Vector3(0.19, -0.2, -0.44);
    const ads = new THREE.Vector3(0, -g.info.sightY, -0.3);
    const pos = hip.clone().lerp(ads, s.ads);
    const bx = Math.sin(s.bob) * 0.012 * bobAmp, by = -Math.abs(Math.cos(s.bob)) * 0.014 * bobAmp;
    pos.x += bx + s.swayX * (1 - s.ads * 0.8);
    pos.y += by + s.swayY * (1 - s.ads * 0.8) - s.land * 0.04;
    pos.z += s.kick * 0.045;
    pos.y += s.kick * 0.006;
    // sprint: arma baja y girada
    pos.x += s.sprint * 0.05; pos.y -= s.sprint * 0.06;
    // desenfunde: sube desde abajo; manos ocupadas: baja
    pos.y -= s.equip * 0.25 + s.lower * 0.32;
    pos.x -= mk * 0.12; pos.z -= mk * 0.2; pos.y += mk * 0.03;
    const rp = k > 0 ? P.pos : ZERO3, rr = k > 0 ? P.rot : ZERO3;
    pos.x += rp[0] * k; pos.y += rp[1] * k; pos.z += rp[2] * k;
    this.root.position.copy(pos);
    this.root.rotation.set(
      s.kick * 0.09 + rr[0] * k + s.sprint * -0.25 + s.equip * 0.8 + s.lower * 0.7 + s.swayY * 0.5,
      s.sprint * 0.9 + s.swayX * 0.6 + s.kickRot + mk * 0.9 + rr[1] * k,
      rr[2] * k + s.sprint * 0.3 + Math.sin(s.bob * 0.5) * 0.01 * bobAmp,
    );
    // ---- piezas que se mueven
    let pumpOff = 0;
    if (info.pump) {
      // bombeo tras cada disparo: atrás y adelante (la mano izquierda va con la bomba)
      if (s.pumpT > 0) { s.pumpT += dt; if (s.pumpT > 0.42) s.pumpT = 0; }
      const t = s.pumpT;
      let pk = t > 0.12 && t < 0.24 ? (t - 0.12) / 0.12 : t >= 0.24 && t < 0.36 ? 1 - (t - 0.24) / 0.12 : 0;
      if (active && P.pump) pk = Math.max(pk, P.pump);
      pumpOff = pk * 0.08;
      info.pump.position.z = info.pumpRest + pumpOff;
    }
    if (info.slide) {
      s.slideT = Math.max(0, s.slideT - dt / 0.07);
      let sl = s.slideT;
      if (w.ammo === 0 && !active) sl = 1;                          // sin balas se queda atrás
      if (active && P.slide !== undefined) sl = Math.max(sl, P.slide);
      info.slide.position.z = info.slideRest[2] + sl * 0.035;
    }
    if (info.bolt) info.bolt.position.z = info.boltRest[2] + (active && P.bolt ? P.bolt : 0) * info.boltTravel;
    if (info.cover) info.cover.rotation.x = -(active && P.cover ? P.cover : 0) * 1.1;
    if (info.cyl) {
      const c = active && P.cyl ? P.cyl : 0;
      info.cyl.position.set(info.cylRest[0] - 0.04 * c, info.cylRest[1] - 0.018 * c, info.cylRest[2]);
      info.cyl.rotation.set(Math.PI / 2, s.cylSpin, 0);
    }
    // ---- brazos: derecha en la empuñadura, izquierda en el guardamanos (o donde diga la recarga)
    const wR = this._wR.copy(g.info.grip).add(this._tmp.set(0.01, -0.01, 0.02));
    aimArm(this.armR, wR, wR.clone().add(this._tmp.set(0.16, -0.2, 0.3)));
    const r = this._rest(info);
    const wL = this._wL.set(r[0], r[1], r[2] + pumpOff);
    if (k > 0 && P.hand) wL.lerp(this._tmp.set(P.hand[0], P.hand[1], P.hand[2]), k);
    // con escudo, la mano izquierda lo sujeta (y la pistola va a una mano)
    const hasShield = !!op.ability && op.ability.id === 'shield' && op.state === 'alive';
    this.shield.visible = hasShield;
    if (hasShield) {
      s.shieldUp = damp(s.shieldUp, shieldUp(op) ? 1 : 0, 10, dt);
      const ks = s.shieldUp;
      // (a la izquierda: ocupa un tercio de la pantalla, girado hacia dentro)
      this.shield.position.set(-0.38 - (1 - ks) * 0.05 - s.ads * 0.03 + bx * 0.6, -0.1 - (1 - ks) * 0.42 + by * 0.6, -0.52 + (1 - ks) * 0.08);
      this.shield.rotation.set((1 - ks) * 0.7, 0.32 + (1 - ks) * 0.5, (1 - ks) * 0.3);
      // foco del destello: se enciende al cargarlo
      const hot = op.flashT > 0;
      this.shieldLamp.material.color.setRGB(hot ? 6 : 0.02, hot ? 6 : 0.02, hot ? 6.5 : 0.02);
      const grip = new THREE.Vector3(-0.1, -0.02, 0.06).applyEuler(this.shield.rotation).add(this.shield.position).sub(this.root.position);
      grip.applyQuaternion(this.root.quaternion.clone().invert());
      aimArm(this.armL, grip, grip.clone().add(new THREE.Vector3(-0.12, -0.24, 0.26)));
    } else {
      // (con la mano por encima del arma, el codo sube y sale hacia fuera: el antebrazo no cruza la vista)
      const up = clamp((wL.y - r[1] - 0.05) / 0.1, 0, 1);
      aimArm(this.armL, wL, wL.clone().add(this._tmp.set(-0.2 - 0.12 * up, -0.22 + 0.24 * up, 0.28 - 0.1 * up)));
    }
    // ---- lo que lleva la mano izquierda: el cargador (sacándolo o el nuevo), un cartucho, el cargador rápido
    if (info.mag) {
      let mode = active ? P.mag : (w.magOut ? 'none' : 'gun');
      if (hasShield && mode === 'hand') mode = 'gun';
      const m = info.mag;
      m.visible = mode !== 'none';
      if (m.visible) {
        m.rotation.copy(info.magRot);
        if (mode === 'hand') m.position.set(wL.x + HOLD[0], wL.y + HOLD[1], wL.z + HOLD[2]);
        else {
          const o = active && P.magOff ? P.magOff : ZERO3;
          m.position.set(info.magRest[0] + o[0], info.magRest[1] + o[1], info.magRest[2] + o[2]);
        }
      }
    }
    this.shell.visible = active && P.shell === 'hand' && !hasShield;
    if (this.shell.visible) this.shell.position.set(wL.x + SHELL_HOLD[0], wL.y + SHELL_HOLD[1], wL.z + SHELL_HOLD[2]);
    this.loader.visible = active && P.loader === 'hand' && !hasShield;
    if (this.loader.visible) this.loader.position.set(wL.x + LOADER_HOLD[0], wL.y + LOADER_HOLD[1], wL.z + LOADER_HOLD[2]);
    // fogonazo
    s.flashT -= dt;
    this.flash.visible = s.flashT > 0;
    this.flash.position.copy(g.info.muzzle);
    this.flashLight.intensity = s.flashT > 0 ? 4 : 0;
    this.flashLight.position.copy(g.info.muzzle).add(this.root.position);
    // FOV del arma: se cierra al apuntar
    this.camera.fov = 52 - s.ads * 10;
    this.camera.rotation.z = 0;
    this.camera.updateProjectionMatrix();
  }

  // mano izquierda en reposo (en el guardamanos o, en las pistolas, bajo la empuñadura)
  _rest(info) { return [info.fore.x - 0.01, info.fore.y - 0.035, info.fore.z]; }

  /**
   * Lo que se suelta en la parte `part` de la recarga ('magOut': el cargador; 'eject': los
   * casquillos del revólver), en el mundo: [{kind, pos, quat, size, color}], desde la pose del
   * último fotograma. `camera`: la cámara del mundo (el arma se dibuja en su espacio).
   */
  released(camera, part) {
    const g = this.guns[this.current];
    if (!g) return [];
    this.root.updateMatrixWorld(true);
    const out = [];
    const q = new THREE.Quaternion();
    if (part === 'magOut' && g.info.mag && g.info.magSize) {
      const m = g.info.mag;
      const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).applyMatrix4(camera.matrixWorld);
      m.getWorldQuaternion(q).premultiply(camera.quaternion);
      out.push({ kind: 'mag', pos: p, quat: q.clone(), size: g.info.magSize, color: (g.info.magColor || [0.05, 0.055, 0.06]).slice() });
    } else if (part === 'eject' && g.info.cyl) {
      const c = new THREE.Vector3().setFromMatrixPosition(g.info.cyl.matrixWorld).applyMatrix4(camera.matrixWorld);
      g.info.cyl.getWorldQuaternion(q).premultiply(camera.quaternion);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        out.push({ kind: 'casing', pos: c.clone().add(new THREE.Vector3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0).applyQuaternion(q)), quat: q.clone(), size: [0.011, 0.011, 0.034], color: [0.62, 0.45, 0.17] });
      }
    }
    return out;
  }
}

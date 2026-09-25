// Arma en primera persona: modelos procedurales (fusil, subfusil, escopeta,
// pistola) con guantes y mangas tácticas. Escena y cámara propias que se
// componen encima del mundo. Animación básica: balanceo al andar, inercia de
// ratón, apuntar, retroceso, recarga, sprint y desenfunde (la Fase 7 la amplía).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp, clamp } from '../core/math.js';
import { shieldUp } from '../sim/abilities.js';

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
};

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
      info.pump = pump;
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
    if (P.mag === 'curved') { mag = box(0.03, 0.14, 0.06, M.gunDark, 0, -0.07, -0.1, g); mag.rotation.x = 0.2; }
    else if (P.mag === 'box') { mag = box(0.032, 0.11, 0.065, M.gunDark, 0, -0.06, -0.1, g); mag.rotation.x = 0.08; }
    else if (P.mag === 'straight') { mag = box(0.028, 0.15, 0.045, M.gunDark, 0, -0.085, -0.07, g); }
    else if (P.mag === 'drum') { mag = box(0.1, 0.1, 0.12, M.gunDark, -0.02, -0.06, -0.1, g); }
    info.mag = mag;
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
    cyl(0.022, 0.05, M.steel, 0, 0.022, -0.045, g, 'z', 8);
    cyl(0.01, 0.17, M.steel, 0, 0.035, -0.16, g);
    box(0.004, 0.014, 0.01, M.gunDark, 0, 0.052, -0.24, g);
    info.sightY = 0.052; info.muzzle.set(0, 0.035, -0.25); info.mag = null;
  } else {
    const auto = kind === 'mpistol';
    box(0.03, 0.035, auto ? 0.21 : 0.19, M.gun, 0, 0.03, -0.06, g);
    box(0.028, 0.03, 0.15, M.poly, 0, 0.0, -0.05, g);
    const grip = box(0.03, 0.11, 0.045, M.poly, 0, -0.055, 0.02, g); grip.rotation.x = -0.2;
    box(0.004, 0.012, 0.008, M.gunDark, 0, 0.053, -0.15, g);
    box(0.02, 0.01, 0.008, M.gunDark, 0, 0.053, 0.025, g);
    info.mag = box(0.024, auto ? 0.1 : 0.02, 0.035, M.gunDark, 0, auto ? -0.15 : -0.115, 0.03, g);
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
    this.current = null;
    this.state = { bob: 0, swayX: 0, swayY: 0, kick: 0, kickRot: 0, flashT: 0, reload: 0, sprint: 0, equip: 0, ads: 0, land: 0, roll: 0, shieldUp: 0 };
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
  }

  onShot() {
    const s = this.state;
    const heavy = this.current === 'shotgun' || this.current === 'revolver' || this.current === 'dmr';
    s.kick = Math.min(1.4, s.kick + (heavy ? 1.2 : this.current === 'pistol' ? 0.8 : 0.45));
    s.kickRot += (Math.random() - 0.5) * 0.03;
    s.flashT = 0.045;
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
    const g = this.guns[this.current];
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
    const reloadK = w.reloadT > 0 ? 1 - w.reloadT / w.reloadTotal : 0;
    s.reload = reloadK;
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
    // recarga: bajar y girar el arma; desenfunde: subir desde abajo
    const rk = Math.sin(Math.min(1, reloadK) * Math.PI);
    pos.y -= rk * 0.07 + s.equip * 0.25 + s.lower * 0.32;
    pos.x -= mk * 0.12; pos.z -= mk * 0.2; pos.y += mk * 0.03;
    pos.z += rk * 0.03;
    this.root.position.copy(pos);
    this.root.rotation.set(
      s.kick * 0.09 + rk * 0.35 + s.sprint * -0.25 + s.equip * 0.8 + s.lower * 0.7 + s.swayY * 0.5,
      s.sprint * 0.9 + s.swayX * 0.6 + s.kickRot + mk * 0.9,
      rk * 0.5 + s.sprint * 0.3 + Math.sin(s.bob * 0.5) * 0.01 * bobAmp,
    );
    // cargador: fuera durante la recarga
    if (g.info.mag) {
      const out = reloadK > 0.2 && reloadK < 0.62 ? 1 : 0;
      g.info.mag.visible = !out;
    }
    // brazos: derecha en la empuñadura, izquierda en el guardamanos; los codos caen hacia abajo y atrás
    const wR = g.info.grip.clone().add(new THREE.Vector3(0.01, -0.01, 0.02));
    aimArm(this.armR, wR, wR.clone().add(new THREE.Vector3(0.16, -0.2, 0.3)));
    const fore = g.info.fore.clone();
    if (reloadK > 0.15 && reloadK < 0.75 && g.info.mag) {
      // la mano izquierda va al cargador
      fore.lerp(new THREE.Vector3(g.info.mag.position.x, g.info.mag.position.y - 0.08 * rk, g.info.mag.position.z), Math.min(1, rk * 1.5));
    }
    const wL = fore.add(new THREE.Vector3(-0.01, -0.035, 0.0));
    // con escudo, la mano izquierda lo sujeta (y la pistola va a una mano)
    const hasShield = !!op.ability && op.ability.id === 'shield' && op.state === 'alive';
    this.shield.visible = hasShield;
    if (hasShield) {
      s.shieldUp = damp(s.shieldUp, shieldUp(op) ? 1 : 0, 10, dt);
      const k = s.shieldUp;
      // (a la izquierda: ocupa un tercio de la pantalla, girado hacia dentro)
      this.shield.position.set(-0.38 - (1 - k) * 0.05 - s.ads * 0.03 + bx * 0.6, -0.1 - (1 - k) * 0.42 + by * 0.6, -0.52 + (1 - k) * 0.08);
      this.shield.rotation.set((1 - k) * 0.7, 0.32 + (1 - k) * 0.5, (1 - k) * 0.3);
      // foco del destello: se enciende al cargarlo
      const hot = op.flashT > 0;
      this.shieldLamp.material.color.setRGB(hot ? 6 : 0.02, hot ? 6 : 0.02, hot ? 6.5 : 0.02);
      const grip = new THREE.Vector3(-0.1, -0.02, 0.06).applyEuler(this.shield.rotation).add(this.shield.position).sub(this.root.position);
      grip.applyQuaternion(this.root.quaternion.clone().invert());
      aimArm(this.armL, grip, grip.clone().add(new THREE.Vector3(-0.12, -0.24, 0.26)));
    } else aimArm(this.armL, wL, wL.clone().add(new THREE.Vector3(-0.2, -0.22, 0.28)));
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
}

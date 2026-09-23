// Arma en primera persona: modelos procedurales (fusil, subfusil, escopeta,
// pistola) con guantes y mangas tácticas. Escena y cámara propias que se
// componen encima del mundo. Animación básica: balanceo al andar, inercia de
// ratón, apuntar, retroceso, recarga, sprint y desenfunde (la Fase 7 la amplía).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp, clamp } from '../core/math.js';

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

// Construye un arma apuntando hacia -Z con la mira en (0, sightY, *).
function buildGun(kind) {
  const g = new THREE.Group();
  const info = { sightY: 0.075, muzzle: new THREE.Vector3(0, 0.035, -0.62), mag: null, grip: new THREE.Vector3(0, -0.06, 0.04), fore: new THREE.Vector3(0, -0.02, -0.26) };
  if (kind === 'ar' || kind === 'smg') {
    const L = kind === 'ar' ? 1 : 0.8;
    box(0.055, 0.075, 0.34 * L, M.gun, 0, 0.02, -0.05, g);                   // cajón de mecanismos
    box(0.06, 0.03, 0.42 * L, M.gunDark, 0, 0.065, -0.1, g);                  // riel superior
    box(0.062, 0.062, 0.26 * L, M.poly, 0, 0.018, -0.3 * L, g);               // guardamanos
    for (let i = 0; i < 4; i++) box(0.064, 0.012, 0.03, M.gunDark, 0, 0.05, -0.2 * L - i * 0.05 * L, g);
    cyl(0.011, 0.22 * L, M.steel, 0, 0.035, -0.52 * L, g);                    // cañón
    box(0.03, 0.03, 0.07, M.gunDark, 0, 0.035, -0.64 * L, g);                 // bocacha
    box(0.035, 0.1, 0.045, M.poly, 0, -0.045, 0.05, g).rotation.x = -0.25;   // empuñadura
    const mag = box(0.03, 0.13, 0.06, M.gunDark, 0, -0.07, -0.1, g);          // cargador
    mag.rotation.x = kind === 'ar' ? 0.18 : 0.05;
    info.mag = mag;
    box(0.045, 0.06, 0.2, M.poly, 0, 0.0, 0.22, g);                           // culata
    box(0.05, 0.085, 0.03, M.gunDark, 0, -0.005, 0.33, g);
    // mira holográfica
    box(0.04, 0.012, 0.05, M.gunDark, 0, 0.085, -0.02, g);
    box(0.004, 0.045, 0.05, M.gunDark, -0.021, 0.11, -0.02, g);
    box(0.004, 0.045, 0.05, M.gunDark, 0.021, 0.11, -0.02, g);
    box(0.046, 0.004, 0.05, M.gunDark, 0, 0.134, -0.02, g);
    const gl = box(0.036, 0.04, 0.002, M.glass, 0, 0.11, -0.02, g); gl.renderOrder = 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), M.dot); dot.position.set(0, 0.11, -0.03); g.add(dot);
    box(0.02, 0.02, 0.07, M.gunDark, 0, -0.025, -0.28 * L, g);               // empuñadura vertical
    info.sightY = 0.11;
    info.muzzle.set(0, 0.035, -0.68 * L);
    info.fore.set(0, -0.03, -0.3 * L);
  } else if (kind === 'shotgun') {
    box(0.06, 0.07, 0.32, M.gun, 0, 0.02, -0.02, g);
    cyl(0.017, 0.5, M.steel, 0, 0.045, -0.4, g);
    cyl(0.016, 0.38, M.gunDark, 0, 0.005, -0.34, g);                        // tubo
    const pump = box(0.06, 0.055, 0.14, M.poly, 0, 0.005, -0.32, g);
    info.pump = pump;
    box(0.035, 0.1, 0.045, M.poly, 0, -0.045, 0.09, g).rotation.x = -0.25;
    box(0.046, 0.065, 0.24, M.wood, 0, -0.01, 0.26, g);
    box(0.004, 0.02, 0.01, M.gunDark, 0, 0.07, -0.62, g);
    box(0.02, 0.015, 0.03, M.gunDark, 0, 0.065, 0.02, g);
    info.sightY = 0.07;
    info.muzzle.set(0, 0.045, -0.66);
    info.fore.set(0, -0.02, -0.32);
  } else {
    // pistola
    box(0.03, 0.035, 0.19, M.gun, 0, 0.03, -0.06, g);                       // corredera
    box(0.028, 0.03, 0.15, M.poly, 0, 0.0, -0.05, g);
    const grip = box(0.03, 0.11, 0.045, M.poly, 0, -0.055, 0.02, g); grip.rotation.x = -0.2;
    box(0.004, 0.012, 0.008, M.gunDark, 0, 0.053, -0.15, g);
    box(0.02, 0.01, 0.008, M.gunDark, 0, 0.053, 0.025, g);
    info.mag = box(0.024, 0.02, 0.035, M.gunDark, 0, -0.115, 0.03, g);
    info.sightY = 0.055;
    info.muzzle.set(0, 0.03, -0.16);
    info.grip.set(0, -0.05, 0.02);
    info.fore.set(0, -0.06, 0.0);
  }
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
    for (const k of ['ar', 'smg', 'shotgun', 'pistol']) {
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
    this.state = { bob: 0, swayX: 0, swayY: 0, kick: 0, kickRot: 0, flashT: 0, reload: 0, sprint: 0, equip: 0, ads: 0, land: 0, roll: 0 };
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
    s.kick = Math.min(1.4, s.kick + (this.current === 'shotgun' ? 1.3 : this.current === 'pistol' ? 0.8 : 0.45));
    s.kickRot += (Math.random() - 0.5) * 0.03;
    s.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    const sc = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(sc, sc, sc);
  }
  onLand(v) { this.state.land = Math.min(1, v / 8); }

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
    pos.y -= rk * 0.07 + s.equip * 0.25;
    pos.z += rk * 0.03;
    this.root.position.copy(pos);
    this.root.rotation.set(
      s.kick * 0.09 + rk * 0.35 + s.sprint * -0.25 + s.equip * 0.8 + s.swayY * 0.5,
      s.sprint * 0.9 + s.swayX * 0.6 + s.kickRot,
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
    aimArm(this.armL, wL, wL.clone().add(new THREE.Vector3(-0.2, -0.22, 0.28)));
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

// Objetos del juego con la misma iluminación que el mundo: drones, cámaras de
// seguridad, paneles de refuerzo (con su despliegue hidráulico) y el desactivador.
import * as THREE from 'three';
import { LIGHTING_GLSL } from './shaders.js';
import { TEXTURE_NAMES } from './texgen.js';

const PROP_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 normal;
in vec3 color;
in vec4 aMat;       // rugosidad, metal, emisión, (libre)
in vec3 aUV;        // uv y capa de textura (-1 = sin textura)
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec4 vMat; out vec3 vUV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color; vMat = aMat; vUV = aUV;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const PROP_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2DArray;
uniform sampler2DArray uAlbedo;
uniform vec3 cameraPosition;
uniform float uGlow;
uniform float uDim;
${LIGHTING_GLSL}
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec4 vMat; in vec3 vUV;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 albedo = vColor;
  float rough = vMat.x;
  if (vUV.z >= 0.0) {
    vec4 t = texture(uAlbedo, vUV);
    albedo = min(albedo * t.rgb * 2.2, vec3(1.0));
    rough = mix(rough, t.a, 0.6);
  }
  albedo *= uDim;
  float sunVis = shadowAt(vWorld, n);
  vec3 col = shade(vWorld, n, n, V, albedo, rough, vMat.y, 1.0, sunVis);
  col += vColor * vMat.z * uGlow * 6.0;
  col = applyFog(col, length(cameraPosition - vWorld), vWorld);
  fragColor = vec4(col, 1.0);
}
`;

class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.mat = []; this.uv = []; }
  add(geo, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color = '#777', rough = 0.6, metal = 0, glow = 0, layer = -1, uvScale = 1 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const c = new THREE.Color(color).convertSRGBToLinear();
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(w.x, w.y, w.z); this.col.push(c.r, c.g, c.b);
      this.mat.push(rough, metal, glow, 0);
      this.uv.push(uv ? uv.getX(i) * uvScale : 0, uv ? uv.getY(i) * uvScale : 0, layer);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);
const Sph = (r) => new THREE.SphereGeometry(r, 12, 8);

// ------------------------------------------------------------------ modelos
function droneBody(accent) {
  const b = new Builder();
  b.add(Box(0.19, 0.075, 0.2), { at: [0, 0.095, 0], color: '#2a2d31', rough: 0.45, metal: 0.3 });
  b.add(Box(0.15, 0.03, 0.17), { at: [0, 0.145, 0.01], color: '#1c1e21', rough: 0.5 });
  b.add(Cyl(0.03, 0.03, 0.04, 14), { at: [0, 0.1, -0.1], rot: [Math.PI / 2, 0, 0], color: '#111', rough: 0.2, metal: 0.4 });
  b.add(Cyl(0.02, 0.02, 0.012, 14), { at: [0, 0.1, -0.121], rot: [Math.PI / 2, 0, 0], color: '#6fd0ff', rough: 0.05, glow: 0.35 });
  b.add(Box(0.03, 0.012, 0.012), { at: [0.06, 0.135, -0.1], color: accent, glow: 0.8 });
  b.add(Box(0.03, 0.012, 0.012), { at: [-0.06, 0.135, -0.1], color: accent, glow: 0.8 });
  b.add(Cyl(0.004, 0.004, 0.14, 5), { at: [0.07, 0.22, 0.07], rot: [-0.25, 0, 0], color: '#111', rough: 0.4 });
  return b.build();
}
function droneWheels() {
  const b = new Builder();
  for (const s of [-1, 1]) {
    b.add(Cyl(0.072, 0.072, 0.04, 16), { at: [s * 0.12, 0, 0], rot: [0, 0, Math.PI / 2], color: '#161616', rough: 0.9 });
    b.add(Cyl(0.035, 0.035, 0.045, 10), { at: [s * 0.12, 0, 0], rot: [0, 0, Math.PI / 2], color: '#4a4f55', rough: 0.4, metal: 0.6 });
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      b.add(Box(0.044, 0.012, 0.018), { at: [s * 0.12, Math.cos(a) * 0.07, Math.sin(a) * 0.07], rot: [a, 0, 0], color: '#0d0d0d', rough: 0.95 });
    }
  }
  return b.build();
}
function camBase() {
  const b = new Builder();
  b.add(Box(0.12, 0.12, 0.03), { at: [0, 0, 0.1], color: '#d8d8d4', rough: 0.5 });
  b.add(Cyl(0.02, 0.02, 0.09, 8), { at: [0, 0, 0.05], rot: [Math.PI / 2, 0, 0], color: '#bbb', rough: 0.5, metal: 0.3 });
  return b.build();
}
function camHead() {
  const b = new Builder();
  b.add(Box(0.09, 0.085, 0.2), { at: [0, 0, -0.06], color: '#e6e6e2', rough: 0.45 });
  b.add(Box(0.1, 0.012, 0.23), { at: [0, 0.05, -0.07], color: '#d0d0cc', rough: 0.5 });
  b.add(Cyl(0.03, 0.03, 0.02, 14), { at: [0, 0, -0.165], rot: [Math.PI / 2, 0, 0], color: '#0b0b0d', rough: 0.1, metal: 0.5 });
  b.add(Cyl(0.018, 0.018, 0.01, 14), { at: [0, 0, -0.176], rot: [Math.PI / 2, 0, 0], color: '#203040', rough: 0.05, glow: 0.2 });
  b.add(Sph(0.009), { at: [0.03, 0.028, -0.16], color: '#ff2a1a', glow: 1 });
  return b.build();
}
// Panel de refuerzo: placa de acero con dos pistones hidráulicos (origen: pie del panel,
// centrado, cara hacia +Z). La placa y los pistones son mallas separadas para animarlos.
function panelPlate(w, h, steelLayer) {
  const b = new Builder();
  b.add(Box(w, h, 0.03), { at: [0, h / 2, 0.015], color: '#e4e7ea', rough: 0.55, metal: 0.35, layer: steelLayer, uvScale: 1 });
  b.add(Box(w + 0.02, 0.06, 0.05), { at: [0, 0.03, 0.025], color: '#5a5e64', rough: 0.5, metal: 0.4 });
  b.add(Box(w + 0.02, 0.06, 0.05), { at: [0, h - 0.03, 0.025], color: '#5a5e64', rough: 0.5, metal: 0.4 });
  // franjas de aviso
  for (let i = 0; i < 5; i++) b.add(Box(0.05, 0.05, 0.004), { at: [-w / 2 + 0.1 + i * 0.1, h - 0.14, 0.033], rot: [0, 0, 0.8], color: i % 2 ? '#1a1a1a' : '#e0b21c', rough: 0.6 });
  return b.build();
}
function panelPistons(w, h) {
  const b = new Builder();
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.2);
    b.add(Cyl(0.042, 0.042, h * 0.52, 14), { at: [x, h * 0.26 + 0.12, 0.09], color: '#3a3f46', rough: 0.35, metal: 0.5 });
    b.add(Cyl(0.022, 0.022, h * 0.46, 12), { at: [x, h * 0.72, 0.09], color: '#e8ebee', rough: 0.2, metal: 0.6 });
    b.add(Box(0.14, 0.07, 0.1), { at: [x, 0.09, 0.07], color: '#4a4e54', rough: 0.5, metal: 0.4 });
    b.add(Box(0.14, 0.07, 0.1), { at: [x, h - 0.09, 0.07], color: '#4a4e54', rough: 0.5, metal: 0.4 });
    b.add(Box(0.03, 0.2, 0.03), { at: [x, h * 0.5 + 0.35, 0.14], color: '#e0b21c', rough: 0.6 });
  }
  b.add(Box(w - 0.3, 0.05, 0.05), { at: [0, h * 0.5, 0.08], color: '#44484e', rough: 0.4, metal: 0.5 });
  return b.build();
}
function hatchPlate(steelLayer) {
  const b = new Builder();
  b.add(Box(1.3, 0.025, 1.3), { at: [0, 0.0125, 0], color: '#e4e7ea', rough: 0.55, metal: 0.35, layer: steelLayer });
  for (const s of [-1, 1]) b.add(Box(1.3, 0.05, 0.08), { at: [0, 0.035, s * 0.35], color: '#4a4e54', rough: 0.4, metal: 0.45 });
  b.add(Box(0.08, 0.05, 1.3), { at: [0, 0.035, 0], color: '#4a4e54', rough: 0.4, metal: 0.45 });
  return b.build();
}
function defuserModel() {
  const b = new Builder();
  b.add(Box(0.3, 0.1, 0.22), { at: [0, 0.05, 0], color: '#2b2c28', rough: 0.6, metal: 0.2 });
  b.add(Box(0.22, 0.03, 0.15), { at: [0, 0.115, 0], color: '#474a3e', rough: 0.5 });
  b.add(Box(0.1, 0.01, 0.06), { at: [-0.04, 0.132, 0.02], color: '#ff6a1a', glow: 1 });
  b.add(Cyl(0.006, 0.006, 0.28, 6), { at: [0.11, 0.24, -0.07], color: '#111', rough: 0.4 });
  b.add(Sph(0.014), { at: [0.11, 0.385, -0.07], color: '#ff2a1a', glow: 1 });
  return b.build();
}

// Granadas (gadgets lanzables): fragmentación, humo, cegadora e impacto.
function grenadeModel(kind) {
  const b = new Builder();
  if (kind === 'frag') {
    b.add(Sph(0.045), { at: [0, 0, 0], color: '#4b5236', rough: 0.7 });
    b.add(Cyl(0.014, 0.014, 0.03, 8), { at: [0, 0.05, 0], color: '#6c6f6a', rough: 0.4, metal: 0.6 });
    b.add(Box(0.012, 0.06, 0.02), { at: [0.03, 0.03, 0], color: '#77796f', rough: 0.4, metal: 0.6 });
  } else if (kind === 'smoke') {
    b.add(Cyl(0.032, 0.032, 0.12, 12), { at: [0, 0, 0], color: '#8b9096', rough: 0.55, metal: 0.3 });
    b.add(Cyl(0.034, 0.034, 0.02, 12), { at: [0, 0.02, 0], color: '#d9dcd7', rough: 0.6 });
  } else if (kind === 'flash') {
    b.add(Cyl(0.03, 0.03, 0.12, 12), { at: [0, 0, 0], color: '#23262a', rough: 0.5, metal: 0.4 });
    b.add(Cyl(0.032, 0.032, 0.016, 12), { at: [0, -0.02, 0], color: '#f2f2ec', rough: 0.4, glow: 0.3 });
  } else {
    b.add(Cyl(0.028, 0.028, 0.09, 10), { at: [0, 0, 0], color: '#d0651c', rough: 0.5 });
    b.add(Sph(0.028), { at: [0, 0.045, 0], color: '#d0651c', rough: 0.5 });
    b.add(Sph(0.028), { at: [0, -0.045, 0], color: '#30302c', rough: 0.5 });
  }
  return b.build();
}

// Explosivos colocados: carga de brecha (en la pared), C4 y claymore.
function breachModel() {
  const b = new Builder();
  b.add(Box(0.44, 0.62, 0.035), { at: [0, 0, 0.0175], color: '#5a5f55', rough: 0.7 });
  b.add(Box(0.36, 0.54, 0.02), { at: [0, 0, 0.045], color: '#3b3e37', rough: 0.8 });
  b.add(Box(0.1, 0.07, 0.03), { at: [0, 0.2, 0.06], color: '#20211e', rough: 0.5 });
  b.add(Box(0.03, 0.02, 0.01), { at: [0.02, 0.2, 0.078], color: '#ff3a1a', glow: 1 });
  return b.build();
}
function c4Model() {
  const b = new Builder();
  b.add(Box(0.16, 0.05, 0.1), { at: [0, 0.025, 0], color: '#cbc3a4', rough: 0.8 });
  b.add(Box(0.06, 0.02, 0.05), { at: [0.03, 0.06, 0], color: '#1e1f1c', rough: 0.5 });
  b.add(Box(0.015, 0.01, 0.015), { at: [0.05, 0.075, 0.012], color: '#ff2a1a', glow: 1 });
  return b.build();
}
function claymoreModel() {
  const b = new Builder();
  b.add(Box(0.22, 0.12, 0.05), { at: [0, 0.1, 0], color: '#4b5236', rough: 0.7 });
  for (const x of [-0.08, 0.08]) b.add(Box(0.012, 0.07, 0.012), { at: [x, 0.035, 0.01], color: '#2a2a26', rough: 0.5 });
  b.add(Box(0.02, 0.02, 0.01), { at: [0, 0.14, -0.03], color: '#ff2a1a', glow: 1 });
  return b.build();
}

// Alambre de púas (rollos en espiral) y alarma de proximidad.
function wireModel() {
  const b = new Builder();
  for (let k = 0; k < 14; k++) {
    const x = -0.95 + k * 0.146;
    for (let s = 0; s < 8; s++) {
      const a = s / 8 * Math.PI * 2, r = 0.26;
      b.add(Box(0.012, 0.012, 0.13), { at: [x + (s % 2) * 0.02, 0.3 + Math.sin(a) * r, Math.cos(a) * r], rot: [a, 0, 0], color: '#6d7072', rough: 0.35, metal: 0.8 });
    }
  }
  for (const x of [-0.9, 0.9]) b.add(Box(0.03, 0.62, 0.03), { at: [x, 0.31, 0], color: '#3a3c3e', rough: 0.5, metal: 0.6 });
  return b.build();
}
function alarmModel() {
  const b = new Builder();
  b.add(Box(0.1, 0.06, 0.1), { at: [0, 0.03, 0], color: '#2b2e33', rough: 0.5, metal: 0.3 });
  b.add(Cyl(0.02, 0.02, 0.02, 8), { at: [0, 0.07, 0], color: '#ffb21a', glow: 1 });
  return b.build();
}

export class PropRenderer {
  constructor(scene, wr) {
    this.scene = scene;
    this.U = wr.uniforms;
    this.albedo = wr.albedoTex;
    this.steelLayer = Math.max(0, TEXTURE_NAMES.indexOf('steel_plate'));
    this.geo = {
      droneBody: [droneBody('#3d9be9'), droneBody('#f0892b')], droneWheels: droneWheels(),
      camBase: camBase(), camHead: camHead(), hatch: hatchPlate(this.steelLayer), defuser: defuserModel(),
      grenade: { frag: grenadeModel('frag'), smoke: grenadeModel('smoke'), flash: grenadeModel('flash'), impact: grenadeModel('impact'), c4: c4Model() },
      breach: breachModel(), claymore: claymoreModel(), barbed: wireModel(), alarm: alarmModel(),
    };
    // láser de las claymores (línea roja fina)
    this.laserMat = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.8, toneMapped: false });
    this.panelGeo = new Map();   // "w×h" → {plate, pistons}
    this.items = new Map();      // clave → {group, kind, meshes, ...}
    this.seen = new Set();
    this.time = 0;
  }
  _mat() {
    const U = this.U;
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PROP_VERT, fragmentShader: PROP_FRAG,
      uniforms: {
        uAlbedo: { value: this.albedo }, uGlow: { value: 1 }, uDim: { value: 1 },
        uLight: U.uLight, uLightMin: U.uLightMin, uLightInvSize: U.uLightInvSize,
        uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel,
        uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
        uWarmColor: U.uWarmColor, uCoolColor: U.uCoolColor, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity,
        uDynPos: U.uDynPos, uDynCol: U.uDynCol, uDynCount: U.uDynCount, uAmbientMin: U.uAmbientMin,
      },
    });
  }
  _mesh(geo) { const m = new THREE.Mesh(geo, this._mat()); m.frustumCulled = true; return m; }
  _panelGeo(w, h) {
    const k = `${w.toFixed(2)}x${h.toFixed(2)}`;
    let g = this.panelGeo.get(k);
    if (!g) { g = { plate: panelPlate(w, h, this.steelLayer), pistons: panelPistons(w, h) }; this.panelGeo.set(k, g); }
    return g;
  }
  _get(key, make) {
    this.seen.add(key);
    let it = this.items.get(key);
    if (!it) { it = make(); it.key = key; this.items.set(key, it); this.scene.add(it.group); }
    return it;
  }
  clear() {
    for (const it of this.items.values()) this._dispose(it);
    this.items.clear();
  }
  _dispose(it) {
    this.scene.remove(it.group);
    it.group.traverse((o) => { if (o.material && o.material !== this.laserMat) o.material.dispose(); if (o.isLine && o.geometry) o.geometry.dispose(); });
  }

  /**
   * Sincroniza con la simulación. `s`: { drones, cams, panels, work, defuser, hide, myTeam, alpha }.
   */
  sync(dt, s) {
    this.time += dt;
    this.seen.clear();
    const a = s.alpha ?? 1;
    // ---------------- drones
    for (const d of s.drones || []) {
      if (!d.alive) continue;
      const it = this._get('d:' + d.id, () => {
        const group = new THREE.Group();
        const body = this._mesh(this.geo.droneBody[d.team === s.myTeam ? 0 : 1]);
        const wheels = this._mesh(this.geo.droneWheels);
        wheels.position.y = 0.072;
        group.add(body, wheels);
        return { group, kind: 'drone', wheels, spin: 0 };
      });
      const p = d.body.pos, q = d.prev;
      it.group.position.set(q.x + (p.x - q.x) * a, q.y + (p.y - q.y) * a, q.z + (p.z - q.z) * a);
      it.group.rotation.set(0, d.yaw, 0);
      it.spin += (d.moveSpeed || 0) * dt / 0.072 * (d.intent.moveZ < 0 ? -1 : 1);
      it.wheels.rotation.x = -it.spin;
      it.group.visible = d !== s.hide;
    }
    // ---------------- cámaras
    for (const c of s.cams || []) {
      const it = this._get('c:' + c.id, () => {
        const group = new THREE.Group();
        const base = this._mesh(this.geo.camBase);
        const head = this._mesh(this.geo.camHead);
        group.add(base, head);
        return { group, kind: 'cam', base, head };
      });
      it.group.position.set(c.pos.x, c.pos.y, c.pos.z);
      if (c.bulletproof && !it.armored) { it.armored = true; it.head.scale.set(1.3, 1.3, 1.3); it.base.scale.set(1.3, 1.3, 1.3); }
      // la base mira hacia la pared (detrás de la cámara, en su orientación de montaje)
      it.base.rotation.set(0, c.baseYaw, 0);
      if (c.alive) it.head.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
      else it.head.rotation.set(-1.1, c.baseYaw + 0.4, 0.5, 'YXZ');
      it.head.material.uniforms.uDim.value = c.alive ? 1 : 0.35;
      it.head.material.uniforms.uGlow.value = c.alive ? 0.6 + 0.4 * Math.sin(this.time * 4) : 0;
      it.group.visible = c !== s.hide;
    }
    // ---------------- refuerzos colocados y en curso
    const addPanel = (key, tgt, k) => {
      const it = this._get(key, () => {
        const group = new THREE.Group();
        if (tgt.kind === 'hatch') {
          const plate = this._mesh(this.geo.hatch);
          group.add(plate);
          group.position.set(tgt.hatch.x, tgt.hatch.y + 0.004, tgt.hatch.z);
          return { group, kind: 'hatch', plate };
        }
        const P = tgt.panel;
        const w = (P.u1 - P.u0) - 0.04, h = (P.y1 - P.y0) - 0.03;
        const g = this._panelGeo(w, h);
        const plate = this._mesh(g.plate), pistons = this._mesh(g.pistons);
        group.add(plate, pistons);
        const uc = (P.u0 + P.u1) / 2;
        const face = P.line + P.side * 0.125 + P.side * 0.004;
        if (P.axisN === 0) { group.position.set(face, P.y0 + 0.015, uc); group.rotation.y = P.side > 0 ? Math.PI / 2 : -Math.PI / 2; }
        else { group.position.set(uc, P.y0 + 0.015, face); group.rotation.y = P.side > 0 ? 0 : Math.PI; }
        return { group, kind: 'wall', plate, pistons, h };
      });
      // despliegue: la placa sube plegada y se estira; luego salen los pistones
      if (it.kind === 'wall') {
        const e1 = smooth((k - 0.12) / 0.3), e2 = smooth((k - 0.45) / 0.45);
        it.plate.scale.set(1, 0.35 + 0.65 * e1, 1);
        it.plate.position.y = (1 - e1) * it.h * 0.25;
        it.plate.visible = k > 0.05;
        it.pistons.scale.set(1, Math.max(0.05, e2), 1);
        it.pistons.position.z = (1 - e2) * -0.05;
        it.pistons.visible = k > 0.42;
      } else {
        const e = smooth((k - 0.1) / 0.6);
        it.plate.scale.set(0.3 + 0.7 * e, 1, 0.3 + 0.7 * e);
        it.plate.visible = k > 0.05;
      }
    };
    for (const rec of s.panels || []) addPanel('p:' + panelKey(rec), rec, 1);
    if (s.work) for (const [op, w] of s.work) {
      const t = w.target;
      if (t.kind !== 'wall' && t.kind !== 'hatch') continue;
      addPanel('p:' + panelKey(t), t, Math.min(1, w.t / w.total));
    }
    // ---------------- desactivador plantado
    if (s.defuser && s.defuser.planted && s.defuser.plantPos) {
      const P = s.defuser.plantPos;
      const it = this._get('defuser', () => { const group = new THREE.Group(); const m = this._mesh(this.geo.defuser); group.add(m); return { group, kind: 'defuser', m }; });
      it.group.position.set(P.x, P.y + 0.005, P.z);
      it.m.material.uniforms.uGlow.value = 0.5 + 0.5 * Math.sin(this.time * (6 + (s.defuser.urgency || 0) * 14));
    }
    // ---------------- granadas en vuelo o en el suelo
    for (const g of s.gadgets || []) {
      if (!g.alive || !this.geo.grenade[g.kind]) continue;
      const it = this._get('g:' + g.id, () => { const group = new THREE.Group(); const m = this._mesh(this.geo.grenade[g.kind]); group.add(m); return { group, kind: 'grenade', m, spin: 0 }; });
      if (g.kind === 'c4' && g.stuck) {
        // pegado: la cara de abajo contra la superficie
        const n = g.normal;
        it.group.position.set(g.pos.x - n.x * 0.02, g.pos.y - n.y * 0.02, g.pos.z - n.z * 0.02);
        it.m.rotation.set(n.z ? Math.sign(n.z) * Math.PI / 2 : n.y < 0 ? Math.PI : 0, 0, n.x ? -Math.sign(n.x) * Math.PI / 2 : 0);
        it.m.material.uniforms.uGlow.value = Math.sin(this.time * 6) > 0 ? 1 : 0.2;
        continue;
      }
      it.group.position.set(g.pos.x, g.pos.y + (g.rest ? 0.03 : 0), g.pos.z);
      if (!g.rest) it.spin += dt * 14;
      it.m.rotation.set(g.rest ? Math.PI / 2 : it.spin, g.rest ? 0.7 : it.spin * 0.6, 0);
      if (g.kind === 'flash') it.m.material.uniforms.uGlow.value = g.t > 1.1 ? 1 : 0.3;
    }
    // ---------------- cargas de brecha y claymores colocadas
    for (const c of s.placed || []) {
      if (!c.alive) continue;
      const it = this._get('x:' + c.id, () => {
        const group = new THREE.Group();
        const m = this._mesh(this.geo[c.kind] || this.geo.claymore);
        group.add(m);
        let laser = null;
        if (c.kind === 'claymore') {
          const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.14, -0.03), new THREE.Vector3(0, 0.3, -2.0)]);
          laser = new THREE.Line(lg, this.laserMat);
          group.add(laser);
        }
        return { group, kind: c.kind, m, laser };
      });
      if (c.kind === 'breach' || c.kind === 'alarm') {
        const n = c.normal;
        it.group.position.set(c.pos.x, c.pos.y, c.pos.z);
        if (c.kind === 'alarm') {
          // la base contra la superficie (y local hacia fuera)
          it.m.rotation.set(n.z ? Math.sign(n.z) * Math.PI / 2 : n.y < 0 ? Math.PI : 0, 0, n.x ? -Math.sign(n.x) * Math.PI / 2 : 0);
        } else {
          // la cara de delante (z local) hacia fuera de la pared
          it.group.rotation.set(n.y ? -Math.sign(n.y) * Math.PI / 2 : 0, n.x ? Math.sign(n.x) * Math.PI / 2 : n.z < 0 ? Math.PI : 0, 0);
        }
      } else {
        it.group.position.set(c.pos.x, c.pos.y, c.pos.z);
        it.group.rotation.set(0, c.yaw, 0);
      }
      it.m.material.uniforms.uGlow.value = Math.sin(this.time * 5) > 0 ? 1 : 0.25;
    }
    // borrar lo que ya no existe
    for (const [k, it] of this.items) if (!this.seen.has(k)) { this._dispose(it); this.items.delete(k); }
  }
}

function panelKey(t) {
  if (t.kind === 'hatch') return 'h' + t.hatch.id;
  const P = t.panel;
  return `w${P.axisN}_${P.line}_${P.side}_${P.u0}_${P.y0}`;
}
function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

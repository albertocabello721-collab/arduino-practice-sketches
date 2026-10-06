// V1.5, muestra «recursos reales» (tecla U en el campo de pruebas): un fusil real con sus texturas
// (M4A1 de nisu, CC0), un panel de yeso pintado y un parche de parqué (Poly Haven, CC0) apoyados en la
// fachada junto a la puerta, y la grabación de un disparo (Kurt, CC0) en capas con el golpe grave
// sintético. Los archivos se cargan por ruta relativa, al lado de la página, la primera vez que se
// pide; si alguno falla queda lo procedural y se avisa en la consola. No toca nada fuera del campo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LIGHTING_GLSL } from '../render/shaders.js';

export const BASE = 'recursos/';
export const CREDITS = 'M4A1: nisu (CC0) · yeso y parqué: Poly Haven (CC0) · disparo: Kurt (CC0)';

// anclajes medidos del M4A1 (metros, el cañón hacia -Z): ver recursos/LICENCIAS.md y tools/convertir
const M4A1 = {
  sightY: 0.082,
  rail: { y: 0.0512, z: -0.05 },
  muzzle: [-0.0009, 0.0209, -0.536],
  grip: { zv: -0.26, za: -0.29, y0: -0.0106 },
  laser: [0.041, 0.012, -0.2],
  hand: { grip: [0, -0.095, 0.084], fore: [0, -0.025, -0.29] },
  mag: 'Magazine', bolt: 'Charging_Handle', boltTravel: 0.055,
  sightMeshes: ['Sight', 'Sight_2', 'Switch1', 'Switch2'],
};
// la muestra junto a la fachada: el panel entre la puerta y el pilar del porche, el parqué delante
const PANEL = { x: 18.275, y: 1.62, z: -0.137, w: 3.75, h: 3.0, texSize: 2.0 };        // yeso pintado: 2 × 2 m por repetición
const FLOOR = { x: 18.2, y: 0.012, z: -2.14, w: 3.8, d: 4.0, texSize: 3.4 };            // parqué: 3,4 × 3,4 m

const PBR_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
in vec3 position; in vec2 uv;
out vec3 vWorld; out vec2 vUv;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
// mismo modelo de luz que los vóxeles (volumen ambiente, sol con sombra, luces dinámicas, niebla), con
// texturas de verdad: albedo sRGB, normal (OpenGL) y ARM (oclusión, rugosidad, metal)
const PBR_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D uDiff; uniform sampler2D uNor; uniform sampler2D uArm;
uniform vec3 uN; uniform vec3 uT; uniform vec3 uB; uniform vec2 uRepeat;
uniform vec3 cameraPosition;
${LIGHTING_GLSL}
in vec3 vWorld; in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 uv = vUv * uRepeat;
  vec3 albedo = texture(uDiff, uv).rgb;
  vec3 arm = texture(uArm, uv).rgb;
  vec3 tn = texture(uNor, uv).rgb * 2.0 - 1.0;
  vec3 n = normalize(uT * tn.x + uB * tn.y + uN * tn.z);
  vec3 V = normalize(cameraPosition - vWorld);
  float sunVis = shadowAt(vWorld, uN);
  vec3 col = shade(vWorld, n, uN, V, albedo, arm.g, arm.b, arm.r, sunVis);
  col = applyFog(col, length(cameraPosition - vWorld), vWorld);
  fragColor = vec4(col, 1.0);
}
`;

export class RealAssets {
  constructor(ctx) {
    this.ctx = ctx;
    this.loaded = null;        // la promesa de carga (una vez)
    this.loading = false;
    this.on = false;
    this.ok = {};              // qué cargó: arma, panel, suelo, disparo
    this.meshes = [];
    this.model = null; this.sample = null;
  }
  /** Carga todo (una vez). Cada archivo que falle deja su parte en procedural y lo dice en la consola. */
  load() {
    if (!this.loaded) { this.loading = true; this.loaded = this._load().finally(() => { this.loading = false; }); }
    return this.loaded;
  }
  async _load() {
    const tl = new THREE.TextureLoader();
    const tex = (name, srgb) => this._try(name, tl.loadAsync(BASE + name).then((t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy()); return t; }));
    const text = (name) => this._try(name, fetch(BASE + name).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }));
    const bytes = (name) => this._try(name, fetch(BASE + name).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }));
    const [gltf, mCol, mNor, mArm, pDiff, pNor, pArm, fDiff, fNor, fArm, wav] = await Promise.all([
      text('m4a1.json'), tex('m4a1_color.webp', true), tex('m4a1_normal.webp'), tex('m4a1_arm.webp'),
      tex('painted_plaster_wall_diff.webp', true), tex('painted_plaster_wall_nor_gl.webp'), tex('painted_plaster_wall_arm.webp'),
      tex('herringbone_parquet_diff.webp', true), tex('herringbone_parquet_nor_gl.webp'), tex('herringbone_parquet_arm.webp'),
      bytes('disparo_fusil.wav'),
    ]);
    // el arma: el glTF (JSON con la geometría incrustada) y sus tres texturas
    if (gltf && mCol && mNor && mArm) {
      try {
        const g = await new GLTFLoader().parseAsync(gltf, BASE);
        const mat = new THREE.MeshStandardMaterial({ map: mCol, normalMap: mNor, roughnessMap: mArm, metalnessMap: mArm, metalness: 1, roughness: 1 });
        for (const t of [mCol, mNor, mArm]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.needsUpdate = true; }   // (uv de glTF)
        const root = new THREE.Group(); root.name = 'M4A1';
        const scene = g.scene;
        const meshes = []; scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
        for (const m of meshes) { m.material = mat; root.add(m); }   // (ya están en metros y en su sitio: hijas directas)
        this.model = root; this.ok.arma = true;
      } catch (e) { this._fail('m4a1.json', e); }
    }
    this.ok.arma = !!this.ok.arma;
    // el panel y el suelo, con la luz del mundo
    const U = this.ctx.wr.uniforms;
    const mk = (geo, diff, nor, arm, n, t, b, rep) => {
      const m = new THREE.Mesh(geo, new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: PBR_VERT, fragmentShader: PBR_FRAG,
        uniforms: {
          uDiff: { value: diff }, uNor: { value: nor }, uArm: { value: arm }, uN: { value: new THREE.Vector3(...n) }, uT: { value: new THREE.Vector3(...t) }, uB: { value: new THREE.Vector3(...b) }, uRepeat: { value: new THREE.Vector2(...rep) },
          uLight: U.uLight, uLightMin: U.uLightMin, uLightInvSize: U.uLightInvSize,
          uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel, uShadowOn: U.uShadowOn,
          uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
          uWarmColor: U.uWarmColor, uCoolColor: U.uCoolColor, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity,
          uDynPos: U.uDynPos, uDynCol: U.uDynCol, uDynCount: U.uDynCount, uAmbientMin: U.uAmbientMin,
        },
      }));
      m.visible = false; m.frustumCulled = true;
      return m;
    };
    if (pDiff && pNor && pArm) {
      const m = mk(new THREE.PlaneGeometry(PANEL.w, PANEL.h), pDiff, pNor, pArm, [0, 0, -1], [-1, 0, 0], [0, 1, 0], [PANEL.w / PANEL.texSize, PANEL.h / PANEL.texSize]);
      m.position.set(PANEL.x, PANEL.y, PANEL.z); m.rotation.y = Math.PI; m.name = 'muestra-panel';
      this.meshes.push(m); this.ok.panel = true;
    }
    if (fDiff && fNor && fArm) {
      const m = mk(new THREE.PlaneGeometry(FLOOR.w, FLOOR.d), fDiff, fNor, fArm, [0, 1, 0], [1, 0, 0], [0, 0, -1], [FLOOR.w / FLOOR.texSize, FLOOR.d / FLOOR.texSize]);
      m.position.set(FLOOR.x, FLOOR.y, FLOOR.z); m.rotation.x = -Math.PI / 2; m.name = 'muestra-suelo';
      this.meshes.push(m); this.ok.suelo = true;
    }
    this.ok.panel = !!this.ok.panel; this.ok.suelo = !!this.ok.suelo;
    for (const m of this.meshes) this.ctx.scene.add(m);
    // el disparo grabado
    if (wav) { try { this.sample = await this.ctx.audio.decode(wav); this.ok.disparo = true; } catch (e) { this._fail('disparo_fusil.wav', e); } }
    this.ok.disparo = !!this.ok.disparo;
    return this.ok;
  }
  _try(name, p) { return p.catch((e) => { this._fail(name, e); return null; }); }
  _fail(name, e) { console.warn(`[recursos] no se pudo cargar ${BASE}${name} (${e && e.message ? e.message : e}); sigue lo procedural`); }

  /** Enciende o apaga la muestra (arma, panel y suelo, disparo). Devuelve el estado para el aviso. */
  enable(on) {
    const { vm, audio } = this.ctx;
    this.on = on;
    if (on && this.model) vm.setModel('ar', this.model, M4A1); else vm.clearModel('ar');
    for (const m of this.meshes) m.visible = on;
    audio.setShotSample(on && this.sample ? this.sample : null, 'layered');
    return this.status();
  }
  status() {
    if (!this.on) return 'Recursos procedurales';
    const k = (ok, name) => `${name} ${ok ? '✓' : '✗ (procedural)'}`;
    return `Recursos reales: ${k(this.ok.arma, 'M4A1')} · ${k(this.ok.panel, 'yeso')} · ${k(this.ok.suelo, 'parqué')} · ${k(this.ok.disparo, 'disparo')}`;
  }
  dispose() {
    this.enable(false);
    for (const m of this.meshes) { this.ctx.scene.remove(m); m.material.dispose(); m.geometry.dispose(); }
    this.meshes = [];
  }
}

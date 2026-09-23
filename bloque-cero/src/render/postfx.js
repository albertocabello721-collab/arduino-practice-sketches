// Post-proceso: render HDR (con MSAA) → arma en primera persona encima →
// bloom → gradación (viñeta, grano, tinte) → tone mapping ACES + sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

// Pasada del mundo con pre-pasada de profundidad (capa 1 = geometría de vóxeles).
class WorldPass extends Pass {
  constructor(scene, camera, prepassMat) {
    super();
    this.scene = scene; this.camera = camera; this.prepassMat = prepassMat;
    this.needsSwap = false;
    this.clearColor = new THREE.Color(0, 0, 0);
  }
  render(renderer, writeBuffer, readBuffer) {
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.setClearColor(this.clearColor, 1);
    renderer.clear(true, true, false);
    const mask = this.camera.layers.mask;
    // 1) solo profundidad del mundo
    this.camera.layers.set(1);
    const ov = this.scene.overrideMaterial, bg = this.scene.background;
    this.scene.overrideMaterial = this.prepassMat; this.scene.background = null;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = ov; this.scene.background = bg;
    // 2) todo con materiales reales
    this.camera.layers.mask = mask;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = oldAuto;
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uSat: { value: 0.95 },
    uTint: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSat, uDamage, uFlash; uniform vec3 uTint; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat) * uTint;
      // sombras ligeramente frías, luces cálidas (gradación tipo Siege)
      c = mix(c * vec3(0.96, 1.0, 1.05), c * vec3(1.03, 1.0, 0.96), smoothstep(0.1, 1.2, l));
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette * 2.2;
      c *= v;
      // daño: bordes rojos
      c = mix(c, c * vec3(1.6, 0.35, 0.3), uDamage * smoothstep(0.15, 0.7, length(q) * 1.4));
      c += uFlash;
      float g = (h(vUv * uRes + fract(uTime * 13.7) * 91.0) - 0.5) * uGrain;
      c += g * (0.3 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality = 'alta', prepassMat = null) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.msaa = quality === 'alta' ? 4 : quality === 'media' ? 2 : 0;
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: this.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.worldPass = prepassMat ? new WorldPass(scene, camera, prepassMat) : new RenderPass(scene, camera);
    this.vmPass = new RenderPass(vmScene, vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 2.6);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.vmPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }
  setQuality(q) {
    this.bloom.enabled = q !== 'baja';
    this.setSamples(q === 'alta' ? 4 : q === 'media' ? 2 : 0);
  }
  setSamples(n) {
    if (n === this.msaa) return;
    this.msaa = n;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { rt.samples = n; rt.dispose(); }
  }
  // Ajuste fino de la calidad adaptativa: nivel 0 (máxima) … 4 (mínima)
  setAdaptiveLevel(level, base = 'alta') {
    this.bloom.enabled = level < 3 && base !== 'baja';
    this.grade.uniforms.uGrain.value = level < 4 ? 0.035 : 0.0;
    const baseS = base === 'alta' ? 4 : base === 'media' ? 2 : 0;
    this.setSamples(level >= 3 ? 0 : level >= 2 ? Math.min(baseS, 2) : baseS);
  }
  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}

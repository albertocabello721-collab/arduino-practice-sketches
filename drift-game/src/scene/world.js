// Renderer, sky, fog and lights. The sun's shadow box follows the car so
// shadows stay sharp on big maps without a huge shadow map.

import * as THREE from 'three';

const SKY_TOP = new THREE.Color('#3f7cc4');
const SKY_HORIZON = new THREE.Color('#d7e5ef');
const SUN_DIR = new THREE.Vector3(-0.55, 0.75, -0.38).normalize();
const SHADOW_HALF = 45; // m of shadow coverage around the car
const SHADOW_MAP = 2048;

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  return renderer;
}

export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 160, 750);
    this.sky = makeSky();
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight('#dcebf7', '#6d6152', 1.35));

    this.sun = new THREE.DirectionalLight('#fff1dd', 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
  }

  // Keep the sky around the camera and the shadow box centered on the car,
  // snapped to whole shadow-map texels so shadow edges don't shimmer.
  update(camera, x, y, z) {
    this.sky.position.copy(camera.position);
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx + SUN_DIR.x * 150, y + SUN_DIR.y * 150, sz + SUN_DIR.z * 150);
  }
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY_TOP },
      horizon: { value: SKY_HORIZON },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float sun = max(dot(vDir, sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.78) * (pow(sun, 400.0) * 1.2 + pow(sun, 8.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

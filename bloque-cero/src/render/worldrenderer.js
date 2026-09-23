// Render del mundo de vóxeles con Three.js:
//  - texture arrays PBR procedurales
//  - mallas por región (2×2×2 chunks) para reducir llamadas de dibujo
//  - sombra del sol (mapa de profundidad estático que se rehace al destruir)
//  - volumen de luz ambiente en una Data3DTexture
import * as THREE from 'three';
import { meshCell, setMaterialLayers, writeQuadIndices } from './mesher.js';
import { WORLD_VERT, WORLD_FRAG, PREPASS_FRAG, SKY_VERT, SKY_FRAG, MAX_DYN_LIGHTS } from './shaders.js';
import { TEXTURE_NAMES, TINTS, TINT_NAMES } from './texgen.js';
import { LightVolume } from './lightvolume.js';
import { MC, VS } from '../world/voxelworld.js';

const R = 4; // celdas de mallado (16³) por lado de región: regiones de 8 m

export class WorldRenderer {
  constructor(renderer, scene, world, map, texData, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.world = world;
    this.map = map;
    this.opts = { shadowSize: 4096, ...opts };
    this.cellMeshes = new Map();        // índice de celda -> {solid, glass} (arrays)
    this.regions = new Map();           // ri -> {solid: {mesh, cap}, glass: {mesh, cap}}
    this.dirtyRegions = new Set();
    this.nrx = Math.ceil(world.nmx / R); this.nry = Math.ceil(world.nmy / R); this.nrz = Math.ceil(world.nmz / R);
    this.stats = { remeshed: 0, regionsBuilt: 0, lastMeshMs: 0, lastRegionMs: 0, lastLightMs: 0, lastShadowMs: 0 };
    this.shadowDirty = true;
    this.shadowTimer = 0;
    this.lightDirtyBox = null;
    this.lightTimer = 0;

    this._initTextures(texData);
    this._initLightVolume();
    this._initShadow();
    this._initMaterials();
    this._initSky();
    this._initOuterGround();

    world.onChange((x0, y0, z0, x1, y1, z1) => this._onWorldChange(x0, y0, z0, x1, y1, z1));
  }

  // ------------------------------------------------------------ texturas
  _initTextures(T) {
    const n = T.layers.length, S = T.size;
    const mk = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, S, S, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.albedoTex = mk(T.albedo, true);
    this.normalTex = mk(T.normal, false);
    this.layerInfo = [];
    for (let i = 0; i < 64; i++) {
      const L = T.layers[i];
      this.layerInfo.push(L ? new THREE.Vector4(L.uvScale, L.normalStrength, L.emissive, L.cutout) : new THREE.Vector4(1, 1, 0, 0));
    }
    this.tints = [];
    for (let i = 0; i < 32; i++) {
      const c = TINTS[TINT_NAMES[i]] || [1, 1, 1];
      this.tints.push(new THREE.Vector3(c[0], c[1], c[2]));
    }
    const layerIndex = (name) => { const i = TEXTURE_NAMES.indexOf(name); if (i < 0) throw new Error('textura desconocida ' + name); return i; };
    const tintIndex = (name) => { const i = TINT_NAMES.indexOf(name); return i < 0 ? 0 : i; };
    setMaterialLayers(layerIndex, tintIndex);
    this.layerIndex = layerIndex;
    this.texAvg = T.avg;
  }

  // ------------------------------------------------------------ luz ambiente
  _initLightVolume() {
    const lv = new LightVolume(this.world, { x: -4, y: -4, z: -4 }, { x: 44, y: 10, z: 30 });
    lv.setLights(this.map.lights);
    lv.computeAll();
    this.lightVolume = lv;
    const t = new THREE.Data3DTexture(lv.data, lv.nx, lv.ny, lv.nz);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    this.lightTex = t;
  }

  // ------------------------------------------------------------ sombra del sol
  _initShadow() {
    const size = this.opts.shadowSize;
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false });
    const dt = new THREE.DepthTexture(size, size);
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter; dt.magFilter = THREE.LinearFilter;
    rt.depthTexture = dt;
    this.shadowTarget = rt;
    const sun = this.map.sun.dir;
    this.sunDir = new THREE.Vector3(sun.x, sun.y, sun.z).normalize();
    const center = new THREE.Vector3(20, 2, 13);
    const ext = 36;
    const cam = new THREE.OrthographicCamera(-ext, ext, ext, -ext, 1, 140);
    cam.position.copy(center).addScaledVector(this.sunDir, 70);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    cam.layers.set(1);
    this.shadowCam = cam;
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.shadowMatrix = new THREE.Matrix4().multiplyMatrices(bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  }

  // ------------------------------------------------------------ materiales
  _initMaterials() {
    const lv = this.lightVolume;
    const U = {
      uAlbedo: { value: this.albedoTex },
      uNormal: { value: this.normalTex },
      uLayerInfo: { value: this.layerInfo },
      uTints: { value: this.tints },
      uLight: { value: this.lightTex },
      uLightMin: { value: new THREE.Vector3(lv.min.x, lv.min.y, lv.min.z) },
      uLightInvSize: { value: new THREE.Vector3(1 / (lv.nx * lv.cell), 1 / (lv.ny * lv.cell), 1 / (lv.nz * lv.cell)) },
      uShadowMap: { value: this.shadowTarget.depthTexture },
      uShadowMatrix: { value: this.shadowMatrix },
      uShadowTexel: { value: 1 / this.opts.shadowSize },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Vector3(1.95, 1.76, 1.52) },
      uSkyColor: { value: new THREE.Vector3(0.33, 0.41, 0.56) },
      uGroundColor: { value: new THREE.Vector3(0.2, 0.18, 0.15) },
      uWarmColor: { value: new THREE.Vector3(0.95, 0.64, 0.38) },
      uCoolColor: { value: new THREE.Vector3(0.56, 0.64, 0.74) },
      uFogColor: { value: new THREE.Vector3(0.42, 0.48, 0.56) },
      uFogDensity: { value: 0.0045 },
      uDynPos: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uDynCol: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uDynCount: { value: 0 },
      uAmbientMin: { value: 0.012 },
      uEmissive: { value: 5.0 },
      uTime: { value: 0 },
      uGlass: { value: 0 },
    };
    this.uniforms = U;
    // Pasada principal: no escribe profundidad; la pre-pasada ya la dejó puesta, así el
    // shader PBR solo se ejecuta una vez por píxel visible (sin sobredibujado).
    this.solidMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG,
      uniforms: U, side: THREE.FrontSide, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    });
    this.prepassMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: WORLD_VERT, fragmentShader: PREPASS_FRAG,
      uniforms: {}, side: THREE.FrontSide, colorWrite: false,
    });
    // hojas y escaleras de mano: descarte por alfa en su propio material (el principal no
    // puede tener discard o la GPU pierde el test de profundidad temprano)
    this.cutoutMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG,
      uniforms: U, side: THREE.DoubleSide, defines: { CUTOUT: 1 },
    });
    const G = { ...U, uGlass: { value: 1 } };
    this.glassMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG,
      uniforms: G, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  _initSky() {
    const g = new THREE.SphereGeometry(900, 32, 16);
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uZenith: { value: new THREE.Vector3(0.1, 0.2, 0.46) },
        uHorizon: { value: new THREE.Vector3(0.46, 0.5, 0.56) },
        uSunColor: { value: new THREE.Vector3(1.2, 1.05, 0.85) },
      },
    });
    this.sky = new THREE.Mesh(g, m);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  // Suelo exterior más allá de la rejilla de vóxeles.
  _initOuterGround() {
    const w = this.world;
    const x0 = w.ox, x1 = w.ox + w.nx * VS, z0 = w.oz, z1 = w.oz + w.nz * VS, E = 500;
    const rects = [[x0 - E, z0 - E, x1 + E, z0], [x0 - E, z1, x1 + E, z1 + E], [x0 - E, z0, x0, z1], [x1, z0, x1 + E, z1]];
    const pos = [], dat = [], idx = [];
    const grass = this.layerIndex('grass');
    for (const [a, b, c, d] of rects) {
      const v = pos.length / 4;
      for (const [x, z] of [[a, b], [c, b], [c, d], [a, d]]) { pos.push(x, -0.001, z, 2); dat.push(grass, 3, 0, 0); }
      idx.push(v, v + 3, v + 2, v, v + 2, v + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 4));
    g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array(dat), 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.solidMat);
    m.frustumCulled = false;
    m.layers.enable(1);
    this.scene.add(m);
    this.outerGround = m;
  }

  // ------------------------------------------------------------ mallas
  regionIndex(rx, ry, rz) { return (ry * this.nrz + rz) * this.nrx + rx; }

  buildAll(onProgress) {
    const w = this.world;
    let n = 0;
    const total = w.nmx * w.nmy * w.nmz;
    for (let my = 0; my < w.nmy; my++) for (let mz = 0; mz < w.nmz; mz++) for (let mx = 0; mx < w.nmx; mx++) {
      this._remeshCell(mx, my, mz);
      n++;
      if (onProgress && n % 256 === 0) onProgress(n / total);
    }
    w.dirty.clear();
    for (const ri of this.dirtyRegions) this._buildRegion(ri);
    this.dirtyRegions.clear();
    this.shadowDirty = true;
  }

  _remeshCell(mx, my, mz) {
    const w = this.world;
    const mi = w.meshIndex(mx, my, mz);
    const ci = w.chunkIndex(mx >> 1, my >> 1, mz >> 1);
    let m = null;
    if (w.chunks[ci] !== null || my === w.groundMY - 1) m = meshCell(w, mx, my, mz); // implícito: solo la capa del césped
    const had = this.cellMeshes.has(mi);
    if (m) this.cellMeshes.set(mi, m); else this.cellMeshes.delete(mi);
    if (m || had) this.dirtyRegions.add(this.regionIndex(Math.floor(mx / R), Math.floor(my / R), Math.floor(mz / R)));
    this.stats.remeshed++;
  }

  _buildRegion(ri) {
    const rx = ri % this.nrx, rz = Math.floor(ri / this.nrx) % this.nrz, ry = Math.floor(ri / (this.nrx * this.nrz));
    const w = this.world;
    const parts = { solid: [], glass: [], cutout: [] };
    for (let dy = 0; dy < R; dy++) for (let dz = 0; dz < R; dz++) for (let dx = 0; dx < R; dx++) {
      const mx = rx * R + dx, my = ry * R + dy, mz = rz * R + dz;
      if (mx >= w.nmx || my >= w.nmy || mz >= w.nmz) continue;
      const m = this.cellMeshes.get(w.meshIndex(mx, my, mz));
      if (!m) continue;
      if (m.solid) parts.solid.push([m.solid, dx * MC, dy * MC, dz * MC]);
      if (m.glass) parts.glass.push([m.glass, dx * MC, dy * MC, dz * MC]);
      if (m.cutout) parts.cutout.push([m.cutout, dx * MC, dy * MC, dz * MC]);
    }
    let reg = this.regions.get(ri);
    if (!reg) { reg = { solid: null, glass: null, cutout: null }; this.regions.set(ri, reg); }
    const span = R * MC * VS;
    const origin = [w.ox + rx * span, w.oy + ry * span, w.oz + rz * span];
    for (const kind of ['solid', 'glass', 'cutout']) {
      const list = parts[kind];
      let slot = reg[kind];
      let vc = 0, qc = 0;
      for (const [p] of list) { vc += p.vertexCount; qc += p.quads; }
      if (vc === 0) { if (slot) slot.mesh.visible = false; continue; }
      if (!slot || slot.cap < vc) {
        // crecer con holgura para no reasignar en cada disparo
        if (slot) { this.scene.remove(slot.mesh); slot.mesh.geometry.dispose(); }
        const cap = Math.ceil(vc * 1.5 / 4) * 4 + 64;
        const g = new THREE.BufferGeometry();
        const pa = new THREE.BufferAttribute(new Uint8Array(cap * 4), 4); pa.setUsage(THREE.DynamicDrawUsage);
        const da = new THREE.BufferAttribute(new Uint8Array(cap * 4), 4); da.setUsage(THREE.DynamicDrawUsage);
        const ia = new THREE.BufferAttribute(new Uint32Array(cap / 4 * 6), 1); ia.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('position', pa); g.setAttribute('aData', da); g.setIndex(ia);
        const half = R * MC / 2;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, half, half), half * Math.sqrt(3));
        g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(R * MC, R * MC, R * MC));
        const mesh = new THREE.Mesh(g, kind === 'solid' ? this.solidMat : kind === 'glass' ? this.glassMat : this.cutoutMat);
        mesh.position.set(origin[0], origin[1], origin[2]);
        mesh.scale.setScalar(VS);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        if (kind === 'solid') mesh.layers.enable(1);
        this.scene.add(mesh);
        slot = { mesh, cap };
        reg[kind] = slot;
      }
      const g = slot.mesh.geometry;
      const pos = g.attributes.position.array, dat = g.attributes.aData.array, idx = g.index.array;
      let vo = 0, io = 0;
      for (const [p, ox, oy, oz] of list) {
        const n = p.vertexCount, src = p.pos;
        const d0 = vo * 4;
        for (let i = 0; i < n * 4; i += 4) {
          pos[d0 + i] = src[i] + ox; pos[d0 + i + 1] = src[i + 1] + oy; pos[d0 + i + 2] = src[i + 2] + oz; pos[d0 + i + 3] = src[i + 3];
        }
        dat.set(p.dat, d0);
        writeQuadIndices(idx, io, p.dat, vo, p.quads);
        vo += n; io += p.quads * 6;
      }
      for (const a of [g.attributes.position, g.attributes.aData]) { a.clearUpdateRanges(); a.addUpdateRange(0, vc * 4); a.needsUpdate = true; }
      g.index.clearUpdateRanges(); g.index.addUpdateRange(0, io); g.index.needsUpdate = true;
      g.setDrawRange(0, io);
      slot.mesh.visible = true;
    }
    this.stats.regionsBuilt++;
  }

  _onWorldChange(x0, y0, z0, x1, y1, z1) {
    this.shadowDirty = true;
    const b = this.lightDirtyBox;
    if (!b) this.lightDirtyBox = [x0, y0, z0, x1, y1, z1];
    else { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.min(b[2], z0); b[3] = Math.max(b[3], x1); b[4] = Math.max(b[4], y1); b[5] = Math.max(b[5], z1); }
  }

  /** Remalla celdas sucias con un presupuesto de tiempo, priorizando las cercanas a la cámara. */
  update(dt, camPos, budgetMs = 4) {
    const w = this.world;
    this.uniforms.uTime.value += dt;
    this.sky.position.copy(camPos);
    if (w.dirty.size) {
      const t0 = performance.now();
      const cell = MC * VS;
      const list = [];
      for (const mi of w.dirty) {
        const mx = mi % w.nmx, mz = Math.floor(mi / w.nmx) % w.nmz, my = Math.floor(mi / (w.nmx * w.nmz));
        const dx = (mx + 0.5) * cell + w.ox - camPos.x, dy = (my + 0.5) * cell + w.oy - camPos.y, dz = (mz + 0.5) * cell + w.oz - camPos.z;
        list.push([mi, mx, my, mz, dx * dx + dy * dy + dz * dz]);
      }
      list.sort((a, b) => a[4] - b[4]);
      for (const [mi, mx, my, mz] of list) {
        this._remeshCell(mx, my, mz);
        w.dirty.delete(mi);
        if (performance.now() - t0 > budgetMs) break;
      }
      const t1 = performance.now();
      for (const ri of this.dirtyRegions) this._buildRegion(ri);
      this.dirtyRegions.clear();
      this.stats.lastMeshMs = t1 - t0;
      this.stats.lastRegionMs = performance.now() - t1;
    }
    // luz ambiente: trabajo troceado entre fotogramas (máx. ~3 ms por fotograma)
    const lv = this.lightVolume;
    this.lightTimer -= dt;
    if (!lv.job && this.lightDirtyBox && this.lightTimer <= 0) {
      const b = this.lightDirtyBox; this.lightDirtyBox = null;
      const c = lv.cellsForVoxelBox(b[0], b[1], b[2], b[3], b[4], b[5]);
      if (c[0] <= c[3] && c[1] <= c[4] && c[2] <= c[5]) {
        const vol = (c[3] - c[0] + 1) * (c[4] - c[1] + 1) * (c[5] - c[2] + 1);
        if (vol > lv.nx * lv.ny * lv.nz * 0.4) lv.startJob(0, 0, 0, lv.nx - 1, lv.ny - 1, lv.nz - 1, 0, true);
        else lv.startJob(c[0], c[1], c[2], c[3], c[4], c[5], vol < 64 ? 12 : 20, false);
      }
      this.lightTimer = 0.2;
    }
    if (lv.job) {
      const t0 = performance.now();
      if (lv.stepJob(1.5)) this.lightTex.needsUpdate = true;
      this.stats.lastLightMs = performance.now() - t0;
    }
    this.shadowTimer -= dt;
  }

  renderShadowIfNeeded(force = false) {
    if (!force && (!this.shadowDirty || this.shadowTimer > 0)) return;
    this.shadowDirty = false;
    this.shadowTimer = 0.2;
    const t0 = performance.now();
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.depthMat;
    const skyVis = this.sky.visible; this.sky.visible = false;
    r.setRenderTarget(this.shadowTarget);
    r.clear(false, true, false);
    r.render(this.scene, this.shadowCam);
    r.setRenderTarget(prevTarget);
    this.scene.overrideMaterial = prevOverride;
    this.sky.visible = skyVis;
    this.stats.lastShadowMs = performance.now() - t0;
  }

  // Luces dinámicas: [{x,y,z, r, g, b, radius}]
  setDynamicLights(list) {
    const P = this.uniforms.uDynPos.value, C = this.uniforms.uDynCol.value;
    const n = Math.min(MAX_DYN_LIGHTS, list.length);
    for (let i = 0; i < n; i++) { const l = list[i]; P[i].set(l.x, l.y, l.z, l.radius); C[i].set(l.r, l.g, l.b, 1); }
    this.uniforms.uDynCount.value = n;
  }

  drawCalls() {
    let n = 0;
    for (const r of this.regions.values()) for (const k of ['solid', 'glass', 'cutout']) if (r[k] && r[k].mesh.visible) n++;
    return n;
  }
}

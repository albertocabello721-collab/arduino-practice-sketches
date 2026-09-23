// Efectos: escombros físicos (cubitos del material roto), polvo, chispas,
// trazadoras, marcas de impacto y luces dinámicas de fogonazos/explosiones.
import * as THREE from 'three';
import { MATS, SOLID, MAT } from '../world/materials.js';
import { raycastFirst } from '../world/raycast.js';
import { VS } from '../world/voxelworld.js';
import { TINTS } from './texgen.js';

const MAX_DEBRIS = 2400;
const MAX_DUST = 900;
const MAX_DECALS = 500;
const MAX_TRACERS = 48;

function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

export class Effects {
  constructor(scene, world, worldRenderer) {
    this.scene = scene;
    this.world = world;
    this.wr = worldRenderer;
    this.time = 0;
    this._initDebris();
    this._initDust();
    this._initDecals();
    this._initTracers();
    this.lights = []; // {x,y,z,r,g,b,radius,life,max}
    this.matColor = MATS.map((m) => {
      if (!m.surf) return [0.5, 0.5, 0.5];
      const avg = worldRenderer.texAvg[m.surf] || [0.5, 0.5, 0.5];
      const t = TINTS[m.tint] || [1, 1, 1];
      return [avg[0] * t[0], avg[1] * t[1], avg[2] * t[2]];
    });
    this.edgeColor = MATS.map((m) => {
      const avg = m.edge ? worldRenderer.texAvg[m.edge] : null;
      return avg || this.matColor[m.id];
    });
    this._lightSample = { sky: 1, warm: 0, cool: 0 };
  }

  lightAt(x, y, z) {
    const s = this.wr.lightVolume.sample(x, y, z, this._lightSample);
    return 0.05 + s.sky * s.sky * 0.6 + s.warm * s.warm * 0.55 + s.cool * s.cool * 0.45;
  }

  // ------------------------------------------------------------ escombros
  _initDebris() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vColor; varying vec3 vN;
        void main() {
          vColor = instanceColor;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying vec3 vN;
        void main() {
          float s = 0.5 + 0.5 * max(dot(vN, normalize(vec3(0.35, 1.0, 0.25))), 0.0);
          gl_FragColor = vec4(vColor * s, 1.0);
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.debrisMesh = mesh;
    const n = MAX_DEBRIS;
    this.dPos = new Float32Array(n * 3); this.dVel = new Float32Array(n * 3);
    this.dRot = new Float32Array(n * 3); this.dAng = new Float32Array(n * 3);
    this.dSize = new Float32Array(n); this.dLife = new Float32Array(n); this.dRest = new Uint8Array(n);
    this.dCol = new Float32Array(n * 3);
    this.dCount = 0;
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  spawnDebris(x, y, z, vx, vy, vz, size, color, life = 2.5) {
    let i = this.dCount;
    if (i >= MAX_DEBRIS) {
      // reciclar el más viejo (menor vida restante)
      let best = 0, bl = Infinity;
      for (let k = 0; k < MAX_DEBRIS; k += 7) if (this.dLife[k] < bl) { bl = this.dLife[k]; best = k; }
      i = best;
    } else this.dCount++;
    const o = i * 3;
    this.dPos[o] = x; this.dPos[o + 1] = y; this.dPos[o + 2] = z;
    this.dVel[o] = vx; this.dVel[o + 1] = vy; this.dVel[o + 2] = vz;
    this.dRot[o] = Math.random() * 6; this.dRot[o + 1] = Math.random() * 6; this.dRot[o + 2] = Math.random() * 6;
    this.dAng[o] = (Math.random() - 0.5) * 18; this.dAng[o + 1] = (Math.random() - 0.5) * 18; this.dAng[o + 2] = (Math.random() - 0.5) * 18;
    this.dSize[i] = size; this.dLife[i] = life * (0.7 + Math.random() * 0.6); this.dRest[i] = 0;
    this.dCol[o] = color[0]; this.dCol[o + 1] = color[1]; this.dCol[o + 2] = color[2];
  }

  /** Vóxeles destruidos → escombros + polvo. dir: dirección del impacto (para lanzar hacia allí). */
  voxelsDestroyed(list, cause, point, dir) {
    if (!list.length) return;
    const w = this.world;
    const maxPieces = cause === 'bullet' ? 10 : 420;
    const step = Math.max(1, Math.floor(list.length / maxPieces));
    const power = cause === 'bullet' ? 2.2 : cause === 'melee' ? 2.5 : 7;
    let dustN = 0;
    for (let k = 0; k < list.length; k += step) {
      const v = list[k];
      const cx = w.wx(v.x) + VS / 2, cy = w.wy(v.y) + VS / 2, cz = w.wz(v.z) + VS / 2;
      const light = this.lightAt(cx, cy, cz);
      const base = Math.random() < 0.5 ? this.matColor[v.mat] : this.edgeColor[v.mat];
      const col = [base[0] * light, base[1] * light, base[2] * light];
      const pieces = cause === 'bullet' ? 2 + Math.floor(Math.random() * 3) : 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let p = 0; p < pieces; p++) {
        let vx = (Math.random() - 0.5) * 2, vy = Math.random() * 1.5 + 0.3, vz = (Math.random() - 0.5) * 2;
        if (dir) { vx += dir.x * power; vy += dir.y * power * 0.5; vz += dir.z * power; }
        else if (point) {
          const dx = cx - point.x, dy = cy - point.y, dz = cz - point.z, l = Math.hypot(dx, dy, dz) + 0.1;
          vx += dx / l * power; vy += dy / l * power * 0.6 + 1; vz += dz / l * power;
        }
        const size = cause === 'bullet' ? 0.012 + Math.random() * 0.02 : 0.018 + Math.random() * 0.05;
        this.spawnDebris(cx + (Math.random() - 0.5) * VS, cy + (Math.random() - 0.5) * VS, cz + (Math.random() - 0.5) * VS, vx, vy, vz, size, col);
      }
      if (MATS[v.mat].glass) continue;
      if (dustN < (cause === 'bullet' ? 2 : 36)) {
        dustN++;
        const dc = this.edgeColor[v.mat];
        const big = cause !== 'bullet';
        const sp = big ? 1.6 : 0.6;
        this.spawnDust(cx, cy, cz, (Math.random() - 0.5) * sp + (dir ? dir.x * 0.6 : 0), Math.random() * 0.4 * sp, (Math.random() - 0.5) * sp + (dir ? dir.z * 0.6 : 0),
          big ? 0.55 + Math.random() * 0.45 : 0.25, [dc[0] * light * 0.8 + 0.02, dc[1] * light * 0.8 + 0.02, dc[2] * light * 0.8 + 0.02], big ? 4 + Math.random() * 3 : 1.2, big ? 0.35 : 0.45);
      }
    }
  }

  _updateDebris(dt) {
    const w = this.world, n = this.dCount;
    const m = this.debrisMesh;
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (this.dLife[i] <= 0) continue;
      const o = i * 3;
      this.dLife[i] -= dt;
      if (!this.dRest[i]) {
        this.dVel[o + 1] -= 16 * dt;
        const nx = this.dPos[o] + this.dVel[o] * dt, ny = this.dPos[o + 1] + this.dVel[o + 1] * dt, nz = this.dPos[o + 2] + this.dVel[o + 2] * dt;
        if (SOLID[w.getWorld(nx, ny, nz)]) {
          // rebote simple: si venía de arriba, al suelo
          if (!SOLID[w.getWorld(nx, this.dPos[o + 1], nz)]) {
            this.dVel[o + 1] *= -0.25; this.dVel[o] *= 0.55; this.dVel[o + 2] *= 0.55;
            if (Math.abs(this.dVel[o + 1]) < 0.6) { this.dRest[i] = 1; this.dPos[o + 1] = Math.floor((this.dPos[o + 1] - w.oy) * 8) / 8 + w.oy + this.dSize[i] * 0.5; }
          } else { this.dVel[o] *= -0.3; this.dVel[o + 2] *= -0.3; }
        } else { this.dPos[o] = nx; this.dPos[o + 1] = ny; this.dPos[o + 2] = nz; }
        this.dRot[o] += this.dAng[o] * dt; this.dRot[o + 1] += this.dAng[o + 1] * dt; this.dRot[o + 2] += this.dAng[o + 2] * dt;
      }
      const shrink = Math.min(1, this.dLife[i] / 0.5);
      this._e.set(this.dRot[o], this.dRot[o + 1], this.dRot[o + 2]);
      this._q.setFromEuler(this._e);
      const s = this.dSize[i] * shrink;
      this._s.set(s, s, s);
      this._v.set(this.dPos[o], this.dPos[o + 1], this.dPos[o + 2]);
      this._m4.compose(this._v, this._q, this._s);
      m.setMatrixAt(live, this._m4);
      m.instanceColor.setXYZ(live, this.dCol[o], this.dCol[o + 1], this.dCol[o + 2]);
      live++;
    }
    // compactar si hay muchos muertos
    if (live < n * 0.5 && n > 64) this._compactDebris();
    m.count = live;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }
  _compactDebris() {
    let j = 0;
    for (let i = 0; i < this.dCount; i++) {
      if (this.dLife[i] <= 0) continue;
      if (i !== j) {
        for (let c = 0; c < 3; c++) {
          this.dPos[j * 3 + c] = this.dPos[i * 3 + c]; this.dVel[j * 3 + c] = this.dVel[i * 3 + c];
          this.dRot[j * 3 + c] = this.dRot[i * 3 + c]; this.dAng[j * 3 + c] = this.dAng[i * 3 + c]; this.dCol[j * 3 + c] = this.dCol[i * 3 + c];
        }
        this.dSize[j] = this.dSize[i]; this.dLife[j] = this.dLife[i]; this.dRest[j] = this.dRest[i];
      }
      j++;
    }
    this.dCount = j;
  }

  // ------------------------------------------------------------ polvo y chispas (puntos)
  _initDust() {
    const n = MAX_DUST;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(n * 3); this.pCol = new Float32Array(n * 4); this.pSize = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float depth = max(0.05, -mv.z);
          float px = aSize * uScale / depth;
          // límite de tamaño y desvanecido cerca de la cámara: evita el sobredibujado a pantalla completa
          vColor.a *= smoothstep(0.25, 1.2, depth) * clamp(220.0 / max(px, 1.0), 0.0, 1.0);
          gl_PointSize = min(px, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          float a = exp(-d * 2.5) * vColor.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
    });
    this.dustPoints = new THREE.Points(g, mat);
    this.dustPoints.frustumCulled = false;
    this.dustPoints.renderOrder = 5;
    this.scene.add(this.dustPoints);
    // chispas: aditivas
    const g2 = new THREE.BufferGeometry();
    this.sPos = new Float32Array(256 * 3); this.sCol = new Float32Array(256 * 4); this.sSize = new Float32Array(256);
    g2.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    g2.setAttribute('aColor', new THREE.BufferAttribute(this.sCol, 4).setUsage(THREE.DynamicDrawUsage));
    g2.setAttribute('aSize', new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat2 = mat.clone();
    mat2.blending = THREE.AdditiveBlending;
    this.sparkPoints = new THREE.Points(g2, mat2);
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 6;
    this.scene.add(this.sparkPoints);
    this.dust = []; this.sparks = [];
  }

  setViewport(heightPx, fovDeg) {
    const k = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
    this.dustPoints.material.uniforms.uScale.value = k;
    this.sparkPoints.material.uniforms.uScale.value = k;
  }

  spawnDust(x, y, z, vx, vy, vz, size, col, life, alpha = 0.5) {
    if (this.dust.length >= MAX_DUST) this.dust.shift();
    this.dust.push({ x, y, z, vx, vy, vz, size, grow: size * 1.4, r: col[0], g: col[1], b: col[2], life, max: life, alpha });
  }
  spawnSpark(x, y, z, vx, vy, vz, hot = 1) {
    if (this.sparks.length >= 256) this.sparks.shift();
    this.sparks.push({ x, y, z, vx, vy, vz, life: 0.18 + Math.random() * 0.25, max: 0.4, hot });
  }

  _updatePoints(dt) {
    let n = 0;
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const p = this.dust[i];
      p.life -= dt;
      if (p.life <= 0) { this.dust.splice(i, 1); continue; }
      p.vx *= 1 - dt * 1.5; p.vy = p.vy * (1 - dt * 1.5) - 0.12 * dt; p.vz *= 1 - dt * 1.5;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size += p.grow * dt * 0.5;
    }
    for (const p of this.dust) {
      const k = p.life / p.max;
      this.pPos[n * 3] = p.x; this.pPos[n * 3 + 1] = p.y; this.pPos[n * 3 + 2] = p.z;
      this.pCol[n * 4] = p.r; this.pCol[n * 4 + 1] = p.g; this.pCol[n * 4 + 2] = p.b; this.pCol[n * 4 + 3] = p.alpha * Math.min(1, k * 2) * Math.min(1, (1 - k) * 8 + 0.2);
      this.pSize[n] = p.size;
      n++;
    }
    const g = this.dustPoints.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    let m = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.vy -= 9 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    }
    for (const s of this.sparks) {
      const k = s.life / s.max;
      this.sPos[m * 3] = s.x; this.sPos[m * 3 + 1] = s.y; this.sPos[m * 3 + 2] = s.z;
      this.sCol[m * 4] = 6 * s.hot; this.sCol[m * 4 + 1] = 3.2 * s.hot; this.sCol[m * 4 + 2] = 1.0 * s.hot; this.sCol[m * 4 + 3] = Math.min(1, k * 3);
      this.sSize[m] = 0.035;
      m++;
    }
    const g2 = this.sparkPoints.geometry;
    g2.setDrawRange(0, m);
    g2.attributes.position.needsUpdate = true; g2.attributes.aColor.needsUpdate = true; g2.attributes.aSize.needsUpdate = true;
  }

  // ------------------------------------------------------------ marcas de impacto
  _initDecals() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.18, 'rgba(10,8,6,0.95)'); grd.addColorStop(0.35, 'rgba(30,26,22,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = 'rgba(15,12,10,0.7)'; c.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, l = 10 + Math.random() * 18;
      c.beginPath(); c.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
      c.lineTo(32 + Math.cos(a + (Math.random() - 0.5) * 0.4) * l, 32 + Math.sin(a + (Math.random() - 0.5) * 0.4) * l); c.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x9a9a9a });
    const geo = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_DECALS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.decalMesh = mesh;
    this.decals = []; // {x,y,z, vx,vy,vz (vóxel soporte)}
    this.decalNext = 0;
  }

  addDecal(x, y, z, nx, ny, nz, size, supportVoxel) {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    if (this.decalMesh.count < MAX_DECALS) this.decalMesh.count = Math.max(this.decalMesh.count, i + 1);
    const T = this._dec || (this._dec = { p: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), n: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), s: new THREE.Vector3() });
    T.p.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    T.q.setFromUnitVectors(T.z, T.n.set(nx, ny, nz));
    T.q.multiply(T.r.setFromAxisAngle(T.z, Math.random() * Math.PI * 2));
    this._m4.compose(T.p, T.q, T.s.set(size, size, size));
    this.decalMesh.setMatrixAt(i, this._m4);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    const d = this.decals[i] || (this.decals[i] = { x: 0, y: 0, z: 0, on: false });
    if (supportVoxel) { d.x = supportVoxel.x; d.y = supportVoxel.y; d.z = supportVoxel.z; d.on = true; } else d.on = false;
  }
  // quitar marcas cuyo soporte ha desaparecido
  _validateDecals() {
    let changed = false;
    for (let i = 0; i < this.decals.length; i++) {
      const s = this.decals[i];
      if (!s || !s.on) continue;
      if (!SOLID[this.world.get(s.x, s.y, s.z)]) {
        this._m4.makeScale(0, 0, 0);
        this.decalMesh.setMatrixAt(i, this._m4);
        s.on = false; changed = true;
      }
    }
    if (changed) this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ sangre
  _initBlood() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 1.6) * 50, r = 2 + rnd() * 14 * (1 - d / 60);
      c.fillStyle = `rgba(${90 + rnd() * 40}, ${8 + rnd() * 8}, ${6 + rnd() * 6}, ${0.55 + rnd() * 0.4})`;
      c.beginPath(); c.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, r * (0.5 + rnd() * 0.5), a, 0, Math.PI * 2); c.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x6a6a6a });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, 80);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.bloodMesh = mesh; this.bloodNext = 0;
  }
  bloodHit(p, dir, head) {
    if (!this.bloodMesh) this._initBlood();
    const light = this.lightAt(p.x, p.y, p.z);
    const n = head ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const sp = 0.6 + Math.random() * 1.6;
      this.spawnDust(p.x, p.y, p.z, (dir ? dir.x * sp : 0) + (Math.random() - 0.5) * 0.8, (Math.random() - 0.2) * 0.8, (dir ? dir.z * sp : 0) + (Math.random() - 0.5) * 0.8,
        0.07 + Math.random() * 0.08, [0.28 * light + 0.02, 0.02 * light, 0.015 * light], 0.35 + Math.random() * 0.3, 0.75);
    }
    // salpicadura en la pared de detrás
    if (!dir) return;
    const hit = raycastFirst(this.world, p.x, p.y, p.z, dir.x, dir.y, dir.z, 2.2, SOLID, true);
    if (!hit) return;
    const N = FACE_N[hit.face];
    if (!N) return;
    const hx = p.x + dir.x * hit.t, hy = p.y + dir.y * hit.t, hz = p.z + dir.z * hit.t;
    const i = this.bloodNext; this.bloodNext = (i + 1) % 80;
    this.bloodMesh.count = Math.max(this.bloodMesh.count, i + 1);
    const T = this._dec || (this._dec = { p: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), n: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), s: new THREE.Vector3() });
    T.p.set(hx + N[0] * 0.005, hy + N[1] * 0.005, hz + N[2] * 0.005);
    T.q.setFromUnitVectors(T.z, T.n.set(N[0], N[1], N[2]));
    T.q.multiply(T.r.setFromAxisAngle(T.z, Math.random() * Math.PI * 2));
    const sz = (head ? 0.5 : 0.35) * (1 - hit.t / 3);
    this._m4.compose(T.p, T.q, T.s.set(sz, sz, sz));
    this.bloodMesh.setMatrixAt(i, this._m4);
    this.bloodMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ trazadoras
  _initTracers() {
    const g = new THREE.BufferGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 4 * 3);
    this.tAlpha = new Float32Array(MAX_TRACERS * 4);
    const idx = [];
    for (let i = 0; i < MAX_TRACERS; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.tAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(5.0, 3.6, 1.8) * vA, vA); }`,
    });
    this.tracerMesh = new THREE.Mesh(g, m);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 7;
    this.scene.add(this.tracerMesh);
    this.tracers = [];
  }
  addTracer(from, to) {
    const t = this.tracers.length >= MAX_TRACERS ? this.tracers.shift() : { a: new THREE.Vector3(), b: new THREE.Vector3() };
    t.a.set(from.x, from.y, from.z); t.b.set(to.x, to.y, to.z); t.life = 0.07; t.max = 0.07;
    this.tracers.push(t);
  }
  _updateTracers(dt, camPos) {
    let n = 0;
    const T = this._trc || (this._trc = { tmp: new THREE.Vector3(), side: new THREE.Vector3(), dir: new THREE.Vector3(), p1: new THREE.Vector3() });
    const tmp = T.tmp, side = T.side, dir = T.dir;
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.life -= dt; if (t.life <= 0) this.tracers.splice(i, 1); }
    for (const t of this.tracers) {
      const k = 1 - t.life / t.max;
      // segmento corto que viaja por la trayectoria
      dir.subVectors(t.b, t.a);
      const len = dir.length();
      dir.normalize();
      const s0 = Math.min(len, len * k * 1.2), s1 = Math.min(len, s0 + Math.min(6, len * 0.35));
      const p0 = tmp.copy(t.a).addScaledVector(dir, s0);
      const p1 = T.p1.copy(t.a).addScaledVector(dir, s1);
      side.subVectors(camPos, p0).cross(dir).normalize().multiplyScalar(0.012);
      const o = n * 12;
      this.tPos.set([p0.x - side.x, p0.y - side.y, p0.z - side.z, p0.x + side.x, p0.y + side.y, p0.z + side.z, p1.x + side.x, p1.y + side.y, p1.z + side.z, p1.x - side.x, p1.y - side.y, p1.z - side.z], o);
      const a = 0.9 * (t.life / t.max);
      this.tAlpha.set([a * 0.2, a * 0.2, a, a], n * 4);
      n++;
    }
    const g = this.tracerMesh.geometry;
    g.setDrawRange(0, n * 6);
    g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
  }

  // ------------------------------------------------------------ luces
  flash(x, y, z, r, g, b, radius, life) { this.lights.push({ x, y, z, r, g, b, radius, life, max: life }); }

  // ------------------------------------------------------------ impacto de bala (desde eventos)
  bulletImpact(res) {
    const w = this.world;
    const d = res.dir;
    // marcas y chispas en el punto de parada (material duro)
    if (res.hit) {
      const s = res.hit;
      const nrm = FACE_N[s.face] || [-d.x, -d.y, -d.z];
      const hx = res.origin.x + d.x * s.t, hy = res.origin.y + d.y * s.t, hz = res.origin.z + d.z * s.t;
      const m = MATS[s.mat];
      this.addDecal(hx, hy, hz, nrm[0], nrm[1], nrm[2], 0.07 + Math.random() * 0.03, { x: s.x, y: s.y, z: s.z });
      const light = this.lightAt(hx + nrm[0] * 0.1, hy + nrm[1] * 0.1, hz + nrm[2] * 0.1);
      const c = this.matColor[s.mat];
      for (let i = 0; i < 3; i++) this.spawnDebris(hx + nrm[0] * 0.02, hy + nrm[1] * 0.02, hz + nrm[2] * 0.02,
        nrm[0] * 2 + (Math.random() - 0.5) * 2, nrm[1] * 2 + Math.random() * 1.5, nrm[2] * 2 + (Math.random() - 0.5) * 2, 0.015 + Math.random() * 0.02, [c[0] * light, c[1] * light, c[2] * light], 1.2);
      this.spawnDust(hx + nrm[0] * 0.05, hy + nrm[1] * 0.05, hz + nrm[2] * 0.05, nrm[0] * 0.5, nrm[1] * 0.5 + 0.1, nrm[2] * 0.5, 0.15, [c[0] * light + 0.05, c[1] * light + 0.05, c[2] * light + 0.05], 0.9, 0.45);
      if (m.snd === 5 || m.snd === 3 || m.snd === 12 || m.snd === 8) {
        const n = m.snd === 5 ? 7 : 3;
        for (let i = 0; i < n; i++) this.spawnSpark(hx + nrm[0] * 0.02, hy + nrm[1] * 0.02, hz + nrm[2] * 0.02, nrm[0] * 3 + (Math.random() - 0.5) * 4, nrm[1] * 3 + Math.random() * 3, nrm[2] * 3 + (Math.random() - 0.5) * 4, m.snd === 5 ? 1 : 0.5);
      }
    }
    // marcas alrededor de los agujeros de entrada en paredes blandas
    let lastEntry = null;
    for (const s of res.segments) {
      if (s.t > res.end) break;
      if (s.action !== 'break' || lastEntry === s.mat) continue;
      lastEntry = s.mat;
      const nrm = FACE_N[s.face];
      if (!nrm) continue;
      const hx = res.origin.x + d.x * s.t, hy = res.origin.y + d.y * s.t, hz = res.origin.z + d.z * s.t;
      // soporte: vóxel vecino en el plano de la pared (si desaparece, la marca también)
      const ax = s.face >> 1;
      const sv = { x: s.x, y: s.y, z: s.z };
      if (ax === 0) sv.y += 1; else sv.x += 1;
      this.addDecal(hx, hy, hz, nrm[0], nrm[1], nrm[2], 0.16 + Math.random() * 0.06, sv);
    }
  }

  clearAll() {
    if (this.bloodMesh) { this.bloodMesh.count = 0; this.bloodNext = 0; }
    this.dCount = 0; this.debrisMesh.count = 0;
    this.dust.length = 0; this.sparks.length = 0; this.tracers.length = 0; this.lights.length = 0;
    this._m4.makeScale(0, 0, 0);
    for (let i = 0; i < this.decalMesh.count; i++) this.decalMesh.setMatrixAt(i, this._m4);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalMesh.count = 0; this.decalNext = 0;
    for (const d of this.decals) if (d) d.on = false;
  }

  update(dt, camPos) {
    this.time += dt;
    this._updateDebris(dt);
    this._updatePoints(dt);
    this._updateTracers(dt, camPos);
    // luces dinámicas
    for (let i = this.lights.length - 1; i >= 0; i--) { const l = this.lights[i]; l.life -= dt; if (l.life <= 0) this.lights.splice(i, 1); }
    const list = this.lights.map((l) => { const k = l.life / l.max; return { x: l.x, y: l.y, z: l.z, r: l.r * k, g: l.g * k, b: l.b * k, radius: l.radius }; });
    this.wr.setDynamicLights(list);
    if ((this._decalCheck = (this._decalCheck || 0) + dt) > 0.3) { this._decalCheck = 0; this._validateDecals(); }
  }
}

const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Arranque y bucle principal de Bloque Cero (Fase 1: campo de pruebas).
import * as THREE from 'three';
import { generateTexturesAsync } from './render/texgen.js';
import { createVillaWorld, buildVilla } from './world/maps/villa.js';
import { WorldRenderer } from './render/worldrenderer.js';
import { Effects } from './render/effects.js';
import { ViewModel } from './render/viewmodel.js';
import { PostFX } from './render/postfx.js';
import { AudioEngine } from './audio/audio.js';
import { Input } from './input/input.js';
import { HUD } from './ui/hud.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { Game, TICK } from './sim/game.js';
import { Operator } from './sim/operator.js';
import { raycastFirst } from './world/raycast.js';
import { breachRect, explodeSphere } from './world/destruction.js';
import { MATS, SOLID, SOUND } from './world/materials.js';
import { lineOfSight } from './world/raycast.js';
import { DEG, damp, clamp } from './core/math.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const state = {
  mode: 'loading',   // loading | menu | play
  paused: false,
};

async function boot() {
  const setStep = async (txt, p) => { $('loadstep').textContent = txt; $('loadbar').style.width = `${Math.round(p * 100)}%`; await nextFrame(); };
  const fail = (msg) => { const e = $('loaderr'); e.textContent = msg; e.classList.remove('hidden'); };
  const settings = loadSettings();

  // ---------------------------------------------------------------- renderer
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  } catch (e) {
    fail('Este navegador no puede crear un contexto WebGL2. Prueba con Chrome, Edge o Firefox actualizados y la aceleración por hardware activada.');
    return;
  }
  if (!renderer.capabilities.isWebGL2) { fail('Hace falta WebGL2.'); return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  // calidad adaptativa: si los FPS reales caen por debajo de 55, se baja la resolución interna
  let adaptiveScale = 1, adaptiveLevel = 0;
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, settings.quality === 'alta' ? 1.5 : settings.quality === 'media' ? 1 : 0.75) * adaptiveScale;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  await setStep('Generando materiales…', 0.02);
  const tex = await generateTexturesAsync((p) => { $('loadbar').style.width = `${Math.round(2 + p * 40)}%`; });
  await setStep('Construyendo la villa…', 0.44);
  const world = createVillaWorld();
  const map = buildVilla(world);
  await setStep('Calculando la luz…', 0.52);
  const scene = new THREE.Scene();
  const wr = new WorldRenderer(renderer, scene, world, map, tex, { shadowSize: settings.quality === 'baja' ? 2048 : 4096 });
  await setStep('Mallando la geometría…', 0.66);
  wr.buildAll();
  await setStep('Compilando sombreadores…', 0.86);
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.03, 1200);
  camera.rotation.order = 'YXZ';
  const effects = new Effects(scene, world, wr);
  const vm = new ViewModel();
  vm.initEnvironment(renderer);
  const post = new PostFX(renderer, scene, camera, vm.scene, vm.camera, settings.quality, wr.prepassMat);
  post.setQuality(settings.quality);
  const audio = new AudioEngine();
  audio.setVolume(settings.volume);
  const input = new Input(canvas);
  const hud = new HUD();
  wr.renderShadowIfNeeded(true);
  // precompilar (primer frame fuera de pantalla)
  camera.position.set(15, 1.7, -8); camera.lookAt(15, 2, 5);
  renderer.compile(scene, camera);
  // precalentar el compilador JIT (trazado de balas, destrucción, remallado) para que
  // el primer disparo real no dé un tirón; después se restaura el mapa.
  {
    const warm = new Game({ world, map, seed: 1 });
    const wop = new Operator('calentamiento', { x: 9.2, y: 0, z: 1.6, yaw: -Math.PI / 2, loadout: ['ar', 'shotgun'] });
    for (let i = 0; i < 40; i++) {
      wop.yaw = -Math.PI / 2 + Math.sin(i) * 0.15; wop.pitch = Math.cos(i * 1.7) * 0.15;
      const r = warm.fireBullet(wop, wop.eyePos(), wop.viewDir(), wop.weapons[i % 2]);
      effects.bulletImpact(r);
      if (r.destroyed.length) effects.voxelsDestroyed(r.destroyed, 'bullet', null, r.dir);
      wr.update(0.016, camera.position, 50);
    }
    breachRect(world, 3, 1.1, 13, 2, 1.2, 2.3, 0.6);
    world.resetToPristine();
    wr.update(0.016, camera.position, 1e9);
    while (wr.lightVolume.job) wr.lightVolume.stepJob(1e9);
    effects.clearAll();
  }
  await setStep('Listo', 1);

  // ---------------------------------------------------------------- simulación
  const game = new Game({ world, map, seed: 20260923 });
  const spawn = { x: 15.5, y: 0, z: -4.5, yaw: Math.PI };
  const player = game.addOperator(new Operator('jugador', { name: 'Tú', x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, loadout: ['ar', 'pistol', 'shotgun'] }));
  let stanceWanted = 'stand';
  let leanWanted = 0;
  const prevEye = player.eyePos(), curEye = player.eyePos();
  let acc = 0;

  // ---------------------------------------------------------------- eventos → audio/efectos
  const tmpV = new THREE.Vector3();
  const muzzleWorld = (op) => {
    const e = op.eyePos(); const f = op.viewDir();
    const rx = Math.cos(op.yaw), rz = -Math.sin(op.yaw);
    const hip = 1 - op.ads;
    return { x: e.x + f.x * 0.55 + rx * 0.12 * hip, y: e.y + f.y * 0.55 - 0.1 * hip - 0.03, z: e.z + f.z * 0.55 + rz * 0.12 * hip };
  };
  let shake = 0;
  game.on('shot', (op, w, eye, fwd, results) => {
    const local = op === player;
    audio.gunshot(w.def.sound, eye, local);
    const m = muzzleWorld(op);
    effects.flash(m.x, m.y, m.z, 9, 5.4, 2.4, 5.5, 0.06);
    if (local) { vm.onShot(); shake = Math.min(1, shake + (w.def.pellets > 1 ? 0.8 : 0.25)); }
    for (const r of results) {
      const end = { x: r.origin.x + r.dir.x * r.end, y: r.origin.y + r.dir.y * r.end, z: r.origin.z + r.dir.z * r.end };
      if (Math.random() < (w.def.pellets > 1 ? 0.35 : 0.5)) effects.addTracer(m, end);
    }
  });
  game.on('bullet', (op, res) => {
    effects.bulletImpact(res);
    if (res.hit) {
      const p = { x: res.origin.x + res.dir.x * res.end, y: res.origin.y + res.dir.y * res.end, z: res.origin.z + res.dir.z * res.end };
      audio.impact(MATS[res.hit.mat].snd, p, occlusion(p));
    }
    if (res.destroyed.length) {
      const v = res.destroyed[0];
      const p = { x: world.wx(v.x), y: world.wy(v.y), z: world.wz(v.z) };
      audio.breakMaterial(MATS[v.mat].snd, p, res.destroyed.length, occlusion(p));
    }
  });
  game.on('voxels', (list, cause, point, dir) => effects.voxelsDestroyed(list, cause, point, dir));
  game.on('footstep', (op, snd, loud) => {
    const p = op.body.pos;
    audio.footstep(snd, { x: p.x, y: p.y + 0.05, z: p.z }, loud, op === player, op === player ? 0 : occlusion(p));
  });
  game.on('reload', (op, w) => {
    if (op !== player) return;
    const T = w.reloadTotal;
    const empty = w.ammo === 0;
    setTimeout(() => audio.weaponFoley('magout'), T * 250);
    setTimeout(() => audio.weaponFoley('magin'), T * 580);
    if (empty) setTimeout(() => audio.weaponFoley('bolt'), T * 830);
  });
  game.on('dryfire', (op) => { if (op === player) audio.weaponFoley('dry'); });
  game.on('switch', (op) => { if (op === player) audio.weaponFoley('switch'); });
  game.on('land', (op, v) => { if (op === player) { audio.weaponFoley('land'); vm.onLand(v); } });
  game.on('vault', (op) => { if (op === player) audio.weaponFoley('vault'); });

  function occlusion(p) {
    const e = curEye;
    return lineOfSight(world, e.x, e.y, e.z, p.x, p.y + 0.2, p.z) ? 0 : 0.7;
  }

  // Carga de brecha de prueba (G): boquete en la pared a la que miras.
  function testBreach() {
    const e = player.eyePos(), d = player.viewDir();
    const hit = raycastFirst(world, e.x, e.y, e.z, d.x, d.y, d.z, 5, SOLID, true);
    if (!hit) { hud.toast('Nada a tu alcance'); return; }
    const px = e.x + d.x * hit.t, py = e.y + d.y * hit.t, pz = e.z + d.z * hit.t;
    const axis = hit.face >> 1;
    let list;
    if (axis === 1) list = explodeSphere(world, px, py, pz, 0.9);
    else list = breachRect(world, axis === 0 ? px + d.x * 0.12 : px, Math.max(py, 1.15 + Math.floor(py / 3.5) * 3.5), axis === 2 ? pz + d.z * 0.12 : pz, axis, 1.1, 2.3, 0.6);
    if (!list.length) { hud.toast('Esa superficie no cede'); audio.impact(MATS[hit.mat].snd, { x: px, y: py, z: pz }); return; }
    effects.voxelsDestroyed(list, 'blast', { x: px - d.x * 0.3, y: py, z: pz - d.z * 0.3 }, null);
    effects.flash(px - d.x * 0.3, py, pz - d.z * 0.3, 40, 26, 12, 9, 0.25);
    for (let i = 0; i < 30; i++) effects.spawnSpark(px, py, pz, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9, 1);
    audio.gunshot('shotgun', { x: px, y: py, z: pz }, false);
    audio.breakMaterial(MATS[list[0].mat].snd, { x: px, y: py, z: pz }, list.length);
    shake = 1.2;
    hud.toast('Boquete abierto');
  }

  // ---------------------------------------------------------------- menú y ajustes
  const bindRange = (id, out, key, fmt, apply) => {
    const el = $(id), o = $(out);
    el.value = settings[key];
    o.textContent = fmt(settings[key]);
    el.addEventListener('input', () => { settings[key] = parseFloat(el.value); o.textContent = fmt(settings[key]); apply && apply(); saveSettings(settings); });
  };
  bindRange('set-sens', 'out-sens', 'sensitivity', (v) => v.toFixed(2));
  bindRange('set-adssens', 'out-adssens', 'adsSensitivity', (v) => v.toFixed(2));
  bindRange('set-fov', 'out-fov', 'fov', (v) => `${v}°`, () => { camera.fov = settings.fov; camera.updateProjectionMatrix(); });
  bindRange('set-vol', 'out-vol', 'volume', (v) => `${Math.round(v * 100)}`, () => audio.setVolume(settings.volume));
  const bindCheck = (id, key, apply) => { const el = $(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; apply && apply(); saveSettings(settings); }); };
  bindCheck('set-lean', 'leanToggle');
  bindCheck('set-crouch', 'crouchToggle');
  bindCheck('set-invert', 'invertY');
  bindCheck('set-perf', 'showPerf');
  const q = $('set-quality');
  q.value = settings.quality;
  q.addEventListener('change', () => { settings.quality = q.value; saveSettings(settings); post.setQuality(settings.quality); renderer.setPixelRatio(pixelRatio()); resize(); });

  function startPlay() {
    audio.init();
    audio.ui('confirm');
    state.mode = 'play';
    $('menu').classList.add('hidden');
    hud.show(true);
    input.requestLock();
    canvas.focus();
  }
  $('btn-play').addEventListener('click', startPlay);
  input.onLockChange = (locked, err) => {
    if (state.mode !== 'play') return;
    state.paused = !locked && !err;
    hud.pause(!locked);
  };
  $('pausehint').addEventListener('click', () => { input.requestLock(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && state.mode === 'play' && !input.locked) {
      // segundo Esc: volver al menú
      state.mode = 'menu'; hud.show(false); hud.pause(false); $('menu').classList.remove('hidden');
    }
  });

  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  state.mode = 'menu';

  // ---------------------------------------------------------------- tamaño
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vm.setAspect(w / h);
    post.setSize(w, h);
    effects.setViewport(h * renderer.getPixelRatio(), camera.fov);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- bucle
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0, fps = 0, cpuMs = 0;
  let exposure = 1.0;
  const lightS = { sky: 1, warm: 0, cool: 0 };
  let menuT = 0;
  const perfStats = { frameMs: [] };

  function applyInput(dt) {
    const I = player.intent;
    if (state.mode !== 'play' || state.paused) {
      I.moveX = 0; I.moveZ = 0; I.fire = false; I.ads = false; I.sprint = false;
      input.consumeMouse();
      return { dx: 0, dy: 0 };
    }
    I.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    I.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    I.sprint = input.isDown('sprint');
    // postura
    if (settings.crouchToggle) { if (input.pressed('crouch')) stanceWanted = stanceWanted === 'crouch' ? 'stand' : 'crouch'; }
    else stanceWanted = input.isDown('crouch') ? 'crouch' : (stanceWanted === 'crouch' ? 'stand' : stanceWanted);
    if (input.pressed('prone')) stanceWanted = stanceWanted === 'prone' ? 'stand' : 'prone';
    if (I.sprint && I.moveZ > 0 && stanceWanted !== 'prone') stanceWanted = 'stand';
    I.stance = stanceWanted;
    // asomarse
    if (settings.leanToggle) {
      if (input.pressed('leanLeft')) leanWanted = leanWanted === -1 ? 0 : -1;
      if (input.pressed('leanRight')) leanWanted = leanWanted === 1 ? 0 : 1;
      if (I.sprint && I.moveZ > 0) leanWanted = 0;
    } else leanWanted = (input.isDown('leanRight') ? 1 : 0) - (input.isDown('leanLeft') ? 1 : 0);
    I.lean = leanWanted;
    I.fire = input.mouse.left;
    I.ads = input.mouse.right;
    if (input.pressed('reload')) I.reload = true;
    if (input.pressed('vault')) I.vault = true;
    if (input.pressed('primary')) I.switchTo = 0;
    if (input.pressed('secondary')) I.switchTo = 1;
    if (input.down.has('Digit3') && input.pressedQ.has('Digit3')) { input.pressedQ.delete('Digit3'); I.switchTo = 2; }
    const m = input.consumeMouse();
    if (m.wheel) I.switchTo = (player.weaponIndex + (m.wheel > 0 ? 1 : player.weapons.length - 1)) % player.weapons.length;
    if (input.pressed('gadget')) testBreach();
    if (input.pressed('perf')) { settings.showPerf = !settings.showPerf; $('set-perf').checked = settings.showPerf; saveSettings(settings); }
    // mirar con el ratón (inmediato, fuera del tick fijo)
    const base = 0.0022 * settings.sensitivity * (1 - player.ads * (1 - settings.adsSensitivity / Math.max(1, player.weapon.def.adsZoom)));
    player.yaw -= m.dx * base;
    player.pitch = clamp(player.pitch - m.dy * base * (settings.invertY ? -1 : 1), -1.5, 1.5);
    return m;
  }

  let lowFor = 0, highFor = 0;
  function adaptQuality(f) {
    // ventanas de 0,5 s: tras 2 s por debajo de 55 FPS se baja un escalón; tras 8 s por
    // encima de 90 se recupera uno (sin pasar de lo elegido en Ajustes)
    if (f < 55) { lowFor += 0.5; highFor = 0; } else if (f > 90) { highFor += 0.5; lowFor = 0; } else { lowFor = 0; highFor = 0; }
    if (lowFor >= 2 && adaptiveLevel < 4) {
      adaptiveLevel++; lowFor = 0;
      adaptiveScale = [1, 0.85, 0.72, 0.72, 0.6][adaptiveLevel];
      post.setAdaptiveLevel(adaptiveLevel, settings.quality); renderer.setPixelRatio(pixelRatio()); resize();
    } else if (highFor >= 8 && adaptiveLevel > 0) {
      adaptiveLevel--; highFor = 0;
      adaptiveScale = [1, 0.85, 0.72, 0.72, 0.6][adaptiveLevel];
      post.setAdaptiveLevel(adaptiveLevel, settings.quality); renderer.setPixelRatio(pixelRatio()); resize();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    renderer.info.reset();
    const mouse = applyInput(dt);
    if (state.mode === 'play' && !state.paused) {
      acc += dt;
      let n = 0;
      while (acc >= TICK && n < 6) {
        prevEye.x = curEye.x; prevEye.y = curEye.y; prevEye.z = curEye.z;
        game.tick(TICK);
        player.eyePos(curEye);
        acc -= TICK; n++;
      }
      if (n >= 6) acc = 0;
    }
    input.endFrame();
    // cámara
    if (state.mode === 'play') {
      const a = acc / TICK;
      camera.position.set(prevEye.x + (curEye.x - prevEye.x) * a, prevEye.y + (curEye.y - prevEye.y) * a, prevEye.z + (curEye.z - prevEye.z) * a);
      shake = damp(shake, 0, 10, dt);
      const sx = (Math.random() - 0.5) * shake * 0.004, sy = (Math.random() - 0.5) * shake * 0.004;
      camera.rotation.set(player.pitch + sy, player.yaw + sx, player.roll);
      const zoom = 1 + (player.weapon.def.adsZoom - 1) * player.ads;
      const fov = 2 * Math.atan(Math.tan(settings.fov * DEG / 2) / zoom) / DEG;
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    } else {
      // vuelo lento alrededor de la villa en el menú
      menuT += dt * 0.05;
      const r = 34;
      camera.position.set(20 + Math.cos(menuT) * r, 9 + Math.sin(menuT * 0.7) * 2, 13 + Math.sin(menuT) * r);
      camera.lookAt(18, 2, 13);
    }
    // exposición automática según la luz ambiente del lugar
    wr.lightVolume.sample(camera.position.x, camera.position.y, camera.position.z, lightS);
    const lum = 0.05 + lightS.sky * lightS.sky * 0.95 + lightS.warm * lightS.warm * 0.62 + lightS.cool * lightS.cool * 0.5;
    const target = clamp(0.6 / lum, 0.55, 1.9);
    exposure = damp(exposure, target, 1.6, dt);
    renderer.toneMappingExposure = exposure;
    if (audio.ctx) {
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation), up = new THREE.Vector3(0, 1, 0).applyEuler(camera.rotation);
      audio.setListener(camera.position, fwd, up);
      audio.setIndoor(lightS.sky < 0.85 ? 1 : 0);
    }
    wr.update(dt, camera.position, 6);
    wr.renderShadowIfNeeded();
    effects.update(dt, camera.position);
    vm.update(dt, player, lightS, mouse.dx || 0, mouse.dy || 0);
    vm.root.visible = state.mode === 'play';
    post.render(dt);
    // HUD
    if (state.mode === 'play') {
      const loc = map.locationAt(camera.position.x, player.body.pos.y + 0.2, camera.position.z);
      const spreadPx = Math.tan(player.currentSpread() * DEG) / Math.tan(camera.fov * DEG / 2) * (window.innerHeight / 2);
      hud.update(dt, player, { location: loc, spreadPx, prompt: '' });
    }
    // rendimiento
    cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
      if (state.mode === 'play' && !state.paused && !document.hidden) adaptQuality(fps);
    }
    perfStats.frameMs.push(performance.now() - t0);
    if (perfStats.frameMs.length > 600) perfStats.frameMs.shift();
    if (settings.showPerf) {
      const inf = renderer.info.render;
      const st = wr.stats;
      hud.perf(`${fps.toFixed(0)} FPS · CPU ${cpuMs.toFixed(1)} ms · ${inf.calls} llamadas · ${(inf.triangles / 1000).toFixed(0)}k triángulos · mallado ${st.lastMeshMs.toFixed(1)} ms · luz ${st.lastLightMs.toFixed(1)} ms · escala ${(renderer.getPixelRatio()).toFixed(2)} · exp ${exposure.toFixed(2)}`);
    } else hud.perf(null);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- depuración / tests automáticos
  window.__bc = {
    THREE, game, player, world, map, wr, effects, renderer, camera, settings, state, hud, audio, post,
    start: startPlay,
    perf: () => ({ fps, cpuMs, adaptiveLevel, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, regions: wr.drawCalls(), frameMs: perfStats.frameMs.slice() }),
    place(x, y, z, yaw, pitch = 0) { player.body.pos.x = x; player.body.pos.y = y; player.body.pos.z = z; player.yaw = yaw; player.pitch = pitch; player.body.vel.x = player.body.vel.y = player.body.vel.z = 0; player.eyePos(prevEye); player.eyePos(curEye); },
    fire(n = 1) { for (let i = 0; i < n; i++) { const w = player.weapon; w.cooldown = 0; player._shoot(game, w); } },
    breach: testBreach,
    // coste de cada pasada de render con gl.finish (para perfilar sin temporizadores de GPU)
    passTimes(reps = 3) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      const time = (fn) => { sync(); let best = Infinity; for (let i = 0; i < reps; i++) { const t0 = performance.now(); fn(); sync(); best = Math.min(best, performance.now() - t0); } return best; };
      const r = {};
      renderer.setRenderTarget(null);
      r.mundoConPrepasada = time(() => post.worldPass.render(renderer, null, null));
      const vis = vm.root.visible; vm.root.visible = true;
      r.arma = time(() => { renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = true; });
      vm.root.visible = vis;
      const b = post.bloom.enabled;
      r.composicionCompleta = time(() => post.render(0));
      post.bloom.enabled = false; r.composicionSinBloom = time(() => post.render(0)); post.bloom.enabled = b;
      wr.shadowDirty = true; r.sombra4096 = time(() => wr.renderShadowIfNeeded(true));
      const sm = wr.solidMat; const tmp = new THREE.MeshBasicMaterial({ color: 0x888888 });
      scene.overrideMaterial = tmp; r.mundoShaderTrivial = time(() => renderer.render(scene, camera)); scene.overrideMaterial = null; tmp.dispose();
      void sm;
      // experimentos: qué parte del shader pesa
      const aniso = wr.albedoTex.anisotropy;
      wr.albedoTex.anisotropy = 1; wr.normalTex.anisotropy = 1; wr.albedoTex.needsUpdate = true; wr.normalTex.needsUpdate = true;
      renderer.render(scene, camera);
      r.sinAnisotropia = time(() => post.worldPass.render(renderer, null, null));
      wr.albedoTex.anisotropy = aniso; wr.normalTex.anisotropy = aniso; wr.albedoTex.needsUpdate = true; wr.normalTex.needsUpdate = true;
      const lt = wr.uniforms.uLight.value;
      const tiny = new THREE.Data3DTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1); tiny.needsUpdate = true;
      wr.uniforms.uLight.value = tiny; renderer.render(scene, camera);
      r.luz1x1 = time(() => post.worldPass.render(renderer, null, null));
      wr.uniforms.uLight.value = lt;
      const cam2 = camera.clone(); cam2.far = 6; cam2.updateProjectionMatrix();
      const saveCam = post.worldPass.camera; post.worldPass.camera = cam2;
      r.soloCerca6m = time(() => post.worldPass.render(renderer, null, null));
      post.worldPass.camera = saveCam;
      return r;
    },
    intent: player.intent,
  };
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('loaderr');
  if (el) { el.textContent = `Error al cargar: ${e.message}`; el.classList.remove('hidden'); }
});

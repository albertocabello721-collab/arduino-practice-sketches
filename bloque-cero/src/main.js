// Arranque y bucle principal de Bloque Cero. El motor (render, audio, entrada, HUD)
// es único; las sesiones (campo de pruebas, partida 5v5) deciden qué se simula y
// qué operador se ve.
import * as THREE from 'three';
import { generateTexturesAsync } from './render/texgen.js';
import { createVillaWorld, buildVilla } from './world/maps/villa.js';
import { WorldRenderer } from './render/worldrenderer.js';
import { Effects } from './render/effects.js';
import { Lasers } from './render/lasers.js';
import { Ropes } from './render/ropes.js';
import { ViewModel } from './render/viewmodel.js';
import { PostFX } from './render/postfx.js';
import { AudioEngine } from './audio/audio.js';
import { Hearing } from './client/hearing.js';
import { Input } from './input/input.js';
import { HUD } from './ui/hud.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { Game, TICK } from './sim/game.js';
import { Operator } from './sim/operator.js';
import { breachRect } from './world/destruction.js';
import { DEG, damp, clamp, angleDiff } from './core/math.js';
import { CharacterRenderer } from './render/character.js';
import { PropRenderer } from './render/props.js';
import { RangeSession } from './client/range.js';
import { MatchSession } from './client/matchsession.js';
import { navFor } from './sim/bots.js';
import { DebugView } from './render/debugview.js';
import { thermalOn, scopeZoom, THERMAL_SCOPE } from './sim/abilities.js';
import { FEEL, lowHealth } from './client/feel.js';
import { Speech } from './client/voice.js';
import { timeOf } from './render/timeofday.js';
import { DustMotes } from './render/dust.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const MENU_MUSIC = { mode: 'menu', k: 0 }, NO_MUSIC = { mode: '', k: 0 };   // música fuera de la partida (F12.3)

const state = {
  mode: 'loading',   // loading | menu | play
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
  // rejilla de navegación de los bots (una vez; los bots la comparten y se actualiza con la destrucción)
  await setStep('Calculando rutas…', 0.48);
  const nav = navFor(world, map);
  await setStep('Calculando la luz…', 0.52);
  const scene = new THREE.Scene();
  const wr = new WorldRenderer(renderer, scene, world, map, tex, { shadowSize: settings.quality === 'baja' ? 2048 : 4096 });
  await setStep('Mallando la geometría…', 0.66);
  wr.buildAll();
  await setStep('Compilando sombreadores…', 0.86);
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.03, 1200);
  camera.rotation.order = 'YXZ';
  const effects = new Effects(scene, world, wr);
  const lasers = new Lasers(scene);   // haces de los láseres (F10.3)
  const ropes = new Ropes(scene);     // cuerdas del rappel (F10.2a)
  const dust = new DustMotes(scene);  // polvo en la luz, dentro de la casa (F12.5)
  const chars = new CharacterRenderer(scene, wr.uniforms, world);
  const props = new PropRenderer(scene, wr);
  const vm = new ViewModel();
  vm.initEnvironment(renderer);
  const post = new PostFX(renderer, scene, camera, vm.scene, vm.camera, settings.quality, wr.prepassMat);
  post.setQuality(settings.quality);
  const audio = new AudioEngine();
  audio.setVolume(settings.volume);
  audio.setVolumes({ sfx: settings.sfxVolume, music: settings.musicVolume, voice: settings.voiceVolume });
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
  wr.setTimeOfDay(settings.timeOfDay);   // la hora elegida (F12.5), ya en el fondo del menú
  await setStep('Listo', 1);

  // ---------------------------------------------------------------- contexto compartido
  const prevEye = { x: 0, y: 0, z: 0 }, curEye = { x: 0, y: 0, z: 0 };
  const view = { op: null, prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 };
  let acc = 0;
  let session = null;
  let lockFailed = false;
  let lowLast = 0;          // (poca vida: el último nivel que se pasó al latido)
  const ctx = {
    THREE, renderer, scene, camera, world, map, nav, wr, effects, lasers, ropes, chars, props, vm, post, audio, input, hud, settings, canvas,
    shake: 0, damageFlash: 0, camEye: camera.position, hear: null, paused: false,
    // al recibir un balazo (F12.1): la sacudida de la vista (rad, solo en el dibujo) y de dónde vino
    kick: { pitch: 0, yaw: 0, roll: 0 }, dmgDir: { x: 0, y: 1, k: 0 },
    hearing: new Hearing(world, camera.position),   // por dónde llega cada sonido a la cámara (F9)
    voice: new Speech(settings),                     // el locutor y tu operador (F12.2)
    // la cámara salta al operador visto sin interpolar (cambio de vista, reaparición)
    resetView() { view.op = null; },
    place(x, y, z, yaw, pitch = 0) {
      const p = session && session.player;
      if (!p) return;
      p.body.pos.x = x; p.body.pos.y = y; p.body.pos.z = z; p.yaw = yaw; p.pitch = pitch;
      p.body.vel.x = p.body.vel.y = p.body.vel.z = 0;
      view.op = null;
    },
    app: null,
  };

  const debugView = new DebugView(ctx);

  function setSession(make) {
    // desechar la sesión anterior ANTES de crear la nueva (comparten el DOM del HUD)
    if (session) session.dispose();
    session = null;
    const s = make ? make() : null;
    session = s;
    acc = 0;
    view.op = null;
    ctx.damageFlash = 0; ctx.shake = 0;
    ctx.kick.pitch = ctx.kick.yaw = ctx.kick.roll = 0; ctx.dmgDir.k = 0;
    hud.setDeath(false); hud.setDowned(false); hud.setRevive(null, 0);
  }
  // el audio arranca con el primer clic (los navegadores no dejan antes): así ya suena la música del menú
  window.addEventListener('pointerdown', () => audio.init(), { once: true });
  function enterPlay() {
    audio.init();
    state.mode = 'play';
    $('menu').classList.add('hidden');
    hud.show(true);
    canvas.focus();
  }
  const app = ctx.app = {
    startRange() {
      audio.init(); audio.ui('confirm');
      wr.setTimeOfDay(settings.timeOfDay);
      setSession(null);
      enterPlay();
      setSession(() => new RangeSession(ctx));
      input.requestLock();
    },
    startMatch(opts = {}) {
      audio.init(); audio.ui('confirm');
      const sideSel = opts.startSide || settings.startSide || 'random';
      const startSide = sideSel === 'random' ? (Math.random() < 0.5 ? 'atk' : 'def') : sideSel;
      wr.setTimeOfDay(opts.timeOfDay || settings.timeOfDay);
      setSession(null);
      enterPlay();
      setSession(() => new MatchSession(ctx, { startSide, difficulty: opts.difficulty || settings.difficulty, seed: opts.seed, rules: opts.rules }));
    },
    toMenu() {
      setSession(null);
      debugView.toggle(false);
      state.mode = 'menu';
      hud.show(false); hud.pause(false);
      input.exitLock();
      $('menu').classList.remove('hidden');
    },
  };

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
  // efectos, música y voz, cada uno aparte (F12.3)
  const volumes = () => audio.setVolumes({ sfx: settings.sfxVolume, music: settings.musicVolume, voice: settings.voiceVolume });
  bindRange('set-vol-sfx', 'out-vol-sfx', 'sfxVolume', (v) => `${Math.round(v * 100)}`, volumes);
  bindRange('set-vol-music', 'out-vol-music', 'musicVolume', (v) => `${Math.round(v * 100)}`, volumes);
  bindRange('set-vol-voice', 'out-vol-voice', 'voiceVolume', (v) => `${Math.round(v * 100)}`, volumes);
  const bindCheck = (id, key, apply) => { const el = $(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; apply && apply(); saveSettings(settings); }); };
  bindCheck('set-lean', 'leanToggle');
  bindCheck('set-crouch', 'crouchToggle');
  bindCheck('set-invert', 'invertY');
  bindCheck('set-perf', 'showPerf');
  bindCheck('set-voice', 'allyVoice', () => { if (!settings.allyVoice) { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* sin voz */ } } });
  bindCheck('set-announcer', 'announcer', () => { if (!settings.announcer) ctx.voice.cancel(); });
  bindCheck('set-opvoice', 'opVoice', () => { if (!settings.opVoice) ctx.voice.cancel(); });
  const bindSelect = (id, key, apply) => { const el = $(id); el.value = settings[key]; el.addEventListener('change', () => { settings[key] = el.value; apply && apply(); saveSettings(settings); }); };
  bindSelect('set-quality', 'quality', () => { post.setQuality(settings.quality); renderer.setPixelRatio(pixelRatio()); resize(); });
  bindSelect('qm-side', 'startSide');
  bindSelect('qm-diff', 'difficulty');
  bindSelect('qm-time', 'timeOfDay', () => wr.setTimeOfDay(settings.timeOfDay));

  $('btn-play').addEventListener('click', () => app.startRange());
  $('btn-match').addEventListener('click', () => app.startMatch());
  input.onLockChange = (locked, err) => {
    if (err) lockFailed = true;
    if (locked) lockFailed = false;
  };
  $('pausehint').addEventListener('click', () => { input.requestLock(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && state.mode === 'play' && !input.locked && session && session.wantsPointer) {
      // segundo Esc (con el ratón ya liberado): volver al menú
      app.toMenu();
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
  const lightS = { sky: 1, warm: 0, cool: 0 }, lightV = { sky: 1, warm: 0, cool: 0 };   // (lightV: la del arma, con el cielo de la hora)
  let menuT = 0;
  const perfStats = { frameMs: [] };
  const fwdV = new THREE.Vector3(), upV = new THREE.Vector3();

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

  // Sigue al operador visto: posición de los ojos (y giro, si no lo controla el ratón) por tick.
  function trackView(v, snap) {
    if (!v) { view.op = null; return; }
    if (snap || view.op !== v) {
      v.eyePos(curEye); prevEye.x = curEye.x; prevEye.y = curEye.y; prevEye.z = curEye.z;
      view.prevYaw = view.curYaw = v.yaw; view.prevPitch = view.curPitch = v.pitch;
      view.op = v;
      return;
    }
    prevEye.x = curEye.x; prevEye.y = curEye.y; prevEye.z = curEye.z;
    v.eyePos(curEye);
    view.prevYaw = view.curYaw; view.prevPitch = view.curPitch;
    view.curYaw = v.yaw; view.curPitch = v.pitch;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    renderer.info.reset();
    ctx.hearing.frame();
    const s = state.mode === 'play' ? session : null;
    const paused = !!s && s.wantsPointer && !input.locked && !lockFailed;
    ctx.paused = paused;
    // cámara lenta de la última baja (F12.4): el tiempo de juego va más despacio unos instantes (la
    // simulación da los mismos pasos, solo que más espaciados); la interfaz y el post-proceso, no
    const ts = s && s.slowmo ? s.slowmo.step(paused ? 0 : dt) : 1, gdt = dt * ts;
    ctx.timeScale = ts;
    hud.pause(paused);
    let mouse = { dx: 0, dy: 0 };
    if (s) {
      mouse = s.input(!paused);
      if (!paused) s.onKey();
      if (!paused) {
        acc += gdt;
        let n = 0;
        while (acc >= TICK && n < 6) {
          s.tick(TICK);
          trackView(s.viewOp, false);
          acc -= TICK; n++;
        }
        if (n >= 6) acc = 0;
      }
      if (input.pressed('perf')) { settings.showPerf = !settings.showPerf; $('set-perf').checked = settings.showPerf; saveSettings(settings); }
      if (input.pressed('debug')) debugView.toggle();
    } else input.consumeMouse();
    input.endFrame();
    // ---------------- cámara
    const v = s ? s.viewOp : null;
    if (v) {
      if (view.op !== v) trackView(v, true);
      const a = acc / TICK;
      camera.position.set(prevEye.x + (curEye.x - prevEye.x) * a, prevEye.y + (curEye.y - prevEye.y) * a, prevEye.z + (curEye.z - prevEye.z) * a);
      ctx.shake = damp(ctx.shake, 0, 10, dt);
      const sx = (Math.random() - 0.5) * ctx.shake * 0.004, sy = (Math.random() - 0.5) * ctx.shake * 0.004;
      const controlled = v === s.player;
      const yaw = controlled ? v.yaw : view.prevYaw + angleDiff(view.prevYaw, view.curYaw) * a;
      const pitch = controlled ? v.pitch : view.prevPitch + (view.curPitch - view.prevPitch) * a;
      // (la sacudida de un balazo vuelve sola en ~0,2 s; no mueve la puntería)
      const K = ctx.kick, kd = 1 - Math.exp(-dt / (FEEL.kickBack / 3));
      K.pitch -= K.pitch * kd; K.yaw -= K.yaw * kd; K.roll -= K.roll * kd;
      camera.rotation.set(pitch + sy + K.pitch, yaw + sx + K.yaw, v.roll + K.roll);
      const zoom = 1 + (scopeZoom(v) - 1) * v.ads;
      const fov = 2 * Math.atan(Math.tan(settings.fov * DEG / 2) / zoom) / DEG;
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    } else {
      view.op = null;
      const vc = s ? s.viewCam : null;
      const fc = vc ? vc.pose(acc / TICK) : null;
      if (fc) {
        camera.position.set(fc.x, fc.y, fc.z);
        camera.rotation.set(fc.pitch, fc.yaw, fc.roll || 0);
        const f = fc.fov || settings.fov;
        if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
      } else {
        // vuelo lento alrededor de la villa (menú, selección de operador)
        menuT += dt * 0.05;
        const r = 34;
        camera.position.set(20 + Math.cos(menuT) * r, 9 + Math.sin(menuT * 0.7) * 2, 13 + Math.sin(menuT) * r);
        camera.lookAt(18, 2, 13);
        if (Math.abs(camera.fov - settings.fov) > 0.01) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
      }
    }
    // señal de dron o cámara: lente, grano e interferencia en el post-proceso
    {
      const vc = !v && s ? s.viewCam : null;
      const pose = vc && vc.pose ? vc.pose(acc / TICK) : null;
      post.grade.uniforms.uFeed.value = pose ? pose.feed || 0 : 0;
      post.grade.uniforms.uStatic.value = pose ? pose.staticK || 0 : 0;
    }
    // exposición automática según la luz ambiente del lugar
    wr.lightVolume.sample(camera.position.x, camera.position.y, camera.position.z, lightS);
    // (a otra hora el cielo alumbra menos: F12.5)
    const tod = timeOf(wr.tod);
    const lum = 0.05 + lightS.sky * lightS.sky * 0.95 * tod.skyLight + lightS.warm * lightS.warm * 0.62 + lightS.cool * lightS.cool * 0.5;
    lightV.sky = lightS.sky * Math.sqrt(tod.skyLight); lightV.warm = lightS.warm; lightV.cool = lightS.cool;
    const indoorK = clamp((0.85 - lightS.sky) / 0.45, 0, 1);   // 0 en la calle … 1 dentro de la casa
    const target = clamp(0.6 / lum, 0.55, 1.9) * tod.exposure;
    exposure = damp(exposure, target, 1.6, dt);
    renderer.toneMappingExposure = exposure;
    if (audio.ctx) {
      fwdV.set(0, 0, -1).applyEuler(camera.rotation); upV.set(0, 1, 0).applyEuler(camera.rotation);
      audio.setListener(camera.position, fwdV, upV);
      audio.setIndoor(lightS.sky < 0.85 ? 1 : 0);
      // ambiente (viento fuera, zumbido dentro) y música (F12.3): la del menú o la que pida la partida
      audio.ambience(lightS.sky, indoorK, camera.position, wr.tod);
      const mus = state.mode === 'menu' ? MENU_MUSIC : s && s.music ? s.music : NO_MUSIC;
      audio.music(mus.mode, mus.k);
    }
    wr.update(dt, camera.position, 6);
    wr.renderShadowIfNeeded();
    effects.update(gdt, camera.position);
    dust.update(paused ? 0 : gdt, camera.position, indoorK, wr.lightVolume, tod.skyLight);
    // visor térmico de LUMEN (apuntando con la principal y quieto): enemigos calientes, humo transparente
    const thermal = !!v && thermalOn(v);
    chars.setHeat(thermal, v ? v.team : 0, THERMAL_SCOPE.range, camera.position);
    effects.setThermal(thermal);
    chars.update(paused ? 0 : gdt, v, camera.position);      // (en pausa, los que caen se quedan quietos)
    // los láseres encendidos (en la repetición de muerte, ninguno: serían los de ahora)
    const LG = s && s.game;
    lasers.update(LG ? LG.operators : [], world, LG ? LG.time : 0, v, camera, !!(s && s.replay && s.replay.active));
    ropes.update(LG ? LG.operators : [], camera, !!(s && s.replay && s.replay.active));
    if (debugView.on) { camera.updateMatrixWorld(); debugView.update(dt, s, camera); }
    if (!s) props.clear();
    ctx.damageFlash = Math.max(0, ctx.damageFlash - dt * 1.4);
    post.grade.uniforms.uDamage.value = v ? Math.max(ctx.damageFlash, v.state === 'downed' ? 0.55 + Math.sin(performance.now() / 300) * 0.1 : 0, v.state === 'alive' && v.hp < v.maxHp * 0.3 ? 0.25 : 0) : 0;
    // de dónde vino el último balazo: ese borde, más rojo (F12.1)
    ctx.dmgDir.k = v ? Math.max(0, ctx.dmgDir.k - dt * 1.6) : 0;
    post.grade.uniforms.uDmgDir.value.set(ctx.dmgDir.x, ctx.dmgDir.y, ctx.dmgDir.k);
    // poca vida (menos de 30): colores apagados y latido (F12.1)
    const low = v && !paused ? lowHealth(v) : 0;
    post.grade.uniforms.uSat.value = 0.95 - FEEL.lowSat * low;
    if (Math.abs(low - lowLast) > 0.02 || (low > 0) !== (lowLast > 0)) { audio.lowHealth(low); lowLast = low; }
    // humo alrededor de la cámara y cegadora del operador visto
    const G = s && s.game ? s.game.gadgets : null;
    post.grade.uniforms.uSmoke.value = G && !thermal ? G.smokeAt(camera.position) : 0;
    post.grade.uniforms.uGas.value = G && G.gasAt && !thermal ? G.gasAt(camera.position) : 0;
    post.grade.uniforms.uBlind.value = v && v.blindT > 0 ? Math.min(1, v.blindT / 1.2) : 0;
    if (s) s.frame(gdt, acc / TICK);
    // (en la repetición de muerte, el arma del que te mató)
    const rv = !v && s && s.replayView ? s.replayView : null;
    if (v) vm.update(gdt, v, lightV, v === s.player ? mouse.dx || 0 : 0, v === s.player ? mouse.dy || 0 : 0);
    else if (rv) vm.update(paused ? 0 : gdt, rv, lightV, 0, 0);
    vm.setShown((!!v && v.state !== 'dead') || !!rv);
    post.render(dt);
    // HUD del operador visto
    hud.playerHud(!!v);
    if (v) {
      const loc = map.locationAt(camera.position.x, v.body.pos.y + 0.2, camera.position.z);
      const spreadPx = Math.tan(v.currentSpread() * DEG) / Math.tan(camera.fov * DEG / 2) * (window.innerHeight / 2);
      hud.update(dt, v, { location: loc, spreadPx, prompt: s.promptText || '' });
    } else hud.tick(dt);
    // rendimiento
    cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
      if (s && !paused && !document.hidden) adaptQuality(fps);
    }
    perfStats.frameMs.push(performance.now() - t0);
    if (perfStats.frameMs.length > 600) perfStats.frameMs.shift();
    if (settings.showPerf || debugView.on) {
      const inf = renderer.info.render;
      const st = wr.stats;
      hud.perf(`${fps.toFixed(0)} FPS · CPU ${cpuMs.toFixed(1)} ms · ${inf.calls} llamadas · ${(inf.triangles / 1000).toFixed(0)}k triángulos · mallado ${st.lastMeshMs.toFixed(1)} ms · luz ${st.lastLightMs.toFixed(1)} ms · escala ${(renderer.getPixelRatio()).toFixed(2)} · exp ${exposure.toFixed(2)}`);
    } else hud.perf(null);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- depuración / tests automáticos
  window.__bc = {
    THREE, world, map, wr, effects, dust, renderer, camera, settings, state, hud, audio, post, ctx, debug: debugView,
    get session() { return session; },
    get game() { return session ? session.game : null; },
    get player() { return session ? session.player : null; },
    get match() { return session && session.match ? session.match : null; },
    get intent() { return session && session.player ? session.player.intent : null; },
    start: () => app.startRange(),
    startMatch: (opts) => app.startMatch(opts),
    toMenu: () => app.toMenu(),
    perf: () => ({ fps, cpuMs, adaptiveLevel, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, regions: wr.drawCalls(), frameMs: perfStats.frameMs.slice() }),
    place: (x, y, z, yaw, pitch = 0) => ctx.place(x, y, z, yaw, pitch),
    fire(n = 1) { const p = session && session.player; if (!p) return; for (let i = 0; i < n; i++) { const w = p.weapon; w.cooldown = 0; p._shoot(session.game, w); } },
    breach() { if (session && session.testBreach) session.testBreach(); },
    // coste de cada pasada de render sincronizando con readPixels (sin temporizadores de GPU)
    passTimes(reps = 3) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      const time = (fn) => { sync(); let best = Infinity; for (let i = 0; i < reps; i++) { const t1 = performance.now(); fn(); sync(); best = Math.min(best, performance.now() - t1); } return best; };
      const r = {};
      renderer.setRenderTarget(null);
      r.mundoConPrepasada = time(() => post.worldPass.render(renderer, null, null));
      const vis = vm.view.visible; vm.setShown(true);
      r.arma = time(() => { renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = true; });
      vm.setShown(vis);
      const b = post.bloom.enabled;
      r.composicionCompleta = time(() => post.render(0));
      post.bloom.enabled = false; r.composicionSinBloom = time(() => post.render(0)); post.bloom.enabled = b;
      wr.shadowDirty = true; r.sombra4096 = time(() => wr.renderShadowIfNeeded(true));
      return r;
    },
  };
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('loaderr');
  if (el) { el.textContent = `Error al cargar: ${e.message}`; el.classList.remove('hidden'); }
});

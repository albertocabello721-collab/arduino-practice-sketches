// Vistas remotas del jugador: pilotar un dron (ataque) o mirar las cámaras de
// seguridad (defensa). Enruta la entrada, da la pose de la cámara al bucle y
// pinta el marco de la señal. El cuerpo del jugador se queda quieto mientras tanto.
import { clamp } from '../core/math.js';
import { DRONE } from '../sim/recon.js';

const $ = (id) => document.getElementById(id);

export class FeedController {
  constructor(ctx, getRecon, getPlayer = () => null) {
    this.ctx = ctx;
    this.getRecon = getRecon;
    this.getPlayer = getPlayer;     // quien mira las cámaras (se le apuntan las marcas)
    this.mode = 'body';       // 'body' | 'drone' | 'cams'
    this.drone = null;
    this.cam = null;
    this.piloting = false;    // ¿el jugador controla el dron (o solo lo mira)?
    this.lostT = 0;           // interferencia tras perder la señal
    this.onLost = null;       // qué hacer cuando termina la interferencia
    this.label = '';
    this.el = { root: $('feedui'), title: $('fd-title'), sub: $('fd-sub'), status: $('fd-status'), keys: $('fd-keys'), lost: $('fd-lost') };
    this.cache = {};
  }
  get active() { return this.mode !== 'body'; }

  enterDrone(d, piloting = true) {
    if (this.drone && this.drone !== d) this.drone.pilot = null;
    this.mode = 'drone'; this.drone = d; this.cam = null; this.piloting = piloting; this.lostT = 0;
    if (piloting) d.pilot = 'jugador';
    this.ctx.audio.ping('static');
    this.ctx.resetView();
  }
  enterCam(c) {
    this.mode = 'cams'; this.cam = c; this.drone && (this.drone.pilot = null); this.drone = null; this.lostT = 0;
    this.ctx.audio.ping('static');
    this.ctx.resetView();
  }
  exit() {
    if (this.drone) this.drone.pilot = null;
    this.mode = 'body'; this.drone = null; this.cam = null; this.lostT = 0; this.onLost = null;
    this.ctx.resetView();
    this.show(false);
  }
  // Señal perdida: interferencia durante `secs` y luego `then()`.
  lose(secs, then) {
    this.lostT = secs; this.onLost = then;
    this.ctx.audio.ping('static');
  }
  cycleCam(dir) {
    const recon = this.getRecon();
    const cams = recon ? recon.aliveCams() : [];
    if (!cams.length) return false;
    const i = this.cam ? cams.indexOf(this.cam) : -1;
    this.enterCam(cams[(i + dir + cams.length) % cams.length]);
    return true;
  }

  /** Entrada del frame en modo remoto. Devuelve el movimiento del ratón. */
  input(active, myTeam) {
    const { input, settings } = this.ctx;
    const m = input.consumeMouse();
    if (!active) return m;
    const sens = 0.0022 * settings.sensitivity;
    const inv = settings.invertY ? -1 : 1;
    if (this.mode === 'drone' && this.drone && this.drone.alive && this.piloting && this.lostT <= 0) {
      const d = this.drone, I = d.intent;
      I.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      I.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      if (input.pressed('vault')) I.jump = true;
      if (input.mouseClicked(0)) I.mark = true;
      d.yaw -= m.dx * sens;
      d.pitch = clamp(d.pitch - m.dy * sens * inv, -0.75, 0.6);
    } else if (this.mode === 'cams' && this.cam && this.lostT <= 0) {
      this.cam.look(-m.dx * sens * 0.8, -m.dy * sens * inv * 0.8);
      if (input.pressed('left')) this.cycleCam(-1);
      if (input.pressed('right')) this.cycleCam(1);
      if (input.mouseClicked(0)) { const r = this.getRecon(); if (r) r.mark(this.cam, myTeam, this.getPlayer()); }
    }
    return m;
  }

  /** Pose de cámara para el bucle (interpolada con el tick). */
  pose(alpha) {
    if (this.mode === 'drone' && this.drone) {
      const d = this.drone, p = d.body.pos, q = d.prev;
      return {
        x: q.x + (p.x - q.x) * alpha, y: q.y + (p.y - q.y) * alpha + DRONE.eye, z: q.z + (p.z - q.z) * alpha,
        yaw: d.yaw, pitch: d.pitch, roll: 0, fov: 88, feed: 1, staticK: this.lostT > 0 ? 1 : 0,
      };
    }
    if (this.mode === 'cams' && this.cam) {
      const c = this.cam;
      return { x: c.pos.x, y: c.pos.y - 0.05, z: c.pos.z, yaw: c.yaw, pitch: c.pitch, roll: 0, fov: 84, feed: 2, staticK: (this.lostT > 0 || !c.alive) ? 1 : 0 };
    }
    return null;
  }

  frame(dt, info = {}) {
    if (this.lostT > 0) {
      this.lostT -= dt;
      if (this.lostT <= 0) { const f = this.onLost; this.onLost = null; this.lostT = 0; if (f) f(); }
    }
    if (!this.active) { this.show(false); return; }
    this.show(true);
    const cams = this.mode === 'cams';
    this.el.root.classList.toggle('cam', cams);
    let title = '', sub = '', status = '', keys = '';
    if (this.mode === 'drone' && this.drone) {
      title = this.piloting ? 'Dron' : `Dron de ${this.drone.owner.name}`;
      sub = `<i class="rec"></i>${info.dronesLeft !== undefined ? `En directo · ${info.dronesLeft} de reserva` : 'En directo'}`;
      keys = this.piloting ? `WASD mover · Espacio saltar · Clic marcar${info.canExit ? ' · 5 volver' : ''}` : 'Clic para cambiar de dron';
    } else if (cams && this.cam) {
      const recon = this.getRecon();
      const list = recon ? recon.cams : [];
      title = `Cámara ${list.indexOf(this.cam) + 1} · ${this.cam.name}`;
      sub = '<i class="rec"></i>Seguridad';
      keys = 'A/D cambiar de cámara · Clic marcar · 5 volver';
    }
    if (info.objective !== undefined) status = info.objective;
    this._set('t', this.el.title, title, true);
    this._set('s', this.el.sub, sub, true);
    this._set('k', this.el.keys, keys, true);
    this._set('st', this.el.status, status, true);
    this.el.status.classList.toggle('ok', !!info.objectiveOk);
    const lost = this.lostT > 0 || (cams && this.cam && !this.cam.alive);
    this.el.lost.classList.toggle('hidden', !lost);
  }
  _set(k, el, v, html) { if (this.cache[k] === v) return; this.cache[k] = v; if (html) el.innerHTML = v; else el.textContent = v; }
  show(v) { if (this.cache.show !== v) { this.cache.show = v; this.el.root.classList.toggle('hidden', !v); } }
}

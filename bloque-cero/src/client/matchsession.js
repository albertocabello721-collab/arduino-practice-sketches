// Partida rápida 5v5 contra bots: selección de operador, preparación (refuerzos,
// barricadas, drones y cámaras), acción, desactivador, fin de ronda y de partida.
// El jugador ocupa la ranura 0 del equipo 0 (azul); el rival es naranja.
import { Session } from './session.js';
import { bindGameFx } from './fx.js';
import { FeedController } from './feeds.js';
import { Match } from '../sim/match.js';
import { BotSquad } from '../sim/bots.js';
import { operatorLook } from '../render/character.js';
import { MatchUI } from '../ui/matchui.js';
import { BONE } from '../sim/skeleton.js';

const DEATH_CAM = 3.0;   // segundos mirando tu propio cuerpo antes de observar a un compañero

export class MatchSession extends Session {
  constructor(ctx, opts = {}) {
    super(ctx);
    this.opts = { startSide: opts.startSide || 'atk', difficulty: opts.difficulty || 'normal' };
    const { world, map, hud } = ctx;
    this.match = new Match({ world, map, seed: opts.seed ?? ((Date.now() ^ 0x5eed) & 0x7fffffff), human: true, startSide: this.opts.startSide, rules: opts.rules || {} });
    this.bots = new BotSquad(this.match, this.opts.difficulty, { nav: ctx.nav });
    this.disposers.push(() => this.bots.dispose());
    this.ui = new MatchUI(ctx, this);
    this.feed = new FeedController(ctx, () => this.match.recon, () => this.match.player);
    this.deadAt = -1;
    this.spectating = null;
    this.beepT = 0;
    this.lastTick = -1;
    this.promptText = '';
    this.disposers.push(bindGameFx(ctx, this.match.game, {
      viewer: () => this.viewOp,
      me: () => this.match.player,
      onMeDowned: () => { this.control.stance = 'prone'; this.feed.exit(); },
      onMeRevived: () => { this.control.stance = 'crouch'; },
      onMeKilled: () => { this.deadAt = this.match.time; this.feed.exit(); hud.setDeath(true, 'Observarás a tus compañeros'); },
    }));
    this._bindMatch();
    hud.setMode('match');
    hud.setDeath(false); hud.setDowned(false);
    this.match.start();
  }

  get player() { return this.match.player; }
  get game() { return this.match.game; }
  get myTeam() { return 0; }
  get meSlot() { return this.match.humanSlot; }
  mySide() { return this.match.sideOf(0); }
  get wantsPointer() { return this.match.running; }
  set wantsPointer(v) { /* derivado de la fase */ }

  get viewOp() {
    const m = this.match;
    if (!m.running || this.feed.active) return null;
    const p = m.player;
    if (!p) return null;
    if (p.state !== 'dead') return p;
    if (m.time - this.deadAt < DEATH_CAM) return null;          // cámara de muerte (libre)
    if (!this.spectating || this.spectating.state === 'dead') this.spectating = this._nextMate(null);
    return this.spectating || null;
  }
  // Cámara cuando no se ve por los ojos de un operador: dron, cámaras o cámara de muerte.
  get viewCam() {
    const m = this.match;
    if (!m.running) return null;
    if (this.feed.active) return this.feed;
    const p = this.player;
    if (!p || p.state !== 'dead') return null;
    const b = p.body.pos;
    const pose = { x: b.x + Math.sin(p.yaw) * 1.2, y: b.y + 2.1, z: b.z + Math.cos(p.yaw) * 1.2, yaw: p.yaw, pitch: -0.95, roll: 0, fov: this.ctx.settings.fov, feed: 0, staticK: 0 };
    return { pose: () => pose };
  }

  _nextMate(cur) {
    const mates = this.game.operators.filter((o) => o.team === 0 && o.state !== 'dead' && o !== this.player);
    if (!mates.length) return null;
    const i = cur ? mates.indexOf(cur) : -1;
    return mates[(i + 1) % mates.length];
  }
  _nextTeamDrone(cur) {
    const list = this.match.recon.drones.filter((d) => d.alive && d.team === 0);
    if (!list.length) return null;
    const i = cur ? list.indexOf(cur) : -1;
    return list[(i + 1) % list.length];
  }

  // ------------------------------------------------------------------ eventos de la partida
  _bindMatch() {
    const m = this.match, { audio, hud, chars, effects, input, props } = this.ctx;
    const on = (t, f) => this.disposers.push(m.on(t, f));
    const onGame = (t, f) => this.disposers.push(m.game.on(t, f));
    on('roundSelect', () => {
      effects.clearAll();
      chars.clear();
      props.clear();
      audio.stopDowned();
      this.feed.exit();
      hud.setDeath(false); hud.setDowned(false); hud.setRevive(null, 0);
      this.ui.hideBanner();
      this.ui.setPrepInfo(null);
      this.deadAt = -1; this.spectating = null;
      this.control.reset('stand');
      input.exitLock();
      hud.show(false);
      this.ui.clearPhase();
      this.ui.showSelect(m);
    });
    on('selectChanged', () => this.ui.updateSelect(m, true));
    on('roundStart', () => {
      this.ui.hideSelect();
      hud.show(true);
      for (const op of m.game.operators) chars.add(op, operatorLook(op.opDef, op.team));
      this.bots.reset();
      this.ui.buildTop(m);
      this.ctx.resetView();
      audio.cue('prep');
      const side = this.mySide();
      this.ui.showPhase('Fase de preparación', side === 'def' ? `Defiendes ${m.site.name}` : 'Localiza el objetivo con tu dron', 3);
      this.ui.setPrepInfo(side === 'atk'
        ? '<b>Preparación</b> · Pilota tu dron: <kbd>WASD</kbd> mover, <kbd>Espacio</kbd> saltar, <kbd>Clic</kbd> marcar enemigos. Busca el objetivo: los drones caben por huecos bajos. Llevas el desactivador.'
        : `<b>Preparación</b> · Defendéis <b>${m.site.name}</b>. Mira una pared blanda y mantén <kbd>F</kbd> para reforzarla (2 refuerzos) o un hueco para poner una barricada. <kbd>5</kbd> cámaras · dispara a los drones.`);
    });
    on('action', () => {
      audio.cue('action');
      if (this.feed.mode === 'drone') this.feed.exit();
      this.ui.setPrepInfo(null);
      const found = m.objectiveFound;
      this.ui.showPhase('¡Acción!', this.mySide() === 'atk' ? (found ? `Objetivo: ${m.site.name}` : 'Objetivo sin localizar · 5 para lanzar un dron') : 'Que no planten', 2.4);
    });
    on('plantStart', (op) => { if (op === this.player) audio.cue('plantStart'); });
    on('planted', (op, site) => {
      audio.cue('planted');
      this.ui.showPhase('Desactivador plantado', `Sitio ${site} · ${this.mySide() === 'atk' ? 'defiéndelo 45 s' : 'inutilízalo antes de 45 s'}`, 3);
    });
    on('disableStart', (op) => { if (op === this.player) audio.cue('plantStart'); });
    on('defuserDropped', () => { if (this.mySide() === 'atk') this.ui.showPhase('Desactivador en el suelo', 'Pulsa F junto a él para recogerlo', 2.2); });
    on('defuserDestroyed', (by) => { this.ui.showPhase('Desactivador destruido', by ? `Por ${by.name}` : '', 2.2); });
    on('defuserPicked', (op) => { if (op === this.player) this.ui.showPhase('Tienes el desactivador', 'Plántalo en A o B', 2); });
    on('roundEnd', (res) => {
      this.feed.exit();
      this.ui.clearPhase();
      this.ui.showBanner(res, m);
      audio.cue(res.winner === 0 ? 'win' : 'lose');
      audio.stopDowned();
      hud.setDeath(false);
      this.ui.setPrepInfo(null);
    });
    on('matchEnd', (e) => {
      this.ui.hideBanner();
      hud.show(false);
      input.exitLock();
      audio.cue(e.winner === 0 ? 'matchWin' : 'matchLose');
      this.ui.showMatchEnd(m, e);
    });
    onGame('objectiveFound', () => {
      if (this.mySide() !== 'atk') return;
      audio.ping('objective');
      this.ui.showPhase('Objetivo localizado', m.site.name, 2.6);
    });
    // si te hieren mientras miras un dron o una cámara, vuelves a tu cuerpo
    onGame('damaged', (t) => { if (t === this.player && this.feed.active && m.phase !== 'prep') this.feed.exit(); });
  }

  // ------------------------------------------------------------------ selección (desde la interfaz)
  pickOperator(id) { if (this.match.choose(this.meSlot, { opId: id })) this.ui.updateSelect(this.match, true); }
  pickWeapon(kind, i) { this.match.choose(this.meSlot, kind === 'primary' ? { primary: i } : { secondary: i }); this.ui.updateSelect(this.match, true); }
  pickChoice(i) {
    if (this.mySide() === 'def') this.match.choose(this.meSlot, { location: i });
    else this.match.choose(this.meSlot, { spawn: i });
    this.ui.updateSelect(this.match, true);
  }
  ready() {
    const me = this.meSlot;
    if (this.match.phase !== 'select' || !me || !me.opId) return;
    this.ctx.audio.init();
    this.ctx.audio.ui('confirm');
    this.match.setReady(me, true);
    this.ui.updateSelect(this.match, true);
    this.ctx.input.requestLock();   // el clic en «Listo» es el gesto que permite capturar el ratón
  }
  rematch() { this.ctx.app.startMatch(this.opts); }
  toMenu() { this.ctx.app.toMenu(); }

  // ------------------------------------------------------------------ entrada y simulación
  input(active) {
    const p = this.player;
    if (this.feed.active) {
      if (p && p.state === 'alive') { const I = p.intent; I.moveX = 0; I.moveZ = 0; I.fire = false; I.ads = false; I.sprint = false; I.interact = false; I.lean = 0; }
      return this.feed.input(active, this.myTeam);
    }
    return super.input(active);
  }

  tick(dt) {
    this.bots.update(dt);
    this.match.tick(dt);
  }

  onKey() {
    const { input, audio, hud } = this.ctx;
    const m = this.match, p = this.player;
    // observar: clic o espacio para cambiar de compañero (o de dron en la preparación)
    if (p && p.state === 'dead' && m.running && m.time - this.deadAt >= DEATH_CAM && !this.feed.active) {
      if (input.mouseClicked(0) || input.pressed('vault')) { this.spectating = this._nextMate(this.spectating); this.ctx.resetView(); }
    }
    if (this.feed.mode === 'drone' && !this.feed.piloting && input.mouseClicked(0)) {
      const d = this._nextTeamDrone(this.feed.drone);
      if (d) this.feed.enterDrone(d, false);
    }
    // 5: dron (ataque) o cámaras (defensa)
    if (input.pressed('drone') && p && p.state === 'alive' && (m.phase === 'prep' || m.phase === 'action' || m.phase === 'planted')) {
      if (this.feed.active) {
        if (m.phase !== 'prep' || this.mySide() === 'def') this.feed.exit();
      } else if (this.mySide() === 'atk') {
        if (m.phase === 'prep') return;
        let d = m.recon.droneOf(p);
        if (!d) d = m.recon.deployDrone(p, { thrown: true });
        if (d) this.feed.enterDrone(d, true);
        else { audio.ping('deny'); hud.toast('No te quedan drones'); }
      } else if (!this.feed.cycleCam(0)) { audio.ping('deny'); hud.toast('Cámaras destruidas'); }
    }
  }

  // Mantiene coherente la vista remota con el estado de la ronda.
  _feedRules() {
    const m = this.match, p = this.player, F = this.feed;
    if (!p || !m.running) return;
    const side = this.mySide();
    if (m.phase === 'prep' && side === 'atk' && p.state === 'alive') {
      if (F.lostT > 0) return;
      if (F.mode !== 'drone' || !F.drone) {
        const mine = m.recon.droneOf(p);
        if (mine) F.enterDrone(mine, true);
        else { const other = this._nextTeamDrone(null); if (other) F.enterDrone(other, false); }
        return;
      }
      if (!F.drone.alive) {
        F.lose(1.2, () => { const other = this._nextTeamDrone(null); if (other) this.feed.enterDrone(other, false); else this.feed.lose(1.5, null); });
      }
      return;
    }
    if (F.mode === 'drone' && F.drone && !F.drone.alive && F.lostT <= 0) F.lose(1.0, () => this.feed.exit());
    if (F.mode === 'cams' && F.cam && !F.cam.alive && F.lostT <= 0) F.lose(0.8, () => { if (!this.feed.cycleCam(1)) this.feed.exit(); });
  }

  frame(dt, alpha = 1) {
    const m = this.match, { hud, input, audio } = this.ctx;
    this.ui.tick(dt);
    if (m.phase === 'select') { this.ui.updateSelect(m); return; }
    if (!m.running) { this.ui.updateMarkers([]); this.ui.showScoreboard(m, false); this.feed.frame(dt); return; }
    this._feedRules();
    this.ui.updateTop(m, dt);
    hud.hints(!this.feed.active && (m.phase === 'prep' || (m.phase === 'action' && m.round === 1 && m.timeLeft > m.rules.actionTime - 12)));
    this.ui.showScoreboard(m, input.isDown('scoreboard'));
    const view = this.viewOp;
    const p = this.player;
    const side = this.mySide();
    // objetos 3D (drones, cámaras, refuerzos, desactivador) y motores de dron
    const def = m.defuser;
    if (def && def.planted) def.urgency = 1 - m.timeLeft / m.rules.fuseTime;
    this.syncProps(dt, alpha, { recon: m.recon, fort: m.fort, defuser: def, feed: this.feed, myTeam: 0 });
    // vista remota
    const found = m.objectiveFound;
    this.feed.frame(dt, {
      dronesLeft: side === 'atk' && p ? m.recon.dronesLeft(p) : undefined,
      canExit: m.phase !== 'prep',
      objective: side === 'atk' ? (found ? `Objetivo localizado · ${m.site.name}` : 'Objetivo sin localizar') : '',
      objectiveOk: found,
    });
    // estado del operador visto y avisos (reanimar, plantar, inutilizar, fortificar)
    this.statusHud(view);
    let prompt = '';
    if (p && p === view && p.state === 'alive') {
      if (p.channel && (p.channel.kind === 'plant' || p.channel.kind === 'disable')) hud.setRevive(p.channel.kind === 'plant' ? 'Plantando el desactivador' : 'Inutilizando el desactivador', p.channel.t / p.channel.total);
      else if (!p.reviving && !this.game.findRevivable(p)) {
        if (def && def.carrier === p && m.phase === 'action') {
          const s = m.siteAt(p.body.pos.x, p.body.pos.y, p.body.pos.z);
          if (s) prompt = `Mantén F para plantar el desactivador · sitio ${s}`;
        } else if (def && !def.carrier && def.pos && p.side === 'atk' && m.phase === 'action' &&
          Math.hypot(p.body.pos.x - def.pos.x, p.body.pos.z - def.pos.z) < m.rules.pickupRange && Math.abs(p.body.pos.y - def.pos.y) < 1.2) {
          prompt = 'Pulsa F para recoger el desactivador';
        } else if (def && def.planted && p.side === 'def' && m.phase === 'planted') {
          const P = def.plantPos;
          if (Math.hypot(p.body.pos.x - P.x, p.body.pos.z - P.z) < m.rules.disableRange && Math.abs(p.body.pos.y - P.y) < 1.2) prompt = 'Mantén F para inutilizar el desactivador';
        }
        if (!prompt && side === 'def') prompt = this.fortifyHud(m.fort, p);
      }
    }
    this.promptText = prompt;
    this.ui.setCarry(!!(p && def && def.carrier === p && p.state !== 'dead'));
    this._gear(p, side);
    // observar
    if (p && p.state === 'dead' && view && view !== p) this.ui.setSpectate(`Observando a <b>${view.name}</b> · clic para cambiar`);
    else this.ui.setSpectate(null);
    if (p && p.state === 'dead' && m.time - this.deadAt >= DEATH_CAM) hud.setDeath(false);
    // marcadores
    this.ui.updateMarkers(this._markers(view));
    // pitidos del desactivador y cuenta atrás
    if (m.phase === 'planted') {
      const k = 1 - m.timeLeft / m.rules.fuseTime;
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 1.0 - k * 0.8;
        const P = def.plantPos;
        audio.defuserBeep({ x: P.x, y: P.y + 0.2, z: P.z }, k, this.ctx.occlusion ? this.ctx.occlusion(P) : 0);
      }
    }
    if (m.phase === 'action' && m.timeLeft <= 10) {
      const s = Math.ceil(m.timeLeft);
      if (s !== this.lastTick) { this.lastTick = s; audio.cue('tick'); }
    }
  }

  _gear(p, side) {
    const el = document.getElementById('gear');
    if (!p || p.state === 'dead' || this.feed.active) { if (this._gearHtml !== '') { this._gearHtml = ''; el.classList.add('hidden'); } return; }
    const m = this.match;
    const html = side === 'atk'
      ? `<span>Drones <b>${m.recon.dronesLeft(p)}</b></span><span>5 dron · V golpe</span>`
      : `<span>Refuerzos <b>${m.fort.remaining(p)}</b></span><span>5 cámaras · V golpe</span>`;
    if (this._gearHtml !== html) { this._gearHtml = html; el.innerHTML = html; el.classList.remove('hidden'); }
  }

  _markers(view) {
    const m = this.match, list = [];
    const cam = this.ctx.camera.position;
    const dist = (q) => `${Math.round(Math.hypot(q.x - cam.x, q.y - cam.y, q.z - cam.z))} m`;
    const side = this.mySide();
    const d = m.defuser;
    // sitios: la defensa siempre; el ataque cuando ha localizado el objetivo
    if (m.site && !(d && d.planted) && (side === 'def' || m.objectiveFound)) {
      for (const k of ['A', 'B']) {
        const b = m.site.bombs[k];
        list.push({ x: b.x, y: b.y + 1.4, z: b.z, cls: side === 'def' ? 'def' : '', icon: k, label: dist(b) });
      }
    }
    if (d && d.planted) { const P = d.plantPos; list.push({ x: P.x, y: P.y + 0.9, z: P.z, cls: 'def', icon: '!', label: `Desactivador · ${dist(P)}` }); }
    if (d && !d.planted && d.pos && side === 'atk') list.push({ x: d.pos.x, y: d.pos.y + 0.6, z: d.pos.z, cls: 'drop', icon: '◆', label: `Desactivador · ${dist(d.pos)}` });
    for (const op of this.game.operators) {
      if (op.state === 'dead') continue;
      const h = op.rig[BONE.head] ? op.rig[BONE.head].p : op.body.pos;
      if (op.team === 0) {
        if (op === view) continue;
        const far = Math.hypot(h.x - cam.x, h.z - cam.z) > 22;
        list.push({ x: h.x, y: h.y + 0.45, z: h.z, cls: 'mate' + (op.state === 'downed' ? ' down' : ''), icon: '', label: far && op.state !== 'downed' ? '' : op.name });
      } else if (m.recon.isSpottedFor(op, 0)) {
        list.push({ x: h.x, y: h.y + 0.5, z: h.z, cls: 'spot', icon: '', label: op.name });
      }
    }
    return list;
  }

  dispose() {
    super.dispose();
    this.feed.exit();
    this.ui.dispose();
    this.ctx.chars.clear();
    this.ctx.props.clear();
    this.ctx.audio.stopDowned();
    this.ctx.hud.setRevive(null, 0);
    document.getElementById('gear').classList.add('hidden');
  }
}

// Partida rápida 5v5 contra bots: selección de operador, preparación, acción,
// desactivador, fin de ronda y fin de partida. El jugador ocupa la ranura 0 del
// equipo 0 (azul); el rival es naranja.
import { Session } from './session.js';
import { bindGameFx } from './fx.js';
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
    this.bots = new BotSquad(this.match, this.opts.difficulty);
    this.disposers.push(() => this.bots.dispose());
    this.ui = new MatchUI(ctx, this);
    this.deadAt = -1;
    this.spectating = null;
    this.beepT = 0;
    this.lastTick = -1;
    this.disposers.push(bindGameFx(ctx, this.match.game, {
      viewer: () => this.viewOp,
      me: () => this.match.player,
      onMeDowned: () => { this.control.stance = 'prone'; },
      onMeRevived: () => { this.control.stance = 'crouch'; },
      onMeKilled: () => { this.deadAt = this.match.time; hud.setDeath(true, 'Observarás a tus compañeros'); },
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
    if (!m.running) return null;
    const p = m.player;
    if (!p) return null;
    if (p.state !== 'dead') return p;
    if (m.time - this.deadAt < DEATH_CAM) return null;          // cámara de muerte (libre)
    if (!this.spectating || this.spectating.state === 'dead') this.spectating = this._nextMate(null);
    return this.spectating || null;
  }
  get freeCam() {
    const p = this.player;
    if (!p || !this.match.running) return null;
    // cámara de muerte: por encima del cuerpo, mirando hacia abajo
    const b = p.body.pos;
    return { x: b.x + Math.sin(p.yaw) * 1.2, y: b.y + 2.1, z: b.z + Math.cos(p.yaw) * 1.2, yaw: p.yaw, pitch: -0.95 };
  }
  set freeCam(v) { /* derivado */ }

  _nextMate(cur) {
    const mates = this.game.operators.filter((o) => o.team === 0 && o.state !== 'dead' && o !== this.player);
    if (!mates.length) return null;
    const i = cur ? mates.indexOf(cur) : -1;
    return mates[(i + 1) % mates.length];
  }

  // ------------------------------------------------------------------ eventos de la partida
  _bindMatch() {
    const m = this.match, { audio, hud, chars, effects, input } = this.ctx;
    const on = (t, f) => this.disposers.push(m.on(t, f));
    on('roundSelect', () => {
      effects.clearAll();
      chars.clear();
      audio.stopDowned();
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
      this.ui.showPhase('Fase de preparación', side === 'def' ? `Defiendes ${m.site.name}` : 'El ataque espera la señal', 3);
      this.ui.setPrepInfo(side === 'atk'
        ? '<b>Preparación</b> · Tu equipo espera fuera mientras la defensa se atrinchera. Los drones de reconocimiento llegan en la Fase 4. Llevas el desactivador: plántalo en A o B.'
        : `<b>Preparación</b> · Defendéis <b>${m.site.name}</b>. Coge posición cerca de los sitios A y B; los refuerzos y barricadas llegan en la Fase 4.`);
    });
    on('action', () => {
      audio.cue('action');
      this.ui.setPrepInfo(null);
      this.ui.showPhase('¡Acción!', this.mySide() === 'atk' ? `Objetivo: ${m.site.name}` : 'Que no planten', 2.2);
    });
    on('plantStart', (op) => { if (op === this.player) audio.cue('plantStart'); });
    on('planted', (op, site) => {
      audio.cue('planted');
      this.ui.showPhase('Desactivador plantado', `Sitio ${site} · ${this.mySide() === 'atk' ? 'defiéndelo 45 s' : 'inutilízalo antes de 45 s'}`, 3);
    });
    on('disableStart', (op) => { if (op === this.player) audio.cue('plantStart'); });
    on('defuserDropped', () => { if (this.mySide() === 'atk') this.ui.showPhase('Desactivador en el suelo', 'Pasa por encima para recogerlo', 2.2); });
    on('defuserPicked', (op) => { if (op === this.player) this.ui.showPhase('Tienes el desactivador', 'Plántalo en A o B', 2); });
    on('roundEnd', (res) => {
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

  // ------------------------------------------------------------------ simulación
  tick(dt) {
    this.bots.update(dt);
    this.match.tick(dt);
  }

  onKey() {
    const { input } = this.ctx;
    const p = this.player;
    // observar: clic o espacio para cambiar de compañero
    if (p && p.state === 'dead' && this.match.running && this.match.time - this.deadAt >= DEATH_CAM) {
      if (input.mouseClicked(0) || input.pressed('vault')) { this.spectating = this._nextMate(this.spectating); this.ctx.resetView(); }
    }
  }

  frame(dt) {
    const m = this.match, { hud, input, audio } = this.ctx;
    this.ui.tick(dt);
    if (m.phase === 'select') { this.ui.updateSelect(m); return; }
    if (!m.running) { this.ui.updateMarkers([]); this.ui.showScoreboard(m, false); return; }
    this.ui.updateTop(m, dt);
    hud.hints(m.phase === 'prep' || (m.phase === 'action' && m.round === 1 && m.timeLeft > m.rules.actionTime - 12));
    this.ui.showScoreboard(m, input.isDown('scoreboard'));
    const view = this.viewOp;
    const p = this.player;
    // estado del operador visto (derribo, reanimación) y avisos del objetivo
    this.statusHud(view);
    let prompt = '';
    if (p && p === view && p.state === 'alive') {
      if (p.channel) hud.setRevive(p.channel.kind === 'plant' ? 'Plantando el desactivador' : 'Inutilizando el desactivador', p.channel.t / p.channel.total);
      else if (!p.reviving && !this.game.findRevivable(p)) {
        const d = m.defuser;
        if (d && d.carrier === p && (m.phase === 'action')) {
          const s = m.siteAt(p.body.pos.x, p.body.pos.y, p.body.pos.z);
          if (s) prompt = `Mantén F para plantar el desactivador · sitio ${s}`;
        } else if (d && d.planted && p.side === 'def' && m.phase === 'planted') {
          const P = d.plantPos;
          if (Math.hypot(p.body.pos.x - P.x, p.body.pos.z - P.z) < m.rules.disableRange && Math.abs(p.body.pos.y - P.y) < 1.2) prompt = 'Mantén F para inutilizar el desactivador';
        }
      }
    }
    this.promptText = prompt;
    this.ui.setCarry(!!(p && m.defuser && m.defuser.carrier === p && p.state !== 'dead'));
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
        const P = m.defuser.plantPos;
        audio.defuserBeep({ x: P.x, y: P.y + 0.2, z: P.z }, k, this.ctx.occlusion ? this.ctx.occlusion(P) : 0);
      }
    }
    if (m.phase === 'action' && m.timeLeft <= 10) {
      const s = Math.ceil(m.timeLeft);
      if (s !== this.lastTick) { this.lastTick = s; audio.cue('tick'); }
    }
  }

  _markers(view) {
    const m = this.match, list = [];
    const cam = this.ctx.camera.position;
    const dist = (q) => `${Math.round(Math.hypot(q.x - cam.x, q.y - cam.y, q.z - cam.z))} m`;
    const side = this.mySide();
    const d = m.defuser;
    if (m.site && !(d && d.planted) && (side === 'def' || m.phase === 'action')) {
      for (const k of ['A', 'B']) {
        const b = m.site.bombs[k];
        list.push({ x: b.x, y: b.y + 1.4, z: b.z, cls: side === 'def' ? 'def' : '', icon: k, label: dist(b) });
      }
    }
    if (d && d.planted) { const P = d.plantPos; list.push({ x: P.x, y: P.y + 0.9, z: P.z, cls: 'def', icon: '!', label: `Desactivador · ${dist(P)}` }); }
    if (d && !d.planted && d.pos && side === 'atk') list.push({ x: d.pos.x, y: d.pos.y + 0.6, z: d.pos.z, cls: 'drop', icon: '◆', label: `Desactivador · ${dist(d.pos)}` });
    for (const op of this.game.operators) {
      if (op.team !== 0 || op === view || op.state === 'dead') continue;
      const h = op.rig[BONE.head] ? op.rig[BONE.head].p : op.body.pos;
      const far = Math.hypot(h.x - cam.x, h.z - cam.z) > 22;
      list.push({ x: h.x, y: h.y + 0.45, z: h.z, cls: 'mate' + (op.state === 'downed' ? ' down' : ''), icon: '', label: far && op.state !== 'downed' ? '' : op.name });
    }
    return list;
  }

  dispose() {
    super.dispose();
    this.ui.dispose();
    this.ctx.chars.clear();
    this.ctx.audio.stopDowned();
    this.ctx.hud.setRevive(null, 0);
  }
}

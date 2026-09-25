// Partida rápida 5v5 contra bots: selección de operador, preparación (refuerzos,
// barricadas, drones y cámaras), acción, desactivador, fin de ronda y de partida.
// El jugador ocupa la ranura 0 del equipo 0 (azul); el rival es naranja.
import { Session } from './session.js';
import { bindGameFx } from './fx.js';
import { FeedController } from './feeds.js';
import { TeamChat } from './chat.js';
import { OrderWheel, ORDERS } from '../ui/wheel.js';
import { GADGETS } from '../sim/operators.js';
import { PLACE_LABEL } from '../sim/gadgets.js';
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
    this.chat = new TeamChat(ctx);
    this.disposers.push(() => this.chat.dispose());
    this.disposers.push(() => { const el = document.getElementById('alert'); if (el) el.classList.add('hidden'); });
    this.wheel = new OrderWheel();
    this.disposers.push(() => this.wheel.close());
    this.holdFire = false;       // tras elegir en la rueda con clic, no disparar hasta soltar el botón
    this.deadAt = -1;
    this.spectating = null;
    this.beepT = 0;
    this.lastTick = -1;
    this.promptText = '';
    this.markAt = -9;
    this.disposers.push(bindGameFx(ctx, this.match.game, {
      viewer: () => this.viewOp,
      me: () => this.match.player,
      onMeDowned: () => { this.control.stance = 'prone'; this.feed.exit(); },
      onMeRevived: () => { this.control.stance = 'crouch'; },
      onMeKilled: () => { this.deadAt = this.match.time; this.feed.exit(); hud.setDeath(true, `Observarás a tus compañeros · 5 ${this.mySide() === 'atk' ? 'drones' : 'cámaras'}`); },
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
      this.chat.clear();
      this.wheel.close();
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
        ? '<b>Preparación</b> · Pilota tu dron: <kbd>WASD</kbd> mover, <kbd>Espacio</kbd> saltar, <kbd>Clic</kbd> o <kbd>T</kbd> marcar enemigos. Busca el objetivo: los drones caben por huecos bajos. Llevas el desactivador.'
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
    // radio de los aliados: al chat de equipo (y en voz, si está activada)
    onGame('radio', (op, text) => { if (op.team === this.myTeam) this.chat.push(op.name, text, { speak: true, voiceKey: op.name }); });
    // reglas de edificio: pared invisible en la preparación y defensores detectados fuera
    on('boundary', (op) => { if (op === this.player) { audio.ping('deny'); hud.toast('No puedes salir en la preparación', 1.4); } });
    on('runout', (op) => {
      if (op === this.player) { audio.ping('deny'); this.chat.push(null, 'Te han detectado fuera del edificio', { cls: 'sys' }); }
      else if (this.mySide() === 'atk') { audio.ping('mark'); this.chat.push(null, `Defensor detectado fuera: ${op.name}`, { cls: 'sys' }); }
    });
    // si te hieren mientras miras un dron o una cámara, vuelves a tu cuerpo
    onGame('damaged', (t) => { if (t === this.player && this.feed.active && m.phase !== 'prep') this.feed.exit(); });
  }

  // ------------------------------------------------------------------ selección (desde la interfaz)
  pickOperator(id) { if (this.match.choose(this.meSlot, { opId: id })) this.ui.updateSelect(this.match, true); }
  pickWeapon(kind, i) { this.match.choose(this.meSlot, kind === 'primary' ? { primary: i } : { secondary: i }); this.ui.updateSelect(this.match, true); }
  pickGadget(i) { this.match.choose(this.meSlot, { gadget: i }); this.ui.updateSelect(this.match, true); }
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
    const p = this.player, { input } = this.ctx;
    if (this.feed.active) {
      if (p && p.state === 'alive') { const I = p.intent; I.moveX = 0; I.moveZ = 0; I.fire = false; I.ads = false; I.sprint = false; I.interact = false; I.lean = 0; }
      return this.feed.input(active, this.myTeam);
    }
    // rueda de órdenes abierta: el ratón elige en la rueda (la vista no se mueve) y no se dispara
    if (this.wheel.open) {
      const d = input.consumeMouse();
      if (active) this.wheel.move(d.dx, d.dy);
    }
    const r = super.input(active);
    if (!input.mouse.left) this.holdFire = false;
    if (p && (this.wheel.open || this.holdFire)) { p.intent.fire = false; if (this.wheel.open) p.intent.ads = false; }
    return r;
  }

  // ------------------------------------------------------------------ órdenes a los aliados
  canOrder() {
    const m = this.match, p = this.player;
    if (!p || p.state !== 'alive' || this.feed.active) return false;
    return m.phase === 'action' || m.phase === 'planted' || (m.phase === 'prep' && this.mySide() === 'def');
  }
  orderItems() {
    const m = this.match, def = this.mySide() === 'def';
    const items = [{ kind: 'follow' }, { kind: 'hold' }, { kind: 'goto' }];
    if (def) items.push({ kind: 'reinforce', disabled: !(m.phase === 'prep' || m.phase === 'action') });
    items.push({ kind: 'gadget', disabled: !(m.phase === 'action' || m.phase === 'planted' || (def && m.phase === 'prep')) });
    items.push({ kind: 'free' });
    return items;
  }
  alliesAlive() { return [...this.bots.brains.values()].filter((B) => B.team === this.myTeam && B.op.state !== 'dead').length; }
  /** Da una orden a los aliados bot (desde la rueda). Devuelve cuántos la cumplen. */
  giveOrder(kind) {
    const m = this.match, p = this.player, { audio, hud } = this.ctx;
    if (!this.canOrder()) return 0;
    let pos = null;
    if (kind === 'goto') pos = m.recon.pingOf(p.team, p) || m.recon.ping(p);
    if (kind === 'reinforce' || kind === 'gadget') pos = m.recon.ping(p);
    if ((kind === 'goto' || kind === 'reinforce' || kind === 'gadget') && !pos) { audio.ping('deny'); hud.toast('Mira a un punto del mapa'); return 0; }
    this.chat.push('Tú', ORDERS[kind].say, { cls: 'me' });
    const n = this.bots.order(kind, p, pos);
    if (n) audio.ui('click'); else audio.ping('deny');
    return n;
  }
  // Orden que cumplen ahora los aliados (para el HUD)
  activeOrder() {
    for (const B of this.bots.brains.values()) if (B.team === this.myTeam && B.order && B.op.state !== 'dead') return B.order.kind;
    return null;
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
    // T o botón central: marcar al enemigo que miras o, si no hay ninguno, poner una marca de posición
    const markKey = input.pressed('mark') || input.mouseClicked(1);
    if (markKey && p && p.state === 'alive' && !this.feed.active && (m.phase === 'prep' || m.phase === 'action' || m.phase === 'planted') && m.time - this.markAt >= 0.4) {
      this.markAt = m.time;
      if (!m.recon.markOrPing(p)) audio.ping('deny');
    }
    // H: rueda de órdenes para los aliados bot (mantener, elegir con el ratón, soltar)
    if (this.wheel.open) {
      if (!this.canOrder() || input.mouseClicked(2)) this.wheel.close();
      else if (!input.isDown('orders') || input.mouseClicked(0)) {
        if (input.mouse.left) this.holdFire = true;
        const it = this.wheel.close();
        if (it) this.giveOrder(it.kind);
      }
    } else if (input.pressed('orders') && this.canOrder()) {
      if (!this.alliesAlive()) { audio.ping('deny'); hud.toast('No te quedan aliados'); } else this.wheel.show(this.orderItems());
    }
    // 5: dron (ataque) o cámaras (defensa); muerto, tras la cámara de muerte, también
    const live = m.phase === 'prep' || m.phase === 'action' || m.phase === 'planted';
    if (p && p.state === 'dead' && live && m.time - this.deadAt >= DEATH_CAM) {
      if (input.pressed('drone')) {
        if (this.feed.active) { this.feed.exit(); this.ctx.resetView(); }
        else if (this.mySide() === 'atk') {
          const d = this._nextTeamDrone(null);
          if (d) this.feed.enterDrone(d, true); else { audio.ping('deny'); hud.toast('No quedan drones'); }
        } else if (!this.feed.cycleCam(0)) { audio.ping('deny'); hud.toast('Cámaras destruidas'); }
      } else if (this.feed.mode === 'drone' && this.feed.piloting && (input.pressed('leanLeft') || input.pressed('leanRight'))) {
        // Q/E: otro dron del equipo
        const d = this._nextTeamDrone(this.feed.drone);
        if (d && d !== this.feed.drone) this.feed.enterDrone(d, true);
      }
      return;
    }
    // PULGA: X a pie lleva a su dron de choque
    if (input.pressed('ability') && p && p.state === 'alive' && live && !this.feed.active && p.ability && p.ability.id === 'shockdrone' && m.phase !== 'prep') {
      const d = m.abilities.shockDroneOf(p);
      if (d) this.feed.enterDrone(d, true);
      else { audio.ping('deny'); hud.toast('Tu dron de choque está destruido'); }
      return;
    }
    if (input.pressed('drone') && p && p.state === 'alive' && live) {
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
    // (muerto: si cae el dron, al siguiente del equipo; si no quedan, a observar)
    if (F.mode === 'drone' && F.drone && !F.drone.alive && F.lostT <= 0) F.lose(1.0, () => { const nd = p.state === 'dead' ? this._nextTeamDrone(null) : null; if (nd) this.feed.enterDrone(nd, true); else this.feed.exit(); });
    if (F.mode === 'cams' && F.cam && !F.cam.alive && F.lostT <= 0) F.lose(0.8, () => { if (!this.feed.cycleCam(1)) this.feed.exit(); });
  }

  frame(dt, alpha = 1) {
    const m = this.match, { hud, input, audio } = this.ctx;
    this.ui.tick(dt);
    this.chat.tick(dt);
    this._smokeFx(dt);
    this._burnFx(dt);
    this._electricFx(dt);
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
    this.syncProps(dt, alpha, { recon: m.recon, fort: m.fort, defuser: def, feed: this.feed, myTeam: 0, gadgets: m.gadgets, viewer: view });
    // vista remota
    const found = m.objectiveFound;
    this.feed.frame(dt, {
      dronesLeft: side === 'atk' && p ? m.recon.dronesLeft(p) : undefined,
      canExit: m.phase !== 'prep' || !p || p.state === 'dead',
      dead: !!p && p.state === 'dead',
      objective: side === 'atk' ? (found ? `Objetivo localizado · ${m.site.name}` : 'Objetivo sin localizar') : '',
      objectiveOk: found,
    });
    // estado del operador visto y avisos (reanimar, plantar, inutilizar, fortificar)
    this.statusHud(view);
    let prompt = '';
    if (p && p === view && p.state === 'alive') {
      if (p.channel && (p.channel.kind === 'plant' || p.channel.kind === 'disable')) hud.setRevive(p.channel.kind === 'plant' ? 'Plantando el desactivador' : 'Inutilizando el desactivador', p.channel.t / p.channel.total);
      else if (p.channel && p.channel.kind === 'gadget') hud.setRevive(`Colocando ${PLACE_LABEL[p.channel.what] || 'el gadget'}`, p.channel.t / p.channel.total);
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
        // (reforzar y colocar un gadget o la habilidad en la misma pared: se avisan todas)
        const kit = () => [this._gadgetPrompt(p), this._abilityPrompt(p)].filter(Boolean).join(' · ');
        if (!prompt && side === 'def') {
          prompt = this.fortifyHud(m.fort, p);
          const gp = prompt ? kit() : '';
          if (gp) prompt += ` · ${gp}`;
        }
        if (!prompt) prompt = kit();
      }
      // anti run-out: cuenta atrás mientras estás fuera del edificio
      if (!prompt && side === 'def' && (m.phase === 'action' || m.phase === 'planted') && p.outT > 0) {
        prompt = p.runout ? 'Detectado fuera del edificio' : `Fuera del edificio · te detectarán en ${Math.max(1, Math.ceil(m.rules.runoutTime - p.outT))} s`;
      }
    }
    this.promptText = prompt;
    this._scanHud(p);
    // (el panel de la preparación se aparta mientras hay un aviso o una barra de progreso)
    this.ui.el.prep.classList.toggle('behind', !!prompt || !!(p && p === view && (p.channel || p.reviving)));
    this.ui.setCarry(!!(p && def && def.carrier === p && p.state !== 'dead'));
    this._gear(p, side);
    // observar
    if (p && p.state === 'dead' && view && view !== p) this.ui.setSpectate(`Observando a <b>${view.name}</b> · clic para cambiar · 5 ${side === 'atk' ? 'drones' : 'cámaras'}`);
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

  // Qué hará G ahora con un explosivo colocable o detonable.
  // Pulso de escaneo en curso: aviso arriba (rojo si es contra tu equipo, azul si es tuyo).
  _scanHud(p) {
    const m = this.match, A = m.abilities, el = document.getElementById('alert');
    const team = p ? p.team : 0, now = this.game.time;
    const live = m.phase === 'prep' || m.phase === 'action' || m.phase === 'planted';
    const against = live && A && A.scanAgainst(team);
    const mine = live && A && A.scans.find((s) => s.team === team);
    let text = '', ally = false;
    if (against) text = now < against.from ? `¡Escaneo en ${Math.ceil(against.from - now)} s! No te muevas` : `Escaneo activo · no te muevas · ${Math.ceil(against.until - now)}`;
    else if (mine) { ally = true; text = now < mine.from ? `Pulso de escaneo en ${Math.ceil(mine.from - now)} s` : `Escaneo activo · ${Math.ceil(mine.until - now)} s`; }
    if (this._alertText !== text) { this._alertText = text; el.textContent = text; el.classList.toggle('hidden', !text); }
    el.classList.toggle('ally', ally);
  }

  // Aviso de la habilidad (X): colocar o encender la carga térmica.
  _abilityPrompt(p) {
    const m = this.match, a = p.ability;
    if (!a || !m.abilities.ready(p)) return '';
    const G = m.gadgets;
    if (a.id === 'thermal') {
      if (G.thermalOf(p)) return 'X para encender la carga térmica';
      if (!a.left) return '';
      const spot = G.placeSpot(p, 'thermal');
      return spot && spot.ok ? 'X para colocar la carga térmica' : '';
    }
    if (a.id === 'gas') {
      const out = G.items.some((i) => i.alive && i.kind === 'gas' && i.owner === p && i.rest);
      return out ? (a.left ? 'Mantén X para activar el gas' : 'X para activar el gas') : '';
    }
    if (a.id === 'stim' && a.left) {
      const ally = m.abilities.stimTarget(p);
      return ally ? `X para ${ally.state === 'downed' ? 'levantar' : 'curar'} a ${ally.name}` : '';
    }
    if (a.id === 'battery' || a.id === 'jammer' || a.id === 'lasermine' || a.id === 'interceptor') {
      if (!a.left) return '';
      const spot = G.placeSpot(p, a.id);
      return spot && spot.ok ? `X para poner ${PLACE_LABEL[a.id]}` : '';
    }
    return '';
  }
  _gadgetPrompt(p) {
    const G = this.match.gadgets, g = p.gadget;
    if (!G || !g) return '';
    if (G._detonable(p)) return 'G para detonar';
    if (g.left <= 0 || !PLACE_LABEL[g.id]) return '';
    const spot = G.placeSpot(p);
    if (!spot || !spot.ok) return g.id === 'breach' && spot && spot.why && spot.why.startsWith('Muro') ? spot.why : '';
    return `G para colocar ${PLACE_LABEL[g.id]}`;
  }

  // Nubes de gas de TIZÓN: partículas amarillo verdosas, menos densas que el humo.
  _gasFx(dt, G, fx) {
    this.gasAcc = (this.gasAcc || 0) + dt;
    const n = Math.floor(this.gasAcc * 16);
    if (!n) return;
    this.gasAcc -= n / 16;
    for (const s of G.gasClouds) {
      const r = G.gasRadius(s);
      if (r <= 0.2) continue;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.85;
        const k = 0.9 + Math.random() * 0.1;
        fx.spawnDust(s.x + Math.cos(a) * d, s.y - 0.9 + Math.random() * 2.0, s.z + Math.sin(a) * d, (Math.random() - 0.5) * 0.25, 0.03 + Math.random() * 0.08, (Math.random() - 0.5) * 0.25, 1.2 + Math.random() * 0.8, [0.6 * k, 0.64 * k, 0.28 * k], 2.4 + Math.random() * 1.2, 0.3);
      }
    }
  }

  // Lo que electrifica una batería: alguna chispa azul de vez en cuando por su superficie.
  _electricFx(dt) {
    const G = this.match.gadgets, fx = this.ctx.effects;
    if (!G) return;
    for (const c of G.placed) {
      if (!c.alive || c.kind !== 'battery' || G.isOff(c) || !c.host) continue;
      c._sparkT = (c._sparkT || 0) - dt;
      if (c._sparkT > 0) continue;
      c._sparkT = 0.12 + Math.random() * 0.35;
      const b = c.host.kind === 'wire' ? G._wireBox(c.host.wire) : c.host.box;
      const x = b.x0 + Math.random() * (b.x1 - b.x0), y = b.y0 + Math.random() * (b.y1 - b.y0), z = b.z0 + Math.random() * (b.z1 - b.z0);
      for (let i = 0; i < 3; i++) fx.spawnSpark(x, y, z, (Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5, 1);
    }
  }

  // Cargas térmicas encendidas: lluvia de chispas y luz naranja que parpadea.
  _burnFx(dt) {
    const G = this.match.gadgets, fx = this.ctx.effects;
    if (!G) return;
    for (const c of G.placed) {
      if (!c.alive || !c.burning) continue;
      const n = c.normal, p = c.pos;
      c._fxAcc = (c._fxAcc || 0) + dt * 60;
      for (; c._fxAcc >= 1; c._fxAcc--) {
        const ox = n.x ? 0 : (Math.random() - 0.5) * 0.6, oz = n.z ? 0 : (Math.random() - 0.5) * 0.6;
        fx.spawnSpark(p.x + ox + n.x * 0.1, p.y + (Math.random() - 0.5) * 0.9, p.z + oz + n.z * 0.1,
          n.x * (1 + Math.random() * 2) + (Math.random() - 0.5), Math.random() * 1.5 - 0.5, n.z * (1 + Math.random() * 2) + (Math.random() - 0.5), 1);
      }
      if (Math.random() < 0.5) fx.flash(p.x + n.x * 0.3, p.y, p.z + n.z * 0.3, 50, 26, 8, 6, 0.08);
    }
  }

  // Nubes de humo: partículas grandes y grises mientras duran.
  _smokeFx(dt) {
    const G = this.match.gadgets, fx = this.ctx.effects;
    if (G && G.gasClouds && G.gasClouds.length) this._gasFx(dt, G, fx);
    if (!G || !G.smokes.length) return;
    this.smokeAcc = (this.smokeAcc || 0) + dt;
    const n = Math.floor(this.smokeAcc * 26);
    if (!n) return;
    this.smokeAcc -= n / 26;
    for (const s of G.smokes) {
      const r = G.smokeRadius(s);
      if (r <= 0.2) continue;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.85;
        const g = 0.55 + Math.random() * 0.1;
        fx.spawnDust(s.x + Math.cos(a) * d, s.y - 0.9 + Math.random() * 2.2, s.z + Math.sin(a) * d, (Math.random() - 0.5) * 0.3, 0.05 + Math.random() * 0.12, (Math.random() - 0.5) * 0.3, 1.1 + Math.random() * 0.9, [g, g + 0.01, g + 0.02], 2.6 + Math.random() * 1.2, 0.5);
      }
    }
  }

  _gear(p, side) {
    const el = document.getElementById('gear');
    if (!p || p.state === 'dead' || this.feed.active) {
      if (this._gearHtml !== '') { this._gearHtml = ''; el.classList.add('hidden'); }
      if (this._kitHtml !== '') { this._kitHtml = ''; document.getElementById('kit').classList.add('hidden'); }
      return;
    }
    const m = this.match;
    const ord = this.activeOrder();
    const orders = `<span class="ord">H órdenes${ord ? ` · <b>${ORDERS[ord].label}</b>` : ''}</span>`;
    const html = side === 'atk'
      ? `<span>Drones <b>${m.recon.dronesLeft(p)}</b></span><span>5 dron · V golpe</span>${orders}`
      : `<span>5 cámaras · V golpe</span>${orders}`;
    if (this._gearHtml !== html) { this._gearHtml = html; el.innerHTML = html; el.classList.remove('hidden'); }
    // abajo a la derecha, junto a la munición: gadget secundario y refuerzos (documento, sección 19)
    const g = p.gadget && GADGETS[p.gadget.id];
    const ab = p.ability && m.abilities.ready(p) && p.opDef ? p.opDef.ability : null;
    const kit = (ab ? `<span class="${p.ability.left ? '' : 'off'}"><kbd>X</kbd>${ab.short || ab.name}${p.ability.left >= 0 ? ` <b>×${p.ability.left}</b>` : ''}</span>` : '')
      + (g ? `<span class="${p.gadget.left ? '' : 'off'}"><kbd>G</kbd>${g.short} <b>×${p.gadget.left}</b></span>` : '')
      + (side === 'def' ? `<span><kbd>F</kbd>Refuerzos <b>${m.fort.remaining(p)}</b></span>` : '');
    const ke = document.getElementById('kit');
    if (this._kitHtml !== kit) { this._kitHtml = kit; ke.innerHTML = kit; ke.classList.toggle('hidden', !kit); }
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
    // marcas de posición del equipo
    for (const pg of m.recon.pings.values()) {
      if (pg.team !== 0) continue;
      list.push({ x: pg.x, y: pg.y + 0.1, z: pg.z, cls: 'ping', icon: '', label: pg.by === this.player ? dist(pg) : `${pg.by.name} · ${dist(pg)}` });
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
    document.getElementById('kit').classList.add('hidden');
  }
}

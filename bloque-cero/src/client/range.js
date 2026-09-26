// Campo de pruebas: la villa con maniquís (uno dispara), un compañero para
// practicar la reanimación, arsenales intercambiables y, en la calle, la fila
// de los 16 operadores para ver sus siluetas.
import { Session } from './session.js';
import { bindGameFx } from './fx.js';
import { FeedController } from './feeds.js';
import { Fortify } from '../sim/fortify.js';
import { Recon } from '../sim/recon.js';
import { Game } from '../sim/game.js';
import { Operator } from '../sim/operator.js';
import { WeaponState, WEAPONS } from '../sim/weapons.js';
import { spawnRangeDummies, spawnLineup, driveDummies, resetDummies } from '../sim/dummies.js';
import { OPERATORS } from '../sim/operators.js';
import { rayHitRig } from '../sim/skeleton.js';
import { defaultLook, operatorLook } from '../render/character.js';
import { raycastFirst } from '../world/raycast.js';
import { breachRect, explodeSphere } from '../world/destruction.js';
import { MATS, SOLID } from '../world/materials.js';

const SPAWN = { x: 15.5, y: 0, z: -4.5, yaw: Math.PI };
const LOADOUTS = [['ar', 'pistol', 'shotgun', 'smg'], ['ar2', 'revolver', 'lmg', 'dmr'], ['smg2', 'mpistol', 'shotgun', 'ar']];

export class RangeSession extends Session {
  constructor(ctx) {
    super(ctx);
    const { world, map, chars, hud } = ctx;
    world.resetToPristine();
    ctx.effects.clearAll();
    this._game = new Game({ world, map, seed: 20260923 });
    this.loadoutIdx = 0;
    this._player = this._game.addOperator(new Operator('jugador', { name: 'Tú', team: 0, x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, yaw: SPAWN.yaw, loadout: LOADOUTS[0], armor: 2 }));
    this.dummies = spawnRangeDummies(this._game);
    this.lineup = spawnLineup(this._game, OPERATORS);
    // en el campo de pruebas el jugador puede reforzar, poner barricadas y usar drones sin límite
    this.fort = new Fortify(this._game, { canFortify: (op) => op === this._player });
    this.fort.left.set(this._player, Infinity);
    this.recon = new Recon(this._game, { cameras: map.cameras || [] });
    this.recon.reset({ defTeam: 1, site: null });
    this.recon.left.set(this._player, Infinity);
    this.feed = new FeedController(ctx, () => this.recon);
    this.promptText = '';
    chars.clear();
    chars.add(this._player, defaultLook(0, 0));
    this.dummies.forEach((d, i) => chars.add(d, defaultLook(d.team, i)));
    // la fila, cada uno con su aspecto: en azul los de ataque y en naranja los de defensa
    for (const op of this.lineup) chars.add(op, operatorLook(op.opDef, op.opDef.side === 'atk' ? 0 : 1));
    this.disposers.push(bindGameFx(ctx, this._game, {
      viewer: () => this._player, me: () => this._player,
      onMeDowned: () => { this.control.stance = 'prone'; },
      onMeRevived: () => { this.control.stance = 'crouch'; },
      onMeKilled: () => { hud.setDeath(true, 'Pulsa R para volver a empezar'); },
    }));
    hud.setMode('range');
    hud.setDeath(false); hud.setDowned(false);
  }
  get player() { return this._player; }
  get game() { return this._game; }
  get viewOp() { return this.feed.active ? null : this._player; }
  get viewCam() { return this.feed.active ? this.feed : null; }

  input(active) {
    if (this.feed.active) {
      const I = this._player.intent; I.moveX = 0; I.moveZ = 0; I.fire = false; I.ads = false; I.interact = false;
      return this.feed.input(active, 0);
    }
    return super.input(active);
  }

  tick(dt) {
    driveDummies(this._game, this.dummies, this._player, dt);
    driveDummies(this._game, this.lineup, null, dt);
    this._game.tick(dt);
    this.fort.tick(dt);
    this.recon.tick(dt);
  }

  onKey() {
    const { input } = this.ctx;
    const I = this._player.intent;
    const take = (code) => { if (input.pressedQ.has(code)) { input.pressedQ.delete(code); return true; } return false; };
    if (input.pressed('drone') && this._player.state === 'alive') {
      if (this.feed.active) this.feed.exit();
      else { const d = this.recon.droneOf(this._player) || this.recon.deployDrone(this._player, { thrown: true }); if (d) this.feed.enterDrone(d, true); }
    }
    if (this.feed.active) return;
    if (take('Digit3')) I.switchTo = 2;
    if (take('Digit4')) I.switchTo = 3;
    if (input.pressed('gadget')) this.testBreach();
    if (take('KeyJ')) { const mate = this.dummies.find((d) => d.team === 0); if (mate && mate.state === 'alive') this._game.damage(mate, mate.hp, { by: null, zone: 'body' }); }
    if (take('KeyK')) this.reset();
    if (take('KeyL')) this.setLoadout(this.loadoutIdx + 1);
    if (this._player.state === 'dead' && input.pressed('reload')) this.respawn();
  }

  frame(dt, alpha = 1) {
    const F = this.feed;
    if (F.mode === 'drone' && F.drone && !F.drone.alive && F.lostT <= 0) F.lose(1.0, () => this.feed.exit());
    this.syncProps(dt, alpha, { recon: this.recon, fort: this.fort, feed: F, myTeam: 0 });
    F.frame(dt, { canExit: true });
    this.statusHud(this.viewOp);
    this.promptText = this.feed.active ? '' : (this.fortifyHud(this.fort, this._player) || this.lineupName());
    this.ctx.hud.hints(!this.feed.active);
    this.ctx.hud.setTopbar('Campo de pruebas', 'Fase 4');
  }

  setLoadout(i) {
    const p = this._player;
    this.loadoutIdx = i % LOADOUTS.length;
    p.weapons = LOADOUTS[this.loadoutIdx].map((k) => new WeaponState(WEAPONS[k]));
    p.weaponIndex = 0;
    p.weapon.equipT = p.weapon.def.equip;
    this.ctx.chars.remove(p); this.ctx.chars.add(p, defaultLook(0, 0));
    this.ctx.hud.toast(LOADOUTS[this.loadoutIdx].map((k) => WEAPONS[k].name).join(' · '), 2.2);
  }
  respawn() {
    const p = this._player, { audio, hud } = this.ctx;
    p.state = 'alive'; p.hp = p.maxHp; p.deathT = 0; p.bleedT = 0;
    p.pose.dead = 0; p.pose.downed = 0;
    p.stance = 'stand'; p.body.height = 1.8; this.control.reset('stand');
    for (const w of p.weapons) w.refill();
    this.ctx.place(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw, 0);
    audio.stopDowned();
    hud.setDeath(false); hud.setDowned(false);
  }
  reset() {
    this.ctx.world.resetToPristine();
    this.ctx.effects.clearAll();
    this.feed.exit();
    this.fort.reset(); this.fort.left.set(this._player, Infinity);
    this.recon.reset({ defTeam: 1, site: null }); this.recon.left.set(this._player, Infinity);
    resetDummies(this.dummies);
    resetDummies(this.lineup);
    this.respawn();
    this.ctx.hud.toast('Campo reiniciado');
  }

  // Operador de la fila al que apuntas (hasta 40 m y sin paredes por medio): quién es.
  lineupName() {
    const p = this._player;
    if (p.state !== 'alive') return '';
    const e = p.eyePos(), d = p.viewDir();
    const wall = raycastFirst(this.ctx.world, e.x, e.y, e.z, d.x, d.y, d.z, 40, SOLID, true);
    let best = null, bt = wall ? wall.t : 40;
    for (const op of this.lineup) {
      if (op.state === 'dead') continue;
      const h = rayHitRig(op.rig, e, d, bt);
      if (h && h.t < bt) { bt = h.t; best = op; }
    }
    if (!best) return '';
    const def = best.opDef;
    return `${def.name} · ${def.side === 'atk' ? 'ataque' : 'defensa'} · ${def.role.toLowerCase()} · blindaje ${def.armor}`;
  }

  // Carga de brecha de prueba (G): boquete en la pared a la que miras.
  testBreach() {
    const { world, effects, audio, hud } = this.ctx;
    const p = this._player;
    const e = p.eyePos(), d = p.viewDir();
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
    this.ctx.shake = 1.2;
    hud.toast('Boquete abierto');
  }

  dispose() {
    super.dispose();
    this.feed.exit();
    this.ctx.chars.clear();
    this.ctx.props.clear();
    this.ctx.audio.stopDowned();
  }
}

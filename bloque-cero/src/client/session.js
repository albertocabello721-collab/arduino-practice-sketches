// Base de las sesiones de juego (campo de pruebas, partida). El bucle principal
// pregunta a la sesión qué operador se ve, avanza su simulación a paso fijo y le
// deja pintar su interfaz.
import { PlayerControl } from './control.js';
import { REVIVE_TIME, BLEED_TIME } from '../sim/operator.js';

export class Session {
  constructor(ctx) {
    this.ctx = ctx;
    this.control = new PlayerControl(ctx);
    this.wantsPointer = true;    // si pide ratón capturado (con menús abiertos, no)
    this.freeCam = null;         // {x,y,z,yaw,pitch} cuando no hay operador que mirar
    this.disposers = [];
  }
  get player() { return null; }
  get viewOp() { return this.player; }
  get game() { return null; }
  // ¿Puede el jugador controlar ahora su operador?
  get controlling() { const p = this.player; return !!p && p === this.viewOp && p.state !== 'dead'; }

  /** Entrada del frame (antes de la simulación). Devuelve el movimiento del ratón. */
  input(active) {
    const p = this.player;
    if (!p || !this.controlling) { this.ctx.input.consumeMouse(); return { dx: 0, dy: 0 }; }
    return this.control.apply(p, active);
  }
  tick(dt) {}
  frame(dt) {}
  onKey() {}
  dispose() { for (const d of this.disposers) d(); this.disposers = []; }

  // Aviso de fortificación para el jugador (qué hará F) y barra de progreso.
  fortifyHud(fort, op) {
    const { hud } = this.ctx;
    if (!fort || !op || op.state !== 'alive') return '';
    if (op.channel && (op.channel.kind === 'reinforce' || op.channel.kind === 'barricade')) {
      hud.setRevive(op.channel.kind === 'reinforce' ? 'Reforzando' : 'Poniendo la barricada', op.channel.t / op.channel.total);
      return '';
    }
    if (op.reviving || !fort.canFortify(op)) return '';
    const t = fort.targetFor(op);
    if (!t) return '';
    if (t.kind === 'barricade') return t.valid ? 'Mantén F para poner una barricada' : t.reason;
    const left = fort.remaining(op);
    const what = t.kind === 'hatch' ? 'la trampilla' : 'la pared';
    if (t.valid) return left > 0 ? `Mantén F para reforzar ${what} · ${Number.isFinite(left) ? left : '∞'}` : 'No te quedan refuerzos';
    return t.reason === 'Ya está reforzada' || t.kind === 'hatch' ? t.reason : '';
  }

  // Objetos 3D del reconocimiento y la fortificación, y el motor de los drones.
  syncProps(dt, alpha, { recon, fort, defuser = null, feed = null, myTeam = 0, gadgets = null, viewer = null }) {
    const { props, audio } = this.ctx;
    props.sync(dt, {
      drones: recon ? recon.drones : [], cams: recon ? recon.cams : [],
      panels: fort ? fort.panels : [], work: fort ? fort.work : null,
      defuser, myTeam, alpha, gadgets: gadgets ? gadgets.items : [], placed: gadgets ? gadgets.placed : [],
      now: this.game ? this.game.time : 0, ops: this.game ? this.game.operators : [], viewer,
      cam: this.ctx.camEye || null, droneView: !!(feed && feed.active && feed.mode === 'drone'),
      hide: feed && feed.active ? (feed.drone || feed.cam) : null,
    });
    if (recon && audio.ctx) {
      for (const d of recon.drones) {
        if (!d.alive) continue;
        const p = d.body.pos;
        const local = feed && feed.drone === d && feed.piloting;
        audio.droneLoop(d.id, { x: p.x, y: p.y + 0.1, z: p.z }, d.moveSpeed, local || !this.ctx.occlusion ? 0 : this.ctx.occlusion(p), local);
      }
      audio.droneSweep();
    }
  }

  // Estado del operador visto: derribo, reanimación, avisos de F.
  statusHud(op) {
    const { hud } = this.ctx;
    if (!op) { hud.setDowned(false); hud.setRevive(null, 0); return; }
    if (op.state === 'downed') hud.setDowned(true, op.bleedT, op.bleedT / BLEED_TIME); else hud.setDowned(false);
    if (op.reviving) hud.setRevive(`Reanimando a ${op.reviving.name}`, op.reviving.reviveT / REVIVE_TIME);
    else if (op.state === 'downed' && op.reviveT > 0) hud.setRevive(op === this.player ? 'Te están reanimando' : `Reanimando a ${op.name}`, op.reviveT / REVIVE_TIME);
    else if (op === this.player && op.state === 'alive' && this.game) {
      const near = this.game.findRevivable(op);
      hud.setRevive(near ? `Mantén F para reanimar a ${near.name}` : null, 0);
    } else hud.setRevive(null, 0);
  }
}

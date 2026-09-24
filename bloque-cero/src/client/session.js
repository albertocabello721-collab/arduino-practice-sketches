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

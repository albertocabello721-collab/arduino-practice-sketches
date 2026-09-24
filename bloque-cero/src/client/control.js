// Teclado y ratón → intenciones del operador del jugador (común a todas las sesiones).
import { clamp } from '../core/math.js';

export class PlayerControl {
  constructor(ctx) {
    this.ctx = ctx;
    this.stance = 'stand';
    this.lean = 0;
  }
  reset(stance = 'stand') { this.stance = stance; this.lean = 0; }

  /**
   * Lee la entrada y escribe las intenciones de `op`. Si `active` es falso, deja el
   * operador quieto y descarta el ratón. Devuelve el movimiento del ratón del frame.
   */
  apply(op, active) {
    const { input, settings } = this.ctx;
    const I = op.intent;
    if (!active) {
      I.moveX = 0; I.moveZ = 0; I.fire = false; I.ads = false; I.sprint = false; I.interact = false; I.holdWound = false;
      input.consumeMouse();
      return { dx: 0, dy: 0, wheel: 0 };
    }
    I.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    I.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    I.sprint = input.isDown('sprint');
    // postura
    if (op.state === 'downed') this.stance = 'prone';
    if (settings.crouchToggle) { if (input.pressed('crouch')) this.stance = this.stance === 'crouch' ? 'stand' : 'crouch'; }
    else this.stance = input.isDown('crouch') ? 'crouch' : (this.stance === 'crouch' ? 'stand' : this.stance);
    if (input.pressed('prone')) this.stance = this.stance === 'prone' ? 'stand' : 'prone';
    if (I.sprint && I.moveZ > 0 && this.stance !== 'prone') this.stance = 'stand';
    I.stance = this.stance;
    // asomarse
    if (settings.leanToggle) {
      if (input.pressed('leanLeft')) this.lean = this.lean === -1 ? 0 : -1;
      if (input.pressed('leanRight')) this.lean = this.lean === 1 ? 0 : 1;
      if (I.sprint && I.moveZ > 0) this.lean = 0;
    } else this.lean = (input.isDown('leanRight') ? 1 : 0) - (input.isDown('leanLeft') ? 1 : 0);
    I.lean = this.lean;
    I.fire = input.mouse.left;
    I.ads = input.mouse.right;
    if (input.pressed('reload')) I.reload = true;
    if (input.pressed('melee')) I.melee = true;
    if (input.pressed('vault')) I.vault = true;
    if (input.pressed('primary')) I.switchTo = 0;
    if (input.pressed('secondary')) I.switchTo = 1;
    const m = input.consumeMouse();
    if (m.wheel && op.weapons.length > 1) I.switchTo = (op.weaponIndex + (m.wheel > 0 ? 1 : op.weapons.length - 1)) % op.weapons.length;
    I.interact = input.isDown('interact');
    I.holdWound = op.state === 'downed' && input.isDown('interact');
    // mirar con el ratón (inmediato, fuera del tick fijo)
    const base = 0.0022 * settings.sensitivity * (1 - op.ads * (1 - settings.adsSensitivity / Math.max(1, op.weapon.def.adsZoom)));
    op.yaw -= m.dx * base;
    op.pitch = clamp(op.pitch - m.dy * base * (settings.invertY ? -1 : 1), -1.5, 1.5);
    return m;
  }
}

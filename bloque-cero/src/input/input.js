// Teclado y ratón con bloqueo de puntero. Asignaciones al estilo de Siege:
// WASD mover, Mayús correr, C agacharse, Z cuerpo a tierra, Q/E asomarse,
// Espacio saltar obstáculo, R recargar, F interactuar, G gadget secundario,
// X habilidad del operador, 1/2 armas, V cuerpo a cuerpo, T (o botón central) marcar,
// H órdenes a los aliados, B modo de disparo, I inspeccionar el arma, Tab marcador, P depuración.
// El mando (F10.5, gamepad.js) entra por aquí también: cada fotograma deja sus teclas, clics y
// movimiento de ratón «virtuales» (setPad), así que lo que lee la entrada no cambia.
export const BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', prone: 'KeyZ',
  leanLeft: 'KeyQ', leanRight: 'KeyE', vault: 'Space',
  reload: 'KeyR', interact: 'KeyF', gadget: 'KeyG', ability: 'KeyX',
  primary: 'Digit1', secondary: 'Digit2', melee: 'KeyV', drone: 'Digit5', mark: 'KeyT', orders: 'KeyH', fireMode: 'KeyB', inspect: 'KeyI',
  scoreboard: 'Tab', perf: 'KeyM', debug: 'KeyP',
};

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pressedQ = new Set();
    // lo que dice el mando este fotograma (F10.5): teclas mantenidas, gatillos, stick izquierdo y
    // eventos (agacharse, tumbarse, cambiar de arma, pausa); `padActive`: se está jugando con él
    // (desde que se toca hasta que se usa el teclado o el ratón)
    const pad = this.pad = { held: new Set(), left: false, right: false, move: { x: 0, z: 0 }, events: [] };
    this.padActive = false;
    this.padKind = 'xbox';    // y cómo se llaman sus botones ('xbox' o 'ps')
    this.noLock = false;      // sin captura del ratón (no se pudo): el ratón mueve la vista igual (F10.4)
    // los botones del ratón cuentan también los gatillos del mando (RT dispara, LT apunta)
    this.mouse = { dx: 0, dy: 0, middle: false, wheel: 0, _l: false, _r: false };
    Object.defineProperties(this.mouse, {
      left: { get() { return this._l || pad.left; }, set(v) { this._l = v; }, enumerable: true },
      right: { get() { return this._r || pad.right; }, set(v) { this._r = v; }, enumerable: true },
    });
    this.mousePressed = new Set();
    this.locked = false;
    this.onLockChange = null;
    this.enabled = true;
    const kd = (e) => {
      this.padActive = false;
      if (!this.enabled) return;
      if (['Tab', 'Space', 'F3', 'ShiftLeft', 'ControlLeft'].includes(e.code) || (this.locked && e.code.startsWith('Key'))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedQ.add(e.code);
      this.down.add(e.code);
    };
    const ku = (e) => { this.down.delete(e.code); };
    const mm = (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.padActive = false;
      if (!this.locked && !this.noLock) return;
      // algunos navegadores disparan saltos gigantes al capturar el puntero
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    };
    const md = (e) => {
      this.padActive = false;
      if (!this.locked && !this.noLock) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      if (e.button === 1) { this.mouse.middle = true; e.preventDefault(); }
      this.mousePressed.add(e.button);
    };
    const mu = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    };
    const wh = (e) => { if (this.locked || this.noLock) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('wheel', wh, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (this.locked || this.noLock) e.preventDefault(); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; this.down.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { if (this.onLockChange) this.onLockChange(false, true); });
  }
  requestLock() {
    if (this.padActive) return;      // con el mando no hace falta (y sin un clic no se podría)
    try {
      const p = this.target.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.target.requestPointerLock(); } catch (e) { /* sin bloqueo */ } });
    } catch (e) {
      try { this.target.requestPointerLock(); } catch (e2) { /* sin bloqueo */ }
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  isDown(action) { const c = BINDINGS[action]; return this.down.has(c) || this.pad.held.has(c); }
  pressed(action) {
    const c = BINDINGS[action];
    if (this.pressedQ.has(c)) { this.pressedQ.delete(c); return true; }
    return false;
  }
  mouseClicked(btn) { if (this.mousePressed.has(btn)) { this.mousePressed.delete(btn); return true; } return false; }
  consumeMouse() { const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel }; this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; return d; }
  endFrame() { this.pressedQ.clear(); this.mousePressed.clear(); }

  /**
   * El mando este fotograma (F10.5): `o` de PadLogic (o null: nada) y la vista en píxeles de ratón.
   * Sus teclas y clics se suman a los del teclado y el ratón hasta el final del fotograma.
   */
  setPad(o, dx = 0, dy = 0) {
    const P = this.pad;
    P.held.clear(); P.events.length = 0; P.left = P.right = false; P.move.x = P.move.z = 0;
    if (!o) return;
    for (const c of o.held) P.held.add(c);
    for (const c of o.press) this.pressedQ.add(c);
    for (const b of o.clicks) this.mousePressed.add(b);
    for (const e of o.events) P.events.push(e);
    P.left = o.mouse.left; P.right = o.mouse.right;
    P.move.x = o.move.x; P.move.z = o.move.z;
    this.mouse.dx += dx; this.mouse.dy += dy;
  }
  /** ¿Ha pedido el mando `name` este fotograma? (una vez) */
  padEvent(name) { const i = this.pad.events.indexOf(name); if (i < 0) return false; this.pad.events.splice(i, 1); return true; }
}

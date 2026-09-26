// Teclado y ratón con bloqueo de puntero. Asignaciones al estilo de Siege:
// WASD mover, Mayús correr, C agacharse, Z cuerpo a tierra, Q/E asomarse,
// Espacio saltar obstáculo, R recargar, F interactuar, G gadget secundario,
// X habilidad del operador, 1/2 armas, V cuerpo a cuerpo, T (o botón central) marcar,
// H órdenes a los aliados, B modo de disparo, I inspeccionar el arma, Tab marcador, P depuración.
export const BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', prone: 'KeyZ',
  leanLeft: 'KeyQ', leanRight: 'KeyE', vault: 'Space',
  reload: 'KeyR', interact: 'KeyF', gadget: 'KeyG', ability: 'KeyX',
  primary: 'Digit1', secondary: 'Digit2', melee: 'KeyV', drone: 'Digit5', mark: 'KeyT', orders: 'KeyH', fireMode: 'KeyB', inspect: 'KeyI',
  scoreboard: 'Tab', perf: 'F3', debug: 'KeyP',
};

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pressedQ = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 };
    this.mousePressed = new Set();
    this.locked = false;
    this.onLockChange = null;
    this.enabled = true;
    const kd = (e) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'F3', 'ShiftLeft', 'ControlLeft'].includes(e.code) || (this.locked && e.code.startsWith('Key'))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedQ.add(e.code);
      this.down.add(e.code);
    };
    const ku = (e) => { this.down.delete(e.code); };
    const mm = (e) => {
      if (!this.locked) return;
      // algunos navegadores disparan saltos gigantes al capturar el puntero
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    };
    const md = (e) => {
      if (!this.locked) return;
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
    const wh = (e) => { if (this.locked) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('wheel', wh, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; this.down.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { if (this.onLockChange) this.onLockChange(false, true); });
  }
  requestLock() {
    try {
      const p = this.target.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.target.requestPointerLock(); } catch (e) { /* sin bloqueo */ } });
    } catch (e) {
      try { this.target.requestPointerLock(); } catch (e2) { /* sin bloqueo */ }
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  isDown(action) { return this.down.has(BINDINGS[action]); }
  pressed(action) {
    const c = BINDINGS[action];
    if (this.pressedQ.has(c)) { this.pressedQ.delete(c); return true; }
    return false;
  }
  mouseClicked(btn) { if (this.mousePressed.has(btn)) { this.mousePressed.delete(btn); return true; } return false; }
  consumeMouse() { const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel }; this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; return d; }
  endFrame() { this.pressedQ.clear(); this.mousePressed.clear(); }
}

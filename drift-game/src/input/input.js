// Keyboard input. Driving keys are read as "held"; R and C fire once per press.

const BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  camera: ['KeyC'],
};

const ACTION_OF = new Map();
for (const [action, codes] of Object.entries(BINDINGS)) for (const code of codes) ACTION_OF.set(code, action);

export class Input {
  constructor() {
    this.keys = new Set(); // physical keys currently down
    this.pressed = new Set(); // actions pressed since last consumed

    window.addEventListener('keydown', (e) => {
      const action = ACTION_OF.get(e.code);
      if (!action) return;
      e.preventDefault(); // keep arrows/space from scrolling the page
      if (!e.repeat) this.pressed.add(action);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // keys released while the window is unfocused would otherwise stay stuck
    window.addEventListener('blur', () => this.keys.clear());
  }

  held(action) {
    return BINDINGS[action].some((code) => this.keys.has(code));
  }

  drive() {
    return {
      throttle: this.held('throttle') ? 1 : 0,
      brake: this.held('brake') ? 1 : 0,
      steer: (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0),
      handbrake: this.held('handbrake'),
    };
  }

  // true once per key press
  consume(action) {
    return this.pressed.delete(action);
  }
}

// Mando (F10.5): Xbox, PlayStation o compatible, con el mapeo estándar del navegador. Se lee cada
// fotograma y se traduce a lo mismo que el teclado y el ratón (teclas virtuales, clics y movimiento
// del ratón), así que el resto del juego no cambia. Botones, como Siege en consola:
//   stick izquierdo mover (al pulsarlo, correr) · stick derecho mirar (al pulsarlo, cuerpo a cuerpo)
//   RT disparar · LT apuntar · A saltar, rappel, ventana (mantener, si no había nada que hacer: inspeccionar)
//   B agacharse (mantener: tumbarse) · X recargar (mantener: interactuar) · Y cambiar de arma (mantener: dron o cámaras)
//   LB gadget · RB habilidad · cruceta ←/→ asomarse, ↑ marcar al soltar (mantener: modo de disparo, sin marcar),
//   ↓ órdenes · Start pausa · Select marcador
// En los menús, la cruceta o el stick mueven entre botones, A pulsa y B vuelve (padnav.js).
// Con un mando de PlayStation (Sony: 054c, DualSense, DualShock) los avisos dicen ✕ ○ □ △, L1/R1, L2/R2,
// Options y Share; con Xbox, A B X Y, LB/RB, LT/RT, Start y Select.

export const PAD = {
  dead: 0.15,          // zona muerta de los sticks (radial)
  lookMax: 3.4,        // rad/s girando con el stick derecho a tope (≈195°/s, con sensibilidad 1)
  lookExp: 2,          // respuesta del stick derecho: suave al principio, rápida al final
  pitchK: 0.75,        // el giro vertical, algo más lento que el horizontal
  trigger: 0.35,       // RT/LT cuentan a partir de aquí
  holdB: 0.35,         // s manteniendo B para tumbarse
  holdX: 0.3,          // s manteniendo X para interactuar
  holdY: 0.45,         // s manteniendo Y para el dron o las cámaras
  tapUp: 0.3, holdUp: 0.5,   // ▲: marca si se suelta antes de 0,3 s; a los 0,5 s, modo de disparo (y no marca)
  holdA: 0.5,          // s manteniendo A para inspeccionar (si al pulsarla no había nada que hacer)
  navFirst: 0.38, navRepeat: 0.14,   // repetición de la cruceta y el stick en los menús
};
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// Botones con una tecla fija: se mantiene mientras se mantiene el botón y se pulsa al apretarlo.
export const KEYMAP = [
  [BTN.LB, 'KeyG'], [BTN.RB, 'KeyX'], [BTN.R3, 'KeyV'],
  [BTN.DOWN, 'KeyH'], [BTN.LEFT, 'KeyQ'], [BTN.RIGHT, 'KeyE'], [BTN.SELECT, 'Tab'],
];

// Cómo se llama cada botón según el mando (lo que dicen los avisos y el panel de controles)
export const PAD_NAMES = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Start: 'Start', Select: 'Select', L3: 'L3', R3: 'R3', brand: 'Xbox' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', Start: 'Options', Select: 'Share', L3: 'L3', R3: 'R3', brand: 'PlayStation' },
};
export const padNames = (kind) => PAD_NAMES[kind] || PAD_NAMES.xbox;
/** Qué mando es por su nombre: 'ps' si es de Sony (054c, DualSense, DualShock, PlayStation); si no, 'xbox'. */
export const padKindOf = (id) => (/054c|dualsense|dualshock|playstation/i.test(id || '') ? 'ps' : 'xbox');
/** Un texto con nombres de botones de Xbox → los del mando `kind` (solo los botones, palabra a palabra). */
export const padWords = (s, kind) => (kind === 'ps' ? s.replace(/\b(A|B|X|Y|LB|RB|LT|RT|Start|Select)\b/g, (k) => PAD_NAMES.ps[k]) : s);

/** Un stick con zona muerta radial y respuesta `exp`: (x, y) en −1…1 → lo que cuenta, 0…1. */
export function stick(x, y, dead = PAD.dead, exp = 1) {
  const m = Math.hypot(x, y);
  if (!(m > dead)) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)), s = Math.pow(k, exp) / m;
  return [x * s, y * s];
}

/**
 * Lo que dice el mando en cada fotograma, sin navegador (se puede probar): `update(dt, pad)` con
 * `pad` = {buttons: [{pressed, value}], axes: [...]} (o null) devuelve
 * {touched, held: códigos mantenidos, press: códigos pulsados, events: ['crouch', 'prone', 'nextWeapon',
 * 'inspect', 'pause', 'select', 'dirLeft', 'dirRight'], clicks: botones del ratón, mouse: {left, right}, move: {x, z},
 * look: {x, y}, nav: ['up', 'down', 'left', 'right', 'accept', 'back']}. `touched`: se ha tocado
 * (un botón apretado ahora o un stick a más de la mitad; la deriva de un stick no cuenta).
 */
export class PadLogic {
  constructor() {
    this.prev = new Array(17).fill(false);
    this.ht = new Array(17).fill(-1);       // cuánto lleva apretado cada botón (−1: suelto)
    this.hf = new Array(17).fill(false);    // si ya hizo lo de mantener
    this.sprint = false;
    this.navDir = null; this.navT = 0;
    this.out = { touched: false, held: new Set(), press: [], events: [], clicks: [], mouse: { left: false, right: false }, move: { x: 0, z: 0 }, look: { x: 0, y: 0 }, nav: [] };
  }

  update(dt, pad) {
    const o = this.out;
    o.touched = false; o.held.clear(); o.press.length = 0; o.events.length = 0; o.clicks.length = 0; o.nav.length = 0;
    o.mouse.left = o.mouse.right = false; o.move.x = o.move.z = 0; o.look.x = o.look.y = 0;
    if (!pad) { this.prev.fill(false); this.ht.fill(-1); this.sprint = false; this.navDir = null; return o; }
    const B = pad.buttons || [], A = pad.axes || [];
    const val = (i) => { const b = B[i]; return !b ? 0 : typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : +b || 0; };
    const now = [];
    for (let i = 0; i < 17; i++) now[i] = i === BTN.LT || i === BTN.RT ? val(i) > PAD.trigger : val(i) > 0.5;
    const down = (i) => now[i] && !this.prev[i];
    // sticks: mover (lineal) y mirar (curva suave)
    const [mx, my] = stick(A[0] || 0, A[1] || 0);
    const [lx, ly] = stick(A[2] || 0, A[3] || 0, PAD.dead, PAD.lookExp);
    o.move.x = mx; o.move.z = -my;
    o.look.x = lx; o.look.y = ly;
    o.touched = now.some((v, i) => v && !this.prev[i]) || Math.hypot(A[0] || 0, A[1] || 0) > 0.5 || Math.hypot(A[2] || 0, A[3] || 0) > 0.5;
    // RT y LT, como los botones del ratón
    o.mouse.left = now[BTN.RT]; o.mouse.right = now[BTN.LT];
    if (down(BTN.RT)) o.clicks.push(0);
    if (down(BTN.LT)) o.clicks.push(2);
    for (const [i, code] of KEYMAP) { if (now[i]) o.held.add(code); if (down(i)) o.press.push(code); }
    // tocar o mantener
    this._tapHold(BTN.B, now, dt, PAD.holdB, () => o.events.push('crouch'), () => o.events.push('prone'));
    this._tapHold(BTN.X, now, dt, PAD.holdX, () => o.press.push('KeyR'), null, () => o.held.add('KeyF'));
    this._tapHold(BTN.Y, now, dt, PAD.holdY, () => o.events.push('nextWeapon'), () => o.press.push('Digit5'));
    // A: saltar, rappel o ventana al pulsar; mantenida, inspeccionar (si no había nada que hacer: lo decide el control)
    this._tapHold(BTN.A, now, dt, PAD.holdA, null, () => o.events.push('inspect'), null, PAD.holdA, () => o.press.push('Space'));
    // ▲: marcar al soltar (antes de 0,3 s); mantenida 0,5 s, el modo de disparo, y entonces no marca
    this._tapHold(BTN.UP, now, dt, PAD.holdUp, () => o.press.push('KeyT'), () => o.press.push('KeyB'), null, PAD.tapUp);
    // L3: correr hasta que se suelta el stick o se va hacia atrás
    if (down(BTN.L3)) this.sprint = !this.sprint;
    if (this.sprint && (Math.hypot(mx, my) < 0.3 || my > 0.2)) this.sprint = false;
    if (this.sprint) o.held.add('ShiftLeft');
    if (down(BTN.START)) o.events.push('pause');
    if (down(BTN.SELECT)) o.events.push('select');     // (en el campo de pruebas, que no tiene marcador: otro equipo)
    // menús: cruceta o stick (con repetición), A y B
    const dir = now[BTN.UP] || my < -0.55 ? 'up' : now[BTN.DOWN] || my > 0.55 ? 'down' : now[BTN.LEFT] || mx < -0.55 ? 'left' : now[BTN.RIGHT] || mx > 0.55 ? 'right' : null;
    if (dir !== this.navDir) {
      this.navDir = dir; this.navT = PAD.navFirst;
      if (dir) o.nav.push(dir);
      if (dir === 'left' || dir === 'right') o.events.push(dir === 'left' ? 'dirLeft' : 'dirRight');   // (las cámaras)
    }
    else if (dir) { this.navT -= dt; if (this.navT <= 0) { this.navT = PAD.navRepeat; o.nav.push(dir); } }
    if (down(BTN.A)) o.nav.push('accept');
    if (down(BTN.B)) o.nav.push('back');
    this.prev = now;
    return o;
  }

  // Lo que está apretado ahora no cuenta al soltarlo (la B que cierra un menú no agacha después).
  swallow() { for (const i of [BTN.A, BTN.B, BTN.X, BTN.Y, BTN.UP]) if (this.ht[i] >= 0) this.hf[i] = true; }

  // Un botón que hace una cosa al tocarlo (al soltar antes de `tapMax` s) y otra al mantenerlo
  // (una vez, al cumplir `hold` s); `whileHeld`, cada fotograma desde entonces; `onDown`, al apretarlo.
  _tapHold(i, now, dt, hold, onTap, onHold, whileHeld = null, tapMax = hold, onDown = null) {
    if (now[i]) {
      if (this.ht[i] < 0) { this.ht[i] = 0; this.hf[i] = false; if (onDown) onDown(); } else this.ht[i] += dt;
      if (!this.hf[i] && this.ht[i] >= hold - 1e-9) { this.hf[i] = true; if (onHold) onHold(); }
      if (this.hf[i] && whileHeld) whileHeld();
    } else if (this.ht[i] >= 0) {
      if (!this.hf[i] && this.ht[i] < tapMax - 1e-9 && onTap) onTap();
      this.ht[i] = -1;
    }
  }
}

// Los avisos del juego nombran teclas («Pulsa Espacio», «Mantén F», «5 dron»); jugando con el mando se
// enseñan sus botones. Una sola pasada: lo que ya era un botón del mando no se vuelve a traducir.
const PAD_TEXT = [
  ['WASD', 'Stick izq.'], ['Espacio', 'A'],
  ['Mantén F', 'Mantén X'], ['Pulsa F', 'Mantén X'], ['<kbd>F</kbd>', '<kbd>X</kbd>'], ['Pulsa R', 'Pulsa X'],
  ['Clic derecho/T', '▲'], ['Clic/T', 'RT/▲'], ['Clic/X', 'RT/RB'], ['<kbd>Clic</kbd>', '<kbd>RT</kbd>'], ['Clic para', 'RT para'], ['clic para', 'RT para'],
  ['<kbd>T</kbd>', '<kbd>▲</kbd>'], ['Mantén <kbd>H</kbd>', 'Mantén <kbd>▼</kbd>'], ['H órdenes', '▼ órdenes'],
  ['<kbd>G</kbd>', '<kbd>LB</kbd>'], ['<kbd>X</kbd>', '<kbd>RB</kbd>'], ['<kbd>V</kbd>', '<kbd>R3</kbd>'], ['V golpe', 'R3 golpe'],
  ['<kbd>5</kbd>', 'mantén <kbd>Y</kbd>:'], ['5 dron', 'mantén Y: dron'], ['5 cámaras', 'mantén Y: cámaras'], ['5 volver', 'mantén Y: volver'], ['5 observar', 'mantén Y: observar'], ['5 para lanzar', 'mantén Y para lanzar'],
  ['<kbd>Tab</kbd>', '<kbd>Select</kbd>'], ['<kbd>L</kbd>', '<kbd>Select</kbd>'], ['<kbd>1</kbd>–<kbd>4</kbd>', '<kbd>Y</kbd>'],
  ['A/D cambiar', '◀/▶ cambiar'], ['Q/E otro', '◀/▶ otro'], ['· S para bajar', '· stick atrás para bajar'],
  ['<small>Intro</small>', '<small>Start</small>'], ['(clic o teclas 1–8)', '(A, con la cruceta o el stick)'],
];
const PAD_MAP = { xbox: new Map(PAD_TEXT), ps: new Map(PAD_TEXT.map(([k, v]) => [k, padWords(v, 'ps')])) };
const PAD_RE = new RegExp(PAD_TEXT.map(([k]) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'g');
/** Un aviso con teclas → el mismo con los botones del mando (`kind`: 'xbox' o 'ps'). */
export function padText(s, kind = 'xbox') { const M = PAD_MAP[kind] || PAD_MAP.xbox; return s ? s.replace(PAD_RE, (k) => M.get(k)) : s; }

/** El mando en el navegador: lo lee, lo aplica a la entrada y vibra. */
export class Gamepad {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.logic = new PadLogic();
    this.pad = null;
    this.kind = 'xbox';        // 'xbox' o 'ps' (por el nombre del mando): cómo se llaman sus botones
    this.onActive = null;      // al empezar a usarlo
  }
  read() {
    let list = [];
    try { list = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads() || []) : []; } catch (e) { list = []; }
    this.pad = list.find((p) => p && p.connected && (p.mapping === 'standard' || (p.buttons && p.buttons.length >= 16))) || null;
    if (this.pad) this.kind = padKindOf(this.pad.id);
    return this.pad;
  }
  get names() { return padNames(this.kind); }
  /**
   * Cada fotograma: lee el mando y, si `play` (jugando, sin menú ni pausa), lo aplica a la entrada
   * como teclado y ratón. Devuelve lo que dijo (los menús y la pausa usan `nav` y `events`).
   */
  poll(dt, play) {
    const o = this.logic.update(dt, this.read()), I = this.input, S = this.settings;
    I.padKind = this.kind;
    if (o.touched && !I.padActive) { I.padActive = true; if (this.onActive) this.onActive(); }
    if (!play) { this.logic.swallow(); I.setPad(null); return o; }
    // el stick derecho, en «píxeles de ratón» (cada sitio que mira con el ratón lo convierte igual)
    const base = 0.0022 * (S.sensitivity || 1);
    const k = (PAD.lookMax * (S.padSens || 1) * dt) / base;
    const inv = (S.padInvertY ? -1 : 1) * (S.invertY ? -1 : 1);   // (deshace el invertir del ratón)
    I.setPad(o, o.look.x * k, o.look.y * k * PAD.pitchK * inv);
    return o;
  }
  /** Vibración (si el mando la tiene, está activada en Opciones y se está jugando con él). */
  rumble(strong, weak, ms) {
    if (!this.settings.padRumble || !this.input.padActive) return false;
    const a = this.pad && this.pad.vibrationActuator;
    if (!a || !a.playEffect) return false;
    try {
      const p = a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) });
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }
}

// F10.5 · Mando: lo que dice cada botón y cada stick, cómo entra en la entrada del juego (como teclas,
// clics y ratón) y cómo se mueve el foco por los menús. (En el navegador, con un mando simulado:
// tools/smoke-mando.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';

// la entrada registra sus eventos en la ventana: aquí basta con que existan
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.document = globalThis.document || { addEventListener() {}, pointerLockElement: null };
const { PadLogic, PAD, BTN, stick } = await import('../src/input/gamepad.js');
const { Input } = await import('../src/input/input.js');
const { PlayerControl } = await import('../src/client/control.js');
const { pickDir } = await import('../src/input/padnav.js');

const DT = 1 / 60;
// un mando: botones apretados (índices) y ejes
const pad = (pressed = [], axes = [0, 0, 0, 0], analog = {}) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: analog[i] !== undefined ? analog[i] : pressed.includes(i) ? 1 : 0 })),
  axes,
});
// mantener un mando `secs` segundos; devuelve todo lo que dijo
const hold = (L, p, secs) => {
  const all = { press: [], events: [], clicks: [], nav: [] };
  for (let t = 0; t < secs - 1e-9; t += DT) {
    const o = L.update(DT, p);
    all.press.push(...o.press); all.events.push(...o.events); all.clicks.push(...o.clicks); all.nav.push(...o.nav);
  }
  return all;
};

test('los sticks: zona muerta del 15 % y respuesta suave en el derecho', () => {
  assert.deepEqual(stick(0.1, 0.1), [0, 0]);                 // dentro de la zona muerta
  assert.deepEqual(stick(0.14, 0), [0, 0]);
  const [x] = stick(1, 0);
  assert.ok(Math.abs(x - 1) < 1e-9, 'a tope no llega a 1');
  // justo fuera de la zona muerta empieza en 0 (sin salto)
  assert.ok(stick(0.16, 0)[0] < 0.02);
  // la curva del derecho: a media palanca, bastante menos de la mitad (apuntar fino)
  const half = stick(0.575, 0, PAD.dead, PAD.lookExp)[0], lin = stick(0.575, 0)[0];
  assert.ok(Math.abs(lin - 0.5) < 0.01 && half < 0.3, `${half}`);
  // radial: en diagonal, la misma magnitud
  const [dx, dy] = stick(0.6, 0.6), m = Math.hypot(dx, dy);
  assert.ok(Math.abs(m - stick(Math.hypot(0.6, 0.6), 0)[0]) < 1e-9);
});

test('los botones del mapeo', () => {
  const L = new PadLogic();
  let o = L.update(DT, pad([BTN.RT], [0, 0, 0, 0], { [BTN.RT]: 0.8 }));
  assert.ok(o.mouse.left && !o.mouse.right && o.clicks.includes(0), 'RT no dispara');
  o = L.update(DT, pad([], [0, 0, 0, 0], { [BTN.RT]: 0.2 }));
  assert.ok(!o.mouse.left, 'RT cuenta por debajo del umbral');
  o = L.update(DT, pad([BTN.LT]));
  assert.ok(o.mouse.right && o.clicks.includes(2), 'LT no apunta');
  const keys = { [BTN.A]: 'Space', [BTN.LB]: 'KeyG', [BTN.RB]: 'KeyX', [BTN.R3]: 'KeyV', [BTN.UP]: 'KeyT', [BTN.DOWN]: 'KeyH', [BTN.LEFT]: 'KeyQ', [BTN.RIGHT]: 'KeyE', [BTN.SELECT]: 'Tab' };
  for (const [b, code] of Object.entries(keys)) {
    const M = new PadLogic();
    o = M.update(DT, pad([+b]));
    assert.ok(o.held.has(code) && o.press.includes(code), `${b} → ${code}`);
    o = M.update(DT, pad([+b]));
    assert.ok(o.held.has(code) && !o.press.includes(code), `${b}: se pulsa una vez`);
  }
  // Start: pausa; Select, además del marcador, «select» (el campo de pruebas cambia de equipo)
  assert.ok(new PadLogic().update(DT, pad([BTN.START])).events.includes('pause'));
  assert.ok(new PadLogic().update(DT, pad([BTN.SELECT])).events.includes('select'));
});

test('tocar o mantener: B agacharse/tumbarse, X recargar/interactuar, Y arma/dron', () => {
  // B: tocar → agacharse (al soltar); mantener → tumbarse (una vez, sin agacharse al soltar)
  let L = new PadLogic();
  let a = hold(L, pad([BTN.B]), 0.15); a.events.push(...hold(L, pad(), DT).events);
  assert.deepEqual(a.events, ['crouch']);
  L = new PadLogic();
  a = hold(L, pad([BTN.B]), 0.6); a.events.push(...hold(L, pad(), DT).events);
  assert.deepEqual(a.events, ['prone']);
  // X: tocar → R; mantener → F mientras se mantiene (y no recarga)
  L = new PadLogic();
  a = hold(L, pad([BTN.X]), 0.1); a.press.push(...hold(L, pad(), DT).press);
  assert.deepEqual(a.press, ['KeyR']);
  L = new PadLogic();
  hold(L, pad([BTN.X]), 0.5);
  let o = L.update(DT, pad([BTN.X]));
  assert.ok(o.held.has('KeyF'), 'mantener X no interactúa');
  o = L.update(DT, pad());
  assert.ok(!o.held.has('KeyF') && !o.press.includes('KeyR'), 'al soltar X tras mantener, recarga');
  // Y: tocar → cambiar de arma; mantener → dron o cámaras (tecla 5)
  L = new PadLogic();
  a = hold(L, pad([BTN.Y]), 0.1); a.events.push(...hold(L, pad(), DT).events);
  assert.deepEqual(a.events, ['nextWeapon']);
  L = new PadLogic();
  a = hold(L, pad([BTN.Y]), 0.7); a.press.push(...hold(L, pad(), DT).press);
  assert.deepEqual(a.press, ['Digit5']);
  assert.ok(PAD.holdB >= 0.3 && PAD.holdX >= 0.25 && PAD.holdY >= 0.4);
});

test('un botón apretado mientras hay un menú no hace nada al soltarlo', () => {
  const L = new PadLogic();
  hold(L, pad([BTN.B]), 0.1);
  L.swallow();                          // (se abrió o cerró un menú con esa B)
  hold(L, pad([BTN.B]), 0.05);
  const a = hold(L, pad(), DT);
  assert.deepEqual(a.events, [], 'la B del menú agacha al soltarla');
  // y la siguiente pulsación vuelve a contar
  const b = hold(L, pad([BTN.B]), 0.1); b.events.push(...hold(L, pad(), DT).events);
  assert.deepEqual(b.events, ['crouch']);
});

test('correr con L3: hasta soltar el stick o ir hacia atrás', () => {
  const L = new PadLogic();
  let o = L.update(DT, pad([BTN.L3], [0, -1, 0, 0]));
  assert.ok(o.held.has('ShiftLeft') && o.move.z > 0.99);
  o = L.update(DT, pad([], [0, -1, 0, 0]));
  assert.ok(o.held.has('ShiftLeft'), 'soltar L3 deja de correr');
  o = L.update(DT, pad([], [0, 0.6, 0, 0]));
  assert.ok(!o.held.has('ShiftLeft'), 'hacia atrás sigue corriendo');
  o = L.update(DT, pad([], [0, -1, 0, 0]));
  assert.ok(!o.held.has('ShiftLeft'), 'vuelve a correr solo');
});

test('los menús: cruceta o stick con repetición, A y B; tocar no es la deriva de un stick', () => {
  const L = new PadLogic();
  let a = hold(L, pad([BTN.DOWN]), 1.0);
  const downs = a.nav.filter((n) => n === 'down').length;
  // 1 al pulsar y luego una cada 0,14 s pasada la primera espera (0,38 s)
  assert.ok(downs >= 4 && downs <= 7, `${downs}`);
  hold(L, pad(), 0.1);
  a = hold(L, pad([], [0.9, 0, 0, 0]), DT);
  assert.deepEqual(a.nav, ['right']);
  assert.ok(a.events.includes('dirRight'), 'sin aviso para las cámaras');
  hold(L, pad(), 0.1);
  assert.deepEqual(L.update(DT, pad([BTN.A])).nav, ['accept']);
  hold(L, pad(), 0.1);
  assert.ok(L.update(DT, pad([BTN.B])).nav.includes('back'));
  // tocar: un botón apretado ahora o un stick a más de la mitad; la deriva (0,3) no cuenta
  const M = new PadLogic();
  assert.equal(M.update(DT, pad([], [0.3, 0.2, 0, 0.3])).touched, false);
  assert.equal(M.update(DT, pad([BTN.A])).touched, true);
  assert.equal(M.update(DT, pad([BTN.A])).touched, false, 'mantener no es tocar otra vez');
  assert.equal(M.update(DT, pad([], [0, 0, 0.8, 0])).touched, true);
  // sin mando: nada
  const o = M.update(DT, null);
  assert.ok(!o.touched && !o.held.size && !o.nav.length && o.move.x === 0);
});

test('la entrada: el mando suma teclas, gatillos, stick y ratón; el teclado y el ratón siguen igual', () => {
  const I = new Input({});
  // sin mando, como siempre
  I.down.add('KeyW'); I.pressedQ.add('KeyR'); I.mouse.left = true;
  assert.ok(I.isDown('forward') && I.pressed('reload') && I.mouse.left && !I.mouse.right);
  I.mouse.left = false; I.down.clear();
  assert.ok(!I.mouse.left);
  // con el mando
  const L = new PadLogic();
  const o = L.update(DT, pad([BTN.RT, BTN.A, BTN.LB], [0.5, -1, 0, 0]));
  I.setPad(o, 12, -3);
  assert.ok(I.mouse.left && I.isDown('vault') && I.pressed('vault') && I.pressed('gadget'));
  assert.ok(I.mouseClicked(0));
  assert.ok(I.pad.move.z > 0.85 && I.pad.move.x > 0.4, JSON.stringify(I.pad.move));   // (en diagonal, normalizado)
  const m = I.consumeMouse();
  assert.ok(m.dx === 12 && m.dy === -3);
  I.endFrame();
  assert.ok(!I.pressed('vault') && !I.mouseClicked(0), 'lo pulsado dura un fotograma');
  // sin mando otra vez: se suelta todo
  I.setPad(null);
  assert.ok(!I.mouse.left && !I.isDown('vault') && I.pad.move.z === 0);
  // con el mando, no se pide capturar el ratón
  let asked = 0;
  const J = new Input({ requestPointerLock() { asked++; } });
  J.padActive = true; J.requestLock();
  J.padActive = false; J.requestLock();
  assert.equal(asked, 1);
});

test('el control: stick analógico, B y la postura, Y cambia de arma (y sin mando, igual que antes)', () => {
  const settings = { sensitivity: 1, adsSensitivity: 0.8, invertY: false, crouchToggle: false, leanToggle: true };
  const I = new Input({});
  const C = new PlayerControl({ input: I, settings });
  const op = { intent: {}, state: 'alive', ads: 0, yaw: 0, pitch: 0, weapons: [{}, {}], weaponIndex: 0, weapon: { def: { adsZoom: 1 } }, gadget: null, ability: null };
  const L = new PadLogic();
  // a media palanca hacia delante y un poco a la derecha: movimiento analógico
  I.setPad(L.update(DT, pad([], [0.3, -0.6, 0, 0])));
  C.apply(op, true);
  assert.ok(op.intent.moveZ > 0.4 && op.intent.moveZ < 0.7 && op.intent.moveX > 0.1 && op.intent.moveX < 0.35, JSON.stringify(op.intent));
  // B tocado: agachado; y con C «mantener», soltar C no lo levanta
  I.setPad(L.update(DT, pad([BTN.B])));
  C.apply(op, true);
  I.setPad(L.update(DT, pad()));
  C.apply(op, true);
  assert.equal(op.intent.stance, 'crouch');
  for (let i = 0; i < 5; i++) { I.setPad(L.update(DT, pad())); C.apply(op, true); }
  assert.equal(op.intent.stance, 'crouch', 'se levanta solo');
  // B otra vez: de pie; mantener B: cuerpo a tierra
  I.setPad(L.update(DT, pad([BTN.B]))); C.apply(op, true);
  I.setPad(L.update(DT, pad())); C.apply(op, true);
  assert.equal(op.intent.stance, 'stand');
  for (let t = 0; t < 0.5; t += DT) { I.setPad(L.update(DT, pad([BTN.B]))); C.apply(op, true); }
  assert.equal(op.intent.stance, 'prone');
  I.setPad(L.update(DT, pad())); C.apply(op, true);
  // Y tocado: la otra arma
  I.setPad(L.update(DT, pad([BTN.Y]))); C.apply(op, true);
  I.setPad(L.update(DT, pad())); op.intent.switchTo = undefined; C.apply(op, true);
  assert.equal(op.intent.switchTo, 1);
  // el stick derecho mira (los píxeles de ratón del mando)
  I.setPad(L.update(DT, pad([], [0, 0, 1, 0])), 20, 0);
  const y0 = op.yaw; C.apply(op, true);
  assert.ok(op.yaw < y0, 'a la derecha no gira');
  // sin mando: C «mantener» como siempre (soltar C levanta)
  I.setPad(null);
  const K = new PlayerControl({ input: I, settings });
  I.down.add('KeyC'); K.apply(op, true); assert.equal(op.intent.stance, 'crouch');
  I.down.clear(); K.apply(op, true); assert.equal(op.intent.stance, 'stand');
  I.down.add('KeyW'); I.down.add('KeyD'); K.apply(op, true);
  assert.ok(op.intent.moveZ === 1 && op.intent.moveX === 1);
});

test('el foco en los menús va al vecino de esa dirección', () => {
  // el menú principal: dos botones anchos, tres desplegables en fila y ajustes de ancho completo
  const R = (x, y, w, h) => ({ x, y, w, h });
  const match = R(0, 0, 400, 50), range = R(0, 60, 400, 50);
  const side = R(0, 130, 120, 40), diff = R(140, 130, 120, 40), time = R(280, 130, 120, 40);
  const sens = R(0, 200, 400, 30), vol = R(0, 240, 400, 30);
  const all = [match, range, side, diff, time, sens, vol];
  const go = (from, dir) => all[pickDir(from, all, dir)];
  assert.equal(go(match, 'down'), range);
  assert.equal(go(range, 'down'), side, 'del botón ancho, al primero de la fila');
  assert.equal(go(side, 'right'), diff);
  assert.equal(go(diff, 'right'), time);
  assert.equal(pickDir(time, all, 'right'), -1, 'no hay nada más a la derecha');
  assert.equal(go(diff, 'down'), sens);
  assert.equal(go(sens, 'down'), vol);
  assert.equal(go(sens, 'up').y, 130);
  assert.equal(go(range, 'up'), match);
  assert.equal(pickDir(match, all, 'up'), -1);
  // una rejilla de 4×2 (operadores): abajo, al de debajo; no al de al lado
  const g = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g.push(R(c * 110, r * 130, 100, 120));
  assert.equal(pickDir(g[1], g, 'down'), 5);
  assert.equal(pickDir(g[5], g, 'up'), 1);
  assert.equal(pickDir(g[3], g, 'right'), -1);
  assert.equal(pickDir(g[4], g, 'right'), 5);
});

test('los avisos con teclas, con los botones del mando (una sola pasada)', async () => {
  const { padText } = await import('../src/input/gamepad.js');
  assert.equal(padText('Pulsa Espacio para hacer rappel'), 'Pulsa A para hacer rappel');
  assert.equal(padText('Pulsa Espacio para subir al tejado · S para bajar'), 'Pulsa A para subir al tejado · stick atrás para bajar');
  assert.equal(padText('Mantén F para plantar el desactivador · sitio A'), 'Mantén X para plantar el desactivador · sitio A');
  assert.equal(padText('Pulsa F junto a él para recogerlo'), 'Mantén X junto a él para recogerlo');
  assert.equal(padText('Pulsa R para volver a empezar'), 'Pulsa X para volver a empezar');
  assert.equal(padText('Te desangras: 5 s. Mantén F para presionar la herida.'), 'Te desangras: 5 s. Mantén X para presionar la herida.');
  assert.equal(padText('Observarás a tus compañeros · 5 drones'), 'Observarás a tus compañeros · mantén Y: drones');
  assert.equal(padText('Observando a <b>RADAR</b> · clic para cambiar · 5 cámaras'), 'Observando a <b>RADAR</b> · RT para cambiar · mantén Y: cámaras');
  assert.equal(padText('WASD mover · Espacio saltar · Clic/T marcar · Q/E otro dron · 5 volver'), 'Stick izq. mover · A saltar · RT/▲ marcar · ◀/▶ otro dron · mantén Y: volver');
  assert.equal(padText('A/D cambiar de cámara · Clic/T marcar · 5 observar'), '◀/▶ cambiar de cámara · RT/▲ marcar · mantén Y: observar');
  assert.equal(padText('Clic/X rayo <b>2</b> · Clic derecho/T marcar'), 'RT/RB rayo <b>2</b> · ▲ marcar');
  // la habilidad (X) pasa a RB y F pasa a X sin que ese X vuelva a cambiar
  assert.equal(padText('<span><kbd>X</kbd>Humo</span><span><kbd>G</kbd>Granada</span><span><kbd>F</kbd>Refuerzos</span>'), '<span><kbd>RB</kbd>Humo</span><span><kbd>LB</kbd>Granada</span><span><kbd>X</kbd>Refuerzos</span>');
  assert.equal(padText('<span>5 dron · V golpe</span><span class="ord">H órdenes · <b>Seguidme</b></span>'), '<span>mantén Y: dron · R3 golpe</span><span class="ord">▼ órdenes · <b>Seguidme</b></span>');
  assert.equal(padText('Listo <small>Intro</small>'), 'Listo <small>Start</small>');
  assert.equal(padText('mantén <kbd>F</kbd> dentro del sitio · <kbd>T</kbd> marca · Mantén <kbd>H</kbd> órdenes · <kbd>Tab</kbd> marcador · <kbd>5</kbd> cámaras'), 'mantén <kbd>X</kbd> dentro del sitio · <kbd>▲</kbd> marca · Mantén <kbd>▼</kbd> órdenes · <kbd>Select</kbd> marcador · mantén <kbd>Y</kbd>: cámaras');
  // lo que no es una tecla no cambia
  assert.equal(padText('Reforzando la pared · 5 refuerzos · RADAR'), 'Reforzando la pared · 5 refuerzos · RADAR');
  assert.equal(padText(''), '');
});

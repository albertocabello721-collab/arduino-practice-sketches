// F10.2a · Rappel en la Villa: tramos marcados en las fachadas; engancharse desde el suelo o desde
// el tejado; subir a 1,5 m/s, bajar a 2,5 m/s y de lado a 1 m/s sin salir del tramo; arriba, al
// tejado; delante de una ventana, dentro (rompiendo la barricada y el cristal); soltarse con C; se
// dispara colgado con la dispersión de andar; sin gadgets; solo quien pueda (el ataque en la acción,
// personas y bots desde la F10.2b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Rappel, RAPPEL } from '../src/sim/rappel.js';
import { Fortify, barricadeState } from '../src/sim/fortify.js';
import { Gadgets } from '../src/sim/gadgets.js';
import { Match } from '../src/sim/match.js';
import { boxFree, STANCES } from '../src/sim/physics.js';
import { MAT, GLASS } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
const win = (axis, line, center, level) => map.windows.find((w) => w.axis === axis && Math.abs(w.line - line) < 0.01 && Math.abs(w.center - center) < 0.01 && w.level === level);

// Un atacante (y quien haga falta) en un mundo limpio, con rappel para quien diga `who`.
function setup(who = (op) => op.team === 0, seed = 3) {
  world.resetToPristine();
  const g = new Game({ world, map, seed });
  const rp = new Rappel(g, { canRappel: who });
  const fort = new Fortify(g, { canFortify: () => true });
  const op = g.addOperator(new Operator('a', { team: 0, loadout: ['ar', 'pistol'] }));
  const events = [];
  for (const k of ['rappelHook', 'rappelOff', 'rappelBreach', 'rappelGlass', 'footstep', 'vault', 'rappelSlide']) g.on(k, (...a) => events.push([k, ...a]));
  return { g, rp, fort, op, events };
}
function place(op, x, y, z, yaw = 0, pitch = 0) {
  op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
  op.yaw = yaw; op.pitch = pitch;
}
// Vaciar el hueco de una ventana: el cristal y/o la barricada (las ventanas empiezan con las dos).
function clearOpening(w, { glass = false, wood = false }) {
  for (let y = w.y0 + 0.06; y < w.y1; y += 0.125) for (let x = w.center - w.width / 2 + 0.06; x < w.center + w.width / 2; x += 0.125) {
    for (const z of [w.line - 0.06, w.line + 0.06]) {
      const m = world.getWorld(x, y, z);
      if ((glass && GLASS[m]) || (wood && m === MAT.BARRICADE)) world.setRaw(world.vx(x), world.vy(y), world.vz(z), MAT.AIR);
    }
  }
}
function run(g, s, each) { for (let i = 0; i < Math.round(s / TICK); i++) { if (each) each(); g.tick(); } }
function settle(g, op) { run(g, 0.3); assert.ok(op.body.onGround, 'en el suelo'); }
const press = (op, k) => { op.intent[k] = true; };
// mirando a la fachada sur (hacia +z) desde la calle, y hacia fuera (−z) desde el tejado
const FACE_S = Math.PI, OUT_S = 0;

test('los tramos: siete, marcados con argollas, y el cuerpo cuelga fuera de todo lo que sobresale', () => {
  const { rp } = setup();
  assert.equal(rp.segs.length, 7);
  for (const s of rp.segs) {
    assert.ok(s.face > 0.1 && s.face < 0.3, `${s.id}: lo que sobresale ${s.face}`);
    for (let x = s.a + RAPPEL.edge; x <= s.b - RAPPEL.edge; x += 0.5) {
      for (let y = s.bottom + 0.3; y <= s.top - STANCES.stand.eye + RAPPEL.headOver; y += 0.5) {
        const p = rp.posAt(s, x, y);
        assert.ok(boxFree(world, p.x, p.y, p.z, 0.28, 1.8), `${s.id}: libre en ${x.toFixed(1)}, ${y.toFixed(1)}`);
      }
    }
  }
});

test('desde la calle: Espacio engancha (0,5 s); W sube a 1,5 m/s, S baja a 2,5 m/s, A/D de lado a 1 m/s y no sale del tramo', () => {
  const { g, rp, op, events } = setup();
  // fachada sur, entre las ventanas de la planta baja (x 3 y 8,5)
  place(op, 6, 0, -1.0, FACE_S);
  settle(g, op);
  assert.equal(rp.hint(op), 'Pulsa Espacio para hacer rappel');
  press(op, 'vault');
  run(g, RAPPEL.hookGround + 0.05);
  assert.ok(op.rappel && op.rappel.phase === 'hang', 'colgado');
  assert.ok(events.some((e) => e[0] === 'rappelHook'));
  const y0 = op.body.pos.y;
  run(g, 2, () => { op.intent.moveZ = 1; });
  assert.ok(Math.abs(op.body.pos.y - y0 - 3.0) < 0.05, `sube 3 m en 2 s (${(op.body.pos.y - y0).toFixed(2)})`);
  const y1 = op.body.pos.y;
  run(g, 0.5, () => { op.intent.moveZ = -1; });
  assert.ok(Math.abs(y1 - op.body.pos.y - 1.25) < 0.05, `baja 1,25 m en 0,5 s (${(y1 - op.body.pos.y).toFixed(2)})`);
  // A/D: mirando a la pared sur (+z), la derecha es −x
  const x0 = op.body.pos.x;
  run(g, 1, () => { op.intent.moveZ = 0; op.intent.moveX = 1; });
  assert.ok(Math.abs(x0 - op.body.pos.x - 1.0) < 0.05, `D: 1 m a la derecha (${(x0 - op.body.pos.x).toFixed(2)})`);
  run(g, 12, () => { op.intent.moveX = 1; });
  const seg = op.rappel.seg;
  assert.ok(Math.abs(op.body.pos.x - (seg.a + RAPPEL.edge)) < 1e-6, 'se para en el extremo del tramo');
  // se oyen los pasos en la pared
  assert.ok(events.filter((e) => e[0] === 'footstep' && e[1] === op).length >= 5);
  // abajo del todo, de pie en la calle
  run(g, 4, () => { op.intent.moveX = 0; op.intent.moveZ = -1; });
  assert.equal(op.rappel, null, 'suelta al llegar al suelo');
  run(g, 0.3, () => { op.intent.moveZ = 0; });
  assert.ok(op.body.onGround && Math.abs(op.body.pos.y) < 0.05, 'de pie en la calle');
});

test('arriba: la cabeza asoma por el pretil y Espacio sube al tejado (0,8 s); desde el tejado, Espacio en el pretil engancha (1 s)', () => {
  const { g, rp, op } = setup();
  place(op, 24, 0, -1.0, FACE_S);
  settle(g, op);
  press(op, 'vault');
  run(g, RAPPEL.hookGround + 0.05);
  run(g, 6, () => { op.intent.moveZ = 1; });
  const seg = op.rappel.seg;
  const eyeY = op.body.pos.y + STANCES.stand.eye;
  assert.ok(Math.abs(eyeY - (seg.top + RAPPEL.headOver)) < 0.02, `los ojos, sobre el pretil (${eyeY.toFixed(2)})`);
  assert.match(rp.hint(op), /subir al tejado/);
  op.intent.moveZ = 0;
  press(op, 'vault');
  run(g, RAPPEL.climbTop + 0.4);
  assert.equal(op.rappel, null);
  assert.ok(op.body.onGround && Math.abs(op.body.pos.y - 7.0) < 0.05 && op.body.pos.z > 0.5, `en el tejado (${op.body.pos.y.toFixed(2)}, z ${op.body.pos.z.toFixed(2)})`);
  // de vuelta: junto al pretil, mirando hacia fuera
  place(op, 24, 7.0, 0.8, OUT_S);
  settle(g, op);
  assert.equal(rp.hint(op), 'Pulsa Espacio para hacer rappel');
  press(op, 'vault');
  run(g, RAPPEL.hookTop - 0.1);
  assert.ok(op.rappel && op.rappel.phase === 'hookTop', 'aún enganchándose');
  run(g, 0.2);
  assert.ok(op.rappel && op.rappel.phase === 'hang' && op.body.pos.z < -0.4, 'colgado fuera');
});

test('en el pretil, Espacio hace rappel en vez de saltar al vacío; al pie de una ventana baja, Espacio la salta como siempre', () => {
  const { g, op } = setup();
  place(op, 6, 7.0, 0.8, OUT_S);
  settle(g, op);
  op.intent.vault = true; g.tick();
  assert.ok(op.rappel && !op.vault, 'rappel, no salto');
  // ventana de la planta baja de la fachada sur en x = 3: se salta
  const w = win('x', 0, 3, '1');
  assert.ok(w, 'la ventana');
  const { g: g2, op: op2 } = setup();
  // (sin cristal ni barricada: con ellos no se salta, como siempre)
  clearOpening(w, { glass: true, wood: true });
  place(op2, 3, 0, -0.75, FACE_S);
  settle(g2, op2);
  op2.intent.vault = true; g2.tick();
  assert.ok(op2.vault && !op2.rappel, 'salta la ventana');
});

test('ventana de la planta alta: Espacio entra (0,6 s) rompiendo el cristal; con barricada, la rompe al entrar (1,2 s, con ruido)', () => {
  // habitación infantil, fachada sur, ventana en x = 3 de la planta alta
  const w = win('x', 0, 3, '2');
  assert.ok(w && w.y0 > 4, 'ventana de la planta alta');
  for (const barricade of [false, true]) {
    const { g, rp, fort, op, events } = setup();
    // (las ventanas empiezan con barricada: sin ella, se quita)
    if (!barricade) clearOpening(w, { wood: true });
    assert.equal(barricadeState(world, w).wood > 0.5, barricade);
    place(op, 3, 0, -1.0, FACE_S);
    settle(g, op);
    press(op, 'vault');
    run(g, RAPPEL.hookGround + 0.05);
    // subir hasta tener la ventana a la altura de las rodillas
    run(g, 5, () => { op.intent.moveZ = op.body.pos.y < w.y0 - 0.5 ? 1 : 0; });
    op.intent.moveZ = 0;
    assert.ok(rp.windowAt(op) === w, 'la ventana delante');
    assert.match(rp.hint(op), barricade ? /romper la barricada/ : /entrar por la ventana/);
    press(op, 'vault');
    const dur = barricade ? RAPPEL.breach : RAPPEL.enter;
    run(g, dur - 0.1);
    assert.ok(op.rappel, 'aún entrando');
    run(g, 0.35);
    assert.equal(op.rappel, null);
    assert.ok(Math.abs(op.body.pos.y - 3.5) < 0.1 && op.body.pos.z > 0.4, `dentro, en la planta alta (${op.body.pos.y.toFixed(2)}, z ${op.body.pos.z.toFixed(2)})`);
    assert.equal(map.roomAt(op.body.pos.x, op.body.pos.y + 0.3, op.body.pos.z).name, 'Habitación infantil');
    assert.equal(barricadeState(world, w).wood, 0, 'sin barricada');
    let glass = 0;
    for (let y = w.y0 + 0.06; y < w.y1; y += 0.125) for (let x = w.center - w.width / 2 + 0.06; x < w.center + w.width / 2; x += 0.125) for (const z of [-0.06, 0.06]) if (GLASS[world.getWorld(x, y, z)]) glass++;
    assert.equal(glass, 0, 'sin cristal');
    assert.equal(events.some((e) => e[0] === 'rappelBreach'), barricade, 'el ruido de romper la barricada');
  }
});

test('C suelta en el aire (y la caída hace daño); derribado, cae; colgado se dispara con la dispersión de andar y sin gadgets', () => {
  const { g, rp, op } = setup();
  const gad = new Gadgets(g);
  op.gadget = { id: 'frag', left: 2 };
  place(op, 6, 0, -1.0, FACE_S);
  settle(g, op);
  press(op, 'vault');
  run(g, RAPPEL.hookGround + 0.05);
  run(g, 3, () => { op.intent.moveZ = 1; });
  op.intent.moveZ = 0;
  assert.ok(op.body.pos.y > 4.5, 'alto');
  // dispersión: la de andar (quieto, sin apuntar), sin la del aire
  const walk = op.weapon.def.spreadHip + op.weapon.def.spreadMove;
  assert.ok(Math.abs(op.currentSpread() - walk) < 1e-9, `dispersión ${op.currentSpread()} = ${walk}`);
  // apunta
  run(g, 0.5, () => { op.intent.ads = true; });
  assert.ok(op.ads > 0.99, 'apunta colgado');
  op.intent.ads = false;
  // dispara
  const ammo = op.weapon.ammo;
  run(g, 0.3, () => { op.intent.fire = true; });
  op.intent.fire = false;
  assert.ok(op.weapon.ammo < ammo, 'dispara colgado');
  // sin gadgets
  assert.equal(gad.canUse(op, 'gadget'), false, 'sin gadgets colgado');
  // C: suelta
  const hp = op.hp;
  op.intent.stance = 'crouch';
  run(g, 1.5);
  assert.equal(op.rappel, null);
  assert.ok(op.body.onGround && op.body.pos.y < 0.1, 'en la calle');
  assert.ok(op.hp < hp, `la caída hace daño (${hp} → ${op.hp.toFixed(0)})`);
  // derribado colgado: cae
  const { g: g2, op: op2 } = setup();
  place(op2, 6, 0, -1.0, FACE_S);
  settle(g2, op2);
  press(op2, 'vault');
  run(g2, RAPPEL.hookGround + 0.05);
  run(g2, 1, () => { op2.intent.moveZ = 1; });
  op2.intent.moveZ = 0;
  g2.damage(op2, op2.hp - 5, { by: null, zone: 'body' });
  if (op2.state === 'alive') op2.becomeDowned(g2, null);
  run(g2, 1.5);
  assert.equal(op2.rappel, null, 'derribado, suelta');
  assert.ok(op2.body.pos.y < 0.2, 'y cae');
});

test('solo quien puede: la defensa no, el ataque en la preparación no, en la acción sí; fuera de los tramos, nada', () => {
  // en la partida: ataque humano en la acción
  world.resetToPristine();
  const m = new Match({ world, map, seed: 2, rules: { selectTime: 0, prepTime: 1, roundEndTime: 0.2 }, human: true, startSide: 'atk' });
  m.start();
  const me = m.slots.find((s) => s.human).op;
  const def = m.game.operators.find((o) => o.side === 'def');
  const check = (op) => { place(op, 6, 0, -1.0, FACE_S); op.body.onGround = true; return !!m.rappel.hookSpot(op); };
  assert.notEqual(m.phase, 'action');
  me.frozen = false;
  assert.equal(check(me), false, 'en la preparación, no');
  for (let n = 0; n < 60 * 10 && m.phase !== 'action'; n++) m.tick(TICK);
  assert.equal(m.phase, 'action');
  assert.equal(check(me), true, 'el ataque, en la acción');
  def.frozen = false;
  assert.equal(check(def), false, 'la defensa, no');
  const bot = m.game.operators.find((o) => o.side === 'atk' && o.isBot);
  bot.frozen = false;
  assert.equal(check(bot), true, 'los bots del ataque, también (F10.2b)');
  const defBot = m.game.operators.find((o) => o.side === 'def' && o.isBot);
  defBot.frozen = false;
  assert.equal(check(defBot), false, 'los de la defensa, no');
  // fuera de los tramos: el balcón (sur, x 17), el acceso al sótano (oeste, z 4)
  const { g, rp, op } = setup();
  place(op, 17, 0, -2.6, FACE_S);
  settle(g, op);
  assert.equal(rp.hookSpot(op), null, 'bajo el balcón, no');
  place(op, -3.3, 0, 4, -Math.PI / 2);
  op.body.onGround = true;
  assert.equal(rp.hookSpot(op), null, 'en el acceso al sótano, no');
  // de espaldas a la fachada, tampoco
  place(op, 6, 0, -1.0, 0);
  settle(g, op);
  assert.equal(rp.hookSpot(op), null, 'de espaldas, no');
});

test('fachada este: desde el tejado del garaje (3,5 m) hasta el pretil', () => {
  const { g, rp, op } = setup();
  // mirando a la fachada este (hacia −x) desde el tejado del garaje
  place(op, 31.0, 3.5, 12, Math.PI / 2);
  settle(g, op);
  assert.ok(Math.abs(op.body.pos.y - 3.5) < 0.05, `en el tejado del garaje (${op.body.pos.y.toFixed(3)})`);
  const spot = rp.hookSpot(op);
  assert.ok(spot && spot.seg.id === 'este' && spot.from === 'ground');
  press(op, 'vault');
  run(g, RAPPEL.hookGround + 0.05);
  run(g, 4, () => { op.intent.moveZ = 1; });
  op.intent.moveZ = 0;
  press(op, 'vault');
  run(g, RAPPEL.climbTop + 0.4);
  assert.ok(!op.rappel && Math.abs(op.body.pos.y - 7.0) < 0.05 && op.body.pos.x < 29.5, 'en el tejado de la casa');
});

test('las caídas hacen daño a partir de 4 m: 25 de vida por cada metro de más', () => {
  const drop = (h) => {
    const { g, op } = setup();
    op.maxHp = op.hp = 200;
    place(op, 10, h, -12);
    op.body.onGround = false;
    run(g, 2);
    assert.ok(op.body.onGround, 'en el suelo');
    return 200 - op.hp;
  };
  assert.equal(drop(3.9), 0, 'desde 3,9 m, nada');
  const d45 = drop(4.5), d7 = drop(7);
  assert.ok(Math.abs(d45 - 12.5) < 3, `desde 4,5 m, unos 12 (${d45.toFixed(1)})`);
  assert.ok(Math.abs(d7 - 75) < 4, `desde 7 m, unos 75 (${d7.toFixed(1)})`);
});

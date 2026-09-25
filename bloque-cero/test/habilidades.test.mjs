// F6.4a · Habilidades de ataque con X: carga térmica (TERMO), proyectil de brecha (ROMPE),
// humo remoto (NUBE) y granada PEM (CHISPA).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Gadgets, THERMAL, BREACHROUND, SMOKEROUND, EMP, ABILITY_CD } from '../src/sim/gadgets.js';
import { Abilities, ABILITY_READY } from '../src/sim/abilities.js';
import { OPERATORS } from '../src/sim/operators.js';
import { Recon } from '../src/sim/recon.js';
import { Fortify, REINFORCE_TIME } from '../src/sim/fortify.js';
import { boxFree } from '../src/sim/physics.js';
import { MAT } from '../src/world/materials.js';

const world = createVillaWorld();
const map = buildVilla(world);
function fresh(seed = 3) {
  world.resetToPristine();
  const game = new Game({ world, map, seed });
  const gadgets = new Gadgets(game);
  const abilities = new Abilities(game, gadgets);
  return { game, gadgets, abilities };
}
function step(c, s) { for (let i = 0; i < Math.round(s / TICK); i++) { c.game.tick(TICK); c.abilities.tick(TICK); c.gadgets.tick(TICK); } }
const withAbility = (op, id, left) => { op.ability = { id, left }; return op; };
const pressX = (c, op) => { op.intent.ability = true; step(c, TICK); };
function count(x0, x1, y0, y1, z0, z1, mat = MAT.AIR, st = 0.125) {
  let n = 0;
  for (let x = x0; x <= x1 + 1e-9; x += st) for (let y = y0; y <= y1 + 1e-9; y += st) for (let z = z0; z <= z1 + 1e-9; z += st) if (world.getWorld(x, y, z) === mat) n++;
  return n;
}
// refuerzo a mano: las dos capas de la pared de pladur x = 12 entre z0 y z1, toda la planta
function reinforceWall12(z0, z1) {
  for (let y = 0.01; y < 3.5; y += 0.125) for (let z = z0 + 0.06; z < z1; z += 0.125) for (const x of [12.06, 11.94]) world.setRaw(world.vx(x), world.vy(y), world.vz(z), MAT.REINFORCED);
}

test('carga térmica: X la coloca en 2 s, X la enciende y a los 5 s abre un refuerzo de 1,9 × 1,1 m a ras de suelo', () => {
  const c = fresh();
  // TERMO en el salón frente a la pared x = 12, reforzada entre z = 1,5 y 2,5
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 11.0, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'thermal', 2);
  step(c, 0.3);
  reinforceWall12(1.5, 2.5);
  a.pitch = 0;
  pressX(c, a);
  assert.ok(c.gadgets.work.has(a), 'colocando');
  assert.equal(a.channel && a.channel.what, 'thermal');
  step(c, THERMAL.place - 0.15);
  assert.equal(c.gadgets.placed.length, 0, 'aún no');
  step(c, 0.25);
  const th = c.gadgets.placed.find((p) => p.kind === 'thermal');
  assert.ok(th, 'colocada');
  assert.equal(a.ability.left, 1);
  // X otra vez: se enciende (no gasta otra carga) y arde 5 s
  const booms = [];
  c.game.on('explosion', (k) => booms.push(k));
  pressX(c, a);
  assert.ok(th.burning, 'encendida');
  assert.equal(a.ability.left, 1);
  step(c, THERMAL.fuse - 0.2);
  assert.equal(count(11.9, 12.1, 0.1, 1.8, 1.7, 2.3), 0, 'mientras arde, el refuerzo sigue');
  step(c, 0.3);
  assert.deepEqual(booms, ['thermal']);
  // hueco: de 0 a 1,9 m y 1,1 m de ancho (las dos capas), el resto del refuerzo intacto
  const hole = count(11.9, 12.1, 0.06, 1.8, 1.6, 2.4), total = 2 * 14 * 7;
  assert.ok(hole >= total * 0.95, `hueco abierto (${hole}/${total})`);
  assert.equal(count(11.9, 12.1, 2.1, 3.3, 1.6, 2.4, MAT.REINFORCED), 2 * 10 * 7, 'por encima del hueco, el refuerzo sigue');
  assert.ok(count(11.9, 12.1, 0.06, 1.8, 2.8, 3.0) === 0, 'fuera del ancho, la pared sigue');
});

test('carga térmica contra un refuerzo puesto con F: se cruza de pie y la placa desaparece', () => {
  const c = fresh();
  const fort = new Fortify(c.game);
  // pared hall (z < 16) ↔ cocina (z > 16), tramo x ∈ [18, 19]: el defensor la refuerza desde la cocina
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 18.5, y: 0, z: 16.8, yaw: 0 }));
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 18.5, y: 0, z: 15.0, yaw: Math.PI, loadout: ['ar'] })), 'thermal', 2);
  const run = (s) => { for (let i = 0; i < Math.round(s / TICK); i++) { c.game.tick(TICK); fort.tick(TICK); c.abilities.tick(TICK); c.gadgets.tick(TICK); } };
  run(0.1);
  d.intent.interact = true;
  run(REINFORCE_TIME + 0.2);
  d.intent.interact = false;
  assert.equal(fort.panels.length, 1, 'reforzada');
  assert.ok(!boxFree(world, 18.5, 0.02, 16.0, 0.3, 1.2), 'no se pasa');
  const breached = [];
  c.game.on('panelBreached', (rec) => breached.push(rec));
  a.pitch = 0;
  pressX(c, a);
  run(THERMAL.place + 0.1);
  assert.ok(c.gadgets.thermalOf(a), 'colocada sobre el pladur del hall');
  pressX(c, a);
  run(THERMAL.fuse + 0.1);
  assert.ok(boxFree(world, 18.5, 0.02, 16.0, 0.3, 1.78), 'hueco para cruzar de pie');
  assert.equal(breached.length, 1);
  assert.equal(fort.panels.length, 0, 'la placa del refuerzo se quita');
});

test('carga térmica: no en ladrillo ni en barricadas; sí en una trampilla reforzada, de pie', () => {
  const c = fresh();
  const denied = [];
  c.game.on('gadgetDenied', (op, why) => denied.push(why));
  // fachada de ladrillo, desde la calle
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 10, y: 0, z: -1.0, yaw: Math.PI, loadout: ['ar'] })), 'thermal', 2);
  step(c, 0.3);
  a.pitch = 0;
  pressX(c, a);
  assert.equal(c.gadgets.work.size, 0);
  assert.ok(/no se puede/i.test(denied[0] || ''), `motivo: ${denied[0]}`);
  // barricada de una ventana, desde dentro
  const o = map.windows.find((w) => w.axis === 'x' && w.y0 < 2);
  const inSide = -(o.out || 1);
  a.body.pos.x = o.center; a.body.pos.y = Math.floor(o.y0 / 3.5) * 3.5; a.body.pos.z = o.line + inSide * 0.9;
  a.yaw = inSide < 0 ? Math.PI : 0;
  step(c, 0.3);
  a.pitch = Math.atan2((o.y0 + o.y1) / 2 - a.eyePos().y, 0.9);
  a.abilityCd = 0;
  pressX(c, a);
  assert.equal(c.gadgets.work.size, 0, 'en la barricada no');
  assert.equal(denied.length, 2);
  // trampilla del salón reforzada (a mano), mirando hacia abajo desde su lado
  let n = 0;
  for (let x = 7.9; x < 9.1; x += 0.125) for (let z = 10.4; z < 11.6; z += 0.125) for (const y of [-0.19, -0.06]) if (world.getWorld(x, y, z) === MAT.HATCH) { world.setRaw(world.vx(x), world.vy(y), world.vz(z), MAT.REINFORCED); n++; }
  assert.ok(n > 150, `trampilla reforzada (${n})`);
  a.body.pos.x = 8.5; a.body.pos.y = 0; a.body.pos.z = 12.3; a.yaw = 0;
  step(c, 0.3);
  a.pitch = Math.atan2(-1.64, 1.1);
  pressX(c, a);
  step(c, THERMAL.place + 0.1);
  const th = c.gadgets.placed.find((p) => p.kind === 'thermal');
  assert.ok(th, 'colocada en la trampilla');
  assert.equal(th.axis, 1);
  pressX(c, a);
  step(c, THERMAL.fuse + 0.1);
  assert.equal(count(7.9, 9.1, -0.24, -0.01, 10.4, 11.6, MAT.REINFORCED), 0, 'trampilla abierta');
});

test('proyectil de brecha: vuela recto, se pega a 17 m y a los 1,5 s abre 1,5 m de pared blanda', () => {
  const c = fresh();
  // ROMPE en el pasillo del sótano mirando la pared de pladur del fondo (a 16,9 m)
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 29, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] })), 'breachround', 2);
  step(c, 0.3);
  a.pitch = 0;
  const e = a.eyePos();
  const fired = [];
  c.game.on('abilityFired', (op, it) => fired.push(it));
  pressX(c, a);
  assert.equal(fired.length, 1);
  assert.equal(a.ability.left, 1);
  const r = fired[0];
  assert.ok(r.straight, 'vuela recto');
  step(c, 0.5);
  assert.ok(r.stuck, 'pegado');
  assert.ok(Math.abs(r.pos.y - (e.y - 0.04)) < 0.05, `sin caer (${r.pos.y.toFixed(2)} vs ${e.y.toFixed(2)})`);
  assert.ok(Math.abs(r.pos.x - 12.12) < 0.2, `en la pared (${r.pos.x.toFixed(2)})`);
  const before = count(11.8, 12.2, e.y - 0.6, e.y + 0.6, 10.4, 11.6);
  step(c, BREACHROUND.fuse - (r.t - r.armedAt) - 0.1);
  assert.ok(r.alive, 'aún pitando');
  step(c, 0.2);
  assert.ok(!r.alive, 'reventado');
  const after = count(11.8, 12.2, e.y - 0.6, e.y + 0.6, 10.4, 11.6);
  assert.ok(after > before + 80, `hueco (${before} → ${after})`);
  // cooldown de 1 s entre disparos
  assert.equal(a.ability.left, 1);
  a.abilityCd = ABILITY_CD;
  pressX(c, a);
  assert.equal(a.ability.left, 1, 'en enfriamiento no dispara');
});

test('proyectil de brecha: en un refuerzo revienta sin abrirlo; dar a alguien lo hace caer', () => {
  const c = fresh();
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 1.5, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] })), 'breachround', 2);
  step(c, 0.3);
  reinforceWall12(1.0, 3.0);
  a.pitch = 0;
  pressX(c, a);
  step(c, 0.5 + BREACHROUND.fuse);
  assert.equal(c.gadgets.items.length, 0, 'reventado');
  assert.equal(count(11.9, 12.1, 1.0, 2.2, 1.5, 2.5), 0, 'el refuerzo sigue entero');
  // un defensor delante: el proyectil rebota y cae a sus pies
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 6, y: 0, z: 2, yaw: Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.2);
  a.abilityCd = 0;
  pressX(c, a);
  step(c, 0.3);
  const r = c.gadgets.items.find((i) => i.kind === 'breachround');
  assert.ok(r && !r.straight && !r.stuck, 'rebotado');
  assert.ok(r.pos.x < 6, `delante de él (${r.pos.x.toFixed(2)})`);
  step(c, BREACHROUND.fuse);
  assert.ok(!r.alive, 'revienta igual');
  assert.ok(d.hp < d.maxHp, 'y le hace daño');
});

test('humo remoto: vuela recto hasta la pared y abre una nube de 4 m que tapa la vista', () => {
  const c = fresh();
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 29, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] })), 'remotesmoke', 3);
  step(c, 0.3);
  a.pitch = 0;
  pressX(c, a);
  assert.equal(a.ability.left, 2);
  step(c, 0.6);
  assert.equal(c.gadgets.smokes.length, 1, 'nube abierta');
  const s = c.gadgets.smokes[0];
  assert.ok(Math.abs(s.x - 12.1) < 0.4, `junto a la pared (${s.x.toFixed(2)})`);
  step(c, 1.6);
  assert.ok(Math.abs(c.gadgets.smokeRadius(s) - 4) < 0.05, 'radio 4 m');
  assert.ok(c.gadgets.smokeBlocks({ x: 16.5, y: -1.9, z: 11 }, { x: 12.5, y: -1.9, z: 11 }), 'tapa la vista');
  // al final del alcance (40 m) sin chocar: se abre allí mismo
  const far = { id: 'x', kind: 'smokeround', owner: a, team: 0, straight: true, range: SMOKEROUND.range, flown: SMOKEROUND.range - 0.2, pos: { x: 20, y: 30, z: 11 }, vel: { x: 0, y: SMOKEROUND.speed, z: 0 }, t: 0.5, rest: false, alive: true, bounces: 0 };
  c.gadgets.items.push(far);
  step(c, TICK * 2);
  assert.equal(c.gadgets.smokes.length, 2);
});

test('granada PEM: X la lanza; a los 2 s apaga 15 s cámaras y alarmas a 5 m, aunque haya paredes', () => {
  const c = fresh();
  const recon = new Recon(c.game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  c.gadgets.recon = recon;
  const cam = recon.cams.find((k) => k.id === 'cam_hall');
  // atacante a la vista de la cámara del hall
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 15, y: 0, z: 11, yaw: Math.PI, loadout: ['ar'] })), 'emp', 3);
  // alarma de la defensa en el hall
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] }));
  d.gadget = { id: 'alarm', left: 1 };
  step(c, 0.3);
  d.pitch = -1.0;
  d.intent.gadget = true; step(c, 1.2);
  const al = c.gadgets.placed.find((p) => p.kind === 'alarm');
  assert.ok(al, 'alarma colocada');
  assert.equal(recon.mark(cam, 1), a, 'la cámara lo ve y lo marca');
  recon.spotted.clear();
  // X lanza la PEM
  pressX(c, a);
  assert.equal(a.ability.left, 2);
  const g = c.gadgets.items.find((i) => i.kind === 'emp');
  assert.ok(g, 'lanzada');
  // (para el efecto, una PEM quieta en el hall, detrás de la pared de la cámara no hace falta: atraviesa)
  g.pos = { x: 14.5, y: 0.3, z: 13.5 }; g.vel = { x: 0, y: 0, z: 0 }; g.rest = true;
  const pops = [];
  c.game.on('emp', (p, hits) => pops.push(hits));
  step(c, EMP.fuse);
  assert.equal(pops.length, 1);
  assert.ok(pops[0].includes(cam) && pops[0].includes(al), 'cámara y alarma alcanzadas');
  assert.ok(c.gadgets.isOff(cam) && c.gadgets.isOff(al));
  assert.equal(recon.mark(cam, 1), null, 'sin señal: no marca');
  const rings = [];
  c.game.on('alarm', () => rings.push(1));
  a.body.pos.x = al.pos.x + 1.2; a.body.pos.z = al.pos.z;
  step(c, 1);
  assert.equal(rings.length, 0, 'la alarma apagada no suena');
  // a los 15 s vuelve todo
  a.body.pos.x = 15; a.body.pos.z = 11;
  step(c, EMP.off - 1);
  assert.ok(!c.gadgets.isOff(cam) && !c.gadgets.isOff(al), 'encendidas otra vez');
  assert.equal(recon.mark(cam, 1), a, 'la cámara vuelve a marcar');
  a.body.pos.x = al.pos.x + 1.2; a.body.pos.z = al.pos.z;
  step(c, 0.3);
  assert.equal(rings.length, 1, 'y la alarma suena');
});

test('X sin cargas avisa; las 16 habilidades de la plantilla están programadas', () => {
  const c = fresh();
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 29, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] })), 'remotesmoke', 0);
  const empty = [];
  c.game.on('abilityEmpty', (op) => empty.push(op));
  step(c, 0.3);
  pressX(c, a);
  assert.deepEqual(empty, [a]);
  assert.equal(c.gadgets.items.length, 0);
  for (const o of OPERATORS) assert.ok(ABILITY_READY[o.ability.id], `${o.name}: ${o.ability.id}`);
});

// ---------------------------------------------------------------- información (F6.4b)
import { SCAN, THERMAL_SCOPE, thermalOn, scopeZoom } from '../src/sim/abilities.js';
import { Perception } from '../src/sim/ai/perception.js';
import { DIFFICULTY } from '../src/sim/bots.js';

test('pulso de escaneo: aviso de 2 s; luego 4 s en los que el defensor que se mueve queda marcado', () => {
  const c = fresh();
  const recon = new Recon(c.game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  c.gadgets.recon = recon;
  const a = withAbility(c.game.addOperator(new Operator('a', { team: 0, x: 10, y: 0, z: -12, yaw: Math.PI, loadout: ['ar'] })), 'scan', 3);
  const walker = c.game.addOperator(new Operator('w', { team: 1, x: 27, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] }));
  const still = c.game.addOperator(new Operator('s', { team: 1, x: 20, y: -3.5, z: 13.5, yaw: Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.3);
  const ev = [];
  for (const k of ['scanWarn', 'scanStart', 'scanDetect', 'scanEnd']) c.game.on(k, (x) => ev.push(k === 'scanDetect' ? `detect:${x.id}` : k));
  walker.intent.moveZ = 1;                     // anda hacia -x por el pasillo del sótano
  pressX(c, a);
  assert.equal(a.ability.left, 2);
  assert.deepEqual(ev, ['scanWarn']);
  step(c, SCAN.warn - 0.2);
  assert.ok(!recon.isSpottedFor(walker, 0), 'durante el aviso, nada');
  // otra X mientras dura: no
  a.abilityCd = 0;
  pressX(c, a);
  assert.equal(a.ability.left, 2, 'un pulso cada vez');
  step(c, 0.4);
  assert.ok(ev.includes('scanStart'));
  assert.ok(recon.isSpottedFor(walker, 0), 'el que anda, marcado');
  assert.ok(!recon.isSpottedFor(still, 0), 'el quieto, no');
  // el quieto se mueve a mitad del pulso: también
  still.intent.moveZ = -1;
  step(c, 1.0);
  assert.ok(recon.isSpottedFor(still, 0));
  assert.deepEqual(ev.filter((e) => e.startsWith('detect')), ['detect:w', 'detect:s']);
  // al pararse, la marca se va enseguida
  walker.intent.moveZ = 0; still.intent.moveZ = 0;
  step(c, SCAN.linger + 0.3);
  assert.ok(!recon.isSpottedFor(walker, 0), 'quieto otra vez: sin marca');
  step(c, SCAN.active);
  assert.ok(ev.includes('scanEnd'));
  assert.equal(c.abilities.scans.length, 0);
  walker.intent.moveZ = 1;
  step(c, 0.5);
  assert.ok(!recon.isSpottedFor(walker, 0), 'acabado el pulso, moverse no marca');
});

test('visor térmico: con la principal, apuntando y quieto; 3x; el bot LUMEN ve a través del humo', () => {
  const c = fresh();
  // LUMEN y un defensor en el pasillo del sótano, a 10 m, con una nube en medio
  const l = withAbility(c.game.addOperator(new Operator('l', { team: 0, x: 28, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['dmr', 'pistol'] })), 'thermalscope', -1);
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 18, y: -3.5, z: 11, yaw: -Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.3);
  const per = new Perception(l, c.game, DIFFICULTY.normal);
  const sees = () => { per.scanT = 0; per.memory.clear(); per.scan(0.2, [d]); return per.visible.includes(d); };
  assert.ok(sees(), 'sin humo lo ve');
  const now = c.game.time;
  c.gadgets.smokes.push({ x: 23, y: -3.1, z: 11, r: 4, t0: now - 3, until: now + 20, team: 0 });
  assert.ok(!thermalOn(l));
  assert.ok(!sees(), 'con humo, sin visor, no');
  // apuntando con la principal y quieto
  l.intent.ads = true;
  step(c, 0.8);
  assert.ok(thermalOn(l), 'visor en marcha');
  assert.equal(scopeZoom(l), THERMAL_SCOPE.zoom, '3x');
  assert.ok(sees(), 'con el visor lo ve dentro del humo');
  // moviéndose, no
  l.intent.moveX = 1;
  step(c, 0.3);
  assert.ok(!thermalOn(l), 'moviéndose se apaga');
  l.intent.moveX = 0;
  step(c, 0.5);
  assert.ok(thermalOn(l));
  // con la pistola, no (ni 3x)
  l.intent.switchTo = 1;
  step(c, 1.0);
  assert.equal(l.weaponIndex, 1);
  assert.ok(!thermalOn(l), 'solo con el arma principal');
  assert.ok(scopeZoom(l) < 2);
  // X no hace nada (es pasiva) y lo explica
  const why = [];
  c.game.on('abilityDenied', (op, w) => why.push(w));
  pressX(c, l);
  assert.ok(/apunta/i.test(why[0] || ''), why[0]);
});

// ---------------------------------------------------------------- dron de choque (F6.4c)
import { SHOCK } from '../src/sim/abilities.js';

function aimDrone(d, p) {
  const e = d.eyePos(), dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  d.yaw = Math.atan2(-dx, -dz);
  d.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

test('dron de choque: solo el primer dron de PULGA; el rayo destruye alarma y cámara blindada, no a través de paredes', () => {
  const c = fresh();
  const recon = new Recon(c.game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  c.gadgets.recon = recon;
  // la defensa pone una alarma en el suelo del hall y una cámara blindada en la pared del salón (x = 12)
  const d1 = c.game.addOperator(new Operator('d1', { team: 1, x: 17, y: 0, z: 13, yaw: 0, loadout: ['ar'] }));
  const d2 = c.game.addOperator(new Operator('d2', { team: 1, x: 11.0, y: 0, z: 2, yaw: -Math.PI / 2, loadout: ['ar'] }));
  d1.gadget = { id: 'alarm', left: 1 }; d2.gadget = { id: 'bpcam', left: 1 };
  step(c, 0.3);
  d1.pitch = -1.0; d2.pitch = 0;
  d1.intent.gadget = true; d2.intent.gadget = true;
  step(c, 1.2);
  const al = c.gadgets.placed.find((p) => p.kind === 'alarm');
  const cam = recon.cams.find((k) => k.bulletproof);
  assert.ok(al && cam, 'alarma y cámara blindada colocadas');
  // PULGA: su primer dron es el de choque; el segundo, normal
  const p = withAbility(c.game.addOperator(new Operator('p', { team: 0, x: 17, y: 0, z: 8.2, yaw: Math.PI, loadout: ['ar'] })), 'shockdrone', SHOCK.charges);
  const shock = recon.deployDrone(p, { thrown: false });
  const other = recon.deployDrone(p, { thrown: false });
  assert.ok(shock.shock && !other.shock, 'solo el primero es de choque');
  assert.equal(c.abilities.shockDroneOf(p), shock);
  // rayo contra la alarma (a unos 3 m)
  aimDrone(shock, al.target.center());
  const zaps = [];
  c.game.on('shockZap', (d, from, to, hit) => zaps.push(hit));
  shock.intent.zap = true; step(c, TICK);
  assert.ok(!al.alive, 'alarma destruida');
  assert.equal(p.ability.left, SHOCK.charges - 1);
  // enfriamiento: otro disparo enseguida no sale
  shock.intent.zap = true; step(c, TICK);
  assert.equal(p.ability.left, SHOCK.charges - 1, 'medio segundo entre rayos');
  // la cámara blindada, desde el recibidor y con la pared en medio: no
  shock.body.pos.x = 13.5; shock.body.pos.y = 0; shock.body.pos.z = 2;
  step(c, SHOCK.cooldown);
  aimDrone(shock, cam.center());
  shock.intent.zap = true; step(c, TICK);
  assert.ok(cam.alive, 'la pared la protege');
  assert.equal(zaps[zaps.length - 1], null);
  // desde el salón, a la vista: destruida (las balas rebotan; el rayo no)
  shock.body.pos.x = 9.0; shock.body.pos.z = 2.3;
  step(c, SHOCK.cooldown);
  aimDrone(shock, cam.center());
  shock.intent.zap = true; step(c, TICK);
  assert.ok(!cam.alive, 'cámara blindada destruida');
  assert.equal(p.ability.left, SHOCK.charges - 3);
  // el dron normal no tiene rayo
  aimDrone(other, cam.center());
  other.intent.zap = true; step(c, TICK);
  assert.equal(p.ability.left, SHOCK.charges - 3);
});

test('dron de choque: 6 cargas; recupera 1 cada 12 s; sin cargas avisa; no rompe el escudo desplegable', () => {
  const c = fresh();
  const recon = new Recon(c.game, { cameras: map.cameras });
  recon.reset({ defTeam: 1 });
  c.gadgets.recon = recon;
  // escudo desplegable en el hall y, detrás, una alarma en el suelo
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 18.5, y: 0, z: 13.0, yaw: Math.PI, loadout: ['ar'] }));
  d.gadget = { id: 'shield', left: 1 };
  step(c, 0.3);
  d.pitch = -0.2;
  d.intent.gadget = true; step(c, 1.2);
  const p = withAbility(c.game.addOperator(new Operator('p', { team: 0, x: 18.5, y: 0, z: 10.5, yaw: Math.PI, loadout: ['ar'] })), 'shockdrone', 1);
  const shock = recon.deployDrone(p, { thrown: false });
  shock.body.pos.x = 18.5; shock.body.pos.y = 0; shock.body.pos.z = 12.0;
  // rayo contra el escudo (vóxeles): se para en él y el escudo sigue
  aimDrone(shock, { x: 18.5, y: 0.5, z: 14.5 });
  const before = count(17.8, 19.2, 0.06, 1.0, 13.8, 14.0, MAT.DEPLOY_SHIELD);
  assert.ok(before > 40, `escudo puesto (${before})`);
  shock.intent.zap = true; step(c, TICK);
  assert.equal(count(17.8, 19.2, 0.06, 1.0, 13.8, 14.0, MAT.DEPLOY_SHIELD), before, 'el escudo no se rompe');
  assert.equal(p.ability.left, 0);
  const empty = [];
  c.game.on('abilityEmpty', (op) => empty.push(op));
  step(c, SHOCK.cooldown);
  shock.intent.zap = true; step(c, TICK);
  assert.deepEqual(empty, [p], 'sin cargas');
  step(c, SHOCK.regen - SHOCK.cooldown);
  assert.equal(p.ability.left, 1, 'una carga más a los 12 s');
  p.ability.left = SHOCK.charges;
  step(c, SHOCK.regen + 1);
  assert.equal(p.ability.left, SHOCK.charges, 'no pasa de 6');
});

// ---------------------------------------------------------------- escudo balístico (F6.4d)
import { BSHIELD, shieldUp } from '../src/sim/abilities.js';
import { aimPoint } from '../src/sim/bots.js';
import { BONE } from '../src/sim/skeleton.js';

function shootAt(game, from, p) {
  const e = from.eyePos(), dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, L = Math.hypot(dx, dy, dz);
  return game.fireBullet(from, e, { x: dx / L, y: dy / L, z: dz / L }, from.weapon);
}

test('escudo balístico: para las balas de frente; de lado y a los pies, no; corriendo lo baja', () => {
  const c = fresh();
  // MURALLA en el pasillo del sótano mirando hacia +x; un defensor a 6 m, de frente
  const m = withAbility(c.game.addOperator(new Operator('m', { team: 0, x: 20, y: -3.5, z: 11, yaw: -Math.PI / 2, armor: 3, loadout: ['pistol'] })), 'shield', 4);
  const d = c.game.addOperator(new Operator('d', { team: 1, x: 26, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.3);
  assert.ok(shieldUp(m), 'escudo arriba');
  assert.ok(m._shieldTarget, 'el escudo para balas');
  const rico = [];
  c.game.on('ricochet', (tg) => rico.push(tg));
  const chest = () => m.rig[BONE.chest].p, head = () => m.rig[BONE.head].p;
  let r = shootAt(c.game, d, chest());
  assert.equal(r.hitTarget && r.hitTarget.kind, 'shield');
  r = shootAt(c.game, d, head());
  assert.equal(r.hitTarget && r.hitTarget.kind, 'shield', 'la cabeza también');
  assert.equal(m.hp, m.maxHp, 'sin daño');
  assert.equal(rico.length, 2);
  // a los pies, por debajo del escudo
  const f = m.rig[BONE.footL].p;
  r = shootAt(c.game, d, { x: f.x, y: f.y + 0.05, z: f.z });
  assert.equal(r.hitOp, m, 'el pie asoma');
  assert.ok(m.hp < m.maxHp);
  // de lado, sin protección
  const hp0 = m.hp;
  d.body.pos.x = 20; d.body.pos.z = 14.5; d.yaw = 0;
  step(c, 0.2);
  r = shootAt(c.game, d, chest());
  assert.equal(r.hitOp, m, 'de lado le da');
  assert.ok(m.hp < hp0);
  // corriendo baja el escudo: de frente le da
  m.hp = m.maxHp;
  d.body.pos.x = 27; d.body.pos.z = 11; d.yaw = Math.PI / 2;
  m.intent.sprint = true; m.intent.moveZ = 1;
  step(c, 0.2);
  assert.ok(m.sprinting && !shieldUp(m), 'corriendo, bajado');
  r = shootAt(c.game, d, chest());
  assert.equal(r.hitOp, m, 'expuesto');
  m.intent.sprint = false; m.intent.moveZ = 0;
  step(c, 0.3);
  assert.ok(shieldUp(m), 'arriba otra vez');
  // los bots, de frente, apuntan a los pies
  const tp = aimPoint(m, true, d.eyePos());
  assert.ok(tp.y < m.body.pos.y + 0.4, `a los pies (${(tp.y - m.body.pos.y).toFixed(2)} m)`);
  const side = aimPoint(m, true, { x: m.body.pos.x, y: -2, z: m.body.pos.z + 4 });
  assert.ok(side.y > m.body.pos.y + 1.3, 'de lado, a la cabeza');
});

test('escudo balístico: X destella tras 0,4 s y ciega en 90° y 5 m; golpe de 40; los explosivos no lo rompen', () => {
  const c = fresh();
  const m = withAbility(c.game.addOperator(new Operator('m', { team: 0, x: 20, y: -3.5, z: 11, yaw: -Math.PI / 2, armor: 3, loadout: ['pistol'] })), 'shield', 4);
  const front = c.game.addOperator(new Operator('f', { team: 1, x: 24, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] }));
  const far = c.game.addOperator(new Operator('l', { team: 1, x: 26.5, y: -3.5, z: 11, yaw: Math.PI / 2, loadout: ['ar'] }));
  const off = c.game.addOperator(new Operator('o', { team: 1, x: 21.2, y: -3.5, z: 13.2, yaw: Math.PI, loadout: ['ar'] }));
  const ally = c.game.addOperator(new Operator('a', { team: 0, x: 23, y: -3.5, z: 12, yaw: Math.PI / 2, loadout: ['ar'] }));
  step(c, 0.3);
  pressX(c, m);
  assert.equal(m.ability.left, 3);
  assert.equal(front.blindT || 0, 0, 'aún cargando');
  step(c, BSHIELD.windup);
  assert.ok(front.blindT >= 3, `de frente a 4 m: cegado (${(front.blindT || 0).toFixed(2)} s)`);
  assert.equal(far.blindT || 0, 0, 'a 6,5 m, no');
  assert.equal(off.blindT || 0, 0, 'fuera del cono, no');
  assert.equal(ally.blindT || 0, 0, 'los compañeros, no');
  // golpe con escudo: 40
  front.blindT = 0;
  front.body.pos.x = 21.3;
  step(c, 0.2);
  const hp0 = front.hp;
  m.intent.melee = true; step(c, 0.1);
  assert.equal(hp0 - front.hp, BSHIELD.bash, 'golpe con escudo');
  // un golpe de frente contra el escudo: parado
  const mh = m.hp;
  front.yaw = Math.PI / 2;
  front.intent.melee = true; step(c, 0.6);
  assert.equal(m.hp, mh, 'el escudo para el golpe');
  // una granada delante: el escudo sigue (a MURALLA sí le llega la onda)
  // (a 2,5 m: la onda llega al escudo, a 2 m de ella, y MURALLA sobrevive)
  const booms = [];
  c.game.on('explosion', (k) => booms.push(k));
  c.gadgets.items.push({ id: 'x', kind: 'frag', owner: front, team: 1, pos: { x: 22.5, y: -3.4, z: 11 }, vel: { x: 0, y: 0, z: 0 }, t: 2.95, rest: true, alive: true, bounces: 0 });
  step(c, 0.2);
  assert.deepEqual(booms, ['frag']);
  assert.equal(m.state, 'alive');
  assert.ok(m.hp < mh, 'la onda le llega');
  assert.ok(m._shieldTarget && m._shieldTarget.alive, 'el escudo no se rompe');
});

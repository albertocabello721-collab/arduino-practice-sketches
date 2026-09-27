// F10.3 · Miras y accesorios: qué admite cada arma, lo que lleva de serie, lo que cambia cada
// accesorio en la simulación (aumento, apuntado, dispersión, retroceso, daño), el oído de los bots
// con supresor, el láser que delata y la elección en la pantalla de selección (los bots, fijo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { Game, TICK } from '../src/sim/game.js';
import { Operator } from '../src/sim/operator.js';
import { Match } from '../src/sim/match.js';
import { BotSquad, navFor } from '../src/sim/bots.js';
import { Perception } from '../src/sim/ai/perception.js';
import { opsForSide } from '../src/sim/operators.js';
import { WEAPONS, WeaponState, SIGHTS, KIT, KIT_RULES, BOT_KITS, defaultKit, normalizeKit, kitDef } from '../src/sim/weapons.js';
import { BONE } from '../src/sim/skeleton.js';

const world = createVillaWorld();
const map = buildVilla(world);
const nav = navFor(world, map);
const P = (x, y, z) => ({ x, y, z });
function fresh(seed = 3) { world.resetToPristine(); return new Game({ world, map, seed }); }
function place(op, x, y, z, yaw = 0, pitch = 0) {
  op.body.pos.x = x; op.body.pos.y = y; op.body.pos.z = z; op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
  op.yaw = yaw; op.pitch = pitch;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('qué admite cada arma: miras por tipo, cañón y empuñadura; de serie, la mira de siempre', () => {
  const all = Object.keys(SIGHTS);
  for (const id of ['ar', 'ar2', 'lmg', 'dmr']) assert.deepEqual(KIT_RULES[id].sights, all, `${id}: todas las miras`);
  for (const id of ['smg', 'smg2', 'mpistol']) assert.deepEqual(KIT_RULES[id].sights, ['iron', 'reddot', 'holo', 'reflex', 'x15'], `${id}: hasta 1,5x`);
  assert.deepEqual(KIT_RULES.shotgun.sights, ['iron', 'reddot', 'holo', 'reflex'], 'escopeta: sin aumento');
  for (const id of ['pistol', 'revolver']) assert.deepEqual(KIT_RULES[id].sights, ['iron'], `${id}: hierro`);
  // empuñaduras solo en las principales; la escopeta solo admite el supresor y el revólver nada
  for (const id of ['pistol', 'revolver', 'mpistol']) assert.equal(KIT_RULES[id].grips, false, `${id}: sin empuñadura`);
  assert.deepEqual(KIT_RULES.shotgun.barrels, ['none', 'suppressor']);
  assert.deepEqual(KIT_RULES.revolver.barrels, ['none']);
  // de serie: la mira que ya llevaba cada arma y ningún accesorio
  const serie = { ar: 'holo', ar2: 'x15', smg: 'holo', smg2: 'reddot', lmg: 'x15', dmr: 'x20', shotgun: 'iron', pistol: 'iron', revolver: 'iron', mpistol: 'iron' };
  for (const [id, sight] of Object.entries(serie)) assert.deepEqual(defaultKit(WEAPONS[id]), { sight, barrel: 'none', grip: 'none', laser: false }, id);
  // lo que el arma no admite se queda de serie
  assert.deepEqual(normalizeKit(WEAPONS.revolver, { sight: 'x25', barrel: 'suppressor', grip: 'vertical', laser: true }), { sight: 'iron', barrel: 'none', grip: 'none', laser: true });
  assert.deepEqual(normalizeKit(WEAPONS.smg, { sight: 'x20', barrel: 'nada', grip: 'angled' }), { sight: 'holo', barrel: 'none', grip: 'angled', laser: false });
  // los bots: equipo fijo, válido para cada arma, sin supresor ni láser
  for (const [id, k] of Object.entries(BOT_KITS)) {
    const n = normalizeKit(WEAPONS[id], k);
    assert.equal(n.sight, k.sight, `${id}: mira de los bots válida`);
    assert.equal(n.barrel, k.barrel || 'none'); assert.equal(n.grip, k.grip || 'none');
    assert.ok(n.barrel !== 'suppressor' && !n.laser, `${id}: sin supresor ni láser`);
  }
});

test('lo que cambia cada accesorio (y la tabla de armas sigue igual)', () => {
  const ar = WEAPONS.ar;
  const base = { ...ar, recoil: { ...ar.recoil } };
  const k = (kit) => kitDef(ar, normalizeKit(ar, kit));
  // aumento: las miras sin aumento usan el del arma; las otras, el suyo
  for (const s of ['iron', 'reddot', 'holo', 'reflex']) assert.equal(k({ sight: s }).adsZoom, ar.adsZoom);
  assert.equal(k({ sight: 'x15' }).adsZoom, 1.5); assert.equal(k({ sight: 'x20' }).adsZoom, 2.0); assert.equal(k({ sight: 'x25' }).adsZoom, 2.5);
  // de serie, el FA-9 y la AL-60 a 1,5x y el T-308 a 2,0x
  assert.equal(new WeaponState(WEAPONS.ar2).def.adsZoom, 1.5);
  assert.equal(new WeaponState(WEAPONS.lmg).def.adsZoom, 1.5);
  assert.equal(new WeaponState(WEAPONS.dmr).def.adsZoom, 2.0);
  // empuñadura angular: apunta en 0,34 × 0,8 = 0,272 s
  assert.ok(near(k({ grip: 'angled' }).adsTime, 0.34 * 0.8));
  // láser: −20 % de dispersión desde la cadera (apuntando, igual)
  assert.ok(near(k({ laser: true }).spreadHip, ar.spreadHip * 0.8));
  assert.equal(k({ laser: true }).spreadAds, ar.spreadAds);
  // supresor: −10 % de daño
  assert.ok(near(k({ barrel: 'suppressor' }).damage, 44 * 0.9));
  assert.equal(k({ barrel: 'suppressor' }).suppressed, true);
  // retroceso: vertical −15 % hacia arriba; compensador −20 % a los lados; freno −30 % en el primero
  assert.ok(near(k({ grip: 'vertical' }).recoil.v, ar.recoil.v * 0.85));
  assert.ok(near(k({ barrel: 'compensator' }).recoil.h, ar.recoil.h * 0.8));
  assert.ok(near(k({ barrel: 'brake' }).recoil.first, ar.recoil.first * 0.7));
  // todo lo demás, lo de la tabla
  const d = k({ sight: 'x25', barrel: 'suppressor', grip: 'angled', laser: true });
  for (const f of ['id', 'name', 'rpm', 'mag', 'reload', 'falloff', 'model', 'sound', 'pellets']) assert.deepEqual(d[f], ar[f], f);
  assert.deepEqual({ ...ar, recoil: { ...ar.recoil } }, base, 'la tabla no se toca');
});

// Un disparo a la vez al cielo (sin romper nada), con el mismo azar: cuánto sube y se va al lado.
function kicks(kit, n = 12, id = 'ar', semi = false) {
  const g = fresh(11);
  const op = new Operator('t', { team: 0, loadout: [id], kits: { [id]: kit } });
  g.addOperator(op);
  place(op, 10, 0, -12, 0, 0.5);
  const w = op.weapon, out = [];
  for (let i = 0; i < n; i++) {
    op.recoilPending.pitch = 0; op.recoilPending.yaw = 0;
    if (semi) w.shotsInBurst = 0;
    op._shoot(g, w);
    out.push({ up: op.recoilPending.pitch, side: op.recoilPending.yaw });
  }
  return out;
}

test('en la simulación: vertical −15 % hacia arriba, compensador −20 % a los lados, freno −30 % en el primero', () => {
  const none = kicks(null), vert = kicks({ grip: 'vertical' }), comp = kicks({ barrel: 'compensator' }), brake = kicks({ barrel: 'brake' });
  const sum = (a, f) => a.reduce((s, x) => s + Math.abs(x[f]), 0);
  assert.ok(near(sum(vert, 'up') / sum(none, 'up'), 0.85, 1e-6), 'vertical: el patrón sube un 15 % menos');
  assert.ok(near(sum(vert, 'side'), sum(none, 'side'), 1e-9), 'vertical: a los lados, igual');
  assert.ok(near(sum(comp, 'side') / sum(none, 'side'), 0.8, 1e-6), 'compensador: se abre un 20 % menos');
  assert.ok(near(sum(comp, 'up'), sum(none, 'up'), 1e-9), 'compensador: hacia arriba, igual');
  assert.ok(near(brake[0].up / none[0].up, 0.7, 1e-6), 'freno: el primer disparo, −30 %');
  for (let i = 1; i < none.length; i++) assert.ok(near(brake[i].up, none[i].up, 1e-9), `freno: el disparo ${i + 1}, igual`);
  // tiro a tiro, cada disparo es el primero: el freno ayuda en todos
  const tn = kicks(null, 5, 'dmr', true), tb = kicks({ barrel: 'brake' }, 5, 'dmr', true);
  for (let i = 0; i < 5; i++) assert.ok(near(tb[i].up / tn[i].up, 0.7, 1e-6), `T-308 tiro a tiro ${i + 1}`);
});

test('en la simulación: la angular apunta un 20 % antes, el láser abre menos desde la cadera, el supresor quita un 10 %', () => {
  const adsTime = (kit) => {
    const g = fresh(5);
    const op = new Operator('t', { team: 0, loadout: ['ar'], kits: { ar: kit } });
    g.addOperator(op); place(op, 10, 0, -12);
    for (let i = 0; i < 30; i++) g.tick();
    op.intent.ads = true;
    let t = 0;
    while (op.ads < 1 && t < 2) { g.tick(); t += TICK; }
    return t;
  };
  const tn = adsTime(null), ta = adsTime({ grip: 'angled' });
  assert.ok(Math.abs(tn - 0.34) <= TICK + 1e-9, `FA-7 sin nada: ${tn.toFixed(3)} s`);
  assert.ok(Math.abs(ta - 0.272) <= TICK + 1e-9, `FA-7 con angular: ${ta.toFixed(3)} s`);
  // dispersión desde la cadera, de pie y quieto
  const spread = (kit) => {
    const g = fresh(5);
    const op = new Operator('t', { team: 0, loadout: ['ar'], kits: { ar: kit } });
    g.addOperator(op); place(op, 10, 0, -12);
    for (let i = 0; i < 30; i++) g.tick();
    return op.currentSpread();
  };
  assert.ok(near(spread({ laser: true }) / spread(null), 0.8, 1e-9), 'láser: −20 % desde la cadera');
  // daño: el mismo disparo al pecho de alguien a 10 m
  const hit = (kit) => {
    const g = fresh(7);
    const op = new Operator('a', { team: 0, loadout: ['ar'], kits: { ar: kit } });
    const tg = new Operator('b', { team: 1, loadout: ['ar'], armor: 2 });
    g.addOperator(op); g.addOperator(tg);
    place(op, 10, 0, -12, 0); place(tg, 10, 0, -22, Math.PI);
    for (let i = 0; i < 20; i++) g.tick();
    op.ads = 1;
    const c = tg.rig[BONE.chest].p, e = op.eyePos();
    op.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z)); op.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
    const hp = tg.hp;
    op._shoot(g, op.weapon);
    return hp - tg.hp;
  };
  const dn = hit(null), ds = hit({ barrel: 'suppressor' });
  assert.ok(dn > 40, `sin supresor, ${dn}`);
  assert.ok(near(ds / dn, 0.9, 1e-9), `con supresor, ${ds} (−10 %)`);
});

test('el láser delata: un bot que ve el punto rojo en la pared (a menos de 20 m) sabe dónde está quien lo lleva', () => {
  const seen = (laser) => {
    const g = fresh(3);
    const obs = new Operator('o', { team: 1, loadout: ['ar'] });
    const own = new Operator('l', { team: 0, loadout: ['ar'], kits: { ar: { laser } } });
    g.addOperator(obs); g.addOperator(own);
    // él mira a la fachada (z = 0) desde la calle, a 5 m; el que lleva el láser está 10 m detrás y
    // 2 m a un lado (fuera de su vista) y apunta a la misma pared
    place(obs, 6, 0, -5, Math.PI); place(own, 8, 0, -15, Math.PI, -0.05);
    for (let i = 0; i < 10; i++) g.tick();
    const per = new Perception(obs, g, { fov: 50 * Math.PI / 180, range: 48, hearing: 1 });
    per.scan(1, [own]);
    return { visible: per.visible.includes(own), mem: per.memory.get(own) || null };
  };
  const on = seen(true), off = seen(false);
  assert.equal(on.visible, false, 'no lo ve a él');
  assert.ok(on.mem && on.mem.precise && !on.mem.seen, 'pero sabe dónde está, por el punto rojo');
  assert.ok(Math.hypot(on.mem.x - 8, on.mem.z - (-15)) < 0.1, `y dónde exactamente (${on.mem.x}, ${on.mem.z})`);
  assert.equal(off.mem, null, 'sin láser, nada');
  // más allá de la distancia a la que se ve el haz, nada (aquí, con el alcance a 3 m)
  const R = KIT.laserSeen;
  KIT.laserSeen = 3;
  try { assert.equal(seen(true).mem, null, 'el punto a 5 m, más allá del alcance'); } finally { KIT.laserSeen = R; }
});

// Partida solo de bots: un atacante y un defensor en la calle; el disparo se oye o no según el supresor.
test('el supresor: los bots lo oyen desde 15 m en vez de 45 (a un tercio)', () => {
  world.resetToPristine(); while (nav.update(256)) { /* recalcular */ } nav.update();
  const m = new Match({ world, map, seed: 4, rules: { selectTime: 0, prepTime: 1, roundEndTime: 0.2 }, human: false, startSide: 'atk' });
  const bots = new BotSquad(m, 'normal', { nav });
  m.on('roundStart', () => bots.reset());
  m.start();
  for (let n = 0; n < 60 * 60 && m.phase !== 'action'; n++) { bots.update(TICK); m.tick(TICK); }
  assert.equal(m.phase, 'action');
  const ops = m.game.operators, atk = ops.filter((o) => o.side === 'atk'), def = ops.filter((o) => o.side === 'def');
  const shooter = atk[0], ear = def[0], brain = bots.brains.get(ear);
  for (const o of ops) if (o !== shooter) o.frozen = true;
  const hears = (d, suppressed) => {
    shooter.weapon.setKit({ barrel: suppressed ? 'suppressor' : 'none' });
    place(shooter, 2, 0, -12); place(ear, 2 + d, 0, -12);
    brain.per.noises.length = 0; brain.heardAt.clear();
    m.game.emit('shot', shooter, shooter.weapon, shooter.eyePos(), shooter.viewDir(), []);
    return brain.per.noises.some((n) => n.kind === 'shot' && n.src === shooter);
  };
  assert.equal(hears(30, false), true, 'sin supresor, a 30 m se oye');
  assert.equal(hears(30, true), false, 'con supresor, a 30 m no');
  assert.equal(hears(12, true), true, 'con supresor, a 12 m sí');
  assert.equal(45 * KIT.suppressedHearing, 15);
});

test('selección: el jugador elige mira y accesorios de cada arma y los lleva en la ronda; los bots, su equipo fijo', () => {
  world.resetToPristine();
  const m = new Match({ world, map, seed: 9, rules: { selectTime: 30, prepTime: 1, roundEndTime: 0.2 }, human: true, startSide: 'atk' });
  m.start();
  assert.equal(m.phase, 'select');
  const me = m.slots.find((s) => s.human);
  const op = opsForSide('atk').find((o) => o.primaries.includes('ar'));
  assert.ok(m.choose(me, { opId: op.id, primary: op.primaries.indexOf('ar') }));
  assert.ok(m.choose(me, { kit: { weapon: 'ar', sight: 'x25', barrel: 'suppressor' } }));
  assert.ok(m.choose(me, { kit: { weapon: 'ar', grip: 'angled', laser: true } }));
  // lo que el arma no admite, de serie
  m.choose(me, { kit: { weapon: op.secondaries[0], sight: 'x25' } });
  assert.deepEqual(me.kits.ar, { sight: 'x25', barrel: 'suppressor', grip: 'angled', laser: true });
  assert.equal(me.kits[op.secondaries[0]].sight, KIT_RULES[op.secondaries[0]].sights.includes('x25') ? 'x25' : defaultKit(WEAPONS[op.secondaries[0]]).sight);
  m.setReady(me, true);
  for (let n = 0; n < 60 * 40 && m.phase === 'select'; n++) m.tick(TICK);
  assert.notEqual(m.phase, 'select');
  const mine = me.op.weapons[0];
  assert.equal(mine.base.id, 'ar');
  assert.deepEqual(mine.kit, { sight: 'x25', barrel: 'suppressor', grip: 'angled', laser: true });
  assert.equal(mine.def.adsZoom, 2.5);
  // los bots llevan su equipo fijo
  for (const s of m.slots.filter((x) => !x.human)) {
    for (const w of s.op.weapons) assert.deepEqual(w.kit, normalizeKit(w.base, BOT_KITS[w.base.id]), `${s.op.name}: ${w.base.name}`);
  }
  // cambiar de operador empieza con lo de serie
  const m2 = new Match({ world, map, seed: 9, rules: { selectTime: 30 }, human: true, startSide: 'atk' });
  m2.start();
  const me2 = m2.slots.find((s) => s.human);
  m2.choose(me2, { opId: op.id, kits: { ar: { sight: 'x20' } } });
  assert.equal(me2.kits.ar.sight, 'x20', 'con las guardadas del operador');
  const other = opsForSide('atk').find((o) => o.id !== op.id);
  m2.choose(me2, { opId: other.id });
  assert.deepEqual(me2.kits, {}, 'otro operador, de serie');
});

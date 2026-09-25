// Uso de gadgets y habilidades por los bots del ataque (F6.6b).
//
// Según el documento (sección 15): CHISPA lanza la PEM al muro reforzado antes de que TERMO
// ponga la carga térmica; ROMPE abre desde lejos barricadas y paredes blandas del sitio; el
// grupo lanza una cegadora antes de entrar (con el humo de NUBE y el escaneo de RADAR); una
// granada de fragmentación al defensor que se sabe escondido; MURALLA usa el destello del
// escudo a quemarropa; PULGA destruye gadgets con el rayo del dron de choque en la
// preparación; y tras plantar, una claymore en la entrada de la sala.
//
// Todo depende de la dificultad (tabla de bots.js): `kit` es la probabilidad de usar cada
// cosa, `kitLate` el retraso (en Normal, la cegadora sale un poco tarde y el grupo no la
// espera), `kitErr` el error al lanzar y `coord` la probabilidad de coordinarse (en Élite, el
// grupo espera a la cegadora y TERMO a la PEM). En Novato no usan nada.
//
// Cada uso es una acción breve (B.kit.act): ir a un punto si hace falta, encarar y pulsar G o
// X como un jugador; mientras dura, sustituye a la tarea del bot (salvo si entra en combate).
import { aimThrow } from './throws.js';
import { kitOf, roll, late, start, runAct } from './acts.js';
import { entrancesOf } from './tactics.js';
import { probe } from './gadgetai.js';
import { FLASH, EMP, THERMAL, SMOKE } from '../gadgets.js';
import { SCAN, SHOCK, BSHIELD } from '../abilities.js';
import { STANCES } from '../physics.js';
import { raycastFirst, lineOfSight } from '../../world/raycast.js';
import { SOLID, MAT, HARD, GLASS, BLAST_RES } from '../../world/materials.js';
import { angleDiff } from '../../core/math.js';

export { runAct };

const EYE = STANCES.stand.eye;
/**
 * Balance del ataque bot: el dron de choque de PULGA va a por los gadgets colocados (y las
 * cámaras que ha puesto la defensa), no a por las seis cámaras fijas del mapa (el jugador sí
 * puede). Con ellas, en Élite el ataque ganaba el 64 % de las rondas.
 */
export const KIT_TUNING = { zapFixedCams: false };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const has = (slot, id) => !!slot && slot.id === id && slot.left !== 0;
const inRoomXZ = (r, x, y, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && Math.abs(y - r.floorY) < 1.2;

function siteRooms(M, site) { return [site.A, site.B].map((id) => M.map.rooms.find((r) => r.id === id)).filter(Boolean); }
function matesNear(B, p, r) {
  return B.game.operators.some((o) => o.team === B.team && o.state !== 'dead' && Math.hypot(o.body.pos.x - p.x, o.body.pos.z - p.z) < r && Math.abs(o.body.pos.y - p.y) < 2.5);
}

// ====================================================================== entrada en grupo
/**
 * En la entrada, cuando el grupo va a pasar: reparte la cegadora, el humo de NUBE y el
 * escaneo de RADAR entre los que los llevan. Con coordinación, el grupo espera a que la
 * cegadora estalle (y el humo se abra); sin ella entran ya y los gadgets salen tarde.
 * Devuelve true si este bot ya puede entrar.
 */
export function entryGo(B) {
  const sq = B.sq, e = B.entry, now = B.game.time;
  if (!e || B.diff.kit <= 0) return true;
  const S = sq.kitEntry || (sq.kitEntry = new Map());
  let st = S.get(e);
  if (!st) {
    st = { t0: now, coord: B.rng.next() < B.diff.coord, jobs: [] };
    S.set(e, st);
    // (solo los que siguen fuera: quien ya ha entrado por su cuenta no lanza la de la entrada)
    const group = [...sq.brains.values()].filter((X) => X.side === 'atk' && X.entry === e && X.op.state === 'alive' && (X.stage === 'stack' || X.stage === 'approach'));
    const give = (X, kind) => {
      const job = { kind, entry: e, at: now + (st.coord ? 0 : late(X) * (kind === 'scan' ? 2 : 1)), readyAt: Infinity, st };
      kitOf(X).job = job;
      st.jobs.push(job);
    };
    const fl = group.find((X) => has(X.op.gadget, 'flash'));
    if (fl && B.rng.next() < B.diff.kit) give(fl, 'flash');
    const sm = group.find((X) => has(X.op.ability, 'remotesmoke') && X !== fl);
    if (sm && B.rng.next() < B.diff.kit * 0.8) give(sm, 'smoke');
    const sc = group.find((X) => has(X.op.ability, 'scan'));
    if (sc && !kitOf(sc).job && B.rng.next() < B.diff.kit) give(sc, 'scan');
  }
  if (!st.coord) return true;
  // (con tope: si algo falla, se entra igual a los 6 s)
  if (now - st.t0 > 6) return true;
  return st.jobs.every((j) => now >= j.readyAt);
}

// El trabajo de entrada que le toca a este bot (cegadora, humo o escaneo).
function runJob(B, K, now) {
  const J = K.job;
  K.job = null;
  const e = J.entry, op = B.op, world = B.game.world;
  const done = (at) => { J.readyAt = at; };
  const fail = () => { J.readyAt = now; };
  // hacia dentro por la puerta: del punto de delante (e) al de dentro (e.inside)
  const ix = e.inside.x - e.x, iz = e.inside.z - e.z, il = Math.hypot(ix, iz) || 1;
  const dir = { x: ix / il, z: iz / il };
  if (J.kind === 'scan') {
    if (!has(op.ability, 'scan')) return fail();
    start(B, { src: 'ability', yaw: op.yaw, pitch: op.pitch, hold: 0.1, say: 'Escaneando', onPress: () => { K.scanAt = B.game.time; done(B.game.time + SCAN.warn); } , fail });
    return;
  }
  if (J.kind === 'flash') {
    if (!has(op.gadget, 'flash')) return fail();
    // (tarde y ya dentro: la lanza hacia delante, por donde va)
    const inside = B.stage !== 'stack' && B.stage !== 'approach' && B.inside();
    const q = inside ? B.mover.ahead(5) : null;
    const target = q ? { x: q.x, y: q.y + 0.2, z: q.z } : { x: e.inside.x + dir.x * 2.5, y: e.y + 0.2, z: e.inside.z + dir.z * 2.5 };
    const err = B.diff.kitErr, a = B.rng.next() * Math.PI * 2, rr = B.rng.next() * err;
    target.x += Math.cos(a) * rr; target.z += Math.sin(a) * rr;
    const aim = (X) => { const r = aimThrow(world, X.op.eyePos(), target, { maxErr: 1.6 }); return r ? { yaw: r.yaw, pitch: r.pitch } : null; };
    const st = J.st;
    // (con coordinación, tras lanzarla vuelve a su sitio junto a la puerta, fuera de su vista)
    start(B, {
      src: 'gadget', at: inside ? null : { x: e.x, y: e.y, z: e.z }, aim, yaw: op.yaw, pitch: 0, hold: 0.25, say: '¡Cegadora!',
      onPress: () => { J.thrownAt = B.game.time; done(B.game.time + FLASH.fuse + 0.1); }, fail,
      then: () => { if (st.coord && !inside && B.stackAt) { K.sidePos = B.stackAt; K.sideUntil = B.game.time + FLASH.fuse; K.sideYaw = yawTo(e.x - e.inside.x, e.z - e.inside.z); } },
    });
    if (inside) { const r = aim(B); if (!r) { K.act = null; return fail(); } K.act.yaw = r.yaw; K.act.pitch = r.pitch; }
    return;
  }
  if (J.kind === 'smoke') {
    if (!has(op.ability, 'remotesmoke')) return fail();
    // al suelo, justo dentro de la puerta: tapa a quien vigila la entrada
    const target = { x: e.inside.x, y: e.y + 0.05, z: e.inside.z };
    const aim = (X) => {
      const E = X.op.eyePos(), dx = target.x - E.x, dy = target.y - E.y, dz = target.z - E.z, d = Math.hypot(dx, dy, dz);
      const hit = raycastFirst(world, E.x, E.y, E.z, dx / d, dy / d, dz / d, d + 1, SOLID, true);
      if (hit && hit.t < d - 1.2) return null;
      return { yaw: yawTo(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    };
    start(B, { src: 'ability', at: { x: e.x, y: e.y, z: e.z }, aim, yaw: op.yaw, pitch: 0, hold: 0.2, say: 'Humo en la entrada', onPress: () => done(B.game.time + SMOKE.grow * 0.6), fail });
  }
}

// ====================================================================== PEM + carga térmica
/**
 * Al empezar la acción, con el objetivo localizado: TERMO abre un muro reforzado del sitio
 * con su carga térmica y CHISPA (si está) le lanza antes la PEM al muro. Elige el panel
 * reforzado al que TERMO llega por fuera, cerca de él y del punto de plantado.
 */
export function planBreach(sq, atk) {
  const M = sq.match, D = sq.diff, rng = sq.game.rng;
  if (D.kit <= 0 || !M.recon.objectiveFound || !M.fort || !M.site) return;
  const termo = atk.find((B) => has(B.op.ability, 'thermal') && B.op.state === 'alive');
  if (!termo || rng.next() > D.kit) return;
  const rooms = siteRooms(M, M.site), w = M.world, nav = sq.nav;
  const tp = termo.op.body.pos, bomb = M.site.bombs.A;
  const chispa = atk.find((B) => B !== termo && has(B.op.ability, 'emp') && B.op.state === 'alive');
  const cp = chispa ? chispa.op.body.pos : null;
  const cands = [];
  for (const rec of M.fort.panels) {
    if (rec.kind !== 'wall') continue;
    const P = rec.panel, s = P.side, u = (P.u0 + P.u1) / 2;
    const at = (off) => (P.axisN === 0 ? { x: P.line + off, y: P.y0, z: u } : { x: u, y: P.y0, z: P.line + off });
    const def = at(s * 0.6), stand = at(-s * 0.75);
    if (!rooms.some((r) => inRoomXZ(r, def.x, def.y, def.z))) continue;           // lado de dentro: el sitio
    if (rooms.some((r) => inRoomXZ(r, stand.x, stand.y, stand.z))) continue;       // (no entre las dos salas)
    if (w.worldBoxHasSolid(stand.x - 0.3, stand.y + 0.02, stand.z - 0.3, stand.x + 0.3, stand.y + 1.8, stand.z + 0.3)) continue;
    const n = nav.nearest(stand.x, stand.y, stand.z, 0.45, 0.4);
    if (!n || !n.alive || n.crouch) continue;
    const dir = P.axisN === 0 ? { x: s, z: 0 } : { x: 0, z: s };
    // (cerca de TERMO, de CHISPA si va y del punto de plantado)
    const far = (q) => Math.hypot(stand.x - q.x, stand.z - q.z) + Math.abs(stand.y - q.y) * 4;
    cands.push({ rec, stand, dir, face: yawTo(dir.x, dir.z), s: far(tp) + (cp ? far(cp) * 0.8 : 0) + Math.hypot(stand.x - bomb.x, stand.z - bomb.z) * 0.5 });
  }
  cands.sort((a, b) => a.s - b.s);
  // el primero al que hay ruta de verdad
  let pick = null;
  for (const c of cands.slice(0, 4)) {
    const r = nav.path(tp, c.stand, { raw: true });
    const last = r && r.points[r.points.length - 1];
    if (last && Math.hypot(last.x - c.stand.x, last.z - c.stand.z) < 0.8 && Math.abs(last.y - c.stand.y) < 0.6) { pick = c; break; }
  }
  if (!pick) return;
  const S = {
    ...pick, t0: sq.game.time, coord: rng.next() < D.coord, empAt: null, done: false, termo,
    // la PEM, contra la cara del muro a la altura de la carga: rebota y cae al pie
    wallPt: { x: pick.stand.x + pick.dir.x * 0.6, y: pick.stand.y + 1.2, z: pick.stand.z + pick.dir.z * 0.6 },
  };
  // (punto al que retirarse antes de encender: a más de 2 m de la carga y donde se pueda estar)
  for (const [bk, lat] of [[2.4, 0], [2.4, 0.8], [2.4, -0.8], [2.8, 0], [2.2, 1.2], [2.2, -1.2], [3.2, 0]]) {
    const q = { x: pick.stand.x - pick.dir.x * bk + pick.dir.z * lat, y: pick.stand.y, z: pick.stand.z - pick.dir.z * bk + pick.dir.x * lat };
    if (w.worldBoxHasSolid(q.x - 0.3, q.y + 0.02, q.z - 0.3, q.x + 0.3, q.y + 1.8, q.z + 0.3)) continue;
    const n = nav.nearest(q.x, q.y, q.z, 0.45, 0.4);
    if (!n || !n.alive) continue;
    S.back = q;
    break;
  }
  if (!S.back) S.back = { x: pick.stand.x - pick.dir.x * 2.4, y: pick.stand.y, z: pick.stand.z - pick.dir.z * 2.4 };
  termo.breach = { role: 'thermal', S, phase: 'go', tries: 0 };
  termo.stage = 'breach';
  // punto desde el que CHISPA lanza la PEM al pie del muro (detrás de TERMO, a un lado)
  for (const [bk, lat] of [[1.4, 0.8], [1.4, -0.8], [2.0, 0], [2.2, 1.0], [2.2, -1.0]]) {
    const q = { x: pick.stand.x - pick.dir.x * bk + pick.dir.z * lat, y: pick.stand.y, z: pick.stand.z - pick.dir.z * bk + pick.dir.x * lat };
    if (w.worldBoxHasSolid(q.x - 0.3, q.y + 0.02, q.z - 0.3, q.x + 0.3, q.y + 1.8, q.z + 0.3)) continue;
    const n = nav.nearest(q.x, q.y, q.z, 0.45, 0.4);
    if (!n || !n.alive) continue;
    if (!aimThrow(w, { x: q.x, y: q.y + EYE, z: q.z }, S.wallPt, { maxErr: 1.2, lob: true, maxT: EMP.fuse - 0.3 })) continue;
    S.empSpot = q;
    break;
  }
  if (chispa && S.empSpot && (S.coord || rng.next() < D.kit)) {
    S.chispa = chispa;
    chispa.breach = { role: 'emp', S, phase: 'go', at: sq.game.time + (S.coord ? 0 : late(chispa) * 3) };
    chispa.stage = 'breach';
  }
}

// Punto de la cara del muro (por fuera) frente a `p` (una batería, un inhibidor, la carga).
function faceOf(S, p) {
  const P = S.rec.panel, off = P.line - P.side * 0.35;
  return P.axisN === 0 ? { x: off, y: S.stand.y + 1.0, z: p.z } : { x: p.x, y: S.stand.y + 1.0, z: off };
}
// Batería de la defensa encendida junto al panel (el muro está electrificado), o null.
function liveBattery(S, G, team) {
  const c = { x: S.stand.x + S.dir.x * 0.75, y: S.stand.y + 1.2, z: S.stand.z + S.dir.z * 0.75 };
  return G.placed.find((q) => q.alive && q.kind === 'battery' && q.team !== team && !G.isOff(q) && Math.hypot(q.pos.x - c.x, q.pos.y - c.y, q.pos.z - c.z) < 3) || null;
}
// TERMO pide (otra) PEM a CHISPA, contra `at` (su carga o el muro). false si no puede.
function requestEmp(S, now, at) {
  const C = S.chispa;
  if (!C || C.op.state !== 'alive' || !C.breach || !has(C.op.ability, 'emp')) return false;
  if (at) S.wallPt = at;
  S.empAt = null; S.coord = true;
  C.breach.phase = 'go'; C.breach.at = now; C.breach.walkT = 0; C.breach.aimT = 0;
  return true;
}
function endBreach(B) {
  B.breach = null;
  B.stage = 'clear';
  B.thinkT = 0;
  if (B.kit && B.kit.act && B.kit.act.breach) B.kit.act = null;
}
/** Atascado varias veces de camino al muro: se deja la brecha (TERMO la da por terminada). */
export function breachStuck(B) {
  const b = B.breach;
  if (!b) { B.stage = 'clear'; return; }
  b.stuck = (b.stuck || 0) + 1;
  if (b.stuck < 3) return;
  if (b.role === 'thermal') b.S.done = true;
  endBreach(B);
}

/** Tarea 'breach' de TERMO (poner, retirarse, encender, esperar el boquete) o de CHISPA (PEM). */
export function breachTick(B, dt) {
  const b = B.breach, op = B.op, now = B.game.time, G = B.game.gadgets;
  if (!b) { endBreach(B); return; }
  const S = b.S;
  if (S.done || now - S.t0 > 50) { endBreach(B); return; }
  const K = kitOf(B);
  if (K.act) return;          // (lo hace runAct)
  if (b.role === 'emp') {
    const spot = S.empSpot;
    if (b.phase === 'go') {
      if (now < b.at) { B._stand(dt); B._idleLook(dt, S.face); return; }
      if (!has(op.ability, 'emp')) { b.phase = 'cover'; return; }
      b.walkT = (b.walkT || 0) + dt;
      if (b.walkT > 35) { b.phase = 'cover'; return; }
      // de camino al punto; en cuanto tiene tiro al pie del muro (a menos de 14 m), la lanza
      // (coordinados: cuando TERMO ya está en el muro, para que la PEM le dure mientras abre)
      b.aimT = (b.aimT || 0) - dt;
      const e = op.eyePos(), T = S.termo;
      const termoReady = !S.coord || !T || !T.breach || T.op.state !== 'alive' || T.breach.phase !== 'go' || Math.hypot(T.op.body.pos.x - S.stand.x, T.op.body.pos.z - S.stand.z) < 4;
      // (y desde el lado del ataque: desde dentro rebotaría hacia la sala)
      const outside = (e.x - S.stand.x - S.dir.x * 0.75) * S.dir.x + (e.z - S.stand.z - S.dir.z * 0.75) * S.dir.z < -0.4;
      if (termoReady && outside && b.aimT <= 0 && Math.hypot(S.wallPt.x - e.x, S.wallPt.z - e.z) < 14 && Math.abs(S.wallPt.y - op.body.pos.y) < 2.5) {
        b.aimT = 0.4;
        const r = aimThrow(B.game.world, e, S.wallPt, { maxErr: 1.2, lob: true, maxT: EMP.fuse - 0.3 });
        if (r) {
          start(B, { breach: true, src: 'ability', yaw: r.yaw, pitch: r.pitch, hold: 0.3, say: 'PEM al muro', onPress: () => { S.empAt = B.game.time + EMP.fuse; b.phase = 'cover'; }, fail: () => { b.aimT = 0.6; } });
          return;
        }
      }
      if (Math.hypot(spot.x - op.body.pos.x, spot.z - op.body.pos.z) > 0.5) B._goto(spot, dt, { r: 0.3, sprint: B.mover.remaining > 6 });
      else { B._stand(dt); op.intent.stance = 'crouch'; B._idleLook(dt, S.face); }
      return;
    }
    // cubrir a TERMO hasta que se abra el muro
    if (Math.hypot(spot.x - op.body.pos.x, spot.z - op.body.pos.z) > 0.8) { B._goto(spot, dt, { r: 0.4 }); return; }
    B._stand(dt);
    op.intent.stance = 'crouch';
    B._idleLook(dt, S.face);
    const T = S.termo;
    if (!T || T.op.state === 'dead' || !T.breach || (T.task && T.task.kind !== 'breach')) endBreach(B);
    return;
  }
  // ---- TERMO
  const p = op.body.pos;
  // su carga (puesta o ya ardiendo)
  const mine = G.placed.find((c) => c.alive && c.owner === op && c.kind === 'thermal') || null;
  switch (b.phase) {
    case 'go': {
      if (Math.hypot(S.stand.x - p.x, S.stand.z - p.z) > 0.25) {
        b.walkT = (b.walkT || 0) + dt;
        if (b.walkT > 30) { S.done = true; endBreach(B); return; }
        B._goto(S.stand, dt, { r: 0.2, exact: true, sprint: B.mover.remaining > 8 });
        return;
      }
      b.phase = 'wait'; b.waitT = 0;
      B.sq.radio.say(op, 'kit', 'Abro el muro reforzado', { cooldown: 5 });
      return;
    }
    case 'wait': {
      // coordinado: espera a que la PEM de CHISPA estalle (con tope)
      B._stand(dt);
      B._turn(S.face, 0, 6, dt);
      b.waitT += dt;
      const chispaOk = S.chispa && S.chispa.op.state === 'alive' && S.chispa.breach;
      const empDone = S.empAt !== null && now >= S.empAt + 0.2;
      if (!S.coord || !chispaOk || empDone || b.waitT > 12) b.phase = mine ? 'retreat' : 'place';
      return;
    }
    case 'place': {
      if (mine) { b.phase = 'retreat'; return; }
      if (!has(op.ability, 'thermal') || b.tries >= 3) { S.done = true; endBreach(B); return; }
      b.tries++;
      const left = op.ability.left;
      // (si al terminar de ponerla ya no está —se ha gastado y la ha destruido la batería— el muro está electrificado)
      const after = () => { b.phase = G.thermalOf(op) ? 'retreat' : op.ability.left < left ? 'lost' : 'place'; };
      start(B, { breach: true, src: 'ability', at: S.stand, yaw: S.face, pitch: -0.1, hold: 0.2, timeout: 8, then: after, fail: after });
      return;
    }
    case 'lost':
    case 'retreat': {
      if (!mine) {
        // ¿la ha destruido una batería? (si no, un disparo: se pone otra)
        const bat = liveBattery(S, G, op.team);
        if (!bat) { b.phase = 'place'; return; }
        // muro electrificado: una PEM contra la batería antes de gastar otra carga
        if (!(S.empAt !== null && now < S.empAt + 0.5) && requestEmp(S, now, faceOf(S, bat.pos))) {
          b.phase = 'wait'; b.waitT = 0;
          B.sq.radio.say(op, 'kit', 'Muro electrificado: PEM', { cooldown: 5 });
          return;
        }
        S.done = true; endBreach(B); return;
      }
      if (mine.burning) { b.phase = 'burn'; b.burnT = 0; return; }
      if (b.tries >= 6) { S.done = true; endBreach(B); return; }
      // un inhibidor no la deja encender: otra PEM, contra la carga
      const jam = G.jammedAt(mine.pos, op.team);
      if (jam) {
        if ((S.empAt === null || now > S.empAt + 1) && !b.jamAsked && requestEmp(S, now, faceOf(S, jam.pos))) {
          b.jamAsked = true; b.phase = 'wait'; b.waitT = 0;
          B.sq.radio.say(op, 'kit', 'Inhibidor: PEM a la carga', { cooldown: 5 });
          return;
        }
        if (!(S.empAt !== null && now < S.empAt + 1)) { S.done = true; endBreach(B); return; }
      }
      b.tries++;
      start(B, { breach: true, src: 'ability', at: S.back, r: 0.6, yaw: S.face, pitch: 0, hold: 0.2, timeout: 8, noCheck: true });
      return;
    }
    case 'burn': {
      b.burnT += dt;
      B._stand(dt);
      op.intent.stance = 'crouch';
      B._idleLook(dt, S.face);
      if (!mine || b.burnT > THERMAL.fuse + 1.5) { S.done = true; endBreach(B); }
      return;
    }
    default: endBreach(B);
  }
}

// ====================================================================== oportunidades
/** Decisiones de gadgets de un bot del ataque (cada tick; las caras, cada 0,5 s). */
export function kitThink(B, dt) {
  if (B.side !== 'atk' || B.diff.kit <= 0 || B.post) return;       // (los puestos fijos son de las pruebas)
  const M = B.match, ph = M.phase;
  if (ph !== 'action' && ph !== 'planted') return;
  const op = B.op;
  if (op.state !== 'alive' || op.frozen) return;
  const K = kitOf(B), now = B.game.time;
  muraFlash(B, K, now);
  if (B.diff.coord > 0) watchFlashes(B, K, now);
  if (K.act || B.target) return;
  if (K.job && now >= K.job.at) { runJob(B, K, now); if (K.act) return; }
  K.t -= dt;
  if (K.t > 0) return;
  K.t = 0.5;
  if (ph === 'planted') { claymore(B, K) || scanNear(B, K, now); return; }
  if (B.stage === 'breach') return;
  rompe(B, K) || frag(B, K, now) || scanNear(B, K, now) || flashRoom(B, K);
}

// Con coordinación, darse la vuelta ante una cegadora del equipo a punto de estallar a la vista.
function watchFlashes(B, K, now) {
  if (K.avertUntil > now) return;
  const e = B.op.eyePos(), w = B.game.world;
  for (const it of B.game.gadgets.items) {
    if (it.kind !== 'flash' || !it.alive || it.team !== B.team || it.t < FLASH.fuse - 0.7) continue;
    const dx = e.x - it.pos.x, dz = e.z - it.pos.z;
    if (Math.hypot(dx, e.y - it.pos.y, dz) > FLASH.range || !lineOfSight(w, it.pos.x, it.pos.y + 0.05, it.pos.z, e.x, e.y, e.z)) continue;
    if (!roll(B, 'avert:' + it.id, B.diff.coord)) continue;
    K.avertUntil = now + (FLASH.fuse - it.t) + 0.15;
    K.avertYaw = yawTo(dx, dz);
    return;
  }
}
/** Apartándose o dándose la vuelta ante una cegadora propia (true mientras dura). */
export function avert(B, dt) {
  const K = B.kit, now = B.game.time;
  if (!K || B.target) return false;
  if (K.sideUntil > now) {
    const p = B.op.body.pos, q = K.sidePos;
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.3) { B._goto(q, dt, { r: 0.2, exact: true, sprint: true }); return true; }
    B._stand(dt);
    B.op.intent.stance = 'crouch';
    B._turn(K.sideYaw, 0, 10, dt);
    return true;
  }
  if (!(K.avertUntil > now)) return false;
  B._stand(dt);
  B._turn(K.avertYaw, 0, 12, dt);
  return true;
}

// MURALLA: destello del escudo contra el defensor que tiene delante a menos de 5 m.
function muraFlash(B, K, now) {
  const op = B.op, t = B.target;
  if (!has(op.ability, 'shield')) return;
  if (!t || t.state !== 'alive') { K.flashTgt = null; return; }
  if (K.flashTgt !== t) { K.flashTgt = t; K.flashAt = B.rng.next() < B.diff.kit ? now + late(B) : Infinity; }
  if (now < K.flashAt || op.flashT > 0 || (op.abilityCd || 0) > 0 || op.sprinting) return;
  const p = op.body.pos, q = t.body.pos, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
  if (d > BSHIELD.range - 0.5) return;
  if ((dx * -Math.sin(op.yaw) + dz * -Math.cos(op.yaw)) / (d || 1) < 0.75) return;
  op.intent.ability = true;
  K.flashAt = Infinity;
}

// Objetivos de ROMPE en el sitio: barricadas de puertas y ventanas y paredes blandas (por fuera).
function rompeTargets(sq, site) {
  if (sq.kitTargets && sq.kitTargets.site === site) return sq.kitTargets.list;
  const M = sq.match, map = M.map, rooms = siteRooms(M, site), list = [];
  for (const r of rooms) {
    for (const e of entrancesOf(map, r)) {
      if (e.kind !== 'door' && e.kind !== 'window') continue;
      const o = e.opening;
      if (rooms.some((q) => q !== r && inRoomXZ(q, e.x - e.nx, r.floorY, e.z - e.nz))) continue;     // (entre las dos salas)
      list.push({ kind: 'barricade', key: 'b' + e.x.toFixed(1) + ',' + e.z.toFixed(1) + ',' + r.floorY, pt: { x: e.x, y: (o.y0 + o.y1) / 2, z: e.z }, door: e.kind === 'door' });
    }
  }
  if (M.fort) {
    for (const t of M.fort.planFor(rooms).walls) {
      const P = t.panel, s = P.side, u = (P.u0 + P.u1) / 2, y = P.y0 + 1.25;
      const pt = P.axisN === 0 ? { x: P.line - s * 0.14, y, z: u } : { x: u, y, z: P.line - s * 0.14 };
      if (rooms.some((q) => inRoomXZ(q, pt.x - (P.axisN === 0 ? s : 0) * 0.5, P.y0, pt.z - (P.axisN === 2 ? s : 0) * 0.5))) continue;
      list.push({ kind: 'wall', key: 'w' + P.line + ',' + P.u0 + ',' + P.y0, pt });
    }
  }
  list.sort((a, b) => (a.kind === 'barricade' ? (a.door ? 0 : 1) : 2) - (b.kind === 'barricade' ? (b.door ? 0 : 1) : 2));
  sq.kitTargets = { site, list };
  return list;
}
// ROMPE: proyectil de brecha a una barricada o pared blanda del sitio que ve desde lejos.
function rompe(B, K) {
  const op = B.op;
  if (!has(op.ability, 'breachround') || (op.abilityCd || 0) > 0 || B.game.time < (K.rompeNext || 0)) return false;
  if (!(B.stage === 'approach' || B.stage === 'stack' || B.stage === 'clear')) return false;
  const M = B.match, site = B.sq.atkTargetSite();
  if (!site || !M.recon.objectiveFound) return false;
  const e = op.eyePos(), w = B.game.world;
  for (const T of rompeTargets(B.sq, site)) {
    if (T.done) continue;
    const dx = T.pt.x - e.x, dy = T.pt.y - e.y, dz = T.pt.z - e.z, d = Math.hypot(dx, dy, dz);
    if (d < 4 || d > 22) continue;
    const hit = raycastFirst(w, e.x, e.y, e.z, dx / d, dy / d, dz / d, d + 0.6, SOLID, true);
    if (!hit || Math.abs(hit.t - d) > 0.45) continue;                    // lo primero que se ve es el objetivo
    const m = hit.mat;
    // (una ventana: por fuera se ve el cristal y la barricada está justo detrás; la explosión se lleva las dos)
    const behind = (k) => w.getWorld(e.x + dx / d * (hit.t + k), e.y + dy / d * (hit.t + k), e.z + dz / d * (hit.t + k));
    const barricade = m === MAT.BARRICADE || (GLASS[m] && [0.1, 0.2, 0.3].some((k) => behind(k) === MAT.BARRICADE));
    if (T.kind === 'barricade' ? !barricade : (HARD[m] || GLASS[m] || m === MAT.REINFORCED || BLAST_RES[m] > 0)) continue;
    if (T.kind === 'wall' && w.getWorld(T.pt.x + dx / d * 0.2, T.pt.y + dy / d * 0.2, T.pt.z + dz / d * 0.2) === MAT.REINFORCED) { T.done = true; continue; }
    if (matesNear(B, T.pt, 3)) continue;
    if (!roll(B, 'rompe:' + T.key, B.diff.kit)) continue;
    const err = B.diff.kitErr * 0.02;
    start(B, {
      src: 'ability', yaw: yawTo(dx, dz) + (B.rng.next() - 0.5) * err, pitch: Math.atan2(dy, Math.hypot(dx, dz)) + (B.rng.next() - 0.5) * err,
      delay: late(B) * 0.5, hold: 0.2, say: T.kind === 'barricade' ? 'Abro la barricada' : 'Abro la pared', onPress: () => { T.done = true; K.rompeNext = B.game.time + 12; },
    });
    return true;
  }
  return false;
}

// Granada de fragmentación al defensor que el equipo sabe dónde está y no se ve (tras cobertura).
const FRAG_OFFS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4], [2, 0], [-2, 0], [0, 2], [0, -2]];
function frag(B, K, now) {
  const op = B.op;
  if (!has(op.gadget, 'frag') || (op.gadgetCd || 0) > 0 || now < K.fragNext) return false;
  K.fragNext = now + 2;
  const e = op.eyePos(), w = B.game.world;
  for (const k of B.board.recent(now, 2.5)) {
    if (!k.precise || !k.op || k.op.state !== 'alive') continue;
    const d = Math.hypot(k.x - e.x, k.z - e.z);
    if (d < 5 || d > 15 || Math.abs(k.y - op.body.pos.y) > 2.5) continue;
    if (lineOfSight(w, e.x, e.y, e.z, k.x, k.y + 1.1, k.z)) continue;      // si se ve, mejor disparar
    if (matesNear(B, k, 4.5)) continue;
    // un punto de caída a menos de 2 m de él al que llegue el tiro (p. ej. por una puerta, si está
    // tras la esquina); como mucho 5 puntos por intento (el resto, en el siguiente)
    let aim = null, tried = 0;
    const offs = FRAG_OFFS, n0 = K.fragOff || 0;
    for (let i = 0; i < offs.length && tried < 5 && !aim; i++) {
      const [ox, oz] = offs[(n0 + i) % offs.length];
      const q = { x: k.x + ox, y: k.y + 0.1, z: k.z + oz };
      if (SOLID[w.getWorld(q.x, q.y + 0.3, q.z)] || matesNear(B, q, 3.5)) continue;
      tried++;
      K.fragOff = (n0 + i + 1) % offs.length;
      aim = aimThrow(w, e, q, { maxErr: 1.0, lob: true, maxT: 2.5 });
      if (aim && Math.hypot(aim.hit.pos.x - k.x, aim.hit.pos.z - k.z) >= 2.2) aim = null;
    }
    if (!aim) { K.fragNext = now + 0.5; continue; }
    if (B.rng.next() > B.diff.kit * 0.8) { K.fragNext = now + 4; return false; }
    // (con el error de la dificultad)
    const er = (B.rng.next() - 0.5) * B.diff.kitErr * 0.12;
    start(B, { src: 'gadget', yaw: aim.yaw + er, pitch: aim.pitch + er * 0.5, hold: 0.3, say: '¡Granada!' });
    K.fragNext = now + 8;
    return true;
  }
  return false;
}

// RADAR: escaneo al llegar cerca del sitio (y tras plantar, cuando vienen a desactivar).
function scanNear(B, K, now) {
  const op = B.op, M = B.match;
  if (!has(op.ability, 'scan') || (op.abilityCd || 0) > 0 || now - K.scanAt < 12) return false;
  if (M.abilities && M.abilities.scans.some((s) => s.owner === op)) return false;
  const site = M.phase === 'planted' ? M.site : B.sq.atkTargetSite();
  if (!site || !M.recon.objectiveFound) return false;
  const a = site.bombs.A, b = site.bombs.B, p = op.body.pos;
  const d = Math.hypot((a.x + b.x) / 2 - p.x, (a.z + b.z) / 2 - p.z);
  if (d > 16 || Math.abs(a.y - p.y) > 4) return false;
  if (!roll(B, 'scan:' + Math.floor(now / 12), B.diff.kit * 0.7)) return false;
  op.intent.ability = true;
  K.scanAt = now;
  B.sq.radio.say(op, 'kit', 'Escaneando', { cooldown: 5 });
  return true;
}

// Cegadora a la sala del sitio antes de cruzar su puerta (si la ruta entra en ella a 2–6 m).
function flashRoom(B, K) {
  const op = B.op;
  if (B.stage !== 'clear' || K.roomFlashed || !has(op.gadget, 'flash') || (op.gadgetCd || 0) > 0) return false;
  const site = B.sq.atkTargetSite(), M = B.match;
  if (!site) return false;
  const room = M.map.rooms.find((r) => r.id === site[B.siteRoomKey || 'A']);
  if (!room || B.inRoom(room)) return false;
  const mv = B.mover, path = mv.path;
  if (!path) return false;
  let d = 0, prev = op.body.pos, q = null, from = null;
  for (let k = mv.i; k < path.length && d < 7; k++) {
    const c = path[k];
    d += Math.hypot(c.x - prev.x, c.z - prev.z);
    if (inRoomXZ(room, c.x, c.y, c.z)) { q = c; from = prev; break; }
    prev = c;
  }
  if (!q || d < 2) return false;
  if (!roll(B, 'rflash', B.diff.kit)) { K.roomFlashed = true; return false; }
  const vx = q.x - from.x, vz = q.z - from.z, vl = Math.hypot(vx, vz) || 1;
  const a = B.rng.next() * Math.PI * 2, rr = B.rng.next() * B.diff.kitErr;
  const target = { x: q.x + vx / vl * 2 + Math.cos(a) * rr, y: room.floorY + 0.2, z: q.z + vz / vl * 2 + Math.sin(a) * rr };
  const aim = aimThrow(B.game.world, op.eyePos(), target, { maxErr: 1.4 });
  if (!aim) return false;             // (desde aquí no entra: se vuelve a probar un poco más adelante)
  K.roomFlashed = true;
  // con coordinación se da la vuelta y espera a que estalle; si no, sigue y puede cegarse
  const coord = B.rng.next() < B.diff.coord;
  start(B, { src: 'gadget', yaw: aim.yaw, pitch: aim.pitch, hold: coord ? FLASH.fuse + 0.1 : 0.3, away: coord, say: '¡Cegadora!' });
  return true;
}

// Tras plantar: una claymore junto a una entrada de la sala, mirando hacia la puerta.
function claymore(B, K) {
  const op = B.op, M = B.match;
  if (K.clay || !has(op.gadget, 'claymore')) return false;
  K.clay = true;
  if (B.rng.next() > B.diff.kit) return false;
  const P = M.defuser && M.defuser.plantPos;
  if (!P) return false;
  const room = M.map.rooms.find((r) => inRoomXZ(r, P.x, P.y, P.z));
  if (!room) return false;
  const p = op.body.pos;
  const ents = entrancesOf(M.map, room).filter((e) => e.kind === 'door' || e.kind === 'arch')
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  const G = B.game.gadgets, w = B.game.world;
  for (const e of ents) {
    const stand = { x: e.x + e.nx * 1.3, y: room.floorY, z: e.z + e.nz * 1.3 }, face = yawTo(-e.nx, -e.nz);
    if (w.worldBoxHasSolid(stand.x - 0.3, stand.y + 0.02, stand.z - 0.3, stand.x + 0.3, stand.y + 1.8, stand.z + 0.3)) continue;
    const spot = G.placeSpot(probe(op, stand, face, 0), 'claymore');
    if (!spot || !spot.ok) continue;
    start(B, { src: 'gadget', at: stand, yaw: face, pitch: 0, hold: 0.2, timeout: 12, say: 'Claymore en la puerta' });
    return true;
  }
  return false;
}

// ====================================================================== dron de choque (PULGA)
/**
 * En la preparación: el dron de choque de PULGA apunta a los gadgets de la defensa (y a sus
 * cámaras) que ve a menos de 8 m y los destruye con el rayo. true mientras apunta.
 */
export function droneZap(B, d, S, dt) {
  if (!d.shock || B.diff.kit <= 0) return false;
  const a = B.op.ability;
  if (!a || a.id !== 'shockdrone' || a.left <= 0) { S.zapTgt = null; return false; }
  const K = kitOf(B), g = B.game;
  S.zapT = (S.zapT || 0) - dt;
  if (S.zapTgt && (!S.zapTgt.alive || (S.zapShots || 0) >= 3)) {
    // (tres rayos sin destruirlo, p. ej. inhibido: se olvida de él)
    if (S.zapTgt.alive) K.rolls.set('zap:' + (S.zapTgt.gadget ? S.zapTgt.gadget.id : S.zapTgt.id), false);
    S.zapTgt = null;
  }
  if (!S.zapTgt && S.zapT <= 0) {
    S.zapT = 0.4;
    const e = d.eyePos();
    let best = null, bd = SHOCK.range - 0.4;
    for (const tg of g.targets) {
      if (!tg.alive || (tg.kind !== 'gadget' && tg.kind !== 'cam') || tg.team === B.team || tg.indestructible) continue;
      if (tg.kind === 'cam' && !tg.fromGadget && !KIT_TUNING.zapFixedCams) continue;
      const c = tg.center ? tg.center() : tg.pos;
      const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
      if (dist > bd) continue;
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
      if (!lineOfSight(g.world, e.x, e.y, e.z, c.x - dx / dist * 0.1, c.y - dy / dist * 0.1, c.z - dz / dist * 0.1)) continue;
      if (!roll(B, 'zap:' + (tg.gadget ? tg.gadget.id : tg.id), B.diff.kit)) continue;
      bd = dist; best = tg;
    }
    S.zapTgt = best; S.zapShots = 0;
  }
  const T = S.zapTgt;
  if (!T) return false;
  const e = d.eyePos(), c = T.center ? T.center() : T.pos;
  const want = yawTo(c.x - e.x, c.z - e.z), wantP = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  const rate = 2 + B.diff.turn * 0.4;
  d.yaw += Math.max(-dt * rate, Math.min(dt * rate, angleDiff(d.yaw, want)));
  d.pitch += Math.max(-dt * rate, Math.min(dt * rate, wantP - d.pitch));
  if (Math.abs(angleDiff(d.yaw, want)) < 0.03 && Math.abs(wantP - d.pitch) < 0.03 && (d.zapCd || 0) <= 0) { d.intent.zap = true; S.zapShots = (S.zapShots || 0) + 1; }
  return true;
}

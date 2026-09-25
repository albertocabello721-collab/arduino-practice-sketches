// Contrajuego y gadgets de acción de la defensa bot (F6.6c).
//
// · Al oír el aviso del escaneo de RADAR, los defensores se quedan quietos mientras dura (quien
//   se mueve queda marcado). En Élite, desde el aviso; en Normal, a veces y tarde.
// · Disparan a las cargas de brecha, térmicas y claymores del ataque que ven.
// · REMEDIO levanta con estimulantes a los derribados que ve (y cura a quien va mal de vida).
// · VOLTIO y OJO detonan su C4 (pegada en la preparación junto a una puerta del sitio) cuando
//   saben de un atacante al otro lado.
// · CORAZA, tras el plantado, lanza granadas de impacto a los atacantes que guardan el
//   desactivador (en la preparación ya ha abierto un hueco entre las dos salas del sitio).
// · «Poner gadget aquí» (rueda H): el aliado bot más cercano con algo que poner o lanzar allí
//   lo hace (también en el ataque).
// Todo según la dificultad (kit, kitLate, kitErr, coord de bots.js); en Novato, nada.
import { kitOf, roll, late, start } from './acts.js';
import { aimThrow } from './throws.js';
import { probe } from './gadgetai.js';
import { C4, PLACE_LABEL } from '../gadgets.js';
import { STIM } from '../abilities.js';
import { STANCES } from '../physics.js';
import { lineOfSight } from '../../world/raycast.js';
import { SOLID } from '../../world/materials.js';
import { angleDiff, clamp } from '../../core/math.js';

const EYE = STANCES.stand.eye;
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const has = (slot, id) => !!slot && slot.id === id && slot.left !== 0;

// Posiciones de los enemigos que el bot conoce ahora (los ve, los ha oído o su equipo los ha
// marcado hace menos de `maxAge` s).
export function knownEnemies(B, now, maxAge) {
  const out = [];
  for (const t of B.per.visible) if (t.state !== 'dead') out.push({ op: t, x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z });
  for (const [t, m] of B.per.memory) if (t.state !== 'dead' && now - m.t <= maxAge) out.push({ op: t, x: m.x, y: m.y, z: m.z });
  for (const k of B.board.recent(now, maxAge)) out.push(k);
  return out;
}
function matesNear(B, p, r, dy = 2.5) {
  return B.game.operators.some((o) => o.team === B.team && o.state !== 'dead' && Math.hypot(o.body.pos.x - p.x, o.body.pos.z - p.z) < r && Math.abs(o.body.pos.y - p.y) < dy);
}

// ====================================================================== escaneo
/**
 * Aviso de escaneo de RADAR: los defensores bot que se dan cuenta se quedan quietos mientras
 * dure. Coordinados, desde el aviso; si no, reaccionan tarde (con el escaneo ya activo).
 */
export function scanWarned(sq, s) {
  const now = sq.game.time;
  for (const B of sq.brains.values()) {
    if (B.team === s.team || B.op.state !== 'alive' || B.diff.kit <= 0) continue;
    if (B.rng.next() >= B.diff.kit) continue;                 // (no se da cuenta)
    const from = B.rng.next() < B.diff.coord ? now : s.from + late(B);
    B.scanFreeze = { from, until: s.until + 0.15 };
  }
}
/** ¿Quieto ahora por un escaneo? */
export function scanFrozen(B) {
  const f = B.scanFreeze;
  if (!f) return false;
  const now = B.game.time;
  if (now >= f.until || B.op.state !== 'alive') { B.scanFreeze = null; return false; }
  return now >= f.from;
}

// ====================================================================== disparar a los gadgets
/** La carga o claymore del ataque que el defensor ve (a menos de 14 m) y a la que disparará. */
export function spotGadget(B) {
  B.gadgetTgt = null;
  if (B.side !== 'def' || B.target || B.diff.kit <= 0) return;
  const op = B.op, e = op.eyePos(), g = B.game;
  const vx = -Math.sin(op.yaw), vz = -Math.cos(op.yaw), cosFov = Math.cos(B.diff.fov);
  let bd = 14;
  for (const tg of g.targets) {
    if (tg.kind !== 'gadget' || !tg.alive || tg.team === B.team || tg.indestructible || tg.ignoreBullets) continue;
    const c = tg.center();
    const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, dist = Math.hypot(dx, dy, dz);
    if (dist > bd || dist < 0.5) continue;
    if ((dx * vx + dz * vz) / Math.max(0.001, Math.hypot(dx, dz)) < cosFov) continue;
    // (hasta un poco antes: pegada a la pared, el centro casi toca el vóxel)
    const k = 1 - 0.14 / dist;
    if (!lineOfSight(g.world, e.x, e.y, e.z, e.x + dx * k, e.y + dy * k, e.z + dz * k)) continue;
    if (!roll(B, 'shoot:' + tg.gadget.id, B.diff.kit)) continue;
    bd = dist; B.gadgetTgt = tg;
  }
}
/** Disparar a esa carga (como a un dron: parado, apuntando y en ráfagas cortas). */
export function shootGadget(B, dt) {
  const tg = B.gadgetTgt, op = B.op, I = op.intent, D = B.diff;
  if (B.mover.busy) B.mover.stop();
  I.moveX = 0; I.moveZ = 0; I.sprint = false;
  if (B.gadgetSeen !== tg) { B.gadgetSeen = tg; B.gadgetT = 0; }
  B.gadgetT += dt;
  const e = op.eyePos(), c = tg.center();
  const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, dist);
  op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * D.turn, dt * D.turn);
  op.pitch += clamp(wantPitch - op.pitch, -dt * D.turn, dt * D.turn);
  I.ads = dist > 4;
  const tol = clamp(0.08 / Math.max(1, Math.hypot(dx, dy, dz)), 0.006, 0.03);
  if (B.gadgetT > D.react + 0.3 && Math.abs(angleDiff(op.yaw, wantYaw)) < tol && Math.abs(wantPitch - op.pitch) < tol * 1.2) {
    B.semi = !B.semi;
    I.fire = op.weapon.def.auto ? true : B.semi;
  }
  if (op.weapon.ammo === 0) I.reload = true;
}

// ====================================================================== en la acción
/** Contrajuego y gadgets de acción de un bot de la defensa (en la acción y tras el plantado). */
export function defKitThink(B, dt) {
  if (B.side !== 'def' || B.diff.kit <= 0 || B.post) return;
  const M = B.match, ph = M.phase;
  if (ph !== 'action' && ph !== 'planted') return;
  const op = B.op;
  if (op.state !== 'alive' || op.frozen) return;
  const K = kitOf(B), now = B.game.time;
  c4Watch(B, K, now, dt);                   // (detonar no es una acción: se pulsa G en cualquier momento)
  if (K.act) return;
  K.dt = (K.dt || 0) - dt;
  if (K.dt > 0) return;
  K.dt = 0.4;
  if (impactPush(B, K, now)) return;        // (tras el plantado, también en pleno tiroteo)
  if (B.target) return;
  remedio(B, K, now);
}

// REMEDIO: estimulante al derribado que ve (lo levanta) o a quien va mal de vida (y a sí mismo).
function remedio(B, K, now) {
  const op = B.op, a = op.ability;
  if (!has(a, 'stim') || (op.abilityCd || 0) > 0) return false;
  const e = op.eyePos(), w = B.game.world;
  let best = null, bs = Infinity;
  for (const t of B.game.operators) {
    if (t.team !== B.team || t === op || t.state === 'dead' || t.frozen) continue;
    // (los derribados primero; curar solo si le quedan al menos dos: uno para levantar)
    const need = t.state === 'downed' ? 0 : t.hp < 60 && a.left >= 2 ? 1 : -1;
    if (need < 0) continue;
    const c = t.center(), d = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
    if (d > STIM.range - 2 || !lineOfSight(w, e.x, e.y, e.z, c.x, c.y, c.z)) continue;
    const s = need * 100 + d;
    if (s < bs) { bs = s; best = t; }
  }
  if (!best) {
    if (op.hp >= 50 || a.left < 2 || !roll(B, 'selfstim:' + Math.floor(now / 10), B.diff.kit)) return false;
    // (mirando al suelo, sin nadie delante: se cura a sí mismo)
    start(B, { src: 'ability', yaw: op.yaw, pitch: -1.3, hold: 0.2, say: 'Me curo' });
    return true;
  }
  const downed = best.state === 'downed';
  if (!roll(B, 'stim:' + best.id + ':' + (downed ? 'd' + Math.floor(now / 30) : Math.floor(now / 8)), B.diff.kit)) return false;
  const aim = (X) => {
    if (best.state === 'dead') return null;
    const E = X.op.eyePos(), c = best.center();
    return { yaw: yawTo(c.x - E.x, c.z - E.z), pitch: Math.atan2(c.y - E.y, Math.hypot(c.x - E.x, c.z - E.z)) };
  };
  const r = aim(B);
  start(B, { src: 'ability', yaw: r.yaw, pitch: r.pitch, delay: late(B) * 0.5, hold: 0.2, say: downed ? 'Te levanto' : 'Te curo', timeout: 4 });
  return true;
}

// VOLTIO / OJO: la C4 pegada se detona cuando saben de un atacante a menos de 2,5 m (al otro lado).
function c4Watch(B, K, now, dt) {
  const op = B.op;
  if (!op.gadget || op.gadget.id !== 'c4') return;
  if (K.c4At != null) { if (now >= K.c4At) { op.intent.gadget = true; K.c4At = null; } return; }
  const c = B.game.gadgets.items.find((it) => it.alive && it.kind === 'c4' && it.owner === op && it.stuck);
  if (!c) return;
  K.c4T = (K.c4T || 0) - dt;
  if (K.c4T > 0) return;
  K.c4T = 0.2;
  const near = (p) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < C4.lethal && Math.abs(p.y + 0.9 - c.pos.y) < 2;
  if (!knownEnemies(B, now, 1.2).some(near)) return;
  if (matesNear(B, c.pos, C4.lethal + 0.5, 2.5)) return;              // (con un compañero al lado, no)
  if (!roll(B, 'c4:' + Math.floor(now / 3), B.diff.kit)) return;
  K.c4At = now + late(B) * 0.6;
  B.sq.radio.say(op, 'kit', '¡C4!', { cooldown: 3 });
}

// CORAZA: tras el plantado, granada de impacto a los atacantes que guardan el desactivador
// (los vea o los sepa tras una esquina; que no estalle a menos de 2,8 m de él).
function impactPush(B, K, now) {
  const op = B.op;
  if (B.match.phase !== 'planted' || !has(op.gadget, 'impact') || (op.gadgetCd || 0) > 0 || op.channel || now < (K.impNext || 0)) return false;
  const e = op.eyePos(), w = B.game.world;
  const known = [];
  for (const t of B.per.visible) if (t.state !== 'dead') known.push({ op: t, x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z });
  for (const k of B.board.recent(now, 2)) if (k.precise && k.op && k.op.state !== 'dead') known.push(k);
  for (const k of known) {
    const d = Math.hypot(k.x - e.x, k.z - e.z);
    if (d < 3.5 || d > 14 || Math.abs(k.y - op.body.pos.y) > 2.5) continue;
    const a = B.rng.next() * Math.PI * 2, rr = B.rng.next() * B.diff.kitErr * 0.8;
    const target = { x: k.x + Math.cos(a) * rr, y: k.y + 0.5, z: k.z + Math.sin(a) * rr };
    const aim = aimThrow(w, e, target, { maxErr: 1.0, maxT: 1.5 });
    if (!aim || Math.hypot(aim.hit.pos.x - k.x, aim.hit.pos.z - k.z) > 1.4 || matesNear(B, aim.hit.pos, 2.8)) continue;
    if (!roll(B, 'impact:' + Math.floor(now / 6), B.diff.kit)) { K.impNext = now + 3; return false; }
    // (si se mueve antes de lanzar, vuelve a apuntar desde donde esté)
    const reaim = (X) => {
      const E = X.op.eyePos(), r = aimThrow(w, E, target, { maxErr: 1.0, maxT: 1.5 });
      if (!r || Math.hypot(r.hit.pos.x - k.x, r.hit.pos.z - k.z) > 1.4 || matesNear(B, r.hit.pos, 2.8)) return null;
      return { yaw: r.yaw, pitch: r.pitch };
    };
    start(B, { src: 'gadget', aim: reaim, aimFrom: { x: op.body.pos.x, z: op.body.pos.z }, yaw: aim.yaw, pitch: aim.pitch, hold: 0.3, say: '¡Impacto!', combat: true, timeout: 2 });
    K.impNext = now + 5;
    return true;
  }
  return false;
}

// ====================================================================== «Poner gadget aquí»
const PLACE_IDS = { barbed: true, shield: true, alarm: true, bpcam: true, claymore: true, breach: true, battery: true, jammer: true, lasermine: true, interceptor: true, thermal: true };
const THROW_IDS = { frag: 'la granada', smoke: 'el humo', flash: 'la cegadora', impact: 'la granada de impacto', c4: 'la C4', emp: 'la PEM', stickycam: 'la cámara adhesiva', gas: 'el bote de gas' };
const ROUND_IDS = { breachround: 'el proyectil de brecha', remotesmoke: 'el humo' };

// ¿Se puede estar de pie en `s`? (sin nada sólido y con un nodo de la rejilla cerca)
function standOk(sq, s) {
  const w = sq.game.world;
  if (w.worldBoxHasSolid(s.x - 0.3, s.y + 0.02, s.z - 0.3, s.x + 0.3, s.y + 1.8, s.z + 0.3)) return false;
  const n = sq.nav.nearest(s.x, s.y, s.z, 0.45, 0.4);
  return !!(n && n.alive && !n.crouch);
}
// Suelo bajo un punto (el de la marca puede estar en una pared, a media altura).
function floorBelow(sq, p) {
  const n = sq.nav.nearest(p.x, p.y - 0.8, p.z, 1.6, 2.2);
  return n ? n.y : null;
}

// Cómo pondría o lanzaría `op` el objeto `id` (de `src`) en la marca `pos`: la acción, o null.
function planUse(sq, op, src, id, pos) {
  const G = sq.game.gadgets, from = pos.from || op.eyePos();
  if (PLACE_IDS[id]) {
    const fy = floorBelow(sq, pos);
    if (fy === null) return null;
    // (primero desde el lado desde el que se señaló)
    const dirs = [], fx = from.x - pos.x, fz = from.z - pos.z, fl = Math.hypot(fx, fz);
    if (fl > 0.01) dirs.push([fx / fl, fz / fl]);
    for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
    for (const [dx, dz] of dirs) {
      for (const d of [1.0, 1.4, 0.6, 1.8]) {
        const stand = { x: pos.x + dx * d, y: fy, z: pos.z + dz * d };
        if (!standOk(sq, stand)) continue;
        const face = yawTo(pos.x - stand.x, pos.z - stand.z);
        const pitch = Math.atan2(pos.y - (fy + EYE), Math.hypot(pos.x - stand.x, pos.z - stand.z));
        const spot = G.placeSpot(probe(op, stand, face, pitch), id);
        if (!spot || !spot.ok || Math.hypot(spot.pos.x - pos.x, spot.pos.y - pos.y, spot.pos.z - pos.z) > 1.8) continue;
        return { src, at: stand, yaw: face, pitch, label: PLACE_LABEL[id], timeout: 30 };
      }
    }
    return null;
  }
  // lanzar o disparar desde donde se señaló (o desde donde está, si ve el punto)
  const fy = floorBelow(sq, from) ?? op.body.pos.y;
  const stand = { x: from.x, y: fy, z: from.z };
  if (THROW_IDS[id]) {
    const lob = id === 'frag' || id === 'emp' || id === 'gas';
    const aim = (X) => { const r = aimThrow(sq.game.world, X.op.eyePos(), pos, { maxErr: 1.2, lob }); return r ? { yaw: r.yaw, pitch: r.pitch } : null; };
    return { src, at: stand, aim, yaw: op.yaw, pitch: 0, label: THROW_IDS[id], timeout: 30, r: 0.8 };
  }
  if (ROUND_IDS[id]) {
    const aim = (X) => {
      const E = X.op.eyePos(), dx = pos.x - E.x, dy = pos.y - E.y, dz = pos.z - E.z, d = Math.hypot(dx, dy, dz);
      if (!lineOfSight(sq.game.world, E.x, E.y, E.z, pos.x - dx / d * 0.2, pos.y - dy / d * 0.2, pos.z - dz / d * 0.2)) return null;
      return { yaw: yawTo(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    };
    return { src, at: stand, aim, yaw: op.yaw, pitch: 0, label: ROUND_IDS[id], timeout: 30, r: 0.8 };
  }
  if (id === 'plates' && !op.ability.dropped) {
    const f = floorBelow(sq, pos);
    if (f === null) return null;
    return { src, at: { x: pos.x, y: f, z: pos.z }, yaw: op.yaw, pitch: -0.4, label: 'la bolsa de placas', timeout: 30, r: 0.6 };
  }
  return null;
}

// Qué se prefiere «poner» en la marca: un gadget que se coloca (alambre, escudo, cámara,
// claymore...), luego una habilidad que se coloca o se suelta, luego lo que se lanza o se dispara
// (humo, cegadora, C4, cámara adhesiva...) y, solo si nadie tiene otra cosa, lo que rompe
// (impacto, fragmentación, proyectil de brecha). Cada escalón pesa como 8 m más de camino.
const BREAKS = { impact: true, frag: true, breachround: true };
function useRank(src, id) {
  if (BREAKS[id]) return 3;
  if (PLACE_IDS[id] || id === 'plates') return src === 'gadget' ? 0 : 1;
  return 2;
}

/**
 * «Poner gadget aquí»: el aliado bot vivo que mejor pueda poner o lanzar algo allí (su gadget
 * o su habilidad; ver useRank, y cuanto más cerca, mejor) va y lo hace. Devuelve cuántos (0 o 1).
 */
export function orderGadget(sq, by, pos, allies, ack) {
  const M = sq.match;
  if (!pos) return 0;
  const ph = M.phase;
  if (!(ph === 'action' || ph === 'planted' || (ph === 'prep' && by.side === 'def'))) { ack('Ahora no'); return 0; }
  const cands = [];
  for (const B of allies) {
    const op = B.op;
    if (op.state !== 'alive' || op.frozen) continue;
    const d = Math.hypot(op.body.pos.x - pos.x, (op.body.pos.y - pos.y) * 2, op.body.pos.z - pos.z);
    for (const src of ['gadget', 'ability']) {
      const slot = src === 'gadget' ? op.gadget : op.ability;
      if (!slot || slot.left === 0) continue;
      if (src === 'ability' && slot.id === 'shield') continue;   // (el escudo balístico de MURALLA no se pone)
      const rank = useRank(src, slot.id);
      cands.push({ B, src, id: slot.id, score: d + (rank === 3 ? 1000 : rank * 8) });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const { B, src, id } of cands) {
    const op = B.op;
    const act = planUse(sq, op, src, id, pos);
    if (!act) continue;
    start(B, { ...act, say: null, then: () => sq.radio.say(op, 'done', 'Hecho', { cooldown: 2 }), fail: () => sq.radio.say(op, 'cant', 'No he podido', { cooldown: 2 }) });
    sq.radio.say(op, 'ack', `Pongo ${act.label} ahí`, { force: true });
    return 1;
  }
  ack('Nadie tiene nada que poner ahí');
  return 0;
}

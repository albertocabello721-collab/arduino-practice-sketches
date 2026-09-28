// Rappel de los bots del ataque (F10.2b).
//
// Con el sitio en la planta alta, algunos atacantes entran por ventanas del sitio: van al pie de la
// fachada, se enganchan, suben y rompen la barricada al entrar. En Élite lo hacen 1 o 2 y esperan
// colgados junto a la ventana (como mucho 20 s) a que el resto del equipo empuje; hasta que el equipo
// entra en la casa esperan al pie, sin engancharse (la cuerda se oye). En Normal y Veterano, 1 en el
// 30 % de las rondas y sin esperar; en Novato, nadie. Con el sitio en otra planta, los pasos de
// cuerda solo entran en sus rutas si se las acortan (y así el resto del ataque, con el sitio arriba,
// va por dentro).
//
// En la cuerda (el seguidor de rutas, mover.js, hace el paso): disparan a lo que ven sin moverse; si
// les disparan mientras suben, bajan (y esa ronda ya no vuelven a la cuerda); si les descubren ya
// junto a la ventana, entran sin esperar (con gas, bajan); nunca más de 25 s.
//
// Las tiradas del plan usan su propia secuencia (de la semilla de la partida y la ronda): así no
// cambian los números aleatorios del resto de la partida.
import { RNG } from '../../core/rng.js';

// Por dificultad: probabilidad de que haya rappel en la ronda, de que sean 2 y si esperan al equipo.
export const ROPE_PLAN = {
  novato: null,
  normal: { p: 0.3, two: 0, wait: false },
  veterano: { p: 0.3, two: 0, wait: false },
  elite: { p: 1, two: 0.5, wait: true },
};
// El equipo «empuja» cuando alguien (que no esté en la cuerda) ya está en una sala del sitio, o
// combatiendo (con un blanco o disparando) dentro de la casa, en la planta del sitio y a menos de
// 8 m de sus salas; también con poco tiempo, con el desactivador plantado o si no queda nadie más.
const PUSH_FIGHT = 8;       // m de las salas del sitio
const PUSH_TIMER = 80;      // s de ronda
// Élite elige la ventana lejos de los defensores conocidos: cada uno a menos de 7 m de donde se
// entra cuenta como 12 m más de camino.
const KNOWN_NEAR = 7, KNOWN_COST = 12;

/** Pasos de cuerda desde el suelo que entran en las salas de `site`: [{rp, room: 'A'|'B'}]. */
export function siteRopes(sq, site) {
  const map = sq.match.map, out = [];
  for (const E of sq.nav.ropeEdges || []) {
    if (E.rp.act !== 'enter' || E.rp.from !== 'ground') continue;
    const r = map.roomAt(E.to.px, E.to.y + 0.3, E.to.pz);
    if (r && r.id === site.A) out.push({ rp: E.rp, room: 'A' });
    else if (r && r.id === site.B) out.push({ rp: E.rp, room: 'B' });
  }
  return out;
}

/** ¿Es un sitio al que se entra por ventanas con cuerda? (En la Villa, la planta alta.) */
export function ropeSite(sq, site) {
  if (!site) return false;
  const c = sq._ropeSites || (sq._ropeSites = new Map());
  if (!c.has(site)) c.set(site, siteRopes(sq, site).length > 0);
  return c.get(site);
}

/**
 * Al empezar la acción: quién entra por una ventana del sitio (no el portador del desactivador ni
 * quien abre un muro) y por cuál: la más cercana a cada uno, sin repetir fachada a menos de 3 m; en
 * Élite, además, lejos de los defensores que han marcado los drones.
 */
export function planRope(sq, atk, site) {
  const R = ROPE_PLAN[sq.diffKey];
  if (!R || !ropeSite(sq, site)) return;
  const rng = new RNG((Math.imul(sq.game.seed | 0, 0x9e3779b1) ^ Math.imul(sq.match.round | 0, 0x85ebca6b) ^ 0x2545f491) >>> 0);
  if (rng.next() >= R.p) return;
  const n = rng.next() < R.two ? 2 : 1;
  const ropes = siteRopes(sq, site);
  // (defensores conocidos: los que marcaron los drones o las cámaras)
  const team = atk.length ? atk[0].team : 0, now = sq.game.time;
  const known = R.wait ? sq.boards[team].recent(now, 120) : [];
  const E = new Map((sq.nav.ropeEdges || []).map((q) => [q.rp, q.to]));
  const covered = (rp) => {
    const n = E.get(rp);
    return n ? known.filter((k) => Math.hypot(k.x - n.px, k.z - n.pz) < KNOWN_NEAR && Math.abs(k.y - n.y) < 1.5).length : 0;
  };
  const carrier = sq.match.defuser && sq.match.defuser.carrier;
  const cands = rng.shuffle(atk.filter((B) => B.op !== carrier && B.stage !== 'breach' && B.op.state === 'alive'));
  const used = [];
  for (const B of cands.slice(0, n)) {
    const p = B.op.body.pos;
    let best = null, bd = Infinity;
    for (const r of ropes) {
      const h = r.rp.hook;
      if (!h || used.some((u) => Math.hypot(u.rp.hook.x - h.x, u.rp.hook.z - h.z) < 3)) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z) + rng.next() * 4 + covered(r.rp) * KNOWN_COST;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) break;
    used.push(best);
    B.ropePlan = { rp: best.rp, room: best.room, wait: R.wait, walkT: 0, baseT: 0, pushed: false, done: false, failed: false };
    B.stage = 'rope';
  }
}

/**
 * ¿Ha entrado ya alguien del equipo en la casa? Hasta entonces, los de Élite esperan al pie de la
 * fachada sin engancharse (la cuerda se oye): así esperan colgados solo lo que tarda el empuje.
 */
export function atkInside(sq, me) {
  const M = sq.match;
  if (M.phase !== 'action' || M.timer < PUSH_TIMER) return true;
  let others = false;
  for (const o of sq.game.operators) {
    if (o.side !== 'atk' || o === me.op || o.state !== 'alive') continue;
    const B = sq.brains.get(o);
    if (B && B.ropePlan && !B.ropePlan.done && !B.ropePlan.failed) continue;
    others = true;
    const p = o.body.pos;
    if (M.map.builder.roomAt(p.x, p.y + 0.2, p.z)) return true;
  }
  return !others;
}

/** ¿Ha empujado ya el resto del equipo? (Para los que esperan colgados junto a la ventana.) */
export function atkPushed(sq, me) {
  const M = sq.match;
  if (M.phase !== 'action' || M.timer < PUSH_TIMER) return true;
  const site = sq.atkTargetSite();
  const rooms = site ? [site.A, site.B].map((id) => M.map.rooms.find((r) => r.id === id)).filter(Boolean) : [];
  let others = false;
  for (const o of sq.game.operators) {
    if (o.side !== 'atk' || o === me.op || o.state !== 'alive') continue;
    const B = sq.brains.get(o);
    if (B && B.ropePlan && !B.ropePlan.done && !B.ropePlan.failed) continue;    // (los de la cuerda también esperan)
    others = true;
    const p = o.body.pos;
    if (!M.map.builder.roomAt(p.x, p.y + 0.2, p.z)) continue;
    // (combatiendo: con un blanco o disparando hace nada)
    const fighting = (B && B.target) || sq.game.time - (sq.shotAt.get(o) ?? -9) < 1.5;
    for (const r of rooms) {
      if (Math.abs(p.y - r.floorY) > 1.2) continue;
      const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dz = Math.max(r.z0 - p.z, 0, p.z - r.z1), d = Math.hypot(dx, dz);
      if (d === 0 || (fighting && d < PUSH_FIGHT)) return true;
    }
  }
  return !others;              // (no queda nadie a quien esperar)
}

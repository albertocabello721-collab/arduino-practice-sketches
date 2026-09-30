// Inicio y fin de ronda (F12.4): qué se anuncia al empezar (ronda, bando, objetivo), la cuenta atrás
// de la preparación, la cámara lenta de la última baja, el mejor de la ronda y el aviso de «1 contra N».
// Aquí solo se deciden textos y tiempos; lo pinta ui/matchui.js.
import { OP_BY_ID } from '../sim/operators.js';

export const COUNTDOWN = 3;                                   // s: 3, 2, 1 al final de la preparación
export const SLOWMO = { secs: 0.6, scale: 0.3, ease: 0.2 };  // la última baja: 0,6 s al 30 % y vuelta en 0,2 s
export const INTRO_SECS = 3.6;                               // lo que dura el rótulo de inicio
export const CLUTCH_SECS = 2.8;                               // lo que dura el aviso de «1 contra N»

const roomName = (map, id) => { const r = map.rooms && map.rooms.find((x) => x.id === id); return r ? r.name : id; };

/**
 * El rótulo de inicio de ronda: {round, side, objective}. El que defiende ve la planta y las dos salas
 * del objetivo; el que ataca, solo la planta (como en la barra de arriba): las salas las busca con
 * el dron, eso no cambia.
 */
export function introFor(match, myTeam) {
  const side = match.sideOf(myTeam), site = match.site;
  const objective = !site ? '' : side === 'def'
    ? `${site.name}: ${roomName(match.map, site.A)} / ${roomName(match.map, site.B)}`
    : `${site.name} · objetivo sin localizar: búscalo con tu dron`;
  return { round: `Ronda ${match.round}`, side: side === 'def' ? 'Defiendes' : 'Atacas', objective };
}

/** La cuenta atrás: 3, 2 o 1 en los últimos 3 s de la preparación; 0 el resto. */
export function countdownAt(match) {
  if (match.phase !== 'prep') return 0;
  const t = match.timeLeft;
  return t > 0 && t <= COUNTDOWN ? Math.ceil(t) : 0;
}

/**
 * Cámara lenta de la última baja: `start()` al acabar la ronda por eliminación; `step(dt real)` cada
 * fotograma devuelve la escala del tiempo de juego (0,3 durante 0,6 s y vuelta a 1 en 0,2 s). Es
 * solo cómo se ve: la simulación da los mismos pasos, más despacio, y la ronda ya está decidida.
 */
export class SlowMo {
  constructor() { this.t = -1; }
  get active() { return this.t >= 0; }
  start() { this.t = 0; }
  stop() { this.t = -1; }
  step(dt) {
    if (this.t < 0) return 1;
    const k = SlowMo.scaleAt(this.t);
    this.t += dt;
    if (this.t >= SLOWMO.secs + SLOWMO.ease) this.t = -1;
    return k;
  }
  static scaleAt(t) {
    if (t < 0) return 1;
    if (t < SLOWMO.secs) return SLOWMO.scale;
    if (t < SLOWMO.secs + SLOWMO.ease) return SLOWMO.scale + ((1 - SLOWMO.scale) * (t - SLOWMO.secs)) / SLOWMO.ease;
    return 1;
  }
}

const ROUND_KEYS = ['score', 'kills', 'downs', 'assists', 'damage', 'plants', 'disables', 'revives', 'headshots'];
/** Copia de las estadísticas de todos al empezar la ronda (para sacar lo de la ronda al acabar). */
export const statsSnapshot = (match) => match.slots.map((s) => ({ ...s.stats }));

/**
 * El mejor de la ronda: el que más puntos sumó en ella (desempate: bajas y daño). null si nadie
 * sumó nada. {slot, name, opId, score, kills, downs, assists, damage, plants, disables, revives}.
 */
export function roundMvp(match, before) {
  let best = null;
  match.slots.forEach((s, i) => {
    const b = (before && before[i]) || {};
    const d = { slot: s };
    for (const k of ROUND_KEYS) d[k] = (s.stats[k] || 0) - (b[k] || 0);
    if (d.score <= 0) return;
    if (!best || d.score > best.score || (d.score === best.score && (d.kills > best.kills || (d.kills === best.kills && d.damage > best.damage)))) best = d;
  });
  if (!best) return null;
  const s = best.slot, def = s.opId ? OP_BY_ID[s.opId] : null;
  return { ...best, opId: s.opId, name: s.human ? 'Tú' : (s.op ? s.op.name : def ? def.name : '?'), op: def ? def.name : '', team: s.team };
}

/** Lo que hizo el mejor de la ronda, en corto: «2 bajas · 1 derribo · 180 de daño». */
export function mvpLine(m) {
  const parts = [];
  const n = (x, one, many) => (x ? parts.push(`${x} ${x === 1 ? one : many}`) : 0);
  n(m.kills, 'baja', 'bajas'); n(m.downs, 'derribo', 'derribos'); n(m.assists, 'asistencia', 'asistencias');
  n(m.plants, 'plantado', 'plantados'); n(m.disables, 'inutilizado', 'inutilizados'); n(m.revives, 'reanimación', 'reanimaciones');
  if (m.damage >= 1) parts.push(`${Math.round(m.damage)} de daño`);
  return parts.join(' · ');
}

/**
 * «1 contra N»: si un equipo se queda con uno solo en pie (y el otro con alguno), en acción o con el
 * desactivador plantado. {key, mine (el que está solo es de tu equipo), text, sub}; si no, null.
 */
export function clutchFor(match, me, myTeam) {
  if (match.phase !== 'action' && match.phase !== 'planted') return null;
  let mates = 0, foes = 0, lastMate = null;
  for (const o of match.game.operators) {
    if (o.state !== 'alive') continue;
    if (o.team === myTeam) { mates++; lastMate = o; } else foes++;
  }
  if (mates === 1 && foes >= 1) {
    const sub = lastMate === me ? 'Eres el último' : `${lastMate.name} es el último`;
    return { key: `1v${foes}`, mine: true, text: `1 contra ${foes}`, sub };
  }
  if (foes === 1 && mates >= 2) return { key: `${mates}v1`, mine: false, text: `${mates} contra 1`, sub: 'Queda uno' };
  return null;
}

/** Detalle del motivo del final: la última baja, quién destruyó el desactivador… ('' si no hay). */
export function endDetail(res, info = {}) {
  const who = (op) => (op ? (op.isBot ? op.name : 'Tú') : '');
  switch (res.code) {
    case 'defendersDown':
    case 'attackersDown': {
      const k = info.lastKill;
      if (!k || !k.by || !k.target) return '';
      return `Última baja: ${who(k.by)} a ${k.target.name}${k.headshot ? ', a la cabeza' : ''}`;
    }
    case 'destroyed': return info.destroyedBy ? `Lo destruyó ${who(info.destroyedBy)}` : '';
    case 'disabled': return info.disabledBy ? `Lo inutilizó ${who(info.disabledBy)}` : '';
    case 'timeUp': return 'Se acabó el tiempo sin plantar';
    case 'defused': return 'Aguantó los 45 s';
    default: return '';
  }
}

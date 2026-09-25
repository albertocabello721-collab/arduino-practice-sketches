// Recarga por partes en primera persona (Fase 7.1): la pose de cada instante, como datos. Los
// momentos de las partes (cargador fuera, dentro, golpe, cerrojo, cartucho...) son los de la
// simulación (sim/weapons.js, reloadPlan): lo que se ve y lo que cuenta pasan a la vez.
// Espacio del arma en primera persona: adelante -Z, arriba +Y, derecha +X.
//
// Pistas del clip:
//   pos, rot   desplazamiento y giro del arma (con los brazos)
//   hand       dónde va la mano izquierda
//   mag        el cargador: 'gun' (puesto), 'hand' (en la mano) o 'none' (se cayó)
//   magOff     el cargador puesto, desplazado (el de la pistola cae solo)
//   bolt       palanca de carga o cerrojo (0 delante, 1 atrás)
//   slide      corredera de la pistola (1 atrás)
//   cyl        tambor del revólver (1 fuera)
//   cover      tapa de la AL-60 (1 abierta)
//   pump       bomba de la escopeta (1 atrás)
//   shell      cartucho en la mano ('hand' o 'none')
//   loader     cargador rápido del revólver en la mano ('hand' o 'none')
import { ClipBuilder, vadd, vsub } from './anim.js';

export const POUCH = [-0.3, -0.42, 0.2];           // la mano en el portacargadores (fuera de la vista)
const SHELL_POUCH = [-0.24, -0.42, 0.16];
export const HOLD = [0, 0.075, 0];                 // el cargador en la mano: encima de la palma
export const SHELL_HOLD = [0, 0.03, -0.035];
export const LOADER_HOLD = [0, 0.02, -0.012];
const ZERO = [0, 0, 0];

const at = (plan, part) => { const p = plan.parts.find((x) => x.part === part); return p ? p.at : undefined; };

// tronco común: el arma se inclina al empezar (en `a` s) y vuelve al final; `keys`: más giros
// [t, rot, curva] entre medias y `posKeys`, más posiciones (si no, se queda en `pos` hasta el final)
function tilt(C, T, a, pos, rot, keys = [], posKeys = null) {
  C.key('pos', 0, ZERO).key('pos', a, pos);
  if (posKeys) for (const [t, p, e] of posKeys) C.key('pos', t, p, e);
  else C.key('pos', T - 0.3, pos);
  C.key('pos', T, ZERO);
  C.key('rot', 0, ZERO).key('rot', a, rot);
  for (const [t, r, e] of keys) C.key('rot', t, r, e);
  C.key('rot', T, ZERO);
}

// fusiles, subfusiles y tirador: la mano saca el cargador, trae el nuevo, golpe y (vacía) cerrojo
function longMag(C, p, info, rest) {
  const T = p.total, tO = at(p, 'magOut'), tI = at(p, 'magIn'), tS = at(p, 'slap'), tB = at(p, 'bolt');
  const grab = vsub(info.magRest, HOLD);
  const R1 = [0.28, 0.08, -0.38], R2 = [0.25, 0.08, -0.34], RB = [0.24, 0.14, -0.25];
  const keys = [[tI, R2], [tS - 0.02, R2], [tS + 0.035, vadd(R2, [-0.06, 0, 0.02]), 'snap'], [tS + 0.16, R2]];
  if (tB !== undefined) keys.push([tB - 0.24, RB], [tB + 0.12, RB]);
  else keys.push([T - 0.3, R1]);
  const P1 = [-0.04, 0.08, -0.06], PB = [-0.05, 0.08, -0.07];
  tilt(C, T, Math.min(0.28, (tO ?? 0.4) * 0.7), P1, R1, keys,
    tB !== undefined ? [[tS + 0.16, P1], [tB - 0.24, PB], [tB + 0.12, PB]] : null);
  C.key('hand', 0, rest);
  C.key('mag', 0, tO !== undefined ? 'gun' : 'none');
  let t0 = 0.2;
  if (tO !== undefined) {
    C.key('hand', tO - 0.22, grab).key('hand', tO, vadd(grab, [-0.02, -0.12, 0.03]), 'in');
    C.key('mag', tO - 0.22, 'hand').key('mag', tO, 'none');
    t0 = tO;
  }
  C.key('hand', t0 + (tI - t0) * 0.4, POUCH, 'in');
  C.key('mag', t0 + (tI - t0) * 0.55, 'hand');            // el nuevo, aún fuera de la vista
  C.key('hand', tI - 0.2, vadd(grab, [0, -0.1, 0.02]), 'out');
  C.key('hand', tI, grab);
  C.key('mag', tI, 'gun');
  C.key('hand', tS - 0.1, vadd(grab, [0.01, -0.09, 0.02]));
  C.key('hand', tS, vadd(grab, [0, -0.005, 0]), 'snap');
  C.key('hand', tS + 0.12, vadd(grab, [0, -0.05, 0.02]));
  if (tB !== undefined && info.boltRest) {
    const bg = vadd(info.boltRest, [-0.012, -0.035, 0]);
    const back = vadd(bg, [0, 0, info.boltTravel]);
    C.key('hand', tB - 0.25, bg).key('hand', tB - 0.05, back).key('hand', tB + 0.12, vadd(back, [-0.04, 0.03, 0.03]), 'out');
    C.key('bolt', 0, 0).key('bolt', tB - 0.22, 0).key('bolt', tB - 0.05, 1).key('bolt', tB, 0, 'snap');
  }
  C.key('hand', T - 0.08, rest);
}

// pistolas: el cargador cae solo al soltarlo; la mano trae el nuevo; vacía, suelta la corredera
function pistolMag(C, p, info, rest) {
  const T = p.total, tO = at(p, 'magOut'), tI = at(p, 'magIn'), tS = at(p, 'slap'), tB = at(p, 'bolt');
  const grab = vsub(info.magRest, HOLD);
  const R1 = [0.35, 0.28, -0.38];
  tilt(C, T, Math.min(0.22, (tO ?? 0.3) * 0.7), [-0.06, 0.06, -0.03], R1,
    [[tS - 0.02, R1], [tS + 0.035, vadd(R1, [-0.07, 0, 0]), 'snap'], [tS + 0.15, R1], [T - 0.3, R1]]);
  C.key('mag', 0, tO !== undefined ? 'gun' : 'none');
  if (tO !== undefined) {
    C.key('magOff', 0, ZERO).key('magOff', tO - 0.12, ZERO).key('magOff', tO, [0, -0.08, 0.012], 'in');
    C.key('mag', tO, 'none');
  }
  const t0 = tO ?? 0.15;
  C.key('hand', 0, rest).key('hand', t0 * 0.9, POUCH, 'in');
  C.key('mag', t0 + (tI - t0) * 0.45, 'hand');
  C.key('hand', tI - 0.18, vadd(grab, [0, -0.09, 0.02]), 'out');
  C.key('hand', tI, grab);
  C.key('mag', tI, 'gun');
  C.key('hand', tS - 0.08, vadd(grab, [0, -0.06, 0.01]));
  C.key('hand', tS, vadd(grab, [0, -0.005, 0]), 'snap');
  C.key('hand', tS + 0.1, vadd(grab, [0, -0.04, 0.02]));
  if (tB !== undefined && info.slideRest) {
    const sg = vadd(info.slideRest, [-0.022, 0.0, 0.07]);
    C.key('hand', tB - 0.14, sg).key('hand', tB, vadd(sg, [0, 0, 0.02])).key('hand', tB + 0.1, vadd(sg, [-0.03, 0.02, 0.04]), 'out');
    C.key('slide', 0, 1).key('slide', tB - 0.03, 1).key('slide', tB, 0, 'snap');
  } else C.key('slide', 0, 0);
  C.key('hand', T - 0.06, rest);
}

// AL-60: tapa arriba, caja fuera, caja nueva, cinta, tapa abajo y (vacía) palanca
function beltBox(C, p, info, rest) {
  const T = p.total, tOp = at(p, 'open'), tO = at(p, 'magOut'), tI = at(p, 'magIn'), tBe = at(p, 'belt'), tCl = at(p, 'close'), tB = at(p, 'bolt');
  const grab = vsub(info.magRest, HOLD);
  const cp = info.coverPivot, latch = vadd(cp, [0, 0.02, 0.1]), up = vadd(cp, [0, 0.1, 0.06]);
  const R1 = [0.2, 0.2, -0.32];
  tilt(C, T, 0.35, [-0.06, 0.07, -0.07], R1, [[T - 0.3, R1]]);
  C.key('cover', 0, 0).key('cover', tOp - 0.05, 0).key('cover', tOp + 0.18, 1, 'out').key('cover', tCl - 0.12, 1).key('cover', tCl, 0, 'snap');
  C.key('hand', 0, rest).key('hand', tOp - 0.15, latch).key('hand', tOp + 0.18, up, 'out');
  C.key('mag', 0, tO !== undefined ? 'gun' : 'none');
  let t0 = tOp + 0.3;
  if (tO !== undefined) {
    C.key('hand', tO - 0.3, grab).key('hand', tO, vadd(grab, [-0.07, -0.12, 0.0]), 'in');
    C.key('mag', tO - 0.3, 'hand').key('mag', tO, 'none');
    t0 = tO;
  }
  C.key('hand', t0 + (tI - t0) * 0.4, POUCH, 'in');
  C.key('mag', t0 + (tI - t0) * 0.55, 'hand');
  C.key('hand', tI - 0.25, vadd(grab, [-0.05, -0.1, 0]), 'out');
  C.key('hand', tI, grab);
  C.key('mag', tI, 'gun');
  C.key('hand', tBe - 0.14, vadd(cp, [-0.01, 0.035, 0.035])).key('hand', tBe, vadd(cp, [0.005, 0.012, 0.03]));
  C.key('hand', tCl - 0.18, up).key('hand', tCl, latch, 'snap');
  if (tB !== undefined && info.boltRest) {
    const bg = vadd(info.boltRest, [-0.012, -0.035, 0]), back = vadd(bg, [0, 0, info.boltTravel]);
    C.key('hand', tB - 0.18, bg).key('hand', tB - 0.04, back).key('hand', tB + 0.1, vadd(back, [-0.04, 0.02, 0.02]), 'out');
    C.key('bolt', 0, 0).key('bolt', tB - 0.16, 0).key('bolt', tB - 0.04, 1).key('bolt', tB, 0, 'snap');
  }
  C.key('hand', T - 0.1, rest);
}

// R-44: tambor fuera, boca arriba para vaciarlo, cargador rápido, tambor dentro
function revolver(C, p, info, rest) {
  const T = p.total, tOp = at(p, 'open'), tEj = at(p, 'eject'), tI = at(p, 'magIn'), tCl = at(p, 'close');
  const cr = info.cylRest, out = vadd(cr, [-0.04, -0.018, 0]);
  const R1 = [0.35, 0.22, -0.5], RE = [1.0, 0.1, -0.4], RL = [0.12, 0.22, -0.5];
  tilt(C, T, Math.min(0.25, tOp * 0.9), [-0.06, 0.06, -0.05], R1,
    [[tEj - 0.12, RE], [tEj + 0.1, RE], [tI - 0.3, RL], [tI + 0.1, RL], [tCl + 0.05, R1], [T - 0.3, R1]]);
  C.key('cyl', 0, 0).key('cyl', tOp - 0.1, 0).key('cyl', tOp, 1, 'out').key('cyl', tCl - 0.1, 1).key('cyl', tCl, 0, 'snap');
  C.key('hand', 0, rest).key('hand', tOp - 0.1, vadd(out, [-0.035, -0.035, 0]));
  C.key('hand', tEj - 0.08, vadd(out, [-0.012, -0.012, -0.075])).key('hand', tEj, vadd(out, [-0.012, -0.012, -0.04]), 'snap');
  C.key('hand', tEj + (tI - tEj) * 0.35, POUCH, 'in');
  C.key('loader', 0, 'none').key('loader', tEj + (tI - tEj) * 0.5, 'hand').key('loader', tI + 0.12, 'none');
  C.key('hand', tI - 0.2, vadd(out, [0, -0.02, 0.1]), 'out').key('hand', tI, vadd(out, [0, -0.02, 0.045]));
  C.key('hand', tI + 0.15, vadd(out, [-0.03, -0.045, 0.06]));
  C.key('hand', tCl - 0.08, vadd(out, [-0.045, -0.02, 0])).key('hand', tCl, vadd(cr, [-0.035, -0.02, 0]), 'snap');
  C.key('hand', T - 0.06, rest);
}

// E-12: cartucho a cartucho por la ventana de carga; vacía, bombea al final
function shotgun(C, p, info, rest) {
  const T = p.total, tP = at(p, 'pump');
  const shells = p.parts.filter((x) => x.part === 'shell').map((x) => x.at);
  const port = info.port;
  const R1 = [0.3, 0.12, -0.5];
  tilt(C, T, 0.25, [-0.04, 0.11, -0.08], R1, [[T - 0.3, R1]]);
  C.key('hand', 0, rest).key('shell', 0, 'none');
  for (const s of shells) {
    const c = s - 0.3;
    C.key('hand', c + 0.04, SHELL_POUCH, 'in').key('shell', c + 0.06, 'hand');
    C.key('hand', s - 0.12, vadd(port, [0, -0.05, 0.05]), 'out').key('hand', s, vadd(port, [0, -0.012, -0.02]), 'snap');
    C.key('shell', s, 'none');
  }
  if (tP !== undefined) {
    C.key('hand', tP - 0.14, rest);
    C.key('pump', 0, 0).key('pump', tP - 0.1, 0).key('pump', tP - 0.02, 1, 'out').key('pump', tP + 0.08, 0, 'snap');
  }
  C.key('hand', T - 0.05, rest);
}

/**
 * Clip de la recarga `plan` para el arma con piezas `info` (posiciones de reposo del cargador,
 * palanca, tapa, ventana de carga, tambor, corredera) y la mano izquierda en reposo en `rest`.
 */
export function reloadClip(plan, def, info, rest) {
  const C = new ClipBuilder();
  if (plan.family === 'shell') shotgun(C, plan, info, rest);
  else if (plan.family === 'cyl') revolver(C, plan, info, rest);
  else if (plan.family === 'belt') beltBox(C, plan, info, rest);
  else if (def.cls === 'pistol') pistolMag(C, plan, info, rest);
  else longMag(C, plan, info, rest);
  return C.build();
}

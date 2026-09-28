// Rappel (Fase 10.2a): colgado de una cuerda en las fachadas de la casa, desde el suelo o desde el
// tejado. Solo en los tramos que marca el mapa (map.rappel, con argollas en el pretil) y quien deje
// `canRappel` (en la partida, los atacantes en la acción).
//  · Engancharse: Espacio al pie de la fachada mirándola (0,5 s) o en el pretil mirando hacia fuera
//    (1 s). Si delante hay algo que saltar (una ventana baja), se salta como siempre.
//  · Colgado: W sube a 1,5 m/s, S baja a 2,5 m/s, A/D de lado a 1 m/s sin salir del tramo. Arriba
//    del todo, Espacio sube al tejado (0,8 s); al tocar el suelo se suelta de pie; C suelta en el
//    aire (y la caída hace el daño de siempre). Delante de una ventana, Espacio entra (0,6 s); si
//    tiene barricada, la rompe al entrar (1,2 s, con mucho ruido); el cristal se rompe también.
//  · Colgado se dispara y se apunta (dispersión de andar); sin gadgets, habilidades, agacharse
//    ni asomarse. Si lo derriban, cae.
// El cuerpo cuelga a un plano justo fuera de lo que más sobresale de la fachada (zócalo,
// alféizares, molduras, pretil), medido en el mundo al empezar. Sin render: lo prueban los tests.
import { boxFree, STANCES } from './physics.js';
import { SOLID, MAT, GLASS, SOUND } from '../world/materials.js';
import { raycastFirst } from '../world/raycast.js';
import { barricadeState } from './fortify.js';

export const RAPPEL = {
  up: 1.5, down: 2.5, side: 1.0,          // m/s
  hookGround: 0.5, hookTop: 1.0, climbTop: 0.8, enter: 0.6, breach: 1.2,   // s
  reach: 1.1,         // m: del borde del cuerpo a la fachada (o al pretil, desde el tejado)
  face: 0.7,          // mirando a la pared (o hacia fuera): coseno mínimo
  gap: 0.03,          // m: holgura entre el cuerpo y lo que más sobresale
  headOver: 0.39,     // m: arriba del todo, los ojos asoman esto sobre el pretil
  edge: 0.35,         // m: el centro del cuerpo no se acerca más a los extremos del tramo
  yaw: 100 * Math.PI / 180,   // la vista gira como mucho esto respecto a la pared
  step: 0.7,          // m de cuerda entre pasos en la pared (se oyen)
  breakAt: 0.45,      // s: en la entrada con barricada, cuándo salta la madera
};
const H = 0.125;
const R_BODY = 0.3;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Los tramos del mapa, con lo que hace falta: normales, plano del cuerpo y ventanas (también los usa
// la navegación de los bots para sus pasos de cuerda).
export function buildSegments(world, map) {
  const out = [];
  for (const d of map.rappel || []) {
    const nOut = d.axis === 'x' ? { x: 0, z: d.out } : { x: d.out, z: 0 };
    const nIn = { x: -nOut.x, z: -nOut.z };
    // «derecha» mirando a la pared, y cómo avanza la coordenada del tramo hacia ese lado
    const right = { x: -nIn.z, z: nIn.x };
    const sSign = d.axis === 'x' ? right.x : right.z;
    // lo que más sobresale de la fachada en el tramo, entre el pie y lo alto del pretil
    let face = 0;
    for (let s = d.a + 0.0625; s < d.b; s += 0.125) {
      for (let y = d.bottom + 0.0625; y < d.top; y += 0.125) {
        for (let k = 0.0625; k < 0.9; k += 0.125) {
          const p = d.line + d.out * k;
          const m = d.axis === 'x' ? world.getWorld(s, y, p) : world.getWorld(p, y, s);
          if (SOLID[m] === 1 && k + 0.0625 > face) face = k + 0.0625;
        }
      }
    }
    const plane = face + R_BODY + RAPPEL.gap;
    const windows = (map.windows || []).filter((w) => w.axis === d.axis && Math.abs(w.line - d.line) < 0.3 &&
      w.center + w.width / 2 > d.a && w.center - w.width / 2 < d.b && w.y1 > d.bottom && w.y0 < d.top);
    out.push({ ...d, nOut, nIn, right, sSign, face, plane, windows });
  }
  return out;
}

/** Altura de los pies colgado arriba del todo (los ojos asoman sobre el pretil). */
export function ropeTopY(g) { return g.top - STANCES.stand.eye + RAPPEL.headOver; }

export class Rappel {
  /**
   * @param {Game} game
   * @param {object} o  canRappel(op): ¿puede este operador hacer rappel ahora?
   */
  constructor(game, { canRappel = () => false } = {}) {
    this.game = game;
    this.world = game.world;
    this.map = game.map;
    this.canRappel = canRappel;
    this.segs = buildSegments(game.world, game.map);
    game.rappel = this;
  }

  // posición del cuerpo (los pies) colgado en el tramo, a la altura `y` y en la coordenada `s`
  posAt(g, s, y, out = { x: 0, y: 0, z: 0 }) {
    const c = g.line + g.out * g.plane;
    if (g.axis === 'x') { out.x = s; out.z = c; } else { out.x = c; out.z = s; }
    out.y = y;
    return out;
  }
  _s(g, p) { return g.axis === 'x' ? p.x : p.z; }
  // distancia (con signo, + fuera) de un punto a la línea de la fachada
  _d(g, p) { return (g.axis === 'x' ? p.z - g.line : p.x - g.line) * g.out; }
  _topY(g) { return ropeTopY(g); }   // pies arriba del todo

  /**
   * ¿Dónde se engancharía `op` si pulsa Espacio ahora? {seg, s, from: 'ground'|'top'} o null.
   */
  hookSpot(op) {
    if (!this.canRappel(op) || op.state !== 'alive' || op.frozen || op.channel || op.reviving || op.vault || op.rappel || op.stance === 'prone' || !op.body.onGround) return null;
    const p = op.body.pos;
    const f = op.viewDir(), fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
    let best = null, bestD = Infinity;
    for (const g of this.segs) {
      const s = this._s(g, p);
      if (s < g.a + RAPPEL.edge || s > g.b - RAPPEL.edge) continue;
      const d = this._d(g, p);
      // desde el suelo: fuera, al pie de la fachada y mirándola
      if (d > 0 && Math.abs(p.y - g.bottom) < 0.45 && d - R_BODY - g.face <= RAPPEL.reach && fx * g.nIn.x + fz * g.nIn.z >= RAPPEL.face) {
        if (d < bestD) { bestD = d; best = { seg: g, s, from: 'ground' }; }
      }
      // desde el tejado: dentro, junto al pretil y mirando hacia fuera
      if (d < 0 && Math.abs(p.y - g.roof) < 0.45 && -d - R_BODY - 0.125 <= RAPPEL.reach && fx * g.nOut.x + fz * g.nOut.z >= RAPPEL.face) {
        if (-d < bestD) { bestD = -d; best = { seg: g, s, from: 'top' }; }
      }
    }
    return best;
  }

  /** Engancharse si se puede (Espacio). Devuelve true si empieza. */
  tryHook(op) {
    const h = this.hookSpot(op);
    if (!h) return false;
    const g = h.seg, b = op.body;
    const s = Math.max(g.a + RAPPEL.edge, Math.min(g.b - RAPPEL.edge, h.s));
    const y = h.from === 'ground' ? g.bottom + 0.3 : this._topY(g);
    const to = this.posAt(g, s, y);
    if (!boxFree(this.world, to.x, to.y, to.z, R_BODY - 0.02, STANCES.stand.height)) return false;
    op.rappel = {
      seg: g, s, y, phase: h.from === 'ground' ? 'hookGround' : 'hookTop', t: 0,
      dur: h.from === 'ground' ? RAPPEL.hookGround : RAPPEL.hookTop,
      from: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, to, over: h.from === 'top' ? g.top + 0.05 : null,
      stanceWas: op.intent.stance, stepAcc: 0, slideT: 0, win: null, broke: false,
    };
    op.stance = 'stand'; b.height = STANCES.stand.height;
    op.sprinting = false; op.lean = 0; op.leanAllowed = 0;
    b.vel.x = b.vel.y = b.vel.z = 0;
    this.game.emit('rappelHook', op, g);
    return true;
  }

  /** Soltarse de la cuerda (C, derribado o al acabar): cae con la física de siempre. */
  release(op) {
    if (!op.rappel) return;
    op.rappel = null;
    op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
    op.body.onGround = false;
    this.game.emit('rappelOff', op, 'drop');
  }

  // Ventana delante del que cuelga: con el cuerpo casi entero delante del hueco y el hueco entre las
  // rodillas y el pecho.
  windowAt(op) {
    const R = op.rappel;
    if (!R || R.phase !== 'hang') return null;
    for (const w of R.seg.windows) {
      const half = w.width / 2;
      if (R.s < w.center - half + 0.15 || R.s > w.center + half - 0.15) continue;
      if (w.y0 < R.y - 0.4 || w.y0 > R.y + 1.1) continue;
      return w;
    }
    return null;
  }

  /** Un tick de quien cuelga (el operador ya comprobó que sigue vivo y en pie). */
  tick(op, dt) {
    const R = op.rappel, g = R.seg, b = op.body, I = op.intent, world = this.world;
    b.vel.x = b.vel.y = b.vel.z = 0; b.onGround = false;
    // la vista no da la vuelta del todo: el cuerpo va contra la pared
    const wallYaw = Math.atan2(-g.nIn.x, -g.nIn.z);
    const dy = wrap(op.yaw - wallYaw);
    if (Math.abs(dy) > RAPPEL.yaw) op.yaw = wallYaw + Math.sign(dy) * RAPPEL.yaw;
    if (R.phase !== 'hang') { this._transition(op, dt); return; }
    // soltarse: al pedir agacharse o tumbarse (el cambio, no el estado)
    const st = I.stance;
    if ((st === 'crouch' || st === 'prone') && R.stanceWas !== st) { R.stanceWas = st; this.release(op); return; }
    R.stanceWas = st;
    // subir, bajar y a los lados
    const up = I.moveZ > 0.2 ? 1 : I.moveZ < -0.2 ? -1 : 0, side = I.moveX > 0.2 ? 1 : I.moveX < -0.2 ? -1 : 0;
    const vy = up > 0 ? RAPPEL.up : up < 0 ? -RAPPEL.down : 0;
    const y0 = R.y, s0 = R.s;
    let ny = Math.min(this._topY(g), R.y + vy * dt);
    const ns = Math.max(g.a + RAPPEL.edge, Math.min(g.b - RAPPEL.edge, R.s + side * RAPPEL.side * g.sSign * dt));
    // el suelo debajo: al tocarlo, de pie
    const floor = this._floorBelow(g, R.s, R.y);
    if (vy < 0 && ny <= floor + 0.02) {
      const p = this.posAt(g, R.s, floor);
      b.pos.x = p.x; b.pos.y = floor; b.pos.z = p.z; b.onGround = true;
      op.rappel = null;
      this.game.emit('rappelOff', op, 'ground');
      return;
    }
    ny = Math.max(ny, floor + 0.02);
    // no atravesar nada al moverse (lo de la fachada ya queda detrás del plano)
    const q = this.posAt(g, ns, ny);
    if (boxFree(world, q.x, q.y, q.z, R_BODY - 0.02, STANCES.stand.height)) { R.s = ns; R.y = ny; }
    else {
      const q2 = this.posAt(g, R.s, ny);
      if (boxFree(world, q2.x, q2.y, q2.z, R_BODY - 0.02, STANCES.stand.height)) R.y = ny;
    }
    const p = this.posAt(g, R.s, R.y);
    b.pos.x = p.x; b.pos.y = p.y; b.pos.z = p.z;
    const moved = Math.abs(R.y - y0) + Math.abs(R.s - s0);
    op.moveSpeed = moved / Math.max(dt, 1e-6);
    // pasos en la pared y la cuerda al bajar deprisa (se oyen)
    R.stepAcc += moved;
    if (R.stepAcc >= RAPPEL.step) {
      R.stepAcc = 0;
      const c = this.posAt(g, R.s, R.y + 0.9), wx = c.x + g.nIn.x * (g.plane - 0.06), wz = c.z + g.nIn.z * (g.plane - 0.06);
      const mat = world.getWorld(wx, c.y, wz);
      this.game.emit('footstep', op, SOUND[mat] || 3, 0.45);
    }
    R.slideT -= dt;
    if (vy < 0 && R.slideT <= 0) { R.slideT = 0.45; this.game.emit('rappelSlide', op); }
    // Espacio: entrar por la ventana de delante o subir al tejado (arriba del todo)
    if (I.vault) {
      I.vault = false;
      const w = this.windowAt(op);
      if (w) this._startEnter(op, w);
      else if (R.y >= this._topY(g) - 0.05) this._startClimb(op);
    }
  }

  // suelo bajo el que cuelga (la calle, el jardín o el tejado del garaje)
  _floorBelow(g, s, y) {
    const p = this.posAt(g, s, y);
    const hit = raycastFirst(this.world, p.x, y + 0.3, p.z, 0, -1, 0, 30);
    return hit ? y + 0.3 - hit.t : g.bottom;
  }

  _startClimb(op) {
    const R = op.rappel, g = R.seg;
    // a 0,7 m dentro del pretil, en el suelo del tejado
    const c = this.posAt(g, R.s, g.roof);
    const k = g.plane + 0.7;
    const to = { x: c.x + g.nIn.x * k, y: g.roof + 0.02, z: c.z + g.nIn.z * k };
    if (!boxFree(this.world, to.x, to.y, to.z, R_BODY - 0.02, STANCES.stand.height)) { this.game.emit('rappelBlocked', op, 'Sin sitio arriba'); return; }
    const b = op.body.pos;
    Object.assign(R, { phase: 'climbTop', t: 0, dur: RAPPEL.climbTop, from: { x: b.x, y: b.y, z: b.z }, to, over: g.top + 0.05 });
    this.game.emit('vault', op);
  }

  _startEnter(op, w) {
    const R = op.rappel, g = R.seg, world = this.world;
    const floor = this.map.builder && this.map.builder.levels[w.level] ? this.map.builder.levels[w.level].floor : w.y0 - w.sill;
    const half = w.width / 2;
    const s = Math.max(w.center - half + 0.3, Math.min(w.center + half - 0.3, R.s));
    // dentro, a 0,65 m (o 0,95 si hay un mueble), agachado
    let to = null;
    for (const k of [0.65, 0.95, 1.25]) {
      const px = g.axis === 'x' ? s : g.line + g.nIn.x * k, pz = g.axis === 'x' ? g.line + g.nIn.z * k : s;
      if (boxFree(world, px, floor + 0.02, pz, 0.26, STANCES.crouch.height)) { to = { x: px, y: floor + 0.02, z: pz }; break; }
    }
    if (!to) { this.game.emit('rappelBlocked', op, 'Ventana bloqueada'); return; }
    const wood = barricadeState(world, w).wood > 0.05;
    const b = op.body.pos;
    Object.assign(R, {
      phase: wood ? 'breach' : 'enter', t: 0, dur: wood ? RAPPEL.breach : RAPPEL.enter,
      from: { x: b.x, y: b.y, z: b.z }, to, over: w.y0 + 0.05, win: w, broke: false, glassDone: false,
    });
    op.stance = 'crouch'; op.body.height = STANCES.crouch.height;
    op.ads = 0;
  }

  // lo que queda en el hueco de la ventana: cristal y madera de la barricada (las dos mitades del muro)
  _breakWindow(op, w, kinds) {
    const world = this.world, list = [];
    const a = w.center - w.width / 2, bb = w.center + w.width / 2;
    const vy0 = world.vy(w.y0 + 1e-4), vy1 = world.vy(w.y1 - 1e-4);
    if (w.axis === 'x') {
      const vz0 = world.vz(w.line - H + 1e-4), vz1 = world.vz(w.line + H - 1e-4), vx0 = world.vx(a + 1e-4), vx1 = world.vx(bb - 1e-4);
      for (let y = vy0; y <= vy1; y++) for (let z = vz0; z <= vz1; z++) for (let x = vx0; x <= vx1; x++) { const m = world.get(x, y, z); if ((kinds.glass && GLASS[m]) || (kinds.wood && m === MAT.BARRICADE)) list.push([x, y, z]); }
    } else {
      const vx0 = world.vx(w.line - H + 1e-4), vx1 = world.vx(w.line + H - 1e-4), vz0 = world.vz(a + 1e-4), vz1 = world.vz(bb - 1e-4);
      for (let y = vy0; y <= vy1; y++) for (let z = vz0; z <= vz1; z++) for (let x = vx0; x <= vx1; x++) { const m = world.get(x, y, z); if ((kinds.glass && GLASS[m]) || (kinds.wood && m === MAT.BARRICADE)) list.push([x, y, z]); }
    }
    if (!list.length) return 0;
    const pt = { x: w.x, y: (w.y0 + w.y1) / 2, z: w.z };
    this.game.clearVoxels(list, 'rappel', pt);
    return list.length;
  }

  // enganche, subida al tejado y entrada por la ventana: el cuerpo va por su camino
  _transition(op, dt) {
    const R = op.rappel, b = op.body, g = R.seg;
    R.t += dt;
    const k = Math.min(1, R.t / R.dur), e = k * k * (3 - 2 * k);
    const F = R.from, T = R.to;
    if (R.phase === 'hookGround') {
      b.pos.x = F.x + (T.x - F.x) * e; b.pos.z = F.z + (T.z - F.z) * e; b.pos.y = F.y + (T.y - F.y) * e;
    } else if (R.phase === 'hookTop' || R.phase === 'climbTop') {
      // por encima del pretil: primero arriba, luego al otro lado y abajo
      const up = Math.min(1, k / 0.35), across = Math.max(0, Math.min(1, (k - 0.25) / 0.5)), down = Math.max(0, (k - 0.6) / 0.4);
      const ay = F.y + (R.over - F.y) * up;
      b.pos.x = F.x + (T.x - F.x) * across; b.pos.z = F.z + (T.z - F.z) * across;
      b.pos.y = ay + (T.y - R.over) * down;
    } else {
      // por la ventana: hasta el hueco y dentro; con barricada, primero la rompe
      const hold = R.phase === 'breach' ? RAPPEL.breakAt / R.dur : 0;
      const m = Math.max(0, (k - hold) / (1 - hold)), mm = m * m * (3 - 2 * m);
      if (R.phase === 'breach' && !R.broke && R.t >= RAPPEL.breakAt) {
        R.broke = true;
        const n = this._breakWindow(op, R.win, { wood: true, glass: true });
        this.game.emit('rappelBreach', op, R.win, n);
      }
      if (!R.glassDone && (R.phase === 'enter' ? R.t >= 0.08 : R.broke)) {
        R.glassDone = true;
        const n = this._breakWindow(op, R.win, { glass: true, wood: R.phase === 'enter' });
        if (n) this.game.emit('rappelGlass', op, R.win, n);
      }
      const lift = Math.sin(mm * Math.PI) * 0.12;
      b.pos.x = F.x + (T.x - F.x) * mm; b.pos.z = F.z + (T.z - F.z) * mm;
      b.pos.y = F.y + (Math.max(T.y, R.over) - F.y) * Math.min(1, mm * 1.8) + (mm > 0.55 ? (T.y - Math.max(T.y, R.over)) * (mm - 0.55) / 0.45 : 0) + lift;
    }
    if (k < 1) return;
    if (R.phase === 'hookGround' || R.phase === 'hookTop') {
      R.phase = 'hang'; R.t = 0;
      const p = this.posAt(g, R.s, R.y);
      b.pos.x = p.x; b.pos.y = p.y; b.pos.z = p.z;
      return;
    }
    // arriba o dentro: de pie (o agachado) en el suelo
    b.pos.x = T.x; b.pos.y = T.y; b.pos.z = T.z;
    op.rappel = null;
    b.onGround = false;
    this.game.emit('rappelOff', op, R.phase === 'climbTop' ? 'roof' : 'window');
  }

  /** Lo que se puede hacer ahora (para el aviso en pantalla), o ''. */
  hint(op) {
    const R = op.rappel;
    if (R) {
      if (R.phase !== 'hang') return '';
      const w = this.windowAt(op);
      if (w) return barricadeState(this.world, w).wood > 0.05 ? 'Pulsa Espacio para romper la barricada y entrar' : 'Pulsa Espacio para entrar por la ventana';
      if (R.y >= this._topY(R.seg) - 0.05) return 'Pulsa Espacio para subir al tejado · S para bajar';
      return 'W/S: subir y bajar · A/D: a los lados · C: soltarse';
    }
    return this.hookSpot(op) ? 'Pulsa Espacio para hacer rappel' : '';
  }
}

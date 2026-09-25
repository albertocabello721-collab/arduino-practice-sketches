// Habilidades de los operadores (tecla X), sección 12 del documento. Cada operador tiene
// una, con sus cargas (op.ability = {id, left}; -1 = sin límite). Los objetos que dejan
// en el mundo (cargas, proyectiles, nubes, granadas) viven en Gadgets, igual que los de G.
// Ataque (Fase 6.4a):
//   · TERMO · carga térmica ×2: X mirando un muro blando o reforzado o una trampilla a
//     menos de 1,6 m la coloca en 2 s (quieto); X otra vez la enciende: arde 5 s y abre
//     un hueco de 1,9 m de alto × 1,1 de ancho a ras de suelo, también en los refuerzos.
//   · ROMPE · proyectil de brecha ×2: vuela recto hasta 40 m, se pega a lo que toca y a
//     los 1,5 s abre 1,5 m de pared blanda (o quita la barricada o la trampilla sin reforzar).
//   · NUBE · humo remoto ×3: vuela recto hasta 40 m; nube de 4 m durante 10 s donde choca.
//   · CHISPA · granada PEM ×3: se lanza; a los 2 s deja 15 s sin funcionar la electrónica
//     de la defensa a menos de 5 m, aunque haya paredes.
// Información (Fase 6.4b):
//   · RADAR · pulso de escaneo ×3: aviso audible de 2 s para todos; después, durante 4 s,
//     todo defensor que se mueva queda marcado para el ataque. Contra: quedarse quieto.
//   · LUMEN · visor térmico 3x (sin límite, pasivo): con el arma principal, apuntando y
//     quieto, los enemigos a menos de 30 m y a la vista se ven con colores de calor,
//     también dentro del humo (los bots LUMEN, igual).
// Anti-gadgets (Fase 6.4c):
//   · PULGA · dron de choque: su primer dron dispara un rayo (clic o X mientras lo pilota)
//     que destruye los gadgets de la defensa a menos de 8 m en línea recta: alambre,
//     cámaras (también las blindadas), alarmas y C4. No atraviesa paredes ni rompe el
//     escudo desplegable. 6 cargas; recupera 1 cada 12 s. X a pie: pilotar ese dron.
// Escudo (Fase 6.4d):
//   · MURALLA · escudo balístico: siempre delante (solo lleva pistola); para las balas de
//     frente desde las espinillas hasta encima de la cabeza (agachado, casi entero). Correr,
//     plantar o reanimar lo bajan y lo dejan expuesto. X: destello (×4) que ciega como una
//     cegadora en un cono de 90° y 5 m, tras 0,4 s de carga. Golpe con escudo (V): 40.
//     Contras: flanquearlo, disparar a los pies o a la cabeza que asoma, explosivos.
// Defensa (Fase 6.5a):
//   · VOLTIO · batería ×4: X la pone en 1 s en un refuerzo, una barricada o un alambre a
//     menos de 2 m y los electrifica (ver gadgets.js).
//   · SILENCIO · inhibidor ×4: X lo pone en 1 s en el suelo o una pared a menos de 2 m; a
//     2,5 m los drones enemigos pierden la señal y las cargas remotas no detonan.
// El resto (6.5b-c) llega en las siguientes rondas: hasta entonces X no hace nada.
// Simulación pura (corre en Node).
import { ABILITY_CD, FLASH } from './gadgets.js';
import { raycastFirst, lineOfSight } from '../world/raycast.js';
import { SOLID } from '../world/materials.js';
import { rayAABB } from './recon.js';
import { BONE } from './skeleton.js';

export const SCAN = { warn: 2, active: 4, speed: 0.25, linger: 0.6 };
export const THERMAL_SCOPE = { range: 30, zoom: 3, still: 0.3, ads: 0.85 };
export const SHOCK = { charges: 6, regen: 12, range: 8, cooldown: 0.5 };
// escudo balístico: media anchura, distancia al pecho, borde inferior (de pie / agachado) y
// lo que sobresale por encima de la cabeza; ángulo en el que protege; golpe y destellos
export const BSHIELD = { hw: 0.31, front: 0.42, low: 0.45, lowCrouch: 0.18, top: 0.22, cover: 0.34, bash: 40, windup: 0.4, range: 5, cone: Math.cos(Math.PI / 4) };

/** Habilidades ya programadas (las demás aún no se muestran en el HUD). */
export const ABILITY_READY = { thermal: true, breachround: true, remotesmoke: true, emp: true, scan: true, thermalscope: true, shockdrone: true, shield: true, battery: true, jammer: true };

/** ¿Tiene `op` el escudo balístico levantado? (correr, plantar o reanimar lo bajan) */
export function shieldUp(op) {
  return !!op.ability && op.ability.id === 'shield' && op.state === 'alive' && !op.frozen && !op.sprinting &&
    !op.channel && !op.reviving && !op.vault && op.stance !== 'prone';
}
/** Caja del escudo: centro (x, z), alturas y orientación (la del cuerpo). */
export function shieldBox(op) {
  const r = op.rig, b = op.body.pos;
  const chest = r && r[BONE.chest] ? r[BONE.chest].p : { x: b.x, y: b.y + 1.3, z: b.z };
  const head = r && r[BONE.head] ? r[BONE.head].p : { x: b.x, y: b.y + 1.65, z: b.z };
  const fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
  return {
    x: chest.x + fx * BSHIELD.front, z: chest.z + fz * BSHIELD.front, fx, fz,
    y0: b.y + (op.stance === 'crouch' ? BSHIELD.lowCrouch : BSHIELD.low), y1: head.y + BSHIELD.top,
  };
}
/** ¿Protege el escudo de `op` contra algo que viene de `from`? (de frente, no de lado) */
export function shieldFaces(op, from) {
  if (!shieldUp(op)) return false;
  const b = op.body.pos, dx = from.x - b.x, dz = from.z - b.z, L = Math.hypot(dx, dz) || 1;
  return (dx * -Math.sin(op.yaw) + dz * -Math.cos(op.yaw)) / L > BSHIELD.cover;
}
// El escudo como objeto que para las balas (blindado e indestructible) de la lista de la partida.
function shieldTarget(op) {
  return {
    kind: 'shield', owner: op, team: op.team, alive: true, bulletproof: true, indestructible: true,
    center() { const s = shieldBox(op); return { x: s.x, y: (s.y0 + s.y1) / 2, z: s.z }; },
    rayTest(o, d, maxT) {
      if (!shieldUp(op)) return -1;
      const s = shieldBox(op), rx = -s.fz, rz = s.fx;          // derecha y delante (plano horizontal)
      const ox = o.x - s.x, oz = o.z - s.z;
      const lo = { x: ox * rx + oz * rz, y: o.y, z: ox * s.fx + oz * s.fz };
      const ld = { x: d.x * rx + d.z * rz, y: d.y, z: d.x * s.fx + d.z * s.fz };
      return rayAABB(lo, ld, -BSHIELD.hw, s.y0, -0.03, BSHIELD.hw, s.y1, 0.03, maxT);
    },
  };
}
// Lo que el rayo del dron de choque destruye (objetos de la defensa)
const ZAPPABLE = { gadget: true, cam: true };

/** ¿Tiene `op` el visor térmico en marcha? (arma principal, apuntando y quieto) */
export function thermalOn(op) {
  return !!op.ability && op.ability.id === 'thermalscope' && op.state === 'alive' && op.weaponIndex === 0 &&
    op.ads > THERMAL_SCOPE.ads && (op.moveSpeed || 0) < THERMAL_SCOPE.still;
}
/** Aumento al apuntar: el visor de LUMEN es de 3x con el arma principal. */
export function scopeZoom(op) {
  const z = op.weapon.def.adsZoom;
  return op.ability && op.ability.id === 'thermalscope' && op.weaponIndex === 0 ? Math.max(z, THERMAL_SCOPE.zoom) : z;
}

export class Abilities {
  constructor(game, gadgets) {
    this.game = game;
    this.gadgets = gadgets;
    this.scans = [];           // pulsos de RADAR en curso {owner, team, t0, from, until, seen}
    game.abilities = this;
  }
  reset() {
    this.scans = [];
    for (const op of this.game.operators) op.abilityCd = 0;
    this.game.targets = this.game.targets.filter((t) => t.kind !== 'shield');
  }
  /** El pulso de escaneo en curso que afecta al equipo `team` (el más reciente), o null. */
  scanAgainst(team) {
    let best = null;
    for (const s of this.scans) if (s.team !== team && (!best || s.t0 > best.t0)) best = s;
    return best;
  }

  /** ¿Tiene `op` una habilidad que ya funciona? */
  ready(op) { return !!op.ability && !!ABILITY_READY[op.ability.id]; }

  /**
   * X: usa la habilidad de `op`. La carga térmica colocada se enciende con otra X.
   * Devuelve lo que ha hecho ('place', 'ignite', 'fire', 'throw') o null.
   */
  use(op) {
    const a = op.ability, G = this.gadgets;
    if (!a || op.state !== 'alive' || op.frozen) return null;
    switch (a.id) {
      case 'thermal': {
        const c = G.thermalOf(op);
        if (c) return G.ignite(c) ? 'ignite' : null;
        return G.startPlace(op, 'ability') ? 'place' : null;
      }
      case 'breachround': return G.fireRound(op, 'breachround') ? 'fire' : null;
      case 'remotesmoke': return G.fireRound(op, 'smokeround') ? 'fire' : null;
      case 'emp': return G.throwFrom(op, 'ability') ? 'throw' : null;
      case 'scan': return this.startScan(op) ? 'scan' : null;
      case 'shield': return this.startFlash(op) ? 'flash' : null;
      case 'battery': case 'jammer': return G.startPlace(op, 'ability') ? 'place' : null;
      default: return null;       // (el visor térmico es pasivo: apuntar y quedarse quieto)
    }
  }

  // ---------------------------------------------------------------- escudo balístico (MURALLA)
  startFlash(op) {
    if (!this.gadgets.canUse(op, 'ability') || op.flashT > 0) return false;
    if (!shieldUp(op)) { this.game.emit('abilityDenied', op, 'Con el escudo bajado no hay destello'); return false; }
    op.ability.left--;
    op.abilityCd = ABILITY_CD;
    op.flashT = BSHIELD.windup;
    this.game.emit('shieldFlashCharge', op);
    return true;
  }
  _shieldFlash(op) {
    const g = this.game, s = shieldBox(op), b = op.body.pos;
    const chestY = op.rig && op.rig[BONE.chest] ? op.rig[BONE.chest].p.y : b.y + 1.3;
    const p = { x: s.x + s.fx * 0.06, y: Math.min(s.y1 - 0.2, chestY + 0.15), z: s.z + s.fz * 0.06 };
    const hitList = [];
    for (const t of g.operators) {
      if (t.team === op.team || t.state !== 'alive' || t.frozen) continue;
      const e = t.eyePos();
      const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z, d = Math.hypot(dx, dy, dz);
      if (d > BSHIELD.range) continue;
      const hd = Math.hypot(dx, dz) || 1;
      if ((dx * s.fx + dz * s.fz) / hd < BSHIELD.cone) continue;          // fuera del cono de 90°
      if (!lineOfSight(g.world, p.x, p.y, p.z, e.x, e.y, e.z)) continue;
      // como una cegadora: entera si mira al escudo; de lado o de espaldas, menos
      const v = t.viewDir();
      const facing = -(dx * v.x + dy * v.y + dz * v.z) / Math.max(0.01, d);
      const look = facing > 0.5 ? 1 : facing > -0.3 ? 0.35 + (facing + 0.3) * 0.8125 : 0.3;
      const secs = Math.max(FLASH.min, FLASH.max * look);
      t.blindT = Math.max(t.blindT || 0, secs);
      t.blindMax = Math.max(t.blindT, t.blindMax || 0);
      hitList.push(t);
    }
    g.emit('shieldFlash', op, p, hitList);
  }
  _shieldTick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      if (!op.ability || op.ability.id !== 'shield') continue;
      // el escudo en la lista de objetos que paran balas (uno por operador, mientras viva)
      if (!op._shieldTarget && op.state !== 'dead') { op._shieldTarget = shieldTarget(op); g.targets.push(op._shieldTarget); }
      if (op.state === 'dead' && op._shieldTarget) { g.targets = g.targets.filter((t) => t !== op._shieldTarget); op._shieldTarget = null; }
      op.meleeDamage = shieldUp(op) ? BSHIELD.bash : undefined;        // golpe con escudo
      if (op.flashT > 0) {
        op.flashT -= dt;
        if (op.flashT <= 0) { op.flashT = 0; if (op.state === 'alive') this._shieldFlash(op); }
      }
    }
  }

  // ---------------------------------------------------------------- dron de choque (PULGA)
  /** El dron de choque de `op` (vivo) o null. */
  shockDroneOf(op) {
    const R = this.gadgets.recon;
    return R ? R.drones.find((d) => d.owner === op && d.shock && d.alive) || null : null;
  }
  /** Rayo del dron de choque: destruye el primer gadget de la defensa en línea recta. */
  zap(d) {
    const g = this.game, op = d.owner, a = op && op.ability;
    if (!d.alive || !d.shock || !a || a.id !== 'shockdrone' || (d.zapCd || 0) > 0) return null;
    if (a.left <= 0) { g.emit('abilityEmpty', op); return null; }
    if (!this.canZap(d)) { g.emit('abilityDenied', op, 'Sin señal: el rayo no responde'); return null; }
    a.left--;
    d.zapCd = SHOCK.cooldown;
    const e = d.eyePos(), dir = d.viewDir();
    const wall = raycastFirst(g.world, e.x, e.y, e.z, dir.x, dir.y, dir.z, SHOCK.range, SOLID, true);
    let best = null, bt = wall ? wall.t : SHOCK.range;
    for (const tg of g.targets) {
      if (!tg.alive || !ZAPPABLE[tg.kind] || tg.team === d.team || tg.indestructible) continue;
      let t = tg.rayTest(e, dir, bt);
      if (t < 0 && tg.center) {
        // (el rayo es generoso: basta con apuntar cerca del centro, si se ve)
        const c = tg.center(), vx = c.x - e.x, vy = c.y - e.y, vz = c.z - e.z;
        const along = vx * dir.x + vy * dir.y + vz * dir.z;
        const perp = Math.hypot(vx - dir.x * along, vy - dir.y * along, vz - dir.z * along);
        if (along > 0 && along < bt && perp < 0.06 + along * 0.03 && lineOfSight(g.world, e.x, e.y, e.z, c.x - dir.x * 0.08, c.y - dir.y * 0.08, c.z - dir.z * 0.08)) t = along;
      }
      if (t >= 0 && t < bt) { bt = t; best = tg; }
    }
    const to = { x: e.x + dir.x * bt, y: e.y + dir.y * bt, z: e.z + dir.z * bt };
    g.emit('shockZap', d, { ...e }, to, best);
    if (best) g.destroyTarget(best, op, to);
    return best;
  }
  // Un inhibidor de SILENCIO cerca le corta la señal.
  canZap(d) { return !this.gadgets.jammedAt(d.center(), d.team); }
  _shockTick(dt) {
    const R = this.gadgets.recon;
    if (R) for (const d of R.drones) {
      if (d.zapCd > 0) d.zapCd -= dt;
      if (d.intent.zap) { d.intent.zap = false; this.zap(d); }
    }
    // recarga: una carga cada 12 s hasta 6
    for (const op of this.game.operators) {
      const a = op.ability;
      if (!a || a.id !== 'shockdrone' || op.state === 'dead') continue;
      if (a.left >= SHOCK.charges) { op.shockT = 0; continue; }
      op.shockT = (op.shockT || 0) + dt;
      if (op.shockT >= SHOCK.regen) { op.shockT -= SHOCK.regen; a.left++; }
    }
  }

  // ---------------------------------------------------------------- pulso de escaneo (RADAR)
  startScan(op) {
    if (!this.gadgets.canUse(op, 'ability')) return false;
    if (this.scans.some((s) => s.owner === op)) { this.game.emit('abilityDenied', op, 'Espera a que termine el escaneo'); return false; }
    const now = this.game.time;
    const s = { owner: op, team: op.team, t0: now, from: now + SCAN.warn, until: now + SCAN.warn + SCAN.active, seen: new Set(), started: false };
    this.scans.push(s);
    op.ability.left--;
    op.abilityCd = ABILITY_CD;
    this.game.emit('scanWarn', s);
    return true;
  }
  _scanTick() {
    if (!this.scans.length) return;
    const g = this.game, now = g.time, recon = this.gadgets.recon;
    for (const s of this.scans) {
      if (now < s.from) continue;
      if (!s.started) { s.started = true; g.emit('scanStart', s); }
      for (const op of g.operators) {
        if (op.team === s.team || op.state === 'dead' || op.frozen) continue;
        if ((op.moveSpeed || 0) <= SCAN.speed) continue;
        // marcado mientras se mueva (y un momento después)
        if (recon) {
          const prev = recon.spotted.get(op);
          if (!prev || prev.team !== s.team || prev.until < now + SCAN.linger) recon.spotted.set(op, { until: now + SCAN.linger, team: s.team, by: s.owner, scan: true });
        }
        if (!s.seen.has(op)) { s.seen.add(op); g.emit('scanDetect', op, s); }
      }
    }
    for (const s of this.scans) if (now >= s.until) g.emit('scanEnd', s);
    this.scans = this.scans.filter((s) => now < s.until);
  }

  tick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      if (op.abilityCd > 0) op.abilityCd -= dt;
      const I = op.intent;
      if (!I.ability) continue;
      I.ability = false;
      // (PULGA: X a pie lleva al dron de choque; eso lo resuelve la vista del jugador)
      if (op.ability && op.ability.id === 'shockdrone') continue;
      if (this.use(op) || op.state !== 'alive' || !this.ready(op)) continue;
      if (op.ability.id === 'thermalscope') { g.emit('abilityDenied', op, 'Visor térmico: apunta con el arma principal y quédate quieto'); continue; }
      // sin cargas (y nada que encender): aviso
      if (op.ability.left === 0 && !this.gadgets.thermalOf(op)) g.emit('abilityEmpty', op);
    }
    this._scanTick();
    this._shockTick(dt);
    this._shieldTick(dt);
  }
}

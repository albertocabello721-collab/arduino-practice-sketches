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
// El resto llega en las siguientes rondas (6.4c-d y 6.5): hasta entonces X no hace nada.
// Simulación pura (corre en Node).
import { ABILITY_CD } from './gadgets.js';

export const SCAN = { warn: 2, active: 4, speed: 0.25, linger: 0.6 };
export const THERMAL_SCOPE = { range: 30, zoom: 3, still: 0.3, ads: 0.85 };

/** Habilidades ya programadas (las demás aún no se muestran en el HUD). */
export const ABILITY_READY = { thermal: true, breachround: true, remotesmoke: true, emp: true, scan: true, thermalscope: true };

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
      default: return null;       // (el visor térmico es pasivo: apuntar y quedarse quieto)
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
      if (this.use(op) || op.state !== 'alive' || !this.ready(op)) continue;
      if (op.ability.id === 'thermalscope') { g.emit('abilityDenied', op, 'Visor térmico: apunta con el arma principal y quédate quieto'); continue; }
      // sin cargas (y nada que encender): aviso
      if (op.ability.left === 0 && !this.gadgets.thermalOf(op)) g.emit('abilityEmpty', op);
    }
    this._scanTick();
  }
}

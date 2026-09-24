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
// El resto llega en las siguientes rondas (6.4b-d y 6.5): hasta entonces X no hace nada.
// Simulación pura (corre en Node).

/** Habilidades ya programadas (las demás aún no se muestran en el HUD). */
export const ABILITY_READY = { thermal: true, breachround: true, remotesmoke: true, emp: true };

export class Abilities {
  constructor(game, gadgets) {
    this.game = game;
    this.gadgets = gadgets;
    game.abilities = this;
  }
  reset() {
    for (const op of this.game.operators) op.abilityCd = 0;
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
      default: return null;
    }
  }

  tick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      if (op.abilityCd > 0) op.abilityCd -= dt;
      const I = op.intent;
      if (!I.ability) continue;
      I.ability = false;
      if (this.use(op) || op.state !== 'alive' || !this.ready(op)) continue;
      // sin cargas (y nada que encender): aviso
      if (op.ability.left === 0 && !this.gadgets.thermalOf(op)) g.emit('abilityEmpty', op);
    }
  }
}

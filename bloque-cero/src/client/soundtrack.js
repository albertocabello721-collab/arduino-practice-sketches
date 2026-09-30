// Qué música toca en cada momento de la ronda (F12.3). Aquí solo se decide; la toca audio/music.js.
//  · selección de operador: la del menú; preparación: percusión suave;
//  · acción: silencio hasta los últimos 30 s, que son de tensión (k sube de 0 a 1);
//  · desactivador plantado: la tensión al paso del pitido (k: lo que lleva de los 45 s);
//  · fin de ronda y de partida: silencio (suenan los 3 s de victoria o de derrota).
// Y el golpe del primer contacto: una vez por ronda, en la acción, cuando un aliado canta
// «¡Contacto!» o hay daño entre los dos bandos.

export const TENSION_FROM = 30;   // s: los últimos 30 s de la acción

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** {mode, k} de la música para esta partida ahora. */
export function musicFor(match) {
  switch (match.phase) {
    case 'select': return { mode: 'menu', k: 0 };
    case 'prep': return { mode: 'prep', k: 0 };
    case 'action': {
      const left = match.timeLeft;
      return left <= TENSION_FROM ? { mode: 'tension', k: clamp01(1 - left / TENSION_FROM) } : { mode: '', k: 0 };
    }
    case 'planted': return { mode: 'planted', k: clamp01(1 - match.timeLeft / match.rules.fuseTime) };
    default: return { mode: '', k: 0 };
  }
}

/** El primer contacto de la ronda para tu equipo: avisa una vez (`onContact`) y no más hasta `reset`. */
export class ContactWatch {
  constructor(onContact) { this.onContact = onContact; this.done = false; this.at = -1; }
  reset() { this.done = false; this.at = -1; }
  _hit(match) {
    if (this.done || (match.phase !== 'action' && match.phase !== 'planted')) return false;
    this.done = true;
    this.at = match.time;
    this.onContact();
    return true;
  }
  /** Aviso de radio: solo el «¡Contacto!» de alguien de tu equipo (el del rival no lo oyes). */
  radio(match, op, key, myTeam) { return key === 'contact' && op && op.team === myTeam ? this._hit(match) : false; }
  /** Daño, derribo o muerte: solo si es entre los dos bandos (tu equipo siempre está en uno). */
  hurt(match, target, ev) {
    const by = ev && ev.by;
    return by && target && by.team !== target.team ? this._hit(match) : false;
  }
}

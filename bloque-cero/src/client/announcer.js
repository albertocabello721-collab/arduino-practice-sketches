// Voces (F12.2): qué dice el locutor y tu operador, y cuándo. Aquí solo se decide el texto; lo lee
// voice.js con la voz del navegador (o nadie, si está apagada en Opciones).

export const LINES = {
  prep: (round) => `Ronda ${round}. Preparación.`,
  action: '¡Acción!',
  thirty: 'Treinta segundos.',
  planted: 'Desactivador plantado.',
  last: 'Eres el último.',
  win: 'Ronda ganada.',
  lose: 'Ronda perdida.',
  matchWin: 'Partida ganada.',
  matchLose: 'Partida perdida.',
};

// Lo que dice tu operador al hacer cada cosa (recargar, lanzar o colocar un gadget, reforzar).
export const OP_LINES = {
  reload: '¡Recargando!',
  frag: '¡Granada!', flash: '¡Cegadora!', smoke: '¡Humo!', impact: '¡Granada de impacto!', c4: '¡C4 fuera!',
  emp: '¡PEM!', gas: '¡Gas!', stickycam: 'Cámara fuera.',
  breach: 'Carga puesta.', thermal: 'Carga térmica puesta.', claymore: 'Claymore puesta.', barbed: 'Alambre puesto.',
  shield: 'Escudo puesto.', bpcam: 'Cámara puesta.', alarm: 'Alarma puesta.', battery: 'Batería puesta.',
  jammer: 'Inhibidor puesto.', lasermine: 'Mina puesta.', interceptor: 'Interceptor puesto.',
  reinforced: 'Refuerzo puesto.',
};
export const OP_GAP = 2.5;   // s entre dos frases de tu operador, como poco

/** El locutor de una partida: `say(texto)` lo lee. */
export class Announcer {
  constructor(say) { this.say = say; this.reset(); }
  reset() { this.thirtyDone = false; this.lastDone = false; }
  roundStart(round) { this.reset(); this.say(LINES.prep(round)); }
  action() { this.say(LINES.action); }
  planted() { this.say(LINES.planted); }
  roundEnd(won) { this.say(won ? LINES.win : LINES.lose); }
  matchEnd(won) { this.say(won ? LINES.matchWin : LINES.matchLose); }
  /** Cada paso: los treinta segundos de la acción y si te has quedado solo (una vez por ronda). */
  tick(match, me) {
    const ph = match.phase;
    if (ph !== 'action' && ph !== 'planted') return;
    if (!this.thirtyDone && ph === 'action' && match.timeLeft <= 30) {
      this.thirtyDone = true;
      if (match.timeLeft > 25) this.say(LINES.thirty);
    }
    if (!this.lastDone && me && me.state === 'alive') {
      let mates = 0, foes = 0;
      for (const o of match.game.operators) {
        if (o === me || o.state !== 'alive') continue;
        if (o.team === me.team) mates++; else foes++;
      }
      if (mates === 0 && foes > 0) { this.lastDone = true; this.say(LINES.last); }
    }
  }
}

/** La voz de tu operador: una frase por cosa que haces, como mucho una cada `gap` s. */
export class OperatorVoice {
  constructor(say, gap = OP_GAP) { this.say = say; this.gap = gap; this.at = -Infinity; }
  line(kind, now) {
    const text = OP_LINES[kind];
    if (!text || now - this.at < this.gap) return false;
    this.at = now;
    this.say(text);
    return true;
  }
}

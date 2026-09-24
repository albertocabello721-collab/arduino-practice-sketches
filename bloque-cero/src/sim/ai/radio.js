// Radio de los bots: avisos cortos al chat de su equipo («¡Contacto en PB Cocina!»,
// «Recargando», «Estoy derribado»…). La simulación solo emite el evento 'radio'
// (operador, texto, clave); el cliente lo pinta en el chat y, si se quiere, lo lee en voz.
// Límites para que no sea una lluvia de mensajes:
//  · cada bot habla como mucho una vez cada 2 s (los avisos urgentes pasan siempre);
//  · cada clave tiene su propio enfriamiento por bot (p. ej. «Recargando», 8 s);
//  · el mismo texto no se repite en el mismo equipo antes de 4 s.

// Prefijo de planta para los nombres de sala (como en las llamadas de Siege: «PB Cocina»).
const FLOOR = { B: 'Sót.', 1: 'PB', 2: 'PA' };

/** Nombre corto del lugar: sala con su planta o zona exterior (null si no hay nombre). */
export function callout(map, p) {
  const r = map.roomAt ? map.roomAt(p.x, p.y + 0.2, p.z) : null;
  if (r) return FLOOR[r.level] ? `${FLOOR[r.level]} ${r.name}` : r.name;
  const loc = map.locationAt ? map.locationAt(p.x, p.y + 0.2, p.z) : null;
  return loc && loc !== 'Exterior' ? loc : null;
}

export const RADIO = {
  perBot: 2,        // s entre dos mensajes del mismo bot
  sameText: 4,      // s antes de repetir el mismo texto en el equipo
};

export class Radio {
  constructor(game) {
    this.game = game;
    this.lastBy = new Map();      // operador → último mensaje
    this.lastKey = new Map();     // «operador|clave» → último mensaje con esa clave
    this.lastText = new Map();    // «equipo|texto» → último mensaje con ese texto
    this.log = [];                // últimos mensajes (pruebas y depuración)
  }
  reset() { this.lastBy.clear(); this.lastKey.clear(); this.lastText.clear(); this.log = []; }

  /**
   * `op` avisa a su equipo. Opciones: `force` (urgente: ignora el límite por bot),
   * `cooldown` (s mínimos entre dos avisos de esta clave del mismo bot).
   */
  say(op, key, text, { force = false, cooldown = 0 } = {}) {
    const now = this.game.time;
    if (!force && now - (this.lastBy.get(op) ?? -99) < RADIO.perBot) return false;
    const kk = `${op.id}|${key}`;
    if (cooldown && now - (this.lastKey.get(kk) ?? -99) < cooldown) return false;
    const tk = `${op.team}|${text}`;
    if (now - (this.lastText.get(tk) ?? -99) < RADIO.sameText) return false;
    this.lastBy.set(op, now);
    this.lastKey.set(kk, now);
    this.lastText.set(tk, now);
    this.log.push({ t: now, op, key, text, team: op.team });
    if (this.log.length > 60) this.log.shift();
    this.game.emit('radio', op, text, key);
    return true;
  }
}

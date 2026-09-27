// Por dónde oye la cámara cada sonido (Fase 9), con un límite de trabajo por fotograma: como mucho
// 12 rodeos (buscar la puerta o el agujero por el que llega); los pasos que ya no caben esperan al
// fotograma siguiente y el resto se oye en línea recta. El resultado ({x, y, z, occl}) se pasa a los
// sonidos en lugar de la oclusión: el motor de audio lo coloca en ese punto y lo apaga lo que toque.
import { hear } from '../audio/propagation.js';

export const HEARING = { budget: 12 };

export class Hearing {
  constructor(world, ear) {
    this.world = world;
    this.ear = ear;          // la posición de la cámara (se lee en cada sonido)
    this.used = 0;
    this.waiting = [];
  }
  /** Nuevo fotograma: se repone el límite y suenan los pasos que esperaban. */
  frame() {
    this.used = 0;
    if (!this.waiting.length) return;
    const q = this.waiting;
    this.waiting = [];
    for (const f of q) f();
  }
  /** ¿Queda sitio para otro rodeo en este fotograma? */
  get room() { return this.used < HEARING.budget; }
  /** Por dónde se oye `p`: {x, y, z, occl} (nuevo cada vez). */
  at(p) {
    const h = hear(this.world, this.ear, p, {}, this.room);
    if (h.tried) this.used++;
    return h;
  }
  /** Un paso: si ya no caben más rodeos en este fotograma, suena en el siguiente. */
  step(fn) { if (this.room) fn(); else this.waiting.push(fn); }
}

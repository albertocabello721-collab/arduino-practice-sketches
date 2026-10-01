// La luz que ven los bots (F10.4): el mismo volumen de luz del render (cielo y lámparas), con la
// hora del día. Al atardecer y de noche, a quien está a oscuras (menos de DARK.threshold de luz en
// el pecho) los bots lo detectan a la mitad de distancia —con los ojos, con sus drones y con sus
// cámaras— y reaccionan 100 ms más tarde. Un láser encendido o un fogonazo (un disparo sin supresor
// en los últimos 0,3 s) lo delatan como de día. En las salas con lámparas (todas las de la Villa) y
// bajo las farolas nada cambia; de día, nada cambia en ningún sitio.
import { LightVolume } from '../render/lightvolume.js';
import { timeOf, lightsFor } from '../render/timeofday.js';

export const DARK = {
  threshold: 0.2,     // menos luz que esto (cielo × luz de la hora + lámparas): a oscuras
  rangeK: 0.5,        // alcance de vista contra alguien a oscuras
  reactExtra: 0.1,    // s más de reacción
  flashSecs: 0.3,     // el fogonazo delata durante este tiempo
};
// la caja del volumen de luz (la misma que el render: la casa y la calle)
export const LIGHT_BOX = { min: { x: -8, y: -4, z: -16 }, max: { x: 48, y: 10, z: 30 } };

export class BotLight {
  /** @param volume  un LightVolume: el del render o uno propio (`BotLight.build`) */
  constructor(volume, key = 'dia') {
    this.volume = volume;
    this.key = key;
    this.skyLight = timeOf(key).skyLight;
    this.active = this.skyLight < 1;      // (de día, nada cambia)
    this._s = { sky: 1, warm: 0, cool: 0 };
  }
  /** Un volumen propio (Node: herramientas y pruebas), el que vería el render a esa hora. */
  static build(world, map, key = 'dia') {
    const lv = new LightVolume(world, LIGHT_BOX.min, LIGHT_BOX.max);
    lv.setLights(lightsFor(map, key));
    lv.computeAll();
    return new BotLight(lv, key);
  }
  /** Cuánta luz hay en un punto (0…1 y pico): el cielo según la hora más las lámparas. */
  at(x, y, z) {
    const s = this.volume.sample(x, y, z, this._s);
    return s.sky * this.skyLight + s.warm + s.cool;
  }
  isDark(x, y, z) { return this.active && this.at(x, y, z) < DARK.threshold; }
  /** ¿Está `t` a oscuras para quien lo mira ahora? (No, si lleva el láser encendido o acaba de disparar sin supresor.) */
  hides(t, now) {
    if (!this.active) return false;
    if (t.laserOn) return false;
    if (t.lastShotFlash && now - t.lastShotT < DARK.flashSecs) return false;
    const c = t.center();
    return this.isDark(c.x, c.y, c.z);
  }
}

/** El alcance de vista `base` contra `t`: la mitad si está a oscuras (sin luz o de día, el de siempre). */
export const rangeFor = (light, t, now, base) => (light && light.hides(t, now) ? base * DARK.rangeK : base);

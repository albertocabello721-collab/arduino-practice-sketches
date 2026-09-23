// Definiciones de armas (datos) y estado de cada arma en mano.
// Valores inspirados en el ritmo de Siege: daño alto, tiro a la cabeza letal,
// retroceso vertical que hay que controlar y apuntado preciso.
// (La Fase 2 amplía el arsenal y la Fase 8 la recarga por partes.)

export const WEAPONS = {
  ar: {
    id: 'ar', name: 'F-41', kind: 'Fusil de asalto', auto: true, rpm: 780, damage: 40, pellets: 1,
    mag: 30, reserve: 150, reload: 2.6, reloadEmpty: 3.2, equip: 0.55, adsTime: 0.3, adsZoom: 1.3,
    spreadHip: 2.4, spreadAds: 0.1, spreadMove: 1.8, bloom: 0.35,
    recoilUp: 0.62, recoilSide: 0.3, recoilFirst: 1.5,
    penetration: 0.5, extraBreak: 0, falloff: [25, 45, 0.7], range: 120, sound: 'rifle', model: 'ar',
  },
  smg: {
    id: 'smg', name: 'M-9', kind: 'Subfusil', auto: true, rpm: 900, damage: 31, pellets: 1,
    mag: 32, reserve: 192, reload: 2.2, reloadEmpty: 2.8, equip: 0.45, adsTime: 0.24, adsZoom: 1.15,
    spreadHip: 2.0, spreadAds: 0.18, spreadMove: 1.2, bloom: 0.3,
    recoilUp: 0.5, recoilSide: 0.38, recoilFirst: 1.3,
    penetration: 0.38, extraBreak: 0, falloff: [15, 30, 0.6], range: 100, sound: 'smg', model: 'smg',
  },
  shotgun: {
    id: 'shotgun', name: 'E-12', kind: 'Escopeta', auto: false, rpm: 80, damage: 24, pellets: 8,
    mag: 7, reserve: 35, reload: 3.4, reloadEmpty: 3.4, equip: 0.6, adsTime: 0.3, adsZoom: 1.1,
    spreadHip: 5.5, spreadAds: 4.2, spreadMove: 1.0, bloom: 0,
    recoilUp: 3.2, recoilSide: 0.8, recoilFirst: 1.0,
    penetration: 0.28, extraBreak: 0.7, falloff: [6, 14, 0.35], range: 60, sound: 'shotgun', model: 'shotgun',
  },
  pistol: {
    id: 'pistol', name: 'P-9', kind: 'Pistola', auto: false, rpm: 400, damage: 43, pellets: 1,
    mag: 15, reserve: 60, reload: 2.0, reloadEmpty: 2.4, equip: 0.35, adsTime: 0.2, adsZoom: 1.15,
    spreadHip: 1.8, spreadAds: 0.25, spreadMove: 1.0, bloom: 0.5,
    recoilUp: 1.4, recoilSide: 0.4, recoilFirst: 1.0,
    penetration: 0.3, extraBreak: 0, falloff: [12, 25, 0.6], range: 80, sound: 'pistol', model: 'pistol',
  },
};

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.ammo = def.mag;
    this.reserve = def.reserve;
    this.cooldown = 0;
    this.reloadT = 0;          // tiempo restante de recarga (>0 recargando)
    this.reloadTotal = 0;
    this.equipT = 0;           // tiempo restante de desenfunde
    this.bloom = 0;            // dispersión acumulada por disparo
    this.shotsInBurst = 0;
    this.triggerHeld = false;
  }
  get reloading() { return this.reloadT > 0; }
  get ready() { return this.reloadT <= 0 && this.equipT <= 0; }
  startReload() {
    if (this.reloadT > 0 || this.reserve <= 0 || this.ammo >= this.def.mag + 1) return false;
    if (this.ammo >= this.def.mag && this.def.pellets === 1) return false; // ya lleno (+1 en recámara)
    this.reloadTotal = this.ammo > 0 ? this.def.reload : this.def.reloadEmpty;
    this.reloadT = this.reloadTotal;
    return true;
  }
  finishReload() {
    // recarga táctica: con bala en recámara el cargador admite +1
    const cap = this.ammo > 0 && this.def.pellets === 1 ? this.def.mag + 1 : this.def.mag;
    const need = cap - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take; this.reserve -= take;
  }
}

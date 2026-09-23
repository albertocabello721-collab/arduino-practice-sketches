// Arsenal (datos) y estado de cada arma en mano.
// Ritmo de Siege: daño alto, tiro a la cabeza letal, retroceso vertical que hay
// que controlar, apuntado preciso y penetración a través de paredes blandas.
// falloff: [inicio caída (m), fin caída (m), multiplicador mínimo]
// (La Fase 8 añade la recarga por partes.)

export const WEAPONS = {
  // ---------------- fusiles de asalto
  ar: {
    id: 'ar', name: 'F-41', kind: 'Fusil de asalto', cls: 'rifle', auto: true, rpm: 780, damage: 40, pellets: 1,
    mag: 30, reserve: 150, reload: 2.6, reloadEmpty: 3.2, equip: 0.55, adsTime: 0.3, adsZoom: 1.3,
    spreadHip: 2.4, spreadAds: 0.1, spreadMove: 1.8, bloom: 0.35,
    recoilUp: 0.62, recoilSide: 0.3, recoilFirst: 1.5,
    penetration: 0.5, extraBreak: 0, falloff: [25, 45, 0.7], range: 120, sound: 'rifle', model: 'ar',
  },
  ar2: {
    id: 'ar2', name: 'K-7 Pesado', kind: 'Fusil de asalto', cls: 'rifle', auto: true, rpm: 640, damage: 46, pellets: 1,
    mag: 25, reserve: 125, reload: 2.8, reloadEmpty: 3.4, equip: 0.6, adsTime: 0.34, adsZoom: 1.4,
    spreadHip: 2.8, spreadAds: 0.08, spreadMove: 2.0, bloom: 0.4,
    recoilUp: 0.8, recoilSide: 0.34, recoilFirst: 1.6,
    penetration: 0.6, extraBreak: 0, falloff: [28, 50, 0.72], range: 130, sound: 'rifle', model: 'ar2',
  },
  // ---------------- subfusiles
  smg: {
    id: 'smg', name: 'M-9', kind: 'Subfusil', cls: 'smg', auto: true, rpm: 900, damage: 31, pellets: 1,
    mag: 32, reserve: 192, reload: 2.2, reloadEmpty: 2.8, equip: 0.45, adsTime: 0.24, adsZoom: 1.15,
    spreadHip: 2.0, spreadAds: 0.18, spreadMove: 1.2, bloom: 0.3,
    recoilUp: 0.5, recoilSide: 0.38, recoilFirst: 1.3,
    penetration: 0.38, extraBreak: 0, falloff: [15, 30, 0.6], range: 100, sound: 'smg', model: 'smg',
  },
  smg2: {
    id: 'smg2', name: 'V-22 Avispa', kind: 'Subfusil', cls: 'smg', auto: true, rpm: 1100, damage: 26, pellets: 1,
    mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.5, equip: 0.4, adsTime: 0.22, adsZoom: 1.12,
    spreadHip: 2.2, spreadAds: 0.22, spreadMove: 1.1, bloom: 0.25,
    recoilUp: 0.42, recoilSide: 0.45, recoilFirst: 1.2,
    penetration: 0.34, extraBreak: 0, falloff: [12, 26, 0.58], range: 90, sound: 'smg', model: 'smg2',
  },
  // ---------------- ametralladora ligera
  lmg: {
    id: 'lmg', name: 'L-60 Muralla', kind: 'Ametralladora ligera', cls: 'lmg', auto: true, rpm: 700, damage: 44, pellets: 1,
    mag: 80, reserve: 160, reload: 4.6, reloadEmpty: 5.2, equip: 0.8, adsTime: 0.45, adsZoom: 1.35,
    spreadHip: 3.4, spreadAds: 0.14, spreadMove: 2.6, bloom: 0.35,
    recoilUp: 0.55, recoilSide: 0.42, recoilFirst: 1.4,
    penetration: 0.72, extraBreak: 0.15, falloff: [30, 55, 0.75], range: 140, sound: 'rifle', model: 'lmg',
  },
  // ---------------- tirador designado
  dmr: {
    id: 'dmr', name: 'S-3 Halcón', kind: 'Fusil de tirador', cls: 'dmr', auto: false, rpm: 380, damage: 68, pellets: 1,
    mag: 12, reserve: 60, reload: 2.9, reloadEmpty: 3.5, equip: 0.6, adsTime: 0.36, adsZoom: 2.2,
    spreadHip: 3.0, spreadAds: 0.04, spreadMove: 2.4, bloom: 0.6,
    recoilUp: 2.2, recoilSide: 0.3, recoilFirst: 1.0,
    penetration: 0.85, extraBreak: 0.1, falloff: [45, 80, 0.8], range: 180, sound: 'rifle', model: 'dmr',
  },
  // ---------------- escopetas
  shotgun: {
    id: 'shotgun', name: 'E-12', kind: 'Escopeta de corredera', cls: 'shotgun', auto: false, rpm: 80, damage: 24, pellets: 8,
    mag: 7, reserve: 35, reload: 3.4, reloadEmpty: 3.4, equip: 0.6, adsTime: 0.3, adsZoom: 1.1,
    spreadHip: 5.5, spreadAds: 4.2, spreadMove: 1.0, bloom: 0,
    recoilUp: 3.2, recoilSide: 0.8, recoilFirst: 1.0,
    penetration: 0.28, extraBreak: 0.7, falloff: [6, 14, 0.35], range: 60, sound: 'shotgun', model: 'shotgun',
  },
  shotgun2: {
    id: 'shotgun2', name: 'SA-8 Trueno', kind: 'Escopeta semiautomática', cls: 'shotgun', auto: false, rpm: 260, damage: 19, pellets: 8,
    mag: 8, reserve: 40, reload: 3.8, reloadEmpty: 3.8, equip: 0.6, adsTime: 0.3, adsZoom: 1.1,
    spreadHip: 5.2, spreadAds: 4.0, spreadMove: 1.0, bloom: 0.8,
    recoilUp: 2.6, recoilSide: 0.9, recoilFirst: 1.0,
    penetration: 0.26, extraBreak: 0.6, falloff: [5, 12, 0.35], range: 55, sound: 'shotgun', model: 'shotgun2',
  },
  // ---------------- secundarias
  pistol: {
    id: 'pistol', name: 'P-9', kind: 'Pistola', cls: 'pistol', auto: false, rpm: 400, damage: 43, pellets: 1,
    mag: 15, reserve: 60, reload: 2.0, reloadEmpty: 2.4, equip: 0.35, adsTime: 0.2, adsZoom: 1.15,
    spreadHip: 1.8, spreadAds: 0.25, spreadMove: 1.0, bloom: 0.5,
    recoilUp: 1.4, recoilSide: 0.4, recoilFirst: 1.0,
    penetration: 0.3, extraBreak: 0, falloff: [12, 25, 0.6], range: 80, sound: 'pistol', model: 'pistol',
  },
  revolver: {
    id: 'revolver', name: 'R-44 Magnum', kind: 'Revólver', cls: 'pistol', auto: false, rpm: 150, damage: 72, pellets: 1,
    mag: 6, reserve: 30, reload: 2.8, reloadEmpty: 2.8, equip: 0.45, adsTime: 0.24, adsZoom: 1.2,
    spreadHip: 2.2, spreadAds: 0.15, spreadMove: 1.2, bloom: 0.9,
    recoilUp: 3.6, recoilSide: 0.5, recoilFirst: 1.0,
    penetration: 0.55, extraBreak: 0.1, falloff: [15, 30, 0.65], range: 90, sound: 'pistol', model: 'revolver',
  },
  mpistol: {
    id: 'mpistol', name: 'MP-5K Enjambre', kind: 'Pistola automática', cls: 'pistol', auto: true, rpm: 1050, damage: 24, pellets: 1,
    mag: 20, reserve: 100, reload: 2.1, reloadEmpty: 2.5, equip: 0.35, adsTime: 0.2, adsZoom: 1.1,
    spreadHip: 2.6, spreadAds: 0.4, spreadMove: 1.2, bloom: 0.2,
    recoilUp: 0.62, recoilSide: 0.6, recoilFirst: 1.1,
    penetration: 0.26, extraBreak: 0, falloff: [8, 20, 0.55], range: 70, sound: 'smg', model: 'mpistol',
  },
};

// Multiplicador de daño por distancia.
export function falloffAt(def, dist) {
  const [a, b, min] = def.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 + (min - 1) * ((dist - a) / (b - a));
}

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
    if (this.reloadT > 0 || this.reserve <= 0) return false;
    const cap = this.def.pellets === 1 ? this.def.mag + 1 : this.def.mag;
    if (this.ammo >= cap || (this.ammo >= this.def.mag && this.def.pellets > 1)) return false;
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
  refill() { this.ammo = this.def.mag; this.reserve = this.def.reserve; this.reloadT = 0; this.cooldown = 0; this.bloom = 0; }
}

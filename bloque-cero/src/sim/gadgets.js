// Gadgets secundarios lanzables (sección 13 del documento): granada de fragmentación,
// humo y cegadora (ataque) y granada de impacto (defensa). Se lanzan con G desde los
// ojos, vuelan con gravedad y rebotan en los vóxeles hasta pararse.
//   · Fragmentación: mecha de 3 s desde el lanzamiento; letal a 1,5 m y daño hasta 3 m;
//     rompe material blando cerca. Las paredes duras protegen; las blandas atenúan.
//   · Humo: se abre al pararse (o a los 1,5 s): nube de 4 m de radio durante 10 s que
//     tapa la vista (también a los bots).
//   · Cegadora: mecha de 1,5 s; ciega hasta 3,5 s a quien la ve (menos si mira a otro lado).
//   · Impacto: explota al tocar algo; abre 1 m de pared blanda y hiere a menos de 2 m.
// Explosivos colocados:
//   · Carga de brecha (ataque): G mirando una pared blanda, una barricada o una trampilla a
//     menos de 1,6 m; se coloca en 1,5 s y G otra vez la detona: abre un hueco de 1 × 2 m
//     (la barricada o la trampilla entera); letal a 1 m y daño hasta 2,5 m.
//   · C4 remoto (defensa): se lanza y se pega donde toca; G lo detona: letal a 2,5 m, daño
//     hasta 4 m, atraviesa paredes blandas y suelos.
//   · Claymore (ataque): se deja en el suelo mirando al frente (1 s); salta cuando un
//     enemigo entra en su cono de 2 m: letal en el cono.
//   Todos se destruyen de un disparo del bando contrario.
// Gadgets defensivos (se colocan con G en 1 s):
//   · Alambre de púas: rollo de 2 m en el suelo; quien lo cruza va a la mitad de velocidad
//     y hace ruido; 3 golpes cuerpo a cuerpo o un explosivo lo rompen (las balas no).
//   · Escudo desplegable: cobertura antibalas a la cintura (vóxeles); solo lo rompen los
//     explosivos.
//   · Cámara blindada: en la pared, se suma a las cámaras; las balas no le hacen nada:
//     solo explosivos, cuerpo a cuerpo o PEM.
//   · Alarma de proximidad: suena y marca 3 s al atacante que pasa a menos de 2 m.
// Objetos de las habilidades de ataque (tecla X; ver abilities.js):
//   · Carga térmica (TERMO): se coloca en 2 s en un muro blando o reforzado o en una
//     trampilla; X la enciende: arde 5 s y abre un hueco de 1,9 m de alto × 1,1 de ancho
//     a ras de suelo, también en los refuerzos.
//   · Proyectil de brecha (ROMPE): vuela recto hasta 40 m, se pega y a los 1,5 s abre
//     1,5 m de pared blanda (o quita la barricada o la trampilla sin reforzar).
//   · Humo remoto (NUBE): vuela recto hasta 40 m y abre una nube de humo donde choca.
//   · Granada PEM (CHISPA): a los 2 s deja 15 s sin funcionar la electrónica enemiga a
//     menos de 5 m, aunque haya paredes (cámaras, cámaras blindadas, alarmas...).
// Las explosiones destruyen además los gadgets, drones y cámaras del otro bando que alcanzan.
// Simulación pura (corre en Node); el cliente pinta los objetos y los efectos.
import { SOLID, HARD, MAT, BLAST_RES, GLASS } from '../world/materials.js';
import { lineOfSight, traverse, raycastFirst } from '../world/raycast.js';
import { explodeSphere, breachRect } from '../world/destruction.js';
import { SecurityCam, rayAABB } from './recon.js';
import { MELEE_DAMAGE } from './game.js';
import { rayHitRig } from './skeleton.js';

export const THROW = { speed: 12, up: 2.0, gravity: 9.8, bounce: 0.35, radius: 0.05, cooldown: 1.0 };
export const FRAG = { fuse: 3, lethal: 1.5, radius: 3, damage: 160, hole: 0.5 };
export const IMPACT = { lethal: 0.6, radius: 2, damage: 70, hole: 0.55 };
export const SMOKE = { radius: 4, time: 10, grow: 1.5, openAfter: 1.5 };
export const FLASH = { fuse: 1.5, range: 12, max: 3.5, min: 0.8 };
export const BREACH = { place: 1.5, reach: 1.6, lethal: 1.0, radius: 2.5, damage: 160, w: 1.0, h: 2.0 };
export const C4 = { lethal: 2.5, radius: 4, damage: 180, hole: 0.7, soft: 0.9 };
export const CLAYMORE = { place: 1.0, range: 2, cone: 0.866, lethal: 2, radius: 3, damage: 160 };
export const WIRE = { place: 1.0, w: 2.0, d: 0.9, slow: 0.5, hits: 3 };
export const DSHIELD = { place: 1.0, w: 1.25, h: 1.0 };
export const BPCAM = { place: 1.0, reach: 2.0 };
export const ALARM = { place: 1.0, reach: 2.0, radius: 2, mark: 3, cooldown: 3 };
// habilidades (tecla X)
export const THERMAL = { place: 2.0, reach: 1.6, floorReach: 2.3, fuse: 5, w: 1.1, h: 1.9, lethal: 0.6, radius: 1.8, damage: 110 };
export const BREACHROUND = { speed: 40, range: 40, fuse: 1.5, hole: 0.75, lethal: 0.5, radius: 2.0, damage: 90 };
export const SMOKEROUND = { speed: 35, range: 40 };
export const EMP = { fuse: 2, radius: 5, off: 15 };
export const ABILITY_CD = 1.0;
const THROWABLE = { frag: true, smoke: true, flash: true, impact: true, c4: true, emp: true };
const PLACEABLE = { breach: BREACH, claymore: CLAYMORE, barbed: WIRE, shield: DSHIELD, bpcam: BPCAM, alarm: ALARM, thermal: THERMAL };
export const PLACE_LABEL = { breach: 'la carga de brecha', claymore: 'la claymore', barbed: 'el alambre', shield: 'el escudo desplegable', bpcam: 'la cámara blindada', alarm: 'la alarma', thermal: 'la carga térmica' };
// Electrónica que la PEM apaga (las cámaras de seguridad también; en la Fase 6.5, más)
const ELECTRONIC = { alarm: true };
// Qué ranura gasta cada uso: el gadget secundario (G) o la habilidad (X)
const slotOf = (op, src) => (src === 'ability' ? op.ability : op.gadget);
const hasCharge = (slot) => !!slot && slot.left !== 0;          // (-1 = sin límite)
const spend = (op, src) => {
  const slot = slotOf(op, src);
  if (slot.left > 0) slot.left--;
  if (src === 'ability') op.abilityCd = ABILITY_CD;
};

export class Gadgets {
  constructor(game) {
    this.game = game;
    this.items = [];        // proyectiles en vuelo o en el suelo (y el C4 pegado)
    this.smokes = [];       // nubes de humo activas {x, y, z, r, t0, until, team}
    this.placed = [];       // cargas de brecha, claymores, alambres y alarmas colocadas
    this.recon = null;      // (la partida lo conecta: las cámaras blindadas se suman a las suyas)
    this.work = new Map();  // operador → colocación en curso {kind, t, total, spot, from}
    this._nextId = 1;
    game.gadgets = this;
  }
  reset() {
    this.items = []; this.smokes = []; this.placed = []; this.work.clear();
    // (las cámaras blindadas de la ronda anterior desaparecen)
    if (this.recon) this.recon.cams = this.recon.cams.filter((c) => !c.fromGadget);
    this.game.targets = this.game.targets.filter((t) => t.kind !== 'gadget' && !t.fromGadget);
    for (const op of this.game.operators) op.slowMul = 1;
  }

  /** ¿Puede `op` usar ahora su gadget secundario (o su habilidad, con src = 'ability')? */
  canUse(op, src = 'gadget') {
    const cd = src === 'ability' ? op.abilityCd : op.gadgetCd;
    return hasCharge(slotOf(op, src)) && op.state === 'alive' && !op.frozen && !op.channel && (cd || 0) <= 0;
  }

  /**
   * G: detona lo que tenga pendiente (brecha colocada, C4 pegado); si no, lanza (granadas,
   * C4) o empieza a colocar (brecha, claymore). Devuelve lo que ha hecho o null.
   */
  use(op) {
    if (!op.gadget || op.state !== 'alive' || op.frozen) return null;
    const mine = this._detonable(op);
    if (mine) { this.detonate(mine); return 'detonate'; }
    if (PLACEABLE[op.gadget.id]) return this.startPlace(op) ? 'place' : null;
    return this.throwFrom(op) ? 'throw' : null;
  }
  _detonable(op) {
    for (const it of this.items) if (it.alive && it.owner === op && it.kind === 'c4' && it.stuck) return it;
    for (const it of this.placed) if (it.alive && it.owner === op && it.kind === 'breach') return it;
    return null;
  }

  /** Lanza el gadget de `op` (o su granada PEM, con src = 'ability'). Devuelve el proyectil o null. */
  throwFrom(op, src = 'gadget') {
    const kind = src === 'ability' ? op.ability && op.ability.id : op.gadget && op.gadget.id;
    if (!this.canUse(op, src) || !THROWABLE[kind]) return null;
    const e = op.eyePos(), d = op.viewDir(), v = op.body.vel;
    const it = {
      id: `g${this._nextId++}`, kind, owner: op, team: op.team,
      pos: { x: e.x + d.x * 0.35, y: e.y + d.y * 0.35 - 0.05, z: e.z + d.z * 0.35 },
      vel: { x: d.x * THROW.speed + v.x * 0.6, y: d.y * THROW.speed + THROW.up + Math.max(0, v.y) * 0.4, z: d.z * THROW.speed + v.z * 0.6 },
      t: 0, rest: false, alive: true, bounces: 0,
    };
    // si nada más salir choca (pegado a una pared), se suelta a los pies
    if (SOLID[this.game.world.getWorld(it.pos.x, it.pos.y, it.pos.z)]) { it.pos = { x: e.x, y: e.y - 0.2, z: e.z }; }
    if (src === 'ability') spend(op, src);
    else { op.gadget.left--; op.gadgetCd = THROW.cooldown; }
    this.items.push(it);
    this.game.emit('gadgetThrown', op, it);
    return it;
  }

  tick(dt) {
    const g = this.game;
    for (const op of g.operators) {
      if (op.gadgetCd > 0) op.gadgetCd -= dt;
      if (op.blindT > 0) op.blindT = Math.max(0, op.blindT - dt);
      const I = op.intent;
      if (I.gadget) { I.gadget = false; if (!this.use(op) && op.gadget && op.gadget.left <= 0 && op.state === 'alive') g.emit('gadgetEmpty', op); }
    }
    this._workTick(dt);
    for (const op of g.operators) op.slowMul = 1;
    for (const c of this.placed) {
      if (!c.alive) continue;
      if (c.kind === 'claymore') this._claymoreTick(c);
      else if (c.kind === 'barbed') this._wireTick(c, dt);
      else if (c.kind === 'alarm') this._alarmTick(c, dt);
      else if (c.kind === 'thermal' && c.burning) this._thermalTick(c, dt);
    }
    this.placed = this.placed.filter((c) => c.alive);
    for (const it of this.items) {
      if (!it.alive) continue;
      it.t += dt;
      if (!it.rest) { if (it.straight) this._flyStraight(it, dt); else this._move(it, dt); }
      if (!it.alive) continue;
      if (it.kind === 'frag' && it.t >= FRAG.fuse) this._explode(it, FRAG);
      else if (it.kind === 'flash' && it.t >= FLASH.fuse) this._flash(it);
      else if (it.kind === 'smoke' && (it.rest || it.t >= SMOKE.openAfter)) this._smoke(it);
      else if (it.kind === 'emp' && it.t >= EMP.fuse) this._emp(it);
      else if (it.kind === 'breachround' && it.armedAt !== undefined && it.t - it.armedAt >= BREACHROUND.fuse) this._breachRoundBlast(it);
    }
    this.items = this.items.filter((it) => it.alive);
    this.smokes = this.smokes.filter((s) => s.until > g.time);
  }

  // Vuelo con rebotes: se prueba cada eje por separado para saber con qué cara choca.
  _move(it, dt) {
    const w = this.game.world, p = it.pos, v = it.vel;
    v.y -= THROW.gravity * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(v.x, v.y, v.z) * dt / 0.1));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      let hit = false;
      for (const ax of ['x', 'y', 'z']) {
        const np = { x: p.x, y: p.y, z: p.z };
        np[ax] += v[ax] * h;
        if (SOLID[w.getWorld(np.x, np.y, np.z)] || this._hitsOperator(it, np)) {
          hit = true;
          if (it.kind === 'impact') { this._explode(it, IMPACT); return; }
          if (it.kind === 'c4') { this._stick(it, ax, v[ax]); return; }
          v[ax] = -v[ax] * THROW.bounce;
          // rozamiento al tocar el suelo o una pared
          const f = ax === 'y' ? 0.7 : 0.85;
          for (const o of ['x', 'y', 'z']) if (o !== ax) v[o] *= f;
        } else p[ax] = np[ax];
      }
      if (hit) {
        it.bounces++;
        if (it.bounces === 1) this.game.emit('gadgetBounce', it);
      }
    }
    // en reposo: apoyado y casi sin velocidad
    const below = SOLID[w.getWorld(p.x, p.y - 0.08, p.z)];
    if (below && Math.hypot(v.x, v.y, v.z) < 0.6) { it.rest = true; v.x = v.y = v.z = 0; }
    if (p.y < -30) it.alive = false;
  }
  _hitsOperator(it, np) {
    if (it.t < 0.12) return false;          // recién lanzada: no choca con quien la lanza
    for (const op of this.game.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const b = op.body.pos;
      if (Math.hypot(np.x - b.x, np.z - b.z) < 0.28 && np.y > b.y && np.y < b.y + op.body.height) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- proyectiles de las habilidades
  /**
   * Dispara un proyectil de la habilidad de `op` en línea recta ('breachround' o 'smokeround').
   * Devuelve el proyectil o null.
   */
  fireRound(op, kind) {
    if (!this.canUse(op, 'ability')) return null;
    const spec = kind === 'breachround' ? BREACHROUND : SMOKEROUND;
    const e = op.eyePos(), d = op.viewDir();
    const it = {
      id: `g${this._nextId++}`, kind, owner: op, team: op.team, straight: true, range: spec.range, flown: 0,
      pos: { x: e.x + d.x * 0.3, y: e.y + d.y * 0.3 - 0.04, z: e.z + d.z * 0.3 },
      vel: { x: d.x * spec.speed, y: d.y * spec.speed, z: d.z * spec.speed },
      t: 0, rest: false, alive: true, bounces: 0,
    };
    // pegado a una pared: sale desde los ojos
    if (SOLID[this.game.world.getWorld(it.pos.x, it.pos.y, it.pos.z)]) it.pos = { x: e.x, y: e.y, z: e.z };
    spend(op, 'ability');
    this.items.push(it);
    this.game.emit('abilityFired', op, it);
    return it;
  }
  // Vuelo recto (sin gravedad) con el primer choque contra vóxeles u operadores.
  _flyStraight(it, dt) {
    const w = this.game.world, p = it.pos, v = it.vel;
    const sp = Math.hypot(v.x, v.y, v.z) || 1;
    const d = { x: v.x / sp, y: v.y / sp, z: v.z / sp };
    const len = Math.min(sp * dt, it.range - it.flown);
    const hit = raycastFirst(w, p.x, p.y, p.z, d.x, d.y, d.z, len, SOLID, false);
    const oh = this._rayOperators(it, p, d, hit ? hit.t : len);
    const adv = (t) => { p.x += d.x * t; p.y += d.y * t; p.z += d.z * t; it.flown += t; };
    if (oh) { adv(Math.max(0, oh.t - 0.08)); this._roundHit(it, null, oh.op, d); return; }
    if (hit) { adv(Math.max(0, hit.t - 0.03)); this._roundHit(it, hit, null, d); return; }
    adv(len);
    if (it.flown >= it.range - 1e-6) this._roundHit(it, null, null, d);      // al final del alcance
  }
  _rayOperators(it, o, d, maxT) {
    let best = null;
    for (const op of this.game.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      if (op === it.owner && it.t < 0.2) continue;          // recién disparado: no choca con quien dispara
      const b = op.body.pos;
      const cx = b.x - o.x, cy = b.y + 0.9 - o.y, cz = b.z - o.z;
      const along = cx * d.x + cy * d.y + cz * d.z;
      if (along < -1.2 || along > maxT + 1.2) continue;
      if (cx * cx + cy * cy + cz * cz - along * along > 1.6 * 1.6) continue;
      const r = rayHitRig(op.rig, o, d, maxT);
      if (r && (!best || r.t < best.t)) best = { t: r.t, op };
    }
    return best;
  }
  // El proyectil choca: el humo se abre; el de brecha se pega (o cae si da a alguien) y
  // arma su mecha; al final del alcance, sin choque, el de brecha revienta en el aire.
  _roundHit(it, hit, op, d) {
    const g = this.game;
    if (it.kind === 'smokeround') { this._smoke(it); return; }
    it.armedAt = it.t;
    if (hit) {
      it.straight = false; it.stuck = true; it.rest = true;
      it.vel.x = it.vel.y = it.vel.z = 0;
      // (si sale desde dentro de un vóxel no hay cara: se usa el eje dominante del vuelo)
      const axis = hit.face >= 0 ? hit.face >> 1 : [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)].indexOf(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)));
      it.normal = { x: 0, y: 0, z: 0 };
      it.normal[['x', 'y', 'z'][axis]] = hit.face & 1 ? 1 : -1;
      if (it.normal.x * d.x + it.normal.y * d.y + it.normal.z * d.z > 0) { it.normal.x = -it.normal.x; it.normal.y = -it.normal.y; it.normal.z = -it.normal.z; }
      it.voxel = { x: hit.x, y: hit.y, z: hit.z, mat: hit.mat };
      g.emit('gadgetStuck', it);
      return;
    }
    if (op) {
      // rebota en el cuerpo y cae
      it.straight = false;
      it.vel = { x: -d.x * 2, y: 1, z: -d.z * 2 };
      g.emit('gadgetBounce', it);
      return;
    }
    this._breachRoundBlast(it);
  }
  _breachRoundBlast(it) {
    const g = this.game, p = it.pos, w = g.world;
    it.alive = false;
    let destroyed = [];
    const v = it.voxel;
    if (v && (v.mat === MAT.BARRICADE || v.mat === MAT.HATCH) && w.get(v.x, v.y, v.z) === v.mat) destroyed = this._clearConnected(v, v.mat);
    else destroyed = explodeSphere(w, p.x, p.y, p.z, BREACHROUND.hole, { jag: 0.2 });
    if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...p }, null);
    this._blastDamage(p, BREACHROUND, it.owner, 'breachround');
    g.emit('explosion', 'breachround', { ...p }, BREACHROUND, it.owner);
  }

  // ---------------------------------------------------------------- PEM
  /** ¿Está apagado por una PEM? (cámaras, alarmas y, más adelante, el resto de la electrónica) */
  isOff(dev, now = this.game.time) { return (dev.offUntil || 0) > now; }
  _emp(it) {
    const g = this.game, p = it.pos, now = g.time;
    it.alive = false;
    const hits = [];
    const near = (q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= EMP.radius;
    // atraviesa paredes: basta con la distancia
    if (this.recon) for (const c of this.recon.cams) if (c.alive && c.team !== it.team && near(c.pos)) { c.offUntil = now + EMP.off; hits.push(c); }
    for (const c of this.placed) if (c.alive && ELECTRONIC[c.kind] && c.team !== it.team && near(c.pos)) { c.offUntil = now + EMP.off; hits.push(c); }
    g.emit('emp', { ...p }, hits, it.owner);
  }

  // Explosión: daño por distancia (muerte directa dentro del radio letal), paredes que
  // protegen y hueco en el material blando.
  _explode(it, spec) {
    const g = this.game, p = it.pos;
    it.alive = false;
    if (it.target) this._untarget(it);
    if (spec.hole) {
      const destroyed = explodeSphere(g.world, p.x, p.y, p.z, spec.hole);
      if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...p }, null);
    }
    this._blastDamage(p, spec, it.owner, it.kind);
    g.emit('explosion', it.kind, { ...p }, spec, it.owner);
  }
  _blastDamage(p, spec, owner, kind, filter = null) {
    const g = this.game;
    // gadgets, drones y cámaras del otro bando (y el desactivador plantado, si es de la defensa)
    for (const tg of [...g.targets]) {
      if (!tg.alive || !tg.center || (owner && tg.team === owner.team)) continue;
      const c = tg.center();
      const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (d > spec.radius) continue;
      const cover = this._blastCover(p, c, spec.soft || 0.8);
      if (cover <= 0) continue;
      const k = d <= spec.lethal ? 1 : 1 - (d - spec.lethal) / (spec.radius - spec.lethal);
      g.hitTarget(tg, Math.max(1, spec.damage * k * cover), owner, c);
    }
    const names = { frag: 'Fragmentación', impact: 'Impacto', breach: 'Carga de brecha', c4: 'C4', claymore: 'Claymore', thermal: 'Carga térmica', breachround: 'Proyectil de brecha' };
    for (const op of g.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const c = op.center ? op.center() : { x: op.body.pos.x, y: op.body.pos.y + 0.9, z: op.body.pos.z };
      const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (d > spec.radius) continue;
      const cover = this._blastCover(p, c, spec.soft || 0.8);
      if (cover <= 0) continue;
      const cone = filter ? filter(op, c) : 1;
      if (cone <= 0) continue;
      const lethal = d <= spec.lethal && cone >= 1;
      const k = d <= spec.lethal ? 1 : 1 - (d - spec.lethal) / (spec.radius - spec.lethal);
      const dmg = spec.damage * k * cover * cone;
      if (dmg < 1) continue;
      g.damage(op, dmg, { by: owner, weapon: { name: names[kind] || 'Explosivo', explosive: true }, zone: 'body', point: { ...p }, noDown: lethal && cover > 0.9, explosive: true });
    }
  }
  // Fracción de la onda que llega de a a b: 0 si hay algo duro en medio; cada vóxel blando la reduce.
  _blastCover(a, b, soft = 0.8) {
    const w = this.game.world;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return 1;
    let k = 1;
    traverse(w, a.x, a.y, a.z, dx / len, dy / len, dz / len, len, (x, y, z, t, face, mat) => {
      if (mat === MAT.AIR || !SOLID[mat]) return false;
      if (HARD[mat]) { k = 0; return true; }
      k *= soft;
      return k < 0.05;
    });
    return k;
  }

  _flash(it) {
    const g = this.game, p = it.pos;
    it.alive = false;
    const hitList = [];
    for (const op of g.operators) {
      if (op.state !== 'alive' || op.frozen) continue;
      const e = op.eyePos();
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, d = Math.hypot(dx, dy, dz);
      if (d > FLASH.range) continue;
      if (!lineOfSight(g.world, p.x, p.y + 0.05, p.z, e.x, e.y, e.z)) continue;
      const v = op.viewDir();
      const facing = (dx * v.x + dy * v.y + dz * v.z) / Math.max(0.01, d);    // 1 = mirando hacia ella
      // de frente, entera; de lado, algo más de la mitad; de espaldas, un poco (continuo)
      const look = facing > 0.5 ? 1 : facing > -0.3 ? 0.35 + (facing + 0.3) * 0.8125 : 0.3;
      const near = d < 5 ? 1 : 1 - (d - 5) / (FLASH.range - 5) * 0.6;
      const t = Math.max(FLASH.min, FLASH.max * look * near);
      op.blindT = Math.max(op.blindT || 0, t);
      op.blindMax = Math.max(op.blindT, op.blindMax || 0);
      hitList.push(op);
    }
    g.emit('flashbang', { ...p }, hitList, it.owner);
  }

  _smoke(it) {
    const g = this.game, p = it.pos;
    it.alive = false;
    const s = { x: p.x, y: p.y + 0.4, z: p.z, r: SMOKE.radius, t0: g.time, until: g.time + SMOKE.time, team: it.team };
    this.smokes.push(s);
    g.emit('smoke', s, it.owner);
  }

  /** Radio actual de una nube (crece al abrirse y se deshace al final). */
  smokeRadius(s, now = this.game.time) {
    const age = now - s.t0, left = s.until - now;
    if (left <= 0) return 0;
    return s.r * Math.min(1, age / SMOKE.grow, left / 1.5 + 0.2);
  }
  /** ¿El humo tapa la vista entre a y b? (más de 1,2 m de recorrido dentro de una nube) */
  smokeBlocks(a, b) {
    if (!this.smokes.length) return false;
    const now = this.game.time;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return false;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, now);
      if (r <= 0.3) continue;
      const cx = s.x - a.x, cy = s.y - a.y, cz = s.z - a.z;
      const t = cx * ux + cy * uy + cz * uz;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 >= r * r) continue;
      const half = Math.sqrt(r * r - d2);
      const t0 = Math.max(0, t - half), t1 = Math.min(L, t + half);
      if (t1 - t0 > 1.2) return true;
    }
    return false;
  }
  // ---------------------------------------------------------------- C4 pegado
  _stick(it, ax, vAx) {
    it.stuck = true; it.rest = true;
    it.vel.x = it.vel.y = it.vel.z = 0;
    it.normal = { x: 0, y: 0, z: 0 }; it.normal[ax] = vAx > 0 ? -1 : 1;
    this._target(it, 0.07);
    this.game.emit('gadgetStuck', it);
  }

  // ---------------------------------------------------------------- colocar (brecha, claymore)
  /** Dónde colocaría `op` su gadget (o el objeto `id` de su habilidad) ahora (o null, con el motivo en `why`). */
  placeSpot(op, id = op.gadget && op.gadget.id) {
    const w = this.game.world;
    const e = op.eyePos(), d = op.viewDir();
    if (id === 'thermal') {
      // muro blando o reforzado, o trampilla (reforzada o no)
      // (una trampilla del suelo se alcanza de pie, mirando hacia abajo)
      const hit = raycastFirst(w, e.x, e.y, e.z, d.x, d.y, d.z, THERMAL.floorReach, SOLID, true);
      if (!hit || (hit.face >> 1 !== 1 && hit.t > THERMAL.reach)) return { why: 'Acércate a un muro' };
      const m = hit.mat, axis = hit.face >> 1;
      const wall = axis !== 1 && (m === MAT.REINFORCED || (BLAST_RES[m] === 0 && !HARD[m] && !GLASS[m] && m !== MAT.BARRICADE && m !== MAT.HATCH));
      const hatch = axis === 1 && (m === MAT.HATCH || m === MAT.REINFORCED);
      if (!wall && !hatch) return { why: 'Aquí no se puede poner' };
      const n = { x: 0, y: 0, z: 0 };
      n[['x', 'y', 'z'][axis]] = hit.face & 1 ? 1 : -1;
      if (n.x * d.x + n.y * d.y + n.z * d.z > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
      const t = hit.t - 0.02;
      return { ok: true, kind: 'thermal', pos: { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t }, normal: n, axis, mat: m, voxel: { x: hit.x, y: hit.y, z: hit.z } };
    }
    if (id === 'breach') {
      const hit = raycastFirst(w, e.x, e.y, e.z, d.x, d.y, d.z, BREACH.reach, SOLID, true);
      if (!hit) return { why: 'Acércate a una pared' };
      const m = hit.mat;
      const axis = hit.face >> 1;
      const ok = m === MAT.BARRICADE || m === MAT.HATCH || (BLAST_RES[m] === 0 && !HARD[m] && !GLASS[m] && axis !== 1);
      if (!ok) return { why: m === MAT.REINFORCED ? 'Muro reforzado: la carga no lo abre' : 'Aquí no se puede poner' };
      const n = { x: 0, y: 0, z: 0 };
      n[['x', 'y', 'z'][axis]] = hit.face & 1 ? 1 : -1;
      // la cara golpeada mira hacia el que pone la carga
      if (n.x * d.x + n.y * d.y + n.z * d.z > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
      const t = hit.t - 0.02;
      return { ok: true, kind: 'breach', pos: { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t }, normal: n, axis, mat: m, voxel: { x: hit.x, y: hit.y, z: hit.z } };
    }
    if (id === 'claymore') {
      const p = op.body.pos, fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
      const x = p.x + fx * 0.5, z = p.z + fz * 0.5;
      if (SOLID[w.getWorld(x, p.y + 0.1, z)] || !SOLID[w.getWorld(x, p.y - 0.06, z)]) return { why: 'Necesitas suelo despejado delante' };
      return { ok: true, kind: 'claymore', pos: { x, y: p.y + 0.01, z }, yaw: op.yaw };
    }
    if (id === 'barbed') {
      // un rollo de 2 m atravesado, 1,1 m por delante; suelo en todo el ancho
      const p = op.body.pos, fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw), rx = -fz, rz = fx;
      const cx = p.x + fx * 1.1, cz = p.z + fz * 1.1;
      for (const k of [-0.9, 0, 0.9]) {
        const x = cx + rx * k, z = cz + rz * k;
        if (SOLID[w.getWorld(x, p.y + 0.3, z)] || !SOLID[w.getWorld(x, p.y - 0.06, z)]) return { why: 'Necesitas suelo despejado delante' };
      }
      return { ok: true, kind: 'barbed', pos: { x: cx, y: p.y + 0.01, z: cz }, yaw: op.yaw };
    }
    if (id === 'shield') {
      const cells = this._shieldCells(op);
      if (!cells) return { why: 'No cabe ahí' };
      const p = op.body.pos, fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
      return { ok: true, kind: 'shield', cells, pos: { x: p.x + fx * 0.9, y: p.y, z: p.z + fz * 0.9 }, yaw: op.yaw };
    }
    if (id === 'bpcam' || id === 'alarm') {
      const hit = raycastFirst(w, e.x, e.y, e.z, d.x, d.y, d.z, BPCAM.reach, SOLID, true);
      if (!hit) return { why: 'Acércate a una pared' };
      const axis = hit.face >> 1;
      if (id === 'bpcam' && axis === 1) return { why: 'La cámara va en una pared' };
      const n = { x: 0, y: 0, z: 0 };
      n[['x', 'y', 'z'][axis]] = hit.face & 1 ? 1 : -1;
      if (n.x * d.x + n.y * d.y + n.z * d.z > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
      const t = hit.t - 0.03;
      const pos = { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t };
      return { ok: true, kind: id, pos, normal: n, yaw: Math.atan2(-n.x, -n.z) + Math.PI, axis };
    }
    return null;
  }
  startPlace(op, src = 'gadget') {
    if (!this.canUse(op, src) || this.work.has(op)) return false;
    const spot = this.placeSpot(op, slotOf(op, src).id);
    if (!spot || !spot.ok) { this.game.emit('gadgetDenied', op, spot ? spot.why : ''); return false; }
    const spec = PLACEABLE[spot.kind];
    const p = op.body.pos;
    this.work.set(op, { kind: spot.kind, t: 0, total: spec.place, spot, src, from: { x: p.x, y: p.y, z: p.z } });
    op.channel = { kind: 'gadget', t: 0, total: spec.place, what: spot.kind };
    this.game.emit('gadgetPlaceStart', op, spot);
    return true;
  }
  _workTick(dt) {
    for (const [op, wk] of this.work) {
      // (mientras se coloca no se anda: intentar moverse o disparar lo cancela)
      const I = op.intent, p = op.body.pos;
      const wantsMove = Math.abs(I.moveX || 0) + Math.abs(I.moveZ || 0) > 0.5;
      const moved = Math.hypot(p.x - wk.from.x, p.z - wk.from.z) > 0.45;
      if (op.state !== 'alive' || wantsMove || moved || I.fire || !hasCharge(slotOf(op, wk.src))) { this._cancelWork(op); continue; }
      wk.t += dt;
      if (op.channel && op.channel.kind === 'gadget') op.channel.t = wk.t;
      if (wk.t < wk.total) continue;
      this.work.delete(op);
      if (op.channel && op.channel.kind === 'gadget') op.channel = null;
      this._place(op, wk.spot, wk.src);
    }
  }
  _cancelWork(op) {
    this.work.delete(op);
    if (op.channel && op.channel.kind === 'gadget') op.channel = null;
    this.game.emit('gadgetPlaceCancel', op);
  }
  _place(op, spot, src = 'gadget') {
    if (src === 'ability') spend(op, src);
    else { op.gadget.left--; op.gadgetCd = 0.4; }
    const g = this.game;
    const c = { id: `g${this._nextId++}`, kind: spot.kind, owner: op, team: op.team, pos: { ...spot.pos }, normal: spot.normal || null, axis: spot.axis, mat: spot.mat, voxel: spot.voxel, yaw: spot.yaw || 0, alive: true, t0: g.time };
    if (spot.kind === 'shield') {
      // vóxeles antibalas (solo los rompen los explosivos)
      const w = g.world;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const [x, y, z] of spot.cells) {
        if (w.get(x, y, z) !== MAT.AIR) continue;
        w.setRaw(x, y, z, MAT.DEPLOY_SHIELD);
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
      if (x0 !== Infinity) w.notify(x0, y0, z0, x1, y1, z1);
      g.emit('gadgetPlaced', op, c);
      return c;
    }
    if (spot.kind === 'bpcam') {
      const cam = new SecurityCam({ id: c.id, name: 'Cámara blindada', x: spot.pos.x + spot.normal.x * 0.08, y: spot.pos.y, z: spot.pos.z + spot.normal.z * 0.08, yaw: spot.yaw, pitch: -0.12 });
      cam.team = op.team; cam.bulletproof = true; cam.fromGadget = true;
      if (this.recon) this.recon.cams.push(cam);
      g.targets.push(cam);
      g.emit('gadgetPlaced', op, c);
      return cam;
    }
    this.placed.push(c);
    // (la carga térmica abre desde el suelo de la planta de quien la pone)
    if (spot.kind === 'thermal') c.floorY = Math.floor((op.body.pos.y + 0.3) / 3.5) * 3.5;
    if (spot.kind === 'barbed') {
      this._target(c, 0.35);
      const tg = c.target;
      tg.ignoreBullets = true;                 // las balas lo atraviesan
      tg.hp = WIRE.hits * MELEE_DAMAGE - 1;     // 3 golpes
      // el rollo entero (caja orientada de 2 × 0,6 × 0,9 m), para los golpes
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      tg.center = () => ({ x: c.pos.x, y: c.pos.y + 0.3, z: c.pos.z });
      tg.rayTest = (o, d, maxT) => {
        const ox = o.x - c.pos.x, oz = o.z - c.pos.z;
        const lo = { x: ox * cy - oz * sy, y: o.y - c.pos.y, z: ox * sy + oz * cy };
        const ld = { x: d.x * cy - d.z * sy, y: d.y, z: d.x * sy + d.z * cy };
        return rayAABB(lo, ld, -WIRE.w / 2, 0, -WIRE.d / 2, WIRE.w / 2, 0.6, WIRE.d / 2, maxT);
      };
    } else this._target(c, spot.kind === 'claymore' ? 0.12 : spot.kind === 'alarm' ? 0.1 : 0.2);
    g.emit('gadgetPlaced', op, c);
    return c;
  }
  // Celdas (vóxeles) del escudo desplegable delante de `op`, o null si no cabe.
  _shieldCells(op) {
    const w = this.game.world, p = op.body.pos;
    const fx = -Math.sin(op.yaw), fz = -Math.cos(op.yaw);
    const alongX = Math.abs(fz) > Math.abs(fx);             // de cara a ±z: el escudo va a lo largo de x
    const cx = p.x + fx * 0.9, cz = p.z + fz * 0.9;
    const vy0 = w.vy(p.y + 0.01), n = Math.round(DSHIELD.w / 0.125), hN = Math.round(DSHIELD.h / 0.125);
    if (!SOLID[w.get(w.vx(cx), vy0 - 1, w.vz(cz))]) return null;
    // (si algún mueble ocupa un poco, el escudo se apoya en él: basta con 3/4 del hueco libre)
    const cells = [];
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.125;
      const x = w.vx(alongX ? cx + off : cx), z = w.vz(alongX ? cz : cz + off);
      for (let j = 0; j < hN; j++) if (w.get(x, vy0 + j, z) === MAT.AIR) cells.push([x, vy0 + j, z]);
    }
    if (cells.length < n * hN * 0.75) return null;
    // que no quede nadie dentro
    for (const o of this.game.operators) {
      if (o.state === 'dead') continue;
      const b = o.body.pos;
      if (Math.abs(b.x - cx) < (alongX ? DSHIELD.w / 2 + 0.3 : 0.4) && Math.abs(b.z - cz) < (alongX ? 0.4 : DSHIELD.w / 2 + 0.3) && Math.abs(b.y - p.y) < 1) return null;
    }
    return cells;
  }

  // Alambre: quien está dentro va a la mitad de velocidad y hace ruido al moverse.
  _wireTick(c, dt) {
    const g = this.game;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    for (const op of g.operators) {
      if (op.state === 'dead' || op.frozen) continue;
      const b = op.body.pos;
      const dx = b.x - c.pos.x, dz = b.z - c.pos.z;
      const along = dx * -fz + dz * fx, across = dx * fx + dz * fz;
      if (Math.abs(along) > WIRE.w / 2 + 0.2 || Math.abs(across) > WIRE.d / 2 + 0.2 || Math.abs(b.y - c.pos.y) > 0.8) continue;
      op.slowMul = WIRE.slow;
      op.wireT = (op.wireT || 0) - dt;
      if (op.moveSpeed > 0.3 && op.wireT <= 0) { op.wireT = 0.6; g.emit('wireRustle', op, c); }
    }
  }
  // Alarma: suena y marca al atacante que pasa cerca.
  _alarmTick(c, dt) {
    const g = this.game;
    c.cd = (c.cd || 0) - dt;
    if (c.cd > 0 || this.isOff(c)) return;
    for (const op of g.operators) {
      if (op.team === c.team || op.state !== 'alive' || op.frozen) continue;
      const b = op.body.pos;
      if (Math.hypot(b.x - c.pos.x, b.y + 0.9 - c.pos.y, b.z - c.pos.z) > ALARM.radius + 0.9) continue;
      c.cd = ALARM.cooldown;
      if (this.recon) this.recon.spotted.set(op, { until: g.time + ALARM.mark, team: c.team, by: c.owner });
      g.emit('alarm', c, op);
      return;
    }
  }

  // Los explosivos colocados se destruyen de un disparo del bando contrario.
  _target(it, r) {
    const g = this.game;
    const tg = {
      kind: 'gadget', gadget: it, team: it.team, alive: true,
      center: () => ({ x: it.pos.x, y: it.pos.y + (it.kind === 'claymore' ? 0.08 : 0), z: it.pos.z }),
      rayTest: (o, d, maxT) => {
        const c = tg.center();
        const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
        const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - cc;
        if (disc < 0) return -1;
        const t = -b - Math.sqrt(disc);
        return t < 0 || t > maxT ? -1 : t;
      },
    };
    it.target = tg;
    g.targets.push(tg);
    const off = g.on('targetDestroyed', (t) => { if (t === tg) { off(); it.alive = false; this.game.emit('gadgetDestroyed', it); } });
    it._off = off;
  }
  _untarget(it) {
    const g = this.game;
    if (it._off) it._off();
    g.targets = g.targets.filter((t) => t !== it.target);
    it.target = null;
  }

  /** Detona una carga de brecha colocada o un C4 pegado. */
  detonate(it) {
    if (!it.alive) return;
    if (!this.canDetonate(it)) { this.game.emit('gadgetJammed', it); return; }
    const g = this.game;
    if (it.kind === 'c4') { this._explode(it, C4); return; }
    // carga de brecha
    it.alive = false;
    this._untarget(it);
    let destroyed = [];
    const w = g.world;
    if (it.mat === MAT.BARRICADE || it.mat === MAT.HATCH) destroyed = this._clearConnected(it.voxel, it.mat);
    else {
      const n = it.normal, p = it.pos;
      const floorY = Math.floor((p.y + 0.3) / 3.5) * 3.5;
      const cx = it.axis === 0 ? p.x - n.x * 0.12 : p.x, cz = it.axis === 2 ? p.z - n.z * 0.12 : p.z;
      destroyed = breachRect(w, cx, Math.max(p.y, floorY + BREACH.h / 2 + 0.05), cz, it.axis, BREACH.w, BREACH.h, 0.6);
    }
    if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...it.pos }, null);
    this._blastDamage(it.pos, BREACH, it.owner, 'breach');
    g.emit('explosion', 'breach', { ...it.pos }, BREACH, it.owner);
  }
  // (los inhibidores de SILENCIO lo impedirán: Fase 6.5)
  canDetonate(it) { void it; return true; }

  // ---------------------------------------------------------------- carga térmica (TERMO)
  /** La carga térmica de `op` colocada y aún sin encender (o null). */
  thermalOf(op) {
    for (const c of this.placed) if (c.alive && c.owner === op && c.kind === 'thermal' && !c.burning) return c;
    return null;
  }
  /** Enciende una carga térmica: arde THERMAL.fuse segundos y abre el muro. */
  ignite(c) {
    if (!c.alive || c.burning) return false;
    if (!this.canDetonate(c)) { this.game.emit('gadgetJammed', c); return false; }
    c.burning = true; c.burnT = 0;
    // (encendida ya no se apaga de un disparo)
    this._untarget(c);
    this.game.emit('thermalIgnite', c);
    return true;
  }
  _thermalTick(c, dt) {
    c.burnT += dt;
    if (c.burnT >= THERMAL.fuse) this._thermalBlast(c);
  }
  _thermalBlast(c) {
    const g = this.game, w = g.world, p = c.pos, n = c.normal;
    c.alive = false;
    let destroyed;
    if (c.axis === 1) destroyed = this._clearHatch(c.voxel);
    else {
      // hueco a ras de suelo (se cruza de pie), centrado donde está la carga
      let floorY = c.floorY !== undefined ? c.floorY : Math.floor((p.y + 0.05) / 3.5) * 3.5;
      if (p.y < floorY - 0.1 || p.y > floorY + 3.5) floorY = Math.floor((p.y + 0.05) / 3.5) * 3.5;
      const cx = c.axis === 0 ? p.x - n.x * 0.12 : p.x, cz = c.axis === 2 ? p.z - n.z * 0.12 : p.z;
      destroyed = breachRect(w, cx, floorY + THERMAL.h / 2 + 0.01, cz, c.axis, THERMAL.w, THERMAL.h, 0.6, { hardBreach: true, jag: 0.12 });
    }
    if (destroyed.length) g.emit('voxels', destroyed, 'blast', { ...p }, null);
    this._blastDamage(p, THERMAL, c.owner, 'thermal');
    g.emit('explosion', 'thermal', { ...p }, THERMAL, c.owner);
  }
  // La trampilla (reforzada o no) entera: vóxeles de trampilla o refuerzo conectados, cerca.
  _clearHatch(v) {
    const w = this.game.world, out = [], seen = new Set(), stack = [[v.x, v.y, v.z]];
    const R = 12;      // 1,5 m alrededor del punto donde se puso (la trampilla mide 1,25 m)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    while (stack.length && out.length < 1200) {
      const [x, y, z] = stack.pop();
      if (Math.abs(x - v.x) > R || Math.abs(z - v.z) > R || Math.abs(y - v.y) > 2) continue;
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const m = w.get(x, y, z);
      if (m !== MAT.HATCH && m !== MAT.REINFORCED) continue;
      w.setRaw(x, y, z, MAT.AIR);
      out.push({ x, y, z, mat: m });
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
    }
    if (out.length) w.notify(x0, y0, z0, x1, y1, z1);
    return out;
  }
  // Quita la barricada (o la trampilla) entera: los vóxeles de ese material conectados.
  _clearConnected(v, mat) {
    const w = this.game.world, out = [], seen = new Set(), stack = [[v.x, v.y, v.z]];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    while (stack.length && out.length < 4000) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (w.get(x, y, z) !== mat) continue;
      w.setRaw(x, y, z, MAT.AIR);
      out.push({ x, y, z, mat });
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
    }
    if (out.length) w.notify(x0, y0, z0, x1, y1, z1);
    return out;
  }

  // Claymore: salta cuando un enemigo entra en su cono de 2 m (y la ve).
  _claymoreTick(c) {
    const g = this.game;
    if (g.time - c.t0 < 0.2) return;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    for (const op of g.operators) {
      if (op.team === c.team || op.state !== 'alive' || op.frozen) continue;
      const b = op.body.pos;
      const dx = b.x - c.pos.x, dz = b.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d > CLAYMORE.range || Math.abs(b.y - c.pos.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / Math.max(0.01, d) < CLAYMORE.cone) continue;
      if (!lineOfSight(g.world, c.pos.x, c.pos.y + 0.12, c.pos.z, b.x, b.y + 0.6, b.z)) continue;
      this._claymoreBlast(c);
      return;
    }
  }
  _claymoreBlast(c) {
    const g = this.game;
    c.alive = false;
    this._untarget(c);
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const p = { x: c.pos.x, y: c.pos.y + 0.12, z: c.pos.z };
    // letal en el cono de delante; detrás y a los lados, poco
    this._blastDamage(p, CLAYMORE, c.owner, 'claymore', (op, ctr) => {
      const dx = ctr.x - p.x, dz = ctr.z - p.z, d = Math.hypot(dx, dz) || 1;
      return (dx * fx + dz * fz) / d >= CLAYMORE.cone ? 1 : 0.2;
    });
    g.emit('explosion', 'claymore', p, CLAYMORE, c.owner);
  }

  /** ¿Está el punto dentro de una nube? (para el velo de humo en pantalla). Devuelve 0..1. */
  smokeAt(p) {
    let k = 0;
    const now = this.game.time;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s, now);
      if (r <= 0) continue;
      const d = Math.hypot(p.x - s.x, (p.y - s.y) * 1.3, p.z - s.z);
      if (d < r) k = Math.max(k, Math.min(1, (r - d) / (r * 0.35)));
    }
    return k;
  }
}

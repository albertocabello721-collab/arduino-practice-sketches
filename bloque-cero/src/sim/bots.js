// IA de los bots (Fase 5). Cada bot tiene un cerebro con:
//  · percepción: vista (campo de visión, alcance, línea de visión por agujeros y
//    cristal) y oído (disparos, pasos, golpes, refuerzos…) con memoria de posiciones;
//  · pizarra de equipo: lo que ve un compañero llega a los demás con retraso de radio,
//    más las marcas de drones (ataque) y lo que captan las cámaras (defensa);
//  · navegación por la rejilla 2,5D (escaleras, escaleras de mano, barricadas a golpes);
//  · combate con tiempo de reacción, error de puntería que se asienta, ráfagas,
//    disparos a través de paredes blandas, rematar y reanimar;
//  · tácticas por bando:
//      defensa · preparación: refuerzos y barricadas del sitio; luego anclas sosteniendo
//                ángulos en diagonal sobre los accesos y merodeadores que rotan por las
//                salas vecinas y vuelven al sitio cuando aprieta; retoma al plantar.
//      ataque  · preparación: drones hacia los puntos de plantado (marcan defensores y
//                localizan el objetivo); acción: entradas repartidas, agruparse, despejar,
//                plantar con escolta, defender el desactivador y recogerlo si cae.
import { NavGrid } from './nav.js';
import { Mover } from './ai/mover.js';
import { Perception, TeamBoard } from './ai/perception.js';
import { entrancesOf, holdPointFor, adjacentRooms, attackEntries } from './ai/tactics.js';
import { lineOfSight, traverse } from '../world/raycast.js';
import { SOLID, HARD, PEN_COST } from '../world/materials.js';
import { angleDiff, clamp } from '../core/math.js';
import { BONE } from './skeleton.js';

// Dificultad (tabla de IA del documento): reacción, error inicial de puntería (grados) que
// se corrige mientras sigue al blanco, y lo que sabe hacer cada nivel.
//   novato   · no dispara a través de paredes ni flanquea
//   normal   · lo básico
//   veterano · pre-disparo en esquinas conocidas, dispara a paredes blandas si oye pasos
//   elite    · además se coordina, flanquea y cambia de ángulo tras ser visto
const DEG = Math.PI / 180;
const FOV = 50 * DEG;       // cono de visión de 100°
export const DIFFICULTY = {
  novato: { label: 'Novato', react: 0.70, aimErr: 1.8 * DEG, settle: 0.9, turn: 3.0, burst: 0.28, pause: [0.55, 1.0], fov: FOV, range: 26, head: 0.08, recoil: 0.4, hearing: 0.8, wallbang: 0, strafe: 0.1, prefire: 0.2, flank: 0, reposition: 0 },
  normal: { label: 'Normal', react: 0.45, aimErr: 1.0 * DEG, settle: 0.6, turn: 4.4, burst: 0.38, pause: [0.35, 0.7], fov: FOV, range: 34, head: 0.18, recoil: 0.6, hearing: 1.0, wallbang: 0, strafe: 0.3, prefire: 0.4, flank: 0.3, reposition: 0.35 },
  veterano: { label: 'Veterano', react: 0.30, aimErr: 0.6 * DEG, settle: 0.45, turn: 6.0, burst: 0.48, pause: [0.25, 0.5], fov: FOV, range: 42, head: 0.28, recoil: 0.75, hearing: 1.15, wallbang: 0.6, strafe: 0.6, prefire: 0.8, flank: 0.4, reposition: 0.65 },
  elite: { label: 'Élite', react: 0.22, aimErr: 0.35 * DEG, settle: 0.35, turn: 7.5, burst: 0.55, pause: [0.18, 0.4], fov: FOV, range: 48, head: 0.38, recoil: 0.85, hearing: 1.3, wallbang: 0.8, strafe: 0.8, prefire: 1.0, flank: 0.6, reposition: 1.0 },
};
DIFFICULTY.recluta = DIFFICULTY.novato;   // nombre antiguo (ajustes guardados)
export const DIFFICULTY_KEYS = ['novato', 'normal', 'veterano', 'elite'];

// La rejilla de navegación se construye una vez por mundo (~0,8 s) y se comparte.
const NAVS = new WeakMap();
export function navFor(world, map) {
  let n = NAVS.get(world);
  if (!n) { n = new NavGrid(world, map); NAVS.set(world, n); }
  return n;
}

const LEVEL = { B: -1, 1: 0, 2: 1 };
const HEAR_COOLDOWN = 0.3;     // un mismo oyente no procesa dos ruidos de la misma fuente tan seguidos

export class BotSquad {
  constructor(match, difficulty = 'normal', { nav = null } = {}) {
    this.match = match;
    this.game = match.game;
    this.setDifficulty(difficulty);
    this.nav = nav || navFor(match.world, match.map);
    this.brains = new Map();
    this.boards = [new TeamBoard(0), new TeamBoard(1)];
    this.defPlan = null;
    this.atkPlan = null;
    this.pickupBy = null;
    this._enemies = [[], []];
    this._enemiesTick = -1;
    this._camT = 0;
    this._subs = [];
    this._bind();
  }
  dispose() { for (const off of this._subs) off(); this._subs = []; for (const B of this.brains.values()) B.mover.stop(); }

  setDifficulty(d) {
    if (d === 'recluta') d = 'novato';
    this.diffKey = DIFFICULTY[d] ? d : 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    for (const B of (this.brains || new Map()).values()) { B.diff = this.diff; B.per.diff = this.diff; B.op.recoilControl = this.diff.recoil; }
  }

  // ------------------------------------------------------------------ eventos (oído)
  _bind() {
    const g = this.game, m = this.match;
    const on = (em, ev, fn) => this._subs.push(em.on(ev, fn));
    on(g, 'shot', (op, w, eye) => this._noise(op, eye, 'shot', 45));
    on(g, 'footstep', (op, mat, loud) => this._noise(op, op.body.pos, 'step', 3 + 20 * loud));
    on(g, 'melee', (op, info) => this._noise(op, (info && info.point) || op.body.pos, 'melee', 14));
    on(g, 'vault', (op) => this._noise(op, op.body.pos, 'vault', 9));
    on(g, 'land', (op, speed) => this._noise(op, op.body.pos, 'land', 5 + speed));
    on(g, 'reload', (op) => this._noise(op, op.body.pos, 'reload', 6));
    on(g, 'fortifyStart', (op) => this._noise(op, op.body.pos, 'fortify', 18));
    on(g, 'reviveStart', (op) => this._noise(op, op.body.pos, 'revive', 6));
    on(g, 'damaged', (t, ev) => this._hurt(t, ev));
    on(g, 'downed', (t, ev) => this._hurt(t, ev));
    on(g, 'bullet', (op, res) => this._whiz(op, res));
    // el desactivador se oye desde lejos; plantado y en el suelo, lo sabe todo el equipo
    on(m, 'plantStart', (op) => this._noise(op, op.body.pos, 'plant', 30));
    on(m, 'disableStart', (op) => { for (const B of this.brains.values()) if (B.side === 'atk') B.per.hear(op.body.pos, 'disable', op, 999); });
  }
  _noise(src, pos, kind, range) {
    if (!src || src.frozen) return;
    const now = this.game.time;
    for (const B of this.brains.values()) {
      if (B.team === src.team || B.op.state !== 'alive') continue;
      const last = B.heardAt.get(src);
      if (last !== undefined && now - last < HEAR_COOLDOWN && kind !== 'plant') continue;
      const b = B.op.body.pos;
      const dx = pos.x - b.x, dz = pos.z - b.z;
      if (dx * dx + dz * dz > range * range * B.diff.hearing * B.diff.hearing) continue;
      B.heardAt.set(src, now);
      B.per.hear(pos, kind, src, range);
    }
  }
  _hurt(t, ev) {
    const B = this.brains.get(t);
    if (!B || !ev.by || ev.by.team === t.team) return;
    const p = ev.by.body.pos, err = ev.throughWall ? 1.2 : 0.3, rng = this.game.rng;
    B.per.memory.set(ev.by, { x: p.x + (rng.next() - 0.5) * err, y: p.y, z: p.z + (rng.next() - 0.5) * err, t: this.game.time, seen: false, precise: !ev.throughWall });
    B.underFire = this.game.time;
  }
  // Balas que pasan cerca: se sabe de dónde vienen.
  _whiz(op, res) {
    if (!op || !res) return;
    const o = res.origin, d = res.dir, L = res.end;
    for (const B of this.brains.values()) {
      if (B.team === op.team || B.op.state !== 'alive') continue;
      const c = B.op.center();
      const cx = c.x - o.x, cy = c.y - o.y, cz = c.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > L + 1) continue;
      const px = cx - d.x * t, py = cy - d.y * t, pz = cz - d.z * t;
      if (px * px + py * py + pz * pz > 2.2 * 2.2) continue;
      B.underFire = this.game.time;
      const m = B.per.memory.get(op);
      if (!m || this.game.time - m.t > 0.3) B.per.memory.set(op, { x: op.body.pos.x, y: op.body.pos.y, z: op.body.pos.z, t: this.game.time, seen: false, precise: true });
    }
  }

  // ------------------------------------------------------------------ ronda
  reset() {
    for (const B of this.brains.values()) B.mover.stop();
    this.brains.clear();
    this.boards[0].reset(); this.boards[1].reset();
    this.defPlan = null;
    this.atkPlan = null;
    this.pickupBy = null;
    for (const op of this.game.operators) {
      if (!op.isBot) continue;
      op.recoilControl = this.diff.recoil;
      this.brains.set(op, new Brain(this, op));
    }
    if (this.match.site) this._planDefense();
    this._planDrones();
  }

  // Defensa: reparto de refuerzos y barricadas (2 + 2 por bot), anclas y merodeadores.
  _planDefense() {
    const M = this.match, site = M.site, map = M.map, rng = this.game.rng;
    const rooms = [site.A, site.B].map((id) => map.rooms.find((r) => r.id === id));
    const defs = [...this.brains.values()].filter((B) => B.side === 'def');
    const ents = [];
    // las anclas vigilan puertas y arcos (plantarse frente a una ventana es ofrecerse al exterior)
    for (const r of rooms) for (const e of entrancesOf(map, r)) if (e.kind === 'door' || e.kind === 'arch') ents.push({ ...e, room: r, watchers: 0 });
    if (!ents.length) for (const r of rooms) for (const e of entrancesOf(map, r)) if (!e.kind.startsWith('hatch')) ents.push({ ...e, room: r, watchers: 0 });
    this.defPlan = { rooms, ents, adj: adjacentRooms(map, rooms), holds: [] };
    // papeles: hasta 2 merodeadores (si hay bastantes bots), el resto anclas
    const nRoam = defs.length >= 4 ? 2 : defs.length >= 3 ? 1 : 0;
    const order = rng.shuffle([...defs]);
    order.forEach((B, i) => { B.role = i < nRoam ? 'roam' : 'anchor'; });
    if (!M.fort) return;
    const plan = M.fort.planFor(rooms);
    const roomOf = (op) => {
      const p = op.body.pos;
      const i = rooms.findIndex((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1);
      return i < 0 ? 0 : i;
    };
    const pools = [0, 1].map((ri) => ({
      reinf: rng.shuffle([...plan.hatches.filter((h) => h.room === ri), ...rng.shuffle(plan.walls.filter((w) => w.room === ri))]),
      open: rng.shuffle(plan.openings.filter((o) => o.room === ri)),
    }));
    // primero las trampillas (cortan el ataque vertical), luego paredes al azar
    for (const pool of pools) pool.reinf.sort((a, b) => (a.kind === 'hatch' ? -1 : 0) - (b.kind === 'hatch' ? -1 : 0));
    for (const B of defs) {
      const pool = pools[roomOf(B.op)];
      const other = pools[1 - roomOf(B.op)];
      B.fort = [];
      for (let i = 0; i < 2; i++) { const t = pool.reinf.shift() || other.reinf.shift(); if (t) B.fort.push({ ...t, t: 0, walkT: 0 }); }
      for (let i = 0; i < 2; i++) { const t = pool.open.shift() || other.open.shift(); if (t) B.fort.push({ ...t, t: 0, walkT: 0 }); }
      const p = B.op.body.pos;
      B.fort.sort((a, b) => Math.hypot(a.stand.x - p.x, a.stand.z - p.z) - Math.hypot(b.stand.x - p.x, b.stand.z - p.z));
    }
  }

  // Ataque, preparación: cada dron va hacia un punto de plantado distinto.
  _planDrones() {
    const map = this.match.map, rng = this.game.rng;
    this.droneChecked = new Set();     // ubicaciones ya revisadas por algún dron sin encontrar el objetivo
    const pts = [];
    for (const s of map.sites) pts.push({ site: s, k: 'A' });
    for (const s of rng.shuffle([...map.sites])) pts.push({ site: s, k: 'B' });
    let i = 0;
    for (const B of this.brains.values()) if (B.side === 'atk') B.droneGoal = pts[i++ % pts.length];
  }

  // Ataque, al empezar la acción: sitio objetivo (o búsqueda), entradas y grupos.
  _planAttack() {
    const M = this.match, map = M.map, rng = this.game.rng;
    const atk = [...this.brains.values()].filter((B) => B.side === 'atk');
    const found = M.recon.objectiveFound;
    const order = rng.shuffle(map.sites.map((s, i) => i));
    const P = { site: found ? M.site : null, order, idx: 0, t0: this.game.time, entries: [] };
    this.atkPlan = P;
    if (!atk.length) return;
    const target = P.site || map.sites[order[0]];
    // entradas: las dos mejores para ese sitio (distancia desde donde estamos + hasta el sitio + cambio de planta)
    let cx = 0, cz = 0;
    for (const B of atk) { cx += B.op.body.pos.x; cz += B.op.body.pos.z; }
    cx /= atk.length; cz /= atk.length;
    const sc = siteCenter(map, target);
    const scored = attackEntries(map, this.nav).map((e) => ({
      e, s: Math.hypot(e.x - cx, e.z - cz) + Math.hypot(e.inside.x - sc.x, e.inside.z - sc.z) * 1.3 +
        Math.abs((LEVEL[e.door.level] ?? 0) - (LEVEL[target.level] ?? 0)) * 7 + rng.next() * 4,
    })).sort((a, b) => a.s - b.s);
    P.entries = scored.slice(0, 2).map((q) => q.e);
    // grupos: el portador va con el grupo grande y el último de la fila
    const carrier = M.defuser && M.defuser.carrier;
    const sorted = [...atk].sort((a, b) => (a.op === carrier) - (b.op === carrier));
    // cada grupo espera un rato en su entrada (reconocimiento) antes de entrar
    const waits = P.entries.map(() => 6 + rng.next() * 9);
    sorted.forEach((B, i) => {
      const k = P.entries.length > 1 && i % 5 >= 3 ? 1 : 0;
      B.entry = P.entries[k];
      B.stackWait = waits[k];
      B.stackAt = B.entry.stacks.length ? B.entry.stacks[i % B.entry.stacks.length] : B.entry;
      B.stage = 'approach';
      B.siteRoomKey = i % 2 ? 'B' : 'A';
      B.delay = rng.next() * 2.5;
    });
  }
  // Sitio al que va el ataque ahora (el encontrado o el que toca revisar).
  atkTargetSite() {
    const P = this.atkPlan;
    if (!P) return null;
    if (!P.site && this.match.recon.objectiveFound) P.site = this.match.site;
    return P.site || this.match.map.sites[P.order[Math.min(P.idx, P.order.length - 1)]];
  }

  enemiesOf(team) {
    if (this._enemiesTick !== this.game.tickCount) {
      this._enemiesTick = this.game.tickCount;
      this._enemies[0].length = 0; this._enemies[1].length = 0;
      for (const o of this.game.operators) {
        if (o.state === 'dead' || o.frozen) continue;
        this._enemies[1 - o.team].push(o);
      }
    }
    return this._enemies[team];
  }

  // Información de equipo: marcas de drones (ataque) y cámaras vigiladas (defensa).
  _teamIntel(dt) {
    const M = this.match, g = this.game, recon = M.recon, now = g.time;
    for (const [op, s] of recon.spotted) {
      if (op.state === 'dead') continue;
      const b = this.boards[s.team];
      const k = b.known.get(op);
      if (!k || now - k.t > 0.4) b.known.set(op, { x: op.body.pos.x, y: op.body.pos.y, z: op.body.pos.z, t: now, precise: true });
    }
    this._camT -= dt;
    if (this._camT > 0 || M.phase === 'prep') return;
    this._camT = 0.5;
    const defTeam = M.teamOfSide('def');
    if (![...this.brains.values()].some((B) => B.team === defTeam && B.op.state === 'alive')) return;
    const board = this.boards[defTeam];
    for (const cam of recon.cams) {
      if (!cam.alive) continue;
      const e = cam.eyePos(), v = cam.viewDir();
      for (const t of this.enemiesOf(defTeam)) {
        if (t.state !== 'alive') continue;
        const c = t.center();
        const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 22 || (dx * v.x + dy * v.y + dz * v.z) / d < 0.62) continue;
        if (!lineOfSight(g.world, e.x, e.y, e.z, c.x, c.y, c.z)) continue;
        board.report(t, t.body.pos, now, true, 1.2);
      }
    }
  }

  update(dt) {
    const M = this.match, phase = M.phase;
    // presupuesto por tick: ~3 columnas de la rejilla y ~900 nodos de búsqueda de rutas (< 1 ms);
    // con cola (inicio de ronda, todos pidiendo ruta a la vez) algo más para no retrasar a nadie
    this.nav.update(3);
    this.nav.work(this.nav.queue.length > 3 ? 2000 : 900);
    const live = phase === 'prep' || phase === 'action' || phase === 'planted';
    if (!live) {
      for (const B of this.brains.values()) B.idle();
      return;
    }
    const now = this.game.time;
    this.boards[0].tick(now); this.boards[1].tick(now);
    this._teamIntel(dt);
    if ((phase === 'action' || phase === 'planted') && !this.atkPlan) this._planAttack();
    this.holdBudget = 1;          // como mucho un cálculo de punto de guardia por tick (son caros)
    this._assignPickup();
    for (const B of this.brains.values()) B.update(dt, phase);
  }

  // Desactivador en el suelo: va a por él el atacante bot vivo más cercano.
  _assignPickup() {
    const d = this.match.defuser;
    if (!d || d.planted || d.carrier || !d.pos) { this.pickupBy = null; return; }
    if (this.pickupBy && this.pickupBy.state === 'alive') return;
    let best = null, bd = Infinity;
    for (const B of this.brains.values()) {
      if (B.side !== 'atk' || B.op.state !== 'alive') continue;
      const p = B.op.body.pos;
      const dist = Math.hypot(p.x - d.pos.x, p.z - d.pos.z) + Math.abs(p.y - d.pos.y) * 3;
      if (dist < bd) { bd = dist; best = B.op; }
    }
    this.pickupBy = best;
  }
}

// ====================================================================== cerebro
class Brain {
  constructor(sq, op) {
    this.sq = sq;
    this.op = op;
    this.game = sq.game;
    this.match = sq.match;
    this.side = op.side;
    this.team = op.team;
    this.diff = sq.diff;
    this.rng = sq.game.rng;
    this.mover = new Mover(op, sq.nav);
    this.per = new Perception(op, sq.game, sq.diff);
    this.board = sq.boards[op.team];
    this.heardAt = new Map();
    this.reported = new Map();
    this.role = null;
    this.fort = [];
    this.post = null;             // puesto fijo (órdenes, pruebas)
    this.task = null;
    this.hold = null;
    this.target = null;
    this.drone = null;
    this.lostT = 0;
    this.seeT = 0; this.react = 0; this.burst = 0; this.pause = 0; this.semi = false;
    this.aim = { x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, jT: 0, t0: -1, head: false };
    this.strafe = 0; this.strafeT = 0;
    this.thinkT = this.rng.next() * 0.2;
    this.underFire = -9;
    this.scanYaw = op.yaw; this.scanT = 0;
    this.wallT = 0; this.wallBurst = 0;
    this.crouchPref = op.side === 'def' ? this.rng.next() < 0.5 : this.rng.next() < 0.25;
    this.stage = null; this.entry = null; this.delay = 0; this.stackT = 0;
    this.droneGoal = null; this.dm = null;
    // diagnóstico (tests): tiempo sin moverse queriendo moverse
    this.stillT = 0; this.maxStillT = 0; this._lastPos = { x: op.body.pos.x, z: op.body.pos.z };
  }

  idle() {
    const I = this.op.intent;
    I.fire = false; I.ads = false; I.moveX = 0; I.moveZ = 0; I.sprint = false; I.interact = false; I.lean = 0; I.reload = false;
  }

  // ------------------------------------------------------------------ bucle
  update(dt, phase) {
    const op = this.op, I = op.intent;
    I.fire = false; I.ads = false; I.lean = 0; I.interact = false; I.reload = false; I.vault = false;
    if (op.state === 'dead') { this.mover.stop(); return; }
    if (op.state === 'downed') {
      I.holdWound = true; I.moveX = 0; I.moveZ = 0; I.sprint = false;
      this.mover.stop();
      return;
    }
    I.holdWound = false;
    if (op.frozen) { I.moveX = 0; I.moveZ = 0; this._droneTick(dt); return; }
    this._perceive(dt);
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.2; this._think(phase); }
    this._act(dt, phase);
    this._trackStill(dt);
  }

  _trackStill(dt) {
    const p = this.op.body.pos;
    const moving = this.mover.status === 'moving' || this.mover.status === 'planning' || this.mover.status === 'failed';
    if (Math.hypot(p.x - this._lastPos.x, p.z - this._lastPos.z) > 0.5) { this._lastPos.x = p.x; this._lastPos.z = p.z; this.stillT = 0; }
    else if (moving && !this.target && !this.op.channel && !(this.pauseT > 0 && this.task && this.task.kind === 'clear')) {
      this.stillT += dt;
      this.maxStillT = Math.max(this.maxStillT, this.stillT);
      if (this.stillT > 7) this._unstick();
    } else this.stillT = 0;
  }
  // Último recurso: lleva un rato sin poder avanzar. Retroceder, cambiar de objetivo y replanificar.
  _unstick() {
    this.stillT = 0;
    this._lastPos.x = this.op.body.pos.x; this._lastPos.z = this.op.body.pos.z;
    this.mover.stop();
    this.backT = 0.7;
    this.unsticks = (this.unsticks || 0) + 1;
    const T = this.task;
    if (!T) return;
    switch (T.kind) {
      case 'clear': this.siteRoomKey = this.siteRoomKey === 'B' ? 'A' : 'B'; break;
      case 'approach': this.stage = 'clear'; break;
      case 'fortify': this.fort.shift(); break;
      case 'anchor': case 'roam': case 'siteHold': case 'guard': this.hold = null; break;
      default: this.task = null; this.thinkT = 0;
    }
  }

  // ------------------------------------------------------------------ percepción
  _perceive(dt) {
    const op = this.op, now = this.game.time;
    const enemies = this.sq.enemiesOf(this.team);
    if (this.per.scan(dt, enemies)) {
      for (const t of this.per.visible) {
        const last = this.reported.get(t);
        if (last === undefined || now - last > 0.5) { this.reported.set(t, now); this.board.report(t, t.body.pos, now, true, 0.8); }
      }
      this._pickTarget();
      this._spotDrone();
    }
    if (this.target && this.target.state === 'dead') this.target = null;
    if (this.target && !this.per.visible.includes(this.target)) {
      this.lostT += dt;
      if (this.lostT > 0.45) this.target = null;
    } else this.lostT = 0;
    void op;
  }

  _pickTarget() {
    const vis = this.per.visible;
    if (!vis.length) return;
    const e = this.op.eyePos();
    let best = null, bs = Infinity, cur = Infinity;
    const anyAlive = vis.some((t) => t.state === 'alive');
    for (const t of vis) {
      if (t.state === 'downed' && anyAlive) continue;
      const c = t.center();
      let s = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
      // quien me está apuntando es más urgente
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      const tx = e.x - c.x, tz = e.z - c.z, tl = Math.hypot(tx, tz) || 1;
      if ((fx * tx + fz * tz) / tl > 0.9) s *= 0.7;
      if (t === this.target) cur = s;
      if (s < bs) { bs = s; best = t; }
    }
    if (!best) return;
    if (this.target && this.target !== best && cur < Infinity && bs > cur * 0.6) return;   // no cambiar sin motivo
    if (this.target !== best) { this.target = best; this.seeT = 0; this.react = 0; this.aim.t0 = -1; }
  }

  // Defensa: drones enemigos a la vista (o que se oyen muy cerca).
  _spotDrone() {
    this.drone = null;
    if (this.side !== 'def' || this.target) return;
    const recon = this.match.recon;
    if (!recon) return;
    const op = this.op, e = op.eyePos();
    const vx = -Math.sin(op.yaw), vz = -Math.cos(op.yaw);
    let bd = 10;               // un dron es pequeño: de lejos pasa desapercibido
    for (const d of recon.drones) {
      if (!d.alive || d.team === this.team) continue;
      const c = d.center();
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > bd) continue;
      const cos = (dx * vx + dz * vz) / Math.max(0.001, Math.hypot(dx, dz));
      const heard = dist < 6 && d.moveSpeed > 0.5;          // el zumbido se oye a 6 m
      if (cos < Math.cos(this.diff.fov) && !heard) continue;
      if (!lineOfSight(this.game.world, e.x, e.y, e.z, c.x, c.y + 0.05, c.z)) continue;
      bd = dist; this.drone = d;
    }
  }

  // ------------------------------------------------------------------ decisión
  _setTask(t) {
    if (this.task && this.task.key === t.key) return;
    this.task = t;
    this.hold = null;
    this.pauseT = 0;          // la pausa del avance a saltos es solo de «despejar»
  }

  _think(phase) {
    if (this.post) return this._setTask({ kind: 'post', key: 'post' });
    const rv = this._reviveCandidate();
    if (rv) return this._setTask({ kind: 'revive', key: 'revive:' + rv.id, who: rv });
    if (this.side === 'def') return this._thinkDef(phase);
    return this._thinkAtk(phase);
  }

  _reviveCandidate() {
    if (this.target || this.per.freshest(1.5, true)) return null;
    const op = this.op, p = op.body.pos;
    let best = null, bd = 14;
    for (const t of this.game.operators) {
      if (t.team !== this.team || t.state !== 'downed' || t === op) continue;
      // uno solo va a por cada derribado
      const other = [...this.sq.brains.values()].find((B) => B !== this && B.task && B.task.kind === 'revive' && B.task.who === t && B.op.state === 'alive');
      if (other) continue;
      const d = Math.hypot(t.body.pos.x - p.x, (t.body.pos.y - p.y) * 3, t.body.pos.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  _thinkDef(phase) {
    const M = this.match, plan = this.sq.defPlan;
    if (phase === 'planted') return this._setTask({ kind: 'disable', key: 'disable' });
    const early = phase === 'prep' || (phase === 'action' && M.rules.actionTime - M.timer < 15);
    if (this.fort.length && early) return this._setTask({ kind: 'fortify', key: 'fortify' });
    if (!plan) return this._setTask({ kind: 'anchor', key: 'anchor' });
    if (this.role === 'roam') {
      const late = phase === 'action' && M.timer < 60;
      if (late || this._attackersAtSite()) this.role = 'anchor';
    }
    // caza: un enemigo conocido y cercano, sin verlo (los merodeadores salen a buscarlo)
    const f = this.per.freshest(3, true) || this._boardNear(12);
    if (f && !this.target && phase !== 'prep') {
      const p = this.op.body.pos;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const inSite = plan.rooms.some((r) => f.x > r.x0 && f.x < r.x1 && f.z > r.z0 && f.z < r.z1 && Math.abs(f.y - r.floorY) < 1.5);
      // (los merodeadores no siempre salen a por el ruido: a veces esperan en su ángulo)
      if (this.role === 'roam' && d < 10 && this.huntRoll === undefined) this.huntRoll = this.rng.next() < this.diff.flank;
      if ((this.role === 'roam' && d < 10 && this.huntRoll) || (inSite && d < 7)) return this._setTask({ kind: 'hunt', key: 'hunt', pos: { x: f.x, y: f.y, z: f.z }, until: this.game.time + 5 });
    }
    if (this.task && this.task.kind === 'hunt' && this.game.time < this.task.until && this.mover.status !== 'arrived') return;
    // cambiar de ángulo tras ser visto: marcado por un dron o una cámara, o tras un tiroteo sin rematar
    const now = this.game.time;
    const spotted = M.recon.isSpottedFor(this.op, 1 - this.team);
    const shotAt = now - this.underFire < 2 && !this.target;
    if ((spotted || shotAt) && this.hold && this._atHold() && now - (this.movedAt ?? -99) > 8 && phase !== 'prep') {
      this.movedAt = now;
      if (this.rng.next() < this.diff.reposition) { this.hold = null; this.mover.stop(); }
    }
    if (this.role === 'roam') return this._setTask({ kind: 'roam', key: 'roam' });
    return this._setTask({ kind: 'anchor', key: 'anchor' });
  }

  _attackersAtSite() {
    const plan = this.sq.defPlan, now = this.game.time;
    for (const k of this.board.recent(now, 6)) {
      for (const r of plan.rooms) {
        if (k.x > r.x0 - 4 && k.x < r.x1 + 4 && k.z > r.z0 - 4 && k.z < r.z1 + 4 && Math.abs(k.y - r.floorY) < 2) return true;
      }
    }
    return false;
  }
  _boardNear(maxD) {
    const p = this.op.body.pos, now = this.game.time;
    let best = null, bd = maxD;
    for (const k of this.board.recent(now, 2.5)) {
      if (!k.precise) continue;
      const d = Math.hypot(k.x - p.x, (k.y - p.y) * 2, k.z - p.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  _thinkAtk(phase) {
    const M = this.match, sq = this.sq, d = M.defuser, now = this.game.time;
    if (phase === 'planted') {
      if (M.disable) return this._setTask({ kind: 'hunt', key: 'stopDisable', pos: { ...d.plantPos }, until: now + 30, rush: true });
      return this._setTask({ kind: 'guard', key: 'guard' });
    }
    if (sq.pickupBy === this.op && d && d.pos) return this._setTask({ kind: 'pickup', key: 'pickup' });
    const site = sq.atkTargetSite();
    if (!site) return;
    const carrier = d && d.carrier === this.op;
    const P = sq.atkPlan;
    const late = M.timer < 50;
    if (carrier && M.recon.objectiveFound && (late || this._siteSecured())) return this._setTask({ kind: 'plant', key: 'plant' });
    // búsqueda: si el objetivo no se conoce y ya hemos llegado al sitio revisado, al siguiente
    if (!M.recon.objectiveFound && this.stage === 'hold' && this.task && this.task.site === site && this.hold && this._atHold()) {
      if (P.order[P.idx] === M.map.sites.indexOf(site) && P.idx < P.order.length - 1) P.idx++;
      this.stage = 'clear';
      return;
    }
    if (late && this.stage !== 'hold') this.stage = 'clear';
    const key = `${this.stage}:${site.id}`;
    if (this.stage === 'approach') return this._setTask({ kind: 'approach', key, site });
    if (this.stage === 'stack') return this._setTask({ kind: 'stack', key, site });
    if (this.stage === 'clear') return this._setTask({ kind: 'clear', key, site });
    return this._setTask({ kind: 'siteHold', key: 'hold:' + site.id, site });
  }

  // ¿Hay algún compañero dentro del sitio y nadie nos ha visto disparar hace un rato?
  _siteSecured() {
    const M = this.match;
    const mates = this.game.operators.filter((o) => o.team === this.team && o.state === 'alive');
    const me = this.op.body.pos;
    const inside = (o) => M.siteAt(o.body.pos.x, o.body.pos.y, o.body.pos.z) !== null;
    if (inside(this.op) && !this.target && this.game.time - this.underFire > 3) return true;
    if (mates.length <= 1) return true;
    void me;
    return mates.some((o) => o !== this.op && inside(o));
  }

  // ------------------------------------------------------------------ ejecución
  _act(dt, phase) {
    const op = this.op, I = op.intent;
    // combate: prioridad absoluta (salvo terminar un refuerzo que ya se está poniendo)
    const channel = op.channel && (op.channel.kind === 'reinforce' || op.channel.kind === 'barricade');
    if (this.target && !channel) {
      this._fight(dt);
      return;
    }
    if (this.drone && !channel && this.drone.alive) { this._shootDrone(dt); return; }
    // desatascarse: unos pasos hacia atrás
    if (this.backT > 0) {
      this.backT -= dt;
      I.moveZ = -0.8; I.moveX = (this.unsticks % 2 ? 0.5 : -0.5); I.sprint = false;
      return;
    }
    // recargar con calma
    if (!this.target && op.weapon.ammo < op.weapon.def.mag * 0.55 && op.weapon.reserve > 0 && !this.per.freshest(1.2, true)) I.reload = true;
    if (op.weaponIndex !== 0 && op.weapons[0].ammo + op.weapons[0].reserve > 0 && !this.target) I.switchTo = 0;
    // disparar a través de una pared blanda a un enemigo que se oye muy cerca
    if (this._wallbang(dt)) return;
    const T = this.task;
    if (!T) { this._stand(dt); this._idleLook(dt, null); return; }
    switch (T.kind) {
      case 'post': this._tPost(dt); break;
      case 'fortify': this._tFortify(dt); break;
      case 'anchor': this._tAnchor(dt); break;
      case 'roam': this._tRoam(dt); break;
      case 'hunt': this._tHunt(dt, T); break;
      case 'disable': this._tDisable(dt); break;
      case 'revive': this._tRevive(dt, T); break;
      case 'approach': this._tApproach(dt, T); break;
      case 'stack': this._tStack(dt, T); break;
      case 'clear': this._tClear(dt, T); break;
      case 'siteHold': this._tSiteHold(dt, T); break;
      case 'plant': this._tPlant(dt); break;
      case 'guard': this._tGuard(dt); break;
      case 'pickup': this._tPickup(dt); break;
      default: this._stand(dt); this._idleLook(dt, null);
    }
    void phase;
  }

  _stand(dt) {
    const I = this.op.intent;
    if (this.mover.busy) this.mover.stop();
    I.moveX = 0; I.moveZ = 0; I.sprint = false;
    void dt;
  }

  // Ir a `pos` por la rejilla; al final, los últimos centímetros en línea recta.
  _goto(pos, dt, { r = 0.45, sprint = false, speed = 1, look = 'path', crouch = false, exact = false } = {}) {
    const op = this.op, I = op.intent, p = op.body.pos;
    // la defensa solo rompe sus propias barricadas si no hay otro camino
    const st = this.mover.go(pos, { r: Math.max(r, 0.3), breakCost: this.side === 'def' ? 25 : 0 });
    const lookYaw = this._lookFor(dt, look);
    let status = this.mover.update(dt, { sprint, crouch, lookYaw, speed });
    if (this.mover.mustFace && this.mover.wantYaw !== null) this._turn(this.mover.wantYaw, this.mover.pitchWant || 0, 9, dt);
    if (status === 'arrived' || status === 'failed') {
      const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz);
      if (exact && d > r && d < 1.6 && Math.abs(pos.y - p.y) < 0.6) {
        // tramo final directo (p. ej. al punto exacto donde reforzar)
        const yaw = op.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const k = Math.min(1, d * 2 + 0.2);
        I.moveZ = clamp((dx * fx + dz * fz) / d * k, -1, 1);
        I.moveX = clamp((dx * rx + dz * rz) / d * k, -1, 1);
        return 'moving';
      }
      if (status === 'failed') {
        // sin ruta: acercarse en línea recta (y saltar lo que haya) mientras se vuelve a intentar
        if (this.mover.failAt === this.mover.clock) this.fails = (this.fails || 0) + 1;
        this.failT = (this.failT || 0) + dt;
        if (d > r) {
          const yaw = op.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
          I.moveZ = clamp((dx * fx + dz * fz) / d, -1, 1);
          I.moveX = clamp((dx * rx + dz * rz) / d, -1, 1);
          if (this.failT > 1.2) { this.failT = 0; I.vault = true; }
          if (look === 'path') this._turn(Math.atan2(-dx, -dz), 0, 5, dt);
        }
        return 'failed';
      }
      status = d <= r + 0.3 ? 'arrived' : status;
    }
    void st;
    return status;
  }

  // ¿Hacia dónde mira mientras anda? Devuelve el yaw si NO mira hacia donde anda (o null).
  _lookFor(dt, mode) {
    const threat = this._threat();
    if (threat) { this._aimAt(threat, dt, this.diff.turn * 0.8, threat.precise && threat.d < 18); return this.op.yaw; }
    if (mode === 'path') {
      // mirar un poco por delante en la ruta
      const q = this.mover.ahead(2.5);
      if (q && !this.mover.mustFace) {
        const p = this.op.body.pos;
        const yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
        this._turn(yaw, clamp((q.y - p.y) * 0.25, -0.5, 0.5), 7, dt);
        return Math.abs(angleDiff(this.op.yaw, yaw)) < 0.3 ? null : this.op.yaw;
      }
      if (this.mover.wantYaw !== null) this._turn(this.mover.wantYaw, 0, 7, dt);
      return null;
    }
    if (typeof mode === 'number') { this._turn(mode, 0, 4, dt); return this.op.yaw; }
    return null;
  }

  // Posición más probable de un enemigo al que apuntar sin verlo (memoria, pizarra o ruido).
  _threat() {
    const now = this.game.time, e = this.op.eyePos();
    const f = this.per.freshest(2.2);
    let best = null;
    if (f) best = { x: f.x, y: f.y + 1.2, z: f.z, precise: f.precise, t: f.t };
    const k = this._boardNear(20);
    if (k && (!best || k.t > best.t + 0.5)) best = { x: k.x, y: k.y + 1.2, z: k.z, precise: true, t: k.t };
    if (!best) {
      const n = this.per.lastNoise(1.8);
      if (n && n.src && n.src.team !== this.team) best = { x: n.x, y: n.y + 1.0, z: n.z, precise: false, t: n.t };
    }
    if (!best) return null;
    best.d = Math.hypot(best.x - e.x, best.z - e.z);
    if (best.d > 30) return null;
    void now;
    return best;
  }

  _idleLook(dt, holdYaw) {
    const th = this._threat();
    const hasHold = holdYaw !== null && holdYaw !== undefined;
    if (th) {
      const e = this.op.eyePos();
      const ty = Math.atan2(-(th.x - e.x), -(th.z - e.z));
      // viene de lo que ya se vigila: seguir en el ángulo, apuntando y listo
      if (hasHold && Math.abs(angleDiff(holdYaw, ty)) < 1.1 && !(th.precise && th.d < 5)) {
        this._turn(holdYaw, (this.hold && this.hold.pitch) || 0, 3, dt);
        this.op.intent.ads = th.d < 16;
        return;
      }
      this._aimAt(th, dt, this.diff.turn * 0.7, th.precise && th.d < 18 && this.rng.next() < this.diff.prefire + 0.3);
      return;
    }
    if (!hasHold) { this.op.pitch *= 0.95; return; }
    // barrido lento alrededor del ángulo que se sostiene
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 2 + this.rng.next() * 3; this.scanYaw = holdYaw + (this.rng.next() - 0.5) * 0.9; }
    this._turn(this.scanYaw, (this.hold && this.hold.pitch) || 0, 2.2, dt);
  }

  _turn(yaw, pitch, rate, dt) {
    const op = this.op;
    op.yaw += clamp(angleDiff(op.yaw, yaw), -rate * dt, rate * dt);
    op.pitch += clamp(pitch - op.pitch, -rate * 0.7 * dt, rate * 0.7 * dt);
  }
  _aimAt(pt, dt, rate, ads = false) {
    const e = this.op.eyePos();
    const dx = pt.x - e.x, dy = pt.y - e.y, dz = pt.z - e.z;
    const dh = Math.hypot(dx, dz);
    this._turn(Math.atan2(-dx, -dz), Math.atan2(dy, dh), rate, dt);
    if (ads) this.op.intent.ads = true;
  }

  // ------------------------------------------------------------------ combate
  _fight(dt) {
    const op = this.op, D = this.diff, I = op.intent, rng = this.rng;
    const t = this.target;
    if (this.mover.busy) this.mover.stop();
    this.seeT += dt;
    this.react += dt;
    const e = op.eyePos();
    // Puntería: al ver al blanco, un error inicial (en grados, según la dificultad) que se
    // corrige mientras lo sigue: un muelle amortiguado que se pasa un poco y vuelve
    // (sobrecorrección) y un punto de reposo que cambia cada poco (microajustes).
    const A = this.aim;
    if (A.t0 < 0) {
      const a = rng.next() * Math.PI * 2;
      const mag = D.aimErr * (0.6 + rng.next() * 0.4) * (1 + Math.min(1, t.moveSpeed / 3.3) * 0.5);
      A.x = Math.cos(a) * mag; A.y = Math.sin(a) * mag * 0.7; A.vx = 0; A.vy = 0; A.t0 = 0; A.jT = 0; A.gx = 0; A.gy = 0;
      A.head = rng.next() < D.head;
    }
    A.jT -= dt;
    if (A.jT <= 0) {
      A.jT = 0.25 + rng.next() * 0.35;
      const r = D.aimErr * 0.22 * (op.moveSpeed > 1 ? 2 : 1) * (1 + Math.min(1, t.moveSpeed / 3.3) * 0.5);
      A.gx = (rng.next() - 0.5) * 2 * r; A.gy = (rng.next() - 0.5) * 1.4 * r;
      if (rng.next() < 0.3) A.head = rng.next() < D.head;
    }
    const wn = 2.6 / D.settle, zeta = 0.5;
    A.vx += (wn * wn * (A.gx - A.x) - 2 * zeta * wn * A.vx) * dt;
    A.vy += (wn * wn * (A.gy - A.y) - 2 * zeta * wn * A.vy) * dt;
    A.x += A.vx * dt; A.y += A.vy * dt;
    const tp = aimPoint(t, A.head && t.state === 'alive');
    const dx = tp.x - e.x, dy = tp.y - e.y, dz = tp.z - e.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + A.x;
    const wantPitch = Math.atan2(dy, dist) + A.y;
    const diff = Math.abs(angleDiff(op.yaw, wantYaw));
    const rate = D.turn * (1 + Math.min(2, diff));
    op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * rate, dt * rate);
    op.pitch += clamp(wantPitch - op.pitch, -dt * rate * 0.7, dt * rate * 0.7);
    const w = op.weapon.def;
    I.ads = this.react > D.react * 0.5 && dist > 4.5;
    const tol = Math.max(0.035, Math.min(0.14, 0.32 / Math.max(1, dist)));
    const onTarget = Math.abs(angleDiff(op.yaw, wantYaw)) < tol && Math.abs(wantPitch - op.pitch) < tol * 1.2;
    // escopeta de lejos: mejor la pistola
    const far = w.cls === 'shotgun' && dist > 16;
    if (far && op.weapons[1] && op.weapons[1].ammo > 0 && op.weaponIndex === 0) I.switchTo = 1;
    if (this.react > D.react && onTarget) {
      if (this.pause > 0) this.pause -= dt;
      else {
        this.semi = w.auto ? true : !this.semi;
        I.fire = this.semi;
        this.burst += dt;
        const burstLen = w.auto ? D.burst * (dist < 8 ? 1.7 : dist > 20 ? 0.6 : 1) : 0.5;
        if (this.burst > burstLen) { this.burst = 0; this.pause = D.pause[0] + rng.next() * (D.pause[1] - D.pause[0]); }
      }
    }
    if (op.weapon.ammo === 0) {
      if (op.weapons[1] && op.weapons[1].ammo > 0 && dist < 12 && op.weaponIndex === 0) I.switchTo = 1;
      else I.reload = true;
    } else if (op.weaponIndex === 1 && op.weapons[0].ammo > 0 && dist > 12 && w.cls !== 'shotgun') I.switchTo = 0;
    // postura y movimiento: agacharse para cambiar la altura de la cabeza, esquivar de lado
    const def = this.side === 'def';
    I.stance = (this.crouchPref && dist > 5) || (def && dist > 7 && this.hold && this.hold.crouch) ? 'crouch' : 'stand';
    I.sprint = false;
    I.moveX = 0; I.moveZ = 0;
    if (D.strafe > 0 && dist > 3 && !op.channel) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.35 + rng.next() * 0.55;
        this.strafe = rng.next() < D.strafe ? (rng.next() < 0.5 ? -1 : 1) * (0.5 + rng.next() * 0.5) : 0;
      }
      I.moveX = this.strafe;
      if (I.stance === 'crouch') I.moveX *= 0.6;
    }
  }

  // Disparos a través de una pared blanda hacia un enemigo que se oye (o se sabe) muy cerca.
  _wallbang(dt) {
    const op = this.op, I = op.intent, D = this.diff;
    if (this.wallBurst > 0) {
      this.wallBurst -= dt;
      const w = this.wallAt;
      this._aimAt(w, dt, D.turn, true);
      const e = op.eyePos();
      const want = Math.atan2(-(w.x - e.x), -(w.z - e.z));
      if (Math.abs(angleDiff(op.yaw, want)) < 0.06) { this.semi = op.weapon.def.auto ? true : !this.semi; I.fire = this.semi; }
      I.moveX = 0; I.moveZ = 0; I.sprint = false;
      return true;
    }
    this.wallT -= dt;
    if (this.wallT > 0) return false;
    this.wallT = 1.2;
    if (op.channel || this.match.phase === 'prep' || op.weapon.ammo < 5) return false;
    if (this.rng.next() > D.wallbang) return false;
    // solo con lo que el propio bot oye o ha visto (no con marcas de otros)
    const f = this.per.freshest(1.0, true);
    if (!f || (f.op && f.op.state === 'dead')) return false;
    const e = op.eyePos();
    const pt = { x: f.x, y: f.y + 1.1, z: f.z };
    const dist = Math.hypot(pt.x - e.x, pt.y - e.y, pt.z - e.z);
    if (dist > 11 || dist < 1.5) return false;
    if (lineOfSight(this.game.world, e.x, e.y, e.z, pt.x, pt.y, pt.z)) return false;   // si se viera, lo veríamos
    const power = penetration(this.game.world, e, pt, 1 / op.weapon.def.penetration);
    if (power < 0.25) return false;
    this.wallAt = pt;
    this.wallBurst = 0.35 + this.rng.next() * 0.4;
    return true;
  }

  // Defensor: dispara al dron enemigo que tiene a la vista.
  _shootDrone(dt) {
    const op = this.op, d = this.drone, I = op.intent, D = this.diff;
    if (this.mover.busy) this.mover.stop();
    I.moveX = 0; I.moveZ = 0; I.sprint = false;
    // darse cuenta de que es un dron lleva un momento (como reaccionar ante un enemigo)
    if (this.droneSeen !== d) { this.droneSeen = d; this.droneT = 0; }
    this.droneT += dt;
    const e = op.eyePos(), c = d.center();
    const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, dist);
    op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * D.turn, dt * D.turn);
    op.pitch += clamp(wantPitch - op.pitch, -dt * D.turn, dt * D.turn);
    I.ads = dist > 4;
    if (this.droneT > D.react + 0.35 && Math.abs(angleDiff(op.yaw, wantYaw)) < 0.035 && Math.abs(wantPitch - op.pitch) < 0.045) {
      this.semi = !this.semi;
      I.fire = op.weapon.def.auto ? true : this.semi;
    }
    if (op.weapon.ammo === 0) I.reload = true;
  }

  // ------------------------------------------------------------------ tareas
  _tPost(dt) {
    const P = this.post, p = this.op.body.pos;
    if (Math.hypot(P.x - p.x, P.z - p.z) > 0.6) { this._goto(P, dt, { r: 0.4 }); return; }
    this._stand(dt);
    this._idleLook(dt, P.yaw);
  }

  // Ir al punto de apoyo, encarar la pared/hueco/trampilla y mantener F hasta terminar.
  _tFortify(dt) {
    const op = this.op, I = op.intent;
    const T = this.fort[0];
    if (!T) { this.task = null; return; }
    if (!T.started) {
      T.walkT += dt;
      if (T.walkT > 16) { this.fort.shift(); return; }        // no llega: siguiente tarea
      const p = op.body.pos;
      const d = Math.hypot(T.stand.x - p.x, T.stand.z - p.z);
      if (d > 0.22) { this._goto(T.stand, dt, { r: 0.2, sprint: true, exact: true }); return; }
      this._stand(dt);
      I.stance = 'stand';
      this._turn(T.face, T.pitch, 6, dt);
      if (Math.abs(angleDiff(op.yaw, T.face)) < 0.04 && Math.abs(T.pitch - op.pitch) < 0.04) { T.started = true; T.t = 0; }
      return;
    }
    this._stand(dt);
    I.stance = 'stand';
    op.yaw = T.face; op.pitch = T.pitch;
    I.interact = true;
    T.t += dt;
    const working = op.channel && (op.channel.kind === 'reinforce' || op.channel.kind === 'barricade');
    if ((!working && T.t > 0.3) || T.t > 7) { I.interact = false; this.fort.shift(); }
  }

  // Ancla: un punto en la sala del sitio sosteniendo un acceso en diagonal.
  _tAnchor(dt) {
    if (!this.hold) {
      if (!this._canPlan()) { this._stand(dt); this._idleLook(dt, null); return; }
      this.hold = this._pickSiteHold();
    }
    this._holdAt(dt, this.hold);
  }
  _canPlan() {
    if (this.sq.holdBudget > 0) { this.sq.holdBudget--; return true; }
    return false;
  }
  _pickSiteHold() {
    const plan = this.sq.defPlan;
    if (!plan) return null;
    const p = this.op.body.pos, rng = this.rng;
    // acceso con menos vigilantes, preferentemente en la sala donde estoy
    const here = plan.rooms.find((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1) || plan.rooms[rng.int(0, plan.rooms.length - 1)];
    const cands = rng.shuffle(plan.ents.filter((e) => e.room === here));
    const all = cands.length ? cands : rng.shuffle([...plan.ents]);
    all.sort((a, b) => a.watchers - b.watchers);
    for (const e of all) {
      const h = holdPointFor(this.sq.nav, this.game.world, e.room, e, plan.holds, rng);
      if (!h) continue;
      e.watchers++;
      plan.holds.push(h);
      return h;
    }
    return { x: p.x, y: p.y, z: p.z, yaw: this.op.yaw, crouch: this.crouchPref };
  }

  _holdAt(dt, h) {
    if (!h) { this._stand(dt); this._idleLook(dt, null); return; }
    const p = this.op.body.pos, I = this.op.intent;
    if (Math.hypot(h.x - p.x, h.z - p.z) > 0.5 || Math.abs(h.y - p.y) > 1) {
      const far = Math.hypot(h.x - p.x, h.z - p.z) > 10;
      const before = this.fails || 0;
      this._goto(h, dt, { r: 0.35, sprint: far && !this._threat(), exact: true });
      // inalcanzable: elegir otro sitio
      if ((this.fails || 0) > before) { h.fails = (h.fails || 0) + 1; if (h.fails >= 2) { this.hold = null; this.mover.stop(); } }
      return;
    }
    this._stand(dt);
    I.stance = h.crouch || this.crouchPref ? 'crouch' : 'stand';
    this._idleLook(dt, h.yaw);
  }

  // Merodeador: sostiene ángulos en salas vecinas al sitio y cambia de sala cada cierto tiempo.
  _tRoam(dt) {
    const plan = this.sq.defPlan, now = this.game.time;
    if (!plan || !plan.adj.length) { this._tAnchor(dt); return; }
    if (!this.hold || (this.hold.until && now > this.hold.until && this._atHold())) {
      if (!this._canPlan()) { if (this.hold) this._holdAt(dt, this.hold); else { this._stand(dt); this._idleLook(dt, null); } return; }
      const rng = this.rng;
      const opts = rng.shuffle([...plan.adj]).filter((a) => !this.hold || a.room !== this.hold.room);
      let h = null;
      for (const a of opts) {
        const ents = entrancesOf(this.match.map, a.room).filter((e) => !e.kind.startsWith('hatch') && !(Math.abs(e.x - a.via.x) < 0.1 && Math.abs(e.z - a.via.z) < 0.1));
        if (!ents.length) continue;
        const e = rng.pick(ents);
        h = holdPointFor(this.sq.nav, this.game.world, a.room, e, plan.holds, rng);
        if (h) { h.room = a.room; break; }
      }
      if (!h) { this.role = 'anchor'; this.hold = null; return; }
      h.until = now + 18 + rng.next() * 22;
      this.hold = h;
    }
    this._holdAt(dt, this.hold);
  }
  _atHold() { const h = this.hold, p = this.op.body.pos; return h && Math.hypot(h.x - p.x, h.z - p.z) < 0.8; }

  // Caza: ir con cuidado hacia donde se sabe que hay un enemigo.
  _tHunt(dt, T) {
    const f = this.per.freshest(3, true);
    if (f && !T.rush) T.pos = { x: f.x, y: f.y, z: f.z };
    const st = this._goto(T.pos, dt, { r: 1.2, sprint: !!T.rush && this.mover.remaining > 8, speed: T.rush ? 1 : 0.8, look: T.rush ? 'path' : 'path' });
    if (st === 'arrived' || this.game.time > T.until) { this.task = null; this.thinkT = 0; }
    if (!T.rush) this.op.intent.ads = !this.mover.mustFace;
  }

  // Retoma: ir al desactivador e inutilizarlo (el más cercano); los demás cubren.
  _tDisable(dt) {
    const M = this.match, d = M.defuser, P = d && d.plantPos;
    if (!P) { this._stand(dt); return; }
    const op = this.op, I = op.intent, p = op.body.pos;
    const dist = Math.hypot(P.x - p.x, P.z - p.z);
    // a la vista: dispararle (destruirlo cuenta como inutilizarlo)
    const ammo = op.weapons.reduce((n, w) => n + w.ammo + w.reserve, 0);
    if (d.target && d.target.alive && ammo > 0 && dist < 30 && dist > 1.5 && this._shootDefuser(dt, d.target)) return;
    const disabler = this._closestTeammateTo(P);
    if (disabler !== op && dist < 5 && Math.abs(P.y - p.y) < 1.2) {
      // cubrir al que inutiliza: mirar hacia fuera
      this._stand(dt);
      const yaw = Math.atan2(-(p.x - P.x), -(p.z - P.z));
      this._idleLook(dt, yaw);
      return;
    }
    if (dist < 1.2 && Math.abs(P.y - p.y) < 1.1) {
      this._stand(dt);
      I.interact = true;
      I.stance = 'crouch';
      this._idleLook(dt, null);
      return;
    }
    this._goto(P, dt, { r: 0.8, sprint: dist > 10 && !this._threat(), exact: true });
  }
  _shootDefuser(dt, tg) {
    const op = this.op, I = op.intent, D = this.diff;
    this.defT = (this.defT || 0) - dt;
    if (this.defT <= 0) {
      this.defT = 0.3;
      const e = op.eyePos(), c = tg.center();
      this.defSeen = lineOfSight(this.game.world, e.x, e.y, e.z, c.x, c.y, c.z);
    }
    if (!this.defSeen) return false;
    if (this.mover.busy) this.mover.stop();
    I.moveX = 0; I.moveZ = 0; I.sprint = false;
    const e = op.eyePos(), c = tg.center();
    const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, dh = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, dh);
    op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * D.turn, dt * D.turn);
    op.pitch += clamp(wantPitch - op.pitch, -dt * D.turn, dt * D.turn);
    I.ads = dh > 4;
    const tol = Math.max(0.02, Math.min(0.08, 0.2 / Math.max(1, dh)));
    if (Math.abs(angleDiff(op.yaw, wantYaw)) < tol && Math.abs(wantPitch - op.pitch) < tol * 1.3) { this.semi = op.weapon.def.auto ? true : !this.semi; I.fire = this.semi; }
    if (op.weapon.ammo === 0) I.reload = true;
    return true;
  }

  _closestTeammateTo(P) {
    let best = null, bd = Infinity;
    for (const o of this.game.operators) {
      if (o.team !== this.team || o.state !== 'alive' || !o.isBot) continue;
      const d = Math.hypot(o.body.pos.x - P.x, (o.body.pos.y - P.y) * 3, o.body.pos.z - P.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _tRevive(dt, T) {
    const t = T.who, op = this.op, I = op.intent;
    if (t.state !== 'downed') { this.task = null; this.thinkT = 0; return; }
    const p = op.body.pos, q = t.body.pos;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < 1.1 && Math.abs(q.y - p.y) < 0.8) {
      this._stand(dt);
      I.interact = true;
      this._idleLook(dt, null);
      return;
    }
    this._goto(q, dt, { r: 0.7, sprint: d > 6, exact: true });
  }

  // Ataque: correr hasta la entrada (por fuera).
  _tApproach(dt, T) {
    const e = this.entry;
    if (!e || this.inside()) { this.stage = 'clear'; this.thinkT = 0; return; }
    if (this.delay > 0) { this.delay -= dt; this._stand(dt); this._idleLook(dt, null); return; }
    const p = this.op.body.pos, at = this.stackAt || e;
    const st = this._goto(at, dt, { r: 0.6, sprint: this.mover.remaining > 6 });
    if (st === 'arrived' || Math.hypot(at.x - p.x, at.z - p.z) < 0.9) { this.stage = 'stack'; this.stackT = 0; this.thinkT = 0; }
    void T;
  }
  // Agruparse en la entrada hasta que llegue el grupo (o pase un rato).
  _tStack(dt) {
    this.stackT += dt;
    const e = this.entry;
    const group = [...this.sq.brains.values()].filter((B) => B.side === 'atk' && B.entry === e && B.op.state === 'alive');
    const ready = group.every((B) => B.stage !== 'approach');
    const wait = this.stackWait ?? 6;
    if ((ready && this.stackT > wait) || this.stackT > wait + 8 || this.match.timer < 80) { this.stage = 'clear'; this.thinkT = 0; }
    this._stand(dt);
    this.op.intent.stance = 'crouch';
    const p = this.op.body.pos;
    const yaw = Math.atan2(-(e.inside.x - p.x), -(e.inside.z - p.z));
    this._idleLook(dt, yaw);
  }
  // Entrar y avanzar hasta la sala del sitio.
  _tClear(dt, T) {
    const site = T.site;
    const room = this.match.map.rooms.find((r) => r.id === site[this.siteRoomKey || 'A']);
    const goal = site.bombs[this.siteRoomKey || 'A'];
    const inRoom = room && this.inRoom(room);
    if (inRoom && this.mover.remaining < 3) { this.stage = 'hold'; this.thinkT = 0; }
    // dentro, avanzar a saltos: unos metros y una pausa para comprobar ángulos
    if (this.inside() && this.match.timer > 50) {
      if (this.pauseT > 0) {
        this.pauseT -= dt;
        const I = this.op.intent;
        I.moveX = 0; I.moveZ = 0; I.sprint = false;
        const q = this.mover.ahead(4);
        const p = this.op.body.pos;
        this._idleLook(dt, q ? Math.atan2(-(q.x - p.x), -(q.z - p.z)) : null);
        this.op.intent.ads = true;
        return;
      }
      this.boundT = (this.boundT ?? 2) - dt;
      if (this.boundT <= 0) { this.boundT = 2 + this.rng.next() * 2.5; this.pauseT = 0.6 + this.rng.next() * 1.2; }
    }
    const st = this._goto(goal, dt, { r: 1.5, sprint: !this.inside() && this.mover.remaining > 10, speed: this.inside() ? 0.8 : 1 });
    if (st === 'arrived') { this.stage = 'hold'; this.thinkT = 0; }
    if (this.inside() && !this.mover.mustFace) this.op.intent.ads = this.rng.next() < 0.02 ? !this.op.intent.ads : this.op.ads > 0.5;
  }
  // En la sala del sitio: sostener un acceso.
  _tSiteHold(dt, T) {
    if (!this.hold) {
      if (!this._canPlan()) { this._stand(dt); this._idleLook(dt, null); return; }
      const site = T.site;
      const room = this.match.map.rooms.find((r) => r.id === site[this.siteRoomKey || 'A']);
      this.hold = room ? this._pickHoldIn(room) : null;
    }
    this._holdAt(dt, this.hold);
  }
  _pickHoldIn(room) {
    const rng = this.rng;
    const ents = rng.shuffle(entrancesOf(this.match.map, room).filter((e) => !e.kind.startsWith('hatch')));
    const taken = [...this.sq.brains.values()].filter((B) => B.team === this.team && B.hold).map((B) => B.hold);
    for (const e of ents) {
      const h = holdPointFor(this.sq.nav, this.game.world, room, e, taken, rng);
      if (h) return h;
    }
    return null;
  }

  // Portador: ir al punto de plantado más cercano del sitio y mantener F.
  _tPlant(dt) {
    const M = this.match, site = M.site, op = this.op, I = op.intent, p = op.body.pos;
    if (!this.plantAt) {
      const A = site.bombs.A, B = site.bombs.B;
      const dA = Math.hypot(A.x - p.x, (A.y - p.y) * 3, A.z - p.z), dB = Math.hypot(B.x - p.x, (B.y - p.y) * 3, B.z - p.z);
      this.plantAt = dA <= dB ? A : B;
    }
    const inSite = M.siteAt(p.x, p.y, p.z) !== null;
    const d = Math.hypot(this.plantAt.x - p.x, this.plantAt.z - p.z);
    if (inSite && (d < 1.6 || (this.mover.status === 'arrived'))) {
      this._stand(dt);
      I.interact = true;
      I.stance = 'crouch';
      this._idleLook(dt, null);
      return;
    }
    this._goto(this.plantAt, dt, { r: 1.0, sprint: !this.inside() && this.mover.remaining > 10 });
  }

  // Tras plantar: defender el desactivador desde un punto de la sala.
  _tGuard(dt) {
    const M = this.match, P = M.defuser && M.defuser.plantPos;
    if (!P) { this._stand(dt); return; }
    if (!this.hold) {
      if (!this._canPlan()) { this._stand(dt); this._idleLook(dt, null); return; }
      const room = M.map.rooms.find((r) => P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1 && Math.abs(P.y - r.floorY) < 1);
      this.hold = room ? this._pickHoldIn(room) : null;
      if (!this.hold) this.hold = { x: P.x, y: P.y, z: P.z, yaw: this.op.yaw, crouch: true };
    }
    this._holdAt(dt, this.hold);
  }

  _tPickup(dt) {
    const d = this.match.defuser;
    if (!d || !d.pos) { this.task = null; this.thinkT = 0; return; }
    const p = this.op.body.pos;
    // al llegar, recogerlo con F
    if (Math.hypot(d.pos.x - p.x, d.pos.z - p.z) < this.match.rules.pickupRange * 0.9 && Math.abs(d.pos.y - p.y) < 1.1) {
      this._stand(dt);
      this.op.intent.interact = true;
      this._idleLook(dt, null);
      return;
    }
    this._goto(d.pos, dt, { r: 0.5, sprint: this.mover.remaining > 6 && !this._threat(), exact: true });
  }

  inside() {
    const p = this.op.body.pos;
    return !!this.match.map.builder.roomAt(p.x, p.y + 0.2, p.z);
  }
  inRoom(r) {
    const p = this.op.body.pos;
    return p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1 && Math.abs(p.y - r.floorY) < 1.2;
  }

  // ------------------------------------------------------------------ dron (preparación)
  _droneTick(dt) {
    const recon = this.match.recon;
    const d = recon ? recon.droneOf(this.op) : null;
    if (!d || d.pilot) return;                   // sin dron o lo maneja el jugador
    if (!this.dm || this.dm.drone !== d) this.dm = { drone: d, mover: new Mover(d, this.sq.nav, { drone: true }), markT: 0.4, mark: null, scanT: 0, waitT: 0, goal: null, watchT: 0, fleeT: 0, fleeDir: 1, flees: 0 };
    const S = this.dm, I = d.intent, M = this.match;
    I.moveX = 0; I.moveZ = 0;
    S.markT -= dt;
    // marcar defensores visibles
    if (S.markT <= 0) {
      S.markT = 0.35;
      const e = d.eyePos();
      let tgt = null, bd = 22;
      for (const t of this.game.operators) {
        if (t.team === this.team || t.state === 'dead' || t.frozen || recon.isSpottedFor(t, this.team)) continue;
        const c = t.center();
        const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
        if (dist > bd || !lineOfSight(this.game.world, e.x, e.y, e.z, c.x, c.y, c.z)) continue;
        bd = dist; tgt = t;
      }
      S.mark = tgt;
    }
    if (S.mark && S.mark.state !== 'dead') {
      const e = d.eyePos(), c = S.mark.center();
      const want = Math.atan2(-(c.x - e.x), -(c.z - e.z));
      d.yaw += clamp(angleDiff(d.yaw, want), -dt * 3, dt * 3);
      d.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
      if (Math.abs(angleDiff(d.yaw, want)) < 0.05) { I.mark = true; S.mark = null; }
      return;
    }
    d.pitch += (-0.05 - d.pitch) * Math.min(1, dt * 3);
    // un defensor lo está mirando de cerca: apartarse un momento (y volver a intentarlo)
    S.watchT -= dt;
    // (como mucho dos veces: después sigue adelante aunque le vean)
    if (S.watchT <= 0) { S.watchT = 0.3; if (!S.fleeT && S.flees < 2 && this._droneWatched(d)) { S.flees++; S.fleeT = 1.4; S.fleeDir = this.rng.next() < 0.5 ? -1 : 1; } }
    if (S.fleeT > 0) {
      S.fleeT -= dt;
      I.moveZ = -1; I.moveX = S.fleeDir * 0.4;
      if (S.fleeT <= 0) { S.fleeT = 0; S.goal = null; }
      return;
    }
    // objetivo: su punto de plantado; si el objetivo ya se ha encontrado, ir allí
    let g = this.droneGoal;
    if (M.recon.objectiveFound && g && g.site !== M.site) g = this.droneGoal = { site: M.site, k: this.rng.next() < 0.5 ? 'A' : 'B' };
    if (!g) return;
    const goal = g.site.bombs[g.k];
    // con el objetivo localizado, aparcar cerca (quieto no se oye) y vigilar
    const pp = d.body.pos;
    if (M.recon.objectiveFound && Math.hypot(goal.x - pp.x, goal.z - pp.z) < 7 && Math.abs(goal.y - pp.y) < 1.5) {
      S.mover.stop();
      d.yaw += dt * 0.5;
      return;
    }
    if (S.goal !== goal) { S.goal = goal; S.mover.go(goal, { r: 1.2 }); }
    const st = S.mover.update(dt);
    const near = Math.hypot(goal.x - pp.x, goal.z - pp.z) < 3 && Math.abs(goal.y - pp.y) < 1.5;
    if (st === 'arrived' || st === 'failed' || near) {
      // aquí no está el objetivo (si estuviera, ya se habría visto): a otra ubicación sin revisar
      d.yaw += dt * 0.9;
      S.waitT += dt;
      if (!M.recon.objectiveFound && (st !== 'failed' || S.waitT > 3)) {
        const map = M.map, checked = this.sq.droneChecked;
        checked.add(map.sites.indexOf(g.site));
        let best = null, bd = Infinity;
        for (const site of map.sites) {
          if (checked.has(map.sites.indexOf(site))) continue;
          for (const k of ['A', 'B']) {
            const b = site.bombs[k];
            const dist = Math.hypot(b.x - pp.x, b.z - pp.z) + Math.abs(b.y - pp.y) * 4;
            if (dist < bd) { bd = dist; best = { site, k }; }
          }
        }
        if (best) { this.droneGoal = best; S.waitT = 0; return; }
      }
      if (S.waitT > 5) { S.waitT = 0; this.droneGoal = { site: g.site, k: g.k === 'A' ? 'B' : 'A' }; }
      return;
    }
    if (S.mover.wantYaw !== null) d.yaw += clamp(angleDiff(d.yaw, S.mover.wantYaw), -dt * 4, dt * 4);
  }
  // ¿Algún defensor mira hacia el dron desde cerca (y lo ve)?
  _droneWatched(d) {
    const c = d.center(), w = this.game.world;
    for (const t of this.game.operators) {
      if (t.team === this.team || t.state !== 'alive' || t.frozen) continue;
      const e = t.eyePos();
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, dist = Math.hypot(dx, dy, dz);
      if (dist > 7) continue;
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      if ((dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz)) < 0.8) continue;
      if (lineOfSight(w, e.x, e.y, e.z, c.x, c.y + 0.05, c.z)) return true;
    }
    return false;
  }
}

// ====================================================================== utilidades
function aimPoint(t, head) {
  const r = t.rig;
  if (head && r[BONE.head]) { const h = r[BONE.head].p; return { x: h.x, y: h.y + 0.08, z: h.z }; }
  if (r[BONE.chest]) { const c = r[BONE.chest].p; return { x: c.x, y: c.y + 0.08, z: c.z }; }
  const b = t.body.pos;
  return { x: b.x, y: b.y + 1.1, z: b.z };
}

function siteCenter(map, site) {
  const a = site.bombs.A, b = site.bombs.B;
  return { x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 };
}

// Potencia con la que llega una bala de `a` a `b` atravesando lo que haya (0 = no pasa).
export function penetration(world, a, b, penScale = 2) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return 1;
  let p = 1;
  traverse(world, a.x, a.y, a.z, dx / len, dy / len, dz / len, len, (x, y, z, t, face, mat) => {
    if (!SOLID[mat] || face === -1) return false;
    if (HARD[mat]) { p = 0; return true; }
    p -= PEN_COST[mat] * penScale;
    if (p <= 0) { p = 0; return true; }
    return false;
  });
  return p;
}

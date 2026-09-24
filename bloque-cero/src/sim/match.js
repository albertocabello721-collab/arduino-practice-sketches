// Partida 5 contra 5 por rondas (reglas de Siege). Sin DOM ni render: corre igual
// en el navegador que en los tests de Node.
//
// Ronda: selección (operador, ubicación de la defensa, punto de entrada del ataque)
//   → preparación 45 s (el ataque no puede moverse; en la Fase 4, drones)
//   → acción 3:00 → [desactivador plantado: 45 s] → fin de ronda → siguiente.
// Gana la ronda:
//   ataque  · todos los defensores eliminados o derribados
//           · el desactivador completa sus 45 s
//   defensa · todos los atacantes eliminados o derribados antes de plantar
//           · se agota el tiempo sin plantar
//           · inutiliza el desactivador (7 s manteniendo F junto a él)
// Tras plantar, eliminar al ataque no basta: hay que inutilizar el desactivador.
// Gana la partida el primer equipo con 4 rondas; se cambia de bando cada 3.
import { Emitter } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { Game } from './game.js';
import { Operator } from './operator.js';
import { OP_BY_ID, opsForSide } from './operators.js';
import { boxFree } from './physics.js';
import { SOLID } from '../world/materials.js';

export const RULES = {
  selectTime: 25,     // selección de operador
  prepTime: 45,       // fase de preparación
  actionTime: 180,    // fase de acción
  plantTime: 7,       // plantar el desactivador
  fuseTime: 45,       // el desactivador necesita 45 s para completarse
  disableTime: 7,     // inutilizarlo
  roundEndTime: 7,    // pausa entre rondas
  roundsToWin: 4,
  swapEvery: 3,
  pickupRange: 1.1,
  disableRange: 1.8,
};

export const SCORE = { kill: 100, headshot: 25, down: 50, assist: 50, revive: 50, plant: 100, disable: 100, roundWin: 60, survive: 20 };

export const END_REASON = {
  defendersDown: 'Defensores eliminados',
  attackersDown: 'Atacantes eliminados',
  timeUp: 'Tiempo agotado',
  defused: 'Desactivador completado',
  disabled: 'Desactivador inutilizado',
};

export const otherSide = (s) => (s === 'atk' ? 'def' : 'atk');
const newStats = () => ({ score: 0, kills: 0, deaths: 0, assists: 0, headshots: 0, downs: 0, revives: 0, plants: 0, disables: 0, damage: 0, roundsSurvived: 0 });

export class Match extends Emitter {
  /**
   * @param {object} o
   * @param {boolean} [o.human=true]  ¿hay jugador humano? (ocupa la ranura 0 del equipo 0)
   * @param {'atk'|'def'} [o.startSide='atk']  bando del equipo 0 en la ronda 1
   */
  constructor({ world, map, seed = 1, rules = {}, human = true, startSide = 'atk', humanName = 'Tú' }) {
    super();
    this.world = world;
    this.map = map;
    this.rules = { ...RULES, ...rules };
    this.rng = new RNG((seed * 2654435761) >>> 0);
    this.game = new Game({ world, map, seed });
    this.startSide = startSide;
    this.teams = [{ id: 0, score: 0 }, { id: 1, score: 0 }];
    this.slots = [];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 5; i++) {
        const isHuman = human && t === 0 && i === 0;
        this.slots.push({ key: `t${t}s${i}`, team: t, index: i, human: isHuman, humanName: isHuman ? humanName : null, opId: null, primary: 0, secondary: 0, spawn: 0, stats: newStats(), op: null, ready: !isHuman });
      }
    }
    this.round = 0;
    this.phase = 'idle';     // idle | select | prep | action | planted | roundEnd | matchEnd
    this.timer = 0;
    this.location = null;    // índice en map.sites elegido por la defensa
    this.locationVotes = {};
    this.defuser = null;
    this.plant = null;       // plantado en curso {op, t, site}
    this.disable = null;     // inutilización en curso {op, t}
    this.history = [];
    this.lastResult = null;
    this.winner = null;
    this.time = 0;
    this._bindGame();
  }

  // ------------------------------------------------------------------ consultas
  sideOf(team, round = this.round) {
    const swapped = Math.floor((Math.max(1, round) - 1) / this.rules.swapEvery) % 2 === 1;
    const s0 = swapped ? otherSide(this.startSide) : this.startSide;
    return team === 0 ? s0 : otherSide(s0);
  }
  teamOfSide(side) { return this.sideOf(0) === side ? 0 : 1; }
  get humanSlot() { return this.slots.find((s) => s.human) || null; }
  get player() { const s = this.humanSlot; return s ? s.op : null; }
  slotsOf(team) { return this.slots.filter((s) => s.team === team); }
  opsOfSide(side) { const t = this.teamOfSide(side); return this.game.operators.filter((o) => o.team === t); }
  aliveCount(side) { let n = 0; for (const o of this.opsOfSide(side)) if (o.state === 'alive') n++; return n; }
  get site() { return this.location === null ? null : this.map.sites[this.location]; }
  // ¿En qué sitio (A/B) de la ubicación activa está el punto? (null si en ninguno)
  siteAt(x, y, z) {
    const s = this.site;
    if (!s) return null;
    const r = this.map.roomAt(x, y + 0.2, z);
    if (!r) return null;
    if (r.id === s.A) return 'A';
    if (r.id === s.B) return 'B';
    return null;
  }
  roomsOfSite(which) { const s = this.site; return s ? this.map.rooms.find((r) => r.id === s[which]) : null; }
  get timeLeft() { return Math.max(0, this.timer); }
  get running() { return this.phase === 'prep' || this.phase === 'action' || this.phase === 'planted' || this.phase === 'roundEnd'; }

  // Operadores ocupados por el equipo (únicos por equipo, como en Siege).
  takenOps(team, except = null) { const s = new Set(); for (const sl of this.slotsOf(team)) if (sl !== except && sl.opId) s.add(sl.opId); return s; }

  // ------------------------------------------------------------------ flujo
  start() {
    this.round = 0;
    this.teams[0].score = 0; this.teams[1].score = 0;
    this.history = [];
    for (const s of this.slots) s.stats = newStats();
    this.winner = null;
    this._nextRound();
  }

  _nextRound() {
    this.round++;
    this.phase = 'select';
    this.timer = this.rules.selectTime;
    this.location = null;
    this.locationVotes = {};
    this.defuser = null;
    this.plant = null;
    this.disable = null;
    this.lastResult = null;
    this.world.resetToPristine();
    this.game.operators.length = 0;
    for (const s of this.slots) { s.op = null; s.ready = !s.human; }
    // cada bot mantiene su operador si sigue siendo del bando; si no, elige otro libre
    for (const s of this.slots) {
      const side = this.sideOf(s.team);
      if (s.opId && OP_BY_ID[s.opId].side !== side) s.opId = null;
    }
    for (const s of this.slots) {
      if (s.human || s.opId) continue;
      this._botPick(s);
    }
    // puntos de entrada de los atacantes bot
    for (const s of this.slots) if (!s.human) s.spawn = this.rng.int(0, this.map.attackerSpawns.length - 1);
    // si la defensa no tiene humano, los bots eligen ubicación ya
    const defTeam = this.teamOfSide('def');
    if (!this.slotsOf(defTeam).some((s) => s.human)) this.location = this.rng.int(0, this.map.sites.length - 1);
    this.emit('roundSelect', this.round);
    if (this.rules.selectTime <= 0) this._beginPrep();
  }

  _botPick(slot) {
    const side = this.sideOf(slot.team);
    const taken = this.takenOps(slot.team, slot);
    const free = opsForSide(side).filter((o) => !taken.has(o.id));
    const def = free.length ? free[this.rng.int(0, free.length - 1)] : opsForSide(side)[0];
    slot.opId = def.id;
    slot.primary = this.rng.int(0, def.primaries.length - 1);
    slot.secondary = this.rng.int(0, def.secondaries.length - 1);
  }

  /** Elección del jugador en la pantalla de selección. Devuelve false si no es válida. */
  choose(slot, { opId, primary, secondary, spawn, location } = {}) {
    if (this.phase !== 'select') return false;
    const side = this.sideOf(slot.team);
    if (opId !== undefined) {
      const def = OP_BY_ID[opId];
      if (!def || def.side !== side) return false;
      // si un compañero bot lo tenía, cambia a otro (el jugador manda)
      const holder = this.slotsOf(slot.team).find((s) => s !== slot && s.opId === opId);
      slot.opId = opId;
      slot.primary = 0; slot.secondary = 0;
      if (holder) { if (holder.human) return false; holder.opId = null; this._botPick(holder); }
    }
    const def = slot.opId ? OP_BY_ID[slot.opId] : null;
    if (def && primary !== undefined) slot.primary = Math.max(0, Math.min(def.primaries.length - 1, primary));
    if (def && secondary !== undefined) slot.secondary = Math.max(0, Math.min(def.secondaries.length - 1, secondary));
    if (spawn !== undefined && side === 'atk') slot.spawn = Math.max(0, Math.min(this.map.attackerSpawns.length - 1, spawn));
    if (location !== undefined && side === 'def') {
      this.locationVotes[slot.key] = location;
      this.location = location;   // los compañeros bot siguen la elección del jugador
    }
    this.emit('selectChanged', slot);
    return true;
  }
  setReady(slot, v = true) {
    if (this.phase !== 'select') return;
    slot.ready = v;
    if (this.slots.every((s) => s.ready)) this.timer = Math.min(this.timer, 0.6);
  }

  _beginPrep() {
    // completar lo que falte
    for (const s of this.slots) if (!s.opId) this._botPick(s);
    if (this.location === null) this.location = this.rng.int(0, this.map.sites.length - 1);
    this._spawnAll();
    this.phase = 'prep';
    this.timer = this.rules.prepTime;
    // el desactivador: al jugador si ataca; si no, a un atacante al azar
    const atk = this.opsOfSide('atk');
    const human = atk.find((o) => o.slot.human);
    const carrier = human || atk[this.rng.int(0, atk.length - 1)];
    this.defuser = { carrier, pos: null, planted: false, site: null, plantPos: null, fuse: 0 };
    this.emit('roundStart', this.round);
    if (this.rules.prepTime <= 0) this._beginAction();
  }

  _beginAction() {
    this.phase = 'action';
    this.timer = this.rules.actionTime;
    for (const op of this.game.operators) op.frozen = false;
    this.emit('action', this.round);
  }

  // ------------------------------------------------------------------ aparición
  _spawnAll() {
    const g = this.game;
    g.operators.length = 0;
    const site = this.site;
    const defTeam = this.teamOfSide('def'), atkTeam = 1 - defTeam;
    const defSlots = this.slotsOf(defTeam), atkSlots = this.slotsOf(atkTeam);
    const roomA = this.map.rooms.find((r) => r.id === site.A), roomB = this.map.rooms.find((r) => r.id === site.B);
    const pts = spawnPointsInRooms(this.world, [roomA, roomB], defSlots.length, this.rng);
    defSlots.forEach((s, i) => {
      const p = pts[i % pts.length];
      this._spawnSlot(s, 'def', p.x, p.y, p.z, p.yaw);
    });
    // atacantes: en fila en su punto de entrada
    const bySpawn = {};
    for (const s of atkSlots) {
      const sp = this.map.attackerSpawns[s.spawn] || this.map.attackerSpawns[0];
      const k = bySpawn[sp.id] = (bySpawn[sp.id] || 0) + 1;
      const off = [0, 1.3, -1.3, 2.6, -2.6][k - 1] || 0;
      const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw);
      const p = findFreeSpot(this.world, sp.x + rx * off, sp.y, sp.z + rz * off) || { x: sp.x, y: sp.y, z: sp.z };
      this._spawnSlot(s, 'atk', p.x, p.y, p.z, sp.yaw);
    }
  }

  _spawnSlot(slot, side, x, y, z, yaw) {
    const def = OP_BY_ID[slot.opId];
    const op = new Operator(`${slot.key}r${this.round}`, {
      name: def.name, team: slot.team, x, y, z, yaw, armor: def.armor, bot: !slot.human,
      loadout: [def.primaries[slot.primary] || def.primaries[0], def.secondaries[slot.secondary] || def.secondaries[0]],
      meta: { opId: def.id },
    });
    op.slot = slot;
    op.side = side;
    op.opDef = def;
    op.frozen = side === 'atk';
    slot.op = op;
    this.game.addOperator(op);
    return op;
  }

  // ------------------------------------------------------------------ tick
  tick(dt) {
    this.time += dt;
    if (this.phase === 'idle' || this.phase === 'matchEnd') return;
    if (this.phase === 'select') {
      this.timer -= dt;
      if (this.timer <= 0) this._beginPrep();
      return;
    }
    this.game.tick(dt);
    if (this.phase === 'roundEnd') {
      this.timer -= dt;
      if (this.timer <= 0) this._afterRound();
      return;
    }
    if (this.phase === 'prep') {
      this.timer -= dt;
      if (this._checkElimination()) return;
      if (this.timer <= 0) this._beginAction();
      return;
    }
    if (this.phase === 'action') {
      this.timer -= dt;
      this._defuserTick(dt);
      if (this.phase !== 'action') return;   // se plantó este tick
      if (this._checkElimination()) return;
      if (this.timer <= 0) this._endRound('def', 'timeUp');
      return;
    }
    if (this.phase === 'planted') {
      this.timer -= dt;
      this.defuser.fuse = this.timer;
      this._disableTick(dt);
      if (this.phase !== 'planted') return;
      if (this.aliveCount('def') === 0) { this._endRound('atk', 'defendersDown'); return; }
      if (this.timer <= 0) this._endRound('atk', 'defused');
    }
  }

  _checkElimination() {
    const a = this.aliveCount('atk'), d = this.aliveCount('def');
    if (d === 0) { this._endRound(a === 0 ? 'def' : 'atk', a === 0 ? 'attackersDown' : 'defendersDown'); return true; }
    if (a === 0) { this._endRound('def', 'attackersDown'); return true; }
    return false;
  }

  _defuserTick(dt) {
    const d = this.defuser;
    if (!d || d.planted) return;
    // caída al morir el portador; recogida automática por otro atacante
    if (d.carrier && d.carrier.state === 'dead') {
      const p = d.carrier.body.pos;
      d.pos = { x: p.x, y: p.y, z: p.z };
      const was = d.carrier;
      d.carrier = null;
      this._cancelPlant();
      this.emit('defuserDropped', was, d.pos);
    }
    if (!d.carrier && d.pos) {
      for (const op of this.opsOfSide('atk')) {
        if (op.state !== 'alive') continue;
        const b = op.body.pos;
        if (Math.hypot(b.x - d.pos.x, b.z - d.pos.z) < this.rules.pickupRange && Math.abs(b.y - d.pos.y) < 1.2) {
          d.carrier = op; d.pos = null;
          this.emit('defuserPicked', op);
          break;
        }
      }
    }
    // plantar: el portador, dentro de un sitio, manteniendo F
    const c = d.carrier;
    const b = c ? c.body.pos : null;
    const site = c ? this.siteAt(b.x, b.y, b.z) : null;
    const wants = c && c.state === 'alive' && c.intent.interact && !c.reviving && !c.vault && site && c.body.onGround;
    if (!wants) { this._cancelPlant(); return; }
    if (!this.plant || this.plant.op !== c) {
      this._cancelPlant();
      this.plant = { op: c, t: 0, site };
      c.channel = { kind: 'plant', t: 0, total: this.rules.plantTime };
      this.emit('plantStart', c, site);
    }
    this.plant.t += dt;
    c.channel.t = this.plant.t;
    if (this.plant.t >= this.rules.plantTime) {
      d.planted = true;
      d.site = site;
      d.plantPos = { x: b.x, y: b.y, z: b.z };
      d.carrier = null;
      c.channel = null;
      c.slot.stats.plants++;
      c.slot.stats.score += SCORE.plant;
      this.plant = null;
      this.phase = 'planted';
      this.timer = this.rules.fuseTime;
      d.fuse = this.timer;
      this.emit('planted', c, site, d.plantPos);
    }
  }
  _cancelPlant() {
    if (!this.plant) return;
    const op = this.plant.op;
    if (op.channel && op.channel.kind === 'plant') op.channel = null;
    this.plant = null;
    this.emit('plantCancel', op);
  }

  _disableTick(dt) {
    const d = this.defuser, P = d.plantPos, R = this.rules.disableRange;
    let who = this.disable ? this.disable.op : null;
    const ok = (op) => op && op.state === 'alive' && op.intent.interact && !op.reviving && !op.vault &&
      Math.hypot(op.body.pos.x - P.x, op.body.pos.z - P.z) < R && Math.abs(op.body.pos.y - P.y) < 1.2;
    if (!ok(who)) {
      if (this.disable) this._cancelDisable();
      who = this.opsOfSide('def').find(ok) || null;
      if (!who) return;
      this.disable = { op: who, t: 0 };
      who.channel = { kind: 'disable', t: 0, total: this.rules.disableTime };
      this.emit('disableStart', who);
    }
    this.disable.t += dt;
    who.channel.t = this.disable.t;
    if (this.disable.t >= this.rules.disableTime) {
      who.channel = null;
      who.slot.stats.disables++;
      who.slot.stats.score += SCORE.disable;
      this.disable = null;
      this.emit('disabled', who);
      this._endRound('def', 'disabled');
    }
  }
  _cancelDisable() {
    const op = this.disable.op;
    if (op.channel && op.channel.kind === 'disable') op.channel = null;
    this.disable = null;
    this.emit('disableCancel', op);
  }

  _endRound(winSide, code) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    if (this.plant) this._cancelPlant();
    if (this.disable) this._cancelDisable();
    const winner = this.teamOfSide(winSide);
    this.teams[winner].score++;
    for (const op of this.game.operators) {
      const s = op.slot;
      if (!s) continue;
      if (op.team === winner) s.stats.score += SCORE.roundWin;
      if (op.state === 'alive') { s.stats.roundsSurvived++; s.stats.score += SCORE.survive; }
      op.channel = null;
    }
    const res = { round: this.round, winner, winSide, code, reason: END_REASON[code], location: this.location, score: [this.teams[0].score, this.teams[1].score] };
    this.history.push(res);
    this.lastResult = res;
    this.phase = 'roundEnd';
    this.timer = this.rules.roundEndTime;
    this.emit('roundEnd', res);
  }

  _afterRound() {
    const w = this.teams.findIndex((t) => t.score >= this.rules.roundsToWin);
    if (w >= 0) {
      this.phase = 'matchEnd';
      this.winner = w;
      this.emit('matchEnd', { winner: w, mvp: this.mvp(), score: [this.teams[0].score, this.teams[1].score] });
      return;
    }
    this._nextRound();
  }

  mvp() {
    let best = null;
    for (const s of this.slots) if (!best || s.stats.score > best.stats.score || (s.stats.score === best.stats.score && s.stats.kills > best.stats.kills)) best = s;
    return best;
  }

  // ------------------------------------------------------------------ estadísticas
  _bindGame() {
    const g = this.game;
    g.on('damaged', (target, ev) => {
      if (!ev.by || ev.by === target || !target.slot) return;
      const c = target.contrib || (target.contrib = new Map());
      c.set(ev.by, (c.get(ev.by) || 0) + ev.amount);
      if (ev.by.slot) ev.by.slot.stats.damage += Math.min(ev.amount, Math.max(0, target.hp + ev.amount));
    });
    g.on('downed', (target, ev) => {
      if (ev.by && ev.by.slot && ev.by.team !== target.team) { ev.by.slot.stats.downs++; ev.by.slot.stats.score += SCORE.down; }
    });
    g.on('killed', (target, ev) => {
      if (target.slot) target.slot.stats.deaths++;
      const by = ev.by;
      if (by && by !== target && by.slot && by.team !== target.team) {
        by.slot.stats.kills++;
        by.slot.stats.score += SCORE.kill + (ev.headshot ? SCORE.headshot : 0);
        if (ev.headshot) by.slot.stats.headshots++;
      }
      if (target.contrib) {
        for (const [op, dmg] of target.contrib) {
          if (op === by || !op.slot || op.team === target.team || dmg <= 0) continue;
          op.slot.stats.assists++;
          op.slot.stats.score += SCORE.assist;
        }
      }
      // el portador del desactivador lo suelta al morir (se resuelve en el tick)
    });
    g.on('revived', (target, by) => { if (by && by.slot) { by.slot.stats.revives++; by.slot.stats.score += SCORE.revive; } });
  }

  // Estado de los 10 retratos para el HUD.
  portraits() {
    const out = [[], []];
    for (const s of this.slots) {
      const op = s.op;
      out[s.team].push({ slot: s, opId: s.opId, state: op ? op.state : 'none', human: s.human, carrier: !!(this.defuser && this.defuser.carrier && this.defuser.carrier === op) });
    }
    return out;
  }
}

// ---------------------------------------------------------------------- utilidades de aparición
// Altura del suelo bajo (x, z) cerca de y (o null si no hay apoyo).
export function groundAt(world, x, z, y) {
  for (let yy = y + 0.75; yy > y - 1.5; yy -= 0.125) {
    if (SOLID[world.getWorld(x, yy - 0.0625, z)] && !SOLID[world.getWorld(x, yy + 0.0625, z)]) return Math.round(yy * 8) / 8;
  }
  return null;
}

// Hueco libre para un operador de pie cerca de (x, y, z), buscando en espiral.
export function findFreeSpot(world, x, y, z, maxR = 3) {
  for (let r = 0; r <= maxR; r += 0.25) {
    const n = r === 0 ? 1 : Math.ceil(r * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const gy = groundAt(world, px, pz, y);
      if (gy === null) continue;
      if (boxFree(world, px, gy + 0.02, pz, 0.34, 1.82)) return { x: px, y: gy + 0.01, z: pz };
    }
  }
  return null;
}

// Puntos de aparición repartidos entre salas (muestreo del más lejano).
export function spawnPointsInRooms(world, rooms, count, rng) {
  const cands = [];
  for (let ri = 0; ri < rooms.length; ri++) {
    const r = rooms[ri];
    if (!r) continue;
    for (let x = r.x0 + 0.8; x <= r.x1 - 0.8; x += 0.5) {
      for (let z = r.z0 + 0.8; z <= r.z1 - 0.8; z += 0.5) {
        const gy = groundAt(world, x, z, r.floorY);
        if (gy === null || Math.abs(gy - r.floorY) > 0.3) continue;
        if (!boxFree(world, x, gy + 0.02, z, 0.42, 1.85)) continue;
        cands.push({ x, y: gy + 0.01, z, room: ri, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2 });
      }
    }
  }
  if (!cands.length) return [{ x: rooms[0].x0 + 1, y: rooms[0].floorY, z: rooms[0].z0 + 1, yaw: 0 }];
  const out = [];
  // alternar salas: A, B, A, B, A
  for (let i = 0; i < count; i++) {
    const want = i % rooms.length;
    let pool = cands.filter((c) => c.room === want);
    if (!pool.length) pool = cands;
    let best = null, bestD = -1;
    for (let k = 0; k < 24; k++) {
      const c = pool[rng.int(0, pool.length - 1)];
      let d = Infinity;
      for (const o of out) d = Math.min(d, (o.x - c.x) ** 2 + (o.z - c.z) ** 2);
      if (!out.length) d = rng.next();
      if (d > bestD) { bestD = d; best = c; }
    }
    // mirar hacia el centro de la sala (con algo de variación)
    const yaw = Math.atan2(-(best.cx - best.x), -(best.cz - best.z)) + (rng.next() - 0.5) * 0.8;
    out.push({ x: best.x, y: best.y, z: best.z, yaw });
  }
  return out;
}

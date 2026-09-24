// Seguidor de rutas para bots (y drones): pide un camino a la rejilla de navegación
// (se calcula por partes, sin tirones) y escribe las intenciones de movimiento: hacia
// dónde andar, correr, agacharse, saltar obstáculos, romper barricadas a golpes y
// subir escaleras de mano. Suaviza la ruta sobre la marcha: desde donde está, va en
// línea recta al punto más lejano al que se puede llegar sin tropezar. No decide
// hacia dónde mira el bot (eso lo hace el cerebro: puede mirar a un lado y andar
// hacia otro), salvo cuando hace falta encarar algo (escalera, barricada).
import { angleDiff, clamp } from '../../core/math.js';
import { MAT, SOLID, MELEE, HARD } from '../../world/materials.js';
import { raycastFirst } from '../../world/raycast.js';

const LOOKAHEAD = 8;

export class Mover {
  constructor(op, nav, { drone = false } = {}) {
    this.op = op;
    this.nav = nav;
    this.drone = drone;
    this.goal = null;
    this.path = null;
    this.job = null;
    this.i = 0;
    this.status = 'idle';        // idle | planning | moving | arrived | failed
    this.stuckT = 0;
    this.best = Infinity;
    this.repaths = 0;
    this.breakT = 0;
    this.woodT = 0;
    this._aim = null;
    this.misses = 0;
    this.noBreakUntil = -1;
    this.wiggle = 0;
    this.wiggleT = 0;
    this.wantYaw = null;         // hacia dónde conviene mirar para avanzar
    this.mustFace = false;       // escalera de mano o barricada: hay que mirar hacia allí
    this.pitchWant = 0;
    this.arriveR = 0.45;
    this.navVersion = -1;
    this.opts = {};
    this.clock = 0;
    this.failAt = -9;
    this.pending = null;         // ruta nueva que se calcula mientras se sigue la vieja (keepPath)
    this.pendingGoal = null;
  }

  /**
   * Ir a `goal` ({x,y,z}). Opciones: `r` radio de llegada, `avoid(node)` coste extra,
   * `noBreak` (no romper barricadas), `keepPath` (perseguir algo que se mueve: sigue por
   * la ruta actual mientras se calcula la nueva). Si ya va hacia ese punto, no replanifica.
   */
  go(goal, opts = {}) {
    if (this.pending && Math.hypot(goal.x - this.pendingGoal.x, (goal.y - this.pendingGoal.y) * 2, goal.z - this.pendingGoal.z) < (opts.same ?? 0.4)) return this.status;
    if (this.goal && this.status !== 'idle') {
      const d = Math.hypot(goal.x - this.goal.x, (goal.y - this.goal.y) * 2, goal.z - this.goal.z);
      if (d < (opts.same ?? 0.4)) {
        if (this.status === 'moving' || this.status === 'planning') return this.status;
        // sin ruta hace poco: no insistir en cada tick (cada búsqueda fallida es cara)
        if (this.status === 'failed' && this.clock - this.failAt < 2.5) return this.status;
        // llegó, pero luego se ha apartado (combate, empujones): volver
        const p = this.op.body.pos;
        if (this.status === 'arrived' && Math.hypot(p.x - goal.x, p.z - goal.z) < this.arriveR + 0.6 && Math.abs(p.y - goal.y) < 1.2) return this.status;
      }
    }
    // (los drones no rompen barricadas: si no hay camino, van lo más cerca posible)
    const o = { avoid: opts.avoid || null, noBreak: !!opts.noBreak || this.drone, noLadder: this.drone, breakCost: opts.breakCost || 0, partial: !!opts.partial || this.drone };
    if (opts.keepPath && this.status === 'moving' && this.path) {
      if (this.pending) this.nav.cancel(this.pending);
      const p = this.op.body.pos;
      this.pendingGoal = { x: goal.x, y: goal.y, z: goal.z };
      this.pendingR = opts.r ?? 0.45;
      this.opts = o;
      this.pending = this.nav.request({ x: p.x, y: p.y, z: p.z }, this.pendingGoal, { ...o, raw: true });
      return this.status;
    }
    this.goal = { x: goal.x, y: goal.y, z: goal.z };
    this.arriveR = opts.r ?? 0.45;
    this.opts = o;
    this.repaths = 0;
    this._plan();
    return this.status;
  }
  stop() {
    if (this.job) this.nav.cancel(this.job);
    if (this.pending) this.nav.cancel(this.pending);
    this.job = null; this.pending = null; this.goal = null; this.path = null; this.status = 'idle';
  }
  // Pasa la ruta pendiente (keepPath) a ser la búsqueda en curso.
  _adoptPending() {
    this.job = this.pending; this.pending = null;
    this.goal = this.pendingGoal; this.arriveR = this.pendingR;
    this.status = 'planning';
  }
  get busy() { return this.status === 'moving' || this.status === 'planning'; }

  _plan() {
    if (this.job) this.nav.cancel(this.job);
    if (this.pending) { this.nav.cancel(this.pending); this.goal = this.pendingGoal; this.arriveR = this.pendingR; this.pending = null; }
    const p = this.op.body.pos;
    this.job = this.nav.request({ x: p.x, y: p.y, z: p.z }, this.goal, { ...this.opts, raw: true });
    this.status = 'planning';
    this.stuckT = 0; this.best = Infinity;
  }

  get remaining() {
    if (!this.path) return this.goal ? Math.hypot(this.goal.x - this.op.body.pos.x, this.goal.z - this.op.body.pos.z) : 0;
    let d = 0, prev = this.op.body.pos;
    for (let k = this.i; k < this.path.length; k++) { const q = this.path[k]; d += Math.hypot(q.x - prev.x, q.z - prev.z); prev = q; }
    return d;
  }
  get next() { return this.path ? this.path[Math.min(this.i, this.path.length - 1)] : null; }
  // Punto de la ruta unos metros por delante (para mirar hacia donde se va).
  ahead(dist = 3) {
    if (!this.path) return null;
    let d = 0, prev = this.op.body.pos;
    for (let k = this.i; k < this.path.length; k++) {
      const q = this.path[k];
      d += Math.hypot(q.x - prev.x, q.z - prev.z);
      if (d >= dist) return q;
      prev = q;
    }
    return this.path[this.path.length - 1];
  }

  // Desde la posición actual, el punto más lejano (hasta LOOKAHEAD por delante) al que se va en línea recta.
  _lookahead() {
    const pts = this.path, p = this.op.body.pos;
    const from = { x: p.x, y: p.y, z: p.z };
    const maxJ = Math.min(pts.length - 1, this.i + LOOKAHEAD);
    let lastWalk = this.i;
    for (let k = this.i + 1; k <= maxJ; k++) { if (pts[k].kind !== 'walk') break; lastWalk = k; }
    for (let k = lastWalk; k > this.i; k--) {
      if (Math.abs(pts[k].y - p.y) > 0.3 && k - this.i > 3) continue;     // en escaleras, de pocos en pocos
      if (this.nav.walkable(from, pts[k], false, 0.31) === 1) { this.i = k; return; }
    }
  }

  /**
   * Escribe la intención de movimiento para avanzar. Opciones: `sprint` (permitir correr),
   * `crouch`, `lookYaw` (hacia dónde mira el bot; null = hacia donde anda), `speed` (0..1).
   */
  update(dt, { sprint = false, crouch = false, lookYaw = null, speed = 1 } = {}) {
    const op = this.op, I = op.intent, p = op.body.pos;
    this.clock += dt;
    I.moveX = 0; I.moveZ = 0;
    if (!this.drone) I.sprint = false;
    this.wantYaw = null;
    this.mustFace = false;
    // ruta nueva lista (keepPath): cambiar a ella sin pararse
    if (this.pending && this.status === 'moving' && this.pending.status !== 'queued' && this.pending.status !== 'running') {
      const j = this.pending;
      this.pending = null;
      if (j.status === 'done' && j.result) {
        this.path = j.result.points; this.goal = this.pendingGoal; this.arriveR = this.pendingR;
        this.navVersion = this.nav.version; this.i = 0; this.stuckT = 0; this.best = Infinity;
        this._lookahead();
      }
    }
    if (this.status === 'planning') {
      const j = this.job;
      if (!j || j.status === 'queued' || j.status === 'running') return this.status;
      this.job = null;
      if (j.status !== 'done' || !j.result) { this.path = null; this.status = 'failed'; this.failAt = this.clock; return this.status; }
      this.path = j.result.points;
      this.navVersion = this.nav.version;
      this.i = 0;
      this.status = 'moving';
      this._lookahead();
    }
    if (this.status !== 'moving' || !this.path) return this.status;
    // el mapa ha cambiado (destrucción, barricadas) y no avanzamos: replanificar
    if (this.nav.version !== this.navVersion && this.stuckT > 0.6) { this._plan(); return this.status; }
    const pts = this.path;
    // avanzar por los puntos alcanzados
    let advanced = false;
    while (this.i < pts.length) {
      const q = pts[this.i];
      const dh = Math.hypot(q.x - p.x, q.z - p.z);
      const last = this.i === pts.length - 1;
      const r = last ? this.arriveR : q.tight ? 0.16 : 0.38;
      if (dh < r && Math.abs(q.y - p.y) < 1.1) { this.i++; advanced = true; this.best = Infinity; this.stuckT = 0; continue; }
      break;
    }
    if (this.i >= pts.length) {
      if (this.pending) { this._adoptPending(); return this.status; }     // se acabó la vieja: esperar a la nueva
      this.status = 'arrived';
      return this.status;
    }
    if (advanced) this._lookahead();
    const q = pts[this.i];
    const dx = q.x - p.x, dz = q.z - p.z;
    const dh = Math.hypot(dx, dz);
    let dirX = dx / (dh || 1), dirZ = dz / (dh || 1);
    const faceYaw = Math.atan2(-dirX, -dirZ);
    // escalera de mano: encararla y subir
    if (q.kind === 'ladder' || (op.body.onLadder && q.y > p.y + 0.5)) { this.wantYaw = faceYaw; this.mustFace = true; }
    // barricada en medio (o restos que no dejan pasar al cuerpo): romperla a golpes,
    // apuntando a la madera que queda en el hueco
    if (!this.drone) {
      const blockedEdge = q.kind === 'break' && this.nav.walkable({ x: p.x, y: p.y, z: p.z }, q, false, 0.31) !== 1;
      let wood = null;
      if ((blockedEdge || this.stuckT > 0.4) && this.clock > this.noBreakUntil) {
        this.woodT -= dt;
        // atascado sin barricada: cualquier resto blando que estorbe al cuerpo (marcos rotos, pladur)
        if (this.woodT <= 0) { this.woodT = 0.25; this._aim = this._woodAim(dirX, dirZ) || (this.stuckT > 0.4 ? this._debrisAim(dirX, dirZ) : null); }
        wood = this._aim && this._aim.d < 1.3 ? this._aim : null;
      } else { this._aim = null; this.woodT = 0; }
      if (wood || (blockedEdge && this.clock > this.noBreakUntil)) {
        this.breakT -= dt;
        this.mustFace = true;
        this.wantYaw = wood ? wood.yaw : faceYaw;
        this.pitchWant = wood ? wood.pitch : -0.3;
        this.stuckT = Math.min(this.stuckT, 0.45);     // no replanificar mientras se rompe
        if (!wood || wood.d > 1.0) { this._steer(dirX, dirZ, lookYaw, false, speed); return this.status; }
        if (this.breakT <= 0 && Math.abs(angleDiff(op.yaw, this.wantYaw)) < 0.1 && Math.abs(op.pitch - this.pitchWant) < 0.12) {
          // solo golpear si el golpe va a dar en algo que se rompe
          const e = op.eyePos(), v = op.viewDir();
          const hit = raycastFirst(this.nav.world, e.x, e.y, e.z, v.x, v.y, v.z, 1.45, SOLID, true);
          if (hit && MELEE[hit.mat] && !HARD[hit.mat]) { I.melee = true; this.breakT = 0.85; this.misses = 0; }
          else {
            this.breakT = 0.25; this.woodT = 0;
            // no hay manera: dejar que actúe el desatasco normal (saltar, apartarse, replanificar)
            if (++this.misses > 4) { this.misses = 0; this.noBreakUntil = this.clock + 3; this._aim = null; this.stuckT = 0.6; }
          }
        }
        return this.status;
      }
    }
    if (!this.drone) I.stance = crouch || q.crouch ? 'crouch' : 'stand';
    // dron: los peldaños se suben a saltos
    else if (q.y > p.y + 0.1 && op.body.onGround && dh < 1.2) I.jump = true;
    const canSprint = sprint && !this.drone && q.kind === 'walk' && !q.crouch && this.remaining > 5;
    // desatascar: moverse un poco de lado
    if (this.wiggleT > 0) {
      this.wiggleT -= dt;
      const sx = -dirZ * this.wiggle, sz = dirX * this.wiggle;
      dirX = dirX * 0.4 + sx; dirZ = dirZ * 0.4 + sz;
    }
    this._steer(dirX, dirZ, lookYaw, canSprint, speed);
    if (lookYaw === null && !this.mustFace) this.wantYaw = faceYaw;
    // atascos: progreso hacia el punto (en una escalera de mano cuenta la altura)
    const prog = dh + Math.abs(q.y - p.y);
    // (un dron que espera para volver a saltar un peldaño no está atascado)
    const waiting = this.drone && op.jumpCd > 0 && q.y > p.y + 0.1;
    if (prog < this.best - 0.05) { this.best = prog; this.stuckT = Math.max(0, this.stuckT - dt * 2); }
    else if (!waiting) this.stuckT += dt;
    const climbing = op.body.onLadder;
    if (!climbing && this.stuckT > 0.7 && this.stuckT - dt <= 0.7) { if (this.drone) I.jump = true; else I.vault = true; }
    if (!climbing && !this.drone && this.stuckT > 1.3 && this.stuckT - dt <= 1.3) { this.wiggle = (this.op.body.pos.x * 7 + this.op.body.pos.z * 13) % 2 > 1 ? 0.9 : -0.9; this.wiggleT = 0.45; if (this.drone) I.jump = true; }
    if (this.stuckT > 2.4) {
      if (this.repaths++ < 4) this._plan();
      else { this.status = 'failed'; this.failAt = this.clock; }
    }
    return this.status;
  }

  // Madera de barricada que queda delante, a la altura por donde tiene que pasar el cuerpo:
  // devuelve {yaw, pitch, d} hacia el trozo más bajo al que llega un golpe (o null si no queda).
  _woodAim(dirX, dirZ) {
    const w = this.nav.world, p = this.op.body.pos, e = this.op.eyePos();
    const rx = -dirZ, rz = dirX;
    const cands = [];
    for (let f = 0.2; f <= 1.3; f += 0.125) {
      for (let s = -0.5; s <= 0.5; s += 0.125) {
        const x = p.x + dirX * f + rx * s, z = p.z + dirZ * f + rz * s;
        for (let y = p.y + 0.4; y <= p.y + 1.85; y += 0.125) {
          if (w.getWorld(x, y, z) === MAT.BARRICADE) cands.push({ x, y, z, k: y + Math.abs(s) * 0.5 });
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.k - b.k);
    let first = null;
    for (let i = 0; i < cands.length && i < 48; i++) {
      const c = cands[i];
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, d = Math.hypot(dx, dy, dz);
      const aim = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), d: Math.hypot(dx, dz) };
      if (!first) first = aim;
      if (d > 1.4) continue;
      const hit = raycastFirst(w, e.x, e.y, e.z, dx / d, dy / d, dz / d, 1.45, SOLID, true);
      if (hit && hit.mat === MAT.BARRICADE) return aim;
    }
    return first;
  }

  // Restos blandos (no barricada) justo delante del cuerpo, desde los pies: marcos rotos,
  // trozos de pladur… Devuelve la puntería hacia el más bajo al que llega un golpe.
  _debrisAim(dirX, dirZ) {
    const w = this.nav.world, p = this.op.body.pos, e = this.op.eyePos();
    const rx = -dirZ, rz = dirX, top = p.y + this.op.body.height;
    const cands = [];
    for (let f = 0.2; f <= 0.95; f += 0.125) {
      for (let s = -0.35; s <= 0.35; s += 0.125) {
        const x = p.x + dirX * f + rx * s, z = p.z + dirZ * f + rz * s;
        for (let y = p.y + 0.06; y <= top; y += 0.125) {
          const m = w.getWorld(x, y, z);
          if (!SOLID[m] || !MELEE[m] || HARD[m]) continue;
          cands.push({ x, y, z, k: (y - p.y) + Math.abs(s) });
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.k - b.k);
    for (let i = 0; i < cands.length && i < 40; i++) {
      const c = cands[i];
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, d = Math.hypot(dx, dy, dz);
      if (d > 1.4) continue;
      const hit = raycastFirst(w, e.x, e.y, e.z, dx / d, dy / d, dz / d, 1.45, SOLID, true);
      if (hit && MELEE[hit.mat] && !HARD[hit.mat]) return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), d: Math.hypot(dx, dz) };
    }
    return null;
  }

  // Convierte una dirección del mundo en intenciones relativas a hacia dónde mira el bot.
  _steer(dirX, dirZ, lookYaw, sprint, speed = 1) {
    const op = this.op, I = op.intent;
    const yaw = op.yaw;    // las intenciones son relativas a hacia dónde mira ahora
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mz = dirX * fx + dirZ * fz, mx = dirX * rx + dirZ * rz;
    // mirando hacia donde anda: gira el cuerpo antes de arrancar y solo entonces corre
    if (lookYaw === null || this.mustFace) {
      const want = Math.atan2(-dirX, -dirZ);
      const err = Math.abs(angleDiff(op.yaw, want));
      if (err > 1.2) { mz *= 0.25; mx *= 0.25; }
      if (!this.drone) I.sprint = sprint && err < 0.3;
    }
    I.moveZ = clamp(mz * speed, -1, 1);
    I.moveX = clamp(mx * speed, -1, 1);
  }
}

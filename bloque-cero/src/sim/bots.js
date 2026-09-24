// Bots provisionales de la Fase 3: sostienen su puesto (defensa), siguen el rastro
// del jugador (compañeros atacantes) y combaten a lo que ven con tiempo de
// reacción, error de puntería que se asienta y ráfagas. La Fase 5 los sustituye
// por la IA completa (navegación, oído, pizarra de equipo y tácticas por bando).
import { lineOfSight } from '../world/raycast.js';
import { angleDiff, clamp } from '../core/math.js';
import { BONE } from './skeleton.js';

export const DIFFICULTY = {
  recluta: { react: 0.6, aimErr: 0.11, settle: 0.9, turn: 3.2, burst: 0.28, pause: [0.55, 1.0], fov: 1.0, range: 26, head: 0.08, recoil: 0.45 },
  normal: { react: 0.36, aimErr: 0.075, settle: 0.6, turn: 4.6, burst: 0.4, pause: [0.35, 0.7], fov: 1.1, range: 34, head: 0.18, recoil: 0.62 },
  veterano: { react: 0.22, aimErr: 0.05, settle: 0.4, turn: 6.5, burst: 0.5, pause: [0.22, 0.45], fov: 1.2, range: 42, head: 0.3, recoil: 0.78 },
};

export class BotSquad {
  constructor(match, difficulty = 'normal') {
    this.match = match;
    this.game = match.game;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.trail = [];
    this.trailFor = null;
    this.brains = new Map();
    this._evShot = this.game.on('shot', (op, w, eye) => this._heard(op, eye, 22));
    this._evDmg = this.game.on('damaged', (t, ev) => { if (ev.by) this._alert(t, ev.by.body.pos, 1.5); });
  }
  dispose() { this._evShot(); this._evDmg(); }

  setDifficulty(d) { this.diff = DIFFICULTY[d] || DIFFICULTY.normal; }

  // Nueva ronda: cerebros nuevos para cada bot.
  reset() {
    this.brains.clear();
    this.trail = [];
    this.trailFor = null;
    const rng = this.game.rng;
    for (const op of this.game.operators) {
      if (!op.isBot) continue;
      op.recoilControl = this.diff.recoil;
      this.brains.set(op, {
        post: { x: op.body.pos.x, y: op.body.pos.y, z: op.body.pos.z, yaw: op.yaw },
        crouch: op.side === 'def' ? rng.next() < 0.45 : false,
        target: null, seeT: 0, react: 0, burst: 0, pause: 0, err: { x: 0, y: 0, t: -9 },
        lastSeen: null, lostT: 0, alertYaw: null, alertT: 0,
        thinkT: rng.next() * 0.1, trailIdx: 0, stuckT: 0, lastX: op.body.pos.x, lastZ: op.body.pos.z,
        followRank: 0, scanT: rng.next() * 4, scanYaw: op.yaw, semi: false, tasks: [], drone: null, dr: null,
      });
    }
    // orden de seguimiento de los atacantes
    let k = 1;
    for (const [op, B] of this.brains) if (op.side === 'atk') B.followRank = k++;
    this._planFortification();
  }

  // Reparte refuerzos (2 por bot) y barricadas de las salas del sitio entre los defensores bot.
  _planFortification() {
    const M = this.match, site = M.site;
    if (!site || !M.fort) return;
    const rooms = [site.A, site.B].map((id) => M.map.rooms.find((r) => r.id === id));
    const plan = M.fort.planFor(rooms);
    const rng = this.game.rng;
    const defs = [...this.brains].filter(([op]) => op.side === 'def');
    const roomOf = (op) => {
      const p = op.body.pos;
      const i = rooms.findIndex((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1);
      return i < 0 ? 0 : i;
    };
    const pools = [0, 1].map((ri) => ({
      reinf: rng.shuffle([...plan.hatches.filter((h) => h.room === ri), ...rng.shuffle(plan.walls.filter((w) => w.room === ri))]),
      open: rng.shuffle(plan.openings.filter((o) => o.room === ri)),
    }));
    // las trampillas primero (bloquean el ataque vertical), luego paredes al azar
    for (const pool of pools) pool.reinf.sort((a, b) => (a.kind === 'hatch' ? -1 : 0) - (b.kind === 'hatch' ? -1 : 0));
    for (const [op, B] of defs) {
      const pool = pools[roomOf(op)];
      B.tasks = [];
      for (let i = 0; i < 2 && pool.reinf.length; i++) B.tasks.push({ ...pool.reinf.shift(), t: 0, walkT: 0 });
      for (let i = 0; i < 2 && pool.open.length; i++) B.tasks.push({ ...pool.open.shift(), t: 0, walkT: 0 });
      // ordenar por cercanía para no cruzar la sala dos veces
      const p = op.body.pos;
      B.tasks.sort((a, b) => Math.hypot(a.stand.x - p.x, a.stand.z - p.z) - Math.hypot(b.stand.x - p.x, b.stand.z - p.z));
    }
  }

  _heard(src, pos, range) {
    for (const [op, B] of this.brains) {
      if (op.team === src.team || op.state !== 'alive') continue;
      const d = Math.hypot(pos.x - op.body.pos.x, pos.z - op.body.pos.z);
      if (d < range && Math.abs(pos.y - op.body.pos.y) < 4) this._alert(op, pos, 3);
    }
  }
  _alert(op, pos, secs) {
    const B = this.brains.get(op);
    if (!B || B.target) return;
    B.alertYaw = Math.atan2(-(pos.x - op.body.pos.x), -(pos.z - op.body.pos.z));
    B.alertT = secs;
  }

  // Registrar el rastro del líder humano (para que le sigan sus compañeros).
  _recordTrail(leader) {
    if (!leader || leader.state !== 'alive') return;
    if (this.trailFor !== leader) { this.trail = []; this.trailFor = leader; }
    const p = leader.body.pos;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.6 || Math.abs(p.y - last.y) > 0.5) {
      if (leader.body.onGround || leader.body.onLadder) this.trail.push({ x: p.x, y: p.y, z: p.z, ladder: leader.body.onLadder });
      if (this.trail.length > 600) this.trail.shift();
    }
  }

  update(dt) {
    const M = this.match;
    const phase = M.phase;
    const player = M.player;
    const leader = player && player.side === 'atk' && player.state === 'alive' ? player : null;
    if (leader && (phase === 'action' || phase === 'planted')) this._recordTrail(leader);
    for (const [op, B] of this.brains) {
      const I = op.intent;
      I.fire = false; I.ads = false; I.moveX = 0; I.moveZ = 0; I.sprint = false; I.lean = 0; I.interact = false; I.reload = false;
      if (op.state !== 'alive') { I.holdWound = op.state === 'downed'; continue; }
      I.stance = B.crouch ? 'crouch' : 'stand';
      if (phase !== 'prep' && phase !== 'action' && phase !== 'planted') continue;
      // percepción (cada 0,1 s, escalonada)
      B.thinkT -= dt;
      if (B.thinkT <= 0) { B.thinkT = 0.1; this._perceive(op, B); }
      if (B.target) { this._fight(op, B, dt); continue; }
      B.seeT = 0; B.react = Math.max(0, B.react - dt * 1.5);
      // atacantes en la preparación: pilotar su dron
      if (op.side === 'atk' && phase === 'prep') { this._driveDrone(op, B, dt); continue; }
      // defensores: disparar a drones a la vista
      if (op.side === 'def' && B.drone) { this._shootDrone(op, B, dt); continue; }
      // defensores: reforzar y poner barricadas (preparación y primeros segundos de acción)
      if (op.side === 'def' && B.tasks && B.tasks.length && (phase === 'prep' || phase === 'action')) { this._fortifyTask(op, B, dt); continue; }
      // recargar con calma
      if (op.weapon.ammo < op.weapon.def.mag * 0.4 && op.weapon.reserve > 0) I.reload = true;
      // compañeros de un humano: seguir su rastro
      if (op.side === 'atk' && leader && !op.frozen) { this._follow(op, B, dt); continue; }
      // defensores: reanimar compañeros derribados cercanos
      if (this._reviveNearby(op, B)) continue;
      // sostener el puesto y vigilar
      this._hold(op, B, dt);
    }
  }

  _enemiesOf(op) { return this.game.operators.filter((o) => o.team !== op.team && o.state !== 'dead' && !o.frozen); }

  _perceive(op, B) {
    const D = this.diff;
    const e = op.eyePos();
    const vx = -Math.sin(op.yaw), vz = -Math.cos(op.yaw);
    let best = null, bestScore = Infinity;
    for (const t of this._enemiesOf(op)) {
      const tp = aimPoint(t, false);
      const dx = tp.x - e.x, dy = tp.y - e.y, dz = tp.z - e.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > D.range) continue;
      const cos = (dx * vx + dz * vz) / Math.max(0.001, Math.hypot(dx, dz));
      const inFov = cos > Math.cos(D.fov) || dist < 2.5 || t === B.target;
      if (!inFov) continue;
      const hp = t.rig[BONE.head] ? t.rig[BONE.head].p : tp;
      const seen = lineOfSight(this.game.world, e.x, e.y, e.z, tp.x, tp.y, tp.z) || lineOfSight(this.game.world, e.x, e.y, e.z, hp.x, hp.y + 0.05, hp.z);
      if (!seen) continue;
      // prioridad: vivos antes que derribados, cerca antes que lejos
      const score = dist + (t.state === 'downed' ? 30 : 0);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    // sin operadores a la vista: ¿algún dron enemigo cerca? (la defensa los caza)
    B.drone = null;
    if (!best && op.side === 'def' && this.match.recon) {
      let bd = 16;
      for (const d of this.match.recon.drones) {
        if (!d.alive || d.team === op.team) continue;
        const c = d.center();
        const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > bd) continue;
        const cos = (dx * vx + dz * vz) / Math.max(0.001, Math.hypot(dx, dz));
        if (cos < Math.cos(D.fov) && dist > 3) continue;
        if (!lineOfSight(this.game.world, e.x, e.y, e.z, c.x, c.y + 0.05, c.z)) continue;
        bd = dist; B.drone = d;
      }
    }
    if (best) {
      if (B.target !== best) { B.target = best; B.react = 0; B.seeT = 0; }
      B.lastSeen = { x: best.body.pos.x, y: best.body.pos.y, z: best.body.pos.z };
      B.lostT = 0;
    } else if (B.target) {
      B.lostT += 0.1;
      if (B.lostT > 0.5) { B.target = null; B.alertYaw = B.lastSeen ? Math.atan2(-(B.lastSeen.x - op.body.pos.x), -(B.lastSeen.z - op.body.pos.z)) : null; B.alertT = 2.5; }
    }
  }

  _fight(op, B, dt) {
    const D = this.diff, I = op.intent, rng = this.game.rng;
    const t = B.target;
    if (t.state === 'dead') { B.target = null; return; }
    B.seeT += dt;
    B.react += dt;
    const e = op.eyePos();
    if (B.err.t < 0 || B.seeT - B.err.t > 0.7) {
      const settle = 1 + 2.2 * Math.exp(-B.seeT / D.settle);
      B.err = { x: (rng.next() - 0.5) * 2 * D.aimErr * settle, y: (rng.next() - 0.5) * 1.4 * D.aimErr * settle, t: B.seeT, head: rng.next() < D.head };
    }
    const tp = aimPoint(t, B.err.head);
    const dx = tp.x - e.x, dy = tp.y - e.y, dz = tp.z - e.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + B.err.x / Math.max(1, dist * 0.35);
    const wantPitch = Math.atan2(dy, dist) + B.err.y / Math.max(1, dist * 0.35);
    op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * D.turn, dt * D.turn);
    op.pitch += clamp(wantPitch - op.pitch, -dt * D.turn * 0.7, dt * D.turn * 0.7);
    I.ads = B.react > D.react * 0.5 && dist > 4;
    const onTarget = Math.abs(angleDiff(op.yaw, wantYaw)) < 0.12;
    if (B.react > D.react && onTarget) {
      if (B.pause > 0) B.pause -= dt;
      else {
        const semi = !op.weapon.def.auto;
        B.semi = semi ? !B.semi : true;
        I.fire = B.semi;
        B.burst += dt;
        const burstLen = op.weapon.def.auto ? D.burst * (dist < 8 ? 1.6 : 1) : 0.6;
        if (B.burst > burstLen) { B.burst = 0; B.pause = D.pause[0] + rng.next() * (D.pause[1] - D.pause[0]); }
      }
    }
    if (op.weapon.ammo === 0) { I.reload = true; if (op.weapons[1] && op.weapons[1].ammo > 0 && dist < 10) I.switchTo = 1; }
    else if (op.weaponIndex === 1 && op.weapons[0].ammo > 0 && dist > 10) I.switchTo = 0;
    I.stance = B.crouch || (op.side === 'def' && dist > 6) ? 'crouch' : 'stand';
  }

  _hold(op, B, dt) {
    const I = op.intent, rng = this.game.rng;
    const p = op.body.pos;
    // volver al puesto si se ha desplazado
    const dx = B.post.x - p.x, dz = B.post.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6 && !op.frozen) {
      const want = Math.atan2(-dx, -dz);
      op.yaw += clamp(angleDiff(op.yaw, want), -dt * 4, dt * 4);
      if (Math.abs(angleDiff(op.yaw, want)) < 0.6) I.moveZ = Math.min(1, d);
      op.pitch *= 0.9;
      return;
    }
    let want = B.post.yaw;
    if (B.alertT > 0 && B.alertYaw !== null) { B.alertT -= dt; want = B.alertYaw; }
    else {
      // barrido lento de vigilancia
      B.scanT -= dt;
      if (B.scanT <= 0) { B.scanT = 2.5 + rng.next() * 3; B.scanYaw = B.post.yaw + (rng.next() - 0.5) * 1.6; }
      want = B.scanYaw;
    }
    op.yaw += clamp(angleDiff(op.yaw, want), -dt * 2.2, dt * 2.2);
    op.pitch += (0 - op.pitch) * Math.min(1, dt * 3);
  }

  _follow(op, B, dt) {
    const I = op.intent;
    const T = this.trail;
    const leader = this.trailFor;
    const p = op.body.pos;
    const keepBack = 2 + B.followRank * 2;     // puntos del rastro (0,6 m cada uno)
    const limit = T.length - keepBack;
    if (B.trailIdx >= limit || !T.length) {
      // esperar mirando hacia donde mira el líder
      if (leader) op.yaw += clamp(angleDiff(op.yaw, leader.yaw + (B.followRank % 2 ? 0.5 : -0.5)), -dt * 2.5, dt * 2.5);
      op.pitch *= 0.9;
      I.stance = leader && leader.stance === 'crouch' ? 'crouch' : 'stand';
      return;
    }
    const q = T[Math.max(0, B.trailIdx)];
    const dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4 && Math.abs(q.y - p.y) < 1.2) { B.trailIdx++; B.stuckT = 0; return; }
    const want = Math.atan2(-dx, -dz);
    op.yaw += clamp(angleDiff(op.yaw, want), -dt * 6, dt * 6);
    op.pitch *= 0.9;
    if (Math.abs(angleDiff(op.yaw, want)) < 0.7 || op.body.onLadder) I.moveZ = 1;
    I.sprint = limit - B.trailIdx > 10 && !op.body.onLadder;
    I.stance = I.sprint ? 'stand' : leader && leader.stance === 'crouch' ? 'crouch' : 'stand';
    // atasco: saltar el obstáculo; si sigue, pasar al siguiente punto
    const moved = Math.hypot(p.x - B.lastX, p.z - B.lastZ);
    B.lastX = p.x; B.lastZ = p.z;
    if (moved < dt * 0.4 && I.moveZ > 0) B.stuckT += dt; else B.stuckT = Math.max(0, B.stuckT - dt);
    if (B.stuckT > 0.6) I.vault = true;
    if (B.stuckT > 2.5) { B.trailIdx++; B.stuckT = 0; }
  }

  // Ir al punto de apoyo, mirar la pared/hueco/trampilla y mantener F hasta terminar.
  _fortifyTask(op, B, dt) {
    const I = op.intent;
    const T = B.tasks[0];
    const p = op.body.pos;
    I.stance = 'stand';
    if (!T.started) {
      const dx = T.stand.x - p.x, dz = T.stand.z - p.z;
      const d = Math.hypot(dx, dz);
      T.walkT += dt;
      if (T.walkT > 9) { B.tasks.shift(); return; }                 // no llega: siguiente tarea
      if (d > 0.22) {
        const want = Math.atan2(-dx, -dz);
        op.yaw += clamp(angleDiff(op.yaw, want), -dt * 7, dt * 7);
        op.pitch += (0 - op.pitch) * Math.min(1, dt * 5);
        if (Math.abs(angleDiff(op.yaw, want)) < 0.5) { I.moveZ = Math.min(1, d * 1.5 + 0.25); I.sprint = d > 3; }
        return;
      }
      // en posición: encarar el objetivo
      op.yaw += clamp(angleDiff(op.yaw, T.face), -dt * 6, dt * 6);
      op.pitch += clamp(T.pitch - op.pitch, -dt * 4, dt * 4);
      if (Math.abs(angleDiff(op.yaw, T.face)) < 0.04 && Math.abs(T.pitch - op.pitch) < 0.04) { T.started = true; T.t = 0; }
      return;
    }
    op.yaw = T.face; op.pitch = T.pitch;
    I.interact = true;
    T.t += dt;
    const working = op.channel && (op.channel.kind === 'reinforce' || op.channel.kind === 'barricade');
    if ((!working && T.t > 0.25) || T.t > 7) { I.interact = false; B.tasks.shift(); }
  }

  // Atacante en la preparación: conduce su dron hacia la casa, entra por una puerta y
  // explora; marca a los defensores que ve.
  _driveDrone(op, B, dt) {
    const recon = this.match.recon;
    const d = recon ? recon.droneOf(op) : null;
    if (!d || d.pilot) return;                 // sin dron o lo maneja el jugador
    const D = B.dr || (B.dr = this._droneRoute(d));
    const I = d.intent;
    const p = d.body.pos;
    I.moveX = 0; I.moveZ = 0;
    D.t += dt; D.markT -= dt; D.turnT -= dt;
    // marcar defensores visibles
    if (D.markT <= 0) {
      D.markT = 0.35;
      const e = d.eyePos();
      let tgt = null, bd = 22;
      for (const t of this.game.operators) {
        if (t.team === op.team || t.state === 'dead' || t.frozen || recon.isSpottedFor(t, op.team)) continue;
        const c = t.center();
        const dist = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
        if (dist > bd || !lineOfSight(this.game.world, e.x, e.y, e.z, c.x, c.y, c.z)) continue;
        bd = dist; tgt = t;
      }
      D.mark = tgt;
    }
    if (D.mark && D.mark.state !== 'dead') {
      const e = d.eyePos(), c = D.mark.center();
      const want = Math.atan2(-(c.x - e.x), -(c.z - e.z));
      d.yaw += clamp(angleDiff(d.yaw, want), -dt * 3, dt * 3);
      d.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
      if (Math.abs(angleDiff(d.yaw, want)) < 0.05) { I.mark = true; D.mark = null; }
      return;
    }
    d.pitch += (-0.05 - d.pitch) * Math.min(1, dt * 3);
    // ruta: fuera de la puerta → dentro → explorar
    let goal = D.wp[D.i];
    if (goal) {
      const dx = goal.x - p.x, dz = goal.z - p.z;
      if (Math.hypot(dx, dz) < 0.45) { D.i++; goal = D.wp[D.i]; }
    }
    let want = goal ? Math.atan2(-(goal.x - p.x), -(goal.z - p.z)) : D.wander;
    if (!goal && D.turnT <= 0) { D.turnT = 1.5 + this.game.rng.next() * 2; D.wander = d.yaw + (this.game.rng.next() - 0.5) * 2.4; }
    if (D.avoid > 0) { D.avoid -= dt; want = D.avoidYaw; }
    d.yaw += clamp(angleDiff(d.yaw, want), -dt * 3.5, dt * 3.5);
    if (Math.abs(angleDiff(d.yaw, want)) < 0.6) I.moveZ = 1;
    // atascos: saltar y, si sigue, girar
    if (d.moveSpeed < 0.4 && I.moveZ > 0) D.stuck += dt; else D.stuck = Math.max(0, D.stuck - dt);
    if (D.stuck > 0.5) I.jump = true;
    if (D.stuck > 1.4) { D.stuck = 0; D.avoid = 1.1; D.avoidYaw = d.yaw + (this.game.rng.next() < 0.5 ? 1.3 : -1.3); if (goal && D.t > 20) D.i++; }
  }
  _droneRoute(d) {
    const map = this.match.map, p = d.body.pos;
    // puerta exterior más cercana de la planta baja o del sótano
    let best = null, bd = Infinity;
    for (const o of map.doors) {
      if (!o.out) continue;
      const out = { x: o.axis === 'z' ? o.line + o.out * 1.3 : o.center, z: o.axis === 'z' ? o.center : o.line + o.out * 1.3 };
      const dist = Math.hypot(out.x - p.x, out.z - p.z) + (o.level === '1' ? 0 : 6);
      if (dist < bd) { bd = dist; best = o; }
    }
    const wp = [];
    if (best) {
      const o = best;
      wp.push(o.axis === 'z' ? { x: o.line + o.out * 1.3, z: o.center } : { x: o.center, z: o.line + o.out * 1.3 });
      wp.push(o.axis === 'z' ? { x: o.line - o.out * 2.6, z: o.center } : { x: o.center, z: o.line - o.out * 2.6 });
    }
    return { wp, i: 0, t: 0, markT: 0.5, turnT: 0, wander: d.yaw, stuck: 0, avoid: 0, avoidYaw: 0, mark: null };
  }

  // Defensor: dispara al dron enemigo que tiene a la vista.
  _shootDrone(op, B, dt) {
    const d = B.drone, I = op.intent;
    if (!d.alive) { B.drone = null; return; }
    const e = op.eyePos(), c = d.center();
    const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, dist);
    op.yaw += clamp(angleDiff(op.yaw, wantYaw), -dt * this.diff.turn, dt * this.diff.turn);
    op.pitch += clamp(wantPitch - op.pitch, -dt * this.diff.turn, dt * this.diff.turn);
    I.ads = dist > 4;
    if (Math.abs(angleDiff(op.yaw, wantYaw)) < 0.03 && Math.abs(wantPitch - op.pitch) < 0.04) {
      B.semi = !B.semi;
      I.fire = op.weapon.def.auto ? true : B.semi;
    }
    if (op.weapon.ammo === 0) I.reload = true;
  }

  _reviveNearby(op, B) {
    const t = this.game.findRevivable(op, 1.5);
    if (!t) return false;
    op.intent.interact = true;
    return true;
  }
}

function aimPoint(t, head) {
  const r = t.rig;
  if (head && r[BONE.head]) { const h = r[BONE.head].p; return { x: h.x, y: h.y + 0.08, z: h.z }; }
  if (r[BONE.chest]) { const c = r[BONE.chest].p; return { x: c.x, y: c.y + 0.08, z: c.z }; }
  const b = t.body.pos;
  return { x: b.x, y: b.y + 1.1, z: b.z };
}

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
        followRank: 0, scanT: rng.next() * 4, scanYaw: op.yaw, semi: false,
      });
    }
    // orden de seguimiento de los atacantes
    let k = 1;
    for (const [op, B] of this.brains) if (op.side === 'atk') B.followRank = k++;
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

  _enemiesOf(op) { return this.game.operators.filter((o) => o.team !== op.team && o.state !== 'dead'); }

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

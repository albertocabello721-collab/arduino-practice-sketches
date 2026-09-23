// Maniquís del campo de pruebas (Fase 2). Controladores muy simples que
// escriben intenciones en operadores: quieto, agachado, asomándose, patrulla
// y tirador. La IA de verdad (navegación, tácticas) llega en la Fase 5.
import { Operator } from './operator.js';
import { lineOfSight } from '../world/raycast.js';
import { angleDiff, clamp } from '../core/math.js';
import { BONE } from './skeleton.js';

export function spawnRangeDummies(game) {
  const list = [
    { id: 'm1', name: 'Maniquí 1', x: 3.2, z: 9.5, yaw: -Math.PI * 0.62, mode: 'idle', loadout: ['ar', 'pistol'], armor: 1 },
    { id: 'm2', name: 'Maniquí 2', x: 16.3, z: 22.2, yaw: Math.PI, mode: 'crouch', loadout: ['smg', 'pistol'], armor: 2 },
    { id: 'm3', name: 'Maniquí 3', x: 17, z: 14.8, yaw: Math.PI, mode: 'lean', loadout: ['ar2', 'pistol'], armor: 3 },
    { id: 'm4', name: 'Maniquí 4', x: 6, z: 15, yaw: Math.PI, mode: 'patrol', loadout: ['shotgun', 'pistol'], armor: 2, path: [[2.5, 15.5], [9.5, 15.5], [9.5, 24.5], [2.5, 24.5]] },
    { id: 'm5', name: 'Tirador', x: 26.5, z: 4.8, yaw: Math.PI / 2 - 0.15, mode: 'shooter', loadout: ['ar', 'pistol'], armor: 2 },
  ];
  const ops = [];
  for (const d of list) {
    const op = game.addOperator(new Operator(d.id, { name: d.name, team: 1, x: d.x, y: 0, z: d.z, yaw: d.yaw, loadout: d.loadout, armor: d.armor, bot: true }));
    op.dummy = { mode: d.mode, path: d.path, pi: 0, t: 0, home: { x: d.x, z: d.z, yaw: d.yaw }, react: 0, burst: 0, pause: 0, aimErr: { x: 0, y: 0 } };
    if (d.mode === 'crouch') op.intent.stance = 'crouch';
    ops.push(op);
  }
  // compañero (para probar la reanimación)
  const mate = game.addOperator(new Operator('aliado', { name: 'Compañero', team: 0, x: 17.5, y: 0, z: -3.2, yaw: Math.PI, loadout: ['ar', 'pistol'], armor: 2, bot: true }));
  mate.dummy = { mode: 'idle', home: { x: 17.5, z: -3.2, yaw: Math.PI } };
  ops.push(mate);
  return ops;
}

// Actualiza las intenciones de los maniquís (llamar antes de cada tick).
export function driveDummies(game, dummies, target, dt) {
  for (const op of dummies) {
    if (op.state !== 'alive') { op.intent.fire = false; op.intent.moveZ = 0; continue; }
    const D = op.dummy;
    D.t += dt;
    const I = op.intent;
    I.fire = false; I.moveX = 0; I.moveZ = 0; I.ads = false;
    if (D.mode === 'lean') I.lean = Math.sin(D.t * 0.9) > 0 ? 1 : -1;
    if (D.mode === 'patrol' && D.path) {
      const [px, pz] = D.path[D.pi];
      const dx = px - op.body.pos.x, dz = pz - op.body.pos.z;
      if (Math.hypot(dx, dz) < 0.4) D.pi = (D.pi + 1) % D.path.length;
      const want = Math.atan2(-dx, -dz);
      op.yaw += clamp(angleDiff(op.yaw, want), -dt * 4, dt * 4);
      if (Math.abs(angleDiff(op.yaw, want)) < 0.5) I.moveZ = 0.55;
    }
    if (D.mode === 'shooter' && target && target.state === 'alive') {
      const e = op.eyePos();
      const tb = target.rig[BONE.chest] ? target.rig[BONE.chest].p : target.body.pos;
      const th = target.rig[BONE.head] ? target.rig[BONE.head].p : tb;
      const dx = tb.x - e.x, dy = tb.y + 0.1 - e.y, dz = tb.z - e.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      const facing = Math.abs(angleDiff(op.yaw, want)) < 1.1;
      const sees = dist < 30 && facing && (lineOfSight(game.world, e.x, e.y, e.z, tb.x, tb.y + 0.1, tb.z) || lineOfSight(game.world, e.x, e.y, e.z, th.x, th.y + 0.1, th.z));
      if (sees) {
        D.react += dt;
        // girar hacia el objetivo con error de puntería que se corrige
        if (D.react > 0.15) {
          if (D.aimErr.t === undefined || D.t - D.aimErr.t > 0.8) D.aimErr = { x: (game.rng.next() - 0.5) * 0.12, y: (game.rng.next() - 0.5) * 0.08, t: D.t };
          const wantPitch = Math.atan2(dy, dist);
          op.yaw += clamp(angleDiff(op.yaw, want + D.aimErr.x), -dt * 5, dt * 5);
          op.pitch += clamp(wantPitch + D.aimErr.y - op.pitch, -dt * 3, dt * 3);
          I.ads = true;
        }
        if (D.react > 0.65) {
          if (D.pause > 0) D.pause -= dt;
          else {
            I.fire = true;
            D.burst += dt;
            if (D.burst > 0.35) { D.burst = 0; D.pause = 0.5 + game.rng.next() * 0.6; }
          }
        }
        if (op.weapon.ammo === 0) I.reload = true;
      } else {
        D.react = Math.max(0, D.react - dt * 2);
        op.yaw += clamp(angleDiff(op.yaw, D.home.yaw), -dt * 1.5, dt * 1.5);
        op.pitch *= 0.95;
      }
    }
  }
}

export function resetDummies(dummies) {
  for (const op of dummies) {
    const D = op.dummy;
    op.state = 'alive'; op.hp = op.maxHp; op.deathT = 0; op.bleedT = 0; op.reviveT = 0;
    op.body.pos.x = D.home.x; op.body.pos.z = D.home.z; op.body.pos.y = 0.05;
    op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
    op.yaw = D.home.yaw; op.pitch = 0;
    op.stance = D.mode === 'crouch' ? 'crouch' : 'stand';
    op.body.height = op.stance === 'crouch' ? 1.25 : 1.8;
    op.pose.dead = 0; op.pose.downed = 0;
    for (const w of op.weapons) w.refill();
    if (D.path) D.pi = 0;
    D.react = 0; D.burst = 0; D.pause = 0;
  }
}

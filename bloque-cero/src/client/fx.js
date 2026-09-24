// Puente simulación → presentación: convierte los eventos de una partida (disparos,
// impactos, daño, derribos, bajas, pasos, recargas) en sonido, efectos y HUD.
// Lo comparten el campo de pruebas y la partida 5v5.
import { MATS } from '../world/materials.js';
import { lineOfSight } from '../world/raycast.js';
import { angleDiff } from '../core/math.js';
import { BONE } from '../sim/skeleton.js';

/**
 * @param {object} ctx     contexto del motor (audio, effects, chars, vm, hud, world)
 * @param {object} game    simulación (Game)
 * @param {object} view    { viewer(): op cuya vista se muestra, me(): op del jugador humano,
 *                          onViewerDowned?, onViewerRevived?, onViewerKilled?, killfeed? }
 * @returns {function} desconectar
 */
export function bindGameFx(ctx, game, view) {
  const { audio, effects, chars, vm, hud, world } = ctx;
  const offs = [];
  const on = (type, fn) => offs.push(game.on(type, fn));
  const viewer = () => view.viewer();
  const me = () => view.me();

  const occlusion = (p) => {
    const e = ctx.camEye;
    return lineOfSight(world, e.x, e.y, e.z, p.x, p.y + 0.2, p.z) ? 0 : 0.7;
  };
  ctx.occlusion = occlusion;

  // boca del cañón en el mundo (modelo en tercera persona; en primera, delante de la vista)
  const muzzleWorld = (op) => {
    if (op !== viewer() && op.rig[BONE.gun]) {
      const g = op.rig[BONE.gun], R = g.R;
      const long = op.weapon.def.cls !== 'pistol';
      const lx = 0, ly = 0.04, lz = long ? -0.62 : -0.17;
      return { x: g.p.x + R.x.x * lx + R.y.x * ly + R.z.x * lz, y: g.p.y + R.x.y * lx + R.y.y * ly + R.z.y * lz, z: g.p.z + R.x.z * lx + R.y.z * ly + R.z.z * lz };
    }
    const e = op.eyePos(); const f = op.viewDir();
    const rx = Math.cos(op.yaw), rz = -Math.sin(op.yaw);
    const hip = 1 - op.ads;
    return { x: e.x + f.x * 0.55 + rx * 0.12 * hip, y: e.y + f.y * 0.55 - 0.1 * hip - 0.03, z: e.z + f.z * 0.55 + rz * 0.12 * hip };
  };

  const cls = (op) => {
    if (!op) return '';
    if (op === me()) return 'me';
    const my = me();
    const myTeam = my ? my.team : 0;
    return op.team === myTeam ? 'a' : 'd';
  };
  const nameHtml = (op) => op ? `<span class="${cls(op)}">${op.name}</span>` : '';
  const mine = (...ops) => ops.some((o) => o && o === me());

  on('shot', (op, w, eye, fwd, results) => {
    const local = op === viewer();
    audio.gunshot(w.def.sound, eye, local, local ? 0 : occlusion(eye));
    const m = muzzleWorld(op);
    effects.flash(m.x, m.y, m.z, 9, 5.4, 2.4, 5.5, 0.06);
    if (local) { vm.onShot(); ctx.shake = Math.min(1, ctx.shake + (w.def.pellets > 1 ? 0.8 : 0.25)); }
    for (const r of results) {
      const end = { x: r.origin.x + r.dir.x * r.end, y: r.origin.y + r.dir.y * r.end, z: r.origin.z + r.dir.z * r.end };
      if (Math.random() < (w.def.pellets > 1 ? 0.35 : 0.5)) effects.addTracer(m, end);
    }
  });
  on('bullet', (op, res) => {
    effects.bulletImpact(res);
    if (res.hit) {
      const p = { x: res.origin.x + res.dir.x * res.end, y: res.origin.y + res.dir.y * res.end, z: res.origin.z + res.dir.z * res.end };
      audio.impact(MATS[res.hit.mat].snd, p, occlusion(p));
    }
    if (res.destroyed.length) {
      const v = res.destroyed[0];
      const p = { x: world.wx(v.x), y: world.wy(v.y), z: world.wz(v.z) };
      audio.breakMaterial(MATS[v.mat].snd, p, res.destroyed.length, occlusion(p));
    }
  });
  on('voxels', (list, cause, point, dir) => effects.voxelsDestroyed(list, cause, point, dir));
  on('damaged', (target, ev) => {
    chars.flashHit(target);
    if (ev.point) effects.bloodHit(ev.point, ev.dir, ev.zone === 'head');
    if (ev.point) audio.hitFlesh(ev.point, ev.zone === 'head', target === viewer() ? 0 : occlusion(ev.point));
    if (ev.by && ev.by === me() && target !== me()) { hud.hitmarker('hit'); audio.hitConfirm('hit'); }
    if (target === viewer()) {
      audio.hurt(ev.amount);
      ctx.damageFlash = Math.min(1, ctx.damageFlash + ev.amount / 60);
      if (ev.by) {
        const b = ev.by.body.pos, p = target.body.pos;
        const ang = Math.atan2(-(b.x - p.x), -(b.z - p.z));
        hud.damageFrom(-angleDiff(target.yaw, ang));
      }
    }
  });
  on('downed', (target, ev) => {
    hud.feed(`${nameHtml(ev.by)} <span class="w">derriba a</span> ${nameHtml(target)}`, 'down' + (mine(ev.by, target) ? ' mine' : ''));
    if (ev.by && ev.by === me()) { hud.hitmarker('kill'); audio.hitConfirm('kill'); }
    if (target === viewer()) audio.startDowned();
    if (target === me() && view.onMeDowned) view.onMeDowned();
  });
  on('killed', (target, ev) => {
    const w = ev.weapon ? ev.weapon.name : ev.zone === 'bleed' ? 'desangrado' : ev.zone === 'fall' ? 'caída' : '';
    hud.feed(`${nameHtml(ev.by || null)} <span class="w">${w}</span> ${nameHtml(target)}${ev.headshot ? ' <span class="hs">⌖</span>' : ''}`, mine(ev.by, target) ? 'mine' : '');
    if (ev.by && ev.by === me() && target !== me()) { hud.hitmarker(ev.headshot ? 'head' : 'kill'); audio.hitConfirm(ev.headshot ? 'head' : 'kill'); }
    audio.bodyFall(target.body.pos, target === viewer() ? 0 : occlusion(target.body.pos));
    if (target === viewer()) { audio.stopDowned(); hud.setDowned(false); }
    if (target === me() && view.onMeKilled) view.onMeKilled(ev);
  });
  on('revived', (target, by) => {
    hud.feed(`${nameHtml(by)} <span class="w">reanima a</span> ${nameHtml(target)}`, mine(by, target) ? 'mine' : '');
    audio.reviveDone();
    if (target === viewer()) { audio.stopDowned(); hud.setDowned(false); }
    if (target === me() && view.onMeRevived) view.onMeRevived();
  });
  on('footstep', (op, snd, loud) => {
    const p = op.body.pos;
    const local = op === viewer();
    audio.footstep(snd, { x: p.x, y: p.y + 0.05, z: p.z }, loud, local, local ? 0 : occlusion(p));
  });
  on('reload', (op, w) => {
    if (op !== viewer()) return;
    const T = w.reloadTotal;
    const empty = w.ammo === 0;
    setTimeout(() => audio.weaponFoley('magout'), T * 250);
    setTimeout(() => audio.weaponFoley('magin'), T * 580);
    if (empty) setTimeout(() => audio.weaponFoley('bolt'), T * 830);
  });
  on('dryfire', (op) => { if (op === viewer()) audio.weaponFoley('dry'); });
  on('switch', (op) => { if (op === viewer()) audio.weaponFoley('switch'); });
  on('land', (op, v) => { if (op === viewer()) { audio.weaponFoley('land'); vm.onLand(v); } });
  on('vault', (op) => { if (op === viewer()) audio.weaponFoley('vault'); });

  return () => { for (const f of offs) f(); };
}

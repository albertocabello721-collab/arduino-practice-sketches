// Puente simulación → presentación: convierte los eventos de una partida (disparos,
// impactos, daño, derribos, bajas, pasos, recargas) en sonido, efectos y HUD.
// Lo comparten el campo de pruebas y la partida 5v5.
import { MATS, SND } from '../world/materials.js';
import { BONE } from '../sim/skeleton.js';
import { thirdPersonDrops } from '../render/character.js';
import { FEEL, hitSide, kickFrom, nearMiss } from './feel.js';
import { OperatorVoice } from './announcer.js';

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

  // por dónde llega cada sonido a la cámara (F9: paredes, suelos y rodeos por puertas y agujeros);
  // se pasa a los sonidos en lugar de la oclusión
  const heard = (p) => ctx.hearing.at(p);
  ctx.hear = heard;

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
    const quiet = !!w.def.suppressed;            // con supresor: suena bajo y sin fogonazo
    audio.gunshot(w.def.sound, eye, local, local ? 0 : heard(eye), quiet);
    const m = muzzleWorld(op);
    if (!quiet) effects.flash(m.x, m.y, m.z, 9, 5.4, 2.4, 5.5, 0.06);
    if (local) { vm.onShot(); ctx.shake = Math.min(1, ctx.shake + (w.def.pellets > 1 ? 0.8 : 0.25)); }
    // el mando vibra con tus disparos (F10.5): más con la escopeta y el tirador
    if (op === me() && ctx.pad) { const big = w.def.pellets > 1 || w.def.cls === 'dmr'; ctx.pad.rumble(big ? 0.6 : 0.16, big ? 0.45 : 0.3, big ? 110 : 45); }
    for (const r of results) {
      const end = { x: r.origin.x + r.dir.x * r.end, y: r.origin.y + r.dir.y * r.end, z: r.origin.z + r.dir.z * r.end };
      if (Math.random() < (w.def.pellets > 1 ? 0.35 : 0.5)) effects.addTracer(m, end);
    }
  });
  // una bala de otro que te pasa a menos de 1,5 m sin darte: chasquido (F12.1)
  let crackAt = -1;
  on('bullet', (op, res) => {
    const v = viewer();
    if (v && op !== v && v.state === 'alive' && res.hitOp !== v) {
      const now = performance.now() / 1000;
      if (now - crackAt > FEEL.crackGap) {
        const nm = nearMiss(res, v.eyePos());
        if (nm) { crackAt = now; audio.bulletCrack(nm.at, nm.dist, 0); }
      }
    }
    effects.bulletImpact(res);
    if (res.hit) {
      const p = { x: res.origin.x + res.dir.x * res.end, y: res.origin.y + res.dir.y * res.end, z: res.origin.z + res.dir.z * res.end };
      audio.impact(MATS[res.hit.mat].snd, p, heard(p));
    }
    if (res.destroyed.length) {
      const v = res.destroyed[0];
      const p = { x: world.wx(v.x), y: world.wy(v.y), z: world.wz(v.z) };
      audio.breakMaterial(MATS[v.mat].snd, p, res.destroyed.length, heard(p));
    }
  });
  on('voxels', (list, cause, point, dir) => effects.voxelsDestroyed(list, cause, point, dir));
  // ---------------- gadgets lanzables
  on('gadgetThrown', (op, it) => { audio.throwWhoosh(it.pos, op === viewer()); if (op === viewer()) vm.onThrow(); });
  on('gadgetEmpty', (op) => { if (op === me()) { audio.ping('deny'); hud.toast('Sin gadgets', 1.2); } });
  on('gadgetDenied', (op, why) => { if (op === me()) { audio.ping('deny'); if (why) hud.toast(why, 1.4); } });
  on('gadgetPlaced', (op, c) => audio.grenadeClink(c.pos, op === viewer() ? 0 : heard(c.pos)));
  on('gadgetStuck', (it) => audio.impact(SND.metal, it.pos, heard(it.pos)));
  on('wireRustle', (op, c) => audio.wireRustle(op.body.pos, op === viewer() ? 0 : heard(op.body.pos)));
  on('alarm', (c) => audio.alarm(c.pos, heard(c.pos)));
  on('ricochet', (tg, p) => { if (p) { audio.ricochet(p, heard(p)); for (let i = 0; i < 5; i++) effects.spawnSpark(p.x, p.y, p.z, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 1); } });
  on('gadgetDestroyed', (it) => {
    audio.electronicPop(it.pos, heard(it.pos));
    for (let i = 0; i < 10; i++) effects.spawnSpark(it.pos.x, it.pos.y + 0.05, it.pos.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 1);
  });
  on('gadgetBounce', (it) => audio.grenadeClink(it.pos, heard(it.pos)));
  on('gadgetJammed', (it) => { if (it.owner === me()) { audio.ping('deny'); hud.toast('Señal inhibida: no detona', 1.4); } });
  // ---------------- habilidades (X)
  on('abilityFired', (op, it) => audio.launcher(it.pos, op === viewer()));
  on('abilityEmpty', (op) => { if (op === me()) { audio.ping('deny'); hud.toast('Sin cargas de la habilidad', 1.2); } });
  on('abilityDenied', (op, why) => { if (op === me()) { audio.ping('deny'); if (why) hud.toast(why, 1.8); } });
  // pulso de escaneo (RADAR): aviso para todos; al detectar, pitido para el ataque y aviso al detectado
  on('scanWarn', () => audio.scanWarn(2));
  on('scanStart', () => audio.scanSweep());
  on('scanDetect', (op, s) => {
    const my = me();
    if (my && op === my) { audio.ping('deny'); hud.toast('¡Te han detectado!', 1.4); }
    else if (my && s.team === my.team) audio.ping('mark');
  });
  on('thermalIgnite', (c) => audio.thermalBurn(c.pos, 5, heard(c.pos)));
  // batería de VOLTIO: descarga (chispas azules) y aviso a quien pierde su carga
  on('zapped', (c, p) => {
    for (let i = 0; i < 10; i++) effects.spawnSpark(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 1);
    effects.flash(p.x, p.y, p.z, 20, 45, 110, 4, 0.1);
    audio.zap(p, false, heard(p));
  });
  on('electrified', (o) => { if (o.owner === me()) hud.toast('¡Electrificado! La batería ha quemado la carga', 1.8); });
  // placas, estimulantes y gas
  on('platePicked', (op) => { if (op === me()) { audio.ping('ping'); hud.toast('Placa de armadura · +20', 1.6); } });
  on('stim', (by, t) => {
    const p = t.body.pos;
    for (let i = 0; i < 12; i++) effects.spawnSpark(p.x, p.y + 1.0, p.z, (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5, 0.6);
    audio.ping('ping');
    if (t === me()) hud.toast(by === t ? 'Estimulante · +40' : `Estimulante de ${by.name} · +40`, 1.6);
  });
  on('gas', (s) => audio.smokeHiss(s, heard(s)));
  // mina láser: aviso a la defensa (dónde ha saltado)
  on('mineAlert', (c, op) => {
    const my = me();
    if (!my || my.team !== c.team) return;
    const p = op.body.pos;
    const where = ctx.map && ctx.map.locationAt ? ctx.map.locationAt(p.x, p.y + 0.2, p.z) : '';
    audio.ping('mark');
    hud.toast(`Mina láser${where ? ' · ' + where : ''}`, 2.2);
  });
  // interceptor: rayo hasta el proyectil y chasquido
  on('intercepted', (c, from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz) || 1;
    for (let k = 0.2; k < L; k += 0.3) effects.spawnSpark(from.x + dx / L * k, from.y + dy / L * k, from.z + dz / L * k, 0, 0.3, 0, 1);
    for (let i = 0; i < 8; i++) effects.spawnSpark(to.x, to.y, to.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 1);
    effects.flash(to.x, to.y, to.z, 30, 50, 90, 4, 0.1);
    audio.zap(to, false, heard(to));
  });
  // escudo de MURALLA: carga y destello (ciega en su cono, como una cegadora)
  on('shieldFlashCharge', (op) => audio.shieldCharge(op.eyePos(), op === viewer()));
  on('shieldFlash', (op, p, hitList) => {
    effects.flash(p.x, p.y, p.z, 240, 240, 225, 9, 0.14);
    audio.flashbang(p, op === viewer() ? 0 : heard(p));
    const v = viewer();
    if (v && hitList.includes(v)) audio.ringing(Math.min(1, v.blindT / 3.5));
  });
  // rayo del dron de choque: chispas azules a lo largo y en el impacto
  on('shockZap', (d, from, to, hit) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz) || 1;
    for (let k = 0.3; k < L; k += 0.35) effects.spawnSpark(from.x + dx / L * k, from.y + dy / L * k, from.z + dz / L * k, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 1);
    for (let i = 0; i < (hit ? 14 : 6); i++) effects.spawnSpark(to.x, to.y, to.z, (Math.random() - 0.5) * 4, Math.random() * 2.5, (Math.random() - 0.5) * 4, 1);
    effects.flash(to.x, to.y, to.z, 20, 50, 110, 5, 0.12);
    audio.zap(from, !!d.pilot && d.owner === me(), heard(from));
  });
  on('emp', (p, hits) => {
    effects.flash(p.x, p.y + 0.2, p.z, 20, 60, 120, 9, 0.25);
    for (let i = 0; i < 30; i++) effects.spawnSpark(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 1);
    audio.empBurst(p, heard(p));
    for (const d of hits) {
      const q = d.pos;
      for (let i = 0; i < 8; i++) effects.spawnSpark(q.x, q.y, q.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 1);
      audio.electronicPop(q, heard(q));
    }
  });
  on('explosion', (kind, p, spec) => {
    const big = { frag: 1, impact: 0.7, breach: 1.2, c4: 1.3, claymore: 0.9, thermal: 1.1, breachround: 0.8, lasermine: 0.6 }[kind] || 1;
    effects.flash(p.x, p.y + 0.2, p.z, 60 * big, 34 * big, 14 * big, 10, 0.3);
    for (let i = 0; i < 40 * big; i++) effects.spawnSpark(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 12, Math.random() * 7, (Math.random() - 0.5) * 12, 1);
    for (let i = 0; i < 14; i++) effects.spawnDust(p.x + (Math.random() - 0.5) * 0.8, p.y + 0.2 + Math.random() * 0.6, p.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2.5, Math.random() * 1.6, (Math.random() - 0.5) * 2.5, 0.5 + Math.random() * 0.6, [0.42, 0.4, 0.37], 2.5 + Math.random() * 1.5, 0.55);
    audio.explosion(p, big, heard(p));
    const e = ctx.camEye, d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
    if (d < spec.radius * 4) ctx.shake = Math.min(2, ctx.shake + (1 - d / (spec.radius * 4)) * 1.6);
  });
  on('flashbang', (p, hitList) => {
    effects.flash(p.x, p.y + 0.2, p.z, 220, 220, 200, 14, 0.12);
    audio.flashbang(p, heard(p));
    const v = viewer();
    if (v && hitList.includes(v)) audio.ringing(Math.min(1, v.blindT / 3.5));
  });
  on('smoke', (s) => { audio.smokeHiss(s, heard(s)); ctx.smokes = ctx.smokes || []; ctx.smokes.push(s); });
  // gemidos (F12.2): cada operador con su tono; como mucho uno cada 0,35 s por operador
  const groanAt = new Map();
  const seedOf = (op) => { let h = 0; for (const c of String(op.name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const groan = (op, kind) => {
    const now = performance.now() / 1000;
    if (kind !== 'down' && now - (groanAt.get(op) ?? -9) < 0.35) return;
    groanAt.set(op, now);
    const at = op.eyePos(), local = op === viewer();
    audio.grunt(at, kind, seedOf(op), local ? 0 : heard(at), local);
  };
  // tu operador dice lo que hace (F12.2): recargar, lanzar o colocar un gadget, reforzar
  const myVoice = new OperatorVoice((text) => { const my = me(); if (ctx.voice && my) ctx.voice.mine(text, my.name); });
  const mySay = (op, kind) => { if (op && op === me()) myVoice.line(kind, performance.now() / 1000); };
  on('reload', (op) => mySay(op, 'reload'));
  on('gadgetThrown', (op, it) => mySay(op, it.kind));
  on('gadgetPlaced', (op, c) => mySay(op, c && c.kind));
  on('reinforced', (op) => mySay(op, 'reinforced'));
  on('damaged', (target, ev) => {
    chars.flashHit(target);
    if (ev.amount >= 4 && target.state === 'alive' && target.hp > 0) groan(target, 'pain');   // (si cae, suena el de derribado)
    if (ev.point) effects.bloodHit(ev.point, ev.dir, ev.zone === 'head');
    if (ev.point) audio.hitFlesh(ev.point, ev.zone === 'head', target === viewer() ? 0 : heard(ev.point));
    if (ev.by && ev.by === me() && target !== me()) { hud.hitmarker('hit'); audio.hitConfirm('hit'); }
    if (target === me() && ctx.pad) ctx.pad.rumble(Math.min(1, 0.35 + ev.amount / 60), Math.min(1, 0.25 + ev.amount / 80), 120 + Math.min(200, ev.amount * 3));   // (y con el daño)
    if (target === viewer()) {
      audio.hurt(ev.amount);
      ctx.damageFlash = Math.min(1, ctx.damageFlash + ev.amount / 60);
      const side = ev.by && ev.by !== target ? hitSide(target, ev.by.body.pos) : null;
      if (side) hud.damageFrom(-side.rel);
      // un balazo, un golpe o una explosión (no el gas ni la batería): la vista se sacude (hacia
      // arriba y hacia el otro lado) y el borde de ese lado se pone rojo
      if (ev.dir || (ev.weapon && ev.weapon.explosive)) {
        const K = kickFrom(ev.amount, side || { x: 0, y: 1 });
        ctx.kick.pitch += K.pitch; ctx.kick.yaw += K.yaw; ctx.kick.roll += K.roll;
        if (side) { ctx.dmgDir.x = side.x; ctx.dmgDir.y = side.y; ctx.dmgDir.k = Math.min(1, ctx.dmgDir.k + 0.35 + ev.amount / 60); }
      }
    } else if (ev.point && ev.dir) {
      // al alcanzado por una bala o un golpe: un tirón del cuerpo y, salvo en la cabeza, polvo del chaleco
      chars.jolt(target, ev.dir);
      if (ev.zone !== 'head') effects.vestPuff(ev.point, ev.dir);
    }
  });
  on('downed', (target, ev) => {
    hud.feed(`${nameHtml(ev.by)} <span class="w">derriba a</span> ${nameHtml(target)}`, 'down' + (mine(ev.by, target) ? ' mine' : ''));
    if (ev.by && ev.by === me()) { hud.hitmarker('kill'); audio.hitConfirm('down'); }
    groan(target, 'down');
    if (target === viewer()) audio.startDowned();
    if (target === me() && view.onMeDowned) view.onMeDowned();
  });
  on('killed', (target, ev) => {
    chars.killed(target, ev);            // el cuerpo cae empujado por lo que lo mató (F7.5)
    const w = ev.weapon ? ev.weapon.name : ev.zone === 'bleed' ? 'desangrado' : ev.zone === 'fall' ? 'caída' : '';
    hud.feed(`${nameHtml(ev.by || null)} <span class="w">${w}</span> ${nameHtml(target)}${ev.headshot ? ' <span class="hs">⌖</span>' : ''}`, mine(ev.by, target) ? 'mine' : '');
    if (ev.by && ev.by === me() && target !== me()) { hud.hitmarker(ev.headshot ? 'head' : 'kill'); audio.hitConfirm(ev.headshot ? 'head' : 'kill'); }
    audio.bodyFall(target.body.pos, target === viewer() ? 0 : heard(target.body.pos));
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
    const at = { x: p.x, y: p.y + 0.05, z: p.z };
    if (local) audio.footstep(snd, at, loud, true, 0);
    else ctx.hearing.step(() => audio.footstep(snd, at, loud, false, heard(at)));
  });
  // recarga por partes: cada sonido en su parte (si se interrumpe, no suena lo que falta) y lo
  // que se suelta (el cargador, los casquillos del revólver) cae al suelo y se queda un rato
  const PART_SOUND = { magOut: 'magout', eject: 'eject', open: 'open', magIn: 'magin', slap: 'slap', bolt: 'bolt', belt: 'belt', close: 'close', shell: 'shell', pump: 'pump' };
  on('reloadPart', (op, w, part) => {
    if (op !== viewer()) {
      // los demás, a menos de 20 m de la cámara: su cargador (o los casquillos) cae al suelo
      if ((part !== 'magOut' && part !== 'eject') || op.frozen) return;
      const c = ctx.camera.position, b = op.body.pos;
      if ((b.x - c.x) ** 2 + (b.y - c.y) ** 2 + (b.z - c.z) ** 2 > 20 * 20) return;
      const v = op.body.vel, eye = op.eyePos();
      for (const d of thirdPersonDrops(op, part)) {
        const up = d.kind === 'casing' ? 0.5 + Math.random() * 0.8 : -0.5;
        effects.drop(d.kind, d.pos, d.quat, d.size, d.color, { x: v.x + (Math.random() - 0.5) * 0.5, y: v.y * 0.5 + up, z: v.z + (Math.random() - 0.5) * 0.5 }, eye);
      }
      return;
    }
    audio.weaponFoley(PART_SOUND[part] || 'magin');
    if (part !== 'magOut' && part !== 'eject') return;
    const eye = op.eyePos(), v = op.body.vel;
    for (const d of vm.released(ctx.camera, part)) {
      const up = d.kind === 'casing' ? 0.5 + Math.random() * 0.8 : -0.5;
      effects.drop(d.kind, d.pos, d.quat, d.size, d.color, { x: v.x + (Math.random() - 0.5) * 0.5, y: v.y * 0.5 + up, z: v.z + (Math.random() - 0.5) * 0.5 }, eye);
    }
  });
  effects.onDropLand = (p, kind) => audio.weaponFoley(kind === 'mag' ? 'magdrop' : 'casing', p, false);
  // ---------------- fortificación, cuerpo a cuerpo y reconocimiento (Fase 4)
  const fortTimers = new Map();
  const stopTimer = (op) => { clearTimeout(fortTimers.get(op)); fortTimers.delete(op); };
  on('fortifyStart', (op, tgt) => {
    const p = tgt.center;
    if (tgt.kind === 'barricade') { audio.barricade(p, heard(p)); return; }
    audio.reinforce(p, 'place', heard(p));
    fortTimers.set(op, setTimeout(() => audio.reinforce(p, 'hydraulic', heard(p)), 1500));
  });
  on('fortifyCancel', stopTimer);
  on('fortifyFail', stopTimer);
  on('reinforced', (op, rec) => {
    stopTimer(op);
    const p = rec.center;
    audio.reinforce(p, 'lock', heard(p));
    const e = ctx.camEye;
    const near = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
    if (near < 6) ctx.shake = Math.min(1.2, ctx.shake + (6 - near) * 0.12);
    // polvo del tabique al encajar el panel
    for (let i = 0; i < 10; i++) effects.spawnDust(p.x + (Math.random() - 0.5) * 0.9, p.y - 1.2 + Math.random() * 2.4, p.z + (Math.random() - 0.5) * 0.9, rec.normal.x * 0.3 + (Math.random() - 0.5) * 0.2, Math.random() * 0.15, rec.normal.z * 0.3 + (Math.random() - 0.5) * 0.2, 0.14, [0.55, 0.54, 0.51], 1.2, 0.2);
  });
  on('melee', (op, info) => {
    const e = op.eyePos();
    audio.meleeSwing(e, op === viewer());
    if (op === viewer()) vm.onMelee();
    if (info.point && info.mat !== undefined) audio.impact(MATS[info.mat].snd, info.point, heard(info.point));
    if (info.target && op === me()) { hud.hitmarker('hit'); audio.hitConfirm('hit'); }
  });
  on('droneDeployed', (d, op) => { const p = d.body.pos; audio.impact(5, p, heard(p)); if (op === viewer()) vm.onDrone(); });
  on('targetDestroyed', (t, by, point) => {
    const p = point || (t.center ? t.center() : null);
    if (!p) return;
    audio.electronicPop(p, heard(p));
    effects.flash(p.x, p.y, p.z, 12, 10, 6, 3, 0.12);
    for (let i = 0; i < 16; i++) effects.spawnSpark(p.x, p.y, p.z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 1);
    if (by && by === me()) { hud.hitmarker('kill'); audio.hitConfirm('kill'); }
    const what = t.kind === 'drone' ? 'un dron' : t.kind === 'defuser' ? 'el desactivador' : 'una cámara';
    hud.feed(`${nameHtml(by)} <span class="w">destruye ${what}</span>`, by === me() ? 'mine' : '');
  });
  // impacto en un objeto con vida (el desactivador): chispas y marcador de impacto
  on('targetHit', (t, by, point) => {
    const p = point || (t.center ? t.center() : null);
    if (!p) return;
    for (let i = 0; i < 5; i++) effects.spawnSpark(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 1);
    if (by && by === me()) { hud.hitmarker('hit'); audio.hitConfirm('hit'); }
  });
  on('spotted', (target, viewerObj, team) => {
    const my = me();
    if (my && team === my.team) audio.ping('mark');
  });
  on('pinged', (op, ping) => {
    const my = me();
    if (my && ping.team === my.team) audio.ping('ping');
  });

  on('dryfire', (op) => { if (op === viewer()) audio.weaponFoley('dry'); });
  on('switch', (op) => { if (op === viewer()) audio.weaponFoley('switch'); });
  on('land', (op, v) => { if (op === viewer()) { audio.weaponFoley('land'); vm.onLand(v); } });
  on('vault', (op) => { if (op === viewer()) audio.weaponFoley('vault'); });
  // rappel (F10.2a): el enganche, la cuerda al bajar, y la barricada y el cristal al entrar
  const ropeAt = (op, h) => ({ x: op.body.pos.x, y: op.body.pos.y + h, z: op.body.pos.z });
  on('rappelHook', (op) => { const at = ropeAt(op, 1.2), l = op === viewer(); audio.rappel('hook', at, l, l ? 0 : heard(at)); });
  on('rappelSlide', (op) => { const at = ropeAt(op, 1.0), l = op === viewer(); audio.rappel('slide', at, l, l ? 0 : heard(at)); });
  const winAt = (w) => ({ x: w.x, y: (w.y0 + w.y1) / 2, z: w.z });
  on('rappelBreach', (op, w) => {
    const at = winAt(w);
    audio.breakMaterial(SND.wood, at, 12, op === viewer() ? 0 : heard(at));
    if (op === viewer()) ctx.shake = Math.min(1.2, ctx.shake + 0.6);
  });
  on('rappelGlass', (op, w) => { const at = winAt(w); audio.breakMaterial(SND.glass, at, 6, op === viewer() ? 0 : heard(at)); });
  on('rappelBlocked', (op, why) => { if (op === me()) { audio.ping('deny'); hud.toast(why, 1.4); } });

  return () => { for (const f of offs) f(); effects.onDropLand = null; };
}

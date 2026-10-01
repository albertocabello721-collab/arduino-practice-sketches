// Percepción de un bot: vista (campo de visión, alcance, línea de visión a través de
// agujeros y cristal) y oído (disparos, pasos, golpes, destrucción, refuerzos, drones),
// con memoria de dónde estaba cada enemigo. La pizarra de equipo reparte lo que
// ve cada uno (con un pequeño retraso, como las llamadas por radio) y las marcas
// de drones y cámaras.
import { lineOfSight } from '../../world/raycast.js';
import { BONE } from '../skeleton.js';
import { thermalOn, THERMAL_SCOPE } from '../abilities.js';
import { KIT } from '../weapons.js';
import { DARK } from '../light.js';

export const MEMORY = 10;       // segundos que dura el recuerdo de dónde estaba un enemigo

export class Perception {
  constructor(op, game, diff) {
    this.op = op;
    this.game = game;
    this.diff = diff;
    this.visible = [];            // enemigos a la vista en el último barrido
    this.darkSeen = new Set();    // de ellos, a quién ve a oscuras (F10.4: reacciona 100 ms más tarde)
    this.memory = new Map();      // enemigo → {x, y, z, t, seen, precise}
    this.noises = [];             // [{x, y, z, t, loud, kind, src}]
    this.scanT = game.rng.next() * 0.12;
  }

  // Barrido de vista (escalonado cada ~0,12 s).
  scan(dt, enemies) {
    this.scanT -= dt;
    if (this.scanT > 0) return false;
    this.scanT = 0.12;
    const op = this.op, D = this.diff, w = this.game.world, now = this.game.time;
    const e = op.eyePos();
    const vx = -Math.sin(op.yaw), vz = -Math.cos(op.yaw);
    const cosFov = Math.cos(D.fov), L = this.game.light;
    this.visible.length = 0;
    this.darkSeen.clear();
    if (op.blindT > 0) return true;              // cegado: no ve nada
    for (const t of enemies) {
      const c = t.center();
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
      const dist = Math.hypot(dx, dy, dz);
      // a oscuras (atardecer y noche, sin láser ni fogonazo): a la mitad de distancia (F10.4)
      const dark = !!L && L.hides(t, now);
      if (dist > (dark ? D.range * DARK.rangeK : D.range)) continue;
      const hd = Math.hypot(dx, dz) || 1;
      const cos = (dx * vx + dz * vz) / hd;
      const known = this.memory.get(t);
      const recentlySeen = known && known.seen && now - known.t < 0.6;
      if (cos < cosFov && dist > 2.2 && !recentlySeen) continue;
      // la cabeza o el pecho a la vista
      const head = t.rig[BONE.head] ? t.rig[BONE.head].p : c;
      const chest = t.rig[BONE.chest] ? t.rig[BONE.chest].p : c;
      let seen = lineOfSight(w, e.x, e.y, e.z, head.x, head.y + 0.06, head.z);
      if (!seen) seen = lineOfSight(w, e.x, e.y, e.z, chest.x, chest.y, chest.z);
      if (!seen && t.state === 'downed') seen = lineOfSight(w, e.x, e.y, e.z, c.x, c.y, c.z);
      if (!seen) continue;
      if (this.smokeHides(e, head, chest, dist)) continue;   // tras el humo
      // de lejos, alguien agachado o tumbado quieto cuesta más de ver
      if (dist > 18 && (t.stance === 'prone' || t.state === 'downed') && t.moveSpeed < 0.2 && !recentlySeen && this.game.rng.next() < 0.5) continue;
      this.visible.push(t);
      if (dark) this.darkSeen.add(t);
      this.memory.set(t, { x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z, t: now, seen: true, precise: true });
    }
    // el haz de un láser a la vista, a 20 m o menos: sabe dónde está quien lo lleva (sin verlo)
    for (const t of enemies) {
      if (!t.laserOn || this.visible.includes(t) || !this._seesLaser(t, e, vx, vz, cosFov)) continue;
      this.memory.set(t, { x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z, t: now, seen: false, precise: true });
    }
    return true;
  }

  // ¿Tapa el humo la cabeza y el pecho de alguien a `dist` m? (LUMEN, con el visor, ve a través.)
  smokeHides(e, head, chest, dist) {
    const G = this.game.gadgets;
    if (!G || !G.smokes.length) return false;
    if (thermalOn(this.op) && dist <= THERMAL_SCOPE.range) return false;
    return G.smokeBlocks(e, head) && G.smokeBlocks(e, chest);
  }

  // ¿Ve algún punto del haz (o el punto rojo donde acaba)? Como mucho 3 líneas de visión.
  _seesLaser(t, e, vx, vz, cosFov) {
    const w = this.game.world, B = t.laserBeam(w, this.game.time), R = KIT.laserSeen;
    let tries = 0;
    for (const s of [B.len - 0.05, 0.3, 2, 5, 9, 14]) {
      if (s < 0 || s > B.len) continue;
      const px = B.o.x + B.d.x * s, py = B.o.y + B.d.y * s, pz = B.o.z + B.d.z * s;
      const dx = px - e.x, dy = py - e.y, dz = pz - e.z;
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      const hd = Math.hypot(dx, dz) || 1;
      if ((dx * vx + dz * vz) / hd < cosFov && hd > 1.5) continue;
      if (lineOfSight(w, e.x, e.y, e.z, px, py, pz)) return true;
      if (++tries >= 3) return false;
    }
    return false;
  }

  // Oye algo en `pos` con intensidad `loud` (0..1+). `src` puede ser el operador que lo hizo.
  hear(pos, kind, src, range) {
    const op = this.op;
    const b = op.body.pos;
    const d = Math.hypot(pos.x - b.x, (pos.y - b.y) * 1.3, pos.z - b.z);
    let r = range * this.diff.hearing;
    if (d > r) return;
    // a través de paredes se oye menos
    const e = op.eyePos();
    const clear = lineOfSight(this.game.world, e.x, e.y, e.z, pos.x, pos.y + 0.3, pos.z);
    if (!clear) r *= 0.62;
    if (d > r) return;
    const now = this.game.time;
    // de cerca se sabe bien de dónde viene, aunque sea a través de una pared
    const err = clear ? 0.4 : Math.min(1.6, 0.2 + d * 0.12);
    const rng = this.game.rng;
    const n = { x: pos.x + (rng.next() - 0.5) * err, y: pos.y, z: pos.z + (rng.next() - 0.5) * err, t: now, kind, src, d };
    this.noises.push(n);
    if (this.noises.length > 12) this.noises.shift();
    if (src && src.team !== op.team && src.state !== 'dead') {
      const m = this.memory.get(src);
      if (!m || now - m.t > 0.3) this.memory.set(src, { x: n.x, y: n.y, z: n.z, t: now, seen: false, precise: (clear && d < 12) || d < 6 });
    }
  }

  lastNoise(maxAge = 3) {
    const now = this.game.time;
    let best = null;
    for (const n of this.noises) if (now - n.t <= maxAge && (!best || n.t > best.t)) best = n;
    return best;
  }

  // Enemigo recordado más reciente (vivo), opcionalmente solo si es preciso y sin contar a
  // `skip` (el que acaba de ver y al que aún está reaccionando). La memoria se desvanece a los 10 s.
  freshest(maxAge = 4, precise = false, skip = null) {
    const now = this.game.time;
    let best = null, bt = -Infinity;
    for (const [t, m] of this.memory) {
      if (t.state === 'dead' || now - m.t > MEMORY) { this.memory.delete(t); continue; }
      if (t === skip || now - m.t > maxAge || (precise && !m.precise)) continue;
      if (m.t > bt) { bt = m.t; best = { op: t, ...m }; }
    }
    return best;
  }
}

// Pizarra de un equipo: dónde se ha visto a cada enemigo (lo que comunican los compañeros).
export class TeamBoard {
  constructor(team) {
    this.team = team;
    this.known = new Map();     // enemigo → {x, y, z, t, precise}
    this.pending = [];          // avistamientos que llegarán por radio
    this.plan = {};             // datos tácticos del bando (puntos, roles…)
  }
  reset() { this.known.clear(); this.pending = []; this.plan = {}; }
  // Un compañero ve a un enemigo: el resto lo sabrá en `delay` segundos.
  report(enemy, pos, now, precise = true, delay = 0.8) {
    this.pending.push({ enemy, x: pos.x, y: pos.y, z: pos.z, at: now + delay, t: now, precise });
  }
  tick(now) {
    if (!this.pending.length) return;
    const keep = [];
    for (const p of this.pending) {
      if (p.at > now) { keep.push(p); continue; }
      const k = this.known.get(p.enemy);
      if (!k || k.t <= p.t) this.known.set(p.enemy, { x: p.x, y: p.y, z: p.z, t: p.t, precise: p.precise });
    }
    this.pending = keep;
  }
  recent(now, maxAge = MEMORY) {
    const out = [];
    for (const [e, k] of this.known) {
      if (e.state === 'dead') { this.known.delete(e); continue; }
      if (now - k.t <= maxAge) out.push({ op: e, ...k });
    }
    return out;
  }
}

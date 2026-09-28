// Capa de depuración (tecla P). Solo lee la simulación, no la cambia:
//  · rejilla de navegación a menos de 14 m de la cámara (verde: de pie, amarillo: solo
//    agachado, magenta: barricada por romper, azul: pie de escalera de mano, cian: donde se
//    engancha una cuerda); se rehace cada 0,5 s o cuando la destrucción cambia la rejilla;
//  · la ruta que sigue cada bot (en cian, los pasos de cuerda: por la fachada hasta la ventana
//    o el tejado) y su cono de visión de 100° (rojo si tiene a alguien a tiro);
//  · una etiqueta sobre cada bot con su tarea, etapa, estado del movimiento y objetivo.
// Los FPS los muestra la línea de rendimiento, que se enciende con la capa.
import * as THREE from 'three';

const NAV_R = 14;            // radio (m) de la rejilla que se dibuja
const NAV_DY = 4.5;          // solo superficies a esta altura de la cámara (la planta actual y las vecinas)
const MAX_PTS = 7000;
const MAX_SEG = 5000;
const CONE_LEN = 9;
const TEAM_RGB = [[0.25, 0.62, 1.0], [1.0, 0.55, 0.15]];
const ROPE_RGB = [0.2, 0.95, 0.95];
// Un punto de la cuerda de un paso de rappel (en el plano donde cuelga el cuerpo).
const ropeAt = (rp, s, y) => (rp.axis === 'x' ? { x: s, y, z: rp.line + rp.out * rp.plane } : { x: rp.line + rp.out * rp.plane, y, z: s });

export class DebugView {
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    ctx.scene.add(this.group);
    // puntos de la rejilla
    this.ptPos = new Float32Array(MAX_PTS * 3);
    this.ptCol = new Float32Array(MAX_PTS * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.ptCol, 3));
    pg.setDrawRange(0, 0);
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.5, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    // rutas y conos (se ven a través de las paredes)
    this.lnPos = new Float32Array(MAX_SEG * 6);
    this.lnCol = new Float32Array(MAX_SEG * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lnPos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lnCol, 3));
    lg.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.group.add(this.lines);
    this.navT = 0;
    this.navKey = '';
    this.labels = [];
    this.labelRoot = document.getElementById('dbg');
    this._v = new THREE.Vector3();
    this.stats = { points: 0, segments: 0, labels: 0 };
  }

  toggle(v = !this.on) {
    this.on = v;
    this.group.visible = v;
    this.navKey = '';
    if (this.labelRoot) this.labelRoot.classList.toggle('hidden', !v);
    if (!v) this._hideLabels(0);
  }

  update(dt, session, camera) {
    if (!this.on) return;
    const nav = this.ctx.nav;
    // rejilla: cada 0,5 s, o antes si la cámara ha cambiado mucho de sitio o la rejilla de versión
    this.navT -= dt;
    const cp = camera.position;
    const key = `${nav ? nav.version : 0}|${Math.round(cp.x / 3)}|${Math.round(cp.y / 2)}|${Math.round(cp.z / 3)}`;
    if (nav && (this.navT <= 0 || key !== this.navKey)) { this.navT = 0.5; this.navKey = key; this._buildNav(nav, cp); }
    // bots
    const bots = session && session.bots ? [...session.bots.brains.values()] : [];
    let s = 0;
    const seg = (a, b, c) => {
      if (s >= MAX_SEG) return;
      const o = s * 6;
      this.lnPos[o] = a.x; this.lnPos[o + 1] = a.y; this.lnPos[o + 2] = a.z;
      this.lnPos[o + 3] = b.x; this.lnPos[o + 4] = b.y; this.lnPos[o + 5] = b.z;
      this.lnCol[o] = this.lnCol[o + 3] = c[0]; this.lnCol[o + 1] = this.lnCol[o + 4] = c[1]; this.lnCol[o + 2] = this.lnCol[o + 5] = c[2];
      s++;
    };
    const labels = [];
    for (const B of bots) {
      const op = B.op;
      if (op.state === 'dead') continue;
      const col = TEAM_RGB[op.team] || TEAM_RGB[0];
      // ruta pendiente
      const path = B.mover && B.mover.path;
      if (path && B.mover.busy) {
        let prev = { x: op.body.pos.x, y: op.body.pos.y + 0.1, z: op.body.pos.z };
        for (let k = B.mover.i; k < path.length; k++) {
          const q = path[k];
          const cur = { x: q.x, y: q.y + 0.1, z: q.z };
          if (q.kind === 'rappel' && q.rp) {
            // por la fachada: al pie (o al pretil), arriba o abajo, de lado hasta la ventana y dentro
            const rp = q.rp, pts = [];
            if (!op.rappel) { pts.push(ropeAt(rp, rp.s0, rp.y0 + 0.9)); pts.push(ropeAt(rp, rp.s0, rp.y1 + 0.9)); }
            pts.push(ropeAt(rp, rp.s1, rp.y1 + 0.9));
            for (const r of pts) { seg(prev, r, ROPE_RGB); prev = r; }
            seg(prev, cur, ROPE_RGB);
            prev = cur;
            continue;
          }
          seg(prev, cur, q.kind === 'break' ? [1, 0.2, 0.9] : q.kind === 'ladder' ? [0.3, 0.5, 1] : col);
          prev = cur;
        }
      }
      // yendo a una ventana del sitio con cuerda: el tramo por la fachada que le espera
      const P = B.ropePlan;
      if (P && !P.done && !P.failed && !op.rappel && !(path && path.some((q) => q.kind === 'rappel'))) {
        const rp = P.rp, h = rp.hook;
        if (h) {
          const nx = rp.axis === 'x' ? 0 : rp.out, nz = rp.axis === 'x' ? rp.out : 0, w = rp.win;
          const pts = [{ x: h.x, y: h.y + 0.1, z: h.z }, ropeAt(rp, rp.s0, rp.y0 + 0.9), ropeAt(rp, rp.s0, rp.y1 + 0.9), ropeAt(rp, rp.s1, rp.y1 + 0.9)];
          if (w) pts.push({ x: w.x - nx * 0.9, y: rp.toY + 0.1, z: w.z - nz * 0.9 });
          for (let k = 1; k < pts.length; k++) seg(pts[k - 1], pts[k], ROPE_RGB);
        }
      }
      // cono de visión (bordes y arco)
      if (op.state === 'alive') {
        const e = op.eyePos();
        const half = B.diff ? B.diff.fov : 50 * Math.PI / 180;
        const cc = B.target ? [1, 0.2, 0.15] : col;
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const a = op.yaw - half + (2 * half * k) / 8;
          pts.push({ x: e.x - Math.sin(a) * CONE_LEN, y: e.y, z: e.z - Math.cos(a) * CONE_LEN });
        }
        seg(e, pts[0], cc); seg(e, pts[8], cc);
        for (let k = 0; k < 8; k++) seg(pts[k], pts[k + 1], cc);
        if (B.target) { const c = B.target.center(); seg(e, c, [1, 0.2, 0.15]); }
      }
      labels.push({ op, text: describe(B) });
    }
    const lg = this.lines.geometry;
    lg.attributes.position.needsUpdate = true;
    lg.attributes.color.needsUpdate = true;
    lg.setDrawRange(0, s * 2);
    this.stats.segments = s;
    this._labels(labels, camera);
  }

  _buildNav(nav, cp) {
    const cell = 0.5;
    const cx0 = Math.max(0, Math.floor((cp.x - NAV_R - nav.x0) / cell)), cx1 = Math.min(nav.ncx - 1, Math.floor((cp.x + NAV_R - nav.x0) / cell));
    const cz0 = Math.max(0, Math.floor((cp.z - NAV_R - nav.z0) / cell)), cz1 = Math.min(nav.ncz - 1, Math.floor((cp.z + NAV_R - nav.z0) / cell));
    const ladders = new Set((nav.ladderNodes || []).map((n) => n.id));
    const ropes = new Set((nav.rappelNodes || []).map((n) => n.id));
    let k = 0;
    for (let cz = cz0; cz <= cz1 && k < MAX_PTS; cz++) {
      for (let cx = cx0; cx <= cx1 && k < MAX_PTS; cx++) {
        const list = nav.cols[nav.colIndex(cx, cz)];
        if (!list) continue;
        for (const n of list) {
          if (!n.alive || Math.abs(n.y - (cp.y - 1.6)) > NAV_DY) continue;
          const o = k * 3;
          this.ptPos[o] = n.px; this.ptPos[o + 1] = n.y + 0.06; this.ptPos[o + 2] = n.pz;
          let c = n.crouch ? [1, 0.85, 0.2] : [0.3, 1, 0.45];
          if (ladders.has(n.id)) c = [0.3, 0.55, 1];
          else if (ropes.has(n.id)) c = ROPE_RGB;
          else if (n.edges.some((e) => e.kind === 'break')) c = [1, 0.25, 0.9];
          this.ptCol[o] = c[0]; this.ptCol[o + 1] = c[1]; this.ptCol[o + 2] = c[2];
          if (++k >= MAX_PTS) break;
        }
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, k);
    this.stats.points = k;
  }

  _labels(list, camera) {
    const root = this.labelRoot;
    if (!root) return;
    const W = window.innerWidth, H = window.innerHeight, V = this._v;
    while (this.labels.length < list.length) {
      const d = document.createElement('div');
      d.className = 'dl';
      d.style.display = 'none';
      root.appendChild(d);
      this.labels.push({ el: d, text: '', shown: false });
    }
    let n = 0;
    for (const it of list) {
      const p = it.op.body.pos;
      V.set(p.x, p.y + 2.25, p.z).project(camera);
      if (V.z > 1 || Math.abs(V.x) > 1.05 || Math.abs(V.y) > 1.05) continue;
      const L = this.labels[n++];
      if (L.text !== it.text) { L.text = it.text; L.el.textContent = it.text; L.el.className = 'dl t' + it.op.team; }
      if (!L.shown) { L.el.style.display = ''; L.shown = true; }
      L.el.style.left = `${((V.x + 1) / 2 * W).toFixed(1)}px`;
      L.el.style.top = `${((1 - V.y) / 2 * H).toFixed(1)}px`;
    }
    this._hideLabels(n);
    this.stats.labels = n;
  }
  _hideLabels(from) {
    for (let i = from; i < this.labels.length; i++) {
      const L = this.labels[i];
      if (L.shown) { L.el.style.display = 'none'; L.shown = false; }
    }
  }

  dispose() {
    this.toggle(false);
    this.ctx.scene.remove(this.group);
    this.points.geometry.dispose(); this.points.material.dispose();
    this.lines.geometry.dispose(); this.lines.material.dispose();
  }
}

// «NOMBRE · tarea/etapa · movimiento → objetivo» (y el papel en defensa)
const TASK = {
  post: 'puesto', fortify: 'fortificar', anchor: 'ancla', roam: 'merodear', hunt: 'cazar', disable: 'inutilizar',
  revive: 'reanimar', approach: 'acercarse', stack: 'agruparse', clear: 'despejar', siteHold: 'sostener', plant: 'plantar',
  guard: 'vigilar', pickup: 'recoger', follow: 'orden: seguir', holdHere: 'orden: mantener', gotoMark: 'orden: ir a la marca',
  rope: 'rappel',
};
const STAGE = { approach: 'acercarse', stack: 'agruparse', clear: 'despejar', hold: 'sostener', rope: 'rappel' };
// Colgado de la cuerda: qué hace.
function ropeState(B) {
  const R = B.op.rappel, S = B.mover && B.mover.rope;
  if (R.phase === 'hookGround' || R.phase === 'hookTop') return 'enganchándose';
  if (R.phase === 'enter' || R.phase === 'breach') return 'entrando por la ventana';
  if (R.phase === 'climbTop') return 'subiendo al tejado';
  if (S && S.down) return 'bajando de la cuerda';
  if (S && S.waiting && S.arrived) return `esperando en la cuerda (${Math.ceil(S.waitT)} s)`;
  return 'en la cuerda';
}
const ROLE = { anchor: 'ancla', roam: 'merodeador' };
const MOVE = { idle: 'quieto', planning: 'calculando ruta', moving: 'andando', arrived: 'en su sitio', failed: 'sin ruta' };
export function describe(B) {
  const op = B.op;
  const parts = [op.name];
  if (op.state === 'downed') parts.push('derribado');
  else if (op.frozen) parts.push(B.side === 'atk' ? 'pilotando el dron' : 'esperando');
  else {
    const k = B.task ? B.task.kind : null;
    let t = k ? TASK[k] || k : 'sin tarea';
    if (B.stage && B.side === 'atk' && ['approach', 'stack', 'clear', 'siteHold'].includes(k)) t = STAGE[B.stage] || B.stage;
    if (B.role && B.side === 'def') t += ` (${ROLE[B.role] || B.role})`;
    parts.push(t);
    if (op.rappel) parts.push(ropeState(B));
    else if (B.mover) parts.push(MOVE[B.mover.status] || B.mover.status);
  }
  let s = parts.join(' · ');
  if (B.target && B.target.state !== 'dead') s += ` → ${B.target.name}`;
  return s;
}

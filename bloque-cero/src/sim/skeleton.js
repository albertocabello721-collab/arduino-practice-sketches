// Esqueleto del operador y cálculo de pose (sin Three.js). La misma pose sirve para
// las zonas de impacto (simulación) y para el modelo 3D (render): las balas dan
// exactamente donde se ve el cuerpo.
//
// Espacio del personaje: adelante = -Z, derecha = +X, arriba = +Y (como la cámara).
// Los huesos de las extremidades apuntan a -Y en su espacio local.
// Matrices 4×4 en orden de columnas (compatible con Three.js).

import { reloadHand, reloadTilt, reloadMag, actionPose } from './poselayers.js';

export const BONE = {
  pelvis: 0, spine: 1, chest: 2, neck: 3, head: 4,
  uarmL: 5, farmL: 6, handL: 7, uarmR: 8, farmR: 9, handR: 10,
  thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16,
  gun: 17, holster: 18,
  mag: 19,        // el cargador del arma principal (lo coloca el dibujo: en el arma, en la mano o fuera)
};
export const BONE_COUNT = 20;

const UARM = 0.29, FARM = 0.27, THIGH = 0.43, SHIN = 0.44;

// ------------------------------------------------------------ álgebra mínima
function v(x = 0, y = 0, z = 0) { return { x, y, z }; }
function add(a, b) { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
function sub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
function mul(a, s) { return v(a.x * s, a.y * s, a.z * s); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a, b) { return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
function len(a) { return Math.hypot(a.x, a.y, a.z); }
function norm(a) { const l = len(a) || 1; return v(a.x / l, a.y / l, a.z / l); }
// Rotación como tres ejes (columnas): r = {x: eje X, y: eje Y, z: eje Z}
function rotMul(A, B) {
  // A*B aplicado a los ejes de B
  const ap = (c) => v(A.x.x * c.x + A.y.x * c.y + A.z.x * c.z, A.x.y * c.x + A.y.y * c.y + A.z.y * c.z, A.x.z * c.x + A.y.z * c.y + A.z.z * c.z);
  return { x: ap(B.x), y: ap(B.y), z: ap(B.z) };
}
function rotApply(R, p) { return v(R.x.x * p.x + R.y.x * p.y + R.z.x * p.z, R.x.y * p.x + R.y.y * p.y + R.z.y * p.z, R.x.z * p.x + R.y.z * p.y + R.z.z * p.z); }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return { x: v(c, 0, -s), y: v(0, 1, 0), z: v(s, 0, c) }; }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return { x: v(1, 0, 0), y: v(0, c, s), z: v(0, -s, c) }; }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return { x: v(c, s, 0), y: v(-s, c, 0), z: v(0, 0, 1) }; }
const IDENT = { x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) };
// Base cuyo eje -Y apunta a `dir`, con el eje Z lo más parecido posible a `hint`.
function basisDown(dir, hint) {
  const y = mul(norm(dir), -1);
  let z = sub(hint, mul(y, dot(hint, y)));
  if (len(z) < 1e-4) z = Math.abs(y.x) < 0.9 ? v(1, 0, 0) : v(0, 0, 1);
  z = norm(z);
  const x = cross(y, z);
  return { x, y, z };
}
// Base cuyo eje -Z apunta a `fwd` con el eje Y lo más parecido a `up`.
function basisForward(fwd, up) {
  const z = mul(norm(fwd), -1);
  let y = sub(up, mul(z, dot(up, z)));
  y = norm(len(y) < 1e-4 ? v(0, 1, 0) : y);
  const x = cross(y, z);
  return { x, y, z };
}

// Resuelve dos huesos (hombro→codo→mano o cadera→rodilla→pie).
function ik2(root, target, a, b, pole) {
  let d = sub(target, root);
  let dist = len(d);
  const maxR = a + b - 1e-3, minR = Math.abs(a - b) + 1e-3;
  if (dist > maxR) { d = mul(d, maxR / dist); dist = maxR; }
  if (dist < minR) { d = mul(norm(d), minR); dist = minR; }
  const dn = mul(d, 1 / dist);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let pp = sub(pole, mul(dn, dot(pole, dn)));
  pp = len(pp) < 1e-4 ? v(0, -1, 0) : norm(pp);
  const elbow = add(root, add(mul(dn, a * cosA), mul(pp, a * sinA)));
  return { elbow, end: add(root, d) };
}

// ------------------------------------------------------------ estado de pose
export function makePoseState() {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    crouch: 0,        // 0 de pie … 1 agachado
    prone: 0,         // 0 … 1 cuerpo a tierra
    lean: 0,          // desplazamiento lateral real de la cabeza (-1..1 de LEAN)
    walkPhase: 0, walkAmount: 0, strafe: 0, sprint: 0,
    ads: 0, weaponCls: 'rifle',
    downed: 0, dead: 0, deathDir: 1, deathSide: 0,
    eyeHeight: 1.64, hurt: 0, crawl: 0,
    // capas de la tercera persona (F7.4, ver poselayers.js y Operator.updatePose)
    acts: {},         // acción de las manos → {w (peso 0..1), t, dur}; la anterior se desvanece
    rl: null, rlT: 0, rlW: 0,   // recarga por partes: pista (reloadTrack), instante y peso
    magOut: false,    // el arma se quedó sin cargador (recarga interrumpida tras sacarlo)
    mag: 0,           // (salida) cargador: 0 en el arma · 1 el nuevo, en la mano · 2 fuera
    equip: 0,         // 1 al cambiar de arma (la nueva sube desde abajo) … 0 lista
    kick: 0,          // retroceso del disparo (1 al disparar, se va en 0,14 s)
    breath: 0,        // reloj de la respiración en reposo
    vault: 0,         // progreso del salto de obstáculo (0..1)
  };
}

/**
 * Calcula las matrices de mundo de los huesos (Float32Array de BONE_COUNT×16) y
 * también las guarda como {p, R} en `rig` para las zonas de impacto.
 */
export function computePose(s, out, rig) {
  const root = v(s.x, s.y, s.z);
  const Ryaw = rotY(s.yaw);
  const bones = rig || new Array(BONE_COUNT);
  const set = (i, p, R) => {
    bones[i] = { p, R };
    if (out) {
      const o = i * 16;
      out[o] = R.x.x; out[o + 1] = R.x.y; out[o + 2] = R.x.z; out[o + 3] = 0;
      out[o + 4] = R.y.x; out[o + 5] = R.y.y; out[o + 6] = R.y.z; out[o + 7] = 0;
      out[o + 8] = R.z.x; out[o + 9] = R.z.y; out[o + 10] = R.z.z; out[o + 11] = 0;
      out[o + 12] = p.x; out[o + 13] = p.y; out[o + 14] = p.z; out[o + 15] = 1;
    }
  };
  const W = (local) => add(root, rotApply(Ryaw, local)); // local del personaje → mundo
  const fwdW = rotApply(Ryaw, v(0, 0, -1)), rightW = rotApply(Ryaw, v(1, 0, 0)), upW = v(0, 1, 0);

  const prone = Math.max(s.prone, s.downed * 0.0);
  const crouch = s.crouch * (1 - prone);
  const down = s.downed;
  const dead = s.dead;
  // capa de acciones (poselayers.js): la pose de cada acción activa con su peso, y cuánto
  // inclinan el tronco y bajan la cadera (solo de pie o agachado)
  const acts = [];
  let bend = 0, lower = 0;
  for (const k in s.acts) {
    const a = s.acts[k];
    if (!(a.w > 0)) continue;
    const P = actionPose(k, a.t, a.dur);
    if (!P) continue;
    acts.push({ w: a.w, P });
    bend += (P.bend || 0) * a.w; lower += (P.lower || 0) * a.w;
  }
  const upright = (1 - prone) * (1 - down) * (1 - dead);
  bend *= upright; lower *= upright;

  // --------------------------------------------------- tronco
  // altura de pelvis: de pie 0,95, agachado 0,58, tumbado 0,16, derribado 0,2
  const walkBob = Math.abs(Math.sin(s.walkPhase)) * 0.035 * s.walkAmount * (1 - prone);
  let pelvisH = 0.95 * (1 - crouch) + 0.6 * crouch - walkBob - lower;
  pelvisH = pelvisH * (1 - prone) + 0.16 * prone;
  pelvisH = pelvisH * (1 - down) + 0.2 * down;
  // inclinación del tronco: al esprintar hacia delante; agachado un poco; tumbado horizontal
  let trunkPitch = -0.1 * s.sprint - 0.12 * crouch - bend;                // negativo = hacia delante
  trunkPitch = trunkPitch * (1 - prone) - (Math.PI / 2 - 0.02) * prone;
  trunkPitch = trunkPitch * (1 - down) - 1.15 * down;                     // derribado: casi tumbado, algo incorporado
  // muerte: cae hacia atrás (deathDir 1) o hacia delante (-1)
  const deadPitch = s.deathDir > 0 ? 1.45 : -1.5;
  trunkPitch = trunkPitch * (1 - dead) + deadPitch * dead;
  pelvisH = pelvisH * (1 - dead) + 0.13 * dead;
  // asomarse: balanceo lateral del tronco desde la base de la columna
  const leanDist = s.lean * 0.38;
  const spineBase = pelvisH + 0.08;
  const leanArm = Math.max(0.35, s.eyeHeight - spineBase);
  const leanRoll = Math.asin(Math.max(-0.9, Math.min(0.9, leanDist / leanArm))) * (1 - prone) * (1 - down) * (1 - dead);
  const deathRoll = dead * s.deathSide * 0.5;
  const trunkR = rotMul(Ryaw, rotMul(rotZ(-leanRoll - deathRoll), rotX(trunkPitch)));
  const pelvisP = W(v(0, pelvisH, prone * 0.15 + down * 0.1));
  // pelvis: gira con el tronco pero sin el balanceo del asomado
  const pelvisR = rotMul(Ryaw, rotX(trunkPitch * (prone > 0.5 || down > 0.5 || dead > 0.5 ? 1 : 0.35)));
  set(BONE.pelvis, pelvisP, pelvisR);
  const spineP = add(pelvisP, rotApply(pelvisR, v(0, 0.08, 0)));
  set(BONE.spine, spineP, trunkR);
  // pecho: sigue la mirada vertical (la mitad), salvo tumbado/derribado
  const aimPitch = s.pitch * (1 - dead);
  // respiración en reposo (casi nada al moverse o apuntar) y el culatazo del disparo (hombros atrás)
  const breathe = Math.sin(s.breath * Math.PI * 2 / 3.6) * 0.012 * (1 - s.walkAmount) * (1 - s.ads * 0.8) * upright;
  const chestPitch = aimPitch * 0.45 * (1 - down) + breathe + 0.03 * s.kick * upright;
  const chestR = rotMul(trunkR, rotX(chestPitch));
  const chestP = add(spineP, rotApply(trunkR, v(0, 0.2, 0)));
  set(BONE.chest, chestP, chestR);
  const neckP = add(chestP, rotApply(chestR, v(0, 0.26, 0)));
  // cabeza: mira al frente aunque el tronco esté tumbado; completa el pitch de la mirada
  let headR = rotMul(Ryaw, rotMul(rotZ(-leanRoll * 0.6), rotX(aimPitch)));
  if (prone > 0 || down > 0) {
    const lying = rotMul(chestR, rotX(Math.PI / 2 * 0.85 * Math.max(prone, down) + aimPitch * 0.5));
    headR = blendRot(headR, lying, Math.max(prone, down) * 0.5);
  }
  if (dead > 0) headR = blendRot(headR, rotMul(chestR, rotX(0.3 * s.deathDir)), dead);
  set(BONE.neck, neckP, chestR);
  const headP = add(neckP, rotApply(chestR, v(0, 0.08, 0)));
  set(BONE.head, headP, headR);

  // --------------------------------------------------- piernas (IK hacia los pies)
  const phase = s.walkPhase, amt = s.walkAmount * (1 - prone) * (1 - down) * (1 - dead);
  for (const side of [-1, 1]) {
    const hipLocal = rotApply(pelvisR, v(side * 0.1, -0.06, 0));
    const hip = add(pelvisP, hipLocal);
    const ph = phase + (side < 0 ? 0 : Math.PI);
    const stride = (0.28 + s.sprint * 0.22) * amt;
    const lift = Math.max(0, Math.sin(ph)) * (0.1 + s.sprint * 0.08) * amt;
    // pie objetivo en coordenadas del personaje (suelo = 0)
    let foot = v(side * (0.13 + crouch * 0.06) + s.strafe * Math.cos(ph) * 0.1 * amt, 0.07 + lift, -Math.cos(ph) * stride + crouch * 0.12);
    // saltando un obstáculo: las piernas se recogen
    if (s.vault > 0) { const k = Math.sin(Math.PI * s.vault); foot = add(foot, v(0, 0.32 * k, -0.12 * k)); }
    let footW = W(foot);
    let pole = add(fwdW, mul(rightW, side * 0.25));
    if (prone > 0.01 || down > 0.01 || dead > 0.01) {
      // tumbado/derribado/muerto: piernas estiradas hacia atrás a partir de la pelvis
      const back = rotApply(pelvisR, v(side * 0.12, -(THIGH + SHIN) * 0.98, 0.04));
      const lyingFoot = add(hip, back);
      const k = Math.max(prone, down, dead);
      footW = add(mul(footW, 1 - k), mul(lyingFoot, k));
      // crawl: arrastrar las piernas un poco
      if (down > 0) footW = add(footW, mul(fwdW, Math.sin(s.walkPhase * 0.7 + (side < 0 ? 0 : Math.PI)) * 0.1 * s.crawl));
      pole = add(mul(pole, 1 - k), mul(rotApply(pelvisR, v(0, 0, -1)), k));
    }
    const { elbow: knee, end } = ik2(hip, footW, THIGH, SHIN, pole);
    const thighR = basisDown(sub(knee, hip), fwdW);
    const shinR = basisDown(sub(end, knee), fwdW);
    set(side < 0 ? BONE.thighL : BONE.thighR, hip, thighR);
    set(side < 0 ? BONE.shinL : BONE.shinR, knee, shinR);
    const footR = basisForward(prone > 0.5 || down > 0.5 || dead > 0.5 ? rotApply(pelvisR, v(0, -1, 0.2)) : fwdW, upW);
    set(side < 0 ? BONE.footL : BONE.footR, end, footR);
  }

  // --------------------------------------------------- brazos (IK a la empuñadura del arma)
  const cls = s.weaponCls;
  const pistol = cls === 'pistol';
  // posición del arma en el espacio del pecho (adelante -Z)
  const ads = s.ads;
  // armas largas al hombro (como en Siege); al apuntar suben a la línea de la mejilla
  const hold = pistol
    ? { grip: v(0.08 - 0.07 * ads, 0.14 + 0.08 * ads, -0.4 - 0.06 * ads), fore: v(0.05 - 0.06 * ads, 0.12 + 0.08 * ads, -0.38 - 0.06 * ads) }
    : { grip: v(0.13 - 0.05 * ads, 0.1 + 0.08 * ads, -0.17), fore: v(0.04 - 0.03 * ads, 0.14 + 0.08 * ads, -0.47) };
  // al esprintar: arma baja cruzada
  if (s.sprint > 0) {
    hold.grip = lerpV(hold.grip, v(0.14, -0.06, -0.14), s.sprint);
    hold.fore = lerpV(hold.fore, v(-0.08, 0.02, -0.38), s.sprint);
  }
  // cambiar de arma: la que llega sube desde abajo, con la boca hacia el suelo
  if (s.equip > 0) {
    hold.grip = lerpV(hold.grip, v(0.12, -0.14, -0.14), s.equip);
    hold.fore = lerpV(hold.fore, v(0.03, -0.17, -0.36), s.equip);
  }
  // retroceso: las manos y el arma van hacia el hombro
  if (s.kick > 0) {
    const kb = v(0, 0.012 * s.kick, 0.035 * s.kick);
    hold.grip = add(hold.grip, kb); hold.fore = add(hold.fore, kb);
  }
  const armBase = down > 0 || dead > 0 ? 1 : 0;
  let gripW = add(chestP, rotApply(chestR, hold.grip));
  let foreW = add(chestP, rotApply(chestR, hold.fore));
  // el arma en la mano derecha, apuntando al guardamanos (la pose base, sin capas)
  let gunP = gripW;
  let gunR = basisForward(pistol ? rotApply(chestR, v(0, 0, -1)) : sub(foreW, gripW), rotApply(chestR, v(0, 1, 0)));
  // capa de la recarga por partes: el arma se inclina y la mano izquierda va al cargador, al
  // bolsillo, a la palanca… (en el espacio del arma o del pecho)
  const rw = s.rl && !armBase ? s.rlW : 0;
  if (rw > 0) {
    const tl = reloadTilt(s.rl, s.rlT);
    gunR = rotMul(gunR, rotMul(rotZ(tl.roll * rw), rotX(tl.pitch * rw)));
    const baseFore = foreW;
    const toWorld = (a) => (a == null ? baseFore : a.g ? add(gunP, rotApply(gunR, v(a.g[0], a.g[1], a.g[2]))) : add(chestP, rotApply(chestR, v(a.c[0], a.c[1], a.c[2]))));
    foreW = lerpV(foreW, reloadHand(s.rl, s.rlT, toWorld), rw);
  }
  s.mag = s.rl && s.rlW > 0 && !armBase ? reloadMag(s.rl, s.rlT) : (s.magOut ? 2 : 0);
  // capa de acciones: las manos a lo que hacen; con las dos, el arma cuelga al costado derecho
  if (acts.length && !armBase) {
    let aL = v(), aR = v(), wl = 0, wr = 0, away = 0;
    for (const { w, P } of acts) {
      if (P.L && P.wL > 0) { aL = add(aL, mul(add(chestP, rotApply(chestR, v(P.L[0], P.L[1], P.L[2]))), w * P.wL)); wl += w * P.wL; }
      if (P.R && P.wR > 0) { aR = add(aR, mul(add(chestP, rotApply(chestR, v(P.R[0], P.R[1], P.R[2]))), w * P.wR)); wr += w * P.wR; }
      away += w * (P.away || 0);
    }
    if (wl > 0) foreW = lerpV(foreW, mul(aL, 1 / wl), Math.min(1, wl));
    if (wr > 0) gripW = lerpV(gripW, mul(aR, 1 / wr), Math.min(1, wr));
    if (away > 0) {
      const k = Math.min(1, away);
      gunP = lerpV(gunP, add(chestP, rotApply(chestR, v(0.24, -0.2, 0.04))), k);
      gunR = blendRot(gunR, rotMul(chestR, basisForward(v(0.05, -0.97, 0.25), v(1, 0, 0))), k);
    }
  }
  if (armBase) {
    // derribado: mano derecha sobre la herida; izquierda apoyada en el suelo
    const wound = add(chestP, rotApply(chestR, v(0.05, 0.08, -0.14)));
    const floorL = add(W(v(-0.35, 0.02, -0.25 + Math.sin(s.walkPhase * 0.7) * 0.12 * s.crawl)), v(0, 0, 0));
    const k = Math.max(down, dead);
    gripW = add(mul(gripW, 1 - k), mul(wound, k));
    foreW = add(mul(foreW, 1 - k), mul(dead > 0 ? add(chestP, rotApply(chestR, v(-0.45, -0.1, 0.1))) : floorL, k));
    gunR = rotMul(chestR, rotX(-0.6));
    gunP = add(pelvisP, rotApply(pelvisR, v(0.25, 0.05, 0.05)));
  }
  for (const side of [-1, 1]) {
    const sh = add(chestP, rotApply(chestR, v(side * 0.2, 0.19, 0.02)));
    const target = side > 0 ? gripW : foreW;
    const pole = add(mul(upW, -1), mul(rotApply(chestR, v(side, 0, 0)), 0.9));
    const { elbow, end } = ik2(sh, target, UARM, FARM, pole);
    const uR = basisDown(sub(elbow, sh), rotApply(chestR, v(0, 0, -1)));
    const fR = basisDown(sub(end, elbow), rotApply(chestR, v(0, 0, -1)));
    set(side < 0 ? BONE.uarmL : BONE.uarmR, sh, uR);
    set(side < 0 ? BONE.farmL : BONE.farmR, elbow, fR);
    set(side < 0 ? BONE.handL : BONE.handR, end, fR);
  }
  // --------------------------------------------------- armas
  set(BONE.gun, gunP, gunR);
  // funda en el muslo derecho
  const th = bones[BONE.thighR];
  set(BONE.holster, add(th.p, rotApply(th.R, v(0.1, -0.12, 0))), rotMul(th.R, rotX(Math.PI)));
  return bones;
}

function lerpV(a, b, t) { return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
function blendRot(A, B, t) {
  // mezcla aproximada de bases (se reortonormaliza)
  const z = norm(lerpV(A.z, B.z, t)), yh = lerpV(A.y, B.y, t);
  let y = sub(yh, mul(z, dot(yh, z)));
  y = norm(len(y) < 1e-4 ? A.y : y);
  return { x: cross(y, z), y, z };
}

// ------------------------------------------------------------ zonas de impacto
// Cajas orientadas en el espacio de cada hueso: [hueso, centro local, semiejes, zona]
export const HITBOXES = [
  [BONE.head, v(0, 0.11, -0.01), v(0.115, 0.13, 0.125), 'head'],
  [BONE.neck, v(0, 0.04, 0), v(0.06, 0.06, 0.06), 'body'],
  [BONE.chest, v(0, 0.1, 0.01), v(0.22, 0.17, 0.15), 'body'],
  [BONE.spine, v(0, 0.08, 0), v(0.18, 0.12, 0.13), 'body'],
  [BONE.pelvis, v(0, -0.02, 0), v(0.18, 0.1, 0.13), 'body'],
  [BONE.uarmL, v(0, -UARM / 2, 0), v(0.06, UARM / 2, 0.06), 'limb'],
  [BONE.farmL, v(0, -FARM / 2, 0), v(0.05, FARM / 2, 0.05), 'limb'],
  [BONE.uarmR, v(0, -UARM / 2, 0), v(0.06, UARM / 2, 0.06), 'limb'],
  [BONE.farmR, v(0, -FARM / 2, 0), v(0.05, FARM / 2, 0.05), 'limb'],
  [BONE.thighL, v(0, -THIGH / 2, 0), v(0.08, THIGH / 2, 0.08), 'limb'],
  [BONE.shinL, v(0, -SHIN / 2, 0), v(0.06, SHIN / 2, 0.065), 'limb'],
  [BONE.thighR, v(0, -THIGH / 2, 0), v(0.08, THIGH / 2, 0.08), 'limb'],
  [BONE.shinR, v(0, -SHIN / 2, 0), v(0.06, SHIN / 2, 0.065), 'limb'],
];

/** Rayo contra las zonas de impacto del rig. Devuelve {t, zone, part} o null. */
export function rayHitRig(rig, o, d, maxT) {
  let best = null;
  for (let k = 0; k < HITBOXES.length; k++) {
    const [bi, c, h, zone] = HITBOXES[k];
    const b = rig[bi];
    if (!b) continue;
    const center = add(b.p, rotApply(b.R, c));
    const R = b.R;
    // rayo en el espacio de la caja
    const rel = sub(o, center);
    const ox = dot(rel, R.x), oy = dot(rel, R.y), oz = dot(rel, R.z);
    const dx = dot(d, R.x), dy = dot(d, R.y), dz = dot(d, R.z);
    let t0 = 0, t1 = maxT;
    const slab = (oo, dd, hh) => {
      if (Math.abs(dd) < 1e-9) return oo >= -hh && oo <= hh;
      let a = (-hh - oo) / dd, bb = (hh - oo) / dd;
      if (a > bb) { const t = a; a = bb; bb = t; }
      if (a > t0) t0 = a;
      if (bb < t1) t1 = bb;
      return t0 <= t1;
    };
    if (!slab(ox, dx, h.x) || !slab(oy, dy, h.y) || !slab(oz, dz, h.z)) continue;
    if (!best || t0 < best.t) best = { t: t0, zone, part: k };
  }
  return best;
}

/** Centro aproximado de una zona (para la IA: apuntar a la cabeza o al pecho). */
export function zoneCenter(rig, part) {
  const [bi, c] = HITBOXES[part];
  const b = rig[bi];
  return add(b.p, rotApply(b.R, c));
}

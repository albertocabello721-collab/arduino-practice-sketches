// F12.1 · Impactos: las cuentas de lo que se siente al dar y al recibir balazos (la sacudida de la
// vista, de qué lado viene, la poca vida, las balas que pasan cerca y el tirón del alcanzado).
// Todo es presentación: aquí solo las cuentas; el sonido y el dibujo, en tools/medir-impactos.mjs y
// tools/smoke-impactos.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEL, hitKick, hitSide, kickFrom, lowHealth, nearMiss, joltAt } from '../src/client/feel.js';

const DEG = Math.PI / 180;
const at = (x, z, yaw = 0) => ({ body: { pos: { x, y: 0, z } }, yaw });

test('la tabla: 2° de sacudida como mucho, pitido desde 40 de daño, poca vida por debajo de 30, chasquido a 1,5 m', () => {
  assert.deepEqual({ kickMax: FEEL.kickMax, ringFrom: FEEL.ringFrom, lowHp: FEEL.lowHp, crackDist: FEEL.crackDist }, { kickMax: 2, ringFrom: 40, lowHp: 30, crackDist: 1.5 });
});

test('la sacudida crece con el daño y no pasa de 2°', () => {
  assert.equal(hitKick(0), 0);
  assert.ok(Math.abs(hitKick(30) - 1) < 1e-9);
  assert.equal(hitKick(60), 2);
  assert.equal(hitKick(200), 2);
  assert.ok(hitKick(20) < hitKick(40));
});

test('de qué lado viene el disparo (mirando a −z: la derecha es +x)', () => {
  const me = at(0, 0, 0);
  const right = hitSide(me, { x: 5, y: 0, z: 0 }), left = hitSide(me, { x: -5, y: 0, z: 0 });
  const front = hitSide(me, { x: 0, y: 0, z: -5 }), back = hitSide(me, { x: 0, y: 0, z: 5 });
  assert.ok(right.x > 0.99 && Math.abs(right.y) < 1e-6, JSON.stringify(right));
  assert.ok(left.x < -0.99, JSON.stringify(left));
  assert.ok(front.y > 0.99 && Math.abs(front.x) < 1e-6, JSON.stringify(front));
  assert.ok(back.y < -0.99, JSON.stringify(back));
  // girado 90° a la izquierda (yaw +90°), lo que estaba delante queda a la derecha
  assert.ok(hitSide(at(0, 0, 90 * DEG), { x: 0, y: 0, z: -5 }).x > 0.99);
});

test('la vista se va hacia arriba y hacia el lado contrario del disparo', () => {
  const me = at(0, 0, 0);
  const k = kickFrom(60, hitSide(me, { x: 5, y: 0, z: 0 }));      // desde la derecha
  assert.ok(k.pitch > 0, 'hacia arriba');
  assert.ok(k.yaw > 0, 'hacia la izquierda (sumar al yaw es girar a la izquierda)');
  assert.ok(Math.hypot(k.pitch, k.yaw) <= 2 * DEG + 1e-9, 'no más de 2°');
  assert.ok(kickFrom(60, hitSide(me, { x: -5, y: 0, z: 0 })).yaw < 0, 'desde la izquierda, hacia la derecha');
});

test('poca vida: nada desde 30; por debajo, de 0,4 a casi 1; derribado o muerto, nada (lo suyo es otro sonido)', () => {
  const op = (hp, state = 'alive') => ({ hp, state });
  assert.equal(lowHealth(op(30)), 0);
  assert.equal(lowHealth(op(100)), 0);
  assert.ok(Math.abs(lowHealth(op(29)) - 0.42) < 1e-9);
  assert.ok(lowHealth(op(5)) > lowHealth(op(20)));
  assert.equal(lowHealth(op(10, 'downed')), 0);
  assert.equal(lowHealth(null), 0);
});

test('balas que pasan cerca: a menos de 1,5 m suenan; más lejos, a quemarropa o paradas antes, no', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  // de este a oeste, a 1 m por delante de los ojos
  const shot = (z, end = 40, x0 = 20) => ({ origin: { x: x0, y: 1.6, z }, dir: { x: -1, y: 0, z: 0 }, end });
  const a = nearMiss(shot(-1), eye);
  assert.ok(a && Math.abs(a.dist - 1) < 1e-9 && Math.abs(a.at.x) < 1e-9, JSON.stringify(a));
  assert.equal(nearMiss(shot(-2), eye), null, 'a 2 m, no');
  assert.equal(nearMiss(shot(-1, 10), eye), null, 'se paró antes de llegar (en una pared)');
  assert.equal(nearMiss(shot(-0.5, 40, 0.6), eye), null, 'a quemarropa suena el disparo, no el chasquido');
});

test('el tirón del alcanzado: sube en 0,04 s y vuelve a los 0,16 s', () => {
  assert.equal(joltAt(0), 0);
  assert.ok(Math.abs(joltAt(0.04) - 1) < 1e-9);
  assert.ok(joltAt(0.02) > 0 && joltAt(0.02) < 1);
  assert.ok(joltAt(0.1) < joltAt(0.06));
  assert.equal(joltAt(FEEL.joltT), 0);
  assert.equal(joltAt(-0.01), 0);
});

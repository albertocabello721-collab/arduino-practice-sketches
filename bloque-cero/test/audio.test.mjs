// Fase 9: por dónde llega cada sonido. La oclusión depende de lo que cruza la línea recta (cada
// pared 0,35, cada suelo o techo 0,6, hasta 1) y, si está tapado, el sonido puede rodear por una
// puerta o un agujero a 1,5 m de la fuente (llega desde allí, con 0,35). Con límite de trabajo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { blockage, hear, HEAR } from '../src/audio/propagation.js';
import { Hearing, HEARING } from '../src/client/hearing.js';
import { MAT } from '../src/world/materials.js';

const world = createVillaWorld();
buildVilla(world);
const P = (x, y, z) => ({ x, y, z });
// (sitios de la Villa: la calle; la fachada del salón en z = 0; la pared salón | recibidor en x = 12
// con una puerta en z 3–3,75; el salón en la planta baja y el dormitorio encima)
const STREET = [P(10, 1.6, -6), P(18, 1.2, -6)];
const FACADE = [P(8, 1.6, -3), P(8, 1.2, 4)];            // tú en la calle; él en el salón, tras la fachada
const UPSTAIRS = [P(6, 1.6, 6), P(6, 4.6, 6)];           // tú en el salón; él justo encima
const DOOR = [P(14.5, 1.6, 5.5), P(11.0, 1.2, 3.4)];     // tú en el recibidor; él en el salón, junto a la puerta
const TWO = [P(16, 1.6, -3), P(24, 1.2, 10)];

test('campo abierto: nada tapa; una pared, 0,35; un suelo, 0,6; varias, hasta 1', () => {
  assert.equal(blockage(world, ...STREET), 0);
  assert.equal(blockage(world, ...FACADE), HEAR.wall);
  assert.equal(blockage(world, ...UPSTAIRS), HEAR.floor);
  assert.equal(blockage(world, ...TWO), 1);
  // en los dos sentidos igual
  assert.equal(blockage(world, FACADE[1], FACADE[0]), HEAR.wall);
  assert.equal(blockage(world, UPSTAIRS[1], UPSTAIRS[0]), HEAR.floor);
});

test('un impacto en la pared que ves no está tapado (el punto está en la superficie)', () => {
  const ear = P(10, 1.6, -3);
  for (const z of [-0.126, -0.1, -0.05, 0]) assert.equal(blockage(world, ear, P(10, 1.2, z)), 0, `z ${z}`);
  // y uno al otro lado de la pared, sí
  assert.equal(blockage(world, ear, P(10, 1.2, 0.3)), HEAR.wall);
});

test('una pared de un solo vóxel también tapa (no se cuela por ser fina)', () => {
  const w = createVillaWorld();
  w.fillWorld(-2, 0, 20, -1.875, 3, 22, MAT.DRYWALL);     // tabique de 12,5 cm en campo abierto
  assert.equal(blockage(w, P(-4, 1.5, 21), P(0, 1.5, 21)), HEAR.wall);
});

test('con la puerta al lado, el sonido llega por la puerta; sin puerta cerca, en línea recta y tapado', () => {
  const d = hear(world, ...DOOR);
  assert.equal(d.detoured, true);
  assert.equal(d.occl, HEAR.detour);
  // llega desde el hueco de la puerta (x 12, z 3–3,75), no desde detrás de la pared
  assert.ok(d.x >= 11.9 && d.x <= 12.6 && d.z >= 2.9 && d.z <= 3.8, JSON.stringify(d));
  const f = hear(world, ...FACADE);
  assert.equal(f.detoured, false);
  assert.equal(f.occl, HEAR.wall);
  assert.deepEqual([f.x, f.y, f.z], [FACADE[1].x, FACADE[1].y, FACADE[1].z]);
  const s = hear(world, ...STREET);
  assert.equal(s.occl, 0);
  assert.equal(s.tried, false);
});

test('muy lejos (más de 60 m) se da por tapado del todo', () => {
  assert.equal(blockage(world, P(-10, 1.6, -14), P(52, 1.6, 40)), 1);
});

test('límite: como mucho 12 rodeos por fotograma; los pasos que no caben suenan en el siguiente', () => {
  const ear = { ...DOOR[0] };
  const H = new Hearing(world, ear);
  H.frame();
  let rodeos = 0, played = 0;
  for (let i = 0; i < 20; i++) { const h = H.at(DOOR[1]); if (h.detoured) rodeos++; }
  assert.equal(rodeos, HEARING.budget);
  assert.equal(H.used, HEARING.budget);
  // en línea recta, los que no cupieron
  const late = H.at(DOOR[1]);
  assert.equal(late.detoured, false);
  assert.equal(late.occl, HEAR.wall);
  // los pasos esperan al fotograma siguiente
  H.step(() => played++);
  assert.equal(played, 0);
  H.frame();
  assert.equal(played, 1);
  assert.equal(H.room, true);
  // lo que no está tapado no gasta
  H.frame();
  for (let i = 0; i < 50; i++) H.at(STREET[1]);
  assert.equal(H.used, 0);
});

test('coste: con rodeo, menos de 60 µs por sonido', () => {
  for (let i = 0; i < 500; i++) hear(world, ...DOOR);
  const n = 3000, t0 = performance.now();
  for (let i = 0; i < n; i++) hear(world, ...DOOR);
  const us = ((performance.now() - t0) / n) * 1000;
  assert.ok(us < 60, `${us.toFixed(1)} µs`);
});

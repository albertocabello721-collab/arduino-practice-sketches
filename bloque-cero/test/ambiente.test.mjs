// F12.5 · Ambiente: el día sigue igual que antes; las farolas solo alumbran al atardecer y de noche;
// y qué suena en cada sitio a cada hora (pájaros y coches de día, grillos de noche; dentro, el reloj
// del salón, la nevera de la cocina y los crujidos si hay piso encima). (Cómo suena:
// tools/medir-ambiente.mjs; en el juego, cómo se ve y que los bots no se enteran: tools/smoke-ambiente.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillaWorld, buildVilla } from '../src/world/maps/villa.js';
import { TIMES, TIMES_ORDER, timeOf, lightsFor } from '../src/render/timeofday.js';
import { ambienceLayers, floorAt, AMB } from '../src/audio/ambience.js';

const world = createVillaWorld();
const map = buildVilla(world);

test('el día es la luz de siempre (los valores de antes de la F12.5)', () => {
  const D = TIMES.dia;
  assert.deepEqual(D.sunColor, [1.95, 1.76, 1.52]);
  assert.deepEqual(D.skyColor, [0.33, 0.41, 0.56]);
  assert.deepEqual(D.groundColor, [0.2, 0.18, 0.15]);
  assert.deepEqual(D.fogColor, [0.42, 0.48, 0.56]);
  assert.equal(D.fogDensity, 0.0045);
  assert.deepEqual(D.zenith, [0.1, 0.2, 0.46]);
  assert.deepEqual(D.horizon, [0.46, 0.5, 0.56]);
  assert.deepEqual(D.sunDisk, [1.2, 1.05, 0.85]);
  assert.equal(D.sunDir, null);          // el sol del mapa
  assert.equal(D.skyLight, 1);
  assert.equal(D.exposure, 1);
  assert.equal(D.stars, 0);
  assert.deepEqual(TIMES_ORDER, ['dia', 'atardecer', 'noche']);
  assert.equal(timeOf('otra'), TIMES.dia);
});

test('cuanto más tarde, menos luz del cielo, y el sol más bajo al atardecer', () => {
  const [d, a, n] = TIMES_ORDER.map((k) => TIMES[k]);
  const lum = (c) => c[0] + c[1] + c[2];
  assert.ok(lum(d.skyColor) > lum(a.skyColor) && lum(a.skyColor) > lum(n.skyColor));
  assert.ok(lum(d.sunColor) > lum(n.sunColor));
  assert.ok(d.skyLight > a.skyLight && a.skyLight > n.skyLight);
  assert.ok(a.exposure < 1 && n.exposure < 1, 'al atardecer y de noche la exposición no lo compensa todo');
  const sun = map.sun.dir;
  assert.ok(a.sunDir[1] < sun.y - 0.2, 'el sol del atardecer no está más bajo');
  assert.equal(n.stars, 1);
});

test('las farolas de la calle: apagadas de día, encendidas al atardecer y de noche', () => {
  const street = map.lights.filter((l) => l.street);
  assert.equal(street.length, 3);
  assert.equal(lightsFor(map, 'dia').length, map.lights.length - 3);
  assert.ok(lightsFor(map, 'dia').every((l) => !l.street));
  assert.equal(lightsFor(map, 'atardecer').length, map.lights.length);
  assert.equal(lightsFor(map, 'noche').length, map.lights.length);
});

test('qué suena dónde y a qué hora', () => {
  const calle = { x: 10, y: 1.6, z: -10 }, salon = { x: 2, y: 1.6, z: 6.5 }, cocina = { x: 13.5, y: 1.6, z: 18 }, arriba = { x: 6, y: 5.1, z: 20 }, sotano = { x: 6, y: -1.9, z: 6 };
  assert.equal(floorAt(sotano.y), 0); assert.equal(floorAt(salon.y), 1); assert.equal(floorAt(arriba.y), 2);
  // fuera: pájaros y coches de día; grillos de noche; al atardecer, de todo un poco
  const dia = ambienceLayers('dia', calle, 0), noche = ambienceLayers('noche', calle, 0), tarde = ambienceLayers('atardecer', calle, 0);
  assert.ok(dia.birds > 0.9 && dia.cars > 0.9 && dia.crickets === 0);
  assert.ok(noche.birds === 0 && noche.crickets > 0.9);
  assert.ok(tarde.birds > 0 && tarde.crickets > 0 && tarde.birds < dia.birds && tarde.crickets < noche.crickets);
  // fuera no hay reloj, ni nevera, ni crujidos
  for (const L of [dia, noche, tarde]) assert.ok(L.clock === 0 && L.fridge === 0 && L.creaks === 0);
  // dentro: lo de fuera se oye menos
  const dentro = ambienceLayers('noche', salon, 1);
  assert.ok(dentro.crickets < noche.crickets * 0.5);
  // el reloj en el salón (no en la cocina); la nevera en la cocina (no en el salón)
  assert.ok(dentro.clock > 0.5 && dentro.fridge === 0);
  const c = ambienceLayers('dia', cocina, 1);
  assert.ok(c.fridge > 0.5 && c.clock === 0);
  // crujidos si hay piso encima: en la planta baja y el sótano sí; en la alta, no
  assert.equal(dentro.creaks, 1);
  assert.equal(ambienceLayers('dia', sotano, 1).creaks, 1);
  const up = ambienceLayers('dia', arriba, 1);
  assert.ok(up.creaks === 0 && up.clock === 0 && up.fridge === 0);
  // el reloj y la nevera están dentro de la casa, en la planta baja
  for (const p of [AMB.clock, AMB.fridge]) { const r = map.roomAt(p.x, p.y, p.z); assert.ok(r && r.level === '1', JSON.stringify(p)); }
  assert.equal(map.roomAt(AMB.clock.x, AMB.clock.y, AMB.clock.z).id, 'F_salon');
  assert.equal(map.roomAt(AMB.fridge.x, AMB.fridge.y, AMB.fridge.z).id, 'F_cocina');
});

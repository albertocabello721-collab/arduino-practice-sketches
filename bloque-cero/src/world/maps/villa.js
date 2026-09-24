// Mapa "Villa": chalet de dos plantas con sótano, garaje anexo y jardín.
// Casa principal x[0,30] z[0,26]; garaje x[30,40] z[0,26]. Fachada principal (sur) en z=0.
// Plantas: sótano (suelo -3,5), planta baja (0), planta alta (3,5), tejado (7).
// Tres ubicaciones de sitios A/B (las elige la defensa):
//   Sótano: Bodega (A) + Sala de calderas (B)
//   Planta baja: Cocina (A) + Comedor (B)
//   Planta alta: Dormitorio principal (A) + Estudio (B)
import { VoxelWorld } from '../voxelworld.js';
import { MapBuilder } from '../mapbuilder.js';
import { MAT } from '../materials.js';

export const VILLA_BOUNDS = { minX: -13.5, maxX: 53.5, minZ: -15.5, maxZ: 43.5, minY: -4, maxY: 12 };

export function createVillaWorld() {
  return new VoxelWorld({ origin: { x: -14, y: -4, z: -16 }, size: { x: 68, y: 16, z: 60 }, groundY: 0 });
}

export function buildVilla(world) {
  const b = new MapBuilder(world);
  const H = 0.125;

  // ================= plantas =================
  b.level('B', -3.5, -0.25);
  b.level('1', 0, 3.25);
  b.level('2', 3.5, 6.75);

  // ================= SÓTANO =================
  // excavación de toda la huella de la casa principal
  b.clear(0, -3.75, 0, 30, 0, 26);
  b.box(0, -3.75, 0, 30, -3.625, 26, MAT.CONCRETE); // losa de cimentación
  const R = (def) => b.room(def);
  R({ id: 'B_almacen', name: 'Almacén', level: 'B', x0: 0, z0: 0, x1: 12, z1: 13, floor: MAT.CONCRETE_FLOOR, wall: MAT.DRYWALL_DIRTY, ceiling: MAT.CEILING });
  R({ id: 'B_bodega', name: 'Bodega', level: 'B', x0: 0, z0: 13, x1: 12, z1: 26, floor: MAT.STONE, wall: MAT.DRYWALL_DIRTY, ceiling: MAT.CONCRETE });
  R({ id: 'B_calderas', name: 'Sala de calderas', level: 'B', x0: 12, z0: 16, x1: 24, z1: 26, floor: MAT.CONCRETE_FLOOR, wall: MAT.DRYWALL_GREY, ceiling: MAT.CONCRETE });
  R({ id: 'B_pasillo', name: 'Pasillo del sótano', level: 'B', x0: 12, z0: 7, x1: 30, z1: 16, floor: MAT.CONCRETE_FLOOR, wall: MAT.DRYWALL_DIRTY, ceiling: MAT.CONCRETE });
  R({ id: 'B_seguridad', name: 'Sala de seguridad', level: 'B', x0: 12, z0: 0, x1: 30, z1: 7, floor: MAT.CARPET_GREY, wall: MAT.DRYWALL_GREY, ceiling: MAT.CONCRETE });
  R({ id: 'B_taller', name: 'Taller', level: 'B', x0: 24, z0: 16, x1: 30, z1: 26, floor: MAT.CONCRETE_FLOOR, wall: MAT.DRYWALL_DIRTY, ceiling: MAT.CONCRETE });
  b.finishLevel('B', MAT.CONCRETE, 0);

  // ================= PLANTA BAJA =================
  R({ id: 'F_salon', name: 'Salón', level: '1', x0: 0, z0: 0, x1: 12, z1: 13, floor: MAT.WOOD_FLOOR, wall: MAT.WALLPAPER_GREEN });
  R({ id: 'F_recibidor', name: 'Recibidor', level: '1', x0: 12, z0: 0, x1: 19, z1: 7, floor: MAT.MARBLE, wall: MAT.DRYWALL_CREAM });
  R({ id: 'F_despacho', name: 'Despacho', level: '1', x0: 19, z0: 0, x1: 30, z1: 7, floor: MAT.PARQUET, wall: MAT.WOOD_PANEL });
  R({ id: 'F_hall', name: 'Hall', level: '1', x0: 12, z0: 7, x1: 22, z1: 16, floor: MAT.MARBLE, wall: MAT.DRYWALL_CREAM });
  R({ id: 'F_pasillo', name: 'Pasillo de servicio', level: '1', x0: 22, z0: 7, x1: 30, z1: 16, floor: MAT.TILE_FLOOR, wall: MAT.DRYWALL });
  R({ id: 'F_comedor', name: 'Comedor', level: '1', x0: 0, z0: 13, x1: 12, z1: 26, floor: MAT.PARQUET, wall: MAT.WALLPAPER_RED });
  R({ id: 'F_cocina', name: 'Cocina', level: '1', x0: 12, z0: 16, x1: 24, z1: 26, floor: MAT.TILE_CHECKER, wall: MAT.DRYWALL_CREAM });
  R({ id: 'F_lavanderia', name: 'Lavandería', level: '1', x0: 24, z0: 16, x1: 30, z1: 26, floor: MAT.TILE_FLOOR, wall: MAT.BATH_TILE });
  R({ id: 'F_garaje', name: 'Garaje', level: '1', x0: 30, z0: 0, x1: 40, z1: 26, floor: MAT.CONCRETE_FLOOR, wall: MAT.DRYWALL_GREY, ceiling: MAT.CEILING });
  b.finishLevel('1', MAT.STUCCO);
  // fachadas de ladrillo (indestructibles): frente del salón y del despacho, y todo el garaje
  b.facade('x', 0, -0.125, 12.125, 0, 3.5, MAT.BRICK, -1);
  b.facade('x', 0, 18.875, 30.125, 0, 3.5, MAT.BRICK, -1);
  b.facade('x', 0, 29.875, 40.125, 0, 3.5, MAT.BRICK, -1);
  b.facade('z', 40, -0.125, 26.125, 0, 3.5, MAT.BRICK, 1);
  b.facade('x', 26, 29.875, 40.125, 0, 3.5, MAT.BRICK, 1);
  // zócalo de piedra en toda la planta baja
  for (const [ax, line, a, bb, out] of [['x', 0, -0.25, 40.25, -1], ['x', 26, -0.25, 40.25, 1], ['z', 0, -0.25, 26.25, -1], ['z', 40, -0.25, 26.25, 1]]) {
    b.facade(ax, line, a, bb, 0, 0.5, MAT.STONE, out);
  }

  // ================= PLANTA ALTA =================
  R({ id: 'S_infantil', name: 'Habitación infantil', level: '2', x0: 0, z0: 0, x1: 12, z1: 8, floor: MAT.CARPET_BLUE, wall: MAT.WALLPAPER_BLUE });
  R({ id: 'S_bano', name: 'Baño', level: '2', x0: 0, z0: 8, x1: 6, z1: 13, floor: MAT.TILE_FLOOR, wall: MAT.BATH_TILE });
  R({ id: 'S_vestidor', name: 'Vestidor', level: '2', x0: 6, z0: 8, x1: 12, z1: 13, floor: MAT.CARPET_GREY, wall: MAT.DRYWALL_GREY });
  R({ id: 'S_dormitorio', name: 'Dormitorio principal', level: '2', x0: 0, z0: 13, x1: 12, z1: 26, floor: MAT.CARPET_RED, wall: MAT.DRYWALL_SAGE });
  R({ id: 'S_rellano', name: 'Rellano', level: '2', x0: 12, z0: 7, x1: 22, z1: 16, floor: MAT.WOOD_FLOOR, wall: MAT.DRYWALL_CREAM });
  R({ id: 'S_estudio', name: 'Estudio', level: '2', x0: 12, z0: 16, x1: 24, z1: 26, floor: MAT.WOOD_FLOOR, wall: MAT.WOOD_PANEL });
  R({ id: 'S_invitados', name: 'Habitación de invitados', level: '2', x0: 24, z0: 16, x1: 30, z1: 26, floor: MAT.WOOD_FLOOR, wall: MAT.WALLPAPER_GREEN });
  R({ id: 'S_musica', name: 'Sala de música', level: '2', x0: 12, z0: 0, x1: 22, z1: 7, floor: MAT.PARQUET, wall: MAT.WALLPAPER_GOLD });
  R({ id: 'S_tv', name: 'Sala de la tele', level: '2', x0: 22, z0: 0, x1: 30, z1: 16, floor: MAT.CARPET_GREY, wall: MAT.DRYWALL_BLUE });
  b.finishLevel('2', MAT.SIDING);
  // banda de moldura entre plantas
  for (const [ax, line, a, bb, out] of [['x', 0, -0.25, 30.25, -1], ['x', 26, -0.25, 30.25, 1], ['z', 0, -0.25, 26.25, -1]]) {
    b.facade(ax, line, a, bb, 3.25, 3.5, MAT.TRIM, out);
  }

  // ================= TEJADOS =================
  b.box(0, 6.875, 0, 30, 7.0, 26, MAT.ROOF);
  b.box(30, 3.375, 0, 40, 3.5, 26, MAT.ROOF);
  // pretil del tejado principal
  b.fullWall('x', 0, -0.125, 30.125, 7.0, 8.0, MAT.BRICK);
  b.fullWall('x', 26, -0.125, 30.125, 7.0, 8.0, MAT.BRICK);
  b.fullWall('z', 0, -0.125, 26.125, 7.0, 8.0, MAT.BRICK);
  b.fullWall('z', 30, -0.125, 26.125, 7.0, 8.0, MAT.BRICK);
  b.box(-0.25, 8.0, -0.25, 30.25, 8.125, 0.25, MAT.TRIM);
  b.box(-0.25, 8.0, 25.75, 30.25, 8.125, 26.25, MAT.TRIM);
  b.box(-0.25, 8.0, -0.25, 0.25, 8.125, 26.25, MAT.TRIM);
  b.box(29.75, 8.0, -0.25, 30.25, 8.125, 26.25, MAT.TRIM);
  // hueco en el pretil para la escalera de mano desde el tejado del garaje
  b.clear(29.75, 7.0, 23.875, 30.25, 8.125, 24.875);
  // chimenea
  b.box(0.125, 7.0, 5.0, 1.375, 9.25, 7.0, MAT.BRICK);
  b.box(0.0, 9.25, 4.875, 1.5, 9.5, 7.125, MAT.CONCRETE);
  // barandilla del tejado del garaje
  b.railing('z', 40.125, 0, 26, 3.5, 0.875);
  b.railing('x', 0.125, 30.125, 40, 3.5, 0.875);
  b.railing('x', 26, 30.125, 37.5, 3.5, 0.875);
  b.railing('x', 26, 38.5, 40, 3.5, 0.875);
  // claraboya/trampilla del garaje
  b.hatch(35, 13, 3.5, { name: 'Claraboya del garaje' });

  // ================= ESCALERAS =================
  // principal: hall (PB) → rellano (PA), sube hacia +z pegada a la pared este del hall
  b.stairway({ axis: 'z', low: 8, dir: 1, from: 20.375, to: 21.875, y0: 0, rise: 3.5, mat: MAT.FURN_DARK, name: 'Escalera principal' });
  b.railing('z', 20.375, 8, 11.5, 3.5);
  b.railing('x', 8.0, 20.25, 21.875, 3.5);
  b.railing('z', 20.375, 8.0, 10.0, 0, 0.875); // pasamanos en planta baja (lado del hall)
  // sótano: pasillo de servicio (PB) → pasillo del sótano, baja hacia +z
  b.stairway({ axis: 'z', low: 11.5, dir: -1, from: 28.375, to: 29.875, y0: -3.5, rise: 3.5, mat: MAT.CONCRETE, name: 'Escalera del sótano' });
  b.railing('z', 28.375, 8.25, 11.5, 0);
  b.railing('x', 11.625, 28.25, 29.875, 0);

  // ================= PUERTAS =================
  // sótano
  b.door('B', 'x', 13, 9);
  b.door('B', 'z', 12, 3.5);
  b.door('B', 'z', 12, 10);
  b.door('B', 'z', 12, 14.5);
  b.door('B', 'z', 12, 21);
  b.door('B', 'x', 16, 18);
  b.door('B', 'z', 24, 21);
  b.door('B', 'x', 16, 26);
  b.door('B', 'x', 7, 20);
  b.door('B', 'x', 7, 26.5);
  b.door('B', 'z', 0, 6.5, 1.0, 2.25); // acceso exterior al almacén
  // planta baja
  b.door('1', 'x', 0, 15.5, 1.5, 2.5);          // entrada principal
  b.arch('1', 'x', 7, 15.5, 2.5, 2.75);          // recibidor ↔ hall
  b.door('1', 'z', 12, 3.5);                     // recibidor ↔ salón
  b.door('1', 'z', 19, 3.5);                     // recibidor ↔ despacho
  b.door('1', 'z', 12, 10);                      // salón ↔ hall
  b.arch('1', 'x', 13, 6, 2.5, 2.5);             // salón ↔ comedor
  b.door('1', 'z', 12, 14.5);                    // hall ↔ comedor
  b.door('1', 'x', 16, 16);                      // hall ↔ cocina
  b.door('1', 'z', 22, 14);                      // hall ↔ pasillo
  b.door('1', 'x', 7, 24.5);                     // despacho ↔ pasillo
  b.door('1', 'x', 16, 23);                      // pasillo ↔ cocina
  b.door('1', 'x', 16, 26.5);                    // pasillo ↔ lavandería
  b.door('1', 'z', 30, 14);                      // pasillo ↔ garaje
  b.door('1', 'z', 30, 4);                       // despacho ↔ garaje
  b.door('1', 'z', 12, 21);                      // cocina ↔ comedor
  b.door('1', 'z', 24, 21);                      // cocina ↔ lavandería
  b.door('1', 'z', 30, 22);                      // lavandería ↔ garaje
  b.door('1', 'x', 26, 17.5);                    // puerta trasera de la cocina
  b.door('1', 'z', 40, 21);                      // puerta lateral del garaje
  // planta alta
  b.door('2', 'z', 12, 10.5);                    // rellano ↔ vestidor
  b.door('2', 'z', 12, 14.5);                    // rellano ↔ dormitorio
  b.door('2', 'x', 16, 16);                      // rellano ↔ estudio
  b.door('2', 'x', 7, 15);                       // rellano ↔ música
  b.door('2', 'z', 22, 13.5);                    // rellano ↔ tele
  b.door('2', 'x', 13, 9);                       // vestidor ↔ dormitorio
  b.door('2', 'x', 13, 3);                       // baño ↔ dormitorio
  b.door('2', 'x', 8, 10);                       // infantil ↔ vestidor
  b.door('2', 'z', 12, 3.5);                     // infantil ↔ música
  b.door('2', 'z', 12, 21);                      // dormitorio ↔ estudio
  b.door('2', 'z', 24, 21);                      // estudio ↔ invitados
  b.door('2', 'x', 16, 27);                      // invitados ↔ tele
  b.door('2', 'z', 22, 3.5);                     // música ↔ tele
  b.door('2', 'x', 0, 17, 1.25, 2.25);           // música → balcón

  // puerta de garaje (chapa blanda)
  b.clear(31.5, 0, -0.125, 38.5, 2.75, 0.125);
  b.box(31.25, 0, -0.125, 31.5, 2.875, 0.125, MAT.TRIM);
  b.box(38.5, 0, -0.125, 38.75, 2.875, 0.125, MAT.TRIM);
  b.box(31.25, 2.75, -0.125, 38.75, 2.875, 0.125, MAT.TRIM);
  b.box(31.5, 0, -0.125, 38.5, 2.75, 0, MAT.GARAGE_DOOR);

  // ================= VENTANAS =================
  const Wn = (lvl, ax, line, c, w = 1.5, sill = 1.0, h = 1.25) => b.window(lvl, ax, line, c, w, sill, h);
  // planta baja
  Wn('1', 'x', 0, 3); Wn('1', 'x', 0, 8.5);
  Wn('1', 'z', 0, 4); Wn('1', 'z', 0, 9);
  Wn('1', 'z', 0, 17); Wn('1', 'z', 0, 22);
  Wn('1', 'x', 26, 4); Wn('1', 'x', 26, 9);
  Wn('1', 'x', 26, 14); Wn('1', 'x', 26, 21);
  Wn('1', 'x', 26, 27.5, 1.25);
  Wn('1', 'x', 0, 22.5); Wn('1', 'x', 0, 27);
  Wn('1', 'x', 0, 18, 0.75, 1.25, 1.0);
  Wn('1', 'z', 40, 8, 1.5, 1.5, 0.875);
  // planta alta
  Wn('2', 'x', 0, 3); Wn('2', 'x', 0, 9); Wn('2', 'z', 0, 4);
  Wn('2', 'z', 0, 10.5, 0.75, 1.5, 0.875);
  Wn('2', 'z', 0, 17); Wn('2', 'z', 0, 22);
  Wn('2', 'x', 26, 4); Wn('2', 'x', 26, 9);
  Wn('2', 'x', 26, 15); Wn('2', 'x', 26, 21);
  Wn('2', 'x', 26, 27.5, 1.25);
  Wn('2', 'z', 30, 21);
  Wn('2', 'x', 0, 14); Wn('2', 'x', 0, 20);
  Wn('2', 'x', 0, 26);
  Wn('2', 'z', 30, 5); Wn('2', 'z', 30, 11);
  // sótano: ventanucos altos hacia patios ingleses (no, bajo tierra: solo el acceso exterior)

  // ================= TRAMPILLAS =================
  b.hatch(19, 23, 0, { name: 'Trampilla de la cocina' });
  b.hatch(8.5, 11, 0, { name: 'Trampilla del salón' });
  b.hatch(15, 11, 3.5, { name: 'Trampilla del rellano' });
  b.hatch(18, 20, 3.5, { name: 'Trampilla del estudio' });
  b.hatch(5, 20, 7.0, { name: 'Trampilla del tejado (dormitorio)' });
  b.hatch(19, 22.5, 7.0, { name: 'Trampilla del tejado (estudio)' });
  b.hatch(26, 9, 7.0, { name: 'Trampilla del tejado (tele)' });

  // ================= BALCÓN Y PORCHE =================
  b.box(13, 3.25, -2, 21, 3.5, 0, MAT.STONE);
  b.railing('x', -1.875, 13, 20, 3.5);
  b.railing('z', 13.125, -2, 0, 3.5);
  b.railing('z', 21.0, -2, 0, 3.5);
  b.box(13, 0, -2, 13.375, 3.25, -1.625, MAT.BRICK);
  b.box(20.625, 0, -2, 21, 3.25, -1.625, MAT.BRICK);
  b.box(13, -0.125, -2, 21, 0, 0, MAT.STONE);
  b.ladder('x', -2.0, 20.5, 0, 4.25, -1);
  // escaleras de mano: garaje (norte) y del tejado del garaje al principal
  b.ladder('x', 26.125, 38, 0, 4.25, 1);
  b.ladder('z', 30.125, 24.375, 3.5, 7.75, 1);

  // ================= ACCESO EXTERIOR AL SÓTANO =================
  b.clear(-2.5, -3.5, 1.5, -0.125, 0, 8);
  b.box(-2.75, -3.75, 1.25, -2.5, 0, 8.25, MAT.CONCRETE);
  b.box(-2.75, -3.75, 8.0, 0, 0, 8.25, MAT.CONCRETE);
  b.box(-2.5, -3.75, 1.5, 0, -3.5, 8, MAT.CONCRETE_FLOOR);
  b.stairway({ axis: 'z', low: 5.0, dir: -1, from: -2.5, to: -0.125, y0: -3.5, rise: 3.5, mat: MAT.CONCRETE, carve: false, name: 'Escalera exterior del sótano' });
  b.railing('z', -2.5, 1.5, 8.25, 0, 0.875);
  b.railing('x', 8.25, -2.625, -0.125, 0, 0.875);

  // ================= MOBILIARIO =================
  furnishBasement(b);
  furnishGround(b);
  furnishUpper(b);

  // ================= LÁMPARAS =================
  const lampsB = [[6, 6.5], [6, 19.5], [18, 21], [24, 11.5], [16, 11.5], [21, 3.5], [27, 21], [4, 22]];
  for (const [x, z] of lampsB) b.lamp(x, -0.25, z, 'cool', 0.375, 1.0);
  const lamps1 = [[6, 4], [6, 10], [15.5, 3.5], [24.5, 3.5], [16, 11], [26, 12], [6, 17], [6, 22.5], [16, 21], [21, 21], [27, 21], [35, 7], [35, 19]];
  for (const [x, z] of lamps1) b.lamp(x, 3.25, z, x > 30 ? 'cool' : 'warm', 0.375, 1.0);
  const lamps2 = [[6, 4], [3, 10.5], [9, 10.5], [6, 17], [6, 22.5], [16, 11.5], [16, 21], [21, 21], [27, 21], [17, 3.5], [26, 4], [26, 11]];
  for (const [x, z] of lamps2) b.lamp(x, 6.75, z, 'warm', 0.375, 1.0);
  // exterior: apliques junto a las puertas y farolas
  b.light(15.5, 2.75, -0.6, 'warm', 0.6);
  b.light(17.5, 2.75, 26.6, 'warm', 0.6);
  b.light(40.6, 2.75, 21, 'warm', 0.6);

  // ================= EXTERIOR =================
  buildExterior(b);

  // ================= ZONAS EXTERIORES (callouts) =================
  b.zone('tejado', 'Tejado', 0, 0, 30, 26, 6.9, 20);
  b.zone('tejado_garaje', 'Tejado del garaje', 30, 0, 40, 26, 3.4, 20);
  b.zone('balcon', 'Balcón', 13, -2, 21, 0, 3.4, 20);
  b.zone('acceso_sotano', 'Acceso al sótano', -2.75, 1.25, 0, 8.25, -4, 0);
  b.zone('porche', 'Porche', 12.5, -2.5, 21.5, 0, -1, 3.4);
  b.zone('calle', 'Calle', -14, -16, 54, -5.5);
  b.zone('entrada_garaje', 'Entrada del garaje', 30, -5.5, 40, 0);
  b.zone('jardin_delantero', 'Jardín delantero', -14, -5.5, 54, 0);
  b.zone('jardin_trasero', 'Jardín trasero', -14, 26, 54, 44);
  b.zone('lateral_oeste', 'Lateral oeste', -14, 0, 0, 26);
  b.zone('camino_garaje', 'Camino lateral', 40, 0, 54, 26);

  world.snapshot();

  // ================= METADATOS DE JUEGO =================
  const sites = [
    { id: 'sotano', name: 'Sótano', level: 'B', A: 'B_bodega', B: 'B_calderas',
      bombs: { A: { x: 5, y: -3.5, z: 21 }, B: { x: 17.5, y: -3.5, z: 21.5 } },
      defenderSpawn: { x: 9, y: -3.5, z: 19 } },
    { id: 'baja', name: 'Planta baja', level: '1', A: 'F_cocina', B: 'F_comedor',
      bombs: { A: { x: 20, y: 0, z: 18.5 }, B: { x: 10, y: 0, z: 24.5 } },
      defenderSpawn: { x: 10.5, y: 0, z: 18 } },
    { id: 'alta', name: 'Planta alta', level: '2', A: 'S_dormitorio', B: 'S_estudio',
      bombs: { A: { x: 6, y: 3.5, z: 19.5 }, B: { x: 21.5, y: 3.5, z: 22.5 } },
      defenderSpawn: { x: 9, y: 3.5, z: 20 } },
  ];
  const attackerSpawns = [
    { id: 'calle', name: 'Calle principal', x: 10, y: 0, z: -13.5, yaw: Math.PI },
    { id: 'jardin', name: 'Jardín trasero', x: 14, y: 0, z: 40.5, yaw: 0 },
    { id: 'lateral', name: 'Camino lateral', x: 50.5, y: 0, z: 17, yaw: Math.PI / 2 },
  ];
  // cámaras de seguridad de la defensa (yaw 0 mira hacia -Z)
  const cameras = [
    { id: 'cam_entrada', name: 'Entrada principal', x: 13.6, y: 2.95, z: -0.4, yaw: -0.35, pitch: -0.22 },
    { id: 'cam_garaje', name: 'Garaje', x: 39.5, y: 2.9, z: 25.5, yaw: 0.38, pitch: -0.3 },
    { id: 'cam_hall', name: 'Hall', x: 12.45, y: 2.9, z: 15.55, yaw: -0.46, pitch: -0.3 },
    { id: 'cam_sotano', name: 'Pasillo del sótano', x: 29.55, y: -0.6, z: 15.55, yaw: 1.1, pitch: -0.28 },
    { id: 'cam_jardin', name: 'Jardín trasero', x: 12.6, y: 2.9, z: 26.45, yaw: -2.6, pitch: -0.25 },
    { id: 'cam_rellano', name: 'Rellano', x: 12.45, y: 6.4, z: 7.45, yaw: -2.24, pitch: -0.35 },
  ];
  return {
    name: 'Villa',
    cameras,
    builder: b,
    rooms: b.rooms, zones: b.zones, doors: b.doors, windows: b.windows, hatches: b.hatches,
    lights: b.lights, stairs: b.stairs, ladders: b.ladders,
    sites, attackerSpawns, bounds: VILLA_BOUNDS,
    sun: { dir: normalize([-0.52, 0.5, -0.69]) },
    locationAt(x, y, z) {
      const r = b.roomAt(x, y, z);
      if (r) return r.name;
      for (const zn of b.zones) if (x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1 && y >= zn.y0 && y < zn.y1) return zn.name;
      return 'Exterior';
    },
    roomAt: (x, y, z) => b.roomAt(x, y, z),
  };
}

function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]); return { x: v[0] / l, y: v[1] / l, z: v[2] / l }; }

// ---------------------------------------------------------------------------
function furnishBasement(b) {
  const y = -3.5;
  // almacén: estanterías metálicas, cajas y trastos
  for (const z of [1, 8.5]) b.box(0.25, y, z, 0.875, y + 2.25, z + 2.5, MAT.METAL_SHEET);
  for (const [x, z] of [[3, 2], [3.75, 2], [3, 2.75], [8.5, 3], [9.5, 9.5], [9.5, 10.25], [2.5, 11], [3.25, 11]]) b.crate(x, z, y);
  b.crate(3.4, 2.4, y + 0.75, 0.625);
  b.crate(9.5, 9.9, y + 0.75, 0.625);
  b.sofa(5, 10.5, 7.5, 11.75, y, 'n', MAT.FABRIC_GREEN);
  b.box(11, y, 0.25, 11.875, y + 1.5, 2.5, MAT.METAL_SHEET);
  // bodega: botelleros a lo largo de las paredes y barricas
  for (let x = 0.5; x < 11; x += 2.25) b.box(x, y, 25.25, x + 1.875, y + 2.25, 25.875, MAT.FURN_DARK);
  for (let z = 14.5; z < 24; z += 2.25) b.box(0.125, y, z, 0.75, y + 2.25, z + 1.75, MAT.FURN_DARK);
  for (const [x, z] of [[4, 17], [4.875, 17], [8, 17], [8, 21.5], [8.875, 21.5], [4, 23.5]]) b.box(x - 0.375, y, z - 0.375, x + 0.375, y + 1.0, z + 0.375, MAT.BARREL);
  b.table(5.5, 19.75, 7.5, 21.25, y, 0.875, MAT.FURN_DARK);
  // sala de calderas: caldera, depósito y tuberías
  b.box(20.5, y, 23.5, 23.625, y + 2.5, 25.75, MAT.METAL_DARK);
  b.box(13, y, 24, 14.5, y + 2.0, 25.75, MAT.APPLIANCE);
  b.box(15, y, 24.75, 16.25, y + 1.625, 25.75, MAT.APPLIANCE);
  b.box(12.25, -0.75, 17, 23.75, -0.5, 17.25, MAT.METAL_DARK);
  b.box(12.25, -0.75, 24.75, 20.5, -0.5, 25.0, MAT.METAL_DARK);
  b.box(21, y, 17, 23.5, y + 1.25, 18.25, MAT.METAL_SHEET);
  for (const [x, z] of [[14, 18], [14.75, 18]]) b.crate(x, z, y, 0.625);
  // pasillo del sótano: cajas
  b.crate(13, 8, y); b.crate(13, 8.75, y, 0.5);
  b.box(20.5, y, 15.25, 22.5, y + 1.75, 15.875, MAT.METAL_SHEET);
  // sala de seguridad: consola con pantallas y armarios de servidores
  b.box(14, y, 0.25, 22, y + 0.875, 1.25, MAT.FURN_DARK);
  b.box(14.25, y + 0.875, 0.25, 21.75, y + 2.0, 0.5, MAT.SCREEN);
  for (const x of [15, 17.5, 20]) b.chair(x, 2, y, 0);
  for (const x of [25, 26.25, 27.5]) b.box(x, y, 0.25, x + 1.0, y + 2.25, 1.25, MAT.METAL_DARK);
  b.table(23, 4.5, 25.5, 5.75, y);
  // taller: banco de trabajo, estanterías
  b.table(25, 25, 29.75, 25.875, y, 0.875, MAT.FURN_OAK, MAT.METAL_DARK);
  b.box(29.25, y, 17, 29.875, y + 2.0, 20, MAT.METAL_SHEET);
  b.crate(26, 18, y); b.crate(26.75, 18, y, 0.5);
}

function furnishGround(b) {
  const y = 0;
  // salón: chimenea, sofás, mesa baja, estantería
  b.box(0.125, y, 4.75, 1.125, y + 1.25, 7.25, MAT.BRICK);
  b.clear(0.125, y + 0.125, 5.5, 0.875, y + 1.0, 6.5);
  b.box(0.125, y + 1.25, 4.625, 1.25, y + 1.375, 7.375, MAT.TRIM);
  b.box(0.125, y + 1.375, 5.25, 0.875, 3.25, 6.75, MAT.BRICK);
  b.sofa(3.5, 3, 4.5, 8.5, y, 'e');
  b.sofa(4.5, 1.25, 8.5, 2.25, y, 's');
  b.table(5.5, 4.5, 7.5, 6.5, y, 0.5, MAT.FURN_DARK);
  b.rug(3, 3.5, 9, 9, y, MAT.CARPET_RED);
  b.shelf(11.25, 5.5, 11.875, 9.25, y, 2.25);
  b.box(9.75, y, 10.75, 11.75, y + 0.625, 11.5, MAT.FURN_DARK);
  b.box(10.25, y + 0.625, 11.0, 11.25, y + 1.25, 11.125, MAT.SCREEN);
  // recibidor: consola y banco
  b.box(12.25, y, 4.5, 12.75, y + 0.875, 6.25, MAT.FURN_DARK);
  b.box(18.25, y, 1, 18.875, y + 0.5, 3, MAT.FABRIC);
  // despacho: escritorio, sillón, estanterías
  b.table(22.5, 2.5, 25.5, 3.75, y, 0.75, MAT.FURN_DARK);
  b.chair(24, 4.25, y, 1, MAT.FABRIC);
  b.shelf(29.25, 0.375, 29.875, 3.25, y, 2.5);
  b.shelf(19.125, 5, 19.75, 6.875, y, 2.25);
  b.box(28.75, y, 5.5, 29.875, y + 1.25, 6.875, MAT.METAL_SHEET);
  // hall: mesa central con jarrón
  b.table(14.5, 10.5, 16.5, 12.5, y, 0.75, MAT.FURN_DARK);
  b.box(12.25, y, 8.25, 12.75, y + 0.5, 9.25, MAT.FABRIC);
  // pasillo de servicio: armario
  b.box(22.25, y, 8.5, 22.875, y + 2.0, 11.0, MAT.FURN_WHITE);
  // comedor: mesa larga, sillas, aparador
  b.table(4, 17, 8, 22, y, 0.75, MAT.FURN_DARK);
  for (const z of [17.75, 19.25, 20.75]) { b.chair(3.5, z + 0.25, y, 2); b.chair(8.5, z + 0.25, y, 3); }
  b.box(0.25, y, 17.5, 0.875, y + 1.0, 21.5, MAT.FURN_DARK);
  b.rug(3, 16, 9, 23, y, MAT.CARPET_BLUE);
  // cocina: encimeras en U, isla, frigorífico
  b.counter(12.25, 25.125, 16.75, 25.875, y);
  b.counter(18.25, 25.125, 23.75, 25.875, y);
  b.counter(23.125, 22.25, 23.875, 25.125, y);
  b.counter(15, 19.5, 17.5, 21.0, y);
  b.box(12.25, y, 16.25, 13.125, y + 2.0, 17.5, MAT.APPLIANCE);
  // lavandería: lavadora y secadora
  b.box(24.25, y, 25.0, 25.125, y + 0.875, 25.875, MAT.APPLIANCE);
  b.box(25.375, y, 25.0, 26.25, y + 0.875, 25.875, MAT.APPLIANCE);
  b.counter(28.5, 22.75, 29.875, 25.875, y);
  b.box(28.875, y + 1.5, 16.25, 29.875, y + 1.625, 20, MAT.FURN_OAK);
  // garaje: coche, banco, estanterías, congelador
  b.car(34.5, 13, 'z', MAT.CAR_BLUE);
  b.table(37.25, 22, 39.875, 23, y, 0.875, MAT.FURN_OAK, MAT.METAL_DARK);
  b.box(39.25, y, 3, 39.875, y + 2.0, 7, MAT.METAL_SHEET);
  b.box(30.25, y, 24.5, 31.5, y + 0.875, 25.75, MAT.APPLIANCE);
  for (const [x, z] of [[38.5, 17], [38.5, 17.75], [37.75, 17]]) b.crate(x, z, y);
}

function furnishUpper(b) {
  const y = 3.5;
  // infantil
  b.bed(0.25, 0.25, 2.25, 2.75, y, 'w');
  b.bed(9.75, 0.25, 11.75, 2.75, y, 'e');
  b.box(4, y, 7.25, 5.75, y + 2.0, 7.875, MAT.FURN_WHITE);
  for (const [x, z] of [[7, 6.5], [7.75, 6.5]]) b.crate(x, z, y, 0.625);
  b.rug(4, 2.5, 8, 5.5, y, MAT.CARPET_GREY);
  // baño
  b.box(0.25, y, 11.0, 2.75, y + 0.625, 12.75, MAT.APPLIANCE);
  b.counter(4.5, 8.25, 5.75, 10.0, y);
  b.box(5.0, y, 12.125, 5.625, y + 0.5, 12.75, MAT.APPLIANCE);
  // vestidor
  b.box(6.25, y, 8.25, 9.25, y + 2.25, 8.875, MAT.FURN_WHITE);
  b.box(11.125, y, 11.5, 11.75, y + 2.25, 12.75, MAT.FURN_WHITE);
  // dormitorio principal
  b.bed(3.5, 23.25, 7.5, 25.875, y, 'n');
  b.box(2.5, y, 25.125, 3.25, y + 0.625, 25.875, MAT.FURN_DARK);
  b.box(7.75, y, 25.125, 8.5, y + 0.625, 25.875, MAT.FURN_DARK);
  b.box(0.25, y, 14, 0.875, y + 2.25, 16.5, MAT.FURN_WHITE);
  b.box(10.25, y, 13.25, 11.75, y + 1.0, 13.875, MAT.FURN_DARK);
  b.sofa(9.5, 17, 11.5, 18.25, y, 'e', MAT.FABRIC_GREEN);
  b.rug(2.5, 18, 8.5, 22.5, y, MAT.CARPET_GREY);
  // rellano: aparador y banco
  b.box(12.25, y, 12.0, 12.875, y + 0.875, 13.5, MAT.FURN_DARK);
  b.box(17, y, 15.25, 19, y + 0.5, 15.875, MAT.FABRIC);
  // estudio: estanterías, escritorio, sillones
  b.shelf(16, 25.25, 20, 25.875, y, 2.5);
  b.shelf(12.125, 23, 12.75, 25.5, y, 2.5);
  b.shelf(23.25, 16.5, 23.875, 19.5, y, 2.5);
  b.table(14, 22, 16.5, 23.25, y, 0.75, MAT.FURN_DARK);
  b.chair(15.25, 21.5, y, 1, MAT.FABRIC);
  b.sofa(19.5, 17.5, 21.5, 18.75, y, 's', MAT.FABRIC_GREEN);
  b.rug(13.5, 21, 17, 24.5, y, MAT.CARPET_RED);
  // invitados
  b.bed(26.5, 23.0, 29.0, 25.875, y, 'n');
  b.box(24.25, y, 24.5, 25.25, y + 2.0, 25.875, MAT.FURN_WHITE);
  b.table(28.75, 17.0, 29.875, 18.5, y, 0.75, MAT.FURN_OAK);
  // sala de música: piano, sofá
  b.box(13.5, y, 1.0, 15.5, y + 1.0, 2.5, MAT.FURN_DARK);
  b.box(13.5, y + 1.0, 1.0, 15.5, y + 1.25, 1.25, MAT.FURN_DARK);
  b.box(14, y, 3.0, 15, y + 0.5, 3.375, MAT.FURN_DARK);
  b.sofa(18.5, 5.5, 21.5, 6.75, y, 'n', MAT.FABRIC);
  b.shelf(21.25, 0.25, 21.875, 2.5, y, 2.0);
  // sala de la tele: sofá, tele, billar
  b.sofa(23, 7, 26.5, 8.25, y, 'n');
  b.box(23.5, y, 1.0, 26, y + 0.625, 1.625, MAT.FURN_DARK);
  b.box(23.75, y + 0.625, 1.25, 25.75, y + 1.75, 1.375, MAT.SCREEN);
  b.table(25.5, 10.5, 28.5, 13.0, y, 0.875, MAT.FABRIC_GREEN, MAT.FURN_DARK);
  b.box(25.625, y + 0.875, 10.625, 28.375, y + 1.0, 10.75, MAT.FURN_DARK);
  b.box(25.625, y + 0.875, 12.75, 28.375, y + 1.0, 12.875, MAT.FURN_DARK);
}

function buildExterior(b) {
  // calle, acera y bordillo
  b.box(-14, -0.125, -16, 54, 0, -8, MAT.ASPHALT);
  b.box(-14, -0.125, -8, 54, 0.125, -5.5, MAT.SIDEWALK);
  // camino de entrada, porche y rampa del garaje
  b.box(14.75, -0.125, -5.5, 16.25, 0, -2, MAT.SIDEWALK);
  b.box(31, -0.125, -5.5, 39, 0, 0, MAT.CONCRETE_FLOOR);
  // patio trasero
  b.box(10, -0.125, 26, 26, 0, 30, MAT.SIDEWALK);
  // camino de grava lateral (este)
  b.box(42, -0.125, -5.5, 45, 0, 43.5, MAT.GRAVEL);
  // valla delantera baja
  b.fence('x', -5.375, -13.5, 14.5, 0.875);
  b.fence('x', -5.375, 16.5, 30.5, 0.875);
  b.fence('x', -5.375, 39.5, 53.5, 0.875);
  // setos del perímetro (límite del mapa)
  b.hedge(-14, -5.5, -13.25, 44, 2.75);
  b.hedge(53.25, -5.5, 54, 44, 2.75);
  b.hedge(-14, 43.25, 54, 44, 2.75);
  // muro al otro lado de la calle
  b.box(-14, 0, -16, 54, 2.25, -15.5, MAT.BRICK);
  b.box(-14, 2.25, -16.125, 54, 2.375, -15.5, MAT.CONCRETE);
  // setos interiores del jardín (cobertura)
  b.hedge(-6, 30, -1, 31, 1.25);
  b.hedge(28, 32, 36, 33, 1.25);
  b.hedge(-11, 12, -10, 20, 1.5);
  b.hedge(46, 20, 47, 30, 1.5);
  // árboles
  for (const [x, z, h] of [[-8, -2, 5], [-9, 24, 5.5], [-4, 36, 4.5], [22, 37, 5], [34, 38.5, 4.5], [48.5, -2, 5], [49, 34, 5.5], [-10, 8, 4]]) b.tree(x, z, h);
  // coches aparcados en la calle y furgoneta en el camino lateral
  b.car(4, -11.5, 'x', MAT.CAR_RED);
  b.car(24, -12, 'x', MAT.CAR_WHITE);
  b.car(47.5, 8, 'z', MAT.CAR_WHITE);
  // cobertizo del jardín
  b.box(2, 0, 34, 8, 2.5, 34.25, MAT.FENCE);
  b.box(2, 0, 38.75, 8, 2.5, 39, MAT.FENCE);
  b.box(2, 0, 34, 2.25, 2.5, 39, MAT.FENCE);
  b.box(7.75, 0, 34, 8, 2.5, 39, MAT.FENCE);
  b.clear(4.5, 0, 34, 5.75, 2.125, 34.25);
  b.box(1.75, 2.5, 33.75, 8.25, 2.625, 39.25, MAT.ROOF);
  b.crate(3, 37.5, 0); b.crate(6.75, 37.5, 0);
  // muebles de jardín en el patio
  b.table(16, 27.5, 18, 29, 0, 0.75, MAT.FURN_OAK);
  b.table(22, 27.25, 23.5, 28.25, 0, 0.5, MAT.FURN_OAK);
  // leña y sacos junto al garaje
  b.box(40.25, 0, 10, 41, 1.25, 14, MAT.CRATE);
  b.box(8, 0, -4.5, 10, 0.75, -4, MAT.SANDBAG);
  // farolas (luces)
  for (const x of [-6, 20, 44]) {
    b.box(x - 0.125, 0.125, -6.25, x + 0.125, 4.5, -6.0, MAT.METAL_DARK);
    b.box(x - 0.25, 4.5, -6.5, x + 0.25, 4.625, -5.75, MAT.LAMP_WARM);
    b.light(x, 4.3, -6.1, 'warm', 1.2);
  }
}

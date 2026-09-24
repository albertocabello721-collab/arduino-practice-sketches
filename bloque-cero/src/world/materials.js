// Tabla de materiales de vóxel. La simulación solo usa las propiedades físicas;
// el render resuelve los nombres de textura (surf/edge) a capas del texture array.
//
// Convenciones de destrucción (inspiradas en Siege):
//  - hard: antibalas e indestructible salvo lo indicado en blastRes.
//  - soft: las balas atraviesan y destruyen el vóxel con probabilidad breakChance,
//          perdiendo penCost de "potencia de penetración" por vóxel.
//  - blastRes 0 = lo rompe una carga de brecha/explosión, 1 = solo brecha dura
//          (térmica), 2 = indestructible.
//  - bulletBreak: si las balas pueden romperlo (las trampillas solo caen con
//          explosivos o golpes, como en Siege).

export const SND = {
  none: 0, grass: 1, dirt: 2, concrete: 3, wood: 4, metal: 5, glass: 6,
  carpet: 7, tile: 8, plaster: 9, fabric: 10, gravel: 11, brick: 12,
};

const DEFAULTS = {
  solid: 1, opaque: 1, pass: 0, // pass: 0 opaco, 1 recorte (alpha test), 2 translúcido
  hard: 0, bulletBreak: 1, breakChance: 1, penCost: 0.1, blastRes: 0, melee: 1,
  reinforced: 0, glass: 0, emissive: 0, sight: 1, climb: 0, flammable: 0,
  snd: SND.plaster, surf: 'plaster_paint', edge: null, top: null, bottom: null,
  tint: 'white', name: '', debris: [0.8, 0.8, 0.8],
};

// [clave, propiedades]. El orden define el id (máx. 255).
const LIST = [
  ['AIR', { solid: 0, opaque: 0, sight: 0, snd: SND.none, surf: null }],
  // ---------- terreno y estructura (indestructible) ----------
  ['GROUND', { hard: 1, surf: 'dirt', top: 'grass', snd: SND.grass, name: 'Césped', debris: [0.33, 0.42, 0.2] }],
  ['DIRT', { hard: 1, surf: 'dirt', snd: SND.dirt, name: 'Tierra', debris: [0.4, 0.3, 0.2] }],
  ['CONCRETE', { hard: 1, surf: 'concrete', snd: SND.concrete, name: 'Hormigón', debris: [0.55, 0.55, 0.54] }],
  ['CONCRETE_FLOOR', { hard: 1, surf: 'concrete_floor', snd: SND.concrete, name: 'Solera', debris: [0.5, 0.5, 0.5] }],
  ['BRICK', { hard: 1, surf: 'brick', edge: 'brick_core', snd: SND.brick, name: 'Ladrillo', debris: [0.55, 0.28, 0.2] }],
  ['BRICK_OLD', { hard: 1, surf: 'brick_old', snd: SND.brick, name: 'Ladrillo viejo', debris: [0.45, 0.3, 0.24] }],
  ['STONE', { hard: 1, surf: 'stone', snd: SND.concrete, name: 'Piedra', debris: [0.5, 0.48, 0.45] }],
  ['ASPHALT', { hard: 1, surf: 'asphalt', snd: SND.concrete, name: 'Asfalto', debris: [0.2, 0.2, 0.2] }],
  ['SIDEWALK', { hard: 1, surf: 'sidewalk', snd: SND.concrete, name: 'Acera', debris: [0.6, 0.6, 0.58] }],
  ['GRAVEL', { hard: 1, surf: 'gravel', snd: SND.gravel, name: 'Grava', debris: [0.5, 0.47, 0.42] }],
  ['MARBLE', { hard: 1, surf: 'marble', snd: SND.tile, name: 'Mármol', debris: [0.85, 0.84, 0.82] }],
  ['TILE_CHECKER', { hard: 1, surf: 'tile_checker', snd: SND.tile, name: 'Baldosa', debris: [0.6, 0.6, 0.6] }],
  ['TILE_FLOOR', { hard: 1, surf: 'tile_floor', snd: SND.tile, name: 'Gres', debris: [0.7, 0.66, 0.6] }],
  ['BEAM', { hard: 1, surf: 'wood_dark', snd: SND.wood, name: 'Viga', debris: [0.3, 0.2, 0.12] }],
  ['ROOF', { hard: 1, surf: 'roof', snd: SND.concrete, name: 'Cubierta', debris: [0.3, 0.3, 0.32] }],
  ['METAL_FRAME', { hard: 1, surf: 'metal_dark', snd: SND.metal, name: 'Perfil metálico', debris: [0.3, 0.3, 0.3] }],
  // ---------- paredes blandas (se agujerean bala a bala) ----------
  ['DRYWALL', { surf: 'plaster_paint', edge: 'gypsum', tint: 'paint_white', snd: SND.plaster, penCost: 0.07, name: 'Pladur', debris: [0.86, 0.85, 0.82] }],
  ['DRYWALL_CREAM', { surf: 'plaster_paint', edge: 'gypsum', tint: 'paint_cream', snd: SND.plaster, penCost: 0.07, name: 'Pladur', debris: [0.86, 0.82, 0.72] }],
  ['DRYWALL_SAGE', { surf: 'plaster_paint', edge: 'gypsum', tint: 'paint_sage', snd: SND.plaster, penCost: 0.07, name: 'Pladur', debris: [0.6, 0.66, 0.56] }],
  ['DRYWALL_BLUE', { surf: 'plaster_paint', edge: 'gypsum', tint: 'paint_blue', snd: SND.plaster, penCost: 0.07, name: 'Pladur', debris: [0.55, 0.64, 0.72] }],
  ['DRYWALL_GREY', { surf: 'plaster_paint', edge: 'gypsum', tint: 'paint_grey', snd: SND.plaster, penCost: 0.07, name: 'Pladur', debris: [0.62, 0.62, 0.62] }],
  ['DRYWALL_DIRTY', { surf: 'plaster_dirty', edge: 'gypsum', snd: SND.plaster, penCost: 0.07, name: 'Tabique', debris: [0.6, 0.58, 0.54] }],
  ['WALLPAPER_RED', { surf: 'wallpaper_damask', edge: 'gypsum', tint: 'wp_red', snd: SND.plaster, penCost: 0.07, name: 'Papel pintado', debris: [0.5, 0.2, 0.18] }],
  ['WALLPAPER_GREEN', { surf: 'wallpaper_stripes', edge: 'gypsum', tint: 'wp_green', snd: SND.plaster, penCost: 0.07, name: 'Papel pintado', debris: [0.35, 0.45, 0.35] }],
  ['WALLPAPER_BLUE', { surf: 'wallpaper_dots', edge: 'gypsum', tint: 'wp_blue', snd: SND.plaster, penCost: 0.07, name: 'Papel pintado', debris: [0.5, 0.6, 0.75] }],
  ['WALLPAPER_GOLD', { surf: 'wallpaper_stripes', edge: 'gypsum', tint: 'wp_gold', snd: SND.plaster, penCost: 0.07, name: 'Papel pintado', debris: [0.7, 0.6, 0.35] }],
  ['WOOD_PANEL', { surf: 'wood_panel', edge: 'wood_raw', snd: SND.wood, penCost: 0.09, name: 'Panel de madera', debris: [0.4, 0.26, 0.15] }],
  ['BATH_TILE', { surf: 'tile_wall', edge: 'gypsum', snd: SND.tile, penCost: 0.08, name: 'Azulejo', debris: [0.85, 0.87, 0.88] }],
  ['STUCCO', { surf: 'stucco', edge: 'gypsum', snd: SND.plaster, penCost: 0.1, name: 'Enlucido', debris: [0.8, 0.74, 0.62] }],
  ['SIDING', { surf: 'siding', edge: 'wood_raw', snd: SND.wood, penCost: 0.09, name: 'Revestimiento', debris: [0.82, 0.82, 0.78] }],
  ['GARAGE_DOOR', { surf: 'garage_door', edge: 'metal_dark', snd: SND.metal, penCost: 0.12, breakChance: 0.8, name: 'Puerta de garaje', debris: [0.78, 0.78, 0.76] }],
  // ---------- suelos blandos (juego vertical) ----------
  ['WOOD_FLOOR', { surf: 'wood_floor', edge: 'wood_raw', snd: SND.wood, penCost: 0.12, breakChance: 0.55, name: 'Tarima', debris: [0.5, 0.33, 0.18] }],
  ['PARQUET', { surf: 'parquet', edge: 'wood_raw', snd: SND.wood, penCost: 0.12, breakChance: 0.55, name: 'Parqué', debris: [0.55, 0.36, 0.2] }],
  ['CARPET_RED', { surf: 'carpet', edge: 'wood_raw', tint: 'carpet_red', snd: SND.carpet, penCost: 0.1, breakChance: 0.5, name: 'Moqueta', debris: [0.5, 0.15, 0.15] }],
  ['CARPET_BLUE', { surf: 'carpet', edge: 'wood_raw', tint: 'carpet_blue', snd: SND.carpet, penCost: 0.1, breakChance: 0.5, name: 'Moqueta', debris: [0.2, 0.28, 0.45] }],
  ['CARPET_GREY', { surf: 'carpet', edge: 'wood_raw', tint: 'carpet_grey', snd: SND.carpet, penCost: 0.1, breakChance: 0.5, name: 'Moqueta', debris: [0.45, 0.45, 0.45] }],
  ['CEILING', { surf: 'ceiling', edge: 'gypsum', snd: SND.plaster, penCost: 0.07, breakChance: 0.6, name: 'Techo', debris: [0.9, 0.9, 0.88] }],
  // ---------- especiales de Siege ----------
  ['REINFORCED', { hard: 1, reinforced: 1, blastRes: 1, surf: 'steel_plate', edge: 'steel_plate', snd: SND.metal, name: 'Refuerzo', debris: [0.5, 0.52, 0.55] }],
  ['HATCH', { bulletBreak: 0, melee: 0, surf: 'hatch', edge: 'wood_raw', snd: SND.wood, penCost: 0.2, name: 'Trampilla', debris: [0.45, 0.32, 0.2] }],
  ['BARRICADE', { surf: 'barricade', edge: 'wood_raw', snd: SND.wood, penCost: 0.05, name: 'Barricada', debris: [0.62, 0.46, 0.28] }],
  ['GLASS', { opaque: 0, pass: 2, glass: 1, sight: 0, surf: 'glass', snd: SND.glass, penCost: 0.02, name: 'Cristal', debris: [0.75, 0.85, 0.9] }],
  ['TRIM', { surf: 'trim', edge: 'wood_raw', snd: SND.wood, penCost: 0.1, name: 'Moldura', debris: [0.9, 0.9, 0.88] }],
  ['DOOR_WOOD', { surf: 'door', edge: 'wood_raw', snd: SND.wood, penCost: 0.1, name: 'Puerta', debris: [0.5, 0.35, 0.2] }],
  // ---------- mobiliario ----------
  ['FURN_OAK', { surf: 'wood_oak', edge: 'wood_raw', snd: SND.wood, penCost: 0.1, breakChance: 0.7, name: 'Madera', debris: [0.6, 0.45, 0.28] }],
  ['FURN_DARK', { surf: 'wood_dark', edge: 'wood_raw', snd: SND.wood, penCost: 0.1, breakChance: 0.7, name: 'Madera', debris: [0.3, 0.2, 0.12] }],
  ['FURN_WHITE', { surf: 'lacquer', edge: 'wood_raw', tint: 'paint_white', snd: SND.wood, penCost: 0.1, breakChance: 0.7, name: 'Mueble', debris: [0.9, 0.9, 0.88] }],
  ['FABRIC', { surf: 'fabric', edge: 'foam', tint: 'fabric_grey', snd: SND.fabric, penCost: 0.03, breakChance: 0.6, name: 'Tapizado', debris: [0.45, 0.47, 0.48] }],
  ['FABRIC_GREEN', { surf: 'fabric', edge: 'foam', tint: 'fabric_green', snd: SND.fabric, penCost: 0.03, breakChance: 0.6, name: 'Tapizado', debris: [0.3, 0.4, 0.32] }],
  ['BEDSHEET', { surf: 'bedsheet', edge: 'foam', snd: SND.fabric, penCost: 0.03, breakChance: 0.6, name: 'Cama', debris: [0.85, 0.87, 0.9] }],
  ['BOOKS', { surf: 'books', edge: 'wood_raw', snd: SND.wood, penCost: 0.15, breakChance: 0.6, name: 'Libros', debris: [0.5, 0.3, 0.25] }],
  ['COUNTER', { hard: 1, surf: 'granite', snd: SND.tile, name: 'Encimera', debris: [0.3, 0.3, 0.3] }],
  ['APPLIANCE', { hard: 1, surf: 'enamel', snd: SND.metal, name: 'Electrodoméstico', debris: [0.9, 0.9, 0.9] }],
  ['METAL_DARK', { hard: 1, surf: 'metal_dark', snd: SND.metal, name: 'Metal', debris: [0.25, 0.25, 0.27] }],
  ['METAL_SHEET', { surf: 'metal_sheet', edge: 'metal_dark', snd: SND.metal, penCost: 0.2, breakChance: 0.5, name: 'Chapa', debris: [0.6, 0.6, 0.62] }],
  ['CRATE', { surf: 'crate', edge: 'wood_raw', snd: SND.wood, penCost: 0.12, breakChance: 0.8, name: 'Caja', debris: [0.6, 0.48, 0.3] }],
  ['BARREL', { surf: 'barrel', edge: 'wood_raw', snd: SND.wood, penCost: 0.15, breakChance: 0.6, name: 'Barrica', debris: [0.42, 0.28, 0.16] }],
  ['LAMP_WARM', { hard: 1, emissive: 1, surf: 'lamp', tint: 'lamp_warm', snd: SND.glass, name: 'Lámpara', debris: [1, 0.9, 0.7] }],
  ['LAMP_COOL', { hard: 1, emissive: 2, surf: 'lamp', tint: 'lamp_cool', snd: SND.glass, name: 'Fluorescente', debris: [0.9, 0.95, 1] }],
  ['SCREEN', { hard: 1, emissive: 3, surf: 'screen', snd: SND.glass, name: 'Pantalla', debris: [0.1, 0.1, 0.12] }],
  // ---------- exterior ----------
  ['LEAVES', { opaque: 0, pass: 1, sight: 1, surf: 'leaves', snd: SND.fabric, penCost: 0.01, bulletBreak: 0, melee: 0, blastRes: 2, name: 'Seto', debris: [0.2, 0.35, 0.15] }],
  ['BARK', { hard: 1, surf: 'bark', top: 'wood_rings', bottom: 'wood_rings', snd: SND.wood, name: 'Tronco', debris: [0.35, 0.25, 0.18] }],
  ['FENCE', { surf: 'fence', edge: 'wood_raw', snd: SND.wood, penCost: 0.08, name: 'Valla', debris: [0.6, 0.5, 0.36] }],
  ['CAR_RED', { hard: 1, surf: 'car_paint', tint: 'car_red', snd: SND.metal, name: 'Coche', debris: [0.6, 0.1, 0.1] }],
  ['CAR_BLUE', { hard: 1, surf: 'car_paint', tint: 'car_blue', snd: SND.metal, name: 'Coche', debris: [0.15, 0.25, 0.5] }],
  ['CAR_WHITE', { hard: 1, surf: 'car_paint', tint: 'paint_white', snd: SND.metal, name: 'Furgoneta', debris: [0.9, 0.9, 0.9] }],
  ['TIRE', { hard: 1, surf: 'rubber', snd: SND.fabric, name: 'Neumático', debris: [0.08, 0.08, 0.08] }],
  ['LADDER', { solid: 0, opaque: 0, pass: 1, sight: 0, climb: 1, bulletBreak: 0, melee: 0, blastRes: 2, surf: 'ladder', snd: SND.metal, name: 'Escalera de mano', debris: [0.4, 0.4, 0.4] }],
  ['RAIL', { hard: 1, surf: 'metal_dark', snd: SND.metal, sight: 0, name: 'Barandilla', debris: [0.2, 0.2, 0.2] }],
  ['SANDBAG', { surf: 'sandbag', edge: 'dirt', snd: SND.dirt, penCost: 0.35, breakChance: 0.25, blastRes: 1, name: 'Sacos', debris: [0.55, 0.5, 0.38] }],
];

export const MAT = {};
export const MATERIAL_COUNT = LIST.length;
export const MATS = LIST.map(([key, props], id) => {
  const m = Object.assign({}, DEFAULTS, props, { id, key });
  if (m.hard) {
    m.bulletBreak = props.bulletBreak ?? 0;
    m.breakChance = props.breakChance ?? 0;
    if (props.blastRes === undefined) m.blastRes = 2;
    if (props.melee === undefined) m.melee = 0;
  }
  if (!m.edge) m.edge = m.surf;
  if (!m.top) m.top = m.surf;
  if (!m.bottom) m.bottom = m.surf;
  MAT[key] = id;
  return m;
});

// Tablas planas para los bucles calientes (física, raycast, mallado).
function table(fn, Type = Uint8Array) {
  const t = new Type(256);
  for (const m of MATS) t[m.id] = fn(m);
  return t;
}
export const SOLID = table((m) => m.solid);
export const OPAQUE = table((m) => m.opaque);            // oculta caras vecinas / bloquea luz
export const PASS = table((m) => m.pass);
export const HARD = table((m) => m.hard);                 // la bala se detiene
export const BULLET_BREAK = table((m) => (m.hard ? 0 : m.bulletBreak));
export const BREAK_CHANCE = table((m) => m.breakChance, Float32Array);
export const PEN_COST = table((m) => m.penCost, Float32Array);
export const BLAST_RES = table((m) => m.blastRes);
export const MELEE = table((m) => m.melee);
export const BLOCKS_SIGHT = table((m) => m.sight);
export const CLIMB = table((m) => m.climb);
export const GLASS = table((m) => m.glass);
export const SOUND = table((m) => m.snd);
export const EMISSIVE = table((m) => m.emissive);

export function isSoftWall(id) {
  const m = MATS[id];
  return m && !m.hard && m.solid && !m.glass && m.bulletBreak;
}

// Plantilla de operadores (8 atacantes + 8 defensores). Datos puros: los usa la
// simulación (blindaje, arsenal, habilidad), la selección, el HUD y el render
// (aspecto). Las habilidades y los gadgets secundarios funcionan desde la Fase 6;
// los drones y refuerzos de todos, desde la Fase 4.
//
// Contrajuego (Fase 6):
//   TERMO (carga exotérmica) ← VOLTIO (baterías) ← CHISPA (PEM) / PULGA (drones de choque)
//   RACIMO / CHISPA (granadas) ← GUARDIÁN (defensa activa)
//   drones ← SILENCIO (inhibidores) ← MAZO / RACIMO (destrucción)
//   CEPO (trampas láser) ← ONDA (detector) / disparos al dispositivo
//   OJO (cámaras) ← PULGA / ONDA · PULSO (latidos) y RADAR (escáner) revelan posiciones

export const ARMOR_SPEED = { 1: 3, 2: 2, 3: 1 };

export const OPERATORS = [
  // ------------------------------------------------------------------ ataque
  {
    id: 'termo', name: 'TERMO', side: 'atk', armor: 2, color: '#e0662f',
    primaries: ['ar', 'shotgun'], secondaries: ['pistol', 'revolver'],
    ability: { id: 'exo', name: 'Carga exotérmica', count: 2, desc: 'Funde muros reforzados y abre un boquete del tamaño de una persona.' },
    gadgets: ['frag', 'smoke'],
    look: { shirt: '#6f6a58', pants: '#7d7155', vest: '#8b7a55', helmet: '#7a6d52', gloves: '#3b352c', boots: '#3a2f25', skin: '#b98a6a', camo: 1, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'mazo', name: 'MAZO', side: 'atk', armor: 2, color: '#b8452f',
    primaries: ['ar2', 'smg'], secondaries: ['mpistol', 'pistol'],
    ability: { id: 'hammer', name: 'Mazo de brecha', count: 25, desc: 'Destroza paredes blandas, suelos, trampillas y barricadas en silencio.' },
    gadgets: ['frag', 'flash'],
    look: { shirt: '#4d5347', pants: '#5a5f4a', vest: '#4f5541', helmet: '#4a4f3f', gloves: '#2b2b27', boots: '#2a2622', skin: '#8d5f45', camo: 1, head: 'helmet', face: 'mask' },
  },
  {
    id: 'chispa', name: 'CHISPA', side: 'atk', armor: 2, color: '#e6b534',
    primaries: ['ar', 'dmr'], secondaries: ['pistol'],
    ability: { id: 'emp', name: 'Granada PEM', count: 3, desc: 'Inutiliza los aparatos electrónicos enemigos en su radio, incluso a través de paredes.' },
    gadgets: ['breach', 'claymore'],
    look: { shirt: '#5c5445', pants: '#6b6048', vest: '#766645', helmet: '#3d3a33', gloves: '#302b25', boots: '#33291f', skin: '#d0a07d', camo: 0, head: 'cap', face: 'glasses' },
  },
  {
    id: 'pulga', name: 'PULGA', side: 'atk', armor: 2, color: '#d06aa8',
    primaries: ['ar2', 'dmr', 'shotgun'], secondaries: ['pistol'],
    ability: { id: 'shockdrone', name: 'Dron de choque', count: 2, desc: 'Sus drones disparan un láser que destruye gadgets y daña a los defensores.' },
    gadgets: ['breach', 'claymore'],
    look: { shirt: '#5a4c52', pants: '#62585a', vest: '#6e5f60', helmet: '#4b3f44', gloves: '#2c2628', boots: '#2b2224', skin: '#c89478', camo: 1, head: 'helmet', face: 'none' },
  },
  {
    id: 'onda', name: 'ONDA', side: 'atk', armor: 1, color: '#43c0b5',
    primaries: ['ar', 'lmg', 'dmr'], secondaries: ['pistol'],
    ability: { id: 'scanner', name: 'Detector de electrónica', count: -1, desc: 'Ve los aparatos enemigos a través de las paredes y los destruye con precisión.' },
    gadgets: ['breach', 'frag'],
    look: { shirt: '#4a5550', pants: '#56605a', vest: '#5d6a61', helmet: '#39413c', gloves: '#262a28', boots: '#232625', skin: '#e0b494', camo: 0, head: 'cap', face: 'none' },
  },
  {
    id: 'rompe', name: 'ROMPE', side: 'atk', armor: 2, color: '#a0785a',
    primaries: ['ar2', 'shotgun'], secondaries: ['revolver'],
    ability: { id: 'keymaster', name: 'Escopeta bajo cañón', count: 25, desc: 'Cartuchos de brecha para abrir suelos y techos y verticalizar el ataque.' },
    gadgets: ['frag', 'smoke'],
    look: { shirt: '#6a5d4e', pants: '#6f624f', vest: '#5a4e3f', helmet: '#5d5244', gloves: '#2e2822', boots: '#31281f', skin: '#a7765a', camo: 1, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'racimo', name: 'RACIMO', side: 'atk', armor: 3, color: '#8fb33c',
    primaries: ['lmg', 'ar'], secondaries: ['revolver', 'pistol'],
    ability: { id: 'cluster', name: 'Carga de racimo', count: 3, desc: 'Perfora una pared y lanza cinco granadas a la sala del otro lado.' },
    gadgets: ['breach', 'smoke'],
    look: { shirt: '#56583d', pants: '#5f6043', vest: '#6a6a45', helmet: '#4c4d36', gloves: '#2b2b22', boots: '#29271e', skin: '#c08c6c', camo: 1, head: 'helmet', face: 'mask' },
  },
  {
    id: 'radar', name: 'RADAR', side: 'atk', armor: 2, color: '#5b8fe0',
    primaries: ['ar', 'dmr'], secondaries: ['pistol', 'mpistol'],
    ability: { id: 'scan', name: 'Escáner de movimiento', count: 3, desc: 'Durante unos segundos revela a todo defensor que se mueva en el edificio.' },
    gadgets: ['claymore', 'flash'],
    look: { shirt: '#5a5f63', pants: '#63686b', vest: '#4f5559', helmet: '#44494d', gloves: '#27292b', boots: '#242628', skin: '#8a5c44', camo: 0, head: 'helmet', face: 'goggles' },
  },
  // ------------------------------------------------------------------ defensa
  {
    id: 'voltio', name: 'VOLTIO', side: 'def', armor: 1, color: '#f0d23c',
    primaries: ['smg', 'smg2'], secondaries: ['pistol'],
    ability: { id: 'battery', name: 'Batería de choque', count: 4, desc: 'Electrifica muros reforzados y alambre: destruye las cargas que se coloquen encima.' },
    gadgets: ['barbed', 'nitro'],
    look: { shirt: '#3a3f47', pants: '#40454d', vest: '#2d333d', helmet: '#23272d', gloves: '#1f1f21', boots: '#1c1c1e', skin: '#c49474', camo: 2, head: 'cap', face: 'none' },
  },
  {
    id: 'silencio', name: 'SILENCIO', side: 'def', armor: 2, color: '#9aa7b5',
    primaries: ['smg', 'shotgun'], secondaries: ['mpistol', 'pistol'],
    ability: { id: 'jammer', name: 'Inhibidor de señal', count: 4, desc: 'Bloquea drones, cargas remotas y escáneres en un radio de 2,5 m.' },
    gadgets: ['barbed', 'shield'],
    look: { shirt: '#39414f', pants: '#3b4250', vest: '#2d333d', helmet: '#262b33', gloves: '#1f1f21', boots: '#1c1c1e', skin: '#e0b494', camo: 2, head: 'helmet', face: 'mask' },
  },
  {
    id: 'cepo', name: 'CEPO', side: 'def', armor: 2, color: '#c7493f',
    primaries: ['smg2', 'shotgun2'], secondaries: ['pistol'],
    ability: { id: 'trap', name: 'Trampa láser', count: 5, desc: 'Se fija en el marco de una puerta o ventana y explota al cruzar el láser.' },
    gadgets: ['nitro', 'impact'],
    look: { shirt: '#4a4f58', pants: '#4f545c', vest: '#3a3f47', helmet: '#30353c', gloves: '#222224', boots: '#1e1e20', skin: '#6e4a36', camo: 2, head: 'hood', face: 'mask' },
  },
  {
    id: 'guardian', name: 'GUARDIÁN', side: 'def', armor: 2, color: '#6fbf5a',
    primaries: ['ar', 'shotgun'], secondaries: ['pistol'],
    ability: { id: 'ads', name: 'Defensa activa', count: 3, desc: 'Intercepta granadas y proyectiles enemigos antes de que exploten.' },
    gadgets: ['barbed', 'shield'],
    look: { shirt: '#3f4745', pants: '#434b49', vest: '#343c3a', helmet: '#2a312f', gloves: '#1e2120', boots: '#1b1d1c', skin: '#d8a888', camo: 2, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'ojo', name: 'OJO', side: 'def', armor: 2, color: '#3db0e0',
    primaries: ['smg', 'shotgun2'], secondaries: ['revolver'],
    ability: { id: 'stickycam', name: 'Cámara adhesiva', count: 3, desc: 'Lanza cámaras que se pegan a cualquier superficie para vigilar los accesos.' },
    gadgets: ['nitro', 'impact'],
    look: { shirt: '#2f3540', pants: '#343a45', vest: '#454a52', helmet: '#1f2328', gloves: '#1b1b1d', boots: '#19191b', skin: '#b07c5c', camo: 0, head: 'cap', face: 'glasses' },
  },
  {
    id: 'remedio', name: 'REMEDIO', side: 'def', armor: 3, color: '#e8e8e8',
    primaries: ['smg2', 'shotgun'], secondaries: ['pistol'],
    ability: { id: 'stim', name: 'Pistola de estimulantes', count: 3, desc: 'Cura 40 puntos a distancia y levanta a compañeros derribados.' },
    gadgets: ['barbed', 'shield'],
    look: { shirt: '#3b4046', pants: '#40454b', vest: '#50565e', helmet: '#2c3036', gloves: '#1c1d1f', boots: '#1a1b1d', skin: '#caa184', camo: 2, head: 'helmet', face: 'none' },
  },
  {
    id: 'humo', name: 'HUMO', side: 'def', armor: 2, color: '#7fa05a',
    primaries: ['smg', 'shotgun'], secondaries: ['mpistol'],
    ability: { id: 'gas', name: 'Bote de gas tóxico', count: 3, desc: 'Detonación remota: una nube que hiere a quien la cruza.' },
    gadgets: ['barbed', 'impact'],
    look: { shirt: '#3a3d38', pants: '#3f423c', vest: '#30332d', helmet: '#262824', gloves: '#1d1e1c', boots: '#1a1b19', skin: '#9c6c50', camo: 2, head: 'hood', face: 'mask' },
  },
  {
    id: 'pulso', name: 'PULSO', side: 'def', armor: 1, color: '#e0457a',
    primaries: ['smg2', 'shotgun2'], secondaries: ['revolver', 'pistol'],
    ability: { id: 'heartbeat', name: 'Sensor de latidos', count: -1, desc: 'Detecta los latidos de los atacantes a través de paredes y suelos (9 m).' },
    gadgets: ['nitro', 'shield'],
    look: { shirt: '#383d47', pants: '#3d424c', vest: '#2b3039', helmet: '#20242a', gloves: '#1e1e20', boots: '#1b1b1d', skin: '#e3b596', camo: 0, head: 'helmet', face: 'goggles' },
  },
];

export const OP_BY_ID = Object.fromEntries(OPERATORS.map((o) => [o.id, o]));
export const opsForSide = (side) => OPERATORS.filter((o) => o.side === side);

export const GADGETS = {
  breach: { name: 'Carga de brecha', count: 3 },
  frag: { name: 'Granada de fragmentación', count: 2 },
  smoke: { name: 'Granada de humo', count: 2 },
  flash: { name: 'Granada cegadora', count: 3 },
  claymore: { name: 'Mina direccional', count: 1 },
  barbed: { name: 'Alambre de espino', count: 2 },
  nitro: { name: 'Carga explosiva remota', count: 1 },
  impact: { name: 'Granada de impacto', count: 2 },
  shield: { name: 'Escudo desplegable', count: 1 },
};

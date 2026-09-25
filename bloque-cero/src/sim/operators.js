// Plantilla de operadores (8 atacantes + 8 defensores), según la sección 12 del documento
// con los nombres propios del juego. Datos puros: los usa la simulación (blindaje,
// arsenal, gadget, habilidad), la selección, el HUD y el render (aspecto).
//   armor: 1 (rápido, 3 de velocidad) · 2 · 3 (lento, mucho blindaje). «3/1» del documento
//   es velocidad 3 y blindaje 1.
//   gadgets: los dos gadgets secundarios entre los que se elige.
//   ability: habilidad única (tecla X) con sus números y sus contras.
//
// Contrajuego (sección 12):
//   TERMO (cargas térmicas) ← VOLTIO (baterías), SILENCIO (inhibidores)
//   VOLTIO (baterías) ← CHISPA (PEM), PULGA (dron de choque)
//   ROMPE (proyectiles), granadas y humos ← GUARDIÁN (interceptores)
//   drones y cargas remotas ← SILENCIO (inhibidores) ← disparos, PEM
//   RADAR (pulsos) ← quedarse quieto · CEPO (minas) ← drones, disparos, PEM

export const ARMOR_SPEED = { 1: 3, 2: 2, 3: 1 };

export const OPERATORS = [
  // ------------------------------------------------------------------ ataque
  {
    id: 'termo', name: 'TERMO', side: 'atk', armor: 2, role: 'Brecha dura', color: '#e0662f',
    primaries: ['ar', 'shotgun'], secondaries: ['pistol'],
    gadgets: ['breach', 'claymore'],
    ability: {
      id: 'thermal', name: 'Carga térmica', count: 2,
      desc: 'Se coloca en 2 s en un muro reforzado, una pared blanda o una trampilla; a los 5 s abre un hueco de 1,9 × 1,1 m.',
      counters: 'La batería de VOLTIO la destruye al colocarla; el inhibidor de SILENCIO impide la detonación.',
    },
    look: { shirt: '#6f6a58', pants: '#7d7155', vest: '#8b7a55', helmet: '#7a6d52', gloves: '#3b352c', boots: '#3a2f25', skin: '#b98a6a', camo: 1, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'rompe', name: 'ROMPE', side: 'atk', armor: 1, role: 'Brecha a distancia', color: '#a0785a',
    primaries: ['ar2', 'smg'], secondaries: ['pistol'],
    gadgets: ['smoke', 'flash'],
    ability: {
      id: 'breachround', name: 'Proyectil de brecha', count: 2,
      desc: 'Se pega hasta a 40 m y a los 1,5 s abre 1,5 m de pared blanda, barricada o trampilla sin reforzar.',
      counters: 'Los interceptores de GUARDIÁN lo destruyen en el aire.',
    },
    look: { shirt: '#6a5d4e', pants: '#6f624f', vest: '#5a4e3f', helmet: '#5d5244', gloves: '#2e2822', boots: '#31281f', skin: '#a7765a', camo: 1, head: 'cap', face: 'glasses' },
  },
  {
    id: 'muralla', name: 'MURALLA', side: 'atk', armor: 3, role: 'Escudo', color: '#8a93a6',
    primaries: [], secondaries: ['pistol', 'revolver'],
    gadgets: ['frag', 'smoke'],
    ability: {
      id: 'shield', name: 'Escudo balístico', short: 'Destello', count: 4,
      desc: 'Cubre el frente. 4 destellos desde el escudo ciegan en un cono de 5 m y 90°. Golpe con escudo: 40 de daño. Correr lo baja.',
      counters: 'Flanquearlo, disparar a los pies o a la cabeza que asoma, explosivos.',
    },
    look: { shirt: '#4c525c', pants: '#535a64', vest: '#5d6572', helmet: '#3f454e', gloves: '#25272a', boots: '#232427', skin: '#c9977a', camo: 0, head: 'helmet', face: 'mask' },
  },
  {
    id: 'radar', name: 'RADAR', side: 'atk', armor: 2, role: 'Información', color: '#5b8fe0',
    primaries: ['ar', 'smg2'], secondaries: ['mpistol'],
    gadgets: ['claymore', 'flash'],
    ability: {
      id: 'scan', name: 'Pulso de escaneo', count: 3,
      desc: 'Aviso audible de 2 s para todos; después, durante 4 s, todo defensor que se mueva queda marcado.',
      counters: 'Quedarse quieto durante el pulso.',
    },
    look: { shirt: '#5a5f63', pants: '#63686b', vest: '#4f5559', helmet: '#44494d', gloves: '#27292b', boots: '#242628', skin: '#8a5c44', camo: 0, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'pulga', name: 'PULGA', side: 'atk', armor: 2, role: 'Anti-gadgets', color: '#d06aa8',
    primaries: ['ar2', 'shotgun'], secondaries: ['pistol'],
    gadgets: ['breach', 'frag'],
    ability: {
      id: 'shockdrone', name: 'Dron de choque', count: 6,
      desc: 'Su primer dron dispara un rayo que destruye gadgets defensores: 6 cargas y recupera 1 cada 12 s.',
      counters: 'El inhibidor de SILENCIO le corta la señal; un disparo lo destruye.',
    },
    look: { shirt: '#5a4c52', pants: '#62585a', vest: '#6e5f60', helmet: '#4b3f44', gloves: '#2c2628', boots: '#2b2224', skin: '#c89478', camo: 1, head: 'helmet', face: 'none' },
  },
  {
    id: 'chispa', name: 'CHISPA', side: 'atk', armor: 1, role: 'Apoyo', color: '#e6b534',
    primaries: ['smg', 'ar'], secondaries: ['mpistol'],
    gadgets: ['breach', 'claymore'],
    ability: {
      id: 'emp', name: 'Granada PEM', count: 3,
      desc: 'Radio de 5 m, atraviesa paredes: desactiva 15 s la electrónica (baterías, inhibidores, cámaras, minas, interceptores).',
      counters: 'Repartir los gadgets para que una sola PEM no los alcance a todos.',
    },
    look: { shirt: '#5c5445', pants: '#6b6048', vest: '#766645', helmet: '#3d3a33', gloves: '#302b25', boots: '#33291f', skin: '#d0a07d', camo: 0, head: 'cap', face: 'glasses' },
  },
  {
    id: 'nube', name: 'NUBE', side: 'atk', armor: 2, role: 'Control', color: '#9fb4c8',
    primaries: ['ar2', 'lmg'], secondaries: ['pistol'],
    gadgets: ['flash', 'breach'],
    ability: {
      id: 'remotesmoke', name: 'Humo remoto', count: 3,
      desc: 'Lanzagranadas de humo: hasta 40 m, la nube dura 10 s con 4 m de radio. Ciega también a la IA.',
      counters: 'Los interceptores de GUARDIÁN; disparar a ciegas a través del humo.',
    },
    look: { shirt: '#56606a', pants: '#5e6770', vest: '#6a747d', helmet: '#4a525a', gloves: '#292c2f', boots: '#26282b', skin: '#e2b699', camo: 1, head: 'hood', face: 'mask' },
  },
  {
    id: 'lumen', name: 'LUMEN', side: 'atk', armor: 1, role: 'Tirador', color: '#d9483b',
    primaries: ['dmr', 'smg2'], secondaries: ['pistol'],
    gadgets: ['smoke', 'claymore'],
    ability: {
      id: 'thermalscope', name: 'Visor térmico 3x', count: -1,
      desc: 'Apuntando y quieto, resalta a los enemigos con colores de calor hasta 30 m, incluso dentro del humo.',
      counters: 'Moverse de cobertura en cobertura; romperle la línea de visión.',
    },
    look: { shirt: '#4e4a44', pants: '#58534b', vest: '#625b50', helmet: '#3d3a35', gloves: '#29272a', boots: '#252322', skin: '#9a6a4e', camo: 1, head: 'cap', face: 'goggles' },
  },
  // ------------------------------------------------------------------ defensa
  {
    id: 'voltio', name: 'VOLTIO', side: 'def', armor: 1, role: 'Negación', color: '#f0d23c',
    primaries: ['smg2', 'shotgun'], secondaries: ['pistol'],
    gadgets: ['barbed', 'c4'],
    ability: {
      id: 'battery', name: 'Batería de choque', count: 4,
      desc: 'Electrifica el muro reforzado, la barricada o el alambre donde se pone: destruye cargas, drones y gadgets que los toquen y hace 10 de daño por segundo.',
      counters: 'La PEM de CHISPA y el dron de choque de PULGA.',
    },
    look: { shirt: '#3a3f47', pants: '#40454d', vest: '#2d333d', helmet: '#23272d', gloves: '#1f1f21', boots: '#1c1c1e', skin: '#c49474', camo: 2, head: 'cap', face: 'none' },
  },
  {
    id: 'silencio', name: 'SILENCIO', side: 'def', armor: 2, role: 'Negación', color: '#9aa7b5',
    primaries: ['smg', 'shotgun'], secondaries: ['mpistol'],
    gadgets: ['shield', 'barbed'],
    ability: {
      id: 'jammer', name: 'Inhibidor de señal', count: 4,
      desc: 'Radio de 2,5 m: los drones pierden la señal y las cargas remotas no detonan.',
      counters: 'Disparos, la PEM de CHISPA y el dron de choque de PULGA.',
    },
    look: { shirt: '#39414f', pants: '#3b4250', vest: '#2d333d', helmet: '#262b33', gloves: '#1f1f21', boots: '#1c1c1e', skin: '#e0b494', camo: 2, head: 'helmet', face: 'mask' },
  },
  {
    id: 'cepo', name: 'CEPO', side: 'def', armor: 2, role: 'Trampas', color: '#c7493f',
    primaries: ['smg2', 'ar2'], secondaries: ['pistol'],
    gadgets: ['shield', 'alarm'],
    ability: {
      id: 'lasermine', name: 'Mina láser', count: 5,
      desc: 'En marcos de puertas y ventanas; el láser solo se ve a menos de 2 m o con un dron. 60 de daño y aviso al equipo.',
      counters: 'Drones para verlas, disparos, la PEM de CHISPA.',
    },
    look: { shirt: '#4a4f58', pants: '#4f545c', vest: '#3a3f47', helmet: '#30353c', gloves: '#222224', boots: '#1e1e20', skin: '#6e4a36', camo: 2, head: 'hood', face: 'mask' },
  },
  {
    id: 'ojo', name: 'OJO', side: 'def', armor: 2, role: 'Información', color: '#3db0e0',
    primaries: ['smg', 'shotgun'], secondaries: ['revolver'],
    gadgets: ['c4', 'barbed'],
    ability: {
      id: 'stickycam', name: 'Cámara adhesiva', count: 3,
      desc: 'Se lanza y se pega a cualquier superficie; se suma al sistema de cámaras.',
      counters: 'Disparos y el dron de choque de PULGA.',
    },
    look: { shirt: '#2f3540', pants: '#343a45', vest: '#454a52', helmet: '#1f2328', gloves: '#1b1b1d', boots: '#19191b', skin: '#b07c5c', camo: 0, head: 'cap', face: 'glasses' },
  },
  {
    id: 'coraza', name: 'CORAZA', side: 'def', armor: 3, role: 'Apoyo', color: '#c79a3a',
    primaries: ['ar2', 'smg'], secondaries: ['pistol'],
    gadgets: ['barbed', 'impact'],
    ability: {
      id: 'plates', name: 'Placas de armadura', count: 5,
      desc: 'Bolsa con 5 placas (una por defensor): +20 de vida y siempre derribo en vez de muerte, salvo disparo a la cabeza.',
      counters: 'Los disparos a la cabeza; destruir la bolsa.',
    },
    look: { shirt: '#3d3a33', pants: '#423f37', vest: '#5a5140', helmet: '#35322c', gloves: '#201f1c', boots: '#1d1c1a', skin: '#caa184', camo: 2, head: 'helmet', face: 'none' },
  },
  {
    id: 'guardian', name: 'GUARDIÁN', side: 'def', armor: 1, role: 'Anti-proyectiles', color: '#6fbf5a',
    primaries: ['ar', 'shotgun'], secondaries: ['pistol'],
    gadgets: ['shield', 'bpcam'],
    ability: {
      id: 'interceptor', name: 'Interceptor', count: 2,
      desc: 'Destruye hasta 2 proyectiles cada uno (granadas, humos, cegadoras, proyectiles de ROMPE) en 6 m con línea de visión; recarga 1 cada 20 s.',
      counters: 'La PEM de CHISPA; saturarlo con más proyectiles de los que puede parar.',
    },
    look: { shirt: '#3f4745', pants: '#434b49', vest: '#343c3a', helmet: '#2a312f', gloves: '#1e2120', boots: '#1b1d1c', skin: '#d8a888', camo: 2, head: 'helmet', face: 'goggles' },
  },
  {
    id: 'remedio', name: 'REMEDIO', side: 'def', armor: 3, role: 'Médico', color: '#e8e8e8',
    primaries: ['smg', 'shotgun'], secondaries: ['pistol'],
    gadgets: ['barbed', 'bpcam'],
    ability: {
      id: 'stim', name: 'Pistola de estimulantes', count: 3,
      desc: '3 dosis: +40 de vida (hasta 140 temporal) a un aliado o a sí mismo; a un derribado lo levanta a distancia.',
      counters: 'Presionar antes de que pueda curar; derribar al médico primero.',
    },
    look: { shirt: '#3b4046', pants: '#40454b', vest: '#50565e', helmet: '#2c3036', gloves: '#1c1d1f', boots: '#1a1b1d', skin: '#caa184', camo: 2, head: 'helmet', face: 'none' },
  },
  {
    id: 'tizon', name: 'TIZÓN', side: 'def', armor: 2, role: 'Negación', color: '#7fa05a',
    primaries: ['lmg', 'smg2'], secondaries: ['pistol'],
    gadgets: ['shield', 'barbed'],
    ability: {
      id: 'gas', name: 'Bote de gas', count: 3,
      desc: 'Remoto: nube de 4 m de radio durante 10 s, 12 de daño por segundo y menos visión.',
      counters: 'Se destruye de un disparo antes de activarlo; la PEM de CHISPA.',
    },
    look: { shirt: '#3a3d38', pants: '#3f423c', vest: '#30332d', helmet: '#262824', gloves: '#1d1e1c', boots: '#1a1b19', skin: '#9c6c50', camo: 2, head: 'hood', face: 'mask' },
  },
];

export const OP_BY_ID = Object.fromEntries(OPERATORS.map((o) => [o.id, o]));
export const opsForSide = (side) => OPERATORS.filter((o) => o.side === side);

// Gadgets secundarios (sección 13).
export const GADGETS = {
  // ataque
  frag: { name: 'Granada de fragmentación', short: 'Fragmentación', count: 2, side: 'atk' },
  breach: { name: 'Carga de brecha', short: 'Brecha', count: 2, side: 'atk' },
  smoke: { name: 'Granada de humo', short: 'Humo', count: 2, side: 'atk' },
  flash: { name: 'Granada cegadora', short: 'Cegadora', count: 3, side: 'atk' },
  claymore: { name: 'Claymore', short: 'Claymore', count: 1, side: 'atk' },
  // defensa
  barbed: { name: 'Alambre de púas', short: 'Alambre', count: 2, side: 'def' },
  shield: { name: 'Escudo desplegable', short: 'Escudo', count: 1, side: 'def' },
  impact: { name: 'Granada de impacto', short: 'Impacto', count: 2, side: 'def' },
  c4: { name: 'C4 remoto', short: 'C4', count: 1, side: 'def' },
  bpcam: { name: 'Cámara blindada', short: 'Cám. blindada', count: 1, side: 'def' },
  alarm: { name: 'Alarma de proximidad', short: 'Alarma', count: 2, side: 'def' },
};

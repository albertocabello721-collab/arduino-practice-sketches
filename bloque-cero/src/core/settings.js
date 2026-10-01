// Ajustes del jugador. localStorage puede no existir (ventana privada, vista
// previa, datos bloqueados): todo acceso va dentro de try/catch y el juego
// funciona igual con los valores por defecto.
const KEY = 'bloque-cero:ajustes:v2';

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,     // multiplicador sobre 0,0022 rad/píxel
  adsSensitivity: 0.8,
  fov: 72,              // vertical
  volume: 0.8,
  sfxVolume: 1,         // efectos, música y voz, sobre el volumen general (F12.3)
  musicVolume: 1,
  voiceVolume: 1,
  leanToggle: true,     // Q/E alternan (como en Siege) o hay que mantener
  crouchToggle: true,
  adsMode: 'hold',      // apuntar (clic derecho o LT): 'hold' mantener o 'toggle' alternar (F10.4)
  invertY: false,
  padSens: 1,           // mando (F10.5): sensibilidad del stick derecho, invertir su eje vertical y vibración
  padInvertY: false,
  padRumble: true,
  quality: 'alta',      // 'baja' | 'media' | 'alta'
  shadows: 'altas',     // sombras del sol: 'altas' (4096) | 'bajas' (2048) | 'sin' (F10.4)
  showPerf: false,
  allyVoice: false,     // leer en voz alta los avisos de radio de los aliados
  announcer: true,      // el locutor anuncia las fases de la ronda (F12.2)
  opVoice: true,        // tu operador dice lo que hace: recargar, lanzar, colocar (F12.2)
  difficulty: 'normal',  // bots: 'novato' | 'normal' | 'veterano' | 'elite'
  startSide: 'random',   // partida rápida: 'random' | 'atk' | 'def'
  timeOfDay: 'dia',      // la hora: 'dia' | 'atardecer' | 'noche' (F12.5; solo cambia lo que se ve y se oye)
  kits: {},             // mira y accesorios elegidos: {operador (o 'campo'): {arma: {sight, barrel, grip, laser}}}
};

function storage() {
  try {
    const s = window.localStorage;
    const probe = '__bc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (e) {
    return null;
  }
}

// Lo guardado de miras y accesorios, solo con la forma esperada (lo demás se descarta; los valores
// que un arma no admite los corrige la partida al usarlos).
function cleanKits(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [who, weapons] of Object.entries(raw)) {
    if (!weapons || typeof weapons !== 'object') continue;
    for (const [id, k] of Object.entries(weapons)) {
      if (!k || typeof k !== 'object') continue;
      (out[who] = out[who] || {})[id] = { sight: String(k.sight || ''), barrel: String(k.barrel || ''), grip: String(k.grip || ''), laser: !!k.laser };
    }
  }
  return out;
}

export function loadSettings() {
  const out = { ...DEFAULT_SETTINGS, kits: {} };
  try {
    const s = storage();
    if (!s) return out;
    const raw = s.getItem(KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in parsed && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) out[k] = parsed[k];
    out.kits = cleanKits(parsed.kits);
    if (out.difficulty === 'recluta') out.difficulty = 'novato';   // nombre anterior
  } catch (e) { /* valores por defecto */ }
  return out;
}

export function saveSettings(settings) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    return false;
  }
}

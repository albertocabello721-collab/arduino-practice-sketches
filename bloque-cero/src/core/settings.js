// Ajustes del jugador. localStorage puede no existir (ventana privada, vista
// previa, datos bloqueados): todo acceso va dentro de try/catch y el juego
// funciona igual con los valores por defecto.
const KEY = 'bloque-cero:ajustes:v2';

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,     // multiplicador sobre 0,0022 rad/píxel
  adsSensitivity: 0.8,
  fov: 72,              // vertical
  volume: 0.8,
  leanToggle: true,     // Q/E alternan (como en Siege) o hay que mantener
  crouchToggle: true,
  invertY: false,
  quality: 'alta',      // 'baja' | 'media' | 'alta'
  showPerf: false,
  difficulty: 'normal',  // bots: 'recluta' | 'normal' | 'veterano'
  startSide: 'random',   // partida rápida: 'random' | 'atk' | 'def'
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

export function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const s = storage();
    if (!s) return out;
    const raw = s.getItem(KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in parsed && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) out[k] = parsed[k];
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

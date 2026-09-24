// Chat de equipo (abajo a la izquierda): avisos de radio de los aliados y órdenes del
// jugador. Cada línea se desvanece a los 8 s; como mucho 5 a la vez. Con el ajuste
// «Voz de los aliados», los avisos se leen con la síntesis de voz del navegador
// (español si hay; cada aliado con un tono distinto). Si el navegador no tiene síntesis
// de voz o falla, el chat sigue funcionando igual.
const LIFE = 8;
const MAX_LINES = 5;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TeamChat {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = document.getElementById('chat');
    this.lines = [];
    this.voice = new AllyVoice(ctx.settings);
  }
  /** Añade una línea. `cls`: 'ally' (aliado), 'me' (tú), 'sys' (aviso del juego). */
  push(name, text, { cls = 'ally', speak = false, voiceKey = '' } = {}) {
    if (!this.el) return;
    const d = document.createElement('div');
    d.className = 'cl ' + cls;
    d.innerHTML = name ? `<b>${esc(name)}</b> ${esc(text)}` : esc(text);
    this.el.appendChild(d);
    this.lines.push({ el: d, t: LIFE });
    while (this.lines.length > MAX_LINES) this.lines.shift().el.remove();
    if (speak) this.voice.say(text, voiceKey || name);
  }
  tick(dt) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const L = this.lines[i];
      L.t -= dt;
      if (L.t <= 0) { L.el.remove(); this.lines.splice(i, 1); continue; }
      if (L.t < 1) L.el.style.opacity = L.t.toFixed(2);
    }
  }
  clear() {
    for (const L of this.lines) L.el.remove();
    this.lines = [];
    this.voice.cancel();
  }
  dispose() { this.clear(); }
}

// Voz de los aliados con speechSynthesis (apagada por defecto).
export class AllyVoice {
  constructor(settings) {
    this.settings = settings;
    this.voices = null;
    this.spoken = 0;
  }
  get api() {
    try { return typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null; } catch (e) { return null; }
  }
  _pickVoice(ss) {
    if (this.voices === null || !this.voices.length) {
      try { this.voices = ss.getVoices() || []; } catch (e) { this.voices = []; }
    }
    return this.voices.find((v) => /^es[-_]ES/i.test(v.lang)) || this.voices.find((v) => /^es/i.test(v.lang)) || null;
  }
  say(text, key = '') {
    if (!this.settings.allyVoice) return false;
    const ss = this.api;
    if (!ss) return false;
    try {
      // si ya hay dos esperando, este se pierde (mejor callar que llegar tarde)
      if (ss.pending && this.spoken > 2) return false;
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      u.rate = 1.12;
      let h = 0;
      for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      u.pitch = 0.8 + (h % 5) * 0.1;          // cada aliado con su tono
      u.volume = Math.max(0, Math.min(1, this.settings.volume ?? 1));
      const v = this._pickVoice(ss);
      if (v) u.voice = v;
      this.spoken++;
      u.onend = u.onerror = () => { this.spoken = Math.max(0, this.spoken - 1); };
      ss.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }
  cancel() {
    const ss = this.api;
    this.spoken = 0;
    if (!ss) return;
    try { ss.cancel(); } catch (e) { /* sin voz */ }
  }
}

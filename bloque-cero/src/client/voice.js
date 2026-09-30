// Voces (F12.2) con la voz del navegador (speechSynthesis), en español: el locutor (grave, pausado,
// y pasa por delante de lo que se esté diciendo) y tu operador (frases cortas que se pierden si ya
// habla alguien: mejor callar que llegar tarde). Si el navegador no tiene voz, no suena nada.
export class Speech {
  constructor(settings) {
    this.settings = settings;
    this.voices = null;
  }
  get api() {
    try { return typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null; } catch (e) { return null; }
  }
  _voice(ss) {
    if (this.voices === null || !this.voices.length) {
      try { this.voices = ss.getVoices() || []; } catch (e) { this.voices = []; }
    }
    return this.voices.find((v) => /^es[-_]ES/i.test(v.lang)) || this.voices.find((v) => /^es/i.test(v.lang)) || null;
  }
  _say(text, rate, pitch, cut) {
    const ss = this.api;
    if (!ss) return false;
    try {
      if (cut) ss.cancel();
      else if (ss.speaking || ss.pending) return false;
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'es-ES'; u.rate = rate; u.pitch = pitch;
      u.volume = Math.max(0, Math.min(1, (this.settings.volume ?? 1) * (this.settings.voiceVolume ?? 1)));   // general × voz (F12.3)
      const v = this._voice(ss);
      if (v) u.voice = v;
      ss.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }
  /** El locutor: corta lo que se esté diciendo. */
  announce(text) { return this.settings.announcer ? this._say(text, 1.0, 0.72, true) : false; }
  /** Tu operador (con un tono propio según `key`): solo si no habla nadie. */
  mine(text, key = '') {
    if (!this.settings.opVoice) return false;
    let h = 0;
    for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return this._say(text, 1.18, 0.85 + (h % 5) * 0.08, false);
  }
  cancel() { const ss = this.api; if (ss) try { ss.cancel(); } catch (e) { /* sin voz */ } }
}

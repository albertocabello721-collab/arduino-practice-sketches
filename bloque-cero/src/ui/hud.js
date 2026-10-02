// HUD táctico (DOM). Solo escribe en el DOM cuando cambia un valor.
import { FIRE_MODE_NAME } from '../sim/weapons.js';
import { emblemURL } from './emblems.js';
import { padText } from '../input/gamepad.js';
const STANCE_NAME = { stand: 'De pie', crouch: 'Agachado', prone: 'Cuerpo a tierra' };
const RANGE_HINTS = '<b>Campo de pruebas:</b> maniquís dentro de la villa (uno dispara). <kbd>F</kbd> refuerza la pared que miras, pone barricadas y reanima (<kbd>J</kbd> derriba a tu compañero). <kbd>V</kbd> golpe, <kbd>5</kbd> dron, <kbd>G</kbd> boquete, <kbd>K</kbd> reinicia, <kbd>1</kbd>–<kbd>4</kbd> armas, <kbd>L</kbd> arsenal. En la calle, a tu espalda, los 16 operadores en fila: apunta a uno para ver quién es. <kbd>N</kbd> oculta o muestra esta ayuda.';
const MATCH_HINTS = '<b>Partida:</b> el ataque planta el desactivador en A o B (mantén <kbd>F</kbd> dentro del sitio, 7 s); la defensa lo inutiliza (<kbd>F</kbd> junto a él). <kbd>F</kbd> también reanima. <kbd>T</kbd> marca al enemigo que miras o pone una marca de posición. <kbd>G</kbd> gadget secundario, <kbd>X</kbd> habilidad. Mantén <kbd>H</kbd> para dar órdenes a tus aliados. <kbd>Tab</kbd> marcador. <kbd>N</kbd> oculta o muestra esta ayuda.';

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'), loc: $('hud-loc'), ammo: $('hud-ammo'), wname: $('hud-wname'), state: $('hud-state'),
      hp: $('hud-hp'), stance: $('hud-stance'), lean: $('lean').children, prompt: $('prompt'), toast: $('toast'),
      perf: $('perf'), cross: $('crosshair'), hit: $('hitmark'), pause: $('pausehint'), title: $('hud-title'), mode: $('hud-mode'),
      feed: $('killfeed'), dirs: $('dmgdirs').children, hpbar: $('hpbar'), downed: $('downed'), downedS: $('downed-s'), downedBar: $('downed-bar'),
      revive: $('revive'), reviveT: $('revive-t'), reviveBar: $('revive-bar'), death: $('death'), deathS: $('death-s'),
    };
    this.dirT = [0, 0, 0, 0];
    this.dirI = 0;
    this.cache = {};
    this.toastT = 0;
    this.hitT = 0;
    this.padMode = false;     // jugando con el mando: los avisos nombran sus botones (F10.5)
    this.padKind = 'xbox';    // ('xbox' o 'ps': cómo se llaman)
  }
  _t(s) { return this.padMode ? padText(s, this.padKind) : s; }
  // Modo de la barra superior y de la ayuda: 'range' (campo de pruebas) o 'match'.
  setMode(mode) {
    this.mode = mode;
    document.getElementById('topbar').classList.toggle('hidden', mode !== 'range');
    document.getElementById('mtop').classList.toggle('hidden', mode !== 'match');
    this._hintsHtml();
    this.el.feed.innerHTML = '';
  }
  _hintsHtml() {
    const h = document.getElementById('hints'), key = `${this.mode}${this.padMode ? '/' + this.padKind : ''}`;
    if (h.dataset.mode !== key) { h.dataset.mode = key; h.innerHTML = this._t(this.mode === 'range' ? RANGE_HINTS : MATCH_HINTS); }
  }
  hints(v) {
    if (v) this._hintsHtml();
    if (this.cache.hints !== v) { this.cache.hints = v; document.getElementById('hints').style.opacity = v ? 1 : 0; }
  }
  setTopbar(title, sub) { this.set('tbT', this.el.title, title); this.set('tbM', this.el.mode, sub); }
  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'html') el.innerHTML = value; else el[prop] = value;
  }
  show(v) { this.el.root.classList.toggle('hidden', !v); }
  toast(text, secs = 1.6) { this.el.toast.textContent = text; this.el.toast.style.opacity = 1; this.toastT = secs; }
  hitmarker(kind = 'hit') {
    this.hitT = kind === 'kill' ? 0.35 : 0.16;
    this.el.hit.style.opacity = 1;
    for (const i of this.el.hit.children) i.style.background = kind === 'kill' ? '#e5483a' : kind === 'head' ? '#f2c14e' : '#fff';
    this.el.hit.style.transform = `rotate(45deg) scale(${kind === 'kill' ? 1.35 : 1})`;
  }
  // Indicador de daño: ángulo relativo a la vista (0 = delante)
  damageFrom(angle) {
    const i = this.dirI = (this.dirI + 1) % 4;
    const el = this.el.dirs[i];
    el.style.transform = `rotate(${angle}rad)`;
    el.style.opacity = 1;
    this.dirT[i] = 1.1;
  }
  feed(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'k ' + cls;
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 450); }, 6000);
  }
  setDowned(v, secsLeft = 0, frac = 0) {
    this.el.downed.classList.toggle('hidden', !v);
    if (v) {
      this.set('downS', this.el.downedS, this._t(`Te desangras: ${Math.ceil(secsLeft)} s. Mantén F para presionar la herida.`));
      this.el.downedBar.style.width = `${Math.max(0, frac * 100)}%`;
    }
  }
  setRevive(text, frac) {
    const on = text !== null;
    this.el.revive.classList.toggle('hidden', !on);
    if (on) { this.set('revT', this.el.reviveT, this._t(text)); this.el.reviveBar.style.width = `${Math.min(100, frac * 100)}%`; }
  }
  setDeath(v, text) {
    this.el.death.classList.toggle('hidden', !v);
    if (v && text) this.set('deathS', this.el.deathS, this._t(text));
  }
  /**
   * Repetición de muerte (F7.6): la tarjeta del que te mató ({name, op, opId, weapon, hp, maxHp,
   * down, dist, headshot, ally}) o null para quitarla.
   */
  replay(c) {
    const el = document.getElementById('replay');
    el.classList.toggle('hidden', !c);
    this.cache.rpBar = -1;
    if (!c) return;
    const $ = (id) => document.getElementById(id);
    el.style.setProperty('--tc', c.ally ? 'var(--blue)' : 'var(--orange)');
    $('rp-emb').src = c.opId ? emblemURL(c.opId, '#ffffff', 96) : '';
    $('rp-emb').style.visibility = c.opId ? '' : 'hidden';
    $('rp-name').textContent = c.name;
    $('rp-sub').textContent = [c.op && c.op.toUpperCase() !== String(c.name).toUpperCase() ? c.op : null, c.weapon, c.headshot ? 'a la cabeza' : null].filter(Boolean).join(' · ');
    $('rp-hp').textContent = c.down ? '0' : String(c.hp);
    $('rp-hpl').textContent = c.down ? 'Derribado' : 'Vida';
    $('rp-dist').textContent = `${c.dist.toFixed(1)} m`;
  }
  replayProgress(f) {
    const w = Math.round(Math.max(0, Math.min(1, f)) * 100);
    if (this.cache.rpBar === w) return;
    this.cache.rpBar = w;
    document.getElementById('rp-bar').style.width = `${w}%`;
  }

  update(dt, op, ctx) {
    const w = op.weapon;
    const d = w.def;
    this.set('loc', this.el.loc, ctx.location);
    const low = w.ammo <= Math.ceil(d.mag * 0.25);
    this.set('ammo', this.el.ammo, `${w.ammo}<small>${w.reserve}</small>`, 'html');
    this.el.ammo.classList.toggle('low', low);
    this.set('wname', this.el.wname, `${d.name} · ${(d.modes || []).length > 1 ? FIRE_MODE_NAME[w.mode] : d.kind}`);
    let st = '';
    if (w.reloadT > 0) st = 'Recargando';
    else if (w.equipT > 0) st = 'Desenfundando';
    else if (w.ammo === 0 && w.reserve === 0) st = 'Sin munición';
    else if (w.ammo === 0) st = 'Recarga (R)';
    this.set('state', this.el.state, st);
    this.set('stance', this.el.stance, STANCE_NAME[op.stance] || op.stance);
    const l = op.leanAllowed;
    const leanState = l < -0.3 ? 0 : l > 0.3 ? 2 : 1;
    if (this.cache.lean !== leanState) {
      this.cache.lean = leanState;
      for (let i = 0; i < 3; i++) this.el.lean[i].classList.toggle('on', i === leanState);
    }
    this.set('hp', this.el.hp, `${Math.max(0, Math.round(op.hp))}<small>Salud · blindaje ${'▮'.repeat(op.armor)}${'▯'.repeat(3 - op.armor)}${op.plate ? ' · placa' : ''}</small>`, 'html');
    const hpf = Math.max(0, op.hp) / op.maxHp;
    if (this.cache.hpf !== hpf) {
      this.cache.hpf = hpf;
      this.el.hpbar.firstChild.style.width = `${Math.min(1, hpf) * 100}%`;
      this.el.hpbar.classList.toggle('low', hpf < 0.35 || op.state === 'downed');
      this.el.hpbar.classList.toggle('over', hpf > 1.001);          // vida de más (placa, estimulante)
    }
    for (let i = 0; i < 4; i++) if (this.dirT[i] > 0) { this.dirT[i] -= dt; this.el.dirs[i].style.opacity = Math.max(0, Math.min(1, this.dirT[i] * 1.5)); }
    // cruceta: se abre con la dispersión y desaparece al apuntar
    const gap = Math.round(3 + ctx.spreadPx);
    const vis = op.ads > 0.6 || op.sprinting ? 0 : 1;
    if (this.cache.gap !== gap || this.cache.cvis !== vis) {
      this.cache.gap = gap; this.cache.cvis = vis;
      const c = this.el.cross.children;
      c[1].style.left = `${-gap - 9}px`; c[2].style.left = `${gap}px`;
      c[3].style.top = `${-gap - 9}px`; c[4].style.top = `${gap}px`;
      this.el.cross.style.opacity = vis;
    }
    this.set('prompt', this.el.prompt, ctx.prompt || '');
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.style.opacity = 0; }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hit.style.opacity = 0; }
  }
  // Muestra u oculta la parte del HUD que depende de un operador visto.
  playerHud(v) {
    if (this.cache.phud === v) return;
    this.cache.phud = v;
    for (const id of ['vitals', 'weapon', 'crosshair', 'where', 'prompt']) document.getElementById(id).style.visibility = v ? '' : 'hidden';
    if (!v) { this.setDowned(false); this.setRevive(null, 0); }
  }
  // Temporizadores del HUD cuando no hay operador visto.
  tick(dt) {
    for (let i = 0; i < 4; i++) if (this.dirT[i] > 0) { this.dirT[i] -= dt; this.el.dirs[i].style.opacity = Math.max(0, Math.min(1, this.dirT[i] * 1.5)); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.style.opacity = 0; }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hit.style.opacity = 0; }
  }
  perf(text) {
    if (text === null) { this.el.perf.classList.add('hidden'); return; }
    this.el.perf.classList.remove('hidden');
    this.set('perf', this.el.perf, text);
  }
  // (`text`: otro aviso que el de siempre; con el mando, cómo seguir y cómo salir)
  pause(v, text = null) {
    this.el.pause.classList.toggle('hidden', !v);
    if (this._pauseDef === undefined) this._pauseDef = this.el.pause.textContent;
    const t = text || this._pauseDef;
    if (this.el.pause.textContent !== t) this.el.pause.textContent = t;
  }
}

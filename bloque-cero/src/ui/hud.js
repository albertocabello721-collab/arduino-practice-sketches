// HUD táctico (DOM). Solo escribe en el DOM cuando cambia un valor.
const STANCE_NAME = { stand: 'De pie', crouch: 'Agachado', prone: 'Cuerpo a tierra' };

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
  }
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
      this.set('downS', this.el.downedS, `Te desangras: ${Math.ceil(secsLeft)} s. Mantén F para presionar la herida.`);
      this.el.downedBar.style.width = `${Math.max(0, frac * 100)}%`;
    }
  }
  setRevive(text, frac) {
    const on = text !== null;
    this.el.revive.classList.toggle('hidden', !on);
    if (on) { this.set('revT', this.el.reviveT, text); this.el.reviveBar.style.width = `${Math.min(100, frac * 100)}%`; }
  }
  setDeath(v, text) {
    this.el.death.classList.toggle('hidden', !v);
    if (v && text) this.set('deathS', this.el.deathS, text);
  }

  update(dt, op, ctx) {
    const w = op.weapon;
    const d = w.def;
    this.set('loc', this.el.loc, ctx.location);
    const low = w.ammo <= Math.ceil(d.mag * 0.25);
    this.set('ammo', this.el.ammo, `${w.ammo}<small>${w.reserve}</small>`, 'html');
    this.el.ammo.classList.toggle('low', low);
    this.set('wname', this.el.wname, `${d.name} · ${d.kind}`);
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
    this.set('hp', this.el.hp, `${Math.max(0, Math.round(op.hp))}<small>Salud · blindaje ${'▮'.repeat(op.armor)}${'▯'.repeat(3 - op.armor)}</small>`, 'html');
    const hpf = Math.max(0, op.hp) / op.maxHp;
    if (this.cache.hpf !== hpf) { this.cache.hpf = hpf; this.el.hpbar.firstChild.style.width = `${hpf * 100}%`; this.el.hpbar.classList.toggle('low', hpf < 0.35 || op.state === 'downed'); }
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
  perf(text) {
    if (text === null) { this.el.perf.classList.add('hidden'); return; }
    this.el.perf.classList.remove('hidden');
    this.set('perf', this.el.perf, text);
  }
  pause(v) { this.el.pause.classList.toggle('hidden', !v); }
}

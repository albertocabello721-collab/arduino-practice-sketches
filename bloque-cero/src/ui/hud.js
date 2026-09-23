// HUD táctico (DOM). Solo escribe en el DOM cuando cambia un valor.
const STANCE_NAME = { stand: 'De pie', crouch: 'Agachado', prone: 'Cuerpo a tierra' };

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'), loc: $('hud-loc'), ammo: $('hud-ammo'), wname: $('hud-wname'), state: $('hud-state'),
      hp: $('hud-hp'), stance: $('hud-stance'), lean: $('lean').children, prompt: $('prompt'), toast: $('toast'),
      perf: $('perf'), cross: $('crosshair'), hit: $('hitmark'), pause: $('pausehint'), title: $('hud-title'), mode: $('hud-mode'),
    };
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
  hitmarker(kill = false) { this.hitT = 0.18; this.el.hit.style.opacity = 1; this.el.hit.style.filter = kill ? 'drop-shadow(0 0 2px #e5483a)' : ''; }

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
    this.set('hp', this.el.hp, `${Math.max(0, Math.round(op.hp))}<small>Salud</small>`, 'html');
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

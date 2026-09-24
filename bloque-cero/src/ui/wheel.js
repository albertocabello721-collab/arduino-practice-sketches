// Rueda de órdenes (mantener H). Mientras está abierta, el ratón no mueve la vista: mueve
// un cursor desde el centro y el sector hacia el que apunta queda resaltado. Al soltar H
// (o con clic izquierdo) se da esa orden; en el centro o con clic derecho, nada.
const $ = (id) => document.getElementById(id);

export const ORDERS = {
  follow: { label: 'Seguirme', icon: '➜', say: '¡Seguidme!' },
  hold: { label: 'Mantener aquí', icon: '■', say: '¡Mantened la posición!' },
  goto: { label: 'Ir a mi marca', icon: '◆', say: '¡Id a mi marca!' },
  reinforce: { label: 'Reforzar aquí', icon: '▦', say: '¡Reforzad aquí!' },
  free: { label: 'Por libre', icon: '✦', say: '¡Por libre!' },
};
const R_SEL = 26;       // px de ratón desde el centro para elegir algo
const R_MAX = 120;

export class OrderWheel {
  constructor() {
    this.el = $('wheel');
    this.open = false;
    this.items = [];
    this.els = [];
    this.cx = 0; this.cy = 0;
    this.sel = -1;
    this.needle = null;
  }

  /** Abre la rueda con `items` ([{kind, disabled}]); el primero arriba y en el sentido de las agujas del reloj. */
  show(items) {
    this.items = items.map((it) => ({ ...ORDERS[it.kind], ...it }));
    this.open = true;
    this.cx = 0; this.cy = 0; this.sel = -1;
    if (!this.el) return;
    this.el.innerHTML = '<div class="wc">Órdenes</div><div class="wn"></div>';
    this.needle = this.el.querySelector('.wn');
    const n = this.items.length;
    this.els = this.items.map((it, i) => {
      const a = (i / n) * Math.PI * 2;
      const d = document.createElement('div');
      d.className = 'wo' + (it.disabled ? ' off' : '');
      d.style.left = `${(50 + Math.sin(a) * 36).toFixed(1)}%`;
      d.style.top = `${(50 - Math.cos(a) * 36).toFixed(1)}%`;
      d.innerHTML = `<i>${it.icon}</i><span>${it.label}</span>`;
      this.el.appendChild(d);
      return d;
    });
    this._needle();
    this.el.classList.remove('hidden');
  }

  /** Mueve el cursor de la rueda (píxeles de ratón). */
  move(dx, dy) {
    if (!this.open || (!dx && !dy)) return;
    this.cx += dx; this.cy += dy;
    const r = Math.hypot(this.cx, this.cy);
    if (r > R_MAX) { this.cx *= R_MAX / r; this.cy *= R_MAX / r; }
    let sel = -1;
    if (r >= R_SEL && this.items.length) {
      const n = this.items.length;
      let a = Math.atan2(this.cx, -this.cy);
      if (a < 0) a += Math.PI * 2;
      sel = Math.round(a / (Math.PI * 2 / n)) % n;
      if (this.items[sel].disabled) sel = -1;
    }
    this._select(sel);
    this._needle();
  }
  /** Lleva el cursor a la opción `kind` (como si se moviera el ratón hacia ella). */
  pick(kind) {
    const i = this.items.findIndex((it) => it.kind === kind && !it.disabled);
    if (i < 0) return;
    const a = (i / this.items.length) * Math.PI * 2;
    this.cx = 0; this.cy = 0;
    this.move(Math.sin(a) * 70, -Math.cos(a) * 70);
  }

  /** Cierra la rueda y devuelve la opción elegida (o null). */
  close() {
    const it = this.open && this.sel >= 0 ? this.items[this.sel] : null;
    this.open = false;
    if (this.el) { this.el.classList.add('hidden'); this.el.innerHTML = ''; }
    this.els = [];
    return it;
  }

  _select(sel) {
    if (sel === this.sel) return;
    this.sel = sel;
    this.els.forEach((e, i) => e.classList.toggle('on', i === sel));
  }
  _needle() {
    if (!this.needle) return;
    this.needle.style.left = `${(50 + (this.cx / R_MAX) * 22).toFixed(1)}%`;
    this.needle.style.top = `${(50 + (this.cy / R_MAX) * 22).toFixed(1)}%`;
  }
}

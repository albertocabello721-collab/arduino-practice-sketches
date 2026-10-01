// Los menús con el mando (F10.5): la cruceta o el stick izquierdo llevan el foco al botón o ajuste
// más cercano en esa dirección; A pulsa el botón, marca la casilla o pasa a la siguiente opción de un
// desplegable; en un deslizador, izquierda y derecha cambian el valor; B vuelve. Lo que hace es lo
// mismo que el ratón (un clic, un cambio del ajuste), así que los menús no saben que hay un mando.

const FOCUSABLE = 'button, select, input[type=range], input[type=checkbox]';

/**
 * De los rectángulos `cands` ({x, y, w, h}), el siguiente a `from` en la dirección `dir` ('up',
 * 'down', 'left', 'right'): el más cerca en esa dirección y, sobre todo, alineado con él (el que se
 * solapa con él gana a uno más cerca pero desplazado). Devuelve el índice o −1.
 */
export function pickDir(from, cands, dir) {
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2, vert = dir === 'up' || dir === 'down';
  let best = -1, bs = Infinity;
  for (let i = 0; i < cands.length; i++) {
    const r = cands[i];
    if (r === from) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let gap, off, tie;
    if (vert) {
      if (dir === 'down' ? cy <= fy + 1 : cy >= fy - 1) continue;
      gap = dir === 'down' ? r.y - (from.y + from.h) : from.y - (r.y + r.h);
      off = Math.max(0, Math.max(r.x, from.x) - Math.min(r.x + r.w, from.x + from.w));
      tie = Math.abs(r.x - from.x);          // (entre los alineados, el que empieza más a la par)
    } else {
      if (dir === 'right' ? cx <= fx + 1 : cx >= fx - 1) continue;
      gap = dir === 'right' ? r.x - (from.x + from.w) : from.x - (r.x + r.w);
      off = Math.max(0, Math.max(r.y, from.y) - Math.min(r.y + r.h, from.y + from.h));
      tie = Math.abs(cy - fy);
    }
    const sc = Math.max(0, gap) + 2.5 * off + 0.05 * tie + 0.001 * Math.hypot(cx - fx, cy - fy);
    if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}

const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
// lo que se resalta (y se mide): la fila entera de un ajuste, o el botón
const boxOf = (el) => (el.tagName === 'BUTTON' ? el : el.closest('label') || el);
const visible = (el) => !el.disabled && el.getClientRects().length > 0;

export class PadNav {
  constructor() {
    this.root = null;
    this.el = null;        // lo que tiene el foco
    this.key = '';         // cómo volver a encontrarlo si el menú se vuelve a pintar
    this.box = null;       // lo resaltado
    this.last = null;      // el último paso ({dir, from}): el contrario vuelve a donde se estaba
    this.shown = false;
  }

  /**
   * Cada fotograma con un menú abierto. `nav`: lo que pidió el mando ('up', 'down', 'left', 'right',
   * 'accept', 'back'); `root`: el menú; `opts`: {first: selector del foco al empezar, back()};
   * `show`: si se está jugando con el mando (si no, no se resalta nada ni se hace nada).
   */
  frame(nav, root, opts = {}, show = true) {
    if (root !== this.root) { this.root = root; this._focus(null); this.last = null; }
    if (!show) { this.shown = false; this._ring(null); return; }
    let wake = !this.shown;          // (al volver al mando, el primer toque solo enseña dónde está el foco)
    this.shown = true;
    if (!root) { this._ring(null); return; }
    // (el menú se ha vuelto a pintar: lo mismo, por su nombre)
    if (this.el && (!this.el.isConnected || !root.contains(this.el) || !visible(this.el))) {
      const again = this.key ? root.querySelector(this.key) : null;
      this._focus(again && visible(again) ? again : null, false);
    }
    if (!this.el) this._focus(this._first(opts.first));
    for (const a of nav) {
      if (wake || !this.el) { wake = false; continue; }
      if (a === 'accept') this._activate(this.el);
      else if (a === 'back') { if (opts.back) opts.back(); }
      else if (this.el.type === 'range' && (a === 'left' || a === 'right')) this._step(this.el, a === 'right' ? 1 : -1);
      else this._move(a);
    }
    this._ring(this.el ? boxOf(this.el) : null);
  }
  clear() { this.root = null; this._focus(null); this._ring(null); }

  _first(sel) {
    const R = this.root;
    const pick = sel ? [].concat(sel).map((s) => R.querySelector(s)).find((e) => e && visible(e)) : null;
    return pick || [...R.querySelectorAll(FOCUSABLE)].find(visible) || null;
  }
  _focus(el, scroll = true) {
    this.el = el;
    this.key = !el ? '' : el.id ? `#${CSS.escape(el.id)}` : el.dataset && el.dataset.act
      ? ['act', 'v', 'w', 'p'].filter((k) => el.dataset[k] !== undefined).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('')
      : '';
    if (el && scroll) { try { boxOf(el).scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* sin desplazamiento */ } }
  }
  _ring(box) {
    if (box === this.box) return;
    if (this.box) this.box.classList.remove('padfocus');
    this.box = box;
    if (box) box.classList.add('padfocus');
  }
  _move(dir) {
    const els = [...this.root.querySelectorAll(FOCUSABLE)].filter(visible);
    const L = this.last;
    if (L && L.dir === OPP[dir] && L.from.isConnected && els.includes(L.from)) { const f = L.from; this.last = { dir, from: this.el }; this._focus(f); return; }
    const from = rectOf(boxOf(this.el));
    const rects = els.map((e) => (e === this.el ? from : rectOf(boxOf(e))));
    const i = pickDir(from, rects, dir);
    if (i < 0) return;
    this.last = { dir, from: this.el };
    this._focus(els[i]);
  }
  _activate(el) {
    if (el.tagName === 'SELECT') {
      if (!el.options.length) return;
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.type !== 'range') el.click();
  }
  _step(el, k) {
    if (k > 0) el.stepUp(); else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

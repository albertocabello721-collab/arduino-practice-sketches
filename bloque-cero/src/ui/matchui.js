// Interfaz de la partida (DOM): barra superior con el reloj y los 10 retratos,
// selección de operador, marcadores de objetivo, avisos de fase, fin de ronda,
// marcador (Tab) y pantalla final. Solo toca el DOM cuando cambia algo.
import { OP_BY_ID, opsForSide, GADGETS, ARMOR_SPEED } from '../sim/operators.js';
import { WEAPONS } from '../sim/weapons.js';
import { emblemURL } from './emblems.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtTime = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const pips = (n, max = 3) => '▮'.repeat(n) + '▯'.repeat(max - n);
const SIDE_NAME = { atk: 'Ataque', def: 'Defensa' };
const PHASE_NAME = { select: 'Selección', prep: 'Preparación', action: 'Acción', planted: 'Desactivador', roundEnd: 'Fin de ronda', matchEnd: 'Fin' };

export class MatchUI {
  constructor(ctx, session) {
    this.ctx = ctx;
    this.s = session;
    this.cache = {};
    this.ptEls = [[], []];
    this.markerEls = [];
    this.phaseT = 0;
    this.el = {
      ally: $('mt-ally'), enemy: $('mt-enemy'), sa: $('mt-sa'), se: $('mt-se'), clock: $('mt-clock'), phase: $('mt-phase'), time: $('mt-time'), sub: $('mt-sub'),
      markers: $('markers'), pb: $('phasebar'), pbT: $('pb-t'), pbS: $('pb-s'), prep: $('prepinfo'), carry: $('carry'), spec: $('spectate'),
      banner: $('banner'), bnT: $('bn-t'), bnS: $('bn-s'), bnSc: $('bn-sc'), board: $('scoreboard'),
      select: $('select'), selRound: $('sel-round'), selSide: $('sel-side'), selScore: $('sel-score'), selTimer: $('sel-timer'), selHint: $('sel-hint'),
      selGrid: $('sel-grid'), selDetail: $('sel-detail'), selChoiceH: $('sel-choice-h'), selChoice: $('sel-choice'), selTeam: $('sel-team'), selReady: $('sel-ready'),
      end: $('matchend'), endRes: $('me-res'), endScore: $('me-score'), endMvp: $('me-mvp'), endTable: $('me-table'), endAgain: $('me-again'), endMenu: $('me-menu'),
    };
    // delegación de clics en la selección
    this._onSelectClick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act, v = b.dataset.v;
      this.ctx.audio.ui('click');
      if (a === 'op') this.s.pickOperator(v);
      else if (a === 'pri') this.s.pickWeapon('primary', +v);
      else if (a === 'sec') this.s.pickWeapon('secondary', +v);
      else if (a === 'ch') this.s.pickChoice(+v);
      else if (a === 'ready') this.s.ready();
    };
    this.el.select.addEventListener('click', this._onSelectClick);
    this._onKey = (e) => {
      if (this.el.select.classList.contains('hidden')) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.s.ready(); }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 8) { const ops = opsForSide(this.s.mySide()); if (ops[n - 1]) this.s.pickOperator(ops[n - 1].id); }
    };
    window.addEventListener('keydown', this._onKey);
    this.el.endAgain.onclick = () => { this.ctx.audio.ui('confirm'); this.s.rematch(); };
    this.el.endMenu.onclick = () => { this.ctx.audio.ui('click'); this.s.toMenu(); };
  }

  dispose() {
    this.el.select.removeEventListener('click', this._onSelectClick);
    window.removeEventListener('keydown', this._onKey);
    this.hideSelect(); this.hideBanner(); this.hideMatchEnd();
    this.el.board.classList.add('hidden');
    this.el.markers.innerHTML = '';
    this.markerEls = [];
    this.setPrepInfo(null); this.setCarry(false); this.setSpectate(null);
    this.el.pb.style.opacity = 0;
  }

  // ------------------------------------------------------------------ barra superior
  buildTop(match) {
    const my = this.s.myTeam;
    for (const [team, host] of [[my, this.el.ally], [1 - my, this.el.enemy]]) {
      host.innerHTML = '';
      const els = [];
      for (const slot of match.slotsOf(team)) {
        const d = document.createElement('div');
        d.className = `pt ${team === my ? 'ally' : 'enemy'}${slot.human ? ' me' : ''}`;
        d.innerHTML = `<img alt=""><i class="dz"></i>`;
        host.appendChild(d);
        els.push({ el: d, img: d.firstChild, slot, key: '' });
      }
      this.ptEls[team === my ? 0 : 1] = els;
    }
  }

  updateTop(match, dt) {
    const my = this.s.myTeam;
    const showCarrier = match.sideOf(my) === 'atk';
    for (let k = 0; k < 2; k++) {
      for (const p of this.ptEls[k]) {
        const s = p.slot, op = s.op;
        const st = op ? op.state : 'none';
        const carrier = showCarrier && k === 0 && match.defuser && match.defuser.carrier === op && !!op;
        const key = `${s.opId}|${st}|${carrier}`;
        if (key === p.key) continue;
        p.key = key;
        if (s.opId) p.img.src = emblemURL(s.opId, '#ffffff', 64);
        p.el.classList.toggle('dead', st === 'dead');
        p.el.classList.toggle('downed', st === 'downed');
        p.el.classList.toggle('none', st === 'none');
        p.el.classList.toggle('carrier', carrier);
        p.el.title = s.opId ? OP_BY_ID[s.opId].name : '';
      }
    }
    this._set('sa', this.el.sa, String(match.teams[my].score));
    this._set('se', this.el.se, String(match.teams[1 - my].score));
    const ph = match.phase;
    const planted = ph === 'planted' || (ph === 'roundEnd' && match.defuser && match.defuser.planted);
    this._set('ph', this.el.phase, planted && ph === 'planted' ? 'Desactivador' : PHASE_NAME[ph] || '');
    const t = ph === 'roundEnd' || ph === 'matchEnd' ? 0 : match.timeLeft;
    this._set('tm', this.el.time, fmtTime(t));
    this.el.clock.classList.toggle('planted', ph === 'planted');
    this.el.clock.classList.toggle('urgent', ph === 'action' && t <= 30);
    this._set('sub', this.el.sub, `Ronda ${match.round} · ${SIDE_NAME[match.sideOf(my)]}${match.site ? ' · ' + match.site.name : ''}`);
  }
  _set(k, el, v, html = false) { if (this.cache[k] === v) return; this.cache[k] = v; if (html) el.innerHTML = v; else el.textContent = v; }

  // ------------------------------------------------------------------ avisos
  showPhase(title, sub = '', secs = 2.6) {
    this.el.pbT.textContent = title;
    this.el.pbS.textContent = sub;
    this.el.pb.style.opacity = 1;
    this.phaseT = secs;
  }
  clearPhase() { this.phaseT = 0; this.el.pb.style.opacity = 0; }
  tick(dt) {
    if (this.phaseT > 0) { this.phaseT -= dt; if (this.phaseT <= 0) this.el.pb.style.opacity = 0; }
  }
  setPrepInfo(html) {
    this.el.prep.classList.toggle('hidden', !html);
    if (html) this._set('prep', this.el.prep, html, true);
  }
  setCarry(v) { if (this.cache.carry !== v) { this.cache.carry = v; this.el.carry.classList.toggle('hidden', !v); } }
  setSpectate(text) {
    this.el.spec.classList.toggle('hidden', !text);
    if (text) this._set('spec', this.el.spec, text, true);
  }

  showBanner(res, match) {
    const my = this.s.myTeam;
    const win = res.winner === my;
    this.el.banner.className = win ? 'win' : 'lose';
    this.el.bnT.textContent = win ? 'Ronda ganada' : 'Ronda perdida';
    this.el.bnS.textContent = res.reason;
    this.el.bnSc.innerHTML = `<span class="a">${match.teams[my].score}</span> — <span class="e">${match.teams[1 - my].score}</span>`;
  }
  hideBanner() { this.el.banner.className = 'hidden'; }

  // ------------------------------------------------------------------ marcadores
  updateMarkers(list) {
    const cam = this.ctx.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const V = this._v || (this._v = new this.ctx.THREE.Vector3());
    while (this.markerEls.length < list.length) {
      const d = document.createElement('div');
      d.className = 'mk';
      d.innerHTML = '<div class="ic"></div><div class="lb"></div>';
      this.el.markers.appendChild(d);
      this.markerEls.push({ el: d, ic: d.firstChild, lb: d.lastChild, key: '' });
    }
    for (let i = 0; i < this.markerEls.length; i++) {
      const m = this.markerEls[i];
      const it = list[i];
      if (!it) { if (m.key !== 'off') { m.el.style.display = 'none'; m.key = 'off'; } continue; }
      V.set(it.x, it.y, it.z).project(cam);
      const behind = V.z > 1;
      if (behind || Math.abs(V.x) > 1.05 || Math.abs(V.y) > 1.05) { if (m.key !== 'off') { m.el.style.display = 'none'; m.key = 'off'; } continue; }
      const key = `${it.cls}|${it.icon}|${it.label}`;
      if (m.key !== key) {
        m.key = key;
        m.el.style.display = '';
        m.el.className = 'mk ' + (it.cls || '');
        m.ic.textContent = it.icon || '';
        m.lb.textContent = it.label || '';
      }
      m.el.style.left = `${((V.x + 1) / 2 * W).toFixed(1)}px`;
      m.el.style.top = `${((1 - V.y) / 2 * H).toFixed(1)}px`;
    }
  }

  // ------------------------------------------------------------------ marcador (Tab)
  showScoreboard(match, v) {
    this.el.board.classList.toggle('hidden', !v);
    if (!v) return;
    const now = performance.now();
    if (this._boardT && now - this._boardT < 250) return;
    this._boardT = now;
    this.el.board.innerHTML = this._table(match, true);
  }

  _table(match, withHistory) {
    const my = this.s.myTeam;
    const rows = (team) => match.slotsOf(team).slice().sort((a, b) => b.stats.score - a.stats.score).map((s) => {
      const def = s.opId ? OP_BY_ID[s.opId] : null;
      const dead = s.op && s.op.state === 'dead';
      return `<tr class="${team === my ? 'ally' : 'enemy'}${s.human ? ' me' : ''}${dead ? ' dead' : ''}">
        <td><div class="who">${def ? `<img src="${emblemURL(def.id, team === my ? '#9fd0f7' : '#f7c79c', 40)}" alt="">` : ''}<span>${def ? def.name : '—'}${s.human ? ' · tú' : ''}</span></div></td>
        <td>${s.stats.score}</td><td>${s.stats.kills}</td><td>${s.stats.assists}</td><td>${s.stats.deaths}</td><td>${s.stats.plants + s.stats.disables}</td></tr>`;
    }).join('');
    let hist = '';
    if (withHistory) {
      hist = `<div class="hist">Rondas ${match.history.map((h) => `<i class="${h.winner === my ? 'w' : 'l'}" title="${esc(h.reason)}">${h.round}</i>`).join('')}</div>`;
    }
    return `<h3><span>Marcador · ronda ${match.round}</span><span><b style="color:var(--blue)">${match.teams[my].score}</b> — <b style="color:var(--orange)">${match.teams[1 - my].score}</b></span></h3>
      <table><tr><th>Operador</th><th>Puntos</th><th>Bajas</th><th>Asist.</th><th>Muertes</th><th>Objetivo</th></tr>
      ${rows(my)}<tr class="sep"><td colspan="6"></td></tr>${rows(1 - my)}</table>${hist}`;
  }

  // ------------------------------------------------------------------ selección
  showSelect(match) {
    this.el.select.classList.remove('hidden');
    this.updateSelect(match, true);
  }
  hideSelect() { this.el.select.classList.add('hidden'); }

  updateSelect(match, full = false) {
    const me = this.s.meSlot;
    if (!me) return;
    const my = me.team;
    const side = match.sideOf(my);
    this._set('selT', this.el.selTimer, fmtTime(match.timeLeft));
    if (!full) return;
    this.el.selRound.textContent = `Ronda ${match.round}`;
    this.el.selSide.textContent = SIDE_NAME[side];
    this.el.selSide.className = `sd ${side}`;
    this.el.selScore.innerHTML = `<span class="a">${match.teams[my].score}</span> — <span class="e">${match.teams[1 - my].score}</span>`;
    this.el.selHint.textContent = side === 'def' ? 'Elige operador, arsenal y dónde defender' : 'Elige operador, arsenal y punto de entrada';
    // rejilla de operadores
    const taken = new Map();
    for (const s of match.slotsOf(my)) if (s !== me && s.opId) taken.set(s.opId, s);
    this.el.selGrid.innerHTML = opsForSide(side).map((o, i) => `
      <button class="opc${me.opId === o.id ? ' sel' : ''}" data-act="op" data-v="${o.id}" title="${esc(o.ability.name)}">
        ${taken.has(o.id) ? '<span class="tk">compañero</span>' : ''}
        <img src="${emblemURL(o.id, o.color, 96)}" alt="">
        <span class="n">${o.name}</span><span class="ar">${i + 1} · blindaje ${pips(o.armor)}</span>
      </button>`).join('');
    // detalle
    const def = me.opId ? OP_BY_ID[me.opId] : null;
    if (!def) this.el.selDetail.innerHTML = '<p class="note">Elige un operador (clic o teclas 1–8).</p>';
    else {
      const wbtn = (id, act, idx, cur) => {
        const w = WEAPONS[id];
        return `<button class="wpn${idx === cur ? ' sel' : ''}" data-act="${act}" data-v="${idx}"><b>${w.name}</b><span>${w.kind} · ${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} daño · ${w.rpm} dpm · ${w.mag} balas</span></button>`;
      };
      this.el.selDetail.innerHTML = `
        <div class="opd">
          <img src="${emblemURL(def.id, def.color, 128)}" alt="">
          <div>
            <div class="nm">${def.name}</div>
            <div class="st">Blindaje ${pips(def.armor)} · Velocidad ${pips(ARMOR_SPEED[def.armor])} · ${def.armor === 1 ? 100 : def.armor === 2 ? 110 : 125} de vida</div>
            <div class="ab"><b>${esc(def.ability.name)}</b>${esc(def.ability.desc)}<small>Gadget secundario: ${def.gadgets.map((g) => GADGETS[g].name).join(' o ')}. Habilidades y gadgets se activan en la Fase 6.</small></div>
          </div>
        </div>
        <div class="ld">
          <h4>Principal</h4><div class="row">${def.primaries.map((id, i) => wbtn(id, 'pri', i, me.primary)).join('')}</div>
          <h4>Secundaria</h4><div class="row">${def.secondaries.map((id, i) => wbtn(id, 'sec', i, me.secondary)).join('')}</div>
        </div>`;
    }
    // ubicación (defensa) o punto de entrada (ataque)
    if (side === 'def') {
      this.el.selChoiceH.textContent = 'Ubicación a defender';
      const rooms = this.ctx.map.rooms;
      const rn = (id) => (rooms.find((r) => r.id === id) || {}).name || id;
      this.el.selChoice.innerHTML = this.ctx.map.sites.map((st, i) => `
        <button class="ch${match.location === i ? ' sel' : ''}" data-act="ch" data-v="${i}"><b>${st.name}</b><span>A · ${rn(st.A)}<br>B · ${rn(st.B)}</span></button>`).join('');
    } else {
      this.el.selChoiceH.textContent = 'Punto de entrada';
      this.el.selChoice.innerHTML = this.ctx.map.attackerSpawns.map((sp, i) => `
        <button class="ch${me.spawn === i ? ' sel' : ''}" data-act="ch" data-v="${i}"><b>${sp.name}</b><span>${['Frente de la casa, junto a la puerta principal y el garaje', 'Detrás de la casa: cocina, lavandería y cobertizo', 'Lateral este: garaje y tejado'][i] || ''}</span></button>`).join('');
    }
    // equipo
    this.el.selTeam.innerHTML = match.slotsOf(my).map((s) => {
      const d = s.opId ? OP_BY_ID[s.opId] : null;
      return `<div class="m${s.human ? ' me' : ''}"><div class="pt ally${s.human ? ' me' : ''}">${d ? `<img src="${emblemURL(d.id, '#ffffff', 64)}" alt="">` : ''}</div><span>${d ? d.name : '…'}</span></div>`;
    }).join('');
    this.el.selReady.disabled = !def;
    this.el.selReady.innerHTML = me.ready ? 'Esperando… <small>Intro</small>' : 'Listo <small>Intro</small>';
  }

  // ------------------------------------------------------------------ final
  showMatchEnd(match, e) {
    const my = this.s.myTeam;
    const win = e.winner === my;
    this.el.end.classList.remove('hidden');
    this.el.endRes.textContent = win ? 'Victoria' : 'Derrota';
    this.el.endRes.className = `res ${win ? 'win' : 'lose'}`;
    this.el.endScore.innerHTML = `<span style="color:var(--blue)">${match.teams[my].score}</span> — <span style="color:var(--orange)">${match.teams[1 - my].score}</span>`;
    const m = e.mvp;
    const d = m && m.opId ? OP_BY_ID[m.opId] : null;
    this.el.endMvp.innerHTML = d ? `<img src="${emblemURL(d.id, d.color, 96)}" alt=""><div><div class="k">Mejor jugador</div><div class="n">${d.name}${m.human ? ' · tú' : ''}</div><div class="s">${m.stats.score} puntos · ${m.stats.kills} bajas · ${m.stats.assists} asistencias · ${m.stats.deaths} muertes</div></div>` : '';
    this.el.endTable.innerHTML = this._table(match, true).replace(/<h3>[\s\S]*?<\/h3>/, '');
  }
  hideMatchEnd() { this.el.end.classList.add('hidden'); }
}

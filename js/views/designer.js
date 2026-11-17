/* Airly — Home designer screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, TH, esc, F, field, num, tnum, text, sel, check, toggle, opts, btn, card, head, roomOptions, views, plans, mountPlan, wallSelect, levelTabs, orientControl, btn3d, capOptions, updateCalc } = Airly.kit;

  function bestSpotInfo(a) {
    const r = Airly.store.room(a.roomId);
    if (!r) return '';
    const on = Airly.ui.bestSpotsFor === a.id;
    let info = '';
    if (on) {
      const res = TH.bestSpots(a, r, S());
      const cur = res.spots.slice().sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
      if (res.best) info = `<p class="small">${esc(t('best.summary', { best: Math.round(res.best.cov * 100), cur: cur ? Math.round(cur.cov * 100) : '—' }))}${res.best.draft ? '' : ' ' + esc(t('best.noDraft'))}</p>${btn('moveACBest', '★ ' + esc(t('best.move')), 'primary small', { id: a.id })}`;
    }
    return `<div class="field best-box">${btn('bestSpots', (on ? '✕ ' : '★ ') + esc(t(on ? 'best.hide' : 'best.show')), 'small', { id: a.id })}<small class="hint">${esc(t('best.hint'))}</small>${info}</div>`;
  }
  function legendPlan() {
    return `<h3>${esc(t('legend.title'))}</h3><ul class="plan-legend">
      <li><span class="lg lg-room" aria-hidden="true"></span>${esc(t('legend.room'))}</li>
      <li><span class="lg lg-window" aria-hidden="true"></span>${esc(t('plan.window'))}</li>
      <li><span class="lg lg-door" aria-hidden="true"></span>${esc(t('plan.door'))}</li>
      <li><span class="lg lg-ac" aria-hidden="true"></span>${esc(t('legend.ac'))}</li>
      <li><span class="lg lg-cov" aria-hidden="true"></span>${esc(t('legend.coverage'))}</li></ul>`;
  }

  views.designer = {
    render(el) {
      const p = P();
      el.innerHTML = head('nav.designer', 'designer.lede') + `
        <div class="toolbar card" role="toolbar" aria-label="${esc(t('designer.tools'))}">
          <div class="tool-group">
            <label class="sr-only" for="new-room-type">${esc(t('room.type'))}</label>
            <select id="new-room-type">${Airly.ROOM_TYPES.map((r) => `<option value="${r}">${esc(t('roomType.' + r))}</option>`).join('')}</select>
            ${btn('addRoom', `<span aria-hidden="true">＋</span> ${esc(t('designer.addRoom'))}`, 'primary')}
            ${btn('addLRoom', `<span aria-hidden="true">⌐</span> ${esc(t('designer.addL'))}`)}
          </div>
          ${levelTabs(true)}
          <div class="tool-group">
            <label for="new-op-wall">${esc(t('op.onWall'))}</label>
            ${wallSelect('new-op-wall')}
            ${btn('addDoor', `<span aria-hidden="true">🚪</span> ${esc(t('designer.addDoor'))}`)}
            ${btn('addWindow', `<span aria-hidden="true">🪟</span> ${esc(t('designer.addWindow'))}`)}
            ${btn('addWall', `<span aria-hidden="true">▬</span> ${esc(t('designer.addWall'))}`)}
          </div>
          <div class="tool-group">
            <label class="sr-only" for="new-furn">${esc(t('furn.type'))}</label>
            <select id="new-furn">${Object.keys(Airly.FURNITURE).map((k) => `<option value="${k}">${esc(t('furn.' + k))}</option>`).join('')}</select>
            ${btn('addFurniture', `<span aria-hidden="true">🛋</span> ${esc(t('furn.add'))}`)}
            ${btn('addACHere', `<span aria-hidden="true">❄</span> ${esc(t('designer.addAC'))}`)}
            ${btn('deleteSel', `<span aria-hidden="true">🗑</span> ${esc(t('common.delete'))}`, 'danger-ghost')}
          </div>
          <div class="tool-group">
            ${btn('zoomOut', '−', 'icon', { plan: 'designer' }).replace('<button', `<button aria-label="${esc(t('plan.zoomOut'))}"`)}
            ${btn('zoomIn', '+', 'icon', { plan: 'designer' }).replace('<button', `<button aria-label="${esc(t('plan.zoomIn'))}"`)}
            ${btn('zoomFit', esc(t('plan.fit')), '', { plan: 'designer' })}
          </div>
          <div class="tool-group">
            ${toggle('pref.snap', p.snap, t('plan.snap'))}
            ${toggle('pref.showCoverage', p.showCoverage, t('plan.coverage'))}
            ${btn('resetLayout', esc(t('designer.resetLayout')), 'danger-ghost')}
          </div>
        </div>
        ${S().rooms.length ? '' : this.templatePicker()}
        ${this.traceCard()}
        <div class="designer-body">
          <div class="plan-wrap card">${btn3d()}<div id="designer-plan" class="plan-area"></div>
            <p class="plan-help muted small">${esc(t('designer.help'))}</p></div>
          <aside class="inspector card" id="inspector" aria-live="polite" aria-label="${esc(t('insp.title'))}"></aside>
        </div>`;
      mountPlan('designer', el.querySelector('#designer-plan'), 'design');
      this.inspector();
    },
    refresh() {
      if (plans.designer) plans.designer.render();
    },
    templatePicker() {
      return card(t('tpl.title'), `<p class="muted">${esc(t('tpl.lede'))}</p><div class="tpl-grid">${Airly.TEMPLATES.map((k) =>
        `<button type="button" class="tpl" data-action="newTemplate" data-tpl="${k}"><strong>${esc(t('tpl.' + k))}</strong><span class="muted small">${esc(t('tpl.' + k + '.desc'))}</span></button>`).join('')}</div>`);
    },
    traceCard() {
      const tr = S().trace;
      const lvl = Airly.ui.level || 0;
      const body = tr
        ? `<div class="field-row four">
            ${field(t('trace.width'), num('trace.w', tr.w, 1, 200, 0.1), { unit: 'm', hint: t('trace.widthHint') })}
            ${field(t('trace.x'), num('trace.x', tr.x, -200, 200, 0.1), { unit: 'm' })}
            ${field(t('trace.y'), num('trace.y', tr.y, -200, 200, 0.1), { unit: 'm' })}
            ${field(t('trace.opacity'), `<input type="range" data-bind="trace.opacity" min="0.1" max="1" step="0.05" value="${tr.opacity}">`)}
          </div>
          <p class="muted small">${esc(t('trace.onLevel', { name: Airly.levelName(tr.level || 0) }))}</p>
          <div class="row-gap">${btn('traceFit', esc(t('trace.fit')), 'ghost small')}<label class="btn small file-btn">${esc(t('trace.replace'))}<input type="file" accept="image/*" id="trace-file" class="sr-only"></label>${btn('traceRemove', esc(t('trace.remove')), 'danger-ghost small')}</div>`
        : `<p class="muted">${esc(t('trace.lede'))}</p><label class="btn file-btn">${esc(t('trace.upload'))}<input type="file" accept="image/*" id="trace-file" class="sr-only"></label>`;
      void lvl;
      return `<details class="card trace-card"${tr ? ' open' : ''}><summary>${esc(t('trace.title'))}</summary><div class="card-body">${body}</div></details>`;
    },
    onSelect() {
      if (plans.designer) plans.designer.render();
      this.inspector();
    },
    inspector() {
      const box = document.getElementById('inspector');
      if (!box) return;
      const s = Airly.ui.sel;
      let html = '';
      if (!s) {
        html = `<h2>${esc(t('insp.title'))}</h2><p class="muted">${esc(t('insp.empty'))}</p>` + legendPlan();
      } else if (s.kind === 'room') {
        const r = Airly.store.room(s.id);
        if (!r) return (box.innerHTML = '');
        const g = TH.geometry(r);
        html = `<h2>${esc(Airly.roomName(r))}</h2>
          ${field(t('room.name'), text(`room.${r.id}.name`, r.name, `placeholder="${esc(Airly.roomName(Object.assign({}, r, { name: '' })))}"`))}
          ${field(t('room.type'), sel(`room.${r.id}.type`, opts(Airly.ROOM_TYPES, 'roomType.'), r.type))}
          <div class="field-row">
            ${field(t('room.length'), num(`room.${r.id}.length`, r.length, 1, 40, 0.1), { unit: 'm' })}
            ${field(t('room.width'), num(`room.${r.id}.width`, r.width, 1, 40, 0.1), { unit: 'm' })}
          </div>
          <div class="field-row">
            ${field(t('room.x'), num(`room.${r.id}.x`, r.x, -100, 100, 0.1), { unit: 'm' })}
            ${field(t('room.y'), num(`room.${r.id}.y`, r.y, -100, 100, 0.1), { unit: 'm' })}
          </div>
          <dl class="kv"><dt>${esc(t('room.area'))}</dt><dd data-calc="area-${r.id}">${F().num(g.area, 2)} m²</dd>
          <dt>${esc(t('room.volume'))}</dt><dd data-calc="vol-${r.id}">${F().num(g.volume, 2)} m³</dd></dl>
          ${check(`room.${r.id}.openPlan`, r.openPlan, t('room.openPlan'))}
          <div class="row-gap">${btn('editRoom', esc(t('insp.moreDetails')), 'primary small', { id: r.id })} ${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>`;
      } else if (s.kind === 'opening') {
        const r = Airly.store.room(s.roomId);
        const list = r ? (s.type === 'door' ? r.doors : r.windows) : [];
        const o = list.find((x) => x.id === s.id);
        if (!o) return (box.innerHTML = '');
        const key = `op.${r.id}.${s.type === 'door' ? 'doors' : 'windows'}.${o.id}`;
        html = `<h2>${esc(t(s.type === 'door' ? 'plan.door' : 'plan.window'))}</h2><p class="muted">${esc(Airly.roomName(r))}</p>
          ${field(t('op.wall'), sel(`${key}.wall`, opts(Airly.WALLS, 'wall.'), o.wall))}
          ${field(t('op.offset'), num(`${key}.offset`, o.offset, 0, 40, 0.1), { unit: 'm' })}
          <div class="field-row">${field(t('op.w'), num(`${key}.w`, o.w, 0.3, 10, 0.1), { unit: 'm' })}${field(t('op.h'), num(`${key}.h`, o.h, 0.3, 4, 0.1), { unit: 'm' })}</div>
          ${s.type === 'door' ? toggle(`${key}.open`, o.open, t('op.open')) : ''}
          <div class="row-gap">${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>`;
      } else if (s.kind === 'ac') {
        const a = Airly.store.ac(s.id);
        if (!a) return (box.innerHTML = '');
        const idx = S().acs.indexOf(a) + 1;
        html = `<h2>${esc(t('ac.unit'))} ${idx}</h2>
          ${toggle(`ac.${a.id}.on`, a.on, t('ac.power'))}
          ${field(t('ac.capacity'), sel(`ac.${a.id}.btu`, capOptions(a.btu), a.btu, true))}
          ${field(t('ac.mode'), sel(`ac.${a.id}.mode`, opts(Airly.AC_MODES, 'mode.'), a.mode))}
          ${field(t('ac.target'), tnum(`ac.${a.id}.target`, a.target, 16, 30), { unit: F().unitSym() })}
          ${field(t('ac.room'), sel(`ac.${a.id}.roomId`, roomOptions(true), a.roomId || ''))}
          ${orientControl(a)}
          ${bestSpotInfo(a)}
          <div class="row-gap">${btn('editAC', esc(t('insp.moreDetails')), 'primary small', { id: a.id })} ${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>`;
      } else if (s.kind === 'furn') {
        const f = (S().furniture || []).find((x) => x.id === s.id);
        if (!f) return (box.innerHTML = '');
        const k = (p) => `furn.${f.id}.${p}`;
        html = `<h2>${esc(t('furn.' + f.kind))}</h2>
          ${field(t('furn.type'), sel(k('kind'), Object.keys(Airly.FURNITURE).map((x) => ({ v: x, l: t('furn.' + x) })), f.kind))}
          <div class="field-row">${field(t('room.width'), num(k('w'), f.w, 0.2, 10, 0.1), { unit: 'm' })}${field(t('room.length'), num(k('d'), f.d, 0.2, 10, 0.1), { unit: 'm' })}</div>
          ${f.kind === 'stairs' ? `<p class="muted small">${esc(t('furn.stairsHelp', { from: Airly.levelName(f.level || 0), to: Airly.levelName((f.level || 0) + 1) }))}</p>` : field(t('op.h'), num(k('h'), f.h, 0.1, 3, 0.05), { unit: 'm', hint: f.h >= TH.TALL ? t('furn.tallHint') : t('furn.lowHint') })}
          <div class="row-gap">${btn('rotateFurn', '⟳ ' + esc(t('ac.rotate')), 'small', { id: f.id })} ${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>`;
      } else if (s.kind === 'wall') {
        html = `<h2>${esc(t('plan.wall'))}</h2><p class="muted">${esc(t('insp.wallHelp'))}</p>${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}`;
      }
      box.innerHTML = html;
    },
    onFormChange(el) {
      updateCalc();
      if (plans.designer) plans.designer.render();
    },
  };
})();

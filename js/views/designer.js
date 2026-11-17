/* Airly — Home designer screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, TH, esc, F, field, num, tnum, text, sel, check, toggle, opts, btn, card, head, roomOptions, views, plans, mountPlan, levelTabs, orientControl, capOptions, updateCalc } = Airly.kit;

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
  const FURN_ICON = { sofa: '🛋', bed: '🛏', singleBed: '🛏', armchair: '💺', table: '🍽', desk: '🖥', wardrobe: '🗄', shelf: '📚', kitchen: '🍳', fridge: '🧊', tv: '📺', stairs: '🪜', toilet: '🚽', sink: '🚰', bathtub: '🛁', shower: '🚿', washer: '🧺' };

  /* Side panel when nothing (or a room wall) is selected: everything you can add */
  function buildPanel() {
    const p = P();
    const s = Airly.ui.sel;
    const wallSel = s && s.kind === 'roomwall' ? s : null;
    const wr = wallSel && Airly.store.room(wallSel.roomId);
    let wallInfo;
    if (wr) {
      wallInfo = `<p class="wall-status is-set"><span aria-hidden="true">▮</span> ${esc(t('studio.onWall', { room: Airly.roomName(wr), wall: t('wall.' + wallSel.wall) }))}<br><span class="muted small">${esc(t('studio.wallLen', { len: F().num(TH.wallLength(wr, wallSel.wall), 1) }))}</span></p>`;
    } else {
      const warn = Airly.ui.wallPrompt;
      wallInfo = `<p class="wall-status${warn ? ' is-warn' : ''}" role="${warn ? 'alert' : 'note'}"><span aria-hidden="true">${warn ? '⚠' : '👆'}</span> ${esc(t(warn ? 'studio.clickWall' : 'studio.clickWallHint'))}</p>`;
    }
    const opBtn = (type, icon, key) => `<button type="button" class="tile${wr ? '' : ' is-idle'}" data-action="studioOpening" data-type="${type}"><span class="tile-icon" aria-hidden="true">${icon}</span><span>${esc(t(key))}</span></button>`;
    return `<h2>${esc(t('studio.build'))}</h2>
      <section class="studio-sec"><h3>${esc(t('studio.rooms'))}</h3>
        ${levelTabs(true)}
        <div class="add-room-row">
          <label class="sr-only" for="new-room-type">${esc(t('room.type'))}</label>
          <select id="new-room-type">${Airly.ROOM_TYPES.map((r) => `<option value="${r}">${esc(t('roomType.' + r))}</option>`).join('')}</select>
          ${btn('addRoom', `<span aria-hidden="true">＋</span> ${esc(t('designer.addRoom'))}`, 'primary')}
        </div>
        ${btn('addLRoom', `<span aria-hidden="true">⌐</span> ${esc(t('designer.addL'))}`, 'small')}
      </section>
      <section class="studio-sec"><h3>${esc(t('studio.furniture'))}</h3>
        <div class="tile-grid">${Object.keys(Airly.FURNITURE).map((k) => `<button type="button" class="tile" data-action="studioFurn" data-kind="${k}"><span class="tile-icon" aria-hidden="true">${FURN_ICON[k] || '▭'}</span><span>${esc(t('furn.' + k))}</span></button>`).join('')}</div>
      </section>
      <section class="studio-sec"><h3>${esc(t('studio.openings'))}</h3>
        ${wallInfo}
        <div class="tile-grid">
          ${opBtn('door', '🚪', 'designer.addDoor')}
          ${opBtn('window', '🪟', 'designer.addWindow')}
          ${opBtn('ac', '❄', 'designer.addAC')}
          <button type="button" class="tile" data-action="addWall"><span class="tile-icon" aria-hidden="true">▬</span><span>${esc(t('designer.addWall'))}</span></button>
        </div>
      </section>
      <section class="studio-sec"><h3>${esc(t('studio.view'))}</h3>
        ${toggle('pref.snap', p.snap, t('plan.snap'))}
        ${toggle('pref.showCoverage', p.showCoverage, t('plan.coverage'))}
        <div class="row-gap">${btn('resetLayout', esc(t('designer.resetLayout')), 'danger-ghost small')}</div>
      </section>
      <p class="muted small">${esc(t('designer.help'))}</p>`;
  }
  /* open / close a door with one click */
  const doorBtn = (r, o, cls) => `<button type="button" class="btn door-toggle ${o.open ? 'is-open' : ''} ${cls || ''}" data-action="toggleDoorOpen" data-room="${r.id}" data-id="${o.id}" aria-pressed="${!!o.open}"><span aria-hidden="true">${o.open ? '🚪' : '▮'}</span> ${esc(t(o.open ? 'door.close' : 'door.open'))}</button>`;
  function openingsOfRoom(r) {
    const items = r.doors.map((o) => ({ o, type: 'door' })).concat(r.windows.map((o) => ({ o, type: 'window' })));
    const list = items.length ? `<ul class="op-mini">${items.map(({ o, type }) =>
      `<li><span aria-hidden="true">${type === 'door' ? '🚪' : '🪟'}</span> ${esc(t(type === 'door' ? 'plan.door' : 'plan.window'))} · ${esc(t('wall.' + o.wall))} ${sel(`op.${r.id}.${type === 'door' ? 'doors' : 'windows'}.${o.id}.wall`, opts(Airly.WALLS, 'wall.'), o.wall).replace('<select', `<select aria-label="${esc(t('op.wall'))}"`)}${type === 'door' ? doorBtn(r, o, 'small') : ''}</li>`).join('')}</ul>`
      : `<p class="muted small">${esc(t('studio.noOpenings'))}</p>`;
    return `<section class="studio-sec"><h3>${esc(t('studio.openingsInRoom'))}</h3>${list}
      <div class="row-gap">${btn('addOpening', '🚪 ' + esc(t('designer.addDoor')), 'small', { room: r.id, type: 'doors' })}${btn('addOpening', '🪟 ' + esc(t('designer.addWindow')), 'small', { room: r.id, type: 'windows' })}</div>
      <p class="hint small">${esc(t('studio.dragHint'))}</p></section>`;
  }

  views.designer = {
    render(el) {
      // 3D: the 3D view takes the same place at the top of the page, with its own panel on the right
      if (Airly.ui.designer3d && S().rooms.length) {
        el.innerHTML = `<h1 class="sr-only">${esc(t('nav.designer'))}</h1><section class="studio studio-3d card" id="studio-3d" aria-label="3D"></section>${this.traceCard()}${Airly.compareSection.html()}`;
        Airly.compareSection.bind(el);
        const host = el.querySelector('#studio-3d');
        if (!Airly.view3d.attach(host)) Airly.view3d.open(host);
        return;
      }
      Airly.ui.designer3d = false;
      el.innerHTML = `<h1 class="sr-only">${esc(t('nav.designer'))}</h1>
        <section class="studio card" aria-label="${esc(t('designer.tools'))}">
          <div class="studio-stage">
            <button type="button" class="btn plan-3d-btn" data-action="designer3d" title="${esc(t('v3d.open'))}">${Airly.kit.CUBE}<span>3D</span><span class="sr-only"> — ${esc(t('v3d.open'))}</span></button>
            <div class="studio-zoom">
              ${btn('zoomOut', '−', 'icon', { plan: 'designer' }).replace('<button', `<button aria-label="${esc(t('plan.zoomOut'))}"`)}
              ${btn('zoomIn', '+', 'icon', { plan: 'designer' }).replace('<button', `<button aria-label="${esc(t('plan.zoomIn'))}"`)}
              ${btn('zoomFit', esc(t('plan.fit')), '', { plan: 'designer' })}
            </div>
            <div id="designer-plan" class="plan-area"></div>
          </div>
          <aside class="studio-panel" id="inspector" aria-live="polite" aria-label="${esc(t('insp.title'))}"></aside>
        </section>
        ${S().rooms.length ? '' : this.templatePicker()}
        ${this.traceCard()}
        ${Airly.compareSection.html()}`;
      Airly.compareSection.bind(el);
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
      if (!s || s.kind === 'roomwall') {
        if (s && s.kind === 'roomwall') Airly.ui.wallPrompt = false;
        box.innerHTML = buildPanel();
        return;
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
          <div class="row-gap">${btn('editRoom', esc(t('insp.moreDetails')), 'primary small', { id: r.id })} ${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>
          ${openingsOfRoom(r)}`;
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
          ${s.type === 'door' ? `<div class="field">${doorBtn(r, o, 'door-toggle-big')}</div>` : ''}
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
        const fridgeBtn = f.kind === 'fridge'
          ? `<div class="field"><button type="button" class="btn door-toggle door-toggle-big ${f.open ? 'is-open' : ''}" data-action="toggleFridge" data-id="${f.id}" aria-pressed="${!!f.open}"><span aria-hidden="true">🧊</span> ${esc(t(f.open ? 'fridge.close' : 'fridge.open'))}</button></div>`
          : '';
        html = `<h2>${esc(t('furn.' + f.kind))}</h2>
          ${fridgeBtn}
          ${field(t('furn.type'), sel(k('kind'), Object.keys(Airly.FURNITURE).map((x) => ({ v: x, l: t('furn.' + x) })), f.kind))}
          <div class="field-row">${field(t('room.width'), num(k('w'), f.w, 0.2, 10, 0.1), { unit: 'm' })}${field(t('room.length'), num(k('d'), f.d, 0.2, 10, 0.1), { unit: 'm' })}</div>
          ${f.kind === 'stairs' ? `<p class="muted small">${esc(t('furn.stairsHelp', { from: Airly.levelName(f.level || 0), to: Airly.levelName((f.level || 0) + 1) }))}</p>` : field(t('op.h'), num(k('h'), f.h, 0.1, 3, 0.05), { unit: 'm', hint: f.h >= TH.TALL ? t('furn.tallHint') : t('furn.lowHint') })}
          <div class="row-gap">${btn('rotateFurn', '⟳ ' + esc(t('ac.rotate')), 'small', { id: f.id })} ${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}</div>`;
      } else if (s.kind === 'wall') {
        html = `<h2>${esc(t('plan.wall'))}</h2><p class="muted">${esc(t('insp.wallHelp'))}</p>${btn('deleteSel', esc(t('common.delete')), 'danger-ghost small')}`;
      }
      box.innerHTML = btn('studioBack', '← ' + esc(t('studio.back')), 'ghost small studio-back') + html;
    },
    onFormChange(el) {
      updateCalc();
      if (plans.designer) plans.designer.render();
    },
  };
})();

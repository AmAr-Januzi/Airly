/* Airly — AC configuration screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, TH, esc, F, field, num, tnum, text, sel, check, toggle, opts, btn, card, estimateNote, head, roomOptions, views, scheduleControl, orientControl, capOptions } = Airly.kit;

  function libraryRow(a) {
    const mine = Airly.store.prefs.models || [];
    const opt = (m, label) => `<option value="${m.id}">${esc(label)}</option>`;
    return `<div class="lib-row"><label for="lib-${a.id}">${esc(t('lib.title'))}</label>
      <select id="lib-${a.id}"><option value="">—</option><optgroup label="${esc(t('lib.typical'))}">${Airly.TYPICAL_MODELS.map((m) => opt(m, t('lib.typicalName', { btu: Math.round(m.btu / 1000) }) + ' · ' + m.rating + (m.inverter ? ' · inverter' : '') + ' · ' + F().num(m.powerKW, 2) + ' kW')).join('')}</optgroup>
      ${mine.length ? `<optgroup label="${esc(t('lib.mine'))}">${mine.map((m) => opt(m, m.name + ' · ' + F().btu(m.btu))).join('')}</optgroup>` : ''}</select>
      ${btn('applyModel', esc(t('lib.apply')), 'small', { id: a.id })}${btn('saveModel', esc(t('lib.save')), 'ghost small', { id: a.id })}${mine.length ? btn('deleteModel', esc(t('lib.delete')), 'danger-ghost small', { id: a.id }) : ''}</div>
      <small class="hint">${esc(t('lib.hint'))}</small>`;
  }

  views.acs = {
    render(el) {
      const h = S();
      el.innerHTML = head('nav.acs', 'acs.lede') + `
        <div class="toolbar card"><div class="tool-group">
          <label for="new-ac-room">${esc(t('ac.room'))}</label>
          <select id="new-ac-room">${roomOptions(false).map((o) => `<option value="${o.v}"${o.v === Airly.ui.roomId ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>
          <label for="new-ac-btu">${esc(t('ac.capacity'))}</label>
          <select id="new-ac-btu">${Airly.STANDARD_BTU.map((b) => `<option value="${b}"${b === 12000 ? ' selected' : ''}>${esc(F().btu(b))}</option>`).join('')}</select>
          ${btn('addAC', `<span aria-hidden="true">＋</span> ${esc(t('designer.addAC'))}`, 'primary')}
        </div></div>
        <div class="ac-list">${h.acs.length ? h.acs.map((a, i) => this.acCard(a, i)).join('') : `<div class="card empty">${esc(t('acs.none'))}</div>`}</div>
        ${estimateNote()}`;
      const focus = Airly.ui.acId && el.querySelector(`[data-ac-card="${Airly.ui.acId}"]`);
      if (focus && Airly.ui.scrollToAC) { focus.scrollIntoView({ block: 'start' }); Airly.ui.scrollToAC = false; }
    },
    acCard(a, i) {
      const k = (p) => `ac.${a.id}.${p}`;
      const r = Airly.store.room(a.roomId);
      const capKW = TH.acCapacityW(a) / 1000;
      const cov = r ? TH.coverage(a, r) : 0;
      const mode = a.mode === 'heat' ? 'heat' : 'cool';
      const ratedAuto = TH.acRatedKW(Object.assign({}, a, { powerKW: null }), mode);
      return `<section class="card ac-card ${a.on ? '' : 'is-off'}" data-ac-card="${a.id}" aria-labelledby="ach-${a.id}">
        <header class="card-head"><h2 id="ach-${a.id}"><span class="ac-dot m-${a.on ? a.mode : 'off'}" aria-hidden="true"></span>${esc(t('ac.unit'))} ${i + 1} · ${esc(a.brand)} ${esc(a.model)}</h2>
          <div class="head-actions">${toggle(k('on'), a.on, t('ac.power'))} ${btn('duplicateAC', esc(t('common.duplicate')), 'ghost small', { id: a.id })} ${btn('removeAC', esc(t('common.remove')), 'danger-ghost small', { id: a.id })}</div></header>
        <div class="card-body">
          <div class="field-row four">
            ${field(t('ac.brand'), text(k('brand'), a.brand))}
            ${field(t('ac.model'), text(k('model'), a.model))}
            ${field(t('ac.room'), sel(k('roomId'), roomOptions(true), a.roomId || ''))}
            ${field(t('ac.rating'), sel(k('rating'), Airly.ENERGY_RATINGS, a.rating))}
          </div>
          <div class="field-row four">
            ${field(t('ac.capacityPreset'), sel(k('btu'), capOptions(a.btu), a.btu, true))}
            ${field(t('ac.capacityCustom'), num(k('btu'), a.btu, 3000, 60000, 500), { unit: 'BTU/h' })}
            ${field(t('ac.powerKW'), `<input type="number" inputmode="decimal" data-bind="${k('powerKW')}" value="${a.powerKW == null ? '' : a.powerKW}" min="0.1" max="10" step="0.01" placeholder="${F().num(ratedAuto, 2)}">`, { unit: 'kW', hint: t('ac.powerHint') })}
            <div class="field">${check(k('inverter'), a.inverter, t('ac.inverter'))}</div>
          </div>
          <div class="field-row four">
            ${field(t('ac.mode'), sel(k('mode'), opts(Airly.AC_MODES, 'mode.'), a.mode))}
            ${field(t('ac.target'), tnum(k('target'), a.target, 16, 30), { unit: F().unitSym() })}
            ${field(t('ac.fan'), sel(k('fan'), opts(Airly.FAN_SPEEDS, 'fan.'), a.fan))}
            ${field(t('ac.direction'), sel(k('direction'), opts(Airly.DIRECTIONS, 'dir.'), a.direction))}
          </div>
          ${libraryRow(a)}
          ${orientControl(a)}
          ${scheduleControl(a)}
          <div class="calc-box four">
            <div><span>${esc(t('ac.capKW'))}</span><strong>${F().num(capKW, 2)} kW</strong></div>
            <div><span>${esc(t('ac.ratedInput'))}</span><strong>${F().num(TH.acRatedKW(a, mode), 2)} kW</strong></div>
            <div><span>${esc(t('ac.throw'))}</span><strong>${F().num(TH.acThrow(a), 1)} m</strong></div>
            <div><span>${esc(t('ac.coverage'))}</span><strong>${r ? Math.round(cov * 100) + '%' : '—'}</strong></div>
          </div>
          <div class="row-gap">${btn('locateAC', esc(t('ac.showOnPlan')), 'ghost small', { id: a.id })}</div>
        </div></section>`;
    },
  };
})();

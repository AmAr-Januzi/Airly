/* Airly — Purchase comparison screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, esc, F, field, num, text, sel, check, card, badge, estimateNote, head, roomOptions, views } = Airly.kit;

  views.purchase = {
    render(el) {
      const h = S(), p = P();
      if (!h.rooms.length) { el.innerHTML = head('nav.purchase', 'buy.lede') + `<div class="card empty">${esc(t('rooms.none'))}</div>`; return; }
      const cfg = Airly.ui.purchaseCfg();
      const opt = (key) => {
        const o = cfg[key];
        const b = (prop) => `buy.${key}.${prop}`;
        return card(t('buy.option', { k: key }), `
          ${field(t('buy.name'), text(b('name'), o.name))}
          <div class="field-row">
            ${field(t('buy.price'), num(b('price'), o.price, 0, 20000, 10), { unit: p.currency })}
            ${field(t('ac.capacity'), sel(b('btu'), Airly.STANDARD_BTU.map((v) => ({ v, l: F().btu(v) })), o.btu, true))}
          </div>
          <div class="field-row">
            ${field(t('ac.rating'), sel(b('rating'), Airly.ENERGY_RATINGS, o.rating))}
            ${field(t('ac.powerKW'), `<input type="number" inputmode="decimal" data-bind="${b('powerKW')}" value="${o.powerKW == null ? '' : o.powerKW}" min="0.1" max="10" step="0.01" placeholder="auto">`, { unit: 'kW', hint: t('ac.powerHint') })}
          </div>
          ${check(b('inverter'), o.inverter, t('ac.inverter'))}`);
      };
      let result = '';
      try {
        const r = Airly.advisor.purchase(h, cfg, p);
        const cell = (x) => `<td>${esc(F().money(x.price, 0))}</td>`;
        const perf = (ra) => ra ? `${esc(F().temp(ra.final))} ${badge(...({ effective: ['good', t('perf.effective')], slow: ['warning', t('perf.slow')], insufficient: ['critical', t('perf.insufficient')] }[ra.perf]))}` : '—';
        let verdict;
        if (r.payback != null) verdict = t('buy.payback', { which: r.cheaperToRun === 'B' ? cfg.B.name : cfg.A.name, y: F().num(r.payback, 1) });
        else if (r.cheaperToRun && r.cheaperToRun === r.cheaperToBuy) verdict = t('buy.both', { which: cfg[r.cheaperToRun].name });
        else verdict = t('buy.same');
        result = card(t('buy.result'), `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col"><span class="sr-only">${esc(t('buy.result'))}</span></th><th scope="col">A: ${esc(cfg.A.name)}</th><th scope="col">B: ${esc(cfg.B.name)}</th></tr></thead><tbody>
          <tr><th scope="row">${esc(t('buy.price'))}</th>${cell(r.A)}${cell(r.B)}</tr>
          <tr><th scope="row">${esc(t('buy.yearKWh'))}</th><td>${F().num(r.A.yearly.kWh, 0)} kWh</td><td>${F().num(r.B.yearly.kWh, 0)} kWh</td></tr>
          <tr><th scope="row">${esc(t('buy.yearCost'))}</th><td>${esc(F().money(r.A.yearly.cost))}</td><td>${esc(F().money(r.B.yearly.cost))}</td></tr>
          <tr class="total"><th scope="row">${esc(t('buy.total10'))}</th><td>${esc(F().money(r.A.total10, 0))}</td><td>${esc(F().money(r.B.total10, 0))}</td></tr>
          <tr><th scope="row">${esc(t('buy.hotDay'))}</th><td>${perf(r.A.hot)}</td><td>${perf(r.B.hot)}</td></tr>
          <tr><th scope="row">${esc(t('buy.coldDay'))}</th><td>${perf(r.A.cold)}</td><td>${perf(r.B.cold)}</td></tr>
          </tbody></table></div><p><strong>${esc(verdict)}</strong></p>
          <p class="muted small">${esc(t('buy.note', { climate: t('climate.' + (h.env.climate || 'tirana')), price: F().money(p.price, 2) }))}</p>`, 'table-card');
      } catch (e) { console.error(e); }
      el.innerHTML = head('nav.purchase', 'buy.lede') + `
        ${card(t('buy.where'), `<div class="field-row"><div class="field"><label for="buy-room">${esc(t('ac.room'))}</label><select id="buy-room" data-bind="buy.roomId.v">${roomOptions(false).map((o) => `<option value="${o.v}"${o.v === cfg.roomId ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>
          <div class="field align-end">${check('buy.replace.v', cfg.replace, t('buy.replace'))}</div></div>`)}
        <div class="grid-2">${opt('A')}${opt('B')}</div>
        ${result}${estimateNote()}`;
    },
  };
})();

/* Airly — Compare homes screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, esc, F, sel, check, card, estimateNote, head, views, scoreBadge } = Airly.kit;

  views.compare = {
    render(el) {
      const h = S(), p = P();
      const saved = Object.values(Airly.store.projects()).filter((x) => x.id !== h.id);
      const sel = Airly.ui.compareSel = Airly.ui.compareSel || ['current'];
      const homeOf = (key) => key === 'current' ? { name: h.name || t('home.defaultName'), home: h } : (() => { const pr = saved.find((x) => 'p:' + x.id === key); return pr ? { name: pr.name || t('home.defaultName'), home: Airly.factory.normalizeHome(pr.data) } : null; })();
      const options = [{ key: 'current', name: (h.name || t('home.defaultName')) + ' (' + t('proj.open') + ')' }].concat(saved.map((x) => ({ key: 'p:' + x.id, name: x.name || t('home.defaultName') })));
      const picks = sel.map(homeOf).filter(Boolean);
      // same climate, prices and season for every home so the comparison is fair
      const base = h.env;
      const rows = picks.map((x) => {
        const hh = Airly.clone(x.home);
        hh.env = Object.assign({}, hh.env, { climate: base.climate, customClimate: base.customClimate, outsideSummer: base.outsideSummer, outsideWinter: base.outsideWinter, swingSummer: base.swingSummer, swingWinter: base.swingWinter, dayCycle: base.dayCycle });
        const an = Airly.advisor.analyze(hh, 'cooling'), anH = Airly.advisor.analyze(hh, 'heating');
        const y = Airly.advisor.yearly(hh, p);
        const comfort = an.rooms.length ? Math.round(an.rooms.reduce((s2, r) => s2 + r.comfort, 0) / an.rooms.length) : 0;
        return { name: x.name, an, anH, y, comfort, acs: hh.acs.length, bad: an.rooms.filter((r) => r.perf === 'insufficient' && !r.covered).length };
      });
      const best = (f, low) => { const vals = rows.map(f); const m = low ? Math.min(...vals) : Math.max(...vals); return (v) => (rows.length > 1 && v === m ? ' class="best"' : ''); };
      const cost = best((r) => r.y.cost, true), comf = best((r) => r.comfort), bad = best((r) => r.bad, true);
      el.innerHTML = head('nav.compare', 'cmp.lede') + card(t('cmp.pick'), `<div class="cmp-picks">${options.map((o) => `<label class="check"><input type="checkbox" data-action="compareToggle" data-key="${esc(o.key)}"${sel.includes(o.key) ? ' checked' : ''}> <span>${esc(o.name)}</span></label>`).join('')}</div>
        ${saved.length ? '' : `<p class="muted small">${esc(t('cmp.noSaved'))}</p>`}`) +
        (rows.length ? card(t('cmp.result'), `<div class="table-wrap" tabindex="0"><table class="cmp-table"><thead><tr><th scope="col"><span class="sr-only">${esc(t('cmp.result'))}</span></th>${rows.map((r) => `<th scope="col">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
          <tr><th scope="row">${esc(t('dash.rooms'))}</th>${rows.map((r) => `<td>${r.an.rooms.length} · ${F().num(r.an.totals.area, 0)} m²</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('dash.acUnits'))}</th>${rows.map((r) => `<td>${r.acs} · ${esc(F().btu(r.an.totals.inst))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('report.reqCool'))}</th>${rows.map((r) => `<td>${esc(F().btu(r.an.totals.req))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('report.reqHeat'))}</th>${rows.map((r) => `<td>${esc(F().btu(r.anH.totals.req))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('year.total'))}</th>${rows.map((r) => `<td${cost(r.y.cost)}>${esc(F().money(r.y.cost, 0))} · ${F().num(r.y.kWh, 0)} kWh</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('comfort.avg'))}</th>${rows.map((r) => `<td${comf(r.comfort)}>${scoreBadge(r.comfort)}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('dash.problemRooms'))}</th>${rows.map((r) => `<td${bad(r.bad)}>${r.bad}</td>`).join('')}</tr>
          </tbody></table></div><p class="muted small">${esc(t('cmp.note', { climate: t('climate.' + (base.climate || 'tirana')) }))}</p>`, 'table-card') : '') + estimateNote();
    },
  };
})();

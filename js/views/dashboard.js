/* Airly — Dashboard screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, TH, esc, F, text, btn, card, seasonTabs, badge, estimateNote, head, capStatus, views, plans, mountPlan, stat, btn3d } = Airly.kit;

  function remindersCard() {
    const due = Airly.dueReminders ? Airly.dueReminders() : [];
    if (!due.length) return '';
    return `<section class="card reminder" role="status"><span class="reminder-icon" aria-hidden="true">🔔</span><div><h2>${esc(t('remind.title'))}</h2><ul>${due.map((k) => `<li>${esc(t('remind.' + k))} ${k === 'filter' ? btn('filterCleaned', esc(t('remind.doneFilter')), 'small') : btn('serviceDone', esc(t('remind.doneService')), 'small')}</li>`).join('')}</ul>
      <div class="row-gap">${btn('snoozeReminders', esc(t('remind.snooze')), 'ghost small')}${btn('go', esc(t('nav.maintenance')), 'ghost small', { view: 'maintenance' })}</div></div></section>`;
  }
  function roomTable(an) {
    if (!an.rooms.length) return `<p class="muted">${esc(t('rooms.none'))}</p>`;
    return `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('an.room'))}</th><th scope="col">${esc(t('an.area'))}</th><th scope="col">${esc(t('an.installed'))}</th><th scope="col">${esc(t('an.required'))}</th><th scope="col">${esc(t('an.result'))}</th></tr></thead><tbody>` +
      an.rooms.map((ra) => {
        const [k, l] = capStatus(ra);
        return `<tr><th scope="row">${esc(Airly.roomName(ra.room))}</th><td>${F().num(ra.geom.area, 1)} m²</td><td>${ra.inst ? esc(F().btu(ra.inst)) : esc(t('common.none'))}</td><td>${esc(F().btu(ra.req.size))}</td><td>${badge(k, l)}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  views.dashboard = {
    render(el) {
      const h = S();
      const season = h.env.season;
      const an = Airly.advisor.analyze(h, season);
      const recs = Airly.advisor.recommend(h, season).filter((r) => r.severity !== 'good').slice(0, 4);
      const live = TH.live;
      let avg, avgNote;
      if (live.model && live.model.t > 0) {
        avg = live.model.rooms.reduce((s, r) => s + r.T, 0) / Math.max(1, live.model.rooms.length);
        avgNote = t('dash.avgLive', { time: F().dur(live.model.t) });
      } else {
        avg = an.pred.final.reduce((s, v) => s + v, 0) / Math.max(1, an.pred.final.length);
        avgNote = t('dash.avgPredicted', { h: an.hours });
      }
      const pct = an.totals.req > 0 ? Math.round((an.totals.inst / an.totals.req) * 100) : 0;
      const problemRooms = an.rooms.filter((r) => r.perf === 'insufficient' && !r.covered).length;
      el.innerHTML = head('nav.dashboard', null, btn('shareHome', `<span aria-hidden="true">🔗</span> ${esc(t('share.button'))}`, 'ghost') + btn('printReport', `<span aria-hidden="true">🖨</span> ${esc(t('report.button'))}`, 'ghost') + btn('openProjects', `<span aria-hidden="true">🗂</span> ${esc(t('proj.manage'))}`, 'ghost')) + `
        <div class="hero card">
          <div class="hero-text">
            <label class="sr-only" for="home-name-dash">${esc(t('home.name'))}</label>
            <input id="home-name-dash" class="hero-title" type="text" data-bind="home.name" value="${esc(h.name)}" placeholder="${esc(t('home.defaultName'))}">
            <p>${esc(t('dash.heroText'))}</p>
            <div class="hero-actions">
              ${btn('go', esc(t('dash.openDesigner')), 'primary', { view: 'designer' })}
              ${btn('go', esc(t('dash.runSim')), '', { view: 'simulator' })}
            </div>
          </div>
          <div class="hero-season">${seasonTabs(season, 'setSeason')}
            <p class="muted small">${esc(t('dash.outside'))}: <strong>${esc(F().temp(TH.seasonOutside(h.env)))}</strong></p>
          </div>
        </div>
        ${remindersCard()}
        <div class="stats">
          ${stat('🏠', t('dash.rooms'), h.rooms.length, F().num(an.totals.area, 1) + ' m² · ' + F().num(an.totals.volume, 0) + ' m³')}
          ${stat('❄', t('dash.acUnits'), h.acs.length, t('dash.acOn', { n: h.acs.filter((a) => a.on).length }))}
          ${stat('🌡', t('dash.avgTemp'), F().temp(avg), avgNote)}
          ${stat('⚡', t('dash.capacity'), pct + '%', F().btu(an.totals.inst) + ' / ' + F().btu(an.totals.req))}
          ${stat('⚠', t('dash.problemRooms'), problemRooms, t('dash.problemNote'))}
          ${stat('😊', t('comfort.avg'), (an.rooms.length ? Math.round(an.rooms.reduce((s2, r) => s2 + r.comfort, 0) / an.rooms.length) : 0) + '/100', t('comfort.avgNote'))}
        </div>
        <div class="grid-2">
          ${card(t('dash.layout'), `<div class="mini-wrap">${btn3d()}<div class="mini-plan" id="dash-plan"></div></div><div class="row-gap">${btn('go', esc(t('dash.editLayout')), 'ghost small', { view: 'designer' })}</div>`)}
          ${card(t('dash.topRecs'), recs.length ? `<ul class="rec-mini">${recs.map((r) => `<li>${badge(r.severity, t('sev.' + r.severity))} <span>${esc(t('rec.' + r.type + '.title', r.params))}</span></li>`).join('')}</ul>` : `<p>${badge('good', t('sev.good'))} ${esc(t('dash.noRecs'))}</p>`,
            '', btn('go', esc(t('common.viewAll')), 'ghost small', { view: 'recommendations' }))}
        </div>
        ${card(t('dash.rooms'), roomTable(an), 'table-card')}
        ${estimateNote()}`;
      mountPlan('dash', el.querySelector('#dash-plan'), 'mini').fit();
      plans.dash.render();
    },
  };
})();

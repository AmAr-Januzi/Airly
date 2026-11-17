/* Airly — Dashboard screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, TH, esc, F, text, btn, card, seasonTabs, badge, estimateNote, head, capStatus, views, plans, mountPlan, stat, btn3d } = Airly.kit;

  function remindersCard() {
    const due = Airly.dueReminders ? Airly.dueReminders() : [];
    if (!due.length) return '';
    return `<section class="card reminder" role="status"><span class="reminder-icon" aria-hidden="true">🔔</span><div><h2>${esc(t('remind.title'))}</h2><ul>${due.map((k) => `<li>${esc(t('remind.' + k))} ${k === 'filter' ? btn('filterCleaned', esc(t('remind.doneFilter')), 'small') : btn('serviceDone', esc(t('remind.doneService')), 'small')}</li>`).join('')}</ul>
      <div class="row-gap">${btn('snoozeReminders', esc(t('remind.snooze')), 'ghost small')}${btn('goTab', esc(t('nav.maintenance')), 'ghost small', { view: 'care', tab: 'maintenance' })}</div></div></section>`;
  }
  /* One card per part of the app, with what is in it right now and a button that opens it */
  function sections(h, season, nRecs) {
    const p = Airly.store.prefs;
    const furn = (h.furniture || []).filter((f) => f.kind !== 'stairs').length;
    const timers = h.acs.filter((a) => a.schedule && a.schedule.enabled).length;
    let monthly = null;
    try { monthly = Airly.advisor.energy(h, season, p.hours).dailyKWh * p.days * p.price; } catch (e) { /* no estimate */ }
    const m = h.maintenance || {};
    const days = m.lastFilterClean ? Math.floor((Date.now() - m.lastFilterClean) / 864e5) : null;
    const due = Airly.dueReminders ? Airly.dueReminders().length : 0;
    const items = [
      { icon: '🏠', title: 'nav.designer', line: t('dash.secDesigner', { rooms: h.rooms.length, floors: h.levels || 1, furn }), act: btn('go', esc(t('dash.open')), 'small', { view: 'designer' }) },
      { icon: '▶', title: 'nav.simulator', line: t('dash.secSim', { acs: h.acs.length, on: h.acs.filter((a) => a.on).length, timers }), act: btn('go', esc(t('dash.open')), 'small', { view: 'simulator' }) },
      { icon: '🌿', title: 'nav.eco', line: (h.acs.length && monthly != null ? t('dash.secEco', { cost: F().money(monthly), season: t('season.' + season).toLowerCase() }) : t('acs.none')) + ' · ' + t('dash.secRecs', { n: nRecs }), act: btn('goTab', esc(t('dash.open')), 'small', { view: 'eco', tab: 'energy' }) },
      { icon: '🛟', title: 'nav.groupHelp', line: due ? t('dash.secCareDue') : days != null ? t('dash.secCareDays', { d: days }) : t('dash.secCareNever'), warn: !!due, act: btn('goTab', esc(t('dash.open')), 'small', { view: 'care', tab: 'maintenance' }) },
    ];
    return `<section class="dash-sections" aria-label="${esc(t('dash.glance'))}">
      <h2 class="dash-sec-title">${esc(t('dash.glance'))}</h2>
      <div class="dash-sec-grid">${items.map((x) => `<article class="card dash-sec${x.warn ? ' is-warn' : ''}">
        <span class="dash-sec-icon" aria-hidden="true">${x.icon}</span>
        <div class="dash-sec-body"><h3>${esc(t(x.title))}</h3><p>${esc(x.line)}</p></div>
        ${x.act}</article>`).join('')}</div></section>`;
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
              ${btn('goTab', '🌿 ' + esc(t('nav.eco')), '', { view: 'eco', tab: 'energy' })}
            </div>
          </div>
          <div class="hero-season">${seasonTabs(season, 'setSeason')}
            <p class="muted small">${esc(t('dash.outside'))}: <strong>${esc(F().temp(TH.seasonOutside(h.env)))}</strong></p>
          </div>
        </div>
        ${remindersCard()}
        <div class="stats stats-6">
          ${stat('🏠', t('dash.rooms'), h.rooms.length, F().num(an.totals.area, 1) + ' m² · ' + F().num(an.totals.volume, 0) + ' m³')}
          ${stat('❄', t('dash.acUnits'), h.acs.length, t('dash.acOn', { n: h.acs.filter((a) => a.on).length }))}
          ${stat('🌡', t('dash.avgTemp'), F().temp(avg), avgNote)}
          ${stat('⚡', t('dash.capacity'), pct + '%', F().btu(an.totals.inst) + ' / ' + F().btu(an.totals.req))}
          ${stat('⚠', t('dash.problemRooms'), problemRooms, t('dash.problemNote'))}
          ${stat('😊', t('comfort.avg'), (an.rooms.length ? Math.round(an.rooms.reduce((s2, r) => s2 + r.comfort, 0) / an.rooms.length) : 0) + '/100', t('comfort.avgNote'))}
        </div>
        ${sections(h, season, Airly.advisor.recommend(h, season).filter((r) => r.severity !== 'good').length)}
        <div class="grid-2">
          ${card(t('dash.layout'), `<div class="mini-wrap">${btn3d()}<div class="mini-plan" id="dash-plan"></div></div><div class="row-gap">${btn('go', esc(t('dash.editLayout')), 'ghost small', { view: 'designer' })}</div>`)}
          ${card(t('dash.topRecs'), recs.length ? `<ul class="rec-mini">${recs.map((r) => `<li>${badge(r.severity, t('sev.' + r.severity))} <span>${esc(t('rec.' + r.type + '.title', r.params))}</span></li>`).join('')}</ul>` : `<p>${badge('good', t('sev.good'))} ${esc(t('dash.noRecs'))}</p>`,
            '', btn('goTab', esc(t('common.viewAll')), 'ghost small', { view: 'eco', tab: 'recs' }))}
        </div>
        ${card(t('dash.rooms'), roomTable(an), 'table-card')}
        ${estimateNote()}`;
      mountPlan('dash', el.querySelector('#dash-plan'), 'mini').fit();
      plans.dash.render();
    },
  };
})();

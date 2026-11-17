/* Airly — Cleaning & maintenance screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, esc, field, num, check, toggle, btn, card, badge, head, views } = Airly.kit;

  views.maintenance = {
    render(el) {
      const G = Airly.i18n.maintenance();
      const m = S().maintenance;
      const last = m.lastFilterClean;
      const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
      el.innerHTML = head('nav.maintenance', 'maint.lede') + `
        <div class="safety card" role="note"><span class="safety-icon" aria-hidden="true">⚠</span><div><h2>${esc(t('maint.safetyTitle'))}</h2><p>${esc(t('maint.safety'))}</p></div></div>
        <div class="grid-2">
          ${card(t('maint.cleaning'), `<ol class="steps">${G.cleaning.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><h3>${esc(t('maint.proTitle'))}</h3><ul class="tips">${G.pro.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`)}
          ${card(t('maint.checklist'), `
            <p>${last ? esc(t('maint.lastClean', { d: days, date: new Date(last).toLocaleDateString(Airly.i18n.locale()) })) : esc(t('maint.neverClean'))}</p>
            ${btn('filterCleaned', esc(t('maint.markClean')), 'primary small')}
            <p>${m.lastService ? esc(t('remind.lastService', { date: new Date(m.lastService).toLocaleDateString(Airly.i18n.locale()) })) : esc(t('remind.noService'))}</p>
            ${btn('serviceDone', esc(t('remind.doneService')), 'small')}
            <ul class="checklist">${G.checklist.map((c, i) => `<li>${check('maint.' + i, !!m.checks[i], c)}</li>`).join('')}</ul>
            ${btn('clearChecks', esc(t('maint.clearChecks')), 'ghost small')}`)}
        </div>
        ${card(t('remind.settings'), `
          <div class="field-row">
            <div class="field">${toggle('pref.remindFilter', P().remindFilter, t('remind.filterToggle'))}</div>
            ${field(t('remind.every'), num('pref.filterDays', P().filterDays, 7, 180, 1), { unit: t('remind.days') })}
          </div>
          ${toggle('pref.remindService', P().remindService, t('remind.serviceToggle'))}
          <div class="field">${toggle('pref.notify', P().notify, t('remind.notify'))}<small class="hint">${esc(t('remind.notifyHint'))}</small></div>`)}
        ${card(t('maint.troubleTitle'), `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('maint.problem'))}</th><th scope="col">${esc(t('maint.cause'))}</th><th scope="col">${esc(t('maint.action'))}</th></tr></thead><tbody>
          ${G.trouble.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}${r[3] ? ' ' + badge('warning', t('maint.techBadge')) : ''}</td></tr>`).join('')}
          </tbody></table></div>`, 'table-card')}
        ${card(t('maint.guideTitle'), G.troubleGuide.map((g) => `<details class="disclosure"><summary>${esc(g.title)}</summary><ol class="steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`).join(''))}`;
    },
  };
})();

/* Airly — Settings screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, P, esc, F, field, text, sel, toggle, opts, btn, card, badge, head, views, speedLabel } = Airly.kit;

  views.settings = {
    render(el) {
      const p = P();
      const storage = Airly.storageOK ? t('settings.storageOK') : t('settings.storageNo');
      el.innerHTML = head('nav.settings', 'settings.lede') + `
        <div class="grid-2">
          ${card(t('settings.general'), `
            ${field(t('settings.language'), sel('pref.lang', Airly.i18n.languages().map((l) => ({ v: l.code, l: l.name })), p.lang))}
            ${field(t('settings.tempUnit'), sel('pref.tempUnit', opts(['C', 'F'], 'tempUnit.'), p.tempUnit))}
            ${field(t('settings.units'), `<input type="text" value="${esc(t('settings.unitsValue'))}" disabled>`, { hint: t('settings.unitsHint') })}
            ${field(t('settings.currency'), sel('pref.currency', ['€', '$', '£', 'L', 'CHF'], p.currency))}
            ${field(t('sim.speed'), sel('pref.simSpeed', Airly.SIM_SPEEDS.map((s) => ({ v: s, l: speedLabel(s) })), Airly.SIM_SPEEDS.find((s) => Math.abs(s - p.simSpeed) < 1e-6) || p.simSpeed, true))}
            ${toggle('pref.snap', p.snap, t('plan.snap'))}
            ${toggle('pref.showCoverage', p.showCoverage, t('plan.coverage'))}
            <div class="row-gap">${btn('resetPrefs', esc(t('settings.resetPrefs')), 'ghost')}</div>`)}
          ${card(t('settings.data'), `
            <p class="muted">${esc(storage)}</p>
            <div class="btn-stack">
              ${btn('openProjects', esc(t('proj.manage')), 'primary')}
              ${btn('printReport', esc(t('report.button')))}
              ${btn('shareHome', esc(t('share.button')))}
              ${btn('exportJSON', esc(t('settings.export')))}
              <label class="btn file-btn">${esc(t('settings.import'))}<input type="file" accept="application/json,.json" id="import-file" class="sr-only"></label>
              ${btn('resetHome', esc(t('settings.resetHome')), 'danger-ghost')}
              ${btn('clearAll', esc(t('settings.clearAll')), 'danger')}
            </div>`)}
        </div>
        ${card(t('profile.title'), `<div class="profile-row"><span class="profile-pic">${P().avatar ? `<img src="${P().avatar}" alt="${esc(t('profile.title'))}">` : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4" fill="currentColor"/><path d="M4 20.5c1.4-3.6 4.4-5.5 8-5.5s6.6 1.9 8 5.5" fill="currentColor"/></svg>`}</span>
          <div><p class="muted small">${esc(t('profile.lede'))}</p><div class="row-gap">${btn('pickAvatar', esc(t(P().avatar ? 'profile.change' : 'profile.add')), 'primary small')}${P().avatar ? btn('removeAvatar', esc(t('profile.remove')), 'danger-ghost small') : ''}</div></div></div>`)}
        ${card(t('pwa.title'), `<p>${esc(t('pwa.lede'))}</p>
          ${Airly.ui.installPrompt ? btn('installApp', '⬇ ' + esc(t('pwa.install')), 'primary') : window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? `<p>${badge('good', t('pwa.running'))}</p>` : `<p class="muted small">${esc(t(/^https?:$/.test(location.protocol) ? 'pwa.howto' : 'pwa.needServer'))}</p>`}`)}
        ${card(t('settings.about'), `<p>${esc(t('settings.aboutText'))}</p>`)}`;
    },
  };
})();

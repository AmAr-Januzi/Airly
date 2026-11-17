/* Airly — Usage guide screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, esc, F, text, card, badge, head, views } = Airly.kit;

  function dailyTips(recs) {
    const h = S();
    const tips = [];
    const map = { suitable: 'tip.suitable', addAC: 'tip.addAC', shading: 'tip.shading', filter: 'tip.filter', oversized: 'tip.oversized', targetLow: 'tip.targetLow', targetHigh: 'tip.targetHigh', openDoor: 'tip.openDoor', covered: 'tip.covered', undersized: 'tip.undersized' };
    const seen = new Set();
    recs.forEach((r) => {
      const k = map[r.type];
      if (!k) return;
      const key = k + (r.roomId || '');
      if (seen.has(key)) return;
      seen.add(key);
      tips.push({ sev: r.severity === 'critical' ? 'warning' : r.severity, text: t(k, r.params) });
    });
    const season = h.env.season;
    tips.push({ sev: 'info', text: t(season === 'heating' ? 'tip.generalHeat' : 'tip.generalCool', { t: F().temp(season === 'heating' ? h.env.desiredHeat : h.env.desiredCool) }) });
    if (h.rooms.some((r) => r.doors.some((d) => d.open)) && h.acs.length) tips.push({ sev: 'info', text: t('tip.doors') });
    return tips.slice(0, 10);
  }

  views.guide = {
    tab: 'cooling',
    render(el) {
      const tabs = ['cooling', 'heating', 'airflow', 'saving'];
      const G = Airly.i18n.guide();
      const section = G[this.tab];
      const recs = Airly.advisor.recommend(S(), S().env.season);
      const daily = dailyTips(recs);
      el.innerHTML = head('nav.guide', 'guide.lede') + `
        ${card(t('guide.dailyTitle', { season: t('season.' + S().env.season) }), daily.length ? `<ul class="tips">${daily.map((d) => `<li>${badge(d.sev, t('sev.' + d.sev))} ${esc(d.text)}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('dash.noRecs'))}</p>`)}
        <div class="tabs" role="tablist" aria-label="${esc(t('nav.guide'))}">${tabs.map((k) => `<button type="button" role="tab" id="gtab-${k}" aria-controls="gpanel" aria-selected="${k === this.tab}" class="tab ${k === this.tab ? 'active' : ''}" data-action="guideTab" data-tab="${k}">${esc(t('guide.tab.' + k))}</button>`).join('')}</div>
        <div id="gpanel" role="tabpanel" aria-labelledby="gtab-${this.tab}" class="guide-grid">
          ${section.map((s) => card(s.title, `<ul class="tips">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)).join('')}
        </div>`;
    },
  };
})();

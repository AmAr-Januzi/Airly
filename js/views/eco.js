/* Airly — ECO screen: the important energy numbers, the AC purchase comparison and the recommendations, as tabs */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, esc, head, views } = Airly.kit;
  const TABS = [
    { key: 'energy', icon: '⚡', label: 'eco.tabEnergy', view: 'energy' },
    { key: 'purchase', icon: '🛒', label: 'eco.tabPurchase', view: 'purchase' },
    { key: 'recs', icon: '💡', label: 'eco.tabRecs', view: 'recommendations' },
  ];

  views.eco = {
    tab: 'energy',
    render(el) {
      const cur = TABS.find((x) => x.key === this.tab) || TABS[0];
      el.innerHTML = head('nav.eco', 'eco.lede') + `
        <div class="tabs eco-tabs" role="tablist" aria-label="${esc(t('nav.eco'))}">${TABS.map((x) =>
          `<button type="button" role="tab" id="etab-${x.key}" aria-controls="eco-panel" aria-selected="${x === cur}" tabindex="${x === cur ? 0 : -1}" class="tab ${x === cur ? 'active' : ''}" data-action="ecoTab" data-tab="${x.key}"><span aria-hidden="true">${x.icon}</span> ${esc(t(x.label))}</button>`).join('')}</div>
        <div id="eco-panel" class="eco-panel" role="tabpanel" aria-labelledby="etab-${cur.key}"></div>`;
      const panel = el.querySelector('#eco-panel');
      // each tab is drawn by its own screen; ECO shows its own title, so the tab's big heading is dropped
      views[cur.view].render(panel, { compact: true });
      const h1 = panel.querySelector('.view-head h1');
      if (h1) h1.remove();
    },
  };
})();

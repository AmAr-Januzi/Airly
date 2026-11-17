/* Airly — Help & Care screen: the AC usage guide and maintenance, as tabs */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, esc, head, views } = Airly.kit;
  const TABS = [
    { key: 'guide', icon: '📘', label: 'nav.guide', view: 'guide' },
    { key: 'maintenance', icon: '🧰', label: 'nav.maintenance', view: 'maintenance' },
  ];

  views.care = {
    tab: 'guide',
    render(el) {
      const cur = TABS.find((x) => x.key === this.tab) || TABS[0];
      el.innerHTML = head('nav.groupHelp', 'care.lede') + `
        <div class="tabs eco-tabs" role="tablist" aria-label="${esc(t('nav.groupHelp'))}">${TABS.map((x) =>
          `<button type="button" role="tab" id="ctab-${x.key}" aria-controls="care-panel" aria-selected="${x === cur}" tabindex="${x === cur ? 0 : -1}" class="tab ${x === cur ? 'active' : ''}" data-action="careTab" data-tab="${x.key}"><span aria-hidden="true">${x.icon}</span> ${esc(t(x.label))}</button>`).join('')}</div>
        <div id="care-panel" class="eco-panel" role="tabpanel" aria-labelledby="ctab-${cur.key}"></div>`;
      const panel = el.querySelector('#care-panel');
      // each tab is drawn by its own screen; this page shows its own title, so the tab's big heading is dropped
      views[cur.view].render(panel);
      const h1 = panel.querySelector('.view-head h1');
      if (h1) h1.remove();
    },
  };
})();

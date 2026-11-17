/* Airly — Compare homes: a fold-open section at the bottom of the Home Designer */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, esc, F, btn, scoreBadge } = Airly.kit;
  const MAX = 4;

  /* Only the rooms (and their ACs, walls and furniture) of one floor; 'all' keeps the whole home */
  function onFloor(home, floor) {
    const hh = Airly.clone(home);
    if (floor === 'all') return hh;
    const k = +floor;
    hh.rooms = hh.rooms.filter((r) => (r.level || 0) === k);
    const ids = new Set(hh.rooms.map((r) => r.id));
    hh.acs = hh.acs.filter((a) => ids.has(a.roomId));
    hh.walls = (hh.walls || []).filter((w) => (w.level || 0) === k);
    hh.furniture = (hh.furniture || []).filter((f) => (f.level || 0) === k);
    return hh;
  }

  Airly.compareSection = {
    /* closed: just the heading (nothing is calculated); open: pickers and the side-by-side table */
    html() {
      const open = !!Airly.ui.compareOpen;
      const wrap = (body) => `<details class="card trace-card cmp-section" id="cmp-section"${open ? ' open' : ''}><summary><span aria-hidden="true">⚖</span> ${esc(t('nav.compare'))}</summary><div class="card-body">${body}</div></details>`;
      if (!open) return wrap('');
      const h = S(), p = P();
      const saved = Object.values(Airly.store.projects()).filter((x) => x.id !== h.id);
      const options = [{ key: 'current', name: (h.name || t('home.defaultName')) + ' (' + t('proj.open') + ')' }].concat(saved.map((x) => ({ key: 'p:' + x.id, name: x.name || t('home.defaultName') })));
      const homeOf = (key) => {
        if (key === 'current') return { name: h.name || t('home.defaultName'), home: h };
        const pr = saved.find((x) => 'p:' + x.id === key);
        return pr ? { name: pr.name || t('home.defaultName'), home: Airly.factory.normalizeHome(pr.data) } : null;
      };
      // what to compare: a home and one of its floors (or all floors), up to 4 times
      let slots = Airly.ui.compareSlots;
      if (!slots) slots = Airly.ui.compareSlots = [{ home: 'current', floor: 'all' }].concat(saved.length ? [{ home: 'p:' + saved[0].id, floor: 'all' }] : []);
      slots.forEach((s) => {
        if (!homeOf(s.home)) { s.home = 'current'; s.floor = 'all'; }
        const n = homeOf(s.home).home.levels || 1;
        if (s.floor !== 'all' && +s.floor >= n) s.floor = 'all';
      });

      const pickers = slots.map((s, i) => {
        const n = homeOf(s.home).home.levels || 1;
        const floors = [{ v: 'all', l: t('cmp.allFloors') }].concat(Array.from({ length: n }, (_, k) => ({ v: String(k), l: Airly.levelName(k) })));
        return `<div class="cmp-slot">
          <span class="cmp-slot-n">${i + 1}</span>
          <div class="field"><label for="cmp-home-${i}">${esc(t('cmp.home'))}</label><select id="cmp-home-${i}" data-cmp="home" data-idx="${i}">${options.map((o) => `<option value="${esc(o.key)}"${o.key === s.home ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="cmp-floor-${i}">${esc(t('cmp.floor'))}</label><select id="cmp-floor-${i}" data-cmp="floor" data-idx="${i}">${floors.map((o) => `<option value="${o.v}"${o.v === String(s.floor) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>
          ${slots.length > 1 ? btn('cmpRemove', '✕', 'icon danger-ghost', { idx: i }).replace('<button', `<button aria-label="${esc(t('common.remove'))}"`) : ''}
        </div>`;
      }).join('');

      // same climate, prices and season for every home so the comparison is fair
      const base = h.env;
      const rows = slots.map((s) => {
        const x = homeOf(s.home);
        const hh = onFloor(x.home, s.floor);
        hh.env = Object.assign({}, hh.env, { climate: base.climate, customClimate: base.customClimate, outsideSummer: base.outsideSummer, outsideWinter: base.outsideWinter, swingSummer: base.swingSummer, swingWinter: base.swingWinter, dayCycle: base.dayCycle });
        const an = Airly.advisor.analyze(hh, 'cooling'), anH = Airly.advisor.analyze(hh, 'heating');
        const y = Airly.advisor.yearly(hh, p);
        const comfort = an.rooms.length ? Math.round(an.rooms.reduce((s2, r) => s2 + r.comfort, 0) / an.rooms.length) : 0;
        const floorName = s.floor === 'all' ? t('cmp.allFloors') : Airly.levelName(+s.floor);
        return { name: x.name, floorName, an, anH, y, comfort, acs: hh.acs.length, bad: an.rooms.filter((r) => r.perf === 'insufficient' && !r.covered).length };
      });
      const best = (f, low) => { const vals = rows.map(f); const m = low ? Math.min(...vals) : Math.max(...vals); return (v) => (rows.length > 1 && v === m ? ' class="best"' : ''); };
      const cost = best((r) => r.y.cost, true), comf = best((r) => r.comfort), bad = best((r) => r.bad, true);
      return wrap(`<p class="muted">${esc(t('cmp.lede'))}</p><h3>${esc(t('cmp.pick'))}</h3><div class="cmp-slots">${pickers}</div>
        ${slots.length < MAX ? `<div class="row-gap">${btn('cmpAdd', '＋ ' + esc(t('cmp.add')), 'ghost small')}</div>` : ''}
        ${saved.length ? '' : `<p class="muted small">${esc(t('cmp.noSaved'))}</p>`}` +
        (rows.length ? `<h3>${esc(t('cmp.result'))}</h3><div class="table-wrap" tabindex="0"><table class="cmp-table"><thead><tr><th scope="col"><span class="sr-only">${esc(t('cmp.result'))}</span></th>${rows.map((r) => `<th scope="col">${esc(r.name)}<br><span class="muted small">${esc(r.floorName)}</span></th>`).join('')}</tr></thead><tbody>
          <tr><th scope="row">${esc(t('dash.rooms'))}</th>${rows.map((r) => `<td>${r.an.rooms.length} · ${F().num(r.an.totals.area, 0)} m²</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('dash.acUnits'))}</th>${rows.map((r) => `<td>${r.acs} · ${esc(F().btu(r.an.totals.inst))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('report.reqCool'))}</th>${rows.map((r) => `<td>${esc(F().btu(r.an.totals.req))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('report.reqHeat'))}</th>${rows.map((r) => `<td>${esc(F().btu(r.anH.totals.req))}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('year.total'))}</th>${rows.map((r) => `<td${cost(r.y.cost)}>${esc(F().money(r.y.cost, 0))} · ${F().num(r.y.kWh, 0)} kWh</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('comfort.avg'))}</th>${rows.map((r) => `<td${comf(r.comfort)}>${scoreBadge(r.comfort)}</td>`).join('')}</tr>
          <tr><th scope="row">${esc(t('dash.problemRooms'))}</th>${rows.map((r) => `<td${bad(r.bad)}>${r.bad}</td>`).join('')}</tr>
          </tbody></table></div><p class="muted small">${esc(t('cmp.note', { climate: t('climate.' + (base.climate || 'tirana')) }))}</p>` : ''));
    },
    bind(root) {
      const box = root.querySelector('#cmp-section');
      if (!box) return;
      box.addEventListener('toggle', () => {
        if (!!Airly.ui.compareOpen === box.open) return;
        Airly.ui.compareOpen = box.open;
        Airly.render();
      });
      const slots = Airly.ui.compareSlots || [];
      root.querySelectorAll('select[data-cmp]').forEach((s) => s.addEventListener('change', () => {
        const slot = slots[+s.dataset.idx];
        if (s.dataset.cmp === 'home') { slot.home = s.value; slot.floor = 'all'; } // a new home starts on "All floors"
        else slot.floor = s.value === 'all' ? 'all' : +s.value;
        Airly.render({ id: s.id });
      }));
    },
  };
})();

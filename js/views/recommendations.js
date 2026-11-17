/* Airly — Recommendations screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, TH, esc, F, field, text, btn, card, seasonTabs, badge, estimateNote, head, perfStatus, views } = Airly.kit;

  views.recommendations = {
    season: null,
    compareResult: null,
    render(el) {
      const h = S();
      const season = this.season || h.env.season;
      const recs = Airly.advisor.recommend(h, season);
      const an = Airly.advisor.analyze(h, season);
      const list = recs.map((r, i) => `<article class="rec rec-${r.severity}">
          <div class="rec-head">${badge(r.severity, t('sev.' + r.severity))}<h3>${esc(t('rec.' + r.type + '.title', r.params))}</h3></div>
          <p><strong>${esc(t('rec.why'))}</strong> ${esc(t('rec.' + r.type + '.why', r.params))}</p>
          ${r.action ? btn('applyRec', esc(t('rec.apply')), 'small', { idx: i, season }) : ''}
        </article>`).join('');
      el.innerHTML = head('nav.recommendations', 'rec.lede', seasonTabs(season, 'recSeason')) + `
        <div class="grid-2 recs-layout">
          ${card(t('rec.listTitle'), list || `<p class="muted">${esc(t('dash.noRecs'))}</p>`)}
          ${card(t('faq.title'), this.faq(an, recs, season))}
        </div>
        ${this.scenarios()}
        ${estimateNote()}`;
      this._recs = recs;
      if (this.compareResult) this.drawCompare();
    },
    faq(an, recs, season) {
      const h = S();
      const mode = season === 'heating' ? 'heat' : 'cool';
      const needs = an.rooms.filter((r) => r.perf === 'insufficient' && !r.covered);
      const under = an.rooms.filter((r) => r.cap === 'under');
      const over = an.rooms.filter((r) => r.cap === 'over');
      const moves = recs.filter((r) => r.type === 'move');
      const adds = recs.filter((r) => r.type === 'addAC');
      const names = (arr) => arr.map((r) => Airly.roomName(r.room || Airly.store.room(r.roomId))).join(', ');
      // insulation what-if for the whole home
      const reqNow = an.rooms.reduce((s, r) => s + r.req.btu, 0);
      const reqGood = h.rooms.reduce((s, r) => s + TH.required(Object.assign({}, r, { wallIns: 'good', ceilIns: 'good', floorIns: 'good' }), mode, h.env).btu, 0);
      const insPct = reqNow > 0 ? Math.round((1 - reqGood / reqNow) * 100) : 0;
      const worst = needs.slice().sort((a, b) => Math.abs(b.final - b.target) - Math.abs(a.final - a.target))[0];
      const qa = [
        ['faq.q1', h.acs.length === 0 ? t('faq.a1none') : needs.length === 0 ? t('faq.a1yes') : t('faq.a1no', { n: needs.length, rooms: names(needs) })],
        ['faq.q2', adds.length ? t('faq.a2yes', { rooms: names(adds) }) : t('faq.a2no')],
        ['faq.q3', needs.length ? names(needs) : t('faq.a3none')],
        ['faq.q4', under.length || over.length ? [under.length ? t('faq.a4under', { rooms: names(under) }) : '', over.length ? t('faq.a4over', { rooms: names(over) }) : ''].join(' ') : t('faq.a4ok')],
        ['faq.q5', worst ? t('faq.a5', { room: Airly.roomName(worst.room), size: F().btu(worst.req.size) }) : t('faq.a3none')],
        ['faq.q6', moves.length ? t('faq.a6yes', { rooms: names(moves) }) : t('faq.a6no')],
        ['faq.q7', adds.length || under.length ? [...adds.map((r) => `${Airly.roomName(Airly.store.room(r.roomId))}: ${r.params.range}`), ...under.map((r) => `${Airly.roomName(r.room)}: ${Airly.advisor.sizeRange(r.req.btu)}`)].join(' · ') : t('faq.a7none')],
        ['faq.q8', insPct >= 5 ? t('faq.a8yes', { pct: insPct }) : t('faq.a8no')],
      ];
      return `<dl class="faq">${qa.map(([q, a]) => `<dt>${esc(t(q))}</dt><dd>${esc(a)}</dd>`).join('')}</dl>`;
    },
    scenarios() {
      const h = S();
      const projects = Object.values(Airly.store.projects()).filter((p) => p.id !== h.id);
      const options = [{ v: 'current', l: t('scen.current') }]
        .concat(h.scenarios.map((s) => ({ v: 's:' + s.id, l: s.name })))
        .concat(projects.map((p) => ({ v: 'p:' + p.id, l: t('scen.project') + ': ' + (p.name || t('home.defaultName')) })));
      const a = this.cmpA || 'current';
      const b = this.cmpB || (h.scenarios[0] ? 's:' + h.scenarios[0].id : 'current');
      const optHTML = (v) => options.map((o) => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.l)}</option>`).join('');
      return card(t('scen.title'), `
        <p class="muted">${esc(t('scen.lede'))}</p>
        <div class="toolbar-inline">
          <label for="scen-name" class="sr-only">${esc(t('scen.name'))}</label>
          <input type="text" id="scen-name" placeholder="${esc(t('scen.namePh'))}">
          ${btn('saveScenario', esc(t('scen.save')), 'primary small')}
          ${btn('proposeScenario', esc(t('scen.propose')), 'small')}
        </div>
        ${h.scenarios.length ? `<ul class="scen-list">${h.scenarios.map((s) => `<li><div><strong>${esc(s.name)}</strong> <span class="muted small">${esc(t('scen.summary', { rooms: s.data.rooms.length, acs: s.data.acs.length, btu: F().btu(s.data.acs.reduce((x, a) => x + a.btu, 0)) }))}</span></div>
          <div>${btn('loadScenario', esc(t('scen.load')), 'ghost small', { id: s.id })} ${btn('deleteScenario', esc(t('common.delete')), 'danger-ghost small', { id: s.id })}</div></li>`).join('')}</ul>` : `<p class="muted small">${esc(t('scen.none'))}</p>`}
        <h3>${esc(t('scen.compare'))}</h3>
        <div class="field-row three">
          <div class="field"><label for="cmp-a">${esc(t('scen.a'))}</label><select id="cmp-a">${optHTML(a)}</select></div>
          <div class="field"><label for="cmp-b">${esc(t('scen.b'))}</label><select id="cmp-b">${optHTML(b)}</select></div>
          <div class="field align-end">${btn('compareScenarios', esc(t('scen.run')), 'primary')}</div>
        </div>
        <div id="cmp-out"></div>`);
    },
    drawCompare() {
      const out = document.getElementById('cmp-out');
      const res = this.compareResult;
      if (!out || !res) return;
      const { A, B, nameA, nameB, homeA, homeB } = res;
      const p = P();
      const allIds = Array.from(new Set(homeA.rooms.map((r) => r.id).concat(homeB.rooms.map((r) => r.id))));
      const rowFor = (id) => {
        const ra = A.an.rooms.find((r) => r.room.id === id);
        const rb = B.an.rooms.find((r) => r.room.id === id);
        const room = (ra || rb).room;
        const cell = (x) => x ? `${esc(F().temp(x.final))} <span class="muted small">${x.reached != null ? esc(F().dur(x.reached)) : esc(t('an.notReachedShort'))}</span> ${badge(...perfStatus(x))}` : '—';
        return `<tr><th scope="row">${esc(Airly.roomName(room))}</th><td>${cell(ra)}</td><td>${cell(rb)}</td></tr>`;
      };
      const tot = (x) => `${esc(F().btu(x.an.totals.inst))}`;
      out.innerHTML = `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('an.room'))}</th><th scope="col">A: ${esc(nameA)}</th><th scope="col">B: ${esc(nameB)}</th></tr></thead><tbody>
        ${allIds.map(rowFor).join('')}
        <tr class="total"><th scope="row">${esc(t('an.totalInst'))}</th><td>${tot(A)}</td><td>${tot(B)}</td></tr>
        <tr class="total"><th scope="row">${esc(t('en.daily'))}</th><td>${F().num(A.en.dailyKWh, 1)} kWh</td><td>${F().num(B.en.dailyKWh, 1)} kWh</td></tr>
        <tr class="total"><th scope="row">${esc(t('en.monthlyCost'))}</th><td>${esc(F().money(A.monthlyCost))}</td><td>${esc(F().money(B.monthlyCost))}</td></tr>
        </tbody></table></div><p class="muted small">${esc(t('scen.cmpNote', { h: p.hours, d: p.days, price: F().money(p.price, 2) }))}</p><div id="cmp-chart"></div>`;
      const avg = (an) => an.pred.times.map((_, k) => F().toU(an.pred.temps.reduce((s, arr) => s + arr[k], 0) / Math.max(1, an.pred.temps.length)));
      Airly.charts.line(out.querySelector('#cmp-chart'), {
        x: A.an.pred.times.map((s) => s / 60),
        series: [{ name: 'A: ' + nameA + ' — ' + t('scen.avgTemp'), values: avg(A.an), slot: 0 }, { name: 'B: ' + nameB + ' — ' + t('scen.avgTemp'), values: avg(B.an), slot: 1 }],
        xFmt: (v) => F().dur(v * 60), yFmt: (v) => F().num(v, 1) + '°', ariaLabel: t('scen.compare'),
      });
    },
  };
})();

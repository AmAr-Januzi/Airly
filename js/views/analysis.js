/* Airly — Temperature analysis screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, TH, esc, F, card, seasonTabs, badge, estimateNote, head, capStatus, perfStatus, views, stat, scoreBadge } = Airly.kit;


  views.analysis = {
    season: null,
    render(el) {
      const h = S();
      const season = this.season || h.env.season;
      const an = Airly.advisor.analyze(h, season);
      const live = TH.live;
      const hasLive = live.model && live.model.t > 0 && live.model.season === season;
      const rows = an.rooms.map((ra) => {
        const cur = hasLive ? live.tempOf(ra.room.id) : ra.final;
        const [ck, cl] = capStatus(ra);
        const [pk, pl] = perfStatus(ra);
        const diff = cur - ra.target;
        return `<tr><th scope="row">${esc(Airly.roomName(ra.room))}</th>
          <td>${esc(F().temp(cur))}</td><td>${esc(F().temp(ra.target))}</td><td>${esc(F().tempDelta(diff, true))}</td>
          <td>${ra.reached != null ? esc(F().dur(ra.reached)) : esc(t('an.notReached', { h: an.hours }))}</td>
          <td>${ra.inst ? esc(F().btu(ra.inst)) : esc(t('common.none'))}</td><td>${esc(F().btu(ra.req.size))} <span class="muted small">(${F().num(ra.req.W / 1000, 2)} kW)</span></td>
          <td>${badge(ck, cl)}</td><td>${badge(pk, pl)}</td><td>${Math.round(an.pred.rh[ra.i])} %</td><td>${scoreBadge(ra.comfort)}${ra.draftSeat ? ' <span class="muted small">≋ ' + esc(t('furn.' + ra.draftSeat.seat.kind)) + '</span>' : ''}</td></tr>`;
      }).join('');
      const effective = an.rooms.filter((r) => r.perf === 'effective').length;
      const insufficient = an.rooms.filter((r) => r.perf === 'insufficient').length;
      const overall = insufficient === 0 ? ['good', t('an.overallGood')] : insufficient <= an.rooms.length / 3 ? ['warning', t('an.overallPartial')] : ['critical', t('an.overallPoor')];
      el.innerHTML = head('nav.analysis', 'an.lede', seasonTabs(season, 'anSeason')) + `
        <div class="stats">
          ${stat('📐', t('an.totalReq'), F().btu(an.totals.req), F().num(an.totals.req * TH.BTU_TO_W / 1000, 1) + ' kW')}
          ${stat('❄', t('an.totalInst'), F().btu(an.totals.inst), F().num(an.totals.inst * TH.BTU_TO_W / 1000, 1) + ' kW')}
          ${stat('✓', t('an.effectiveRooms'), effective + ' / ' + an.rooms.length, t('perf.effective'))}
          ${stat('⚠', t('an.insufficientRooms'), insufficient, t('perf.insufficient'))}
        </div>
        ${card(t('an.overview'), `<p>${badge(overall[0], overall[1])} ${esc(t('an.overviewText', { season: t('season.' + season).toLowerCase(), out: F().temp(season === 'heating' ? h.env.outsideWinter : h.env.outsideSummer) }))}</p>`)}
        ${card(t('an.tableTitle'), an.rooms.length ? `<div class="table-wrap" tabindex="0"><table class="an-table"><thead><tr>
          <th scope="col">${esc(t('an.room'))}</th><th scope="col">${esc(hasLive ? t('an.currentLive') : t('an.currentPred', { h: an.hours }))}</th><th scope="col">${esc(t('an.desired'))}</th><th scope="col">${esc(t('an.diff'))}</th><th scope="col">${esc(t('an.time'))}</th>
          <th scope="col">${esc(t('an.installed'))}</th><th scope="col">${esc(t('an.required'))}</th><th scope="col">${esc(t('an.capacity'))}</th><th scope="col">${esc(t('an.performance'))}</th><th scope="col">${esc(t('sim.humidity'))}</th><th scope="col">${esc(t('comfort.score'))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">${esc(t('rooms.none'))}</p>`, 'table-card')}
        <div class="grid-2">
          ${card(t('an.chartTemp', { h: an.hours }), `<div id="an-chart-temp"></div>`)}
          ${card(t('an.chartCap'), `<div id="an-chart-cap"></div>`)}
        </div>
        ${card(t('an.method'), `<p>${esc(t('an.methodText'))}</p>`)}
        ${estimateNote()}`;
      const x = an.pred.times.map((s) => s / 60);
      Airly.charts.line(el.querySelector('#an-chart-temp'), {
        x,
        series: an.rooms.slice(0, 8).map((ra, i) => ({ name: Airly.roomName(ra.room), values: an.pred.temps[ra.i].map(F().toU), slot: i })),
        xFmt: (v) => F().dur(v * 60), yFmt: (v) => F().num(v, 1) + '°',
        refs: [{ y: F().toU(season === 'heating' ? h.env.desiredHeat : h.env.desiredCool), label: t('an.desired') }],
        empty: t('rooms.none'), ariaLabel: t('an.chartTemp', { h: an.hours }),
      });
      Airly.charts.bars(el.querySelector('#an-chart-cap'), {
        labels: an.rooms.map((ra) => Airly.roomName(ra.room)),
        series: [{ name: t('an.installed'), values: an.rooms.map((ra) => ra.inst), slot: 0 }, { name: t('an.required'), values: an.rooms.map((ra) => Math.round(ra.req.btu)), slot: 1 }],
        yFmt: (v) => F().num(v / 1000, 0) + 'k', empty: t('rooms.none'), ariaLabel: t('an.chartCap'),
      });
    },
  };
})();

/* Airly — Energy & cost screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, TH, esc, F, field, num, tnum, timeInput, sel, btn, card, badge, estimateNote, head, views, stat } = Airly.kit;

  views.energy = {
    render(el) {
      const h = S();
      const p = P();
      const cool = Airly.advisor.energy(h, 'cooling', p.hours);
      const heat = Airly.advisor.energy(h, 'heating', p.hours);
      const money = (kwh) => F().money(kwh * p.price);
      const rows = (en, mode) => en.perAC.map((x, i) => {
        const r = Airly.store.room(x.ac.roomId);
        return `<tr><th scope="row">${esc(t('ac.unit'))} ${i + 1} <span class="muted small">${esc(F().btu(x.ac.btu))} · ${esc(r ? Airly.roomName(r) : t('ac.noRoom'))}</span></th>
          <td>${F().num(x.rated, 2)} kW</td><td>${F().num(x.avgKW, 2)} kW</td><td>${F().num(x.dailyKWh, 2)} kWh</td><td>${esc(money(x.dailyKWh))}</td>
          <td>${F().num(x.dailyKWh * p.days, 1)} kWh</td><td>${esc(money(x.dailyKWh * p.days))}</td></tr>`;
      }).join('');
      const table = (en, mode) => en.perAC.length ? `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('ac.unit'))}</th><th scope="col">${esc(t('en.rated'))}</th><th scope="col">${esc(t('en.avgActual'))}</th>
        <th scope="col">${esc(t('en.daily'))}</th><th scope="col">${esc(t('en.dailyCost'))}</th><th scope="col">${esc(t('en.monthly'))}</th><th scope="col">${esc(t('en.monthlyCost'))}</th></tr></thead>
        <tbody>${rows(en, mode)}<tr class="total"><th scope="row">${esc(t('en.total'))}</th><td>${F().num(en.perAC.reduce((s, x) => s + x.rated, 0), 2)} kW</td><td>${F().num(en.dailyKWh / p.hours, 2)} kW</td>
        <td>${F().num(en.dailyKWh, 2)} kWh</td><td>${esc(money(en.dailyKWh))}</td><td>${F().num(en.dailyKWh * p.days, 1)} kWh</td><td>${esc(money(en.dailyKWh * p.days))}</td></tr></tbody></table></div>
        <p class="muted small">${esc(t('en.maxNote', { kwh: F().num(en.maxDailyKWh, 1), cost: money(en.maxDailyKWh * p.days) }))}</p>` : `<p class="muted">${esc(t('acs.none'))}</p>`;
      // sensitivity: shift all AC targets
      const season = h.env.season;
      const sens = [-2, -1, 0, 1, 2].map((dT) => {
        const h2 = Airly.clone(h);
        h2.acs.forEach((a) => (a.target += dT));
        const en = Airly.advisor.energy(h2, season, p.hours);
        return { dT, kwh: en.dailyKWh };
      });
      const base = sens[2].kwh || 1;
      // what if the AC ran this many hours a day (starting at the calculator's start time), ignoring timers
      const st0 = TH.parseHM(p.opStart || '16:00') || 16;
      const hoursSens = [4, 6, 8, 12, 16].map((hh) => ({ hh, kwh: Airly.advisor.energy(h, season, hh, h.env.dayCycle ? { forceWindow: [st0, (st0 + hh) % 24] } : null).dailyKWh }));
      el.innerHTML = head('nav.energy', 'en.lede') + `
        ${card(t('en.inputs'), `<div class="field-row four">
          ${field(t('en.price'), num('pref.price', p.price, 0, 5, 0.01), { unit: p.currency + '/kWh' })}
          ${field(t('en.hours'), num('pref.hours', p.hours, 0.5, 24, 0.5), { unit: 'h' })}
          ${field(t('en.days'), num('pref.days', p.days, 1, 31, 1))}
          ${field(t('en.opStart'), timeInput('pref.opStart', p.opStart || '16:00', t('en.opStart')), { hint: t('en.opStartHint') })}
          ${field(t('settings.currency'), sel('pref.currency', ['€', '$', '£', 'L', 'CHF'], p.currency))}
        </div><div class="row-gap">${btn('recalcEnergy', esc(t('en.recalc')), 'primary small')}</div>`)}
        <div class="stats">
          ${stat('❄', t('en.coolMonthly'), money(cool.dailyKWh * p.days), F().num(cool.dailyKWh * p.days, 0) + ' kWh · ' + t('en.perMonth'))}
          ${stat('☀', t('en.heatMonthly'), money(heat.dailyKWh * p.days), F().num(heat.dailyKWh * p.days, 0) + ' kWh · ' + t('en.perMonth'))}
          ${stat('📅', t('en.coolDaily'), money(cool.dailyKWh), F().num(cool.dailyKWh, 1) + ' kWh')}
          ${stat('📅', t('en.heatDaily'), money(heat.dailyKWh), F().num(heat.dailyKWh, 1) + ' kWh')}
        </div>
        ${card('❄ ' + t('en.coolTitle', { out: F().temp(h.env.outsideSummer) }), table(cool, 'cool'), 'table-card')}
        ${card('☀ ' + t('en.heatTitle', { out: F().temp(h.env.outsideWinter) }), table(heat, 'heat'), 'table-card')}
        <div class="grid-2">
          ${card(t('en.sensTitle', { season: t('season.' + season) }), `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('en.targetShift'))}</th><th scope="col">${esc(t('en.daily'))}</th><th scope="col">${esc(t('en.monthlyCost'))}</th><th scope="col">${esc(t('en.vsCurrent'))}</th></tr></thead><tbody>
            ${sens.map((s) => `<tr${s.dT === 0 ? ' class="total"' : ''}><th scope="row">${esc(s.dT === 0 ? '0' : F().tempDelta(s.dT, true))}</th><td>${F().num(s.kwh, 2)} kWh</td><td>${esc(money(s.kwh * p.days))}</td><td>${s.dT === 0 ? '—' : (s.kwh >= base ? '+' : '') + Math.round((s.kwh / base - 1) * 100) + '%'}</td></tr>`).join('')}
            </tbody></table></div><p class="muted small">${esc(t(season === 'heating' ? 'en.sensNoteHeat' : 'en.sensNoteCool'))}</p>`)}
          ${card(t('en.hoursTitle'), `<div id="en-hours-chart"></div>`)}
        </div>
        <div class="grid-2">${this.billCard()}${this.precoolCard()}</div>
        ${this.strategyCard(season)}
        ${this.yearCard()}
        ${card(t('en.compareTitle'), this.compareTable(season), 'table-card')}
        ${card(t('en.ratedVsActual'), `<p>${esc(t('en.ratedVsActualText'))}</p>`)}
        ${estimateNote()}`;
      Airly.charts.bars(el.querySelector('#en-hours-chart'), {
        labels: hoursSens.map((x) => x.hh + ' h'),
        series: [{ name: t('en.monthlyCost'), values: hoursSens.map((x) => x.kwh * p.days * p.price), slot: 0 }],
        yFmt: (v) => F().money(v), ariaLabel: t('en.hoursTitle'),
      });
      this.afterRender(el);
    },
    billCard() {
      const k = S().env.energyCalib || 1;
      return card(t('bill.title'), `<p class="muted small">${esc(t('bill.lede'))}</p>
        <div class="field-row">
          <div class="field"><label for="bill-kwh">${esc(t('bill.kwh'))} <span class="unit">(kWh)</span></label><input id="bill-kwh" type="number" min="1" step="1" placeholder="250"></div>
          <div class="field"><label for="bill-days">${esc(t('bill.days'))}</label><input id="bill-days" type="number" min="1" max="92" step="1" value="30"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="bill-share">${esc(t('bill.share'))} <span class="unit">(%)</span></label><input id="bill-share" type="number" min="1" max="100" step="1" value="100"><small class="hint">${esc(t('bill.shareHint'))}</small></div>
          <div class="field"><label for="bill-season">${esc(t('env.season'))}</label><select id="bill-season">${['cooling', 'heating'].map((x) => `<option value="${x}"${x === S().env.season ? ' selected' : ''}>${esc(t('season.' + x))}</option>`).join('')}</select></div>
        </div>
        <div class="row-gap">${btn('billCalibrate', esc(t('bill.run')), 'primary small')}${k !== 1 ? btn('billReset', esc(t('bill.reset')), 'ghost small') : ''}</div>
        <p class="small">${esc(k !== 1 ? t('bill.current', { k: F().num(k, 2) }) : t('bill.none'))}</p>`);
    },
    precoolCard() {
      const h = S();
      const rooms = h.rooms.filter((r) => h.acs.some((a) => a.roomId === r.id));
      if (!rooms.length) return card(t('pc.title'), `<p class="muted">${esc(t('acs.none'))}</p>`);
      const pc = Airly.ui.precool;
      const season = h.env.season;
      const tgt = pc ? pc.target : season === 'heating' ? h.env.desiredHeat : h.env.desiredCool;
      let res = '';
      if (pc && pc.res) {
        const r = pc.res;
        res = r.notNeeded
          ? `<p role="status">${badge('good', t('sev.good'))} ${esc(t('pc.notNeeded', { temp: F().temp(r.temp), arrive: F().clock(pc.arrive) }))}</p>`
          : r.reachable
          ? `<p role="status">${badge('good', t('sev.good'))} ${esc(t('pc.result', { start: F().clock(r.startH), arrive: F().clock(pc.arrive), temp: F().temp(r.temp), min: r.minutes, cost: F().money(r.kwh * P().price) }))}</p>`
          : `<p role="status">${badge('warning', t('sev.warning'))} ${esc(t('pc.unreachable', { temp: F().temp(r.temp) }))}</p>`;
      }
      return card(t('pc.title', { season: t('season.' + season).toLowerCase() }), `<p class="muted small">${esc(t('pc.lede'))}</p>
        <div class="field-row three">
          <div class="field"><label for="pc-room">${esc(t('an.room'))}</label><select id="pc-room">${rooms.map((r) => `<option value="${r.id}"${pc && pc.roomId === r.id ? ' selected' : ''}>${esc(Airly.roomName(r))}</option>`).join('')}</select></div>
          <div class="field"><label for="pc-arrive">${esc(t('pc.arrive'))}</label><input id="pc-arrive" type="time" value="${pc ? F().clock(pc.arrive) : '18:00'}"></div>
          <div class="field"><label for="pc-target">${esc(t('ac.target'))} <span class="unit">(${F().unitSym()})</span></label><input id="pc-target" type="number" step="0.5" value="${Math.round(F().toU(tgt) * 10) / 10}"></div>
        </div>
        <div class="row-gap">${btn('planPrecool', esc(t('pc.run')), 'primary small')}</div>${res}`);
    },
    strategyCard(season) {
      const h = S(), p = P();
      if (!h.acs.length) return '';
      if (!h.env.dayCycle) return card(t('strat.title'), `<p class="muted">${esc(t('strat.needCycle'))}</p>`);
      const list = Airly.advisor.strategies(h, season, p);
      const best = list.reduce((a, b) => (b.monthly < a.monthly ? b : a));
      const rows = list.map((x) => `<tr${x === best ? ' class="total"' : ''}><th scope="row">${esc(t('strat.' + x.key, { h: p.hours, start: p.opStart || '16:00' }))}</th>
        <td>${F().num(x.en.dailyKWh, 1)} kWh</td><td>${esc(F().money(x.monthly))}</td><td>${F().num(x.en.discomfort, 1)} h</td></tr>`).join('');
      const always = list[0], other = list[1];
      const verdict = always.monthly <= other.monthly ? t('strat.verdictAlways') : t('strat.verdictTimer', { pct: Math.round((1 - other.monthly / always.monthly) * 100) });
      return card(t('strat.title') + ' (' + t('season.' + season) + ')', `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('strat.strategy'))}</th><th scope="col">${esc(t('en.daily'))}</th><th scope="col">${esc(t('en.monthlyCost'))}</th><th scope="col">${esc(t('strat.discomfort'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p>${esc(verdict)}</p><p class="muted small">${esc(t('strat.note'))}</p>`, 'table-card');
    },
    yearCard() {
      const h = S(), p = P();
      const y = Airly.advisor.yearly(h, p);
      const cl = Airly.advisor.climateOf(h.env);
      const keys = Object.keys(Airly.CLIMATES).concat(['custom']);
      const months = Array.from({ length: 12 }, (_, m) => new Date(2025, m, 1).toLocaleDateString(Airly.i18n.locale(), { month: 'short' }));
      const custom = h.env.climate === 'custom' ? `<div class="table-wrap" tabindex="0"><table class="clim-table"><thead><tr><th scope="col"><span class="sr-only">${esc(t('year.climate'))}</span></th>${months.map((m) => `<th scope="col">${esc(m)}</th>`).join('')}</tr></thead><tbody>
        ${['hi', 'lo'].map((row) => `<tr><th scope="row">${esc(t('climate.' + row))}</th>${cl[row].map((v, m) => `<td>${tnum(`clim.${row}.${m}`, v, -40, 50).replace('<input', `<input aria-label="${esc(t('climate.' + row) + ' ' + months[m])}"`)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
      const rows = y.months.map((x) => `<tr><th scope="row">${esc(months[x.m])}</th><td>${esc(F().temp(x.hi))} / ${esc(F().temp(x.lo))}</td><td>${x.season ? esc(t('season.' + x.season)) : '—'}</td><td>${F().num(x.kWh, 0)} kWh</td><td>${esc(F().money(x.cost))}</td></tr>`).join('');
      return card(t('year.title'), `<div class="field-row"><div class="field"><label for="clim-sel">${esc(t('year.climate'))}</label><select id="clim-sel" data-bind="env.climate">${keys.map((k) => `<option value="${k}"${k === (h.env.climate || 'tirana') ? ' selected' : ''}>${esc(t('climate.' + k))}</option>`).join('')}</select><small class="hint">${esc(t('year.climateHint'))}</small></div></div>
        ${custom}
        <div class="stats">
          ${stat('📆', t('year.total'), F().money(y.cost), F().num(y.kWh, 0) + ' kWh / ' + t('year.perYear'))}
          ${stat('❄', t('year.cool'), F().money(y.coolKWh * p.price), F().num(y.coolKWh, 0) + ' kWh')}
          ${stat('☀', t('year.heat'), F().money(y.heatKWh * p.price), F().num(y.heatKWh, 0) + ' kWh')}
        </div>
        <div id="year-chart"></div>
        <details class="disclosure"><summary>${esc(t('year.table'))}</summary><div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('year.month'))}</th><th scope="col">${esc(t('year.hilo'))}</th><th scope="col">${esc(t('year.need'))}</th><th scope="col">${esc(t('en.monthly'))}</th><th scope="col">${esc(t('en.monthlyCost'))}</th></tr></thead><tbody>${rows}</tbody></table></div></details>
        <p class="muted small">${esc(t('year.note', { h: p.hours, d: p.days }))}</p>`);
    },
    afterRender(el) {
      const y = Airly.advisor.yearly(S(), P());
      const box = el.querySelector('#year-chart');
      if (!box) return;
      const months = Array.from({ length: 12 }, (_, m) => new Date(2025, m, 1).toLocaleDateString(Airly.i18n.locale(), { month: 'short' }));
      Airly.charts.bars(box, {
        labels: months,
        series: [
          { name: t('season.cooling'), values: y.months.map((x) => (x.season === 'cooling' ? x.cost : 0)), slot: 0 },
          { name: t('season.heating'), values: y.months.map((x) => (x.season === 'heating' ? x.cost : 0)), slot: 1 },
        ],
        yFmt: (v) => F().money(v, 0), ariaLabel: t('year.title'),
      });
    },
    compareTable(season) {
      const h = S();
      const p = P();
      const configs = [{ name: t('scen.current'), data: h }].concat(h.scenarios.map((s) => ({ name: s.name, data: Object.assign({}, h, s.data) })));
      if (configs.length < 2) return `<p class="muted">${esc(t('en.compareNone'))}</p>`;
      return `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">${esc(t('scen.config'))}</th><th scope="col">${esc(t('an.totalInst'))}</th><th scope="col">${esc(t('en.daily'))}</th><th scope="col">${esc(t('en.monthlyCost'))}</th></tr></thead><tbody>` +
        configs.map((c) => {
          const en = Airly.advisor.energy(c.data, season, p.hours);
          return `<tr><th scope="row">${esc(c.name)}</th><td>${esc(F().btu(c.data.acs.reduce((s, a) => s + a.btu, 0)))}</td><td>${F().num(en.dailyKWh, 2)} kWh</td><td>${esc(F().money(en.dailyKWh * p.days * p.price))}</td></tr>`;
        }).join('') + '</tbody></table></div>';
    },
    onFormChange() {},
  };
})();

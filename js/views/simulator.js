/* Airly — Live simulator screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, P, TH, esc, F, field, num, tnum, sel, toggle, opts, btn, card, seasonTabs, badge, estimateNote, head, views, plans, mountPlan, scheduleControl, levelTabs, speedLabel, btn3d } = Airly.kit;

  views.simulator = {
    lastChart: 0,
    render(el) {
      const h = S();
      const live = TH.live;
      if (!live.model) live.rebuild(h);
      const speeds = Airly.SIM_SPEEDS;
      // laid out like the Home Designer: one full-height box with the top bar, the plan and a side panel
      el.innerHTML = `<h1 class="sr-only">${esc(t('nav.simulator'))}</h1>
        <section class="studio card sim-studio" aria-label="${esc(t('sim.controls'))}">
          <header class="v3d-head studio-head">
            <div class="v3d-title"><h2><span aria-hidden="true">▶</span> ${esc(t('sim.barTitle', { name: h.name || t('home.defaultName') }))}</h2><p id="sim-status" class="muted small" aria-live="off"></p></div>
            <div class="v3d-tools" role="toolbar" aria-label="${esc(t('sim.controls'))}">
              <button type="button" class="btn primary" id="sim-toggle" data-action="simToggle"></button>
              ${btn('simReset', `<span aria-hidden="true">↺</span> ${esc(t('sim.reset'))}`)}
              ${btn('zoomOut', '−', 'icon', { plan: 'sim' }).replace('<button', `<button aria-label="${esc(t('plan.zoomOut'))}"`)}
              ${btn('zoomIn', '+', 'icon', { plan: 'sim' }).replace('<button', `<button aria-label="${esc(t('plan.zoomIn'))}"`)}
              ${btn('zoomFit', esc(t('v3d.resetView')), '', { plan: 'sim' })}
            </div>
          </header>
          <div class="studio-stage">
            ${btn3d()}
            <div id="sim-plan" class="plan-area"></div>
            <div class="temp-legend sim-legend" aria-label="${esc(t('legend.temp'))}"><span>${esc(t('legend.cooler'))}</span><span class="scale" aria-hidden="true"></span><span>${esc(t('legend.warmer'))}</span></div>
          </div>
          <aside class="studio-panel" aria-label="${esc(t('sim.roomDetails'))}">
            <section class="sim-sec">
              <div class="tool-group">${seasonTabs(h.env.season, 'setSeason')}</div>
              ${levelTabs(false)}
              <div class="field"><label for="sim-speed">${esc(t('sim.speed'))}</label>
                <select id="sim-speed" data-bind="pref.simSpeed" data-num="1">${speeds.map((s) => `<option value="${s}"${Math.abs(+P().simSpeed - s) < 1e-6 ? ' selected' : ''}>${esc(speedLabel(s))}</option>`).join('')}</select></div>
              <div class="row-gap">${btn('doorsAll', esc(t('sim.openDoors')), 'ghost small', { open: '1' })}${btn('doorsAll', esc(t('sim.closeDoors')), 'ghost small', { open: '0' })}</div>
              ${toggle('pref.showCoverage', P().showCoverage, t('plan.coverage'))}
              ${toggle('pref.comfortMap', P().comfortMap, t('comfort.map'))}
            </section>
            <section class="studio-sec"><div id="sim-room" aria-live="polite"></div></section>
            <section class="studio-sec"><h3>${esc(t('sim.acControls'))}</h3><div id="sim-acs">${this.acControls()}</div></section>
          </aside>
        </section>
        ${card(t('sim.chartTitle'), `<div id="sim-chart"></div>`)}
        ${estimateNote()}`;
      mountPlan('sim', el.querySelector('#sim-plan'), 'sim');
      this.tick(true);
    },
    acControls() {
      const h = S();
      if (!h.acs.length) return `<p class="muted">${esc(t('acs.none'))}</p>`;
      return h.acs.map((a, i) => {
        const r = Airly.store.room(a.roomId);
        const k = (p) => `ac.${a.id}.${p}`;
        return `<div class="sim-ac ${a.on ? '' : 'is-off'}"><div class="sim-ac-head"><strong><span class="ac-dot m-${a.on ? a.mode : 'off'}" aria-hidden="true"></span>${esc(t('ac.unit'))} ${i + 1}</strong> <span class="muted small">${esc(F().btu(a.btu))} · ${esc(r ? Airly.roomName(r) : t('ac.noRoom'))}</span>${toggle(k('on'), a.on, t('ac.power'))}</div>
          <div class="field-row">
            ${field(t('ac.mode'), sel(k('mode'), opts(Airly.AC_MODES, 'mode.'), a.mode))}
            ${field(t('ac.target'), tnum(k('target'), a.target, 16, 30), { unit: F().unitSym() })}
          </div>
          <div class="field-row">
            ${field(t('ac.fan'), sel(k('fan'), opts(Airly.FAN_SPEEDS, 'fan.'), a.fan))}
            ${field(t('ac.direction'), sel(k('direction'), opts(Airly.DIRECTIONS, 'dir.'), a.direction))}
          </div>
          ${scheduleControl(a, false)}
          <div class="sim-ac-out muted small" data-acout="${a.id}"></div></div>`;
      }).join('');
    },
    lastTick: 0,
    tick(force) {
      const live = TH.live;
      const btnEl = document.getElementById('sim-toggle');
      if (!btnEl) return;
      const nowT = performance.now();
      if (!force && live.running && nowT - this.lastTick < 120) return; // ~8 redraws per second
      this.lastTick = nowT;
      btnEl.innerHTML = live.running ? `<span aria-hidden="true">⏸</span> ${esc(t('sim.pause'))}` : `<span aria-hidden="true">▶</span> ${esc(live.model && live.model.t > 0 ? t('sim.resume') : t('sim.start'))}`;
      // status line in the top bar: time of day, day, season, outside temperature, simulated time
      const st = document.getElementById('sim-status');
      if (st) {
        const h = S();
        let clock = '';
        if (live.model) {
          const hr = live.hour();
          const day = Math.floor((live.model.clock0 * 3600 + live.model.t) / 86400) + 1;
          const wd = Airly.kit.dayNames()[TH.weekdayOf(live.model)];
          clock = (TH.sunAt(live.model.season, hr).e > 0 ? '☀ ' : '☾ ') + wd + ' ' + F().clock(hr) + ' · ' + t('sim.day', { n: day }) + ' · ';
        }
        st.textContent = `${clock}${t('season.' + h.env.season)} · ${t('dash.outside')} ${F().temp(live.model ? live.outside() : TH.seasonOutside(h.env))} · ${t('sim.elapsed')} ${F().dur(live.model ? live.model.t : 0)}`;
      }
      if (plans.sim) plans.sim.render();
      this.roomPanel();
      if (live.model) {
        live.model.acs.forEach((a) => {
          const o = document.querySelector(`[data-acout="${a.id}"]`);
          if (!o) return;
          o.textContent = a.scheduledOff
            ? t('sim.acTimerOff')
            : (a.nightActive ? t('sched.nightActive') + ' · ' : '') + (a.activeStarting
            ? t('sim.acStarting')
            : a.activeMode
            ? t('sim.acOutput', { pct: Math.round(a.frac * 100), kw: F().num(a.powerKW, 2), mode: t('mode.' + a.activeMode) })
            : a.on ? t('sim.acIdle') : t('ac.off'));
        });
      }
      const now = performance.now();
      if (force || now - this.lastChart > 700) {
        this.lastChart = now;
        this.chart();
      }
    },
    roomPanel() {
      const box = document.getElementById('sim-room');
      if (!box) return;
      const s = Airly.ui.sel;
      const live = TH.live;
      const h = S();
      const room = s && s.kind === 'room' ? Airly.store.room(s.id) : null;
      if (!room) {
        box.innerHTML = `<h2>${esc(t('sim.roomDetails'))}</h2><p class="muted">${esc(t('sim.pickRoom'))}</p>`;
        return;
      }
      const T = live.tempOf(room.id);
      const target = TH.desiredFor(h, room);
      const mr = live.model && live.model.rooms.find((x) => x.id === room.id);
      const d = T - target;
      const state = Math.abs(d) <= 0.5 ? ['good', t('sim.atTarget')] : d > 0 ? ['warning', t('sim.warmer', { d: F().tempDelta(d) })] : ['info', t('sim.cooler', { d: F().tempDelta(-d) })];
      box.innerHTML = `<h2>${esc(Airly.roomName(room))}</h2>
        <div class="big-temp">${esc(F().temp(T))}</div>
        <p>${badge(state[0], state[1])}</p>
        <dl class="kv"><dt>${esc(t('an.desired'))}</dt><dd>${esc(F().temp(target))}</dd>
        <dt>${esc(t('sim.acPower'))}</dt><dd>${mr ? F().num(Math.abs(mr.acW) / 1000, 2) + ' kW ' + (mr.acW < 0 ? '❄' : mr.acW > 0 ? '☀' : '') : '—'}</dd>
        <dt>${esc(t('sim.humidity'))}</dt><dd>${live.rhOf(room.id) != null ? Math.round(live.rhOf(room.id)) + ' %' : '—'}</dd>
        <dt>${esc(t('room.volume'))}</dt><dd>${F().num(TH.geometry(room).volume, 1)} m³</dd></dl>`;
    },
    chart() {
      const box = document.getElementById('sim-chart');
      if (!box) return;
      const live = TH.live;
      const h = S();
      const hist = live.history;
      const x = hist.times.map((s) => s / 60);
      Airly.charts.line(box, {
        x,
        series: h.rooms.slice(0, 8).map((r, i) => ({ name: Airly.roomName(r), values: (hist.temps[r.id] || []).map(F().toU), slot: i })).filter((s) => s.values.length === x.length),
        xFmt: (v) => F().dur(v * 60),
        yFmt: (v) => F().num(v, 1) + '°',
        empty: t('sim.chartEmpty'),
        ariaLabel: t('sim.chartTitle'),
      });
    },
    onFormChange() { this.tick(true); },
    onSelect() { this.tick(true); },
  };
})();

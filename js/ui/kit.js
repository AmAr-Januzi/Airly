/* Airly — UI kit: small HTML helpers and status labels shared by all screens (js/views/*.js) */
(function () {
  'use strict';
  const Airly = window.Airly;
  const t = (k, p) => Airly.i18n.t(k, p);
  const S = () => Airly.store.state;
  const P = () => Airly.store.prefs;
  const TH = Airly.thermal;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  Airly.esc = esc;
  const F = () => Airly.fmt;

  /* ---------- small HTML helpers ---------- */
  let fid = 0;
  function field(label, control, opts) {
    opts = opts || {};
    const id = 'f' + ++fid;
    control = control.replace('<input', `<input id="${id}"`).replace('<select', `<select id="${id}"`);
    return `<div class="field${opts.cls ? ' ' + opts.cls : ''}"><label for="${id}">${esc(label)}${opts.unit ? ` <span class="unit">(${esc(opts.unit)})</span>` : ''}</label>${control}${opts.hint ? `<small class="hint">${esc(opts.hint)}</small>` : ''}</div>`;
  }
  function num(bind, value, min, max, step) {
    return `<input type="number" inputmode="decimal" data-bind="${bind}" value="${value == null ? '' : value}"${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''} step="${step || 'any'}">`;
  }
  /* temperature input: stored in °C, shown/edited in the chosen unit */
  function tnum(bind, valueC, minC, maxC) {
    const f = F();
    const show = (c) => Math.round(f.toU(c) * 10) / 10;
    const val = valueC == null || valueC === '' ? '' : show(+valueC);
    return `<input type="number" inputmode="decimal" data-bind="${bind}" data-temp="1" value="${val}" min="${Math.floor(f.toU(minC))}" max="${Math.ceil(f.toU(maxC))}" step="${f.isF() ? 1 : 0.5}">`;
  }
  function timeInput(bind, value, label) {
    return `<input type="time" data-bind="${bind}" value="${esc(value || '')}" aria-label="${esc(label)}">`;
  }
  function text(bind, value, extra) {
    return `<input type="text" data-bind="${bind}" value="${esc(value)}" ${extra || ''}>`;
  }
  function sel(bind, options, value, isNum) {
    return `<select data-bind="${bind}"${isNum ? ' data-num="1"' : ''}>` + options.map((o) => {
      const v = typeof o === 'object' ? o.v : o;
      const l = typeof o === 'object' ? o.l : o;
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('') + '</select>';
  }
  function check(bind, value, label) {
    return `<label class="check"><input type="checkbox" data-bind="${bind}"${value ? ' checked' : ''}> <span>${esc(label)}</span></label>`;
  }
  function toggle(bind, value, label) {
    return `<label class="switch"><input type="checkbox" role="switch" data-bind="${bind}"${value ? ' checked' : ''}><span class="track" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
  }
  const opts = (list, prefix) => list.map((v) => ({ v, l: t(prefix + v) }));
  function btn(action, label, cls, data) {
    const d = data ? Object.keys(data).map((k) => ` data-${k}="${esc(data[k])}"`).join('') : '';
    return `<button type="button" class="btn ${cls || ''}" data-action="${action}"${d}>${label}</button>`;
  }
  function card(title, body, cls, extraHead) {
    return `<section class="card ${cls || ''}">${title ? `<header class="card-head"><h2>${esc(title)}</h2>${extraHead || ''}</header>` : ''}<div class="card-body">${body}</div></section>`;
  }
  function seasonTabs(current, action) {
    return `<div class="segmented" role="group" aria-label="${esc(t('env.season'))}">` + ['cooling', 'heating'].map((s) =>
      `<button type="button" class="seg ${s === current ? 'active' : ''}" aria-pressed="${s === current}" data-action="${action}" data-season="${s}"><span aria-hidden="true">${s === 'cooling' ? '❄' : '☀'}</span> ${esc(t('season.' + s))}</button>`).join('') + '</div>';
  }
  function badge(kind, label) {
    const icon = { good: '✓', warning: '!', critical: '✕', info: 'i', serious: '!' }[kind] || '';
    return `<span class="badge b-${kind}"><span aria-hidden="true">${icon}</span> ${esc(label)}</span>`;
  }
  function estimateNote() {
    return `<p class="estimate-note" role="note"><span aria-hidden="true">ⓘ</span> ${esc(t('common.estimateNote'))}</p>`;
  }
  function head(titleKey, subKey, extra) {
    return `<div class="view-head"><div><h1>${esc(t(titleKey))}</h1>${subKey ? `<p class="lede">${esc(t(subKey))}</p>` : ''}</div>${extra ? `<div class="view-head-actions">${extra}</div>` : ''}</div>`;
  }
  function roomOptions(withNone) {
    const o = S().rooms.map((r) => ({ v: r.id, l: Airly.roomName(r) }));
    if (withNone) o.unshift({ v: '', l: t('ac.noRoom') });
    return o;
  }
  const capStatus = (ra) => ({
    none: ['critical', t('cap.none')],
    under: ['warning', t('cap.under')],
    over: ['info', t('cap.over')],
    ok: ['good', t('cap.ok')],
  }[ra.covered ? 'covered' : ra.cap] || ['good', t('cap.covered')]);
  const perfStatus = (ra) => ({
    effective: ['good', t('perf.effective')],
    slow: ['warning', t('perf.slow')],
    insufficient: ['critical', t('perf.insufficient')],
  }[ra.perf]);
  const views = {};
  Airly.views = views;
  const plans = {};
  Airly.plans = plans;

  function mountPlan(key, host, mode) {
    let p = plans[key];
    if (!p || !host.contains(p.svg)) {
      const oldVB = p && key !== 'dash' ? p.vb : null;
      p = plans[key] = new Airly.FloorPlan(host, mode);
      if (oldVB) { p.vb = oldVB; p.applyVB(); }
    }
    p.render();
    return p;
  }

  function stat(icon, label, value, note) {
    return `<div class="stat card"><span class="stat-icon" aria-hidden="true">${icon}</span><div><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${note ? `<div class="stat-note">${esc(note)}</div>` : ''}</div></div>`;
  }
  function wallSelect(id) {
    const cur = Airly.ui.opWall || 'auto';
    return `<select id="${id}" class="wall-pick">` + ['auto'].concat(Airly.WALLS).map((w) =>
      `<option value="${w}"${w === cur ? ' selected' : ''}>${esc(w === 'auto' ? t('op.autoWall') : t('wall.' + w))}</option>`).join('') + '</select>';
  }
  function scheduleControl(a, compact) {
    const sch = a.schedule || { enabled: false, periods: [] };
    const k = (p) => `ac.${a.id}.${p}`;
    const periods = (sch.periods || []).map((p, i) => `<div class="period"><span class="muted small">${esc(t('sched.from'))}</span>${timeInput(`sched.${a.id}.${i}.on`, p.on, t('sched.on'))}<span class="muted small">${esc(t('sched.to'))}</span>${timeInput(`sched.${a.id}.${i}.off`, p.off, t('sched.off'))}${sch.periods.length > 1 ? btn('removePeriod', '✕', 'icon small danger-ghost', { id: a.id, idx: i }).replace('<button', `<button aria-label="${esc(t('common.remove'))}"`) : ''}</div>`).join('');
    if (compact) {
      const summary = sch.enabled ? (sch.periods || []).map((p) => p.on + '–' + p.off).join(', ') : t('sched.none');
      return `<div class="sched-compact">${toggle(k('schedEnabled'), sch.enabled, t('sched.timer'))}<span class="muted small">${esc(summary)}</span>${toggle(k('sleep'), !!a.sleep, t('sched.night'))}</div>`;
    }
    return `<fieldset class="sched"><legend>${esc(t('sched.title'))}</legend>
      ${toggle(k('schedEnabled'), sch.enabled, t('sched.timer'))}
      <div class="periods${sch.enabled ? '' : ' is-off'}">${periods}${btn('addPeriod', '＋ ' + esc(t('sched.add')), 'ghost small', { id: a.id })}</div>
      ${toggle(k('sleep'), !!a.sleep, t('sched.night'))}<small class="hint">${esc(t('sched.nightHint'))}</small></fieldset>`;
  }
  function levelTabs(withEdit) {
    const h = S();
    const n = h.levels || 1;
    if (n < 2 && !withEdit) return '';
    const cur = Airly.ui.level || 0;
    let out = `<div class="segmented" role="group" aria-label="${esc(t('level.title'))}">` + Array.from({ length: n }, (_, k) =>
      `<button type="button" class="seg ${k === cur ? 'active' : ''}" aria-pressed="${k === cur}" data-action="setLevel" data-level="${k}">${esc(Airly.levelName(k))}</button>`).join('') + '</div>';
    if (withEdit) out += btn('addLevel', '＋ ' + esc(t('level.add')), 'ghost small') + (n > 1 ? btn('removeLevel', esc(t('level.remove')), 'danger-ghost small') : '');
    return `<div class="tool-group">${out}</div>`;
  }
  function speedLabel(s) {
    return s < 1 ? t('sim.realtime') : t('sim.speedOpt', { n: s });
  }
  function orientControl(a) {
    const cur = a.orient === 'v' ? 'v' : 'h';
    return `<div class="field"><span class="label" id="or-${a.id}">${esc(t('ac.orient'))}</span><div class="orient-row"><div class="segmented" role="group" aria-labelledby="or-${a.id}">` +
      ['h', 'v'].map((o) => `<button type="button" class="seg ${o === cur ? 'active' : ''}" aria-pressed="${o === cur}" data-action="acOrient" data-id="${a.id}" data-orient="${o}"><span aria-hidden="true">${o === 'h' ? '▭' : '▯'}</span> ${esc(t('orient.' + o))}</button>`).join('') +
      `</div>${btn('acRotate', '<span aria-hidden="true">⟳</span> ' + esc(t('ac.rotate')), 'ghost small', { id: a.id })}</div><small class="hint">${esc(t('ac.orientHint'))}</small></div>`;
  }
  const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.8 20 7.2v9.6L12 21.2 4 16.8V7.2z"/><path d="M4 7.2 12 11.6 20 7.2M12 11.6v9.6"/></svg>';
  function btn3d() {
    return `<button type="button" class="btn plan-3d-btn" data-action="open3d" title="${esc(t('v3d.open'))}">${CUBE}<span>3D</span><span class="sr-only"> — ${esc(t('v3d.open'))}</span></button>`;
  }
  function scoreBadge(n) {
    if (n == null) return '—';
    return badge(n >= 80 ? 'good' : n >= 55 ? 'warning' : 'critical', n + '/100');
  }
  function capOptions(current) {
    const list = Airly.STANDARD_BTU.slice();
    if (!list.includes(+current)) list.push(+current);
    return list.sort((a, b) => a - b).map((v) => ({ v, l: F().btu(v) }));
  }
  function updateCalc() {
    S().rooms.forEach((r) => {
      const g = TH.geometry(r);
      document.querySelectorAll(`[data-calc="area-${r.id}"]`).forEach((e) => (e.textContent = F().num(g.area, 2) + ' m²'));
      document.querySelectorAll(`[data-calc="vol-${r.id}"]`).forEach((e) => (e.textContent = F().num(g.volume, 2) + ' m³'));
    });
  }

  Airly.kit = { t, S, P, TH, esc, F, field, num, tnum, timeInput, text, sel, check, toggle, opts, btn, card, seasonTabs, badge, estimateNote, head, roomOptions, capStatus, perfStatus, views, plans, mountPlan, stat, wallSelect, scheduleControl, levelTabs, speedLabel, orientControl, CUBE, btn3d, scoreBadge, capOptions, updateCalc };
})();

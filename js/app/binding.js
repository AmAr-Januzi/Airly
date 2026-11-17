/* Airly — two-way data binding: form fields with data-bind="scope.id.prop" write straight into the home */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const TH = Airly.thermal;
  const t = (k, p) => Airly.i18n.t(k, p);
  const ui = Airly.ui;
  const { toast, render } = Airly;
  const { applyTheme, applyStatic, notifyDue } = Airly.app;

  /* ---------- Data binding ---------- */
  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') {
      if (el.value === '') return '';
      let v = parseFloat(el.value);
      if (isNaN(v)) return undefined;
      if (el.min !== '') v = Math.max(+el.min, v);
      if (el.max !== '') v = Math.min(+el.max, v);
      return v;
    }
    if (el.dataset.num) return +el.value;
    return el.value;
  }
  const NULLABLE = ['initialTemp', 'powerKW'];
  function applyBind(el) {
    const path = el.dataset.bind.split('.');
    let v = readValue(el);
    if (v === undefined) return false;
    // temperature inputs are shown in the chosen unit but stored in °C
    if (el.dataset.temp && typeof v === 'number') v = Math.round(Airly.fmt.fromU(v) * 100) / 100;
    if (el.dataset.tdelta && typeof v === 'number' && Airly.fmt.isF()) v = Math.round((v / 1.8) * 100) / 100;
    const h = store.state;
    const scope = path[0];
    if (scope === 'home') { h.name = String(v).slice(0, 60); return 'form'; }
    if (scope === 'env') { if (v === '') return false; h.env[path[1]] = v; return 'form'; }
    if (scope === 'pref') {
      const k = path[1];
      if (v === '') return false;
      store.prefs[k] = v;
      store.savePrefs();
      if (k === 'lang') { Airly.i18n.setLang(v); return 'lang'; }
      if (k === 'theme') { applyTheme(); return 'rerender'; }
      if (k === 'notify' && v) {
        if (!('Notification' in window)) { store.prefs.notify = false; store.savePrefs(); toast(t('remind.unsupported'), 'bad'); return 'rerender'; }
        Notification.requestPermission().then((res) => {
          if (res !== 'granted') { store.prefs.notify = false; store.savePrefs(); toast(t('remind.denied'), 'bad'); render(); }
          else { store.prefs.lastNotified = null; notifyDue(); toast(t('remind.enabled'), 'good'); }
        });
        return 'rerender';
      }
      return 'pref';
    }
    if (scope === 'maint') { h.maintenance.checks[path[1]] = v; return 'form'; }
    if (scope === 'furn') {
      const f = (h.furniture || []).find((x) => x.id === path[1]);
      if (!f || v === '') return false;
      if (path[2] === 'kind') {
        // switching type takes that type's typical size (keeping the rotation)
        const c = Airly.FURNITURE[v];
        if (!c) return false;
        f.kind = v;
        const turned = f.rot === 90 || f.rot === 270;
        f.w = turned ? c.d : c.w; f.d = turned ? c.w : c.d; f.h = c.h;
      } else f[path[2]] = v;
      return 'form';
    }
    if (scope === 'trace') {
      const tr = h.trace;
      if (!tr || v === '') return false;
      tr[path[1]] = v;
      if (path[1] === 'w') tr.h = Math.round(v * tr.aspect * 100) / 100;
      return 'form';
    }
    if (scope === 'sched') {
      const a = store.ac(path[1]);
      const p = a && a.schedule && a.schedule.periods[+path[2]];
      if (!p || !v) return false;
      p[path[3]] = v;
      return 'form';
    }
    if (scope === 'clim') {
      if (!h.env.customClimate) h.env.customClimate = Airly.clone(Airly.advisor.climateOf(Object.assign({}, h.env, { climate: 'tirana' })));
      if (v === '') return false;
      h.env.customClimate[path[1]][+path[2]] = v;
      return 'form';
    }
    if (scope === 'buy') {
      const cfg = ui.purchaseCfg();
      if (path[1] === 'roomId') cfg.roomId = v;
      else if (path[1] === 'replace') cfg.replace = v;
      else {
        if (v === '' && path[2] === 'powerKW') v = null;
        else if (v === '') return false;
        cfg[path[1]][path[2]] = v;
      }
      return 'form';
    }
    if (scope === 'room') {
      const r = store.room(path[1]);
      if (!r) return false;
      const k = path[2];
      if (v === '') { if (NULLABLE.includes(k)) v = null; else return false; }
      r[k] = typeof r[k] === 'number' && typeof v === 'string' && k !== 'name' ? +v : v;
      if (k === 'length' || k === 'width') ui.clampRoomContents(r);
      if (k === 'exteriorWalls') r[k] = Math.round(r[k]);
      if (k === 'people') r[k] = Math.round(r[k]);
      return 'form';
    }
    if (scope === 'op') {
      const r = store.room(path[1]);
      const o = r && r[path[2]].find((x) => x.id === path[3]);
      if (!o) return false;
      if (v === '') return false;
      const prevWall = o.wall;
      o[path[4]] = v;
      if (path[4] === 'wall' && v !== prevWall) {
        o.w = Math.min(o.w, TH.wallLength(r, v));
        o.offset = ui.freeOffset(r, v, o.w, o.id);
      }
      ui.clampRoomContents(r);
      return 'form';
    }
    if (scope === 'ac') {
      const a = store.ac(path[1]);
      if (!a) return false;
      const k = path[2];
      if (v === '') { if (NULLABLE.includes(k)) v = null; else return false; }
      if (k === 'schedEnabled') {
        a.schedule = a.schedule || { enabled: false, periods: [{ on: '17:00', off: '23:00' }] };
        a.schedule.enabled = !!v;
        return 'form';
      }
      if (k === 'roomId') {
        a.roomId = v || null;
        const r = store.room(a.roomId);
        if (r) { a.x = r.x + r.length / 2; a.y = r.y + 0.25; }
      } else a[k] = v;
      return 'form';
    }
    return false;
  }

  // keep ACs travelling with their room when x/y are typed
  let roomPosCache = {};
  function syncRoomMoves() {
    const h = store.state;
    h.rooms.forEach((r) => {
      const c = roomPosCache[r.id];
      if (c && (c.x !== r.x || c.y !== r.y)) {
        h.acs.filter((a) => a.roomId === r.id).forEach((a) => { a.x += r.x - c.x; a.y += r.y - c.y; });
      }
      roomPosCache[r.id] = { x: r.x, y: r.y };
    });
  }

  function refreshRoomCache() {
    roomPosCache = {};
    store.state.rooms.forEach((r) => (roomPosCache[r.id] = { x: r.x, y: r.y }));
  }

  let deferred = null;
  function onInput(ev) {
    const el = ev.target;
    if (!el.dataset || !el.dataset.bind) return;
    const structural = el.tagName === 'SELECT' || el.type === 'checkbox';
    if (ev.type === 'input' && structural) return; // handled on change
    if (ev.type === 'change' && !structural) {
      // text/number committed: refresh dependent numbers after focus has moved on
      clearTimeout(deferred);
      deferred = setTimeout(() => render(), 0);
      return;
    }
    const res = applyBind(el);
    if (!res) return;
    syncRoomMoves();
    if (res === 'lang') { store.commit('lang'); render(); return; }
    if (res === 'rerender' || structural) { store.commit('struct'); render(); return; }
    store.commit('form');
    const v = Airly.views[ui.view];
    if (v.onFormChange) v.onFormChange(el);
    if (el.dataset.bind === 'home.name') applyStatic();
  }

  Object.assign(Airly.app, { onInput, refreshRoomCache });
})();

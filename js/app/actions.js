/* Airly — actions: every button with data-action="name" runs actions.name(dataset) */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const TH = Airly.thermal;
  const t = (k, p) => Airly.i18n.t(k, p);
  const esc = (s) => Airly.esc(s);
  const ui = Airly.ui;
  const { toast, render } = Airly;
  const { applyTheme, DAY } = Airly.app;

  /* ---------- Actions ---------- */
  const ROOM_DIMS = { living: [5, 4], bedroom: [4, 3.5], kitchen: [3.5, 3], bathroom: [2.5, 2], hallway: [4, 1.4], office: [3, 3], dining: [4, 3.5], custom: [4, 4] };
  function targetRoom() {
    const s = ui.sel;
    const h = store.state;
    if (s && s.kind === 'room') return store.room(s.id);
    if (s && s.kind === 'opening') return store.room(s.roomId);
    if (s && s.kind === 'ac') { const a = store.ac(s.id); return a ? store.room(a.roomId) : null; }
    return store.room(ui.roomId) || h.rooms[0] || null;
  }
  function addRoom(type) {
    const h = store.state;
    const [L, W] = ROOM_DIMS[type] || [4, 4];
    let x = 0, y = 0;
    const same = h.rooms.filter((r) => (r.level || 0) === (ui.level || 0));
    const below = h.rooms.filter((r) => (r.level || 0) === (ui.level || 0) - 1);
    if (same.length) {
      x = Math.max(...same.map((r) => r.x + r.length));
      y = Math.min(...same.map((r) => r.y));
    } else if (below.length) {
      x = Math.min(...below.map((r) => r.x));
      y = Math.min(...below.map((r) => r.y));
    }
    const r = Airly.factory.defaultRoom(type, x, y, L, W);
    r.exteriorWalls = 2;
    r.level = ui.level || 0;
    if (h.levels > 1) r.floorLevel = r.level === 0 ? 'ground' : r.level === h.levels - 1 ? 'top' : 'middle';
    h.rooms.push(r);
    if (type === 'bathroom') Airly.factory.furnishBathroom(h, r); // a new bathroom comes furnished
    ui.sel = { kind: 'room', id: r.id };
    ui.roomId = r.id;
    store.commit('add');
    if (Airly.plans.designer && ui.view === 'designer') Airly.plans.designer.fit();
    toast(t('toast.roomAdded', { room: Airly.roomName(r) }));
    return r;
  }
  /* Pick a wall automatically: doors on walls shared with another room, windows on exterior walls */
  function autoWall(r, kind) {
    const links = TH.adjacency(store.state).filter((l) => l.a === r.id || l.b === r.id);
    const shared = {};
    Airly.WALLS.forEach((w) => (shared[w] = 0));
    links.forEach((l) => (shared[l.a === r.id ? l.sideA : l.sideB] += l.len));
    const used = (w) => r.windows.concat(r.doors).filter((x) => x.wall === w).reduce((s, x) => s + x.w, 0);
    const score = (w) => {
      const L = TH.wallLength(r, w);
      const share = shared[w] / L; // 0 = exterior, 1 = fully interior
      const fit = kind === 'door' ? share : 1 - share;
      return fit * 10 + (L - used(w)) / L; // prefer the right kind of wall, then the emptiest
    };
    return Airly.WALLS.slice().sort((a, b) => score(b) - score(a))[0];
  }
  /* Free position on a wall, as close to the middle as possible */
  function freeOffset(r, wall, w, skipId) {
    const L = TH.wallLength(r, wall);
    const taken = r.windows.concat(r.doors).filter((x) => x.wall === wall && x.id !== skipId);
    const mid = (L - w) / 2;
    let best = null;
    for (let off = 0; off <= L - w + 1e-9; off += 0.1) {
      const clash = taken.some((x) => off < x.offset + x.w + 0.2 && off + w > x.offset - 0.2);
      if (!clash && (best === null || Math.abs(off - mid) < Math.abs(best - mid))) best = off;
    }
    return Math.round((best === null ? Math.max(0, mid) : best) * 10) / 10;
  }
  Airly.ui.freeOffset = freeOffset;
  function addOpening(r, kind, wallChoice) {
    const list = kind === 'door' ? r.doors : r.windows;
    const wall = Airly.WALLS.includes(wallChoice) ? wallChoice : autoWall(r, kind);
    const o = Airly.factory.defaultOpening(kind, wall);
    const L = TH.wallLength(r, wall);
    o.w = Math.min(o.w, L);
    o.offset = freeOffset(r, wall, o.w);
    list.push(o);
    return o;
  }
  const wallPick = (id) => { const el = document.getElementById(id); if (el) ui.opWall = el.value; return el ? el.value : 'auto'; };
  function addAC(r, btu, pos) {
    const h = store.state;
    const req = TH.required(r, h.env.season === 'heating' ? 'heat' : 'cool', h.env);
    const a = Airly.factory.defaultAC(r.id, pos ? pos.x : r.x + r.length / 2, pos ? pos.y : r.y + 0.25, btu || req.size);
    if (pos && pos.orient) a.orient = pos.orient;
    a.mode = h.env.season === 'heating' ? 'heat' : 'cool';
    a.target = h.env.season === 'heating' ? 21 : 22;
    a.model = 'Split ' + Math.round(a.btu / 1000) + 'K';
    h.acs.push(a);
    ui.sel = { kind: 'ac', id: a.id };
    ui.acId = a.id;
    store.commit('add');
    toast(t('toast.acAdded', { room: Airly.roomName(r) }));
    return a;
  }
  function scenarioData(h) {
    return Airly.clone({ rooms: h.rooms, acs: h.acs, walls: h.walls, env: h.env });
  }
  function homeFor(val) {
    const h = store.state;
    if (val === 'current') return { home: h, name: t('scen.current') };
    if (val.startsWith('s:')) {
      const s = h.scenarios.find((x) => x.id === val.slice(2));
      if (s) return { home: Object.assign({}, Airly.clone(h), Airly.clone(s.data)), name: s.name };
    }
    if (val.startsWith('p:')) {
      const p = store.projects()[val.slice(2)];
      if (p) return { home: Airly.factory.normalizeHome(p.data), name: p.name || t('home.defaultName') };
    }
    return { home: h, name: t('scen.current') };
  }
  function runCompare(a, b) {
    const V = Airly.views.recommendations;
    V.cmpA = a; V.cmpB = b;
    const A = homeFor(a), B = homeFor(b);
    const season = V.season || store.state.env.season;
    const res = Airly.advisor.compare(A.home, B.home, season, store.prefs);
    V.compareResult = Object.assign(res, { nameA: A.name, nameB: B.name, homeA: A.home, homeB: B.home });
    V.drawCompare();
  }

  const actions = {
    go: (d) => (location.hash = '#' + d.view),
    setSeason: async (d) => {
      const h = store.state;
      if (h.env.season === d.season) return;
      h.env.season = d.season;
      const mode = d.season === 'heating' ? 'heat' : 'cool';
      const other = d.season === 'heating' ? 'cool' : 'heat';
      const flip = h.acs.filter((a) => a.mode === other);
      if (flip.length && await Airly.confirmDialog({
        icon: mode === 'heat' ? '☀' : '❄',
        title: t('confirm.switchTitle', { mode: t('mode.' + mode) }),
        message: t('confirm.switchText', { n: flip.length, from: t('mode.' + other), mode: t('mode.' + mode) }),
        ok: t('confirm.switchYes', { mode: t('mode.' + mode) }),
        cancel: t('confirm.switchNo'),
      })) {
        flip.forEach((a) => { a.mode = mode; a.target = mode === 'heat' ? h.env.desiredHeat : Math.min(a.target, h.env.desiredCool); });
      }
      Airly.views.recommendations.season = null;
      Airly.views.recommendations.page = 0;
      Airly.views.recommendations.compareResult = null;
      TH.live.reset(h);
      store.commit('season');
      render();
    },
    careTab: (d) => { Airly.views.care.tab = d.tab; render(); const b = document.getElementById('ctab-' + d.tab); if (b) b.focus(); },
    pickAvatar: () => { const f = document.getElementById('avatar-file'); if (f) f.click(); },
    removeAvatar: () => { store.prefs.avatar = ''; store.savePrefs(); Airly.updateAvatar(); render(); toast(t('profile.removed')); },
    ecoTab: (d) => { Airly.views.eco.tab = d.tab; render(); const b = document.getElementById('etab-' + d.tab); if (b) b.focus(); },
    recSeason: (d) => { Airly.views.recommendations.season = d.season; Airly.views.recommendations.page = 0; Airly.views.recommendations.compareResult = null; render(); },
    recPage: (d) => {
      Airly.views.recommendations.page = +d.page;
      render();
      // keep the list in view and the keyboard on the pager
      const box = document.querySelector('.recs-layout');
      if (box) box.scrollIntoView({ block: 'nearest' });
      const cur = document.querySelector('.pager-num.active');
      if (cur) cur.focus({ preventScroll: true });
    },
    addRoom: () => { addRoom(document.getElementById('new-room-type').value); render(); },
    addRoomQuick: () => { const r = addRoom('custom'); ui.roomId = r.id; render(); },
    addDoor: () => {
      const r = targetRoom();
      if (!r) return toast(t('toast.needRoom'));
      const o = addOpening(r, 'door', wallPick('new-op-wall'));
      ui.sel = { kind: 'opening', id: o.id, roomId: r.id, type: 'door' };
      store.commit('add'); render();
    },
    addWindow: () => {
      const r = targetRoom();
      if (!r) return toast(t('toast.needRoom'));
      const o = addOpening(r, 'window', wallPick('new-op-wall'));
      ui.sel = { kind: 'opening', id: o.id, roomId: r.id, type: 'window' };
      store.commit('add'); render();
    },
    addOpening: (d) => {
      const r = store.room(d.room);
      if (!r) return;
      addOpening(r, d.type === 'doors' ? 'door' : 'window', wallPick(d.select));
      store.commit('add'); render();
    },
    removeOpening: (d) => {
      const r = store.room(d.room);
      if (!r) return;
      r[d.type] = r[d.type].filter((o) => o.id !== d.id);
      store.commit('delete'); render();
    },
    addWall: () => {
      const p = Airly.plans.designer;
      const cx = p ? Math.round(p.vb.x + p.vb.w / 2) : 2, cy = p ? Math.round(p.vb.y + p.vb.h / 2) : 2;
      const w = { id: Airly.uid(), x1: cx - 1, y1: cy, x2: cx + 1, y2: cy, level: ui.level || 0 };
      store.state.walls.push(w);
      ui.sel = { kind: 'wall', id: w.id };
      store.commit('add'); render();
    },
    addACHere: () => {
      const r = targetRoom();
      if (!r) return toast(t('toast.needRoom'));
      addAC(r); render();
    },
    addAC: () => {
      const r = store.room(document.getElementById('new-ac-room').value) || store.state.rooms[0];
      if (!r) return toast(t('toast.needRoom'));
      addAC(r, +document.getElementById('new-ac-btu').value); render();
    },
    duplicateAC: (d) => {
      const a = store.ac(d.id);
      if (!a) return;
      const c = Object.assign(Airly.clone(a), { id: Airly.uid(), x: a.x + 0.6 });
      store.state.acs.push(c);
      store.commit('add'); render();
    },
    removeAC: (d) => {
      if (!confirm(t('confirm.removeAC'))) return;
      store.state.acs = store.state.acs.filter((a) => a.id !== d.id);
      store.commit('delete'); render();
    },
    acOrient: (d) => {
      const a = store.ac(d.id);
      if (!a || a.orient === d.orient) return;
      a.orient = d.orient;
      store.commit('struct'); render();
    },
    acRotate: (d) => ui.rotateAC(d.id),
    addFurniture: () => {
      const h = store.state;
      const kind = (document.getElementById('new-furn') || {}).value || 'sofa';
      const lv = ui.level || 0;
      const r = (ui.sel && ui.sel.kind === 'room' && store.room(ui.sel.id)) || h.rooms.find((x) => (x.level || 0) === lv);
      const f = Airly.factory.defaultFurniture(kind, 0, 0, lv);
      if (r) { f.x = Math.round((r.x + r.length / 2 - f.w / 2) * 10) / 10; f.y = Math.round((r.y + r.width / 2 - f.d / 2) * 10) / 10; }
      h.furniture = h.furniture || [];
      h.furniture.push(f);
      ui.sel = { kind: 'furn', id: f.id };
      store.commit('add'); render();
      toast(t('toast.furnAdded', { item: t('furn.' + kind) }));
    },
    /* ---- designer side panel ---- */
    studioFurn: (d) => {
      const h = store.state;
      const lv = ui.level || 0;
      const s = ui.sel;
      const p = Airly.plans.designer;
      const cx = p ? p.vb.x + p.vb.w / 2 : 0, cy = p ? p.vb.y + p.vb.h / 2 : 0;
      // the room you are working in, else the room in the middle of the view, else the first room on this floor
      let r = s && (s.kind === 'room' ? store.room(s.id) : (s.kind === 'roomwall' || s.kind === 'opening') ? store.room(s.roomId) : null);
      if (!r) r = store.roomAt(cx, cy, null, lv) || h.rooms.find((x) => (x.level || 0) === lv);
      const f = Airly.factory.defaultFurniture(d.kind, 0, 0, lv);
      const mx = r ? r.x + r.length / 2 : cx, my = r ? r.y + r.width / 2 : cy;
      f.x = Math.round((mx - f.w / 2) * 10) / 10; f.y = Math.round((my - f.d / 2) * 10) / 10;
      h.furniture = h.furniture || [];
      h.furniture.push(f);
      ui.sel = { kind: 'furn', id: f.id };
      store.commit('add'); render();
      toast(t('toast.furnAdded', { item: t('furn.' + d.kind) }));
    },
    studioOpening: (d) => {
      const s = ui.sel;
      if (!s || s.kind !== 'roomwall') {
        ui.wallPrompt = true;
        toast(t('studio.clickWall'), 'bad');
        const v = Airly.views.designer;
        if (v && ui.view === 'designer') v.inspector();
        return;
      }
      const r = store.room(s.roomId);
      if (!r) return;
      ui.wallPrompt = false;
      if (d.type === 'ac') {
        const mid = TH.wallLength(r, s.wall) / 2;
        addAC(r, null, {
          x: s.wall === 'left' ? r.x + 0.25 : s.wall === 'right' ? r.x + r.length - 0.25 : r.x + mid,
          y: s.wall === 'top' ? r.y + 0.25 : s.wall === 'bottom' ? r.y + r.width - 0.25 : r.y + mid,
          orient: s.wall === 'left' || s.wall === 'right' ? 'v' : 'h',
        });
        render();
        return;
      }
      const L = TH.wallLength(r, s.wall);
      const o = addOpening(r, d.type, s.wall);
      if (o.w > L) o.w = L;
      ui.sel = { kind: 'opening', id: o.id, roomId: r.id, type: d.type };
      store.commit('add'); render();
    },
    printView: (d) => {
      ui.printView = d.view;
      const v = Airly.views.designer;
      if (v && ui.view === 'designer') v.inspector();
      const b = document.querySelector(`[data-action="printView"][data-view="${d.view}"]`);
      if (b) b.focus();
    },
    printDesign: () => {
      if (!store.state.rooms.length) return toast(t('toast.needRoom'));
      const sel = document.getElementById('print-room');
      ui.printRoom = sel ? sel.value : '';
      Airly.share.printDesign({ view: ui.printView === '3d' ? '3d' : '2d', room: ui.printView === '3d' ? ui.printRoom : '' });
    },
    toggleFridge: (d) => {
      const f = (store.state.furniture || []).find((x) => x.id === d.id);
      if (!f) return;
      f.open = !f.open;
      store.commit('struct'); render();
      toast(t(f.open ? 'fridge.opened' : 'fridge.closed'));
    },
    rotateDoor: (d) => ui.rotateDoor(d.room, d.id),
    toggleDoorOpen: (d) => {
      const r = store.room(d.room);
      const o = r && r.doors.find((x) => x.id === d.id);
      if (!o) return;
      o.open = !o.open;
      store.commit('struct'); render();
      toast(t(o.open ? 'door.opened' : 'door.closed'));
      const b = document.querySelector(`[data-action="toggleDoorOpen"][data-id="${d.id}"]`);
      if (b) b.focus({ preventScroll: true });
    },
    studioBack: () => { ui.sel = null; render(); },
    rotateFurn: (d) => ui.rotateFurn(d.id),
    bestSpots: (d) => { ui.bestSpotsFor = ui.bestSpotsFor === d.id ? null : d.id; render(); },
    moveACBest: (d) => {
      const a = store.ac(d.id);
      const r = a && store.room(a.roomId);
      if (!r) return;
      const best = TH.bestSpots(a, r, store.state).best;
      if (!best) return;
      a.x = +best.x.toFixed(2); a.y = +best.y.toFixed(2); a.orient = best.orient;
      store.commit('struct'); render();
      toast(t('best.moved', { cov: Math.round(best.cov * 100) }), 'good');
    },
    printReport: () => Airly.share.printReport(),
    /* ---- live weather (Open-Meteo, free, no account). Only the city name leaves the device. ---- */
    fetchWeather: async () => {
      const city = ((document.getElementById('wx-city') || {}).value || '').trim();
      if (!city) return toast(t('wx.needCity'), 'bad');
      ui.weather = { city, loading: true };
      render();
      try {
        const lang = ['en', 'sq', 'it', 'de', 'el'].includes(Airly.i18n.lang) ? Airly.i18n.lang : 'en';
        const g = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=' + lang + '&name=' + encodeURIComponent(city)).then((r) => r.json());
        const place = g && g.results && g.results[0];
        if (!place) throw new Error('notfound');
        const f = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude + '&longitude=' + place.longitude +
          '&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean&timezone=auto&forecast_days=3').then((r) => r.json());
        const d = f.daily;
        ui.weather = { city, place: place.name + (place.country ? ', ' + place.country : ''), days: d.time.map((date, i) => ({ date, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], rh: d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null })) };
      } catch (e) {
        ui.weather = { city, error: e.message === 'notfound' ? t('wx.notFound') : t('wx.offline') };
      }
      render();
    },
    useWeather: (d) => {
      const day = ui.weather && ui.weather.days && ui.weather.days[+d.day];
      if (!day) return;
      const env = store.state.env;
      env.dayCycle = true;
      const swing = Math.max(2, Math.round((day.max - day.min) * 10) / 10);
      if (day.max >= 24) {
        env.season = 'cooling'; env.outsideSummer = day.max; env.swingSummer = swing; if (day.rh != null) env.rhSummer = Math.round(day.rh);
      } else {
        env.season = 'heating'; env.outsideWinter = day.min; env.swingWinter = swing; if (day.rh != null) env.rhWinter = Math.round(day.rh);
      }
      TH.live.reset(store.state);
      store.commit('struct'); render();
      toast(t('wx.applied', { date: day.date }), 'good');
    },
    /* ---- match the energy estimate to a real electricity bill ---- */
    billCalibrate: () => {
      const val = (id) => parseFloat((document.getElementById(id) || {}).value);
      const kwh = val('bill-kwh'), days = val('bill-days'), share = val('bill-share');
      const season = (document.getElementById('bill-season') || {}).value || 'cooling';
      if (!(kwh > 0) || !(days > 0) || !(share > 0)) return toast(t('bill.invalid'), 'bad');
      const env = store.state.env;
      const old = env.energyCalib || 1;
      env.energyCalib = 1;
      const sim = Airly.advisor.energy(store.state, season, store.prefs.hours).dailyKWh * days * Math.min(1, store.prefs.days / 30);
      if (!(sim > 0)) { env.energyCalib = old; return toast(t('bill.noSim'), 'bad'); }
      const k = Math.max(0.3, Math.min(3, (kwh * share / 100) / sim));
      env.energyCalib = Math.round(k * 100) / 100;
      store.commit('struct'); render();
      toast(t('bill.applied', { k: Airly.fmt.num(env.energyCalib, 2) }), 'good');
    },
    billReset: () => { store.state.env.energyCalib = 1; store.commit('struct'); render(); },
    /* ---- AC model library ---- */
    applyModel: (d) => {
      const a = store.ac(d.id);
      const sel = document.getElementById('lib-' + d.id);
      if (!a || !sel || !sel.value) return;
      const m = Airly.TYPICAL_MODELS.concat(store.prefs.models || []).find((x) => x.id === sel.value);
      if (!m) return;
      a.btu = m.btu; a.rating = m.rating; a.inverter = m.inverter; a.powerKW = m.powerKW || null;
      a.brand = m.brand || 'Generic'; a.model = m.name || t('lib.typicalName', { btu: Math.round(m.btu / 1000) });
      store.commit('struct'); render();
      toast(t('lib.applied'), 'good');
    },
    saveModel: (d) => {
      const a = store.ac(d.id);
      if (!a) return;
      const name = ((a.brand || '') + ' ' + (a.model || '')).trim() || t('lib.typicalName', { btu: Math.round(a.btu / 1000) });
      store.prefs.models = (store.prefs.models || []).concat([{ id: 'm' + Airly.uid(), name, brand: a.brand, btu: a.btu, rating: a.rating, inverter: a.inverter, powerKW: a.powerKW }]);
      store.savePrefs(); render();
      toast(t('lib.saved', { name }), 'good');
    },
    deleteModel: (d) => {
      const sel = document.getElementById('lib-' + d.id);
      if (!sel || !sel.value || !sel.value.startsWith('m')) return;
      store.prefs.models = (store.prefs.models || []).filter((m) => m.id !== sel.value);
      store.savePrefs(); render();
    },
    /* ---- pre-cool / pre-heat planner ---- */
    planPrecool: () => {
      const roomId = (document.getElementById('pc-room') || {}).value;
      const arrive = TH.parseHM((document.getElementById('pc-arrive') || {}).value || '18:00');
      const target = Airly.fmt.fromU(parseFloat((document.getElementById('pc-target') || {}).value));
      const season = store.state.env.season;
      if (!roomId || arrive == null || isNaN(target)) return toast(t('bill.invalid'), 'bad');
      ui.precool = { roomId, arrive, target, res: Airly.advisor.precool(store.state, roomId, arrive, target, season) };
      render();
    },
    cmpAdd: () => {
      const slots = ui.compareSlots || (ui.compareSlots = [{ home: 'current', floor: 'all' }]);
      if (slots.length >= 4) return toast(t('cmp.max'));
      slots.push({ home: 'current', floor: 'all' });
      render();
    },
    cmpRemove: (d) => {
      const slots = ui.compareSlots;
      if (!slots || slots.length <= 1) return;
      slots.splice(+d.idx, 1);
      render();
    },
    serviceDone: () => { store.state.maintenance.lastService = Date.now(); store.commit('struct'); render(); toast(t('remind.serviceSaved'), 'good'); },
    snoozeReminders: () => { store.state.maintenance.snoozeUntil = Date.now() + 7 * DAY; store.commit('struct'); render(); toast(t('remind.snoozed')); },
    installApp: async () => {
      const ev = ui.installPrompt;
      if (!ev) return;
      ev.prompt();
      try { await ev.userChoice; } catch (e) { /* ignore */ }
      ui.installPrompt = null;
      render();
    },
    shareHome: () => Airly.share.openShareDialog(),
    undo: () => { if (!store.undo()) toast(t('undo.none')); },
    redo: () => { if (!store.redo()) toast(t('redo.none')); },
    setLevel: (d) => { ui.level = +d.level; ui.sel = null; render(); if (Airly.plans.designer) Airly.plans.designer.render(); },
    addLevel: () => {
      const h = store.state;
      h.levels = (h.levels || 1) + 1;
      ui.level = h.levels - 1;
      store.commit('struct'); render();
      toast(t('level.added', { name: Airly.levelName(ui.level) }));
    },
    removeLevel: () => {
      const h = store.state;
      const k = ui.level;
      if ((h.levels || 1) <= 1) return;
      const n = h.rooms.filter((r) => (r.level || 0) === k).length;
      if (!confirm(t(n ? 'level.confirmRemoveRooms' : 'level.confirmRemove', { name: Airly.levelName(k), n }))) return;
      const gone = new Set(h.rooms.filter((r) => (r.level || 0) === k).map((r) => r.id));
      h.rooms = h.rooms.filter((r) => !gone.has(r.id));
      h.acs = h.acs.filter((a) => !gone.has(a.roomId));
      h.walls = h.walls.filter((w) => (w.level || 0) !== k);
      h.rooms.forEach((r) => { if ((r.level || 0) > k) r.level -= 1; });
      h.walls.forEach((w) => { if ((w.level || 0) > k) w.level -= 1; });
      if (h.trace && (h.trace.level || 0) === k) h.trace = null;
      h.levels -= 1;
      ui.level = Math.max(0, k - 1);
      store.commit('struct'); render();
    },
    addLRoom: () => {
      const h = store.state;
      const lv = ui.level || 0;
      const same = h.rooms.filter((r) => (r.level || 0) === lv);
      const x = same.length ? Math.max(...same.map((r) => r.x + r.length)) : 0;
      const y = same.length ? Math.min(...same.map((r) => r.y)) : 0;
      const g = Airly.uid();
      const a = Airly.factory.defaultRoom('living', x, y, 6, 3.5);
      const b = Airly.factory.defaultRoom('living', x, y + 3.5, 3, 3);
      [a, b].forEach((r) => { r.group = g; r.level = lv; r.exteriorWalls = 2; });
      b.people = 1; b.appliancesW = 100;
      h.rooms.push(a, b);
      ui.sel = { kind: 'room', id: a.id }; ui.roomId = a.id;
      store.commit('add'); render();
      toast(t('toast.lAdded'));
    },
    newTemplate: (d) => {
      const kind = d.tpl || (document.getElementById('tpl-sel') || {}).value;
      if (store.state.rooms.length && !confirm(t('confirm.newProject'))) return;
      store.newFromTemplate(kind); ui.sel = null; ui.level = 0; TH.live.reset(store.state);
      const dlg = document.getElementById('modal'); if (dlg.open) dlg.close();
      location.hash = '#designer'; render();
      toast(t('toast.template', { name: t('tpl.' + kind) }), 'good');
    },
    traceRemove: () => { store.state.trace = null; store.commit('struct'); render(); },
    traceFit: () => {
      const h = store.state, tr = h.trace;
      if (!tr) return;
      const rooms = h.rooms.filter((r) => (r.level || 0) === (tr.level || 0));
      if (rooms.length) {
        tr.x = Math.min(...rooms.map((r) => r.x)); tr.y = Math.min(...rooms.map((r) => r.y));
        tr.w = Math.max(...rooms.map((r) => r.x + r.length)) - tr.x; tr.h = Math.round(tr.w * tr.aspect * 100) / 100;
      }
      store.commit('struct'); render();
    },
    addPeriod: (d) => {
      const a = store.ac(d.id);
      if (!a) return;
      a.schedule = a.schedule || { enabled: true, periods: [] };
      a.schedule.periods.push({ on: '06:00', off: '08:00' });
      a.schedule.enabled = true;
      store.commit('struct'); render();
    },
    schedDays: (d) => {
      const a = store.ac(d.id);
      if (!a) return;
      a.schedule = a.schedule || { enabled: true, periods: [{ on: '17:00', off: '23:00' }] };
      a.schedule.days = d.days;
      if (d.days === 'custom' && !Array.isArray(a.schedule.customDays)) a.schedule.customDays = [0, 1, 2, 3, 4, 5, 6];
      store.commit('struct'); render();
      const b = document.querySelector(`[data-action="schedDays"][data-id="${d.id}"][data-days="${d.days}"]`);
      if (b) b.focus({ preventScroll: true });
    },
    schedDay: (d) => {
      const a = store.ac(d.id);
      if (!a || !a.schedule) return;
      const k = +d.day;
      const list = Array.isArray(a.schedule.customDays) ? a.schedule.customDays.slice() : [0, 1, 2, 3, 4, 5, 6];
      const i = list.indexOf(k);
      if (i >= 0) {
        if (list.length === 1) return toast(t('sched.oneDay'));
        list.splice(i, 1);
      } else list.push(k);
      a.schedule.customDays = list.sort((x, y) => x - y);
      a.schedule.days = 'custom';
      store.commit('struct'); render();
      const b = document.querySelector(`[data-action="schedDay"][data-id="${d.id}"][data-day="${k}"]`);
      if (b) b.focus({ preventScroll: true });
    },
    toggleTheme: () => {
      const dark = document.documentElement.dataset.themeResolved === 'dark';
      store.prefs.theme = dark ? 'light' : 'dark';
      store.savePrefs(); applyTheme(); render();
      toast(t(dark ? 'theme.nowLight' : 'theme.nowDark'));
    },
    removePeriod: (d) => {
      const a = store.ac(d.id);
      if (!a || !a.schedule) return;
      a.schedule.periods.splice(+d.idx, 1);
      store.commit('struct'); render();
    },
    calibRun: (d) => {
      const f = Airly.fmt;
      const val = (id) => parseFloat(document.getElementById(id).value);
      const meas = { outside: f.fromU(val('cal-out')), start: f.fromU(val('cal-start')), end: f.fromU(val('cal-end')), minutes: val('cal-min'), acId: document.getElementById('cal-ac').value };
      if ([meas.outside, meas.start, meas.end, meas.minutes].some((x) => isNaN(x))) return toast(t('calib.invalid'), 'bad');
      const result = Airly.advisor.calibrate(store.state, d.id, meas);
      ui.calib = { roomId: d.id, meas, result };
      render();
    },
    calibApply: () => {
      const c = ui.calib;
      const r = c && store.room(c.roomId);
      if (!r || !c.result) return;
      const b = c.result.best;
      r.wallIns = b.wallIns; r.sun = b.sun; r.calib = b.calib;
      ui.calib = null;
      store.commit('struct'); render();
      toast(t('calib.applied'), 'good');
    },
    designerWalk: () => {
      if (!store.state.rooms.length) return toast(t('toast.needRoom'));
      ui.designer3d = true;
      render();
      Airly.view3d.walk();
    },
    designer3d: () => {
      if (!store.state.rooms.length) return toast(t('toast.needRoom'));
      ui.designer3d = true;
      render();
    },
    open3d: () => {
      if (!store.state.rooms.length) return toast(t('toast.needRoom'));
      Airly.view3d.open();
    },
    locateAC: (d) => { ui.sel = { kind: 'ac', id: d.id }; location.hash = '#designer'; },
    deleteSel: () => { ui.deleteSelection(); render(); },
    deleteRoom: (d) => { ui.sel = { kind: 'room', id: d.id }; ui.deleteSelection(); render(); },
    editRoom: (d) => { ui.roomId = d.id; location.hash = '#rooms'; },
    editAC: (d) => { ui.acId = d.id; ui.scrollToAC = true; location.hash = '#acs'; },
    pickRoom: (d) => { ui.roomId = d.id; ui.sel = { kind: 'room', id: d.id }; render({ action: 'pickRoom', id: null }); const b = document.querySelector(`.room-tab[data-id="${d.id}"]`); if (b) b.focus(); },
    autoExt: (d) => {
      const r = store.room(d.id);
      if (!r) return;
      r.exteriorWalls = TH.exteriorWallCount(store.state, r);
      store.commit('struct'); render();
      toast(t('toast.extDetected', { n: r.exteriorWalls }));
    },
    zoomIn: (d) => Airly.plans[d.plan] && Airly.plans[d.plan].zoom(1 / 1.25),
    zoomOut: (d) => Airly.plans[d.plan] && Airly.plans[d.plan].zoom(1.25),
    zoomFit: (d) => Airly.plans[d.plan] && Airly.plans[d.plan].fit(),
    resetLayout: () => {
      if (!confirm(t('confirm.resetLayout'))) return;
      store.resetHome(); ui.sel = null;
      Airly.plans.designer && Airly.plans.designer.fit();
      render(); toast(t('toast.reset'));
    },
    simToggle: () => {
      const live = TH.live;
      if (!store.state.rooms.length) return toast(t('toast.needRoom'));
      if (live.running) live.stop(); else { if (!live.model) live.rebuild(store.state); live.start(); }
    },
    simReset: () => { TH.live.reset(store.state); render(); },
    doorsAll: (d) => {
      store.state.rooms.forEach((r) => r.doors.forEach((o) => (o.open = d.open === '1')));
      store.commit('struct'); render();
    },
    applyRec: (d) => {
      const rec = (Airly.views.recommendations._recs || [])[+d.idx];
      if (!rec || !rec.action) return;
      if (Airly.advisor.applyAction(store.state, rec.action)) {
        store.commit('struct'); render();
        toast(t('toast.applied'), 'good');
      }
    },
    saveScenario: () => {
      const h = store.state;
      const inp = document.getElementById('scen-name');
      const name = (inp && inp.value.trim()) || t('scen.defaultName', { n: h.scenarios.length + 1 });
      h.scenarios.push({ id: Airly.uid(), name, created: Date.now(), data: scenarioData(h) });
      store.commit('struct'); render();
      toast(t('toast.scenSaved', { name }), 'good');
    },
    proposeScenario: () => {
      const h = store.state;
      const season = Airly.views.recommendations.season || h.env.season;
      const prop = Airly.advisor.propose(h, season);
      const s = { id: Airly.uid(), name: t('scen.proposalName', { n: h.scenarios.length + 1 }), created: Date.now(), data: scenarioData(prop) };
      h.scenarios.push(s);
      store.commit('struct'); render();
      runCompare('current', 's:' + s.id);
      const out = document.getElementById('cmp-out');
      if (out) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(t('toast.proposal'), 'good');
    },
    loadScenario: (d) => {
      const h = store.state;
      const s = h.scenarios.find((x) => x.id === d.id);
      if (!s || !confirm(t('confirm.loadScenario', { name: s.name }))) return;
      Object.assign(h, Airly.clone(s.data));
      ui.sel = null;
      TH.live.reset(h);
      store.commit('struct'); render();
      toast(t('toast.scenLoaded', { name: s.name }), 'good');
    },
    deleteScenario: (d) => {
      const h = store.state;
      h.scenarios = h.scenarios.filter((x) => x.id !== d.id);
      Airly.views.recommendations.compareResult = null;
      store.commit('struct'); render();
    },
    compareScenarios: () => runCompare(document.getElementById('cmp-a').value, document.getElementById('cmp-b').value),
    recalcEnergy: () => render(),
    guideTab: (d) => { Airly.views.guide.tab = d.tab; render(); const b = document.getElementById('gtab-' + d.tab); if (b) b.focus(); },
    filterCleaned: () => { store.state.maintenance.lastFilterClean = Date.now(); store.commit('struct'); render(); toast(t('toast.filter'), 'good'); },
    clearChecks: () => { store.state.maintenance.checks = {}; store.commit('struct'); render(); },
    resetPrefs: () => {
      if (!confirm(t('confirm.resetPrefs'))) return;
      store.resetPrefs(); Airly.i18n.setLang(store.prefs.lang); applyTheme(); render(); toast(t('toast.prefsReset'));
    },
    resetHome: () => {
      if (!confirm(t('confirm.resetHome'))) return;
      store.resetHome(); ui.sel = null; render(); toast(t('toast.reset'));
    },
    clearAll: () => {
      if (!confirm(t('confirm.clearAll'))) return;
      store.clearAll(); Airly.i18n.setLang(store.prefs.lang); applyTheme(); ui.sel = null; render(); toast(t('toast.cleared'));
    },
    exportJSON: () => {
      const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'airly-' + (store.state.name || 'home').replace(/[^\w-]+/g, '_').toLowerCase() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    saveHome: () => {
      if (store.saveProject()) toast(t('toast.saved', { name: store.state.name || t('home.defaultName') }), 'good');
      else toast(t('toast.saveFailed'), 'bad');
      if (document.getElementById('modal').open) openProjects();
    },
    openProjects: () => openProjects(),
    closeModal: () => document.getElementById('modal').close(),
    loadProject: (d) => {
      if (!confirm(t('confirm.loadProject'))) return;
      store.flush();
      store.loadProject(d.id); ui.sel = null; TH.live.reset(store.state);
      document.getElementById('modal').close(); render(); toast(t('toast.loaded'), 'good');
    },
    deleteProject: (d) => { if (!confirm(t('confirm.deleteProject'))) return; store.deleteProject(d.id); openProjects(); },
    newProject: (d) => {
      if (!confirm(t('confirm.newProject'))) return;
      store.newProject(d.sample === '1'); ui.sel = null; TH.live.reset(store.state);
      document.getElementById('modal').close(); location.hash = '#designer'; render();
    },
    unit: (d) => { store.prefs.tempUnit = d.unit === 'F' ? 'F' : 'C'; store.savePrefs(); render(); },
    lang: (d) => { store.prefs.lang = d.lang; store.savePrefs(); Airly.i18n.setLang(d.lang); render(); },
    menu: () => {
      const open = !document.body.classList.contains('nav-open');
      document.body.classList.toggle('nav-open', open);
      document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
      if (open) { const a = document.querySelector('.nav-link.active') || document.querySelector('.nav-link'); a && a.focus(); }
    },
  };

  function openProjects() {
    const dlg = document.getElementById('modal');
    const all = Object.values(store.projects()).sort((a, b) => b.updated - a.updated);
    const loc = Airly.i18n.locale();
    dlg.innerHTML = `<form method="dialog" class="modal-inner">
      <header class="modal-head"><h2 id="modal-title">${esc(t('proj.title'))}</h2><button type="button" class="btn icon" data-action="closeModal" aria-label="${esc(t('common.close'))}">✕</button></header>
      <div class="field"><label for="proj-name">${esc(t('home.name'))}</label><input id="proj-name" type="text" data-bind="home.name" value="${esc(store.state.name)}" placeholder="${esc(t('home.defaultName'))}"></div>
      <div class="row-gap">
        <button type="button" class="btn primary" data-action="saveHome">${esc(t('top.save'))}</button>
        <button type="button" class="btn" data-action="shareHome">${esc(t('share.button'))}</button>
        <button type="button" class="btn" data-action="printReport">${esc(t('report.button'))}</button>
        <button type="button" class="btn" data-action="newProject" data-sample="0">${esc(t('proj.newEmpty'))}</button>
        <button type="button" class="btn" data-action="newProject" data-sample="1">${esc(t('proj.newSample'))}</button>
      </div>
      <div class="row-gap"><label for="tpl-sel">${esc(t('tpl.start'))}</label><select id="tpl-sel">${Airly.TEMPLATES.map((k) => `<option value="${k}">${esc(t('tpl.' + k))}</option>`).join('')}</select><button type="button" class="btn" data-action="newTemplate">${esc(t('tpl.use'))}</button></div>
      <h3>${esc(t('proj.saved'))}</h3>
      ${all.length ? `<ul class="proj-list">${all.map((p) => `<li${p.id === store.state.id ? ' class="current"' : ''}><div><strong>${esc(p.name || t('home.defaultName'))}</strong>
        <span class="muted small">${esc(t('proj.meta', { rooms: (p.data.rooms || []).length, acs: (p.data.acs || []).length, date: new Date(p.updated).toLocaleString(loc) }))}${p.id === store.state.id ? ' · ' + esc(t('proj.open')) : ''}</span></div>
        <div><button type="button" class="btn small" data-action="loadProject" data-id="${p.id}">${esc(t('proj.load'))}</button>
        <button type="button" class="btn small danger-ghost" data-action="deleteProject" data-id="${p.id}">${esc(t('common.delete'))}</button></div></li>`).join('')}</ul>` : `<p class="muted">${esc(t('proj.none'))}</p>`}
      <p class="muted small">${esc(Airly.storageOK ? t('proj.note') : t('settings.storageNo'))}</p>
    </form>`;
    if (!dlg.open) dlg.showModal();
  }

  Object.assign(Airly.app, { actions, openProjects });
})();

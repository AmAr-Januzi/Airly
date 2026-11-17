/* Airly — state, defaults and persistence (LocalStorage) */
(function () {
  'use strict';
  const Airly = (window.Airly = window.Airly || {});

  const KEY_CURRENT = 'airly.current';
  const KEY_PROJECTS = 'airly.projects';
  const KEY_PREFS = 'airly.prefs';
  const SCHEMA = 2;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  Airly.uid = uid;
  Airly.clone = clone;

  Airly.ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'office', 'dining', 'custom'];
  Airly.STANDARD_BTU = [7000, 9000, 12000, 18000, 24000, 30000, 36000];
  Airly.ENERGY_RATINGS = ['A+++', 'A++', 'A+', 'A', 'B', 'C'];
  /* generic "typical" units (not real brand models): rated power is a typical value for that size and class */
  Airly.TYPICAL_MODELS = [
    { id: 't9', btu: 9000, rating: 'A++', inverter: true, powerKW: 0.75 },
    { id: 't12', btu: 12000, rating: 'A++', inverter: true, powerKW: 1.0 },
    { id: 't18', btu: 18000, rating: 'A++', inverter: true, powerKW: 1.5 },
    { id: 't24', btu: 24000, rating: 'A+', inverter: true, powerKW: 2.1 },
    { id: 't12f', btu: 12000, rating: 'A', inverter: false, powerKW: 1.15 },
  ];
  Airly.FAN_SPEEDS = ['auto', 'quiet', 'low', 'medium', 'high'];
  Airly.DIRECTIONS = ['auto', 'swing', 'up', 'middle', 'down'];
  Airly.AC_MODES = ['cool', 'heat', 'auto', 'fan'];
  Airly.QUALITY = ['poor', 'medium', 'good'];
  Airly.SUN = ['low', 'medium', 'high'];
  Airly.FLOOR_LEVELS = ['ground', 'middle', 'top'];
  Airly.WALLS = ['top', 'right', 'bottom', 'left'];
  /* furniture: typical sizes in meters (w along x, d along y, h height); seat = people sit/sleep there */
  Airly.FURNITURE = {
    sofa: { w: 2.0, d: 0.9, h: 0.85, seat: true },
    bed: { w: 1.6, d: 2.0, h: 0.55, seat: true },
    singleBed: { w: 0.9, d: 2.0, h: 0.55, seat: true },
    armchair: { w: 0.85, d: 0.85, h: 0.9, seat: true },
    table: { w: 1.4, d: 0.8, h: 0.75 },
    desk: { w: 1.2, d: 0.6, h: 0.75, seat: true },
    wardrobe: { w: 1.2, d: 0.6, h: 2.1 },
    shelf: { w: 1.0, d: 0.35, h: 1.8 },
    kitchen: { w: 2.4, d: 0.6, h: 0.9 },
    fridge: { w: 0.7, d: 0.7, h: 1.85 },
    tv: { w: 1.4, d: 0.45, h: 0.55 },
    stairs: { w: 1.0, d: 3.0, h: 0 },
  };
  // simulation speeds in simulated minutes per real second (1/60 = real time)
  Airly.SIM_SPEEDS = [1 / 60, 1, 5, 10, 30, 60, 120, 300];

  let storageOK = true;
  try {
    const k = '__airly_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch (e) {
    storageOK = false;
  }
  Airly.storageOK = storageOK;

  function readJSON(key, fallback) {
    if (!storageOK) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    if (!storageOK) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Defaults ---------- */
  function defaultRoom(type, x, y, length, width, name) {
    return {
      id: uid(),
      type: type || 'custom',
      name: name || '',
      x: x || 0,
      y: y || 0,
      length: length || 4, // horizontal (m)
      width: width || 4, // vertical (m)
      height: 2.7,
      windows: [],
      doors: [],
      wallIns: 'medium',
      ceilIns: 'medium',
      floorIns: 'medium',
      sun: 'medium',
      exteriorWalls: 1,
      people: type === 'bedroom' ? 2 : type === 'living' ? 3 : 1,
      appliancesW: type === 'kitchen' ? 600 : type === 'living' ? 250 : type === 'office' ? 300 : 80,
      floorLevel: 'middle',
      initialTemp: null, // null => use home default
      openPlan: false,
      level: 0, // floor index (0 = ground floor of the plan)
      group: null, // rooms sharing a group id form one L-shaped space
      calib: 1, // heat-loss/sun factor from calibration with a real measurement
    };
  }
  function defaultOpening(kind, wall, offset, w, h) {
    return {
      id: uid(),
      wall: wall || 'top',
      offset: offset || 0.5,
      w: w || (kind === 'door' ? 0.9 : 1.2),
      h: h || (kind === 'door' ? 2.1 : 1.3),
      open: kind === 'door' ? true : undefined,
    };
  }
  function defaultAC(roomId, x, y, btu) {
    return {
      id: uid(),
      roomId: roomId || null,
      x: x || 0,
      y: y || 0,
      brand: 'Generic',
      model: 'Custom AC',
      btu: btu || 12000,
      mode: 'cool',
      rating: 'A++',
      powerKW: null, // null => estimate from rating
      inverter: true,
      target: 22,
      orient: 'h', // 'h' = horizontal (top/bottom wall), 'v' = vertical (left/right wall)
      fan: 'auto',
      direction: 'auto',
      on: true,
      schedule: { enabled: false, periods: [{ on: '17:00', off: '23:00' }] },
      sleep: false, // night mode 23:00–07:00
    };
  }

  function defaultFurniture(kind, x, y, level) {
    const c = Airly.FURNITURE[kind] || Airly.FURNITURE.table;
    return { id: uid(), kind, x: x || 0, y: y || 0, w: c.w, d: c.d, h: c.h, rot: 0, level: level || 0 };
  }
  function furn(kind, x, y, rot, level) {
    const f = defaultFurniture(kind, x, y, level);
    if (rot === 90 || rot === 270) { const t = f.w; f.w = f.d; f.d = t; }
    f.rot = rot || 0;
    return f;
  }

  function defaultEnv() {
    return {
      season: 'cooling', // active simulation season
      outsideSummer: 30,
      outsideWinter: 2,
      initialSummer: 27,
      initialWinter: 14,
      desiredCool: 24,
      desiredHeat: 21,
      dayCycle: true, // outside temperature and sun follow the time of day
      swingSummer: 9, // °C between the afternoon high and the night low
      swingWinter: 6,
      startHour: 12, // clock time when the simulation starts
      north: 'top', // which side of the plan faces north
      rhSummer: 50, // outdoor relative humidity (%)
      rhWinter: 75,
      climate: 'tirana',
      customClimate: null,
    };
  }

  function sampleHome() {
    const living = defaultRoom('living', 0, 0, 6, 5);
    living.exteriorWalls = 2;
    living.sun = 'high';
    living.windows.push(defaultOpening('window', 'top', 1.0, 1.6, 1.4), defaultOpening('window', 'top', 3.6, 1.6, 1.4));
    living.doors.push(defaultOpening('door', 'bottom', 2.5));
    living.doors[0].open = false;
    living.doors.push(defaultOpening('door', 'right', 2.0, 1.0));

    const kitchen = defaultRoom('kitchen', 6, 0, 4, 5);
    kitchen.exteriorWalls = 2;
    kitchen.windows.push(defaultOpening('window', 'top', 1.4, 1.2, 1.2));

    const hall = defaultRoom('hallway', 0, 5, 10, 1.5);
    hall.exteriorWalls = 1;
    hall.people = 0;
    hall.appliancesW = 20;
    hall.doors.push(defaultOpening('door', 'left', 0.3, 0.9));

    const bed1 = defaultRoom('bedroom', 0, 6.5, 4, 4);
    bed1.exteriorWalls = 2;
    bed1.windows.push(defaultOpening('window', 'bottom', 1.4, 1.2, 1.3));
    bed1.doors.push(defaultOpening('door', 'top', 2.8));
    bed1.doors[0].open = false;

    const bed2 = defaultRoom('bedroom', 4, 6.5, 3.5, 4);
    bed2.exteriorWalls = 1;
    bed2.sun = 'high';
    bed2.windows.push(defaultOpening('window', 'bottom', 1.1, 1.2, 1.3));
    bed2.doors.push(defaultOpening('door', 'top', 0.3));
    bed2.doors[0].open = false;

    const bath = defaultRoom('bathroom', 7.5, 6.5, 2.5, 4);
    bath.exteriorWalls = 2;
    bath.people = 0;
    bath.appliancesW = 50;
    bath.windows.push(defaultOpening('window', 'bottom', 0.8, 0.6, 0.6));
    bath.doors.push(defaultOpening('door', 'top', 0.4, 0.8));
    bath.doors[0].open = false;

    const rooms = [living, kitchen, hall, bed1, bed2, bath];
    const furniture = [
      furn('sofa', 1.2, 3.8), furn('tv', 1.5, 0.3), furn('table', 3.8, 2.2),
      furn('kitchen', 7.2, 0.25), furn('fridge', 9.1, 4.1), furn('table', 7.6, 2.6),
      furn('bed', 1.0, 8.2, 90), furn('wardrobe', 0.25, 6.75, 90),
      furn('singleBed', 4.3, 8.3), furn('desk', 6.2, 6.8, 90),
    ];
    const ac = defaultAC(living.id, 3, 0.25, 18000);
    ac.brand = 'Generic';
    ac.model = 'Split 18K';
    return {
      schema: SCHEMA,
      id: uid(),
      name: '',
      rooms,
      acs: [ac],
      walls: [],
      furniture,
      env: defaultEnv(),
      scenarios: [],
      maintenance: { checks: {}, lastFilterClean: null },
      levels: 1, // number of floors
      trace: null, // background image for tracing a floor plan
      updated: Date.now(),
    };
  }

  /* ---------- Templates ---------- */
  function win(wall, offset, w, h) { return defaultOpening('window', wall, offset, w || 1.2, h || 1.3); }
  function door(wall, offset, open, w) { const d = defaultOpening('door', wall, offset, w || 0.9); d.open = open !== false; return d; }
  function room(type, x, y, L, W, extra) { return Object.assign(defaultRoom(type, x, y, L, W), extra || {}); }
  function templateHome(kind) {
    if (kind === 'apartment2' || !kind) return sampleHome();
    const h = emptyHome();
    const ac = (r, btu, wallY) => { const a = defaultAC(r.id, r.x + r.length / 2, wallY != null ? wallY : r.y + 0.25, btu); a.model = 'Split ' + btu / 1000 + 'K'; h.acs.push(a); };
    if (kind === 'studio') {
      const main = room('living', 0, 0, 6, 5, { name: '', exteriorWalls: 2, sun: 'high', windows: [win('top', 1, 1.6, 1.4), win('top', 3.5, 1.6, 1.4)], doors: [door('bottom', 3.8, false)] });
      const bath = room('bathroom', 0, 5, 2.5, 2.2, { exteriorWalls: 1, people: 0, appliancesW: 50, windows: [win('left', 0.8, 0.6, 0.6)], doors: [door('right', 0.6, false, 0.8)] });
      const hall = room('hallway', 2.5, 5, 3.5, 2.2, { exteriorWalls: 1, people: 0, appliancesW: 20, doors: [door('bottom', 1.2, false)] });
      h.rooms.push(main, bath, hall);
      ac(main, 12000);
    } else if (kind === 'apartment1') {
      const liv = room('living', 0, 0, 5, 4.5, { exteriorWalls: 2, sun: 'high', openPlan: true, windows: [win('top', 1.5, 1.8, 1.4)], doors: [door('bottom', 3.5)] });
      const kit = room('kitchen', 5, 0, 3, 4.5, { exteriorWalls: 2, openPlan: true, windows: [win('top', 0.9, 1.2, 1.2)] });
      const hall = room('hallway', 0, 4.5, 8, 1.4, { exteriorWalls: 1, people: 0, appliancesW: 20, doors: [door('left', 0.2, false)] });
      const bed = room('bedroom', 0, 5.9, 4.5, 3.6, { exteriorWalls: 2, windows: [win('bottom', 1.6)], doors: [door('top', 3.2)] });
      const bath = room('bathroom', 4.5, 5.9, 3.5, 3.6, { exteriorWalls: 2, people: 0, appliancesW: 50, windows: [win('bottom', 1.4, 0.6, 0.6)], doors: [door('top', 0.4, false, 0.8)] });
      h.rooms.push(liv, kit, hall, bed, bath);
      ac(liv, 12000); ac(bed, 9000);
    } else if (kind === 'lshape') {
      const g = uid();
      const liv = room('living', 0, 0, 7, 4, { group: g, exteriorWalls: 2, sun: 'high', windows: [win('top', 1, 1.8, 1.4), win('top', 4.2, 1.8, 1.4)] });
      const kit = room('kitchen', 0, 4, 3.2, 3, { group: g, exteriorWalls: 2, windows: [win('left', 1, 1.2, 1.2)], doors: [door('bottom', 1.2, false)] });
      const bed = room('bedroom', 3.2, 4, 3.8, 3.8, { exteriorWalls: 2, windows: [win('bottom', 1.3)], doors: [door('top', 0.4)] });
      const bath = room('bathroom', 0, 7, 3.2, 2.4, { exteriorWalls: 2, people: 0, appliancesW: 50, windows: [win('bottom', 1.2, 0.6, 0.6)], doors: [door('top', 1.4, false, 0.8)] });
      liv.name = ''; kit.name = '';
      h.rooms.push(liv, kit, bed, bath);
      ac(liv, 18000);
    } else if (kind === 'house') {
      h.levels = 2;
      const g0 = { floorLevel: 'ground', level: 0 }, g1 = { floorLevel: 'top', level: 1 };
      const liv = room('living', 0, 0, 6, 5, Object.assign({ exteriorWalls: 2, sun: 'high', windows: [win('top', 1, 1.8, 1.4), win('left', 1.5, 1.4, 1.4)], doors: [door('bottom', 2.5), door('right', 2, true, 1)] }, g0));
      const kit = room('kitchen', 6, 0, 4, 5, Object.assign({ exteriorWalls: 2, windows: [win('top', 1.4)] }, g0));
      const hall = room('hallway', 0, 5, 10, 2, Object.assign({ exteriorWalls: 3, people: 0, appliancesW: 20, doors: [door('left', 0.5, false)] }, g0));
      const wc = room('bathroom', 7, 7, 3, 2.5, Object.assign({ exteriorWalls: 2, people: 0, appliancesW: 40, windows: [win('bottom', 1.2, 0.6, 0.6)], doors: [door('top', 0.5, false, 0.8)] }, g0));
      const b1 = room('bedroom', 0, 0, 5, 4.5, Object.assign({ exteriorWalls: 2, windows: [win('top', 1.5)], doors: [door('bottom', 3.6, false)] }, g1));
      const b2 = room('bedroom', 5, 0, 5, 4.5, Object.assign({ exteriorWalls: 2, sun: 'high', windows: [win('top', 1.9)], doors: [door('bottom', 0.4, false)] }, g1));
      const hall1 = room('hallway', 0, 4.5, 10, 1.6, Object.assign({ exteriorWalls: 2, people: 0, appliancesW: 20 }, g1));
      const b3 = room('bedroom', 0, 6.1, 4, 3.4, Object.assign({ exteriorWalls: 2, windows: [win('bottom', 1.4)], doors: [door('top', 2.8, false)] }, g1));
      const bath = room('bathroom', 4, 6.1, 3, 3.4, Object.assign({ exteriorWalls: 1, people: 0, appliancesW: 50, windows: [win('bottom', 1.2, 0.6, 0.6)], doors: [door('top', 0.5, false, 0.8)] }, g1));
      h.rooms.push(liv, kit, hall, wc, b1, b2, hall1, b3, bath);
      // stairs in the hallway go up (towards +x) to the landing on floor 1
      h.furniture.push(furn('stairs', 6.5, 5.1, 90, 0), furn('sofa', 1.5, 3.8), furn('bed', 1.6, 0.5, 0, 1), furn('bed', 6.6, 0.5, 0, 1), furn('singleBed', 0.5, 7.2, 90, 1), furn('wardrobe', 4.4, 6.4, 90, 1));
      ac(liv, 18000); ac(b1, 9000); ac(b2, 9000);
    }
    return h;
  }

  function emptyHome() {
    const h = sampleHome();
    h.rooms = [];
    h.acs = [];
    h.walls = [];
    h.furniture = [];
    h.scenarios = [];
    h.id = uid();
    return h;
  }

  function defaultPrefs() {
    return {
      lang: 'en',
      theme: 'auto',
      currency: '€',
      price: 0.1,
      hours: 8,
      days: 30,
      snap: true,
      showCoverage: true,
      simSpeed: 5,
      tempUnit: 'C', // 'C' or 'F' (display only; the model always works in °C)
      comfortMap: false,
      models: [], // the user's own AC models (library, kept across homes)
      remindFilter: true,
      filterDays: 30,
      remindService: true,
      notify: false,
      lastNotified: null,
      v: 2,
    };
  }

  /* Repair/upgrade a loaded home so missing fields don't break the app */
  function normalizeHome(h) {
    const base = sampleHome();
    if (!h || typeof h !== 'object' || !Array.isArray(h.rooms)) return base;
    const out = Object.assign({}, emptyHome(), h);
    out.env = Object.assign(defaultEnv(), h.env || {});
    // v2: summer defaults changed from 35 °C outside / 30 °C inside to 30 °C / 27 °C (only if untouched)
    if ((h.schema || 1) < 2 && out.env.outsideSummer === 35 && out.env.initialSummer === 30) {
      out.env.outsideSummer = 30;
      out.env.initialSummer = 27;
    }
    out.schema = SCHEMA;
    out.rooms = (h.rooms || []).map((r) => {
      const d = defaultRoom(r.type, r.x, r.y, r.length, r.width);
      const rr = Object.assign(d, r);
      rr.windows = (r.windows || []).map((o) => Object.assign(defaultOpening('window'), o));
      rr.doors = (r.doors || []).map((o) => Object.assign(defaultOpening('door'), o));
      return rr;
    });
    out.acs = (h.acs || []).map((a) => Object.assign(defaultAC(), a));
    out.walls = Array.isArray(h.walls) ? h.walls : [];
    out.furniture = Array.isArray(h.furniture) ? h.furniture.filter((f) => Airly.FURNITURE[f.kind]) : [];
    out.scenarios = Array.isArray(h.scenarios) ? h.scenarios : [];
    out.maintenance = Object.assign({ checks: {}, lastFilterClean: null }, h.maintenance || {});
    out.levels = Math.max(+h.levels || 1, ...out.rooms.map((r) => (r.level || 0) + 1), 1);
    return out;
  }

  /* ---------- Store with simple event bus ---------- */
  const listeners = {};
  let saveTimer = null;

  const store = {
    state: normalizeHome(readJSON(KEY_CURRENT, null)),
    prefs: (() => {
      const saved = readJSON(KEY_PREFS, {}) || {};
      const p = Object.assign(defaultPrefs(), saved);
      // v2: the old default speed (60 min/s) was too fast to watch the room cool down
      if ((saved.v || 1) < 2) { if (+p.simSpeed === 60) p.simSpeed = 5; p.v = 2; }
      return p;
    })(),

    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    emit(evt, data) {
      (listeners[evt] || []).forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error(e);
        }
      });
    },
    /* Call after mutating state. `source` lets views skip re-rendering themselves. */
    commit(source) {
      this.state.updated = Date.now();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeJSON(KEY_CURRENT, this.state), 250);
      this.track(source);
      this.emit('change', source || null);
    },

    /* ---- Undo / redo: snapshots of the home (the traced image is kept out to save memory) ---- */
    hist: { undo: [], redo: [], last: null, lastSource: null, lastTime: 0 },
    snap() {
      return JSON.stringify(this.state, (k, v) => (k === 'trace' || k === 'updated' ? undefined : v));
    },
    track(source) {
      if (source === 'undo') return;
      const H = this.hist;
      const cur = this.snap();
      if (source === 'replace' || H.last === null) { if (source === 'replace') { H.undo = []; H.redo = []; } H.last = cur; this.emit('history'); return; }
      if (cur === H.last) return;
      const now = Date.now();
      // typing in a field counts as one step
      const coalesce = source === 'form' && H.lastSource === 'form' && now - H.lastTime < 1500;
      if (!coalesce) { H.undo.push(H.last); if (H.undo.length > 60) H.undo.shift(); }
      H.redo = [];
      H.last = cur;
      H.lastSource = source;
      H.lastTime = now;
      this.emit('history');
    },
    restore(json) {
      const trace = this.state.trace;
      const h = JSON.parse(json);
      h.trace = trace;
      this.state = normalizeHome(h);
      this.hist.last = json;
      this.hist.lastSource = null;
      this.commit('undo');
      this.emit('history');
    },
    undo() {
      const H = this.hist;
      if (!H.undo.length) return false;
      H.redo.push(H.last);
      this.restore(H.undo.pop());
      return true;
    },
    redo() {
      const H = this.hist;
      if (!H.redo.length) return false;
      H.undo.push(H.last);
      this.restore(H.redo.pop());
      return true;
    },
    savePrefs() {
      writeJSON(KEY_PREFS, this.prefs);
      this.emit('prefs');
    },
    replaceState(home, source) {
      this.state = normalizeHome(home);
      this.commit(source || 'replace');
      this.emit('replace');
    },

    /* ---- Room / AC helpers ---- */
    room(id) {
      return this.state.rooms.find((r) => r.id === id) || null;
    },
    ac(id) {
      return this.state.acs.find((a) => a.id === id) || null;
    },
    roomAt(x, y, home, level) {
      const rooms = (home || this.state).rooms;
      for (let i = rooms.length - 1; i >= 0; i--) {
        const r = rooms[i];
        if (level != null && (r.level || 0) !== level) continue;
        if (x >= r.x && x <= r.x + r.length && y >= r.y && y <= r.y + r.width) return r;
      }
      return null;
    },

    /* ---- Project library ---- */
    projects() {
      return readJSON(KEY_PROJECTS, {});
    },
    saveProject() {
      const all = this.projects();
      all[this.state.id] = { id: this.state.id, name: this.state.name, updated: Date.now(), data: clone(this.state) };
      return writeJSON(KEY_PROJECTS, all);
    },
    loadProject(id) {
      const p = this.projects()[id];
      if (!p) return false;
      this.replaceState(p.data);
      return true;
    },
    deleteProject(id) {
      const all = this.projects();
      delete all[id];
      writeJSON(KEY_PROJECTS, all);
    },
    newProject(sample) {
      this.replaceState(sample ? sampleHome() : emptyHome());
    },
    newFromTemplate(kind) {
      this.replaceState(templateHome(kind));
    },
    resetHome() {
      const id = this.state.id;
      const name = this.state.name;
      const h = sampleHome();
      h.id = id;
      h.name = name;
      this.replaceState(h);
    },
    resetPrefs() {
      this.prefs = defaultPrefs();
      this.savePrefs();
    },
    clearAll() {
      if (storageOK) {
        [KEY_CURRENT, KEY_PROJECTS, KEY_PREFS].forEach((k) => localStorage.removeItem(k));
      }
      this.prefs = defaultPrefs();
      this.replaceState(sampleHome());
      this.savePrefs();
    },
    flush() {
      clearTimeout(saveTimer);
      writeJSON(KEY_CURRENT, this.state);
    },
  };

  Airly.store = store;
  Airly.factory = { defaultRoom, defaultOpening, defaultAC, defaultEnv, sampleHome, emptyHome, normalizeHome, templateHome, defaultFurniture };
  Airly.TEMPLATES = ['studio', 'apartment1', 'apartment2', 'lshape', 'house'];

  window.addEventListener('beforeunload', () => store.flush());
})();

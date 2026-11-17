/* Airly — capacity analysis, recommendations, proposals and energy estimates */
(function () {
  'use strict';
  const Airly = window.Airly;
  const T = Airly.thermal;

  function withSeason(home, season) {
    const h = Airly.clone(home);
    h.env.season = season;
    return h;
  }
  const modeOf = (season) => (season === 'heating' ? 'heat' : 'cool');

  /* Full analysis of one season. Results are cached per home snapshot. */
  let cache = { key: null, value: null };
  function analyze(home, season, hours) {
    season = season || home.env.season;
    hours = hours || 6;
    const key = JSON.stringify([home.rooms, home.acs, home.env, season, hours]);
    if (cache.key === key) return cache.value;
    const mode = modeOf(season);
    const h = withSeason(home, season);
    const pred = T.predict(h, { forceMode: mode, hours, season, ignoreSchedules: true });
    const rooms = h.rooms.map((r, i) => {
      const req = T.required(r, mode, h.env);
      const acs = h.acs.filter((a) => a.roomId === r.id);
      const inst = acs.reduce((s, a) => s + a.btu, 0);
      const ratio = req.btu > 0 ? inst / req.btu : inst > 0 ? 9 : 1;
      let cap;
      if (!acs.length) cap = 'none';
      else if (ratio < 0.85) cap = 'under';
      else if (ratio > 1.8 && inst - req.btu > 6000) cap = 'over';
      else cap = 'ok';
      const reached = pred.reached[i];
      let perf;
      if (reached != null && reached <= 5400) perf = 'effective';
      else if (reached != null && reached <= 4 * 3600) perf = 'slow';
      else perf = 'insufficient';
      // a room without its own AC that ends close to its target is served through doors / openings
      const covered = !acs.length && (reached != null || Math.abs(pred.final[i] - pred.targets[i]) <= 1.0);
      if (covered && perf === 'insufficient') perf = 'slow';
      const g = T.geometry(r);
      return {
        room: r, i, req, acs, inst, ratio, cap, perf, covered,
        final: pred.final[i], target: pred.targets[i], reached, geom: g,
        coverage: acs.length ? acs.map((a) => T.coverage(a, r, null, h.furniture)) : [],
        draftSeat: seatInDraft(h, r, acs),
      };
    });
    rooms.forEach((ra) => (ra.comfort = T.comfortScore({ final: ra.final, target: ra.target, reached: ra.reached, rh: pred.rh[ra.i], draftSeat: !!ra.draftSeat })));
    const value = {
      season, mode, pred, rooms, hours,
      totals: {
        req: rooms.reduce((s, r) => s + r.req.btu, 0),
        inst: h.acs.reduce((s, a) => s + a.btu, 0),
        area: rooms.reduce((s, r) => s + r.geom.area, 0),
        volume: rooms.reduce((s, r) => s + r.geom.volume, 0),
      },
    };
    cache = { key, value };
    return value;
  }

  /* is a bed / sofa / desk sitting in the direct air stream of an AC in this room? */
  function seatInDraft(home, r, acs) {
    const seats = (home.furniture || []).filter((f) => Airly.FURNITURE[f.kind] && Airly.FURNITURE[f.kind].seat && (f.level || 0) === (r.level || 0) &&
      f.x + f.w / 2 > r.x && f.x + f.w / 2 < r.x + r.length && f.y + f.d / 2 > r.y && f.y + f.d / 2 < r.y + r.width);
    for (const s of seats) {
      for (const a of acs) {
        const f = T.feelAt(home, null, s.x + s.w / 2, s.y + s.d / 2, { room: r, acs: [a], assumeFull: true });
        if (f && f.draft) return { seat: s, ac: a, level: f.draft };
      }
    }
    return null;
  }
  function roomReaches(home, season, roomId, hours) {
    const p = T.predict(withSeason(home, season), { forceMode: modeOf(season), hours: hours || 6, season, ignoreSchedules: true });
    const i = home.rooms.findIndex((r) => r.id === roomId);
    return p.reached[i] != null && p.reached[i] <= 3 * 3600;
  }

  function sizeRange(btu) {
    const lo = T.standardSize(btu * 0.9);
    const hi = T.standardSize(btu * 1.15);
    return lo === hi ? Airly.fmt.btu(lo) : `${Airly.fmt.btu(lo)} – ${Airly.fmt.btu(hi)}`;
  }

  /* Returns a list of recommendation objects:
     { type, severity: 'critical'|'warning'|'info'|'good', roomId, params, action? } */
  function recommend(home, season) {
    season = season || home.env.season;
    const mode = modeOf(season);
    const an = analyze(home, season);
    const recs = [];
    const links = T.adjacency(home);
    const name = (r) => Airly.roomName(r);

    an.rooms.forEach((ra) => {
      const r = ra.room;
      const p = { room: name(r), req: Airly.fmt.btu(ra.req.size), inst: Airly.fmt.btu(ra.inst), range: sizeRange(ra.req.btu), target: Airly.fmt.temp(ra.target), final: Airly.fmt.temp(ra.final) };

      if (!ra.acs.length) {
        if (ra.covered) {
          recs.push({ type: 'covered', severity: 'good', roomId: r.id, params: p });
          return;
        }
        // try cheap fixes first: open doors to neighbouring rooms that have AC
        const neighborLinks = links.filter((l) => (l.a === r.id || l.b === r.id) && !l.openPlan && l.doors.some((d) => !d.door.open));
        const acRoomIds = new Set(home.acs.map((a) => a.roomId));
        const helpful = neighborLinks.filter((l) => acRoomIds.has(l.a === r.id ? l.b : l.a));
        if (helpful.length) {
          const h2 = Airly.clone(home);
          helpful.forEach((l) => l.doors.forEach((d) => {
            const room = h2.rooms.find((x) => x.id === d.room);
            const door = room && room.doors.find((x) => x.id === d.door.id);
            if (door) door.open = true;
          }));
          if (roomReaches(h2, season, r.id)) {
            const doorIds = [];
            helpful.forEach((l) => l.doors.forEach((d) => doorIds.push([d.room, d.door.id])));
            recs.push({ type: 'openDoor', severity: 'info', roomId: r.id, params: p, action: { kind: 'openDoors', doorIds } });
            return;
          }
        }
        if (ra.req.btu < 1500) return; // very small loads
        // hallways and bathrooms are rarely given their own AC unless the load is large
        if ((r.type === 'hallway' || r.type === 'bathroom') && ra.req.btu < 5000) return;
        recs.push({ type: 'addAC', severity: 'critical', roomId: r.id, params: p, action: { kind: 'addAC', roomId: r.id, btu: ra.req.size } });
        insulationCheck(home, season, ra, p, recs);
        return;
      }

      if (ra.cap === 'under' || ra.perf === 'insufficient') {
        const lowFan = ra.acs.find((a) => a.fan === 'quiet' || a.fan === 'low');
        if (lowFan) {
          recs.push({ type: 'fanSetting', severity: 'info', roomId: r.id, params: p, action: { kind: 'fanAuto', acId: lowFan.id } });
        }
        const improved = insulationCheck(home, season, ra, p, recs);
        if (!improved && ra.cap === 'under') {
          recs.push({ type: 'undersized', severity: 'warning', roomId: r.id, params: p, action: { kind: 'resize', acId: ra.acs[0].id, btu: T.standardSize(ra.req.btu - (ra.inst - ra.acs[0].btu)) } });
        } else if (!improved && ra.perf === 'insufficient') {
          recs.push({ type: 'slow', severity: 'warning', roomId: r.id, params: p });
        }
      } else if (ra.cap === 'over') {
        recs.push({ type: 'oversized', severity: 'info', roomId: r.id, params: p });
      } else {
        recs.push({ type: 'suitable', severity: 'good', roomId: r.id, params: p });
      }

      // placement check
      ra.acs.forEach((a, k) => {
        const cov = ra.coverage[k];
        if (cov >= 0.85) return;
        const best = T.bestPlacement(a, r);
        if (best.cov - cov >= 0.1) {
          recs.push({ type: 'move', severity: 'info', roomId: r.id, params: Object.assign({}, p, { cov: Math.round(cov * 100), best: Math.round(best.cov * 100) }), action: { kind: 'move', acId: a.id, x: +best.pos.x.toFixed(2), y: +best.pos.y.toFixed(2), orient: best.pos.orient } });
        }
      });

      // a bed / sofa / desk in the cold (or hot) air stream
      if (ra.draftSeat) {
        const bs = T.bestSpots(ra.draftSeat.ac, r, home).best;
        const params = Object.assign({}, p, { item: Airly.i18n.t('furn.' + ra.draftSeat.seat.kind).toLowerCase() });
        recs.push({ type: 'draftSeat', severity: 'warning', roomId: r.id, params, action: bs && !bs.draft ? { kind: 'move', acId: ra.draftSeat.ac.id, x: +bs.x.toFixed(2), y: +bs.y.toFixed(2), orient: bs.orient } : null });
      }
      // sunlight
      if (season === 'cooling' && r.sun === 'high' && ra.geom.windowArea >= 1.5) {
        recs.push({ type: 'shading', severity: 'info', roomId: r.id, params: p });
      }
    });

    // operating settings of each AC
    home.acs.forEach((a, i) => {
      const r = home.rooms.find((x) => x.id === a.roomId);
      const p = { unit: `${Airly.i18n.t('ac.unit')} ${i + 1}`, room: r ? name(r) : '—', target: Airly.fmt.temp(a.target) };
      if (!r) { recs.push({ type: 'unassigned', severity: 'warning', params: p }); return; }
      if (!a.on) recs.push({ type: 'turnOn', severity: 'warning', roomId: r.id, params: p, action: { kind: 'turnOn', acId: a.id } });
      if (a.mode === 'cool' && season === 'heating') recs.push({ type: 'modeHeat', severity: 'warning', roomId: r.id, params: p, action: { kind: 'mode', acId: a.id, mode: 'heat' } });
      if (a.mode === 'heat' && season === 'cooling') recs.push({ type: 'modeCool', severity: 'warning', roomId: r.id, params: p, action: { kind: 'mode', acId: a.id, mode: 'cool' } });
      if (mode === 'cool' && a.mode !== 'heat' && a.target < 22) recs.push({ type: 'targetLow', severity: 'info', roomId: r.id, params: p, action: { kind: 'target', acId: a.id, target: 24 } });
      if (mode === 'heat' && a.mode !== 'cool' && a.target > 23) recs.push({ type: 'targetHigh', severity: 'info', roomId: r.id, params: p, action: { kind: 'target', acId: a.id, target: 21 } });
    });

    // maintenance reminder
    const last = home.maintenance.lastFilterClean;
    if (home.acs.length && (!last || Date.now() - last > 30 * 864e5)) {
      recs.push({ type: 'filter', severity: 'info', params: {} });
    }
    const order = { critical: 0, warning: 1, info: 2, good: 3 };
    return recs.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /* Would better insulation fix the room? adds a rec and returns true if so */
  function insulationCheck(home, season, ra, p, recs) {
    const r = ra.room;
    if (r.wallIns === 'good' && r.ceilIns === 'good' && r.floorIns === 'good') return false;
    const better = Object.assign({}, r, { wallIns: 'good', ceilIns: r.floorLevel === 'top' ? 'good' : r.ceilIns, floorIns: r.floorLevel === 'ground' ? 'good' : r.floorIns });
    const mode = modeOf(season);
    const reqBetter = T.required(better, mode, home.env).btu;
    const cut = ra.req.btu > 0 ? 1 - reqBetter / ra.req.btu : 0;
    if (cut < 0.15) return false;
    const fixes = ra.acs.length ? ra.inst >= reqBetter * 0.9 : false;
    recs.push({ type: fixes ? 'insulationFix' : 'insulation', severity: 'info', roomId: r.id, params: Object.assign({}, p, { pct: Math.round(cut * 100) }) });
    return fixes;
  }

  /* Build a proposed configuration applying the recommendations */
  function propose(home, season) {
    const recs = recommend(home, season);
    const h = Airly.clone(home);
    recs.forEach((rec) => applyAction(h, rec.action, true));
    return h;
  }

  function applyAction(home, action) {
    if (!action) return false;
    const acOf = (id) => home.acs.find((a) => a.id === id);
    switch (action.kind) {
      case 'addAC': {
        const r = home.rooms.find((x) => x.id === action.roomId);
        if (!r) return false;
        const a = Airly.factory.defaultAC(r.id, r.x + r.length / 2, r.y + 0.25, action.btu);
        a.mode = home.env.season === 'heating' ? 'heat' : 'cool';
        a.target = home.env.season === 'heating' ? home.env.desiredHeat : home.env.desiredCool;
        a.model = 'Split ' + Math.round(action.btu / 1000) + 'K';
        const best = T.bestPlacement(a, r);
        a.x = +best.pos.x.toFixed(2); a.y = +best.pos.y.toFixed(2); a.orient = best.pos.orient;
        home.acs.push(a);
        return true;
      }
      case 'resize': { const a = acOf(action.acId); if (a) a.btu = action.btu; return !!a; }
      case 'move': { const a = acOf(action.acId); if (a) { a.x = action.x; a.y = action.y; if (action.orient) a.orient = action.orient; } return !!a; }
      case 'turnOn': { const a = acOf(action.acId); if (a) a.on = true; return !!a; }
      case 'fanAuto': { const a = acOf(action.acId); if (a) a.fan = 'auto'; return !!a; }
      case 'mode': { const a = acOf(action.acId); if (a) a.mode = action.mode; return !!a; }
      case 'target': { const a = acOf(action.acId); if (a) a.target = action.target; return !!a; }
      case 'openDoors': {
        action.doorIds.forEach(([roomId, doorId]) => {
          const r = home.rooms.find((x) => x.id === roomId);
          const d = r && r.doors.find((x) => x.id === doorId);
          if (d) d.open = true;
        });
        return true;
      }
    }
    return false;
  }

  /* ---------- Energy ---------- */
  const clampH = (v) => Math.max(0.5, Math.min(24, v || 8));
  function opStart() {
    const v = T.parseHM(Airly.store.prefs.opStart || '16:00');
    return v == null ? 16 : v;
  }
  /* hours per day an AC runs: its own timer, or the calculator's daily hours */
  function opHoursOf(a, hours) {
    if (a.schedule && a.schedule.enabled && a.schedule.periods && a.schedule.periods.length) {
      return a.schedule.periods.reduce((sum, p) => {
        const on = T.parseHM(p.on), off = T.parseHM(p.off);
        if (on == null || off == null) return sum;
        return sum + (off > on ? off - on : 24 - on + off);
      }, 0);
    }
    return hours;
  }
  /* One representative day. With the day/night cycle the home is simulated for 48 h from midnight
     and the second day is measured, so the result includes the night, the afternoon peak and timers.
     extra: { alwaysOn, forceWindow:[on,off], envPatch } */
  const energyMemo = new Map();
  function energy(home, season, hours, extra) {
    const key = JSON.stringify([home.rooms, home.acs, home.env, season, hours, extra || null, Airly.store.prefs.opStart]);
    if (energyMemo.has(key)) return energyMemo.get(key);
    const res = energyRaw(home, season, hours, extra);
    energyMemo.set(key, res);
    if (energyMemo.size > 80) energyMemo.delete(energyMemo.keys().next().value);
    return res;
  }
  function energyRaw(home, season, hours, extra) {
    extra = extra || {};
    hours = clampH(hours);
    const mode = modeOf(season);
    const h = withSeason(home, season);
    if (extra.envPatch) Object.assign(h.env, extra.envPatch);
    let pred;
    const start = opStart();
    if (h.env.dayCycle) {
      const window = hours >= 24 ? null : [start, (start + hours) % 24];
      const o = { forceMode: mode, season, hours: 48, clock0: 0, measureFrom: 24 * 3600, sampleEvery: 1800, opWindow: window, ignoreDays: true };
      if (extra.alwaysOn) o.alwaysOn = true;
      if (extra.forceWindow) { o.ignoreSchedules = false; o.opWindow = extra.forceWindow; h.acs.forEach((x) => (x.schedule = { enabled: true, periods: [{ on: hm(extra.forceWindow[0]), off: hm(extra.forceWindow[1]) }] })); }
      pred = T.predict(h, o);
    } else {
      pred = T.predict(h, { forceMode: mode, hours, season, ignoreSchedules: true });
    }
    const billK = h.env.energyCalib > 0 ? h.env.energyCalib : 1; // from "match my electricity bill"
    const perAC = h.acs.map((ac) => {
      const p = pred.perAC.find((x) => x.id === ac.id);
      const rated = T.acRatedKW(ac, mode);
      // a timer that runs only some days of the week: average over the week (e.g. weekdays = 5/7)
      const own = !extra.alwaysOn && !extra.forceWindow && h.env.dayCycle && ac.schedule && ac.schedule.enabled && ac.schedule.periods && ac.schedule.periods.length;
      const share = own ? T.scheduleDays(ac.schedule).filter(Boolean).length / 7 : 1;
      const kWh = (p ? p.kWh : 0) * billK * share;
      const oh = (extra.alwaysOn ? 24 : extra.forceWindow ? spanOf(extra.forceWindow) : h.env.dayCycle ? opHoursOf(ac, hours) : hours) * share;
      return { ac, rated, opHours: oh, avgKW: oh > 0 ? kWh / oh : 0, dailyKWh: kWh, maxDailyKWh: rated * oh };
    });
    // discomfort only counts rooms that have their own AC
    const acRooms = new Set(h.acs.map((x) => x.roomId));
    const discomfort = h.rooms.reduce((sum, r, i) => sum + (acRooms.has(r.id) ? pred.discomfort[i] : 0), 0);
    return { perAC, dailyKWh: perAC.reduce((sum, x) => sum + x.dailyKWh, 0), maxDailyKWh: perAC.reduce((sum, x) => sum + x.maxDailyKWh, 0), discomfort, pred };
  }
  const hm = (v) => String(Math.floor(v) % 24).padStart(2, '0') + ':' + String(Math.round((v % 1) * 60)).padStart(2, '0');
  const spanOf = (w) => (w[1] > w[0] ? w[1] - w[0] : 24 - w[0] + w[1]);

  /* "Is it cheaper to leave it on all day?" — compare operating strategies over one day */
  function strategies(home, season, prefs) {
    const hasTimers = home.acs.some((a) => a.schedule && a.schedule.enabled);
    const list = [
      { key: 'always', en: energy(home, season, 24, { alwaysOn: true }) },
      { key: hasTimers ? 'timers' : 'hours', en: energy(home, season, prefs.hours) },
      { key: 'evening', en: energy(home, season, 6, { forceWindow: [17, 23] }) },
    ];
    list.forEach((x) => (x.monthly = x.en.dailyKWh * prefs.days * prefs.price));
    return list;
  }

  /* ---------- Climate (typical monthly average daily high / low, °C — approximate) ---------- */
  const CLIMATES = {
    tirana: { hi: [12, 14, 17, 20, 25, 29, 32, 32, 28, 23, 17, 13], lo: [2, 3, 5, 8, 13, 16, 18, 18, 15, 11, 6, 3] },
    durres: { hi: [13, 14, 16, 19, 23, 28, 31, 31, 27, 23, 18, 14], lo: [5, 5, 7, 10, 14, 18, 21, 21, 17, 13, 9, 6] },
    shkoder: { hi: [10, 12, 16, 19, 24, 29, 32, 32, 27, 21, 15, 11], lo: [2, 3, 6, 9, 13, 17, 19, 19, 15, 11, 7, 3] },
    korce: { hi: [5, 7, 11, 15, 20, 25, 28, 28, 24, 18, 11, 6], lo: [-4, -3, 0, 3, 7, 11, 13, 13, 9, 5, 1, -2] },
    prishtina: { hi: [3, 6, 12, 17, 22, 26, 29, 29, 24, 18, 10, 4], lo: [-5, -4, 0, 4, 9, 12, 14, 14, 10, 5, 1, -3] },
    skopje: { hi: [5, 9, 15, 19, 25, 29, 32, 32, 27, 20, 12, 6], lo: [-3, -2, 2, 6, 10, 14, 16, 16, 12, 7, 2, -2] },
    athens: { hi: [14, 15, 17, 21, 26, 31, 34, 34, 29, 24, 19, 15], lo: [7, 7, 9, 12, 16, 21, 23, 23, 19, 15, 11, 8] },
    rome: { hi: [12, 14, 16, 19, 24, 28, 31, 31, 27, 22, 16, 13], lo: [3, 4, 6, 8, 12, 16, 18, 18, 15, 11, 7, 4] },
    madrid: { hi: [10, 12, 16, 18, 22, 28, 32, 31, 26, 19, 13, 10], lo: [3, 3, 6, 8, 11, 16, 19, 19, 15, 11, 6, 3] },
    berlin: { hi: [3, 4, 9, 14, 19, 22, 24, 24, 19, 14, 8, 4], lo: [-2, -2, 1, 4, 9, 12, 14, 14, 10, 6, 2, -1] },
    london: { hi: [8, 9, 12, 15, 18, 21, 23, 23, 20, 16, 11, 9], lo: [3, 3, 4, 6, 9, 12, 14, 14, 12, 9, 5, 3] },
    newyork: { hi: [4, 6, 10, 17, 22, 27, 30, 29, 25, 18, 12, 7], lo: [-3, -2, 2, 7, 12, 18, 21, 20, 16, 10, 5, 0] },
    dubai: { hi: [24, 25, 28, 33, 37, 39, 41, 41, 38, 35, 30, 26], lo: [14, 15, 18, 21, 25, 28, 30, 30, 27, 23, 19, 16] },
  };
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function climateOf(env) {
    if (env.climate === 'custom' && env.customClimate && env.customClimate.hi && env.customClimate.lo) return env.customClimate;
    return CLIMATES[env.climate] || CLIMATES.tirana;
  }
  /* AC need per month: cooling when afternoons reach 26 °C, heating when the daily mean is ≤ 14 °C */
  function monthMode(hi, lo) {
    if (hi >= 26) return 'cooling';
    if ((hi + lo) / 2 <= 14) return 'heating';
    return null;
  }
  let yearCache = { key: null, value: null };
  function yearly(home, prefs) {
    const cl = climateOf(home.env);
    const key = JSON.stringify([home.rooms, home.acs, home.env, cl, prefs.hours, prefs.days, prefs.price, prefs.opStart]);
    if (yearCache.key === key) return yearCache.value;
    const use = Math.min(1, (prefs.days || 30) / 30);
    const months = cl.hi.map((hi, m) => {
      const lo = cl.lo[m];
      const season = monthMode(hi, lo);
      if (!season || !home.acs.length) return { m, hi, lo, season, kWh: 0, cost: 0 };
      const patch = season === 'cooling'
        ? { dayCycle: true, outsideSummer: hi, swingSummer: Math.max(2, hi - lo), initialSummer: Math.min(hi, 27) }
        : { dayCycle: true, outsideWinter: lo, swingWinter: Math.max(2, hi - lo), initialWinter: Math.max(lo + 4, 14) };
      const en = energy(home, season, prefs.hours, { envPatch: patch });
      const kWh = en.dailyKWh * DAYS_IN_MONTH[m] * use;
      return { m, hi, lo, season, kWh, cost: kWh * prefs.price, discomfort: en.discomfort };
    });
    const value = {
      months,
      kWh: months.reduce((sum, x) => sum + x.kWh, 0),
      cost: months.reduce((sum, x) => sum + x.cost, 0),
      coolKWh: months.filter((x) => x.season === 'cooling').reduce((sum, x) => sum + x.kWh, 0),
      heatKWh: months.filter((x) => x.season === 'heating').reduce((sum, x) => sum + x.kWh, 0),
    };
    yearCache = { key, value };
    return value;
  }

  /* ---------- Calibration with a real measurement ----------
     meas: { outside, start, end, minutes, acId } (°C / minutes). Tries insulation, sun exposure and a
     fine factor and keeps the combination whose simulated end temperature matches the measurement. */
  function calibrate(home, roomId, meas) {
    const ri = home.rooms.findIndex((r) => r.id === roomId);
    if (ri < 0) return null;
    const ac = home.acs.find((a) => a.id === meas.acId);
    const season = ac ? (ac.mode === 'heat' ? 'heating' : 'cooling') : meas.outside < meas.start ? 'heating' : 'cooling';
    const simEnd = (patch) => {
      const h = Airly.clone(home);
      Object.assign(h.rooms[ri], patch);
      h.env = Object.assign({}, h.env, { dayCycle: false, season, outsideSummer: meas.outside, outsideWinter: meas.outside, initialSummer: meas.start, initialWinter: meas.start });
      h.rooms.forEach((r) => (r.initialTemp = meas.start));
      h.acs.forEach((a) => { a.on = !!ac && a.id === ac.id; a.schedule = null; });
      const p = T.predict(h, { hours: Math.max(5, meas.minutes) / 60, sampleEvery: 600, ignoreSchedules: true });
      return p.final[ri];
    };
    const r = home.rooms[ri];
    const current = simEnd({});
    let best = null;
    Airly.QUALITY.forEach((wallIns) => Airly.SUN.forEach((sun) => {
      for (let k = 0.5; k <= 2.001; k += 0.1) {
        const end = simEnd({ wallIns, sun, calib: +k.toFixed(2) });
        const changes = (wallIns !== r.wallIns ? 1 : 0) + (sun !== r.sun ? 1 : 0);
        const score = Math.abs(end - meas.end) + 0.06 * changes + 0.03 * Math.abs(k - 1);
        if (!best || score < best.score) best = { wallIns, sun, calib: +k.toFixed(2), end, score };
      }
    }));
    return { current, best, measured: meas.end };
  }

  /* ---------- Pre-cool / pre-heat planner ----------
     "I get home at 18:00 and want 24 °C": the house runs without this room's AC through the day,
     then the AC is switched on at a start time; find the latest start time that is good enough. */
  function precool(home, roomId, arriveH, targetC, season) {
    const mode = modeOf(season);
    const h = withSeason(home, season);
    h.env.dayCycle = true;
    const ri = h.rooms.findIndex((r) => r.id === roomId);
    const roomACs = h.acs.filter((a) => a.roomId === roomId).map((a) => a.id);
    if (ri < 0 || !roomACs.length) return null;
    const dt = 30;
    const arriveT = 24 * 3600 + arriveH * 3600; // day 2 (day 1 warms the house up realistically)
    const run = (startT) => {
      const m = T.buildModel(h, { season, cycle: true, clock0: 0, forceMode: mode, ignoreSchedules: true });
      m.acs.forEach((a) => { a.on = false; a.target = targetC; });
      let kwh = 0;
      while (m.t < arriveT) {
        if (m.t >= startT) m.acs.forEach((a) => { if (roomACs.includes(a.id) && !a.on) a.on = true; });
        const before = m.acs.reduce((s, a) => s + a.kWhCool + a.kWhHeat, 0);
        T.step(m, dt);
        if (m.t > startT) kwh += m.acs.reduce((s, a) => s + a.kWhCool + a.kWhHeat, 0) - before;
      }
      const temp = m.rooms[ri].T;
      const ok = mode === 'cool' ? temp <= targetC + 0.5 : temp >= targetC - 0.5;
      return { temp, ok, kwh };
    };
    // latest start (in 15-minute steps, up to 8 h before arriving) that still reaches the target
    // already comfortable without switching on early?
    const none = run(arriveT);
    if (none.ok) return { reachable: true, notNeeded: true, temp: none.temp, kwh: 0, startH: arriveH, minutes: 0 };
    let lo = 0, hi = 32, best = null; // number of quarter hours before arrival
    const at = (q) => run(arriveT - q * 900);
    const longest = at(hi);
    if (!longest.ok) return { reachable: false, startH: (arriveH - 8 + 24) % 24, temp: longest.temp, kwh: longest.kwh };
    best = { q: hi, res: longest };
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const r = at(mid);
      if (r.ok) { hi = mid; best = { q: mid, res: r }; } else lo = mid;
    }
    const startH = (((arriveH - best.q / 4) % 24) + 24) % 24;
    return { reachable: true, startH, minutes: best.q * 15, temp: best.res.temp, kwh: best.res.kwh };
  }

  /* ---------- Purchase comparison ---------- */
  /* option: { name, price, btu, rating, inverter, powerKW } installed in roomId (replacing its ACs or added) */
  function withPurchase(home, roomId, option, replace) {
    const h = Airly.clone(home);
    const r = h.rooms.find((x) => x.id === roomId);
    if (!r) return h;
    if (replace) h.acs = h.acs.filter((x) => x.roomId !== roomId);
    const ac = Airly.factory.defaultAC(r.id, r.x + r.length / 2, r.y + 0.25, +option.btu || 9000);
    ac.id = 'purchase';
    ac.brand = option.name || 'Option';
    ac.model = '';
    ac.rating = option.rating || 'A++';
    ac.inverter = option.inverter !== false;
    ac.powerKW = option.powerKW > 0 ? +option.powerKW : null;
    ac.target = h.env.desiredCool;
    const best = T.bestPlacement(ac, r);
    ac.x = +best.pos.x.toFixed(2); ac.y = +best.pos.y.toFixed(2); ac.orient = best.pos.orient;
    h.acs.push(ac);
    return h;
  }
  function purchase(home, cfg, prefs) {
    const cl = climateOf(home.env);
    const hottest = cl.hi.indexOf(Math.max(...cl.hi));
    const coldest = cl.lo.indexOf(Math.min(...cl.lo));
    const evalOption = (opt) => {
      const h = withPurchase(home, cfg.roomId, opt, cfg.replace);
      const y = yearly(h, prefs);
      // comfort on the hottest and coldest typical day
      const hotH = Airly.clone(h); Object.assign(hotH.env, { dayCycle: true, outsideSummer: cl.hi[hottest], swingSummer: Math.max(2, cl.hi[hottest] - cl.lo[hottest]) });
      const coldH = Airly.clone(h); Object.assign(coldH.env, { dayCycle: true, outsideWinter: cl.lo[coldest], swingWinter: Math.max(2, cl.hi[coldest] - cl.lo[coldest]) });
      coldH.acs.forEach((x) => (x.target = h.env.desiredHeat));
      const aHot = analyze(hotH, 'cooling');
      const aCold = analyze(coldH, 'heating');
      const i = h.rooms.findIndex((r) => r.id === cfg.roomId);
      return {
        opt, yearly: y,
        hot: aHot.rooms[i], cold: aCold.rooms[i],
        price: +opt.price || 0,
        total10: (+opt.price || 0) + y.cost * 10,
      };
    };
    const A = evalOption(cfg.A), B = evalOption(cfg.B);
    const dPrice = B.price - A.price, dCost = A.yearly.cost - B.yearly.cost;
    let payback = null;
    if (dPrice > 0 && dCost > 0) payback = dPrice / dCost;
    else if (dPrice < 0 && dCost < 0) payback = -dPrice / -dCost; // A is dearer but cheaper to run
    return { A, B, payback, cheaperToRun: dCost > 0 ? 'B' : dCost < 0 ? 'A' : null, cheaperToBuy: dPrice > 0 ? 'A' : dPrice < 0 ? 'B' : null };
  }

  /* Compare two homes (configurations) */
  function compare(homeA, homeB, season, prefs) {
    const run = (h) => {
      const an = analyze(h, season);
      const en = energy(h, season, prefs.hours);
      return { an, en, monthlyCost: en.dailyKWh * prefs.days * prefs.price };
    };
    return { A: run(homeA), B: run(homeB) };
  }

  Airly.CLIMATES = CLIMATES;
  Airly.advisor = { analyze, recommend, propose, applyAction, energy, compare, sizeRange, modeOf, strategies, yearly, purchase, climateOf, monthMode, opHoursOf, calibrate, precool };
})();

/* Airly — simplified lumped-capacitance thermal model.
 * Every room is one thermal node. Heat flows between each room and the outside
 * (walls, windows, ceiling, floor, infiltration), between connected rooms
 * (shared walls, doors, open-plan openings) and from AC units, people,
 * appliances and the sun. Results are ESTIMATES, not HVAC engineering values. */
(function () {
  'use strict';
  const Airly = window.Airly;

  const BTU_TO_W = 0.29307107;
  const AIR_HEAT_CAP = 1206; // J/(m³·K)  (ρ·cp of air)
  const AIR_FURNITURE = 4; // air node: room air plus furniture
  const MASS_PER_M2 = 60000; // J/K per m² floor: walls, floor slab, ceiling (structural mass node)
  const START_DELAY = 60; // s: fan runs first, compressor starts after ~1 min
  const RAMP_TIME = 120; // s: inverter compressor ramps up to full speed
  const H_SURF = 1.6; // W/(m²·K) convective coupling between air and room surfaces
  const SOLAR_TO_MASS = 0.6; // share of sun absorbed by floor/walls first
  const U_WALL = { poor: 1.8, medium: 0.8, good: 0.35 };
  const U_CEIL = { poor: 1.6, medium: 0.6, good: 0.25 };
  const U_FLOOR = { poor: 1.2, medium: 0.5, good: 0.25 };
  const ACH = { poor: 1.4, medium: 0.9, good: 0.45 }; // air changes per hour (leaks, short airings)
  const SUN_W = { low: 60, medium: 160, high: 300 }; // W/m² of glazing (daytime average)
  const U_WINDOW = 2.8;
  const SHGC = 0.55;
  const U_INTERIOR = 1.8;
  const DOOR_MIX_G = 8; // W/(m²·K): background mixing through an open door even without a temperature difference
  const DOOR_CD = 0.6; // discharge coefficient of a doorway
  const DOOR_CLOSED_U = 2.5;
  const OPEN_PLAN_MIX_G = 15; // W/(m²·K) background mixing across an open-plan connection
  const COP = { 'A+++': 4.3, 'A++': 3.7, 'A+': 3.4, A: 3.1, B: 2.8, C: 2.5 };
  const FAN_F = { auto: 1, quiet: 0.6, low: 0.75, medium: 0.9, high: 1.05 };
  const FAN_THROW = { auto: 1, quiet: 0.7, low: 0.8, medium: 0.92, high: 1.1 };
  const DIR_F = {
    cool: { auto: 1, swing: 0.98, up: 1, middle: 0.96, down: 0.9 },
    heat: { auto: 1, swing: 0.98, up: 0.88, middle: 0.95, down: 1 },
  };
  const NEIGHBOR_FACTOR = 0.15; // ceiling/floor towards conditioned neighbours
  const SOL_AIR = { low: 3, medium: 6, high: 10 }; // extra K on sunlit exterior walls (cooling)
  const ROOF_SOL_AIR = 15; // extra K on a top-floor ceiling in summer
  const AVG_SUN = 0.7; // average share of peak sun through windows over the day
  const AVG_SOLAIR = 0.35; // sun on walls/roof averages far below its peak
  const AVG_USE = 0.6; // people and appliances are not present/on all the time
  const SHR = 0.75; // sensible share of cooling output (rest removes humidity)
  const LATENT_FACTOR = 1 / SHR;
  const MOIST_BUFFER = 6; // furniture/fabrics buffer moisture: humidity changes slower than air alone
  const LATENT_HEAT = 2.45e6; // J/kg water
  const COIL_W = 0.0080; // kg/kg: the AC coil only dries air above roughly this moisture content

  /* ---------- day / night cycle ---------- */
  const WALL_AZ = { top: 0, right: 90, bottom: 180, left: 270 }; // azimuth when the top of the plan faces north
  const NORTH_OFFSET = { top: 0, right: 270, bottom: 180, left: 90 };
  function outsideAt(env, season, h) {
    if (!env.dayCycle) return season === 'heating' ? env.outsideWinter : env.outsideSummer;
    const c = (1 + Math.cos((2 * Math.PI * (h - 15)) / 24)) / 2; // 1 at 15:00, 0 at 03:00
    // summer: the entered value is the afternoon high; winter: it is the coldest (night) value
    return season === 'heating' ? env.outsideWinter + (env.swingWinter || 0) * c : env.outsideSummer - (env.swingSummer || 0) * (1 - c);
  }
  function dailyMeanOutside(env, season) {
    if (!env.dayCycle) return season === 'heating' ? env.outsideWinter : env.outsideSummer;
    return season === 'heating' ? env.outsideWinter + (env.swingWinter || 0) / 2 : env.outsideSummer - (env.swingSummer || 0) / 2;
  }
  function sunAt(season, h) {
    const rise = season === 'heating' ? 7.5 : 6, set = season === 'heating' ? 16.5 : 20.5;
    if (h <= rise || h >= set) return { e: 0, az: 0 };
    const f = (h - rise) / (set - rise);
    return { e: Math.sin(Math.PI * f), az: 90 + 180 * f }; // rises in the east (90°), sets in the west (270°)
  }
  function windowSun(wall, north, sun) {
    if (!sun.e) return 0;
    const A = (WALL_AZ[wall] + (NORTH_OFFSET[north] || 0)) % 360;
    const d = Math.cos(((sun.az - A) * Math.PI) / 180);
    return sun.e * (0.15 + 0.85 * Math.max(0, d) * (1 - 0.5 * sun.e)) * 1.6;
  }
  /* share of the people usually in a room who are present at hour h */
  function occupancy(type, h) {
    const inR = (a, b) => h >= a && h < b;
    switch (type) {
      case 'bedroom': return h >= 22 || h < 7 ? 1 : inR(7, 8) ? 0.5 : 0.15;
      case 'living': case 'dining': return inR(18, 23) ? 1 : inR(7, 9) ? 0.5 : inR(12, 14) ? 0.4 : inR(9, 18) ? 0.25 : 0.05;
      case 'kitchen': return inR(7, 8.5) || inR(12, 13.5) || inR(18.5, 20.5) ? 1 : inR(7, 22) ? 0.15 : 0;
      case 'office': return inR(9, 18) ? 1 : 0.1;
      case 'bathroom': return inR(7, 8) || inR(21, 22) ? 1 : 0.05;
      default: return inR(7, 23) ? 0.3 : 0.1;
    }
  }
  function hourOf(m) {
    return (((m.clock0 * 3600 + m.t) / 3600) % 24 + 24) % 24;
  }
  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
    return m ? (+m[1] % 24) + +m[2] / 60 : null;
  }
  function inPeriods(periods, h) {
    return periods.some(([a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b));
  }
  function isNight(h) {
    return h >= 23 || h < 7;
  }

  /* ---------- humidity ---------- */
  function pSat(T) { return 610.94 * Math.exp((17.625 * T) / (T + 243.04)); }
  function wFromRH(T, rh) { const p = (rh / 100) * pSat(T); return (0.622 * p) / (101325 - p); }
  function rhFromW(T, w) { const p = (w * 101325) / (0.622 + w); return clamp((100 * p) / pSat(T), 1, 100); }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- Geometry ---------- */
  function wallLength(r, wall) {
    return wall === 'top' || wall === 'bottom' ? r.length : r.width;
  }
  function openingCenter(r, o) {
    const c = o.offset + o.w / 2;
    switch (o.wall) {
      case 'top': return { x: r.x + c, y: r.y };
      case 'bottom': return { x: r.x + c, y: r.y + r.width };
      case 'left': return { x: r.x, y: r.y + c };
      default: return { x: r.x + r.length, y: r.y + c };
    }
  }
  function geometry(r) {
    const area = r.length * r.width;
    const volume = area * r.height;
    const windowArea = r.windows.reduce((s, w) => s + w.w * w.h, 0);
    const doorArea = r.doors.reduce((s, d) => s + d.w * d.h, 0);
    const avgWall = (r.length + r.width) / 2;
    const extWallGross = clamp(r.exteriorWalls, 0, 4) * avgWall * r.height;
    const extWallNet = Math.max(0, extWallGross - windowArea);
    return { area, volume, windowArea, doorArea, extWallGross, extWallNet, perimeter: 2 * (r.length + r.width) };
  }

  /* Detect which walls of a room touch other rooms (for "auto exterior walls") */
  function exteriorWallCount(home, r) {
    const links = adjacency(home);
    let count = 0;
    Airly.WALLS.forEach((wall) => {
      const len = wallLength(r, wall);
      const shared = links
        .filter((l) => (l.a === r.id && l.sideA === wall) || (l.b === r.id && l.sideB === wall))
        .reduce((s, l) => s + l.len, 0);
      if (shared < len * 0.5) count++;
    });
    return count;
  }

  /* Find rooms sharing a wall segment */
  function adjacency(home) {
    const tol = 0.2;
    const rooms = home.rooms;
    const out = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const A = rooms[i], B = rooms[j];
        if ((A.level || 0) !== (B.level || 0)) continue;
        const sameSpace = !!(A.group && A.group === B.group);
        const tests = [
          // [A side, B side, A edge coord, B edge coord, overlap axis]
          ['right', 'left', A.x + A.length, B.x, 'y'],
          ['left', 'right', A.x, B.x + B.length, 'y'],
          ['bottom', 'top', A.y + A.width, B.y, 'x'],
          ['top', 'bottom', A.y, B.y + B.width, 'x'],
        ];
        tests.forEach(([sa, sb, ea, eb, axis]) => {
          if (Math.abs(ea - eb) > tol) return;
          const a0 = axis === 'y' ? A.y : A.x, a1 = axis === 'y' ? A.y + A.width : A.x + A.length;
          const b0 = axis === 'y' ? B.y : B.x, b1 = axis === 'y' ? B.y + B.width : B.x + B.length;
          const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
          const len = hi - lo;
          if (len < 0.3) return;
          // doors located on this shared segment (from either room)
          const doors = [];
          const collect = (room, side) => {
            room.doors.forEach((d) => {
              if (d.wall !== side) return;
              const c = openingCenter(room, d);
              const v = axis === 'y' ? c.y : c.x;
              if (v >= lo - 0.05 && v <= hi + 0.05) doors.push({ room: room.id, door: d, center: c });
            });
          };
          collect(A, sa);
          collect(B, sb);
          out.push({ a: A.id, b: B.id, sideA: sa, sideB: sb, len, lo, hi, axis, doors, openPlan: !!(A.openPlan && B.openPlan) || sameSpace, group: sameSpace });
        });
      }
    }
    return out;
  }

  /* Air exchange through an opening driven by the temperature difference (cold air flows out
     at the bottom, warm air comes back at the top): V = Cd/3 · W · sqrt(g · H³ · ΔT / T).
     Returned as an equivalent conductance in W/K for the given ΔT. */
  function buoyancyG(openings, dT) {
    if (!openings || !openings.length) return 0;
    const d = Math.abs(dT);
    if (d < 0.01) return 0;
    return openings.reduce((sum, o) => sum + AIR_HEAT_CAP * (DOOR_CD / 3) * o.w * Math.sqrt((9.81 * o.h * o.h * o.h * d) / 297), 0);
  }
  function linkConductance(link, home) {
    const A = home.rooms.find((r) => r.id === link.a);
    const B = home.rooms.find((r) => r.id === link.b);
    const h = Math.min(A.height, B.height);
    if (link.openPlan) {
      const openings = [{ w: link.len, h }];
      return { G: link.len * h * OPEN_PLAN_MIX_G, open: true, openings, Gtyp: link.len * h * OPEN_PLAN_MIX_G + buoyancyG(openings, 3) };
    }
    let doorArea = 0, G = 0, open = false;
    const openings = [];
    link.doors.forEach(({ door }) => {
      const a = door.w * door.h;
      doorArea += a;
      if (door.open) {
        G += a * DOOR_MIX_G;
        openings.push({ w: door.w, h: Math.min(door.h, h) });
        open = true;
      } else G += a * DOOR_CLOSED_U;
    });
    G += Math.max(0, link.len * h - doorArea) * U_INTERIOR;
    return { G, open, openings, Gtyp: G + buoyancyG(openings, 3) };
  }

  /* ---------- Room loads ---------- */
  function roomUA(r) {
    const g = geometry(r);
    const k = r.calib > 0 ? r.calib : 1; // calibration from the user's own measurement
    const wall = g.extWallNet * U_WALL[r.wallIns];
    const win = g.windowArea * U_WINDOW;
    const ceilF = r.floorLevel === 'top' ? 1 : NEIGHBOR_FACTOR;
    const ceil = g.area * U_CEIL[r.ceilIns] * ceilF;
    const floorF = r.floorLevel === 'ground' ? 1 : NEIGHBOR_FACTOR;
    const floor = g.area * U_FLOOR[r.floorIns] * floorF;
    const infil = 0.33 * ACH[r.wallIns] * g.volume;
    // ground-floor floors exchange heat with the ground, not the outside air
    const toOutside = wall + win + ceil + infil + (r.floorLevel === 'ground' ? 0 : floor);
    const toGround = r.floorLevel === 'ground' ? floor : 0;
    return { ua: toOutside * k, uaGround: toGround * k, parts: { wall: wall * k, win: win * k, ceil: ceil * k, floor: floor * k, infil: infil * k } };
  }
  function groundTemp(outside) {
    return (outside + 15) / 2;
  }
  /* peak = design-hour values (used to size the AC); otherwise daily-average values for the running
     simulation: the sun is not at its peak all day and people/appliances are not always present. */
  function roomGains(r, season, peak) {
    const g = geometry(r);
    const avgSun = peak ? 1 : AVG_SUN, avgUse = peak ? 1 : AVG_USE;
    const k = r.calib > 0 ? r.calib : 1;
    const solar = g.windowArea * SHGC * SUN_W[r.sun] * (season === 'heating' ? 0.45 : 1) * avgSun * k;
    const internal = (r.people * 90 + r.appliancesW) * avgUse;
    // sun-heated exterior walls / roof add heat in summer (sol-air temperature)
    let solAir = 0;
    if (season !== 'heating') {
      const ua = roomUA(r);
      solAir = (ua.parts.wall * SOL_AIR[r.sun] + (r.floorLevel === 'top' ? ua.parts.ceil * ROOF_SOL_AIR : 0)) * (peak ? 1 : AVG_SOLAIR);
    }
    return { solar, internal, solAir, total: solar + internal + solAir };
  }

  /* Estimated required capacity (W and BTU/h) for one room */
  function required(r, mode, env) {
    const { ua, uaGround } = roomUA(r);
    let W;
    if (mode === 'cool') {
      const tIn = env.desiredCool;
      const tOut = env.outsideSummer;
      const gains = roomGains(r, 'cooling', true);
      W = (ua * (tOut - tIn) + uaGround * (groundTemp(tOut) - tIn) + gains.total) * LATENT_FACTOR; // include dehumidification load
    } else {
      const tIn = env.desiredHeat;
      const tOut = env.outsideWinter;
      // internal gains are not credited for heating (conservative)
      W = ua * (tIn - tOut) + uaGround * (tIn - groundTemp(tOut));
    }
    W = Math.max(0, W) * 1.15; // 15 % margin for pull-down and uncertainty
    const btu = W / BTU_TO_W;
    return { W, btu, size: standardSize(btu) };
  }
  function standardSize(btu) {
    const sizes = Airly.STANDARD_BTU;
    for (let i = 0; i < sizes.length; i++) if (sizes[i] >= btu * 0.95) return sizes[i];
    return Math.ceil(btu / 6000) * 6000;
  }

  /* ---------- AC helpers ---------- */
  function acCapacityW(ac) {
    return ac.btu * BTU_TO_W;
  }
  function acRatedKW(ac, mode) {
    if (ac.powerKW && ac.powerKW > 0) return ac.powerKW;
    const cop = (COP[ac.rating] || 3.2) + (mode === 'heat' ? 0.3 : 0);
    return acCapacityW(ac) / 1000 / cop;
  }
  function acThrow(ac) {
    return (3 + ac.btu / 3000) * (FAN_THROW[ac.fan] || 1);
  }
  function derate(mode, outside) {
    if (mode === 'cool') return clamp(1 - Math.max(0, outside - 35) * 0.015, 0.6, 1);
    return clamp(1 - Math.max(0, 7 - outside) * 0.02, 0.5, 1);
  }
  /* ---------- Furniture ---------- */
  const TALL = 1.4; // furniture at least this tall blocks the air jet (wardrobes, fridges, shelves)
  function homeFurniture() {
    return (Airly.store && Airly.store.state && Airly.store.state.furniture) || [];
  }
  function blockersIn(r, furn) {
    return (furn || homeFurniture()).filter((f) => f.kind !== 'stairs' && f.h >= TALL && (f.level || 0) === (r.level || 0) &&
      f.x < r.x + r.length && f.x + f.w > r.x && f.y < r.y + r.width && f.y + f.d > r.y);
  }
  /* does the straight line from (x1,y1) to (x2,y2) pass through box b? (slab test) */
  function segHitsBox(x1, y1, x2, y2, b) {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, x1 - b.x) && clip(dx, b.x + b.w - x1) && clip(-dy, y1 - b.y) && clip(dy, b.y + b.d - y1) && t0 < t1;
  }
  function blocked(x1, y1, x2, y2, boxes) {
    return boxes.some((b) => segHitsBox(x1, y1, x2, y2, b));
  }
  function coverage(ac, r, pos, furn) {
    const p = pos || ac;
    const R = acThrow(ac);
    const boxes = blockersIn(r, furn);
    const N = 12;
    let inside = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = r.x + ((i + 0.5) / N) * r.length;
        const y = r.y + ((j + 0.5) / N) * r.width;
        if (Math.hypot(x - p.x, y - p.y) <= R && !blocked(p.x, p.y, x, y, boxes)) inside++;
      }
    }
    return inside / (N * N);
  }
  /* direction an AC blows: away from the wall it is mounted on */
  function acDir(a, r, pos) {
    const p = pos || a;
    const o = (pos && pos.orient) || a.orient;
    if (o === 'v') return p.x - r.x < r.x + r.length - p.x ? { nx: 1, nz: 0 } : { nx: -1, nz: 0 };
    return p.y - r.y < r.y + r.width - p.y ? { nx: 0, nz: 1 } : { nx: 0, nz: -1 };
  }
  const FAN_V = { auto: 1, quiet: 0.6, low: 0.75, medium: 0.9, high: 1.15 };
  /* How a spot feels: local temperature (near the jet colder/warmer than the room average,
     corners the air does not reach drift the other way) and air speed (draft).
     m = running model (or null for "AC at full output" planning), x/z in meters. */
  function feelAt(home, m, x, z, opts) {
    opts = opts || {};
    const r = opts.room || home.rooms.find((q) => (opts.level == null || (q.level || 0) === opts.level) && x >= q.x && x <= q.x + q.length && z >= q.y && z <= q.y + q.width);
    if (!r) return null;
    const i = home.rooms.indexOf(r);
    const T = m && m.rooms[i] ? m.rooms[i].T : null;
    const boxes = blockersIn(r, home.furniture);
    let dT = 0, v = 0;
    const acs = opts.acs || home.acs.filter((a) => a.roomId === r.id && a.on);
    acs.forEach((a) => {
      const ma = m && m.acs.find((q) => q.id === a.id);
      let f, mode;
      if (opts.assumeFull) { f = 0.8; mode = a.mode === 'heat' ? 'heat' : 'cool'; }
      else { if (!ma || !ma.activeMode) return; mode = ma.activeMode; f = mode === 'fan' ? 0.6 : Math.max(0, ma.frac); }
      if (f <= 0.02) return;
      const pos = a;
      const R = acThrow(a), dir = acDir(a, r);
      const dx = x - pos.x, dz = z - pos.y, dist = Math.max(0.05, Math.hypot(dx, dz));
      const cos = (dx * dir.nx + dz * dir.nz) / dist;
      const hide = blocked(pos.x, pos.y, x, z, boxes) ? 0.2 : 1;
      const jet = cos > 0.82 ? Math.exp(-dist / (0.45 * R)) : cos > 0.5 ? 0.5 * Math.exp(-dist / (0.3 * R)) : 0.12 * Math.exp(-dist / (0.2 * R));
      v = Math.max(v, 2.2 * (FAN_V[a.fan] || 1) * f * jet * hide);
      const sign = mode === 'cool' ? -1 : mode === 'heat' ? 1 : 0;
      dT += sign * 3.2 * f * jet * hide;
      if (dist > R || hide < 1) dT -= sign * 0.7 * f;
    });
    return { room: r, T, local: T != null ? T + dT : null, dT, v, draft: v > 0.6 ? 2 : v > 0.25 ? 1 : 0 };
  }
  /* Rate wall positions for an AC in its room: how much of the room its air reaches,
     minus a penalty when it would blow straight onto a bed, sofa or desk. */
  function bestSpots(ac, r, home) {
    const furn = home.furniture || [];
    const seats = furn.filter((f) => Airly.FURNITURE[f.kind] && Airly.FURNITURE[f.kind].seat && (f.level || 0) === (r.level || 0) &&
      f.x + f.w / 2 > r.x && f.x + f.w / 2 < r.x + r.length && f.y + f.d / 2 > r.y && f.y + f.d / 2 < r.y + r.width);
    const inset = 0.25, step = 0.3, out = [];
    const add = (x, y, orient) => {
      const cand = Object.assign({}, ac, { x, y, orient });
      const cov = coverage(cand, r, null, furn);
      let draft = 0;
      seats.forEach((s) => {
        const f = feelAt(home, null, s.x + s.w / 2, s.y + s.d / 2, { room: r, acs: [cand], assumeFull: true });
        if (f && f.draft) draft = Math.max(draft, f.draft);
      });
      out.push({ x, y, orient, cov, draft, score: Math.round(cov * 100 - draft * 18) });
    };
    for (let x = r.x + 0.5; x <= r.x + r.length - 0.5 + 1e-6; x += step) { add(x, r.y + inset, 'h'); add(x, r.y + r.width - inset, 'h'); }
    for (let y = r.y + 0.5; y <= r.y + r.width - 0.5 + 1e-6; y += step) { add(r.x + inset, y, 'v'); add(r.x + r.length - inset, y, 'v'); }
    out.sort((a, b) => b.score - a.score);
    return { spots: out, best: out[0] || null, seats };
  }
  /* 0–100 comfort for a room from how close it gets to its target, how fast, humidity and drafts */
  function comfortScore(o) {
    let s = 100 - Math.min(60, Math.abs(o.final - o.target) * 14);
    if (o.reached == null) s -= 10; else s -= Math.min(15, (o.reached / 3600) * 4);
    if (o.rh != null) s -= Math.max(0, o.rh - 60) * 0.8 + Math.max(0, 35 - o.rh) * 0.8;
    if (o.draftSeat) s -= 15;
    return Math.round(clamp(s, 0, 100));
  }
  /* Candidate wall-mounted positions to find better placement */
  function bestPlacement(ac, r, furn) {
    const inset = 0.25;
    const cands = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const fx = r.x + 0.4 + ((r.length - 0.8) * i) / steps;
      const fy = r.y + 0.4 + ((r.width - 0.8) * i) / steps;
      cands.push({ x: fx, y: r.y + inset, orient: 'h' }, { x: fx, y: r.y + r.width - inset, orient: 'h' }, { x: r.x + inset, y: fy, orient: 'v' }, { x: r.x + r.length - inset, y: fy, orient: 'v' });
    }
    let best = { pos: { x: ac.x, y: ac.y, orient: ac.orient || 'h' }, cov: coverage(ac, r, null, furn) };
    cands.forEach((c) => {
      const cov = coverage(ac, r, c, furn);
      if (cov > best.cov + 0.001) best = { pos: c, cov };
    });
    return best;
  }

  /* ---------- Model ---------- */
  function seasonOutside(env) {
    return env.season === 'heating' ? env.outsideWinter : env.outsideSummer;
  }
  function seasonInitial(env) {
    return env.season === 'heating' ? env.initialWinter : env.initialSummer;
  }
  function desiredFor(home, r) {
    const acs = home.acs.filter((a) => a.roomId === r.id && a.mode !== 'fan');
    if (acs.length) return acs.reduce((s, a) => s + a.target, 0) / acs.length;
    return home.env.season === 'heating' ? home.env.desiredHeat : home.env.desiredCool;
  }

  /* opts.forceMode: 'cool'|'heat' to evaluate a season regardless of AC settings
     opts.initial: map roomId -> starting temperature */
  function buildModel(home, opts) {
    opts = opts || {};
    const env = home.env;
    const season = opts.season || env.season;
    const cycle = opts.cycle != null ? opts.cycle : !!env.dayCycle;
    const envC = Object.assign({}, env, { dayCycle: cycle });
    const clock0 = opts.clock0 != null ? opts.clock0 : env.startHour != null ? +env.startHour : 12;
    const Tout = outsideAt(envC, season, clock0);
    const T0 = season === 'heating' ? env.initialWinter : env.initialSummer;
    const rhOut = season === 'heating' ? env.rhWinter || 75 : env.rhSummer || 50;
    const wOut = wFromRH(dailyMeanOutside(envC, season), rhOut);
    const idx = {};
    const rooms = home.rooms.map((r, i) => {
      idx[r.id] = i;
      const g = geometry(r);
      const ua = roomUA(r);
      const gains = roomGains(r, season);
      const given = opts.initial && opts.initial[r.id];
      const init = given ? given.T : r.initialTemp != null && r.initialTemp !== '' ? +r.initialTemp : T0;
      const surf = 2 * g.area + g.perimeter * r.height;
      const toMass = gains.solar * SOLAR_TO_MASS;
      return {
        id: r.id, C: g.volume * AIR_HEAT_CAP * AIR_FURNITURE, Cm: g.area * MASS_PER_M2, Hm: surf * H_SURF,
        ua: ua.ua, uaG: ua.uaGround, gains: gains.total - toMass, gainsMass: toMass,
        T: init, Tm: given ? given.Tm : init, acW: 0,
        w: given && given.w != null ? given.w : wFromRH(init, 55),
        M: g.volume * 1.2, // kg of air
        flowOut: (ua.parts.infil / 0.33 / 3600) * 1.2, // kg/s of air exchanged with outside
        dyn: { type: r.type, people: r.people, appl: r.appliancesW, wins: r.windows.map((o) => ({ wall: o.wall, a: o.w * o.h })), sunW: SUN_W[r.sun], solAirK: SOL_AIR[r.sun], wallPart: ua.parts.wall, roofPart: r.floorLevel === 'top' ? ua.parts.ceil : 0, k: r.calib > 0 ? r.calib : 1 },
      };
    });
    const links = adjacency(home).map((l) => {
      const c = linkConductance(l, home);
      return { i: idx[l.a], j: idx[l.b], G: c.G, open: c.open, openings: c.openings, raw: l };
    });
    // a staircase is an opening between floors: air (and warmth) moves up and down through it
    (home.furniture || []).filter((f) => f.kind === 'stairs').forEach((st) => {
      const cx = st.x + st.w / 2, cy = st.y + st.d / 2, L = st.level || 0;
      const at = (lv) => home.rooms.find((q) => (q.level || 0) === lv && cx >= q.x && cx <= q.x + q.length && cy >= q.y && cy <= q.y + q.width);
      const lo = at(L), hi = at(L + 1);
      if (lo && hi) links.push({ i: idx[lo.id], j: idx[hi.id], G: 70, open: false, openings: [], raw: { a: lo.id, b: hi.id, vertical: true, stairs: true, doors: [] } });
    });
    // rooms stacked on consecutive floors exchange heat through the floor/ceiling between them
    home.rooms.forEach((A) => home.rooms.forEach((B) => {
      if ((B.level || 0) !== (A.level || 0) + 1) return;
      const ox = Math.min(A.x + A.length, B.x + B.length) - Math.max(A.x, B.x);
      const oy = Math.min(A.y + A.width, B.y + B.width) - Math.max(A.y, B.y);
      if (ox <= 0.2 || oy <= 0.2) return;
      const U = 1 / (1 / U_CEIL[A.ceilIns] + 1 / U_FLOOR[B.floorIns]);
      links.push({ i: idx[A.id], j: idx[B.id], G: ox * oy * U * 1.5, open: false, openings: [], raw: { a: A.id, b: B.id, vertical: true, doors: [] } });
    }));
    const acs = home.acs
      .filter((a) => a.roomId && idx[a.roomId] != null)
      .map((a) => {
        const r = home.rooms[idx[a.roomId]];
        const cov = coverage(a, r, null, home.furniture);
        // share of output that reaches neighbours through open doors / openings in throw range
        const spills = [];
        const throwR = acThrow(a);
        links.forEach((l) => {
          if (!l.open) return;
          const other = l.raw.a === r.id ? l.raw.b : l.raw.b === r.id ? l.raw.a : null;
          if (!other) return;
          let near = false;
          if (l.raw.openPlan) near = true;
          else l.raw.doors.forEach((d) => { if (d.door.open && Math.hypot(d.center.x - a.x, d.center.y - a.y) <= throwR) near = true; });
          if (near) spills.push({ j: idx[other], f: l.raw.openPlan ? 0.2 : 0.1 });
        });
        let spillTotal = spills.reduce((s, x) => s + x.f, 0);
        if (spillTotal > 0.3) spills.forEach((s) => (s.f *= 0.3 / spillTotal));
        const mode = opts.forceMode || a.mode;
        // schedules: an AC's own timer, or the energy calculator's daily operating window
        let periods = null;
        if (opts.schedules !== false && !opts.ignoreSchedules) {
          if (a.schedule && a.schedule.enabled && a.schedule.periods && a.schedule.periods.length) {
            periods = a.schedule.periods.map((p) => [parseHM(p.on), parseHM(p.off)]).filter((p) => p[0] != null && p[1] != null);
          } else if (opts.opWindow) periods = [opts.opWindow];
        }
        if (opts.alwaysOn) periods = null;
        return {
          id: a.id,
          i: idx[a.roomId],
          on: opts.forceMode ? true : a.on,
          mode,
          target: a.target,
          periods,
          sleep: !opts.ignoreSchedules && !!a.sleep,
          scheduledOff: false,
          capW: acCapacityW(a),
          inverter: a.inverter,
          fan: FAN_F[a.fan] || 1,
          dirCool: DIR_F.cool[a.direction] || 1,
          dirHeat: DIR_F.heat[a.direction] || 1,
          mix: 0.75 + 0.25 * cov,
          ratedCool: acRatedKW(a, 'cool'),
          ratedHeat: acRatedKW(a, 'heat'),
          spills,
          compressor: true,
          onT: 0, // seconds since the unit was switched on
          integ: 0, // integral term of the inverter controller
          paused: false,
          frac: 0,
          powerKW: 0,
          kWhCool: 0,
          kWhHeat: 0,
          activeMode: null,
        };
      });
    return { rooms, links, acs, Tout, Tg: groundTemp(dailyMeanOutside(envC, season)), t: 0, season, cycle, clock0, env: envC, wOut, north: env.north || 'top', comfort: home.rooms.map(() => 0) };
  }

  function updateTimeOfDay(m) {
    const h = hourOf(m);
    m.hour = h;
    if (!m.cycle) return;
    m.Tout = outsideAt(m.env, m.season, h);
    const sun = sunAt(m.season, h);
    const winterSun = m.season === 'heating' ? 0.6 : 1;
    m.rooms.forEach((r) => {
      const d = r.dyn;
      let solar = 0;
      d.wins.forEach((w) => (solar += w.a * SHGC * d.sunW * winterSun * windowSun(w.wall, m.north, sun)));
      solar *= d.k;
      const solAir = m.season === 'heating' ? 0 : (d.wallPart * d.solAirK + d.roofPart * ROOF_SOL_AIR) * sun.e * 0.8;
      const occ = occupancy(d.type, h);
      const internal = d.people * 90 * occ + d.appl * Math.max(d.type === 'kitchen' ? 0.3 : 0.2, occ);
      r.gainsMass = solar * SOLAR_TO_MASS;
      r.gains = solar - r.gainsMass + solAir + internal;
      r.occ = occ;
    });
  }

  function step(m, dt) {
    updateTimeOfDay(m);
    const n = m.rooms.length;
    const Q = new Array(n).fill(0);
    const W = new Array(n).fill(0); // moisture flows, kg/s
    for (let i = 0; i < n; i++) {
      const r = m.rooms[i];
      const qm = r.Hm * (r.Tm - r.T); // air <-> structure
      Q[i] += r.ua * (m.Tout - r.T) + r.uaG * (m.Tg - r.T) + r.gains + qm;
      r.Tm += ((r.gainsMass - qm) * dt) / r.Cm;
      r.acW = 0;
    }
    m.links.forEach((l) => {
      const dT = m.rooms[l.j].T - m.rooms[l.i].T;
      // keep the explicit time step stable for very large openings
      const Gb = Math.min(buoyancyG(l.openings, dT), (0.4 * Math.min(m.rooms[l.i].C, m.rooms[l.j].C)) / dt);
      const q = (l.G + Gb) * dT;
      Q[l.i] += q;
      Q[l.j] -= q;
      // air moving between rooms also carries moisture
      if (!l.raw.vertical) {
        const mflow = ((l.G * 0.3 + Gb) / AIR_HEAT_CAP) * 1.2;
        const dw = m.rooms[l.j].w - m.rooms[l.i].w;
        W[l.i] += mflow * dw;
        W[l.j] -= mflow * dw;
      }
    });
    // moisture: outside air exchange + people/cooking/showers
    for (let i = 0; i < n; i++) {
      const r = m.rooms[i];
      const occ = r.occ != null ? r.occ : AVG_USE;
      let gen = r.dyn.people * occ * 0.05; // kg/h per person
      if (r.dyn.type === 'kitchen') gen += 0.3 * occ;
      if (r.dyn.type === 'bathroom') gen += 0.6 * occ;
      W[i] += r.flowOut * (m.wOut - r.w) + gen / 3600;
    }
    m.acs.forEach((a) => {
      a.frac = 0;
      a.powerKW = 0;
      a.activeMode = null;
      // timer / schedule
      a.scheduledOff = !!(a.on && a.periods && !inPeriods(a.periods, m.hour));
      if (!a.on || a.scheduledOff) { a.onT = 0; a.integ = 0; return; }
      const night = a.sleep && isNight(m.hour);
      a.nightActive = night;
      a.onT += dt;
      const T = m.rooms[a.i].T;
      let mode = a.mode;
      if (mode === 'fan') {
        a.powerKW = 0.03;
        a.kWhCool += (a.powerKW * dt) / 3600;
        return;
      }
      if (mode === 'auto') mode = T > a.target + 0.5 ? 'cool' : T < a.target - 0.5 ? 'heat' : a.lastMode || (m.season === 'heating' ? 'heat' : 'cool');
      a.lastMode = mode;
      // night mode: 1.5 °C warmer (cooling) / cooler (heating) and a quiet fan while sleeping
      const target = night ? a.target + (mode === 'cool' ? 1.5 : -1.5) : a.target;
      const err = mode === 'cool' ? T - target : target - T;
      let frac;
      if (a.inverter) {
        /* Inverter: full speed while far from the target, easing off as the room gets close
           (proportional + slow integral term, like a real controller). If the room gets
           noticeably over-conditioned the compressor pauses until it drifts back. */
        if (err < -0.8) a.paused = true;
        else if (err > -0.1) a.paused = false;
        a.integ = clamp(a.integ + (err * dt) / 900, -0.4, 0.6);
        frac = a.paused ? 0 : clamp(0.2 + err / 1.5 + a.integ, 0, 1);
      } else {
        // fixed speed: thermostat switches the compressor on/off around the target (±0.6 °C)
        if (err > 0.6) a.compressor = true;
        else if (err < -0.6) a.compressor = false;
        frac = a.compressor ? 1 : 0;
      }
      // start-up: fan only for the first minute, then the compressor ramps up
      a.starting = a.onT < START_DELAY + (a.inverter ? RAMP_TIME : 0) && frac > 0;
      if (a.onT < START_DELAY) frac = 0;
      else if (a.inverter) frac = Math.min(frac, 0.3 + (0.7 * (a.onT - START_DELAY)) / RAMP_TIME);
      const cap = a.capW * (mode === 'cool' ? SHR : 1) * derate(mode, m.Tout) * (night ? Math.min(a.fan, 0.75) : a.fan) * (mode === 'cool' ? a.dirCool : a.dirHeat) * a.mix * frac;
      const sign = mode === 'cool' ? -1 : 1;
      let local = 1;
      a.spills.forEach((s) => {
        Q[s.j] += sign * cap * s.f;
        m.rooms[s.j].acW += sign * cap * s.f;
        local -= s.f;
      });
      Q[a.i] += sign * cap * local;
      m.rooms[a.i].acW += sign * cap * local;
      if (mode === 'cool') {
        // the rest of the cooling output condenses water on the coil (drier air)
        const rr = m.rooms[a.i];
        const latent = (cap / SHR) * (1 - SHR) * clamp((rr.w - COIL_W) / 0.003, 0, 1);
        W[a.i] -= latent / LATENT_HEAT;
      }
      const rated = mode === 'cool' ? a.ratedCool : a.ratedHeat;
      // Inverters modulate: part load runs more efficiently than rated; fixed-speed units cycle on/off.
      const p = a.inverter ? (frac > 0.01 ? rated * (0.12 + 0.8 * frac) : rated * 0.04) : frac > 0 ? rated : rated * 0.03;
      a.activeStarting = a.starting;
      a.frac = frac;
      a.powerKW = p;
      a.activeMode = mode;
      const kwh = (p * dt) / 3600;
      if (mode === 'cool') a.kWhCool += kwh;
      else a.kWhHeat += kwh;
    });
    for (let i = 0; i < n; i++) {
      const r = m.rooms[i];
      r.T += (Q[i] * dt) / r.C;
      r.w = Math.max(0.001, r.w + (W[i] * dt) / (r.M * MOIST_BUFFER));
    }
    m.t += dt;
  }

  /* Run a full prediction quickly (no animation) */
  function predict(home, opts) {
    opts = opts || {};
    const hours = opts.hours || 6;
    const dt = 30;
    const sampleEvery = opts.sampleEvery || 300; // seconds
    const m = buildModel(home, opts);
    const targets = home.rooms.map((r) => (opts.forceMode ? (opts.forceMode === 'heat' ? home.env.desiredHeat : home.env.desiredCool) : desiredFor(home, r)));
    if (opts.forceMode) {
      // with a forced mode, each AC still uses its own target if it serves the room
      home.rooms.forEach((r, i) => {
        const a = home.acs.filter((x) => x.roomId === r.id);
        if (a.length) targets[i] = a.reduce((s, x) => s + x.target, 0) / a.length;
      });
      m.acs.forEach((a) => {
        if (opts.forceMode === 'heat' && a.target > 26) a.target = 22;
        if (opts.forceMode === 'cool' && a.target < 18) a.target = 22;
      });
    }
    const steps = Math.round((hours * 3600) / dt);
    const times = [0];
    const temps = m.rooms.map((r) => [r.T]);
    const reached = m.rooms.map((r, i) => (Math.abs(r.T - targets[i]) <= 0.5 ? 0 : null));
    const discomfort = m.rooms.map(() => 0); // hours outside target ±1.5 °C while people are usually awake (07–23)
    const heatingNeeded = m.season === 'heating';
    let base = null; // energy counters at the start of the measured period
    for (let s = 1; s <= steps; s++) {
      step(m, dt);
      if (opts.measureFrom != null && !base && m.t >= opts.measureFrom) base = m.acs.map((a) => [a.kWhCool, a.kWhHeat]);
      if (opts.measureFrom == null || m.t > opts.measureFrom) m.rooms.forEach((r, i) => {
        if (m.hour >= 7 && m.hour < 23 && Math.abs(r.T - targets[i]) > 1.5) discomfort[i] += dt / 3600;
      });
      m.rooms.forEach((r, i) => {
        if (reached[i] == null) {
          const ok = heatingNeeded ? r.T >= targets[i] - 0.5 : r.T <= targets[i] + 0.5;
          if (ok) reached[i] = m.t;
        }
      });
      if ((s * dt) % sampleEvery === 0) {
        times.push(m.t);
        m.rooms.forEach((r, i) => temps[i].push(r.T));
      }
    }
    if (base) m.acs.forEach((a, k) => { a.kWhCool -= base[k][0]; a.kWhHeat -= base[k][1]; });
    const kWhCool = m.acs.reduce((s, a) => s + a.kWhCool, 0);
    const kWhHeat = m.acs.reduce((s, a) => s + a.kWhHeat, 0);
    return {
      times,
      temps,
      targets,
      reached,
      final: m.rooms.map((r) => r.T),
      rh: m.rooms.map((r) => rhFromW(r.T, r.w)),
      discomfort,
      kWhCool,
      kWhHeat,
      perAC: m.acs.map((a) => ({ id: a.id, kWh: a.kWhCool + a.kWhHeat, kWhCool: a.kWhCool, kWhHeat: a.kWhHeat })),
      hours,
      model: m,
    };
  }

  /* Live, animated simulation controller */
  const live = {
    model: null,
    running: false,
    history: { times: [], temps: {} },
    timer: null,
    rebuild(home) {
      const initial = {};
      if (this.model && this.model.t > 0) this.model.rooms.forEach((r) => (initial[r.id] = { T: r.T, Tm: r.Tm, w: r.w }));
      const t = this.model ? this.model.t : 0;
      const kept = this.model ? this.model.acs.reduce((o, a) => ((o[a.id] = a), o), {}) : {};
      this.model = buildModel(home, { initial: t > 0 ? initial : null });
      this.model.t = t;
      this.model.acs.forEach((a) => {
        const k = kept[a.id];
        if (k) { a.kWhCool = k.kWhCool; a.kWhHeat = k.kWhHeat; a.compressor = k.compressor; a.onT = k.onT; a.integ = k.integ; a.paused = k.paused; }
      });
      if (t === 0) this.resetHistory();
    },
    resetHistory() {
      this.history = { times: [0], temps: {} };
      if (this.model) this.model.rooms.forEach((r) => (this.history.temps[r.id] = [r.T]));
    },
    reset(home) {
      this.stop();
      this.model = null;
      this.rebuild(home);
      this.resetHistory();
      Airly.store.emit('sim');
    },
    start() {
      if (this.running) return;
      this.running = true;
      let last = performance.now();
      const tick = () => {
        if (!this.running) return;
        const now = performance.now();
        const realDt = Math.min(0.25, (now - last) / 1000);
        last = now;
        const simSeconds = realDt * Airly.store.prefs.simSpeed * 60; // speed = sim minutes per real second
        let rem = simSeconds;
        while (rem > 0) {
          const d = Math.min(30, rem);
          step(this.model, d);
          rem -= d;
          const m = this.model;
          const lastT = this.history.times[this.history.times.length - 1];
          // sample the chart more often at slow speeds so the curve stays smooth
          const every = clamp(Airly.store.prefs.simSpeed * 6, 2, 60);
          if (m.t - lastT >= every) {
            this.history.times.push(m.t);
            m.rooms.forEach((r) => (this.history.temps[r.id] = this.history.temps[r.id] || []).push(r.T));
            if (this.history.times.length > 1500) {
              this.history.times.shift();
              Object.values(this.history.temps).forEach((a) => a.shift());
            }
          }
        }
        Airly.store.emit('sim');
        this.timer = requestAnimationFrame(tick);
      };
      this.timer = requestAnimationFrame(tick);
      Airly.store.emit('sim');
    },
    stop() {
      this.running = false;
      if (this.timer) cancelAnimationFrame(this.timer);
      this.timer = null;
      Airly.store.emit('sim');
    },
    rhOf(roomId) {
      if (!this.model) return null;
      const r = this.model.rooms.find((x) => x.id === roomId);
      return r ? rhFromW(r.T, r.w) : null;
    },
    /* clock time of the simulation (hours, 0–24) and the current outside temperature */
    hour() { return this.model ? hourOf(this.model) : null; },
    outside() { return this.model ? this.model.Tout : null; },
    tempOf(roomId) {
      if (!this.model) return null;
      const r = this.model.rooms.find((x) => x.id === roomId);
      return r ? r.T : null;
    },
  };

  Airly.thermal = {
    BTU_TO_W, geometry, adjacency, linkConductance, roomUA, roomGains, required, standardSize,
    acCapacityW, acRatedKW, acThrow, coverage, bestPlacement, buildModel, step, predict, live,
    exteriorWallCount, openingCenter, wallLength, desiredFor, seasonOutside, seasonInitial, COP,
    outsideAt, dailyMeanOutside, sunAt, feelAt, comfortScore, acDir, blockersIn, segHitsBox, TALL, bestSpots, occupancy, rhFromW, wFromRH, parseHM, hourOf,
  };
})();

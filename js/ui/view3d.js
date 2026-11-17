/* Airly — lightweight 3D house view (Canvas 2D, perspective projection, painter's algorithm).
 * Floors are coloured by the simulated temperature; AC units emit animated airflow particles. */
(function () {
  'use strict';
  const Airly = window.Airly;
  const t = (k, p) => Airly.i18n.t(k, p);
  const esc = (s) => Airly.esc(s);
  const TH = () => Airly.thermal;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const WALL_INSET = 0.05;
  const SILL = 0.9;
  const MAX_PARTICLES = 700;

  const cam = { yaw: -0.65, pitch: 0.72, dist: 20, tx: 0, ty: 0, tz: 0, fov: 1 };
  const EYE = 1.6; // eye height inside a room (m)
  const NEAR = 0.08;
  let focus = null; // room id when standing inside a room
  let savedWallMode = null;
  let floorHits = [];
  let pickHits = [];
  const held = new Set(); // keys held down for smooth turning/walking (A, D, W, S) // everything drawn this frame (for clicking doors / walls / floors)
  let showLevel = 'all'; // which floors are visible: 'all' or the highest floor index shown
  /* height of each floor's base, stacked by the tallest room on the floors below */
  function levelBase(h) {
    const n = Math.max(1, h.levels || 1);
    const base = [0];
    for (let k = 0; k < n; k++) {
      const hs = h.rooms.filter((r) => (r.level || 0) === k).map((r) => r.height);
      base.push(base[k] + (hs.length ? Math.max(...hs) : 2.7) + 0.3);
    }
    return base;
  }
  const visibleRoom = (r) => showLevel === 'all' || (r.level || 0) <= +showLevel;
  let wallMode = 'full'; // 'full' | 'low'
  let particles = [];
  let raf = null;
  let lastT = 0;
  let canvas, ctx, dlg, colors;
  const pointers = new Map();
  let drag = null;

  /* ---------- colours ---------- */
  function hexToRgb(h) {
    h = (h || '#888888').trim();
    if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]]; }
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function shade(rgb, k, a) {
    const c = rgb.map((v) => Math.round(clamp(v * k, 0, 255)));
    return `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;
  }
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const dark = document.documentElement.dataset.themeResolved === 'dark';
    colors = {
      dark,
      bg: v('--bg'), surface: v('--surface'), text: v('--text'),
      wall: hexToRgb(dark ? '#8d8c84' : '#e9e7e1'),
      wallTop: hexToRgb(dark ? '#b9b8ae' : '#9a988f'),
      ground: hexToRgb(dark ? '#1f1f1d' : '#dcdbd4'),
      neutralFloor: hexToRgb(dark ? '#3a3a37' : '#f4f3ee'),
      glass: hexToRgb(v('--window') || '#5598e7'),
      door: hexToRgb(v('--door') || '#8a5a2b'),
      cool: hexToRgb(dark ? '#86b6ef' : '#2a78d6'),
      heat: hexToRgb(dark ? '#f08a5d' : '#eb6834'),
      acBody: hexToRgb(dark ? '#f0efec' : '#ffffff'),
    };
  }

  /* ---------- camera ---------- */
  function fit() {
    const h = Airly.store.state;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    h.rooms.forEach((r) => { x0 = Math.min(x0, r.x); z0 = Math.min(z0, r.y); x1 = Math.max(x1, r.x + r.length); z1 = Math.max(z1, r.y + r.width); });
    if (!isFinite(x0)) { x0 = 0; z0 = 0; x1 = 8; z1 = 6; }
    const lb = levelBase(h);
    cam.tx = (x0 + x1) / 2; cam.tz = (z0 + z1) / 2; cam.ty = 0.6 + lb[Math.max(0, (h.levels || 1) - 1)] / 2;
    cam.dist = Math.max(8, Math.hypot(x1 - x0, z1 - z0) * 1.25);
    cam.yaw = -0.65; cam.pitch = 0.72; cam.fov = 1;
  }

  /* Stand inside a room: eye height, in the corner farthest from its AC, looking toward the AC */
  function enterRoom(id) {
    const h = Airly.store.state;
    const r = h.rooms.find((x) => x.id === id);
    if (!r) return;
    if (!focus) savedWallMode = wallMode;
    focus = id;
    wallMode = 'full';
    const m = Math.min(0.6, r.length / 3, r.width / 3);
    const corners = [[r.x + m, r.y + m], [r.x + r.length - m, r.y + m], [r.x + r.length - m, r.y + r.width - m], [r.x + m, r.y + r.width - m]];
    const ac = h.acs.find((a) => a.roomId === id);
    const cx = r.x + r.length / 2, cz = r.y + r.width / 2;
    // prefer the corner farthest from the AC, but never stand inside furniture (you could not move)
    const order = ac ? corners.slice().sort((a, b) => Math.hypot(b[0] - ac.x, b[1] - ac.y) - Math.hypot(a[0] - ac.x, a[1] - ac.y)) : [corners[2], corners[3], corners[1], corners[0]];
    const lv = r.level || 0;
    const free = (q) => walkable(h, lv, [], q[0], q[1]);
    let eye = order.find(free);
    if (!eye) {
      // every corner is blocked: take the free spot in the room closest to the preferred corner
      let best = null;
      for (let x = r.x + BODY; x <= r.x + r.length - BODY + 1e-9; x += 0.2) {
        for (let z = r.y + BODY; z <= r.y + r.width - BODY + 1e-9; z += 0.2) {
          if (!free([x, z])) continue;
          const d = Math.hypot(x - order[0][0], z - order[0][1]);
          if (!best || d < best.d) best = { p: [x, z], d };
        }
      }
      eye = best ? best.p : order[0];
    }
    const look = ac ? [(ac.x + cx) / 2, (ac.y + cz) / 2] : [cx, cz];
    let fx = look[0] - eye[0], fz = look[1] - eye[1];
    const n = Math.hypot(fx, fz) || 1;
    fx /= n; fz /= n;
    cam.tx = eye[0]; cam.ty = levelBase(h)[r.level || 0] + Math.min(EYE, r.height - 0.3); cam.tz = eye[1];
    cam.dist = 0.05; cam.fov = 1;
    cam.yaw = Math.atan2(-fx, -fz);
    cam.pitch = ac ? -0.05 : 0.15;
    updatePanel(true);
    renderACs();
    renderDoors();
  }
  function exitRoom() {
    focus = null;
    wallMode = savedWallMode || 'full';
    savedWallMode = null;
    fit();
    updatePanel(true);
    renderACs();
    renderDoors();
  }
  function focusRoom() {
    return focus ? Airly.store.state.rooms.find((r) => r.id === focus) || null : null;
  }
  /* ---------- Walking through the house ----------
     You can stand anywhere inside a room (keeping a little distance from the walls) or in an open
     doorway / open-space connection. Walls and closed doors stop you; you slide along them. */
  const BODY = 0.22; // distance kept from walls (m)
  function doorways(h, lv) {
    const out = [];
    const onLevel = (r) => (r.level || 0) === lv;
    TH().adjacency(h).forEach((l) => {
      const A = h.rooms.find((r) => r.id === l.a);
      if (!A || !onLevel(A)) return;
      const edge = l.sideA === 'right' ? A.x + A.length : l.sideA === 'left' ? A.x : l.sideA === 'bottom' ? A.y + A.width : A.y;
      const spans = l.openPlan ? [[l.lo + 0.15, l.hi - 0.15]] : l.doors.filter((d) => d.door.open).map((d) => {
        const c = l.axis === 'y' ? d.center.y : d.center.x;
        return [c - d.door.w / 2 + 0.05, c + d.door.w / 2 - 0.05];
      });
      spans.forEach(([s0, s1]) => {
        if (s1 <= s0) return;
        const mid = (s0 + s1) / 2;
        out.push(l.axis === 'y' ? { x0: edge - 0.5, x1: edge + 0.5, z0: s0, z1: s1, axis: 'y', cx: edge, cz: mid } : { x0: s0, x1: s1, z0: edge - 0.5, z1: edge + 0.5, axis: 'x', cx: mid, cz: edge });
      });
    });
    return out;
  }
  function stairsList(h) {
    return (h.furniture || []).filter((f) => f.kind === 'stairs');
  }
  /* 0 at the bottom of the stairs, 1 at the top */
  function stairProgress(st, x, z) {
    const r = st.rot || 0;
    const p = r === 90 ? (x - st.x) / st.w : r === 270 ? (st.x + st.w - x) / st.w : r === 180 ? (z - st.y) / st.d : (st.y + st.d - z) / st.d;
    return clamp(p, 0, 1);
  }
  function stairsAt(h, lv, x, z) {
    return stairsList(h).find((st) => ((st.level || 0) === lv || (st.level || 0) === lv - 1) && x >= st.x && x <= st.x + st.w && z >= st.y && z <= st.y + st.d) || null;
  }
  /* skipFurn: only walls count (used to walk out of furniture you are standing in) */
  function walkable(h, lv, ways, x, z, skipFurn) {
    const m = 0.15;
    if (!skipFurn && (h.furniture || []).some((f) => f.kind !== 'stairs' && (f.level || 0) === lv && x > f.x - m && x < f.x + f.w + m && z > f.y - m && z < f.y + f.d + m)) return false;
    if (stairsAt(h, lv, x, z)) return true;
    for (const r of h.rooms) {
      if ((r.level || 0) !== lv) continue;
      if (x >= r.x + BODY && x <= r.x + r.length - BODY && z >= r.y + BODY && z <= r.y + r.width - BODY) return true;
    }
    return ways.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1);
  }
  /* step > 0 forwards, < 0 backwards; side > 0 to the right */
  function walk(step, side) {
    const r = focusRoom();
    if (!r) return;
    const h = Airly.store.state;
    const lv = r.level || 0;
    const ways = doorways(h, lv);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const sx = -fz, sz = fx; // right-hand direction
    let nx = cam.tx + fx * step + sx * (side || 0), nz = cam.tz + fz * step + sz * (side || 0);
    // door assist: walking towards an open doorway gently lines you up with its centre
    if (step > 0) {
      ways.forEach((w) => {
        const dx = w.cx - cam.tx, dz = w.cz - cam.tz, dist = Math.hypot(dx, dz);
        if (dist > 1.4 || dist < 0.01 || (dx * fx + dz * fz) / dist < 0.35) return;
        const pull = Math.abs(step) * 1.2;
        if (w.axis === 'y') nz += clamp(w.cz - nz, -pull, pull);
        else nx += clamp(w.cx - nx, -pull, pull);
      });
    }
    // standing inside furniture (e.g. it was moved onto you): let you walk out of it instead of being stuck
    const stuck = !walkable(h, lv, ways, cam.tx, cam.tz);
    const ok = (x, z) => walkable(h, lv, ways, x, z, stuck);
    const px = cam.tx, pz = cam.tz;
    if (ok(nx, nz)) { cam.tx = nx; cam.tz = nz; }
    else if (ok(nx, cam.tz)) cam.tx = nx; // slide along the wall
    else if (ok(cam.tx, nz)) cam.tz = nz;
    // bumped into a closed door? tell how to open it
    if (step > 0 && Math.hypot(cam.tx - px, cam.tz - pz) < Math.abs(step) * 0.3) {
      const d = facingDoor(1.2);
      if (d && !d.open && performance.now() - lastHint > 4000) { lastHint = performance.now(); Airly.toast(t('v3d.doorClosedHint')); }
    }
    afterMove(h, lv);
  }
  let lastHint = 0;
  /* after any movement: follow the room you are in, and climb or descend on stairs */
  function afterMove(h, lv) {
    const st = stairsAt(h, lv, cam.tx, cam.tz);
    if (!st) { followRoom(h, lv); return; }
    const L = st.level || 0;
    const b = levelBase(h);
    const p = stairProgress(st, cam.tx, cam.tz);
    const top = (b[L + 1] != null ? b[L + 1] : b[L] + 3);
    const target = p > 0.6 ? L + 1 : L;
    const before = focus;
    followRoom(h, target);
    if (focus === before && target !== lv) {
      // no room on that floor right here: stay on this floor
    }
    cam.ty = b[L] + p * (top - b[L]) + EYE;
  }
  /* entered another room? follow it (panel, ACs, doors) */
  function followRoom(h, lv) {
    const here = h.rooms.find((q) => (q.level || 0) === lv && cam.tx > q.x && cam.tx < q.x + q.length && cam.tz > q.y && cam.tz < q.y + q.width);
    if (here && here.id !== focus) {
      focus = here.id;
      cam.ty = levelBase(h)[lv] + Math.min(EYE, here.height - 0.3);
      renderACs();
      renderDoors();
      updatePanel(true);
    }
  }
  /* ---------- Going through doors ---------- */
  let autoPath = null; // points the camera walks along automatically
  function doorInfo(ref) {
    const h = Airly.store.state;
    const r = h.rooms.find((x) => x.id === ref.room);
    const d = r && r.doors.find((x) => x.id === ref.id);
    if (!d) return null;
    const c = TH().openingCenter(r, d);
    const L = wallLine(r, d.wall);
    const link = TH().adjacency(h).find((l) => l.doors.some((x) => x.door.id === d.id));
    const other = link ? h.rooms.find((x) => x.id === (link.a === r.id ? link.b : link.a)) : null;
    return { r, d, c, nx: L.nx, nz: L.nz, other };
  }
  /* the door you are looking at (within reach) */
  function facingDoor(reach) {
    const h = Airly.store.state;
    const fr = focusRoom();
    if (!fr) return null;
    const lv = fr.level || 0;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    let best = null;
    h.rooms.forEach((r) => {
      if ((r.level || 0) !== lv) return;
      r.doors.forEach((d) => {
        const c = TH().openingCenter(r, d);
        const dx = c.x - cam.tx, dz = c.y - cam.tz, dist = Math.hypot(dx, dz);
        if (dist > (reach || 2.2) || dist < 0.01 || (dx * fx + dz * fz) / dist < 0.5) return;
        if (!best || dist < best.dist) best = { room: r.id, id: d.id, open: d.open, dist };
      });
    });
    return best;
  }
  /* walk through a door into the room on the other side (opening it first if needed) */
  function goThrough(ref) {
    const info = doorInfo(ref);
    if (!info) return;
    if (!info.other) { Airly.toast(t('v3d.doorOutsideNo')); return; }
    if (!info.d.open) toggleDoor(ref.room, ref.id);
    const from = focus === info.other.id ? info.other : info.r;
    const to = from === info.r ? info.other : info.r;
    const k = from === info.r ? -1 : 1; // the owner's wall normal points into the owner's room
    const dx = info.nx * k, dz = info.nz * k;
    const inside = (room, x, z) => ({ x: clamp(x, room.x + BODY, room.x + room.length - BODY), z: clamp(z, room.y + BODY, room.y + room.width - BODY) });
    const A = inside(from, info.c.x - dx * 0.7, info.c.y - dz * 0.7);
    const B = inside(to, info.c.x + dx * 1.0, info.c.y + dz * 1.0);
    if (focus !== info.r.id && focus !== info.other.id) { cam.tx = A.x; cam.tz = A.z; }
    if (!focus) enterRoom(from.id);
    autoPath = [A, { x: info.c.x, z: info.c.y }, B];
    cam.pitch = 0.05;
  }
  function stepAuto(dt) {
    const target = autoPath[0];
    const dx = target.x - cam.tx, dz = target.z - cam.tz, dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      const want = Math.atan2(-dx, -dz);
      const diff = ((want - cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cam.yaw += diff * Math.min(1, dt * 8); // turn smoothly towards where we walk
    }
    const len = 2.2 * dt;
    if (dist <= len) { cam.tx = target.x; cam.tz = target.z; autoPath.shift(); if (!autoPath.length) autoPath = null; }
    else { cam.tx += (dx / dist) * len; cam.tz += (dz / dist) * len; }
    const fr = focusRoom();
    if (fr) afterMove(Airly.store.state, fr.level || 0);
  }
  /* walk up or down a staircase automatically */
  function takeStairs(id, up) {
    const h = Airly.store.state;
    const st = stairsList(h).find((x) => x.id === id);
    if (!st) return;
    const r = st.rot || 0;
    const d = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[r];
    const cx = st.x + st.w / 2, cz = st.y + st.d / 2;
    const half = (r === 90 || r === 270 ? st.w : st.d) / 2;
    const bottom = { x: cx - d[0] * (half + 0.45), z: cz - d[1] * (half + 0.45) };
    const top = { x: cx + d[0] * (half + 0.45), z: cz + d[1] * (half + 0.45) };
    const start = up ? bottom : top, end = up ? top : bottom;
    autoPath = [start, { x: cx, z: cz }, end];
    cam.pitch = up ? -0.1 : 0.25;
  }

  /* start walking: in the room with an AC (or the first room), in its middle */
  function startWalk() {
    const h = Airly.store.state;
    const ac = h.acs.find((a) => h.rooms.some((r) => r.id === a.roomId));
    const r = (ac && h.rooms.find((x) => x.id === ac.roomId)) || h.rooms[0];
    if (!r) return;
    enterRoom(r.id);
    Airly.toast(t('v3d.walkStart'));
  }
  function viewer(W, H) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const f = focus ? Math.min(W, H) * 0.62 * cam.fov : Math.min(W, H) * 1.15;
    const toView = (x, y, z) => {
      const dx = x - cam.tx, dy = y - cam.ty, dz = z - cam.tz;
      const rx = dx * cy - dz * sy;
      const rz = dx * sy + dz * cy;
      return { X: rx, Y: dy * cp - rz * sp, D: cam.dist - (dy * sp + rz * cp) };
    };
    const toScreen = (v) => ({ x: W / 2 + (f * v.X) / v.D, y: H / 2 - (f * v.Y) / v.D, d: v.D, s: f / v.D });
    /* clip a polygon against the near plane, then project it */
    const poly = (pts) => {
      const vs = pts.map((p) => toView(p[0], p[1], p[2]));
      const out = [];
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length];
        const ain = a.D >= NEAR, bin = b.D >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) {
          const k = (NEAR - a.D) / (b.D - a.D);
          out.push({ X: a.X + (b.X - a.X) * k, Y: a.Y + (b.Y - a.Y) * k, D: NEAR });
        }
      }
      return out.length >= 3 ? out.map(toScreen) : null;
    };
    const point = (x, y, z) => { const v = toView(x, y, z); return v.D < NEAR ? null : toScreen(v); };
    // where the eye is in the world (the point the view rays start from)
    const eye = [cam.tx + cam.dist * cp * sy, cam.ty + cam.dist * sp, cam.tz + cam.dist * cp * cy];
    return { poly, point, eye };
  }
  const LIGHT = (() => { const v = [-0.45, 0.8, -0.35]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
  function lambert(nx, ny, nz) {
    return 0.72 + 0.38 * Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  }

  /* ---------- scene ---------- */
  function wallLine(r, wall) {
    const i = WALL_INSET;
    switch (wall) {
      case 'top': return { ax: r.x, az: r.y + i, bx: r.x + r.length, bz: r.y + i, nx: 0, nz: 1 };
      case 'bottom': return { ax: r.x, az: r.y + r.width - i, bx: r.x + r.length, bz: r.y + r.width - i, nx: 0, nz: -1 };
      case 'left': return { ax: r.x + i, az: r.y, bx: r.x + i, bz: r.y + r.width, nx: 1, nz: 0 };
      default: return { ax: r.x + r.length - i, az: r.y, bx: r.x + r.length - i, bz: r.y + r.width, nx: -1, nz: 0 };
    }
  }
  /* Openings on one wall of a room. A door belongs to one room, but on a shared wall it must cut
     through the neighbour's side too; open-plan connections remove the shared wall entirely. */
  function wallOpenings(r, wall, links) {
    const horiz = wall === 'top' || wall === 'bottom';
    const list = r.windows.filter((o) => o.wall === wall).map((o) => ({ o, type: 'window' }))
      .concat(r.doors.filter((o) => o.wall === wall).map((o) => ({ o, type: 'door', ref: { room: r.id, id: o.id } })));
    links.forEach((l) => {
      const mine = (l.a === r.id && l.sideA === wall) || (l.b === r.id && l.sideB === wall);
      if (!mine) return;
      if (l.openPlan) {
        list.push({ o: { offset: l.lo - (horiz ? r.x : r.y), w: l.hi - l.lo }, type: 'gap' });
        return;
      }
      l.doors.forEach((d) => {
        if (d.room === r.id) return;
        const off = (horiz ? d.center.x - r.x : d.center.y - r.y) - d.door.w / 2;
        if (list.some((x) => x.type === 'door' && Math.abs(x.o.offset - off) < 0.3)) return;
        list.push({ o: { offset: off, w: d.door.w, h: d.door.h, open: d.door.open }, type: 'door', mirror: true, ref: { room: d.room, id: d.door.id } });
      });
    });
    return list.sort((a, b) => a.o.offset - b.o.offset);
  }

  function buildScene() {
    const h = Airly.store.state;
    const live = TH().live;
    const showTemps = live.model && live.model.t > 0;
    const floors = [];
    const polys = [];
    const labels = [];
    const doorGaps = []; // invisible click targets in open doorways
    const links = TH().adjacency(h);
    h.rooms.forEach((r) => {
      if (!visibleRoom(r)) return;
      const T = showTemps ? live.tempOf(r.id) : null;
      const target = TH().desiredFor(h, r);
      const floorRgb = T != null ? hexToRgb(Airly.tempColor(T, target)) : colors.neutralFloor;
      const fi = WALL_INSET;
      floors.push({ room: r.id, pts: [[r.x + fi, 0, r.y + fi], [r.x + r.length - fi, 0, r.y + fi], [r.x + r.length - fi, 0, r.y + r.width - fi], [r.x + fi, 0, r.y + r.width - fi]], fill: shade(floorRgb, 1), stroke: shade(colors.wallTop, 1, 0.5) });
      labels.push({ room: r.id, x: r.x + r.length / 2, y: 0.05, z: r.y + r.width / 2, name: Airly.roomName(r), T, target });
      const Hh = wallMode === 'low' ? Math.min(1.1, r.height) : r.height;
      Airly.WALLS.forEach((wall) => {
        const L = wallLine(r, wall);
        const len = TH().wallLength(r, wall);
        const ux = (L.bx - L.ax) / len, uz = (L.bz - L.az) / len;
        const at = (s, y) => [L.ax + ux * s, y, L.az + uz * s];
        const k = lambert(L.nx, 0, L.nz);
        const wallFill = shade(colors.wall, k);
        const quad = (s0, s1, y0, y1, fill, extra) => {
          if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
          polys.push(Object.assign({ room: r.id, pts: [at(s0, y0), at(s1, y0), at(s1, y1), at(s0, y1)], fill, stroke: shade(colors.wallTop, 1, 0.35) }, extra || {}));
        };
        const ops = wallOpenings(r, wall, links);
        let cursor = 0;
        ops.forEach(({ o, type, mirror, ref }) => {
          const s0 = clamp(o.offset, 0, len), s1 = clamp(o.offset + o.w, 0, len);
          if (s0 > cursor) quad(cursor, s0, 0, Hh, wallFill);
          if (type === 'gap') { cursor = Math.max(cursor, s1); return; }
          if (type === 'window') {
            const top = Math.min(SILL + o.h, r.height);
            quad(s0, s1, 0, Math.min(SILL, Hh), wallFill);
            if (Hh > SILL) quad(s0, s1, SILL, Math.min(top, Hh), shade(colors.glass, 1.05, 0.38), { glass: true });
            if (Hh > top) quad(s0, s1, top, Hh, wallFill);
          } else {
            const dh = Math.min(o.h, r.height);
            if (Hh > dh) quad(s0, s1, dh, Hh, wallFill);
            if (o.open) doorGaps.push({ room: r.id, door: ref, pts: [at(s0, 0), at(s1, 0), at(s1, Math.min(dh, Hh)), at(s0, Math.min(dh, Hh))] });
            if (o.open && mirror) {
              // opening only: the door leaf is drawn by the room that owns the door
            } else if (o.open) {
              // door leaf swung 90° into the room from its hinge
              // rotated 180°: hinge at the other end, opening to the other side of the wall
              const k = o.rot180 ? -1 : 1;
              const hs = o.rot180 ? s1 : s0;
              const hx = L.ax + ux * hs, hz = L.az + uz * hs;
              const ex = hx + L.nx * o.w * k, ez = hz + L.nz * o.w * k;
              const top = Math.min(dh, Hh + 0.6);
              polys.push({ room: r.id, inner: true, door: ref, pts: [[hx, 0, hz], [ex, 0, ez], [ex, top, ez], [hx, top, hz]], fill: shade(colors.door, lambert(ux, 0, uz), focus === r.id ? 0.35 : 1), stroke: shade(colors.door, 0.7, focus === r.id ? 0.6 : 1) });
            } else {
              quad(s0, s1, 0, Math.min(dh, Hh), shade(colors.door, k), { door: ref });
            }
          }
          cursor = Math.max(cursor, s1);
        });
        if (cursor < len) quad(cursor, len, 0, Hh, wallFill);
        // wall top cap for a cleaner silhouette
        const tx = -L.nx * 0.1, tz = -L.nz * 0.1;
        polys.push({ pts: [[L.ax, Hh, L.az], [L.bx, Hh, L.bz], [L.bx + tx, Hh, L.bz + tz], [L.ax + tx, Hh, L.az + tz]], fill: shade(colors.wallTop, 1), cap: true, room: r.id });
      });
    });
    // AC units as wall-mounted boxes
    h.acs.forEach((a) => {
      const r = h.rooms.find((x) => x.id === a.roomId);
      if (!r || !visibleRoom(r)) return;
      const g = acMount(a, r);
      const y0 = Math.min(2.05, r.height - 0.35), y1 = y0 + 0.3;
      const hw = 0.45, d = 0.22;
      const cx = g.x, cz = g.z;
      const ax = g.ux * hw, az = g.uz * hw, nx = g.nx * d, nz = g.nz * d;
      const b = [[cx - ax, cz - az], [cx + ax, cz + az], [cx + ax + nx, cz + az + nz], [cx - ax + nx, cz - az + nz]];
      const modeRgb = !a.on ? hexToRgb('#8a8a85') : a.mode === 'heat' ? colors.heat : colors.cool;
      const face = (p, k) => polys.push({ room: r.id, inner: true, pts: p, fill: shade(colors.acBody, k), stroke: shade(modeRgb, 1), lw: 2, ac: true });
      face([[b[0][0], y1, b[0][1]], [b[1][0], y1, b[1][1]], [b[2][0], y1, b[2][1]], [b[3][0], y1, b[3][1]]], 1);
      face([[b[3][0], y0, b[3][1]], [b[2][0], y0, b[2][1]], [b[2][0], y1, b[2][1]], [b[3][0], y1, b[3][1]]], 0.95);
      face([[b[0][0], y0, b[0][1]], [b[3][0], y0, b[3][1]], [b[3][0], y1, b[3][1]], [b[0][0], y1, b[0][1]]], 0.85);
      face([[b[1][0], y0, b[1][1]], [b[2][0], y0, b[2][1]], [b[2][0], y1, b[2][1]], [b[1][0], y1, b[1][1]]], 0.85);
      // vent strip in the mode colour
      polys.push({ pts: [[b[3][0], y0 + 0.02, b[3][1]], [b[2][0], y0 + 0.02, b[2][1]], [b[2][0], y0 + 0.08, b[2][1]], [b[3][0], y0 + 0.08, b[3][1]]], fill: shade(modeRgb, 1), ac: true, room: r.id, inner: true });
    });
    // furniture (boxes) and stairs (steps)
    const lb = levelBase(h);
    (h.furniture || []).forEach((f) => {
      const lv = f.level || 0;
      const cx = f.x + f.w / 2, cz = f.y + f.d / 2;
      const room = h.rooms.find((q) => (q.level || 0) === lv && cx >= q.x && cx <= q.x + q.length && cz >= q.y && cz <= q.y + q.width);
      if (!room || !visibleRoom(room)) return;
      const box = (x0, z0, x1, z1, y0, y1, rgb) => {
        const top = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        polys.push({ room: room.id, inner: true, pts: top, fill: shade(rgb, 1.08), stroke: shade(rgb, 0.7) });
        [[[x0, z0], [x1, z0], 0, -1], [[x1, z0], [x1, z1], 1, 0], [[x1, z1], [x0, z1], 0, 1], [[x0, z1], [x0, z0], -1, 0]].forEach(([a, b, nx, nz]) => {
          polys.push({ room: room.id, inner: true, pts: [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], fill: shade(rgb, lambert(nx, 0, nz) * 0.92), stroke: shade(rgb, 0.7) });
        });
      };
      if (f.kind === 'stairs') {
        const rise = (lb[lv + 1] || lb[lv] + 3) - lb[lv];
        const alongX = f.rot === 90 || f.rot === 270;
        const len = alongX ? f.w : f.d, n = Math.max(6, Math.round(rise / 0.18));
        for (let k = 0; k < n; k++) {
          const u0 = (k / n) * len, u1 = ((k + 1) / n) * len, y1 = ((k + 1) / n) * rise;
          let x0, x1, z0, z1;
          if (f.rot === 90) { x0 = f.x + u0; x1 = f.x + u1; z0 = f.y; z1 = f.y + f.d; }
          else if (f.rot === 270) { x0 = f.x + f.w - u1; x1 = f.x + f.w - u0; z0 = f.y; z1 = f.y + f.d; }
          else if (f.rot === 180) { z0 = f.y + u0; z1 = f.y + u1; x0 = f.x; x1 = f.x + f.w; }
          else { z0 = f.y + f.d - u1; z1 = f.y + f.d - u0; x0 = f.x; x1 = f.x + f.w; }
          box(x0, z0, x1, z1, 0, y1, [176, 160, 140]);
        }
        return;
      }
      // real-looking furniture: one group of boxes (cushions, legs, pillows, doors…) drawn far-to-near
      const LK = Airly.furnitureLook;
      const group = [];
      const maxZ = room.height - 0.05;
      LK.parts(f, h).forEach((p, bi) => {
        const rgb = LK.rgb(p.mat);
        const al = LK.alpha ? LK.alpha(p.mat) : 1;
        if (p.line) return; // 2D-only drawing lines
        if (p.disc) {
          const pts = [];
          for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; pts.push([p.cx + Math.cos(a) * p.rad, p.z + 0.003, p.cy + Math.sin(a) * p.rad]); }
          group.push({ box: bi, c: [p.cx, p.z, p.cy], faces: [{ pts, fill: shade(rgb, 0.9), stroke: null }] });
          return;
        }
        const x0 = p.x0, x1 = p.x1, z0 = p.y0, z1 = p.y1, y0 = Math.min(p.z0, maxZ), y1 = Math.min(p.z1, maxZ);
        if (y1 - y0 < 0.002) return;
        const edge = shade(rgb, 0.62, 0.55 * al);
        const faces = [{ pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], fill: shade(rgb, 1.1, al), stroke: edge }];
        [[[x0, z0], [x1, z0], 0, -1], [[x1, z0], [x1, z1], 1, 0], [[x1, z1], [x0, z1], 0, 1], [[x0, z1], [x0, z0], -1, 0]].forEach(([a, b, nx, nz]) => {
          faces.push({ pts: [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], fill: shade(rgb, lambert(nx, 0, nz) * 0.9, al), stroke: edge, n: [nx, nz], mid: [(a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2] });
        });
        group.push({ box: bi, c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], faces });
      });
      if (group.length) polys.push({ room: room.id, inner: true, furn: f.id, group, center: [f.x + f.w / 2, Math.min(f.h, maxZ) / 2, f.y + f.d / 2] });
    });
    let ceiling = null;
    const fr = focusRoom();
    if (fr) {
      const i = WALL_INSET;
      ceiling = { pts: [[fr.x + i, fr.height, fr.y + i], [fr.x + fr.length - i, fr.height, fr.y + i], [fr.x + fr.length - i, fr.height, fr.y + fr.width - i], [fr.x + i, fr.height, fr.y + fr.width - i]], fill: shade(colors.wall, 1.04) };
    }
    // lift every room to the height of its floor
    const base = levelBase(h);
    const lvOf = {};
    h.rooms.forEach((r) => (lvOf[r.id] = r.level || 0));
    const lift = (item) => {
      const lv = lvOf[item.room] || 0;
      item.level = lv;
      const dy = base[lv] || 0;
      if (dy && item.pts) item.pts = item.pts.map((p) => [p[0], p[1] + dy, p[2]]);
      if (dy && item.group) {
        item.center = [item.center[0], item.center[1] + dy, item.center[2]];
        item.group.forEach((b) => { b.c = [b.c[0], b.c[1] + dy, b.c[2]]; b.faces.forEach((fc) => { fc.pts = fc.pts.map((p) => [p[0], p[1] + dy, p[2]]); if (fc.mid) fc.mid = [fc.mid[0], fc.mid[1] + dy, fc.mid[2]]; }); });
      }
      if (dy && item.y != null && !item.pts) item.y += dy;
      return item;
    };
    floors.forEach(lift); polys.forEach(lift); labels.forEach(lift); doorGaps.forEach(lift);
    if (ceiling && fr) { ceiling.room = fr.id; lift(ceiling); }
    return { floors, polys, labels: focus ? [] : labels, ceiling, base, doorGaps };
  }

  /* Which wall an AC sits on, and the direction it blows */
  function acMount(a, r) {
    let wall;
    if (a.orient === 'v') wall = a.x - r.x < r.x + r.length - a.x ? 'left' : 'right';
    else wall = a.y - r.y < r.y + r.width - a.y ? 'top' : 'bottom';
    const L = wallLine(r, wall);
    const horiz = wall === 'top' || wall === 'bottom';
    const x = horiz ? clamp(a.x, r.x + 0.5, r.x + r.length - 0.5) : L.ax;
    const z = horiz ? L.az : clamp(a.y, r.y + 0.5, r.y + r.width - 0.5);
    return { x, z, nx: L.nx, nz: L.nz, ux: horiz ? 1 : 0, uz: horiz ? 0 : 1 };
  }

  /* ---------- airflow particles ---------- */
  function updateParticles(dt) {
    const h = Airly.store.state;
    const live = TH().live;
    const started = live.model && live.model.t > 0;
    h.acs.forEach((a) => {
      if (!a.on) return;
      const r = h.rooms.find((x) => x.id === a.roomId);
      if (!r) return;
      const ma = live.model && live.model.acs.find((x) => x.id === a.id);
      let mode = a.mode === 'heat' ? 'heat' : a.mode === 'cool' ? 'cool' : a.mode === 'fan' ? 'fan' : (h.env.season === 'heating' ? 'heat' : 'cool');
      if (ma && ma.activeMode) mode = ma.activeMode;
      const intensity = started && ma ? (mode === 'fan' ? 0.4 : Math.max(0.12, ma.frac)) : 0.7;
      const fanF = { auto: 1, quiet: 0.6, low: 0.75, medium: 0.9, high: 1.15 }[a.fan] || 1;
      const rate = 70 * intensity * fanF;
      a._acc = (a._acc || 0) + rate * dt;
      const g = acMount(a, r);
      const y0 = Math.min(2.05, r.height - 0.35);
      const speed = 2.6 * fanF;
      const throwR = TH().acThrow(a);
      while (a._acc >= 1 && particles.length < MAX_PARTICLES) {
        a._acc -= 1;
        const along = (Math.random() - 0.5) * 0.8;
        const spread = (Math.random() - 0.5) * 1.6;
        const vy = mode === 'heat' ? -1.1 - Math.random() * 0.5 : mode === 'cool' ? -0.05 - Math.random() * 0.2 : -0.05;
        particles.push({
          x: g.x + g.ux * along + g.nx * 0.25, y: y0 + 0.02, z: g.z + g.uz * along + g.nz * 0.25,
          vx: g.nx * speed + g.ux * spread, vy, vz: g.nz * speed + g.uz * spread,
          life: 0, max: (throwR / speed) * (1.6 + Math.random() * 1.2), mode, room: r, origin: r.id,
        });
      }
      if (a._acc > 5) a._acc = 0;
    });
    const links = TH().adjacency(h);
    const linkOf = (a, b) => links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    /* If a particle reaches the edge of its room through an open door, move it into the next room */
    const passThrough = (p, r) => {
      let px = p.x, pz = p.z;
      if (p.x > r.x + r.length - 0.08) px = r.x + r.length + 0.2;
      else if (p.x < r.x + 0.08) px = r.x - 0.2;
      else if (p.z > r.y + r.width - 0.08) pz = r.y + r.width + 0.2;
      else if (p.z < r.y + 0.08) pz = r.y - 0.2;
      const next = h.rooms.find((o) => o.id !== r.id && px >= o.x && px <= o.x + o.length && pz >= o.y && pz <= o.y + o.width);
      if (!next) return null;
      const l = linkOf(r.id, next.id);
      if (!l) return null;
      let ok = l.openPlan;
      if (!ok) {
        ok = l.doors.some((d) => {
          if (!d.door.open) return false;
          const along = l.axis === 'y' ? p.z : p.x;
          const c = l.axis === 'y' ? d.center.y : d.center.x;
          return Math.abs(along - c) < d.door.w / 2 - 0.05 && p.y < d.door.h - 0.05;
        });
      }
      if (!ok) return null;
      p.x = clamp(px, next.x + 0.1, next.x + next.length - 0.1);
      p.z = clamp(pz, next.y + 0.1, next.y + next.width - 0.1);
      p.max += 0.6; // keep drifting a little further in the next room
      return next;
    };
    // open doorways of each room: air drifts toward them (pressure / temperature driven draft)
    const portals = {};
    links.forEach((l) => {
      const add = (c) => [l.a, l.b].forEach((id) => (portals[id] = portals[id] || []).push(c));
      if (l.openPlan) {
        const A = h.rooms.find((x) => x.id === l.a);
        const edge = l.sideA === 'right' ? A.x + A.length : l.sideA === 'left' ? A.x : l.sideA === 'bottom' ? A.y + A.width : A.y;
        const mid = (l.lo + l.hi) / 2;
        add(l.axis === 'y' ? { x: edge, y: mid, axis: l.axis, open: true } : { x: mid, y: edge, axis: l.axis, open: true });
      } else l.doors.forEach((d) => { if (d.door.open) add({ x: d.center.x, y: d.center.y, axis: l.axis }); });
    });
    particles = particles.filter((p) => {
      p.life += dt;
      if (p.life > p.max) return false;
      // cold air sinks, warm air rises (buoyancy); air slows down as it spreads
      p.vy += (p.mode === 'cool' ? -0.22 : p.mode === 'heat' ? 0.9 : 0) * dt;
      const drag = Math.pow(0.8, dt);
      p.vx *= drag; p.vz *= drag;
      // turbulence: air mixes and wanders, so some of it finds its way through open doors
      p.vx += (Math.random() - 0.5) * 7 * dt;
      p.vz += (Math.random() - 0.5) * 7 * dt;
      const ports = p.room.id === p.origin ? portals[p.room.id] : null;
      if (ports && p.y < 2) {
        let best = null, bd = Infinity;
        ports.forEach((c) => { const d = Math.hypot(c.x - p.x, c.y - p.z); if (d < bd) { bd = d; best = c; } });
        if (best && bd < 5) {
          // funnel: slide along the wall toward the opening, then drift out through it
          const alongK = best.open ? 0 : 1.6, acrossA = best.open ? 0.3 : 1.1;
          if (best.axis === 'y') { p.vz += (best.y - p.z) * alongK * dt; p.vx += Math.sign(best.x - p.x) * acrossA * dt; }
          else { p.vx += (best.x - p.x) * alongK * dt; p.vz += Math.sign(best.y - p.z) * acrossA * dt; }
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const r = p.room;
      if (p.y < 0.05) {
        // air landing on the floor spreads out sideways (once, on impact)
        p.y = 0.05;
        if (p.vy < 0) { const k = 1 + Math.min(0.5, -p.vy * 0.5); p.vx *= k; p.vz *= k; }
        p.vy = 0;
      }
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 3.5) { p.vx *= 3.5 / sp; p.vz *= 3.5 / sp; }
      if (p.y > r.height - 0.05) { p.y = r.height - 0.05; p.vy = 0; }
      const outside = p.x < r.x + 0.08 || p.x > r.x + r.length - 0.08 || p.z < r.y + 0.08 || p.z > r.y + r.width - 0.08;
      if (outside) {
        const next = passThrough(p, r);
        if (next) { p.room = next; return true; }
      }
      if (p.x < r.x + 0.08 || p.x > r.x + r.length - 0.08) { p.vx *= -0.4; p.x = clamp(p.x, r.x + 0.08, r.x + r.length - 0.08); }
      if (p.z < r.y + 0.08 || p.z > r.y + r.width - 0.08) { p.vz *= -0.4; p.z = clamp(p.z, r.y + 0.08, r.y + r.width - 0.08); }
      return true;
    });
  }

  /* ---------- drawing ---------- */
  /* ---------- drawing order ----------
     Painting far-to-near by average depth goes wrong when a small object (furniture) stands near the end of
     a long wall: the wall's middle can be nearer than the furniture although the wall is behind it, so the
     furniture flickers or shows through walls while you turn. Where it matters we use exact rules instead:
     a vertical surface hides nothing on the camera's side of it, and of two separated boxes the one on the
     camera's side is in front. Items keep their depth order wherever no rule applies. */
  function orderWith(n, rules) {
    // rules: list of [a, b] = item a is drawn before item b; items 0..n-1 are in far-to-near order
    if (!rules.length) return null;
    const indeg = new Array(n).fill(0), next = Array.from({ length: n }, () => []);
    rules.forEach(([a, b]) => { next[a].push(b); indeg[b]++; });
    const heap = [];
    const push = (v) => { heap.push(v); let i = heap.length - 1; while (i > 0) { const pa = (i - 1) >> 1; if (heap[pa] <= heap[i]) break; [heap[pa], heap[i]] = [heap[i], heap[pa]]; i = pa; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l] < heap[m]) m = l;
          if (r < heap.length && heap[r] < heap[m]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    for (let i = 0; i < n; i++) if (!indeg[i]) push(i);
    const out = [], done = new Array(n).fill(false);
    while (out.length < n) {
      if (!heap.length) { for (let i = 0; i < n; i++) if (!done[i]) { push(i); break; } } // a loop of rules: fall back to depth order
      const v = pop();
      if (done[v]) continue;
      done[v] = true; out.push(v);
      next[v].forEach((w) => { if (--indeg[w] === 0 && !done[w]) push(w); });
    }
    return out;
  }
  /* the vertical plane a flat wall-like polygon lies in (null for floors, tops, caps …) */
  function planeOf(pts) {
    const p0 = pts[0];
    const p1 = pts.find((q) => Math.hypot(q[0] - p0[0], q[2] - p0[2]) > 1e-4);
    if (!p1 || !pts.some((q) => Math.abs(q[1] - p0[1]) > 1e-4)) return null;
    const nx = -(p1[2] - p0[2]), nz = p1[0] - p0[0];
    const len = Math.hypot(nx, nz);
    if (pts.some((q) => Math.abs((q[0] - p0[0]) * nx + (q[2] - p0[2]) * nz) > 1e-3 * len)) return null;
    return { nx: nx / len, nz: nz / len, x: p0[0], z: p0[2] };
  }
  const boxesOverlap = (a, b) => a && b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  function screenBox(pps) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pps.forEach((pp) => pp.forEach((q) => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }));
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }
  /* which side of a plane a footprint is on: 1, -1, or 0 when it crosses the plane */
  function sideOf(pl, fp) {
    let pos = 0, neg = 0;
    [[fp.x0, fp.z0], [fp.x1, fp.z0], [fp.x1, fp.z1], [fp.x0, fp.z1]].forEach(([x, z]) => {
      const d = (x - pl.x) * pl.nx + (z - pl.z) * pl.nz;
      if (d > 0.005) pos++; else if (d < -0.005) neg++;
    });
    return pos === 4 ? 1 : neg === 4 ? -1 : 0;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const lm = TH().live.model;
    if (lm && lm.cycle) {
      const e = TH().sunAt(lm.season, TH().live.hour()).e;
      const night = clamp(1 - e * 3, 0, 1);
      if (night > 0) { ctx.fillStyle = `rgba(6,10,30,${0.55 * night})`; ctx.fillRect(0, 0, W, H); }
    }
    const V = viewer(W, H);
    const scene = buildScene();
    const h = Airly.store.state;
    const depthOf = (pp) => pp.reduce((sum, q) => sum + q.d, 0) / pp.length;
    floorHits = [];
    pickHits = [];

    if (!focus && h.rooms.length) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      h.rooms.forEach((r) => { x0 = Math.min(x0, r.x); z0 = Math.min(z0, r.y); x1 = Math.max(x1, r.x + r.length); z1 = Math.max(z1, r.y + r.width); });
      const m = 0.8;
      const g = V.poly([[x0 - m, -0.02, z0 - m], [x1 + m, -0.02, z0 - m], [x1 + m, -0.02, z1 + m], [x0 - m, -0.02, z1 + m]]);
      if (g) poly(g, shade(colors.ground, 1), null);
    }
    const particleItem = (p) => {
      if (!visibleRoom(p.room)) return null;
      const q = V.point(p.x, p.y + (scene.base[p.room.level || 0] || 0), p.z);
      if (!q) return null;
      const fade = Math.min(1, p.life * 4) * (1 - p.life / p.max);
      const rgb = p.mode === 'heat' ? colors.heat : p.mode === 'cool' ? colors.cool : hexToRgb('#1baf7a');
      const rad = clamp(q.s * 0.045, 1.5, 7);
      return { depth: q.d, draw: () => { ctx.fillStyle = shade(rgb, 1, 0.75 * fade); ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill(); } };
    };
    /* A piece of furniture: its boxes far-to-near, and inside each box only the faces turned towards
       the camera (by comparing depths), far-to-near — so stacked parts never show through each other. */
    const groupItem = (pl) => {
      const cq = V.point(pl.center[0], pl.center[1], pl.center[2]);
      if (!cq) return null;
      const boxes = pl.group.map((b) => { const q = V.point(b.c[0], b.c[1], b.c[2]); return { b, d: q ? q.d : Infinity }; }).filter((x) => x.d !== Infinity);
      // world bounds of each part, and of the whole piece (its footprint on the floor)
      const E = V.eye;
      boxes.forEach((x) => {
        const bb = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
        x.b.faces.forEach((fc) => fc.pts.forEach((q) => {
          bb.x0 = Math.min(bb.x0, q[0]); bb.x1 = Math.max(bb.x1, q[0]);
          bb.y0 = Math.min(bb.y0, q[1]); bb.y1 = Math.max(bb.y1, q[1]);
          bb.z0 = Math.min(bb.z0, q[2]); bb.z1 = Math.max(bb.z1, q[2]);
        }));
        x.bb = bb;
      });
      const fp = boxes.reduce((a, x) => ({ x0: Math.min(a.x0, x.bb.x0), x1: Math.max(a.x1, x.bb.x1), z0: Math.min(a.z0, x.bb.z0), z1: Math.max(a.z1, x.bb.z1) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
      const sbox = screenBox(pl.group.flatMap((b) => b.faces.map((fc) => V.poly(fc.pts)).filter(Boolean)));
      // parts far-to-near; where two parts are clearly apart along an axis, the one on the camera's side goes last
      boxes.sort((a, c) => c.d - a.d);
      const rules = [];
      const AX = [['x0', 'x1', 0], ['y0', 'y1', 1], ['z0', 'z1', 2]];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i].bb, B = boxes[j].bb;
          for (const [lo, hi, k] of AX) {
            let near = null;
            if (A[hi] <= B[lo] + 1e-4) near = E[k] > B[lo] ? 'B' : E[k] < A[hi] ? 'A' : null;
            else if (B[hi] <= A[lo] + 1e-4) near = E[k] > A[lo] ? 'A' : E[k] < B[hi] ? 'B' : null;
            if (near) { rules.push(near === 'B' ? [i, j] : [j, i]); break; }
          }
        }
      }
      const ord = orderWith(boxes.length, rules);
      const ordered = ord ? ord.map((k) => boxes[k]) : boxes;
      return {
        depth: cq.d,
        fp,
        sbox,
        draw: () => {
          ordered.forEach(({ b }) => {
            b.faces.map((fc) => {
              const E = V.eye;
              if (fc.n) { if (fc.n[0] * (E[0] - fc.mid[0]) + fc.n[1] * (E[2] - fc.mid[2]) <= 0) return null; } // side facing away
              else if (fc.pts.length === 4 && E[1] < fc.pts[0][1]) return null; // top seen from below
              const pp = V.poly(fc.pts);
              return pp ? { pp, fc, d: depthOf(pp) } : null;
            }).filter(Boolean).sort((a, c) => c.d - a.d).forEach(({ pp, fc }) => {
              poly(pp, fc.fill, fc.stroke, 0.6);
              pickHits.push({ pp, depth: depthOf(pp), door: null, furn: pl.furn });
            });
          });
        },
      };
    };
    const polyItem = (pl, bias) => {
      if (pl.group) return groupItem(pl);
      const pp = V.poly(pl.pts);
      if (!pp) return null;
      pickHits.push({ pp, depth: depthOf(pp), door: pl.door || null });
      if (pl.plane === undefined) pl.plane = planeOf(pl.pts);
      return { depth: depthOf(pp) - (bias || 0), plane: pl.plane, sbox: screenBox([pp]), draw: () => poly(pp, pl.fill, pl.stroke, pl.lw) };
    };
    const paint = (list) => {
      const items = list.filter(Boolean).sort((x, y) => y.depth - x.depth);
      const rules = [];
      const E = V.eye;
      items.forEach((g, gi) => {
        if (!g.fp) return; // furniture only
        items.forEach((w, wi) => {
          if (!w.plane || !boxesOverlap(g.sbox, w.sbox)) return;
          const side = sideOf(w.plane, g.fp);
          if (!side) return;
          const eye = (E[0] - w.plane.x) * w.plane.nx + (E[2] - w.plane.z) * w.plane.nz;
          // furniture on the camera's side of the surface is in front of it, otherwise behind it
          rules.push(Math.sign(eye) === side ? [wi, gi] : [gi, wi]);
        });
      });
      const ord = orderWith(items.length, rules);
      (ord ? ord.map((k) => items[k]) : items).forEach((it) => it.draw());
    };

    if (!focus) {
      const lvls = [...new Set(scene.floors.map((f) => f.level))].sort((a, b) => a - b);
      lvls.forEach((L) => {
        scene.floors.filter((f) => f.level === L).forEach((f) => {
          const pp = V.poly(f.pts);
          if (!pp) return;
          poly(pp, f.fill, f.stroke);
          floorHits.push({ room: f.room, pp, depth: depthOf(pp) });
        });
        paint(scene.polys.filter((pl) => pl.level === L).map((pl) => polyItem(pl, (pl.ac ? 0.05 : 0) + (pl.cap ? 0.02 : 0)))
          .concat(particles.filter((p) => (p.room.level || 0) === L).map(particleItem)));
      });
    } else {
      /* Inside a (convex) room everything else is hidden behind its walls except through openings:
         draw the rest of the house first, then this room's shell, then what is inside it. */
      scene.floors.filter((f) => f.room !== focus).forEach((f) => { const pp = V.poly(f.pts); if (pp) poly(pp, f.fill, f.stroke); });
      paint(scene.polys.filter((pl) => pl.room !== focus).map((pl) => polyItem(pl)).concat(particles.filter((p) => p.room.id !== focus).map(particleItem)));
      const own = scene.floors.find((f) => f.room === focus);
      if (own) { const pp = V.poly(own.pts); if (pp) poly(pp, own.fill, own.stroke); }
      if (scene.ceiling) { const pp = V.poly(scene.ceiling.pts); if (pp) poly(pp, scene.ceiling.fill, shade(colors.wallTop, 1, 0.3)); }
      paint(scene.polys.filter((pl) => pl.room === focus && !pl.inner && !pl.cap).map((pl) => polyItem(pl)));
      paint(scene.polys.filter((pl) => pl.room === focus && pl.inner).map((pl) => polyItem(pl)).concat(particles.filter((p) => p.room.id === focus).map(particleItem)));
    }

    // open doorways are clickable too (to close them)
    (scene.doorGaps || []).forEach((g) => {
      const pp = V.poly(g.pts);
      if (pp) pickHits.push({ pp, depth: depthOf(pp) - 0.01, door: g.door });
    });

    // room labels (overview only)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // only label the top visible floor (labels of floors below would show through)
    const topLv = scene.labels.reduce((m, l) => Math.max(m, l.level || 0), 0);
    scene.labels.filter((l) => (l.level || 0) === topLv).forEach((l) => {
      const q = V.point(l.x, l.y, l.z);
      if (!q) return;
      const fs = clamp(q.s * 0.28, 10, 18);
      const line1 = l.name;
      const line2 = l.T != null ? Airly.fmt.temp(l.T) : '';
      ctx.font = '700 ' + fs + 'px system-ui, sans-serif';
      const w = Math.max(ctx.measureText(line1).width, line2 ? ctx.measureText(line2).width * 1.25 : 0) + 14;
      const hgt = line2 ? fs * 2.7 : fs * 1.6;
      ctx.fillStyle = colors.dark ? 'rgba(20,20,18,.78)' : 'rgba(255,255,255,.85)';
      roundRect(q.x - w / 2, q.y - hgt / 2, w, hgt, 7);
      ctx.fill();
      ctx.fillStyle = colors.text;
      if (line2) {
        ctx.fillText(line1, q.x, q.y - fs * 0.6);
        ctx.font = '800 ' + fs * 1.25 + 'px system-ui, sans-serif';
        ctx.fillText(line2, q.x, q.y + fs * 0.65);
      } else ctx.fillText(line1, q.x, q.y);
    });
  }
  /* What is under the pointer? The nearest door, wall or floor wins, so hidden doors can't be clicked. */
  function pickAt(x, y) {
    const inside = (pp) => {
      let c = false;
      for (let i = 0, j = pp.length - 1; i < pp.length; j = i++) {
        if ((pp[i].y > y) !== (pp[j].y > y) && x < ((pp[j].x - pp[i].x) * (y - pp[i].y)) / (pp[j].y - pp[i].y) + pp[i].x) c = !c;
      }
      return c;
    };
    const all = pickHits.concat(floorHits.map((f) => ({ pp: f.pp, depth: f.depth, room: f.room }))).filter((hh) => inside(hh.pp));
    all.sort((a, b) => a.depth - b.depth);
    return all[0] || null;
  }
  function pickRoom(x, y) {
    const inside = (pp) => {
      let c = false;
      for (let i = 0, j = pp.length - 1; i < pp.length; j = i++) {
        if ((pp[i].y > y) !== (pp[j].y > y) && x < ((pp[j].x - pp[i].x) * (y - pp[i].y)) / (pp[j].y - pp[i].y) + pp[i].x) c = !c;
      }
      return c;
    };
    const hits = floorHits.filter((f) => inside(f.pp)).sort((p, q) => p.depth - q.depth);
    return hits.length ? hits[0].room : null;
  }
  function poly(pp, fill, stroke, lw) {
    ctx.beginPath();
    pp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------- side panel ---------- */
  let lastPanel = 0;
  /* "where you stand": local temperature and draft at the camera position */
  function feelLine(h, live, started) {
    if (!started || !focus) return '';
    const f = TH().feelAt(h, live.model, cam.tx, cam.tz, { room: focusRoom() });
    if (!f || f.local == null) return '';
    const draft = f.draft ? ' · ≋ ' + t(f.draft === 2 ? 'v3d.draft2' : 'v3d.draft1') : '';
    return '<div class="hud-feel">' + esc(t('v3d.feel', { t: Airly.fmt.temp(f.local) })) + esc(draft) + '</div>';
  }
  function updatePanel(force) {
    const now = performance.now();
    if (!force && now - lastPanel < 300) return;
    lastPanel = now;
    const h = Airly.store.state;
    const live = TH().live;
    const started = live.model && live.model.t > 0;
    const st = dlg.querySelector('#v3d-status');
    const season = h.env.season;
    const hr = live.model ? live.hour() : null;
    const clock = hr != null ? (TH().sunAt(live.model.season, hr).e > 0 ? '☀ ' : '☾ ') + Airly.fmt.clock(hr) + ' · ' : '';
    st.textContent = `${clock}${t('season.' + season)} · ${t('dash.outside')} ${Airly.fmt.temp(live.model ? live.outside() : TH().seasonOutside(h.env))} · ${t('sim.elapsed')} ${Airly.fmt.dur(live.model ? live.model.t : 0)}`;
    const walls = dlg.querySelector('[data-v3d="walls"]');
    walls.setAttribute('aria-pressed', String(wallMode === 'low'));
    walls.innerHTML = `<span aria-hidden="true">▤</span> ${esc(t(wallMode === 'low' ? 'v3d.wallsFull' : 'v3d.wallsLow'))}`;
    const list = dlg.querySelector('#v3d-rooms');
    const listHTML = h.rooms.map((r) => {
      const on = r.id === focus;
      const T = started ? live.tempOf(r.id) : null;
      const target = TH().desiredFor(h, r);
      const sw = T != null ? Airly.tempColor(T, target) : 'transparent';
      const d = T != null ? T - target : 0;
      const state = T == null ? '' : Math.abs(d) <= 0.5 ? t('sim.atTarget') : d > 0 ? '▲ ' + Airly.fmt.tempDelta(d) : '▼ ' + Airly.fmt.tempDelta(-d);
      return `<li><button type="button" class="v3d-room-btn${on ? ' active' : ''}" data-v3d="room" data-id="${r.id}" aria-pressed="${on}" title="${esc(t('v3d.enter', { room: Airly.roomName(r) }))}"><span class="swatch" style="background:${sw}"></span><span class="v3d-room">${esc(Airly.roomName(r))}</span><b>${T != null ? esc(Airly.fmt.temp(T)) : '—'}</b><small>${esc(state)}</small></button></li>`;
    }).join('');
    if (list.dataset.html !== listHTML) { list.innerHTML = listHTML; list.dataset.html = listHTML; }
    updateACStatus();
    const fr = focusRoom();
    dlg.querySelector('[data-v3d="overview"]').hidden = !fr;
    dlg.querySelector('[data-v3d="walk"]').hidden = !!fr;
    dlg.querySelector('[data-v3d="walls"]').hidden = !!fr;
    dlg.querySelector('#v3d-hint').textContent = t(fr ? 'v3d.hintInside' : 'v3d.hint');
    const hud = dlg.querySelector('#v3d-hud');
    hud.hidden = !fr;
    if (fr) {
      const T = started ? live.tempOf(fr.id) : null;
      const target = TH().desiredFor(h, fr);
      const d = T != null ? T - target : 0;
      const st2 = T == null ? '' : Math.abs(d) <= 0.5 ? t('sim.atTarget') : d > 0 ? t('sim.warmer', { d: Airly.fmt.tempDelta(d) }) : t('sim.cooler', { d: Airly.fmt.tempDelta(-d) });
      const acs = h.acs.filter((a) => a.roomId === fr.id).map((a) => {
        const idx = h.acs.indexOf(a) + 1;
        const ma = live.model && live.model.acs.find((x) => x.id === a.id);
        const out = !a.on ? t('ac.off') : ma && ma.activeStarting ? t('sim.acStarting') : ma && ma.activeMode && started ? t('mode.' + ma.activeMode) + ' · ' + Math.round(ma.frac * 100) + '%' : t('mode.' + a.mode);
        return '<li>' + esc(t('ac.unit')) + ' ' + idx + ' · ' + esc(Airly.fmt.btu(a.btu)) + ' · ' + esc(out) + '</li>';
      });
      hud.innerHTML = '<div class="hud-name">' + esc(Airly.roomName(fr)) + '</div>' +
        '<div class="hud-temp">' + (T != null ? esc(Airly.fmt.temp(T)) : '—') + '</div>' +
        '<div class="hud-sub">' + esc(t('an.desired')) + ' ' + esc(Airly.fmt.temp(target)) + (st2 ? ' · ' + esc(st2) : '') + '</div>' +
        (started && live.rhOf(fr.id) != null ? '<div class="hud-sub">' + esc(t('sim.humidity')) + ' ' + Math.round(live.rhOf(fr.id)) + ' %</div>' : '') +
        feelLine(h, live, started) +
        '<ul class="hud-acs">' + (acs.join('') || '<li>' + esc(t('v3d.noAC')) + '</li>') + '</ul>';
    }
  }

  /* ---------- Doors inside the 3D view ---------- */
  function doorEntries() {
    const h = Airly.store.state;
    const links = TH().adjacency(h);
    const out = [];
    h.rooms.forEach((r) => r.doors.forEach((d) => {
      const link = links.find((l) => l.doors.some((x) => x.door.id === d.id));
      const other = link ? h.rooms.find((x) => x.id === (link.a === r.id ? link.b : link.a)) : null;
      if (focus && r.id !== focus && (!other || other.id !== focus)) return;
      out.push({ room: r, door: d, other, name: Airly.roomName(r) + ' ↔ ' + (other ? Airly.roomName(other) : t('v3d.doorOutside')) });
    }));
    return out;
  }
  function renderDoors() {
    const box = dlg && dlg.querySelector('#v3d-doors');
    if (!box) return;
    const list = doorEntries();
    // keep keyboard focus on the same button after the list is redrawn
    const act = document.activeElement;
    const keep = act && box.contains(act) ? (act.dataset.id ? `[data-v3d="door"][data-id="${act.dataset.id}"]` : act.dataset.v3d ? `[data-v3d="${act.dataset.v3d}"][data-open="${act.dataset.open}"]` : null) : null;
    box.innerHTML = list.length
      ? `<p class="muted small">${esc(t('v3d.doorHint'))}</p>
        <div class="row-gap v3d-door-all">${'<button type="button" class="btn small" data-v3d="doorsAll" data-open="1">' + esc(t('sim.openDoors')) + '</button><button type="button" class="btn small" data-v3d="doorsAll" data-open="0">' + esc(t('sim.closeDoors')) + '</button>'}</div>
        <ul class="v3d-door-list">${list.map((e) => `<li><button type="button" class="v3d-door-btn${e.door.open ? ' is-open' : ''}" data-v3d="door" data-room="${e.room.id}" data-id="${e.door.id}" aria-pressed="${!!e.door.open}">
          <span class="door-icon" aria-hidden="true">${e.door.open ? '🚪' : '▮'}</span><span class="door-name">${esc(e.name)}</span><b>${esc(t(e.door.open ? 'v3d.doorOpen' : 'v3d.doorClosed'))}</b></button>${focus && e.other ? `<button type="button" class="btn small v3d-go" data-v3d="goDoor" data-room="${e.room.id}" data-id="${e.door.id}" aria-label="${esc(t('v3d.goThroughAria', { room: Airly.roomName(e.room.id === focus ? e.other : e.room) }))}" title="${esc(t('v3d.goThroughAria', { room: Airly.roomName(e.room.id === focus ? e.other : e.room) }))}"><span aria-hidden="true">🚶→</span></button>` : ''}</li>`).join('')}</ul>`
      : `<p class="muted small">${esc(t('v3d.noDoors'))}</p>`;
    // stairs from / to this room
    const fr = focusRoom();
    if (fr) {
      const lv = fr.level || 0;
      const inRoom = (x, z) => x >= fr.x && x <= fr.x + fr.length && z >= fr.y && z <= fr.y + fr.width;
      const st = stairsList(Airly.store.state).map((s2) => {
        const cx = s2.x + s2.w / 2, cz = s2.y + s2.d / 2;
        if ((s2.level || 0) === lv && inRoom(cx, cz)) return `<button type="button" class="btn small" data-v3d="stairs" data-id="${s2.id}" data-up="1">↑ ${esc(t('v3d.upstairs'))}</button>`;
        if ((s2.level || 0) === lv - 1 && inRoom(cx, cz)) return `<button type="button" class="btn small" data-v3d="stairs" data-id="${s2.id}" data-up="0">↓ ${esc(t('v3d.downstairs'))}</button>`;
        return '';
      }).join('');
      if (st) box.insertAdjacentHTML('beforeend', `<div class="row-gap v3d-stairs">${st}</div>`);
    }
    if (keep) { const el = box.querySelector(keep); if (el) el.focus({ preventScroll: true }); }
  }
  function toggleFridge(id) {
    const f = (Airly.store.state.furniture || []).find((x) => x.id === id);
    if (!f) return;
    f.open = !f.open;
    Airly.store.commit('form');
    Airly.toast(t(f.open ? 'fridge.opened' : 'fridge.closed'));
  }
  function toggleDoor(roomId, doorId) {
    const r = Airly.store.room(roomId);
    const d = r && r.doors.find((x) => x.id === doorId);
    if (!d) return;
    d.open = !d.open;
    Airly.store.commit('struct');
    renderDoors();
    const entry = doorEntries().find((e) => e.door.id === doorId);
    Airly.toast(t(d.open ? 'v3d.doorOpened' : 'v3d.doorClosedToast', { name: entry ? entry.name : Airly.roomName(r) }));
  }
  function setAllDoors(open) {
    const ids = new Set(doorEntries().map((e) => e.door.id));
    Airly.store.state.rooms.forEach((r) => r.doors.forEach((d) => { if (ids.has(d.id)) d.open = open; }));
    Airly.store.commit('struct');
    renderDoors();
  }

  /* ---------- AC controls inside the 3D view ---------- */
  const FAN_SPEEDS = () => Airly.FAN_SPEEDS;
  function acList() {
    const h = Airly.store.state;
    return focus ? h.acs.filter((a) => a.roomId === focus) : h.acs;
  }
  function renderACs() {
    const box = dlg && dlg.querySelector('#v3d-acs');
    if (!box) return;
    const h = Airly.store.state;
    const list = acList();
    const opt = (vals, prefix, cur) => vals.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t(prefix + v))}</option>`).join('');
    const heading = dlg.querySelector('#v3d-acs-title');
    if (heading) heading.textContent = t(focus ? 'v3d.acsRoom' : 'v3d.acsAll');
    if (!list.length) {
      box.innerHTML = `<p class="muted small">${esc(t(focus ? 'v3d.noAC' : 'acs.none'))}</p>`;
      return;
    }
    box.innerHTML = list.map((a) => {
      const n = h.acs.indexOf(a) + 1;
      const r = h.rooms.find((x) => x.id === a.roomId);
      const k = (p) => `ac.${a.id}.${p}`;
      return `<div class="v3d-ac" data-ac="${a.id}">
        <div class="v3d-ac-head">
          <span class="ac-dot m-${a.on ? a.mode : 'off'}" data-dot="${a.id}" aria-hidden="true"></span>
          <strong>${esc(t('ac.unit'))} ${n}</strong>
          <span class="muted small">${esc(Airly.fmt.btu(a.btu))}${!focus && r ? ' · ' + esc(Airly.roomName(r)) : ''}</span>
          <label class="switch"><input type="checkbox" role="switch" data-bind="${k('on')}"${a.on ? ' checked' : ''}><span class="track" aria-hidden="true"></span><span class="sr-only">${esc(t('ac.power'))} ${n}</span></label>
        </div>
        <div class="v3d-temp-ctl" role="group" aria-label="${esc(t('ac.target'))} — ${esc(t('ac.unit'))} ${n}">
          <button type="button" class="btn icon" data-v3d="tdown" data-id="${a.id}" aria-label="${esc(t('v3d.tempDown'))}">−</button>
          <output id="v3d-t-${a.id}" aria-live="polite">${esc(Airly.fmt.temp(a.target))}</output>
          <button type="button" class="btn icon" data-v3d="tup" data-id="${a.id}" aria-label="${esc(t('v3d.tempUp'))}">+</button>
        </div>
        <div class="v3d-ac-grid">
          <label><span>${esc(t('ac.mode'))}</span><select data-bind="${k('mode')}">${opt(Airly.AC_MODES, 'mode.', a.mode)}</select></label>
          <label><span>${esc(t('ac.fan'))}</span><select data-bind="${k('fan')}">${opt(FAN_SPEEDS(), 'fan.', a.fan)}</select></label>
          <label class="span2"><span>${esc(t('ac.direction'))}</span><select data-bind="${k('direction')}">${opt(Airly.DIRECTIONS, 'dir.', a.direction)}</select></label>
        </div>
        <p class="v3d-ac-out muted small" data-v3d-out="${a.id}"></p>
        ${!focus && r ? `<button type="button" class="btn small ghost" data-v3d="room" data-id="${r.id}">${esc(t('v3d.enter', { room: Airly.roomName(r) }))}</button>` : ''}
      </div>`;
    }).join('');
    updateACStatus();
  }
  function updateACStatus() {
    if (!dlg) return;
    const live = TH().live;
    const started = live.model && live.model.t > 0;
    acList().forEach((a) => {
      const out = dlg.querySelector(`[data-v3d-out="${a.id}"]`);
      const dot = dlg.querySelector(`[data-dot="${a.id}"]`);
      if (dot) dot.className = 'ac-dot m-' + (a.on ? a.mode : 'off');
      if (!out) return;
      const ma = live.model && live.model.acs.find((x) => x.id === a.id);
      let txt;
      if (!a.on) txt = t('ac.off');
      else if (ma && ma.activeStarting) txt = t('sim.acStarting');
      else if (ma && ma.activeMode && started) txt = t('sim.acOutput', { pct: Math.round(ma.frac * 100), kw: Airly.fmt.num(ma.powerKW, 2), mode: t('mode.' + ma.activeMode) });
      else if (!live.running) txt = t('v3d.acReady', { mode: t('mode.' + a.mode) });
      else txt = t('sim.acIdle');
      if (out.textContent !== txt) out.textContent = txt;
    });
  }
  function stepTarget(id, d) {
    const a = Airly.store.ac(id);
    if (!a) return;
    const f = Airly.fmt;
    if (f.isF()) {
      // whole °F steps: go to the next whole degree in the chosen direction
      const cur = f.toU(a.target);
      const next = d > 0 ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
      a.target = clamp(Math.round(f.fromU(next) * 100) / 100, 16, 30);
    }
    else a.target = clamp(Math.round((a.target + d) * 2) / 2, 16, 30);
    Airly.store.commit('form');
    const o = dlg.querySelector('#v3d-t-' + id);
    if (o) o.textContent = Airly.fmt.temp(a.target);
  }

  /* ---------- loop & lifecycle ---------- */
  function frame(ts) {
    if (!dlg.open) { raf = null; return; }
    const dt = Math.min(0.05, (ts - (lastT || ts)) / 1000);
    lastT = ts;
    if (autoPath && focus) stepAuto(dt);
    else { autoPath = null; applyHeldKeys(dt); }
    updateParticles(dt);
    draw();
    updatePanel();
    raf = requestAnimationFrame(frame);
  }

  /* A / D turn the camera (left / right), W / S walk when inside a room — smooth while held */
  function applyHeldKeys(dt) {
    if (!held.size) return;
    const turn = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    if (focus) {
      cam.yaw -= turn * 1.8 * dt; // same direction as ←/→ inside a room
      const move = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
      if (move) walk(move * 1.8 * dt);
      const strafe = (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0);
      if (strafe) walk(0, strafe * 1.4 * dt);
    } else {
      cam.yaw += turn * 1.2 * dt; // orbit around the house
      const tilt = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
      if (tilt) cam.pitch = clamp(cam.pitch + tilt * 0.8 * dt, 0.12, 1.5);
    }
  }
  function ensureDialog() {
    dlg = dlg || document.getElementById('view3d');
    if (dlg.dataset.ready) return;
    dlg.dataset.ready = '1';
    // keys work anywhere in the 3D window, except while typing in a field or choosing in a menu
    const typing = (el) => el && (/^(input|select|textarea)$/i.test(el.tagName) || el.isContentEditable);
    // listen on the whole page (not just the dialog): if focus falls back to the page body,
    // the keys must keep working while the 3D window is open
    document.addEventListener('keydown', (ev) => {
      if (!dlg.open) return;
      const k = (ev.key || '').toLowerCase();
      if (ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;
      if (k === 'a' || k === 'd' || k === 'w' || k === 's' || k === 'q' || k === 'e') { held.add(k); autoPath = null; ev.preventDefault(); return; }
      // Space: open/close the door in front of you · Enter: walk through it (only when not on a button)
      const onControl = ev.target && ev.target.closest && ev.target.closest('button, a, [role="button"]');
      if (focus && !onControl && (k === ' ' || k === 'enter')) {
        ev.preventDefault();
        const d = facingDoor();
        if (!d) { Airly.toast(t('v3d.noDoorAhead')); return; }
        if (k === ' ') toggleDoor(d.room, d.id);
        else goThrough(d);
      }
    });
    document.addEventListener('keyup', (ev) => held.delete((ev.key || '').toLowerCase()));
    window.addEventListener('blur', () => held.clear());
    dlg.addEventListener('change', (ev) => {
      if (ev.target.id === 'v3d-level') { showLevel = ev.target.value; particles = []; }
    });
    dlg.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-v3d]');
      if (!b) return;
      const a = b.dataset.v3d;
      const live = TH().live;
      if (a === 'close') dlg.close();
      else if (a === 'room') { if (b.dataset.id === focus) exitRoom(); else enterRoom(b.dataset.id); canvas.focus(); }
      else if (a === 'overview') { exitRoom(); canvas.focus(); }
      else if (a === 'walk') { startWalk(); canvas.focus(); }
      else if (a === 'door') toggleDoor(b.dataset.room, b.dataset.id);
      else if (a === 'doorsAll') setAllDoors(b.dataset.open === '1');
      else if (a === 'stairs') { takeStairs(b.dataset.id, b.dataset.up === '1'); canvas.focus(); }
      else if (a === 'goDoor') { goThrough({ room: b.dataset.room, id: b.dataset.id }); canvas.focus(); }
      else if (a === 'tdown') stepTarget(b.dataset.id, -0.5);
      else if (a === 'tup') stepTarget(b.dataset.id, 0.5);
      else if (a === 'sim') {
        if (live.running) live.stop();
        else { if (!live.model) live.rebuild(Airly.store.state); live.start(); }
        updatePanel(true);
      } else if (a === 'reset') { live.reset(Airly.store.state); particles = []; updatePanel(true); }
      else if (a === 'walls') { wallMode = wallMode === 'low' ? 'full' : 'low'; updatePanel(true); }
      else if (a === 'rotL') cam.yaw -= Math.PI / 8;
      else if (a === 'rotR') cam.yaw += Math.PI / 8;
      else if (a === 'zoomIn') zoom(1 / 1.2);
      else if (a === 'zoomOut') zoom(1.2);
      else if (a === 'view') { if (focus) enterRoom(focus); else fit(); }
    });
    dlg.addEventListener('close', () => {
      held.clear();
      // shown inside the designer: hand the 3D window back to the page and show the 2D plan again
      if (dlg.classList.contains('inline')) {
        dlg.classList.remove('inline');
        Airly.ui.designer3d = false;
        document.body.appendChild(dlg);
      }
      if (focus) { focus = null; wallMode = savedWallMode || 'full'; savedWallMode = null; }
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (Airly.render) Airly.render();
      const opener = document.querySelector('[data-action="open3d"]');
      if (opener) opener.focus();
    });
  }
  function zoom(k) {
    if (focus) cam.fov = clamp(cam.fov / k, 0.6, 2.5);
    else cam.dist = clamp(cam.dist * k, 3, 120);
  }
  function bindCanvas() {
    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      } else drag = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, pan: !focus && (ev.shiftKey || ev.button === 2) };
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId) || !drag) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (drag.pinch != null) {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0) zoom(drag.pinch / d);
        drag.pinch = d;
        return;
      }
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY;
      if (drag.pan) {
        const k = cam.dist / 900;
        const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        cam.tx -= (dx * cy - dy * sy) * k;
        cam.tz -= (-dx * sy - dy * cy) * k;
      } else if (focus) {
        // look around
        cam.yaw += dx * 0.005;
        cam.pitch = clamp(cam.pitch - dy * 0.004, -0.9, 0.9);
      } else {
        cam.yaw += dx * 0.008;
        cam.pitch = clamp(cam.pitch + dy * 0.006, 0.12, 1.5);
      }
    });
    const up = (ev) => {
      const d = drag;
      pointers.delete(ev.pointerId);
      if (!pointers.size) drag = null;
      // a click (no drag) on a floor in the overview enters that room
      // a click (no drag): on a door opens/closes it; on a floor in the overview enters that room
      if (d && d.sx != null && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 5) {
        const rect = canvas.getBoundingClientRect();
        const hit = pickAt(ev.clientX - rect.left, ev.clientY - rect.top);
        const fr = hit && hit.furn && (Airly.store.state.furniture || []).find((f) => f.id === hit.furn);
        if (fr && fr.kind === 'fridge') toggleFridge(fr.id);
        else if (hit && hit.door) {
          const dd = doorInfo(hit.door);
          if (focus && dd && dd.d.open && dd.other) goThrough(hit.door);
          else toggleDoor(hit.door.room, hit.door.id);
        }
        else if (!focus && hit && hit.room) enterRoom(hit.room);
      }
    };
    canvas.addEventListener('pointermove', (ev) => {
      if (drag) return;
      const rect = canvas.getBoundingClientRect();
      const hit = pickAt(ev.clientX - rect.left, ev.clientY - rect.top);
      const isFridge = hit && hit.furn && (Airly.store.state.furniture || []).some((f) => f.id === hit.furn && f.kind === 'fridge');
      canvas.style.cursor = hit && (hit.door || isFridge || (!focus && hit.room)) ? 'pointer' : '';
    });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoom(ev.deltaY > 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    canvas.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (focus) {
        if (k === 'ArrowLeft') cam.yaw += 0.12;
        else if (k === 'ArrowRight') cam.yaw -= 0.12;
        else if (k === 'ArrowUp') walk(0.3);
        else if (k === 'ArrowDown') walk(-0.3);
        else if (k === 'PageUp') cam.pitch = clamp(cam.pitch - 0.1, -0.9, 0.9);
        else if (k === 'PageDown') cam.pitch = clamp(cam.pitch + 0.1, -0.9, 0.9);
        else if (k === '+' || k === '=') zoom(1 / 1.15);
        else if (k === '-') zoom(1.15);
        else if (k === 'Backspace' || k === 'o') exitRoom();
        else return;
        ev.preventDefault();
        return;
      }
      if (k === 'ArrowLeft') cam.yaw -= 0.1;
      else if (k === 'ArrowRight') cam.yaw += 0.1;
      else if (k === 'ArrowUp') cam.pitch = clamp(cam.pitch + 0.08, 0.12, 1.5);
      else if (k === 'ArrowDown') cam.pitch = clamp(cam.pitch - 0.08, 0.12, 1.5);
      else if (k === '+' || k === '=') zoom(1 / 1.15);
      else if (k === '-') zoom(1.15);
      else return;
      ev.preventDefault();
    });
  }

  /* host: show the 3D view inside this element (the designer) instead of as a full-screen window */
  function open(host) {
    ensureDialog();
    if (host) { host.appendChild(dlg); dlg.classList.add('inline'); }
    readColors();
    const h = Airly.store.state;
    const btn = (a, label, cls, extra) => `<button type="button" class="btn ${cls || ''}" data-v3d="${a}" ${extra || ''}>${label}</button>`;
    dlg.innerHTML = `<div class="v3d">
      <header class="v3d-head">
        <div class="v3d-title"><h2 id="v3d-title"><span aria-hidden="true">🧊</span> ${esc(t('v3d.title', { name: h.name || t('home.defaultName') }))}</h2><p id="v3d-status" class="muted small"></p></div>
        <div class="v3d-tools" role="toolbar" aria-label="${esc(t('v3d.tools'))}">
          ${btn('walk', '<span aria-hidden="true">🚶</span> ' + esc(t('v3d.walk')))}
          ${btn('overview', '<span aria-hidden="true">🏠</span> ' + esc(t('v3d.overview')), '', 'hidden')}
          ${(h.levels || 1) > 1 ? `<label class="sr-only" for="v3d-level">${esc(t('level.show'))}</label><select id="v3d-level" class="v3d-level"><option value="all">${esc(t('level.all'))}</option>${Array.from({ length: h.levels }, (_, k) => `<option value="${k}">${esc(t('level.upTo', { name: Airly.levelName(k) }))}</option>`).join('')}</select>` : ''}
          ${btn('walls', '', '', 'aria-pressed="false"')}
          ${btn('rotL', '⟲', 'icon', `aria-label="${esc(t('v3d.rotL'))}"`)}
          ${btn('rotR', '⟳', 'icon', `aria-label="${esc(t('v3d.rotR'))}"`)}
          ${btn('zoomOut', '−', 'icon', `aria-label="${esc(t('plan.zoomOut'))}"`)}
          ${btn('zoomIn', '+', 'icon', `aria-label="${esc(t('plan.zoomIn'))}"`)}
          ${btn('view', esc(t('v3d.resetView')))}
          ${btn('close', '✕', 'icon', `aria-label="${esc(t('common.close'))}"`)}
        </div>
      </header>
      <div class="v3d-body">
        <div class="v3d-stage">
          <button type="button" class="btn plan-3d-btn" data-v3d="close" title="${esc(t('v3d.back2d'))}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 11h9.5V3.5M13 11v9.5"/></svg><span>2D</span><span class="sr-only"> — ${esc(t('v3d.back2d'))}</span></button>
          <canvas id="v3d-canvas" tabindex="0" role="img" aria-label="${esc(t('v3d.aria'))}"></canvas>
          <p class="v3d-hint" id="v3d-hint">${esc(t('v3d.hint'))}</p>
          <div class="v3d-hud" id="v3d-hud" aria-live="polite" hidden></div>
        </div>
        <aside class="v3d-side">
          <h3>${esc(t('v3d.rooms'))}</h3>
          <p class="muted small">${esc(t('v3d.pickRoom'))}</p>
          <ul class="v3d-rooms" id="v3d-rooms" aria-live="off"></ul>
          <h3>${esc(t('v3d.doors'))}</h3>
          <div id="v3d-doors"></div>
          <h3 id="v3d-acs-title">${esc(t('v3d.acsAll'))}</h3>
          <div id="v3d-acs" class="v3d-acs"></div>
        </aside>
      </div></div>`;
    canvas = dlg.querySelector('#v3d-canvas');
    ctx = canvas.getContext('2d');
    bindCanvas();
    particles = [];
    focus = null;
    showLevel = 'all';
    fit();
    if (!dlg.open) { if (host) dlg.show(); else dlg.showModal(); }
    updatePanel(true);
    renderACs();
    renderDoors();
    canvas.focus();
    lastT = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* the designer re-draws its page often: put the running inline 3D view back into the new page */
  function attach(host) {
    if (!dlg || !dlg.open || !dlg.classList.contains('inline')) return false;
    host.appendChild(dlg);
    if (!raf) raf = requestAnimationFrame(frame);
    return true;
  }
  /* leaving the designer: close the inline 3D view */
  function closeInline() {
    if (dlg && dlg.open && dlg.classList.contains('inline')) dlg.close();
  }

  Airly.view3d = {
    open,
    attach,
    closeInline,
    /* start walking (used by the 2D plan's "Walk around" button) */
    walk() { if (dlg && dlg.open) { startWalk(); canvas.focus(); } },
    /* test hook: what is under a canvas point */
    _pickAt: (x, y) => pickAt(x, y),
    _cam: () => Object.assign({}, cam),
    _focus: () => focus,
    _autoWalking: () => !!autoPath,
    _face: (x, z) => { cam.yaw = Math.atan2(-(x - cam.tx), -(z - cam.tz)); cam.pitch = 0.05; },
    /* debug helper: number of airflow particles currently in each room */
    stats() { const o = {}; particles.forEach((p) => (o[Airly.roomName(p.room)] = (o[Airly.roomName(p.room)] || 0) + 1)); return o; },
  };
})();

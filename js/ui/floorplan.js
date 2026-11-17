/* Airly — interactive 2D floor plan (SVG, world units = meters) */
(function () {
  'use strict';
  const Airly = window.Airly;
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = (v) => Math.round(v * 10) / 10;

  /* Furniture seen from above: its parts from low to high, so cushions sit on seats and pillows on beds */
  function furnitureSVG(f, home) {
    const L = Airly.furnitureLook;
    const ps = L.parts(f, home);
    const col = (mat, k) => { const c = L.rgb(mat); return `rgb(${c.map((v) => Math.round(Math.min(255, v * (k || 1)))).join(',')})`; };
    const n = (v) => +v.toFixed(3);
    const blocks = ps.filter((p) => !p.disc && !p.line).sort((a, b) => a.z1 - b.z1);
    let s = '';
    blocks.forEach((p) => {
      const w = p.x1 - p.x0, d = p.y1 - p.y0;
      if (w <= 0.001 || d <= 0.001) return;
      const r = Math.min(p.r || 0, w / 2, d / 2);
      const al = L.alpha ? L.alpha(p.mat) : 1; // glass and mirrors are see-through
      s += `<rect class="furn-part" x="${n(p.x0)}" y="${n(p.y0)}" width="${n(w)}" height="${n(d)}"${r ? ` rx="${n(r)}"` : ''} fill="${col(p.mat)}" stroke="${col(p.mat, 0.72)}"${al < 1 ? ` fill-opacity="${al}"` : ''}/>`;
    });
    ps.filter((p) => p.disc).forEach((p) => (s += `<circle class="furn-part" cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.rad)}" fill="none" stroke="${col(p.mat)}" stroke-width="0.025"/>`));
    ps.filter((p) => p.line).forEach((p) => (s += `<line class="furn-part" x1="${n(p.x0)}" y1="${n(p.y0)}" x2="${n(p.x1)}" y2="${n(p.y1)}" stroke="${col(p.mat)}" stroke-width="0.02"/>`));
    return s;
  }

  /* Diverging temperature colour: blue (cooler than target) ↔ neutral ↔ orange (warmer) */
  function mix(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function tempColor(T, target) {
    const dark = document.documentElement.dataset.themeResolved === 'dark';
    const neutral = dark ? '#3a3a37' : '#ecebe6';
    const cool = dark ? '#3987e5' : '#5598e7';
    const warm = dark ? '#d95926' : '#eb6834';
    const d = T - target;
    if (Math.abs(d) <= 0.5) return neutral;
    const t = clamp((Math.abs(d) - 0.5) / 5, 0.15, 1);
    return mix(neutral, d < 0 ? cool : warm, t);
  }
  Airly.tempColor = tempColor;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  class FloorPlan {
    /* mode: 'design' | 'sim' | 'mini' */
    constructor(host, mode) {
      this.host = host;
      this.mode = mode;
      this.vb = null;
      this.drag = null;
      this.pointers = new Map();
      host.classList.add('plan-host', 'plan-' + mode);
      host.innerHTML = '';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'plan-svg');
      svg.setAttribute('role', 'application');
      svg.innerHTML = `<defs>
        <pattern id="grid-${mode}" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M0.5 0H0V0.5" fill="none" class="grid-line"/></pattern>
        <pattern id="grid1-${mode}" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#grid-${mode})"/><path d="M1 0H0V1" fill="none" class="grid-line strong"/></pattern>
        <g class="clips"></g></defs>
        <rect class="plan-bg" x="-500" y="-500" width="1000" height="1000" fill="url(#grid1-${mode})"/>
        <g class="content"></g>`;
      this.svg = svg;
      this.content = svg.querySelector('.content');
      this.clips = svg.querySelector('.clips');
      host.appendChild(svg);
      if (mode !== 'mini') this.bind();
      this.fit();
    }

    get home() { return Airly.store.state; }
    get sel() { return Airly.ui.sel; }

    /* ---------- View box ---------- */
    bounds() {
      const h = this.home;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      h.rooms.forEach((r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.length); y1 = Math.max(y1, r.y + r.width); });
      h.walls.forEach((w) => { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2); });
      if (!isFinite(x0)) return { x: 0, y: 0, w: 10, h: 8 };
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    fit() {
      const b = this.bounds();
      const pad = this.mode === 'mini' ? 0.4 : 1.2;
      let x = b.x - pad, y = b.y - pad, w = Math.max(4, b.w + pad * 2), h = Math.max(3, b.h + pad * 2);
      if (this.mode === 'design' || this.mode === 'sim') {
        // the designer / simulator plan fills the screen height, but keeps the zoom of the classic plan box
        // (at most 68% of the window, 640 px): the extra height only shows more space around the house
        const r = this.svg.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const refH = Math.min(r.height, Math.max(360, Math.min(window.innerHeight * 0.68, 640)));
          const k = Math.min(r.width / w, refH / h);
          const nw = r.width / k, nh = r.height / k;
          x -= (nw - w) / 2; y -= (nh - h) / 2; w = nw; h = nh;
        }
      }
      this.vb = { x, y, w, h };
      this.applyVB();
    }
    applyVB() {
      const v = this.vb;
      this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    }
    zoom(f, cx, cy) {
      const v = this.vb;
      const nw = clamp(v.w * f, 2, 200);
      const k = nw / v.w;
      if (cx == null) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
      v.x = cx - (cx - v.x) * k;
      v.y = cy - (cy - v.y) * k;
      v.w = nw;
      v.h = v.h * k;
      this.applyVB();
    }
    toWorld(ev) {
      const pt = this.svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const m = this.svg.getScreenCTM();
      return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }
    pxPerMeter() {
      const r = this.svg.getBoundingClientRect();
      return Math.min(r.width / this.vb.w, r.height / this.vb.h) || 50;
    }

    /* ---------- Rendering ---------- */
    render() {
      const t = Airly.i18n.t;
      const h = this.home;
      const sel = this.sel || {};
      const live = Airly.thermal.live;
      // temperatures once a simulation has started (in the designer too); "Reset" brings the plain plan back
      const showTemps = live.model && (live.running || live.model.t > 0);
      const prefs = Airly.store.prefs;
      const design = this.mode === 'design';
      const active = document.activeElement;
      const focusKey = active && this.svg.contains(active) ? active.getAttribute('data-key') : null;

      const lvl = Airly.ui.level || 0;
      const onLvl = (r) => (r.level || 0) === lvl;
      const rooms = h.rooms.filter(onLvl);
      this.clips.innerHTML = rooms.map((r) => `<clipPath id="clip-${this.mode}-${r.id}"><rect x="${r.x}" y="${r.y}" width="${r.length}" height="${r.width}"/></clipPath>`).join('');
      let out = '';
      let roomLabels = ''; // drawn after the furniture so names and temperatures stay readable
      let wallMark = ''; // highlight of the selected room wall, drawn on top
      // background image for tracing a floor plan
      const tr = h.trace;
      if (tr && tr.src && (tr.level || 0) === lvl && this.mode === 'design') {
        out += `<image class="trace-img" href="${tr.src}" x="${tr.x}" y="${tr.y}" width="${tr.w}" height="${tr.h}" opacity="${tr.opacity}" preserveAspectRatio="none"/>`;
      }
      // outline of the floor below, to line up walls between floors
      if (lvl > 0 && this.mode !== 'mini') h.rooms.filter((r) => (r.level || 0) === lvl - 1).forEach((r) => {
        out += `<rect class="ghost-room" x="${r.x}" y="${r.y}" width="${r.length}" height="${r.width}"/>`;
      });
      // comfort map (simulator): how warm/cool each spot feels, and where the AC causes a draft
      if (this.mode === 'sim' && prefs.comfortMap && live.model && live.model.t > 0) {
        const cell = 0.4;
        rooms.forEach((r) => {
          const target = Airly.thermal.desiredFor(h, r);
          for (let x = r.x; x < r.x + r.length - 1e-6; x += cell) {
            for (let y = r.y; y < r.y + r.width - 1e-6; y += cell) {
              const cw = Math.min(cell, r.x + r.length - x), ch = Math.min(cell, r.y + r.width - y);
              const f = Airly.thermal.feelAt(h, live.model, x + cw / 2, y + ch / 2, { room: r });
              if (!f || f.local == null) continue;
              out += `<rect class="comfort-cell" x="${x}" y="${y}" width="${cw}" height="${ch}" style="fill:${tempColor(f.local, target)}"/>`;
              if (f.draft) out += `<text class="draft-mark d${f.draft}" x="${x + cw / 2}" y="${y + ch / 2 + 0.08}" font-size="0.26">≋</text>`;
            }
          }
        });
      }
      // rooms
      rooms.forEach((r) => {
        const name = Airly.roomName(r);
        const g = Airly.thermal.geometry(r);
        const isSel = sel.kind === 'room' && sel.id === r.id;
        const T = showTemps ? live.tempOf(r.id) : null;
        const target = Airly.thermal.desiredFor(h, r);
        const fill = T != null ? (this.mode === 'sim' && prefs.comfortMap ? 'transparent' : tempColor(T, target)) : 'var(--room-fill)';
        const fs = clamp(Math.min(r.length, r.width) * 0.11, 0.2, 0.42);
        const cx = r.x + r.length / 2, cy = r.y + r.width / 2;
        const dims = `${Airly.fmt.num(r.length, 1)} × ${Airly.fmt.num(r.width, 1)} m · ${Airly.fmt.num(g.area, 1)} m²`;
        const label = `${name}, ${dims}` + (T != null ? `, ${Airly.fmt.temp(T)}` : '');
        out += `<g class="room${isSel ? ' selected' : ''}" data-kind="room" data-id="${r.id}" data-key="room-${r.id}" tabindex="${this.mode === 'mini' ? -1 : 0}" role="button" aria-label="${esc(label)}">
          <rect class="room-rect" x="${r.x}" y="${r.y}" width="${r.length}" height="${r.width}" style="fill:${fill}"/>`;
        if (T != null) {
          roomLabels += `<text class="room-temp" x="${cx}" y="${cy + fs * 0.2}" font-size="${fs * 1.6}">${esc(Airly.fmt.temp(T))}</text>
            <text class="room-name" x="${cx}" y="${cy - fs * 1.5}" font-size="${fs}">${esc(name)}</text>
            <text class="room-dims" x="${cx}" y="${cy + fs * 1.6}" font-size="${fs * 0.75}">${esc(t('sim.targetShort'))} ${esc(Airly.fmt.temp(target))}</text>`;
        } else {
          roomLabels += `<text class="room-name" x="${cx}" y="${cy - fs * 0.2}" font-size="${fs}">${esc(name)}</text>
            <text class="room-dims" x="${cx}" y="${cy + fs * 1.0}" font-size="${fs * 0.75}">${esc(dims)}</text>`;
        }
        if (design) {
          // each room wall is clickable: pick a wall, then add a door or window to it
          Airly.WALLS.forEach((w) => {
            const s = this.wallSeg(r, w);
            const on = sel.kind === 'roomwall' && sel.roomId === r.id && sel.wall === w;
            out += `<line class="room-wall" data-kind="roomwall" data-id="${r.id}" data-wall="${w}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"><title>${esc(t('studio.wallSel') + ' — ' + t('wall.' + w))}</title></line>`;
            if (on) wallMark += `<line class="room-wall-mark" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`;
          });
        }
        if (design && isSel) {
          out += `<rect class="handle" data-kind="resize" data-id="${r.id}" x="${r.x + r.length - 0.22}" y="${r.y + r.width - 0.22}" width="0.44" height="0.44" rx="0.08"><title>${esc(t('plan.resize'))}</title></rect>`;
        }
        out += `</g>`;
      });
      // furniture and stairs
      (h.furniture || []).filter((f) => (f.level || 0) === lvl).forEach((f) => {
        const isSel = sel.kind === 'furn' && sel.id === f.id;
        const name = t('furn.' + f.kind);
        const tall = f.kind !== 'stairs' && f.h >= Airly.thermal.TALL;
        let inner = '';
        if (f.kind === 'stairs') {
          // step lines across the walking direction and an arrow pointing up the stairs
          const alongX = f.rot === 90 || f.rot === 270;
          const len = alongX ? f.w : f.d, n = Math.max(4, Math.round(len / 0.28));
          for (let k = 1; k < n; k++) {
            const u = (k / n) * len;
            inner += alongX ? `<line class="stair-step" x1="${f.x + u}" y1="${f.y}" x2="${f.x + u}" y2="${f.y + f.d}"/>` : `<line class="stair-step" x1="${f.x}" y1="${f.y + u}" x2="${f.x + f.w}" y2="${f.y + u}"/>`;
          }
          const cx = f.x + f.w / 2, cy = f.y + f.d / 2;
          const dir = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[f.rot || 0];
          const L = (alongX ? f.w : f.d) * 0.35;
          inner += `<line class="stair-arrow" x1="${cx - dir[0] * L}" y1="${cy - dir[1] * L}" x2="${cx + dir[0] * L}" y2="${cy + dir[1] * L}"/><circle class="stair-arrow-head" cx="${cx + dir[0] * L}" cy="${cy + dir[1] * L}" r="0.09"/>`;
        }
        const fs2 = clamp(Math.min(f.w, f.d) * 0.28, 0.13, 0.24);
        // stairs: plain outline with steps; furniture: drawn from its real parts, seen from above
        const look = f.kind === 'stairs' ? '' : furnitureSVG(f, h);
        out += `<g class="furn furn-${f.kind}${tall ? ' tall' : ''}${isSel ? ' selected' : ''}" data-kind="furn" data-id="${f.id}" data-key="furn-${f.id}" tabindex="${this.mode === 'design' ? 0 : -1}" role="button" aria-label="${esc(name)}">
          ${f.kind === 'stairs' ? `<rect class="furn-rect" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.d}" rx="0.06"/>${inner}` : look}
          ${f.kind === 'stairs' ? '' : `<rect class="furn-hit" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.d}" rx="0.04"/>`}
          <text class="furn-label" x="${f.x + f.w / 2}" y="${f.y + f.d / 2 + fs2 * 0.35}" font-size="${fs2}">${esc(name)}</text></g>`;
      });
      out += `<g class="room-labels" aria-hidden="true">${roomLabels}</g>`;
      // best wall spots for the selected AC (designer)
      if (design && Airly.ui.bestSpotsFor) {
        const a = h.acs.find((x) => x.id === Airly.ui.bestSpotsFor);
        const r = a && h.rooms.find((x) => x.id === a.roomId);
        if (r && onLvl(r)) {
          const res = Airly.thermal.bestSpots(a, r, h);
          const max = res.best ? res.best.score : 100, min = res.spots.length ? res.spots[res.spots.length - 1].score : 0;
          res.spots.forEach((sp) => {
            const q = max > min ? (sp.score - min) / (max - min) : 1;
            const col = q > 0.66 ? 'var(--good)' : q > 0.33 ? 'var(--warning)' : 'var(--critical)';
            out += `<circle class="spot" cx="${sp.x}" cy="${sp.y}" r="0.11" style="fill:${col}"><title>${esc(t('best.spotTip', { cov: Math.round(sp.cov * 100), score: sp.score }))}</title></circle>`;
          });
          if (res.best) out += `<text class="spot-best" x="${res.best.x}" y="${res.best.y + 0.13}" font-size="0.42">★</text>`;
        }
      }
      // open-plan connections: no wall between the two spaces
      Airly.thermal.adjacency(h).filter((l) => l.openPlan).forEach((l) => {
        const A = h.rooms.find((x) => x.id === l.a);
        if (!onLvl(A)) return;
        const edge = l.sideA === 'right' ? A.x + A.length : l.sideA === 'left' ? A.x : l.sideA === 'bottom' ? A.y + A.width : A.y;
        const seg = l.axis === 'y' ? [edge, l.lo, edge, l.hi] : [l.lo, edge, l.hi, edge];
        const TA = showTemps ? live.tempOf(A.id) : null;
        const gapFill = TA != null ? tempColor(TA, Airly.thermal.desiredFor(h, A)) : 'var(--room-fill)';
        out += `<line class="open-gap" style="stroke:${gapFill}" x1="${seg[0]}" y1="${seg[1]}" x2="${seg[2]}" y2="${seg[3]}"/><line class="open-gap-line" x1="${seg[0]}" y1="${seg[1]}" x2="${seg[2]}" y2="${seg[3]}"/>`;
      });
      // openings
      rooms.forEach((r) => {
        r.windows.forEach((o) => (out += this.openingSVG(r, o, 'window', sel)));
        r.doors.forEach((o) => (out += this.openingSVG(r, o, 'door', sel)));
      });
      out += wallMark;
      // free walls
      h.walls.filter((w) => (w.level || 0) === lvl).forEach((w) => {
        const isSel = sel.kind === 'wall' && sel.id === w.id;
        out += `<g class="free-wall${isSel ? ' selected' : ''}" data-kind="wall" data-id="${w.id}" data-key="wall-${w.id}" tabindex="${this.mode === 'mini' ? -1 : 0}" role="button" aria-label="${esc(t('plan.wall'))}">
          <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" class="wall-line"/>
          <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" class="hit"/>`;
        if (design && isSel) {
          out += `<circle class="handle" data-kind="wall-end" data-id="${w.id}" data-end="1" cx="${w.x1}" cy="${w.y1}" r="0.2"/>
            <circle class="handle" data-kind="wall-end" data-id="${w.id}" data-end="2" cx="${w.x2}" cy="${w.y2}" r="0.2"/>`;
        }
        out += `</g>`;
      });
      // AC units
      h.acs.forEach((a, i) => {
        const room = h.rooms.find((r) => r.id === a.roomId);
        if (room ? !onLvl(room) : lvl !== 0) return;
        const isSel = sel.kind === 'ac' && sel.id === a.id;
        const R = Airly.thermal.acThrow(a);
        const modeCls = a.on ? 'm-' + a.mode : 'm-off';
        if (room && (prefs.showCoverage || isSel) && a.on && this.mode !== 'mini') {
          out += `<circle class="coverage ${modeCls}" cx="${a.x}" cy="${a.y}" r="${R}" clip-path="url(#clip-${this.mode}-${room.id})"/>`;
        }
        const icon = !a.on ? '⏻' : a.mode === 'heat' ? '☀' : a.mode === 'cool' ? '❄' : a.mode === 'fan' ? '≋' : 'A';
        // the accessible name starts with the visible label (e.g. "18k")
        const lbl = `${Math.round(a.btu / 1000)}k — ${t('ac.unit')} ${i + 1}: ${Airly.fmt.btu(a.btu)}, ${t('mode.' + a.mode)}, ${a.on ? t('ac.on') : t('ac.off')}`;
        out += `<g class="ac ${modeCls}${isSel ? ' selected' : ''}" data-kind="ac" data-id="${a.id}" data-key="ac-${a.id}" tabindex="${this.mode === 'mini' ? -1 : 0}" role="button" aria-label="${esc(lbl)}">
          ${a.orient === 'v'
            ? `<rect class="ac-body" x="${a.x - 0.18}" y="${a.y - 0.5}" width="0.36" height="1" rx="0.08"/>
          <text class="ac-icon" x="${a.x}" y="${a.y - 0.14}" font-size="0.26" text-anchor="middle">${icon}</text>
          <text class="ac-text" x="${a.x}" y="${a.y + 0.3}" font-size="0.17" text-anchor="middle">${Math.round(a.btu / 1000)}k</text>`
            : `<rect class="ac-body" x="${a.x - 0.5}" y="${a.y - 0.18}" width="1" height="0.36" rx="0.08"/>
          <text class="ac-icon" x="${a.x - 0.3}" y="${a.y + 0.09}" font-size="0.26">${icon}</text>
          <text class="ac-text" x="${a.x + 0.12}" y="${a.y + 0.08}" font-size="0.2">${Math.round(a.btu / 1000)}k</text>`}
        </g>`;
      });
      this.svg.classList.toggle('has-trace', !!(tr && tr.src && (tr.level || 0) === lvl && this.mode === 'design'));
      this.content.innerHTML = out;
      this.svg.setAttribute('aria-label', t('plan.aria'));
      if (focusKey) {
        const f = this.svg.querySelector(`[data-key="${focusKey}"]`);
        if (f) f.focus({ preventScroll: true });
      }
    }

    wallSeg(r, w) {
      const x0 = r.x, y0 = r.y, x1 = r.x + r.length, y1 = r.y + r.width;
      return { top: { x1: x0, y1: y0, x2: x1, y2: y0 }, bottom: { x1: x0, y1: y1, x2: x1, y2: y1 }, left: { x1: x0, y1: y0, x2: x0, y2: y1 }, right: { x1: x1, y1: y0, x2: x1, y2: y1 } }[w];
    }
    openingGeom(r, o) {
      const s = o.offset, e = o.offset + o.w;
      switch (o.wall) {
        case 'top': return { x1: r.x + s, y1: r.y, x2: r.x + e, y2: r.y, nx: 0, ny: 1 };
        case 'bottom': return { x1: r.x + s, y1: r.y + r.width, x2: r.x + e, y2: r.y + r.width, nx: 0, ny: -1 };
        case 'left': return { x1: r.x, y1: r.y + s, x2: r.x, y2: r.y + e, nx: 1, ny: 0 };
        default: return { x1: r.x + r.length, y1: r.y + s, x2: r.x + r.length, y2: r.y + e, nx: -1, ny: 0 };
      }
    }
    openingSVG(r, o, type, sel) {
      const t = Airly.i18n.t;
      const g = this.openingGeom(r, o);
      const isSel = sel.kind === 'opening' && sel.id === o.id;
      const label = `${t(type === 'door' ? 'plan.door' : 'plan.window')} — ${Airly.roomName(r)}`;
      let s = `<g class="opening ${type}${isSel ? ' selected' : ''}" data-kind="opening" data-type="${type}" data-id="${o.id}" data-room="${r.id}" data-key="op-${o.id}" tabindex="${this.mode === 'mini' ? -1 : 0}" role="button" aria-label="${esc(label)}">`;
      if (type === 'window') {
        s += `<line class="win-frame" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/><line class="win-glass" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
      } else {
        s += `<line class="door-gap" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
        if (o.open) {
          const lx = g.x1 + g.nx * o.w, ly = g.y1 + g.ny * o.w;
          const sweep = (g.nx === 0 ? (g.ny > 0 ? 1 : 0) : (g.nx > 0 ? 0 : 1));
          s += `<line class="door-leaf" x1="${g.x1}" y1="${g.y1}" x2="${lx}" y2="${ly}"/>
            <path class="door-arc" d="M${lx} ${ly} A${o.w} ${o.w} 0 0 ${sweep} ${g.x2} ${g.y2}"/>`;
        } else {
          s += `<line class="door-closed" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
        }
      }
      s += `<line class="hit" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/></g>`;
      return s;
    }

    /* ---------- Interaction ---------- */
    bind() {
      const svg = this.svg;
      svg.addEventListener('pointerdown', (ev) => this.onDown(ev));
      svg.addEventListener('pointermove', (ev) => this.onMove(ev));
      svg.addEventListener('pointerup', (ev) => this.onUp(ev));
      svg.addEventListener('pointercancel', (ev) => this.onUp(ev));
      svg.addEventListener('wheel', (ev) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const p = this.toWorld(ev);
        this.zoom(ev.deltaY > 0 ? 1.1 : 1 / 1.1, p.x, p.y);
      }, { passive: false });
      svg.addEventListener('keydown', (ev) => this.onKey(ev));
      svg.addEventListener('focusin', (ev) => {
        const tgt = ev.target.closest && ev.target.closest('[data-kind]');
        // keyboard focus selects; ignore focus moves caused by a click (the click already selected something)
        if (tgt && !this.drag && !this.pointers.size) this.selectFromEl(tgt, true);
      });
    }
    selectFromEl(el, quiet) {
      const kind = el.dataset.kind;
      const id = el.dataset.id;
      if (kind === 'resize') return Airly.ui.select('room', id, quiet);
      if (kind === 'wall-end') return Airly.ui.select('wall', id, quiet);
      if (kind === 'opening') return Airly.ui.select('opening', id, quiet, { roomId: el.dataset.room, type: el.dataset.type });
      if (kind === 'roomwall') return Airly.ui.select('roomwall', id + ':' + el.dataset.wall, quiet, { roomId: id, wall: el.dataset.wall });
      Airly.ui.select(kind, id, quiet);
    }
    findOpening(roomId, id) {
      const r = Airly.store.room(roomId);
      if (!r) return null;
      const o = r.windows.find((w) => w.id === id) || r.doors.find((d) => d.id === id);
      return o ? { r, o } : null;
    }
    onDown(ev) {
      if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.drag = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) };
        return;
      }
      const p = this.toWorld(ev);
      const el = ev.target.closest('[data-kind]');
      const design = this.mode === 'design';
      this.svg.setPointerCapture(ev.pointerId);
      const base = { start: p, client: { x: ev.clientX, y: ev.clientY }, moved: false, pointerId: ev.pointerId };
      if (!el) {
        this.drag = Object.assign(base, { kind: 'pan', vb: Object.assign({}, this.vb), scale: 1 / this.pxPerMeter() });
        return;
      }
      const kind = el.dataset.kind;
      const id = el.dataset.id;
      this.selectFromEl(el);
      if ((kind === 'room' || kind === 'roomwall') && design) {
        const r = Airly.store.room(id);
        // parts of an L-shaped room move together
        const parts = r.group ? this.home.rooms.filter((x) => x.group === r.group) : [r];
        const ids = new Set(parts.map((x) => x.id));
        this.drag = Object.assign(base, { kind: 'room', id, ox: p.x - r.x, oy: p.y - r.y, orig: { x: r.x, y: r.y },
          parts: parts.filter((x) => x !== r).map((x) => ({ x, dx: x.x - r.x, dy: x.y - r.y })),
          acs: this.home.acs.filter((a) => ids.has(a.roomId)).map((a) => ({ a, dx: a.x - r.x, dy: a.y - r.y })) });
      } else if (kind === 'resize' && design) {
        this.drag = Object.assign(base, { kind, id });
      } else if (kind === 'opening' && design) {
        const f = this.findOpening(el.dataset.room, id);
        if (f) {
          const along = f.o.wall === 'top' || f.o.wall === 'bottom' ? p.x - f.r.x : p.y - f.r.y;
          this.drag = Object.assign(base, { kind, f, grab: along - f.o.offset });
        }
      } else if (kind === 'ac') {
        const a = Airly.store.ac(id);
        this.drag = Object.assign(base, { kind, id, ox: p.x - a.x, oy: p.y - a.y, origRoom: a.roomId });
      } else if (kind === 'furn' && design) {
        const f = (this.home.furniture || []).find((x) => x.id === id);
        this.drag = Object.assign(base, { kind, f, ox: p.x - f.x, oy: p.y - f.y });
      } else if (kind === 'wall' && design) {
        const w = this.home.walls.find((x) => x.id === id);
        this.drag = Object.assign(base, { kind, w, orig: Object.assign({}, w) });
      } else if (kind === 'wall-end' && design) {
        const w = this.home.walls.find((x) => x.id === id);
        this.drag = Object.assign(base, { kind, w, end: el.dataset.end });
      } else {
        // not draggable in this mode: allow panning but keep the selection on a simple click
        this.drag = Object.assign(base, { kind: 'pan', keepSel: true, vb: Object.assign({}, this.vb), scale: 1 / this.pxPerMeter() });
      }
    }
    snap(v) {
      return Airly.store.prefs.snap ? r1(v) : Math.round(v * 100) / 100;
    }
    magnet(r, nx, ny) {
      const th = 0.3;
      let bx = null, by = null, dx = th, dy = th;
      this.home.rooms.forEach((o) => {
        if (o.id === r.id || (o.level || 0) !== (r.level || 0) || (r.group && o.group === r.group)) return;
        [o.x + o.length, o.x - r.length, o.x, o.x + o.length - r.length].forEach((c) => { if (Math.abs(c - nx) < dx) { dx = Math.abs(c - nx); bx = c; } });
        [o.y + o.width, o.y - r.width, o.y, o.y + o.width - r.width].forEach((c) => { if (Math.abs(c - ny) < dy) { dy = Math.abs(c - ny); by = c; } });
      });
      return { x: bx != null ? bx : nx, y: by != null ? by : ny };
    }
    onMove(ev) {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pinch') {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0 && d.dist > 0) this.zoom(d.dist / dist);
        d.dist = dist;
        return;
      }
      const dpx = Math.hypot(ev.clientX - d.client.x, ev.clientY - d.client.y);
      if (!d.moved && dpx < 4) return;
      d.moved = true;
      if (d.kind === 'pan') {
        this.vb.x = d.vb.x - (ev.clientX - d.client.x) * d.scale;
        this.vb.y = d.vb.y - (ev.clientY - d.client.y) * d.scale;
        this.applyVB();
        return;
      }
      const p = this.toWorld(ev);
      if (d.kind === 'room') {
        const r = Airly.store.room(d.id);
        let nx = this.snap(p.x - d.ox), ny = this.snap(p.y - d.oy);
        const m = this.magnet(r, nx, ny);
        r.x = Math.round(m.x * 100) / 100; r.y = Math.round(m.y * 100) / 100;
        d.acs.forEach(({ a, dx, dy }) => { a.x = r.x + dx; a.y = r.y + dy; });
        (d.parts || []).forEach(({ x, dx, dy }) => { x.x = Math.round((r.x + dx) * 100) / 100; x.y = Math.round((r.y + dy) * 100) / 100; });
      } else if (d.kind === 'resize') {
        const r = Airly.store.room(d.id);
        r.length = Math.max(1, this.snap(p.x - r.x));
        r.width = Math.max(1, this.snap(p.y - r.y));
        Airly.ui.clampRoomContents(r);
      } else if (d.kind === 'opening') {
        // slide along the room's walls; near a corner it jumps to whichever wall is closest
        const { r, o } = d.f;
        const cand = Airly.WALLS.map((w) => {
          const L = Airly.thermal.wallLength(r, w);
          const s = this.wallSeg(r, w);
          const horiz = w === 'top' || w === 'bottom';
          const along = horiz ? p.x - r.x : p.y - r.y;
          const c = clamp(along, 0, L);
          const dist = Math.hypot(p.x - (horiz ? r.x + c : s.x1), p.y - (horiz ? s.y1 : r.y + c));
          return { w, L, along, dist };
        }).filter((c) => c.L >= o.w);
        const cur = cand.find((c) => c.w === o.wall);
        let best = cand.reduce((a, b) => (b.dist < a.dist ? b : a), cur || cand[0]);
        if (cur && best && best !== cur && cur.dist - best.dist < 0.15) best = cur; // small hysteresis at corners
        if (best) {
          if (best.w !== o.wall) { o.wall = best.w; d.grab = o.w / 2; }
          o.offset = clamp(this.snap(best.along - d.grab), 0, Math.max(0, best.L - o.w));
        }
      } else if (d.kind === 'ac') {
        const a = Airly.store.ac(d.id);
        a.x = Math.round((p.x - d.ox) * 100) / 100;
        a.y = Math.round((p.y - d.oy) * 100) / 100;
      } else if (d.kind === 'furn') {
        d.f.x = this.snap(p.x - d.ox);
        d.f.y = this.snap(p.y - d.oy);
      } else if (d.kind === 'wall') {
        const dx = this.snap(p.x - d.start.x), dy = this.snap(p.y - d.start.y);
        d.w.x1 = d.orig.x1 + dx; d.w.x2 = d.orig.x2 + dx; d.w.y1 = d.orig.y1 + dy; d.w.y2 = d.orig.y2 + dy;
      } else if (d.kind === 'wall-end') {
        d.w['x' + d.end] = this.snap(p.x);
        d.w['y' + d.end] = this.snap(p.y);
      }
      this.render();
      Airly.store.emit('plan-drag');
    }
    onUp(ev) {
      this.pointers.delete(ev.pointerId);
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pinch') { if (this.pointers.size === 0) this.drag = null; return; }
      this.drag = null;
      try { this.svg.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (d.kind === 'pan') {
        if (!d.moved && !d.keepSel) Airly.ui.select(null);
        return;
      }
      if (!d.moved) return;
      if (d.kind === 'ac') {
        const a = Airly.store.ac(d.id);
        const room = Airly.store.roomAt(a.x, a.y, null, Airly.ui.level || 0);
        if (room) a.roomId = room.id;
        else {
          const r = Airly.store.room(d.origRoom);
          if (r) { a.x = clamp(a.x, r.x + 0.3, r.x + r.length - 0.3); a.y = clamp(a.y, r.y + 0.25, r.y + r.width - 0.25); }
        }
      }
      Airly.store.commit('plan');
    }
    onKey(ev) {
      const sel = this.sel;
      const el = ev.target.closest && ev.target.closest('[data-kind]');
      if ((ev.key === 'Enter' || ev.key === ' ') && el) {
        ev.preventDefault();
        this.selectFromEl(el);
        if (el.dataset.kind === 'room' && this.mode === 'sim') Airly.ui.inspectRoom && Airly.ui.inspectRoom(el.dataset.id);
        return;
      }
      if (ev.key === 'Escape') { Airly.ui.select(null); return; }
      if (!sel) return;
      if ((ev.key === 'r' || ev.key === 'R') && sel.kind === 'furn' && !ev.ctrlKey && !ev.metaKey && this.mode === 'design') {
        ev.preventDefault();
        Airly.ui.rotateFurn(sel.id);
        return;
      }
      if ((ev.key === 'r' || ev.key === 'R') && sel.kind === 'ac' && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        Airly.ui.rotateAC(sel.id);
        return;
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.mode === 'design') {
        ev.preventDefault();
        Airly.ui.deleteSelection();
        return;
      }
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dv = dirs[ev.key];
      if (!dv) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 0.5 : 0.1;
      const dx = dv[0] * step, dy = dv[1] * step;
      if (sel.kind === 'room' && this.mode === 'design') {
        const r = Airly.store.room(sel.id);
        if (!r) return;
        const parts = r.group ? this.home.rooms.filter((x) => x.group === r.group) : [r];
        parts.forEach((x) => { x.x = r1(x.x + dx); x.y = r1(x.y + dy); });
        const ids = new Set(parts.map((x) => x.id));
        this.home.acs.filter((a) => ids.has(a.roomId)).forEach((a) => { a.x += dx; a.y += dy; });
      } else if (sel.kind === 'ac') {
        const a = Airly.store.ac(sel.id);
        if (!a) return;
        a.x = r1(a.x + dx); a.y = r1(a.y + dy);
        const room = Airly.store.roomAt(a.x, a.y, null, Airly.ui.level || 0);
        if (room) a.roomId = room.id;
      } else if (sel.kind === 'opening' && this.mode === 'design') {
        const f = this.findOpening(sel.roomId, sel.id);
        if (!f) return;
        const horiz = f.o.wall === 'top' || f.o.wall === 'bottom';
        const delta = horiz ? dx : dy;
        f.o.offset = clamp(r1(f.o.offset + delta), 0, Airly.thermal.wallLength(f.r, f.o.wall) - f.o.w);
      } else if (sel.kind === 'furn' && this.mode === 'design') {
        const f = (this.home.furniture || []).find((x) => x.id === sel.id);
        if (!f) return;
        f.x = r1(f.x + dx); f.y = r1(f.y + dy);
      } else if (sel.kind === 'wall' && this.mode === 'design') {
        const w = this.home.walls.find((x) => x.id === sel.id);
        if (!w) return;
        w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy;
      } else return;
      Airly.store.commit('plan');
      this.render();
    }
  }

  Airly.FloorPlan = FloorPlan;
})();

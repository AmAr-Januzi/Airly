/* Airly — small dependency-free SVG charts with hover tooltips */
(function () {
  'use strict';
  const Airly = window.Airly;
  const NS = 'http://www.w3.org/2000/svg';

  function seriesColor(i) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--s' + ((i % 8) + 1)).trim();
    return v || '#1570D6';
  }
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { lo, hi, ticks };
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function legendHTML(series) {
    if (series.length < 2) return '';
    return '<div class="chart-legend" aria-hidden="true">' + series.map((s, i) =>
      `<span class="legend-item"><span class="swatch" style="background:${s.color || seriesColor(i)}"></span>${esc(s.name)}</span>`).join('') + '</div>';
  }
  function tooltip(container) {
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      container.appendChild(tip);
    }
    return tip;
  }
  function placeTip(tip, container, px, py) {
    tip.style.display = 'block';
    const cw = container.clientWidth;
    const tw = tip.offsetWidth;
    let left = px + 14;
    if (left + tw > cw) left = px - tw - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, py - 10) + 'px';
  }

  /* opts: { x:[numbers], series:[{name, values, color?, dash?}], xFmt, yFmt, height, refs:[{y,label}], ariaLabel } */
  function line(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const series = opts.series.filter((s) => s.values && s.values.length);
    if (!series.length || opts.x.length < 2) {
      container.innerHTML = `<p class="muted chart-empty">${esc(opts.empty || '')}</p>`;
      return;
    }
    series.forEach((s, i) => (s.color = s.color || seriesColor(s.slot != null ? s.slot : i)));
    container.insertAdjacentHTML('beforeend', legendHTML(series));
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 260;
    const m = { l: 44, r: 16, t: 12, b: 30 };
    let ymin = Infinity, ymax = -Infinity;
    series.forEach((s) => s.values.forEach((v) => { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }));
    (opts.refs || []).forEach((r) => { ymin = Math.min(ymin, r.y); ymax = Math.max(ymax, r.y); });
    const yt = niceTicks(ymin, ymax, 5);
    const xmin = opts.x[0], xmax = opts.x[opts.x.length - 1];
    const xt = niceTicks(xmin, xmax, Math.min(6, Math.floor(W / 90)));
    const sx = (v) => m.l + ((v - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r);
    const sy = (v) => m.t + (1 - (v - yt.lo) / (yt.hi - yt.lo || 1)) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': opts.ariaLabel || '' });
    const grid = el('g', { class: 'grid' }, svg);
    yt.ticks.forEach((v) => {
      el('line', { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v) }, grid);
      const t = el('text', { x: m.l - 6, y: sy(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, grid);
      t.textContent = opts.yFmt ? opts.yFmt(v) : v;
    });
    xt.ticks.filter((v) => v >= xmin && v <= xmax).forEach((v) => {
      const t = el('text', { x: sx(v), y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, grid);
      t.textContent = opts.xFmt ? opts.xFmt(v) : v;
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'baseline' }, svg);
    (opts.refs || []).forEach((r) => {
      el('line', { x1: m.l, x2: W - m.r, y1: sy(r.y), y2: sy(r.y), class: 'ref-line' }, svg);
      const t = el('text', { x: W - m.r - 4, y: sy(r.y) - 4, 'text-anchor': 'end', class: 'axis-label' }, svg);
      t.textContent = r.label;
    });
    series.forEach((s) => {
      const d = s.values.map((v, i) => (i ? 'L' : 'M') + sx(opts.x[i]).toFixed(1) + ' ' + sy(v).toFixed(1)).join('');
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || '' }, svg);
    });
    // hover layer
    const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg);
    const dots = series.map((s) => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    const wrap = document.createElement('div');
    wrap.className = 'chart-plot';
    wrap.appendChild(svg);
    container.appendChild(wrap);
    const tip = tooltip(wrap);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const xv = xmin + ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin);
      let best = 0;
      opts.x.forEach((v, i) => { if (Math.abs(v - xv) < Math.abs(opts.x[best] - xv)) best = i; });
      const X = sx(opts.x[best]);
      cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.setAttribute('visibility', 'visible');
      const rows = series.map((s, i) => {
        const v = s.values[best];
        dots[i].setAttribute('cx', X); dots[i].setAttribute('cy', sy(v)); dots[i].setAttribute('visibility', 'visible');
        return { s, v };
      }).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<strong>${esc(opts.xFmt ? opts.xFmt(opts.x[best]) : opts.x[best])}</strong>` + rows.map((r) =>
        `<div class="tip-row"><span class="swatch" style="background:${r.s.color}"></span><span>${esc(r.s.name)}</span><b>${esc(opts.yFmt ? opts.yFmt(r.v) : r.v)}</b></div>`).join('');
      placeTip(tip, wrap, (X / W) * rect.width, ev.clientY - rect.top);
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.style.display = 'none'; };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* Grouped bar chart. opts: { labels:[...], series:[{name, values}], yFmt, height } */
  function bars(container, opts) {
    container.innerHTML = '';
    container.classList.add('chart');
    const series = opts.series;
    if (!opts.labels.length) {
      container.innerHTML = `<p class="muted chart-empty">${esc(opts.empty || '')}</p>`;
      return;
    }
    series.forEach((s, i) => (s.color = s.color || seriesColor(s.slot != null ? s.slot : i)));
    container.insertAdjacentHTML('beforeend', legendHTML(series));
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 260;
    const m = { l: 56, r: 12, t: 12, b: 44 };
    let ymax = 0;
    series.forEach((s) => s.values.forEach((v) => (ymax = Math.max(ymax, v))));
    const yt = niceTicks(0, ymax || 1, 5);
    const sy = (v) => m.t + (1 - v / (yt.hi || 1)) * (H - m.t - m.b);
    const groupW = (W - m.l - m.r) / opts.labels.length;
    const gap = 2;
    const barW = Math.max(4, Math.min(28, (groupW * 0.7) / series.length - gap));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': opts.ariaLabel || '' });
    const grid = el('g', { class: 'grid' }, svg);
    yt.ticks.forEach((v) => {
      el('line', { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v) }, grid);
      const t = el('text', { x: m.l - 6, y: sy(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, grid);
      t.textContent = opts.yFmt ? opts.yFmt(v) : v;
    });
    const wrap = document.createElement('div');
    wrap.className = 'chart-plot';
    const tip = tooltip(wrap);
    opts.labels.forEach((lab, gi) => {
      const gx = m.l + gi * groupW + groupW / 2;
      const total = series.length * barW + (series.length - 1) * gap;
      const t = el('text', { x: gx, y: H - m.b + 16, 'text-anchor': 'middle', class: 'axis-label' }, svg);
      const short = lab.length > 12 && groupW < 90 ? lab.slice(0, 10) + '…' : lab;
      t.textContent = short;
      series.forEach((s, si) => {
        const v = s.values[gi] || 0;
        const x = gx - total / 2 + si * (barW + gap);
        const y = sy(v);
        const h = Math.max(0, H - m.b - y);
        const r = Math.min(4, barW / 2, h);
        // rounded top, square baseline
        const d = h > 0
          ? `M${x},${H - m.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${H - m.b}Z`
          : '';
        if (d) el('path', { d, fill: s.color }, svg);
        const hit = el('rect', { x: x - gap, y: m.t, width: barW + gap * 2, height: H - m.t - m.b, fill: 'transparent' }, svg);
        hit.addEventListener('pointermove', (ev) => {
          const rect = svg.getBoundingClientRect();
          tip.innerHTML = `<strong>${esc(lab)}</strong><div class="tip-row"><span class="swatch" style="background:${s.color}"></span><span>${esc(s.name)}</span><b>${esc(opts.yFmt ? opts.yFmt(v) : v)}</b></div>`;
          placeTip(tip, wrap, ev.clientX - rect.left, ev.clientY - rect.top);
        });
        hit.addEventListener('pointerleave', () => (tip.style.display = 'none'));
      });
    });
    el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'baseline' }, svg);
    wrap.insertBefore(svg, tip);
    container.appendChild(wrap);
  }

  Airly.charts = { line, bars, seriesColor };
})();

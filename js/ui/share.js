/* Airly — printable report and share links */
(function () {
  'use strict';
  const Airly = window.Airly;
  const t = (k, p) => Airly.i18n.t(k, p);
  const esc = (s) => Airly.esc(s);
  const F = () => Airly.fmt;
  const TH = () => Airly.thermal;

  /* =====================================================
   * Printable report (use the browser's "Save as PDF" to get a file)
   * ===================================================== */
  function planSVGs(h) {
    const out = [];
    const prevLevel = Airly.ui.level || 0;
    for (let k = 0; k < (h.levels || 1); k++) {
      Airly.ui.level = k;
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;height:560px';
      document.body.appendChild(host);
      const plan = new Airly.FloorPlan(host, 'mini');
      plan.fit();
      plan.render();
      const svg = host.querySelector('svg');
      svg.removeAttribute('role');
      svg.setAttribute('aria-label', t('dash.layout') + ' — ' + Airly.levelName(k));
      out.push({ name: Airly.levelName(k), svg: svg.outerHTML });
      host.remove();
    }
    Airly.ui.level = prevLevel;
    return out;
  }

  function buildReport() {
    const h = Airly.store.state;
    const p = Airly.store.prefs;
    const A = Airly.advisor;
    const cool = A.analyze(h, 'cooling');
    const heat = A.analyze(h, 'heating');
    const recC = A.recommend(h, 'cooling').filter((r) => r.severity !== 'good');
    const recH = A.recommend(h, 'heating').filter((r) => r.severity !== 'good');
    const enC = A.energy(h, 'cooling', p.hours);
    const enH = A.energy(h, 'heating', p.hours);
    const year = A.yearly(h, p);
    const date = new Date().toLocaleDateString(Airly.i18n.locale(), { year: 'numeric', month: 'long', day: 'numeric' });
    const name = h.name || t('home.defaultName');
    const totalArea = cool.totals.area;
    const perf = (ra) => ({ effective: t('perf.effective'), slow: t('perf.slow'), insufficient: t('perf.insufficient') }[ra.perf]);
    const cap = (ra) => (ra.covered ? t('cap.covered') : { none: t('cap.none'), under: t('cap.under'), over: t('cap.over'), ok: t('cap.ok') }[ra.cap]);
    const recList = (list) => list.length ? `<ol>${list.map((r) => `<li><strong>${esc(t('rec.' + r.type + '.title', r.params))}</strong><br>${esc(t('rec.' + r.type + '.why', r.params))}</li>`).join('')}</ol>` : `<p>${esc(t('dash.noRecs'))}</p>`;
    const months = Array.from({ length: 12 }, (_, m) => new Date(2025, m, 1).toLocaleDateString(Airly.i18n.locale(), { month: 'short' }));
    const sched = (a) => (a.schedule && a.schedule.enabled ? a.schedule.periods.map((x) => x.on + '–' + x.off).join(', ') : t('sched.none')) + (a.sleep ? ' · ' + t('sched.night') : '');

    return `<article class="report">
      <header class="r-head"><div><div class="r-brand">Airly</div><h1>${esc(t('report.title', { name }))}</h1><p>${esc(date)}</p></div></header>
      <section><h2>${esc(t('report.summary'))}</h2>
        <table class="r-kv"><tbody>
          <tr><th>${esc(t('dash.rooms'))}</th><td>${h.rooms.length} · ${F().num(totalArea, 1)} m² · ${F().num(cool.totals.volume, 0)} m³${(h.levels || 1) > 1 ? ' · ' + h.levels + ' ' + esc(t('report.floors')) : ''}</td></tr>
          <tr><th>${esc(t('dash.acUnits'))}</th><td>${h.acs.length} · ${esc(F().btu(cool.totals.inst))}</td></tr>
          <tr><th>${esc(t('report.reqCool'))}</th><td>${esc(F().btu(cool.totals.req))}</td></tr>
          <tr><th>${esc(t('report.reqHeat'))}</th><td>${esc(F().btu(heat.totals.req))}</td></tr>
          <tr><th>${esc(t('env.outsideSummer'))}</th><td>${esc(F().temp(h.env.outsideSummer))}</td></tr>
          <tr><th>${esc(t('env.outsideWinter'))}</th><td>${esc(F().temp(h.env.outsideWinter))}</td></tr>
          <tr><th>${esc(t('year.climate'))}</th><td>${esc(t('climate.' + (h.env.climate || 'tirana')))}</td></tr>
          <tr><th>${esc(t('year.total'))}</th><td>${esc(F().money(year.cost))} · ${F().num(year.kWh, 0)} kWh</td></tr>
        </tbody></table>
      </section>
      <section class="r-plans"><h2>${esc(t('dash.layout'))}</h2>${planSVGs(h).map((x) => `<figure><figcaption>${esc(x.name)}</figcaption>${x.svg}</figure>`).join('')}</section>
      <section class="r-break"><h2>${esc(t('report.rooms'))}</h2>
        <table><thead><tr><th>${esc(t('an.room'))}</th><th>${esc(t('report.size'))}</th><th>${esc(t('room.wallIns'))}</th><th>${esc(t('room.sun'))}</th><th>${esc(t('an.installed'))}</th><th>❄ ${esc(t('an.required'))}</th><th>☀ ${esc(t('an.required'))}</th><th>${esc(t('an.result'))}</th></tr></thead><tbody>
        ${cool.rooms.map((ra, i) => `<tr><th>${esc(Airly.roomName(ra.room))}</th><td class="nowrap">${F().num(ra.room.length, 1)} × ${F().num(ra.room.width, 1)} m<br>${F().num(ra.geom.area, 1)} m²</td><td>${esc(t('quality.' + ra.room.wallIns))}</td><td>${esc(t('sun.' + ra.room.sun))}</td><td>${ra.inst ? esc(F().btu(ra.inst)) : '—'}</td><td>${esc(F().btu(ra.req.size))}</td><td>${esc(F().btu(heat.rooms[i].req.size))}</td><td>${esc(cap(ra))}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section><h2>${esc(t('report.acs'))}</h2>
        ${h.acs.length ? `<table><thead><tr><th>${esc(t('ac.unit'))}</th><th>${esc(t('ac.room'))}</th><th>${esc(t('ac.capacity'))}</th><th>${esc(t('ac.rating'))}</th><th>${esc(t('ac.mode'))}</th><th>${esc(t('ac.target'))}</th><th>${esc(t('sched.title'))}</th></tr></thead><tbody>
        ${h.acs.map((a, i) => { const r = Airly.store.room(a.roomId); return `<tr><th>${i + 1} · ${esc(a.brand)} ${esc(a.model)}</th><td>${esc(r ? Airly.roomName(r) : '—')}</td><td>${esc(F().btu(a.btu))}</td><td>${esc(a.rating)}${a.inverter ? ' · inverter' : ''}</td><td>${esc(t('mode.' + a.mode))}</td><td>${esc(F().temp(a.target))}</td><td>${esc(sched(a))}</td></tr>`; }).join('')}
        </tbody></table>` : `<p>${esc(t('acs.none'))}</p>`}
      </section>
      <section><h2>${esc(t('report.analysis'))}</h2>
        <table><thead><tr><th>${esc(t('an.room'))}</th><th>❄ ${esc(t('report.after', { h: cool.hours }))}</th><th>❄ ${esc(t('an.performance'))}</th><th>☀ ${esc(t('report.after', { h: heat.hours }))}</th><th>☀ ${esc(t('an.performance'))}</th></tr></thead><tbody>
        ${cool.rooms.map((ra, i) => `<tr><th>${esc(Airly.roomName(ra.room))}</th><td>${esc(F().temp(ra.final))}</td><td>${esc(perf(ra))}</td><td>${esc(F().temp(heat.rooms[i].final))}</td><td>${esc(perf(heat.rooms[i]))}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section class="r-break"><h2>${esc(t('report.recsCool'))}</h2>${recList(recC)}<h2>${esc(t('report.recsHeat'))}</h2>${recList(recH)}</section>
      <section><h2>${esc(t('nav.energy'))}</h2>
        <table class="r-kv"><tbody>
          <tr><th>${esc(t('en.coolDaily'))}</th><td>${F().num(enC.dailyKWh, 1)} kWh · ${esc(F().money(enC.dailyKWh * p.price))}</td></tr>
          <tr><th>${esc(t('en.heatDaily'))}</th><td>${F().num(enH.dailyKWh, 1)} kWh · ${esc(F().money(enH.dailyKWh * p.price))}</td></tr>
          <tr><th>${esc(t('year.total'))}</th><td>${F().num(year.kWh, 0)} kWh · ${esc(F().money(year.cost))}</td></tr>
        </tbody></table>
        <table class="r-months"><thead><tr>${months.map((m) => `<th>${esc(m)}</th>`).join('')}</tr></thead><tbody><tr>${year.months.map((x) => `<td>${esc(F().money(x.cost, 0))}</td>`).join('')}</tr></tbody></table>
        <p class="r-note">${esc(t('report.energyNote', { price: F().money(p.price, 2), h: p.hours, d: p.days }))}</p>
      </section>
      <footer class="r-foot"><p>${esc(t('common.estimateNote'))}</p></footer>
    </article>`;
  }

  function printReport() {
    let box = document.getElementById('print-report');
    if (!box) {
      box = document.createElement('div');
      box.id = 'print-report';
      document.body.appendChild(box);
    }
    try {
      box.innerHTML = buildReport();
    } catch (e) {
      console.error(e);
      Airly.toast(t('error.render'), 'bad');
      return;
    }
    // give the browser a moment to lay out the report before opening the print dialog
    setTimeout(() => window.print(), 50);
  }

  /* =====================================================
   * Share links: the home is compressed into the address after "#share="
   * ===================================================== */
  const b64u = {
    enc(bytes) {
      let s = '';
      bytes.forEach((b) => (s += String.fromCharCode(b)));
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
      const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };
  async function streamBytes(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  async function encode(home) {
    const data = Airly.clone(home);
    delete data.trace; // images are too large for a link
    data.maintenance = { checks: {}, lastFilterClean: null };
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (window.CompressionStream) {
      try { return 'z' + b64u.enc(await streamBytes(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* fall back */ }
    }
    return 'j' + b64u.enc(bytes);
  }
  async function decode(str) {
    const kind = str[0];
    let bytes = b64u.dec(str.slice(1));
    if (kind === 'z') bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function baseURL() {
    return location.href.split('#')[0];
  }

  async function openShareDialog() {
    const dlg = document.getElementById('modal');
    let url;
    try {
      url = baseURL() + '#share=' + (await encode(Airly.store.state));
    } catch (e) {
      console.error(e);
      Airly.toast(t('share.failed'), 'bad');
      return;
    }
    const local = location.protocol === 'file:';
    dlg.innerHTML = `<div class="modal-inner">
      <header class="modal-head"><h2 id="modal-title">${esc(t('share.title'))}</h2><button type="button" class="btn icon" data-action="closeModal" aria-label="${esc(t('common.close'))}">✕</button></header>
      <p>${esc(t('share.lede'))}</p>
      <div class="field"><label for="share-url">${esc(t('share.link'))}</label><textarea id="share-url" class="share-url" rows="3" readonly>${esc(url)}</textarea>
      <small class="hint">${esc(t('share.size', { n: Math.ceil(url.length / 1024) }))}</small></div>
      <div class="row-gap">
        <button type="button" class="btn primary" id="share-copy">${esc(t('share.copy'))}</button>
        ${navigator.share ? `<button type="button" class="btn" id="share-native">${esc(t('share.send'))}</button>` : ''}
      </div>
      ${local ? `<p class="muted small" role="note">⚠ ${esc(t('share.localNote'))}</p>` : ''}
      <p class="muted small">${esc(t('share.privacy'))}</p>
    </div>`;
    if (!dlg.open) dlg.showModal();
    const ta = dlg.querySelector('#share-url');
    dlg.querySelector('#share-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); Airly.toast(t('share.copied'), 'good'); } catch (e) { ta.select(); document.execCommand('copy'); Airly.toast(t('share.copied'), 'good'); }
    });
    const nat = dlg.querySelector('#share-native');
    if (nat) nat.addEventListener('click', () => navigator.share({ title: 'Airly — ' + (Airly.store.state.name || t('home.defaultName')), url }).catch(() => {}));
  }

  /* Called at start-up: open a home received through a link */
  async function importFromHash() {
    const m = /^#share=(.+)$/.exec(location.hash);
    if (!m) return false;
    let data;
    try {
      data = await decode(m[1]);
      if (!data || !Array.isArray(data.rooms)) throw new Error('bad');
    } catch (e) {
      Airly.toast(t('share.badLink'), 'bad');
      history.replaceState(null, '', baseURL() + '#dashboard');
      return false;
    }
    const nm = data.name || t('home.defaultName');
    if (!confirm(t('share.confirm', { name: nm }))) {
      history.replaceState(null, '', baseURL() + '#dashboard');
      return false;
    }
    if (Airly.store.state.rooms.length) Airly.store.saveProject(); // keep the current home in Projects
    data.id = Airly.uid();
    Airly.store.replaceState(data);
    history.replaceState(null, '', baseURL() + '#dashboard');
    Airly.toast(t('share.opened', { name: nm }), 'good');
    return true;
  }

  Airly.share = { printReport, openShareDialog, importFromHash, encode, decode };
})();

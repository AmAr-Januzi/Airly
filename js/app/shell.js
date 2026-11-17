/* Airly — app shell: routing, rendering a screen, static texts, theme, toasts and maintenance reminders */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const t = (k, p) => Airly.i18n.t(k, p);
  const esc = (s) => Airly.esc(s);
  const ui = Airly.ui;
  const VIEWS = ['dashboard', 'designer', 'rooms', 'acs', 'simulator', 'eco', 'care', 'settings'];

  /* ---------- Reminders ---------- */
  const DAY = 864e5;
  function dueReminders() {
    const m = store.state.maintenance || {};
    const p = store.prefs;
    const now = Date.now();
    if (m.snoozeUntil && m.snoozeUntil > now) return [];
    if (!store.state.acs.length) return [];
    const out = [];
    if (p.remindFilter && (!m.lastFilterClean || now - m.lastFilterClean > (p.filterDays || 30) * DAY)) out.push('filter');
    if (p.remindService && (!m.lastService || now - m.lastService > 365 * DAY)) out.push('service');
    return out;
  }
  Airly.dueReminders = dueReminders;
  function notifyDue() {
    const p = store.prefs;
    if (!p.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const today = new Date().toDateString();
    if (p.lastNotified === today) return;
    const due = dueReminders();
    if (!due.length) return;
    const body = due.map((k) => t('remind.' + k)).join(' · ');
    const opts = { body, icon: 'icons/icon-192.png', tag: 'airly-reminder' };
    const show = () => { try { new Notification('Airly', opts); } catch (e) { /* not allowed here */ } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification('Airly', opts)).catch(show);
    else show();
    p.lastNotified = today;
    store.savePrefs();
  }

  /* ---------- Toasts ---------- */
  let toastTimer;
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
  }
  Airly.toast = toast;

  /* ---------- Confirm dialog ----------
     A styled replacement for the browser's confirm() box. Resolves true (OK) or false (Cancel, Esc, click outside).
     opts: { title, message, ok, cancel, icon, danger } */
  function confirmDialog(opts) {
    return new Promise((resolve) => {
      let dlg = document.getElementById('confirm-dlg');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'confirm-dlg';
        dlg.className = 'confirm-dlg';
        dlg.setAttribute('aria-labelledby', 'confirm-title');
        dlg.setAttribute('aria-describedby', 'confirm-text');
        document.body.appendChild(dlg);
      }
      dlg.innerHTML = `<form method="dialog" class="confirm-inner">
        ${opts.icon ? `<div class="confirm-icon${opts.danger ? ' is-danger' : ''}" aria-hidden="true">${opts.icon}</div>` : ''}
        <h2 id="confirm-title">${esc(opts.title || '')}</h2>
        ${opts.message ? `<p id="confirm-text">${esc(opts.message)}</p>` : ''}
        <div class="confirm-actions">
          <button type="submit" class="btn ghost" value="no">${esc(opts.cancel || t('common.cancel'))}</button>
          <button type="submit" class="btn ${opts.danger ? 'danger' : 'primary'}" value="yes" autofocus>${esc(opts.ok || 'OK')}</button>
        </div></form>`;
      const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'yes'); };
      dlg.returnValue = '';
      dlg.addEventListener('close', done);
      // a click on the dark area around the box counts as "cancel"
      dlg.onclick = (ev) => { if (ev.target === dlg) dlg.close('no'); };
      dlg.showModal();
      const ok = dlg.querySelector('[value="yes"]');
      if (ok) ok.focus();
    });
  }
  Airly.confirmDialog = confirmDialog;

  /* ---------- Theme ---------- */
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const pref = store.prefs.theme;
    const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
    document.documentElement.dataset.theme = pref === 'auto' ? '' : pref;
    document.documentElement.dataset.themeResolved = dark ? 'dark' : 'light';
    // the 3D view paints with its own copy of the colours: refresh them
    if (Airly.view3d && Airly.view3d.recolor) Airly.view3d.recolor();
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { applyTheme(); render(); });

  /* ---------- Static text ---------- */
  function applyStatic() {
    document.documentElement.lang = store.prefs.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    document.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.dataset.i18nTitle)));
    const ls = document.getElementById('lang-select');
    if (ls) {
      const langs = Airly.i18n.languages();
      if (ls.options.length !== langs.length) ls.innerHTML = langs.map((l) => `<option value="${l.code}" title="${esc(l.name)}">${l.code.toUpperCase()}</option>`).join('');
      ls.value = Airly.i18n.lang;
    }
    document.querySelectorAll('.unit-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === (store.prefs.tempUnit || 'C'))));
    updateAvatar();
    const tb = document.getElementById('theme-btn');
    if (tb) { const dark = document.documentElement.dataset.themeResolved === 'dark'; const l = t(dark ? 'theme.toLight' : 'theme.toDark'); tb.setAttribute('aria-label', l); tb.title = l; }
    const nm = document.getElementById('top-home-name');
    if (nm) nm.textContent = store.state.name || t('home.defaultName');
    document.title = (store.state.name ? store.state.name + ' · ' : '') + 'Airly — ' + t('app.tagline');
  }

  /* ---------- Sidebar: sliding highlight and profile photo ---------- */
  function movePill() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    let pill = sb.querySelector('.nav-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'nav-pill';
      pill.setAttribute('aria-hidden', 'true');
      sb.appendChild(pill);
      sb.classList.add('has-pill');
      const nav = sb.querySelector('nav');
      if (nav) nav.addEventListener('scroll', () => movePill(), { passive: true });
      window.addEventListener('resize', () => movePill());
    }
    const a = sb.querySelector('.nav-link.active');
    if (!a || !a.offsetParent) { pill.style.opacity = '0'; return; }
    const sr = sb.getBoundingClientRect(), ar = a.getBoundingClientRect();
    pill.style.opacity = '1';
    pill.style.width = ar.width + 'px';
    pill.style.height = ar.height + 'px';
    pill.style.transform = `translate(${ar.left - sr.left}px, ${ar.top - sr.top + sb.scrollTop}px)`;
    // the first placement jumps straight there; after that it slides
    if (!sb.classList.contains('pill-ready')) requestAnimationFrame(() => sb.classList.add('pill-ready'));
  }
  function updateAvatar() {
    const img = document.getElementById('avatar-img'), ph = document.getElementById('avatar-ph');
    if (!img || !ph) return;
    const src = store.prefs.avatar || '';
    if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; ph.style.display = 'none'; }
    else { img.hidden = true; img.removeAttribute('src'); ph.style.display = ''; }
  }
  Airly.updateAvatar = updateAvatar;

  /* ---------- Routing ---------- */
  function show(view) {
    // Compare Homes lives inside the Home Designer now: open it there and scroll to it
    // Energy, Purchase Comparison and Recommendations are tabs of ECO now; Temperature Analysis was removed
    const ECO_TAB = { energy: 'energy', purchase: 'purchase', recommendations: 'recs' };
    if (ECO_TAB[view]) { Airly.views.eco.tab = ECO_TAB[view]; history.replaceState(null, '', '#eco'); view = 'eco'; }
    if (view === 'guide' || view === 'maintenance') { Airly.views.care.tab = view; history.replaceState(null, '', '#care'); view = 'care'; }
    if (view === 'analysis') { history.replaceState(null, '', '#simulator'); view = 'simulator'; }
    if (view === 'compare') { ui.compareOpen = true; ui.scrollToCompare = true; history.replaceState(null, '', '#designer'); view = 'designer'; }
    if (!VIEWS.includes(view)) view = 'dashboard';
    // leaving the designer while it shows 3D: close the 3D view (it lives inside the designer page)
    if (view !== ui.view && Airly.view3d && Airly.view3d.closeInline) { ui.view = view; Airly.view3d.closeInline(); }
    ui.view = view;
    document.querySelectorAll('.nav-link').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    movePill();
    document.body.classList.remove('nav-open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
    render();
    const main = document.getElementById('main');
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    if (ui.scrollToCompare) { ui.scrollToCompare = false; const c = document.getElementById('cmp-section'); if (c) c.scrollIntoView({ block: 'start' }); }
  }
  function render(focusKey) {
    const el = document.getElementById('view');
    const v = Airly.views[ui.view];
    const active = document.activeElement;
    const key = focusKey || (active && el.contains(active) ? { bind: active.dataset.bind, id: active.id, action: active.dataset.action, tag: active.tagName } : null);
    try {
      v.render(el);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="card"><p>${esc(t('error.render'))}</p><pre class="small">${esc(e.message)}</pre></div>`;
    }
    if (key) {
      let f = null;
      if (key.id) f = document.getElementById(key.id);
      if (!f && key.bind) f = [...el.querySelectorAll(`[data-bind="${CSS.escape(key.bind)}"]`)].find((x) => x.tagName === key.tag) || null;
      if (!f && key.action) f = el.querySelector(`[data-action="${CSS.escape(key.action)}"]`);
      if (f) f.focus({ preventScroll: true });
    }
    applyStatic();
  }
  Airly.render = render;

  Airly.app = { VIEWS, DAY, show, applyTheme, applyStatic, notifyDue, movePill };
})();

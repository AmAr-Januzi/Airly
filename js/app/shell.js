/* Airly — app shell: routing, rendering a screen, static texts, theme, toasts and maintenance reminders */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const t = (k, p) => Airly.i18n.t(k, p);
  const esc = (s) => Airly.esc(s);
  const ui = Airly.ui;
  const VIEWS = ['dashboard', 'designer', 'rooms', 'acs', 'compare', 'simulator', 'analysis', 'recommendations', 'energy', 'purchase', 'guide', 'maintenance', 'settings'];

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

  /* ---------- Theme ---------- */
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const pref = store.prefs.theme;
    const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
    document.documentElement.dataset.theme = pref === 'auto' ? '' : pref;
    document.documentElement.dataset.themeResolved = dark ? 'dark' : 'light';
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
    const nm = document.getElementById('top-home-name');
    if (nm) nm.textContent = store.state.name || t('home.defaultName');
    document.title = (store.state.name ? store.state.name + ' · ' : '') + 'Airly — ' + t('app.tagline');
  }

  /* ---------- Routing ---------- */
  function show(view) {
    if (!VIEWS.includes(view)) view = 'dashboard';
    // leaving the designer while it shows 3D: close the 3D view (it lives inside the designer page)
    if (view !== ui.view && Airly.view3d && Airly.view3d.closeInline) { ui.view = view; Airly.view3d.closeInline(); }
    ui.view = view;
    document.querySelectorAll('.nav-link').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.classList.remove('nav-open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
    render();
    const main = document.getElementById('main');
    main.scrollTop = 0;
    window.scrollTo(0, 0);
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

  Airly.app = { VIEWS, DAY, show, applyTheme, applyStatic, notifyDue };
})();

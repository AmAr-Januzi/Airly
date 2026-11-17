/* Airly — start-up: wires clicks, inputs, keyboard and files to the app, then shows the first screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const TH = Airly.thermal;
  const t = (k, p) => Airly.i18n.t(k, p);
  const ui = Airly.ui;
  const { toast, render } = Airly;
  const { show, applyTheme, notifyDue, onInput, refreshRoomCache, actions } = Airly.app;

  /* ---------- Wiring ---------- */
  function init() {
    Airly.i18n.setLang(store.prefs.lang);
    applyTheme();
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-action]');
      if (!b || b.disabled) return;
      const fn = actions[b.dataset.action];
      if (fn) { ev.preventDefault(); fn(Object.assign({}, b.dataset)); }
    });
    document.addEventListener('input', onInput);
    document.addEventListener('change', (ev) => {
      if (ev.target.id === 'import-file') return importFile(ev.target);
      if (ev.target.id === 'trace-file') return traceFile(ev.target);
      if (ev.target.id === 'avatar-file') return avatarFile(ev.target);
      onInput(ev);
    });
    window.addEventListener('hashchange', () => {
      if (location.hash.startsWith('#share=')) { Airly.share.importFromHash().then(() => show('dashboard')); return; }
      show(location.hash.slice(1));
    });
    document.getElementById('modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') ev.target.close(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && document.body.classList.contains('nav-open')) actions.menu();
      const tag = (ev.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable;
      if ((ev.ctrlKey || ev.metaKey) && !typing && !document.querySelector('dialog[open]')) {
        const k = ev.key.toLowerCase();
        if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); actions.undo(); }
        else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); actions.redo(); }
      }
    });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (['simulator', 'eco'].includes(ui.view)) render(); }, 250); });

    store.on('change', (source) => {
      if (source !== 'form') refreshRoomCache();
      if (source === 'replace') TH.live.reset(store.state);
      else TH.live.rebuild(store.state);
      if (source === 'undo') { ui.sel = null; if (ui.level >= (store.state.levels || 1)) ui.level = 0; render(); return; }
      if (source === 'plan' || source === 'delete') {
        const v = Airly.views[ui.view];
        if (ui.view === 'designer') { v.refresh(); v.inspector(); }
        else if (ui.view === 'simulator') v.tick(true);
        else render();
      }
      if (source === 'replace') render();
    });
    store.on('history', updateHistoryButtons);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.info('Service worker not registered:', e.message));
    }
    window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); ui.installPrompt = ev; if (ui.view === 'settings') render(); });
    window.addEventListener('appinstalled', () => { ui.installPrompt = null; toast(t('pwa.installed'), 'good'); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) notifyDue(); });
    setTimeout(notifyDue, 1500);
    store.on('sim', () => {
      if (ui.view === 'simulator') Airly.views.simulator.tick();
      else if (ui.view === 'designer' && !ui.designer3d) Airly.views.designer.tick();
    });
    store.on('plan-drag', () => {
      if (ui.view === 'designer') {
        const s = ui.sel;
        // live-update numeric fields of the inspector while dragging
        if (s && s.kind === 'room') {
          const r = store.room(s.id);
          ['length', 'width', 'x', 'y'].forEach((k) => {
            const el = document.querySelector(`#inspector [data-bind="room.${r.id}.${k}"]`);
            if (el) el.value = r[k];
          });
        }
      }
    });
    refreshRoomCache();
    store.track('replace');
    updateHistoryButtons();
    if (!store.state.name) store.state.name = '';
    TH.live.rebuild(store.state);
    if (location.hash.startsWith('#share=')) {
      show('dashboard');
      Airly.share.importFromHash().then((ok) => { if (ok) render(); });
    } else show(location.hash.slice(1) || 'dashboard');
    // the page is laid out: from now on the sidebar may animate
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-anim')));
    if (!Airly.storageOK) toast(t('settings.storageNo'), 'bad');
  }

  /* Load a floor-plan image, shrink it (so it fits in browser storage) and place it under the plan */
  /* profile photo: cropped to a square and made small, kept with the settings on this device */
  function avatarFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160, s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        store.prefs.avatar = c.toDataURL('image/jpeg', 0.86);
        store.savePrefs();
        Airly.updateAvatar();
        if (ui.view === 'settings') render();
        toast(t('profile.saved'), 'good');
      };
      img.onerror = () => toast(t('trace.failed'), 'bad');
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    input.value = '';
  }
  function traceFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const src = c.toDataURL('image/jpeg', 0.82);
        const aspect = img.height / img.width;
        store.state.trace = { src, x: 0, y: 0, w: 10, h: Math.round(10 * aspect * 100) / 100, aspect, opacity: 0.5, level: ui.level || 0 };
        store.commit('struct'); render();
        if (Airly.plans.designer) Airly.plans.designer.fit();
        toast(t('trace.loaded'), 'good');
      };
      img.onerror = () => toast(t('trace.failed'), 'bad');
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    input.value = '';
  }
  function updateHistoryButtons() {
    const H = store.hist;
    const u = document.getElementById('undo-btn'), r = document.getElementById('redo-btn');
    if (u) u.disabled = !H.undo.length;
    if (r) r.disabled = !H.redo.length;
  }

  function importFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.rooms)) throw new Error('bad');
        data.id = data.id || Airly.uid();
        store.replaceState(data);
        ui.sel = null;
        render();
        toast(t('toast.imported'), 'good');
      } catch (e) {
        toast(t('toast.importFailed'), 'bad');
      }
      input.value = '';
    };
    reader.readAsText(f);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

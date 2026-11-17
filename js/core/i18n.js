/* Airly — translation engine and locale formatting (°C/°F, numbers, money, time).
 * The texts themselves are in js/lang/. */
(function () {
  'use strict';
  const Airly = (window.Airly = window.Airly || {});
  const { str: STR, guide: GUIDE, maint: MAINT } = Airly.i18nBase;

  /* ---------- API ---------- */
  /* Extra languages register themselves from js/lang/*.js:
     { name, locale, str: { key: text }, guide: {...}, maint: {...} }. Missing texts fall back to English. */
  const EXTRA = {};
  let lang = 'en';
  const isF = () => !!(Airly.store && Airly.store.prefs.tempUnit === 'F');
  const toU = (c) => (isF() ? (c * 9) / 5 + 32 : c);
  const fromU = (v) => (isF() ? ((v - 32) * 5) / 9 : v);
  const unitSym = () => (isF() ? '°F' : '°C');
  /* "24–26 °C" (temperatures) and "2–3 °Δ" (differences) inside texts follow the chosen unit */
  function convertText(s) {
    if (s.indexOf('°') < 0) return s;
    const f = isF();
    return s.replace(/(-?\d+(?:[.,]\d+)?)(?:\s?–\s?(-?\d+(?:[.,]\d+)?))?\s?°(C|Δ)/g, (m, a, b, kind) => {
      if (!f) return m.replace('°Δ', '°C');
      const conv = (x) => {
        const v = parseFloat(x.replace(',', '.'));
        const r = kind === 'Δ' ? v * 1.8 : (v * 9) / 5 + 32;
        return nf(Number.isInteger(r) || Math.abs(r) >= 10 ? 0 : 1).format(Math.round(r * 10) / 10);
      };
      return conv(a) + (b ? '–' + conv(b) : '') + ' °F';
    });
  }
  const L = () => (lang === 'sq' ? 1 : 0);
  function t(key, params) {
    const e = STR[key];
    const x = EXTRA[lang];
    let s = x && x.str[key] != null ? x.str[key] : e ? (x ? e[0] : e[L()] || e[0]) : key;
    if (!e && typeof console !== 'undefined') console.warn('[i18n] missing', key);
    s = convertText(s);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
  }
  const pick = (pair) => convertText(pair[L()]);
  function locale() {
    if (EXTRA[lang]) return EXTRA[lang].locale;
    return lang === 'sq' ? 'sq-AL' : 'en-GB';
  }

  const nfCache = {};
  function nf(d) {
    const key = lang + d;
    if (!nfCache[key]) {
      try {
        nfCache[key] = new Intl.NumberFormat(locale(), { minimumFractionDigits: d === 1 ? 1 : 0, maximumFractionDigits: d });
      } catch (e) {
        nfCache[key] = { format: (v) => v.toFixed(d) };
      }
    }
    return nfCache[key];
  }
  const fmt = {
    num(v, d) {
      if (v == null || isNaN(v)) return '—';
      return nf(d || 0).format(v);
    },
    temp(v) {
      if (v == null || isNaN(v)) return '—';
      return nf(1).format(toU(v)) + ' ' + unitSym();
    },
    /* a temperature difference (e.g. 2.5 °C → 4.5 °F) */
    tempDelta(d, signed) {
      if (d == null || isNaN(d)) return '—';
      const v = isF() ? d * 1.8 : d;
      return (signed && v > 0 ? '+' : '') + nf(1).format(v) + ' ' + unitSym();
    },
    toU, fromU, unitSym, isF,
    clock(h) {
      if (h == null || isNaN(h)) return '—';
      const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
      return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    },
    btu(v) {
      return nf(0).format(Math.round(v || 0)) + ' BTU';
    },
    money(v, d) {
      const c = (Airly.store && Airly.store.prefs.currency) || '€';
      let s;
      try {
        s = new Intl.NumberFormat(locale(), { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }).format(v || 0);
      } catch (e) {
        s = (v || 0).toFixed(2);
      }
      if (lang === 'en' && ['€', '$', '£'].includes(c)) return c + s;
      return s + ' ' + c;
    },
    dur(sec) {
      sec = sec || 0;
      if (sec < 60) return Math.round(sec) + ' ' + t('unit.s');
      if (sec < 600) {
        const mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
        return mm + ' ' + t('unit.min') + (ss ? ' ' + ss + ' ' + t('unit.s') : '');
      }
      const m = Math.round(sec / 60);
      if (m < 60) return m + ' ' + t('unit.min');
      const h = Math.floor(m / 60), mm = m % 60;
      return h + ' ' + t('unit.h') + (mm ? ' ' + mm + ' ' + t('unit.min') : '');
    },
  };

  function levelName(k) {
    return t('level.num', { n: k + 1 }); // Floor 1, Floor 2, Floor 3 …
  }
  function roomName(r) {
    if (!r) return '—';
    // parts of an L-shaped room share the first part's name
    if (r.group && Airly.store) {
      const parts = Airly.store.state.rooms.filter((x) => x.group === r.group);
      const idx = parts.indexOf(r);
      if (idx > 0 && !(r.name && r.name.trim())) return roomName(parts[0]) + ' · ' + t('room.part', { n: idx + 1 });
    }
    if (r.name && r.name.trim()) return r.name.trim();
    const base = t('roomType.' + r.type);
    const rooms = (Airly.store && Airly.store.state.rooms) || [];
    const same = rooms.filter((x) => x.type === r.type && !(x.name && x.name.trim()));
    const idx = same.findIndex((x) => x.id === r.id);
    return same.length > 1 && idx >= 0 ? `${base} ${idx + 1}` : base;
  }

  Airly.i18n = {
    t,
    locale,
    get lang() { return lang; },
    setLang(l) { lang = l === 'sq' || EXTRA[l] ? l : 'en'; },
    addLanguage(code, def) { EXTRA[code] = def; },
    languages() {
      return [{ code: 'en', name: 'English' }, { code: 'sq', name: 'Shqip' }].concat(Object.keys(EXTRA).map((c) => ({ code: c, name: EXTRA[c].name })));
    },
    has: (k) => !!STR[k],
    keys: () => Object.keys(STR),
    source: () => STR, // [English, Albanian] pairs, used by tooling and language files
    guide() {
      const out = {};
      const x = EXTRA[lang];
      if (x && x.guide) {
        Object.keys(GUIDE).forEach((k) => (out[k] = GUIDE[k].map((s, i) => {
          const tr = x.guide[k] && x.guide[k][i];
          return tr ? { title: convertText(tr[0]), items: s.i.map((p, j) => convertText(tr[1][j] || p[0])) } : { title: convertText(s.t[0]), items: s.i.map((p) => convertText(p[0])) };
        })));
        return out;
      }
      Object.keys(GUIDE).forEach((k) => (out[k] = GUIDE[k].map((s) => ({ title: pick(s.t), items: s.i.map(pick) }))));
      return out;
    },
    maintenance() {
      const x = EXTRA[lang] && EXTRA[lang].maint;
      if (x) {
        const or = (arr, en) => en.map((p, i) => convertText((arr && arr[i]) || p[0]));
        return {
          cleaning: or(x.cleaning, MAINT.cleaning),
          pro: or(x.pro, MAINT.pro),
          checklist: or(x.checklist, MAINT.checklist),
          trouble: MAINT.trouble.map((r, i) => { const tr = (x.trouble || [])[i] || []; return [tr[0] || r[0][0], tr[1] || r[1][0], tr[2] || r[2][0], r[3]]; }),
          troubleGuide: MAINT.troubleGuide.map((g, i) => { const tr = (x.troubleGuide || [])[i]; return { title: tr ? tr[0] : g.t[0], steps: g.s.map((p, j) => convertText((tr && tr[1][j]) || p[0])) }; }),
        };
      }
      return {
        cleaning: MAINT.cleaning.map(pick),
        pro: MAINT.pro.map(pick),
        checklist: MAINT.checklist.map(pick),
        trouble: MAINT.trouble.map((r) => [pick(r[0]), pick(r[1]), pick(r[2]), r[3]]),
        troubleGuide: MAINT.troubleGuide.map((g) => ({ title: pick(g.t), steps: g.s.map(pick) })),
      };
    },
  };
  Airly.fmt = fmt;
  Airly.roomName = roomName;
  Airly.levelName = levelName;
})();

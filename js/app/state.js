/* Airly — UI state: what is selected, which floor is shown, and small edits on the selection */
(function () {
  'use strict';
  const Airly = window.Airly;
  const store = Airly.store;
  const TH = Airly.thermal;
  const t = (k, p) => Airly.i18n.t(k, p);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toast = (msg, kind) => Airly.toast(msg, kind);
  const render = (focusKey) => Airly.render(focusKey);

  /* ---------- UI state ---------- */
  const ui = (Airly.ui = {
    view: 'dashboard',
    level: 0, // floor shown in the designer
    sel: null,
    roomId: null,
    acId: null,
    select(kind, id, quiet, extra) {
      const next = kind ? Object.assign({ kind, id }, extra || {}) : null;
      const cur = this.sel;
      if ((!cur && !next) || (cur && next && cur.kind === next.kind && cur.id === next.id)) return;
      this.sel = next;
      if (kind === 'room') this.roomId = id;
      if (kind === 'ac') this.acId = id;
      if ((kind === 'opening' || kind === 'roomwall') && extra) this.roomId = extra.roomId;
      const v = Airly.views[this.view];
      if (v && v.onSelect) v.onSelect();
    },
    inspectRoom(id) { this.select('room', id); },
    bestSpotsFor: null,
    /* turn furniture by 90° around its centre */
    rotateFurn(id) {
      const f = (store.state.furniture || []).find((x) => x.id === id);
      if (!f) return;
      const cx = f.x + f.w / 2, cy = f.y + f.d / 2;
      const w = f.w; f.w = f.d; f.d = w;
      f.x = Math.round((cx - f.w / 2) * 10) / 10; f.y = Math.round((cy - f.d / 2) * 10) / 10;
      f.rot = ((f.rot || 0) + 90) % 360;
      store.commit('struct');
      render();
      const el = document.querySelector(`[data-key="furn-${id}"]`);
      if (el) el.focus({ preventScroll: true });
    },
    calib: null,
    /* purchase comparison settings live in the home so they are saved with it */
    purchaseCfg() {
      const h = store.state;
      if (!h.purchase || !h.rooms.find((r) => r.id === h.purchase.roomId)) {
        const room = h.rooms.find((r) => r.type === 'bedroom') || h.rooms[0];
        h.purchase = {
          roomId: room ? room.id : null, replace: true,
          A: { name: 'Budget 9K', price: 380, btu: 9000, rating: 'A', inverter: false, powerKW: null },
          B: { name: 'Efficient 9K', price: 620, btu: 9000, rating: 'A+++', inverter: true, powerKW: null },
        };
      }
      return h.purchase;
    },
    /* turn a door half way round: hinge at the other end, opening to the other side */
    rotateDoor(roomId, id) {
      const r = store.room(roomId);
      const o = r && r.doors.find((x) => x.id === id);
      if (!o) return;
      o.rot180 = !o.rot180;
      store.commit('struct');
      render();
      toast(t('door.rotated'));
    },
    rotateAC(id) {
      const a = store.ac(id);
      if (!a) return;
      a.orient = a.orient === 'v' ? 'h' : 'v';
      store.commit('struct');
      render();
      const f = document.querySelector(`[data-key="ac-${id}"]`);
      if (f) f.focus({ preventScroll: true });
    },
    clampRoomContents(r) {
      ['windows', 'doors'].forEach((k) => r[k].forEach((o) => {
        const L = TH.wallLength(r, o.wall);
        o.w = Math.min(o.w, L);
        o.offset = clamp(o.offset, 0, Math.max(0, L - o.w));
      }));
      store.state.acs.filter((a) => a.roomId === r.id).forEach((a) => {
        a.x = clamp(a.x, r.x + 0.3, r.x + r.length - 0.3);
        a.y = clamp(a.y, r.y + 0.2, r.y + r.width - 0.2);
      });
    },
    async deleteSelection() {
      const s = this.sel;
      if (!s || s.kind === 'roomwall') return toast(t('toast.selectFirst'));
      const h = store.state;
      if (s.kind === 'room') {
        const r = store.room(s.id);
        const n = h.acs.filter((a) => a.roomId === s.id).length;
        if (!(await Airly.confirmDialog({ icon: '🗑', danger: true, title: t(n ? 'confirm.deleteRoomAC' : 'confirm.deleteRoom', { room: Airly.roomName(r), n }), ok: t('confirm.okDelete'), cancel: t('common.cancel') }))) return;
        h.rooms = h.rooms.filter((x) => x.id !== s.id);
        h.acs = h.acs.filter((a) => a.roomId !== s.id);
      } else if (s.kind === 'ac') {
        h.acs = h.acs.filter((a) => a.id !== s.id);
      } else if (s.kind === 'opening') {
        const r = store.room(s.roomId);
        if (r) { r.windows = r.windows.filter((o) => o.id !== s.id); r.doors = r.doors.filter((o) => o.id !== s.id); }
      } else if (s.kind === 'wall') {
        h.walls = h.walls.filter((w) => w.id !== s.id);
      } else if (s.kind === 'furn') {
        h.furniture = (h.furniture || []).filter((f) => f.id !== s.id);
      }
      this.sel = null;
      store.commit('delete');
    },
  });
})();

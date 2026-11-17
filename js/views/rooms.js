/* Airly — Room measurements screen */
(function () {
  'use strict';
  const Airly = window.Airly;
  const { t, S, TH, esc, F, field, num, tnum, text, sel, check, toggle, opts, btn, card, seasonTabs, badge, estimateNote, head, views, wallSelect, updateCalc } = Airly.kit;

  /* temperature DIFFERENCE input (e.g. daily swing): °C ↔ °F uses ×1.8 */
  function dnum(bind, valueC, minC, maxC) {
    const k = F().isF() ? 1.8 : 1;
    return `<input type="number" inputmode="decimal" data-bind="${bind}" data-tdelta="1" value="${Math.round(valueC * k * 10) / 10}" min="${Math.floor(minC * k)}" max="${Math.ceil(maxC * k)}" step="${F().isF() ? 1 : 0.5}">`;
  }
  function weatherBlock() {
    const w = Airly.ui.weather || {};
    let res = '';
    if (w.loading) res = `<p class="muted small" role="status">${esc(t('wx.loading'))}</p>`;
    else if (w.error) res = `<p class="small" role="status">${badge('warning', t('sev.warning'))} ${esc(w.error)}</p>`;
    else if (w.days) {
      res = `<p class="small"><strong>${esc(w.place)}</strong></p><div class="wx-days">${w.days.map((d, i) => `<div class="wx-day"><div class="muted small">${esc(new Date(d.date + 'T12:00').toLocaleDateString(Airly.i18n.locale(), { weekday: 'short', day: 'numeric', month: 'short' }))}</div>
        <div><strong>${esc(F().temp(d.max))}</strong> / ${esc(F().temp(d.min))}</div>${d.rh != null ? `<div class="muted small">${esc(t('sim.humidity'))} ${Math.round(d.rh)} %</div>` : ''}
        ${btn('useWeather', esc(t('wx.use')), 'small', { day: i })}</div>`).join('')}</div>`;
    }
    return `<h3>${esc(t('wx.title'))}</h3><div class="toolbar-inline"><label for="wx-city" class="sr-only">${esc(t('wx.city'))}</label>
      <input type="text" id="wx-city" placeholder="${esc(t('wx.city'))}" value="${esc(w.city || '')}" autocomplete="address-level2">${btn('fetchWeather', '☁ ' + esc(t('wx.get')), 'small')}</div>
      <small class="hint">${esc(t('wx.privacy'))}</small>${res}`;
  }

  views.rooms = {
    render(el) {
      const h = S();
      let id = Airly.ui.roomId;
      if (!h.rooms.find((r) => r.id === id)) id = Airly.ui.roomId = h.rooms[0] ? h.rooms[0].id : null;
      const r = id ? Airly.store.room(id) : null;
      const tabs = `<div class="room-tabs"><div class="room-tablist" role="tablist" aria-label="${esc(t('nav.rooms'))}">` + h.rooms.map((x) =>
        `<button type="button" role="tab" aria-selected="${x.id === id}" class="room-tab ${x.id === id ? 'active' : ''}" data-action="pickRoom" data-id="${x.id}">${esc(Airly.roomName(x))}</button>`).join('') + '</div>' +
        btn('addRoomQuick', `<span aria-hidden="true">＋</span> ${esc(t('designer.addRoom'))}`, 'ghost small') + '</div>';
      el.innerHTML = head('nav.rooms', 'rooms.lede') + tabs + (r ? this.roomForm(r) + this.calibForm(r) : `<div class="card empty">${esc(t('rooms.none'))}</div>`) + this.envForm() + estimateNote();
    },
    roomForm(r) {
      const g = TH.geometry(r);
      const k = (p) => `room.${r.id}.${p}`;
      const links = TH.adjacency(S()).filter((l) => l.a === r.id || l.b === r.id);
      const conn = links.length ? `<ul class="conn-list">` + links.map((l) => {
        const other = Airly.store.room(l.a === r.id ? l.b : l.a);
        const c = TH.linkConductance(l, S());
        let via;
        if (l.openPlan) via = t('conn.openPlan');
        else if (!l.doors.length) via = t('conn.wall');
        else via = l.doors.some((d) => d.door.open) ? t('conn.openDoor') : t('conn.closedDoor');
        return `<li><strong>${esc(Airly.roomName(other))}</strong> — ${esc(via)} <span class="muted">(${F().num(l.len, 1)} m, ${F().num(c.Gtyp, 0)} W/K)</span></li>`;
      }).join('') + '</ul>' : `<p class="muted">${esc(t('conn.none'))}</p>`;
      const req = TH.required(r, 'cool', S().env), reqH = TH.required(r, 'heat', S().env);
      const opening = (type, o, i) => {
        const key = `op.${r.id}.${type}.${o.id}`;
        return `<div class="opening-row"><span class="op-label">${esc(t(type === 'doors' ? 'plan.door' : 'plan.window'))} ${i + 1}</span>
          ${field(t('op.w'), num(`${key}.w`, o.w, 0.3, 10, 0.1), { unit: 'm' })}
          ${field(t('op.h'), num(`${key}.h`, o.h, 0.3, 4, 0.1), { unit: 'm' })}
          ${field(t('op.wall'), sel(`${key}.wall`, opts(Airly.WALLS, 'wall.'), o.wall))}
          ${btn('removeOpening', '✕', 'icon danger-ghost', { room: r.id, type, id: o.id }).replace('<button', `<button aria-label="${esc(t('common.remove'))}"`)}
          ${type === 'doors' ? `<div class="op-extra">${toggle(`${key}.open`, o.open, t('op.open'))}</div>` : ''}</div>`;
      };
      return `<div class="grid-2">
        ${card(t('rooms.measurements'), `
          <div class="field-row">${field(t('room.name'), text(k('name'), r.name, `placeholder="${esc(Airly.roomName(Object.assign({}, r, { name: '' })))}"`))}${field(t('room.type'), sel(k('type'), opts(Airly.ROOM_TYPES, 'roomType.'), r.type))}</div>
          <div class="field-row three">
            ${field(t('room.length'), num(k('length'), r.length, 1, 40, 0.1), { unit: 'm' })}
            ${field(t('room.width'), num(k('width'), r.width, 1, 40, 0.1), { unit: 'm' })}
            ${field(t('room.height'), num(k('height'), r.height, 2, 6, 0.1), { unit: 'm' })}
          </div>
          <div class="calc-box"><div><span>${esc(t('room.area'))}</span><strong data-calc="area-${r.id}">${F().num(g.area, 2)} m²</strong></div>
            <div><span>${esc(t('room.volume'))}</span><strong data-calc="vol-${r.id}">${F().num(g.volume, 2)} m³</strong></div></div>
          <h3>${esc(t('rooms.windows'))} <span class="count">${r.windows.length}</span></h3>
          ${r.windows.map((o, i) => opening('windows', o, i)).join('') || `<p class="muted small">${esc(t('rooms.noWindows'))}</p>`}
          <div class="add-op"><label for="aw-${r.id}">${esc(t('op.onWall'))}</label>${wallSelect('aw-' + r.id)}${btn('addOpening', '＋ ' + esc(t('designer.addWindow')), 'ghost small', { room: r.id, type: 'windows', select: 'aw-' + r.id })}</div>
          <h3>${esc(t('rooms.doors'))} <span class="count">${r.doors.length}</span></h3>
          ${r.doors.map((o, i) => opening('doors', o, i)).join('') || `<p class="muted small">${esc(t('rooms.noDoors'))}</p>`}
          <div class="add-op"><label for="ad-${r.id}">${esc(t('op.onWall'))}</label>${wallSelect('ad-' + r.id)}${btn('addOpening', '＋ ' + esc(t('designer.addDoor')), 'ghost small', { room: r.id, type: 'doors', select: 'ad-' + r.id })}</div>
        `)}
        ${card(t('rooms.conditions'), `
          <div class="field-row three">
            ${field(t('room.wallIns'), sel(k('wallIns'), opts(Airly.QUALITY, 'quality.'), r.wallIns))}
            ${field(t('room.ceilIns'), sel(k('ceilIns'), opts(Airly.QUALITY, 'quality.'), r.ceilIns))}
            ${field(t('room.floorIns'), sel(k('floorIns'), opts(Airly.QUALITY, 'quality.'), r.floorIns))}
          </div>
          <div class="field-row">
            ${field(t('room.sun'), sel(k('sun'), opts(Airly.SUN, 'sun.'), r.sun), { hint: t('room.sunHint') })}
            ${field(t('room.floorLevel'), sel(k('floorLevel'), opts(Airly.FLOOR_LEVELS, 'floor.'), r.floorLevel))}
          </div>
          <div class="field-row">
            ${field(t('room.extWalls'), num(k('exteriorWalls'), r.exteriorWalls, 0, 4, 1), { hint: t('room.extWallsHint') })}
            <div class="field align-end">${btn('autoExt', esc(t('room.detectExt')), 'ghost small', { id: r.id })}</div>
          </div>
          <div class="field-row">
            ${field(t('room.people'), num(k('people'), r.people, 0, 30, 1))}
            ${field(t('room.appliances'), num(k('appliancesW'), r.appliancesW, 0, 10000, 10), { unit: 'W', hint: t('room.appliancesHint') })}
          </div>
          ${field(t('room.initialTemp'), tnum(k('initialTemp'), r.initialTemp, -10, 45), { unit: F().unitSym(), hint: t('room.initialHint') })}
          ${check(k('openPlan'), r.openPlan, t('room.openPlan'))}
          <h3>${esc(t('rooms.connections'))}</h3>${conn}
          <h3>${esc(t('rooms.estimate'))}</h3>
          <div class="calc-box"><div><span>❄ ${esc(t('season.cooling'))}</span><strong>${esc(F().btu(Math.round(req.btu / 100) * 100))}</strong><small>${esc(t('rooms.suggest'))} ${esc(F().btu(req.size))}</small></div>
          <div><span>☀ ${esc(t('season.heating'))}</span><strong>${esc(F().btu(Math.round(reqH.btu / 100) * 100))}</strong><small>${esc(t('rooms.suggest'))} ${esc(F().btu(reqH.size))}</small></div></div>
          <div class="row-gap">${btn('deleteRoom', esc(t('rooms.delete')), 'danger-ghost small', { id: r.id })}</div>
        `)}
      </div>`;
    },
    calibForm(r) {
      const acs = S().acs.filter((a) => a.roomId === r.id);
      const f = F();
      const u = f.unitSym();
      const res = Airly.ui.calib && Airly.ui.calib.roomId === r.id ? Airly.ui.calib : null;
      const show = (c) => Math.round(f.toU(c) * 10) / 10;
      let out = '';
      if (res && res.result) {
        const b = res.result.best;
        out = `<div class="calib-result" role="status"><p>${esc(t('calib.result', { cur: f.temp(res.result.current), best: f.temp(b.end), meas: f.temp(res.result.measured) }))}</p>
          <p><strong>${esc(t('calib.suggest'))}</strong> ${esc(t('room.wallIns'))}: ${esc(t('quality.' + b.wallIns))} · ${esc(t('room.sun'))}: ${esc(t('sun.' + b.sun))} · ${esc(t('calib.factor'))}: ×${f.num(b.calib, 1)}</p>
          ${btn('calibApply', esc(t('calib.apply')), 'primary small')}</div>`;
      }
      return card(t('calib.title'), `<p class="muted">${esc(t('calib.lede'))}</p>
        <div class="field-row four">
          <div class="field"><label for="cal-out">${esc(t('calib.outside'))} <span class="unit">(${u})</span></label><input id="cal-out" type="number" step="0.5" value="${show(res ? res.meas.outside : S().env.outsideSummer)}"></div>
          <div class="field"><label for="cal-start">${esc(t('calib.start'))} <span class="unit">(${u})</span></label><input id="cal-start" type="number" step="0.1" value="${show(res ? res.meas.start : 28)}"></div>
          <div class="field"><label for="cal-end">${esc(t('calib.end'))} <span class="unit">(${u})</span></label><input id="cal-end" type="number" step="0.1" value="${show(res ? res.meas.end : 24)}"></div>
          <div class="field"><label for="cal-min">${esc(t('calib.minutes'))} <span class="unit">(min)</span></label><input id="cal-min" type="number" min="5" max="600" step="5" value="${res ? res.meas.minutes : 40}"></div>
        </div>
        <div class="field-row"><div class="field"><label for="cal-ac">${esc(t('calib.ac'))}</label><select id="cal-ac"><option value="">${esc(t('calib.noAC'))}</option>${acs.map((a) => `<option value="${a.id}"${res && res.meas.acId === a.id ? ' selected' : ''}>${esc(t('ac.unit'))} ${S().acs.indexOf(a) + 1} · ${esc(f.btu(a.btu))} · ${esc(t('mode.' + a.mode))} ${esc(f.temp(a.target))}</option>`).join('')}</select></div>
        <div class="field align-end">${btn('calibRun', esc(t('calib.run')), 'primary', { id: r.id })}</div></div>
        <p class="muted small">${esc(t('calib.current', { k: f.num(r.calib || 1, 1) }))}</p>${out}`);
    },
    envForm() {
      const e = S().env;
      const k = (p) => `env.${p}`;
      return card(t('env.title'), `
        <div class="field-row"><div class="field"><span class="label">${esc(t('env.season'))}</span>${seasonTabs(e.season, 'setSeason')}</div></div>
        <div class="field-row three">
          ${field(t('env.outsideSummer'), tnum(k('outsideSummer'), e.outsideSummer, 10, 50), { unit: F().unitSym() })}
          ${field(t('env.initialSummer'), tnum(k('initialSummer'), e.initialSummer, 10, 45), { unit: F().unitSym() })}
          ${field(t('env.desiredCool'), tnum(k('desiredCool'), e.desiredCool, 16, 30), { unit: F().unitSym() })}
        </div>
        <div class="field-row three">
          ${field(t('env.outsideWinter'), tnum(k('outsideWinter'), e.outsideWinter, -25, 20), { unit: F().unitSym() })}
          ${field(t('env.initialWinter'), tnum(k('initialWinter'), e.initialWinter, -5, 25), { unit: F().unitSym() })}
          ${field(t('env.desiredHeat'), tnum(k('desiredHeat'), e.desiredHeat, 16, 28), { unit: F().unitSym() })}
        </div>
        ${weatherBlock()}
        <h3>${esc(t('env.dayTitle'))}</h3>
        <div class="field-row three">
          <div class="field">${toggle(k('dayCycle'), e.dayCycle, t('env.dayCycle'))}<small class="hint">${esc(t('env.dayCycleHint'))}</small></div>
          ${field(t('env.startHour'), sel(k('startHour'), Array.from({ length: 24 }, (_, i) => ({ v: i, l: F().clock(i) })), e.startHour, true))}
          ${field(t('env.north'), sel(k('north'), opts(Airly.WALLS, 'north.'), e.north || 'top'), { hint: t('env.northHint') })}
        </div>
        <div class="field-row four">
          ${field(t('env.swingSummer'), dnum(k('swingSummer'), e.swingSummer, 0, 20), { unit: F().unitSym() })}
          ${field(t('env.swingWinter'), dnum(k('swingWinter'), e.swingWinter, 0, 20), { unit: F().unitSym() })}
          ${field(t('env.rhSummer'), num(k('rhSummer'), e.rhSummer, 10, 100, 1), { unit: '%' })}
          ${field(t('env.rhWinter'), num(k('rhWinter'), e.rhWinter, 10, 100, 1), { unit: '%' })}
        </div>`);
    },
    onFormChange() { updateCalc(); },
  };
})();

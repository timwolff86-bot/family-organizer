import * as store from './store.js';
import * as D from './dates.js';

/* ================= Zustand ================= */

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};

const state = {
  view: 'heute', // heute | woche | einkauf | mehr
  date: D.todayKey(),
  weekStart: D.startOfWeek(D.todayKey()),
  data: null,
  session: null,
  me: lsGet('fo-me'),
  taskFilter: lsGet('fo-filter') || 'alle', // alle | meine | sofa
  shop: lsGet('fo-shop') || 'Rewe',
  hiddenAt: null,
  pendingRender: false,
};

const SHOPS = ['Rewe', 'Getränke', 'Sonstiges'];
const COLORS = ['#2f6f6a', '#d9822b', '#7c5cbf', '#2b7bd9', '#d94c6a', '#3f9d4a', '#8a6d3b', '#5c6b7a'];
const ROLES = { erwachsen: 'Erwachsen', kind: 'Kind', helfer: 'Helfer/in' };

/* ================= Helfer ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const members = () => [...(state.data?.members || [])].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
const member = (id) => state.data?.members.find((m) => m.id === id);
const meMember = () => member(state.me);

function chip(id, fallback = '') {
  const m = member(id);
  if (!m) return fallback;
  return `<span class="chip" style="--c:${esc(m.color)}">${esc(m.name)}</span>`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fail(err) {
  console.error(err);
  toast('Speichern fehlgeschlagen – bitte nochmal versuchen.');
  reload();
}

/* ================= Daten ändern ================= */

// Sofort lokal übernehmen, dann im Hintergrund speichern.
// quiet: nicht sofort neu zeichnen (z. B. wenn der Fokus gerade ins nächste Feld springt)
async function save(table, row, conflict = 'id', { quiet = false } = {}) {
  const list = state.data[table];
  const cols = conflict.split(',');
  if (!row.id && conflict === 'id') row.id = store.uuid();
  const i = list.findIndex((r) => cols.every((c) => r[c] === row[c]));
  if (i >= 0) {
    row = { ...list[i], ...row, id: list[i].id };
    list[i] = row;
  } else {
    row = { id: store.uuid(), created_at: new Date().toISOString(), ...row };
    list.push(row);
  }
  if (quiet) setTimeout(render, 0); // render() wartet selbst, solange jemand tippt
  else render();
  try {
    await store.upsert(table, row, conflict);
  } catch (e) {
    fail(e);
  }
  return row;
}

async function del(table, id) {
  state.data[table] = state.data[table].filter((r) => r.id !== id);
  render();
  try {
    await store.remove(table, id);
    await reload();
  } catch (e) {
    fail(e);
  }
}

async function reload() {
  try {
    state.data = await store.loadAll();
  } catch (e) {
    console.error(e);
    toast('Daten konnten nicht geladen werden.');
    return;
  }
  render();
}

/* ================= Termine ================= */

function eventsOn(day) {
  const wd = D.isoWeekday(day);
  const out = [];
  for (const ev of state.data.events) {
    const weekly = ev.weekdays?.length > 0;
    const hit = weekly ? ev.weekdays.includes(wd) && (!ev.end_date || ev.end_date >= day) : ev.date === day;
    if (!hit) continue;
    const occ = state.data.event_occurrences.find((o) => o.event_id === ev.id && o.date === day);
    out.push({
      ev,
      occ,
      day,
      weekly,
      driver_to: occ ? occ.driver_to : ev.driver_to,
      driver_back: occ ? occ.driver_back : ev.driver_back,
      skip_to: !!(occ ? occ.skip_to : ev.skip_to),
      skip_back: !!(occ ? occ.skip_back : ev.skip_back),
      cancelled: occ?.cancelled || false,
    });
  }
  return out.sort((a, b) => (a.ev.start_time || '99').localeCompare(b.ev.start_time || '99') || a.ev.title.localeCompare(b.ev.title));
}

const missingDriver = (o) =>
  o.ev.needs_driver && !o.cancelled && ((!o.skip_to && !o.driver_to) || (!o.skip_back && !o.driver_back));

const SKIP = 'skip'; // Wert im Auswahlfeld für "nicht nötig"
const skipField = (field) => (field === 'driver_to' ? 'skip_to' : 'skip_back');

// Auswahlfeld-Wert → { driver_x, skip_x }
const driverPatch = (field, value) => ({
  [field]: value && value !== SKIP ? value : null,
  [skipField(field)]: value === SKIP,
});

function setOccurrence(o, patch) {
  const row = {
    event_id: o.ev.id,
    date: o.day,
    driver_to: o.driver_to || null,
    driver_back: o.driver_back || null,
    skip_to: o.skip_to,
    skip_back: o.skip_back,
    cancelled: o.cancelled,
    ...patch,
  };
  if (o.occ) row.id = o.occ.id;
  return save('event_occurrences', row, 'event_id,date');
}

// Optionen: offen / nicht nötig / alle, die fahren können
function driverOptions(current, skip) {
  const options = members().filter((m) => m.drives || m.id === current);
  return `
    <option value="">– offen –</option>
    <option value="${SKIP}" ${skip ? 'selected' : ''}>entfällt</option>
    ${options.map((m) => `<option value="${m.id}" ${!skip && m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
}

function driverSelect(o, field, label) {
  const skip = o[skipField(field)];
  const missing = !skip && !o[field];
  return `
    <label class="drv ${missing ? 'missing' : ''} ${skip ? 'skip' : ''}">
      <span>${label}</span>
      <select data-change="driver" data-event="${o.ev.id}" data-day="${o.day}" data-field="${field}">
        ${driverOptions(o[field], skip)}
      </select>
    </label>`;
}

function eventCard(o) {
  const { ev } = o;
  const time = ev.start_time ? `${D.hm(ev.start_time)}${ev.end_time ? `–${D.hm(ev.end_time)}` : ''}` : '–';
  const warn = missingDriver(o);
  return `
    <article class="card event ${o.cancelled ? 'cancelled' : ''} ${warn ? 'warn' : ''}">
      <button class="event-main" data-action="edit-event" data-id="${ev.id}" data-day="${o.day}">
        <div class="time">${esc(time)}</div>
        <div class="body">
          <div class="title">${esc(ev.title)} ${o.weekly ? '<span class="muted small">↻</span>' : ''}</div>
          <div class="meta">${chip(ev.member_id)}${ev.location ? `<span class="muted">📍 ${esc(ev.location)}</span>` : ''}</div>
          ${o.cancelled ? '<div class="tag">Fällt aus</div>' : ''}
          ${ev.notes ? `<div class="muted small">${esc(ev.notes)}</div>` : ''}
        </div>
      </button>
      ${
        ev.needs_driver && !o.cancelled
          ? `<div class="drivers">${warn ? '<span class="warn-label">🚗 Fahrer fehlt</span>' : '<span class="ok-label">🚗</span>'}
               ${driverSelect(o, 'driver_to', 'Hin')}${driverSelect(o, 'driver_back', 'Zurück')}</div>`
          : ''
      }
    </article>`;
}

/* ================= Aufgaben ================= */

const doneKey = (t) => (t.done_at ? D.toKey(new Date(t.done_at)) : null);

function tasksOn(day, { filter = true } = {}) {
  const today = D.todayKey();
  const out = [];
  for (const t of state.data.tasks) {
    if (t.weekdays?.length) {
      if (t.weekdays.includes(D.isoWeekday(day))) {
        const c = state.data.task_completions.find((x) => x.task_id === t.id && x.date === day);
        out.push({ t, day, done: !!c, recurring: true });
      }
      continue;
    }
    const stillVisible = !t.done_at || doneKey(t) === today;
    if (t.due_date) {
      if (t.due_date === day) out.push({ t, day, done: !!t.done_at });
      else if (day === today && t.due_date < today && stillVisible) out.push({ t, day, done: !!t.done_at, overdue: true });
    } else if (day === today && stillVisible) {
      out.push({ t, day, done: !!t.done_at, undated: true });
    }
  }
  let list = out;
  if (filter && state.taskFilter === 'meine') list = list.filter((x) => x.t.assignee === state.me);
  if (filter && state.taskFilter === 'sofa') list = list.filter((x) => x.t.sofa);
  return list.sort((a, b) => a.done - b.done || !!b.overdue - !!a.overdue || a.t.title.localeCompare(b.t.title));
}

function toggleTask(taskId, day) {
  const t = state.data.tasks.find((x) => x.id === taskId);
  if (!t) return;
  if (t.weekdays?.length) {
    const c = state.data.task_completions.find((x) => x.task_id === t.id && x.date === day);
    if (c) del('task_completions', c.id);
    else save('task_completions', { task_id: t.id, date: day }, 'task_id,date');
  } else {
    save('tasks', { id: t.id, done_at: t.done_at ? null : new Date().toISOString() });
  }
}

function taskRow(x) {
  const { t } = x;
  const badges = [
    x.overdue ? `<span class="tag red">seit ${esc(D.formatDayMonth(t.due_date))}</span>` : '',
    x.recurring ? '<span class="muted small">↻</span>' : '',
    t.sofa ? '<span class="tag sofa" title="Im Sitzen machbar">🛋️</span>' : '',
  ].join('');
  return `
    <li class="task ${x.done ? 'done' : ''}">
      <button class="check" data-action="toggle-task" data-id="${t.id}" data-day="${x.day}" aria-label="Erledigt">
        ${x.done ? '✓' : ''}
      </button>
      <button class="task-main" data-action="edit-task" data-id="${t.id}">
        <span class="title">${esc(t.title)}</span>
        <span class="meta">${chip(t.assignee)}${badges}</span>
      </button>
    </li>`;
}

/* ================= Ansichten ================= */

function viewHeute() {
  const day = state.date;
  const isToday = day === D.todayKey();
  const events = eventsOn(day);
  const tasks = tasksOn(day);
  const meal = state.data.meals.find((m) => m.date === day);

  // Offene Fahrten in den nächsten 7 Tagen
  let openRides = 0;
  if (isToday) {
    for (let i = 0; i < 7; i++) openRides += eventsOn(D.addDays(day, i)).filter(missingDriver).length;
  }

  const filters = [
    ['alle', 'Alle'],
    ['meine', meMember() ? `Meine` : 'Meine'],
    ['sofa', '🛋️ Sofa'],
  ];

  return `
    ${
      openRides
        ? `<button class="banner" data-action="goto-week">⚠️ ${openRides} ${openRides === 1 ? 'Fahrt' : 'Fahrten'} in den nächsten 7 Tagen noch ohne Fahrer</button>`
        : ''
    }
    <section>
      <h2>Termine</h2>
      ${events.length ? events.map(eventCard).join('') : '<p class="empty">Keine Termine.</p>'}
    </section>

    <section>
      <h2>Essen</h2>
      <div class="card meal">
        <span class="meal-icon">🍽️</span>
        <input id="meal-input" class="meal-input" data-day="${day}" value="${esc(meal?.text || '')}" placeholder="Was gibt es ${isToday ? 'heute' : 'an diesem Tag'}?" enterkeyhint="done" />
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Aufgaben</h2>
        <div class="seg">
          ${filters
            .map(([k, l]) => `<button class="${state.taskFilter === k ? 'on' : ''}" data-action="filter" data-filter="${k}">${l}</button>`)
            .join('')}
        </div>
      </div>
      ${
        state.taskFilter === 'meine' && !meMember()
          ? '<p class="empty">Unter „Mehr“ auswählen, wer du bist.</p>'
          : tasks.length
            ? `<ul class="tasks card">${tasks.map(taskRow).join('')}</ul>`
            : `<p class="empty">${state.taskFilter === 'sofa' ? 'Keine Sofa-Aufgaben offen.' : 'Nichts zu tun. 🎉'}</p>`
      }
    </section>`;
}

function viewWoche() {
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(state.weekStart, i));
  const today = D.todayKey();
  return days
    .map((day) => {
      const events = eventsOn(day);
      const tasks = tasksOn(day, { filter: false }).filter((x) => !x.undated && !x.overdue);
      const open = tasks.filter((x) => !x.done).length;
      const meal = state.data.meals.find((m) => m.date === day);
      return `
        <div class="card week-day ${day === today ? 'today' : ''}">
          <button class="week-top" data-action="goto-day" data-day="${day}">
          <div class="wd">
            <strong>${D.WD_SHORT[D.isoWeekday(day) - 1]}</strong>
            <span>${D.fromKey(day).getDate()}.</span>
          </div>
          <div class="body">
            ${
              events.length
                ? events
                    .map(
                      (o) => `<div class="wline ${o.cancelled ? 'cancelled' : ''}">
                        <span class="muted">${o.ev.start_time ? D.hm(o.ev.start_time) : '–'}</span>
                        ${esc(o.ev.title)} ${chip(o.ev.member_id)}
                        ${missingDriver(o) ? '<span class="tag red">🚗 offen</span>' : ''}
                      </div>`
                    )
                    .join('')
                : '<div class="muted small">Keine Termine</div>'
            }
            ${open ? `<div class="wline small muted">☐ ${open} ${open === 1 ? 'Aufgabe' : 'Aufgaben'}</div>` : ''}
          </div>
          </button>
          <label class="week-meal">
            <span>🍽️</span>
            <input class="meal-input" data-day="${day}" value="${esc(meal?.text || '')}" placeholder="Essen eintragen" enterkeyhint="next" />
          </label>
        </div>`;
    })
    .join('');
}

/* Schnelltasten: was oft gekauft wird (pro Gerät gemerkt) + ein paar Klassiker */
const QUICK_DEFAULTS = [
  ['Milch', 'Rewe'],
  ['Brot', 'Rewe'],
  ['Butter', 'Rewe'],
  ['Eier', 'Rewe'],
  ['Käse', 'Rewe'],
  ['Joghurt', 'Rewe'],
  ['Bananen', 'Rewe'],
  ['Äpfel', 'Rewe'],
  ['Toilettenpapier', 'Rewe'],
  ['Wasser', 'Getränke'],
  ['Apfelschorle', 'Getränke'],
];

function readHistory() {
  try {
    return JSON.parse(lsGet('fo-shop-history') || '{}');
  } catch {
    return {};
  }
}

function rememberItem(name, shop) {
  const h = readHistory();
  const key = name.toLowerCase();
  h[key] = { name, shop, n: (h[key]?.n || 0) + 1 };
  lsSet('fo-shop-history', JSON.stringify(h));
}

function quickItems() {
  const open = new Set(state.data.shopping_items.filter((i) => !i.done).map((i) => i.name.toLowerCase()));
  const h = readHistory();
  const fromHistory = Object.values(h).sort((a, b) => b.n - a.n);
  const all = [...fromHistory, ...QUICK_DEFAULTS.map(([name, shop]) => ({ name, shop }))];
  const seen = new Set();
  const out = [];
  for (const it of all) {
    const key = it.name.toLowerCase();
    if (seen.has(key) || open.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 10) break;
  }
  return out;
}

function addItem(name, shop) {
  rememberItem(name, shop);
  save('shopping_items', { name, shop, done: false });
}

function viewEinkauf() {
  const items = state.data.shopping_items;
  const quick = quickItems();
  const groups = SHOPS.map((shop) => {
    const list = items
      .filter((i) => (SHOPS.includes(i.shop) ? i.shop : 'Sonstiges') === shop)
      .sort((a, b) => a.done - b.done || (a.created_at || '').localeCompare(b.created_at || ''));
    if (!list.length) return '';
    const open = list.filter((i) => !i.done).length;
    return `
      <section>
        <div class="section-head">
          <h2>${shop} <span class="muted small">${open} offen</span></h2>
          ${open ? `<button class="link" data-action="copy-list" data-shop="${shop}">📋 Kopieren</button>` : ''}
        </div>
        <ul class="card shop-list">
          ${list
            .map(
              (i) => `<li class="${i.done ? 'done' : ''}">
                <button class="check" data-action="toggle-item" data-id="${i.id}" aria-label="Abhaken">${i.done ? '✓' : ''}</button>
                <span class="name" data-action="toggle-item" data-id="${i.id}">${esc(i.name)}</span>
                <button class="icon-btn" data-action="delete-item" data-id="${i.id}" aria-label="Löschen">✕</button>
              </li>`
            )
            .join('')}
        </ul>
      </section>`;
  }).join('');

  return `
    <form class="card add-item" data-form="add-item">
      <input name="name" placeholder="Was fehlt?" autocomplete="off" enterkeyhint="done" required />
      <select name="shop">${SHOPS.map((s) => `<option ${s === state.shop ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn primary" type="submit">+</button>
    </form>
    ${
      quick.length
        ? `<div class="quick">${quick
            .map(
              (q) => `<button class="quick-chip" data-action="quick-add" data-name="${esc(q.name)}" data-shop="${esc(q.shop)}">
                + ${esc(q.name)}${q.shop === 'Getränke' ? ' <span class="muted small">🥤</span>' : ''}</button>`
            )
            .join('')}</div>`
        : ''
    }
    ${groups || '<p class="empty">Die Liste ist leer.</p>'}
    ${items.some((i) => i.done) ? '<button class="btn ghost wide" data-action="clear-done">Erledigte entfernen</button>' : ''}`;
}

function viewMehr() {
  const ms = members();
  const events = [...state.data.events]
    .filter((e) => e.weekdays?.length || (e.date && e.date >= D.todayKey()))
    .sort((a, b) => !!b.weekdays?.length - !!a.weekdays?.length || (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title));
  const tasks = state.data.tasks.filter((t) => t.weekdays?.length || !t.done_at);

  const when = (x) =>
    x.weekdays?.length
      ? [...x.weekdays].sort().map((d) => D.WD_SHORT[d - 1]).join(', ')
      : x.date || x.due_date
        ? D.formatShort(x.date || x.due_date)
        : 'ohne Datum';

  return `
    <section>
      <h2>Ich bin</h2>
      <div class="card pad">
        <select data-change="me">
          <option value="">– bitte wählen –</option>
          ${ms.map((m) => `<option value="${m.id}" ${m.id === state.me ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
        <p class="muted small">Gilt nur für dieses Gerät. Wird für den Filter „Meine“ genutzt.</p>
      </div>
    </section>

    <section>
      <div class="section-head"><h2>Familie &amp; Helfer</h2><button class="link" data-action="new-member">+ Person</button></div>
      <ul class="card list">
        ${ms
          .map(
            (m) => `<li><button data-action="edit-member" data-id="${m.id}">
              <span class="dot" style="background:${esc(m.color)}"></span>
              <span class="grow">${esc(m.name)} <span class="muted small">${ROLES[m.role] || ''}</span></span>
              ${m.drives ? '<span title="Kann fahren">🚗</span>' : ''}
            </button></li>`
          )
          .join('')}
      </ul>
    </section>

    <section>
      <div class="section-head"><h2>Termine</h2><button class="link" data-action="new-event">+ Termin</button></div>
      <ul class="card list">
        ${
          events.length
            ? events
                .map(
                  (e) => `<li><button data-action="edit-event" data-id="${e.id}">
                    <span class="grow">${esc(e.title)} ${chip(e.member_id)}</span>
                    <span class="muted small">${esc(when(e))}${e.start_time ? ` · ${D.hm(e.start_time)}` : ''}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Termine</li>'
        }
      </ul>
    </section>

    <section>
      <div class="section-head"><h2>Offene &amp; wiederkehrende Aufgaben</h2><button class="link" data-action="new-task">+ Aufgabe</button></div>
      <ul class="card list">
        ${
          tasks.length
            ? tasks
                .map(
                  (t) => `<li><button data-action="edit-task" data-id="${t.id}">
                    <span class="grow">${esc(t.title)} ${t.sofa ? '🛋️' : ''} ${chip(t.assignee)}</span>
                    <span class="muted small">${esc(when(t))}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Aufgaben</li>'
        }
      </ul>
    </section>

    <section>
      <h2>App</h2>
      <div class="card pad">
        <p>${store.isCloud ? '☁️ Gemeinsamer Speicher (Supabase) aktiv.' : '📱 Lokaler Modus: Daten liegen nur auf diesem Gerät.'}</p>
        <p class="muted small">Auf dem iPhone: in Safari „Teilen“ → „Zum Home-Bildschirm“. Auf Android: Menü → „App installieren“.</p>
        ${store.isCloud && state.session ? `<p class="muted small">Angemeldet als ${esc(state.session.user.email)}</p><button class="btn ghost" data-action="logout">Abmelden</button>` : ''}
      </div>
    </section>`;
}

/* ================= Rahmen ================= */

function header() {
  if (state.view === 'heute') {
    const isToday = state.date === D.todayKey();
    return `
      <header class="top">
        <button class="nav" data-action="prev-day" aria-label="Vorheriger Tag">‹</button>
        <button class="title-btn" data-action="pick-date">
          <span class="rel">${D.relativeLabel(state.date)}</span>
          <span class="date">${esc(D.formatLong(state.date))}</span>
        </button>
        <button class="nav" data-action="next-day" aria-label="Nächster Tag">›</button>
        <input type="date" id="date-picker" value="${state.date}" tabindex="-1" aria-hidden="true" />
      </header>
      ${isToday ? '' : '<button class="today-pill" data-action="goto-today">Zu heute</button>'}`;
  }
  if (state.view === 'woche') {
    const end = D.addDays(state.weekStart, 6);
    return `
      <header class="top">
        <button class="nav" data-action="prev-week" aria-label="Vorherige Woche">‹</button>
        <button class="title-btn" data-action="this-week">
          <span class="rel">KW ${D.isoWeekNumber(state.weekStart)}</span>
          <span class="date">${D.formatDayMonth(state.weekStart)} – ${D.formatDayMonth(end)}</span>
        </button>
        <button class="nav" data-action="next-week" aria-label="Nächste Woche">›</button>
      </header>`;
  }
  const titles = { einkauf: 'Einkauf', mehr: 'Mehr' };
  return `<header class="top"><h1>${titles[state.view]}</h1></header>`;
}

function tabbar() {
  const tabs = [
    ['heute', '📅', 'Heute'],
    ['woche', '🗓️', 'Woche'],
    ['einkauf', '🛒', 'Einkauf'],
    ['mehr', '☰', 'Mehr'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([k, i, l]) => `<button class="${state.view === k ? 'on' : ''}" data-action="tab" data-tab="${k}">
        <span class="ti">${i}</span><span>${l}</span></button>`
    )
    .join('')}</nav>`;
}

function render() {
  const app = $('#app');

  // Nicht neu zeichnen, während jemand tippt – sonst springt der Cursor weg.
  const active = document.activeElement;
  if (active && app.contains(active) && active.matches('input, textarea')) {
    state.pendingRender = true;
    return;
  }
  state.pendingRender = false;

  if (store.isCloud && !state.session) {
    app.innerHTML = loginScreen();
    return;
  }
  if (!state.data) {
    app.innerHTML = '<div class="boot">Lädt …</div>';
    return;
  }
  if (!meMember() && members().length) {
    app.innerHTML = whoScreen();
    return;
  }

  const views = { heute: viewHeute, woche: viewWoche, einkauf: viewEinkauf, mehr: viewMehr };
  const scroll = window.scrollY;
  app.innerHTML = `
    ${header()}
    ${store.isCloud ? '' : '<div class="local-note">Lokaler Modus – Daten nur auf diesem Gerät</div>'}
    <main id="main" class="view-${state.view}">${views[state.view]()}</main>
    ${state.view === 'heute' || state.view === 'woche' ? '<button class="fab" data-action="add" aria-label="Neu">+</button>' : ''}
    ${tabbar()}`;
  window.scrollTo(0, scroll);
}

function loginScreen() {
  return `
    <div class="center-screen">
      <div class="logo">🏡</div>
      <h1>Familienplaner</h1>
      <form class="card pad login" data-form="login">
        <label>E-Mail<input name="email" type="email" autocomplete="username" required /></label>
        <label>Passwort<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="btn primary wide" type="submit">Anmelden</button>
        <p class="error" id="login-error"></p>
      </form>
    </div>`;
}

function whoScreen() {
  const ms = members().filter((m) => m.role !== 'kind');
  return `
    <div class="center-screen">
      <div class="logo">👋</div>
      <h1>Wer bist du?</h1>
      <p class="muted">Damit „Meine Aufgaben“ funktioniert. Kann später unter „Mehr“ geändert werden.</p>
      <div class="who">
        ${(ms.length ? ms : members())
          .map((m) => `<button class="btn big" style="--c:${esc(m.color)}" data-action="set-me" data-id="${m.id}">${esc(m.name)}</button>`)
          .join('')}
      </div>
    </div>`;
}

/* ================= Formulare (Bottom Sheet) ================= */

let sheetSubmit = null;

function openSheet(title, inner, onSubmit, extraButtons = '') {
  sheetSubmit = onSubmit;
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <form class="sheet" data-form="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <button type="button" class="link" data-action="close-sheet">Abbrechen</button>
        <strong>${esc(title)}</strong>
        <button type="submit" class="link strong">Sichern</button>
      </div>
      <div class="sheet-body">${inner}${extraButtons ? `<div class="sheet-extra">${extraButtons}</div>` : ''}</div>
    </form>`;
  document.body.classList.add('sheet-open');
  const first = $('#sheet-root input[name="title"], #sheet-root input[name="name"]');
  if (first && !first.value) setTimeout(() => first.focus(), 50);
}

function closeSheet() {
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('sheet-open');
  sheetSubmit = null;
  render();
}

const memberOptions = (selected, { filter = () => true, empty = '– niemand –' } = {}) =>
  `<option value="">${empty}</option>` +
  members()
    .filter((m) => filter(m) || m.id === selected)
    .map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`)
    .join('');

function weekdayPicker(selected = []) {
  return `<div class="weekdays">${D.WD_SHORT.map(
    (l, i) => `<label><input type="checkbox" name="wd" value="${i + 1}" ${selected.includes(i + 1) ? 'checked' : ''}/><span>${l}</span></label>`
  ).join('')}</div>`;
}

function repeatSwitch(name, value, options) {
  return `<div class="seg wide" data-repeat="${name}">${options
    .map(
      ([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}/><span>${l}</span></label>`
    )
    .join('')}</div>`;
}

function readWeekdays(form) {
  return [...form.querySelectorAll('input[name="wd"]:checked')].map((i) => Number(i.value));
}

function updateRepeatVisibility(form) {
  const mode = form.querySelector('input[name="repeat"]:checked')?.value;
  form.querySelectorAll('[data-show]').forEach((el) => {
    el.hidden = !el.dataset.show.split(' ').includes(mode);
  });
}

function eventForm(ev, day) {
  const isNew = !ev;
  ev ||= { needs_driver: true, date: day || state.date };
  const weekly = ev.weekdays?.length > 0;
  const o = !isNew && day ? eventsOn(day).find((x) => x.ev.id === ev.id) : null;

  const inner = `
    <label>Was?<input name="title" value="${esc(ev.title || '')}" placeholder="z. B. Pickleball" required /></label>
    <label>Für wen?<select name="member_id">${memberOptions(ev.member_id, { empty: '– alle / niemand –' })}</select></label>
    ${repeatSwitch('repeat', weekly ? 'weekly' : 'once', [
      ['once', 'Einmalig'],
      ['weekly', 'Jede Woche'],
    ])}
    <label data-show="once">Datum<input type="date" name="date" value="${esc(ev.date || state.date)}" /></label>
    <div data-show="weekly">
      ${weekdayPicker(ev.weekdays || [D.isoWeekday(day || state.date)])}
      <label>Bis (optional)<input type="date" name="end_date" value="${esc(ev.end_date || '')}" /></label>
    </div>
    <div class="row">
      <label>Von<input type="time" name="start_time" value="${esc(D.hm(ev.start_time))}" /></label>
      <label>Bis<input type="time" name="end_time" value="${esc(D.hm(ev.end_time))}" /></label>
    </div>
    <label>Wo? (optional)<input name="location" value="${esc(ev.location || '')}" /></label>
    <label class="check-line"><input type="checkbox" name="needs_driver" ${ev.needs_driver ? 'checked' : ''}/> Jemand muss fahren</label>
    <div class="row" data-driver>
      <label>${weekly ? 'Standard ' : ''}Hin<select name="driver_to">${driverOptions(ev.driver_to, ev.skip_to)}</select></label>
      <label>${weekly ? 'Standard ' : ''}Zurück<select name="driver_back">${driverOptions(ev.driver_back, ev.skip_back)}</select></label>
    </div>
    <label>Notiz<textarea name="notes" rows="2">${esc(ev.notes || '')}</textarea></label>`;

  const extra = isNew
    ? ''
    : `${
        o && o.weekly
          ? `<button type="button" class="btn ghost wide" data-action="toggle-cancel" data-id="${ev.id}" data-day="${day}">
               ${o.cancelled ? `Am ${D.formatShort(day)} findet es doch statt` : `Nur am ${D.formatShort(day)}: fällt aus`}</button>`
          : ''
      }
       <button type="button" class="btn danger wide" data-action="delete-event" data-id="${ev.id}">
         ${weekly ? 'Ganze Serie löschen' : 'Termin löschen'}</button>`;

  openSheet(
    isNew ? 'Neuer Termin' : 'Termin bearbeiten',
    inner,
    (f) => {
      const repeat = f.get('repeat');
      const wds = readWeekdays($('#sheet-root form'));
      if (repeat === 'weekly' && !wds.length) return toast('Bitte mindestens einen Wochentag wählen.');
      save('events', {
        id: ev.id,
        title: f.get('title').trim(),
        member_id: f.get('member_id') || null,
        date: repeat === 'once' ? f.get('date') || state.date : null,
        weekdays: repeat === 'weekly' ? wds : null,
        end_date: repeat === 'weekly' ? f.get('end_date') || null : null,
        start_time: f.get('start_time') || null,
        end_time: f.get('end_time') || null,
        location: f.get('location').trim() || null,
        needs_driver: f.get('needs_driver') === 'on',
        ...driverPatch('driver_to', f.get('driver_to')),
        ...driverPatch('driver_back', f.get('driver_back')),
        notes: f.get('notes').trim() || null,
      });
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
  updateDriverVisibility($('#sheet-root form'));
}

function updateDriverVisibility(form) {
  const box = form.querySelector('[data-driver]');
  const cb = form.querySelector('input[name="needs_driver"]');
  if (box && cb) box.hidden = !cb.checked;
}

function taskForm(t, day) {
  const isNew = !t;
  t ||= { assignee: null, due_date: day || state.date };
  const mode = t.weekdays?.length ? 'weekly' : t.due_date ? 'date' : 'none';
  const inner = `
    <label>Was?<input name="title" value="${esc(t.title || '')}" placeholder="z. B. Getränke bestellen" required /></label>
    <label>Wer?<select name="assignee">${memberOptions(t.assignee, { empty: '– egal / wer Zeit hat –' })}</select></label>
    ${repeatSwitch('repeat', mode, [
      ['none', 'Ohne Datum'],
      ['date', 'An einem Tag'],
      ['weekly', 'Jede Woche'],
    ])}
    <label data-show="date">Datum<input type="date" name="due_date" value="${esc(t.due_date || state.date)}" /></label>
    <div data-show="weekly">${weekdayPicker(t.weekdays || [D.isoWeekday(day || state.date)])}</div>
    <label class="check-line"><input type="checkbox" name="sofa" ${t.sofa ? 'checked' : ''}/> 🛋️ Im Sitzen machbar (Handy/Laptop/Telefon)</label>
    <label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`;

  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Aufgabe löschen</button>`;

  openSheet(
    isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten',
    inner,
    (f) => {
      const repeat = f.get('repeat');
      const wds = readWeekdays($('#sheet-root form'));
      if (repeat === 'weekly' && !wds.length) return toast('Bitte mindestens einen Wochentag wählen.');
      save('tasks', {
        id: t.id,
        title: f.get('title').trim(),
        assignee: f.get('assignee') || null,
        due_date: repeat === 'date' ? f.get('due_date') || state.date : null,
        weekdays: repeat === 'weekly' ? wds : null,
        sofa: f.get('sofa') === 'on',
        notes: f.get('notes').trim() || null,
        done_at: t.done_at ?? null,
      });
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
}

function memberForm(m) {
  const isNew = !m;
  m ||= { role: 'kind', drives: false, color: COLORS[members().length % COLORS.length], sort: members().length };
  const inner = `
    <label>Name<input name="name" value="${esc(m.name || '')}" required /></label>
    <label>Rolle<select name="role">${Object.entries(ROLES)
      .map(([k, l]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${l}</option>`)
      .join('')}</select></label>
    <label class="check-line"><input type="checkbox" name="drives" ${m.drives ? 'checked' : ''}/> 🚗 Kann gerade Auto fahren</label>
    <div class="colors">${COLORS.map(
      (c) => `<label><input type="radio" name="color" value="${c}" ${m.color === c ? 'checked' : ''}/><span style="background:${c}"></span></label>`
    ).join('')}</div>`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-member" data-id="${m.id}">Person entfernen</button>`;
  openSheet(
    isNew ? 'Neue Person' : 'Person bearbeiten',
    inner,
    (f) => {
      save('members', {
        id: m.id,
        name: f.get('name').trim(),
        role: f.get('role'),
        drives: f.get('drives') === 'on',
        color: f.get('color') || m.color,
        sort: m.sort ?? 0,
      });
      closeSheet();
    },
    extra
  );
}

function addChooser() {
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet chooser">
      <button class="btn big" data-action="new-event">📅 Termin</button>
      <button class="btn big" data-action="new-task">☑️ Aufgabe</button>
      <button class="btn ghost wide" data-action="close-sheet">Abbrechen</button>
    </div>`;
  document.body.classList.add('sheet-open');
}

/* ================= Ereignisse ================= */

const actions = {
  tab: (d) => {
    state.view = d.tab;
    if (d.tab === 'woche') state.weekStart = D.startOfWeek(state.date);
    window.scrollTo(0, 0);
    render();
  },
  'prev-day': () => changeDay(-1),
  'next-day': () => changeDay(1),
  'goto-today': () => {
    state.date = D.todayKey();
    render();
  },
  'pick-date': () => {
    const p = $('#date-picker');
    try {
      p.showPicker();
    } catch {
      p.focus();
      p.click();
    }
  },
  'prev-week': () => {
    state.weekStart = D.addDays(state.weekStart, -7);
    render();
  },
  'next-week': () => {
    state.weekStart = D.addDays(state.weekStart, 7);
    render();
  },
  'this-week': () => {
    state.weekStart = D.startOfWeek(D.todayKey());
    render();
  },
  'goto-week': () => actions.tab({ tab: 'woche' }),
  'goto-day': (d) => {
    state.date = d.day;
    state.view = 'heute';
    window.scrollTo(0, 0);
    render();
  },
  filter: (d) => {
    state.taskFilter = d.filter;
    lsSet('fo-filter', d.filter);
    render();
  },
  'toggle-task': (d) => toggleTask(d.id, d.day),
  'edit-task': (d) => taskForm(state.data.tasks.find((t) => t.id === d.id)),
  'edit-event': (d) => eventForm(state.data.events.find((e) => e.id === d.id), d.day),
  'edit-member': (d) => memberForm(member(d.id)),
  'new-event': () => eventForm(null, state.date),
  'new-task': () => taskForm(null, state.date),
  'new-member': () => memberForm(null),
  add: () => addChooser(),
  'close-sheet': () => closeSheet(),
  'toggle-cancel': (d) => {
    const o = eventsOn(d.day).find((x) => x.ev.id === d.id);
    if (o) setOccurrence(o, { cancelled: !o.cancelled });
    closeSheet();
  },
  'delete-event': (d) => {
    const ev = state.data.events.find((e) => e.id === d.id);
    if (!confirm(ev?.weekdays?.length ? 'Die ganze Serie löschen?' : 'Termin löschen?')) return;
    closeSheet();
    del('events', d.id);
  },
  'delete-task': (d) => {
    if (!confirm('Aufgabe löschen?')) return;
    closeSheet();
    del('tasks', d.id);
  },
  'delete-member': (d) => {
    if (!confirm('Person entfernen? Termine und Aufgaben bleiben erhalten.')) return;
    if (d.id === state.me) {
      state.me = null;
      lsSet('fo-me', null);
    }
    closeSheet();
    del('members', d.id);
  },
  'set-me': (d) => {
    state.me = d.id;
    lsSet('fo-me', d.id);
    render();
  },
  'toggle-item': (d) => {
    const i = state.data.shopping_items.find((x) => x.id === d.id);
    if (i) save('shopping_items', { id: i.id, done: !i.done });
  },
  'delete-item': (d) => del('shopping_items', d.id),
  'quick-add': (d) => {
    addItem(d.name, SHOPS.includes(d.shop) ? d.shop : 'Sonstiges');
    toast(`${d.name} hinzugefügt`);
  },
  'clear-done': async () => {
    const done = state.data.shopping_items.filter((i) => i.done);
    state.data.shopping_items = state.data.shopping_items.filter((i) => !i.done);
    render();
    try {
      for (const i of done) await store.remove('shopping_items', i.id);
    } catch (e) {
      fail(e);
    }
  },
  'copy-list': async (d) => {
    const text = state.data.shopping_items
      .filter((i) => !i.done && (SHOPS.includes(i.shop) ? i.shop : 'Sonstiges') === d.shop)
      .map((i) => i.name)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Liste kopiert.');
    } catch {
      prompt('Zum Kopieren:', text);
    }
  },
  logout: async () => {
    await store.signOut();
    state.session = null;
    state.data = null;
    render();
  },
};

function changeDay(n) {
  state.date = D.addDays(state.date, n);
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'date-picker' && el.value) {
    state.date = el.value;
    render();
    return;
  }
  if (el.dataset.change === 'driver') {
    const o = eventsOn(el.dataset.day).find((x) => x.ev.id === el.dataset.event);
    if (o) setOccurrence(o, driverPatch(el.dataset.field, el.value));
    return;
  }
  if (el.dataset.change === 'me') {
    state.me = el.value || null;
    lsSet('fo-me', state.me);
    render();
    return;
  }
  if (el.name === 'repeat') updateRepeatVisibility(el.form);
  if (el.name === 'needs_driver') updateDriverVisibility(el.form);
  if (el.form?.dataset.form === 'add-item' && el.name === 'shop') {
    state.shop = el.value;
    lsSet('fo-shop', el.value);
  }
});

// Essen speichern, sobald das Feld verlassen wird.
document.addEventListener(
  'blur',
  (e) => {
    const el = e.target;
    if (el.classList?.contains('meal-input')) {
      const text = el.value.trim();
      const existing = state.data.meals.find((m) => m.date === el.dataset.day);
      if ((existing?.text || '') !== text) save('meals', { date: el.dataset.day, text: text || null }, 'date', { quiet: true });
    }
    else if (state.pendingRender) setTimeout(render, 0);
  },
  true
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('meal-input')) {
    // In der Wochenansicht direkt zum nächsten Tag springen
    const all = [...document.querySelectorAll('#main .meal-input')];
    const next = all[all.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  }
  if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const f = new FormData(form);

  if (kind === 'sheet' && sheetSubmit) sheetSubmit(f);

  if (kind === 'add-item') {
    const name = f.get('name').trim();
    if (!name) return;
    const shop = f.get('shop');
    state.shop = shop;
    lsSet('fo-shop', shop);
    const input = form.querySelector('input[name="name"]');
    input.value = '';
    input.blur(); // sonst wird die Liste nicht neu gezeichnet
    addItem(name, shop); // zeichnet sofort neu
    $('#main form.add-item input[name="name"]')?.focus();
  }

  if (kind === 'login') {
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await store.signIn(f.get('email').trim(), f.get('password'));
      state.session = await store.getSession();
      await startData();
    } catch (err) {
      $('#login-error').textContent =
        err?.message === 'Invalid login credentials' ? 'E-Mail oder Passwort falsch.' : 'Anmeldung fehlgeschlagen.';
      btn.disabled = false;
    }
  }
});

// Wischen auf der Tagesansicht = Tag wechseln
let touch = null;
document.addEventListener(
  'touchstart',
  (e) => {
    if (state.view !== 'heute' || document.body.classList.contains('sheet-open')) return (touch = null);
    if (e.target.closest('select, input, textarea')) return (touch = null);
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  },
  { passive: true }
);
document.addEventListener(
  'touchend',
  (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) changeDay(dx < 0 ? 1 : -1);
  },
  { passive: true }
);

// Wieder geöffnet: aktuelle Daten holen. Nach längerer Pause zurück auf "Heute".
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    return;
  }
  if (state.hiddenAt && Date.now() - state.hiddenAt > 10 * 60 * 1000 && !document.body.classList.contains('sheet-open')) {
    state.date = D.todayKey();
    state.weekStart = D.startOfWeek(state.date);
    state.view = 'heute';
  }
  state.hiddenAt = null;
  if (!store.isCloud || state.session) reload();
});

/* ================= Erster Start ================= */

async function seedIfEmpty() {
  if (state.data.members.length) return;
  const ids = {};
  const people = [
    ['papa', 'Papa', 'erwachsen', false, COLORS[0]],
    ['mama', 'Mama', 'erwachsen', true, COLORS[1]],
    ['k12', 'Sohn (12)', 'kind', false, COLORS[3]],
    ['k9', 'Kind (9)', 'kind', false, COLORS[4]],
    ['k5', 'Kind (5)', 'kind', false, COLORS[5]],
  ];
  const rows = [];
  people.forEach(([key, name, role, drives, color], i) => {
    ids[key] = store.uuid();
    rows.push(['members', { id: ids[key], name, role, drives, color, sort: i }]);
  });
  rows.push(
    ['events', { id: store.uuid(), title: 'Schlagzeug', member_id: ids.k12, weekdays: [1], needs_driver: true, notes: 'Uhrzeit eintragen' }],
    ['events', { id: store.uuid(), title: 'Pickleball', member_id: ids.k12, weekdays: [3, 5], needs_driver: true, notes: 'Uhrzeit eintragen' }],
    ['events', { id: store.uuid(), title: 'Klavier', member_id: ids.k9, weekdays: [5], needs_driver: true, notes: 'Uhrzeit und Kind prüfen' }],
    ['tasks', { id: store.uuid(), title: 'Essensplan für nächste Woche machen', assignee: ids.papa, weekdays: [7], sofa: true }],
    ['tasks', { id: store.uuid(), title: 'Rewe-Lieferung bestellen', assignee: ids.papa, weekdays: [7], sofa: true }],
    ['tasks', { id: store.uuid(), title: 'Getränke bei Flaschenpost bestellen', assignee: ids.papa, sofa: true }]
  );
  for (const [table, row] of rows) {
    row.created_at = new Date().toISOString();
    state.data[table].push(row);
    await store.upsert(table, row);
  }
}

async function startData() {
  state.data = await store.loadAll();
  try {
    await seedIfEmpty();
  } catch (e) {
    console.error(e);
    toast('Startdaten konnten nicht angelegt werden.');
  }
  store.subscribe(debounce(() => reload(), 400));
  render();
}

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    if (store.isCloud) {
      await store.initCloud();
      state.session = await store.getSession();
      store.onAuthChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          state.session = null;
          state.data = null;
          render();
        } else if (session) {
          state.session = session;
        }
      });
      if (!state.session) return render();
    }
    await startData();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="center-screen"><h1>Ups</h1><p>Die App konnte nicht starten. Bitte Internetverbindung prüfen und neu laden.</p>
      <button class="btn primary" onclick="location.reload()">Neu laden</button></div>`;
  }
}

boot();

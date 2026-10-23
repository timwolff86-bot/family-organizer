import * as store from './store.js';
import * as D from './dates.js';
import { CATEGORIES, QUICK_DEFAULTS, categoryOf, classify, normalize, seedProducts } from './products.js';
import { RECIPE_CATEGORIES, SEED_RECIPES, STAPLES, recipeCategory } from './recipes.js';
import { STATES, holidayOn, refreshSchoolHolidays, schoolHolidayOn } from './holidays.js';

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
  taskFilter: lsGet('fo-filter') === 'meine' ? 'meine' : 'alle', // alle | meine
  hiddenAt: null,
  cal: lsGet('fo-cal') === 'monat' ? 'monat' : 'woche', // Kalender-Ansicht
  monthSel: D.todayKey(), // im Monat ausgewählter Tag
  land: lsGet('fo-land') ?? 'NW', // Bundesland für Ferien/Feiertage, '' = aus
  pendingRender: false,
};

// Darstellung: 'auto' (wie das Handy), 'light' oder 'dark'
function applyTheme(theme = lsGet('fo-theme') || 'auto') {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181b' : '#f6f4ef');
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

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
  const img = m.avatar ? `<img class="chip-av" src="${esc(m.avatar)}" alt="" />` : '';
  return `<span class="chip ${img ? 'with-av' : ''}" style="--c:${esc(m.color)}">${img}${esc(m.name)}</span>`;
}

// Profilbild oder farbiger Kreis mit Anfangsbuchstabe
function avatar(m, cls = '') {
  if (m?.avatar) return `<img class="av ${cls}" src="${esc(m.avatar)}" alt="" />`;
  return `<span class="av av-initial ${cls}" style="--c:${esc(m?.color || '#888')}">${esc((m?.name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

// Zuschnitt: Bild im runden Ausschnitt verschieben (ein Finger) und zoomen
// (zwei Finger oder Regler). Ergebnis: 160×160 JPEG als Text (ca. 5–10 KB),
// oder null bei Abbrechen.
function openCropper(file, outSize = 160) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden'));
    };
    img.onload = () => {
      const V = Math.min(window.innerWidth - 48, 320); // Größe des Ausschnitts in px
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const base = V / Math.min(w, h); // so groß, dass der Ausschnitt gefüllt ist
      const MAX = 5;
      let zoom = 1;
      let x = (V - w * base) / 2;
      let y = (V - h * base) / 2;

      const root = document.createElement('div');
      root.className = 'cropper';
      root.innerHTML = `
        <div class="crop-box">
          <strong>Bild zuschneiden</strong>
          <div class="crop-view" style="width:${V}px;height:${V}px">
            <img src="${url}" alt="" draggable="false" />
            <div class="crop-ring"></div>
          </div>
          <p class="muted small">Verschieben mit dem Finger, zoomen mit zwei Fingern oder dem Regler.</p>
          <input type="range" class="crop-zoom" min="1" max="${MAX}" step="0.01" value="1" aria-label="Zoom" />
          <div class="crop-buttons">
            <button type="button" class="btn ghost" data-crop="cancel">Abbrechen</button>
            <button type="button" class="btn primary" data-crop="ok">Übernehmen</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      const view = root.querySelector('.crop-view');
      const pic = root.querySelector('img');
      const slider = root.querySelector('.crop-zoom');

      const clamp = () => {
        const s = base * zoom;
        x = Math.min(0, Math.max(V - w * s, x));
        y = Math.min(0, Math.max(V - h * s, y));
      };
      const draw = () => {
        clamp();
        const s = base * zoom;
        pic.style.width = `${w * s}px`;
        pic.style.height = `${h * s}px`;
        pic.style.transform = `translate(${x}px, ${y}px)`;
        slider.value = zoom;
      };
      // Zoomen um einen Punkt (cx, cy) im Ausschnitt, damit dieser Punkt stehen bleibt
      const zoomTo = (z, cx = V / 2, cy = V / 2) => {
        z = Math.min(MAX, Math.max(1, z));
        const k = z / zoom;
        x = cx - (cx - x) * k;
        y = cy - (cy - y) * k;
        zoom = z;
        draw();
      };
      draw();

      const pointers = new Map();
      let pinch = null;
      const local = (e) => {
        const r = view.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      view.addEventListener('pointerdown', (e) => {
        view.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
        }
      });
      view.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        const now = local(e);
        pointers.set(e.pointerId, now);
        if (pointers.size === 1) {
          x += now.x - prev.x;
          y += now.y - prev.y;
          draw();
        } else if (pointers.size === 2 && pinch) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          zoomTo(pinch.zoom * (dist / pinch.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      });
      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
      };
      view.addEventListener('pointerup', up);
      view.addEventListener('pointercancel', up);
      view.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const p = local(e);
          zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 0.9), p.x, p.y);
        },
        { passive: false }
      );
      slider.addEventListener('input', () => zoomTo(Number(slider.value)));

      const finish = (result) => {
        root.remove();
        URL.revokeObjectURL(url);
        resolve(result);
      };
      root.querySelector('[data-crop="cancel"]').addEventListener('click', () => finish(null));
      root.querySelector('[data-crop="ok"]').addEventListener('click', () => {
        const s = base * zoom;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = outSize;
        canvas.getContext('2d').drawImage(img, -x / s, -y / s, V / s, V / s, 0, 0, outSize, outSize);
        finish(canvas.toDataURL('image/jpeg', 0.85));
      });
    };
    img.src = url;
  });
}

let toastTimer;
// Kurze Meldung unten. Mit action: Knopf (z. B. "Rückgängig"), bleibt dann etwas länger stehen.
function toast(msg, action = null) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  if (action) {
    el.querySelector('.toast-btn').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

// Löschen mit "Rückgängig": vorher alles merken, was mit verschwindet
async function removeWithUndo(table, ids, label) {
  ids = [].concat(ids);
  const snapshot = [[table, state.data[table].filter((r) => ids.includes(r.id))]];
  if (table === 'events') snapshot.push(['event_occurrences', state.data.event_occurrences.filter((o) => ids.includes(o.event_id))]);
  if (table === 'tasks') snapshot.push(['task_completions', state.data.task_completions.filter((c) => ids.includes(c.task_id))]);
  if (table === 'recipes') snapshot.push(['meals', state.data.meals.filter((m) => ids.includes(m.recipe_id))]);
  const copy = snapshot.map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]);

  state.data[table] = state.data[table].filter((r) => !ids.includes(r.id));
  render();
  const removal = (async () => {
    for (const id of ids) await store.remove(table, id);
  })();
  toast(label, {
    label: 'Rückgängig',
    run: async () => {
      try {
        await removal.catch(() => {}); // erst fertig löschen, dann wiederherstellen
        for (const [t, rows] of copy) if (rows.length) await store.upsertMany(t, rows, t === 'meals' ? 'date' : 'id');
      } catch (e) {
        console.error(e);
        toast('Wiederherstellen hat nicht geklappt.');
      }
      reload();
    },
  });
  try {
    await removal;
    await reload();
  } catch (e) {
    fail(e);
  }
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
    // Einmalige Termine können über mehrere Tage gehen (date … end_date)
    const hit = weekly
      ? ev.weekdays.includes(wd) && (!ev.end_date || ev.end_date >= day)
      : ev.date && ev.date <= day && (ev.end_date || ev.date) >= day;
    if (!hit) continue;
    const occ = state.data.event_occurrences.find((o) => o.event_id === ev.id && o.date === day);
    const multi = !weekly && ev.end_date && ev.end_date > ev.date;
    const o = { ev, occ, day, weekly, multi, cancelled: occ?.cancelled || false };
    o.time = timeLabel(o);
    // Sortierung: Ganztägiges oben, dann nach Uhrzeit
    o.sort = o.time === 'Ganztägig' || o.time.startsWith('bis') ? '' : D.hm(ev.start_time) || '';
    out.push(o);
  }
  // Ausgefallene Termine ans Ende
  return out.sort((a, b) => a.cancelled - b.cancelled || a.sort.localeCompare(b.sort) || a.ev.title.localeCompare(b.ev.title));
}

// Personen eines Termins (ältere Einträge haben nur member_id)
const eventPeople = (ev) => (ev.member_ids?.length ? ev.member_ids : ev.member_id ? [ev.member_id] : []);

// Uhrzeit-Text für einen Termin an einem bestimmten Tag
function timeLabel({ ev, day, multi }) {
  const start = D.hm(ev.start_time);
  const end = D.hm(ev.end_time);
  if (multi) {
    if (day === ev.date && start) return `ab ${start}`;
    if (day === ev.end_date && end) return `bis ${end}`;
    return ev.all_day ? 'Ganztägig' : '';
  }
  // Ohne Uhrzeit: nur "Ganztägig", wenn das ausdrücklich so eingetragen ist
  if (!start) return ev.all_day ? 'Ganztägig' : '';
  return end ? `${start}–${end}` : start;
}

// "Mo 26.10. – Fr 30.10. · Tag 2 von 5"
function rangeLabel({ ev, day }) {
  const total = Math.round((D.fromKey(ev.end_date) - D.fromKey(ev.date)) / 86400000) + 1;
  const n = Math.round((D.fromKey(day) - D.fromKey(ev.date)) / 86400000) + 1;
  return `${D.formatShort(ev.date)} – ${D.formatShort(ev.end_date)} · Tag ${n} von ${total}`;
}

function setOccurrence(o, patch) {
  const row = { event_id: o.ev.id, date: o.day, cancelled: o.cancelled, ...patch };
  if (o.occ) row.id = o.occ.id;
  return save('event_occurrences', row, 'event_id,date');
}

function eventCard(o) {
  const { ev } = o;
  const allDay = o.time === 'Ganztägig';
  // Farbstreifen in den Farben der beteiligten Personen
  const colors = eventPeople(ev).map((id) => member(id)?.color).filter(Boolean);
  const stripe = !colors.length || o.cancelled
    ? 'var(--line)'
    : colors.length === 1
      ? colors[0]
      : `linear-gradient(${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`;
  return `
    <article class="card event ${o.cancelled ? 'cancelled' : ''}">
      <button class="event-main" data-action="edit-event" data-id="${ev.id}" data-day="${o.day}">
        <span class="stripe" style="background:${stripe}"></span>
        <div class="body">
          ${
            o.cancelled
              ? `<div class="cancel-label">Fällt aus${allDay || !o.time ? '' : ` · ${esc(o.time)}`}</div>`
              : o.time
                ? `<div class="time-line ${allDay ? 'all-day' : ''}">${esc(o.time)}</div>`
                : ''
          }
          <div class="title">${esc(ev.title)} ${o.weekly ? '<span class="muted small">↻</span>' : ''}</div>
          <div class="meta">${chips(eventPeople(ev))}${ev.location ? `<span class="muted">📍 ${esc(ev.location)}</span>` : ''}</div>
          ${o.multi && !o.cancelled ? `<div class="muted small">📆 ${esc(rangeLabel(o))}</div>` : ''}
          ${ev.notes && !o.cancelled ? `<div class="muted small">${esc(ev.notes)}</div>` : ''}
        </div>
      </button>
    </article>`;
}

/* ================= Geburtstage ================= */

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Datum des Geburtstags in einem bestimmten Jahr (29.2. → 28.2. in Nicht-Schaltjahren)
function birthdayIn(b, year) {
  const d = b.month === 2 && b.day === 29 && !isLeap(year) ? 28 : b.day;
  return `${year}-${D.pad(b.month)}-${D.pad(d)}`;
}
const birthdaysOn = (day) => (state.data.birthdays || []).filter((b) => birthdayIn(b, Number(day.slice(0, 4))) === day);

// Nächster Geburtstag ab einem Tag (heute zählt mit)
function nextBirthday(b, from = D.todayKey()) {
  const y = Number(from.slice(0, 4));
  const thisYear = birthdayIn(b, y);
  return thisYear >= from ? thisYear : birthdayIn(b, y + 1);
}
const ageOn = (b, day) => (b.year ? Number(day.slice(0, 4)) - b.year : null);
const birthdayText = (b, day) => {
  const age = ageOn(b, day);
  return `${b.name} hat Geburtstag${age ? ` (${age})` : ''}`;
};

/* ================= Aufgaben ================= */

const doneKey = (t) => (t.done_at ? D.toKey(new Date(t.done_at)) : null);
const isReminder = (t) => t.kind === 'erinnerung';

// Erinnerungen sind persönlich: sichtbar für die Personen, für die sie sind,
// und für den, der sie angelegt hat. Ohne Personen = für alle.
const canSeeReminder = (t) =>
  !state.me || !peopleOf(t).length || peopleOf(t).includes(state.me) || t.created_by === state.me;
// Eine oder mehrere Personen (ältere Einträge haben nur "assignee")
const peopleOf = (t) => (t.assignees?.length ? t.assignees : t.assignee ? [t.assignee] : []);
const chips = (ids) => ids.map((id) => chip(id)).join('');

// Wiederholung: 'weekly' | 'biweekly' | 'monthly' | 'yearly' (ältere Einträge: nur weekdays = wöchentlich)
const rhythmOf = (t) => t.repeat || (t.weekdays?.length ? 'weekly' : null);
const isRecurring = (t) => !!rhythmOf(t);
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

function occursOn(t, day) {
  const r = rhythmOf(t);
  const from = t.repeat_from;
  if (from && day < from) return false;
  const [y, m, d] = day.split('-').map(Number);
  if (r === 'weekly') return t.weekdays?.includes(D.isoWeekday(day));
  if (r === 'biweekly') {
    if (!t.weekdays?.includes(D.isoWeekday(day))) return false;
    if (!from) return true;
    const weeks = Math.round((D.fromKey(D.startOfWeek(day)) - D.fromKey(D.startOfWeek(from))) / (7 * 86400000));
    return weeks % 2 === 0;
  }
  if (!from) return false;
  const [, fm, fd] = from.split('-').map(Number);
  if (r === 'monthly') return d === Math.min(fd, daysInMonth(y, m));
  if (r === 'yearly') return m === fm && d === Math.min(fd, daysInMonth(y, m));
  return false;
}

function rhythmText(t) {
  const r = rhythmOf(t);
  const wd = () => [...(t.weekdays || [])].sort().map((x) => D.WD_SHORT[x - 1]).join(', ');
  const fd = t.repeat_from ? D.fromKey(t.repeat_from) : null;
  if (r === 'weekly') return wd();
  if (r === 'biweekly') return `alle 2 Wochen ${wd()}`;
  if (r === 'monthly') return `monatlich am ${fd?.getDate()}.`;
  if (r === 'yearly') return `jährlich am ${fd?.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}`;
  return '';
}

// kind: 'aufgabe' oder 'erinnerung'
function tasksOn(day, { filter = true, kind = 'aufgabe' } = {}) {
  const today = D.todayKey();
  const out = [];
  for (const t of state.data.tasks) {
    if ((t.kind || 'aufgabe') !== kind) continue;
    if (kind === 'erinnerung' && !canSeeReminder(t)) continue;
    if (isRecurring(t)) {
      if (occursOn(t, day)) {
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
  if (filter && state.taskFilter === 'meine') list = list.filter((x) => peopleOf(x.t).includes(state.me));
  return list.sort(
    (a, b) =>
      a.done - b.done ||
      !!b.overdue - !!a.overdue ||
      (a.t.due_time || '99').localeCompare(b.t.due_time || '99') ||
      a.t.title.localeCompare(b.t.title)
  );
}

function toggleTask(taskId, day) {
  const t = state.data.tasks.find((x) => x.id === taskId);
  if (!t) return;
  if (isRecurring(t)) {
    const c = state.data.task_completions.find((x) => x.task_id === t.id && x.date === day);
    if (c) del('task_completions', c.id);
    else save('task_completions', { task_id: t.id, date: day }, 'task_id,date');
  } else {
    const done = !t.done_at;
    save('tasks', { id: t.id, done_at: done ? new Date().toISOString() : null, done_by: done ? state.me || null : null });
  }
}

// Erinnerung, deren Uhrzeit heute schon vorbei ist
function isLate(x) {
  if (x.done || !x.t.due_time || x.day !== D.todayKey() || x.overdue) return false;
  const now = new Date();
  return D.hm(x.t.due_time) <= `${D.pad(now.getHours())}:${D.pad(now.getMinutes())}`;
}

function taskRow(x) {
  const { t } = x;
  const by = x.done && t.done_by && member(t.done_by);
  const badges = [
    isReminder(t) && state.view === 'person' ? '<span class="tag time">🔔</span>' : '',
    t.due_time ? `<span class="tag time ${isLate(x) ? 'red' : ''}">🕑 ${D.hm(t.due_time)}</span>` : '',
    x.overdue ? `<span class="tag red">seit ${esc(D.formatDayMonth(t.due_date))}</span>` : '',
    x.recurring ? '<span class="muted small">↻</span>' : '',
  ].join('');
  return `
    <li class="task ${x.done ? 'done' : ''}">
      <button class="check" data-action="toggle-task" data-id="${t.id}" data-day="${x.day}" aria-label="Erledigt">
        ${x.done ? '✓' : ''}
      </button>
      <button class="task-main" data-action="edit-task" data-id="${t.id}">
        <span class="title">${esc(t.title)}</span>
        <span class="meta">${badges}${chips(peopleOf(t))}${by ? `<span class="muted small">✓ ${esc(by.name)}</span>` : ''}</span>
      </button>
    </li>`;
}

/* ================= Ansichten ================= */

function viewHeute() {
  const day = state.date;
  const isToday = day === D.todayKey();
  const events = eventsOn(day);
  const tasks = tasksOn(day);
  const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' });
  const meal = state.data.meals.find((m) => m.date === day);

  const filters = [
    ['alle', 'Alle'],
    ['meine', 'Meine'],
  ];
  const allTasks = tasksOn(day, { filter: false });
  const activeEvents = events.filter((o) => !o.cancelled);
  const openReminders = reminders.filter((x) => !x.done).length;
  const openTasks = allTasks.filter((x) => !x.done).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bdays = birthdaysOn(day);
  const holiday = holidayOn(day, state.land);
  const ferien = schoolHolidayOn(day, state.land);
  const summary = [
    bdays.length ? plural(bdays.length, 'Geburtstag', 'Geburtstage') : '',
    activeEvents.length ? plural(activeEvents.length, 'Termin', 'Termine') : '',
    openReminders ? plural(openReminders, 'Erinnerung', 'Erinnerungen') : '',
    openTasks ? plural(openTasks, 'Aufgabe', 'Aufgaben') : '',
  ].filter(Boolean);

  return `
    ${summary.length ? `<p class="day-summary">${summary.join(' · ')}</p>` : ''}
    <div class="family-strip">
      ${[...members()]
        .sort((a, b) => (b.id === state.me) - (a.id === state.me)) // ich zuerst
        .map(
          (m) => `<button class="${m.id === state.me ? 'me' : ''}" data-action="open-person" data-id="${m.id}">
            <span class="av-wrap">${avatar(m)}${m.id === state.me ? '<span class="me-badge">Du</span>' : ''}</span>
            <span class="fs-name">${esc(m.name)}</span></button>`
        )
        .join('')}
    </div>
    ${
      bdays.length || holiday || ferien
        ? `<p class="bd-line">${[
            holiday ? `<span class="day-note">🎉 ${esc(holiday.name)} <span class="muted">(Feiertag)</span></span>` : '',
            ferien ? `<span class="day-note">🏖️ ${esc(ferien.name)} <span class="muted">bis ${D.formatShort(ferien.end)}</span></span>` : '',
            ...bdays.map((b) => `<button class="link" data-action="edit-birthday" data-id="${b.id}">🎂 ${esc(birthdayText(b, day))}</button>`),
          ]
            .filter(Boolean)
            .join('<br />')}</p>`
        : ''
    }
    ${
      reminders.length
        ? `<section>
            <div class="section-head"><h2>🔔 Erinnerungen</h2><button class="link" data-action="new-reminder">+ Erinnerung</button></div>
            <ul class="tasks card reminders">${reminders.map(taskRow).join('')}</ul>
          </section>`
        : ''
    }
    ${events.length ? `<section><h2>Termine</h2>${events.map(eventCard).join('')}</section>` : ''}

    <section>
      <h2>Essen</h2>
      ${mealField(meal, day, `Was gibt es ${isToday ? 'heute' : 'an diesem Tag'}?`, 'done', 'card meal')}
      ${
        mealRecipe(meal)
          ? `<div class="meal-actions">
              <button class="link" data-action="open-recipe" data-id="${meal.recipe_id}">📖 Rezept ansehen</button>
              <button class="link" data-action="ingredients" data-ids="${meal.recipe_id}">🛒 Zutaten auf die Liste</button>
            </div>`
          : ''
      }
    </section>

    ${allTasks.length ? `<section>
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
          ? '<p class="empty">Unter „Einstellungen“ auswählen, wer du bist.</p>'
          : tasks.length
            ? `<ul class="tasks card">${tasks.map(taskRow).join('')}</ul>`
            : '<p class="empty">Keine eigenen Aufgaben.</p>'
      }
    </section>` : ''}`;
}

// Übersicht einer Person: alles der nächsten 14 Tage
function viewPerson() {
  const id = state.personId;
  const today = D.todayKey();
  const mine = (ids) => ids.includes(id);
  let counts = { events: 0, reminders: 0, tasks: 0 };
  const days = [];
  for (let i = 0; i < 14; i++) {
    const day = D.addDays(today, i);
    const events = eventsOn(day).filter((o) => mine(eventPeople(o.ev)));
    const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => mine(peopleOf(x.t)));
    const tasks = tasksOn(day, { filter: false }).filter((x) => mine(peopleOf(x.t)));
    if (!events.length && !reminders.length && !tasks.length) continue;
    counts.events += events.length;
    counts.reminders += reminders.filter((x) => !x.done).length;
    counts.tasks += tasks.filter((x) => !x.done).length;
    days.push({ day, events, items: [...reminders, ...tasks] });
  }
  const label = (day) => {
    const rel = D.relativeLabel(day);
    return ['Heute', 'Morgen', 'Übermorgen'].includes(rel) ? `${rel} · ${D.formatShort(day)}` : D.formatLong(day);
  };
  return `
    <div class="person-stats">
      <div><b>${counts.events}</b><span>Termine</span></div>
      <div><b>${counts.reminders}</b><span>Erinnerungen</span></div>
      <div><b>${counts.tasks}</b><span>Aufgaben</span></div>
    </div>
    <p class="muted small center">Die nächsten 14 Tage</p>
    ${
      days.length
        ? days
            .map(
              (d) => `<section>
                <h2>${esc(label(d.day))}</h2>
                ${d.events.map(eventCard).join('')}
                ${d.items.length ? `<ul class="tasks card">${d.items.map(taskRow).join('')}</ul>` : ''}
              </section>`
            )
            .join('')
        : '<p class="empty center">Keine Einträge.</p>'
    }`;
}

function viewWoche() {
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(state.weekStart, i));
  const today = D.todayKey();
  // Ferien dieser Woche einmal oben anzeigen
  const ferien = [...new Map(days.map((d) => schoolHolidayOn(d, state.land)).filter(Boolean).map((f) => [f.start, f])).values()];
  return ferien
    .map((f) => `<p class="week-ferien">🏖️ ${esc(f.name)} <span class="muted">${D.formatShort(f.start)} – ${D.formatShort(f.end)}</span></p>`)
    .join('') + days
    .map((day) => {
      const events = eventsOn(day);
      const tasks = tasksOn(day, { filter: false }).filter((x) => !x.undated && !x.overdue);
      const open = tasks.filter((x) => !x.done).length;
      const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue);
      const bdays = birthdaysOn(day);
      const holiday = holidayOn(day, state.land);
      const meal = state.data.meals.find((m) => m.date === day);
      return `
        <div class="card week-day ${day === today ? 'today' : ''}">
          <button class="week-top" data-action="goto-day" data-day="${day}">
          <div class="wd">
            <strong>${D.WD_SHORT[D.isoWeekday(day) - 1]}</strong>
            <span>${D.fromKey(day).getDate()}.</span>
          </div>
          <div class="body">
            ${holiday ? `<div class="wline hol">🎉 ${esc(holiday.name)}</div>` : ''}
            ${bdays.map((b) => `<div class="wline bd">🎂 ${esc(birthdayText(b, day))}</div>`).join('')}
            ${
              events.length
                ? events
                    .map(
                      (o) => `<div class="wline ${o.cancelled ? 'cancelled' : ''}">
                        ${o.time ? `<span class="muted">${o.time === 'Ganztägig' ? (o.multi ? '📆' : 'ganzt.') : esc(o.time)}</span>` : o.multi ? '<span class="muted">📆</span>' : ''}
                        ${esc(o.ev.title)} ${chips(eventPeople(o.ev))}
                      </div>`
                    )
                    .join('')
                : bdays.length || holiday
                  ? ''
                  : '<div class="muted small">Keine Termine</div>'
            }
            ${reminders
              .map(
                (x) => `<div class="wline small ${x.done ? 'cancelled' : ''}">🔔 ${x.t.due_time ? `${D.hm(x.t.due_time)} ` : ''}${esc(x.t.title)} ${chips(peopleOf(x.t))}</div>`
              )
              .join('')}
            ${open ? `<div class="wline small muted">☐ ${open} ${open === 1 ? 'Aufgabe' : 'Aufgaben'}</div>` : ''}
          </div>
          </button>
          ${mealField(meal, day, 'Essen eintragen', 'next', 'week-meal')}
        </div>`;
    })
    .join('');
}

// Monatsansicht: Raster mit Punkten, KW-Spalte, darunter die Einträge des gewählten Tags
function viewMonat() {
  const sel = state.monthSel;
  const today = D.todayKey();
  const first = `${sel.slice(0, 7)}-01`;
  const monthNo = sel.slice(5, 7);
  let start = D.startOfWeek(first);
  const rows = [];
  while (rows.length < 6) {
    rows.push(start);
    start = D.addDays(start, 7);
    if (start.slice(5, 7) !== monthNo) break;
  }
  const dotsFor = (day) => {
    const dots = [];
    for (const o of eventsOn(day)) if (!o.cancelled) dots.push(member(eventPeople(o.ev)[0])?.color || 'var(--muted)');
    const rem = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue && !x.undated).length;
    const tsk = tasksOn(day, { filter: false }).filter((x) => !x.overdue && !x.undated).length;
    const bd = birthdaysOn(day).length;
    return [
      ...dots.slice(0, 3).map((c) => `<i style="background:${esc(c)}"></i>`),
      rem || tsk ? '<i class="dot-task"></i>' : '',
      bd ? '<i class="dot-bd"></i>' : '',
    ].join('');
  };
  const grid = `
    <div class="month">
      <div class="m-head"><span></span>${D.WD_SHORT.map((w) => `<span>${w}</span>`).join('')}</div>
      ${rows
        .map(
          (ws) => `<div class="m-row">
            <button class="m-kw" data-action="open-week" data-week="${ws}" aria-label="Woche öffnen">${D.isoWeekNumber(ws)}</button>
            ${Array.from({ length: 7 }, (_, i) => D.addDays(ws, i))
              .map(
                (day) => `<button class="m-day ${day.slice(5, 7) !== monthNo ? 'other' : ''} ${day === today ? 'today' : ''} ${day === sel ? 'sel' : ''}
                  ${holidayOn(day, state.land) ? 'hol' : ''} ${schoolHolidayOn(day, state.land) ? 'ferien' : ''}" data-action="month-day" data-day="${day}">
                  <span class="m-num">${D.fromKey(day).getDate()}</span>
                  <span class="m-dots">${dotsFor(day)}</span>
                </button>`
              )
              .join('')}
          </div>`
        )
        .join('')}
    </div>`;
  return grid + monthAgenda(sel);
}

// Einträge eines Tages, jeder direkt antippbar
function monthAgenda(day) {
  const events = eventsOn(day);
  const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue && !x.undated);
  const tasks = tasksOn(day, { filter: false }).filter((x) => !x.overdue && !x.undated);
  const meal = state.data.meals.find((m) => m.date === day);
  const holiday = holidayOn(day, state.land);
  const ferien = schoolHolidayOn(day, state.land);
  const notes = [
    holiday ? `<div class="ag-note">🎉 ${esc(holiday.name)}</div>` : '',
    ferien ? `<div class="ag-note">🏖️ ${esc(ferien.name)}</div>` : '',
    ...birthdaysOn(day).map((b) => `<button class="ag-note link" data-action="edit-birthday" data-id="${b.id}">🎂 ${esc(birthdayText(b, day))}</button>`),
  ].join('');
  const items = [...reminders, ...tasks];
  const empty = !events.length && !items.length && !meal?.text && !notes;
  return `
    <section class="agenda">
      <div class="section-head">
        <h2>${esc(D.formatLong(day))}</h2>
        <button class="link" data-action="goto-day" data-day="${day}">Tag öffnen ›</button>
      </div>
      ${notes}
      ${events
        .map(
          (o) => `<button class="card ag-event ${o.cancelled ? 'cancelled' : ''}" data-action="edit-event" data-id="${o.ev.id}" data-day="${day}">
            <span class="ag-time">${esc(o.time)}</span>
            <span class="ag-title">${esc(o.ev.title)}</span>
            <span class="meta">${chips(eventPeople(o.ev))}</span>
          </button>`
        )
        .join('')}
      ${items.length ? `<ul class="tasks card">${items.map(taskRow).join('')}</ul>` : ''}
      ${
        meal?.text
          ? `<button class="card ag-event" data-action="${meal.recipe_id ? 'open-recipe' : 'pick-recipe'}" data-id="${meal.recipe_id || ''}" data-day="${day}">
              <span class="ag-time">🍽️</span><span class="ag-title">${esc(meal.text)}</span></button>`
          : ''
      }
      ${empty ? '<p class="empty">Nichts eingetragen.</p>' : ''}
    </section>`;
}

// Wochenansicht: oben ein Knopf für alle Zutaten der geplanten Gerichte
function weekIngredientsButton() {
  const ids = Array.from({ length: 7 }, (_, i) => D.addDays(state.weekStart, i))
    .map((day) => mealRecipe(state.data.meals.find((m) => m.date === day))?.id)
    .filter(Boolean);
  if (!ids.length) return '';
  return `<button class="btn ghost wide week-shop" data-action="ingredients" data-ids="${ids.join(',')}">
    🛒 Zutaten für ${ids.length} ${ids.length === 1 ? 'Gericht' : 'Gerichte'} dieser Woche auf die Liste</button>`;
}

/* ================= Essen & Kochbuch ================= */

const mealRecipe = (meal) => (meal?.recipe_id ? state.data.recipes.find((r) => r.id === meal.recipe_id) : null);
const recipeEmoji = (r) => r?.emoji || recipeCategory(r?.category).emoji;

// Eingabefeld fürs Essen + Knopf "aus dem Kochbuch wählen"
function mealField(meal, day, placeholder, enter, cls) {
  const r = mealRecipe(meal);
  return `
    <div class="${cls}">
      <span class="meal-icon">${r ? recipeEmoji(r) : '🍽️'}</span>
      <input class="meal-input" ${cls.includes('card') ? 'id="meal-input"' : ''} data-day="${day}" list="recipe-list"
        value="${esc(meal?.text || '')}" placeholder="${esc(placeholder)}" enterkeyhint="${enter}" autocomplete="off" />
      <button class="icon-btn book" data-action="pick-recipe" data-day="${day}" aria-label="Aus dem Kochbuch wählen">📖</button>
    </div>`;
}

const recipeList = () =>
  `<datalist id="recipe-list">${state.data.recipes.map((r) => `<option value="${esc(r.title)}"></option>`).join('')}</datalist>`;

const sortedRecipes = () =>
  [...state.data.recipes].sort((a, b) => b.favorite - a.favorite || a.title.localeCompare(b.title));

const isStaple = (line) => {
  const words = normalize(line).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => STAPLES.has(w));
};

const recipeMeta = (r) =>
  [r.minutes ? `⏱ ${r.minutes} Min.` : '', r.servings ? `👥 ${r.servings}` : '', recipeCategory(r.category).label]
    .filter(Boolean)
    .join(' · ');

function recipeRow(r, action = 'open-recipe', extra = '') {
  return `
    <li><button class="recipe-row" data-action="${action}" data-id="${r.id}" ${extra} data-search="${esc(r.title.toLowerCase())}">
      <span class="recipe-emoji">${recipeEmoji(r)}</span>
      <span class="grow-col">
        <span class="title">${esc(r.title)} ${r.favorite ? '⭐' : ''}</span>
        <span class="muted small">${esc(recipeMeta(r))}</span>
      </span>
    </button></li>`;
}

function viewKochbuch() {
  if (state.data.missing?.includes('recipes')) {
    return '<div class="banner">Datenbank-Update nötig: bitte supabase/update-5.sql in Supabase ausführen.</div>';
  }
  const f = state.recipeFilter || 'alle';
  const filters = [
    ['alle', 'Alle'],
    ['fav', '⭐ Favoriten'],
    ['eigene', '✍️ Eigene'],
    ...RECIPE_CATEGORIES.map((c) => [c.id, `${c.emoji} ${c.label}`]),
  ];
  const list = sortedRecipes().filter((r) =>
    f === 'alle' ? true : f === 'fav' ? r.favorite : f === 'eigene' ? r.own : r.category === f
  );
  return `
    <div class="card add-item">
      <input type="search" id="recipe-search" placeholder="Gericht suchen …" autocomplete="off" />
      <button class="btn primary" data-action="new-recipe" aria-label="Eigenes Gericht">+</button>
    </div>
    <div class="chip-row">${filters
      .map(([k, l]) => `<button class="filter-chip ${f === k ? 'on' : ''}" data-action="recipe-filter" data-filter="${k}">${l}</button>`)
      .join('')}</div>
    ${
      list.length
        ? `<ul class="card list recipes" id="recipe-list-ul">${list.map((r) => recipeRow(r)).join('')}</ul>`
        : `<p class="empty">${f === 'eigene' ? 'Noch keine eigenen Gerichte – mit ＋ anlegen.' : 'Keine Gerichte gefunden.'}</p>`
    }
    <button class="btn ghost wide" data-action="new-recipe">✍️ Eigenes Gericht anlegen</button>`;
}

// Eigene Sheets ohne "Sichern" (Detail, Auswahl, Zutaten)
function openPanel(title, inner, right = '') {
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet full" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <span class="grabber" aria-hidden="true"></span>
        <button type="button" class="link" data-action="close-sheet">Schließen</button>
        <strong>${esc(title)}</strong>
        <span>${right}</span>
      </div>
      <div class="sheet-body">${inner}</div>
    </div>`;
  document.body.classList.add('sheet-open');
}

function recipeDetail(r) {
  const steps = (r.steps || '').split('\n').filter((x) => x.trim());
  openPanel(
    r.title,
    `
    <div class="recipe-head">
      <span class="recipe-emoji big">${recipeEmoji(r)}</span>
      <div>
        <div class="muted small">${esc(recipeMeta(r))}</div>
        <button class="link" data-action="toggle-fav" data-id="${r.id}">${r.favorite ? '⭐ Favorit' : '☆ Als Favorit merken'}</button>
      </div>
    </div>

    <div class="plan-row card">
      <span>📅</span>
      <input type="date" id="plan-date" value="${state.date}" />
      <button class="btn primary" data-action="plan-recipe" data-id="${r.id}">Einplanen</button>
    </div>

    <h3>Zutaten <span class="muted small">(für ${r.servings || 4} Personen)</span></h3>
    ${ingredientChecklist([r])}
    <button class="btn primary wide" data-action="add-ingredients">🛒 Ausgewählte auf die Einkaufsliste</button>

    ${steps.length ? `<h3>Zubereitung</h3><ol class="steps">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}`,
    `<button class="link strong" data-action="edit-recipe" data-id="${r.id}">Bearbeiten</button>`
  );
}

// Zutaten zum Ankreuzen. Vorrat (Salz, Öl …) und schon Eingekauftes ist nicht vorausgewählt.
function ingredientChecklist(recipes) {
  const open = new Set(state.data.shopping_items.filter((i) => !i.done).map((i) => normalize(i.name)));
  return recipes
    .map(
      (r) => `
      ${recipes.length > 1 ? `<div class="field-label">${recipeEmoji(r)} ${esc(r.title)}</div>` : ''}
      <ul class="card ing-list">
        ${(r.ingredients || [])
          .map((line) => {
            const onList = open.has(normalize(line));
            const checked = !onList && !isStaple(line);
            return `<li><label>
              <input type="checkbox" name="ing" value="${esc(line)}" ${checked ? 'checked' : ''} />
              <span>${esc(line)}</span>
              ${onList ? '<span class="muted small">schon auf der Liste</span>' : isStaple(line) ? '<span class="muted small">Vorrat?</span>' : ''}
            </label></li>`;
          })
          .join('')}
      </ul>`
    )
    .join('');
}

function ingredientsPanel(ids) {
  const recipes = ids.map((id) => state.data.recipes.find((r) => r.id === id)).filter(Boolean);
  if (!recipes.length) return;
  openPanel(
    'Zutaten einkaufen',
    `${ingredientChecklist(recipes)}
     <button class="btn primary wide" data-action="add-ingredients">🛒 Ausgewählte auf die Einkaufsliste</button>`
  );
}

function recipePicker(day) {
  openPanel(
    `Essen am ${D.formatShort(day)}`,
    `
    <input type="search" id="recipe-search" placeholder="Gericht suchen …" autocomplete="off" />
    <ul class="card list recipes" id="recipe-list-ul">
      ${sortedRecipes().map((r) => recipeRow(r, 'choose-recipe', `data-day="${day}"`)).join('')}
    </ul>
    <button class="btn ghost wide" data-action="new-recipe">✍️ Neues Gericht anlegen</button>
    ${state.data.meals.find((m) => m.date === day)?.text ? `<button class="btn danger wide" data-action="clear-meal" data-day="${day}">Essen für diesen Tag entfernen</button>` : ''}`
  );
}

function setMeal(day, recipe) {
  const existing = state.data.meals.find((m) => m.date === day);
  const row = { date: day, text: recipe ? recipe.title : null };
  if (recipe || existing?.recipe_id) row.recipe_id = recipe?.id || null;
  save('meals', row, 'date');
}

function recipeForm(r) {
  const isNew = !r;
  r ||= { category: 'sonstiges', servings: 4, ingredients: [], own: true };
  const inner = `
    <label>Name des Gerichts<input name="title" value="${esc(r.title || '')}" required placeholder="z. B. Omas Gulasch" /></label>
    <label>Kategorie<select name="category">${RECIPE_CATEGORIES.map(
      (c) => `<option value="${c.id}" ${c.id === r.category ? 'selected' : ''}>${c.emoji} ${c.label}</option>`
    ).join('')}</select></label>
    <label>Zutaten <span class="muted small">– eine pro Zeile, Menge vorne (z. B. „500 g Hackfleisch“)</span>
      <textarea name="ingredients" rows="8">${esc((r.ingredients || []).join('\n'))}</textarea></label>
    <label>Zubereitung <span class="muted small">– ein Schritt pro Zeile</span>
      <textarea name="steps" rows="6">${esc(r.steps || '')}</textarea></label>
    ${moreOptions(
      `<div class="row">
        <label class="emoji-field">Symbol<input name="emoji" value="${esc(r.emoji || '')}" placeholder="${recipeCategory(r.category).emoji}" maxlength="4" /></label>
        <label>Dauer (Min.)<input type="number" name="minutes" min="0" inputmode="numeric" value="${esc(r.minutes ?? '')}" /></label>
        <label>Personen<input type="number" name="servings" min="1" inputmode="numeric" value="${esc(r.servings ?? '')}" /></label>
      </div>
      <label class="check-line"><input type="checkbox" name="favorite" ${r.favorite ? 'checked' : ''}/> ⭐ Favorit</label>`,
      !isNew && r.own
    )}`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-recipe" data-id="${r.id}">Gericht löschen</button>`;
  openSheet(
    isNew ? 'Neues Gericht' : 'Gericht bearbeiten',
    inner,
    (f) => {
      const num = (k) => (f.get(k) ? Number(f.get(k)) : null);
      const saved = save('recipes', {
        id: r.id,
        title: f.get('title').trim(),
        emoji: f.get('emoji').trim() || null,
        category: f.get('category'),
        minutes: num('minutes'),
        servings: num('servings'),
        ingredients: f.get('ingredients').split('\n').map((x) => x.trim()).filter(Boolean),
        steps: f.get('steps').trim() || null,
        favorite: f.get('favorite') === 'on',
        own: r.own ?? true,
      });
      closeSheet();
      // Gerade angelegtes/geändertes Gericht direkt anzeigen
      saved.then((row) => row && recipeDetail(state.data.recipes.find((x) => x.id === row.id) || row));
    },
    extra
  );
}

/* ================= Einkauf ================= */

const productKey = (name) => normalize(name);
const findProduct = (name) => state.data.products.find((p) => p.key === productKey(name));
const itemCategory = (i) => i.category || classify(i.name, state.data.products);

// Häufig gekaufte Artikel (gemeinsam über die Datenbank) + Klassiker
function quickItems() {
  const open = new Set(state.data.shopping_items.filter((i) => !i.done).map((i) => productKey(i.name)));
  const used = [...state.data.products].filter((p) => p.uses > 0).sort((a, b) => b.uses - a.uses);
  const all = [...used.map((p) => p.name), ...QUICK_DEFAULTS];
  const seen = new Set();
  const out = [];
  for (const name of all) {
    const key = productKey(name);
    if (!key || seen.has(key) || open.has(key)) continue;
    seen.add(key);
    out.push({ name, category: classify(name, state.data.products) });
    if (out.length >= 10) break;
  }
  return out;
}

// Produkt im Katalog merken bzw. Zähler erhöhen (für Schnelltasten und Lernen)
function rememberProduct(name, category, { countUse = true } = {}) {
  if (state.data.missing?.includes('products')) return;
  const key = productKey(name);
  if (!key) return;
  const p = findProduct(name);
  save(
    'products',
    { key, name: p?.name || name, category: category || p?.category || 'sonstiges', uses: (p?.uses || 0) + (countUse ? 1 : 0) },
    'key',
    { quiet: true }
  );
}

// "2 kg Äpfel" → { amount: '2 kg', name: 'Äpfel' }
const AMOUNT_RE =
  /^(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+)?\s*(?:x|kg|g|gr|l|ml|el|tl|stk\.?|stück|pck\.?|packung(?:en)?|pkg|flaschen?|kisten?|kasten|dosen?|becher|bund|beutel|gläser|glas|tüten?|rollen?|scheiben?|prisen?|päckchen|zehen?|stangen?)?\.?)\s+(.+)$/i;
function splitAmount(text) {
  const m = String(text).trim().match(AMOUNT_RE);
  return m ? { amount: m[1].trim(), name: m[2].trim() } : { amount: null, name: String(text).trim() };
}

function addItem(text, { countUse = true } = {}) {
  const { name, amount } = splitAmount(text);
  const category = classify(name, state.data.products);
  save('shopping_items', { name, category, done: false, ...(amount ? { amount } : {}) });
  if (countUse) rememberProduct(name, category);
}

// Vorschläge beim Tippen: Produkte aus dem Katalog, Treffer am Wortanfang zuerst
function suggestions(text) {
  const q = normalize(splitAmount(text).name);
  if (q.length < 2) return [];
  const open = new Set(state.data.shopping_items.filter((i) => !i.done).map((i) => normalize(i.name)));
  const scored = [];
  const seen = new Set();
  for (const p of state.data.products) {
    if (seen.has(p.key) || open.has(p.key)) continue;
    const i = p.key.indexOf(q);
    if (i < 0) continue;
    seen.add(p.key);
    const wordStart = i === 0 || p.key[i - 1] === ' ' || p.key[i - 1] === '-';
    scored.push({ p, score: (i === 0 ? 0 : wordStart ? 1 : 2) * 1000 - (p.uses || 0) * 10 + p.key.length });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((x) => x.p);
}

function renderSuggestions(text) {
  const box = $('#suggest');
  if (!box) return;
  const list = suggestions(text);
  const { amount, name } = splitAmount(text);
  // "Sonstiges" nicht anzeigen, solange noch passende Vorschläge kommen (Wort halb getippt)
  const unknown = classify(name, state.data.products) === 'sonstiges';
  const hint = unknown && list.length ? '' : categoryHint(name);
  const parts = [hint ? `→ ${esc(hint)}` : '', amount ? `Menge: ${esc(amount)}` : ''].filter(Boolean);
  box.innerHTML =
    (parts.length ? `<div class="cat-hint">${parts.join(' · ')}</div>` : '') +
    list
      .map(
        (p) => `<button type="button" class="suggest-row" data-action="suggest-add" data-name="${esc(p.name)}">
          <span>${categoryOf(p.category).icon}</span><span class="grow">${esc(p.name)}</span><span class="muted small">＋</span></button>`
      )
      .join('');
}

function categoryHint(name) {
  if (!normalize(name)) return '';
  const c = categoryOf(classify(name, state.data.products));
  return `${c.icon} ${c.label}`;
}

function viewEinkauf() {
  const items = state.data.shopping_items;
  const quick = quickItems();
  const groups = CATEGORIES.map((cat) => {
    const list = items
      .filter((i) => itemCategory(i) === cat.id)
      .sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
    if (!list.length) return '';
    const open = list.filter((i) => !i.done).length;
    return `
      <section>
        <h2 class="cat-head"><span class="cat-icon">${cat.icon}</span>${esc(cat.label)} <span class="muted small">${open || '✓'}</span></h2>
        <ul class="card shop-list" data-longpress="item">
          ${list
            .map(
              (i) => `<li class="${i.done ? 'done' : ''}">
                <button class="check" data-action="toggle-item" data-id="${i.id}" aria-label="Abhaken">${i.done ? '✓' : ''}</button>
                <span class="name" data-action="toggle-item" data-id="${i.id}">${esc(i.name)}${
                  i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''
                }${i.note ? `<span class="item-note">${esc(i.note)}</span>` : ''}</span>
                <button class="icon-btn" data-action="edit-item" data-id="${i.id}" aria-label="Kategorie ändern oder löschen">⋯</button>
              </li>`
            )
            .join('')}
        </ul>
      </section>`;
  }).join('');

  const anyOpen = items.some((i) => !i.done);

  return `
    ${state.data.missing?.includes('products') ? '<div class="banner">Datenbank-Update nötig: bitte supabase/update-2.sql in Supabase ausführen.</div>' : ''}
    <form class="card add-item" data-form="add-item">
      <input name="name" placeholder="Was fehlt? z. B. 2 kg Äpfel" autocomplete="off" autocorrect="off" enterkeyhint="done" required />
      <button class="btn primary" type="submit" aria-label="Hinzufügen">+</button>
    </form>
    <div class="suggest" id="suggest"></div>
    ${groups || '<p class="empty">Die Liste ist leer.</p>'}
    ${items.length ? '<p class="muted small center longpress-hint">Lange drücken: Menge oder Notiz ergänzen</p>' : ''}
    ${
      quick.length
        ? `<section><h2>Häufig gekauft</h2><div class="quick">${quick
            .map(
              (q) => `<button class="quick-chip" data-action="quick-add" data-name="${esc(q.name)}">
                ${categoryOf(q.category).icon} ${esc(q.name)}</button>`
            )
            .join('')}</div></section>`
        : ''
    }
    <div class="shop-actions">
      ${anyOpen ? '<button class="btn ghost" data-action="copy-list">📋 Liste kopieren</button>' : ''}
      ${items.some((i) => i.done) ? '<button class="btn ghost" data-action="clear-done">Erledigte entfernen</button>' : ''}
    </div>`;
}

function itemForm(item) {
  const current = itemCategory(item);
  const inner = `
    <label>Name<input name="name" value="${esc(item.name)}" required /></label>
    <div class="row">
      <label>Menge<input name="amount" value="${esc(item.amount || '')}" placeholder="z. B. 2 kg, 6 Stück" /></label>
      <label>Notiz<input name="note" value="${esc(item.note || '')}" placeholder="z. B. Bio" /></label>
    </div>
    <details class="more-opts cat-opts">
      <summary>Kategorie ändern <span class="muted small">(${esc(categoryOf(current).icon + ' ' + categoryOf(current).label)})</span></summary>
      <div class="more-body">
    <div class="cat-grid">
      ${CATEGORIES.map(
        (c) => `<label><input type="radio" name="category" value="${c.id}" ${c.id === current ? 'checked' : ''}/>
          <span><b>${c.icon}</b>${esc(c.label)}</span></label>`
      ).join('')}
    </div>
        <p class="muted small">Die App merkt sich die Kategorie für das nächste Mal.</p>
      </div>
    </details>`;
  openSheet(
    'Artikel',
    inner,
    (f) => {
      const name = f.get('name').trim();
      const category = f.get('category') || current;
      save('shopping_items', {
        id: item.id,
        name,
        category,
        amount: f.get('amount').trim() || null,
        note: f.get('note').trim() || null,
      });
      rememberProduct(name, category, { countUse: false });
      closeSheet();
    },
    `<button type="button" class="btn danger wide" data-action="delete-item" data-id="${item.id}">Artikel löschen</button>`,
    { compact: true }
  );
}

function viewMehr() {
  const ms = members();
  const events = [...state.data.events]
    .filter((e) => e.weekdays?.length || (e.date && (e.end_date || e.date) >= D.todayKey()))
    .sort((a, b) => !!b.weekdays?.length - !!a.weekdays?.length || (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title));
  const tasks = state.data.tasks.filter((t) => !isReminder(t) && (isRecurring(t) || !t.done_at));
  const reminders = state.data.tasks
    .filter((t) => isReminder(t) && canSeeReminder(t) && (isRecurring(t) || !t.done_at))
    .sort(
      (a, b) =>
        isRecurring(b) - isRecurring(a) ||
        (a.due_date || '').localeCompare(b.due_date || '') ||
        (a.due_time || '').localeCompare(b.due_time || '')
    );

  const when = (x) =>
    x.kind && isRecurring(x)
      ? rhythmText(x)
      : x.weekdays?.length
      ? [...x.weekdays].sort().map((d) => D.WD_SHORT[d - 1]).join(', ')
      : x.date && x.end_date && x.end_date > x.date
        ? `${D.formatShort(x.date)} – ${D.formatShort(x.end_date)}`
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
      <div class="section-head"><h2>Familie</h2><button class="link" data-action="new-member">+ Person</button></div>
      <ul class="card list">
        ${ms
          .map(
            (m) => `<li><button data-action="open-person" data-id="${m.id}">
              ${avatar(m)}
              <span class="grow">${esc(m.name)} <span class="muted small">${ROLES[m.role] || ''}</span></span>
            </button></li>`
          )
          .join('')}
      </ul>
    </section>

    <section>
      ${birthdaysEntry()}
    </section>

    <section>
      <h2>Ferien &amp; Feiertage</h2>
      <div class="card pad">
        <select data-change="land">
          <option value="" ${state.land ? '' : 'selected'}>– nicht anzeigen –</option>
          ${STATES.map(([k, n]) => `<option value="${k}" ${k === state.land ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <p class="muted small">Schulferien und Feiertage dieses Bundeslands werden im Kalender angezeigt (gilt für dieses Gerät).</p>
      </div>
    </section>

    <section>
      <h2>Darstellung</h2>
      <div class="card pad">
        <div class="seg wide theme-seg">
          ${[
            ['auto', 'Automatisch'],
            ['light', '☀️ Hell'],
            ['dark', '🌙 Dunkel'],
          ]
            .map(([k, l]) => `<button class="${(lsGet('fo-theme') || 'auto') === k ? 'on' : ''}" data-action="set-theme" data-theme="${k}">${l}</button>`)
            .join('')}
        </div>
        <p class="muted small">„Automatisch“ folgt der Einstellung des Handys.</p>
      </div>
    </section>

    <details class="all-entries">
      <summary>Alle Einträge verwalten <span class="muted small">Erinnerungen, Termine, Aufgaben</span></summary>
    <section>
      <div class="section-head"><h2>Erinnerungen</h2><button class="link" data-action="new-reminder">+ Erinnerung</button></div>
      <ul class="card list">
        ${
          reminders.length
            ? reminders
                .map(
                  (t) => `<li><button data-action="edit-task" data-id="${t.id}">
                    <span class="grow">🔔 ${esc(t.title)} ${isRecurring(t) ? '<span class="muted small">↻</span>' : ''} ${chips(peopleOf(t))}</span>
                    <span class="muted small">${esc(when(t))}${t.due_time ? ` · ${D.hm(t.due_time)}` : ''}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Erinnerungen</li>'
        }
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
                    <span class="grow">${esc(e.title)} ${chips(eventPeople(e))}</span>
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
                    <span class="grow">${esc(t.title)} ${chips(peopleOf(t))}</span>
                    <span class="muted small">${esc(when(t))}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Aufgaben</li>'
        }
      </ul>
    </section>

    </details>

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
    const h = new Date().getHours();
    const hello = h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
    const me = meMember();
    return `
      <header class="top home">
        <div class="home-row">
          <span class="greet">${hello}${me ? `, ${esc(me.name)}` : ''}</span>
          ${isToday ? '' : '<button class="pill" data-action="goto-today">Heute</button>'}
        </div>
        <button class="date-big" data-action="pick-date" aria-label="Datum wählen">
          ${isToday ? '' : `<span class="rel">${D.relativeLabel(state.date)}</span>`}
          <span>${esc(D.formatLong(state.date))}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <input type="date" id="date-picker" value="${state.date}" tabindex="-1" aria-hidden="true" />
        ${weekStrip()}
      </header>`;
  }
  if (state.view === 'woche') {
    const month = state.cal === 'monat';
    const end = D.addDays(state.weekStart, 6);
    const m = D.fromKey(state.monthSel);
    const title = month
      ? `<span class="rel">${m.getFullYear()}</span><span class="date">${m.toLocaleDateString('de-DE', { month: 'long' })}</span>`
      : `<span class="rel">KW ${D.isoWeekNumber(state.weekStart)}</span>
         <span class="date">${D.formatDayMonth(state.weekStart)} – ${D.formatDayMonth(end)}</span>`;
    return `
      <header class="top cal-top">
        <div class="cal-row">
          <button class="nav" data-action="cal-step" data-dir="-1" aria-label="Zurück">‹</button>
          <button class="title-btn" data-action="cal-today" aria-label="Zu heute">${title}</button>
          <button class="nav" data-action="cal-step" data-dir="1" aria-label="Weiter">›</button>
        </div>
        <div class="seg wide cal-switch">
          <button class="${month ? '' : 'on'}" data-action="cal-mode" data-mode="woche">Woche</button>
          <button class="${month ? 'on' : ''}" data-action="cal-mode" data-mode="monat">Monat</button>
        </div>
      </header>`;
  }
  if (state.view === 'geburtstage') {
    return `
      <header class="top">
        <button class="nav" data-action="tab" data-tab="mehr" aria-label="Zurück">‹</button>
        <h1>Geburtstage</h1>
        <button class="nav" data-action="new-birthday" aria-label="Geburtstag eintragen">＋</button>
      </header>`;
  }
  if (state.view === 'person') {
    const m = member(state.personId);
    return `
      <header class="top">
        <button class="nav" data-action="back" aria-label="Zurück">‹</button>
        <div class="person-title">${avatar(m)}<strong>${esc(m?.name || '')}</strong></div>
        <button class="link" data-action="edit-member" data-id="${state.personId}">Bearbeiten</button>
      </header>`;
  }
  const titles = { einkauf: 'Einkauf', mehr: 'Einstellungen', kochbuch: 'Kochbuch' };
  return `<header class="top"><h1>${titles[state.view]}</h1></header>`;
}

// Schlichte Linien-Symbole (sehen auf allen Handys gleich aus)
const ICONS = {
  heute:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  woche: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2"/>',
  kochbuch: '<path d="M2.5 5h6a3.5 3.5 0 0 1 3.5 3.5V20a2.5 2.5 0 0 0-2.5-2.5h-7z"/><path d="M21.5 5h-6A3.5 3.5 0 0 0 12 8.5V20a2.5 2.5 0 0 1 2.5-2.5h7z"/>',
  einkauf: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.8l2.4 11.5h11l2-8.5H6.2"/>',
  mehr: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Wochenleiste Mo–So: Tippen wechselt den Tag, Punkt = da steht etwas an
function weekStrip() {
  const start = D.startOfWeek(state.date);
  const today = D.todayKey();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(start, i));
  const busy = (day) =>
    birthdaysOn(day).length > 0 ||
    eventsOn(day).some((o) => !o.cancelled) ||
    tasksOn(day, { filter: false, kind: 'erinnerung' }).some((x) => !x.done && !x.overdue) ||
    tasksOn(day, { filter: false }).some((x) => !x.done && !x.overdue && !x.undated);
  return `
    <div class="week-strip">
      <button class="ws-nav" data-action="prev-week-day" aria-label="Vorherige Woche">‹</button>
      ${days
        .map(
          (day) => `<button class="ws-day ${day === state.date ? 'sel' : ''} ${day === today ? 'today' : ''} ${holidayOn(day, state.land) ? 'hol' : ''} ${schoolHolidayOn(day, state.land) ? 'ferien' : ''}" data-action="select-day" data-day="${day}">
            <span class="ws-wd">${D.WD_SHORT[D.isoWeekday(day) - 1]}</span>
            <span class="ws-num">${D.fromKey(day).getDate()}</span>
            <span class="ws-dot ${busy(day) ? 'on' : ''}"></span>
          </button>`
        )
        .join('')}
      <button class="ws-nav" data-action="next-week-day" aria-label="Nächste Woche">›</button>
    </div>`;
}

function tabbar() {
  const tabs = [
    ['heute', 'heute', 'Heute'],
    ['woche', 'woche', 'Kalender'],
    ['kochbuch', 'kochbuch', 'Kochbuch'],
    ['einkauf', 'einkauf', 'Einkauf'],
    ['mehr', 'mehr', 'Einstellungen'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([k, i, l]) => `<button class="${state.view === k || (k === 'mehr' && state.view === 'geburtstage') ? 'on' : ''}" data-action="tab" data-tab="${k}">
        <span class="ti">${icon(i)}</span><span>${l}</span></button>`
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

  if (state.view === 'person' && !member(state.personId)) state.view = 'mehr';
  const views = { heute: viewHeute, woche: () => (state.cal === 'monat' ? viewMonat() : weekIngredientsButton() + viewWoche()), kochbuch: viewKochbuch, einkauf: viewEinkauf, mehr: viewMehr, person: viewPerson, geburtstage: viewGeburtstage };
  const scroll = window.scrollY;
  app.innerHTML = `
    ${header()}
    <main id="main" class="view-${state.view}">${views[state.view]()}</main>
    ${recipeList()}
    ${['heute', 'woche', 'einkauf', 'kochbuch', 'person', 'geburtstage'].includes(state.view) ? '<button class="fab" data-action="add" aria-label="Neu">+</button>' : ''}
    ${tabbar()}`;
  window.scrollTo(0, scroll);
}

function loginScreen() {
  return `
    <div class="center-screen">
      <img class="logo-img" src="icons/icon-192.png" alt="" width="96" height="96" />
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
      <p class="muted">Damit „Meine Aufgaben“ funktioniert. Kann später unter „Einstellungen“ geändert werden.</p>
      <div class="who">
        ${(ms.length ? ms : members())
          .map((m) => `<button class="btn big" style="--c:${esc(m.color)}" data-action="set-me" data-id="${m.id}">${avatar(m)}${esc(m.name)}</button>`)
          .join('')}
      </div>
    </div>`;
}

/* ================= Formulare (Bottom Sheet) ================= */

let sheetSubmit = null;

// compact: kleines Fenster unten (z. B. Einkaufsartikel), sonst fast Vollbild
function openSheet(title, inner, onSubmit, extraButtons = '', { compact = false } = {}) {
  sheetSubmit = onSubmit;
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <form class="sheet ${compact ? 'compact' : 'full'}" data-form="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <span class="grabber" aria-hidden="true"></span>
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
  ).join('')}</div>
  <div class="wd-presets">
    <button type="button" class="link" data-action="wd-preset" data-days="1,2,3,4,5">Mo–Fr</button>
    <button type="button" class="link" data-action="wd-preset" data-days="6,7">Wochenende</button>
    <button type="button" class="link" data-action="wd-preset" data-days="1,2,3,4,5,6,7">Jeden Tag</button>
  </div>`;
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
  ev ||= { date: day || state.date };
  const weekly = ev.weekdays?.length > 0;
  const multi = !weekly && ev.end_date && ev.end_date > ev.date;
  const allDay = !!ev.all_day;
  const o = !isNew && day ? eventsOn(day).find((x) => x.ev.id === ev.id) : null;

  const inner = `
    <label>Was?<input name="title" value="${esc(ev.title || '')}" placeholder="z. B. Pickleball" required /></label>
    <div class="field-label">Für wen? <span class="muted small">(mehrere möglich)</span></div>
    ${peoplePicker(eventPeople(ev))}
    ${repeatSwitch('repeat', weekly ? 'weekly' : multi ? 'multi' : 'once', [
      ['once', 'Ein Tag'],
      ['multi', 'Mehrere Tage'],
      ['weekly', 'Jede Woche'],
    ])}
    <label data-show="once">Datum<input type="date" name="date_once" value="${esc(ev.date || state.date)}" /></label>
    <div class="row" data-show="multi">
      <label>Von<input type="date" name="date_from" value="${esc(ev.date || state.date)}" /></label>
      <label>Bis<input type="date" name="date_to" value="${esc(multi ? ev.end_date : D.addDays(ev.date || state.date, 1))}" /></label>
    </div>
    <div data-show="weekly">
      ${weekdayPicker(ev.weekdays || [D.isoWeekday(day || state.date)])}
      <label>Serie endet am (optional)<input type="date" name="series_end" value="${esc(weekly ? ev.end_date || '' : '')}" /></label>
    </div>
    <label class="check-line"><input type="checkbox" name="all_day" ${allDay ? 'checked' : ''}/> Ganztägig</label>
    <div class="row" data-times ${allDay ? 'hidden' : ''}>
      <label><span data-time-label="start">${multi ? 'Beginn (1. Tag)' : 'Beginn'}</span><input type="time" name="start_time" value="${esc(D.hm(ev.start_time))}" /></label>
      <label><span data-time-label="end">${multi ? 'Ende (letzter Tag)' : 'Ende'}</span><input type="time" name="end_time" value="${esc(D.hm(ev.end_time))}" /></label>
    </div>
    ${moreOptions(
      `<label>Wo?<input name="location" value="${esc(ev.location || '')}" /></label>
       <label>Notiz<textarea name="notes" rows="2">${esc(ev.notes || '')}</textarea></label>`,
      ev.location || ev.notes
    )}`;

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
      let date = null;
      let endDate = null;
      if (repeat === 'once') date = f.get('date_once') || state.date;
      if (repeat === 'multi') {
        date = f.get('date_from') || state.date;
        endDate = f.get('date_to') || null;
        if (!endDate || endDate < date) return toast('Das Ende muss nach dem Beginn liegen.');
        if (endDate === date) endDate = null;
      }
      if (repeat === 'weekly') endDate = f.get('series_end') || null;
      const allDayChecked = f.get('all_day') === 'on';
      save('events', {
        id: ev.id,
        title: f.get('title').trim(),
        member_ids: readPeople(),
        member_id: readPeople()[0] || null,
        date,
        weekdays: repeat === 'weekly' ? wds : null,
        end_date: endDate,
        all_day: allDayChecked,
        start_time: allDayChecked ? null : f.get('start_time') || null,
        end_time: allDayChecked ? null : f.get('end_time') || null,
        location: f.get('location').trim() || null,
        notes: f.get('notes').trim() || null,
      });
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
}


// Selten gebrauchte Felder einklappen; offen, wenn schon etwas eingetragen ist
const moreOptions = (inner, open) =>
  `<details class="more-opts" ${open ? 'open' : ''}><summary>Mehr Optionen</summary><div class="more-body">${inner}</div></details>`;

// Mehrfachauswahl von Personen ("für wen?")
function peoplePicker(selected) {
  const ms = [...members()].sort((a, b) => (a.role === 'kind') - (b.role === 'kind'));
  return `<div class="people">${ms
    .map(
      (m) => `<label><input type="checkbox" name="who" value="${m.id}" ${selected.includes(m.id) ? 'checked' : ''}/>
        <span style="--c:${esc(m.color)}">${m.avatar ? avatar(m, 'small') : ''}${esc(m.name)}</span></label>`
    )
    .join('')}</div>`;
}
const readPeople = () => [...$('#sheet-root form').querySelectorAll('input[name="who"]:checked')].map((i) => i.value);

// Rhythmus-Auswahl für wiederkehrende Erinnerungen/Aufgaben
function rhythmFields(t, day) {
  const r = rhythmOf(t) || 'weekly';
  const from = t.repeat_from || day || state.date;
  return `
    <div data-show="weekly" class="rhythm-box">
      <label>Wie oft?<select name="rhythm">
        ${[
          ['weekly', 'Jede Woche'],
          ['biweekly', 'Alle 2 Wochen'],
          ['monthly', 'Jeden Monat'],
          ['yearly', 'Jedes Jahr'],
        ]
          .map(([k, l]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${l}</option>`)
          .join('')}
      </select></label>
      <div data-rhythm="weekly biweekly">${weekdayPicker(t.weekdays || [D.isoWeekday(day || state.date)])}</div>
      <label><span data-from-label>${r === 'weekly' ? 'Ab (optional)' : 'Erstes Mal am'}</span><input type="date" name="repeat_from" value="${esc(from)}" /></label>
    </div>`;
}

function updateRhythmVisibility(form) {
  const r = form.querySelector('select[name="rhythm"]')?.value;
  if (!r) return;
  form.querySelectorAll('[data-rhythm]').forEach((el) => (el.hidden = !el.dataset.rhythm.split(' ').includes(r)));
  const label = form.querySelector('[data-from-label]');
  if (label) label.textContent = r === 'weekly' ? 'Ab (optional)' : 'Erstes Mal am';
}

// Werte für die Datenbank aus dem Formular
function readRhythm(f) {
  const form = $('#sheet-root form');
  const r = f.get('rhythm');
  const wds = readWeekdays(form);
  if ((r === 'weekly' || r === 'biweekly') && !wds.length) return { error: 'Bitte mindestens einen Wochentag wählen.' };
  return {
    repeat: r,
    weekdays: r === 'weekly' || r === 'biweekly' ? wds : null,
    repeat_from: f.get('repeat_from') || state.date,
  };
}
const noRhythm = { repeat: null, weekdays: null, repeat_from: null };

function reminderForm(t, day) {
  const isNew = !t;
  t ||= { due_date: day || state.date, assignees: state.me ? [state.me] : [] };
  const weekly = isRecurring(t);
  const inner = `
    <label>Woran erinnern?<input name="title" value="${esc(t.title || '')}" placeholder="z. B. Turnbeutel einpacken" required /></label>
    ${repeatSwitch('repeat', weekly ? 'weekly' : 'once', [
      ['once', 'Einmalig'],
      ['weekly', 'Wiederkehrend'],
    ])}
    ${rhythmFields(t, day)}
    <div class="row">
      <label data-show="once">Tag<input type="date" name="due_date" value="${esc(t.due_date || state.date)}" /></label>
      <label>Uhrzeit (optional)<input type="time" name="due_time" value="${esc(D.hm(t.due_time))}" /></label>
    </div>
    <div class="field-label">Für wen? <span class="muted small">(mehrere möglich – jede/r kann abhaken)</span></div>
    <p class="muted small hint">🔒 Sehen können die Erinnerung nur die ausgewählten Personen und du.</p>
    ${peoplePicker(peopleOf(t))}
    ${moreOptions(`<label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`, t.notes)}`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Erinnerung löschen</button>`;
  openSheet(
    isNew ? 'Neue Erinnerung' : 'Erinnerung bearbeiten',
    inner,
    (f) => {
      const people = readPeople();
      const repeat = f.get('repeat');
      const rh = repeat === 'weekly' ? readRhythm(f) : noRhythm;
      if (rh.error) return toast(rh.error);
      save('tasks', {
        id: t.id,
        ...(isNew ? { created_by: state.me || null } : {}),
        ...rh,
        kind: 'erinnerung',
        title: f.get('title').trim(),
        assignees: people,
        assignee: people[0] || null,
        due_date: repeat === 'once' ? f.get('due_date') || state.date : null,
        due_time: f.get('due_time') || null,
        notes: f.get('notes').trim() || null,
        done_at: repeat === 'once' ? t.done_at ?? null : null,
        done_by: repeat === 'once' ? t.done_by ?? null : null,
      });
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
  updateRhythmVisibility($('#sheet-root form'));
}

function taskForm(t, day) {
  const isNew = !t;
  t ||= { assignee: null, due_date: day || state.date };
  const mode = isRecurring(t) ? 'weekly' : t.due_date ? 'date' : 'none';
  const inner = `
    <label>Was?<input name="title" value="${esc(t.title || '')}" placeholder="z. B. Getränke bestellen" required /></label>
    <div class="field-label">Wer? <span class="muted small">(leer = wer Zeit hat)</span></div>
    ${peoplePicker(peopleOf(t))}
    ${repeatSwitch('repeat', mode, [
      ['none', 'Ohne Datum'],
      ['date', 'An einem Tag'],
      ['weekly', 'Wiederkehrend'],
    ])}
    <label data-show="date">Datum<input type="date" name="due_date" value="${esc(t.due_date || state.date)}" /></label>
    ${rhythmFields(t, day)}
    ${moreOptions(`<label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`, t.notes)}`;

  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Aufgabe löschen</button>`;

  openSheet(
    isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten',
    inner,
    (f) => {
      const repeat = f.get('repeat');
      const rh = repeat === 'weekly' ? readRhythm(f) : noRhythm;
      if (rh.error) return toast(rh.error);
      const people = readPeople();
      save('tasks', {
        id: t.id,
        ...rh,
        kind: 'aufgabe',
        title: f.get('title').trim(),
        assignees: people,
        assignee: people[0] || null,
        due_date: repeat === 'date' ? f.get('due_date') || state.date : null,
        notes: f.get('notes').trim() || null,
        done_at: repeat === 'weekly' ? null : t.done_at ?? null,
      });
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
  updateRhythmVisibility($('#sheet-root form'));
}

// Einstellungen: eine Zeile mit Vorschau, die Liste liegt eine Ebene tiefer
function birthdaysEntry() {
  const list = state.data.birthdays || [];
  const next = [...list].map((b) => ({ b, next: nextBirthday(b) })).sort((x, y) => x.next.localeCompare(y.next))[0];
  const days = next ? Math.round((D.fromKey(next.next) - D.fromKey(D.todayKey())) / 86400000) : null;
  const preview = !list.length
    ? 'Noch keine eingetragen'
    : `${list.length} eingetragen · nächster: ${next.b.name} ${days === 0 ? 'heute' : days === 1 ? 'morgen' : `in ${days} Tagen`}`;
  return `<button class="card nav-row" data-action="tab" data-tab="geburtstage">
    <span class="nav-icon">🎂</span>
    <span class="grow-col"><span class="title">Geburtstage</span><span class="muted small">${esc(preview)}</span></span>
    <span class="chev">›</span>
  </button>`;
}

function viewGeburtstage() {
  return `
      ${
        state.data.missing?.includes('birthdays')
          ? '<div class="banner">Datenbank-Update nötig: bitte supabase/update-7.sql in Supabase ausführen.</div>'
          : `<ul class="card list">
        ${
          state.data.birthdays.length
            ? [...state.data.birthdays]
                .map((b) => ({ b, next: nextBirthday(b) }))
                .sort((x, y) => x.next.localeCompare(y.next))
                .map(({ b, next }) => {
                  const days = Math.round((D.fromKey(next) - D.fromKey(D.todayKey())) / 86400000);
                  const age = ageOn(b, next);
                  return `<li><button data-action="edit-birthday" data-id="${b.id}">
                    <span class="grow">${esc(b.name)}</span>
                    <span class="muted small bd-when">${b.day}. ${MONTHS[b.month - 1]}${age ? ` · wird ${age}` : ''}<br />
                      <b>${days === 0 ? 'heute 🎉' : days === 1 ? 'morgen' : `in ${days} Tagen`}</b></span>
                  </button></li>`;
                })
                .join('')
            : '<li class="empty">Noch keine Geburtstage eingetragen</li>'
        }
      </ul>`
      }
    <button class="btn ghost wide" data-action="new-birthday">＋ Geburtstag eintragen</button>`;
}

function birthdayForm(b) {
  const isNew = !b;
  b ||= { day: '', month: new Date().getMonth() + 1 };
  const inner = `
    <label>Wer hat Geburtstag?<input name="name" value="${esc(b.name || '')}" required placeholder="z. B. Oma Gisela" /></label>
    <div class="row">
      <label>Tag<select name="day" required>
        <option value="">–</option>
        ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option ${d === b.day ? 'selected' : ''}>${d}</option>`).join('')}
      </select></label>
      <label class="grow">Monat<select name="month">
        ${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === b.month ? 'selected' : ''}>${m}</option>`).join('')}
      </select></label>
      <label>Jahr<input type="number" name="year" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" placeholder="optional" value="${esc(b.year ?? '')}" /></label>
    </div>
    <p class="muted small hint">Mit Geburtsjahr zeigt die App das Alter an („wird 75“).</p>
    ${moreOptions(`<label>Notiz<textarea name="notes" rows="2" placeholder="z. B. Geschenkideen">${esc(b.notes || '')}</textarea></label>`, b.notes)}`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-birthday" data-id="${b.id}">Geburtstag löschen</button>`;
  openSheet(
    isNew ? 'Neuer Geburtstag' : 'Geburtstag bearbeiten',
    inner,
    (f) => {
      const day = Number(f.get('day'));
      const month = Number(f.get('month'));
      const year = f.get('year') ? Number(f.get('year')) : null;
      const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
      if (!day || day > maxDay) return toast(`Den ${day || '?'}. ${MONTHS[month - 1]} gibt es nicht.`);
      if (year && month === 2 && day === 29 && !isLeap(year)) return toast(`${year} war kein Schaltjahr.`);
      save('birthdays', { id: b.id, name: f.get('name').trim(), day, month, year, notes: f.get('notes').trim() || null });
      closeSheet();
    },
    extra
  );
}

function memberForm(m) {
  const isNew = !m;
  m ||= { role: 'kind', drives: false, color: COLORS[members().length % COLORS.length], sort: members().length };
  const inner = `
    <div class="avatar-edit">
      <div id="avatar-preview">${avatar(m, 'big')}</div>
      <div class="avatar-actions">
        <label class="btn ghost">📷 Foto wählen<input type="file" id="avatar-file" accept="image/*" hidden /></label>
        <button type="button" class="link" data-action="remove-avatar" ${m.avatar ? '' : 'hidden'}>Foto entfernen</button>
      </div>
      <input type="hidden" name="avatar" id="avatar-value" value="${esc(m.avatar || '')}" />
    </div>
    <label>Name<input name="name" value="${esc(m.name || '')}" required /></label>
    <label>Rolle<select name="role">${Object.entries(ROLES)
      .map(([k, l]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${l}</option>`)
      .join('')}</select></label>
    <div class="colors">${COLORS.map(
      (c) => `<label><input type="radio" name="color" value="${c}" ${m.color === c ? 'checked' : ''}/><span style="background:${c}"></span></label>`
    ).join('')}</div>`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-member" data-id="${m.id}">Person entfernen</button>`;
  openSheet(
    isNew ? 'Neue Person' : 'Person bearbeiten',
    inner,
    (f) => {
      const row = {
        id: m.id,
        name: f.get('name').trim(),
        role: f.get('role'),
        color: f.get('color') || m.color,
        sort: m.sort ?? 0,
      };
      // Bild nur mitschicken, wenn es geändert wurde
      if ($('#avatar-value').dataset.changed) row.avatar = f.get('avatar') || null;
      save('members', row);
      closeSheet();
    },
    extra
  );
}

function addChooser() {
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet chooser compact">
      <span class="grabber" aria-hidden="true"></span>
      <button class="btn big" data-action="new-reminder">🔔 Erinnerung</button>
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
    // "Heute" unten führt immer zum heutigen Tag zurück
    if (d.tab === 'heute') state.date = D.todayKey();
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
  'cal-mode': (d) => {
    state.cal = d.mode;
    lsSet('fo-cal', d.mode);
    if (d.mode === 'monat') state.monthSel = state.weekStart <= state.date && state.date <= D.addDays(state.weekStart, 6) ? state.date : state.weekStart;
    else state.weekStart = D.startOfWeek(state.monthSel);
    render();
  },
  'cal-step': (d) => slideStep(Number(d.dir)),
  'cal-today': () => {
    state.weekStart = D.startOfWeek(D.todayKey());
    state.monthSel = D.todayKey();
    state.date = D.todayKey();
    render();
  },
  'month-day': (d) => {
    state.monthSel = d.day;
    state.date = d.day; // ＋ legt dann Einträge für diesen Tag an
    render();
  },
  'open-week': (d) => {
    state.weekStart = d.week;
    state.cal = 'woche';
    lsSet('fo-cal', 'woche');
    window.scrollTo(0, 0);
    render();
  },
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
  'edit-task': (d) => {
    const t = state.data.tasks.find((x) => x.id === d.id);
    if (t) (isReminder(t) ? reminderForm : taskForm)(t);
  },
  'new-reminder': () => reminderForm(null, state.date),
  'remove-avatar': (d, el) => {
    const v = $('#avatar-value');
    v.value = '';
    v.dataset.changed = '1';
    const name = $('#sheet-root input[name="name"]').value;
    const color = $('#sheet-root input[name="color"]:checked')?.value;
    $('#avatar-preview').innerHTML = avatar({ name, color }, 'big');
    el.hidden = true;
  },
  'wd-preset': (d, el) => {
    const days = d.days.split(',');
    el.closest('form').querySelectorAll('input[name="wd"]').forEach((i) => (i.checked = days.includes(i.value)));
  },
  'edit-event': (d) => eventForm(state.data.events.find((e) => e.id === d.id), d.day),
  'edit-member': (d) => memberForm(member(d.id)),
  'new-birthday': () => birthdayForm(null),
  'edit-birthday': (d) => {
    const b = state.data.birthdays.find((x) => x.id === d.id);
    if (b) birthdayForm(b);
  },
  'delete-birthday': (d) => {
    const b = state.data.birthdays.find((x) => x.id === d.id);
    closeSheet();
    removeWithUndo('birthdays', d.id, `Geburtstag von ${b?.name || '…'} gelöscht`);
  },
  'set-theme': (d) => {
    lsSet('fo-theme', d.theme === 'auto' ? null : d.theme);
    applyTheme(d.theme);
    render();
  },
  'select-day': (d) => {
    state.date = d.day;
    render();
  },
  'prev-week-day': () => slideStep(-1, 7),
  'next-week-day': () => slideStep(1, 7),
  'recipe-filter': (d) => {
    state.recipeFilter = d.filter;
    render();
  },
  'new-recipe': () => recipeForm(null),
  'open-recipe': (d) => {
    const r = state.data.recipes.find((x) => x.id === d.id);
    if (r) recipeDetail(r);
  },
  'edit-recipe': (d) => recipeForm(state.data.recipes.find((x) => x.id === d.id)),
  'delete-recipe': (d) => {
    const r = state.data.recipes.find((x) => x.id === d.id);
    closeSheet();
    removeWithUndo('recipes', d.id, `„${r?.title || 'Gericht'}“ gelöscht`);
  },
  'toggle-fav': (d) => {
    const r = state.data.recipes.find((x) => x.id === d.id);
    if (!r) return;
    save('recipes', { id: r.id, favorite: !r.favorite });
    recipeDetail(state.data.recipes.find((x) => x.id === d.id));
  },
  'plan-recipe': (d) => {
    const r = state.data.recipes.find((x) => x.id === d.id);
    const day = $('#plan-date')?.value || state.date;
    setMeal(day, r);
    toast(`${r.title} am ${D.formatShort(day)} eingeplant`);
  },
  'pick-recipe': (d) => recipePicker(d.day),
  'choose-recipe': (d) => {
    setMeal(d.day, state.data.recipes.find((x) => x.id === d.id));
    closeSheet();
  },
  'clear-meal': (d) => {
    setMeal(d.day, null);
    closeSheet();
  },
  ingredients: (d) => ingredientsPanel(d.ids.split(',')),
  'add-ingredients': () => {
    const lines = [...document.querySelectorAll('#sheet-root input[name="ing"]:checked')].map((i) => i.value);
    lines.forEach((line) => addItem(line, { countUse: false }));
    closeSheet();
    toast(lines.length ? `${lines.length} ${lines.length === 1 ? 'Zutat' : 'Zutaten'} auf die Einkaufsliste gesetzt` : 'Nichts ausgewählt');
  },
  'open-person': (d) => {
    if (state.view !== 'person') state.prevView = state.view;
    state.personId = d.id;
    state.view = 'person';
    window.scrollTo(0, 0);
    render();
  },
  back: () => {
    state.view = state.prevView || 'heute';
    window.scrollTo(0, 0);
    render();
  },
  'new-event': () => eventForm(null, state.date),
  'new-task': () => taskForm(null, state.date),
  'new-member': () => memberForm(null),
  add: () => {
    if (state.view === 'einkauf') {
      const input = $('#main form.add-item input[name="name"]');
      input?.scrollIntoView({ block: 'center' });
      return input?.focus();
    }
    if (state.view === 'kochbuch') return recipeForm(null);
    if (state.view === 'geburtstage') return birthdayForm(null);
    addChooser();
  },
  'close-sheet': () => closeSheet(),
  'toggle-cancel': (d) => {
    const o = eventsOn(d.day).find((x) => x.ev.id === d.id);
    if (o) setOccurrence(o, { cancelled: !o.cancelled });
    closeSheet();
  },
  'delete-event': (d) => {
    const ev = state.data.events.find((e) => e.id === d.id);
    closeSheet();
    removeWithUndo('events', d.id, ev?.weekdays?.length ? 'Serie gelöscht' : 'Termin gelöscht');
  },
  'delete-task': (d) => {
    const t = state.data.tasks.find((x) => x.id === d.id);
    closeSheet();
    removeWithUndo('tasks', d.id, t && isReminder(t) ? 'Erinnerung gelöscht' : 'Aufgabe gelöscht');
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
  'delete-item': (d) => {
    const i = state.data.shopping_items.find((x) => x.id === d.id);
    closeSheet();
    removeWithUndo('shopping_items', d.id, `${i?.name || 'Artikel'} entfernt`);
  },
  'edit-item': (d) => {
    const i = state.data.shopping_items.find((x) => x.id === d.id);
    if (i) itemForm(i);
  },
  'suggest-add': (d) => {
    const input = $('#main form.add-item input[name="name"]');
    const { amount } = splitAmount(input?.value || '');
    if (input) {
      input.value = '';
      input.blur();
    }
    addItem(amount ? `${amount} ${d.name}` : d.name);
    $('#main form.add-item input[name="name"]')?.focus();
  },
  'quick-add': (d) => {
    addItem(d.name);
    toast(`${d.name} hinzugefügt`);
  },
  'clear-done': () => {
    const done = state.data.shopping_items.filter((i) => i.done).map((i) => i.id);
    removeWithUndo('shopping_items', done, `${done.length} erledigte entfernt`);
  },
  'copy-list': async () => {
    const open = state.data.shopping_items.filter((i) => !i.done);
    const text = CATEGORIES.flatMap((c) =>
      open.filter((i) => itemCategory(i) === c.id).map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name))
    ).join('\n');
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

// Fenster nach unten wegwischen (am Kopf bzw. Griff anfassen)
let sheetDrag = null;
document.addEventListener(
  'touchstart',
  (e) => {
    const head = e.target.closest('.sheet-head, .sheet.chooser');
    if (!head || e.target.closest('button, input, select, textarea')) return;
    const sheet = head.closest('.sheet');
    if (sheet.scrollTop > 0) return;
    sheetDrag = { sheet, y: e.touches[0].clientY, dy: 0 };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (!sheetDrag) return;
    sheetDrag.dy = Math.max(0, e.touches[0].clientY - sheetDrag.y);
    sheetDrag.sheet.style.transition = 'none';
    sheetDrag.sheet.style.transform = `translateY(${sheetDrag.dy}px)`;
  },
  { passive: true }
);
document.addEventListener('touchend', () => {
  if (!sheetDrag) return;
  const { sheet, dy } = sheetDrag;
  sheetDrag = null;
  sheet.style.transition = 'transform .2s ease-out';
  if (dy > 90) {
    sheet.style.transform = 'translateY(100%)';
    setTimeout(closeSheet, 180);
  } else {
    sheet.style.transform = '';
  }
});

// Langes Drücken auf einen Einkaufsartikel: Menge/Notiz bearbeiten
let press = null;
let swallowUntil = 0;
document.addEventListener('pointerdown', (e) => {
  // Vorschläge antippen, ohne dass das Eingabefeld vorher den Fokus verliert
  if (e.target.closest('.suggest-row')) e.preventDefault();
  const li = e.target.closest('[data-longpress="item"] li');
  if (!li || e.target.closest('.icon-btn')) return;
  const id = li.querySelector('[data-id]')?.dataset.id;
  press = {
    x: e.clientX,
    y: e.clientY,
    timer: setTimeout(() => {
      press = null;
      swallowUntil = Date.now() + 800; // den Tipp beim Loslassen ignorieren (sonst Abhaken/Schließen)
      navigator.vibrate?.(15);
      const item = state.data.shopping_items.find((x) => x.id === id);
      if (item) itemForm(item);
    }, 480),
  };
});
const cancelPress = (e) => {
  if (!press) return;
  if (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
  clearTimeout(press.timer);
  press = null;
};
document.addEventListener('pointermove', cancelPress);
document.addEventListener('pointerup', cancelPress);
document.addEventListener('pointercancel', cancelPress);
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-longpress="item"]')) e.preventDefault();
});

document.addEventListener('click', (e) => {
  if (Date.now() < swallowUntil) {
    swallowUntil = 0;
    e.preventDefault();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'avatar-file' && el.files?.[0]) {
    try {
      const data = await openCropper(el.files[0]);
      el.value = ''; // gleiches Bild nochmal wählbar
      if (!data) return;
      const v = $('#avatar-value');
      v.value = data;
      v.dataset.changed = '1';
      $('#avatar-preview').innerHTML = avatar({ avatar: data }, 'big');
      $('[data-action="remove-avatar"]').hidden = false;
    } catch {
      toast('Das Bild konnte nicht geladen werden.');
    }
    return;
  }
  if (el.id === 'date-picker' && el.value) {
    state.date = el.value;
    render();
    return;
  }
  if (el.dataset.change === 'land') {
    state.land = el.value;
    lsSet('fo-land', el.value);
    render();
    refreshSchoolHolidays(state.land).then((changed) => changed && render());
    return;
  }
  if (el.dataset.change === 'me') {
    state.me = el.value || null;
    lsSet('fo-me', state.me);
    render();
    return;
  }
  if (el.name === 'repeat') updateRepeatVisibility(el.form);
  if (el.name === 'rhythm') updateRhythmVisibility(el.form);
  if (el.name === 'all_day') el.form.querySelector('[data-times]').hidden = el.checked;
  if (el.name === 'repeat' && el.form.querySelector('[data-time-label]')) {
    const multi = el.value === 'multi';
    el.form.querySelector('[data-time-label="start"]').textContent = multi ? 'Beginn (1. Tag)' : 'Beginn';
    el.form.querySelector('[data-time-label="end"]').textContent = multi ? 'Ende (letzter Tag)' : 'Ende';
  }
});

// Beim Tippen im Einkauf anzeigen, in welche Kategorie der Artikel kommt
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'recipe-search') {
    const q = el.value.trim().toLowerCase();
    const root = el.closest('.sheet') || $('#main');
    root.querySelectorAll('#recipe-list-ul li').forEach((li) => {
      li.hidden = q && !li.querySelector('[data-search]').dataset.search.includes(q);
    });
    return;
  }
  if (el.form?.dataset.form === 'add-item' && el.name === 'name') renderSuggestions(el.value);
});

// Essen speichern, sobald das Feld verlassen wird.
document.addEventListener(
  'blur',
  (e) => {
    const el = e.target;
    if (el.classList?.contains('meal-input')) {
      const text = el.value.trim();
      const existing = state.data.meals.find((m) => m.date === el.dataset.day);
      if ((existing?.text || '') !== text) {
        // Passt der Text genau zu einem Gericht im Kochbuch, wird es verknüpft
        const recipe = state.data.recipes.find((r) => r.title.toLowerCase() === text.toLowerCase());
        const row = { date: el.dataset.day, text: text || null };
        if (recipe || existing?.recipe_id) row.recipe_id = recipe?.id || null;
        save('meals', row, 'date', { quiet: true });
      }
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
    const input = form.querySelector('input[name="name"]');
    input.value = '';
    input.blur(); // sonst wird die Liste nicht neu gezeichnet
    addItem(name); // zeichnet sofort neu
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

// Einen Schritt vor/zurück: Tag (Heute), Woche oder Monat (Kalender)
function stepBy(dir, days = 1) {
  if (state.view === 'heute') return changeDay(dir * days);
  if (state.view !== 'woche') return;
  if (state.cal === 'monat') {
    const m = D.fromKey(state.monthSel);
    const next = new Date(m.getFullYear(), m.getMonth() + dir, 1);
    const today = D.todayKey();
    const key = D.toKey(next);
    state.monthSel = today.slice(0, 7) === key.slice(0, 7) ? today : key;
  } else {
    state.weekStart = D.addDays(state.weekStart, 7 * dir);
  }
  render();
}

// Mit Gleit-Effekt: alte Seite raus, neue von der Seite rein
let sliding = false;
function slideStep(dir, days = 1) {
  const main = $('#main');
  if (!main || sliding) return stepBy(dir, days);
  sliding = true;
  main.style.transition = 'transform .14s ease-in, opacity .14s ease-in';
  main.style.transform = `translateX(${dir > 0 ? -28 : 28}%)`;
  main.style.opacity = '0';
  setTimeout(() => {
    stepBy(dir, days);
    sliding = false;
    const next = $('#main');
    if (!next) return;
    next.classList.add(dir > 0 ? 'slide-in-right' : 'slide-in-left');
  }, 140);
}

// Wischen: Seite folgt dem Finger, beim Loslassen weiter oder zurückfedern
let touch = null;
const swipeView = () => state.view === 'heute' || state.view === 'woche';
document.addEventListener(
  'touchstart',
  (e) => {
    touch = null;
    if (!swipeView() || document.body.classList.contains('sheet-open')) return;
    if (e.target.closest('select, input, textarea, .family-strip, .chip-row')) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null };
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (e) => {
    if (!touch) return;
    const dx = e.touches[0].clientX - touch.x;
    const dy = e.touches[0].clientY - touch.y;
    if (!touch.lock) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) touch.lock = 'x';
      else if (Math.abs(dy) > 12) touch.lock = 'y';
    }
    if (touch.lock !== 'x') return;
    const main = $('#main');
    if (!main) return;
    main.style.transition = 'none';
    main.style.transform = `translateX(${dx * 0.6}px)`;
    main.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 600));
  },
  { passive: true }
);
document.addEventListener(
  'touchend',
  (e) => {
    if (!touch) return;
    const { lock } = touch;
    const dx = e.changedTouches[0].clientX - touch.x;
    touch = null;
    if (lock !== 'x') return;
    const main = $('#main');
    if (Math.abs(dx) > 60) return slideStep(dx < 0 ? 1 : -1);
    if (main) {
      main.style.transition = 'transform .2s ease-out, opacity .2s';
      main.style.transform = '';
      main.style.opacity = '';
    }
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
    ['events', { id: store.uuid(), title: 'Schlagzeug', member_id: ids.k12, weekdays: [1], notes: 'Uhrzeit eintragen' }],
    ['events', { id: store.uuid(), title: 'Pickleball', member_id: ids.k12, weekdays: [3, 5], notes: 'Uhrzeit eintragen' }],
    ['events', { id: store.uuid(), title: 'Klavier', member_id: ids.k9, weekdays: [5], notes: 'Uhrzeit und Kind prüfen' }],
    ['tasks', { id: store.uuid(), title: 'Essensplan für nächste Woche machen', assignee: ids.papa, weekdays: [7] }],
    ['tasks', { id: store.uuid(), title: 'Rewe-Lieferung bestellen', assignee: ids.papa, weekdays: [7] }],
    ['tasks', { id: store.uuid(), title: 'Getränke bei Flaschenpost bestellen', assignee: ids.papa }]
  );
  for (const [table, row] of rows) {
    row.created_at = new Date().toISOString();
    state.data[table].push(row);
    await store.upsert(table, row);
  }
}

// Produktkatalog einmalig in die Datenbank schreiben (läuft im Hintergrund)
// Start-Kataloge in die Datenbank schreiben (läuft im Hintergrund):
// Produkte: fehlende ergänzen. Rezepte: nur, wenn das Kochbuch noch leer ist.
async function seedCatalogs() {
  if (!state.data.missing?.includes('products')) {
    const have = new Set(state.data.products.map((p) => p.key));
    const rows = seedProducts()
      .filter((p) => !have.has(p.key))
      .map((p) => ({ id: store.uuid(), ...p, uses: 0 }));
    if (rows.length) {
      state.data.products.push(...rows);
      try {
        await store.upsertMany('products', rows, 'key', true);
      } catch (e) {
        console.error(e);
      }
    }
  }
  if (!state.data.missing?.includes('recipes') && !state.data.recipes.length && !lsGet('fo-recipes-seeded')) {
    const rows = SEED_RECIPES.map((r) => ({ id: store.uuid(), ...r, favorite: false, own: false }));
    state.data.recipes.push(...rows);
    try {
      await store.upsertMany('recipes', rows);
      lsSet('fo-recipes-seeded', '1');
    } catch (e) {
      console.error(e);
    }
    render();
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
  seedCatalogs();
  refreshSchoolHolidays(state.land).then((changed) => changed && render());
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // Beim Zurückkehren in die App nach Updates schauen
        document.addEventListener('visibilitychange', () => !document.hidden && reg.update().catch(() => {}));
      })
      .catch(() => {});
    // Neue Version übernommen → einmal neu laden, damit sie sofort sichtbar ist
    // (nicht beim allerersten Start, da gab es noch keine alte Version)
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      if (!document.body.classList.contains('sheet-open')) location.reload();
    });
  }
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

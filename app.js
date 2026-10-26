import * as store from './store.js';
import * as D from './dates.js';
import { CATEGORIES, QUICK_DEFAULTS, categoryOf, classify, normalize, seedProducts } from './products.js';
import { RECIPE_CATEGORIES, SEED_RECIPES, STAPLES, recipeCategory } from './recipes.js';
import { STATES, holidayOn, refreshSchoolHolidays, schoolHolidayOn } from './holidays.js';
import { combineFilters, parseQuery, scoreFields } from './search.js';
import { ic } from './icons.js';
import * as push from './push.js';

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
  // Kalender-Liste: fortlaufend ab heute; listFrom/listTo = angezeigter Zeitraum
  listFrom: D.todayKey(),
  listTo: D.addDays(D.todayKey(), 20),
  listTop: null, // oberster sichtbarer Tag (für Titel und Pfeile)
  listPerson: null, // Personenfilter der Liste (null = alle)
  listScrollTo: null, // nach dem Zeichnen dorthin scrollen
  data: null,
  session: null,
  me: lsGet('fo-me'),
  taskFilter: null, // alle | meine – null = Voreinstellung nach Person (siehe taskFilter())
  hiddenAt: null,
  cal: lsGet('fo-cal') === 'monat' ? 'monat' : 'woche', // Kalender-Ansicht
  monthSel: D.todayKey(), // im Monat ausgewählter Tag
  land: lsGet('fo-land') ?? 'NW', // Bundesland für Ferien/Feiertage, '' = aus
  pendingRender: false,
  shopFilter: null, // Einkauf: nur ein Laden
  noteId: null, // geöffnete Notiz
  noteFilter: null, // Notizen: 'liste' | 'text'
  noteEditing: null, // Text-Notiz gerade im Bearbeiten
  wastePast: false, // Abfallkalender: auch vergangene Abholtage
  personFilter: null, // Personenansicht: nur Termine/Erinnerungen/Aufgaben
  personRange: 14, // Personenansicht: Tage ab heute (14 → 31 → 92 über "mehr zeigen")
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
  el.classList.remove('confirm');
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

// Bestätigung nach dem Sichern: kurze Zusammenfassung zum Abgleich + "Bearbeiten".
// Bleibt stehen, solange der Finger darauf liegt; nach unten wischen schließt sie.
const CONFIRM_MS = 6000;
function confirmToast(head, lines, onEdit) {
  const el = $('#toast');
  el.className = 'confirm';
  el.innerHTML = `
    <div class="cf-text">
      <div class="cf-head">${ic('check')} ${esc(head)}</div>
      ${lines.filter(Boolean).map((l, i) => `<div class="${i ? 'cf-sub' : 'cf-main'}">${esc(l)}</div>`).join('')}
    </div>
    <button type="button" class="toast-btn">Bearbeiten</button>
    <span class="cf-bar" aria-hidden="true"></span>`;
  const bar = el.querySelector('.cf-bar');
  const hide = () => el.classList.remove('show');
  // Leiste unten zeigt, wie lange die Meldung noch sichtbar ist
  const arm = (ms) => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, ms);
    bar.style.animation = 'none';
    void bar.offsetWidth; // Animation neu starten
    bar.style.animation = `cf-shrink ${ms}ms linear forwards`;
  };
  el.querySelector('.toast-btn').onclick = () => {
    hide();
    onEdit();
  };
  let startY = null;
  el.onpointerdown = (e) => {
    startY = e.clientY;
    clearTimeout(toastTimer);
    bar.style.animationPlayState = 'paused';
  };
  el.onpointermove = (e) => {
    if (startY != null && e.clientY - startY > 30) {
      startY = null;
      hide();
    }
  };
  el.onpointerup = el.onpointercancel = () => {
    startY = null;
    if (el.classList.contains('show')) arm(2500);
  };
  requestAnimationFrame(() => el.classList.add('show'));
  arm(CONFIRM_MS);
}

const namesOf = (ids) => (ids || []).map((id) => member(id)?.name).filter(Boolean).join(", ");
const timeRange = (a, b) => (D.hm(a) ? `${D.hm(a)}${D.hm(b) ? `–${D.hm(b)}` : ''} Uhr` : '');

// Zusammenfassung je Art: [Kopf, Hauptzeile, Zusatzzeile], dazu "Bearbeiten"
function confirmSaved(kind, id, isNew) {
  const verb = isNew ? 'eingetragen' : 'geändert';
  const find = (table) => state.data[table].find((r) => r.id === id);
  if (kind === 'termin') {
    const ev = find('events');
    if (!ev) return;
    const weekly = ev.weekdays?.length > 0;
    const when = weekly
      ? `${everyText(ev.weekdays)}${ev.end_date ? ` bis ${D.formatDayMonth(ev.end_date)}` : ''}`
      : ev.end_date && ev.end_date > ev.date
        ? `${D.formatShort(ev.date)} – ${D.formatShort(ev.end_date)}`
        : D.formatShort(ev.date);
    const time = ev.all_day ? 'ganztägig' : timeRange(ev.start_time, ev.end_time);
    const people = namesOf(eventPeople(ev));
    confirmToast(
      `Termin ${verb}`,
      [[ev.title, when, time].filter(Boolean).join(' · '), [ev.location ? ev.location : '', people ? `für ${people}` : ''].filter(Boolean).join(' · ')],
      () => eventForm(state.data.events.find((x) => x.id === id), weekly ? null : ev.date)
    );
  } else if (kind === 'erinnerung' || kind === 'aufgabe') {
    const t = find('tasks');
    if (!t) return;
    const when = isRecurring(t) ? rhythmText(t) : t.due_date ? D.formatShort(t.due_date) : 'ohne Datum';
    const people = namesOf(peopleOf(t));
    confirmToast(
      `${kind === 'erinnerung' ? 'Erinnerung' : 'Aufgabe'} ${verb}`,
      [[t.title, when, t.due_time ? `${D.hm(t.due_time)} Uhr` : ''].filter(Boolean).join(' · '), people ? `für ${people}` : kind === 'erinnerung' ? 'für alle' : ''],
      () => {
        const x = state.data.tasks.find((y) => y.id === id);
        if (x) (isReminder(x) ? reminderForm : taskForm)(x);
      }
    );
  } else if (kind === 'rezept') {
    const r = find('recipes');
    if (!r) return;
    const n = r.ingredients?.length || 0;
    confirmToast(
      `Gericht ${verb}`,
      [`${recipeEmoji(r)} ${r.title}`, [recipeCategory(r.category).label, `${n} ${n === 1 ? 'Zutat' : 'Zutaten'}`, r.minutes ? `${r.minutes} Min.` : ''].filter(Boolean).join(' · ')],
      () => recipeForm(state.data.recipes.find((x) => x.id === id))
    );
  } else if (kind === 'geburtstag') {
    const b = find('birthdays');
    if (!b) return;
    const next = nextBirthday(b);
    const age = ageOn(b, next);
    confirmToast(
      `Geburtstag ${verb}`,
      [`🎂 ${b.name} · ${b.day}. ${MONTHS[b.month - 1]}${b.year ? ` ${b.year}` : ''}`, `nächster: ${D.formatShort(next)}${age ? ` · wird ${age}` : ''}`],
      () => birthdayForm(state.data.birthdays.find((x) => x.id === id))
    );
  } else if (kind === 'person') {
    const m = find('members');
    if (!m) return;
    confirmToast(`Person ${verb}`, [`${m.name} · ${ROLES[m.role] || ''}`], () => memberForm(member(id)));
  }
}

// Speichern + Bestätigung zeigen (save() vergibt die id sofort)
function saveConfirm(table, row, kind, isNew) {
  const p = save(table, row);
  confirmSaved(kind, row.id, isNew);
  return p;
}

// Löschen mit "Rückgängig": vorher alles merken, was mit verschwindet
async function removeWithUndo(table, ids, label) {
  ids = [].concat(ids);
  const snapshot = [[table, state.data[table].filter((r) => ids.includes(r.id))]];
  if (table === 'events') {
    snapshot.push(['event_occurrences', state.data.event_occurrences.filter((o) => ids.includes(o.event_id))]);
    // Einzeländerungen einer Serie nach der Serie wiederherstellen
    snapshot.push(['events', state.data.events.filter((e) => ids.includes(e.series_id))]);
  }
  if (table === 'tasks') snapshot.push(['task_completions', state.data.task_completions.filter((c) => ids.includes(c.task_id))]);
  if (table === 'recipes') snapshot.push(['meals', state.data.meals.filter((m) => ids.includes(m.recipe_id))]);
  const copy = snapshot.map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]);

  const logged = copy[0][1].map((r) => logChange(table, r, null)).filter(Boolean);
  state.data[table] = state.data[table].filter((r) => !ids.includes(r.id) && !(table === 'events' && ids.includes(r.series_id)));
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
        for (const id of logged) await store.remove('activities', id).catch(() => {}); // "gelöscht" zurücknehmen
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

// Spalte → Datenbank-Update, das sie anlegt (für eine verständliche Meldung)
const COLUMN_UPDATES = { assigned: 17, created_by: 17, repeat_until: 13, remind: 12, series_id: 11, series_date: 11, all_day: 9, member_ids: 4, skip_to: 1, skip_back: 1 };

function fail(err) {
  console.error(err);
  // Fehlende Spalte: Datenbank-Update wurde in Supabase noch nicht ausgeführt
  const col = String(err?.message || '').match(/'(\w+)' column|column "?(\w+)"? does not exist/);
  const name = col && (col[1] || col[2]);
  if (err?.code === 'PGRST204' || err?.code === '42703') {
    const nr = COLUMN_UPDATES[name];
    toast(`Nicht gespeichert: Die Datenbank kennt „${name || '?'}“ noch nicht. In Supabase ${nr ? `supabase/update-${nr}.sql` : 'das neueste Update'} ausführen.`, {
      label: 'OK',
      run: () => {},
    });
  } else {
    toast(`Speichern fehlgeschlagen – bitte nochmal versuchen.${err?.message ? ` (${err.message})` : ''}`);
  }
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
  const before = i >= 0 ? { ...list[i] } : null;
  if (i >= 0) {
    row = { ...list[i], ...row, id: list[i].id };
    list[i] = row;
  } else {
    row = { id: store.uuid(), created_at: new Date().toISOString(), ...row };
    list.push(row);
  }
  logChange(table, before, row);
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
  logChange(table, state.data[table].find((r) => r.id === id), null);
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

// Tage, an denen ein Serientermin durch eine Einzeländerung ersetzt ist: "serienId|datum"
const replacedDays = () => new Set(state.data.events.filter((e) => e.series_id).map((e) => `${e.series_id}|${e.series_date}`));

function eventsOn(day) {
  const wd = D.isoWeekday(day);
  const out = [];
  const replaced = replacedDays();
  for (const ev of state.data.events) {
    const weekly = ev.weekdays?.length > 0;
    if (weekly && replaced.has(`${ev.id}|${day}`)) continue;
    // Einmalige Termine können über mehrere Tage gehen (date … end_date)
    const hit = weekly
      ? ev.weekdays.includes(wd) && (!ev.end_date || ev.end_date >= day) && (!ev.date || ev.date <= day)
      : ev.date && ev.date <= day && (ev.end_date || ev.date) >= day;
    if (!hit) continue;
    const occ = state.data.event_occurrences.find((o) => o.event_id === ev.id && o.date === day);
    const multi = !weekly && ev.end_date && ev.end_date > ev.date;
    const o = { ev, occ, day, weekly, multi, cancelled: occ?.cancelled || false, changed: !!ev.series_id };
    if (multi) {
      o.dayNo = daysBetween(ev.date, day) + 1;
      o.days = daysBetween(ev.date, ev.end_date) + 1;
    }
    o.time = timeLabel(o);
    // Sortierung: Ganztägiges oben, dann nach Uhrzeit
    o.sort = o.time === 'Ganztägig' || o.time.startsWith('bis') ? '' : D.hm(ev.start_time) || '';
    out.push(o);
  }
  // Ausgefallene Termine ans Ende
  return out.sort((a, b) => a.cancelled - b.cancelled || a.sort.localeCompare(b.sort) || a.ev.title.localeCompare(b.ev.title));
}

const daysBetween = (a, b) => Math.round((D.fromKey(b) - D.fromKey(a)) / 86400000);

// Dezentes Etikett für mehrtägige Termine: "2/5" (bzw. "5 Tage")
function multiPill(ev, text) {
  const c = member(eventPeople(ev)[0])?.color || 'var(--muted)';
  return `<span class="mpill" style="--c:${esc(c)}" title="Mehrtägiger Termin">${esc(text)}</span>`;
}
const changedTag = (o) => (o.changed ? '<span class="changed-tag">einmalig geändert</span>' : '');
const dayPill = (o) => (o.multi && !o.cancelled ? multiPill(o.ev, `${o.dayNo}/${o.days}`) : '');

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

// "Mo 26.10. – Fr 30.10." (welcher Tag es ist, zeigt das Etikett)
const rangeLabel = ({ ev }) => `${D.formatShort(ev.date)} – ${D.formatShort(ev.end_date)}`;

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
          <div class="title">${esc(ev.title)} ${o.weekly ? `<span class="muted rep">${ic('repeat')}</span>` : ''}${dayPill(o)}${changedTag(o)}</div>
          <div class="meta">${chips(eventPeople(ev))}${ev.location ? `<span class="muted with-ic">${ic('pin')}${esc(ev.location)}</span>` : ''}</div>
          ${o.multi && !o.cancelled ? `<div class="muted small with-ic">${ic('range')}${esc(rangeLabel(o))}</div>` : ''}
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
// Wie Feiertag/Ferien: Name in normaler Schrift, Alter grau
const birthdayHtml = (b, day) => {
  const age = ageOn(b, day);
  return `🎂 ${esc(b.name)} hat Geburtstag${age ? ` <span class="muted">(${age})</span>` : ''}`;
};
const birthdayText = (b, day) => {
  const age = ageOn(b, day);
  return `${b.name} hat Geburtstag${age ? ` (${age})` : ''}`;
};

/* ================= Aufgaben ================= */

const doneKey = (t) => (t.done_at ? D.toKey(new Date(t.done_at)) : null);
const isReminder = (t) => t.kind === 'erinnerung';

// Aufgaben auf "Heute": Kinder sehen beim Start nur ihre eigenen, Erwachsene alle
const taskFilter = () => state.taskFilter || (meMember()?.role === 'kind' ? 'meine' : 'alle');
lsSet('fo-filter', null); // frühere, gespeicherte Auswahl aufräumen

// Erinnerungen sind persönlich: sichtbar für die Personen, für die sie sind,
// und für den, der sie angelegt hat. Ohne Personen = für alle.
const canSeeReminder = (t) =>
  !state.me || !peopleOf(t).length || peopleOf(t).includes(state.me) || t.created_by === state.me;
// Eine oder mehrere Personen (ältere Einträge haben nur "assignee")
const peopleOf = (t) => (t.assignees?.length ? t.assignees : t.assignee ? [t.assignee] : []);
const chips = (ids) => ids.map((id) => chip(id)).join('');

// Wiederholung: 'weekly' | 'biweekly' | 'monthly' | 'yearly' (ältere Einträge: nur weekdays = wöchentlich)
// Wochentage kurz: [1..7] → "täglich", [1..5] → "Mo–Fr", [1,2,3,5] → "Mo–Mi, Fr"
function weekdaysText(wds) {
  const days = [...new Set(wds || [])].sort((a, b) => a - b);
  if (days.length === 7) return 'täglich';
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return runs
    .flatMap(([a, b]) => (b - a >= 2 ? [`${D.WD_SHORT[a - 1]}–${D.WD_SHORT[b - 1]}`] : a === b ? [D.WD_SHORT[a - 1]] : [D.WD_SHORT[a - 1], D.WD_SHORT[b - 1]]))
    .join(', ');
}
// "jeden Mo, Do" bzw. "täglich"
const everyText = (wds) => (new Set(wds || []).size === 7 ? 'täglich' : `jeden ${weekdaysText(wds)}`);

const rhythmOf = (t) => t.repeat || (t.weekdays?.length ? 'weekly' : null);
const isRecurring = (t) => !!rhythmOf(t);
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

function occursOn(t, day) {
  const r = rhythmOf(t);
  const from = t.repeat_from;
  if (from && day < from) return false;
  if (t.repeat_until && day > t.repeat_until) return false; // Serie beendet
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
  const wd = () => weekdaysText(t.weekdays);
  const fd = t.repeat_from ? D.fromKey(t.repeat_from) : null;
  const until = t.repeat_until ? ` bis ${D.formatDayMonth(t.repeat_until)}` : '';
  if (r === 'weekly') return wd() + until;
  if (r === 'biweekly') return `alle 2 Wochen ${wd()}${until}`;
  if (r === 'monthly') return `monatlich am ${fd?.getDate()}.${until}`;
  if (r === 'yearly') return `jährlich am ${fd?.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}${until}`;
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
        const on = c?.created_at ? D.toKey(new Date(c.created_at)) : null;
        out.push({ t, day, done: !!c, recurring: true, doneOn: on && on > day ? on : null });
      }
      // An diesem Tag verspätet abgehakt (für einen früheren Termin): hier auch zeigen
      for (const c of state.data.task_completions) {
        if (c.task_id !== t.id || !c.created_at || c.date >= day || D.toKey(new Date(c.created_at)) !== day) continue;
        out.push({ t, day: c.date, done: true, recurring: true, lateBy: daysBetween(c.date, day) });
      }
      // Heute zusätzlich: zuletzt verpasster Termin dieser Aufgabe (bis zu 7 Tage zurück)
      if (day === today && kind === 'aufgabe') {
        const missed = lastMissed(t, today);
        if (missed) out.push({ t, day: missed, done: false, recurring: true, overdue: true, missed: true });
      }
      continue;
    }
    const stillVisible = !t.done_at || doneKey(t) === today;
    if (t.due_date) {
      const on = doneKey(t);
      if (t.due_date === day) out.push({ t, day, done: !!t.done_at, doneOn: on && on > day ? on : null });
      // Verspätet erledigt: am Tag des Abhakens weiter zeigen
      else if (t.done_at && on === day && t.due_date < day) out.push({ t, day, done: true, lateBy: daysBetween(t.due_date, day) });
      else if (day === today && t.due_date < today && !t.done_at) out.push({ t, day, done: false, overdue: true });
    } else if (day === today && stillVisible) {
      out.push({ t, day, done: !!t.done_at, undated: true });
    }
  }
  let list = out;
  if (filter && taskFilter() === 'meine') list = list.filter((x) => peopleOf(x.t).includes(state.me));
  // Feste Reihenfolge (Abhaken verschiebt nichts): ursprünglicher Tag, Uhrzeit, Name
  const origin = (x) => (x.recurring ? x.day : x.t.due_date || '0000');
  return list.sort(
    (a, b) =>
      origin(a).localeCompare(origin(b)) ||
      (a.t.due_time || '99').localeCompare(b.t.due_time || '99') ||
      a.t.title.localeCompare(b.t.title)
  );
}

// Wiederkehrende Aufgabe: letzter Tag vor heute, an dem sie dran war und nicht abgehakt wurde
const MISSED_DAYS = 7;
function lastMissed(t, today) {
  const since = t.created_at ? D.toKey(new Date(t.created_at)) : null;
  for (let i = 1; i <= MISSED_DAYS; i++) {
    const d = D.addDays(today, -i);
    if (since && d < since) return null;
    if (!occursOn(t, d)) continue;
    const done = state.data.task_completions.some((x) => x.task_id === t.id && x.date === d);
    return done ? null : d; // nur der jeweils letzte Termin zählt
  }
  return null;
}
const missedLabel = (day) => (D.relativeLabel(day) === 'Gestern' ? 'gestern' : `${D.WD_SHORT[D.isoWeekday(day) - 1]}, ${D.formatDayMonth(day)}`);

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

// stack: Personen als kleine Fotos rechts (Heute) statt als Namens-Etiketten
// "1 Tag verspätet" / "3 Tage verspätet"; "gestern erledigt" / "am Mi erledigt" / "am 3.11. erledigt"
const lateText = (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'} verspätet`;
// from: der ursprüngliche Tag – "am Di erledigt", bei mehr als einer Woche mit Datum
function doneOnText(k, from) {
  const wd = D.WD_SHORT[D.isoWeekday(k) - 1];
  return daysBetween(from, k) < 7 ? `am ${wd} erledigt` : `am ${wd} ${D.fromKey(k).getDate()}.${D.fromKey(k).getMonth() + 1}. erledigt`;
}

function taskRow(x, { stack = false } = {}) {
  const { t } = x;
  const by = x.done && t.done_by && member(t.done_by);
  const badges = [
    isReminder(t) && state.view === 'person' ? `<span class="tag time">${ic('bell')}</span>` : '',
    t.due_time ? `<span class="tag time ${isLate(x) ? 'red' : ''}">${ic('clock')}${D.hm(t.due_time)}</span>` : '',
    x.missed
      ? `<span class="tag">${esc(missedLabel(x.day))} nicht erledigt</span>`
      : x.overdue
        ? `<span class="tag">seit ${esc(D.formatDayMonth(t.due_date))}</span>`
        : x.missedDay && !x.done
          ? `<span class="tag">${esc(missedLabel(x.missedDay))} nicht erledigt</span>`
          : x.lateBy
            ? `<span class="tag">${lateText(x.lateBy)}</span>`
            : x.doneOn
              ? `<span class="tag">${esc(doneOnText(x.doneOn, x.day))}</span>`
              : '',
    x.recurring ? `<span class="muted rep">${ic('repeat')}</span>` : '',
  ].join('');
  return `
    <li class="task ${x.done ? 'done' : ''}">
      <button class="check" data-action="toggle-task" data-id="${t.id}" data-day="${x.day}" aria-label="Erledigt">
        ${x.done ? ic('check') : ''}
      </button>
      <button class="task-main" data-action="edit-task" data-id="${t.id}">
        <span class="title">${esc(t.title)}</span>
        <span class="meta">${badges}${stack ? '' : chips(peopleOf(t))}${by ? `<span class="muted small with-ic">${ic('check')}${esc(by.name)}</span>` : ''}</span>
      </button>
      ${stack ? avatarStack(peopleOf(t)) : ''}
    </li>`;
}

/* ================= Ansichten ================= */

const nowHM = () => {
  const n = new Date();
  return `${D.pad(n.getHours())}:${D.pad(n.getMinutes())}`;
};
const hmPlus = (hm, min) => {
  const [h, m] = hm.split(':').map(Number);
  const t = Math.min(h * 60 + m + min, 24 * 60 - 1);
  return `${D.pad(Math.floor(t / 60))}:${D.pad(t % 60)}`;
};

// Tagesablauf: Termine und Erinnerungen eines Tages zusammen, nach Uhrzeit
function flowItems(day) {
  const isToday = day === D.todayKey();
  const now = nowHM();
  const items = [];
  for (const o of eventsOn(day)) {
    const { ev } = o;
    const start = D.hm(ev.start_time);
    const end = D.hm(ev.end_time);
    // Vorbei: Ende erreicht (ohne Ende: eine Stunde nach Beginn)
    let past = false;
    if (isToday && !o.multi && start) past = (end || hmPlus(start, 60)) <= now;
    if (isToday && o.multi && day === ev.end_date && end) past = end <= now;
    items.push({ type: 'ev', o, sort: o.sort, past, off: o.cancelled });
  }
  for (const x of tasksOn(day, { filter: false, kind: 'erinnerung' })) {
    items.push({ type: 'rem', x, sort: D.hm(x.t.due_time) || '', past: x.done });
  }
  const w = wasteFlowItem(day);
  if (w) items.push(w);
  return items.sort(
    (a, b) => !!a.off - !!b.off || a.sort.localeCompare(b.sort) || (a.type !== 'ev') - (b.type !== 'ev')
  );
}

function flowRow(it) {
  if (it.type === 'waste') return wasteFlowRow(it);
  if (it.type === 'ev') {
    const { o } = it;
    const { ev } = o;
    const end = D.hm(ev.end_time);
    const time = o.multi ? startLabel(o) : ev.all_day || !D.hm(ev.start_time) ? (ev.all_day ? 'ganzt.' : '') : D.hm(ev.start_time);
    const sub = o.cancelled
      ? ['Fällt aus']
      : [
          ev.location ? `${ic('pin')}${esc(ev.location)}` : '',
          o.multi ? esc(rangeLabel(o)) : end && D.hm(ev.start_time) ? `bis ${end}` : '',
        ].filter(Boolean);
    return `<div class="frow ${it.past ? 'past' : ''} ${o.cancelled ? 'off' : ''}">
      <button class="fr-open" data-action="edit-event" data-id="${ev.id}" data-day="${o.day}">
        <span class="fr-time">${esc(time)}</span>
        <span class="fr-body">
          <span class="fr-title">${esc(ev.title)}${o.weekly && !o.cancelled ? `<span class="muted rep">${ic('repeat')}</span>` : ''}${dayPill(o)}${o.cancelled ? '' : changedTag(o)}</span>
          ${sub.length ? `<span class="fr-sub">${sub.join(' · ')}</span>` : ''}
          ${ev.notes && !o.cancelled ? `<span class="fr-note">${esc(ev.notes)}</span>` : ''}
        </span>
      </button>
      ${avatarStack(eventPeople(ev))}
    </div>`;
  }
  const { x } = it;
  const { t } = x;
  return `<div class="frow rem ${x.done ? 'done' : ''}">
      <button class="fr-open" data-action="edit-task" data-id="${t.id}">
        <span class="fr-time ${isLate(x) ? 'late' : ''}">${t.due_time ? D.hm(t.due_time) : ''}</span>
        <span class="fr-body"><span class="fr-title title">${ic('bell')}${esc(t.title)}${x.recurring ? `<span class="muted rep">${ic('repeat')}</span>` : ''}</span></span>
      </button>
      ${avatarStack(peopleOf(t))}
      <button class="check" data-action="toggle-task" data-id="${t.id}" data-day="${x.day}" aria-label="Erledigt">${x.done ? ic('check') : ''}</button>
    </div>`;
}

function flowList(day) {
  const items = flowItems(day);
  if (!items.length) return '';
  const rows = items.map(flowRow);
  // Rote Linie "jetzt" vor dem ersten Eintrag, der noch kommt
  if (lsGet('fo-nowline') === '1' && day === D.todayKey() && items.some((it) => it.sort)) {
    const now = nowHM();
    let i = items.findIndex((it) => !it.off && it.sort && it.sort > now);
    if (i < 0) i = items.length - items.filter((it) => it.off).length;
    rows.splice(i, 0, `<div class="now-line" aria-label="Jetzt ${now}"><span>${now}</span></div>`);
  }
  return `<section><h2>Tagesablauf</h2><div class="card flow">${rows.join('')}</div></section>`;
}

// Wiederkehrende Aufgabe heute dran und zuletzt verpasst: nur einmal zeigen, mit Hinweis
function mergeMissed(list) {
  const todayIds = new Set(list.filter((x) => x.recurring && !x.missed).map((x) => x.t.id));
  const out = [];
  for (const x of list) {
    if (x.missed && todayIds.has(x.t.id)) {
      const main = list.find((y) => y.t.id === x.t.id && !y.missed);
      main.missedDay = x.day;
      continue;
    }
    out.push(x);
  }
  return out;
}

function viewHeute() {
  const day = state.date;
  const isToday = day === D.todayKey();
  const tasks = mergeMissed(tasksOn(day));
  const meal = state.data.meals.find((m) => m.date === day);
  const r = mealRecipe(meal);

  const filters = [
    ['alle', 'Alle'],
    ['meine', 'Meine'],
  ];
  const allTasks = tasksOn(day, { filter: false });
  const bdays = birthdaysOn(day);
  const holiday = holidayOn(day, state.land);
  const ferien = schoolHolidayOn(day, state.land);
  const notes = [
    holiday ? `<span class="day-chip hol">🎉 ${esc(holiday.name)}</span>` : '',
    ferien ? `<span class="day-chip">🏖️ ${esc(ferien.name)} <span class="muted">bis ${esc(D.formatDayMonth(ferien.end))}</span></span>` : '',
    pickupOn(day) ? `<button class="day-chip" data-action="tab" data-tab="abfall">${binsIcons(pickupOn(day).bins)}${esc(binsText(pickupOn(day).bins))}</button>` : '',
    ...bdays.map((b) => {
      const age = ageOn(b, day);
      return `<button class="day-chip" data-action="edit-birthday" data-id="${b.id}">🎂 ${esc(b.name)}${age ? ` <span class="muted">(${age})</span>` : ''}</button>`;
    }),
  ].filter(Boolean);

  return `
    <div class="family-strip compact">
      ${[...members()]
        .sort((a, b) => (b.id === state.me) - (a.id === state.me)) // ich zuerst
        .map(
          (m) => `<button class="${m.id === state.me ? 'me' : ''}" data-action="open-person" data-id="${m.id}" aria-label="${esc(m.name)}${m.id === state.me ? ' (du)' : ''}" title="${esc(m.name)}">${avatar(m)}</button>`
        )
        .join('')}
    </div>
    ${notes.length ? `<div class="day-chips">${notes.join('')}</div>` : ''}
    ${flowList(day)}

    <section>
      <div class="section-head">
        <h2>Essen</h2>
        ${
          r
            ? `<span class="head-links">
                <button class="link" data-action="open-recipe" data-id="${meal.recipe_id}">Rezept</button>
                <button class="link" data-action="ingredients" data-ids="${meal.recipe_id}">Zutaten</button>
                <button class="link" data-action="pick-recipe" data-day="${day}">Ändern</button>
              </span>`
            : ''
        }
      </div>
      ${mealField(meal, day, `Was gibt es ${isToday ? 'heute' : 'an diesem Tag'}?`, 'done', 'card meal')}
    </section>

    ${allTasks.length ? `<section>
      <div class="section-head">
        <h2>Aufgaben</h2>
        <div class="seg">
          ${filters
            .map(([k, l]) => `<button class="${taskFilter() === k ? 'on' : ''}" data-action="filter" data-filter="${k}">${l}</button>`)
            .join('')}
        </div>
      </div>
      ${
        taskFilter() === 'meine' && !meMember()
          ? '<p class="empty">Unter „Mehr“ auswählen, wer du bist.</p>'
          : tasks.length
            ? `<ul class="tasks card compact">${tasks.map((x) => taskRow(x, { stack: true })).join('')}</ul>`
            : '<p class="empty">Keine eigenen Aufgaben.</p>'
      }
    </section>` : ''}`;
}

// Übersicht einer Person: alles der nächsten 14 Tage

// Aufgaben einer Person in dieser Woche (Montag bis heute): wie viele erledigt, was liegen blieb
function weekTaskStats(id) {
  const today = D.todayKey();
  const days = [];
  for (let d = D.startOfWeek(today); d <= today; d = D.addDays(d, 1)) days.push(d);
  const items = [];
  for (const t of state.data.tasks) {
    if ((t.kind || 'aufgabe') !== 'aufgabe' || !peopleOf(t).includes(id)) continue;
    if (isRecurring(t)) {
      const since = t.created_at ? D.toKey(new Date(t.created_at)) : null;
      for (const d of days) {
        if ((since && d < since) || !occursOn(t, d)) continue;
        items.push({ t, day: d, done: state.data.task_completions.some((x) => x.task_id === t.id && x.date === d) });
      }
    } else if (t.due_date && t.due_date >= days[0] && t.due_date <= today) {
      items.push({ t, day: t.due_date, done: !!t.done_at });
    }
  }
  const done = items.filter((x) => x.done).length;
  const missed = items.filter((x) => !x.done && x.day < today).sort((a, b) => a.day.localeCompare(b.day));
  return { total: items.length, done, missed };
}

function weekTaskCard(id) {
  const { total, done, missed } = weekTaskStats(id);
  if (!total) return '';
  const pct = Math.round((done / total) * 100);
  // Gleiche Aufgabe nur einmal: "Spülmaschine ausräumen 6× (Mo–Sa)"
  const groups = new Map();
  for (const x of missed) {
    if (!groups.has(x.t.id)) groups.set(x.t.id, { t: x.t, days: [] });
    groups.get(x.t.id).days.push(D.isoWeekday(x.day));
  }
  return `
    <div class="card pad week-tasks">
      <div class="wt-head"><span>Aufgaben diese Woche</span><b>${done} von ${total} erledigt</b></div>
      <div class="wt-bar" role="img" aria-label="${pct} Prozent erledigt"><i style="width:${pct}%"></i></div>
      ${
        groups.size
          ? `<p class="wt-missed"><span class="muted">Liegen geblieben:</span> ${[...groups.values()]
              .map(
                (g) =>
                  `<button class="link" data-action="edit-task" data-id="${g.t.id}">${esc(g.t.title)}</button> <span class="muted">${
                    g.days.length > 1 ? `${g.days.length}× (${weekdaysText(g.days)})` : `(${D.WD_SHORT[g.days[0] - 1]})`
                  }</span>`
              )
              .join(', ')}</p>`
          : done === total
            ? '<p class="wt-missed muted">Alles erledigt – super!</p>'
            : ''
      }
    </div>`;
}

const PERSON_STEPS = [14, 31, 92];

// Eine Zeile der Personenliste: Tag links (nur bei der ersten Zeile des Tages), Titel, Details
function personRow(day, first, it, id) {
  const d = D.fromKey(day);
  const dayLabel = !first ? '' : day === D.todayKey() ? 'Heute' : `${D.WD_SHORT[D.isoWeekday(day) - 1]} ${d.getDate()}.`;
  const others = (ids) => {
    const rest = ids.filter((x) => x !== id).map((x) => member(x)?.name).filter(Boolean);
    if (members().length > 2 && members().every((m) => ids.includes(m.id))) return 'ganze Familie';
    return rest.length ? `mit ${rest.join(', ')}` : '';
  };
  if (it.type === 'ev') {
    const { o } = it;
    const { ev } = o;
    const sub = o.cancelled
      ? ['Fällt aus']
      : [
          o.multi ? esc(rangeLabel(o)) : esc(o.time === 'Ganztägig' ? 'ganztägig' : o.time),
          ev.location ? `${ic('pin')}${esc(ev.location)}` : '',
          esc(others(eventPeople(ev))),
        ].filter(Boolean);
    return `<div class="frow prow ${first ? 'first' : ''} ${o.cancelled ? 'off' : ''}">
      <button class="fr-open" data-action="edit-event" data-id="${ev.id}" data-day="${o.day}">
        <span class="fr-time">${dayLabel}</span>
        <span class="fr-body"><span class="fr-title">${esc(ev.title)}${o.multi && !o.cancelled ? '' : dayPill(o)}${o.cancelled ? '' : changedTag(o)}</span>
        ${sub.length ? `<span class="fr-sub">${sub.join(' · ')}</span>` : ''}</span>
      </button>
    </div>`;
  }
  const { x } = it;
  const { t } = x;
  const rem = isReminder(t);
  const sub = [
    `${rem ? 'Erinnerung' : 'Aufgabe'}${x.recurring ? `<span class="rep">${ic('repeat')}</span>` : ''}`,
    t.due_time ? D.hm(t.due_time) : '',
    x.missed
      ? `<span>${esc(missedLabel(x.day))} nicht erledigt</span>`
      : x.overdue
        ? `<span>seit ${esc(D.formatDayMonth(t.due_date))}</span>`
        : x.missedDay && !x.done
          ? `<span>${esc(missedLabel(x.missedDay))} nicht erledigt</span>`
          : x.lateBy
            ? `<span>${lateText(x.lateBy)}</span>`
            : x.doneOn
              ? esc(doneOnText(x.doneOn, x.day))
              : '',
    esc(others(peopleOf(t))),
  ].filter(Boolean);
  return `<div class="frow prow ${first ? 'first' : ''} ${x.done ? 'done' : ''}">
      <button class="fr-open" data-action="edit-task" data-id="${t.id}">
        <span class="fr-time">${dayLabel}</span>
        <span class="fr-body"><span class="fr-title title">${rem ? ic('bell') : ''}${esc(t.title)}</span><span class="fr-sub">${sub.join(' · ')}</span></span>
      </button>
      <button class="check" data-action="toggle-task" data-id="${t.id}" data-day="${x.day}" aria-label="Erledigt">${x.done ? ic('check') : ''}</button>
    </div>`;
}

// Regelmäßige Aufgabe/Erinnerung: heute schon erledigt?
function todayState(t) {
  const today = D.todayKey();
  if (!occursOn(t, today)) return '';
  const done = state.data.task_completions.some((x) => x.task_id === t.id && x.date === today);
  return done ? ` · <span class="today-ok">heute ${ic('check')}</span>` : ' · <span class="today-open">heute offen</span>';
}

function viewPerson() {
  const id = state.personId;
  const today = D.todayKey();
  const span = state.personRange;
  const f = state.personFilter; // null | 'events' | 'reminders' | 'tasks'
  const show = (k) => !f || f === k;
  const mine = (ids) => ids.includes(id);
  const has = { events: false, reminders: false, tasks: false };
  const seriesEvents = new Map();
  const seriesTasks = new Map();
  const days = [];
  for (let i = 0; i < span; i++) {
    const day = D.addDays(today, i);
    const events = eventsOn(day).filter((o) => mine(eventPeople(o.ev)));
    const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => mine(peopleOf(x.t)));
    // Heute: alles Fällige inkl. Verpasstem (zum Abhaken); später nur Einmaliges
    const tasks = i === 0 ? mergeMissed(tasksOn(day, { filter: false }).filter((x) => mine(peopleOf(x.t)))) : tasksOn(day, { filter: false }).filter((x) => mine(peopleOf(x.t)) && !x.missed);
    if (events.length) has.events = true;
    if (reminders.length) has.reminders = true;
    if (tasks.length) has.tasks = true;
    // Regelmäßiges steht einmal oben; in der Liste nur Ausfälle und heute noch Offenes
    for (const o of events) if (o.weekly) seriesEvents.set(o.ev.id, o.ev);
    for (const x of [...reminders, ...tasks]) if (x.recurring) seriesTasks.set(x.t.id, x.t);
    const items = [
      ...(show('events') ? events : [])
        .filter((o) => (i === 0 || !o.weekly || o.cancelled) && (!o.multi || o.day === o.ev.date || i === 0))
        .map((o) => ({ type: 'ev', o, sort: o.sort })),
      ...(show('reminders') ? reminders : []).filter((x) => i === 0 || !x.recurring).map((x) => ({ type: 'task', x, sort: D.hm(x.t.due_time) || '' })),
      ...(show('tasks') ? tasks : []).filter((x) => i === 0 || !x.recurring).map((x) => ({ type: 'task', x, sort: D.hm(x.t.due_time) || '' })),
    ].sort((a, b) => a.sort.localeCompare(b.sort));
    if (items.length) days.push({ day, items });
  }

  const regular = [
    ...(show('events') ? [...seriesEvents.values()] : []).map((ev) => {
      const time = timeLabel({ ev, day: today, multi: false });
      const when = [weekdaysText(ev.weekdays) + (ev.end_date ? ` bis ${D.formatDayMonth(ev.end_date)}` : ''), time].filter(Boolean).join(' · ');
      return `<li><button class="reg-row" data-action="edit-event" data-id="${ev.id}">
        <span class="reg-ic">${ic('calendar')}</span>
        <span class="grow-col"><span class="title">${esc(ev.title)}</span><span class="muted small">${esc(when)}</span></span>
      </button></li>`;
    }),
    ...[...seriesTasks.values()]
      .filter((t) => show(isReminder(t) ? 'reminders' : 'tasks'))
      .map(
        (t) => `<li><button class="reg-row" data-action="edit-task" data-id="${t.id}">
          <span class="reg-ic">${ic(isReminder(t) ? 'bell' : 'task')}</span>
          <span class="grow-col"><span class="title">${esc(t.title)}</span><span class="muted small">${esc([rhythmText(t), t.due_time ? D.hm(t.due_time) : ''].filter(Boolean).join(' · '))}${todayState(t)}</span></span>
        </button></li>`
      ),
  ];
  const kinds = [
    ['', 'Alles'],
    ['events', 'Termine'],
    ['reminders', 'Erinnerungen'],
    ['tasks', 'Aufgaben'],
  ].filter(([k]) => !k || has[k] || f === k);
  const label = { 14: 'nächste 2 Wochen', 31: 'nächster Monat', 92: 'nächste 3 Monate' }[span] || `nächste ${span} Tage`;
  const next = PERSON_STEPS.find((n) => n > span);
  const what = { events: 'Termine', reminders: 'Erinnerungen', tasks: 'Aufgaben' }[f] || 'Einträge';
  return `
    ${weekTaskCard(id)}
    ${kinds.length > 2 ? `<div class="chip-row person-kinds">${kinds
      .map(([k, l]) => `<button class="filter-chip ${(f || '') === k ? 'on' : ''}" data-action="person-filter" data-f="${k}" aria-pressed="${(f || '') === k}">${l}</button>`)
      .join('')}</div>` : ''}
    ${regular.length ? `<section><h2>Regelmäßig</h2><ul class="card list reg-list">${regular.join('')}</ul></section>` : ''}
    <section>
      <h2>${label[0].toUpperCase() + label.slice(1)}</h2>
      ${
        days.length
          ? `<div class="card flow plist">${days.map((d) => d.items.map((it, i) => personRow(d.day, i === 0, it, id)).join('')).join('')}</div>`
          : `<p class="empty">Keine weiteren ${what} ${span === 14 ? 'in den nächsten 2 Wochen' : 'in diesem Zeitraum'}.</p>`
      }
      ${next ? `<p class="center person-more"><button class="link" data-action="person-range" data-r="${next}">${next === 31 ? '1 Monat' : '3 Monate'} zeigen</button></p>` : ''}
    </section>`;
}

// Kalender-Liste: ab heute fortlaufend, oben "Frühere Tage", unten lädt beim Scrollen nach
const LIST_SPAN = 21;
function listReset() {
  state.listFrom = D.todayKey();
  state.listTo = D.addDays(state.listFrom, LIST_SPAN - 1);
  state.listTop = null;
  state.listScrollTo = 'top';
}

// Zu einem Tag springen: Liste bei Bedarf erweitern, dann zur Woche scrollen
function listGoto(day) {
  const today = D.todayKey();
  const ws = D.startOfWeek(day);
  if (ws === D.startOfWeek(today)) return listReset();
  if (ws < state.listFrom) state.listFrom = ws;
  if (D.addDays(ws, 13) > state.listTo) state.listTo = D.addDays(ws, 13);
  state.listScrollTo = `lw-${ws}`;
}

const weekRange = (ws) => `${D.formatDayMonth(ws)} – ${D.formatDayMonth(D.addDays(ws, 6))}`;

// Trennzeile vor jeder Woche: KW, Zeitraum, Ferien, Zutaten der kommenden Gerichte
function listWeekHead(ws, from) {
  const today = D.todayKey();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(ws, i)).filter((d) => d >= from && d <= state.listTo);
  const ids = days
    .filter((d) => d >= today)
    .map((d) => mealRecipe(state.data.meals.find((m) => m.date === d))?.id)
    .filter(Boolean);
  const ferien = [...new Map(days.map((d) => schoolHolidayOn(d, state.land)).filter(Boolean).map((f) => [f.start, f])).values()].filter(
    (f) => from === state.listFrom || (f.start >= ws && f.start <= D.addDays(ws, 6))
  );
  return `
    <div class="list-week" id="lw-${ws}" data-week="${ws}">
      <span class="lw-title"><b>KW ${D.isoWeekNumber(ws)}</b> · ${esc(weekRange(ws))}</span>
      ${ids.length ? `<button class="link" data-action="ingredients" data-ids="${ids.join(',')}">${ic('einkauf')}Zutaten</button>` : ''}
    </div>
    ${ferien.map((f) => `<p class="week-ferien">🏖️ ${esc(f.name)} <span class="muted">${D.formatShort(f.start)} – ${D.formatShort(f.end)}</span></p>`).join('')}`;
}

// Kleine Fotos der Beteiligten, rechtsbündig (max. 3, dann "+n")
function avatarStack(ids) {
  if (!ids.length) return '';
  const shown = ids.slice(0, 3).map((id) => avatar(member(id), 'xs')).join('');
  const more = ids.length > 3 ? `<span class="av av-initial xs av-more">+${ids.length - 3}</span>` : '';
  const names = ids.map((id) => member(id)?.name).filter(Boolean).join(', ');
  return `<span class="av-stack" title="${esc(names)}" aria-label="${esc(names)}">${shown}${more}</span>`;
}

// Personenfilter der Liste: Einträge ohne Personen gelten für alle und bleiben sichtbar
const listPersonOk = (ids) => !state.listPerson || !ids.length || ids.includes(state.listPerson);

// Eine Zeile: Zeit links (feste Spalte), Titel in der Mitte, Personen rechts
const lrow = (time, title, ids = [], cls = '') =>
  `<div class="lrow ${cls}"><span class="lr-time">${time}</span><span class="lr-title">${title}</span>${avatarStack(ids)}</div>`;

// Nur der Beginn (Ende steht beim Öffnen); mehrtägig: "ab"/"bis", sonst leer
function startLabel(o) {
  if (o.multi) return o.time === 'Ganztägig' ? '' : esc(o.time);
  if (o.ev.all_day) return 'ganzt.';
  return esc(D.hm(o.ev.start_time) || '');
}

function listDay(day) {
  const today = D.todayKey();
  const events = eventsOn(day).filter((o) => listPersonOk(eventPeople(o.ev)));
  const tasks = tasksOn(day, { filter: false }).filter((x) => !x.undated && !x.overdue && (!state.listPerson || peopleOf(x.t).includes(state.listPerson)));
  const open = tasks.filter((x) => !x.done).length;
  const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue && listPersonOk(peopleOf(x.t)));
  const bdays = birthdaysOn(day);
  const holiday = holidayOn(day, state.land);
  const meal = state.data.meals.find((m) => m.date === day);
  const empty = !events.length && !reminders.length && !open && !bdays.length && !holiday;
  return `
    <div class="card week-day ${day === today ? 'today' : ''} ${day < today ? 'past' : ''} ${empty ? 'free' : ''} ${D.isoWeekday(day) > 5 ? 'we' : ''}" data-day="${day}" id="wd-${day}">
      <button class="week-top" data-action="goto-day" data-day="${day}" aria-label="${esc(D.formatLong(day))} öffnen">
      <div class="wd">
        <strong>${D.WD_SHORT[D.isoWeekday(day) - 1]}</strong>
        <span>${D.fromKey(day).getDate()}</span>
        ${day === today ? '<em class="today-tag">Heute</em>' : ''}
      </div>
      <div class="body">
        ${holiday ? lrow('', `🎉 ${esc(holiday.name)}`, [], 'hol') : ''}
        ${bdays
          .map((b) => {
            const age = ageOn(b, day);
            return lrow('', `🎂 ${esc(b.name)}${age ? ` <span class="muted">(${age})</span>` : ''}`, [], 'bd');
          })
          .join('')}
        ${pickupOn(day) ? lrow('', `${binsIcons(pickupOn(day).bins)}${esc(binsText(pickupOn(day).bins))}`, [], 'bd waste') : ''}
        ${[
          // Termine und Erinnerungen gemeinsam nach Uhrzeit, Ausgefallenes ans Ende
          ...events.map((o) => ({
            off: o.cancelled,
            sort: o.sort,
            html: lrow(startLabel(o), `${esc(o.ev.title)}${o.cancelled ? '' : dayPill(o)}${o.cancelled ? '' : changedTag(o)}`, eventPeople(o.ev), o.cancelled ? 'off' : ''),
          })),
          ...reminders.map((x) => ({
            off: false,
            rem: true,
            sort: D.hm(x.t.due_time) || '',
            html: lrow(x.t.due_time ? D.hm(x.t.due_time) : '', `${ic('bell')}${esc(x.t.title)}`, peopleOf(x.t), `rem ${x.done ? 'off' : ''}`),
          })),
          // Abfallkalender: am Vortag "rausstellen" zur eingestellten Uhrzeit
          ...[wasteFlowItem(day)].filter(Boolean).filter((w) => listPersonOk(wasteSettings().people || [])).map((w) => ({
            off: false,
            rem: true,
            sort: w.sort,
            html: lrow(esc(w.sort), `${ic('bell')}${esc(binsText(w.p.bins))} rausstellen`, wasteSettings().people || [], `rem waste ${w.p.put_out_at ? 'off' : ''}`),
          })),
        ]
          .sort((a, b) => a.off - b.off || a.sort.localeCompare(b.sort) || !!a.rem - !!b.rem)
          .map((r) => r.html)
          .join('')}
        ${open ? lrow('', `${ic('task')}${open} ${open === 1 ? 'Aufgabe' : 'Aufgaben'}`, [], 'tasks') : ''}
      </div>
      </button>
      ${mealField(meal, day, 'Essen', 'next', 'week-meal')}
    </div>`;
}

// Fotoleiste zum Filtern nach Person (nur in der Liste)
function listPersonFilter() {
  const ms = [...members()].sort((a, b) => (a.role === 'kind') - (b.role === 'kind'));
  const sel = state.listPerson;
  return `<div class="list-filter" role="group" aria-label="Nach Person filtern">
    ${ms
      .map(
        (m) => `<button class="lf-person ${sel === m.id ? 'on' : ''} ${sel && sel !== m.id ? 'dim' : ''}" data-action="list-person" data-id="${m.id}" aria-pressed="${sel === m.id}" aria-label="Nur ${esc(m.name)}">
          ${avatar(m)}<span>${esc(m.name)}</span></button>`
      )
      .join('')}
  </div>`;
}

function viewWoche() {
  const out = [listPersonFilter(), `<button class="btn ghost wide list-earlier" data-action="list-earlier">${ic('down', 'flip')}Frühere Tage anzeigen</button>`];
  for (let day = state.listFrom; day <= state.listTo; day = D.addDays(day, 1)) {
    if (day === state.listFrom || D.isoWeekday(day) === 1) out.push(listWeekHead(D.startOfWeek(day), day));
    out.push(listDay(day));
  }
  out.push('<div class="list-more muted small" aria-hidden="true">Weitere Tage werden geladen …</div>');
  return out.join('');
}

// Oberster sichtbarer Tag (unter der Kopfzeile)
function listTopDay() {
  const head = $('header.top')?.getBoundingClientRect().bottom || 0;
  for (const el of document.querySelectorAll('#main .week-day[data-day]')) {
    if (el.getBoundingClientRect().bottom > head + 8) return el.dataset.day;
  }
  return state.listFrom;
}

// Titel oben passend zur sichtbaren Woche
function listTitle(top) {
  const today = D.todayKey();
  const ws = D.startOfWeek(top || state.listFrom);
  const current = ws === D.startOfWeek(today);
  const who = state.listPerson && member(state.listPerson);
  return `<span class="rel">KW ${D.isoWeekNumber(ws)}${who ? ` · nur ${esc(who.name)}` : ''}</span><span class="date">${current && state.listFrom === today ? 'Ab heute' : esc(weekRange(ws))}</span>`;
}

function updateListHeader() {
  if (state.view !== 'woche' || state.cal === 'monat') return;
  state.listTop = listTopDay();
  const t = $('header.top .title-btn');
  const html = listTitle(state.listTop);
  if (t && t.dataset.html !== html) {
    t.innerHTML = html;
    t.dataset.html = html;
  }
}

// Eine Woche vor/zurück (Pfeile und Wischen)
function listStep(dir) {
  const ws = D.startOfWeek(state.listTop || listTopDay());
  listGoto(D.addDays(ws, 7 * dir));
  render();
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
  // Mehrtägige Termine als durchgehende Balken: je Wochenzeile feste Spuren (max. 2)
  const lanesFor = (ws) => {
    const we = D.addDays(ws, 6);
    const evs = state.data.events
      .filter((ev) => !ev.weekdays?.length && ev.date && ev.end_date > ev.date && ev.date <= we && ev.end_date >= ws)
      .sort((a, b) => a.date.localeCompare(b.date) || b.end_date.localeCompare(a.end_date));
    const lanes = [];
    for (const ev of evs) {
      const lane = lanes.find((l) => l[l.length - 1].end_date < ev.date);
      if (lane) lane.push(ev);
      else if (lanes.length < 2) lanes.push([ev]);
    }
    return lanes;
  };
  const barsFor = (day, lanes) =>
    lanes.length
      ? `<span class="m-bars">${lanes
          .map((l) => {
            const ev = l.find((e) => e.date <= day && e.end_date >= day);
            const off = !ev || state.data.event_occurrences.some((o) => o.event_id === ev.id && o.date === day && o.cancelled);
            if (off) return '<i></i>';
            const c = member(eventPeople(ev)[0])?.color || 'var(--accent)';
            return `<i class="on ${ev.date === day ? 'start' : ''} ${ev.end_date === day ? 'end' : ''}" style="--c:${esc(c)}"></i>`;
          })
          .join('')}</span>`
      : '';
  const dotsFor = (day, lanes) => {
    const dots = [];
    const barred = new Set(lanes.flat().map((e) => e.id));
    for (const o of eventsOn(day)) if (!o.cancelled && !barred.has(o.ev.id)) dots.push(member(eventPeople(o.ev)[0])?.color || 'var(--muted)');
    // Wiederkehrende Aufgaben/Erinnerungen bekommen keinen Punkt (sonst hätte jeder Tag einen)
    const rem = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue && !x.undated && !x.recurring).length;
    const tsk = tasksOn(day, { filter: false }).filter((x) => !x.overdue && !x.undated && !x.recurring).length;
    return [
      ...dots.slice(0, 3).map((c) => `<i style="background:${esc(c)}"></i>`),
      rem || tsk ? '<i class="dot-task"></i>' : '',
    ].join('');
  };
  const grid = `
    <div class="month">
      <div class="m-head"><span></span>${D.WD_SHORT.map((w) => `<span>${w}</span>`).join('')}</div>
      ${rows
        .map((ws) => [ws, lanesFor(ws)])
        .map(
          ([ws, lanes]) => `<div class="m-row">
            <button class="m-kw" data-action="open-week" data-week="${ws}" aria-label="Woche öffnen">${D.isoWeekNumber(ws)}</button>
            ${Array.from({ length: 7 }, (_, i) => D.addDays(ws, i))
              .map(
                (day) => `<button class="m-day ${day.slice(5, 7) !== monthNo ? 'other' : ''} ${day === today ? 'today' : ''} ${day === sel ? 'sel' : ''}
                  ${holidayOn(day, state.land) ? 'hol' : ''} ${schoolHolidayOn(day, state.land) ? 'ferien' : ''}" data-action="month-day" data-day="${day}">
                  <span class="m-num">${D.fromKey(day).getDate()}${birthdaysOn(day).length ? '<span class="m-cake" aria-label="Geburtstag">🎂</span>' : ''}</span>
                  ${barsFor(day, lanes)}
                  <span class="m-dots">${dotsFor(day, lanes)}</span>
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
// Erinnerungen/Aufgaben des Tages, "Tonne rausstellen" nach Uhrzeit einsortiert
function agendaRows(items, w) {
  const rows = items.map(taskRow);
  if (w) {
    const at = items.filter((x) => isReminder(x.t) && (D.hm(x.t.due_time) || '99') <= w.sort).length;
    rows.splice(at, 0, wasteTaskRow(w));
  }
  return rows.join('');
}

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
    ...birthdaysOn(day).map((b) => `<button class="ag-note bd-note" data-action="edit-birthday" data-id="${b.id}">${birthdayHtml(b, day)}</button>`),
    pickupOn(day) ? `<button class="ag-note waste-note" data-action="tab" data-tab="abfall">${binsIcons(pickupOn(day).bins)}${esc(binsText(pickupOn(day).bins))}</button>` : '',
  ].join('');
  const items = [...reminders, ...tasks];
  const empty = !events.length && !items.length && !meal?.text && !notes && !wasteFlowItem(day);
  return `
    <section class="agenda">
      <div class="section-head">
        <h2>${esc(D.formatLong(day))}</h2>
        <button class="link" data-action="goto-day" data-day="${day}">Tag öffnen${ic('right')}</button>
      </div>
      ${notes}
      ${events.map(eventCard).join('')}
      ${items.length || wasteFlowItem(day) ? `<ul class="tasks card">${agendaRows(items, wasteFlowItem(day))}</ul>` : ''}
      ${
        meal?.text
          ? `<button class="card ag-event" data-action="${meal.recipe_id ? 'open-recipe' : 'pick-recipe'}" data-id="${meal.recipe_id || ''}" data-day="${day}">
              <span class="ag-time">${mealIcon(meal)}</span><span class="ag-title">${esc(meal.text)}</span></button>`
          : ''
      }
      ${empty ? '<p class="empty">Nichts eingetragen.</p>' : ''}
    </section>`;
}

/* ================= Essen & Kochbuch ================= */

const mealRecipe = (meal) => (meal?.recipe_id ? state.data.recipes.find((r) => r.id === meal.recipe_id) : null);

// Kein Gericht: "Reste" oder "Auswärts essen" (als Text gespeichert, auch "Auswärts: bei Oma")
const MEAL_SPECIAL = [
  { key: 'reste', text: 'Reste', emoji: '🥡', hint: 'Was noch da ist' },
  { key: 'auswaerts', text: 'Auswärts essen', emoji: '🍽️', hint: 'Restaurant, Oma, Freunde …' },
];
function mealSpecial(meal) {
  const t = normalize(meal?.text || '');
  if (!t || meal?.recipe_id) return null;
  if (t === 'reste' || t.startsWith('reste ')) return MEAL_SPECIAL[0];
  if (/^ausw(ä|ae|a)rts/.test(t) || t === 'essen gehen') return MEAL_SPECIAL[1];
  return null;
}
// Symbol fürs Essen: Rezept, Reste/Auswärts oder neutral
const mealIcon = (meal) => {
  const r = mealRecipe(meal);
  if (r) return recipeEmoji(r);
  const sp = mealSpecial(meal);
  return sp ? sp.emoji : ic('meal');
};
const recipeEmoji = (r) => r?.emoji || recipeCategory(r?.category).emoji;

// Eingabefeld fürs Essen + Knopf "aus dem Kochbuch wählen"
function mealField(meal, day, placeholder, enter, cls) {
  const r = mealRecipe(meal);
  return `
    <div class="${cls}">
      <span class="meal-icon ${r || mealSpecial(meal) ? '' : 'empty'}">${mealIcon(meal)}</span>
      <div class="meal-field ${meal?.text ? 'has-text' : ''}">
        <span class="meal-text" aria-hidden="true">${esc(meal?.text || '')}</span>
        <input class="meal-input" ${cls.includes('card') ? 'id="meal-input"' : ''} data-day="${day}" list="recipe-list"
          value="${esc(meal?.text || '')}" placeholder="${esc(placeholder)}" enterkeyhint="${enter}" autocomplete="off" />
      </div>
      ${r && cls.includes('card') ? '' : `<button class="icon-btn book" data-action="pick-recipe" data-day="${day}" aria-label="Aus dem Kochbuch wählen">${ic('kochbuch')}</button>`}
    </div>`;
}

const recipeList = () =>
  `<datalist id="recipe-list">${[...MEAL_SPECIAL.map((x) => x.text), ...state.data.recipes.map((r) => r.title)].map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>`;

const sortedRecipes = () =>
  [...state.data.recipes].sort((a, b) => b.favorite - a.favorite || a.title.localeCompare(b.title));

const isStaple = (line) => {
  const words = normalize(line).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => STAPLES.has(w));
};

const recipeMeta = (r) =>
  [r.minutes ? `${r.minutes} Min.` : '', r.servings ? `${r.servings} Pers.` : '', recipeCategory(r.category).label]
    .filter(Boolean)
    .join(' · ');

function recipeRow(r, action = 'open-recipe', extra = '') {
  return `
    <li><button class="recipe-row" data-action="${action}" data-id="${r.id}" ${extra} data-search="${esc(r.title.toLowerCase())}">
      <span class="recipe-emoji">${recipeEmoji(r)}</span>
      <span class="grow-col">
        <span class="title">${esc(r.title)}${r.favorite ? `<span class="fav">${ic('star', 'fill')}</span>` : ''}</span>
        <span class="muted small">${esc(recipeMeta(r))}</span>
      </span>
    </button></li>`;
}

// Kochbuch oben: Essen der nächsten 7 Tage, leere Tage zum Planen, Zutaten für alle auf einmal
function weekMealPlan() {
  const today = D.todayKey();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(today, i));
  const ids = [];
  const rows = days.map((day) => {
    const meal = state.data.meals.find((m) => m.date === day && m.text);
    const r = mealRecipe(meal);
    if (r && !ids.includes(r.id)) ids.push(r.id);
    const rel = D.relativeLabel(day);
    const label = rel === 'Heute' || rel === 'Morgen' ? rel : `${D.WD_SHORT[D.isoWeekday(day) - 1]} ${D.fromKey(day).getDate()}.`;
    return `<div class="plan-day ${meal ? '' : 'free'}">
      <button class="plan-open" data-action="${r ? 'open-recipe' : 'pick-recipe'}" data-id="${r?.id || ''}" data-day="${day}">
        <span class="pd-day">${esc(label)}</span>
        <span class="pd-meal">${
          meal ? `<span class="pd-emoji">${mealIcon(meal)}</span>${esc(meal.text)}` : `${ic('plus')}Essen planen`
        }</span>
      </button>
      ${meal ? `<button class="icon-btn" data-action="pick-recipe" data-day="${day}" aria-label="Essen ändern">${ic('pencil')}</button>` : ''}
    </div>`;
  });
  return `<section class="week-plan">
    <div class="section-head"><h2>Die nächsten 7 Tage</h2>${
      ids.length ? `<button class="link" data-action="ingredients" data-ids="${ids.join(',')}">${ic('einkauf')}Zutaten für alle (${ids.length})</button>` : ''
    }</div>
    <div class="card plan-card">${rows.join('')}</div>
  </section>`;
}

function viewKochbuch() {
  if (state.data.missing?.includes('recipes')) {
    return '<div class="banner">Datenbank-Update nötig: bitte supabase/update-5.sql in Supabase ausführen.</div>';
  }
  const f = state.recipeFilter || 'alle';
  const filters = [
    ['alle', 'Alle'],
    ['fav', `${ic('star')}Favoriten`],
    ['eigene', `${ic('pencil')}Eigene`],
    ...RECIPE_CATEGORIES.map((c) => [c.id, `${c.emoji} ${c.label}`]),
  ];
  const list = sortedRecipes().filter((r) =>
    f === 'alle' ? true : f === 'fav' ? r.favorite : f === 'eigene' ? r.own : r.category === f
  );
  return `
    ${weekMealPlan()}
    <h2 class="all-recipes">Alle Gerichte</h2>
    <div class="card add-item">
      <input type="search" id="recipe-search" placeholder="Gericht suchen …" autocomplete="off" />
      <button class="btn primary" data-action="new-recipe" aria-label="Eigenes Gericht anlegen">${ic('plus')}</button>
    </div>
    <div class="chip-row">${filters
      .map(([k, l]) => `<button class="filter-chip ${f === k ? 'on' : ''}" data-action="recipe-filter" data-filter="${k}">${l}</button>`)
      .join('')}</div>
    ${
      list.length
        ? `<ul class="card list recipes" id="recipe-list-ul">${list.map((r) => recipeRow(r)).join('')}</ul>`
        : `<p class="empty">${f === 'eigene' ? 'Noch keine eigenen Gerichte – oben mit + anlegen.' : 'Keine Gerichte gefunden.'}</p>`
    }`;
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
  sheetOpened();
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
        <button class="link" data-action="toggle-fav" data-id="${r.id}">${r.favorite ? `${ic('star', 'fill')}Favorit` : `${ic('star')}Als Favorit merken`}</button>
      </div>
    </div>

    <div class="plan-row card">
      <input type="date" id="plan-date" value="${state.date}" />
      <button class="btn primary" data-action="plan-recipe" data-id="${r.id}">Einplanen</button>
    </div>

    <h3>Zutaten <span class="muted small">(für ${r.servings || 4} Personen)</span></h3>
    ${ingredientChecklist([r])}
    <button class="btn primary wide" data-action="add-ingredients">${ic('einkauf')}Ausgewählte auf die Einkaufsliste</button>

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
     <button class="btn primary wide" data-action="add-ingredients">${ic('einkauf')}Ausgewählte auf die Einkaufsliste</button>`
  );
}

function recipePicker(day) {
  openPanel(
    `Essen am ${D.formatShort(day)}`,
    `
    <div class="meal-special">
      ${MEAL_SPECIAL.map(
        (x) => `<button type="button" class="card ms-btn ${normalize(state.data.meals.find((m) => m.date === day)?.text || '') === normalize(x.text) ? 'on' : ''}" data-action="meal-special" data-day="${day}" data-key="${x.key}">
          <span class="ms-emoji">${x.emoji}</span><span class="ms-text"><b>${x.text}</b><span class="muted small">${x.hint}</span></span></button>`
      ).join('')}
    </div>
    <h3 class="sr-head">Oder ein Gericht</h3>
    <input type="search" id="recipe-search" placeholder="Gericht suchen …" autocomplete="off" />
    <ul class="card list recipes" id="recipe-list-ul">
      ${sortedRecipes().map((r) => recipeRow(r, 'choose-recipe', `data-day="${day}"`)).join('')}
    </ul>
    <button class="btn ghost wide" data-action="new-recipe">${ic('plus')}Neues Gericht anlegen</button>
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
      <label class="check-line"><input type="checkbox" name="favorite" ${r.favorite ? 'checked' : ''}/> Favorit</label>`,
      !isNew && r.own
    )}`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-recipe" data-id="${r.id}">Gericht löschen</button>`;
  openSheet(
    isNew ? 'Neues Gericht' : 'Gericht bearbeiten',
    inner,
    (f) => {
      const num = (k) => (f.get(k) ? Number(f.get(k)) : null);
      const saved = saveConfirm('recipes', {
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
      }, 'rezept', isNew);
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
  const shop = (state.view === 'einkauf' && state.shopFilter) || defaultShop();
  save('shopping_items', { name, category, done: false, shop, ...(amount ? { amount } : {}) });
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
          <span>${categoryOf(p.category).icon}</span><span class="grow">${esc(p.name)}</span><span class="muted">${ic('plus')}</span></button>`
      )
      .join('');
}

function categoryHint(name) {
  if (!normalize(name)) return '';
  const c = categoryOf(classify(name, state.data.products));
  return `${c.icon} ${c.label}`;
}

// Läden: gemeinsame Liste (Tabelle shops), Standard-Laden zuerst. Ohne Tabelle: nur Lidl.
const shopsReady = () => !state.data.missing?.includes('shops');
function shopList() {
  const rows = (state.data.shops || []).filter((x) => x.name?.trim());
  const list = rows.length ? rows : [{ id: null, name: 'Lidl', is_default: true, sort: 0 }];
  return [...list].sort((a, b) => b.is_default - a.is_default || (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
}
const defaultShop = () => shopList()[0].name;
const shopOf = (i) => i.shop?.trim() || defaultShop();
const sameShop = (a, b) => normalize(a) === normalize(b);

// Neuen Laden anlegen (oder vorhandenen gleichen Namens zurückgeben)
function ensureShop(name) {
  name = name.trim();
  const hit = shopList().find((x) => sameShop(x.name, name));
  if (hit) return hit.name;
  if (!shopsReady()) return name;
  // Erster eigener Laden: den Standard (Lidl) mit anlegen, damit er in der Liste bleibt
  if (!(state.data.shops || []).length) save('shops', { name: defaultShop(), is_default: true, sort: 0 }, 'name', { quiet: true });
  save('shops', { name, is_default: false, sort: (state.data.shops || []).length }, 'name', { quiet: true });
  return name;
}

function shopsPanel() {
  const list = shopList();
  const used = (name) => state.data.shopping_items.filter((i) => !i.done && sameShop(shopOf(i), name)).length;
  openPanel(
    'Läden',
    `${shopsReady() ? '' : '<div class="banner">Datenbank-Update nötig: bitte supabase/update-14.sql in Supabase ausführen.</div>'}
    <form class="card add-item" data-form="add-shop">
      <input name="shop" placeholder="Neuer Laden, z. B. Rewe" autocomplete="off" enterkeyhint="done" required ${shopsReady() ? '' : 'disabled'} />
      <button class="btn primary" type="submit" aria-label="Laden hinzufügen" ${shopsReady() ? '' : 'disabled'}>${ic('plus')}</button>
    </form>
    <ul class="card shops-list">
      ${list
        .map(
          (x) => `<li><div class="shop-row">
            <span class="grow">${esc(x.name)} <span class="muted small">${used(x.name) ? `${used(x.name)} offen` : ''}</span></span>
            ${
              x.is_default
                ? '<span class="tag soft">Standard</span>'
                : x.id
                  ? `<button class="link" data-action="shop-default" data-id="${x.id}">Als Standard</button>
                     <button class="icon-btn" data-action="shop-delete" data-id="${x.id}" aria-label="${esc(x.name)} entfernen">${ic('close')}</button>`
                  : ''
            }
          </div></li>`
        )
        .join('')}
    </ul>
    <p class="muted small">Neue Artikel kommen in den Standard-Laden – außer du hast oben im Einkauf gerade einen Laden ausgewählt.</p>`
  );
}

function viewEinkauf() {
  const items = state.data.shopping_items;
  const quick = quickItems();
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done && (!state.shopFilter || sameShop(shopOf(i), state.shopFilter)));
  // Läden der offenen Artikel, häufigster zuerst; Filter nur, wenn es mehrere gibt
  const counts = new Map();
  for (const i of open) counts.set(shopOf(i), (counts.get(shopOf(i)) || 0) + 1);
  const shops = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Gewählter Laden bleibt, solange dort noch etwas steht (auch Abgehaktes)
  if (state.shopFilter && !items.some((i) => sameShop(shopOf(i), state.shopFilter))) state.shopFilter = null;
  const sf = state.shopFilter;
  if (sf && !counts.has(sf)) shops.push([sf, 0]);
  const mainShop = shops[0]?.[0];
  // Abgehaktes bleibt an seinem Platz stehen (durchgestrichen) – bis "Erledigte entfernen"
  const visible = items.filter((i) => !sf || sameShop(shopOf(i), sf));

  const row = (i) => `<li class="${i.done ? 'done' : ''}">
      <button class="check" data-action="toggle-item" data-id="${i.id}" aria-label="Abhaken">${i.done ? ic('check') : ''}</button>
      <span class="name" data-action="toggle-item" data-id="${i.id}">${esc(i.name)}${
        i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''
      }${!i.done && !sf && shops.length > 1 && shopOf(i) !== mainShop ? ` <span class="shop-tag">${esc(shopOf(i))}</span>` : ''}${
        i.note ? `<span class="item-note">${esc(i.note)}</span>` : ''
      }</span>
      <button class="icon-btn" data-action="edit-item" data-id="${i.id}" aria-label="Menge, Notiz, Laden oder Kategorie ändern">${ic('more')}</button>
    </li>`;

  const groups = CATEGORIES.map((cat) => {
    const list = visible.filter((i) => itemCategory(i) === cat.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return '';
    const left = list.filter((i) => !i.done).length;
    return `<div class="cat-sub ${left ? '' : 'all-done'}"><span class="cat-icon">${cat.icon}</span>${esc(cat.label)} <span class="muted">${left || ic('check')}</span></div>
      <ul class="shop-list" data-longpress="item">${list.map(row).join('')}</ul>`;
  }).join('');

  return `
    ${state.data.missing?.includes('products') ? '<div class="banner">Datenbank-Update nötig: bitte supabase/update-2.sql in Supabase ausführen.</div>' : ''}
    <form class="card add-item" data-form="add-item">
      <input name="name" placeholder="${sf ? `Was fehlt bei ${esc(sf)}?` : 'Was fehlt? z. B. 2 kg Äpfel'}" autocomplete="off" autocorrect="off" enterkeyhint="done" required />
      <button class="btn primary" type="submit" aria-label="Hinzufügen">${ic('plus')}</button>
    </form>
    <div class="suggest" id="suggest"></div>
    <div class="chip-row shop-filter">
      ${
        shops.length > 1
          ? `<button class="filter-chip ${sf ? '' : 'on'}" data-action="shop-filter" data-shop="">Alle <span class="n">${open.length}</span></button>
            ${shops.map(([s, n]) => `<button class="filter-chip ${sf === s ? 'on' : ''}" data-action="shop-filter" data-shop="${esc(s)}">${esc(s)} <span class="n">${n}</span></button>`).join('')}`
          : ''
      }
      <button class="filter-chip shops-btn" data-action="shops">${ic('pencil')}Läden</button>
    </div>
    ${groups ? `<div class="card shop-card">${groups}</div>` : '<p class="empty">Die Liste ist leer.</p>'}
    ${items.length && !open.length ? '<p class="muted small center shop-all-done">Alles erledigt 🎉</p>' : ''}
    ${
      quick.length
        ? `<section><h2>Häufig gekauft</h2><div class="quick">${quick
            .map(
              (q) => `<button class="quick-chip" data-action="quick-add" data-name="${esc(q.name)}">${ic('plus')}${esc(q.name)}</button>`
            )
            .join('')}</div></section>`
        : ''
    }
    <div class="shop-actions">
      ${visible.some((i) => !i.done) ? `<button class="btn ghost" data-action="copy-list">${ic('copy')}Liste kopieren</button>` : ''}
      ${done.length ? `<button class="btn ghost" data-action="clear-done">${ic('check')}Erledigte entfernen (${done.length})</button>` : ''}
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
    <div class="field-label">Laden</div>
    <div class="shop-pick">
      ${[...new Set([...shopList().map((x) => x.name), shopOf(item)])]
        .map((n) => `<label><input type="radio" name="shop" value="${esc(n)}" ${sameShop(n, shopOf(item)) ? 'checked' : ''}/><span>${esc(n)}</span></label>`)
        .join('')}
    </div>
    ${shopsReady() ? '<input name="shop_new" class="shop-new" placeholder="oder neuer Laden …" autocomplete="off" />' : ''}
    <details class="more-opts cat-opts">
      <summary>Kategorie ändern <span class="muted small">(${esc(categoryOf(current).icon + ' ' + categoryOf(current).label)})</span>${ic('down', 'sum-ic')}</summary>
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
        shop: f.get('shop_new')?.trim() ? ensureShop(f.get('shop_new')) : f.get('shop') || defaultShop(),
      });
      rememberProduct(name, category, { countUse: false });
      closeSheet();
    },
    `<button type="button" class="btn danger wide" data-action="delete-item" data-id="${item.id}">Artikel löschen</button>`,
    { compact: true }
  );
}

/* ---------- Benachrichtigungen ---------- */

/* ---------- Zurück-Geste (Android) ----------
   Die App führt einen eigenen Stapel (offene Fenster, vorherige Bildschirme).
   Solange er nicht leer ist, liegt ein Platzhalter im Browser-Verlauf: Zurück
   nimmt dann den obersten Schritt weg, statt die App zu verlassen. */
const nav = { stack: [], guarded: false, ignore: 0 };
// Scroll-Position stellt die App selbst wieder her (der Browser würde sie überschreiben)
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const navSnap = () => ({ type: 'view', view: state.view, date: state.date, personId: state.personId, noteId: state.noteId, cal: state.cal, scroll: window.scrollY });
const MAIN_TABS = ['heute', 'woche', 'kochbuch', 'einkauf', 'mehr'];

function navSync() {
  clearTimeout(nav.timer);
  if (nav.stack.length) {
    if (!nav.guarded) {
      history.pushState({ fo: 'guard' }, '');
      nav.guarded = true;
    }
  } else if (nav.guarded) {
    // Platzhalter etwas verzögert entfernen (sonst bräuchte es zweimal Zurück zum Verlassen).
    // Verzögert, weil oft direkt danach der nächste Schritt kommt (z. B. Fenster zu, Tag öffnen).
    nav.timer = setTimeout(() => {
      if (nav.stack.length || !nav.guarded) return;
      nav.guarded = false;
      nav.ignore++;
      history.back();
    }, 250);
  }
}
// Vor dem Wechsel auf einen neuen Bildschirm: aktuellen merken
function navPush() {
  nav.stack.push(navSnap());
  navSync();
}
function sheetOpened() {
  const already = document.body.classList.contains('sheet-open');
  document.body.classList.add('sheet-open');
  if (!already) {
    nav.stack.push({ type: 'sheet' });
    navSync();
  }
}
function navDrop(type) {
  if (nav.stack[nav.stack.length - 1]?.type === type) nav.stack.pop();
  navSync();
}
// Zurück-Knopf in der App: wie die Zurück-Geste
function navBack() {
  if (!nav.stack.length || nav.stack[nav.stack.length - 1].type !== 'view') return false;
  restoreView(nav.stack.pop());
  navSync();
  return true;
}
// Reiterwechsel: Hauptreiter liegen alle direkt "über" Heute, Unterseiten werden gestapelt
function navTab(tab) {
  if (!MAIN_TABS.includes(tab)) {
    navPush();
    return false;
  }
  if (tab === 'heute') {
    nav.stack = nav.stack.filter((x) => x.type === 'sheet');
  } else if (MAIN_TABS.includes(state.view) && state.view !== 'heute' && nav.stack.length) {
    // von Reiter zu Reiter: nur "zurück zu Heute" behalten
    nav.stack = nav.stack.slice(0, 1);
  } else if (state.view === 'heute') {
    nav.stack = [navSnap()];
  } else {
    // aus einer Unterseite (Person, Geburtstage) auf einen Hauptreiter
    const back = nav.stack.slice(0, 1);
    nav.stack = back.length ? back : [navSnap()];
  }
  navSync();
  return false;
}
function restoreView(snap) {
  state.view = snap.view;
  state.date = snap.date;
  state.personId = snap.personId;
  state.noteId = snap.noteId;
  state.noteEditing = null;
  state.cal = snap.cal;
  render();
  window.scrollTo(0, snap.scroll || 0);
  if (state.view === 'woche') updateListHeader();
}
window.addEventListener('popstate', () => {
  if (nav.ignore) {
    nav.ignore--;
    return;
  }
  nav.guarded = false;
  const top = nav.stack.pop();
  if (top?.type === 'sheet') closeSheet({ fromBack: true });
  else if (top) restoreView(top);
  navSync();
});

// Eintrag dieses Geräts (gefunden über die Push-Adresse des Browsers)
const pushRow = () => (state.pushEndpoint ? state.data.push_subscriptions?.find((p) => p.endpoint === state.pushEndpoint) : null);

async function refreshPush() {
  try {
    state.pushEndpoint = (await push.current())?.endpoint || null;
  } catch {
    state.pushEndpoint = null;
  }
  // Gerät hat die Person gewechselt → Eintrag nachziehen
  const row = pushRow();
  if (row && state.me && row.member_id !== state.me) save('push_subscriptions', { id: row.id, member_id: state.me }, 'id', { quiet: true });
  else render();
}

const LEAD_OPTIONS = [
  [15, '15 Min. vorher'],
  [30, '30 Min. vorher'],
  [60, '1 Std. vorher'],
  [120, '2 Std. vorher'],
  [-2, 'am Vortag (18 Uhr)'],
];

function pushSection() {
  const wrap = (inner) => `<section><h2>Benachrichtigungen</h2><div class="card pad push-card">${inner}</div></section>`;
  if (!store.isCloud) return wrap('<p class="muted small">Nur mit gemeinsamem Speicher (Supabase) möglich.</p>');
  if (state.data.missing?.includes('push_subscriptions'))
    return wrap('<p class="muted small">Datenbank-Update nötig: bitte supabase/update-12.sql in Supabase ausführen.</p>');
  if (!push.supported())
    return wrap(
      push.iosNeedsInstall()
        ? '<p class="small">Auf dem iPhone gehen Benachrichtigungen nur in der installierten App: in Safari „Teilen“ → „Zum Home-Bildschirm“, dann die App dort öffnen und hier aktivieren.</p>'
        : '<p class="muted small">Dieser Browser unterstützt keine Benachrichtigungen.</p>'
    );
  if (push.permission() === 'denied')
    return wrap('<p class="small">Benachrichtigungen sind für diese App blockiert. Bitte in den Einstellungen des Handys erlauben und die App neu öffnen.</p>');
  const row = pushRow();
  if (!row)
    return wrap(`
      <p class="small">Push-Nachrichten für Erinnerungen, Termine und Aufgaben – nur auf diesem Gerät${meMember() ? ` und für ${esc(meMember().name)}` : ''}.</p>
      <button class="btn primary wide" data-action="push-enable" ${state.me ? '' : 'disabled'}>${ic('bell')}Auf diesem Gerät aktivieren</button>
      ${state.me ? '' : '<p class="muted small">Zuerst unter „Dieses Handy → Ich bin“ auswählen, wer du bist.</p>'}`);
  const toggle = (k, label, hint) => `
    <label class="check-line push-toggle"><input type="checkbox" data-change="push" name="${k}" ${row[k] ? 'checked' : ''} />
      <span class="grow-col"><span>${label}</span><span class="muted small">${hint}</span></span></label>`;
  return wrap(`
    <p class="muted small with-ic push-on">${ic('check')}Aktiv auf diesem Gerät${meMember() ? ` für ${esc(meMember().name)}` : ''}</p>
    ${toggle('reminders', 'Erinnerungen', 'zur eingetragenen Uhrzeit')}
    ${toggle('events', 'Termine', 'mit Vorlauf, pro Termin änderbar')}
    ${row.events ? `<label class="push-sub">Vorlauf für Termine<select data-change="push" name="lead">${LEAD_OPTIONS.map(
      ([v, l]) => `<option value="${v}" ${Number(row.lead) === v ? 'selected' : ''}>${l}</option>`
    ).join('')}</select></label>` : ''}
    ${toggle('tasks', 'Aufgaben', 'einmal am Tag: deine offenen Aufgaben')}
    ${'assigned' in row ? toggle('assigned', 'Neu für mich', 'wenn jemand anderes dir einen Termin, eine Aufgabe oder Erinnerung einträgt') : ''}
    <label class="push-sub">Uhrzeit für die Aufgaben-Übersicht<input type="time" data-change="push" name="daily_time" value="${esc(D.hm(row.daily_time) || '07:00')}" />
      <span class="muted small">Gilt auch für Erinnerungen ohne Uhrzeit.</span></label>
    <button class="btn ghost wide" data-action="push-test">Test-Nachricht senden</button>
    <button class="link danger-link" data-action="push-disable">Auf diesem Gerät ausschalten</button>`);
}

function viewEintraege() {
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
      <div class="section-head"><h2>Erinnerungen</h2><button class="link" data-action="new-reminder">${ic('plus')}Erinnerung</button></div>
      <ul class="card list">
        ${
          reminders.length
            ? reminders
                .map(
                  (t) => `<li><button data-action="edit-task" data-id="${t.id}">
                    <span class="grow">${esc(t.title)} ${isRecurring(t) ? `<span class="muted rep">${ic('repeat')}</span>` : ''} ${chips(peopleOf(t))}</span>
                    <span class="muted small">${esc(when(t))}${t.due_time ? ` · ${D.hm(t.due_time)}` : ''}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Erinnerungen</li>'
        }
      </ul>
    </section>

    <section>
      <div class="section-head"><h2>Termine</h2><button class="link" data-action="new-event">${ic('plus')}Termin</button></div>
      <ul class="card list">
        ${
          events.length
            ? events
                .map(
                  (e) => `<li><button data-action="event-edit" data-id="${e.id}">
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
      <div class="section-head"><h2>Offene &amp; wiederkehrende Aufgaben</h2><button class="link" data-action="new-task">${ic('plus')}Aufgabe</button></div>
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

`;
}

// Mehr: Familie oben, dann Organisieren, dann was nur dieses Handy betrifft
function viewMehr() {
  const ms = members();
  const entries = state.data.events.length + state.data.tasks.length;
  const settingRow = (label, control, hint = '') => `
    <div class="set-row"><span class="grow-col"><span>${label}</span>${hint ? `<span class="muted small">${hint}</span>` : ''}</span>${control}</div>`;
  return `
    <section>
      <div class="section-head"><h2>Familie</h2><button class="link" data-action="new-member">${ic('plus')}Person</button></div>
      <ul class="card list">
        ${ms
          .map(
            (m) => `<li><button data-action="edit-member" data-id="${m.id}">
              ${avatar(m)}
              <span class="grow">${esc(m.name)} ${m.id === state.me ? '<span class="tag soft">Du</span>' : ''} <span class="muted small">${ROLES[m.role] || ''}</span></span>
              <span class="chev">${ic('right')}</span>
            </button></li>`
          )
          .join('')}
      </ul>
    </section>

    <section>
      <h2>Organisieren</h2>
      ${notesEntry()}
      ${birthdaysEntry()}
      ${wasteEntry()}
      <button class="card nav-row" data-action="tab" data-tab="eintraege">
        <span class="nav-icon">🗂️</span>
        <span class="grow-col"><span class="title">Alle Einträge</span><span class="muted small">${entries} Termine, Erinnerungen und Aufgaben verwalten</span></span>
        <span class="chev">${ic('right')}</span>
      </button>
    </section>

    <section>
      <h2>Dieses Handy</h2>
      <div class="card set-card">
        ${settingRow(
          'Ich bin',
          `<select data-change="me" aria-label="Ich bin">
            <option value="">– wählen –</option>
            ${ms.map((m) => `<option value="${m.id}" ${m.id === state.me ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
          </select>`,
          'für „Meine“ und Benachrichtigungen'
        )}
        ${settingRow(
          'Bundesland',
          `<select data-change="land" aria-label="Bundesland">
            <option value="" ${state.land ? '' : 'selected'}>aus</option>
            ${STATES.map(([k, n]) => `<option value="${k}" ${k === state.land ? 'selected' : ''}>${n}</option>`).join('')}
          </select>`,
          'für Ferien und Feiertage'
        )}
        <div class="set-row col">
          <span>Darstellung</span>
          <div class="seg wide theme-seg">
            ${[
              ['auto', 'Automatisch'],
              ['light', `${ic('heute')}Hell`],
              ['dark', `${ic('moon')}Dunkel`],
            ]
              .map(([k, l]) => `<button class="${(lsGet('fo-theme') || 'auto') === k ? 'on' : ''}" data-action="set-theme" data-theme="${k}">${l}</button>`)
              .join('')}
          </div>
        </div>
        <label class="set-row">
          <span class="grow-col"><span>Linie mit aktueller Uhrzeit</span><span class="muted small">im Tagesablauf auf „Heute“</span></span>
          <input type="checkbox" class="switch" data-change="nowline" ${lsGet('fo-nowline') === '1' ? 'checked' : ''} />
        </label>
      </div>
    </section>

    ${pushSection()}

    <section>
      <h2>App</h2>
      <div class="card pad">
        <p class="with-ic">${store.isCloud ? `${ic('cloud')}Gemeinsamer Speicher aktiv.` : `${ic('phone')}Lokaler Modus: Daten liegen nur auf diesem Gerät.`}</p>
        <p class="muted small">Installieren – iPhone: in Safari „Teilen“ → „Zum Home-Bildschirm“. Android: Menü → „App installieren“.</p>
        ${store.isCloud && state.session ? `<p class="muted small">Angemeldet als ${esc(state.session.user.email)}</p><button class="btn ghost" data-action="logout">Abmelden</button>` : ''}
      </div>
    </section>`;
}

/* ================= Neuigkeiten (Aktivitäten) ================= */

const activitiesReady = () => state.data && !state.data.missing?.includes('activities');
const shortDay = (k) => (k ? `${D.WD_SHORT[D.isoWeekday(k) - 1]} ${D.fromKey(k).getDate()}.${D.fromKey(k).getMonth() + 1}.` : '');

// Was hat sich an einem Termin geändert? → "17:30 → 18:00 · Ort: Dr. Meier"
function eventDiff(a, b) {
  const out = [];
  if (a.title !== b.title) out.push(`neuer Name (vorher „${a.title}“)`);
  if ((a.date || '') !== (b.date || '') && b.date) out.push(`${shortDay(a.date)} → ${shortDay(b.date)}`);
  if ((a.end_date || '') !== (b.end_date || '') && b.end_date) out.push(`bis ${shortDay(b.end_date)}`);
  if ((a.weekdays || []).join() !== (b.weekdays || []).join() && b.weekdays?.length) out.push(everyText(b.weekdays));
  const t = (x) => [D.hm(x.start_time), D.hm(x.end_time)].filter(Boolean).join('–') || 'ganztägig';
  if (t(a) !== t(b)) out.push(`${t(a)} → ${t(b)}`);
  if ((a.location || '') !== (b.location || '')) out.push(b.location ? `Ort: ${b.location}` : 'ohne Ort');
  const pa = eventPeople(a), pb = eventPeople(b);
  const added = pb.filter((x) => !pa.includes(x)), removed = pa.filter((x) => !pb.includes(x));
  if (added.length) out.push(`jetzt mit ${namesOf(added)}`);
  if (removed.length) out.push(`ohne ${namesOf(removed)}`);
  if ((a.notes || '') !== (b.notes || '')) out.push('Notiz geändert');
  return out.join(' · ');
}
function taskDiff(a, b) {
  const out = [];
  if (a.title !== b.title) out.push(`neuer Name (vorher „${a.title}“)`);
  if ((a.due_date || '') !== (b.due_date || '')) out.push(b.due_date ? `jetzt ${shortDay(b.due_date)}` : 'ohne Datum');
  if ((D.hm(a.due_time) || '') !== (D.hm(b.due_time) || '')) out.push(b.due_time ? `${D.hm(a.due_time) || '–'} → ${D.hm(b.due_time)}` : 'ohne Uhrzeit');
  const pa = peopleOf(a), pb = peopleOf(b);
  const added = pb.filter((x) => !pa.includes(x)), removed = pa.filter((x) => !pb.includes(x));
  if (added.length) out.push(`jetzt für ${namesOf(added)}`);
  if (removed.length) out.push(`nicht mehr für ${namesOf(removed)}`);
  if (rhythmText(a) !== rhythmText(b)) out.push(rhythmText(b) || 'nicht mehr wiederkehrend');
  return out.join(' · ');
}
const eventWhen = (e) =>
  [e.weekdays?.length ? everyText(e.weekdays) : e.end_date && e.end_date > e.date ? `${shortDay(e.date)} – ${shortDay(e.end_date)}` : shortDay(e.date), D.hm(e.start_time)].filter(Boolean).join(' · ');
const taskWhen = (t) => [isRecurring(t) ? rhythmText(t) : t.due_date ? shortDay(t.due_date) : '', D.hm(t.due_time), peopleOf(t).length ? `für ${namesOf(peopleOf(t))}` : ''].filter(Boolean).join(' · ');

// Aus einer Änderung (vorher → nachher) eine Neuigkeit machen; null = nicht erwähnenswert
function describeChange(table, a, b) {
  const row = b || a;
  if (!row) return null;
  const base = { entity_id: row.id, people: [], private: false };
  switch (table) {
    case 'events': {
      if (row.series_id) return b ? { ...base, entity: 'event', action: 'update', title: row.title, detail: `nur am ${shortDay(row.series_date)}${a ? ` · ${eventDiff(a, b)}` : ''}`, people: eventPeople(row) } : null;
      if (!a) return { ...base, entity: 'event', action: 'create', title: b.title, detail: eventWhen(b), people: eventPeople(b) };
      if (!b) return { ...base, entity: 'event', action: 'delete', title: a.title, detail: eventWhen(a), people: eventPeople(a) };
      const d = eventDiff(a, b);
      return d ? { ...base, entity: 'event', action: 'update', title: b.title, detail: d, people: eventPeople(b) } : null;
    }
    case 'event_occurrences': {
      const ev = state.data.events.find((e) => e.id === row.event_id);
      if (!ev || !b || !!a?.cancelled === !!b.cancelled) return null;
      return { ...base, entity: 'event', entity_id: ev.id, action: b.cancelled ? 'cancel' : 'uncancel', title: ev.title, detail: shortDay(b.date), people: eventPeople(ev) };
    }
    case 'tasks': {
      const entity = isReminder(row) ? 'reminder' : 'task';
      const priv = isReminder(row) && peopleOf(row).length > 0;
      const t = { ...base, entity, people: peopleOf(row), private: priv, title: row.title };
      if (!a) return { ...t, action: 'create', detail: taskWhen(b) };
      if (!b) return { ...t, action: 'delete', detail: '' };
      if (!a.done_at && b.done_at) return { ...t, action: 'done', detail: '' };
      if (a.done_at && !b.done_at) return null;
      const d = taskDiff(a, b);
      return d ? { ...t, action: 'update', detail: d } : null;
    }
    case 'task_completions': {
      const t = state.data.tasks.find((x) => x.id === row.task_id);
      if (!t || a || !b) return null; // nur Abhaken, nicht das Zurücknehmen
      return { ...base, entity: isReminder(t) ? 'reminder' : 'task', entity_id: t.id, action: 'done', title: t.title, detail: b.date !== D.todayKey() ? `für ${shortDay(b.date)}` : '', people: peopleOf(t), private: isReminder(t) && peopleOf(t).length > 0 };
    }
    case 'shopping_items':
      if (!a && b) return { ...base, entity: 'shop', action: 'add', title: b.name };
      if (a && b && !a.done && b.done) return { ...base, entity: 'shop', action: 'bought', title: b.name };
      return null;
    case 'meals':
      if (!b?.text || a?.text === b.text) return null;
      return { ...base, entity: 'meal', entity_id: b.date, action: 'plan', title: b.text, detail: shortDay(b.date) };
    case 'recipes':
      return !a && b ? { ...base, entity: 'recipe', action: 'create', title: b.title } : null;
    case 'notes':
      if (!a) return { ...base, entity: 'note', action: 'create', title: b.title };
      if (!b) return { ...base, entity: 'note', action: 'delete', title: a.title };
      return { ...base, entity: 'note', action: 'update', title: b.title };
    case 'birthdays':
      if (!a) return { ...base, entity: 'birthday', action: 'create', title: b.name, detail: `${b.day}. ${MONTHS[b.month - 1]}` };
      if (!b) return { ...base, entity: 'birthday', action: 'delete', title: a.name };
      return null;
    case 'members':
      return !a && b ? { ...base, entity: 'member', action: 'create', title: b.name } : null;
    case 'waste_pickups':
      return a && b && !a.put_out_at && b.put_out_at ? { ...base, entity: 'waste', action: 'out', title: binsText(b.bins) } : null;
    default:
      return null;
  }
}

function logChange(table, a, b) {
  if (!activitiesReady() || table === 'activities') return null;
  let act;
  try {
    act = describeChange(table, a, b);
  } catch (e) {
    console.warn('Neuigkeit nicht erstellt', e);
    return null;
  }
  if (!act) return null;
  // Mehrfaches Bearbeiten derselben Sache kurz hintereinander: nur einmal
  const last = (state.data.activities || [])[0];
  if (
    act.action === 'update' &&
    last &&
    last.actor === (state.me || null) &&
    last.entity_id === act.entity_id &&
    last.action === 'update' &&
    Date.now() - new Date(last.created_at) < 10 * 60000
  )
    return null;
  const row = { id: store.uuid(), actor: state.me || null, created_at: new Date().toISOString(), ...act };
  state.data.activities = [row, ...(state.data.activities || [])].slice(0, 1000);
  store.upsert('activities', row, 'id').catch((e) => console.warn('Neuigkeit nicht gespeichert', e));
  return row.id;
}

// Wer darf die Neuigkeit sehen? Private Erinnerungen nur Betroffene und wer sie angelegt hat
const canSeeActivity = (x) => !x.private || !state.me || x.actor === state.me || (x.people || []).includes(state.me);
const SEEN_KEY = 'fo-act-seen';
function activitySeen() {
  const v = lsGet(SEEN_KEY);
  if (v) return v;
  const now = new Date().toISOString(); // erstes Mal: nichts Altes als "neu" zählen
  lsSet(SEEN_KEY, now);
  return now;
}
function unseenCount() {
  if (!activitiesReady()) return 0;
  const seen = activitySeen();
  const fresh = (state.data.activities || [])
    .filter((x) => x.created_at > seen && x.actor !== state.me && canSeeActivity(x))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return bundled(fresh).length; // wie in der Liste: Gebündeltes zählt einmal
}
const bellButton = () => {
  if (!activitiesReady()) return '';
  const n = unseenCount();
  return `<button class="icon-btn bell-btn" data-action="activities" aria-label="Neuigkeiten${n ? ` (${n} neu)` : ''}">${ic('bell')}${n ? `<span class="bell-badge">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
};

// Gleiche Aktionen derselben Person kurz hintereinander zu einer Zeile bündeln
const BUNDLE = new Set(['shop:add', 'shop:bought', 'note:update']);
function bundled(list) {
  const out = [];
  for (const x of list) {
    const last = out[out.length - 1];
    const key = `${x.entity}:${x.action}`;
    if (
      last &&
      BUNDLE.has(key) &&
      last.key === key &&
      last.actor === x.actor &&
      (key !== 'note:update' || last.items[0].entity_id === x.entity_id) &&
      new Date(last.items[last.items.length - 1].created_at) - new Date(x.created_at) < 20 * 60000
    ) {
      last.items.push(x);
      continue;
    }
    out.push({ key, actor: x.actor, items: [x] });
  }
  return out;
}

function activityText(g) {
  const x = g.items[0];
  const n = g.items.length;
  const b = (t) => `<b>${esc(t)}</b>`;
  const kind = { task: 'die Aufgabe', reminder: 'die Erinnerung' }[x.entity];
  switch (`${x.entity}:${x.action}`) {
    case 'event:create': return `hat den Termin ${b(x.title)} angelegt`;
    case 'event:update': return `hat ${b(x.title)} geändert`;
    case 'event:delete': return `hat den Termin ${b(x.title)} gelöscht`;
    case 'event:cancel': return `hat ${b(x.title)} abgesagt`;
    case 'event:uncancel': return `hat ${b(x.title)} wieder eingeplant`;
    case 'task:create': case 'reminder:create': return `hat ${kind} ${b(x.title)} angelegt`;
    case 'task:update': case 'reminder:update': return `hat ${b(x.title)} geändert`;
    case 'task:delete': case 'reminder:delete': return `hat ${kind} ${b(x.title)} gelöscht`;
    case 'task:done': case 'reminder:done': return `hat ${b(x.title)} erledigt ✓`;
    case 'shop:add': return n > 1 ? `hat ${n} Artikel auf die Einkaufsliste gesetzt` : `hat ${b(x.title)} auf die Einkaufsliste gesetzt`;
    case 'shop:bought': return n > 1 ? `hat eingekauft: ${n} Artikel` : `hat ${b(x.title)} eingekauft`;
    case 'meal:plan': return `hat ${b(x.title)} eingeplant`;
    case 'recipe:create': return `hat ein neues Rezept angelegt: ${b(x.title)}`;
    case 'note:create': return `hat die Notiz ${b(x.title)} angelegt`;
    case 'note:update': return `hat die Notiz ${b(x.title)} bearbeitet`;
    case 'note:delete': return `hat die Notiz ${b(x.title)} gelöscht`;
    case 'birthday:create': return `hat den Geburtstag von ${b(x.title)} eingetragen`;
    case 'birthday:delete': return `hat den Geburtstag von ${b(x.title)} gelöscht`;
    case 'member:create': return `hat ${b(x.title)} zur Familie hinzugefügt`;
    case 'waste:out': return `hat ${b(x.title)} rausgestellt`;
    default: return `hat ${b(x.title || 'etwas')} geändert`;
  }
}
function activityDetail(g) {
  const x = g.items[0];
  if (g.items.length > 1 && x.entity === 'shop') {
    const names = g.items.map((i) => i.title).reverse(); // in der Reihenfolge, wie sie eingetragen wurden
    return names.slice(0, 5).join(', ') + (names.length > 5 ? ` und ${names.length - 5} weitere` : '');
  }
  return x.detail || '';
}
function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const d = new Date(iso);
  return `${D.pad(d.getHours())}:${D.pad(d.getMinutes())}`;
}

// Antippen: das Ding öffnen, falls es noch da ist
function activityTarget(x) {
  const id = x.entity_id;
  if (x.action === 'delete') return '';
  if (x.entity === 'event' && state.data.events.some((e) => e.id === id)) return `data-action="act-open" data-kind="event" data-id="${id}"`;
  if ((x.entity === 'task' || x.entity === 'reminder') && state.data.tasks.some((t) => t.id === id)) return `data-action="act-open" data-kind="task" data-id="${id}"`;
  if (x.entity === 'recipe' && state.data.recipes.some((r) => r.id === id)) return `data-action="act-open" data-kind="recipe" data-id="${id}"`;
  if (x.entity === 'note' && (state.data.notes || []).some((n) => n.id === id)) return `data-action="act-open" data-kind="note" data-id="${id}"`;
  if (x.entity === 'birthday' && state.data.birthdays.some((b) => b.id === id)) return `data-action="act-open" data-kind="birthday" data-id="${id}"`;
  if (x.entity === 'shop') return 'data-action="act-open" data-kind="tab" data-id="einkauf"';
  if (x.entity === 'waste') return 'data-action="act-open" data-kind="tab" data-id="abfall"';
  if (x.entity === 'meal') return `data-action="act-open" data-kind="day" data-id="${esc(x.entity_id)}"`;
  return '';
}

function activitiesHtml() {
  const f = state.actFilter || { mine: false, own: false };
  const seen = state.actSeenBefore || activitySeen();
  const list = (state.data.activities || [])
    .filter(canSeeActivity)
    .filter((x) => f.own || x.actor !== state.me || !state.me)
    .filter((x) => !f.mine || (x.people || []).includes(state.me))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups = bundled(list);
  let day = '';
  const rows = groups
    .map((g) => {
      const x = g.items[0];
      const k = D.toKey(new Date(x.created_at));
      const rel = D.relativeLabel(k);
      const head = k !== day ? `<li class="act-day">${rel === 'Heute' || rel === 'Gestern' ? rel : D.formatLong(k)}</li>` : '';
      day = k;
      const who = member(x.actor);
      const target = activityTarget(x);
      const tag = target ? 'button' : 'div';
      return `${head}<li class="act ${x.created_at > seen && x.actor !== state.me ? 'new' : ''} ${x.action === 'delete' ? 'gone' : ''}">
        <${tag} class="act-row" ${target}>
          ${who ? avatar(who, 'small') : '<span class="av av-initial small" style="--c:#999">?</span>'}
          <span class="act-main"><span class="act-text"><b>${esc(who?.name || 'Jemand')}</b> ${activityText(g)}</span>
            ${activityDetail(g) ? `<span class="muted small act-detail">${esc(activityDetail(g))}</span>` : ''}</span>
          <span class="muted small act-time">${esc(timeAgo(g.items[g.items.length - 1].created_at === x.created_at ? x.created_at : x.created_at))}</span>
        </${tag}></li>`;
    })
    .join('');
  return `
    <div class="chip-row act-filter">
      <button type="button" class="filter-chip ${f.mine ? '' : 'on'}" data-action="act-filter" data-k="all">Alle</button>
      <button type="button" class="filter-chip ${f.mine ? 'on' : ''}" data-action="act-filter" data-k="mine">Betrifft mich</button>
      <button type="button" class="filter-chip ${f.own ? 'on' : ''}" data-action="act-filter" data-k="own">Eigene anzeigen</button>
    </div>
    ${rows ? `<ul class="card act-list">${rows}</ul>` : `<p class="empty">${f.mine ? 'Nichts Neues, das dich betrifft.' : 'Noch nichts Neues von den anderen.'}</p>`}
    <p class="muted small center">Neuigkeiten der letzten 30 Tage</p>`;
}

function openActivities() {
  state.actSeenBefore = activitySeen(); // "neu" bleibt markiert, solange das Fenster offen ist
  openPanel('Neuigkeiten', `<div id="act-body">${activitiesHtml()}</div>`);
  lsSet(SEEN_KEY, new Date().toISOString());
}

/* ================= Abfallkalender ================= */

// Tonnen: Vorgabe, von der Familie änderbar (app_settings 'waste_bins')
const DEFAULT_BINS = [
  { k: 'rest', label: 'Restmüll', color: '#1f2328', words: ['rest', 'grau', 'schwarz', 'hausmüll'] },
  { k: 'bio', label: 'Biotonne', color: '#2f9e44', words: ['bio', 'braun', 'grün', 'kompost'] },
  { k: 'papier', label: 'Papier', color: '#2563eb', words: ['papier', 'blau', 'pappe', 'ppk'] },
  { k: 'gelb', label: 'Gelbe Tonne', color: '#e3b008', words: ['gelb', 'wertstoff', 'verpackung', 'lvp'] },
  { k: 'sonst', label: 'Sonstiges', color: '#ea580c', words: ['sperr', 'schadstoff', 'baum', 'grünschnitt'] },
];
const BIN_COLORS = ['#1f2328', '#6b7480', '#2f9e44', '#8a5a2b', '#2563eb', '#e3b008', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#0891b2', '#a3a3a3'];
const bins = () => {
  const list = (state.data.app_settings || []).find((x) => x.key === 'waste_bins')?.value?.list;
  return Array.isArray(list) && list.length ? list : DEFAULT_BINS;
};
const saveBins = (list) => save('app_settings', { key: 'waste_bins', value: { list } }, 'key', { quiet: true });
const binOf = (k) => bins().find((b) => b.k === k) || { k, label: k, color: '#a3a3a3', words: [] };
const wasteReady = () => !state.data.missing?.includes('waste_pickups');
const binIcon = (k, cls = '', color = null) =>
  `<svg class="bin ${cls}" viewBox="0 0 24 24" aria-hidden="true" style="color:${esc(color || binOf(k).color)}"><rect x="4" y="3" width="16" height="3.2" rx="1.2" fill="currentColor"/><path d="M5.6 7.6h12.8l-1.2 12.6a1.6 1.6 0 0 1-1.6 1.4H8.4a1.6 1.6 0 0 1-1.6-1.4z" fill="currentColor"/><path d="M10 10.5v8M14 10.5v8" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const binsText = (bins) => (bins || []).map((k) => binOf(k).label).join(' + ');
const binsIcons = (bins) => `<span class="bins">${(bins || []).map((k) => binIcon(k)).join('')}</span>`;

// Gemeinsame Einstellung: am Vortag erinnern, Uhrzeit, wer
function wasteSettings() {
  const row = (state.data.app_settings || []).find((x) => x.key === 'waste');
  const adults = members().filter((m) => m.role !== 'kind').map((m) => m.id);
  return { on: true, time: '19:00', people: adults, ...(row?.value || {}) };
}
function saveWasteSettings(patch) {
  const value = { ...wasteSettings(), ...patch };
  save('app_settings', { key: 'waste', value }, 'key', { quiet: true });
}
const pickupOn = (day) => (state.data.waste_pickups || []).find((p) => p.date === day && p.bins?.length);
const upcomingPickups = () => [...(state.data.waste_pickups || [])].filter((p) => p.date >= D.todayKey()).sort((a, b) => a.date.localeCompare(b.date));

// Für den Tagesablauf: am Vortag zur eingestellten Uhrzeit "rausstellen"
function wasteFlowItem(day) {
  const s = wasteSettings();
  const p = pickupOn(D.addDays(day, 1));
  if (!p || !s.on) return null;
  return { type: 'waste', p, sort: s.time || '19:00', past: !!p.put_out_at };
}
function wasteFlowRow(it) {
  const { p } = it;
  const s = wasteSettings();
  const by = p.put_out_by && member(p.put_out_by);
  return `<div class="frow rem waste ${p.put_out_at ? 'done' : ''}">
    <button class="fr-open" data-action="tab" data-tab="abfall">
      <span class="fr-time">${esc(s.time || '19:00')}</span>
      <span class="fr-body"><span class="fr-title title">${ic('bell')}${esc(binsText(p.bins))} rausstellen${binsIcons(p.bins)}</span>
      <span class="fr-sub">Abholung morgen${p.note ? ` · ${esc(p.note)}` : ''}${p.put_out_at && by ? ` · erledigt von ${esc(by.name)}` : ''}</span></span>
    </button>
    ${avatarStack(s.people || [])}
    <button class="check" data-action="waste-out" data-id="${p.id}" aria-label="Rausgestellt">${p.put_out_at ? ic('check') : ''}</button>
  </div>`;
}

// Wie eine Erinnerung in Aufgabenlisten (Monat): Kreis zum Abhaken, Uhrzeit, Personen
function wasteTaskRow(it) {
  const { p } = it;
  const s = wasteSettings();
  return `<li class="task ${p.put_out_at ? 'done' : ''}">
    <button class="check" data-action="waste-out" data-id="${p.id}" aria-label="Rausgestellt">${p.put_out_at ? ic('check') : ''}</button>
    <button class="task-main" data-action="tab" data-tab="abfall">
      <span class="title">${esc(binsText(p.bins))} rausstellen${binsIcons(p.bins)}</span>
      <span class="meta"><span class="tag time">${ic('clock')}${esc(s.time || '19:00')}</span>${chips(s.people || [])}</span>
    </button>
  </li>`;
}

// Text oder Kalenderdatei (.ics) → Abholtage { date, bins[] }
function parseWaste(text) {
  const byDate = new Map();
  const add = (date, label) => {
    const l = (label || '').toLowerCase();
    const list = bins();
    const words = (b) => [...(b.words || []), b.label.toLowerCase()];
    let hits = list.filter((b) => words(b).some((w) => w && l.includes(w))).map((b) => b.k);
    if (hits.length > 1) hits = hits.filter((k) => k !== 'sonst'); // genauere Tonne gewinnt
    const found = hits.length ? hits : [(list.find((b) => b.k === 'sonst') || list[list.length - 1]).k];
    const cur = byDate.get(date) || new Set();
    found.forEach((b) => cur.add(b));
    byDate.set(date, cur);
  };
  if (/BEGIN:VEVENT/.test(text)) {
    for (const block of text.split('BEGIN:VEVENT').slice(1)) {
      const d = block.match(/DTSTART[^:\n]*:(\d{4})(\d{2})(\d{2})/);
      const sum = (block.match(/\nSUMMARY[^:\n]*:(.*)/) || [])[1] || '';
      if (d) add(`${d[1]}-${d[2]}-${d[3]}`, sum.replace(/\\,/g, ','));
    }
  } else {
    for (const line of text.split('\n')) {
      let m = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
      let date = null;
      if (m) date = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${D.pad(Number(m[2]))}-${D.pad(Number(m[1]))}`;
      else if ((m = line.match(/(\d{4})-(\d{2})-(\d{2})/))) date = `${m[1]}-${m[2]}-${m[3]}`;
      if (date) add(date, line.replace(m[0], ''));
    }
  }
  return [...byDate.entries()].map(([date, found]) => ({ date, bins: bins().map((b) => b.k).filter((k) => found.has(k)) })).sort((a, b) => a.date.localeCompare(b.date));
}

// Bisherige Müll-Erinnerungen (aus dem SQL) erkennen: Erinnerung am Vortag mit "rausstellen"
const oldWasteReminders = () =>
  state.data.tasks.filter((t) => t.kind === 'erinnerung' && t.due_date && /rausstellen/i.test(t.notes || '') && t.due_date >= D.addDays(D.todayKey(), -1));

function wasteEntry() {
  const next = upcomingPickups()[0];
  const preview = !wasteReady()
    ? 'Datenbank-Update nötig (update-16.sql)'
    : next
      ? `Nächste Abholung: ${D.relativeLabel(next.date) === 'Morgen' ? 'morgen' : D.formatShort(next.date)} · ${binsText(next.bins)}`
      : 'Abholtage eintragen, Erinnerung am Vortag';
  return `<button class="card nav-row" data-action="tab" data-tab="abfall">
    <span class="nav-icon">🗑️</span>
    <span class="grow-col"><span class="title">Abfallkalender</span><span class="muted small">${esc(preview)}</span></span>
    <span class="chev">${ic('right')}</span>
  </button>`;
}

function viewAbfall() {
  if (!wasteReady()) return '<div class="banner">Datenbank-Update nötig: bitte supabase/update-16.sql in Supabase ausführen.</div>';
  const s = wasteSettings();
  const list = state.wastePast
    ? [...(state.data.waste_pickups || [])].sort((a, b) => a.date.localeCompare(b.date))
    : upcomingPickups();
  const next = upcomingPickups()[0];
  const old = oldWasteReminders();
  const rel = (day) => {
    const r = D.relativeLabel(day);
    return ['Heute', 'Morgen', 'Übermorgen'].includes(r) ? r : `in ${Math.round((D.fromKey(day) - D.fromKey(D.todayKey())) / 86400000)} Tagen`;
  };
  let month = '';
  const rows = list
    .map((p) => {
      const m = p.date.slice(0, 7);
      const head = m !== month ? `<li class="bd-month">${MONTHS[Number(p.date.slice(5, 7)) - 1]}${p.date.slice(0, 4) !== D.todayKey().slice(0, 4) ? ` ${p.date.slice(0, 4)}` : ''}</li>` : '';
      month = m;
      return `${head}<li><button class="waste-row ${p.date < D.todayKey() ? 'past' : ''}" data-action="waste-edit" data-id="${p.id}">
        <span class="wr-date"><b>${D.WD_SHORT[D.isoWeekday(p.date) - 1]} ${D.fromKey(p.date).getDate()}.</b></span>
        ${binsIcons(p.bins)}
        <span class="grow-col"><span>${esc(binsText(p.bins))}</span>${p.note ? `<span class="muted small">${esc(p.note)}</span>` : ''}</span>
      </button></li>`;
    })
    .join('');
  return `
    ${
      old.length
        ? `<div class="card pad waste-migrate">
            <p><b>${old.length} Müll-Erinnerungen gefunden</b></p>
            <p class="muted small">In den Abfallkalender übernehmen? Danach erinnert die App automatisch am Vortag, die einzelnen Erinnerungen werden gelöscht.</p>
            <button class="btn primary wide" data-action="waste-migrate">Übernehmen</button>
          </div>`
        : ''
    }
    ${
      next
        ? `<div class="card pad waste-next">
            <span class="muted small">Nächste Abholung · ${esc(rel(next.date))}</span>
            <div class="wn-main">${binsIcons(next.bins)}<span><b>${esc(binsText(next.bins))}</b><span class="muted">${esc(D.formatLong(next.date))}</span></span></div>
            ${next.note ? `<p class="muted small">${esc(next.note)}</p>` : ''}
          </div>`
        : ''
    }
    <section>
      <h2>Erinnerung</h2>
      <div class="card set-card">
        <label class="set-row">
          <span class="grow-col"><span>Am Vortag erinnern</span><span class="muted small">auf Heute und per Push</span></span>
          <input type="checkbox" class="switch" data-change="waste-on" ${s.on ? 'checked' : ''} />
        </label>
        ${
          s.on
            ? `<div class="set-row"><span class="grow-col"><span>Uhrzeit</span></span><input type="time" class="waste-time" data-change="waste-time" value="${esc(s.time || '19:00')}" /></div>
               <div class="set-row col"><span>Wer wird erinnert?</span>
                 <div class="waste-people">${members()
                   .map((m) => `<button class="wp ${s.people?.includes(m.id) ? 'on' : ''}" data-action="waste-person" data-id="${m.id}">${avatar(m, 'xs')}${esc(m.name)}</button>`)
                   .join('')}</div></div>`
            : ''
        }
      </div>
    </section>
    <section>
      <div class="section-head"><h2>Tonnen</h2><button class="link" data-action="bin-new">${ic('plus')}Tonne</button></div>
      <div class="card bin-list">${bins()
        .map((b) => `<button class="bin-chip" data-action="bin-edit" data-k="${esc(b.k)}">${binIcon(b.k)}<span>${esc(b.label)}</span></button>`)
        .join('')}</div>
    </section>
    <section>
      <div class="section-head"><h2>Abholtage</h2><button class="link" data-action="waste-import">${ic('copy')}Mehrere einfügen</button></div>
      ${
        list.length
          ? `<ul class="card list waste-list">${rows}</ul>`
          : `<div class="card pad"><p class="muted small">Noch keine Abholtage. Oben mit + einzeln eintragen oder mit „Mehrere einfügen“ den Abfuhrkalender deiner Gemeinde übernehmen.</p></div>`
      }
      ${(state.data.waste_pickups || []).some((p) => p.date < D.todayKey()) ? `<p class="center"><button class="link" data-action="waste-past">${state.wastePast ? 'Vergangene ausblenden' : 'Vergangene anzeigen'}</button></p>` : ''}
    </section>`;
}

function wasteForm(p) {
  const isNew = !p;
  p ||= { date: D.addDays(D.todayKey(), 1), bins: [] };
  openSheet(
    isNew ? 'Abholtag' : 'Abholtag bearbeiten',
    `<label>Datum der Abholung<input type="date" name="date" value="${esc(p.date)}" required /></label>
     <div class="field-label">Welche Tonnen?</div>
     <div class="bin-pick">${bins().map(
       (b) => `<label><input type="checkbox" name="bin" value="${b.k}" ${p.bins?.includes(b.k) ? 'checked' : ''}/><span>${binIcon(b.k)}${b.label}</span></label>`
     ).join('')}</div>
     <label>Notiz <span class="muted small">(optional)</span><input name="note" value="${esc(p.note || '')}" placeholder="z. B. vorgezogen, bis 6 Uhr rausstellen" /></label>`,
    (f) => {
      const bins = f.getAll('bin');
      if (!bins.length) return toast('Bitte mindestens eine Tonne wählen.');
      const date = f.get('date');
      const other = (state.data.waste_pickups || []).find((x) => x.date === date && x.id !== p.id);
      if (other) return toast(`Am ${D.formatShort(date)} gibt es schon einen Abholtag.`);
      save('waste_pickups', { ...(p.id ? { id: p.id } : {}), date, bins, note: f.get('note').trim() || null });
      closeSheet();
    },
    isNew ? '' : `<button type="button" class="btn danger wide" data-action="waste-delete" data-id="${p.id}">Abholtag löschen</button>`,
    { compact: true }
  );
}

function binForm(b) {
  const isNew = !b;
  b ||= { k: '', label: '', color: BIN_COLORS[10], words: [] };
  const used = (state.data.waste_pickups || []).filter((p) => p.bins?.includes(b.k) && p.date >= D.todayKey()).length;
  openSheet(
    isNew ? 'Neue Tonne' : 'Tonne bearbeiten',
    `<label>Name<input name="label" value="${esc(b.label)}" required placeholder="z. B. Glas, Grünschnitt, Sperrmüll" /></label>
     <div class="field-label">Farbe</div>
     <div class="color-pick">${[...new Set([...BIN_COLORS, b.color])]
       .map((c) => `<label><input type="radio" name="color" value="${c}" ${c === b.color ? 'checked' : ''}/><span style="--c:${c}">${binIcon(null, '', c)}</span></label>`)
       .join('')}</div>
     <label class="plain own-color">Eigene Farbe <input type="color" name="custom" value="${esc(b.color)}" /></label>
     <label>Erkennungswörter <span class="muted small">– fürs Einfügen aus Text/Kalenderdatei, mit Komma</span>
       <input name="words" value="${esc((b.words || []).join(', '))}" placeholder="z. B. glas, altglas" /></label>`,
    (f) => {
      const label = f.get('label').trim();
      if (!label) return;
      const color = f.get('color') || f.get('custom') || b.color;
      const words = (f.get('words') || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      const list = bins().map((x) => ({ ...x }));
      if (isNew) list.push({ k: `t${Date.now().toString(36)}`, label, color, words });
      else Object.assign(list.find((x) => x.k === b.k), { label, color, words });
      saveBins(list);
      closeSheet();
    },
    isNew
      ? ''
      : `<button type="button" class="btn danger wide" data-action="bin-delete" data-k="${esc(b.k)}">Tonne entfernen${used ? ` (steht an ${used} ${used === 1 ? 'Abholtag' : 'Abholtagen'})` : ''}</button>`,
    { compact: true }
  );
}

function wasteImport() {
  openSheet(
    'Mehrere Abholtage einfügen',
    `<p class="muted small">Entweder die <b>Kalenderdatei (.ics)</b> deiner Gemeinde wählen oder Termine als Text einfügen, eine Zeile pro Termin, z. B.<br />„27.10.2026 Biotonne“ · „03.11.2026 Restmüll, Papier“</p>
     <label class="btn ghost wide file-btn">${ic('calendar')}Kalenderdatei wählen<input type="file" id="waste-file" accept=".ics,text/calendar" hidden /></label>
     <label>Oder Text<textarea name="text" id="waste-text" rows="7" placeholder="27.10.2026 Biotonne&#10;03.11.2026 Restmüll, Papier"></textarea></label>
     <p class="muted small" id="waste-preview"></p>`,
    (f) => {
      const found = parseWaste(f.get('text') || '');
      if (!found.length) return toast('Keine Termine erkannt.');
      let n = 0;
      for (const x of found) {
        const cur = (state.data.waste_pickups || []).find((p) => p.date === x.date);
        const bins = [...new Set([...(cur?.bins || []), ...x.bins])];
        save('waste_pickups', { ...(cur ? { id: cur.id } : {}), date: x.date, bins }, 'id', { quiet: true });
        n++;
      }
      closeSheet();
      toast(`${n} ${n === 1 ? 'Abholtag' : 'Abholtage'} übernommen`);
    }
  );
}

/* ================= Notizen ================= */

const NOTE_EMOJIS = ['📝', '🧳', '🏠', '🎁', '🛠️', '👕', '🏊', '🎉', '🍳', '💊', '📚', '🚗', '🎄', '⭐', '📞', '🐾'];
const notesReady = () => !state.data.missing?.includes('notes');
const noteItems = (n) => (Array.isArray(n.items) ? n.items : []);
const noteProgress = (n) => {
  const items = noteItems(n).filter((x) => !x.head);
  return { done: items.filter((x) => x.done).length, total: items.length };
};
const sortedNotes = () =>
  [...(state.data.notes || [])].sort((a, b) => b.pinned - a.pinned || (b.updated_at || '').localeCompare(a.updated_at || ''));
const noteId = () => Math.random().toString(36).slice(2, 10);

// "heute 16:20", "gestern", "12.10." (bzw. mit Jahr)
function whenShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const key = D.toKey(d);
  const rel = D.relativeLabel(key);
  if (rel === 'Heute') return `heute ${D.pad(d.getHours())}:${D.pad(d.getMinutes())}`;
  if (rel === 'Gestern') return 'gestern';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', ...(key.slice(0, 4) !== D.todayKey().slice(0, 4) ? { year: 'numeric' } : {}) });
}
const byName = (id) => member(id)?.name || '';

// Vorschauzeile in der Übersicht
function notePreview(n) {
  if (n.kind === 'liste') {
    const open = noteItems(n).filter((x) => !x.head && !x.done).map((x) => x.text);
    return open.length ? open.slice(0, 4).join(' · ') : noteItems(n).length ? 'Alles abgehakt' : 'Noch leer';
  }
  return (n.body || '').replace(/\s+/g, ' ').trim() || 'Noch leer';
}

function saveNote(n, patch) {
  return save('notes', { id: n.id, ...patch, updated_at: new Date().toISOString(), updated_by: state.me || null });
}

// Text-Notiz: beim Tippen kurz warten, dann speichern (und beim Verlassen sofort)
let noteTimer;
function saveNoteBody(t) {
  clearTimeout(noteTimer);
  const n = (state.data.notes || []).find((x) => x.id === t.dataset.id);
  if (n && (n.body || '') !== t.value) saveNote(n, { body: t.value });
}
const autoGrow = (t) => {
  t.style.height = 'auto';
  t.style.height = `${Math.max(t.scrollHeight, 160)}px`;
};

function notesEntry() {
  const list = sortedNotes();
  const preview = !notesReady()
    ? 'Datenbank-Update nötig (update-15.sql)'
    : list.length
      ? `${list.length} ${list.length === 1 ? 'Notiz' : 'Notizen'} · zuletzt: ${list[0].title}`
      : 'Listen und Infos für die ganze Familie';
  return `<button class="card nav-row" data-action="tab" data-tab="notizen">
    <span class="nav-icon">📝</span>
    <span class="grow-col"><span class="title">Notizen</span><span class="muted small">${esc(preview)}</span></span>
    <span class="chev">${ic('right')}</span>
  </button>`;
}

function noteRow(n) {
  const p = noteProgress(n);
  const search = [n.title, n.body || '', ...noteItems(n).map((x) => x.text)].join(' ').toLowerCase();
  return `<li data-search="${esc(search)}"><button class="note-row" data-action="open-note" data-id="${n.id}">
    <span class="note-emoji">${esc(n.emoji || '📝')}</span>
    <span class="grow-col"><span class="title">${esc(n.title)}</span><span class="muted small note-prev">${esc(notePreview(n))}</span></span>
    ${n.kind === 'liste' && p.total ? `<span class="note-prog ${p.done === p.total ? 'full' : ''}">${p.done}/${p.total}</span>` : ''}
  </button></li>`;
}

function viewNotizen() {
  if (!notesReady()) return '<div class="banner">Datenbank-Update nötig: bitte supabase/update-15.sql in Supabase ausführen.</div>';
  const f = state.noteFilter || 'alle';
  const all = sortedNotes();
  const list = all.filter((n) => f === 'alle' || (f === 'liste' ? n.kind === 'liste' : n.kind !== 'liste'));
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  const count = (k) => all.filter((n) => (k === 'liste' ? n.kind === 'liste' : n.kind !== 'liste')).length;
  if (!all.length)
    return `<div class="card pad note-empty">
      <p><b>Noch keine Notizen.</b></p>
      <p class="muted small">Für alles ohne Datum: Packlisten, wichtige Nummern, Geschenkideen, Kleidergrößen …</p>
      <button class="btn primary wide" data-action="new-note">${ic('plus')}Erste Notiz anlegen</button>
    </div>`;
  return `
    <input type="search" id="note-search" placeholder="Notizen durchsuchen …" autocomplete="off" />
    <div class="chip-row">
      ${[
        ['alle', `Alle ${all.length}`],
        ['liste', `Listen ${count('liste')}`],
        ['text', `Infos ${count('text')}`],
      ]
        .map(([k, l]) => `<button class="filter-chip ${f === k ? 'on' : ''}" data-action="note-filter" data-f="${k}">${l}</button>`)
        .join('')}
    </div>
    ${pinned.length ? `<section><h2>📌 Angeheftet</h2><ul class="card list notes-list">${pinned.map(noteRow).join('')}</ul></section>` : ''}
    ${rest.length ? `<section>${pinned.length ? '<h2>Alle Notizen</h2>' : ''}<ul class="card list notes-list">${rest.map(noteRow).join('')}</ul></section>` : ''}
    ${!list.length ? '<p class="empty">Keine Notizen in dieser Auswahl.</p>' : ''}
    <p class="empty note-none" hidden>Nichts gefunden.</p>`;
}

// Telefonnummern, E-Mails und Links antippbar machen
function linkify(text) {
  return esc(text)
    .replace(/\b(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g, '<a href="mailto:$1">$1</a>')
    .replace(/(^|[\s(:])((?:\+|0)[\d][\d /-]{5,}\d)/g, (m, pre, num) => `${pre}<a href="tel:${num.replace(/[^\d+]/g, '')}">${num}</a>`);
}

function viewNotiz() {
  const n = (state.data.notes || []).find((x) => x.id === state.noteId);
  if (!n) return '<p class="empty">Diese Notiz gibt es nicht mehr.</p>';
  const meta = [
    `angelegt ${whenShort(n.created_at)}${byName(n.created_by) ? ` von ${esc(byName(n.created_by))}` : ''}`,
    n.updated_at && n.updated_at !== n.created_at ? `geändert ${whenShort(n.updated_at)}${byName(n.updated_by) ? ` von ${esc(byName(n.updated_by))}` : ''}` : '',
  ].filter(Boolean);
  const head = `<p class="note-meta muted small">${meta.join(' · ')}
    <button class="link note-pin" data-action="note-pin" data-id="${n.id}">${n.pinned ? '📌 angeheftet' : 'anheften'}</button></p>`;
  if (n.kind !== 'liste') {
    return `${head}
      ${
        state.noteEditing === n.id
          ? `<textarea id="note-body" class="note-body-edit" data-id="${n.id}" placeholder="Hier schreiben …">${esc(n.body || '')}</textarea>
             <button class="btn primary wide" data-action="note-done">Fertig</button>`
          : `<div class="card pad note-text" data-action="note-edit-body" data-id="${n.id}">${
              n.body?.trim() ? linkify(n.body).replace(/\n/g, '<br />') : '<span class="muted">Antippen zum Schreiben …</span>'
            }</div>
             <p class="muted small center">Zum Ändern auf den Text tippen. Nummern und Adressen sind antippbar.</p>`
      }`;
  }
  const items = noteItems(n);
  const p = noteProgress(n);
  return `${head}
    <div class="card note-list">
      ${items
        .map((x) =>
          x.head
            ? `<div class="nl-head">${esc(x.text)}</div>`
            : `<button class="nl-item ${x.done ? 'done' : ''}" data-action="note-toggle" data-id="${n.id}" data-item="${x.id}">
                <span class="nl-box">${x.done ? ic('check') : ''}</span><span class="nl-text">${esc(x.text)}</span></button>`
        )
        .join('')}
      <form class="nl-add" data-form="note-add" data-id="${n.id}">
        <span class="nl-plus">${ic('plus')}</span>
        <input name="text" placeholder="Punkt hinzufügen" autocomplete="off" enterkeyhint="done" />
      </form>
    </div>
    ${items.some((x) => x.head) || items.length > 8 ? '' : '<p class="muted small nl-tip">Tipp: Mit Doppelpunkt am Ende wird es eine Überschrift, z. B. „Bad:“.</p>'}
    ${
      p.total
        ? `<div class="note-actions">
            ${p.done ? `<button class="btn ghost" data-action="note-reset" data-id="${n.id}">${ic('repeat')}Haken zurücksetzen</button>` : ''}
            ${p.done < p.total ? `<button class="btn ghost" data-action="note-to-shop" data-id="${n.id}">${ic('einkauf')}Offenes → Einkauf</button>` : ''}
          </div>`
        : ''
    }`;
}

// Neu anlegen / Name, Symbol, Art ändern; bei Listen: alle Punkte als Text bearbeiten
function noteForm(n) {
  if (!notesReady()) return toast('Bitte zuerst supabase/update-15.sql in Supabase ausführen.');
  const isNew = !n;
  n ||= { kind: 'liste', emoji: '📝', items: [] };
  const lines = noteItems(n).map((x) => (x.head ? `${x.text}:` : x.text)).join('\n');
  const inner = `
    <label>Name<input name="title" value="${esc(n.title || '')}" required placeholder="z. B. Packliste Urlaub" /></label>
    <div class="field-label">Symbol</div>
    <div class="emoji-pick">${NOTE_EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === (n.emoji || '📝') ? 'checked' : ''}/><span>${e}</span></label>`).join('')}</div>
    ${
      isNew
        ? `<div class="field-label">Art</div>${repeatSwitch('kind', n.kind, [
            ['liste', 'Liste zum Abhaken'],
            ['text', 'Freier Text'],
          ])}`
        : n.kind === 'liste'
          ? `<label>Punkte <span class="muted small">– einer pro Zeile, mit „:“ am Ende = Überschrift</span>
              <textarea name="lines" rows="8">${esc(lines)}</textarea></label>`
          : ''
    }
    <label class="check-line"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}/> Oben anheften</label>`;
  openSheet(
    isNew ? 'Neue Notiz' : 'Notiz bearbeiten',
    inner,
    (f) => {
      const title = f.get('title').trim();
      if (!title) return;
      const row = { title, emoji: f.get('emoji') || '📝', pinned: f.get('pinned') === 'on' };
      if (isNew) {
        const now = new Date().toISOString();
        const id = store.uuid();
        save('notes', { id, ...row, kind: f.get('kind') || 'liste', body: null, items: [], created_by: state.me || null, updated_by: state.me || null, created_at: now, updated_at: now });
        closeSheet();
        state.noteId = id;
        navPush();
        state.view = 'notiz';
        window.scrollTo(0, 0);
        render();
        setTimeout(() => $('.nl-add input')?.focus(), 50);
        return;
      }
      if (n.kind === 'liste') {
        // Häkchen bleiben erhalten, wenn der Text gleich bleibt
        const old = noteItems(n);
        row.items = (f.get('lines') || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const head = /:$/.test(l);
            const text = head ? l.replace(/:+$/, '').trim() : l;
            const prev = old.find((x) => x.text === text && !!x.head === head);
            return { id: prev?.id || noteId(), text, done: head ? false : !!prev?.done, head };
          });
      }
      saveNote(n, row);
      closeSheet();
    },
    isNew ? '' : `<button type="button" class="btn danger wide" data-action="note-delete" data-id="${n.id}">Notiz löschen</button>`
  );
}

/* ================= Suche ================= */

const SEARCH_KINDS = [
  ['alle', 'Alles'],
  ['termin', 'Termine'],
  ['erinnerung', 'Erinnerungen'],
  ['aufgabe', 'Aufgaben'],
  ['rezept', 'Rezepte'],
  ['geburtstag', 'Geburtstage'],
  ['notiz', 'Notizen'],
];

function openSearch({ focus = true } = {}) {
  state.search ||= { q: '', kind: 'alle' };
  const kids = members().filter((m) => m.role === 'kind');
  const ex = [`Zahnarzt`, `${(kids[0] || members()[0])?.name || 'Mia'} Klavier`, 'Arzt Dezember', 'nächste Woche'];
  openPanel(
    'Suchen',
    `
    <div class="search-box">
      <input type="search" id="search-q" value="${esc(state.search.q)}" placeholder="Termin, Person, Monat …" autocomplete="off" enterkeyhint="search" />
    </div>
    <div class="chip-row search-kinds">
      ${SEARCH_KINDS.map(([k, l]) => `<button type="button" class="filter-chip ${state.search.kind === k ? 'on' : ''}" data-action="search-kind" data-kind="${k}">${l}</button>`).join('')}
    </div>
    <div id="search-results" data-examples="${esc(JSON.stringify(ex))}"></div>`
  );
  renderSearchResults();
  if (focus) $('#search-q').focus(); // direkt im Tipp, damit die Tastatur auch auf dem iPhone aufgeht
}

// Nächster bzw. letzter Tag eines Termins (ohne ausgefallene), passend zum Zeitfilter
function eventDays(ev, range) {
  const today = D.todayKey();
  const weekly = ev.weekdays?.length > 0;
  const cancelled = (day) => state.data.event_occurrences.some((o) => o.event_id === ev.id && o.date === day && o.cancelled);
  if (!weekly) {
    if (!ev.date) return null;
    const end = ev.end_date && ev.end_date > ev.date ? ev.end_date : ev.date;
    if (range) {
      let d = ev.date < range.from ? range.from : ev.date;
      for (let i = 0; d <= end && d <= range.to && i < 400; i++, d = D.addDays(d, 1)) if (range.test(d)) return { day: d, upcoming: end >= today };
      return null;
    }
    return { day: end >= today && ev.date < today ? today : ev.date, upcoming: end >= today };
  }
  const replaced = replacedDays();
  const hits = (d) => ev.weekdays.includes(D.isoWeekday(d)) && (!ev.end_date || ev.end_date >= d) && (!ev.date || ev.date <= d) && !cancelled(d) && !replaced.has(`${ev.id}|${d}`);
  const start = range ? (range.from > today ? range.from : today) : today;
  const stop = range ? range.to : D.addDays(today, 60);
  for (let d = start; d <= stop; d = D.addDays(d, 1)) if (hits(d) && (!range || range.test(d))) return { day: d, upcoming: true };
  // Sonst: letzter Termin in der Vergangenheit
  const back = range ? (range.to < today ? range.to : D.addDays(today, -1)) : D.addDays(ev.end_date && ev.end_date < today ? ev.end_date : today, -1);
  const backStop = range ? range.from : D.addDays(back, -14);
  for (let d = back; d >= backStop; d = D.addDays(d, -1)) if (hits(d) && (!range || range.test(d))) return { day: d, upcoming: false };
  return null;
}

// Nächster/letzter Tag einer Erinnerung oder Aufgabe
function taskDays(t, range) {
  const today = D.todayKey();
  if (!isRecurring(t)) {
    if (!t.due_date) return range ? null : { day: null, upcoming: !t.done_at };
    if (range && !range.test(t.due_date)) return null;
    return { day: t.due_date, upcoming: t.due_date >= today || !t.done_at };
  }
  const start = range ? (range.from > today ? range.from : today) : today;
  const stop = range ? range.to : D.addDays(today, 400);
  for (let d = start; d <= stop; d = D.addDays(d, 1)) if (occursOn(t, d) && (!range || range.test(d))) return { day: d, upcoming: true };
  if (range) for (let d = range.to < today ? range.to : D.addDays(today, -1); d >= range.from; d = D.addDays(d, -1)) if (occursOn(t, d) && range.test(d)) return { day: d, upcoming: false };
  return null;
}

function searchItems() {
  const { q, kind } = state.search;
  const { terms, people, filters } = parseQuery(q, members());
  const range = combineFilters(filters);
  const want = (k) => kind === 'alle' || kind === k;
  const personOk = (ids) => !people.length || people.every((id) => ids.includes(id));
  const out = [];

  if (want('termin')) {
    for (const ev of state.data.events) {
      if (!personOk(eventPeople(ev))) continue;
      const score = scoreFields(terms, [{ text: ev.title, weight: 1 }, { text: ev.location, weight: 0.8 }, { text: ev.notes, weight: 0.6 }]);
      if (!score) continue;
      const when = eventDays(ev, range);
      if (!when) continue;
      const weekly = ev.weekdays?.length > 0;
      const multi = !weekly && ev.end_date && ev.end_date > ev.date;
      const time = D.hm(ev.start_time);
      out.push({
        kind: 'termin', score, ...when, title: ev.title, people: eventPeople(ev),
        pill: multi ? multiPill(ev, `${daysBetween(ev.date, ev.end_date) + 1} Tage`) : '',
        sub: [
          weekly ? everyText(ev.weekdays) : '',
          multi ? `${D.formatShort(ev.date)} – ${D.formatShort(ev.end_date)}` : '',
          time ? `${time}${ev.end_time ? `–${D.hm(ev.end_time)}` : ''}` : ev.all_day ? 'Ganztägig' : '',
          ev.location ? ev.location : '',
        ].filter(Boolean).join(' · '),
        attrs: `data-action="search-open" data-kind="termin" data-id="${ev.id}" data-day="${when.day}"`,
      });
    }
  }
  for (const k of ['erinnerung', 'aufgabe']) {
    if (!want(k)) continue;
    for (const t of state.data.tasks) {
      if ((t.kind || 'aufgabe') !== k) continue;
      if (k === 'erinnerung' && !canSeeReminder(t)) continue;
      if (!personOk(peopleOf(t))) continue;
      const score = scoreFields(terms, [{ text: t.title, weight: 1 }, { text: t.notes, weight: 0.6 }]);
      if (!score) continue;
      const when = taskDays(t, range);
      if (!when) continue;
      out.push({
        kind: k, score, ...when, title: t.title, people: peopleOf(t), done: !isRecurring(t) && !!t.done_at,
        sub: [isRecurring(t) ? rhythmText(t) : '', t.due_time ? `${D.hm(t.due_time)} Uhr` : '', !when.day ? 'ohne Datum' : ''].filter(Boolean).join(' · '),
        attrs: `data-action="search-open" data-kind="task" data-id="${t.id}"`,
      });
    }
  }
  if (want('geburtstag') && !people.length) {
    for (const b of state.data.birthdays || []) {
      const score = scoreFields(terms.filter((t) => !['geburtstag', 'geburtstage'].includes(t)), [{ text: b.name, weight: 1 }]);
      if (!score && !(kind === 'geburtstag' && !terms.length)) continue;
      let day = nextBirthday(b);
      if (range) {
        const y = Number(D.todayKey().slice(0, 4));
        day = [y, y + 1, y - 1].map((yy) => birthdayIn(b, yy)).find((d) => d >= range.from && d <= range.to && range.test(d));
        if (!day) continue;
      }
      const age = ageOn(b, day);
      out.push({
        kind: 'geburtstag', score: score || 1, day, upcoming: day >= D.todayKey(), title: b.name, people: [],
        sub: `Geburtstag${age ? ` (${age})` : ''}`,
        attrs: `data-action="search-open" data-kind="geburtstag" data-id="${b.id}"`,
      });
    }
  }
  const recipes = [];
  if (want('rezept') && !range && !people.length && (terms.length || kind === 'rezept')) {
    for (const r of state.data.recipes || []) {
      const score = scoreFields(terms, [{ text: r.title, weight: 1 }, { text: (r.ingredients || []).join(' '), weight: 0.5 }]);
      if (score) recipes.push({ r, score });
    }
    recipes.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title));
  }
  const notes = [];
  if (want('notiz') && !range && !people.length && (terms.length || kind === 'notiz')) {
    for (const n of state.data.notes || []) {
      const score = scoreFields(terms, [{ text: n.title, weight: 1 }, { text: n.body, weight: 0.7 }, { text: noteItems(n).map((x) => x.text).join(' '), weight: 0.7 }]);
      if (score) notes.push({ n, score });
    }
    notes.sort((a, b) => b.score - a.score || (b.n.updated_at || '').localeCompare(a.n.updated_at || ''));
  }
  return { items: out, recipes, notes, labels: [...people.map((id) => member(id)?.name), ...(range?.labels || [])].filter(Boolean), empty: !terms.length && !people.length && !range };
}

const SEARCH_ICON = { termin: ic('calendar'), erinnerung: ic('bell'), aufgabe: ic('task'), geburtstag: '<span class="emo">🎂</span>' };

function searchRow(x) {
  const date = x.day
    ? `<span class="sr-wd">${D.WD_SHORT[D.isoWeekday(x.day) - 1]}</span><span class="sr-d">${D.fromKey(x.day).getDate()}.${D.fromKey(x.day).getMonth() + 1}.</span>${x.day.slice(0, 4) !== D.todayKey().slice(0, 4) ? `<span class="sr-y">${x.day.slice(0, 4)}</span>` : ''}`
    : '<span class="sr-wd">–</span>';
  return `
    <li class="sr ${x.done ? 'done' : ''}">
      <div class="sr-date ${x.day === D.todayKey() ? 'today' : ''}">${date}</div>
      <button class="sr-main" ${x.attrs}>
        <span class="sr-title with-ic">${SEARCH_ICON[x.kind]}${esc(x.title)}${x.pill || ''}${x.done ? ` <span class="muted">${ic('check')}</span>` : ''}</span>
        ${x.sub || x.people.length ? `<span class="meta">${x.sub ? `<span class="muted small">${esc(x.sub)}</span>` : ''}${chips(x.people)}</span>` : ''}
      </button>
      ${x.day ? `<button class="sr-go" data-action="search-goto" data-day="${x.day}" aria-label="Tag öffnen">${ic('right')}</button>` : ''}
    </li>`;
}

// Suche ohne Eingabe: das Nächste, was ansteht (ohne Regelmäßiges, das wäre jeden Tag dasselbe)
function upcomingPreview(kind = 'alle') {
  const want = (k) => kind === 'alle' || kind === k;
  const today = D.todayKey();
  const out = [];
  for (let i = 0; i < 60 && out.length < 6; i++) {
    const day = D.addDays(today, i);
    if (want('geburtstag'))
      for (const b of birthdaysOn(day)) {
        const age = ageOn(b, day);
        out.push({ kind: 'geburtstag', day, title: b.name, people: [], sub: `Geburtstag${age ? ` (${age})` : ''}`, attrs: `data-action="search-open" data-kind="geburtstag" data-id="${b.id}"` });
      }
    if (want('termin'))
      for (const o of eventsOn(day)) {
        if (o.weekly || o.cancelled || (o.multi && day !== o.ev.date && i > 0)) continue;
        const time = o.time && o.time !== 'Ganztägig' ? o.time : '';
        out.push({ kind: 'termin', day, title: o.ev.title, people: eventPeople(o.ev), sub: [time, o.ev.location].filter(Boolean).join(' · '), attrs: `data-action="search-open" data-kind="termin" data-id="${o.ev.id}" data-day="${day}"` });
      }
    for (const [k, list] of [
      ['erinnerung', want('erinnerung') ? tasksOn(day, { filter: false, kind: 'erinnerung' }) : []],
      ['aufgabe', want('aufgabe') ? tasksOn(day, { filter: false }) : []],
    ])
      for (const x of list) {
        if (x.recurring || x.done || x.overdue || x.undated) continue;
        out.push({ kind: k, day, title: x.t.title, people: peopleOf(x.t), sub: x.t.due_time ? D.hm(x.t.due_time) : '', attrs: `data-action="search-open" data-kind="task" data-id="${x.t.id}"` });
      }
  }
  if (!out.length) return '';
  return `<h3 class="sr-head">Als Nächstes</h3><ul class="card list sr-list">${out.slice(0, 6).map(searchRow).join('')}</ul>`;
}

function renderSearchResults() {
  const box = $('#search-results');
  if (!box || !state.data) return;
  const { items, recipes, notes, labels, empty } = searchItems();
  if (empty && !['geburtstag', 'rezept', 'notiz'].includes(state.search.kind)) {
    const ex = JSON.parse(box.dataset.examples || '[]');
    box.innerHTML = `
      ${upcomingPreview(state.search.kind)}
      <p class="muted search-hint">Findet auch Wortteile und Tippfehler. Personen und Zeiträume lassen sich dazuschreiben, z. B.:</p>
      <div class="chip-row wrap">${ex.map((e) => `<button type="button" class="filter-chip" data-action="search-example" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
    return;
  }
  const LIMIT = 40;
  const up = items.filter((x) => x.upcoming).sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || b.score - a.score);
  const past = items.filter((x) => !x.upcoming).sort((a, b) => (b.day || '').localeCompare(a.day || '') || b.score - a.score);
  const section = (title, list) =>
    list.length
      ? `<h3 class="sr-head">${title} <span class="muted small">${list.length}</span></h3>
         <ul class="card list sr-list">${list.slice(0, LIMIT).map(searchRow).join('')}</ul>
         ${list.length > LIMIT ? `<p class="muted small center">… und ${list.length - LIMIT} weitere – Suche genauer machen</p>` : ''}`
      : '';
  const filterLine = labels.length ? `<p class="sr-filter">Gefiltert: ${labels.map((l) => `<span class="tag">${esc(l)}</span>`).join(' ')}</p>` : '';
  const recipeBlock = recipes.length
    ? `<h3 class="sr-head">Rezepte <span class="muted small">${recipes.length}</span></h3>
       <ul class="card list recipes">${recipes.slice(0, state.search.kind === 'rezept' ? 60 : 5).map(({ r }) => recipeRow(r, 'search-recipe')).join('')}</ul>`
    : '';
  const noteBlock = notes.length
    ? `<h3 class="sr-head">Notizen <span class="muted small">${notes.length}</span></h3>
       <ul class="card list notes-list">${notes.slice(0, state.search.kind === 'notiz' ? 60 : 5).map(({ n }) => noteRow(n).replace('data-action="open-note"', 'data-action="search-note"')).join('')}</ul>`
    : '';
  const html = filterLine + section('Demnächst', up) + section('Vergangen', past) + noteBlock + recipeBlock;
  box.innerHTML = html.replace(filterLine, '') ? html : `${filterLine}<p class="empty">Nichts gefunden.</p>`;
}

/* ================= Rahmen ================= */

const searchButton = () => `<button class="icon-btn" data-action="search" aria-label="Suchen">${ic('search')}</button>`;

// Großer Titel links, Aktionen rechts – auf allen Reitern gleich
const bigHeader = (title, actions = searchButton(), cls = '', below = '') => `
      <header class="top big ${cls}">
        <div class="big-row">
          ${title}
          <span class="head-actions">${actions}</span>
        </div>
        ${below}
      </header>`;

function header() {
  if (state.view === 'heute') {
    const isToday = state.date === D.todayKey();
    const h = new Date().getHours();
    const hello = h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
    const me = meMember();
    return `
      <header class="top big home">
        <div class="home-row">
          <span class="greet">${hello}${me ? `, ${esc(me.name)}` : ''}</span>
          <span class="head-actions">
            ${isToday ? '' : '<button class="pill" data-action="goto-today">Heute</button>'}
            ${bellButton()}
            ${searchButton()}
          </span>
        </div>
        <button class="date-big" data-action="pick-date" aria-label="Datum wählen">
          ${isToday ? '' : `<span class="rel">${D.relativeLabel(state.date)}</span>`}
          <span>${esc(D.formatLong(state.date))}</span>
          ${ic('down')}
        </button>
        <input type="date" id="date-picker" value="${state.date}" tabindex="-1" aria-hidden="true" />
        ${weekStrip()}
      </header>`;
  }
  if (state.view === 'woche') {
    const month = state.cal === 'monat';
    const m = D.fromKey(state.monthSel);
    const title = month
      ? `<span class="rel">${m.getFullYear()}</span><span class="date">${m.toLocaleDateString('de-DE', { month: 'long' })}</span>`
      : listTitle(state.listTop);
    return bigHeader(
      `<button class="title-btn" data-action="cal-today" aria-label="Zu heute">${title}</button>`,
      `<button class="icon-btn" data-action="cal-step" data-dir="-1" aria-label="Zurück">${ic('left')}</button>
       <button class="icon-btn" data-action="cal-step" data-dir="1" aria-label="Weiter">${ic('right')}</button>
       ${bellButton()}
       ${searchButton()}`,
      'cal-top',
      `<div class="seg wide cal-switch">
          <button class="${month ? '' : 'on'}" data-action="cal-mode" data-mode="woche">Liste</button>
          <button class="${month ? 'on' : ''}" data-action="cal-mode" data-mode="monat">Monat</button>
        </div>`
    );
  }
  if (state.view === 'abfall') {
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Mehr</span></button>
        <span class="head-actions">${wasteReady() ? `<button class="icon-btn" data-action="waste-new" aria-label="Abholtag eintragen">${ic('plus')}</button>` : ''}</span>
      </header>
      <div class="sub-title"><h1>Abfallkalender</h1></div>`;
  }
  if (state.view === 'notizen') {
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Mehr</span></button>
        <span class="head-actions">${notesReady() ? `<button class="icon-btn" data-action="new-note" aria-label="Neue Notiz">${ic('plus')}</button>` : ''}</span>
      </header>
      <div class="sub-title"><h1>Notizen</h1></div>`;
  }
  if (state.view === 'notiz') {
    const n = (state.data.notes || []).find((x) => x.id === state.noteId);
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Notizen</span></button>
        <span class="head-actions">${n ? `<button class="link" data-action="note-form" data-id="${n.id}">Bearbeiten</button>` : ''}</span>
      </header>
      <div class="sub-title note-title"><h1>${n ? `<span>${esc(n.emoji || '📝')}</span> ${esc(n.title)}` : 'Notiz'}</h1></div>`;
  }
  if (state.view === 'eintraege') {
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Mehr</span></button>
      </header>
      <div class="sub-title"><h1>Alle Einträge</h1></div>`;
  }
  if (state.view === 'geburtstage') {
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Mehr</span></button>
        <span class="head-actions"><button class="icon-btn" data-action="new-birthday" aria-label="Geburtstag eintragen">${ic('plus')}</button></span>
      </header>
      <div class="sub-title"><h1>Geburtstage</h1></div>`;
  }
  if (state.view === 'person') {
    const m = member(state.personId);
    return `
      <header class="top sub">
        <button class="icon-btn back" data-action="back" aria-label="Zurück">${ic('left')}<span>Zurück</span></button>
        <span class="head-actions"><button class="link" data-action="edit-member" data-id="${state.personId}">Bearbeiten</button></span>
      </header>
      <div class="sub-title person-title">${avatar(m)}<h1>${esc(m?.name || '')}</h1></div>`;
  }
  // Suche gibt es dort, wo Termine stehen; Kochbuch hat sein eigenes Suchfeld
  const titles = { einkauf: 'Einkauf', mehr: 'Mehr', kochbuch: 'Kochbuch' };
  return bigHeader(`<h1>${titles[state.view]}</h1>`, '');
}

const icon = (name) => ic(name, 'tab-ic');

// Wochenleiste Mo–So: Tippen wechselt den Tag, Punkt = da steht etwas an
function weekStrip() {
  const start = D.startOfWeek(state.date);
  const today = D.todayKey();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(start, i));
  const busy = (day) =>
    birthdaysOn(day).length > 0 ||
    eventsOn(day).some((o) => !o.cancelled) ||
    tasksOn(day, { filter: false, kind: 'erinnerung' }).some((x) => !x.done && !x.overdue && !x.recurring) ||
    tasksOn(day, { filter: false }).some((x) => !x.done && !x.overdue && !x.undated && !x.recurring);
  return `
    <div class="week-strip">
      <button class="ws-nav" data-action="prev-week-day" aria-label="Vorherige Woche">${ic('left')}</button>
      ${days
        .map(
          (day) => `<button class="ws-day ${day === state.date ? 'sel' : ''} ${day === today ? 'today' : ''} ${D.isoWeekday(day) > 5 ? 'we' : ''} ${holidayOn(day, state.land) ? 'hol' : ''} ${schoolHolidayOn(day, state.land) ? 'ferien' : ''}" data-action="select-day" data-day="${day}">
            <span class="ws-wd">${D.WD_SHORT[D.isoWeekday(day) - 1]}</span>
            <span class="ws-num">${D.fromKey(day).getDate()}</span>
            <span class="ws-dot ${busy(day) ? 'on' : ''}"></span>
          </button>`
        )
        .join('')}
      <button class="ws-nav" data-action="next-week-day" aria-label="Nächste Woche">${ic('right')}</button>
    </div>`;
}

function tabbar() {
  const tabs = [
    ['heute', 'heute', 'Heute'],
    ['woche', 'woche', 'Kalender'],
    ['kochbuch', 'kochbuch', 'Kochbuch'],
    ['einkauf', 'einkauf', 'Einkauf'],
    ['mehr', 'mehr', 'Mehr'],
  ];
  return `<nav class="tabbar">${tabs
    .map(
      ([k, i, l]) => `<button class="${state.view === k || (k === 'mehr' && ['geburtstage', 'eintraege', 'notizen', 'notiz', 'abfall'].includes(state.view)) ? 'on' : ''}" data-action="tab" data-tab="${k}">
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
  const views = { heute: viewHeute, woche: () => (state.cal === 'monat' ? viewMonat() : viewWoche()), kochbuch: viewKochbuch, einkauf: viewEinkauf, mehr: viewMehr, person: viewPerson, geburtstage: viewGeburtstage, eintraege: viewEintraege, notizen: viewNotizen, notiz: viewNotiz, abfall: viewAbfall };
  const scroll = window.scrollY;
  app.innerHTML = `
    ${header()}
    <main id="main" class="view-${state.view}">${views[state.view]()}</main>
    ${recipeList()}
    ${['heute', 'woche', 'person'].includes(state.view) ? `<button class="fab" data-action="add" aria-label="Neu">${ic('plus')}</button>` : ''}
    ${tabbar()}`;
  window.scrollTo(0, scroll);
  if (state.view === 'woche' && state.cal !== 'monat') {
    const target = state.listScrollTo;
    state.listScrollTo = null;
    if (target === 'top') window.scrollTo(0, 0);
    else if (target) {
      const el = document.getElementById(target);
      const head = $('header.top')?.getBoundingClientRect().height || 0;
      if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - head - 8);
    }
    updateListHeader();
  }
  renderSearchResults(); // offene Suche aktuell halten
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
  // Alle zur Auswahl, auch Kinder mit eigenem Handy – Erwachsene zuerst
  const ms = [...members()].sort((a, b) => (a.role === 'kind') - (b.role === 'kind'));
  return `
    <div class="center-screen">
      <img class="logo-img" src="icons/icon-192.png" alt="" width="96" height="96" />
      <h1>Wer bist du?</h1>
      <p class="muted">Damit „Meine Aufgaben“ funktioniert. Kann später unter „Mehr“ geändert werden.</p>
      <div class="who">
        ${ms
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
  // Eine noch sichtbare Bestätigung würde über dem Formular liegen
  if ($('#toast').classList.contains('confirm')) $('#toast').classList.remove('show');
  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <form class="sheet ${compact ? 'compact' : 'full'}" data-form="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <span class="grabber" aria-hidden="true"></span>
        <button type="button" class="link" data-action="close-sheet">Abbrechen</button>
        <strong>${esc(title)}</strong>
        <span class="head-spacer" aria-hidden="true"></span>
      </div>
      <div class="sheet-body">${inner}${extraButtons ? `<div class="sheet-extra">${extraButtons}</div>` : ''}</div>
      <div class="sheet-foot"><button type="submit" class="btn primary wide">Sichern</button></div>
    </form>`;
  sheetOpened();
  fitToKeyboard();
  const first = $('#sheet-root input[name="title"], #sheet-root input[name="name"]');
  if (first && !first.value) setTimeout(() => first.focus(), 50);
}

// Bildschirmtastatur: Fenster unten so weit verkürzen, dass "Sichern" darüber sichtbar bleibt
function fitToKeyboard() {
  const vv = window.visualViewport;
  const sheet = $('#sheet-root .sheet');
  if (!vv || !sheet) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const open = kb > 80; // kleinere Unterschiede sind Leisten des Browsers, keine Tastatur
  sheet.style.bottom = open ? `${kb}px` : '';
  sheet.classList.toggle('kb-open', open);
}
window.visualViewport?.addEventListener('resize', fitToKeyboard);
window.visualViewport?.addEventListener('scroll', fitToKeyboard);
// Text-Notiz: beim Verlassen des Felds sofort speichern
document.addEventListener('focusout', (e) => {
  if (e.target.id === 'note-body') saveNoteBody(e.target);
});
// Feld mit Fokus nicht hinter dem Sichern-Knopf verstecken
document.addEventListener('focusin', (e) => {
  if (!e.target.closest?.('.sheet') || !e.target.matches('input, textarea, select')) return;
  setTimeout(() => {
    fitToKeyboard();
    e.target.scrollIntoView({ block: 'nearest' });
  }, 300);
});

function closeSheet({ fromBack = false } = {}) {
  const wasOpen = document.body.classList.contains('sheet-open');
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (wasOpen && !fromBack) navDrop('sheet');
  sheetSubmit = null;
  render();
  // Eintrag wurde aus der Suche geöffnet → zurück zu den Suchergebnissen
  if (state.searchBack) {
    state.searchBack = false;
    openSearch({ focus: false });
  }
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

// Auswahl "Erinnern" im Terminformular (null = wie in den Einstellungen des Handys)
const REMIND_OPTIONS = [
  ['', 'wie eingestellt'],
  ['-1', 'nicht erinnern'],
  ['15', '15 Min. vorher'],
  ['30', '30 Min. vorher'],
  ['60', '1 Std. vorher'],
  ['120', '2 Std. vorher'],
  ['-2', 'am Vortag (18 Uhr)'],
];
const remindSelect = (v) =>
  `<label>Push-Erinnerung<select name="remind">${REMIND_OPTIONS.map(
    ([k, l]) => `<option value="${k}" ${String(v ?? '') === k ? 'selected' : ''}>${l}</option>`
  ).join('')}</select></label>`;

// Termin ansehen (ohne Bearbeiten): Wann, Wo, Wer, Notiz – "Bearbeiten" oben rechts
function eventView(ev, day) {
  if (!ev) return;
  const weekly = ev.weekdays?.length > 0;
  const o = day ? eventsOn(day).find((x) => x.ev.id === ev.id) : null;
  const series = ev.series_id ? state.data.events.find((x) => x.id === ev.series_id) : null;
  const start = D.hm(ev.start_time);
  const end = D.hm(ev.end_time);
  const time = ev.all_day || !start ? 'ganztägig' : end ? `${start}–${end} Uhr` : `${start} Uhr`;
  const multi = !weekly && ev.end_date && ev.end_date > ev.date;
  const when = multi
    ? `${D.formatShort(ev.date)}${start ? `, ${start}` : ''} – ${D.formatShort(ev.end_date)}${end ? `, ${end}` : ''}${o ? ` <span class="muted">(Tag ${o.dayNo} von ${o.days})</span>` : ''}`
    : `${day || ev.date ? esc(D.formatLong(day || ev.date)) : ''}${day || ev.date ? '<br />' : ''}${esc(time)}`;
  const people = eventPeople(ev).map((id) => member(id)).filter(Boolean);
  const colors = people.map((m) => m.color);
  const line = (icon, html) => `<div class="evv-line">${ic(icon)}<div>${html}</div></div>`;
  const mapUrl = ev.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}` : '';

  $('#sheet-root').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet compact ev-view" role="dialog" aria-label="${esc(ev.title)}">
      <div class="sheet-head">
        <span class="grabber" aria-hidden="true"></span>
        <button type="button" class="link" data-action="close-sheet">Schließen</button>
        <strong></strong>
        <button type="button" class="link" data-action="event-edit" data-id="${ev.id}" data-day="${day || ''}">Bearbeiten</button>
      </div>
      <div class="sheet-body">
        <h2 class="evv-title"><span class="evv-dot" style="background:${esc(colors[0] || 'var(--accent)')}"></span>${esc(ev.title)}</h2>
        ${o?.cancelled ? `<p class="banner warn">Fällt am ${esc(D.formatShort(day))} aus.</p>` : ''}
        ${series ? `<p class="muted small">Einmalig geändert – sonst ${esc(rhythmShort(series))}.</p>` : ''}
        ${line('clock', when)}
        ${weekly ? line('repeat', esc(everyText(ev.weekdays) + (ev.end_date ? ` bis ${D.formatDayMonth(ev.end_date)}` : ''))) : ''}
        ${ev.location ? line('pin', `<a href="${esc(mapUrl)}" target="_blank" rel="noopener">${esc(ev.location)}</a>`) : ''}
        ${people.length ? line('users', `<span class="evv-people">${people.map((m) => `<span>${avatar(m, 'xs')}${esc(m.name)}</span>`).join('')}</span>`) : ''}
        ${ev.notes ? line('pencil', `<span class="evv-notes">${esc(ev.notes)}</span>`) : ''}
        ${
          o && o.weekly
            ? `<button type="button" class="btn ghost wide evv-cancel" data-action="toggle-cancel" data-id="${ev.id}" data-day="${day}">
                ${o.cancelled ? `Findet am ${esc(D.formatShort(day))} doch statt` : `Fällt am ${esc(D.formatShort(day))} aus`}</button>`
            : ''
        }
      </div>
    </div>`;
  sheetOpened();
}

// Spalte created_by bei Terminen erst ab Update 17 (sonst würde Sichern scheitern)
const eventsHaveCreator = () => !store.isCloud || state.data.events.some((e) => 'created_by' in e);

function eventForm(ev, day) {
  const isNew = !ev;
  ev ||= { date: day || state.date, member_ids: presetPeople() || [] };
  const weekly = ev.weekdays?.length > 0;
  const multi = !weekly && ev.end_date && ev.end_date > ev.date;
  const o = !isNew && day ? eventsOn(day).find((x) => x.ev.id === ev.id) : null;
  // Ein bestimmter Termin einer Serie: beim Sichern wird gefragt, wofür die Änderung gilt
  const occurrence = !!(o && o.weekly);
  const exception = !isNew && ev.series_id ? state.data.events.find((x) => x.id === ev.series_id) : null;

  const hint = occurrence
    ? `<p class="banner soft">Serientermin (${esc(rhythmShort(ev))}). Beim Sichern wählst du: nur dieser Termin, dieser und alle folgenden oder alle.</p>`
    : weekly && !isNew
      ? `<p class="banner soft">Änderungen gelten für die ganze Serie. Einzelne Termine findest du unten unter „Einzelne Termine anzeigen“.</p>`
      : exception
        ? `<p class="banner soft">Einmalig geänderter Termin der Serie „${esc(exception.title)}“ (sonst ${esc(rhythmShort(exception))}).</p>`
        : '';

  const inner = `
    ${hint}
    <label>Was?<input name="title" value="${esc(ev.title || '')}" placeholder="z. B. Pickleball" required /></label>
    <div class="field-label">Für wen? <span class="muted small">(mehrere möglich)</span></div>
    ${peoplePicker(eventPeople(ev))}
    ${occurrence ? `<label class="plain">Datum dieses Termins<input type="date" name="date_one" value="${esc(day)}" /></label>` : ''}
    <div class="scope-all">
    <div ${occurrence || exception ? 'hidden' : ''}>
    ${repeatSwitch('repeat', weekly ? 'weekly' : multi ? 'multi' : 'once', [
      ['once', 'Ein Tag'],
      ['multi', 'Mehrere Tage'],
      ['weekly', 'Jede Woche'],
    ])}
    </div>
    <label data-show="once">Datum<input type="date" name="date_once" value="${esc(ev.date || state.date)}" /></label>
    <div class="row" data-show="multi">
      <label>Von<input type="date" name="date_from" value="${esc(ev.date || state.date)}" /></label>
      <label>Bis<input type="date" name="date_to" value="${esc(multi ? ev.end_date : D.addDays(ev.date || state.date, 1))}" min="${esc(D.addDays(ev.date || state.date, 1))}" /></label>
    </div>
    <div data-show="weekly">
      ${occurrence ? '<div class="field-label">Wiederholung</div>' : ''}
      ${weekdayPicker(ev.weekdays || [D.isoWeekday(day || state.date)])}
      <label>Serie endet am (optional)<input type="date" name="series_end" value="${esc(weekly ? ev.end_date || '' : '')}" /></label>
    </div>
    </div>
    <div class="row" data-times>
      <label><span data-time-label="start">${multi ? 'Beginn (1. Tag)' : 'Beginn'}</span><input type="time" name="start_time" value="${esc(D.hm(ev.start_time))}" /></label>
      <label><span data-time-label="end">${multi ? 'Ende (letzter Tag)' : 'Ende'}</span><input type="time" name="end_time" value="${esc(D.hm(ev.end_time))}" /></label>
    </div>
    <p class="muted small time-hint">Ohne Uhrzeit = ganztägig</p>
    ${moreOptions(
      `<label>Wo?<input name="location" value="${esc(ev.location || '')}" /></label>
       <label>Notiz<textarea name="notes" rows="2">${esc(ev.notes || '')}</textarea></label>
       ${store.isCloud && !state.data.missing?.includes('push_subscriptions') ? remindSelect(ev.remind) : ''}`,
      ev.location || ev.notes || ev.remind != null
    )}`;

  const extra = isNew
    ? ''
    : `${
        occurrence
          ? `<button type="button" class="btn ghost wide" data-action="toggle-cancel" data-id="${ev.id}" data-day="${day}">
               ${o.cancelled ? `Am ${D.formatShort(day)} findet es doch statt` : `Nur am ${D.formatShort(day)}: fällt aus`}</button>`
          : ''
      }
       ${exception ? `<button type="button" class="btn ghost wide" data-action="reset-exception" data-id="${ev.id}">Wieder wie die Serie</button>` : ''}
       ${weekly ? `<details class="occ-box" data-id="${ev.id}"><summary>Einzelne Termine anzeigen${ic('down', 'sum-ic')}</summary><div class="occ-body">${occurrenceList(ev, 8)}</div></details>` : ''}
       <button type="button" class="btn danger wide" data-action="delete-event" data-id="${ev.id}">
         ${weekly ? 'Ganze Serie löschen' : 'Termin löschen'}</button>`;

  openSheet(
    isNew ? 'Neuer Termin' : 'Termin bearbeiten',
    inner,
    (f) => {
      // Keine Uhrzeit eingetragen = ganztägig
      const allDayChecked = !f.get('start_time');
      const common = {
        title: f.get('title').trim(),
        member_ids: readPeople(),
        member_id: readPeople()[0] || null,
        all_day: allDayChecked,
        start_time: allDayChecked ? null : f.get('start_time') || null,
        end_time: allDayChecked ? null : f.get('end_time') || null,
        location: f.get('location').trim() || null,
        notes: f.get('notes').trim() || null,
      };
      // Push-Hinweis für diesen Termin (nur mitschicken, wenn gesetzt – sonst klappt Sichern auch ohne Update 12)
      const remind = f.get('remind');
      if (remind != null && (remind !== '' || ev.remind != null)) common.remind = remind === '' ? null : Number(remind);
      if (exception) {
        saveConfirm('events', { ...common, id: ev.id, date: f.get('date_once') || ev.date }, 'termin', false);
        closeSheet();
        return;
      }
      const repeat = f.get('repeat');
      const wds = readWeekdays($('#sheet-root form'));
      if (repeat === 'weekly' && !wds.length) return toast('Bitte mindestens einen Wochentag wählen.');

      if (occurrence) {
        const seriesEnd = f.get('series_end') || null;
        const newDay = f.get('date_one') || day;
        const seriesChanged = [...wds].sort().join() !== [...ev.weekdays].sort().join() || seriesEnd !== (ev.end_date || null);
        const moved = newDay !== day;
        const norm = (k, v) => (k.endsWith('_time') ? D.hm(v) || '' : v ?? '');
        const fieldsChanged =
          ['title', 'start_time', 'end_time', 'location', 'notes', 'remind'].some((k) => norm(k, common[k]) !== norm(k, ev[k])) ||
          !!common.all_day !== !!ev.all_day ||
          [...common.member_ids].sort().join() !== [...eventPeople(ev)].sort().join();
        if (!seriesChanged && !moved && !fieldsChanged) return closeSheet();
        const options = [
          !seriesChanged && ['one', `Nur dieser Termin (${D.formatShort(day)})`],
          !moved && ['following', 'Dieser und alle folgenden'],
          !moved && ['all', 'Alle Termine der Serie'],
        ].filter(Boolean);
        const apply = (scope) => {
          if (scope === 'one') {
            saveConfirm('events', { ...common, date: newDay, weekdays: null, end_date: null, series_id: ev.id, series_date: day }, 'termin', false);
          } else if (scope === 'following') {
            splitSeries(ev, day, { ...common, weekdays: wds, end_date: seriesEnd });
          } else {
            saveConfirm('events', { ...common, id: ev.id, weekdays: wds, end_date: seriesEnd, date: ev.date ?? null }, 'termin', false);
          }
          closeSheet();
        };
        if (options.length === 1) return apply(options[0][0]);
        return askScope(options, apply);
      }

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
      saveConfirm('events', {
        ...common,
        ...(isNew && eventsHaveCreator() ? { created_by: state.me || null } : {}),
        id: ev.id,
        // Serie: Beginn behalten (wichtig nach "dieser und alle folgenden")
        date: repeat === 'weekly' ? (weekly ? ev.date ?? null : null) : date,
        weekdays: repeat === 'weekly' ? wds : null,
        end_date: endDate,
      }, 'termin', isNew);
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
}

// Abfrage beim Sichern eines Serientermins: wofür gilt die Änderung?
function askScope(options, onPick) {
  const root = $('#sheet-root');
  root.querySelector('.scope-dlg')?.remove();
  $('#toast').classList.remove('show'); // eine alte Meldung soll die Abfrage nicht verdecken
  root.insertAdjacentHTML(
    'beforeend',
    `<div class="scope-dlg" role="dialog" aria-label="Änderung speichern für">
      <div class="scope-card">
        <strong>Änderung speichern für …</strong>
        ${options.map(([k, l], i) => `<button type="button" class="btn ${i === 0 ? 'primary' : 'ghost'} wide" data-scope-pick="${k}">${esc(l)}</button>`).join('')}
        <button type="button" class="link" data-scope-pick="">Abbrechen</button>
      </div>
    </div>`
  );
  const dlg = root.querySelector('.scope-dlg');
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope-pick]');
    if (!b && e.target !== dlg) return;
    e.stopPropagation();
    dlg.remove();
    if (b?.dataset.scopePick) onPick(b.dataset.scopePick);
  });
}

// "Dieser und alle folgenden": alte Serie endet am Vortag, ab diesem Tag gilt eine neue Serie.
// Ausfälle und Einzeländerungen ab diesem Tag wandern zur neuen Serie.
async function splitSeries(ev, day, changes) {
  const hasEarlier = (() => {
    const from = ev.date || D.addDays(day, -400);
    for (let d = D.addDays(day, -1); d >= from; d = D.addDays(d, -1)) if (ev.weekdays.includes(D.isoWeekday(d))) return true;
    return false;
  })();
  if (!hasEarlier) {
    // Erster Termin der Serie: einfach die ganze Serie ändern
    saveConfirm('events', { ...changes, id: ev.id, date: ev.date ?? null }, 'termin', false);
    return;
  }
  const newId = store.uuid();
  const next = { ...changes, id: newId, date: day };
  const children = [
    ...state.data.events.filter((x) => x.series_id === ev.id && x.series_date >= day).map((x) => ['events', { id: x.id, series_id: newId }]),
    ...state.data.event_occurrences.filter((x) => x.event_id === ev.id && x.date >= day).map((x) => ['event_occurrences', { id: x.id, event_id: newId }]),
  ];
  // Nacheinander, damit die neue Serie in der Datenbank steht, bevor etwas auf sie verweist
  await saveConfirm('events', next, 'termin', false);
  for (const [t, row] of children) await save(t, row);
  await save('events', { id: ev.id, end_date: D.addDays(day, -1) });
}

// Die nächsten Termine einer Serie (mit Ausfällen und Einzeländerungen), jeder antippbar
function occurrenceList(ev, n) {
  const today = D.todayKey();
  const rows = [];
  let more = false;
  for (let d = ev.date && ev.date > today ? ev.date : today, i = 0; i < 400; i++, d = D.addDays(d, 1)) {
    if (ev.end_date && d > ev.end_date) break;
    if (!ev.weekdays.includes(D.isoWeekday(d))) continue;
    if (rows.length === n) {
      more = true;
      break;
    }
    const exc = state.data.events.find((x) => x.series_id === ev.id && x.series_date === d);
    const cancelled = !exc && state.data.event_occurrences.some((o) => o.event_id === ev.id && o.date === d && o.cancelled);
    const time = exc ? timeLabel({ ev: exc, day: exc.date, multi: false }) : timeLabel({ ev, day: d, multi: false });
    const note = exc
      ? `<span class="changed-tag">geändert${exc.date !== d ? ` → ${esc(D.formatShort(exc.date))}` : ''}</span>`
      : cancelled
        ? '<span class="cancel-tag">fällt aus</span>'
        : '';
    rows.push(`<li><button type="button" class="occ-row ${cancelled ? 'off' : ''}" data-action="open-occurrence" data-id="${exc ? exc.id : ev.id}" data-day="${exc ? exc.date : d}">
      <span class="occ-day">${esc(D.formatShort(d))}</span>
      <span class="occ-time">${esc(time)}</span>
      ${note}
      <span class="occ-go">${ic('right')}</span>
    </button></li>`);
  }
  if (!rows.length) return '<p class="muted small">Keine weiteren Termine.</p>';
  return `<ul class="occ-list">${rows.join('')}</ul>
    ${more ? `<button type="button" class="link" data-action="more-occurrences" data-id="${ev.id}" data-n="${n + 8}">Weitere anzeigen</button>` : ''}`;
}

const rhythmShort = (ev) => everyText(ev.weekdays);



// Selten gebrauchte Felder einklappen; offen, wenn schon etwas eingetragen ist
// In der Personenansicht ist die Person bei neuen Einträgen schon ausgewählt
const presetPeople = () => (state.view === 'person' && member(state.personId) ? [state.personId] : null);

const moreOptions = (inner, open) =>
  `<details class="more-opts" ${open ? 'open' : ''}><summary>Mehr Optionen${ic('down', 'sum-ic')}</summary><div class="more-body">${inner}</div></details>`;

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
      <div class="row">
        <label><span data-from-label>${r === 'weekly' ? 'Ab (optional)' : 'Erstes Mal am'}</span><input type="date" name="repeat_from" value="${esc(from)}" /></label>
        <label>Endet am (optional)<input type="date" name="repeat_until" value="${esc(t.repeat_until || '')}" /></label>
      </div>
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
function readRhythm(f, t) {
  const form = $('#sheet-root form');
  const r = f.get('rhythm');
  const wds = readWeekdays(form);
  if ((r === 'weekly' || r === 'biweekly') && !wds.length) return { error: 'Bitte mindestens einen Wochentag wählen.' };
  const from = f.get('repeat_from') || state.date;
  const until = f.get('repeat_until') || null;
  if (until && until < from) return { error: 'Das Enddatum liegt vor dem Start.' };
  return {
    repeat: r,
    weekdays: r === 'weekly' || r === 'biweekly' ? wds : null,
    repeat_from: from,
    // nur mitschicken, wenn gesetzt oder vorher gesetzt – so klappt Sichern auch ohne Update 13
    ...(until || t?.repeat_until ? { repeat_until: until } : {}),
  };
}
const noRhythmFor = (t) => ({ repeat: null, weekdays: null, repeat_from: null, ...(t?.repeat_until ? { repeat_until: null } : {}) });

function reminderForm(t, day) {
  const isNew = !t;
  t ||= { due_date: day || state.date, assignees: presetPeople() || (state.me ? [state.me] : []) };
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
    <p class="muted small hint with-ic">${ic('lock')}Sehen können die Erinnerung nur die ausgewählten Personen und du.</p>
    ${peoplePicker(peopleOf(t))}
    ${moreOptions(`<label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`, t.notes)}`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Erinnerung löschen</button>`;
  openSheet(
    isNew ? 'Neue Erinnerung' : 'Erinnerung bearbeiten',
    inner,
    (f) => {
      const people = readPeople();
      const repeat = f.get('repeat');
      const rh = repeat === 'weekly' ? readRhythm(f, t) : noRhythmFor(t);
      if (rh.error) return toast(rh.error);
      saveConfirm('tasks', {
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
      }, 'erinnerung', isNew);
      closeSheet();
    },
    extra
  );
  updateRepeatVisibility($('#sheet-root form'));
  updateRhythmVisibility($('#sheet-root form'));
}

function taskForm(t, day) {
  const isNew = !t;
  t ||= { assignee: null, assignees: presetPeople() || [], due_date: day || state.date };
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
      const rh = repeat === 'weekly' ? readRhythm(f, t) : noRhythmFor(t);
      if (rh.error) return toast(rh.error);
      const people = readPeople();
      saveConfirm('tasks', {
        id: t.id,
        ...rh,
        kind: 'aufgabe',
        title: f.get('title').trim(),
        assignees: people,
        assignee: people[0] || null,
        due_date: repeat === 'date' ? f.get('due_date') || state.date : null,
        notes: f.get('notes').trim() || null,
        done_at: repeat === 'weekly' ? null : t.done_at ?? null,
      }, 'aufgabe', isNew);
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
    <span class="chev">${ic('right')}</span>
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
                .map(({ b, next }, i, all) => {
                  // Überschrift, sobald ein neuer Monat beginnt
                  const month = next.slice(0, 7);
                  const head = i === 0 || all[i - 1].next.slice(0, 7) !== month
                    ? `<li class="bd-month">${MONTHS[Number(next.slice(5, 7)) - 1]}${next.slice(0, 4) !== D.todayKey().slice(0, 4) ? ` ${next.slice(0, 4)}` : ''}</li>`
                    : '';
                  const days = Math.round((D.fromKey(next) - D.fromKey(D.todayKey())) / 86400000);
                  const age = ageOn(b, next);
                  return `${head}<li><button data-action="edit-birthday" data-id="${b.id}">
                    <span class="grow">${esc(b.name)}</span>
                    <span class="muted small bd-when">${b.day}. ${MONTHS[b.month - 1]}${age ? ` · wird ${age}` : ''}<br />
                      <b>${days === 0 ? 'heute 🎉' : days === 1 ? 'morgen' : `in ${days} Tagen`}</b></span>
                  </button></li>`;
                })
                .join('')
            : '<li class="empty">Noch keine Geburtstage eingetragen</li>'
        }
      </ul>`
      }`;
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
      saveConfirm('birthdays', { id: b.id, name: f.get('name').trim(), day, month, year, notes: f.get('notes').trim() || null }, 'geburtstag', isNew);
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
        <label class="btn ghost">${ic('camera')}Foto wählen<input type="file" id="avatar-file" accept="image/*" hidden /></label>
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
      saveConfirm('members', row, 'person', isNew);
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
      <button class="btn big" data-action="new-reminder">${ic('bell')}Erinnerung</button>
      <button class="btn big" data-action="new-event">${ic('calendar')}Termin</button>
      <button class="btn big" data-action="new-task">${ic('task')}Aufgabe</button>
      <button class="btn big" data-action="new-note">${ic('note')}Notiz</button>
      <button class="btn ghost wide" data-action="close-sheet">Abbrechen</button>
    </div>`;
  sheetOpened();
}

/* ================= Ereignisse ================= */

const actions = {
  tab: (d) => {
    if (navTab(d.tab)) return;
    state.view = d.tab;
    // "Heute" unten führt immer zum heutigen Tag zurück
    if (d.tab === 'heute') state.date = D.todayKey();
    if (d.tab === 'woche') state.date === D.todayKey() ? listReset() : listGoto(state.date);
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
  'list-person': (d) => {
    state.listPerson = state.listPerson === d.id ? null : d.id;
    render();
    updateListHeader();
  },
  'list-earlier': () => {
    // eine Woche Vergangenheit dazu, ohne dass die Liste springt
    const anchor = $('#main .week-day[data-day]');
    const before = anchor?.getBoundingClientRect().top;
    const ws = D.startOfWeek(state.listFrom);
    state.listFrom = ws < state.listFrom ? ws : D.addDays(ws, -7);
    render();
    const again = anchor && document.getElementById(`wd-${anchor.dataset.day}`);
    if (again) window.scrollBy(0, again.getBoundingClientRect().top - before);
    updateListHeader();
  },
  'goto-week': () => actions.tab({ tab: 'woche' }),
  'cal-mode': (d) => {
    state.cal = d.mode;
    lsSet('fo-cal', d.mode);
    if (d.mode === 'monat') {
      const top = state.listTop || D.todayKey();
      state.monthSel = D.startOfWeek(top) === D.startOfWeek(D.todayKey()) ? D.todayKey() : top;
    } else state.monthSel === D.todayKey() ? listReset() : listGoto(state.monthSel);
    window.scrollTo(0, 0);
    render();
  },
  'cal-step': (d) => slideStep(Number(d.dir)),
  'cal-today': () => {
    listReset();
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
    listGoto(d.week);
    state.cal = 'woche';
    lsSet('fo-cal', 'woche');
    window.scrollTo(0, 0);
    render();
  },
  'push-enable': async () => {
    try {
      const sub = await push.subscribe();
      state.pushEndpoint = sub.endpoint;
      const kid = meMember()?.role === 'kind';
      await save('push_subscriptions', { ...sub, member_id: state.me, reminders: true, events: true, tasks: true, lead: 30, daily_time: kid ? '15:00' : '07:00', device: push.deviceName() }, 'endpoint');
      toast('Benachrichtigungen sind aktiv.');
    } catch (e) {
      console.error(e);
      toast(e.code === 'denied' ? 'Ohne Erlaubnis geht es leider nicht. In den Handy-Einstellungen erlauben.' : 'Aktivieren hat nicht geklappt – bitte nochmal versuchen.');
      render();
    }
  },
  'push-disable': async () => {
    const row = pushRow();
    try {
      await push.unsubscribe();
    } catch (e) {
      console.error(e);
    }
    state.pushEndpoint = null;
    if (row) await del('push_subscriptions', row.id);
    toast('Benachrichtigungen auf diesem Gerät ausgeschaltet.');
  },
  'push-test': async () => {
    toast('Test-Nachricht wird gesendet …');
    try {
      const body = { test: true, endpoint: state.pushEndpoint };
      // Supabase unterscheidet Groß/klein im Namen – beide Schreibweisen versuchen.
      // Eine nicht vorhandene Funktion blockiert der Browser ohne Status, daher bei jedem Fehler.
      await store.invokeFunction('Push', body).catch((first) =>
        /Gerät/.test(first.message) ? Promise.reject(first) : store.invokeFunction('push', body).catch((second) => Promise.reject(second.status ? second : first))
      );
      toast('Gesendet – sie sollte gleich erscheinen.');
    } catch (e) {
      console.error(e);
      // Möglichst genau sagen, woran es liegt
      const msg =
        e.status === 404 && /Gerät/.test(e.message)
          ? 'Dieses Gerät ist nicht angemeldet. Bitte aus- und wieder einschalten.'
          : e.status === 404
            ? 'Versand-Funktion nicht gefunden – heißt sie in Supabase genau „push“?'
            : e.status === 401
              ? 'Versand-Funktion lehnt ab (401) – bitte „Verify JWT“ ausschalten.'
              : /Failed to send|fetch/i.test(e.message)
                ? 'Versand-Funktion nicht erreichbar – meist ist „Verify JWT“ noch an oder sie startet nicht (Logs prüfen).'
                : `Senden fehlgeschlagen: ${e.message}${e.status ? ` (${e.status})` : ''}`;
      toast(msg, { label: 'OK', run: () => {} });
    }
  },
  'goto-day': (d) => {
    if (state.view !== 'heute') navPush();
    state.date = d.day;
    state.view = 'heute';
    window.scrollTo(0, 0);
    render();
  },
  filter: (d) => {
    state.taskFilter = d.filter; // gilt bis zum nächsten App-Start
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
  'edit-event': (d) => eventView(state.data.events.find((e) => e.id === d.id), d.day || null),
  'event-edit': (d) => eventForm(state.data.events.find((e) => e.id === d.id), d.day || undefined),
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
  'meal-special': (d) => {
    const x = MEAL_SPECIAL.find((m) => m.key === d.key);
    if (!x) return;
    save('meals', { date: d.day, text: x.text, recipe_id: null }, 'date');
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
  'person-filter': (d) => {
    state.personFilter = !d.f || state.personFilter === d.f ? null : d.f;
    render();
  },
  'person-range': (d) => {
    state.personRange = Number(d.r);
    render();
  },
  'open-person': (d) => {
    if (state.personId !== d.id) state.personFilter = null;
    state.personRange = 14;
    if (state.view !== 'person') {
      state.prevView = state.view;
      navPush();
    }
    state.personId = d.id;
    state.view = 'person';
    window.scrollTo(0, 0);
    render();
  },
  back: () => {
    if (navBack()) return;
    state.view = state.view === 'notiz' ? 'notizen' : ['geburtstage', 'eintraege', 'notizen', 'abfall'].includes(state.view) ? 'mehr' : state.prevView || 'heute';
    state.noteEditing = null;
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
  search: () => openSearch(),
  'search-kind': (d) => {
    state.search.kind = d.kind;
    document.querySelectorAll('.search-kinds .filter-chip').forEach((b) => b.classList.toggle('on', b.dataset.kind === d.kind));
    renderSearchResults();
  },
  'search-example': (d) => {
    state.search.q = d.q;
    $('#search-q').value = d.q;
    renderSearchResults();
  },
  'search-open': (d) => {
    state.searchBack = true;
    if (d.kind === 'termin') eventView(state.data.events.find((e) => e.id === d.id), d.day || null);
    else if (d.kind === 'task') actions['edit-task'](d);
    else if (d.kind === 'geburtstag') actions['edit-birthday'](d);
  },
  'search-recipe': (d) => {
    state.searchBack = true;
    actions['open-recipe'](d);
  },
  'waste-new': () => wasteForm(null),
  'bin-new': () => binForm(null),
  'bin-edit': (d) => binForm(bins().find((b) => b.k === d.k)),
  'bin-delete': (d) => {
    const list = bins().filter((b) => b.k !== d.k);
    if (!list.length) return toast('Mindestens eine Tonne muss bleiben.');
    saveBins(list);
    // An Abholtagen austragen; Tage ohne Tonne bleiben leer stehen und können gelöscht werden
    for (const p of (state.data.waste_pickups || []).filter((x) => x.bins?.includes(d.k)))
      save('waste_pickups', { id: p.id, bins: p.bins.filter((k) => k !== d.k) }, 'id', { quiet: true });
    closeSheet();
    toast('Tonne entfernt');
  },
  'waste-edit': (d) => wasteForm((state.data.waste_pickups || []).find((x) => x.id === d.id)),
  'waste-delete': (d) => {
    closeSheet();
    removeWithUndo('waste_pickups', d.id, 'Abholtag gelöscht');
  },
  'waste-import': () => wasteImport(),
  'waste-past': () => {
    state.wastePast = !state.wastePast;
    render();
  },
  'waste-person': (d) => {
    const people = wasteSettings().people || [];
    saveWasteSettings({ people: people.includes(d.id) ? people.filter((x) => x !== d.id) : [...people, d.id] });
  },
  'waste-out': (d) => {
    const p = (state.data.waste_pickups || []).find((x) => x.id === d.id);
    if (p) save('waste_pickups', { id: p.id, put_out_at: p.put_out_at ? null : new Date().toISOString(), put_out_by: p.put_out_at ? null : state.me || null });
  },
  'waste-migrate': () => {
    const old = oldWasteReminders();
    for (const t of old) {
      const date = D.addDays(t.due_date, 1);
      const bins = parseWaste(`${date} ${t.title}`)[0]?.bins || ['sonst'];
      const cur = (state.data.waste_pickups || []).find((p) => p.date === date);
      const note = /vorgezogen/i.test(`${t.title} ${t.notes}`) ? 'vorgezogen' : null;
      save('waste_pickups', { ...(cur ? { id: cur.id } : {}), date, bins: [...new Set([...(cur?.bins || []), ...bins])], ...(note ? { note } : {}) }, 'id', { quiet: true });
    }
    const people = [...new Set(old.flatMap((t) => peopleOf(t)))];
    const times = old.map((t) => D.hm(t.due_time)).filter(Boolean);
    saveWasteSettings({ on: true, ...(people.length ? { people } : {}), ...(times.length ? { time: times[0] } : {}) });
    removeWithUndo('tasks', old.map((t) => t.id), `${old.length} Müll-Erinnerungen übernommen`);
  },
  activities: () => openActivities(),
  'act-filter': (d) => {
    const f = { mine: false, own: false, ...state.actFilter };
    if (d.k === 'all') f.mine = false;
    if (d.k === 'mine') f.mine = true;
    if (d.k === 'own') f.own = !f.own;
    state.actFilter = f;
    const box = $('#act-body');
    if (box) box.innerHTML = activitiesHtml();
  },
  'act-open': (d) => {
    closeSheet();
    if (d.kind === 'event') {
      const ev = state.data.events.find((e) => e.id === d.id);
      return eventView(ev, ev?.weekdays?.length ? null : ev?.date || null);
    }
    if (d.kind === 'task') return actions['edit-task'](d);
    if (d.kind === 'recipe') return actions['open-recipe'](d);
    if (d.kind === 'note') return actions['open-note'](d);
    if (d.kind === 'birthday') return actions['edit-birthday'](d);
    if (d.kind === 'tab') return actions.tab({ tab: d.id });
    if (d.kind === 'day') {
      navPush();
      state.view = 'heute';
      state.date = d.id;
      window.scrollTo(0, 0);
      render();
    }
  },
  'new-note': () => noteForm(null),
  'note-form': (d) => noteForm((state.data.notes || []).find((x) => x.id === d.id)),
  'open-note': (d) => {
    state.noteId = d.id;
    state.noteEditing = null;
    navPush();
    state.view = 'notiz';
    window.scrollTo(0, 0);
    render();
  },
  'search-note': (d) => {
    state.searchBack = false;
    closeSheet();
    actions['open-note'](d);
  },
  'note-filter': (d) => {
    state.noteFilter = d.f === 'alle' ? null : d.f;
    render();
  },
  'note-pin': (d) => {
    const n = state.data.notes.find((x) => x.id === d.id);
    if (n) saveNote(n, { pinned: !n.pinned });
  },
  'note-toggle': (d) => {
    const n = state.data.notes.find((x) => x.id === d.id);
    if (!n) return;
    saveNote(n, { items: noteItems(n).map((x) => (x.id === d.item ? { ...x, done: !x.done } : x)) });
  },
  'note-reset': (d) => {
    const n = state.data.notes.find((x) => x.id === d.id);
    if (n) saveNote(n, { items: noteItems(n).map((x) => ({ ...x, done: false })) });
    toast('Alle Haken zurückgesetzt');
  },
  'note-to-shop': (d) => {
    const n = state.data.notes.find((x) => x.id === d.id);
    const open = n ? noteItems(n).filter((x) => !x.head && !x.done) : [];
    open.forEach((x) => addItem(x.text, { countUse: false }));
    toast(`${open.length} ${open.length === 1 ? 'Punkt' : 'Punkte'} auf die Einkaufsliste gesetzt`);
  },
  'note-edit-body': (d) => {
    state.noteEditing = d.id;
    render();
    const t = $('#note-body');
    if (t) {
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
      autoGrow(t);
    }
  },
  'note-done': () => {
    const t = $('#note-body');
    if (t) saveNoteBody(t);
    state.noteEditing = null;
    t?.blur();
    render();
  },
  'note-delete': (d) => {
    closeSheet();
    removeWithUndo('notes', d.id, 'Notiz gelöscht');
    if (state.view === 'notiz') actions.back();
  },
  'search-goto': (d) => {
    state.searchBack = false;
    closeSheet();
    navPush(); // Zurück führt zum vorherigen Bildschirm
    state.view = 'heute';
    state.date = d.day;
    window.scrollTo(0, 0);
    render();
  },
  'toggle-cancel': (d) => {
    const o = eventsOn(d.day).find((x) => x.ev.id === d.id);
    if (o) setOccurrence(o, { cancelled: !o.cancelled });
    closeSheet();
  },
  'open-occurrence': (d) => eventForm(state.data.events.find((e) => e.id === d.id), d.day),
  'more-occurrences': (d, el) => {
    const ev = state.data.events.find((e) => e.id === d.id);
    el.closest('.occ-body').innerHTML = occurrenceList(ev, Number(d.n));
  },
  'reset-exception': (d) => {
    closeSheet();
    removeWithUndo('events', d.id, 'Wieder wie die Serie');
  },
  'delete-event': (d) => {
    const ev = state.data.events.find((e) => e.id === d.id);
    closeSheet();
    // Einzeländerung löschen = der Serientermin an diesem Tag fällt aus
    if (ev?.series_id) {
      save('event_occurrences', { event_id: ev.series_id, date: ev.series_date, cancelled: true }, 'event_id,date', { quiet: true });
      return removeWithUndo('events', d.id, 'Termin gelöscht');
    }
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
    state.taskFilter = null;
    refreshPush();
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
  shops: () => shopsPanel(),
  'shop-default': (d) => {
    for (const x of state.data.shops) if (x.is_default && x.id !== d.id) save('shops', { id: x.id, is_default: false }, 'id', { quiet: true });
    save('shops', { id: d.id, is_default: true }, 'id', { quiet: true });
    setTimeout(shopsPanel, 0);
  },
  'shop-delete': (d) => {
    const x = state.data.shops.find((s) => s.id === d.id);
    if (!x) return;
    const fallback = shopList().find((s) => s.id !== x.id)?.name || 'Lidl';
    const moved = state.data.shopping_items.filter((i) => sameShop(shopOf(i), x.name));
    for (const i of moved) save('shopping_items', { id: i.id, shop: fallback }, 'id', { quiet: true });
    if (state.shopFilter && sameShop(state.shopFilter, x.name)) state.shopFilter = null;
    del('shops', x.id);
    toast(moved.length ? `${x.name} entfernt – ${moved.length} ${moved.length === 1 ? 'Artikel' : 'Artikel'} jetzt bei ${fallback}` : `${x.name} entfernt`);
    setTimeout(shopsPanel, 0);
  },
  'shop-filter': (d) => {
    state.shopFilter = d.shop || null;
    render();
  },
  'clear-done': () => {
    const done = state.data.shopping_items
      .filter((i) => i.done && (state.view !== 'einkauf' || !state.shopFilter || sameShop(shopOf(i), state.shopFilter)))
      .map((i) => i.id);
    removeWithUndo('shopping_items', done, `${done.length} erledigte entfernt`);
  },
  'copy-list': async () => {
    const open = state.data.shopping_items.filter((i) => !i.done && (!state.shopFilter || shopOf(i) === state.shopFilter));
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
  if (e.target.closest('a[href]')) return; // Telefon/Mail/Link in Notizen
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
  if (el.dataset.change === 'push') {
    const row = pushRow();
    if (!row) return;
    const v = el.type === 'checkbox' ? el.checked : el.name === 'lead' ? Number(el.value) : el.value || '07:00';
    save('push_subscriptions', { id: row.id, [el.name]: v });
    return;
  }
  if (el.name === 'color' && el.closest('.color-pick')) el.form.elements.custom.value = el.value;
  if (el.dataset.change === 'waste-on') return saveWasteSettings({ on: el.checked });
  if (el.dataset.change === 'waste-time') return el.value && saveWasteSettings({ time: el.value });
  if (el.id === 'waste-file' && el.files?.[0]) {
    const text = await el.files[0].text();
    const found = parseWaste(text);
    $('#waste-text').value = found.map((x) => `${x.date.split('-').reverse().join('.')} ${binsText(x.bins)}`).join('\n');
    $('#waste-preview').textContent = found.length ? `${found.length} Abholtage erkannt – prüfen und „Sichern“.` : 'In der Datei wurden keine Termine erkannt.';
    return;
  }
  if (el.dataset.change === 'nowline') {
    lsSet('fo-nowline', el.checked ? '1' : null);
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
    state.taskFilter = null;
    refreshPush();
    return;
  }
  if (el.name === 'repeat') updateRepeatVisibility(el.form);
  if (el.name === 'rhythm') updateRhythmVisibility(el.form);
  // Mehrtägig: "Von" gewählt → "Bis" mindestens auf den Folgetag
  if (el.name === 'date_from' && el.value && el.form?.elements.date_to) {
    const to = el.form.elements.date_to;
    const next = D.addDays(el.value, 1);
    to.min = next;
    if (!to.value || to.value <= el.value) to.value = next;
  }
  // Termin: Beginn gesetzt → Ende eine Stunde später vorschlagen (wenn leer oder davor)
  if (el.name === 'start_time' && el.value && el.form?.elements.end_time && el.form.elements.repeat?.value !== 'multi') {
    const endEl = el.form.elements.end_time;
    if (!endEl.value || endEl.value <= el.value) endEl.value = hmPlus(el.value, 60);
  }
  // Von "Ein Tag" auf "Mehrere Tage": gewähltes Datum als Beginn übernehmen
  if (el.name === 'repeat' && el.value === 'multi' && el.form.elements.date_once?.value && el.form.elements.date_from) {
    const from = el.form.elements.date_from;
    const to = el.form.elements.date_to;
    from.value = el.form.elements.date_once.value;
    to.min = D.addDays(from.value, 1);
    if (!to.value || to.value <= from.value) to.value = D.addDays(from.value, 1);
  }
  if (el.name === 'repeat' && el.form.querySelector('[data-time-label]')) {
    const multi = el.value === 'multi';
    el.form.querySelector('[data-time-label="start"]').textContent = multi ? 'Beginn (1. Tag)' : 'Beginn';
    el.form.querySelector('[data-time-label="end"]').textContent = multi ? 'Ende (letzter Tag)' : 'Ende';
  }
});

// Beim Tippen im Einkauf anzeigen, in welche Kategorie der Artikel kommt
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'search-q') {
    state.search.q = el.value;
    renderSearchResults();
    return;
  }
  // Tonnenfarbe: eigene Farbe gewählt → Vorgaben abwählen
  if (el.name === 'custom' && el.closest('.sheet')) {
    el.form.querySelectorAll('input[name="color"]').forEach((r) => (r.checked = false));
    return;
  }
  if (el.id === 'waste-text') {
    const n = parseWaste(el.value).length;
    $('#waste-preview').textContent = n ? `${n} Abholtage erkannt.` : '';
    return;
  }
  if (el.id === 'note-search') {
    const q = el.value.trim().toLowerCase();
    let shown = 0;
    $('#main').querySelectorAll('.notes-list li').forEach((li) => {
      li.hidden = q && !li.dataset.search.includes(q);
      if (!li.hidden) shown++;
    });
    $('#main').querySelectorAll('.notes-list').forEach((ul) => (ul.closest('section').hidden = ![...ul.children].some((li) => !li.hidden)));
    const none = $('#main .note-none');
    if (none) none.hidden = shown > 0;
    return;
  }
  if (el.id === 'note-body') {
    autoGrow(el);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveNoteBody(el), 800);
    return;
  }
  if (el.id === 'recipe-search') {
    const q = el.value.trim().toLowerCase();
    const root = el.closest('.sheet') || $('#main');
    root.querySelectorAll('#recipe-list-ul li').forEach((li) => {
      li.hidden = q && !li.querySelector('[data-search]').dataset.search.includes(q);
    });
    return;
  }
  if (el.form?.dataset.form === 'add-item' && el.name === 'name') renderSuggestions(el.value);
  if (el.classList?.contains('meal-input')) {
    const field = el.closest('.meal-field');
    field.querySelector('.meal-text').textContent = el.value;
    field.classList.toggle('has-text', !!el.value.trim());
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

  if (kind === 'note-add') {
    const raw = (f.get('text') || '').trim();
    const n = (state.data.notes || []).find((x) => x.id === form.dataset.id);
    if (!raw || !n) return;
    const head = /:$/.test(raw) && raw.length > 1;
    const input = form.querySelector('input');
    input.value = '';
    input.blur(); // sonst wird nicht neu gezeichnet
    saveNote(n, { items: [...noteItems(n), { id: noteId(), text: head ? raw.replace(/:+$/, '').trim() : raw, done: false, head }] });
    $('.nl-add input')?.focus(); // gleich den nächsten Punkt eintippen
  }

  if (kind === 'add-shop') {
    const name = (f.get('shop') || '').trim();
    if (!name) return;
    const hit = shopList().find((x) => x.id && sameShop(x.name, name));
    ensureShop(name);
    toast(hit ? `${hit.name} gibt es schon` : `${name} hinzugefügt`);
    setTimeout(shopsPanel, 0);
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
    return listStep(dir);
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

// Kalender-Liste: beim Scrollen Titel nachführen und unten weitere Tage laden
let listTick = false;
window.addEventListener(
  'scroll',
  () => {
    if (listTick || state.view !== 'woche' || state.cal === 'monat') return;
    listTick = true;
    requestAnimationFrame(() => {
      listTick = false;
      updateListHeader();
      const nearEnd = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900;
      if (nearEnd && state.listTo < D.addDays(D.todayKey(), 400)) {
        state.listTo = D.addDays(state.listTo, 14);
        render();
      }
    });
  },
  { passive: true }
);

// App ist offen = Nachrichten gesehen: eigene Push-Nachrichten aus der Leiste räumen
// (damit verschwindet auch der Punkt am App-Symbol)
function clearNotifications() {
  if (document.hidden || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.getNotifications?.())
    .then((list) => (list || []).forEach((n) => n.close()))
    .catch(() => {});
}
clearNotifications();
document.addEventListener('visibilitychange', clearNotifications);

// Wieder geöffnet: aktuelle Daten holen. Nach längerer Pause zurück auf "Heute".
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    return;
  }
  if (state.hiddenAt && Date.now() - state.hiddenAt > 10 * 60 * 1000 && !document.body.classList.contains('sheet-open')) {
    state.date = D.todayKey();
    listReset();
    state.view = 'heute';
    nav.stack = [];
    navSync();
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
  startLive();
  render();
  if (store.isCloud) refreshPush();
}

// Live-Aktualisierung: Änderungen der anderen sofort zeigen.
// Zusätzlich als Sicherheitsnetz: regelmäßig nachladen, solange die App sichtbar ist
// (häufiger, wenn die Live-Verbindung gerade weg ist).
const live = { ok: false, lastReload: 0 };
const liveReload = debounce(() => {
  live.lastReload = Date.now();
  reload();
}, 400);
function startLive() {
  store.subscribe(liveReload, (ok) => {
    const was = live.ok;
    live.ok = ok;
    if (ok && !was) liveReload(); // nach (Wieder-)Verbinden verpasste Änderungen holen
  });
}
setInterval(() => {
  if (!store.isCloud || !state.session || document.hidden || !state.data) return;
  const every = live.ok ? 120000 : 20000;
  if (Date.now() - live.lastReload >= every) liveReload();
}, 10000);
window.addEventListener('online', () => {
  if (!store.isCloud || !state.session) return;
  startLive();
  liveReload();
});
window.addEventListener('focus', () => store.isCloud && state.session && Date.now() - live.lastReload > 15000 && liveReload());

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// Heute: Tagesablauf jede Minute auffrischen ("jetzt"-Linie, Vergangenes blass)
setInterval(() => {
  if (document.hidden || state.view !== 'heute' || state.date !== D.todayKey() || document.body.classList.contains('sheet-open')) return;
  render();
}, 60000);

function openDayFromPush(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return;
  state.date = day;
  state.view = 'heute';
  closeSheet();
  window.scrollTo(0, 0);
}

async function boot() {
  const fromPush = new URLSearchParams(location.search).get('day');
  if (fromPush) {
    openDayFromPush(fromPush);
    history.replaceState(null, '', location.pathname);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.goto) {
        openDayFromPush(e.data.goto);
        if (state.data) render();
      }
    });
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

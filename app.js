import * as store from './store.js';
import * as D from './dates.js';
import { CATEGORIES, QUICK_DEFAULTS, categoryOf, classify, normalize, seedProducts } from './products.js';

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
  pendingRender: false,
};

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
    o.sort = o.time.startsWith('Ganz') || o.time.startsWith('bis') ? '' : D.hm(ev.start_time);
    out.push(o);
  }
  return out.sort((a, b) => a.sort.localeCompare(b.sort) || a.ev.title.localeCompare(b.ev.title));
}

// Uhrzeit-Text für einen Termin an einem bestimmten Tag
function timeLabel({ ev, day, multi }) {
  const start = D.hm(ev.start_time);
  const end = D.hm(ev.end_time);
  if (multi) {
    if (day === ev.date && start) return `ab ${start}`;
    if (day === ev.end_date && end) return `bis ${end}`;
    return 'Ganztägig';
  }
  if (!start) return 'Ganztägig';
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
  return `
    <article class="card event ${o.cancelled ? 'cancelled' : ''} ${o.multi ? 'multi' : ''}">
      <button class="event-main" data-action="edit-event" data-id="${ev.id}" data-day="${o.day}">
        <div class="time ${allDay ? 'all-day' : ''}">${esc(o.time)}</div>
        <div class="body">
          <div class="title">${esc(ev.title)} ${o.weekly ? '<span class="muted small">↻</span>' : ''}</div>
          <div class="meta">${chip(ev.member_id)}${ev.location ? `<span class="muted">📍 ${esc(ev.location)}</span>` : ''}</div>
          ${o.multi ? `<div class="muted small">📆 ${esc(rangeLabel(o))}</div>` : ''}
          ${o.cancelled ? '<div class="tag">Fällt aus</div>' : ''}
          ${ev.notes ? `<div class="muted small">${esc(ev.notes)}</div>` : ''}
        </div>
      </button>
    </article>`;
}

/* ================= Aufgaben ================= */

const doneKey = (t) => (t.done_at ? D.toKey(new Date(t.done_at)) : null);
const isReminder = (t) => t.kind === 'erinnerung';
// Eine oder mehrere Personen (ältere Einträge haben nur "assignee")
const peopleOf = (t) => (t.assignees?.length ? t.assignees : t.assignee ? [t.assignee] : []);
const chips = (ids) => ids.map((id) => chip(id)).join('');

// kind: 'aufgabe' oder 'erinnerung'
function tasksOn(day, { filter = true, kind = 'aufgabe' } = {}) {
  const today = D.todayKey();
  const out = [];
  for (const t of state.data.tasks) {
    if ((t.kind || 'aufgabe') !== kind) continue;
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
  if (t.weekdays?.length) {
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
    ['meine', meMember() ? `Meine` : 'Meine'],
  ];

  return `
    ${
      reminders.length
        ? `<section>
            <div class="section-head"><h2>🔔 Erinnerungen</h2><button class="link" data-action="new-reminder">+ Erinnerung</button></div>
            <ul class="tasks card reminders">${reminders.map(taskRow).join('')}</ul>
          </section>`
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
            : '<p class="empty">Nichts zu tun. 🎉</p>'
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
      const reminders = tasksOn(day, { filter: false, kind: 'erinnerung' }).filter((x) => !x.overdue);
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
                        <span class="muted">${o.time === 'Ganztägig' ? (o.multi ? '📆' : 'ganzt.') : esc(o.time)}</span>
                        ${esc(o.ev.title)} ${chip(o.ev.member_id)}
                      </div>`
                    )
                    .join('')
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
          <label class="week-meal">
            <span>🍽️</span>
            <input class="meal-input" data-day="${day}" value="${esc(meal?.text || '')}" placeholder="Essen eintragen" enterkeyhint="next" />
          </label>
        </div>`;
    })
    .join('');
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

function addItem(name) {
  const category = classify(name, state.data.products);
  save('shopping_items', { name, category, done: false });
  rememberProduct(name, category);
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
        <ul class="card shop-list">
          ${list
            .map(
              (i) => `<li class="${i.done ? 'done' : ''}">
                <button class="check" data-action="toggle-item" data-id="${i.id}" aria-label="Abhaken">${i.done ? '✓' : ''}</button>
                <span class="name" data-action="toggle-item" data-id="${i.id}">${esc(i.name)}</span>
                <button class="icon-btn" data-action="edit-item" data-id="${i.id}" aria-label="Kategorie ändern oder löschen">⋯</button>
              </li>`
            )
            .join('')}
        </ul>
      </section>`;
  }).join('');

  const names = [...new Set(state.data.products.map((p) => p.name))].sort((a, b) => a.localeCompare(b));
  const anyOpen = items.some((i) => !i.done);

  return `
    ${state.data.missing?.includes('products') ? '<div class="banner">Datenbank-Update nötig: bitte supabase/update-2.sql in Supabase ausführen.</div>' : ''}
    <form class="card add-item" data-form="add-item">
      <input name="name" list="product-list" placeholder="Was fehlt?" autocomplete="off" enterkeyhint="done" required />
      <button class="btn primary" type="submit" aria-label="Hinzufügen">+</button>
    </form>
    <div class="cat-hint" id="cat-hint"></div>
    <datalist id="product-list">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    ${
      quick.length
        ? `<div class="quick">${quick
            .map(
              (q) => `<button class="quick-chip" data-action="quick-add" data-name="${esc(q.name)}">
                ${categoryOf(q.category).icon} ${esc(q.name)}</button>`
            )
            .join('')}</div>`
        : ''
    }
    ${groups || '<p class="empty">Die Liste ist leer.</p>'}
    <div class="shop-actions">
      ${anyOpen ? '<button class="btn ghost" data-action="copy-list">📋 Liste kopieren</button>' : ''}
      ${items.some((i) => i.done) ? '<button class="btn ghost" data-action="clear-done">Erledigte entfernen</button>' : ''}
    </div>`;
}

function itemForm(item) {
  const current = itemCategory(item);
  const inner = `
    <label>Name<input name="name" value="${esc(item.name)}" required /></label>
    <div class="cat-grid">
      ${CATEGORIES.map(
        (c) => `<label><input type="radio" name="category" value="${c.id}" ${c.id === current ? 'checked' : ''}/>
          <span><b>${c.icon}</b>${esc(c.label)}</span></label>`
      ).join('')}
    </div>
    <p class="muted small">Die App merkt sich die Kategorie für das nächste Mal.</p>`;
  openSheet(
    'Artikel',
    inner,
    (f) => {
      const name = f.get('name').trim();
      const category = f.get('category') || current;
      save('shopping_items', { id: item.id, name, category });
      rememberProduct(name, category, { countUse: false });
      closeSheet();
    },
    `<button type="button" class="btn danger wide" data-action="delete-item" data-id="${item.id}">Artikel löschen</button>`
  );
}

function viewMehr() {
  const ms = members();
  const events = [...state.data.events]
    .filter((e) => e.weekdays?.length || (e.date && (e.end_date || e.date) >= D.todayKey()))
    .sort((a, b) => !!b.weekdays?.length - !!a.weekdays?.length || (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title));
  const tasks = state.data.tasks.filter((t) => !isReminder(t) && (t.weekdays?.length || !t.done_at));
  const reminders = state.data.tasks
    .filter((t) => isReminder(t) && (t.weekdays?.length || !t.done_at))
    .sort(
      (a, b) =>
        !!b.weekdays?.length - !!a.weekdays?.length ||
        (a.due_date || '').localeCompare(b.due_date || '') ||
        (a.due_time || '').localeCompare(b.due_time || '')
    );

  const when = (x) =>
    x.weekdays?.length
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
      <div class="section-head"><h2>Familie &amp; Helfer</h2><button class="link" data-action="new-member">+ Person</button></div>
      <ul class="card list">
        ${ms
          .map(
            (m) => `<li><button data-action="edit-member" data-id="${m.id}">
              ${avatar(m)}
              <span class="grow">${esc(m.name)} <span class="muted small">${ROLES[m.role] || ''}</span></span>
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
      <div class="section-head"><h2>Erinnerungen</h2><button class="link" data-action="new-reminder">+ Erinnerung</button></div>
      <ul class="card list">
        ${
          reminders.length
            ? reminders
                .map(
                  (t) => `<li><button data-action="edit-task" data-id="${t.id}">
                    <span class="grow">🔔 ${esc(t.title)} ${t.weekdays?.length ? '<span class="muted small">↻</span>' : ''} ${chips(peopleOf(t))}</span>
                    <span class="muted small">${esc(when(t))}${t.due_time ? ` · ${D.hm(t.due_time)}` : ''}</span>
                  </button></li>`
                )
                .join('')
            : '<li class="empty">Keine Erinnerungen</li>'
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
          .map((m) => `<button class="btn big" style="--c:${esc(m.color)}" data-action="set-me" data-id="${m.id}">${avatar(m)}${esc(m.name)}</button>`)
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
  const allDay = !isNew && !ev.start_time;
  const o = !isNew && day ? eventsOn(day).find((x) => x.ev.id === ev.id) : null;

  const inner = `
    <label>Was?<input name="title" value="${esc(ev.title || '')}" placeholder="z. B. Pickleball" required /></label>
    <label>Für wen?<select name="member_id">${memberOptions(ev.member_id, { empty: '– alle / niemand –' })}</select></label>
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
    <label>Wo? (optional)<input name="location" value="${esc(ev.location || '')}" /></label>
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
        member_id: f.get('member_id') || null,
        date,
        weekdays: repeat === 'weekly' ? wds : null,
        end_date: endDate,
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

function reminderForm(t, day) {
  const isNew = !t;
  t ||= { due_date: day || state.date, assignees: state.me ? [state.me] : [] };
  const weekly = t.weekdays?.length > 0;
  const inner = `
    <label>Woran erinnern?<input name="title" value="${esc(t.title || '')}" placeholder="z. B. Turnbeutel einpacken" required /></label>
    ${repeatSwitch('repeat', weekly ? 'weekly' : 'once', [
      ['once', 'Einmalig'],
      ['weekly', 'Wiederkehrend'],
    ])}
    <div data-show="weekly">${weekdayPicker(t.weekdays || [D.isoWeekday(day || state.date)])}</div>
    <div class="row">
      <label data-show="once">Tag<input type="date" name="due_date" value="${esc(t.due_date || state.date)}" /></label>
      <label>Uhrzeit (optional)<input type="time" name="due_time" value="${esc(D.hm(t.due_time))}" /></label>
    </div>
    <div class="field-label">Für wen? <span class="muted small">(mehrere möglich – jede/r kann abhaken)</span></div>
    ${peoplePicker(peopleOf(t))}
    <label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`;
  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Erinnerung löschen</button>`;
  openSheet(
    isNew ? 'Neue Erinnerung' : 'Erinnerung bearbeiten',
    inner,
    (f) => {
      const people = readPeople();
      const repeat = f.get('repeat');
      const wds = readWeekdays($('#sheet-root form'));
      if (repeat === 'weekly' && !wds.length) return toast('Bitte mindestens einen Wochentag wählen.');
      save('tasks', {
        id: t.id,
        kind: 'erinnerung',
        title: f.get('title').trim(),
        assignees: people,
        assignee: people[0] || null,
        due_date: repeat === 'once' ? f.get('due_date') || state.date : null,
        weekdays: repeat === 'weekly' ? wds : null,
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
}

function taskForm(t, day) {
  const isNew = !t;
  t ||= { assignee: null, due_date: day || state.date };
  const mode = t.weekdays?.length ? 'weekly' : t.due_date ? 'date' : 'none';
  const inner = `
    <label>Was?<input name="title" value="${esc(t.title || '')}" placeholder="z. B. Getränke bestellen" required /></label>
    <div class="field-label">Wer? <span class="muted small">(leer = wer Zeit hat)</span></div>
    ${peoplePicker(peopleOf(t))}
    ${repeatSwitch('repeat', mode, [
      ['none', 'Ohne Datum'],
      ['date', 'An einem Tag'],
      ['weekly', 'Jede Woche'],
    ])}
    <label data-show="date">Datum<input type="date" name="due_date" value="${esc(t.due_date || state.date)}" /></label>
    <div data-show="weekly">${weekdayPicker(t.weekdays || [D.isoWeekday(day || state.date)])}</div>
    <label>Notiz<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`;

  const extra = isNew ? '' : `<button type="button" class="btn danger wide" data-action="delete-task" data-id="${t.id}">Aufgabe löschen</button>`;

  openSheet(
    isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten',
    inner,
    (f) => {
      const repeat = f.get('repeat');
      const wds = readWeekdays($('#sheet-root form'));
      if (repeat === 'weekly' && !wds.length) return toast('Bitte mindestens einen Wochentag wählen.');
      const people = readPeople();
      save('tasks', {
        id: t.id,
        kind: 'aufgabe',
        title: f.get('title').trim(),
        assignees: people,
        assignee: people[0] || null,
        due_date: repeat === 'date' ? f.get('due_date') || state.date : null,
        weekdays: repeat === 'weekly' ? wds : null,
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
    <div class="sheet chooser">
      <button class="btn big" data-action="new-event">📅 Termin</button>
      <button class="btn big" data-action="new-reminder">🔔 Erinnerung</button>
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
    const t = state.data.tasks.find((x) => x.id === d.id);
    if (!confirm(t && isReminder(t) ? 'Erinnerung löschen?' : 'Aufgabe löschen?')) return;
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
  'delete-item': (d) => {
    closeSheet();
    del('shopping_items', d.id);
  },
  'edit-item': (d) => {
    const i = state.data.shopping_items.find((x) => x.id === d.id);
    if (i) itemForm(i);
  },
  'quick-add': (d) => {
    addItem(d.name);
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
  'copy-list': async () => {
    const open = state.data.shopping_items.filter((i) => !i.done);
    const text = CATEGORIES.flatMap((c) => open.filter((i) => itemCategory(i) === c.id).map((i) => i.name)).join('\n');
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
  if (el.dataset.change === 'me') {
    state.me = el.value || null;
    lsSet('fo-me', state.me);
    render();
    return;
  }
  if (el.name === 'repeat') updateRepeatVisibility(el.form);
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
  if (el.form?.dataset.form === 'add-item' && el.name === 'name') {
    const hint = $('#cat-hint');
    if (hint) hint.textContent = categoryHint(el.value) ? `→ ${categoryHint(el.value)}` : '';
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
async function seedProductsIfEmpty() {
  if (state.data.products.length || state.data.missing?.includes('products')) return;
  const rows = seedProducts().map((p) => ({ id: store.uuid(), ...p, uses: 0 }));
  state.data.products = rows;
  try {
    await store.upsertMany('products', rows, 'key', true);
  } catch (e) {
    console.error(e);
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
  seedProductsIfEmpty();
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

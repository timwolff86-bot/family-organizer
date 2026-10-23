// Datenschicht: Supabase (gemeinsam) oder localStorage (nur dieses Gerät).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { addDays, todayKey } from './dates.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0/+esm';

export const TABLES = [
  'members',
  'events',
  'event_occurrences',
  'tasks',
  'task_completions',
  'meals',
  'shopping_items',
  'products',
];

// Tabellen mit vielen Einträgen pro Tag: nur die letzten 60 Tage + Zukunft laden.
const DATED = ['event_occurrences', 'task_completions', 'meals'];

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/* ---------- Supabase ---------- */

let sb = null;

export async function initCloud() {
  if (!isCloud || sb) return;
  const { createClient } = await import(SUPABASE_JS);
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export async function getSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!sb) return;
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase empfiehlt, im Callback nichts direkt abzuwarten.
    setTimeout(() => cb(event, session), 0);
  });
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

export function subscribe(onChange) {
  if (!sb) return;
  const ch = sb.channel('family-db');
  for (const table of TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
  }
  ch.subscribe();
}

/* ---------- lokaler Speicher ---------- */

const LS_KEY = 'fo-data-v1';

function localRead() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const t of TABLES) parsed[t] ||= [];
    return parsed;
  } catch {
    return Object.fromEntries(TABLES.map((t) => [t, []]));
  }
}

function localWrite(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// Was die Datenbank beim Löschen automatisch macht, hier nachbilden.
const ON_DELETE = {
  members: [
    ['events', 'member_id', 'null'],
    ['events', 'driver_to', 'null'],
    ['events', 'driver_back', 'null'],
    ['event_occurrences', 'driver_to', 'null'],
    ['event_occurrences', 'driver_back', 'null'],
    ['tasks', 'assignee', 'null'],
    ['tasks', 'done_by', 'null'],
  ],
  events: [['event_occurrences', 'event_id', 'cascade']],
  tasks: [['task_completions', 'task_id', 'cascade']],
};

/* ---------- gemeinsame Schnittstelle ---------- */

// Liefert alle Tabellen. missing: Tabellen, die es in der Datenbank (noch) nicht gibt.
export async function loadAll() {
  if (!isCloud) return { ...localRead(), missing: [] };
  const since = addDays(todayKey(), -60);
  const results = await Promise.all(
    TABLES.map((t) => {
      let q = sb.from(t).select('*').range(0, 4999);
      if (DATED.includes(t)) q = q.gte('date', since);
      return q;
    })
  );
  const data = { missing: [] };
  results.forEach((res, i) => {
    const t = TABLES[i];
    if (res.error) {
      // Tabelle fehlt → Datenbank-Update noch nicht ausgeführt. Rest der App läuft weiter.
      const notFound = res.error.code === '42P01' || res.error.code === 'PGRST205' || res.status === 404;
      if (!notFound) throw res.error;
      data.missing.push(t);
      data[t] = [];
    } else {
      data[t] = res.data;
    }
  });
  return data;
}

// Viele Einträge auf einmal. ignoreDuplicates: vorhandene nicht überschreiben.
export async function upsertMany(table, rows, conflict = 'id', ignoreDuplicates = false) {
  if (isCloud) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb
        .from(table)
        .upsert(rows.slice(i, i + 200), { onConflict: conflict, ignoreDuplicates });
      if (error) throw error;
    }
    return;
  }
  const data = localRead();
  const cols = conflict.split(',');
  for (const row of rows) {
    const i = data[table].findIndex((r) => cols.every((c) => r[c] === row[c]));
    if (i >= 0) {
      if (!ignoreDuplicates) data[table][i] = { ...data[table][i], ...row };
    } else data[table].push({ created_at: new Date().toISOString(), ...row });
  }
  localWrite(data);
}

// Legt an oder aktualisiert. conflict: Spalten, die einen Eintrag eindeutig machen.
export async function upsert(table, row, conflict = 'id') {
  if (isCloud) {
    const { error } = await sb.from(table).upsert(row, { onConflict: conflict });
    if (error) throw error;
    return;
  }
  const data = localRead();
  const cols = conflict.split(',');
  const list = data[table];
  const i = list.findIndex((r) => cols.every((c) => r[c] === row[c]));
  if (i >= 0) list[i] = { ...list[i], ...row };
  else list.push({ created_at: new Date().toISOString(), ...row });
  localWrite(data);
}

export async function remove(table, id) {
  if (isCloud) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const data = localRead();
  data[table] = data[table].filter((r) => r.id !== id);
  for (const [t, col, mode] of ON_DELETE[table] || []) {
    if (mode === 'cascade') data[t] = data[t].filter((r) => r[col] !== id);
    else data[t].forEach((r) => r[col] === id && (r[col] = null));
  }
  localWrite(data);
}

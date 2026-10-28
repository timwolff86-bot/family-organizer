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
  'recipes',
  'birthdays',
  'push_subscriptions',
  'shops',
  'notes',
  'waste_pickups',
  'app_settings',
  'activities',
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

/* ---------- Familienkonten (ab Update 21) ---------- */

// Ist die Datenbank auf Familien umgestellt? Dann gilt "einmalig" (z. B. ein Essen pro Tag) je Familie.
export let familyMode = false;
export const setFamilyMode = (on) => {
  familyMode = !!on;
};
const SCOPED = { meals: 'date', products: 'key', shops: 'name', app_settings: 'key', waste_pickups: 'date' };
const conflictFor = (table, conflict) => (familyMode && SCOPED[table] === conflict ? `family_id,${conflict}` : conflict);
const isNotFound = (error, status) => error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || status === 404;

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

// Supabase-Funktion aufrufen (mit der Anmeldung des Nutzers)
export async function invokeFunction(name, body) {
  if (!sb) throw new Error('Nur mit gemeinsamem Speicher');
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    // Antwort der Funktion mitliefern, damit die App eine verständliche Meldung zeigen kann
    let detail = null;
    try {
      detail = await error.context?.json();
    } catch {}
    const err = new Error(detail?.error || error.message);
    err.status = error.context?.status;
    throw err;
  }
  return data;
}

// Registrieren. data landet im Konto (Name, Einladungscode) und wird nach dem Bestätigen gebraucht.
export async function signUp(email, password, data) {
  const { data: res, error } = await sb.auth.signUp({
    email,
    password,
    options: { data, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return res; // { user, session } – session fehlt, wenn die E-Mail erst bestätigt werden muss
}

// Datenbank-Funktion aufrufen (Familie anlegen, beitreten, einladen …)
export async function rpc(name, args = {}) {
  const { data, error, status } = await sb.rpc(name, args);
  if (error) {
    const err = new Error(error.message);
    err.code = error.code;
    err.missing = isNotFound(error, status);
    throw err;
  }
  return data;
}

// Familie des angemeldeten Nutzers. { legacy: true } = Datenbank noch ohne Familienkonten.
export async function myFamily(userId) {
  const fu = await sb.from('family_users').select('family_id, role').eq('user_id', userId).maybeSingle();
  if (fu.error) {
    if (isNotFound(fu.error, fu.status)) return { legacy: true };
    throw fu.error;
  }
  if (!fu.data) return null;
  const f = await sb.from('families').select('id, name, can_invite_families, created_by, created_at').eq('id', fu.data.family_id).maybeSingle();
  if (f.error) throw f.error;
  return { id: fu.data.family_id, role: fu.data.role, name: f.data?.name || 'Familie', canInviteFamilies: !!f.data?.can_invite_families, isNew: !!f.data?.created_by && Date.now() - new Date(f.data.created_at) < 30 * 86400000 };
}

// Wer kann sich in der Familie anmelden, welche Einladungen sind offen
export async function familyAccounts() {
  const { data, error } = await sb.from('family_users').select('user_id, email, role, created_at').order('created_at');
  if (error) throw error;
  return data;
}
export async function openInvites() {
  const { data, error } = await sb
    .from('invites')
    .select('code, kind, note, expires_at, uses_left, created_at')
    .gt('uses_left', 0)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function deleteInvite(code) {
  const { error } = await sb.from('invites').delete().eq('code', code);
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

// Live-Änderungen der anderen Geräte. onStatus(true/false): Verbindung steht / ist weg.
// Bricht die Verbindung ab (Netzwechsel, Handy schläft), wird sie neu aufgebaut.
let channel = null;
let retry = null;
export function subscribe(onChange, onStatus = () => {}) {
  if (!sb) return;
  clearTimeout(retry);
  if (channel) sb.removeChannel(channel);
  const ch = sb.channel(`family-db-${Date.now()}`);
  for (const table of TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
  }
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') return onStatus(true);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      onStatus(false);
      if (ch !== channel) return;
      retry = setTimeout(() => subscribe(onChange, onStatus), 5000);
    }
  });
  channel = ch;
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
    ['tasks', 'created_by', 'null'],
  ],
  events: [
    ['event_occurrences', 'event_id', 'cascade'],
    ['events', 'series_id', 'cascade'],
  ],
  tasks: [['task_completions', 'task_id', 'cascade']],
  recipes: [['meals', 'recipe_id', 'null']],
};

/* ---------- gemeinsame Schnittstelle ---------- */

// Laufende Schreibvorgänge: ein gleichzeitiges Neuladen darf frisch Gespeichertes nicht überschreiben
export const writes = { seq: 0, pending: 0 };
async function tracked(fn) {
  writes.seq++;
  writes.pending++;
  try {
    return await fn();
  } finally {
    writes.pending--;
    writes.seq++;
  }
}

// Liefert alle Tabellen. missing: Tabellen, die es in der Datenbank (noch) nicht gibt.
export async function loadAll() {
  if (!isCloud) return { ...localRead(), missing: [] };
  const since = addDays(todayKey(), -60);
  const results = await Promise.all(
    TABLES.map((t) => {
      let q = sb.from(t).select('*').range(0, 4999);
      if (DATED.includes(t)) q = q.gte('date', since);
      // Neuigkeiten: nur die letzten 30 Tage, neueste zuerst
      if (t === 'activities') q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('created_at', { ascending: false }).range(0, 999);
      return q;
    })
  );
  const data = { missing: [], failed: [] };
  results.forEach((res, i) => {
    const t = TABLES[i];
    if (res.error) {
      // Tabelle fehlt → Datenbank-Update noch nicht ausgeführt. Rest der App läuft weiter.
      const notFound = res.error.code === '42P01' || res.error.code === 'PGRST205' || res.status === 404;
      if (notFound) data.missing.push(t);
      // Sonst (Netz, Anmeldung): diese Tabelle als fehlgeschlagen melden, die App behält die alten Daten
      else data.failed.push({ table: t, message: res.error.message || String(res.error.code || res.status) });
      data[t] = [];
    } else {
      data[t] = res.data;
    }
  });
  if (data.failed.length === TABLES.length) {
    const err = new Error(data.failed[0].message);
    err.failed = data.failed;
    throw err;
  }
  return data;
}

// Viele Einträge auf einmal. ignoreDuplicates: vorhandene nicht überschreiben.
export const upsertMany = (...a) => tracked(() => upsertManyNow(...a));
async function upsertManyNow(table, rows, conflict = 'id', ignoreDuplicates = false) {
  if (isCloud) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb
        .from(table)
        .upsert(rows.slice(i, i + 200), { onConflict: conflictFor(table, conflict), ignoreDuplicates });
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
export const upsert = (...a) => tracked(() => upsertNow(...a));
async function upsertNow(table, row, conflict = 'id') {
  if (isCloud) {
    let { error } = await sb.from(table).upsert(row, { onConflict: conflictFor(table, conflict) });
    // App war während des Datenbank-Updates offen: ab jetzt "je Familie" speichern
    if (error?.code === '42P10' && !familyMode && SCOPED[table] === conflict) {
      familyMode = true;
      ({ error } = await sb.from(table).upsert(row, { onConflict: conflictFor(table, conflict) }));
    }
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

export const remove = (...a) => tracked(() => removeNow(...a));
async function removeNow(table, id) {
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

// Sicherung: alle Tabellen vollständig (ohne Datumsgrenze), seitenweise geladen
export async function exportAll() {
  if (!isCloud) return localRead();
  const out = {};
  for (const t of TABLES) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(t).select('*').range(from, from + 999);
      if (error) {
        const notFound = error.code === '42P01' || error.code === 'PGRST205';
        if (notFound) break;
        throw error;
      }
      rows.push(...data);
      if (data.length < 1000) break;
    }
    out[t] = rows;
  }
  return out;
}

// Supabase Edge Function "push": verschickt Push-Nachrichten an die Handys der Familie.
//
// Zwei Aufrufe:
//  1. Jede Minute vom Zeitplan (pg_cron) mit Kopfzeile x-cron-secret → schaut, was fällig ist.
//  2. Aus der App mit {"test": true, "endpoint": …} → Test-Nachricht an genau dieses Gerät.
//
// Geheimnisse (Supabase → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET.
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase selbst bereit.
// Ohne fremde Bibliotheken: Verschlüsselung nach RFC 8291 (aes128gcm) und VAPID nach RFC 8292.

const TZ = 'Europe/Berlin';
const APP_URL = 'https://timwolff86-bot.github.io/family-organizer/';
const WINDOW_MIN = 15; // so weit zurück wird nachgeholt, falls ein Lauf ausfällt
const MISSED_DAYS = 7;

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const env = (k: string): string => (g.Deno ? g.Deno.env.get(k) : g.process?.env?.[k]) || '';

/* ---------- kleine Helfer ---------- */

const te = new TextEncoder();

export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* ---------- Web Push ---------- */

// Inhalt für ein Gerät verschlüsseln (RFC 8291, ein Datensatz)
export async function encryptPayload(p256dh: string, auth: string, text: string): Promise<Uint8Array> {
  const uaPub = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(te.encode(text), new Uint8Array([2])); // 2 = letzter Datensatz
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return concat(head, asPub, cipher);
}

// VAPID-Ausweis: zeigt dem Push-Dienst, dass die Nachricht von uns kommt (RFC 8292)
export async function vapidAuth(endpoint: string, pub: string, priv: string): Promise<string> {
  const p = b64uDecode(pub);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(p.slice(1, 33)), y: b64uEncode(p.slice(33, 65)), d: priv, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: unknown) => b64uEncode(te.encode(JSON.stringify(o)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL };
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${pub}`;
}

type Sub = {
  id: string;
  member_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  reminders: boolean;
  events: boolean;
  tasks: boolean;
  lead: number | null;
  daily_time: string | null;
};
type Msg = { title: string; body: string; day?: string; tag?: string };

export async function sendPush(sub: Sub, msg: Msg): Promise<number> {
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY')),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}

/* ---------- Datenbank (REST, mit Dienst-Schlüssel) ---------- */

async function db(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------- Datum & Uhrzeit (deutsche Zeit) ---------- */

export function berlin(date: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const dayNo = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86400000;
const keyOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (k: string, n: number) => keyOf(dayNo(k) + n);
const isoWeekday = (k: string) => ((new Date(dayNo(k) * 86400000).getUTCDay() + 6) % 7) + 1;
const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
const at = (k: string, min: number) => dayNo(k) * 1440 + min; // Minuten seit 1970 in deutscher Zeit
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const dayWord = (k: string, today: string) =>
  k === today ? 'Heute' : k === addDays(today, 1) ? 'Morgen' : k === addDays(today, -1) ? 'gestern' : `${WD[isoWeekday(k) - 1]} ${k.slice(8, 10)}.${k.slice(5, 7)}.`;

/* ---------- Was steht an? (wie in der App) ---------- */

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Data = { members: Row[]; events: Row[]; event_occurrences: Row[]; tasks: Row[]; task_completions: Row[]; waste_pickups?: Row[]; app_settings?: Row[] };

const BIN_LABEL: Record<string, string> = { rest: 'Restmüll', bio: 'Biotonne', papier: 'Papier', gelb: 'Gelbe Tonne', sonst: 'Sonstiges' };

const eventPeople = (ev: Row): string[] => (ev.member_ids?.length ? ev.member_ids : ev.member_id ? [ev.member_id] : []);
const peopleOf = (t: Row): string[] => (t.assignees?.length ? t.assignees : t.assignee ? [t.assignee] : []);
const rhythmOf = (t: Row) => t.repeat || (t.weekdays?.length ? 'weekly' : null);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function occursOn(t: Row, day: string): boolean {
  const r = rhythmOf(t);
  const from = t.repeat_from;
  if (from && day < from) return false;
  if (t.repeat_until && day > t.repeat_until) return false; // Serie beendet
  const [y, m, d] = day.split('-').map(Number);
  if (r === 'weekly') return !!t.weekdays?.includes(isoWeekday(day));
  if (r === 'biweekly') {
    if (!t.weekdays?.includes(isoWeekday(day))) return false;
    if (!from) return true;
    const monday = (k: string) => dayNo(k) - (isoWeekday(k) - 1);
    return Math.round((monday(day) - monday(from)) / 7) % 2 === 0;
  }
  if (!from) return false;
  const [, fm, fd] = from.split('-').map(Number);
  if (r === 'monthly') return d === Math.min(fd, daysInMonth(y, m));
  if (r === 'yearly') return m === fm && d === Math.min(fd, daysInMonth(y, m));
  return false;
}

// Termine, die an diesem Tag beginnen (Ausnahmen einer Serie ersetzen den Serientermin)
function eventsStarting(data: Data, day: string): Row[] {
  const replaced = new Set(data.events.filter((e) => e.series_id).map((e) => `${e.series_id}|${e.series_date}`));
  const wd = isoWeekday(day);
  return data.events.filter((ev) => {
    const weekly = ev.weekdays?.length > 0;
    if (weekly && replaced.has(`${ev.id}|${day}`)) return false;
    const hit = weekly
      ? ev.weekdays.includes(wd) && (!ev.end_date || ev.end_date >= day) && (!ev.date || ev.date <= day)
      : ev.date === day;
    if (!hit) return false;
    return !data.event_occurrences.some((o) => o.event_id === ev.id && o.date === day && o.cancelled);
  });
}

const completed = (data: Data, t: Row, day: string) => data.task_completions.some((c) => c.task_id === t.id && c.date === day);

function lastMissed(data: Data, t: Row, today: string): string | null {
  const since = t.created_at ? berlin(new Date(t.created_at)).day : null;
  for (let i = 1; i <= MISSED_DAYS; i++) {
    const d = addDays(today, -i);
    if (since && d < since) return null;
    if (!occursOn(t, d)) continue;
    return completed(data, t, d) ? null : d;
  }
  return null;
}

// Alles, was für ein Gerät in diesem Moment fällig ist: [Schlüssel gegen Doppelte, Nachricht]
export function dueFor(sub: Sub, data: Data, now: Date): [string, Msg][] {
  const { day: today, min } = berlin(now);
  const nowAt = at(today, min);
  const due = (t: number) => t <= nowAt && t > nowAt - WINDOW_MIN;
  const me = sub.member_id;
  const daily = toMin(sub.daily_time) ?? 7 * 60;
  const out: [string, Msg][] = [];

  // Termine mit Vorlauf (Termin selbst kann ihn überschreiben: -1 = nie, -2 = am Vortag 18 Uhr)
  if (sub.events) {
    for (const day of [today, addDays(today, 1)]) {
      for (const ev of eventsStarting(data, day)) {
        const people = eventPeople(ev);
        if (people.length && !(me && people.includes(me))) continue;
        const lead = ev.remind ?? sub.lead ?? 30;
        if (lead === -1 || lead === 0) continue;
        const start = ev.all_day ? null : toMin(ev.start_time);
        const when = lead === -2 ? at(addDays(day, -1), 18 * 60) : start == null ? at(day, 7 * 60) : at(day, start) - lead;
        if (!due(when)) continue;
        const time = ev.all_day || start == null ? 'ganztägig' : `${hm(ev.start_time)}${ev.end_time ? `–${hm(ev.end_time)}` : ''} Uhr`;
        const rel = day === today && start != null && lead > 0 ? `in ${lead < 60 ? `${lead} Min.` : `${lead / 60} Std.`}` : dayWord(day, today);
        out.push([
          `${sub.id}|ev|${ev.id}|${day}`,
          { title: ev.title, body: [`${rel} · ${time}`, ev.location].filter(Boolean).join(' · '), day, tag: `ev-${ev.id}-${day}` },
        ]);
      }
    }
  }

  // Erinnerungen: zur Uhrzeit, ohne Uhrzeit zur Tageszeit des Geräts
  if (sub.reminders) {
    for (const t of data.tasks) {
      if (t.kind !== 'erinnerung') continue;
      const people = peopleOf(t);
      if (people.length && !(me && people.includes(me))) continue;
      const recurring = !!rhythmOf(t);
      if (recurring ? !occursOn(t, today) || completed(data, t, today) : t.due_date !== today || t.done_at) continue;
      if (!due(at(today, toMin(t.due_time) ?? daily))) continue;
      out.push([
        `${sub.id}|rem|${t.id}|${today}`,
        { title: `🔔 ${t.title}`, body: [t.due_time ? `${hm(t.due_time)} Uhr` : 'Heute', t.notes].filter(Boolean).join(' · '), day: today, tag: `rem-${t.id}` },
      ]);
    }
  }

  // Abfallkalender: am Vortag zur eingestellten Uhrzeit (gilt für die gewählten Personen)
  if (sub.reminders && data.waste_pickups?.length) {
    // Ohne Einstellung wie in der App: alle Erwachsenen
    const adults = data.members.filter((m) => m.role !== 'kind').map((m) => m.id);
    const s = { on: true, time: '19:00', people: adults as string[], ...(data.app_settings?.find((x) => x.key === 'waste')?.value || {}) };
    const forMe = !s.people?.length || (me && s.people.includes(me));
    const p = data.waste_pickups.find((x) => x.date === addDays(today, 1) && x.bins?.length);
    if (s.on && forMe && p && !p.put_out_at && due(at(today, toMin(s.time) ?? 19 * 60))) {
      const what = p.bins.map((b: string) => BIN_LABEL[b] || b).join(' + ');
      out.push([
        `${sub.id}|waste|${p.id}`,
        { title: `🗑️ ${what} rausstellen`, body: ['Abholung morgen', p.note].filter(Boolean).join(' · '), day: today, tag: `waste-${p.id}` },
      ]);
    }
  }

  // Aufgaben: eine Sammelnachricht am Tag mit den eigenen offenen Aufgaben
  if (sub.tasks && me && due(at(today, daily))) {
    const open: string[] = [];
    for (const t of data.tasks) {
      if ((t.kind || 'aufgabe') !== 'aufgabe' || !peopleOf(t).includes(me)) continue;
      if (rhythmOf(t)) {
        const missed = lastMissed(data, t, today);
        if (missed) open.push(`${t.title} (${dayWord(missed, today)} nicht erledigt)`);
        if (occursOn(t, today) && !completed(data, t, today)) open.push(t.title);
      } else if (t.due_date && t.due_date <= today && !t.done_at) {
        open.push(t.due_date < today ? `${t.title} (seit ${t.due_date.slice(8, 10)}.${t.due_date.slice(5, 7)}.)` : t.title);
      }
    }
    if (open.length) {
      const shown = open.slice(0, 4).join(', ') + (open.length > 4 ? ` und ${open.length - 4} weitere` : '');
      out.push([
        `${sub.id}|tasks|${today}`,
        { title: open.length === 1 ? 'Deine Aufgabe heute' : `Deine ${open.length} Aufgaben heute`, body: shown, day: today, tag: `tasks-${today}` },
      ]);
    }
  }
  return out;
}

/* ---------- Läufe ---------- */

async function loadData(): Promise<Data> {
  const since = addDays(berlin(new Date()).day, -MISSED_DAYS - 1);
  const optional = (path: string) => db(path).catch(() => []); // Tabelle fehlt noch (Update 16) → leer
  const [members, events, event_occurrences, tasks, task_completions, waste_pickups, app_settings] = await Promise.all([
    db('members?select=id,name,role'),
    db('events?select=*'),
    db(`event_occurrences?select=event_id,date,cancelled&date=gte.${since}`),
    db('tasks?select=*'),
    db(`task_completions?select=task_id,date&date=gte.${since}`),
    optional(`waste_pickups?select=*&date=gte.${since}`),
    optional('app_settings?select=key,value'),
  ]);
  return { members, events, event_occurrences, tasks, task_completions, waste_pickups, app_settings };
}

export async function runOnce(now = new Date()) {
  const [subs, data, log] = await Promise.all([
    db('push_subscriptions?select=*') as Promise<Sub[]>,
    loadData(),
    db(`push_log?select=key&created_at=gte.${new Date(now.getTime() - 3 * 86400000).toISOString()}`),
  ]);
  const sent = new Set((log as Row[]).map((r) => r.key));
  let count = 0;
  for (const sub of subs) {
    for (const [key, msg] of dueFor(sub, data, now)) {
      if (sent.has(key)) continue;
      sent.add(key);
      // erst vormerken, dann senden: lieber eine Nachricht verlieren als doppelt schicken
      await db('push_log', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ key }) });
      const status = await sendPush(sub, msg).catch(() => 0);
      if (status === 404 || status === 410) {
        await db(`push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE' }); // Gerät abgemeldet
        break;
      }
      if (status >= 200 && status < 300) count++;
    }
  }
  // Protokoll klein halten
  await db(`push_log?created_at=lt.${new Date(now.getTime() - 7 * 86400000).toISOString()}`, { method: 'DELETE' });
  return { devices: subs.length, sent: count };
}

/* ---------- Aufruf ---------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const input = await req.json().catch(() => ({}));
    if (input.test) {
      // nur angemeldete Familienmitglieder dürfen testen
      const key = env('SUPABASE_SERVICE_ROLE_KEY');
      const user = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: key, Authorization: req.headers.get('Authorization') || '' } });
      if (!user.ok) return json({ error: 'nicht angemeldet' }, 401);
      const [sub] = (await db(`push_subscriptions?select=*&endpoint=eq.${encodeURIComponent(input.endpoint || '')}`)) as Sub[];
      if (!sub) return json({ error: 'Gerät nicht gefunden' }, 404);
      const status = await sendPush(sub, { title: 'Familienplaner', body: 'Test-Nachricht: Benachrichtigungen funktionieren 🎉', tag: 'test' });
      return status >= 200 && status < 300 ? json({ status }) : json({ error: `Push-Dienst antwortet mit ${status}`, status }, 502);
    }
    const secret = env('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'nicht erlaubt' }, 401);
    return json(await runOnce());
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}

if (g.Deno?.serve) g.Deno.serve(handler);

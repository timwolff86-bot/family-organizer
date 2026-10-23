// Feiertage (werden berechnet) und Schulferien (werden geladen) je Bundesland.
import { addDays, pad } from './dates.js';

export const STATES = [
  ['BW', 'Baden-Württemberg'],
  ['BY', 'Bayern'],
  ['BE', 'Berlin'],
  ['BB', 'Brandenburg'],
  ['HB', 'Bremen'],
  ['HH', 'Hamburg'],
  ['HE', 'Hessen'],
  ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'],
  ['NW', 'Nordrhein-Westfalen'],
  ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'],
  ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'],
  ['SH', 'Schleswig-Holstein'],
  ['TH', 'Thüringen'],
];

// Ostersonntag (Gauß/Anonymer Gregorianischer Algorithmus)
function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}

// Buß- und Bettag: Mittwoch vor dem 23. November
function bussUndBettag(y) {
  const d = new Date(y, 10, 22);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const cache = new Map();

// Liste der gesetzlichen Feiertage eines Jahres für ein Bundesland: [{ date, name }]
export function publicHolidays(year, state) {
  const key = `${year}-${state}`;
  if (cache.has(key)) return cache.get(key);
  const E = easter(year);
  const fix = (m, d) => `${year}-${pad(m)}-${pad(d)}`;
  const inState = (...list) => list.includes(state);
  const list = [
    [fix(1, 1), 'Neujahr'],
    inState('BW', 'BY', 'ST') && [fix(1, 6), 'Heilige Drei Könige'],
    inState('BE', 'MV') && [fix(3, 8), 'Internationaler Frauentag'],
    [addDays(E, -2), 'Karfreitag'],
    inState('BB') && [E, 'Ostersonntag'],
    [addDays(E, 1), 'Ostermontag'],
    [fix(5, 1), 'Tag der Arbeit'],
    [addDays(E, 39), 'Christi Himmelfahrt'],
    inState('BB') && [addDays(E, 49), 'Pfingstsonntag'],
    [addDays(E, 50), 'Pfingstmontag'],
    inState('BW', 'BY', 'HE', 'NW', 'RP', 'SL') && [addDays(E, 60), 'Fronleichnam'],
    inState('SL') && [fix(8, 15), 'Mariä Himmelfahrt'],
    inState('TH') && [fix(9, 20), 'Weltkindertag'],
    [fix(10, 3), 'Tag der Deutschen Einheit'],
    inState('BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH') && [fix(10, 31), 'Reformationstag'],
    inState('BW', 'BY', 'NW', 'RP', 'SL') && [fix(11, 1), 'Allerheiligen'],
    inState('SN') && [bussUndBettag(year), 'Buß- und Bettag'],
    [fix(12, 25), '1. Weihnachtstag'],
    [fix(12, 26), '2. Weihnachtstag'],
  ]
    .filter(Boolean)
    .map(([date, name]) => ({ date, name }));
  cache.set(key, list);
  return list;
}

export const holidayOn = (day, state) =>
  state ? publicHolidays(Number(day.slice(0, 4)), state).find((h) => h.date === day) : null;

/* ---------- Schulferien ---------- */

// Absicherung für NRW, falls der Ferien-Dienst nicht erreichbar ist
// (Herbst- und Winterferien 2026 laut Steinhagener Kalender bzw. NRW-Ferienordnung)
const FALLBACK = {
  NW: [
    { start: '2026-10-17', end: '2026-10-31', name: 'Herbstferien' },
    { start: '2026-12-23', end: '2027-01-06', name: 'Weihnachtsferien' },
  ],
};

const LS = (state) => `fo-ferien-${state}`;
const WEEK = 7 * 24 * 3600 * 1000;

function readCached(state) {
  try {
    return JSON.parse(localStorage.getItem(LS(state)) || 'null');
  } catch {
    return null;
  }
}

// Ferienzeiträume [{ start, end, name }] – sofort aus dem Speicher, sonst Absicherung
export function schoolHolidays(state) {
  if (!state) return [];
  return readCached(state)?.list || FALLBACK[state] || [];
}

export const schoolHolidayOn = (day, state) => schoolHolidays(state).find((h) => h.start <= day && h.end >= day);

// Lädt die Ferien vom offenen Ferien-Dienst (openholidaysapi.org) und merkt sie sich eine Woche.
// Gibt true zurück, wenn sich etwas geändert hat.
export async function refreshSchoolHolidays(state) {
  if (!state) return false;
  const cached = readCached(state);
  if (cached && Date.now() - cached.at < WEEK) return false;
  const y = new Date().getFullYear();
  const url =
    'https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&languageIsoCode=DE' +
    `&subdivisionCode=DE-${state}&validFrom=${y - 1}-01-01&validTo=${y + 1}-12-31`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return false;
    const data = await res.json();
    const list = data
      .map((h) => ({
        start: h.startDate,
        end: h.endDate,
        name: (h.name || []).find((n) => n.language === 'DE')?.text || h.name?.[0]?.text || 'Ferien',
      }))
      .filter((h) => h.start && h.end)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (!list.length) return false;
    localStorage.setItem(LS(state), JSON.stringify({ at: Date.now(), list }));
    return true;
  } catch {
    return false;
  }
}

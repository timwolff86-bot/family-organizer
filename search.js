// Suchlogik: Text vereinheitlichen, Anfrage zerlegen (Personen, Zeitraum, Suchwörter)
// und Treffer bewerten – tolerant gegenüber Tippfehlern, mit ähnlichen Begriffen.
import { addDays, fromKey, isoWeekday, startOfWeek, todayKey, pad } from './dates.js';

// Kleinbuchstaben, ä → ae usw., Satzzeichen weg
export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Ähnliche Begriffe: findet man ein Wort der Gruppe, zählen die anderen mit
const GROUPS = [
  ['arzt', 'aerztin', 'doktor', 'doc', 'praxis', 'kinderarzt', 'hausarzt', 'zahnarzt', 'augenarzt', 'frauenarzt', 'hautarzt', 'hno', 'orthopaede', 'kieferorthopaede', 'kfo', 'impfung', 'vorsorge', 'untersuchung', 'klinik', 'krankenhaus', 'physio', 'therapie'],
  ['zahnarzt', 'zahn', 'zaehne', 'kfo', 'kieferorthopaede', 'zahnspange', 'zahnreinigung', 'prophylaxe'],
  ['physio', 'physiotherapie', 'krankengymnastik', 'reha', 'therapie', 'achillessehne'],
  ['schule', 'elternabend', 'elternsprechtag', 'klassenfahrt', 'lehrer', 'lehrerin', 'zeugnis', 'klassenarbeit', 'ausflug', 'kita', 'kindergarten', 'ogs'],
  ['sport', 'training', 'turnier', 'spiel', 'pickleball', 'fussball', 'schwimmen', 'handball', 'tennis', 'turnen'],
  ['musik', 'klavier', 'schlagzeug', 'gitarre', 'musikschule', 'konzert', 'vorspiel'],
  ['muell', 'tonne', 'biotonne', 'restmuell', 'papiertonne', 'papier', 'gelbe', 'sack', 'abfall'],
  ['friseur', 'frisoer', 'haare', 'haarschnitt'],
  ['einkauf', 'einkaufen', 'rewe', 'lieferung', 'getraenke', 'supermarkt'],
  ['urlaub', 'reise', 'flug', 'hotel', 'ferien'],
  ['geburtstag', 'party', 'feier', 'geschenk'],
  ['auto', 'werkstatt', 'tuev', 'reifen', 'inspektion'],
];

const SYN = new Map();
for (const g of GROUPS) for (const w of g) SYN.set(w, [...new Set([...(SYN.get(w) || []), ...g])]);

// Tippfehler-Abstand (Damerau-Levenshtein, begrenzt)
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const allowed = (term) => (term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0);

// Wie gut passt ein Suchwort zu einem Wort im Text? 0 = gar nicht
function wordScore(term, word) {
  if (word === term) return 10;
  if (word.startsWith(term)) return 8;
  if (term.length >= 3 && word.includes(term)) return 6; // "arzt" in "zahnarzt"
  const max = allowed(term);
  if (!max) return 0;
  // Tippfehler im ganzen Wort oder im Wortanfang ("zahnartz", "klavi")
  // Kurze Wörter: nur Vertipper bei gleicher Länge ("arzt" findet nicht "Art")
  if ((term.length >= 6 || word.length === term.length) && distance(term, word, max) <= max) return 4;
  if (word.length > term.length && distance(term, word.slice(0, term.length), max) <= max) return 3;
  return 0;
}

function termScore(term, words) {
  let best = 0;
  for (const w of words) best = Math.max(best, wordScore(term, w));
  if (best >= 6) return best;
  // Ähnliche Begriffe – nur bei gut erkannten Suchwörtern
  // (bei Vertippern auch: "zahnartz" → Gruppe von "zahnarzt")
  const syns = SYN.get(term) || [...SYN.keys()].filter((k) => allowed(term) && distance(term, k, allowed(term)) <= allowed(term)).flatMap((k) => SYN.get(k));
  for (const s of new Set(syns)) {
    if (s === term) continue;
    for (const w of words) if (w === s || w.startsWith(s) || (s.length >= 4 && w.includes(s))) best = Math.max(best, 3.5);
  }
  return best;
}

// fields: [{ text, weight }] – alle Suchwörter müssen irgendwo passen
export function scoreFields(terms, fields) {
  if (!terms.length) return 1;
  const prepared = fields.filter((f) => f.text).map((f) => ({ words: fold(f.text).split(' ').filter(Boolean), weight: f.weight }));
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const f of prepared) best = Math.max(best, termScore(t, f.words) * f.weight);
    if (!best) return 0;
    total += best;
  }
  return total;
}

/* ---------- Anfrage zerlegen ---------- */

const MONTHS = [
  ['januar', 'jan'], ['februar', 'feb'], ['maerz', 'marz', 'mrz'], ['april', 'apr'], ['mai'], ['juni', 'jun'],
  ['juli', 'jul'], ['august', 'aug'], ['september', 'sep', 'sept'], ['oktober', 'okt'], ['november', 'nov'], ['dezember', 'dez'],
];
const WEEKDAYS = [['montag', 'mo'], ['dienstag', 'di'], ['mittwoch', 'mi'], ['donnerstag', 'do'], ['freitag', 'fr'], ['samstag', 'sa', 'sonnabend'], ['sonntag', 'so']];
const STOP = new Set(['der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'beim', 'bei', 'zum', 'zur', 'im', 'am', 'um', 'mit', 'von', 'fuer', 'und', 'termin', 'termine', 'wann']);

const monthEnd = (y, m) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;

// Zeitfilter: { label, from, to, test(day) }
function rangeFilter(label, from, to) {
  return { label, from, to, test: (d) => d >= from && d <= to };
}

// members: [{ id, name }] → { terms, people, filters, labels }
export function parseQuery(raw, members = [], today = todayKey()) {
  let q = ` ${fold(raw)} `;
  const filters = [];
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const phrase = (re, f) => {
    if (re.test(q)) {
      q = q.replace(re, ' ');
      filters.push(f());
    }
  };
  phrase(/ (naechste|naechsten|kommende|kommenden) woche /, () => {
    const s = addDays(startOfWeek(today), 7);
    return rangeFilter('nächste Woche', s, addDays(s, 6));
  });
  phrase(/ (letzte|letzten|vorige|vorigen) woche /, () => {
    const s = addDays(startOfWeek(today), -7);
    return rangeFilter('letzte Woche', s, addDays(s, 6));
  });
  phrase(/ (diese|dieser|diesen) woche /, () => rangeFilter('diese Woche', startOfWeek(today), addDays(startOfWeek(today), 6)));
  phrase(/ (naechste|naechsten|kommende|kommenden) monat /, () => {
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    return rangeFilter('nächsten Monat', `${ny}-${pad(nm)}-01`, monthEnd(ny, nm));
  });
  phrase(/ (letzte|letzten|vorige|vorigen) monat /, () => {
    const [ny, nm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return rangeFilter('letzten Monat', `${ny}-${pad(nm)}-01`, monthEnd(ny, nm));
  });
  phrase(/ (diese|dieser|diesen) monat /, () => rangeFilter('diesen Monat', `${y}-${pad(m)}-01`, monthEnd(y, m)));
  phrase(/ uebermorgen /, () => rangeFilter('übermorgen', addDays(today, 2), addDays(today, 2)));
  phrase(/ morgen /, () => rangeFilter('morgen', addDays(today, 1), addDays(today, 1)));
  phrase(/ gestern /, () => rangeFilter('gestern', addDays(today, -1), addDays(today, -1)));
  phrase(/ heute /, () => rangeFilter('heute', today, today));
  phrase(/ wochenende /, () => {
    const s = addDays(startOfWeek(today), 5);
    return rangeFilter('Wochenende', s, addDays(s, 1));
  });

  const terms = [];
  const people = [];
  const memberNames = members.map((mb) => ({ id: mb.id, name: fold(mb.name).split(' ')[0] }));
  let year = null;
  let month = null;
  let weekday = null;
  for (const tok of q.split(' ').filter(Boolean)) {
    if (/^20\d\d$/.test(tok)) {
      year = Number(tok);
      continue;
    }
    const mi = MONTHS.findIndex((names) => names.includes(tok));
    if (mi >= 0 && tok.length >= 3) {
      month = mi + 1;
      continue;
    }
    const wi = WEEKDAYS.findIndex((names) => names[0] === tok || (tok.length >= 4 && names[0].startsWith(tok)));
    if (wi >= 0) {
      weekday = wi + 1;
      continue;
    }
    const person = memberNames.find((mb) => mb.name && (mb.name === tok || (tok.length >= 3 && mb.name.startsWith(tok))));
    if (person) {
      if (!people.includes(person.id)) people.push(person.id);
      continue;
    }
    if (STOP.has(tok)) continue;
    terms.push(tok);
  }
  if (month || year) {
    const label = [month ? fromKey(`2000-${pad(month)}-01`).toLocaleDateString('de-DE', { month: 'long' }) : '', year || ''].filter(Boolean).join(' ');
    filters.push({
      label,
      from: year ? `${year}-${pad(month || 1)}-01` : addDays(today, -400),
      to: year ? monthEnd(year, month || 12) : addDays(today, 400),
      test: (d) => (!year || Number(d.slice(0, 4)) === year) && (!month || Number(d.slice(5, 7)) === month),
    });
  }
  if (weekday) {
    filters.push({
      label: WEEKDAYS[weekday - 1][0].replace(/^./, (c) => c.toUpperCase()),
      weekday,
      test: (d) => isoWeekday(d) === weekday,
    });
  }
  return { terms, people, filters };
}

// Kombinierter Zeitfilter: Prüfung + Suchbereich (für wiederkehrende Einträge)
export function combineFilters(filters, today = todayKey()) {
  if (!filters.length) return null;
  const from = filters.reduce((a, f) => (f.from && f.from > a ? f.from : a), addDays(today, -400));
  const to = filters.reduce((a, f) => (f.to && f.to < a ? f.to : a), addDays(today, 400));
  return { from, to, test: (d) => filters.every((f) => f.test(d)), labels: filters.map((f) => f.label) };
}

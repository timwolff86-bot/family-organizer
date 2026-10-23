// Datums-Helfer. Tage werden immer als 'YYYY-MM-DD' in lokaler Zeit behandelt.

export const pad = (n) => String(n).padStart(2, '0');

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayKey = () => toKey(new Date());

export const addDays = (k, n) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

// 1 = Montag … 7 = Sonntag
export const isoWeekday = (k) => fromKey(k).getDay() || 7;

export const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const startOfWeek = (k) => addDays(k, 1 - isoWeekday(k));

export const formatLong = (k) =>
  fromKey(k).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatShort = (k) =>
  fromKey(k).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

export const formatDayMonth = (k) =>
  fromKey(k).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

export const relativeLabel = (k) => {
  const diff = Math.round((fromKey(k) - fromKey(todayKey())) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff === 2) return 'Übermorgen';
  return diff > 0 ? `in ${diff} Tagen` : `vor ${-diff} Tagen`;
};

export const isoWeekNumber = (k) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

// '15:30:00' → '15:30'
export const hm = (t) => (t ? String(t).slice(0, 5) : '');

// Skins (Design-Stile): Standard, Neutral, Fantasy, Barbie – pro Handy gespeichert.
// Zum Entfernen: diese Datei, skins.css, den <link> in index.html, die Zeile in sw.js
// und die Stellen mit "skin" in app.js löschen.
import { setIconOverrides } from './icons.js';

export const SKINS = [
  { id: 'standard', label: 'Standard', colors: ['#2f6f6a', '#f6f4ef'] },
  { id: 'neutral', label: 'Neutral', colors: ['#1c1c1c', '#f4f4f3'] },
  { id: 'fantasy', label: 'Fantasy', colors: ['#2e5e3a', '#e9dcbc'], ownScheme: true, color: '#e9dcbc',
    fonts: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Alegreya:wght@400;500;700&display=swap',
    icons: { heute: '🏰', woche: '📜', kochbuch: '🧪', einkauf: '💰', mehr: '🗝️', search: '🔮', bell: '🔔' } },
  { id: 'barbie', label: 'Barbie', colors: ['#e0218a', '#fff0f7'], ownScheme: true, color: '#ffe3f1',
    fonts: 'https://fonts.googleapis.com/css2?family=Pacifico&family=Quicksand:wght@500;600;700&display=swap',
    icons: { heute: '💖', woche: '🗓️', kochbuch: '🧁', einkauf: '👛', mehr: '💅', search: '✨', bell: '🎀' } },
];

export const skinOf = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

export function applySkin(id) {
  const skin = skinOf(id);
  const root = document.documentElement;
  if (skin.id === 'standard') delete root.dataset.skin;
  else root.dataset.skin = skin.id;
  setIconOverrides(skin.icons);
  // Schriften nur laden, wenn der Skin sie braucht
  document.getElementById('skin-fonts')?.remove();
  if (skin.fonts) {
    const link = document.createElement('link');
    link.id = 'skin-fonts';
    link.rel = 'stylesheet';
    link.href = skin.fonts;
    document.head.appendChild(link);
  }
  return skin;
}

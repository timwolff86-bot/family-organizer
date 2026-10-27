// Service Worker: macht die App installierbar und startet sie auch bei schlechtem Netz.
// Eigene Dateien: erst Netz (damit Updates sofort ankommen), sonst Cache.
// Supabase-Bibliothek vom CDN: aus dem Cache, weil sich die Version nie ändert.
const CACHE = 'familienplaner-v105';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'store.js',
  'dates.js',
  'search.js',
  'icons.js',
  'richtext.js',
  'push.js',
  'products.js',
  'recipes.js',
  'holidays.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === 'https://cdn.jsdelivr.net') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // z. B. Supabase-Daten: nie cachen

  // no-cache: immer beim Server nachfragen, ob es eine neuere Version gibt
  // (sonst hält das Handy alte Dateien bis zu 10 Minuten fest)
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});

// Push-Nachricht empfangen und anzeigen
self.addEventListener('push', (e) => {
  let msg = {};
  try {
    msg = e.data ? e.data.json() : {};
  } catch {
    msg = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(msg.title || 'Familienplaner', {
      body: msg.body || '',
      tag: msg.tag,
      icon: 'icons/icon-192.png',
      data: { day: msg.day || null },
    })
  );
});

// Antippen: App öffnen (oder nach vorne holen) und den passenden Tag zeigen
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const day = e.notification.data?.day;
  const url = new URL(day ? `./?day=${day}` : './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => c.url.startsWith(self.registration.scope));
      if (client) {
        if (day) client.postMessage({ goto: day });
        return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/* DiamondTracker service worker — offline app shell.
   Cache-first for same-origin assets with a background refresh, so the
   installed app launches with no network. Cross-origin requests (Supabase,
   the esm.sh CDN, Google Fonts) are left to the network. Bump CACHE to ship
   a new shell. */
const CACHE = 'diamondtracker-v3';
const ASSETS = [
  './', './index.html', './css/styles.css', './manifest.json', './icon.svg',
  './js/app.js', './js/storage.js', './js/engine.js', './js/teams.js', './js/crest.js',
  './js/field.js', './js/standings.js', './js/stats.js', './js/awards.js', './js/schedule.js',
  './js/tournament.js', './js/sync.js', './js/ai.js', './js/auth.js', './js/rsvp.js',
  './js/sharecard.js', './js/push.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;  // don't touch CDN/Supabase/fonts
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;   // serve cache instantly; refresh in the background
    })
  );
});

/* ---- Web Push (opt-in; see js/push.js + supabase/functions/notify) ---- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'DiamondTracker';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icon.svg',
    badge: 'icon.svg',
    data: { url: data.url || './' },
    tag: data.tag || 'diamondtracker',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) { w.navigate && w.navigate(url); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});

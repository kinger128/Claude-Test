// Network first so updates arrive on the next launch; cache when offline.
const CACHE = 'takes-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'band.js', 'recorder-worklet.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const opts = { ignoreSearch: req.mode === 'navigate' };
      if (isFont) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      try {
        const res = await Promise.race([
          fetch(req, { cache: 'no-cache' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
        if (res.ok || res.type === 'opaque') cache.put(key, res.clone());
        return res;
      } catch {
        const hit = await cache.match(key, opts);
        if (hit) return hit;
        throw new Error('offline');
      }
    }),
  );
});

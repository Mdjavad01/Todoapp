/* Service Worker کارام — تولید خودکار پس از بیلد (نسخه 2026.11.02.17.25.31) */
const CACHE_NAME = 'karam-cache-2026.11.02.17.25.31';
const PRECACHE_URLS = [
  "./.htaccess",
  "./assets/base-DnVZuu9h.js",
  "./assets/index-3dgmL7CF.js",
  "./assets/index-Bwf0tH6Q.css",
  "./assets/index-C8upCYdX.js",
  "./assets/index-D9R0w9Y2.js",
  "./assets/index-DUsMthIf.js",
  "./assets/index-NH32FebX.js",
  "./assets/native-Bsra9mrW.js",
  "./assets/web--4U68Ozi.js",
  "./assets/web-3MripP9A.js",
  "./assets/web-BxnJ92-J.js",
  "./assets/web-Cpa2cKwh.js",
  "./assets/web-DuhD26IL.js",
  "./assets/web-Z0X1qthV.js",
  "./fonts/Vazirmatn-Variable.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // فقط دامین خودمان

  // API هرگز کش نمی‌شود — همیشه شبکه (حتی آفلاین پاسخ کهنه برنمی‌گردد؛ اپ خودش خطا را مدیریت می‌کند)
  if (url.pathname.includes('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // ناوبری‌ها: اول شبکه، در خطا کش و سپس index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
    return;
  }

  // بقیه‌ی منابع: کش-اول (آفلاین کامل)
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

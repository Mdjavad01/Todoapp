/* Service Worker کارام — تولید خودکار پس از بیلد (نسخه 2026.10.30.13.00.40) */
const CACHE_NAME = 'karam-cache-2026.10.30.13.00.40';
const PRECACHE_URLS = [
  "./.htaccess",
  "./assets/base-BT3-6crw.js",
  "./assets/base-CEzoeabA.js",
  "./assets/index-BJDfdlnF.js",
  "./assets/index-B_BSP-xS.js",
  "./assets/index-BqqXUw_R.js",
  "./assets/index-BwJMCJSf.js",
  "./assets/index-CvNI3ZLR.css",
  "./assets/index-Do_NaAPB.js",
  "./assets/index-OQ_ZdRHR.js",
  "./assets/native-Cq9RJtuD.js",
  "./assets/native-oMqTjQzV.js",
  "./assets/web-B16HqhbM.js",
  "./assets/web-C0Z2ywdk.js",
  "./assets/web-C8SKtgdN.js",
  "./assets/web-DKdwB7_V.js",
  "./assets/web-DlbPtmxO.js",
  "./assets/web-Dn6jNi5A.js",
  "./assets/web-Dtr60Y5b.js",
  "./assets/web-oxohE7-Q.js",
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

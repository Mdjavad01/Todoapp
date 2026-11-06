/* Service Worker کارام — تولید خودکار پس از بیلد (نسخه 2026.11.06.10.28.14) */
const CACHE_NAME = 'karam-cache-2026.11.06.10.28.14';
const PRECACHE_URLS = [
  "./assets/base-CeB3-KM-.js",
  "./assets/index-ANEGlhzU.js",
  "./assets/index-BGo6vAMF.js",
  "./assets/index-BOI-nNJI.js",
  "./assets/index-Boiv55fX.js",
  "./assets/index-C6Cjh-HA.css",
  "./assets/index-Dvj0fpdR.js",
  "./assets/native-Dar1Iu7-.js",
  "./assets/web-C0hPdwVr.js",
  "./assets/web-C2Wm8I0R.js",
  "./assets/web-Ca-jEzHN.js",
  "./assets/web-DcoH2eub.js",
  "./assets/web-SMcx6sav.js",
  "./assets/web-TlwjySr_.js",
  "./fonts/Vazirmatn-Variable.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./privacy/index.html",
  "./privacy/style.css",
  "./terms/index.html",
  "./terms/style.css"
];

self.addEventListener('install', (event) => {
  // skipWaiting خودکار نیست: نسخه‌ی نو در صف waiting می‌ماند تا بنر «بروزرسانی» در اپ
  // نشان داده شود و کاربر با کلیک، ریلود کند (src/pwa/register.ts — پیام SKIP_WAITING)
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
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

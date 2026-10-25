/**
 * ساخت Service Worker بعد از بیلد Vite:
 * - لیست کامل فایل‌های dist به‌صورت precache
 * - استراتژی cache-first برای منابع استاتیک same-origin
 * - API هرگز کش نمی‌شود (داده‌ی ورود/کانال‌ها/تنظیمات باید همیشه تازه باشد)
 * - آفلاین کامل بعد از اولین لود
 * اجرا: node scripts/generate-sw.mjs (بعد از vite build)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const distDir = new URL('../dist', import.meta.url).pathname;

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, base));
    } else {
      out.push('./' + relative(base, full).split('\\').join('/'));
    }
  }
  return out;
}

const files = walk(distDir).filter((f) => !f.endsWith('sw.js') && !f.endsWith('.DS_Store'));
const version = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '.');

const sw = `/* Service Worker کارام — تولید خودکار پس از بیلد (نسخه ${version}) */
const CACHE_NAME = 'karam-cache-${version}';
const PRECACHE_URLS = ${JSON.stringify(files, null, 2)};

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
`;

writeFileSync(join(distDir, 'sw.js'), sw, 'utf8');
console.log(`✅ sw.js ساخته شد — ${files.length} فایل precache شد.`);

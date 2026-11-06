/**
 * ثبت Service Worker برای PWA — مسیر نسبی تا در روت دامین و زیرپوشه هر دو کار کند.
 * فاز ۶: داخل اپ اندروید (WebView بومی) سرویس‌ورکر ثبت نمی‌شود —
 * فایل‌ها بسته‌بندی‌شده داخل APK هستند و کش دوتایی نمی‌خواهیم.
 *
 * جریان به‌روزرسانی (v1.11.3 — «بروزرسانی کنید»):
 * - sw.js دیگر خودش skipWaiting نمی‌کند؛ سرویس‌ورکر نو در صف waiting می‌ماند
 * - onSwWaiting به UpdateBanner خبر می‌دهد → بنر «نسخه‌ی جدید آماده است»
 * - applySwUpdate: پیام SKIP_WAITING → فعال‌سازی → controllerchange → یک‌بار ریلود
 */
import { isNativeApp } from '@/lib/native';

let waiting: ServiceWorker | null = null;
const waitingListeners = new Set<(w: ServiceWorker | null) => void>();
let reloadArmed = false;

function setWaiting(w: ServiceWorker | null): void {
  if (waiting === w) return;
  waiting = w;
  waitingListeners.forEach((fn) => fn(w));
}

/** اشتراک وضعیت «نسخه‌ی نو آماده است» — null یعنی بنر خاموش */
export function onSwWaiting(fn: (w: ServiceWorker | null) => void): () => void {
  waitingListeners.add(fn);
  fn(waiting);
  return () => {
    waitingListeners.delete(fn);
  };
}

/** کلیک «بروزرسانی» در بنر — فعال‌سازی سرویس‌ورکر نو و سپس یک‌بار بارگذاری مجدد */
export function applySwUpdate(): void {
  if (!waiting) return;
  reloadArmed = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker(): void {
  if (isNativeApp()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        // اگر بین دو بازدید سرویس‌ورکری در صف مانده باشد، فوراً بنر نشان بده
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // controller یعنی نسخه‌ی فعلی در حال اجراست؛ installed نو = به‌روزرسانی آماده
            if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch((err) => {
        console.warn('ثبت Service Worker ناموفق بود:', err);
      });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // فقط بعد از کلیک «بروزرسانی» ریلود می‌کنیم — نه با هر claim بی‌مانند
      if (reloadArmed) window.location.reload();
    });
  });
}

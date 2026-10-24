/**
 * ثبت Service Worker برای PWA — مسیر نسبی تا در روت دامین و زیرپوشه هر دو کار کند.
 * فاز ۶: داخل اپ اندروید (WebView بومی) سرویس‌ورکر ثبت نمی‌شود —
 * فایل‌ها بسته‌بندی‌شده داخل APK هستند و کش دوتایی نمی‌خواهیم.
 */
import { isNativeApp } from '@/lib/native';

export function registerServiceWorker(): void {
  if (isNativeApp()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.warn('ثبت Service Worker ناموفق بود:', err);
    });
  });
}

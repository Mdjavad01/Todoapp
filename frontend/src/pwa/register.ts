/** ثبت Service Worker برای PWA — مسیر نسبی تا در روت دامین و زیرپوشه هر دو کار کند */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.warn('ثبت Service Worker ناموفق بود:', err);
    });
  });
}

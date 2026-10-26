/**
 * کارام — لایه‌ی تشخیص محیط بومی (فاز ۶ — نسخه‌ی اندروید)
 * کلید «مرکز فرماندهی واحد»: همین کدبیس وب داخل WebView اندروید هم اجرا می‌شود.
 * در نسخه‌ی وب همه‌ی توابع رفتار عادی دارند؛ فقط داخل اپ مسیر بومی اجرا می‌شود.
 */

import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

interface CapRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function cap(): CapRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapRuntime }).Capacitor;
}

/** آیا برنامه داخل WebView اندروید (Capacitor) اجرا می‌شود؟ */
export function isNativeApp(): boolean {
  const c = cap();
  return typeof c?.isNativePlatform === 'function' && c.isNativePlatform() === true;
}

/**
 * گام ۲ — پلتفرم اپ برای هدر X-App-Platform (کلید خاموش‌کردن پرداخت‌ها).
 * فقط 'android' معنا دارد؛ هر چیز دیگر (وب/ios) سمت سرور مثل وب رفتار می‌کند.
 */
export function appPlatform(): 'web' | 'android' {
  const p = cap()?.getPlatform?.() ?? 'web';
  return p === 'android' ? 'android' : 'web';
}

/**
 * بازکردن لینک خارجی (درگاه پرداخت زیبال):
 *  - اپ اندروید: تب مرورگر سیستم (Custom Tab) — کاربر پرداخت می‌کند و برمی‌گردد
 *  - وب: ناوبری در همان تب — بازگشت با ?payResult=
 */
export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) {
    await Browser.open({ url });
    return;
  }
  window.location.href = url;
}

/**
 * گوش‌دادن به بسته‌شدن تب مرورگر (بازگشت از درگاه پرداخت در اپ اندروید)
 * خروجی: تابع لغو گوش‌دادن
 */
export function onBrowserFinished(callback: () => void): () => void {
  if (!isNativeApp()) return () => undefined;
  const handle = Browser.addListener('browserFinished', callback);
  return () => {
    void handle.then((h) => h.remove());
  };
}

/**
 * گوش‌دادن به فعال‌شدن دوباره‌ی اپ (بازگشت از پیش‌زمینه) — همگام‌سازی دوباره
 * خروجی: تابع لغو گوش‌دادن
 */
export function onAppResume(callback: () => void): () => void {
  if (!isNativeApp()) return () => undefined;
  const handle = App.addListener('appStateChange', (state) => {
    if (state.isActive) callback();
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}

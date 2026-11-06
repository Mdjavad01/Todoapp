/**
 * کارام — نصب وب‌اپ (PWA) «نصب سریع کارام» + تشخیص محیط
 *
 * - رویداد beforeinstallprompt (کروم/اج/فایرفاکس — اندروید و دسکتاپ) یک‌بار گرفته و نگه‌داری
 *   می‌شود تا دکمه‌ی «نصب» خودمان در تنظیمات آن را اجرا کند (پاپ‌آپ خودکار مرورگر سرکوب می‌شود).
 * - تشخیص «نصب‌شده» با display-mode: standalone (و navigator.standalone سافاری).
 * - آیفون/آیپد رویداد beforeinstallprompt ندارد → راهنمای «هم‌رسانی ← Add to Home Screen».
 * - تصمیم نمایش به‌صورت تابع خالص installVariant است تا بدون مرورگر تست شود (tests/pwa.test.ts).
 */
import { isNativeApp } from '@/lib/native';

export type InstallVariant = 'native' | 'installed' | 'button' | 'ios-hint' | 'none';

export interface PwaEnv {
  /** داخل WebView اندروید (APK) هستیم؟ — آنجا ردیف نصب وب معنا ندارد */
  native: boolean;
  /** همین الان به‌صورت اپ نصب/اجرا می‌شود؟ */
  standalone: boolean;
  /** رویداد beforeinstallprompt گرفته شده و آماده‌ی prompt() است؟ */
  bip: boolean;
  /** آیفون/آیپد (شامل iPadOS که خودش را Mac معرفی می‌کند)؟ */
  ios: boolean;
}

/** خالص: با وضعیت محیط، کدام ردیف تنظیمات نمایش داده شود؟ */
export function installVariant(e: PwaEnv): InstallVariant {
  if (e.native) return 'native';
  if (e.standalone) return 'installed';
  if (e.bip) return 'button';
  if (e.ios) return 'ios-hint';
  return 'none';
}

/** تشخیص دستگاه iOS — iPadOS 13+ خودش را «MacIntel + لمسی» معرفی می‌کند */
export function isIosDevice(nav: Navigator = navigator): boolean {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return true;
  const platform = (nav as Navigator & { platform?: string }).platform ?? '';
  return platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

/** وضعیت واقعی محیط در لحظه‌ی فراخوانی — bip از وضعیت singleton پایین گرفته می‌شود */
export function detectPwaEnv(bipCaptured: boolean): PwaEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      nav.standalone === true);
  return { native: isNativeApp(), standalone, bip: bipCaptured, ios: isIosDevice() };
}

/* ── singleton رویداد نصب ── */

type BipEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BipEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/** اشتراک تغییر وضعیت «قابل‌نصب» — دکمه‌ی تنظیمات با آن تازه می‌شود */
export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function hasInstallPrompt(): boolean {
  return deferred !== null;
}

/** یک‌بار در سطح اپ (App) ثبت می‌شود — تابع پاک‌سازی برمی‌گرداند */
export function initInstallPrompt(): () => void {
  const onBip = (e: Event) => {
    // پاپ‌آپ خودکار مرورگر سرکوب می‌شود؛ جریان نصب با دکمه‌ی خود اپ انجام می‌شود
    e.preventDefault();
    deferred = e as BipEvent;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    notify();
  };
  window.addEventListener('beforeinstallprompt', onBip);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onBip);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

export type PromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** اجرای دیالوگ نصب بومی — رویداد یک‌بارمصرف است و بعد از هر تلاش آزاد می‌شود */
export async function promptInstall(): Promise<PromptOutcome> {
  const bip = deferred;
  if (!bip) return 'unavailable';
  try {
    bip.prompt();
    const choice = await bip.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  } finally {
    deferred = null;
    notify();
  }
}

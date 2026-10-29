/**
 * کارام — پل بیومتریک اندروید (فاز ۳ — قفل اثر انگشت)
 * تنها لایه‌ای که با @aparajita/capacitor-biometric-auth حرف می‌زند.
 *
 *  - وب: همه‌چیز بی‌عمل (پلاگین با import پویا فقط در اپ اندروید بارگذاری می‌شود —
 *    شبیه‌ساز وبِ خودِ پلاگین هرگز در جریان اصلی اپ استفاده نمی‌شود تا قفل وب‌سازی نشود).
 *  - قاعده‌ی طلایی: خطای بیومتریک هرگز جریان اپ را نمی‌شکند؛ نتیجه به شکل
 *    UnlockOutcome (قطعی و فارسی) برمی‌گردد تا ماشین حالت lib/appLock تصمیم بگیرد.
 *  - «رمز دستگاه» همیشه مجاز است (allowDeviceCredential) — اگر اثر انگشت حذف شده
 *    باشد، کاربر با PIN/الگو/رمز داخل می‌شود؛ حبس‌شدن ناممکن است.
 */

import { isNativeApp } from '@/lib/native';
import type { UnlockResult } from '@/lib/appLock';

/** اطلاعات بیومتریک دستگاه — نسخه‌ی ساده‌شده و فارسی‌پسند نتیجه‌ی پلاگین */
export interface BiometryInfo {
  native: boolean;
  /** بیومتریک همین حالا قابل استفاده است؟ (سخت‌افزار + ثبت‌شده + فعال برای اپ) */
  available: boolean;
  /** دستگاه با PIN/الگو/رمز محافظت می‌شود؟ (پشتوانه‌ی fallback قفل) */
  deviceSecure: boolean;
  /** بیومتریک «قوی» (معمولاً اثر انگشت) در دسترس است؟ */
  strong: boolean;
  kind: 'none' | 'fingerprint' | 'face' | 'iris' | 'touchid' | 'faceid' | 'multiple';
  /** کد خام علت دردسترس‌نبودن (برای تشخیص/تست) */
  code: string;
  /** علت به فارسی — در کارت تنظیمات نمایش داده می‌شود */
  reason: string;
}

/** آخرین خطای لایه‌ی بومی — برای شفافیت در تنظیمات (هیچ خطایی کاملاً بی‌صدا نمی‌ماند) */
export const biometricErrors: { last: { at: string; message: string } | null } = { last: null };

function recordError(message: string): void {
  biometricErrors.last = { at: new Date().toISOString(), message };
}

type BioModule = typeof import('@aparajita/capacitor-biometric-auth');

let cachedModule: BioModule | null = null;

async function bio(): Promise<BioModule | null> {
  if (!isNativeApp()) return null;
  if (!cachedModule) cachedModule = await import('@aparajita/capacitor-biometric-auth');
  return cachedModule;
}

/** برچسب فارسی نوع بیومتریک از کد خام پلاگین (BiometryType) */
export function biometryKindLabel(type: number): BiometryInfo['kind'] {
  // مقادیر BiometryType: 0 none · 1 touchId · 2 faceId · 3 fingerprint · 4 face · 5 iris
  switch (type) {
    case 1:
      return 'touchid';
    case 2:
      return 'faceid';
    case 3:
      return 'fingerprint';
    case 4:
      return 'face';
    case 5:
      return 'iris';
    default:
      return 'none';
  }
}

/** برچسب فارسی کد علت (BiometryErrorType) برای نمایش در تنظیمات */
export function biometryReasonFa(code: string): string {
  switch (code) {
    case 'biometryNotEnrolled':
      return 'هیچ اثر انگشتی در دستگاه ثبت نشده است';
    case 'biometryNotAvailable':
      return 'بیومتریک برای کارام غیرفعال است';
    case 'biometryLockout':
      return 'به‌خاطر تلاش‌های ناموفق موقتاً قفل شده است';
    case 'passcodeNotSet':
      return 'دستگاه رمز/PIN ندارد';
    case 'noDeviceCredential':
      return 'دستگاه رمز/PIN ندارد';
    case 'hardwareNotPresent':
    case 'none':
      return 'سخت‌افزار بیومتریک ندارد';
    case '':
      return 'وضعیت نامشخص';
    default:
      return 'در دسترس نیست';
  }
}

/**
 * نگاشت نتیجه‌ی خام checkBiometry پلاگین به BiometryInfo — خالص و تست‌پذیر.
 * ورودی فقط فیلدهای خوانده‌شده دارد تا تست بدون پلاگین ممکن باشد.
 */
export function mapBiometryResult(raw: {
  isAvailable: boolean;
  deviceIsSecure: boolean;
  strongBiometryIsAvailable: boolean;
  biometryType: number;
  code?: string;
  reason?: string;
}): BiometryInfo {
  const kind = biometryKindLabel(raw.biometryType);
  const available = raw.isAvailable === true;
  return {
    native: true,
    available,
    deviceSecure: raw.deviceIsSecure === true,
    strong: raw.strongBiometryIsAvailable === true,
    kind: available ? kind : 'none',
    code: raw.code ?? '',
    reason: available ? '' : biometryReasonFa(raw.code ?? ''),
  };
}

/** خواندن وضعیت بیومتریک دستگاه — در وب بی‌عمل (null = وب) */
export async function biometryInfo(): Promise<BiometryInfo | null> {
  const m = await bio();
  if (!m) return null;
  try {
    const raw = await m.BiometricAuth.checkBiometry();
    return mapBiometryResult({
      isAvailable: raw.isAvailable,
      deviceIsSecure: raw.deviceIsSecure,
      strongBiometryIsAvailable: raw.strongBiometryIsAvailable,
      biometryType: raw.biometryType,
      code: raw.code,
      reason: raw.reason,
    });
  } catch {
    recordError('خواندن وضعیت بیومتریک ناموفق بود');
    return {
      native: true,
      available: false,
      deviceSecure: false,
      strong: false,
      kind: 'none',
      code: 'error',
      reason: 'خواندن وضعیت بیومتریک ناموفق بود',
    };
  }
}

/** نتیجه‌ی یک تلاش احراز هویت — نتیجه قطعی + پیام فارسی آماده‌ی نمایش */
export interface UnlockOutcome {
  result: UnlockResult;
  message: string;
}

/**
 * نگاشت کد خطای BiometryError به نتیجه‌ی قطعی — خالص و تست‌پذیر.
 * ورودی کد رشته‌ای است (بدون وابستگی به کلاس پلاگین).
 */
export function mapBiometryError(code: string | undefined): UnlockOutcome {
  switch (code) {
    case 'userCancel':
    case 'appCancel':
    case 'systemCancel':
      return { result: 'cancel', message: 'احراز هویت لغو شد — برای ورود دوباره تلاش کنید' };
    case 'authenticationFailed':
      return { result: 'fail', message: 'اثر انگشت شناخته نشد — دوباره تلاش کنید' };
    case 'biometryLockout':
      return { result: 'fail', message: 'تلاش‌های ناموفق زیاد بود — چند لحظه صبر کنید' };
    case 'biometryNotEnrolled':
    case 'biometryNotAvailable':
    case 'noDeviceCredential':
    case 'passcodeNotSet':
      return { result: 'unavailable', message: 'بیومتریک/رمز دستگاه در دسترس نیست — قفل موقتاً برداشته شد' };
    case undefined:
      return { result: 'unavailable', message: 'بیومتریک در دسترس نیست — قفل موقتاً برداشته شد' };
    default:
      return { result: 'fail', message: 'احراز هویت ناموفق بود — دوباره تلاش کنید' };
  }
}

/**
 * درخواست احراز هویت (اثر انگشت/چهره یا رمز دستگاه) — با دیالوگ بومی فارسی.
 * هر خطا به UnlockOutcome قطعی نگاشت می‌شود؛ هرگز throw نمی‌کند.
 */
export async function biometricUnlock(reason: string): Promise<UnlockOutcome> {
  const m = await bio();
  if (!m) return { result: 'unavailable', message: 'بیومتریک فقط در اپ اندروید کار می‌کند' };
  try {
    await m.BiometricAuth.authenticate({
      reason,
      cancelTitle: 'لغو',
      androidTitle: 'کارام قفل است',
      androidSubtitle: 'ورود با اثر انگشت یا رمز دستگاه',
      allowDeviceCredential: true,
    });
    return { result: 'ok', message: '' };
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    const outcome = mapBiometryError(typeof code === 'string' ? code : undefined);
    if (outcome.result !== 'cancel') {
      recordError(`${outcome.message} (کد: ${code ?? 'نامشخص'})`);
    }
    return outcome;
  }
}

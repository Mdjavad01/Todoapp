/**
 * کارام — تست‌های فاز ۳ (قفل بیومتریک — ماشین حالت خالص + نگاشت‌های پل)
 *
 * اجرا:  cd frontend && bun test tests/applock.test.ts
 *
 * پوشش:
 *   ۱) شروع سرد — وب هرگز قفل نمی‌شود؛ کلید خاموش هرگز؛ کلید روشن + بیومتریک در دسترس = قفل
 *   ۲) fail-open — بیومتریک در دسترس نیست = هرگز کاربر حبس نمی‌شود (شروع سرد و باز شدن اضطراری)
 *   ۳) پس‌زمینه رفتن — قفل، idempotent، با کلید خاموش هیچ، با failOpen هیچ
 *   ۴) بازکردن — موفق (پاک‌سازی کامل)، لغو (قفل می‌ماند)، شکست (شمارنده تلاش)،
 *      دردسترس‌نبودن (باز شدن اضطراری + failOpen)
 *   ۵) چرخه‌ی کامل — قفل → لغو → موفق → پس‌زمینه → قفل دوباره → خاموش‌کردن = ریست
 *   ۶) مهاجرت pref — کلید نبودن = خاموش (کاربر قدیمیِ هرگز-لمس‌نکرده قفل ناگهانی نمی‌گیرد)
 *   ۷) نگاشت کدهای خطای پلاگین به نتیجه‌ی قطعی + نگاشت نتیجه‌ی خام checkBiometry
 */

import { describe, test, expect } from 'bun:test';
import {
  reduceLock,
  initialLockState,
  lockAtStart,
  lockOnBackground,
  lockEnabledFromPref,
  type LockState,
  type LockEnv,
} from '@/lib/appLock';
import { mapBiometryError, mapBiometryResult, biometryKindLabel, biometryReasonFa } from '@/lib/biometricBridge';

const envNativeOn = (available = true): LockEnv => ({ native: true, enabled: true, available });
const envWeb = (available = true): LockEnv => ({ native: false, enabled: true, available });
const envOff: LockEnv = { native: true, enabled: false, available: true };

/** قفل‌شده‌ی پایه برای سناریوهای بازکردن */
function lockedState(): LockState {
  return reduceLock(initialLockState, { type: 'cold-start' }, envNativeOn());
}

describe('فاز ۳ — شروع سرد', () => {
  test('وب هرگز قفل نمی‌شود — حتی با کلید روشن', () => {
    expect(lockAtStart(envWeb())).toBe(false);
    const s = reduceLock(initialLockState, { type: 'cold-start' }, envWeb());
    expect(s.locked).toBe(false);
    expect(s.failOpen).toBe(false);
  });

  test('کلید خاموش هرگز قفل نمی‌شود', () => {
    expect(lockAtStart(envOff)).toBe(false);
    const s = reduceLock(initialLockState, { type: 'cold-start' }, envOff);
    expect(s.locked).toBe(false);
  });

  test('کلید روشن + بیومتریک در دسترس = قفل، بدون پیام خطا', () => {
    expect(lockAtStart(envNativeOn())).toBe(true);
    const s = reduceLock(initialLockState, { type: 'cold-start' }, envNativeOn());
    expect(s.locked).toBe(true);
    expect(s.failOpen).toBe(false);
    expect(s.lastMessage).toBeNull();
    expect(s.attempts).toBe(0);
  });

  test('کلید روشن + بیومتریک در دسترس نیست = fail-open (هرگز حبس نشوید)', () => {
    const s = reduceLock(initialLockState, { type: 'cold-start' }, envNativeOn(false));
    expect(s.locked).toBe(false);
    expect(s.failOpen).toBe(true);
    expect(s.lastMessage).toContain('بیومتریک در دسترس نیست');
  });

  test('شروع سرد روی وضعیت قفل قبلی هم قطعی است (attempts صفر می‌شود)', () => {
    const dirty: LockState = { locked: false, failOpen: false, attempts: 5, lastMessage: 'شکست قبلی' };
    const s = reduceLock(dirty, { type: 'cold-start' }, envNativeOn());
    expect(s.locked).toBe(true);
    expect(s.attempts).toBe(0);
    expect(s.lastMessage).toBeNull();
  });
});

describe('فاز ۳ — پس‌زمینه رفتن', () => {
  test('با کلید روشن، پس‌زمینه = قفل', () => {
    const open: LockState = { ...initialLockState };
    expect(lockOnBackground(open, envNativeOn())).toBe(true);
    const s = reduceLock(open, { type: 'backgrounded' }, envNativeOn());
    expect(s.locked).toBe(true);
  });

  test('قفل‌شدنِ پس‌زمینه idempotent است (دوباره پس‌زمینه = بدون تغییر)', () => {
    const once = reduceLock(initialLockState, { type: 'backgrounded' }, envNativeOn());
    const twice = reduceLock(once, { type: 'backgrounded' }, envNativeOn());
    expect(twice).toEqual(once);
  });

  test('با کلید خاموش یا وب، پس‌زمینه قفل نمی‌زند', () => {
    expect(reduceLock(initialLockState, { type: 'backgrounded' }, envOff).locked).toBe(false);
    expect(reduceLock(initialLockState, { type: 'backgrounded' }, envWeb()).locked).toBe(false);
  });

  test('با failOpen این نشست، پس‌زمینه هم قفل نمی‌زند', () => {
    const failOpen: LockState = { ...initialLockState, failOpen: true };
    expect(lockOnBackground(failOpen, envNativeOn())).toBe(false);
    expect(reduceLock(failOpen, { type: 'backgrounded' }, envNativeOn()).locked).toBe(false);
  });
});

describe('فاز ۳ — بازکردن قفل', () => {
  test('موفق = باز، پاک‌سازی کامل پیام/شمارنده/failOpen', () => {
    const stuck: LockState = { locked: true, failOpen: false, attempts: 3, lastMessage: 'شکست' };
    const s = reduceLock(stuck, { type: 'unlock-result', result: 'ok' }, envNativeOn());
    expect(s.locked).toBe(false);
    expect(s.attempts).toBe(0);
    expect(s.lastMessage).toBeNull();
    expect(s.failOpen).toBe(false);
  });

  test('لغو کاربر = همچنان قفل + پیام راهنما', () => {
    const s = reduceLock(lockedState(), { type: 'unlock-result', result: 'cancel' }, envNativeOn());
    expect(s.locked).toBe(true);
    expect(s.lastMessage).toContain('لغو');
    expect(s.attempts).toBe(0);
  });

  test('شکست = شمارنده تلاش بالا می‌رود و پیام داده می‌شود', () => {
    let s = lockedState();
    s = reduceLock(s, { type: 'unlock-result', result: 'fail', message: 'اثر انگشت شناخته نشد — دوباره تلاش کنید' }, envNativeOn());
    expect(s.locked).toBe(true);
    expect(s.attempts).toBe(1);
    expect(s.lastMessage).toContain('اثر انگشت شناخته نشد');
    s = reduceLock(s, { type: 'unlock-result', result: 'fail' }, envNativeOn());
    expect(s.attempts).toBe(2);
    expect(s.lastMessage).toContain('احراز هویت ناموفق بود');
  });

  test('دردسترس‌نبودن وسط قفل = باز شدن اضطراری + failOpen (قفل این نشست برداشته می‌شود)', () => {
    const s = reduceLock(lockedState(), { type: 'unlock-result', result: 'unavailable' }, envNativeOn(false));
    expect(s.locked).toBe(false);
    expect(s.failOpen).toBe(true);
    expect(s.lastMessage).toContain('برداشته شد');
  });

  test('نتیجه‌ی بازکردن وقتی قفل نیست = بی‌اثر (بدون crash، بدون تغییر)', () => {
    const open = reduceLock(lockedState(), { type: 'unlock-result', result: 'ok' }, envNativeOn());
    const again = reduceLock(open, { type: 'unlock-result', result: 'fail' }, envNativeOn());
    expect(again).toEqual(open);
  });
});

describe('فاز ۳ — چرخه‌ی کامل و خاموش‌کردن', () => {
  test('قفل → لغو → موفق → پس‌زمینه → قفل دوباره', () => {
    let s = reduceLock(initialLockState, { type: 'cold-start' }, envNativeOn());
    expect(s.locked).toBe(true);
    s = reduceLock(s, { type: 'unlock-result', result: 'cancel' }, envNativeOn());
    expect(s.locked).toBe(true);
    s = reduceLock(s, { type: 'unlock-result', result: 'ok' }, envNativeOn());
    expect(s.locked).toBe(false);
    s = reduceLock(s, { type: 'backgrounded' }, envNativeOn());
    expect(s.locked).toBe(true);
  });

  test('خاموش‌کردن کلید = ریست کامل به وضعیت اولیه', () => {
    const s = reduceLock(lockedState(), { type: 'lock-disabled' }, envOff);
    expect(s).toEqual(initialLockState);
  });

  test('بعد از باز شدن اضطراری، خاموش و روشن‌کردن دوباره failOpen را پاک می‌کند', () => {
    let s = reduceLock(lockedState(), { type: 'unlock-result', result: 'unavailable' }, envNativeOn(false));
    expect(s.failOpen).toBe(true);
    s = reduceLock(s, { type: 'lock-disabled' }, envOff);
    expect(s.failOpen).toBe(false);
    // و روشن‌کردن دوباره (شبیه‌سازی شروع سرد بعدی) با بیومتریک در دسترس = قفل واقعی
    s = reduceLock(s, { type: 'cold-start' }, envNativeOn());
    expect(s.locked).toBe(true);
  });
});

describe('فاز ۳ — مهاجرت کلید pref', () => {
  test('کلید نبودن (کاربر هرگز لمس نکرده) = خاموش', () => {
    expect(lockEnabledFromPref(undefined)).toBe(false);
    expect(lockEnabledFromPref(null)).toBe(false);
  });

  test('کلید روشنِ آگاهانه = روشن می‌ماند', () => {
    expect(lockEnabledFromPref(true)).toBe(true);
  });

  test('کلید خاموش = خاموش', () => {
    expect(lockEnabledFromPref(false)).toBe(false);
    expect(lockEnabledFromPref('true')).toBe(false); // مقدار خراب = خاموش (قطعی)
    expect(lockEnabledFromPref(1)).toBe(false);
  });
});

describe('فاز ۳ — نگاشت کدهای خطای پلاگین (خالص)', () => {
  test('لغوهای کاربر/سیستم → cancel با پیام', () => {
    for (const code of ['userCancel', 'appCancel', 'systemCancel']) {
      const o = mapBiometryError(code);
      expect(o.result).toBe('cancel');
      expect(o.message).toContain('لغو');
    }
  });

  test('شکست احراز → fail', () => {
    expect(mapBiometryError('authenticationFailed').result).toBe('fail');
    expect(mapBiometryError('biometryLockout').result).toBe('fail');
    expect(mapBiometryError('biometryLockout').message).toContain('چند لحظه');
  });

  test('بیومتریک/رمز نبود → unavailable (باز شدن اضطراری)', () => {
    for (const code of ['biometryNotEnrolled', 'biometryNotAvailable', 'noDeviceCredential', 'passcodeNotSet']) {
      expect(mapBiometryError(code).result).toBe('unavailable');
    }
    expect(mapBiometryError(undefined).result).toBe('unavailable');
  });

  test('کد ناشناخته → fail (نه باز شدن، نه حبس بی‌پیام)', () => {
    const o = mapBiometryError('unknownFutureCode');
    expect(o.result).toBe('fail');
    expect(o.message.length).toBeGreaterThan(0);
  });
});

describe('فاز ۳ — نگاشت نتیجه‌ی خام checkBiometry (خالص)', () => {
  test('اثر انگشت ثبت‌شده و در دسترس', () => {
    const info = mapBiometryResult({
      isAvailable: true,
      deviceIsSecure: true,
      strongBiometryIsAvailable: true,
      biometryType: 3,
    });
    expect(info.available).toBe(true);
    expect(info.strong).toBe(true);
    expect(info.deviceSecure).toBe(true);
    expect(info.kind).toBe('fingerprint');
    expect(info.reason).toBe('');
  });

  test('سخت‌افزار هست ولی ثبت نشده → در دسترس نیست با علت فارسی', () => {
    const info = mapBiometryResult({
      isAvailable: false,
      deviceIsSecure: true,
      strongBiometryIsAvailable: false,
      biometryType: 3,
      code: 'biometryNotEnrolled',
    });
    expect(info.available).toBe(false);
    expect(info.kind).toBe('none');
    expect(info.reason).toContain('ثبت نشده');
  });

  test('دستگاه بدون رمز → علت «رمز ندارد»', () => {
    const info = mapBiometryResult({
      isAvailable: false,
      deviceIsSecure: false,
      strongBiometryIsAvailable: false,
      biometryType: 0,
      code: 'noDeviceCredential',
    });
    expect(info.reason).toContain('رمز');
    expect(info.deviceSecure).toBe(false);
  });

  test('نگاشت نوع بیومتریک کامل', () => {
    expect(biometryKindLabel(1)).toBe('touchid');
    expect(biometryKindLabel(2)).toBe('faceid');
    expect(biometryKindLabel(3)).toBe('fingerprint');
    expect(biometryKindLabel(4)).toBe('face');
    expect(biometryKindLabel(5)).toBe('iris');
    expect(biometryKindLabel(0)).toBe('none');
    expect(biometryKindLabel(99)).toBe('none');
  });

  test('برچسب علت برای کد ناشناخته خالی نمی‌ماند', () => {
    expect(biometryReasonFa('weirdCode')).toContain('در دسترس نیست');
    expect(biometryReasonFa('').length).toBeGreaterThan(0);
  });
});

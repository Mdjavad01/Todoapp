/**
 * کارام — تست‌های بسته‌ی ایمنی و اعتماد (v1.9)
 *
 * اجرا:  cd frontend && bun test tests/trust.test.ts
 *
 * پوشش (فقط منطق خالص سمت کلاینت — تست یکپارچگی سرور در tests/trust-test.php است):
 *   ۱) تصمیم «سینک کامل مجدد» کلاینت دیر آمده (shouldFullResync) — قرارداد با کرون نگه‌داری
 *   ۲) اعتبارسنجی متن تأیید حذف حساب (isConfirmTextValid) — همان قاعده‌ی سمت سرور
 *   ۳) صداقت پی‌وال (PRO_BENEFITS/PRO_SOON) — هیچ قابلیتِ ساخته‌نشده یا رایگان فروخته نمی‌شود
 *   ۴) بنر مهمان (shouldShowGuestBanner) — فقط مهمانِ واقعی و بسته‌نشده
 */

import { describe, test, expect } from 'bun:test';
import { shouldFullResync } from '@/sync/engine';
import { isConfirmTextValid, shouldShowGuestBanner, GUEST_NOTICE_PREF } from '@/lib/account';
import { PRO_BENEFITS, PRO_SOON } from '@/lib/proBenefits';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // ثابت — بدون وابستگی به ساعت واقعی

describe('سینک کامل مجدد کلاینت دیر آمده (v1.9 — قرارداد کرون نگه‌داری)', () => {
  test('بدون سینک قبلی (null/undefined/خالی) هرگز پاک‌سازی نمی‌کند', () => {
    expect(shouldFullResync(null, 180, NOW)).toBe(false);
    expect(shouldFullResync(undefined, 180, NOW)).toBe(false);
    expect(shouldFullResync('', 180, NOW)).toBe(false);
  });

  test('مقدار خراب (غیر تاریخ) محتاطانه = بدون پاک‌سازی', () => {
    expect(shouldFullResync('not-a-date', 180, NOW)).toBe(false);
  });

  test('سینک تازه (۱ روز) → هرگز', () => {
    expect(shouldFullResync(new Date(NOW - 1 * DAY).toISOString(), 180, NOW)).toBe(false);
  });

  test('دقیقاً روی آستانه (۱۸۰ روز با ۱۸۰) → هنوز نه (فقط «بیشتر» پاک می‌کند)', () => {
    expect(shouldFullResync(new Date(NOW - 180 * DAY).toISOString(), 180, NOW)).toBe(false);
  });

  test('بیشتر از آستانه (۱۹۱ روز با ۱۸۰) → سینک کامل مجدد', () => {
    expect(shouldFullResync(new Date(NOW - 191 * DAY).toISOString(), 180, NOW)).toBe(true);
  });

  test('کفِ ۹۰ روز حتی با آستانه‌ی کوچک‌تر حفظ می‌شود (هم‌قرارداد با سرور)', () => {
    // کلاینتِ ۸۹ روز آفلاین با آستانه‌ی (نادرستِ) ۳۰ روزِ سرور → کف ۹۰ محافظت می‌کند
    expect(shouldFullResync(new Date(NOW - 89 * DAY).toISOString(), 30, NOW)).toBe(false);
    // ۹۱ روز با آستانه‌ی ۳۰ → با کف ۹۰ می‌پاکد
    expect(shouldFullResync(new Date(NOW - 91 * DAY).toISOString(), 30, NOW)).toBe(true);
    // ۹۱ روز با آستانه‌ی ۹۰ → می‌پاکد
    expect(shouldFullResync(new Date(NOW - 91 * DAY).toISOString(), 90, NOW)).toBe(true);
  });
});

describe('تأیید دومرحله‌ای حذف حساب (v1.9)', () => {
  test('متن دقیق «حذف حساب» معتبر است', () => {
    expect(isConfirmTextValid('حذف حساب')).toBe(true);
  });

  test('فاصله‌ی اضافی و «ي» عربی پذیرفته می‌شود (یکسان‌سازی)', () => {
    expect(isConfirmTextValid(' حذف حساب ')).toBe(true);
    expect(isConfirmTextValid('حذف حساب', 'حذف حساب')).toBe(true);
    expect(isConfirmTextValid('حذف حساب'.replace('ی', 'ي'))).toBe(true);
  });

  test('متن ناقص/غلط/خالی رد می‌شود', () => {
    expect(isConfirmTextValid('حذف')).toBe(false);
    expect(isConfirmTextValid('حذف کارها')).toBe(false);
    expect(isConfirmTextValid('delete account')).toBe(false);
    expect(isConfirmTextValid('')).toBe(false);
    expect(isConfirmTextValid('   ')).toBe(false);
  });
});

describe('صداقت پی‌وال (v1.9) — فقط قفل‌های واقعی، بقیه «به‌زودی» بدون قیمت', () => {
  const FORBIDDEN_SOLD = ['وویس', 'بک‌آپ خودکار', 'تم لوکس', 'لوکس', 'قفل امنیتی', 'سینک ابری', 'ویجت', 'PDF'];

  test('هیچ قابلیت ساخته‌نشده یا رایگانی در فهرست مزایای پرو فروخته نمی‌شود', () => {
    for (const benefit of PRO_BENEFITS) {
      for (const bad of FORBIDDEN_SOLD) {
        expect(benefit.includes(bad)).toBe(false);
      }
    }
    expect(PRO_BENEFITS.length).toBeGreaterThan(0);
  });

  test('قابلیت‌های در مسیر ساخت فقط در فهرست «به‌زودی» و بدون قیمت‌اند', () => {
    expect(PRO_SOON.length).toBeGreaterThan(0);
    for (const f of PRO_SOON) {
      for (const sold of PRO_BENEFITS) {
        expect(sold.includes(f)).toBe(false); // یک قابلیت هم‌زمان «فعال» و «به‌زودی» نیست
      }
      // هیچ قیمتی (عدد تومانی) کنار قابلیت به‌زودی نیست
      expect(/\d{3,}/.test(f)).toBe(false);
    }
  });

  test('مزایای واقعی فقط قفل‌های واقعی کد هستند (بسته‌های شغلی + تحلیل عمقی)', () => {
    expect(PRO_BENEFITS.some((b) => b.includes('بسته‌های شغلی'))).toBe(true);
    expect(PRO_BENEFITS.some((b) => b.includes('تحلیل عمقی'))).toBe(true);
  });
});

describe('بنر هشدار داده‌ی مهمان (v1.9)', () => {
  const session = { userUuid: 'u-1' };

  test('مهمان بدون بستن → نمایش', () => {
    expect(shouldShowGuestBanner(null, false)).toBe(true);
  });

  test('مهمانی که بسته → هرگز', () => {
    expect(shouldShowGuestBanner(null, true)).toBe(false);
  });

  test('حساب‌دار (هر وضعیت) → هرگز', () => {
    expect(shouldShowGuestBanner(session, false)).toBe(false);
    expect(shouldShowGuestBanner(session, true)).toBe(false);
  });

  test('کلید pref بنر ثابت است (مهاجرت/پاک‌سازی به آن وابسته است)', () => {
    expect(GUEST_NOTICE_PREF).toBe('guest-data-notice-dismissed');
  });
});

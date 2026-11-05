/**
 * کارام — تست واحد «صفحه‌ی واحد قالب‌ها + قفل تریدر» (بسته C)
 *
 * پوشش:
 *   ۱) traderLockedFor — جدول درستی قفل کلاینت تریدر (ثابت واحد TRADER_REQUIRES_PRO):
 *      بیلد پرداخت‌دار + غیرپرو + غیرفعال = قفل؛ فعالِ قبلی/پرو/بیلد بازار = همیشه آزاد
 *   ۲) TRADER_REQUIRES_PRO — ثابت واحد از sync/payments.ts، هم‌ارز دقیق PAYMENTS_BUILD === 'on'
 *   ۳) کاتالوگ بخش رایگان: ۴ قالب با کلید tpl-* و نام لیست محفوظ
 *   ۴) کاتالوگ بخش پرو: ۳ بسته‌ی شغلی + تمپلیت تریدر ۵ لیستی با کلید trader.*
 *   ۵) گارد داده: نام‌های لیست‌های قالبی در RESERVED_TEMPLATE_LIST_NAMES (یکتایی جهانی)
 *
 * اجرا:  cd frontend && bun test tests/templates-page.test.ts
 */

import { describe, test, expect } from 'bun:test';

import { traderLockedFor } from '../src/db/traderTemplate';
import { TRADER_REQUIRES_PRO, PAYMENTS_BUILD } from '../src/sync/payments';
import { TEMPLATES } from '../src/db/catalog';
import { JOB_PACKS, RESERVED_TEMPLATE_LIST_NAMES } from '../src/db/jobPacks';
import { TRADER_TEMPLATE, TRADER_LIST_KEYS } from '../src/db/traderTemplate';

/* ---------- ۱) جدول درستی قفل تریدر ---------- */

describe('traderLockedFor — قفل کلاینت تریدر (بسته C)', () => {
  test('بیلد پرداخت‌دار + غیرپرو + غیرفعال → قفل (پیش‌نمایش فقط‌خواندنی)', () => {
    expect(traderLockedFor(true, false, false)).toBe(true);
  });

  test('فعالِ قبلی در بیلد پرداخت‌دار و غیرپرو → هرگز قفل نیست (حفظ کاربران فعال قبلی)', () => {
    expect(traderLockedFor(true, false, true)).toBe(false);
  });

  test('کاربر پرو غیرفعال → قفل نیست', () => {
    expect(traderLockedFor(true, true, false)).toBe(false);
  });

  test('بیلد بازار (پرداخت خاموش) → برای همه آزاد است حتی غیرپروِ غیرفعال', () => {
    expect(traderLockedFor(false, false, false)).toBe(false);
    expect(traderLockedFor(false, true, true)).toBe(false);
  });

  test('ثابت واحد TRADER_REQUIRES_PRO دقیقاً هم‌ارز PAYMENTS_BUILD === on است', () => {
    expect(typeof TRADER_REQUIRES_PRO).toBe('boolean');
    expect(TRADER_REQUIRES_PRO).toBe(PAYMENTS_BUILD === 'on');
  });
});

/* ---------- ۲) کاتالوگ بخش رایگان ---------- */

describe('بخش رایگان صفحه‌ی قالب‌ها (بسته C)', () => {
  test('دقیقاً ۴ قالب رایگان: سوپرمارکت، کنکور، سفر، خانه‌تکانی', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['tpl-market', 'tpl-konkur', 'tpl-travel', 'tpl-khanetakani']);
  });

  test('هر قالب رایگان کلید پایدار «<id>.0» دارد — id خودش با tpl- شروع می‌شود (ایدمپوتنس فعال‌سازی)', () => {
    for (const t of TEMPLATES) {
      expect(t.id.startsWith('tpl-')).toBe(true);
      expect(t.templateKey).toBe(`${t.id}.0`);
    }
  });

  test('نام لیست همه‌ی قالب‌های رایگان در RESERVED_TEMPLATE_LIST_NAMES محفوظ است', () => {
    for (const t of TEMPLATES) {
      expect(RESERVED_TEMPLATE_LIST_NAMES).toContain(t.listName);
    }
  });
});

/* ---------- ۳) کاتالوگ بخش پرو ---------- */

describe('بخش پرو صفحه‌ی قالب‌ها (بسته C)', () => {
  test('دقیقاً ۳ بسته‌ی شغلی + تمپلیت تریدر ۵ لیستی', () => {
    expect(JOB_PACKS.map((p) => p.id)).toEqual(['kit-freelance', 'kit-store', 'kit-student']);
    expect(TRADER_TEMPLATE.length).toBe(5);
  });

  test('کلیدهای تریدر trader.0 تا trader.4 (سینک‌پذیر — پایه‌ی تشخیص «فعالِ قبلی»)', () => {
    expect(TRADER_LIST_KEYS).toEqual(['trader.0', 'trader.1', 'trader.2', 'trader.3', 'trader.4']);
  });

  test('نام‌های ۵ لیست تریدر هم در RESERVED_TEMPLATE_LIST_NAMES محفوظ‌اند', () => {
    for (const def of TRADER_TEMPLATE) {
      expect(RESERVED_TEMPLATE_LIST_NAMES).toContain(def.name);
    }
  });

  test('هر بسته‌ی شغلی cta دارد (متن دکمه‌ی فعال‌سازی پرو)', () => {
    for (const p of JOB_PACKS) {
      expect(typeof p.cta).toBe('string');
      expect(p.cta.length).toBeGreaterThan(0);
    }
  });
});

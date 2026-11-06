/**
 * کارام — موج ۲ (چندروش ورود) — تست منطق کارت «روش‌های ورود» و قرارداد UI
 *
 * اجرا:  cd frontend && bun test tests/multi-login-methods.test.ts
 *
 * پوشش:
 *   ۱) منطق خالص loginMethods: سه وضعیت حساب (تک‌روش ایمیل / تک‌روش تلگرام / دوروش)
 *      + مهمان/خالی + نادیده‌گرفتن موبایل + fallback ماسک محلی + هرگز value خام در خروجی نیست
 *   ۲) snooze نشان: بدون pref → بیدار؛ آینده → خواب؛ گذشته/نامعتبر → بیدار؛ مقدار = الان + ۳۰ روز
 *   ۳) قرارداد UI در AccountSheet: کارت فقط داخل شاخه‌ی کاربر واردشده (مهمان رندر نمی‌شود)،
 *      snooze با pref محلی methods-snooze-v1 سیم شده، متن‌ها از خزانه‌ی بازار می‌آیند (بدون هاردکد)،
 *      خطای ۴۰۹ مستقیم نمایش داده می‌شود، و هیچ unlink (حذف روشی) وجود ندارد
 *   ۴) قرارداد auth.ts: مسیرهای جدید و کد خطای ۴۰۹
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  METHODS_SNOOZE_KEY,
  METHODS_SNOOZE_DAYS,
  localMaskIdentity,
  methodRowsOf,
  snoozeIsActive,
  snoozeValueFor,
  type MeIdentityRow,
} from '@/lib/loginMethods';

const id = (type: string, value: string, masked?: string): MeIdentityRow => ({
  type,
  value,
  verifiedAt: '2026-01-01T00:00:00Z',
  ...(masked !== undefined ? { masked } : {}),
});

/* ================= ۱) منطق وضعیت‌ها ================= */

describe('موج ۲ — منطق کارت روش‌های ورود (loginMethods)', () => {
  test('بدون identities (مهمان/خطای شبکه) → هر دو سطر «متصل نیست» و بدون ماسک', () => {
    for (const empty of [null, undefined, []]) {
      const rows = methodRowsOf(empty as MeIdentityRow[] | null | undefined);
      expect(rows).toHaveLength(2);
      expect(rows[0].channel).toBe('email');
      expect(rows[1].channel).toBe('telegram');
      expect(rows[0].linked).toBe(false);
      expect(rows[1].linked).toBe(false);
      expect(rows[0].masked).toBeNull();
      expect(rows[1].masked).toBeNull();
    }
  });

  test('حالت ۱ — تک‌روش ایمیل: ایمیل متصل با ماسک سرور، تلگرام متصل نیست', () => {
    const rows = methodRowsOf([id('email', 'wave2c@test.ir', 'wa…@test.ir')]);
    expect(rows[0].linked).toBe(true);
    expect(rows[0].masked).toBe('wa…@test.ir');
    expect(rows[1].linked).toBe(false);
    expect(rows[1].masked).toBeNull();
  });

  test('حالت ۲ — تک‌روش تلگرام: telegram_chat_id → تلگرام متصل، ایمیل متصل نیست', () => {
    const rows = methodRowsOf([id('telegram_chat_id', '999002', '••••9002')]);
    expect(rows[0].linked).toBe(false);
    expect(rows[1].linked).toBe(true);
    expect(rows[1].masked).toBe('••••9002');
  });

  test('حالت ۳ — دوروش: هر دو متصل (فقط وضعیت، بدون دکمه در UI)', () => {
    const rows = methodRowsOf([id('email', 'a@b.ir', 'a…@b.ir'), id('telegram_chat_id', '999002')]);
    expect(rows[0].linked).toBe(true);
    expect(rows[1].linked).toBe(true);
  });

  test('هویت موبایل نادیده گرفته می‌شود (خارج از موج ۲)', () => {
    const rows = methodRowsOf([id('mobile', '09123456789')]);
    expect(rows[0].linked).toBe(false);
    expect(rows[1].linked).toBe(false);
  });

  test('سرورهای قدیمی بدون masked → ماسک محلی (fallback)', () => {
    const rows = methodRowsOf([id('email', 'ab@gmail.com')]);
    expect(rows[0].linked).toBe(true);
    expect(rows[0].masked).toBe(localMaskIdentity('ab@gmail.com'));
  });

  test('هرگز مقدار خام (value) در خروجی نیست — فقط ماسک', () => {
    const rows = methodRowsOf([id('email', 'secret-private@test.ir', 'se…@test.ir'), id('telegram_chat_id', '123456789')]);
    const flat = JSON.stringify(rows);
    expect(flat.includes('secret-private@test.ir')).toBe(false);
    expect(flat.includes('123456789')).toBe(false);
  });

  test('localMaskIdentity هم‌الگوی سرور: ایمیل و عدد', () => {
    // الگوی سرور: min(2, at-1) نویسه‌ی اول ایمیل — برای ایمیل کوتاه یک نویسه می‌ماند (سرور هم همین را می‌دهد)
    expect(localMaskIdentity('ab@gmail.com')).toBe('a…@gmail.com');
    expect(localMaskIdentity('wave2c@test.ir')).toBe('wa…@test.ir');
    expect(localMaskIdentity('999002')).toBe('••••9002');
  });
});

/* ================= ۲) snooze نشان ================= */

describe('موج ۲ — snooze نشان اتصال روش دوم (pref محلی)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  test('کلید pref و مدت قراردادی: methods-snooze-v1 و ۳۰ روز', () => {
    expect(METHODS_SNOOZE_KEY).toBe('methods-snooze-v1');
    expect(METHODS_SNOOZE_DAYS).toBe(30);
  });

  test('بدون pref (null/undefined/خالی) → نشان بیدار است', () => {
    expect(snoozeIsActive(null, now)).toBe(false);
    expect(snoozeIsActive(undefined, now)).toBe(false);
    expect(snoozeIsActive('', now)).toBe(false);
  });

  test('pref آینده → نشان خواب است؛ pref گذشته → بیدار', () => {
    expect(snoozeIsActive(String(now + DAY), now)).toBe(true);
    expect(snoozeIsActive(String(now - 1), now)).toBe(false);
  });

  test('pref نامعتبر (رشته‌ی غیرعددی/منفی/صفر) → بیدار (fail-open)', () => {
    expect(snoozeIsActive('not-a-number', now)).toBe(false);
    expect(snoozeIsActive('-5', now)).toBe(false);
    expect(snoozeIsActive('0', now)).toBe(false);
  });

  test('snoozeValueFor = دقیقاً الان + ۳۰ روز', () => {
    expect(Number(snoozeValueFor(now))).toBe(now + 30 * DAY);
  });
});

/* ================= ۳) قرارداد UI در AccountSheet ================= */

describe('موج ۲ — سیم‌کشی UI در AccountSheet (قرارداد فایل)', () => {
  const code = readFileSync(join(import.meta.dir, '..', 'src', 'modals', 'AccountSheet.tsx'), 'utf8');

  test('کارت «روش‌های ورود» داخل شاخه‌ی کاربر واردشده است — مهمان رندر نمی‌شود', () => {
    const posSession = code.indexOf('{session ? (');
    // انکر را بعد از posSession می‌جوییم — تا با کامنت import در بالای فایل تطبیق نکند
    const posCard = code.indexOf('موج ۲ — کارت «روش‌های ورود»', posSession);
    const posGuest = code.indexOf('حالت مهمان');
    expect(posSession).toBeGreaterThan(-1);
    expect(posCard).toBeGreaterThan(posSession);
    expect(posGuest).toBeGreaterThan(posCard);
  });

  test('snooze با pref محلی METHODS_SNOOZE_KEY سیم شده (بدون هیچ تماس سروری)', () => {
    expect(code).toContain('METHODS_SNOOZE_KEY');
    expect(code).toContain('snoozeIsActive(methodsSnooze)');
    expect(code).toContain('await repo.prefsSet(METHODS_SNOOZE_KEY, v)');
  });

  test('متن‌های کارت از خزانه‌ی بازار می‌آیند — بدون هاردکد در UI', () => {
    expect(code).toContain('methodsCardTitle');
    expect(code).toContain('methodsConnectHint');
    expect(code).toContain('methodsConnectEmail');
    expect(code).toContain('methodsConnectTelegram');
    expect(code).toContain('methodsLaterLabel');
    expect(code.includes("'اتصال ایمیل'")).toBe(false);
    expect(code.includes("'اتصال تلگرام'")).toBe(false);
  });

  test('خطای ۴۰۹ conflict_identity مستقیم به کاربر نشان داده می‌شود', () => {
    expect(code).toContain('conflict_identity');
    expect(code).toContain('setLinkError(e instanceof Error ? e.message');
  });

  test('بدون unlink — هیچ حذف روشی در UI نیست (قرارداد موج ۲)', () => {
    expect(code.includes('حذف روش')).toBe(false);
    expect(code.includes('unlink')).toBe(false);
  });

  test('فقط ماسک در UI نمایش داده می‌شود (نه value خام هویت)', () => {
    expect(code).toContain('row.masked');
    expect(code.includes('row.value')).toBe(false);
  });
});

/* ================= ۴) قرارداد auth.ts ================= */

describe('موج ۲ — قرارداد سرویس در auth.ts', () => {
  const code = readFileSync(join(import.meta.dir, '..', 'src', 'sync', 'auth.ts'), 'utf8');

  test('مسیرهای جدید دقیقاً /v1/me/identities و /confirm هستند', () => {
    expect(code).toContain("'/v1/me/identities'");
    expect(code).toContain("'/v1/me/identities/confirm'");
  });

  test('قرارداد عدم افشا و ۴۰۹ بعد از تأیید کد مستند و پیاده شده', () => {
    expect(code).toContain('conflict_identity');
    expect(code).toContain('already');
  });

  test('MeIdentity کلیدهای قدیمی را دارد و masked افزودنی است', () => {
    expect(code).toContain('interface MeIdentity');
    expect(code).toContain('masked?: string');
  });
});

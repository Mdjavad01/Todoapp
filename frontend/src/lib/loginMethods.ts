/**
 * کارام — موج ۲ (چندروش ورود) — منطق خالص کارت «روش‌های ورود»
 *
 * این ماژول عمداً بدون React و بدون دسترسی به شبکه است تا تست‌پذیر خالص باشد
 * (tests/multi-login-methods.test.ts). بخش نمایشی در AccountSheet از همین‌جا تغذیه می‌شود.
 *
 * قرارداد سرویس: GET /api/v1/me → identities: [{type, value, verifiedAt, masked?}]
 *   - masked از موج ۲ سمت سرور ساخته می‌شود؛ کلاینت‌ها فقط masked را نمایش می‌دهند
 *     (value هرگز در UI نشان داده نمی‌شود).
 *   - فقط دو روش «ایمیل» و «تلگرام» در این کارت نقش دارند (موبایل/پیامک خارج از موج ۲).
 */

export interface MeIdentityRow {
  type: string;
  value: string;
  verifiedAt: string | null;
  /** فیلد ماسک‌شده‌ی نمایشی از سرور (موج ۲) — سرورهای قدیمی ندارند */
  masked?: string;
}

export type LoginChannel = 'email' | 'telegram';

export interface MethodRow {
  channel: LoginChannel;
  linked: boolean;
  /** نمایش ماسک‌شده برای روش متصل — از masked سرور؛ نبودش ماسک محلی */
  masked: string | null;
}

/** کلید pref محلی snooze نشان اتصال روش دوم (فقط داخل شیت حساب؛ بدون بنر تمام‌صفحه) */
export const METHODS_SNOOZE_KEY = 'methods-snooze-v1';

/** مدت خواب نشان بعد از زدن «بعداً» — ۳۰ روز (مستند قرارداد موج ۲) */
export const METHODS_SNOOZE_DAYS = 30;

/** ماسک محلی (fallback برای سرورهای قدیمی بدون masked) — هم‌الگوی سرور */
export function localMaskIdentity(value: string): string {
  if (value.includes('@')) {
    const at = value.indexOf('@');
    const name = value.slice(0, Math.max(1, Math.min(2, at - 1)));
    return `${name}…@${value.slice(at + 1)}`;
  }
  return `••••${value.slice(-4)}`;
}

/**
 * دو سطر وضعیت روش‌های ورود از identities سرور.
 * هرگز مقدار خام (value) را در خروجی نمی‌گذارد — فقط ماسک.
 */
export function methodRowsOf(identities: MeIdentityRow[] | null | undefined): MethodRow[] {
  const src = Array.isArray(identities) ? identities : [];
  const findMasked = (type: string): string | null => {
    const row = src.find((r) => r.type === type);
    if (!row) return null;
    return row.masked && row.masked.length > 0 ? row.masked : localMaskIdentity(row.value);
  };
  return [
    {
      channel: 'email',
      linked: src.some((r) => r.type === 'email'),
      masked: findMasked('email'),
    },
    {
      channel: 'telegram',
      linked: src.some((r) => r.type === 'telegram_chat_id'),
      masked: findMasked('telegram_chat_id'),
    },
  ];
}

/** ارزش pref پس از زدن «بعداً» = زمان الان + ۳۰ روز (epoch میلی‌ثانیه به‌صورت رشته) */
export function snoozeValueFor(now: number = Date.now()): string {
  return String(now + METHODS_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
}

/** آیا نشان اتصال روش دوم الان خوابیده است؟ (pref نامعتبر/منقضی = بیدار) */
export function snoozeIsActive(snoozeRaw: string | null | undefined, now: number = Date.now()): boolean {
  if (snoozeRaw === null || snoozeRaw === undefined) return false;
  const v = String(snoozeRaw).trim();
  if (v === '') return false;
  const until = Number(v);
  if (!Number.isFinite(until) || until <= 0) return false;
  return now < until;
}

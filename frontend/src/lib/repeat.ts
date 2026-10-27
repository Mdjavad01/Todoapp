/**
 * کارام — موتور تکرار (فاز ۳ — بازسازی جریان)
 *
 * قانون قطعی: «نوبت بعدی» تابع خالصِ (سررسید فعلی، نوع تکرار، تنظیم سفارشی، روز انجام) است —
 * هیچ حالت پنهانی ندارد؛ در هر دستگاه با همان ورودی همان خروجی را می‌دهد.
 *
 * تقویم: ماهانه/سالانه بر پایه‌ی تقویم شمسی (جلالی) است — الزام اصلاح شماره ۶ کاربر:
 *   - ماهانه: همان روزِ شمسی در ماه بعد؛ روز ۳۱ در ماه‌های ۳۰روزه و اسفند به «آخرین روز همان ماه» می‌چسبد (کلمپ)
 *   - سالانه: همان روزِ شمسی در سال بعد؛ «۳۰ اسفند» سال کبیسه در سال غیرکبیسه → «۲۹ اسفند»
 *
 * «روزهای کاری» = شنبه تا چهارشنبه (هفته‌ی کاری ایران) — پنج‌شنبه و جمعه پرش می‌شود.
 *
 * ساخت نوبت بعدی: هنگام تکمیل کارِ تکرارشونده، کارِ اصلی «انجام‌شده» می‌ماند (در آمار و
 * آکاردئون می‌ماند) و یک ردیف تازه با سررسید بعدی ساخته می‌شود — repo.completeRecurring.
 */

import { toIsoDate, parseIsoDate, startOfDay } from './format';
import { fromJalali, jalaliMonthLength, jalaliWeekday, toJalali } from './jalali';

export type RepeatKind = 'none' | 'daily' | 'workdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/**
 * تنظیم تکرار سفارشی:
 *   - unit='day'   → هر N روز
 *   - unit='week'  → هر N هفته؛ اگر days داده شود، فقط روزهای انتخابی هفته (۰=شنبه … ۶=جمعه)
 *   - unit='month' → هر N ماه (همان روز شمسی با کلمپ)
 *   - unit='year'  → هر N سال (همان تاریخ شمسی با کلمپ)
 */
export interface RepeatMeta {
  every: number;
  unit: RepeatUnit;
  days?: number[]; // فقط برای unit='week'
}

export const REPEAT_UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'روز' },
  { value: 'week', label: 'هفته' },
  { value: 'month', label: 'ماه' },
  { value: 'year', label: 'سال' },
];

/** برچسب روزهای هفته شمسی ۰=شنبه تا ۶=جمعه */
export const WEEKDAY_LETTERS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

const MAX_OCCURRENCE_YEARS = 50; // سقف احتیاطی حلقه‌ها (هرگز با ورودی معتبر برخورد نمی‌کند)

/* ---------------- اعتبارسنجی/نرمال‌سازی تنظیم سفارشی ---------------- */

/** ورودی خام (از سینک/فرم) → RepeatMeta سالم یا null — در هر دو سمت یکسان استفاده می‌شود */
export function normalizeRepeatMeta(raw: unknown): RepeatMeta | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const every = typeof obj.every === 'number' ? Math.floor(obj.every) : NaN;
  if (!Number.isFinite(every) || every < 1 || every > 365) return null;
  const unit = obj.unit;
  if (unit !== 'day' && unit !== 'week' && unit !== 'month' && unit !== 'year') return null;
  let days: number[] | undefined;
  if (unit === 'week' && Array.isArray(obj.days)) {
    const clean = [...new Set(obj.days.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (clean.length > 0 && clean.length <= 7) days = clean;
  }
  return days ? { every, unit, days } : { every, unit };
}

/** برچسب فارسی کامل برای نمایش — نوع پایه یا سفارشی با فاصله و روزهای هفته */
export function describeRepeat(repeat: RepeatKind, meta: RepeatMeta | null): string {
  switch (repeat) {
    case 'daily':
      return 'روزانه';
    case 'workdays':
      return 'روزهای کاری (شنبه تا چهارشنبه)';
    case 'weekly':
      return 'هفتگی';
    case 'monthly':
      return 'ماهانه (تقویم شمسی)';
    case 'yearly':
      return 'سالانه (تقویم شمسی)';
    case 'custom': {
      const m = meta ?? { every: 1, unit: 'day' as RepeatUnit };
      const unitLabel = REPEAT_UNITS.find((u) => u.value === m.unit)?.label ?? 'روز';
      let text = `هر ${toFaDigits(m.every)} ${unitLabel}`;
      if (m.unit === 'week' && m.days && m.days.length > 0) {
        text += ' در ' + m.days.map((d) => WEEKDAY_NAMES[d]).join('، ');
      }
      return text;
    }
    default:
      return 'بدون تکرار';
  }
}

function toFaDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/* ---------------- موتور نوبت بعدی ---------------- */

function addDays(base: Date, n: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function epochDay(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}

/** جلو بردن تاریخ شمسی N ماه با کلمپ روز به طول ماه مقصد */
function jalaliAddMonths(base: Date, n: number): Date {
  const j = toJalali(base);
  const total = j.jy * 12 + (j.jm - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(j.jd, jalaliMonthLength(ny, nm));
  return fromJalali(ny, nm, day);
}

/** جلو بردن تاریخ شمسی N سال با کلمپ (۳۰ اسفند کبیسه → ۲۹ اسفند سال غیرکبیسه) */
function jalaliAddYears(base: Date, n: number): Date {
  const j = toJalali(base);
  const ny = j.jy + n;
  const day = Math.min(j.jd, jalaliMonthLength(ny, j.jm));
  return fromJalali(ny, j.jm, day);
}

/** اولین روز کاری (شنبه تا چهارشنبه) بعد از تاریخ داده‌شده — صرفاً بعد، خودِ روز شمرده نمی‌شود */
function nextWorkday(base: Date): Date {
  let d = addDays(base, 1);
  for (let i = 0; i < 7; i++) {
    const wd = jalaliWeekday(d); // ۰=شنبه … ۴=چهارشنبه (کاری) | ۵=جمعه ۴=پنج‌شنبه
    if (wd <= 4) return d;
    d = addDays(d, 1);
  }
  return d; // غیرقابل‌رسیدن با ورودی درست
}

/** هر N هفته در روزهای انتخابی — هفته‌ی مبنا هفته‌ی سررسید فعلی است (قطعی و بدون حالت) */
function nextCustomWeek(base: Date, every: number, days: number[]): Date {
  const baseWeek = Math.floor(epochDay(base) / 7);
  for (let i = 1; i <= every * 7 + 7; i++) {
    const cand = addDays(base, i);
    if (!days.includes(jalaliWeekday(cand))) continue;
    const candWeek = Math.floor(epochDay(cand) / 7);
    if ((candWeek - baseWeek) % every === 0) return cand;
  }
  return addDays(base, every * 7);
}

/**
 * نوبت بعدی تکرار — تابع خالص و قطعی.
 * @param dueIso سررسید فعلی «YYYY-MM-DD» یا null (مبنا = روزِ انجام)
 * @param completedOn لحظه‌ی انجام کار (برای کارِ بی‌تاریخ)
 * @returns «YYYY-MM-DD» نوبت بعدی یا null (کارِ بدون تکرار)
 */
export function nextOccurrence(
  dueIso: string | null,
  repeat: RepeatKind,
  meta: RepeatMeta | null,
  completedOn: Date,
): string | null {
  if (repeat === 'none') return null;
  const base = dueIso ? startOfDay(parseIsoDate(dueIso)) : startOfDay(completedOn);

  switch (repeat) {
    case 'daily':
      return toIsoDate(addDays(base, 1));
    case 'workdays':
      return toIsoDate(nextWorkday(base));
    case 'weekly':
      return toIsoDate(addDays(base, 7));
    case 'monthly':
      return toIsoDate(jalaliAddMonths(base, 1));
    case 'yearly':
      return toIsoDate(jalaliAddYears(base, 1));
    case 'custom': {
      const m = meta ?? { every: 1, unit: 'day' as RepeatUnit };
      const every = Math.max(1, Math.min(365, Math.floor(m.every)));
      switch (m.unit) {
        case 'day':
          return toIsoDate(addDays(base, every));
        case 'week':
          return m.days && m.days.length > 0
            ? toIsoDate(nextCustomWeek(base, every, m.days))
            : toIsoDate(addDays(base, every * 7));
        case 'month':
          return toIsoDate(jalaliAddMonths(base, every));
        case 'year':
          return toIsoDate(jalaliAddYears(base, every));
      }
      return null;
    }
    default:
      return null;
  }
}

/* ---------------- روزهای من (فاز ۳) ---------------- */

/**
 * هرس «روزهای من» — قاعده‌ی قطعی (سبک Microsoft To Do):
 *   - کارِ موجود و ناتمام می‌ماند؛
 *   - کارِ انجام‌شده فقط در همان روزِ انجام نمایش داده می‌شود و فردا از فهرست می‌رود؛
 *   - کارِ حذف‌شده می‌رود.
 * کارهای «سررسیدشان امروز است» جدا از این فهرست در نما نشان داده می‌شوند (بدون ذخیره).
 */
export function pruneMyDay(ids: string[], tasks: { id: string; deletedAt: string | null; completedAt: string | null }[], today: Date): string[] {
  const todayIso = toIsoDate(today);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return ids.filter((id) => {
    const t = byId.get(id);
    if (!t || t.deletedAt) return false;
    if (t.completedAt && t.completedAt.slice(0, 10) !== todayIso) return false;
    return true;
  });
}

/** سقف احتیاطی — برای تست‌های آینده (زنجیره‌ی طولانی نوبت‌ها) */
export const REPEAT_MAX_CHAIN = MAX_OCCURRENCE_YEARS;

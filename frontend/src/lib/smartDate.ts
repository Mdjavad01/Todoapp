import { toFa, faShort, weekdayName, toIsoDate } from './format';
import { JALALI_MONTHS, fromJalali, toJalali } from './jalali';

/**
 * تشخیص هوشمند تاریخ/ساعت از متن طبیعی — کلاینت‌محور و آفلاین (v16)
 *
 * برخلاف نسخه‌ی قبل (فقط پیش‌نمایش متنی)، این نسخه «تاریخ واقعی» برمی‌گرداند
 * تا موقع ذخیره‌ی کار، روی همان تاریخ بنشیند. الگوهای پشتیبانی‌شده:
 *
 *   «۲ هفته بعد خرید رم لپ‌تاپ»   → امروز + ۱۴ روز (فقط تاریخ)
 *   «۷۲ ساعت بعد تماس با پشتیبانی» → اکنون + ۷۲ ساعت (تاریخ + ساعت دقیق)
 *   «۳ روز دیگر ورزش»            → امروز + ۳ روز
 *   «فردا ساعت ۱۷ خرید نان»       → فردا • ۱۷:۰۰
 *   «پس‌فردا قبض برق»             → امروز + ۲ روز
 *   «جمعه قرار ورزشی»             → نزدیک‌ترین جمعه
 *   «۲۵ مهر جلسه» / «۱۵ آبان ۱۴۰۴» → تاریخ شمسی (سال پیش‌فرض: امسال)
 *   «ماه بعد بررسی بودجه»          → یک ماه بعد
 *   «ساعت ۹:۳۰ جلسه»              → امروز • ۰۹:۳۰
 */

export interface SmartDateHit {
  /** برچسب نمایشی: «۲ هفته بعد — پنج‌شنبه ۲۱ آبان • ۱۷:۰۰» */
  label: string;
  /** تاریخ ISO «YYYY-MM-DD» برای ذخیره روی کار */
  dueDate: string;
  /** «HH:mm» لاتین برای ذخیره — وقتی از متن قابل محاسبه باشد */
  dueTime: string | null;
  /** عنوان کار بدون عبارت تاریخ/ساعت («خرید رم لپ‌تاپ») */
  cleanTitle: string;
}

const FA = '۰۱۲۳۴۵۶۷۸۹';

function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (c) => String(FA.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** جمع کردن N واحد تقویمی به امروز — دقیقه/ساعت لحظه‌ای، بقیه سرِ روز */
function addUnits(now: Date, n: number, unit: 'دقیقه' | 'ساعت' | 'روز' | 'هفته' | 'ماه'): Date {
  const d = new Date(now);
  switch (unit) {
    case 'دقیقه':
      d.setMinutes(d.getMinutes() + n);
      break;
    case 'ساعت':
      d.setHours(d.getHours() + n);
      break;
    case 'روز':
      d.setDate(d.getDate() + n);
      break;
    case 'هفته':
      d.setDate(d.getDate() + n * 7);
      break;
    case 'ماه':
      d.setMonth(d.getMonth() + n);
      break;
  }
  return d;
}

/** نزدیک‌ترین occurrence روز هفته (۰ = امروز اگر همین امروز باشد) */
function nextWeekday(now: Date, jsWeekday: number): Date {
  const d = new Date(now);
  const diff = (jsWeekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

const MONTH_INDEX: Record<string, number> = {};
JALALI_MONTHS.forEach((m, i) => {
  MONTH_INDEX[m] = i + 1;
});

const WEEKDAYS: Array<{ re: string; js: number; label: string }> = [
  { re: 'یکشنبه', js: 0, label: 'یکشنبه' },
  { re: 'دوشنبه', js: 1, label: 'دوشنبه' },
  { re: 'سه[‌\\s]?شنبه', js: 2, label: 'سه‌شنبه' },
  { re: 'چهارشنبه', js: 3, label: 'چهارشنبه' },
  { re: 'پنج[‌\\s]?شنبه', js: 4, label: 'پنج‌شنبه' },
  { re: 'جمعه|آدینه', js: 5, label: 'جمعه' },
  { re: 'شنبه', js: 6, label: 'شنبه' },
];

const DIGIT = '[۰-۹0-9٠-٩]';
const MONTH_ALT = 'فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند';

const RE_OFFSET = /(دقیقه|ساعت|روز|هفته|ماه)\s*(بعد|دیگه|دیگر|آینده)/;
const RE_OFFSET_N = new RegExp(`(${DIGIT}+)\\s*${RE_OFFSET.source}`);
const RE_OFFSET_BARE = new RegExp(`(?:هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`);
const RE_PASFARDA = /پس[‌\s]?فردا/;
const RE_FARDA = /فردا/;
const RE_EMROZ = /امروز/;
const RE_JALALI = new RegExp(`(${DIGIT}{1,2})\\s*(${MONTH_ALT})(?:\\s+(${DIGIT}{2,4}))?`);
const RE_WEEKDAY = new RegExp(WEEKDAYS.map((w) => w.re).join('|'));
const RE_TIME_HM = new RegExp(`(?:ساعت\\s*)?(${DIGIT}{1,2})\\s*[:：]\\s*(${DIGIT}{2})`);
const RE_TIME_H = new RegExp(`(?:ساعت\\s+)(${DIGIT}{1,2})(?!\\s*[:：])`);

/** حذف عبارت‌های تشخیص‌داده‌شده از عنوان اصلی (تحمل نیم‌فاصله و ارقام فارسی) */
function stripPhrases(text: string): string {
  const removals: RegExp[] = [
    new RegExp(`${DIGIT}+\\s*(?:دقیقه|ساعت|روز|هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`, 'g'),
    new RegExp(`(?:هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`, 'g'),
    RE_PASFARDA,
    RE_FARDA,
    RE_EMROZ,
    new RegExp(`${DIGIT}{1,2}\\s*(?:${MONTH_ALT})(?:\\s+${DIGIT}{2,4})?`, 'g'),
    new RegExp(WEEKDAYS.map((w) => w.re).join('|'), 'g'),
    new RegExp(`(?:ساعت\\s*)?${DIGIT}{1,2}\\s*[:：]\\s*${DIGIT}{2}`, 'g'),
    new RegExp(`ساعت\\s+${DIGIT}{1,2}`, 'g'),
  ];
  let out = text;
  for (const re of removals) {
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function detectSmartDate(text: string, now: Date): SmartDateHit | null {
  const norm = toLatinDigits(text).replace(/\u200c/g, ' ').trim();
  if (!norm) return null;

  let target: Date | null = null;
  let dueTime: string | null = null;
  let prefix = '';

  /* ---------- ۱) «N دقیقه/ساعت/روز/هفته/ماه بعد» ---------- */
  const offN = norm.match(RE_OFFSET_N);
  const offBare = !offN ? norm.match(RE_OFFSET_BARE) : null;
  if (offN) {
    const n = parseInt(offN[1], 10);
    const unit = offN[2] as 'دقیقه' | 'ساعت' | 'روز' | 'هفته' | 'ماه';
    if (n >= 1 && n <= 999) {
      target = addUnits(now, n, unit);
      prefix = `${toFa(String(n))} ${unit} بعد`;
      if (unit === 'دقیقه' || unit === 'ساعت') {
        dueTime = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
      }
    }
  } else if (offBare) {
    // «هفته بعد» → ۷ روز | «ماه بعد» → یک ماه
    target = addUnits(now, 1, offBare[0].includes('هفته') ? 'هفته' : 'ماه');
    prefix = offBare[0].includes('هفته') ? 'هفته بعد' : 'ماه بعد';
  }

  /* ---------- ۲) امروز / فردا / پس‌فردا ---------- */
  if (!target) {
    if (RE_PASFARDA.test(norm)) {
      target = addUnits(now, 2, 'روز');
      prefix = 'پس‌فردا';
    } else if (RE_FARDA.test(norm)) {
      target = addUnits(now, 1, 'روز');
      prefix = 'فردا';
    } else if (RE_EMROZ.test(norm)) {
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      prefix = 'امروز';
    }
  }

  /* ---------- ۳) تاریخ شمسی «۲۵ مهر» / «۱۵ آبان ۱۴۰۴» ---------- */
  if (!target) {
    const jm = norm.match(RE_JALALI);
    if (jm) {
      const jd = parseInt(jm[1], 10);
      const jmIdx = MONTH_INDEX[jm[2]] ?? 0;
      if (jd >= 1 && jd <= 31 && jmIdx >= 1) {
        const todayJ = toJalali(now);
        let jy = todayJ.jy;
        if (jm[3]) {
          const raw = parseInt(jm[3], 10);
          jy = raw < 100 ? 1400 + raw : raw;
        } else {
          // بدون سال — اگر تاریخ نسبت به امسال گذشته باشد، سال بعد
          let probe = fromJalali(todayJ.jy, jmIdx, jd);
          if (probe.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
            jy += 1;
          }
        }
        target = fromJalali(jy, jmIdx, jd);
        prefix = `${toFa(String(jd))} ${jm[2]}${jm[3] ? ' ' + toFa(String(jy)) : ''}`;
      }
    }
  }

  /* ---------- ۴) روز هفته «جمعه» ---------- */
  if (!target) {
    const wm = norm.match(RE_WEEKDAY);
    if (wm) {
      const w = WEEKDAYS.find((x) => new RegExp(`^(?:${x.re})$`).test(wm[0]));
      if (w) {
        target = nextWeekday(now, w.js);
        prefix = w.label;
      }
    }
  }

  /* ---------- ۵) ساعت — همیشه جدا از تاریخ تشخیص داده می‌شود ---------- */
  const tm = norm.match(RE_TIME_HM);
  if (tm) {
    const h = parseInt(tm[1], 10);
    const m = parseInt(tm[2], 10);
    if (h <= 23 && m <= 59) {
      dueTime = `${pad2(h)}:${pad2(m)}`;
    }
  } else {
    const th = norm.match(RE_TIME_H);
    if (th) {
      const h = parseInt(th[1], 10);
      if (h <= 23) {
        dueTime = `${pad2(h)}:00`;
      }
    }
  }

  if (!target && !dueTime) return null;

  /* ---------- ساخت خروجی ---------- */
  if (!target) target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const when = `${weekdayName(target)} ${faShort(target)}`;
  const label = `${prefix ? prefix + ' — ' : ''}${when}${dueTime ? ' • ' + toFa(dueTime) : ''}`;
  const cleanTitle = stripPhrases(text) || text.trim();

  return { label, dueDate: toIsoDate(target), dueTime, cleanTitle };
}

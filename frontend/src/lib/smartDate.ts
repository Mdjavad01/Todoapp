import { toFa, faShort, weekdayName, toIsoDate } from './format';
import { JALALI_MONTHS, fromJalali, toJalali } from './jalali';

/**
 * تشخیص هوشمند تاریخ/ساعت از متن طبیعی — کلاینت‌محور و آفلاین (v17)
 *
 * برخلاف نسخه‌ی قبل (فقط پیش‌نمایش متنی)، این نسخه «تاریخ واقعی» برمی‌گرداند
 * تا موقع ذخیره‌ی کار، روی همان تاریخ بنشیند. الگوهای پشتیبانی‌شده:
 *
 *   «۲ هفته بعد خرید رم لپ‌تاپ»   → امروز + ۱۴ روز (فقط تاریخ)
 *   «۷۲ ساعت بعد تماس با پشتیبانی» → اکنون + ۷۲ ساعت (تاریخ + ساعت دقیق)
 *   «۳ روز دیگر ورزش»            → امروز + ۳ روز
 *   «فردا ساعت ۱۷ خرید نان»       → فردا • ۱۷:۰۰
 *   «فردا ساعت ۱۰ شب گزارش»       → فردا • ۲۲:۰۰   (v17 — بخش روز)
 *   «ده شب تماس با علی»           → امروز • ۲۲:۰۰   (v17 — عدد حروفی بدون «ساعت»)
 *   «ساعت یازده و نیم جلسه»       → امروز • ۱۱:۳۰   (v17 — و نیم/و ربع)
 *   «امشب ساعت ۹:۳۰ فیلم»         → امروز • ۲۱:۳۰   (v17 — امشب)
 *   «پس‌فردا قبض برق»             → امروز + ۲ روز
 *   «جمعه قرار ورزشی»             → نزدیک‌ترین جمعه
 *   «۲۵ مهر جلسه» / «۱۵ آبان ۱۴۰۴» → تاریخ شمسی (سال پیش‌فرض: امسال)
 *   «ماه بعد بررسی بودجه»          → یک ماه بعد
 *   «ساعت ۹:۳۰ جلسه»              → امروز • ۰۹:۳۰
 *
 * v17 — اعداد حروفی و بخش روز:
 *   - اعداد حروفی ۱ تا ۱۲ (یک/یه/دو/…/دوازده + شیش) معادل رقم تفسیر می‌شوند —
 *     فقط توکنِ مستقل (نه داخل کلمه) و با گارد «سه/چهار/پنج + شنبه» تا روزهای
 *     هفته نشکنند. تیتر اصلی همیشه از متن خام پاک می‌شود، نه از نسخه‌ی تبدیل‌شده.
 *   - بخش روز: صبح/بامداد = همان ساعت | ظهر = همان ساعت | بعدازظهر/عصر = +۱۲ اگر < ۱۲
 *     | شب = ۱۲→۰۰:۰۰ و ۱..۴→بامدادِ همان روز و ۵..۱۱→+۱۲.
 *   - «و نیم» = :۳۰ و «و ربع» = :۱۵ («ساعت ده و نیم شب» → ۲۲:۳۰ و «۷ و نیم شب» → ۱۹:۳۰ — v1.13.2: گروه عدد در شاخه‌ی بدون «ساعت» جا افتاده بود و فرم بدون «ساعت» هرگز ساعت نمی‌ساخت).
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

/* ---------------- v17 — اعداد حروفی ---------------- */

/** عدد حروفی → رقم (ترتیب بلند→کوتاه تا «دوازده» قبل از «دو» برداشته شود) */
const WORD_NUMBERS: Array<[string, number]> = [
  ['دوازده', 12],
  ['یازده', 11],
  ['ده', 10],
  ['نه', 9],
  ['هشت', 8],
  ['هفت', 7],
  ['شیش', 6],
  ['شش', 6],
  ['پنج', 5],
  ['چهار', 4],
  ['سه', 3],
  ['دو', 2],
  ['یک', 1],
  ['یه', 1],
];

/** تبدیل توکن‌های مستقل عدد حروفی به رقم — با گارد روزهای هفته (سه/چهار/پنج + شنبه) */
function wordsToDigits(text: string): string {
  let out = text;
  for (const [word, n] of WORD_NUMBERS) {
    // حرف قبل/بعد باید مرز باشد (فاصله، سنجاق، علائم) — ZWNJ هم مرز نیست تا «سه‌شنبه» و «دو‌شنبه» نشکنند
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}_\u200c])${word}(?!\\s*شنبه)(?![\\p{L}\\p{N}_\u200c])`,
      'gu',
    );
    out = out.replace(re, (_m, pre: string) => `${pre}${n}`);
  }
  return out;
}

/* ---------------- v17 — بخش روز ---------------- */

/** بخش روزِ توکن مستقل — با جداسازی علائم سجاوندی چسبیده («شب،» هم پیدا می‌شود) */
function findDayPart(text: string): string | null {
  const tokens = text.split(/[^\p{L}\p{N}]+/u);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'بعد' && tokens[i + 1] === 'از' && tokens[i + 2] === 'ظهر') return 'pm';
    if (t === 'بعدازظهر' || t === 'عصر') return 'pm';
    if (t === 'شب' || t === 'امشب') return 'night';
    if (t === 'صبح' || t === 'بامداد') return 'am';
    if (t === 'ظهر') return 'noon';
  }
  return null;
}

/** اعمال بخش روز روی ساعت ۱..۱۲ — خروجی ۰..۲۳ (ساعت ۲۴ ساعتیِ صریح مثل «۲۲» دست نمی‌خورد) */
function applyDayPart(h: number, part: string | null): number {
  if (!part || h > 12) return h;
  switch (part) {
    case 'pm': // بعدازظهر / عصر
      return h < 12 ? h + 12 : h;
    case 'night': // شب: ۱۲ شب = نیمه‌شب، ۱..۴ شب = بامداد، ۵..۱۱ شب = عصر/شبِ واقعی
      if (h === 12) return 0;
      if (h >= 5) return h + 12;
      return h;
    default: // am / noon — همان ساعت
      return h;
  }
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

/** v17 — ساعت حروفی برای پاک‌سازی تیتر (متن خام عدد حروفی دارد، نه رقم) */
const WORD_H_ALT = 'یک|یه|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده';
const DP_ALT = 'بعدازظهر|بعد از ظهر|عصر|بامداد|صبح|شب|ظهر';

const RE_OFFSET = /(دقیقه|ساعت|روز|هفته|ماه)\s*(بعد|دیگه|دیگر|آینده)/;
const RE_OFFSET_N = new RegExp(`(${DIGIT}+)\\s*${RE_OFFSET.source}`);
const RE_OFFSET_BARE = new RegExp(`(?:هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`);
const RE_PASFARDA = /پس[‌\s]?فردا/;
const RE_FARDA = /فردا/;
const RE_EMROZ = /امروز/;
const RE_TONIGHT = /امشب/;
const RE_JALALI = new RegExp(`(${DIGIT}{1,2})\\s*(${MONTH_ALT})(?:\\s+(${DIGIT}{2,4}))?`);
const RE_WEEKDAY = new RegExp(WEEKDAYS.map((w) => w.re).join('|'));
/* v17 — ترتیب اولویت: دقیقه‌دار ← و نیم/و ربع (با «ساعت» یا بخش‌روز تا «۲ و نیم کیلو» ساعت نشود) ← ساعت+عدد ← عدد+بخش‌روز (بدون «ساعت») */
const RE_TIME_HM = new RegExp(`(?:ساعت\\s*)?(${DIGIT}{1,2})\\s*[:：]\\s*(${DIGIT}{2})`);
const RE_TIME_HALF = new RegExp(`(?:(?:ساعت\\s+)(${DIGIT}{1,2})\\s*و\\s*(نیم|ربع)|(${DIGIT}{1,2})\\s*و\\s*(نیم|ربع)\\s*(?:${DP_ALT}))`);
const RE_TIME_H = new RegExp(`(?:ساعت\\s+)(${DIGIT}{1,2})(?!\\s*[:：])(?!\\s*و\\s*(?:نیم|ربع))`);
const RE_TIME_BARE_DP = new RegExp(`(${DIGIT}{1,2})\\s+(?:${DP_ALT})(?!\\s*[:：])`);

/** حذف عبارت‌های تشخیص‌داده‌شده از عنوان اصلی (تحمل نیم‌فاصله و ارقام فارسی) */
function stripPhrases(text: string, timeHit: boolean): string {
  const removals: RegExp[] = [
    // v17 — عدد حروفی هم در الگوی «N واحد بعد» پاک می‌شود («یه ساعت دیگه» → تیتر تمیز)
    new RegExp(`(?:${DIGIT}{1,2}|${WORD_H_ALT})\\s*(?:دقیقه|ساعت|روز|هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`, 'g'),
    new RegExp(`(?:هفته|ماه)\\s*(?:بعد|دیگه|دیگر|آینده)`, 'g'),
    RE_PASFARDA,
    RE_FARDA,
    RE_EMROZ,
    RE_TONIGHT,
    new RegExp(`${DIGIT}{1,2}\\s*(?:${MONTH_ALT})(?:\\s+${DIGIT}{2,4})?`, 'g'),
    new RegExp(WEEKDAYS.map((w) => w.re).join('|'), 'g'),
  ];
  if (timeHit) {
    // فقط وقتی ساعت واقعاً تشخیص داده شد — تا «یک کتاب بخوان» بی‌جهت پاک نشود
    removals.push(
      new RegExp(`(?:ساعت\\s*)?(?:${DIGIT}{1,2}|${WORD_H_ALT})\\s*[:：]\\s*${DIGIT}{2}(?:\\s*(?:${DP_ALT}))?`, 'g'),
      new RegExp(`(?:ساعت\\s+)?(?:${DIGIT}{1,2}|${WORD_H_ALT})\\s*و\\s*(?:نیم|ربع)(?!\\s*[:：])`, 'g'),
      new RegExp(`ساعت\\s+(?:${DIGIT}{1,2}|${WORD_H_ALT})(?:\\s*(?:${DP_ALT}))?(?!\\s*[:：])`, 'g'),
      new RegExp(`(?:${DIGIT}{1,2}|${WORD_H_ALT})\\s+(?:${DP_ALT})(?!\\s*[:：])`, 'g'),
    );
  }
  let out = text;
  for (const re of removals) {
    out = out.replace(re, ' ');
  }
  // v17 — جداکننده‌های یتیم بعد از پاک‌سازی («، گزارش بده» → «گزارش بده»)
  return out
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s،؛,;!؟?\.\-:]+/, '')
    .replace(/[\s،؛,!؟?\.\-:]+$/, '');
}

export function detectSmartDate(text: string, now: Date): SmartDateHit | null {
  const normA = toLatinDigits(text).trim();
  if (!normA) return null;

  // v17 — اعداد حروفی → رقم (قبل از نیم‌فاصله‌زدایی تا «سه‌شنبه» محفوظ بماند)
  const norm = wordsToDigits(normA).replace(/\u200c/g, ' ').trim();
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

  /* ---------- ۲) امروز / امشب / فردا / پس‌فردا ---------- */
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
    } else if (RE_TONIGHT.test(norm)) {
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      prefix = 'امشب';
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
  /* v17 — بخش روز (صبح/ظهر/بعدازظهر/عصر/شب/امشب) روی ساعت ۱..۱۲ اعمال می‌شود */
  const dayPart = findDayPart(norm);
  let timeHit = false;
  const tm = norm.match(RE_TIME_HM);
  if (tm) {
    const h = parseInt(tm[1], 10);
    const m = parseInt(tm[2], 10);
    if (h <= 23 && m <= 59) {
      dueTime = `${pad2(applyDayPart(h, dayPart))}:${pad2(m)}`;
      timeHit = true;
    }
  }
  if (!timeHit) {
    const thHalf = norm.match(RE_TIME_HALF);
    if (thHalf) {
      const h = parseInt(thHalf[1] ?? thHalf[3], 10);
      const min = (thHalf[2] ?? thHalf[4]) === 'نیم' ? 30 : 15;
      if (h >= 0 && h <= 23) {
        dueTime = `${pad2(applyDayPart(h, dayPart))}:${pad2(min)}`;
        timeHit = true;
      }
    }
  }
  if (!timeHit) {
    const th = norm.match(RE_TIME_H);
    if (th) {
      const h = parseInt(th[1], 10);
      if (h <= 23) {
        dueTime = `${pad2(applyDayPart(h, dayPart))}:00`;
        timeHit = true;
      }
    }
  }
  if (!timeHit) {
    // v17 — «۱۰ شب» بدون کلمه‌ی «ساعت» (بخش‌روز الزامی است تا «۱۲ کتاب» ساعت نشود)
    const tbd = norm.match(RE_TIME_BARE_DP);
    if (tbd) {
      const h = parseInt(tbd[1], 10);
      if (h >= 0 && h <= 12) {
        dueTime = `${pad2(applyDayPart(h, dayPart))}:00`;
        timeHit = true;
      }
    }
  }

  if (!target && !dueTime) return null;

  /* ---------- ساخت خروجی ---------- */
  if (!target) target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const when = `${weekdayName(target)} ${faShort(target)}`;
  const label = `${prefix ? prefix + ' — ' : ''}${when}${dueTime ? ' • ' + toFa(dueTime) : ''}`;
  const cleanTitle = stripPhrases(text, timeHit) || text.trim();

  return { label, dueDate: toIsoDate(target), dueTime, cleanTitle };
}

/** قالب‌بندی اعداد و تاریخ به فارسی — با Intl مرورگر، کاملاً آفلاین */

const faNum = new Intl.NumberFormat('fa-IR');
const faDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const faShortDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'long',
});

/** تبدیل ارقام لاتین به فارسی */
export function toFa(value: number | string): string {
  if (typeof value === 'number') return faNum.format(value);
  return value.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/** تاریخ کامل شمسی به ترتیب طرح: جمعه ۱ آبان ۱۴۰۵ */
export function faFullDate(date: Date): string {
  const parts = faDate.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

/** تاریخ کوتاه شمسی: ۲۴ مهر */
export function faShort(date: Date): string {
  return faShortDate.format(date);
}

/** ساعت «HH:mm» ورودی و خروجی فارسی ۱۸:۳۰ */
export function faTime(hhmm: string): string {
  return toFa(hhmm);
}

const faDateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * تاریخ و ساعت شمسی از رشته‌ی UTC سرور («YYYY-MM-DD HH:MM:SS») — برای
 * نمایش زمان ثبت/بررسی درخواست‌های واریز. خروجی نمونه: ۳ آبان، ۱۴:۰۵
 */
export function faDateTimeUtc(serverUtc: string | null | undefined): string {
  if (!serverUtc) return '';
  const iso = serverUtc.includes('T') ? serverUtc : serverUtc.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return faDateTime.format(d);
}

/** برچسب نسبی روز: امروز / فردا / دیروز / نام روز هفته / تاریخ کوتاه */
export function relativeDayLabel(isoDate: string | null, today: Date): string {
  if (!isoDate) return '';
  const d = parseIsoDate(isoDate);
  const t0 = startOfDay(today).getTime();
  const day0 = startOfDay(d).getTime();
  const diff = Math.round((day0 - t0) / 86400000);
  if (diff === 0) return 'امروز';
  if (diff === 1) return 'فردا';
  if (diff === -1) return 'دیروز';
  if (diff > 1 && diff <= 6) return weekdayName(d);
  if (diff < -1 && diff >= -6) return weekdayName(d);
  return faShort(d);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** «YYYY-MM-DD» → Date (نیمه‌شب محلی) */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → «YYYY-MM-DD» محلی */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];

export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function faInt(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** گروه‌بندی هزارگان با جداکننده‌ی فارسی: 49500 → «۴۹٬۵۰۰» */
function faGroup(n: number): string {
  return faInt(new Intl.NumberFormat('en-US').format(n)).replace(/,/g, '٬');
}

/**
 * تومان صحیح → متن فارسی — قرارداد واحد در سه سمت (اپ/پنل/سرور، تست مشترک):
 *   ۹۹۰       → «۹۹۰ تومان»
 *   ۴۹٬۰۰۰    → «۴۹ هزار تومان»
 *   ۴۹۰٬۰۰۰   → «۴۹۰ هزار تومان»
 *   ۴۹٬۵۰۰    → «۴۹٬۵۰۰ تومان»
 *   ۱٬۰۰۰٬۰۰۰ → «۱ میلیون تومان»
 *   ۱٬۲۰۰٬۰۰۰ → «۱٫۲ میلیون تومان»
 * واحد پول سامانه از فاز تومان «تومان صحیح» است؛ تبدیل واحد درگاه فقط داخل درایور زیبال انجام می‌شود.
 */
export function formatToman(tomans: number): string {
  const t = Math.max(0, Math.round(Number.isFinite(tomans) ? tomans : 0));
  if (t < 1000) return `${faInt(t)} تومان`;
  if (t % 1_000_000 === 0) return `${faInt(t / 1_000_000)} میلیون تومان`;
  if (t >= 1_000_000 && t % 100_000 === 0) {
    const m = Math.round((t / 1_000_000) * 10) / 10;
    const whole = Math.floor(m);
    const frac = Math.round((m - whole) * 10);
    const num = frac === 0 ? faInt(whole) : `${faInt(whole)}٫${faInt(frac)}`;
    return `${num} میلیون تومان`;
  }
  if (t % 1000 === 0) return `${faInt(t / 1000)} هزار تومان`;
  return `${faGroup(t)} تومان`;
}

/** گروه‌بندی شماره کارت چهاررقمی: «6037991122334455» → «6037 9911 2233 4455» */
export function groupCardNumber(n: string): string {
  return n.replace(/(\d{4})(?=\d)/g, '$1 ');
}

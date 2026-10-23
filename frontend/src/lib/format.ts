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

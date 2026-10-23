import * as jalaali from 'jalaali-js';
import { toFa } from './format';

/** تبدیل و تقویم شمسی — بر پایه‌ی jalaali-js (باندل‌شده محلی، بدون CDN) */

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

/** حروف کوتاه روزهای هفته از شنبه تا جمعه */
export const WEEK_HEADER = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

export function toJalali(date: Date): JDate {
  return jalaali.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function fromJalali(jy: number, jm: number, jd: number): Date {
  const g = jalaali.toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd);
}

export function isJalaliLeap(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm);
}

/** ایندکس روز هفته‌ی شمسی ۰=شنبه تا ۶=جمعه */
export function jalaliWeekday(date: Date): number {
  return (date.getDay() + 1) % 7;
}

export interface CalendarCell {
  jd: number | null; // null = خالی (روزهای ماه قبل/بعد)
  gregorian: Date | null;
  isToday: boolean;
  isFriday: boolean;
}

/** ساخت شبکه‌ی ۷×۶ ماه شمسی برای تقویم (شبکه‌ی کامل ۴۲ خانه مثل طرح) */
export function buildMonthGrid(jy: number, jm: number, today: Date): CalendarCell[] {
  const first = fromJalali(jy, jm, 1);
  const startWeekday = jalaliWeekday(first); // ۰=شنبه
  const monthLen = jalaliMonthLength(jy, jm);
  const todayJ = toJalali(today);
  const cells: CalendarCell[] = [];

  // روزهای ماه قبل برای تکمیل ردیف اول (فقط نمایشی)
  const prevMonthLen = jm === 1 ? jalaliMonthLength(jy - 1, 12) : jalaliMonthLength(jy, jm - 1);
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ jd: prevMonthLen - startWeekday + 1 + i, gregorian: null, isToday: false, isFriday: false });
  }
  for (let d = 1; d <= monthLen; d++) {
    const g = fromJalali(jy, jm, d);
    cells.push({
      jd: d,
      gregorian: g,
      isToday: todayJ.jy === jy && todayJ.jm === jm && todayJ.jd === d,
      isFriday: g.getDay() === 5,
    });
  }
  // تکمیل تا ۴۲ خانه
  let next = 1;
  while (cells.length < 42) {
    cells.push({ jd: next++, gregorian: null, isToday: false, isFriday: false });
  }
  return cells;
}

/** «۲۴ مهر ۱۴۰۳» */
export function faJalaliDate(date: Date): string {
  const j = toJalali(date);
  return `${toFa(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFa(j.jy)}`;
}

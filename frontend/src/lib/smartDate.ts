import { toFa, faShort } from './format';

/**
 * تشخیص هوشمند تاریخ/ساعت از متن طبیعی (مثل طرح) — کلاینت‌محور و آفلاین.
 * مثال: «فردا ساعت ۱۷ خرید نان سنگک» → «فردا پنج‌شنبه ۲۵ مهر • ۱۷:۰۰»
 */
export function detectSmartDateTime(text: string, today: Date): string {
  const t = text.trim();
  if (!t) return 'امروز • کل روز';

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const friday = nextWeekday(today, 5); // جمعه

  const timeMatch = t.match(/(?:ساعت\s*)?([۰-۹0-9]{1,2})\s*[:：]\s*([۰-۹0-9]{2})|(?:ساعت\s+)([۰-۹0-9]{1,2})/);

  let timePart = '';
  if (timeMatch) {
    const h = timeMatch[3] ?? timeMatch[1] ?? '';
    const m = timeMatch[2] ?? '۰۰';
    timePart = toFa(`${latinDigits(h).padStart(2, '0')}:${latinDigits(m).padStart(2, '0')}`);
  }

  if (t.includes('فردا')) {
    return `فردا ${faShort(tomorrow)}${timePart ? ' • ' + timePart : ' • کل روز'}`;
  }
  if (t.includes('جمعه') || t.includes('آخر هفته')) {
    return `جمعه ${faShort(friday)} • آخر هفته`;
  }
  if (t.includes('هفته بعد') || t.includes('هفته آینده')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return `هفته بعد ${faShort(nextWeek)}${timePart ? ' • ' + timePart : ''}`;
  }
  if (timePart) return `امروز ${faShort(today)} • ${timePart}`;
  return `امروز ${faShort(today)} • ساعت هوشمند`;
}

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function latinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
}

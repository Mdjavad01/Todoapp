import { getClockOffsetMs } from './clock';

/** تولید شناسه‌ی UUID سمت کلاینت (برای سینک ابری آینده) */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // جایگزین برای مرورگرهای قدیمی‌تر
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * زمان فعلی هم‌ترازِ سرور (ترمیم جریان — فاز ۱):
 * اگر از پاسخ سینک اختلاف ساعت معنادار دیده شده باشد، جبران می‌شود
 * تا updatedAtها در LWW قابل‌اعتماد باشند (lib/clock.ts).
 */
export function nowIso(): string {
  return new Date(Date.now() + getClockOffsetMs()).toISOString();
}

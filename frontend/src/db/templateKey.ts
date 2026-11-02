import type { ListEntity } from '@/types';

/**
 * P2.0 — کلید داخلی قالب (بستن بدهی templateKey ثبت‌شده در ROADMAP)
 *
 * چرا؟ تشخیص «قبلاً ساخته شده» با تطبیق نام لیست، نام را «هویت» می‌گیرد — برچسب است، نه هویت.
 * اگر کاربر نام لیست قالبی را عوض کند، فعال‌سازی دوباره لیست تکراری می‌ساخت و بازنشانی آن را نمی‌دید.
 * حالا هر لیست قالبی یک کلید پایدار سینک‌پذیر دارد (lists.template_key — سمت سرور هم همین ستون) و
 * تشخیص «اول با کلید، فال‌بک نامی برای داده‌ی قدیمیِ بدون کلید» است.
 *
 * قواعد قطعی این ماژول (خالص و بدون دسترسی به داده — تست‌پذیر):
 *  ۱) دارنده‌ی کلید = قدیمی‌ترین لیستِ زنده با آن کلید (قطعی با compareLists — تحمل کلیدِ تکراریِ
 *     دو‌دستگاهی: هیچ لیست سومی ساخته نمی‌شود، بقیه هم دست نمی‌خورند).
 *  ۲) فال‌بک نامی فقط وقتی «هیچ» دارنده‌ی کلیدی نیست — لیست قدیمی هم‌نام به‌عنوان همان لیست قالب
 *     شناخته می‌شود تا داده‌ی کاربران قدیمی (قبل از کلید) همگرا بماند.
 *  ۳) «تصاحب» (نوشتن کلید روی لیست فال‌بک‌شده) فقط در فعال‌سازی انجام می‌شود — اینجا فقط تشخیص است.
 */

/** قالب کلید — یکسان با اعتبارسنجی سمت سرور (Entities::templateKeyToSql) */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9.\-]{0,31}$/;

/** کلید فهرست i-ام یک قالب/بسته — «trader.0»، «kit-store.2»، «tpl-market.0» */
export function templateListKey(templateId: string, index: number): string {
  return `${templateId}.${index}`;
}

/** اعتبار ساختاری کلید (بدون سمت سرور هم گارد است — داده‌ی خراب هرگز تشخیص قالب را نشکند) */
export function isValidTemplateKey(key: unknown): key is string {
  return typeof key === 'string' && TEMPLATE_KEY_PATTERN.test(key);
}

/** ترتیب قطعی «قدیمی‌ترین اول» — فقط روی فیلدهای سینک‌پذیر (createdAt سپس id) */
function oldestFirst(a: ListEntity, b: ListEntity): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * لیستِ زنده‌ی دارنده‌ی کلید — قدیمی‌ترین (قطعی). اگر هیچ‌کس کلید را ندارد → undefined.
 */
export function findListByKey(lists: ListEntity[], key: string): ListEntity | undefined {
  return lists
    .filter((l) => !l.deletedAt && isValidTemplateKey(l.templateKey) && l.templateKey === key)
    .sort(oldestFirst)[0];
}

/**
 * تشخیص لیست قالبی i-ام: اول کلید، بعد فال‌بک نام دقیق (فقط وقتی دارنده‌ی کلیدی نیست).
 * نام‌های قدیمی لیست‌های قالبیِ حذف‌شده از کاتالوگ (kit-trader قدیمی و...) عمداً اینجا نیستند —
 * آن داده‌ها لیست/کار عادی کاربرند و دست نمی‌خورند.
 */
export function findTemplateList(
  lists: ListEntity[],
  key: string,
  fallbackName: string,
): ListEntity | undefined {
  const byKey = findListByKey(lists, key);
  if (byKey) return byKey;
  return lists.find((l) => !l.deletedAt && l.name === fallbackName);
}

/**
 * همه‌ی لیست‌های قالب به ترتیب تعریف — جاهای خالی undefined می‌مانند.
 */
export function findTemplateLists<T extends { name: string }>(
  lists: ListEntity[],
  defs: readonly T[],
  keyOf: (index: number) => string,
): (ListEntity | undefined)[] {
  return defs.map((def, i) => findTemplateList(lists, keyOf(i), def.name));
}

/** قالب فعال است اگر همه‌ی لیست‌هایش (با کلید یا نام) موجود باشند */
export function isTemplateActive<T extends { name: string }>(
  lists: ListEntity[],
  defs: readonly T[],
  keyOf: (index: number) => string,
): boolean {
  return findTemplateLists(lists, defs, keyOf).every((l) => l !== undefined);
}

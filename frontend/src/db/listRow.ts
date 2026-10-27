/**
 * کارام — نرمال‌سازی ردیف لیست (فاز ۲ — مهاجرت نسخه‌دار IndexedDB)
 * عمداً «خالص» است (بدون IndexedDB/شبکه) تا در تست قابل استفاده باشد؛
 * مصرف‌کننده: گام مهاجرت v2 در db/idb.ts
 */

/** رنگ‌های مجاز لیست — هم‌قرارداد با types و سرور (Entities::LIST_COLORS) */
export const VALID_LIST_COLORS: readonly string[] = ['teal', 'amber', 'indigo', 'emerald', 'rose', 'purple'];

/**
 * ترمیم ردیف‌های قدیمی/آسیب‌دیده‌ی لیست هنگام مهاجرت به v2:
 *  - ردیف بدون شناسه = حذف (خروجی null)
 *  - رنگ نامعتبر → teal (پیش‌فرض رسمی)
 *  - sortOrder غیرعددی → ۰
 *  - ایموجی/نام غایب → جایگزین سالم
 * هیچ داده‌ای از بین نمی‌رود؛ فقط مقادیر خراب به مقدار پیش‌فرض قطعی برمی‌گردند.
 */
export function normalizeListRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id === '') return null;
  const next: Record<string, unknown> = { ...row };
  if (typeof next.color !== 'string' || !VALID_LIST_COLORS.includes(next.color)) next.color = 'teal';
  const so = Number(next.sortOrder);
  next.sortOrder = Number.isFinite(so) ? Math.max(0, Math.floor(so)) : 0;
  if (typeof next.emoji !== 'string' || next.emoji.trim() === '') next.emoji = '🗂️';
  if (typeof next.name !== 'string' || next.name.trim() === '') next.name = 'بدون نام';
  if (typeof next.createdAt !== 'string' || next.createdAt === '') next.createdAt = '1970-01-01T00:00:00.000Z';
  if (typeof next.updatedAt !== 'string' || next.updatedAt === '') next.updatedAt = '1970-01-01T00:00:00.000Z';
  return next;
}

/**
 * کارام — پاک‌سازی داده‌ی کاربر هنگام خروج از حساب (ترمیم جریان — فاز ۱ / حریم خصوصی)
 *
 * قانون: داده‌ی یک حساب هرگز نباید به حساب بعدی روی همان دستگاه برسد.
 *  - انبارهای داده (lists/tasks/subtasks/reminders/meta) کامل پاک می‌شوند؛
 *  - از prefs فقط کلیدهای «حساب» پاک می‌شوند (نشست، نام، آنبوردینگ)؛
 *  - کلیدهای «دستگاه» (تم، اکسنت، فونت، بایومتریک، device-uuid) می‌مانند.
 */

import { idbClear, idbDelete, idbGetAll, STORES } from './idb';
import type { PrefEntity } from '@/types';

/** کلیدهای pref که مالِ دستگاه‌اند و با خروج از حساب نباید پاک شوند */
const DEVICE_PREF_KEYS: readonly string[] = [
  'device-uuid',
  'theme-dark',
  'accent',
  'fontScale',
  'biometricLock',
  'alerts',
  'coach-add-seen',
  'first-done-celebrated',
];

/** پاک‌سازی کامل داده‌ی محلی کاربر — در logout (بعد از clearSession) صدا زده می‌شود */
export async function wipeUserData(): Promise<void> {
  await Promise.all([
    idbClear(STORES.lists),
    idbClear(STORES.tasks),
    idbClear(STORES.subtasks),
    idbClear(STORES.reminders),
    idbClear(STORES.meta), // seededVersion / کرسرهای سینک / نشان لیست پیش‌فرض — همه مال داده‌ی قبلی‌اند
  ]);
  const prefs = await idbGetAll<PrefEntity>(STORES.prefs);
  for (const p of prefs) {
    if (!DEVICE_PREF_KEYS.includes(p.key)) {
      await idbDelete(STORES.prefs, p.key);
    }
  }
}

/**
 * کارام — زمان‌بند یادآور (فاز ۴) — همگام‌سازی زنگ‌های دستگاه با داده‌ی فعلی
 *
 * قواعد:
 *  - فقط در اپ اندروید (در وب بی‌عمل — باندل وب پلاگین بومی را نمی‌گیرد).
 *  - کلید «اعلان‌ها» (alerts) کاربر گِیتِ اصلی است: خاموش = همه‌ی زنگ‌ها پاک می‌شوند.
 *  - اثر انگشت برنامه (scheduleFingerprint) جلوی تماس اضافی به سیستم‌عامل را می‌گیرد —
 *    هر refresh/sinک می‌تواند این تابع را صدا بزند بدون هزینه.
 *  - مجوز فقط یک‌بار در هر نشست درخواست می‌شود؛ ردِ کاربر بی‌سروصدا و با راهنمای
 *    تنظیمات همراه است (SettingsView). بازگشت از تنظیمات سیستم با force بازبینی می‌شود.
 *  - هر خطا بی‌صدا گرفته می‌شود؛ یادآور هرگز نباید جریان اصلی اپ را بشکند.
 */

import type { TaskEntity } from '@/types';
import { isNativeApp } from '@/lib/native';
import { buildReminderSchedule, diffReminderSchedules, scheduleFingerprint } from '@/lib/reminders';
import {
  cancelAllReminderAlarms,
  cancelReminderAlarms,
  pendingReminderIds,
  reminderPermissionState,
  requestRemindersPermission,
  scheduleReminderAlarms,
} from '@/lib/reminderBridge';

let lastFingerprint = '';
let permissionAskedThisSession = false;

/** ریست حافظه‌ی داخلی (خروج از حساب / بازبینی اجباری) */
export function resetReminderCache(): void {
  lastFingerprint = '';
  permissionAskedThisSession = false;
}

/**
 * همگام‌سازی زنگ‌های یادآور با داده — هر بار فراخوانی امن است.
 * @param force بازبینی اجباری حتی با اثر انگشت یکسان (بعد از resume / بازگشت از تنظیمات)
 */
export async function syncReminders(tasks: TaskEntity[], alertsOn: boolean, force = false): Promise<void> {
  try {
    if (!isNativeApp()) return;
    if (force) lastFingerprint = '';

    const next = alertsOn ? buildReminderSchedule(tasks, { nowMs: Date.now() }) : [];
    const fp = scheduleFingerprint(next, alertsOn);
    if (fp === lastFingerprint) return;

    // اعلان‌ها خاموش → همه‌ی زنگ‌های دستگاه پاک می‌شوند (بدون نیاز به مجوز)
    if (!alertsOn) {
      await cancelAllReminderAlarms();
      lastFingerprint = fp;
      return;
    }

    // مجوز اعلان — فقط یک درخواست در هر نشست؛ رد شدن = بی‌سروصدا (راهنما در تنظیمات)
    const perm = await reminderPermissionState();
    if (perm === 'prompt' && !permissionAskedThisSession) {
      permissionAskedThisSession = true;
      const granted = await requestRemindersPermission();
      if (!granted) {
        lastFingerprint = fp;
        return;
      }
    }
    if (perm === 'denied') {
      lastFingerprint = fp;
      return;
    }

    const currentIds = await pendingReminderIds();
    const { cancelIds, toSchedule } = diffReminderSchedules(currentIds, next);
    if (cancelIds.length > 0) await cancelReminderAlarms(cancelIds);
    if (toSchedule.length > 0) await scheduleReminderAlarms(toSchedule);
    lastFingerprint = fp;
  } catch {
    /* یادآور حیاتی نیست */
  }
}

/**
 * درخواست مجوز در لحظه‌ی تنظیم یادآور روی کار (UX: مجوز همان‌جا که کاربر انتظارش را دارد)
 * فقط وقتی وضعیت 'prompt' باشد درخواست می‌شود؛ ردِ قبلی دوباره پرسیده نمی‌شود.
 */
export async function ensureRemindersPermissionNow(): Promise<void> {
  try {
    if (!isNativeApp() || permissionAskedThisSession) return;
    const perm = await reminderPermissionState();
    if (perm !== 'prompt') return;
    permissionAskedThisSession = true;
    await requestRemindersPermission();
  } catch {
    /* بی‌صدا */
  }
}

/** پاک‌سازی کامل زنگ‌های دستگاه (خروج از حساب) — بدون شرط پلتفرم برای ریست اثر انگشت */
export async function clearReminders(): Promise<void> {
  lastFingerprint = '';
  permissionAskedThisSession = false;
  try {
    if (!isNativeApp()) return;
    await cancelAllReminderAlarms();
  } catch {
    /* بی‌صدا */
  }
}

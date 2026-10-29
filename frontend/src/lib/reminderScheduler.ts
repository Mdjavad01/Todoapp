/**
 * کارام — زمان‌بند یادآور (فاز ۴ + ممیزی یادآور — فاز ۲)
 * همگام‌سازی زنگ‌های دستگاه با داده‌ی فعلی
 *
 * قواعد:
 *  - فقط در اپ اندروید (در وب بی‌عمل — باندل وب پلاگین بومی را نمی‌گیرد).
 *  - کلید «اعلان‌ها» (alerts) کاربر گِیتِ اصلی است: خاموش = همه‌ی زنگ‌ها پاک می‌شوند.
 *  - اثر انگشت برنامه (scheduleFingerprint) جلوی تماس اضافی به سیستم‌عامل را می‌گیرد —
 *    هر refresh/سینک می‌تواند این تابع را صدا بزند بدون هزینه.
 *  - «بازسنجی کامل سرد» (رفع باگ G1 ممیزی): آپدیت APK و force-stop/کشتن‌فرایند آلارم‌های
 *    AlarmManager را پاک می‌کند ولی storage پلاگین می‌ماند → getPending همان شناسه‌های
 *    قبلی را می‌دهد و دیفرانسول «بدون‌تغییر» تصمیم می‌گیرد؛ بنابراین در اولین همگام‌سازیِ
 *    هر فرایند، همه‌ی زنگ‌ها لغو و از روی داده بازثبت می‌شوند (خودترمیمی، حداکثر ۶۰ تماس).
 *  - مجوز فقط یک‌بار در هر نشست درخواست می‌شود؛ ردِ کاربر بی‌سروصدا و با راهنمای
 *    تنظیمات همراه است (SettingsView). بازگشت از تنظیمات سیستم با force بازبینی می‌شود.
 *  - «۱۰ دقیقه دیگر»: رجیستری snooze (پایدار در prefs) — ورودی‌های آن مثل زنگ‌های عادی در
 *    برنامه ادغام می‌شوند؛ انجام/حذف کار یا گذشتن زمان، ورودی را حذف می‌کند و دیفرانسول
 *    زنگِ یتیم را خودش لغو می‌کند.
 *  - هر خطا در lastError ثبت می‌شود (کارت «اطمینان از دریافت یادآور»)؛ جریان اصلی اپ هرگز نمی‌شکند.
 *  - منطق خالص (برنامه‌ریز/رجیستری/مسیریابی اکشن) در reminderPlan است — قابل تست با ساعت شبیه‌سازی‌شده.
 */

import type { TaskEntity } from '@/types';
import * as repo from '@/db/repo';
import { isNativeApp } from '@/lib/native';
import { buildReminderSchedule, stableNotificationId } from '@/lib/reminders';
import { restoreSnooze, resolveReminderPlan, snoozeEntries, snoozeSnapshot, clearSnoozes, type SnoozeEntry } from '@/lib/reminderPlan';
import {
  bridgeErrors,
  cancelAllReminderAlarms,
  cancelReminderAlarms,
  exactAlarmState,
  pendingReminderIds,
  reminderPermissionState,
  removeAllDeliveredNotifications,
  scheduleReminderAlarms,
  requestRemindersPermission,
  type ExactAlarmState,
  type ReminderPermissionState,
} from '@/lib/reminderBridge';

let lastFingerprint = '';
let permissionAskedThisSession = false;
/** بازسنجی کامل فقط یک‌بار در هر فرایند (شروع سرد) — باگ آپدیت APK/force-stop */
let didColdReschedule = false;

/** ریست حافظه‌ی داخلی (بازبینی اجباری) */
export function resetReminderCache(): void {
  lastFingerprint = '';
  permissionAskedThisSession = false;
}

/* تصمیم قطعی برنامه، رجیستری snooze و مسیریابی اکشن — پیاده‌سازی خالص در reminderPlan */
export { resolveReminderPlan, snoozeEntries, registerSnooze, snoozeNotifId, snoozeSnapshot, restoreSnooze, clearSnoozes, snoozeCount, setReminderActionHandlers, handleReminderAction } from '@/lib/reminderPlan';
export type { ReminderPlan, ReminderPlanInput, ReminderActionHandlers, SnoozeEntry } from '@/lib/reminderPlan';

/* ------------------------------------------------------------------ */
/* پایداری رجیستری snooze در prefs                                     */
/* ------------------------------------------------------------------ */

const SNOOZE_PREF_KEY = 'reminder-snoozes';
let snoozesLoaded = false;

function persistSnoozes(): void {
  void repo
    .prefsSet(SNOOZE_PREF_KEY, JSON.stringify(snoozeSnapshot()))
    .catch(() => undefined);
}

async function loadSnoozes(): Promise<void> {
  if (snoozesLoaded) return;
  snoozesLoaded = true;
  try {
    const raw = await repo.prefsGet<string | null>(SNOOZE_PREF_KEY, null);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const s of parsed) {
        if (
          s && typeof s === 'object' &&
          typeof (s as SnoozeEntry).taskId === 'string' &&
          typeof (s as SnoozeEntry).fireAtMs === 'number' &&
          typeof (s as SnoozeEntry).title === 'string' &&
          typeof (s as SnoozeEntry).body === 'string'
        ) {
          restoreSnooze(s as SnoozeEntry); // همان مقادیر — بدون بازسازی عنوان/متن
        }
      }
    }
  } catch {
    /* رجیستری خراب = مثل خالی رفتار می‌شود */
  }
}

/* ------------------------------------------------------------------ */
/* همگام‌سازی زنگ‌ها با داده                                          */
/* ------------------------------------------------------------------ */

/**
 * همگام‌سازی زنگ‌های یادآور با داده — هر بار فراخوانی امن است.
 * @param force بازبینی اجباری حتی با اثر انگشت یکسان (بعد از resume / بازگشت از تنظیمات)
 */
export async function syncReminders(tasks: TaskEntity[], alertsOn: boolean, force = false): Promise<void> {
  try {
    if (!isNativeApp()) return;
    if (force) lastFingerprint = '';

    await loadSnoozes();
    const nowMs = Date.now();
    const base = alertsOn ? buildReminderSchedule(tasks, { nowMs }) : [];
    const next = alertsOn ? [...base, ...snoozeEntries(tasks, nowMs)] : [];
    const fullReschedule = !didColdReschedule;
    const plan = resolveReminderPlan({
      currentIds: await pendingReminderIds(),
      next,
      alertsOn,
      fullReschedule,
    });

    if (!fullReschedule && plan.noop && plan.fingerprint === lastFingerprint) return;

    // اعلان‌ها خاموش → همه‌ی زنگ‌های دستگاه پاک می‌شوند (بدون نیاز به مجوز)
    if (!alertsOn) {
      await cancelAllReminderAlarms();
      didColdReschedule = true;
      lastFingerprint = plan.fingerprint;
      return;
    }

    // مجوز اعلان — فقط یک درخواست در هر نشست؛ رد شدن = بی‌سروصدا (راهنما در تنظیمات)
    const perm = await reminderPermissionState();
    if (perm === 'prompt' && !permissionAskedThisSession) {
      permissionAskedThisSession = true;
      const granted = await requestRemindersPermission();
      if (!granted) {
        didColdReschedule = true;
        lastFingerprint = plan.fingerprint;
        return;
      }
    }
    if (perm === 'denied') {
      didColdReschedule = true;
      lastFingerprint = plan.fingerprint;
      return;
    }

    if (plan.cancelIds.length > 0) await cancelReminderAlarms(plan.cancelIds);
    if (plan.toSchedule.length > 0) {
      const ok = await scheduleReminderAlarms(plan.toSchedule);
      if (!ok) return; // ثبت نشد → اثر انگشت تازه نمی‌شود تا تلاش بعدی دوباره امتحان کند
    }
    didColdReschedule = true;
    lastFingerprint = plan.fingerprint;
    persistSnoozes();
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

/** پاک‌سازی کامل زنگ‌های دستگاه (خروج از حساب) — سینی اعلان هم خالی می‌شود */
export async function clearReminders(): Promise<void> {
  lastFingerprint = '';
  permissionAskedThisSession = false;
  clearSnoozes();
  void repo.prefsSet(SNOOZE_PREF_KEY, '[]').catch(() => undefined);
  try {
    if (!isNativeApp()) return;
    await cancelAllReminderAlarms();
    await removeAllDeliveredNotifications();
  } catch {
    /* بی‌صدا */
  }
}

/* ------------------------------------------------------------------ */
/* تشخیص وضعیت — کارت «اطمینان از دریافت یادآور»                       */
/* ------------------------------------------------------------------ */

export interface ReminderDiag {
  native: boolean;
  alertsOn: boolean;
  permission: ReminderPermissionState;
  exactAlarm: ExactAlarmState;
  /** زنگ‌های واقعاً در صف سیستم‌عامل */
  pendingCount: number;
  /** برنامه‌ی محاسبه‌شده‌ی فعلی (زنگ کارها + snooze) */
  plannedCount: number;
  lastError: { at: string; message: string } | null;
  checkedAt: string;
}

/** آخرین خطای زمان‌بند (خطاهای پل از bridgeErrors می‌آید) */
export let lastSchedulerError: { at: string; message: string } | null = null;

/** جمع‌آوری وضعیت واقعی یادآور — برای تنظیمات؛ هیچ‌چیز را تغییر نمی‌دهد */
export async function reminderDiag(tasks: TaskEntity[], alertsOn: boolean): Promise<ReminderDiag> {
  const native = isNativeApp();
  const permission: ReminderPermissionState = await reminderPermissionState();
  const exactAlarm: ExactAlarmState = await exactAlarmState();
  const pendingIds: number[] = await pendingReminderIds();
  const nowMs = Date.now();
  const planned = native && alertsOn
    ? [...buildReminderSchedule(tasks, { nowMs }), ...snoozeEntries(tasks, nowMs)]
    : [];
  return {
    native,
    alertsOn,
    permission,
    exactAlarm,
    pendingCount: pendingIds.length,
    plannedCount: planned.length,
    lastError: bridgeErrors.last ?? lastSchedulerError,
    checkedAt: new Date().toISOString(),
  };
}

/** ثبت خطای سطح زمان‌بند — بی‌صدا نمی‌ماند */
export function recordSchedulerError(message: string): void {
  lastSchedulerError = { at: new Date().toISOString(), message };
}

/* ------------------------------------------------------------------ */
/* v1.9 — یادآور آزمایشی (تنظیمات ← کارت اطمینان از دریافت یادآور)     */
/* ------------------------------------------------------------------ */

/** پیش‌نمایش/آزمون: زنگ آزمایشی ~۱۰ ثانیه بعد — با همان کانال و دکمه‌های اعلان */
export async function sendTestReminder(): Promise<boolean> {
  if (!isNativeApp()) return false;
  const fireAtMs = Date.now() + 10_000;
  const ok = await scheduleReminderAlarms([
    {
      notifId: stableNotificationId('karam-test-reminder', fireAtMs, 'یادآور آزمایشی کارام'),
      taskId: 'karam-test-reminder',
      title: 'یادآور آزمایشی کارام',
      body: 'اگر این اعلان را همین حالا دیدید، یادآور کارام روی این گوشی سالم است ✓',
      fireAtMs,
      reminderMinutes: 0,
    },
  ]);
  if (!ok) {
    recordSchedulerError('ثبت زنگ آزمایشی ناموفق بود');
  }
  return ok;
}

/**
 * کارام — پل یادآور بومی (فاز ۴ + ممیزی یادآور — فاز ۲)
 * تنها لایه‌ای که با @capacitor/local-notifications حرف می‌زند
 *
 *  - وب: همه‌ی توابع بی‌عمل‌اند (پلاگین با import پویا فقط در اپ اندروید بارگذاری می‌شود —
 *    باندل وب هرگز کد پلاگین را نمی‌گیرد).
 *  - هر خطا گرفته می‌شود؛ یادآور هرگز نباید جریان اصلی اپ را بشکند. آخرین خطا در
 *    bridgeErrors ثبت می‌شود تا «اطمینان از دریافت یادآور» در تنظیمات بی‌صدا نماند.
 *  - کانال فارسی «یادآور کارام» با اهمیت بالا (صدا + لرزش) — یک‌بار ساخته می‌شود (idempotent).
 *  - بازیابی بعد از ری‌استارت (BOOT_COMPLETED) را گیرنده‌ی خودِ پلاگین انجام می‌دهد
 *    (LocalNotificationRestoreReceiver در مانیفست پلاگین — BOOT_COMPLETED +
 *    LOCKED_BOOT_COMPLETED + QUICKBOOT_POWERON) — اینجا کار اضافه‌ای نیست.
 *    برای «آپدیت APK» (که BOOT ندارد) جبرانِ سمت اپ: بازسنجی کامل سرد در reminderScheduler.
 */

import { isNativeApp } from '@/lib/native';
import type { ReminderScheduleEntry } from '@/lib/reminders';

/** شناسه‌ی کانال اعلان — در تنظیمات اندروید با همین نام دیده می‌شود */
export const REMINDER_CHANNEL_ID = 'karam-reminders';

/** رنگ آیکن اعلان — هم‌رنگ هویت بصری کارام (teal) */
export const REMINDER_ICON_COLOR = '#00685F';

/** شناسه‌ی نوع اکشن اعلان — «انجام شد» و «۱۰ دقیقه دیگر» */
export const REMINDER_ACTION_TYPE = 'KARAM_REMINDER';

/** شناسه‌ی اکشن «انجام شد» — هم‌قرارداد با reminderScheduler */
export const ACTION_DONE_ID = 'done';

/** شناسه‌ی اکشن «۱۰ دقیقه دیگر» — هم‌قرارداد با reminderScheduler */
export const ACTION_SNOOZE10_ID = 'snooze10';

type LNModule = typeof import('@capacitor/local-notifications');

let cachedModule: LNModule | null = null;
let channelReady = false;
let actionsRegistered = false;

/** آخرین خطای لایه‌ی بومی — برای کارت «اطمینان از دریافت یادآور» (خطا هرگز کاملاً بی‌صدا نمی‌ماند) */
export const bridgeErrors: { last: { at: string; message: string } | null } = { last: null };

function recordError(message: string): void {
  bridgeErrors.last = { at: new Date().toISOString(), message };
}

async function ln(): Promise<LNModule | null> {
  if (!isNativeApp()) return null;
  if (!cachedModule) cachedModule = await import('@capacitor/local-notifications');
  return cachedModule;
}

/** ساخت کانال فارسی — هر بار فراخوانی امن است (ساخت تکراری روی اندروید بی‌اثر است) */
export async function ensureReminderChannel(): Promise<void> {
  const m = await ln();
  if (!m || channelReady) return;
  try {
    await m.LocalNotifications.createChannel({
      id: REMINDER_CHANNEL_ID,
      name: 'یادآور کارام',
      description: 'اعلان یادآور سررسید کارها',
      importance: 4, // HIGH — صدا + نمایش سرآیند
      vibration: true,
      visibility: 1, // PUBLIC — عنوان کار روی قفل‌صفحه دیده می‌شود
    });
    channelReady = true;
  } catch {
    /* کانال حیاتی نیست؛ schedule خودش کانال پیش‌فرض را می‌سازد */
  }
}

/** ثبت دکمه‌های اعلان — یک‌بار در هر نشست؛ یادآورها با actionTypeId به این نوع ارجاع می‌دهند */
export async function registerReminderActionTypes(): Promise<void> {
  const m = await ln();
  if (!m || actionsRegistered) return;
  try {
    await m.LocalNotifications.registerActionTypes({
      types: [
        {
          id: REMINDER_ACTION_TYPE,
          actions: [
            { id: ACTION_DONE_ID, title: 'انجام شد' },
            { id: ACTION_SNOOZE10_ID, title: '۱۰ دقیقه دیگر' },
          ],
        },
      ],
    });
    actionsRegistered = true;
  } catch {
    /* دکمه‌ها حیاتی نیستند؛ اعلان بدون دکمه هم زنگ می‌خورد */
  }
}

export type ReminderPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** وضعیت مجوز اعلان — در وب همیشه 'unsupported' */
export async function reminderPermissionState(): Promise<ReminderPermissionState> {
  const m = await ln();
  if (!m) return 'unsupported';
  try {
    const st = await m.LocalNotifications.checkPermissions();
    if (st.display === 'granted') return 'granted';
    return st.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

/** درخواست مجوز اعلان (اندروید ۱۳+) — true فقط با موافقت کاربر */
export async function requestRemindersPermission(): Promise<boolean> {
  const m = await ln();
  if (!m) return false;
  try {
    const st = await m.LocalNotifications.requestPermissions();
    return st.display === 'granted';
  } catch {
    return false;
  }
}

/** وضعیت «آلارم دقیق» (SCHEDULE_EXACT_ALARM — اندروید ۱۲+؛ در ۱۴+ به‌صورت پیش‌فرض رد است) */
export type ExactAlarmState = 'granted' | 'denied' | 'unsupported';

export async function exactAlarmState(): Promise<ExactAlarmState> {
  const m = await ln();
  if (!m) return 'unsupported';
  try {
    const res = await m.LocalNotifications.checkExactNotificationSetting();
    return res.exact_alarm === 'denied' ? 'denied' : 'granted';
  } catch {
    return 'unsupported';
  }
}

/** بازکردن صفحه‌ی سیستمی «آلارم‌ها و یادآورها» برای فعال‌کردن زمان‌بندی دقیق */
export async function openExactAlarmSettings(): Promise<boolean> {
  const m = await ln();
  if (!m) return false;
  try {
    await m.LocalNotifications.changeExactNotificationSetting();
    return true;
  } catch {
    recordError('بازکردن تنظیمات آلارم دقیق ناموفق بود');
    return false;
  }
}

/** شناسه‌های زنگ‌های در صف سیستم‌عامل */
export async function pendingReminderIds(): Promise<number[]> {
  const m = await ln();
  if (!m) return [];
  try {
    const res = await m.LocalNotifications.getPending();
    return res.notifications.map((n) => n.id);
  } catch {
    recordError('خواندن زنگ‌های در صف ناموفق بود');
    return [];
  }
}

/** ثبت زنگ‌ها — دقیق (allowWhileIdle) در کانال فارسی با آیکن اختصاصی و دکمه‌های اعلان */
export async function scheduleReminderAlarms(entries: ReminderScheduleEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  const m = await ln();
  if (!m) return false;
  try {
    await ensureReminderChannel();
    await registerReminderActionTypes();
    await m.LocalNotifications.schedule({
      notifications: entries.map((e) => ({
        id: e.notifId,
        title: e.title,
        body: e.body,
        schedule: { at: new Date(e.fireAtMs), allowWhileIdle: true },
        channelId: REMINDER_CHANNEL_ID,
        smallIcon: 'ic_stat_karam',
        iconColor: REMINDER_ICON_COLOR,
        actionTypeId: REMINDER_ACTION_TYPE,
        extra: { taskId: e.taskId },
      })),
    });
    return true;
  } catch {
    recordError('ثبت زنگ در سیستم‌عامل ناموفق بود');
    return false;
  }
}

/** لغو زنگ‌های مشخص */
export async function cancelReminderAlarms(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const m = await ln();
  if (!m) return;
  try {
    await m.LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch {
    recordError('لغو زنگ‌ها ناموفق بود');
  }
}

/** پاک‌سازی همه‌ی زنگ‌های دستگاه (خروج از حساب / خاموش‌کردن اعلان‌ها) */
export async function cancelAllReminderAlarms(): Promise<void> {
  const ids = await pendingReminderIds();
  await cancelReminderAlarms(ids);
}

/** حذف همه‌ی اعلان‌های نمایش‌داده‌شده از سینی (خروج از حساب) */
export async function removeAllDeliveredNotifications(): Promise<void> {
  const m = await ln();
  if (!m) return;
  try {
    await m.LocalNotifications.removeAllDeliveredNotifications();
  } catch {
    /* سینی حیاتی نیست */
  }
}

/** اطلاعات اکشن روی اعلان — خروجی شنونده‌ی localNotificationActionPerformed */
export interface ReminderActionEvent {
  actionId: string;
  notifId: number;
  taskId: string | null;
}

/**
 * گوش‌دادن به اقدام روی اعلان (ضربه به بدنه = actionId 'tap'، یا دکمه‌های اعلان).
 * خروجی: تابع لغو گوش‌دادن. فقط در اپ اندروید فعال است.
 */
export function onReminderAction(
  handler: (ev: ReminderActionEvent) => void,
): () => void {
  let handle: Promise<{ remove: () => void }> | null = null;
  void (async () => {
    const m = await ln();
    if (!m) return;
    try {
      handle = m.LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
        const extra = (ev.notification.extra ?? {}) as { taskId?: unknown };
        handler({
          actionId: ev.actionId,
          notifId: ev.notification.id,
          taskId: typeof extra.taskId === 'string' ? extra.taskId : null,
        });
      });
    } catch {
      /* اقدام روی اعلان حیاتی نیست */
    }
  })();
  return () => {
    void handle?.then((h) => h.remove()).catch(() => undefined);
  };
}

/**
 * کارام — پل یادآور بومی (فاز ۴) — تنها لایه‌ای که با @capacitor/local-notifications حرف می‌زند
 *
 *  - وب: همه‌ی توابع بی‌عمل‌اند (پلاگین با import پویا فقط در اپ اندروید بارگذاری می‌شود —
 *    باندل وب هرگز کد پلاگین را نمی‌گیرد).
 *  - هر خطا گرفته می‌شود؛ یادآور هرگز نباید جریان اصلی اپ را بشکند.
 *  - کانال فارسی «یادآور کارام» با اهمیت بالا (صدا + لرزش) — یک‌بار ساخته می‌شود (idempotent).
 *  - بازیابی بعد از ری‌استارت (BOOT_COMPLETED) را گیرنده‌ی خودِ پلاگین انجام می‌دهد
 *    (LocalNotificationRestoreReceiver در مانیفست پلاگین) — اینجا کار اضافه‌ای نیست.
 */

import { isNativeApp } from '@/lib/native';
import type { ReminderScheduleEntry } from '@/lib/reminders';

/** شناسه‌ی کانال اعلان — در تنظیمات اندروید با همین نام دیده می‌شود */
export const REMINDER_CHANNEL_ID = 'karam-reminders';

/** رنگ آیکن اعلان — هم‌رنگ هویت بصری کارام (teal) */
export const REMINDER_ICON_COLOR = '#00685F';

type LNModule = typeof import('@capacitor/local-notifications');

let cachedModule: LNModule | null = null;
let channelReady = false;

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

/** شناسه‌های زنگ‌های در صف سیستم‌عامل */
export async function pendingReminderIds(): Promise<number[]> {
  const m = await ln();
  if (!m) return [];
  try {
    const res = await m.LocalNotifications.getPending();
    return res.notifications.map((n) => n.id);
  } catch {
    return [];
  }
}

/** ثبت زنگ‌ها — دقیق (allowWhileIdle) در کانال فارسی با آیکن اختصاصی */
export async function scheduleReminderAlarms(entries: ReminderScheduleEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  const m = await ln();
  if (!m) return false;
  try {
    await ensureReminderChannel();
    await m.LocalNotifications.schedule({
      notifications: entries.map((e) => ({
        id: e.notifId,
        title: e.title,
        body: e.body,
        schedule: { at: new Date(e.fireAtMs), allowWhileIdle: true },
        channelId: REMINDER_CHANNEL_ID,
        smallIcon: 'ic_stat_karam',
        iconColor: REMINDER_ICON_COLOR,
        extra: { taskId: e.taskId },
      })),
    });
    return true;
  } catch {
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
    /* بی‌صدا */
  }
}

/** پاک‌سازی همه‌ی زنگ‌های دستگاه (خروج از حساب / خاموش‌کردن اعلان‌ها) */
export async function cancelAllReminderAlarms(): Promise<void> {
  const ids = await pendingReminderIds();
  await cancelReminderAlarms(ids);
}

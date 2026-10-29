/**
 * کارام — برنامه‌ریز خالص یادآور (ممیزی یادآور — فاز ۲)
 *
 * این ماژول عمداً «خالص» است: هیچ وابستگی به Capacitor/IndexedDB/شبکه ندارد تا
 * با ساعتِ شبیه‌سازی‌شده قابل تست باشد. زمان‌بند واقعی (reminderScheduler) همین
 * توابع را با وضعیت سیستم‌عامل ترکیب می‌کند.
 *
 * محتوا:
 *  - resolveReminderPlan: تصمیم قطعی «چه چیزی به سیستم‌عامل برود» — شامل «بازسنجی
 *    کامل سرد» (رفع باگ آپدیت APK/force-stop: آلارم‌های AlarmManager پاک می‌شوند ولی
 *    storage پلاگین می‌ماند → دیفرانسول ساده «بدون‌تغییر» تصمیم می‌گیرد و زنگ‌ها
 *    هرگز دیگر ثبت نمی‌شوند؛ راه‌حل: در شروع هر فرایند لغو همه + ثبت همه از روی داده).
 *  - رجیستری snooze («۱۰ دقیقه دیگر»): ورودی‌ها مثل زنگ اصلی در برنامه ادغام می‌شوند؛
 *    انجام/حذف کار یا گذشتن زمان، ورودی را حذف می‌کند و دیفرانسول زنگِ یتیم را لغو می‌کند.
 *  - مسیریابی اقدام روی اعلان («انجام شد» / «۱۰ دقیقه دیگر» / ضربه به بدنه).
 */

import type { TaskEntity } from '@/types';
import {
  diffReminderSchedules,
  scheduleFingerprint,
  stableNotificationId,
  truncateTitle,
  reminderBody,
} from '@/lib/reminders';
import type { ReminderScheduleEntry } from '@/lib/reminders';

/* ------------------------------------------------------------------ */
/* برنامه‌ریز خالص                                                    */
/* ------------------------------------------------------------------ */

export interface ReminderPlanInput {
  /** شناسه‌های در صف سیستم‌عامل (getPending) */
  currentIds: number[];
  /** برنامه‌ی هدف (زنگ‌های کار + snooze) — وقتی alertsOn=false نادیده گرفته می‌شود */
  next: ReminderScheduleEntry[];
  alertsOn: boolean;
  /** بازسنجی کامل سرد: لغو همه + ثبت همه (شروع فرایند / آپدیت APK / force-stop) */
  fullReschedule: boolean;
}

export interface ReminderPlan {
  cancelIds: number[];
  toSchedule: ReminderScheduleEntry[];
  fingerprint: string;
  /** هیچ تماسی با سیستم‌عامل لازم نیست */
  noop: boolean;
}

/** تصمیم قطعی «چه چیزی به سیستم‌عامل برود» — خالص و قابل تست */
export function resolveReminderPlan(input: ReminderPlanInput): ReminderPlan {
  const fp = scheduleFingerprint(input.alertsOn ? input.next : [], input.alertsOn);
  if (!input.alertsOn) {
    return {
      cancelIds: [...input.currentIds],
      toSchedule: [],
      fingerprint: fp,
      noop: input.currentIds.length === 0,
    };
  }
  if (input.fullReschedule) {
    return {
      cancelIds: [...input.currentIds],
      toSchedule: input.next,
      fingerprint: fp,
      noop: input.currentIds.length === 0 && input.next.length === 0,
    };
  }
  const { cancelIds, toSchedule } = diffReminderSchedules(input.currentIds, input.next);
  return {
    cancelIds,
    toSchedule,
    fingerprint: fp,
    noop: cancelIds.length === 0 && toSchedule.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* رجیستری snooze («۱۰ دقیقه دیگر»)                                   */
/* ------------------------------------------------------------------ */

export interface SnoozeEntry {
  taskId: string;
  fireAtMs: number;
  title: string;
  body: string;
}

const snoozeRegistry = new Map<string, SnoozeEntry>(); // کلید = taskId

/** شناسه‌ی زنگ snooze — قطعی و متمایز از زنگ اصلی همان کار */
export function snoozeNotifId(taskId: string, fireAtMs: number, title: string): number {
  return stableNotificationId(`snooze@${taskId}`, fireAtMs, title);
}

/** ورودی‌های snooze فعال — فقط برای کارِ زنده‌ی ناتمام و آینده؛ بقیه حذف می‌شوند */
export function snoozeEntries(tasks: Pick<TaskEntity, 'id' | 'deletedAt' | 'completedAt'>[], nowMs: number): ReminderScheduleEntry[] {
  const alive = new Set(tasks.filter((t) => !t.deletedAt && !t.completedAt).map((t) => t.id));
  const out: ReminderScheduleEntry[] = [];
  for (const [taskId, s] of [...snoozeRegistry]) {
    if (!alive.has(taskId) || s.fireAtMs <= nowMs) {
      snoozeRegistry.delete(taskId); // انجام/حذف/گذشته → حذف → دیفرانسول زنگش را لغو می‌کند
      continue;
    }
    out.push({
      notifId: snoozeNotifId(taskId, s.fireAtMs, s.title),
      taskId,
      title: s.title,
      body: s.body,
      fireAtMs: s.fireAtMs,
      reminderMinutes: -1, // نشانه‌ی snooze (برای شفافیت/دیباگ)
    });
  }
  return out;
}

/** ثبت snooze جدید (از دکمه‌ی «۱۰ دقیقه دیگر» روی اعلان) */
export function registerSnooze(taskId: string, title: string, dueDate: string, dueTime: string | null, fireAtMs: number): void {
  snoozeRegistry.set(taskId, {
    taskId,
    fireAtMs,
    title: truncateTitle(title),
    body: reminderBody(dueDate, dueTime),
  });
}

/** خالی‌کردن رجیستری (خروج از حساب / تست) */
export function clearSnoozes(): void {
  snoozeRegistry.clear();
}

/** تعداد فعلی ورودی‌های رجیستری (برای تست/تشخیص) */
export function snoozeCount(): number {
  return snoozeRegistry.size;
}

/** تصویر لحظه‌ای رجیستری برای پایداری در prefs */
export function snoozeSnapshot(): SnoozeEntry[] {
  return [...snoozeRegistry.values()];
}

/** بازگرداندن ورودی پایدارشده از prefs — همان مقادیر، بدون بازسازی عنوان/متن */
export function restoreSnooze(entry: SnoozeEntry): void {
  snoozeRegistry.set(entry.taskId, entry);
}

/* ------------------------------------------------------------------ */
/* مسیریابی اقدام روی اعلان                                            */
/* ------------------------------------------------------------------ */

export interface ReminderActionHandlers {
  /** «انجام شد» — کار تیک می‌خورد (refresh/syncReminders زنگ‌های باقی آن کار را لغو می‌کنند) */
  onDone: (taskId: string) => void;
  /** «۱۰ دقیقه دیگر» */
  onSnooze10: (taskId: string) => void;
  /** ضربه به بدنه‌ی اعلان — بازکردن جزئیات کار */
  onOpen: (taskId: string) => void;
}

let actionHandlers: ReminderActionHandlers | null = null;

/** وصل‌کردن شنونده‌های اقدام — از App.tsx (دسترسی به store) */
export function setReminderActionHandlers(handlers: ReminderActionHandlers | null): void {
  actionHandlers = handlers;
}

/** مصرف‌کننده‌ی رویداد پل — مسیریابی به شنونده‌ها (پلاگین خودش اعلان را بعد از اقدام می‌بندد) */
export function handleReminderAction(actionId: string, taskId: string | null): void {
  try {
    if (!taskId) return;
    if (actionId === 'done') actionHandlers?.onDone(taskId);
    else if (actionId === 'snooze10') actionHandlers?.onSnooze10(taskId);
    else if (actionId === 'tap') actionHandlers?.onOpen(taskId);
  } catch {
    /* اقدام روی اعلان هرگز اپ را نمی‌شکند */
  }
}

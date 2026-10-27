/**
 * کارام — موتور زمان‌بندی یادآور (فاز ۴) — توابع خالص، بدون هیچ وابستگی به Capacitor
 *
 * قرارداد (تصمیم سند ممیزی بخش «هـ»): یادآور موجودیت مستقل سینک نمی‌شود؛
 * لحظه‌ی زنگ در هر دستگاه به‌صورت قطعی از فیلدهای سینک‌شده‌ی خود کار ساخته می‌شود:
 *
 *     fireAt = (dueDate + dueTime — یا لنگر ۰۹:۰۰ محلی) − reminderMinutes
 *
 * قواعد قطعی:
 *  - کارِ انجام‌شده یا حذف‌شده زنگ ندارد.
 *  - کار بدون سررسید زنگ ندارد (reminderMinutes فقط بعد از تعیین سررسید فعال می‌شود).
 *  - زنگِ گذشته هیچ‌وقت عقب‌سازی نمی‌شود؛ کارهای تکرارشونده بعد از «انجام» نوبت بعدی
 *    با شناسه‌ی نو می‌سازند و همان‌جا دوباره زمان‌بندی می‌شوند (قلاب refresh).
 *  - تاریخ/ساعت سررسید «محلی» تفسیر می‌شود (مثل بقیه‌ی اپ)؛ زنگ همان ساعت محلی می‌زند.
 *  - سقف REMINDER_CAP: نزدیک‌ترین ۶۰ زنگ برنامه‌ریزی می‌شود (رفتار قابل پیش‌بینی و
 *    بسیار زیر سقف آلارم اندروید) — دورترین‌ها حذف می‌شوند، هیچ زنگی جابجا نمی‌شود.
 *  - شناسه‌ی نوتیفیکیشن پایدار و حساس به محتواست: تغییر زمان/عنوان = شناسه‌ی نو =
 *    جایگزینی هوشمند در دیفرانسیل؛ وضعیت بی‌تغییر = بدون تماس به سیستم‌عامل.
 */

import type { TaskEntity } from '@/types';
import { faShort, faTime } from '@/lib/format';

/** سقف زنگ‌های هم‌زمان — نزدیک‌ترین ۶۰ زنگ */
export const REMINDER_CAP = 60;

/** لنگر ساعت سررسید وقتی کار ساعت ندارد — ۰۹:۰۰ محلی */
export const NO_TIME_ANCHOR_MINUTES = 9 * 60;

/** حداکثر طول عنوان نوتیفیکیشن (نمایش کامل‌تر در سینی اعلان) */
export const REMINDER_TITLE_MAX = 80;

export interface ReminderScheduleEntry {
  /** شناسه‌ی پایدار نوتیفیکیشن (int مثبت ۳۱بیتی) — از taskId + fireAt + عنوان */
  notifId: number;
  taskId: string;
  /** عنوان نوتیفیکیشن — عنوان کارِ کوتاه‌شده */
  title: string;
  /** متن نوتیفیکیشن — سررسید فارسی */
  body: string;
  fireAtMs: number;
  /** چند دقیقه قبل از سررسید (برای شفافیت/دیباگ) */
  reminderMinutes: number;
}

/** «YYYY-MM-DD» + «HH:mm» (یا لنگر) → مِی‌ثانیه‌ی محلی؛ ورودی خراب = null */
export function parseDueLocalMs(dueDate: string, dueTime: string | null): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!dm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let hh = NO_TIME_ANCHOR_MINUTES / 60;
  let mm = NO_TIME_ANCHOR_MINUTES % 60;
  if (dueTime) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(dueTime);
    if (!tm) return null;
    const h = Number(tm[1]);
    const m = Number(tm[2]);
    if (h > 23 || m > 59) return null;
    hh = h;
    mm = m;
  }
  return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * لحظه‌ی زنگ یک کار — null یعنی این کار زنگ ندارد.
 * nowMs پارامتر است تا تابع خالص و قابل‌تست بماند.
 */
export function computeFireAtMs(task: Pick<TaskEntity, 'deletedAt' | 'completedAt' | 'reminderMinutes' | 'dueDate' | 'dueTime'>, nowMs: number): number | null {
  if (task.deletedAt || task.completedAt) return null;
  if (task.reminderMinutes === null || task.reminderMinutes === undefined) return null;
  if (!task.dueDate) return null;
  const dueMs = parseDueLocalMs(task.dueDate, task.dueTime);
  if (dueMs === null) return null;
  const fireAt = dueMs - task.reminderMinutes * 60_000;
  if (fireAt <= nowMs) return null; // گذشته — هیچ زنگی عقب‌سازی نمی‌شود
  return fireAt;
}

/** FNV-1a ۳۲بیتی → int مثبت ۳۱بیتی (پایدار، بدون وابستگی به ترتیب کلیدها) */
export function stableNotificationId(taskId: string, fireAtMs: number, title: string): number {
  const input = `${taskId}@${fireAtMs}@${title}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/** عنوان کوتاه‌شده با سه‌نقطه‌ی فارسی */
export function truncateTitle(title: string, max = REMINDER_TITLE_MAX): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

/** متن نوتیفیکیشن — «سررسید: شنبه ۵ آبان — ساعت ۱۷:۰۰» (تاریخ شمسی، آفلاین با Intl) */
export function reminderBody(dueDate: string, dueTime: string | null): string {
  const dueMs = parseDueLocalMs(dueDate, dueTime);
  if (dueMs === null) return 'سررسید کار فرا رسیده است';
  const anchorTime = dueTime ?? `${String(Math.floor(NO_TIME_ANCHOR_MINUTES / 60)).padStart(2, '0')}:${String(NO_TIME_ANCHOR_MINUTES % 60).padStart(2, '0')}`;
  return `سررسید: ${faShort(new Date(dueMs))} — ساعت ${faTime(anchorTime)}`;
}

/** ساختن برنامه‌ی کامل زنگ‌ها از فهرست کارها — خروجی مرتب و محدود به سقف */
export function buildReminderSchedule(
  tasks: Pick<TaskEntity, 'id' | 'title' | 'deletedAt' | 'completedAt' | 'reminderMinutes' | 'dueDate' | 'dueTime'>[],
  opts?: { nowMs?: number; cap?: number },
): ReminderScheduleEntry[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const cap = opts?.cap ?? REMINDER_CAP;
  const out: ReminderScheduleEntry[] = [];
  for (const t of tasks) {
    const fireAtMs = computeFireAtMs(t, nowMs);
    if (fireAtMs === null) continue;
    const title = truncateTitle(t.title);
    if (!title) continue;
    out.push({
      notifId: stableNotificationId(t.id, fireAtMs, title),
      taskId: t.id,
      title,
      body: reminderBody(t.dueDate as string, t.dueTime),
      fireAtMs,
      reminderMinutes: t.reminderMinutes as number,
    });
  }
  // مرتب‌سازی قطعی: زمان زنگ، سپس شناسه‌ی کار (تساوی‌ها هیچ‌وقت نامعین نمی‌مانند)
  out.sort((a, b) => a.fireAtMs - b.fireAtMs || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  return out.slice(0, cap);
}

/** دیفرانسیل زنگ‌ها — فقط تفاوت به سیستم‌عامل می‌رود (بدون ریست کل آلارم‌ها) */
export function diffReminderSchedules(
  currentIds: number[],
  next: ReminderScheduleEntry[],
): { cancelIds: number[]; toSchedule: ReminderScheduleEntry[] } {
  const nextIds = new Set(next.map((e) => e.notifId));
  const currentSet = new Set(currentIds);
  return {
    cancelIds: currentIds.filter((id) => !nextIds.has(id)),
    toSchedule: next.filter((e) => !currentSet.has(e.notifId)),
  };
}

/** اثر انگشت برنامه — تغییری نکرده بود، هیچ تماسی با سیستم‌عامل زده نمی‌شود */
export function scheduleFingerprint(next: ReminderScheduleEntry[], alertsOn: boolean): string {
  return `${alertsOn ? 'on' : 'off'}|${next.map((e) => e.notifId).join(',')}`;
}

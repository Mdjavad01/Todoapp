/**
 * کارام — تست‌های ممیزی یادآور (فاز ۲ — ساعتِ شبیه‌سازی‌شده، توابع خالص)
 *
 * اجرا:  cd frontend && bun test tests/reminders-audit.test.ts
 *
 * پوشش:
 *   ۱) ویرایش‌های پیوسته — بدون زنگ تکراری/یتیم (شبیه‌ساز صف سیستم‌عامل)
 *   ۲) ویرایش عنوان (شناسه نو) و ویرایش بی‌ربط (هیچ تماسی)
 *   ۳) انجام/حذف کار → لغو همه‌ی زنگ‌های همان کار
 *   ۴) زنجیره‌ی تکرار → یادآور نوبت بعدی (روزانه، ماهانه‌ی کلمپ، سالانه‌ی اسفند،
 *      روزهای کاری، سفارشی هفتگی)
 *   ۵) سقف ۶۰ — دورترین‌ها لغو می‌شوند
 *   ۶) بازسنجی کامل سرد (رفع باگ آپدیت APK/force-stop) — even when pending==next
 *   ۷) کلید اعلان‌ها خاموش → همه لغو
 *   ۸) سینک — رکورد جدیدتر سرور → فقط تفاوت؛ رکورد قدیمی‌تر → هیچ تماسی
 *   ۹) snooze («۱۰ دقیقه دیگر») — ثبت/انجام/حذف/گذشت زمان/قطعیت/پایداری
 *  ۱۰) مسیریابی اقدام اعلان («انجام شد»/«۱۰ دقیقه دیگر»/ضربه)
 *  ۱۱) منطقه‌ی زمانی — تفسیر محلی + تغییر TZ در زمان اجرا → بازثبت با شناسه‌ی نو
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildReminderSchedule,
  diffReminderSchedules,
  parseDueLocalMs,
  REMINDER_CAP,
  stableNotificationId,
} from '@/lib/reminders';
import {
  clearSnoozes,
  handleReminderAction,
  registerSnooze,
  resolveReminderPlan,
  restoreSnooze,
  setReminderActionHandlers,
  snoozeCount,
  snoozeEntries,
  snoozeNotifId,
  snoozeSnapshot,
} from '@/lib/reminderPlan';
import { nextOccurrence, type RepeatMeta } from '@/lib/repeat';
import { revTupleStrictlyNewer } from '@/sync/lww';
import type { TaskEntity } from '@/types';

/** «الان» ثابت — ۲۰۲۶-۱۰-۲۸ ساعت ۱۲:۰۰ محلی */
const NOW = new Date(2026, 9, 28, 12, 0, 0, 0).getTime();

function mk(over: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: over.id ?? 't-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    listId: 'l-1',
    title: 'خرید نان',
    notes: '',
    priority: 'normal',
    dueDate: null,
    dueTime: null,
    reminderMinutes: null,
    repeat: 'none',
    starred: false,
    repeatMeta: null,
    completedAt: null,
    ...over,
  };
}

/** شبیه‌ساز صف سیستم‌عامل — apply برنامه و بازگرداندن وضعیت جدید صف */
function applyPlan(pending: number[], next: ReturnType<typeof buildReminderSchedule>, alertsOn: boolean, fullReschedule = false) {
  const plan = resolveReminderPlan({ currentIds: pending, next, alertsOn, fullReschedule });
  const set = new Set(pending);
  for (const id of plan.cancelIds) set.delete(id);
  for (const e of plan.toSchedule) set.add(e.notifId);
  return { pending: [...set], plan };
}

beforeEach(() => {
  clearSnoozes();
});

/* ---------------- ۱) ویرایش‌های پیوسته — بدون تکراری/یتیم ---------------- */
describe('۱) ویرایش‌های پیوسته — جایگزینی تمیز', () => {
  test('۵ ویرایش متوالی زمان سررسید → در هر گام فقط «لغو قبلی + ثبت جدید» و در پایان دقیقاً یک زنگ', () => {
    let task = mk({ dueDate: '2026-11-05', dueTime: '16:00', reminderMinutes: 60 });
    let pending: number[] = [];
    let scheduled: number[] = [];

    // شروع سرد: بازسنجی کامل
    let r = applyPlan(pending, buildReminderSchedule([task], { nowMs: NOW }), true, true);
    pending = r.pending;
    scheduled = pending.slice();

    const times = ['17:00', '18:30', '09:15', '21:00', '14:45'];
    for (const tm of times) {
      task = { ...task, dueTime: tm };
      const next = buildReminderSchedule([task], { nowMs: NOW });
      r = applyPlan(pending, next, true);
      // دقیقاً یکی لغو و دقیقاً یکی ثبت می‌شود (جابجایی)
      expect(r.plan.cancelIds.length).toBe(1);
      expect(r.plan.toSchedule.length).toBe(1);
      expect(r.plan.cancelIds[0]).not.toBe(r.plan.toSchedule[0].notifId);
      pending = r.pending;
      scheduled = [...scheduled, ...r.plan.toSchedule.map((e) => e.notifId)];
    }

    // هیچ زنگ تکراری/یتیمی باقی نمانده است؛ زنگِ نهایی همان برنامه‌ی کار نهایی است
    expect(new Set(pending).size).toBe(1);
    const uniqueScheduled = new Set(scheduled);
    expect(uniqueScheduled.size).toBe(scheduled.length); // هیچ ثبت دوباره‌ای رخ نداده
    const final = buildReminderSchedule([task], { nowMs: NOW });
    expect(pending[0]).toBe(final[0].notifId);
  });

  test('ویرایش عنوان (زمان ثابت) → شناسه‌ی نو → لغو+ثبت', () => {
    const before = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 30 })], { nowMs: NOW });
    const after = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 30, title: 'خرید نان سنگک' })], { nowMs: NOW });
    expect(before[0].notifId).not.toBe(after[0].notifId); // شناسه حساس به عنوان است
    const { plan } = applyPlan([before[0].notifId], after, true);
    expect(plan.cancelIds).toEqual([before[0].notifId]);
    expect(plan.toSchedule.map((e) => e.notifId)).toEqual([after[0].notifId]);
  });

  test('ویرایش بی‌ربط (یادداشت/اولویت) → هیچ تماسی با سیستم‌عامل', () => {
    const before = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 30, notes: 'a' })], { nowMs: NOW });
    const after = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 30, notes: 'b', priority: 'high' })], { nowMs: NOW });
    expect(after.map((e) => e.notifId)).toEqual(before.map((e) => e.notifId));
    const { plan } = applyPlan(before.map((e) => e.notifId), after, true);
    expect(plan.noop).toBe(true);
    expect(plan.cancelIds.length).toBe(0);
    expect(plan.toSchedule.length).toBe(0);
  });
});

/* ---------------- ۳) انجام/حذف کار → لغو زنگ‌ها ---------------- */
describe('۳) انجام/حذف کار — همه‌ی زنگ‌های همان کار لغو می‌شوند', () => {
  test('انجام‌شده از برنامه می‌افتد و زنگش لغو می‌شود', () => {
    const t = mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const scheduled = buildReminderSchedule([t], { nowMs: NOW });
    expect(scheduled.length).toBe(1);
    const { pending, plan } = applyPlan(scheduled.map((e) => e.notifId), buildReminderSchedule([{ ...t, completedAt: '2026-10-28T09:00:00.000Z' }], { nowMs: NOW }), true);
    expect(plan.cancelIds).toEqual(scheduled.map((e) => e.notifId));
    expect(pending.length).toBe(0);
  });

  test('حذف نرم هم همان رفتار را دارد', () => {
    const t = mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const scheduled = buildReminderSchedule([t], { nowMs: NOW });
    const { pending } = applyPlan(scheduled.map((e) => e.notifId), buildReminderSchedule([{ ...t, deletedAt: '2026-10-28T09:00:00.000Z' }], { nowMs: NOW }), true);
    expect(pending.length).toBe(0);
  });
});

/* ---------------- ۴) زنجیره‌ی تکرار → یادآور نوبت بعدی ---------------- */
describe('۴) تکرار → نوبت بعدی با یادآور نو (لغو قدیمی + ثبت جدید)', () => {
  const completeAndChain = (task: TaskEntity) => {
    const oldSchedule = buildReminderSchedule([task], { nowMs: NOW });
    const nextDue = nextOccurrence(task.dueDate, task.repeat, task.repeatMeta, new Date(NOW));
    expect(nextDue).not.toBeNull();
    const nextTask: TaskEntity = { ...task, id: 't-next', dueDate: nextDue, completedAt: null, createdAt: '', updatedAt: '' };
    const nextSchedule = buildReminderSchedule([nextTask], { nowMs: NOW });
    const { pending, plan } = applyPlan(oldSchedule.map((e) => e.notifId), nextSchedule, true);
    return { pending, plan, nextSchedule, nextDue };
  };

  test('روزانه: زنگ قدیمی لغو، زنگ فردا ثبت', () => {
    const t = mk({ dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 30, repeat: 'daily' });
    const { pending, plan, nextDue } = completeAndChain(t);
    expect(nextDue).toBe('2026-10-30');
    expect(plan.cancelIds.length).toBe(1);
    expect(pending.length).toBe(1);
    expect(plan.toSchedule[0].taskId).toBe('t-next');
  });

  test('ماهانه‌ی شمسی با کلمپ و آینده: ۳۰ مهر → ۳۰ آبان (زنگِ آینده ثبت می‌شود)', () => {
    const t = mk({ dueDate: '2026-10-22', dueTime: '09:00', reminderMinutes: 15, repeat: 'monthly' }); // ۳۰ مهر ۱۴۰۵
    const { plan, nextDue } = completeAndChain(t);
    expect(nextDue).toBe('2026-11-21'); // ۳۰ آبان ۱۴۰۵
    expect(plan.toSchedule.length).toBe(1);
    expect(plan.toSchedule[0].taskId).toBe('t-next');
  });

  test('سالانه: ۲۹ اسفند ۱۴۰۴ → ۲۹ اسفند ۱۴۰۵ (زنگ سال بعد ثبت می‌شود)', () => {
    const t = mk({ dueDate: '2026-03-20', dueTime: '08:00', reminderMinutes: 60, repeat: 'yearly' }); // ۲۹ اسفند ۱۴۰۴
    const { plan, nextDue } = completeAndChain(t);
    expect(nextDue).toBe('2027-03-20'); // ۲۹ اسفند ۱۴۰۵
    expect(plan.toSchedule.length).toBe(1);
  });

  test('سالانه: ۳۰ اسفند سال کبیسه (۱۴۰۳) → ۲۹ اسفند سال غیرکبیسه — نوبتِ محاسبه‌شده درست است', () => {
    const nextDue = nextOccurrence('2025-03-20', 'yearly', null, new Date(NOW)); // ۳۰ اسفند ۱۴۰۳
    expect(nextDue).toBe('2026-03-20'); // ۲۹ اسفند ۱۴۰۴ (کلمپ کبیسه)
  });

  test('روزهای کاری: از چهارشنبه → شنبه (پنج‌شنبه/جمعه پرش می‌شود)', () => {
    // 2026-10-28 چهارشنبه است
    const t = mk({ dueDate: '2026-10-28', dueTime: '17:00', reminderMinutes: 60, repeat: 'workdays' });
    const { nextDue } = completeAndChain(t);
    expect(nextDue).toBe('2026-10-31');
  });

  test('سفارشی: هر ۲ هفته در شنبه‌ها', () => {
    const meta: RepeatMeta = { every: 2, unit: 'week', days: [0] }; // ۰=شنبه
    const t = mk({ dueDate: '2026-10-31', dueTime: '10:00', reminderMinutes: 45, repeat: 'custom', repeatMeta: meta }); // شنبه
    const { plan, nextDue } = completeAndChain(t);
    expect(nextDue).toBe('2026-11-14'); // دو هفته بعد، همان شنبه
    expect(plan.toSchedule.length).toBe(1);
  });

  test('قطعیت: ورودی یکسان → زنجیره‌ی یکسان (بدون حالت پنهان)', () => {
    const t = mk({ dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 30, repeat: 'daily' });
    const a = completeAndChain(t);
    const b = completeAndChain(t);
    expect(a.nextSchedule).toEqual(b.nextSchedule);
  });
});

/* ---------------- ۵) سقف ۶۰ ---------------- */
describe('۵) سقف ۶۰ — دورترین‌ها لغو می‌شوند، نزدیک‌ترین‌ها می‌مانند', () => {
  test('۷۰ کار → ۶۰ نزدیک‌ترین؛ لغوی‌ها دقیقاً ۱۰ دورترین', () => {
    const tasks: TaskEntity[] = [];
    for (let i = 0; i < REMINDER_CAP + 10; i++) {
      const day = 1 + (i % 27);
      tasks.push(mk({ id: `t-${String(i).padStart(2, '0')}`, dueDate: `2026-11-${String(day).padStart(2, '0')}`, dueTime: '09:00', reminderMinutes: 0 }));
    }
    const capped = buildReminderSchedule(tasks, { nowMs: NOW });
    expect(capped.length).toBe(REMINDER_CAP);
    // حالت قبلی: فرض ۷۰ زنگ ثبت‌شده (مثلاً قبل از سخت‌گیری سقف در نسخه‌ی قبلی)
    const allIds = new Set<number>();
    for (const t of tasks) {
      const fire = parseDueLocalMs(t.dueDate!, t.dueTime)!;
      allIds.add(stableNotificationId(t.id, fire, t.title));
    }
    expect(allIds.size).toBe(REMINDER_CAP + 10);
    const { pending, plan } = applyPlan([...allIds], capped, true);
    expect(plan.cancelIds.length).toBe(10);
    expect(pending.length).toBe(REMINDER_CAP);
    // همه‌ی لغوها خارج از برنامه‌ی فعلی‌اند
    for (const id of plan.cancelIds) {
      expect(capped.some((e) => e.notifId === id)).toBe(false);
    }
  });
});

/* ---------------- ۶) بازسنجی کامل سرد (باگ آپدیت APK) ---------------- */
describe('۶) بازسنجی کامل سرد — even when pending == next', () => {
  test('با صفِ کاملاً منطبق، fullReschedule=true همه را لغو و از نو ثبت می‌کند (خودترمیمی)', () => {
    const t = mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const next = buildReminderSchedule([t], { nowMs: NOW });
    const pending = next.map((e) => e.notifId); // storage پلاگین می‌گوید «ثبت شده»
    const plan = resolveReminderPlan({ currentIds: pending, next, alertsOn: true, fullReschedule: true });
    expect(plan.cancelIds).toEqual(pending);
    expect(plan.toSchedule.map((e) => e.notifId)).toEqual(pending);
    expect(plan.noop).toBe(false);
  });

  test('بعد از بازسنجی کامل، همگام‌سازی عادی noop است (هیچ تماسی تکراری)', () => {
    const t = mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const next = buildReminderSchedule([t], { nowMs: NOW });
    const first = resolveReminderPlan({ currentIds: [], next, alertsOn: true, fullReschedule: true });
    expect(first.noop).toBe(false);
    const second = resolveReminderPlan({ currentIds: next.map((e) => e.notifId), next, alertsOn: true, fullReschedule: false });
    expect(second.noop).toBe(true);
  });
});

/* ---------------- ۷) کلید اعلان‌ها خاموش ---------------- */
describe('۷) alerts=false — همه‌ی زنگ‌های صف لغو و هیچ زنگی ثبت نمی‌شود', () => {
  test('خاموش‌کردن کلید', () => {
    const pending = [11, 22, 33];
    const plan = resolveReminderPlan({ currentIds: pending, next: [], alertsOn: false, fullReschedule: false });
    expect(plan.cancelIds.sort()).toEqual([11, 22, 33]);
    expect(plan.toSchedule.length).toBe(0);
    expect(plan.fingerprint.startsWith('off|')).toBe(true);
  });
});

/* ---------------- ۸) سینک ---------------- */
describe('۸) سینک — اعمال رکورد سرور و اثرش روی زنگ‌ها', () => {
  test('رکورد جدیدتر سرور (تغییر ساعت کار) → فقط تفاوت به سیستم‌عامل می‌رود', () => {
    const localTask = mk({ updatedAt: '2026-10-28T10:00:00.000Z', dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const serverTask = { ...localTask, updatedAt: '2026-10-28T11:00:00.000Z', rev: 3, dueTime: '20:00' };
    expect(revTupleStrictlyNewer(serverTask, localTask)).toBe(true); // رکورد سرور برنده است

    const before = buildReminderSchedule([localTask], { nowMs: NOW });
    const after = buildReminderSchedule([serverTask], { nowMs: NOW });
    const { plan, pending } = applyPlan(before.map((e) => e.notifId), after, true);
    expect(plan.cancelIds).toEqual(before.map((e) => e.notifId));
    expect(plan.toSchedule.length).toBe(1);
    expect(pending.length).toBe(1);
  });

  test('رکورد قدیمی‌تر سرور اعمال نمی‌شود → برنامه بدون تغییر → هیچ تماسی', () => {
    const localTask = mk({ updatedAt: '2026-10-28T11:00:00.000Z', rev: 3, dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });
    const staleServer = { ...localTask, updatedAt: '2026-10-28T10:00:00.000Z', rev: 2, dueTime: '20:00' };
    expect(revTupleStrictlyNewer(staleServer, localTask)).toBe(false); // اعمال نمی‌شود
    const schedule = buildReminderSchedule([localTask], { nowMs: NOW });
    const { plan } = applyPlan(schedule.map((e) => e.notifId), schedule, true);
    expect(plan.noop).toBe(true);
  });
});

/* ---------------- ۹) snooze («۱۰ دقیقه دیگر») ---------------- */
describe('۹) snooze — ثبت، ادغام در برنامه، لغو با انجام/حذف/گذشت زمان', () => {
  const task = () => mk({ id: 't-snooze', dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 60 });

  test('ثبت snooze → ورودی فعال با شناسه‌ی متمایز از زنگ اصلی؛ در برنامه‌ی ادغامی ثبت می‌شود', () => {
    const t = task();
    const fireAt = NOW + 10 * 60_000;
    registerSnooze(t.id, t.title, t.dueDate!, t.dueTime, fireAt);
    expect(snoozeCount()).toBe(1);
    const base = buildReminderSchedule([t], { nowMs: NOW });
    const snoozes = snoozeEntries([t], NOW);
    expect(snoozes.length).toBe(1);
    expect(snoozes[0].notifId).toBe(snoozeNotifId(t.id, fireAt, t.title));
    expect(snoozes[0].notifId).not.toBe(base[0].notifId); // متمایز از زنگ اصلی

    const merged = [...base, ...snoozes];
    const { pending } = applyPlan([], merged, true, true);
    expect(pending.length).toBe(2); // زنگ اصلی + snooze
  });

  test('انجام شدن کار → ورودی snooze حذف و زنگش لغو می‌شود (بدون یتیم)', () => {
    const t = task();
    registerSnooze(t.id, t.title, t.dueDate!, t.dueTime, NOW + 10 * 60_000);
    const withSnooze = [...buildReminderSchedule([t], { nowMs: NOW }), ...snoozeEntries([t], NOW)];
    const pendingBefore = withSnooze.map((e) => e.notifId);
    // کار انجام شد
    const done = [{ ...t, completedAt: '2026-10-28T12:05:00.000Z' }];
    const nextSchedule = snoozeEntries(done, NOW); // کار انجام‌شده → ورودی حذف
    const plan = resolveReminderPlan({ currentIds: pendingBefore, next: nextSchedule, alertsOn: true, fullReschedule: false });
    expect(plan.cancelIds.length).toBe(2); // زنگ اصلی + snooze هر دو لغو
    expect(snoozeCount()).toBe(0);
  });

  test('حذف کار هم همین رفتار را دارد', () => {
    const t = task();
    registerSnooze(t.id, t.title, t.dueDate!, t.dueTime, NOW + 10 * 60_000);
    const before = snoozeEntries([t], NOW);
    expect(before.length).toBe(1);
    const after = snoozeEntries([{ ...t, deletedAt: '2026-10-28T12:05:00.000Z' }], NOW);
    expect(after.length).toBe(0);
  });

  test('گذشتن زمان (زنگ snooze رسیده) → ورودی خودبه‌خود می‌افتد', () => {
    const t = task();
    registerSnooze(t.id, t.title, t.dueDate!, t.dueTime, NOW + 10 * 60_000);
    const before = snoozeEntries([t], NOW);
    expect(before.length).toBe(1);
    const later = snoozeEntries([t], NOW + 11 * 60_000);
    expect(later.length).toBe(0);
  });

  test('قطعیت شناسه و پایداری (snapshot/restore) — رفرش اپ snooze را از دست نمی‌دهد', () => {
    const t = task();
    registerSnooze(t.id, t.title, t.dueDate!, t.dueTime, NOW + 10 * 60_000);
    const snap = snoozeSnapshot();
    expect(snap.length).toBe(1);
    clearSnoozes();
    expect(snoozeCount()).toBe(0);
    restoreSnooze(snap[0]);
    const again = snoozeEntries([t], NOW);
    expect(again.length).toBe(1);
    expect(again[0].notifId).toBe(snoozeNotifId(t.id, NOW + 10 * 60_000, t.title));
  });
});

/* ---------------- ۱۰) مسیریابی اقدام اعلان ---------------- */
describe('۱۰) handleReminderAction — مسیریابی «انجام شد»/«۱۰ دقیقه دیگر»/ضربه', () => {
  test('هر سه مسیر درست رد می‌شوند؛ اقدام ناشناخته و taskId تهی نادیده گرفته می‌شود؛ خطای شنونده اپ را نمی‌شکند', () => {
    const hits: string[] = [];
    handleReminderAction('done', 'A');
    handleReminderAction('snooze10', 'B');
    handleReminderAction('tap', 'C');
    handleReminderAction('unknown', 'D');
    handleReminderAction('done', null);
    // هنوز هیچ شنونده‌ای وصل نیست — باید بدون خطا رد شده باشد

    setReminderActionHandlers({
      onDone: (id) => {
        hits.push(`done:${id}`);
        throw new Error('خطای عمدی شنونده'); // نباید بیرون بپرد
      },
      onSnooze10: (id) => hits.push(`snooze:${id}`),
      onOpen: (id) => hits.push(`open:${id}`),
    });
    handleReminderAction('done', 'A');
    handleReminderAction('snooze10', 'B');
    handleReminderAction('tap', 'C');
    handleReminderAction('done', null);
    handleReminderAction('swipe', 'D');
    expect(hits).toEqual(['done:A', 'snooze:B', 'open:C']); // push قبل از پرتاب خطا ثبت می‌شود؛ خطا از handleReminderAction نمی‌گذرد
    setReminderActionHandlers(null);
  });
});

/* ---------------- ۱۱) منطقه‌ی زمانی / DST ---------------- */
describe('۱۱) منطقه‌ی زمانی — تفسیر محلی و تغییر TZ در زمان اجرا', () => {
  test('تاریخ/ساعت به «ساعت محلی» تفسیر می‌شود (تهران — بدون DST از ۱۴۰۱)', () => {
    const ms = parseDueLocalMs('2026-11-05', '17:00');
    expect(ms).toBe(new Date(2026, 10, 5, 17, 0, 0, 0).getTime());
    // اسفند ۳۰ سال کبیسه هم ساعت محلی معتبر می‌سازد
    expect(parseDueLocalMs('2025-03-20', '09:00')).toBe(new Date(2025, 2, 20, 9, 0).getTime());
  });

  test('تغییر منطقه‌ی زمانی دستگاه در زمان اجرا → همان ساعت دیواری، مِی متفاوت → شناسه‌ی نو → لغو+ثبت (مسیر resume/force)', () => {
    const prevTz = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tehran';
      const tehran = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 0 })], { nowMs: NOW });
      expect(tehran.length).toBe(1);

      process.env.TZ = 'America/New_York';
      const newYork = buildReminderSchedule([mk({ dueDate: '2026-11-05', dueTime: '17:00', reminderMinutes: 0 })], { nowMs: NOW });
      expect(newYork.length).toBe(1);
      // همان ساعت دیواری در TZ دیگر = لحظه‌ی مطلق متفاوت → شناسه‌ی متفاوت
      expect(newYork[0].fireAtMs).not.toBe(tehran[0].fireAtMs);
      expect(newYork[0].notifId).not.toBe(tehran[0].notifId);

      const { plan } = applyPlan(tehran.map((e) => e.notifId), newYork, true);
      expect(plan.cancelIds).toEqual(tehran.map((e) => e.notifId));
      expect(plan.toSchedule.map((e) => e.notifId)).toEqual(newYork.map((e) => e.notifId));
    } finally {
      process.env.TZ = prevTz;
    }
  });

  test('ساعتِ افتاده در گذار DST (TZ آمریکا) قطعی است و هیچ زنگی گم نمی‌شود', () => {
    const prevTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      // ۲۰۲۶-۰۳-۰۸ ساعت ۲:۳۰ وجود ندارد (جلو پریدن ساعت) — Date نرمال‌سازی می‌کند به ۳:۳۰
      const a = parseDueLocalMs('2026-03-08', '02:30');
      const b = parseDueLocalMs('2026-03-08', '02:30');
      expect(a).toBe(b); // قطعیت
      expect(a).not.toBeNull();
      expect(a).toBe(new Date(2026, 2, 8, 2, 30).getTime()); // همان نتیجه‌ی Date محلی — رفتار قابل پیش‌بینی
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

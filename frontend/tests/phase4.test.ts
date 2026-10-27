/**
 * کارام — تست موتور یادآور (فاز ۴ — توابع خالص lib/reminders.ts)
 *
 * اجرا:  cd frontend && bun test tests/phase4.test.ts
 *
 * پوشش:
 *   ۱) computeFireAtMs — قاعده‌ی قطعی fireAt = سررسید+ساعت (یا لنگر ۰۹:۰۰) − reminderMinutes
 *      با همه‌ی حالت‌های خالی (بدون سررسید/بدون یادآور/انجام‌شده/حذف‌شده/گذشته/مرز)
 *   ۲) parseDueLocalMs — ورودی‌های خراب هرگز زنگ نمی‌سازند
 *   ۳) buildReminderSchedule — پالایش، مرتب‌سازی قطعی، سقف ۶۰ (نزدیک‌ترین‌ها می‌مانند)
 *   ۴) stableNotificationId — پایداری، حساسیت به زمان/عنوان/کار، بازه‌ی int مثبت
 *   ۵) diffReminderSchedules — جایگزینی هوشمند: فقط تفاوت به سیستم‌عامل می‌رود
 *   ۶) truncateTitle / reminderBody / scheduleFingerprint
 */

import { describe, test, expect } from 'bun:test';
import {
  buildReminderSchedule,
  computeFireAtMs,
  diffReminderSchedules,
  parseDueLocalMs,
  reminderBody,
  REMINDER_CAP,
  scheduleFingerprint,
  stableNotificationId,
  truncateTitle,
  type ReminderScheduleEntry,
} from '@/lib/reminders';
import type { TaskEntity } from '@/types';

/** «الان» ثابت برای تست — ۲۰۲۶-۱۰-۲۸ ساعت ۱۲:۰۰ محلی */
const NOW = new Date(2026, 9, 28, 12, 0, 0, 0).getTime();

/** رکورد نمونه‌ی برنامه‌ی زنگ برای دیفرانسیل */
const entry = (id: number, fireAtMs: number): ReminderScheduleEntry => ({
  notifId: id,
  taskId: 't',
  title: 'کار',
  body: 'سررسید',
  fireAtMs,
  reminderMinutes: 15,
});

function mk(over: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: over.id ?? 't-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    listId: 'l-1',
    title: 'کار آزمایشی',
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

describe('۱) computeFireAtMs — قاعده‌ی قطعی لحظه‌ی زنگ', () => {
  test('سررسید با ساعت: fireAt = سررسید − reminderMinutes', () => {
    const t = mk({ dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 15 });
    expect(computeFireAtMs(t, NOW)).toBe(new Date(2026, 9, 29, 16, 45, 0, 0).getTime());
  });

  test('بدون ساعت: لنگر ۰۹:۰۰ محلی − reminderMinutes', () => {
    const t = mk({ dueDate: '2026-10-29', dueTime: null, reminderMinutes: 30 });
    expect(computeFireAtMs(t, NOW)).toBe(new Date(2026, 9, 29, 8, 30, 0, 0).getTime());
  });

  test('reminderMinutes=0 یعنی زنگ در همان لحظه‌ی سررسید', () => {
    const t = mk({ dueDate: '2026-10-29', dueTime: '09:00', reminderMinutes: 0 });
    expect(computeFireAtMs(t, NOW)).toBe(new Date(2026, 9, 29, 9, 0, 0, 0).getTime());
  });

  test('بدون سررسید → زنگ ندارد (حتی با یادآور تنظیم‌شده)', () => {
    expect(computeFireAtMs(mk({ dueDate: null, reminderMinutes: 15 }), NOW)).toBeNull();
  });

  test('بدون reminderMinutes / انجام‌شده / حذف‌شده → زنگ ندارد', () => {
    expect(computeFireAtMs(mk({ dueDate: '2026-10-29', reminderMinutes: null }), NOW)).toBeNull();
    expect(computeFireAtMs(mk({ dueDate: '2026-10-29', reminderMinutes: 15, completedAt: '2026-10-28T10:00:00.000Z' }), NOW)).toBeNull();
    expect(computeFireAtMs(mk({ dueDate: '2026-10-29', reminderMinutes: 15, deletedAt: '2026-10-28T10:00:00.000Z' }), NOW)).toBeNull();
  });

  test('زنگ گذشته و مرز دقیقاً «الان» → null؛ یک دقیقه بعد → زنگ دارد', () => {
    // سررسید دیروز: fireAt گذشته است
    expect(computeFireAtMs(mk({ dueDate: '2026-10-27', dueTime: '18:00', reminderMinutes: 30 }), NOW)).toBeNull();
    // fireAt = دقیقاً NOW → null (نباید زنگ عقب‌سازی شود)
    expect(computeFireAtMs(mk({ dueDate: '2026-10-28', dueTime: '12:30', reminderMinutes: 30 }), NOW)).toBeNull();
    // fireAt = NOW + 1 دقیقه → زنگ دارد (سررسید ۱۲:۳۱ منهای ۳۰ دقیقه = ۱۲:۰۱)
    expect(computeFireAtMs(mk({ dueDate: '2026-10-28', dueTime: '12:31', reminderMinutes: 30 }), NOW)).toBe(
      new Date(2026, 9, 28, 12, 1, 0, 0).getTime(),
    );
  });
});

describe('۲) parseDueLocalMs — ورودی خراب = هیچ زنگی', () => {
  test('تاریخ‌های نامعتبر', () => {
    expect(parseDueLocalMs('abc', '10:00')).toBeNull();
    expect(parseDueLocalMs('2026-13-01', '10:00')).toBeNull();
    expect(parseDueLocalMs('2026-10-32', '10:00')).toBeNull();
    expect(parseDueLocalMs('2026/10/29', '10:00')).toBeNull();
  });

  test('ساعت‌های نامعتبر — ولی نبودِ ساعت به لنگر ۰۹:۰۰ می‌افتد', () => {
    expect(parseDueLocalMs('2026-10-29', '25:00')).toBeNull();
    expect(parseDueLocalMs('2026-10-29', '12:5')).toBeNull();
    expect(parseDueLocalMs('2026-10-29', '۱۷:۰۰')).toBeNull(); // ارقام فارسی پذیرفته نمی‌شود
    expect(parseDueLocalMs('2026-10-29', null)).toBe(new Date(2026, 9, 29, 9, 0, 0, 0).getTime());
  });
});

describe('۳) buildReminderSchedule — پالایش، ترتیب و سقف', () => {
  test('فقط کارهای واجد شرایط با زنگِ آینده می‌مانند', () => {
    const tasks = [
      mk({ id: 'a', dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 15 }),
      mk({ id: 'b', completedAt: '2026-10-28T09:00:00.000Z', dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 15 }),
      mk({ id: 'c', deletedAt: '2026-10-28T09:00:00.000Z', dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 15 }),
      mk({ id: 'd', dueDate: null, reminderMinutes: 15 }),
      mk({ id: 'e', dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: null }),
      mk({ id: 'f', dueDate: '2026-10-26', dueTime: '17:00', reminderMinutes: 15 }), // گذشته
    ];
    const schedule = buildReminderSchedule(tasks, { nowMs: NOW });
    expect(schedule.length).toBe(1);
    expect(schedule[0].taskId).toBe('a');
    expect(schedule[0].fireAtMs).toBe(new Date(2026, 9, 29, 16, 45, 0, 0).getTime());
  });

  test('مرتب‌سازی صعودی بر اساس زمان زنگ + قطعیت در تساوی (taskId)', () => {
    const tasks = [
      mk({ id: 'z', dueDate: '2026-10-30', dueTime: '09:00', reminderMinutes: 0 }),
      mk({ id: 'a', dueDate: '2026-10-29', dueTime: '18:00', reminderMinutes: 30 }),
      mk({ id: 'm', dueDate: '2026-10-30', dueTime: '09:00', reminderMinutes: 0 }),
    ];
    const schedule = buildReminderSchedule(tasks, { nowMs: NOW });
    expect(schedule.map((e) => e.taskId)).toEqual(['a', 'm', 'z']);
  });

  test(`سقف ${REMINDER_CAP} — نزدیک‌ترین ۶۰ زنگ می‌مانند و دورترین‌ها حذف می‌شوند`, () => {
    const tasks: TaskEntity[] = [];
    for (let i = 1; i <= 70; i++) {
      // i دقیقه بعد از NOW — i=1 نزدیک‌ترین
      const mins = 12 + Math.floor(i / 60);
      const secs = i % 60;
      tasks.push(mk({ id: `t${String(i).padStart(2, '0')}`, dueDate: '2026-10-28', dueTime: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, reminderMinutes: 0 }));
    }
    const schedule = buildReminderSchedule(tasks, { nowMs: NOW });
    expect(schedule.length).toBe(REMINDER_CAP);
    // نزدیک‌ترین (t01) می‌ماند؛ دورترین‌ها (t61..t70) می‌روند
    expect(schedule[0].taskId).toBe('t01');
    const ids = new Set(schedule.map((e) => e.taskId));
    expect(ids.has('t70')).toBe(false);
    expect(ids.has('t60')).toBe(true);
    // ترتیب صعودی حفظ شده
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].fireAtMs).toBeGreaterThanOrEqual(schedule[i - 1].fireAtMs);
    }
  });

  test('فراخوانی تکراری با ورودی یکسان = خروجی یکسان (idempotent)', () => {
    const tasks = [mk({ dueDate: '2026-10-29', dueTime: '17:00', reminderMinutes: 15 })];
    const s1 = buildReminderSchedule(tasks, { nowMs: NOW });
    const s2 = buildReminderSchedule(tasks, { nowMs: NOW });
    expect(s1.map((e) => e.notifId)).toEqual(s2.map((e) => e.notifId));
  });
});

describe('۴) stableNotificationId — شناسه‌ی پایدار', () => {
  test('قطعی — ورودی یکسان، خروجی یکسان', () => {
    expect(stableNotificationId('abc', 1234567, 'کار')).toBe(stableNotificationId('abc', 1234567, 'کار'));
  });

  test('حساس به taskId / زمان / عنوان', () => {
    const base = stableNotificationId('t-1', 1000, 'کار');
    expect(stableNotificationId('t-2', 1000, 'کار')).not.toBe(base);
    expect(stableNotificationId('t-1', 2000, 'کار')).not.toBe(base);
    expect(stableNotificationId('t-1', 1000, 'کار ویرایش‌شده')).not.toBe(base);
  });

  test('بازه‌ی معتبر اندروید — int مثبت ۳۱بیتی', () => {
    for (let i = 0; i < 500; i++) {
      const id = stableNotificationId(`t-${i}`, 1000 + i, `کار ${i}`);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

describe('۵) diffReminderSchedules — جایگزینی هوشمند', () => {
  test('وضعیت یکسان → هیچ تماسی با سیستم‌عامل', () => {
    const next = [entry(10, 100), entry(20, 200)];
    const d = diffReminderSchedules([10, 20], next);
    expect(d.cancelIds).toEqual([]);
    expect(d.toSchedule).toEqual([]);
  });

  test('جابجایی زمان زنگ → شناسه‌ی نو: قدیمی لغو، جدید ثبت', () => {
    const next = [entry(10, 100), entry(21, 250)];
    const d = diffReminderSchedules([10, 20], next);
    expect(d.cancelIds).toEqual([20]);
    expect(d.toSchedule.map((e) => e.notifId)).toEqual([21]);
  });

  test('حذف زنگ → فقط لغو؛ افزودن → فقط ثبت', () => {
    const removed = diffReminderSchedules([10, 20], [entry(10, 100)]);
    expect(removed.cancelIds).toEqual([20]);
    expect(removed.toSchedule).toEqual([]);

    const added = diffReminderSchedules([10], [entry(10, 100), entry(30, 300)]);
    expect(added.cancelIds).toEqual([]);
    expect(added.toSchedule.map((e) => e.notifId)).toEqual([30]);
  });
});

describe('۶) عنوان/متن/اثرانگشت', () => {
  test('truncateTitle — کوتاه‌سازی با سه‌نقطه و پاک‌سازی فاصله', () => {
    expect(truncateTitle('  کار   تمیز  ')).toBe('کار تمیز');
    const long = truncateTitle('خ'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
    expect(truncateTitle('کوتاه')).toBe('کوتاه');
  });

  test('reminderBody — متن فارسی سررسید؛ ورودی خراب پیام جایگزین', () => {
    expect(reminderBody('2026-10-29', '17:00')).toContain('سررسید');
    expect(reminderBody('2026-10-29', null)).toContain('سررسید');
    expect(reminderBody('خراب', '17:00')).toBe('سررسید کار فرا رسیده است');
  });

  test('scheduleFingerprint — کلید اعلان‌ها و شناسه‌ها را در بر می‌گیرد', () => {
    const a = [entry(10, 100)];
    expect(scheduleFingerprint(a, true)).toBe(scheduleFingerprint(a, true));
    expect(scheduleFingerprint(a, true)).not.toBe(scheduleFingerprint(a, false));
    expect(scheduleFingerprint(a, true)).not.toBe(scheduleFingerprint([entry(11, 100)], true));
  });
});

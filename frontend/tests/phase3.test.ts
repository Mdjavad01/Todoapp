/**
 * کارام — تست کلاینت «فلوی افزودن و جزئیات کار» (فاز ۳)
 *
 * اجرا:  cd frontend && bun test tests/phase3.test.ts
 *
 * پوشش (الزام اصلاح ۶ کاربر — تست واحد موتور تکرار):
 *   ۱) روزانه / هفتگی / روزهای کاری (پنج‌شنبه و جمعه پرش)
 *   ۲) ماهانه‌ی شمسی — ماه‌های ۳۱روزه، ۳۰روزه و اسفند (کلمپ به آخرین روز)
 *   ۳) سالانه‌ی شمسی — ۳۰ اسفند کبیسه → ۲۹ اسفند سال غیرکبیسه
 *   ۴) سفارشی — هر N روز / هر N هفته در روزهای انتخابی (با پاریتی هفته) / هر N ماه / هر N سال
 *   ۵) normalizeRepeatMeta + describeRepeat
 *   ۶) هرس «روزهای من» (pruneMyDay)
 *   ۷) completeRecurring — نوبت بعدی با شناسه‌ی نو + کپی زیرکارهای باز
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی phase1/phase2) ---------- */
type Row = Record<string, unknown> & { id?: string; key?: string };
const mem: Record<string, Map<string, Row>> = {
  lists: new Map(),
  tasks: new Map(),
  subtasks: new Map(),
  reminders: new Map(),
  prefs: new Map(),
  meta: new Map(),
};

mock.module('@/db/idb', () => ({
  STORES: {
    lists: 'lists',
    tasks: 'tasks',
    subtasks: 'subtasks',
    reminders: 'reminders',
    prefs: 'prefs',
    meta: 'meta',
  },
  idbGet: async (s: string, k: string) => mem[s].get(k),
  idbGetAll: async (s: string) => [...mem[s].values()],
  idbPut: async (s: string, v: Row) => {
    mem[s].set(String(v.id ?? v.key), v);
  },
  idbDelete: async (s: string, k: string) => {
    mem[s].delete(k);
  },
  idbClear: async (s: string) => {
    mem[s].clear();
  },
  idbCount: async (s: string) => mem[s].size,
  seedTransaction: async (fn: (stores: Record<string, { put: (v: Row) => void; delete: (k: string) => void }>) => void) => {
    const store = (name: string) => ({
      put: (v: Row) => mem[name].set(String(v.id ?? v.key), v),
      delete: (k: string) => mem[name].delete(k),
    });
    fn({
      lists: store('lists'),
      tasks: store('tasks'),
      subtasks: store('subtasks'),
      reminders: store('reminders'),
      prefs: store('prefs'),
      meta: store('meta'),
    });
  },
}));

const { nextOccurrence, normalizeRepeatMeta, describeRepeat, pruneMyDay } = await import('@/lib/repeat');
const { fromJalali, jalaliMonthLength, toJalali } = await import('@/lib/jalali');
const repo = await import('@/db/repo');
const idb = await import('@/db/idb');
import type { TaskEntity, RepeatMeta } from '@/types';

/* ---------------- ابزار ---------------- */

/** Date ← تاریخ شمسی (نیمه‌شب محلی) */
const J = (jy: number, jm: number, jd: number): Date => fromJalali(jy, jm, jd);
const D = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const ISO = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** نتیجه را به مؤلفه‌های شمسی برمی‌گرداند برای ادعاهای تقویمی */
function nextJ(dueIso: string | null, repeat: TaskEntity['repeat'], meta: RepeatMeta | null, completedOn: Date): { jy: number; jm: number; jd: number; iso: string } {
  const iso = nextOccurrence(dueIso, repeat, meta, completedOn);
  expect(iso).not.toBeNull();
  const j = toJalali(D(iso as string));
  return { ...j, iso: iso as string };
}

let seq = 0;
function putTask(opts: Partial<TaskEntity> = {}): TaskEntity {
  seq++;
  const now = `2025-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`;
  const t: TaskEntity = {
    id: opts.id ?? `t${seq}`,
    listId: 'l1',
    title: 'کار',
    notes: '',
    priority: 'normal',
    dueDate: opts.dueDate ?? null,
    dueTime: null,
    reminderMinutes: null,
    repeat: opts.repeat ?? 'none',
    starred: opts.starred ?? false,
    repeatMeta: opts.repeatMeta ?? null,
    completedAt: opts.completedAt ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: opts.deletedAt ?? null,
  };
  mem.tasks.set(t.id, { ...t } as Row);
  return t;
}

function putSub(id: string, taskId: string, done = false, deletedAt: string | null = null): void {
  mem.subtasks.set(id, { id, taskId, title: `زیر-${id}`, done, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', deletedAt });
}

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  seq = 0;
});

/* ---------------- ۱) روزانه / هفتگی / روزهای کاری ---------------- */
describe('۱) تکرار پایه — روزانه، هفتگی، روزهای کاری', () => {
  const noon = new Date(2025, 0, 1, 12, 0, 0); // چهارشنبه ۱۲ دی ۱۴۰۳

  test('روزانه: فردا', () => {
    expect(nextOccurrence('2025-01-01', 'daily', null, noon)).toBe('2025-01-02');
  });

  test('روزانه برای کار بی‌تاریخ: مبنا = روزِ انجام', () => {
    expect(nextOccurrence(null, 'daily', null, noon)).toBe('2025-01-02');
  });

  test('هفتگی: +۷ روز', () => {
    expect(nextOccurrence('2025-01-01', 'weekly', null, noon)).toBe('2025-01-08');
  });

  test('روزهای کاری از چهارشنبه → شنبه (پنج‌شنبه و جمعه پرش)', () => {
    // 2025-01-01 چهارشنبه (wd=4) → 01-02 پنج‌شنبه (5)، 01-03 جمعه (6)، 01-04 شنبه (0)
    expect(nextOccurrence('2025-01-01', 'workdays', null, noon)).toBe('2025-01-04');
  });

  test('روزهای کاری از پنج‌شنبه/جمعه هم → شنبه', () => {
    expect(nextOccurrence('2025-01-02', 'workdays', null, noon)).toBe('2025-01-04');
    expect(nextOccurrence('2025-01-03', 'workdays', null, noon)).toBe('2025-01-04');
  });

  test('روزهای کاری از شنبه → یکشنبه (میان هفته پرش ندارد)', () => {
    expect(nextOccurrence('2025-01-04', 'workdays', null, noon)).toBe('2025-01-05');
  });

  test('بدون تکرار = null', () => {
    expect(nextOccurrence('2025-01-01', 'none', null, noon)).toBeNull();
  });
});

/* ---------------- ۲) ماهانه‌ی شمسی (کلمپ) ---------------- */
describe('۲) ماهانه‌ی شمسی — ۳۱/۳۰ روز و اسفند', () => {
  const noon = new Date(2025, 0, 1, 12, 0, 0);

  test('۳۱ فروردین → ۳۱ اردیبهشت → ۳۱ خرداد → ۳۱ تیر', () => {
    let r = nextJ(ISO(J(1404, 1, 31)), 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 2, 31]);
    r = nextJ(r.iso, 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 3, 31]);
    r = nextJ(r.iso, 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 4, 31]);
  });

  test('۳۱ شهریور → ۳۰ مهر (ماه ۳۰روزه کلمپ می‌شود)', () => {
    const r = nextJ(ISO(J(1404, 6, 31)), 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 7, 30]);
  });

  test('۳۰ بهمن → ۲۹ اسفند (۱۴۰۴ کبیسه نیست)', () => {
    expect(jalaliMonthLength(1404, 12)).toBe(29); // پیش‌فرض خود تقویم
    const r = nextJ(ISO(J(1404, 11, 30)), 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 12, 29]);
  });

  test('۳۰ اسفند سال کبیسه (۱۴۰۳) → ۳۰ فروردین سال بعد', () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    const r = nextJ(ISO(J(1403, 12, 30)), 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 1, 30]);
  });

  test('۲۹ اسفند → ۲۹ فروردین (روز حفظ می‌شود)', () => {
    const r = nextJ(ISO(J(1404, 12, 29)), 'monthly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1405, 1, 29]);
  });
});

/* ---------------- ۳) سالانه‌ی شمسی (کلمپ کبیسه) ---------------- */
describe('۳) سالانه‌ی شمسی', () => {
  const noon = new Date(2025, 0, 1, 12, 0, 0);

  test('۳۰ اسفند کبیسه ۱۴۰۳ → ۲۹ اسفند ۱۴۰۴ (غیرکبیسه)', () => {
    const r = nextJ(ISO(J(1403, 12, 30)), 'yearly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 12, 29]);
  });

  test('۱ فروردین → ۱ فروردین سال بعد', () => {
    const r = nextJ(ISO(J(1404, 1, 1)), 'yearly', null, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1405, 1, 1]);
  });

  test('سالانه در سال کبیسه‌ی بعدی دوباره ۳۰ اسفند می‌شود (۱۴۰۸ کبیسه)', () => {
    const r = nextJ(ISO(J(1404, 12, 29)), 'yearly', null, noon);
    const len = jalaliMonthLength(1405, 12);
    // ۱۴۰۵ غیرکبیسه → ۲۹؛ خودش کلمپ قطعی تقویم را نگه می‌دارد
    expect([r.jy, r.jm, r.jd]).toEqual([1405, 12, Math.min(29, len)]);
  });
});

/* ---------------- ۴) سفارشی ---------------- */
describe('۴) تکرار سفارشی — هر N روز/هفته/ماه/سال', () => {
  const noon = new Date(2025, 0, 1, 12, 0, 0);

  test('هر ۳ روز', () => {
    const r = nextOccurrence('2025-01-01', 'custom', { every: 3, unit: 'day' }, noon);
    expect(r).toBe('2025-01-04');
  });

  test('هر ۲ هفته در شنبه و سه‌شنبه — پاریتی هفته از مبنای سررسید', () => {
    // مبدأ چهارشنبه ۲۰۲۵-۰۱-۰۱؛ روزهای [0,3]=شنبه/سه‌شنبه؛ اولین شنبهٔ بعدی (۰۱-۰۴)
    // هفته‌ی فرد است → رد؛ شنبهٔ هفته‌ی زوج بعدی = ۲۰۲۵-۰۱-۱۱
    const r = nextOccurrence('2025-01-01', 'custom', { every: 2, unit: 'week', days: [0, 3] }, noon);
    expect(r).toBe('2025-01-11');
  });

  test('هر هفته با روزهای انتخابی — اولین روز منطبق بعد از مبنا', () => {
    // مبدأ چهارشنبه؛ روزهای [0 (شنبه)] → شنبه ۲۰۲۵-۰۱-۰۴ (پاریتی ۱)
    const r = nextOccurrence('2025-01-01', 'custom', { every: 1, unit: 'week', days: [0] }, noon);
    expect(r).toBe('2025-01-04');
  });

  test('هر ۲ ماه شمسی با کلمپ: ۳۱ فروردین → ۳۱ خرداد', () => {
    const r = nextJ(ISO(J(1404, 1, 31)), 'custom', { every: 2, unit: 'month' }, noon);
    expect([r.jy, r.jm, r.jd]).toEqual([1404, 3, 31]);
  });

  test('هر ۵ سال شمسی با کلمپ قطعی تقویم', () => {
    const r = nextJ(ISO(J(1403, 12, 30)), 'custom', { every: 5, unit: 'year' }, noon);
    expect(r.jy).toBe(1408);
    expect(r.jd).toBe(Math.min(30, jalaliMonthLength(1408, 12)));
  });

  test('سفارشی بدون meta → پیش‌فرض هر روز', () => {
    expect(nextOccurrence('2025-01-01', 'custom', null, noon)).toBe('2025-01-02');
  });
});

/* ---------------- ۵) نرمال‌سازی و برچسب ---------------- */
describe('۵) normalizeRepeatMeta + describeRepeat', () => {
  test('سالم عیناً؛ روزها مرتب و یکتا', () => {
    expect(normalizeRepeatMeta({ every: 2, unit: 'week', days: [3, 0, 3] })).toEqual({ every: 2, unit: 'week', days: [0, 3] });
    expect(normalizeRepeatMeta({ every: 7, unit: 'month' })).toEqual({ every: 7, unit: 'month' });
  });

  test('رشته‌ی JSON هم می‌پذیرد (مسیر سینک)', () => {
    expect(normalizeRepeatMeta('{"every":1,"unit":"day"}')).toEqual({ every: 1, unit: 'day' });
  });

  test('نامعتبر → null', () => {
    expect(normalizeRepeatMeta(null)).toBeNull();
    expect(normalizeRepeatMeta({ every: 0, unit: 'day' })).toBeNull();
    expect(normalizeRepeatMeta({ every: 366, unit: 'day' })).toBeNull();
    expect(normalizeRepeatMeta({ every: 1, unit: 'decade' })).toBeNull();
    expect(normalizeRepeatMeta('not-json')).toBeNull();
    expect(normalizeRepeatMeta([1, 2])).toBeNull();
  });

  test('days غیرآرایه‌ای نادیده گرفته می‌شود (سخت‌گیری ساختاری سمت سرور است)', () => {
    expect(normalizeRepeatMeta({ every: 1, unit: 'week', days: 3 })).toEqual({ every: 1, unit: 'week' });
  });

  test('روزهای نامعتبر حذف می‌شوند (می‌ماند بدون days)', () => {
    expect(normalizeRepeatMeta({ every: 1, unit: 'week', days: [42] })).toEqual({ every: 1, unit: 'week' });
  });

  test('برچسب فارسی سفارشی و پایه', () => {
    expect(describeRepeat('custom', { every: 2, unit: 'week', days: [0, 3] })).toBe('هر ۲ هفته در شنبه، سه‌شنبه');
    expect(describeRepeat('custom', { every: 2, unit: 'week', days: [0, 4] })).toBe('هر ۲ هفته در شنبه، چهارشنبه');
    expect(describeRepeat('custom', { every: 3, unit: 'day' })).toBe('هر ۳ روز');
    expect(describeRepeat('monthly', null)).toBe('ماهانه (تقویم شمسی)');
    expect(describeRepeat('workdays', null)).toBe('روزهای کاری (شنبه تا چهارشنبه)');
  });
});

/* ---------------- ۶) هرس روزهای من ---------------- */
describe('۶) pruneMyDay — قاعده‌ی هرس «روزهای من»', () => {
  const today = new Date(2025, 5, 10, 9, 0, 0);

  test('ناتمام می‌ماند؛ حذف‌شده و انجام‌شده‌ی دیروز می‌رود؛ انجام‌شده‌ی امروز می‌ماند', () => {
    const tasks = [
      { id: 'a', deletedAt: null, completedAt: null },
      { id: 'b', deletedAt: '2025-06-09T00:00:00.000Z', completedAt: null },
      { id: 'c', deletedAt: null, completedAt: '2025-06-09T18:00:00.000Z' }, // دیروز
      { id: 'd', deletedAt: null, completedAt: '2025-06-10T07:00:00.000Z' }, // امروز
    ];
    expect(pruneMyDay(['a', 'b', 'c', 'd', 'ghost'], tasks, today)).toEqual(['a', 'd']);
  });
});

/* ---------------- ۷) completeRecurring ---------------- */
describe('۷) completeRecurring — نوبت بعدی بعد از انجام', () => {
  test('روزانه: کار جدید با شناسه/سررسید نو + زیرکارهای باز کپی می‌شود؛ اصل دست‌نخورده', async () => {
    putTask({ id: 't1', repeat: 'daily', dueDate: '2025-01-01' });
    putSub('s1', 't1', true);
    putSub('s2', 't1', false);

    const next = await repo.completeRecurring('t1', new Date(2025, 0, 1, 12, 0, 0));
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe('t1');
    expect(next!.dueDate).toBe('2025-01-02');
    expect(next!.completedAt).toBeNull();
    expect(next!.title).toBe('کار');

    // اصل: همان کار بدون تغییر (تکمیلش در store با tasksToggleComplete انجام می‌شود)
    const orig = (await idb.idbGet('tasks', 't1')) as { dueDate?: string; completedAt?: null };
    expect(orig.dueDate).toBe('2025-01-01');
    expect(orig.completedAt).toBeNull();

    // زیرکارهای نوبت بعدی: ۲ عدد، همه باز، والد جدید
    const subs = (await idb.idbGetAll('subtasks')).filter((s) => s.taskId === next!.id) as { done: boolean; id: string }[];
    expect(subs.length).toBe(2);
    expect(subs.every((s) => !s.done)).toBe(true);
  });

  test('ماهانه شمسی: ۳۰ اسفند کبیسه → ۲۹ اسفند (کلمپ در نوبت بعدی)', async () => {
    putTask({ id: 't2', repeat: 'monthly', dueDate: ISO(J(1403, 12, 30)) });
    const next = await repo.completeRecurring('t2', new Date(2025, 2, 20, 12, 0, 0));
    expect(next!.dueDate).toBe(ISO(J(1404, 1, 30)));
  });

  test('کار بدون تکرار = null و هیچ ردیفی ساخته نمی‌شود', async () => {
    putTask({ id: 't3', repeat: 'none', dueDate: '2025-01-01' });
    expect(await repo.completeRecurring('t3')).toBeNull();
    expect(mem.tasks.size).toBe(1);
  });

  test('کار حذف‌شده = null', async () => {
    putTask({ id: 't4', repeat: 'daily', dueDate: '2025-01-01', deletedAt: '2025-01-01T00:00:00.000Z' });
    expect(await repo.completeRecurring('t4')).toBeNull();
  });

  test('tasksCreate فیلدهای جدید را ذخیره می‌کند (ستاره/سفارشی)', async () => {
    const t = await repo.tasksCreate({
      listId: 'l1',
      title: 'سفارشی',
      starred: true,
      repeat: 'custom',
      repeatMeta: { every: 2, unit: 'week', days: [0, 3] },
    });
    const row = (await idb.idbGet('tasks', t.id)) as TaskEntity;
    expect(row.starred).toBe(true);
    expect(row.repeatMeta).toEqual({ every: 2, unit: 'week', days: [0, 3] });
    expect(row.repeat).toBe('custom');
  });
});

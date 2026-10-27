/**
 * کارام — تست کلاینت «قابلیت کامل لیست‌ها» (فاز ۲)
 *
 * اجرا:  cd frontend && bun test tests/phase2.test.ts
 *
 * پوشش:
 *   ۱) ترتیب قطعی لیست‌ها (compareLists) و لیست پیش‌فرض (اولین لیست — محافظت حذف)
 *   ۲) مرتب‌سازی پنج‌حالته‌ی کارها (sortTasks)
 *   ۳) ادغام ترتیب بخش در ترتیب سراسری (applySectionOrder)
 *   ۴) واگرد حذف لیست (snapshot/restore) — حذف‌های قدیمی‌تر دست‌نخورده
 *   ۵) کپی لیست (tasksCopyRow/subtasksCopyRow) — شناسه‌های نو، فیلدهای عیناً
 *   ۶) listsCreate — انتهای ترتیب واقعی (بزرگ‌ترین sortOrder زنده + ۱)
 *   ۷) نرمال‌سازی ردیف لیست برای مهاجرت نسخه‌دار IndexedDB v2
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی phase1) ---------- */
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

/* بعد از mock، ماژول‌های تحت تست بارگذاری می‌شوند */
const { compareLists, defaultListId, sortTasks } = await import('@/lib/selectors');
const { applySectionOrder } = await import('@/lib/dragSort');
const { normalizeListRow } = await import('@/db/listRow');
const repo = await import('@/db/repo');
const idb = await import('@/db/idb');
import type { ListEntity, TaskEntity } from '@/types';

let seq = 0;
function makeList(id: string, name: string, opts: Partial<ListEntity> = {}): ListEntity {
  seq++;
  const now = opts.createdAt ?? `2025-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`;
  return {
    id,
    name,
    emoji: '📦',
    color: 'teal',
    sortOrder: opts.sortOrder ?? seq,
    createdAt: now,
    updatedAt: opts.updatedAt ?? now,
    deletedAt: opts.deletedAt ?? null,
  };
}

function putList(l: ListEntity): void {
  mem.lists.set(l.id, { ...l } as Row);
}

function makeTask(id: string, listId: string, opts: Partial<TaskEntity> = {}): TaskEntity {
  seq++;
  const now = opts.createdAt ?? `2025-02-01T00:00:${String(seq).padStart(2, '0')}.000Z`;
  return {
    id,
    listId,
    title: opts.title ?? 'کار',
    notes: opts.notes ?? '',
    priority: opts.priority ?? 'normal',
    dueDate: opts.dueDate ?? null,
    dueTime: opts.dueTime ?? null,
    reminderMinutes: opts.reminderMinutes ?? null,
    repeat: opts.repeat ?? 'none',
    completedAt: opts.completedAt ?? null,
    createdAt: now,
    updatedAt: opts.updatedAt ?? now,
    deletedAt: opts.deletedAt ?? null,
  };
}

function putTask(t: TaskEntity): void {
  mem.tasks.set(t.id, { ...t } as Row);
}

function putSub(id: string, taskId: string, done = false, deletedAt: string | null = null): void {
  mem.subtasks.set(id, { id, taskId, title: `زیر-${id}`, done, createdAt: '2025-02-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z', deletedAt });
}

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  seq = 0;
});

/* ---------------- ۱) ترتیب قطعی و لیست پیش‌فرض ---------------- */
describe('۱) compareLists + defaultListId — ترتیب قطعی و محافظت پیش‌فرض', () => {
  test('sortOrder اولویت اول است', () => {
    const a = makeList('a', 'الف', { sortOrder: 1 });
    const b = makeList('b', 'ب', { sortOrder: 0 });
    expect([a, b].sort(compareLists).map((l) => l.id)).toEqual(['b', 'a']);
  });

  test('تساوی sortOrder → createdAt قدیمی‌تر جلو', () => {
    const a = makeList('a', 'الف', { sortOrder: 5, createdAt: '2025-06-01T00:00:00.000Z' });
    const b = makeList('b', 'ب', { sortOrder: 5, createdAt: '2025-01-01T00:00:00.000Z' });
    expect([a, b].sort(compareLists).map((l) => l.id)).toEqual(['b', 'a']);
  });

  test('تساوی کامل → id کوچک‌تر جلو (قطعی بین دستگاه‌ها)', () => {
    const a = makeList('zzz', 'الف', { sortOrder: 5, createdAt: '2025-01-01T00:00:00.000Z' });
    const b = makeList('aaa', 'ب', { sortOrder: 5, createdAt: '2025-01-01T00:00:00.000Z' });
    expect([a, b].sort(compareLists).map((l) => l.id)).toEqual(['aaa', 'zzz']);
  });

  test('لیست پیش‌فرض = اولین لیست زنده؛ تومب‌استون شمرده نمی‌شود', () => {
    putList(makeList('dead', 'حذف‌شده', { sortOrder: 0, deletedAt: '2025-03-01T00:00:00.000Z' }));
    putList(makeList('first', 'اولین', { sortOrder: 1 }));
    putList(makeList('second', 'دومین', { sortOrder: 2 }));
    expect(defaultListId([makeList('dead', 'x', { sortOrder: 0, deletedAt: 'T' }), makeList('first', 'x', { sortOrder: 1 }), makeList('second', 'x', { sortOrder: 2 })])).toBe('first');
    expect(defaultListId([makeList('only', 'تنها')])).toBe('only');
    expect(defaultListId([])).toBeNull();
  });
});

/* ---------------- ۲) مرتب‌سازی پنج‌حالته ---------------- */
describe('۲) sortTasks — پنج حالت به‌یادماندنی هر لیست', () => {
  const T = (id: string, title: string, opts: Partial<TaskEntity> = {}) => makeTask(id, 'l', { title, ...opts });

  test('اهمیت: urgent → high → normal → low؛ هم‌اولویت با سررسید', () => {
    const tasks = [
      T('n', 'عادی', { priority: 'normal' }),
      T('u', 'فوری', { priority: 'urgent' }),
      T('l', 'کم', { priority: 'low' }),
      T('h', 'بالا', { priority: 'high' }),
      T('n2', 'عادی‌۲', { priority: 'normal', dueDate: '2025-01-01' }),
    ];
    expect(sortTasks(tasks, 'importance').map((t) => t.id)).toEqual(['u', 'h', 'n2', 'n', 'l']);
  });

  test('سررسید: بدون تاریخ آخر؛ هم‌تاریخ با ساعت؛ هم‌ساعت با اولویت', () => {
    const tasks = [
      T('none', 'بی‌تاریخ'),
      T('late', 'بعده', { dueDate: '2025-03-10' }),
      T('soon-u', 'فوریِ نزدیک', { dueDate: '2025-01-05', priority: 'low' }),
      T('soon', 'نزدیک', { dueDate: '2025-01-05', dueTime: '08:00' }),
    ];
    expect(sortTasks(tasks, 'due').map((t) => t.id)).toEqual(['soon', 'soon-u', 'late', 'none']);
  });

  test('الفبا: ترتیب فارسی', () => {
    const tasks = [T('b', 'بابا'), T('a', 'آب'), T('p', 'پدر')];
    expect(sortTasks(tasks, 'alpha').map((t) => t.id)).toEqual(['a', 'b', 'p']);
  });

  test('تاریخ ایجاد: قدیمی‌تر جلو', () => {
    const tasks = [
      T('new', 'تازه', { createdAt: '2025-05-01T00:00:00.000Z' }),
      T('old', 'قدیمی', { createdAt: '2025-01-01T00:00:00.000Z' }),
    ];
    expect(sortTasks(tasks, 'created').map((t) => t.id)).toEqual(['old', 'new']);
  });

  test('دستی: شناسه‌های ترتیب دستی اول؛ بقیه با اهمیت', () => {
    const tasks = [
      T('a', 'الف', { priority: 'urgent' }),
      T('b', 'ب'),
      T('c', 'ج'),
      T('d', 'د'),
    ];
    expect(sortTasks(tasks, 'manual', ['c', 'a']).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortTasks(tasks, 'manual', []).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('تغییر نکردن آرایه‌ی ورودی (کپی مرتب می‌شود)', () => {
    const tasks = [T('b', 'ب'), T('a', 'آب')];
    sortTasks(tasks, 'alpha');
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

/* ---------------- ۳) ادغام ترتیب بخش ---------------- */
describe('۳) applySectionOrder — ادغام ترتیب بخش در ترتیب سراسری', () => {
  test('مواضع همان بخش با ترتیب تازه پر می‌شود', () => {
    const global = ['g1', 's1', 'g2', 's2', 's3'];
    expect(applySectionOrder(global, ['s1', 's2', 's3'], ['s3', 's1', 's2'])).toEqual(['g1', 's3', 'g2', 's1', 's2']);
  });

  test('ترتیب نامعتبر (عضو غایب) → دست‌نخورده', () => {
    const global = ['g1', 's1', 's2'];
    expect(applySectionOrder(global, ['s1', 's2'], ['s1'])).toEqual(global);
    expect(applySectionOrder(global, ['s1', 's2'], ['s1', 'x'])).toEqual(global);
  });

  test('تغییر نکردن ورودی‌ها', () => {
    const global = ['s1', 's2'];
    applySectionOrder(global, ['s1', 's2'], ['s2', 's1']);
    expect(global).toEqual(['s1', 's2']);
  });
});

/* ---------------- ۴) واگرد حذف لیست ---------------- */
describe('۴) snapshotListForUndo + restoreListSnapshot — واگرد حذف', () => {
  test('حذف → همه‌ی ردیف‌های وابسته تومب‌استون → واگرد → همه زنده با updatedAt تازه', async () => {
    putList(makeList('l1', 'خرید'));
    putTask(makeTask('t1', 'l1'));
    putTask(makeTask('t2', 'l1', { completedAt: '2025-02-02T00:00:00.000Z' }));
    putTask(makeTask('other', 'l-other'));
    putSub('s1', 't1');

    const snap = await repo.snapshotListForUndo('l1');
    expect(snap).not.toBeNull();
    expect(snap!.tasks.length).toBe(2);
    expect(snap!.subtasks.length).toBe(1);

    await repo.listsSoftDelete('l1');
    expect(((await idb.idbGet('lists', 'l1')) as { deletedAt?: string }).deletedAt).not.toBeNull();
    expect(((await idb.idbGet('tasks', 't1')) as { deletedAt?: string }).deletedAt).not.toBeNull();
    expect(((await idb.idbGet('subtasks', 's1')) as { deletedAt?: string }).deletedAt).not.toBeNull();

    await repo.restoreListSnapshot(snap!);
    const l1 = (await idb.idbGet('lists', 'l1')) as { deletedAt?: string; updatedAt: string };
    const t1 = (await idb.idbGet('tasks', 't1')) as { deletedAt?: string; updatedAt: string };
    const s1 = (await idb.idbGet('subtasks', 's1')) as { deletedAt?: string };
    expect(l1.deletedAt).toBeNull();
    expect(t1.deletedAt).toBeNull();
    expect(s1.deletedAt).toBeNull();
    // updatedAt تازه = در چرخه‌ی سینک بعدی پوش می‌شود (زنده‌شدن به سرور می‌رسد)
    expect(l1.updatedAt >= '2025-02-02').toBe(true);
    expect(t1.updatedAt >= '2025-02-02').toBe(true);
    // کارِ لیست دیگر دست نخورده
    expect(((await idb.idbGet('tasks', 'other')) as { deletedAt?: string }).deletedAt).toBeNull();
  });

  test('حذف‌های قدیمی‌تر (قبل از عکس‌گرفتن) با واگرد زنده نمی‌شوند', async () => {
    putList(makeList('l2', 'کار'));
    putTask(makeTask('t-new', 'l2'));
    putSub('s-old', 't-new', false, '2024-01-01T00:00:00.000Z'); // قبلاً حذف شده

    const snap = await repo.snapshotListForUndo('l2');
    expect(snap!.subtasks.length).toBe(0); // زیرکار حذف‌شده در عکس نیست
    await repo.listsSoftDelete('l2');
    await repo.restoreListSnapshot(snap!);
    expect(((await idb.idbGet('subtasks', 's-old')) as { deletedAt?: string }).deletedAt).not.toBeNull();
  });

  test('عکس گرفتن از لیست حذف‌شده = null', async () => {
    putList(makeList('l3', 'حذف‌شده', { deletedAt: '2025-01-01T00:00:00.000Z' }));
    expect(await repo.snapshotListForUndo('l3')).toBeNull();
    expect(await repo.snapshotListForUndo('nope')).toBeNull();
  });
});

/* ---------------- ۵) کپی لیست ---------------- */
describe('۵) tasksCopyRow + subtasksCopyRow — کپی با شناسه‌های نو', () => {
  test('کپی کار: فیلدها عیناً، شناسه/لیست/زمان‌ها نو', async () => {
    putTask(makeTask('src', 'l1', { title: 'گزارش', priority: 'high', dueDate: '2025-04-01', completedAt: '2025-04-02T00:00:00.000Z' }));
    const copy = await repo.tasksCopyRow('src', 'l2');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('src');
    expect(copy!.listId).toBe('l2');
    expect(copy!.title).toBe('گزارش');
    expect(copy!.priority).toBe('high');
    expect(copy!.dueDate).toBe('2025-04-01');
    expect(copy!.completedAt).toBe('2025-04-02T00:00:00.000Z');
    // نسخه‌ی اصلی دست نخورده
    expect(((await idb.idbGet('tasks', 'src')) as { listId?: string }).listId).toBe('l1');
  });

  test('کپی زیرکارها با done عیناً', async () => {
    putTask(makeTask('t-src', 'l1'));
    putSub('s1', 't-src', true);
    putSub('s2', 't-src', false);
    const copy = await repo.tasksCopyRow('t-src', 'l2');
    await repo.subtasksCopyRow('t-src', copy!.id);
    const subs = (await idb.idbGetAll('subtasks')).filter((s) => s.taskId === copy!.id) as { done: boolean; id: string }[];
    expect(subs.length).toBe(2);
    expect(subs.every((s) => s.id !== 's1' && s.id !== 's2')).toBe(true);
    expect(subs.filter((s) => s.done).length).toBe(1);
  });

  test('کپی کار حذف‌شده = null', async () => {
    putTask(makeTask('dead', 'l1', { deletedAt: '2025-01-01T00:00:00.000Z' }));
    expect(await repo.tasksCopyRow('dead', 'l2')).toBeNull();
  });
});

/* ---------------- ۶) listsCreate — انتهای ترتیب واقعی ---------------- */
describe('۶) listsCreate — sortOrder = بزرگ‌ترین زنده + ۱', () => {
  test('تومب‌استون‌ها در محاسبه‌ی انتهای ترتیب شمرده نمی‌شوند', async () => {
    putList(makeList('a', 'الف', { sortOrder: 0 }));
    putList(makeList('big', 'بزرگ', { sortOrder: 7 }));
    putList(makeList('dead', 'حذف', { sortOrder: 99, deletedAt: '2025-01-01T00:00:00.000Z' }));
    const created = await repo.listsCreate({ name: 'تازه', emoji: '🆕', color: 'teal' });
    expect(created.sortOrder).toBe(8); // نه ۱۰۰ و نه ۳ (طول خام شامل تومب‌استون)
  });

  test('نخستین لیست = sortOrder صفر', async () => {
    const created = await repo.listsCreate({ name: 'اول', emoji: '1️⃣', color: 'amber' });
    expect(created.sortOrder).toBe(0);
  });
});

/* ---------------- ۷) نرمال‌سازی ردیف برای مهاجرت v2 ---------------- */
describe('۷) normalizeListRow — مهاجرت نسخه‌دار IndexedDB (v1→v2)', () => {
  test('رنگ نامعتبر → teal؛ sortOrder خراب → ۰', () => {
    const fixed = normalizeListRow({ id: 'x', name: 'لیست', color: 'pink', sortOrder: 'abc', emoji: '🏠' })!;
    expect(fixed.color).toBe('teal');
    expect(fixed.sortOrder).toBe(0);
  });

  test('ایموجی/نام غایب → جایگزین سالم؛ منفی به صفر می‌رود', () => {
    const fixed = normalizeListRow({ id: 'y', sortOrder: -5 })!;
    expect(fixed.emoji).toBe('🗂️');
    expect(fixed.name).toBe('بدون نام');
    expect(fixed.sortOrder).toBe(0);
    expect(fixed.createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  test('ردیف سالم دست‌نخورده می‌ماند و ردیف بی‌کلید حذف می‌شود', () => {
    const good = { id: 'z', name: 'سالم', emoji: '✅', color: 'rose', sortOrder: 3, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
    expect(normalizeListRow(good)).toEqual(good);
    expect(normalizeListRow(null)).toBeNull();
    expect(normalizeListRow({ name: 'بی‌شناسه' })).toBeNull();
  });
});

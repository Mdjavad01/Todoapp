/**
 * کارام — تست کلاینت «ترمیم جریان» (فاز ۱ بازسازی)
 *
 * اجرا:  cd frontend && bun test tests/phase1.test.ts
 *
 * پوشش:
 *   ۱) قاعده‌ی LWW قطعی (revTuple) — قرینه‌ی سرور (SyncService::tupleGreaterOrEqual)
 *   ۲) chunkChanges — push تکه‌تکه زیر سقف
 *   ۳) جبران ساعت (clock offset + nowIso)
 *   ۴) حریم خصوصی: wipeUserData — خروج از حساب، داده‌ی حساب پاک، ترجیحات دستگاه می‌ماند
 *   ۵) dedupeSeedLists — ادغام لیست‌های seed تکراری + انتقال کارها
 *   ۶) pruneEmptyDefaultList — لیست پیش‌فرض خالی هنگام ورود
 *   ۷) ensureDefaultData — لیست پیش‌فرض قطعی به‌جای داده‌ی آزمایشی
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock) ---------- */
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
    const key = String(v.id ?? v.key);
    mem[s].set(key, v);
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
const { wipeUserData } = await import('@/db/wipe');
const { dedupeSeedLists, pruneEmptyDefaultList } = await import('@/db/dedupe');
const { ensureDefaultData } = await import('@/db/seed');
const { revTupleNewerOrEqual, revTupleStrictlyNewer, chunkChanges, SEED_LIST_NAMES, DEFAULT_LIST_NAME } = await import('@/sync/lww');
const { setClockOffset, resetClockOffset, getClockOffsetMs } = await import('@/lib/clock');
const { nowIso, uuid } = await import('@/lib/uuid');
const idb = await import('@/db/idb');

function putList(id: string, name: string, opts: { createdAt?: string; deletedAt?: string | null; rev?: number } = {}): void {
  const now = new Date().toISOString();
  mem.lists.set(id, {
    id,
    name,
    emoji: '📦',
    color: 'teal',
    sortOrder: mem.lists.size,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    deletedAt: opts.deletedAt ?? null,
    rev: opts.rev,
  });
}

function putTask(id: string, listId: string, title = 'کار'): void {
  const now = new Date().toISOString();
  mem.tasks.set(id, {
    id,
    listId,
    title,
    notes: '',
    priority: 'normal',
    dueDate: null,
    dueTime: null,
    reminderMinutes: null,
    repeat: 'none',
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  resetClockOffset();
});

describe('۱) قاعده‌ی LWW قطعی (revTuple) — هم‌قرارداد با سرور', () => {
  const S = (updatedAt: string, rev?: number, revDevice?: string) => ({ updatedAt, rev, revDevice });

  test('updatedAt جدیدتر برنده است حتی با rev کوچک‌تر', () => {
    expect(revTupleNewerOrEqual(S('2025-01-01T10:00:01.000Z', 0, 'c'), S('2025-01-01T10:00:00.000Z', 9, 'a'))).toBe(true);
    expect(revTupleStrictlyNewer(S('2025-01-01T10:00:01.000Z', 0, 'c'), S('2025-01-01T10:00:00.000Z', 9, 'a'))).toBe(true);
  });

  test('هم‌ثانیه: rev بزرگ‌تر برنده', () => {
    expect(revTupleNewerOrEqual(S('T', 2, 'a'), S('T', 1, 'z'))).toBe(true);
    expect(revTupleStrictlyNewer(S('T', 2, 'a'), S('T', 1, 'z'))).toBe(true);
    expect(revTupleNewerOrEqual(S('T', 1, 'z'), S('T', 2, 'a'))).toBe(false);
  });

  test('هم‌ثانیه و هم‌rev: revDevice بزرگ‌تر برنده (متنی)', () => {
    expect(revTupleNewerOrEqual(S('T', 1, 'device-b'), S('T', 1, 'device-a'))).toBe(true);
    expect(revTupleNewerOrEqual(S('T', 1, 'device-a'), S('T', 1, 'device-b'))).toBe(false);
    // تساوی کامل: نسخه‌ی >= برنده (idempotent) ولی strictly نه (بی‌اثر)
    expect(revTupleNewerOrEqual(S('T', 1, 'x'), S('T', 1, 'x'))).toBe(true);
    expect(revTupleStrictlyNewer(S('T', 1, 'x'), S('T', 1, 'x'))).toBe(false);
  });

  test('نبودن rev (رکورد قدیمی) = صفر', () => {
    expect(revTupleNewerOrEqual(S('T', 1), S('T'))).toBe(true);
    expect(revTupleStrictlyNewer(S('T'), S('T', 1))).toBe(false);
  });

  test('نام‌های seed هم‌قرارداد با سرور (SyncService::SEED_LIST_NAMES)', () => {
    expect(SEED_LIST_NAMES).toContain('کارهای خانه');
    expect(SEED_LIST_NAMES).toContain('خرید هفتگی');
    expect(SEED_LIST_NAMES.length).toBe(6);
  });
});

describe('۲) chunkChanges — push تکه‌تکه', () => {
  test('تقسیم درست زیر سقف', () => {
    const lists = Array.from({ length: 250 }, (_, i) => ({ id: String(i), updatedAt: 'T' })) as never[];
    const tasks = Array.from({ length: 60 }, (_, i) => ({ id: 't' + i, updatedAt: 'T' })) as never[];
    const chunks = chunkChanges({ lists, tasks, subtasks: [] } as never, 100);
    expect(chunks.length).toBe(4);
    for (const c of chunks as unknown as { lists: unknown[]; tasks: unknown[] }[]) {
      expect(c.lists.length <= 100).toBe(true);
      expect(c.tasks.length <= 100).toBe(true);
      // هر چانک فقط یک موجودیت دارد (سقف سرور «هر موجودیت» است)
      expect(c.lists.length === 0 || c.tasks.length === 0).toBe(true);
    }
    const totalLists = chunks.reduce((a, c) => a + (c as { lists: unknown[] }).lists.length, 0);
    const totalTasks = chunks.reduce((a, c) => a + (c as { tasks: unknown[] }).tasks.length, 0);
    expect(totalLists).toBe(250);
    expect(totalTasks).toBe(60);
  });

  test('خالی = بدون چانک', () => {
    expect(chunkChanges({ lists: [], tasks: [], subtasks: [] }, 100).length).toBe(0);
  });

  test('اندازه‌ی نامعتبر به ۱ محدود می‌شود', () => {
    const chunks = chunkChanges({ lists: [{ id: 'a', updatedAt: 'T' }] as never, tasks: [], subtasks: [] }, 0);
    expect(chunks.length).toBe(1);
  });
});

describe('۳) جبران ساعت', () => {
  test('اختلاف کم از ۵ ثانیه نادیده گرفته می‌شود', () => {
    const server = new Date(Date.now() + 3000).toISOString();
    expect(setClockOffset(server)).toBe(false);
    expect(getClockOffsetMs()).toBe(0);
  });

  test('اختلاف بزرگ جبران و در nowIso اعمال می‌شود', () => {
    const skew = 10 * 60 * 1000; // دستگاه ۱۰ دقیقه عقب است
    const server = new Date(Date.now() + skew).toISOString();
    expect(setClockOffset(server)).toBe(true);
    expect(Math.abs(getClockOffsetMs() - skew)).toBeLessThan(2000);
    const t = Date.parse(nowIso());
    const serverNow = Date.now() + skew;
    expect(Math.abs(t - serverNow)).toBeLessThan(2000);
  });

  test('سقف جبران ±۲۴ ساعت', () => {
    const server = new Date(Date.now() + 100 * 3600 * 1000).toISOString();
    setClockOffset(server);
    expect(Math.abs(getClockOffsetMs())).toBeLessThanOrEqual(86_400_000);
  });
});

describe('۴) حریم خصوصی — wipeUserData هنگام خروج', () => {
  test('داده‌ی حساب پاک می‌شود و ترجیحات دستگاه می‌ماند', async () => {
    // داده‌ی کاربر قبلی
    putList('l1', 'کارهای خانه');
    putTask('t1', 'l1');
    mem.subtasks.set('s1', { id: 's1', taskId: 't1', title: 'زیر', done: false });
    mem.reminders.set('r1', { id: 'r1', taskId: 't1', fireAt: 'T', fired: false });
    mem.meta.set('seededVersion', { key: 'seededVersion', value: 2 });
    mem.meta.set('sync-cursor', { key: 'sync-cursor', value: '2025-01-01T00:00:00.000Z' });
    mem.prefs.set('sync-session', { key: 'sync-session', value: { userUuid: 'u1' } });
    mem.prefs.set('userName', { key: 'userName', value: 'علی' });
    mem.prefs.set('welcome-done', { key: 'welcome-done', value: 'done' });
    // ترجیحات دستگاه — باید بمانند
    mem.prefs.set('device-uuid', { key: 'device-uuid', value: 'dev-1' });
    mem.prefs.set('theme-dark', { key: 'theme-dark', value: true });
    mem.prefs.set('accent', { key: 'accent', value: 'amber' });
    mem.prefs.set('fontScale', { key: 'fontScale', value: 'large' });

    await wipeUserData();

    expect(mem.lists.size).toBe(0);
    expect(mem.tasks.size).toBe(0);
    expect(mem.subtasks.size).toBe(0);
    expect(mem.reminders.size).toBe(0);
    expect(mem.meta.size).toBe(0); // کرسرها و نشان سید هم مال داده‌ی قبلی‌اند
    expect(mem.prefs.has('sync-session')).toBe(false);
    expect(mem.prefs.has('userName')).toBe(false);
    expect(mem.prefs.has('welcome-done')).toBe(false);
    // دستگاه حفظ می‌شود
    expect(mem.prefs.get('device-uuid')?.value).toBe('dev-1');
    expect(mem.prefs.get('theme-dark')?.value).toBe(true);
    expect(mem.prefs.get('accent')?.value).toBe('amber');
    expect(mem.prefs.get('fontScale')?.value).toBe('large');
  });

  test('کاربر بعدی هیچ داده‌ای از قبلی نمی‌بیند', async () => {
    putList('l-prev', 'لیست حساب قبلی');
    putTask('t-prev', 'l-prev');
    await wipeUserData();
    const all = await idb.idbGetAll('lists');
    expect(all.length).toBe(0);
  });
});

describe('۵) dedupeSeedLists — ادغام لیست‌های seed تکراری', () => {
  test('قدیمی‌ترین نگه داشته می‌شود؛ کارها منتقل و بازنده تومب‌استون می‌شود', async () => {
    putList('old', 'کارهای خانه', { createdAt: '2025-01-01T00:00:00.000Z' });
    putList('new', 'کارهای خانه', { createdAt: '2025-06-01T00:00:00.000Z' });
    putTask('t-old', 'old');
    putTask('t-new', 'new');

    const changed = await dedupeSeedLists();
    expect(changed).toBe(true);

    const old = await idb.idbGet('lists', 'old');
    const neu = await idb.idbGet('lists', 'new');
    expect(old?.deletedAt).toBeNull();
    expect(neu?.deletedAt).not.toBeNull();
    expect(((await idb.idbGet('tasks', 't-new')) as { listId?: string } | undefined)?.listId).toBe('old');
    expect(((await idb.idbGet('tasks', 't-old')) as { listId?: string } | undefined)?.listId).toBe('old');
  });

  test('دوباره اجرا = بی‌اثر (idempotent)', async () => {
    putList('old', 'خرید هفتگی', { createdAt: '2025-01-01T00:00:00.000Z' });
    putList('new', 'خرید هفتگی', { createdAt: '2025-06-01T00:00:00.000Z' });
    await dedupeSeedLists();
    expect(await dedupeSeedLists()).toBe(false);
  });

  test('لیست‌های هم‌نام غیرسید دست نمی‌خورند', async () => {
    putList('p1', 'لیست شخصی', { createdAt: '2025-01-01T00:00:00.000Z' });
    putList('p2', 'لیست شخصی', { createdAt: '2025-02-01T00:00:00.000Z' });
    expect(await dedupeSeedLists()).toBe(false);
    expect((await idb.idbGet('lists', 'p1'))?.deletedAt).toBeNull();
    expect((await idb.idbGet('lists', 'p2'))?.deletedAt).toBeNull();
  });

  test('تساوی createdAt → uuid کوچک‌تر برنده (قطعی)', async () => {
    putList('zzz', 'کاری', { createdAt: '2025-01-01T00:00:00.000Z' });
    putList('aaa', 'کاری', { createdAt: '2025-01-01T00:00:00.000Z' });
    await dedupeSeedLists();
    expect((await idb.idbGet('lists', 'aaa'))?.deletedAt).toBeNull();
    expect((await idb.idbGet('lists', 'zzz'))?.deletedAt).not.toBeNull();
  });
});

describe('۶) pruneEmptyDefaultList — ورود به حساب', () => {
  test('فقط لیست پیش‌فرضِ خالی → تومب‌استون', async () => {
    putList('def', DEFAULT_LIST_NAME);
    await pruneEmptyDefaultList();
    expect((await idb.idbGet('lists', 'def'))?.deletedAt).not.toBeNull();
  });

  test('لیست پیش‌فرضِ دارای کار دست نمی‌خورد (داده‌ی مهمان باید ادغام شود)', async () => {
    putList('def', DEFAULT_LIST_NAME);
    putTask('t1', 'def');
    await pruneEmptyDefaultList();
    expect((await idb.idbGet('lists', 'def'))?.deletedAt).toBeNull();
  });

  test('چند لیست → دست نمی‌خورد', async () => {
    putList('def', DEFAULT_LIST_NAME);
    putList('other', 'کارهای خانه');
    await pruneEmptyDefaultList();
    expect((await idb.idbGet('lists', 'def'))?.deletedAt).toBeNull();
  });
});

describe('۷) ensureDefaultData — لیست پیش‌فرض قطعی', () => {
  test('نصب تازه: فقط یک لیست پیش‌فرض؛ بدون داده‌ی آزمایشی', async () => {
    await ensureDefaultData();
    const all = await idb.idbGetAll('lists');
    expect(all.length).toBe(1);
    expect((all[0] as { name: string }).name).toBe('کارهای من');
    expect(mem.tasks.size).toBe(0); // دیگر هیچ کار دمویی ساخته نمی‌شود
    // اجرای دوباره = بی‌اثر
    await ensureDefaultData();
    expect((await idb.idbGetAll('lists')).length).toBe(1);
  });

  test('کاربر دارای لیست → هیچ‌چیز ساخته نمی‌شود', async () => {
    putList('real', 'لیست واقعی من');
    await ensureDefaultData();
    const all = await idb.idbGetAll('lists');
    expect(all.length).toBe(1);
    expect((all[0] as { id: string }).id).toBe('real');
  });

  test('شناسه‌ی ساخته‌شده UUID معتبر است', async () => {
    await ensureDefaultData();
    const l = (await idb.idbGetAll('lists'))[0] as { id: string };
    expect(/^[0-9a-f-]{36}$/.test(l.id)).toBe(true);
  });
});

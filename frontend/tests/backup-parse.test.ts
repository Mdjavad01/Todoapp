/**
 * کارام — تست پارس/پیش‌نمایش و بازیابی فایل پشتیبان (P1.3 — lib/backup.ts)
 *
 * اجرا:  cd frontend && bun test tests/backup-parse.test.ts
 *
 * پوشش:
 *   ۱) parseBackupFile — سالم/خراب/غیرکارام/نسخه‌ی جدیدتر + متن فارسی خطاها
 *   ۲) backupCountsOf — P1.4: همیشه از آرایه‌ها شمرده می‌شود؛ counts دست‌کاری‌شده بی‌اثر
 *   ۳) restoreBackup — added/updated/kept با قاعده‌ی LWW + هیچ‌چیز حذف نمی‌شود
 *   ۴) دفاع دوم: restore فایل نسخه‌ی جدیدتر → invalid با reason (بدون هیچ نوشتن)
 *   ۵) getLastBackupAt/markLastBackupNow — فقط بعد از ذخیره‌ی موفق ثبت می‌شود (فراخوانی از تست)
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (همان الگوی phase1) ---------- */
type Row = Record<string, unknown> & { id?: string };
const mem: Record<string, Map<string, Row>> = {
  lists: new Map(),
  tasks: new Map(),
  subtasks: new Map(),
  reminders: new Map(),
  prefs: new Map(),
  meta: new Map(),
};

mock.module('@/db/idb', () => ({
  STORES: { lists: 'lists', tasks: 'tasks', subtasks: 'subtasks', reminders: 'reminders', prefs: 'prefs', meta: 'meta' },
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
  // سطح کامل (مثل phase1) — چون mock.module بین فایل‌های تست در یک فرایند نشت می‌کند
  seedTransaction: async (
    fn: (stores: Record<string, { put: (v: Row) => void; delete: (k: string) => void }>) => void,
  ) => {
    const store = (name: string) => ({
      put: (v: Row) => mem[name].set(String(v.id ?? v.key), v),
      delete: (k: string) => mem[name].delete(k),
    });
    fn({ lists: store('lists'), tasks: store('tasks'), subtasks: store('subtasks'), reminders: store('reminders'), prefs: store('prefs'), meta: store('meta') });
  },
}));

/* ---------- localStorage شیم (زمان آخرین پشتیبان) ---------- */
const lsStore = new Map<string, string>();
// @ts-expect-error — محیط تست
globalThis.localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
};

const { parseBackupFile, backupCountsOf, restoreBackup, parseErrorText, markLastBackupNow, getLastBackupAt, BACKUP_VERSION } =
  await import('@/lib/backup');

const now = '2026-01-05T08:30:00.000Z';
const older = '2025-12-01T08:30:00.000Z';

const healthyFile = {
  app: 'karam',
  kind: 'backup',
  version: 1,
  exportedAt: '2026-01-04T18:00:00.000Z',
  counts: { lists: 1, tasks: 2, subtasks: 1, reminders: 1 },
  lists: [{ id: 'list-aaaaaaaa', name: 'خرید', emoji: '🛒', color: 'teal', sortOrder: 0, createdAt: older, updatedAt: older, deletedAt: null }],
  tasks: [
    { id: 'task-aaaaaaaa', listId: 'list-aaaaaaaa', title: 'نان', createdAt: older, updatedAt: older, deletedAt: null },
    { id: 'task-bbbbbbbb', listId: 'list-aaaaaaaa', title: 'شیر', createdAt: older, updatedAt: older, deletedAt: null },
  ],
  subtasks: [{ id: 'sub-aaaaaaaa', taskId: 'task-aaaaaaaa', title: 'بربری', createdAt: older, updatedAt: older, deletedAt: null }],
  reminders: [{ id: 'rem-aaaaaaaa', taskId: 'task-bbbbbbbb', remindAt: '2026-01-06T09:00:00.000Z', createdAt: older, updatedAt: older, deletedAt: null }],
};

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  lsStore.clear();
});

describe('parseBackupFile — اعتبارسنجی پیش‌نمایش', () => {
  test('فایل سالم → ok=true و شمارش درست', () => {
    const p = parseBackupFile(JSON.stringify(healthyFile));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.file.counts.tasks).toBe(2);
  });

  test('JSON خراب → corrupt', () => {
    const p = parseBackupFile('{این JSON نیست');
    expect(p).toEqual({ ok: false, reason: 'corrupt' });
  });

  test('JSON سالم اما آرایه/عدد → corrupt', () => {
    expect(parseBackupFile('[1,2,3]')).toEqual({ ok: false, reason: 'corrupt' });
    expect(parseBackupFile('42')).toEqual({ ok: false, reason: 'corrupt' });
  });

  test('فایل غیرکارام (اپ دیگر) → not-karam', () => {
    const p = parseBackupFile(JSON.stringify({ app: 'other-app', kind: 'export', data: [] }));
    expect(p).toEqual({ ok: false, reason: 'not-karam' });
  });

  test('فایل کارام اما kind اشتباه → not-karam', () => {
    const p = parseBackupFile(JSON.stringify({ ...healthyFile, kind: 'something-else' }));
    expect(p).toEqual({ ok: false, reason: 'not-karam' });
  });

  test('نسخه‌ی جدیدتر از BACKUP_VERSION → newer-version', () => {
    const p = parseBackupFile(JSON.stringify({ ...healthyFile, version: BACKUP_VERSION + 1 }));
    expect(p).toEqual({ ok: false, reason: 'newer-version' });
  });

  test('بدون نسخه / نسخه‌ی بی‌معنا → corrupt', () => {
    const noVersion = { ...healthyFile } as Record<string, unknown>;
    delete noVersion.version;
    expect(parseBackupFile(JSON.stringify(noVersion))).toEqual({ ok: false, reason: 'corrupt' });
    expect(parseBackupFile(JSON.stringify({ ...healthyFile, version: 'یک' }))).toEqual({ ok: false, reason: 'corrupt' });
  });

  test('متن‌های فارسی خطاها — سه پیام تفکیک‌شده', () => {
    expect(parseErrorText('not-karam')).toBe('فایل پشتیبان کارام نیست');
    expect(parseErrorText('newer-version')).toContain('نسخه‌ی جدیدتر');
    expect(parseErrorText('corrupt')).toContain('خراب');
  });

  test('backupCountsOf — counts هماهنگ و نبودش (هم‌الگوی P1.3)', () => {
    expect(backupCountsOf(healthyFile)).toEqual({ lists: 1, tasks: 2, subtasks: 1, reminders: 1 });
    const withoutCounts = { ...healthyFile } as Record<string, unknown>;
    delete withoutCounts.counts;
    expect(backupCountsOf(withoutCounts)).toEqual({ lists: 1, tasks: 2, subtasks: 1, reminders: 1 });
  });

  test('P1.4 — counts دست‌کاری‌شده هرگز در شمارش اثر نمی‌گذارد (همیشه از آرایه‌ها)', () => {
    type BF = Parameters<typeof backupCountsOf>[0];
    // counts به‌عنوان رشته / null — نباید اثر بگذارد و نباید undefined برگرداند
    expect(backupCountsOf({ ...healthyFile, counts: '۲۰' } as unknown as BF)).toEqual({
      lists: 1,
      tasks: 2,
      subtasks: 1,
      reminders: 1,
    });
    expect(backupCountsOf({ ...healthyFile, counts: null } as unknown as BF)).toEqual({
      lists: 1,
      tasks: 2,
      subtasks: 1,
      reminders: 1,
    });
    // عدد منفی
    expect(backupCountsOf({ ...healthyFile, counts: { lists: -5, tasks: -9, subtasks: -1, reminders: -3 } })).toEqual({
      lists: 1,
      tasks: 2,
      subtasks: 1,
      reminders: 1,
    });
    // عدد بزرگ ناهماهنگ با آرایه‌ها
    expect(backupCountsOf({ ...healthyFile, counts: { lists: 999, tasks: 999, subtasks: 999, reminders: 999 } })).toEqual({
      lists: 1,
      tasks: 2,
      subtasks: 1,
      reminders: 1,
    });
    // آرایه‌ی نبودن = ۰ — حتی اگر counts عدد بزرگی ادعا کند
    const noArrays = {
      app: 'karam',
      kind: 'backup',
      version: 1,
      exportedAt: '',
      counts: { lists: 7, tasks: 7, subtasks: 7, reminders: 7 },
    } as unknown as BF;
    expect(backupCountsOf(noArrays)).toEqual({ lists: 0, tasks: 0, subtasks: 0, reminders: 0 });
  });
});

describe('restoreBackup — ادغام LWW بدون حذف', () => {
  test('نصب تازه: همه افزوده می‌شوند و چیزی حذف نمی‌شود', async () => {
    const r = await restoreBackup(JSON.stringify(healthyFile));
    expect(r).toEqual({ added: 5, updated: 0, kept: 0, invalid: false });
    expect(mem.tasks.get('task-aaaaaaaa')?.['title']).toBe('نان');
  });

  test('رکورد فایل جدیدتر → updated؛ رکورد محلی جدیدتر → kept', async () => {
    // نسخه‌ی محلی قدیمی‌تر از فایل → updated
    mem.tasks.set('task-aaaaaaaa', { id: 'task-aaaaaaaa', title: 'نان (قدیمی)', updatedAt: '2025-01-01T00:00:00.000Z' });
    // نسخه‌ی محلی جدیدتر از فایل → kept
    mem.tasks.set('task-bbbbbbbb', { id: 'task-bbbbbbbb', title: 'شیر محلی جدید', updatedAt: '2026-06-01T00:00:00.000Z' });
    // رکورد محلی که در فایل نیست → باید دست‌نخورده بماند (هیچ‌چیز حذف نمی‌شود)
    mem.tasks.set('task-cccccccc', { id: 'task-cccccccc', title: 'فقط محلی', updatedAt: now });

    const r = await restoreBackup(JSON.stringify(healthyFile));
    expect(r.invalid).toBe(false);
    expect(r.updated).toBe(1);
    expect(r.kept).toBe(1);
    expect(r.added).toBe(3); // لیست + زیرکار + یادآور
    expect(mem.tasks.get('task-aaaaaaaa')?.['title']).toBe('نان'); // از فایل
    expect(mem.tasks.get('task-bbbbbbbb')?.['title']).toBe('شیر محلی جدید'); // محلی ماند
    expect(mem.tasks.get('task-cccccccc')?.['title']).toBe('فقط محلی'); // دست نخورد
  });

  test('دفاع دوم: فایل نسخه‌ی جدیدتر → invalid + reason و صفر نوشتن', async () => {
    mem.lists.set('list-aaaaaaaa', { id: 'list-aaaaaaaa', name: 'قبل از تلاش خراب', updatedAt: older });
    const r = await restoreBackup(JSON.stringify({ ...healthyFile, version: BACKUP_VERSION + 1 }));
    expect(r.invalid).toBe(true);
    expect(r.reason).toBe('newer-version');
    expect(mem.lists.get('list-aaaaaaaa')?.['name']).toBe('قبل از تلاش خراب');
  });

  test('فایل غیرکارام در restore → invalid با reason درست', async () => {
    expect((await restoreBackup('not json at all')).reason).toBe('corrupt');
    expect((await restoreBackup(JSON.stringify({ app: 'x', kind: 'y' }))).reason).toBe('not-karam');
  });
});

describe('زمان آخرین پشتیبان (محلی)', () => {
  test('پیش از ذخیره: null — بعد از markLastBackupNow: ثبت و خوانده می‌شود', () => {
    expect(getLastBackupAt()).toBeNull();
    markLastBackupNow();
    const v = getLastBackupAt();
    expect(v).not.toBeNull();
    expect(isNaN(new Date(v ?? '').getTime())).toBe(false);
  });
});

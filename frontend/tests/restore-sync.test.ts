/**
 * کارام — ممیزی و رگرسیون «بازیابی ↔ سینک» (P1.4 — کار ۳)
 *
 * اجرا:  cd frontend && bun test tests/restore-sync.test.ts
 *
 * فرضیه‌ی ممیزی: restoreBackup رکوردها را با updatedAt اصلی فایل می‌نویسد و
 * collectChanges فقط ردیف‌های جدیدتر از «نقطه‌ی آخرین سینک» (meta key
 * «sync-last-push» در STORES.meta) را push می‌کند ⇒ رکورد افزوده/به‌روزشده با
 * updatedAt قدیمی‌تر از آخرین سینک، روی دستگاهی که قبلاً سینک کرده، هرگز به
 * سرور نمی‌رود.
 *
 * شبیه‌سازی با mock IndexedDB (هم‌الگوی phase1/backup-parse) + authedFetch ساختگی
 * که بدنه‌ی pushها را ثبت می‌کند — یعنی کل چرخه‌ی واقعی runSync اندازه‌گیری می‌شود.
 *
 * پوشش:
 *   ۱) رکورد «افزوده‌شده» با updatedAt قدیمی‌تر از نقطه‌ی سینک → باید به سرور برسد
 *   ۲) رکورد «به‌روز شده» با updatedAt قدیمی‌تر از نقطه‌ی سینک → باید به سرور برسد
 *   ۳) بازیابی بی‌تغییر (همه kept) → نقطه‌ی سینک دست نمی‌خورد
 *   ۴) مهمان (بدون نشست) → نقطه‌ی سینک دست نمی‌خورد
 *   ۵) قرارداد «هیچ‌چیز حذف نمی‌شود» در همه‌ی سناریوها
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی phase1/backup-parse) ---------- */
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
  // سطح کامل — چون mock.module بین فایل‌های تست در یک فرایند نشت می‌کند
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

/* ---------- نشست ساختگی (حساب ابری فعال) ---------- */
const fakeSession = {
  userUuid: 'user-uuid-1',
  email: 'test@example.com',
  channel: 'email' as const,
  displayName: null,
  accessToken: 'access-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  refreshToken: 'refresh-token',
  refreshExpiresAt: '2099-01-01T00:00:00.000Z',
  deviceUuid: 'device-uuid-1',
  deviceName: 'bun-test',
};
let sessionImpl: () => Promise<typeof fakeSession | null> = async () => fakeSession;

mock.module('@/sync/session', () => ({
  // سطح کامل session.ts — نشت mock.module بین فایل‌های تست
  getSession: () => sessionImpl(),
  setSession: async () => undefined,
  clearSession: async () => undefined,
  getDeviceUuid: async () => 'device-uuid-1',
}));

/* ---------- authedFetch ساختگی — بدنه‌ی همه‌ی pushها ثبت می‌شود ---------- */
interface PushedPayload {
  cursor: string | null;
  pull: 0 | 1;
  deviceUuid: string;
  changes: { lists: Row[]; tasks: Row[]; subtasks: Row[] };
}
const pushCalls: PushedPayload[] = [];

const okResponse = () => ({
  applied: { lists: 0, tasks: 0, subtasks: 0 },
  rejected: [] as { entity: string; id: string; reason: string }[],
  server: { lists: [], tasks: [], subtasks: [] },
  cursor: 'cursor-after-pull',
  serverTime: new Date().toISOString(),
});

mock.module('@/sync/api', () => ({
  // سطح کامل api.ts — نشت mock.module بین فایل‌های تست
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  apiFetch: async () => {
    throw new Error('apiFetch نباید در این تست صدا شود');
  },
  refreshSession: async () => false,
  authedFetch: async (_path: string, opts: { body?: PushedPayload }) => {
    pushCalls.push(opts.body as PushedPayload);
    return okResponse();
  },
}));

/* ---------- بعد از mockها، ماژول‌های تحت تست ---------- */
const { restoreBackup } = await import('@/lib/backup');
const { runSync } = await import('@/sync/engine');

/* ---------- ثابت‌های سناریو ---------- */
// نقطه‌ی آخرین سینک موفق دستگاه (sync-last-push)
const SYNC_POINT = '2026-01-05T00:00:00.000Z';
// updatedAt رکوردهای فایل پشتیبان — «قدیمی‌تر از نقطه‌ی سینک» (قلب فرضیه)
const OLD_AT = '2025-06-01T00:00:00.000Z';
// نسخه‌ی محلیِ خیلی قدیمی (برای سناریوی «به‌روز شد»)
const VERY_OLD_AT = '2025-01-01T00:00:00.000Z';

const backupFile = {
  app: 'karam',
  kind: 'backup',
  version: 1,
  exportedAt: '2025-06-02T08:00:00.000Z',
  counts: { lists: 1, tasks: 1, subtasks: 0, reminders: 0 },
  lists: [{ id: 'list-restored01', name: 'آزمایشی پژوهش', emoji: '🧪', color: 'teal', sortOrder: 0, createdAt: OLD_AT, updatedAt: OLD_AT, deletedAt: null }],
  tasks: [{ id: 'task-restored1', listId: 'list-restored01', title: 'کار بازیابی‌شده', createdAt: OLD_AT, updatedAt: OLD_AT, deletedAt: null }],
  subtasks: [],
  reminders: [],
};

const metaRow = (key: string, value: unknown): Row => ({ key, value });

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  pushCalls.length = 0;
  sessionImpl = async () => fakeSession;
});

/** تخلیه‌ی تایمر صف سینک (queueSync داخل reset) تا تست بعدی تمیز شروع شود */
const drainSyncQueue = () => new Promise<void>((r) => setTimeout(r, 700));

describe('P1.4 — ممیزی بازیابی ↔ سینک (رکورد قدیمی‌تر از نقطه‌ی سینک)', () => {
  test('۱) «افزوده‌شده» با updatedAt قدیمی‌تر از sync-last-push باید به سرور برسد', async () => {
    // دستگاه قبلاً سینک کرده: نقطه‌ی سینک + کرسر pull موجود
    mem.meta.set('sync-last-push', metaRow('sync-last-push', SYNC_POINT));
    mem.meta.set('sync-cursor', metaRow('sync-cursor', 'old-cursor'));
    // یک رکورد محلی که در فایل نیست (قرارداد «هیچ‌چیز حذف نمی‌شود»)
    mem.tasks.set('task-localonly', { id: 'task-localonly', title: 'فقط محلی', updatedAt: SYNC_POINT });

    const report = await restoreBackup(JSON.stringify(backupFile));
    expect(report.invalid).toBe(false);
    expect(report.added).toBe(2); // لیست + کار
    expect(report.updated).toBe(0);

    // مدرک مستقیم: بعد از بازیابی مؤثر، نقطه‌های سینک باید ریست شده باشند
    expect(mem.meta.get('sync-last-push')).toBeUndefined();
    expect(mem.meta.get('sync-cursor')).toBeUndefined();
    // updatedAt رکورد بازیابی‌شده هرگز دستکاری نمی‌شود
    expect(mem.tasks.get('task-restored1')?.['updatedAt']).toBe(OLD_AT);

    // چرخه‌ی واقعی سینک — push باید رکورد قدیمی را شامل شود
    await runSync();
    const pushedTasks = pushCalls.flatMap((c) => c.changes?.tasks ?? []);
    const pushedLists = pushCalls.flatMap((c) => c.changes?.lists ?? []);
    const pushedTask = pushedTasks.find((t) => t.id === 'task-restored1');
    expect(pushedTask).toBeTruthy(); // ← پیش از اصلاح P1.4 همین‌جا می‌شکست
    expect(pushedTask?.['updatedAt']).toBe(OLD_AT); // با updatedAt اصلی، نه دستکاری‌شده
    expect(pushedLists.some((l) => l.id === 'list-restored01')).toBe(true);

    // هیچ‌چیز حذف نمی‌شود: رکورد محلیِ بی‌ربط و همه‌ی داده‌ها سر جایشان
    expect(mem.tasks.get('task-localonly')).toBeTruthy();
    expect(mem.tasks.size).toBe(2);
    expect(mem.lists.size).toBe(1);

    await drainSyncQueue(); // تایمر صف سینک تخلیه شود
  });

  test('۲) «به‌روز شده» با updatedAt قدیمی‌تر از sync-last-push باید به سرور برسد', async () => {
    mem.meta.set('sync-last-push', metaRow('sync-last-push', SYNC_POINT));
    // نسخه‌ی محلیِ خیلی قدیمی از همان رکورد — فایل جدیدترش است ولی هنوز قدیمی‌تر از نقطه‌ی سینک
    mem.tasks.set('task-restored1', { id: 'task-restored1', title: 'نسخه‌ی محلی کهنه', updatedAt: VERY_OLD_AT });
    mem.lists.set('list-restored01', { id: 'list-restored01', name: 'نسخه‌ی محلی کهنه', updatedAt: VERY_OLD_AT, deletedAt: null });

    const report = await restoreBackup(JSON.stringify(backupFile));
    expect(report.invalid).toBe(false);
    expect(report.updated).toBe(2); // لیست + کار (نسخه‌ی فایل جدیدتر از محلی)
    expect(report.added).toBe(0);

    expect(mem.meta.get('sync-last-push')).toBeUndefined();

    await runSync();
    const pushedTasks = pushCalls.flatMap((c) => c.changes?.tasks ?? []);
    const pushedTask = pushedTasks.find((t) => t.id === 'task-restored1');
    expect(pushedTask).toBeTruthy(); // ← پیش از اصلاح P1.4 همین‌جا می‌شکست
    expect(pushedTask?.['title']).toBe('کار بازیابی‌شده'); // نسخه‌ی فایل
    expect(pushedTask?.['updatedAt']).toBe(OLD_AT); // دستکاری نشده

    await drainSyncQueue();
  });

  test('۳) بازیابی بی‌تغییر (همه kept) → نقطه‌ی سینک دست نمی‌خورد', async () => {
    mem.meta.set('sync-last-push', metaRow('sync-last-push', SYNC_POINT));
    // نسخه‌های محلی جدیدتر از فایل → همه kept
    mem.lists.set('list-restored01', { id: 'list-restored01', name: 'محلی جدیدتر', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null });
    mem.tasks.set('task-restored1', { id: 'task-restored1', title: 'محلی جدیدتر', updatedAt: '2026-06-01T00:00:00.000Z' });

    const report = await restoreBackup(JSON.stringify(backupFile));
    expect(report).toEqual({ added: 0, updated: 0, kept: 2, invalid: false });
    // هیچ تغییر واقعی → نقطه‌ی سینک باید دست‌نخورده بماند
    expect(mem.meta.get('sync-last-push')?.['value']).toBe(SYNC_POINT);
  });

  test('۴) مهمان (بدون نشست ابری) → نقطه‌ی سینک دست نمی‌خورد', async () => {
    sessionImpl = async () => null;
    mem.meta.set('sync-last-push', metaRow('sync-last-push', SYNC_POINT));

    const report = await restoreBackup(JSON.stringify(backupFile));
    expect(report.added).toBe(2);
    // مهمان سینکی ندارد → ریست بی‌معناست و نباید انجام شود
    expect(mem.meta.get('sync-last-push')?.['value']).toBe(SYNC_POINT);
    expect(mem.tasks.get('task-restored1')?.['title']).toBe('کار بازیابی‌شده'); // داده محلی سالم
  });
});

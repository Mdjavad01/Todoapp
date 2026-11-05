/**
 * کارام — تست واحد «تومب‌استون + ساخت دوباره‌ی لیست پیش‌فرض» (اصلاح ۱ — پیگیری بسته‌های A/B)
 *
 * سناریو: لیست پیش‌فرض قطعی (DEFAULT_LIST_ID) قبلاً حذف شده (تومب‌استون با deletedAt قدیمی) و
 * حالا مسیر «نوار افزودن روی صفر لیست» (addQuickTaskBootstrap → ensureAliveDefaultList) همان
 * شناسه را دوباره می‌سازد.
 *
 * قراردادهایی که باید برای همیشه برقرار بمانند (خواسته‌ی صاحب محصول — گزارش اصلاح ۱):
 *   ۱) فلگ حذف خاموش می‌شود — deletedAt: null روی «همان شناسه» (نه ساخت شناسه‌ی دوم)
 *   ۲) updatedAt جدیدتر از تومب‌استون می‌شود (now > لحظه‌ی حذف)
 *   ۳) سینک آن را نمی‌خوابانَد:
 *      - push: نسخه‌ی زنده (deletedAt=null) با updatedAt جدیدتر از نقطه‌ی سینک به سرور می‌رود
 *      - pull: اکوی تومب‌استونِ قدیمی‌ترِ سرور هرگز روی نسخه‌ی زنده‌ی محلی اعمال نمی‌شود
 *        (revTupleStrictlyNewer — قرینه‌ی tupleGreaterOrEqual سرور)
 *   ۴) اگر هنوز لیست زنده‌ای هست، هیچ بازسازی‌ای انجام نمی‌شود (false — بدون نوشتن)
 *
 * اجرا:  cd frontend && bun test tests/bootstrap-resurrect.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی phase1/restore-sync) ---------- */
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
  // سطح کامل — چون mock.module بین فایل‌های تست در یک فرایند نشت می‌کند
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

/* ---------- نشست ساختگی (حساب ابری فعال — سینک فقط با نشست اجرا می‌شود) ---------- */
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

/* ---------- authedFetch ساختگی — بدنه‌ی push ثبت می‌شود؛ پاسخ شامل «اکوی سرور» است ---------- */
interface PushedPayload {
  cursor: string | null;
  pull: 0 | 1;
  deviceUuid: string;
  changes: { lists: Row[]; tasks: Row[]; subtasks: Row[] };
}
const pushCalls: PushedPayload[] = [];
/** اکوی سرور — همان تومب‌استون قدیمی که «نباید» روی نسخه‌ی زنده‌ی محلی اعمال شود */
let serverEcho: { lists: Row[]; tasks: Row[]; subtasks: Row[] } = { lists: [], tasks: [], subtasks: [] };

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
    return {
      applied: { lists: 0, tasks: 0, subtasks: 0 },
      rejected: [] as { entity: string; id: string; reason: string }[],
      server: serverEcho,
      cursor: 'cursor-after-pull',
      serverTime: new Date().toISOString(),
    };
  },
}));

/* ---------- بعد از mockها، ماژول‌های تحت تست ---------- */
const { ensureAliveDefaultList } = await import('@/db/seed');
const { runSync } = await import('@/sync/engine');
const { DEFAULT_LIST_ID, revTupleStrictlyNewer } = await import('@/sync/lww');

/* ---------- ثابت‌های سناریو ---------- */
const T_CREATE = '2025-01-01T00:00:00.000Z'; // ساخت اولیه‌ی لیست پیش‌فرض
const T_TOMB = '2025-06-01T00:00:00.000Z'; // لحظه‌ی حذف (تومب‌استون) — روی سرور هم همین است
const SYNC_POINT = '2025-07-01T00:00:00.000Z'; // آخرین سینک موفق دستگاه (بعد از حذف)

const tombstone = (): Row => ({
  id: DEFAULT_LIST_ID,
  name: 'کارهای من',
  emoji: '🗂️',
  color: 'teal',
  sortOrder: 0,
  pinned: false,
  createdAt: T_CREATE,
  updatedAt: T_TOMB,
  deletedAt: T_TOMB,
});

const metaRow = (key: string, value: unknown): Row => ({ key, value });

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  pushCalls.length = 0;
  serverEcho = { lists: [], tasks: [], subtasks: [] };
  sessionImpl = async () => fakeSession;
});

describe('اصلاح ۱ — تومب‌استون + ساخت دوباره‌ی لیست پیش‌فرض قطعی', () => {
  test('۱) بازسازی روی همان شناسه: deletedAt خاموش + updatedAt جدیدتر + بدون لیست دوم', async () => {
    mem.lists.set(DEFAULT_LIST_ID, tombstone());

    const ok = await ensureAliveDefaultList();
    expect(ok).toBe(true);

    // فقط همان یک رکورد — شناسه‌ی دوم ساخته نشده است
    expect(mem.lists.size).toBe(1);
    const row = mem.lists.get(DEFAULT_LIST_ID);
    expect(row).toBeTruthy();
    // ۱) فلگ حذف خاموش شد
    expect(row?.['deletedAt'] ?? null).toBeNull();
    // ۲) updatedAt از تومب‌استون جدیدتر است
    expect(String(row?.['updatedAt']) > T_TOMB).toBe(true);
    // محتوای پیش‌فرض سالم
    expect(row?.['name']).toBe('کارهای من');
    expect(row?.['createdAt']).toBe(T_CREATE); // createdAt اصلی حفظ شد
  });

  test('۲) قاعده‌ی LWW: نسخه‌ی زنده‌ی تازه از تومب‌استون سرور «کاملاً جدیدتر» است (سرور آن را اعمال می‌کند)', async () => {
    const resurrectedAt = new Date().toISOString();
    const clientTuple = { updatedAt: resurrectedAt };
    const serverTombTuple = { updatedAt: T_TOMB };
    expect(revTupleStrictlyNewer(clientTuple, serverTombTuple)).toBe(true);
    // و برعکسش غلط: تومب‌استون قدیمی هرگز جدیدتر نیست
    expect(revTupleStrictlyNewer(serverTombTuple, clientTuple)).toBe(false);
  });

  test('۳) سینک آن را نمی‌خوابانَد: نسخه‌ی زنده پوش می‌شود و اکوی تومب‌استون قدیمی اعمال نمی‌شود', async () => {
    mem.lists.set(DEFAULT_LIST_ID, tombstone());
    const ok = await ensureAliveDefaultList();
    expect(ok).toBe(true);
    const resurrectedAt = String(mem.lists.get(DEFAULT_LIST_ID)?.['updatedAt']);

    // دستگاه قبلاً سینک کرده؛ سرور هنوز تومب‌استونِ قدیمی را دارد
    mem.meta.set('sync-last-push', metaRow('sync-last-push', SYNC_POINT));
    mem.meta.set('sync-cursor', metaRow('sync-cursor', 'old-cursor'));
    serverEcho = { lists: [tombstone()], tasks: [], subtasks: [] };

    await runSync();

    // push: نسخه‌ی زنده (deletedAt=null) با updatedAt تازه به سرور رفت — نه تومب‌استون
    const pushedLists = pushCalls.flatMap((c) => c.changes?.lists ?? []);
    const pushed = pushedLists.find((l) => l.id === DEFAULT_LIST_ID);
    expect(pushed).toBeTruthy();
    expect(pushed?.['deletedAt']).toBeNull();
    expect(pushed?.['updatedAt']).toBe(resurrectedAt);

    // pull: اکوی قدیمی‌تر اعمال نشد — لیست محلی همچنان زنده است
    const after = mem.lists.get(DEFAULT_LIST_ID);
    expect(after?.['deletedAt'] ?? null).toBeNull();
    expect(after?.['updatedAt']).toBe(resurrectedAt);
  });

  test('۴) اگر لیست زنده‌ی دیگری هست، بازسازی انجام نمی‌شود (بدون بازنویسی تومب‌استون)', async () => {
    mem.lists.set(DEFAULT_LIST_ID, tombstone());
    mem.lists.set('user-list-1', {
      id: 'user-list-1',
      name: 'لیست خودم',
      emoji: '🧩',
      color: 'amber',
      sortOrder: 1,
      createdAt: T_CREATE,
      updatedAt: T_CREATE,
      deletedAt: null,
    });

    const ok = await ensureAliveDefaultList();
    expect(ok).toBe(false);

    // تومب‌استون دست نخورد — هیچ لیست سومی هم ساخته نشد
    expect(mem.lists.get(DEFAULT_LIST_ID)?.['deletedAt']).toBe(T_TOMB);
    expect(mem.lists.size).toBe(2);
  });

  test('۵) صفر لیست (حتی بدون تومب‌استون) → لیست پیش‌فرض تازه ساخته می‌شود', async () => {
    const ok = await ensureAliveDefaultList();
    expect(ok).toBe(true);
    expect(mem.lists.size).toBe(1);
    const row = mem.lists.get(DEFAULT_LIST_ID);
    expect(row?.['deletedAt'] ?? null).toBeNull();
    expect(row?.['name']).toBe('کارهای من');
  });
});

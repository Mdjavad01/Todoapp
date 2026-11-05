/**
 * کارام — بسته D: پاک‌سازی بی‌صدای داده‌ی نمونه‌ی نصب‌های قدیمی
 *
 * اجرا:  cd frontend && bun test tests/demo-cleanup-silent.test.ts
 *
 * قرارداد بسته D:
 *   ۱) نصب تازه ⇒ اسکن null ⇒ هیچ‌چیز لمس نمی‌شود
 *   ۲) حساب دارای کارهای واقعی (حتی با عنوان شبیه دمو، حتی در لیستی با نام سید) ⇒ کار واقعی هرگز نامزد نمی‌شود
 *   ۳) پاک‌سازی = فقط حذف نرم (deletedAt + updatedAt تازه) و واگرد همه‌ی ردیف‌ها را
 *      با updatedAt «جدیدتر از تومب‌استون» زنده می‌کند ⇒ بر LWW می‌چربد و با سینک
 *      به سرور و دستگاه‌های دیگر می‌رسد (تومب‌استون push می‌شود، واگردِ جدیدتر بر آن می‌چربد)
 *
 * شبیه‌سازی با mock IndexedDB درون‌حافظه‌ای (هم‌الگوی restore-sync/phase1).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی restore-sync) ---------- */
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

/* ---------- بعد از mock، ماژول‌های تحت تست ---------- */
const { scanLegacyDemos, runDemoCleanup, undoDemoCleanup } = await import('../src/db/demoCleanup');
const { DEFAULT_LIST_ID, DEFAULT_LIST_NAME, SEED_LIST_NAMES } = await import('../src/sync/lww');
const { DEMO_TASK_TITLES } = await import('../src/db/demoCleanup');
import type { ListEntity, ReminderEntity, SubtaskEntity, TaskEntity } from '../src/types';

/* ---------- ابزار ساخت داده ---------- */
let seq = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const T0 = '2025-01-10T08:00:00.000Z'; // لحظه‌ی ساخت سید قدیمی
const LATER = '2025-03-15T09:00:00.000Z'; // زمان‌های واقعی کاربر

const mkList = (name: string, overrides: Partial<ListEntity> = {}): ListEntity => ({
  id: nextId(),
  name,
  emoji: '🗂️',
  color: 'teal',
  sortOrder: 0,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...overrides,
});

const mkTask = (listId: string, title: string, overrides: Partial<TaskEntity> = {}): TaskEntity => ({
  id: nextId(),
  listId,
  title,
  notes: '',
  priority: 'normal',
  dueDate: null,
  dueTime: null,
  reminderMinutes: null,
  repeat: 'none',
  starred: false,
  repeatMeta: null,
  completedAt: null,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...overrides,
});

const mkSub = (taskId: string, title: string, overrides: Partial<SubtaskEntity> = {}): SubtaskEntity => ({
  id: nextId(),
  taskId,
  title,
  completedAt: null,
  sortOrder: 0,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...overrides,
});

const mkRem = (taskId: string, overrides: Partial<ReminderEntity> = {}): ReminderEntity => ({
  id: nextId(),
  taskId,
  fireAt: '2025-03-20T08:00:00.000Z',
  minutesBefore: 30,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...overrides,
});

/** خالی‌کردن انبار بین تست‌ها */
beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
});

/** نوشتن دنیای داده در mock idb — هم‌شکل بوت‌استرپ واقعی */
async function seedIdb(lists: ListEntity[], tasks: TaskEntity[], subs: SubtaskEntity[] = [], rems: ReminderEntity[] = []) {
  for (const l of lists) await mem.lists.set(l.id, l as unknown as Row);
  for (const t of tasks) await mem.tasks.set(t.id, t as unknown as Row);
  for (const s of subs) await mem.subtasks.set(s.id, s as unknown as Row);
  for (const r of rems) await mem.reminders.set(r.id, r as unknown as Row);
}

/** دنیای سید قدیمی: ۶ لیست سید + ۸ کار دموی دسته‌ای + زیرکار/یادآور + کار واقعی کاربر */
function legacyWorld() {
  const [home, shop, study, trade, bills, work] = SEED_LIST_NAMES.map((n) => mkList(n));
  const lists = [home, shop, study, trade, bills, work];
  const demoTitles = DEMO_TASK_TITLES.slice(0, 8);
  const demoTasks = demoTitles.map((t, i) => mkTask(lists[i % lists.length].id, t, { createdAt: T0, updatedAt: T0 }));
  const subs = [mkSub(demoTasks[0].id, 'زیرکار نمونه‌ی دمو'), mkSub(demoTasks[1].id, 'زیرکار دموی دوم')];
  const rems = [mkRem(demoTasks[2].id)];
  // کار واقعی کاربر: عنوانِ دقیقاً شبیه دمو ولی در لیستِ خودش با ساخت دستی (پراکنده)
  const userList = mkList('پروژه‌ی شخصی من', { createdAt: LATER, updatedAt: LATER, sortOrder: 10 });
  const realTask = mkTask(userList.id, DEMO_TASK_TITLES[0], { createdAt: LATER, updatedAt: LATER, priority: 'high' });
  // و یک کار واقعی در لیستی با نام سید («کاری») — ساخت دستی، ویرایش‌شده → هرگز نامزد نمی‌شود
  const realInSeedNamed = mkTask(work.id, 'جلسه‌ی دوشنبه با تیم', { createdAt: LATER, updatedAt: LATER });
  return { lists: [...lists, userList], demoTasks, subs, rems, realTask, realInSeedNamed, userList, work };
}

/* ---------- ۱) نصب تازه ---------- */

describe('بسته D — نصب تازه', () => {
  test('اسکن روی نصب تازه (فقط لیست پیش‌فرض خالی) ⇒ null — هیچ‌چیز لمس نمی‌شود', async () => {
    const lists = [mkList(DEFAULT_LIST_NAME, { id: DEFAULT_LIST_ID, createdAt: LATER, updatedAt: LATER })];
    await seedIdb(lists, []);
    const scan = scanLegacyDemos([], lists);
    expect(scan).toBeNull();
    // کل قرارداد «پاک‌سازی بی‌صدا»: اسکن null یعنی هیچ ردیفی در idb تومب‌استون نمی‌شود
    expect([...mem.lists.values()].every((r) => !r.deletedAt)).toBe(true);
    expect([...mem.tasks.values()].every((r) => !r.deletedAt)).toBe(true);
  });

  test('نصب تازه با چند کار واقعی تازه‌ساخت ⇒ باز هم null', async () => {
    const def = mkList(DEFAULT_LIST_NAME, { id: DEFAULT_LIST_ID, createdAt: LATER, updatedAt: LATER });
    const t1 = mkTask(def.id, 'خرید نان', { createdAt: LATER, updatedAt: LATER });
    const t2 = mkTask(def.id, 'تمرین پیانو', { createdAt: LATER, updatedAt: LATER });
    await seedIdb([def], [t1, t2]);
    expect(scanLegacyDemos([t1, t2], [def])).toBeNull();
    expect([...mem.tasks.values()].every((r) => !r.deletedAt)).toBe(true);
  });
});

/* ---------- ۲) حساب دارای کارهای واقعی — نباید لمس شود ---------- */

describe('بسته D — حساب واقعی دست‌نخورده', () => {
  test('کارهای واقعی کاربر در دنیای حاوی دمو هرگز نامزد نمی‌شوند', () => {
    const w = legacyWorld();
    const scan = scanLegacyDemos([...w.demoTasks, w.realTask, w.realInSeedNamed], w.lists);
    expect(scan).not.toBeNull();
    const picked = new Set(scan!.tasks.map((t) => t.id));
    expect(picked.has(w.realTask.id)).toBe(false);
    expect(picked.has(w.realInSeedNamed.id)).toBe(false);
    expect(picked.size).toBe(w.demoTasks.length); // فقط دموها
    // لیست واقعی کاربر هرگز در نامزدهای لیست نیست
    expect(scan!.lists.some((l) => l.id === w.userList.id)).toBe(false);
  });

  test('لیست واقعی کاربر با نام سید ولی دارای کار زنده ⇒ از نامزدهای لیست بیرون می‌ماند', () => {
    const w = legacyWorld();
    const scan = scanLegacyDemos([...w.demoTasks, w.realTask, w.realInSeedNamed], w.lists);
    // «کاری» (work) بعد از پاک‌سازی دموها هنوز کار واقعی دارد ⇒ تومب‌استون نمی‌شود
    expect(scan!.lists.some((l) => l.id === w.work.id)).toBe(false);
  });

  test('اجزای واقعی بعد از پاک‌سازی بی‌صدا زنده می‌مانند (فقط دموها تومب‌استون)', async () => {
    const w = legacyWorld();
    await seedIdb(w.lists, [...w.demoTasks, w.realTask, w.realInSeedNamed], w.subs, w.rems);
    const scan = scanLegacyDemos([...w.demoTasks, w.realTask, w.realInSeedNamed], w.lists);
    expect(scan).not.toBeNull();
    await runDemoCleanup(scan!);
    expect((mem.tasks.get(w.realTask.id) as unknown as TaskEntity).deletedAt).toBeNull();
    expect((mem.tasks.get(w.realInSeedNamed.id) as unknown as TaskEntity).deletedAt).toBeNull();
    for (const d of w.demoTasks) {
      expect((mem.tasks.get(d.id) as unknown as TaskEntity).deletedAt).not.toBeNull();
    }
  });
});

/* ---------- ۳) واگرد — بازگردانی دقیق با LWW پیروز ---------- */

describe('بسته D — واگرد پاک‌سازی بی‌صدا', () => {
  test('پاک‌سازی فقط حذف نرم می‌کند؛ واگرد همه را با updatedAt جدیدتر زنده می‌کند', async () => {
    const w = legacyWorld();
    await seedIdb(w.lists, [...w.demoTasks, w.realTask, w.realInSeedNamed], w.subs, w.rems);
    const scan = scanLegacyDemos([...w.demoTasks, w.realTask, w.realInSeedNamed], w.lists);
    expect(scan).not.toBeNull();

    const before = Date.now();
    const snap = await runDemoCleanup(scan!);
    const afterCleanup = Date.now();

    // تومب‌استون‌ها: deletedAt پر + updatedAt تازه (⇒ collectChanges آن‌ها را push می‌کند)
    const tomb = mem.tasks.get(w.demoTasks[0].id) as unknown as TaskEntity;
    expect(tomb.deletedAt).not.toBeNull();
    expect(Date.parse(tomb.updatedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(tomb.updatedAt)).toBeLessThanOrEqual(afterCleanup + 1000);
    // زیرکار و یادآورِ نامزدها هم تومب‌استون شده‌اند
    expect(snap.subtasks.length).toBe(w.subs.length);
    expect(snap.reminders.length).toBe(w.rems.length);
    // هیچ‌چیز فیزیکی حذف نشده (قرارداد «فقط حذف نرم»)
    expect(mem.tasks.size).toBe(w.demoTasks.length + 2);

    await undoDemoCleanup(snap);

    // واگرد: deletedAt خالی + updatedAt «جدیدتر از تومب‌استون» ⇒ LWW بر تومب‌استون می‌چربد
    const undone = mem.tasks.get(w.demoTasks[0].id) as unknown as TaskEntity;
    expect(undone.deletedAt).toBeNull();
    expect(Date.parse(undone.updatedAt)).toBeGreaterThan(Date.parse(tomb.updatedAt));
    for (const s of snap.subtasks) {
      const row = mem.subtasks.get(s.id) as unknown as SubtaskEntity;
      expect(row.deletedAt).toBeNull();
      expect(Date.parse(row.updatedAt)).toBeGreaterThan(Date.parse(s.updatedAt));
    }
    for (const r of snap.reminders) {
      const row = mem.reminders.get(r.id) as unknown as ReminderEntity;
      expect(row.deletedAt).toBeNull();
    }
    for (const l of snap.lists) {
      const row = mem.lists.get(l.id) as unknown as ListEntity;
      expect(row.deletedAt).toBeNull();
    }
    // کار واقعی از واگرد مسیر نمی‌برد
    expect((mem.tasks.get(w.realTask.id) as unknown as TaskEntity).deletedAt).toBeNull();
  });

  test('واگردِ دیرهنگام (بعد از رسیدن تومب‌استون به دستگاه دیگر) هنوز برنده‌ی LWW است', async () => {
    // شبیه‌سازی: تومب‌استون با «حذفِ فوران شده از دستگاه دیگر» برخورد کند —
    // کلید واگرد = updatedAt جدیدتر؛ همین یک ویژگی کافی است (قرارداد LWW مشترک با سرور)
    const w = legacyWorld();
    await seedIdb(w.lists, w.demoTasks, [], []);
    const scan = scanLegacyDemos(w.demoTasks, w.lists);
    const snap = await runDemoCleanup(scan!);
    const tombTime = (mem.tasks.get(w.demoTasks[0].id) as unknown as TaskEntity).updatedAt;
    await undoDemoCleanup(snap);
    const undoneTime = (mem.tasks.get(w.demoTasks[0].id) as unknown as TaskEntity).updatedAt;
    expect(undoneTime > tombTime).toBe(true);
  });
});

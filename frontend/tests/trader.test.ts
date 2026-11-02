/**
 * کارام — تست کلاینت «فاز تریدر» (چک‌لیست تریدر)
 *
 * اجرا:  cd frontend && bun test tests/trader.test.ts
 *
 * پوشش:
 *   ۱) داده‌ی تمپلیت: ۵ لیست با نام دقیق، پین فقط «قوانین من»، تکرار روزانه/هفتگی (جمعه) و انواع آیتم
 *   ۲) توابع خالص: normalizeTime / addMinutesToTime / nextWeekdayIso / traderDisciplineAvg
 *   ۳) compareLists — پین‌شده‌ها همیشه اول (حتی با سطرهای قدیمیِ بدون pinned)
 *   ۴) فعال‌سازی ایدمپوتنت با store واقعی (mock IndexedDB): دو بار فعال‌سازی = بدون لیست/آیتم تکراری
 *      + کارهای لنگر یادآور (شروع ۳۰ دقیقه قبل / پایان+۳۰ دقیقه با یادآور ۰)
 *   ۵) تغییر ساعت سشن — فقط کارهای لنگر به‌روز می‌شوند
 *   ۶) ریست تیک‌های «قبل از معامله» — مقادیر دست نمی‌خورند
 *   ۷) بازنشانی — ۵ لیست تومب‌استون می‌شوند و نشانگر پاک می‌شود
 *   ۸) setListPinned + ترتیب پس از پین
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { ListEntity, TaskEntity } from '@/types';
import type { TraderPref } from '@/db/traderTemplate';

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
  STORES: { lists: 'lists', tasks: 'tasks', subtasks: 'subtasks', reminders: 'reminders', prefs: 'prefs', meta: 'meta' },
  DB_NAME: 'karam-db',
  DB_VERSION: 2,
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

/* ---------- stub حداقلی window برای bun (showToast از window.setTimeout استفاده می‌کند) ---------- */
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.window === 'undefined') {
  g.window = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/* ---------- ماژول‌های تحت تست (بعد از mock) ---------- */
const { compareLists, sortedLists } = await import('@/lib/selectors');
const {
  TRADER_TEMPLATE,
  TRADER_LIST_NAMES,
  TRADER_RULES_LIST,
  TRADER_PRETRADE_LIST,
  TRADER_ANCHOR_START,
  TRADER_ANCHOR_END,
  TRADER_PREF_KEY,
  TRADER_PRETRADE_FOOTER,
  normalizeTime,
  addMinutesToTime,
  nextWeekdayIso,
  traderRulesValues,
  traderDisciplineAvg,
  isTraderActive,
  findTraderLists,
} = await import('@/db/traderTemplate');
const { useAppStore } = await import('@/store/useAppStore');
const repo = await import('@/db/repo');

const nowIso = () => new Date().toISOString();

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  useAppStore.setState({ lists: [], tasks: [], subtasks: [], traderPref: null, toast: null });
});

/* ---------- ۱) داده‌ی تمپلیت ---------- */
describe('داده‌ی تمپلیت تریدر', () => {
  test('۵ لیست با نام‌های دقیق و پین فقط روی «قوانین من»', () => {
    expect(TRADER_TEMPLATE).toHaveLength(5);
    expect(TRADER_TEMPLATE.map((l) => l.name)).toEqual(TRADER_LIST_NAMES);
    for (const l of TRADER_TEMPLATE) {
      expect(l.pinned === true).toBe(l.name === TRADER_RULES_LIST);
      expect(l.items.length).toBeGreaterThan(0);
    }
  });

  test('تکرار: آیتم‌های روزانه در پیش/بعد از بازار و هفتگی جمعه در ریویو — بدون تکرار در قوانین و قبل از معامله', () => {
    const pre = TRADER_TEMPLATE.find((l) => l.name === 'پیش از بازار')!;
    const post = TRADER_TEMPLATE.find((l) => l.name === 'بعد از بازار')!;
    const review = TRADER_TEMPLATE.find((l) => l.name === 'ریویو هفتگی')!;
    const rules = TRADER_TEMPLATE.find((l) => l.name === TRADER_RULES_LIST)!;
    const pretrade = TRADER_TEMPLATE.find((l) => l.name === TRADER_PRETRADE_LIST)!;
    expect(pre.items.every((i) => i.repeat === 'daily')).toBe(true);
    expect(post.items.every((i) => i.repeat === 'daily')).toBe(true);
    expect(review.items.every((i) => i.repeat === 'custom' && i.repeatMeta?.unit === 'week' && i.repeatMeta.days?.[0] === 6)).toBe(true);
    expect(rules.items.every((i) => i.repeat === undefined)).toBe(true);
    expect(pretrade.items.every((i) => i.repeat === undefined)).toBe(true);
    // انواع آیتم: عدد/یادداشت/انتخاب/امتیاز حتماً در تمپلیت باشند
    const types = new Set(TRADER_TEMPLATE.flatMap((l) => l.items.map((i) => i.type ?? 'check')));
    expect(types.has('num')).toBe(true);
    expect(types.has('note')).toBe(true);
    expect(types.has('choice')).toBe(true);
    expect(types.has('score')).toBe(true);
    expect(types.has('check')).toBe(true);
    // متن ثابت و صادقانه‌ی محدودیت تکرار موجود است
    expect(TRADER_PRETRADE_FOOTER).toContain('معامله نکن');
  });
});

/* ---------- ۲) توابع خالص ---------- */
describe('توابع خالص تریدر', () => {
  test('normalizeTime — ورودی‌های آزاد به HH:mm قطعی', () => {
    expect(normalizeTime('9:5')).toBe('09:05');
    expect(normalizeTime('09:30')).toBe('09:30');
    expect(normalizeTime('24:00')).toBe(null);
    expect(normalizeTime('09:60')).toBe(null);
    expect(normalizeTime('abc')).toBe(null);
    expect(normalizeTime('')).toBe(null);
  });

  test('addMinutesToTime — چرخه‌ی شبانه‌روزی', () => {
    expect(addMinutesToTime('17:30', 30)).toBe('18:00');
    expect(addMinutesToTime('23:45', 30)).toBe('00:15');
    expect(addMinutesToTime('00:00', 1440)).toBe('00:00');
  });

  test('nextWeekdayIso — جمعه (۶) نزدیک‌ترین', () => {
    // چهارشنبه ۱۹ نوامبر ۲۰۲۵ → getDay=3 → jalaliWeekday=4 → جمعه = ۲ روز بعد = ۲۱ نوامبر
    const wed = new Date(2025, 10, 19);
    expect(nextWeekdayIso(6, wed)).toBe('2025-11-21');
    // پنج‌شنبه ۲۰ نوامبر → جمعه‌ی بعد = فردا
    const thu = new Date(2025, 10, 20);
    expect(nextWeekdayIso(6, thu)).toBe('2025-11-21');
    // جمعه ۲۱ نوامبر → خودش
    const fri = new Date(2025, 10, 21);
    expect(nextWeekdayIso(6, fri)).toBe('2025-11-21');
    // شنبه ۲۲ نوامبر → جمعه‌ی بعد ۶ روز بعد
    const sat = new Date(2025, 10, 22);
    expect(nextWeekdayIso(6, sat)).toBe('2025-11-28');
  });

  test('traderDisciplineAvg — فقط امتیازهای هفته‌ی اخیر', () => {
    const now = new Date('2026-02-08T12:00:00.000Z');
    const mk = (id: string, val: string | null, completedAt: string | null, title = 'امتیاز انضباط امروز'): TaskEntity =>
      ({
        id,
        listId: 'l1',
        title,
        notes: '',
        priority: 'normal',
        dueDate: null,
        dueTime: null,
        reminderMinutes: null,
        repeat: 'none',
        starred: false,
        repeatMeta: null,
        itemType: 'score',
        itemValue: val,
        completedAt,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
      }) as TaskEntity;
    const tasks = [
      mk('t1', '7', '2026-02-08T10:00:00.000Z'),
      mk('t2', '9', '2026-02-06T10:00:00.000Z'),
      mk('t3', '5', '2026-01-20T10:00:00.000Z'), // خارج از ۷ روز
      mk('t4', '10', null), // بی‌تیک
      mk('t5', null, '2026-02-07T10:00:00.000Z'), // بدون مقدار
      mk('t6', '8', '2026-02-07T10:00:00.000Z', 'امتیاز کلی انضباط هفته'), // عنوان دیگر — فقط «امتیاز انضباط امروز»
      mk('t7', 'abc', '2026-02-07T10:00:00.000Z'), // مقدار غیرعددی
    ];
    const { avg, count } = traderDisciplineAvg(tasks, now);
    expect(count).toBe(2);
    expect(avg).toBe(8);
  });

  test('traderRulesValues — فقط آیتم‌های پرشده‌ی «قوانین من»', () => {
    const list: ListEntity = {
      id: 'l1', name: TRADER_RULES_LIST, emoji: '📌', color: 'rose', sortOrder: 0, pinned: true,
      createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null,
    };
    const t = (id: string, title: string, val: string | null): TaskEntity =>
      ({
        id, listId: 'l1', title, notes: '', priority: 'normal', dueDate: null, dueTime: null,
        reminderMinutes: null, repeat: 'none', starred: false, repeatMeta: null,
        itemType: 'note', itemValue: val, completedAt: null,
        createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null,
      }) as TaskEntity;
    const tasks = [t('t1', 'حداکثر ضرر روزانه', '۲٪'), t('t2', 'ریسک هر معامله', ''), t('t3', 'چیز دیگر', 'x')];
    const rules = traderRulesValues([list], tasks);
    expect(rules.maxLoss).toBe('۲٪');
    expect(rules.risk).toBe(null);
    expect(traderRulesValues([], tasks).maxLoss).toBe(null);
  });
});

/* ---------- ۳) مرتب‌سازی پین ---------- */
describe('compareLists — پین‌شده‌ها اول', () => {
  const mkList = (id: string, sortOrder: number, pinned?: boolean): ListEntity =>
    ({ id, name: id, emoji: 'x', color: 'teal', sortOrder, pinned, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null }) as ListEntity;

  test('پین‌شده قبل از ناپین با هر sortOrder', () => {
    const a = mkList('a', 0);
    const b = mkList('b', 99, true);
    expect(compareLists(b, a)).toBe(-1);
    expect(sortedLists([a, b]).map((l) => l.id)).toEqual(['b', 'a']);
  });

  test('سطرهای قدیمی بدون pinned (undefined) = ناپین', () => {
    const a = mkList('a', 0);
    delete (a as Record<string, unknown>).pinned;
    const b = mkList('b', 1, true);
    expect(sortedLists([a, b]).map((l) => l.id)).toEqual(['b', 'a']);
  });

  test('دو پین‌شده → ترتیب قبلی (sortOrder)', () => {
    const x = mkList('x', 5, true);
    const y = mkList('y', 1, true);
    expect(sortedLists([x, y]).map((l) => l.id)).toEqual(['y', 'x']);
  });
});

/* ---------- ۴) فعال‌سازی ایدمپوتنت با store واقعی ---------- */
describe('فعال‌سازی تمپلیت تریدر (store + IndexedDB mock)', () => {
  test('فعال‌سازی دوباره = هیچ تکراری؛ لنگرها درست؛ pref ثبت می‌شود', async () => {
    const s = useAppStore.getState();
    const ok1 = await s.activateTraderTemplate('9:0', '17:30');
    expect(ok1).toBe(true);

    let lists = await repo.listsAll();
    let tasks = await repo.tasksAll();
    expect(lists).toHaveLength(5);
    // ۳۰ آیتم تمپلیت + ۲ لنگر یادآور
    expect(tasks).toHaveLength(32);
    // «قوانین من» پین است و در مرتب‌سازی اول می‌آید
    const sorted = sortedLists(lists);
    expect(sorted[0].name).toBe(TRADER_RULES_LIST);
    expect(sorted[0].pinned).toBe(true);
    expect(isTraderActive(lists)).toBe(true);
    expect(findTraderLists(lists)).toHaveLength(5);

    // لنگر شروع: ۰۹:۰۰ با یادآور ۳۰ دقیقه قبل؛ لنگر پایان: ۱۸:۰۰ (پایان+۳۰) با یادآور ۰
    const anchorStart = tasks.find((t) => t.title === TRADER_ANCHOR_START)!;
    const anchorEnd = tasks.find((t) => t.title === TRADER_ANCHOR_END)!;
    expect(anchorStart.dueTime).toBe('09:00');
    expect(anchorStart.reminderMinutes).toBe(30);
    expect(anchorStart.repeat).toBe('daily');
    expect(anchorEnd.dueTime).toBe('18:00');
    expect(anchorEnd.reminderMinutes).toBe(0);
    // آیتم‌های هفتگی: سررسید = یک جمعه (jalaliWeekday 6)
    const reviewList = lists.find((l) => l.name === 'ریویو هفتگی')!;
    const weekly = tasks.filter((t) => t.listId === reviewList.id);
    expect(weekly.length).toBe(6);
    for (const t of weekly) {
      const jw = (new Date(`${t.dueDate}T00:00:00`).getDay() + 1) % 7;
      expect(jw).toBe(6);
      expect(t.repeatMeta?.days?.[0]).toBe(6);
    }

    // pref ثبت شده است
    const pref = await repo.prefsGet<TraderPref | null>(TRADER_PREF_KEY, null);
    expect(pref?.start).toBe('09:00');
    expect(pref?.end).toBe('17:30');

    /* فعال‌سازی دوباره — ایدمپوتنس */
    const ok2 = await s.activateTraderTemplate('09:00', '17:30');
    expect(ok2).toBe(true);
    lists = await repo.listsAll();
    tasks = await repo.tasksAll();
    expect(lists).toHaveLength(5);
    expect(tasks).toHaveLength(32);
    expect(lists.filter((l) => l.name === TRADER_RULES_LIST)).toHaveLength(1);
  });

  test('ساعت نامعتبر = رد بدون هیچ ساختی', async () => {
    const s = useAppStore.getState();
    const ok = await s.activateTraderTemplate('25:00', '17:30');
    expect(ok).toBe(false);
    expect(await repo.listsAll()).toHaveLength(0);
    expect(await repo.tasksAll()).toHaveLength(0);
  });

  test('تغییر ساعت سشن — فقط لنگرها عوض می‌شوند', async () => {
    const s = useAppStore.getState();
    await s.activateTraderTemplate('09:00', '17:30');
    const before = (await repo.tasksAll()).find((t) => t.title !== TRADER_ANCHOR_START && t.title !== TRADER_ANCHOR_END)!;
    await s.setTraderSessionTimes('08:15', '16:45');
    const tasks = await repo.tasksAll();
    const anchorStart = tasks.find((t) => t.title === TRADER_ANCHOR_START)!;
    const anchorEnd = tasks.find((t) => t.title === TRADER_ANCHOR_END)!;
    expect(anchorStart.dueTime).toBe('08:15');
    expect(anchorStart.reminderMinutes).toBe(30);
    expect(anchorEnd.dueTime).toBe('17:15'); // 16:45 + ۳۰ دقیقه
    // آیتم غیرلنگر دست نخورده
    const after = tasks.find((t) => t.id === before.id)!;
    expect(after.dueTime).toBe(before.dueTime);
    expect(after.dueDate).toBe(before.dueDate);
  });

  test('ریست تیک‌های «قبل از معامله» — مقادیر می‌مانند', async () => {
    const s = useAppStore.getState();
    await s.activateTraderTemplate('09:00', '17:30');
    const list = (await repo.listsAll()).find((l) => l.name === TRADER_PRETRADE_LIST)!;
    const items = (await repo.tasksAll()).filter((t) => t.listId === list.id);
    await repo.tasksToggleComplete(items[0].id, true);
    await repo.tasksToggleComplete(items[1].id, true);
    await useAppStore.getState().refresh(); // مثل واقعیت — هر تغییر بعد از خواندن دوباره، در state می‌آید
    await s.resetPretradeTicks();
    const after = (await repo.tasksAll()).filter((t) => t.listId === list.id);
    expect(after.every((t) => t.completedAt === null)).toBe(true);
    expect(after).toHaveLength(items.length);
  });

  test('بازنشانی — ۵ لیست تومب‌استون و نشانگر پاک می‌شود؛ فعال‌سازی مجدد ممکن', async () => {
    const s = useAppStore.getState();
    await s.activateTraderTemplate('09:00', '17:30');
    await s.resetTraderTemplate();
    const all = [...mem.lists.values()] as ListEntity[];
    const live = all.filter((l) => !l.deletedAt);
    expect(live.length).toBe(1); // لیست پیش‌فرض «کارهای من» برمی‌گردد
    expect(all.filter((l) => l.deletedAt)).toHaveLength(5);
    const pref = await repo.prefsGet<TraderPref | null>(TRADER_PREF_KEY, null);
    expect(pref ?? null).toBe(null);
    expect(useAppStore.getState().traderPref).toBe(null);
    // فعال‌سازی مجدد بدون خطا و بدون تداخل با تومب‌استون‌ها
    const ok = await s.activateTraderTemplate('10:00', '18:00');
    expect(ok).toBe(true);
    expect(await repo.listsAll()).toHaveLength(5 + 1);
  });
});

/* ---------- ۵) پین با store ---------- */
describe('setListPinned با store', () => {
  test('پین/رفع پین سینک‌پذیر و در ترتیب اثر می‌گذارد', async () => {
    const s = useAppStore.getState();
    await s.activateTraderTemplate('09:00', '17:30');
    const rules = (await repo.listsAll()).find((l) => l.name === TRADER_RULES_LIST)!;
    await s.setListPinned(rules.id, false);
    let lists = await repo.listsAll();
    expect(lists.find((l) => l.id === rules.id)!.pinned).toBe(false);
    await s.setListPinned(rules.id, true);
    lists = await repo.listsAll();
    expect(lists.find((l) => l.id === rules.id)!.pinned).toBe(true);
  });
});

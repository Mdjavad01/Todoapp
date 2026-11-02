/**
 * کارام — تست کلاینت «P2.0 — بسته‌های شغلی + بستن بدهی templateKey»
 *
 * اجرا:  cd frontend && bun test tests/jobpacks.test.ts
 *
 * پوشش:
 *   ۱) داده‌ی سه بسته: ساختار، راهنما، لنگرهای یادآور، تکرارها، کلیدهای معتبر
 *   ۲) یکتایی جهانی نام لیست‌های قالبی (قالب رایگان + تریدر + بسته‌ها + نام‌های رزروشده)
 *   ۳) توابع خالص templateKey: قدیمی‌ترین دارنده‌ی کلید، تحمل کلید تکراری، کلید نامعتبر
 *   ۴) activateJobPack با store واقعی (IndexedDB mock): کلیدها نوشته می‌شوند، لنگرها درست،
 *      سررسید روزانه/هفتگی درست
 *   ۵) فعال‌سازی دوباره = بدون تکرار؛ تغییر نام لیست هم بدون تکرار (معیار اصلی بستن بدهی)
 *   ۶) فال‌بک نامی: لیست قدیمیِ هم‌نام (بدون کلید) تصاحب و کلید می‌گیرد؛ آیتم تیک‌شده تکرار نمی‌شود
 *   ۷) دو لیست با یک کلید (دو‌دستگاه هم‌زمان): لیست سومی ساخته نمی‌شود، هیچ‌کدام حذف نمی‌شود
 *   ۸) resetJobPack: تومب‌استون لیست‌های بسته + بازگشت لیست پیش‌فرض وقتی همه حذف شدند
 *   ۹) تریدر با کلید: کلیدها نوشته می‌شوند و تغییر نام، تشخیص فعال‌بودن را نمی‌شکند
 *  ۱۰) applyTemplate (قالب رایگان): ایدمپوتنت با کلید + تصاحب لیست قدیمی هم‌نام
 *
 * نکته: قفل پرو در UI است (JobKitsView)؛ منطق استور مستقل از premium تست می‌شود.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- انبار IndexedDB درون‌حافظه‌ای (mock — هم‌الگوی trader.test.ts) ---------- */
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

/* ---------- stub حداقلی window برای bun ---------- */
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
const { JOB_PACKS, packItemCount, packListKey, findPackLists, isPackActive, PACK_REPEAT_NOTICE, RESERVED_TEMPLATE_LIST_NAMES } =
  await import('@/db/jobPacks');
const { TEMPLATES } = await import('@/db/catalog');
const { TRADER_TEMPLATE, TRADER_LIST_NAMES, TRADER_LIST_KEYS, isTraderActive } = await import('@/db/traderTemplate');
const {
  templateListKey,
  isValidTemplateKey,
  findListByKey,
  findTemplateList,
  isTemplateActive,
} = await import('@/db/templateKey');
const { useAppStore } = await import('@/store/useAppStore');
const repo = await import('@/db/repo');
import type { ListEntity } from '@/types';

beforeEach(() => {
  for (const m of Object.values(mem)) m.clear();
  useAppStore.setState({ lists: [], tasks: [], subtasks: [], traderPref: null, toast: null });
});

/* ---------- helpers ---------- */
const liveLists = () => [...mem.lists.values()].filter((l) => !l.deletedAt) as unknown as ListEntity[];
const liveTasks = () => [...mem.tasks.values()].filter((t) => !t.deletedAt) as unknown as import('@/types').TaskEntity[];
function makeList(name: string, opts: Partial<ListEntity> = {}): ListEntity {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? crypto.randomUUID(),
    name,
    emoji: opts.emoji ?? '📁',
    color: opts.color ?? 'teal',
    sortOrder: opts.sortOrder ?? 0,
    pinned: opts.pinned ?? false,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    ...opts,
  } as ListEntity;
}
async function putList(l: ListEntity): Promise<void> {
  await mem.lists.set(l.id, l as unknown as Row);
}

/* ---------- ۱) داده‌ی بسته‌ها ---------- */
describe('داده‌ی بسته‌های شغلی', () => {
  test('سه بسته با شناسه‌های قطعی و ساختار کامل (راهنما + آیتم)', () => {
    expect(JOB_PACKS.map((p) => p.id)).toEqual(['kit-freelance', 'kit-store', 'kit-student']);
    for (const p of JOB_PACKS) {
      expect(p.lists.length).toBeGreaterThanOrEqual(4);
      expect(p.lists.length).toBeLessThanOrEqual(5);
      for (const l of p.lists) {
        expect(l.guide.trim().length).toBeGreaterThan(5);
        expect(l.items.length).toBeGreaterThan(0);
        for (const it of l.items) expect(it.title.trim().length).toBeGreaterThan(1);
      }
    }
    expect(PACK_REPEAT_NOTICE).toContain('اندروید');
  });

  test('لنگرهای یادآور: هر آیتمِ دارای ساعت، دقیقه‌ی یادآور معتبر دارد و برعکس', () => {
    for (const p of JOB_PACKS) {
      for (const l of p.lists) {
        for (const it of l.items) {
          if (it.dueTime) {
            expect(/^\d{2}:\d{2}$/.test(it.dueTime)).toBe(true);
            expect(typeof it.reminderMinutes).toBe('number');
            expect(it.reminderMinutes!).toBeGreaterThanOrEqual(0);
          } else {
            expect(it.reminderMinutes).toBeUndefined();
          }
        }
      }
    }
  });

  test('تکرارها: روزانه یا سفارشی هفتگی — repeatMeta فقط با repeat=custom', () => {
    for (const p of JOB_PACKS) {
      for (const l of p.lists) {
        for (const it of l.items) {
          const r = it.repeat ?? 'none';
          expect(['none', 'daily', 'custom']).toContain(r);
          if (it.repeatMeta) {
            expect(r).toBe('custom');
            expect(it.repeatMeta.unit).toBe('week');
            expect((it.repeatMeta.days ?? []).every((d) => d >= 0 && d <= 6)).toBe(true);
          }
        }
      }
    }
  });

  test('یکتایی جهانی نام لیست‌های قالبی — بسته‌ها با هیچ قالب/نام رزروشده‌ای برخورد ندارند', () => {
    const packNames = JOB_PACKS.flatMap((p) => p.lists.map((l) => l.name));
    const others = [
      ...TEMPLATES.map((t) => t.listName),
      ...TRADER_LIST_NAMES,
      ...RESERVED_TEMPLATE_LIST_NAMES, // شامل نام‌های قالب‌های رایگان/تریدر و kit های قدیمی — عمداً رزرو است
    ];
    // گزاره‌ی واقعی: هیچ نام بسته‌ای در قالب‌ها/تریدر/رزروها نیست (RESERVED خودش عمداً نام قالب‌های فعلی را هم دارد)
    expect(packNames.some((n) => others.includes(n))).toBe(false);
    // و خود بسته‌ها هم بین خودشان یکتا
    expect(new Set(packNames).size).toBe(packNames.length);
  });

  test('کلیدها: قالب معتبر، ≤۳۲ کاراکتر و یکتا در سراسر سیستم', () => {
    const keys = [
      ...TRADER_LIST_KEYS,
      ...TEMPLATES.map((t) => t.templateKey),
      ...JOB_PACKS.flatMap((p) => p.lists.map((_, i) => packListKey(p.id, i))),
    ];
    for (const k of keys) {
      expect(isValidTemplateKey(k)).toBe(true);
      expect(k.length).toBeLessThanOrEqual(32);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ---------- ۲) توابع خالص templateKey ---------- */
describe('توابع templateKey', () => {
  test('قدیمی‌ترین دارنده‌ی کلید برنده است (تحمل کلید تکراری دو‌دستگاهی)', () => {
    const old = makeList('الف', { id: 'id-old', createdAt: '2026-01-01T00:00:00Z', templateKey: 'kit-x.0' });
    const neu = makeList('ب', { id: 'id-new', createdAt: '2026-02-01T00:00:00Z', templateKey: 'kit-x.0' });
    expect(findListByKey([neu, old], 'kit-x.0')?.id).toBe('id-old');
  });

  test('کلید نامعتبر/تومب‌استون نادیده گرفته می‌شود', () => {
    expect(isValidTemplateKey('Bad Key')).toBe(false);
    expect(isValidTemplateKey('کلید-فارسی')).toBe(false);
    expect(isValidTemplateKey('a'.repeat(33))).toBe(false);
    expect(findListByKey([makeList('الف', { templateKey: 'kit-x.0', deletedAt: new Date().toISOString() })], 'kit-x.0')).toBeUndefined();
  });

  test('تشخیص: اول کلید، بعد فال‌بک نام — فعال‌بودن ترکیبی هم درست', () => {
    const byName = makeList('لیست بسته', { templateKey: null });
    expect(findTemplateList([byName], 'kit-x.0', 'لیست بسته')?.id).toBe(byName.id);
    const byKey = makeList('نام عوض‌شده', { templateKey: 'kit-x.0' });
    expect(findTemplateList([byName, byKey], 'kit-x.0', 'لیست بسته')?.id).toBe(byKey.id);
    const defs = [{ name: 'لیست بسته' }];
    expect(isTemplateActive([byName], defs, () => 'kit-x.0')).toBe(true);
    expect(isTemplateActive([], defs, () => 'kit-x.0')).toBe(false);
  });
});

/* ---------- ۳) activateJobPack با store واقعی ---------- */
describe('فعال‌سازی بسته‌ی شغلی (store + IndexedDB mock)', () => {
  test('فریلنسر: ۵ لیست با کلید + ۲۳ آیتم + لنگرها با ساعت/یادآور + سررسید روزانه/هفتگی', async () => {
    const store = useAppStore.getState();
    const pack = JOB_PACKS[0]!;
    await store.activateJobPack(pack);
    expect(liveLists().length).toBe(5);
    expect(liveTasks().length).toBe(packItemCount(pack));
    // کلیدها به ترتیب نوشته شده‌اند
    const keys = liveLists().map((l) => l.templateKey).sort();
    expect(keys).toEqual([0, 1, 2, 3, 4].map((i) => packListKey('kit-freelance', i)));
    // لنگر شروع روز
    const anchor = liveTasks().find((t) => t.title === 'شروع روز کاری')!;
    expect(anchor.dueTime).toBe('09:00');
    expect(anchor.reminderMinutes).toBe(15);
    expect(anchor.repeat).toBe('daily');
    expect(anchor.dueDate).not.toBeNull();
    // آیتم هفتگی جمعه
    const weekly = liveTasks().find((t) => t.title === 'درآمد این هفته (هزار تومان)')!;
    expect(weekly.repeat).toBe('custom');
    expect(weekly.repeatMeta).toEqual({ every: 1, unit: 'week', days: [6] });
    expect(weekly.dueDate).not.toBeNull();
    // آیتم بدون تکرار سررسید ندارد
    const deep = liveTasks().find((t) => t.title === 'مهم‌ترین کار امروز (فقط یکی)')!;
    expect(deep.itemType).toBe('note');
    // نوع آیتم score
    const score = liveTasks().find((t) => t.title === 'امتیاز رضایت من از این هفته')!;
    expect(score.itemType).toBe('score');
  });

  test('فعال‌سازی دوباره = هیچ تکراری (لیست و آیتم)', async () => {
    const store = useAppStore.getState();
    const pack = JOB_PACKS[1]!; // فروشگاه
    await store.activateJobPack(pack);
    const lists1 = liveLists().length;
    const tasks1 = liveTasks().length;
    await store.activateJobPack(pack);
    expect(liveLists().length).toBe(lists1);
    expect(liveTasks().length).toBe(tasks1);
  });

  test('معیار بستن بدهی: تغییر نام لیست بسته → فعال‌سازی دوباره باز هم هیچ تکراری نمی‌سازد', async () => {
    const store = useAppStore.getState();
    const pack = JOB_PACKS[0]!;
    await store.activateJobPack(pack);
    // کاربر «کار عمیق» را به «تمرکز عمیق» تغییر نام می‌دهد
    const renamed = liveLists().find((l) => l.templateKey === packListKey('kit-freelance', 1))!;
    await repo.listsUpdate(renamed.id, { name: 'تمرکز عمیق' });
    await useAppStore.getState().refresh();
    expect(isPackActive(useAppStore.getState().lists, pack)).toBe(true); // با کلید پیدا می‌شود
    await store.activateJobPack(pack);
    expect(liveLists().length).toBe(5);
    expect(liveLists().filter((l) => l.name === 'کار عمیق').length).toBe(0);
    expect(liveLists().filter((l) => l.name === 'تمرکز عمیق').length).toBe(1);
    const packTasks = liveTasks().filter((t) => t.listId === renamed.id);
    expect(packTasks.length).toBe(4); // آیتم‌های همان لیست — بدون تکرار
  });

  test('فال‌بک نامی: لیست قدیمی هم‌نام (بدون کلید) تصاحب می‌شود؛ آیتم تیک‌شده تکرار نمی‌شود', async () => {
    // شبیه‌سازی کاربر قدیمی: لیست «سفارش‌های امروز» بدون کلید + یک آیتم تیک‌شده
    const legacy = makeList('سفارش‌های امروز', { createdAt: '2025-12-01T00:00:00Z' });
    await putList(legacy);
    const done = await repo.tasksCreate({ listId: legacy.id, title: 'بسته‌بندی و ارسال امروز انجام شد', priority: 'normal' });
    await repo.tasksUpdate(done.id, { completedAt: new Date().toISOString() });
    await useAppStore.getState().refresh();

    const store = useAppStore.getState();
    await store.activateJobPack(JOB_PACKS[1]!);
    // لیست قدیمی همان لیست قالب است — لیست جدیدی با این نام ساخته نشده
    const same = liveLists().filter((l) => l.name === 'سفارش‌های امروز');
    expect(same.length).toBe(1);
    expect(same[0]!.id).toBe(legacy.id);
    expect(same[0]!.templateKey).toBe(packListKey('kit-store', 0)); // تصاحب کلید
    // آیتم تیک‌شده تکرار نشده
    const packItems = liveTasks().filter((t) => t.listId === legacy.id);
    expect(packItems.filter((t) => t.title === 'بسته‌بندی و ارسال امروز انجام شد').length).toBe(1);
    expect(packItems.filter((t) => t.completedAt).length).toBe(1);
  });

  test('دو لیست با یک کلید (دو‌دستگاه هم‌زمان): لیست سومی ساخته نمی‌شود و هیچ‌کدام حذف نمی‌شود', async () => {
    const a = makeList('برنامه مطالعه امروز', { templateKey: 'kit-student.0', createdAt: '2026-01-01T00:00:00Z' });
    const b = makeList('برنامه مطالعه امروز', { templateKey: 'kit-student.0', createdAt: '2026-01-02T00:00:00Z' });
    await putList(a);
    await putList(b);
    await useAppStore.getState().refresh();
    await useAppStore.getState().activateJobPack(JOB_PACKS[2]!);
    expect(liveLists().length).toBe(5); // ۳ لیست نو + هر دو دارنده‌ی کلید (هیچ‌کدام حذف نمی‌شود)
    const sameKey = liveLists().filter((l) => l.templateKey === 'kit-student.0');
    expect(sameKey.length).toBe(2); // هیچ‌کدام حذف نشده — داده‌ی کاربر دست نمی‌خورد
    // آیتم‌ها فقط در لیست برنده (قدیمی‌تر) ریخته شده‌اند
    const winnerTasks = liveTasks().filter((t) => t.listId === a.id);
    expect(winnerTasks.length).toBe(6);
    expect(liveTasks().filter((t) => t.listId === b.id).length).toBe(0);
  });

  test('بازنشانی بسته: لیست‌های بسته تومب‌استون می‌شوند؛ وقتی همه‌ی لیست‌ها همان بسته بود، لیست پیش‌فرض برمی‌گردد', async () => {
    const store = useAppStore.getState();
    await store.activateJobPack(JOB_PACKS[0]!); // تنها لیست‌های همین بسته
    await store.resetJobPack('kit-freelance');
    expect(liveLists().length).toBeGreaterThanOrEqual(1); // قاعده‌ی همیشه-یک-لیست
    expect(liveLists().some((l) => l.templateKey?.startsWith('kit-freelance'))).toBe(false);
    // فعال‌سازی مجدد ممکن است — لیست پیش‌فرضِ بازگشته + ۵ لیست بسته
    await store.activateJobPack(JOB_PACKS[0]!);
    expect(liveLists().length).toBe(6);
  });
});

/* ---------- ۴) تریدر با کلید ---------- */
describe('تریدر با کلید پایدار (P2.0)', () => {
  test('فعال‌سازی: هر ۵ لیست کلید trader.i می‌گیرد؛ تغییر نام، فعال‌بودن را نمی‌شکند', async () => {
    const store = useAppStore.getState();
    const ok = await store.activateTraderTemplate('09:00', '17:00');
    expect(ok).toBe(true);
    const keys = liveLists().map((l) => l.templateKey);
    for (const k of TRADER_LIST_KEYS) expect(keys).toContain(k);
    // تغییر نام دو لیست — تشخیص با کلید
    const rules = liveLists().find((l) => l.templateKey === 'trader.0')!;
    const review = liveLists().find((l) => l.templateKey === 'trader.4')!;
    await repo.listsUpdate(rules.id, { name: 'قوانین شخصی من' });
    await repo.listsUpdate(review.id, { name: 'مرور هفته' });
    await useAppStore.getState().refresh();
    expect(isTraderActive(useAppStore.getState().lists)).toBe(true);
    // فعال‌سازی دوباره: هیچ لیست تکراری با نام‌های قدیمی ساخته نمی‌شود
    await store.activateTraderTemplate('10:00', '18:00');
    const live = liveLists();
    expect(live.length).toBe(5);
    expect(live.filter((l) => l.name === 'قوانین من').length).toBe(0);
    expect(live.filter((l) => l.name === 'قوانین شخصی من').length).toBe(1);
  });
});

/* ---------- ۵) قالب رایگان ---------- */
describe('applyTemplate — ایدمپوتنت با کلید (رفع آیتم تکراری کلیک دوباره)', () => {
  test('دو بار افزودن = یک لیست و آیتم‌های بدون تکرار', async () => {
    const store = useAppStore.getState();
    const tpl = TEMPLATES[0]!;
    await store.applyTemplate(tpl);
    const n1 = liveTasks().length;
    expect(liveLists().length).toBe(1);
    expect(liveLists()[0]!.templateKey).toBe(tpl.templateKey);
    await store.applyTemplate(tpl);
    expect(liveLists().length).toBe(1);
    expect(liveTasks().length).toBe(n1);
  });

  test('لیست قدیمی هم‌نام (بدون کلید) تصاحب و آیتم‌های تکراری‌اش دوباره ساخته نمی‌شود', async () => {
    const legacy = makeList('خرید سوپرمارکت', { createdAt: '2025-12-01T00:00:00Z' });
    await putList(legacy);
    await repo.tasksCreate({ listId: legacy.id, title: 'نان سنگک', priority: 'normal' });
    await useAppStore.getState().refresh();
    await useAppStore.getState().applyTemplate(TEMPLATES[0]!);
    const same = liveLists().filter((l) => l.name === 'خرید سوپرمارکت');
    expect(same.length).toBe(1);
    expect(same[0]!.id).toBe(legacy.id);
    expect(same[0]!.templateKey).toBe('tpl-market.0');
    expect(liveTasks().filter((t) => t.listId === legacy.id && t.title === 'نان سنگک').length).toBe(1);
  });
});

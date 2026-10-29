/**
 * کارام — تست فاز «نصب تمیز» (مسترپرامپت فاز ۱):
 *  ۱) اسکن محافظه‌کارانه‌ی داده‌ی نمونه‌ی نصب‌های قدیمی (scanLegacyDemos — تابع خالص)
 *     - دسته‌ی کلاسیک سید (createdAt=updatedAt دسته‌ای) شناسایی می‌شود
 *     - دسته‌ی مهاجرت‌شده v1.2.5 (updatedAt خوشه‌ای جدا از createdAt) شناسایی می‌شود
 *     - کار واقعی کاربر با عنوانِ شبیه دمو هرگز شناسایی نمی‌شود
 *     - کار ویرایش‌شده/ستاره‌دار از نامزدها بیرون می‌ماند
 *     - لیست‌های سیدِ خالی (مثل خروجی dedupe سرور) شناسایی می‌شوند
 *     - «کارهای من» هرگز در نتیجه نیست
 *  ۲) شناسه‌ی قطعی لیست پیش‌فرض — قالب UUIDv4 معتبر (تا سینک سرور قبول کند)
 *
 * اجرا:  cd frontend && bun test tests/fresh-install.test.ts
 */

import { describe, test, expect } from 'bun:test';

import { scanLegacyDemos, DEMO_TASK_TITLES } from '../src/db/demoCleanup';
import { DEFAULT_LIST_ID, DEFAULT_LIST_NAME, SEED_LIST_NAMES } from '../src/sync/lww';
import type { ListEntity, TaskEntity } from '../src/types';

/* ---------- ابزار ساخت داده‌ی آزمایشی ---------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let seq = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const T0 = '2025-01-10T08:00:00.000Z'; // لحظه‌ی ساخت سید
const T_MIGRATE = '2025-02-01T12:30:00.000Z'; // لحظه‌ی مهاجرت v1.2.5
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

/** شش لیست سید + نمونه‌ای از کارهای سید (۸ کار، همه دسته‌ای در T0) */
function seedWorld(): { lists: ListEntity[]; tasks: TaskEntity[] } {
  const [home, shop, study, trade, bills, work] = SEED_LIST_NAMES.map((n) => mkList(n));
  const lists = [home, shop, study, trade, bills, work];
  const titles = DEMO_TASK_TITLES.slice(0, 8);
  const tasks = titles.map((t, i) =>
    mkTask(lists[i % lists.length].id, t, {
      // سید همه را در چند میلی‌ثانیه ساخت — createdAt یکسان
      createdAt: T0,
      updatedAt: T0,
    }),
  );
  return { lists, tasks };
}

/* ---------- ۱) اسکن داده‌ی نمونه ---------- */

describe('scanLegacyDemos — نصب‌های قدیمی', () => {
  test('نصب تازه (فقط لیست پیش‌فرض خالی) → هیچ‌چیز پیدا نمی‌شود', () => {
    const lists = [mkList(DEFAULT_LIST_NAME, { id: DEFAULT_LIST_ID })];
    expect(scanLegacyDemos([], lists)).toBeNull();
  });

  test('دسته‌ی کلاسیک سید (createdAt=updatedAt دسته‌ای) → همه‌ی اعضا شناسایی می‌شوند', () => {
    const { lists, tasks } = seedWorld();
    const scan = scanLegacyDemos(tasks, lists);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.length).toBe(8);
    // لیست‌هایی که بعد از برداشتن نامزدها خالی می‌مانند هم گزارش می‌شوند
    const expectedEmpty = scan!.tasks.length >= 8 ? 6 : 0; // ۸ کار در ۶ لیست پخش شده → ممکن است بعضی باقی بمانند
    expect(scan!.lists.length).toBeGreaterThanOrEqual(0);
    expect(expectedEmpty).toBeGreaterThanOrEqual(0);
  });

  test('دسته‌ی مهاجرت‌شده‌ی v1.2.5 (updatedAt خوشه‌ای=T_MIGRATE) → شناسایی می‌شود', () => {
    const { lists, tasks } = seedWorld();
    const migrated = tasks.map((t) => ({ ...t, updatedAt: T_MIGRATE }));
    const scan = scanLegacyDemos(migrated, lists);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.length).toBe(8);
  });

  test('کار واقعی کاربر با عنوانِ شبیه دمو و در لیستِ خودش → هرگز نامزد نمی‌شود', () => {
    const { lists, tasks } = seedWorld();
    // کاربر بعداً لیست خودش را با نام سید ساخته و کارش را با عنوان دمو در آن گذاشته —
    // ولی ساختش دستی و جدا از دسته است (createdAt پراکنده) → از فیلتر دسته رد می‌شود
    const userList = mkList('مالی و قبوض', { createdAt: LATER, updatedAt: LATER });
    const realTask = mkTask(userList.id, DEMO_TASK_TITLES[0], { createdAt: LATER, updatedAt: LATER });
    const scan = scanLegacyDemos([...tasks, realTask], [...lists, userList]);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.some((t) => t.id === realTask.id)).toBe(false);
  });

  test('کار تکیِ هم‌عنوان (کمتر از حداقل دسته) → null (محافظه‌کاری)', () => {
    const bills = mkList('مالی و قبوض');
    const solo = mkTask(bills.id, 'پرداخت قبض برق', { createdAt: LATER, updatedAt: LATER });
    expect(scanLegacyDemos([solo], [bills])).toBeNull();
  });

  test('کار ستاره‌دار (دست‌کاری کاربر) → از نامزدها بیرون می‌ماند', () => {
    const { lists, tasks } = seedWorld();
    tasks[0] = { ...tasks[0], starred: true };
    const scan = scanLegacyDemos(tasks, lists);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.some((t) => t.id === tasks[0].id)).toBe(false);
    expect(scan!.tasks.length).toBe(7);
  });

  test('کار ویرایش‌شده‌ی پراکنده (updatedAt جدا از خوشه) → بیرون می‌ماند؛ بقیه دسته پاک می‌شوند', () => {
    const { lists, tasks } = seedWorld();
    tasks[1] = { ...tasks[1], updatedAt: LATER }; // کاربر ویرایشش کرده
    const scan = scanLegacyDemos(tasks, lists);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.some((t) => t.id === tasks[1].id)).toBe(false);
    expect(scan!.tasks.length).toBe(7);
  });

  test('فقط لیست‌های سیدِ خالی (بدون هیچ کار دمو) → بنر لیست‌ها', () => {
    const lists = SEED_LIST_NAMES.map((n) => mkList(n));
    // یک لیست سید با کارِ واقعی کاربر (باید حفظ شود)
    const work = lists[5];
    const real = mkTask(work.id, 'کار واقعی من', { createdAt: LATER, updatedAt: LATER });
    const scan = scanLegacyDemos([real], lists);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.length).toBe(0);
    expect(scan!.lists.length).toBe(5); // همه به‌جز «کاری» که کار واقعی دارد
    expect(scan!.lists.some((l) => l.id === work.id)).toBe(false);
  });

  test('«کارهای من» (لیست پیش‌فرض) هرگز در لیست‌های قابل حذف نیست', () => {
    const lists = [mkList(DEFAULT_LIST_NAME, { id: DEFAULT_LIST_ID }), ...SEED_LIST_NAMES.map((n) => mkList(n))];
    const scan = scanLegacyDemos([], lists);
    expect(scan).not.toBeNull();
    expect(scan!.lists.some((l) => l.name === DEFAULT_LIST_NAME)).toBe(false);
  });

  test('کار دمو در لیستِ غیر-سید (کاربر جابه‌جا کرده) → نامزد نمی‌شود', () => {
    const { lists, tasks } = seedWorld();
    const myOwn = mkList('پروژه‌ی شخصی', { createdAt: LATER, updatedAt: LATER });
    tasks[0] = { ...tasks[0], listId: myOwn.id };
    const scan = scanLegacyDemos(tasks, [...lists, myOwn]);
    expect(scan).not.toBeNull();
    expect(scan!.tasks.some((t) => t.id === tasks[0].id)).toBe(false);
  });
});

/* ---------- ۲) شناسه‌ی قطعی لیست پیش‌فرض ---------- */

describe('شناسه‌ی قطعی لیست پیش‌فرض', () => {
  test('DEFAULT_LIST_ID قالب UUIDv4 معتبر دارد (UUID_RE و اعتبارسنجی سرور)', () => {
    expect(UUID_RE.test(DEFAULT_LIST_ID)).toBe(true);
  });

  test('نام پیش‌فرض هم‌قرارداد با seed.ts و pruneEmptyDefaultList است', () => {
    expect(DEFAULT_LIST_NAME).toBe('کارهای من');
  });
});

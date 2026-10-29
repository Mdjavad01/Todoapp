/**
 * کارام — پاک‌سازی ایمن داده‌ی نمونه‌ی نصب‌های قدیمی (فاز نصب تمیز — ب)
 *
 * نسخه‌های قدیمی کارام در اولین اجرا ۶ لیست و ~۲۷ کار نمونه می‌ساختند (SEED_TASKS قدیمی).
 * این داده‌ها امروز دیگر ساخته نمی‌شوند (seed.ts فقط یک لیست پیش‌فرض می‌سازد) ولی روی
 * نصب‌های قدیمی باقی مانده‌اند. این ماژول آنها را با «قاعده‌ی محافظه‌کارانه» شناسایی و
 * فقط با رضایت صریح کاربر (بنر یک‌بارمصرف) حذف نرم و سینک‌پذیر می‌کند — با واگرد.
 *
 * قاعده‌ی تشخیص (هر شرط لازم است — بلوک اسکن خالص و تست‌پذیر است):
 *   ۱) عنوان دقیقاً برابر یکی از عنوان‌های سید شناخته‌شده (DEMO_TASK_TITLES)
 *   ۲) کار داخل لیستی با نام سید شناخته‌شده (SEED_LIST_NAMES) و زنده
 *   ۳) ستاره نخورده (ستاره = دست‌کاری کاربر)
 *   ۴) «دسته‌ای بودن»: حداقل ۳ نامزد با createdAt در بازه‌ی ۵ ثانیه (سید همه را در یک اجرا ساخت)
 *   ۵) «هرگز ویرایش‌نشده»: updatedAt نامزد یا ≈ createdAt خودش است یا ≈ مُدِ updatedAt
 *      دسته (اثر مهاجرت v1.2.5 که همه‌ی ردیف‌ها را در یک لحظه بازنویسی کرد)؛ نامزدهای
 *      پراکنده = ویرایش‌شده توسط کاربر → هرگز لمس نمی‌شوند.
 * نتیجه: کار واقعی کاربر (حتی با عنوان شبیه دمو) پاک نمی‌شود.
 */

import { idbGetAll, idbPut, STORES } from './idb';
import { nowIso } from '@/lib/uuid';
import { SEED_LIST_NAMES } from '@/sync/lww';
import type { ListEntity, ReminderEntity, SubtaskEntity, TaskEntity } from '@/types';

/** عنوان‌های دقیق داده‌ی نمونه‌ی نسخه‌های قدیمی (کار + زیرکار) — استخراج‌شده از git تاریخچه */
export const DEMO_TASK_TITLES: readonly string[] = [
  'آزمون آزمایشی هفتگی',
  'آماده‌سازی ارائه هفتگی',
  'ارسال ایمیل به کارفرما',
  'بررسی تقویم اقتصادی هفته',
  'برنامه‌ریزی هفته آینده',
  'به‌روزرسانی رزومه',
  'تست‌های فیزیک حرکت‌شناسی',
  'تعمیر شیر آب آشپزخانه',
  'تعویض فیلتر تصفیه آب',
  'تعویض لامپ مهتابی اتاق کار',
  'تعویض کارتریج داخلی مغزی',
  'تفکیک بسته‌های پلاستیک و بازیافت',
  'تمرین ۲۰ تست عربی',
  'تنظیم پلن معاملاتی هفته',
  'تهیه خلاصه‌نویسی دروس اختصاصی',
  'تهیه لیست خرید ماهانه',
  'ثبت الگوهای معاملاتی موفق',
  'ثبت ژورنال معاملات دیروز',
  'جلسه با تیم فنی و بررسی دپلوی',
  'خرید میوه و سبزیجات',
  'خرید نان سنگک عصر',
  'خرید نان و لبنیات',
  'خرید هدیه تولد مریم',
  'خرید هفتگی سوپرمارکت',
  'خرید ۲ عدد واشر نئوپرن از ابزارفروشی',
  'خلاصه‌ی جلسه آنلاین صنفی',
  'قطع کلید پمپ و بستن فلکه',
  'مرتب کردن میز کار',
  'مرتب کردن پوشه اسناد',
  'مرور ابینگهاوس درس ۲ و ۳',
  'مرور کارت‌های لایتنر',
  'مرور ۳۰ تست شیمی',
  'مطالعه ادبیات — درس ۴',
  'مطالعه کتاب روانشناسی بازار',
  'مقایسه قیمت لوازم برقی',
  'نظافت بالکن و آب‌دادن گلدان‌ها',
  'واریز اجاره خانه',
  'واریز قسط بیمه سلامت',
  'پاسخ به ایمیل‌های صبح',
  'پرداخت قبض برق',
  'پیگیری فاکتور پیمانکار',
  'چیدمان کمد لباس',
];

/** پنجره‌ی «ساخت دسته‌ای» — سید همه‌ی ردیف‌ها را در کسری از ثانیه ساخت */
const BATCH_WINDOW_MS = 5_000;
/** حداقل اعضای دسته برای اطمینان (کار تکی هم‌نام = واقعی فرض می‌شود) */
const MIN_BATCH = 3;
/** فاصله‌ی مجاز updatedAt از مبدأ دسته (سید مستقیم یا مهاجرت v1.2.5) */
const TOUCH_WINDOW_MS = 120_000;

export interface DemoScanResult {
  /** نامزدهای اطمینان‌بالا برای حذف نرم */
  tasks: TaskEntity[];
  /** لیست‌های سیدِ بدون هیچ کار زنده (پس از کنار گذاشتن نامزدها) */
  lists: ListEntity[];
}

const isSeedTitle = (title: string): boolean => (DEMO_TASK_TITLES as readonly string[]).includes(title.trim());

/**
 * اسکن خالص — هیچ دسترسی به IndexedDB/شبکه ندارد (تست واحد مستقیم).
 * null = هیچ داده‌ی نمونه‌ای پیدا نشد.
 */
export function scanLegacyDemos(tasks: TaskEntity[], lists: ListEntity[]): DemoScanResult | null {
  const liveListById = new Map(lists.filter((l) => !l.deletedAt).map((l) => [l.id, l]));
  const pool = tasks.filter(
    (t) =>
      !t.deletedAt &&
      !t.starred &&
      isSeedTitle(t.title) &&
      (() => {
        const l = liveListById.get(t.listId);
        return !!l && (SEED_LIST_NAMES as readonly string[]).includes(l.name);
      })(),
  );

  // دسته‌بندی بر اساس createdAt — پنجره‌ی لغزان ۵ ثانیه
  const sorted = [...pool].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const clusters: TaskEntity[][] = [];
  let current: TaskEntity[] = [];
  for (const t of sorted) {
    if (
      current.length > 0 &&
      Date.parse(t.createdAt) - Date.parse(current[current.length - 1].createdAt) > BATCH_WINDOW_MS
    ) {
      if (current.length >= MIN_BATCH) clusters.push(current);
      current = [];
    }
    current.push(t);
  }
  if (current.length >= MIN_BATCH) clusters.push(current);

  // از هر دسته فقط اعضای «هرگز ویرایش‌نشده» (updatedAt خوشه‌ای) نگه داشته می‌شود
  const picked: TaskEntity[] = [];
  for (const cluster of clusters) {
    // مُدِ updatedAt دسته = مبدأ نوشتن (سید مستقیم یا مهاجرت) — گرد‌شده به ثانیه
    const freq = new Map<number, number>();
    for (const t of cluster) {
      const sec = Math.round(Date.parse(t.updatedAt) / 1000);
      freq.set(sec, (freq.get(sec) ?? 0) + 1);
    }
    let modalSec = 0;
    let modalCount = 0;
    for (const [sec, n] of freq) {
      if (n > modalCount || (n === modalCount && sec < modalSec)) {
        modalSec = sec;
        modalCount = n;
      }
    }
    for (const t of cluster) {
      const u = Date.parse(t.updatedAt);
      const nearOwnCreation = Math.abs(u - Date.parse(t.createdAt)) <= TOUCH_WINDOW_MS;
      const nearModal = Math.abs(u - modalSec * 1000) <= BATCH_WINDOW_MS;
      if (nearOwnCreation || nearModal) picked.push(t);
    }
  }
  // لیست‌های سیدِ خالی (هیچ کار زنده‌ای — با احتساب نامزدهای در انتظار پاک‌سازی)
  // مستقل از نامزدهای کار محاسبه می‌شود — حتی بدون کارِ دمو، لیست‌های خالیِ سید باید
  // با رضایت کاربر قابل پاک‌سازی باشند (خالی‌شده با dedupe سرور یا حذف دستی کارها)
  const pickedIds = new Set(picked.map((t) => t.id));
  const aliveTasks = tasks.filter((t) => !t.deletedAt && !pickedIds.has(t.id));
  const demoLists = lists.filter(
    (l) =>
      !l.deletedAt &&
      (SEED_LIST_NAMES as readonly string[]).includes(l.name) &&
      !aliveTasks.some((t) => t.listId === l.id),
  );

  // هیچ نامزد کاری (کمتر از MIN_BATCH) و هیچ لیست خالی سیُدی → چیزی برای پرسیدن نیست
  if (picked.length === 0 && demoLists.length === 0) return null;
  return { tasks: picked, lists: demoLists };
}

/** اسنپ‌شات واگرد — وضعیت «قبل از پاک‌سازی» برای بازگردانی دقیق */
export interface DemoCleanupSnapshot {
  tasks: TaskEntity[];
  lists: ListEntity[];
  subtasks: SubtaskEntity[];
  reminders: ReminderEntity[];
}

/**
 * اجرای پاک‌سازی (حذف نرم سینک‌پذیر): نامزدها + زیرکارها + یادآورهای زنده‌ی آنها
 * تومب‌استون می‌شوند؛ سپس لیست‌های سیدی که خالی می‌شوند هم. هیچ‌چیز قطعی حذف نمی‌شود.
 */
export async function runDemoCleanup(scan: DemoScanResult): Promise<DemoCleanupSnapshot> {
  const now = nowIso();
  const [allSubs, allRems, allLists] = await Promise.all([
    idbGetAll<SubtaskEntity>(STORES.subtasks),
    idbGetAll<ReminderEntity>(STORES.reminders),
    idbGetAll<ListEntity>(STORES.lists),
  ]);

  const taskIdSet = new Set(scan.tasks.map((t) => t.id));
  const deadSubs = allSubs.filter((s) => !s.deletedAt && taskIdSet.has(s.taskId));
  const deadRems = allRems.filter((r) => !r.deletedAt && taskIdSet.has(r.taskId));

  const snapshot: DemoCleanupSnapshot = {
    tasks: scan.tasks,
    lists: scan.lists,
    subtasks: deadSubs,
    reminders: deadRems,
  };

  for (const t of snapshot.tasks) await idbPut(STORES.tasks, { ...t, deletedAt: now, updatedAt: now });
  for (const s of snapshot.subtasks) await idbPut(STORES.subtasks, { ...s, deletedAt: now, updatedAt: now });
  for (const r of snapshot.reminders) await idbPut(STORES.reminders, { ...r, deletedAt: now, updatedAt: now });
  // لیست‌های خالیِ اسکن‌شده هم حذف نرم می‌شوند (این‌ها «از قبل» خالی بودند)
  for (const l of snapshot.lists) await idbPut(STORES.lists, { ...l, deletedAt: now, updatedAt: now });

  // بازمحاسبه‌ی لیست‌های سیدِ خالی «بعد از» پاک‌سازی (ممکن است لیستی تازه خالی شده باشد)
  const removedTaskIds = new Set(snapshot.tasks.map((t) => t.id));
  const aliveAfter = await allTasksAliveMinus(removedTaskIds);
  const listIds = new Set(snapshot.lists.map((l) => l.id));
  for (const l of allLists) {
    if (l.deletedAt || listIds.has(l.id)) continue;
    if (!(SEED_LIST_NAMES as readonly string[]).includes(l.name)) continue;
    if (!aliveAfter.some((t) => t.listId === l.id)) {
      const row = { ...l, deletedAt: now, updatedAt: now };
      await idbPut(STORES.lists, row);
      snapshot.lists.push(row);
    }
  }
  return snapshot;
}

async function allTasksAliveMinus(removedIds: Set<string>): Promise<TaskEntity[]> {
  const all = await idbGetAll<TaskEntity>(STORES.tasks);
  return all.filter((t) => !t.deletedAt && !removedIds.has(t.id));
}

/** واگرد: همه‌ی ردیف‌های اسنپ‌شات با updatedAt جدید زنده می‌شوند (LWW بر تومب‌استون می‌چربد) */
export async function undoDemoCleanup(snap: DemoCleanupSnapshot): Promise<void> {
  const now = nowIso();
  for (const t of snap.tasks) await idbPut(STORES.tasks, { ...t, deletedAt: null, updatedAt: now });
  for (const s of snap.subtasks) await idbPut(STORES.subtasks, { ...s, deletedAt: null, updatedAt: now });
  for (const r of snap.reminders) await idbPut(STORES.reminders, { ...r, deletedAt: null, updatedAt: now });
  for (const l of snap.lists) await idbPut(STORES.lists, { ...l, deletedAt: null, updatedAt: now });
}

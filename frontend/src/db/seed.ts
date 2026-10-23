import { seedTransaction, idbGetAll, STORES } from './idb';
import { metaGet, metaSet } from './repo';
import { toIsoDate } from '@/lib/format';
import type { ListEntity, TaskEntity, SubtaskEntity, ReminderEntity, PrefEntity } from '@/types';

/**
 * داده‌ی آزمایشی حالت مهمان — اعداد طوری مهندسی شده‌اند که با طراحی مرجع بخوانند:
 * امروز: ۸ کار (۵ انجام‌شده → ۶۵٪) • مهم و فوری: ۳ • برنامه‌ریزی‌شده: ۱۲ • همه‌ی کارها: ۲۷ • معوقه: ۲
 * تاریخ‌ها نسبت به «امروز» ساخته می‌شوند تا اپ همیشه زنده به نظر برسد.
 */

interface SeedTask {
  key: string;
  list: string;
  title: string;
  notes?: string;
  priority?: TaskEntity['priority'];
  dayOffset?: number | null; // ۰=امروز، ۱-۱=دیروز، null/undefined=بدون تاریخ
  time?: string;
  reminderMinutes?: number;
  repeat?: TaskEntity['repeat'];
  doneOffset?: number | null; // اگر انجام‌شده: روز انجام
  subtasks?: { title: string; done: boolean }[];
}

const SEED_LISTS: { key: string; name: string; emoji: string; color: ListEntity['color'] }[] = [
  { key: 'home', name: 'کارهای خانه', emoji: '🏠', color: 'teal' },
  { key: 'shop', name: 'خرید هفتگی', emoji: '🛒', color: 'amber' },
  { key: 'study', name: 'کنکور و مطالعه', emoji: '📚', color: 'indigo' },
  { key: 'trade', name: 'ترید و بازارهای مالی', emoji: '📈', color: 'emerald' },
  { key: 'bills', name: 'مالی و قبوض', emoji: '💳', color: 'rose' },
  { key: 'work', name: 'کاری', emoji: '💼', color: 'purple' },
];

const SEED_TASKS: SeedTask[] = [
  /* ---------- امروز: ۳ کار در انتظار (تایم‌لاین طرح) ---------- */
  {
    key: 't-fizik',
    list: 'study',
    title: 'تست‌های فیزیک حرکت‌شناسی',
    priority: 'normal',
    dayOffset: 0,
    time: '10:00',
  },
  {
    key: 't-meeting',
    list: 'work',
    title: 'جلسه با تیم فنی و بررسی دپلوی',
    notes: 'اتاق جلسات دوم • بررسی نسخه‌ی ۲.۴',
    priority: 'normal',
    dayOffset: 0,
    time: '14:30',
    reminderMinutes: 15,
  },
  {
    key: 't-faucet',
    list: 'home',
    title: 'تعمیر شیر آب آشپزخانه',
    notes: 'خرید واشر و آچار لوله‌گیر قبل از بستن آب اصلی',
    priority: 'urgent',
    dayOffset: 0,
    time: '18:30',
    reminderMinutes: 10,
    subtasks: [
      { title: 'خرید ۲ عدد واشر نئوپرن از ابزارفروشی', done: true },
      { title: 'قطع کلید پمپ و بستن فلکه', done: true },
      { title: 'تعویض کارتریج داخلی مغزی', done: false },
    ],
  },
  /* ---------- معوقه: ۲ کار از دیروز ---------- */
  { key: 't-insurance', list: 'bills', title: 'واریز قسط بیمه سلامت', priority: 'high', dayOffset: -1 },
  { key: 't-email-boss', list: 'work', title: 'ارسال ایمیل به کارفرما', priority: 'high', dayOffset: -1 },
  /* ---------- برنامه‌ریزی‌شده: ۱۲ کار آینده ---------- */
  {
    key: 't-balcony',
    list: 'home',
    title: 'نظافت بالکن و آب‌دادن گلدان‌ها',
    priority: 'normal',
    dayOffset: 1,
    repeat: 'weekly',
  },
  { key: 't-market', list: 'shop', title: 'خرید هفتگی سوپرمارکت', priority: 'normal', dayOffset: 1 },
  { key: 't-fruit', list: 'shop', title: 'خرید میوه و سبزیجات', priority: 'low', dayOffset: 2 },
  { key: 't-gift', list: 'shop', title: 'خرید هدیه تولد مریم', priority: 'low', dayOffset: 2 },
  { key: 't-lit', list: 'study', title: 'مطالعه ادبیات — درس ۴', priority: 'normal', dayOffset: 1 },
  { key: 't-mock', list: 'study', title: 'آزمون آزمایشی هفتگی', priority: 'normal', dayOffset: 3 },
  { key: 't-econcal', list: 'trade', title: 'بررسی تقویم اقتصادی هفته', priority: 'normal', dayOffset: 1 },
  { key: 't-plan', list: 'trade', title: 'تنظیم پلن معاملاتی هفته', priority: 'normal', dayOffset: 4 },
  { key: 't-powerbill', list: 'bills', title: 'پرداخت قبض برق', priority: 'normal', dayOffset: 5 },
  { key: 't-preso', list: 'work', title: 'آماده‌سازی ارائه هفتگی', priority: 'normal', dayOffset: 2 },
  { key: 't-invoice', list: 'work', title: 'پیگیری فاکتور پیمانکار', priority: 'normal', dayOffset: 3 },
  { key: 't-weekplan', list: 'work', title: 'برنامه‌ریزی هفته آینده', priority: 'low', dayOffset: 4 },
  /* ---------- بدون تاریخ (تکمیل مجموع ۲۷ کار در انتظار) ---------- */
  { key: 't-closet', list: 'home', title: 'چیدمان کمد لباس', priority: 'low' },
  { key: 't-filter', list: 'home', title: 'تعویض فیلتر تصفیه آب', priority: 'low' },
  { key: 't-monthly', list: 'shop', title: 'تهیه لیست خرید ماهانه', priority: 'low' },
  { key: 't-compare', list: 'shop', title: 'مقایسه قیمت لوازم برقی', priority: 'low' },
  { key: 't-bread', list: 'shop', title: 'خرید نان سنگک عصر', priority: 'normal' },
  { key: 't-forget', list: 'study', title: 'مرور ابینگهاوس درس ۲ و ۳', priority: 'normal' },
  { key: 't-summary', list: 'study', title: 'تهیه خلاصه‌نویسی دروس اختصاصی', priority: 'low' },
  { key: 't-psy', list: 'trade', title: 'مطالعه کتاب روانشناسی بازار', priority: 'normal' },
  { key: 't-patterns', list: 'trade', title: 'ثبت الگوهای معاملاتی موفق', priority: 'low' },
  { key: 't-resume', list: 'work', title: 'به‌روزرسانی رزومه', priority: 'low' },
  /* ---------- انجام‌شده‌های امروز (۵ تا → ۶۵٪) ---------- */
  { key: 'd-desk', list: 'home', title: 'مرتب کردن میز کار', dayOffset: 0, doneOffset: 0 },
  { key: 'd-dairy', list: 'shop', title: 'خرید نان و لبنیات', dayOffset: 0, doneOffset: 0 },
  { key: 'd-chem', list: 'study', title: 'مرور ۳۰ تست شیمی', dayOffset: 0, doneOffset: 0 },
  { key: 'd-journal', list: 'trade', title: 'ثبت ژورنال معاملات دیروز', dayOffset: 0, doneOffset: 0 },
  { key: 'd-mails', list: 'work', title: 'پاسخ به ایمیل‌های صبح', dayOffset: 0, doneOffset: 0 },
  /* ---------- انجام‌شده‌های روزهای قبل (آکاردئون و نمودار هفته و استریک ۷ روز) ---------- */
  { key: 'd-lamp', list: 'home', title: 'تعویض لامپ مهتابی اتاق کار', dayOffset: -1, doneOffset: -1 },
  { key: 'd-rent', list: 'bills', title: 'واریز اجاره خانه', dayOffset: -1, doneOffset: -1 },
  { key: 'd-recycle', list: 'home', title: 'تفکیک بسته‌های پلاستیک و بازیافت', dayOffset: -2, doneOffset: -2 },
  { key: 'd-notes', list: 'work', title: 'خلاصه‌ی جلسه آنلاین صنفی', dayOffset: -3, doneOffset: -3 },
  { key: 'd-arabi', list: 'study', title: 'تمرین ۲۰ تست عربی', dayOffset: -4, doneOffset: -4 },
  { key: 'd-leitner', list: 'study', title: 'مرور کارت‌های لایتنر', dayOffset: -5, doneOffset: -5 },
  { key: 'd-docs', list: 'home', title: 'مرتب کردن پوشه اسناد', dayOffset: -6, doneOffset: -6 },
];

function dayIso(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toIsoDate(d);
}

function dayAt(offset: number, hh: number, mm: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** در اولین اجرا داده‌ها را می‌کارد؛ اجراهای بعدی دست نمی‌زنند (فقط مهاجرت شناسه‌ها) */
export async function ensureSeeded(): Promise<void> {
  const seeded = await metaGet<number>('seededVersion');
  if (seeded) {
    if (seeded < 2) await migrateSeedIds();
    return;
  }

  const now = new Date().toISOString();
  const listIds: Record<string, string> = {};
  const lists: ListEntity[] = SEED_LISTS.map((l, i) => {
    const id = crypto.randomUUID();
    listIds[l.key] = id;
    return {
      id,
      name: l.name,
      emoji: l.emoji,
      color: l.color,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  });

  const tasks: TaskEntity[] = [];
  const subtasks: SubtaskEntity[] = [];
  const reminders: ReminderEntity[] = [];

  for (const t of SEED_TASKS) {
    const dueDate = t.dayOffset == null ? null : dayIso(t.dayOffset);
    const completedAt = t.doneOffset != null ? dayAt(t.doneOffset, 12, 0) : null;
    const taskId = crypto.randomUUID();
    tasks.push({
      id: taskId,
      listId: listIds[t.list],
      title: t.title,
      notes: t.notes ?? '',
      priority: t.priority ?? 'normal',
      // کارهای انجام‌شده هم تاریخ سررسید خود را نگه می‌دارند تا در آمار «امروز» شمرده شوند
      dueDate: dueDate,
      dueTime: t.time ?? null,
      reminderMinutes: t.reminderMinutes ?? null,
      repeat: t.repeat ?? 'none',
      completedAt,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (t.reminderMinutes != null && t.time && t.dayOffset === 0) {
      const [h, m] = t.time.split(':').map(Number);
      reminders.push({
        id: crypto.randomUUID(),
        taskId,
        fireAt: dayAt(0, h, Math.max(0, m - t.reminderMinutes)),
        fired: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
    if (t.subtasks) {
      t.subtasks.forEach((s) => {
        subtasks.push({
          id: crypto.randomUUID(),
          taskId,
          title: s.title,
          done: s.done,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      });
    }
  }

  const prefs: PrefEntity[] = [
    { key: 'theme', value: 'light' },
    { key: 'accent', value: 'teal' },
    { key: 'biometricLock', value: true },
    { key: 'alerts', value: true },
    { key: 'userName', value: 'علی' },
  ];

  await seedTransaction(async (stores) => {
    for (const l of lists) stores[STORES.lists].put(l);
    for (const t of tasks) stores[STORES.tasks].put(t);
    for (const s of subtasks) stores[STORES.subtasks].put(s);
    for (const r of reminders) stores[STORES.reminders].put(r);
    for (const p of prefs) stores[STORES.prefs].put(p);
    stores[STORES.meta].put({ key: 'seededVersion', value: 2 });
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * مهاجرت نصب‌های فاز ۱: شناسه‌های seed (مثل «seed-list-bills») به UUID واقعی تبدیل می‌شوند
 * تا قرارداد سینک سرور (UUID) رعایت شود. روابط (listId/taskId) بازنگاشت می‌شوند.
 */
async function migrateSeedIds(): Promise<void> {
  const [lists, tasks, subs, rems] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<TaskEntity>(STORES.tasks),
    idbGetAll<SubtaskEntity>(STORES.subtasks),
    idbGetAll<ReminderEntity>(STORES.reminders),
  ]);

  const needs =
    lists.some((l) => !UUID_RE.test(l.id)) ||
    tasks.some((t) => !UUID_RE.test(t.id)) ||
    subs.some((s) => !UUID_RE.test(s.id)) ||
    rems.some((r) => !UUID_RE.test(r.id));

  if (!needs) {
    await metaSet('seededVersion', 2);
    return;
  }

  const now = new Date().toISOString();
  const listMap = new Map(lists.map((l) => [l.id, UUID_RE.test(l.id) ? l.id : crypto.randomUUID()]));
  const taskMap = new Map(tasks.map((t) => [t.id, UUID_RE.test(t.id) ? t.id : crypto.randomUUID()]));

  await seedTransaction(async (stores) => {
    for (const l of lists) {
      const id = listMap.get(l.id)!;
      stores[STORES.lists].delete(l.id);
      stores[STORES.lists].put({ ...l, id, updatedAt: now });
    }
    for (const t of tasks) {
      const id = taskMap.get(t.id)!;
      stores[STORES.tasks].delete(t.id);
      stores[STORES.tasks].put({ ...t, id, listId: listMap.get(t.listId) ?? t.listId, updatedAt: now });
    }
    for (const s of subs) {
      const id = UUID_RE.test(s.id) ? s.id : crypto.randomUUID();
      stores[STORES.subtasks].delete(s.id);
      stores[STORES.subtasks].put({ ...s, id, taskId: taskMap.get(s.taskId) ?? s.taskId, updatedAt: now });
    }
    for (const r of rems) {
      const id = UUID_RE.test(r.id) ? r.id : crypto.randomUUID();
      stores[STORES.reminders].delete(r.id);
      stores[STORES.reminders].put({ ...r, id, taskId: taskMap.get(r.taskId) ?? r.taskId, updatedAt: now });
    }
    stores[STORES.meta].put({ key: 'seededVersion', value: 2 });
  });
}

/** برای دکمه‌ی «بازنشانی داده‌ی آزمایشی» در تنظیمات */
export async function resetSeedFlag(): Promise<void> {
  await metaSet('seededVersion', 0);
}

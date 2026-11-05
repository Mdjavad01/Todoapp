/**
 * کارام — ابزارهای مشترک e2e (بسته C)
 *
 *  - gotoTemplates: تنها ورود به صفحه‌ی واحد «قالب‌ها» — «لیست جدید ← یا از قالب‌های آماده شروع کنید»
 *    (ردیف‌های تنظیمات حذف شدند و این مسیر باید همیشه کار کند)
 *  - seedTraderLists: نوشتن مستقیم ۵ لیست + ۳۲ کار تریدر (کلید‌دار trader.0..4) در IndexedDB —
 *    شبیه‌سازی «کاربر فعالِ قبلی» (بسته C: فعال‌سازی UI برای مهمان قفل است؛ این داده همان
 *    خروجی دقیق activateTraderTemplate است و مسیر «حفظ کاربران فعال قبلی» را آزمایش می‌کند)
 *
 * الگوی نوشتن IDB: هم‌الگوی seedActiveStorePack در tests/e2e-jobpacks.mjs (commit قطعی تراکنش).
 */

export async function gotoTemplates(page) {
  // ردیف «لیست جدید» فقط در خانه است — از هر نمای دیگر اول به خانه برمی‌گردیم
  await page.locator('[aria-label="تب خانه"]').click();
  await page.waitForSelector('#view-home', { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.locator('[aria-label="ساخت لیست جدید"]').click();
  await page.locator('[aria-label="شروع از قالب‌های آماده"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('[aria-label="شروع از قالب‌های آماده"]').click();
  await page.waitForSelector('#view-templates', { timeout: 8000 });
  await page.waitForTimeout(300);
}

/** محتوای دقیق تمپلیت تریدر — هم‌قرارداد با src/db/traderTemplate.ts (۵ لیست / ۳۰ آیتم + ۲ لنگر) */
const TRADER_SEED = [
  {
    name: 'قوانین من', emoji: '📌', color: 'rose', pinned: true,
    items: [
      { title: 'حداکثر ضرر روزانه', type: 'note' },
      { title: 'ریسک هر معامله', type: 'note' },
      { title: 'حداکثر تعداد معامله در روز', type: 'num' },
      { title: 'اگر ضرر روزانه پر شد، پلتفرم را می‌بندم و دیگر معامله نمی‌کنم' },
      { title: 'هیچ‌وقت استاپ‌لاس را برای ضرر بیشتر جابجا نمی‌کنم' },
      { title: 'از روی FOMO یا انتقام معامله نمی‌کنم' },
    ],
  },
  {
    name: 'پیش از بازار', emoji: '🌅', color: 'amber', pinned: false,
    items: [
      { title: 'تقویم اقتصادی و اخبار مهم امروز را چک کردم', repeat: 'daily' },
      { title: 'حرکت شبانه بازار / گپ‌ها را دیدم', repeat: 'daily' },
      { title: 'واچ‌لیست امروز را ساختم (حداکثر ۵ نماد)', repeat: 'daily' },
      { title: 'سطوح کلیدی (حمایت و مقاومت) را مشخص کردم', repeat: 'daily' },
      { title: 'حداکثر ضرر امروز', type: 'num', repeat: 'daily' },
      { title: 'ریسک هر معامله', type: 'num', repeat: 'daily' },
      { title: 'حالم خوب و آماده است (خواب کافی داشتم، عصبانی نیستم)', repeat: 'daily' },
      { title: 'پلن امروز را نوشتم (فقط ستاپ‌های A+)', type: 'note', repeat: 'daily' },
    ],
  },
  {
    name: 'قبل از معامله', emoji: '🎯', color: 'teal', pinned: false,
    items: [
      { title: 'این معامله دقیقاً طبق پلنم است؟' },
      { title: 'نسبت سود به ضرر حداقل ۲ به ۱ است؟' },
      { title: 'حجم معامله را بر اساس استاپ‌لاس حساب کردم؟' },
      { title: 'خبر مهمی در ۳۰ دقیقه آینده ندارم؟' },
      { title: 'از روی هیجان یا انتقام وارد نمی‌شوم؟' },
    ],
  },
  {
    name: 'بعد از بازار', emoji: '🌆', color: 'indigo', pinned: false,
    items: [
      { title: 'همه‌ی معاملات امروز را ثبت کردم', repeat: 'daily' },
      { title: 'طبق پلنم معامله کردم؟', type: 'choice', repeat: 'daily' },
      { title: 'یک درس اصلی امروز', type: 'note', repeat: 'daily' },
      { title: 'امتیاز انضباط امروز', type: 'score', repeat: 'daily' },
      { title: 'نکته‌ی مهم برای فردا', type: 'note', repeat: 'daily' },
    ],
  },
  {
    name: 'ریویو هفتگی', emoji: '🗓️', color: 'emerald', pinned: false,
    items: [
      { title: 'تعداد کل معاملات هفته', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
      { title: 'چند معامله طبق پلن بود', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
      { title: 'بیشترین اشتباه تکراری', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
      { title: 'کدام ستاپ بهتر جواب داد', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
      { title: 'یک عادت یا قانون که هفته‌ی بعد تغییر می‌دهم', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
      { title: 'امتیاز کلی انضباط هفته', type: 'score', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
    ],
  },
];

export async function seedTraderLists(page, { start = '09:00', end = '17:30' } = {}) {
  await page.evaluate(
    ({ defs, start, end }) => {
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const addMinutes = (hhmm, min) => {
        const [h, m] = hhmm.split(':').map(Number);
        const total = (((h * 60 + m + min) % 1440) + 1440) % 1440;
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      };
      const lists = defs.map((d, i) => ({
        id: `trader-l${i}`,
        key: `trader.${i}`,
        name: d.name,
        emoji: d.emoji,
        color: d.color,
        pinned: d.pinned,
        sortOrder: i,
      }));
      const tasks = [];
      defs.forEach((d, i) => {
        d.items.forEach((it, j) => {
          const weekly = it.repeat === 'custom' && it.repeatMeta?.unit === 'week';
          tasks.push({
            id: `trader-t${i}-${j}`,
            listId: `trader-l${i}`,
            title: it.title,
            notes: '',
            priority: 'normal',
            dueDate: it.repeat ? today : null,
            dueTime: null,
            reminderMinutes: null,
            repeat: it.repeat ?? 'none',
            starred: false,
            repeatMeta: it.repeatMeta ?? null,
            itemType: it.type ?? null,
            itemValue: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            ...(weekly ? {} : {}),
          });
        });
      });
      // کارهای لنگر یادآور سشن — همان قرارداد upsertTraderAnchor (شروع +۳۰ دقیقه، پایان +۳۰ دقیقه با یادآور ۰)
      tasks.push({
        id: 'trader-anchor-start', listId: 'trader-l1', title: 'شروع سشن معاملاتی', notes: '',
        priority: 'normal', dueDate: today, dueTime: start, reminderMinutes: 30, repeat: 'daily',
        starred: false, repeatMeta: null, itemType: null, itemValue: null, completedAt: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      });
      tasks.push({
        id: 'trader-anchor-end', listId: 'trader-l3', title: 'پایان سشن معاملاتی', notes: '',
        priority: 'normal', dueDate: today, dueTime: addMinutes(end, 30), reminderMinutes: 0, repeat: 'daily',
        starred: false, repeatMeta: null, itemType: null, itemValue: null, completedAt: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      });
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('karam-db');
        req.onerror = () => reject(new Error('idb open failed'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['lists', 'tasks'], 'readwrite');
          for (const l of lists) {
            tx.objectStore('lists').put({
              id: l.id, name: l.name, emoji: l.emoji, color: l.color, sortOrder: l.sortOrder,
              pinned: l.pinned, templateKey: l.key,
              createdAt: now, updatedAt: now, deletedAt: null,
            });
          }
          for (const t of tasks) {
            tx.objectStore('tasks').put(t);
          }
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(new Error('seed tx failed')); };
          tx.onabort = () => { db.close(); reject(new Error('seed tx aborted')); };
        };
      });
    },
    { defs: TRADER_SEED, start, end },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#view-home', { timeout: 20000 });
  await page.waitForTimeout(400);
}

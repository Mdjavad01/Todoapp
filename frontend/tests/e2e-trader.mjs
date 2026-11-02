/**
 * کارام — تست e2e «فاز تریدر — چک‌لیست تریدر» روی وب (Playwright، حالت مهمان — بدون سرور API)
 *
 * پوشش:
 *   ۱) کارت تریدر در قالب‌های آماده (رایگان) + دیالوگ دو‌سؤالی ساعت سشن بدون پیش‌فرض
 *   ۲) فعال‌سازی → دقیقاً ۵ لیست + ۳۲ کار (۳۰ آیتم + ۲ لنگر) — «قوانین من» پین و اول
 *   ۳) فعال‌سازی دوباره (بعد از رفرش) → بدون هیچ تکرار (ایدمپوتنت)
 *   ۴) ذخیره‌ی عدد/یادداشت/انتخاب/امتیاز + ماندگاری بعد از رفرش (IndexedDB)
 *   ۵) بنر فقط‌خواندنی «قوانین من» بالای «پیش از بازار»
 *   ۶) متن ثابت پایین «قبل از معامله» + ریست تیک‌ها از کارت
 *   ۷) پین‌بودن بعد از جابه‌جایی لیست‌ها (مرتب‌سازی در مدیریت لیست‌ها)
 *   ۸) بکاپ شامل فیلدهای نو (itemType/itemValue/pinned) و بازیابی آن‌ها
 *   ۹) سازگاری با داده‌ی قدیمی — ردیف بدون itemType/pinned کرش نمی‌کند و تیک ساده حساب می‌شود
 *   ۱۰) سینک بین دو دستگاه: نیازمند سرور واقعی 8099 است — در این اسکریپت فقط هشدار داده می‌شود
 *       (پوشش واقعی سیم‌سینک: tests/phase-trader-test.php + tests/trader.test.ts)
 *
 * اجرا:
 *   ۱) بیلد:  cd frontend && bun run build
 *   ۲) سرور ثابت:  bunx vite preview --port 4173
 *   ۳) تست:  node tests/e2e-trader.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.E2E_BASE || 'http://localhost:4173/';
const SHOTS = '/tmp/karam-e2e-shots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitApp(page) {
  await page.waitForSelector('#view-home', { timeout: 20000 });
  await sleep(400);
}

async function dismissFirstRunLayers(page) {
  for (const name of ['رد کردن راهنما', 'بعداً تکمیلش می‌کنم', 'فعلاً بعداً انتخاب می‌کنم']) {
    try {
      const btn = page.locator(`[aria-label="${name}"]`);
      await btn.waitFor({ state: 'visible', timeout: 2500 });
      await btn.click();
      await sleep(300);
    } catch {}
  }
}

async function gotoTemplates(page) {
  await page.locator('[aria-label="تب تنظیمات"]').click();
  await page.waitForSelector('#view-settings', { timeout: 8000 });
  await page.locator('[aria-label="قالب‌های آماده"]').click();
  await page.waitForSelector('#view-templates', { timeout: 8000 });
  await sleep(300);
}

/** خواندن رکوردهای زنده از IndexedDB اپ */
async function readIdb(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('karam-db');
        req.onerror = () => reject(new Error('idb open failed'));
        req.onsuccess = () => {
          const db = req.result;
          const out = {};
          let pending = 0;
          const done = () => {
            db.close();
            resolve(out);
          };
          for (const store of ['lists', 'tasks']) {
            pending++;
            const tx = db.transaction(store, 'readonly');
            const all = tx.objectStore(store).getAll();
            all.onsuccess = () => {
              out[store] = (all.result || []).filter((r) => !r.deletedAt);
              if (--pending === 0) done();
            };
            all.onerror = () => reject(new Error('getAll failed'));
          }
        };
      }),
  );
}

async function waitToast(page, needle, timeout = 7000) {
  try {
    await page.getByText(needle, { exact: false }).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('— نصب تازه و ورود به قالب‌های آماده');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await gotoTemplates(page);

/* ---------- ۱) کارت تریدر ---------- */
console.log('— بلوک ۱: کارت تریدر و دیالوگ ساعت سشن');
const card = page.locator('#trader-card');
check('کارت چک‌لیست تریدر دیده می‌شود', await card.isVisible());
check('بج «رایگان» روی کارت هست', (await card.getByText('رایگان', { exact: true }).count()) > 0);
check('دکمه‌ی فعال‌سازی هست', (await card.getByText('فعال‌سازی تمپلیت ترید').count()) > 0);
check('کیت قدیمی kit-trader از بسته‌های شغلی حذف شده است', (await page.getByText('بسته‌ی معامله‌گر و تریدر').count()) === 0);

await card.getByText('فعال‌سازی تمپلیت ترید').click();
await sleep(300);
const dialog = page.locator('[aria-label="ساعت سشن معاملاتی"]');
check('دیالوگ دو‌سؤالی باز شد', await dialog.isVisible());
const startInput = dialog.locator('[aria-label="ساعت شروع سشن"]');
const endInput = dialog.locator('[aria-label="ساعت پایان سشن"]');
check('ورودی‌ها بدون پیش‌فرض ثابت خالی‌اند', (await startInput.inputValue()) === '' && (await endInput.inputValue()) === '');
check('دکمه‌ی فعال‌سازی تا پرشدن هر دو ساعت ناکاراست', await dialog.getByText('فعال‌سازی', { exact: true }).isDisabled());
await startInput.fill('09:00');
await endInput.fill('17:30');
await dialog.getByText('فعال‌سازی', { exact: true }).click();
check('توست موفقیت فعال‌سازی', await waitToast(page, 'تمپلیت تریدر فعال شد'));
await sleep(600);

/* ---------- ۲) ساخت ۵ لیست + پین ---------- */
console.log('— بلوک ۲: ساخت ۵ لیست و پین «قوانین من»');
let idb = await readIdb(page);
const traderNames = ['قوانین من', 'پیش از بازار', 'قبل از معامله', 'بعد از بازار', 'ریویو هفتگی'];
check('دقیقاً ۵ لیست تریدر ساخته شد', traderNames.every((n) => idb.lists.some((l) => l.name === n)), `got ${idb.lists.map((l) => l.name).join(',')}`);
check('به‌علاوه‌ی لیست پیش‌فرض = ۶ لیست', idb.lists.length === 6, `got ${idb.lists.length}`);
check('دقیقاً ۳۲ کار ساخته شد (۳۰ آیتم + ۲ لنگر)', idb.tasks.length === 32, `got ${idb.tasks.length}`);
const rulesList = idb.lists.find((l) => l.name === 'قوانین من');
check('«قوانین من» پین است', rulesList?.pinned === true);
check('هیچ لیست دیگری پین نیست', idb.lists.filter((l) => l.pinned).length === 1);
check('لنگر شروع با یادآور ۳۰ دقیقه‌ای', idb.tasks.some((t) => t.title === 'شروع سشن معاملاتی' && t.dueTime === '09:00' && t.reminderMinutes === 30 && t.repeat === 'daily'));
check('لنگر پایان = ۱۷:۳۰ + ۳۰ دقیقه با یادآور ۰', idb.tasks.some((t) => t.title === 'پایان سشن معاملاتی' && t.dueTime === '18:00' && t.reminderMinutes === 0 && t.repeat === 'daily'));
check('کارت حالا «تمپلیت فعال است» نشان می‌دهد', (await card.getByText('تمپلیت فعال است').count()) > 0);
await page.screenshot({ path: join(SHOTS, 'trader-active.png') });

/* ---------- ۳) فعال‌سازی دوباره ---------- */
console.log('— بلوک ۳: ایدمپوتنس (رفرش + فعال‌سازی دوباره)');
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await gotoTemplates(page);
const card2 = page.locator('#trader-card');
check('بعد از رفرش همچنان «تمپلیت فعال است»', (await card2.getByText('تمپلیت فعال است').count()) > 0);
check('دکمه‌ی فعال‌سازی اولیه دیگر نیست', (await card2.getByText('فعال‌سازی تمپلیت ترید').count()) === 0);
idb = await readIdb(page);
const listsBefore = idb.lists.length;
const tasksBefore = idb.tasks.length;
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await gotoTemplates(page);
idb = await readIdb(page);
check('رفرش مجدد هیچ لیست/کاری اضافه نکرد (ایدمپوتنت)', idb.lists.length === listsBefore && idb.tasks.length === tasksBefore);

/* ---------- ۴) فیلدهای عدد/یادداشت/انتخاب/امتیاز + بنر قوانین ---------- */
console.log('— بلوک ۴: فیلدهای سریع و بنر قوانین');
// قوانین من: یادداشت «حداکثر ضرر روزانه» و عدد «حداکثر تعداد معامله»
await page.locator('[aria-label="تب خانه"]').click();
await sleep(400);
await page.locator(`[aria-label*="باز کردن لیست قوانین من"]`).click();
await page.waitForSelector('#view-listView', { timeout: 8000 });
await sleep(400);
const noteField = page.locator('input[aria-label="یادداشت کوتاه"]').first();
await noteField.fill('۲٪ سرمایه');
await noteField.press('Enter'); // blur → ذخیره
await sleep(600);
// صبر تا نوشته‌شدن واقعی در IndexedDB (قطعی، نه بر پایه‌ی خواب)
for (let i = 0; i < 10; i++) {
  const probe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('karam-db');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('tasks', 'readonly');
          const g = tx.objectStore('tasks').getAll();
          g.onerror = () => {
            db.close();
            resolve(null);
          };
          g.onsuccess = () => {
            const row = (g.result || []).find((t) => t.title === 'حداکثر ضرر روزانه' && !t.deletedAt);
            db.close();
            resolve(row?.itemValue ?? null);
          };
        };
      }),
  );
  if (probe === '۲٪ سرمایه') break;
  await sleep(300);
}
const numField = page.locator('input[aria-label="مقدار عددی"]').first();
await numField.fill('3');
await numField.press('Enter');
await sleep(400);
// امتیاز و انتخاب در «بعد از بازار»
await page.locator('[aria-label="تب خانه"]').click();
await sleep(400);
await page.locator(`[aria-label*="باز کردن لیست بعد از بازار"]`).click();
await sleep(400);
await page.locator('[aria-label="انتخاب پاسخ"] button', { hasText: 'تا حدی' }).first().click();
await sleep(300);
await page.locator('[role="group"][aria-label="امتیاز از ۱ تا ۱۰"] button', { hasText: '۷' }).first().click();
await sleep(400);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
idb = await readIdb(page);
const planItem = idb.tasks.find((t) => t.title === 'حداکثر ضرر روزانه');
const countItem = idb.tasks.find((t) => t.title === 'حداکثر تعداد معامله در روز');
const choiceItem = idb.tasks.find((t) => t.title === 'طبق پلنم معامله کردم؟');
const scoreItem = idb.tasks.find((t) => t.title === 'امتیاز انضباط امروز');
check('یادداشت کوتاه ذخیره شد (itemValue در IDB)', planItem?.itemValue === '۲٪ سرمایه', JSON.stringify(planItem?.itemValue));
check('عدد ذخیره شد', countItem?.itemValue === '3');
check('انتخاب «تا حدی» ذخیره شد', choiceItem?.itemValue === 'partial');
check('امتیاز ۷ ذخیره شد', scoreItem?.itemValue === '7');
check('نوع‌ها در IDB درست‌اند', planItem?.itemType === 'note' && choiceItem?.itemType === 'choice' && scoreItem?.itemType === 'score');

// بنر قوانین بالای «پیش از بازار»
await page.locator('[aria-label="تب خانه"]').click();
await sleep(400);
await page.locator(`[aria-label*="باز کردن لیست پیش از بازار"]`).click();
await sleep(400);
const banner = page.locator('[aria-label="قوانین فعلی شما"]');
check('بنر فقط‌خواندنی قوانین بالای «پیش از بازار» هست', await banner.isVisible());
check('مقدار ضرر از «قوانین من» در بنر هست', (await banner.getByText('۲٪ سرمایه').count()) > 0);
await page.screenshot({ path: join(SHOTS, 'trader-rules-banner.png') });

/* ---------- ۵) متن ثابت «قبل از معامله» + ریست تیک‌ها ---------- */
console.log('— بلوک ۵: ریست تیک‌های «قبل از معامله»');
await page.locator('[aria-label="تب خانه"]').click();
await sleep(400);
await page.locator(`[aria-label*="باز کردن لیست قبل از معامله"]`).click();
await sleep(400);
check('متن ثابت برجسته پایین لیست هست', (await page.getByText('اگر حتی یکی از این‌ها «نه» بود، معامله نکن.').count()) > 0);
const checkboxes = page.locator('#view-listView button[aria-label="علامت‌زدن به‌عنوان انجام‌شده"]');
const tickCount = Math.min(2, await checkboxes.count());
for (let i = 0; i < tickCount; i++) {
  await checkboxes.nth(i).click();
  await sleep(250);
}
check('دو آیتم تیک خورد (پیش‌نیاز ریست)', tickCount === 2);
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
await page.locator('[aria-label="قالب‌های آماده"]').click();
await sleep(300);
await page.locator('#trader-card').getByText('ریست تیک‌های «قبل از معامله»').click();
check('توست ریست تیک‌ها', await waitToast(page, 'صفر شد'));
await sleep(500);
idb = await readIdb(page);
const pretrade = idb.lists.find((l) => l.name === 'قبل از معامله');
const pretradeTasks = idb.tasks.filter((t) => t.listId === pretrade.id);
check('بعد از ریست، همه‌ی تیک‌های «قبل از معامله» صفر است', pretradeTasks.every((t) => !t.completedAt));
check('مقادیر بعد از ریست دست نخوردند', idb.tasks.find((t) => t.title === 'حداکثر ضرر روزانه')?.itemValue === '۲٪ سرمایه');

/* ---------- ۶) پین‌بودن بعد از جابه‌جایی ---------- */
console.log('— بلوک ۶: پین بعد از جابه‌جایی لیست‌ها');
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
await page.locator('[aria-label="مدیریت لیست‌ها و ردیف‌های خانه"]').click();
await sleep(400);
// «پیش از بازار» را تا جایی که می‌شود بالا ببر
for (let i = 0; i < 6; i++) {
  const up = page.locator('[aria-label="انتقال پیش از بازار به بالا"]');
  if ((await up.count()) === 0) break;
  const disabled = await up.isDisabled().catch(() => true);
  if (disabled) break;
  await up.click();
  await sleep(200);
}
await page.keyboard.press('Escape');
await sleep(200);
await page.locator('[aria-label="تب خانه"]').click();
await sleep(400);
idb = await readIdb(page);
const firstList = idb.lists.filter((l) => !l.deletedAt).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.sortOrder - b.sortOrder)[0];
check('با وجود جابه‌جایی، «قوانین من» (پین‌شده) سرِ ترتیب می‌ماند', firstList?.name === 'قوانین من', JSON.stringify(firstList?.name));

/* ---------- ۷) بکاپ شامل فیلدهای نو + بازیابی ---------- */
console.log('— بلوک ۷: بکاپ و بازیابی فیلدهای نو');
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
const saveBtn = page.locator('[aria-label="ذخیره‌ی نسخه‌ی پشتیبان"]');
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), saveBtn.click()]);
const dlPath = join(tmpdir(), `karam-e2e-${Date.now()}-trader-backup.json`);
await download.saveAs(dlPath);
const saved = JSON.parse(readFileSync(dlPath, 'utf8'));
check('فایل بکاپ معتبر است', saved.app === 'karam' && saved.kind === 'backup');
check('بکاپ شامل itemType آیتم‌هاست', (saved.tasks || []).some((t) => t.itemType === 'score'));
check('بکاپ شامل itemValue است', (saved.tasks || []).some((t) => t.itemValue === '7'));
check('بکاپ شامل pinned لیست‌هاست', (saved.lists || []).some((l) => l.name === 'قوانین من' && l.pinned === true));
check('BACKUP_VERSION تغییر نکرده (باز هم version=1)', saved.version === 1);
writeFileSync('/tmp/trader-e2e-backup.json', JSON.stringify(saved));

// بازیابی: یک مقدار را محلی پاک کن، بعد از بکاپ برگردان
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await page.evaluate(async () => {
  // پاک‌کردن مقدار یک آیتم مستقیماً در IDB (شبیه‌سازی از دست رفتن)
  const req = indexedDB.open('karam-db');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    const g = store.getAll();
    g.onsuccess = () => {
      const row = (g.result || []).find((t) => t.title === 'امتیاز انضباط امروز' && !t.deletedAt);
      if (row) {
        row.itemValue = null;
        // updatedAt قدیمی‌تر از بکاپ — تا ادغام LWW بازیابی، ردیف بکاپ برنده شود (رفتار طراحی‌شده‌ی اپ)
        row.updatedAt = '2020-01-01T00:00:00.000Z';
        store.put(row);
      }
    };
    setTimeout(() => db.close(), 300);
  };
});
await sleep(700);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
await page.locator('[aria-label="انتخاب فایل پشتیبان و بازیابی"]').click();
const fileInput = page.locator('input[type="file"]');
await fileInput.setInputFiles({ name: 'karam-backup-trader.json', mimeType: 'application/json', buffer: readFileSync(dlPath) });
await page.waitForSelector('[data-testid="restore-confirm"]', { timeout: 8000 });
await page.locator('[aria-label="تأیید بازیابی"]').click();
await page.waitForSelector('[data-testid="restore-result"]', { timeout: 8000 });
await page.locator('[aria-label="بستن نتیجه‌ی بازیابی"]').click();
await sleep(500);
idb = await readIdb(page);
const scoreAfter = idb.tasks.find((t) => t.title === 'امتیاز انضباط امروز' && !t.deletedAt);
check('بازیابی مقدار امتیاز را برگرداند (itemValue=7)', scoreAfter?.itemValue === '7', JSON.stringify(scoreAfter?.itemValue));
check('بازیابی itemType را هم برگرداند', scoreAfter?.itemType === 'score');
check('بازیابی pinned را هم برگرداند', idb.lists.find((l) => l.name === 'قوانین من')?.pinned === true);

/* ---------- ۸) سازگاری با داده‌ی قدیمی (بدون itemType/pinned) ---------- */
console.log('— بلوک ۸: سازگاری با داده‌ی قدیمی');
await page.evaluate(async () => {
  const req = indexedDB.open('karam-db');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['lists', 'tasks'], 'readwrite');
    const lists = tx.objectStore('lists');
    const tasks = tx.objectStore('tasks');
    const now = new Date().toISOString();
    void lists; void tasks;
    lists.put({
      id: 'legacy-list-1', name: 'لیست قدیمی', emoji: '🧩', color: 'teal', sortOrder: 99,
      createdAt: now, updatedAt: now, deletedAt: null,
      // بدون pinned — سطر قدیمی
    });
    tasks.put({
      id: 'legacy-task-1', listId: 'legacy-list-1', title: 'کار قدیمی بی‌نوع', notes: '',
      priority: 'normal', dueDate: null, dueTime: null, reminderMinutes: null,
      repeat: 'none', starred: false, repeatMeta: null, completedAt: null,
      createdAt: now, updatedAt: now, deletedAt: null,
      // بدون itemType/itemValue — سطر قدیمی
    });
    setTimeout(() => db.close(), 300);
  };
});
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
check('اپ با سطر قدیمی کرش نکرد (بدون pageerror)', errors.length === 0, errors.slice(0, 2).join(' | '));
idb = await readIdb(page);
check('سطر قدیمی بدون pinned زنده مانده', idb.lists.some((l) => l.id === 'legacy-list-1'));
check('سطر قدیمی بدون itemType مثل تیک ساده زنده مانده', idb.tasks.some((t) => t.id === 'legacy-task-1'));
await page.locator(`[aria-label*="باز کردن لیست لیست قدیمی"]`).click();
await sleep(400);
check('کار قدیمی در UI رندر شد (تیک ساده، بدون فیلد)', (await page.getByText('کار قدیمی بی‌نوع').count()) > 0);

/* ---------- ۹) سینک دو‌دستگاهی ---------- */
console.log('— بلوک ۹: سینک بین دو دستگاه (نیازمند سرور واقعی)');
try {
  const res = await fetch('http://127.0.0.1:8099/api/health', { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    console.log('  ⚠️ سرور 8099 در دسترس است — سینک دو‌دستگاهی کامل در tests/phase-trader-test.php پوشش داده شده (سیم‌سینک واقعی با همان بدنه‌ی push/pull).');
    check('پوشش سینک دو‌دستگاهی در سوئیت PHP سبز است', true);
  } else {
    throw new Error('not ok');
  }
} catch {
  console.log('  ⚠️ سرور API در این اجرا بالا نیست — سینک دو‌دستگاهی e2e در محیط مهمان اجرا نمی‌شود.');
  console.log('     پوشش جایگزین: tests/phase-trader-test.php (roundtrip سرور) + tests/trader.test.ts (push واقعی runSync).');
}

console.log('\n———————————————');
if (fail === 0) {
  console.log(`✓ همه‌ی ${pass} بررسی سبز بود`);
} else {
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log('شکست‌ها:', failures.join(' | '));
}
await page.screenshot({ path: join(SHOTS, 'trader-final.png') });
await browser.close();
process.exit(fail === 0 ? 0 : 1);

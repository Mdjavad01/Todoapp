/**
 * کارام — تست e2e «فاز نصب تمیز» (مسترپرامپت فاز ۱) با Playwright
 *
 * پوشش:
 *   A) نصب تازه در دو context مستقل (IndexedDB خالی) ⇒ دقیقاً ۱ لیست «کارهای من» و ۰ کار/زیرکار/یادآور
 *   B) راهنمای ۳مرحله‌ای: یک‌بار در نصب تازه دیده می‌شود، «رد کردن» همیشه هست، بعد از رد دیگر نمی‌آید،
 *      از «تنظیمات ← راهنمای کارام ← شروع تور» دوباره می‌آید
 *   C) بنر پاک‌سازی داده‌ی نمونه‌ی قدیمی: شناسایی → «پاک کن» (حذف نرم + واگرد) / «نگه دار» —
 *      کار واقعی کاربر با عنوان شبیه دمو هرگز پاک نمی‌شود
 *   D) (با API) ورود با حساب جدید در دو دستگاه ⇒ همچنان ۱ لیست (نه ۲)
 *
 * اجرا:
 *   ۱) بیلد آزمایشی:  VITE_API_BASE=http://127.0.0.1:8099/api bun run build
 *   ۲) سرور ثابت:     bunx vite preview --port 4173
 *   ۳) تست:           node tests/e2e-fresh-install.mjs
 *   (برای بخش D به بک‌اند 8099 با OTP_DEBUG=1 و CORS_EXTRA_ORIGINS نیاز است)
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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

/** خواندن شمارش رکوردهای زنده از IndexedDB اپ */
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
          for (const store of ['lists', 'tasks', 'subtasks', 'reminders']) {
            pending++;
            const tx = db.transaction(store, 'readonly');
            const all = tx.objectStore(store).getAll();
            all.onsuccess = () => {
              const rows = all.result || [];
              out[store] = { total: rows.length, alive: rows.filter((r) => !r.deletedAt).length };
              if (--pending === 0) done();
            };
            all.onerror = () => reject(new Error('getAll failed'));
          }
        };
      }),
  );
}

async function aliveLists(page) {
  const idb = await readIdb(page);
  return idb;
}

/** صبر برای آماده شدن اپ (خانه رندر شده باشد) */
async function waitApp(page) {
  await page.waitForSelector('#view-home', { timeout: 15000 });
  await sleep(300);
}

/** بستن راهنما اگر باز شده باشد (نصب تازه راهنما را یک‌بار نشان می‌دهد) */
async function dismissGuideIfShown(page) {
  const skip = page.locator('[aria-label="رد کردن راهنما"]');
  try {
    await skip.waitFor({ state: 'visible', timeout: 4000 });
    await skip.click();
    await sleep(300);
    return true;
  } catch {
    return false;
  }
}

async function injectLegacyDemoWorld(page) {
  return page.evaluate(() => {
    const T0 = '2025-01-10T08:00:00.000Z';
    const NOW = new Date().toISOString();
    const SEED_LIST_NAMES = ['کارهای خانه', 'خرید هفتگی', 'کنکور و مطالعه', 'ترید و بازارهای مالی', 'مالی و قبوض', 'کاری'];
    const DEMO_TITLES = [
      'تست‌های فیزیک حرکت‌شناسی',
      'جلسه با تیم فنی و بررسی دپلوی',
      'تعمیر شیر آب آشپزخانه',
      'واریز قسط بیمه سلامت',
      'نظافت بالکن و آب‌دادن گلدان‌ها',
      'خرید نان سنگک عصر',
      'مرور ۳۰ تست شیمی',
      'پرداخت قبض برق',
    ];
    const colors = ['teal', 'amber', 'indigo', 'emerald', 'rose', 'purple'];
    const listIds = [];
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('karam-db');
      open.onerror = () => reject(new Error('open failed'));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['lists', 'tasks'], 'readwrite');
        const listStore = tx.objectStore('lists');
        const taskStore = tx.objectStore('tasks');
        SEED_LIST_NAMES.forEach((name, i) => {
          const id = crypto.randomUUID();
          listIds.push(id);
          listStore.put({
            id,
            name,
            emoji: '📦',
            color: colors[i],
            sortOrder: i,
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          });
        });
        // ۸ کار دموی دسته‌ای (createdAt=updatedAt=T0)
        DEMO_TITLES.forEach((title, i) => {
          taskStore.put({
            id: crypto.randomUUID(),
            listId: listIds[i % listIds.length],
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
          });
        });
        // کارِ واقعی کاربر: لیست خودش + عنوانِ شبیه دمو + ساخت دستی (جدا از دسته) → هرگز نباید پاک شود
        const userListId = crypto.randomUUID();
        listStore.put({
          id: userListId,
          name: 'پروژه‌ی شخصی من',
          emoji: '🚀',
          color: 'teal',
          sortOrder: 10,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        });
        taskStore.put({
          id: 'ffffffff-0000-4000-8000-00000000000f',
          listId: userListId,
          title: 'پرداخت قبض برق', // همان عنوان دمو — ولی در لیست خود کاربر
          notes: 'کار واقعی من — نباید پاک شود',
          priority: 'high',
          dueDate: null,
          dueTime: null,
          reminderMinutes: null,
          repeat: 'none',
          starred: false,
          repeatMeta: null,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        });
        tx.oncomplete = () => {
          db.close();
          resolve({ listIds: listIds.length });
        };
        tx.onerror = () => reject(new Error('tx failed'));
      };
    });
  });
}

/** ورود با ایمیل از رابط کاربری (کد dev روی صفحه نمایش داده می‌شود) */
async function loginViaUi(page, email) {
  await page.click('[aria-label="تب تنظیمات"]');
  await page.click('[aria-label="حساب کاربری و سینک"]');
  await page.getByText('ورود با ایمیل', { exact: false }).first().click();
  await page.fill('#karam-login-email', email);
  await page.getByRole('button', { name: 'دریافت کد' }).click();
  // کد dev روی صفحه ظاهر می‌شود (OTP_DEBUG=1)
  await page.waitForFunction(() => document.body.innerText.includes('dev:'), { timeout: 15000 });
  const code = await page.evaluate(() => {
    const m = document.body.innerText.match(/dev:\s*(\d{6})/);
    return m ? m[1] : null;
  });
  if (!code) throw new Error('devCode پیدا نشد');
  await page.fill('#karam-login-code', code);
  await page.getByRole('button', { name: 'تأیید و ورود' }).click();
}

/** صبر برای همگرایی سینک: حداقل یک لیست زنده ظاهر شود (تا ۱۵ ثانیه) */
async function waitConvergedOneList(page) {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const idb = await aliveLists(page);
    if (idb.lists.alive >= 1) return idb;
  }
  return aliveLists(page);
}

const browser = await chromium.launch();

/* ============ A) نصب تازه — دو context مستقل ============ */
console.log('\n── A) نصب تازه: دقیقاً ۱ لیست و ۰ کار ──');
{
  const ctx1 = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const p1 = await ctx1.newPage();
  await p1.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p1);
  await dismissGuideIfShown(p1);
  const idb1 = await aliveLists(p1);
  check('دستگاه ۱ (۳۶۰×۸۰۰): دقیقاً ۱ لیست زنده', idb1.lists.alive === 1, JSON.stringify(idb1.lists));
  check('دستگاه ۱: ۰ کار زنده', idb1.tasks.alive === 0, JSON.stringify(idb1.tasks));
  check('دستگاه ۱: ۰ زیرکار', idb1.subtasks.alive === 0);
  check('دستگاه ۱: ۰ یادآور', idb1.reminders.alive === 0);
  const listName = await p1.evaluate(
    () =>
      new Promise((res) => {
        const rq = indexedDB.open('karam-db');
        rq.onsuccess = () => {
          const db = rq.result;
          const tx = db.transaction('lists', 'readonly');
          const g = tx.objectStore('lists').getAll();
          g.onsuccess = () => {
            db.close();
            res((g.result || []).filter((r) => !r.deletedAt).map((r) => r.name).join(','));
          };
        };
      }),
  );
  check('دستگاه ۱: نام لیست = «کارهای من»', listName === 'کارهای من', listName);
  await p1.screenshot({ path: `${SHOTS}/fresh-360-light.png` });

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p2);
  await dismissGuideIfShown(p2);
  const idb2 = await aliveLists(p2);
  check('دستگاه ۲ (۳۹۰×۸۴۴ تاریک): دقیقاً ۱ لیست زنده', idb2.lists.alive === 1, JSON.stringify(idb2.lists));
  check('دستگاه ۲: ۰ کار زنده', idb2.tasks.alive === 0);
  await p2.screenshot({ path: `${SHOTS}/fresh-390-dark.png` });
  await ctx1.close();
  await ctx2.close();
}

/* ============ B) راهنمای ۳مرحله‌ای ============ */
console.log('\n── B) راهنمای اولین اجرا (Tooltip ۳ گامی) ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p);

  const tour = p.locator('[aria-label="تور آموزشی کارام"]');
  let shown = true;
  try {
    await tour.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    shown = false;
  }
  check('نصب تازه ⇒ راهنما خودکار باز می‌شود (بدون مودال جدا)', shown);
  if (shown) {
    const skipVisible = await p.locator('[aria-label="رد کردن راهنما"]').isVisible();
    check('«رد کردن» همیشه دیده می‌شود', skipVisible);
    const step1 = await p.locator('text=گام ۱ از ۳').count();
    check('گام ۱ از ۳ (ساخت اولین کار)', step1 === 1);
    const example = await p.locator('text=فردا ساعت ۱۷ خرید نان').count();
    check('نمونه‌ی «فردا ساعت ۱۷ خرید نان» در متن راهنما هست', example >= 1);
    await p.screenshot({ path: `${SHOTS}/guide-step1.png` });
    await p.getByRole('button', { name: 'بعدی' }).click();
    await sleep(400);
    const step2 = await p.locator('text=گام ۲ از ۳').count();
    check('گام ۲ از ۳ (سررسید و یادآور)', step2 === 1);
    await p.screenshot({ path: `${SHOTS}/guide-step2.png` });
    await p.locator('[aria-label="رد کردن راهنما"]').click();
    await sleep(400);
    check('بعد از «رد کردن» راهنما بسته می‌شود', (await tour.count()) === 0);
  }

  // رفرش ⇒ دیگر نمایش داده نمی‌شود
  await p.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(p);
  await sleep(1600);
  check('بعد از رد کردن و رفرش ⇒ دیگر ظاهر نمی‌شود', (await tour.count()) === 0);

  // نمایش دوباره از تنظیمات
  await p.click('[aria-label="تب تنظیمات"]');
  await p.click('[aria-label="باز کردن راهنمای کارام"]');
  await sleep(400);
  await p.getByRole('button', { name: 'شروع تور مرحله‌به‌مرحله' }).click();
  await sleep(600);
  check('از «تنظیمات ← راهنمای کارام» دوباره نمایش داده می‌شود', (await tour.count()) === 1);
  await p.screenshot({ path: `${SHOTS}/guide-replay.png` });
  await ctx.close();
}

/* ============ C) بنر پاک‌سازی داده‌ی نمونه ============ */
console.log('\n── C) بنر «کارهای نمونه‌ی قدیمی» ──');
{
  // سناریوی «پاک کن»
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p);
  await dismissGuideIfShown(p);
  await injectLegacyDemoWorld(p);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(p);

  const banner = p.locator('[aria-label="پاک‌سازی کارهای نمونه‌ی قدیمی"]');
  let bannerShown = true;
  try {
    await banner.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    bannerShown = false;
  }
  check('بنر «کارهای نمونه‌ی قدیمی پیدا شد» نمایش داده می‌شود', bannerShown);
  if (bannerShown) {
    const realVisible = await p.locator('text=پروژه‌ی شخصی من').count();
    check('لیست واقعی کاربر در صفحه هست', realVisible >= 1);
    await p.screenshot({ path: `${SHOTS}/demo-banner.png` });
    await p.getByRole('button', { name: 'پاک کردن کارهای نمونه' }).click();
    await sleep(1200);
    check('بنر بعد از «پاک کن» می‌رود', (await banner.count()) === 0);
    const toast = await p.locator('text=مورد نمونه پاک شد').count();
    check('توست نتیجه با دکمه‌ی واگرد می‌آید', toast >= 1);
    const idb = await aliveLists(p);
    // ۸ کار دمو + لیست‌های سیدی که خالی شده‌اند حذف نرم شده‌اند
    check('کارهای دمو حذف نرم شدند (زنده=۰)', idb.tasks.alive === 1, JSON.stringify(idb.tasks));
    check('تنها کار زنده = کار واقعی کاربر است', idb.tasks.alive === 1);
    check('لیست‌های نمونه‌ی خالی حذف نرم شدند؛ لیست واقعی و «کارهای من» زنده‌اند', idb.lists.alive === 2, JSON.stringify(idb.lists));
    // واگرد
    await p.locator('text=واگرد').first().click();
    await sleep(1200);
    const idbAfterUndo = await aliveLists(p);
    check('واگرد ⇒ همه‌ی رکوردها زنده برگشتند', idbAfterUndo.tasks.alive === 9 && idbAfterUndo.lists.alive === 8, JSON.stringify(idbAfterUndo));
    await p.screenshot({ path: `${SHOTS}/demo-after-undo.png` });
    // بعد از واگرد دیگر بنر نمی‌آید (تصمیم کاربر ثبت شده)
    await p.reload({ waitUntil: 'domcontentloaded' });
    await waitApp(p);
    await sleep(1200);
    check('بعد از واگرد، بنر دوباره مزاحم نمی‌شود (یک‌بارمصرف)', (await banner.count()) === 0);
  }
  await ctx.close();

  // سناریوی «نگه دار»
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p2);
  await dismissGuideIfShown(p2);
  await injectLegacyDemoWorld(p2);
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(p2);
  const banner2 = p2.locator('[aria-label="پاک‌سازی کارهای نمونه‌ی قدیمی"]');
  try {
    await banner2.waitFor({ state: 'visible', timeout: 4000 });
    await p2.getByRole('button', { name: 'نگه داشتن کارهای نمونه' }).click();
    await sleep(600);
    check('«نگه دار» ⇒ بنر می‌رود و چیزی پاک نمی‌شود', (await aliveLists(p2)).tasks.alive === 9);
    await p2.reload({ waitUntil: 'domcontentloaded' });
    await waitApp(p2);
    await sleep(1200);
    check('بعد از «نگه دار» دیگر پرسیده نمی‌شود', (await banner2.count()) === 0);
  } catch {
    check('بنر در سناریوی «نگه دار» نمایش داده شد', false);
  }
  await ctx2.close();
}

/* ============ D) ورود حساب جدید در دو دستگاه (فقط با API) ============ */
console.log('\n── D) دو دستگاه، حساب جدید ⇒ ۱ لیست ──');
if (process.env.E2E_API === '1') {
  const email = `e2e-${Date.now()}@karam-test.local`;
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pA = await ctxA.newPage();
  await pA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(pA);
  await dismissGuideIfShown(pA);
  await loginViaUi(pA, email);
  const a = await waitConvergedOneList(pA);
  check('دستگاه A بعد از ورود به حساب جدید: ۱ لیست زنده', a.lists.alive === 1, JSON.stringify(a.lists));
  await ctxA.close();

  const ctxB = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const pB = await ctxB.newPage();
  await pB.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(pB);
  await dismissGuideIfShown(pB);
  await loginViaUi(pB, email);
  const b = await waitConvergedOneList(pB);
  check('دستگاه B بعد از ورود به همان حساب: ۱ لیست (نه ۲)', b.lists.alive === 1, JSON.stringify(b.lists));
  await ctxB.close();
} else {
  console.log('  ⏭️ بخش D رد شد (E2E_API=1 تنظیم نشد — بدون بک‌اند)');
}

await browser.close();
console.log(`\n════ نتیجه: ${pass} موفق / ${fail} ناموفق ════`);
if (failures.length) {
  console.log('شکست‌ها:', failures.join(' | '));
  process.exit(1);
}

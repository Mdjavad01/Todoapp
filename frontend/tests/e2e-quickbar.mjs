/**
 * کارام — تست e2e «تک‌نوارشدن QuickBar و خلوت‌سازی خانه/امروز/آمار» (بسته A) با Playwright
 *
 * پوشش:
 *   الف) خانه: نوار افزودن پایین‌ثابت با هدف لیست پیش‌فرض + Enter = افزودن (با تشخیص هوشمند تاریخ)
 *        + حذف بنر تریدر و ردیف «قالب‌های آماده» از خانه + حذف کارت 🌱 (فقط خط کم‌رنگ)
 *   ب) ردیف‌های افزودنِ داخل صفحه (لیست و امروز) حذف شده‌اند — فقط QuickBar
 *   ج) تب «امروز»: افزودن از نوار = پین خودکار به «روزهای من» + کارت «برنامه‌ی امروز» فقط با دیتا
 *   د) تب «آمار»: کارت استریک تا وجود دیتا مخفی + بدون جمله‌های هاردکد
 *   هـ) برچسب اولویت: کار «متوسط» (پیش‌فرض) بدون نشان روی ردیف
 *   و) چیدمان: نوار افزودن روی نوار ناوبری نمی‌افتد (هم در لیست هم در امروز) — بند ۶ ممیزی
 *
 * اجرا:
 *   ۱) بیلد آزمایشی:  bun run build
 *   ۲) سرور ثابت:     bunx vite preview --port 4173
 *   ۳) تست:           node tests/e2e-quickbar.mjs
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

/** خواندن رکوردهای زنده از IndexedDB اپ (شامل prefs برای «روزهای من») */
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
          for (const store of ['lists', 'tasks', 'prefs']) {
            pending++;
            const tx = db.transaction(store, 'readonly');
            const all = tx.objectStore(store).getAll();
            all.onsuccess = () => {
              const rows = all.result || [];
              if (store === 'prefs') {
                out.prefs = Object.fromEntries(rows.map((r) => [r.key, r.value]));
              } else {
                out[store] = {
                  total: rows.length,
                  alive: rows.filter((r) => !r.deletedAt).length,
                  rows: rows.filter((r) => !r.deletedAt),
                };
              }
              if (--pending === 0) done();
            };
            all.onerror = () => reject(new Error('getAll failed'));
          }
        };
      }),
  );
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

async function waitToast(page, needle, timeout = 7000) {
  try {
    await page.getByText(needle, { exact: false }).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/** نوار افزودن روی نوار ناوبری نمی‌افتد؟ */
async function noNavOverlap(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#quick-bar');
    const nav = document.querySelector('nav[aria-label="ناوبری اصلی"]');
    if (!bar || !nav) return false;
    const b = bar.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    return b.bottom <= n.top + 1 && b.top < b.bottom; // نوار کامل بالای ناوبری و با ارتفاع واقعی
  });
}

console.log('— الف) خانه: نوار واحد با هدف لیست پیش‌فرض + خانه‌ی خلوت');
const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissGuideIfShown(page);
  await sleep(300);

  const bar = page.locator('#quick-bar');
  check('QuickBar روی خانه دیده می‌شود', (await bar.count()) === 1 && await bar.isVisible());

  const placeholder = await bar.locator('input').getAttribute('placeholder');
  check('هدف نوار روی خانه = لیست پیش‌فرض («کارهای من»)', (placeholder ?? '').includes('کارهای من'), placeholder ?? '');

  check('بنر تریدر از خانه حذف شده', (await page.locator('#trader-discovery-banner').count()) === 0);
  check('ردیف «قالب‌های آماده» از خانه حذف شده (مسیر: لیست جدید/تنظیمات)', (await page.locator('#view-home [aria-label="قالب‌های آماده"]').count()) === 0);
  check('کارت 🌱 حذف شده (بدون دکمه‌ی «اولین کارت را اضافه کن»)', (await page.getByText('اولین کارت را اضافه کن').count()) === 0);
  check('حالت خالی = فقط خط کم‌رنگ', (await page.locator('#home-empty').count()) === 1);

  await bar.locator('input').fill('خرید نان فردا');
  await bar.locator('input').press('Enter');
  check('توست افزودن با Enter می‌آید', await waitToast(page, 'افزوده شد'));
  await sleep(500);

  const idb = await readIdb(page);
  const defaultList = idb.lists.rows.find((l) => l.name === 'کارهای من');
  const t = idb.tasks.rows[0];
  check('دقیقاً ۱ کار زنده ساخته شد', idb.tasks.alive === 1, JSON.stringify({ alive: idb.tasks.alive }));
  check('کار در لیست پیش‌فرض ساخته شد', Boolean(t && defaultList && t.listId === defaultList.id));
  check('تشخیص هوشمند «فردا» کار می‌کند (سررسید فردا + عنوان تمیز)', Boolean(t && t.dueDate && t.title === 'خرید نان'), JSON.stringify(t ? { title: t.title, dueDate: t.dueDate } : null));
  check('ورودی نوار بعد از ارسال خالی می‌شود', (await bar.locator('input').inputValue()) === '');
  check('بعد از اولین کار، خط حالت خالی می‌رود', (await page.locator('#home-empty').count()) === 0);
  check('خطای کنسول نداریم', errors.length === 0, errors.join(' | ').slice(0, 200));
  await page.screenshot({ path: `${SHOTS}/quickbar-home.png` });
  await ctx.close();
}

console.log('— ب و و) لیست: حذف ردیف داخل‌صفحه‌ای + عدم افتادن نوار روی ناوبری');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissGuideIfShown(page);

  await page.locator('[aria-label^="باز کردن لیست"]').first().click();
  await page.waitForSelector('#view-listView', { timeout: 8000 });
  await sleep(300);

  check('ردیف افزودن داخل لیست حذف شده', (await page.locator('#view-listView input[aria-label="افزودن سریع کار"]').count()) === 0);
  check('QuickBar در لیست هست', (await page.locator('#quick-bar').count()) === 1 && await page.locator('#quick-bar').isVisible());
  check('نوار افزودن روی نوار ناوبری نمی‌افتد (لیست)', await noNavOverlap(page));

  // افزودن از خود لیست — هدف = همان لیست فعال
  const barInput = page.locator('#quick-bar input');
  const placeholder = await barInput.getAttribute('placeholder');
  check('هدف نوار در لیست = نام همان لیست', (placeholder ?? '').includes('کارهای من'), placeholder ?? '');
  await barInput.fill('کار از خود لیست');
  await barInput.press('Enter');
  await sleep(600);
  const idb = await readIdb(page);
  const lst = idb.lists.rows.find((l) => l.name === 'کارهای من');
  const added = idb.tasks.rows.find((t2) => t2.title === 'کار از خود لیست');
  check('افزودن از نوار داخل لیست به همان لیست می‌رود', Boolean(added && lst && added.listId === lst.id));
  await ctx.close();
}

console.log('— ج و هـ) تب امروز: پین خودکار به «روزهای من» + کارت پیشرفت فقط با دیتا');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissGuideIfShown(page);

  await page.locator('[aria-label="تب امروز"]').click();
  await page.waitForSelector('#view-myday', { timeout: 8000 });
  await sleep(300);

  check('ردیف افزودن داخل «امروز» حذف شده', (await page.locator('#view-myday input[aria-label="افزودن سریع به امروز"]').count()) === 0);
  check('QuickBar در «امروز» هست', (await page.locator('#quick-bar').count()) === 1 && await page.locator('#quick-bar').isVisible());
  check('نوار افزودن روی نوار ناوبری نمی‌افتد (امروز)', await noNavOverlap(page));
  check('کارت «برنامه‌ی امروز» بدون دیتا مخفی است', (await page.locator('#today-progress').count()) === 0);

  const barInput = page.locator('#quick-bar input');
  const placeholder = await barInput.getAttribute('placeholder');
  check('نشانگر نوار در تب امروز = «افزودن به امروز…»', (placeholder ?? '').includes('افزودن به امروز'), placeholder ?? '');

  await barInput.fill('تمرین صبحگاهی');
  await barInput.press('Enter');
  check('توست افزودن در «امروز» می‌آید', await waitToast(page, 'افزوده شد'));
  await sleep(700);

  const idb = await readIdb(page);
  const t = idb.tasks.rows.find((x) => x.title === 'تمرین صبحگاهی');
  check('کار «امروز» در لیست پیش‌فرض ساخته شد', Boolean(t));
  const myDayIds = idb.prefs['myday-ids'] ?? [];
  check('کار تازه خودکار به «روزهای من» پین شد', Boolean(t && myDayIds.includes(t.id)), JSON.stringify(myDayIds));

  await sleep(300);
  const card = page.locator('#today-progress');
  check('کارت «برنامه‌ی امروز» با دیتا ظاهر می‌شود', (await card.count()) === 1 && await card.isVisible());
  const cardText = (await card.textContent()) ?? '';
  check('اعداد کارت = همان لیست پایین (۱ از ۱ مانده)', cardText.includes('۱ از ۱') && cardText.includes('کار مانده'), cardText.slice(0, 120));
  check('جمله‌ی هاردکد «پروژه‌های اصلی» حذف شده', !cardText.includes('پروژه‌های اصلی'));

  // برچسب اولویت — کار «متوسط» (پیش‌فرض) نباید نشان داشته باشد
  check('کار پیش‌فرض (متوسط) بدون برچسب اولویت روی ردیف است', (await page.locator('#view-myday').getByText('متوسط', { exact: true }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/quickbar-myday.png` });
  await ctx.close();
}

console.log('— د) تب آمار: استریک صفر ⇒ کارت مخفی + بدون جمله‌ی هاردکد');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissGuideIfShown(page);

  await page.locator('[aria-label="تب آمار"]').click();
  await page.waitForSelector('#view-analytics', { timeout: 8000 });
  await sleep(300);

  check('کارت استریک با صفر روز مخفی است', (await page.getByText('روز پیاپی').count()) === 0);
  const viewText = (await page.locator('#view-analytics').textContent()) ?? '';
  check('جمله‌ی هاردکد «بالاترین رکورد ماهانه» حذف شده', !viewText.includes('بالاترین رکورد'));
  check('جمله‌ی هاردکد «۲ کار تا ثبت رکورد» حذف شده', !viewText.includes('۲ کار تا ثبت رکورد'));
  await page.screenshot({ path: `${SHOTS}/quickbar-analytics.png` });
  await ctx.close();
}

await browser.close();

console.log(`\nنتیجه: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) {
  console.log('شکست‌ها:', failures.join(' • '));
  process.exit(1);
}

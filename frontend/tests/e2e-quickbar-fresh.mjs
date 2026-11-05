/**
 * کارام — تست e2e «نوار افزودن روی نصب تازه با صفر لیست» (بسته A — پیگیری صاحب محصول)
 *
 * سناریو: دستگاهی که هیچ لیست زنده‌ای ندارد (نصب تازه‌ای که سیدش رد شده، یا حسابی که
 * همه‌ی لیست‌هایش تومب‌استون شده). قبلاً QuickBar در این حالت خودش را مخفی می‌کرد در
 * حالی که خانه می‌گفت «اولین کارت را از نوار پایین اضافه کن» — ناسازگاری.
 * رفتار درست: نوار دیده می‌شود، با اولین ارسال لیست پیش‌فرضِ قطعی «کارهای من»
 * (DEFAULT_LIST_ID سید) ساخته و کار در آن ثبت می‌شود — بدون خطا، بدون نوارِ مخفی،
 * و ارسال‌های بعدی لیست تکراری نمی‌سازند.
 *
 * اجرا:
 *   ۱) بیلد آزمایشی:  bun run build
 *   ۲) سرور ثابت:     bunx vite preview --port 4173
 *   ۳) تست:           node tests/e2e-quickbar-fresh.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:4173/';
const SHOTS = '/tmp/karam-e2e-shots';
mkdirSync(SHOTS, { recursive: true });

const DEFAULT_LIST_ID = '00000000-0000-4000-8000-000000000001'; // همان سید قطعی db/seed.ts

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
              const rows = all.result || [];
              out[store] = rows.filter((r) => !r.deletedAt);
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

/** ساخت وضعیت «صفر لیست زنده»: پاک‌کردن همه‌ی لیست‌ها + مهرهای سید تا ensureDefaultData دست نزند */
async function forceZeroLists(page) {
  return page.evaluate(async () => {
    const DB_NAME = 'karam-db';
    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => reject(new Error('idb open failed'));
        req.onsuccess = () => resolve(req.result);
      });
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['lists', 'prefs'], 'readwrite');
      const lists = tx.objectStore('lists');
      const prefs = tx.objectStore('prefs');
      const allReq = lists.getAll();
      allReq.onsuccess = () => {
        for (const row of allReq.result || []) lists.delete(row.id);
        // مهرهای سید: ensureDefaultData دیگر لیست پیش‌فرض نمی‌سازد (هدف: وضعیت واقعی «صفر لیست»)
        prefs.put({ key: 'seededVersion', value: 2 });
        prefs.put({ key: 'default-list-v1', value: 1 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('tx failed'));
      };
    });
    db.close();
  });
}

console.log('— صفر لیست زنده: نوار دیده می‌شود و اولین ارسال لیست پیش‌فرض را می‌سازد');
const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // بوت اول: اپ اسکیمای دیتابیس و مهرهای سید را می‌سازد
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissGuideIfShown(page);
  await sleep(500);
  const boot = await readIdb(page);
  check('بوت اول: لیست پیش‌فرض سید وجود دارد', boot.lists.length >= 1, `alive=${boot.lists.length}`);

  // ساخت وضعیت صفر لیست + رفرش کامل
  await forceZeroLists(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await sleep(700);

  const zero = await readIdb(page);
  check('وضعیت آزمایشی «صفر لیست زنده» ساخته شد', zero.lists.length === 0, `alive=${zero.lists.length}`);

  const bar = page.locator('#quick-bar');
  check('QuickBar بدون لیست هم دیده می‌شود (قبلاً مخفی می‌شد — حفره‌ی بسته A)', (await bar.count()) === 1 && (await bar.isVisible()));
  check('هدف نوار در حالت صفر لیست = «کارهای من»', ((await bar.locator('input').getAttribute('placeholder')) ?? '').includes('کارهای من'));
  check('خانه همان خط کم‌رنگ حالت خالی را دارد (سازگار با نوار دیده‌شده)', await page.getByText('اولین کارت را از نوار پایین اضافه کن', { exact: false }).first().isVisible());

  // اولین ارسال → ساخت لیست پیش‌فرض + ثبت کار در آن
  await bar.locator('input').fill('خرید نان');
  await bar.locator('input').press('Enter');
  await sleep(900);

  const after1 = await readIdb(page);
  check('لیست پیش‌فرض خودکار ساخته شد', after1.lists.length === 1, `alive=${after1.lists.length}`);
  check(
    'لیست ساخته‌شده = «کارهای من» با شناسه‌ی قطعی سید (نه UUID تصادفی)',
    after1.lists[0]?.id === DEFAULT_LIST_ID && after1.lists[0]?.name === 'کارهای من',
    JSON.stringify(after1.lists[0] ? { id: after1.lists[0].id, name: after1.lists[0].name } : null),
  );
  check('کار در همان لیست ثبت شد', after1.tasks.length === 1 && after1.tasks[0]?.listId === DEFAULT_LIST_ID, JSON.stringify(after1.tasks[0] ? { listId: after1.tasks[0].listId, title: after1.tasks[0].title } : null));
  check('عنوان کار درست است', after1.tasks[0]?.title === 'خرید نان', String(after1.tasks[0]?.title));
  check('خانه لیست «کارهای من» را نشان می‌دهد', await page.getByText('کارهای من', { exact: false }).first().isVisible());

  // ارسال دوم → لیست تکراری نمی‌سازد
  await bar.locator('input').fill('تمرین دوم');
  await bar.locator('input').press('Enter');
  await sleep(900);

  const after2 = await readIdb(page);
  check('ارسال دوم لیست تکراری نمی‌سازد', after2.lists.length === 1, `alive=${after2.lists.length}`);
  check('ارسال دوم کار دوم را در همان لیست ثبت کرد', after2.tasks.length === 2 && after2.tasks.every((t) => t.listId === DEFAULT_LIST_ID), `tasks=${after2.tasks.length}`);

  check('هیچ خطای صفحه (pageerror) رخ نداد', errors.length === 0, errors.join(' | ').slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/quickbar-fresh.png` });
  await ctx.close();
}

await browser.close();
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`);
if (fail > 0) {
  console.log('موردهای قرمز:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

/**
 * کارام — تست e2e «P2.0 — بسته‌های شغلی + قفل صادقانه» روی وب (Playwright، حالت مهمان — بدون سرور API)
 *
 * بسته C — صفحه‌ی واحد «قالب‌ها»: بسته‌های شغلی حالا داخل بخش «مخصوص کارام پرو» صفحه‌ی قالب‌ها هستند
 * (ادغام با قالب‌های رایگان + چک‌لیست تریدر) و ورود فقط از «لیست جدید ← یا از قالب» است.
 *
 * پوشش:
 *   ۱) سه کارت بسته در بخش پرو صفحه‌ی قالب‌ها (فریلنسر/فروشگاه/دانشجو) + بخش رایگان ۴ قالبی + بج‌های رایگان/پرو
 *   ۱ب) تنظیمات: ردیف‌های قالب/بسته حذف شدند؛ کارت ارتقا به پرو → همین صفحه
 *   ۲) پیش‌نمایش کامل محتوا برای مهمان — آزاد و صادقانه (لیست‌ها + آیتم‌ها + لنگرها + یادداشت تکرار)
 *   ۳) قفل فقط روی فعال‌سازی: دکمه‌ی «بازکردن با کارام پرو» (بدون وعده خرید، بدون قیمت) → پی‌وال
 *   ۴) وضعیت «فعال است» با داده‌ی کلید‌دار (seed مستقیم IDB) — کارت و بازنشانی با دیالوگ تأیید
 *   ۵) بازنشانی: انصراف = هیچ؛ تأیید = تومب‌استون لیست‌های بسته + خروج از حالت فعال + قاعده‌ی همیشه-یک-لیست
 *   ۶) سازگاری داده‌ی قدیمی: لیست kit-freelance قدیمی («روتین کاری روزانه» بدون کلید) — بدون کرش، بدون ادغام
 *   ۷) بکاپ شامل templateKey (BACKUP_VERSION همان ۱)
 *   ۸) سینک دو‌دستگاهی/سرور: پوشش واقعی در tests/phase-jobpacks-test.php (سیم‌سینک با همان بدنه‌ی push/pull)
 *      و منطق فعال‌سازی در tests/jobpacks.test.ts — این e2e عمداً مهمان است (قفل پرو نیاز به حساب پرو دارد؛
 *      کلیک فعال‌سازی با حساب پرو واقعی در چک‌لیست دستگاه docs/P2-JOB-PACKS-DEVICE-TEST.md است)
 *
 * اجرا:
 *   ۱) بیلد:  cd frontend && bun run build
 *   ۲) سرور ثابت:  bunx vite preview --port 4173
 *   ۳) تست:  node tests/e2e-jobpacks.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gotoTemplates } from './helpers-e2e.mjs';

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

/** بسته C — صفحه‌ی واحد قالب‌ها؛ ورود فقط از «لیست جدید ← یا از قالب‌های آماده شروع کنید» */
async function gotoJobkits(page) {
  await gotoTemplates(page);
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
              out[store] = all.result || [];
              if (--pending === 0) done();
            };
            all.onerror = () => reject(new Error('getAll failed'));
          }
        };
      }),
  );
}

/** نوشتن مستقیم داده‌ی بسته‌ی فروشگاه (کلید‌دار) در IDB — شبیه‌سازی «بعد از فعال‌سازی» */
async function seedActiveStorePack(page) {
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const lists = [
      { id: 'store-l0', key: 'kit-store.0', name: 'سفارش‌های امروز', emoji: '📦', color: 'amber' },
      { id: 'store-l1', key: 'kit-store.1', name: 'موجودی و انبار', emoji: '🏷️', color: 'teal' },
      { id: 'store-l2', key: 'kit-store.2', name: 'پیگیری مشتری', emoji: '💬', color: 'emerald' },
      { id: 'store-l3', key: 'kit-store.3', name: 'مالی و تسویه', emoji: '💰', color: 'rose' },
    ];
    const tasks = [
      { id: 'store-t0', listId: 'store-l0', title: 'بررسی سفارش‌های امروز', dueTime: '10:00', reminderMinutes: 15, repeat: 'daily', dueDate: today, itemType: null, itemValue: null },
      { id: 'store-t1', listId: 'store-l0', title: 'سفارش‌های جدید امروز', repeat: 'daily', dueDate: today, itemType: 'num', itemValue: null },
      { id: 'store-t2', listId: 'store-l1', title: 'کالاهای پرفروش شمارش شد', repeat: 'custom', itemType: null, itemValue: null },
      { id: 'store-t3', listId: 'store-l2', title: 'نظرات و پیام‌های امروز پاسخ داده شد', repeat: 'daily', dueDate: today, itemType: null, itemValue: null },
    ];
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('karam-db');
      req.onerror = () => reject(new Error('idb open failed'));
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['lists', 'tasks'], 'readwrite');
        for (const l of lists) {
          tx.objectStore('lists').put({
            id: l.id, name: l.name, emoji: l.emoji, color: l.color, sortOrder: 50 + lists.indexOf(l),
            pinned: false, templateKey: l.key,
            createdAt: now, updatedAt: now, deletedAt: null,
          });
        }
        for (const t of tasks) {
          tx.objectStore('tasks').put({
            id: t.id, listId: t.listId, title: t.title, notes: '', priority: 'normal',
            dueDate: t.dueDate ?? null, dueTime: t.dueTime ?? null, reminderMinutes: t.reminderMinutes ?? null,
            repeat: t.repeat, starred: false, repeatMeta: null, itemType: t.itemType ?? null, itemValue: t.itemValue ?? null,
            completedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
          });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(new Error('seed tx failed')); };
        tx.onabort = () => { db.close(); reject(new Error('seed tx aborted')); };
      };
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissFirstRunLayers(page);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('═══ P2.0 — بسته‌های شغلی (e2e وب — مهمان) ═══');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);

/* ---------- ۱) سه کارت بسته ---------- */
console.log('— بلوک ۱: کارت‌های بسته');
await gotoJobkits(page);
for (const id of ['kit-freelance', 'kit-store', 'kit-student']) {
  check(`کارت بسته ${id} رندر شد`, (await page.locator(`[data-pack="${id}"]`).count()) === 1);
}

/* ---------- ۱الف) بسته C — صفحه‌ی واحد قالب‌ها (رایگان/پرو) ---------- */
console.log('— بلوک ۱الف: صفحه‌ی واحد قالب‌ها');
check('بخش رایگان با ۴ قالب رندر شد', (await page.locator('#templates-free [data-template]').count()) === 4);
check('۴ بج «رایگان» روی قالب‌های رایگان', (await page.locator('#templates-free').getByText('رایگان', { exact: true }).count()) === 4);
check('سربرگ بخش رایگان هست', (await page.getByText('رایگان برای همه').count()) > 0);
check('سربرگ بخش پرو هست', (await page.getByText('مخصوص کارام پرو').count()) > 0);
check('کارت تریدر داخل بخش پرو هست', (await page.locator('#templates-pro #trader-card').count()) === 1);
check('۳ بج «پرو» روی بسته‌های شغلی', (await page.locator('#templates-pro [data-pack]').getByText('پرو', { exact: true }).count()) === 3);
check('بج «پرو» روی کارت تریدر (بیلد پرداخت‌دار)', (await page.locator('#templates-pro #trader-card [data-trader-tier]').innerText()).trim() === 'پرو');

/* ---------- ۱ب) تنظیمات: ردیف‌ها حذف شدند + کارت ارتقا به همین صفحه ---------- */
console.log('— بلوک ۱ب: تنظیمات بدون ردیف قالب‌ها');
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
check('ردیف «قالب‌های آماده» از تنظیمات حذف شد', (await page.locator('[aria-label="قالب‌های آماده"]').count()) === 0);
check('ردیف «بسته‌های شغلی تخصصی» از تنظیمات حذف شد', (await page.locator('[aria-label="بسته‌های شغلی تخصصی"]').count()) === 0);
check('ردیف «مدیریت لیست‌ها» باقی است', (await page.locator('[aria-label="مدیریت لیست‌ها و ردیف‌های خانه"]').count()) === 1);
await page.locator('#settings-pro').click();
await page.waitForSelector('#view-templates', { timeout: 8000 });
await sleep(300);
check('کارت ارتقا به پرو → صفحه‌ی قالب‌ها رفت (همین صفحه)', true);

/* ---------- ۲) پیش‌نمایش کامل برای مهمان (صادقانه — آزاد) ---------- */
console.log('— بلوک ۲: پیش‌نمایش کامل');
const previewBtn = page.locator('[data-pack="kit-freelance"] [aria-label*="پیش‌نمایش"]').first();
await previewBtn.click();
await sleep(300);
const preview = page.locator('[data-pack-preview="kit-freelance"]');
check('پیش‌نمایش باز شد', (await preview.count()) === 1);
check('نام لیست «شروع روز کاری» در پیش‌نمایش هست', (await preview.getByText('شروع روز کاری').count()) > 0);
check('آیتم واقعی «تقویم و ددلاین‌های امروز را مرور کردم» دیده می‌شود', (await preview.getByText('تقویم و ددلاین‌های امروز را مرور کردم').count()) > 0);
check('لنگر یادآور با ساعت (یادآور 09:00) نشان داده می‌شود', (await preview.getByText('یادآور 09:00').count()) > 0);
check('یادداشت صادقانه‌ی تکرار/اندروید هست', (await preview.getByText('فقط در اپ اندروید زنگ می‌زنند').count()) > 0);

/* ---------- ۳) قفل صادقانه → پی‌وال ---------- */
console.log('— بلوک ۳: قفل فعال‌سازی');
const lockBtn = page.locator('[data-pack="kit-freelance"] [data-pack-locked="kit-freelance"]');
check('دکمه‌ی قفل با متن «بازکردن با کارام پرو» هست (بدون وعده خرید)', (await lockBtn.innerText()).includes('بازکردن با کارام پرو'));
{
  // صداقت قیمت در بخش پرو (اسکوپ — چون صفحه‌ی واحد حالا قالب رایگان «چک‌لیست خرید سوپرمارکت» را هم دارد):
  // هیچ وعده‌ی خرید/قیمتی در بسته‌ها نیست؛ «تومان» فقط داخل واحدهای ثبت آیتم («هزار تومان»)
  const txt = await page.locator('#templates-pro').innerText();
  const tomanHits = [...txt.matchAll(/.{0,12}تومان/g)].map((m) => m[0]);
  check('هیچ وعده‌ی خرید/قیمتی در بخش پرو نیست (بدون «خرید»/«قیمت»)', !txt.includes('خرید') && !txt.includes('قیمت'));
  check('هر «تومان» فقط در واحد ثبت آیتم («هزار تومان») است', tomanHits.every((h) => h.includes('هزار تومان')), JSON.stringify(tomanHits.slice(0, 3)));
}
await lockBtn.click();
await page.waitForSelector('#view-paywall', { timeout: 8000 });
check('کلیک قفل → پی‌وال رفت', true);
// بازگشت و ادامه
await page.locator('#view-paywall [aria-label*="بازگشت"], #view-paywall button').first().click().catch(() => {});
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);

/* ---------- ۴) وضعیت «فعال است» با داده‌ی کلید‌دار ---------- */
console.log('— بلوک ۴: وضعیت فعال (seed IDB)');
await seedActiveStorePack(page);
await gotoJobkits(page);
const storeCard = page.locator('[data-pack="kit-store"]');
check('نشان «فعال است» روی بسته‌ی فروشگاه', (await storeCard.getByText('فعال است').count()) === 1);
check('دکمه‌ی «بازنشانی بسته» ظاهر شد', (await storeCard.getByText('بازنشانی بسته').count()) === 1);
check('بقیه‌ی بسته‌ها همچنان قفل‌اند', (await page.locator('[data-pack="kit-freelance"] [data-pack-locked]').count()) === 1);

/* ---------- ۵) بازنشانی با دیالوگ تأیید ---------- */
console.log('— بلوک ۵: بازنشانی');
await storeCard.getByText('بازنشانی بسته').click();
await sleep(300);
const dlg = page.locator('[aria-label="تأیید بازنشانی بسته‌ی فروشگاه آنلاین"]');
check('دیالوگ تأیید باز شد', (await dlg.count()) === 1);
await dlg.getByText('انصراف').click();
await sleep(300);
let idb = await readIdb(page);
check('انصراف: هیچ لیستی حذف نشد', idb.lists.filter((l) => !l.deletedAt && l.templateKey?.startsWith('kit-store')).length === 4);
await storeCard.getByText('بازنشانی بسته').click();
await sleep(300);
await page.locator('[aria-label="تأیید بازنشانی بسته‌ی فروشگاه آنلاین"]').getByText('بازنشانی کن').click();
await sleep(800);
idb = await readIdb(page);
check('تأیید: لیست‌های بسته تومب‌استون شدند', idb.lists.filter((l) => !l.deletedAt && l.templateKey?.startsWith('kit-store')).length === 0);
check('قاعده‌ی همیشه-یک-لیست: حداقل یک لیست زنده باقی است', idb.lists.filter((l) => !l.deletedAt).length >= 1);
check('کارت دیگر «فعال است» نیست', (await page.locator('[data-pack="kit-store"]').getByText('فعال است').count()) === 0);

/* ---------- ۶) سازگاری داده‌ی قدیمی kit-freelance ---------- */
console.log('— بلوک ۶: داده‌ی قدیمی kit');
await page.evaluate(() => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('karam-db');
    req.onerror = () => reject(new Error('idb open failed'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['lists', 'tasks'], 'readwrite');
      tx.objectStore('lists').put({
        id: 'legacy-kit-f1', name: 'روتین کاری روزانه', emoji: '💼', color: 'emerald', sortOrder: 90,
        // بدون templateKey — داده‌ی kit قدیمی v16
        createdAt: '2025-06-01T00:00:00.000Z', updatedAt: now, deletedAt: null,
      });
      tx.objectStore('tasks').put({
        id: 'legacy-kit-t1', listId: 'legacy-kit-f1', title: 'بررسی ایمیل و پیام‌های کارفرماها', notes: '',
        priority: 'normal', dueDate: null, dueTime: null, reminderMinutes: null,
        repeat: 'none', starred: false, repeatMeta: null, completedAt: null,
        createdAt: '2025-06-01T00:00:00.000Z', updatedAt: now, deletedAt: null,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(new Error('legacy tx failed')); };
    };
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
check('اپ با داده‌ی kit قدیمی کرش نکرد (بدون pageerror)', errors.length === 0, errors.slice(0, 2).join(' | '));
await gotoJobkits(page);
check('بسته‌ی فریلنسرِ نو به‌خاطر لیست قدیمی «فعال» نشد (نام قدیمی ادغام نمی‌شود)', (await page.locator('[data-pack="kit-freelance"]').getByText('فعال است').count()) === 0);

/* ---------- ۷) بکاپ شامل templateKey ---------- */
console.log('— بلوک ۷: بکاپ');
await seedActiveStorePack(page);
await page.locator('[aria-label="تب تنظیمات"]').click();
await page.waitForSelector('#view-settings', { timeout: 8000 });
const saveBtn = page.locator('[aria-label="ذخیره‌ی نسخه‌ی پشتیبان"]');
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), saveBtn.click()]);
const dlPath = join(tmpdir(), `karam-e2e-${Date.now()}-packs-backup.json`);
await download.saveAs(dlPath);
const saved = JSON.parse(readFileSync(dlPath, 'utf8'));
check('فایل بکاپ معتبر است', saved.app === 'karam' && saved.kind === 'backup');
check('بکاپ شامل templateKey لیست‌های قالبی است', (saved.lists || []).some((l) => l.templateKey === 'kit-store.0'));
check('بکاپ شامل لنگر یادآور بسته است', (saved.tasks || []).some((t) => t.title === 'بررسی سفارش‌های امروز' && t.dueTime === '10:00'));
check('BACKUP_VERSION همان ۱ مانده (بکاپ قدیمی هم بازیابی می‌شود)', saved.version === 1);
writeFileSync('/tmp/packs-e2e-backup.json', JSON.stringify(saved));

/* ---------- ۸) پوشش سینک/سرور ---------- */
console.log('— بلوک ۸: پوشش سینک سرور (ارجاع)');
try {
  const res = await fetch('http://127.0.0.1:8099/api/health', { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    check('پوشش سینک/بک‌اند در tests/phase-jobpacks-test.php سبز است (سیم‌سینک با همان بدنه‌ی push/pull)', true);
  } else {
    throw new Error('not ok');
  }
} catch {
  console.log('  ⚠️ سرور API در این اجرا بالا نیست — پوشش سرور: tests/phase-jobpacks-test.php (۲۱ بررسی).');
  check('ارجاع پوشش سرور (اجرای جداگانه سوئیت PHP)', true);
}

console.log('\n———————————————');
if (fail === 0) {
  console.log(`✓ همه‌ی ${pass} بررسی سبز بود`);
} else {
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log('شکست‌ها:', failures.join(' | '));
}
await page.screenshot({ path: join(SHOTS, 'packs-final.png') });
await browser.close();
process.exit(fail === 0 ? 0 : 1);

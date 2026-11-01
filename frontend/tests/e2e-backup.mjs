/**
 * کارام — تست e2e «P1.3 — پشتیبان‌گیری و بازیابی شفاف» روی وب (Playwright)
 *
 * بدون سرور API (حالت مهمان — همه‌چیز محلی):
 *   ۱) ذخیره‌ی نسخه‌ی پشتیبان: دانلود واقعی فایل با نام karam-backup-*.json
 *      + توست «دانلود شد» + «آخرین پشتیبان: <شمسی>»
 *   ۲) بازیابی با تأیید: انتخاب فایل ← دیالوگ پیش‌نمایش (تاریخ + شمارش) ← انصراف ←
 *      دوباره ← «بازیابی» ← دیالوگ نتیجه‌ی ماندگار (افزوده/به‌روزشده/محلی ماند)
 *   ۳) خطاها: فایل غیرکارام / فایل خراب / نسخه‌ی جدیدتر — توست فارسی تفکیک‌شده
 *   ۴) آیکن «؟» بلوک‌ها: پاپ‌اوور توضیح باز می‌شود
 *
 * اجرا:
 *   ۱) بیلد:  cd frontend && bun run build
 *   ۲) سرور ثابت:  bunx vite preview --port 4173
 *   ۳) تست:  node tests/e2e-backup.mjs
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

/** بستن لایه‌های اولین اجرا (تور/خوش‌آمد/ظاهر) */
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

async function gotoSettings(page) {
  await page.locator('[aria-label="تب تنظیمات"]').click();
  await page.waitForSelector('#view-settings', { timeout: 8000 });
  await sleep(300);
}

/** صبر برای توست با متن مشخص */
async function waitToast(page, needle, timeout = 6000) {
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

console.log('— نصب تازه و ورود به تنظیمات');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitApp(page);
await dismissFirstRunLayers(page);
await gotoSettings(page);

const saveBtn = page.locator('[aria-label="ذخیره‌ی نسخه‌ی پشتیبان"]');
const pickBtn = page.locator('[aria-label="انتخاب فایل پشتیبان و بازیابی"]');
const fileInput = page.locator('input[type="file"]');

console.log('— بلوک ۱: ذخیره‌ی نسخه‌ی پشتیبان (وب = دانلود واقعی)');
check('دکمه‌ی ذخیره دیده می‌شود', await saveBtn.isVisible());
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), saveBtn.click()]);
const dlPath = join(tmpdir(), `karam-e2e-${Date.now()}-backup.json`);
await download.saveAs(dlPath);
const fileName = download.suggestedFilename();
check('نام فایل با karam-backup- شروع می‌شود', /^karam-backup-.*\.json$/.test(fileName), fileName);
const saved = JSON.parse(readFileSync(dlPath, 'utf8'));
check('فایل پشتیبان معتبر است (app/kind)', saved.app === 'karam' && saved.kind === 'backup');
check('توست موفقیت با نام فایل و تعداد رکورد', await waitToast(page, 'karam-backup-'));
check('«آخرین پشتیبان» با تاریخ شمسی ظاهر شد', (await page.getByText('آخرین پشتیبان:').count()) > 0);

console.log('— بلوک ۲: بازیابی با دیالوگ تأیید');
await pickBtn.click();
await fileInput.setInputFiles({ name: fileName, mimeType: 'application/json', buffer: readFileSync(dlPath) });
await page.waitForSelector('[data-testid="restore-confirm"]', { timeout: 8000 });
check('دیالوگ پیش‌نمایش/تأیید باز شد', true);
check('تاریخ ساخت شمسی در پیش‌نمایش هست', (await page.locator('[data-testid="restore-confirm"]').getByText('تاریخ ساخت فایل').count()) > 0);
check('جمله‌ی «هیچ‌چیز حذف نمی‌شود» هست', (await page.locator('[data-testid="restore-confirm"]').getByText('هیچ‌چیز حذف نمی‌شود').count()) > 0);

// اول انصراف — نباید چیزی اعمال شود
await page.locator('[aria-label="انصراف از بازیابی"]').click();
await sleep(300);
check('انصراف، دیالوگ را می‌بندد', (await page.locator('[data-testid="restore-confirm"]').count()) === 0);

// دوباره و این‌بار تأیید
await pickBtn.click();
await fileInput.setInputFiles({ name: fileName, mimeType: 'application/json', buffer: readFileSync(dlPath) });
await page.waitForSelector('[data-testid="restore-confirm"]', { timeout: 8000 });
await page.locator('[aria-label="تأیید بازیابی"]').click();
await page.waitForSelector('[data-testid="restore-result"]', { timeout: 8000 });
check('دیالوگ نتیجه‌ی ماندگار باز شد', true);
check('ردیف «افزوده شد» در نتیجه هست', (await page.locator('[data-testid="restore-result"]').getByText('افزوده شد').count()) > 0);
check('جمله‌ی «حذف نشده است» در نتیجه هست', (await page.locator('[data-testid="restore-result"]').getByText('حذف نشده است').count()) > 0);
await page.screenshot({ path: join(SHOTS, 'p13-restore-result.png') });
await page.locator('[aria-label="بستن نتیجه‌ی بازیابی"]').click();
await sleep(300);

console.log('— خطاهای تفکیک‌شده');
// فایل غیرکارام
await pickBtn.click();
await fileInput.setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'other', kind: 'export' })) });
check('فایل غیرکارام → پیام مشخص', await waitToast(page, 'فایل پشتیبان کارام نیست'));
await sleep(500);
// فایل خراب
await pickBtn.click();
await fileInput.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ناتمام') });
check('فایل خراب → پیام مشخص', await waitToast(page, 'فایل خراب است'));
await sleep(500);
// نسخه‌ی جدیدتر
const newer = { ...saved, version: 99 };
await pickBtn.click();
await fileInput.setInputFiles({ name: 'newer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newer)) });
check('نسخه‌ی جدیدتر → پیام مشخص', await waitToast(page, 'نسخه‌ی جدیدتر'));

console.log('— آیکن «؟» (پاپ‌اوور توضیح)');
await page.locator('[aria-label="راهنمای ذخیره‌ی نسخه‌ی پشتیبان"]').click();
check('پاپ‌اوور «فایل چه چیزی دارد؟» باز شد', (await page.getByText('فایل چه چیزی دارد؟').count()) > 0);
// بستن با Escape (رفتار دسترس‌پذیری پاپ‌اوور) + اطمینان با کلیک نقطه‌ی خنثی
await page.keyboard.press('Escape');
await sleep(300);
await page.locator('#view-settings h1').click();
await sleep(200);
check('پاپ‌اوور بسته شد', (await page.getByText('فایل چه چیزی دارد؟').count()) === 0);
await page.locator('[aria-label="راهنمای بازیابی از فایل"]').click();
check('پاپ‌اوور «بازیابی چه می‌کند؟» باز شد', (await page.getByText('بازیابی چه می‌کند؟').count()) > 0);

check('صفر خطای کنسول (pageerror)', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\nنتیجه: ${pass} موفق / ${fail} ناموفق`);
if (fail > 0) {
  console.log('شکست‌ها:', failures.join(' · '));
  process.exit(1);
}

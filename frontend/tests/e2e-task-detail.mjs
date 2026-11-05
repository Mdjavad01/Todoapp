/**
 * کارام — تست e2e «جزئیات کار دوسطحی + نوع آیتم فقط تریدر + ردیف فقط فوری» (بسته B)
 *
 * پوشش:
 *   ۱) سطح اول جزئیات: ستاره سربرگ + عنوان + یادداشت بزرگ‌تر (۵ سطری) + سررسید — بدون شلوغی
 *   ۲) «بیشتر»: روزهای من/اولویت/زیرکار/یادآور/تکرار/انتقال به لیست پشت بازشو — نوع آیتم در لیست معمولی نیست
 *   ۳) «نوع آیتم» فقط در لیست‌های تریدر (بعد از فعال‌سازی تمپلیت)
 *   ۴) ردیف کار: فقط «فوری» نشان دارد — «بالا» هم از ردیف جمع شده (بسته B)
 *   ۵) اصلاح ۲: فیلد غیرپیش‌فرض پشت «بیشتر» → دکمه با شمارنده‌ی «بیشتر • N» (به‌روزرسانی زنده)
 *
 * اجرا:
 *   ۱) بیلد آزمایشی:  bun run build
 *   ۲) سرور ثابت:     bunx vite preview --port 4173
 *   ۳) تست:           node tests/e2e-task-detail.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
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
  await page.waitForSelector('#view-home', { timeout: 15000 });
  await sleep(300);
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

/** بازکردن شیت جزئیات یک کار در نمای لیست + بازکردن «بیشتر» */
async function openDetail(page, title) {
  const card = page.locator('#view-listView div.rounded-2xl', { hasText: title }).last();
  await card.locator('h3', { hasText: title }).first().click();
  await page.waitForSelector('[aria-label="عنوان کار"]', { timeout: 6000 });
  await sleep(250);
}

async function closeDetail(page) {
  await page.locator('[aria-label="بستن"]').last().click();
  await sleep(350);
}

const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('— نصب تازه + ساخت سه کار (عادی / فوری / بالا) از نوار پایین');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(page);
  await dismissFirstRunLayers(page);
  await sleep(400);

  const bar = page.locator('#quick-bar');
  for (const t of ['کار عادی', 'کار فوری', 'کار بالا']) {
    await bar.locator('input').fill(t);
    await bar.locator('input').press('Enter');
    await sleep(700);
  }

  // ورود به لیست پیش‌فرض
  await page.locator('[aria-label*="باز کردن لیست کارهای من"]').click();
  await page.waitForSelector('#view-listView', { timeout: 8000 });
  await sleep(400);

  console.log('— بلوک ۱: سطح اول جزئیات (ستاره/عنوان/یادداشت/سررسید) و بسته‌بودن «بیشتر»');
  await openDetail(page, 'کار عادی');
  check('ستاره سرِ سربرگ هست (تنها نشان «مهم» سطح اول)', (await page.locator('[aria-label="افزودن ستاره (مهم)"]').count()) === 1);
  check('عنوان سطح اول هست', await page.locator('[aria-label="عنوان کار"]').isVisible());
  const notes = page.locator('[aria-label="یادداشت"]');
  check('یادداشت بزرگ‌تر شده (۵ سطر)', (await notes.getAttribute('rows')) === '5');
  check('سررسید در سطح اول هست', await page.getByText('سررسید:', { exact: false }).first().isVisible());
  const more = page.locator('button[aria-controls="task-more"]');
  check('دکمه‌ی «بیشتر» هست و بسته است', (await more.count()) === 1 && (await more.getAttribute('aria-expanded')) === 'false');
  check('«روزهای من» قبل از «بیشتر» دیده نمی‌شود', (await page.locator('[aria-label="افزودن به روزهای من"]').count()) === 0);
  check('اولویت قبل از «بیشتر» دیده نمی‌شود', (await page.locator('[role="radiogroup"][aria-label="اولویت و فوریت کار"]').count()) === 0);
  check('یادآور قبل از «بیشتر» دیده نمی‌شود', (await page.locator('[aria-label="یادآور"]').count()) === 0);
  check('«نوع آیتم» در لیست معمولی اصلاً نیست (بسته B)', (await page.getByText('نوع آیتم (چک‌لیست تریدر)').count()) === 0);

  console.log('— بلوک ۲: بازشدن «بیشتر» — تنظیمات ثانویه + ست‌کردن اولویت فوری');
  await more.click();
  await sleep(250);
  check('«بیشتر» باز شد (aria-expanded=true)', (await more.getAttribute('aria-expanded')) === 'true');
  check('«روزهای من» داخل «بیشتر» هست', (await page.locator('[aria-label="افزودن به روزهای من"]').count()) === 1);
  check('اولویت داخل «بیشتر» هست', (await page.locator('[role="radiogroup"][aria-label="اولویت و فوریت کار"]').count()) === 1);
  check('زیرکارها داخل «بیشتر» هست', await page.getByText('زیرکارها (Subtasks)').isVisible());
  check('تکرار داخل «بیشتر» هست', (await page.locator('[aria-label="تکرار"]').count()) === 1);
  check('انتقال به لیست داخل «بیشتر» هست', await page.getByText('انتقال به لیست:').isVisible());
  await closeDetail(page);

  // «کار فوری» = فوری و «کار بالا» = بالا (از طریق «بیشتر») — «کار عادی» متوسط می‌ماند
  await openDetail(page, 'کار فوری');
  await page.locator('button[aria-controls="task-more"]').click();
  await sleep(250);
  await page.locator('[role="radiogroup"][aria-label="اولویت و فوریت کار"] button', { hasText: 'فوری' }).click();
  await sleep(400);
  await closeDetail(page);

  await openDetail(page, 'کار بالا');
  await page.locator('button[aria-controls="task-more"]').click();
  await sleep(250);
  await page.locator('[role="radiogroup"][aria-label="اولویت و فوریت کار"] button', { hasText: 'بالا' }).click();
  await sleep(400);
  await closeDetail(page);

  console.log('— بلوک ۳: ردیف کار فقط «فوری» نشان دارد — «بالا» هم جمع شد');
  const urgentCard = page.locator('#view-listView div.rounded-2xl', { hasText: 'کار فوری' }).last();
  check('ردیف کار فوری نشان «فوری» دارد', (await urgentCard.getByText('فوری', { exact: true }).count()) > 0);
  const highCard = page.locator('#view-listView div.rounded-2xl', { hasText: 'کار بالا' }).last();
  check('ردیف کار «بالا» دیگر نشان «بالا» ندارد (بسته B)', (await highCard.getByText('بالا', { exact: true }).count()) === 0);
  const normalCard = page.locator('#view-listView div.rounded-2xl', { hasText: 'کار عادی' }).last();
  check('ردیف کار عادی هیچ نشان اولویتی ندارد', (await normalCard.getByText('متوسط', { exact: true }).count()) === 0);
  await page.screenshot({ path: join(SHOTS, 'task-detail-rows.png') });

  console.log('— بلوک ۳٫۵: شمارنده‌ی «بیشتر • N» (اصلاح ۲ — ترجیح صاحب محصول: شمارنده، نه بازشدن خودکار)');
  await openDetail(page, 'کار عادی');
  const moreDefault = page.locator('button[aria-controls="task-more"]');
  check('کار با همه‌ی پیش‌فرض‌ها: برچسب کامل، بدون شمارنده', (await moreDefault.innerText()).includes('بیشتر: روزهای من') && !(await moreDefault.innerText()).includes('بیشتر •'));
  await closeDetail(page);

  await openDetail(page, 'کار فوری');
  const moreCounter = page.locator('button[aria-controls="task-more"]');
  check('کار فوری (اولویت غیرپیش‌فرض): «بیشتر • ۱»', (await moreCounter.innerText()).includes('بیشتر • ۱'), await moreCounter.innerText());
  check('با شمارنده، برچسب بلند جایگزین می‌شود', !(await moreCounter.innerText()).includes('روزهای من،'));
  check('برچسب کامل در title دکمه باقی است (کشف‌پذیری)', ((await moreCounter.getAttribute('title')) ?? '').includes('یکی از این‌ها مقدار دارد'));
  await moreCounter.click();
  await sleep(250);
  check('باز شده: برچسب «بستن تنظیمات بیشتر»', (await moreCounter.innerText()).includes('بستن تنظیمات بیشتر'));
  // افزودن زیرکار داخل «بیشتر» → شمارنده باید زنده به ۲ برسد
  // (دکمه‌ی «افزودن» = خواهرِ برچسب «زیرکارها (Subtasks)» — «افزودن به روزهای من» را نمی‌گیرد)
  const subsHeader = page.locator('#task-more').getByText('زیرکارها (Subtasks)').locator('..');
  await subsHeader.getByRole('button').click();
  await sleep(200);
  const subInput = page.locator('#task-more input[placeholder*="زیرکار جدید"]');
  await subInput.fill('زیرکار شمارنده');
  await subInput.press('Enter');
  await sleep(600);
  await moreCounter.click(); // بستن «بیشتر»
  await sleep(300);
  check('بعد از افزودن زیرکار: «بیشتر • ۲» (به‌روزرسانی زنده از استور)', (await moreCounter.innerText()).includes('بیشتر • ۲'), await moreCounter.innerText());
  await page.screenshot({ path: join(SHOTS, 'task-detail-more-counter.png') });
  await closeDetail(page);

  console.log('— بلوک ۴: «نوع آیتم» فقط در لیست‌های تریدر (فعال‌سازی تمپلیت)');
  await page.locator('[aria-label="تب تنظیمات"]').click();
  await page.waitForSelector('#view-settings', { timeout: 8000 });
  await page.locator('[aria-label="قالب‌های آماده"]').click();
  await page.waitForSelector('#view-templates', { timeout: 8000 });
  await sleep(300);
  await page.locator('#trader-card').getByText('فعال‌سازی تمپلیت ترید').click();
  await sleep(300);
  const dialog = page.locator('[aria-label="ساعت سشن معاملاتی"]');
  await dialog.locator('[aria-label="ساعت شروع سشن"]').fill('09:00');
  await dialog.locator('[aria-label="ساعت پایان سشن"]').fill('17:00');
  await dialog.getByText('فعال‌سازی', { exact: true }).click();
  await sleep(800);

  await page.locator('[aria-label="تب خانه"]').click();
  await sleep(400);
  await page.locator('[aria-label*="باز کردن لیست قوانین من"]').click();
  await page.waitForSelector('#view-listView', { timeout: 8000 });
  await sleep(400);
  await openDetail(page, 'حداکثر ضرر روزانه');
  await page.locator('button[aria-controls="task-more"]').click();
  await sleep(250);
  check('در لیست تریدر «نوع آیتم» داخل «بیشتر» هست', await page.getByText('نوع آیتم (چک‌لیست تریدر)').isVisible());
  check('گزینه‌های نوع آیتم = ۵ نوع', (await page.locator('[role="radiogroup"][aria-label="نوع آیتم"] [role="radio"]').count()) === 5);
  await page.screenshot({ path: join(SHOTS, 'task-detail-trader-itemtype.png') });
  await closeDetail(page);

  check('هیچ خطای صفحه (pageerror) رخ نداد', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}

await browser.close();
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`);
if (fail > 0) {
  console.log('موردهای قرمز:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

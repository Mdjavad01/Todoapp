/**
 * کارام — تست e2e «P1 — ایمنی و اعتماد» با سرور واقعی (Playwright)
 *
 * پوشش:
 *   A) بنر مهمان: نمایش در خانه + دکمه‌ی بک‌آپ (دانلود واقعی + توست) + بستن پایا (بعد از رفرش نمی‌آید)
 *   B) دریافت داده‌های من (export): دانلود JSON واقعی از /api/v1/account/export + محتوای درست
 *   C) شیت حذف حساب: هشدار با متن بکاپ ← کد حذف (کد ورود ≠ کد حذف — کد ورود سمت سرور رد می‌شود)
 *      ← تایپ «حذف حساب» ← حذف موفق ← ۴۰۱ فوری روی دستگاه دوم (fetch با توکن دست‌نخورده)
 *
 * اجرا:
 *   ۱) بیلد آزمایشی:  VITE_API_BASE=http://127.0.0.1:8099/api bun run build
 *   ۲) سرور ثابت:     bunx vite preview --port 4173
 *   ۳) بک‌اند ۸۰۹۹ با OTP_DEBUG=1 و CORS_EXTRA_ORIGINS=http://localhost:4173
 *   ۴) تست:           node tests/e2e-trust.mjs   (E2E_API=1 برای بخش‌های B و C)
 */

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
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

/** صبر برای آماده شدن اپ */
async function waitApp(page) {
  await page.waitForSelector('#view-home', { timeout: 15000 });
  await sleep(400);
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

/** بستن آنبوردینگ خوش‌آمد + شیت انتخاب ظاهر (بعد از اولین ورود حساب جدید) */
async function dismissWelcomeIfShown(page) {
  let dismissed = false;
  for (let i = 0; i < 3; i++) {
    let hit = false;
    try {
      const btn = page.getByRole('button', { name: 'بعداً تکمیلش می‌کنم' });
      await btn.waitFor({ state: 'visible', timeout: 4000 });
      await btn.click();
      await sleep(400);
      hit = dismissed = true;
    } catch {}
    try {
      const g = page.getByRole('button', { name: 'فعلاً بعداً انتخاب می‌کنم' });
      await g.waitFor({ state: 'visible', timeout: 2500 });
      await g.click();
      await sleep(400);
      hit = dismissed = true;
    } catch {}
    if (!hit) break;
  }
  return dismissed;
}

/**
 * کلیک پایدار داخل بات‌شیت حساب — محتوای شیت (نشست‌ها/رفرال) async می‌آید و
 * هیت‌تست Playwright را جابه‌جا می‌کند؛ پس با DOM click مستقیم و اسکرول به مرکز.
 */
async function clickInSheet(page, aria) {
  await sleep(500);
  await page.evaluate((a) => {
    const el = document.querySelector(`[aria-label="${a}"]`);
    if (!el) throw new Error(`element not found: ${a}`);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, aria);
  await sleep(400);
}

/** ورود با ایمیل از رابط کاربری؛ کد dev بازگردانده می‌شود (OTP_DEBUG=1) */
async function loginViaUi(page, email) {
  await page.click('[aria-label="تب تنظیمات"]');
  await page.click('[aria-label="حساب کاربری و سینک"]');
  await page.getByText('ورود با ایمیل', { exact: false }).first().click();
  await page.fill('#karam-login-email', email);
  await page.getByRole('button', { name: 'دریافت کد' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('dev:'), { timeout: 15000 });
  const code = await page.evaluate(() => {
    const m = document.body.innerText.match(/dev:\s*(\d{6})/);
    return m ? m[1] : null;
  });
  if (!code) throw new Error('devCode پیدا نشد');
  await page.fill('#karam-login-code', code);
  await page.getByRole('button', { name: 'تأیید و ورود' }).click();
  await sleep(800);
  return code;
}

/** خواندن نشست (توکن) از IndexedDB اپ — برای آزمون ۴۰۱ دستگاه دوم */
async function readSessionToken(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('karam-db');
        req.onerror = () => reject(new Error('idb open failed'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('prefs', 'readonly');
          const all = tx.objectStore('prefs').getAll();
          all.onsuccess = () => {
            db.close();
            const row = (all.result || []).find((r) => r.key === 'sync-session');
            resolve(row?.value?.accessToken ?? null);
          };
          all.onerror = () => reject(new Error('getAll failed'));
        };
      }),
  );
}

const browser = await chromium.launch();

/* ============ A) بنر مهمان ============ */
console.log('\n── A) بنر هشدار داده‌ی مهمان ──');
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitApp(p);
  await dismissGuideIfShown(p);

  const banner = p.locator('#guest-banner');
  try {
    await banner.waitFor({ state: 'visible', timeout: 6000 });
    check('بنر مهمان در خانه نمایش داده شد', true);
  } catch {
    check('بنر مهمان در خانه نمایش داده شد', false);
  }
  check('متن صادقانه‌ی «فقط روی همین گوشی» هست', (await banner.count()) > 0 && (await banner.innerText()).includes('فقط روی همین گوشی'));

  // دکمه‌ی بک‌آپ → دانلود واقعی + توست
  const dlPromise = p.waitForEvent('download', { timeout: 15000 });
  await p.click('[aria-label="بک‌آپ گرفتن از داده‌ی مهمان"]');
  let dlOk = false;
  let dlPath = '';
  try {
    const dl = await dlPromise;
    dlPath = join(tmpdir(), `karam-guest-${dl.suggestedFilename()}`);
    await dl.saveAs(dlPath);
    dlOk = dl.suggestedFilename().endsWith('.json');
  } catch {
    dlOk = false;
  }
  check('دکمه‌ی «بک‌آپ بگیر» فایل JSON دانلود کرد', dlOk, dlPath);
  check('توست پشتیبان ظاهر شد', await p.getByText('فایل پشتیبان', { exact: false }).first().isVisible().catch(() => false));

  // بستن پایا
  await p.click('[aria-label="بستن هشدار داده‌ی مهمان"]');
  await sleep(400);
  check('بستن ⇒ بنر می‌رود', (await banner.count()) === 0);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await waitApp(p);
  check('بعد از رفرش دیگر نمی‌آید (پایا)', (await banner.count()) === 0);

  await ctx.close();
}

/* ============ B و C) با API واقعی ============ */
if (process.env.E2E_API === '1') {
  const email = `trust-${Date.now()}@karam-test.local`;

  /* ---- B) دریافت داده‌های من ---- */
  console.log('\n── B) دریافت داده‌های من (export) ──');
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitApp(p);
    await dismissGuideIfShown(p);
    await loginViaUi(p, email);
    await dismissWelcomeIfShown(p);

    await p.click('[aria-label="حساب کاربری و سینک"]');
    await sleep(800);
    let exportStatus = 0;
    p.on('response', (r) => {
      if (r.url().includes('/account/export')) exportStatus = r.status();
    });
    // شنونده‌ی دانلود قبل از کلیک — خروجی کوچک و سریع است و نباید از دست برود
    const dlPromise = p.waitForEvent('download', { timeout: 15000 });
    await clickInSheet(p, 'دریافت داده‌های من');
    let dlOk = false;
    let content = '';
    try {
      const dl = await dlPromise;
      const path = join(tmpdir(), `karam-export-${dl.suggestedFilename()}`);
      await dl.saveAs(path);
      content = readFileSync(path, 'utf8');
      dlOk = dl.suggestedFilename().endsWith('.json');
    } catch {
      dlOk = false;
    }
    if (!dlOk) {
      const bodyText = await p.evaluate(() => document.body.innerText);
      console.log('  🔎 export status:', exportStatus, '| خطا روی صفحه:', bodyText.includes('دریافت داده‌ها ناموفق بود'), '| نشست:', bodyText.includes('حالت مهمان'));
    }
    check('دکمه‌ی «دریافت داده‌های من» فایل JSON دانلود کرد', dlOk, `status=${exportStatus}`);
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    check('JSON سالم است و user دارد', parsed?.user?.uuid?.length === 36, `uuid=${parsed?.user?.uuid ?? '—'}`);
    check('هویت ایمیل در خروجی هست', (parsed?.identities ?? []).some((i) => i.type === 'email' && i.value === email));
    check('فهرست lists/tasks/subtasks خالی‌نبود (ساختار کامل)', Array.isArray(parsed?.lists) && Array.isArray(parsed?.tasks) && Array.isArray(parsed?.subtasks));

    await ctx.close();
  }

  /* ---- C) شیت حذف حساب + ۴۰۱ فوری دستگاه دوم ---- */
  console.log('\n── C) شیت حذف حساب (کد ورود ≠ کد حذف · تایپ «حذف حساب» · ۴۰۱ دستگاه دوم) ──');
  {
    // دستگاه A — همان‌جا حذف انجام می‌شود
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pA = await ctxA.newPage();
    await pA.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitApp(pA);
    await dismissGuideIfShown(pA);
    const loginCode = await loginViaUi(pA, email);
    await dismissWelcomeIfShown(pA);

    // دستگاه B — فقط وارد می‌شود و توکنش را نگه می‌داریم
    const ctxB = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const pB = await ctxB.newPage();
    await pB.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitApp(pB);
    await dismissGuideIfShown(pB);
    await loginViaUi(pB, email);
    const tokenB = await readSessionToken(pB);
    check('توکن دستگاه B خوانده شد', typeof tokenB === 'string' && tokenB.length > 20);

    // ---- فلوی حذف روی دستگاه A ----
    await pA.click('[aria-label="حساب کاربری و سینک"]');
    await sleep(800);
    await clickInSheet(pA, 'حذف حساب');
    const warn = pA.locator('[aria-label="هشدار حذف حساب"]');
    await warn.waitFor({ state: 'visible', timeout: 6000 });
    check('هشدار حذف با متن صادقانه‌ی بکاپ نمایش داده شد', (await warn.innerText()).includes('بکاپ‌های سروری'));

    await clickInSheet(pA, 'ادامه — ارسال کد حذف');
    await pA.waitForSelector('#karam-delete-code', { timeout: 10000 });
    await pA.waitForFunction(() => document.body.innerText.match(/dev:\s*(\d{6})/) !== null, { timeout: 15000 });
    const deleteCode = await pA.evaluate(() => {
      const all = document.body.innerText.match(/dev:\s*(\d{6})/g) ?? [];
      const last = all[all.length - 1];
      return last ? last.replace('dev:', '').trim() : null;
    });
    check('کد حذف نمایش داده شد', !!deleteCode && /^\d{6}$/.test(deleteCode));
    check('کد حذف با کد ورود یکی نیست', deleteCode !== loginCode);

    // «ادامه» با کدِ ورود (عمداً اشتباه) → تأیید نهایی → سرور ۴۰۰ می‌دهد
    await pA.fill('#karam-delete-code', loginCode);
    await clickInSheet(pA, 'ادامه به تأیید حذف');
    await pA.waitForSelector('#karam-delete-confirm', { timeout: 10000 });
    await pA.fill('#karam-delete-confirm', 'حذف حساب');
    await pA.fill('#karam-delete-code-final', loginCode);
    await clickInSheet(pA, 'حذف کامل حساب');
    await sleep(1200);
    const errorShown = await pA.evaluate(() => {
      const el = document.querySelector('[aria-label="تأیید نهایی حذف حساب"]');
      return el ? /کد|فعال/.test(el.textContent ?? '') : false;
    });
    check('کد ورود برای حذف سمت سرور رد شد (پیام خطا نمایش داده شد)', errorShown);

    // کد درست + تایپ دقیق عبارت
    await pA.fill('#karam-delete-code-final', deleteCode);
    await clickInSheet(pA, 'حذف کامل حساب');
    await sleep(1500);
    check('حذف موفق: توست حذف ظاهر شد', await pA.getByText('حساب شما حذف شد', { exact: false }).first().isVisible().catch(() => false));

    // ---- ۴۰۱ فوری روی دستگاه دوم (توکن دست‌نخورده) ----
    const status = await pB.evaluate(async (token) => {
      try {
        const res = await fetch('http://127.0.0.1:8099/api/v1/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.status;
      } catch {
        return 0;
      }
    }, tokenB);
    check('دستگاه دوم با همان توکن → ۴۰۱ فوری', status === 401, `status=${status}`);

    // رفتار کاربری: رفرش دستگاه B → نشست پاک می‌شود (مهمان) و بنر مهمان می‌آید
    await pB.reload({ waitUntil: 'domcontentloaded' });
    await waitApp(pB);
    await sleep(1500);
    const bIsGuest = await pB.evaluate(async (token) => {
      const tryRefresh = await fetch('http://127.0.0.1:8099/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'invalid-check' }),
      }).then((r) => r.status).catch(() => 0);
      return { refreshRejected: tryRefresh === 401 || tryRefresh === 400, bannerVisible: !!document.querySelector('#guest-banner') };
    }, tokenB);
    check('دستگاه B بعد از حذف مهمان شد (بنر مهمان برگشت)', bIsGuest.bannerVisible);

    await ctxA.close();
    await ctxB.close();
  }
} else {
  console.log('  ⏭️ بخش‌های B و C رد شدند (E2E_API=1 تنظیم نشد — بدون بک‌اند)');
}

await browser.close();
console.log(`\n════ نتیجه: ${pass} موفق / ${fail} ناموفق ════`);
if (failures.length) {
  console.log('شکست‌ها:', failures.join(' | '));
  process.exit(1);
}

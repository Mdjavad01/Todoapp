/**
 * کارام — ساخت بسته‌ی وب مخصوص اپ اندروید (فاز ۶)
 * همان فرانت frontend/src با یک تفاوت بیلد:
 *   VITE_API_BASE آدرس مطلق سرور است (WebView از مبدأ localhost اجرا می‌شود)
 * خروجی در mobile/www قرار می‌گیرد و با `cap sync` داخل APK بسته‌بندی می‌شود.
 *
 * اجرا:  bun run build:www   یا   API_BASE="https://app.hojre24shop.ir/api" bun run build:www
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBazaarStaticTransform, assertNoBazaarForbiddenWords } from './bazaar-static-pages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..');
const frontendDir = join(repoRoot, 'frontend');
const outDir = join(frontendDir, 'dist-mobile');
const wwwDir = join(mobileRoot, 'www');

/** آدرس API سرور — روی هاست واقعی همان دامین اپ است */
const API_BASE = process.env.API_BASE ?? 'https://app.hojre24shop.ir/api';

/**
 * گام ۲ — حالت بیلد:
 *   default | (خالی)  → پرداخت روشن (VITE_PAYMENTS_BUILD=on)
 *   bazaar            → پرداخت کامل حذف (VITE_PAYMENTS_BUILD=off) — نسخه‌ی بدون خرید برای بازاری
 *                      که پرداخت درون‌برنامه‌ای خارجی را نمی‌پذیرد.
 */
const MODE = (process.env.BUILD_MODE ?? 'default').toLowerCase();
const PAYMENTS_BUILD = MODE === 'bazaar' ? 'off' : (process.env.VITE_PAYMENTS_BUILD ?? 'on');

console.log(`⟳ بیلد وب برای اندروید — API_BASE=${API_BASE} · حالت=${MODE === 'bazaar' ? 'bazaar (بدون پرداخت)' : 'default'}`);

const res = spawnSync('bunx', ['vite', 'build', '--outDir', 'dist-mobile', '--emptyOutDir'], {
  cwd: frontendDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_BASE: API_BASE, VITE_API_EXTRA_QUERY: '', VITE_PAYMENTS_BUILD: PAYMENTS_BUILD },
});
if (res.status !== 0) {
  console.error('✗ بیلد وب ناموفق بود');
  process.exit(res.status ?? 1);
}

// v1.12.1 — بیلد بازار: صفحات ایستای /terms/ و /privacy/ هم صادق می‌شوند (بدون بند پرداخت).
// fail-loud: نشانه‌ی ناموجود = شکست بیلد، هرگز بی‌صدا نه.
if (PAYMENTS_BUILD === 'off') {
  const pagesDir = join(outDir);
  for (const page of ['terms', 'privacy']) {
    const file = join(pagesDir, page, 'index.html');
    const before = readFileSync(file, 'utf8');
    const after = applyBazaarStaticTransform(before, page);
    assertNoBazaarForbiddenWords(after, page);
    writeFileSync(file, after);
    console.log(`✅ تبدیل صداقت بازار روی /${page}/ اعمال شد (بدون واژه‌های پرداخت)`);
  }
}

rmSync(wwwDir, { recursive: true, force: true });
cpSync(outDir, wwwDir, { recursive: true });
rmSync(outDir, { recursive: true, force: true });
console.log('✅ www آماده شد → mobile/www (با cap sync بسته‌بندی می‌شود)');

/**
 * کارام — ساخت بسته‌ی وب مخصوص اپ اندروید (فاز ۶)
 * همان فرانت frontend/src با یک تفاوت بیلد:
 *   VITE_API_BASE آدرس مطلق سرور است (WebView از مبدأ localhost اجرا می‌شود)
 * خروجی در mobile/www قرار می‌گیرد و با `cap sync` داخل APK بسته‌بندی می‌شود.
 *
 * اجرا:  bun run build:www   یا   API_BASE="https://app.hojre24shop.ir/api" bun run build:www
 */
import { cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..');
const frontendDir = join(repoRoot, 'frontend');
const outDir = join(frontendDir, 'dist-mobile');
const wwwDir = join(mobileRoot, 'www');

/** آدرس API سرور — روی هاست واقعی همان دامین اپ است */
const API_BASE = process.env.API_BASE ?? 'https://app.hojre24shop.ir/api';

console.log(`⟳ بیلد وب برای اندروید — API_BASE=${API_BASE}`);

const res = spawnSync('bunx', ['vite', 'build', '--outDir', 'dist-mobile', '--emptyOutDir'], {
  cwd: frontendDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_BASE: API_BASE, VITE_API_EXTRA_QUERY: '' },
});
if (res.status !== 0) {
  console.error('✗ بیلد وب ناموفق بود');
  process.exit(res.status ?? 1);
}

rmSync(wwwDir, { recursive: true, force: true });
cpSync(outDir, wwwDir, { recursive: true });
rmSync(outDir, { recursive: true, force: true });
console.log('✅ www آماده شد → mobile/www (با cap sync بسته‌بندی می‌شود)');

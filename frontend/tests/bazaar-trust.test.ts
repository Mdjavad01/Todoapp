/**
 * کارام — تست قراردادی صداقت بیلد بازار (v1.12.1 — موج اصلاحی پیش از ادغام)
 *
 * اجرا:  cd frontend && bun test tests/bazaar-trust.test.ts
 *
 * درخواست صاحب محصول: «بیلد بازار را اسکن کن و هر کلمه‌ی ممنوع («درگاه»، «کارت‌به‌کارت»،
 * «ارتقا به کارام پرو») در متن‌های UI آن رد شود.»
 *
 * معماری صداقت (که این تست قراردادش را قفل می‌کند):
 *   ۱) خزانه‌ی متن‌ها دو شاخه‌ی فیزیکی دارد: lib/bazaarTexts.ts (latest) و
 *      lib/bazaarTexts.bazaar.ts (بازار) — در بیلد بازار alias ماژول را جابه‌جا می‌کند
 *      (همان مکانیزم PaywallView) → متن پرداخت‌دار latest اصلاً وارد باندل بازار نمی‌شود.
 *   ۲) PaywallView.tsx + PaymentMethodSheet.tsx در بیلد بازار با alias حذف فیزیکی می‌شوند.
 *   ۳) صفحات ایستای /terms/ و /privacy/ در بیلد بازار با bazaar-static-pages.mjs
 *      تبدیل می‌شوند (fail-loud).
 *   ۴) گام CI «اسکن صداقت باندل بازار» باندلِ واقعاً ساخته‌شده را grep می‌کند (سد دوم).
 *
 * این تست سورس را در سطح «قرارداد» می‌سنجد؛ اسکن باندل واقعی در CI انجام می‌شود.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as latestTexts from '@/lib/bazaarTexts';
import * as bazaarTexts from '@/lib/bazaarTexts.bazaar';

/** واژه‌های ممنوع در هر متن UI بیلد بازار (درخواست صاحب محصول + نام درگاه) */
const FORBIDDEN = ['درگاه', 'کارت‌به‌کارت', 'کارت به کارت', 'ارتقا به کارام پرو', 'زیبال'];

const SRC_ROOT = join(import.meta.dir, '..', 'src');

/** فایل‌هایی که در بیلد بازار فیزیکی حذف می‌شوند (alias vite — پایین‌تر راستی‌آزمایی می‌شود) */
const ALIASED_OUT_IN_BAZAAR = ['views/PaywallView.tsx', 'modals/PaymentMethodSheet.tsx'];

/** خزانه‌های متن — هر دو شاخه؛ جداگانه و در سطح export سنجیده می‌شود */
const TEXT_VAULT_LATEST = 'lib/bazaarTexts.ts';
const TEXT_VAULT_BAZAAR = 'lib/bazaarTexts.bazaar.ts';
const TEXT_VAULTS = [TEXT_VAULT_LATEST, TEXT_VAULT_BAZAAR];

/** فهرست قراردادی exportهای خزانه — هر دو ماژول باید دقیقاً همین‌ها را داشته باشند */
const TEXT_KEYS = [
  'BAZAAR_BUILD',
  'settingsProCardTitle',
  'settingsProCardAria',
  'unlockCta',
  'templatesSubtitle',
  'proSectionTitle',
  'packTierChip',
  'traderLockedNote',
  'deepAnalyticsLockNote',
  'referralShareLabel',
  'referralShareAria',
  'rulesSubscription',
  'rulesPayment',
  'supportIntro',
] as const;

/** همه‌ی فایل‌های ts/tsx سورس به‌صورت بازگشتی */
function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(p));
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** حذف کامنت‌ها (خطی و بلوکی) — کامنت هرگز وارد باندل نمی‌شود */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const read = (p: string): string => readFileSync(p, 'utf8');
const relOf = (p: string): string => p.slice(SRC_ROOT.length + 1).replaceAll('\\', '/');

/* ================= ۱) خزانه‌ی متن‌ها — دو شاخه‌ی فیزیکی، قرارداد هم‌نامی ================= */

describe('خزانه‌ی متن‌های بازار (bazaarTexts — قرارداد صداقت v1.12.1)', () => {
  test('هر دو شاخه دقیقاً هم‌نام export دارند (شکستن این قرارداد = شکستن swap)', () => {
    for (const key of TEXT_KEYS) {
      expect(key in latestTexts).toBe(true);
      expect(key in bazaarTexts).toBe(true);
    }
    expect(latestTexts.BAZAAR_BUILD).toBe(false);
    expect(bazaarTexts.BAZAAR_BUILD).toBe(true);
  });

  test('هیچ متن شاخه‌ی بازار واژه‌ی ممنوع ندارد', () => {
    for (const key of TEXT_KEYS) {
      if (key === 'BAZAAR_BUILD') continue;
      const t = (bazaarTexts as unknown as Record<string, string>)[key];
      expect(t.length).toBeGreaterThan(0);
      for (const bad of FORBIDDEN) {
        expect(t.includes(bad)).toBe(false);
      }
    }
  });

  test('هیچ متن شاخه‌ی بازار وعده‌ی خرید نمی‌دهد («خرید» فقط در جمله‌ی نفی)', () => {
    for (const key of TEXT_KEYS) {
      if (key === 'BAZAAR_BUILD') continue;
      const t = (bazaarTexts as unknown as Record<string, string>)[key];
      if (t.includes('خرید')) {
        // تنها شکل مجاز: نفی خرید («خریدی انجام نمی‌شود»)
        expect(t.includes('خریدی انجام نمی‌شود')).toBe(true);
      }
    }
  });

  test('شاخه‌ی latest بدون تغییر رفتار پین شده است (بیلد latest عیناً متن‌های قبلی)', () => {
    // اگر لازم شد latest واقعاً متنش عوض شود، همین‌جا آگاهانه تغییرش بده — پین تست را به‌روز کن
    const L = latestTexts as unknown as Record<string, string>;
    expect(L.settingsProCardTitle).toBe('ارتقا به کارام پرو');
    expect(L.settingsProCardAria).toBe('ارتقا به کارام پرو');
    expect(L.unlockCta).toBe('بازکردن با کارام پرو');
    expect(L.templatesSubtitle).toBe(
      'چک‌لیست‌های آماده برای شروع سریع — رایگان‌ها برای همه؛ فعال‌سازی بسته‌های پرو مخصوص کارام پرو',
    );
    expect(L.proSectionTitle).toBe('مخصوص کارام پرو');
    expect(L.packTierChip).toBe('پرو');
    expect(L.traderLockedNote).toBe(
      'محتوای هر ۵ لیست بالا را کامل می‌بینید — فعال‌سازی چک‌لیست تریدر (با یادآور سشن) مخصوص کارام پرو است.',
    );
    expect(L.deepAnalyticsLockNote).toBe('مخصوص کاربران نسخه پرو کارام');
    expect(L.referralShareLabel).toBe('اشتراک');
    expect(L.referralShareAria).toBe('اشتراک کد دعوت در تلگرام');
    expect(L.rulesSubscription).toBe(
      'اشتراک پرو دوره‌ای است؛ در پایان دوره اگر تمدید نکنید، اپ به نسخه‌ی رایگان برمی‌گردد ولی هیچ داده‌ای حذف نمی‌شود.',
    );
    expect(L.rulesPayment).toBe(
      'پرداخت از درگاه بانکی یا کارت‌به‌کارت (با تأیید ادمین) است؛ وضعیت هر پرداخت در صفحه‌ی پرو قابل پیگیری است.',
    );
    expect(L.supportIntro).toBe(
      'مشکل در پرداخت، حذف حساب یا هر سؤال دیگر؟ از همین راه‌ها پیام بدهید؛ سریع جواب می‌گیرید.',
    );
  });

  test('متن‌های شاخه‌ی بازار صادقانه به کد هدیه اشاره می‌کنند', () => {
    const B = bazaarTexts as unknown as Record<string, string>;
    expect(B.unlockCta).toBe('بازکردن با کد هدیه');
    expect(B.rulesPayment).toBe('در این نسخه خریدی انجام نمی‌شود؛ پرو فقط با کد هدیه.');
    expect(B.deepAnalyticsLockNote).toContain('کد هدیه');
    // کارت غیرپرو تنظیمات در بازار هرگز «ارتقا» نمی‌گوید
    expect(B.settingsProCardTitle).toBe('امکانات ویژه کارام');
  });
});

/* ================= ۲) معماری گارد بیلد — aliasهای حذف فیزیکی ================= */

describe('معماری گارد زمان بیلد (alias حذف فیزیکی — الگوی PaywallView)', () => {
  const viteCfg = read(join(import.meta.dir, '..', 'vite.config.ts'));

  test('aliasهای حذف فیزیکی در VITE_PAYMENTS_BUILD=off برقرارند (پی‌وال + خزانه‌ی متن‌ها)', () => {
    expect(viteCfg.includes("VITE_PAYMENTS_BUILD === 'off'")).toBe(true);
    expect(viteCfg.includes("'@/views/PaywallView'")).toBe(true);
    expect(viteCfg.includes('PaywallView.bazaar.tsx')).toBe(true);
    expect(viteCfg.includes("'@/lib/bazaarTexts'")).toBe(true);
    expect(viteCfg.includes('bazaarTexts.bazaar.ts')).toBe(true);
    // فایل استاب خودش هم پاک است (کامنت‌ها وارد باندل نمی‌شوند — همان پاک‌سازی اسکن سورس)
    const stub = stripComments(read(join(import.meta.dir, '..', 'src', 'views', 'PaywallView.bazaar.tsx')));
    for (const bad of FORBIDDEN) {
      expect(stub.includes(bad)).toBe(false);
    }
  });
});

/* ================= ۳) اسکن سورس سطح باندل بازار ================= */

describe('اسکن سورس باندل بازار — بدون واژه‌ی ممنوع خارج از خزانه‌ها (v1.12.1)', () => {
  const files = walkTsFiles(SRC_ROOT)
    .map(relOf)
    .filter((rel) => !TEXT_VAULTS.includes(rel) && !ALIASED_OUT_IN_BAZAAR.includes(rel));

  test('فایل‌های مستثنا فقط دو حذف‌شده‌ی alias + دو شاخه‌ی خزانه هستند (پوشش کامل)', () => {
    const all = walkTsFiles(SRC_ROOT).map(relOf);
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain(TEXT_VAULT_LATEST);
    expect(all).toContain(TEXT_VAULT_BAZAAR);
    expect(all).toContain('views/PaywallView.tsx');
    expect(all).toContain('modals/PaymentMethodSheet.tsx');
    expect(files.length).toBe(all.length - 4);
  });

  test('هیچ فایل باندل‌شونده‌ی بازار (بدون کامنت) واژه‌ی ممنوع ندارد', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const code = stripComments(read(join(SRC_ROOT, rel)));
      for (const bad of FORBIDDEN) {
        if (code.includes(bad)) {
          offenders.push(`${rel} → ${bad}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('شاخه‌ی bazaar خزانه (کد بدون کامنت) واژه‌ی ممنوع ندارد و شاخه‌ی latest شاخه‌ی پرداخت است', () => {
    const bazaarCode = stripComments(read(join(SRC_ROOT, TEXT_VAULT_BAZAAR)));
    for (const bad of FORBIDDEN) {
      expect(bazaarCode.includes(bad)).toBe(false);
    }
    const latestCode = stripComments(read(join(SRC_ROOT, TEXT_VAULT_LATEST)));
    expect(latestCode).toContain('ارتقا به کارام پرو');
  });

  test('صفحات ایستای public/terms و public/privacy پس از تبدیل بازار پاک‌اند', async () => {
    // همان تابعی که بیلد موبایل واقعاً اجرا می‌کند (fail-loud) — اینجا شبیه‌سازی + راستی‌آزمایی
    const mod = (await import('../../mobile/scripts/bazaar-static-pages.mjs')) as {
      applyBazaarStaticTransform: (html: string, page: 'terms' | 'privacy') => string;
      assertNoBazaarForbiddenWords: (html: string, page: 'terms' | 'privacy') => boolean;
    };
    for (const page of ['terms', 'privacy'] as const) {
      const html = read(join(import.meta.dir, '..', 'public', page, 'index.html'));
      const out = mod.applyBazaarStaticTransform(html, page);
      expect(mod.assertNoBazaarForbiddenWords(out, page)).toBe(true);
      // جمله‌ی صادقانه‌ی الزامی در نسخه‌ی بازار
      expect(out).toContain('در این نسخه خریدی انجام نمی‌شود');
    }
    // سورس فعلی (بیلد latest) هنوز بند پرداخت را دارد — تغییر نکرده باشد
    const termsLatest = read(join(import.meta.dir, '..', 'public', 'terms', 'index.html'));
    expect(termsLatest).toContain('پرداخت از درگاه بانکی (زیبال) یا کارت‌به‌کارت');
  });
});

/* ================= ۴) اسکریپت بیلد موبایل — تبدیل فقط در حالت بازار ================= */

describe('بیلد موبایل — گارد صفحات ایستا فقط در bazaar', () => {
  const buildWww = readFileSync(
    join(import.meta.dir, '..', '..', 'mobile', 'scripts', 'build-www.mjs'),
    'utf8',
  );

  test('build-www.mjs تبدیل را فقط وقتی PAYMENTS_BUILD=off اجرا می‌کند و fail-loud است', () => {
    expect(buildWww.includes("if (PAYMENTS_BUILD === 'off')")).toBe(true);
    expect(buildWww.includes('applyBazaarStaticTransform')).toBe(true);
    expect(buildWww.includes('assertNoBazaarForbiddenWords')).toBe(true);
  });

  test('نگاشت صفحات ایستا شامل جمله‌ی الزامی صادقانه است', () => {
    const helper = readFileSync(
      join(import.meta.dir, '..', '..', 'mobile', 'scripts', 'bazaar-static-pages.mjs'),
      'utf8',
    );
    expect(helper).toContain('در این نسخه خریدی انجام نمی‌شود؛ پرو فقط با کد هدیه');
  });
});

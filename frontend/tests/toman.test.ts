/**
 * کارام — تست فاز تومان: قرارداد واحد formatToman (سه‌سمته: اپ/پنل/سرور)
 * + جست‌وجوی خودکار «ریال» در سورس UI (باید صفر باشد — فقط درایور درگاه مجاز است)
 *
 * اجرا:  cd frontend && bun test tests/toman.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { formatToman } from '../src/lib/format';

/* ---------- قرارداد مشترک با Format::toman (PHP) و پنل (TS) ---------- */

const SAMPLES: [number, string][] = [
  [990, '۹۹۰ تومان'],
  [1000, '۱ هزار تومان'],
  [49_000, '۴۹ هزار تومان'],
  [490_000, '۴۹۰ هزار تومان'],
  [49_500, '۴۹٬۵۰۰ تومان'],
  [1_000_000, '۱ میلیون تومان'],
  [1_200_000, '۱٫۲ میلیون تومان'],
  [1_500_000, '۱٫۵ میلیون تومان'],
  [1_234_567, '۱٬۲۳۴٬۵۶۷ تومان'],
  [0, '۰ تومان'],
  [-5, '۰ تومان'],
];

describe('فاز تومان — formatToman (قرارداد اپ/پنل/PHP)', () => {
  for (const [input, want] of SAMPLES) {
    test(`formatToman(${input}) → «${want}»`, () => {
      expect(formatToman(input)).toBe(want);
    });
  }

  test('خروجی همیشه با واحد «تومان» تمام می‌شود', () => {
    for (const t of [0, 1, 999, 1000, 49_500, 490_000, 1_200_000, 99_999_999]) {
      expect(formatToman(t).endsWith('تومان')).toBe(true);
    }
  });

  test('خروجی فقط ارقام فارسی دارد (بدون رقم لاتین)', () => {
    for (const t of [990, 49_500, 490_000, 1_234_567]) {
      expect(/[0-9]/.test(formatToman(t))).toBe(false);
    }
  });
});

/* ---------- جست‌وجوی خودکار: هیچ «ریال»ی در سورس UI اپ و پنل ---------- */

function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

describe('فاز تومان — سورس UI اپ و پنل بدون «ریال»', () => {
  const appRoot = join(import.meta.dir, '..');
  const appFiles = walkFiles(join(appRoot, 'src'), ['.ts', '.tsx']);
  const panelFiles = walkFiles(join(appRoot, 'admin', 'src'), ['.ts', '.tsx']);

  test('اپ: هیچ فایلی «ریال» ندارد', () => {
    const bad = appFiles.filter((f) => readFileSync(f, 'utf8').includes('ریال'));
    expect(bad).toEqual([]);
  });

  test('پنل: هیچ فایلی «ریال» ندارد', () => {
    const bad = panelFiles.filter((f) => readFileSync(f, 'utf8').includes('ریال'));
    expect(bad).toEqual([]);
  });

  test('اپ و پنل: هیچ کلید JSON قدیمی *Rials در سورس نیست', () => {
    const bad = [...appFiles, ...panelFiles].filter((f) => /priceRials|amountRials|discountRials|payableRials/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

/**
 * کارام — تست منطق نصب وب‌اپ (v1.11.3)
 * installVariant باید پنج حالت را درست تفکیک کند:
 *   native (اپ اندروید) / installed (standalone) / button (beforeinstallprompt) /
 *   ios-hint (سافاری) / none (هیچ‌کدام)
 * اجرا:  cd frontend && bun test tests/pwa.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { installVariant, isIosDevice, type PwaEnv } from '../src/lib/pwa';

const env = (over: Partial<PwaEnv>): PwaEnv => ({
  native: false,
  standalone: false,
  bip: false,
  ios: false,
  ...over,
});

describe('installVariant — جدول تصمیم ردیف «نصب سریع کارام»', () => {
  test('اپ اندروید (native) همیشه بر همه‌ی شرایط مقدم است', () => {
    expect(installVariant(env({ native: true }))).toBe('native');
    expect(installVariant(env({ native: true, bip: true }))).toBe('native');
    expect(installVariant(env({ native: true, standalone: true }))).toBe('native');
  });

  test('standalone یعنی همین حالا به‌صورت اپ اجرا می‌شود — ردیف «نصب‌شده»', () => {
    expect(installVariant(env({ standalone: true }))).toBe('installed');
    // بعد از نصب، bip هم گرفته نمی‌شود ولی حتی اگر بگیرد اولویت با installed است
    expect(installVariant(env({ standalone: true, bip: true }))).toBe('installed');
  });

  test('رویداد نصب گرفته شده → دکمه‌ی «نصب»', () => {
    expect(installVariant(env({ bip: true }))).toBe('button');
  });

  test('iOS بدون bip → راهنمای هم‌رسانی سافاری', () => {
    expect(installVariant(env({ ios: true }))).toBe('ios-hint');
    expect(installVariant(env({ ios: true, standalone: false, bip: false }))).toBe('ios-hint');
  });

  test('هیچ مسیری نبود → ردیف نمایش داده نمی‌شود (none)', () => {
    expect(installVariant(env({}))).toBe('none');
    expect(installVariant(env({ native: false }))).toBe('none');
  });
});

describe('isIosDevice — تشخیص iOS شامل iPadOS نقش‌آفرینِ Mac', () => {
  const fakeNav = (ua: string, platform: string, maxTouchPoints = 0): Navigator =>
    ({
      userAgent: ua,
      platform,
      maxTouchPoints,
    }) as unknown as Navigator;

  test('آیفون و آیپد با UA کلاسیک', () => {
    expect(isIosDevice(fakeNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'iPhone'))).toBe(true);
    expect(isIosDevice(fakeNav('Mozilla/5.0 (iPad; CPU OS 16_0)', 'iPad'))).toBe(true);
  });

  test('iPadOS 13+ خودش را Mac معرفی می‌کند — با maxTouchPoints>1 شناسایی می‌شود', () => {
    expect(isIosDevice(fakeNav('Mozilla/5.0 (Macintosh)', 'MacIntel', 5))).toBe(true);
  });

  test('مک واقعی (بدون لمس) و اندروید/ویندوز iOS حساب نمی‌شوند', () => {
    expect(isIosDevice(fakeNav('Mozilla/5.0 (Macintosh)', 'MacIntel', 0))).toBe(false);
    expect(isIosDevice(fakeNav('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5))).toBe(false);
    expect(isIosDevice(fakeNav('Mozilla/5.0 (Windows NT 10.0)', 'Win32', 0))).toBe(false);
  });
});

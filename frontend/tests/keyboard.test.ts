/**
 * کارام — تست واحد «رفتار کیبورد» (بسته A — تک‌نوارشدن QuickBar)
 *
 * اجرا:  cd frontend && bun test tests/keyboard.test.ts
 *
 * چرا: پس از بسته A نوار پایین‌ثابت (QuickBar) تنها راه افزودن سریع است و در خانه/لیست/امروز
 * نمایش داده می‌شود. مکانیزمِ lib/keyboard.ts تضمین می‌کند پنجره‌ها و نوار پایین‌چسب زیر
 * کیبورد نروند: محاسبه‌ی ارتفاع کیبورد از visualViewport → متغیر CSS سراسری --kb-height
 * و کلاس kb-open روی body (Sheet.tsx و پنجره‌های پایین‌چسب از همین متغیر بالا کشیده می‌شوند؛
 * در اندروید کروم متای interactive-widget=resizes-content خود چیدمان را کوچک می‌کند و
 * QuickBar هم‌راه قاب بالا می‌ماند).
 *
 * پوشش (یک سناریوی پیوسته — متغیر started در ماژول بین تست‌های همین فایل مشترک است):
 *   ۱) وضعیت اولیه (کیبورد بسته) → --kb-height صفر، بدون کلاس kb-open
 *   ۲) کیبورد باز → --kb-height درست + کلاس kb-open
 *   ۳) حالت iOS (offsetTop > 0) — ارتفاع = innerHeight − (height + offsetTop)
 *   ۴) کیبورد بسته → صفر و حذف کلاس
 *   ۵) init تکراری → شنونده‌ها دوبرابر نمی‌شوند (گارد started)
 *   ۶) مرورگر بی‌visualViewport → بدون خطا (نمونه‌ی تازه‌ی ماژول با query)
 */

import { describe, test, expect } from 'bun:test';

type Listener = () => void;

interface Env {
  fire(type: 'resize' | 'scroll' | 'orientationchange'): void;
  kbHeight(): string | undefined;
  kbOpen(): boolean;
  setViewport(height: number, offsetTop?: number): void;
  listenerCount(type: string): number;
}

/** ساخت محیط DOM ساختگی (بدون jsdom — هم‌سبک تست‌های دیگر کارام) */
function makeEnv({ innerHeight = 800, vvHeight = innerHeight }: { innerHeight?: number; vvHeight?: number } = {}): Env {
  const cssVars: Record<string, string> = {};
  const bodyClasses = new Set<string>();
  const vvListeners: Record<string, Listener[]> = {};
  const winListeners: Record<string, Listener[]> = {};
  const vvState = { height: vvHeight, offsetTop: 0 };

  const vv = {
    get height() {
      return vvState.height;
    },
    get offsetTop() {
      return vvState.offsetTop;
    },
    addEventListener(type: string, fn: Listener) {
      (vvListeners[type] ??= []).push(fn);
    },
  };

  (globalThis as Record<string, unknown>).window = {
    visualViewport: vv,
    innerHeight,
    addEventListener(type: string, fn: Listener) {
      (winListeners[type] ??= []).push(fn);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      style: { setProperty: (k: string, v: string) => { cssVars[k] = v; } },
    },
    body: {
      classList: {
        add: (c: string) => bodyClasses.add(c),
        remove: (c: string) => bodyClasses.delete(c),
      },
    },
  };

  return {
    fire(type) {
      for (const fn of vvListeners[type] ?? []) fn();
      for (const fn of winListeners[type] ?? []) fn();
    },
    kbHeight: () => cssVars['--kb-height'],
    kbOpen: () => bodyClasses.has('kb-open'),
    setViewport(height, offsetTop = 0) {
      vvState.height = height;
      vvState.offsetTop = offsetTop;
    },
    listenerCount(type) {
      return (vvListeners[type]?.length ?? 0) + (winListeners[type]?.length ?? 0);
    },
  };
}

/* ---- سناریوی پیوسته: یک محیط، یک init ---- */
const env = makeEnv({ innerHeight: 800, vvHeight: 800 });
const keyboard = await import('../src/lib/keyboard');

describe('بسته A — رفتار کیبورد (مکانیزم --kb-height پشت QuickBar تک‌نواره)', () => {
  test('۱) init و وضعیت اولیه (کیبورد بسته) → ۰px و بدون کلاس', () => {
    keyboard.initKeyboardAwareness();
    expect(env.kbHeight()).toBe('0px');
    expect(env.kbOpen()).toBe(false);
    expect(env.listenerCount('resize')).toBe(1); // یک شنونده روی visualViewport
    expect(env.listenerCount('scroll')).toBe(1);
    expect(env.listenerCount('orientationchange')).toBe(1);
  });

  test('۲) کیبورد باز (۵۰۰ از ۸۰۰) → ۳۰۰px + کلاس kb-open', () => {
    env.setViewport(500);
    env.fire('resize');
    expect(env.kbHeight()).toBe('300px');
    expect(env.kbOpen()).toBe(true);
  });

  test('۳) حالت iOS (offsetTop=۵۰) → ارتفاع واقعی کیبورد = ۵۰px', () => {
    env.setViewport(700, 50);
    env.fire('scroll');
    expect(env.kbHeight()).toBe('50px');
    expect(env.kbOpen()).toBe(true);
  });

  test('۴) کیبورد بسته دوباره → ۰px و حذف کلاس kb-open', () => {
    env.setViewport(800, 0);
    env.fire('resize');
    expect(env.kbHeight()).toBe('0px');
    expect(env.kbOpen()).toBe(false);
  });

  test('۵) init تکراری → شنونده‌ها دوبرابر نمی‌شوند (گارد started)', () => {
    keyboard.initKeyboardAwareness();
    keyboard.initKeyboardAwareness();
    expect(env.listenerCount('resize')).toBe(1);
    expect(env.listenerCount('orientationchange')).toBe(1);
  });

  test('۶) مرورگر بی‌visualViewport → بدون خطا و بدون متغیر (نمونه تازه‌ی ماژول)', async () => {
    const env2 = makeEnv();
    (globalThis as Record<string, unknown>).window = {
      visualViewport: undefined,
      innerHeight: 800,
      addEventListener: () => undefined,
    };
    const fresh = await import('../src/lib/keyboard?case=novv');
    expect(() => fresh.initKeyboardAwareness()).not.toThrow();
    expect(env2.kbHeight()).toBeUndefined();
    expect(env2.kbOpen()).toBe(false);
  });
});

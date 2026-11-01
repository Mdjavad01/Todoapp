/**
 * کارام — تست helper ذخیره‌ی فایل (P1.3 — lib/saveFile.ts)
 *
 * اجرا:  cd frontend && bun test tests/savefile.test.ts
 *
 * پوشش:
 *   ۱) شاخه‌ی وب (isNativeApp=false): <a download> با نام درست — و ok=true
 *   ۲) شاخه‌ی بومی (isNativeApp=true): writeFile در Cache با UTF8 + Share با file://
 *   ۳) انصراف کاربر در منوی اشتراک («Share canceled») → ok=false و canceled=true
 *   ۴) خطای عمومی بومی → ok=false و canceled=false (هرگز «ذخیره شد» جعل نمی‌شود)
 *   ۵) uri بدون file:// → شکست صادقانه (پلاگین Share فقط file:// می‌پذیرد)
 *   ۶) shareSuccessText (P1.4) — متن صداقت‌محور توست بومی: «آماده شد و سپرده شد»، هرگز «ذخیره شد»
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

/* ---------- وضعیت مشترک mock ---------- */

const nativeState = { native: false };

/** ثبت فراخوانی‌های پلاگین‌های بومی */
const calls = {
  writeFile: [] as Array<{ path: string; data: string; directory: unknown; encoding: unknown }>,
  share: [] as Array<{ title?: string; url?: string; dialogTitle?: string }>,
};

/** رفتار Share — هر تست عوضش می‌کند */
let shareImpl: (opts: { title?: string; url?: string }) => Promise<{ activityType?: string }> = async () => ({
  activityType: 'org.telegram.messenger',
});

/** uri که writeFile برمی‌گرداند */
let writeUriImpl: (path: string) => string = (path) => `file:///data/user/0/ir.hojre24shop.app/cache/${path}`;

mock.module('@/lib/native', () => ({
  // سطح کامل native.ts — چون mock.module بین فایل‌های تست در یک فرایند نشت می‌کند
  isNativeApp: () => nativeState.native,
  appPlatform: () => (nativeState.native ? 'android' : 'web'),
  openExternal: async () => undefined,
  onBrowserFinished: () => () => undefined,
  onAppResume: () => () => undefined,
  onAppPause: () => () => undefined,
}));

mock.module('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: async (opts: { path: string; data: string; directory: unknown; encoding: unknown }) => {
      calls.writeFile.push(opts);
      return { uri: writeUriImpl(opts.path) };
    },
  },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));

mock.module('@capacitor/share', () => ({
  Share: {
    share: async (opts: { title?: string; url?: string; dialogTitle?: string }) => {
      calls.share.push(opts);
      return shareImpl(opts);
    },
  },
}));

/* ---------- شاخه‌ی وب: stub حداقلی DOM (bun بدون مرورگر است) ---------- */

const anchorStubs: Array<{ href: string; download: string; clicks: number }> = [];
// @ts-expect-error — محیط تست بدون DOM
globalThis.document = {
  createElement: () => {
    const a = { href: '', download: '', clicks: 0, click() { a.clicks++; }, remove() {} };
    anchorStubs.push(a);
    return a;
  },
  body: { appendChild: () => undefined },
};

/* بعد از mock، ماژول تحت تست بارگذاری می‌شود */
const { saveFileForUser, shareSuccessText } = await import('@/lib/saveFile');

beforeEach(() => {
  nativeState.native = false;
  calls.writeFile.length = 0;
  calls.share.length = 0;
  anchorStubs.length = 0;
  shareImpl = async () => ({ activityType: 'org.telegram.messenger' });
  writeUriImpl = (path) => `file:///data/user/0/ir.hojre24shop.app/cache/${path}`;
});

describe('saveFileForUser — شاخه‌ی وب', () => {
  test('وب: <a download> با نام و محتوا — ok=true و method=download', async () => {
    const out = await saveFileForUser('karam-backup-2026-01-05-1130.json', '{"app":"karam"}');
    expect(out).toEqual({ ok: true, canceled: false, method: 'download' });
    expect(anchorStubs.length).toBe(1);
    expect(anchorStubs[0].download).toBe('karam-backup-2026-01-05-1130.json');
    expect(anchorStubs[0].clicks).toBe(1);
    expect(calls.writeFile.length).toBe(0); // هیچ پلاگین بومی صدا نشده
    expect(calls.share.length).toBe(0);
  });
});

describe('saveFileForUser — شاخه‌ی بومی (اپ اندروید)', () => {
  test('بومی: فایل در Cache با UTF8 نوشته و Share با file:// باز می‌شود', async () => {
    nativeState.native = true;
    const content = JSON.stringify({ app: 'karam', kind: 'backup' });
    const out = await saveFileForUser('karam-backup-2026-01-05-1130.json', content);
    expect(out).toEqual({ ok: true, canceled: false, method: 'share' });
    expect(calls.writeFile.length).toBe(1);
    expect(calls.writeFile[0].path).toBe('karam-backup-2026-01-05-1130.json');
    expect(calls.writeFile[0].data).toBe(content);
    expect(calls.writeFile[0].directory).toBe('CACHE');
    expect(calls.writeFile[0].encoding).toBe('utf8');
    expect(calls.share.length).toBe(1);
    expect(calls.share[0].url?.startsWith('file:')).toBe(true);
    expect(calls.share[0].title).toBe('karam-backup-2026-01-05-1130.json');
  });

  test('انصراف کاربر در شیت اشتراک → ok=false و canceled=true (پیام «ذخیره نشد»، نه «ذخیره شد»)', async () => {
    nativeState.native = true;
    shareImpl = async () => {
      throw new Error('Share canceled');
    };
    const out = await saveFileForUser('x.json', '{}');
    expect(out.ok).toBe(false);
    expect(out.canceled).toBe(true);
    expect(out.method).toBe('share');
  });

  test('خطای عمومی بومی (نه انصراف) → ok=false و canceled=false', async () => {
    nativeState.native = true;
    shareImpl = async () => {
      throw new Error('only file urls are supported');
    };
    const out = await saveFileForUser('x.json', '{}');
    expect(out.ok).toBe(false);
    expect(out.canceled).toBe(false);
  });

  test('uri بدون file:// (رفتار غیرمنتظره‌ی پلاگین) → شکست صادقانه قبل از Share', async () => {
    nativeState.native = true;
    writeUriImpl = () => 'content://ir.hojre24shop.app.fileprovider/cache/x.json';
    await expect(saveFileForUser('x.json', '{}')).rejects.toThrow('fs-uri-missing');
    expect(calls.share.length).toBe(0);
  });
});

describe('shareSuccessText — صداقت توست مسیر بومی (P1.4)', () => {
  test('متن دقیق share: «آماده شد و … سپرده شد» — هرگز «ذخیره شد»', () => {
    const t = shareSuccessText('karam-backup-2026-01-05-1130.json', '۱۲ رکورد');
    expect(t).toBe('فایل karam-backup-2026-01-05-1130.json (۱۲ رکورد) آماده شد و به مقصدی که انتخاب کردی سپرده شد');
    expect(t).not.toContain('ذخیره شد');
    expect(t).not.toContain('دانلود شد');
  });

  test('همین الگو برای «دریافت داده‌های من» (doServerExport)', () => {
    const t = shareSuccessText('karam-data-2026-01-05.json', 'داده‌های حساب شما');
    expect(t).toBe('فایل karam-data-2026-01-05.json (داده‌های حساب شما) آماده شد و به مقصدی که انتخاب کردی سپرده شد');
    expect(t).not.toContain('ذخیره شد');
  });
});

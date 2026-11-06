/**
 * کارام — ذخیره‌ی مطمئن فایل برای کاربر (P1.3 — helper واحد)
 *
 * مشکل قبلی (ممیزی P1.3): «دریافت فایل پشتیبان» و «دریافت داده‌های من» با
 * blob + <a download> بودند. WebView کاپاسیتور (کور @capacitor/android ۷.۶.۹)
 * هیچ DownloadListener ای ثبت نمی‌کند ⇒ روی APK کلیک عملاً هیچ کاری نمی‌کرد،
 * ولی توست «دانلود شد» نمایش داده می‌شد.
 *
 * راه‌حل واحد برای هر دو مسیر (بکاپ محلی و دریافت داده از سرور):
 *  - وب: همان <a download> استاندارد مرورگر.
 *  - اپ اندروید (Capacitor.isNativePlatform): فایل با @capacitor/filesystem در
 *    Cache نوشته می‌شود و @capacitor/share منوی اشتراک سیستم را باز می‌کند —
 *    مقصد را خود کاربر انتخاب می‌کند (ذخیره در فایل‌ها، تلگرام، بله، ایمیل، درایو).
 *    انصراف کاربر = «ذخیره نشد»، هرگز «ذخیره شد».
 *
 * ایمنی‌ها:
 *  - پلاگین‌های بومی فقط با import پویا داخل شاخه‌ی بومی بارگذاری می‌شوند
 *    (باندل وب کد بومی را نمی‌گیرد — همان الگوی biometricBridge).
 *  - پلاگین Share فقط file:// می‌پذیرد (isFileUrl در SharePlugin.java) و با
 *    FileProvider با authority «<package>.fileprovider» کار می‌کند — همان
 *    provider که از قبل در AndroidManifest.xml هست (file_paths.xml کل cache را
 *    می‌پوشاند). مانیفست پلاگین Share خالی است ⇒ هیچ تعریف تکراری‌ای ساخته نمی‌شود.
 */

import { isNativeApp } from '@/lib/native';

/** نتیجه‌ی ذخیره — برای پیام‌های درست (موفق/انصراف/شکست) */
export interface SaveFileOutcome {
  /** فایل به دست کاربر رسید (وب: دانلود آغاز شد؛ بومی: مقصدی انتخاب شد) */
  ok: boolean;
  /** فقط بومی: منوی اشتراک بدون انتخاب مقصد بسته شد */
  canceled: boolean;
  /** مسیر اجرا — برای پیام و تست */
  method: 'download' | 'share';
}

/**
 * ذخیره‌ی یک فایل متنی به انتخاب کاربر.
 * @param name    نام کامل فایل (مثل karam-backup-2026-01-05-1130.json)
 * @param content محتوای متنی (JSON)
 * @param mime    نوع MIME برای مسیر وب
 */
export async function saveFileForUser(name: string, content: string, mime = 'application/json'): Promise<SaveFileOutcome> {
  if (isNativeApp()) return saveNative(name, content);
  return saveWeb(name, content, mime);
}

/** وب — همان رفتار استاندارد <a download> */
async function saveWeb(name: string, content: string, mime: string): Promise<SaveFileOutcome> {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true, canceled: false, method: 'download' };
}

/**
 * P1.4 — متن توست موفقیتِ مسیر بومی (share) — صادقانه:
 * resolve شدن Share فقط یعنی «منوی اشتراک با انتخاب مقصد بسته شد» — نه اینکه فایل
 * واقعاً به مقصد رسیده باشد (لغو ارسال «درون» اپ مقصد مثل تلگرام از سمت اپ قابل
 * تشخیص نیست). پس «آماده شد و سپرده شد» می‌گوییم، هرگز «ذخیره شد».
 * @param name   نام کامل فایل
 * @param detail توضیح داخل پرانتز — مثل «۱۲ رکورد» یا «داده‌های حساب شما»
 */
export function shareSuccessText(name: string, detail: string): string {
  return `فایل ${name} (${detail}) آماده شد و به مقصدی که انتخاب کردی سپرده شد`;
}

/** اپ اندروید — نوشتن در cache/karam-share/ + منوی اشتراک سیستم (مقصد را کاربر انتخاب می‌کند)
 *  v1.12.0 (ممیزی M-01): مقصد فقط زیرمسیر اختصاصی karam-share/ است — file_paths.xml
 *  همین زیرمسیر را به FileProvider می‌دهد (کل cache و external storage دیگر در معرض نیستند) */
async function saveNative(name: string, content: string): Promise<SaveFileOutcome> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  // FileOutputStream پلاگین پوشه‌ی والد را نمی‌سازد — خودمان یک‌بار recursive می‌سازیم
  // (خطای «از قبل هست» بی‌اهمیت است و نادیده گرفته می‌شود)
  try {
    await Filesystem.mkdir({
      path: 'karam-share',
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    /* از قبل وجود دارد */
  }

  const written = await Filesystem.writeFile({
    path: `karam-share/${name}`,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  // Share فقط file:// می‌پذیرد — اگر پلاگین فایل چیز دیگری داد، صادقانه شکست می‌خوریم
  // (توست «ذخیره نشد»)، نه ادعای موفقیت بی‌مدرک.
  const uri = written.uri;
  if (!uri || !uri.startsWith('file:')) throw new Error('fs-uri-missing');

  try {
    await Share.share({
      title: name,
      url: uri,
      dialogTitle: 'ذخیره یا ارسال فایل پشتیبان',
    });
    // resolve = منوی اشتراک با انتخاب مقصد بسته شد
    return { ok: true, canceled: false, method: 'share' };
  } catch (e) {
    // SharePlugin.java: RESULT_CANCELED → call.reject('Share canceled')
    const msg = e instanceof Error ? e.message : String(e ?? '');
    return { ok: false, canceled: msg.includes('Share canceled'), method: 'share' };
  }
}

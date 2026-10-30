<?php

declare(strict_types=1);

/**
 * کارام — ماسک رازهای جدول settings در بکاپ (P1 — پاک‌سازی اعتماد)
 *
 * چرا؟ بکاپ برای «بازیابی کل دیتابیس» است، نه برای حمل راز. اگر فایل بکاپ به هر
 * راهی بیرون برود (تلگرام، دانلود اشتباه، هاست پشتیبان)، نباید رمز SMTP، توکن
 * ربات، مرچنت درگاه و هدرهای پیامک داخلش باشد.
 *
 * فهرست ۵ کلید = همان فهرست رسمی ماسک پنل:
 *   AdminController::SECRET_SETTING_KEYS و docs/INSTALL.md بخش ۱۹-۲
 * (smtp_pass، telegram_bot_token، zibal_merchant، provider_sms_url، provider_sms_headers)
 *
 * قاعده:
 *  - در هر dump بکاپ (mysqldump / dump خالص PHP / SQLite)، «مقدار» کلیدهای راز
 *    به رشته‌ی خالی '' تبدیل می‌شود (فقط همین ۵ کلید؛ بقیه‌ی تنظیمات کامل برمی‌گردند).
 *  - بازیابی: پس از restore، ادمین این ۵ کلید را یک‌بار در «پنل ← تنظیمات» دوباره
 *    وارد می‌کند (نام کلید در dump باقی می‌ماند تا ادمین بداند چه چیزی را باید وارد کند).
 *  - مقدار واقعی راز هیچ‌جا لاگ/ثبت نمی‌شود؛ این کلاس فقط تصمیم ماسک/نماسک می‌دهد
 *    و هرگز خودِ مقدار را برنمی‌گرداند.
 */

final class BackupMask
{
    /** کلیدهای راز جدول settings که در بکاپ خالی می‌شوند (فهرست قراردادی — INSTALL بخش ۱۹-۲) */
    public const SECRET_KEYS = [
        // رمز SMTP پروایدر ایمیل
        'smtp_pass',
        // توکن ربات تلگرام (کد ورود + یادآور + گزارش بکاپ)
        'telegram_bot_token',
        // مرچنت کد درگاه زیبال
        'zibal_merchant',
        // URL درایور پیامک — معمولاً کلید API داخل URL است
        'provider_sms_url',
        // هدرهای HTTP درایور پیامک — معمولاً Authorization: Bearer … دارد (JSON)
        'provider_sms_headers',
    ];

    /** آیا این کلید راز است؟ */
    public static function isSecret(string $key): bool
    {
        return in_array($key, self::SECRET_KEYS, true);
    }

    /**
     * مقدار قابل‌نوشتن در dump بکاپ — راز = '' (خالی)، بقیه دست‌نخورده.
     * عمداً هیچ حالت «برگرداندن مقدار» ندارد؛ بازیابی فقط با ورود دستی ادمین.
     */
    public static function maskedValue(string $key, string $value): string
    {
        return self::isSecret($key) ? '' : $value;
    }
}

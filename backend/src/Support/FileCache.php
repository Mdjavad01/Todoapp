<?php

declare(strict_types=1);

/**
 * کارام — فایل‌کش سبک برای نقاط داغ (v17 — مقیاس‌پذیری)
 *
 * چرا؟ با هزاران کاربر همزمان، کوئری‌های تکراریِ «تنظیمات» و «اطلاعیه‌های فعال»
 * بار اصلی دیتابیس می‌شوند. این کش روی فایل است (هاست اشتراکی Redis ندارد)،
 * اتمیک است (tmpfile + rename) و خواندن با قفل اشتراکی SAFE انجام می‌شود.
 *
 * قواعد ایمنی:
 *  - هیچ‌وقت Exception نمی‌دهد؛ هر خرابی = null (مسیر عادی کوئری دیتابیس می‌رود)
 *  - پوشه‌ی کش بیرون از کشف عمومی نیست ولی .htaccess هم محافظتش می‌کند
 *  - TTL با mtime فایل چک می‌شود؛ فایل منقضی در همان get حذف می‌شود
 */
final class FileCache
{
    /** مسیر پوشه‌ی کش — گام ۱: همیشه داخل storage محافظت‌شده (با .htaccess)، نه داخل پوشه‌ی کد!
     *  قبلاً چیدمان اول «src/storage/cache» بود که در مخزن یعنی backend/src/storage/cache و
     *  روی هاست یعنی api/src/storage/cache — بیرون از .htaccess محافظت‌شده‌ی storage و
     *  عملاً از وب خواندنی (فایل کش شامل همه‌ی تنظیمات از جمله رمزهاست). */
    private static function dir(): ?string
    {
        static $dir = null;
        if ($dir !== null) {
            return $dir === '' ? null : $dir;
        }
        // مخزن: backend/storage/cache — هاست: api/storage/cache (هر دو .htaccess «deny all» دارند)
        foreach ([dirname(__DIR__, 2) . '/storage/cache', __DIR__ . '/../storage/cache'] as $candidate) {
            if (is_dir($candidate) && is_writable($candidate)) {
                $dir = $candidate;
                return $dir;
            }
        }
        // تلاش برای ساخت (بار اول) — اگر نشد، کش غیرفعال ولی سرویس سالم
        foreach ([dirname(__DIR__, 2) . '/storage/cache', __DIR__ . '/../storage/cache'] as $candidate) {
            if (@mkdir($candidate, 0775, true) && is_writable($candidate)) {
                $dir = $candidate;
                return $dir;
            }
        }
        $dir = '';
        return null;
    }

    private static function path(string $key): string
    {
        return self::dir() . '/k_' . hash('sha256', $key) . '.json';
    }

    /** خواندن با قفل اشتراکی؛ null = غایب/منقضی/خراب */
    public static function get(string $key)
    {
        $path = self::path($key);
        if (!is_file($path)) {
            return null;
        }
        $fp = @fopen($path, 'r');
        if ($fp === false) {
            return null;
        }
        @flock($fp, LOCK_SH);
        $raw = stream_get_contents($fp);
        @flock($fp, LOCK_UN);
        fclose($fp);
        if ($raw === false || $raw === '') {
            return null;
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || !array_key_exists('e', $data)) {
            return null;
        }
        if ($data['e'] !== 0 && (int) $data['e'] < time()) {
            @unlink($path); // منقضی — همین‌جا پاک کن تا انبار پر نشود
            return null;
        }
        return $data['p'] ?? null;
    }

    /** نوشتن اتمیک: فایل موقت + rename (rename روی همان پارتیشن اتمیک است) */
    public static function set(string $key, $payload, int $ttlSeconds): bool
    {
        $dir = self::dir();
        if ($dir === null) {
            return false;
        }
        $path = self::path($key);
        $tmp = $dir . '/tmp_' . bin2hex(random_bytes(6));
        $json = json_encode(
            ['e' => $ttlSeconds > 0 ? time() + $ttlSeconds : 0, 'p' => $payload],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        if ($json === false) {
            return false;
        }
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            @unlink($tmp);
            return false;
        }
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            return false;
        }
        return true;
    }

    /** باطل‌سازی — بعد از تغییر تنظیمات/اطلاعیه‌ها از پنل صدا زده می‌شود */
    public static function delete(string $key): void
    {
        $path = self::path($key);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    /** کلیدهای استاندارد کش کارام (تک منبع حقیقت برای invalidate) */
    public const K_SETTINGS = 'karam_settings';
    public const K_ANN_ACTIVE = 'karam_ann_active';

    /** گام ۱ — آیا کلید در کش موجود (و منقضی‌نشده) است؟
     * برای باطل‌سازی حافظه‌ی static در سرورهای بلندعمر (php-fpm چندورکری):
     * وقتی فایل کش حذف/منقضی شود، ورکرهای دیگر هم در اولین درخواست مقدار تازه می‌خوانند */
    public static function exists(string $key): bool
    {
        $path = self::path($key);
        if (!is_file($path)) {
            return false;
        }
        $raw = @file_get_contents($path);
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($data) || !array_key_exists('e', $data)) {
            return false;
        }
        if ($data['e'] !== 0 && (int) $data['e'] < time()) {
            @unlink($path); // منقضی — همان‌جا پاک کن
            return false;
        }
        return true;
    }
}

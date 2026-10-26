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
    /** مسیر پوشه‌ی کش — دو چیدمان: مخزن (backend/storage) و هاست (api/storage) */
    private static function dir(): ?string
    {
        static $dir = null;
        if ($dir !== null) {
            return $dir === '' ? null : $dir;
        }
        foreach ([dirname(__DIR__) . '/storage/cache', __DIR__ . '/../storage/cache'] as $candidate) {
            if (is_dir($candidate) && is_writable($candidate)) {
                $dir = $candidate;
                return $dir;
            }
        }
        // تلاش برای ساخت (بار اول) — اگر نشد، کش غیرفعال ولی سرویس سالم
        foreach ([dirname(__DIR__) . '/storage/cache', __DIR__ . '/../storage/cache'] as $candidate) {
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
}

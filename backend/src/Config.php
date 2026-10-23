<?php

declare(strict_types=1);

/**
 * کارام — بارگذارنده تنظیمات (.env)
 * فایل .env هرگز نباید در مسیر عمومی باشد؛ این کلاس چند مسیر امن را به‌ترتیب بررسی می‌کند.
 */
final class Config
{
    /** @var array<string,string> */
    private static array $values = [];
    private static bool $loaded = false;

    /** مسیرهای مجاز فایل .env — اولین مسیر موجود برنده است */
    public static function envPaths(): array
    {
        $apiDir = dirname(__DIR__); // backend/
        return [
            // خارج از public_html (دو سطح بالاتر از پوشه‌ی api در هاست اشتراکی)
            dirname($apiDir, 2) . '/private/.env',
            dirname($apiDir, 1) . '/.env', // کنار پوشه‌ی backend
            $apiDir . '/.env',
        ];
    }

    public static function load(): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        foreach (self::envPaths() as $path) {
            if (is_file($path) && is_readable($path)) {
                self::parseFile($path);
                return;
            }
        }
        // اگر فایلی نبود، فقط متغیرهای محیطی سیستم استفاده می‌شوند
    }

    private static function parseFile(string $path): void
    {
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $value = trim(substr($line, $pos + 1));
            // حذف نقل‌قول‌های دوتایی/تکی
            if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
                $value = substr($value, 1, -1);
            }
            self::$values[$key] = $value;
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        self::load();
        if (array_key_exists($key, self::$values)) {
            return self::$values[$key];
        }
        $env = getenv($key);
        return $env === false ? $default : $env;
    }

    public static function isConfigured(): bool
    {
        if (self::get('DB_DRIVER', 'mysql') === 'sqlite') {
            return true; // مسیر پیش‌فرض sqlite همیشه در دسترس است
        }
        return self::get('DB_HOST') !== null && self::get('DB_NAME') !== null;
    }
}

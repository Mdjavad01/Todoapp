<?php

declare(strict_types=1);

/**
 * کارام — خواننده‌ی تنظیمات داینامیک (جدول settings)
 *
 * فاز ۴.۵: بخشی از تنظیمات از پنل مدیریت قابل تغییر است و باید بدون ری‌استارت
 * روی رفتار سرویس اثر بگذارد (پروایدرها، ویس، سقف سینک، حالت تعمیر و …).
 *
 * اولویت:  ۱) مقدار ذخیره‌شده در جدول settings (از پنل)   ۲) مقدار .env   ۳) پیش‌فرض
 *
 * نکته‌ها:
 *  - کش درون‌درخواستی دارد؛ در هر درخواست حداکثر یک کوئری.
 *  - اگر دیتابیس در دسترس نباشد (نصب اولیه/تست)، بی‌صدا null برمی‌گرداند تا
 *    مسیر به .env/predefault برسد — هیچ مسیری به‌خاطر تنظیمات نمی‌شکند.
 */

final class Settings
{
    /** @var array<string,string>|null کش کل جدول (جدول settings کوچک است) */
    private static ?array $cache = null;
    private static bool $loaded = false;

    /** مقدار یک کلید؛ اولویت: settings → env → default */
    public static function get(string $key, ?string $default = null): ?string
    {
        $row = self::all()[$key] ?? null;
        if ($row !== null && $row !== '') {
            return $row;
        }
        // اگر در پنل خالی ذخیره شده («پاک‌شده») اجازه بده .env حرف بزند
        $env = Config::get($key); // بعضی کلیدها هم‌نام env هستند (bale_bot_token و …)
        if ($env !== null && $env !== '') {
            return $env;
        }
        return $default;
    }

    /** مقدار بولی (1/true) با پیش‌فرض */
    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::get($key);
        if ($v === null) {
            return $default;
        }
        return in_array(strtolower(trim($v)), ['1', 'true', 'on', 'yes'], true);
    }

    /** مقدار عددی با محدوده‌ی امن */
    public static function int(string $key, int $default, int $min, int $max): int
    {
        $v = self::get($key);
        if ($v === null || !preg_match('/^\d+$/', trim($v))) {
            return $default;
        }
        return max($min, min($max, (int) trim($v)));
    }

    /** تمام تنظیمات قابل‌انتشار عمومی (بدون راز) — برای GET /api/v1/bootstrap */
    public static function publicBootstrap(): array
    {
        return [
            'appName' => self::get('app_name', (string) (Config::get('APP_NAME', 'کارام') ?? 'کارام')),
            'paywallTitle' => self::get('paywall_title', 'کارام پرو'),
            'minAppVersion' => self::get('min_app_version', '1.0.0'),
            'maintenance' => self::bool('maintenance_mode'),
            'voice' => [
                'enabled' => self::bool('voice_enabled'),
                'provider' => self::get('voice_provider', 'off'),
                'rate' => self::int('voice_rate', 100, 50, 200) / 100,
                'pitch' => self::int('voice_pitch', 100, 50, 150) / 100,
                'lang' => self::get('voice_lang', 'fa-IR'),
            ],
        ];
    }

    /** @return array<string,string> */
    private static function all(): array
    {
        if (self::$loaded) {
            return self::$cache ?? [];
        }
        self::$loaded = true;
        try {
            if (!Config::isConfigured()) {
                return self::$cache = [];
            }
            $rows = Database::pdo()->query('SELECT `key`, `value` FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
            return self::$cache = is_array($rows) ? $rows : [];
        } catch (Throwable) {
            return self::$cache = [];
        }
    }

    /** پاک‌سازی کش (برای تست) */
    public static function flush(): void
    {
        self::$cache = null;
        self::$loaded = false;
    }
}

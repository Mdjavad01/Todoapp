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
 *  - v17 (مقیاس): کش فایلی هم دارد (FileCache، TTL ۶۰۰ ثانیه) — با هزاران کاربر
 *    همزمان، جدول settings دیگر در هر درخواست خوانده نمی‌شود؛ تغییر از پنل ادمین
 *    همان لحظه کش را باطل می‌کند (settingsUpdate) و پس از ۱۰ دقیقه هم خودبه‌خود تازه می‌شود.
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
        $env = Config::get($key); // بعضی کلیدها هم‌نام env هستند (telegram_bot_token و …)
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
            // v17 — چک‌کننده به‌روزرسانی: ادمین از پنل نسخه‌ی آخر را ثبت می‌کند؛
            // اپ در تنظیمات کارت «نسخه‌ی جدید موجود است» نشان می‌دهد (خالی = غیرفعال)
            'update' => [
                'latest' => self::get('app_latest_version'),
                'url' => self::get('app_update_url'),
                'notes' => self::get('app_update_notes'),
            ],
            // v17 — اطلاعات پشتیبانی واقعی (شیت قوانین/حریم خصوصی + صفحه‌ی ورود)
            'support' => [
                'email' => self::get('support_email'),
                'telegram' => self::get('support_telegram'),
            ],
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
            // v17 — کش فایلی بین‌درخواستی: صفر کوئری برای اکثر درخواست‌ها
            $cached = FileCache::get(FileCache::K_SETTINGS);
            if (is_array($cached)) {
                return self::$cache = $cached;
            }
            $rows = Database::pdo()->query('SELECT `key`, `value` FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
            $rows = is_array($rows) ? $rows : [];
            FileCache::set(FileCache::K_SETTINGS, $rows, 600);
            return self::$cache = $rows;
        } catch (Throwable) {
            return self::$cache = [];
        }
    }

    /** پاک‌سازی کش (برای تست + باطل‌سازی از پنل) */
    public static function flush(): void
    {
        self::$cache = null;
        self::$loaded = false;
        FileCache::delete(FileCache::K_SETTINGS);
    }
}

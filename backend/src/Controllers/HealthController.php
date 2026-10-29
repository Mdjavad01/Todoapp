<?php

declare(strict_types=1);

/**
 * کارام — کنترلر سلامت سرویس + بوت‌استرپ عمومی اپ (تنظیمات غیرمحرمانه)
 *
 * v1.9 — سلامت «واقعی»:
 *   GET /api/health        → عمومی و حداقلی: دیتابیس/پیکربندی/storage خراب = HTTP 503
 *                            (سرویس مانیتورینگ بیرونی فقط همین را چک می‌کند)
 *   GET /api/admin/health  → کامل فقط برای ادمین: دیتابیس، قابل‌نویس‌بودن storage،
 *                            آخرین اجرای کرون‌ها (یادآور/بکاپ/نگه‌داری)، آخرین ارسال موفق
 *                            SMTP و ربات تلگرام، فضای دیسک — بدون هیچ رازی در پاسخ
 */

final class HealthController
{
    /** GET /api/health — عمومی و حداقلی (۵۰۳ = سرویس ناسالم) */
    public function health(array $params = []): void
    {
        $dbOk = false;
        $dbConfigured = Config::isConfigured();

        if ($dbConfigured) {
            try {
                $dbOk = Database::ping();
            } catch (Throwable) {
                $dbOk = false;
            }
        }

        $storageOk = self::storageWritable();

        $healthy = $dbConfigured && $dbOk && $storageOk;

        Response::ok([
            'service' => 'karam-api',
            'status' => $healthy ? 'ok' : 'down',
            'time' => gmdate('c'), // همه‌ی تاریخ‌ها UTC
        ], $healthy ? 200 : 503);
    }

    /**
     * GET /api/admin/health — کامل فقط برای ادمین (دسترسی: settings.manage)
     * همیشه ۲۰۰ برمی‌گرداند و «وضعیت» را در بدنه می‌گوید تا داشبورد پنل بتواند هشدار بدهد.
     */
    public function adminHealth(array $params = []): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'settings.manage');

        $checks = [];

        // ---- دیتابیس ----
        $dbOk = false;
        $dbNote = null;
        if (Config::isConfigured()) {
            try {
                $dbOk = Database::ping();
                if (!$dbOk) {
                    $dbNote = 'ping ناموفق';
                }
            } catch (Throwable $e) {
                $dbNote = 'خطای اتصال دیتابیس';
            }
        } else {
            $dbNote = 'پیکربندی دیتابیس (.env) ناقص است';
        }
        $checks['database'] = ['ok' => $dbOk, 'note' => $dbNote];

        // ---- پیکربندی (هشدارها — بدون راز) ----
        $warnings = [];
        if (Otp::debugMisconfigured()) {
            $warnings[] = [
                'code' => 'otp_debug',
                'message' => 'OTP_DEBUG=1 در محیط production — کد ورود هرگز در پاسخ برنمی‌گردد؛ کلید را در .env خاموش کنید',
            ];
        }
        if (Otp::debugEcho()) {
            $warnings[] = [
                'code' => 'otp_debug_local',
                'message' => 'حالت توسعه فعال است (OTP_DEBUG + APP_ENV=local) — روی هاست واقعی هرگز نباشد',
            ];
        }
        if (Settings::bool('maintenance_mode')) {
            $warnings[] = [
                'code' => 'maintenance',
                'message' => 'حالت تعمیر روشن است — API به‌جز سلامت/ادمین/بازگشت درگاه، ۵۰۳ می‌دهد',
            ];
        }
        $checks['config'] = ['ok' => count($warnings) === 0, 'warnings' => $warnings];

        // ---- storage قابل‌نوشتن ----
        $storageDir = self::storageDir();
        $storageOk = $storageDir !== null && self::storageWritable();
        $checks['storage'] = [
            'ok' => $storageOk,
            'path' => $storageDir !== null ? basename(dirname($storageDir)) . '/' . basename($storageDir) : null,
            'note' => $storageOk ? null : 'پوشه‌ی storage قابل‌نوشتن نیست — لاگ/بکاپ/کش خراب می‌شوند',
        ];

        // ---- کرون‌ها (از فایل‌های وضعیت) ----
        $checks['crons'] = [
            'reminder' => self::cronStatus('reminder-state.json', 86400 + 3600), // روزانه + حاشیه
            'backup' => self::cronStatus('backup-status.json', 86400 + 3600),
            'retention' => self::cronStatus('retention-state.json', 86400 + 3600),
        ];

        // ---- آخرین ارسال موفق SMTP / ربات تلگرام / پیامک (از provider_logs) ----
        $checks['providers'] = [
            'smtp' => self::lastProviderOk('smtp'),
            'telegram' => self::lastProviderOk('telegram'),
            'sms' => self::lastProviderOk('sms'),
        ];

        // ---- فضای دیسک ----
        $disk = null;
        if ($storageDir !== null && function_exists('disk_free_space')) {
            $free = @disk_free_space($storageDir);
            $total = @disk_total_space($storageDir);
            if (is_float($free) && $free > 0) {
                $disk = [
                    'freeBytes' => (int) $free,
                    'totalBytes' => is_float($total) && $total > 0 ? (int) $total : null,
                    // زیر ۲۰۰MB آزاد = هشدار (بکاپ و لاگ جا نمی‌شوند)
                    'ok' => $free > 200 * 1024 * 1024,
                ];
            }
        }
        $checks['disk'] = ['ok' => $disk === null ? true : $disk['ok'], 'disk' => $disk];

        $allOk = $checks['database']['ok']
            && $checks['storage']['ok']
            && $checks['disk']['ok'];

        Response::ok([
            'service' => 'karam-api',
            'version' => Config::get('APP_VERSION', '1.0.0'),
            'php' => PHP_VERSION,
            'time' => gmdate('c'),
            'ok' => $allOk,
            'status' => $allOk ? 'ok' : 'down',
            'checks' => $checks,
        ]);
    }

    /**
     * GET /api/v1/bootstrap — تنظیمات عمومی اپ (بدون احراز، بدون راز).
     * اپ این را موقع بالا آمدن می‌گیرد: نام اپ، عنوان پرو، حداقل نسخه،
     * تنظیمات ویس (خواندن صوتی کارها)، کانال‌های ورود فعال و آستانه‌ی نگه‌داری سینک.
     */
    public function bootstrap(array $params = []): void
    {
        $public = Settings::publicBootstrap();
        $public['channels'] = [
            'email' => true,
            'telegram' => TelegramBot::configured(),
            'sms' => Sms::enabled(),
            'botUsername' => TelegramBot::botUsername(),
        ];
        Response::ok($public);
    }

    /* ---------------- ابزارهای داخلی ---------------- */

    /** دایرکتوری storage (هر دو چیدمان: مخزن و هاست) */
    private static function storageDir(): ?string
    {
        foreach ([dirname(__DIR__, 2) . '/storage', __DIR__ . '/storage'] as $dir) {
            if (is_dir($dir)) {
                return $dir;
            }
        }
        return null;
    }

    /** آیا storage قابل‌نوشتن است؟ (تست واقعی نوشتن/حذف فایل موقت) */
    private static function storageWritable(): bool
    {
        $dir = self::storageDir();
        if ($dir === null) {
            return false;
        }
        $probe = $dir . '/.health-probe-' . getmypid();
        $ok = @file_put_contents($probe, 'ok') !== false;
        if ($ok) {
            @unlink($probe);
        }
        return $ok;
    }

    /**
     * وضعیت یک کرون از فایل وضعیت آن — قدیمی‌تر از سقف = ناسالم
     * @return array{ok:bool, at:?string, ageHours:?float, note:?string}
     */
    private static function cronStatus(string $file, int $maxAgeSeconds): array
    {
        $dir = self::storageDir();
        if ($dir === null) {
            return ['ok' => false, 'at' => null, 'ageHours' => null, 'note' => 'storage در دسترس نیست'];
        }
        $path = $dir . '/cache/' . $file;
        if (!is_file($path)) {
            return ['ok' => false, 'at' => null, 'ageHours' => null, 'note' => 'هنوز اجرا نشده (فایل وضعیت نیست)'];
        }
        $raw = @file_get_contents($path);
        $data = $raw !== false ? json_decode($raw, true) : null;
        $at = is_array($data) ? (string) ($data['at'] ?? '') : '';
        if ($at === '') {
            return ['ok' => false, 'at' => null, 'ageHours' => null, 'note' => 'فایل وضعیت بی‌اعتبار است'];
        }
        $ageHours = (time() - strtotime($at)) / 3600;
        $ok = $ageHours >= 0 && $ageHours <= $maxAgeSeconds / 3600;
        return [
            'ok' => $ok,
            'at' => $at,
            'ageHours' => round($ageHours, 1),
            'note' => $ok ? null : "آخرین اجرا قدیمی‌تر از سقف مجاز است (سقف {$maxAgeSeconds} ثانیه)",
        ];
    }

    /**
     * آخرین ارسال موفق یک پروایدر از provider_logs — قدیمی‌تر از ۳ روز = هشدار.
     * (کرون‌های روزانه فعال باید هر روز یک سطر success بسازند؛ سکوتِ طولانی = خرابی پنهان)
     * @return array{ok:bool, at:?string, note:?string}
     */
    private static function lastProviderOk(string $provider): array
    {
        try {
            $stmt = Database::pdo()->prepare(
                "SELECT created_at FROM provider_logs
                 WHERE provider = :p AND status = 'success' AND direction = 'out'
                 ORDER BY id DESC LIMIT 1"
            );
            $stmt->execute([':p' => $provider]);
            $at = $stmt->fetchColumn();
            if ($at === false) {
                // هیچ ارسالی ثبت نشده = شاید پروایدر اصلاً استفاده نمی‌شود — «بی‌طرف»، نه شکست
                return ['ok' => true, 'at' => null, 'note' => 'هنوز ارسالی ثبت نشده (پروایدر بلااستفاده)'];
            }
            $ageHours = (time() - strtotime((string) $at)) / 3600;
            $ok = $ageHours <= 72;
            return [
                'ok' => $ok,
                'at' => Entities::sqlToIso((string) $at),
                'note' => $ok ? null : 'آخرین ارسال موفق بیش از ۷۲ ساعت پیش است',
            ];
        } catch (Throwable) {
            return ['ok' => true, 'at' => null, 'note' => 'بررسی provider_logs ممکن نشد'];
        }
    }
}

<?php

declare(strict_types=1);

/** کنترلر سلامت سرویس + بوت‌استرپ عمومی اپ (تنظیمات غیرمحرمانه) */
final class HealthController
{
    public function health(array $params = []): void
    {
        $dbOk = false;
        $dbError = null;

        if (Config::isConfigured()) {
            try {
                $dbOk = Database::ping();
            } catch (Throwable $e) {
                $dbError = 'خطای اتصال دیتابیس';
            }
        }

        // گام ۱ — هشدارهای پیکربندی (نمایش در سلامت سرویس + داشبورد پنل)
        $warnings = [];
        if (Otp::debugMisconfigured()) {
            $warnings[] = [
                'code' => 'otp_debug',
                'message' => 'OTP_DEBUG=1 در محیط production — کد ورود هرگز در پاسخ برنمی‌گردد؛ کلید را در .env خاموش کنید',
            ];
        }

        Response::ok([
            'service' => 'karam-api',
            'version' => Config::get('APP_VERSION', '1.0.0'),
            'app_name' => Config::get('APP_NAME', 'کارام'),
            'php' => PHP_VERSION,
            'time' => gmdate('c'), // همه‌ی تاریخ‌ها UTC
            'database' => Config::isConfigured() ? ($dbOk ? 'connected' : 'error') : 'not_configured',
            'warnings' => $warnings,
        ]);
    }

    /**
     * GET /api/v1/bootstrap — تنظیمات عمومی اپ (بدون احراز، بدون راز).
     * اپ این را موقع بالا آمدن می‌گیرد: نام اپ، عنوان پرو، حداقل نسخه،
     * تنظیمات ویس (خواندن صوتی کارها) و کانال‌های ورود فعال.
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
        // P1 — سقف نگه‌داری بکاپ (BACKUP_KEEP در .env — همان فرمول backup-db.php)
        // اپ این عدد را در متن «حذف حساب» و «حریم خصوصی» صادقانه نشان می‌دهد:
        // «داده‌ی حذف‌شده تا N روز در بکاپ‌های سروری می‌ماند»
        $keep = (int) (Config::get('BACKUP_KEEP', '7') ?? 7);
        $public['backup'] = ['keepDays' => max(3, min(60, $keep))];
        Response::ok($public);
    }
}

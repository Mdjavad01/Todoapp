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

        Response::ok([
            'service' => 'karam-api',
            'version' => Config::get('APP_VERSION', '1.0.0'),
            'app_name' => Config::get('APP_NAME', 'کارام'),
            'php' => PHP_VERSION,
            'time' => gmdate('c'), // همه‌ی تاریخ‌ها UTC
            'database' => Config::isConfigured() ? ($dbOk ? 'connected' : 'error') : 'not_configured',
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
            'bale' => BaleBot::configured(),
            'sms' => Sms::enabled(),
            'botUsername' => BaleBot::botUsername(),
        ];
        Response::ok($public);
    }
}

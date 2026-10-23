<?php

declare(strict_types=1);

/** کنترلر سلامت سرویس — برای مانیتورینگ و تست اولیه‌ی نصب */
final class HealthController
{
    public function health(): void
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
}

<?php

declare(strict_types=1);

/**
 * کارام — نقطه‌ی ورود API (فاز ۱: ساختار، تنظیمات و سلامت سرویس)
 * فازهای بعد: /api/auth، /api/lists، /api/tasks و ...
 *
 * همه‌ی تاریخ‌ها UTC ذخیره و برگردانده می‌شوند.
 */

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/Http/Response.php';
require __DIR__ . '/../src/Http/Router.php';
require __DIR__ . '/../src/Controllers/HealthController.php';

// محدودیت خطا: لاگ سرمحلی، بدون افشای جزئیات در پاسخ
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// مسیر لاگ اختصاصی (اگر پوشه‌ی storage/logs نوشتنی باشد)
$logDir = dirname(__DIR__) . '/storage/logs';
if (is_dir($logDir) && is_writable($logDir)) {
    ini_set('error_log', $logDir . '/php-error.log');
}

set_exception_handler(static function (Throwable $e): void {
    error_log('[karam] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Response::error('خطای داخلی سرور', 500);
});

$router = new Router();
$health = new HealthController();

$router->get('/api/health', [$health, 'health']);

// اجرا — مسیر بدون query string
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$router->dispatch($method, (string) $uri);

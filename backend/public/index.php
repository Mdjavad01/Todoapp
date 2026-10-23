<?php

declare(strict_types=1);

/**
 * کارام — نقطه‌ی ورود API
 * فاز ۱: سلامت سرویس | فاز ۲: CRUD + سینک دوسویه | فاز ۳: احراز هویت OTP + نشست‌ها
 *
 * همه‌ی تاریخ‌ها UTC ذخیره و برگردانده می‌شوند.
 */

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/Http/Request.php';
require __DIR__ . '/../src/Http/Response.php';
require __DIR__ . '/../src/Http/Router.php';
require __DIR__ . '/../src/Support/Uuid.php';
require __DIR__ . '/../src/Security/Validator.php';
require __DIR__ . '/../src/Auth/AccessToken.php';
require __DIR__ . '/../src/Auth/Guard.php';
require __DIR__ . '/../src/Auth/Otp.php';
require __DIR__ . '/../src/Auth/RefreshToken.php';
require __DIR__ . '/../src/Services/Mailer.php';
require __DIR__ . '/../src/Services/BaleBot.php';
require __DIR__ . '/../src/Services/Entities.php';
require __DIR__ . '/../src/Services/SyncService.php';
require __DIR__ . '/../src/Controllers/HealthController.php';
require __DIR__ . '/../src/Controllers/AuthController.php';
require __DIR__ . '/../src/Controllers/RestEntityController.php';
require __DIR__ . '/../src/Controllers/SyncController.php';

// همه‌ی تاریخ‌ها UTC — هم در PHP هم در MySQL
date_default_timezone_set('UTC');

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
    if ($e instanceof ValidationError) {
        Response::error($e->getMessage(), 422, ['code' => 'validation']);
        return;
    }
    Response::error('خطای داخلی سرور', 500);
});

$router = new Router();
$router->get('/api/health', [new HealthController(), 'health']);

// ---- احراز هویت OTP + نشست‌ها (فاز ۳) ----
$auth = new AuthController();
$router->get('/api/auth/channels', [$auth, 'channels']);
$router->post('/api/auth/otp/request', [$auth, 'otpRequest']);
$router->post('/api/auth/otp/bale/poll', [$auth, 'otpBalePoll']);
$router->post('/api/auth/otp/verify', [$auth, 'otpVerify']);
$router->post('/api/auth/refresh', [$auth, 'refresh']);
$router->post('/api/auth/logout', [$auth, 'logout']);
$router->post('/api/auth/session', [$auth, 'session']); // فاز ۲ — پیش‌فرض بسته
$router->get('/api/v1/me', [$auth, 'me']);
$router->patch('/api/v1/me', [$auth, 'updateMe']);
$router->get('/api/v1/me/sessions', [$auth, 'sessions']);
$router->delete('/api/v1/me/sessions/{id}', [$auth, 'revokeSession']);

// ---- CRUD موجودیت‌ها (Bearer) ----
$lists = new RestEntityController(Entities::ENTITY_LISTS);
$tasks = new RestEntityController(Entities::ENTITY_TASKS);
$subtasks = new RestEntityController(Entities::ENTITY_SUBTASKS);

$router->get('/api/v1/lists', [$lists, 'index']);
$router->post('/api/v1/lists', [$lists, 'create']);
$router->get('/api/v1/lists/{uuid}', [$lists, 'show']);
$router->patch('/api/v1/lists/{uuid}', [$lists, 'update']);
$router->delete('/api/v1/lists/{uuid}', [$lists, 'destroy']);

$router->get('/api/v1/tasks', [$tasks, 'index']);
$router->post('/api/v1/tasks', [$tasks, 'create']);
$router->get('/api/v1/tasks/{uuid}', [$tasks, 'show']);
$router->patch('/api/v1/tasks/{uuid}', [$tasks, 'update']);
$router->delete('/api/v1/tasks/{uuid}', [$tasks, 'destroy']);

$router->get('/api/v1/subtasks', [$subtasks, 'index']);
$router->post('/api/v1/subtasks', [$subtasks, 'create']);
$router->get('/api/v1/subtasks/{uuid}', [$subtasks, 'show']);
$router->patch('/api/v1/subtasks/{uuid}', [$subtasks, 'update']);
$router->delete('/api/v1/subtasks/{uuid}', [$subtasks, 'destroy']);

// ---- سینک دوسویه ----
$router->post('/api/v1/sync', [new SyncController(), 'sync']);

// اجرا — مسیر بدون query string
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$router->dispatch($method, (string) $uri);

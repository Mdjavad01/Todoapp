<?php

declare(strict_types=1);

/**
 * کارام — نقطه‌ی ورود API
 * فاز ۱: سلامت سرویس | فاز ۲: CRUD + سینک دوسویه | فاز ۳: احراز هویت OTP + نشست‌ها
 * فاز ۴: پنل مدیریت | فاز ۴.۵: شورتکد ادمین + تنظیمات کامل | فاز ۵: پرداخت زیبال + اشتراک
 *
 * همه‌ی تاریخ‌ها UTC ذخیره و برگردانده می‌شوند.
 */

// چیدمان مخزن: index.php در backend/public است و src کنار آن (backend/src)
// چیدمان هاست اشتراکی: index.php داخل api/ است و src داخل همان پوشه (api/src)
// ⚠️ باگ قبلی: «../src/» در چیدمان هاست به public_html/src می‌رسید که وجود نداشت
//    و باعث Fatal Error و خطای HTTP 500 خالی در همه‌ی مسیرهای API می‌شد.
$srcDir = is_dir(__DIR__ . '/src') ? __DIR__ : dirname(__DIR__);

require $srcDir . '/src/Config.php';
require $srcDir . '/src/Database.php';
require $srcDir . '/src/Http/Request.php';
require $srcDir . '/src/Http/Response.php';
require $srcDir . '/src/Http/Router.php';
require $srcDir . '/src/Support/Uuid.php';
require $srcDir . '/src/Support/Settings.php';
require $srcDir . '/src/Security/Validator.php';
require $srcDir . '/src/Auth/AccessToken.php';
require $srcDir . '/src/Auth/Guard.php';
require $srcDir . '/src/Auth/AdminGuard.php';
require $srcDir . '/src/Auth/Otp.php';
require $srcDir . '/src/Auth/RefreshToken.php';
require $srcDir . '/src/Services/Mailer.php';
require $srcDir . '/src/Services/Sms.php';
require $srcDir . '/src/Services/TelegramBot.php';
require $srcDir . '/src/Services/Audit.php';
require $srcDir . '/src/Services/Entities.php';
require $srcDir . '/src/Services/SyncService.php';
require $srcDir . '/src/Payments/Subscription.php';
require $srcDir . '/src/Payments/ZibalProvider.php';
require $srcDir . '/src/Controllers/HealthController.php';
require $srcDir . '/src/Controllers/AuthController.php';
require $srcDir . '/src/Controllers/RestEntityController.php';
require $srcDir . '/src/Controllers/SyncController.php';
require $srcDir . '/src/Controllers/PaymentController.php';
require $srcDir . '/src/Controllers/AdminController.php';

// همه‌ی تاریخ‌ها UTC — هم در PHP هم در MySQL
date_default_timezone_set('UTC');

// محدودیت خطا: لاگ سرمحلی، بدون افشای جزئیات در پاسخ
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// مسیر لاگ اختصاصی — دو چیدمان: مخزن (backend/public → backend/storage)
// و هاست اشتراکی (api/ در ریشه‌ی دامین → api/storage)
foreach ([dirname(__DIR__) . '/storage/logs', __DIR__ . '/storage/logs'] as $logDir) {
    if (is_dir($logDir) && is_writable($logDir)) {
        ini_set('error_log', $logDir . '/php-error.log');
        break;
    }
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
$router->get('/api/v1/bootstrap', [new HealthController(), 'bootstrap']);

// ---- گیت حالت تعمیر (فاز ۴.۵ — از پنل ادمین قابل تغییر) ----
// سلامت سرویس، همه‌ی مسیرهای ادمین و بازگشت درگاه پرداخت همیشه باز می‌مانند؛
// بقیه‌ی API ۵۰۳ می‌شود (تا پرداختِ در جریان، با تأیید سرور گم نشود).
$proxyPath = (string) (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '');
if ($proxyPath !== '/api/health'
    && !str_starts_with($proxyPath, '/api/admin')
    && $proxyPath !== '/api/payments/callback'
    && Settings::bool('maintenance_mode')) {
    Response::error('سرویس موقتاً در حال به‌روزرسانی است؛ چند دقیقه‌ی دیگر برگردید', 503, ['code' => 'maintenance']);
    return;
}

// ---- احراز هویت OTP + نشست‌ها (فاز ۳ — فاز ۵: بله ← تلگرام) ----
$auth = new AuthController();
$router->get('/api/auth/channels', [$auth, 'channels']);
$router->post('/api/auth/otp/request', [$auth, 'otpRequest']);
$router->post('/api/auth/otp/telegram/poll', [$auth, 'otpTelegramPoll']);
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

// ---- پرداخت و اشتراک (فاز ۵) ----
$payments = new PaymentController();
$router->get('/api/v1/plans', [$payments, 'plans']);
$router->post('/api/v1/payments/orders', [$payments, 'createOrder']);
$router->get('/api/v1/payments/orders/{uuid}', [$payments, 'orderStatus']);
$router->get('/api/v1/me/subscription', [$payments, 'mySubscription']);
// بازگشت از درگاه (بدون احراز — با امضای سمت سرور verify می‌شود)
$router->get('/api/payments/callback', [$payments, 'gatewayCallback']);

// ---- پنل مدیریت (فاز ۴) ----
$admin = new AdminController();
$router->post('/api/admin/login', [$admin, 'login']);
$router->post('/api/admin/logout', [$admin, 'logout']);
$router->get('/api/admin/me', [$admin, 'me']);
$router->get('/api/admin/stats', [$admin, 'stats']);
$router->get('/api/admin/users', [$admin, 'usersIndex']);
$router->get('/api/admin/users/{id}', [$admin, 'userShow']);
$router->patch('/api/admin/users/{id}', [$admin, 'userUpdate']);
$router->post('/api/admin/users/{id}/premium', [$admin, 'userGrantPremium']);
$router->post('/api/admin/users/{id}/revoke-sessions', [$admin, 'userRevokeSessions']);
$router->get('/api/admin/plans', [$admin, 'plansIndex']);
$router->patch('/api/admin/plans/{id}', [$admin, 'planUpdate']);
$router->get('/api/admin/announcements', [$admin, 'announcementsIndex']);
$router->post('/api/admin/announcements', [$admin, 'announcementCreate']);
$router->patch('/api/admin/announcements/{id}', [$admin, 'announcementUpdate']);
$router->delete('/api/admin/announcements/{id}', [$admin, 'announcementDelete']);
$router->get('/api/admin/settings', [$admin, 'settingsIndex']);
$router->patch('/api/admin/settings', [$admin, 'settingsUpdate']);
$router->post('/api/admin/otp/request', [$admin, 'otpShortcutRequest']);
$router->post('/api/admin/otp/telegram/poll', [$admin, 'otpShortcutTelegramPoll']);
$router->post('/api/admin/otp/verify', [$admin, 'otpShortcutVerify']);
$router->get('/api/admin/audit', [$admin, 'auditIndex']);

// اجرا — مسیر بدون query string
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$router->dispatch($method, (string) $uri);

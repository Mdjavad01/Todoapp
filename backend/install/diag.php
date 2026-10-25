<?php

declare(strict_types=1);

/**
 * کارام — ابزار عیب‌یابی یک‌بارمصرف (بعد از رفع مشکل حذف شود!)
 * ------------------------------------------------------------
 * نصب: این فایل را در «ریشه‌ی پوشه‌ی api» (کنار index.php) آپلود کنید
 * اجرا: https://app.hojre24shop.ir/api/diag.php
 * حذف: بعد از رفع مشکل حتماً diag.php را از پوشه‌ی api حذف کنید
 *
 * خروجی: نسخه PHP، افزونه‌ها، وضعیت .env، اتصال دیتابیس،
 *        سلامت تک‌تک فایل‌های کلاس (با md5) — بدون نمایش هیچ رازی
 */

ini_set('display_errors', '1');
error_reporting(E_ALL);

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

echo '<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عیب‌یابی کارام</title>';
echo '<body style="font-family:Tahoma,Vazirmatn,sans-serif;max-width:42rem;margin:2rem auto;line-height:1.9;color:#111">';
echo '<h2 style="margin:.2rem 0">عیب‌یابی کارام</h2>';
echo '<p style="color:#777;margin-top:0">این خروجی را کامل کپی کنید و در چت بفرستید. بعد از رفع مشکل این فایل را حذف کنید.</p>';
echo '<pre style="white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;padding:1rem;border-radius:10px;direction:ltr;text-align:left;font-size:12px">';

function diagLine(string $label, string $value, bool $ok = true): void
{
    echo ($ok ? '[OK]   ' : '[FAIL] ') . htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
        . ' = ' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . "\n";
}

diagLine('PHP_VERSION', PHP_VERSION, version_compare(PHP_VERSION, '8.1.0', '>='));
diagLine('SAPI', php_sapi_name());
diagLine('script_dir', __DIR__);

foreach (['pdo', 'pdo_mysql', 'json', 'mbstring', 'openssl', 'filter'] as $ext) {
    diagLine('extension:' . $ext, extension_loaded($ext) ? 'loaded' : 'MISSING', extension_loaded($ext));
}

// ---------- Config / .env ----------
$cfgLoaded = false;
try {
    require_once __DIR__ . '/src/Config.php';
    Config::load();
    $cfgLoaded = true;
    diagLine('Config::load', 'OK  md5=' . md5_file(__DIR__ . '/src/Config.php'));
} catch (Throwable $e) {
    diagLine('Config::load', 'ERROR: ' . $e->getMessage(), false);
}

if ($cfgLoaded) {
    $foundEnv = '(none)';
    foreach (Config::envPaths() as $p) {
        $exists = is_file($p);
        if ($exists && $foundEnv === '(none)') {
            $foundEnv = $p;
        }
        diagLine('env_candidate', $p . ' -> ' . ($exists ? 'EXISTS' : 'missing'), $exists);
    }
    diagLine('env_found', $foundEnv, $foundEnv !== '(none)');

    $tok = (string) Config::get('SETUP_TOKEN', '');
    diagLine('SETUP_TOKEN', $tok === '' ? 'EMPTY' : 'set (' . strlen($tok) . ' chars)', $tok !== '');
    diagLine('APP_SECRET', (string) Config::get('APP_SECRET', '') === '' ? 'EMPTY' : 'set', (string) Config::get('APP_SECRET', '') !== '');
    diagLine('APP_URL', (string) Config::get('APP_URL', '(unset)'));
    diagLine('DB_DRIVER', (string) Config::get('DB_DRIVER', '(unset)'));
    diagLine('DB_HOST', (string) Config::get('DB_HOST', '(unset)'));
    diagLine('DB_NAME', (string) Config::get('DB_NAME', '(unset)'));
    diagLine('DB_USER', (string) Config::get('DB_USER', '(unset)'));
    diagLine('DB_PASS', (string) Config::get('DB_PASS', '') === '' ? 'EMPTY' : 'set', (string) Config::get('DB_PASS', '') !== '');
}

// ---------- Database ----------
try {
    require_once __DIR__ . '/src/Database.php';
    diagLine('file:Database.php', 'OK  md5=' . md5_file(__DIR__ . '/src/Database.php'));
    $pdo = Database::pdo();
    diagLine('DB_CONNECT', 'OK');
    $v = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
    diagLine('DB_VERSION', $v);
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    diagLine('DB_TABLES', count($tables) . ' -> ' . implode(', ', $tables));
} catch (Throwable $e) {
    diagLine('DB_CONNECT', 'ERROR: ' . $e->getMessage(), false);
}

// ---------- تمام فایل‌های کلاس (مانند index.php — ترتیب یکسان) ----------
$files = [
    'Http/Request.php', 'Http/Response.php', 'Http/Router.php',
    'Support/Uuid.php', 'Support/Settings.php', 'Security/Validator.php',
    'Auth/AccessToken.php', 'Auth/Guard.php', 'Auth/AdminGuard.php',
    'Auth/Otp.php', 'Auth/RefreshToken.php',
    'Services/Mailer.php', 'Services/Sms.php', 'Services/TelegramBot.php',
    'Services/Audit.php', 'Services/Entities.php', 'Services/SyncService.php',
    'Payments/Subscription.php', 'Payments/ZibalProvider.php',
    'Controllers/HealthController.php', 'Controllers/AuthController.php',
    'Controllers/RestEntityController.php', 'Controllers/SyncController.php',
    'Controllers/PaymentController.php', 'Controllers/AdminController.php',
];
$bad = 0;
foreach ($files as $rel) {
    $p = __DIR__ . '/src/' . $rel;
    if (!is_file($p)) {
        diagLine('file:' . $rel, 'MISSING', false);
        $bad++;
        continue;
    }
    try {
        require_once $p;
        diagLine('file:' . $rel, 'OK  md5=' . md5_file($p));
    } catch (Throwable $e) {
        diagLine('file:' . $rel, 'ERROR: ' . $e->getMessage(), false);
        $bad++;
    }
}
diagLine('broken_class_files', (string) $bad, $bad === 0);

// ---------- فایل‌های ریشه ----------
foreach (['index.php', '.htaccess'] as $rootFile) {
    $p = __DIR__ . '/' . $rootFile;
    diagLine('root:' . $rootFile, is_file($p) ? 'exists  md5=' . md5_file($p) : 'MISSING', is_file($p));
}

// ---------- storage ----------
$slWritable = is_writable(__DIR__ . '/storage/logs');
diagLine('storage/logs writable', $slWritable ? 'yes' : 'NO', $slWritable);

echo '</pre>';
echo '<p style="color:#a00;font-weight:bold">بعد از رفع مشکل، فایل diag.php را از پوشه‌ی api حذف کنید.</p>';
echo '</body></html>';

<?php

declare(strict_types=1);

/**
 * کارام — ابزار عیب‌یابی نسخه ۲ (یک‌بارمصرف — بعد از رفع مشکل حذف شود!)
 * ------------------------------------------------------------
 * نصب: این فایل را در «ریشه‌ی پوشه‌ی api» (کنار index.php) آپلود کنید
 * اجرا: https://app.hojre24shop.ir/api/diag2.php
 * تفاوت با نسخه ۱: اثرانگوش md5 هر فایل با مقدار مرجع مقایسه و رأی MATCH/MISMATCH داده می‌شود
 *                + وضعیت نصب ادمین + آخرین خطاهای ثبت‌شده در api/storage/logs
 * خروجی هیچ رازی (رمز/توکن/هش) را نشان نمی‌دهد.
 */

ini_set('display_errors', '1');
error_reporting(E_ALL);

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

echo '<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عیب‌یابی ۲ کارام</title>';
echo '<body style="font-family:Tahoma,Vazirmatn,sans-serif;max-width:46rem;margin:2rem auto;line-height:1.9;color:#111">';
echo '<h2 style="margin:.2rem 0">عیب‌یابی ۲ کارام</h2>';
echo '<p style="color:#777;margin-top:0">این خروجی را کامل کپی کنید و در چت بفرستید. بعد از رفع مشکل این فایل را از پوشه‌ی api حذف کنید.</p>';
echo '<pre style="white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;padding:1rem;border-radius:10px;direction:ltr;text-align:left;font-size:12px">';

function d2Line(string $label, string $value, bool $ok = true): void
{
    echo ($ok ? '[OK]   ' : '[FAIL] ') . htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
        . ' = ' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . "\n";
}

d2Line('PHP_VERSION', PHP_VERSION, version_compare(PHP_VERSION, '8.1.0', '>='));
d2Line('SAPI', php_sapi_name());
d2Line('script_dir', __DIR__);

// ---------- تشخیص چیدمان (همان منطق جدید index.php) ----------
$hostLayout = is_dir(__DIR__ . '/src');
$srcDir = $hostLayout ? __DIR__ : dirname(__DIR__);
d2Line('src_layout', $hostLayout ? 'src INSIDE api (host layout)' : 'src BESIDE (repo layout)', is_dir($srcDir . '/src'));
d2Line('src_dir', $srcDir . '/src', is_dir($srcDir . '/src'));

// ---------- افزونه‌ها ----------
foreach (['pdo', 'pdo_mysql', 'json', 'mbstring', 'openssl', 'filter'] as $ext) {
    d2Line('extension:' . $ext, extension_loaded($ext) ? 'loaded' : 'MISSING', extension_loaded($ext));
}

// ---------- Config / .env ----------
$cfgLoaded = false;
try {
    require_once $srcDir . '/src/Config.php';
    Config::load();
    $cfgLoaded = true;
    d2Line('Config::load', 'OK');
} catch (Throwable $e) {
    d2Line('Config::load', 'ERROR: ' . $e->getMessage(), false);
}

if ($cfgLoaded) {
    $foundEnv = '(none)';
    foreach (Config::envPaths() as $p) {
        $exists = is_file($p);
        if ($exists && $foundEnv === '(none)') {
            $foundEnv = $p;
        }
        d2Line('env_candidate', $p . ' -> ' . ($exists ? 'EXISTS' : 'missing'), $exists);
    }
    d2Line('env_found', $foundEnv, $foundEnv !== '(none)');
    $tok = (string) Config::get('SETUP_TOKEN', '');
    d2Line('SETUP_TOKEN', $tok === '' ? 'EMPTY' : 'set (' . strlen($tok) . ' chars)', $tok !== '');
    d2Line('DB_NAME', (string) Config::get('DB_NAME', '(unset)'));
}

// ---------- دیتابیس ----------
try {
    require_once $srcDir . '/src/Database.php';
    $pdo = Database::pdo();
    $v = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
    d2Line('DB_CONNECT', 'OK  ' . $v);
    $adminCount = (int) $pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
    d2Line('admins_count', (string) $adminCount, true);
    d2Line('install_state', $adminCount > 0 ? 'ADMIN EXISTS (install done)' : 'no admin yet', true);
} catch (Throwable $e) {
    d2Line('DB_CONNECT', 'ERROR: ' . $e->getMessage(), false);
}

// ---------- اثرانگوش فایل‌ها با مقدار مرجع ----------
$expected = [
    'index.php'                          => '24d65aec11e08d0d79cbd1bf6f103f6d',
    '.htaccess'                          => '2a04b5454fc6337eb25fea2f74fb7956',
    'install/setup-admin.php'            => 'd804eb02d1ae9f45a234c80b852c061b',
    'install/.htaccess'                  => '8e167a918bd6bd3e91bd6130a62833e6',
    'src/Config.php'                     => '2a9acb769c3a7721640113780326b34f',
    'src/Database.php'                   => '9b81d439741f0e23aadf4c121a3e0cad',
    'src/Http/Request.php'               => '4d9ba247314cd93f1532394d80297e49',
    'src/Http/Response.php'              => '01c70d761f25eb243fe9b044ff4093f3',
    'src/Http/Router.php'                => '512f045fc64768fd3bf8b55aafaffdd9',
    'src/Support/Uuid.php'               => '259d4be584ef3fe2f31a66d856a8c0b8',
    'src/Support/Settings.php'           => 'f0eb1d77bcf2dfda86d11ca197a8af6e',
    'src/Security/Validator.php'         => 'd88de249f528f826acac1d418aa98680',
    'src/Auth/AccessToken.php'           => 'bda7e8960712d000d6758f2b28914351',
    'src/Auth/Guard.php'                 => '17fd04a89971d949a653b7385b945914',
    'src/Auth/AdminGuard.php'            => '2ebfe2e8300921ca412fd1e4c4d78ddd',
    'src/Auth/Otp.php'                   => '9f378a37e5af5487ee919b38276fffcc',
    'src/Auth/RefreshToken.php'          => '367876c151b398398259812739cb428e',
    'src/Services/Mailer.php'            => '21eab1e0684b9589ec2c68919d72e680',
    'src/Services/Sms.php'               => 'b68e61ad4d8852ff52f1e708b7af22fb',
    'src/Services/TelegramBot.php'       => '9762a6d2d42023ae684380214256e7e8',
    'src/Services/Audit.php'             => '09cbbf1a4add36e0b75e154f2732dde6',
    'src/Services/Entities.php'          => '25eebd113b454083a7d76aa31e8ab736',
    'src/Services/SyncService.php'       => '2c432a527945e9bd2b82d73d8766625d',
    'src/Payments/Subscription.php'      => '515e3930998217abd26458a085b775b6',
    'src/Payments/ZibalProvider.php'     => 'bbb6849cbd4ae1f0115624fec022f202',
    'src/Controllers/HealthController.php' => 'e86a34fd7ca6639937969a12381c472c',
    'src/Controllers/AuthController.php' => 'f96f0b0b3c4aec861894a8f428d917ae',
    'src/Controllers/RestEntityController.php' => '8f5ae0f4b8a30ce8d7ffd5cd6cc6c404',
    'src/Controllers/SyncController.php' => 'eb521303dfd0acba370e15124677b3b1',
    'src/Controllers/PaymentController.php' => 'cd2d85cda2bc29238c3e2f3d8985a940',
    'src/Controllers/AdminController.php' => '83af2d1e110f1b002551f9834924ef59',
];
$bad = 0;
foreach ($expected as $rel => $want) {
    $p = __DIR__ . '/' . $rel;
    if (!is_file($p)) {
        d2Line('md5:' . $rel, 'MISSING (expected ' . $want . ')', false);
        $bad++;
        continue;
    }
    $got = md5_file($p);
    if ($got === $want) {
        d2Line('md5:' . $rel, 'MATCH', true);
    } else {
        d2Line('md5:' . $rel, 'MISMATCH got=' . $got . ' want=' . $want, false);
        $bad++;
    }
}
d2Line('mismatched_files', (string) $bad, $bad === 0);

// ---------- وضعیت قفل نصب ----------
d2Line('lock:.installed', is_file(__DIR__ . '/install/.installed') ? 'EXISTS' : 'none', true);
d2Line('file:setup-admin.disabled.php', is_file(__DIR__ . '/install/setup-admin.disabled.php') ? 'EXISTS' : 'none', true);

// ---------- تست بارگذاری زنجیره‌ی بحرانی (مثل index.php جدید) ----------
$chain = ['Http/Request.php', 'Http/Response.php', 'Http/Router.php', 'Controllers/HealthController.php'];
foreach ($chain as $rel) {
    try {
        require_once $srcDir . '/src/' . $rel;
        d2Line('require:' . $rel, 'OK', true);
    } catch (Throwable $e) {
        d2Line('require:' . $rel, 'ERROR: ' . $e->getMessage(), false);
    }
}

// ---------- لاگ خطا ----------
$logDir = __DIR__ . '/storage/logs';
d2Line('storage/logs writable', is_writable($logDir) ? 'yes' : 'NO', is_writable($logDir));
$logFile = $logDir . '/php-error.log';
if (is_file($logFile)) {
    $lines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $tail = array_slice($lines, -12);
    d2Line('php-error.log', count($lines) . ' lines, last lines below', true);
    foreach ($tail as $l) {
        echo '  LOG | ' . htmlspecialchars($l, ENT_QUOTES, 'UTF-8') . "\n";
    }
} else {
    d2Line('php-error.log', 'not created yet', true);
}

// ---------- فایل‌های سرگردان احتمالی ----------
foreach (['setup-admin.php', 'diag.php', 'karam-env.txt'] as $stray) {
    $p = __DIR__ . '/' . $stray;
    if (is_file($p)) {
        d2Line('stray:' . $stray, 'EXISTS in api root (should not be here)', false);
    }
}

echo '</pre>';
echo '<p style="color:#a00;font-weight:bold">بعد از رفع مشکل، فایل diag2.php را از پوشه‌ی api حذف کنید.</p>';
echo '</body></html>';

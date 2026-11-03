<?php

declare(strict_types=1);

/**
 * کارام — عیب‌یاب یک‌کلیکی سینک (ابزار استقرار موقت)
 *
 * جای صحیح آپلود: داخل پوشه‌ی api/ — کنار index.php
 * آدرس:  https://<دامنه>/api/karam-diag.php?key=<کلید>
 *        برای تست سینک واقعی، انتهای آدرس:  &sync=1
 *
 * امنیت:
 *  - بدون کلید درست → 403 و هیچ خروجی‌ای.
 *  - هیچ رازی چاپ نمی‌شود (.env فقط نام/وضعیت؛ APP_SECRET هرگز).
 *  - تست سینک = pull خالص با changes خالی برای ۳ کاربر فعالِ پُرداده —
 *    هیچ رکوردی نمی‌سازد و هیچ داده‌ای تغییر نمی‌دهد.
 *  - بعد از رفع مشکل این فایل را از api/ حذف کنید.
 *
 * خروجی: محیط (PHP/ini/اکستنشن‌ها) + سلامت DB + وضعیت ستون‌های مهاجرت +
 * نتیجه‌ی واقعی SyncService (استثنای دقیق با فایل:خط) + ۴۰ خط آخر php-error.log
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// ─── کلید — فقط با همین کلید ابزار کار می‌کند ───────────────────────────────
const DIAG_KEY = 'f034717918b0a0a0d17690cb';

if (!isset($_GET['key']) || !hash_equals(DIAG_KEY, (string) $_GET['key'])) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit('forbidden');
}

header('Content-Type: text/html; charset=utf-8');

function diag_e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function diag_fatal(string $msg): void
{
    echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="font-family:Tahoma;background:#111;color:#f88;padding:24px;white-space:pre-wrap">' . diag_e($msg) . '</body></html>';
}

/**
 * اجرای یک بخش گزارش با گرفتن هر خطا — خروجی خطوط متن
 * @return list<string>
 */
function diag_section(callable $fn): array
{
    $out = [];
    try {
        $fn(static function (string $line) use (&$out): void {
            $out[] = $line;
        });
    } catch (Throwable $ex) {
        $out[] = '✗ استثنا: ' . get_class($ex) . ' — ' . $ex->getMessage();
        $out[] = '  @ ' . $ex->getFile() . ':' . $ex->getLine();
    }
    return $out;
}

// ─── بارگذاری همان زنجیره‌ی index.php (فقط تعریف کلاس‌ها) ───────────────────
$srcDir = is_dir(__DIR__ . '/src') ? __DIR__ : dirname(__DIR__);
$diagRequires = [
    '/src/Config.php', '/src/Database.php', '/src/Http/Request.php', '/src/Http/Response.php',
    '/src/Http/Router.php', '/src/Support/Uuid.php', '/src/Support/FileCache.php',
    '/src/Support/Settings.php', '/src/Support/DepositSchema.php', '/src/Support/TrialSchema.php',
    '/src/Support/ReferralSchema.php', '/src/Support/GiftSchema.php', '/src/Support/TaskSchema.php',
    '/src/Support/ListSchema.php', '/src/Support/AnnouncementsSchema.php',
    '/src/Security/Validator.php', '/src/Auth/AccessToken.php', '/src/Auth/Guard.php',
    '/src/Auth/AdminGuard.php', '/src/Auth/Otp.php', '/src/Auth/RefreshToken.php',
    '/src/Services/Mailer.php', '/src/Services/Sms.php', '/src/Services/TelegramBot.php',
    '/src/Services/Audit.php', '/src/Services/Entities.php', '/src/Services/SyncService.php',
    '/src/Payments/Subscription.php', '/src/Payments/ZibalProvider.php',
    '/src/Payments/PaymentsPolicy.php', '/src/Services/Referral.php', '/src/Services/GiftCode.php',
    '/src/Services/AccountDeletion.php', '/src/Controllers/HealthController.php',
    '/src/Controllers/AuthController.php', '/src/Controllers/RestEntityController.php',
    '/src/Controllers/SyncController.php', '/src/Controllers/PaymentController.php',
    '/src/Controllers/DepositController.php', '/src/Controllers/AnnouncementController.php',
    '/src/Controllers/AdminController.php',
];
foreach ($diagRequires as $rel) {
    $abs = $srcDir . $rel;
    if (!is_file($abs)) {
        diag_fatal("فایل بک‌اند پیدا نشد: {$rel} — آپلود پوشه‌ی src ناقص است!");
        return;
    }
    require_once $abs;
}

date_default_timezone_set('UTC');

echo '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
echo '<title>عیب‌یاب سینک کارام</title></head><body style="font-family:Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;line-height:1.9">';
echo '<h1 style="font-size:18px;color:#5eead4">🔍 عیب‌یاب سینک کارام — ' . diag_e(gmdate('Y-m-d H:i:s')) . ' UTC</h1><pre style="white-space:pre-wrap;font-family:Consolas,Tahoma,monospace;font-size:13px;direction:ltr;text-align:left">';

$log = static function (string $s): void {
    echo diag_e($s) . "\n";
};

// ═══ ۱) محیط PHP ═══
$log('══════ ۱) محیط PHP ══════');
foreach (diag_section(static function (callable $p): void {
    $p('PHP_VERSION = ' . PHP_VERSION);
    foreach (['max_execution_time', 'memory_limit', 'post_max_size'] as $ini) {
        $p("ini {$ini} = " . (string) (ini_get($ini) ?: '(خالی)'));
    }
    foreach (['pdo', 'pdo_mysql', 'json', 'mbstring', 'openssl', 'curl'] as $ext) {
        $p("ext {$ext} = " . (extension_loaded($ext) ? 'OK' : 'MISSING!'));
    }
}) as $line) {
    $log($line);
}

// ═══ ۲) پیکربندی و دیتابیس ═══
$log('');
$log('══════ ۲) پیکربندی و دیتابیس ══════');
foreach (diag_section(static function (callable $p): void {
    Config::load();
    $p('APP_ENV = ' . (string) (Config::get('APP_ENV', '?') ?? '?'));
    $p('DB_DRIVER = ' . Database::driver());
    foreach (Config::envPaths() as $i => $pth) {
        $p('.env مسیر ' . $i . ' = ' . (is_file($pth) ? 'موجود' : '—') . ' (' . basename(dirname($pth)) . '/' . basename($pth) . ')');
    }
    $secret = (string) (Config::get('APP_SECRET', '') ?? '');
    $p('APP_SECRET = ' . (strlen($secret) >= 32 ? 'تنظیم است (' . strlen($secret) . ' کاراکتر) — مقدار چاپ نمی‌شود' : '✗ تنظیم نشده یا کوتاه‌تر از ۳۲ کاراکتر!'));
    $pdo = Database::pdo();
    $p('DB connect = OK');
    $p('DB server = ' . (string) $pdo->query('SELECT VERSION()')->fetchColumn());
    $tz = (int) $pdo->query('SELECT NOW() = UTC_TIMESTAMP()')->fetchColumn();
    $p('DB time_zone UTC = ' . ($tz === 1 ? 'OK' : 'متفاوت با UTC — هشدار'));
    foreach (['lists', 'tasks', 'subtasks', 'settings', 'refresh_tokens', 'otp_requests', 'plans', 'users'] as $t) {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = " . $pdo->quote($t))->fetchColumn();
        $p("table {$t} = " . ($n > 0 ? 'OK' : '✗ نیست!'));
    }
}) as $line) {
    $log($line);
}

// ═══ ۳) وضعیت ستون‌های مهاجرت ═══
$log('');
$log('══════ ۳) ستون‌های مهاجرت ══════');
foreach (diag_section(static function (callable $p): void {
    $pdo = Database::pdo();
    $check = static function (string $table, array $cols) use ($pdo, $p): void {
        foreach ($cols as $col) {
            $r = $pdo->query("SHOW COLUMNS FROM `{$table}` LIKE " . $pdo->quote($col))->fetch();
            $p("{$table}.{$col} = " . (is_array($r) ? 'OK' : '✗ نیست — مهاجرت ناقص!'));
        }
    };
    $check('lists', ['pinned', 'template_key']);
    $check('tasks', ['starred', 'repeat_meta', 'item_type', 'item_value']);
    $check('plans', ['price_tomans']);
    $r = $pdo->query("SHOW COLUMNS FROM `otp_requests` LIKE 'purpose'")->fetch();
    $p('otp_requests.purpose = ' . (is_array($r) ? (string) $r['Type'] : '✗ نیست!'));
    $r = $pdo->query("SHOW COLUMNS FROM `lists` LIKE 'template_key'")->fetch();
    if (is_array($r)) {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM `lists` WHERE template_key IS NOT NULL AND template_key <> ''")->fetchColumn();
        $p('lists با template_key = ' . $n . ' ردیف');
    }
}) as $line) {
    $log($line);
}

// ═══ ۴) تست واقعی سینک (فقط با &sync=1) ═══
$log('');
if (isset($_GET['sync'])) {
    $log('══════ ۴) تست واقعی SyncService (pull خالص — بدون تغییر داده) ══════');
    foreach (diag_section(static function (callable $p): void {
        $pdo = Database::pdo();
        $users = $pdo->query(
            "SELECT u.id, u.uuid, (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS tasks
             FROM users u WHERE u.status = 'active' ORDER BY tasks DESC LIMIT 3"
        )->fetchAll();
        if (!$users) {
            $p('هیچ کاربر فعالی نیست.');
            return;
        }
        foreach ($users as $u) {
            $short = substr((string) $u['uuid'], 0, 8) . '…';
            $p('— کاربر ' . $short . ' (تسک: ' . $u['tasks'] . ') — اجرای SyncService::run(pull=1)…');
            $t0 = microtime(true);
            try {
                $res = SyncService::run((int) $u['id'], ['pull' => 1, 'changes' => []]);
                $ms = (int) round((microtime(true) - $t0) * 1000);
                $p('   OK در ' . $ms . 'ms — lists=' . count($res['server']['lists'] ?? [])
                    . ' tasks=' . count($res['server']['tasks'] ?? [])
                    . ' subtasks=' . count($res['server']['subtasks'] ?? []));
            } catch (Throwable $ex) {
                $p('   ✗✗✗ خطای واقعی سینک: ' . get_class($ex) . ' — ' . $ex->getMessage());
                $p('   @ ' . $ex->getFile() . ':' . $ex->getLine());
                $tr = explode("\n", (string) $ex->getTraceAsString());
                foreach (array_slice($tr, 0, 4) as $tl) {
                    $p('   ' . $tl);
                }
            }
        }
    }) as $line) {
        $log($line);
    }
} else {
    $log('برای تست واقعی سینک، به انتهای آدرس اضافه کنید: &sync=1');
}

// ═══ ۵) لاگ خطای سرور ═══
$log('');
$log('══════ ۵) ۴۰ خط آخر php-error.log ══════');
foreach (diag_section(static function (callable $p): void {
    $candidates = [dirname(__DIR__, 2) . '/storage/logs/php-error.log', __DIR__ . '/storage/logs/php-error.log'];
    $found = null;
    foreach ($candidates as $c) {
        if (is_file($c)) {
            $found = $c;
            break;
        }
    }
    if ($found === null) {
        $p('(فایل لاگ پیدا نشد — یا خالی است یا مسیر لاگ هاست جای دیگری است)');
        return;
    }
    $p('مسیر: ' . $found . ' — حجم: ' . filesize($found) . ' بایت');
    $lines = file($found, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach (array_slice(is_array($lines) ? $lines : [], -40) as $ln) {
        $p($ln);
    }
}) as $line) {
    $log($line);
}

$log('');
$log('══════ پس از رفع مشکل، این فایل را از api/ حذف کنید. ══════');
echo '</pre></body></html>';

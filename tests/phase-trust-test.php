<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی P1 (ایمنی و اعتماد):
 *   ۱) بوت‌استرپ: backup.keepDays (از BACKUP_KEEP)
 *   ۲) دریافت داده (export) — کامل و ایزوله بین کاربران
 *   ۳) حذف حساب: کد ورود ≠ کد حذف · تایپ «حذف حساب» · حذف کامل · ۴۰۱ فوری دستگاه دوم
 *      · سوابق مالی بی‌نام · audit · سلامت کاربر دیگر
 *   ۴) ماسک رازهای بکاپ (BackupMask)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 * اجرا:  php tests/phase-trust-test.php
 * (DB محلی و لاگ‌ها هر بار از نو ساخته می‌شوند)
 */

const BASE = 'http://127.0.0.1:8099';
const ROOT = __DIR__ . '/..';

$pass = 0;
$fail = 0;

function check(string $name, bool $cond, string $detail = ''): void
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  ✓ {$name}\n";
    } else {
        $fail++;
        echo "  ✗ {$name}" . ($detail !== '' ? " — {$detail}" : '') . "\n";
    }
}

/** @return array{0:int,1:array|null} */
function http(string $method, string $path, ?array $body = null, ?string $token = null): array
{
    $ch = curl_init(BASE . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 15,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    $resp = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $json = $resp === false || trim((string) $resp) === '' ? null : json_decode((string) $resp, true);
    return [$status, is_array($json) ? $json : null];
}

function requestEmailCode(string $email): string
{
    sleep(2); // احترام به فاصله‌ی ارسال (OTP_RESEND_AFTER=1s در محیط تست)
    [$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $email]);
    if ($st !== 200 || !isset($j['devCode'])) {
        fwrite(STDERR, "درخواست کد برای {$email} ناموفق بود: {$st}\n");
        exit(1);
    }
    return (string) $j['devCode'];
}

/** ورود کامل با ایمیل → توکن access + refresh + uuid */
function loginEmail(string $email, string $deviceUuid): array
{
    $code = requestEmailCode($email);
    [$st, $j] = http('POST', '/api/auth/otp/verify', [
        'channel' => 'email',
        'target' => $email,
        'code' => $code,
        'deviceName' => 'تست P1',
        'deviceUuid' => $deviceUuid,
    ]);
    if ($st !== 200) {
        fwrite(STDERR, "ورود {$email} ناموفق بود: {$st}\n");
        exit(1);
    }
    return [
        'token' => (string) $j['accessToken'],
        'refresh' => (string) $j['refreshToken'],
        'uuid' => (string) $j['user']['uuid'],
    ];
}

function resetEnvironment(): void
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    foreach ([$dbPath, $dbPath . '-wal', $dbPath . '-shm'] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $sql = (string) file_get_contents(ROOT . '/deploy/install.sqlite.sql');
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        if ($stmt !== '') {
            $pdo->exec($stmt);
        }
    }
    $pdo = null;

    // پاک‌سازی لاگ ایمیل و کش تلگرام و ژورنال کدها
    foreach ([
        ROOT . '/backend/storage/logs/mail.log',
        ROOT . '/backend/storage/cache/telegram-updates.json',
        ROOT . '/backend/storage/cache/issued-otp.jsonl',
        __DIR__ . '/telegram-mock-state.json',
    ] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
}

/** خواندن یک کلید از backend/.env */
function envKey(string $key, string $default = ''): string
{
    $envFile = ROOT . '/backend/.env';
    if (!is_file($envFile)) {
        return $default;
    }
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false) {
            continue;
        }
        if (trim(substr($line, 0, $pos)) === $key) {
            $v = trim(substr($line, $pos + 1));
            return trim($v, "\"'") ?: $default;
        }
    }
    return $default;
}

/* =====================================================================
 * اجرا
 * ===================================================================== */

resetEnvironment();
require ROOT . '/backend/src/Support/BackupMask.php';

$pdo = new PDO('sqlite:' . envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3'), null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

echo "── ۱) بوت‌استرپ: backup.keepDays ──\n";
[$st, $j] = http('GET', '/api/v1/bootstrap');
check('bootstrap → 200', $st === 200);
$keep = $j['backup']['keepDays'] ?? null;
check('backup.keepDays برگشت و در بازه‌ی ۳..۶۰ است', is_int($keep) && $keep >= 3 && $keep <= 60, var_export($keep, true));

echo "\n── ۲) دریافت داده (export) — کامل و ایزوله ──\n";
$u1 = loginEmail('trust1@test.ir', '31111111-1111-4111-8111-111111111111');
$u2 = loginEmail('trust2@test.ir', '32222222-2222-4222-8222-222222222222');

// داده برای user1: یک لیست + یک کار + یک زیرکار (از REST واقعی — با قرارداد سینک: updatedAt الزامی)
$NOW = gmdate('Y-m-d\TH:i:s.000\Z');
[$st, $j] = http('POST', '/api/v1/lists', ['id' => 'a1111111-1111-4111-8111-aaaaaaaaaaaa', 'name' => 'لیست P1', 'emoji' => '🧪', 'createdAt' => $NOW, 'updatedAt' => $NOW], $u1['token']);
check('ساخت لیست → 201', $st === 201, (string) $st . json_encode($j, JSON_UNESCAPED_UNICODE));
[$st, $j] = http('POST', '/api/v1/tasks', ['id' => 'b1111111-1111-4111-8111-bbbbbbbbbbbb', 'listId' => 'a1111111-1111-4111-8111-aaaaaaaaaaaa', 'title' => 'کار آزمایشی P1', 'createdAt' => $NOW, 'updatedAt' => $NOW], $u1['token']);
check('ساخت کار → 201', $st === 201, (string) $st . json_encode($j, JSON_UNESCAPED_UNICODE));
[$st, $j] = http('POST', '/api/v1/subtasks', ['id' => 'c1111111-1111-4111-8111-cccccccccccc', 'taskId' => 'b1111111-1111-4111-8111-bbbbbbbbbbbb', 'title' => 'زیرکار آزمایشی', 'createdAt' => $NOW, 'updatedAt' => $NOW], $u1['token']);
check('ساخت زیرکار → 201', $st === 201, (string) $st . json_encode($j, JSON_UNESCAPED_UNICODE));

[$st, $j] = http('GET', '/api/v1/account/export', null, $u1['token']);
check('export خود کاربر → 200', $st === 200, (string) $st);
check('export شامل پروفایل خود اوست', ($j['user']['uuid'] ?? '') === $u1['uuid']);
check('export هویت ایمیل را دارد', in_array('email', array_column($j['identities'] ?? [], 'type'), true));
check('export شامل ۱ لیست است', count($j['lists'] ?? []) === 1, (string) count($j['lists'] ?? []));
check('export شامل ۱ کار است', count($j['tasks'] ?? []) === 1, (string) count($j['tasks'] ?? []));
check('export شامل ۱ زیرکار است', count($j['subtasks'] ?? []) === 1, (string) count($j['subtasks'] ?? []));
check('export بدون ستون‌های داخلی سرور است', !isset($j['lists'][0]['user_id'], $j['lists'][0]['applied_at']));

[$st, $j] = http('GET', '/api/v1/account/export', null, $u2['token']);
check('export کاربر دوم → 200', $st === 200);
check('ایزوله: export کاربر دوم هیچ لیست/کاری از کاربر اول ندارد', count($j['lists'] ?? []) === 0 && count($j['tasks'] ?? []) === 0);

[$st] = http('GET', '/api/v1/account/export');
check('export بدون توکن → 401', $st === 401);

echo "\n── ۳) حذف حساب: کد ورود ≠ کد حذف · تأیید متنی · ۴۰۱ فوری · بی‌نام‌سازی مالی ──\n";

// رکورد مالی برای user1 (قبل از حذف) — باید بعد از حذف بی‌نام بماند
$pdo->prepare("INSERT INTO orders (uuid, user_id, plan_id, amount_tomans, status, created_at, updated_at)
               VALUES ('d1111111-1111-4111-8111-dddddddddddd', (SELECT id FROM users WHERE uuid = :u), 1, 49000, 'paid', datetime('now'), datetime('now'))")
    ->execute([':u' => $u1['uuid']]);
$pdo->prepare("INSERT INTO deposit_requests (uuid, user_id, plan_code, amount_tomans, reference, status, created_at, updated_at)
               VALUES ('e1111111-1111-4111-8111-eeeeeeeeeeee', (SELECT id FROM users WHERE uuid = :u), 'm1', 49000, 'TRX-TEST-1', 'approved', datetime('now'), datetime('now'))")
    ->execute([':u' => $u1['uuid']]);

// دستگاه دوم user1 (توکن جدا) — باید بعد از حذف فوراً ۴۰۱ شود
$u1dev2 = loginEmail('trust1@test.ir', '33333333-3333-4333-8333-333333333333');

// کد ورود (purpose=login) و کد حذف (purpose=delete) برای یک هویت
$loginCode = requestEmailCode('trust1@test.ir');
sleep(2);
[$st, $j] = http('POST', '/api/v1/account/delete/request', [], $u1['token']);
check('درخواست کد حذف → 200', $st === 200, (string) $st . json_encode($j, JSON_UNESCAPED_UNICODE));
check('کانال حذف ایمیل است', ($j['channel'] ?? '') === 'email');
$deleteCode = (string) ($j['devCode'] ?? '');
check('کد حذف در پاسخ dev برگشت', $deleteCode !== '' && preg_match('/^\d{6}$/', $deleteCode) === 1);
check('کد حذف با کد ورود یکی نیست', $deleteCode !== $loginCode);

// الف) کد ورود برای حذف نمی‌شود (purpose جداست)
[$st, $j] = http('POST', '/api/v1/account/delete/confirm', ['code' => $loginCode, 'confirmText' => 'حذف حساب'], $u1['token']);
check('تأیید حذف با «کد ورود» رد می‌شود (۴۰۰)', $st === 400, (string) $st);

// ب) کد حذف برای ورود نمی‌شود
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'trust1@test.ir', 'code' => $deleteCode, 'deviceUuid' => '34444444-4444-4444-8444-444444444444']);
check('ورود با «کد حذف» رد می‌شود (۴۰۰)', $st === 400, (string) $st);

// ج) عبارت تأیید باید دقیقاً «حذف حساب» باشد
[$st, $j] = http('POST', '/api/v1/account/delete/confirm', ['code' => $deleteCode, 'confirmText' => 'حذف می‌کنم'], $u1['token']);
check('تأیید با عبارت اشتباه → ۴۲۲ و کد مصرف نمی‌شود', $st === 422, (string) $st);

// د) بدون توکن، حذف ممکن نیست
[$st] = http('POST', '/api/v1/account/delete/confirm', ['code' => $deleteCode, 'confirmText' => 'حذف حساب']);
check('حذف بدون توکن → 401', $st === 401);

// هـ) تأیید درست: کد حذف + «حذف حساب»
sleep(1);
[$st, $j] = http('POST', '/api/v1/account/delete/confirm', ['code' => $deleteCode, 'confirmText' => 'حذف حساب'], $u1['token']);
check('تأیید درست حذف → 200 و deleted=true', $st === 200 && ($j['deleted'] ?? false) === true, (string) $st . json_encode($j, JSON_UNESCAPED_UNICODE));

// و) ۴۰۱ فوری روی هر دو دستگاه (توکن‌ها تغییر نکرده‌اند)
[$st, $j] = http('GET', '/api/v1/me', null, $u1['token']);
check('دستگاه اول بعد از حذف → ۴۰۱ فوری', $st === 401, (string) $st);
[$st, $j] = http('GET', '/api/v1/me', null, $u1dev2['token']);
check('دستگاه دوم بعد از حذف → ۴۰۱ فوری', $st === 401, (string) $st);
[$st] = http('POST', '/api/auth/refresh', ['refreshToken' => $u1dev2['refresh'], 'deviceUuid' => '33333333-3333-4333-8333-333333333333']);
check('refresh دستگاه دوم → ۴۰۱', $st === 401, (string) $st);

// ز) پاک‌سازی دیتابیس — با PDO مستقیم
$uuid = $u1['uuid'];
$count = static function (string $tbl, string $where = '', array $args = []) use ($pdo): int {
    $st = $pdo->prepare("SELECT COUNT(*) FROM {$tbl} {$where}");
    $st->execute($args);
    return (int) $st->fetchColumn();
};
check('ردیف کاربر حذف شد', $count('users', 'WHERE uuid = :u', [':u' => $uuid]) === 0);
check('هویت‌ها حذف شدند', $count('user_identities', 'WHERE value = :v', [':v' => 'trust1@test.ir']) === 0);
check('لیست‌ها حذف شدند', $count('lists', 'WHERE uuid = :u', [':u' => 'a1111111-1111-4111-8111-aaaaaaaaaaaa']) === 0);
check('کارها حذف شدند', $count('tasks', 'WHERE uuid = :u', [':u' => 'b1111111-1111-4111-8111-bbbbbbbbbbbb']) === 0);
check('زیرکارها حذف شدند', $count('subtasks', 'WHERE uuid = :u', [':u' => 'c1111111-1111-4111-8111-cccccccccccc']) === 0);
check('نشست‌ها (refresh_tokens) حذف شدند', $count('refresh_tokens', 'WHERE device_id = :d', [':d' => '31111111-1111-4111-8111-111111111111']) === 0);
check('رکوردهای OTP آن هویت حذف شدند', $count('otp_requests', 'WHERE identity_value = :v', [':v' => 'trust1@test.ir']) === 0);

// ح) سوابق مالی بی‌نام اما باقی
$st = $pdo->prepare("SELECT user_id, description, amount_tomans, status FROM orders WHERE uuid = 'd1111111-1111-4111-8111-dddddddddddd'");
$st->execute();
$row = $st->fetch(PDO::FETCH_ASSOC);
check('سفارش پاک نشده', $row !== false);
check('سفارش بی‌نام شد (user_id=NULL)', $row !== false && $row['user_id'] === null, var_export($row, true));
check('توضیح سفارش پاک شد', $row !== false && ($row['description'] === null || $row['description'] === ''));
check('مبلغ/وضعیت سفارش برای حسابداری ماند', $row !== false && (int) $row['amount_tomans'] === 49000 && $row['status'] === 'paid');
$st = $pdo->prepare("SELECT user_id, note FROM deposit_requests WHERE uuid = 'e1111111-1111-4111-8111-eeeeeeeeeeee'");
$st->execute();
$drow = $st->fetch(PDO::FETCH_ASSOC);
check('واریز بی‌نام شد اما ماند', $drow !== false && $drow['user_id'] === null);

// ط) audit
$st = $pdo->prepare("SELECT COUNT(*) FROM audit_logs WHERE action = 'account_deleted' AND entity_id = :u");
$st->execute([':u' => $uuid]);
check('رخداد حذف حساب در audit ثبت شد', (int) $st->fetchColumn() === 1);

// ی) کاربر دیگر دست‌نخورده
check('کاربر دوم سالم است', $count('users', 'WHERE uuid = :u', [':u' => $u2['uuid']]) === 1);
[$st, $j] = http('GET', '/api/v1/me', null, $u2['token']);
check('کاربر دوم همچنان دسترسی دارد', $st === 200 && ($j['user']['uuid'] ?? '') === $u2['uuid'], (string) $st);

echo "\n── ۴) ماسک رازهای بکاپ (BackupMask) ──\n";
check('فهرست رازها دقیقاً ۵ کلید است', count(BackupMask::SECRET_KEYS) === 5, implode(',', BackupMask::SECRET_KEYS));
foreach (['smtp_pass', 'telegram_bot_token', 'zibal_merchant', 'provider_sms_headers', 'admin_otp_shortcuts'] as $k) {
    check("maskedValue({$k}) = ''", BackupMask::maskedValue($k, 'SUPER-SECRET') === '');
}
check('maskedValue(app_name) دست‌نخورده', BackupMask::maskedValue('app_name', 'کارام') === 'کارام');
check('maskedValue(backup_telegram_chat) دست‌نخورده', BackupMask::maskedValue('backup_telegram_chat', '123') === '123');
check('isSecret برای کلید غریبه false', BackupMask::isSecret('min_app_version') === false);

/* ===================================================================== */

echo "\n════ نتیجه: {$pass} موفق / {$fail} ناموفق ════\n";
exit($fail === 0 ? 0 : 1);

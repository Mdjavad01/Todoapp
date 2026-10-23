<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز ۴.۵
 * (شورتکد OTP ادمین + تنظیمات API/ویس/پروایدر/کارت + گیت تعمیر/ثبت‌نام + جنسیت)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API (با backend/.env محلی)
 *
 * اجرا:  php tests/phase45-test.php
 * (DB محلی هر بار از نو ساخته می‌شود؛ ادمین مستقیم در DB seed می‌شود)
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
function http(string $method, string $path, ?array $body = null, ?string $token = null, ?string $csrf = null): array
{
    $ch = curl_init(BASE . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    if ($csrf !== null) {
        $headers[] = 'X-CSRF-Token: ' . $csrf;
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

function envKey(string $key, string $default = ''): string
{
    foreach (file(ROOT . '/backend/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false || trim(substr($line, 0, $pos)) !== $key) {
            continue;
        }
        return trim(trim(substr($line, $pos + 1)), '"\'');
    }
    return $default;
}

function dbPath(): string
{
    return envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . dbPath(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('PRAGMA foreign_keys = ON');
    }
    return $pdo;
}

function resetEnvironment(): void
{
    $dbPath = dbPath();
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
    // ژورنال کدهای OTP هم از نو
    @unlink(ROOT . '/backend/storage/cache/issued-otp.jsonl');
}

function q1(string $sql, array $p = []): mixed
{
    $q = db()->prepare($sql);
    $q->execute($p);
    return $q->fetchColumn();
}

function uuid4(): string
{
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}

function seedAdmin(string $username, string $password, string $roleCode): int
{
    $pdo = db();
    $role = $pdo->prepare('SELECT id FROM admin_roles WHERE code = ?');
    $role->execute([$roleCode]);
    $roleId = (int) $role->fetchColumn();
    $ins = $pdo->prepare('INSERT INTO admins (uuid, username, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, 1)');
    $ins->execute([uuid4(), $username, password_hash($password, PASSWORD_DEFAULT), $roleId]);
    return (int) $pdo->lastInsertId();
}

/** آخرین کد صادرشده برای یک هویت از ژورنال سرور (شورتکد ادمین) */
function lastIssued(string $type, string $value): ?string
{
    $path = ROOT . '/backend/storage/cache/issued-otp.jsonl';
    if (!is_file($path)) {
        return null;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    for ($i = count($lines) - 1; $i >= 0; $i--) {
        $e = json_decode((string) $lines[$i], true);
        if (is_array($e) && ($e['type'] ?? '') === $type && strtolower((string) ($e['value'] ?? '')) === strtolower($value)) {
            return (string) $e['code'];
        }
    }
    return null;
}

/* ================= setup ================= */
resetEnvironment();
seedAdmin('boss', 'BossPass123', 'superadmin');
seedAdmin('helper', 'HelperPass123', 'support');
echo "— آماده‌سازی: دیتابیس نو + ادمین‌ها (boss/helper)\n\n";

/* ================= ۱) بوت‌استرپ عمومی ================= */
echo "۱) بوت‌استرپ عمومی (بدون احراز)\n";
[$st, $j] = http('GET', '/api/v1/bootstrap');
check('bootstrap → 200', $st === 200);
check('voice پیش‌فرض خاموش', ($j['voice']['enabled'] ?? null) === false);
check('کانال پیامک پیش‌فرض بسته', ($j['channels']['sms'] ?? null) === false);
check('کانال ایمیل باز', ($j['channels']['email'] ?? null) === true);

/* ================= ۲) ورود ادمین ================= */
echo "\n۲) ورود ادمین\n";
[$st, $j] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'BossPass123']);
check('ورود boss → 200', $st === 200 && isset($j['token']));
$bossToken = (string) ($j['token'] ?? '');
$bossCsrf = (string) ($j['csrfToken'] ?? '');

[$st, $j] = http('POST', '/api/admin/login', ['username' => 'helper', 'password' => 'HelperPass123']);
$helperToken = (string) ($j['token'] ?? '');
$helperCsrf = (string) ($j['csrfToken'] ?? '');
check('ورود helper → 200', $st === 200);

/* ================= ۳) اعتبارسنجی و ذخیره‌ی تنظیمات جدید ================= */
echo "\n۳) تنظیمات جدید (API/ویس/پروایدر/کارت)\n";
[$st, $j] = http('PATCH', '/api/admin/settings', ['api_max_sync_items' => 'abc'], $bossToken, $bossCsrf);
check('سقف سینک غیرعددی → 422', $st === 422);

[$st, $j] = http('PATCH', '/api/admin/settings', ['voice_rate' => '300'], $bossToken, $bossCsrf);
check('سرعت ویس خارج از محدوده → 422', $st === 422);

[$st, $j] = http('PATCH', '/api/admin/settings', ['voice_provider' => 'alexa'], $bossToken, $bossCsrf);
check('پروایدر ویس نامعتبر → 422', $st === 422);

[$st, $j] = http('PATCH', '/api/admin/settings', ['provider_sms_headers' => 'not-json'], $bossToken, $bossCsrf);
check('هدر پیامک JSON نامعتبر → 422', $st === 422);

[$st, $j] = http('PATCH', '/api/admin/settings', [
    'voice_enabled' => '1',
    'voice_provider' => 'web_speech',
    'voice_rate' => '110',
    'voice_pitch' => '90',
    'voice_lang' => 'fa-IR',
    'api_max_sync_items' => '150',
    'smtp_host' => 'mail.hojre24shop.ir',
    'smtp_port' => '587',
    'mail_transport' => 'smtp',
    'provider_sms_enabled' => '1',
    'provider_sms_method' => 'GET',
    'provider_sms_headers' => '{"Authorization": "Bearer TEST"}',
    'card_payment_guide' => 'پس از واریز، رسید را با پشتیبانی در میان بگذارید.',
], $bossToken, $bossCsrf);
check('ذخیره‌ی دسته‌ی کامل → 200', $st === 200, (string) ($j['error'] ?? ''));

[$st, $j] = http('GET', '/api/admin/settings', null, $bossToken);
$map = [];
foreach (($j['items'] ?? []) as $row) {
    $map[(string) $row['key']] = (string) $row['value'];
}
check('voice_enabled ذخیره شد', ($map['voice_enabled'] ?? '') === '1');
check('api_max_sync_items=150', ($map['api_max_sync_items'] ?? '') === '150');
check('smtp_host ذخیره شد', ($map['smtp_host'] ?? '') === 'mail.hojre24shop.ir');

[$st, $j] = http('GET', '/api/v1/bootstrap');
check('bootstrap: voice روشن + web_speech + rate 1.1', ($j['voice']['enabled'] ?? null) === true && ($j['voice']['provider'] ?? '') === 'web_speech' && abs((float) ($j['voice']['rate'] ?? 0) - 1.1) < 0.001);
check('bootstrap: کانال پیامک باز شد', ($j['channels']['sms'] ?? null) === true);

// خالی‌کردن mail_transport = برگشت به .env (log) — برای بقیه‌ی تست‌ها
[$st, $j] = http('PATCH', '/api/admin/settings', ['mail_transport' => ''], $bossToken, $bossCsrf);
check('خالی‌کردن mail_transport (fallback به env) → 200', $st === 200, (string) ($j['error'] ?? ''));

/* ================= ۴) کارت‌ها — شخصی‌سازی کامل ================= */
echo "\n۴) کارت‌های بانکی (number/holder/bank/note)\n";
[$st, $j] = http('PATCH', '/api/admin/settings', ['card_numbers' => [['number' => '6037-9975 1234 5678', 'holder' => 'محمد جواد', 'bank' => 'بانک ملی', 'note' => 'کارت اصلی فروشگاه']]], $bossToken, $bossCsrf);
check('کارت کامل → 200', $st === 200, (string) ($j['error'] ?? ''));

[$st, $j] = http('GET', '/api/admin/settings', null, $bossToken);
$cardRaw = '';
foreach (($j['items'] ?? []) as $row) {
    if ($row['key'] === 'card_numbers') {
        $cardRaw = (string) $row['value'];
    }
}
$cards = json_decode($cardRaw, true);
check('ارقام کارت پاک‌سازی شد (۱۶ رقم)', is_array($cards) && ($cards[0]['number'] ?? '') === '6037997512345678');
check('یادداشت کارت حفظ شد', is_array($cards) && ($cards[0]['note'] ?? '') === 'کارت اصلی فروشگاه');

[$st] = http('PATCH', '/api/admin/settings', ['card_numbers' => [['number' => '123']]], $bossToken, $bossCsrf);
check('کارت کوتاه → 422', $st === 422);

/* ================= ۵) گیت حالت تعمیر ================= */
echo "\n۵) حالت تعمیر و نگهداری\n";
[$st] = http('PATCH', '/api/admin/settings', ['maintenance_mode' => '1'], $bossToken, $bossCsrf);
check('فعال‌سازی تعمیر → 200', $st === 200);
[$st] = http('GET', '/api/v1/bootstrap');
check('bootstrap در تعمیر → 503', $st === 503);
[$st] = http('GET', '/api/health');
check('health در تعمیر باز است', $st === 200);
[$st] = http('GET', '/api/admin/me', null, $bossToken);
check('مسیرهای ادمین در تعمیر بازند', $st === 200);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'x1@test.ir']);
check('OTP عمومی در تعمیر → 503', $st === 503);
[$st] = http('PATCH', '/api/admin/settings', ['maintenance_mode' => '0'], $bossToken, $bossCsrf);
check('خروج از تعمیر → 200', $st === 200);
[$st] = http('GET', '/api/v1/bootstrap');
check('bootstrap بعد از تعمیر → 200', $st === 200);

/* ================= ۶) گیت ثبت‌نام ================= */
echo "\n۶) گیت ثبت‌نام (api_allow_registration)\n";
[$st] = http('PATCH', '/api/admin/settings', ['api_allow_registration' => '0'], $bossToken, $bossCsrf);
check('بستن ثبت‌نام → 200', $st === 200);

[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'newuser45@test.ir']);
check('درخواست کد عمومی برای حساب جدید → 200', $st === 200, (string) ($j['error'] ?? ''));
$codeNew = lastIssued('email', 'newuser45@test.ir');
check('کد در ژورنال ثبت شد', is_string($codeNew) && preg_match('/^\d{6}$/', (string) $codeNew) === 1);
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'newuser45@test.ir', 'code' => $codeNew, 'deviceName' => 'تست']);
check('تأیید حساب جدید با ثبت‌نام بسته → 403', $st === 403 && ($j['code'] ?? '') === 'registration_closed', (string) ($j['error'] ?? ''));

[$st] = http('PATCH', '/api/admin/settings', ['api_allow_registration' => '1'], $bossToken, $bossCsrf);
check('بازکردن ثبت‌نام → 200', $st === 200);

/* ================= ۷) شورتکد OTP ادمین — ایمیل ================= */
echo "\n۷) شورتکد ورود OTP (ایمیل مالک)\n";
[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'email', 'target' => 'md1.javad401@gmail.com'], $helperToken, $helperCsrf);
check('شورتکد با نقش پشتیبان (بدون users.manage) → 403', $st === 403);

[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'email', 'target' => 'md1.javad401@gmail.com'], $bossToken, $bossCsrf);
check('درخواست کد ادمین → 200', $st === 200, (string) ($j['error'] ?? ''));
$ownerCode = (string) ($j['code'] ?? '');
check('کد مستقیماً در پاسخ ادمین است', preg_match('/^\d{6}$/', $ownerCode) === 1, $ownerCode);
check('ارسال ایمیل در حالت log انجام شد', ($j['sent']['mode'] ?? '') === 'log');

[$st, $j] = http('POST', '/api/admin/otp/verify', ['channel' => 'email', 'target' => 'md1.javad401@gmail.com', 'code' => $ownerCode], $bossToken, $bossCsrf);
check('تأیید و صدور نشست کاربر → 200', $st === 200, (string) ($j['error'] ?? ''));
check('جنسیت کاربر جدید unset است', ($j['user']['gender'] ?? '') === 'unset');
$ownerAccess = (string) ($j['accessToken'] ?? '');
check('accessToken صادر شد', strlen($ownerAccess) > 20);

[$st, $j] = http('GET', '/api/v1/me', null, $ownerAccess);
check('me با توکن کاربر مالک → 200', $st === 200 && ($j['user']['uuid'] ?? '') !== '');
check('me شامل جنسیت است', ($j['user']['gender'] ?? '') === 'unset');

[$st, $j] = http('PATCH', '/api/v1/me', ['gender' => 'male'], $ownerAccess);
check('ثبت جنسیت male → 200', $st === 200 && ($j['user']['gender'] ?? '') === 'male');

[$st, $j] = http('GET', '/api/admin/users?q=md1.javad401', null, $bossToken);
$foundGender = null;
foreach (($j['items'] ?? []) as $it) {
    if (($it['email'] ?? '') === 'md1.javad401@gmail.com') {
        $foundGender = $it['gender'] ?? null;
    }
}
check('جنسیت در لیست کاربران ادمین دیده می‌شود', $foundGender === 'male');

[$st, $j] = http('PATCH', '/api/v1/me', ['gender' => 'robot'], $ownerAccess);
check('جنسیت نامعتبر → 422', $st === 422);

/* ================= ۸) شورتکد OTP ادمین — موبایل ================= */
echo "\n۸) شورتکد ورود OTP (موبایل مالک)\n";
[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'sms', 'target' => '۰۹۳۸۹۶۵۹۹۱۰'], $bossToken, $bossCsrf);
check('درخواست با ارقام فارسی → 200 و نرمال‌سازی', $st === 200 && ($j['target'] ?? '') === '09389659910', (string) ($j['error'] ?? ''));
$smsCode = (string) ($j['code'] ?? '');
check('کد پیامکی در پاسخ ادمین است', preg_match('/^\d{6}$/', $smsCode) === 1);

[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'sms', 'target' => '12345'], $bossToken, $bossCsrf);
check('شماره نامعتبر → 422', $st === 422);

[$st, $j] = http('POST', '/api/admin/otp/verify', ['channel' => 'sms', 'target' => '09389659910', 'code' => $smsCode], $bossToken, $bossCsrf);
check('تأیید موبایل و ساخت کاربر → 200', $st === 200, (string) ($j['error'] ?? ''));
check('هویت موبایل برگشت', ($j['user']['mobile'] ?? '') === '09389659910');

[$st, $j] = http('GET', '/api/auth/channels');
check('کانال‌های عمومی: sms=true', ($j['sms'] ?? null) === true);

/* ================= ۹) شورتکد بله (با توکن آزمایشی از پنل) ================= */
echo "\n۹) شورتکد بله — توکن از تنظیمات پنل\n";
[$st, $j] = http('PATCH', '/api/admin/settings', ['bale_bot_token' => '123:TESTTOKEN', 'bale_bot_username' => 'karam_test_bot'], $bossToken, $bossCsrf);
check('ثبت توکن بله از پنل → 200', $st === 200, (string) ($j['error'] ?? ''));

[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'bale'], $bossToken, $bossCsrf);
check('ساخت بلیت از پنل → 200', $st === 200 && isset($j['ticket']) && isset($j['deepLink']), (string) ($j['error'] ?? ''));
$baleTicket = (string) ($j['ticket'] ?? '');
check('لینک بله به نام ربات پنل ساخته شد', str_contains((string) ($j['deepLink'] ?? ''), 'karam_test_bot'));

[$st, $j] = http('POST', '/api/admin/otp/verify', ['channel' => 'bale', 'ticket' => $baleTicket, 'code' => '123456'], $bossToken, $bossCsrf);
check('تأیید قبل از اتصال چت → 409', $st === 409 && ($j['code'] ?? '') === 'ticket_not_linked');

[$st] = http('PATCH', '/api/admin/settings', ['bale_bot_token' => ''], $bossToken, $bossCsrf);
check('خالی‌کردن توکن بله → 200', $st === 200);

/* ================= ۱۰) سقف سینک از تنظیمات ================= */
echo "\n۱۰) سقف سینک پویا (api_max_sync_items)\n";
[$st, $j] = http('POST', '/api/admin/otp/request', ['channel' => 'email', 'target' => 'synccap@test.ir'], $bossToken, $bossCsrf);
$capCode = (string) ($j['code'] ?? '');
[$st, $j] = http('POST', '/api/admin/otp/verify', ['channel' => 'email', 'target' => 'synccap@test.ir', 'code' => $capCode], $bossToken, $bossCsrf);
$capAccess = (string) ($j['accessToken'] ?? '');
check('کاربر تست سقف ساخته شد', $st === 200 && strlen($capAccess) > 20);

$bigLists = [];
for ($i = 0; $i < 151; $i++) {
    $bigLists[] = ['uuid' => uuid4(), 'name' => "L{$i}", 'updatedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'deletedAt' => null];
}
[$st, $j] = http('POST', '/api/v1/sync', ['changes' => ['lists' => $bigLists, 'tasks' => [], 'subtasks' => []]], $capAccess);
check('۱۵۱ آیتم با سقف ۱۵۰ → 422', $st === 422, (string) ($j['error'] ?? ''));

$okLists = array_slice($bigLists, 0, 150);
[$st, $j] = http('POST', '/api/v1/sync', ['changes' => ['lists' => $okLists, 'tasks' => [], 'subtasks' => []]], $capAccess);
check('۱۵۰ آیتم → 200', $st === 200, (string) ($j['error'] ?? ''));

/* ================= ۱۱) audit شورتکد ================= */
echo "\n۱۱) ثبت رخدادهای شورتکد در audit\n";
[$st, $j] = http('GET', '/api/admin/audit?action=otp.shortcut', null, $bossToken);
check('رخدادهای otp.shortcut ثبت شده‌اند', $st === 200 && (int) ($j['total'] ?? 0) >= 3, 'total=' . (string) ($j['total'] ?? '?'));

/* ================= نتیجه ================= */
echo "\n────────────────────────────\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
if ($fail > 0) {
    exit(1);
}
echo "همه‌ی بررسی‌های فاز ۴.۵ سبز بود ✓\n";

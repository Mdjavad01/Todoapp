<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز ۳ (احراز هویت OTP + نشست‌ها + سینک)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8098 tests/bale-mock.php      → سرور ساختگی بله
 *
 * اجرا:  php tests/phase3-test.php
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

function resetEnvironment(): void
{
    // .env محلی → مسیر دیتابیس
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

    // پاک‌سازی لاگ ایمیل و کش بله و وضعیت سرور ساختگی
    foreach ([
        ROOT . '/backend/storage/logs/mail.log',
        ROOT . '/backend/storage/cache/bale-updates.json',
        __DIR__ . '/bale-mock-state.json',
    ] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
}

function lastMailCode(string $email): ?string
{
    $file = ROOT . '/backend/storage/logs/mail.log';
    if (!is_file($file)) {
        return null;
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    for ($i = count($lines) - 1; $i >= 0; $i--) {
        $row = json_decode($lines[$i], true);
        if (is_array($row) && ($row['to'] ?? '') === $email && preg_match('/(\d{6})/u', (string) ($row['subject'] ?? ''), $m)) {
            return $m[1];
        }
    }
    return null;
}

function baleMockAddMessage(int $updateId, int $chatId, string $text): void
{
    $file = __DIR__ . '/bale-mock-state.json';
    $s = json_decode((string) @file_get_contents($file), true) ?: ['updates' => [], 'sent' => []];
    $s['updates'][] = ['update_id' => $updateId, 'message' => ['message_id' => $updateId, 'chat' => ['id' => $chatId], 'text' => $text]];
    file_put_contents($file, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function baleMockSentCount(): int
{
    $s = json_decode((string) @file_get_contents(__DIR__ . '/bale-mock-state.json'), true) ?: ['sent' => []];
    return count($s['sent'] ?? []);
}

function baleMockLastCode(int $chatId): ?string
{
    $s = json_decode((string) @file_get_contents(__DIR__ . '/bale-mock-state.json'), true) ?: ['sent' => []];
    for ($i = count($s['sent']) - 1; $i >= 0; $i--) {
        $m = $s['sent'][$i];
        if ((int) $m['chat_id'] === $chatId && preg_match('/کد ورود شما:\s*(\d{6})/u', (string) $m['text'], $mm)) {
            return $mm[1];
        }
    }
    return null;
}

/** شکل بلیت ۶ حرفی */
function isTicketFormat(string $v): bool
{
    return (bool) preg_match('/^[A-HJ-NP-Z2-9]{6}$/', $v);
}

/** خواندن یک کلید از backend/.env بدون parse_ini_file (سازگار با کامنت‌های #) */
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
        $v = trim(substr($line, $pos + 1));
        return trim($v, '"\'');
    }
    return $default;
}

/* =================setup ================= */
resetEnvironment();
echo "— آماده‌سازی: دیتابیس نو + لاگ‌ها پاک شد\n\n";

/* ================= ۱) زیرساخت ================= */
echo "۱) زیرساخت\n";
[$st, $j] = http('GET', '/api/health');
check('health → 200 و ok', $st === 200 && ($j['ok'] ?? false) === true);

[$st, $j] = http('GET', '/api/auth/channels');
check('channels → ایمیل و بله فعال + نام ربات', $st === 200 && $j['email'] === true && $j['bale'] === true && $j['botUsername'] === 'KaramTestBot');

/* ================= ۲) گیت ورود مستقیم فاز ۲ ================= */
echo "۲) ورود مستقیم بدون کد باید بسته باشد\n";
[$st, $j] = http('POST', '/api/auth/session', ['email' => 'direct@x.com']);
check('session → 403 با کد otp_required', $st === 403 && ($j['code'] ?? '') === 'otp_required');

/* ================= ۳) ورود با ایمیل ================= */
echo "۳) جریان ایمیل OTP\n";
$code1 = requestEmailCode('a@b.com');
check('درخواست کد → devCode در حالت توسعه برگشت', preg_match('/^\d{6}$/', $code1) === 1);
check('ایمیل در mail.log ثبت شد', lastMailCode('a@b.com') === $code1);

[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'a@b.com']);
check('درخواست فوری بعدی → 429 (فاصله‌ی ارسال)', $st === 429 && ($j['code'] ?? '') === 'rate_limited');
sleep(2);

[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => '000000', 'deviceUuid' => '11111111-1111-4111-8111-111111111111']);
check('کد غلط → 400 invalid', $st === 400 && ($j['code'] ?? '') === 'invalid');

[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code1, 'deviceName' => 'گوشی اصلی', 'deviceUuid' => '11111111-1111-4111-8111-111111111111']);
$tokA = $j['accessToken'] ?? null;
$refA = $j['refreshToken'] ?? null;
$devA = '11111111-1111-4111-8111-111111111111';
check('کد درست → isNew=true + هر دو توکن', $st === 200 && $j['isNew'] === true && is_string($tokA) && is_string($refA));

[$st, $j] = http('GET', '/api/v1/me', null, $tokA);
check('me → هویت ایمیل تأییدشده', $st === 200 && ($j['identities'][0]['type'] ?? '') === 'email' && ($j['identities'][0]['verifiedAt'] ?? null) !== null);

$code2 = requestEmailCode('a@b.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code1, 'deviceUuid' => $devA]);
check('استفاده‌ی دوباره از کد مصرف‌شده → رد می‌شود', $st === 400);
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code2, 'deviceUuid' => $devA]);
check('کد جدید کار می‌کند (isNew=false)', $st === 200 && $j['isNew'] === false);

/* ================= ۴) محدودسازی ارسال ================= */
echo "۴) محدودسازی درخواست کد\n";
$limitMail = 'limit@x.com';
for ($i = 0; $i < 11; $i++) {
    usleep(1_300_000); // فقط فاصله‌ی resend (۱s)
    [$st] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $limitMail]);
}
check('سقف ساعتی هر حساب → 429 (۱۰ بار مجاز، یازدهمی رد)', $st === 429);

/* ================= ۵) قفل تلاش ناموفق ================= */
echo "۵) سقف تلاش اشتباه\n";
$lockCode = requestEmailCode('lock@x.com');
sleep(2);
for ($i = 0; $i < 3; $i++) {
    [$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'lock@x.com', 'code' => '999999']);
}
check('بعد از ۳ تلاش غلط → قفل (locked)', $st === 400 && ($j['code'] ?? '') === 'locked');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'lock@x.com', 'code' => $lockCode]);
check('کد درست هم دیگر پذیرفته نمی‌شود', $st === 400);
sleep(2);
$lockCode2 = requestEmailCode('lock@x.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'lock@x.com', 'code' => $lockCode2]);
check('با کد جدید دوباره می‌شود وارد شد', $st === 200);

/* ================= ۶) انقضای کد ================= */
echo "۶) انقضای کد\n";
$expCode = requestEmailCode('exp@x.com');
$pdo = new PDO('sqlite:' . envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3'), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec("UPDATE otp_requests SET expires_at = '2000-01-01 00:00:00' WHERE identity_value = 'exp@x.com'");
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'exp@x.com', 'code' => $expCode]);
check('کد منقضی → expired', $st === 400 && ($j['code'] ?? '') === 'expired');

/* ================= ۷) پروفایل و نشست‌ها ================= */
echo "۷) پروفایل، دستگاه دوم، چرخش توکن\n";
sleep(2);
$code3 = requestEmailCode('a@b.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code3, 'deviceUuid' => $devA]);
$tokA = $j['accessToken'] ?? $tokA;
$refA = $j['refreshToken'] ?? $refA;

[$st, $j] = http('PATCH', '/api/v1/me', ['displayName' => 'علی رضایی'], $tokA);
check('تغییر نام نمایشی', $st === 200 && ($j['user']['displayName'] ?? '') === 'علی رضایی');

[$st, $j] = http('GET', '/api/v1/me/sessions?deviceUuid=' . $devA, null, $tokA);
$sessionAId = $j['sessions'][0]['id'] ?? 0;
check('نشست‌های دستگاه اول + علامت current (هر ورود = یک نشست)',
    $st === 200 && count($j['sessions'] ?? []) === 3
    && ($j['sessions'][0]['current'] ?? false) === true && ($j['sessions'][2]['current'] ?? false) === true);

sleep(2);
$code4 = requestEmailCode('a@b.com');
$devB = '22222222-2222-4222-8222-222222222222';
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code4, 'deviceName' => 'تبلت', 'deviceUuid' => $devB]);
$tokB = $j['accessToken'] ?? null;
$refB = $j['refreshToken'] ?? null;
check('ورود دستگاه دوم', $st === 200 && is_string($refB));

[$st, $j] = http('GET', '/api/v1/me/sessions?deviceUuid=' . $devB, null, $tokB);
$curCount = 0;
foreach (($j['sessions'] ?? []) as $s) {
    if ($s['current'] === true) {
        $curCount++;
    }
}
check('چهار نشست فعال — فقط دستگاه جاری علامت خورده', $st === 200 && count($j['sessions'] ?? []) === 4 && $curCount === 1);

// چرخش: توکن A جدید می‌شود
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refA]);
$refA2 = $j['refreshToken'] ?? null;
check('چرخش refresh → توکن جدید', $st === 200 && is_string($refA2) && $refA2 !== $refA);

// استفاده‌ی مجدد از توکن چرخیده = سرقت → همه باطل
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refA]);
check('استفاده‌ی مجدد از توکن باطل → 401', $st === 401);
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refB]);
check('توکن دستگاه دوم هم در واکنش به سرقت باطل شد', $st === 401);
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refA2]);
check('توکن چرخیده‌ی تازه هم باطل شده است', $st === 401);
[$st, $j] = http('GET', '/api/v1/me/sessions', null, $tokB);
check('فهرست نشست‌ها خالی شد', $st === 200 && count($j['sessions'] ?? []) === 0);
[$st, $j] = http('GET', '/api/v1/me', null, $tokB);
check('توکن دسترسی (بی‌حالت) تا انقضا هنوز معتبر است — رفتار مستند', $st === 200);

// ورود مجدد و خروج
sleep(2);
$code5 = requestEmailCode('a@b.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code5, 'deviceUuid' => $devA]);
$tokA = $j['accessToken'] ?? null;
$refA = $j['refreshToken'] ?? null;
check('ورود مجدد بعد از ابطال سراسری', $st === 200);

[$st, $j] = http('POST', '/api/auth/logout', ['refreshToken' => $refA]);
check('خروج → ok', $st === 200);
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refA]);
check('بعد از خروج، refresh رد می‌شود', $st === 401);

// حذف نشست با شناسه
sleep(2);
$code6 = requestEmailCode('a@b.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code6, 'deviceUuid' => $devA]);
$tokA = $j['accessToken'] ?? null;
sleep(2);
$code7 = requestEmailCode('a@b.com');
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com', 'code' => $code7, 'deviceName' => 'تبلت', 'deviceUuid' => $devB]);
$tokB = $j['accessToken'] ?? null;
[$st, $j] = http('GET', '/api/v1/me/sessions', null, $tokB);
[$st, $j] = http('GET', '/api/v1/me/sessions?deviceUuid=' . $devA, null, $tokB);
$otherId = null;
foreach (($j['sessions'] ?? []) as $s) {
    if ($s['deviceId'] === $devA) {
        $otherId = (int) $s['id'];
    }
}
check('حذف نشست دیگر با توکن خودم مجاز است', $otherId !== null);
[$st, $j] = http('DELETE', '/api/v1/me/sessions/' . $otherId, null, $tokB);
check('DELETE session → revoked', $st === 200 && ($j['revoked'] ?? false) === true);
[$st, $j] = http('DELETE', '/api/v1/me/sessions/' . $otherId, null, $tokB);
check('حذف دوباره → 404', $st === 404);

/* ================= ۸) رگرسیون سینک فاز ۲ ================= */
echo "۸) رگرسیون CRUD و سینک\n";
$listId = 'aaaaaaaa-0000-4000-8000-000000000001';
[$st, $j] = http('POST', '/api/v1/lists', ['id' => $listId, 'name' => 'شخصی', 'emoji' => '🏠', 'color' => 'teal', 'updatedAt' => gmdate('Y-m-d\TH:i:s\Z')], $tokB);
check('ساخت لیست', $st === 201 && ($j['lists']['id'] ?? '') === $listId);
[$st, $j] = http('GET', '/api/v1/lists', null, $tokB);
check('فهرست لیست‌ها شامل لیست جدید', $st === 200 && count($j['lists'] ?? []) === 1);
[$st, $j] = http('POST', '/api/v1/sync', ['cursor' => null, 'changes' => ['lists' => [], 'tasks' => [], 'subtasks' => []]], $tokB);
check('سینک خالی → cursor برگشت', $st === 200 && isset($j['cursor']));

/* ================= ۹) ورود با بله ================= */
echo "۹) جریان بله\n";
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'bale']);
$ticket = $j['ticket'] ?? '';
check('درخواست بله → بلیت + لینک ble.ir', $st === 200 && isTicketFormat($ticket) && str_contains($j['deepLink'] ?? '', 'ble.ir/KaramTestBot'));

[$st, $j] = http('POST', '/api/auth/otp/bale/poll', ['ticket' => $ticket]);
check('poll اول → pending', $st === 200 && ($j['status'] ?? '') === 'pending');

baleMockAddMessage(1, 99118822, '/start ' . $ticket);
sleep(3); // کش ۲ ثانیه‌ای getUpdates باید منقضی شود
[$st, $j] = http('POST', '/api/auth/otp/bale/poll', ['ticket' => $ticket]);
check('بعد از پیام کاربر → code_sent', $st === 200 && ($j['status'] ?? '') === 'code_sent');

$baleCode = baleMockLastCode(99118822);
check('ربات کد ۶ رقمی به چت فرستاد', preg_match('/^\d{6}$/', (string) $baleCode) === 1);

[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'bale', 'ticket' => $ticket, 'code' => '111111', 'deviceUuid' => '33333333-3333-4333-8333-333333333333']);
check('کد غلط بله → رد', $st === 400);
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'bale', 'ticket' => $ticket, 'code' => $baleCode, 'deviceName' => 'بله', 'deviceUuid' => '33333333-3333-4333-8333-333333333333']);
$tokC = $j['accessToken'] ?? null;
check('کد درست بله → isNew=true + توکن', $st === 200 && $j['isNew'] === true && is_string($tokC));
[$st, $j] = http('GET', '/api/v1/me', null, $tokC);
$hasBale = false;
foreach (($j['identities'] ?? []) as $idn) {
    if ($idn['type'] === 'bale_chat_id' && $idn['value'] === '99118822') {
        $hasBale = true;
    }
}
check('me → هویت bale_chat_id تأییدشده', $hasBale);

// پیام ناشناخته → راهنمایی، بدون خطا
$sentBefore = baleMockSentCount();
baleMockAddMessage(2, 99118822, 'ZZZZZZ');
sleep(3);
[$st, $j] = http('POST', '/api/auth/otp/bale/poll', ['ticket' => $ticket]);
check('poll با پیام ناشناخته → خطا نمی‌دهد و راهنمایی می‌فرستد', $st === 200 && baleMockSentCount() === $sentBefore + 1);

// ورود دوم با بله برای همان چت
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'bale']);
$ticket2 = $j['ticket'] ?? '';
check('بلیت دوم برای همان چت', $st === 200 && $ticket2 !== '' && $ticket2 !== $ticket);
baleMockAddMessage(3, 99118822, $ticket2);
sleep(3);
[$st, $j] = http('POST', '/api/auth/otp/bale/poll', ['ticket' => $ticket2]);
check('poll دوم → code_sent', ($j['status'] ?? '') === 'code_sent');
$baleCode2 = baleMockLastCode(99118822);
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'bale', 'ticket' => $ticket2, 'code' => $baleCode2]);
check('ورود دوم بله → isNew=false (همان کاربر)', $st === 200 && $j['isNew'] === false);

/* ================= ۱۰) اعتبارسنجی ورودی ================= */
echo "۱۰) اعتبارسنجی\n";
[$st] = http('POST', '/api/auth/otp/request', ['channel' => 'sms', 'target' => '0912']);
check('کانال نامعتبر → 422', $st === 422);
[$st] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'not-an-email']);
check('ایمیل نامعتبر → 422', $st === 422);
[$st] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'a@b.com']);
check('verify بدون کد → 422', $st === 422);
[$st, $j] = http('GET', '/api/v1/me');
check('me بدون توکن → 401', $st === 401);
[$st] = http('POST', '/api/auth/refresh', ['refreshToken' => str_repeat('x', 64)]);
check('refresh نامعتبر → 401', $st === 401);
[$st, $j] = http('POST', '/api/auth/logout', []);
check('logout بدون توکن → ok بی‌اثر', $st === 200 && ($j['loggedOut'] ?? false) === true);
[$st] = http('GET', '/api/nope');
check('مسیر ناشناخته → 404', $st === 404);

/* ================= نتیجه ================= */
echo "\n———————————————\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

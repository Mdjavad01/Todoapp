<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز ۵ (تلگرام OTP + پرداخت زیبال + اشتراک)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8097 tests/zibal-mock.php     → درگاه ساختگی زیبال
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php  → سرور ساختگی تلگرام
 *
 * اجرا:  php tests/phase5-test.php
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
    [$st, $j] = httpRaw($method, $path, $body, $token);
    return [$st, $j];
}

/** @return array{0:int,1:array|null,2:array<string,string>} */
function httpRaw(string $method, string $path, ?array $body = null, ?string $token = null): array
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
        CURLOPT_HEADER => true,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    $resp = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $rawHeaders = $resp === false ? '' : substr((string) $resp, 0, $headerSize);
    $rawBody = $resp === false ? '' : substr((string) $resp, $headerSize);
    $headersMap = [];
    foreach (explode("\r\n", $rawHeaders) as $h) {
        $pos = strpos($h, ':');
        if ($pos !== false) {
            $headersMap[strtolower(trim(substr($h, 0, $pos)))] = trim(substr($h, $pos + 1));
        }
    }
    $json = trim($rawBody) === '' ? null : json_decode($rawBody, true);
    return [$status, is_array($json) ? $json : null, $headersMap];
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

function loginEmail(string $email, string $deviceUuid): string
{
    $code = requestEmailCode($email);
    [$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => $email, 'code' => $code, 'deviceUuid' => $deviceUuid]);
    if ($st !== 200) {
        fwrite(STDERR, "ورود {$email} ناموفق بود: {$st}\n");
        exit(1);
    }
    return (string) $j['accessToken'];
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

    foreach ([
        ROOT . '/backend/storage/logs/mail.log',
        ROOT . '/backend/storage/cache/telegram-updates.json',
        __DIR__ . '/telegram-mock-state.json',
        __DIR__ . '/zibal-mock-state.json',
    ] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
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
        $v = trim(substr($line, $pos + 1));
        return trim($v, '"\'');
    }
    return $default;
}

/** مقدار یک کلید از تنظیمات (برای تغییر وضعیت درگاه در تست) */
function setSetting(string $key, string $value): void
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $st = $pdo->prepare("INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, strftime('%Y-%m-%d %H:%M:%S','now'))
                         ON CONFLICT(key) DO UPDATE SET value = :v2");
    $st->execute([':k' => $key, ':v' => $value, ':v2' => $value]);
}

/** premium_until کاربر از دیتابیس — برای چک کردن اثر مضاعف/تمدید */
function userPremiumUntil(string $email): ?string
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $st = $pdo->prepare('SELECT u.premium_until FROM users u JOIN user_identities i ON i.user_id = u.id WHERE i.type = :t AND i.value = :v LIMIT 1');
    $st->execute([':t' => 'email', ':v' => $email]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string) $v;
}

/* ================= setup ================= */
resetEnvironment();
echo "— آماده‌سازی: دیتابیس نو + لاگ‌ها و مک‌ها پاک شد\n\n";

/* ================= ۱) زیرساخت و پلن‌ها ================= */
echo "۱) سلامت سرویس و پلن‌ها\n";
[$st, $j] = http('GET', '/api/health');
check('health → 200 و ok', $st === 200 && ($j['ok'] ?? false) === true);

[$st, $j] = http('GET', '/api/v1/plans');
$plans = $j['plans'] ?? [];
check('پلن‌های فعال از سرور → ۳ پلن', $st === 200 && count($plans) === 3, (string) count($plans));
$annual = null;
foreach ($plans as $p) {
    if ($p['code'] === 'annual') {
        $annual = $p;
    }
}
check('پلن سالانه با قیمت ۱٫۹۰۰٫۰۰۰ ریال', $annual !== null && (int) $annual['priceRials'] === 1900000 && (int) $annual['months'] === 12);

/* ================= ۲) ورود کاربر خریدار ================= */
echo "\n۲) ورود کاربر\n";
$buyerEmail = 'buyer5@test.ir';
$tok = loginEmail($buyerEmail, '55555555-5555-4555-8555-555555555555');
check('ورود با ایمیل → توکن', is_string($tok) && $tok !== '');

[$st, $j] = http('GET', '/api/v1/me/subscription', null, $tok);
check('اشتراک اولیه → پرو نیست', $st === 200 && ($j['subscription']['isPremium'] ?? false) === false);

/* ================= ۳) ساخت سفارش و رفتن به درگاه ================= */
echo "\n۳) سفارش و درگاه\n";
[$st] = http('POST', '/api/v1/payments/orders', ['planCode' => 'annual']);
check('ساخت سفارش بدون ورود → 401', $st === 401);

[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'nope']);
check('پلن ناشناخته → 404', $st === 404);

[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'annual'], $tok);
$orderUuid = (string) ($j['orderUuid'] ?? '');
$trackId = (string) ($j['trackId'] ?? '');
$payUrl = (string) ($j['payUrl'] ?? '');
check('ساخت سفارش → orderUuid + trackId + payUrl', $st === 200 && $orderUuid !== '' && $trackId !== '' && str_contains($payUrl, '8097/' . $trackId));

[$st, $j] = http('GET', '/api/v1/payments/orders/' . $orderUuid, null, $tok);
check('وضعیت سفارش بعد از ریدایرکت → redirected', $st === 200 && ($j['order']['status'] ?? '') === 'redirected');

/* ================= ۴) بازگشت ناموفق (لغو) ================= */
echo "\n۴) لغو پرداخت\n";
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $trackId . '&success=0&status=3&orderId=' . $orderUuid);
$loc = $h['location'] ?? '';
check('callback لغو → ریدایرکت با state=failed', $st === 302 && str_contains($loc, 'payResult=' . $orderUuid) && str_contains($loc, 'state=failed'), $loc);

[$st, $j] = http('GET', '/api/v1/payments/orders/' . $orderUuid, null, $tok);
check('سفارش بعد از لغو → failed', $st === 200 && ($j['order']['status'] ?? '') === 'failed');

/* ================= ۵) خرید موفق + فعال شدن اشتراک ================= */
echo "\n۵) پرداخت موفق\n";
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'annual'], $tok);
$order2 = (string) ($j['orderUuid'] ?? '');
$track2 = (string) ($j['trackId'] ?? '');
check('سفارش دوم ساخته شد', $st === 200 && $order2 !== '' && $track2 !== '');

[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track2 . '&success=1&status=1&orderId=' . $order2);
$loc = $h['location'] ?? '';
check('callback موفق → ریدایرکت با state=succeeded', $st === 302 && str_contains($loc, 'state=succeeded'), $loc);

[$st, $j] = http('GET', '/api/v1/me/subscription', null, $tok);
$sub = $j['subscription'] ?? [];
check('اشتراک فعال شد → isPremium + plan annual + source web_gateway', $st === 200
    && ($sub['isPremium'] ?? false) === true
    && (($sub['plan']['code'] ?? '') === 'annual')
    && (($sub['source'] ?? '') === 'web_gateway'));
check('پول سالانه → حدود ۳۶۰ روز باقی‌مانده', ($sub['daysLeft'] ?? 0) >= 355 && ($sub['daysLeft'] ?? 0) <= 362, (string) ($sub['daysLeft'] ?? 'null'));

[$st, $j] = http('GET', '/api/v1/payments/orders/' . $order2, null, $tok);
check('وضعیت سفارش → paid', $st === 200 && ($j['order']['status'] ?? '') === 'paid');

/* ================= ۶) callback تکراری (اثر مضاعف ندارد) ================= */
echo "\n۶) idempotency\n";
$before = userPremiumUntil($buyerEmail);
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track2 . '&success=1&status=1&orderId=' . $order2);
$after = userPremiumUntil($buyerEmail);
check('callback تکراری → باز هم succeeded', $st === 302 && str_contains($h['location'] ?? '', 'state=succeeded'));
check('premium_until تغییر نکرد (بدون اثر مضاعف)', $before === $after, "{$before} → {$after}");

/* ================= ۷) callback جعلی (trackId سفارش دیگر) ================= */
echo "\n۷) ضد جعل\n";
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order3 = (string) ($j['orderUuid'] ?? '');
$track3 = (string) ($j['trackId'] ?? '');
check('سفارش سوم (ماهانه) ساخته شد', $st === 200 && $order3 !== '');

// trackId سفارشِ پرداخت‌شده‌ی قبلی را برای سفارش جدید ادعا می‌کنیم
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track2 . '&success=1&status=1&orderId=' . $order3);
check('trackId ناهم‌خوان → state=failed', $st === 302 && str_contains($h['location'] ?? '', 'state=failed'), (string) ($h['location'] ?? ''));

[$st, $j] = http('GET', '/api/v1/payments/orders/' . $order3, null, $tok);
check('سفارش سوم failed ماند', ($j['order']['status'] ?? '') === 'failed');

/* ================= ۸) دیتای کاربر دیگر ================= */
echo "\n۸) جداسازی کاربران\n";
$otherTok = loginEmail('other5@test.ir', '66666666-6666-4666-8666-666666666666');
[$st] = http('GET', '/api/v1/payments/orders/' . $order2, null, $otherTok);
check('سفارشِ کاربر دیگر برای من → 404', $st === 404);
[$st, $j] = http('GET', '/api/v1/me/subscription', null, $otherTok);
check('کاربر دیگر پرو نیست', ($j['subscription']['isPremium'] ?? true) === false);

/* ================= ۹) خاموشی درگاه از تنظیمات ================= */
echo "\n۹) گیت درگاه\n";
setSetting('gateway_zibal_enabled', '0');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
check('درگاه خاموش → 503', $st === 503, (string) $st);
setSetting('gateway_zibal_enabled', '1');

/* ================= ۱۰) لاگ پروایدر ================= */
echo "\n۱۰) provider_logs\n";
$dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
$pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$n = (int) $pdo->query("SELECT COUNT(*) FROM provider_logs WHERE provider = 'zibal'")->fetchColumn();
check('رفت‌وبرگشت درگاه در provider_logs ثبت شد', $n >= 4, (string) $n);

/* ================= نتیجه ================= */
echo "\n———————————————\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

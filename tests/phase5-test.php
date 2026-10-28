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
function http(string $method, string $path, ?array $body = null, ?string $token = null, array $extraHeaders = []): array
{
    [$st, $j] = httpRaw($method, $path, $body, $token, $extraHeaders);
    return [$st, $j];
}

/** @return array{0:int,1:array|null,2:array<string,string>} */
function httpRaw(string $method, string $path, ?array $body = null, ?string $token = null, array $extraHeaders = []): array
{
    $ch = curl_init(BASE . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    foreach ($extraHeaders as $h) {
        $headers[] = $h; // مثل 'X-App-Platform: android' (گام ۲)
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

    // گام ۱ — کش فایلی تنظیمات (v17) هم باید پاک شود؛ وگرنه سرور مقادیر ران قبلی را
    // از کش می‌خواند (TTL ۱۰ دقیقه) و گیت‌هایی مثل «درگاه خاموش» بی‌اثر می‌شوند
    foreach (glob(ROOT . '/backend/storage/cache/k_*.json') ?: [] as $f) {
        @unlink($f);
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
    // گام ۱ — باطل‌سازی کش فایلی تنظیمات سرور (وگرنه تا ۱۰ دقیقه مقدار کهنه خوانده می‌شود)
    foreach (glob(ROOT . '/backend/storage/cache/k_*.json') ?: [] as $f) {
        @unlink($f);
    }
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

/** گام ۱ — ست/برداشتن فلگ در state سرور ساختگی زیبال (مثل verifyOmitAmount) */
function setMockFlag(string $key, bool $value): void
{
    $f = __DIR__ . '/zibal-mock-state.json';
    $s = json_decode((string) @file_get_contents($f), true);
    if (!is_array($s)) {
        $s = [];
    }
    $s[$key] = $value;
    file_put_contents($f, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/* ================= setup ================= */
resetEnvironment();
// گام ۱ — دوره‌ی آزمایشی v18 در سید SQLite روشن است (برای تست دستی)؛ این تست
// باید مستقل از آن باشد («کاربر دیگر پرو نیست») — پس قطع می‌کنیم
setSetting('trial_enabled', '0');
echo "— آماده‌سازی: دیتابیس نو + لاگ‌ها و مک‌ها و کش پاک شد\n\n";

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
check('پلن سالانه با قیمت ۱۹۰٬۰۰۰ تومان', $annual !== null && (int) $annual['priceTomans'] === 190000 && (int) $annual['months'] === 12);

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

// گام ۱ — این درخواست باید احرازشده باشد (بدون توکن، گیت ورود زودتر 401 می‌دهد)
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'nope'], $tok);
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

/* ================= ۷.۵) verify بدون amount → fail-closed (گام ۱) ================= */
echo "\n۷.۵) fail-closed مبلغ زیبال\n";
setMockFlag('verifyOmitAmount', true);
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order4 = (string) ($j['orderUuid'] ?? '');
$track4 = (string) ($j['trackId'] ?? '');
check('سفارش چهارم ساخته شد', $st === 200 && $order4 !== '' && $track4 !== '');

// درگاه verify موفق (result=100) ولی بدون فیلد amount — سرور باید تأیید را رد کند
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track4 . '&success=1&status=1&orderId=' . $order4);
check('verify بدون amount → state=failed', $st === 302 && str_contains($h['location'] ?? '', 'state=failed'), (string) ($h['location'] ?? ''));

[$st, $j] = http('GET', '/api/v1/payments/orders/' . $order4, null, $tok);
check('سفارش بدون amount → failed ماند', ($j['order']['status'] ?? '') === 'failed');

setMockFlag('verifyOmitAmount', false);
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order5 = (string) ($j['orderUuid'] ?? '');
$track5 = (string) ($j['trackId'] ?? '');
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track5 . '&success=1&status=1&orderId=' . $order5);
check('بعد از رفع حالت → دوباره state=succeeded', $st === 302 && str_contains($h['location'] ?? '', 'state=succeeded'), (string) ($h['location'] ?? ''));

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

/* ================= ۹.۵) کلید خاموش‌کردن پرداخت‌ها (گام ۲) ================= */
echo "\n۹.۵) کلید پرداخت‌ها (۶ سناریو)\n";

// بازگردانی به حالت پایه: همه‌ی کلیدها روشن + هر دو روش (زیبال از بخش ۹ روشن است؛ کارت هم روشن سید)
setSetting('payments_master_enabled', '1');
setSetting('payments_enabled_web', '1');
setSetting('payments_enabled_android', '1');
setSetting('payments_disabled_message', '');
setSetting('deposit_card_enabled', '1');

// --- S1: پیش‌فرض — همه روشن → config می‌گوید effective=true ---
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok);
check('S1: config پیش‌فرض → effective=true + کد هدیه مستقل روشن', $st === 200
    && ($j['payments']['effective'] ?? null) === true
    && ($j['payments']['giftCodesEnabled'] ?? null) === true
    && ($j['payments']['platform'] ?? '') === 'web');

// --- S2: کلید اصلی خاموش → شروع سفارش و واریز ۴۰۳ payments_disabled + پیام سفارشی؛
//        کارت‌به‌کارت config هم شماره کارت را لو نمی‌دهد ---
setSetting('payments_disabled_message', 'فروش موقتاً بسته است');
setSetting('payments_master_enabled', '0');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
check('S2: master خاموش → createOrder ۴۰۳ code=payments_disabled', $st === 403 && ($j['code'] ?? '') === 'payments_disabled', (string) $st);
[$st, $j] = http('POST', '/api/v1/payments/deposit/requests', ['planCode' => 'monthly', 'reference' => '987654321'], $tok);
check('S2: master خاموش → واریز هم ۴۰۳ payments_disabled', $st === 403 && ($j['code'] ?? '') === 'payments_disabled', (string) $st);
[$st, $j] = http('GET', '/api/v1/payments/deposit/config', null, $tok);
check('S2: master خاموش → کارت‌به‌کارت config enabled=false (بدون شماره کارت)', $st === 200 && ($j['enabled'] ?? true) === false && !isset($j['card']));
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok);
check('S2: config → effective=false + پیام سفارشی', ($j['payments']['effective'] ?? null) === false
    && ($j['payments']['message'] ?? '') === 'فروش موقتاً بسته است');
setSetting('payments_master_enabled', '1');
setSetting('payments_disabled_message', '');

// --- S3: فقط وب خاموش (اندروید روشن) → بدون هدر ۴۰۳؛ با هدر اندروید سفارش ساخته می‌شود ---
setSetting('payments_enabled_web', '0');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
check('S3: فقط وب خاموش (بدون هدر = وب) → ۴۰۳', $st === 403 && ($j['code'] ?? '') === 'payments_disabled', (string) $st);
[$st] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok, ['X-App-Platform: android']);
check('S3: همان درخواست با هدر اندروید → ۲۰۰ (سفارش ساخته شد)', $st === 200, (string) $st);
setSetting('payments_enabled_web', '1');

// --- S4: فقط اندروید خاموش → با هدر اندروید ۴۰۳؛ وب (بدون هدر) ۲۰۰ ---
setSetting('payments_enabled_android', '0');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok, ['X-App-Platform: android']);
check('S4: فقط اندروید خاموش + هدر اندروید → ۴۰۳', $st === 403 && ($j['code'] ?? '') === 'payments_disabled', (string) $st);
[$st] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
check('S4: وب (بدون هدر) → ۲۰۰', $st === 200, (string) $st);
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok, ['X-App-Platform: android']);
check('S4: config اندروید → platform=android + effective=false', $st === 200
    && ($j['payments']['platform'] ?? '') === 'android'
    && ($j['payments']['effective'] ?? null) === false);
setSetting('payments_enabled_android', '1');

// --- S5: هر دو روش پرداخت خاموش ولی کلیدها روشن → باز هم ۴۰۳ (effective=false) ---
setSetting('gateway_zibal_enabled', '0');
setSetting('deposit_card_enabled', '0');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
check('S5: بدون روش فعال (کلیدها روشن) → ۴۰۳', $st === 403 && ($j['code'] ?? '') === 'payments_disabled', (string) $st);
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok);
check('S5: config → anyMethodEnabled=false', ($j['payments']['anyMethodEnabled'] ?? null) === false);
setSetting('gateway_zibal_enabled', '1');

// --- S6: استثناها — سفارش موجود / callback / کد هدیه / اشتراک بعد از بستن پرداخت سالم می‌مانند ---
setSetting('payments_master_enabled', '0');
[$st] = http('GET', '/api/v1/payments/orders/' . $order5, null, $tok);
check('S6: وضعیت سفارش موجود بعد از بستن پرداخت → ۲۰۰ (استثنا)', $st === 200, (string) $st);
[$st] = http('GET', '/api/v1/payments/gift/quote?code=NOROOZ1404&plan=monthly', null, $tok);
check('S6: استعلام کد هدیه بعد از بستن پرداخت → ۲۰۰ (کلید مستقل)', $st === 200, (string) $st);
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $track5 . '&success=0&status=3&orderId=' . $order5);
check('S6: callback سفارشِ پرداخت‌شده بعد از بستن پرداخت → ۳۰۲ succeeded (استثنا)', $st === 302 && str_contains($h['location'] ?? '', 'state=succeeded'), (string) $st);
[$st, $j] = http('GET', '/api/v1/me/subscription', null, $tok);
check('S6: پروِ فعلی دست‌نخورده → isPremium=true', $st === 200 && ($j['subscription']['isPremium'] ?? false) === true);
setSetting('payments_master_enabled', '1');
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok);
check('بازگردانی: config دوباره effective=true', ($j['payments']['effective'] ?? null) === true);

/* ================= ۹.۶) کلید مستقل کد هدیه (gift_codes_enabled) ================= */
echo "\n۹.۶) کلید کد هدیه (گیت استعلام + گیت ثبت — مستقل از پرداخت)\n";

// کد هدیه تستی را مستقیم در دیتابیس می‌سازیم (ساخت/مدیریت کدها کار تب «کدهای هدیه» پنل است)
$dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
$pdoGift = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$redemptionCount = static function () use ($pdoGift): int {
    return (int) $pdoGift->query('SELECT COUNT(*) FROM coupon_redemptions')->fetchColumn();
};
$pdoGift->prepare(
    "INSERT INTO coupons (uuid, code, type, value, expires_at, max_uses, used_count, is_active, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'KARAMTEST', 'amount', 10000, NULL, NULL, 0, 1,
             strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))"
)->execute();

// --- G1: کلید کد هدیه خاموش (پرداخت روشن) → استعلام ۲۰۰ ولی valid=false؛ config هر دو وضعیت را درست می‌گوید
setSetting('gift_codes_enabled', '0');
[$st, $j] = http('GET', '/api/v1/payments/gift/quote?code=KARAMTEST&plan=monthly', null, $tok);
check('G1: کلید کد هدیه خاموش → استعلام ۲۰۰ valid=false + پیام «غیرفعال»', $st === 200
    && ($j['valid'] ?? true) === false
    && str_contains((string) ($j['error'] ?? ''), 'غیرفعال'), (string) json_encode($j, JSON_UNESCAPED_UNICODE));
[$st, $j] = http('GET', '/api/v1/payments/config', null, $tok);
check('G1: config → giftCodesEnabled=false ولی effective=true (استقلال دوطرفه)', ($j['payments']['giftCodesEnabled'] ?? null) === false
    && ($j['payments']['effective'] ?? null) === true);

// --- G2: گیت «ثبت» — سفارش با کد وقتی کلید روشن است ساخته می‌شود؛ خاموشی قبل از callback →
//        پرداخت سالم succeeded ولی ژورنال استفاده ثبت نمی‌شود
setSetting('gift_codes_enabled', '1');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly', 'giftCode' => 'KARAMTEST'], $tok);
$orderG = (string) ($j['orderUuid'] ?? '');
$trackG = (string) ($j['trackId'] ?? '');
check('G2: سفارش با کد هدیه → تخفیف ۱۰٬۰۰۰ تومان (۴۹ هزار → ۳۹ هزار)', $st === 200 && $orderG !== ''
    && (int) ($j['amountTomans'] ?? 0) === 39000
    && (int) ($j['discountTomans'] ?? 0) === 10000
    && ($j['couponCode'] ?? '') === 'KARAMTEST', (string) json_encode($j, JSON_UNESCAPED_UNICODE));

setSetting('gift_codes_enabled', '0');
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $trackG . '&success=1&status=1&orderId=' . $orderG);
check('G2: callback با کلید کد هدیه خاموش → باز هم state=succeeded (پرداخت سالم می‌ماند)', $st === 302 && str_contains($h['location'] ?? '', 'state=succeeded'), (string) ($h['location'] ?? ''));
check('G2: ژورنال استفاده ثبت نشد (گیت مسیر ثبت)', $redemptionCount() === 0, (string) $redemptionCount());
[$st, $j] = http('GET', '/api/v1/payments/orders/' . $orderG, null, $tok);
check('G2: خود سفارش عادی paid شد', ($j['order']['status'] ?? '') === 'paid');

// --- G3: روشن‌کردن دوباره کلید → چون ثبت قبلی انجام نشده بود، همان کد برای همان کاربر دوباره کار می‌کند
setSetting('gift_codes_enabled', '1');
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly', 'giftCode' => 'KARAMTEST'], $tok);
$orderG2 = (string) ($j['orderUuid'] ?? '');
$trackG2 = (string) ($j['trackId'] ?? '');
check('G3: با کلید روشن، همان کد دوباره به سفارش می‌خورد (ثبت قبلی انجام نشده بود)', $st === 200 && $orderG2 !== '', (string) $st);
[$st, , $h] = httpRaw('GET', '/api/payments/callback?trackId=' . $trackG2 . '&success=1&status=1&orderId=' . $orderG2);
check('G3: callback دوم → succeeded', $st === 302 && str_contains($h['location'] ?? '', 'state=succeeded'), (string) ($h['location'] ?? ''));
$usedCount = (int) $pdoGift->query("SELECT used_count FROM coupons WHERE code = 'KARAMTEST'")->fetchColumn();
check('G3: ژورنال این‌بار ثبت شد + used_count=1', $redemptionCount() === 1 && $usedCount === 1, "redemptions={$redemptionCount()} used={$usedCount}");
[$st, $j] = http('GET', '/api/v1/payments/gift/quote?code=KARAMTEST&plan=monthly', null, $tok);
check('G3: استعلام دوباره همان کد → valid=false (هر کاربر هر کد فقط یک‌بار)', ($j['valid'] ?? true) === false);

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

<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز تومان (واحد پول سراسری = تومان صحیح)
 *
 * پوشش:
 *   ۱) Format::toman — قرارداد واحد سه‌سمته (اپ/پنل/سرور) با نمونه‌های قراردادی
 *   ۲) API پلن‌ها — priceTomans (واحد اصلی) + آینه‌ی قدیمی priceRials = ×۱۰ (سازگاری APK قدیمی)
 *   ۳) نقطه‌ی یکتای تبدیل درگاه: مبلغِ رسیده به زیبال = تومان × ۱۰ (ریال)
 *   ۴) callback موفق — تطبیق هم‌واحد تومان در verify + فعال‌سازی اشتراک
 *   ۵) fail-closed — مبلغ دستکاری‌شده در verify → failed
 *   ۶) fail-closed — verify بدون amount → failed
 *   ۷) کد هدیه درصدی و مبلغ ثابت (تومان) + کف امن ۱۰۰ تومان
 *   ۸) واریز کارت‌به‌کارت — amountTomans + آینه‌ی قدیمی
 *
 * پیش‌نیاز اجرا (همان phase5):
 *   php -S 127.0.0.1:8099 -t backend/public
 *   php -S 127.0.0.1:8097 tests/zibal-mock.php
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php
 *
 * اجرا:  php tests/phase-toman-test.php
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

/* ---------- ۱) Format::toman — قرارداد واحد (بدون نیاز به سرور) ---------- */

echo "۱) Format::toman — قرارداد واحد سه‌سمته\n";
require_once ROOT . '/backend/src/Support/Format.php';
$samples = [
    [990, '۹۹۰ تومان'],
    [1000, '۱ هزار تومان'],
    [49_000, '۴۹ هزار تومان'],
    [490_000, '۴۹۰ هزار تومان'],
    [49_500, '۴۹٬۵۰۰ تومان'],
    [1_000_000, '۱ میلیون تومان'],
    [1_200_000, '۱٫۲ میلیون تومان'],
    [1_500_000, '۱٫۵ میلیون تومان'],
    [1_234_567, '۱٬۲۳۴٬۵۶۷ تومان'],
    [0, '۰ تومان'],
    [-5, '۰ تومان'],
];
foreach ($samples as [$in, $want]) {
    $got = Format::toman($in);
    check("toman({$in}) → «{$want}»", $got === $want, "گرفته شد: «{$got}»");
}

/* ---------- زیرساخت تست (همان الگوی phase5) ---------- */

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
        CURLOPT_HEADER => true,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    $resp = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $raw = $resp === false ? '' : (string) substr((string) $resp, $headerSize);
    $j = trim($raw) === '' ? null : json_decode($raw, true);
    return [$status, is_array($j) ? $j : null];
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

function db(): PDO
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    return new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
    foreach (glob(ROOT . '/backend/storage/cache/k_*.json') ?: [] as $f) {
        @unlink($f);
    }
}

function setSetting(string $key, string $value): void
{
    $pdo = db();
    $st = $pdo->prepare("INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, strftime('%Y-%m-%d %H:%M:%S','now'))
                         ON CONFLICT(key) DO UPDATE SET value = :v2");
    $st->execute([':k' => $key, ':v' => $value, ':v2' => $value]);
    foreach (glob(ROOT . '/backend/storage/cache/k_*.json') ?: [] as $f) {
        @unlink($f);
    }
}

/** فلگ سرور ساختگی زیبال (مثل verifyOmitAmount) */
function setMockFlag(string $key, mixed $val): void
{
    $f = __DIR__ . '/zibal-mock-state.json';
    $s = json_decode((string) @file_get_contents($f), true);
    if (!is_array($s)) {
        $s = [];
    }
    if ($val === null) {
        unset($s[$key]);
    } else {
        $s[$key] = $val;
    }
    file_put_contents($f, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/** آخرین مبلغِ request ثبت‌شده در سرور ساختگی زیبال (ریالِ رسیده از درایور) */
function lastMockRequestAmount(): ?int
{
    $s = json_decode((string) @file_get_contents(__DIR__ . '/zibal-mock-state.json'), true);
    if (!is_array($s) || !is_array($s['calls'] ?? null)) {
        return null;
    }
    for ($i = count($s['calls']) - 1; $i >= 0; $i--) {
        if (($s['calls'][$i]['type'] ?? '') === 'request') {
            $b = $s['calls'][$i]['body'] ?? [];
            return isset($b['amount']) && is_numeric($b['amount']) ? (int) $b['amount'] : null;
        }
    }
    return null;
}

/** مبلغِ verify که سرور ساختگی برمی‌گرداند — دستکاری برای تست fail-closed */
function tamperMockOrderAmount(string $trackId, int $newAmount): void
{
    $f = __DIR__ . '/zibal-mock-state.json';
    $s = json_decode((string) @file_get_contents($f), true);
    if (is_array($s) && isset($s['orders'][$trackId])) {
        $s['orders'][$trackId]['amount'] = $newAmount;
        file_put_contents($f, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

function callbackLocation(string $trackId, string $orderUuid, int $success): string
{
    $ch = curl_init(BASE . '/api/payments/callback?trackId=' . urlencode($trackId) . '&success=' . $success . '&status=' . ($success === 1 ? 1 : 3) . '&orderId=' . urlencode($orderUuid));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_NOBODY => false, CURLOPT_TIMEOUT => 15]);
    $resp = (string) curl_exec($ch);
    curl_close($ch);
    if (preg_match('/^Location:\s*(\S+)/mi', $resp, $m)) {
        return (string) $m[1];
    }
    return '';
}

function requestEmailCode(string $email): string
{
    sleep(2);
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

/* ---------- آماده‌سازی ---------- */

resetEnvironment();
setSetting('gateway_zibal_enabled', '1');

echo "\n۲) ورود کاربر\n";
$tok = loginEmail('toman@test.ir', '77777777-7777-4777-8777-777777777777');
check('ورود با ایمیل → توکن', is_string($tok) && $tok !== '');

/* ---------- ۳) پلن‌ها — تومان اصلی + آینه‌ی قدیمی ریالی ---------- */

echo "\n۳) پلن‌ها — واحد اصلی تومان + آینه‌ی قدیمی\n";
[$st, $j] = http('GET', '/api/v1/plans');
$plans = [];
foreach (($j['plans'] ?? []) as $p) {
    $plans[(string) $p['code']] = $p;
}
check('plans → ۲۰۰ و سه پلن', $st === 200 && count($plans) === 3);
check('monthly priceTomans=۴۹٬۰۰۰', (int) ($plans['monthly']['priceTomans'] ?? 0) === 49_000);
check('annual priceTomans=۱۹۰٬۰۰۰', (int) ($plans['annual']['priceTomans'] ?? 0) === 190_000);
check('lifetime priceTomans=۴۹۰٬۰۰۰', (int) ($plans['lifetime']['priceTomans'] ?? 0) === 490_000);
check('آینه‌ی قدیمی priceRials = ×۱۰ (فقط APKهای قدیمی)', (int) ($plans['monthly']['priceRials'] ?? 0) === 490_000
    && (int) ($plans['annual']['priceRials'] ?? 0) === 1_900_000);

/* ---------- ۴) سفارش + نقطه‌ی یکتای تبدیل درگاه ---------- */

echo "\n۴) سفارش → زیبال مبلغ تومان×۱۰ (ریال) می‌گیرد\n";
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order1 = (string) ($j['orderUuid'] ?? '');
$track1 = (string) ($j['trackId'] ?? '');
check('ساخت سفارش → ۲۰۰', $st === 200 && $order1 !== '' && $track1 !== '', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('پاسخ: amountTomans=۴۹٬۰۰۰', (int) ($j['amountTomans'] ?? 0) === 49_000);
check('پاسخ: آینه‌ی قدیمی amountRials=۴۹۰٬۰۰۰', (int) ($j['amountRials'] ?? 0) === 490_000);
check('زیبال amount=۴۹۰٬۰۰۰ ریال دریافت کرد (تومان × ۱۰ — نقطه‌ی یکتا)', lastMockRequestAmount() === 490_000, 'mock=' . (string) lastMockRequestAmount());

echo "\n۵) callback موفق — تطبیق هم‌واحد تومان\n";
$loc = callbackLocation($track1, $order1, 1);
check('callback → state=succeeded', str_contains($loc, 'payResult=' . $order1) && str_contains($loc, 'state=succeeded'), $loc);
[$st, $j] = http('GET', '/api/v1/me/subscription', null, $tok);
check('اشتراک فعال شد → isPremium=true', ($j['subscription']['isPremium'] ?? false) === true);

/* ---------- ۶) fail-closed — مبلغ دستکاری‌شده ---------- */

echo "\n۶) fail-closed — مبلغ ناسازگار در verify\n";
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order2 = (string) ($j['orderUuid'] ?? '');
$track2 = (string) ($j['trackId'] ?? '');
check('سفارش دوم ساخته شد', $st === 200 && $order2 !== '');
tamperMockOrderAmount($track2, 999_999); // ریالِ ناسازگار → تومان ۹۹٬۹۹۹ ≠ ۴۹٬۰۰۰
$loc = callbackLocation($track2, $order2, 1);
check('callback با مبلغ دستکاری‌شده → state=failed', str_contains($loc, 'state=failed'), $loc);
[$st, $j] = http('GET', '/api/v1/payments/orders/' . $order2, null, $tok);
check('وضعیت سفارش دوم → failed', ($j['order']['status'] ?? '') === 'failed');

/* ---------- ۷) fail-closed — verify بدون amount ---------- */

echo "\n۷) fail-closed — verify بدون amount\n";
setMockFlag('verifyOmitAmount', true);
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly'], $tok);
$order3 = (string) ($j['orderUuid'] ?? '');
$track3 = (string) ($j['trackId'] ?? '');
$loc = callbackLocation($track3, $order3, 1);
check('callback با verify بی‌مبلغ → state=failed', str_contains($loc, 'state=failed'), $loc);
setMockFlag('verifyOmitAmount', null);

/* ---------- ۸) کد هدیه — درصدی و مبلغ ثابت (تومان) ---------- */

echo "\n۸) کد هدیه — درصدی و مبلغ ثابت (تومان)\n";
$pdo = db();
$pdo->prepare("INSERT INTO coupons (uuid, code, type, value, expires_at, max_uses, used_count, is_active, created_at, updated_at)
               VALUES (lower(hex(randomblob(16))), 'TOMANPCT', 'percent', 20, NULL, NULL, 0, 1,
                       strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))")->execute();
$pdo->prepare("INSERT INTO coupons (uuid, code, type, value, expires_at, max_uses, used_count, is_active, created_at, updated_at)
               VALUES (lower(hex(randomblob(16))), 'TOMANFIX', 'amount', 10000, NULL, NULL, 0, 1,
                       strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))")->execute();

[$st, $j] = http('GET', '/api/v1/payments/gift/quote?code=TOMANPCT&plan=monthly', null, $tok);
check('درصدی ۲۰٪ → تخفیف ۹٬۸۰۰ و قابل پرداخت ۳۹٬۲۰۰ تومان', ($j['valid'] ?? false) === true
    && (int) ($j['discountTomans'] ?? 0) === 9_800
    && (int) ($j['payableTomans'] ?? 0) === 39_200, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('آینه‌ی قدیمی quote: discountRials=۹۸٬۰۰۰', (int) ($j['discountRials'] ?? 0) === 98_000);

[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly', 'giftCode' => 'TOMANFIX'], $tok);
check('مبلغ ثابت ۱۰٬۰۰۰ تومان → سفارش ۳۹٬۰۰۰ تومان + تخفیف ۱۰٬۰۰۰', $st === 200
    && (int) ($j['amountTomans'] ?? 0) === 39_000
    && (int) ($j['discountTomans'] ?? 0) === 10_000
    && ($j['couponCode'] ?? '') === 'TOMANFIX', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('زیبال برای سفارش تخفیف‌دار ۳۹۰٬۰۰۰ ریال گرفت (۳۹٬۰۰۰×۱۰)', lastMockRequestAmount() === 390_000, 'mock=' . (string) lastMockRequestAmount());

/* ---------- ۹) کف امن ۱۰۰ تومان ---------- */

echo "\n۹) کف امن مبلغ قابل پرداخت (۱۰۰ تومان)\n";
$pdo->prepare("INSERT INTO coupons (uuid, code, type, value, expires_at, max_uses, used_count, is_active, created_at, updated_at)
               VALUES (lower(hex(randomblob(16))), 'TOMANBIG', 'amount', 99000, NULL, NULL, 0, 1,
                       strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))")->execute();
[$st, $j] = http('POST', '/api/v1/payments/orders', ['planCode' => 'monthly', 'giftCode' => 'TOMANBIG'], $tok);
check('تخفیف بزرگ‌تر از قیمت → payable=۱۰۰ تومان (کف امن)', $st === 200
    && (int) ($j['amountTomans'] ?? 0) === 100
    && (int) ($j['discountTomans'] ?? 0) === 48_900, (string) json_encode($j, JSON_UNESCAPED_UNICODE));

/* ---------- ۱۰) واریز کارت‌به‌کارت ---------- */

echo "\n۱۰) واریز کارت‌به‌کارت — تومان\n";
setSetting('deposit_card_enabled', '1');
[$st, $j] = http('POST', '/api/v1/payments/deposit/requests', ['planCode' => 'annual', 'reference' => 'TOMAN123456'], $tok);
check('ثبت واریز → amountTomans=۱۹۰٬۰۰۰', $st === 200
    && (int) (($j['request']['amountTomans'] ?? 0)) === 190_000, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('واریز: آینه‌ی قدیمی amountRials=۱٬۹۰۰٬۰۰۰', (int) (($j['request']['amountRials'] ?? 0)) === 1_900_000);
[$st, $j] = http('GET', '/api/v1/payments/deposit/requests/mine', null, $tok);
$mine = $j['requests'][0] ?? [];
check('فهرست واریزهای من → amountTomans=۱۹۰٬۰۰۰', (int) ($mine['amountTomans'] ?? 0) === 190_000);

/* ---------- نتیجه ---------- */

echo "\n———————————————\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

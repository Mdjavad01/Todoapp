<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی P2.0 (templateKey + بسته‌های شغلی — سمت سرور)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php   → سرور ساختگی تلگرام (برای ورود)
 *
 * اجرا:  php tests/phase-jobpacks-test.php
 * (DB محلی و لاگ‌ها هر بار از نو ساخته می‌شوند؛ ListSchema::ensure در اولین سینک
 *  ستون template_key را خودش اضافه و بک‌فیل تریدر را انجام می‌دهد — همین مسیر هم تست می‌شود)
 *
 * پوشش:
 *   ۱) مهاجرت خودکار زمان‌اجرا: دیتابیس بدون ستون template_key + ۵ لیست تریدرِ نام‌دار
 *      → اولین سینک ستون را می‌سازد و بک‌فیل نامی trader.0..4 را انجام می‌دهد
 *   ۲) push/pull رفت‌وبرگشت templateKey
 *   ۳) سازگاری پس‌رو — APK قدیمی که templateKey نمی‌فرستد → مقدار سرور دست‌نخورده
 *   ۴) کلید نامعتبر (فارسی/بولی/>۳۲) → NULL (بدون زباله در DB، بدون ردّ سینک)
 *   ۵) پاک‌کردن صریح کلید با templateKey:null توسط کلاینت جدید
 *   ۶) تکرارپذیری: سینک‌های بعدی بی‌ضرر
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

function envKey(string $key, string $default = ''): string
{
    $lines = @file(ROOT . '/backend/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false || trim(substr($line, 0, $pos)) !== $key) {
            continue;
        }
        return trim(trim(substr($line, $pos + 1)), "\"' ");
    }
    return $default;
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
}

function syncCall(string $token, array $payload): array
{
    return http('POST', '/api/v1/sync', $payload, $token);
}

function ch(array $lists = [], array $tasks = [], array $subs = []): array
{
    return ['lists' => $lists, 'tasks' => $tasks, 'subtasks' => $subs];
}

function listRow(string $id, string $name, string $updatedAt, array $extra = []): array
{
    return array_merge([
        'id' => $id,
        'name' => $name,
        'emoji' => '💼',
        'color' => 'emerald',
        'sortOrder' => 0,
        'pinned' => false,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'deletedAt' => null,
    ], $extra);
}

function pullOne(string $token, string $entity, string $id): ?array
{
    [, $j] = syncCall($token, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch()]);
    foreach ($j['server'][$entity] ?? [] as $r) {
        if (($r['id'] ?? '') === $id) {
            return $r;
        }
    }
    return null;
}

/** کلیدهای فعلی روی دیتابیس محلی (نام → template_key) */
function dbListKeys(): array
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $out = [];
    foreach ($pdo->query('SELECT name, template_key FROM lists WHERE deleted_at IS NULL') as $row) {
        $out[(string) $row['name']] = $row['template_key'];
    }
    return $out;
}

resetEnvironment();
echo "═══ P2.0 — templateKey + بسته‌های شغلی (سمت سرور) ═══\n";

/* ---------- آماده‌سازی: دیتابیس «قبل از P2.0» — بدون ستون + داده‌ی تریدر نام‌دار ---------- */
$dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
$pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('ALTER TABLE lists DROP COLUMN template_key');
$pdo->exec(
    "INSERT INTO lists (uuid, user_id, name, emoji, color, sort_order, pinned, created_at, updated_at, applied_at, rev, rev_device)
     VALUES
       ('aaaa0000-0000-4000-8000-000000000001', 999, 'قوانین من', '📌', 'rose', 0, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, ''),
       ('aaaa0000-0000-4000-8000-000000000002', 999, 'پیش از بازار', '🌅', 'amber', 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, ''),
       ('aaaa0000-0000-4000-8000-000000000003', 999, 'قبل از معامله', '🎯', 'teal', 2, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, ''),
       ('aaaa0000-0000-4000-8000-000000000004', 999, 'بعد از بازار', '🌆', 'indigo', 3, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, ''),
       ('aaaa0000-0000-4000-8000-000000000005', 999, 'ریویو هفتگی', '🗓️', 'emerald', 4, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, ''),
       ('aaaa0000-0000-4000-8000-000000000006', 999, 'خرید شخصی', '🛒', 'teal', 5, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 0, '')"
);

/* ---------- ورود کاربر ---------- */
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'p2@example.com']);
check('درخواست OTP کاربر P2', $st === 200 && isset($j['devCode']));
$code = (string) $j['devCode'];
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'p2@example.com', 'code' => $code, 'deviceUuid' => 'dddd2222-0000-4000-8000-000000000001']);
check('ورود کاربر P2', $st === 200 && isset($j['accessToken']));
$tok = (string) $j['accessToken'];

/* ---------- ۱) مهاجرت خودکار + بک‌فیل نامی تریدر ---------- */
echo "۱) مهاجرت خودکار زمان‌اجرا (ستون بدون مهاجرت) + بک‌فیل نامی ۵ لیست تریدر\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch()]);
check('اولین سینک روی دیتابیسِ بدون ستون = ۲۰۰ (مهاجرت خودکار)', $st === 200, json_encode($j ?? null, JSON_UNESCAPED_UNICODE));

$keys = dbListKeys();
check('بک‌فیل: قوانین من → trader.0', ($keys['قوانین من'] ?? null) === 'trader.0', json_encode($keys, JSON_UNESCAPED_UNICODE));
check('بک‌فیل: پیش از بازار → trader.1', ($keys['پیش از بازار'] ?? null) === 'trader.1');
check('بک‌فیل: قبل از معامله → trader.2', ($keys['قبل از معامله'] ?? null) === 'trader.2');
check('بک‌فیل: بعد از بازار → trader.3', ($keys['بعد از بازار'] ?? null) === 'trader.3');
check('بک‌فیل: ریویو هفتگی → trader.4', ($keys['ریویو هفتگی'] ?? null) === 'trader.4');
check('بک‌فیل: لیست عادی کاربر (خرید شخصی) NULL می‌ماند', ($keys['خرید شخصی'] ?? 'missing') === null || ($keys['خرید شخصی'] ?? '') === '');

/* ---------- ۲) رفت‌وبرگشت templateKey ---------- */
echo "۲) push/pull templateKey\n";
$T0 = '2026-02-01T09:00:00Z';
$L1 = 'bbbb1111-0000-4000-8000-000000000001';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch([
    listRow($L1, 'شروع روز کاری', $T0, ['templateKey' => 'kit-freelance.0']),
])]);
check('درج لیست با کلید kit-freelance.0', $st === 200 && ($j['applied']['lists'] ?? 0) === 1, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

$row = pullOne($tok, 'lists', $L1);
check('pull: templateKey برگشت', $row !== null && $row['templateKey'] === 'kit-freelance.0', json_encode($row ?? null, JSON_UNESCAPED_UNICODE));
check('pull: pinned و بقیه فیلدها دست‌نخورده', $row !== null && $row['pinned'] === false && $row['name'] === 'شروع روز کاری');

/* ---------- ۳) سازگاری پس‌رو — APK قدیمی کلید نمی‌فرستد ---------- */
echo "۳) APK قدیمی: push کامل بدون templateKey → مقدار سرور حفظ می‌شود\n";
$oldApkRow = listRow($L1, 'شروع روز کاری', '2026-02-01T10:00:00Z');
unset($oldApkRow['templateKey']); // APK قدیمی اصلاً این کلید را نمی‌شناسد
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-old', 'changes' => ch([$oldApkRow])]);
check('push قدیمی اعمال شد (برنده‌ی LWW)', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
$row = pullOne($tok, 'lists', $L1);
check('کلید سرور با push قدیمی پاک نشد', $row !== null && $row['templateKey'] === 'kit-freelance.0', json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۴) کلید نامعتبر → NULL (بدون ردّ سینک) ---------- */
echo "۴) کلید نامعتبر → NULL\n";
$L2 = 'bbbb1111-0000-4000-8000-000000000002';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch([
    listRow($L2, 'کار عمیق', $T0, ['templateKey' => 'کلید فارسی ❌']),
])]);
check('push با کلید نامعتبر رد نشد', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
$row = pullOne($tok, 'lists', $L2);
check('کلید نامعتبر = NULL در سرور', $row !== null && array_key_exists('templateKey', $row) && $row['templateKey'] === null, json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

$L3 = 'bbbb1111-0000-4000-8000-000000000003';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch([
    listRow($L3, 'پیگیری مشتری‌ها', $T0, ['templateKey' => str_repeat('a', 40)]),
])]);
$row = pullOne($tok, 'lists', $L3);
check('کلید بلندتر از ۳۲ = NULL', $row !== null && array_key_exists('templateKey', $row) && $row['templateKey'] === null);

/* ---------- ۵) پاک‌کردن صریح با null ---------- */
echo "۵) پاک‌کردن صریح کلید با templateKey:null (کلاینت جدید)\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch([
    listRow($L1, 'شروع روز کاری', '2026-02-01T11:00:00Z', ['templateKey' => null]),
])]);
check('push با templateKey:null اعمال شد', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
$row = pullOne($tok, 'lists', $L1);
check('کلید واقعاً پاک شد', $row !== null && array_key_exists('templateKey', $row) && $row['templateKey'] === null, json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۶) تکرارپذیری ---------- */
echo "۶) تکرارپذیری — سینک‌های بعدی بی‌ضرر\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-p2', 'changes' => ch()]);
check('سینک تکراری = ۲۰۰', $st === 200);
$keys2 = dbListKeys();
check('بک‌فیل دوباره اجرا نشده/دست نخورده', ($keys2['پیش از بازار'] ?? null) === 'trader.1');

echo "\n═══ نتیجه: {$pass} گذرانده / {$fail} شکسته ═══\n";
exit($fail === 0 ? 0 : 1);

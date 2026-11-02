<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز تریدر (itemType/itemValue + lists.pinned — سازگاری پس‌رو کامل)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php   → سرور ساختگی تلگرام (برای ورود)
 *
 * اجرا:  php tests/phase-trader-test.php
 * (DB محلی و لاگ‌ها هر بار از نو ساخته می‌شوند؛ TaskSchema::ensure در اولین سینک
 *  ستون‌های item_type/item_value/pinned را خودش اضافه می‌کند — همین مسیر هم تست می‌شود)
 *
 * پوشش:
 *   ۱) مهاجرت خودکار زمان‌اجرای ستون‌های نو (اولین سینک روی دیتابیس تازه)
 *   ۲) push/pull رفت‌وبرگشت itemType/itemValue برای هر ۵ نوع
 *   ۳) itemType null (= تیک ساده) و پاک‌کردن مقدار
 *   ۴) ردّ مقدار نامعتبر: itemType ناشناخته + itemValue بلندتر از ۲۵۵
 *   ۵) lists.pinned رفت‌وبرگشت true/false + ردّ مقدار نامعتبر
 *   ۶) سازگاری پس‌رو — APK قدیمی که کلیدها را نمی‌فرستد:
 *      push کامل بدون itemType/itemValue/pinned → مقادیر سرور دست نخورده می‌ماند
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
    // پارسر دستی .env — همان الگوی phase-sync (parse_ini_file روی مقادیر با پرانتز گیر می‌کند)
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
    // ساخت اسکیمای تازه — همان الگوی phase-sync-test (بعد از پاک‌سازی، install.sqlite.sql اجرا می‌شود)
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $sql = (string) file_get_contents(ROOT . '/deploy/install.sqlite.sql');
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        if ($stmt !== '') {
            $pdo->exec($stmt);
        }
    }
    if (is_file(ROOT . '/backend/storage/logs/mail.log')) {
        @unlink(ROOT . '/backend/storage/logs/mail.log');
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
        'emoji' => '📈',
        'color' => 'teal',
        'sortOrder' => 0,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'deletedAt' => null,
    ], $extra);
}

/** ردیف کامل کار — همان چیزی که APK جدید می‌فرستد (همه‌ی کلیدها حاضرند) */
function taskRow(string $id, string $listId, string $title, string $updatedAt, array $extra = []): array
{
    return array_merge([
        'id' => $id,
        'listId' => $listId,
        'title' => $title,
        'notes' => '',
        'priority' => 'normal',
        'dueDate' => null,
        'dueTime' => null,
        'reminderMinutes' => null,
        'repeat' => 'none',
        'starred' => false,
        'repeatMeta' => null,
        'completedAt' => null,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'deletedAt' => null,
    ], $extra);
}

function pullOne(string $token, string $entity, string $id): ?array
{
    [, $j] = syncCall($token, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch()]);
    foreach ($j['server'][$entity] ?? [] as $r) {
        if (($r['id'] ?? '') === $id) {
            return $r;
        }
    }
    return null;
}

resetEnvironment();
echo "═══ فاز تریدر — itemType/itemValue/pinned + سازگاری پس‌رو ═══\n";

/* ---------- ورود کاربر ---------- */
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'trader@example.com']);
check('درخواست OTP کاربر تریدر', $st === 200 && isset($j['devCode']));
$code = (string) $j['devCode'];
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'trader@example.com', 'code' => $code, 'deviceUuid' => 'dddd1111-0000-4000-8000-000000000001']);
check('ورود کاربر تریدر', $st === 200 && isset($j['accessToken']));
$tok = (string) $j['accessToken'];

$T0 = '2026-02-01T09:00:00Z';
$L1 = 'eeee1111-0000-4000-8000-000000000001';
$L2 = 'eeee1111-0000-4000-8000-000000000002';

/* ---------- ۱) مهاجرت خودکار + پش رفت‌وبرگشت ---------- */
echo "۱) مهاجرت خودکار زمان‌اجرا (دیتابیس تازه) + push/pull فیلدهای نو\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([listRow($L1, 'قوانین من', $T0, ['pinned' => true])])]);
check('درج لیست پین‌شده روی دیتابیس تازه (مهاجرت خودکار pinned)', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);

$row = pullOne($tok, 'lists', $L1);
check('pull: pinned=true برگشت', $row !== null && $row['pinned'] === true, json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

$tasks = [
    taskRow('eeee2222-0000-4000-8000-0000000000' . '01', $L1, 'حداکثر تعداد معامله در روز', $T0, ['itemType' => 'num', 'itemValue' => '3']),
    taskRow('eeee2222-0000-4000-8000-0000000000' . '02', $L1, 'پلن امروز را نوشتم', $T0, ['itemType' => 'note', 'itemValue' => 'فقط ستاپ A+ شکست روند']),
    taskRow('eeee2222-0000-4000-8000-0000000000' . '03', $L1, 'طبق پلنم معامله کردم؟', $T0, ['itemType' => 'choice', 'itemValue' => 'partial']),
    taskRow('eeee2222-0000-4000-8000-0000000000' . '04', $L1, 'امتیاز انضباط امروز', $T0, ['itemType' => 'score', 'itemValue' => '7']),
    taskRow('eeee2222-0000-4000-8000-0000000000' . '05', $L1, 'استاپ را جابجا نمی‌کنم', $T0, ['itemType' => 'check', 'itemValue' => null]),
];
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([], $tasks)]);
check('درج ۵ آیتم با هر ۵ نوع', $st === 200 && ($j['applied']['tasks'] ?? 0) === 5, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

$expect = [
    'eeee2222-0000-4000-8000-000000000001' => ['num', '3'],
    'eeee2222-0000-4000-8000-000000000002' => ['note', 'فقط ستاپ A+ شکست روند'],
    'eeee2222-0000-4000-8000-000000000003' => ['choice', 'partial'],
    'eeee2222-0000-4000-8000-000000000004' => ['score', '7'],
    'eeee2222-0000-4000-8000-000000000005' => ['check', null],
];
foreach ($expect as $tid => [$type, $val]) {
    $r = pullOne($tok, 'tasks', $tid);
    check(
        "pull رفت‌وبرگشت type={$type}",
        $r !== null && $r['itemType'] === $type && $r['itemValue'] === $val,
        json_encode($r ?? null, JSON_UNESCAPED_UNICODE)
    );
}

/* ---------- ۲) itemType null و پاک‌کردن مقدار ---------- */
echo "۲) itemType null (تیک ساده) و پاک‌کردن مقدار\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([], [
    taskRow('eeee2222-0000-4000-8000-000000000004', $L1, 'امتیاز انضباط امروز', '2026-02-01T09:01:00Z', ['itemType' => null, 'itemValue' => null]),
])]);
check('push با itemType=null اعمال شد', $st === 200 && ($j['applied']['tasks'] ?? 0) === 1);
$r = pullOne($tok, 'tasks', 'eeee2222-0000-4000-8000-000000000004');
check('pull: itemType=null و itemValue=null شد', $r !== null && $r['itemType'] === null && $r['itemValue'] === null, json_encode($r ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۳) ردّ مقادیر نامعتبر ---------- */
echo "۳) اعتبارسنجی — ردّ بدون شکستن بقیه\n";
$T1 = '2026-02-01T09:02:00Z';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([], [
    taskRow('eeee2222-0000-4000-8000-000000000010', $L1, 'نوع غلط', $T1, ['itemType' => 'weird']),
])]);
$rejectedTypes = array_column($j['rejected'] ?? [], 'reason');
check('itemType ناشناخته رد شد', $st === 200 && count($j['rejected'] ?? []) === 1, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

$longVal = str_repeat('x', 256);
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([], [
    taskRow('eeee2222-0000-4000-8000-000000000011', $L1, 'مقدار بلند', $T1, ['itemType' => 'note', 'itemValue' => $longVal]),
])]);
check('itemValue بلندتر از ۲۵۵ رد شد', $st === 200 && count($j['rejected'] ?? []) === 1, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([
    listRow($L2, 'پین غلط', $T1, ['pinned' => 'yes']),
])]);
check('pinned غیربولی رد شد', $st === 200 && count($j['rejected'] ?? []) === 1, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۴) pinned false صریح ---------- */
echo "۴) pinned=false صریح\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([
    listRow($L2, 'لیست معمولی', '2026-02-01T09:03:00Z', ['pinned' => false]),
])]);
check('درج لیست با pinned=false', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
$row = pullOne($tok, 'lists', $L2);
check('pull: pinned=false برگشت', $row !== null && $row['pinned'] === false);

/* ---------- ۵) سازگاری پس‌رو — APK قدیمی که کلیدها را نمی‌فرستد ---------- */
echo "۵) APK قدیمی: push کامل بدون کلیدهای نو → مقدار سرور حفظ می‌شود\n";
$T2 = '2026-02-01T09:04:00Z';
// push کاملِ «قدیمی» — هیچ‌کدام از itemType/itemValue/pinned/repeatMeta در آن نیست
$oldTask = [
    'id' => 'eeee2222-0000-4000-8000-000000000001',
    'listId' => $L1,
    'title' => 'حداکثر تعداد معامله در روز (ویرایش قدیمی)',
    'notes' => '',
    'priority' => 'normal',
    'dueDate' => null,
    'dueTime' => null,
    'reminderMinutes' => null,
    'repeat' => 'none',
    'completedAt' => null,
    'createdAt' => $T0,
    'updatedAt' => $T2,
    'deletedAt' => null,
];
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-old-apk', 'changes' => ch([], [$oldTask])]);
check('push قدیمی اعمال شد (عنوان نو)', $st === 200 && ($j['applied']['tasks'] ?? 0) === 1, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));
$r = pullOne($tok, 'tasks', 'eeee2222-0000-4000-8000-000000000001');
check('APK قدیمی itemType=num را پاک نکرد', $r !== null && $r['itemType'] === 'num', json_encode($r ?? null, JSON_UNESCAPED_UNICODE));
check('APK قدیمی itemValue را پاک نکرد', $r !== null && $r['itemValue'] === '3', json_encode($r ?? null, JSON_UNESCAPED_UNICODE));

$oldList = [
    'id' => $L1,
    'name' => 'قوانین من (ویرایش قدیمی)',
    'emoji' => '📌',
    'color' => 'teal',
    'sortOrder' => 0,
    'createdAt' => $T0,
    'updatedAt' => $T2,
    'deletedAt' => null,
];
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-old-apk', 'changes' => ch([$oldList])]);
check('push قدیمی لیست اعمال شد', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
$row = pullOne($tok, 'lists', $L1);
check('APK قدیمی pinned=true را پاک نکرد', $row !== null && $row['pinned'] === true, json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۶) مقدار فارسی/عدد اعشاری در itemValue ---------- */
echo "۶) مقدار فارسی و اعشاری\n";
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-trader', 'changes' => ch([], [
    taskRow('eeee2222-0000-4000-8000-000000000020', $L1, 'حداکثر ضرر روزانه', $T2, ['itemType' => 'note', 'itemValue' => '۲٪ سرمایه']),
    taskRow('eeee2222-0000-4000-8000-000000000021', $L1, 'ریسک هر معامله', $T2, ['itemType' => 'num', 'itemValue' => '1.5']),
])]);
check('درج دو آیتم با مقدار فارسی/اعشاری', $st === 200 && ($j['applied']['tasks'] ?? 0) === 2, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));
$r = pullOne($tok, 'tasks', 'eeee2222-0000-4000-8000-000000000020');
check('مقدار فارسی سالم برگشت', $r !== null && $r['itemValue'] === '۲٪ سرمایه');
$r = pullOne($tok, 'tasks', 'eeee2222-0000-4000-8000-000000000021');
check('مقدار اعشاری سالم برگشت', $r !== null && $r['itemValue'] === '1.5');

echo "\n———————————————\n";
echo $fail === 0 ? "✓ همه‌ی {$pass} بررسی سبز بود\n" : "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

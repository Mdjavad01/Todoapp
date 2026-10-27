<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی «فلوی افزودن و جزئیات کار» (فاز ۳ — سمت سرور)
 *
 * پوشش:
 *   ۱) مهاجرت خودکار TaskSchema (ستون starred / repeat_meta + گسترش enum تکرار) در اولین سینک
 *   ۲) push/pull کار با repeat='workdays' + starred=true + repeatMeta — رفت‌وبرگشت کامل
 *   ۳) push کاملِ کلاینت قدیمی (بدون starred/repeatMeta) — مقادیر سرور حفظ می‌شود (سازگاری پس‌رو)
 *   ۴) repeatMeta نامعتبر → rejected (هیچ ردیفی ساخته نمی‌شود)
 *   ۵) repeatMeta نویزدار → کانونی‌شدن (مرتب/یکتا) در DB
 *   ۶) enum تکرار جدید از مسیر REST (POST /api/v1/tasks) هم کار می‌کند
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 * اجرا:  php tests/phase-detail-test.php
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
        CURLOPT_TIMEOUT => 30,
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
        'emoji' => '📦',
        'color' => 'teal',
        'sortOrder' => 0,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'deletedAt' => null,
    ], $extra);
}

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
        'completedAt' => null,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'deletedAt' => null,
    ], $extra);
}

/** پیدا کردن اولین کارِ کاربر در پاسخ pull */
function findTask(?array $server, string $id): ?array
{
    foreach (($server['tasks'] ?? []) as $t) {
        if (($t['id'] ?? '') === $id) {
            return $t;
        }
    }
    return null;
}

resetEnvironment();
echo "═══ فاز ۳ — فلوی افزودن و جزئیات کار (سمت سرور) ═══\n";

/* ---------- ورود کاربر ---------- */
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'detail@example.com']);
check('درخواست OTP', $st === 200 && isset($j['devCode']));
$code = (string) $j['devCode'];
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'detail@example.com', 'code' => $code, 'deviceUuid' => 'cccc3333-0000-4000-8000-000000000001']);
check('ورود کاربر', $st === 200 && isset($j['accessToken']));
$tok = (string) $j['accessToken'];

$NOW1 = gmdate('Y-m-d\T10:00:00\Z', time() - 600);
$L1 = 'dddd1111-0000-4000-8000-000000000001';
$T1 = 'dddd2222-0000-4000-8000-000000000001';

/* ---------- ۱) مهاجرت خودکار + push/pull با فیلدهای جدید ---------- */
echo "۱) TaskSchema خودکار + رفت‌وبرگشت starred/repeatMeta/workdays\n";
[$st, $j] = syncCall($tok, [
    'cursor' => null,
    'pull' => 0,
    'deviceUuid' => 'device-c',
    'changes' => ch([listRow($L1, 'کاری', $NOW1)]),
]);
check('push لیست (مهاجرت اسکیما در همین سینک انجام شد)', $st === 200, 'status=' . $st);

$meta = ['every' => 2, 'unit' => 'week', 'days' => [3, 0, 3]]; // نویزدار — باید کانونی شود
[$st, $j] = syncCall($tok, [
    'cursor' => null,
    'pull' => 1,
    'deviceUuid' => 'device-c',
    'changes' => ch([], [taskRow($T1, $L1, 'گزارش هفتگی', $NOW1, [
        'repeat' => 'workdays',
        'starred' => true,
        'repeatMeta' => $meta,
    ])]),
]);
check('push کار با تکرار کارهای کاری + ستاره + سفارشی', $st === 200 && ($j['applied']['tasks'] ?? 0) === 1, 'status=' . $st);

[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch()]);
$t = findTask($j['server'] ?? null, $T1);
check('pull: repeat=workdays حفظ شد', is_array($t) && ($t['repeat'] ?? '') === 'workdays', json_encode($t ?? [], JSON_UNESCAPED_UNICODE));
check('pull: starred=true برگشت', is_array($t) && ($t['starred'] ?? null) === true, var_export($t['starred'] ?? null, true));
check('pull: repeatMeta کانونی شد (مرتب/یکتا)', is_array($t) && (($t['repeatMeta']['days'] ?? null) === [0, 3]) && ($t['repeatMeta']['every'] ?? 0) === 2, json_encode($t['repeatMeta'] ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۲) سازگاری پس‌رو: کلاینت قدیمی push کامل بدون فیلدهای جدید ---------- */
echo "۲) push کامل کلاینت قدیمی (بدون starred/repeatMeta) — حفظ مقادیر سرور\n";
$NOW2 = gmdate('Y-m-d\TH:i:s\Z', time() - 300);
// همان ردیف به سبک APK قدیمی: هیچ کلید starred/repeatMeta ندارد؛ repeat روزانه است
$oldStyle = taskRow($T1, $L1, 'گزارش هفتگی ویرایش‌شده', $NOW2);
$oldStyle['repeat'] = 'daily';
unset($oldStyle['starred'], $oldStyle['repeatMeta']);
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-old', 'changes' => ch([], [$oldStyle])]);
check('push سبک قدیمی اعمال شد', $st === 200 && ($j['applied']['tasks'] ?? 0) === 1);

[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch()]);
$t = findTask($j['server'] ?? null, $T1);
check('عنوان جدید آمد (LWW عادی)', is_array($t) && ($t['title'] ?? '') === 'گزارش هفتگی ویرایش‌شده');
check('ستاره با push قدیمی از بین نرفت', is_array($t) && ($t['starred'] ?? null) === true, var_export($t['starred'] ?? null, true));
check('repeatMeta با push قدیمی از بین نرفت', is_array($t) && (($t['repeatMeta']['days'] ?? null) === [0, 3]));
check('repeat به daily تغییر کرد (خود فیلد عادی است)', is_array($t) && ($t['repeat'] ?? '') === 'daily');

/* ---------- ۳) repeatMeta نامعتبر → rejected ---------- */
echo "۳) repeatMeta نامعتبر → rejected، بدون ساخت ردیف\n";
$NOW3 = gmdate('Y-m-d\TH:i:s\Z', time() - 60);
$T2 = 'dddd3333-0000-4000-8000-000000000001';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch([], [
    taskRow($T2, $L1, 'نامعتبر', $NOW3, ['repeat' => 'custom', 'repeatMeta' => ['every' => 0, 'unit' => 'day']]),
])]);
$rejectedIds = array_column($j['rejected'] ?? [], 'id');
check('درخواست 200 ولی آیتم rejected شد', $st === 200 && in_array($T2, $rejectedIds, true), json_encode($j['rejected'] ?? [], JSON_UNESCAPED_UNICODE));
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch()]);
check('ردیف نامعتبر ساخته نشد', findTask($j['server'] ?? null, $T2) === null);

/* ---------- ۴) enum نامعتبر ---------- */
echo "۴) نوع تکرار نامعتبر → rejected\n";
$T3 = 'dddd4444-0000-4000-8000-000000000001';
[$st, $j] = syncCall($tok, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch([], [
    taskRow($T3, $L1, 'بی‌معنا', $NOW3, ['repeat' => 'hourly']),
])]);
$rejectedIds = array_column($j['rejected'] ?? [], 'id');
check('repeat=hourly rejected شد', $st === 200 && in_array($T3, $rejectedIds, true));

/* ---------- ۵) مسیر REST هم فیلدهای جدید را می‌پذیرد ---------- */
echo "۵) REST — POST /api/v1/tasks با فیلدهای فاز ۳\n";
$T4 = 'dddd5555-0000-4000-8000-000000000001';
$NOW4 = gmdate('Y-m-d\TH:i:s\Z', time() - 30);
[$st, $j] = http('POST', '/api/v1/tasks', array_merge(taskRow($T4, $L1, 'سالانه تولد', $NOW4, [
    'repeat' => 'yearly',
    'starred' => true,
]), [
    'dueDate' => '2025-03-20',
]), $tok);
check('REST create 201', $st === 201, 'status=' . $st);
check('REST پاسخ starred=true دارد', ($j['tasks']['starred'] ?? null) === true);
check('REST پاسخ repeat=yearly دارد', ($j['tasks']['repeat'] ?? '') === 'yearly');

echo "\n═══ نتیجه: {$pass} موفق / {$fail} ناموفق ═══\n";
exit($fail === 0 ? 0 : 1);

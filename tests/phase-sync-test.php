<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی «ترمیم جریان» (فاز ۱ بازسازی — سینک مقاوم)
 *
 * پوشش:
 *   ۱) LWW قطعی با rev/revDevice — شکستن تساوی هم‌ثانیه (یکسان با frontend/src/sync/lww.ts)
 *   ۲) ساعت جلوتر از ۵ دقیقه → بریده‌شدن به زمان سرور + clockSkew (نفی ردِ بی‌صدا)
 *   ۳) dedupe سمت سرور برای لیست‌های seed مربوط به APKهای قدیمی + آزادبودن نام‌های عادی
 *   ۴) والدِ حذف‌شده → rejected (integrity)
 *   ۵) pull صفحه‌بندی‌شده (پرچم incomplete + ادامه با همان کرسر)
 *   ۶) پرچم pull=0 (چانک‌های push-only)
 *   ۷) سقف آیتم (گارد نهایی ۴۲۲) + استراتژی چانکِ کلاینت زیر سقف
 *   ۸) bootstrap.sync.maxItems
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 * اجرا:  php tests/phase-sync-test.php
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

/** تغییرات ساده برای push */
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

resetEnvironment();
echo "═══ ترمیم جریان — تست سینک مقاوم ═══\n";

/* ---------- ورود کاربر A ---------- */
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'syncflow@example.com']);
check('درخواست OTP کاربر A', $st === 200 && isset($j['devCode']));
$code = (string) $j['devCode'];
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'syncflow@example.com', 'code' => $code, 'deviceUuid' => 'aaaa1111-0000-4000-8000-000000000001']);
check('ورود کاربر A', $st === 200 && isset($j['accessToken']));
$tokA = (string) $j['accessToken'];

/* ---------- ۸) bootstrap.sync.maxItems ---------- */
echo "۸) bootstrap — سقف سینک\n";
[$st, $j] = http('GET', '/api/v1/bootstrap');
check('bootstrap.sync.maxItems موجود است', $st === 200 && isset($j['sync']['maxItems']) && (int) $j['sync']['maxItems'] >= 100);

/* ---------- ۱) LWW قطعی: (updatedAt, rev, revDevice) ---------- */
echo "۱) LWW قطعی — شکستن تساوی هم‌ثانیه\n";
$L1 = 'bbbb1111-0000-4000-8000-000000000001';
$T0 = '2026-01-01T10:00:00Z'; // ثابت در گذشته — برای ساختن تساوی واقعی (مستقل از ساعت اجرای تست)
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($L1, 'نسخه اولیه A', $T0)])]);
check('درج اولیه لیست', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);

// pull → نسخه‌ی سرور باید rev=1 و revDevice=device-a داشته باشد
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch()]);
$row = null;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['id'] === $L1) {
        $row = $r;
    }
}
check('پاسخ pull دارای rev و revDevice است', $row !== null && (int) $row['rev'] === 1 && ($row['revDevice'] ?? '') === 'device-a', json_encode($row ?? null, JSON_UNESCAPED_UNICODE));

// همان ثانیه + rev برابر + دستگاه «b» بزرگ‌تر از «a» → b برنده است
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-b', 'changes' => ch([listRow($L1, 'برنده B همان‌ثانیه', $T0, ['rev' => 1, 'revDevice' => 'device-b'])])]);
check('شکستن تساوی با revDevice (b>a)', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);

// همان ثانیه + دستگاه کوچک‌تر/قبلی (a و 0) → بازنده؛ سرور نسخه B را در pull برمی‌گرداند
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($L1, 'بازنده A', $T0, ['rev' => 1, 'revDevice' => 'device-a'])])]);
check('بازنده LWW (a) رد شد (پاسخ بدون خطا)', $st === 200);
$found = null;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['id'] === $L1) {
        $found = $r;
    }
}
check('نسخه‌ی برنده (B) در pull برگشت', $found !== null && $found['name'] === 'برنده B همان‌ثانیه' && (int) $found['rev'] >= 2, json_encode($found ?? null, JSON_UNESCAPED_UNICODE));

[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-0', 'changes' => ch([listRow($L1, 'بازنده C', $T0, ['rev' => 1, 'revDevice' => 'device-0'])])]);
check('بازنده LWW (0) رد شد', $st === 200);
$found = null;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['id'] === $L1) {
        $found = $r;
    }
}
check('کماکان نسخه‌ی B در سرور', $found !== null && $found['name'] === 'برنده B همان‌ثانیه');

// تساوی کامل (همان tuple سرور) → اعمال مجدد بی‌ضرر (idempotent)
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-b', 'changes' => ch([listRow($L1, 'برنده B همان‌ثانیه', $T0, ['rev' => 2, 'revDevice' => 'device-b'])])]);
check('تساوی کامل = اعمال مجدد (idempotent)', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);

// updatedAt جدیدتر با rev کوچک‌تر → زمان مقدم بر rev است
$T1 = '2026-01-01T10:00:01Z'; // یک ثانیه بعد از T0 — قطعی (اصلاح وابستگی زمانی تست)
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch([listRow($L1, 'زمان جدیدتر برنده است', $T1, ['rev' => 0, 'revDevice' => 'device-c'])])]);
check('updatedAt جدیدتر مقدم بر rev', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-c', 'changes' => ch()]);
$found = null;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['id'] === $L1) {
        $found = $r;
    }
}
check('محتوای نهایی = برنده‌ی زمانی', $found !== null && $found['name'] === 'زمان جدیدتر برنده است');

/* ---------- ۲) ساعت جلوتر از ۵ دقیقه → بریدن به زمان سرور ---------- */
echo "۲) جبران ساعت — نفی ردِ بی‌صدا\n";
$L2 = 'bbbb1111-0000-4000-8000-000000000002';
$future = gmdate('Y-m-d\TH:i:s\Z', time() + 600); // +۱۰ دقیقه
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($L2, 'ساعت جلو', $future)])]);
check('آیتم ساعت‌جلو رد نشد (اعمال شد)', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
check('هشدار clockSkew در پاسخ هست', isset($j['clockSkew']) && count($j['clockSkew']) === 1, json_encode($j['clockSkew'] ?? null));
check('serverTime در پاسخ هست', isset($j['serverTime']) && preg_match('/^\d{4}-\d{2}-\d{2}T/', (string) $j['serverTime']) === 1);
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch()]);
$found = null;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['id'] === $L2) {
        $found = $r;
    }
}
$nowDiff = $found !== null ? abs(time() - strtotime((string) $found['updatedAt'])) : PHP_INT_MAX;
check('updatedAt به زمان سرور بریده شد (نه آینده)', $nowDiff < 120, 'diff=' . $nowDiff . 's');

/* ---------- ۳) dedupe لیست‌های seed (APKهای قدیمی) ---------- */
echo "۳) dedupe سمت سرور لیست‌های seed\n";
$S1 = 'cccc1111-0000-4000-8000-000000000001';
$S2 = 'cccc1111-0000-4000-8000-000000000002';
$now = gmdate('Y-m-d\TH:i:s\Z');
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($S1, 'کارهای خانه', $now)])]);
check('اولین «کارهای خانه» درج شد', $st === 200 && ($j['applied']['lists'] ?? 0) === 1);
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-b', 'changes' => ch([listRow($S2, 'کارهای خانه', $now)])]);
check('دومی «کارهای خانه» تکراری ساخته نشد (بازگشت نسخه سرور)', $st === 200 && isset($j['server']['lists']) && count($j['server']['lists']) >= 1);
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch()]);
$aliveHome = 0;
foreach ($j['server']['lists'] ?? [] as $r) {
    if ($r['name'] === 'کارهای خانه' && $r['deletedAt'] === null) {
        $aliveHome++;
    }
}
check('فقط یک «کارهای خانه» زنده در سرور', $aliveHome === 1, 'count=' . $aliveHome);

// نام غیرسید نباید dedupe شود
$N1 = 'cccc1111-0000-4000-8000-000000000003';
$N2 = 'cccc1111-0000-4000-8000-000000000004';
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($N1, 'لیست خودم', $now), listRow($N2, 'لیست خودم', $now)])]);
check('نام عادی: دو لیست هم‌نام مجاز است (بدون dedupe)', $st === 200 && ($j['applied']['lists'] ?? 0) === 2);

/* ---------- ۴) والدِ حذف‌شده → rejected ---------- */
echo "۴) integrity — والد تومب‌استون\n";
$LD = 'dddd1111-0000-4000-8000-000000000001';
$TD = 'dddd1111-0000-4000-8000-000000000002';
$delNow = gmdate('Y-m-d\TH:i:s\Z');
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($LD, 'لیستِ حذف‌شونده', $delNow, ['deletedAt' => $delNow])])]);
check('درج لیست تومب‌استون', $st === 200);
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch([], [[
    'id' => $TD, 'listId' => $LD, 'title' => 'کار بی‌والد', 'notes' => '', 'priority' => 'normal',
    'dueDate' => null, 'dueTime' => null, 'reminderMinutes' => null, 'repeat' => 'none',
    'completedAt' => null, 'createdAt' => $delNow, 'updatedAt' => $delNow, 'deletedAt' => null,
]])]);
$rejectedOk = false;
foreach ($j['rejected'] ?? [] as $r) {
    if (($r['id'] ?? '') === $TD && ($r['reason'] ?? '') === 'missing_parent') {
        $rejectedOk = true;
    }
}
check('کار با والد حذف‌شده → rejected/missing_parent', $rejectedOk, json_encode($j['rejected'] ?? null, JSON_UNESCAPED_UNICODE));

/* ---------- ۵) pull صفحه‌بندی‌شده (incomplete) ---------- */
echo "۵) pull صفحه‌بندی‌شده\n";
// ساخت ۸۵۰ لیست با REST (بیش از PULL_LIMIT=800)
$made = 0;
for ($i = 0; $i < 850; $i++) {
    $id = sprintf('eeee1111-0000-4000-8000-%012d', $i);
    [$st] = http('POST', '/api/v1/lists', ['id' => $id, 'name' => 'صفحه‌بندی ' . $i, 'emoji' => '📄', 'color' => 'teal', 'updatedAt' => gmdate('Y-m-d\TH:i:s\Z')], $tokA);
    if ($st === 201) {
        $made++;
    }
}
check('۸۵۰ لیست ساخته شد', $made === 850, 'made=' . $made);

$totalSeen = [];
$incompleteRounds = 0;
$cursor = null; // سینک تازه — مثل کلاینت واقعی
for ($round = 0; $round < 10; $round++) {
    [$st, $j] = syncCall($tokA, ['cursor' => $cursor, 'pull' => 1, 'deviceUuid' => 'device-a', 'changes' => ch()]);
    if ($st !== 200) {
        break;
    }
    foreach ($j['server']['lists'] ?? [] as $r) {
        $totalSeen[$r['id']] = true;
    }
    if (!empty($j['incomplete'])) {
        $incompleteRounds++;
        check('پرچم incomplete + سقف ۸۰۰ در هر رفت', count($j['server']['lists']) <= 801);
        // ادامه از انتهای صفحه — مثل کلاینت واقعی (pageCursor ذخیره نمی‌شود)
        if (!empty($j['pageCursor'])) {
            $cursor = $j['pageCursor'];
        }
        continue;
    }
    break;
}
check('چرخه‌ی صفحه‌بندی همه را آورد (بدون skip)', count($totalSeen) >= 856, 'seen=' . count($totalSeen) . ' rounds=' . $incompleteRounds);

/* ---------- ۶) پرچم pull=0 ---------- */
echo "۶) چانک push-only (pull=0)\n";
$P1 = 'ffff1111-0000-4000-8000-000000000001';
[$st, $j] = syncCall($tokA, ['cursor' => null, 'pull' => 0, 'deviceUuid' => 'device-a', 'changes' => ch([listRow($P1, 'چانک میانی', gmdate('Y-m-d\TH:i:s\Z'))])]);
check('push-only موفق و بدون server پر', $st === 200 && empty($j['server']['lists'] ?? []) && empty($j['server']['tasks'] ?? []));

/* ---------- ۷) سقف آیتم (گارد ۴۲۲) + چانک زیر سقف ---------- */
echo "۷) سقف آیتم و استراتژی چانک\n";
// کاربر B جدا برای آلوده نشدن شمارنده‌ها
sleep(2);
[$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'syncchunk@example.com']);
$code = (string) $j['devCode'];
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'syncchunk@example.com', 'code' => $code, 'deviceUuid' => 'bbbb2222-0000-4000-8000-000000000001']);
check('ورود کاربر B', $st === 200 && isset($j['accessToken']));
$tokB = (string) $j['accessToken'];

$big = [];
for ($i = 0; $i < 2001; $i++) {
    $big[] = listRow(sprintf('99991111-0000-4000-8000-%012d', $i), 'سقف ' . $i, gmdate('Y-m-d\TH:i:s\Z'));
}
[$st, $j] = syncCall($tokB, ['cursor' => null, 'pull' => 1, 'deviceUuid' => 'device-b', 'changes' => ch($big)]);
check('عبور از سقف (۲۰۰۱ آیتم) → ۴۲۲ گارد نهایی', $st === 422, 'status=' . $st);

// استراتژی کلاینت: چانک ۱۰۰تایی زیر سقف → همه اعمال می‌شود
$ok = true;
$appliedTotal = 0;
for ($i = 0; $i < 250; $i += 100) {
    $part = [];
    for ($k = $i; $k < min($i + 100, 250); $k++) {
        $part[] = listRow(sprintf('88881111-0000-4000-8000-%012d', $k), 'چانک ' . $k, gmdate('Y-m-d\TH:i:s\Z'));
    }
    [$st, $j] = syncCall($tokB, ['cursor' => null, 'pull' => 0, 'deviceUuid' => 'device-b', 'changes' => ch($part)]);
    if ($st !== 200) {
        $ok = false;
        break;
    }
    $appliedTotal += (int) ($j['applied']['lists'] ?? 0);
}
check('چانک زیر سقف همگی اعمال شدند', $ok && $appliedTotal === 250, 'applied=' . $appliedTotal);

echo "\n═══ نتیجه: {$pass} موفق / {$fail} ناموفق ═══\n";
exit($fail === 0 ? 0 : 1);

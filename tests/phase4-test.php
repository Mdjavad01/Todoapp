<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی فاز ۴ (پنل مدیریت)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *
 * اجرا:  php tests/phase4-test.php
 * (DB محلی هر بار از نو ساخته می‌شود؛ ادمین‌ها مستقیم در DB seed می‌شوند)
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
        $v = trim(substr($line, $pos + 1));
        return trim($v, '"\'');
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

/** seed مستقیم ادمین‌ها در DB (معادل setup-admin.php) */
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

/** seed کاربر + هویت + داده */
function seedUser(string $email, string $name, int $lists, int $tasks, int $completed): int
{
    $pdo = db();
    $ins = $pdo->prepare("INSERT INTO users (uuid, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
    $ins->execute([uuid4(), $name]);
    $uid = (int) $pdo->lastInsertId();

    $idn = $pdo->prepare("INSERT INTO user_identities (user_id, type, value, is_primary, verified_at) VALUES (?, 'email', ?, 1, strftime('%Y-%m-%d %H:%M:%S','now'))");
    $idn->execute([$uid, $email]);

    for ($i = 0; $i < $lists; $i++) {
        $li = $pdo->prepare("INSERT INTO lists (uuid, user_id, name, created_at, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
        $li->execute([uuid4(), $uid, "لیست {$i}"]);
        $listId = (int) $pdo->lastInsertId();
        for ($j = 0; $j < $tasks; $j++) {
            $done = $j < $completed ? gmdate('Y-m-d H:i:s') : null;
            $ti = $pdo->prepare('INSERT INTO tasks (uuid, user_id, list_id, title, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%S\',\'now\'), strftime(\'%Y-%m-%d %H:%M:%S\',\'now\'))');
            $ti->execute([uuid4(), $uid, $listId, "کار {$i}-{$j}", $done]);
        }
    }

    // دو نشست فعال + یک باطل‌شده
    $rt = $pdo->prepare("INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at, issued_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now','+180 days'), strftime('%Y-%m-%d %H:%M:%S','now'))");
    $rt->execute([$uid, uuid4(), hash('sha256', $email . 'dev-token-1')]);
    $rt->execute([$uid, uuid4(), hash('sha256', $email . 'dev-token-2')]);
    $rt = $pdo->prepare("INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at, issued_at, revoked_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now','+180 days'), strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
    $rt->execute([$uid, uuid4(), hash('sha256', $email . 'dev-token-3')]);

    return $uid;
}

/* ================= setup ================= */
resetEnvironment();
$bossId = seedAdmin('boss', 'BossPass123', 'superadmin');
$helperId = seedAdmin('helper', 'HelperPass123', 'support');
$u1 = seedUser('sara@test.ir', 'سارا تستی', 2, 5, 2);
$u2 = seedUser('reza@test.ir', 'رضا دومی', 1, 2, 0);
echo "— آماده‌سازی: دیتابیس نو + ادمین‌ها (boss/helper) + ۲ کاربر seed شد\n\n";

/* ================= ۱) گیت بدون احراز ================= */
echo "۱) محافظت مسیرهای ادمین\n";
[$st, $j] = http('GET', '/api/admin/stats');
check('stats بدون توکن → 401', $st === 401 && ($j['code'] ?? '') === 'unauthorized');

[$st] = http('GET', '/api/admin/users');
check('users بدون توکن → 401', $st === 401);

[$st] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'WRONG!']);
check('رمز غلط → 401', $st === 401);

/* ================= ۲) قفل تلاش ناموفق ================= */
echo "۲) قفل حساب پس از ۵ تلاش ناموفق\n";
for ($i = 0; $i < 4; $i++) {
    [$st] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'nope-nope-' . $i]);
    check("تلاش {$i} → 401", $st === 401);
}
[$st, $j] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'nope-final']);
check('تلاش پنجم → قفل 423', $st === 423 && ($j['code'] ?? '') === 'locked');

[$st] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'BossPass123']);
check('حتی رمز درست در قفل → 423', $st === 423);

// بازکردن قفل مستقیم در DB
db()->prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$bossId]);

/* ================= ۳) ورود موفق + CSRF ================= */
echo "۳) ورود، نشست و CSRF\n";
[$st, $j] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'BossPass123']);
check('ورود درست → token + csrf + نقش', $st === 200 && is_string($j['token'] ?? null) && is_string($j['csrfToken'] ?? null) && ($j['admin']['roleCode'] ?? '') === 'superadmin');
$tok = $j['token'];
$csrf = $j['csrfToken'];

[$st] = http('POST', '/api/admin/logout', null, $tok);
check('logout بدون CSRF → 403', $st === 403);

[$st, $j] = http('GET', '/api/admin/me', null, $tok);
check('me → نام کاربری و دسترسی‌ها', $st === 200 && ($j['admin']['username'] ?? '') === 'boss' && in_array('users.manage', $j['permissions'] ?? [], true));

/* ================= ۴) داشبورد ================= */
echo "۴) داشبورد آمار\n";
[$st, $j] = http('GET', '/api/admin/stats', null, $tok);
$s = $j['stats'] ?? [];
check('stats → 200', $st === 200);
check('کل کاربران = ۲', ($s['users']['total'] ?? 0) === 2);
check('لیست‌ها = ۳', ($s['content']['lists'] ?? 0) === 3);
check('کارها = ۱۲', ($s['content']['tasks'] ?? 0) === 12);
check('انجام‌شده = ۴', ($s['content']['tasksCompleted'] ?? 0) === 4);
check('نشست فعال = ۴ (۲+۲)', ($s['sessions'] ?? 0) === 4);
check('سری ثبت‌نام ۷ روزه', count($s['signupsSeries'] ?? []) === 7);

/* ================= ۵) کاربران: فهرست/جستجو/جزئیات ================= */
echo "۵) کاربران\n";
[$st, $j] = http('GET', '/api/admin/users', null, $tok);
check('فهرست → ۲ کاربر با شمارنده‌ها', $st === 200 && ($j['total'] ?? 0) === 2 && ($j['items'][0]['tasksCount'] ?? 0) > 0);

[$st, $j] = http('GET', '/api/admin/users?q=sara@test.ir', null, $tok);
check('جستجو با ایمیل → فقط سارا', ($j['total'] ?? 0) === 1 && ($j['items'][0]['displayName'] ?? '') === 'سارا تستی');

[$st, $j] = http('GET', '/api/admin/users?status=blocked', null, $tok);
check('فیلتر مسدود → صفر', ($j['total'] ?? 0) === 0);

[$st, $j] = http('GET', "/api/admin/users/{$u1}", null, $tok);
check('جزئیات → هویت ایمیل + ۱۰ کار', $st === 200 && ($j['identities'][0]['value'] ?? '') === 'sara@test.ir' && ($j['counts']['tasks'] ?? 0) === 10 && ($j['counts']['activeSessions'] ?? 0) === 2);

[$st] = http('GET', '/api/admin/users/99999', null, $tok);
check('کاربر ناموجود → 404', $st === 404);

/* ================= ۶) تغییر وضعیت + ابطال خودکار ================= */
echo "۶) مسدودسازی و ابطال نشست‌ها\n";
[$st] = http('PATCH', "/api/admin/users/{$u1}", ['status' => 'blocked'], $tok, $csrf);
check('مسدودسازی → 200', $st === 200);

$revoked = (int) q1('SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NOT NULL', [$u1]);
check('مسدودسازی → همه‌ی نشست‌های کاربر باطل شد', $revoked === 3);

[$st, $j] = http('GET', "/api/admin/users/{$u1}", null, $tok);
check('وضعیت در جزئیات = blocked', ($j['user']['status'] ?? '') === 'blocked');

[$st] = http('PATCH', "/api/admin/users/{$u1}", ['status' => 'active'], $tok, $csrf);
check('رفع مسدودی → 200', $st === 200);

/* ================= ۷) اعطای پرو ================= */
echo "۷) اعطای اشتراک پرو\n";
[$st, $j] = http('POST', "/api/admin/users/{$u1}/premium", ['planCode' => 'monthly'], $tok, $csrf);
check('اعطای ماهانه → 200', $st === 200);
$pu = $j['premiumUntil'] ?? '';
check('premium_until ≈ +۳۰ روز', $pu !== '' && (strtotime($pu) - time()) > 29 * 86400 && (strtotime($pu) - time()) < 32 * 86400);

$sub = db()->query("SELECT source, plan_id, expires_at FROM subscriptions WHERE user_id = {$u1} ORDER BY id DESC LIMIT 1")->fetch();
$planId = (int) db()->query("SELECT id FROM plans WHERE code = 'monthly'")->fetchColumn();
check('اشتراک با منبع admin_grant ثبت شد', $sub !== false && $sub['source'] === 'admin_grant' && (int) $sub['plan_id'] === $planId);

[$st, $j] = http('POST', "/api/admin/users/{$u1}/premium", ['lifetime' => true], $tok, $csrf);
check('اعطای دائمی → 9999-12-31', $st === 200 && ($j['premiumUntil'] ?? '') === '9999-12-31 23:59:59');

[$st] = http('PATCH', "/api/admin/users/{$u1}", ['premiumUntil' => null], $tok, $csrf);
check('لغو پرو دستی → 200', $st === 200);
[$st, $j] = http('GET', "/api/admin/users/{$u1}", null, $tok);
check('پرو لغو شد', ($j['user']['isPremium'] ?? true) === false && array_key_exists('premiumUntil', $j['user'] ?? []) && ($j['user']['premiumUntil'] ?? null) === null);

/* ================= ۸) پلن‌ها ================= */
echo "۸) پلن‌ها\n";
[$st, $j] = http('GET', '/api/admin/plans', null, $tok);
$monthlyId = 0;
$found = false;
foreach ($j['items'] ?? [] as $p) {
    if ($p['code'] === 'monthly') {
        $monthlyId = $p['id'];
        $found = $p['priceTomans'] === 49000;
    }
}
check('سه پلن با قیمت seed', $st === 200 && count($j['items'] ?? []) === 3 && $found);

[$st] = http('PATCH', "/api/admin/plans/{$monthlyId}", ['priceTomans' => 50000, 'title' => 'اشتراک ماهانه ویژه'], $tok, $csrf);
check('ویرایش پلن → 200', $st === 200);
[$st, $j] = http('GET', '/api/admin/plans', null, $tok);
$ok = false;
foreach ($j['items'] ?? [] as $p) {
    if ($p['code'] === 'monthly') {
        $ok = $p['priceTomans'] === 50000 && $p['title'] === 'اشتراک ماهانه ویژه';
    }
}
check('قیمت/عنوان جدید اعمال شد', $ok);

[$st] = http('PATCH', "/api/admin/plans/{$monthlyId}", ['priceTomans' => -5], $tok, $csrf);
check('قیمت منفی → 422', $st === 422);

/* ================= ۹) اطلاعیه‌ها ================= */
echo "۹) اطلاعیه‌ها\n";
[$st, $j] = http('POST', '/api/admin/announcements', ['title' => 'به‌روزرسانی بزرگ', 'body' => 'نسخه‌ی جدید کارام با تقویم شمسی بهبودیافته منتشر شد.', 'type' => 'info', 'isActive' => true], $tok, $csrf);
$annId = (int) ($j['id'] ?? 0);
check('ساخت اطلاعیه → 201', $st === 201 && $annId > 0);

[$st, $j] = http('GET', '/api/admin/announcements', null, $tok);
check('فهرست شامل اطلاعیه جدید', ($j['total'] ?? 0) === 1 && ($j['items'][0]['title'] ?? '') === 'به‌روزرسانی بزرگ');

[$st] = http('PATCH', "/api/admin/announcements/{$annId}", ['isActive' => false], $tok, $csrf);
check('غیرفعال‌سازی → 200', $st === 200);

[$st] = http('POST', '/api/admin/announcements', ['title' => 'کم', 'body' => 'متن کوتاه'], $tok, $csrf);
check('عنوان ۲ حرفی → 422', $st === 422);

[$st] = http('DELETE', "/api/admin/announcements/{$annId}", null, $tok, $csrf);
check('حذف → 200', $st === 200);
[$st] = http('GET', "/api/admin/announcements", null, $tok);
[$st2] = http('DELETE', "/api/admin/announcements/{$annId}", null, $tok, $csrf);
check('حذف دوباره → 404', $st2 === 404);

/* ================= ۱۰) تنظیمات ================= */
echo "۱۰) تنظیمات\n";
[$st, $j] = http('GET', '/api/admin/settings', null, $tok);
check('فهرست تنظیمات + کلیدهای قابل‌ویرایش', $st === 200 && in_array('app_name', $j['editable'] ?? [], true));

[$st] = http('PATCH', '/api/admin/settings', ['app_name' => 'کارام آزمایشی'], $tok, $csrf);
check('تغییر app_name → 200', $st === 200);
$val = db()->query("SELECT value FROM settings WHERE `key` = 'app_name'")->fetchColumn();
check('مقدار جدید در DB', $val === 'کارام آزمایشی');

[$st] = http('PATCH', '/api/admin/settings', ['bogus_key' => 'x'], $tok, $csrf);
check('کلید ناشناس → 422', $st === 422);

[$st] = http('PATCH', '/api/admin/settings', ['maintenance_mode' => '2'], $tok, $csrf);
check('بولی نامعتبر → 422', $st === 422);

// گام ۱ — به‌روزرسانی تست: کلید card_numbers در فاز ۱۴ حذف شد؛ اعتبارسنجی JSON الان روی هدر پیامک است
[$st] = http('PATCH', '/api/admin/settings', ['provider_sms_headers' => 'not-json'], $tok, $csrf);
check('هدر پیامک غیر JSON → 422', $st === 422);

[$st] = http('PATCH', '/api/admin/settings', ['provider_sms_headers' => '{"Authorization":"Bearer TEST"}'], $tok, $csrf);
check('هدر پیامک JSON معتبر → 200', $st === 200);
$headers = db()->query("SELECT value FROM settings WHERE `key` = 'provider_sms_headers'")->fetchColumn();
check('هدر پیامک در DB', (string) $headers === '{"Authorization":"Bearer TEST"}');

/* ================= ۱۱) لاگ رخدادها ================= */
echo "۱۱) لاگ رخدادها\n";
[$st, $j] = http('GET', '/api/admin/audit', null, $tok);
$actions = array_column($j['items'] ?? [], 'action');
check('audit → شامل اعطای پرو و تغییر تنظیمات', $st === 200 && in_array('user.premium_grant', $actions, true) && in_array('settings.update', $actions, true));

[$st, $j] = http('GET', '/api/admin/audit?actor=admin', null, $tok);
$allAdmin = true;
foreach ($j['items'] ?? [] as $r) {
    if ($r['actorType'] !== 'admin') {
        $allAdmin = false;
    }
}
check('فیلتر بازیگر ادمین', $allAdmin && ($j['total'] ?? 0) > 0);

[$st, $j] = http('GET', '/api/admin/audit?action=settings.', null, $tok);
check('فیلتر نوع رخداد settings.', ($j['total'] ?? 0) >= 1);

/* ================= ۱۲) نقش پشتیبان (دسترسی‌ها) ================= */
echo "۱۲) سطوح دسترسی (support)\n";
[$st, $j] = http('POST', '/api/admin/login', ['username' => 'helper', 'password' => 'HelperPass123']);
check('ورود پشتیبان → 200', $st === 200);
$htok = $j['token'];
$hcsrf = $j['csrfToken'];

[$st] = http('GET', '/api/admin/users', null, $htok);
check('users.view → مجاز', $st === 200);

[$st] = http('PATCH', '/api/admin/settings', ['app_name' => 'هک'], $htok, $hcsrf);
check('settings.manage → ممنوع (403)', $st === 403);

[$st] = http('PATCH', "/api/admin/plans/{$monthlyId}", ['priceTomans' => 1], $htok, $hcsrf);
check('plans.manage → ممنوع (403)', $st === 403);

[$st] = http('POST', "/api/admin/users/{$u2}/premium", ['lifetime' => true], $htok, $hcsrf);
check('users.manage → ممنوع (403)', $st === 403);

/* ================= ۱۳) خروج ================= */
echo "۱۳) خروج\n";
[$st] = http('POST', '/api/admin/logout', null, $tok, $csrf);
check('logout → 200', $st === 200);
[$st] = http('GET', '/api/admin/stats', null, $tok);
check('توکن بعد از خروج → 401', $st === 401);

/* ================= نتیجه ================= */
echo "\n════════════════════════════\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

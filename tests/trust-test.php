<?php

declare(strict_types=1);

/**
 * کارام — تست یکپارچه‌ی بسته‌ی ایمنی و اعتماد (v1.9)
 *
 * پوشش:
 *   ۱) health واقعی: عمومی حداقلی (200/ok) + ادمین کامل (بدون نشست = 401، با نشست = چک‌ها)
 *   ۲) ماسک رازها: GET مقدار واقعی نمی‌دهد (فقط isSet/last4)؛ Audit راز ندارد؛
 *      مقدار ماسک‌شده بازنویسی نمی‌کند؛ پاک‌کردن صریح '' کار می‌کند
 *   ۳) دریافت داده (export): شکل و شمارش کامل
 *   ۴) حذف حساب دومرحله‌ای: کد جدا از ورود (کدِ حذف برای ورود کار نمی‌کند)،
 *      تایپ تأیید الزامی، حذف کامل (لیست/کار/زیرکار/هویت/توکن/OTP)، پوسته‌ی بی‌نام،
 *      سوابق مالی می‌ماند، provider_logs تطهیر می‌شود، توکن‌ها بلافاصله رد می‌شوند
 *   ۵) حذف کاربر ادمینی: + Audit + 409 برای دوباره
 *   ۶) کرون نگه‌داری: 404 بدون کلید، dry-run حذف نمی‌کند، اجرای واقعی پاک می‌کند
 *      (لیستِ تومب‌استون با کار زنده حفظ می‌شود) و وضعیت ثبت می‌شود
 *   ۷) بکاپ (P1.1/P1.2): هم‌نسازی فهرست رازها، کلید وضعیت، SHOW CREATE TABLE
 *      ناموفق → fail، اسکنر settings در dump (fallback به php-dump)، php-dump
 *      بدون ردّ بی‌صدا و پاک‌سازی فایل‌های موقت هنگام شکست
 *
 * پیش‌نیاز اجرا:
 *   /tmp/php -S 127.0.0.1:8099 -t backend/public        → API
 *
 * اجرا:  /tmp/php tests/trust-test.php
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
        CURLOPT_TIMEOUT => 20,
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
        return trim(substr($line, $pos + 1), '"\'');
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

/** ثبت‌نام/ورود کاربر با جریان dev OTP (محیط توسعه) — خروجی: [token, refresh, userId] */
function loginEmail(string $email): array
{
    http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $email]);
    usleep(1_300_000); // resendAfter=1s در .env تست
    [, $r2] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $email]);
    $code = (string) ($r2['devCode'] ?? '');
    if ($code === '') {
        return ['', '', 0];
    }
    [, $v] = http('POST', '/api/auth/otp/verify', [
        'channel' => 'email', 'target' => $email, 'code' => $code,
        'deviceName' => 'تست', 'deviceUuid' => uuid4(),
    ]);
    $token = (string) ($v['accessToken'] ?? '');
    // userId از دیتابیس
    $stmt = db()->prepare('SELECT u.id FROM users u JOIN user_identities i ON i.user_id = u.id WHERE i.value = ? LIMIT 1');
    $stmt->execute([$email]);
    return [$token, (string) ($v['refreshToken'] ?? ''), (int) $stmt->fetchColumn()];
}

/* ================= setup ================= */
resetEnvironment();
seedAdmin('boss', 'BossPass123', 'superadmin');
echo "— آماده‌سازی: دیتابیس نو + ادمین seed شد\n";
@mkdir(ROOT . '/backend/storage/cache', 0775, true);
@unlink(ROOT . '/backend/storage/cache/retention-state.json');

/* ================= ۱) سلامت عمومی و ادمین ================= */
echo "\n۱) health واقعی\n";
[$st, $j] = http('GET', '/api/health');
check('health عمومی → 200 و ok و status=ok', $st === 200 && ($j['ok'] ?? false) === true && ($j['status'] ?? '') === 'ok');
check('health عمومی حداقلی است (php/version ندارد)', !isset($j['php']) && !isset($j['warnings']));

[$st, $j] = http('GET', '/api/admin/health');
check('health ادمین بدون نشست → 401', $st === 401);

[$st, $j] = http('POST', '/api/admin/login', ['username' => 'boss', 'password' => 'BossPass123']);
check('ورود boss → 200', $st === 200 && isset($j['token']));
$bossToken = (string) ($j['token'] ?? '');
$bossCsrf = (string) ($j['csrfToken'] ?? '');

[$st, $j] = http('GET', '/api/admin/health', null, $bossToken);
check('health ادمین → 200 با چک‌ها', $st === 200 && isset($j['checks']['database']['ok']));
check('health ادمین: دیتابیس و storage سالم', ($j['checks']['database']['ok'] ?? false) === true && ($j['checks']['storage']['ok'] ?? false) === true);
check('health ادمین: وضعیت هر سه کرون گزارش می‌شود', isset($j['checks']['crons']['reminder'], $j['checks']['crons']['backup'], $j['checks']['crons']['retention']));
check('health ادمین: راز ندارد (بدون token/pass/merchant)', strpos(json_encode($j, JSON_UNESCAPED_UNICODE), 'LOCALTEST') === false && !isset($j['checks']['secrets']));

/* ================= ۲) ماسک رازها ================= */
echo "\n۲) ماسک رازها در تنظیمات ادمین\n";
[$st, $j] = http('PATCH', '/api/admin/settings', ['smtp_pass' => 'SuperSecret-123', 'telegram_bot_token' => '123:LOCALTEST-XYZ'], $bossToken, $bossCsrf);
check('ذخیره‌ی رازها → 200', $st === 200);

check('مقدار واقعی در DB است', (string) q1("SELECT value FROM settings WHERE key = 'smtp_pass'") === 'SuperSecret-123');

[$st, $j] = http('GET', '/api/admin/settings', null, $bossToken);
$items = [];
foreach (($j['items'] ?? []) as $it) {
    $items[$it['key']] = $it;
}
check('GET: smtp_pass مقدار خالی برمی‌گرداند', ($items['smtp_pass']['value'] ?? 'x') === '');
check('GET: smtp_pass فقط isSet/last4 دارد', ($items['smtp_pass']['secret']['isSet'] ?? false) === true && ($items['smtp_pass']['secret']['last4'] ?? '') === '-123');
check('GET: توکن ربات هم ماسک است', ($items['telegram_bot_token']['value'] ?? 'x') === '' && ($items['telegram_bot_token']['secret']['last4'] ?? '') === '-XYZ');
check('secretKeys در پاسخ هست', in_array('smtp_pass', $j['secretKeys'] ?? [], true));
check('هیچ مقدار رازی در کل پاسخ نیست', strpos((string) json_encode($j, JSON_UNESCAPED_UNICODE), 'SuperSecret-123') === false);

// Audit نباید راز داشته باشد
$auditJson = (string) q1("SELECT details FROM audit_logs WHERE action = 'settings.update' ORDER BY id DESC LIMIT 1");
check('Audit راز را ثبت نکرده', $auditJson !== '' && strpos($auditJson, 'SuperSecret-123') === false && strpos($auditJson, 'تغییر کرد') !== false);

// ارسال مقدار ماسک‌شده → بازنویسی نمی‌شود
[$st, $j] = http('PATCH', '/api/admin/settings', ['smtp_pass' => '••••-123'], $bossToken, $bossCsrf);
check('PATCH با مقدار ماسک → نادیده گرفته شد', (string) q1("SELECT value FROM settings WHERE key = 'smtp_pass'") === 'SuperSecret-123');

// پاک‌کردن صریح با '' → واقعاً خالی می‌شود
[$st, $j] = http('PATCH', '/api/admin/settings', ['smtp_pass' => ''], $bossToken, $bossCsrf);
check('PATCH خالی → راز پاک شد', (string) q1("SELECT value FROM settings WHERE key = 'smtp_pass'") === '');

// بازگذاری برای ادامه‌ی تست‌ها
http('PATCH', '/api/admin/settings', ['smtp_pass' => 'SuperSecret-123'], $bossToken, $bossCsrf);

/* ================= ۳) دریافت داده (export) ================= */
echo "\n۳) دریافت داده (GET /api/v1/me/export)\n";
[$tokU, $refU, $uid] = loginEmail('export-user@x.com');
check('ورود کاربر export → توکن دارد', $tokU !== '');
sleep(2); // فاصله‌ی ارسال OTP برای درخواست‌های بعدی

// داده: ۱ لیست + ۲ کار + ۱ زیرکار (سینک واقعی)
http('POST', '/api/v1/sync', ['deviceUuid' => uuid4(), 'changes' => [
    'lists' => [['id' => uuid4(), 'name' => 'کارهای من', 'emoji' => '📋', 'color' => 'teal', 'sortOrder' => 0, 'createdAt' => gmdate('Y-m-d\\TH:i:s.000\\Z'), 'updatedAt' => gmdate('Y-m-d\\TH:i:s.000\\Z')]],
]], $tokU);
$lid = (string) q1('SELECT uuid FROM lists WHERE user_id = ?', [$uid]);
$tasks = [];
for ($i = 0; $i < 2; $i++) {
    $tasks[] = ['id' => uuid4(), 'listId' => $lid, 'title' => "کار {$i}", 'priority' => 'normal', 'repeat' => 'none', 'starred' => false, 'createdAt' => gmdate('Y-m-d\\TH:i:s.000\\Z'), 'updatedAt' => gmdate('Y-m-d\\TH:i:s.000\\Z')];
}
http('POST', '/api/v1/sync', ['deviceUuid' => uuid4(), 'changes' => ['tasks' => $tasks]], $tokU);
$tid = (string) q1('SELECT uuid FROM tasks WHERE user_id = ? LIMIT 1', [$uid]);
http('POST', '/api/v1/sync', ['deviceUuid' => uuid4(), 'changes' => [
    'subtasks' => [['id' => uuid4(), 'taskId' => $tid, 'title' => 'زیرکار ۱', 'done' => false, 'createdAt' => gmdate('Y-m-d\\TH:i:s.000\\Z'), 'updatedAt' => gmdate('Y-m-d\\TH:i:s.000\\Z')]],
]], $tokU);

[$st, $j] = http('GET', '/api/v1/me/export', null, $tokU);
check('export → 200 و kind درست', $st === 200 && ($j['kind'] ?? '') === 'karam-account-export');
check('export: شمارش‌ها درست (۱/۲/۱)', ($j['counts']['lists'] ?? 0) === 1 && ($j['counts']['tasks'] ?? 0) === 2 && ($j['counts']['subtasks'] ?? 0) === 1);
check('export: محتوا واقعی است', ($j['lists'][0]['name'] ?? '') === 'کارهای من' && ($j['tasks'][0]['title'] ?? '') === 'کار 0');
check('export: بدون توکن → 401', http('GET', '/api/v1/me/export')[0] === 401);

/* ================= ۴) حذف حساب دومرحله‌ای ================= */
echo "\n۴) حذف حساب (دومرحله‌ای)\n";
// سوابق مالی + لاگ جانبی برای «باقی‌ماندن/تطهیرشدن»
db()->exec("INSERT INTO plans (uuid, code, title, months, price_tomans) VALUES ('" . uuid4() . "', 'monthly', 'اشتراک ماهانه', 1, 49000) ON CONFLICT(code) DO NOTHING");
$planId = (int) q1("SELECT id FROM plans WHERE code = 'monthly'");
db()->exec("INSERT INTO orders (uuid, user_id, plan_id, amount_tomans, status) VALUES ('" . uuid4() . "', {$uid}, {$planId}, 49000, 'paid')");
$orderId = (int) q1("SELECT id FROM orders WHERE user_id = {$uid}");
db()->exec("INSERT INTO payments (uuid, order_id, gateway, status, amount_tomans) VALUES ('" . uuid4() . "', {$orderId}, 'zibal', 'paid', 49000)");
db()->exec("INSERT INTO provider_logs (provider, direction, status, identity, subject) VALUES ('smtp', 'out', 'success', 'export-user@x.com', 'کد ورود')");

[$st, $j] = http('POST', '/api/v1/me/delete-request', null, $tokU);
check('درخواست کد حذف → 200 و confirmText درست', $st === 200 && ($j['confirmText'] ?? '') === 'حذف حساب');
check('هدف ماسک شده (ایمیل کامل نمی‌آید)', !str_contains((string) ($j['target'] ?? ''), 'export-user@x.com'));
$delCode = (string) ($j['devCode'] ?? '');
check('کد دومرحله‌ای با devCode توسعه آمده', preg_match('/^\d{6}$/', $delCode) === 1);

// ۴-الف) کدِ حذف حساب برای ورود کار نمی‌کند (purpose جدا)
sleep(2); // فاصله‌ی ارسال
[, $lr] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => 'export-user@x.com']);
$wrongLoginCode = '000000';
[$st, $j] = http('POST', '/api/auth/otp/verify', ['channel' => 'email', 'target' => 'export-user@x.com', 'code' => $delCode, 'deviceUuid' => uuid4()]);
check('کدِ حذف برای ورود رد می‌شود', $st === 400 && ($j['code'] ?? '') === 'invalid');

// ۴-ب) تأیید ناقص
[$st, $j] = http('POST', '/api/v1/me/delete', ['code' => $delCode, 'confirmText' => 'حذف کارها'], $tokU);
check('تایپ تأیید غلط → 422', $st === 422);
[$st, $j] = http('POST', '/api/v1/me/delete', ['code' => '000000', 'confirmText' => 'حذف حساب'], $tokU);
check('کد غلط → 400', $st === 400 && ($j['code'] ?? '') === 'invalid');

// کد تازه بگیر (کد قبلی با تلاش اشتباه مصرف/قفل شده)
sleep(2);
[, $jr] = http('POST', '/api/v1/me/delete-request', null, $tokU);
$delCode = (string) ($jr['devCode'] ?? '');
check('کد دوم صادر شد', preg_match('/^\d{6}$/', $delCode) === 1);

[$st, $j] = http('POST', '/api/v1/me/delete', ['code' => $delCode, 'confirmText' => 'حذف حساب'], $tokU);
check('حذف نهایی → 200 و deleted', $st === 200 && ($j['deleted'] ?? false) === true);

// ۴-ج) پاک‌سازی واقعی
check('لیست‌ها سخت پاک شدند', (int) q1('SELECT COUNT(*) FROM lists WHERE user_id = ?', [$uid]) === 0);
check('کارها سخت پاک شدند', (int) q1('SELECT COUNT(*) FROM tasks WHERE user_id = ?', [$uid]) === 0);
check('زیرکارها سخت پاک شدند', (int) q1('SELECT COUNT(*) FROM subtasks WHERE user_id = ?', [$uid]) === 0);
check('هویت‌ها پاک شدند', (int) q1('SELECT COUNT(*) FROM user_identities WHERE user_id = ?', [$uid]) === 0);
check('توکن‌های دستگاه پاک شدند', (int) q1('SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?', [$uid]) === 0);
check('OTPهای هویتِ کاربر پاک شدند', (int) q1("SELECT COUNT(*) FROM otp_requests WHERE identity_value = 'export-user@x.com'") === 0);
check('پوسته‌ی کاربر: status=deleted و نام NULL', (string) q1('SELECT status FROM users WHERE id = ?', [$uid]) === 'deleted' && q1('SELECT display_name FROM users WHERE id = ?', [$uid]) === null);
check('سوابق مالی ماند (سفارش و پرداخت)', (int) q1('SELECT COUNT(*) FROM orders WHERE user_id = ?', [$uid]) === 1 && (int) q1("SELECT COUNT(*) FROM payments WHERE status = 'paid'") === 1);
check('provider_logs تطهیر شد (identity بی‌نام)', (string) q1("SELECT identity FROM provider_logs WHERE subject = 'کد ورود'") === '');
check('Audit حذف ثبت شد', (int) q1("SELECT COUNT(*) FROM audit_logs WHERE action = 'account.delete' AND actor_id = ?", [$uid]) >= 1);

[$st, $j] = http('GET', '/api/v1/me', null, $tokU);
check('توکن قبلی بلافاصله رد می‌شود (401)', $st === 401);
[$st, $j] = http('POST', '/api/auth/refresh', ['refreshToken' => $refU]);
check('refresh هم رد می‌شود', $st === 401);

/* ================= ۵) حذف کاربر ادمینی ================= */
echo "\n۵) حذف کاربر با پنل ادمین\n";
[$tokV, , $vid] = loginEmail('victim@x.com');
check('کاربر دوم ساخته شد', $vid > 0);

[$st, $j] = http('POST', "/api/admin/users/{$vid}/delete", [], $bossToken, $bossCsrf);
check('حذف ادمینی → 200 و پیام', $st === 200 && isset($j['removed']));
check('کاربر دوم هم کامل حذف شد', (string) q1('SELECT status FROM users WHERE id = ?', [$vid]) === 'deleted' && (int) q1('SELECT COUNT(*) FROM user_identities WHERE user_id = ?', [$vid]) === 0);
check('Audit ادمینی ثبت شد', (int) q1("SELECT COUNT(*) FROM audit_logs WHERE action = 'user.account_deleted' AND entity_id = ?", [(string) $vid]) >= 1);

[$st, $j] = http('POST', "/api/admin/users/{$vid}/delete", [], $bossToken, $bossCsrf);
check('حذف دوباره → 409 already_deleted', $st === 409 && ($j['code'] ?? '') === 'already_deleted');

[$st, $j] = http('POST', '/api/admin/users/999999/delete', [], $bossToken, $bossCsrf);
check('کاربر ناموجود → 404', $st === 404);

// بدون CSRF رد می‌شود
[$tokW, , $wid] = loginEmail('victim2@x.com');
[$st, $j] = http('POST', "/api/admin/users/{$wid}/delete", [], $bossToken);
check('حذف بدون CSRF → 403/401', $st === 403 || $st === 401);

/* ================= ۶) کرون نگه‌داری ================= */
echo "\n۶) کرون نگه‌داری (retention)\n";
$old = gmdate('Y-m-d H:i:s', time() - 200 * 86400);
$recent = gmdate('Y-m-d H:i:s', time() - 5 * 86400);
$pdo = db();
$pdo->exec("INSERT INTO otp_requests (identity_type, identity_value, code_hash, purpose, expires_at, created_at) VALUES ('email','old@x.com','x','login', '{$old}', '{$old}')");
$pdo->exec("INSERT INTO otp_requests (identity_type, identity_value, code_hash, purpose, expires_at, created_at) VALUES ('email','new@x.com','x','login', '" . gmdate('Y-m-d H:i:s', time() + 300) . "', '{$recent}')");
$pdo->exec("INSERT INTO provider_logs (provider, direction, status, identity, created_at) VALUES ('smtp','out','error','a@b.com','{$old}')");
$veryOld = gmdate('Y-m-d H:i:s', time() - 400 * 86400); // audit: آستانه پیش‌فرض ۳۶۵ روز
$pdo->exec("INSERT INTO audit_logs (actor_type, action, created_at) VALUES ('system','old.action','{$veryOld}')");
$pdo->exec("INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ({$uid}, 'dev-old', 'hash-old-aaaaaaaaaaaaaaaaaaaa', '{$old}')");

// کاربر سوم + لیست تومب‌استون قدیمی با یک کار زنده (نباید پاک شود)
[$tokC, , $cid] = loginEmail('keeper@x.com');
$pdo->exec("INSERT INTO lists (uuid, user_id, name, deleted_at) VALUES ('" . uuid4() . "', {$cid}, 'لیست مرده', '{$old}')");
$deadList = (int) q1("SELECT id FROM lists WHERE user_id = {$cid} AND deleted_at IS NOT NULL");
$pdo->exec("INSERT INTO tasks (uuid, user_id, list_id, title) VALUES ('" . uuid4() . "', {$cid}, {$deadList}, 'کار زنده')");
$pdo->exec("INSERT INTO subtasks (uuid, task_id, user_id, title, deleted_at) SELECT '" . uuid4() . "', id, user_id, 'زیرکار قدیمی', '{$old}' FROM tasks WHERE user_id = {$cid} AND deleted_at IS NULL LIMIT 1");

$phpBin = PHP_BINARY;
$cron = ROOT . '/backend/cron/retention-cron.php';

// dry-run (CLI) — فقط شمارش
@unlink(ROOT . '/backend/storage/cache/retention-state.json');
exec("{$phpBin} " . escapeshellarg($cron) . ' --dry 2>&1', $outDry, $codeDry);
$joined = implode("\n", $outDry);
check('dry-run CLI → موفق و شمارش OTP دارد', $codeDry === 0 && str_contains($joined, 'otp_requests'));
check('dry-run: هیچ چیز واقعاً پاک نشد', (int) q1("SELECT COUNT(*) FROM otp_requests WHERE identity_value = 'old@x.com'") === 1 && !str_contains($joined, 'پاک شد'));

// اجرای واقعی (CLI)
exec("{$phpBin} " . escapeshellarg($cron) . ' 2>&1', $outReal, $codeReal);
check('اجرای واقعی CLI → موفق', $codeReal === 0);
check('OTP قدیمی پاک شد، تازه ماند', (int) q1("SELECT COUNT(*) FROM otp_requests WHERE identity_value = 'old@x.com'") === 0 && (int) q1("SELECT COUNT(*) FROM otp_requests WHERE identity_value = 'new@x.com'") === 1);
check('لاگ پروایدر قدیمی پاک شد', (int) q1("SELECT COUNT(*) FROM provider_logs WHERE created_at < '{$old}'") === 0);
check('Audit قدیمی پاک شد', (int) q1("SELECT COUNT(*) FROM audit_logs WHERE action = 'old.action'") === 0);
check('توکن منقضی پاک شد، نشست فعال کاربر سوم سالم است', (int) q1("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = 'hash-old-aaaaaaaaaaaaaaaaaaaa'") === 0 && (int) q1('SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?', [$cid]) >= 1);
check('زیرکار تومب‌استون قدیمی پاک شد', (int) q1('SELECT COUNT(*) FROM subtasks WHERE deleted_at IS NOT NULL AND user_id = ?', [$cid]) === 0);
check('لیستِ تومب‌استون با کار زنده حفظ شد', (int) q1('SELECT COUNT(*) FROM lists WHERE id = ?', [$deadList]) === 1);
check('فایل وضعیت کرون ساخته شد', is_file(ROOT . '/backend/storage/cache/retention-state.json'));

[$st, $j] = http('GET', '/api/admin/health', null, $bossToken);
check('سلامت ادمین: کرون نگه‌داری حالا سالم است', ($j['checks']['crons']['retention']['ok'] ?? false) === true);

/* ================= P1.1 — فهرست رازها و شکست امن بکاپ ================= */

echo "\n— P1.1: فهرست رازها و شکست امن بکاپ —\n";

require_once ROOT . '/backend/src/Support/BackupMask.php';
require_once ROOT . '/backend/src/Controllers/AdminController.php';

check('فهرست رازها: BackupMask === AdminController (هم‌نسازی دائمی)', BackupMask::SECRET_KEYS === AdminController::SECRET_SETTING_KEYS, var_export(BackupMask::SECRET_KEYS, true) . ' vs ' . var_export(AdminController::SECRET_SETTING_KEYS, true));
check('فهرست رازها: بدون تکرار و دقیقاً ۵ کلید رسمی INSTALL ۱۹-۲', count(BackupMask::SECRET_KEYS) === 5 && count(array_unique(BackupMask::SECRET_KEYS)) === 5 && BackupMask::SECRET_KEYS === ['smtp_pass', 'telegram_bot_token', 'zibal_merchant', 'provider_sms_url', 'provider_sms_headers']);

$installSql = (string) file_get_contents(ROOT . '/deploy/install.sql');
$missingKeys = array_values(array_filter(BackupMask::SECRET_KEYS, fn ($k) => !str_contains($installSql, "('$k',")));
check('هر ۵ کلید راز در install.sql سید شده‌اند (پس از نصب تازه ماسک‌پذیرند)', $missingKeys === [], implode(',', $missingKeys));

// کلید وضعیت بکاپ — حالت «فقط تعریف» تا بکاپ اجرا نشود
define('KARAM_BACKUP_INCLUDE_ONLY', 1);
require_once ROOT . '/backend/cron/backup-db.php';
check('کلید وضعیت بکاپ: بدون .env = پیش‌فرض سازگار با عقب karam-backup-check', karam_backup_check_key() === 'karam-backup-check', karam_backup_check_key());

// شکست امن: SHOW CREATE TABLE ناموفق → exception (بکاپ fail و در فایل وضعیت ثبت می‌شود)
// نه اینکه جدول settings بی‌صدا از dump بیفتد (رفتار قدیمی P1 — حذف شد)
$threw = null;
$tmpProbe = (string) tempnam(sys_get_temp_dir(), 'karam-showcreate');
try {
    karam_backup_append_settings_section(new PDO('sqlite::memory:'), 'testdb', $tmpProbe);
} catch (Throwable $e) {
    $threw = $e;
}
check('SHOW CREATE TABLE ناموفق → RuntimeException (بکاپ fail)', $threw instanceof RuntimeException, $threw === null ? 'هیچ exception‌ای داده نشد' : get_class($threw));
$probeBody = (string) @file_get_contents($tmpProbe);
check('در شکست SHOW CREATE، فایل dump دست‌نخورده ماند (settings اضافه نشد)', !str_contains($probeBody, 'CREATE TABLE') && !str_contains($probeBody, 'INSERT INTO `settings`'));
@unlink($tmpProbe);

/* ================= P1.2 — بکاپ: گارد settings در dump، بدون ردّ بی‌صدا، پاک‌سازی شکست ================= */

echo "\n— P1.2: بکاپ — اسکن settings، SHOW CREATE بدون ردّ بی‌صدا، پاک‌سازی شکست —\n";

// (backup-db.php بالا با KARAM_BACKUP_INCLUDE_ONLY به‌صورت «فقط تعریف» لود شده است)

/** استاب PDO برای شبیه‌سازی رفتار MySQL در php-dump — SHOW TABLES/SHOW CREATE TABLE ساختگی روی SQLite واقعی */
final class KaramBackupPdoStub extends PDO
{
    public ?string $brokenTable = null; // این جدول در SHOW CREATE TABLE خطا می‌دهد (شبیه‌سازی)

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $q = ltrim($query);
        if (str_starts_with($q, 'SHOW TABLES')) {
            return parent::query('SELECT name FROM _karam_tables');
        }
        if (str_starts_with($q, 'SHOW CREATE TABLE')) {
            preg_match('/SHOW CREATE TABLE `([^`]+)`/', $q, $m);
            $tbl = (string) ($m[1] ?? '');
            if ($this->brokenTable !== null && $tbl === $this->brokenTable) {
                throw new PDOException('شبیه‌سازی تست: SHOW CREATE TABLE ناموفق بود');
            }
            return parent::query('SELECT tbl, ddl FROM _karam_create WHERE tbl = ' . $this->quote($tbl));
        }
        return parent::query($query);
    }
}

// ۱) اسکنر dump — بند ۴ (تابع جدا برای تست‌پذیری)
$scanFile = (string) tempnam(sys_get_temp_dir(), 'karam-scan');

file_put_contents($scanFile, "-- dump\nCREATE TABLE `settings` (\n  `key` varchar(191) NOT NULL\n);\nINSERT INTO `tasks` VALUES (1);\n");
check('اسکن dump: CREATE TABLE `settings` → true (fallback به php-dump لازم است)', karam_backup_dump_contains_settings($scanFile) === true);

file_put_contents($scanFile, "-- dump تمیز\n-- CREATE TABLE `settings` (فقط کامنت — ملاک نیست)\nCREATE TABLE `settings_log` (\n  id int\n);\nINSERT INTO `settings_journal` VALUES (1);\nINSERT INTO `tasks` VALUES (1);\n");
check('اسکن dump: کامنت و settings_log و settings_journal → false (فقط جدول واقعی settings ملاک است)', karam_backup_dump_contains_settings($scanFile) === false);

file_put_contents($scanFile, "-- dump\nINSERT INTO `settings` VALUES ('k','v');\n");
check('اسکن dump: INSERT INTO `settings` → true', karam_backup_dump_contains_settings($scanFile) === true);
@unlink($scanFile);

// ۲) مسیر dump خالص PHP — بند ۱: SHOW CREATE TABLE ناموفق → استثنا، نه ردّ بی‌صدا
$stubOk = new KaramBackupPdoStub('sqlite::memory:');
$stubOk->exec('CREATE TABLE _karam_tables (name TEXT)');
$stubOk->exec('CREATE TABLE _karam_create (tbl TEXT, ddl TEXT)');
$stubOk->exec('CREATE TABLE ok_table (id INTEGER, title TEXT)');
$stubOk->exec("INSERT INTO _karam_tables (name) VALUES ('ok_table')");
$stubOk->exec("INSERT INTO _karam_create (tbl, ddl) VALUES ('ok_table', 'CREATE TABLE `ok_table` (id INTEGER, title TEXT)')");
$stubOk->exec("INSERT INTO ok_table (id, title) VALUES (1, 'کار اول')");

$okDump = karam_backup_php_dump($stubOk, 'testdb');
check('php-dump سالم: سرآغاز درست (SET NAMES utf8mb4 + FOREIGN_KEY_CHECKS)', str_starts_with($okDump['sql'], "-- کارام — بکاپ خالص PHP\n") && str_contains($okDump['sql'], 'SET NAMES utf8mb4;') && str_contains($okDump['sql'], 'SET FOREIGN_KEY_CHECKS=1;'));
check('php-dump سالم: CREATE + INSERT جدول واقعی و شمارش درست', str_contains($okDump['sql'], 'CREATE TABLE `ok_table`') && str_contains($okDump['sql'], 'INSERT INTO `ok_table` VALUES (') && str_contains($okDump['sql'], "'کار اول');") && $okDump['tables'] === 1);

// الف) خطای SHOW CREATE TABLE → RuntimeException با نام جدول
$stubBroken = new KaramBackupPdoStub('sqlite::memory:');
$stubBroken->exec('CREATE TABLE _karam_tables (name TEXT)');
$stubBroken->exec('CREATE TABLE _karam_create (tbl TEXT, ddl TEXT)');
$stubBroken->exec("INSERT INTO _karam_tables (name) VALUES ('boom_table'), ('ok_table')");
$stubBroken->exec("INSERT INTO _karam_create (tbl, ddl) VALUES ('ok_table', 'CREATE TABLE `ok_table` (id INTEGER)')");
$stubBroken->brokenTable = 'boom_table';
$ex1 = null;
try {
    karam_backup_php_dump($stubBroken, 'testdb');
} catch (Throwable $e) {
    $ex1 = $e;
}
check('php-dump: SHOW CREATE ناموفق → RuntimeException با نام جدول (نه ردّ بی‌صدا)', $ex1 instanceof RuntimeException && str_contains($ex1->getMessage(), 'boom_table'), $ex1 === null ? 'هیچ استثنایی داده نشد' : get_class($ex1));

// ب) نتیجه‌ی خالی SHOW CREATE TABLE (جدول فهرست‌شده بدون DDL) → RuntimeException
$stubGhost = new KaramBackupPdoStub('sqlite::memory:');
$stubGhost->exec('CREATE TABLE _karam_tables (name TEXT)');
$stubGhost->exec('CREATE TABLE _karam_create (tbl TEXT, ddl TEXT)');
$stubGhost->exec("INSERT INTO _karam_tables (name) VALUES ('ghost_table'), ('ok_table')");
$stubGhost->exec("INSERT INTO _karam_create (tbl, ddl) VALUES ('ok_table', 'CREATE TABLE `ok_table` (id INTEGER)')");
$ex2 = null;
try {
    karam_backup_php_dump($stubGhost, 'testdb');
} catch (Throwable $e) {
    $ex2 = $e;
}
check('php-dump: SHOW CREATE خالی → RuntimeException با نام جدول', $ex2 instanceof RuntimeException && str_contains($ex2->getMessage(), 'ghost_table'), $ex2 === null ? 'هیچ استثنایی داده نشد' : get_class($ex2));

// ۳) پاک‌سازی فایل‌های موقت پس از شکست — بند ۲ (تابع helper)
$cTmp = (string) tempnam(sys_get_temp_dir(), 'karam-clean') . '.sql.tmp';
$cGz = (string) tempnam(sys_get_temp_dir(), 'karam-clean') . '.sql.gz';
$cErr = (string) tempnam(sys_get_temp_dir(), 'karam-clean') . '.mysqldump-err';
file_put_contents($cTmp, 'partial');
file_put_contents($cGz, 'partial');
file_put_contents($cErr, 'err-line');
karam_backup_cleanup_failed($cTmp, $cGz, true, $cErr);
check('پاک‌سازی شکست: .sql.tmp و .sql.gz و .mysqldump-err حذف شدند', !is_file($cTmp) && !is_file($cGz) && !is_file($cErr));

file_put_contents($cGz, 'keep-me'); // شبیه‌سازی نسخه‌ی موفق قبلی — gzCreated=false نباید پاکش کند
$noThrow = true;
try {
    karam_backup_cleanup_failed($cTmp, $cGz, false, $cErr); // فایل‌ها نیستند — نباید استثنا بدهد
} catch (Throwable) {
    $noThrow = false;
}
check('پاک‌سازی شکست: gzCreated=false نسخه‌ی موفق را دست نمی‌زند و روی فایل ناموجود استثنا نمی‌دهد', $noThrow && is_file($cGz));
@unlink($cGz);

// ۴) چرخه‌ی کامل شکست: اجرای واقعی بکاپ روی دیتابیس خراب → استثنا و پوشه‌ی بکاپ بدون فایل موقت
$backupsDir = ROOT . '/backend/storage/backups';
if (!is_dir($backupsDir)) {
    @mkdir($backupsDir, 0775, true);
}
foreach ((glob($backupsDir . '/karam-backup-*.sql.tmp') ?: []) as $f) {
    @unlink($f);
}
$gzCountBefore = count(glob($backupsDir . '/karam-backup-*.sql.gz') ?: []);
$dbFile = dbPath();
file_put_contents($dbFile, 'karam-test-garbage-' . str_repeat('x', 400)); // کپی می‌شود ولی PDO باز نمی‌شود
$failRun = null;
try {
    karam_backup_run();
} catch (Throwable $e) {
    $failRun = $e;
}
check('اجرای بکاپ روی دیتابیس خراب → RuntimeException (شکست بلند، نه سکوت)', $failRun instanceof RuntimeException, $failRun === null ? 'هیچ استثنایی داده نشد' : get_class($failRun));
check('پس از شکست وسط اجرا، هیچ .sql.tmp در پوشه‌ی بکاپ نمی‌ماند', (glob($backupsDir . '/karam-backup-*.sql.tmp') ?: []) === []);
check('پس از شکست، .mysqldump-err هم باقی نمی‌ماند', !is_file($backupsDir . '/.mysqldump-err'));
check('پس از شکست، .gz ناقصی ساخته نشده (شمار نسخه‌های موجود ثابت)', count(glob($backupsDir . '/karam-backup-*.sql.gz') ?: []) === $gzCountBefore);

// ۵) چرخه‌ی کامل موفق (مسیر sqlite-copy) — بازسازی P1.2 مسیر خوش را نشکسته باشد + ماسک SQLite
resetEnvironment();
$fresh = new PDO('sqlite:' . dbPath(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$fresh->exec("UPDATE settings SET value = 'SuperSecret-123' WHERE \"key\" = 'smtp_pass'");
$fresh->exec('PRAGMA wal_checkpoint(TRUNCATE)');
$fresh = null;
$okRun = null;
$okThrew = null;
try {
    $okRun = karam_backup_run();
} catch (Throwable $e) {
    $okThrew = $e;
}
check('اجرای موفق بکاپ پس از بازسازی P1.2 (sqlite-copy)', $okThrew === null && is_array($okRun) && ($okRun['method'] ?? '') === 'sqlite-copy' && is_file((string) ($okRun['file'] ?? '')), $okThrew === null ? '' : (string) $okThrew->getMessage());
$gzBody = is_array($okRun) && is_file((string) ($okRun['file'] ?? '')) ? (string) @gzdecode((string) @file_get_contents((string) ($okRun['file'] ?? ''))) : '';
check('بکاپ موفق: راز ماسک شده ولی نام کلید smtp_pass می‌ماند (ادمین می‌داند چه چیزی را دوباره وارد کند)', $gzBody !== '' && strpos($gzBody, 'SuperSecret-123') === false && strpos($gzBody, 'smtp_pass') !== false);
if (is_array($okRun) && is_file((string) ($okRun['file'] ?? ''))) {
    @unlink((string) ($okRun['file'] ?? ''));
}

/* ================= نتیجه ================= */
echo "\n———————————————\n";
echo $fail === 0 ? "✓ همه‌ی {$pass} بررسی سبز بود\n" : "✗ {$fail} بررسی شکست خورد ({$pass} سبز)\n";
exit($fail === 0 ? 0 : 1);

<?php

declare(strict_types=1);

/**
 * کارام — اسکریپت یک‌بارمصرف ساخت ادمین اصلی
 * ============================================================
 * نحوه‌ی اجرا (CLI — توصیه‌شده):
 *   php setup-admin.php "SETUP_TOKEN" "username" "StrongPassword"
 *
 * نحوه‌ی اجرا (وب — فقط یک‌بار):
 *   https://app.hojre24shop.ir/api/install/setup-admin.php?token=SETUP_TOKEN
 *   با POST: token, username, password
 *
 * امنیت:
 *  - فقط با SETUP_TOKEN صحیح (از .env) اجرا می‌شود
 *  - اگر ادمینی وجود داشته باشد یا فایل نصب (.installed) باشد، اجرا نمی‌شود
 *  - بعد از موفقیت: فایل .installed ساخته می‌شود و اسکریپت «خودش را
 *    به setup-admin.disabled.php تغییر نام می‌دهد» تا دیگر قابل اجرا نباشد.
 */

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/Database.php';

Config::load();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

const LOCK_FILE = __DIR__ . '/.installed';
const SELF_NAME = 'setup-admin.php';
const DISABLED_NAME = 'setup-admin.disabled.php';

function jsonOut(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): never
{
    jsonOut(['ok' => false, 'error' => $message], $status);
}

// ---------- ۱) اگر قبلاً اجرا شده، هرگز اجرا نمی‌شود ----------
if (is_file(LOCK_FILE)) {
    fail('نصب قبلاً انجام شده است. این اسکریپت غیرفعال است.', 403);
}

// ---------- ۲) ورودی: CLI یا POST ----------
$isCli = PHP_SAPI === 'cli';
if ($isCli) {
    $argv = $GLOBALS['argv'] ?? [];
    $token = $argv[1] ?? '';
    $username = $argv[2] ?? '';
    $password = $argv[3] ?? '';
} else {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method !== 'POST') {
        // صفحه‌ی ساده‌ی فرم برای ورود دستی یک‌بارمصرف (توکن از آدرس پیش‌پر می‌شود)
        $prefillToken = htmlspecialchars((string) ($_GET['token'] ?? ''), ENT_QUOTES, 'UTF-8');
        echo '<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><title>نصب کارام</title>';
        echo '<body style="font-family:sans-serif;max-width:28rem;margin:4rem auto;direction:rtl">';
        echo '<h2>نصب کارام — ساخت ادمین اصلی</h2>';
        echo '<p style="color:#888">این فرم فقط یک‌بار کار می‌کند و پس از نصب خودش غیرفعال می‌شود.</p>';
        echo '<form method="post">';
        echo '<input name="token" value="' . $prefillToken . '" placeholder="SETUP_TOKEN" style="width:100%;padding:.5rem;margin:.25rem 0">';
        echo '<input name="username" placeholder="نام کاربری ادمین" style="width:100%;padding:.5rem;margin:.25rem 0">';
        echo '<input name="password" type="password" placeholder="رمز عبور قوی" style="width:100%;padding:.5rem;margin:.25rem 0">';
        echo '<button style="width:100%;padding:.6rem;margin-top:.5rem">ایجاد ادمین</button></form></body></html>';
        exit;
    }

    $token = $_POST['token'] ?? '';
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';
}

try {
    karamInstallAdmin((string) $token, (string) $username, (string) $password);
} catch (Throwable $e) {
    fail($e->getMessage(), 400);
}

/**
 * منطق اصلی نصب
 */
function karamInstallAdmin(string $token, string $username, string $password): never
{
    // ---------- ۳) بررسی توکن ----------
    $setupToken = Config::get('SETUP_TOKEN', '');
    if ($setupToken === '' || !hash_equals($setupToken, $token)) {
        fail('توکن نصب نامعتبر است.', 403);
    }

    // ---------- ۴) اعتبارسنجی ورودی ----------
    if (!preg_match('/^[a-zA-Z0-9_\.]{4,64}$/', $username)) {
        fail('نام کاربری باید ۴ تا ۶۴ کاراکتر و شامل حروف لاتین، عدد، نقطه یا _ باشد.');
    }
    if (strlen($password) < 10 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
        fail('رمز عبور باید حداقل ۱۰ کاراکتر و شامل حرف و رقم باشد.');
    }

    // ---------- ۵) اتصال دیتابیس ----------
    try {
        $pdo = Database::pdo();
    } catch (Throwable $e) {
        error_log('[karam-setup] ' . $e->getMessage());
        fail('اتصال به دیتابیس ناموفق بود. تنظیمات .env را بررسی کنید.', 500);
    }

    // اگر ادمینی هست، نصب بسته است
    $exists = $pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
    if ((int) $exists > 0) {
        karamLockSetup();
        fail('ادمین از قبل وجود دارد؛ نصب بسته شد.', 409);
    }

    // نقش مدیر کل
    $roleStmt = $pdo->prepare('SELECT id FROM admin_roles WHERE code = ? LIMIT 1');
    $roleStmt->execute(['superadmin']);
    $roleId = $roleStmt->fetchColumn();
    if ($roleId === false) {
        $ins = $pdo->prepare("INSERT INTO admin_roles (code, title, permissions) VALUES ('superadmin', 'مدیر کل', '{}')");
        $ins->execute();
        $roleId = (int) $pdo->lastInsertId();
    }

    // هش: Argon2id در صورت پشتیبانی، وگرنه bcrypt
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    $hash = password_hash($password, $algo);

    $ins = $pdo->prepare(
        'INSERT INTO admins (uuid, username, password_hash, role_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
    );
    $ins->execute([
        karamUuid(),
        $username,
        $hash,
        $roleId,
    ]);

    // ---------- ۶) قفل نصب و غیرفعال‌سازی خود ----------
    karamLockSetup();
    karamDisableSelf();

    jsonOut([
        'ok' => true,
        'message' => 'ادمین اصلی ساخته شد. اسکریپت نصب غیرفعال شد (setup-admin.disabled.php).',
    ]);
}

function karamLockSetup(): void
{
    @file_put_contents(LOCK_FILE, gmdate('c') . "\n");
    @chmod(LOCK_FILE, 0444);
}

/** خود-غیرفعال‌سازی: تغییر نام فایل اسکریپت */
function karamDisableSelf(): void
{
    $self = __FILE__;
    $target = dirname($self) . '/' . DISABLED_NAME;
    if (basename($self) === SELF_NAME && is_writable(dirname($self))) {
        @rename($self, $target);
    }
}

/** UUID v4 */
function karamUuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

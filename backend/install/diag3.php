<?php

declare(strict_types=1);

/**
 * کارام — ابزار عیب‌یابی نسخه ۳ (یک‌بارمصرف — بعد از رفع مشکل حذف شود!)
 * ------------------------------------------------------------
 * هدف: عیب‌یابی خطای «خطای داخلی سرور» هنگام تأیید کد OTP
 * نصب: در ریشه‌ی پوشه‌ی api (کنار index.php) آپلود کنید
 * اجرا: https://app.hojre24shop.ir/api/diag3.php
 *
 * کاری که می‌کند:
 *  ۱) آخرین خطاهای ثبت‌شده در api/storage/logs/php-error.log را نشان می‌دهد (دلیل دقیق 500)
 *  ۲) ستون‌های جدول‌های کلیدی را با طرح مرجع مقایسه می‌کند
 *  ۳) کل مسیر نوشتنِ بعد از تأیید OTP را داخل یک تراکنش «تست و پس‌گرفتن» می‌کند (بدون هیچ اثری)
 *  ۴) امضای توکن دسترسی را زنده تست می‌کند
 * هیچ رازی (رمز/هش/توکن) در خروجی نمایش داده نمی‌شود.
 */

ini_set('display_errors', '1');
error_reporting(E_ALL);

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

echo '<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>عیب‌یابی ۳ کارام</title>';
echo '<body style="font-family:Tahoma,Vazirmatn,sans-serif;max-width:46rem;margin:2rem auto;line-height:1.9;color:#111">';
echo '<h2 style="margin:.2rem 0">عیب‌یابی ۳ کارام — مسیر OTP</h2>';
echo '<p style="color:#777;margin-top:0">این خروجی را کامل کپی کنید و در چت بفرستید. بعد از رفع مشکل این فایل را از پوشه‌ی api حذف کنید.</p>';
echo '<pre style="white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;padding:1rem;border-radius:10px;direction:ltr;text-align:left;font-size:12px">';

function d3Line(string $label, string $value, bool $ok = true): void
{
    echo ($ok ? '[OK]   ' : '[FAIL] ') . htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
        . ' = ' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . "\n";
}

$hostLayout = is_dir(__DIR__ . '/src');
$srcDir = $hostLayout ? __DIR__ : dirname(__DIR__);
d3Line('src_dir', $srcDir . '/src', is_dir($srcDir . '/src'));

require_once $srcDir . '/src/Config.php';
Config::load();

// ---------- ۱) لاگ خطا — مهم‌ترین بخش ----------
$logFile = __DIR__ . '/storage/logs/php-error.log';
if (is_file($logFile)) {
    $lines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    d3Line('php-error.log', count($lines) . ' lines — آخرین ۲۰ خط:', true);
    foreach (array_slice($lines, -20) as $l) {
        echo '  LOG | ' . htmlspecialchars($l, ENT_QUOTES, 'UTF-8') . "\n";
    }
} else {
    d3Line('php-error.log', 'not created yet (هیچ خطایی بعد از نصب فیکس ثبت نشده)', true);
}

// ---------- ۲) دیتابیس ----------
$pdo = null;
try {
    require_once $srcDir . '/src/Database.php';
    $pdo = Database::pdo();
    d3Line('DB_CONNECT', 'OK');
} catch (Throwable $e) {
    d3Line('DB_CONNECT', 'ERROR: ' . $e->getMessage(), false);
}

if ($pdo instanceof PDO) {
    // ---------- ۳) اثرانگوش ستون‌ها با طرح مرجع ----------
    $expected = [
        'users' => ['id', 'uuid', 'display_name', 'gender', 'status', 'premium_until', 'last_login_at', 'created_at', 'updated_at'],
        'user_identities' => ['id', 'user_id', 'type', 'value', 'is_primary', 'verified_at', 'created_at'],
        'refresh_tokens' => ['id', 'user_id', 'device_id', 'device_name', 'token_hash', 'user_agent', 'ip', 'issued_at', 'expires_at', 'revoked_at', 'last_used_at'],
        'otp_requests' => ['id', 'identity_type', 'identity_value', 'code_hash', 'purpose', 'attempts', 'ip', 'expires_at', 'consumed_at', 'created_at'],
        'settings' => ['key', 'value', 'updated_at'],
    ];
    foreach ($expected as $table => $cols) {
        try {
            $got = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
            $missing = array_diff($cols, $got);
            if ($missing === []) {
                d3Line("columns:$table", 'ALL ' . count($cols) . ' MATCH', true);
            } else {
                d3Line("columns:$table", 'MISSING: ' . implode(', ', $missing), false);
            }
        } catch (Throwable $e) {
            d3Line("columns:$table", 'ERROR: ' . $e->getMessage(), false);
        }
    }

    // ---------- ۴) شمارنده‌ها + وضعیت آخرین کدهای OTP (بدون افشای مقدار) ----------
    try {
        $users = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $ident = (int) $pdo->query('SELECT COUNT(*) FROM user_identities')->fetchColumn();
        d3Line('users_count', (string) $users, true);
        d3Line('identities_count', (string) $ident, true);
        $rows = $pdo->query('SELECT identity_type, identity_value, attempts, consumed_at, expires_at, created_at FROM otp_requests ORDER BY id DESC LIMIT 5')->fetchAll(PDO::FETCH_ASSOC);
        d3Line('otp_recent', (string) count($rows) . ' rows (newest first)', true);
        foreach ($rows as $r) {
            $v = (string) $r['identity_value'];
            $masked = strlen($v) > 3 ? substr($v, 0, 3) . '***' : '***';
            echo '  OTP | type=' . htmlspecialchars((string) $r['identity_type'], ENT_QUOTES, 'UTF-8')
                . ' value=' . htmlspecialchars($masked, ENT_QUOTES, 'UTF-8')
                . ' attempts=' . htmlspecialchars((string) $r['attempts'], ENT_QUOTES, 'UTF-8')
                . ' consumed=' . htmlspecialchars((string) ($r['consumed_at'] ?? 'NULL'), ENT_QUOTES, 'UTF-8')
                . ' created=' . htmlspecialchars((string) $r['created_at'], ENT_QUOTES, 'UTF-8') . "\n";
        }
    } catch (Throwable $e) {
        d3Line('counters', 'ERROR: ' . $e->getMessage(), false);
    }

    // ---------- ۵) پروب کامل مسیر نوشتنِ بعد از تأیید OTP (تراکنش + ROLLBACK — هیچ اثری نمی‌ماند) ----------
    try {
        $pdo->beginTransaction();
        $testUuid = 'diag3' . str_pad((string) random_int(0, 999999), 12, '0') . '-diag-probe-0001';
        $testUuid = substr($testUuid . '00000000-0000-0000-0000-000000000000', 0, 36);
        $now = gmdate('Y-m-d H:i:s');
        $pdo->prepare("INSERT INTO users (uuid, display_name, gender, status, last_login_at, created_at, updated_at)
                       VALUES (:u, 'diag3-probe', 'unset', 'active', :now, :now, :now)")
            ->execute([':u' => $testUuid, ':now' => $now]);
        $uid = (int) $pdo->lastInsertId();
        d3Line('probe:INSERT users (با last_login_at)', 'OK id=' . $uid, true);

        $pdo->prepare("INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at)
                       VALUES (:uid, 'email', 'diag3-probe@invalid', 1, :now, :now)")
            ->execute([':uid' => $uid, ':now' => $now]);
        d3Line('probe:INSERT user_identities', 'OK', true);

        $pdo->prepare("INSERT INTO refresh_tokens (user_id, device_id, device_name, token_hash, expires_at, issued_at)
                       VALUES (:uid, :dev, 'diag3-probe', :hash, :exp, :now)")
            ->execute([
                ':uid' => $uid,
                ':dev' => substr($testUuid, 0, 36),
                ':hash' => hash('sha256', 'diag3-probe-token'),
                ':exp' => gmdate('Y-m-d H:i:s', time() + 3600),
                ':now' => $now,
            ]);
        d3Line('probe:INSERT refresh_tokens', 'OK', true);

        $pdo->rollBack();
        d3Line('probe:result', 'ALL WRITE OK — rolled back (هیچ اثری نماند)', true);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        d3Line('probe:WRITE', 'FAILED: ' . $e->getMessage(), false);
    }

    // ---------- ۶) تست زنده‌ی امضای توکن ----------
    try {
        $secretLen = strlen((string) (Config::get('APP_SECRET', '') ?? ''));
        d3Line('APP_SECRET length', (string) $secretLen, $secretLen >= 32);
        require_once $srcDir . '/src/Auth/AccessToken.php';
        $tok = AccessToken::issue('diag3-probe-uuid');
        d3Line('AccessToken::issue', 'OK (token len ' . strlen($tok['token']) . ')', true);
    } catch (Throwable $e) {
        d3Line('AccessToken::issue', 'FAILED: ' . $e->getMessage(), false);
    }
}

echo '</pre>';
echo '<p style="color:#a00;font-weight:bold">بعد از رفع مشکل، فایل diag3.php را از پوشه‌ی api حذف کنید.</p>';
echo '</body></html>';

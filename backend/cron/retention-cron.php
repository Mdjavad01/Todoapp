<?php

declare(strict_types=1);

/**
 * کارام — کرون نگه‌داری (Retention) — v1.9
 *
 * چه می‌کند؟ (پاک‌سازی با آستانه‌ی قابل‌تنظیم از پنل ← تنظیمات)
 *   ۱) otp_requests                 → «retention_otp_days»            (پیش‌فرض ۹۰ روز)
 *   ۲) provider_logs                → «retention_provider_logs_days»  (پیش‌فرض ۱۸۰ روز)
 *   ۳) audit_logs                   → «retention_audit_days»          (پیش‌فرض ۳۶۵ روز)
 *   ۴) refresh_tokens منقضی/ابطال‌شده → «retention_refresh_expired_days» (پیش‌فرض ۳۰ روز پس از انقضا)
 *   ۵) حذف‌های نرم (تومب‌استون لیست/کار/زیرکار) → «retention_tombstone_days» (پیش‌فرض ۱۸۰، حداقل ۹۰)
 *      فقط حذف‌های نرم‌شده پاک می‌شوند؛ لیستِ تومب‌استون فقط وقتی کار زنده نداشته باشد سخت پاک می‌شود.
 *
 * رفتار کلاینتِ دیر آمده (بیشتر از آستانه‌ی تومب‌استون آفلاین بوده):
 *   سرور آستانه را در bootstrap (sync.tombstoneRetentionDays) می‌دهد؛ کلاینت اگر آخرین
 *   سینک موفقش قدیمی‌تر باشد، انبارهای محلی را خالی و کرسر را صفر می‌کند (سینک کامل
 *   مجدد) — داده‌ی حذف‌شده هرگز از یک تومب‌استون پاک‌شده «زنده» نمی‌شود.
 *
 * dry-run (بدون هیچ حذفی — فقط شمارش و گزارش):
 *   CLI:    php retention-cron.php --dry
 *   وب:     .../retention-cron.php?check=karam-retention-check&dry=1
 *
 * راه‌اندازی (مثل کرون بکاپ — بدون SSH):
 *   ۱) فایل در مسیر api/cron/retention-cron.php
 *   ۲) وضعیت + دستور کرون آماده: https://دامنه/api/cron/retention-cron.php?check=karam-retention-check
 *   ۳) DirectAdmin ← Cron Jobs ← یک‌بار در روز (مثلاً 04:15) با همان دستور
 *
 * وضعیت آخرین اجرا: storage/cache/retention-state.json — داشبورد/سلامت ادمین می‌خواند.
 */

const KARAM_RETENTION_CHECK_KEY = 'karam-retention-check';

date_default_timezone_set('UTC');

/* ---------- بارگذاری هسته‌ی کارام (هر دو چیدمان: مخزن و هاست) ---------- */
$srcDir = dirname(__DIR__) . '/src';
require $srcDir . '/Config.php';
require $srcDir . '/Database.php';
require $srcDir . '/Support/FileCache.php'; // ⚠️ الزامی — Settings::all به FileCache وابسته است
require $srcDir . '/Support/Settings.php';

$isCli = PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg';

/* ---------- مسیرهای کاری ---------- */
function karam_retention_storageDir(): string
{
    $candidates = [
        dirname(__DIR__) . '/storage', // مخزن: backend/storage
        __DIR__ . '/storage',          // هاست: api/storage
    ];
    foreach ($candidates as $dir) {
        if (is_dir($dir)) {
            return $dir;
        }
    }
    @mkdir($candidates[0], 0775, true);
    return $candidates[0];
}

/** ثبت وضعیت آخرین اجرا برای سلامت ادمین و صفحه‌ی وضعیت وب */
function karam_retention_writeStatus(array $status): void
{
    $dir = karam_retention_storageDir() . '/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $status['at'] = gmdate('Y-m-d\TH:i:s\Z');
    @file_put_contents(
        $dir . '/retention-state.json',
        json_encode($status, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n",
        LOCK_EX
    );
}

/* ================= اجرا ================= */

$dry = $isCli
    ? in_array('--dry', $argv ?? [], true)
    : (($_GET['dry'] ?? '') === '1');
$checkKey = $isCli ? null : (string) ($_GET['check'] ?? '');

// وب: بدون کلید check هیچ (کشف خودکار مسیرها نباید پاک‌سازی اجرا کند)
if (!$isCli && !hash_equals(KARAM_RETENTION_CHECK_KEY, $checkKey)) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'یافت نشد'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $report = karam_retention_run($dry);
    karam_retention_writeStatus([
        'ok' => true,
        'dry' => $dry,
        'deleted' => $report['deleted'],
        'totalDeleted' => $report['totalDeleted'],
        'thresholds' => $report['thresholds'],
        'durationMs' => $report['durationMs'],
    ]);
} catch (Throwable $e) {
    error_log('[karam-retention] ' . $e->getMessage());
    karam_retention_writeStatus([
        'ok' => false,
        'dry' => $dry,
        'error' => $e->getMessage(),
    ]);
    if ($isCli) {
        fwrite(STDERR, '✗ نگه‌داری ناموفق: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'خطای نگه‌داری'], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- خروجی ---------- */
if ($isCli) {
    echo "کارام — کرون نگه‌داری" . ($dry ? " (dry-run — هیچ چیزی حذف نشد)" : "") . PHP_EOL;
    foreach ($report['deleted'] as $name => $n) {
        echo "  {$name}: " . ($dry ? "می‌شد {$n}" : "{$n} سطر پاک شد") . PHP_EOL;
    }
    echo "  مجموع: {$report['totalDeleted']}" . PHP_EOL;
    exit(0);
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'dry' => $dry,
    'deleted' => $report['deleted'],
    'totalDeleted' => $report['totalDeleted'],
    'thresholds' => $report['thresholds'],
], JSON_UNESCAPED_UNICODE);

/* ================= منطق اصلی (تابع برای قابل‌آزمون‌بودن) ================= */

/** @return array{deleted:array<string,int>, totalDeleted:int, thresholds:array<string,int>, durationMs:int} */
function karam_retention_run(bool $dry): array
{
    $started = microtime(true);
    $pdo = Database::pdo();

    // آستانه‌ها از تنظیمات (پنل) — با سقف/کف امن
    $thresholds = [
        'otp' => Settings::int('retention_otp_days', 90, 7, 730),
        'providerLogs' => Settings::int('retention_provider_logs_days', 180, 30, 730),
        'audit' => Settings::int('retention_audit_days', 365, 90, 1095),
        'refreshExpired' => Settings::int('retention_refresh_expired_days', 30, 7, 365),
        'tombstone' => Settings::int('retention_tombstone_days', 180, 90, 1095), // حداقل ۹۰ — ایمنی سینک
    ];

    $sqlTime = static fn (int $days): string => gmdate('Y-m-d H:i:s', time() - $days * 86400);
    $deleted = [];
    $total = 0;

    // ۱) OTP — بر اساس created_at (مصرف‌شده/منقضی/هدررفته همه بعد از ۹۰ روز زباله‌اند)
    $st = $pdo->prepare('SELECT COUNT(*) FROM otp_requests WHERE created_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['otp'])]);
    $deleted['otp_requests'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM otp_requests WHERE created_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['otp'])]);
        $deleted['otp_requests'] = $st->rowCount();
    }
    $total += $deleted['otp_requests'];

    // ۲) لاگ پروایدرها (SMTP/تلگرام/پیامک/درگاه)
    $st = $pdo->prepare('SELECT COUNT(*) FROM provider_logs WHERE created_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['providerLogs'])]);
    $deleted['provider_logs'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM provider_logs WHERE created_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['providerLogs'])]);
        $deleted['provider_logs'] = $st->rowCount();
    }
    $total += $deleted['provider_logs'];

    // ۳) Audit — حداقل ۹۰ روز (پنل سقف پایین ۹۰ دارد)
    $st = $pdo->prepare('SELECT COUNT(*) FROM audit_logs WHERE created_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['audit'])]);
    $deleted['audit_logs'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM audit_logs WHERE created_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['audit'])]);
        $deleted['audit_logs'] = $st->rowCount();
    }
    $total += $deleted['audit_logs'];

    // ۴) توکن‌های منقضی/ابطال‌شده — X روز پس از انقضا (نشست فعال هرگز پاک نمی‌شود)
    $st = $pdo->prepare('SELECT COUNT(*) FROM refresh_tokens WHERE expires_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['refreshExpired'])]);
    $deleted['refresh_tokens_expired'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM refresh_tokens WHERE expires_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['refreshExpired'])]);
        $deleted['refresh_tokens_expired'] = $st->rowCount();
    }
    $total += $deleted['refresh_tokens_expired'];

    // ۵) تومب‌استون‌ها — فقط حذف‌های نرم قدیمی‌تر از آستانه (حداقل ۹۰ روز) سخت پاک می‌شوند
    //    ترتیب: زیرکار ← کار ← لیست (لیست فقط اگر کار زنده نداشته باشد)
    $st = $pdo->prepare('SELECT COUNT(*) FROM subtasks WHERE deleted_at IS NOT NULL AND deleted_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
    $deleted['subtasks_tombstones'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM subtasks WHERE deleted_at IS NOT NULL AND deleted_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
        $deleted['subtasks_tombstones'] = $st->rowCount();
    }
    $total += $deleted['subtasks_tombstones'];

    $st = $pdo->prepare('SELECT COUNT(*) FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < :t');
    $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
    $deleted['tasks_tombstones'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < :t');
        $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
        $deleted['tasks_tombstones'] = $st->rowCount();
    }
    $total += $deleted['tasks_tombstones'];

    // لیستِ تومب‌استون فقط وقتی هیچ کار زنده‌ای زیرش نیست (کار زنده یتیم نمی‌شود)
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM lists l
         WHERE l.deleted_at IS NOT NULL AND l.deleted_at < :t
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.list_id = l.id AND tk.deleted_at IS NULL)'
    );
    $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
    $deleted['lists_tombstones'] = $dry ? (int) $st->fetchColumn() : 0;
    if (!$dry) {
        $st = $pdo->prepare(
            'DELETE FROM lists
             WHERE deleted_at IS NOT NULL AND deleted_at < :t
               AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.list_id = lists.id AND tk.deleted_at IS NULL)'
        );
        $st->execute([':t' => $sqlTime($thresholds['tombstone'])]);
        $deleted['lists_tombstones'] = $st->rowCount();
    }
    $total += $deleted['lists_tombstones'];

    return [
        'deleted' => $deleted,
        'totalDeleted' => $total,
        'thresholds' => $thresholds,
        'durationMs' => (int) round((microtime(true) - $started) * 1000),
    ];
}

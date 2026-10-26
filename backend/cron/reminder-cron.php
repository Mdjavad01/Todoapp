<?php

declare(strict_types=1);

/**
 * کارام — یادآور تلگرامی کارهای عقب‌افتاده (گام ۲۰ — رشد)
 *
 * چه می‌کند:
 *   ۱) کاربرانی که با تلگرام وارد شده‌اند (هویت telegram_chat_id تأییدشده دارند)
 *      و «کار عقب‌افتاده» دارند (due_date گذشته و کامل نشده) پیدا می‌شوند
 *   ۲) برای هرکدام یک پیام ساده: «شما N کار عقب‌افتاده داری» + ۳ عنوان اول
 *   ۳) روزی فقط یک‌بار اجرا می‌شود (گارد فایل وضعیت) — اجرای تکراری همان روز ارسال نمی‌کند
 *
 * کلیدهای پنل:
 *   - reminder_enabled        (پیش‌فرض: خاموش)
 *   - reminder_lookback_days  (فقط کارهای ۱ تا N روز عقب‌افتاده — پیش‌فرض ۳۰، جلوگیری از اسپم کارهای قدیمی)
 *
 * راه‌اندازی (مثل کرون بکاپ — بدون SSH):
 *   ۱) فایل در مسیر api/cron/reminder-cron.php
 *   ۲) وضعیت + دستور کرون آماده: https://دامنه/api/cron/reminder-cron.php?check=karam-reminder-check
 *   ۳) DirectAdmin ← Cron Jobs ← یک‌بار در روز (مثلاً 08:00) با همان دستور
 *
 * نکته‌ها:
 *   - پیام فقط به کسانی می‌رود که از ربات کد ورود گرفته‌اند (ربات حق شروع گفت‌وگو ندارد)
 *   - بین هر ارسال ۰٫۲ ثانیه مکث — محدودیت نرخ API تلگرام (۳۰ پیام/ثانیه) با فاصله امن
 *   - اجرای دستی با --force حتی اگر امروز قبلاً ارسال شده باشد
 */

const KARAM_REMINDER_CHECK_KEY = 'karam-reminder-check';
const KARAM_REMINDER_BATCH = 300;     // سقف گیرنده در هر اجرا
const KARAM_SEND_GAP_MICRO = 200000;  // ۰٫۲ ثانیه بین پیام‌ها

date_default_timezone_set('UTC');

/* ---------- بارگذاری هسته‌ی کارام (هر دو چیدمان: مخزن و هاست) ---------- */
$srcDir = dirname(__DIR__) . '/src';
require $srcDir . '/Config.php';
require $srcDir . '/Database.php';
require $srcDir . '/Support/FileCache.php'; // ⚠️ الزامی — Settings::all به FileCache وابسته است (v17)
require $srcDir . '/Support/Settings.php';
require $srcDir . '/Services/TelegramBot.php';

$isCli = PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg';

/* ---------- مسیرهای کاری ---------- */
function karam_reminder_storageDir(): string
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

function karam_reminder_cacheDir(): string
{
    $dir = karam_reminder_storageDir() . '/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function karam_reminder_readState(): array
{
    $file = karam_reminder_cacheDir() . '/reminder-state.json';
    $decoded = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
    return is_array($decoded) ? $decoded : [];
}

function karam_reminder_writeState(array $state): void
{
    @file_put_contents(
        karam_reminder_cacheDir() . '/reminder-state.json',
        json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n",
        LOCK_EX
    );
}

function karam_reminder_fail(string $message, bool $cli): void
{
    error_log('[karam-reminder] ' . $message);
    $state = karam_reminder_readState();
    $state['ok'] = false;
    $state['error'] = $message;
    $state['at'] = gmdate('Y-m-d\TH:i:s\Z');
    karam_reminder_writeState($state);
    if ($cli) {
        fwrite(STDERR, '✗ یادآور ناموفق: ' . $message . PHP_EOL);
        exit(1);
    }
}

/* ================= صفحه‌ی وضعیت وب ================= */
if (!$isCli && (string) ($_GET['check'] ?? '') === KARAM_REMINDER_CHECK_KEY) {
    header('Content-Type: text/html; charset=utf-8');
    $state = karam_reminder_readState();
    $enabled = Settings::bool('reminder_enabled');
    $lookback = Settings::int('reminder_lookback_days', 30, 1, 365);
    $host = $_SERVER['HTTP_HOST'] ?? 'دامنه';
    $cronCmd = 'php ' . __FILE__ . ' > /dev/null 2>&1';
    $lastAt = (string) ($state['at'] ?? '');
    $statusOk = (bool) ($state['ok'] ?? false);
    $err = (string) ($state['error'] ?? '');

    echo '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>کارام — وضعیت یادآور تلگرامی</title>';
    echo '<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:2rem;line-height:1.9}';
    echo '.card{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:1.5rem}';
    echo 'code{background:#f1f5f9;padding:.15rem .5rem;border-radius:6px;direction:ltr;display:inline-block;word-break:break-all}';
    echo '.ok{color:#047857;font-weight:700}.bad{color:#b91c1c;font-weight:700}</style></head><body><div class="card">';
    echo '<h1>🌿 کارام — یادآور تلگرامی</h1>';
    echo '<p>این صفحه فقط وضعیت را نشان می‌دهد؛ اجرای واقعی با کرون انجام می‌شود.</p>';
    echo '<ul>';
    echo '<li>وضعیت کلید پنل: ' . ($enabled ? '<span class="ok">روشن</span>' : '<span class="bad">خاموش</span>') . ' (تنظیمات ← یادآور تلگرامی)</li>';
    echo '<li>بازه‌ی عقب‌افتادگی: ' . $lookback . ' روز</li>';
    echo '<li>ربات تلگرام: ' . (\TelegramBot::configured() ? '<span class="ok">تنظیم شده</span>' : '<span class="bad">توکن ثبت نشده</span>') . '</li>';
    echo '<li>آخرین اجرا: ' . ($lastAt !== '' ? htmlspecialchars($lastAt) : '—') . '</li>';
    if ($lastAt !== '') {
        echo '<li>نتیجه‌ی آخرین اجرا: ' . ($statusOk ? '<span class="ok">موفق</span>' : '<span class="bad">' . htmlspecialchars($err) . '</span>') . '</li>';
        if (isset($state['sent'])) {
            echo '<li>ارسال‌های آخرین اجرا: ' . (int) $state['sent'] . ' (پرش‌شده: ' . (int) ($state['skipped'] ?? 0) . ')</li>';
        }
        if (isset($state['date'])) {
            echo '<li>آخرین روز ارسال: ' . htmlspecialchars((string) $state['date']) . '</li>';
        }
    }
    echo '</ul>';
    echo '<p>دستور کرون (DirectAdmin ← Cron Jobs — یک‌بار در روز، مثلاً 08:00):</p>';
    echo '<p><code>' . htmlspecialchars($cronCmd) . '</code></p>';
    echo '<p style="color:#64748b">مسیر فایل روی هاست: <code>api/cron/reminder-cron.php</code></p>';
    echo '</div></body></html>';
    return;
}

/* ================= اجرای واقعی ================= */
try {
    if (!Settings::bool('reminder_enabled')) {
        $state = karam_reminder_readState();
        $state['ok'] = true;
        $state['skipped'] = 'disabled';
        $state['at'] = gmdate('Y-m-d\TH:i:s\Z');
        karam_reminder_writeState($state);
        if ($isCli) {
            echo "یادآور تلگرامی خاموش است (پنل ← تنظیمات ← یادآور تلگرامی)\n";
        }
        return;
    }
    if (!\TelegramBot::configured()) {
        karam_reminder_fail('توکن ربات تلگرام تنظیم نشده است', $isCli);
        return;
    }

    $force = $isCli && in_array('--force', $_SERVER['argv'] ?? [], true);
    $state = karam_reminder_readState();
    $today = gmdate('Y-m-d');
    if (!$force && (string) ($state['date'] ?? '') === $today) {
        if ($isCli) {
            echo "امروز قبلاً ارسال شده ({$today}) — با --force می‌توانید دوباره اجرا کنید\n";
        }
        return;
    }

    $pdo = Database::pdo();
    $lookback = Settings::int('reminder_lookback_days', 30, 1, 365);
    $from = gmdate('Y-m-d', time() - $lookback * 86400);

    // گیرنده‌ها: کاربر فعال با هویت تلگرام تأییدشده + حداقل یک کار عقب‌افتاده
    $stmt = $pdo->prepare(
        "SELECT u.id AS uid, i.value AS chat_id, COUNT(*) AS overdue_count
         FROM tasks t
         JOIN users u ON u.id = t.user_id AND u.status = 'active'
         JOIN user_identities i ON i.user_id = u.id AND i.type = 'telegram_chat_id' AND i.verified_at IS NOT NULL
         WHERE t.completed_at IS NULL AND t.deleted_at IS NULL
           AND t.due_date IS NOT NULL AND t.due_date >= :from AND t.due_date < :today
         GROUP BY u.id, i.value
         ORDER BY u.id ASC
         LIMIT " . KARAM_REMINDER_BATCH
    );
    $stmt->execute([':from' => $from, ':today' => $today]);
    $recipients = $stmt->fetchAll();

    // ۳ عنوان اول هر گیرنده — ORDER BY با CASE در هر دو درایور کار می‌کند
    $titlesStmt = $pdo->prepare(
        "SELECT title FROM tasks
         WHERE user_id = :uid AND completed_at IS NULL AND deleted_at IS NULL
           AND due_date IS NOT NULL AND due_date >= :from AND due_date < :today
         ORDER BY due_date ASC,
                  CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
         LIMIT 3"
    );

    $sent = 0;
    $failed = 0;
    foreach ($recipients as $r) {
        $titlesStmt->execute([':uid' => (int) $r['uid'], ':from' => $from, ':today' => $today]);
        $titles = array_map('strval', $titlesStmt->fetchAll(PDO::FETCH_COLUMN));

        $lines = [
            'کارام 🌿',
            'شما ' . (int) $r['overdue_count'] . ' کار عقب‌افتاده دارید:',
        ];
        foreach ($titles as $t) {
            $lines[] = '• ' . $t;
        }
        $lines[] = 'همین حالا مرورشان کنید 💪';

        $ok = \TelegramBot::sendMessage((string) $r['chat_id'], implode("\n", $lines));
        if ($ok) {
            $sent++;
        } else {
            $failed++;
            error_log('[karam-reminder] ارسال به chat_id ناموفق: ' . (string) $r['chat_id']);
        }
        usleep(KARAM_SEND_GAP_MICRO);
    }

    karam_reminder_writeState([
        'ok' => true,
        'date' => $today,
        'sent' => $sent,
        'failed' => $failed,
        'recipients' => count($recipients),
        'at' => gmdate('Y-m-d\TH:i:s\Z'),
    ]);
    if ($isCli) {
        echo "یادآور تلگرامی اجرا شد — گیرنده: " . count($recipients) . " · ارسال موفق: {$sent} · ناموفق: {$failed}\n";
    }
} catch (Throwable $e) {
    karam_reminder_fail($e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(), $isCli);
}

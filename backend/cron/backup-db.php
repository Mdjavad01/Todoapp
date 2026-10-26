<?php

declare(strict_types=1);

/**
 * کارام — بکاپ خودکار روزانه دیتابیس (گام ۱۹ — عملیات)
 *
 * چه می‌کند:
 *   ۱) از کل دیتابیس (همه‌ی جداول) یک dump فشرده‌ی .sql.gz می‌سازد
 *      → در storage/backups (بیرون از webroot؛ .htaccess دسترسی وب را بسته است)
 *   ۲) فقط ۷ نسخه‌ی آخر را نگه می‌دارد (BACKUP_KEEP در .env قابل تغییر)
 *   ۳) اگر ربات تلگرام + «شناسه چت ادمین» (پنل ← تنظیمات ← بکاپ) تنظیم شده باشد،
 *      فایل بکاپ را تا سقف ۴۵MB به تلگرام می‌فرستد (بزرگ‌تر = فقط پیام گزارش)
 *   ۴) وضعیت آخرین اجرا در storage/cache/backup-status.json ثبت می‌شود
 *
 * چرا دو روش dump؟
 *   - mysqldump اگر روی هاست موجود باشد (DirectAdmin معمولاً دارد) — سریع‌ترین راه
 *   - وگرنه dump خالص PHP (SHOW CREATE TABLE + INSERT) — همیشه کار می‌کند، بدون exec
 *   - SQLite (توسعه‌ی محلی): کپی مستقیم فایل دیتابیس
 *
 * راه‌اندازی (مثل کرون تلگرام — بدون SSH):
 *   ۱) فایل در مسیر api/cron/backup-db.php
 *   ۲) وضعیت/دستور کرون آماده: https://دامنه/api/cron/backup-db.php?check=karam-backup-check
 *   ۳) DirectAdmin ← Cron Jobs ← یک‌بار در روز (مثلاً 03:30) با همان دستور
 *
 * نکته‌های امنیتی:
 *   - خروجی‌ها داخل storage/backups با .htaccess «Require all denied» — از وب قابل دانلود نیستند
 *   - صفحه‌ی وضعیت وب هم فقط با کلید check باز می‌شود و هیچ جزئیات حساسی (نام کاربر دیتابیس) نشان نمی‌دهد
 *   - فایل‌های قدیمی‌تر از سقف نگه‌داری، خودکار حذف می‌شوند — دیسک پر نمی‌شود
 */

const KARAM_BACKUP_CHECK_KEY = 'karam-backup-check';
const KARAM_KEEP_DEFAULT = 7;
const KARAM_TELEGRAM_MAX_BYTES = 45 * 1024 * 1024; // سقف بات API تلگرام ۵۰MB است؛ حاشیه امن

date_default_timezone_set('UTC');

/* ---------- بارگذاری هسته‌ی کارام (هر دو چیدمان: مخزن و هاست) ---------- */
$srcDir = dirname(__DIR__) . '/src';
require $srcDir . '/Config.php';
require $srcDir . '/Database.php';
require $srcDir . '/Support/FileCache.php'; // ⚠️ الزامی — Settings::all به FileCache وابسته است (v17)
require $srcDir . '/Support/Settings.php';
require $srcDir . '/Services/TelegramBot.php';

$isCli = PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg';

/* ---------- مسیرهای کاری (چیدمان هاست: api/cron → api/storage؛ مخزن: backend/cron → backend/storage) ---------- */
function karam_backup_storageDir(): string
{
    $candidates = [
        dirname(__DIR__) . '/storage/backups', // مخزن: backend/storage/backups
        __DIR__ . '/storage/backups',          // هاست: api/storage/backups
    ];
    foreach ($candidates as $dir) {
        if (is_dir($dir)) {
            return $dir;
        }
    }
    // هیچ‌کدام نبود — اولین گزینه را می‌سازیم
    $first = $candidates[0];
    @mkdir($first, 0775, true);
    return $first;
}

function karam_backup_cacheDir(): string
{
    $dir = dirname(karam_backup_storageDir()) . '/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/** ثبت وضعیت آخرین اجرا برای صفحه‌ی وضعیت وب */
function karam_backup_writeStatus(array $status): void
{
    @file_put_contents(
        karam_backup_cacheDir() . '/backup-status.json',
        json_encode($status, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n",
        LOCK_EX
    );
}

/** گزارش خطا — هم لاگ فایل هم وضعیت */
function karam_backup_fail(string $message, bool $cli): void
{
    error_log('[karam-backup] ' . $message);
    karam_backup_writeStatus([
        'ok' => false,
        'error' => $message,
        'at' => gmdate('Y-m-d\TH:i:s\Z'),
    ]);
    if ($cli) {
        fwrite(STDERR, '✗ بکاپ ناموفق: ' . $message . PHP_EOL);
        exit(1);
    }
}

/* ================= اجرای واقعی بکاپ ================= */

/**
 * @return array{file:string, bytes:int, method:string, tables:int}
 */
function karam_backup_run(): array
{
    $dir = karam_backup_storageDir();
    $started = microtime(true);

    // نام فایل — با تاریخ UTC (همه‌ی زمان‌های کارام UTC است)
    $base = 'karam-backup-' . gmdate('Y-m-d-His');
    $tmpPath = $dir . '/' . $base . '.sql.tmp';
    $gzPath = $dir . '/' . $base . '.sql.gz';

    $driver = (string) (Config::get('DB_DRIVER', 'mysql') ?? 'mysql');

    if ($driver === 'sqlite') {
        // توسعه‌ی محلی — کپی مستقیم فایل دیتابیس (کلید .env: SQLITE_PATH — هم‌نام Database.php)
        $dbPath = (string) (Config::get('SQLITE_PATH', dirname(__DIR__) . '/storage/karam-dev.sqlite3') ?? '');
        if ($dbPath === '' || !is_file($dbPath)) {
            throw new RuntimeException('فایل دیتابیس SQLite پیدا نشد: ' . $dbPath);
        }
        $bytes = filesize($dbPath) ?: 0;
        $gz = gzencode((string) file_get_contents($dbPath), 6);
        if ($gz === false) {
            throw new RuntimeException('فشرده‌سازی ناموفق بود');
        }
        file_put_contents($tmpPath, $gz);
        rename($tmpPath, $gzPath);
        return ['file' => $gzPath, 'bytes' => strlen($gz), 'method' => 'sqlite-copy', 'tables' => 0];
    }

    $pdo = Database::pdo();

    // روش ۱: mysqldump (اگر موجود باشد)
    $host = (string) (Config::get('DB_HOST', 'localhost') ?? 'localhost');
    $port = (string) (Config::get('DB_PORT', '3306') ?? '3306');
    $name = (string) (Config::get('DB_NAME', '') ?? '');
    $user = (string) (Config::get('DB_USER', '') ?? '');
    $pass = (string) (Config::get('DB_PASS', '') ?? '');

    $mysqldump = null;
    foreach (['/usr/bin/mysqldump', '/usr/local/bin/mysqldump', '/usr/bin/mariadb-dump'] as $bin) {
        if (is_executable($bin)) {
            $mysqldump = $bin;
            break;
        }
    }

    $tables = 0;
    $dumped = false;
    if ($mysqldump !== null && $name !== '') {
        $cmd = escapeshellarg($mysqldump)
            . ' --host=' . escapeshellarg($host)
            . ' --port=' . escapeshellarg($port)
            . ' --user=' . escapeshellarg($user)
            . ' --password=' . escapeshellarg($pass)
            . ' --single-transaction --quick --routines --no-tablespaces '
            . escapeshellarg($name)
            . ' > ' . escapeshellarg($tmpPath) . ' 2> ' . escapeshellarg($dir . '/.mysqldump-err');
        @exec($cmd, $out, $code);
        if ($code === 0 && is_file($tmpPath) && filesize($tmpPath) > 200) {
            $dumped = true;
        }
        @unlink($dir . '/.mysqldump-err');
    }

    // روش ۲: dump خالص PHP — بدون exec، همیشه در دسترس
    if (!$dumped) {
        $sql = "-- کارام — بکاپ خالص PHP\n";
        $sql .= "-- at " . gmdate('Y-m-d\TH:i:s\Z') . " db={$name}\n";
        $sql .= "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n";

        $stmt = $pdo->query('SHOW TABLES');
        $allTables = $stmt->fetchAll(PDO::FETCH_COLUMN);
        $tables = count($allTables);

        foreach ($allTables as $table) {
            $t = (string) $table;
            $create = $pdo->query('SHOW CREATE TABLE ' . str_replace('`', '', $t))->fetch(PDO::FETCH_NUM);
            if ($create === false) {
                continue;
            }
            $sql .= "DROP TABLE IF EXISTS `" . $t . "`;\n";
            $sql .= (string) $create[1] . ";\n";

            $rows = $pdo->query('SELECT * FROM `' . $t . '`');
            $buffer = '';
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                $values = [];
                foreach ($row as $v) {
                    $values[] = $v === null ? 'NULL' : $pdo->quote((string) $v);
                }
                $buffer .= 'INSERT INTO `' . $t . '` VALUES (' . implode(',', $values) . ");\n";
                $count++;
                if ($count % 200 === 0) {
                    $sql .= $buffer;
                    $buffer = '';
                }
            }
            $sql .= $buffer . "\n";
        }
        $sql .= "SET FOREIGN_KEY_CHECKS=1;\n";
        file_put_contents($tmpPath, $sql);
    }

    // فشرده‌سازی + جای‌گذاری اتمیک
    $gz = gzencode((string) file_get_contents($tmpPath), 6);
    if ($gz === false) {
        throw new RuntimeException('فشرده‌سازی gzip ناموفق بود');
    }
    file_put_contents($gzPath, $gz, LOCK_EX);
    @unlink($tmpPath);

    $bytes = strlen($gz);
    if ($bytes < 200) {
        throw new RuntimeException('خروجی بکاپ مشکوکاً کوچک است (' . $bytes . ' بایت) — احتمالاً خطای اتصال دیتابیس');
    }

    return [
        'file' => $gzPath,
        'bytes' => $bytes,
        'method' => $dumped ? 'mysqldump' : 'php-dump',
        'tables' => $tables > 0 ? $tables : 0,
        'durationMs' => (int) round((microtime(true) - $started) * 1000),
    ];
}

/** نگه‌داری فقط N نسخه‌ی آخر */
function karam_backup_prune(string $dir, int $keep): int
{
    $files = glob($dir . '/karam-backup-*.sql.gz') ?: [];
    sort($files); // نام‌ها تاریخ‌دارند → مرتب = قدیمی به جدید
    $removed = 0;
    $removeCount = count($files) - $keep;
    foreach ($files as $i => $f) {
        if ($i < $removeCount) {
            if (@unlink($f)) {
                $removed++;
            }
        }
    }
    return $removed;
}

/** ارسال به تلگرام ادمین: فایل (تا ۴۵MB) یا فقط پیام گزارش */
function karam_backup_telegramReport(array $run, bool $cli): void
{
    if (!TelegramBot::configured()) {
        return;
    }
    $chatId = trim((string) (Settings::get('backup_telegram_chat', '') ?? ''));
    if ($chatId === '') {
        return; // کلید پنل تنظیم نشده — فقط بکاپ محلی
    }

    $sizeMb = round($run['bytes'] / 1048576, 2);
    $caption = "🗄 بکاپ کارام انجام شد\n"
        . '📅 ' . gmdate('Y-m-d H:i') . ' UTC | روش: ' . $run['method'] . "\n"
        . '📦 حجم: ' . $sizeMb . " MB\n"
        . '🧩 جداول: ' . ($run['tables'] > 0 ? $run['tables'] : '—') . "\n"
        . '⏱ ' . ($run['durationMs'] ?? 0) . "ms\n"
        . '💾 نام فایل: ' . basename($run['file']);

    if ($run['bytes'] <= KARAM_TELEGRAM_MAX_BYTES && is_file($run['file'])) {
        // ارسال خود فایل — بکاپ بیرون از هاست (اگر هاست مرد، بکاپ زنده می‌ماند)
        $ch = curl_init(TelegramBot::apiBase() . '/bot' . TelegramBot::token() . '/sendDocument');
        if ($ch !== false) {
            curl_setopt_array($ch, [
                CURLOPT_POST => 1,
                CURLOPT_RETURNTRANSFER => 1,
                CURLOPT_TIMEOUT => 300,
                CURLOPT_POSTFIELDS => [
                    'chat_id' => $chatId,
                    'caption' => $caption,
                    'document' => new CURLFile($run['file'], 'application/gzip', basename($run['file'])),
                ],
            ]);
            $res = curl_exec($ch);
            $ok = is_string($res) && (str_contains($res, '"ok":true'));
            curl_close($ch);
            if ($ok) {
                karam_backup_writeStatus(array_merge(karam_backup_readStatus(), ['sentTelegram' => true]));
                if ($cli) {
                    echo '✓ فایل بکاپ به تلگرام ارسال شد (' . $sizeMb . ' MB)' . PHP_EOL;
                }
                return;
            }
        }
    }

    // بزرگ‌تر از سقف یا ارسال فایل ناموفق → فقط پیام گزارش
    TelegramBot::sendMessage($chatId, $caption . "\n📥 دانلود فایل: File Manager هاست ← storage/backups");
    karam_backup_writeStatus(array_merge(karam_backup_readStatus(), ['sentTelegram' => 'summary']));
    if ($cli) {
        echo '✓ گزارش بکاپ به تلگرام ارسال شد (فایل بزرگ‌تر از سقف ۴۵MB بود)' . PHP_EOL;
    }
}

function karam_backup_readStatus(): array
{
    $path = karam_backup_cacheDir() . '/backup-status.json';
    if (!is_file($path)) {
        return [];
    }
    $j = json_decode((string) @file_get_contents($path), true);
    return is_array($j) ? $j : [];
}

/** سقف نگه‌داری از .env */
function karam_backup_keep(): int
{
    return max(3, min(60, (int) (Config::get('BACKUP_KEEP', (string) KARAM_KEEP_DEFAULT) ?? KARAM_KEEP_DEFAULT)));
}

/* ================= حالت CLI — اجرای کرون ================= */

if ($isCli) {
    // قفل تک‌اجرایی — دو بکاپ هم‌زمان ممنوع
    $lockDir = dirname(karam_backup_storageDir()) . '/cron';
    if (!is_dir($lockDir)) {
        @mkdir($lockDir, 0775, true);
    }
    $lockFile = fopen($lockDir . '/backup.lock', 'c');
    if ($lockFile === false || !flock($lockFile, LOCK_EX | LOCK_NB)) {
        fwrite(STDERR, 'یک بکاپ دیگر در حال اجراست — این اجرا رد شد' . PHP_EOL);
        exit(0);
    }

    echo '🗄 کارام — بکاپ دیتابیس شروع شد (' . gmdate('Y-m-d H:i:s') . ' UTC)' . PHP_EOL;
    try {
        $run = karam_backup_run();
        $removed = karam_backup_prune(karam_backup_storageDir(), karam_backup_keep());
        karam_backup_writeStatus(array_merge(karam_backup_readStatus(), [
            'ok' => true,
            'file' => basename($run['file']),
            'bytes' => $run['bytes'],
            'method' => $run['method'],
            'tables' => $run['tables'],
            'pruned' => $removed,
            'at' => gmdate('Y-m-d\TH:i:s\Z'),
            'error' => null,
        ]));
        echo '✓ بکاپ ساخته شد: ' . basename($run['file']) . ' (' . round($run['bytes'] / 1048576, 2) . ' MB — ' . $run['method'] . ')' . PHP_EOL;
        if ($removed > 0) {
            echo '✓ ' . $removed . ' نسخه‌ی قدیمی حذف شد (سقف نگه‌داری: ' . karam_backup_keep() . ')' . PHP_EOL;
        }
        karam_backup_telegramReport($run, true);
        echo '✓ تمام' . PHP_EOL;
    } catch (Throwable $e) {
        karam_backup_fail($e->getMessage(), true);
    } finally {
        if (isset($lockFile) && is_resource($lockFile)) {
            flock($lockFile, LOCK_UN);
            fclose($lockFile);
        }
    }
    exit(0);
}

/* ================= حالت وب — فقط صفحه‌ی وضعیت با کلید ================= */

$check = (string) ($_GET['check'] ?? '');
if (!hash_equals(KARAM_BACKUP_CHECK_KEY, $check)) {
    http_response_code(404);
    exit('Not Found');
}

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');

// سید بی‌صدای کلید گزارش تلگرامی (تکرارپذیر) — تا در پنل قابل تنظیم باشد
try {
    Database::pdo()->prepare(
        "INSERT IGNORE INTO settings (`key`, `value`) VALUES ('backup_telegram_chat', '')"
    )->execute();
} catch (Throwable $e) {
    error_log('[karam-backup] seed backup_telegram_chat: ' . $e->getMessage());
}

$status = karam_backup_readStatus();
$dir = karam_backup_storageDir();
$files = glob($dir . '/karam-backup-*.sql.gz') ?: [];
rsort($files); // جدید اول
$totalBytes = 0;
foreach ($files as $f) {
    $totalBytes += (int) (@filesize($f) ?: 0);
}
$serverPath = str_replace(dirname(__DIR__, 2), '<مسیر-هاست>', $dir);

function h(string $v): string
{
    return htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>کارام — وضعیت بکاپ دیتابیس</title>
<style>
  body{font-family:Tahoma,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;line-height:1.9;margin:0;padding:24px}
  .box{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px}
  h1{font-size:19px;margin:0 0 4px}
  code{background:#f1f5f9;border-radius:8px;padding:2px 8px;font-size:12px;direction:ltr;display:inline-block}
  .pre{background:#f1f5f9;border-radius:10px;padding:12px;direction:ltr;text-align:left;font-size:12px;overflow-x:auto;white-space:pre-wrap;user-select:all}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  td,th{border-bottom:1px solid #f1f5f9;padding:7px 8px;text-align:right}
  th{color:#64748b;font-weight:700;font-size:12px}
  .ok{color:#059669;font-weight:800}.bad{color:#dc2626;font-weight:800}
  .muted{color:#64748b;font-size:12px}
  ol{padding-right:20px;font-size:14px}
</style>
</head>
<body>
<div class="box">
  <h1>🗄 وضعیت بکاپ خودکار کارام</h1>
  <p class="muted">فایل‌ها در <code><?= h($serverPath) ?></code> — بیرون از webroot و از وب قابل دانلود نیستند.</p>

  <p>آخرین اجرا:
    <?php if (!empty($status['ok'])): ?>
      <span class="ok">✓ موفق</span> — <?= h((string) ($status['at'] ?? '')) ?> UTC ·
      <?= h((string) ($status['file'] ?? '')) ?> ·
      <?= h((string) round(((int) ($status['bytes'] ?? 0)) / 1048576, 2)) ?> MB ·
      روش <?= h((string) ($status['method'] ?? '')) ?>
      <?php if (($status['sentTelegram'] ?? false) === true): ?> · ✓ ارسال به تلگرام
      <?php elseif (($status['sentTelegram'] ?? '') === 'summary'): ?> · ✓ گزارش تلگرامی<?php endif; ?>
    <?php elseif (!empty($status['error'])): ?>
      <span class="bad">✗ ناموفق</span> — <?= h((string) $status['error']) ?>
    <?php else: ?>
      هنوز اجرا نشده — کرون را طبق راهنمای پایین نصب کنید.
    <?php endif; ?>
  </p>

  <h2 style="font-size:15px">نسخه‌های موجود (<?= count($files) ?> نسخه — <?= round($totalBytes / 1048576, 1) ?> MB)</h2>
  <?php if ($files === []): ?>
    <p class="muted">هنوز فایلی نیست.</p>
  <?php else: ?>
  <table>
    <tr><th>فایل</th><th>حجم</th><th>تاریخ (UTC)</th></tr>
    <?php foreach (array_slice($files, 0, 10) as $f): ?>
      <tr>
        <td><?= h(basename((string) $f)) ?></td>
        <td><?= h((string) round(((int) (@filesize($f) ?: 0)) / 1048576, 2)) ?> MB</td>
        <td class="muted"><?= h(gmdate('Y-m-d H:i', (int) (@filemtime($f) ?: time()))) ?></td>
      </tr>
    <?php endforeach; ?>
  </table>
  <?php endif; ?>

  <h2 style="font-size:15px;margin-top:20px">راه‌اندازی کرون روزانه (۳ قدم)</h2>
  <ol>
    <li>DirectAdmin ← <b>Cron Jobs</b> ← Add New Cron Job</li>
    <li>زمان: هر روز <b>03:30</b> (دقیقه=<code dir="ltr">30</code>، ساعت=<code dir="ltr">3</code>)</li>
    <li>دستور (کپی کنید — مسیر php را اگر فرق داشت از راهنمای کرون تلگرام بگیرید):</li>
  </ol>
  <div class="pre"><?= h('/usr/local/bin/php ' . str_replace(dirname(__DIR__, 2), '', __FILE__)) ?></div>
  <p class="muted">⚠️ اگر فایل را هنوز آپلود نکرده‌اید: فایل <code>backup-db.php</code> داخل پوشه‌ی <code>api/cron/</code> در پک v19 است.</p>
  <p class="muted">برای گزارش روزانه در تلگرام: پنل ← تنظیمات ← «بکاپ و پشتیبان» ← شناسه چت ادمین (عددی) را بنویسید؛ ربات همان فایل بکاپ را می‌فرستد (تا ۴۵MB، بزرگ‌تر = فقط گزارش).</p>
</div>
</body>
</html>

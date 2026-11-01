<?php

declare(strict_types=1);

/**
 * کارام — بکاپ خودکار روزانه دیتابیس (گام ۱۹ — عملیات) + ماسک رازها (P1)
 *
 * چه می‌کند:
 *   ۱) از کل دیتابیس (همه‌ی جداول) یک dump فشرده‌ی .sql.gz می‌سازد
 *      → در storage/backups (بیرون از webroot؛ .htaccess دسترسی وب را بسته است)
 *      P1 — مقدار ۵ کلید راز جدول settings (فهرست رسمی INSTALL بخش ۱۹-۲:
 *      smtp_pass، telegram_bot_token، zibal_merchant، provider_sms_url،
 *      provider_sms_headers) در dump «خالی» می‌شود؛ بازیابی: پس از restore ادمین
 *      همین کلیدها را یک‌بار در «پنل ← تنظیمات» دوباره وارد می‌کند.
 *   ۲) فقط ۷ نسخه‌ی آخر را نگه می‌دارد (BACKUP_KEEP در .env قابل تغییر)
 *   ۳) اگر ربات تلگرام + «شناسه چت ادمین» (پنل ← تنظیمات ← بکاپ) تنظیم شده باشد،
 *      فایل بکاپ را تا سقف ۴۵MB به تلگرام می‌فرستد (بزرگ‌تر = فقط پیام گزارش)
 *   ۴) وضعیت آخرین اجرا در storage/cache/backup-status.json ثبت می‌شود
 *
 * چرا سه روش dump؟
 *   - mysqldump اگر روی هاست موجود باشد (DirectAdmin معمولاً دارد) — سریع‌ترین راه
 *     (P1.1: رمز دیتابیس با --defaults-extra-file موقت chmod 600 داده می‌شود، نه خط فرمان)
 *     (P1.2: خروجی mysqldump خط‌به‌خط اسکن می‌شود — اگر --ignore-table نادیده شده
 *     باشد و settings داخل dump باشد، dump دور ریخته و به php-dump ماسک‌دار برمی‌گردیم)
 *   - وگرنه dump خالص PHP (SHOW CREATE TABLE + INSERT) — همیشه کار می‌کند، بدون exec
 *     (P1.2: SHOW CREATE TABLE ناموفق/خالی برای هر جدولی = exception — هیچ جدولی
 *     بی‌صدا از بکاپ رد نمی‌شود؛ شکست هم فایل‌های موقت را پاک می‌کند)
 *   - SQLite (توسعه‌ی محلی): کپی فایل + ماسک روی کپی + VACUUM
 *
 * راه‌اندازی (مثل کرون تلگرام — بدون SSH):
 *   ۱) فایل در مسیر api/cron/backup-db.php
 *   ۲) وضعیت/دستور کرون آماده: https://دامنه/api/cron/backup-db.php?check=karam-backup-check
 *      (P1.1 — کلید وضعیت با .env: BACKUP_CHECK_KEY قابل تغییر است؛ خالی/ناموجود = همین پیش‌فرض)
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
require_once $srcDir . '/Config.php';
require_once $srcDir . '/Database.php';
require_once $srcDir . '/Support/FileCache.php'; // ⚠️ الزامی — Settings::all به FileCache وابسته است (v17)
require_once $srcDir . '/Support/Settings.php';
require_once $srcDir . '/Support/BackupMask.php'; // P1 — ماسک رازهای settings در dump
require_once $srcDir . '/Services/TelegramBot.php';

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
 * P1.2 — آیا فایل dump حاوی تعریف/درج جدول settings است؟ (استریم خط‌به‌خط)
 *
 * چرا؟ اگر mysqldumpِ هاست (مثلاً نسخه‌ای از MariaDB) --ignore-table را نادیده
 * بگیرد، جدول settings با راز واقعی داخل dump می‌آید و بعد دوباره (ماسک‌شده)
 * الحاق می‌شود ⇒ فایل بکاپ راز لو می‌دهد. پس پس از هر mysqldump موفق، خروجی
 * خط‌به‌خط اسکن می‌شود (بدون بار کردن کل فایل در حافظه)؛ اگر settings در آن بود،
 * dump دور ریخته می‌شود و مسیر dump خالص PHP (که ماسک دارد) جای آن را می‌گیرد.
 *
 * ملاک فقط خط‌هایی است که دقیقاً با «CREATE TABLE `settings`» یا
 * «INSERT INTO `settings`» شروع شوند — کلمه‌ی settings در کامنت یا نام جدول
 * دیگر (مثل settings_log) ملاک نیست.
 *
 * جدا از karam_backup_run تا تست‌پذیر باشد (trust-test).
 */
function karam_backup_dump_contains_settings(string $path): bool
{
    $fh = @fopen($path, 'rb');
    if ($fh === false) {
        // نمی‌توانیم تضمین کنیم settings در dump نیست → شکست امن (بکاپ fail و ثبت در وضعیت)
        throw new RuntimeException('اسکن امنیتی dump برای جدول settings ناموفق بود (فایل خوانا نیست)');
    }
    try {
        while (($line = fgets($fh)) !== false) {
            $t = ltrim($line);
            if (str_starts_with($t, 'CREATE TABLE `settings`') || str_starts_with($t, 'INSERT INTO `settings`')) {
                return true;
            }
        }
    } finally {
        fclose($fh);
    }
    return false;
}

/**
 * P1.1 — الحاق بخش settings (با ماسک رازها) به dump مسیر mysqldump.
 *
 * چرا جدول settings از mysqldump حذف و دستی اضافه می‌شود؟ تا مقدار ۵ کلید راز
 * هرگز وارد فایل بکاپ نشود (mysqldump امکان ماسک ستونی ندارد).
 *
 * شکست = exception (بکاپ fail و در فایل وضعیت ثبت می‌شود) — عمداً هیچ مسیر
 * «بی‌صدا رد شو» وجود ندارد: بکاپِ بدون جدول settings بکاپ ناقص است و باید
 * جایش را به روش dump خالص PHP بدهد یا کلاً fail کند، نه سکوت.
 *
 * بخش SQL تولیدی با «SET NAMES utf8mb4;» شروع می‌شود تا restore در هر کلاینت
 * (mysql CLI / phpMyAdmin) با کدگذاری درست ردیف‌های فارسی بنشیند.
 */
function karam_backup_append_settings_section(PDO $pdo, string $dbName, string $tmpPath): void
{
    $settingsSql = "\n-- بخش تنظیمات (P1 — رازها ماسک شده‌اند): مقدار کلیدهای راز خالی است؛"
        . "\n-- بازیابی: پنل ← تنظیمات ← smtp_pass، telegram_bot_token، zibal_merchant، provider_sms_url، provider_sms_headers"
        . "\nSET NAMES utf8mb4;\n";

    $safeDb = str_replace('`', '', $dbName);
    try {
        $create = $pdo->query('SHOW CREATE TABLE `' . $safeDb . '`.`settings`')->fetch(PDO::FETCH_NUM);
    } catch (Throwable $e) {
        throw new RuntimeException('خواندن ساختار جدول settings ناموفق بود: ' . $e->getMessage());
    }
    if ($create === false || !isset($create[1]) || trim((string) $create[1]) === '') {
        // گارد P1.1 — بدون این، جدول settings بی‌صدا از بکاپ می‌افتاد (تنظیمات همه گم می‌شد)
        throw new RuntimeException('ساختار جدول settings خوانده نشد (SHOW CREATE TABLE خالی) — بکاپ عمداً fail شد تا settings بی‌صدا از بکاپ نیفتد');
    }

    $settingsSql .= "DROP TABLE IF EXISTS `settings`;\n" . (string) $create[1] . ";\n";
    $rows = $pdo->query('SELECT * FROM `settings`');
    while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
        $rowKey = (string) ($row['key'] ?? '');
        $values = [];
        foreach ($row as $k => $v) {
            if ($v === null) {
                $values[] = 'NULL';
                continue;
            }
            // فقط ستون value رازها خالی می‌شود؛ نام کلید می‌ماند تا ادمین بداند چه چیزی را دوباره وارد کند
            $masked = ((string) $k === 'value' && BackupMask::isSecret($rowKey)) ? '' : (string) $v;
            $values[] = $pdo->quote($masked);
        }
        $settingsSql .= 'INSERT INTO `settings` VALUES (' . implode(',', $values) . ");\n";
    }
    file_put_contents($tmpPath, $settingsSql, FILE_APPEND | LOCK_EX);
}

/**
 * P1.2 — dump خالص PHP — از karam_backup_run جدا شد تا تست‌پذیر باشد (trust-test).
 *
 * قاعده: هیچ جدولی بی‌صدا از بکاپ رد نمی‌شود — SHOW CREATE TABLE برای هر جدولی
 * خطا بدهد یا خالی برگرداند، RuntimeException با نام همان جدول پرتاب می‌شود تا
 * بکاپ fail شود و در فایل وضعیت ثبت گردد (رفتار قدیمی «continue بی‌صدا» حذف شد).
 *
 * @return array{sql:string, tables:int}
 */
function karam_backup_php_dump(PDO $pdo, string $dbName): array
{
    $sql = "-- کارام — بکاپ خالص PHP\n";
    $sql .= "-- at " . gmdate('Y-m-d\TH:i:s\Z') . " db={$dbName}\n";
    $sql .= "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n";

    $stmt = $pdo->query('SHOW TABLES');
    $allTables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $tables = count($allTables);

    foreach ($allTables as $table) {
        $t = (string) $table;
        // P1.2 — نام جدول در SHOW CREATE TABLE با بک‌تیک امن می‌شود (مثل مسیر mysqldump)
        $safeTable = str_replace('`', '', $t);
        try {
            $create = $pdo->query('SHOW CREATE TABLE `' . $safeTable . '`')->fetch(PDO::FETCH_NUM);
        } catch (Throwable $e) {
            throw new RuntimeException("خواندن ساختار جدول {$t} ناموفق بود (SHOW CREATE TABLE): " . $e->getMessage());
        }
        if ($create === false || !isset($create[1]) || trim((string) $create[1]) === '') {
            // P1.2 — بدون این، جدول بی‌صدا از بکاپ می‌افتاد (رفتار قدیمی continue حذف شد)
            throw new RuntimeException("ساختار جدول {$t} خوانده نشد (SHOW CREATE TABLE خالی) — بکاپ عمداً fail شد تا هیچ جدولی بی‌صدا از بکاپ نیفتد");
        }
        $sql .= "DROP TABLE IF EXISTS `" . $t . "`;\n";
        $sql .= (string) $create[1] . ";\n";

        $rows = $pdo->query('SELECT * FROM `' . $t . '`');
        $buffer = '';
        $count = 0;
        $isSettings = $t === 'settings'; // P1 — ردیف‌های رازدار ماسک می‌شوند
        while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
            $rowKey = (string) ($row['key'] ?? '');
            $isSecretRow = $isSettings && BackupMask::isSecret($rowKey);
            $values = [];
            foreach ($row as $k => $v) {
                if ($v === null) {
                    $values[] = 'NULL';
                    continue;
                }
                // فقط ستون value رازها خالی می‌شود؛ نام کلید می‌ماند تا ادمین بعد از بازیابی بداند چه چیزی را دوباره وارد کند
                $masked = ($isSecretRow && (string) $k === 'value') ? '' : (string) $v;
                $values[] = $pdo->quote($masked);
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

    return ['sql' => $sql, 'tables' => $tables];
}

/**
 * P1.2 — پاک‌سازی فایل‌های موقت پس از شکست بکاپ — عمداً با @unlink:
 * پاک‌سازی هرگز خودش استثنا نمی‌دهد تا خطای اصلی گم نشود.
 */
function karam_backup_cleanup_failed(string $tmpPath, string $gzPath, bool $gzCreated, string $errPath): void
{
    @unlink($tmpPath);    // .sql.tmp ناقص
    if ($gzCreated) {
        @unlink($gzPath); // فقط .gz ناقصِ همین اجرا — نسخه‌های موفق قبلی دست نمی‌خورند
    }
    @unlink($errPath);    // .mysqldump-err
}

/** @return array{file:string, bytes:int, method:string, tables:int} */
function karam_backup_run(): array
{
    $dir = karam_backup_storageDir();
    $started = microtime(true);

    // نام فایل — با تاریخ UTC (همه‌ی زمان‌های کارام UTC است)
    $base = 'karam-backup-' . gmdate('Y-m-d-His');
    $tmpPath = $dir . '/' . $base . '.sql.tmp';
    $gzPath = $dir . '/' . $base . '.sql.gz';
    $errPath = $dir . '/.mysqldump-err';

    // P1.2 — هر شکستی (حتی استثنای الحاق settings یا شکست فشرده‌سازی) باید فایل‌های
    // موقت را پاک بگذارد: .sql.tmp، .sql.gz ناقصِ همین اجرا و .mysqldump-err
    $completed = false;
    $gzCreated = false; // فقط .gz ناقصِ همین اجرا پاک می‌شود (نه نسخه‌های موفق قبلی)
    try {
        $result = karam_backup_build($dir, $tmpPath, $gzPath, $errPath, $gzCreated, $started);
        $completed = true;
        return $result;
    } finally {
        if (!$completed) {
            karam_backup_cleanup_failed($tmpPath, $gzPath, $gzCreated, $errPath);
        }
    }
}

/**
 * بدنه‌ی بکاپ (سه مسیر: sqlite-copy / mysqldump / php-dump) — از karam_backup_run
 * جدا شد تا پاک‌سازی شکست (try/finally) یک‌جا بماند و توابع تست‌پذیر شوند (P1.2).
 *
 * @param bool $gzCreated خروجی با ارجاع: آیا فایل .gz همین اجرا نوشته شد؟ (برای پاک‌سازی ناقص)
 * @return array{file:string, bytes:int, method:string, tables:int}
 */
function karam_backup_build(
    string $dir,
    string $tmpPath,
    string $gzPath,
    string $errPath,
    bool &$gzCreated,
    float $started
): array {
    $driver = (string) (Config::get('DB_DRIVER', 'mysql') ?? 'mysql');

    if ($driver === 'sqlite') {
        // توسعه‌ی محلی — کپی فایل دیتابیس (کلید .env: SQLITE_PATH — هم‌نام Database.php)
        // P1 — قبل از فشرده‌سازی، رازهای settings روی «کپی» خالی می‌شوند تا بکاپ محلی هم بدون راز باشد.
        $dbPath = (string) (Config::get('SQLITE_PATH', dirname(__DIR__) . '/storage/karam-dev.sqlite3') ?? '');
        if ($dbPath === '' || !is_file($dbPath)) {
            throw new RuntimeException('فایل دیتابیس SQLite پیدا نشد: ' . $dbPath);
        }
        if (!@copy($dbPath, $tmpPath)) {
            throw new RuntimeException('کپی فایل SQLite ناموفق بود');
        }
        try {
            $cpdo = new PDO('sqlite:' . $tmpPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $ph = implode(',', array_fill(0, count(BackupMask::SECRET_KEYS), '?'));
            $cpdo->prepare("UPDATE settings SET value = '' WHERE \"key\" IN ({$ph})")
                ->execute(BackupMask::SECRET_KEYS);
            // VACUUM — بدون آن، مقدار قدیمی رازها در صفحات آزاد فایل می‌ماند و
            // با جست‌وجوی باینری قابل بازیابی است؛ VACUUM فایل را بازسازی می‌کند.
            $cpdo->exec('VACUUM');
            $cpdo = null;
        } catch (Throwable $e) {
            @unlink($tmpPath);
            throw new RuntimeException('ماسک رازها در بکاپ SQLite ناموفق بود: ' . $e->getMessage());
        }
        $bytes = filesize($tmpPath) ?: 0;
        $gz = gzencode((string) file_get_contents($tmpPath), 6);
        if ($gz === false) {
            throw new RuntimeException('فشرده‌سازی ناموفق بود');
        }
        file_put_contents($gzPath, $gz);
        $gzCreated = true;
        @unlink($tmpPath);
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
        // P1.1 — رمز دیتابیس با --defaults-extra-file داده می‌شود، نه --password= در خط فرمان
        // (رمز در ps/لاگ کرون دیده نمی‌شود؛ فایل با chmod 600 ساخته و در finally حذف می‌شود)
        $defaultsPath = $dir . '/.my-karam-backup-' . getmypid() . '.cnf';
        $noEol = static fn (string $v): string => str_replace(["\r", "\n"], '', $v);
        $cnf = "[client]\n"
            . 'host=' . $noEol($host) . "\n"
            . 'port=' . $noEol($port) . "\n"
            . 'user=' . $noEol($user) . "\n"
            . 'password="' . str_replace(['\\', '"', "\r", "\n"], ['\\\\', '\\"', '', ''], $pass) . "\"\n";
        // P1.2 — فایل از لحظه‌ی ساخت فقط برای مالک خوانا است: umask(0077) قبل از نوشتن
        // (پنجره‌ی «ساخت با دسترسی باز → chmod» حذف می‌شود)؛ umask قبلی در finally برمی‌گردد.
        $oldUmask = umask(0077);
        try {
            $ok = @file_put_contents($defaultsPath, $cnf);
            if ($ok !== false) {
                $ok = @chmod($defaultsPath, 0600); // chmod بعد از نوشتن هم نگه داشته می‌شود
            }
        } finally {
            umask($oldUmask);
        }
        if ($ok === false) {
            @unlink($defaultsPath);
            throw new RuntimeException('ساخت فایل موقت اعتبار mysqldump (نوشتن یا chmod 600) ناموفق بود');
        }
        try {
            // ⚠️ --defaults-extra-file باید اولین گزینه باشد (قاعده‌ی CLI های mysql/mariadb)
            // P1 — جدول settings را mysqldump نمی‌ریزد؛ بعداً با مقدار ماسک‌شده دستی اضافه می‌شود
            $cmd = escapeshellarg($mysqldump)
                . ' --defaults-extra-file=' . escapeshellarg($defaultsPath)
                . ' --single-transaction --quick --routines --no-tablespaces '
                . ' --ignore-table=' . escapeshellarg($name . '.settings')
                . ' ' . escapeshellarg($name)
                . ' > ' . escapeshellarg($tmpPath) . ' 2> ' . escapeshellarg($errPath);
            @exec($cmd, $out, $code);
            if ($code === 0 && is_file($tmpPath) && filesize($tmpPath) > 200) {
                // P1.2 — گارد: اگر mysqldump هاست (مثلاً نسخه‌ای از MariaDB) --ignore-table را
                // نادیده گرفته باشد، settings با راز واقعی داخل dump می‌آید و بعد دوباره
                // (ماسک‌شده) الحاق می‌شود ⇒ راز در فایل بکاپ لو می‌رود. پس خروجی استریمی
                // اسکن می‌شود؛ اگر settings بود: dump دور ریخته و به php-dump ماسک‌دار برمی‌گردیم
                // (روش ثبت‌شده در فایل وضعیت همان php-dump می‌شود — همان چیزی که واقعاً استفاده شده).
                if (karam_backup_dump_contains_settings($tmpPath)) {
                    @unlink($tmpPath);
                    error_log('[karam-backup] mysqldump جدول settings را ignore نکرد؛ fallback به php-dump');
                } else {
                    // الحاق بخش settings با ماسک رازها (P1) — شکست = exception (بکاپ fail می‌شود)
                    karam_backup_append_settings_section($pdo, $name, $tmpPath);
                    $dumped = true;
                }
            }
            @unlink($errPath);
        } finally {
            // رمز دیتابیس هرگز روی دیسک نمی‌ماند — حتی اگر mysqldump وسط کار کرش کند
            @unlink($defaultsPath);
        }
    }

    // روش ۲: dump خالص PHP — بدون exec، همیشه در دسترس
    // P1.2 — تابع جدا شد (تست‌پذیر) و هیچ جدولی بی‌صدا رد نمی‌شود
    if (!$dumped) {
        $dump = karam_backup_php_dump($pdo, $name);
        $tables = $dump['tables'];
        file_put_contents($tmpPath, $dump['sql']);
    }

    // فشرده‌سازی + جای‌گذاری اتمیک
    $gz = gzencode((string) file_get_contents($tmpPath), 6);
    if ($gz === false) {
        throw new RuntimeException('فشرده‌سازی gzip ناموفق بود');
    }
    file_put_contents($gzPath, $gz, LOCK_EX);
    $gzCreated = true;
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

/** P1.1 — کلید صفحه‌ی وضعیت وب — .env: BACKUP_CHECK_KEY (خالی/ناموجود = پیش‌فرض سازگار با عقب) */
function karam_backup_check_key(): string
{
    $fromEnv = trim((string) (Config::get('BACKUP_CHECK_KEY', '') ?? ''));
    return $fromEnv !== '' ? $fromEnv : KARAM_BACKUP_CHECK_KEY;
}

/* ================= اجرا — فقط وقتی مستقیم اجرا می‌شود ================= */

// P1.1 — حالت «فقط تعریف» برای تست واحد (trust-test): توابع load می‌شوند، بکاپ اجرا نمی‌شود
if (defined('KARAM_BACKUP_INCLUDE_ONLY')) {
    return;
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
if (!hash_equals(karam_backup_check_key(), $check)) {
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
  <p class="muted">⚠️ در هر نسخه‌ی بکاپ، مقدار ۵ کلید راز جدول settings خالی می‌شود (smtp_pass، telegram_bot_token، zibal_merchant، provider_sms_url، provider_sms_headers) — بعد از بازیابی، همین کلیدها را در «پنل ← تنظیمات» دوباره وارد کنید. نسخه‌ی تلگرامی مشمول پاک‌سازی خودکار نسخه‌های محلی (BACKUP_KEEP) نیست؛ خودتان از گفتگوی ربات پاکش کنید.</p>
  <p class="muted">⚠️ اگر فایل را هنوز آپلود نکرده‌اید: فایل <code>backup-db.php</code> داخل پوشه‌ی <code>api/cron/</code> در پک v19 است.</p>
  <p class="muted">برای گزارش روزانه در تلگرام: پنل ← تنظیمات ← «بکاپ و پشتیبان» ← شناسه چت ادمین (عددی) را بنویسید؛ ربات همان فایل بکاپ را می‌فرستد (تا ۴۵MB، بزرگ‌تر = فقط گزارش).</p>
</div>
</body>
</html>

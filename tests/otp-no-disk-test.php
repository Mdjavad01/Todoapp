<?php

declare(strict_types=1);

/**
 * کارام — تست واحد ممیزی M-06 (v1.12.0): «هیچ کد OTP خامی روی دیسک نوشته نمی‌شود»
 *
 * ثابت می‌کند:
 *   ۱) Otp::createCode (ورود) و createCode با purpose=account_delete هیچ فایل جدیدی
 *      زیر backend/storage نمی‌سازند و هیچ فایل موجودی (غیر-DB) را تغییر نمی‌دهند
 *   ۲) ژورنال قدیمی storage/cache/issued-otp.jsonl هرگز ساخته نمی‌شود
 *   ۳) APIهای ژورنال (recordIssued / lastIssuedFor / lastIssuedForTicket) کلاً حذف شده‌اند
 *   ۴) کد خام در هیچ فایل متنیِ storage (به‌جز فایل‌های sqlite که hash دارند) پیدا نمی‌شود
 *   ۵) کدِ حذف حساب و کدِ ورود هر دو فقط در DB (به‌صورت hash) و در مقدار بازگشتی‌اند
 *
 *  اجرا (بدون سرور — مستقیم CLI):
 *   php tests/otp-no-disk-test.php
 *
 *  نکته: دامنه‌ی اسکن عمداً «فایل‌های غیر-sqlite» است — در محیط محلی MAIL_TRANSPORT=log
 *  ارسال ایمیل (نه createCode) کد را در storage/logs/mail.log می‌نویسد که رفتار مستند
 *  «توسعه‌ی محلی» است و روی هاست (mail/smtp) وجود ندارد. این تست خودش هیچ ارسالی نمی‌زند.
 */

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

/* ---------- بارگذاری هسته (مخزن) ---------- */
$srcDir = ROOT . '/backend/src';
require $srcDir . '/Config.php';
require $srcDir . '/Database.php';
require $srcDir . '/Support/FileCache.php';
require $srcDir . '/Support/Settings.php';
require $srcDir . '/Auth/Otp.php';

function dbPath(): string
{
    // مثل بقیه‌ی تست‌ها: از backend/.env بخوان، وگرنه پیش‌فرض مخزن
    $envFile = ROOT . '/backend/.env';
    $path = ROOT . '/backend/storage/karam-dev.sqlite3';
    if (is_file($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if (str_starts_with($line, 'SQLITE_PATH=')) {
                $v = trim(trim(substr($line, strlen('SQLITE_PATH='))), '"\'');
                if ($v !== '') {
                    $path = $v;
                }
            }
        }
    }
    return $path;
}

function resetDb(): void
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

/** نقشه‌ی فایل‌های storage (غیر-sqlite) → mtime|size|hash */
function storageSnapshot(): array
{
    $dir = ROOT . '/backend/storage';
    $out = [];
    if (!is_dir($dir)) {
        return $out;
    }
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if (!$f->isFile()) {
            continue;
        }
        if (str_ends_with($f->getFilename(), '.sqlite3') || str_ends_with($f->getFilename(), '-wal') || str_ends_with($f->getFilename(), '-shm')) {
            continue; // فایل‌های DB خودشان تغییر می‌کنند (INSERT) — خارج از ادعای این تست
        }
        $p = $f->getPathname();
        $out[$p] = md5((string) @file_get_contents($p)) . '|' . $f->getSize();
    }
    return $out;
}

/** آیا کد خام در فایل‌های غیر-sqlite زیر storage هست؟ */
function rawCodeOnDisk(string $code): bool
{
    if ($code === '') {
        return false;
    }
    $dir = ROOT . '/backend/storage';
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if (!$f->isFile() || $f->getSize() > 16 * 1024 * 1024) {
            continue;
        }
        $name = $f->getFilename();
        if (str_ends_with($name, '.sqlite3') || str_ends_with($name, '-wal') || str_ends_with($name, '-shm')) {
            continue; // DB فقط hash دارد (با احکام پایین تست می‌شود)
        }
        $content = @file_get_contents($f->getPathname());
        if ($content !== false && str_contains($content, $code)) {
            return true;
        }
    }
    return false;
}

/* ================= setup ================= */
resetDb();
@unlink(ROOT . '/backend/storage/cache/issued-otp.jsonl'); // فایل قدیمی هاست‌های قبلی — نباید برگردد
echo "— آماده‌سازی: دیتابیس sqlite نو از install.sqlite.sql\n\n";

$journal = ROOT . '/backend/storage/cache/issued-otp.jsonl';

/* ================= ۱) APIهای ژورنال حذف شده‌اند ================= */
echo "۱) حذف کامل APIهای ژورنال (M-06)\n";
check('Otp::recordIssued دیگر وجود ندارد', !method_exists('Otp', 'recordIssued'));
check('Otp::lastIssuedFor دیگر وجود ندارد', !method_exists('Otp', 'lastIssuedFor'));
check('Otp::lastIssuedForTicket دیگر وجود ندارد', !method_exists('Otp', 'lastIssuedForTicket'));
check('فایل ژورنال قدیمی وجود ندارد', !is_file($journal));

/* ================= ۲) createCode (ورود) — هیچ اثری روی دیسک ================= */
echo "\n۲) Otp::createCode — ورود\n";
$before = storageSnapshot();
$created = Otp::createCode(Database::pdo(), 'email', 'disktest@example.com', '127.0.0.1');
$code = (string) ($created['code'] ?? '');
$after = storageSnapshot();
check('کد ۶ رقمی صادر شد', preg_match('/^\d{6}$/', $code) === 1, $code);
check('هیچ فایل جدید/تغییریادی در storage (غیر-DB) رخ نداد', $before === $after, json_encode(array_diff_assoc($after, $before) + array_diff_assoc($before, $after)));
check('ژورنال issued-otp.jsonl ساخته نشد', !is_file($journal));
check('کد خام در هیچ فایل storage (غیر-DB) نیست', !rawCodeOnDisk($code));

$st = Database::pdo()->prepare('SELECT code_hash, purpose FROM otp_requests WHERE identity_value = :v ORDER BY id DESC LIMIT 1');
$st->execute([':v' => 'disktest@example.com']);
$row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
check('DB فقط hash دارد — hash با کد خام برابر نیست', ($row['code_hash'] ?? '') !== $code && ($row['code_hash'] ?? '') !== '');
check('purpose = login', ($row['purpose'] ?? '') === 'login');

/* ================= ۳) createCode (حذف حساب) — باز هم هیچ اثری روی دیسک ================= */
echo "\n۳) Otp::createCode — حذف حساب (purpose جدا)\n";
$before = storageSnapshot();
$created2 = Otp::createCode(Database::pdo(), 'email', 'disktest@example.com', '127.0.0.1', Otp::PURPOSE_ACCOUNT_DELETE);
$code2 = (string) ($created2['code'] ?? '');
$after = storageSnapshot();
check('کد حذف حساب صادر شد', preg_match('/^\d{6}$/', $code2) === 1, $code2);
check('هیچ فایل جدید/تغییریادی در storage (غیر-DB) رخ نداد', $before === $after);
check('کد حذف حساب هم روی دیسک نیست', !rawCodeOnDisk($code2));

$st2 = Database::pdo()->prepare('SELECT purpose, code_hash FROM otp_requests WHERE identity_value = :v ORDER BY id DESC LIMIT 1');
$st2->execute([':v' => 'disktest@example.com']);
$row2 = $st2->fetch(PDO::FETCH_ASSOC) ?: [];
check('purpose = account_delete', ($row2['purpose'] ?? '') === 'account_delete');
check('کد حذف حساب هم فقط hash است', ($row2['code_hash'] ?? '') !== $code2);

/* ================= ۴) createTicket — باز هم هیچ اثری روی دیسک ================= */
echo "\n۴) Otp::createTicket — بلیت تلگرام\n";
$before = storageSnapshot();
$ticket = Otp::createTicket(Database::pdo(), '127.0.0.1');
$after = storageSnapshot();
check('بلیت صادر شد', is_array($ticket) && isset($ticket['ticket']));
check('هیچ فایل جدید/تغییریادی در storage (غیر-DB) رخ نداد', $before === $after);
check('ژورنال همچنان وجود ندارد', !is_file($journal));

/* ================= نتیجه ================= */
echo "\n────────────────────────────\n";
echo "نتیجه: {$pass} موفق / {$fail} ناموفق\n";
if ($fail > 0) {
    exit(1);
}
echo "هیچ کد OTP خامی روی دیسک نوشته نمی‌شود ✓ (M-06)\n";

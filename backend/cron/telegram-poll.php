<?php

declare(strict_types=1);

/**
 * کارام — Worker ربات تلگرام (کرون اشتراکی، بدون webhook) — فاز ۷
 *
 * معماری (بر اساس تست‌های واقعی هاست):
 *   Telegram ──getUpdates──▶ PHP Worker (Cron) ──▶ تطبیق بلیت ──▶ MySQL ──▶ sendMessage ──▶ Telegram
 *
 * چرا webhook نه؟ روی این هاست مسیر ورودی Telegram→PHP با Connection timed out مواجه
 * می‌شود؛ ولی مسیر خروجی (cURL به api.telegram.org) و getUpdates کاملاً سالم است.
 * پس ربات با «کشیدن» (pull) کار می‌کند نه «هل دادن» (push).
 *
 * نحوه‌ی کار:
 *  - DirectAdmin هر ۱ دقیقه این فایل را با PHP CLI اجرا می‌کند.
 *  - هر اجرا تا ۴۵ ثانیه، هر ۳ ثانیه یک‌بار به‌روزرسانی‌های ربات را می‌خواند؛
 *    از همان مسیر مشترک TelegramBot::pollAndMatchTickets استفاده می‌کند که اپ هم
 *    موقع poll استفاده می‌کند → منطق تطبیق بلیت یک‌جا و بدون نسخه‌ی موازی است.
 *  - آفست و صف پیام‌ها در storage/cache/telegram-updates.json نگه‌داری می‌شود
 *    (همان مکانیزم قبلی) → هیچ پیامی دوبار پردازش نمی‌شود و با تغییر توکن هم
 *    آفست خودکار صفر می‌شود.
 *  - قفل Worker (storage/cron/telegram-worker.lock) مانع اجرای هم‌زمان دو Worker است.
 *  - قفل خواندن getUpdates مانع تداخل Worker با poll اپ است (خطای 409 نمی‌گیریم).
 *  - شروع هر اجرا یک‌بار deleteWebhook می‌زند تا اگر جایی webhook ثبت شده باشد
 *    (اپ قبلی/تست قبلی) خودش پاک شود — وقتی webhook ثبت نباشد این فراخوانی بی‌ضرر است.
 *
 * مصرف منابع روی هاست اشتراکی:
 *  - هر اجرا ≈ ۱۵ درخواست HTTPS کوچک + چند SELECT سبک — همه I/O-wait؛
 *    عملاً هیچ بار CPU/Memory معناداری ندارد و بعد از ۴۵ ثانیه تمام می‌شود.
 *
 * راه‌اندازی (بدون SSH):
 *  ۱) این فایل را در مسیر api/cron/ بگذارید.
 *  ۲) در مرورگر باز کنید:  https://app.hojre24shop.ir/api/cron/telegram-poll.php?check=karam-bot-check
 *     همین صفحه وضعیت توکن/webhook/Worker را می‌گوید و «دستور کرون آماده‌ی کپی» می‌دهد.
 *  ۳) DirectAdmin ← Cron Jobs ← اجرای هر ۱ دقیقه با همان دستور.
 *
 * توسعه‌ی آینده (ربات چندمرحله‌ای/AI):
 *  - نقطه‌ی تزریق منطق جدید، همان pollAndMatchTickets در src/Services/TelegramBot.php است؛
 *    هر Update پردازش‌شده از اینجا عبور می‌کند و داده‌های کاری در MySQL می‌مانند
 *    (otp_requests بلیت/کد). صف پیام‌های پردازش‌نشده هم در فایل state زیر قفل است.
 */

const KARAM_CHECK_KEY = 'karam-bot-check';

/* ---------- بارگذاری هسته‌ی کارام (هر دو چیدمان: مخزن و هاست) ---------- */

$srcDir = dirname(__DIR__) . '/src';
require $srcDir . '/Config.php';
require $srcDir . '/Database.php';
require $srcDir . '/Support/Settings.php';
require $srcDir . '/Auth/Otp.php';
require $srcDir . '/Services/TelegramBot.php';

date_default_timezone_set('UTC');

$isCli = PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg';

if (!$isCli) {
    // دسترسی وب: فقط صفحه‌ی وضعیت با کلید — بقیه‌ی درخواست‌ها بی‌صدا ۴۰۴
    if (($_GET['check'] ?? '') !== KARAM_CHECK_KEY) {
        http_response_code(404);
        exit;
    }
    karamTelegramCheckPage();
    exit;
}

/* ================= حالت CLI — Worker کرون ================= */

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$root = dirname(__DIR__); // api/ (هاست) یا backend/ (مخزن)

// لاگ اختصاصی — stderr کرون و ایمیل DirectAdmin را شلوغ نمی‌کند
$logDir = $root . '/storage/logs';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0775, true);
}
if (is_dir($logDir) && is_writable($logDir)) {
    ini_set('error_log', $logDir . '/karam-bot.log');
}

try {
    set_time_limit(120); // دفاعی — در CLI معمولاً بدون محدودیت است

    // قفل Worker — اگر اجرای قبلی هنوز زنده است، این اجرا بی‌صدا رد می‌شود
    $lockDir = $root . '/storage/cron';
    if (!is_dir($lockDir)) {
        @mkdir($lockDir, 0775, true);
    }
    $lock = @fopen($lockDir . '/telegram-worker.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
        karamBotLog('اجرای قبلی هنوز در جریان است — این اجرا رد شد');
        exit(0);
    }

    if (!TelegramBot::configured()) {
        karamBotLog('توکن ربات تنظیم نشده (پنل ← تنظیمات ← پروایدر تلگرام) — خروج');
        flock($lock, LOCK_UN);
        fclose($lock);
        exit(0);
    }

    // اگر توکن عوض شده باشد، آفست ربات قبلی برای ربات جدید بی‌معناست → صفر می‌کنیم
    karamResetOffsetIfTokenChanged();

    // خودترمیمی webhook — بدون آن هر getUpdates با 409 دو برابر فراخوانی می‌خورد
    TelegramBot::clearWebhook();

    $startedAt = time();
    $deadline = $startedAt + 45;
    karamBotLog('worker شروع شد — تا ' . gmdate('H:i:s', $deadline) . ' UTC');

    $cycles = 0;
    while (time() < $deadline) {
        TelegramBot::pollAndMatchTickets(Database::pdo());
        $cycles++;
        if (time() + 4 >= $deadline) {
            break; // وقت خروج امن — اجرای بعدی یک دقیقه‌ی دیگر
        }
        sleep(3); // کش ۲ ثانیه‌ای داخل pollAndMatchTickets + فاصله‌ی ۳ ثانیه = هر چرخه یک خواندن تازه
    }

    karamWriteStatus($cycles, $startedAt);
    karamBotLog("worker پایان یافت — {$cycles} چرخه");

    flock($lock, LOCK_UN);
    fclose($lock);
} catch (Throwable $e) {
    karamBotLog('خطای Worker: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
    exit(0);
}
exit(0);

/* ================= ابزارهای Worker ================= */

function karamBotLog(string $msg): void
{
    error_log('[karam][bot-worker] ' . $msg);
}

/** @return array<string,mixed> */
function karamReadJson(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $decoded = json_decode((string) @file_get_contents($path), true);
    return is_array($decoded) ? $decoded : [];
}

function karamWriteJson(string $path, array $data): void
{
    @file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function karamStatePath(): string
{
    return dirname(__DIR__) . '/storage/cache/telegram-updates.json';
}

function karamStatusPath(): string
{
    return dirname(__DIR__) . '/storage/cache/telegram-worker.json';
}

/** اگر توکن ربات نسبت به آخرین اجرا عوض شده باشد، آفست و صف باید صفر شود */
function karamResetOffsetIfTokenChanged(): void
{
    $stateFile = karamStatePath();
    $dir = dirname($stateFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    // همان قفلِ فایل state که pollAndMatchTickets استفاده می‌کند — بدون رقابت
    $lock = @fopen($stateFile . '.lock', 'c');
    if ($lock === false) {
        return;
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        return;
    }
    try {
        $state = karamReadJson($stateFile);
        $hash = md5(TelegramBot::token());
        if (($state['tokenHash'] ?? '') !== $hash) {
            $state['offset'] = 0;
            $state['fetchedAt'] = 0;
            $state['unprocessed'] = [];
            $state['tokenHash'] = $hash;
            karamWriteJson($stateFile, $state);
            karamBotLog('توکن ربات جدید است (یا اولین اجرا) — آفست صفر شد');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function karamWriteStatus(int $cycles, int $startedAt): void
{
    karamWriteJson(karamStatusPath(), [
        'lastRunStart' => gmdate('Y-m-d\TH:i:s\Z', $startedAt),
        'lastRunEnd' => gmdate('Y-m-d\TH:i:s\Z'),
        'lastRunCycles' => $cycles,
    ]);
}

/* ================= حالت وب — صفحه‌ی وضعیت و راه‌اندازی ================= */

/**
 * صفحه‌ی وضعیت فارسی: اعتبار توکن، وضعیت webhook، زنده‌بودن Worker و
 * دستور کرون آماده‌ی کپی (با مسیر واقعی همین فایل روی هاست).
 */
function karamTelegramCheckPage(): void
{
    header('Content-Type: text/html; charset=utf-8');

    $rows = []; // هر ردیف: [عنوان, وضعیت ok|warn|err, متن]

    /* --- توکن ربات --- */
    $botUsername = '';
    $tokenOk = false;
    if (!TelegramBot::configured()) {
        $rows[] = ['توکن ربات', 'err', 'ذخیره نشده است. اول از پنل ← تنظیمات ← پروایدر تلگرام، توکن @BotFather را ذخیره کنید.'];
    } else {
        try {
            $me = TelegramBot::getMe();
            if ($me['ok']) {
                $tokenOk = true;
                $botUsername = (string) $me['username'];
                $rows[] = ['توکن ربات', 'ok', 'معتبر است — ربات: @' . htmlspecialchars($botUsername, ENT_QUOTES, 'UTF-8')];

                // هم‌گام‌سازی نام کاربری ربات در تنظیمات (لینک t.me اپ از همین ساخته می‌شود)
                try {
                    $saved = ltrim((string) TelegramBot::botUsername(), '@');
                    if ($botUsername !== '' && $saved !== $botUsername) {
                        $now = gmdate('Y-m-d H:i:s');
                        Database::pdo()->prepare(
                            'INSERT INTO settings (`key`, `value`, `updated_at`)
                             VALUES (:k, :v, :now)
                             ON DUPLICATE KEY UPDATE `value` = :v2, `updated_at` = :now2'
                        )->execute([
                            ':k' => 'telegram_bot_username',
                            ':v' => $botUsername,
                            ':now' => $now,
                            ':v2' => $botUsername,
                            ':now2' => $now,
                        ]);
                        $rows[] = ['نام کاربری ربات', 'ok', 'در تنظیمات با مقدار درست (@' . htmlspecialchars($botUsername, ENT_QUOTES, 'UTF-8') . ') هم‌گام شد.'];
                    }
                } catch (Throwable $e) {
                    $rows[] = ['نام کاربری ربات', 'warn', 'هم‌گام‌سازی خودکار ناموفق بود: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')];
                }
            } else {
                $rows[] = ['توکن ربات', 'err', 'ربات API این توکن را نمی‌پذیرد: ' . htmlspecialchars((string) $me['error'], ENT_QUOTES, 'UTF-8')];
            }
        } catch (Throwable $e) {
            $rows[] = ['توکن ربات', 'err', 'خطا در بررسی توکن: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')];
        }
    }

    /* --- وضعیت webhook --- */
    if ($tokenOk) {
        try {
            $wh = TelegramBot::getWebhookInfo();
            if (($wh['ok'] ?? false) === true) {
                $url = (string) ($wh['url'] ?? '');
                if ($url !== '') {
                    $err = (string) ($wh['lastErrorMessage'] ?? '');
                    $rows[] = ['webhook قبلی', 'warn', 'روی این توکن webhook ثبت شده بود' . ($err !== '' ? ' (آخرین خطا: ' . htmlspecialchars($err, ENT_QUOTES, 'UTF-8') . ')' : '') . ' — الان پاک می‌شود…'];
                } else {
                    $rows[] = ['webhook', 'ok', 'ثبت نشده است — درست است؛ کارام با getUpdates کار می‌کند.'];
                }
            } else {
                $rows[] = ['webhook', 'warn', 'دریافت وضعیت ناموفق بود — مهم نیست، ادامه می‌دهیم.'];
            }
            // همیشه پاک می‌کنیم: اگر ثبت باشد حذف می‌شود، اگر نباشد بی‌ضرر است
            TelegramBot::clearWebhook();
        } catch (Throwable $e) {
            $rows[] = ['webhook', 'warn', 'خطا در پاک‌سازی webhook: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')];
        }
    }

    /* --- Worker کرون --- */
    $worker = karamReadJson(karamStatusPath());
    $lastEnd = (string) ($worker['lastRunEnd'] ?? '');
    if ($lastEnd === '') {
        $rows[] = ['Worker کرون', 'warn', 'هنوز هیچ اجرایی ثبت نشده — یعنی Cron Job هنوز نصب نشده یا هنوز اجرا نشده. دستور زیر را در DirectAdmin ثبت کنید.'];
    } else {
        $age = time() - (strtotime($lastEnd) ?: 0);
        if ($age >= 0 && $age < 180) {
            $cycles = (int) ($worker['lastRunCycles'] ?? 0);
            $rows[] = ['Worker کرون', 'ok', 'زنده است — آخرین پایان: ' . htmlspecialchars($lastEnd, ENT_QUOTES, 'UTF-8') . ' UTC (' . (int) $age . ' ثانیه پیش، ' . $cycles . ' چرخه)'];
        } else {
            $rows[] = ['Worker کرون', 'err', 'آخرین اجرا ' . (int) round($age / 60) . ' دقیقه پیش بوده — Cron Job در DirectAdmin ثبت نشده یا مسیر/دستور اشتباه است.'];
        }
    }

    /* --- وضعیت خواندن پیام‌ها (آفست) --- */
    $state = karamReadJson(karamStatePath());
    $fetchedAt = (int) ($state['fetchedAt'] ?? 0);
    $rows[] = ['خواندن پیام‌ها', 'ok', 'آفست فعلی: ' . (int) ($state['offset'] ?? 0) . ' — آخرین خواندن: ' . ($fetchedAt > 0 ? htmlspecialchars(gmdate('Y-m-d H:i:s', $fetchedAt), ENT_QUOTES, 'UTF-8') . ' UTC' : '—') . ' — صف: ' . count(is_array($state['unprocessed'] ?? null) ? $state['unprocessed'] : []) . ' پیام'];

    /* --- بلیت‌های در انتظار اتصال --- */
    try {
        $pending = count(Otp::pendingTickets(Database::pdo()));
        $rows[] = ['بلیت‌های در انتظار', 'ok', $pending === 0 ? 'هیچ بلیت فعالی نیست (طبیعی است اگر کسی در حال ورود نباشد).' : $pending . ' بلیت فعال — اگر کاربر روی لینک زده باشد، Worker تا حداکثر یک دقیقه بعد کد را می‌فرستد.'];
    } catch (Throwable $e) {
        $rows[] = ['بلیت‌های در انتظار', 'warn', 'خطای دیتابیس: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')];
    }

    /* --- دستور کرون آماده‌ی کپی --- */
    $selfPath = __DIR__ . '/telegram-poll.php';
    $phpBin = (string) PHP_BINARY;
    if ($phpBin === '') {
        $phpBin = '/usr/local/bin/php';
    }
    $cronCommand = $phpBin . ' ' . $selfPath;

    /* --- رندر --- */
    $cards = '';
    foreach ($rows as [$title, $rowState, $text]) {
        $color = $rowState === 'ok' ? '#22c55e' : ($rowState === 'warn' ? '#f59e0b' : '#ef4444');
        $badge = $rowState === 'ok' ? '✓' : ($rowState === 'warn' ? '!' : '×');
        $cards .= '<div class="card"><span class="badge" style="background:' . $color . '">' . $badge . '</span>'
            . '<div><div class="t">' . htmlspecialchars((string) $title, ENT_QUOTES, 'UTF-8') . '</div>'
            . '<div class="x">' . (string) $text . '</div></div></div>';
    }

    echo '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow">'
        . '<title>کارام — وضعیت ربات تلگرام</title><style>'
        . 'body{background:#0c0f0e;color:#e6e8e7;font-family:Tahoma,"Segoe UI",sans-serif;margin:0;padding:24px 14px 60px}'
        . '.wrap{max-width:680px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:#8ba39a;font-size:13px;margin-bottom:20px}'
        . '.card{display:flex;gap:10px;align-items:flex-start;background:#151a18;border:1px solid #24302b;border-radius:12px;padding:12px 14px;margin-bottom:10px}'
        . '.badge{flex:0 0 22px;height:22px;border-radius:50%;color:#0c0f0e;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:13px;margin-top:2px}'
        . '.t{font-weight:700;font-size:14px;margin-bottom:2px}.x{font-size:13px;color:#c4ccc9;line-height:1.9;word-break:break-word}'
        . '.cron{background:#101614;border:1px dashed #2e5c4f;border-radius:12px;padding:14px;margin:18px 0}'
        . '.cron .t{color:#7ee2b8;font-weight:700;margin-bottom:6px}'
        . 'code.hl{display:block;direction:ltr;text-align:left;background:#0a0d0c;border:1px solid #24302b;border-radius:8px;padding:10px;font-family:monospace;font-size:12px;color:#9fe8c4;margin-top:8px;white-space:pre-wrap;word-break:break-all}'
        . '.hint{font-size:12px;color:#8ba39a;line-height:2;margin-top:8px}'
        . '</style></head><body><div class="wrap">'
        . '<h1>وضعیت ربات تلگرام کارام 🌿</h1>'
        . '<div class="sub">صفحه‌ی راه‌اندازی Worker کرون — بدون webhook، با getUpdates</div>'
        . $cards
        . '<div class="cron"><div class="t">دستور Cron Job (آماده‌ی کپی)</div>'
        . '<code class="hl">' . htmlspecialchars($cronCommand, ENT_QUOTES, 'UTF-8') . '</code>'
        . '<div class="hint">در DirectAdmin: <b>Cron Jobs ← Add New Cron Job</b> — فاصله‌ی اجرا: هر ۱ دقیقه (Minutes = <span dir="ltr">*</span> و بقیه هم <span dir="ltr">*</span>) و همین دستور در Command.<br>'
        . 'اگر با مسیر PHP اول خطا داد، به‌جایش از <span dir="ltr">/usr/local/bin/php</span> استفاده کنید.<br>'
        . 'دو دقیقه بعد از ثبت کرون، این صفحه را رفرش کنید — بخش «Worker کرون» باید سبز شود.</div></div>'
        . '<div class="cron"><div class="t" style="color:#f59e0b">بعد از راه‌اندازی (اختیاری — امن‌تر)</div>'
        . '<div class="hint">برای بستن دسترسی وب این فایل، فایل <span dir="ltr">.htaccess</span> زیر را داخل پوشه‌ی <span dir="ltr">api/cron</span> بسازید (اجرای کرون از CLI بی‌تأثیر می‌ماند):</div>'
        . '<code class="hl">Require all denied</code></div>'
        . '<div class="hint" style="margin-top:16px">کارام — صفحه‌ی وضعیت فاز ۷ · این آدرس فقط برای راه‌اندازی خودتان است.</div>'
        . '</div></body></html>';
}

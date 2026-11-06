<?php

declare(strict_types=1);

/**
 * کارام — تست موج ۱ «چندروش ورود» (رفع ریشه‌ی کد تلگرام + حذف حساب روی کانال نشست)
 *
 * پوشش:
 *   ۱) سلامت سرویس
 *   ۲) شکست گذرای sendMessage (HTTP 500) → وضعیت poll = send_failed + بلیت زنده + attempts=۱
 *      + دقیقاً یک retry کوتاه (فراخوانی دوم sendMessage) + هیچ پیامی «ارسال‌شده» ثبت نشود
 *      + کدِ نرسیده باطل شود (بدون کد زنده‌ی یتیم)
 *   ۳) تلاش مجدد کاربر (پیام /start تازه) → code_sent + فقط «یک کد زنده» به‌ازای بلیت
 *   ۴) سقف نرخ به‌ازای chat_id — فاصله‌ی حداقلی: اتصالِ بلافاصله بعد از کد قبلی رد می‌شود
 *   ۵) شمار ردیف‌ها بعد از بخش ۳ و ۴ (بدون ردیف اضافه)
 *   ۶) تلاش مجدد Worker بدون پیام جدید → هیچ کد و پیام جدیدی ساخته نمی‌شود (idempotent)
 *   ۷) کدِ رسیده واقعاً برای ورود کار می‌کند (verify → توکن)
 *   ۸) سقف نرخ به‌ازای chat_id — سقف ساعتی: کد یازدهم ساخته نمی‌شود
 *   ۹) سقف تلاش‌های ارسال هر بلیت (۳): بعد از سقف حتی با رفع خطا کد جدید ساخته نمی‌شود
 *   ۱۰) حذف حساب با دو هویت: channel=telegram → کد به چت تلگرام می‌رود؛ شکست ارسال →
 *       خطای روشن 502 send_failed و کدِ نرسیده باطل؛ بدون channel → هویت اصلی (رفتار قدیم)؛
 *       تأیید حذف با channel=telegram و کدِ رسیده → حذف کامل
 *   ۱۱) سازگاری کلاینت قدیمی: شکل پاسخ poll ثابت می‌ماند (ok/status/botUsername) و مقدار
 *       ناشناس send_failed برای کلاینت قدیمی فقط «منتظر ماندن تا expired» است (بدون کرش)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php  → سرور ساختگی تلگرام (با failMode موج ۱)
 *
 * اجرا:  php tests/multi-login-wave1-test.php
 * (DB محلی و لاگ‌ها هر بار از نو ساخته می‌شوند)
 */

const BASE = 'http://127.0.0.1:8099';
const ROOT = __DIR__ . '/..';
const MOCK_STATE = __DIR__ . '/telegram-mock-state.json';
const SERVER_STATE = ROOT . '/backend/storage/cache/telegram-updates.json';

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
function http(string $method, string $path, ?array $body = null, ?string $token = null): array
{
    $ch = curl_init(BASE . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
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
    $json = $resp === false ? null : json_decode((string) $resp, true);
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

function db(): PDO
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
    return new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}

function resetEnvironment(): void
{
    $dbPath = envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
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
    foreach ([
        ROOT . '/backend/storage/logs/mail.log',
        SERVER_STATE,
        MOCK_STATE,
    ] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    foreach (glob(ROOT . '/backend/storage/cache/k_*.json') ?: [] as $f) {
        @unlink($f);
    }
}

/* ---------------- helpers مک تلگرام ---------------- */

/** خواندن state سرور ساختگی تلگرام */
function mockState(): array
{
    $s = json_decode((string) @file_get_contents(MOCK_STATE), true);
    $s = is_array($s) ? $s : [];
    return $s + ['updates' => [], 'sent' => [], 'calls' => [], 'failMode' => []];
}

function mockSave(array $s): void
{
    file_put_contents(MOCK_STATE, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/** موج ۱ — ست/برداشتن حالت خطای ساختگی sendMessage (null = ارسال سالم) */
function setMockFailMode(?array $fail): void
{
    $s = mockState();
    if ($fail === null) {
        unset($s['failMode']['sendMessage']);
    } else {
        $s['failMode']['sendMessage'] = $fail;
    }
    mockSave($s);
}

/** افزودن پیام /start TICKET از یک چت (مثل زدن دوباره‌ی لینک deep link توسط کاربر) */
function mockAddStartUpdate(string $ticket, int $chatId): void
{
    $s = mockState();
    $s['updates'][] = [
        'update_id' => count($s['updates']) + 1,
        'message' => [
            'message_id' => count($s['updates']) + 1,
            'chat' => ['id' => $chatId],
            'text' => '/start ' . $ticket,
        ],
    ];
    mockSave($s);
}

function mockSentCount(): int
{
    return count(mockState()['sent']);
}

function mockSendMessageCalls(): int
{
    return (int) (mockState()['calls']['sendMessage'] ?? 0);
}

/** استخراج کد از متن پیام ثبت‌شده‌ی مک (بلوک <code> برای کد ورود، رقم خام برای کد حذف) */
function mockExtractCode(int $sentIndex): ?string
{
    $sent = mockState()['sent'];
    if (!isset($sent[$sentIndex]['text'])) {
        return null;
    }
    if (preg_match('#<code>(\d{4,8})</code>#u', (string) $sent[$sentIndex]['text'], $m) === 1) {
        return $m[1];
    }
    return preg_match('#(\d{6})#u', (string) $sent[$sentIndex]['text'], $m2) === 1 ? $m2[1] : null;
}

/**
 * کش ۲ ثانیه‌ای خواندن getUpdates داخل pollAndMatchTickets را می‌شکند تا poll بعدی بلافاصله
 * پیام تازه‌ی تزریقی را ببیند — برای تست دقیق «فاصله‌ی حداقلی» لازم است (بدون آن، رد شدن
 * به‌خاطر دیده‌نشدن پیام است نه محدودیت نرخ و تست قلابی می‌شود).
 */
function forceFetch(): void
{
    $s = json_decode((string) @file_get_contents(SERVER_STATE), true);
    if (is_array($s)) {
        $s['fetchedAt'] = time() - 30;
        @file_put_contents(SERVER_STATE, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

/** poll با فاصله‌ی کافی از fetch قبلی (کش ۲ ثانیه‌ای داخل pollAndMatchTickets) */
function pollTicket(string $ticket): array
{
    usleep(2_200_000);
    return http('POST', '/api/auth/otp/telegram/poll', ['ticket' => $ticket]);
}

/** poll فوری — فقط با forceFetch() معنی‌دار است */
function pollTicketFast(string $ticket): array
{
    usleep(100_000);
    return http('POST', '/api/auth/otp/telegram/poll', ['ticket' => $ticket]);
}

/** درخواست بلیت تازه — خروجی: [ticket, expiresIn] (بلیت‌ها سقف فاصله ندارند؛ فقط سقف IP) */
function newTicket(): array
{
    [$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'telegram']);
    if ($st !== 200 || empty($j['ticket'])) {
        fwrite(STDERR, "درخواست بلیت ناموفق بود: {$st}\n");
        exit(1);
    }
    return [(string) $j['ticket'], (int) ($j['expiresIn'] ?? 0)];
}

/** شمار ردیف‌های کد تلگرام برای یک chat (زنده/مجموع) */
function chatCodeRows(int $chatId, bool $onlyLive): int
{
    $st = db()->prepare(
        "SELECT COUNT(*) FROM otp_requests
         WHERE identity_type = 'telegram' AND identity_value = :c AND purpose = 'login'"
        . ($onlyLive ? ' AND consumed_at IS NULL' : '')
    );
    $st->execute([':c' => (string) $chatId]);
    return (int) $st->fetchColumn();
}

function ticketRow(string $ticket): ?array
{
    $st = db()->prepare(
        "SELECT id, attempts, consumed_at, expires_at FROM otp_requests
         WHERE identity_type = 'telegram' AND identity_value = :v AND purpose = 'login'
         ORDER BY id DESC LIMIT 1"
    );
    $st->execute([':v' => $ticket]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

function unconsumedDeleteCodes(int $chatId): int
{
    $st = db()->prepare(
        "SELECT COUNT(*) FROM otp_requests
         WHERE identity_type = 'telegram' AND identity_value = :c AND purpose = 'account_delete' AND consumed_at IS NULL"
    );
    $st->execute([':c' => (string) $chatId]);
    return (int) $st->fetchColumn();
}

function requestEmailCode(string $email): string
{
    usleep(1_100_000);
    [$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $email]);
    if ($st !== 200 || !isset($j['devCode'])) {
        fwrite(STDERR, "درخواست کد ایمیل ناموفق بود: {$st}\n");
        exit(1);
    }
    return (string) $j['devCode'];
}

/* ================= setup ================= */
resetEnvironment();
echo "— آماده‌سازی: دیتابیس نو + مک تلگرام و کش پاک شد\n\n";

/* ================= ۱) سلامت ================= */
echo "۱) سلامت سرویس\n";
[$st, $j] = http('GET', '/api/health');
check('health → 200 و ok', $st === 200 && ($j['ok'] ?? false) === true);

/* ================= ۲) شکست گذرا → send_failed ================= */
echo "\n۲) شکست گذرای sendMessage (HTTP 500) → send_failed و بلیت زنده\n";
setMockFailMode(['status' => 500, 'description' => 'Internal Server Error (mock)']);
[$t1, $exp1] = newTicket();
[$t2] = newTicket(); // بلیت دوم از همین ابتدا — برای تست فاصله‌ی حداقلی در بخش ۴ (بدون هدررفتن زمان بین دو کد)
check('درخواست بلیت → expiresIn=600 (TTL ده‌دقیقه‌ای)', $exp1 === 600, (string) $exp1);
mockAddStartUpdate($t1, 777001);
[$st, $j] = pollTicket($t1);
check('poll → status=send_failed', $st === 200 && ($j['status'] ?? '') === 'send_failed', (string) json_encode($j, JSON_UNESCAPED_UNICODE));

$row = ticketRow($t1);
check('بلیت زنده ماند (consumed_at خالی)', $row !== null && $row['consumed_at'] === null);
check('attempts بلیت = ۱', $row !== null && (int) $row['attempts'] === 1, (string) ($row['attempts'] ?? 'null'));
check('هیچ پیامی ثبت نشد (ارسال واقعی شکست خورد)', mockSentCount() === 0, (string) mockSentCount());
check('دقیقاً یک retry کوتاه: فراخوانی sendMessage = ۲', mockSendMessageCalls() === 2, (string) mockSendMessageCalls());
check('کدِ نرسیده باطل شد (بدون کد زنده‌ی یتیم)', chatCodeRows(777001, true) === 0, (string) chatCodeRows(777001, true));

/* ================= ۳) تلاش مجدد کاربر → code_sent ================= */
echo "\n۳) تلاش مجدد کاربر (پیام /start تازه) → code_sent و یک کد زنده\n";
setMockFailMode(null);
mockAddStartUpdate($t1, 777001);
[$st, $j] = pollTicket($t1);
check('poll → status=code_sent', $st === 200 && ($j['status'] ?? '') === 'code_sent', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
$row = ticketRow($t1);
check('بلیت بعد از ارسال موفق مصرف شد', $row !== null && $row['consumed_at'] !== null);
$code1 = mockExtractCode(0);
check('کد ورود از متن پیام استخراج شد', $code1 !== null && strlen((string) $code1) === 6);

/* ================= ۴) سقف نرخ chat — فاصله‌ی حداقلی =================
   بلافاصله بعد از کدِ بخش ۳ (زیر یک ثانیه — همان دو چک بالا + poll فوری): اگر نرخ‌سنج
   فاصله‌ی حداقلی درست کار کند، کد جدیدی ساخته نمی‌شود و بلیت دوم pending می‌ماند. */
echo "\n۴) سقف نرخ به‌ازای chat_id — فاصله‌ی حداقلی (بلافاصله بعد از کد قبلی)\n";
mockAddStartUpdate($t2, 777001);
forceFetch(); // کش ۲ ثانیه‌ای را بشکن تا poll واقعاً پیام تازه را ببیند و نرخ‌سنج رد کند
[$st, $j] = pollTicketFast($t2);
check('اتصال فوری به‌خاطر نرخ‌سنج رد شد → status=pending', $st === 200 && ($j['status'] ?? '') === 'pending', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('بلیت دوم مصرف نشد', (ticketRow($t2)['consumed_at'] ?? null) === null);
check('کد جدیدی برای chat ساخته نشد', chatCodeRows(777001, false) === 2, (string) chatCodeRows(777001, false));
check('پیام جدیدی ارسال نشد', mockSentCount() === 1, (string) mockSentCount());

/* ================= ۵) شمار ردیف‌ها بعد از بخش ۳ و ۴ ================= */
check('فقط یک کد زنده برای این chat', chatCodeRows(777001, true) === 1, (string) chatCodeRows(777001, true));
check('مجموع ردیف‌های کد = ۲ (اولی باطل، دومی زنده)', chatCodeRows(777001, false) === 2, (string) chatCodeRows(777001, false));
check('پیام رسیده ثبت شد', mockSentCount() === 1, (string) mockSentCount());

/* ================= ۶) Worker بدون پیام جدید → idempotent ================= */
echo "\n۶) تلاش مجدد Worker بدون پیام جدید → هیچ چیز تازه‌ای ساخته نمی‌شود\n";
$beforeCalls = mockSendMessageCalls();
[$st, $j] = pollTicket($t1);
check('poll بعدی → همان code_sent', $st === 200 && ($j['status'] ?? '') === 'code_sent');
check('هیچ پیام جدیدی ارسال نشد', mockSentCount() === 1, (string) mockSentCount());
check('هیچ فراخوانی sendMessage جدید نبود', mockSendMessageCalls() === $beforeCalls);
check('هیچ کد جدیدی ساخته نشد', chatCodeRows(777001, true) === 1, (string) chatCodeRows(777001, true));

/* ================= ۷) کد رسیده واقعاً برای ورود کار می‌کند ================= */
echo "\n۷) ورود با کدِ رسیده (verify) → توکن صادر شد\n";
[$st, $j] = http('POST', '/api/auth/otp/verify', [
    'channel' => 'telegram', 'ticket' => $t1, 'code' => $code1,
    'deviceUuid' => 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'deviceName' => 'تست موج ۱',
]);
check('verify تلگرام → 200 و accessToken', $st === 200 && !empty($j['accessToken']), (string) $st);
check('پاسخ ورود chat_id همان چت است', ($j['user']['telegramChatId'] ?? '') === '777001');

/* ================= ۸) سقف نرخ chat — سقف ساعتی ================= */
echo "\n۸) سقف نرخ به‌ازای chat_id — سقف ساعتی (۱۰ کد در ساعت)\n";
// chat 777001 الان ۲ ردیف کد دارد (۱ باطل + ۱ زنده) — ۸ موفق دیگر تا سقف ۱۰
for ($i = 0; $i < 8; $i++) {
    [$tk] = newTicket();
    mockAddStartUpdate($tk, 777001);
    [$st, $j] = pollTicket($tk); // فاصله‌ی هر کد ≈ ۲٫۲ ثانیه > فاصله‌ی حداقلی ۱ ثانیه‌ای تست
    if (($j['status'] ?? '') !== 'code_sent') {
        check('بلیت شماره ' . ($i + 3) . ' موفق بود (تا سقف)', false, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
        break;
    }
}
check('سقف ساعتی: ۱۰ ردیف کد برای chat', chatCodeRows(777001, false) === 10, (string) chatCodeRows(777001, false));
[$t9] = newTicket();
mockAddStartUpdate($t9, 777001);
[$st, $j] = pollTicket($t9);
check('کد یازدهم ساخته نشد → pending', $st === 200 && ($j['status'] ?? '') === 'pending');
check('بعد از سقف: هیچ ردیف و پیام جدیدی نبود', chatCodeRows(777001, false) === 10 && mockSentCount() === 9, chatCodeRows(777001, false) . '/' . mockSentCount());

/* ================= ۹) سقف تلاش‌های ارسال هر بلیت ================= */
echo "\n۹) سقف تلاش ارسال بلیت (۳) — با خطای گذرای ۵۰۰\n";
setMockFailMode(['status' => 500, 'description' => 'Internal Server Error (mock)']);
[$t3] = newTicket();
$chat3 = 777009;
for ($i = 1; $i <= 3; $i++) {
    mockAddStartUpdate($t3, $chat3);
    [$st, $j] = pollTicket($t3); // فاصله‌ی هر تلاش ≈ ۲٫۲ ثانیه > فاصله‌ی حداقلی
    check("تلاش {$i} → send_failed", ($j['status'] ?? '') === 'send_failed', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
}
check('attempts بلیت = ۳', (int) (ticketRow($t3)['attempts'] ?? 0) === 3, (string) (ticketRow($t3)['attempts'] ?? 'null'));
check('۳ ردیف کد (همه باطل) برای chat سوم', chatCodeRows($chat3, false) === 3 && chatCodeRows($chat3, true) === 0, chatCodeRows($chat3, false) . '/' . chatCodeRows($chat3, true));
mockAddStartUpdate($t3, $chat3); // تلاش چهارم — باید با سقف رد شود
[$st, $j] = pollTicket($t3);
check('تلاش چهارم رد شد (سقف) → send_failed', ($j['status'] ?? '') === 'send_failed');
check('بعد از سقف: هنوز ۳ ردیف کد و هیچ پیامی', chatCodeRows($chat3, false) === 3 && mockSentCount() === 9, chatCodeRows($chat3, false) . '/' . mockSentCount());
setMockFailMode(null);
mockAddStartUpdate($t3, $chat3); // حتی با رفع خطا — سقف بلیت سر جای خودش است
[$st, $j] = pollTicket($t3);
check('رفع خطا هم بعد از سقف کد نمی‌سازد (تا پایان TTL)', ($j['status'] ?? '') === 'send_failed' && chatCodeRows($chat3, false) === 3);

/* ================= ۱۰) حذف حساب با دو هویت — کانال نشست ================= */
echo "\n۱۰) حذف حساب با دو هویت — کد به کانال نشست فعلی می‌رود\n";
$delEmail = 'delwave1@test.ir';
$delCode = requestEmailCode($delEmail);
[$st, $j] = http('POST', '/api/auth/otp/verify', [
    'channel' => 'email', 'target' => $delEmail, 'code' => $delCode,
    'deviceUuid' => 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', 'deviceName' => 'تست حذف موج ۱',
]);
check('ورود ایمیل → توکن', $st === 200 && !empty($j['accessToken']));
$tok = (string) $j['accessToken'];
$userUuid = (string) ($j['user']['uuid'] ?? '');
$stId = db()->prepare("SELECT id FROM users WHERE uuid = :u");
$stId->execute([':u' => $userUuid]);
$uid = (int) $stId->fetchColumn();
check('کاربر یافت شد', $uid > 0);
// هویت دوم (تلگرام) به همین حساب اضافه می‌شود — مثل حساب دوروشی؛ کد حذف باید به کانالِ انتخابی برود
db()->prepare(
    "INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at)
     VALUES (:uid, 'telegram_chat_id', '888001', 0, :now, :now)"
)->execute([':uid' => $uid, ':now' => gmdate('Y-m-d H:i:s')]);

[$st, $j] = http('POST', '/api/v1/me/delete-request', ['channel' => 'telegram'], $tok);
check('delete-request با channel=telegram → 200 و کانال تلگرام', $st === 200 && ($j['channel'] ?? '') === 'telegram_chat_id', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('هدف ماسک شده (بدون chat_id کامل)', ($j['target'] ?? '') === '••••8001', (string) ($j['target'] ?? ''));
check('کد حذف به چت تلگرام 888001 رفت', mockSentCount() === 10 && (string) mockState()['sent'][9]['chat_id'] === '888001', (string) mockSentCount());
$delCodeTg = mockExtractCode(9);
check('کد حذف از پیام تلگرام استخراج شد', $delCodeTg !== null);

// شکست ارسال → خطای روشن + کد نرسیده باطل (بعد از فاصله‌ی حداقلی)
setMockFailMode(['status' => 403, 'description' => 'Forbidden: bot was blocked by the user']);
usleep(1_100_000);
[$st, $j] = http('POST', '/api/v1/me/delete-request', ['channel' => 'telegram'], $tok);
check('شکست ارسال تلگرام → 502 و code=send_failed', $st === 502 && ($j['code'] ?? '') === 'send_failed', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('پیام خطا نام کانال را دارد («تلگرام»)', str_contains((string) ($j['error'] ?? ''), 'تلگرام'));
check('کدِ نرسیده باطل شد — فقط کدِ رسیده زنده ماند', unconsumedDeleteCodes(888001) === 1, (string) unconsumedDeleteCodes(888001));

// کلاینت قدیمی: بدون channel → هویت اصلی (ایمیل)
setMockFailMode(null);
usleep(1_100_000);
[$st, $j] = http('POST', '/api/v1/me/delete-request', [], $tok);
check('بدون channel (کلاینت قدیمی) → هویت اصلی ایمیل', $st === 200 && ($j['channel'] ?? '') === 'email', (string) json_encode($j, JSON_UNESCAPED_UNICODE));

// تأیید حذف با کانال تلگرام و کدِ رسیده
[$st, $j] = http('POST', '/api/v1/me/delete', ['code' => $delCodeTg, 'confirmText' => 'حذف حساب', 'channel' => 'telegram'], $tok);
check('delete با channel=telegram و کد رسیده → حذف کامل', $st === 200 && ($j['deleted'] ?? false) === true, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
$status = (string) db()->query("SELECT status FROM users WHERE id = {$uid}")->fetchColumn();
check('وضعیت کاربر بعد از حذف = deleted', $status === 'deleted', $status);

/* ================= ۱۱) سازگاری کلاینت قدیمی ================= */
echo "\n۱۱) سازگاری کلاینت قدیمی با وضعیت ناشناس send_failed\n";
// بلیت تازه در وضعیت send_failed — شکل پاسخ باید همان سه کلید همیشگی باشد (بدون کلید/فیلد جدید)
setMockFailMode(['status' => 500, 'description' => 'Internal Server Error (mock)']);
[$t4] = newTicket();
mockAddStartUpdate($t4, 777011);
[$st, $j] = pollTicket($t4);
check('شکل پاسخ poll ثابت: ok/status/botUsername — بدون فیلد جدید', $st === 200 && array_keys((array) $j) === ['ok', 'status', 'botUsername'], (string) json_encode(array_keys((array) $j)));
check('status=send_failed فقط یک رشته‌ی ساده است (کلاینت قدیمی آن را نمی‌شناسد و poll را ادامه می‌دهد)', ($j['status'] ?? '') === 'send_failed');

/* ================= خلاصه ================= */
echo "\n———————————————\n";
echo "موج ۱ چندروش ورود: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

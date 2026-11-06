<?php

declare(strict_types=1);

/**
 * کارام — تست موج ۲ «چندروش ورود» — اتصال روش دوم (ایمیل/تلگرام) به یک حساب
 *
 * پوشش:
 *   ۱) سلامت سرویس + مهمان (بدون توکن) → ۴۰۱ برای هر دو endpoint جدید
 *   ۲) ساخت دو حساب A و B (هر دو با ورود ایمیل — devCode)
 *   ۳) درخواست کد اتصال ایمیل جدید به A → ۲۰۰، شکل ثابت پاسخ + هدف ماسک‌شده (بدون ایمیل کامل)
 *      + پاسخ درخواست برای «ایمیل ناموجود» و «ایمیلِ موجود روی حساب دیگر» دقیقاً هم‌شکل است (بدون نشت وجود حساب)
 *   ۴) confirm با کد اشتباه → ۴۰۰ invalid؛ با کد درست → linked + GET /v1/me: ردیف جدید با
 *      کلیدهای قدیمی عیناً (type/value/verifiedAt) + کلید افزودنی masked
 *   ۵) idempotent: کد تازه برای همان ایمیلِ متصل → already=true (بدون ردیف تکراری)
 *   ۶) تعارض حساب دیگر: کد اشتباه → فقط ۴۰۰ invalid (بدون افشا)؛ کد درست → ۴۰۹ conflict_identity
 *      با پیام ارجاع به پشتیبانی — یعنی ۴۰۹ فقط بعد از تأیید کد (قرارداد موج ۲)
 *   ۷) اتصال تلگرام به A: بلیت → /start مک → poll code_sent → کد از مک → confirm → linked؛
 *      GET /v1/me هر دو روش + ماسک چت (بدون chat_id کامل در ماسک)
 *   ۸) تعارض تلگرام: B همان چت را اتصال می‌خواهد → کد درست → ۴۰۹ conflict_identity؛
 *      confirm با بلیت pending (بدون /start) → ۴۰۹ ticket_not_linked (مثل ورود تلگرام)
 *   ۹) بدون unlink: هیچ endpoint حذف روشی وجود ندارد (مسیر DELETE → ۴۰۴)
 *
 * پیش‌نیاز اجرا:
 *   php -S 127.0.0.1:8099 -t backend/public        → API
 *   php -S 127.0.0.1:8098 tests/telegram-mock.php  → سرور ساختگی تلگرام
 *
 * اجرا:  php tests/multi-login-wave2-test.php
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

/* ---------------- helpers مک تلگرام (همان الگوی موج ۱) ---------------- */

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

/** استخراج کد ورود (بلوک <code>) از پیام ثبت‌شده‌ی مک */
function mockExtractCode(int $sentIndex): ?string
{
    $sent = mockState()['sent'];
    if (!isset($sent[$sentIndex]['text'])) {
        return null;
    }
    return preg_match('#<code>(\d{4,8})</code>#u', (string) $sent[$sentIndex]['text'], $m) === 1 ? $m[1] : null;
}

function forceFetch(): void
{
    $s = json_decode((string) @file_get_contents(SERVER_STATE), true);
    if (is_array($s)) {
        $s['fetchedAt'] = time() - 30;
        @file_put_contents(SERVER_STATE, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

function pollTicket(string $ticket): array
{
    usleep(2_200_000);
    return http('POST', '/api/auth/otp/telegram/poll', ['ticket' => $ticket]);
}

/** ورود ایمیلی کامل → توکن (با devCode در محیط توسعه‌ی تست) */
function loginEmail(string $email, string $deviceUuid): string
{
    usleep(1_100_000); // فاصله‌ی حداقلی ارسال مجدد (env تست: OTP_RESEND_AFTER=1)
    [$st, $j] = http('POST', '/api/auth/otp/request', ['channel' => 'email', 'target' => $email]);
    if ($st !== 200 || !isset($j['devCode'])) {
        fwrite(STDERR, "درخواست کد ورود ناموفق بود: {$st}\n");
        exit(1);
    }
    [$st, $j] = http('POST', '/api/auth/otp/verify', [
        'channel' => 'email', 'target' => $email, 'code' => (string) $j['devCode'],
        'deviceUuid' => $deviceUuid, 'deviceName' => 'تست موج ۲',
    ]);
    if ($st !== 200 || empty($j['accessToken'])) {
        fwrite(STDERR, "ورود ایمیلی ناموفق بود: {$st}\n");
        exit(1);
    }
    return (string) $j['accessToken'];
}

/** درخواست کد اتصال ایمیل (با فاصله‌ی حداقلی) */
function requestLink(string $token, string $email): array
{
    usleep(1_100_000);
    return http('POST', '/api/v1/me/identities', ['channel' => 'email', 'target' => $email], $token);
}

/* ================= setup ================= */
resetEnvironment();
echo "— آماده‌سازی: دیتابیس نو + مک تلگرام و کش پاک شد\n\n";

/* ================= ۱) سلامت + مهمان ================= */
echo "۱) سلامت سرویس + مهمان\n";
[$st, $j] = http('GET', '/api/health');
check('health → 200 و ok', $st === 200 && ($j['ok'] ?? false) === true);
[$st, $j] = http('POST', '/api/v1/me/identities', ['channel' => 'email', 'target' => 'guest@test.ir']);
check('مهمان: درخواست کد اتصال → ۴۰۱', $st === 401 && ($j['code'] ?? '') === 'unauthorized', (string) $st);
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => 'guest@test.ir', 'code' => '123456']);
check('مهمان: confirm → ۴۰۱', $st === 401 && ($j['code'] ?? '') === 'unauthorized', (string) $st);

/* ================= ۲) دو حساب A و B ================= */
echo "\n۲) دو حساب با ورود ایمیلی\n";
$emailA = 'wave2a@test.ir';
$emailB = 'wave2b@test.ir';
$tokA = loginEmail($emailA, 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f');
$tokB = loginEmail($emailB, 'd2e3f4a5-b6c7-4d8e-9fa0-1b2c3d4e5f6a');
check('توکن A صادر شد', strlen($tokA) > 20);
check('توکن B صادر شد', strlen($tokB) > 20);
[$st, $j] = http('GET', '/api/v1/me', null, $tokA);
$idsA = $j['identities'] ?? [];
check('A فعلاً تک‌روش است (فقط ایمیل)', count($idsA) === 1 && $idsA[0]['type'] === 'email', (string) json_encode($idsA, JSON_UNESCAPED_UNICODE));
check('ردیف identities کلید افزودنی masked دارد', ($idsA[0]['masked'] ?? '') !== '', (string) json_encode($idsA[0], JSON_UNESCAPED_UNICODE));

/* ================= ۳) درخواست کد اتصال — شکل ثابت بدون نشت ================= */
echo "\n۳) درخواست کد اتصال ایمیل جدید به A — پاسخ ثابت + ماسک\n";
$newEmail = 'wave2c@test.ir';
[$st, $j] = requestLink($tokA, $newEmail);
check('درخواست اتصال ایمیل → 200', $st === 200 && ($j['ok'] ?? false) === true, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('هدف پاسخ ماسک‌شده است (بدون ایمیل کامل)', ($j['target'] ?? '') === 'wa…@test.ir', (string) ($j['target'] ?? ''));
check('کد توسعه در پاسخ است (devCode)', isset($j['devCode']) && strlen((string) $j['devCode']) === 6);
$keysNew = array_keys($j);
sort($keysNew);

// همان درخواست برای ایمیلِ موجود روی حساب B — پاسخ باید دقیقاً هم‌شکل باشد (بدون نشت وجود حساب)
[$st2, $j2] = requestLink($tokA, $emailB);
check('درخواست برای ایمیلِ موجود روی حساب دیگر هم → 200', $st2 === 200 && ($j2['ok'] ?? false) === true, (string) json_encode($j2, JSON_UNESCAPED_UNICODE));
$keysExisting = array_keys($j2);
sort($keysExisting);
check('شکل پاسخ برای ایمیل ناموجود و موجود دقیقاً یکسان است', $keysNew === $keysExisting, json_encode([$keysNew, $keysExisting]));
check('هر دو پاسخ devCode دارند (رفتار یکسان)', isset($j['devCode'], $j2['devCode']));
$codeC = (string) $j['devCode'];

/* ================= ۴) confirm — کد اشتباه و درست ================= */
echo "\n۴) تأیید اتصال — کد اشتباه → ۴۰۰؛ کد درست → linked\n";
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => $newEmail, 'code' => '000000'], $tokA);
check('کد اشتباه → ۴۰۰ invalid (نه ۴۰۹)', $st === 400 && ($j['code'] ?? '') === 'invalid', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => $newEmail, 'code' => $codeC], $tokA);
check('کد درست → linked=true', $st === 200 && ($j['linked'] ?? false) === true, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('پیام پاسخ already ندارد (اتصال تازه)', !isset($j['already']));
[$st, $j] = http('GET', '/api/v1/me', null, $tokA);
$row = null;
foreach (($j['identities'] ?? []) as $r) {
    if (($r['type'] ?? '') === 'email' && ($r['value'] ?? '') === $newEmail) {
        $row = $r;
    }
}
check('ردیف جدید در GET /v1/me هست', $row !== null, (string) json_encode($j['identities'] ?? [], JSON_UNESCAPED_UNICODE));
check('کلیدهای ردیف دقیقاً type/value/verifiedAt/masked (قدیمی‌ها عیناً + افزودنی)', $row !== null && array_keys($row) === ['type', 'value', 'verifiedAt', 'masked'], (string) json_encode(array_keys((array) $row)));
check('verifiedAt ست شده (تأیید اتصال)', $row !== null && ($row['verifiedAt'] ?? null) !== null);
check('masked ردیف ماسک است نه ایمیل کامل', $row !== null && ($row['masked'] ?? '') === 'wa…@test.ir', (string) ($row['masked'] ?? ''));

/* ================= ۵) idempotent ================= */
echo "\n۵) اتصال دوباره‌ی همان روش خودم → already=true و بدون ردیف تکراری\n";
[$st, $j] = requestLink($tokA, $newEmail);
$codeAgain = (string) ($j['devCode'] ?? '');
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => $newEmail, 'code' => $codeAgain], $tokA);
check('confirm تکراری → 200 و already=true', $st === 200 && ($j['already'] ?? false) === true, (string) json_encode($j, JSON_UNESCAPED_UNICODE));
$cnt = db()->prepare("SELECT COUNT(*) FROM user_identities WHERE type='email' AND value=:v");
$cnt->execute([':v' => $newEmail]);
check('فقط یک ردیف برای این هویت (یونیک)', (int) $cnt->fetchColumn() === 1);

/* ================= ۶) تعارض حساب دیگر — ۴۰۹ فقط بعد از کد درست ================= */
echo "\n۶) هویتِ متعلق به حساب دیگر — کد اشتباه ۴۰۰، کد درست ۴۰۹\n";
[$st, $j] = requestLink($tokB, $newEmail); // ایمیلی که حالا مالِ A است
$codeConflict = (string) ($j['devCode'] ?? '');
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => $newEmail, 'code' => '999999'], $tokB);
check('کد اشتباه روی هویتِ دیگران → ۴۰۰ invalid (بدون افشای مالکیت)', $st === 400 && ($j['code'] ?? '') === 'invalid', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'email', 'target' => $newEmail, 'code' => $codeConflict], $tokB);
check('کد درست روی هویتِ دیگران → ۴۰۹ conflict_identity', $st === 409 && ($j['code'] ?? '') === 'conflict_identity', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('پیام ۴۰۹ به پشتیبانی ارجاع می‌دهد', str_contains((string) ($j['error'] ?? ''), 'پشتیبانی'), (string) ($j['error'] ?? ''));
$cnt->execute([':v' => $newEmail]);
check('هویت همچنان مال A است (بدون ادغام، بدون جابه‌جایی)', (int) $cnt->fetchColumn() === 1);
// چک مالکیت واقعی: با توکن B، /v1/me نباید هویت مال A را نشان دهد
[$st, $j] = http('GET', '/api/v1/me', null, $tokB);
$foundInB = false;
foreach (($j['identities'] ?? []) as $r) {
    if (($r['value'] ?? '') === $newEmail) {
        $foundInB = true;
    }
}
check('هویت در فهرست identities حساب B نیست', $foundInB === false);

/* ================= ۷) اتصال تلگرام به A ================= */
echo "\n۷) اتصال تلگرام به حساب A — بلیت → /start → کد → confirm\n";
[$st, $j] = http('POST', '/api/v1/me/identities', ['channel' => 'telegram'], $tokA);
check('درخواست اتصال تلگرام → 200 و بلیت + deepLink', $st === 200 && !empty($j['ticket']) && !empty($j['deepLink']), (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('expiresIn بلیت = ۶۰۰ ثانیه', (int) ($j['expiresIn'] ?? 0) === 600, (string) ($j['expiresIn'] ?? ''));
$tgTicket = (string) $j['ticket'];
$chatTg = 999002;
mockAddStartUpdate($tgTicket, $chatTg);
[$st, $j] = pollTicket($tgTicket);
check('poll بلیت اتصال → code_sent', ($j['status'] ?? '') === 'code_sent', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
$tgCode = mockExtractCode(0);
check('کد اتصال از پیام مک استخراج شد', $tgCode !== null && strlen((string) $tgCode) === 6);
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'telegram', 'ticket' => $tgTicket, 'code' => $tgCode], $tokA);
check('confirm تلگرام → linked=true و type=telegram_chat_id', $st === 200 && ($j['identity']['type'] ?? '') === 'telegram_chat_id', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
check('masked چت در پاسخ confirm بدون رقم کامل', ($j['identity']['masked'] ?? '') === '••••9002', (string) json_encode($j['identity'] ?? [], JSON_UNESCAPED_UNICODE));
[$st, $j] = http('GET', '/api/v1/me', null, $tokA);
$types = [];
$tgRow = null;
foreach (($j['identities'] ?? []) as $r) {
    $types[] = $r['type'];
    if ($r['type'] === 'telegram_chat_id') {
        $tgRow = $r;
    }
}
check('حساب A حالا دوروش است (email + telegram_chat_id)', in_array('email', $types, true) && in_array('telegram_chat_id', $types, true), (string) json_encode($types));
check('ردیف تلگرام value کامل دارد (رفتار قدیمی) و masked افزودنی', $tgRow !== null && ($tgRow['value'] ?? '') === '999002' && ($tgRow['masked'] ?? '') === '••••9002', (string) json_encode($tgRow, JSON_UNESCAPED_UNICODE));

/* ================= ۸) تعارض تلگرام + بلیت pending ================= */
echo "\n۸) تعارض تلگرام برای حساب B + بلیت بدون /start\n";
[$st, $j] = http('POST', '/api/v1/me/identities', ['channel' => 'telegram'], $tokB);
$tgTicketB = (string) $j['ticket'];
mockAddStartUpdate($tgTicketB, $chatTg); // همان چتِ حساب A
[$st, $j] = pollTicket($tgTicketB);
check('poll بلیت B → code_sent (کد به همان چت رفت)', ($j['status'] ?? '') === 'code_sent', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
$tgCodeB = mockExtractCode(1);
check('کد دوم از پیام مک استخراج شد', $tgCodeB !== null);
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'telegram', 'ticket' => $tgTicketB, 'code' => $tgCodeB], $tokB);
check('confirm B روی چتِ A → ۴۰۹ conflict_identity', $st === 409 && ($j['code'] ?? '') === 'conflict_identity', (string) json_encode($j, JSON_UNESCAPED_UNICODE));
// بلیت pending (بدون /start) — مثل ورود تلگرام: ۴۰۹ ticket_not_linked
[$st, $j] = http('POST', '/api/v1/me/identities', ['channel' => 'telegram'], $tokB);
$tgTicketP = (string) $j['ticket'];
[$st, $j] = http('POST', '/api/v1/me/identities/confirm', ['channel' => 'telegram', 'ticket' => $tgTicketP, 'code' => '123456'], $tokB);
check('confirm با بلیت pending → ۴۰۹ ticket_not_linked', $st === 409 && ($j['code'] ?? '') === 'ticket_not_linked', (string) json_encode($j, JSON_UNESCAPED_UNICODE));

/* ================= ۹) بدون unlink ================= */
echo "\n۹) بدون unlink — هیچ مسیر حذف روشی وجود ندارد\n";
[$st, $j] = http('DELETE', '/api/v1/me/identities/' . $tgTicket, null, $tokA);
check('DELETE هویت → ۴۰۴ (مسیر تعریف نشده)', $st === 404, (string) $st);
[$st, $j] = http('DELETE', '/api/v1/me/identities', null, $tokA);
check('DELETE کل مسیر → ۴۰۴', $st === 404, (string) $st);

/* ================= خلاصه ================= */
echo "\n———————————————\n";
echo "موج ۲ چندروش ورود: {$pass} موفق / {$fail} ناموفق\n";
exit($fail === 0 ? 0 : 1);

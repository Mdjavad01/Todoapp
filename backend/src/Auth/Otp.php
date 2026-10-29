<?php

declare(strict_types=1);

/**
 * کارام — موتور کد یک‌بارمصرف (OTP) — فاز ۳
 *
 * امنیت:
 *  - کد ۶ رقمی با random_int (CSPRNG) ساخته می‌شود.
 *  - فقط هشِ کد (HMAC-SHA256 با APP_SECRET) در دیتابیس می‌نشیند.
 *  - محدودیت ارسال: فاصله‌ی حداقلی بین دو ارسال + سقف ساعتی برای هر هویت و هر IP.
 *  - سقف تلاش ناموفق؛ بعد از آن کد باطل می‌شود و باید کد جدید گرفت.
 *  - کد و بلیت تلگرام (ticket) هر دو در جدول otp_requests با purpose=login ذخیره می‌شوند.
 */

final class Otp
{
    /** طول کد */
    private const CODE_LEN = 6;

    /** الفبای بلیت تلگرام — بدون کاراکترهای گنگ (0/O و 1/I حذف شده‌اند) */
    private const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const PURPOSE_LOGIN = 'login';

    /** v1.9 — کد دومرحله‌ای حذف حساب؛ جدا از کد ورود (یکی برای دیگری قابل استفاده نیست) */
    public const PURPOSE_ACCOUNT_DELETE = 'account_delete';

    /* ---------------- تنظیمات قابل‌override با .env (برای تست سریع‌تر) ---------------- */

    public static function ttlMinutes(): int
    {
        return max(1, (int) (Config::get('OTP_TTL_MINUTES', '5') ?? 5));
    }

    public static function resendAfterSeconds(): int
    {
        return max(0, (int) (Config::get('OTP_RESEND_AFTER', '60') ?? 60));
    }

    public static function maxAttempts(): int
    {
        return max(1, (int) (Config::get('OTP_MAX_ATTEMPTS', '5') ?? 5));
    }

    public static function maxPerIdentityHour(): int
    {
        return max(1, (int) (Config::get('OTP_MAX_PER_HOUR', '5') ?? 5));
    }

    public static function maxPerIpHour(): int
    {
        return max(1, (int) (Config::get('OTP_MAX_PER_IP_HOUR', '20') ?? 20));
    }

    public static function ticketTtlMinutes(): int
    {
        return max(1, (int) (Config::get('OTP_TICKET_TTL_MINUTES', '10') ?? 10));
    }

    /**
     * گام ۱ — آیا محیط جاری production است؟
     * APP_ENV نامشخص/خالی = production (محتاطانه — fail-closed).
     */
    public static function isProduction(): bool
    {
        $env = strtolower(trim((string) (Config::get('APP_ENV', 'production') ?? 'production')));
        return $env === '' || $env === 'prod' || $env === 'production';
    }

    /**
     * حالت توسعه: کد در پاسخ API هم برگردانده می‌شود — فقط برای تست محلی!
     * گام ۱ — در محیط production هرگز (حتی اگر OTP_DEBUG=1 باشد)؛
     * این پیکربندی ناسازگار در /api/health و داشبورد پنل هشدار داده می‌شود.
     */
    public static function debugEcho(): bool
    {
        if (self::isProduction()) {
            return false;
        }
        return Config::get('OTP_DEBUG', '0') === '1';
    }

    /** گام ۱ — پیکربندی ناسازگار: OTP_DEBUG=1 روی production (برای هشدار) */
    public static function debugMisconfigured(): bool
    {
        return self::isProduction() && Config::get('OTP_DEBUG', '0') === '1';
    }

    /* ---------------- ساخت و هش ---------------- */

    /** کد عددی ۶ رقمی تصادفی امن */
    public static function generateCode(): string
    {
        $code = '';
        for ($i = 0; $i < self::CODE_LEN; $i++) {
            $code .= (string) random_int(0, 9);
        }
        return $code;
    }

    /** بلیت ۶ حرفی برای اتصال چت تلگرام به درخواست ورود */
    public static function generateTicket(): string
    {
        $n = strlen(self::TICKET_ALPHABET);
        $out = '';
        for ($i = 0; $i < 6; $i++) {
            $out .= self::TICKET_ALPHABET[random_int(0, $n - 1)];
        }
        return $out;
    }

    /** هش HMAC — مقدار ساده در دیتابیس هرگز ذخیره نمی‌شود */
    public static function hash(string $secretValue, string $type, string $value): string
    {
        $appSecret = (string) (Config::get('APP_SECRET', '') ?? '');
        if (strlen($appSecret) < 32) {
            throw new RuntimeException('APP_SECRET در .env تنظیم نشده است (حداقل ۳۲ کاراکتر)');
        }
        return hash_hmac('sha256', $type . '|' . strtolower($value) . '|' . $secretValue, $appSecret);
    }

    /** آیا مقدار، شکل یک بلیت معتبر را دارد؟ */
    public static function isTicketFormat(string $v): bool
    {
        return (bool) preg_match('/^[A-HJ-NP-Z2-9]{6}$/', $v);
    }

    /* ---------------- محدودسازی ارسال ---------------- */

    /**
     * بررسی محدودیت‌ها قبل از ساخت کد جدید.
     * @return array{ok:bool, retryAfter?:int, reason?:string}
     */
    public static function checkRateLimit(PDO $pdo, string $type, string $value, string $ip): array
    {
        $resend = self::resendAfterSeconds();
        $hourAgo = gmdate('Y-m-d H:i:s', time() - 3600);

        if ($resend > 0) {
            $stmt = $pdo->prepare(
                'SELECT created_at FROM otp_requests
                 WHERE identity_type = :t AND identity_value = :v
                 ORDER BY id DESC LIMIT 1'
            );
            $stmt->execute([':t' => $type, ':v' => $value]);
            $last = $stmt->fetchColumn();
            if ($last !== false) {
                $elapsed = time() - strtotime((string) $last);
                if ($elapsed < $resend) {
                    return [
                        'ok' => false,
                        'retryAfter' => $resend - $elapsed,
                        'reason' => 'کد جدید خیلی زود درخواست شد؛ لطفاً صبر کنید',
                    ];
                }
            }
        }

        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM otp_requests
             WHERE identity_type = :t AND identity_value = :v AND created_at > :since'
        );
        $stmt->execute([':t' => $type, ':v' => $value, ':since' => $hourAgo]);
        if ((int) $stmt->fetchColumn() >= self::maxPerIdentityHour()) {
            return [
                'ok' => false,
                'retryAfter' => 3600,
                'reason' => 'تعداد درخواست کد برای این حساب زیاد است؛ یک ساعت دیگر تلاش کنید',
            ];
        }

        if ($ip !== '') {
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM otp_requests WHERE ip = :ip AND created_at > :since'
            );
            $stmt->execute([':ip' => $ip, ':since' => $hourAgo]);
            if ((int) $stmt->fetchColumn() >= self::maxPerIpHour()) {
                return [
                    'ok' => false,
                    'retryAfter' => 3600,
                    'reason' => 'درخواست‌های زیادی از این شبکه انجام شده است؛ بعداً تلاش کنید',
                ];
            }
        }

        return ['ok' => true];
    }

    /* ---------------- ژورنال کدهای صادرشده (فاز ۴.۵ — شورتکد ادمین) ----------------
     *
     * برای «شورتکد ورود OTP» در پنل مدیریت، کدهای صادرشده به‌صورت موقت در فایل
     * storage/cache/issued-otp.jsonl ثبت می‌شوند تا مالک بتواند بدون دسترسی به
     * صندوق ایمیل/تلگرام/پیامک، جریان ورود را از پنل تست و تأیید کند.
     *
     * محدودسازی ریسک:
     *  - فایل بیرون از public_html است و .htaccess دسترسی به storage را بسته است.
     *  - فقط ۲۰۰ رکورد آخر نگه داشته می‌شود؛ کدها ۵ دقیقه اعتبار دارند.
     *  - خواندن فقط از مسیر ادمین (users.manage) + ثبت در audit.
     */

    private static function issuedPath(): string
    {
        return dirname(__DIR__, 2) . '/storage/cache/issued-otp.jsonl';
    }

    /** ثبت یک کد صادرشده در ژورنال (تا سقف ۲۰۰ رکورد آخر) */
    public static function recordIssued(array $entry): void
    {
        $path = self::issuedPath();
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $entry['at'] = $entry['at'] ?? gmdate('Y-m-d\TH:i:s\Z');
        $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n";
        @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);

        // چرخش: اگر بیش از حد بزرگ شد، فقط ۱۰۰ رکورد آخر بماند
        if (@filesize($path) > 64 * 1024) {
            $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (is_array($lines) && count($lines) > 250) {
                @file_put_contents($path, implode("\n", array_slice($lines, -100)) . "\n", LOCK_EX);
            }
        }
    }

    /** آخرین کد ثبت‌شده برای یک بلیت تلگرام (اتصال چت ← کد) */
    public static function lastIssuedForTicket(string $ticket): ?array
    {
        return self::searchIssued(static fn (array $e): bool => ($e['ticket'] ?? '') === $ticket);
    }

    /** آخرین کد ثبت‌شده برای یک هویت (ایمیل/تلگرام/موبایل) */
    public static function lastIssuedFor(string $type, string $value): ?array
    {
        return self::searchIssued(static fn (array $e): bool => ($e['type'] ?? '') === $type && strtolower((string) ($e['value'] ?? '')) === strtolower($value));
    }

    private static function searchIssued(callable $predicate): ?array
    {
        $path = self::issuedPath();
        if (!is_file($path)) {
            return null;
        }
        $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) {
            return null;
        }
        for ($i = count($lines) - 1; $i >= 0; $i--) {
            $e = json_decode((string) $lines[$i], true);
            if (is_array($e) && $predicate($e)) {
                return $e;
            }
        }
        return null;
    }

    /* ---------------- درج رکوردها ---------------- */

    /**
     * ساخت کد یک‌بارمصرف برای یک هویت — رکورد فقط با هش ذخیره می‌شود.
     * purpose: login (پیش‌فرض) یا account_delete (v1.9 — حذف حساب)؛ جداست تا
     * کدِ حذف حساب هرگز برای ورود قابل استفاده نباشد و برعکس.
     * @return array{expiresAt:string}
     */
    public static function createCode(PDO $pdo, string $type, string $value, string $ip, string $purpose = self::PURPOSE_LOGIN): array
    {
        if ($purpose !== self::PURPOSE_LOGIN && $purpose !== self::PURPOSE_ACCOUNT_DELETE) {
            $purpose = self::PURPOSE_LOGIN;
        }
        $code = self::generateCode();
        $now = time();
        $stmt = $pdo->prepare(
            'INSERT INTO otp_requests (identity_type, identity_value, code_hash, purpose, attempts, ip, expires_at, created_at)
             VALUES (:t, :v, :h, :p, 0, :ip, :exp, :now)'
        );
        $stmt->execute([
            ':t' => $type,
            ':v' => $value,
            ':h' => self::hash($code, $type, $value),
            ':p' => $purpose,
            ':ip' => $ip !== '' ? $ip : null,
            ':exp' => gmdate('Y-m-d H:i:s', $now + self::ttlMinutes() * 60),
            ':now' => gmdate('Y-m-d H:i:s', $now),
        ]);
        // ژورنال محلی فقط برای مسیر ورود است — کد حذف حساب هرگز فایل نمی‌شود
        if ($purpose === self::PURPOSE_LOGIN) {
            self::recordIssued(['type' => $type, 'value' => $value, 'code' => $code]);
        }
        return ['code' => $code, 'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $now + self::ttlMinutes() * 60)];
    }

    /**
     * ساخت بلیت تلگرام — رکوردی که identity_value آن خودِ بلیت است.
     * بعد از اتصال چت، این رکورد مصرف و برای همان chat_id کد واقعی ساخته می‌شود.
     * @return array{ticket:string, expiresAt:string}
     */
    public static function createTicket(PDO $pdo, string $ip): array
    {
        $ticket = self::generateTicket();
        $now = time();
        $stmt = $pdo->prepare(
            'INSERT INTO otp_requests (identity_type, identity_value, code_hash, purpose, attempts, ip, expires_at, created_at)
             VALUES (:t, :v, :h, :p, 0, :ip, :exp, :now)'
        );
        $stmt->execute([
            ':t' => 'telegram',
            ':v' => $ticket,
            ':h' => self::hash($ticket, 'telegram-ticket', $ticket),
            ':p' => self::PURPOSE_LOGIN,
            ':ip' => $ip !== '' ? $ip : null,
            ':exp' => gmdate('Y-m-d H:i:s', $now + self::ticketTtlMinutes() * 60),
            ':now' => gmdate('Y-m-d H:i:s', $now),
        ]);
        return ['ticket' => $ticket, 'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $now + self::ticketTtlMinutes() * 60)];
    }

    /* ---------------- بازیابی و تأیید ---------------- */

    /** وضعیت بلیت تلگرام: pending / code_sent / expired / unknown */
    public static function ticketStatus(PDO $pdo, string $ticket): string
    {
        $stmt = $pdo->prepare(
            'SELECT consumed_at, expires_at FROM otp_requests
             WHERE identity_type = :t AND identity_value = :v AND purpose = :p
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':t' => 'telegram', ':v' => $ticket, ':p' => self::PURPOSE_LOGIN]);
        $row = $stmt->fetch();
        if ($row === false) {
            return 'unknown';
        }
        if ($row['consumed_at'] !== null) {
            return 'code_sent';
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            return 'expired';
        }
        return 'pending';
    }

    /** همه‌ی بلیت‌های زنده (برای تطبیق پیام‌های تلگرام) */
    public static function pendingTickets(PDO $pdo): array
    {
        $stmt = $pdo->prepare(
            'SELECT identity_value FROM otp_requests
             WHERE identity_type = :t AND consumed_at IS NULL AND expires_at > :now AND purpose = :p'
        );
        $stmt->execute([':t' => 'telegram', ':now' => gmdate('Y-m-d H:i:s'), ':p' => self::PURPOSE_LOGIN]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $v) {
            $v = (string) $v;
            if (self::isTicketFormat($v)) {
                $out[] = $v;
            }
        }
        return $out;
    }

    /** مصرف بلیت پس از اتصال چت */
    public static function consumeTicket(PDO $pdo, string $ticket): void
    {
        $pdo->prepare(
            'UPDATE otp_requests SET consumed_at = :now
             WHERE identity_type = :t AND identity_value = :v AND consumed_at IS NULL'
        )->execute([':now' => gmdate('Y-m-d H:i:s'), ':t' => 'telegram', ':v' => $ticket]);
    }

    /**
     * تأیید کد برای یک هویت — فقط از رکوردهای همان purpose.
     * @return array{ok:true}|array{ok:false, error:string, code:string}
     *         code: invalid | locked | expired
     */
    public static function verifyCode(PDO $pdo, string $type, string $value, string $code, string $purpose = self::PURPOSE_LOGIN): array
    {
        $now = gmdate('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'SELECT id, code_hash, attempts, expires_at FROM otp_requests
             WHERE identity_type = :t AND identity_value = :v AND purpose = :p AND consumed_at IS NULL
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':t' => $type, ':v' => $value, ':p' => $purpose]);
        $row = $stmt->fetch();

        if ($row === false) {
            return ['ok' => false, 'error' => 'کدی برای این حساب فعال نیست؛ کد جدید دریافت کنید', 'code' => 'invalid'];
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            // کد منقضی — مصرف می‌شود تا دوباره قابل استفاده نباشد
            $pdo->prepare('UPDATE otp_requests SET consumed_at = :now WHERE id = :id')
                ->execute([':now' => $now, ':id' => $row['id']]);
            return ['ok' => false, 'error' => 'کد منقضی شده است؛ کد جدید دریافت کنید', 'code' => 'expired'];
        }
        if ((int) $row['attempts'] >= self::maxAttempts()) {
            $pdo->prepare('UPDATE otp_requests SET consumed_at = :now WHERE id = :id')
                ->execute([':now' => $now, ':id' => $row['id']]);
            return ['ok' => false, 'error' => 'تلاش‌های ناموفق زیاد بود؛ کد جدید دریافت کنید', 'code' => 'locked'];
        }

        $expected = (string) $row['code_hash'];
        // کد ممکن است با حروف فارسی/عربی وارد شود — اعداد را نرمال می‌کنیم
        $code = self::normalizeDigits($code);

        if (!hash_equals($expected, self::hash($code, $type, $value))) {
            $attempts = (int) $row['attempts'] + 1;
            $locked = $attempts >= self::maxAttempts();
            $pdo->prepare('UPDATE otp_requests SET attempts = :a' . ($locked ? ', consumed_at = :now' : '') . ' WHERE id = :id')
                ->execute(
                    $locked
                        ? [':a' => $attempts, ':now' => $now, ':id' => $row['id']]
                        : [':a' => $attempts, ':id' => $row['id']]
                );
            return [
                'ok' => false,
                'error' => $locked
                    ? 'تلاش‌های ناموفق زیاد بود؛ کد جدید دریافت کنید'
                    : 'کد وارد شده درست نیست',
                'code' => $locked ? 'locked' : 'invalid',
            ];
        }

        // موفق — کد مصرف می‌شود
        $pdo->prepare('UPDATE otp_requests SET consumed_at = :now WHERE id = :id')
            ->execute([':now' => $now, ':id' => $row['id']]);
        return ['ok' => true];
    }

    /** تبدیل اعداد فارسی/عربی به لاتین */
    public static function normalizeDigits(string $v): string
    {
        $fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        $ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $en = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        return str_replace($ar, $en, str_replace($fa, $en, trim($v)));
    }
}

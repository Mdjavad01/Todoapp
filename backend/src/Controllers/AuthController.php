<?php

declare(strict_types=1);

/**
 * کارام — کنترلر احراز هویت — فاز ۳ (فاز ۵: بله ← تلگرام)
 *
 * جریان اصلی: کد یک‌بارمصرف (OTP) از راه ایمیل یا ربات تلگرام.
 *  GET  /api/auth/channels              → کانال‌های ورود فعال
 *  POST /api/auth/otp/request           → درخواست کد (ایمیل/موبایل) یا بلیت اتصال (تلگرام)
 *  POST /api/auth/otp/telegram/poll     → وضعیت بلیت تلگرام (تا اتصال چت و ارسال کد)
 *  POST /api/auth/otp/verify            → تأیید کد و صدور نشست (Access + Refresh)
 *  POST /api/auth/refresh               → چرخش Refresh Token و صدور Access جدید
 *  POST /api/auth/logout                → ابطال Refresh Token (خروج)
 *
 * مدیریت نشست‌ها و پروفایل (نیازمند Bearer):
 *  GET    /api/v1/me
 *  PATCH  /api/v1/me
 *  GET    /api/v1/me/sessions
 *  DELETE /api/v1/me/sessions/{id}
 *
 * POST /api/auth/session (ورود مستقیم بدون کد) از فاز ۲ باقی مانده و فقط وقتی
 * OPEN_SESSION=1 باشد کار می‌کند — پیش‌فرض فاز ۳: بسته (0).
 */

final class AuthController
{
    /* ================= کانال‌های ورود ================= */

    /** GET /api/auth/channels */
    public function channels(): void
    {
        Response::ok([
            'email' => true,
            'telegram' => TelegramBot::configured(),
            'sms' => Sms::enabled(),
            'botUsername' => TelegramBot::botUsername(),
        ]);
    }

    /* ================= درخواست کد / بلیت ================= */

    /** POST /api/auth/otp/request  {channel:'email'|'telegram'|'sms', target?} */
    public function otpRequest(): void
    {
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram', 'sms']);
        $ip = Request::ip();

        if ($channel === 'telegram') {
            if (!TelegramBot::configured()) {
                Response::error('ورود با تلگرام هنوز فعال نشده است', 503, ['code' => 'telegram_disabled']);
                return;
            }
            $limit = Otp::checkRateLimit($pdo = Database::pdo(), 'telegram', '__ticket__', $ip);
            if (!$limit['ok']) {
                Response::error($limit['reason'], 429, ['code' => 'rate_limited', 'retryAfter' => $limit['retryAfter'] ?? 60]);
                return;
            }
            $ticket = Otp::createTicket($pdo, $ip);
            Response::ok([
                'channel' => 'telegram',
                'ticket' => $ticket['ticket'],
                'botUsername' => TelegramBot::botUsername(),
                'deepLink' => TelegramBot::deepLink($ticket['ticket']),
                'expiresIn' => Otp::ticketTtlMinutes() * 60,
                'resendAfter' => Otp::resendAfterSeconds(),
            ]);
            return;
        }

        if ($channel === 'sms') {
            if (!Sms::enabled()) {
                Response::error('ورود با شماره موبایل هنوز فعال نشده است', 503, ['code' => 'sms_disabled']);
                return;
            }
            $phone = self::normalizeMobile((string) ($body['target'] ?? ''));
            if (!self::isMobile($phone)) {
                throw new ValidationError('شماره موبایل معتبر نیست (نمونه: 09123456789)');
            }
            $pdo = Database::pdo();
            $limit = Otp::checkRateLimit($pdo, 'mobile', $phone, $ip);
            if (!$limit['ok']) {
                Response::error($limit['reason'], 429, ['code' => 'rate_limited', 'retryAfter' => $limit['retryAfter'] ?? 60]);
                return;
            }
            $created = Otp::createCode($pdo, 'mobile', $phone, $ip);
            $sent = Sms::sendCode($phone, $created['code']);
            if (!$sent['ok']) {
                Response::error('ارسال پیامک ناموفق بود؛ بعداً تلاش کنید', 502, ['code' => 'sms_failed']);
                return;
            }
            $out = [
                'channel' => 'sms',
                'target' => $phone,
                'expiresIn' => Otp::ttlMinutes() * 60,
                'resendAfter' => Otp::resendAfterSeconds(),
                'devMode' => $sent['mode'] === 'log',
            ];
            if (Otp::debugEcho()) {
                $out['devCode'] = $created['code']; // فقط در حالت توسعه!
            }
            Response::ok($out);
            return;
        }

        // ---- کانال ایمیل ----
        $email = Validator::email($body, 'target');

        $pdo = Database::pdo();
        $limit = Otp::checkRateLimit($pdo, 'email', $email, $ip);
        if (!$limit['ok']) {
            Response::error($limit['reason'], 429, ['code' => 'rate_limited', 'retryAfter' => $limit['retryAfter'] ?? 60]);
            return;
        }

        $created = Otp::createCode($pdo, 'email', $email, $ip);
        $sent = Mailer::send(
            $email,
            'کد ورود کارام: ' . $created['code'],
            Mailer::otpHtml($created['code'], (string) Otp::ttlMinutes()),
        );
        if (!$sent && Mailer::transport() !== 'log') {
            // ارسال واقعی ناموفق — پیام عمومی (جزئیات در لاگ سرور)
            Response::error('ارسال ایمیل ناموفق بود؛ بعداً تلاش کنید یا با تلگرام وارد شوید', 502, ['code' => 'mail_failed']);
            return;
        }

        $out = [
            'channel' => 'email',
            'target' => $email,
            'expiresIn' => Otp::ttlMinutes() * 60,
            'resendAfter' => Otp::resendAfterSeconds(),
        ];
        if (Otp::debugEcho()) {
            $out['devCode'] = $created['code']; // فقط در حالت توسعه!
        }
        Response::ok($out);
    }

    /* ================= وضعیت بلیت تلگرام ================= */

    /** POST /api/auth/otp/telegram/poll  {ticket} */
    public function otpTelegramPoll(): void
    {
        if (!TelegramBot::configured()) {
            Response::error('ورود با تلگرام هنوز فعال نشده است', 503, ['code' => 'telegram_disabled']);
            return;
        }
        $body = Request::json();
        $ticket = Validator::str($body, 'ticket', 6, 6);
        $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
        if (!Otp::isTicketFormat($ticket)) {
            throw new ValidationError('بلیت نامعتبر است');
        }

        // پیام‌های جدید ربات را می‌خوانیم و با بلیت‌ها تطبیق می‌دهیم
        TelegramBot::pollAndMatchTickets(Database::pdo());

        Response::ok([
            'status' => Otp::ticketStatus(Database::pdo(), $ticket),
            'botUsername' => TelegramBot::botUsername(),
        ]);
    }

    /* ================= تأیید کد و صدور نشست ================= */

    /** POST /api/auth/otp/verify  {channel, target?, ticket?, code, deviceName?, deviceUuid?} */
    public function otpVerify(): void
    {
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram', 'sms']);
        $code = Validator::str($body, 'code', 4, 8);
        $deviceName = Validator::str($body, 'deviceName', 1, 80, false) ?? 'دستگاه ناشناس';
        $deviceUuid = Validator::uuid($body, 'deviceUuid', false) ?? Uuid::v4();

        $pdo = Database::pdo();

        if ($channel === 'email') {
            $target = Validator::email($body, 'target');
            $identityType = 'email';
            $result = Otp::verifyCode($pdo, 'email', $target, (string) $code);
        } elseif ($channel === 'sms') {
            $target = self::normalizeMobile((string) ($body['target'] ?? ''));
            if (!self::isMobile($target)) {
                throw new ValidationError('شماره موبایل معتبر نیست');
            }
            $identityType = 'mobile';
            $result = Otp::verifyCode($pdo, 'mobile', $target, (string) $code);
        } else {
            $ticket = Validator::str($body, 'ticket', 6, 6);
            $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
            if (!Otp::isTicketFormat($ticket)) {
                throw new ValidationError('بلیت نامعتبر است');
            }
            // بلیت باید قبلاً متصل شده باشد (کد برای همان چت ارسال شده باشد)
            if (Otp::ticketStatus($pdo, $ticket) !== 'code_sent') {
                Response::error('کد هنوز به تلگرام ارسال نشده است', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            // chat_id از رکورد بلیتِ مصرف‌شده در نمی‌آید؛ کلاینت هم آن را نمی‌داند،
            // پس آخرین کد فعالِ تلگرام که بعد از مصرف همین بلیت ساخته شده را می‌یابیم.
            $target = self::latestTelegramTargetForTicket($pdo, $ticket);
            if ($target === null) {
                Response::error('کد فعال یافت نشد؛ از ابتدا وارد شوید', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $identityType = 'telegram_chat_id';
            $result = Otp::verifyCode($pdo, 'telegram', $target, (string) $code);
        }

        if (!$result['ok']) {
            Response::error($result['error'], 400, ['code' => $result['code']]);
            return;
        }

        // یافتن/ساخت کاربر و هویت تأییدشده
        $user = self::findOrCreateUserByIdentity($pdo, $identityType, $target, markVerified: true);
        if ($user['status'] !== 'active') {
            Response::error('حساب کاربری مسدود یا حذف شده است', 403, ['code' => 'blocked']);
            return;
        }

        // گیت ثبت‌نام (قابل کنترل از پنل مدیریت — فاز ۴.۵)
        if ($user['isNew'] && !Settings::bool('api_allow_registration', true)) {
            Response::error('ثبت‌نام حساب جدید موقتاً بسته است؛ با پشتیبانی تماس بگیرید', 403, ['code' => 'registration_closed']);
            return;
        }

        $this->touchLogin($pdo, $user['id']);

        $access = AccessToken::issue($user['uuid']);
        $refresh = RefreshToken::issue($pdo, $user['id'], $deviceUuid, $deviceName);

        $out = [
            'isNew' => $user['isNew'],
            'user' => ['uuid' => $user['uuid'], 'displayName' => $user['displayName'], 'gender' => $user['gender']],
            'device' => ['uuid' => $deviceUuid, 'name' => $deviceName],
            'accessToken' => $access['token'],
            'expiresAt' => $access['expiresAt'],
            'refreshToken' => $refresh['token'],
            'refreshExpiresAt' => $refresh['expiresAt'],
        ];
        if ($channel === 'email') {
            $out['user']['email'] = $target;
        } elseif ($channel === 'sms') {
            $out['user']['mobile'] = $target;
        } else {
            $out['user']['telegramChatId'] = $target;
        }
        Response::ok($out);
    }

    /** آخرین chat_id تلگرامی که بعد از مصرف این بلیت برایش کد ساخته شده است */
    public static function latestTelegramTargetForTicket(PDO $pdo, string $ticket): ?string
    {
        $stmt = $pdo->prepare(
            'SELECT consumed_at FROM otp_requests
             WHERE identity_type = :t AND identity_value = :v AND consumed_at IS NOT NULL
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':t' => 'telegram', ':v' => $ticket]);
        $consumedAt = $stmt->fetchColumn();
        if ($consumedAt === false) {
            return null;
        }
        // کد واقعی تلگرام: identity_value عددی است (chat_id)؛ بلیت‌ها ۶ حرف — فیلتر در PHP
        // (سازگار با MySQL و SQLite؛ بدون REGEXP)
        $stmt2 = $pdo->prepare(
            'SELECT identity_value FROM otp_requests
             WHERE identity_type = :t AND created_at >= :since
             ORDER BY id DESC LIMIT 20'
        );
        $stmt2->execute([':t' => 'telegram', ':since' => $consumedAt]);
        foreach ($stmt2->fetchAll(PDO::FETCH_COLUMN) as $v) {
            $v = (string) $v;
            if (ctype_digit($v)) {
                return $v;
            }
        }
        return null;
    }

    /* ================= چرخش توکن و خروج ================= */

    /** POST /api/auth/refresh  {refreshToken} */
    public function refresh(): void
    {
        $body = Request::json();
        $raw = Validator::str($body, 'refreshToken', 32, 128);
        $deviceUuid = Validator::uuid($body, 'deviceUuid', false);

        $pdo = Database::pdo();
        $rotated = RefreshToken::rotate($pdo, (string) $raw);
        if ($rotated === null) {
            Response::error('نشست نامعتبر است؛ دوباره وارد شوید', 401, ['code' => 'unauthorized']);
            return;
        }

        $stmt = $pdo->prepare('SELECT uuid, display_name, status FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $rotated['userId']]);
        $user = $stmt->fetch();
        if ($user === false || $user['status'] !== 'active') {
            Response::error('حساب کاربری در دسترس نیست', 401, ['code' => 'unauthorized']);
            return;
        }

        $access = AccessToken::issue((string) $user['uuid']);
        $out = [
            'user' => ['uuid' => (string) $user['uuid'], 'displayName' => $user['display_name']],
            'accessToken' => $access['token'],
            'expiresAt' => $access['expiresAt'],
            'refreshToken' => $rotated['token'],
            'refreshExpiresAt' => $rotated['expiresAt'],
        ];
        if ($deviceUuid !== null) {
            $out['device'] = ['uuid' => $deviceUuid];
        }
        Response::ok($out);
    }

    /** POST /api/auth/logout  {refreshToken} */
    public function logout(): void
    {
        $body = Request::json();
        $raw = Validator::str($body, 'refreshToken', 32, 128, false);
        if ($raw !== null) {
            RefreshToken::revoke(Database::pdo(), (string) $raw);
        }
        Response::ok(['loggedOut' => true]);
    }

    /* ================= پروفایل و نشست‌ها (Bearer) ================= */

    /** GET /api/v1/me */
    public function me(): void
    {
        $user = Guard::requireUser();
        $stmt = Database::pdo()->prepare(
            'SELECT type, value, verified_at FROM user_identities WHERE user_id = :id ORDER BY is_primary DESC, id ASC'
        );
        $stmt->execute([':id' => $user['id']]);
        $identities = array_map(static fn (array $r): array => [
            'type' => (string) $r['type'],
            'value' => (string) $r['value'],
            'verifiedAt' => $r['verified_at'] !== null
                ? gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $r['verified_at']))
                : null,
        ], (array) $stmt->fetchAll());

        unset($user['id']);
        Response::ok(['user' => $user, 'identities' => $identities]);
    }

    /** PATCH /api/v1/me  {displayName?, gender?} */
    public function updateMe(): void
    {
        $user = Guard::requireUser();
        $body = Request::json();
        $name = Validator::str($body, 'displayName', 1, 100, false);
        $gender = Validator::enum($body, 'gender', ['unset', 'male', 'female'], null, false);

        if ($name === null && $gender === null) {
            throw new ValidationError('چیزی برای تغییر ارسال نشده است');
        }

        $pdo = Database::pdo();
        if ($name !== null) {
            $pdo->prepare('UPDATE users SET display_name = :n WHERE id = :id')
                ->execute([':n' => $name, ':id' => $user['id']]);
        }
        if ($gender !== null) {
            $pdo->prepare('UPDATE users SET gender = :g WHERE id = :id')
                ->execute([':g' => $gender, ':id' => $user['id']]);
        }
        Response::ok(['user' => [
            'uuid' => $user['uuid'],
            'displayName' => $name ?? $user['displayName'],
            'gender' => $gender ?? $user['gender'],
        ]]);
    }

    /** GET /api/v1/me/sessions?deviceUuid=... */
    public function sessions(): void
    {
        $user = Guard::requireUser();
        $rows = RefreshToken::listActive(Database::pdo(), $user['id']);
        $currentDevice = Request::query('deviceUuid');
        foreach ($rows as &$r) {
            $r['current'] = $currentDevice !== null && $r['deviceId'] === $currentDevice;
        }
        Response::ok(['sessions' => $rows]);
    }

    /** DELETE /api/v1/me/sessions/{id} */
    public function revokeSession(array $params): void
    {
        $user = Guard::requireUser();
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            throw new ValidationError('شناسه‌ی نشست نامعتبر است');
        }
        $revoked = RefreshToken::revokeById(Database::pdo(), $user['id'], $id);
        if (!$revoked) {
            Response::error('نشست یافت نشد یا قبلاً بسته شده است', 404, ['code' => 'not_found']);
            return;
        }
        Response::ok(['revoked' => true]);
    }

    /* ================= نشست بدون OTP (فاز ۲ — پیش‌فرض بسته) ================= */

    /** POST /api/auth/session — فقط برای توسعه‌ی محلی با OPEN_SESSION=1 */
    public function session(): void
    {
        if (Config::get('OPEN_SESSION', '0') !== '1') {
            Response::error('ورود مستقیم غیرفعال است؛ ورود با کد یک‌بارمصرف انجام می‌شود', 403, ['code' => 'otp_required']);
            return;
        }

        $body = Request::json();
        $email = Validator::email($body);
        $deviceName = Validator::str($body, 'deviceName', 1, 80, false) ?? 'دستگاه ناشناس';
        $deviceUuid = Validator::uuid($body, 'deviceUuid', false) ?? Uuid::v4();

        $pdo = Database::pdo();
        $user = $this->findOrCreateUserByIdentity($pdo, 'email', $email, markVerified: false);
        if ($user['status'] !== 'active') {
            Response::error('حساب کاربری مسدود یا حذف شده است', 403, ['code' => 'blocked']);
            return;
        }
        $this->touchLogin($pdo, $user['id']);

        $access = AccessToken::issue($user['uuid']);
        $refresh = RefreshToken::issue($pdo, $user['id'], $deviceUuid, $deviceName);

        Response::ok([
            'isNew' => $user['isNew'],
            'user' => ['uuid' => $user['uuid'], 'displayName' => $user['displayName'], 'email' => $email],
            'device' => ['uuid' => $deviceUuid, 'name' => $deviceName],
            'accessToken' => $access['token'],
            'expiresAt' => $access['expiresAt'],
            'refreshToken' => $refresh['token'],
            'refreshExpiresAt' => $refresh['expiresAt'],
        ]);
    }

    /* ================= ابزارهای مشترک ================= */

    /**
     * یافتن کاربر با هویت یا ساخت کاربر جدید + هویت. (عمومی — پنل ادمین هم استفاده می‌کند)
     * @return array{id:int, uuid:string, displayName:?string, gender:string, status:string, isNew:bool}
     */
    public static function findOrCreateUserByIdentity(PDO $pdo, string $type, string $value, bool $markVerified): array
    {
        $stmt = $pdo->prepare(
            'SELECT u.id, u.uuid, u.display_name, u.gender, u.status
             FROM user_identities i JOIN users u ON u.id = i.user_id
             WHERE i.type = :type AND i.value = :value
             LIMIT 1'
        );
        $stmt->execute([':type' => $type, ':value' => $value]);
        $user = $stmt->fetch();

        if ($user !== false) {
            if ($markVerified) {
                $pdo->prepare('UPDATE user_identities SET verified_at = COALESCE(verified_at, :now) WHERE type = :t AND value = :v')
                    ->execute([':now' => gmdate('Y-m-d H:i:s'), ':t' => $type, ':v' => $value]);
            }
            return [
                'id' => (int) $user['id'],
                'uuid' => (string) $user['uuid'],
                'displayName' => $user['display_name'],
                'gender' => (string) ($user['gender'] ?? 'unset'),
                'status' => (string) $user['status'],
                'isNew' => false,
            ];
        }

        // کاربر جدید
        $userUuid = Uuid::v4();
        $displayName = $type === 'email'
            ? mb_substr(explode('@', $value)[0], 0, 100)
            : 'کاربر کارام';
        $now = gmdate('Y-m-d H:i:s');
        $pdo->beginTransaction();
        try {
            $pdo->prepare("INSERT INTO users (uuid, display_name, gender, status, created_at, updated_at)
                           VALUES (:uuid, :name, 'unset', :status, :created_at, :updated_at)")
                ->execute([':uuid' => $userUuid, ':name' => $displayName, ':status' => 'active', ':created_at' => $now, ':updated_at' => $now]);
            $userId = (int) $pdo->lastInsertId();

            $pdo->prepare('INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at)
                           VALUES (:uid, :t, :v, 1, :verified, :now)')
                ->execute([
                    ':uid' => $userId,
                    ':t' => $type,
                    ':v' => $value,
                    ':verified' => $markVerified ? $now : null,
                    ':now' => $now,
                ]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            // مسابقه‌ی دو درخواست هم‌زمان برای یک هویت → دوباره بخوان
            $stmt->execute([':type' => $type, ':value' => $value]);
            $user = $stmt->fetch();
            if ($user === false) {
                throw $e;
            }
            return [
                'id' => (int) $user['id'],
                'uuid' => (string) $user['uuid'],
                'displayName' => $user['display_name'],
                'gender' => (string) ($user['gender'] ?? 'unset'),
                'status' => (string) $user['status'],
                'isNew' => false,
            ];
        }

        // v18 — دوره آزمایشی برای ثبت‌نام‌های جدید: دو کلید پنل (trial_enabled / trial_days)
        // و منطق کوچک. بیرون از تراکنش و در try/catch — اگر به هر دلیلی ناموفق بود،
        // ثبت‌نام خودش سالم می‌ماند و فقط آزمایشی فعال نمی‌شود.
        if (Settings::bool('trial_enabled')) {
            try {
                Subscription::activateTrial($pdo, $userId, Settings::int('trial_days', 7, 1, 30));
            } catch (Throwable $e) {
                error_log('[karam][trial] فعال‌سازی دوره آزمایشی برای کاربر ' . $userId . ' ناموفق: ' . $e->getMessage());
            }
        }

        return ['id' => $userId, 'uuid' => $userUuid, 'displayName' => $displayName, 'gender' => 'unset', 'status' => 'active', 'isNew' => true];
    }

    private function touchLogin(PDO $pdo, int $userId): void
    {
        $pdo->prepare('UPDATE users SET last_login_at = :now WHERE id = :id')
            ->execute([':id' => $userId, ':now' => gmdate('Y-m-d H:i:s')]);
    }

    /* ================= ابزار شماره موبایل (فاز ۴.۵) ================= */

    /** نرمال‌سازی شماره موبایل ایران: حذف +۹۸/۰۰۹۸/فاصله — خروجی: 09xxxxxxxxx */
    public static function normalizeMobile(string $raw): string
    {
        $v = Otp::normalizeDigits(trim($raw));
        $v = preg_replace('/[\s\-()]/u', '', $v) ?? '';
        if (str_starts_with($v, '+98')) {
            $v = '0' . substr($v, 3);
        } elseif (str_starts_with($v, '0098')) {
            $v = '0' . substr($v, 4);
        } elseif (str_starts_with($v, '98') && strlen($v) === 12) {
            $v = '0' . substr($v, 2);
        } elseif (str_starts_with($v, '9') && strlen($v) === 10) {
            $v = '0' . $v;
        }
        return $v;
    }

    /** شماره موبایل معتبر ایران؟ */
    public static function isMobile(string $v): bool
    {
        return (bool) preg_match('/^09\d{9}$/', $v);
    }
}

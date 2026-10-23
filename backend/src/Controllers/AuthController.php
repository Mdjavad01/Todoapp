<?php

declare(strict_types=1);

/**
 * کارام — کنترلر احراز هویت — فاز ۳
 *
 * جریان اصلی: کد یک‌بارمصرف (OTP) از راه ایمیل یا ربات بله.
 *  POST /api/auth/channels          → کانال‌های ورود فعال
 *  POST /api/auth/otp/request       → درخواست کد (ایمیل) یا بلیت اتصال (بله)
 *  POST /api/auth/otp/bale/poll     → وضعیت بلیت بله (تا اتصال چت و ارسال کد)
 *  POST /api/auth/otp/verify        → تأیید کد و صدور نشست (Access + Refresh)
 *  POST /api/auth/refresh           → چرخش Refresh Token و صدور Access جدید
 *  POST /api/auth/logout            → ابطال Refresh Token (خروج)
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
            'bale' => BaleBot::configured(),
            'botUsername' => BaleBot::botUsername(),
        ]);
    }

    /* ================= درخواست کد / بلیت ================= */

    /** POST /api/auth/otp/request  {channel:'email'|'bale', target?} */
    public function otpRequest(): void
    {
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'bale']);
        $ip = Request::ip();

        if ($channel === 'bale') {
            if (!BaleBot::configured()) {
                Response::error('ورود با بله هنوز فعال نشده است', 503, ['code' => 'bale_disabled']);
                return;
            }
            $limit = Otp::checkRateLimit($pdo = Database::pdo(), 'bale', '__ticket__', $ip);
            if (!$limit['ok']) {
                Response::error($limit['reason'], 429, ['code' => 'rate_limited', 'retryAfter' => $limit['retryAfter'] ?? 60]);
                return;
            }
            $ticket = Otp::createTicket($pdo, $ip);
            Response::ok([
                'channel' => 'bale',
                'ticket' => $ticket['ticket'],
                'botUsername' => BaleBot::botUsername(),
                'deepLink' => BaleBot::deepLink($ticket['ticket']),
                'expiresIn' => Otp::ticketTtlMinutes() * 60,
                'resendAfter' => Otp::resendAfterSeconds(),
            ]);
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
            Response::error('ارسال ایمیل ناموفق بود؛ بعداً تلاش کنید یا با بله وارد شوید', 502, ['code' => 'mail_failed']);
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

    /* ================= وضعیت بلیت بله ================= */

    /** POST /api/auth/otp/bale/poll  {ticket} */
    public function otpBalePoll(): void
    {
        if (!BaleBot::configured()) {
            Response::error('ورود با بله هنوز فعال نشده است', 503, ['code' => 'bale_disabled']);
            return;
        }
        $body = Request::json();
        $ticket = Validator::str($body, 'ticket', 6, 6);
        $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
        if (!Otp::isTicketFormat($ticket)) {
            throw new ValidationError('بلیت نامعتبر است');
        }

        // پیام‌های جدید ربات را می‌خوانیم و با بلیت‌ها تطبیق می‌دهیم
        BaleBot::pollAndMatchTickets(Database::pdo());

        Response::ok([
            'status' => Otp::ticketStatus(Database::pdo(), $ticket),
            'botUsername' => BaleBot::botUsername(),
        ]);
    }

    /* ================= تأیید کد و صدور نشست ================= */

    /** POST /api/auth/otp/verify  {channel, target?, ticket?, code, deviceName?, deviceUuid?} */
    public function otpVerify(): void
    {
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'bale']);
        $code = Validator::str($body, 'code', 4, 8);
        $deviceName = Validator::str($body, 'deviceName', 1, 80, false) ?? 'دستگاه ناشناس';
        $deviceUuid = Validator::uuid($body, 'deviceUuid', false) ?? Uuid::v4();

        $pdo = Database::pdo();

        if ($channel === 'email') {
            $target = Validator::email($body, 'target');
            $result = Otp::verifyCode($pdo, 'email', $target, (string) $code);
        } else {
            $ticket = Validator::str($body, 'ticket', 6, 6);
            $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
            if (!Otp::isTicketFormat($ticket)) {
                throw new ValidationError('بلیت نامعتبر است');
            }
            // بلیت باید قبلاً متصل شده باشد (کد برای همان چت ارسال شده باشد)
            if (Otp::ticketStatus($pdo, $ticket) !== 'code_sent') {
                Response::error('کد هنوز به بله ارسال نشده است', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            // chat_id از رکورد بلیتِ مصرف‌شده در نمی‌آید؛ کلاینت هم آن را نمی‌داند،
            // پس آخرین کد فعالِ بله که بعد از مصرف همین بلیت ساخته شده را می‌یابیم.
            $target = $this->latestBaleTargetForTicket($pdo, $ticket);
            if ($target === null) {
                Response::error('کد فعال یافت نشد؛ از ابتدا وارد شوید', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $result = Otp::verifyCode($pdo, 'bale', $target, (string) $code);
        }

        if (!$result['ok']) {
            Response::error($result['error'], 400, ['code' => $result['code']]);
            return;
        }

        // یافتن/ساخت کاربر و هویت تأییدشده
        $type = $channel === 'email' ? 'email' : 'bale_chat_id';
        $user = $this->findOrCreateUserByIdentity($pdo, $type, $target, markVerified: true);
        if ($user['status'] !== 'active') {
            Response::error('حساب کاربری مسدود یا حذف شده است', 403, ['code' => 'blocked']);
            return;
        }

        $this->touchLogin($pdo, $user['id']);

        $access = AccessToken::issue($user['uuid']);
        $refresh = RefreshToken::issue($pdo, $user['id'], $deviceUuid, $deviceName);

        $out = [
            'isNew' => $user['isNew'],
            'user' => ['uuid' => $user['uuid'], 'displayName' => $user['displayName']],
            'device' => ['uuid' => $deviceUuid, 'name' => $deviceName],
            'accessToken' => $access['token'],
            'expiresAt' => $access['expiresAt'],
            'refreshToken' => $refresh['token'],
            'refreshExpiresAt' => $refresh['expiresAt'],
        ];
        if ($channel === 'email') {
            $out['user']['email'] = $target;
        } else {
            $out['user']['baleChatId'] = $target;
        }
        Response::ok($out);
    }

    /** آخرین chat_id بله‌ای که بعد از مصرف این بلیت برایش کد ساخته شده است */
    private function latestBaleTargetForTicket(PDO $pdo, string $ticket): ?string
    {
        $stmt = $pdo->prepare(
            'SELECT consumed_at FROM otp_requests
             WHERE identity_type = :t AND identity_value = :v AND consumed_at IS NOT NULL
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':t' => 'bale', ':v' => $ticket]);
        $consumedAt = $stmt->fetchColumn();
        if ($consumedAt === false) {
            return null;
        }
        // کد واقعی بله: identity_value عددی است (chat_id)؛ بلیت‌ها ۶ حرف — فیلتر در PHP
        // (سازگار با MySQL و SQLite؛ بدون REGEXP)
        $stmt2 = $pdo->prepare(
            'SELECT identity_value FROM otp_requests
             WHERE identity_type = :t AND created_at >= :since
             ORDER BY id DESC LIMIT 20'
        );
        $stmt2->execute([':t' => 'bale', ':since' => $consumedAt]);
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

    /** PATCH /api/v1/me  {displayName} */
    public function updateMe(): void
    {
        $user = Guard::requireUser();
        $body = Request::json();
        $name = Validator::str($body, 'displayName', 1, 100);
        Database::pdo()->prepare('UPDATE users SET display_name = :n WHERE id = :id')
            ->execute([':n' => $name, ':id' => $user['id']]);
        Response::ok(['user' => ['uuid' => $user['uuid'], 'displayName' => $name]]);
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
     * یافتن کاربر با هویت یا ساخت کاربر جدید + هویت.
     * @return array{id:int, uuid:string, displayName:?string, status:string, isNew:bool}
     */
    private function findOrCreateUserByIdentity(PDO $pdo, string $type, string $value, bool $markVerified): array
    {
        $stmt = $pdo->prepare(
            'SELECT u.id, u.uuid, u.display_name, u.status
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
            $pdo->prepare('INSERT INTO users (uuid, display_name, status, created_at, updated_at)
                           VALUES (:uuid, :name, :status, :now, :now)')
                ->execute([':uuid' => $userUuid, ':name' => $displayName, ':status' => 'active', ':now' => $now]);
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
                'status' => (string) $user['status'],
                'isNew' => false,
            ];
        }

        return ['id' => $userId, 'uuid' => $userUuid, 'displayName' => $displayName, 'status' => 'active', 'isNew' => true];
    }

    private function touchLogin(PDO $pdo, int $userId): void
    {
        $pdo->prepare('UPDATE users SET last_login_at = :now WHERE id = :id')
            ->execute([':id' => $userId, ':now' => gmdate('Y-m-d H:i:s')]);
    }
}

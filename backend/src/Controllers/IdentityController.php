<?php

declare(strict_types=1);

/**
 * کارام — اتصال روش دوم ورود به حساب (موج ۲ — چندروش ورود)
 *
 * یک حساب = یک user_id؛ هویت‌ها (ایمیل/تلگرام) روی جدول موجود user_identities
 * اضافه می‌شوند (بدون هیچ SQL جدید) و با verified_at نشان تأیید می‌گیرند.
 * بعد از اتصال، ورود از هر دو راه به همان حساب می‌رسد (findOrCreateUserByIdentity).
 *
 *  POST /api/v1/me/identities         {channel:'email'|'telegram', target?}  → درخواست کد اتصال
 *  POST /api/v1/me/identities/confirm {channel, target?, ticket?, code}      → تأیید کد و اتصال
 *
 * قواعد امنیتی (قرارداد موج ۲):
 *  - درخواست کد هیچ کوئری روی user_identities نمی‌زند — پاسخ برای هر ایمیل/چت
 *    همیشه یک شکل است؛ وجود یا نبودِ حساب هرگز فاش نمی‌شود (بدون enumeration).
 *  - تعارض «هویت متعلق به حساب دیگر» فقط بعد از تأیید صحیح کد اعلام می‌شود
 *    (۴۰۹ conflict_identity) — یعنی فقط مالک واقعی آن صندوق/چت آن را می‌بیند.
 *  - کد اتصال با purpose='login' است (بدون تغییر SQL) و فقط با Otp استاندارد تأیید می‌شود.
 *  - unlink (حذف روش) عمداً در موج ۲ ساخته نمی‌شود.
 *  - ادغام دو حساب انجام نمی‌شود؛ ۴۰۹ فقط کاربر را به پشتیبانی ارجاع می‌دهد.
 */

final class IdentityController
{
    /* ================= درخواست کد اتصال ================= */

    /** POST /api/v1/me/identities  {channel:'email'|'telegram', target?} */
    public function request(): void
    {
        $user = Guard::requireUser();
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram']);
        $ip = Request::ip();
        $pdo = Database::pdo();

        if ($channel === 'telegram') {
            if (!TelegramBot::configured()) {
                Response::error('ورود با تلگرام هنوز فعال نشده است', 503, ['code' => 'telegram_disabled']);
                return;
            }
            // بلیت اتصال مثل ورود تلگرام: سقف ساعتی به‌ازای IP (chat_id اینجا معنا ندارد؛
            // ارسال کد بعداً در اتصال بلیت با سقف chat_id همان‌جا کنترل می‌شود)
            $limit = Otp::checkRateLimit($pdo, 'telegram', '__ticket__', $ip);
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

        // ---- کانال ایمیل ----
        // هیچ بررسی وجود حساب اینجا انجام نمی‌شود — پاسخ برای هر ایمیل یک شکل است.
        $email = Validator::email($body, 'target');
        $limit = Otp::checkRateLimit($pdo, 'email', $email, $ip);
        if (!$limit['ok']) {
            Response::error($limit['reason'], 429, ['code' => 'rate_limited', 'retryAfter' => $limit['retryAfter'] ?? 60]);
            return;
        }
        $created = Otp::createCode($pdo, 'email', $email, $ip); // purpose=login پیش‌فرض
        $sent = Mailer::send(
            $email,
            'کد اتصال کارام: ' . $created['code'],
            Mailer::otpHtml($created['code'], (string) Otp::ttlMinutes()),
        );
        if (!$sent && Mailer::transport() !== 'log') {
            // ارسال واقعی ناموفق — پیام عمومی (جزئیات در لاگ سرور)؛ کدِ نرسیده با TTL منقضی می‌شود
            Response::error('ارسال ایمیل ناموفق بود؛ بعداً تلاش کنید', 502, ['code' => 'mail_failed']);
            return;
        }
        $out = [
            'channel' => 'email',
            'target' => AuthController::maskTarget($email),
            'expiresIn' => Otp::ttlMinutes() * 60,
            'resendAfter' => Otp::resendAfterSeconds(),
        ];
        if (Otp::debugEcho()) {
            $out['devCode'] = $created['code']; // فقط در حالت توسعه!
        }
        Response::ok($out);
    }

    /* ================= تأیید کد و اتصال هویت ================= */

    /** POST /api/v1/me/identities/confirm  {channel, target?, ticket?, code} */
    public function confirm(): void
    {
        $user = Guard::requireUser();
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram']);
        $code = Validator::str($body, 'code', 4, 8);
        $pdo = Database::pdo();

        if ($channel === 'telegram') {
            $ticket = Validator::str($body, 'ticket', 6, 6);
            $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
            if (!Otp::isTicketFormat($ticket)) {
                throw new ValidationError('بلیت نامعتبر است');
            }
            // بلیت باید قبلاً متصل شده باشد (کد برای همان چت ارسال شده باشد) — مثل ورود تلگرام
            if (Otp::ticketStatus($pdo, $ticket) !== 'code_sent') {
                Response::error('کد هنوز به تلگرام ارسال نشده است', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $target = AuthController::latestTelegramTargetForTicket($pdo, $ticket);
            if ($target === null) {
                Response::error('کد فعال یافت نشد؛ از ابتدا وارد شوید', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $identityType = 'telegram_chat_id';
            $otpType = 'telegram';
        } else {
            $target = Validator::email($body, 'target');
            $identityType = 'email';
            $otpType = 'email';
        }

        // تأیید کد — تعارض ۴۰۹ فقط بعد از تأیید صحیح کد اعلام می‌شود
        // (کد اشتباه فقط خطای عمومی invalid می‌گیرد؛ هیچ چیزی درباره‌ی مالکیت افشا نمی‌شود)
        $result = Otp::verifyCode($pdo, $otpType, $target, (string) $code, Otp::PURPOSE_LOGIN);
        if (!$result['ok']) {
            Response::error($result['error'], 400, ['code' => $result['code']]);
            return;
        }

        // مالک فعلی هویت (اگر دارد) — جدول موجود، بدون SQL جدید
        $stmt = $pdo->prepare(
            'SELECT i.user_id, u.status
             FROM user_identities i JOIN users u ON u.id = i.user_id
             WHERE i.type = :t AND i.value = :v
             LIMIT 1'
        );
        $stmt->execute([':t' => $identityType, ':v' => $target]);
        $owner = $stmt->fetch();

        $masked = AuthController::maskTarget($target);

        if ($owner !== false) {
            if ((int) $owner['user_id'] === (int) $user['id']) {
                // همین حساب — تأیید بقیه‌ی مسیر (مثلاً هویت بدون verified_at از نشست بازِ قدیمی)
                $pdo->prepare('UPDATE user_identities SET verified_at = COALESCE(verified_at, :now) WHERE type = :t AND value = :v')
                    ->execute([':now' => gmdate('Y-m-d H:i:s'), ':t' => $identityType, ':v' => $target]);
                Response::ok(['linked' => true, 'already' => true, 'identity' => ['type' => $identityType, 'masked' => $masked]]);
                return;
            }
            // متعلق به حساب دیگر — ۴۰۹ فقط اینجا (بعد از تأیید کد)؛ بدون ادغام خودکار؛
            // ارجاع به پشتیبانی — پیام دقیق قرارداد موج ۲
            Response::error(
                'این ایمیل/تلگرام قبلاً روی حساب دیگری فعال شده است. برای انتقال داده‌ها و یکی‌کردن حساب‌ها با پشتیبانی تماس بگیرید.',
                409,
                ['code' => 'conflict_identity'],
            );
            return;
        }

        // هویت آزاد است — به حساب نشست اضافه و تأیید می‌شود (is_primary نمی‌گیرد؛ هویت اصلی نمی‌ماند)
        try {
            $pdo->prepare(
                'INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at)
                 VALUES (:uid, :t, :v, 0, :verified, :now)'
            )->execute([
                ':uid' => (int) $user['id'],
                ':t' => $identityType,
                ':v' => $target,
                ':verified' => gmdate('Y-m-d H:i:s'),
                ':now' => gmdate('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $e) {
            // مسابقه‌ی دو تأیید هم‌زمان (یونیک type,value) — دوباره مالک را بخوان
            $stmt->execute([':t' => $identityType, ':v' => $target]);
            $owner = $stmt->fetch();
            if ($owner === false) {
                throw $e;
            }
            if ((int) $owner['user_id'] !== (int) $user['id']) {
                Response::error(
                    'این ایمیل/تلگرام قبلاً روی حساب دیگری فعال شده است. برای انتقال داده‌ها و یکی‌کردن حساب‌ها با پشتیبانی تماس بگیرید.',
                    409,
                    ['code' => 'conflict_identity'],
                );
                return;
            }
            Response::ok(['linked' => true, 'already' => true, 'identity' => ['type' => $identityType, 'masked' => $masked]]);
            return;
        }

        Response::ok(['linked' => true, 'identity' => ['type' => $identityType, 'masked' => $masked]]);
    }
}

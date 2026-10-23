<?php

declare(strict_types=1);

/**
 * کارام — کنترلر نشست (فاز ۲)
 *
 * POST /api/auth/session  → ساخت/یافتن کاربر با ایمیل و صدور Access Token
 *
 * توجه امنیتی: در فاز ۲ این مسیر بدون تأیید کد (OTP) است و با کلید OPEN_SESSION در .env
 * کنترل می‌شود. در فاز ۳ جریان کامل OTP (ایمیل + بله) جایگزین می‌شود و این گیت بسته خواهد شد.
 */

final class AuthController
{
    public function session(): void
    {
        if (Config::get('OPEN_SESSION', '1') !== '1') {
            Response::error('ثبت‌نشست بدون تأیید کد غیرفعال است؛ ورود با OTP در فاز ۳ فعال می‌شود', 403, ['code' => 'otp_required']);
            return;
        }

        $body = Request::json();
        $email = Validator::email($body);

        // اختیاری: شناسه‌ی دستگاه برای گزارش‌های بعدی (فاز ۳ به refresh_tokens وصل می‌شود)
        $deviceName = Validator::str($body, 'deviceName', 1, 80, false) ?? 'دستگاه ناشناس';
        $deviceUuid = Validator::uuid($body, 'deviceUuid', false) ?? Uuid::v4();

        $pdo = Database::pdo();

        // یافتن کاربر با هویت ایمیل
        $stmt = $pdo->prepare(
            'SELECT u.id, u.uuid, u.display_name, u.status
             FROM user_identities i JOIN users u ON u.id = i.user_id
             WHERE i.type = :type AND i.value = :value
             LIMIT 1'
        );
        $stmt->execute([':type' => 'email', ':value' => $email]);
        $user = $stmt->fetch();

        $isNew = false;
        if ($user === false) {
            // ساخت کاربر جدید (فاز ۲: بدون تأیید ایمیل — verified_at NULL می‌ماند)
            $userUuid = Uuid::v4();
            $displayName = mb_substr(explode('@', $email)[0], 0, 100);
            $pdo->beginTransaction();
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO users (uuid, display_name, status, created_at, updated_at)
                     VALUES (:uuid, :name, :status, :now, :now)'
                );
                $ins->execute([':uuid' => $userUuid, ':name' => $displayName, ':status' => 'active', ':now' => gmdate('Y-m-d H:i:s')]);
                $userId = (int) $pdo->lastInsertId();

                $insId = $pdo->prepare(
                    'INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at)
                     VALUES (:uid, :type, :value, 1, NULL, :now)'
                );
                $insId->execute([':uid' => $userId, ':type' => 'email', ':value' => $email, ':now' => gmdate('Y-m-d H:i:s')]);

                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            $isNew = true;
            $status = 'active';
            $displayNameOut = $displayName;
        } else {
            if ($user['status'] !== 'active') {
                Response::error('حساب کاربری مسدود یا حذف شده است', 403, ['code' => 'blocked']);
                return;
            }
            $userId = (int) $user['id'];
            $userUuid = (string) $user['uuid'];
            $displayNameOut = $user['display_name'];
            $pdo->prepare('UPDATE users SET last_login_at = :now WHERE id = :id')
                ->execute([':id' => $userId, ':now' => gmdate('Y-m-d H:i:s')]);
        }

        $token = AccessToken::issue($userUuid);

        Response::ok([
            'isNew' => $isNew,
            'user' => [
                'uuid' => $userUuid,
                'displayName' => $displayNameOut,
                'email' => $email,
            ],
            'device' => ['uuid' => $deviceUuid, 'name' => $deviceName],
            'accessToken' => $token['token'],
            'expiresAt' => $token['expiresAt'],
        ]);
    }

    /** GET /api/v1/me — بررسی اعتبار توکن و نمایش پروفایل */
    public function me(): void
    {
        $user = Guard::requireUser();
        Response::ok(['user' => $user]);
    }
}

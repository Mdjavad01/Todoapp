<?php

declare(strict_types=1);

/**
 * کارام — نگهبان احراز هویت (Bearer Access Token)
 * هر مسیر /api/v1/* از این گذرگاه می‌گذرد و فقط به داده‌ی خود کاربر می‌رسد.
 */

final class Guard
{
    /** @var array|null کش درون‌درخواستی کاربر جاری */
    private static ?array $user = null;
    private static bool $resolved = false;

    /** کاربر جاری از روی توکن؛ نامعتبر = null */
    public static function user(): ?array
    {
        if (self::$resolved) {
            return self::$user;
        }
        self::$resolved = true;

        $payload = AccessToken::verify(Request::bearer());
        if ($payload === null) {
            return self::$user = null;
        }

        $stmt = Database::pdo()->prepare(
            'SELECT id, uuid, display_name, gender, status, premium_until FROM users WHERE uuid = :uuid LIMIT 1'
        );
        $stmt->execute([':uuid' => $payload['u']]);
        $row = $stmt->fetch();
        if ($row === false) {
            return self::$user = null;
        }
        if ($row['status'] !== 'active') {
            // کاربر مسدود یا حذف‌شده — حتی با توکن معتبر دسترسی ندارد
            return self::$user = null;
        }

        return self::$user = [
            'id' => (int) $row['id'],
            'uuid' => (string) $row['uuid'],
            'displayName' => $row['display_name'],
            'gender' => (string) ($row['gender'] ?? 'unset'),
            'premiumUntil' => $row['premium_until'],
        ];
    }

    /** مانند user() اما بدون توکن → پاسخ ۴۰۱ و پایان پردازش */
    public static function requireUser(): array
    {
        $user = self::user();
        if ($user === null) {
            Response::error('احراز هویت لازم است یا نشست منقضی شده است', 401, ['code' => 'unauthorized']);
            exit;
        }
        return $user;
    }
}

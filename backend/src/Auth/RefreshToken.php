<?php

declare(strict_types=1);

/**
 * کارام — توکن رفرش چرخشی در دیتابیس — فاز ۳
 *
 *  - مقدار خام فقط یک‌بار به کلاینت داده می‌شود؛ در دیتابیس فقط SHA-256 می‌نشیند.
 *  - چرخش: هر refresh توکن قبلی را باطل و توکن جدید صادر می‌کند.
 *  - تشخیص سرقت: استفاده‌ی دوباره از توکنِ باطل‌شده → باطل‌سازی همه‌ی توکن‌های آن کاربر.
 *  - هر توکن به یک دستگاه (device_id) گره خورده است تا مدیریت نشست‌ها ممکن باشد.
 */

final class RefreshToken
{
    public static function ttlDays(): int
    {
        return max(1, (int) (Config::get('REFRESH_TOKEN_TTL_DAYS', '180') ?? 180));
    }

    private static function hash(string $raw): string
    {
        return hash('sha256', $raw);
    }

    /**
     * صدور توکن جدید برای یک دستگاه.
     * @return array{token:string, expiresAt:string}
     */
    public static function issue(PDO $pdo, int $userId, string $deviceId, ?string $deviceName): array
    {
        $raw = bin2hex(random_bytes(32));
        $now = time();
        $stmt = $pdo->prepare(
            'INSERT INTO refresh_tokens (user_id, device_id, device_name, token_hash, expires_at, issued_at)
             VALUES (:uid, :dev, :name, :hash, :exp, :now)'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':dev' => $deviceId,
            ':name' => $deviceName !== null ? mb_substr($deviceName, 0, 120) : null,
            ':hash' => self::hash($raw),
            ':exp' => gmdate('Y-m-d H:i:s', $now + self::ttlDays() * 86400),
            ':now' => gmdate('Y-m-d H:i:s', $now),
        ]);
        return [
            'token' => $raw,
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $now + self::ttlDays() * 86400),
        ];
    }

    /**
     * چرخش توکن: توکن معتبر → باطل + توکن جدید.
     * @return array{userId:int, token:string, expiresAt:string}|null
     */
    public static function rotate(PDO $pdo, string $rawToken): ?array
    {
        $hash = self::hash($rawToken);
        $now = gmdate('Y-m-d H:i:s');

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'SELECT rt.id, rt.user_id, rt.revoked_at, rt.expires_at, u.status
                 FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
                 WHERE rt.token_hash = :h LIMIT 1'
            );
            $stmt->execute([':h' => $hash]);
            $row = $stmt->fetch();

            if ($row === false || $row['status'] !== 'active') {
                $pdo->rollBack();
                return null;
            }

            if ($row['revoked_at'] !== null) {
                // استفاده‌ی مجدد از توکن باطل‌شده = نشانه‌ی سرقت → همه باطل می‌شوند
                $pdo->prepare('UPDATE refresh_tokens SET revoked_at = :now WHERE user_id = :uid AND revoked_at IS NULL')
                    ->execute([':now' => $now, ':uid' => $row['user_id']]);
                error_log('[karam][security] تلاش برای استفاده‌ی مجدد از refresh token — همه‌ی نشست‌های کاربر ' . $row['user_id'] . ' باطل شد');
                $pdo->commit();
                return null;
            }

            if (strtotime((string) $row['expires_at']) < time()) {
                $pdo->prepare('UPDATE refresh_tokens SET revoked_at = :now WHERE id = :id')
                    ->execute([':now' => $now, ':id' => $row['id']]);
                $pdo->commit();
                return null;
            }

            $userId = (int) $row['user_id'];
            $stmtDev = $pdo->prepare('SELECT device_id, device_name FROM refresh_tokens WHERE id = :id');
            $stmtDev->execute([':id' => $row['id']]);
            $dev = (array) $stmtDev->fetch();

            $pdo->prepare('UPDATE refresh_tokens SET revoked_at = :revoked, last_used_at = :used WHERE id = :id')
                ->execute([':revoked' => $now, ':used' => $now, ':id' => $row['id']]);

            $fresh = self::issue($pdo, $userId, (string) ($dev['device_id'] ?? ''), $dev['device_name'] ?? null);

            $pdo->commit();
            return ['userId' => $userId, 'token' => $fresh['token'], 'expiresAt' => $fresh['expiresAt']];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** کاربرِ صاحب توکن (بدون چرخش — برای logout و مشخص‌کردن نشست جاری) */
    public static function findOwner(PDO $pdo, string $rawToken): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT rt.id, rt.user_id, rt.device_id, rt.revoked_at, rt.expires_at
             FROM refresh_tokens rt WHERE rt.token_hash = :h LIMIT 1'
        );
        $stmt->execute([':h' => self::hash($rawToken)]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        return [
            'id' => (int) $row['id'],
            'userId' => (int) $row['user_id'],
            'deviceId' => (string) $row['device_id'],
            'revoked' => $row['revoked_at'] !== null,
            'expired' => strtotime((string) $row['expires_at']) < time(),
        ];
    }

    public static function revoke(PDO $pdo, string $rawToken): bool
    {
        $stmt = $pdo->prepare(
            'UPDATE refresh_tokens SET revoked_at = :now WHERE token_hash = :h AND revoked_at IS NULL'
        );
        $stmt->execute([':now' => gmdate('Y-m-d H:i:s'), ':h' => self::hash($rawToken)]);
        return $stmt->rowCount() > 0;
    }

    public static function revokeById(PDO $pdo, int $userId, int $sessionId): bool
    {
        $stmt = $pdo->prepare(
            'UPDATE refresh_tokens SET revoked_at = :now WHERE id = :id AND user_id = :uid AND revoked_at IS NULL'
        );
        $stmt->execute([':now' => gmdate('Y-m-d H:i:s'), ':id' => $sessionId, ':uid' => $userId]);
        return $stmt->rowCount() > 0;
    }

    /** فهرست نشست‌های فعال کاربر (جدیدترین اول) */
    public static function listActive(PDO $pdo, int $userId): array
    {
        $stmt = $pdo->prepare(
            'SELECT id, device_id, device_name, issued_at, expires_at, last_used_at
             FROM refresh_tokens
             WHERE user_id = :uid AND revoked_at IS NULL AND expires_at > :now
             ORDER BY issued_at DESC'
        );
        $stmt->execute([':uid' => $userId, ':now' => gmdate('Y-m-d H:i:s')]);
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'deviceId' => (string) $r['device_id'],
            'deviceName' => $r['device_name'],
            'issuedAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $r['issued_at'])),
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $r['expires_at'])),
            'lastUsedAt' => $r['last_used_at'] !== null
                ? gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $r['last_used_at']))
                : null,
        ], (array) $stmt->fetchAll());
    }
}

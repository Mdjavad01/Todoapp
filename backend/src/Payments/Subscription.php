<?php

declare(strict_types=1);

/**
 * کارام — فعال‌سازی و وضعیت اشتراک (فاز ۵)
 *
 * اصل: اشتراک جدا از روش پرداخت است (جدول subscriptions با source مشخص).
 *  - source = 'web_gateway'  → پرداخت آنلاین درگاه (زیبال)
 *  - source = 'admin_grant'  → اعطای دستی از پنل
 *  - source = 'store_bazaar' → رزرو برای کافه‌بازار (نسخه‌ی اندروید آینده)
 *
 * تمدید همیشه از انتهای اعتبار فعلی محاسبه می‌شود؛ دائمی = سنتینل 9999 در
 * users.premium_until و NULL در subscriptions.expires_at (هم‌سو با اعطای ادمین).
 */
final class Subscription
{
    private const LIFETIME_SENTINEL = '9999-12-31 23:59:59';

    /**
     * فعال‌سازی/تمدید اشتراک کاربر پس از پرداخت موفق یا اعطای ادمین.
     * @return array{premiumUntil:string, expiresAt:?string, isLifetime:bool}
     */
    public static function activate(
        PDO $pdo,
        int $userId,
        ?int $planId,
        int $months, // 0 = دائمی
        ?int $orderId,
        string $source,
    ): array {
        $now = time();
        $stmt = $pdo->prepare('SELECT premium_until FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $current = $stmt->fetchColumn();

        $base = $now;
        if ($current !== false && $current !== null && (string) $current > gmdate('Y-m-d H:i:s')) {
            $base = max($base, strtotime((string) $current));
        }

        $isLifetime = $months === 0;
        if ($isLifetime) {
            $premiumUntil = self::LIFETIME_SENTINEL;
            $subExpires = null;
        } else {
            $premiumUntil = gmdate('Y-m-d H:i:s', $base + $months * 30 * 86400);
            $subExpires = $premiumUntil;
        }

        $pdo->prepare('UPDATE users SET premium_until = :pu WHERE id = :id')
            ->execute([':pu' => $premiumUntil, ':id' => $userId]);

        $pdo->prepare(
            "INSERT INTO subscriptions (uuid, user_id, plan_id, order_id, source, starts_at, expires_at, created_at, updated_at)
             VALUES (:uuid, :uid, :pid, :oid, :src, :start, :exp, :now, :now)"
        )->execute([
            ':uuid' => Uuid::v4(),
            ':uid' => $userId,
            ':pid' => $planId,
            ':oid' => $orderId,
            ':src' => $source,
            ':start' => gmdate('Y-m-d H:i:s', $now),
            ':exp' => $subExpires,
            ':now' => gmdate('Y-m-d H:i:s', $now),
        ]);

        return ['premiumUntil' => $premiumUntil, 'expiresAt' => $subExpires, 'isLifetime' => $isLifetime];
    }

    /**
     * وضعیت پرو کاربر — برای اپ و نمایش «اشتراک من».
     * @return array{isPremium:bool, premiumUntil:?string, daysLeft:?int, lifetime:bool, plan:?array{code:string,title:string}, source:?string, expiresAt:?string}
     */
    public static function statusFor(PDO $pdo, int $userId): array
    {
        $now = gmdate('Y-m-d H:i:s');
        $stmt = $pdo->prepare('SELECT premium_until FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $premiumUntil = $stmt->fetchColumn();

        $isPremium = $premiumUntil !== false && $premiumUntil !== null && (string) $premiumUntil > $now;
        $lifetime = $isPremium && (string) $premiumUntil >= self::LIFETIME_SENTINEL;

        $plan = null;
        $source = null;
        $expiresAt = null;
        $subStmt = $pdo->prepare(
            'SELECT s.source, s.expires_at, p.code, p.title
             FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = :id
             ORDER BY s.id DESC LIMIT 1'
        );
        $subStmt->execute([':id' => $userId]);
        $sub = $subStmt->fetch();
        if ($sub !== false) {
            $source = (string) $sub['source'];
            $expiresAt = $sub['expires_at'] !== null ? (string) $sub['expires_at'] : null;
            if ($sub['code'] !== null) {
                $plan = ['code' => (string) $sub['code'], 'title' => (string) $sub['title']];
            }
        }

        $daysLeft = null;
        if ($isPremium && !$lifetime && $premiumUntil !== null) {
            $daysLeft = (int) max(0, ceil((strtotime((string) $premiumUntil) - time()) / 86400));
        }

        return [
            'isPremium' => $isPremium,
            'premiumUntil' => $premiumUntil !== false && $premiumUntil !== null ? (string) $premiumUntil : null,
            'daysLeft' => $daysLeft,
            'lifetime' => $lifetime,
            'plan' => $plan,
            'source' => $source,
            'expiresAt' => $expiresAt,
        ];
    }
}

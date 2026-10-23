<?php

declare(strict_types=1);

/**
 * کارام — ثبت رخدادهای حساس در audit_logs — فاز ۴
 * هر عمل مدیریتی (ورود، مسدودسازی، اعطای پرو، تغییر تنظیمات و ...)
 * با بازیگر، موجودیت، جزئیات، IP و User-Agent ثبت می‌شود.
 */

final class Audit
{
    public static function log(
        string $actorType,
        ?int $actorId,
        string $action,
        ?string $entity = null,
        ?string $entityId = null,
        ?array $details = null,
    ): void {
        try {
            $stmt = Database::pdo()->prepare(
                'INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, details, ip, user_agent, created_at)
                 VALUES (:at, :aid, :action, :entity, :eid, :details, :ip, :ua, :now)'
            );
            $stmt->execute([
                ':at' => $actorType,
                ':aid' => $actorId,
                ':action' => $action,
                ':entity' => $entity,
                ':eid' => $entityId,
                ':details' => $details !== null ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                ':ip' => Request::ip(),
                ':ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                ':now' => gmdate('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $e) {
            // لاگ نباید جریان اصلی را بشکند — فقط در لاگ سرور می‌رود
            error_log('[karam-audit] ' . $e->getMessage());
        }
    }

    /** میان‌بر برای اکشن‌های ادمین */
    public static function admin(int $adminId, string $action, ?string $entity = null, ?string $entityId = null, ?array $details = null): void
    {
        self::log('admin', $adminId, $action, $entity, $entityId, $details);
    }
}

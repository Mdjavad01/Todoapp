<?php

declare(strict_types=1);

/**
 * کارام — اطلاعیه‌های فعال برای اپ کاربر (فاز ۹ — بنر تبلیغاتی صفحه‌ی خانه)
 *
 *  GET /api/v1/announcements/active  → حداکثر ۳ اطلاعیه‌ی فعال (عمومی — بدون احراز)
 *
 * عمومی است تا مهمان‌ها هم بنر تبلیغ را ببینند؛ فقط رکوردهای is_active=1 که
 * پنجره‌ی زمانی‌شان (starts_at/ends_at) شامل الان باشد برمی‌گردند و فیلدهای
 * مدیریتی (is_active، شناسه‌ی داخلی) افشا نمی‌شود.
 */
final class AnnouncementController
{
    /** GET /api/v1/announcements/active */
    public function active(): void
    {
        AnnouncementsSchema::ensure();

        $now = gmdate('Y-m-d H:i:s');
        // ⚠️ با EMULATE_PREPARES=false هر placeholder باید نام یکتا داشته باشد؛
        // استفاده‌ی دوباره از :now خطای HY093 و پاسخ ۵۰۰ می‌داد (باگ v15).
        $stmt = Database::pdo()->prepare(
            "SELECT uuid, title, body, type, link_url, image_url, created_at
             FROM announcements
             WHERE is_active = 1
               AND (starts_at IS NULL OR starts_at <= :now_from)
               AND (ends_at IS NULL OR ends_at >= :now_to)
             ORDER BY created_at DESC, id DESC
             LIMIT 3"
        );
        $stmt->execute([':now_from' => $now, ':now_to' => $now]);

        $items = [];
        foreach ($stmt->fetchAll() as $r) {
            $items[] = [
                'uuid' => (string) $r['uuid'],
                'title' => (string) $r['title'],
                'body' => (string) $r['body'],
                'type' => (string) $r['type'],
                'linkUrl' => $r['link_url'] !== null ? (string) $r['link_url'] : null,
                'imageUrl' => $r['image_url'] !== null ? (string) $r['image_url'] : null,
                'createdAt' => (string) $r['created_at'],
            ];
        }

        Response::ok(['items' => $items]);
    }
}

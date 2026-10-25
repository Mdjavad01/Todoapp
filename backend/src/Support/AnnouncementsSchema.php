<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار اسکیمای اطلاعیه‌ها/تبلیغات (فاز ۹ — v0.8)
 *
 * چرا اینجا؟ کاربر zip را در public_html استخراج می‌کند و به phpMyAdmin دسترسی
 * راحتی ندارد؛ پس افزودن ستون‌های لینک و تصویر بنر هم مثل کارت‌به‌کارت «بی‌صدا و
 * تکرارپذیر» بار اولی که یکی از مسیرهای اطلاعیه صدا زده می‌شود انجام می‌شود.
 *
 *  - جدول announcements اگر نبود ساخته می‌شود (نصب تازه‌ی دستی)
 *  - ستون‌های link_url و image_url اگر نبودند اضافه می‌شوند (بنر تبلیغاتی اپ)
 *
 * همیشه try/catch — اگر دیتابیس آماده نبود، هیچ مسیری نباید بخوابد؛
 * خطا در لاگ سرور ثبت و درخواست به‌صورت عادی ادامه می‌یابد.
 */
final class AnnouncementsSchema
{
    private static bool $done = false;

    public static function ensure(): void
    {
        if (self::$done) {
            return;
        }
        self::$done = true;

        try {
            $pdo = Database::pdo();
            $mysql = Database::driver() === 'mysql';

            // ۱) جدول در نبودِ نصبِ دستیِ جدید — با ستون‌های جدید از ابتدا
            if ($mysql) {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS `announcements` (
                        `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        `uuid`       CHAR(36)     NOT NULL,
                        `title`      VARCHAR(150) NOT NULL,
                        `body`       TEXT         NOT NULL,
                        `type`       ENUM('info','warning','premium') NOT NULL DEFAULT 'info',
                        `link_url`   VARCHAR(500) NULL DEFAULT NULL COMMENT 'لینک دکمه‌ی بنر (اختیاری)',
                        `image_url`  VARCHAR(500) NULL DEFAULT NULL COMMENT 'تصویر/GIF بنر — فقط همان دامنه (اختیاری)',
                        `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
                        `starts_at`  DATETIME     NULL DEFAULT NULL,
                        `ends_at`    DATETIME     NULL DEFAULT NULL,
                        `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `uq_announcements_uuid` (`uuid`),
                        KEY `idx_announcements_active` (`is_active`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                );
            } else {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS announcements (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        uuid       TEXT(36) NOT NULL UNIQUE,
                        title      TEXT(150) NOT NULL,
                        body       TEXT NOT NULL,
                        type       TEXT(8) NOT NULL DEFAULT 'info',
                        link_url   TEXT(500),
                        image_url  TEXT(500),
                        is_active  INTEGER NOT NULL DEFAULT 1,
                        starts_at  TEXT(19),
                        ends_at    TEXT(19),
                        created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
                        updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
                    )"
                );
            }

            // ۲) ستون‌های جدید برای نصب‌های قدیمی‌تر
            foreach (['link_url' => 'TEXT', 'image_url' => 'TEXT'] as $col => $type) {
                if ($mysql) {
                    $exists = $pdo->prepare("SHOW COLUMNS FROM `announcements` LIKE :c");
                    $exists->execute([':c' => $col]);
                    if ($exists->fetch() === false) {
                        $pdo->exec("ALTER TABLE `announcements` ADD COLUMN `{$col}` VARCHAR(500) NULL DEFAULT NULL");
                    }
                } else {
                    $cols = $pdo->query('PRAGMA table_info(announcements)')->fetchAll();
                    $names = [];
                    foreach ($cols as $c) {
                        $names[] = (string) $c['name'];
                    }
                    if (!in_array($col, $names, true)) {
                        $pdo->exec("ALTER TABLE announcements ADD COLUMN {$col} {$type}(500) NULL");
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('[karam][announcements] مهاجرت اسکیمای اطلاعیه‌ها ناموفق: ' . $e->getMessage());
        }
    }
}

<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار کد هدیه (v20 — گام ۲۰ رشد)
 *
 * جدول `coupons` از فاز ۵ در اسکیما بوده و دقیقاً برای همین روز ساخته شده بود —
 * این مهاجرت همان را به کار می‌گیرد (بدون ساخت جدول موازی):
 *   ۱) جدول coupons (اگر نصب خیلی قدیمی نداشت — CREATE IF NOT EXISTS با همان شکل)
 *   ۲) جدول coupon_redemptions (ژورنال استفاده — هر کاربر هر کد فقط یک‌بار)
 *   ۳) deposit_requests: ستون coupon_id + discount_tomans (تخفیف کارت‌به‌کارت؛
 *      سفارش درگاه از قبل ستون coupon_id دارد)
 *   ۴) کلید تنظیمات gift_codes_enabled (پیش‌فرض: روشن — تا ساخت کد از بلافاصله کار کند)
 *      + مهاجرت خودکار مقدار کلید قدیمی gift_enabled (v20) به نام جدید — مقدار ادمین حفظ می‌شود.
 *
 * واحد پول (فاز تومان): ستون‌های تخفیف «تومان» هستند؛ روی نصب‌های قدیمیِ ریالی،
 * ستون discount_rials خودکار (÷۱۰) به discount_tomans تبدیل و حذف می‌شود — مسیر دستی
 * معادل آن deploy/upgrade-v1.8.sql است.
 *
 * همیشه try/catch — اگر دیتابیس آماده نبود هیچ مسیری نباید بخوابد.
 */
final class GiftSchema
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
            $now = gmdate('Y-m-d H:i:s');

            // ۱) جدول کدها — همان شکل فاز ۵ (برای نصب‌های بسیار قدیمی هم امن است)
            if ($mysql) {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS `coupons` (
                        `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        `uuid`       CHAR(36)    NOT NULL,
                        `code`       VARCHAR(50) NOT NULL,
                        `type`       ENUM('percent','amount') NOT NULL,
                        `value`      INT         NOT NULL COMMENT 'درصد یا مبلغ ثابت به تومان (فاز تومان)',
                        `expires_at` DATETIME    NULL DEFAULT NULL,
                        `max_uses`   INT         NULL DEFAULT NULL,
                        `used_count` INT         NOT NULL DEFAULT 0,
                        `is_active`  TINYINT(1)  NOT NULL DEFAULT 1,
                        `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `uq_coupons_code` (`code`),
                        UNIQUE KEY `uq_coupons_uuid` (`uuid`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                );
            } else {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS coupons (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        uuid       TEXT(36) NOT NULL UNIQUE,
                        code       TEXT(50) NOT NULL UNIQUE,
                        type       TEXT(8) NOT NULL,
                        value      INTEGER NOT NULL,
                        expires_at TEXT(19),
                        max_uses   INTEGER,
                        used_count INTEGER NOT NULL DEFAULT 0,
                        is_active  INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT(19) NOT NULL,
                        updated_at TEXT(19) NOT NULL
                    )"
                );
            }

            // ۲) جدول ژورنال استفاده‌ها — هر کاربر هر کد فقط یک‌بار (UNIQUE)
            if ($mysql) {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS `coupon_redemptions` (
                        `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        `uuid`           CHAR(36) NOT NULL,
                        `coupon_id`      BIGINT UNSIGNED NOT NULL,
                        `user_id`        BIGINT UNSIGNED NOT NULL,
                        `kind`           ENUM('order','deposit') NOT NULL COMMENT 'سفارش درگاه یا واریز کارت‌به‌کارت',
                        `reference_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
                        `discount_tomans` BIGINT  NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (تومان — فاز تومان)',
                        `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `uq_coupon_redemption` (`coupon_id`,`user_id`),
                        KEY `idx_coupon_red_user` (`user_id`),
                        CONSTRAINT `fk_coupon_red_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`),
                        CONSTRAINT `fk_coupon_red_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                );
            } else {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS coupon_redemptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        uuid TEXT(36) NOT NULL,
                        coupon_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        kind TEXT(8) NOT NULL,
                        reference_id INTEGER NULL,
                        discount_tomans INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME NOT NULL
                    )"
                );
                $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_coupon_redemption ON coupon_redemptions (coupon_id, user_id)');
                $pdo->exec('CREATE INDEX IF NOT EXISTS idx_coupon_red_user ON coupon_redemptions (user_id)');
            }

            // ۲.۵) مهاجرت واحد پول جدول ژورنال: discount_rials قدیمی → discount_tomans (÷۱۰)
            if ($mysql) {
                $hasR = is_array($pdo->query("SHOW COLUMNS FROM `coupon_redemptions` LIKE 'discount_rials'")->fetch());
                $hasT = is_array($pdo->query("SHOW COLUMNS FROM `coupon_redemptions` LIKE 'discount_tomans'")->fetch());
                if ($hasR && !$hasT) {
                    $pdo->exec("ALTER TABLE `coupon_redemptions` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (تومان)'");
                    $pdo->exec('UPDATE `coupon_redemptions` SET `discount_tomans` = ROUND(`discount_rials` / 10)');
                    $pdo->exec('ALTER TABLE `coupon_redemptions` DROP COLUMN `discount_rials`');
                } elseif (!$hasR && !$hasT) {
                    $pdo->exec("ALTER TABLE `coupon_redemptions` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (تومان)'");
                }
            } else {
                $rcols = [];
                foreach ($pdo->query('PRAGMA table_info(coupon_redemptions)')->fetchAll() as $c) {
                    $rcols[] = (string) $c['name'];
                }
                if (in_array('discount_rials', $rcols, true) && !in_array('discount_tomans', $rcols, true)) {
                    $pdo->exec('ALTER TABLE coupon_redemptions ADD COLUMN discount_tomans INTEGER NOT NULL DEFAULT 0');
                    $pdo->exec('UPDATE coupon_redemptions SET discount_tomans = CAST(ROUND(discount_rials / 10) AS INTEGER)');
                    $pdo->exec('ALTER TABLE coupon_redemptions DROP COLUMN discount_rials');
                } elseif (!in_array('discount_tomans', $rcols, true)) {
                    $pdo->exec('ALTER TABLE coupon_redemptions ADD COLUMN discount_tomans INTEGER NOT NULL DEFAULT 0');
                }
            }

            // ۳) ستون‌های واریز کارت‌به‌کارت (سفارش درگاه از فاز ۵ coupon_id دارد)
            //    مهاجرت واحد پول: discount_rials قدیمی → discount_tomans (÷۱۰) و حذف ستون قدیمی
            if ($mysql) {
                $hasCoupon = is_array($pdo->query("SHOW COLUMNS FROM `deposit_requests` LIKE 'coupon_id'")->fetch());
                $hasTomans = is_array($pdo->query("SHOW COLUMNS FROM `deposit_requests` LIKE 'discount_tomans'")->fetch());
                $hasRials = is_array($pdo->query("SHOW COLUMNS FROM `deposit_requests` LIKE 'discount_rials'")->fetch());
                if ($hasRials && !$hasTomans) {
                    $pdo->exec("ALTER TABLE `deposit_requests` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (تومان)'");
                    $pdo->exec('UPDATE `deposit_requests` SET `discount_tomans` = ROUND(`discount_rials` / 10)');
                    $pdo->exec('ALTER TABLE `deposit_requests` DROP COLUMN `discount_rials`');
                    $hasTomans = true;
                    $hasRials = false;
                }
                if (!$hasCoupon || !$hasTomans) {
                    $add = [];
                    if (!$hasCoupon) {
                        $add[] = "ADD COLUMN `coupon_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'کد هدیه اعمال‌شده'";
                    }
                    if (!$hasTomans) {
                        $add[] = "ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (تومان)'";
                    }
                    $pdo->exec('ALTER TABLE `deposit_requests` ' . implode(', ', $add));
                }
            } else {
                $cols = [];
                foreach ($pdo->query('PRAGMA table_info(deposit_requests)')->fetchAll() as $c) {
                    $cols[] = (string) $c['name'];
                }
                if (in_array('discount_rials', $cols, true) && !in_array('discount_tomans', $cols, true)) {
                    $pdo->exec('ALTER TABLE deposit_requests ADD COLUMN discount_tomans INTEGER NOT NULL DEFAULT 0');
                    $pdo->exec('UPDATE deposit_requests SET discount_tomans = CAST(ROUND(discount_rials / 10) AS INTEGER)');
                    $pdo->exec('ALTER TABLE deposit_requests DROP COLUMN discount_rials');
                    $cols[] = 'discount_tomans';
                }
                if (!in_array('coupon_id', $cols, true)) {
                    $pdo->exec('ALTER TABLE deposit_requests ADD COLUMN coupon_id INTEGER NULL');
                }
                if (!in_array('discount_tomans', $cols, true)) {
                    $pdo->exec('ALTER TABLE deposit_requests ADD COLUMN discount_tomans INTEGER NOT NULL DEFAULT 0');
                }
            }

            // ۴) کلید تنظیمات (پیش‌فرض روشن — کد فقط وقتی اثر دارد که ادمین ساخته باشد)
            //    مهاجرت خودکار نام کلید: gift_enabled (v20) → gift_codes_enabled (بعد از آن)
            //    — مقدار قبلی (روشن/خاموش ادمین) حفظ می‌شود؛ تکرارش بی‌اثر است.
            $pdo->exec("UPDATE settings SET `key` = 'gift_codes_enabled' WHERE `key` = 'gift_enabled'");
            if ($mysql) {
                $stmt = $pdo->prepare(
                    'INSERT IGNORE INTO `settings` (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)'
                );
            } else {
                $stmt = $pdo->prepare(
                    'INSERT OR IGNORE INTO settings (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)'
                );
            }
            $stmt->execute([':k' => 'gift_codes_enabled', ':v' => '1', ':now' => $now]);
        } catch (Throwable $e) {
            error_log('[karam][gift] مهاجرت اسکیمای کد هدیه ناموفق: ' . $e->getMessage());
        }
    }
}

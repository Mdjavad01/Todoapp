<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار اسکیمای کارت‌به‌کارت (فاز ۸ — v0.7)
 *
 * چرا اینجا؟ نصبِ کارام روی هاست اشتراکی فقط با آپلود zip انجام می‌شود و کاربر
 * به phpMyAdmin دسترسی راحتی ندارد. پس ساخت جدول و افزودن مقدار جدید به ENUM
 * بار اولی که یکی از مسیرهای واریز صدا زده می‌شود، بی‌صدا و تکرارپذیر انجام می‌شود.
 *
 * هزینه: فقط روی مسیرهای واریزی صدا زده می‌شود (config/create/mine + ادمین)؛
 * بقیه‌ی ترافیک API حتی یک کوئری اضافه هم نمی‌بیند.
 *
 * همیشه try/catch — اگر دیتابیس آماده نبود، هیچ مسیری نباید بخوابد؛
 * خطا در لاگ سرور ثبت و درخواست به‌صورت عادی ادامه می‌یابد.
 */
final class DepositSchema
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

            // ۱) جدول درخواست‌های واریز کارت‌به‌کارت
            if ($mysql) {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS `deposit_requests` (
                        `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        `uuid`            CHAR(36)  NOT NULL,
                        `user_id`         BIGINT UNSIGNED NOT NULL,
                        `plan_id`         BIGINT UNSIGNED NULL DEFAULT NULL,
                        `plan_code`       VARCHAR(50) NOT NULL,
                        `amount_rials`    BIGINT    NOT NULL DEFAULT 0,
                        `reference`       VARCHAR(64) NOT NULL COMMENT 'شماره پیگیری/مرجع حواله کاربر',
                        `note`            VARCHAR(500) NULL,
                        `status`          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
                        `review_note`     VARCHAR(500) NULL COMMENT 'یادداشت ادمین / دلیل رد',
                        `reviewed_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
                        `reviewed_at`     DATETIME  NULL DEFAULT NULL,
                        `subscription_id` BIGINT UNSIGNED NULL DEFAULT NULL,
                        `created_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        `updated_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `uq_deposit_uuid` (`uuid`),
                        KEY `idx_deposit_user` (`user_id`,`status`),
                        KEY `idx_deposit_status` (`status`,`created_at`),
                        CONSTRAINT `fk_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
                        CONSTRAINT `fk_deposit_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                );
            } else {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS deposit_requests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        uuid TEXT(36) NOT NULL,
                        user_id INTEGER NOT NULL,
                        plan_id INTEGER NULL,
                        plan_code TEXT(50) NOT NULL,
                        amount_rials INTEGER NOT NULL DEFAULT 0,
                        reference TEXT(64) NOT NULL,
                        note TEXT(500) NULL,
                        status TEXT(16) NOT NULL DEFAULT 'pending',
                        review_note TEXT(500) NULL,
                        reviewed_by INTEGER NULL,
                        reviewed_at DATETIME NULL,
                        subscription_id INTEGER NULL,
                        created_at DATETIME NOT NULL,
                        updated_at DATETIME NOT NULL
                    )"
                );
                $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_uuid ON deposit_requests (uuid)');
                $pdo->exec('CREATE INDEX IF NOT EXISTS idx_deposit_user ON deposit_requests (user_id, status)');
                $pdo->exec('CREATE INDEX IF NOT EXISTS idx_deposit_status ON deposit_requests (status, created_at)');
            }

            // ۲) MySQL: مقدار 'card_deposit' به ENUM source جدول subscriptions
            if ($mysql) {
                $col = $pdo->query("SHOW COLUMNS FROM `subscriptions` LIKE 'source'")->fetch();
                $type = is_array($col) ? (string) ($col['Type'] ?? '') : '';
                if ($type !== '' && !str_contains($type, 'card_deposit')) {
                    $pdo->exec(
                        "ALTER TABLE `subscriptions` MODIFY `source`
                         ENUM('web_gateway','admin_grant','store_bazaar','card_deposit')
                         NOT NULL COMMENT 'منبع فعال‌سازی: درگاه / اعطای ادمین / بازار / کارت‌به‌کارت'"
                    );
                }
            }

            // ۳) کلیدهای تنظیمات کارت‌به‌کارت (فقط اگر وجود نداشته باشند)
            $guide = 'مبلغ دقیق همان پلن انتخابی است. بعد از واریز، شماره پیگیری حواله را ثبت کنید؛ '
                . 'معمولاً کمتر از ۱۲ ساعت بررسی و اشتراک فعال می‌شود.';
            $keys = [
                'deposit_card_enabled' => '0',
                'deposit_card_number' => '',
                'deposit_card_holder' => '',
                'deposit_card_guide' => $guide,
            ];
            if ($mysql) {
                $stmt = $pdo->prepare(
                    'INSERT IGNORE INTO `settings` (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)'
                );
            } else {
                $stmt = $pdo->prepare(
                    'INSERT OR IGNORE INTO settings (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)'
                );
            }
            foreach ($keys as $k => $v) {
                $stmt->execute([':k' => $k, ':v' => $v, ':now' => $now]);
            }
        } catch (Throwable $e) {
            error_log('[karam][deposit] مهاجرت اسکیمای کارت‌به‌کارت ناموفق: ' . $e->getMessage());
        }
    }
}

<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار دعوت دوستان / رفرال (v20 — گام ۲۰ رشد)
 *
 * همان الگوی DepositSchema/TrialSchema: نصب روی هاست اشتراکی فقط با آپلود zip
 * انجام می‌شود؛ پس مهاجرت بار اولی که یکی از مسیرهای رفرال صدا زده می‌شود،
 * بی‌صدا و تکرارپذیر انجام می‌شود:
 *   ۱) users: ستون referral_code (کد یکتای دعوت هر کاربر) + referred_by (دعوت‌کننده)
 *   ۲) MySQL: مقدار 'referral' به ENUM source جدول subscriptions اضافه می‌شود
 *   ۳) کلیدهای تنظیمات (referral_enabled / referral_days) ساخته می‌شوند
 *
 * هزینه: فقط روی مسیرهای رفرال (GET/POST /api/v1/me/referral) صدا زده می‌شود؛
 * بقیه‌ی ترافیک API حتی یک کوئری اضافه هم نمی‌بیند (فلاگ استاتیک درون‌درخواستی).
 *
 * همیشه try/catch — اگر دیتابیس آماده نبود هیچ مسیری نباید بخوابد؛
 * خطا در لاگ سرور ثبت و مسیر عادی (بدون رفرال) ادامه می‌یابد.
 */
final class ReferralSchema
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

            // ۱) ستون‌های users (کد دعوت + دعوت‌کننده)
            if ($mysql) {
                $col = $pdo->query("SHOW COLUMNS FROM `users` LIKE 'referral_code'")->fetch();
                if (!is_array($col)) {
                    $pdo->exec(
                        "ALTER TABLE `users`
                         ADD COLUMN `referral_code` VARCHAR(12) NULL DEFAULT NULL COMMENT 'کد یکتای دعوت کاربر',
                         ADD COLUMN `referred_by` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'شناسه‌ی دعوت‌کننده',
                         ADD UNIQUE KEY `uq_users_referral_code` (`referral_code`),
                         ADD KEY `idx_users_referred_by` (`referred_by`)"
                    );
                }
            } else {
                $cols = [];
                foreach ($pdo->query('PRAGMA table_info(users)')->fetchAll() as $c) {
                    $cols[] = (string) $c['name'];
                }
                if (!in_array('referral_code', $cols, true)) {
                    $pdo->exec('ALTER TABLE users ADD COLUMN referral_code TEXT(12) NULL');
                    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_referral_code ON users (referral_code)');
                }
                if (!in_array('referred_by', $cols, true)) {
                    $pdo->exec('ALTER TABLE users ADD COLUMN referred_by INTEGER NULL');
                    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by)');
                }
            }

            // ۲) MySQL: مقدار 'referral' به ENUM source جدول subscriptions
            if ($mysql) {
                $col = $pdo->query("SHOW COLUMNS FROM `subscriptions` LIKE 'source'")->fetch();
                $type = is_array($col) ? (string) ($col['Type'] ?? '') : '';
                if ($type !== '' && !str_contains($type, "'referral'")) {
                    $pdo->exec(
                        "ALTER TABLE `subscriptions` MODIFY `source`
                         ENUM('web_gateway','admin_grant','store_bazaar','card_deposit','trial','referral')
                         NOT NULL COMMENT 'منبع فعال‌سازی: درگاه / ادمین / بازار / کارت‌به‌کارت / آزمایشی / دعوت دوست'"
                    );
                }
            }

            // ۳) کلیدهای تنظیمات رفرال (فقط اگر وجود نداشته باشند — پیش‌فرض: خاموش)
            $keys = [
                'referral_enabled' => '0',
                'referral_days' => '7',
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
            error_log('[karam][referral] مهاجرت اسکیمای دعوت دوستان ناموفق: ' . $e->getMessage());
        }
    }
}

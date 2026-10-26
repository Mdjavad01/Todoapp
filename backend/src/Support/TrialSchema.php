<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار دوره آزمایشی (v18 — v1.0)
 *
 * همان الگوی DepositSchema: نصبِ کارام روی هاست اشتراکی فقط با آپلود zip انجام
 * می‌شود و کاربر به phpMyAdmin دسترسی راحتی ندارد. پس دو کار کوچک بار اولی که
 * فعال‌سازی آزمایشی صدا زده می‌شود، بی‌صدا و تکرارپذیر انجام می‌شود:
 *   ۱) MySQL: مقدار 'trial' به ENUM source جدول subscriptions اضافه می‌شود
 *   ۲) کلیدهای تنظیمات (trial_enabled / trial_days) ساخته می‌شوند
 *
 * هزینه: فقط روی مسیر ثبت‌نامِ کاربر جدید با آزمایشیِ روشن صدا زده می‌شود —
 * بقیه‌ی ترافیک API حتی یک کوئری اضافه هم نمی‌بیند (فلاگ استاتیک درون‌درخواستی).
 *
 * همیشه try/catch — اگر دیتابیس آماده نبود، هیچ مسیری نباید بخوابد؛
 * خطا در لاگ سرور ثبت و ثبت‌نام به‌صورت عادی (بدون دوره آزمایشی) ادامه می‌یابد.
 */
final class TrialSchema
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

            // ۱) MySQL: مقدار 'trial' به ENUM source جدول subscriptions
            if ($mysql) {
                $col = $pdo->query("SHOW COLUMNS FROM `subscriptions` LIKE 'source'")->fetch();
                $type = is_array($col) ? (string) ($col['Type'] ?? '') : '';
                if ($type !== '' && !str_contains($type, "'trial'")) {
                    $pdo->exec(
                        "ALTER TABLE `subscriptions` MODIFY `source`
                         ENUM('web_gateway','admin_grant','store_bazaar','card_deposit','trial')
                         NOT NULL COMMENT 'منبع فعال‌سازی: درگاه / اعطای ادمین / بازار / کارت‌به‌کارت / دوره آزمایشی'"
                    );
                }
            }

            // ۲) کلیدهای تنظیمات دوره آزمایشی (فقط اگر وجود نداشته باشند — پیش‌فرض: خاموش)
            $keys = [
                'trial_enabled' => '0',
                'trial_days' => '7',
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
            error_log('[karam][trial] مهاجرت اسکیمای دوره آزمایشی ناموفق: ' . $e->getMessage());
        }
    }
}

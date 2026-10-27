<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار اسکیمای تکرار/ستاره (فاز ۳ — فلوی افزودن و جزئیات کار)
 *
 * سه کار روی جدول tasks (هر دو موتور MySQL/SQLite):
 *   ۱) ستون starred (TINYINT/INTEGER) — ستاره‌ی «مهم»
 *   ۲) ستون repeat_meta (TEXT) — تنظیم تکرار سفارشی (JSON)
 *   ۳) گسترش enum ستون repeat به ('none','daily','workdays','weekly','monthly','yearly','custom')
 *
 * این مهاجرت تکرارپذیر است (چند بار اجرا بی‌ضرر) و همیشه try/catch —
 * اگر دیتابیس آماده نبود هیچ مسیری نباید بخوابد. معادل دستی: deploy/upgrade-v1.7.sql
 */
final class TaskSchema
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

            if ($mysql) {
                $hasStarred = is_array($pdo->query("SHOW COLUMNS FROM `tasks` LIKE 'starred'")->fetch());
                $hasMeta = is_array($pdo->query("SHOW COLUMNS FROM `tasks` LIKE 'repeat_meta'")->fetch());
                if (!$hasStarred || !$hasMeta) {
                    $add = [];
                    if (!$hasStarred) {
                        $add[] = "ADD COLUMN `starred` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'ستاره‌ی «مهم» (فاز ۳)'";
                    }
                    if (!$hasMeta) {
                        $add[] = "ADD COLUMN `repeat_meta` TEXT NULL DEFAULT NULL COMMENT 'تنظیم تکرار سفارشی JSON (فاز ۳)'";
                    }
                    $pdo->exec('ALTER TABLE `tasks` ' . implode(', ', $add));
                }

                // گسترش enum تکرار — فقط وقتی مقدار جدید در تعریف نباشد (تکرارپذیر)
                $colType = '';
                $stmt = $pdo->query(
                    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'repeat'
                     LIMIT 1"
                );
                if ($stmt !== false) {
                    $row = $stmt->fetch();
                    if (is_array($row) && isset($row['COLUMN_TYPE'])) {
                        $colType = (string) $row['COLUMN_TYPE'];
                    }
                }
                if ($colType !== '' && !str_contains($colType, 'workdays')) {
                    $pdo->exec(
                        "ALTER TABLE `tasks` MODIFY `repeat` ENUM('none','daily','workdays','weekly','monthly','yearly','custom') NOT NULL DEFAULT 'none'"
                    );
                }
            } else {
                $cols = [];
                foreach ($pdo->query('PRAGMA table_info(tasks)')->fetchAll() as $c) {
                    $cols[] = (string) $c['name'];
                }
                if (!in_array('starred', $cols, true)) {
                    $pdo->exec('ALTER TABLE tasks ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
                }
                if (!in_array('repeat_meta', $cols, true)) {
                    $pdo->exec('ALTER TABLE tasks ADD COLUMN repeat_meta TEXT NULL');
                }
                // SQLite ستون repeat از نوع TEXT است — نیازی به تغییر ندارد
            }
        } catch (Throwable $e) {
            error_log('[karam][task-schema] مهاجرت اسکیمای تکرار/ستاره ناموفق: ' . $e->getMessage());
        }
    }
}

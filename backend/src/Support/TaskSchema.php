<?php

declare(strict_types=1);

/**
 * کارام — مهاجرت خودکار اسکیمای زمان‌اجرای سینک (فاز ۳ + فاز تریدر)
 *
 * پنج کار روی جدول tasks و یک کار روی جدول lists (هر دو موتور MySQL/SQLite):
 *   ۱) ستون starred (TINYINT/INTEGER) — ستاره‌ی «مهم»
 *   ۲) ستون repeat_meta (TEXT) — تنظیم تکرار سفارشی (JSON)
 *   ۳) گسترش enum ستون repeat به ('none','daily','workdays','weekly','monthly','yearly','custom')
 *   ۴) ستون item_type (VARCHAR) — نوع آیتم چک‌لیست تریدر (فاز تریدر)
 *   ۵) ستون item_value (VARCHAR) — مقدار آیتم (فاز تریدر)
 *   ۶) ستون lists.pinned (TINYINT/INTEGER) — لیست پین‌شده (فاز تریدر)
 *
 * این مهاجرت تکرارپذیر است (چند بار اجرا بی‌ضرر) و همیشه try/catch —
 * اگر دیتابیس آماده نبود هیچ مسیری نباید بخوابد. معادل دستی: deploy/upgrade-v1.7.sql و deploy/upgrade-v1.9.1.sql
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
                $hasItemType = is_array($pdo->query("SHOW COLUMNS FROM `tasks` LIKE 'item_type'")->fetch());
                $hasItemValue = is_array($pdo->query("SHOW COLUMNS FROM `tasks` LIKE 'item_value'")->fetch());
                $hasPinned = is_array($pdo->query("SHOW COLUMNS FROM `lists` LIKE 'pinned'")->fetch());
                $add = [];
                if (!$hasStarred) {
                    $add[] = "ADD COLUMN `starred` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'ستاره‌ی «مهم» (فاز ۳)'";
                }
                if (!$hasMeta) {
                    $add[] = "ADD COLUMN `repeat_meta` TEXT NULL DEFAULT NULL COMMENT 'تنظیم تکرار سفارشی JSON (فاز ۳)'";
                }
                if (!$hasItemType) {
                    $add[] = "ADD COLUMN `item_type` VARCHAR(16) NULL DEFAULT NULL COMMENT 'نوع آیتم چک‌لیست تریدر (فاز تریدر)'";
                }
                if (!$hasItemValue) {
                    $add[] = "ADD COLUMN `item_value` VARCHAR(255) NULL DEFAULT NULL COMMENT 'مقدار آیتم — عدد/انتخاب/امتیاز (فاز تریدر)'";
                }
                if (count($add) > 0) {
                    $pdo->exec('ALTER TABLE `tasks` ' . implode(', ', $add));
                }
                if (!$hasPinned) {
                    $pdo->exec(
                        "ALTER TABLE `lists` ADD COLUMN `pinned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'لیست پین‌شده — همیشه بالای فهرست (فاز تریدر)'"
                    );
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
                if (!in_array('item_type', $cols, true)) {
                    $pdo->exec('ALTER TABLE tasks ADD COLUMN item_type TEXT NULL');
                }
                if (!in_array('item_value', $cols, true)) {
                    $pdo->exec('ALTER TABLE tasks ADD COLUMN item_value TEXT NULL');
                }
                // SQLite ستون repeat از نوع TEXT است — نیازی به تغییر ندارد

                $listCols = [];
                foreach ($pdo->query('PRAGMA table_info(lists)')->fetchAll() as $c) {
                    $listCols[] = (string) $c['name'];
                }
                if (!in_array('pinned', $listCols, true)) {
                    $pdo->exec('ALTER TABLE lists ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
                }
            }
        } catch (Throwable $e) {
            error_log('[karam][task-schema] مهاجرت اسکیمای سینک ناموفق: ' . $e->getMessage());
        }
    }
}

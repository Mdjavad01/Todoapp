<?php

declare(strict_types=1);

/**
 * کارام — P2.0: مهاجرت خودکار اسکیمای لیست‌ها (بستن بدهی templateKey)
 *
 *   ۱) ستون lists.template_key (VARCHAR(32) NULL / TEXT NULL) — کلید پایدار لیست قالبی
 *      (قالب تریدر «trader.0..4»، قالب‌های رایگان «tpl-*.0»، بسته‌های شغلی «kit-*.<index>»)
 *   ۲) بک‌فیل یک‌باره: ۵ لیست تریدرِ موجود با تطبیق نام دقیق کلید می‌گیرند — فقط وقتی همین
 *      مهاجرت ستون را «خودش» اضافه کند (اگر SQL هاست اجرا شده باشد، بک‌فیل همان‌جا انجام شده).
 *      لیست‌های kit قدیمی و لیست‌های عادی کاربران عمداً NULL می‌مانند — داده‌ی کاربر است، نه دارایی ما.
 *
 * این مهاجرت تکرارپذیر است و همیشه try/catch — اگر دیتابیس آماده نبود هیچ مسیری نباید بخوابد.
 * معادل دستی: deploy/upgrade-v1.10.sql (بخش ۱ و ۲)
 */
final class ListSchema
{
    private static bool $done = false;

    /** نام‌های دقیق ۵ لیست تریدر → کلید — هم‌قرارداد با frontend/src/db/traderTemplate.ts */
    private const TRADER_BACKFILL = [
        'قوانین من'      => 'trader.0',
        'پیش از بازار'   => 'trader.1',
        'قبل از معامله'  => 'trader.2',
        'بعد از بازار'   => 'trader.3',
        'ریویو هفتگی'    => 'trader.4',
    ];

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
                $hasKey = is_array($pdo->query("SHOW COLUMNS FROM `lists` LIKE 'template_key'")->fetch());
                if (!$hasKey) {
                    $pdo->exec(
                        "ALTER TABLE `lists` ADD COLUMN `template_key` VARCHAR(32) NULL DEFAULT NULL COMMENT 'کلید پایدار لیست قالبی — بستن بدهی templateKey (P2.0)'"
                    );
                    self::backfillTraderLists($pdo);
                }
            } else {
                $cols = [];
                foreach ($pdo->query('PRAGMA table_info(lists)')->fetchAll() as $c) {
                    $cols[] = (string) $c['name'];
                }
                if (!in_array('template_key', $cols, true)) {
                    $pdo->exec('ALTER TABLE lists ADD COLUMN template_key TEXT NULL');
                    self::backfillTraderLists($pdo);
                }
            }
        } catch (Throwable $e) {
            error_log('[karam][list-schema] مهاجرت اسکیمای لیست‌ها ناموفق: ' . $e->getMessage());
        }
    }

    /** بک‌فیل یک‌باره‌ی ۵ لیست تریدر با تطبیق نام (تکرارپذیر — فقط سطرهای بدون کلید) */
    private static function backfillTraderLists(PDO $pdo): void
    {
        $stmt = $pdo->prepare(
            'UPDATE lists SET template_key = :key WHERE deleted_at IS NULL AND (template_key IS NULL OR template_key = \'\') AND name = :name'
        );
        foreach (self::TRADER_BACKFILL as $name => $key) {
            $stmt->execute([':key' => $key, ':name' => $name]);
        }
    }
}

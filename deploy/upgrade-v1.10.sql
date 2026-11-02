-- کارام — v1.10: P2.0 (بستن بدهی templateKey + بسته‌های شغلی)
--
-- چه می‌کند؟
--   ۱) lists.template_key VARCHAR(32) NULL — کلید پایدار لیست قالبی
--      (قالب تریدر «trader.0..4»، قالب‌های رایگان «tpl-*.0»، بسته‌های شغلی «kit-*.<index>»)
--   ۲) بک‌فیل یک‌باره: ۵ لیست تریدرِ موجود با تطبیق نام دقیق کلید می‌گیرند
--      (لیست‌های kit قدیمی و لیست‌های عادی کاربران عمداً NULL می‌مانند — داده‌ی کاربر است)
--
-- چرا؟ ایدمپوتنسی فعال‌سازی قالب‌ها تا امروز با «تطبیق نام لیست» بود؛ نام، هویت نیست.
--      با کلید، تغییر نام لیست قالبی دیگر فعال‌سازی دوباره را تکراری نمی‌کند و بازنشانی آن را گم نمی‌کند.
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی حتماً فول‌بک کامل بگیرید
--    (docs/INSTALL.md بخش ۱۸ — mysqldump یا Export از phpMyAdmin).
--
-- تکرارپذیر: هر دستور با INFORMATION_SCHEMA گارد دارد — چند بار اجرا بی‌ضرر است.
--
-- ⚠️ ترتیب انتشار: (۱) اجرای همین SQL روی هاست  (۲) آپلود api/ و panel/ جدید  (۳) APK/وب جدید.
--    اگر کلاینتِ جدید (که templateKey را می‌فرستد) قبل از این مهاجرت سینک کند، سرور فعلی کلید ناشناخته را
--    بی‌صدا نادیده می‌گیرد و کلیدها از دست می‌رود — پس اول این SQL.
--    SQLite (توسعه‌ی محلی) نیازی به این مهاجرت ندارد — ستون TEXT است و ListSchema::ensure در
--    اولین سینک خودش اضافه و بک‌فیل می‌کند
--    (برای نصب‌های نو، install.sql و install.sqlite.sql از قبل به‌روز شده‌اند).

-- ===============================================================
-- ۱) lists.template_key — کلید پایدار لیست قالبی
-- ===============================================================
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'lists'
    AND COLUMN_NAME  = 'template_key'
);
SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `lists` ADD COLUMN `template_key` VARCHAR(32) NULL DEFAULT NULL COMMENT ''کلید پایدار لیست قالبی — بستن بدهی templateKey (P2.0)'' AFTER `pinned`',
  'SELECT 1'
);
PREPARE karam_p2_stmt FROM @stmt;
EXECUTE karam_p2_stmt;
DEALLOCATE PREPARE karam_p2_stmt;

-- ===============================================================
-- ۲) بک‌فیل یک‌باره — ۵ لیست تریدر با تطبیق نام (تکرارپذیر: فقط سطرهای بدون کلید)
--    هم‌قرارداد با frontend/src/db/traderTemplate.ts (TRADER_LIST_KEYS)
-- ===============================================================
UPDATE `lists`
SET `template_key` = 'trader.0'
WHERE `deleted_at` IS NULL AND (`template_key` IS NULL OR `template_key` = '') AND `name` = 'قوانین من';

UPDATE `lists`
SET `template_key` = 'trader.1'
WHERE `deleted_at` IS NULL AND (`template_key` IS NULL OR `template_key` = '') AND `name` = 'پیش از بازار';

UPDATE `lists`
SET `template_key` = 'trader.2'
WHERE `deleted_at` IS NULL AND (`template_key` IS NULL OR `template_key` = '') AND `name` = 'قبل از معامله';

UPDATE `lists`
SET `template_key` = 'trader.3'
WHERE `deleted_at` IS NULL AND (`template_key` IS NULL OR `template_key` = '') AND `name` = 'بعد از بازار';

UPDATE `lists`
SET `template_key` = 'trader.4'
WHERE `deleted_at` IS NULL AND (`template_key` IS NULL OR `template_key` = '') AND `name` = 'ریویو هفتگی';

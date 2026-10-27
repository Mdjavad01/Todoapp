-- کارام — v1.7: قابلیت‌های فلوی افزودن و جزئیات کار (فاز ۳)
-- سه کار روی جدول tasks: (۱) ستون ستاره‌ی «مهم»  (۲) ستون تنظیم تکرار سفارشی  (۳) گسترش انواع تکرار
--
-- این مهاجرت «تکرارپذیر» است (چند بار اجرا بی‌ضرر) — همه‌ی دستورها با بررسی INFORMATION_SCHEMA گارد دارند.
-- هیچ ردیفی خوانده/تغییر/حذف نمی‌شود؛ فقط ستون افزوده می‌شود → نیازی به پشتیبان جدول‌به‌جدول نیست،
-- با این حال طبق قانون همیشگی، قبل از اجرا روی داده‌ی واقعی یک فول‌بک بگیرید
-- (docs/INSTALL.md بخش «بک‌آپ دیتابیس» — mysqldump یا Export از phpMyAdmin).
--
-- کد سرور (backend/src/Support/TaskSchema.php) همین کار را در اولین سینک/REST خودکار انجام می‌دهد؛
-- این اسکریپت برای اجرای دستی از phpMyAdmin است (هر دو مسیر هم‌ارز و تکرارپذیرند).
--
-- ارزش‌های جدید سمت کلاینت (frontend/src/lib/repeat.ts):
--   repeat='workdays' → شنبه تا چهارشنبه (پنج‌شنبه/جمعه پرش)
--   repeat='monthly' / 'yearly' → تقویم شمسی (کلمپ روز ۳۱ به آخرین روز ماه کوتاه‌تر؛ ۳۰ اسفند کبیسه → ۲۹)
--   repeat='custom' → repeat_meta = {"every":۱..۳۶۵,"unit":"day|week|month|year","days":[۰..۶]}

-- ===============================================================
-- ۱) ستون‌های جدید (تکرارپذیر — فقط اگر نبود اضافه می‌شود)
-- ===============================================================

SET @schema = DATABASE();

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `tasks` ADD COLUMN `starred` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''ستاره‌ی «مهم» (فاز ۳)''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'starred');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `tasks` ADD COLUMN `repeat_meta` TEXT NULL DEFAULT NULL COMMENT ''تنظیم تکرار سفارشی JSON (فاز ۳)''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'repeat_meta');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۲) گسترش انواع تکرار (تکرارپذیر — فقط وقتی workdays در تعریف نباشد)
--    مقدارهای فعلی همه در مجموعه‌ی جدید هستند → هیچ داده‌ای بازنویسی نمی‌شود.
-- ===============================================================

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `tasks` MODIFY `repeat` ENUM(''none'',''daily'',''workdays'',''weekly'',''monthly'',''yearly'',''custom'') NOT NULL DEFAULT ''none'' COMMENT ''نوع تکرار (فاز ۳: شمسی + سفارشی)''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'repeat'
    AND COLUMN_TYPE NOT LIKE '%workdays%');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۳) راستی‌آزمایی — ستون‌های مورد انتظار و تعریف تکرار را نشان می‌دهد
-- ===============================================================

SHOW COLUMNS FROM `tasks` LIKE 'starred';
SHOW COLUMNS FROM `tasks` LIKE 'repeat_meta';
SHOW COLUMNS FROM `tasks` LIKE 'repeat';

-- ===============================================================
-- ۴) راه بازگشت (فقط در صورت نیاز — دستورات زیر به‌صورت دستی اجرا شود)
--    هیچ داده‌ای تغییر نکرده است؛ فقط ستون‌ها حذف و enum به حالت قبل برمی‌گردد.
--    ⚠️ فقط وقتی APKهای جدید را کامل کنار گذاشته‌اید؛ کلاینت فاز ۳ به این ستون‌ها نیاز دارد.
-- ===============================================================
-- ALTER TABLE `tasks` DROP COLUMN `starred`;
-- ALTER TABLE `tasks` DROP COLUMN `repeat_meta`;
-- ALTER TABLE `tasks` MODIFY `repeat` ENUM('none','daily','weekly','monthly') NOT NULL DEFAULT 'none';

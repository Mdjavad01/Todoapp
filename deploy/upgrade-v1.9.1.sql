-- کارام — v1.9.1: فاز تریدر (چک‌لیست تریدر — نوع آیتم + لیست پین‌شده)
--
-- چه می‌کند؟
--   ۱) tasks.item_type  VARCHAR(16)  NULL — نوع آیتم چک‌لیست تریدر
--      ('check','num','note','choice','score' — NULL = تیک ساده، سازگار با داده‌ی قدیمی)
--   ۲) tasks.item_value VARCHAR(255) NULL — مقدار آیتم (عدد/انتخاب/امتیاز؛ یادداشت کوتاه هم همین‌جاست)
--   ۳) lists.pinned     TINYINT(1)  NOT NULL DEFAULT 0 — لیست پین‌شده (همیشه بالای فهرست)
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی حتماً فول‌بک کامل بگیرید
--    (docs/INSTALL.md بخش ۱۸ — mysqldump یا Export از phpMyAdmin).
--
-- تکرارپذیر: هر دستور با INFORMATION_SCHEMA گارد دارد — چند بار اجرا بی‌ضرر است.
--
-- ⚠️ ترتیب انتشار: (۱) اجرای همین SQL روی هاست  (۲) آپلود api/ و panel/ جدید  (۳) APK جدید.
--    اگر APK جدید (که کلیدهای itemType/itemValue/pinned را می‌فرستد) قبل از این مهاجرت سینک کند،
--    سرور فعلی کلیدهای ناشناخته را بی‌صدا نادیده می‌گیرد و مقادیر از دست می‌رود — پس اول این SQL.
--    SQLite (توسعه‌ی محلی) نیازی به این مهاجرت ندارد — ستون‌ها TEXT/INTEGER هستند و
--    TaskSchema::ensure در اولین سینک خودش اضافه می‌کند
--    (برای نصب‌های نو، install.sql و install.sqlite.sql از قبل به‌روز شده‌اند).

-- ===============================================================
-- ۱) tasks.item_type — نوع آیتم چک‌لیست تریدر
-- ===============================================================
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'tasks'
    AND COLUMN_NAME  = 'item_type'
);
SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `tasks` ADD COLUMN `item_type` VARCHAR(16) NULL DEFAULT NULL COMMENT ''نوع آیتم چک‌لیست تریدر (فاز تریدر)'' AFTER `repeat_meta`',
  'SELECT 1'
);
PREPARE karam_trader_stmt FROM @stmt;
EXECUTE karam_trader_stmt;
DEALLOCATE PREPARE karam_trader_stmt;

-- ===============================================================
-- ۲) tasks.item_value — مقدار آیتم
-- ===============================================================
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'tasks'
    AND COLUMN_NAME  = 'item_value'
);
SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `tasks` ADD COLUMN `item_value` VARCHAR(255) NULL DEFAULT NULL COMMENT ''مقدار آیتم — عدد/انتخاب/امتیاز (فاز تریدر)'' AFTER `item_type`',
  'SELECT 1'
);
PREPARE karam_trader_stmt FROM @stmt;
EXECUTE karam_trader_stmt;
DEALLOCATE PREPARE karam_trader_stmt;

-- ===============================================================
-- ۳) lists.pinned — لیست پین‌شده
-- ===============================================================
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'lists'
    AND COLUMN_NAME  = 'pinned'
);
SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `lists` ADD COLUMN `pinned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''لیست پین‌شده — همیشه بالای فهرست (فاز تریدر)'' AFTER `sort_order`',
  'SELECT 1'
);
PREPARE karam_trader_stmt FROM @stmt;
EXECUTE karam_trader_stmt;
DEALLOCATE PREPARE karam_trader_stmt;

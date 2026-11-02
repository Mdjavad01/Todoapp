-- ============================================================================
-- کارام — مهاجرت تجمعی 1.8.1 → 1.10 (یک فایل، به ترتیب، تکرارپذیر)
-- ============================================================================
-- این فایل همه‌ی مهاجرت‌های بین بسته‌ی karam-host-update-v1.8.1 و نسخه‌ی فعلی را
-- به ترتیب درست در خود دارد:
--   بخش ۱ = deploy/upgrade-v1.9.sql    (بسته‌ی ایمنی و اعتماد: enum account_delete + کلیدهای نگه‌داری)
--   بخش ۲ = deploy/upgrade-v1.9.1.sql  (فاز تریدر: tasks.item_type / tasks.item_value / lists.pinned)
--   بخش ۳ = deploy/upgrade-v1.10.sql   (P2.0: lists.template_key + بک‌فیل نامی ۵ لیست تریدر)
--
-- ✅ تکرارپذیر: هر دستور با گارد INFORMATION_SCHEMA یا شرط WHERE امن — اجرای چندباره بی‌ضرر است.
--   اگر v1.9 و v1.9.1 قبلاً روی هاست اجرا شده‌اند، بخش ۱ و ۲ خودشان رد می‌شوند و فقط بخش ۳ اعمال می‌شود.
--
-- ⚠️ قبل از اجرا فول‌بک کامل بگیرید (README-نصب.md گام ۱ — mysqldump).
-- ⚠️ ترتیب انتشار: (۱) همین SQL  (۲) آپلود api/ و panel/ و اپ  (۳) APK/وب جدید — هرگز برعکس.
--   اگر کلاینتِ جدید (که templateKey می‌فرستد) قبل از بخش ۳ سینک کند، سرور فعلی کلید ناشناخته را
--   بی‌صدا نادیده می‌گیرد و کلیدها از دست می‌روند — پس اول همین SQL.
-- SQLite (توسعه‌ی محلی) نیازی به این مهاجرت ندارد — TaskSchema::ensure و ListSchema::ensure
-- خودشان ستون‌ها را می‌سازند و بک‌فیل تریدر را انجام می‌دهند.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۱ از ۳ — upgrade-v1.9.sql (بسته‌ی ایمنی و اعتماد)
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- کارام — v1.9: بسته‌ی ایمنی و اعتماد (حذف حساب، ماسک رازها، health واقعی، کرون نگه‌داری)
--
-- چه می‌کند؟
--   ۱) otp_requests.purpose ← مقدار جدید 'account_delete' (کد دومرحله‌ای حذف حساب —
--      هرگز با کد ورود یکسان نیست؛ کدِ حذف حساب نمی‌تواند برای ورود استفاده شود و برعکس)
--   ۲) کلیدهای تنظیمات نگه‌داری (کرون Retention) — آستانه‌های قابل‌تغییر از پنل ادمین
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی حتماً فول‌بک کامل بگیرید
--    (docs/INSTALL.md بخش ۱۸ — mysqldump یا Export از phpMyAdmin).
--
-- تکرارپذیر: هر دستور با INFORMATION_SCHEMA گارد دارد — چند بار اجرا بی‌ضرر است.
--
-- ترتیب امن آپلود: (۱) اجرای همین SQL   (۲) آپلود api/ و panel/ جدید
-- SQLite (توسعه‌ی محلی) نیازی به این مهاجرت ندارد — ستون purpose آن TEXT است
-- (برای نصب‌های نو، install.sql و install.sqlite.sql از قبل به‌روز شده‌اند).

-- ===============================================================
-- ۱) گسترش enum هدف کد یک‌بارمصرف: login / admin_2fa / account_delete
-- ===============================================================

-- MySQL 5.7: گارد INFORMATION_SCHEMA؛ فقط وقتی مقدار account_delete مجاز نیست اجرا شود
SET @col_type := (
  SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'otp_requests'
    AND COLUMN_NAME  = 'purpose'
  LIMIT 1
);

SET @stmt := IF(
  @col_type IS NOT NULL AND @col_type NOT LIKE '%account_delete%',
  'ALTER TABLE `otp_requests` MODIFY `purpose` ENUM(''login'',''admin_2fa'',''account_delete'') NOT NULL DEFAULT ''login''',
  'SELECT 1'
);
PREPARE karam_v19_stmt FROM @stmt;
EXECUTE karam_v19_stmt;
DEALLOCATE PREPARE karam_v19_stmt;

-- ===============================================================
-- ۲) کلیدهای تنظیمات نگه‌داری (کرون Retention — پنل ← تنظیمات)
--    مقادیر پیش‌فرض محتاطانه‌اند؛ حذف‌های نرم (تومب‌استون) حداقل ۹۰ روز
-- ===============================================================

INSERT INTO `settings` (`key`, `value`, `updated_at`) VALUES
  -- کدهای یک‌بارمصرف (OTP): ۹۰ روز
  ('retention_otp_days', '90', NOW()),
  -- لاگ پروایدرها (SMTP/تلگرام/پیامک/درگاه): ۱۸۰ روز
  ('retention_provider_logs_days', '180', NOW()),
  -- Audit عملیات مدیریتی: ۳۶۵ روز
  ('retention_audit_days', '365', NOW()),
  -- توکن‌های منقضی/ابطال‌شده: ۳۰ روز پس از انقضا
  ('retention_refresh_expired_days', '30', NOW()),
  -- حذف‌های نرم (تومب‌استون لیست/کار/زیرکار): ۱۸۰ روز — سقف پایین در پنل ۹۰ است
  -- (کلاینتِ بیشتر از این مدت آفلاین، سینک کامل مجدد انجام می‌دهد و داده‌ی حذف‌شده برنمی‌گردد)
  ('retention_tombstone_days', '180', NOW())
ON DUPLICATE KEY UPDATE `key` = `key`;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۲ از ۳ — upgrade-v1.9.1.sql (فاز تریدر — نوع آیتم + لیست پین‌شده)
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۳ از ۳ — upgrade-v1.10.sql (P2.0 — کلید قالب + بسته‌های شغلی)
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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

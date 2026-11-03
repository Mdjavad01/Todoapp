-- ============================================================================
-- کارام — مهاجرت تجمعی 1.7 → 1.10.1 (یک فایل، به ترتیب، تکرارپذیر)
-- ============================================================================
-- برای هاستی که آخرین SQL اجراشده‌اش «upgrade-v1.7.sql» است (مثلاً آخرین پک
-- آپلودشده karam-host-update-v1.2.8 یا قدیمی‌تر بوده و پک‌های بعدی فقط وب بودند
-- یا اصلاً آپلود نشدند) — و همچنین برای هاستی که v1.8 یا v1.8.1 را کامل اجرا
-- کرده (بخش‌های قبلی خودشان را می‌شناسند و بی‌صدا رد می‌شوند).
--
-- این فایل همه‌ی مهاجرت‌های بین اسکیمای v1.7 تا نسخه‌ی فعلی را به ترتیب درست دارد:
--   بخش ۱ = deploy/upgrade-v1.8.sql    (فاز تومان: همه‌ی مبلغ‌های ریال → تومان ÷۱۰ + جدول‌های پشتیبان _bak_v18_*)
--   بخش ۲ = deploy/upgrade-v1.9.sql    (بسته‌ی ایمنی و اعتماد: enum account_delete + کلیدهای نگه‌داری)
--   بخش ۳ = deploy/upgrade-v1.9.1.sql  (فاز تریدر: tasks.item_type / tasks.item_value / lists.pinned)
--   بخش ۴ = deploy/upgrade-v1.10.sql   (P2.0: lists.template_key + بک‌فیل نامی ۵ لیست تریدر)
--   بخش ۵ = deploy/upgrade-v1.10.1.sql (فیکس سینک 500: یونیک uuid لیست‌ها به‌ازای هر کاربر — رفع 1062)
--
-- ✅ تکرارپذیر: هر دستور با گارد INFORMATION_SCHEMA یا INSERT IGNORE یا شرط WHERE امن —
--   اجرای چندباره بی‌ضرر است. مهاجرت تومان (بخش ۱) فقط وقتی ستون‌های ریالی موجود باشند
--   تبدیل می‌کند؛ بعد از اولین اجرا ستون‌ها حذف می‌شوند و اجرای دوباره هیچ عددی را دوبرابر نمی‌کند.
--   اگر v1.8/v1.9/v1.9.1 قبلاً اجرا شده‌اند، بخش‌های ۱ تا ۳ خودشان رد می‌شوند.
--
-- ویرایش ۲ — رفع خطای واقعی هاست: #1054 «Unknown column 'price_rials' in 'SELECT'»:
--   پشتیبان‌گیری‌های بخش ۱ هم گارد گرفتند — اگر مهاجرت تومان قبلاً (کامل یا نیمه‌تمام)
--   اجرا شده باشد و ستون‌های ریالی حذف شده باشند، اجرای دوبارهٔ همین فایل بی‌خطا تا
--   انتها می‌رود و فقط بخش‌های جاافتاده (v1.9 به بعد) را اعمال می‌کند. هیچ عددی
--   دوبرابر نمی‌شود و پشتیبان ریالی از قبل در جدول‌های _bak_v18_* امن است.
--
-- ⚠️ قبل از اجرا فول‌بک کامل بگیرید (README-نصب.md گام ۱ — mysqldump).
-- ⚠️ ترتیب انتشار: (۱) همین SQL  (۲) آپلود api/ و panel/ و اپ  (۳) APK/وب جدید — هرگز برعکس.
--   اگر کلاینتِ جدید (که templateKey می‌فرستد) قبل از بخش ۴ سینک کند، سرور فعلی کلید ناشناخته را
--   بی‌صدا نادیده می‌گیرد و کلیدها از دست می‌روند — پس اول همین SQL.
-- SQLite (توسعه‌ی محلی) نیازی به این مهاجرت ندارد — TaskSchema::ensure و ListSchema::ensure
-- خودشان ستون‌ها را می‌سازند و بک‌فیل تریدر را انجام می‌دهند.
--
-- 💡 اگر می‌خواهید قبل از اجرا بدانید وضعیت فعلی دیتابیس کجاست (اختیاری):
--   SHOW COLUMNS FROM `plans` LIKE 'price%';      -- ریالی = v1.7 | تومانی = v1.8 به بعد
--   SHOW COLUMNS FROM `tasks` LIKE 'item%';       -- دو ردیف = v1.9.1 به بعد
--   SHOW COLUMNS FROM `lists` LIKE 'template_key';-- یک ردیف = v1.10 (این مهاجرت)
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۱ از ۵ — upgrade-v1.8.sql (فاز تومان — ریال → تومان صحیح)
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- کارام — v1.8: یکسان‌سازی واحد پول سراسری «تومان صحیح» (فاز تومان)
--
-- چه می‌کند؟ همه‌ی ستون‌های مبلغِ ریالی → تومان صحیح (÷۱۰) و تغییر نام ستون‌ها:
--   plans.price_rials           → plans.price_tomans
--   orders.amount_rials         → orders.amount_tomans
--   orders.discount_rials       → orders.discount_tomans
--   payments.amount_rials       → payments.amount_tomans
--   deposit_requests.amount_rials  → deposit_requests.amount_tomans
--   deposit_requests.discount_rials → deposit_requests.discount_tomans
--   coupon_redemptions.discount_rials → coupon_redemptions.discount_tomans
--   coupons.value (فقط type='amount') → ÷۱۰ (درصد دست‌نخورده)
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی حتماً یک فول‌بک کامل بگیرید
--    (docs/INSTALL.md بخش «بک‌آپ دیتابیس» — mysqldump یا Export از phpMyAdmin).
--    این اسکریپت هم جدول‌های پشتیبان جدول‌به‌جدول می‌سازد (_bak_v18_*)، ولی
--    فول‌بک کامل جایگزین آن نیست.
--
-- تکرارپذیر: هر دستور با INFORMATION_SCHEMA گارد دارد — چند بار اجرا بی‌ضرر است
-- (درس v1.2.9: پشتیبان‌ها DDL صریح با فقط PRIMARY KEY — هیچ کلید یکتایی به ارث نمی‌رسد).
--
-- ویرایش ۲ — رفع خطای #1054 «Unknown column 'price_rials' in 'SELECT'»:
--   اگر این مهاجرت قبلاً (کامل یا نیمه‌تمام) اجرا شده باشد، ستون‌های ریالی حذف شده‌اند و
--   پشتیبان‌گیریِ بدون گارد در اجرای دوباره خطای ستون ناشناخته می‌داد. حالا هر INSERT
--   پشتیبان هم گارد INFORMATION_SCHEMA دارد: ستون ریالی نبود ⇒ پشتیبان‌گیری بی‌صدا رد
--   می‌شود (از قبل پشتیبان گرفته شده) و اجرا تا انتها می‌رود.
--
-- ترتیب امن آپلود: (۱) اجرای همین SQL   (۲) آپلود api/ و panel/ جدید
-- اگر فقط کد نو را آپلود کنید و SQL را اجرا نکنید، مسیرهای پرداخت خطای «ستون ناشناخته» می‌دهند.

-- ===============================================================
-- ۰) پشتیبان صریح (PK فقط — بدون کلید یکتا؛ تکرارپذیر با INSERT IGNORE)
--    ویرایش ۲: هر INSERT با گارد INFORMATION_SCHEMA — ستون ریالی نبود ⇒ رد
-- ===============================================================

SET @schema = DATABASE();

CREATE TABLE IF NOT EXISTS `_bak_v18_plans` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `title` VARCHAR(120) NOT NULL,
  `months` INT NOT NULL, `price_rials` BIGINT NOT NULL, `description` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL, `sort_order` INT NOT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @bak_plans_rials = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='plans' AND COLUMN_NAME='price_rials');
SET @ddl = IF(@bak_plans_rials > 0, 'INSERT IGNORE INTO `_bak_v18_plans` (`id`,`uuid`,`code`,`title`,`months`,`price_rials`,`description`,`is_active`,`sort_order`,`created_at`,`updated_at`) SELECT `id`,`uuid`,`code`,`title`,`months`,`price_rials`,`description`,`is_active`,`sort_order`,`created_at`,`updated_at` FROM `plans`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `_bak_v18_orders` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL, `plan_id` BIGINT UNSIGNED NOT NULL,
  `coupon_id` BIGINT UNSIGNED NULL, `amount_rials` BIGINT NOT NULL, `discount_rials` BIGINT NOT NULL,
  `status` VARCHAR(20) NOT NULL, `description` VARCHAR(255) NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @bak_orders_rials = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='orders' AND COLUMN_NAME='amount_rials');
SET @ddl = IF(@bak_orders_rials > 0, 'INSERT IGNORE INTO `_bak_v18_orders` (`id`,`uuid`,`user_id`,`plan_id`,`coupon_id`,`amount_rials`,`discount_rials`,`status`,`description`,`created_at`,`updated_at`) SELECT `id`,`uuid`,`user_id`,`plan_id`,`coupon_id`,`amount_rials`,`discount_rials`,`status`,`description`,`created_at`,`updated_at` FROM `orders`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `_bak_v18_payments` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `order_id` BIGINT UNSIGNED NOT NULL, `gateway` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL, `amount_rials` BIGINT NOT NULL, `gateway_ref` VARCHAR(190) NULL,
  `verified_at` DATETIME NULL, `verify_payload` TEXT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @bak_payments_rials = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='payments' AND COLUMN_NAME='amount_rials');
SET @ddl = IF(@bak_payments_rials > 0, 'INSERT IGNORE INTO `_bak_v18_payments` (`id`,`uuid`,`order_id`,`gateway`,`status`,`amount_rials`,`gateway_ref`,`verified_at`,`verify_payload`,`created_at`,`updated_at`) SELECT `id`,`uuid`,`order_id`,`gateway`,`status`,`amount_rials`,`gateway_ref`,`verified_at`,`verify_payload`,`created_at`,`updated_at` FROM `payments`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `_bak_v18_deposit_requests` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL, `plan_id` BIGINT UNSIGNED NULL,
  `plan_code` VARCHAR(50) NOT NULL, `amount_rials` BIGINT NOT NULL, `discount_rials` BIGINT NOT NULL,
  `coupon_id` BIGINT UNSIGNED NULL, `reference` VARCHAR(64) NOT NULL, `note` VARCHAR(500) NULL,
  `status` VARCHAR(16) NOT NULL, `review_note` VARCHAR(500) NULL, `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL, `subscription_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @bak_deposits_rials = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='amount_rials');
SET @ddl = IF(@bak_deposits_rials > 0, 'INSERT IGNORE INTO `_bak_v18_deposit_requests` (`id`,`uuid`,`user_id`,`plan_id`,`plan_code`,`amount_rials`,`discount_rials`,`coupon_id`,`reference`,`note`,`status`,`review_note`,`reviewed_by`,`reviewed_at`,`subscription_id`,`created_at`,`updated_at`) SELECT `id`,`uuid`,`user_id`,`plan_id`,`plan_code`,`amount_rials`,`discount_rials`,`coupon_id`,`reference`,`note`,`status`,`review_note`,`reviewed_by`,`reviewed_at`,`subscription_id`,`created_at`,`updated_at` FROM `deposit_requests`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `_bak_v18_coupons` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `type` VARCHAR(10) NOT NULL,
  `value` INT NOT NULL, `expires_at` DATETIME NULL, `max_uses` INT NULL,
  `used_count` INT NOT NULL, `is_active` TINYINT(1) NOT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- (پشتیبان coupons به گارد نیاز ندارد — هیچ ستون ریالی ندارد و ستون value هرگز حذف نمی‌شود)
INSERT IGNORE INTO `_bak_v18_coupons` (`id`,`uuid`,`code`,`type`,`value`,`expires_at`,`max_uses`,`used_count`,`is_active`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`code`,`type`,`value`,`expires_at`,`max_uses`,`used_count`,`is_active`,`created_at`,`updated_at` FROM `coupons`;

CREATE TABLE IF NOT EXISTS `_bak_v18_coupon_redemptions` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `coupon_id` BIGINT UNSIGNED NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(10) NOT NULL, `reference_id` BIGINT UNSIGNED NULL, `discount_rials` BIGINT NOT NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @bak_redemptions_rials = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='coupon_redemptions' AND COLUMN_NAME='discount_rials');
SET @ddl = IF(@bak_redemptions_rials > 0, 'INSERT IGNORE INTO `_bak_v18_coupon_redemptions` (`id`,`uuid`,`coupon_id`,`user_id`,`kind`,`reference_id`,`discount_rials`,`created_at`) SELECT `id`,`uuid`,`coupon_id`,`user_id`,`kind`,`reference_id`,`discount_rials`,`created_at` FROM `coupon_redemptions`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۱) plans — price_rials → price_tomans (÷۱۰)
-- ===============================================================

SET @schema = DATABASE();
SET @plans_has_rials   = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='plans' AND COLUMN_NAME='price_rials');
SET @plans_has_tomans  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='plans' AND COLUMN_NAME='price_tomans');

SET @ddl = IF(@plans_has_tomans = 0, 'ALTER TABLE `plans` ADD COLUMN `price_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''مبلغ به تومان — فقط از سرور (فاز تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@plans_has_rials > 0, 'UPDATE `plans` SET `price_tomans` = ROUND(`price_rials` / 10)', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@plans_has_rials > 0, 'ALTER TABLE `plans` DROP COLUMN `price_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۲) orders — amount_rials/discount_rials → amount_tomans/discount_tomans
-- ===============================================================

SET @o_has_rials      = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='orders' AND COLUMN_NAME='amount_rials');
SET @o_has_tomans     = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='orders' AND COLUMN_NAME='amount_tomans');
SET @o_has_d_rials    = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='orders' AND COLUMN_NAME='discount_rials');
SET @o_has_d_tomans   = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='orders' AND COLUMN_NAME='discount_tomans');

SET @ddl = IF(@o_has_tomans = 0, 'ALTER TABLE `orders` ADD COLUMN `amount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''مبلغ نهایی پس از تخفیف (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
SET @ddl = IF(@o_has_d_tomans = 0, 'ALTER TABLE `orders` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''تخفیف کد هدیه (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@o_has_rials > 0, 'UPDATE `orders` SET `amount_tomans` = ROUND(`amount_rials` / 10), `discount_tomans` = ROUND(`discount_rials` / 10)', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@o_has_rials > 0, 'ALTER TABLE `orders` DROP COLUMN `amount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
SET @ddl = IF(@o_has_d_rials > 0, 'ALTER TABLE `orders` DROP COLUMN `discount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۳) payments — amount_rials → amount_tomans
-- ===============================================================

SET @p_has_rials   = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='payments' AND COLUMN_NAME='amount_rials');
SET @p_has_tomans  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='payments' AND COLUMN_NAME='amount_tomans');

SET @ddl = IF(@p_has_tomans = 0, 'ALTER TABLE `payments` ADD COLUMN `amount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''مبلغ (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@p_has_rials > 0, 'UPDATE `payments` SET `amount_tomans` = ROUND(`amount_rials` / 10)', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@p_has_rials > 0, 'ALTER TABLE `payments` DROP COLUMN `amount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۴) deposit_requests — amount_rials/discount_rials → تومان
--    (کد سرور DepositSchema/GiftSchema هم همین را خودکار انجام می‌دهد؛ اینجا مسیر دستی)
-- ===============================================================

SET @d_has_rials     = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='amount_rials');
SET @d_has_tomans    = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='amount_tomans');
SET @d_has_d_rials   = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='discount_rials');
SET @d_has_d_tomans  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='deposit_requests' AND COLUMN_NAME='discount_tomans');

SET @ddl = IF(@d_has_tomans = 0, 'ALTER TABLE `deposit_requests` ADD COLUMN `amount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''مبلغ قابل واریز (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
SET @ddl = IF(@d_has_d_tomans = 0, 'ALTER TABLE `deposit_requests` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''تخفیف کد هدیه (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@d_has_rials > 0, 'UPDATE `deposit_requests` SET `amount_tomans` = ROUND(`amount_rials` / 10), `discount_tomans` = ROUND(`discount_rials` / 10)', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@d_has_rials > 0, 'ALTER TABLE `deposit_requests` DROP COLUMN `amount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
SET @ddl = IF(@d_has_d_rials > 0, 'ALTER TABLE `deposit_requests` DROP COLUMN `discount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۵) coupon_redemptions — discount_rials → discount_tomans
-- ===============================================================

SET @cr_has_rials   = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='coupon_redemptions' AND COLUMN_NAME='discount_rials');
SET @cr_has_tomans  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='coupon_redemptions' AND COLUMN_NAME='discount_tomans');

SET @ddl = IF(@cr_has_tomans = 0, 'ALTER TABLE `coupon_redemptions` ADD COLUMN `discount_tomans` BIGINT NOT NULL DEFAULT 0 COMMENT ''تخفیف کد هدیه (تومان)''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@cr_has_rials > 0, 'UPDATE `coupon_redemptions` SET `discount_tomans` = ROUND(`discount_rials` / 10)', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = IF(@cr_has_rials > 0, 'ALTER TABLE `coupon_redemptions` DROP COLUMN `discount_rials`', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۶) coupons — فقط type='amount' ÷۱۰ (درصد دست‌نخورده)
--    گارد یک‌بارِ اجرا: فقط وقتی plans هنوز ستون ریالی دارد (یعنی مهاجرت هنوز
--    شروع نشده بوده) — تکرار اجرا دیگر value را نصف نمی‌کند.
-- ===============================================================

SET @plans_rials_now = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema AND TABLE_NAME='plans' AND COLUMN_NAME='price_rials');
SET @ddl = IF(@plans_rials_now > 0, 'UPDATE `coupons` SET `value` = ROUND(`value` / 10) WHERE `type` = ''amount''', 'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۷) راستی‌آزمایی بعد از تبدیل — خروجی را با چشم ببینید:
--    * قیمت پلن‌ها باید «یک‌دهم» قبلی باشد (۴۹۰٬۰۰۰ ریال → ۴۹٬۰۰۰ تومان)
--    * تعداد ردیف‌های اصلی و پشتیبان باید برابر باشد
-- ===============================================================

SELECT `code`, `title`, `months`, `price_tomans` FROM `plans` ORDER BY `sort_order` ASC;
SELECT (SELECT COUNT(*) FROM `plans`) AS plans_main, (SELECT COUNT(*) FROM `_bak_v18_plans`) AS plans_bak;
SELECT (SELECT COUNT(*) FROM `orders`) AS orders_main, (SELECT COUNT(*) FROM `_bak_v18_orders`) AS orders_bak;
SELECT (SELECT COUNT(*) FROM `payments`) AS payments_main, (SELECT COUNT(*) FROM `_bak_v18_payments`) AS payments_bak;
SELECT `id`, `amount_tomans`, `discount_tomans`, `status`, `created_at` FROM `orders` ORDER BY `id` DESC LIMIT 5;
SELECT `id`, `amount_tomans`, `status` FROM `payments` ORDER BY `id` DESC LIMIT 5;
SELECT `code`, `type`, `value` FROM `coupons` ORDER BY `id` DESC LIMIT 10;

-- ===============================================================
-- ۸) راه بازگشت (فقط در صورت نیاز — دستی و مرحله‌به‌مرحله اجرا شود)
--    ⚠️ فقط تا قبل از آپلود کد نو معنا دارد؛ بعد از آپلود کد تومانی، برگشت یعنی
--    برگشت کد هم. در حالت عادی نیازی به این بخش نیست.
--    ساده‌ترین بازگشت = بازگرداندن از فول‌بک کامل (mysqldump) یا:
-- ===============================================================
-- ALTER TABLE `plans` ADD COLUMN `price_rials` BIGINT NOT NULL DEFAULT 0;
-- UPDATE `plans` SET `price_rials` = `price_tomans` * 10;
-- ALTER TABLE `plans` DROP COLUMN `price_tomans`;
-- (همین الگو برای orders/payments/deposit_requests/coupon_redemptions با ×۱۰ برعکس؛
--  coupons: UPDATE coupons SET value = value * 10 WHERE type='amount')
-- جدول‌های پشتیبان بعد از یک هفته کار پایدار قابل حذف‌اند:
-- DROP TABLE IF EXISTS `_bak_v18_plans`, `_bak_v18_orders`, `_bak_v18_payments`,
--   `_bak_v18_deposit_requests`, `_bak_v18_coupons`, `_bak_v18_coupon_redemptions`;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۲ از ۵ — upgrade-v1.9.sql (بسته‌ی ایمنی و اعتماد)
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
-- بخش ۳ از ۵ — upgrade-v1.9.1.sql (فاز تریدر — نوع آیتم + لیست پین‌شده)
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
-- بخش ۴ از ۵ — upgrade-v1.10.sql (P2.0 — کلید قالب + بسته‌های شغلی)
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- بخش ۵ از ۵ — upgrade-v1.10.1.sql (فیکس سینک «خطای داخلی سرور» — ریشه‌ی واقعی
--   عیب‌یاب روی هاست شما: 1062 Duplicate entry '00000000-…-0001' for 'uq_lists_uuid')
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- کارام — v1.10.1: فیکس سینک «خطای داخلی سرور» — یونیکِ uuid لیست‌ها به‌ازای هر کاربر
-- ============================================================================
-- ریشه‌ی واقعی (ثابت‌شده با عیب‌یاب karam-diag.php روی هاست واقعی — php-error.log):
--   SQLSTATE[23000]: 1062 Duplicate entry '00000000-0000-4000-8000-000000000001'
--   for key 'uq_lists_uuid'  @ api/src/Services/Entities.php (insertClient)
--
-- چه می‌کند؟
--   ایندکس یونیکِ جدول lists از «uuid به‌تنهایی (سراسری بین همه‌ی کاربران)» به
--   «(user_id, uuid) — یونیک به‌ازای هر کاربر» تغییر می‌کند:
--     uq_lists_uuid (uuid)          → حذف
--     uq_lists_user_uuid (user_id, uuid) → ساختن
--
-- چرا؟ اپ کلاینت برای «لیست پیش‌فرض» یک UUID قطعی و مشترک می‌سازد
--   (DEFAULT_LIST_ID = 00000000-0000-4000-8000-000000000001 — frontend/src/sync/lww.ts)
--   تا چند دستگاهِ پیش از ورود، پیش از اولین سینک، به «همان یک رکورد» در سرور ادغام شوند.
--   با یونیکِ سراسری فقط «اولین» کاربر موفق به ساختن لیست پیش‌فرض می‌شود و push هر
--   کاربرِ بعدی با 1062 → HTTP 500 → «خطای داخلی سرور» در سینک می‌شکست.
--   کل موتور سینک LWW به‌ازای هر کاربر است (lookup ها همه با user_id) — پس قیدِ
--   درست دیتابیس هم یونیکِ به‌ازای هر کاربر است، نه سراسری.
--
-- امنیت داده:
--   - هیچ ردیفی حذف یا تغییر نمی‌کند؛ فقط ایندکس عوض می‌شود (یک ALTER اتمی).
--   - چون تا امروز uuid سراسری یونیک بوده، هیچ دو ردیف هم‌(user_id, uuid) وجود ندارد
--     → ساختن ایندکس نو هرگز با خطای تکرار مواجه نمی‌شود.
--   - tasks / subtasks / reminders از کلاینت UUID تصادفی v4 می‌گیرند (برخورد بین
--     کاربران عملاً ناممکن) — دست نمی‌خوریم؛ فقط lists قیدِ قطعیِ اشتباه داشت.
--   - ردیف موجود کاربر ۱۱ (یا هر کاربر اول) سر جایش می‌ماند؛ کاربرهای بعدی رکورد
--     مستقل خودشان را می‌سازند.
--
-- تکرارپذیر: با گارد INFORMATION_SCHEMA — چند بار اجرا بی‌ضرر است.
-- ⚠️ قبل از اجرا فول‌بک کامل بگیرید (README-نصب.md گام فول‌بک — mysqldump).
-- ⚠️ ترتیب انتشار: (۱) همین SQL  (۲) آپلود api/ و panel/  (۳) وب/APK — هرگز برعکس.
-- ============================================================================

SET @karam_has_old := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lists' AND INDEX_NAME = 'uq_lists_uuid'
);
SET @karam_has_new := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lists' AND INDEX_NAME = 'uq_lists_user_uuid'
);
SET @stmt := IF(@karam_has_old = 1 AND @karam_has_new = 0,
  'ALTER TABLE `lists` DROP INDEX `uq_lists_uuid`, ADD UNIQUE KEY `uq_lists_user_uuid` (`user_id`, `uuid`)',
  'SELECT 1'
);
PREPARE karam_v1101_stmt FROM @stmt;
EXECUTE karam_v1101_stmt;
DEALLOCATE PREPARE karam_v1101_stmt;

-- راستی‌آزمایی (اختیاری، در phpMyAdmin):
--   SHOW INDEX FROM `lists` WHERE Key_name = 'uq_lists_user_uuid';
--   → باید «دو» ردیف بدهد: user_id (Seq_in_index=1) و uuid (Seq_in_index=2)
--   و این یکی خالی باشد:
--   SHOW INDEX FROM `lists` WHERE Key_name = 'uq_lists_uuid';

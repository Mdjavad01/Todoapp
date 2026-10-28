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
-- ترتیب امن آپلود: (۱) اجرای همین SQL   (۲) آپلود api/ و panel/ جدید
-- اگر فقط کد نو را آپلود کنید و SQL را اجرا نکنید، مسیرهای پرداخت خطای «ستون ناشناخته» می‌دهند.

-- ===============================================================
-- ۰) پشتیبان صریح (PK فقط — بدون کلید یکتا؛ تکرارپذیر با INSERT IGNORE)
-- ===============================================================

CREATE TABLE IF NOT EXISTS `_bak_v18_plans` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `title` VARCHAR(120) NOT NULL,
  `months` INT NOT NULL, `price_rials` BIGINT NOT NULL, `description` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL, `sort_order` INT NOT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `_bak_v18_plans` (`id`,`uuid`,`code`,`title`,`months`,`price_rials`,`description`,`is_active`,`sort_order`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`code`,`title`,`months`,`price_rials`,`description`,`is_active`,`sort_order`,`created_at`,`updated_at` FROM `plans`;

CREATE TABLE IF NOT EXISTS `_bak_v18_orders` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL, `plan_id` BIGINT UNSIGNED NOT NULL,
  `coupon_id` BIGINT UNSIGNED NULL, `amount_rials` BIGINT NOT NULL, `discount_rials` BIGINT NOT NULL,
  `status` VARCHAR(20) NOT NULL, `description` VARCHAR(255) NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `_bak_v18_orders` (`id`,`uuid`,`user_id`,`plan_id`,`coupon_id`,`amount_rials`,`discount_rials`,`status`,`description`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`user_id`,`plan_id`,`coupon_id`,`amount_rials`,`discount_rials`,`status`,`description`,`created_at`,`updated_at` FROM `orders`;

CREATE TABLE IF NOT EXISTS `_bak_v18_payments` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `order_id` BIGINT UNSIGNED NOT NULL, `gateway` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL, `amount_rials` BIGINT NOT NULL, `gateway_ref` VARCHAR(190) NULL,
  `verified_at` DATETIME NULL, `verify_payload` TEXT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `_bak_v18_payments` (`id`,`uuid`,`order_id`,`gateway`,`status`,`amount_rials`,`gateway_ref`,`verified_at`,`verify_payload`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`order_id`,`gateway`,`status`,`amount_rials`,`gateway_ref`,`verified_at`,`verify_payload`,`created_at`,`updated_at` FROM `payments`;

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
INSERT IGNORE INTO `_bak_v18_deposit_requests` (`id`,`uuid`,`user_id`,`plan_id`,`plan_code`,`amount_rials`,`discount_rials`,`coupon_id`,`reference`,`note`,`status`,`review_note`,`reviewed_by`,`reviewed_at`,`subscription_id`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`user_id`,`plan_id`,`plan_code`,`amount_rials`,`discount_rials`,`coupon_id`,`reference`,`note`,`status`,`review_note`,`reviewed_by`,`reviewed_at`,`subscription_id`,`created_at`,`updated_at` FROM `deposit_requests`;

CREATE TABLE IF NOT EXISTS `_bak_v18_coupons` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `type` VARCHAR(10) NOT NULL,
  `value` INT NOT NULL, `expires_at` DATETIME NULL, `max_uses` INT NULL,
  `used_count` INT NOT NULL, `is_active` TINYINT(1) NOT NULL,
  `created_at` DATETIME NULL, `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `_bak_v18_coupons` (`id`,`uuid`,`code`,`type`,`value`,`expires_at`,`max_uses`,`used_count`,`is_active`,`created_at`,`updated_at`)
  SELECT `id`,`uuid`,`code`,`type`,`value`,`expires_at`,`max_uses`,`used_count`,`is_active`,`created_at`,`updated_at` FROM `coupons`;

CREATE TABLE IF NOT EXISTS `_bak_v18_coupon_redemptions` (
  `id` BIGINT UNSIGNED NOT NULL,
  `uuid` CHAR(36) NOT NULL, `coupon_id` BIGINT UNSIGNED NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(10) NOT NULL, `reference_id` BIGINT UNSIGNED NULL, `discount_rials` BIGINT NOT NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `_bak_v18_coupon_redemptions` (`id`,`uuid`,`coupon_id`,`user_id`,`kind`,`reference_id`,`discount_rials`,`created_at`)
  SELECT `id`,`uuid`,`coupon_id`,`user_id`,`kind`,`reference_id`,`discount_rials`,`created_at` FROM `coupon_redemptions`;

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

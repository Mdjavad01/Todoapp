-- کارام — ارتقای اختیاری به v20 (گام ۲۰: رشد — رفرال + کد هدیه + یادآور تلگرامی)
-- این مهاجرت «اختیاری» است: هر سه قابلیت در اولین استفاده، خودکار و بی‌صدا جدول/ستون/کلید
-- می‌سازند (الگوی DepositSchema). این فایل برای کسی است که همه‌چیز را یک‌جا در phpMyAdmin
-- اجرا می‌کند یا می‌خواهد مطمئن باشد ساختار از قبل آماده است.
-- اجرا: phpMyAdmin ← انتخاب دیتابیس کارام ← SQL ← پیست ← Go

-- ---------- ۱) رفرال: ستون‌های users ----------
ALTER TABLE `users`
  ADD COLUMN `referral_code` VARCHAR(12) NULL DEFAULT NULL COMMENT 'کد یکتای دعوت کاربر',
  ADD COLUMN `referred_by` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'شناسه‌ی دعوت‌کننده';
ALTER TABLE `users` ADD UNIQUE KEY `uq_users_referral_code` (`referral_code`);
ALTER TABLE `users` ADD KEY `idx_users_referred_by` (`referred_by`);

-- ---------- ۲) رفرال: مقدار 'referral' در ENUM اشتراک‌ها ----------
ALTER TABLE `subscriptions` MODIFY `source`
  ENUM('web_gateway','admin_grant','store_bazaar','card_deposit','trial','referral')
  NOT NULL COMMENT 'منبع فعال‌سازی: درگاه / ادمین / بازار / کارت‌به‌کارت / آزمایشی / دعوت دوست';

-- ---------- ۳) کد هدیه: جدول coupons از فاز ۵ به کار گرفته می‌شود ----------
-- اگر نصب شما خیلی قدیمی باشد و جدول coupons را نداشته باشد (بقیه‌ی مراحل اجرا نشود):
CREATE TABLE IF NOT EXISTS `coupons` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)    NOT NULL,
  `code`       VARCHAR(50) NOT NULL,
  `type`       ENUM('percent','amount') NOT NULL,
  `value`      INT         NOT NULL COMMENT 'درصد یا مبلغ به ریال',
  `expires_at` DATETIME    NULL DEFAULT NULL,
  `max_uses`   INT         NULL DEFAULT NULL,
  `used_count` INT         NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupons_code` (`code`),
  UNIQUE KEY `uq_coupons_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ژورنال استفاده (هر کاربر هر کد فقط یک‌بار) — سقف استفاده فقط بعد از تأیید قطعی بالا می‌رود
CREATE TABLE IF NOT EXISTS `coupon_redemptions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`           CHAR(36) NOT NULL,
  `coupon_id`      BIGINT UNSIGNED NOT NULL,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `kind`           ENUM('order','deposit') NOT NULL COMMENT 'سفارش درگاه یا واریز کارت‌به‌کارت',
  `reference_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `discount_rials` BIGINT   NOT NULL DEFAULT 0,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_redemption` (`coupon_id`,`user_id`),
  KEY `idx_coupon_red_user` (`user_id`),
  CONSTRAINT `fk_coupon_red_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`),
  CONSTRAINT `fk_coupon_red_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- ۴) کد هدیه روی واریز کارت‌به‌کارت (سفارش درگاه از فاز ۵ coupon_id دارد) ----------
ALTER TABLE `deposit_requests`
  ADD COLUMN `coupon_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'کد هدیه اعمال‌شده',
  ADD COLUMN `discount_rials` BIGINT NOT NULL DEFAULT 0 COMMENT 'تخفیف کد هدیه (ریال)';

-- ---------- ۵) کلیدهای تنظیمات (رفرال خاموش پیش‌فرض؛ بقیه مطابق نصب) ----------
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('referral_enabled', '0'),
  ('referral_days', '7'),
  ('gift_enabled', '1'),
  ('reminder_enabled', '0'),
  ('reminder_lookback_days', '30');

-- ============================================================
--  کارام — ارتقای دیتابیس MySQL برای فاز ۸ (v0.7)
--  کارت‌به‌کارت با تأیید ادمین
--
--  ⚠️ معمولاً لازم نیست این فایل را اجرا کنید: بک‌اند بار اولی که
--  یکی از مسیرهای واریز صدا زده شود، این تغییرات را خودکار انجام می‌دهد.
--  این فایل برای اجرای دستی (phpMyAdmin → Import) یا بررسی است.
--  امن برای اجرای تکراری؛ به داده‌های موجود آسیب نمی‌زند.
-- ============================================================

-- ۱) جدول درخواست‌های واریز کارت‌به‌کارت
CREATE TABLE IF NOT EXISTS `deposit_requests` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`            CHAR(36)  NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `plan_id`         BIGINT UNSIGNED NULL DEFAULT NULL,
  `plan_code`       VARCHAR(50) NOT NULL,
  `amount_rials`    BIGINT    NOT NULL DEFAULT 0,
  `reference`       VARCHAR(64) NOT NULL COMMENT 'شماره پیگیری/مرجع حواله کاربر',
  `note`            VARCHAR(500) NULL,
  `status`          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `review_note`     VARCHAR(500) NULL COMMENT 'یادداشت ادمین / دلیل رد',
  `reviewed_by`     BIGINT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at`     DATETIME  NULL DEFAULT NULL,
  `subscription_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_deposit_uuid` (`uuid`),
  KEY `idx_deposit_user` (`user_id`,`status`),
  KEY `idx_deposit_status` (`status`,`created_at`),
  CONSTRAINT `fk_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deposit_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۲) افزودن 'card_deposit' به ENUM منبع اشتراک (اجرای تکراری بی‌ضرر است)
ALTER TABLE `subscriptions` MODIFY `source`
  ENUM('web_gateway','admin_grant','store_bazaar','card_deposit')
  NOT NULL COMMENT 'منبع فعال‌سازی: درگاه / اعطای ادمین / بازار / کارت‌به‌کارت';

-- ۳) کلیدهای تنظیمات کارت‌به‌کارت (فقط اگر وجود نداشته باشند)
INSERT IGNORE INTO `settings` (`key`, `value`, `updated_at`) VALUES
  ('deposit_card_enabled', '0', UTC_TIMESTAMP()),
  ('deposit_card_number', '', UTC_TIMESTAMP()),
  ('deposit_card_holder', '', UTC_TIMESTAMP()),
  ('deposit_card_guide', 'مبلغ دقیق همان پلن انتخابی است. بعد از واریز، شماره پیگیری حواله را ثبت کنید؛ معمولاً کمتر از ۱۲ ساعت بررسی و اشتراک فعال می‌شود.', UTC_TIMESTAMP());

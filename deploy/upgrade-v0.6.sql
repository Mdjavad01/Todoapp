-- ============================================================
--  کارام — ارتقای دیتابیس MySQL برای فاز ۵
--  (تلگرام جایگزین بله + حذف کامل کارت‌به‌کارت + درگاه زیبال)
--
--  اجرا: phpMyAdmin → Import (یا mysql < upgrade-v0.6.sql)
--  امن برای اجرای تکراری؛ به داده‌های موجود آسیب نمی‌زند.
-- ============================================================

-- ۱) تلگرام جایگزین بله (نوع هویت‌ها و کدهای OTP)
UPDATE `otp_requests`
  SET `identity_type` = 'telegram'
  WHERE `identity_type` = 'bale';

UPDATE `user_identities`
  SET `type` = 'telegram_chat_id'
  WHERE `type` = 'bale_chat_id';

-- ۲) کلیدهای تنظیمات جدید (فقط اگر وجود نداشته باشند)
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('telegram_bot_token', ''),
  ('telegram_bot_username', ''),
  ('zibal_merchant', '');

-- ۳) حذف کامل کارت‌به‌کارت و میراث بله از تنظیمات
DELETE FROM `settings`
  WHERE `key` IN (
    'provider_bale_enabled',
    'bale_bot_token',
    'bale_bot_username',
    'gateway_card_enabled',
    'card_numbers',
    'card_payment_guide',
    'gateway_aqayepardakht_enabled'
  );

-- ۴) جدول رسیدهای کارت‌به‌کارت دیگر استفاده نمی‌شود
DROP TABLE IF EXISTS `receipts`;

-- ۵) ENUMهای مربوطه — هم‌سو با کد فاز ۵
--    (اگر به‌هر دلیل ردیف کارت‌به‌کارتی وجود داشته باشد، اول هموار می‌شود)
UPDATE `payments`
  SET `gateway` = 'zibal'
  WHERE `gateway` = 'card_to_card';

UPDATE `subscriptions`
  SET `source` = 'admin_grant'
  WHERE `source` = 'card_to_card';

--    payments.gateway: حذف card_to_card (هیچ ردیف کارت‌به‌کارتی نباید وجود داشته باشد)
ALTER TABLE `payments`
  MODIFY `gateway` ENUM('zibal','aqayepardakht') NOT NULL;

--    subscriptions.source: حذف card_to_card؛ store_bazaar رزرو نسخه‌ی اندروید (کافه‌بازار)
ALTER TABLE `subscriptions`
  MODIFY `source` ENUM('web_gateway','admin_grant','store_bazaar') NOT NULL;

--    provider_logs.provider: افزودن telegram و sms (bale برای تاریخچه می‌ماند)
ALTER TABLE `provider_logs`
  MODIFY `provider` ENUM('smtp','bale','telegram','sms','zibal','aqayepardakht') NOT NULL;

-- ۶) ENUMهای هویت — تلگرام و موبایل (موبایل از فاز ۴.۵ در MySQL جا مانده بود)
ALTER TABLE `user_identities`
  MODIFY `type` ENUM('email','mobile','telegram_chat_id') NOT NULL;

ALTER TABLE `otp_requests`
  MODIFY `identity_type` ENUM('email','telegram','mobile') NOT NULL;

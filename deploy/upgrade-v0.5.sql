-- ============================================================
--  کارام — ارتقای دیتابیس MySQL برای فاز ۴.۵
--  (شورتکد OTP ادمین + تنظیمات API/ویس/پروایدر/کارت + تم جنسیتی)
--
--  اجرا: phpMyAdmin → Import (یا mysql < upgrade-v0.5.sql)
--  امن برای اجرای تکراری؛ به داده‌های موجود آسیب نمی‌زند.
-- ============================================================

-- ۱) ستون جنسیت کاربر (برای انتخاب تم دخترانه/پسرانه بعد از ورود)
ALTER TABLE `users`
  ADD COLUMN `gender` ENUM('unset','male','female') NOT NULL DEFAULT 'unset'
  COMMENT 'برای پیشنهاد تم (فاز ۴.۵)' AFTER `display_name`;

-- ۲) کلیدهای تنظیمات جدید (فقط اگر وجود نداشته باشند)
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('api_allow_registration', '1'),
  ('api_max_sync_items', '2000'),
  ('voice_enabled', '0'),
  ('voice_provider', 'off'),
  ('voice_rate', '100'),
  ('voice_pitch', '100'),
  ('voice_lang', 'fa-IR'),
  ('card_payment_guide', ''),
  ('mail_transport', ''),
  ('smtp_host', ''),
  ('smtp_port', ''),
  ('smtp_secure', ''),
  ('smtp_user', ''),
  ('smtp_pass', ''),
  ('smtp_from', ''),
  ('bale_bot_token', ''),
  ('bale_bot_username', ''),
  ('provider_sms_enabled', '0'),
  ('provider_sms_url', ''),
  ('provider_sms_method', 'POST'),
  ('provider_sms_headers', '{}'),
  ('provider_sms_body', '');

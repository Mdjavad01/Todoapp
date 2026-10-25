-- کارام — ارتقای دستی v0.8 (بنر تبلیغات/اطلاعیه‌ها)
-- ⚠️ اجرای این فایل اختیاری است: مهاجرت به‌صورت خودکار و تکرارپذیر
--    (AnnouncementsSchema::ensure) بار اولی که مسیر اطلاعیه صدا زده می‌شود انجام می‌شود.
-- این اسکریپت فقط برای اجرای دستی در phpMyAdmin است (اگر ترجیح دادید).

ALTER TABLE `announcements`
  ADD COLUMN `link_url`  VARCHAR(500) NULL DEFAULT NULL COMMENT 'لینک دکمه‌ی بنر (اختیاری)',
  ADD COLUMN `image_url` VARCHAR(500) NULL DEFAULT NULL COMMENT 'تصویر/GIF بنر — فقط همان دامنه (اختیاری)';

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

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

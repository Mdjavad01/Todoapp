-- کارام — v1.9: حذف حساب با حفظ حداقلی و بی‌نام سوابق مالی (P1 — پاک‌سازی اعتماد)
--
-- چه می‌کند؟ فقط یک تغییر ساختاری:
--   orders.user_id           NOT NULL → NULL (سفارشِ کاربرِ حذف‌شده بی‌نام می‌ماند)
--   deposit_requests.user_id NOT NULL → NULL (واریزِ کاربرِ حذف‌شده بی‌نام می‌ماند)
--
-- چرا؟ endpoint «حذف حساب» (POST /api/v1/account/delete/confirm) بعد از این مهاجرت
--   می‌تواند ردیف کاربر و همه‌ی داده‌هایش را کامل پاک کند ولی ردیف‌های مالی را با
--   user_id=NULL برای حسابداری نگه دارد. قبل از مهاجرت، کسکید FK این ردیف‌ها را
--   هم پاک می‌کرد (نقض الزام حسابداری) یا حذف حساب کلاً ممکن نبود.
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی یک فول‌بک کامل بگیرید:
--    کرون بکاپ (api/cron/backup-db.php) یا mysqldump یا Export phpMyAdmin.
--    این مهاجرت هیچ داده‌ای تغییر نمی‌دهد (فقط nullability) ولی قانون پروژه
--    «پشتیبان کامل قبل از هر مهاجرت» است.
--
-- تکرارپذیر: هر ALTER با INFORMATION_SCHEMA گارد دارد — چند بار اجرا بی‌ضرر است.
-- برگشت‌پذیر: اگر روزی لازم شد برگردانید، اول همه‌ی ردیف‌های user_id IS NULL را
--   حذف/دوباره متصل کنید، بعد MODIFY ... NOT NULL بزنید (در INSTALL توضیح داده شده).
--
-- ترتیب امن آپلود: (۱) اجرای همین SQL   (۲) آپلود api/ جدید
--   اگر فقط کد نو آپلود شود و SQL اجرا نشود، حذف حساب با خطای FK شکست می‌خورد
--   (بقیه‌ی مسیرها بی‌تأثیرند).

-- ===============================================================
-- ۱) orders.user_id → NULL
-- ===============================================================
SET @nullable_orders := (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'user_id'
);
SET @ddl_orders := IF(
  @nullable_orders = 'NO',
  'ALTER TABLE `orders` MODIFY `user_id` BIGINT UNSIGNED NULL DEFAULT NULL',
  'SELECT 1 AS already_nullable_orders'
);
PREPARE st_orders FROM @ddl_orders;
EXECUTE st_orders;
DEALLOCATE PREPARE st_orders;

-- ===============================================================
-- ۲) deposit_requests.user_id → NULL
-- ===============================================================
SET @nullable_deposit := (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deposit_requests' AND COLUMN_NAME = 'user_id'
);
SET @ddl_deposit := IF(
  @nullable_deposit = 'NO',
  'ALTER TABLE `deposit_requests` MODIFY `user_id` BIGINT UNSIGNED NULL DEFAULT NULL',
  'SELECT 1 AS already_nullable_deposit'
);
PREPARE st_deposit FROM @ddl_deposit;
EXECUTE st_deposit;
DEALLOCATE PREPARE st_deposit;

-- ===============================================================
-- ۳) راستی‌آزمایی (خروجی مورد انتظار: YES / YES)
-- ===============================================================
SELECT TABLE_NAME, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'orders' AND COLUMN_NAME = 'user_id')
    OR (TABLE_NAME = 'deposit_requests' AND COLUMN_NAME = 'user_id'));

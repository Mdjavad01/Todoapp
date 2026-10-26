-- کارام — گام ۲: کلید خاموش‌کردن پرداخت‌ها (Kill Switch)
-- این مهاجرت «اختیاری» و تکرارپذیر است: بدون آن هم کلیدها با پیش‌فرض «روشن»
-- کار می‌کنند (رفتار فعلی حفظ می‌شود) — اجرای آن فقط کلیدها را در پنل قابل
-- ویرایش می‌کند (تنظیمات ← کلید اصلی پرداخت).
-- اجرا: phpMyAdmin ← انتخاب دیتابیس کارام ← SQL ← پیست ← Go
--
-- منطق (سمت سرور، backend/src/Payments/PaymentsPolicy.php):
--   effective = payments_master_enabled && (سوییچ پلتفرم) && (حداقل یک روش فعال)
--   پلتفرم از هدر X-App-Platform می‌آید (نبودن = وب).
--   کد هدیه کلید مستقل دارد (gift_enabled از v20) و خاموشی پرداخت روی آن اثر ندارد.
--   سفارش‌های در جریان (callback درگاه) و پروِ فعلی‌ها دست‌نخورده می‌مانند.

INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('payments_master_enabled', '1'),
  ('payments_enabled_web', '1'),
  ('payments_enabled_android', '1'),
  ('payments_disabled_message', '');

# مستندات دیتابیس «کارام»

اسکیمای کامل در فایل [`deploy/install.sql`](../deploy/install.sql) قرار دارد و با اجرای آن روی MySQL/MariaDB 5.7+ همه‌ی جداول + داده‌ی اولیه ساخته می‌شود.

## مشخصات کلی

| ویژگی | مقدار |
|---|---|
| موتور | InnoDB (کلید خارجی + تراکنش) |
| انکودینگ | `utf8mb4` / `utf8mb4_unicode_ci` (پشتیبانی کامل فارسی و ایموجی) |
| منطقه‌ی زمانی | همه‌ی تاریخ‌ها **UTC** (`SET time_zone = '+00:00'`) — نمایش شمسی فقط در UI |
| تعداد جداول | **۲۳** |
| حذف رکورد | **حذف نرم** با ستون `deleted_at` در موجودیت‌های کاربری |
| شناسه‌ی سینک | موجودیت‌های کاربری هم `id` عددی داخلی دارند و هم `uuid CHAR(36)` سمت کلاینت |

## نقشه‌ی جداول

```
users ──┬── user_identities
        ├── otp_requests
        ├── refresh_tokens
        ├── lists ── tasks ──┬── subtasks
        │                    └── reminders
        ├── orders ──┬── payments ── provider_logs
        │            └── receipts
        ├── subscriptions
        └── audit_logs

plans ── orders / subscriptions        coupons ── orders
templates ── template_items
admins ── admin_sessions        admin_roles ── admins
announcements        settings
```

---

## ۱. گروه کاربران و احراز هویت (فاز ۳)

### `users`
کاربران اپ. `uuid` شناسه‌ی سینک بین دستگاه‌ها؛ `status` شامل `active/blocked/deleted`؛ `premium_until` انقضای اشتراک (NULL = کاربر عادی).

### `user_identities`
هویت‌های ورود: `type` ∈ {`email`, `mobile`, `bale_chat_id`}؛ `value` یکتا به‌ازای هر نوع؛ `verified_at` زمان تأیید. یک کاربر می‌تواند چند هویت داشته باشد (یکتایی روی `(type, value)`).

### `otp_requests` — فعال از فاز ۳
درخواست‌های کد یک‌بارمصرف: کد ۶ رقمی (فقط هش HMAC با `APP_SECRET`)، انقضای ۵ دقیقه (`OTP_TTL_MINUTES`)، حداکثر ۵ تلاش (`OTP_MAX_ATTEMPTS`)، محدودسازی ارسال (فاصله‌ی ۶۰ ثانیه، ۵ در ساعت هر حساب، ۲۰ در ساعت هر IP). برای کانال بله، همین جدول دو نقش دارد: رکورد بلیت ۶ حرفی (`identity_value` = بلیت، بعد از اتصال چت `consumed_at` می‌خورد) و رکورد کد واقعی (`identity_value` = `chat_id` عددی). `purpose` ∈ {`login`, `admin_2fa`} — دومی برای ورود دومرحله‌ای ادمین در فاز ۴.

### `refresh_tokens` — فعال از فاز ۳
توکن رفرش **به‌ازای هر دستگاه/هر ورود**: `device_id` (شناسه‌ی دستگاه کلاینت)، `device_name`، `token_hash` (SHA-256؛ مقدار خام هرگز ذخیره نمی‌شود)، چرخش در هر تمدید (قبلی `revoked_at` می‌خورد)، **تشخیص سرقت**: استفاده‌ی مجدد از توکن چرخیده = ابطال خودکار همه‌ی نشست‌های همان کاربر. مبنای «نشست‌های فعال» و «خروج».

---

## ۲. گروه داده‌ی اصلی اپ (فاز ۲)

قرارداد مشترک این گروه: `uuid` (تولید سمت کلاینت)، `updated_at` (پیش‌فرض CURRENT_TIMESTAMP و بروز هنگام UPDATE)، `deleted_at` (NULL = زنده)، و **`applied_at`** (زمان اعمال سمت سرور — از فاز ۲ مبنای کرسر قطعی سینک؛ ایندکس `(user_id, applied_at)`).

### `lists`
لیست‌های کار: `name`، `emoji`، `color`، `sort_order`. کلید خارجی به `users` با `ON DELETE CASCADE`.

### `tasks`
کارها: `list_id`، `title`، `notes`، `priority` ∈ {`urgent`,`high`,`normal`,`low`} (مطابق کلاینت)، `due_date` (DATE)، `due_time` (TIME)، `reminder_minutes`، `repeat` ∈ {`none`,`daily`,`weekly`,`monthly`}، `completed_at` (NULL = انجام‌نشده؛ عمداً boolean نیست تا زمان تکمیل هم ثبت شود). ایندکس روی `(user_id, due_date)` و `(user_id, deleted_at)` برای کوئری‌های «امروز» و «معوقه».

### `subtasks`
زیرکارها: `task_id`، `title`، `sort_order`، `completed_at`. حذف کار → حذف آبشاری زیرکارها.

### `reminders`
یادآورها: `task_id`، `remind_at` (UTC)، وضعیت ارسال (`sent_at`) — در فاز ارسال نوتیفیکیشن استفاده می‌شود.

---

## ۳. گروه اشتراک و پرداخت (فاز ۵)

### `plans`
پلن‌های پرمیوم: `title`، `duration_days`، `price_rial` (**BIGINT — مبلغ فقط از اینجا خوانده می‌شود، هرگز هاردکد**)، `is_active`. داده‌ی اولیه: ماهانه / ۳ماهه / سالانه.

### `coupons`
کد تخفیف: `code` یکتا، `type` ∈ {`percent`,`fixed`}، `amount`، سقف استفاده (`max_uses`، `used_count`)، بازه‌ی اعتبار (`starts_at`/`expires_at`)، `is_active`.

### `orders`
سفارش‌های خرید اشتراک: `user_id`، `plan_id`، `coupon_id`، `amount_rial` (مبلغ نهایی پس از تخفیف — ملاک verify)، `status` ∈ {`created`,`redirected`,`paid`,`failed`,`pending_review`,`approved`,`rejected`,`refunded`}، `tracking_code` (کد پیگیری کارت‌به‌کارت)، `gateway` ∈ {`zibal`,`aghaye_pardakht`,`card_to_card`,`admin_grant`, ...}. شمارنده‌ی کارت مقصد برای **چرخش چند کارت** در کارت‌به‌کارت در `settings` نگهداری می‌شود.

### `payments`
تراکنش هر درگاه: `order_id`، `gateway`، `ref_id` (شناسه‌ی تراکنش درگاه)، `amount_rial`، `status`، `raw_response` (JSON پاسخ کامل درگاه برای ردیابی). **verify باید idempotent باشد** — پرداختِ `paid` دوباره verify نمی‌شود.

### `receipts`
رسید کارت‌به‌کارت: `order_id`، `file_path` (**بیرون از public_html**، نام تصادفی)، `mime_type` (با بررسی واقعی محتوا نه پسوند)، `size_bytes`، وضعیت بررسی. دسترسی به فایل فقط از طریق اسکریپت PHP احراز هویت‌شده (ادمین).

### `subscriptions`
اشتراک فعال کاربر — **مستقل از روش پرداخت**: `user_id`، `plan_id`، `starts_at`، `ends_at`، `source` ∈ {`web_gateway`,`card_to_card`,`admin_grant`,`store_bazaar`,`cafe_bazaar`، ...} → آینده: خرید از مارکت‌های اندروید بدون تغییر اسکیما.

---

## ۴. گروه قالب‌ها (فاز ۴)

### `templates`
قالب‌های آماده (چک‌لیست خرید، کنکور، معاملات و ...): `title`، `description`، `icon`، `category`، `is_premium` (قالب پرمیوم یا رایگان)، `is_active`.

### `template_items`
آیتم‌های هر قالب: `template_id`، `title`، `sort_order`. اعمال قالب = ساخت یک لیست + کارها از روی این آیتم‌ها.

---

## ۵. گروه پنل مدیریت (فاز ۴)

### `admins`
مدیران پنل `/admin` (جدا از کاربران اپ): `username` یکتا، `password_hash` (Argon2id/bcrypt)، `role_id`، `is_active`، `last_login_at`.

### `admin_roles`
نقش‌ها: `superadmin` (دسترسی کامل) و `support` (محدود). داده‌ی اولیه هر دو درج می‌شوند.

### `admin_sessions`
نشست‌های ورود مدیر + توکن دومرحله‌ای اختیاری (OTP ادمین).

---

## ۶. گروه سیستمی

### `announcements`
اطلاعیه‌های درون‌اپ (پیام همگانی): `title`، `body`، `type` (info/warning)، بازه‌ی نمایش.

### `settings`
تنظیمات کلید/مقدار برنامه: نام اپ، لوگو، حالت تعمیر و نگهداری (`maintenance_mode`)، حداقل نسخه‌ی اپ، تنظیمات SMTP/بله/زیبال/آقای‌پرداخت (فعال/غیرفعال)، شماره کارت‌های کارت‌به‌کارت و ... . داده‌ی اولیه با مقادیر پیش‌فرض درج می‌شود.

### `audit_logs`
لاگ حسابرسی: چه کسی (`actor_type`: user/admin + id)، چه کاری (`action`)، روی چه موجودی (`entity_type`، `entity_id`)، `ip`، `meta` (JSON). پایه‌ی «لاگ کامل فعالیت‌ها» در پنل ادمین.

### `provider_logs`
لاگ تماس با سرویس‌دهنده‌های خارجی (SMTP، بله، زیبال، آقای‌پرداخت): `provider`، `action`، `status`، `request`/`response` (بدون رمز خام)، مدت پاسخ — برای عیب‌یابی و «لاگ ارسال» در پنل.

---

## ۷. داده‌ی اولیه (Seed)

با اجرای `install.sql` این رکوردها ساخته می‌شوند:

| جدول | رکوردها |
|---|---|
| `admin_roles` | `superadmin`، `support` |
| `plans` | پلن ماهانه، ۳ ماهه، سالانه (فعال، قیمت‌های پایه — از پنل قابل ویرایش) |
| `settings` | کلیدهای پیش‌فرض (نام اپ = کارام، تعمیر و نگهداری = خاموش، درگاه‌ها = غیرفعال) |

> نام جداول و ستون‌ها قرارداد ثابت پروژه‌اند؛ کد بک‌اند فازهای بعدی دقیقاً از همین نام‌ها استفاده می‌کند.

## ۸. توسعه‌ی محلی بدون MySQL

فایل `deploy/install.sqlite.sql` آینه‌ی همین اسکما برای SQLite است (فقط توسعه/تست؛ روی هاست آپلود نمی‌شود). با `DB_DRIVER=sqlite` در `.env` محلی، `Database.php` به SQLite وصل می‌شود و کل API (شامل سینک) بدون سرور MySQL قابل تست است.

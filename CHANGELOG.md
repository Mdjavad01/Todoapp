# تاریخچه‌ی تغییرات

فرمت بر اساس [Keep a Changelog](https://keepachangelog.com/) و نسخه‌گذاری معنایی (SemVer).

## [0.3.0] — فاز ۳: احراز هویت OTP + نشست‌های چرخشی

### افزودن
- **بک‌اند:**
  - `POST /api/auth/otp/request` — درخواست کد (ایمیل) یا بلیت اتصال (بله) با محدودسازی ارسال (فاصله‌ی حداقلی، سقف ساعتی هر حساب، سقف ساعتی هر IP)
  - `POST /api/auth/otp/bale/poll` — وضعیت بلیت بله؛ خواندن پیام‌های ربات با قفل فایل و کش ۲ ثانیه‌ای (بدون تداخل چند poll هم‌زمان)
  - `POST /api/auth/otp/verify` — تأیید کد و صدور نشست کامل (Access + Refresh)؛ هویت‌های email / bale_chat_id با `verified_at`
  - `POST /api/auth/refresh` — چرخش Refresh Token با **تشخیص سرقت**: استفاده‌ی مجدد از توکن باطل‌شده = ابطال همه‌ی نشست‌های کاربر
  - `POST /api/auth/logout` — ابطال Refresh Token
  - `PATCH /api/v1/me` (نام نمایشی)، `GET /api/v1/me/sessions`، `DELETE /api/v1/me/sessions/{id}` — مدیریت پروفایل و نشست‌ها
  - `GET /api/auth/channels` — کانال‌های ورود فعال (برای UI)
  - `Auth/Otp.php` — کد ۶ رقمی CSPRNG، هش HMAC-SHA256 (فقط هش در DB)، انقضا، سقف تلاش، نرمال‌سازی اعداد فارسی
  - `Auth/RefreshToken.php` — توکن ۶۴ کاراکتری، فقط SHA-256 در DB، چرخش، ابطال تکی/سراسری، فهرست نشست‌های فعال با علامت دستگاه جاری
  - `Services/Mailer.php` — سه مسیر ارسال: `mail()` خود PHP، کلاینت SMTP خام (STARTTLS/SSL/AUTH LOGIN)، و `log` برای توسعه — قالب ایمیل فارسی RTL
  - `Services/BaleBot.php` — درایور Bot API بله (sendMessage/getUpdates با cURL و fallback)، تطبیق بلیت در پیام‌ها، لینک `ble.ir/{bot}?start={ticket}`
- **فرانت‌اند:**
  - جریان کامل ورود OTP در شیت «حساب کاربری و سینک»: انتخاب کانال → ایمیل (کد + شمارش معکوس ارسال مجدد) یا بله (بلیت + لینک ربات + poll خودکار) → ورود کد ۶ رقمی
  - `sync/auth.ts` — سرویس احراز هویت؛ `sync/api.ts` — `authedFetch` با **تمدید خودکار تک‌پرواز (single-flight)** روی ۴۰۱
  - نشست کامل (Access + Refresh + دستگاه) در IndexedDB؛ بازیابی خودکار پس از بازکردن مجدد اپ
  - پروفایل: ویرایش نام نمایشی (inline)، فهرست نشست‌های فعال با بستن هر دستگاه
- **تست:** `tests/phase3-test.php` — ۵۳ سناریوی یکپارچه (OTP/محدودسازی/قفل/انقضا/چرخش/سرقت/نشست‌ها/بله با سرور ساختگی/رگرسیون سینک) — همه سبز
- **ابزار:** `tests/bale-mock.php` — سرور ساختگی Bot API بله برای تست محلی

### تغییر
- `ACCESS_TOKEN_TTL_HOURS` پیش‌فرض از ۷۲۰ به **۲۴ ساعت** (تمدید با Refresh Token)
- `OPEN_SESSION` پیش‌فرض به **0** (ورود مستقیم بدون کد بسته شد — فاز ۲ تمام)
- `deploy/install.sqlite.sql` — جدول‌های `otp_requests` و `refresh_tokens` برای توسعه‌ی محلی اضافه شد

### امنیت
- کدهای OTP و توکن‌های رفرش هرگز خام ذخیره نمی‌شوند (HMAC-SHA256 با `APP_SECRET` / SHA-256)
- `OTP_DEBUG=1` فقط برای توسعه — کد را در پاسخ API هم برمی‌گرداند؛ روی هاست باید 0 باشد

## [0.2.0] — فاز ۲: API کامل داده + سینک دوسویه

### افزودن
- **بک‌اند:**
  - مسیرهای REST کامل برای `lists` / `tasks` / `subtasks` (GET/POST/PATCH/DELETE با پارامتر) — همه Bearer و محدود به داده‌ی خود کاربر
  - `POST /api/auth/session` — ساخت/یافتن کاربر با ایمیل + Access Token بی‌حالت (HMAC-SHA256 با `APP_SECRET`)؛ گیت `OPEN_SESSION` برای فاز ۲
  - `GET /api/v1/me` — پروفایل/تست توکن
  - `POST /api/v1/sync` — سینک دوسویه push/pull با کرسر قطعی `applied_at`، تضارب LWW، بازگشت قطعی نسخه‌ی بازنده، تومب‌استون و احیای رکورد، گارد ساعت، سقف ۲۰۰۰ آیتم
  - `Security/Validator.php` — اعتبارسنجی کامل ورودی (طول/الگو/enum/تاریخ) با پیام‌های فارسی؛ خطاها 422
  - `Database.php` — پشتیبانی `DB_DRIVER` (mysql برای هاست؛ sqlite فقط برای توسعه‌ی محلی) + ست UTC روی اتصال
  - `deploy/install.sqlite.sql` — آینه‌ی اسکیما برای توسعه‌ی محلی
  - `.env.example` — `APP_SECRET`، `ACCESS_TOKEN_TTL_HOURS`، `OPEN_SESSION`، `DB_DRIVER`
- **دیتابیس:** ستون `applied_at` + ایندکس `(user_id, applied_at)` روی `lists`/`tasks`/`subtasks` (کرسر قطعی سینک)
- **فرانت‌اند:**
  - `src/sync/` — موتور سینک (api/session/engine): push پس از هر تغییر (debounce ۱.۵s)، سینک در `online`، بازه‌ی ۶۰ ثانیه‌ای، قفل هم‌زمانی، پاک‌سازی نشست در 401
  - شیت «حساب کاربری و سینک» (نقطه‌ی ورود: سطر «پشتیبان‌گیری در حساب کاربری» در تنظیمات — مطابق طرح) با وضعیت سینک، ورود/خروج
  - نشست + `deviceUuid` پایدار در IndexedDB
  - مهاجرت خودکار شناسه‌های seed فاز ۱ (slug) به UUID استاندارد (seededVersion=2)
  - آیکن `person` + دکمه‌های «سینک الان» و «خروج از حساب»

### اصلاح
- `deploy/.htaccess`: `sw.js` از کش immutable خارج شد (no-cache) تا آپدیت PWA فوری اعمال شود
- seed با UUID v4 واقعی تولید می‌شود (سازگار با قرارداد سینک سرور)

### تصمیم‌های کلیدی
- کرسر سینک بر اساس `applied_at` سرور است نه `updated_at` کلاینت — دستگاه‌های آفلاین که بعداً برنده‌ی LWW می‌شوند هرگز از دست بقیه نمی‌روند
- ورود فاز ۲ بدون کد OTP است و با `OPEN_SESSION=0` در `.env` بسته می‌شود؛ در فاز ۳ جریان OTP (ایمیل/بله) روی همین مسیر جایگزین می‌شود
- یادآورها (reminders) فعلاً محلی می‌مانند و سینک نمی‌شوند (از `reminderMinutes` کار مشتق می‌شوند)
- اعتبار سینک با مجموعه‌ی ۲۸تایی تست یکپارچه + سناریوهای مرورگری (push/pull/آفلاین/دستگاه دوم) تأیید شد

## [0.1.0] — فاز ۱: مهمان آفلاین + PWA

### افزودن
- **فرانت‌اند (React 18 + TS + Vite + Tailwind):**
  - ۱۰ صفحه: خانه، لیست، امروز، آمار، قالب‌ها، بسته‌های شغلی، پرمیوم، حالت خالی، تنظیمات، جستجو
  - ۴ بات‌شیت: افزودن سریع (تشخیص هوشمند تاریخ)، جزئیات کار با زیرکارها، تقویم شمسی، لیست جدید
  - سیستم طراحی کامل Material-3 با فونت وزیرمتن محلی و ۴۲ آیکن SVG محلی
  - تم شب + تعویض رنگ برند از تنظیمات
  - لایه‌ی IndexedDB دست‌ساز (`karam-db`): UUID سمت کلاینت + `updatedAt` + حذف نرم
  - داده‌ی آزمایشی مهندسی‌شده + پشتیبان‌گیری/بازگردانی JSON
  - تشخیص هوشمند تاریخ و ساعت فارسی در افزودن سریع (`smartDate`)
- **PWA:** Manifest فارسی RTL (standalone، maskable icons)، Service Worker تولید خودکار پس از بیلد با precache کامل و cache-first و پاک‌سازی خودکار نسخه‌های قبلی کش
- **بک‌اند (PHP 8.1 خالص):** Front Controller + Router + Response + Config (.env بیرون از ریشه) + Database (PDO، Prepared Statement) + مسیر `GET /api/health`
- **دیتابیس:** `deploy/install.sql` با ۲۳ جدول (utf8mb4، UTC، کلید خارجی، حذف نرم) + داده‌ی اولیه (نقش‌های ادمین، ۳ پلن، تنظیمات پیش‌فرض)
- **استقرار:** `deploy/.htaccess` (CSP فقط 'self'، HSTS، redirect HTTPS، SPA fallback، محافظت فایل‌های حساس، کش immutable برای فایل‌های هش‌شده)، راهنمای کامل نصب cPanel در `docs/INSTALL.md`
- **امنیت:** اسکریپت یک‌بارمصرف `setup-admin.php` (Argon2id/bcrypt + قفل با `.installed` + تغییر نام خود فایل)
- **مستندات:** `README.md`، `docs/TECHNICAL.md`، `docs/DATABASE.md`، `docs/INSTALL.md`

### تصمیم‌های کلیدی
- بدون هیچ CDN خارجی (فونت/آیکن/کتابخانه همه محلی) — مطابق قانون دسترسی کشور
- قرارداد سینک‌پذیری (UUID + updated_at + deleted_at) از روز اول در کلاینت و دیتابیس
- قیمت‌های پرمیوم نمایشی‌اند؛ مبلغ واقعی از فاز ۵ فقط از سرور خوانده می‌شود
- دکمه‌های میکروفون غیرفعال (سرویس وویس‌به‌متن بعداً اضافه می‌شود)

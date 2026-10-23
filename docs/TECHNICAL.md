# مستندات فنی «کارام»

این سند معماری و جزئیات پیاده‌سازی پروژه را شرح می‌دهد. برای نصب، [`INSTALL.md`](INSTALL.md) و برای شرح دیتابیس، [`DATABASE.md`](DATABASE.md) را ببینید.

---

## ۱. نمای کلی معماری

```
┌─────────────────────────────────────────────────────────────┐
│                     مرورگر / PWA (کلاینت)                    │
│                                                             │
│  React 18 + TS ──► Zustand (state) ──► Views (۱۰ صفحه)      │
│       │                                   │                 │
│       ▼                                   ▼                 │
│  Service Worker                    repo.ts (لایه‌ی داده)     │
│  (precache + cache-first)          │                        │
│                                    ▼                        │
│                            IndexedDB «karam-db»              │
│                    (حالت مهمان — کاملاً آفلاین)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ (فاز ۲ به بعد) fetch به /api/*
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              PHP 8.1 خالص (پوشه‌ی /api روی هاست)             │
│   index.php → Router → Controller → Database (PDO prepared) │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
                   MySQL/MariaDB (۲۳ جدول، utf8mb4، UTC)
```

**اصل کلیدی:** در فاز ۱ اپ **۱۰۰٪ آفلاین** است و صفر درخواست شبکه‌ی خارجی می‌زند. لایه‌ی `repo.ts` طوری نوشته شده که در فاز ۲ بدون تغییر Views با سرور سینک شود (قرارداد UUID + `updated_at` + `deleted_at`).

---

## ۲. قوانین ثابت پروژه

| # | قانون | پیاده‌سازی |
|---|---|---|
| ۱ | بدون CDN | فونت وزیرمتن محلی (woff2 در `public/fonts`)، آیکن‌ها SVG اینلاین (`assets/icons`)، همه‌ی کتابخانه‌ها باندل محلی. CSP فقط `'self'`. |
| ۲ | داده‌ی سینک‌پذیر | هر موجودیت: `id` = UUID سمت کلاینت، `updatedAt`، `deleted: boolean` (حذف نرم) |
| ۳ | مبلغ از سرور | قیمت پرمیوم در کد هاردکد نیست؛ فاز ۵ از جدول `plans` خوانده می‌شود |
| ۴ | تاریخ UTC / نمایش شمسی | سرور UTC ذخیره می‌کند؛ `lib/jalali.ts` تبدیل و نمایش جلالی را انجام می‌دهد |
| ۵ | میکروفون غیرفعال | دکمه‌ی میک در UI هست ولی `disabled` است تا فاز سرویس وویس |
| ۶ | UI فارسی RTL | `dir="rtl"`، `lang="fa"`، اعداد فارسی با `Intl` آفلاین |

---

## ۳. فرانت‌اند

### ۳.۱. سیستم طراحی (Design Tokens)

توکن‌های طراحی از موکاپ مرجع استخراج و عیناً در `frontend/tailwind.config.ts` تعریف شده‌اند:

- **رنگ‌ها:** پالت Material-3 با رنگ برند پیش‌فرض `primary = #00685f` (سبزآبی). رنگ برند به‌صورت متغیر CSS (`--m3-primary` و ...) متصل است تا کاربر از تنظیمات بتواند رنگ اپ را عوض کند (۶ گزینه: فیروزه‌ای، سبز، نارنجی، بنفش و ...).
- **تایپوگرافی:** مقیاس کامل فارسی از `display` تا `label-sm` با فونت **وزیرمتن متغیر** (یک فایل woff2 حدود ۱۱۱ کیلوبایت — فقط وزن‌های استفاده‌شده رندر می‌شوند).
- **شکل‌ها:** شعاع گرد Material-3 (سطح‌های `md` و `xl`) و ارتفاع بات‌شیت‌ها مطابق طرح.
- **تم شب:** با کلاس `dark` روی ریشه و متغیرهای CSS پشتیبانی می‌شود؛ همه‌ی سطوح و متن‌ها در هر دو تم تست شده‌اند.

### ۳.۲. آیکن‌ها

- ۴۲ آیکن به‌صورت **فایل SVG جدا** در `src/assets/icons/` هستند (جایگزین کامل Material Symbols گوگل).
- `assets/iconRegistry.ts` نام آیکن → محتوای SVG را نگه می‌دارد و کامپوننت `<Icon name="..." />` آن را رندر می‌کند.
- هیچ فونت آیکن یا درخواست شبکه‌ای در کار نیست.

### ۳.۳. صفحات و مسیرها

روتینگ با وضعیت داخلی (بدون react-router) در `App.tsx` انجام می‌شود — پوسته‌ی موبایل (قاب ۴۱۰px در دسکتاپ) + `TopBar` + محتوا + `BottomNav`:

| view | فایل | توضیح |
|---|---|---|
| `home` | `views/HomeView.tsx` | سلام‌وقبح بر اساس ساعت، نوار پیشرفت امروز، خلاصه‌ی لیست‌ها |
| `listView` | `views/ListView.tsx` | کارهای یک لیست با نوار پیشرفت و فیلتر |
| `todayView` | `views/TodayView.tsx` | کارهای امروز (انجام‌شده/در انتظار) |
| `analytics` | `views/TodayView.tsx` | آمار هفته (نمودار میله‌ای، درصد تکمیل، استریک) |
| `templates` | `views/TemplatesView.tsx` | قالب‌های آماده (چک‌لیست‌های چندآیتمی) |
| `jobkits` | `views/TemplatesView.tsx` | بسته‌های شغلی |
| `paywall` | `views/PaywallView.tsx` | صفحه‌ی پرمیوم (قیمت‌ها نمایشی تا فاز ۵) |
| `emptyState` | `views/SettingsView.tsx` | حالت خالی |
| `settings` | `views/SettingsView.tsx` | تم، رنگ برند، پشتیبان‌گیری |
| `search` | `views/SearchView.tsx` | جستجوی زنده در کارها و لیست‌ها |

بات‌شیت‌ها (`src/modals/`):

- **QuickAddSheet** — افزودن سریع کار؛ متن کار را تحلیل می‌کند: `detectSmartDateTime` در `lib/smartDate.ts` عبارت‌های «امروز/فردا/پس‌فردا»، روزهای هفته، «ساعت X» و ترکیبشان را تشخیص می‌دهد و `dueDate` می‌سازد.
- **TaskDetailSheet** — جزئیات کار: ویرایش عنوان/یادداشت/تاریخ/اولویت/تکرار، زیرکارها (افزودن، تیک، حذف)، یادآور.
- **CalendarSheet** — تقویم **شمسی واقعی** با ناوبری ماه، سال بدون جداکننده‌ی هزارگان، هایلایت امروز و روز انتخابی؛ گرید ماه از `buildMonthGrid` (با اعتبارLeap سال جلالی).
- **NewListSheet** — ساخت لیست جدید (نام، ایموجی، رنگ).

### ۳.۴. مدیریت وضعیت

`store/useAppStore.ts` (Zustand) وضعیت سراسری را نگه می‌دارد: view فعال، لیست‌ها، کارها، زیرکارها، انتخاب فعلی (لیست/کار باز)، تم و رنگ برند. کامپوننت‌ها فقط از store می‌خوانند و هر تغییر داده از طریق `repo.ts` (لایه‌ی IndexedDB) انجام و سپس store به‌روز می‌شود.

### ۳.۵. لایه‌ی داده — IndexedDB

فایل‌ها: `db/idb.ts` (اتصال و اسکیما)، `db/repo.ts` (CRUD)، `db/seed.ts` (داده‌ی آزمایشی)، `db/catalog.ts` (قالب‌ها و رنگ‌ها).

- نام دیتابیس: `karam-db`، نسخه: `1`
- **Object Stores:** `lists`، `tasks`، `subtasks`، `reminders`، `prefs` (تنظیمات کاربر)، `meta` (اطلاعات سیستمی)
- کلید همه‌ی موجودیت‌ها `id` (UUID v4 سمت کلاینت — `lib/uuid.ts`)
- هر رکورد: `createdAt`، `updatedAt`، `deleted` → آماده‌ی سینک دوسویه در فاز ۲
- **حذف نرم:** هیچ رکوردی فیزیکی پاک نمی‌شود؛ `deleted=true` می‌شود (سینک آینده به `deleted_at` سرور نگاشت می‌شود)
- **seed.ts:** داده‌ی آزمایشی مهندسی‌شده (۲۷ کار، ۸ کار امروز با ۵ انجام‌شده، استریک ۷ روز و ...) فقط بار اول تزریق می‌شود (بررسی `meta`).

### ۳.۶. انتخابگرها و قالب‌بندی

`lib/selectors.ts`: پیشرفت لیست، آمار خانه، میله‌های هفته، نرخ تکمیل، استریک فعلی، برچسب اولویت/تکرار، ترتیب لیست‌ها.

`lib/format.ts`: تبدیل اعداد به فارسی (`toFa`)، تاریخ کامل/کوتاه شمسی، ساعت فارسی — همه با `Intl` مرورگر (آفلاین، بدون کتابخانه‌ی تاریخ خارجی).

### ۳.۷. پشتیبان‌گیری کاربر

از تنظیمات می‌توان خروجی JSON از تمام داده‌های IndexedDB گرفت و برگرداند (بازگردانی با تأیید کاربر).

---

## ۴. PWA و آفلاین

- **`manifest.webmanifest`** (در `public/`): نام فارسی «کارام»، `dir: rtl`، `lang: fa`، `display: standalone`، `theme_color: #00685f`، آیکن‌های 192/512 + maskable.
- **Service Worker** با اسکریپت `scripts/generate-sw.mjs` **بعد از هر بیلد تولید می‌شود**:
  1. همه‌ی فایل‌های خروجی `dist` (شامل فایل‌های هش‌شده) لیست و در `PRECACHE_URLS` نوشته می‌شوند.
  2. نام کش `karam-cache-{version}` است؛ نسخه از هش بیلد ساخته می‌شود → هر دیپلوی جدید کش قبلی را **خودکار پاک می‌کند** (`activate` → حذف کش‌های دیگر + `skipWaiting`).
  3. استراتژی: **Cache-first** برای همه‌ی درخواست‌های هم‌مبدا؛ پاسخ‌های جدید در پس‌زمینه کش می‌شوند (stale-while-revalidate ساده).
- **آفلاین واقعی:** بعد از اولین بازدید، قطع اینترنت و رفرش → اپ کامل بالا می‌آید (تست شده با Agent Browser و حالت offline).
- نصب روی گوشی: از منوی مرورگر «Add to Home screen» — چون `display: standalone` است بدون نوار مرورگر باز می‌شود.

---

## ۵. امنیت فرانت

- **CSP سخت‌گیرانه** در `deploy/.htaccess`: فقط `'self'` برای همه‌ی دستورها؛ هیچ اسکریپت/استایل/فونت/تصویر خارجی مجاز نیست (عمداً — قانون بدون CDN).
- **HSTS** فعال (max-age یک سال، includeSubDomains).
- **HTTPS اجباری** (redirect 301) — Service Worker بدون HTTPS/localhost کار نمی‌کند.
- `X-Content-Type-Options: nosniff`، `Referrer-Policy: strict-origin-when-cross-origin`.
- محافظت فایل‌های حساس: `.env*`، فایل‌های `install/`، `storage/` با `Require all denied` بسته‌اند.
- هیچ کلید یا رمزی در کد فرانت وجود ندارد.

---

## ۶. بک‌اند PHP (اسکلت فاز ۱)

### ۶.۱. ساختار

```
backend/
├── public/index.php      ← نقطه‌ی ورود؛ روی هاست در public_html/api/public قرار می‌گیرد
├── src/
│   ├── Config.php        ← خواندن .env از بیرون از public_html (مسیر قابل تنظیم)
│   ├── Database.php      ← PDO با Prepared Statement، utf8mb4، خطاهای استثنا
│   ├── Http/Router.php   ← مسیریابی سبک: متد + الگوی مسیر → Controller
│   ├── Http/Response.php ← پاسخ JSON استاندارد + کد وضعیت
│   └── Controllers/HealthController.php  ← GET /api/health
├── install/setup-admin.php ← اسکریپت یک‌بارمصرف ساخت ادمین
├── storage/logs/         ← لاگ خطاهای PHP (روی وب بسته)
└── .env.example          ← نمونه‌ی تنظیمات
```

### ۶.۲. مسیرهای API (فاز ۲)

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/api/health` | — | سلامت سرویس + وضعیت دیتابیس |
| POST | `/api/auth/session` | — | ساخت/یافتن کاربر با ایمیل + صدور Access Token (فاز ۲ بدون OTP — با کلید `OPEN_SESSION` کنترل می‌شود؛ فاز ۳ با OTP جایگزین می‌شود) |
| GET | `/api/v1/me` | Bearer | پروفایل کاربر جاری (تست اعتبار توکن) |
| GET | `/api/v1/lists` | Bearer | فهرست لیست‌ها (پارامترها: `since`, `includeDeleted`) |
| POST | `/api/v1/lists` | Bearer | ساخت لیست (UUID سمت کلاینت — تکرار = 409) |
| GET/PATCH/DELETE | `/api/v1/lists/{uuid}` | Bearer | نمایش/به‌روزرسانی (LWW)/حذف نرم |
| GET/POST/PATCH/DELETE | `/api/v1/tasks[/{uuid}]` | Bearer | همان الگو + فیلتر `?listId=` |
| GET/POST/PATCH/DELETE | `/api/v1/subtasks[/{uuid}]` | Bearer | همان الگو + فیلتر `?taskId=` |
| POST | `/api/v1/sync` | Bearer | سینک دوسویه — شرح کامل در بخش ۷ |

همه‌ی پاسخ‌ها JSON با `ok` هستند؛ خطاها: 401 (نشست)، 403 (مسدود/OTP لازم)، 404، 409 (تکرار)، 422 (اعتبارسنجی با پیام فارسی).

### ۶.۳. احراز هویت (فاز ۲)

- **Access Token بی‌حالت (Stateless):** `k1.{base64url(payload)}.{HMAC-SHA256}` — کلید امضا `APP_SECRET` در `.env`؛ عمر پیش‌فرض ۷۲۰ ساعت (۳۰ روز).
- **Guard:** هر مسیر `/api/v1/*` توکن را بررسی و کاربر فعال را از دیتابیس می‌خواند؛ کاربر `blocked/deleted` حتی با توکن معتبر رد می‌شود.
- **فاز ۲:** ساخت نشست بدون کد (کلید `OPEN_SESSION=1` در `.env` — بعد از راه‌اندازی OTP در فاز ۳ حتماً «0» می‌شود).
- **فاز ۳:** جریان کامل OTP (ایمیل/بله) + refresh token چرخشی در جدول `refresh_tokens` جایگزین/تکمیل می‌شود.

### ۶.۴. ساخت ادمین (یک‌بارمصرف)

`install/setup-admin.php` از **CLI** اجرا می‌شود:

```bash
php install/setup-admin.php "SETUP_TOKEN" "username" "password"
```

- توکن نصب از `.env` خوانده و با آرگومان مقایسه می‌شود (جلوگیری از اجرای تصادفی).
- رمز با **Argon2id** (و در نبودش bcrypt) هش می‌شود.
- بعد از اجرای موفق: فایل `.installed` ساخته می‌شود و **خود اسکریپت به `setup-admin.disabled.php` تغییر نام می‌دهد** → اجرای دوباره غیرممکن است.
- پوشه‌ی `install/` روی وب با `.htaccess` بسته است.

### ۶.۵. فایل .env

نمونه‌ی کامل در `backend/.env.example`. نکته‌ها:

- `ENV_PATH` مسیر پوشه‌ی فایل `.env` است — پیشنهاد: **بیرون از public_html** (مثل `/home/USERNAME/private`).
- `APP_SECRET` راز امضای توکن — حتماً تصادفی (`openssl rand -hex 32`) و حداقل ۳۲ کاراکتر.
- `OPEN_SESSION` در فاز ۲ «1» است؛ در فاز ۳ (OTP) حتماً «0» شود.
- `DB_DRIVER` روی هاست `mysql` است؛ `sqlite` فقط برای توسعه‌ی محلی (اسکیمای آینه در `deploy/install.sqlite.sql`).
- `SETUP_TOKEN` باید مقدار تصادفی طولانی باشد (`openssl rand -hex 32`).
- فایل واقعی `.env` هرگز در گیت نیست (`backend/.env.example` استثنا شده).

---

## ۷. پروتکل سینک دوسویه (فاز ۲)

### ۷.۱. قرارداد داده

هر موجودیت (لیست/کار/زیرکار) از هر دو سمت با همین شکل JSON رد و بدل می‌شود:

```json
{
  "id": "uuid-v4-کلاینت",
  "createdAt": "2026-10-23T12:00:00.000Z",
  "updatedAt": "2026-10-23T12:00:05.000Z",
  "deletedAt": null,
  "...fields": ""
}
```

### ۷.۲. جریان `POST /api/v1/sync`

**درخواست:**

```json
{
  "cursor": "2026-10-23T12:00:00.000Z",
  "changes": {
    "lists":    [ "...رکوردهای تغییرکرده محلی..." ],
    "tasks":    [ "..." ],
    "subtasks": [ "..." ]
  }
}
```

**پاسخ:**

```json
{
  "ok": true,
  "applied": { "lists": 2, "tasks": 5, "subtasks": 1 },
  "rejected": [ { "entity": "tasks", "id": "...", "reason": "missing_parent" } ],
  "server":   { "lists": ["..."], "tasks": ["..."], "subtasks": ["..."] },
  "cursor":   "2026-10-23T12:00:10.000Z",
  "serverTime": "2026-10-23T12:00:10.000Z"
}
```

### ۷.۳. قواعد همگرایی

| قاعده | توضیح |
|---|---|
| ترتیب اعمال | `lists → tasks → subtasks` تا والد‌ها قبل از فرزندان موجود باشند |
| **LWW** | رکورد با `updatedAt` جدیدتر برنده است؛ مساوی → کلاینت (اعمال دوباره بی‌ضرر/ایده‌مپوتنت) |
| **بازنده‌ی LWW** | نسخه‌ی معتبر سرور **قطعاً در همان پاسخ** برگردانده می‌شود تا هر دو دستگاه همگرا شوند |
| **کرسر قطعی** | پول بر اساس `applied_at` (زمان اعمال سمت سرور) است نه `updated_at` — اگر دستگاهی آفلاین باشد و بعداً با تاریخ عقب‌تر برنده‌ی LWW شود، دستگاه‌های دیگر تغییرش را **از دست نمی‌دهند** |
| حذف نرم | `deletedAt` به‌صورت تومب‌استون سینک می‌شود؛ احیای رکورد (deletedAt=null با updatedAt جدید) پشتیبانی می‌شود |
| گارد ساعت | رکوردی با `updatedAt` جلوتر از ۵ دقیقه آینده‌ی سرور رد می‌شود (`clock skew`) |
| محدودیت | حداکثر ۲۰۰۰ آیتم از هر موجودیت در هر درخواست؛ آیتم‌های معیوب `rejected` می‌شوند و بقیه سالم اعمال می‌شوند |
| یادآورها | در فاز ۲ محلی می‌مانند (از `reminderMinutes` کار مشتق می‌شوند) |

### ۷.۴. موتور کلاینت (`frontend/src/sync/`)

- **api.ts:** پوشش fetch هم‌مبدا (سازگار با CSP 'self') + نگاشت خطاها به پیام فارسی + `authedFetch` با تمدید خودکار تک‌پرواز روی 401 (فاز ۳).
- **session.ts:** نشست کامل (Access + Refresh + دستگاه) + `deviceUuid` پایدار در IndexedDB (prefs).
- **engine.ts:** چرخه‌ی push/pull با قفل هم‌زمانی، debounce ۱.۵ ثانیه بعد از هر تغییر، سینک در رویداد `online`، بازه‌ی ۶۰ ثانیه‌ای و شروع اپ؛ در 401 نهایی (تمدید ناموفق) نشست پاک می‌شود.
- **auth.ts (فاز ۳):** سرویس ورود OTP (request/poll/verify)، خروج با ابطال سمت سرور، پروفایل و نشست‌ها.

---

## ۸. احراز هویت و نشست‌ها (فاز ۳)

### ۸.۱. جریان‌های ورود

| کانال | جریان |
|---|---|
| ایمیل | `POST /api/auth/otp/request` → ایمیل با کد ۶ رقمی → `POST /api/auth/otp/verify {channel:'email', target, code}` |
| بله | `POST /api/auth/otp/request {channel:'bale'}` → بلیت ۶ حرفی + لینک `ble.ir/{bot}?start={ticket}` → کاربر برای ربات می‌فرستد → اپ هر ۳ ثانیه `POST /api/auth/otp/bale/poll` می‌زند → سرور با `getUpdates` پیام را می‌یابد و کد به همان چت می‌فرستد → `verify {channel:'bale', ticket, code}` |

- پاسخ `verify`: `{isNew, user, device, accessToken, expiresAt, refreshToken, refreshExpiresAt}`.
- کاربر/هویت در اولین ورود ساخته می‌شود (`user_identities` با `verified_at`) — ایمیل یا `bale_chat_id`.

### ۸.۲. توکن‌ها

| توکن | ساختار | عمر | ذخیره سمت سرور |
|---|---|---|---|
| Access | `k1.{payload}.{HMAC-SHA256}` بی‌حالت | پیش‌فرض ۲۴ ساعت (`ACCESS_TOKEN_TTL_HOURS`) | هیچ (فقط امضا) |
| Refresh | ۶۴ کاراکتر تصادفی، مخصوص هر دستگاه | ۱۸۰ روز (`REFRESH_TOKEN_TTL_DAYS`) | فقط SHA-256 در `refresh_tokens` + `device_id`/`device_name` |

- **چرخش:** هر `POST /api/auth/refresh` توکن قبلی را باطل و توکن جدید می‌دهد.
- **تشخیص سرقت:** استفاده‌ی مجدد از توکنِ باطل‌شده → ابطال خودکار **همه‌ی** نشست‌های همان کاربر + لاگ امنیتی.
- **معامله‌ی شناخته‌شده:** Access Token بی‌حالت است و تا انقضایش (حداکثر ۲۴ ساعت) حتی بعد از ابطال نشست معتبر می‌ماند — با عمر کوتاه پذیرفته شده است.
- کلاینت: `authedFetch` روی 401 یک‌بار refresh می‌کند و درخواست را تکرار می‌کند؛ چند درخواست هم‌زمان فقط یک refresh می‌زنند (single-flight).

### ۸.۳. امنیت OTP

| مکانیزم | مقدار پیش‌فرض (قابل تنظیم با .env) |
|---|---|
| ذخیره‌سازی | فقط `HMAC-SHA256(code \| type \| value, APP_SECRET)` |
| اعتبار کد | ۵ دقیقه (`OTP_TTL_MINUTES`) |
| فاصله‌ی دو ارسال | ۶۰ ثانیه (`OTP_RESEND_AFTER`) |
| سقف ساعتی هر حساب / هر IP | ۵ / ۲۰ (`OTP_MAX_PER_HOUR` / `OTP_MAX_PER_IP_HOUR`) |
| سقف تلاش اشتباه | ۵ → کد باطل می‌شود (`OTP_MAX_ATTEMPTS`) |
| بلیت بله | ۶ حرفی بدون کاراکتر گنگ، اعتبار ۱۰ دقیقه، یک‌بارمصرف |
| اعداد | ورودی کد نرمال می‌شود (۰-۹ فارسی/عربی → لاتین) |

- ارسال ایمیل: `MAIL_TRANSPORT = mail \| smtp \| log` (پیش‌فرض روی هاست: `mail()`؛ روی sqlite توسعه: `log`).
- درایور بله فقط وقتی فعال است که `BALE_BOT_TOKEN` تنظیم شده باشد؛ `GET /api/auth/channels` وضعیت را به UI می‌دهد.
- خواندن `getUpdates` با قفل فایل + کش ۲ ثانیه‌ای انجام می‌شود تا چند poll هم‌زمان، API بله را دچار تداخل نکند.

### ۸.۴. مدیریت نشست‌ها و پروفایل

- `GET /api/v1/me/sessions?deviceUuid=…` — نشست‌های فعال با علامت «همین دستگاه»؛ `DELETE /api/v1/me/sessions/{id}` — بستن هر نشست (همراه ابطال refresh آن دستگاه).
- `PATCH /api/v1/me {displayName}` — نام نمایشی؛ `GET /api/v1/me` — پروفایل + هویت‌های تأییدشده.

---

## ۹. دیتابیس

۲۳ جدول با InnoDB، `utf8mb4_unicode_ci`، کلید خارجی واقعی و ایندکس‌های لازم. شرح کامل: [`DATABASE.md`](DATABASE.md).

نکته‌های کلیدی:

- همه‌ی تاریخ‌ها **UTC** (`SET time_zone='+00:00'` در اسکریپت نصب و در اتصال PDO).
- موجودیت‌های کاربر (`lists`، `tasks`، `subtasks`، `reminders`) **UUID CHAR(36)** دارند و `updated_at` / `deleted_at` (حذف نرم) — دقیقاً همان قرارداد کلاینت.
- **`applied_at`** (فاز ۲): زمان اعمال سمت سرور در همان سه جدول + ایندکس `(user_id, applied_at)` — مبنای کرسر قطعی سینک.
- داده‌ی اولیه: نقش‌های ادمین، ۳ پلن اشتراک، تنظیمات پیش‌فرض.
- جدول‌های آینده‌نگر (از الان ساخته شده‌اند): `otp_requests`، `refresh_tokens`، `payments`، `receipts`، `coupons`، `templates`، `announcements`، `audit_logs`، `provider_logs` و ...

## ۱۰. امنیت

- **CSP سخت‌گیرانه** در `deploy/.htaccess`: فقط `'self'` برای همه‌ی دستورها؛ هیچ اسکریپت/استایل/فونت/تصویر خارجی مجاز نیست (عمداً — قانون بدون CDN).
- **HSTS** فعال (max-age یک سال، includeSubDomains).
- **HTTPS اجباری** (redirect 301) — Service Worker بدون HTTPS/localhost کار نمی‌کند.
- `X-Content-Type-Options: nosniff`، `Referrer-Policy`، `X-Frame-Options`، `Permissions-Policy` (میکروفون/دوربین خاموش).
- محافظت فایل‌های حساس: `.env*`، فایل‌های `install/`، `storage/` با `Require all denied` بسته‌اند.
- **سمت سرور:** همه‌ی ورودی‌ها از `Validator` می‌گذرند (طول/الگو/محدوده)؛ ۱۰۰٪ کوئری‌ها Prepared Statement؛ مالکیت رکورد در همه‌ی کوئری‌ها با `user_id` بررسی می‌شود؛ بدون کش پاسخ (`no-store`)؛ CORS بسته فقط برای مبدأ خود اپ.
- کش فایل‌ها: فایل‌های هش‌شده `immutable`؛ `index.html` و `sw.js` با `no-cache` (آپدیت PWA فوری).
- هیچ کلید یا رمزی در کد فرانت وجود ندارد.

---

## ۱۱. استقرار

خلاصه‌ی جریان دیپلوی (شرح کامل در `INSTALL.md`):

1. **بیلد محلی:** `bun run build` → خروجی `frontend/dist` (شامل `sw.js` به‌روز).
2. **آپلود:** محتویات `dist` → روت دامنه؛ `deploy/.htaccess` → روت؛ `backend` → `/api`.
3. **دیتابیس:** Import `deploy/install.sql`.
4. **تنظیمات:** `.env` بیرون از public_html.
5. **تست:** `/api/health` + باز کردن اپ + آفلاین‌کردن اینترنت و رفرش.

نکته‌ی کش: فایل‌های هش‌شده با `Cache-Control: immutable` سرو می‌شوند؛ `index.html` و `sw.js` با `no-cache` — پس آپدیت دیپلوی فوراً دیده می‌شود.

---

## ۱۲. آمادگی برای فازهای بعد

| فاز | چه چیزی از الان آماده است |
|---|---|
| ۴ — ادمین | جدول‌های `admins`، `admin_roles`، `audit_logs` آماده؛ اسکریپت ساخت ادمین موجود؛ جدول `otp_requests` از `purpose='admin_2fa'` هم پشتیبانی می‌کند |
| ۵ — پرداخت | جدول‌های `plans`، `orders`، `payments`، `receipts`، `coupons` آماده + داده‌ی اولیه‌ی پلن‌ها |
| ۶ — اندروید | PWA کامل (manifest + SW + آیکن‌های maskable) + API client-ready → قابل بسته‌بندی با Bubblewrap/TWA |

## ۱۳. پنل مدیریت (فاز ۴)

### ۱۳.۱. معماری

```
frontend/admin/            ← SPA مستقل React+TS+Vite (hash-routing، بدون PWA)
├── src/api.ts             ← کلاینت API: Bearer + X-CSRF-Token + هندل ۴۰۱
├── src/views/             ← Login، Dashboard، Users، Plans، Announcements، Settings، Audit
└── dist/                  ← خروجی نهایی → آپلود در public_html/panel/
```

- پنل در مسیر `/panel/` هم‌مبدا با API است؛ مسیریابی با hash (`#/users`) تا روی هر هاست استاتیک کار کند.
- **سازگار با CSP سخت‌گیرانه:** هیچ `style` inline و اسکریپت inline وجود ندارد؛ نمودارها و عناصر داینامیک با CSSOM (`setProperty`) تغییر اندازه می‌گیرند. فونت وزیرمتن و آیکن‌های SVG کاملاً محلی.
- `VITE_API_EXTRA_QUERY` (فقط برای پیش‌نمایش سندباکس) به همه‌ی درخواست‌ها اضافه می‌شود؛ در بیلد production خالی است.

### ۱۳.۲. احراز و نشست ادمین (Auth/AdminGuard.php)

| مورد | مقدار |
|---|---|
| ورود | `POST /api/admin/login {username, password}` → `{token, csrfToken, expiresAt, admin, permissions}` |
| هش رمز | Argon2id (یا bcrypt) — ساخته‌شده با `install/setup-admin.php` |
| قفل حساب | ۵ تلاش ناموفق → ۱۵ دقیقه قفل (`admins.failed_attempts/locked_until`) + تأخیر تصادفی ۱۰۰-۳۰۰ms در پاسخ ناموفق |
| نشست | سمت‌سرور در `admin_sessions` (توکن ۶۴ hex، فقط SHA-256 ذخیره می‌شود) — عمر پیش‌فرض ۱۲ ساعت (`ADMIN_SESSION_TTL_HOURS`) — ابطال‌پذیر با logout |
| CSRF | همه‌ی POST/PATCH/DELETE باید هدر `X-CSRF-Token` برابر با `csrf_token` نشست بفرستند (پنل هم‌مبدا است؛ این لایه‌ی دوم است) |
| دسترسی‌ها | نقش `superadmin` = همه‌چیز؛ بقیه نقش‌ها فقط کلیدهای `true` در `admin_roles.permissions` (JSON) — منبع واحد: `AdminGuard::effectivePermissions()` |
| Audit | همه‌ی اعمال (`admin.login`، `user.update`، `user.premium_grant`، `plan.update`، `announcement.*`، `settings.update`، ...) در `audit_logs` با IP و User-Agent |

### ۱۳.۳. مسیرهای API ادمین

```
POST   /api/admin/login                      عمومی
POST   /api/admin/logout                     CSRF
GET    /api/admin/me                         پروفایل + دسترسی‌های مؤثر
GET    /api/admin/stats                      داشبورد (users/content/sessions/orders/signupsSeries)
GET    /api/admin/users                      ?q=&status=&page=&perPage=  (users.view)
GET    /api/admin/users/{id}                 جزئیات: هویت‌ها + اشتراک‌ها + شمارنده‌ها
PATCH  /api/admin/users/{id}                 {status?, displayName?, premiumUntil?}  (users.manage)
POST   /api/admin/users/{id}/premium         {planCode} یا {months} یا {lifetime:true}
POST   /api/admin/users/{id}/revoke-sessions ابطال همه‌ی Refresh Token های کاربر
GET    /api/admin/plans                      (plans.manage)
PATCH  /api/admin/plans/{id}                 {title?, priceRials?, description?, isActive?, months?, sortOrder?}
GET    /api/admin/announcements              (announcements.manage)
POST   /api/admin/announcements              {title, body, type, isActive, startsAt?, endsAt?}
PATCH  /api/admin/announcements/{id}
DELETE /api/admin/announcements/{id}
GET    /api/admin/settings                   (settings.manage)
PATCH  /api/admin/settings                   {key: value,...} — فقط کلیدهای مجاز + اعتبارسنجی هر کلید
GET    /api/admin/audit                      ?actor=&action=&page=  (audit.view)
```

- **اعطای اشتراک:** تمدید از انتهای `premium_until` فعلی (اگر فعال باشد)؛ دائمی → سنتینل `9999-12-31 23:59:59` در `users.premium_until` + رکورد `subscriptions` با `source='admin_grant'` (برای دائمی `expires_at=NULL`).
- **مسدودسازی کاربر** → ابطال فوری همه‌ی `refresh_tokens` او (خروج از همه‌ی دستگاه‌ها) + `Guard` دیگر توکنش را قبول نمی‌کند.
- **تنظیمات قابل ویرایش از پنل:** `app_name`، `maintenance_mode`، `min_app_version` (x.y.z)، `paywall_title`، `gateway_*_enabled`، `card_numbers` (JSON نرمال‌شده)، `provider_email_enabled`، `provider_bale_enabled` — کلید ناشناس = 422.
- **UI و دسترسی:** ناوبری پنل بر اساس دسترسی‌های برگشتی سرور فیلتر می‌شود؛ ورود مستقیم با hash به صفحه‌ی بدون دسترسی → داشبورد. دکمه‌های عملیات فقط با دسترسی مربوطه رندر می‌شوند (سرور هم مستقلاً 403 می‌دهد).

### ۱۳.۴. توسعه و تست

```bash
php -S 127.0.0.1:8097 tests/panel-router.php   # پنل + API هم‌مبدا (فقط توسعه)
php tests/phase4-test.php                       # تست یکپارچه‌ی API ادمین (۶۲ بررسی)
php tests/seed-demo.php                         # داده‌ی نمایشی (boss/BossPass123 و helper/HelperPass123)
```

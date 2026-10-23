# کارام | دستیار هوشمند مدیریت وظایف 🗂️

وب‌اپ **فارسی و راست‌به‌چپ (RTL)** لیست کارها و چک‌لیست برای دامنه‌ی `app.hojre24shop.ir` — کاملاً آفلاین، بدون هیچ وابستگی به CDN خارجی، آماده‌ی تبدیل به اپ اندروید (PWA).

> نسخه‌ی فعلی: **فاز ۱** — اپ مهمان آفلاین + PWA + اسکلت API + دیتابیس کامل

---

## ✨ امکانات فعلی (فاز ۱)

- **۱۰ صفحه‌ی کامل** مطابق طرح UI: خانه، لیست، امروز، آمار، قالب‌ها، بسته‌های شغلی، پرمیوم، تنظیمات، جستجو و حالت خالی
- **۴ بات‌شیت (Bottom Sheet):** افزودن سریع با تشخیص هوشمند تاریخ فارسی (مثل «فردا ساعت ۱۷»)، جزئیات کار با زیرکارها، تقویم شمسی واقعی با ناوبری ماه، ساخت لیست جدید
- **حالت مهمان آفلاین:** بدون ثبت‌نام؛ داده‌ها در IndexedDB مرورگر ذخیره می‌شود
- **PWA کامل:** نصب روی گوشی، اجرای آفلاین با Service Worker، Manifest فارسی RTL
- **تقویم شمسی:** محاسبه‌ی دقیق جلالی به‌صورت آفلاین (بدون سرویس خارجی)
- **تم شب و تعویض رنگ برند** از تنظیمات
- **طراحی ۱:۱ مطابق موکاپ** — فونت وزیرمتن، رنگ‌های Material-3، آیکن‌های SVG محلی

## 🛠 استک فنی

| بخش | تکنولوژی |
|---|---|
| فرانت‌اند | React 18 + TypeScript 5 + Vite 5 (خروجی استاتیک `dist`) |
| استایل | Tailwind CSS 3.4 با توکن‌های طراحی مرجع |
| وضعیت کلاینت | Zustand |
| داده‌ی محلی | IndexedDB (لایه‌ی دست‌ساز با UUID + حذف نرم) |
| تقویم شمسی | jalaali-js (باندل محلی — بدون CDN) |
| PWA | Service Worker تولید خودکار + Manifest فارسی |
| بک‌اند | PHP 8.1+ خالص (بدون فریم‌ورک) + MySQL/MariaDB با PDO و Prepared Statement |
| هاست هدف | cPanel اشتراکی — بدون Node.js، بدون Docker، بدون root |

## 📁 ساختار پروژه

```
hojre24-tasks/
├── frontend/                     # اپ React + Vite
│   ├── src/
│   │   ├── views/                # ۱۰ صفحه‌ی اپ (HomeView، TodayView، AnalyticsView، ...)
│   │   ├── modals/               # ۴ بات‌شیت (QuickAdd، TaskDetail، Calendar، NewList)
│   │   ├── components/           # BottomNav، TopBar، TaskCard، Sheet، Icon، StatusBar
│   │   ├── assets/               # رجیستری + ۴۲ آیکن SVG محلی
│   │   ├── db/                   # لایه‌ی IndexedDB (idb، repo، seed، catalog)
│   │   ├── store/                # Zustand (useAppStore)
│   │   ├── lib/                  # jalali، format، selectors، smartDate، uuid
│   │   ├── pwa/                  # ثبت Service Worker
│   │   └── styles/               # استایل‌های پایه
│   ├── public/                   # فونت وزیرمتن (محلی)، آیکن‌ها، manifest.webmanifest
│   ├── scripts/                  # generate-sw.mjs، generate-icons.mjs، copy-icons.mjs
│   └── dist/                     # آخرین بیلد production (آماده‌ی آپلود مستقیم روی هاست)
├── backend/                      # API خالص PHP 8.1
│   ├── public/index.php          # نقطه‌ی ورود مسیر /api (Front Controller)
│   ├── src/                      # Config، Database، Router، Response، Controllers
│   ├── install/setup-admin.php   # اسکریپت یک‌بارمصرف ساخت ادمین (خود-غیرفعال‌شونده)
│   ├── storage/logs/             # لاگ خطاهای PHP
│   └── .env.example              # نمونه‌ی تنظیمات (فایل واقعی .env هرگز commit نمی‌شود)
├── deploy/
│   ├── install.sql               # اسکیمای کامل دیتابیس — ۲۳ جدول (utf8mb4، UTC، حذف نرم)
│   └── .htaccess                 # CSP سخت‌گیرانه + HSTS + SPA fallback + محافظت فایل‌ها
├── docs/
│   ├── INSTALL.md                # راهنمای گام‌به‌گام نصب روی cPanel (فارسی)
│   ├── TECHNICAL.md              # مستندات فنی کامل (معماری، لایه‌ها، PWA، امنیت)
│   └── DATABASE.md               # مستندات جداول دیتابیس
├── CHANGELOG.md                  # تاریخچه‌ی تغییرات
└── README.md                     # همین فایل
```

## 🚀 شروع سریع (توسعه‌ی محلی)

```bash
cd frontend
bun install        # یا: npm install
bun run dev        # سرور توسعه → http://localhost:5173
bun run build      # بیلد production → dist/ (ساخت sw.js به‌صورت خودکار)
```

> پیش‌نیاز: Node.js 18+ یا Bun. سرور به Node نیازی ندارد — فقط خروجی `dist` آپلود می‌شود.

## 📦 استقرار روی هاست (خلاصه)

راهنمای کامل در [`docs/INSTALL.md`](docs/INSTALL.md) آمده است. خلاصه:

1. محتویات `frontend/dist/` → روت دامنه (`public_html/`)
2. فایل `deploy/.htaccess` → `public_html/.htaccess`
3. پوشه‌ی `backend/` → `public_html/api/`
4. Import فایل `deploy/install.sql` از phpMyAdmin
5. ساخت `/home/USERNAME/private/.env` از روی `backend/.env.example`
6. تست سلامت: `https://app.hojre24shop.ir/api/health`

## 📜 قوانین ثابت پروژه (غیرقابل تغییر)

1. **بدون CDN:** همه‌ی فونت‌ها، آیکن‌ها و کتابخانه‌ها از دامین خودمان سرو می‌شوند؛ CSP فقط `'self'` را مجاز می‌داند. هیچ درخواست خارجی از مرورگر ارسال نمی‌شود (نه Google Fonts، نه jsDelivr، نه Analytics).
2. **داده‌ی سینک‌پذیر:** هر موجودیت = UUID سمت کلاینت + `updated_at` + `deleted_at` (حذف نرم) — آماده برای سینک ابری و اپ اندروید در فازهای بعد.
3. **مبلغ همیشه از سرور:** قیمت‌های پرمیوم هرگز در کد کلاینت هاردکد نمی‌شوند (فاز ۵).
4. **تاریخ‌ها:** در سرور UTC ذخیره، در رابط کاربری شمسی (جلالی) نمایش داده می‌شود.
5. **میکروفون:** سرویس وویس‌به‌متن فعلاً ساخته نمی‌شود؛ دکمه‌های میک غیرفعال نمایش داده می‌شوند.
6. **متن رابط کاربری:** همیشه فارسی و RTL.

## 🗺 نقشه‌ی راه

- [x] **فاز ۱:** ساختار پروژه، دیتابیس، تنظیمات، UI کامل با داده‌ی آزمایشی، حالت مهمان آفلاین، PWA، قانون بدون CDN
- [ ] **فاز ۲:** API کامل لیست‌ها/کارها/زیرکارها + سینک پایه (حالت حساب کاربری)
- [ ] **فاز ۳:** احراز هویت OTP (ایمیل + بله) + توکن‌ها و مدیریت دستگاه‌ها
- [ ] **فاز ۴:** پنل مدیریت `/admin` (کاربران، قالب‌ها، تنظیمات، لاگ‌ها)
- [ ] **فاز ۵:** اشتراک پرمیوم و پرداخت (زیبال، آقای‌پرداخت، کارت‌به‌کارت)
- [ ] **فاز ۶:** تست کامل، سخت‌سازی امنیتی، راهنمای نصب نهایی و بسته‌بندی اندروید

## 📚 مستندات

| سند | توضیح |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | راهنمای نصب و استقرار روی cPanel |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | معماری، لایه‌های فرانت، IndexedDB، PWA، امنیت، بک‌اند |
| [docs/DATABASE.md](docs/DATABASE.md) | شرح کامل ۲۳ جدول دیتابیس و روابطشان |
| [CHANGELOG.md](CHANGELOG.md) | تاریخچه‌ی نسخه‌ها |

## 📄 مجوز

© Hojre24Shop — همه‌ی حقوق محفوظ است.

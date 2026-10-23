# نصب «کارام» روی هاست اشتراکی cPanel (دامنه‌ی app.hojre24shop.ir)

این راهنما مخصوص **فاز ۱** است: اپ مهمان آفلاین + PWA + ساختار API + دیتابیس.

---

## ۱) پیش‌نیازها

- هاست cPanel با PHP **8.1+** و MySQL/MariaDB
- SSL فعال روی دامنه (Let's Encrypt کافی است) — اپ بدون HTTPS کار نمی‌کند (Service Worker)
- دامنه‌ی `app.hojre24shop.ir` به پوشه‌ای مثل `public_html/app` (یا یک `public_html` اختصاصی) اشاره کند

## ۲) ساخت پوشه‌ها روی هاست

ساختار نهایی این شکلی است:

```
/home/USERNAME/
├── private/                  ← بیرون از public_html (فایل‌های حساس)
│   ├── .env                  ← تنظیمات و کلیدها
│   └── storage/receipts/     ← (فاز ۵) رسیدهای کارت‌به‌کارت
└── public_html/              ← روت دامنه‌ی app.hojre24shop.ir
    ├── index.html            ← از بیلد فرانت (dist)
    ├── assets/               ← از بیلد فرانت
    ├── fonts/  icons/  manifest.webmanifest  sw.js
    ├── .htaccess             ← از deploy/.htaccess
    └── api/                  ← بک‌اند PHP
        ├── .htaccess         ← از backend/.htaccess (بستن دسترسی)
        ├── public/           ← محتوای backend/public (index.php + .htaccess)
        ├── src/              ← کلاس‌های PHP
        └── storage/logs/
```

> اگر `public_html` شما مشترک با سایت اصلی است، بهتر است در cPanel یک **Subdomain** بسازید که DocumentRoot آن یک پوشه‌ی جدا باشد.

## ۳) بیلد فرانت‌اند (روی کامپیوتر خودتان)

```bash
cd frontend
bun install        # یا npm install
bun run build      # یا npm run build
```

خروجی در `frontend/dist/` ساخته می‌شود و شامل `sw.js` به‌روزشده است.

## ۴) آپلود

1. محتویات `frontend/dist/*` را در `public_html/` آپلود کنید.
2. فایل `deploy/.htaccess` را در `public_html/.htaccess` قرار دهید (جایگزین/ادغام با فایل فعلی).
3. پوشه‌ی `backend/` را آپلود کنید:
   - محتوای `backend/public/` → `public_html/api/`
   - پوشه‌های `src/` و `storage/` → داخل `public_html/api/`
   - فایل `backend/.htaccess` → `public_html/api/.htaccess`
4. پوشه‌ی `private/` را در home اکانت بسازید (بیرون از public_html) و دسترسی `700` بدهید.

## ۵) دیتابیس

1. در cPanel: **MySQL Databases** → دیتابیس و کاربر بسازید و کاربر را به دیتابیس با همه‌ی دسترسی‌ها اضافه کنید.
2. از **phpMyAdmin** دیتابیس را انتخاب و فایل `deploy/install.sql` را Import کنید.
3. جداول ساخته می‌شوند + پلن‌های پیش‌فرض و تنظیمات اولیه درج می‌شوند.

## ۶) فایل .env

1. `backend/.env.example` را به `/home/USERNAME/private/.env` کپی کنید.
2. مقادیر دیتابیس (`DB_NAME`, `DB_USER`, `DB_PASS`) را پر کنید.
3. `SETUP_TOKEN` را یک مقدار تصادفی طولانی بگذارید (مثلاً خروجی `openssl rand -hex 32`).
4. دسترسی فایل را `600` بدهید.

## ۷) تست سلامت API

آدرس زیر را باز کنید:

```
https://app.hojre24shop.ir/api/health
```

پاسخ مورد انتظار:

```json
{ "ok": true, "service": "karam-api", "database": "connected", ... }
```

## ۸) ساخت ادمین اصلی (یک‌بارمصرف — اختیاری در فاز ۱)

از **cPanel Terminal** (یا SSH):

```bash
cd ~/public_html/api
php install/setup-admin.php "SETUP_TOKEN" "admin" "Ramz-e-Ghavi-123"
```

> توجه: پوشه‌ی `install` روی وب بسته است؛ اجرای CLI امن‌ترین راه است.
> بعد از اجرا، اسکریپت **خودش را به `setup-admin.disabled.php` تغییر نام می‌دهد** و فایل `.installed` می‌سازد؛ دوباره اجرا شدنش غیرممکن است.
> (پنل ادمین در فاز ۴ اضافه می‌شود.)

## ۹) تست اپ

1. `https://app.hojre24shop.ir` را در موبایل/دسکتاپ باز کنید.
2. بار اول اینترنت لازم است؛ بعد از آن اپ کاملاً آفلاین کار می‌کند (Service Worker).
3. در DevTools → Application → Service Workers، وضعیت «activated» را ببینید.
4. اینترنت را قطع کنید و صفحه را رفرش کنید — اپ باید کامل بالا بیاید.
5. یک کار بسازید، تیک بزنید، حذف کنید؛ مرورگر را ببندید و باز کنید — داده‌ها از IndexedDB برمی‌گردند.

## ۱۰) نکات مهم

- **به‌روزرسانی:** بعد از هر تغییر، دوباره `bun run build` و آپلود `dist`. نسخه‌ی جدید SW خودش کش قبلی را پاک می‌کند؛ اگر آپدیت فوری لازم شد در DevTools → Application → Service Workers → Unregister + پاک کردن Cache.
- **CSP:** سخت‌گیرانه روی `'self'` است. هر منبع خارجی (فونت، اسکریپت CDN و ...) بلاک می‌شود — عمداً.
- **میکروفون:** طبق برنامه، سرویس وویس‌به‌متن فعلاً ساخته نمی‌شود؛ همه‌ی دکمه‌های میک ظاهر غیرفعال دارند.
- خطاهای PHP در `public_html/api/storage/logs/php-error.log` ثبت می‌شوند.

# راهنمای رسمی نصب — کارام v1.12.0 (موج ممیزی پیش از کافه‌بازار)

> **پک:** `karam-host-update-v1.12.0.zip` · **تاریخ:** ۱۴۰۵/۰۸/۱۵ · **بدون SQL**
> ارتقای تجمعی از هر وضعیت ≥ v1.7 به v1.12.0. هر گام برگشت‌پذیر است (روش برگشت در انتهای هر گام).
> این نسخه web/app/api/panel را به‌روز می‌کند؛ **هیچ مهاجرت دیتابیس ندارد** (فقط نصب‌های زیر v1.10.1 به بخش الف نیاز دارند).

## ۰) چی توی این موج است (خلاصه‌ی صاحب محصول)

| # | مورد | ریسک |
|---|---|---|
| ۱ | htaccess واحد روت (K-02): امنیت + کش در یک فایل؛ HSTS آغازین max-age=300 | کم |
| ۲ | رفع شکست CSP صفحات /privacy و /terms (استایل → style.css) | کم |
| ۳ | حذف کامل ژورنال دیسکی OTP (M-06) + تست نو `otp-no-disk-test.php` | کم |
| ۴ | بند «بکاپ و یادآور تلگرامی» در حریم خصوصی/قوانین وب + درون‌اپ (M-02) | صفر |
| ۵ | FileProvider فقط cache/karam-share/ (M-01) — در هر دو APK نو | کم |
| ۶ | کلیدهای check کرون‌ها از .env + حذف __FILE__ (m-06/m-09) | صفر |
| ۷ | لیستینگ صادق بازار + تخفیف واقعی ~۶۸٪ (K-01) | صفر |
| ۸ | CI: تست قبل از بیلد APK (M-08) | صفر |

## الف) مهاجرت دیتابیس — فقط اگر هاست زیر v1.10.1 است

هاست شما v1.10.1+ است → **رد کنید** (هیچ SQL جدیدی در v1.12.0 نیست).
هاست زیر v1.10.1 → `deploy-sql/upgrade-cumulative-1.7-to-1.10.1.sql` در phpMyAdmin (پنج بخش، تکرارپذیر — توضیح در نصب.txt).
**برگشت:** هیچ — فایل‌های SQL مهاجرت داده را برنمی‌گردانند (بکاپ شبانه‌ی هاست مرجع است).

## ب) نصب فایل‌ها (۵ گام)

۱. **بکاپ اول:** پنل ← «بکاپ و پشتیبان» ← دانلود نسخه (بیمه).
۲. **ریشه‌ی پک → public_html** (index.html، assets، fonts، icons، privacy/، terms/، sw.js، manifest و **.htaccess مخفی**). گزینه‌ی Show Hidden Files روشن باشد.
۳. **api/ → جایگزین** (Otp.php، TelegramBot.php، AccountDeletion.php، AdminController.php و سه کرون نو شده‌اند). `storage/` و `.env` هاست دست نخورد.
۴. **panel/ → جایگزین** (صفحه‌ی شورتکد OTP نو).
۵. **deploy-sql/ را آپلود نکنید** — فقط مرجع phpMyAdmin است (داخلش htaccess سد دارد).
**برگشت:** zip وضعیت قبلی public_html را نگه دارید؛ برای برگشت، استخراج مجدد همان zip.

## ج) تست پس از نصب (الزامی — curl + مرورگر)

```bash
# ۱) هدرهای امنیتی
curl -sI https://app.hojre24shop.ir/ | grep -Ei "content-security|strict-transport|x-content|referrer|permissions"
#   ← CSP: default-src 'self' … + Strict-Transport-Security: max-age=300 + nosniff

# ۲) کش immutable
curl -sI https://app.hojre24shop.ir/sw.js | grep -i cache          # ← no-cache, must-revalidate
curl -sI "https://app.hojre24shop.ir/<یک-فایل-hash-دار-js>" | grep -i cache  # ← max-age=31536000, immutable

# ۳) سدها (همه باید 403/404 بدهند)
curl -s -o /dev/null -w "%{http_code}\n" https://app.hojre24shop.ir/api/cron/backup-db.php
curl -s -o /dev/null -w "%{http_code}\n" https://app.hojre24shop.ir/install/config.php
curl -s -o /dev/null -w "%{http_code}\n" https://app.hojre24shop.ir/deploy-sql/install.sql   # اگر آپلود شده باشد

# ۴) سلامت
curl -s https://app.hojre24shop.ir/api/health
```

مرورگر:
- اپ وب ← Ctrl+F5 ← بنر «نسخه‌ی جدید آماده است» ← «بروزرسانی» ← DevTools/Console: **هیچ خطای CSP**.
- `/privacy/` و `/terms/` با استایل کامل باز شوند (اگر بی‌استایل‌اند = style.css آپلود نشده).
- تنظیمات ← کارت «نصب سریع کارام» ← دکمه‌ی نصب (کروم) — رگرسیون v1.11.3.

**پاک‌سازی ژورنال OTP قدیمی (یک‌بار — M-06):** File Manager → `api/storage/cache/` → `issued-otp.jsonl` را حذف کنید (اگر هست). از این به بعد هرگز ساخته نمی‌شود (تست `tests/otp-no-disk-test.php` تضمینش می‌کند).

**افزایش HSTS (بعد از چند روز تأیید سالم):** در `.htaccess` روت، `max-age=300` → `max-age=31536000; includeSubDomains`. تا آن موقع همان ۳۰۰ امن است و اگر خطایی پیش بیاید حداکثر ۵ دقیقه خودش رفع می‌شود.

## د) کرون‌ها

بکاپ 03:30 · پاک‌سازی 04:15 · یادآور 08:00 · تلگرام‌پول هر ۱ دقیقه (اگر گذاشته‌اید).
کلیدهای وضعیت هر کرون از `.env` قابل تغییرند: `BACKUP_CHECK_KEY` / `RETENTION_CHECK_KEY` / `TELEGRAM_POLL_CHECK_KEY` / `REMINDER_CHECK_KEY` — خالی = پیش‌فرض قبلی (بدون تغییر .env همه‌چیز مثل قبل).
دستور کرون با مسیر واقعی هاست (در DirectAdmin): `/usr/local/bin/php /home/USER/public_html/api/cron/backup-db.php` و مشابه برای بقیه.

## ه) پیش از ارسال فرم کافه‌بازار

- [ ] `trial_enabled` = 1 (phpMyAdmin یا پنل ← تنظیمات) — دوره‌ی آزمایشی برای حساب‌های نو
- [ ] فایل قدیمی `api/storage/cache/issued-otp.jsonl` حذف شده
- [ ] **karam-bazaar.apk نوِ این موج** (بیلد ابری) در فرم بازار آپلود شود — لیستینگ نو بخش ۴ِ `docs/BAZAAR-LISTING.md`
- [ ] آیکن ۵۱۲×۵۱۲ از `frontend/public/icons/icon-512.png` + اسکرین‌شات‌های رایگان (خانه/افزودن هوشمند/چک‌لیست معامله‌گری/آمار)
- [ ] تست اشتراک بکاپ روی گوشی با APK نو (M-01) — **نیازمند تست شما روی گوشی واقعی**

## و) رگرسیون سریع (۱۰ گام — همه‌ی نسخه‌ها)

۱) /api/health → ok · ۲) ورود ایمیل با کد · ۳) سینک دو دستگاه · ۴) کارت «نصب سریع کارام» · ۵) بنر بروزرسانی · ۶) /privacy/ و /terms/ با استایل · ۷) پنل ← شورتکد ایمیل → کد در پاسخ · ۸) پنل ← شورتکد تلگرام → «کد به چت ارسال شد» (بدون نمایش کد — تغییر عمدی M-06) · ۹) قالب‌ها + چک‌لیست تریدر · ۱۰) بکاپ دستی ← فایل JSON کامل

## ز) برگشت کامل (اگر چیزی ریخت)

۱) zip وضعیت قبلی public_html را دوباره استخراج کنید (ریشه + api + panel).
۲) هیچ برگشتی دیتابیسی لازم نیست (بدون SQL).
۳) .env هاست همیشه دست‌نخورده بوده — کاری ندارد.
۴) اگر صفحه‌ها بی‌استایل شدند: style.cssهای privacy/terms آپلود نشده‌اند.

<?php

declare(strict_types=1);

/**
 * کارام — کلید خاموش‌کردن پرداخت‌ها (گام ۲)
 *
 * قاعده‌ی تصمیم (همه سمت سرور — اپ فقط نمایش می‌دهد):
 *
 *     effective = masterEnabled && platformEnabled && anyMethodEnabled
 *
 *   - masterEnabled  : payments_master_enabled  (کلید اصلی پنل — توقف اضطراری فروش)
 *   - platformEnabled: payments_enabled_web / payments_enabled_android — پلتفرم از
 *                      هدر X-App-Platform خوانده می‌شود؛ نبودن هدر = وب.
 *                      (سوییچ اندروید برای بستن خرید فقط در اپ؛ مثلاً پیش از بازبینی بازار)
 *   - anyMethodEnabled: حداقل یکی از روش‌ها فعال باشد:
 *                      درگاه زیبال (gateway_zibal_enabled + مرچنت) یا کارت‌به‌کارت
 *                      (deposit_card_enabled + شماره کارت)
 *
 * استثناها — این‌ها هرگز گیت نمی‌شوند تا سفارش‌های در جریان و پروِ فعلی‌ها سالم بمانند:
 *   - callback درگاه (/api/payments/callback) — سفارش‌های قبلی نتیجه‌شان می‌آید
 *   - وضعیت سفارش‌های موجود و اشتراک کاربر (orderStatus / mySubscription)
 *   - استعلام کد هدیه (کلید مستقل gift_enabled — خاموشی پرداخت روی کد هدیه اثر ندارد)
 *   - تأیید/رد واریز از پنل ادمین (مسیرهای /api/admin/deposits)
 *
 * نکته‌ی fail-safe اپ: اندروید با خطای شبکه «بسته» فرض می‌کند (fail-closed) و وب
 * «باز» (fail-open) — ولی این فقط UX است؛ منبع حقیقت همیشه همین Policy سمت سرور است.
 */
final class PaymentsPolicy
{
    /** هدر پلتفرم اپ — از sync/api.ts روی همه‌ی درخواست‌ها ست می‌شود */
    public const PLATFORM_HEADER = 'HTTP_X_APP_PLATFORM';

    /** پلتفرم درخواست جاری؛ مقادیر مجاز: 'web' | 'android' (هر چیز دیگر = وب) */
    public static function platform(): string
    {
        $h = strtolower(trim((string) ($_SERVER[self::PLATFORM_HEADER] ?? '')));
        return $h === 'android' ? 'android' : 'web';
    }

    /** کلید اصلی — پیش‌فرض روشن (رفتار فعلی حفظ می‌شود) */
    public static function masterEnabled(): bool
    {
        return Settings::bool('payments_master_enabled', true);
    }

    /** وضعیت سوییچ پلتفرم — پیش‌فرض روشن */
    public static function platformEnabled(?string $platform = null): bool
    {
        $p = $platform ?? self::platform();
        return Settings::bool($p === 'android' ? 'payments_enabled_android' : 'payments_enabled_web', true);
    }

    /** آیا حداقل یک روش پرداخت (زیبال یا کارت‌به‌کارت) از تنظیمات فعال است؟ */
    public static function anyMethodEnabled(): bool
    {
        $zibal = ZibalProvider::enabled() && trim(ZibalProvider::merchant()) !== '';
        $card = Settings::bool('deposit_card_enabled')
            && trim((string) (Settings::get('deposit_card_number', '') ?? '')) !== '';
        return $zibal || $card;
    }

    /** تصمیم نهایی برای پلتفرم (null = از هدر درخواست جاری) */
    public static function effective(?string $platform = null): bool
    {
        return self::masterEnabled()
            && self::platformEnabled($platform)
            && self::anyMethodEnabled();
    }

    /** پیام نمایشی به کاربر وقتی پرداخت بسته است (از پنل قابل تغییر) */
    public static function disabledMessage(): string
    {
        $msg = trim((string) (Settings::get('payments_disabled_message', '') ?? ''));
        return $msg !== ''
            ? $msg
            : 'پرداخت‌ها موقتاً غیرفعال است؛ لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.';
    }

    /** خروجی GET /api/v1/payments/config — وضعیت کامل برای پلتفرم درخواست‌کننده */
    public static function statusFor(?string $platform = null): array
    {
        $p = $platform ?? self::platform();
        $effective = self::masterEnabled() && self::platformEnabled($p) && self::anyMethodEnabled();
        return [
            'platform' => $p,
            'masterEnabled' => self::masterEnabled(),
            'platformEnabled' => self::platformEnabled($p),
            'anyMethodEnabled' => self::anyMethodEnabled(),
            'effective' => $effective,
            // کلید کد هدیه مستقل است — خاموشی پرداخت روی کدهای هدیه اثر ندارد
            'giftCodesEnabled' => Settings::bool('gift_enabled', true),
            'message' => self::disabledMessage(),
        ];
    }

    /**
     * گارد مسیرهای «شروع پرداخت» — اگر بسته باشد ۴۰۳ با code=payments_disabled
     * می‌فرستد و اجرا را تمام می‌کند (همان الگوی Response + exit در callback).
     */
    public static function assertEnabled(): void
    {
        if (self::effective()) {
            return;
        }
        Response::error(self::disabledMessage(), 403, ['code' => 'payments_disabled']);
        exit;
    }
}

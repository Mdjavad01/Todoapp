<?php

declare(strict_types=1);

/**
 * کارام — کد هدیه / تخفیف (v20 — گام ۲۰ رشد)
 *
 * قاعده‌ی سادگی: کلید gift_codes_enabled در پنل + منطق کوچک؛ ساخت/مدیریت کدها از تب
 * «کدهای هدیه» پنل ادمین. جدول `coupons` از فاز ۵ در اسکیما بوده و حالا به کار
 * گرفته می‌شود (type='percent' یا 'amount'). کد هم به سفارش درگاه می‌خورد
 * (orders.coupon_id) هم به واریز کارت‌به‌کارت (deposit_requests.coupon_id).
 *
 * قواعد:
 *  - percent = ۱..۱۰۰٪ تخفیف؛ amount = مبلغ ثابت «تومان» (از فاز تومان)
 *  - max_uses خالی/۰ یعنی بی‌نهایت؛ expires_at خالی یعنی بدون انقضا
 *  - هر کاربر هر کد فقط یک‌بار (UNIQUE روی coupon_redemptions)
 *  - شمارش استفاده فقط بعد از تأیید قطعی (پرداخت موفق / تأیید ادمین) بالا می‌رود
 *  - مبلغ قابل پرداخت هرگز زیر ۱۰۰ تومان نمی‌رود (معادل کف امن ۱٬۰۰۰ ریالی درگاه/حواله)
 */
final class GiftCode
{
    /** کف مبلغ قابل پرداخت (تومان) — معادل ۱٬۰۰۰ ریال درگاه */
    public const MIN_PAYABLE = 100;

    /** نرمال‌سازی کد: ارقام فارسی → لاتین، حذف فاصله/خط تیره، حروف بزرگ */
    public static function normalize(string $raw): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', Otp::normalizeDigits(trim($raw))) ?? '');
    }

    /**
     * اعتبارسنجی کد برای کاربر و قیمت مشخص + محاسبه‌ی تخفیف — همه‌ی مبالغ «تومان».
     * @return array{ok:true, couponId:int, code:string, discountTomans:int, payableTomans:int}|array{ok:false, error:string}
     */
    public static function quote(PDO $pdo, string $rawCode, int $userId, int $priceTomans): array
    {
        GiftSchema::ensure();

        if (!Settings::bool('gift_codes_enabled', true)) {
            return ['ok' => false, 'error' => 'کد هدیه فعلاً غیرفعال است'];
        }
        $code = self::normalize($rawCode);
        if (!preg_match('/^[A-Z0-9]{3,50}$/', $code)) {
            return ['ok' => false, 'error' => 'کد هدیه نامعتبر است'];
        }
        if ($priceTomans < self::MIN_PAYABLE) {
            return ['ok' => false, 'error' => 'قیمت این پلن برای اعمال تخفیف معتبر نیست'];
        }

        $stmt = $pdo->prepare(
            'SELECT id, code, type, value, max_uses, used_count, is_active, expires_at
             FROM coupons WHERE code = :c LIMIT 1'
        );
        $stmt->execute([':c' => $code]);
        $row = $stmt->fetch();
        if ($row === false) {
            return ['ok' => false, 'error' => 'کد هدیه پیدا نشد'];
        }
        if ((int) $row['is_active'] !== 1) {
            return ['ok' => false, 'error' => 'این کد غیرفعال شده است'];
        }
        if ($row['expires_at'] !== null && (string) $row['expires_at'] <= gmdate('Y-m-d H:i:s')) {
            return ['ok' => false, 'error' => 'مهلت استفاده از این کد تمام شده است'];
        }
        $maxUses = $row['max_uses'] === null ? 0 : (int) $row['max_uses'];
        if ($maxUses > 0 && (int) $row['used_count'] >= $maxUses) {
            return ['ok' => false, 'error' => 'سقف استفاده‌ی این کد پر شده است'];
        }

        // هر کاربر هر کد فقط یک‌بار
        $red = $pdo->prepare('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = :g AND user_id = :u');
        $red->execute([':g' => (int) $row['id'], ':u' => $userId]);
        if ((int) $red->fetchColumn() > 0) {
            return ['ok' => false, 'error' => 'شما قبلاً از این کد استفاده کرده‌اید'];
        }

        $price = max(0, $priceTomans);
        $discount = (string) $row['type'] === 'percent'
            ? (int) floor($price * max(0, min(100, (int) $row['value'])) / 100)
            : min(max(0, (int) $row['value']), $price);
        $payable = max(self::MIN_PAYABLE, $price - $discount);
        $discount = $price - $payable; // اگر کف مبلغ فعال شد، تخفیف واقعی همان است

        return [
            'ok' => true,
            'couponId' => (int) $row['id'],
            'code' => (string) $row['code'],
            'discountTomans' => $discount,
            'payableTomans' => $payable,
        ];
    }

    /**
     * ثبت استفاده از کد — فقط بعد از تأیید قطعی (پرداخت موفق درگاه / تأیید ادمین).
     * گیت: اگر کلید gift_codes_enabled خاموش باشد، استفاده‌ی جدید ثبت نمی‌شود (ثبت بی‌صدا
     * رد می‌شود) — ولی هیچ‌وقت Exception نمی‌دهد: پرداخت/واریز هرگز به‌خاطر ژورنال هدیه نمی‌شکند.
     * بی‌صدا: اگر ثبت قبلاً انجام شده بود (UNIQUE) هیچ اثر مضاعفی ندارد.
     */
    public static function registerRedemption(PDO $pdo, ?int $couponId, int $userId, string $kind, ?int $referenceId, int $discountTomans): void
    {
        if ($couponId === null || $couponId < 1 || $discountTomans <= 0) {
            return;
        }
        if (!in_array($kind, ['order', 'deposit'], true)) {
            return;
        }
        if (!Settings::bool('gift_codes_enabled', true)) {
            return; // گیت کلید کد هدیه — ثبت جدید بی‌صدا رد می‌شود (پرداخت سالم می‌ماند)
        }
        try {
            $ins = $pdo->prepare(
                'INSERT INTO coupon_redemptions (uuid, coupon_id, user_id, kind, reference_id, discount_tomans, created_at)
                 VALUES (:uuid, :g, :u, :k, :r, :d, :now)'
            );
            $ins->execute([
                ':uuid' => Uuid::v4(),
                ':g' => $couponId,
                ':u' => $userId,
                ':k' => $kind,
                ':r' => $referenceId,
                ':d' => $discountTomans,
                ':now' => gmdate('Y-m-d H:i:s'),
            ]);
            $pdo->prepare('UPDATE coupons SET used_count = used_count + 1, updated_at = :now WHERE id = :id')
                ->execute([':id' => $couponId, ':now' => gmdate('Y-m-d H:i:s')]);
        } catch (Throwable $e) {
            // تکراری بودن (UNIQUE) یا هر خطای دیگر — پرداخت/واریز نباید به‌خاطر ژورنال هدیه بشکند
            error_log('[karam][gift] ثبت استفاده از کد هدیه #' . $couponId . ' ثبت نشد: ' . $e->getMessage());
        }
    }

    /** کد تصادفی ۸ حرفی یکتا در دیتابیس */
    public static function randomCode(PDO $pdo): string
    {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM coupons WHERE code = :c');
        for ($i = 0; $i < 8; $i++) {
            $code = Referral::randomCode();
            $stmt->execute([':c' => $code]);
            if ((int) $stmt->fetchColumn() === 0) {
                return $code;
            }
        }
        // عملاً غیرقابل‌تصور — کد بلندتر با پسوند زمان
        return substr(Referral::randomCode() . gmdate('His'), 0, 12);
    }
}

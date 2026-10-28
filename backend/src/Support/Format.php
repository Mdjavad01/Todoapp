<?php

declare(strict_types=1);

/**
 * کارام — قالب‌بندی فارسی مبلغ تومان (فاز تومان)
 *
 * «formatToman» — یک قرارداد واحد در سه سمت (اپ TS / پنل TS / سرور PHP) با تست یکسان:
 *   ۹۹۰        → «۹۹۰ تومان»              (زیر ۱۰۰۰)
 *   ۴۹٬۰۰۰     → «۴۹ هزار تومان»          (مضرب ۱۰۰۰ و زیر ۱ میلیون)
 *   ۴۹۰٬۰۰۰    → «۴۹۰ هزار تومان»
 *   ۴۹٬۵۰۰     → «۴۹٬۵۰۰ تومان»           (غیرمضرب — گروه‌بندی کامل با «٬»)
 *   ۱٬۰۰۰٬۰۰۰  → «۱ میلیون تومان»         (مضرب میلیون)
 *   ۱٬۲۰۰٬۰۰۰  → «۱٫۲ میلیون تومان»       (مضرب ۱۰۰هزار بالای میلیون — یک اعشار)
 *   ۱٬۲۳۴٬۵۶۷  → «۱٬۲۳۴٬۵۶۷ تومان»        (بقیه — گروه‌بندی کامل)
 *
 * واحد پول در کل سامانه از این فاز به بعد «تومان صحیح» است؛ ریال فقط داخل
 * درایور درگاه (ZibalProvider ×۱۰) ساخته می‌شود و هرگز به بیرون درگاه نمی‌آید.
 */
final class Format
{
    public const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    private const GROUP = '٬'; // U+066C جداکننده‌ی هزارگان فارسی
    private const DECIMAL = '٫'; // U+066B ممیز فارسی

    /** ارقام لاتین → فارسی (اعداد صحیح) */
    public static function faInt(int $n): string
    {
        $s = (string) abs($n);
        $out = str_replace(
            ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            self::FA_DIGITS,
            $s
        );
        return $n < 0 ? '−' . $out : $out;
    }

    /** گروه‌بندی هزارگان با جداکننده‌ی فارسی: 49500 → «۴۹٬۵۰۰» */
    public static function faGroup(int $n): string
    {
        $s = number_format(abs($n), 0, '.', ',');
        $out = str_replace(
            ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ','],
            [...self::FA_DIGITS, self::GROUP],
            $s
        );
        return $n < 0 ? '−' . $out : $out;
    }

    /** عدد یک‌اعشاری فارسی: 1.2 → «۱٫۲» (بدون صفر انتهایی) */
    private static function faDecimal1(float $m): string
    {
        $whole = (int) floor($m);
        $frac = (int) round(($m - $whole) * 10);
        if ($frac >= 10) { // گردشدن به بالا: 1.99 → ۲
            $whole += 1;
            $frac = 0;
        }
        return $frac === 0 ? self::faInt($whole) : self::faInt($whole) . self::DECIMAL . self::faInt($frac);
    }

    /**
     * تومان صحیح → متن فارسی (سه حالت: تومان ساده / هزار تومان / میلیون تومان).
     * ورودی منفی = صفر. خروجی همیشه با واحد «تومان» تمام می‌شود.
     */
    public static function toman(int $tomans): string
    {
        $t = max(0, $tomans);
        if ($t < 1000) {
            return self::faInt($t) . ' تومان';
        }
        if ($t % 1_000_000 === 0) {
            return self::faInt(intdiv($t, 1_000_000)) . ' میلیون تومان';
        }
        if ($t >= 1_000_000 && $t % 100_000 === 0) {
            return self::faDecimal1($t / 1_000_000) . ' میلیون تومان';
        }
        if ($t % 1000 === 0) {
            return self::faInt(intdiv($t, 1000)) . ' هزار تومان';
        }
        return self::faGroup($t) . ' تومان';
    }
}

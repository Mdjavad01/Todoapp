<?php

declare(strict_types=1);

/**
 * کارام — اعتبارسنج ورودی سمت سرور
 * همه‌ی داده‌ی کلاینت قبل از رسیدن به دیتابیس از اینجا رد می‌شود.
 */

final class Validator
{
    /** رشته‌ی الزامی/اختیاری با محدوده‌ی طول */
    public static function str(array $data, string $key, int $min, int $max, bool $required = true): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || (is_string($v) && trim($v) === '')) {
            if ($required) {
                throw new ValidationError("فیلد «{$key}» الزامی است");
            }
            return null;
        }
        if (!is_string($v)) {
            throw new ValidationError("فیلد «{$key}» باید متن باشد");
        }
        $v = trim($v);
        $len = mb_strlen($v);
        if ($len < $min || $len > $max) {
            throw new ValidationError("طول فیلد «{$key}» باید بین {$min} تا {$max} کاراکتر باشد");
        }
        // هیچ کنترلی از \0 عبور نمی‌کند
        if (str_contains($v, "\0")) {
            throw new ValidationError("فیلد «{$key}» حاوی کاراکتر نامعتبر است");
        }
        return $v;
    }

    /** مقدار مجاز از یک مجموعه */
    public static function enum(array $data, string $key, array $allowed, ?string $default = null, bool $required = true): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required && $default === null) {
                throw new ValidationError("فیلد «{$key}» الزامی است");
            }
            return $default;
        }
        if (!is_string($v) || !in_array($v, $allowed, true)) {
            throw new ValidationError("مقدار فیلد «{$key}» نامعتبر است");
        }
        return $v;
    }

    /** عدد صحیح در محدوده */
    public static function int(array $data, string $key, int $min, int $max, ?int $default = null, bool $required = false): ?int
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required && $default === null) {
                throw new ValidationError("فیلد «{$key}» الزامی است");
            }
            return $default;
        }
        if (is_bool($v) || !is_numeric($v)) {
            throw new ValidationError("فیلد «{$key}» باید عدد باشد");
        }
        $iv = (int) $v;
        if ($iv < $min || $iv > $max) {
            throw new ValidationError("فیلد «{$key}» باید بین {$min} تا {$max} باشد");
        }
        return $iv;
    }

    /** بولین */
    public static function bool(array $data, string $key, ?bool $default = null): ?bool
    {
        $v = $data[$key] ?? null;
        if ($v === null) {
            return $default;
        }
        if (is_bool($v)) {
            return $v;
        }
        if (is_int($v) && ($v === 0 || $v === 1)) {
            return (bool) $v;
        }
        throw new ValidationError("فیلد «{$key}» باید درست/نادرست باشد");
    }

    /** UUID نسخه ۴ */
    public static function uuid(array $data, string $key, bool $required = true): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw new ValidationError("فیلد «{$key}» الزامی است");
            }
            return null;
        }
        if (!is_string($v) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $v)) {
            throw new ValidationError("مقدار «{$key}» باید UUID معتبر باشد");
        }
        return strtolower($v);
    }

    /** تاریخ ISO UTC (کامل، با زمان) → «Y-m-d H:i:s» UTC */
    public static function isoDateTime(array $data, string $key, bool $required = true): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw new ValidationError("فیلد «{$key}» الزامی است");
            }
            return null;
        }
        if (!is_string($v)) {
            throw new ValidationError("فیلد «{$key}» باید تاریخ باشد");
        }
        $ts = strtotime($v);
        if ($ts === false) {
            throw new ValidationError("فرمت تاریخ «{$key}» نامعتبر است");
        }
        return gmdate('Y-m-d H:i:s', $ts);
    }

    /** تاریخ بدون زمان «YYYY-MM-DD» */
    public static function dateOnly(array $data, string $key): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            throw new ValidationError("فرمت «{$key}» باید YYYY-MM-DD باشد");
        }
        [$y, $m, $d] = array_map('intval', explode('-', $v));
        if (!checkdate($m, $d, $y)) {
            throw new ValidationError("تاریخ «{$key}» نامعتبر است");
        }
        return $v;
    }

    /** زمان «HH:MM» */
    public static function timeOnly(array $data, string $key): ?string
    {
        $v = $data[$key] ?? null;
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
            throw new ValidationError("فرمت «{$key}» باید HH:MM باشد");
        }
        return $v;
    }

    /** ایمیل استاندارد */
    public static function email(array $data, string $key = 'email'): string
    {
        $v = self::str($data, $key, 5, 190);
        if ($v === null || !filter_var($v, FILTER_VALIDATE_EMAIL)) {
            throw new ValidationError('ایمیل معتبر نیست');
        }
        return mb_strtolower($v);
    }
}

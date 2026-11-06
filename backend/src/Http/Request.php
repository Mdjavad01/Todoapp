<?php

declare(strict_types=1);

/**
 * کارام — پوشش درخواست HTTP (بدون وابستگی خارجی)
 */

final class Request
{
    /** @var array<string,mixed>|null */
    private static ?array $jsonBody = null;

    /** توکن Bearer از هدر Authorization */
    public static function bearer(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = array_change_key_case((array) apache_request_headers(), CASE_LOWER);
            $header = (string) ($headers['authorization'] ?? '');
        }
        if (preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $header, $m)) {
            return $m[1];
        }
        return null;
    }

    /** بدنه‌ی JSON درخواست — همیشه آرایه (بدنه‌ی نامعتبر = آرایه‌ی خالی) */
    public static function json(): array
    {
        if (self::$jsonBody !== null) {
            return self::$jsonBody;
        }
        $raw = file_get_contents('php://input') ?: '';
        if (trim($raw) === '') {
            self::$jsonBody = [];
            return self::$jsonBody;
        }
        $parsed = json_decode($raw, true);
        self::$jsonBody = is_array($parsed) ? $parsed : [];
        return self::$jsonBody;
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? null;
        return is_string($v) && $v !== '' ? $v : $default;
    }

    /**
     * IP کاربر — برای محدودسازی و لاگ.
     *
     * پیش‌فرض: فقط REMOTE_ADDR (رفتار بومی PHP — امن در نصب مستقیم بدون پروکسی).
     *
     * پشت CDN/پروکسی (مثل Cloudflare) REMOTE_ADDR آی‌پی پروکسی است و سقف نرخ
     * OTP بر پایه‌ی IP برای همه‌ی کاربران یکی می‌شود (یا با دستکاری هدر دور زده
     * می‌شود). با کلید «TRUST_PROXY=1» (در .env هاست یا متغیر محیطی سیستم —
     * خواندن با Config::get که .env را هم می‌بیند) این متد هدر پروکسی را می‌خواند؛
     * هرگز پیش‌فرض نیست — چون در نصب بدون پروکسی، هدرها از سمت کلاینت قابل
     * جعل‌اند و فعال‌کردن کورکورانه یعنی دورزدن کل سقف‌های نرخ.
     */
    public static function ip(): string
    {
        if (Config::get('TRUST_PROXY') === '1') {
            // Cloudflare: آی‌پی واقعی مشتری
            $cf = trim((string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
            if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP) !== false) {
                return $cf;
            }
            // زنجیره‌ی X-Forwarded-For: از راست به چپ می‌خوانیم — راست‌ترین IP
            // همان است که نزدیک‌ترین پروکسیِ مطمئن اضافه کرده (راست‌ترین عضو
            // جعل‌ناپذیرترین عضو از دید سرور است؛ چپ‌ترین عضو را کلاینت می‌تواند
            // خودش تزریق کند). هر عضو نامعتبر نادیده گرفته می‌شود.
            $xff = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
            if ($xff !== '') {
                $parts = explode(',', $xff);
                for ($i = count($parts) - 1; $i >= 0; $i--) {
                    $cand = trim($parts[$i]);
                    if ($cand !== '' && filter_var($cand, FILTER_VALIDATE_IP) !== false) {
                        return $cand;
                    }
                }
            }
        }
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }
}

/** خطای اعتبارسنجی — پیام فارسی برای کلاینت */
final class ValidationError extends Exception
{
}

<?php

declare(strict_types=1);

/** پاسخ JSON استاندارد + هدرهای امنیتی + CORS بسته (فقط دامین خودمان) */
final class Response
{
    /** @param array<string,mixed> $data */
    public static function json(array $data, int $status = 200): void
    {
        http_response_code($status);
        self::headers();
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function error(string $message, int $status = 400, array $extra = []): void
    {
        self::json(array_merge(['ok' => false, 'error' => $message], $extra), $status);
    }

    public static function ok(array $data = []): void
    {
        self::json(array_merge(['ok' => true], $data));
    }

    /** هدرهای امنیتی مشترک همه‌ی پاسخ‌های API */
    public static function headers(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
        header('Cache-Control: no-store');
        // CORS بسته: فقط مبدأ خود اپ (از تنظیمات) مجاز است
        $allowed = Config::get('APP_URL', '');
        if ($allowed !== '' && isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] === $allowed) {
            header('Access-Control-Allow-Origin: ' . $allowed);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, Authorization');
            header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE');
        }
    }
}

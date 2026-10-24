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
        // CORS بسته: فقط مبداهای لیست‌سفید مجازند
        //  - APP_URL: خود اپ وب
        //  - CORS_EXTRA_ORIGINS: مبداهای اضافه با کاما (فاز ۶) — مثلاً WebView اپ اندروید https://localhost
        $allowedList = self::allowedOrigins();
        $origin = isset($_SERVER['HTTP_ORIGIN']) ? trim((string) $_SERVER['HTTP_ORIGIN']) : '';
        if ($origin !== '' && in_array($origin, $allowedList, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, Authorization');
            header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE');
        }
    }

    /** @return list<string> لیست مبداهای مجاز CORS — بدون مقدار خالی */
    public static function allowedOrigins(): array
    {
        $list = [trim((string) Config::get('APP_URL', ''))];
        $extra = trim((string) Config::get('CORS_EXTRA_ORIGINS', ''));
        if ($extra !== '') {
            foreach (explode(',', $extra) as $o) {
                $list[] = trim($o);
            }
        }
        return array_values(array_unique(array_filter($list, static fn (string $o): bool => $o !== '')));
    }
}

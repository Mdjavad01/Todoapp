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

    /** IP کاربر — برای محدودسازی و لاگ */
    public static function ip(): string
    {
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

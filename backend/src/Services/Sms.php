<?php

declare(strict_types=1);

/**
 * کارام — درایور پیامک عمومی (بدون وابستگی به شرکت خاص) — فاز ۴.۵
 *
 * چون هنوز سند رسمی از هیچ شرکت پیامکی نداریم، یک درایور HTTP عمومی ساخته‌ایم
 * که از پنل مدیریت تنظیم می‌شود:
 *   provider_sms_enabled  → روشن/خاموش کانال ورود با شماره موبایل
 *   provider_sms_url      → آدرس کامل API (مثال فرضی: https://sms.example.ir/api/send)
 *   provider_sms_method   → GET یا POST
 *   provider_sms_headers  → JSON هدرها (مثلاً {"Authorization":"Bearer xxx"})
 *   provider_sms_body     → قالب بدنه — با {phone} و {code} جایگزین می‌شود
 *                            (خالی = پارامترهای phone و code در کوئری/فرم)
 *
 * اگر URL تنظیم نشده باشد، ارسال «log» می‌شود (کد در ژورنال سرور ثبت و در
 * شورتکد ادمین قابل دیدن است) تا بدون شرکت پیامک هم بتوان جریان را تست کرد.
 */

final class Sms
{
    public static function enabled(): bool
    {
        return Settings::bool('provider_sms_enabled');
    }

    /** @return array{ok:bool, mode:'http'|'log', error?:string} */
    public static function sendCode(string $phone, string $code): array
    {
        $url = trim((string) (Settings::get('provider_sms_url', '') ?? ''));
        if ($url === '') {
            return self::sendToLog($phone, $code);
        }

        $method = strtoupper(Settings::get('provider_sms_method', 'POST') ?? 'POST');
        $bodyTpl = trim((string) (Settings::get('provider_sms_body', '') ?? ''));
        $headers = self::decodeHeaders((string) (Settings::get('provider_sms_headers', '{}') ?? '{}'));

        [$finalUrl, $body] = self::buildRequest($url, $method, $bodyTpl, $phone, $code);

        $ch = curl_init($finalUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($resp === false || $status >= 400) {
            error_log("[karam][sms] ارسال ناموفق status={$status} err={$err} resp=" . var_export($resp, true));
            return ['ok' => false, 'mode' => 'http', 'error' => 'ارسال پیامک ناموفق بود'];
        }
        return ['ok' => true, 'mode' => 'http'];
    }

    /** @return array{0:string,1:?string} [url نهایی، بدنه] */
    private static function buildRequest(string $url, string $method, string $bodyTpl, string $phone, string $code): array
    {
        $placeholders = ['{phone}' => rawurlencode($phone), '{code}' => rawurlencode($code)];
        if ($bodyTpl !== '') {
            $body = strtr($bodyTpl, ['{phone}' => $phone, '{code}' => $code]);
            if ($method === 'GET') {
                // قالب در GET یعنی کوئری‌استرینگ
                $sep = str_contains($url, '?') ? '&' : '?';
                return [$url . $sep . strtr($bodyTpl, $placeholders), null];
            }
            return [$url, $body];
        }
        // بدون قالب: پارامترهای استاندارد phone/code
        if ($method === 'GET') {
            $sep = str_contains($url, '?') ? '&' : '?';
            return [$url . $sep . 'phone=' . rawurlencode($phone) . '&code=' . rawurlencode($code), null];
        }
        return [$url, http_build_query(['phone' => $phone, 'code' => $code])];
    }

    /** @return string[] */
    private static function decodeHeaders(string $json): array
    {
        $decoded = json_decode($json, true);
        $out = ['Accept: application/json'];
        if (is_array($decoded)) {
            foreach ($decoded as $k => $v) {
                if (is_string($k) && is_scalar($v)) {
                    $out[] = $k . ': ' . (string) $v;
                }
            }
        }
        return $out;
    }

    /** مسیر log — برای توسعه و قبل از عقد قرارداد پیامک */
    private static function sendToLog(string $phone, string $code): array
    {
        $dir = dirname(__DIR__, 2) . '/storage/logs';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $line = json_encode([
            'at' => gmdate('Y-m-d\TH:i:s\Z'),
            'mode' => 'log',
            'to' => $phone,
            'text' => 'کد ورود کارام: ' . $code,
        ], JSON_UNESCAPED_UNICODE) . "\n";
        @file_put_contents($dir . '/sms.log', $line, FILE_APPEND | LOCK_EX);
        return ['ok' => true, 'mode' => 'log'];
    }
}

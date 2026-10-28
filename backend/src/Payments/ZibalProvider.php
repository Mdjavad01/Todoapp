<?php

declare(strict_types=1);

/**
 * کارام — درایور درگاه زیبال (Zibal) — فاز ۵
 *
 * جریان رسمی (Public API):
 *  ۱) POST /v1/request  {merchant, amount(ریال), callbackUrl, description?, orderId?}
 *        ← {result:100, trackId}        |  پرداخت: https://gateway.zibal.ir/{trackId}
 *  ۲) کاربر در درگاه پرداخت می‌کند و به callbackUrl برمی‌گردد:
 *        GET callbackUrl?trackId=..&success=1|0&status=..&orderId=..
 *  ۳) POST /v1/verify  {merchant, trackId}
 *        ← result:100=تأیید شد، 201=قبلاً تأیید شده، 202/203=ناموفق
 *
 * واحد پول: از فاز تومان، کل سامانه با «تومان صحیح» کار می‌کند؛ API زیبال فقط ریال می‌پذیرد.
 * این کلاس تنها نقطه‌ی تبدیل در کل مخزن است:
 *   request() → تومان × ۱۰ = ریال (به سمت درگاه)
 *   verify()  → ریالِ پاسخ درگاه ÷ ۱۰ = تومان (مقایسه‌ی هم‌واحد سمت PaymentController)
 * هیچ جای دیگری اجازه‌ی ضرب/تقسیم مبلغ را ندارد.
 *
 * امنیت: مبلغ و وضعیت هرگز از کوئریِ برگشتی درگاه باور نمی‌شود؛
 * همیشه با verify سمت‌سرور و تطبیق مبلغِ ثبت‌شده در payments تأیید می‌شود.
 * مرچنت از پنل مدیریت (settings.zibal_merchant) یا .env (ZIBAL_MERCHANT).
 */
final class ZibalProvider
{
    public static function enabled(): bool
    {
        return Settings::bool('gateway_zibal_enabled');
    }

    public static function merchant(): string
    {
        return trim(
            (string) (Settings::get('zibal_merchant', (string) (Config::get('ZIBAL_MERCHANT', '') ?? '')) ?? '')
        );
    }

    /** مبنای API — فقط برای تست محلی با سرور ساختگی قابل تغییر است */
    public static function apiBase(): string
    {
        // دفاع ریشه‌ای: مقدار خالی/نامعتبر در .env (مثل ZIBAL_API_BASE="") = آدرس رسمی زیبال
        // (همان الگوی خطای «No host part in the URL» که برای تلگرام رخ داد — پیش‌گیرانه)
        $base = trim((string) (Config::get('ZIBAL_API_BASE', '') ?? ''));
        $base = trim($base, "\"' \t\n\r");
        if (preg_match('#^https?://[a-z0-9._\-]+(:\d{2,5})?(/.*)?$#i', $base) !== 1) {
            $base = 'https://gateway.zibal.ir';
        }
        return rtrim($base, '/');
    }

    /**
     * درخواست پرداخت جدید — مبلغ ورودی «تومان» است؛ تبدیل به ریال فقط همین‌جا.
     * @return array{ok:bool, trackId?:string, payUrl?:string, error?:string, raw:?string}
     */
    public static function request(
        int $amountTomans,
        string $callbackUrl,
        string $orderUuid,
        string $description,
        ?string $mobile = null,
    ): array {
        $merchant = self::merchant();
        if ($merchant === '') {
            return ['ok' => false, 'error' => 'مرچنت زیبال تنظیم نشده است (پنل ← تنظیمات ← پرداخت)', 'raw' => null];
        }

        // ★ نقطه‌ی یکتای تبدیل واحد در کل مخزن: تومان × ۱۰ = ریال (API زیبال ریالی است)
        $amountRials = $amountTomans * 10;

        $payload = [
            'merchant' => $merchant,
            'amount' => $amountRials,
            'callbackUrl' => $callbackUrl,
            'description' => $description,
            'orderId' => $orderUuid,
        ];
        if ($mobile !== null && $mobile !== '') {
            $payload['mobile'] = $mobile;
        }

        [$status, $body] = self::httpJson(self::apiBase() . '/v1/request', $payload);
        $json = is_string($body) ? json_decode($body, true) : null;

        if ($status !== 200 || !is_array($json)) {
            self::log('error', $orderUuid, 'request', "HTTP {$status}", $body);
            return ['ok' => false, 'error' => 'ارتباط با درگاه زیبال برقرار نشد', 'raw' => $body];
        }

        $result = (int) ($json['result'] ?? 0);
        $trackId = isset($json['trackId']) ? (string) $json['trackId'] : '';
        if ($result !== 100 || $trackId === '') {
            self::log('error', $orderUuid, 'request', self::requestMessage($result), $body);
            return ['ok' => false, 'error' => 'درگاه زیبال درخواست را نپذیرفت: ' . self::requestMessage($result), 'raw' => $body];
        }

        self::log('success', $orderUuid, 'request', 'trackId=' . $trackId, $body);
        return ['ok' => true, 'trackId' => $trackId, 'payUrl' => self::apiBase() . '/' . rawurlencode($trackId), 'raw' => $body];
    }

    /**
     * تأیید پرداخت سمت سرور — مبلغِ پاسخ درگاه (ریال) به «تومان» نرمال می‌شود
     * تا مقایسه با سفارش هم‌واحد باشد؛ نبود/ناعدد بودن amount → null (fail-closed).
     * @return array{ok:bool, refNumber:?string, cardPan:?string, paid:bool, message:string, amountTomans:?int, raw:?string}
     */
    public static function verify(string $trackId): array
    {
        $merchant = self::merchant();
        if ($merchant === '') {
            return ['ok' => false, 'refNumber' => null, 'cardPan' => null, 'paid' => false, 'message' => 'مرچنت زیبال تنظیم نشده است', 'amountTomans' => null, 'raw' => null];
        }

        [$status, $body] = self::httpJson(self::apiBase() . '/v1/verify', [
            'merchant' => $merchant,
            'trackId' => $trackId,
        ]);
        $json = is_string($body) ? json_decode($body, true) : null;

        if ($status !== 200 || !is_array($json)) {
            self::log('error', $trackId, 'verify', "HTTP {$status}", $body);
            return ['ok' => false, 'refNumber' => null, 'cardPan' => null, 'paid' => false, 'message' => 'ارتباط با درگاه برای تأیید برقرار نشد', 'amountTomans' => null, 'raw' => $body];
        }

        $result = (int) ($json['result'] ?? 0);
        // 100 = تأیید موفق | 201 = قبلاً تأیید شده (تکرار callback — باز هم موفق)
        $paid = $result === 100 || $result === 201;

        self::log($paid ? 'success' : 'error', $trackId, 'verify', self::verifyMessage($result), $body);

        // ★ نقطه‌ی یکتای تبدیل معکوس: ریالِ درگاه ÷ ۱۰ = تومان — نبود amount = null (fail-closed)
        $amountTomans = null;
        if (array_key_exists('amount', $json) && is_numeric($json['amount'])) {
            $amountTomans = intdiv((int) $json['amount'], 10);
        }

        return [
            'ok' => $paid,
            'refNumber' => isset($json['refNumber']) ? (string) $json['refNumber'] : null,
            'cardPan' => isset($json['cardNumber']) ? (string) $json['cardNumber'] : null,
            'paid' => $paid,
            'message' => self::verifyMessage($result),
            'amountTomans' => $amountTomans,
            'raw' => $body,
        ];
    }

    /* ---------------- پیام‌های رسمی نتیجه ---------------- */

    private static function requestMessage(int $result): string
    {
        return match ($result) {
            100 => 'با موفقیت تأیید شد',
            102 => 'مرچنت یافت نشد',
            103 => 'مرچنت غیرفعال است',
            104 => 'مرچنت نامعتبر است',
            105 => 'مبلغ کمتر از حد مجاز است (حداقل ۱۰۰ ریال)',
            106 => 'آدرس بازگشت (callbackUrl) نامعتبر است',
            113 => 'مبلغ بیشتر از حد مجاز است',
            -1 => 'در انتظار پرداخت',
            -2 => 'خطای داخلی درگاه',
            default => 'خطای درگاه (کد ' . $result . ')',
        };
    }

    private static function verifyMessage(int $result): string
    {
        return match ($result) {
            100 => 'پرداخت با موفقیت تأیید شد',
            201 => 'پرداخت قبلاً تأیید شده است',
            202 => 'پرداخت انجام نشده یا ناموفق بوده است',
            203 => 'پرداخت لغو شده است',
            default => 'خطای درگاه (کد ' . $result . ')',
        };
    }

    /* ---------------- ابزارها ---------------- */

    /** ثبت رفت‌وبرگشت درگاه در provider_logs (برای پایش از سمت مالک) */
    private static function log(string $status, string $identity, string $subject, string $message, ?string $raw): void
    {
        try {
            Database::pdo()->prepare(
                "INSERT INTO provider_logs (provider, direction, status, identity, subject, message, context, created_at)
                 VALUES ('zibal', 'out', :st, :id, :subj, :msg, :ctx, :now)"
            )->execute([
                ':st' => $status === 'success' ? 'success' : 'error',
                ':id' => mb_substr($identity, 0, 190),
                ':subj' => mb_substr($subject, 0, 190),
                ':msg' => mb_substr($message, 0, 500),
                ':ctx' => $raw !== null ? mb_substr($raw, 0, 2000) : null,
                ':now' => gmdate('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $e) {
            error_log('[karam][zibal] ثبت provider_log ناموفق: ' . $e->getMessage());
        }
    }

    /** @return array{0:int,1:?string} */
    private static function httpJson(string $url, array $payload): array
    {
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if (!function_exists('curl_init')) {
            $ctx = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
                    'content' => (string) $body,
                    'timeout' => 15,
                    'ignore_errors' => true,
                ],
                'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
            ]);
            $resp = @file_get_contents($url, false, $ctx);
            $status = 0;
            foreach ($http_response_header ?? [] as $h) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                    $status = (int) $m[1];
                }
            }
            return [$status, $resp === false ? null : $resp];
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => (string) $body,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        ]);
        $resp = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            error_log('[karam][zibal] خطای ارتباط با درگاه: ' . $err);
            return [0, null];
        }
        return [$status, (string) $resp];
    }
}

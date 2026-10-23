<?php

declare(strict_types=1);

/**
 * کارام — توکن دسترسی بی‌حالت (Stateless)
 * فرمت: k1.{base64url(payload JSON)}.{hmac_sha256}
 * کلید امضا از APP_SECRET در .env — هرگز به کلاینت لو نمی‌رود.
 *
 * فاز ۲: توکن دسترسی با TTL بلند (پیش‌فرض ۳۰ روز) برای تست سینک.
 * فاز ۳: جریان کامل OTP + refresh token چرخشی در دیتابیس همین‌جا جایگزین/تکمیل می‌شود.
 */

final class AccessToken
{
    private const ALGO = 'sha256';
    private const VERSION = 'k1';

    public static function issue(string $userUuid, ?int $ttlHours = null): array
    {
        $ttl = $ttlHours ?? (int) (Config::get('ACCESS_TOKEN_TTL_HOURS', '720') ?? 720);
        if ($ttl < 1 || $ttl > 24 * 90) {
            $ttl = 720;
        }
        $exp = time() + $ttl * 3600;
        $payload = ['u' => $userUuid, 'e' => $exp, 'i' => bin2hex(random_bytes(8))];
        $body = self::b64url(json_encode($payload, JSON_UNESCAPED_SLASHES));
        $sig = self::signature($body);
        return [
            'token' => self::VERSION . '.' . $body . '.' . $sig,
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $exp),
            'ttlHours' => $ttl,
        ];
    }

    /** درستی توکن را بررسی و payload را برمی‌گرداند؛ نامعتبر = null */
    public static function verify(?string $token): ?array
    {
        if ($token === null || $token === '') {
            return null;
        }
        $parts = explode('.', $token);
        if (count($parts) !== 3 || $parts[0] !== self::VERSION) {
            return null;
        }
        [$version, $body, $sig] = $parts;
        if (!hash_equals(self::signature($body), $sig)) {
            return null;
        }
        $payload = json_decode(self::b64urlDecode($body), true);
        if (!is_array($payload) || !isset($payload['u'], $payload['e']) || !is_string($payload['u'])) {
            return null;
        }
        if (!is_int($payload['e']) || $payload['e'] < time()) {
            return null; // منقضی
        }
        return $payload;
    }

    private static function signature(string $body): string
    {
        $secret = (string) (Config::get('APP_SECRET', '') ?? '');
        if (strlen($secret) < 32) {
            // بدون راز قوی، توکنی امضا نمی‌شود
            throw new RuntimeException('APP_SECRET در .env تنظیم نشده است (حداقل ۳۲ کاراکتر)');
        }
        return self::b64url(hash_hmac(self::ALGO, $body, $secret, true));
    }

    private static function b64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $raw): string
    {
        $pad = strlen($raw) % 4;
        if ($pad) {
            $raw .= str_repeat('=', 4 - $pad);
        }
        return (string) base64_decode(strtr($raw, '-_', '+/'), true);
    }
}

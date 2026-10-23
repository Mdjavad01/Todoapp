<?php

declare(strict_types=1);

/**
 * کارام — ارسال ایمیل بدون وابستگی خارجی — فاز ۳
 *
 * سه مسیر ارسال (MAIL_TRANSPORT در .env):
 *  - "mail"  → تابع mail() خود PHP (پیش‌فرض هاست اشتراکی cPanel)
 *  - "smtp"  → کلاینت SMTP خام با STARTTLS/SSL (وقتی mail() کافی نباشد)
 *  - "log"   → فقط در فایل storage/logs/mail.log (توسعه/تست محلی — ایمیلی واقعی نمی‌رود)
 *
 * اگر MAIL_TRANSPORT تعیین نشده باشد: روی sqlite (توسعه) = log و روی mysql = mail.
 */

final class Mailer
{
    /** مسیر ارسال — اولویت: تنظیمات پنل (mail_transport) → .env (MAIL_TRANSPORT) → پیش‌فرض بر اساس درایور */
    public static function transport(): string
    {
        $t = Settings::get('mail_transport', (string) (Config::get('MAIL_TRANSPORT', '') ?? ''));
        if ($t !== null && in_array($t, ['mail', 'smtp', 'log'], true)) {
            return $t;
        }
        return Config::get('DB_DRIVER', 'mysql') === 'sqlite' ? 'log' : 'mail';
    }

    public static function fromAddress(): string
    {
        return (string) (Settings::get('smtp_from', (string) (Config::get('SMTP_FROM', 'no-reply@localhost') ?? '')) ?? 'no-reply@localhost');
    }

    public static function fromName(): string
    {
        return (string) (Settings::get('app_name', (string) (Config::get('SMTP_FROM_NAME', 'کارام') ?? '')) ?? 'کارام');
    }

    /** قالب ایمیل OTP — فارسی و راست‌به‌چپ */
    public static function otpHtml(string $code, string $ttlMinutes): string
    {
        $name = htmlspecialchars(self::fromName(), ENT_QUOTES, 'UTF-8');
        $code = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');
        return <<<HTML
<!doctype html>
<html lang="fa" dir="rtl">
<body style="margin:0;padding:24px;background:#f6f7f7;font-family:Tahoma,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;text-align:center;">
    <p style="font-size:18px;font-weight:bold;color:#00685f;margin:0 0 8px;">{$name}</p>
    <p style="font-size:14px;color:#444;margin:0 0 18px;">کد ورود یک‌بارمصرف شما:</p>
    <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#111;margin:0 0 18px;direction:ltr;">{$code}</p>
    <p style="font-size:13px;color:#777;margin:0 0 6px;">این کد {$ttlMinutes} دقیقه اعتبار دارد.</p>
    <p style="font-size:12px;color:#999;margin:0;">اگر شما درخواست نداده‌اید، این ایمیل را نادیده بگیرید.</p>
  </div>
</body>
</html>
HTML;
    }

    /** ارسال ایمیل HTML؛ خروجی موفقیت (برای مسیر log همیشه true) */
    public static function send(string $to, string $subject, string $html): bool
    {
        return match (self::transport()) {
            'log' => self::sendToLog($to, $subject, $html),
            'smtp' => self::sendViaSmtp($to, $subject, $html),
            default => self::sendViaMail($to, $subject, $html),
        };
    }

    /* ---------------- مسیر log (توسعه) ---------------- */

    private static function sendToLog(string $to, string $subject, string $html): bool
    {
        $dir = dirname(__DIR__, 2) . '/storage/logs';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $line = json_encode([
            'at' => gmdate('Y-m-d\TH:i:s\Z'),
            'transport' => 'log',
            'to' => $to,
            'subject' => $subject,
            'body' => $html,
        ], JSON_UNESCAPED_UNICODE) . "\n";
        return (bool) @file_put_contents($dir . '/mail.log', $line, FILE_APPEND | LOCK_EX);
    }

    /* ---------------- مسیر mail() ---------------- */

    private static function sendViaMail(string $to, string $subject, string $html): bool
    {
        $from = self::fromAddress();
        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            'From: =?UTF-8?B?' . base64_encode(self::fromName()) . '?= <' . $from . '>',
            'Reply-To: ' . $from,
            'X-Mailer: Karam-OTP',
        ];
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $body = '<html><body>' . $html . '</body></html>';
        return @mail($to, $encodedSubject, $body, implode("\r\n", $headers));
    }

    /* ---------------- مسیر SMTP خام ---------------- */

    private static function sendViaSmtp(string $to, string $subject, string $html): bool
    {
        // تنظیمات پنل اولویت دارد؛ در نبودش .env خوانده می‌شود
        $host = (string) (Settings::get('smtp_host', (string) (Config::get('SMTP_HOST', '') ?? '')) ?? '');
        if ($host === '') {
            error_log('[karam][mailer] smtp_host خالی است؛ ایمیل ارسال نشد');
            return false;
        }
        $port = (int) (Settings::get('smtp_port', (string) (Config::get('SMTP_PORT', '587') ?? '587')) ?? 587);
        $secure = (string) (Settings::get('smtp_secure', (string) (Config::get('SMTP_SECURE', 'tls') ?? 'tls')) ?? 'tls'); // tls | ssl | none
        $user = (string) (Settings::get('smtp_user', (string) (Config::get('SMTP_USER', '') ?? '')) ?? '');
        $pass = (string) (Settings::get('smtp_pass', (string) (Config::get('SMTP_PASS', '') ?? '')) ?? '');

        $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $sock = @stream_socket_client($remote, $errno, $errstr, 15);
        if ($sock === false) {
            error_log("[karam][mailer] اتصال SMTP ناموفق: {$errstr} ({$errno})");
            return false;
        }
        stream_set_timeout($sock, 15);

        try {
            self::smtpExpect($sock, [220]);
            self::smtpCommand($sock, 'EHLO karam.local', [250]);

            if ($secure === 'tls') {
                self::smtpCommand($sock, 'STARTTLS', [220]);
                if (!stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('STARTTLS ناموفق بود');
                }
                self::smtpCommand($sock, 'EHLO karam.local', [250]);
            }
            if ($user !== '') {
                self::smtpCommand($sock, 'AUTH LOGIN', [334]);
                self::smtpCommand($sock, base64_encode($user), [334]);
                self::smtpCommand($sock, base64_encode($pass), [235]);
            }

            $from = self::fromAddress();
            self::smtpCommand($sock, 'MAIL FROM:<' . $from . '>', [250]);
            self::smtpCommand($sock, 'RCPT TO:<' . $to . '>', [250, 251]);
            self::smtpCommand($sock, 'DATA', [354]);

            $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
            $data =
                'From: =?UTF-8?B?' . base64_encode(self::fromName()) . '?= <' . $from . ">\r\n" .
                'To: <' . $to . ">\r\n" .
                'Subject: ' . $encodedSubject . "\r\n" .
                "Date: " . gmdate('D, d M Y H:i:s') . " +0000\r\n" .
                "MIME-Version: 1.0\r\n" .
                "Content-Type: text/html; charset=UTF-8\r\n" .
                "Content-Transfer-Encoding: base64\r\n\r\n" .
                chunk_split(base64_encode('<html><body>' . $html . '</body></html>')) . "\r\n.";
            self::smtpCommand($sock, $data, [250]);
            self::smtpCommand($sock, 'QUIT', [221]);
            fclose($sock);
            return true;
        } catch (Throwable $e) {
            error_log('[karam][mailer] ' . $e->getMessage());
            if (is_resource($sock)) {
                fclose($sock);
            }
            return false;
        }
    }

    private static function smtpRead($sock): string
    {
        $data = '';
        while (($line = fgets($sock, 512)) !== false) {
            $data .= $line;
            // پایان پاسخ چندخطی: «250 ...» بدون «-» بعد از کد
            if (isset($line[3]) && $line[3] !== '-') {
                break;
            }
        }
        return $data;
    }

    private static function smtpExpect($sock, array $codes): string
    {
        $resp = self::smtpRead($sock);
        $code = (int) substr($resp, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException('پاسخ غیرمنتظره SMTP: ' . trim($resp));
        }
        return $resp;
    }

    private static function smtpCommand($sock, string $cmd, array $expectCodes): string
    {
        fwrite($sock, $cmd . "\r\n");
        return self::smtpExpect($sock, $expectCodes);
    }
}

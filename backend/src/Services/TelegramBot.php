<?php

declare(strict_types=1);

/**
 * کارام — درایور ربات تلگرام (Bot API) — فاز ۵
 * (جایگزین کامل پیام‌رسان بله — طبق تصمیم مالک، کد تأیید فقط از تلگرام می‌رود)
 *
 * جریان ورود با تلگرام:
 *  ۱) اپ کدِ ۶ حرفی (بلیت) می‌گیرد و لینک آماده‌ی t.me می‌دهد.
 *  ۲) کاربر روی لینک می‌زند (t.me/ربات?start=بلیت) و START را می‌فرستد.
 *  ۳) سرور هنگام poll اپ، پیام‌های جدید ربات را می‌خواند؛ اگر متن = بلیت معتبر بود،
 *     کد OTP واقعی را به همان چت می‌فرستد و بلیت را مصرف می‌کند.
 *  ۴) کاربر کد را در اپ وارد می‌کند و نشست صادر می‌شود.
 *
 * نکته‌ی فنی: برای اینکه هم‌زمان چند کاربر poll بزنند و API تلگرام دچار تداخل نشود،
 * خواندن getUpdates با قفل فایل و کش ۲ ثانیه‌ای مشترک انجام می‌شود.
 */

final class TelegramBot
{
    /** توکن ربات — اولویت با تنظیمات پنل، بعد .env */
    public static function configured(): bool
    {
        return self::token() !== '';
    }

    public static function token(): string
    {
        return (string) (Settings::get('telegram_bot_token', (string) (Config::get('TELEGRAM_BOT_TOKEN', '') ?? '')) ?? '');
    }

    public static function botUsername(): string
    {
        return (string) (Settings::get('telegram_bot_username', (string) (Config::get('TELEGRAM_BOT_USERNAME', '') ?? '')) ?? '');
    }

    private static function apiBase(): string
    {
        // مبنای API بدون پسوند /bot — قابل تغییر برای تست محلی (mock)
        $base = (string) (Config::get('TELEGRAM_API_BASE', 'https://api.telegram.org') ?? 'https://api.telegram.org');
        return rtrim($base, '/');
    }

    /** لینک آماده برای باز کردن گفت‌وگو با ربات و ارسال خودکار بلیت */
    public static function deepLink(string $ticket): string
    {
        $u = self::botUsername();
        return $u !== '' ? 'https://t.me/' . rawurlencode($u) . '?start=' . rawurlencode($ticket) : '';
    }

    /* ---------------- API ---------------- */

    public static function sendMessage(int|string $chatId, string $text): bool
    {
        // مسیر رسمی Bot API: /bot{TOKEN}/sendMessage — بدون اسلش بعد از bot
        $url = self::apiBase() . '/bot' . rawurlencode(self::token()) . '/sendMessage';
        $body = json_encode(['chat_id' => $chatId, 'text' => $text], JSON_UNESCAPED_UNICODE);
        [$status] = self::httpPostJson($url, (string) $body);
        return $status === 200;
    }

    /** بررسی اعتبار توکن ربات (پنل ادمین هنگام ذخیره‌ی توکن صدایش می‌زند) */
    public static function getMe(): array
    {
        $url = self::apiBase() . '/bot' . rawurlencode(self::token()) . '/getMe';
        [$status, $body] = self::httpPostJson($url, '');
        $json = is_string($body) ? json_decode($body, true) : null;
        if ($status === 200 && is_array($json) && ($json['ok'] ?? false) === true) {
            $u = $json['result']['username'] ?? '';
            return ['ok' => true, 'username' => is_string($u) ? $u : ''];
        }
        $desc = is_array($json) ? (string) ($json['description'] ?? '') : '';
        return ['ok' => false, 'error' => $desc !== '' ? $desc : 'HTTP ' . $status];
    }

    /** حذف webhook ثبت‌شده‌ی قبلی — کارام با getUpdates کار می‌کند و webhook باید خالی باشد */
    public static function clearWebhook(): bool
    {
        $url = self::apiBase() . '/bot' . rawurlencode(self::token()) . '/deleteWebhook';
        [$status] = self::httpPostJson($url, '');
        error_log("[karam][telegram] deleteWebhook status={$status} (رفع تداخل webhook قبلی)");
        return $status === 200;
    }

    /** @return array<int,array>|null null = خطای اتصال */
    private static function getUpdates(?int $offset): ?array
    {
        $url = self::apiBase() . '/bot' . rawurlencode(self::token())
            . '/getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D';
        if ($offset !== null && $offset > 0) {
            $url .= '&offset=' . $offset;
        }
        [$status, $body] = self::httpPostJson($url, '');
        if ($status === 409) {
            // تداخل: روی همین توکن webhook فعالی ثبت شده (معمولاً اپ قبلی) — حذفش می‌کنیم و دوباره تلاش می‌کنیم
            self::clearWebhook();
            [$status, $body] = self::httpPostJson($url, '');
        }
        if ($status !== 200) {
            error_log("[karam][telegram] getUpdates status={$status} body=" . var_export($body, true));
            return null;
        }
        $json = json_decode((string) $body, true);
        if (!is_array($json) || ($json['ok'] ?? false) !== true || !isset($json['result']) || !is_array($json['result'])) {
            error_log("[karam][telegram] getUpdates JSON نامعتبر: " . var_export($body, true));
            return null;
        }
        return $json['result'];
    }

    /** @return array{0:int,1:?string} */
    private static function httpPostJson(string $url, string $body): array
    {
        if (!function_exists('curl_init')) {
            // fallback بدون cURL
            $ctx = stream_context_create([
                'http' => [
                    'method' => $body === '' ? 'GET' : 'POST',
                    'header' => "Content-Type: application/json\r\n",
                    'content' => $body,
                    'timeout' => 12,
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
            CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);
        if ($body !== '') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            error_log('[karam][telegram] خطای ارتباط با API تلگرام: ' . $err);
            return [0, null];
        }
        return [$status, (string) $resp];
    }

    /* ---------------- پیام‌های جدید + تطبیق بلیت ---------------- */

    private static function cachePath(): string
    {
        return dirname(__DIR__, 2) . '/storage/cache/telegram-updates.json';
    }

    /**
     * خواندن به‌روزرسانی‌های ربات (با قفل/کش) و تطبیق با بلیت‌های در انتظار.
     * برای هر پیامِ منطبق: بلیت مصرف، کد OTP ساخته و به چت ارسال می‌شود.
     */
    public static function pollAndMatchTickets(PDO $pdo): void
    {
        if (!self::configured()) {
            return;
        }
        $cacheFile = self::cachePath();
        $dir = dirname($cacheFile);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $lock = @fopen($cacheFile . '.lock', 'c');
        if ($lock === false) {
            return;
        }
        if (!flock($lock, LOCK_EX)) {
            fclose($lock);
            return;
        }

        try {
            $state = ['fetchedAt' => 0, 'offset' => 0, 'unprocessed' => []];
            if (is_file($cacheFile)) {
                $decoded = json_decode((string) @file_get_contents($cacheFile), true);
                if (is_array($decoded)) {
                    $state = array_merge($state, $decoded);
                }
            }

            // کش ۲ ثانیه‌ای — چند درخواست هم‌زمان فقط یک‌بار API تلگرام را صدا می‌زنند
            if (time() - (int) $state['fetchedAt'] >= 2) {
                $updates = self::getUpdates((int) $state['offset'] ?: null);
                if ($updates !== null) {
                    $maxId = (int) $state['offset'];
                    foreach ($updates as $u) {
                        $uid = (int) ($u['update_id'] ?? 0);
                        $state['unprocessed'][$uid] = $u;
                        if ($uid >= $maxId) {
                            $maxId = $uid + 1; // آفست بعدی = آخرین + ۱
                        }
                    }
                    $state['offset'] = $maxId;
                    $state['fetchedAt'] = time();
                }
            }

            if (count($state['unprocessed']) > 0) {
                $tickets = Otp::pendingTickets($pdo);
                $ticketsLower = array_map('strtolower', $tickets);
                foreach ($state['unprocessed'] as $uid => $u) {
                    $msg = $u['message'] ?? $u['edited_message'] ?? null;
                    $text = trim((string) ($msg['text'] ?? ''));
                    $chatId = $msg['chat']['id'] ?? null;
                    $matched = false;

                    if ($text !== '' && $chatId !== null && count($tickets) > 0) {
                        // پشتیبانی از «/start TICKET»، «/start» + پیام بعدی و ارسال مستقیم بلیت
                        $candidate = mb_strtolower($text);
                        if (preg_match('#^/start(?:\s+(\S+))?#u', $candidate, $m)) {
                            $candidate = (string) ($m[1] ?? '');
                        }
                        if ($candidate !== '') {
                            $idx = array_search($candidate, $ticketsLower, true);
                            if ($idx !== false) {
                                self::linkChatToTicket($pdo, $tickets[$idx], $chatId);
                                $matched = true;
                            }
                        }
                    }

                    if (!$matched && $text !== '' && $chatId !== null) {
                        // پیام ناشناخته: اگر شکل بلیت یا /start بود راهنمایی بفرست
                        if (preg_match('#^/start#u', $text) || Otp::isTicketFormat(mb_strtoupper(Otp::normalizeDigits($text)))) {
                            self::sendMessage($chatId, 'این کد شناسایی نشد. لطفاً از داخل اپلیکیشن کارام کد جدید بگیرید.');
                        }
                    }
                    unset($state['unprocessed'][$uid]); // هر پیام فقط یک‌بار پردازش می‌شود
                }

                // پاک‌سازی پیام‌های خیلی قدیمی از حافظه‌ی محلی
                if (count($state['unprocessed']) > 200) {
                    $state['unprocessed'] = array_slice($state['unprocessed'], -100, null, true);
                }
            }

            @file_put_contents($cacheFile, json_encode($state, JSON_UNESCAPED_UNICODE), LOCK_EX);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** اتصال چت فرستنده به بلیت: بلیت مصرف + کد OTP جدید برای همان چت */
    private static function linkChatToTicket(PDO $pdo, string $ticket, int|string $chatId): void
    {
        $pdo->beginTransaction();
        try {
            // دوباره بررسی می‌کنیم که بلیت هنوز زنده است (مسابقه‌ی دو poll)
            $stmt = $pdo->prepare(
                'SELECT id FROM otp_requests
                 WHERE identity_type = :t AND identity_value = :v AND consumed_at IS NULL AND expires_at > :now
                 LIMIT 1'
            );
            $stmt->execute([':t' => 'telegram', ':v' => $ticket, ':now' => gmdate('Y-m-d H:i:s')]);
            if ($stmt->fetchColumn() === false) {
                $pdo->rollBack();
                return;
            }

            $code = Otp::createCode($pdo, 'telegram', (string) $chatId, ''); // ip خالی = ارسال سمت سرور
            Otp::consumeTicket($pdo, $ticket);
            // ژورنال شورتکد ادمین: پیوند بلیت ← چت ← کد (خواندن فقط از پنل)
            Otp::recordIssued(['type' => 'telegram', 'value' => (string) $chatId, 'code' => $code['code'], 'ticket' => $ticket]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        self::sendMessage($chatId, "کارام 🌿\nکد ورود شما: " . $code['code'] . "\nاین کد " . Otp::ttlMinutes() . " دقیقه اعتبار دارد.\nاگر شما درخواست نداده بودید، این پیام را نادیده بگیرید.");
    }
}

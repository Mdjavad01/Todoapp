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
        $raw = (string) (Settings::get('telegram_bot_token', (string) (Config::get('TELEGRAM_BOT_TOKEN', '') ?? '')) ?? '');
        // کیبورد فارسی موبایل ارقام را فارسی (۰-۹) تایپ می‌کند؛ توکن تلگرام فقط رقم لاتین می‌پذیرد
        $raw = self::normalizeDigits($raw);
        // خطای رایج کپی‌پیست موبایل: فاصله/خط جدید/نقل‌قول/نویسه‌ی نامرئی در توکن
        // → cURL «HTTP 0» می‌دهد. فقط نویسه‌های مجاز توکن (رقم، حرف، :، -، _) می‌مانند.
        return (string) preg_replace('/[^0-9A-Za-z:_\-]/', '', $raw);
    }

    /** تبدیل ارقام فارسی/عربی به لاتین — مستقل از کلاس‌های دیگر */
    private static function normalizeDigits(string $v): string
    {
        return str_replace(
            ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'],
            ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            $v
        );
    }

    public static function botUsername(): string
    {
        return (string) (Settings::get('telegram_bot_username', (string) (Config::get('TELEGRAM_BOT_USERNAME', '') ?? '')) ?? '');
    }

    /**
     * مبنای API بدون پسوند /bot — عمومی تا صفحه‌ی وضعیت هم از همین یک منبع استفاده کند.
     * دفاع ریشه‌ای: اگر .env مقدار خالی/نامعتبر داشته باشد (مثل TELEGRAM_API_BASE="" که
     * از .env.example کپی شده) به‌جای آدرس خراب و خطای cURL «No host part in the URL»،
     * آدرس رسمی تلگرام استفاده می‌شود.
     */
    public static function apiBase(): string
    {
        $base = trim((string) (Config::get('TELEGRAM_API_BASE', '') ?? ''));
        $base = trim($base, "\"' \t\n\r");
        if (preg_match('#^https?://[a-z0-9._\-]+(:\d{2,5})?(/.*)?$#i', $base) !== 1) {
            $base = 'https://api.telegram.org';
        }
        return rtrim($base, '/');
    }

    /** لینک آماده برای باز کردن گفت‌وگو با ربات و ارسال خودکار بلیت */
    public static function deepLink(string $ticket): string
    {
        $u = self::botUsername();
        return $u !== '' ? 'https://t.me/' . rawurlencode($u) . '?start=' . rawurlencode($ticket) : '';
    }

    /* ---------------- API ---------------- */

    public static function sendMessage(int|string $chatId, string $text, ?string $parseMode = null): bool
    {
        // مسیر رسمی Bot API: /bot{TOKEN}/sendMessage — بدون اسلش بعد از bot
        $url = self::apiBase() . '/bot' . self::token() . '/sendMessage';
        $body = ['chat_id' => $chatId, 'text' => $text];
        if ($parseMode !== null) {
            $body['parse_mode'] = $parseMode; // «HTML» → بلوک <code> مونو و لمس‌پذیر برای کپی
        }
        $payload = (string) json_encode($body, JSON_UNESCAPED_UNICODE);

        [$status, $respBody, $err] = self::httpPostJson($url, $payload);
        if ($status === 200) {
            return true;
        }
        // موج ۱ (چندروش ورود) — نتیجه‌ی sendMessage هرگز بی‌صدا رد نمی‌شود:
        // وضعیت HTTP و توضیح تلگرام در لاگ می‌رود؛ بدون متن پیام (کد خام) و بدون chat_id کامل.
        self::logSendFailure($status, $respBody, $err, $chatId);

        // فقط یک retry کوتاه — و فقط برای خطاهای گذرا (شبکه/۴۲۹/۵xx) که تلاش دوباره می‌تواند جواب دهد؛
        // خطاهای دائمی (۴۰۳ = ربات بلاک شده، ۴۰۰، ۴۰۴) با تلاش دوباره درست نمی‌شوند و فقط لاگ را شلوغ می‌کنند.
        if (self::retryableSendStatus($status)) {
            usleep(800_000); // ۰٫۸ ثانیه — «کوتاه»
            [$status, $respBody, $err] = self::httpPostJson($url, $payload);
            if ($status === 200) {
                return true;
            }
            self::logSendFailure($status, $respBody, $err, $chatId, true);
        }
        return false;
    }

    /** آیا برای این وضعیت HTTP تلاش دوباره معنا دارد؟ (۰ = اصلاً پاسخی نرسیده) */
    private static function retryableSendStatus(int $status): bool
    {
        return $status === 0 || $status === 429 || $status >= 500;
    }

    /**
     * لاگ شکست ارسال — موج ۱: کد وضعیت + توضیح تلگرام؛
     * هرگز متن پیام (کد خام) و هرگز chat_id کامل در لاگ نمی‌رود.
     */
    private static function logSendFailure(int $status, ?string $body, string $curlErr, int|string $chatId, bool $isRetry = false): void
    {
        $desc = '';
        $json = is_string($body) ? json_decode($body, true) : null;
        if (is_array($json)) {
            $desc = (string) ($json['description'] ?? '');
        }
        error_log('[karam][telegram] sendMessage ناموفق (' . ($isRetry ? 'retry' : 'اول') . '): HTTP ' . $status
            . ($desc !== '' ? ' — ' . $desc : '')
            . ($curlErr !== '' ? ' — cURL: ' . $curlErr : '')
            . ' — chat=' . self::maskedChatId($chatId));
    }

    /** ماسک chat_id برای لاگ — فقط طول و دو نویسه‌ی ابتدا/انتهای عددی */
    private static function maskedChatId(int|string $chatId): string
    {
        $s = (string) $chatId;
        $len = strlen($s);
        if ($len <= 2) {
            return 'len=' . $len;
        }
        return substr($s, 0, 1) . '•••' . substr($s, -1) . ' (len=' . $len . ')';
    }

    /** ماسک شناسه‌ی بلیت برای لاگ — مثل maskedChatId: نویسه‌ی ابتدا/انتها + طول؛
     *  مقدار کامل بلیت هرگز در error_log نمی‌رود (اصلاحیه موج ۱). */
    private static function maskedTicketId(string $ticket): string
    {
        $s = (string) $ticket;
        $len = strlen($s);
        if ($len <= 2) {
            return 'len=' . $len;
        }
        return substr($s, 0, 1) . '•••' . substr($s, -1) . ' (len=' . $len . ')';
    }

    /** بررسی اعتبار توکن ربات (پنل ادمین هنگام ذخیره‌ی توکن صدایش می‌زند) */
    public static function getMe(): array
    {
        $url = self::apiBase() . '/bot' . self::token() . '/getMe';
        [$status, $body, $err] = self::httpPostJson($url, '');
        if ($status === 0) {
            // HTTP 0 = اصلاً پاسخی از تلگرام نرسیده (اتصال/شبکه) — نه رد شدن توکن
            return ['ok' => false, 'error' => 'ارتباط با سرور تلگرام برقرار نشد' . ($err !== '' ? ' — cURL: ' . $err : ''), 'network' => true];
        }
        $json = is_string($body) ? json_decode($body, true) : null;
        if ($status === 200 && is_array($json) && ($json['ok'] ?? false) === true) {
            $u = $json['result']['username'] ?? '';
            return ['ok' => true, 'username' => is_string($u) ? $u : ''];
        }
        if ($status === 401) {
            return ['ok' => false, 'error' => 'توکن ربات نامعتبر است (Unauthorized) — توکن را دوباره از @BotFather کپی و در پنل ذخیره کنید'];
        }
        if ($status === 404) {
            return ['ok' => false, 'error' => 'توکن پیدا نشد (Not Found) — شکل توکن درست نیست؛ دوباره از @BotFather کپی کنید'];
        }
        $desc = is_array($json) ? (string) ($json['description'] ?? '') : '';
        return ['ok' => false, 'error' => $desc !== '' ? $desc : 'HTTP ' . $status];
    }

    /** حذف webhook ثبت‌شده‌ی قبلی — کارام با getUpdates کار می‌کند و webhook باید خالی باشد */
    public static function clearWebhook(): bool
    {
        $url = self::apiBase() . '/bot' . self::token() . '/deleteWebhook';
        [$status] = self::httpPostJson($url, '');
        error_log("[karam][telegram] deleteWebhook status={$status} (رفع تداخل webhook قبلی)");
        return $status === 200;
    }

    /**
     * وضعیت webhook ثبت‌شده روی توکن (صفحه‌ی وضعیت Worker کرون نمایش می‌دهد).
     * @return array{ok:bool, url:string, pendingUpdateCount:int, lastErrorMessage:string, lastErrorDate:string}|array{ok:false, error:string}
     */
    public static function getWebhookInfo(): array
    {
        $url = self::apiBase() . '/bot' . self::token() . '/getWebhookInfo';
        [$status, $body] = self::httpPostJson($url, '');
        if ($status === 0) {
            return ['ok' => false, 'error' => 'ارتباط با سرور تلگرام برقرار نشد'];
        }
        $json = is_string($body) ? json_decode($body, true) : null;
        if ($status === 200 && is_array($json) && ($json['ok'] ?? false) === true && is_array($json['result'] ?? null)) {
            $r = $json['result'];
            return [
                'ok' => true,
                'url' => (string) ($r['url'] ?? ''),
                'pendingUpdateCount' => (int) ($r['pending_update_count'] ?? 0),
                'lastErrorMessage' => (string) ($r['last_error_message'] ?? ''),
                'lastErrorDate' => (string) ($r['last_error_date'] ?? ''),
            ];
        }
        return ['ok' => false, 'error' => 'HTTP ' . $status];
    }

    /** @return array<int,array>|null null = خطای اتصال */
    private static function getUpdates(?int $offset): ?array
    {
        $url = self::apiBase() . '/bot' . self::token()
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
            // موج ۱ — بدون dump بدنه‌ی خام (شامل chat_id است): فقط وضعیت + توضیح تلگرام
            $json = is_string($body) ? json_decode($body, true) : null;
            $desc = is_array($json) ? (string) ($json['description'] ?? '') : '';
            error_log("[karam][telegram] getUpdates ناموفق: HTTP {$status}" . ($desc !== '' ? ' — ' . $desc : ''));
            return null;
        }
        $json = json_decode((string) $body, true);
        if (!is_array($json) || ($json['ok'] ?? false) !== true || !isset($json['result']) || !is_array($json['result'])) {
            // موج ۱ — همان قاعده: بدون محتوای خام پیام‌ها در لاگ
            error_log('[karam][telegram] getUpdates پاسخ نامعتبر داد (JSON/ok/result) — HTTP ' . $status);
            return null;
        }
        return $json['result'];
    }

    /** @return array{0:int,1:?string,2:string} [وضعیت HTTP، بدنه، متن خطای cURL] */
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
            return [$status, $resp === false ? null : $resp, ''];
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
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
            return [0, null, $err];
        }
        return [$status, (string) $resp, ''];
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

    /**
     * اتصال چت فرستنده به بلیت — موج ۱ (چندروش ورود): ترتیب جدید «اول ارسال، بعد مصرف».
     *
     *  ۱) سقف تلاش: هر بلیت حداکثر Otp::ticketMaxSendAttempts() بار تلاشِ ارسال دارد؛
     *     بعد از سقف تا پایان TTL دیگر کد ساخته نمی‌شود (وضعیت poll همان send_failed می‌ماند).
     *  ۲) یک کد به‌ازای هر بلیت (idempotent): اگر کد زنده‌ای از تلاش قبلیِ همین بلیت مانده باشد
     *     (id بزرگ‌تر از ردیف بلیت — یعنی بعد از ساخت بلیت ساخته شده)، باطل می‌شود تا برای هر
     *     بلیت در هر لحظه حداکثر یک کد زنده باشد. Worker هرگز خودش برای بلیت شکست‌خورده
     *     کد جدید نمی‌سازد؛ تنها retry همان یک تلاش کوتاه داخل sendMessage است با همان کد
     *     (کد خام فقط در حافظه‌ی همان درخواست است — ممیزی M-06: هرگز روی دیسک نمی‌رود).
     *  ۳) بلیت فقط بعد از ارسال موفق مصرف می‌شود → code_sent دقیقاً یعنی «کد واقعاً رفت».
     *  ۴) در شکست ارسال: بلیت مصرف نمی‌شود (تا پایان TTL زنده می‌ماند)، رکورد کدِ بی‌مصرف
     *     همان لحظه باطل می‌شود و ستون attempts بلیت +۱ می‌شود → وضعیت poll = send_failed.
     */
    private static function linkChatToTicket(PDO $pdo, string $ticket, int|string $chatId): void
    {
        $now = gmdate('Y-m-d H:i:s');

        // ج) محدودسازی ارسال به‌ازای chat_id — همان سیاست OTP: فاصله‌ی حداقلی بین دو کد +
        //    سقف ساعتی برای هر چت. (IP اینجا معنا ندارد؛ ارسال از سمت سرور است.)
        //    پیش از این، هیچ سقفی روی تعداد کد به‌ازای هر چت نبود.
        $limit = Otp::checkRateLimit($pdo, 'telegram', (string) $chatId, '');
        if (!$limit['ok']) {
            error_log('[karam][telegram] اتصال بلیت ' . self::maskedTicketId($ticket) . ' به chat=' . self::maskedChatId($chatId)
                . ' به‌ازای محدودیت نرخ رد شد: ' . $limit['reason']);
            return; // بدون ساخت کد و بدون پیام — بلیت همان وضعیت قبلی‌اش را نگه می‌دارد
        }

        $pdo->beginTransaction();
        try {
            // دوباره بررسی می‌کنیم که بلیت هنوز زنده است (مسابقه‌ی دو poll)
            $stmt = $pdo->prepare(
                'SELECT id, attempts FROM otp_requests
                 WHERE identity_type = :t AND identity_value = :v AND consumed_at IS NULL AND expires_at > :now
                 LIMIT 1'
            );
            $stmt->execute([':t' => 'telegram', ':v' => $ticket, ':now' => $now]);
            $ticketRow = $stmt->fetch();
            if ($ticketRow === false) {
                $pdo->rollBack();
                return;
            }
            $ticketId = (int) $ticketRow['id'];
            $attempts = (int) $ticketRow['attempts'];

            // ۱) سقف تلاش‌های ارسال همین بلیت
            if ($attempts >= Otp::ticketMaxSendAttempts()) {
                $pdo->rollBack();
                error_log('[karam][telegram] بلیت ' . self::maskedTicketId($ticket) . ' به سقف تلاش ارسال رسید — کد جدید ساخته نمی‌شود (تا پایان TTL وضعیت send_failed می‌ماند)');
                return;
            }

            // ۲) یک کد به‌ازای هر بلیت — کدِ زنده‌ی متعلق به تلاش قبلی همین بلیت باطل می‌شود
            //    (فقط کدهای همین chat که بعد از ردیف این بلیت ساخته شده‌اند؛ کد بلیت‌های دیگر دست‌نخورده می‌ماند)
            $pdo->prepare(
                'UPDATE otp_requests SET consumed_at = :now
                 WHERE identity_type = :t AND identity_value = :c AND consumed_at IS NULL
                   AND id > :tid AND purpose = :p'
            )->execute([
                ':now' => $now,
                ':t' => 'telegram',
                ':c' => (string) $chatId,
                ':tid' => $ticketId,
                ':p' => Otp::PURPOSE_LOGIN,
            ]);

            $code = Otp::createCode($pdo, 'telegram', (string) $chatId, ''); // ip خالی = ارسال سمت سرور
            $codeRowId = (int) $pdo->lastInsertId();
            // v1.12.0 (ممیزی M-06) — recordIssued حذف شد: کد خام فقط به چت تلگرام می‌رود،
            // هرگز روی دیسک ژورنال نمی‌شود. پنل فقط وضعیت اتصال را می‌بیند، نه کد را.

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // کد داخل بلوک <code> تلگرام: فونت مونو + لمس → کپی (به درخواست مالک)
        $sent = self::sendMessage(
            $chatId,
            "کارام 🌿\n"
            . "کد ورود شما: <code>" . htmlspecialchars($code['code'], ENT_QUOTES, 'UTF-8') . "</code>\n"
            . "این کد " . Otp::ttlMinutes() . " دقیقه اعتبار دارد.\n"
            . "اگر شما درخواست نداده بودید، این پیام را نادیده بگیرید.",
            'HTML'
        );

        if ($sent) {
            // ۳) مصرف بلیت فقط بعد از ارسال موفق → status = code_sent (رفتار قبلی برای کلاینت‌ها)
            Otp::consumeTicket($pdo, $ticket);
        } else {
            // ۴) شکست ارسال: بلیت زنده می‌ماند + attempts بلیت +۱ → status = send_failed؛
            //     کدِ بی‌مصرفِ به‌جامانده همان لحظه باطل می‌شود تا کد زنده‌ی یتیم باقی نماند.
            $pdo->prepare('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = :id')
                ->execute([':id' => $ticketId]);
            $pdo->prepare(
                'UPDATE otp_requests SET consumed_at = :now
                 WHERE id = :id AND consumed_at IS NULL AND purpose = :p'
            )->execute([':now' => gmdate('Y-m-d H:i:s'), ':id' => $codeRowId, ':p' => Otp::PURPOSE_LOGIN]);
            error_log('[karam][telegram] ارسال کد برای بلیت ' . self::maskedTicketId($ticket) . ' ناموفق بود — وضعیت poll: send_failed (کاربر می‌تواند لینک را دوباره باز کند یا با ایمیل وارد شود)');
        }
    }
}

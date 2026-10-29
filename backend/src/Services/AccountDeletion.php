<?php

declare(strict_types=1);

/**
 * کارام — حذف حساب و دریافت داده (v1.9 — بسته‌ی ایمنی و اعتماد)
 *
 * دو مسیر یک منطق مشترک دارند:
 *   - خودِ کاربر:  GET /api/v1/me/export  +  POST /api/v1/me/delete-request  +  POST /api/v1/me/delete
 *   - ادمین پنل:   POST /api/admin/users/{id}/delete  (با ثبت Audit)
 *
 * حذف یعنی چه؟ (دقیق و صادقانه)
 *   پاک می‌شود (سخت — نه نرم):
 *     - همه‌ی لیست‌ها، کارها، زیرکارها، یادآورها (reminders)
 *     - همه‌ی هویت‌ها (ایمیل/موبایل/chat_id تلگرام) و توکن‌های دستگاه‌ها
 *     - رکوردهای OTPِ هویت‌های همان کاربر (هر دو هدف: ورود و حذف حساب)
 *     - مقدار هویت در provider_logs بی‌نام می‌شود (تطهیر — لاگ سالم می‌ماند)
 *     - ژورنال محلی issued-otp.jsonl هم از مقدار هویت پاک می‌شود
 *   بی‌نام می‌شود (پوسته‌ی کاربر):
 *     - users: status='deleted'، نام NULL، جنسیت unset، premium NULL، کد رفرال NULL
 *       (فقط id/uuid/created_at می‌ماند — لنگر حسابداری)
 *     - پاسخ همه‌ی توکن‌های Access بلافاصله رد می‌شود (Guard وضعیت non-active را null می‌کند)
 *   می‌ماند (حداقلی و بی‌نام برای حسابداری):
 *     - orders / payments / deposit_requests / subscriptions / coupon_redemptions
 *       (سند مالی پرداخت‌ها؛ با FK به پوسته‌ی بی‌نام کاربر)
 *     - audit_logs (یکپارچگی سیستم؛ خودش در کرون نگه‌داری چرخه دارد)
 *
 * نکته‌ی امنیتی مهم: کد تأیید حذف، purpose جداگانه دارد (account_delete) —
 * کد ورود برای حذف حساب کار نمی‌کند و کد حذف حساب برای ورود کار نمی‌کند.
 */

final class AccountDeletion
{
    /** متن تأیید که کاربر باید تایپ کند */
    public const CONFIRM_TEXT = 'حذف حساب';

    /* -------------------------------------------------
     * دریافت داده — GET /api/v1/me/export
     * ------------------------------------------------- */

    /**
     * خروجی JSON کامل داده‌ی یک حساب: حساب + لیست‌ها + کارها + زیرکارها (+یادآورها).
     * شکل موجودیت‌ها دقیقاً همان خروجی سینک است (Entities::toClient) تا بازیابی/بررسی آسان باشد.
     * @return array<string,mixed>
     */
    public static function export(int $userId): array
    {
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT uuid, display_name, created_at FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $user = $stmt->fetch();
        if ($user === false) {
            throw new ValidationError('کاربر یافت نشد');
        }

        $entities = [
            Entities::ENTITY_LISTS => Entities::pullSince(Entities::ENTITY_LISTS, $userId, null, null),
            Entities::ENTITY_TASKS => Entities::pullSince(Entities::ENTITY_TASKS, $userId, null, null),
            Entities::ENTITY_SUBTASKS => Entities::pullSince(Entities::ENTITY_SUBTASKS, $userId, null, null),
        ];

        // یادآورها — موجودیت سینک مستقل نیستند؛ برای کامل‌بودن خروجی با uuid کار می‌آیند
        $reminders = [];
        try {
            $rstmt = $pdo->prepare(
                'SELECT r.uuid, t.uuid AS task_uuid, r.fire_at, r.fired_at, r.created_at
                 FROM reminders r JOIN tasks t ON t.id = r.task_id
                 WHERE r.user_id = :uid ORDER BY r.fire_at ASC'
            );
            $rstmt->execute([':uid' => $userId]);
            foreach ($rstmt->fetchAll() as $r) {
                $reminders[] = [
                    'id' => (string) $r['uuid'],
                    'taskId' => (string) $r['task_uuid'],
                    'fireAt' => Entities::sqlToIso($r['fire_at']),
                    'firedAt' => Entities::sqlToIso($r['fired_at'] ?? null),
                    'createdAt' => Entities::sqlToIso($r['created_at']),
                ];
            }
        } catch (Throwable) {
            // جدول یادآور در نصب‌های قدیمی ممکن است نباشد — خروجی بدون یادآور می‌ماند
        }

        $counts = [];
        $payload = [];
        foreach ($entities as $entity => $rows) {
            $payload[$entity] = array_values(array_map(
                static fn (array $r): array => Entities::toClient($entity, $r),
                $rows,
            ));
            $counts[$entity] = count($payload[$entity]);
        }
        $counts['reminders'] = count($reminders);

        return [
            'kind' => 'karam-account-export',
            'version' => 1,
            'exportedAt' => gmdate('Y-m-d\TH:i:s.000\Z'),
            'account' => [
                'uuid' => (string) $user['uuid'],
                'displayName' => $user['display_name'] !== null ? (string) $user['display_name'] : null,
                'createdAt' => Entities::sqlToIso($user['created_at']),
            ],
            'counts' => $counts,
            'lists' => $payload[Entities::ENTITY_LISTS],
            'tasks' => $payload[Entities::ENTITY_TASKS],
            'subtasks' => $payload[Entities::ENTITY_SUBTASKS],
            'reminders' => $reminders,
        ];
    }

    /* -------------------------------------------------
     * هویت‌های کاربر
     * ------------------------------------------------- */

    /** @return list<array{type:string, value:string}> */
    public static function identitiesOf(int $userId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT type, value FROM user_identities WHERE user_id = :id ORDER BY is_primary DESC, id ASC'
        );
        $stmt->execute([':id' => $userId]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['type' => (string) $r['type'], 'value' => (string) $r['value']];
        }
        return $out;
    }

    /** هویت اصلی (اولین تأییدشده‌ی فهرست) — کد حذف حساب به همین ارسال می‌شود */
    public static function primaryIdentity(int $userId): ?array
    {
        foreach (self::identitiesOf($userId) as $i) {
            return $i;
        }
        return null;
    }

    /** آیا اشتراک فعال دارد؟ (برای هشدار روشن قبل از حذف) */
    public static function activePremiumUntil(int $userId): ?string
    {
        try {
            $stmt = Database::pdo()->prepare(
                "SELECT premium_until FROM users WHERE id = :id AND status = 'active' LIMIT 1"
            );
            $stmt->execute([':id' => $userId]);
            $until = $stmt->fetchColumn();
            if ($until === false || $until === null) {
                return null;
            }
            return strtotime((string) $until) > time() ? Entities::sqlToIso((string) $until) : null;
        } catch (Throwable) {
            return null;
        }
    }

    /* -------------------------------------------------
     * حذف کامل — خود کاربر یا ادمین
     * ------------------------------------------------- */

    /**
     * حذف کامل حساب. تراکنشی است: یا همه‌چیز پاک می‌شود یا هیچ‌چیز.
     * @param int $userId شناسه‌ی کاربر
     * @param string|null $actorType 'user' | 'admin' | 'system'
     * @param int|null $actorId شناسه‌ی بازیگر (خود کاربر یا ادمین)
     * @return array{deleted:bool, removed:array<string,int>}
     */
    public static function delete(int $userId, string $actorType = 'user', ?int $actorId = null): array
    {
        $pdo = Database::pdo();
        $identities = self::identitiesOf($userId);

        $pdo->beginTransaction();
        try {
            $removed = [];

            // ۱) توکن‌های دستگاه‌ها (نشست‌ها)
            $st = $pdo->prepare('DELETE FROM refresh_tokens WHERE user_id = :id');
            $st->execute([':id' => $userId]);
            $removed['refreshTokens'] = $st->rowCount();

            // ۲) داده‌ی اپ — ترتیب: یادآور ← زیرکار ← کار ← لیست (همه سخت)
            //    (جدول reminders فقط در MySQL هست؛ SQLite توسعه‌ای ندارد — گارد جدول)
            foreach (['reminders', 'subtasks', 'tasks', 'lists'] as $table) {
                if (!self::tableExists($table)) {
                    continue;
                }
                $st = $pdo->prepare("DELETE FROM {$table} WHERE user_id = :id");
                $st->execute([':id' => $userId]);
                $removed[$table] = $st->rowCount();
            }

            // ۳) رکوردهای OTPِ هویت‌های همین کاربر (حریم خصوصی: ایمیل/موبایل/chat_id نباید بماند)
            $removed['otpRequests'] = 0;
            foreach ($identities as $idn) {
                $st = $pdo->prepare('DELETE FROM otp_requests WHERE identity_type = :t AND identity_value = :v');
                $st->execute([':t' => self::otpIdentityType($idn['type']), ':v' => $idn['value']]);
                $removed['otpRequests'] += $st->rowCount();
            }

            // ۴) هویت‌ها
            $st = $pdo->prepare('DELETE FROM user_identities WHERE user_id = :id');
            $st->execute([':id' => $userId]);
            $removed['identities'] = $st->rowCount();

            // ۵) پوسته‌ی بی‌نام کاربر (لنگر حسابداری)
            //    ستون‌های رفرال (referral_code/referred_by) فقط با مهاجرت خودکار ReferralSchema
            //    ساخته می‌شوند — اگر نصب هنوز آن را نداشت، بی‌سروصدا رد می‌شویم.
            $hasReferralCols = self::hasColumn('users', 'referral_code');
            $st = $pdo->prepare(
                "UPDATE users SET
                    display_name = NULL,
                    gender = 'unset',
                    status = 'deleted',
                    premium_until = NULL,
                    last_login_at = NULL"
                . ($hasReferralCols ? ",\n                    referral_code = NULL,\n                    referred_by = NULL" : '')
                . ",\n                    updated_at = :now
                 WHERE id = :id"
            );
            $st->execute([':now' => gmdate('Y-m-d H:i:s'), ':id' => $userId]);

            // ۶) Audit — داخل همان تراکنش تا با حذف هم‌قدم بماند
            Audit::log($actorType, $actorId, $actorType === 'admin' ? 'user.account_deleted' : 'account.delete', 'user', (string) $userId, [
                'removed' => $removed,
                'identityCount' => count($identities),
                // مقدار هویت‌ها عمداً لاگ نمی‌شود
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // ۷) بیرون از تراکنش: تطهیر لاگ‌های جانبی (شکستشان حذف را باطل نمی‌کند — فقط لاگ)
        self::scrubSideLogs($identities);

        return ['deleted' => true, 'removed' => $removed];
    }

    /** نگاشت type هویت → identity_type جدول otp_requests */
    private static function otpIdentityType(string $identityType): string
    {
        return $identityType === 'telegram_chat_id' ? 'telegram' : $identityType;
    }

    /** آیا جدول در دیتابیس جاری وجود دارد؟ (یادآور در SQLite توسعه‌ای ساخته نمی‌شود) */
    private static function tableExists(string $table): bool
    {
        try {
            if (Database::driver() === 'mysql') {
                $st = Database::pdo()->prepare(
                    'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t'
                );
                $st->execute([':t' => $table]);
                return (int) $st->fetchColumn() > 0;
            }
            $st = Database::pdo()->prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = :t");
            $st->execute([':t' => $table]);
            return $st->fetchColumn() !== false;
        } catch (Throwable) {
            return false;
        }
    }

    /** آیا این ستون در جدول هست؟ (ستون‌های مهاجرت‌شونده مثل referral_code ممکن است نباشند) */
    private static function hasColumn(string $table, string $column): bool
    {
        try {
            if (Database::driver() === 'mysql') {
                $st = Database::pdo()->prepare(
                    'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c'
                );
                $st->execute([':t' => $table, ':c' => $column]);
                return (int) $st->fetchColumn() > 0;
            }
            $st = Database::pdo()->prepare('PRAGMA table_info(' . $table . ')');
            $st->execute();
            foreach ($st->fetchAll() as $c) {
                if ((string) ($c['name'] ?? '') === $column) {
                    return true;
                }
            }
            return false;
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * تطهیر لاگ‌های جانبی: مقدار هویت در provider_logs بی‌نام و ژورنال OTP محلی پاک می‌شود.
     * بیرون از تراکنش اصلی است — شکستش فقط در لاگ سرور می‌رود.
     * @param list<array{type:string, value:string}> $identities
     */
    private static function scrubSideLogs(array $identities): void
    {
        if ($identities === []) {
            return;
        }
        try {
            $pdo = Database::pdo();
            $st = $pdo->prepare('UPDATE provider_logs SET identity = NULL WHERE identity = :v');
            foreach ($identities as $idn) {
                $st->execute([':v' => $idn['value']]);
            }
        } catch (Throwable $e) {
            error_log('[karam][account-delete] تطهیر provider_logs ناموفق: ' . $e->getMessage());
        }
        try {
            self::scrubIssuedOtpJournal($identities);
        } catch (Throwable $e) {
            error_log('[karam][account-delete] پاک‌سازی ژورنال OTP ناموفق: ' . $e->getMessage());
        }
    }

    /** حذف سطرهای هویتِ حذف‌شده از ژورنال محلی کدهای ورود (storage/cache/issued-otp.jsonl) */
    private static function scrubIssuedOtpJournal(array $identities): void
    {
        $path = dirname(__DIR__, 2) . '/storage/cache/issued-otp.jsonl';
        if (!is_file($path)) {
            return;
        }
        $values = array_map(static fn (array $i): string => strtolower($i['value']), $identities);
        $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) {
            return;
        }
        $kept = [];
        foreach ($lines as $line) {
            $e = json_decode((string) $line, true);
            if (is_array($e) && in_array(strtolower((string) ($e['value'] ?? '')), $values, true)) {
                continue; // سطر هویتِ حذف‌شده — نمی‌ماند
            }
            $kept[] = $line;
        }
        if (count($kept) !== count($lines)) {
            @file_put_contents($path, implode("\n", $kept) . (count($kept) > 0 ? "\n" : ''), LOCK_EX);
        }
    }
}

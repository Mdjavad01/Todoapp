<?php

declare(strict_types=1);

/**
 * کارام — دعوت دوستان / رفرال (v20 — گام ۲۰ رشد)
 *
 * قاعده‌ی سادگی: دو کلید پنل (referral_enabled / referral_days) + منطق کوچک.
 *  - هر کاربر کد دعوت یکتا دارد (بار اول که وضعیت رفرال خوانده شود ساخته می‌شود)
 *  - کاربر با وارد کردن کد دوستش، هر دو طرف N روز پرو می‌گیرند (source='referral')
 *  - هر حساب فقط یک‌بار می‌تواند کد کسی را فعال کند (ستون users.referred_by = قفل)
 *
 * دفاع‌ها:
 *  - کد خودتان → خطا؛ حساب غیرفعال → خطا
 *  - مسابقه‌ی هم‌زمان: UPDATE شرطی (WHERE referred_by IS NULL) — فقط اولین می‌برد
 *  - همه‌چیز در یک تراکنش: یا هر دو طرف پرو می‌شوند یا هیچ‌کدام
 */
final class Referral
{
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0/O/1/I — خوانا برای پیامک/گفتار

    /** وضعیت رفرال کاربر جاری — برای شیت حساب کاربری اپ */
    public static function summary(PDO $pdo, int $userId): array
    {
        ReferralSchema::ensure();

        $enabled = Settings::bool('referral_enabled');
        $days = Settings::int('referral_days', 7, 1, 30);

        $stmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $referredBy = $stmt->fetchColumn();
        $canRedeem = $enabled && ($referredBy === false || $referredBy === null);

        $code = null;
        $shareUrl = null;
        $invited = 0;
        if ($enabled) {
            $code = self::ensureCode($pdo, $userId);
            $invStmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE referred_by = :id');
            $invStmt->execute([':id' => $userId]);
            $invited = (int) $invStmt->fetchColumn();
            $appUrl = rtrim((string) (Config::get('APP_URL', '') ?? ''), '/');
            if ($appUrl !== '') {
                $shareUrl = $appUrl . '/?ref=' . rawurlencode($code);
            }
        }

        return [
            'enabled' => $enabled,
            'days' => $days,
            'code' => $code,
            'shareUrl' => $shareUrl,
            'invitedCount' => $invited,
            'canRedeem' => $canRedeem,
        ];
    }

    /**
     * فعال‌سازی کد دعوت: کاربر جاری + صاحب کد، هر دو N روز پرو می‌گیرند.
     * @return array{ok:true, days:int, premiumUntil:string}|array{ok:false, error:string, status:int, code:string}
     */
    public static function redeem(PDO $pdo, int $userId, string $rawCode): array
    {
        ReferralSchema::ensure();

        if (!Settings::bool('referral_enabled')) {
            return ['ok' => false, 'error' => 'دعوت دوستان فعلاً فعال نیست', 'status' => 403, 'code' => 'referral_disabled'];
        }
        $days = Settings::int('referral_days', 7, 1, 30);

        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', Otp::normalizeDigits(trim($rawCode))) ?? '');
        if (!preg_match('/^[A-Z0-9]{4,12}$/', $code)) {
            return ['ok' => false, 'error' => 'کد دعوت نامعتبر است', 'status' => 422, 'code' => 'referral_invalid'];
        }

        $stmt = $pdo->prepare('SELECT id, status FROM users WHERE referral_code = :c LIMIT 1');
        $stmt->execute([':c' => $code]);
        $inviter = $stmt->fetch();
        if ($inviter === false) {
            return ['ok' => false, 'error' => 'کد دعوت پیدا نشد؛ آن را از دوستتان دوباره بگیرید', 'status' => 404, 'code' => 'referral_not_found'];
        }
        $inviterId = (int) $inviter['id'];
        if ($inviterId === $userId) {
            return ['ok' => false, 'error' => 'این کد دعوت خودتان است', 'status' => 422, 'code' => 'referral_self'];
        }
        if ((string) $inviter['status'] !== 'active') {
            return ['ok' => false, 'error' => 'صاحب این کد دعوت در دسترس نیست', 'status' => 422, 'code' => 'referral_owner_inactive'];
        }

        $now = gmdate('Y-m-d H:i:s');
        $pdo->beginTransaction();
        try {
            // قفل یک‌بارمصرف بودن: فقط اگر referred_by خالی باشد ست می‌شود (مسابقه‌ی هم‌زمان را هم می‌بندد)
            $upd = $pdo->prepare(
                'UPDATE users SET referred_by = :inv, updated_at = :now
                 WHERE id = :id AND referred_by IS NULL'
            );
            $upd->execute([':inv' => $inviterId, ':id' => $userId, ':now' => $now]);
            if ($upd->rowCount() === 0) {
                $pdo->rollBack();
                return ['ok' => false, 'error' => 'شما قبلاً یک کد دعوت فعال کرده‌اید', 'status' => 409, 'code' => 'referral_already_used'];
            }

            $mine = Subscription::activateTrial($pdo, $userId, $days, 'referral');
            $theirs = Subscription::activateTrial($pdo, $inviterId, $days, 'referral');

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[karam][referral] فعال‌سازی کد دعوت ناموفق: ' . $e->getMessage());
            return ['ok' => false, 'error' => 'فعال‌سازی کد دعوت ناموفق بود؛ بعداً تلاش کنید', 'status' => 500, 'code' => 'referral_failed'];
        }

        Audit::log('user', $userId, 'referral.redeem', 'user', (string) $inviterId, ['days' => $days]);

        return ['ok' => true, 'days' => $days, 'premiumUntil' => $mine['premiumUntil'], 'inviterPremiumUntil' => $theirs['premiumUntil']];
    }

    /** کد دعوت کاربر — بار اول ساخته و در users.referral_code ماندگار می‌شود */
    public static function ensureCode(PDO $pdo, int $userId): string
    {
        $stmt = $pdo->prepare('SELECT referral_code FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $existing = $stmt->fetchColumn();
        if ($existing !== false && $existing !== null && (string) $existing !== '') {
            return (string) $existing;
        }

        for ($attempt = 0; $attempt < 6; $attempt++) {
            $code = self::randomCode();
            try {
                // UPDATE شرطی: اگر مسابقه‌ی هم‌زمان کد دیگری گذاشت، همان را می‌خوانیم
                $upd = $pdo->prepare(
                    "UPDATE users SET referral_code = :c WHERE id = :id AND (referral_code IS NULL OR referral_code = '')"
                );
                $upd->execute([':c' => $code, ':id' => $userId]);
                if ($upd->rowCount() > 0) {
                    return $code;
                }
                $stmt->execute([':id' => $userId]);
                $existing = $stmt->fetchColumn();
                if ($existing !== false && $existing !== null && (string) $existing !== '') {
                    return (string) $existing;
                }
            } catch (PDOException $e) {
                if ((int) ($e->errorInfo[1] ?? 0) !== 1062) { // 1062 = duplicate — کد تکراری؛ دوباره بساز
                    throw $e;
                }
            }
        }
        throw new RuntimeException('ساخت کد دعوت ناموفق بود');
    }

    /** ساخت کد تصادفی ۸ حرفی (بدون ارقام/حروف گیج‌کننده) */
    public static function randomCode(): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < 8; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }
        return $code;
    }
}

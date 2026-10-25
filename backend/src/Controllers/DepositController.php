<?php

declare(strict_types=1);

/**
 * کارام — کارت‌به‌کارت با تأیید ادمین (فاز ۸)
 *
 *  GET  /api/v1/payments/deposit/config         → فعال بودن + شماره کارت + راهنما (Bearer)
 *  POST /api/v1/payments/deposit/requests       → ثبت درخواست واریز {planCode, reference, note?} (Bearer)
 *  GET  /api/v1/payments/deposit/requests/mine  → درخواست‌های من + وضعیت (Bearer)
 *
 * قواعد امنیتی:
 *  - فعال‌سازی اشتراک فقط از پنل ادمین انجام می‌شود (AdminController::depositApprove
 *    با source='card_deposit')؛ کاربر هیچ مسیری برای خودفعال‌سازی ندارد.
 *  - شماره پیگیری نرمال‌سازی ارقام فارسی/عربی → لاتین و با الگوی محدود ذخیره می‌شود.
 *  - ضد اسپم: حداکثر ۲ درخواستِ در انتظار برای هر کاربر + پیگیریِ تکراری همان کاربر رد می‌شود.
 */
final class DepositController
{
    private const MAX_PENDING = 2;

    /** GET /api/v1/payments/deposit/config — کارت و راهنما برای صفحه‌ی پرو */
    public function config(): void
    {
        $user = Guard::requireUser();
        DepositSchema::ensure();

        $number = trim((string) (Settings::get('deposit_card_number', '') ?? ''));
        if (!Settings::bool('deposit_card_enabled') || $number === '') {
            // بدون شماره‌ی کارت، عملاً غیرفعال است
            Response::ok(['enabled' => false]);
            return;
        }

        Response::ok([
            'enabled' => true,
            'card' => [
                'number' => $number,
                'holder' => (string) (Settings::get('deposit_card_holder', '') ?? ''),
                'guide' => (string) (Settings::get('deposit_card_guide', '') ?? ''),
            ],
        ]);
    }

    /** POST /api/v1/payments/deposit/requests — {planCode, reference, note?} */
    public function createRequest(): void
    {
        $user = Guard::requireUser();
        DepositSchema::ensure();

        if (!Settings::bool('deposit_card_enabled')) {
            Response::error('پرداخت کارت‌به‌کارت فعلاً فعال نیست', 503, ['code' => 'deposit_disabled']);
            return;
        }

        $body = Request::json();
        $planCode = Validator::str($body, 'planCode', 2, 50);
        $referenceRaw = Validator::str($body, 'reference', 4, 40);
        $note = Validator::str($body, 'note', 0, 300, false);

        // ارقام فارسی/عربی → لاتین + حذف فاصله‌ها و جداکننده‌ها
        $reference = preg_replace('/[\s\-_.]/u', '', Otp::normalizeDigits($referenceRaw)) ?? '';
        if (!preg_match('/^[0-9A-Za-z]{4,40}$/', $reference)) {
            throw new ValidationError('شماره پیگیری باید ۴ تا ۴۰ رقم یا حرف لاتین باشد');
        }

        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT id, code, title, months, price_rials FROM plans WHERE code = :c AND is_active = 1 LIMIT 1');
        $stmt->execute([':c' => $planCode]);
        $plan = $stmt->fetch();
        if ($plan === false) {
            Response::error('پلن یافت نشد یا غیرفعال است', 404, ['code' => 'plan_not_found']);
            return;
        }
        $amount = (int) $plan['price_rials'];
        if ($amount < 100) {
            Response::error('قیمت این پلن هنوز تنظیم نشده است؛ با پشتیبانی تماس بگیرید', 422, ['code' => 'plan_price_missing']);
            return;
        }

        // ضد اسپم — سقف درخواستِ در انتظار
        $p = $pdo->prepare("SELECT COUNT(*) FROM deposit_requests WHERE user_id = :uid AND status = 'pending'");
        $p->execute([':uid' => $user['id']]);
        if ((int) $p->fetchColumn() >= self::MAX_PENDING) {
            Response::error('شما یک درخواست در انتظار بررسی دارید؛ لطفاً نتیجه‌ی آن را منتظر بمانید', 422, ['code' => 'deposit_pending_limit']);
            return;
        }

        // پیگیریِ تکراری همان کاربر
        $d = $pdo->prepare("SELECT COUNT(*) FROM deposit_requests WHERE user_id = :uid AND reference = :ref AND status IN ('pending','approved')");
        $d->execute([':uid' => $user['id'], ':ref' => $reference]);
        if ((int) $d->fetchColumn() > 0) {
            Response::error('این شماره پیگیری قبلاً ثبت شده است', 422, ['code' => 'deposit_duplicate_reference']);
            return;
        }

        $now = gmdate('Y-m-d H:i:s');
        $uuid = Uuid::v4();
        $pdo->prepare(
            "INSERT INTO deposit_requests (uuid, user_id, plan_id, plan_code, amount_rials, reference, note, status, created_at, updated_at)
             VALUES (:uuid, :uid, :pid, :pcode, :amount, :ref, :note, 'pending', :created, :updated)"
        )->execute([
            ':uuid' => $uuid,
            ':uid' => $user['id'],
            ':pid' => (int) $plan['id'],
            ':pcode' => (string) $plan['code'],
            ':amount' => $amount,
            ':ref' => $reference,
            ':note' => $note,
            ':created' => $now,
            ':updated' => $now,
        ]);

        Audit::log('user', (int) $user['id'], 'deposit.request_create', 'deposit_request', $uuid, [
            'planCode' => (string) $plan['code'],
            'amountRials' => $amount,
        ]);

        Response::ok([
            'message' => 'درخواست شما ثبت شد؛ بعد از بررسی، اشتراک فعال می‌شود',
            'request' => [
                'uuid' => $uuid,
                'planCode' => (string) $plan['code'],
                'planTitle' => (string) $plan['title'],
                'amountRials' => $amount,
                'reference' => $reference,
                'status' => 'pending',
                'createdAt' => $now,
            ],
        ]);
    }

    /** GET /api/v1/payments/deposit/requests/mine — ۱۰ درخواست آخر من */
    public function myRequests(): void
    {
        $user = Guard::requireUser();
        DepositSchema::ensure();

        $stmt = Database::pdo()->prepare(
            'SELECT d.uuid, d.plan_code, d.amount_rials, d.reference, d.status, d.review_note, d.created_at, d.reviewed_at,
                    p.title AS plan_title
             FROM deposit_requests d LEFT JOIN plans p ON p.id = d.plan_id
             WHERE d.user_id = :uid
             ORDER BY d.id DESC
             LIMIT 10'
        );
        $stmt->execute([':uid' => $user['id']]);

        $items = [];
        foreach ($stmt->fetchAll() as $r) {
            $items[] = [
                'uuid' => (string) $r['uuid'],
                'planCode' => (string) $r['plan_code'],
                'planTitle' => $r['plan_title'] !== null ? (string) $r['plan_title'] : null,
                'amountRials' => (int) $r['amount_rials'],
                'reference' => (string) $r['reference'],
                'status' => (string) $r['status'],
                'reviewNote' => $r['review_note'] !== null ? (string) $r['review_note'] : null,
                'createdAt' => (string) $r['created_at'],
                'reviewedAt' => $r['reviewed_at'] !== null ? (string) $r['reviewed_at'] : null,
            ];
        }

        Response::ok(['requests' => $items]);
    }
}

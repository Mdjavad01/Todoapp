<?php

declare(strict_types=1);

/**
 * کارام — کنترلر پرداخت و اشتراک — فاز ۵
 *
 *  GET  /api/v1/plans                    → پلن‌های فعال (عمومی — بدون راز)
 *  POST /api/v1/payments/orders          {planCode} → ساخت سفارش + دریافت لینک درگاه (Bearer)
 *  GET  /api/v1/payments/orders/{uuid}   → وضعیت سفارش (Bearer — برای poll بعد از بازگشت)
 *  GET  /api/v1/me/subscription          → وضعیت اشتراک فعلی کاربر (Bearer)
 *  GET  /api/payments/callback           → بازگشت از درگاه زیبال (بدون احراز — تأیید سمت سرور)
 *
 * قواعد امنیتی:
 *  - مبلغ و موفقیت هرگز از query درگاه باور نمی‌شود؛ همیشه verify سمت‌سرور + تطبیق مبلغ.
 *  - سفارش فقط برای مالکش قابل خواندن است (user_id).
 *  - پرداخت تکراری (callback دوبار) اثر مضاعف ندارد: فقط بار اول activate می‌شود.
 *  - بازگشت همیشه به خود اپ است: APP_URL/?payResult={orderUuid}&state=...
 */
final class PaymentController
{
    /** GET /api/v1/plans — پلن‌های فعال برای صفحه‌ی پرو */
    public function plans(): void
    {
        $rows = Database::pdo()
            ->query('SELECT code, title, months, price_rials, description FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
            ->fetchAll();
        $plans = [];
        foreach ($rows as $r) {
            $plans[] = [
                'code' => (string) $r['code'],
                'title' => (string) $r['title'],
                'months' => (int) $r['months'],
                'priceRials' => (int) $r['price_rials'],
                'description' => $r['description'],
            ];
        }
        Response::ok(['plans' => $plans]);
    }

    /** POST /api/v1/payments/orders — {planCode} */
    public function createOrder(): void
    {
        $user = Guard::requireUser();
        if (!ZibalProvider::enabled()) {
            Response::error('پرداخت آنلاین فعلاً فعال نیست؛ بعداً تلاش کنید', 503, ['code' => 'payments_disabled']);
            return;
        }

        $body = Request::json();
        $planCode = Validator::str($body, 'planCode', 2, 50);
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

        $orderUuid = Uuid::v4();
        $now = gmdate('Y-m-d H:i:s');
        $description = 'خرید اشتراک «' . $plan['title'] . '» — کارام';

        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                "INSERT INTO orders (uuid, user_id, plan_id, amount_rials, discount_rials, status, description, created_at, updated_at)
                 VALUES (:uuid, :uid, :pid, :amount, 0, 'created', :desc, :now, :now)"
            )->execute([
                ':uuid' => $orderUuid,
                ':uid' => $user['id'],
                ':pid' => (int) $plan['id'],
                ':amount' => $amount,
                ':desc' => $description,
                ':now' => $now,
            ]);
            $orderId = (int) $pdo->lastInsertId();

            $pdo->prepare(
                "INSERT INTO payments (uuid, order_id, gateway, status, amount_rials, created_at, updated_at)
                 VALUES (:uuid, :oid, 'zibal', 'created', :amount, :now, :now)"
            )->execute([
                ':uuid' => Uuid::v4(),
                ':oid' => $orderId,
                ':amount' => $amount,
                ':now' => $now,
            ]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $appUrl = rtrim((string) (Config::get('APP_URL', '') ?? ''), '/');
        if ($appUrl === '') {
            Response::error('APP_URL سرور تنظیم نشده است', 500, ['code' => 'app_url_missing']);
            return;
        }
        $callbackUrl = $appUrl . '/api/payments/callback';

        $mobile = null;
        $mStmt = $pdo->prepare("SELECT value FROM user_identities WHERE user_id = :id AND type = 'mobile' LIMIT 1");
        $mStmt->execute([':id' => $user['id']]);
        $m = $mStmt->fetchColumn();
        if ($m !== false && is_string($m) && $m !== '') {
            $mobile = $m;
        }

        $req = ZibalProvider::request($amount, $callbackUrl, $orderUuid, $description, $mobile);
        if (!$req['ok']) {
            // سفارش و پرداختِ ناموفق در تاریخچه می‌مانند (وضعیت failed)
            $pdo->prepare("UPDATE payments SET status = 'failed', updated_at = :now WHERE order_id = (SELECT id FROM orders WHERE uuid = :ou) AND status = 'created'")
                ->execute([':now' => gmdate('Y-m-d H:i:s'), ':ou' => $orderUuid]);
            $pdo->prepare("UPDATE orders SET status = 'failed', updated_at = :now WHERE uuid = :ou")
                ->execute([':now' => gmdate('Y-m-d H:i:s'), ':ou' => $orderUuid]);
            Response::error($req['error'] ?? 'ساخت تراکنش ناموفق بود', 502, ['code' => 'gateway_request_failed']);
            return;
        }

        $trackId = (string) $req['trackId'];
        $pdo->prepare("UPDATE payments SET gateway_ref = :ref, status = 'redirected', updated_at = :now WHERE order_id = (SELECT id FROM orders WHERE uuid = :ou)")
            ->execute([':ref' => $trackId, ':now' => gmdate('Y-m-d H:i:s'), ':ou' => $orderUuid]);
        $pdo->prepare("UPDATE orders SET status = 'redirected', updated_at = :now WHERE uuid = :ou")
            ->execute([':now' => gmdate('Y-m-d H:i:s'), ':ou' => $orderUuid]);

        Response::ok([
            'orderUuid' => $orderUuid,
            'trackId' => $trackId,
            'payUrl' => (string) $req['payUrl'],
            'amountRials' => $amount,
        ]);
    }

    /**
     * GET /api/payments/callback — بازگشت کاربر از درگاه زیبال.
     * کوئری رسمی: ?trackId=..&success=1|0&status=..&orderId=..
     * خروجی: ریدایرکت ۳۰۲ به اپ — ?payResult={orderUuid}&state=succeeded|failed
     */
    public function gatewayCallback(): void
    {
        $trackId = trim((string) ($_GET['trackId'] ?? ''));
        $success = ((string) ($_GET['success'] ?? '0')) === '1';
        $orderUuid = trim((string) ($_GET['orderId'] ?? ''));

        $appUrl = rtrim((string) (Config::get('APP_URL', '') ?? ''), '/');
        if ($appUrl === '') {
            $appUrl = '/';
        }

        $back = static function (string $orderUuid, string $state) use ($appUrl): never {
            header('Location: ' . $appUrl . '/?payResult=' . rawurlencode($orderUuid) . '&state=' . $state);
            exit;
        };

        if ($orderUuid === '' || !preg_match('/^[0-9a-fA-F-]{36}$/', $orderUuid)) {
            $back('', 'failed');
            return;
        }

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT o.id, o.uuid, o.user_id, o.amount_rials, o.status AS order_status, o.plan_id,
                    p.id AS payment_id, p.status AS payment_status, p.gateway_ref
             FROM orders o JOIN payments p ON p.order_id = o.id
             WHERE o.uuid = :u ORDER BY p.id DESC LIMIT 1'
        );
        $stmt->execute([':u' => $orderUuid]);
        $row = $stmt->fetch();

        if ($row === false) {
            $back($orderUuid, 'failed');
            return;
        }

        // پرداخت قبلاً نهایی شده (callback تکراری) — بدون اثر مضاعف
        if (in_array($row['payment_status'], ['paid'], true) || in_array($row['order_status'], ['paid', 'approved'], true)) {
            $back($orderUuid, 'succeeded');
            return;
        }

        // کاربر پرداخت را لغو کرده / ناموفق بوده — بدون verify
        if (!$success) {
            $this->markFailed($pdo, (int) $row['payment_id'], (int) $row['id'], 'پرداخت ناموفق یا لغو شده (callback success=0)');
            $back($orderUuid, 'failed');
            return;
        }

        if ($trackId === '') {
            $this->markFailed($pdo, (int) $row['payment_id'], (int) $row['id'], 'callback بدون trackId');
            $back($orderUuid, 'failed');
            return;
        }

        // تأیید سمت سرور — منبع حقیقت فقط پاسخ verify است
        $verify = ZibalProvider::verify($trackId);
        $now = gmdate('Y-m-d H:i:s');

        if ($verify['ok'] && $verify['paid']) {
            // تطبیق trackId ثبت‌شده هنگام ساخت تراکنش (ضد جعل بین سفارش‌ها)
            $refMatches = (string) $row['gateway_ref'] === $trackId;
            // تطبیق مبلغ ثبت‌شده با مبلغ تراکنش درگاه (مقدار verify بر حسب ریال است)
            $amountOk = true;
            $payload = is_string($verify['raw']) ? json_decode($verify['raw'], true) : null;
            if (is_array($payload) && isset($payload['amount'])) {
                $amountOk = (int) $payload['amount'] === (int) $row['amount_rials'];
            }

            if ($refMatches && $amountOk) {
                $pdo->beginTransaction();
                try {
                    $pdo->prepare("UPDATE payments SET status = 'paid', verified_at = :now, verify_payload = :vp, updated_at = :now WHERE id = :id")
                        ->execute([':now' => $now, ':vp' => mb_substr((string) ($verify['raw'] ?? ''), 0, 2000), ':id' => (int) $row['payment_id']]);
                    $pdo->prepare("UPDATE orders SET status = 'paid', updated_at = :now WHERE id = :id")
                        ->execute([':now' => $now, ':id' => (int) $row['id']]);

                    $planStmt = $pdo->prepare('SELECT id, months FROM plans WHERE id = :id LIMIT 1');
                    $planStmt->execute([':id' => (int) $row['plan_id']]);
                    $plan = $planStmt->fetch();
                    $months = $plan !== false ? (int) $plan['months'] : 1;
                    $planId = $plan !== false ? (int) $plan['id'] : null;

                    Subscription::activate($pdo, (int) $row['user_id'], $planId, $months, (int) $row['id'], 'web_gateway');
                    $pdo->commit();
                } catch (Throwable $e) {
                    if ($pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    error_log('[karam][payment] فعال‌سازی اشتراک ناموفق: ' . $e->getMessage());
                    // پول گرفته شده ولی فعال‌سازی خطا خورد — سفارش «paid» می‌ماند تا دستی/دوباره بررسی شود
                    $pdo->prepare("UPDATE payments SET status = 'paid', verified_at = :now, verify_payload = :vp, updated_at = :now WHERE id = :id")
                        ->execute([':now' => $now, ':vp' => mb_substr((string) ($verify['raw'] ?? ''), 0, 2000), ':id' => (int) $row['payment_id']]);
                    $pdo->prepare("UPDATE orders SET status = 'paid', updated_at = :now WHERE id = :id")
                        ->execute([':now' => $now, ':id' => (int) $row['id']]);
                    $back($orderUuid, 'succeeded');
                    return;
                }
                $back($orderUuid, 'succeeded');
                return;
            }

            // نتیجه‌ی verify موفق است ولی trackId/مبلغ با سفارش نمی‌خواند — تقلب یا سفارش اشتباه
            $this->markFailed($pdo, (int) $row['payment_id'], (int) $row['id'], 'عدم تطبیق trackId/مبلغ در verify');
            $back($orderUuid, 'failed');
            return;
        }

        $this->markFailed($pdo, (int) $row['payment_id'], (int) $row['id'], 'verify ناموفق: ' . $verify['message']);
        $back($orderUuid, 'failed');
    }

    /** GET /api/v1/payments/orders/{uuid} — وضعیت سفارش (فقط مالک) */
    public function orderStatus(array $params): void
    {
        $user = Guard::requireUser();
        $uuid = (string) ($params['uuid'] ?? '');
        if (!preg_match('/^[0-9a-fA-F-]{36}$/', $uuid)) {
            throw new ValidationError('شناسه سفارش نامعتبر است');
        }

        $stmt = Database::pdo()->prepare(
            'SELECT o.uuid, o.status, o.amount_rials, o.created_at, o.updated_at, pl.code AS plan_code, pl.title AS plan_title
             FROM orders o JOIN plans pl ON pl.id = o.plan_id
             WHERE o.uuid = :u AND o.user_id = :uid LIMIT 1'
        );
        $stmt->execute([':u' => $uuid, ':uid' => $user['id']]);
        $row = $stmt->fetch();
        if ($row === false) {
            Response::error('سفارش یافت نشد', 404, ['code' => 'not_found']);
            return;
        }

        Response::ok([
            'order' => [
                'uuid' => (string) $row['uuid'],
                'status' => (string) $row['status'],
                'amountRials' => (int) $row['amount_rials'],
                'planCode' => (string) $row['plan_code'],
                'planTitle' => (string) $row['plan_title'],
                'createdAt' => (string) $row['created_at'],
                'updatedAt' => (string) $row['updated_at'],
            ],
        ]);
    }

    /** GET /api/v1/me/subscription — وضعیت اشتراک کاربر جاری */
    public function mySubscription(): void
    {
        $user = Guard::requireUser();
        Response::ok(['subscription' => Subscription::statusFor(Database::pdo(), $user['id'])]);
    }

    /* ---------------- ابزار داخلی ---------------- */

    private function markFailed(PDO $pdo, int $paymentId, int $orderId, string $reason): void
    {
        $now = gmdate('Y-m-d H:i:s');
        try {
            $pdo->prepare("UPDATE payments SET status = 'failed', updated_at = :now WHERE id = :id AND status IN ('created','redirected')")
                ->execute([':now' => $now, ':id' => $paymentId]);
            $pdo->prepare("UPDATE orders SET status = 'failed', updated_at = :now WHERE id = :id AND status IN ('created','redirected')")
                ->execute([':now' => $now, ':id' => $orderId]);
            $pdo->prepare(
                "INSERT INTO provider_logs (provider, direction, status, identity, subject, message, created_at)
                 VALUES ('zibal', 'in', 'error', :id, 'callback', :msg, :now)"
            )->execute([':id' => (string) $orderId, ':msg' => mb_substr($reason, 0, 500), ':now' => $now]);
        } catch (Throwable $e) {
            error_log('[karam][payment] ثبت وضعیت failed ناموفق: ' . $e->getMessage());
        }
    }
}

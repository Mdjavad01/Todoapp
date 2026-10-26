<?php

declare(strict_types=1);

/**
 * کارام — کنترلر پرداخت و اشتراک — فاز ۵
 *
 *  GET  /api/v1/plans                    → پلن‌های فعال (عمومی — بدون راز)
 *  POST /api/v1/payments/orders          {planCode, giftCode?} → ساخت سفارش + لینک درگاه (Bearer)
 *  GET  /api/v1/payments/gift/quote      ?code=&plan= → استعلام کد هدیه (Bearer — v20)
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

    /**
     * GET /api/v1/payments/methods — فهرست روش‌های پرداخت و وضعیت فعال بودن هرکدام (Bearer)
     *
     * فاز ۹: صفحه‌ی پرو دیگر مستقیم به درگاه نمی‌رود؛ کاربر اول «روش پرداخت» را انتخاب می‌کند.
     * فعال‌بودن هر روش از تنظیمات پنل ادمین خوانده می‌شود؛ روش‌های آینده با enabled=false
     * و soon=true نشان داده می‌شوند تا کاربر بداند به‌زودی اضافه می‌شوند.
     */
    public function methods(): void
    {
        $user = Guard::requireUser();
        DepositSchema::ensure();

        // گام ۲ — وقتی کلید پرداخت‌ها بسته است، هیچ روشی فعال نیست (سرور منبع حقیقت است)
        $policyOn = PaymentsPolicy::effective();

        // ۱) درگاه آنلاین زیبال — فعال فقط اگر هم کلید روشن باشد هم مرچنت ست شده باشد
        $zibalEnabled = $policyOn && ZibalProvider::enabled() && trim(ZibalProvider::merchant()) !== '';

        // ۲) کارت به کارت — فعال فقط اگر کلید روشن باشد و شماره کارت ثبت شده باشد
        $cardNumber = trim((string) (Settings::get('deposit_card_number', '') ?? ''));
        $cardEnabled = $policyOn && Settings::bool('deposit_card_enabled') && $cardNumber !== '';

        $methods = [
            [
                'code' => 'online',
                'title' => 'درگاه پرداخت آنلاین',
                'description' => 'پرداخت آنی با کارت بانکی — فعال‌سازی خودکار اشتراک',
                'enabled' => $zibalEnabled,
                'soon' => !$zibalEnabled,
            ],
            [
                'code' => 'card',
                'title' => 'کارت به کارت',
                'description' => 'واریز دستی به کارت پشتیبانی — تأیید توسط ادمین',
                'enabled' => $cardEnabled,
                'soon' => !$cardEnabled,
            ],
            [
                'code' => 'agpay',
                'title' => 'درگاه آقای پرداخت',
                'description' => 'به‌زودی فعال می‌شود',
                'enabled' => false,
                'soon' => true,
            ],
        ];

        Response::ok(['methods' => $methods]);
    }

    /**
     * GET /api/v1/payments/config — وضعیت کلید پرداخت‌ها (گام ۲ — Bearer)
     *
     * اپ با این پاسخ UI پرداخت را مخفی/نمایش می‌کند (پلتفرم از هدر X-App-Platform).
     * مسیرهای شروع پرداخت علاوه بر این، سمت سرور هم گیت می‌شوند (assertEnabled).
     */
    public function config(): void
    {
        $user = Guard::requireUser();
        Response::ok(['payments' => PaymentsPolicy::statusFor()]);
    }

    /** POST /api/v1/payments/orders — {planCode, giftCode?} */
    public function createOrder(): void
    {
        $user = Guard::requireUser();
        // گام ۲ — کلید خاموش‌کردن پرداخت‌ها (master/پلتفرم/روش‌ها) — ۴۰۳ با code=payments_disabled
        PaymentsPolicy::assertEnabled();
        if (!ZibalProvider::enabled()) {
            Response::error('پرداخت آنلاین فعلاً فعال نیست؛ بعداً تلاش کنید', 503, ['code' => 'payments_disabled']);
            return;
        }

        $body = Request::json();
        $planCode = Validator::str($body, 'planCode', 2, 50);
        $giftRaw = Validator::str($body, 'giftCode', 3, 32, false); // v20 — کد هدیه اختیاری
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

        // v20 — اعمال کد هدیه: مبلغ درگاه = مبلغ پلن − تخفیف (کف امن ۱۰۰۰ ریال)
        $discount = 0;
        $couponId = null;
        $couponCode = null;
        if ($giftRaw !== null && trim($giftRaw) !== '') {
            $q = GiftCode::quote($pdo, $giftRaw, (int) $user['id'], $amount);
            if (!$q['ok']) {
                Response::error($q['error'], 422, ['code' => 'gift_invalid']);
                return;
            }
            $discount = $q['discountRials'];
            $couponId = $q['couponId'];
            $couponCode = $q['code'];
        }
        $payable = max(100, $amount - $discount);

        $orderUuid = Uuid::v4();
        $now = gmdate('Y-m-d H:i:s');
        $description = 'خرید اشتراک «' . $plan['title'] . '» — کارام';

        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                "INSERT INTO orders (uuid, user_id, plan_id, coupon_id, amount_rials, discount_rials, status, description, created_at, updated_at)
                 VALUES (:uuid, :uid, :pid, :coupon, :amount, :discount, 'created', :desc, :created, :updated)"
            )->execute([
                ':uuid' => $orderUuid,
                ':uid' => $user['id'],
                ':pid' => (int) $plan['id'],
                ':coupon' => $couponId,
                ':amount' => $payable,
                ':discount' => $discount,
                ':desc' => $description,
                ':created' => $now,
                ':updated' => $now,
            ]);
            $orderId = (int) $pdo->lastInsertId();

            $pdo->prepare(
                "INSERT INTO payments (uuid, order_id, gateway, status, amount_rials, created_at, updated_at)
                 VALUES (:uuid, :oid, 'zibal', 'created', :amount, :created, :updated)"
            )->execute([
                ':uuid' => Uuid::v4(),
                ':oid' => $orderId,
                ':amount' => $payable,
                ':created' => $now,
                ':updated' => $now,
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

        $req = ZibalProvider::request($payable, $callbackUrl, $orderUuid, $description, $mobile);
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
            'amountRials' => $payable,
            'originalPriceRials' => $amount,
            'discountRials' => $discount,
            'couponCode' => $couponCode,
        ]);
    }

    /**
     * GET /api/v1/payments/gift/quote?code=..&plan=.. — استعلام کد هدیه (v20)
     * خروجی همیشه 200 با valid=true/false — برای نمایش زنده‌ی تخفیف در شیت پرداخت.
     */
    public function giftQuote(): void
    {
        $user = Guard::requireUser();
        $code = trim((string) Request::query('code', ''));
        $planCode = trim((string) Request::query('plan', ''));
        if ($planCode === '') {
            throw new ValidationError('پلن مشخص نشده است');
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT price_rials FROM plans WHERE code = :c AND is_active = 1 LIMIT 1');
        $stmt->execute([':c' => $planCode]);
        $price = $stmt->fetchColumn();
        if ($price === false) {
            Response::ok(['valid' => false, 'error' => 'پلن یافت نشد یا غیرفعال است']);
            return;
        }
        $q = GiftCode::quote($pdo, $code, (int) $user['id'], (int) $price);
        if (!$q['ok']) {
            Response::ok(['valid' => false, 'error' => $q['error']]);
            return;
        }
        Response::ok([
            'valid' => true,
            'code' => $q['code'],
            'discountRials' => $q['discountRials'],
            'payableRials' => $q['payableRials'],
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
            'SELECT o.id, o.uuid, o.user_id, o.amount_rials, o.status AS order_status, o.plan_id, o.coupon_id, o.discount_rials,
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
            // گام ۱ — fail-closed: مبلغ فقط وقتی پذیرفته می‌شود که در پاسخ verify
            // موجود، عددی و دقیقاً برابر مبلغ سفارش باشد (نبودن amount = رد تأیید)
            $payload = is_string($verify['raw']) ? json_decode($verify['raw'], true) : null;
            $amountOk = is_array($payload)
                && array_key_exists('amount', $payload)
                && is_numeric($payload['amount'])
                && (int) $payload['amount'] === (int) $row['amount_rials'];

            if ($refMatches && $amountOk) {
                $pdo->beginTransaction();
                try {
                    $pdo->prepare("UPDATE payments SET status = 'paid', verified_at = :verified, verify_payload = :vp, updated_at = :updated WHERE id = :id")
                        ->execute([':verified' => $now, ':updated' => $now, ':vp' => mb_substr((string) ($verify['raw'] ?? ''), 0, 2000), ':id' => (int) $row['payment_id']]);
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
                    $pdo->prepare("UPDATE payments SET status = 'paid', verified_at = :verified, verify_payload = :vp, updated_at = :updated WHERE id = :id")
                        ->execute([':verified' => $now, ':updated' => $now, ':vp' => mb_substr((string) ($verify['raw'] ?? ''), 0, 2000), ':id' => (int) $row['payment_id']]);
                    $pdo->prepare("UPDATE orders SET status = 'paid', updated_at = :now WHERE id = :id")
                        ->execute([':now' => $now, ':id' => (int) $row['id']]);
                    $back($orderUuid, 'succeeded');
                    return;
                }
                // v20 — ژورنال استفاده از کد هدیه (بعد از commit — اگر خطا خورد، پرداخت سالم می‌ماند)
                GiftCode::registerRedemption($pdo, $row['coupon_id'] !== null ? (int) $row['coupon_id'] : null, (int) $row['user_id'], 'order', (int) $row['id'], (int) ($row['discount_rials'] ?? 0));
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

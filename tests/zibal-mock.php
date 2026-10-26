<?php

declare(strict_types=1);

/**
 * کارام — سرور ساختگی درگاه زیبال برای تست محلی (فاز ۵)
 *
 * اجرا:  php -S 127.0.0.1:8097 tests/zibal-mock.php
 * وضعیت در tests/zibal-mock-state.json:
 *   nextTrackId: 1
 *   orders:      { trackId: {merchant, amount, orderId, callbackUrl} }
 *   calls:       [{'type':'request'|'verify', 'at':…, 'body':…}]
 *
 * در backend/.env محلی:
 *   ZIBAL_API_BASE="http://127.0.0.1:8097"
 *   (settings.zibal_merchant از seed دیتابیس = «zibal»)
 */

$stateFile = __DIR__ . '/zibal-mock-state.json';

// گام ۱ — حالت تستی «verify بدون amount» : وقتی در state مقدار verifyOmitAmount=true باشد،
// پاسخ verify فیلد amount را ندارد تا رفتار fail-closed سمت سرور آزموده شود.

header('Content-Type: application/json; charset=utf-8');

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) {
    $body = $_POST;
}

$load = static function () use ($stateFile): array {
    $s = json_decode((string) @file_get_contents($stateFile), true);
    return is_array($s) ? $s : ['nextTrackId' => 1, 'orders' => [], 'calls' => []];
};
$save = static function (array $s) use ($stateFile): void {
    file_put_contents($stateFile, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
};

$record = static function (string $type, array $b) use ($load, $save, $stateFile): void {
    $s = $load();
    $s['calls'][] = ['type' => $type, 'at' => gmdate('c'), 'body' => $b];
    if (count($s['calls']) > 500) {
        $s['calls'] = array_slice($s['calls'], -300);
    }
    $save($s);
};

if ($uri === '/v1/request' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $record('request', $body);
    $merchant = (string) ($body['merchant'] ?? '');
    if ($merchant !== 'zibal') {
        echo json_encode(['result' => 102, 'message' => 'merchant not found']);
        exit;
    }
    $amount = (int) ($body['amount'] ?? 0);
    if ($amount < 100) {
        echo json_encode(['result' => 105, 'message' => 'amount below minimum']);
        exit;
    }
    if ((string) ($body['callbackUrl'] ?? '') === '') {
        echo json_encode(['result' => 106, 'message' => 'invalid callbackUrl']);
        exit;
    }

    $s = $load();
    $trackId = 'TST' . (string) ($s['nextTrackId'] ?? 1);
    $s['nextTrackId'] = (int) ($s['nextTrackId'] ?? 1) + 1;
    $s['orders'][$trackId] = [
        'merchant' => $merchant,
        'amount' => $amount,
        'orderId' => (string) ($body['orderId'] ?? ''),
        'callbackUrl' => (string) ($body['callbackUrl'] ?? ''),
        'createdAt' => gmdate('c'),
    ];
    $save($s);

    echo json_encode(['result' => 100, 'message' => 'success', 'trackId' => $trackId]);
    exit;
}

if ($uri === '/v1/verify' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $record('verify', $body);
    $s = $load();
    $trackId = (string) ($body['trackId'] ?? '');
    if (!isset($s['orders'][$trackId])) {
        echo json_encode(['result' => 202, 'message' => 'not paid / not found']);
        exit;
    }
    $o = $s['orders'][$trackId];
    $out = [
        'result' => 100,
        'message' => 'success',
        'status' => 1,
        'trackId' => $trackId,
        'orderId' => $o['orderId'],
        'refNumber' => 'RF' . $trackId,
        'cardNumber' => '621986****5678',
        'paidAt' => gmdate('c'),
    ];
    if (empty($s['verifyOmitAmount'])) {
        $out['amount'] = $o['amount']; // گام ۱ — بدون این فیلد، سرور باید تأیید را رد کند (fail-closed)
    }
    echo json_encode($out);
    exit;
}

http_response_code(404);
echo json_encode(['result' => -2, 'message' => 'unknown endpoint']);

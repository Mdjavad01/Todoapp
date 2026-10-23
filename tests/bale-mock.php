<?php

declare(strict_types=1);

/**
 * کارام — سرور ساختگی API بله — فقط برای تست محلی
 *
 * اجرا: php -S 127.0.0.1:8098 tests/bale-mock.php
 * وضعیت در tests/bale-mock-state.json نگه‌داری می‌شود:
 *   updates: پیام‌هایی که «کاربر» برای ربات فرستاده (تست مستقیم این فایل را می‌نویسد)
 *   sent:    پیام‌هایی که «ربات» (کد اصلی) فرستاده — کد OTP اینجا خوانده می‌شود
 */

header('Content-Type: application/json; charset=utf-8');

$stateFile = __DIR__ . '/bale-mock-state.json';

function state(string $file): array
{
    $raw = @file_get_contents($file);
    $d = json_decode((string) $raw, true);
    return is_array($d) ? $d : ['updates' => [], 'sent' => []];
}

function save(string $file, array $data): void
{
    file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

$uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

// POST /bot{token}/sendMessage
if (preg_match('#^/bot[^/]+/sendMessage$#', $uri) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $body = json_decode((string) file_get_contents('php://input'), true);
    $chatId = $body['chat_id'] ?? null;
    $text = $body['text'] ?? '';
    if ($chatId === null) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error_code' => 400, 'description' => 'chat_id required']);
        return;
    }
    $s = state($stateFile);
    $s['sent'][] = ['chat_id' => $chatId, 'text' => $text, 'at' => gmdate('c')];
    save($stateFile, $s);
    echo json_encode(['ok' => true, 'result' => ['message_id' => count($s['sent']), 'chat' => ['id' => $chatId]]]);
    return;
}

// GET /bot{token}/getUpdates?offset=N
if (preg_match('#^/bot[^/]+/getUpdates$#', $uri)) {
    $offset = (int) ($_GET['offset'] ?? 0);
    $s = state($stateFile);
    $result = [];
    foreach ($s['updates'] as $u) {
        if ((int) $u['update_id'] >= $offset) {
            $result[] = $u;
        }
    }
    echo json_encode(['ok' => true, 'result' => $result]);
    return;
}

http_response_code(404);
echo json_encode(['ok' => false, 'description' => 'not found', 'path' => $uri]);

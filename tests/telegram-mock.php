<?php

declare(strict_types=1);

/**
 * کارام — سرور ساختگی Bot API تلگرام برای تست محلی (فاز ۵)
 *
 * اجرا:  php -S 127.0.0.1:8098 tests/telegram-mock.php
 * وضعیت در tests/telegram-mock-state.json نگه‌داری می‌شود:
 *   updates: [{'update_id':1,'message':{'chat':{'id':..},'text':'/start TICKET'}}]
 *   sent:    [{'chat_id':..,'text':'کارام کد ورود…'}]
 *
 * در backend/.env محلی:
 *   TELEGRAM_API_BASE="http://127.0.0.1:8098"
 */

$stateFile = __DIR__ . '/telegram-mock-state.json';

header('Content-Type: application/json; charset=utf-8');

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// GET/POST /bot{TOKEN}/{action}
if (!preg_match('#^/bot[^/]+/(getUpdates|sendMessage)$#', $uri, $m)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error_code' => 404, 'description' => 'Not Found']);
    exit;
}
$action = $m[1];

$load = static function () use ($stateFile): array {
    $s = json_decode((string) @file_get_contents($stateFile), true);
    return is_array($s) ? $s : ['updates' => [], 'sent' => []];
};
$save = static function (array $s) use ($stateFile): void {
    file_put_contents($stateFile, json_encode($s, JSON_UNESCAPED_UNICODE), LOCK_EX);
};

if ($action === 'getUpdates') {
    $offset = (int) ($_GET['offset'] ?? 0);
    $state = $load();
    $result = [];
    foreach ($state['updates'] as $u) {
        if ($offset > 0 && (int) $u['update_id'] < $offset) {
            continue;
        }
        $result[] = $u;
    }
    echo json_encode(['ok' => true, 'result' => array_values($result)]);
    exit;
}

// sendMessage
$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
$chatId = $body['chat_id'] ?? null;
$text = $body['text'] ?? '';
if ($chatId === null) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error_code' => 400, 'description' => 'chat_id required']);
    exit;
}

$state = $load();
$state['sent'][] = ['chat_id' => $chatId, 'text' => $text, 'at' => gmdate('c')];
$save($state);

echo json_encode(['ok' => true, 'result' => ['message_id' => count($state['sent']), 'chat' => ['id' => $chatId]]]);

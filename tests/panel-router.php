<?php

declare(strict_types=1);

/**
 * کارام — روت‌ری توسعه/تست مرورگر: پنل ادمین + API هم‌مبدا روی یک پورت
 *
 *   php -S 127.0.0.1:8097 tests/panel-router.php
 *
 *  /api/...   → backend/public/index.php
 *  /panel/... → frontend/admin/dist (SPA، fallback به index.html)
 *  /          → ریدایرکت به /panel/
 * فقط برای توسعه‌ی محلی — روی هاست Apache خودش این کار را می‌کند.
 */

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

if (str_starts_with($uri, '/api')) {
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    require __DIR__ . '/../backend/public/index.php';
    return true;
}

$dist = realpath(__DIR__ . '/../frontend/admin/dist');
if ($dist === false) {
    http_response_code(500);
    echo 'بیلد پنل یافت نشد: frontend/admin/dist';
    return true;
}

if ($uri === '/' || $uri === '/panel') {
    header('Location: /panel/');
    exit;
}

if ($uri === '/panel/' || str_starts_with($uri, '/panel/')) {
    // /panel/ و هر مسیر ناشناخته → SPA fallback؛ فایل واقعی اگر وجود داشت سرو می‌شود
    $rel = $uri === '/panel/' ? '' : substr($uri, strlen('/panel/'));
    if ($rel !== '') {
        $file = realpath($dist . '/' . $rel);
        if ($file !== false && str_starts_with($file, $dist) && is_file($file)) {
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            $mime = match ($ext) {
                'js' => 'application/javascript; charset=utf-8',
                'css' => 'text/css; charset=utf-8',
                'html' => 'text/html; charset=utf-8',
                'svg' => 'image/svg+xml',
                'woff2' => 'font/woff2',
                'png' => 'image/png',
                'json', 'webmanifest' => 'application/json; charset=utf-8',
                default => 'application/octet-stream',
            };
            header('Content-Type: ' . $mime);
            if ($ext === 'html') {
                header('Cache-Control: no-cache');
            }
            readfile($file);
            return true;
        }
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    readfile($dist . '/index.html');
    return true;
}

http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => false, 'error' => 'یافت نشد'], JSON_UNESCAPED_UNICODE);
return true;

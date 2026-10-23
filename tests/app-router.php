<?php

declare(strict_types=1);

/**
 * کارام — روتر توسعه/تست مرورگر: اپ اصلی + API هم‌مبدا روی یک پورت
 *
 *   php -S 127.0.0.1:8096 tests/app-router.php
 *
 *  /api/...   → backend/public/index.php
 *  /...       → frontend/dist (SPA، fallback به index.html؛ sw.js و مانيفست هم)
 * فقط برای توسعه‌ی محلی — روی هاست Apache خودش این کار را می‌کند.
 */

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

if (str_starts_with($uri, '/api')) {
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    require __DIR__ . '/../backend/public/index.php';
    return true;
}

$dist = realpath(__DIR__ . '/../frontend/dist');
if ($dist === false) {
    http_response_code(500);
    echo 'بیلد اپ یافت نشد: frontend/dist';
    return true;
}

if ($uri === '/') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    readfile($dist . '/index.html');
    return true;
}

$file = realpath($dist . '/' . ltrim($uri, '/'));
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
    if ($ext === 'html' || $ext === 'webmanifest') {
        header('Cache-Control: no-cache');
    }
    readfile($file);
    return true;
}

// SPA fallback
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
readfile($dist . '/index.html');
return true;

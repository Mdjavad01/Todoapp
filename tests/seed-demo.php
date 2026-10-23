<?php

declare(strict_types=1);

/**
 * کارام — seed داده‌ی نمایشی برای تست مرورگر پنل (فقط توسعه محلی)
 * اجرا: php tests/seed-demo.php
 */

const ROOT = __DIR__ . '/..';

function envKey(string $key, string $default = ''): string
{
    foreach (file(ROOT . '/backend/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false || trim(substr($line, 0, $pos)) !== $key) {
            continue;
        }
        $v = trim(substr($line, $pos + 1));
        return trim($v, '"\'');
    }
    return $default;
}

function dbPath(): string
{
    return envKey('SQLITE_PATH', ROOT . '/backend/storage/karam-dev.sqlite3');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . dbPath(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('PRAGMA foreign_keys = ON');
    }
    return $pdo;
}

function uuid4(): string
{
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}

function resetEnvironment(): void
{
    $dbPath = dbPath();
    foreach ([$dbPath, $dbPath . '-wal', $dbPath . '-shm'] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $sql = (string) file_get_contents(ROOT . '/deploy/install.sqlite.sql');
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        if ($stmt !== '') {
            $pdo->exec($stmt);
        }
    }
}

function seedAdmin(string $username, string $password, string $roleCode): int
{
    $pdo = db();
    $role = $pdo->prepare('SELECT id FROM admin_roles WHERE code = ?');
    $role->execute([$roleCode]);
    $roleId = (int) $role->fetchColumn();
    $ins = $pdo->prepare('INSERT INTO admins (uuid, username, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, 1)');
    $ins->execute([uuid4(), $username, password_hash($password, PASSWORD_DEFAULT), $roleId]);
    return (int) $pdo->lastInsertId();
}

function seedUser(string $email, string $name, int $lists, int $tasks, int $completed): int
{
    $pdo = db();
    $ins = $pdo->prepare("INSERT INTO users (uuid, display_name, status, created_at, updated_at) VALUES (?, ?, 'active', strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
    $ins->execute([uuid4(), $name]);
    $uid = (int) $pdo->lastInsertId();

    $idn = $pdo->prepare("INSERT INTO user_identities (user_id, type, value, is_primary, verified_at) VALUES (?, 'email', ?, 1, strftime('%Y-%m-%d %H:%M:%S','now'))");
    $idn->execute([$uid, $email]);

    for ($i = 0; $i < $lists; $i++) {
        $li = $pdo->prepare("INSERT INTO lists (uuid, user_id, name, created_at, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
        $li->execute([uuid4(), $uid, "لیست {$i}"]);
        $listId = (int) $pdo->lastInsertId();
        for ($j = 0; $j < $tasks; $j++) {
            $done = $j < $completed ? gmdate('Y-m-d H:i:s') : null;
            $ti = $pdo->prepare('INSERT INTO tasks (uuid, user_id, list_id, title, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, strftime(\'%Y-%m-%d %H:%M:%S\',\'now\'), strftime(\'%Y-%m-%d %H:%M:%S\',\'now\'))');
            $ti->execute([uuid4(), $uid, $listId, "کار {$i}-{$j}", $done]);
        }
    }

    $rt = $pdo->prepare("INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at, issued_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now','+180 days'), strftime('%Y-%m-%d %H:%M:%S','now'))");
    $rt->execute([$uid, uuid4(), hash('sha256', $email . 'dev-token-1')]);
    $rt->execute([$uid, uuid4(), hash('sha256', $email . 'dev-token-2')]);

    return $uid;
}

resetEnvironment();
seedAdmin('boss', 'BossPass123', 'superadmin');
seedAdmin('helper', 'HelperPass123', 'support');
$u1 = seedUser('sara@test.ir', 'سارا محمدی', 3, 6, 3);
$u2 = seedUser('reza@test.ir', 'رضا کریمی', 2, 4, 1);
$u3 = seedUser('mina@test.ir', 'مینا رضایی', 4, 7, 2);

// یک کاربر پرو + یک مسدود
db()->prepare("UPDATE users SET premium_until = strftime('%Y-%m-%d %H:%M:%S','now','+20 days') WHERE id = ?")->execute([$u2]);
db()->prepare("UPDATE users SET status = 'blocked' WHERE id = ?")->execute([$u3]);

// دو اطلاعیه
$ann = db()->prepare("INSERT INTO announcements (uuid, title, body, type, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))");
$ann->execute([uuid4(), 'خوش آمدید به کارام', 'نسخه‌ی جدید اپ با سینک ابری منتشر شد. از صفحه‌ی تنظیمات، حساب کاربری بسازید تا داده‌هایتان روی همه‌ی دستگاه‌ها هم‌گام شود.', 'info', 1]);
$ann->execute([uuid4(), 'تعمیر برنامه‌ریزی‌شده', 'امشب بین ساعت ۲ تا ۳ بامداد، سرویس برای چند دقیقه در دسترس نخواهد بود.', 'warning', 1]);

echo "seed انجام شد — boss/BossPass123 (superadmin) + helper/HelperPass123 (support)\n";
echo "کاربران: {$u1}, {$u2} (پرو), {$u3} (مسدود) + ۲ اطلاعیه\n";

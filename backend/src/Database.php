<?php

declare(strict_types=1);

/**
 * کارام — اتصال PDO (Prepared Statement در همه‌جا الزامی است)
 * درایورها:
 *   mysql  → MySQL/MariaDB روی هاست (پیش‌فرض و رسمی پروژه)
 *   sqlite → فقط برای توسعه/تست محلی (بدون سرور MySQL)
 * همه‌ی تاریخ‌ها UTC.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function driver(): string
    {
        $d = strtolower(Config::get('DB_DRIVER', 'mysql') ?? 'mysql');
        return in_array($d, ['mysql', 'sqlite'], true) ? $d : 'mysql';
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false, // Prepared Statement واقعی
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ];

        if (self::driver() === 'sqlite') {
            $path = Config::get('SQLITE_PATH', '');
            if ($path === '') {
                $path = dirname(__DIR__) . '/storage/karam-dev.sqlite3';
            }
            if (!is_dir(dirname($path))) {
                mkdir(dirname($path), 0775, true);
            }
            self::$pdo = new PDO('sqlite:' . $path, null, null, $options);
            self::$pdo->exec('PRAGMA foreign_keys = ON');
            self::$pdo->exec('PRAGMA journal_mode = WAL');
            self::$pdo->exec('PRAGMA busy_timeout = 5000');
            return self::$pdo;
        }

        $host = Config::get('DB_HOST', 'localhost');
        $port = Config::get('DB_PORT', '3306');
        $name = Config::get('DB_NAME', '');
        $user = Config::get('DB_USER', '');
        $pass = Config::get('DB_PASS', '');
        $charset = Config::get('DB_CHARSET', 'utf8mb4');

        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset={$charset}";

        self::$pdo = new PDO($dsn, $user, $pass, $options);
        // همه‌ی تاریخ‌ها UTC — مطابق install.sql
        self::$pdo->exec("SET time_zone = '+00:00'");
        self::$pdo->exec("SET sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");

        return self::$pdo;
    }

    /** آیا اتصال برقرار است؟ (برای health-check بدون شکستن پاسخ) */
    public static function ping(): bool
    {
        try {
            self::pdo()->query('SELECT 1');
            return true;
        } catch (Throwable $e) {
            error_log('[karam] DB ping failed: ' . $e->getMessage());
            return false;
        }
    }
}

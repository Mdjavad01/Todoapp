<?php

declare(strict_types=1);

/**
 * کارام — نگهبان پنل مدیریت — فاز ۴
 *
 * نشست ادمین سمت‌سرور است (برخلاف کاربران): جدول admin_sessions
 *   - token_hash = SHA-256 توکن خام (Bearer)  → ابطال‌پذیر
 *   - csrf_token → همه‌ی درخواست‌های تغییردهنده باید X-CSRF-Token بفرستند
 *   - expires_at → عمر نشست (ADMIN_SESSION_TTL_HOURS)
 * سطوح دسترسی: نقش ادمین (admin_roles.permissions = JSON)
 *   - superadmin → همیشه همه‌چیز
 *   - بقیه → فقط کلیدهای true در JSON (users.view, users.manage, plans.manage, ...)
 */

final class AdminGuard
{
    /** @var array{admin:array, session:array, permissions:array<string,bool>, roleCode:string, roleName:string}|null */
    private static ?array $context = null;
    private static bool $resolved = false;

    public static function sessionTtlHours(): int
    {
        $h = (int) (Config::get('ADMIN_SESSION_TTL_HOURS', '12') ?? 12);
        return ($h >= 1 && $h <= 24 * 30) ? $h : 12;
    }

    private static function hash(string $raw): string
    {
        return hash('sha256', $raw);
    }

    /** نشست جاری از روی توکن Bearer؛ نامعتبر/منقضی = null */
    public static function resolve(): ?array
    {
        if (self::$resolved) {
            return self::$context;
        }
        self::$resolved = true;

        $token = Request::bearer();
        if ($token === null || !preg_match('/^[0-9a-f]{64}$/', $token)) {
            return self::$context = null;
        }

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT s.id AS session_id, s.admin_id, s.csrf_token, s.expires_at,
                    a.username, a.is_active, a.uuid AS admin_uuid,
                    r.code AS role_code, r.title AS role_title, r.permissions AS role_permissions
             FROM admin_sessions s
             JOIN admins a ON a.id = s.admin_id
             JOIN admin_roles r ON r.id = a.role_id
             WHERE s.token_hash = :hash
             LIMIT 1'
        );
        $stmt->execute([':hash' => self::hash($token)]);
        $row = $stmt->fetch();
        if ($row === false) {
            return self::$context = null;
        }
        if ((int) $row['is_active'] !== 1 || (string) $row['expires_at'] <= gmdate('Y-m-d H:i:s')) {
            // نشست منقضی یا ادمین غیرفعال — پاک‌سازی و رد
            $del = $pdo->prepare('DELETE FROM admin_sessions WHERE id = :id');
            $del->execute([':id' => (int) $row['session_id']]);
            return self::$context = null;
        }

        $perms = [];
        $decoded = json_decode((string) ($row['role_permissions'] ?? '{}'), true);
        if (is_array($decoded)) {
            foreach ($decoded as $k => $v) {
                if (is_string($k) && $v === true) {
                    $perms[$k] = true;
                }
            }
        }

        return self::$context = [
            'admin' => [
                'id' => (int) $row['admin_id'],
                'uuid' => (string) $row['admin_uuid'],
                'username' => (string) $row['username'],
                'roleCode' => (string) $row['role_code'],
                'roleTitle' => (string) $row['role_title'],
            ],
            'session' => ['id' => (int) $row['session_id'], 'csrf' => (string) $row['csrf_token']],
            'permissions' => $perms,
            'roleCode' => (string) $row['role_code'],
            'roleName' => (string) $row['role_title'],
        ];
    }

    /** مانند resolve اما بدون نشست معتبر → ۴۰۱ و پایان پردازش */
    public static function requireAdmin(): array
    {
        $ctx = self::resolve();
        if ($ctx === null) {
            Response::error('ورود مدیر لازم است یا نشست منقضی شده است', 401, ['code' => 'unauthorized']);
            exit;
        }
        return $ctx;
    }

    /** آیا ادمین جاری این دسترسی را دارد؟ */
    public static function can(array $ctx, string $permission): bool
    {
        if ($ctx['roleCode'] === 'superadmin') {
            return true; // مدیر کل — همه‌چیز
        }
        return isset($ctx['permissions'][$permission]) && $ctx['permissions'][$permission] === true;
    }

    /** فهرست دسترسی‌های مؤثر برای UI — منبع واحد برای login و me */
    public static function effectivePermissions(string $roleCode, ?string $rolePermissionsJson): array
    {
        $all = [
            'users.view',
            'users.manage',
            'plans.manage',
            'announcements.manage',
            'settings.manage',
            'audit.view',
            'orders.view',
            'orders.review',
        ];
        if ($roleCode === 'superadmin') {
            return $all;
        }
        $map = [];
        $decoded = json_decode((string) ($rolePermissionsJson ?? '{}'), true);
        if (is_array($decoded)) {
            foreach ($decoded as $k => $v) {
                if (is_string($k) && $v === true) {
                    $map[$k] = true;
                }
            }
        }
        return array_values(array_filter($all, static fn (string $p): bool => isset($map[$p]) && $map[$p] === true));
    }

    /** دسترسی ندارد → ۴۰۳ و پایان پردازش */
    public static function requirePermission(array $ctx, string $permission): void
    {
        if (!self::can($ctx, $permission)) {
            Response::error('برای این کار دسترسی ندارید', 403, ['code' => 'forbidden']);
            exit;
        }
    }

    /**
     * محافظت CSRF برای درخواست‌های تغییردهنده (POST/PATCH/DELETE).
     * پنل هم‌مبدا است؛ توکن در هدر X-CSRF-Token باید با نشست بخواند.
     */
    public static function requireCsrf(array $ctx): void
    {
        $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        if ($sent === '' && function_exists('apache_request_headers')) {
            $headers = array_change_key_case((array) apache_request_headers(), CASE_LOWER);
            $sent = (string) ($headers['x-csrf-token'] ?? '');
        }
        if ($sent === '' || !hash_equals($ctx['session']['csrf'], $sent)) {
            Response::error('توکن CSRF نامعتبر است — صفحه را دوباره بارگذاری کنید', 403, ['code' => 'csrf']);
            exit;
        }
    }

    /** صدور نشست جدید؛ خروجی فقط یک‌بار توکن خام را می‌دهد */
    public static function issueSession(int $adminId): array
    {
        $raw = bin2hex(random_bytes(32)); // ۶۴ کاراکتر hex
        $csrf = bin2hex(random_bytes(16));
        $ttl = self::sessionTtlHours();
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO admin_sessions (admin_id, token_hash, csrf_token, ip, user_agent, expires_at, created_at)
             VALUES (:aid, :hash, :csrf, :ip, :ua, :exp, :now)'
        );
        $stmt->execute([
            ':aid' => $adminId,
            ':hash' => self::hash($raw),
            ':csrf' => $csrf,
            ':ip' => Request::ip(),
            ':ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
            ':exp' => gmdate('Y-m-d H:i:s', time() + $ttl * 3600),
            ':now' => gmdate('Y-m-d H:i:s'),
        ]);
        return [
            'token' => $raw,
            'csrfToken' => $csrf,
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', time() + $ttl * 3600),
        ];
    }

    /** ابطال نشست جاری (خروج) */
    public static function revokeCurrent(array $ctx): void
    {
        $stmt = Database::pdo()->prepare('DELETE FROM admin_sessions WHERE id = :id');
        $stmt->execute([':id' => $ctx['session']['id']]);
    }
}

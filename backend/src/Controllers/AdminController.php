<?php

declare(strict_types=1);

/**
 * کارام — کنترلر پنل مدیریت — فاز ۴
 *
 * احراز:
 *   POST /api/admin/login            {username, password} → نشست (token + csrf)
 *   POST /api/admin/logout           (CSRF)
 *   GET  /api/admin/me               پروفایل + دسترسی‌ها
 *
 * داشبورد:
 *   GET  /api/admin/stats
 *
 * کاربران (users.view / users.manage):
 *   GET   /api/admin/users                    ?q=&status=&page=&perPage=
 *   GET   /api/admin/users/{id}
 *   PATCH /api/admin/users/{id}               {status?, displayName?, premiumUntil?}
 *   POST  /api/admin/users/{id}/premium       {planCode} یا {months} یا {lifetime:true}
 *   POST  /api/admin/users/{id}/revoke-sessions
 *
 * پلن‌ها (plans.manage):
 *   GET   /api/admin/plans
 *   PATCH /api/admin/plans/{id}
 *
 * اطلاعیه‌ها (announcements.manage):
 *   GET/POST /api/admin/announcements  —  PATCH/DELETE /api/admin/announcements/{id}
 *
 * تنظیمات (settings.manage):
 *   GET  /api/admin/settings
 *   PATCH /api/admin/settings                 {key: value, ...} — فقط کلیدهای مجاز
 *
 * لاگ رخدادها (audit.view):
 *   GET  /api/admin/audit                     ?actor=&action=&page=&perPage=
 *
 * همه‌ی درخواست‌های تغییردهنده: X-CSRF-Token الزامی + ثبت در audit_logs.
 */

final class AdminController
{
    /* ================= احراز ================= */

    /** POST /api/admin/login */
    public function login(): void
    {
        $body = Request::json();
        $username = Validator::str($body, 'username', 4, 64);
        $password = (string) ($body['password'] ?? '');
        if ($username === null || $password === '') {
            throw new ValidationError('نام کاربری و رمز عبور الزامی است');
        }

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT a.id, a.username, a.password_hash, a.is_active, a.failed_attempts, a.locked_until,
                    r.code AS role_code, r.title AS role_title, r.permissions AS role_permissions
             FROM admins a JOIN admin_roles r ON r.id = a.role_id
             WHERE a.username = :u LIMIT 1'
        );
        $stmt->execute([':u' => $username]);
        $admin = $stmt->fetch();

        $now = gmdate('Y-m-d H:i:s');
        if ($admin === false) {
            usleep(random_int(100000, 300000)); // تأخیر یکنواخت ضدحمله‌ی زمانی
            Audit::log('system', null, 'admin.login_failed', 'admin', null, ['username' => $username, 'reason' => 'not_found']);
            Response::error('نام کاربری یا رمز عبور اشتباه است', 401);
            return;
        }

        if ((int) $admin['is_active'] !== 1) {
            Response::error('این حساب مدیر غیرفعال است', 403);
            return;
        }

        if ($admin['locked_until'] !== null && (string) $admin['locked_until'] > $now) {
            $mins = (int) max(1, ceil((strtotime((string) $admin['locked_until']) - time()) / 60));
            Response::error("به دلیل تلاش‌های ناموفق، حساب تا {$mins} دقیقه قفل است", 423, ['code' => 'locked']);
            return;
        }

        if (!password_verify($password, (string) $admin['password_hash'])) {
            $failed = (int) $admin['failed_attempts'] + 1;
            $lockUntil = $failed >= 5 ? gmdate('Y-m-d H:i:s', time() + 15 * 60) : null;
            $upd = $pdo->prepare('UPDATE admins SET failed_attempts = :f, locked_until = :l WHERE id = :id');
            $upd->execute([':f' => $failed, ':l' => $lockUntil, ':id' => (int) $admin['id']]);
            usleep(random_int(100000, 300000));
            Audit::log('system', null, 'admin.login_failed', 'admin', (string) $admin['id'], ['attempts' => $failed]);
            Response::error('نام کاربری یا رمز عبور اشتباه است', 401);
            return;
        }

        // موفقیت — ریست قفل + نشست
        $upd = $pdo->prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = :now WHERE id = :id');
        $upd->execute([':now' => $now, ':id' => (int) $admin['id']]);
        $session = AdminGuard::issueSession((int) $admin['id']);
        Audit::admin((int) $admin['id'], 'admin.login', 'admin', (string) $admin['id']);

        Response::ok([
            'token' => $session['token'],
            'csrfToken' => $session['csrfToken'],
            'expiresAt' => $session['expiresAt'],
            'admin' => [
                'username' => (string) $admin['username'],
                'roleCode' => (string) $admin['role_code'],
                'roleTitle' => (string) $admin['role_title'],
            ],
            'permissions' => AdminGuard::effectivePermissions((string) $admin['role_code'], $admin['role_permissions'] ?? null),
        ]);
    }

    /** POST /api/admin/logout */
    public function logout(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requireCsrf($ctx);
        AdminGuard::revokeCurrent($ctx);
        Audit::admin($ctx['admin']['id'], 'admin.logout', 'admin', (string) $ctx['admin']['id']);
        Response::ok();
    }

    /** GET /api/admin/me */
    public function me(): void
    {
        $ctx = AdminGuard::requireAdmin();
        $stmt = Database::pdo()->prepare(
            'SELECT r.permissions FROM admins a JOIN admin_roles r ON r.id = a.role_id WHERE a.id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $ctx['admin']['id']]);
        $rolePerms = $stmt->fetchColumn();
        Response::ok([
            'admin' => $ctx['admin'],
            'permissions' => AdminGuard::effectivePermissions($ctx['roleCode'], $rolePerms === false ? null : (string) $rolePerms),
        ]);
    }

    /* ================= داشبورد ================= */

    /** GET /api/admin/stats */
    public function stats(): void
    {
        AdminGuard::requireAdmin();
        $pdo = Database::pdo();
        $now = gmdate('Y-m-d H:i:s');
        $today = gmdate('Y-m-d') . ' 00:00:00';
        $weekAgo = gmdate('Y-m-d H:i:s', time() - 7 * 86400);

        $one = static function (string $sql, array $p = []) use ($pdo): int {
            $st = $pdo->prepare($sql);
            $st->execute($p);
            $v = $st->fetchColumn();
            return $v === false ? 0 : (int) $v;
        };

        $sum = static function (string $sql, array $p = []) use ($pdo): int {
            $st = $pdo->prepare($sql);
            $st->execute($p);
            $v = $st->fetchColumn();
            return $v === false ? 0 : (int) $v;
        };

        // سری ثبت‌نام ۷ روز اخیر (روزهای بی‌داده = صفر)
        $series = [];
        for ($i = 6; $i >= 0; $i--) {
            $day = gmdate('Y-m-d', time() - $i * 86400);
            $series[] = ['date' => $day, 'count' => 0];
        }
        $stmt = $pdo->prepare(
            "SELECT DATE(created_at) AS d, COUNT(*) AS c
             FROM users
             WHERE created_at >= :from
             GROUP BY DATE(created_at)"
        );
        $stmt->execute([':from' => $weekAgo]);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string) $row['d']] = (int) $row['c'];
        }
        foreach ($series as $i => $s) {
            $series[$i]['count'] = $map[$s['date']] ?? 0;
        }

        Response::ok([
            'stats' => [
                'users' => [
                    'total' => $one('SELECT COUNT(*) FROM users'),
                    'today' => $one('SELECT COUNT(*) FROM users WHERE created_at >= :t', [':t' => $today]),
                    'last7d' => $one('SELECT COUNT(*) FROM users WHERE created_at >= :f', [':f' => $weekAgo]),
                    'blocked' => $one("SELECT COUNT(*) FROM users WHERE status = 'blocked'"),
                    'premium' => $one('SELECT COUNT(*) FROM users WHERE premium_until IS NOT NULL AND premium_until > :n', [':n' => $now]),
                ],
                'content' => [
                    'lists' => $one('SELECT COUNT(*) FROM lists WHERE deleted_at IS NULL'),
                    'tasks' => $one('SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL'),
                    'subtasks' => $one('SELECT COUNT(*) FROM subtasks WHERE deleted_at IS NULL'),
                    'tasksCompleted' => $one('SELECT COUNT(*) FROM tasks WHERE completed_at IS NOT NULL AND deleted_at IS NULL'),
                ],
                'sessions' => $one('SELECT COUNT(*) FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > :n', [':n' => $now]),
                'orders' => [
                    'paidCount' => $one("SELECT COUNT(*) FROM orders WHERE status IN ('paid','approved')"),
                    'paidAmountRials' => $sum("SELECT COALESCE(SUM(amount_rials),0) FROM orders WHERE status IN ('paid','approved')"),
                    'pendingReview' => $one("SELECT COUNT(*) FROM orders WHERE status = 'pending_review'"),
                ],
                'signupsSeries' => $series,
            ],
        ]);
    }

    /* ================= کاربران ================= */

    private static function pageParams(): array
    {
        $page = max(1, (int) (Request::query('page', '1') ?? 1));
        $perPage = (int) (Request::query('perPage', '20') ?? 20);
        $perPage = min(100, max(1, $perPage));
        return [$page, $perPage];
    }

    /** GET /api/admin/users */
    public function usersIndex(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.view');
        [$page, $perPage] = self::pageParams();
        $pdo = Database::pdo();

        $where = ['1=1'];
        $params = [];
        $status = Request::query('status');
        if ($status !== null) {
            if (!in_array($status, ['active', 'blocked', 'deleted'], true)) {
                throw new ValidationError('وضعیت نامعتبر است');
            }
            $where[] = 'u.status = :status';
            $params[':status'] = $status;
        }
        $q = Request::query('q');
        if ($q !== null) {
            $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], mb_substr($q, 0, 100)) . '%';
            $where[] = '(u.display_name LIKE :like1 OR u.uuid = :exact OR EXISTS (
                            SELECT 1 FROM user_identities i
                            WHERE i.user_id = u.id AND i.value LIKE :like2))';
            $params[':like1'] = $like;
            $params[':like2'] = $like;
            $params[':exact'] = mb_substr($q, 0, 36);
        }

        $whereSql = implode(' AND ', $where);
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users u WHERE {$whereSql}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $stmt = $pdo->prepare(
            "SELECT u.id, u.uuid, u.display_name, u.gender, u.status, u.premium_until, u.last_login_at, u.created_at,
                    (SELECT i.value FROM user_identities i WHERE i.user_id = u.id AND i.type = 'email' ORDER BY i.is_primary DESC, i.id ASC LIMIT 1) AS email,
                    (SELECT COUNT(*) FROM lists l WHERE l.user_id = u.id AND l.deleted_at IS NULL) AS lists_count,
                    (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS tasks_count
             FROM users u
             WHERE {$whereSql}
             ORDER BY u.created_at DESC, u.id DESC
             LIMIT {$perPage} OFFSET {$offset}"
        );
        $stmt->execute($params);

        $items = [];
        foreach ($stmt->fetchAll() as $row) {
            $items[] = [
                'id' => (int) $row['id'],
                'uuid' => (string) $row['uuid'],
                'displayName' => $row['display_name'],
                'gender' => (string) ($row['gender'] ?? 'unset'),
                'email' => $row['email'],
                'status' => (string) $row['status'],
                'premiumUntil' => $row['premium_until'],
                'isPremium' => $row['premium_until'] !== null && (string) $row['premium_until'] > gmdate('Y-m-d H:i:s'),
                'lastLoginAt' => $row['last_login_at'],
                'createdAt' => (string) $row['created_at'],
                'listsCount' => (int) $row['lists_count'],
                'tasksCount' => (int) $row['tasks_count'],
            ];
        }

        Response::ok([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
            'pages' => (int) ceil($total / $perPage),
        ]);
    }

    /** GET /api/admin/users/{id} */
    public function userShow(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.view');
        $id = self::userId($params);
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT id, uuid, display_name, gender, status, premium_until, last_login_at, created_at, updated_at FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        if ($user === false) {
            Response::error('کاربر یافت نشد', 404);
            return;
        }

        $idStmt = $pdo->prepare('SELECT type, value, is_primary, verified_at, created_at FROM user_identities WHERE user_id = :id ORDER BY is_primary DESC, id ASC');
        $idStmt->execute([':id' => $id]);
        $identities = [];
        foreach ($idStmt->fetchAll() as $r) {
            $identities[] = [
                'type' => (string) $r['type'],
                'value' => (string) $r['value'],
                'isPrimary' => (bool) $r['is_primary'],
                'verifiedAt' => $r['verified_at'],
                'createdAt' => (string) $r['created_at'],
            ];
        }

        $subStmt = $pdo->prepare(
            'SELECT s.uuid, s.source, s.starts_at, s.expires_at, s.created_at, p.title AS plan_title
             FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = :id ORDER BY s.created_at DESC, s.id DESC LIMIT 20'
        );
        $subStmt->execute([':id' => $id]);
        $subscriptions = [];
        foreach ($subStmt->fetchAll() as $r) {
            $subscriptions[] = [
                'uuid' => (string) $r['uuid'],
                'source' => (string) $r['source'],
                'planTitle' => $r['plan_title'],
                'startsAt' => (string) $r['starts_at'],
                'expiresAt' => $r['expires_at'],
                'createdAt' => (string) $r['created_at'],
            ];
        }

        $counts = [
            'lists' => self::scalarInt($pdo, 'SELECT COUNT(*) FROM lists WHERE user_id = :id AND deleted_at IS NULL', [':id' => $id]),
            'tasks' => self::scalarInt($pdo, 'SELECT COUNT(*) FROM tasks WHERE user_id = :id AND deleted_at IS NULL', [':id' => $id]),
            'subtasks' => self::scalarInt($pdo, 'SELECT COUNT(*) FROM subtasks WHERE user_id = :id AND deleted_at IS NULL', [':id' => $id]),
            'activeSessions' => self::scalarInt($pdo, 'SELECT COUNT(*) FROM refresh_tokens WHERE user_id = :id AND revoked_at IS NULL AND expires_at > :n', [':id' => $id, ':n' => gmdate('Y-m-d H:i:s')]),
        ];

        Response::ok([
            'user' => [
                'id' => (int) $user['id'],
                'uuid' => (string) $user['uuid'],
                'displayName' => $user['display_name'],
                'gender' => (string) ($user['gender'] ?? 'unset'),
                'status' => (string) $user['status'],
                'premiumUntil' => $user['premium_until'],
                'isPremium' => $user['premium_until'] !== null && (string) $user['premium_until'] > gmdate('Y-m-d H:i:s'),
                'lastLoginAt' => $user['last_login_at'],
                'createdAt' => (string) $user['created_at'],
                'updatedAt' => (string) $user['updated_at'],
            ],
            'identities' => $identities,
            'subscriptions' => $subscriptions,
            'counts' => $counts,
        ]);
    }

    /** PATCH /api/admin/users/{id} — وضعیت / نام نمایشی / پرو دستی */
    public function userUpdate(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        AdminGuard::requireCsrf($ctx);
        $id = self::userId($params);
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT id, uuid, display_name, status, premium_until FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        if ($user === false) {
            Response::error('کاربر یافت نشد', 404);
            return;
        }

        $body = Request::json();
        $sets = [];
        $args = [':id' => $id];
        $changed = [];

        if (array_key_exists('status', $body)) {
            $status = Validator::enum($body, 'status', ['active', 'blocked']);
            $sets[] = 'status = :status';
            $args[':status'] = $status;
            $changed['status'] = $status;
        }
        if (array_key_exists('displayName', $body)) {
            $name = Validator::str($body, 'displayName', 1, 100, false);
            $sets[] = 'display_name = :dn';
            $args[':dn'] = $name;
            $changed['displayName'] = $name;
        }
        if (array_key_exists('premiumUntil', $body)) {
            $v = $body['premiumUntil'];
            if ($v === null || $v === '') {
                $sets[] = 'premium_until = NULL';
                $changed['premiumUntil'] = null;
            } else {
                if (!is_string($v)) {
                    throw new ValidationError('تاریخ پرو نامعتبر است');
                }
                $ts = strtotime($v);
                if ($ts === false) {
                    throw new ValidationError('تاریخ پرو نامعتبر است');
                }
                $sets[] = 'premium_until = :pu';
                $args[':pu'] = gmdate('Y-m-d H:i:s', $ts);
                $changed['premiumUntil'] = gmdate('Y-m-d H:i:s', $ts);
            }
        }

        if ($sets === []) {
            throw new ValidationError('چیزی برای تغییر ارسال نشده است');
        }

        $sql = 'UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = :id';
        $upd = $pdo->prepare($sql);
        $upd->execute($args);

        if (($changed['status'] ?? null) === 'blocked') {
            // مسدودسازی → ابطال همه‌ی نشست‌های کاربر تا فوراً بیرون بیفتد
            $rv = $pdo->prepare("UPDATE refresh_tokens SET revoked_at = :n WHERE user_id = :id AND revoked_at IS NULL");
            $rv->execute([':n' => gmdate('Y-m-d H:i:s'), ':id' => $id]);
        }

        if ($changed !== []) {
            Audit::admin($ctx['admin']['id'], 'user.update', 'user', (string) $user['uuid'], $changed);
        }
        Response::ok(['message' => 'تغییرات ذخیره شد']);
    }

    /**
     * POST /api/admin/users/{id}/premium
     * بدنه: {planCode:'monthly'|'annual'|'lifetime'} یا {months:1..120} یا {lifetime:true}
     * تمدید از انتهای اشتراک فعلی (اگر فعال باشد)؛ مادام‌العمر → premium_until سنتینل 9999.
     */
    public function userGrantPremium(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        AdminGuard::requireCsrf($ctx);
        $id = self::userId($params);
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT id, uuid, premium_until FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        if ($user === false) {
            Response::error('کاربر یافت نشد', 404);
            return;
        }

        $body = Request::json();
        $lifetime = Validator::bool($body, 'lifetime', false) === true;
        $planCode = Validator::str($body, 'planCode', 2, 50, false);
        $months = Validator::int($body, 'months', 1, 120, null, false);

        $plan = null;
        if ($planCode !== null) {
            $pStmt = $pdo->prepare('SELECT id, code, title, months FROM plans WHERE code = :c AND is_active = 1 LIMIT 1');
            $pStmt->execute([':c' => $planCode]);
            $plan = $pStmt->fetch();
            if ($plan === false) {
                throw new ValidationError('پلن یافت نشد یا غیرفعال است');
            }
            if ((int) $plan['months'] === 0) {
                $lifetime = true;
            } else {
                $months = (int) $plan['months'];
            }
        }
        if (!$lifetime && $months === null) {
            throw new ValidationError('planCode یا months یا lifetime لازم است');
        }

        $now = time();
        $current = $user['premium_until'] !== null ? strtotime((string) $user['premium_until']) : false;
        $base = ($current !== false && $current > $now) ? $current : $now;

        if ($lifetime) {
            $newUntil = '9999-12-31 23:59:59';
            $subExpires = null;
        } else {
            $newUntil = gmdate('Y-m-d H:i:s', $base + ($months ?? 1) * 30 * 86400);
            $subExpires = $newUntil;
        }

        $upd = $pdo->prepare('UPDATE users SET premium_until = :pu WHERE id = :id');
        $upd->execute([':pu' => $newUntil, ':id' => $id]);

        $ins = $pdo->prepare(
            "INSERT INTO subscriptions (uuid, user_id, plan_id, order_id, source, starts_at, expires_at, created_at, updated_at)
             VALUES (:uuid, :uid, :pid, NULL, 'admin_grant', :start, :exp, :created, :updated)"
        );
        $ins->execute([
            ':uuid' => Uuid::v4(),
            ':uid' => $id,
            ':pid' => $plan !== false && $plan !== null ? (int) $plan['id'] : null,
            ':start' => gmdate('Y-m-d H:i:s', $now),
            ':exp' => $subExpires,
            ':created' => gmdate('Y-m-d H:i:s', $now),
            ':updated' => gmdate('Y-m-d H:i:s', $now),
        ]);

        Audit::admin($ctx['admin']['id'], 'user.premium_grant', 'user', (string) $user['uuid'], [
            'planCode' => $planCode,
            'months' => $lifetime ? 'lifetime' : $months,
            'premiumUntil' => $newUntil,
        ]);

        Response::ok([
            'message' => $lifetime ? 'اشتراک دائمی فعال شد' : 'اشتراک پرو فعال شد',
            'premiumUntil' => $newUntil,
        ]);
    }

    /** POST /api/admin/users/{id}/revoke-sessions — خروج اجباری همه‌ی دستگاه‌ها */
    public function userRevokeSessions(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        AdminGuard::requireCsrf($ctx);
        $id = self::userId($params);
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT uuid FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $uuid = $stmt->fetchColumn();
        if ($uuid === false) {
            Response::error('کاربر یافت نشد', 404);
            return;
        }

        $rv = $pdo->prepare('UPDATE refresh_tokens SET revoked_at = :n WHERE user_id = :id AND revoked_at IS NULL');
        $rv->execute([':n' => gmdate('Y-m-d H:i:s'), ':id' => $id]);
        $count = $rv->rowCount();

        Audit::admin($ctx['admin']['id'], 'user.sessions_revoke', 'user', (string) $uuid, ['count' => $count]);
        Response::ok(['message' => "{$count} نشست کاربر باطل شد"]);
    }

    private static function userId(array $params): int
    {
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            throw new ValidationError('شناسه کاربر نامعتبر است');
        }
        return $id;
    }

    private static function scalarInt(PDO $pdo, string $sql, array $p): int
    {
        $st = $pdo->prepare($sql);
        $st->execute($p);
        $v = $st->fetchColumn();
        return $v === false ? 0 : (int) $v;
    }

    /* ================= پلن‌ها ================= */

    /** GET /api/admin/plans */
    public function plansIndex(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'plans.manage');
        $rows = Database::pdo()->query('SELECT id, uuid, code, title, months, price_rials, description, is_active, sort_order, updated_at FROM plans ORDER BY sort_order ASC, id ASC')->fetchAll();
        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => (int) $r['id'],
                'uuid' => (string) $r['uuid'],
                'code' => (string) $r['code'],
                'title' => (string) $r['title'],
                'months' => (int) $r['months'],
                'priceRials' => (int) $r['price_rials'],
                'description' => $r['description'],
                'isActive' => (bool) $r['is_active'],
                'sortOrder' => (int) $r['sort_order'],
                'updatedAt' => (string) $r['updated_at'],
            ];
        }
        Response::ok(['items' => $items]);
    }

    /** PATCH /api/admin/plans/{id} */
    public function planUpdate(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'plans.manage');
        AdminGuard::requireCsrf($ctx);
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            throw new ValidationError('شناسه پلن نامعتبر است');
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT id, code FROM plans WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        if ($stmt->fetch() === false) {
            Response::error('پلن یافت نشد', 404);
            return;
        }

        $body = Request::json();
        $sets = [];
        $args = [':id' => $id];
        $changed = [];

        if (array_key_exists('title', $body)) {
            $sets[] = 'title = :t';
            $args[':t'] = Validator::str($body, 'title', 2, 120);
            $changed['title'] = $args[':t'];
        }
        if (array_key_exists('priceRials', $body)) {
            $sets[] = 'price_rials = :p';
            $args[':p'] = Validator::int($body, 'priceRials', 0, 99999999999);
            $changed['priceRials'] = $args[':p'];
        }
        if (array_key_exists('description', $body)) {
            $sets[] = 'description = :d';
            $args[':d'] = Validator::str($body, 'description', 1, 255, false);
            $changed['description'] = $args[':d'];
        }
        if (array_key_exists('isActive', $body)) {
            $sets[] = 'is_active = :a';
            $args[':a'] = Validator::bool($body, 'isActive') === true ? 1 : 0;
            $changed['isActive'] = (bool) $args[':a'];
        }
        if (array_key_exists('months', $body)) {
            $sets[] = 'months = :m';
            $args[':m'] = Validator::int($body, 'months', 0, 120);
            $changed['months'] = $args[':m'];
        }
        if (array_key_exists('sortOrder', $body)) {
            $sets[] = 'sort_order = :s';
            $args[':s'] = Validator::int($body, 'sortOrder', 0, 1000);
            $changed['sortOrder'] = $args[':s'];
        }

        if ($sets === []) {
            throw new ValidationError('چیزی برای تغییر ارسال نشده است');
        }
        $upd = $pdo->prepare('UPDATE plans SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $upd->execute($args);
        Audit::admin($ctx['admin']['id'], 'plan.update', 'plan', (string) $id, $changed);
        Response::ok(['message' => 'پلن به‌روزرسانی شد']);
    }

    /* ================= اطلاعیه‌ها ================= */

    /** GET /api/admin/announcements */
    public function announcementsIndex(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'announcements.manage');
        [$page, $perPage] = self::pageParams();
        $pdo = Database::pdo();

        $total = (int) $pdo->query('SELECT COUNT(*) FROM announcements')->fetchColumn();
        $offset = ($page - 1) * $perPage;
        $stmt = $pdo->prepare("SELECT id, uuid, title, body, type, is_active, starts_at, ends_at, created_at, updated_at
                               FROM announcements ORDER BY created_at DESC, id DESC LIMIT {$perPage} OFFSET {$offset}");
        $stmt->execute();
        $items = [];
        foreach ($stmt->fetchAll() as $r) {
            $items[] = [
                'id' => (int) $r['id'],
                'uuid' => (string) $r['uuid'],
                'title' => (string) $r['title'],
                'body' => (string) $r['body'],
                'type' => (string) $r['type'],
                'isActive' => (bool) $r['is_active'],
                'startsAt' => $r['starts_at'],
                'endsAt' => $r['ends_at'],
                'createdAt' => (string) $r['created_at'],
                'updatedAt' => (string) $r['updated_at'],
            ];
        }
        Response::ok(['items' => $items, 'total' => $total, 'page' => $page, 'perPage' => $perPage, 'pages' => (int) ceil($total / $perPage)]);
    }

    /** POST /api/admin/announcements */
    public function announcementCreate(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'announcements.manage');
        AdminGuard::requireCsrf($ctx);
        $body = Request::json();

        $title = Validator::str($body, 'title', 3, 150);
        $text = Validator::str($body, 'body', 3, 2000);
        $type = Validator::enum($body, 'type', ['info', 'warning', 'premium'], 'info');
        $isActive = Validator::bool($body, 'isActive', true) === true;
        $startsAt = Validator::isoDateTime($body, 'startsAt', false);
        $endsAt = Validator::isoDateTime($body, 'endsAt', false);

        $pdo = Database::pdo();
        $ins = $pdo->prepare(
            'INSERT INTO announcements (uuid, title, body, type, is_active, starts_at, ends_at, created_at, updated_at)
             VALUES (:uuid, :title, :body, :type, :act, :starts, :ends, :created, :updated)'
        );
        $ins->execute([
            ':uuid' => Uuid::v4(),
            ':title' => $title,
            ':body' => $text,
            ':type' => $type,
            ':act' => $isActive ? 1 : 0,
            ':starts' => $startsAt,
            ':ends' => $endsAt,
            ':created' => gmdate('Y-m-d H:i:s'),
            ':updated' => gmdate('Y-m-d H:i:s'),
        ]);
        $id = (int) $pdo->lastInsertId();
        Audit::admin($ctx['admin']['id'], 'announcement.create', 'announcement', (string) $id, ['title' => $title]);
        Response::json(array_merge(['ok' => true], ['message' => 'اطلاعیه ساخته شد', 'id' => $id]), 201);
    }

    /** PATCH /api/admin/announcements/{id} */
    public function announcementUpdate(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'announcements.manage');
        AdminGuard::requireCsrf($ctx);
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            throw new ValidationError('شناسه اطلاعیه نامعتبر است');
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT id FROM announcements WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        if ($stmt->fetch() === false) {
            Response::error('اطلاعیه یافت نشد', 404);
            return;
        }

        $body = Request::json();
        $sets = [];
        $args = [':id' => $id];
        $changed = [];
        if (array_key_exists('title', $body)) {
            $sets[] = 'title = :t';
            $args[':t'] = Validator::str($body, 'title', 3, 150);
            $changed['title'] = $args[':t'];
        }
        if (array_key_exists('body', $body)) {
            $sets[] = 'body = :b';
            $args[':b'] = Validator::str($body, 'body', 3, 2000);
            $changed['body'] = $args[':b'];
        }
        if (array_key_exists('type', $body)) {
            $sets[] = 'type = :ty';
            $args[':ty'] = Validator::enum($body, 'type', ['info', 'warning', 'premium']);
            $changed['type'] = $args[':ty'];
        }
        if (array_key_exists('isActive', $body)) {
            $sets[] = 'is_active = :a';
            $args[':a'] = Validator::bool($body, 'isActive') === true ? 1 : 0;
            $changed['isActive'] = (bool) $args[':a'];
        }
        if (array_key_exists('startsAt', $body)) {
            $sets[] = 'starts_at = :st';
            $args[':st'] = Validator::isoDateTime($body, 'startsAt', false);
            $changed['startsAt'] = $args[':st'];
        }
        if (array_key_exists('endsAt', $body)) {
            $sets[] = 'ends_at = :en';
            $args[':en'] = Validator::isoDateTime($body, 'endsAt', false);
            $changed['endsAt'] = $args[':en'];
        }
        if ($sets === []) {
            throw new ValidationError('چیزی برای تغییر ارسال نشده است');
        }
        $upd = $pdo->prepare('UPDATE announcements SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $upd->execute($args);
        Audit::admin($ctx['admin']['id'], 'announcement.update', 'announcement', (string) $id, $changed);
        Response::ok(['message' => 'اطلاعیه به‌روزرسانی شد']);
    }

    /** DELETE /api/admin/announcements/{id} */
    public function announcementDelete(array $params): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'announcements.manage');
        AdminGuard::requireCsrf($ctx);
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1) {
            throw new ValidationError('شناسه اطلاعیه نامعتبر است');
        }
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT uuid FROM announcements WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $uuid = $stmt->fetchColumn();
        if ($uuid === false) {
            Response::error('اطلاعیه یافت نشد', 404);
            return;
        }
        $del = $pdo->prepare('DELETE FROM announcements WHERE id = :id');
        $del->execute([':id' => $id]);
        Audit::admin($ctx['admin']['id'], 'announcement.delete', 'announcement', (string) $uuid);
        Response::ok(['message' => 'اطلاعیه حذف شد']);
    }

    /* ================= شورتکد ورود OTP (فاز ۴.۵) =================
     *
     * میان‌بر مالک برای تست کامل جریان ورود OTP بدون دسترسی به صندوق ایمیل/
     * تلگرام/پیامک: کد صادرشده مستقیماً در پاسخ ادمین برمی‌گردد (ژورنال سرور) و
     * می‌شود همان‌جا تأیید و نشست کاربر را گرفت. همه‌ی این اعمال در audit ثبت
     * می‌شوند و دسترسی لازم: users.manage.
     */

    /** POST /api/admin/otp/request  {channel:'email'|'telegram'|'sms', target?} */
    public function otpShortcutRequest(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        AdminGuard::requireCsrf($ctx);
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram', 'sms']);
        $pdo = Database::pdo();

        if ($channel === 'email') {
            $target = Validator::email($body, 'target');
            // ادمین از محدودسازی ارسال معاف است (اکشن کنترل‌شده + ثبت در audit)
            $created = Otp::createCode($pdo, 'email', $target, Request::ip());
            $sent = Mailer::send(
                $target,
                'کد ورود کارام: ' . $created['code'],
                Mailer::otpHtml($created['code'], (string) Otp::ttlMinutes()),
            );
            Audit::admin($ctx['admin']['id'], 'otp.shortcut_request', 'user', $target, ['channel' => 'email', 'sent' => $sent]);
            Response::ok([
                'channel' => 'email',
                'target' => $target,
                'code' => $created['code'], // کد مستقیم برای شورتکد ادمین
                'expiresAt' => $created['expiresAt'],
                'sent' => ['ok' => $sent, 'mode' => Mailer::transport()],
            ]);
            return;
        }

        if ($channel === 'sms') {
            if (!Sms::enabled()) {
                Response::error('کانال پیامک در تنظیمات فعال نشده است', 503, ['code' => 'sms_disabled']);
                return;
            }
            $target = AuthController::normalizeMobile((string) ($body['target'] ?? ''));
            if (!AuthController::isMobile($target)) {
                throw new ValidationError('شماره موبایل معتبر نیست (نمونه: 09123456789)');
            }
            $created = Otp::createCode($pdo, 'mobile', $target, Request::ip());
            $sent = Sms::sendCode($target, $created['code']);
            Audit::admin($ctx['admin']['id'], 'otp.shortcut_request', 'user', $target, ['channel' => 'sms', 'mode' => $sent['mode']]);
            Response::ok([
                'channel' => 'sms',
                'target' => $target,
                'code' => $created['code'],
                'expiresAt' => $created['expiresAt'],
                'sent' => $sent,
            ]);
            return;
        }

        // ---- تلگرام: بلیت اتصال (فشار START از حساب تلگرام واقعی لازم است) ----
        if (!TelegramBot::configured()) {
            Response::error('توکن ربات تلگرام در تنظیمات ثبت نشده است', 503, ['code' => 'telegram_disabled']);
            return;
        }
        $ticket = Otp::createTicket($pdo, Request::ip());
        Audit::admin($ctx['admin']['id'], 'otp.shortcut_request', 'user', null, ['channel' => 'telegram', 'ticket' => $ticket['ticket']]);
        Response::ok([
            'channel' => 'telegram',
            'ticket' => $ticket['ticket'],
            'botUsername' => TelegramBot::botUsername(),
            'deepLink' => TelegramBot::deepLink($ticket['ticket']),
            'expiresAt' => $ticket['expiresAt'],
        ]);
    }

    /** POST /api/admin/otp/telegram/poll  {ticket} → status + کد (اگر چت متصل شده باشد) */
    public function otpShortcutTelegramPoll(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        $body = Request::json();
        $ticket = Validator::str($body, 'ticket', 6, 6);
        $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
        if (!Otp::isTicketFormat($ticket)) {
            throw new ValidationError('بلیت نامعتبر است');
        }

        TelegramBot::pollAndMatchTickets(Database::pdo());
        $status = Otp::ticketStatus(Database::pdo(), $ticket);

        $out = ['status' => $status, 'botUsername' => TelegramBot::botUsername()];
        if ($status === 'code_sent') {
            // کد برای چتِ متصل‌شده ارسال شده — از ژورنال برای شورتکد برمی‌گردانیم
            $issued = Otp::lastIssuedForTicket($ticket);
            if ($issued !== null) {
                $out['code'] = (string) ($issued['code'] ?? '');
                $out['chatId'] = (string) ($issued['value'] ?? '');
            }
        }
        Response::ok($out);
    }

    /** POST /api/admin/otp/verify  {channel, target?, ticket?, code, deviceName?} → نشست کاربر */
    public function otpShortcutVerify(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'users.manage');
        AdminGuard::requireCsrf($ctx);
        $body = Request::json();
        $channel = Validator::enum($body, 'channel', ['email', 'telegram', 'sms']);
        $code = Validator::str($body, 'code', 4, 8);
        $deviceName = Validator::str($body, 'deviceName', 1, 80, false) ?? 'پنل مدیریت (شورتکد)';
        $deviceUuid = Uuid::v4();
        $pdo = Database::pdo();

        if ($channel === 'email') {
            $target = Validator::email($body, 'target');
            $identityType = 'email';
            $result = Otp::verifyCode($pdo, 'email', $target, (string) $code);
        } elseif ($channel === 'sms') {
            $target = AuthController::normalizeMobile((string) ($body['target'] ?? ''));
            if (!AuthController::isMobile($target)) {
                throw new ValidationError('شماره موبایل معتبر نیست');
            }
            $identityType = 'mobile';
            $result = Otp::verifyCode($pdo, 'mobile', $target, (string) $code);
        } else {
            $ticket = Validator::str($body, 'ticket', 6, 6);
            $ticket = mb_strtoupper(Otp::normalizeDigits((string) $ticket));
            if (!Otp::isTicketFormat($ticket)) {
                throw new ValidationError('بلیت نامعتبر است');
            }
            if (Otp::ticketStatus($pdo, $ticket) !== 'code_sent') {
                Response::error('چت تلگرام هنوز به بلیت متصل نشده است', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $target = AuthController::latestTelegramTargetForTicket($pdo, $ticket);
            if ($target === null) {
                Response::error('کد فعال یافت نشد؛ از ابتدا شروع کنید', 409, ['code' => 'ticket_not_linked']);
                return;
            }
            $identityType = 'telegram_chat_id';
            $result = Otp::verifyCode($pdo, 'telegram', $target, (string) $code);
        }

        if (!$result['ok']) {
            Response::error($result['error'], 400, ['code' => $result['code']]);
            return;
        }

        $user = AuthController::findOrCreateUserByIdentity($pdo, $identityType, $target, markVerified: true);
        if ($user['status'] !== 'active') {
            Response::error('حساب کاربری مسدود یا حذف شده است', 403, ['code' => 'blocked']);
            return;
        }

        $pdo->prepare('UPDATE users SET last_login_at = :now WHERE id = :id')
            ->execute([':id' => $user['id'], ':now' => gmdate('Y-m-d H:i:s')]);

        $access = AccessToken::issue($user['uuid']);
        $refresh = RefreshToken::issue($pdo, $user['id'], $deviceUuid, $deviceName);

        Audit::admin($ctx['admin']['id'], 'otp.shortcut_login', 'user', $user['uuid'], [
            'channel' => $channel,
            'identity' => $target,
        ]);

        $out = [
            'isNew' => $user['isNew'],
            'user' => ['uuid' => $user['uuid'], 'displayName' => $user['displayName'], 'gender' => $user['gender']],
            'accessToken' => $access['token'],
            'expiresAt' => $access['expiresAt'],
            'refreshToken' => $refresh['token'],
            'refreshExpiresAt' => $refresh['expiresAt'],
        ];
        if ($channel === 'email') {
            $out['user']['email'] = $target;
        } elseif ($channel === 'sms') {
            $out['user']['mobile'] = $target;
        } else {
            $out['user']['telegramChatId'] = $target;
        }
        Response::ok($out);
    }

    /* ================= تنظیمات ================= */

    /** کلیدهای مجاز + قواعد اعتبارسنجی هر کلید (فاز ۵: تلگرام/زیبال — کارت‌به‌کارت حذف شد) */
    private static function settingRules(): array
    {
        return [
            // --- عمومی و API ---
            'app_name' => ['type' => 'str', 'min' => 2, 'max' => 80],
            'maintenance_mode' => ['type' => 'bool'],
            'min_app_version' => ['type' => 'semver'],
            'api_allow_registration' => ['type' => 'bool'],
            'api_max_sync_items' => ['type' => 'int', 'min' => 100, 'max' => 5000],
            // --- ظاهر اپ و پرو ---
            'paywall_title' => ['type' => 'str', 'min' => 3, 'max' => 120],
            'voice_enabled' => ['type' => 'bool'],
            'voice_provider' => ['type' => 'enum', 'values' => ['off', 'web_speech']],
            'voice_rate' => ['type' => 'int', 'min' => 50, 'max' => 200],
            'voice_pitch' => ['type' => 'int', 'min' => 50, 'max' => 150],
            'voice_lang' => ['type' => 'str', 'min' => 2, 'max' => 12],
            // --- پروایدر ایمیل ---
            'provider_email_enabled' => ['type' => 'bool'],
            'mail_transport' => ['type' => 'enum', 'values' => ['mail', 'smtp', 'log'], 'allowEmpty' => true],
            'smtp_host' => ['type' => 'str', 'min' => 0, 'max' => 190],
            'smtp_port' => ['type' => 'int', 'min' => 0, 'max' => 65535],
            'smtp_secure' => ['type' => 'enum', 'values' => ['tls', 'ssl', 'none'], 'allowEmpty' => true],
            'smtp_user' => ['type' => 'str', 'min' => 0, 'max' => 190],
            'smtp_pass' => ['type' => 'str', 'min' => 0, 'max' => 190],
            'smtp_from' => ['type' => 'str', 'min' => 0, 'max' => 190],
            // --- پروایدر تلگرام (کد تأیید ورود) ---
            'telegram_bot_token' => ['type' => 'str', 'min' => 0, 'max' => 190],
            'telegram_bot_username' => ['type' => 'str', 'min' => 0, 'max' => 100],
            // --- پروایدر پیامک (HTTP عمومی) ---
            'provider_sms_enabled' => ['type' => 'bool'],
            'provider_sms_url' => ['type' => 'str', 'min' => 0, 'max' => 500],
            'provider_sms_method' => ['type' => 'enum', 'values' => ['GET', 'POST']],
            'provider_sms_headers' => ['type' => 'json'],
            'provider_sms_body' => ['type' => 'str', 'min' => 0, 'max' => 1000],
            // --- پرداخت آنلاین (درگاه زیبال) ---
            'gateway_zibal_enabled' => ['type' => 'bool'],
            'zibal_merchant' => ['type' => 'str', 'min' => 0, 'max' => 190],
        ];
    }

    /** GET /api/admin/settings */
    public function settingsIndex(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'settings.manage');
        $rows = Database::pdo()->query('SELECT `key`, `value`, `updated_at` FROM settings ORDER BY `key` ASC')->fetchAll();
        $items = [];
        foreach ($rows as $r) {
            $items[] = ['key' => (string) $r['key'], 'value' => (string) ($r['value'] ?? ''), 'updatedAt' => (string) $r['updated_at']];
        }
        Response::ok(['items' => $items, 'editable' => array_keys(self::settingRules())]);
    }

    /** PATCH /api/admin/settings — دسته‌ای {key: value} */
    public function settingsUpdate(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'settings.manage');
        AdminGuard::requireCsrf($ctx);
        $body = Request::json();
        if ($body === []) {
            throw new ValidationError('چیزی برای ذخیره ارسال نشده است');
        }

        $rules = self::settingRules();
        $pdo = Database::pdo();
        $changed = [];
        if (Database::driver() === 'mysql') {
            $stmt = $pdo->prepare(
                'INSERT INTO settings (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)
                 ON DUPLICATE KEY UPDATE `value` = :v2, `updated_at` = :now2'
            );
        } else {
            $stmt = $pdo->prepare(
                'INSERT INTO settings (`key`, `value`, `updated_at`) VALUES (:k, :v, :now)
                 ON CONFLICT(`key`) DO UPDATE SET `value` = :v2, `updated_at` = :now2'
            );
        }

        foreach ($body as $key => $value) {
            if (!is_string($key) || !isset($rules[$key])) {
                throw new ValidationError("کلید «{$key}» قابل تغییر نیست");
            }
            $rule = $rules[$key];
            $stored = null;
            if ($rule['type'] === 'bool') {
                if (!in_array($value, ['0', '1', 0, 1, true, false], true)) {
                    throw new ValidationError("مقدار «{$key}» باید 0 یا 1 باشد");
                }
                $stored = ((int) $value) === 1 ? '1' : '0';
            } elseif ($rule['type'] === 'semver') {
                if (!is_string($value) || !preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/', $value)) {
                    throw new ValidationError("مقدار «{$key}» باید به شکل x.y.z باشد");
                }
                $stored = $value;
            } elseif ($rule['type'] === 'int') {
                if (is_string($value)) {
                    $value = Otp::normalizeDigits($value);
                }
                if (!is_numeric($value) || (int) $value != $value) {
                    throw new ValidationError("مقدار «{$key}» باید عدد باشد");
                }
                $iv = (int) $value;
                if ($iv < $rule['min'] || $iv > $rule['max']) {
                    throw new ValidationError("مقدار «{$key}» باید بین {$rule['min']} تا {$rule['max']} باشد");
                }
                $stored = (string) $iv;
            } elseif ($rule['type'] === 'enum') {
                $allowEmpty = ($rule['allowEmpty'] ?? false) === true;
                if ($allowEmpty && ($value === '' || $value === null)) {
                    $stored = ''; // خالی = برگشت به .env
                } elseif (!is_string($value) || !in_array($value, $rule['values'], true)) {
                    throw new ValidationError("مقدار «{$key}» باید یکی از: " . implode(' / ', $rule['values']) . ' باشد');
                } else {
                    $stored = $value;
                }
            } elseif ($rule['type'] === 'json') {
                $decoded = is_string($value) ? json_decode($value, true) : $value;
                if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
                    throw new ValidationError("مقدار «{$key}» باید JSON معتبر باشد");
                }
                if (!is_array($decoded)) {
                    throw new ValidationError("مقدار «{$key}» باید شیء یا آرایه‌ی JSON باشد");
                }
                $stored = json_encode($decoded, JSON_UNESCAPED_UNICODE);
                if (strlen((string) $stored) > 2000) {
                    throw new ValidationError("مقدار «{$key}» خیلی بزرگ است");
                }
            } else { // str
                if (!is_string($value)) {
                    throw new ValidationError("مقدار «{$key}» باید متن باشد");
                }
                $v = trim($value);
                $len = mb_strlen($v);
                if ($len < $rule['min'] || $len > $rule['max']) {
                    throw new ValidationError("طول «{$key}» باید بین {$rule['min']} تا {$rule['max']} کاراکتر باشد");
                }
                $stored = $v;
            }

            $now = gmdate('Y-m-d H:i:s');
            $stmt->execute([':k' => $key, ':v' => $stored, ':now' => $now, ':v2' => $stored, ':now2' => $now]);
            $changed[$key] = $stored;
        }

        Audit::admin($ctx['admin']['id'], 'settings.update', 'settings', null, $changed);
        Response::ok(['message' => 'تنظیمات ذخیره شد', 'changed' => array_keys($changed)]);
    }

    /* ================= لاگ رخدادها ================= */

    /** GET /api/admin/audit */
    public function auditIndex(): void
    {
        $ctx = AdminGuard::requireAdmin();
        AdminGuard::requirePermission($ctx, 'audit.view');
        [$page, $perPage] = self::pageParams();
        $pdo = Database::pdo();

        $where = ['1=1'];
        $params = [];
        $actor = Request::query('actor');
        if ($actor !== null && in_array($actor, ['admin', 'user', 'system'], true)) {
            $where[] = 'actor_type = :actor';
            $params[':actor'] = $actor;
        }
        $action = Request::query('action');
        if ($action !== null) {
            $where[] = 'action LIKE :action';
            $params[':action'] = str_replace(['%', '_'], ['\\%', '\\_'], mb_substr($action, 0, 60)) . '%';
        }

        $whereSql = implode(' AND ', $where);
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_logs WHERE {$whereSql}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $stmt = $pdo->prepare(
            "SELECT id, actor_type, actor_id, action, entity, entity_id, details, ip, user_agent, created_at
             FROM audit_logs WHERE {$whereSql}
             ORDER BY id DESC LIMIT {$perPage} OFFSET {$offset}"
        );
        $stmt->execute($params);
        $items = [];
        foreach ($stmt->fetchAll() as $r) {
            $details = null;
            if ($r['details'] !== null) {
                $decoded = json_decode((string) $r['details'], true);
                if (is_array($decoded)) {
                    $details = $decoded;
                }
            }
            $items[] = [
                'id' => (int) $r['id'],
                'actorType' => (string) $r['actor_type'],
                'actorId' => $r['actor_id'] !== null ? (int) $r['actor_id'] : null,
                'action' => (string) $r['action'],
                'entity' => $r['entity'],
                'entityId' => $r['entity_id'],
                'details' => $details,
                'ip' => $r['ip'],
                'createdAt' => (string) $r['created_at'],
            ];
        }
        Response::ok(['items' => $items, 'total' => $total, 'page' => $page, 'perPage' => $perPage, 'pages' => (int) ceil($total / $perPage)]);
    }
}
